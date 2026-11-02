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

const LETTERS = 'ABCDEFG';
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
  return String(s || '').replace(/^[A-Ga-g][.、．)）]\s*/, '').trim();
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

/** 解析上传的 Excel（多 sheet 模板）→ { items, errors } */
function parseBankWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const items = [];
  const errors = [];
  let seq = 0;

  const push = (q, where) => {
    seq++;
    q.point = q.point || '';
    if (!q.stem && q.type !== 'single') { errors.push(`${where}：题目为空`); return; }
    if (q.type === 'single' || q.type === 'multi') {
      if ((q.options || []).length < 2) { errors.push(`${where}：选择题至少需要 2 个选项`); return; }
      const letters = [...new Set((String(q.answer).toUpperCase().match(/[A-G]/g) || []))].sort();
      if (!letters.length) { errors.push(`${where}：选择题答案应为选项字母（如 B 或 AB）`); return; }
      const bad = letters.find((L) => LETTERS.indexOf(L) >= q.options.length);
      if (bad) { errors.push(`${where}：答案包含不存在的选项 ${bad}`); return; }
      if (q.type === 'single' && letters.length > 1) { errors.push(`${where}：单选题答案只能有一个字母`); return; }
      q.answer = letters.join(',');
    }
    if (!q.answer && q.answer !== 0) { errors.push(`${where}：答案为空`); return; }
    items.push(q);
  };

  for (const name of wb.SheetNames) {
    const sheet = name.replace(/\s+/g, '');
    const rows = withNormKeys(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }));
    let carry = { material: '' };   // 复合题（完形/阅读/选择填空）：原文只在第一行，后续行沿用
    rows.forEach((r, idx) => {
      const line = `${name} 第 ${idx + 2} 行`;
      const tag = pick(r, ['标签', '知识点', '考点']);
      const analysis = pick(r, ['解析', '试题解析', '小题解析', '答案解析']);
      // 复合题原文：本行有新原文就更新，没有就沿用上一行的
      const matNow = pick(r, ['原文', '题干']);
      if (matNow) carry.material = matNow;
      const material = carry.material;

      if (sheet === '单选题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = LETTERS.split('').map((L) => stripPrefix(pick(r, ['选项' + L]))).filter(Boolean);
        push({ type: 'single', stem, options, answer: pick(r, ['正确选项', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '多选题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = LETTERS.split('').map((L) => stripPrefix(pick(r, ['选项' + L]))).filter(Boolean);
        push({ type: 'multi', stem, options, answer: pick(r, ['正确选项', '答案']), analysis, point: tag, material: '' }, line);

      } else if (sheet === '判断题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const ans = normJudge(pick(r, ['答案']));
        if (!ans) { errors.push(`${line}：判断题答案应为 正确 / 错误`); return; }
        push({ type: 'judge', stem, options: ['正确', '错误'], answer: ans, analysis, point: tag, material: '' }, line);

      } else if (sheet === '组合题') {
        // 连词成句：题目 = 分号分隔的词块，如「 I；have to；go；home 」
        const raw = pick(r, ['题目']);
        if (!raw) return;
        const chunks = raw.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
        if (chunks.length < 2) { errors.push(`${line}：组合题至少需要 2 个词块（用 ； 分隔）`); return; }
        push({
          type: 'sort', stem: '将所给的词块排列成一句通顺的话', options: chunks,
          answer: chunks.map((_, i) => i + 1).join(','), analysis, point: tag, material: '',
        }, line);

      } else if (sheet === '填空题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const blanks = [];
        for (let i = 1; i <= 6; i++) {
          const v = pick(r, ['第' + i + '空答案', '第' + i + '空']);
          if (v !== '') blanks.push(v);
        }
        if (!blanks.length) { errors.push(`${line}：填空题至少需要第 1 空答案`); return; }
        push({ type: 'fill', stem, options: [], answer: blanks.join('|'), analysis, point: tag, material: '' }, line);

      } else if (sheet === '排序题') {
        const stem = pick(r, ['题目']);
        if (!stem) return;
        const options = LETTERS.split('').map((L) => stripPrefix(pick(r, ['选项' + L]))).filter(Boolean);
        const ans = String(pick(r, ['答案'])).toUpperCase().replace(/[^A-G]/g, '');
        if (!ans) { errors.push(`${line}：排序题答案应为字母序列（如 CABDE）`); return; }
        const bad = [...new Set(ans.split(''))].find((L) => LETTERS.indexOf(L) >= options.length);
        if (bad) { errors.push(`${line}：答案包含不存在的选项 ${bad}`); return; }
        // 答案统一转成「选项位置序号」（1 基），与做题端作答格式一致
        push({ type: 'sort', stem, options, answer: ans.split('').map((L) => LETTERS.indexOf(L) + 1).join(','), analysis, point: tag, material: '' }, line);

      } else if (sheet === '完形填空题' || sheet === '选词填空' ) {
        // 原文 + 多个小题；原文只在第一行，后续行留空沿用
        const no = pick(r, ['小题序号']);
        if (!material || !no) return;
        const options = LETTERS.split('').map((L) => stripPrefix(pick(r, ['选项' + L]))).filter(Boolean);
        push({
          type: 'single', stem: `选择最佳选项补全第 ${no} 空`, options,
          answer: pick(r, ['正确选项', '小题答案']), analysis, point: tag, material,
        }, line);

      } else if (sheet === '选择填空题') {
        // 题干 + 多个小题：小题题目 + 小题答案 + 干扰项 → 打乱成单选
        const no = pick(r, ['小题序号']);
        const sub = pick(r, ['小题题目']);
        if (!material || !no || !sub) return;
        const ansText = pick(r, ['小题答案']).replace(/^[A-Ga-g][.、．)）]\s*/, '');
        const distractors = [1, 2, 3].map((i) => pick(r, ['干扰项' + i])).filter(Boolean);
        const pool = [ansText].concat(distractors);
        if (pool.length < 2) { errors.push(`${line}：选择填空小题至少需要 1 个干扰项`); return; }
        // 用行号做种子稳定打乱，保证同一行每次导入结果一致
        let seed = (no.charCodeAt(0) || 49) * 131 + idx * 7 + 3;
        for (let i = pool.length - 1; i > 0; i--) {
          seed = (seed * 9301 + 49297) % 233280;
          const j = seed % (i + 1);
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const letter = LETTERS[pool.indexOf(ansText)];
        push({
          type: 'single', stem: sub, options: pool, answer: letter,
          analysis, point: tag, material,
        }, line);

      } else if (sheet === '阅读理解题') {
        const no = pick(r, ['小题序号']);
        const subType = pick(r, ['小题题型']);
        const sub = pick(r, ['小题题目']);
        if (!material || !no || !sub) return;
        if (subType.includes('选择')) {
          const options = LETTERS.split('').map((L) => stripPrefix(pick(r, ['选项' + L]))).filter(Boolean);
          push({
            type: 'single', stem: sub, options, answer: pick(r, ['正确选项']),
            analysis, point: tag, material,
          }, line);
        } else {
          const blanks = [];
          for (let i = 1; i <= 6; i++) {
            const v = pick(r, ['第' + i + '空答案', '第' + i + '空']);
            if (v !== '') blanks.push(v);
          }
          if (!blanks.length) { errors.push(`${line}：阅读理解填空小题缺少空答案`); return; }
          push({ type: 'fill', stem: sub, options: [], answer: blanks.join('|'), analysis, point: tag, material }, line);
        }
      }
      // 其他 sheet 忽略（说明页等）
    });
  }

  return { items, errors };
}

/** 生成智能题库导入模板（多 sheet，带例题） */
function makeBankTemplate(outPath, subject) {
  const s = subject || '';
  const wb = XLSX.utils.book_new();
  const add = (name, header, rows) => {
    const ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
    ws['!cols'] = header.map(() => ({ wch: 26 }));
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
    ['单选题 / 多选题', '题目、至少 2 个选项、正确选项（字母，多选如 AC）必填'],
    ['判断题', '答案填 正确 / 错误'],
    ['组合题', '连词成句：把词块用「；」隔开写在题目里，系统自动出题'],
    ['填空题', '每空一列（第1空答案…第6空答案）；一个空有多个可接受答案用 ||| 分隔（如 is|||s）'],
    ['排序题', '选项 A~G 填句子，答案填字母顺序（如 CABDE）'],
    ['完形填空题', '第一行填原文，之后每行一个小题（原文留空自动沿用上一行）'],
    ['选择填空题', '第一行填题干；每行一个小题：小题题目 + 小题答案 + 干扰项，系统自动合成选择题'],
    ['阅读理解题', '第一行填原文；小题题型填 选择题 或 填空题，按对应列填写'],
    ['标签', '即知识点，会显示在题库管理里，可用于筛选和组卷'],
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
