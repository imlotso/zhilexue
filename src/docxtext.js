'use strict';
/**
 * docx 文本抽取 + 结构化题目解析（2026-10-30 新增，课文习题批量上传 / 录题共用）
 *
 *  1. parseDocx(buffer, { saveImage })
 *     解出 docx 段落文本；段内 <a:blip> 插图经 saveImage(buf, name) 上传后以 [图N] 占位。
 *     返回 { paras: ['…'], figs: [{ n, url }] }
 *
 *  2. parseDocxQuestions(paras)
 *     把「洋葱题库」样式的纯文本解析成题目数组：
 *       题号.（题型）题干 → [图N] → A./B./C./D. 选项 → 答案：X → 解析：多行（可含 [图N]）
 *     返回 { list: [{ no, type, stem, options, answer, analysis, images }], skipped }
 */
const { ZipReader } = require('./mfzip');
const packagePath = require('path').posix;
const decodeXml = (text) => String(text).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (entity, value) => {
  const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  if (value[0] !== '#') return named[value] || entity;
  const code = /^#x/i.test(value) ? parseInt(value.slice(2), 16) : Number(value.slice(1));
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
});
function xmlAttributes(tag) {
  const attrs = Object.create(null);
  for (const attr of tag.matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/g)) attrs[attr[1]] = decodeXml(attr[3]);
  return attrs;
}

/** docx → 段落文本 + 插图占位 */
async function parseDocx(buffer, { saveImage } = {}) {
  const zr = new ZipReader(buffer);
  const docXml = zr.readOptional('word/document.xml');
  if (!docXml) throw new Error('不是有效的 .docx 文件（缺 word/document.xml）');
  // rId → 媒体路径
  const rels = Object.create(null);
  const relXml = zr.readOptional('word/_rels/document.xml.rels');
  if (relXml) {
    for (const match of relXml.toString('utf8').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = xmlAttributes(match[1]);
      if (!attrs.Id || !attrs.Target || attrs.TargetMode === 'External') continue;
      rels[attrs.Id] = packagePath.normalize(attrs.Target.startsWith('/') ? attrs.Target.slice(1) : 'word/' + attrs.Target);
    }
  }
  const figs = [];
  const paras = [];
  const xml = docXml.toString('utf8').replace(/<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/g, (_, content) => {
    // Word can store the same picture as a DrawingML choice plus a VML
    // fallback. Select one representation rather than importing it twice.
    const choices = [...content.matchAll(/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/g)];
    const picture = choices.find(choice => /<(?:a:blip|v:imagedata)\b/.test(choice[1]));
    const fallback = /<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/.exec(content);
    return picture ? picture[1] : fallback ? fallback[1] : choices.length ? choices[0][1] : content;
  });
  const pRe = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let pm;
  while ((pm = pRe.exec(xml))) {
    const p = pm[0];
    let line = '';
    const tRe = /<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/?>|<w:br\b[^>]*\/?>|<(?:a:blip|v:imagedata)\b[^>]*\/?>/g;
    let tm;
    while ((tm = tRe.exec(p))) {
      if (tm[0].indexOf('<w:tab') === 0) line += '\t';
      else if (tm[0].indexOf('<w:br') === 0) line += '\n';
      else if (/^<(?:a:blip|v:imagedata)\b/.test(tm[0])) {
        const attrs = xmlAttributes(tm[0]);
        // An embedded cache is authoritative even if r:link precedes it.
        const target = rels[attrs['r:embed'] || attrs['r:id'] || attrs['r:link']] || '';
        const buf = target ? zr.readOptional(target) : null;
        if (typeof saveImage === 'function') {
          const fname = String(target).split('/').pop() || `fig${figs.length + 1}.png`;
          const url = buf ? await saveImage(buf, fname) : '';
          // Keep failed slots and their references so upload callers can reject an
          // incomplete document instead of silently dropping/renumbering figures.
          figs.push({ n: figs.length + 1, url: url || '' });
          line += `[图${figs.length}]`;
        }
      } else if (tm[1] != null) {
        line += decodeXml(tm[1]);
      }
    }
    if (line.trim()) paras.push(line.trim());
  }
  return { paras, figs };
}

const RE_Q_STRICT = /^(\d{1,3})\s*[.、．]\s*[（(]\s*([^）)]{1,8})\s*[)）]\s*(.*)$/;   // 1.（单选题）xxx
const RE_Q_LOOSE = /^(\d{1,3})\s*[.、．]\s*(.+)$/;                                     // 1. xxx
const RE_OPT = /^([A-J])\s*[.、．、]\s*(.+)$/;                                        // A. xxx
const RE_ANS = /^(?:答案|正确答案|参考答案)\s*[:：]\s*(.*)$/;                          // 答案：C
const RE_ANA = /^(?:解析|点拨|【解析】|分析)\s*[:：]?\s*(.*)$/;                        // 解析：…

const TYPE_ALIAS = {
  '单选': 'single', '单选题': 'single', '选择': 'single', '选择题': 'single',
  '多选': 'multi', '多选题': 'multi', '多项选择': 'multi',
  '判断': 'judge', '判断题': 'judge',
  '填空': 'fill', '填空题': 'fill',
};

/** 解析出的题目 → 本系统 questions.type（student 判分链路共用 5+1 类） */
function pickType(hint, stem, options) {
  const h = TYPE_ALIAS[String(hint || '').trim()] || '';
  if (h === 'multi' && options.length >= 2) return 'multi';
  if (h === 'judge') return 'judge';
  if (options.length >= 2) {
    // ✓/× 之类的两项按判断题存
    const texts = options.map((o) => String(o.content || '').trim());
    if (texts.length === 2 && texts.every((t) => /^(\\checkmark|✓|√|×|x|X|对|错)$/.test(t))) return 'judge';
    return h === 'multi' ? 'multi' : 'single';
  }
  if (h === 'fill' || /_{2,}|□{2,}/.test(stem)) return 'fill';
  return 'answer';
}

/** 把段落文本解析成题目列表（容错：题号必须递增，避免解析里的 "1. xxx" 被误判成新题） */
function parseDocxQuestions(paras) {
  const strict = paras.some((p) => RE_Q_STRICT.test(p));
  const list = [];
  let cur = null;
  let mode = 'stem';       // stem | opt | ans | ana
  let lastNo = 0;
  let skipped = 0;

  const figRefs = (s) => [...String(s || '').matchAll(/\[图(\d+)\]/g)].map((m) => Number(m[1]));

  const push = () => {
    if (!cur) return;
    const stem = cur.stem.trim();
    if (!stem) { skipped++; return; }
    const type = pickType(cur.typeHint, stem, cur.options);
    // 插图归属：保留题干、选项、答案及解析引用；调用方核对保存结果并重映射成本题图号
    const refs = [...new Set([...figRefs(stem), ...cur.options.map((o) => figRefs(o.content)).flat(), ...figRefs(cur.analysis), ...figRefs(cur.answer)])]
      .filter((n) => n >= 1);
    list.push({
      no: cur.no, type,
      stem,
      ...(cur.difficulty_score_10 != null ? { difficulty_score_10: cur.difficulty_score_10 } : {}),
      options: cur.options,
      answer: cur.answer.trim(),
      analysis: cur.analysis.trim(),
      imgRefs: refs,
    });
  };

  // Mixed documents may omit a type hint on some questions. Only separate an
  // untyped candidate from a typed question's answer/analysis when there is
  // concrete question evidence; numbered explanation steps remain unchanged.
  const looksLikeQuestion = (index, no) => {
    // A later explicitly typed question with this same number takes priority
    // over any numbered step in the preceding explanation.
    for (let next = index + 1; next < paras.length; next++) {
      const typed = String(paras[next] || '').trim().match(RE_Q_STRICT);
      if (typed) { if (Number(typed[1]) === no) return false; break; }
    }
    // A question mark or blank can also occur in an explanation. Without
    // options or an answer, a new question in a mixed document needs its type hint.
    for (let next = index + 1; next < paras.length; next++) {
      const line = String(paras[next] || '').trim();
      if (!line) continue;
      if (RE_Q_LOOSE.test(line)) return false;
      if (RE_ANS.test(line) || RE_OPT.test(line)) return true;
    }
    return false;
  };
  for (let index = 0; index < paras.length; index++) {
    const line = String(paras[index] || '').trim();
    if (!line) continue;
    const typed = line.match(RE_Q_STRICT);
    const mq = typed || line.match(RE_Q_LOOSE);
    if (mq) {
      const no = Number(mq[1]);
      const expected = lastNo + 1;
      const head = typed ? (mq[2] || '').trim() : '';
      const stem = (mq[typed ? 3 : 2] || '').trim();
      const isStart = (no === expected || (!strict && no === 1 && list.length === 0))
        && (typed || !strict || !cur || looksLikeQuestion(index, no));
      if (isStart && no > lastNo) {
        push();
        cur = { no, typeHint: head, stem, options: [], answer: '', analysis: '', figsTotal: 0 };
        mode = 'stem';
        lastNo = no;
        continue;
      }
    }
    if (!cur) continue;   // 题头（标题/章节路径）直接跳过
    // 只识别明确声明十级制的独立字段，避免改变普通题干和旧版五星难度的含义。
    const md = line.match(/^(?:十级难度|难度\s*[（(]\s*1\s*[-–—~～]\s*10\s*[)）])\s*[:：]\s*(.*?)\s*$/);
    if (md) {
      if (cur.difficulty_score_10 != null) throw new Error(`第 ${cur.no} 题十级难度重复，请每题只填写一次`);
      if (!/^(?:10|[1-9])$/.test(md[1])) throw new Error(`第 ${cur.no} 题十级难度须为 1 至 10 的整数`);
      cur.difficulty_score_10 = Number(md[1]);
      continue;
    }
    const mo = line.match(RE_OPT);
    if (mo && mode !== 'ana') {
      cur.options.push({ label: mo[1], content: mo[2].trim() });
      mode = 'opt';
      continue;
    }
    const ma = line.match(RE_ANS);
    if (ma) { cur.answer = ma[1] || ''; mode = 'ans'; continue; }
    const mn = line.match(RE_ANA);
    if (mn) { cur.analysis = mn[1] || ''; mode = 'ana'; continue; }
    // 续行
    if (mode === 'stem') cur.stem += '\n' + line;
    else if (mode === 'opt' && cur.options.length) cur.options[cur.options.length - 1].content += '\n' + line;
    else if (mode === 'ans') cur.answer += '\n' + line;
    else if (mode === 'ana') cur.analysis += '\n' + line;
    else cur.stem += '\n' + line;
  }
  push();
  return { list, skipped };
}

module.exports = { parseDocx, parseDocxQuestions, pickType };
