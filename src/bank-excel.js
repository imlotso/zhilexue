'use strict';
/**
 * 智能题库 Excel 模板生成 + 导入解析
 * 模板格式与《题库模版》文件夹里的 习题导入模板_*.xlsx 一致：
 *   多 Sheet（单选题 / 多选题 / 判断题 / 组合题 / 填空题 / 排序题 / 完形填空题 / 选择填空题 / 阅读理解题）
 * 表头允许带换行与括号说明（如「题目\n（必填）」），解析时统一归一化。
 *
 * 入库题型（questions.type）：
 *   single 单选 / multi 多选 / judge 判断 / fill 填空（多空 | 分隔，备选 ||| 分隔）/ sort 排序·连词成句
 * 复合题（完形填空 / 阅读理解 / 选择填空）按小题拆行入库，原文存 material。
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const QSubtype = require('../public/js/question-subtypes');
const MatchQ = require('./match-question');
const { resolveDifficulty } = require('./difficulty');

const LETTERS = 'ABCDEFGHIJ';
const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题' };

/** 归一化表头：「选项 A\n（必填）」→「选项A」 */
function normKey(k) {
  return String(k || '').replace(/\s+/g, '').replace(/[（(][^）)]*[)）]/g, '');
}
function cellStr(v) {
  return v === null || v === undefined ? '' : String(v).replace(/\r/g, '').trim();
}
/** 按归一化表头取值 */
function pick(row, keys) {
  for (const k of keys) {
    const hit = row.__nk[k];
    if (hit !== undefined && cellStr(row[hit]) !== '') return cellStr(row[hit]);
  }
  return '';
}
/** 把 sheet_to_json 的行加上归一化表头映射 __nk */
function withNormKeys(rows) {
  return rows.map((r) => {
    const nk = {};
    for (const k of Object.keys(r)) nk[normKey(k)] = k;
    r.__nk = nk;
    return r;
  });
}
/** 选项单元格可能自带「A、」前缀，去掉 */
function stripPrefix(s) {
  return String(s || '').replace(/^[A-Ja-j][.、．)）]\s*/, '').trim();
}
function choiceOptions(row) {
  const values = [...LETTERS].map((letter) => stripPrefix(pick(row, ['选项' + letter])));
  const last = values.reduce((result, value, i) => value ? i : result, -1);
  return values.slice(0, last + 1).some((value) => !value) ? null : values.slice(0, last + 1);
}
/** 多空答案必须保留空位含义：全部留空可待审核，部分填写时不得把后续答案前移。 */
function fillAnswers(row) {
  const values = Array.from({ length: 6 }, (_, i) => pick(row, ['第' + (i + 1) + '空答案', '第' + (i + 1) + '空']));
  const last = values.reduce((result, value, i) => value !== '' ? i : result, -1);
  const missing = values.slice(0, last + 1).findIndex((value) => value === '');
  return missing >= 0
    ? { error: `第 ${missing + 1} 空答案缺失，不能将后续答案前移；请补齐或全部留空` }
    : { answer: last < 0 ? '' : values.slice(0, last + 1).join('|') };
}
/** 判断题答案归一：正确/错误 */
function normJudge(v) {
  const s = String(v || '').trim().toUpperCase();
  if (['正确', '对', '√', 'T', 'TRUE', 'A', 'Y', 'YES', '是'].includes(s)) return '正确';
  if (['错误', '错', '×', 'X', 'F', 'FALSE', 'B', 'N', 'NO', '否'].includes(s)) return '错误';
  return '';
}
/** 难度：1~5；也接受 基础/中档/压轴 */
function normDiff(v) {
  const s = String(v || '').trim();
  if (!s) return 3;
  if (s.includes('基础')) return 1;
  if (s.includes('压轴')) return 5;
  if (s.includes('中档')) return 3;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

/** 显式十级列与旧五星列分开识别，不能因为表头归一化而把 1–5 数字猜成十级。 */
function rowDifficulty(row) {
  const keys = Object.keys(row).filter(k => k !== '__nk');
  const compact = k => String(k).replace(/\s+/g, '');
  const isTen = k => /^(?:十级难度|难度10分|difficulty_score_10)(?:[（(]|$)/i.test(compact(k)) || /^难度[（(]1[-–—~～至]10(?:[，,）)]|$)/.test(compact(k));
  const tenKey = keys.find(k => isTen(k) && cellStr(row[k]) !== '');
  const fiveKey = keys.find(k => !isTen(k) && ['难度', '五星难度'].includes(normKey(k)) && cellStr(row[k]) !== '');
  const input = {};
  if (fiveKey) {
    const value = cellStr(row[fiveKey]);
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      if (n < 1 || n > 5) return { error: '五星难度须为 1 至 5 的整数' };
      input.difficulty = n;
    } else if (/基础|中档|压轴/.test(value)) input.difficulty = normDiff(value);
    else return { error: '五星难度请填写 1–5、基础、中档或压轴' };
  }
  if (tenKey) input.difficulty_score_10 = cellStr(row[tenKey]);
  if (!Object.keys(input).length) return null;
  return resolveDifficulty(input);
}

/** 解析上传的 Excel（多 sheet 模板）→ { items, errors } */
function parseBankWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const items = [];
  const errors = [];
  let examples = 0;   // 模板里的【例题】示例行（不当成真题）
  let seq = 0;
  let rowSubtype = '';
  let rowMatch = '';
  let rowGroup = '';
  let activeRow = null;

  const push = (q, where) => {
    seq++;
    const diff = rowDifficulty(activeRow);
    if (diff && diff.error) { errors.push(`${where}：${diff.error}`); return; }
    if (diff) { q.difficulty = diff.difficulty; q.difficulty_score_10 = diff.difficulty_score_10; }
    q.point = q.point || '';
    if (q.material && rowGroup) q.group_ref = rowGroup;
    if (rowSubtype) {
      const subtype = QSubtype.find(rowSubtype);
      if (!subtype) { errors.push(`${where}：不支持的细分题型「${rowSubtype}」`); return; }
      if (!QSubtype.matchesType(subtype, q.type)) { errors.push(`${where}：细分题型「${rowSubtype}」与本表基础题型不匹配`); return; }
      q.question_subtype = subtype.code;
      if (QSubtype.isMatch(subtype.code)) {
        const checked = MatchQ.normalize(rowMatch.split(/\r?\n/), q.options, q.answer, true, subtype.code);
        if (checked.error) { errors.push(`${where}：${checked.error}`); return; }
        q.match_prompts = checked.prompts; q.answer = checked.answer;
      }
    }
    if (!q.stem) { errors.push(`${where}：题目为空`); return; }
    if (q.type === 'single' || q.type === 'multi') {
      if ((q.options || []).length < 2) { errors.push(`${where}：选择题至少需要 2 个选项`); return; }
      if ((q.options || []).length > 10) { errors.push(`${where}：选择题最多支持 10 个选项`); return; }
      const rawAnswer = String(q.answer == null ? '' : q.answer).trim();
      if (rawAnswer) {
        if (!/^[A-J\s,，、;；]+$/i.test(rawAnswer)) { errors.push(`${where}：选择题答案应为选项字母（A–J）`); return; }
        const letters = rawAnswer.toUpperCase().match(/[A-J]/g) || [];
        if (!letters.length || new Set(letters).size !== letters.length) { errors.push(`${where}：选择题答案须为不重复的选项字母`); return; }
        const bad = letters.find((L) => LETTERS.indexOf(L) >= q.options.length);
        if (bad) { errors.push(`${where}：答案包含不存在的选项 ${bad}`); return; }
        if (q.type === 'single' && letters.length !== 1) { errors.push(`${where}：单选题答案只能有一个字母`); return; }
        if (q.type === 'multi' && letters.length < 2) { errors.push(`${where}：多选题答案至少需要两个选项`); return; }
        q.answer = letters.sort().join(',');
      } else q.answer = '';
    }
    items.push(q);
  };

  for (const name of wb.SheetNames) {
    const sheet = name.replace(/\s+/g, '');
    const rows = withNormKeys(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }));
    let carry = { material: '' };   // 复合题（完形/阅读/选择填空）：原文只在第一行，后续行沿用
    // 选择填空题：同一题干下的所有小题共用一个词库（客户模板的示例就是这样：干扰项列留空，选项就是各小题的答案）
    const selAnswers = new Map();
    if (sheet === '选择填空题') {
      let group = '';
      rows.forEach((r, idx) => {
        // Identical instructions can begin different exercises; key by the row
        // where this group starts, never by the material text or its properties.
        if (pick(r, ['原文', '题干'])) group = `${name}:${Number.isInteger(r.__rowNum__) ? r.__rowNum__ + 1 : idx + 2}`;
        const a = pick(r, ['小题答案']).replace(/^[A-Ja-j][.、．)）]\s*/, '');
        if (group && a) {
          if (!selAnswers.has(group)) selAnswers.set(group, []);
          selAnswers.get(group).push(a);
        }
      });
    }
    rows.forEach((r, idx) => {
      activeRow = r;
      rowSubtype = pick(r, ['英语细分题型', '数学细分题型', '细分题型']);
      rowMatch = pick(r, ['匹配左侧项目']);
      const rowNumber = Number.isInteger(r.__rowNum__) ? r.__rowNum__ + 1 : idx + 2;
      const line = `${name} 第 ${rowNumber} 行`;
      const tag = pick(r, ['标签', '知识点', '考点']);
      const analysis = pick(r, ['解析', '试题解析', '小题解析', '答案解析']);
      // 复合题原文：本行有新原文就更新，没有就沿用上一行的
      const matNow = pick(r, ['原文', '题干']);
      // 模板自带的示例以「【例题】」开头：整组（含复合题后面没有原文的小题行）都跳过，下一个有原文/题目的行重新判断
      const headCell = pick(r, ['原文', '题干', '题目']);
      if (headCell) carry.example = /^\s*【例题】/.test(headCell);
      if (carry.example) { if (headCell) examples++; return; }
      if (matNow) { carry.material = matNow; carry.group = `${name}:${rowNumber}`; }
      const material = carry.material;
      rowGroup = carry.group || '';

      if (sheet === '作图题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        push({ type: 'answer', question_subtype: 'drawing', stem, options: [], answer: pick(r, ['参考答案', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '书面表达题' || sheet === '问答题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        push({ type: 'answer', question_subtype: sheet === '书面表达题' ? 'writing' : '', stem, options: [], answer: pick(r, ['参考范文', '参考答案', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '单选题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = choiceOptions(r);
        if (!options) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
        push({ type: 'single', stem, options, answer: pick(r, ['正确选项', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '多选题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = choiceOptions(r);
        if (!options) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
        push({ type: 'multi', stem, options, answer: pick(r, ['正确选项', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '判断题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const rawAnswer = pick(r, ['答案']);
        const ans = normJudge(rawAnswer);
        if (rawAnswer && !ans) { errors.push(`${line}：判断题答案应为 正确 / 错误`); return; }
        push({ type: 'judge', stem, options: ['正确', '错误'], answer: ans, analysis, point: tag, material: '' }, line);

      } else if (sheet === '组合题') {
        // 连词成句：题目 = 分号分隔的词块，如「 I；have to；go；home 」
        const raw = pick(r, ['题目']);
        if (!raw) return;
        const chunks = raw.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
        if (chunks.length < 2) { errors.push(`${line}：组合题至少需要 2 个词块（用 ； 分隔）`); return; }
        push({
          type: 'sort', stem: '将所给的词块排列成一句通顺的话', options: chunks,
          // 模板没有答案列；词块顺序不是经老师确认的正式答案。
          answer: '', analysis, point: tag, material: '',
        }, line);

      } else if (sheet === '填空题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const blanks = fillAnswers(r);
        if (blanks.error) { errors.push(`${line}：${blanks.error}`); return; }
        push({ type: 'fill', stem, options: [], answer: blanks.answer, analysis, point: tag, material: '' }, line);

      } else if (sheet === '排序题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = choiceOptions(r);
        if (!options) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
        if (options.length < 2 || options.length > 7) { errors.push(`${line}：排序题需要 2–7 个选项`); return; }
        const rawAnswer = String(pick(r, ['答案'])).trim();
        const isMatch = QSubtype.isMatch((QSubtype.find(rowSubtype) || {}).code);
        let ans = '';
        if (rawAnswer && !isMatch) {
          if (!/^[A-G\s,，、;；]+$/i.test(rawAnswer)) { errors.push(`${line}：排序题答案应为字母序列（如 CABDE）`); return; }
          ans = rawAnswer.toUpperCase().replace(/[\s,，、;；]/g, '');
          if (ans.length !== options.length || new Set(ans).size !== options.length || [...ans].some((L) => LETTERS.indexOf(L) >= options.length)) { errors.push(`${line}：排序答案应包含每个选项且仅包含一次`); return; }
        }
        // 答案统一转成「选项位置序号」（1 基），与做题端作答格式一致
        push({ type: 'sort', stem, options, answer: isMatch ? rawAnswer : ans.split('').map((L) => LETTERS.indexOf(L) + 1).join(','), analysis, point: tag, material: '' }, line);

      } else if (sheet === '完形填空题' || sheet === '选词填空' ) {
        // 原文 + 多个小题；原文只在第一行，后续行留空沿用
        const no = pick(r, ['小题序号']);
        if (!material || !no) return;
        const options = choiceOptions(r);
        if (!options) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
        push({
          type: 'single', stem: `选择最佳选项补全第 ${no} 空`, options,
          answer: pick(r, ['正确选项', '小题答案']), analysis, point: tag, material,
        }, line);

      } else if (sheet === '选择填空题') {
        // 题干 + 多个小题：小题题目 + 小题答案 + 干扰项 → 打乱成单选
        const no = pick(r, ['小题序号']);
        const sub = pick(r, ['小题题目']);
        if (!material || !no || !sub) return;
        const ansText = pick(r, ['小题答案']).replace(/^[A-Ja-j][.、．)）]\s*/, '');
        const distractors = [1, 2, 3].map((i) => pick(r, ['干扰项' + i])).filter(Boolean);
        const explicitOptions = choiceOptions(r);
        if (!explicitOptions) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
        if (!ansText && explicitOptions.length < 2) { errors.push(`${line}：小题答案为空时，请提供完整的选项 A、B 等；干扰项或其他小题答案不能推断本题选项`); return; }
        if (explicitOptions.length && explicitOptions.length < 2) { errors.push(`${line}：选择题至少需要 2 个完整选项`); return; }
        let pool = explicitOptions.length ? explicitOptions.slice() : [ansText].concat(distractors);
        // 没填干扰项：用同一题干下所有小题的答案做共用选项（至少要有 2 个小题）；填了干扰项就用「本题答案 + 干扰项」
        if (!explicitOptions.length && !distractors.length) pool = [...new Set((selAnswers.get(rowGroup) || []).concat([ansText]))];
        if (pool.length < 2) { errors.push(`${line}：选择填空只有 1 个小题时，需要至少填 1 个干扰项`); return; }
        if (ansText && pool.filter((value) => value === ansText).length !== 1) { errors.push(`${line}：小题答案必须唯一对应完整选项中的一项`); return; }
        // 明确填写 A–J 的选项必须保持原顺序；仅由答案与干扰项组装的词库使用稳定打乱。
        if (!explicitOptions.length) {
          let seed = (no.charCodeAt(0) || 49) * 131 + idx * 7 + 3;
          for (let i = pool.length - 1; i > 0; i--) {
            seed = (seed * 9301 + 49297) % 233280;
            const j = seed % (i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
        }
        const letter = ansText ? LETTERS[pool.indexOf(ansText)] : '';
        push({
          type: 'single', stem: sub, options: pool, answer: letter,
          analysis, point: tag, material,
        }, line);

      } else if (sheet === '阅读理解题') {
        const no = pick(r, ['小题序号']);
        const subType = pick(r, ['小题题型']);
        const sub = pick(r, ['小题题目']);
        if (!material || !no || !sub) return;
        if (/选择|单选|多选/.test(subType)) {
          const options = choiceOptions(r);
          if (!options) { errors.push(`${line}：选项须从 A 开始连续填写`); return; }
          push({
            type: /多选/.test(subType) ? 'multi' : 'single', stem: sub, options, answer: pick(r, ['正确选项', '答案']),
            analysis, point: tag, material,
          }, line);
        } else {
          const blanks = fillAnswers(r);
          if (blanks.error) { errors.push(`${line}：${blanks.error}`); return; }
          push({ type: 'fill', stem: sub, options: [], answer: blanks.answer, analysis, point: tag, material }, line);
        }
      }
      // 其他 sheet 忽略（说明页等）
    });
  }

  return { items, errors, examples };
}

/** 生成智能题库导入模板（多 sheet，带例题） */
function makeBankTemplate(outPath, subject) {
  const s = subject || '';
  const wb = XLSX.utils.book_new();
  const add = (name, header, rows) => {
    const missing = ['单选题', '多选题', '完形填空题', '选择填空题', '阅读理解题'].includes(name)
      ? [...LETTERS].filter((letter) => !header.some((cell) => normKey(cell) === normKey('选项' + letter))).map((letter) => '选项 ' + letter) : [];
    const cols = [...header, ...missing, '十级难度（1–10，选填）'];
    const ws = XLSX.utils.aoa_to_sheet([cols].concat(rows.map(row=>[...row, ...missing.map(() => ''), ''])));
    ws['!cols'] = cols.map(() => ({ wch: 26 }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  add('单选题',
    ['题目', '选项 A', '选项 B', '选项 C', '选项 D', '选项 E', '正确选项', '解析', '标签', '备注'],
    [[`${s ? s + '示例：' : ''}下列各数中，是负数的是（ ）`, '0', '-3', '2', '1/2', '', 'B', '小于 0 的数是负数，故选 B。', '负数', '']]);
  add('多选题',
    ['题目', '选项 A', '选项 B', '选项 C', '选项 D', '正确选项', '解析', '标签'],
    [['下列说法正确的有（ ）', '0 既不是正数也不是负数', '最小的正整数是 0', '整数包括正整数、0 和负整数', '有理数都可以写成分数', 'AC', 'B 错，最小的正整数是 1。', '有理数']]);
  add('判断题',
    ['题目', '答案', '解析', '标签'],
    [['0 是最小的正整数。（ ）', '错误', '最小的正整数是 1。', '有理数']]);
  add('组合题',
    ['题目（词块用 ； 分隔）', '解析', '标签'],
    [[' I；have to；go；home ', '连词成句：I have to go home.', '连词成句']]);
  add('填空题',
    ['题目', '第1空答案', '第2空答案', '第3空答案', '解析', '标签'],
    [['-5 的绝对值是____，相反数是____。', '5', '-5', '', '绝对值是到原点的距离；相反数符号相反。', '绝对值'],
     ['一个空有多个可接受答案时用 ||| 分隔：He ____ (is/are) my friend.', 'is|||s', '', '', 'is 与缩写 s 都算对。', 'be动词']]);
  add('排序题',
    ['题目', '选项 A', '选项 B', '选项 C', '选项 D', '选项 E', '答案', '解析', '标签'],
    [['将下列句子排成一段通顺的对话', 'He ran out of his house.', 'He ran to the bus stop, and got on the bus.', 'Yesterday morning, Tom got up at ten past eight.', 'He got to the school. But there were no pupils there.', 'Oh, today is Saturday!', 'CABDE', '', '排序']]);
  add('完形填空题',
    ['原文', '小题序号', '选项A', '选项B', '选项C', '选项D', '正确选项', '小题解析', '标签'],
    [['（短文第一行填原文，下面的行只填小题，原文留空）', '1', 'students', 'classmates', 'girls', '', 'B', '', '完形填空'],
     ['', '2', 'twelve', 'twenty', 'twentieth', '', 'A', '', '']]);
  add('选择填空题',
    ['题干', '小题序号', '小题题目', '小题答案', '干扰项1', '干扰项2', '干扰项3', '解析', '标签'],
    [['根据句意选择合适的选项。', '1', 'Where does he work?____', 'A hospital.', 'He likes sports.', 'A reporter.', '', '', '选词填空'],
     ['', '2', 'What does she want to be?____', 'A reporter.', 'A hospital.', '', '', '', '']]);
  add('阅读理解题',
    ['原文', '小题序号', '小题题型', '小题题目', '选项 A', '选项 B', '选项 C', '选项 D', '正确选项', '第1空答案', '第2空答案', '小题解析', '标签'],
    [['（短文第一行填原文）Tom is a student. He goes to school by bus every day.', '1', '选择题', 'How does Tom go to school?', 'By bike.', 'By bus.', 'On foot.', 'By car.', 'B', '', '', '根据 He goes to school by bus every day. 可知。', '阅读理解'],
     ['', '2', '填空题', 'After school, Tom often plays ____ with his ____.', '', '', '', '', '', 'football', 'friends', '根据短文最后一句可知。', '']]);

  // 填写说明
  const help = [
    ['Sheet', '填写说明'],
    ['单选题 / 多选题', '题目和至少 2 个选项必填；原卷无答案时正确选项留空，待老师核对'],
    ['判断题', '答案可留空；有答案时填 正确 / 错误'],
    ['组合题', '连词成句：把词块用「；」隔开；原顺序不自动当作答案，需老师审核补充'],
    ['填空题', '每空一列（第1空答案…第6空答案）；全部未知可留空，已填答案须从第一空连续填写；备选用 ||| 分隔'],
    ['排序题', '选项 A~G 填句子；答案可留空，有答案时填每项各一次的字母顺序（如 CABDE）'],
    ['完形填空题', '第一行填原文，之后每行一个小题（原文留空自动沿用上一行）'],
    ['选择填空题', '第一行填题干；无答案时须在选项 A–J 中提供完整选项，不能仅填干扰项或依赖其他小题的答案'],
    ['阅读理解题', '第一行填原文；小题题型填 选择题 或 填空题，按对应列填写'],
    ['标签', '即知识点，会显示在题库管理里，可用于筛选和组卷'],
    ['十级难度', '可选填 1–10 整数；原有五星难度仍按 1–5 解读，不确定时留空。'],
    ['导入位置', '管理后台 → 智能题库 → 题库管理 → 「⬆ 导入 Excel」'],
  ];
  const wsH = XLSX.utils.aoa_to_sheet(help);
  wsH['!cols'] = [{ wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsH, '填写说明');

  XLSX.writeFile(wb, outPath);
  return outPath;
}

module.exports = { parseBankWorkbook, makeBankTemplate, TYPE_NAMES };

if (require.main === module) {
  const out = path.join(__dirname, '..', 'data', '智能题库导入模板.xlsx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  makeBankTemplate(out);
  console.log('模板已生成：' + out);
}
