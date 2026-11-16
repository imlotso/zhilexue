'use strict';
/**
 * 错题集 Word 导出（T9）：把一个学生的错题生成可编辑的 .docx。
 *
 * 版式沿用客户给的《错题集》样本（docs/原始需求/马英惠-数学…错题集.pdf）：
 *   封面（错题集 / 共 N 道错题 / 日期范围 / 姓名·科目·日期）
 *   → 「错题练习」：每题 日期 · [多次答错] · 题号 + 题干（含图片）· 选项 · 知识点
 *   → 「错题解析」：每题 日期 · 题号 · 答案 · 解析 · 答题记录（对错 + 当时的答案 + 时间）
 *   页脚：第 X 页 / 共 Y 页
 * 常见分式、根式和上下标转为可编辑 Word 公式；其他可识别的公式转为图片，无法安全渲染时保留原文。
 *
 * 两个入口共用：学生端 GET /api/stu/mistakes/export-docx、后台 GET /api/admin/bank/mistakes/export-docx。
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Footer, PageNumber, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, VerticalAlign,
  Math: DocxMath, MathRun, MathFraction, MathRadical, MathSuperScript, MathSubScript, MathSubSuperScript,
} = require('docx');
const pdfimg = require('./pdfimg');
const { formulaImage } = require('./formula-image');
const MatchQ = require('./match-question');
const QSubtype = require('../public/js/question-subtypes');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BODY_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体', cs: 'Times New Roman' };
const SANS_FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: '微软雅黑', cs: 'Arial' };
const MAX_IMG_W = 480;        // 内嵌图片最大宽度（像素，约 12.7cm）

const optText = (t) => (typeof t === 'string' ? t : (t && typeof t === 'object' ? String(t.text || t.content || '') : String(t == null ? '' : t)));
const dateOf = (s) => String(s || '').slice(0, 10);
const cnDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(s || ''); };

/** 作答 / 标准答案 → 人能看的文字（与学生端 quizAnswerDisplay 一致的口径） */
function answerText(q, ans) {
  const s = String(ans == null ? '' : ans).trim();
  if (!s) return '';
  const opts = (Array.isArray(q.options) ? q.options : []).map(optText);
  if (QSubtype.isMatch(q.question_subtype)) {
    const prompts = MatchQ.list(q.match_prompts);
    return s.split(/[,，]/).map((entry, i) => {
      const value = entry.trim();
      const n = /^[A-G]$/i.test(value) ? LETTERS.indexOf(value.toUpperCase()) : Number(value) - 1;
      const label = n >= 0 && n < opts.length ? `${LETTERS[n]}. ${opts[n]}` : value;
      return `${prompts[i] || `第 ${i + 1} 项`}：${label}`;
    }).join('；');
  }
  if (q.type === 'single' || q.type === 'multi') return s.split(/[,，]/).map((x) => x.trim()).filter(Boolean).join('、');
  if (q.type === 'fill') {
    const PH = '\u0001';
    return s.replace(/\|\|\|/g, PH).split('|').map((x) => x.split(PH).filter((y) => y !== '').join(' / ')).join('；');
  }
  if (q.type === 'sort') {
    return s.split(',').map((n) => { const i = Number(n) - 1; return i >= 0 && opts[i] ? opts[i] : n; }).join(' → ');
  }
  return s;
}

/** 读图片字节：/pu/xxx（手机扫码上传，落在 public/）优先读本地，其它走存储；读不到返回 null */
async function readImageBytes(src) {
  const s = String(src || '').trim();
  if (!s) return null;
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(s);
  if (m) return Buffer.from(m[1], 'base64');
  try {
    const store = require('./storage');
    const key = store.bankImageKey(s, require('./mfbank').bankFolder());
    if (key) return await store.readBuffer(key);
  } catch (_) { /* 沿用历史非题库图片读取方式 */ }
  try {
    const u = new URL(s, 'http://localhost');
    if (u.pathname === '/api/file') {
      const key = u.searchParams.get('key') || '';
      if (!key || key.startsWith('/') || key.split('/').includes('..')) return null;
      return await require('./storage').readBuffer(key);
    }
  } catch (e) { return null; }
  const rel = s.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;
  const local = path.join(__dirname, '..', 'public', rel);
  try { if (fs.existsSync(local)) return fs.readFileSync(local); } catch (e) { /* 继续走存储 */ }
  try { return await require('./storage').readBuffer(rel); } catch (e) { return null; }
}

/** 取出要导出的错题。opts: { subject, bucket: 'unresolved'|'all'|'resolved', days, from, to, ids } */
function collectMistakes(db, userId, opts = {}) {
  let where = ' WHERE m.user_id=?'; const args = [Number(userId)];
  if (opts.studentOnlyReviewed) {
    where += ' AND ' + require('./compose').studentQuestionScopeSql('q');
  } else if (Object.hasOwn(opts, 'questionUser')) {
    where += ' AND ' + require('./qmeta').questionScopeSql(opts.questionUser, 'q');
  }
  if (opts.subject) { where += ' AND q.subject=?'; args.push(String(opts.subject)); }
  const bucket = opts.bucket || 'unresolved';
  if (bucket === 'unresolved') where += ' AND m.resolved=0';
  else if (bucket === 'resolved') where += ' AND m.resolved=1';
  if (opts.from) { where += ' AND m.updated_at>=?'; args.push(String(opts.from).slice(0, 10) + ' 00:00:00'); }
  if (opts.to) { where += ' AND m.updated_at<=?'; args.push(String(opts.to).slice(0, 10) + ' 23:59:59'); }
  const ids = (Array.isArray(opts.ids) ? opts.ids : []).map(Number).filter(Boolean);
  if (ids.length) { where += ` AND m.question_id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  let rows = db.prepare(`SELECT m.question_id, m.wrong_count, m.last_answer, m.resolved, m.updated_at,
      q.type, q.question_subtype, q.match_prompts, q.stem, q.options, q.answer, q.analysis, q.material, q.subject, q.point, q.images
    FROM mistakes m JOIN questions q ON q.id=m.question_id${where}
    ORDER BY SUBSTR(m.updated_at,1,10) DESC, m.id DESC LIMIT 300`).all(...args).reverse();   // 取最近的 300 道，再按时间从早到晚排（打印出来按先后顺序看）
  const rec = db.prepare('SELECT my_answer, is_correct, created_at FROM records WHERE user_id=? AND question_id=? ORDER BY id DESC LIMIT 8');
  rows = rows.map((r) => {
    const j = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    const records = rec.all(Number(userId), r.question_id);
    // 只有一条"最后作答"、没有作答流水时（如手机扫码上传的纸质题），用 last_answer 补一条
    if (!records.length && r.last_answer) records.push({ my_answer: r.last_answer, is_correct: 0, created_at: r.updated_at });
    return { ...r, options: j(r.options), match_prompts: j(r.match_prompts), images: j(r.images), records };
  });
  return rows;
}

// ------------------------------------------------------------ 段落小工具
const T = (text, o = {}) => new TextRun(Object.assign({ text: String(text), font: BODY_FONT, size: 22 }, o));   // 11pt
// 不支持的命令明确保留原文，避免把未知语义转换成错误公式。
function latexMath(input) {
  const s = String(input); let i = 0;
  const symbols = {
    times:'×', div:'÷', cdot:'·', pm:'±', mp:'∓', le:'≤', leq:'≤', ge:'≥', geq:'≥', ne:'≠', neq:'≠', approx:'≈', sim:'∼', simeq:'≃', equiv:'≡',
    alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', varepsilon:'ε', zeta:'ζ', eta:'η', theta:'θ', vartheta:'ϑ', iota:'ι', kappa:'κ', lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', pi:'π', varpi:'ϖ', rho:'ρ', sigma:'σ', tau:'τ', upsilon:'υ', phi:'φ', varphi:'ϕ', chi:'χ', psi:'ψ', omega:'ω',
    Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ', Pi:'Π', Sigma:'Σ', Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
    infty:'∞', degree:'°', circ:'∘', angle:'∠', triangle:'△', parallel:'∥', perp:'⊥', therefore:'∴', because:'∵',
    in:'∈', notin:'∉', subset:'⊂', subseteq:'⊆', cup:'∪', cap:'∩', emptyset:'∅', forall:'∀', exists:'∃',
    to:'→', rightarrow:'→', leftarrow:'←', leftrightarrow:'↔', Rightarrow:'⇒', Leftarrow:'⇐', Leftrightarrow:'⇔',
    sum:'∑', prod:'∏', int:'∫', partial:'∂', nabla:'∇', ell:'ℓ', ldots:'…', cdots:'⋯', vdots:'⋮', ddots:'⋱',
  };
  const functions = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'gcd']);
  const group = () => {
    while (s[i] === ' ') i++;
    if (s[i] === '{') { i++; const nodes = seq('}'); if (s[i] !== '}' || !nodes.length) throw Error('invalid group'); i++; return nodes; }
    return [atom()];
  };
  const atom = () => {
    const c = s[i++]; if (!c) throw Error('missing token');
    if (c === '{') { const nodes=seq('}'); if(s[i]!=='}' || !nodes.length)throw Error('invalid group');i++;return nodes; }
    if (c === '}' || c === '^' || c === '_') throw Error('unexpected token');
    if (c !== '\\') return new MathRun(c);
    const m = /^[A-Za-z]+/.exec(s.slice(i));
    const command = m ? m[0] : s[i++]; if(m)i+=m[0].length;
    if (['frac','dfrac','tfrac'].includes(command)) return new MathFraction({ numerator:group(), denominator:group() });
    if (command === 'sqrt') {
      while (s[i] === ' ') i++;
      let degree;
      if (s[i] === '[') { i++; degree = seq(']'); if (s[i] !== ']' || !degree.length) throw Error('invalid root degree'); i++; }
      return new MathRadical({ children:group(), ...(degree ? { degree } : {}) });
    }
    if (['left','right'].includes(command)) {
      while (s[i] === ' ') i++;
      if (s[i] === '.') { i++; return []; } // TeX 的空定界符不应显示为点
      return atom();
    }
    if (['mathrm','mathbf','mathit','text','operatorname'].includes(command)) return group();
    if (symbols[command]) return new MathRun(symbols[command]);
    if (functions.has(command)) return new MathRun(command);
    if (['{','}','%','_',' ', ',', ';', '!'].includes(command)) return new MathRun(command === ',' || command === ';' || command === '!' ? ' ' : command);
    throw Error('unsupported command');
  };
  const seq = (stop) => {
    const out=[];
    while(i<s.length && (!stop || s[i]!==stop)) {
      let base=atom(); if(!Array.isArray(base))base=[base]; let sub, sup;
      while(s[i]==='_' || s[i]==='^') { const k=s[i++], v=group(); if(k==='_') { if(sub)throw Error('duplicate subscript');sub=v; } else { if(sup)throw Error('duplicate superscript');sup=v; } }
      if(sub && sup)out.push(new MathSubSuperScript({children:base,subScript:sub,superScript:sup}));
      else if(sub)out.push(new MathSubScript({children:base,subScript:sub}));
      else if(sup)out.push(new MathSuperScript({children:base,superScript:sup}));
      else out.push(...base);
    }
    return out;
  };
  const children=seq(''); if(i!==s.length || !children.length)throw Error('invalid formula');
  return new DocxMath({children});
}
const lines = (text, o = {}) => {
  const source=String(text == null ? '' : text).replace(/\r/g, '');
  const re=/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<!\\)\$([^$\n]+)\$/g;
  const out=[]; let pos=0, m;
  const appendText=(v)=>v.split('\n').forEach((part,n)=>out.push(new TextRun(Object.assign({text:part,font:BODY_FONT,size:22,break:n?1:0},o))));
  while((m=re.exec(source))) {
    appendText(source.slice(pos,m.index));
    const latex = m[1] || m[2] || m[3];
    try { out.push(latexMath(latex)); }
    catch (_) {
      const rendered = formulaImage(latex);
      if (rendered) out.push(new ImageRun({ data: rendered.png, transformation: { width: rendered.width, height: rendered.height }, altText: { name: '数学公式', title: '公式', description: latex.slice(0, 240) } }));
      else appendText(m[0]);
    }
    pos=re.lastIndex;
  }
  appendText(source.slice(pos));
  return out;
};
const P = (children, o = {}) => new Paragraph(Object.assign({ children, alignment: AlignmentType.LEFT, spacing: { after: 80, line: 340 } }, o));
const NOBORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NOBORDERS = { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER };

/** 连线/听力匹配：左右项目必须同时出现在学生版和教师版，答案另行展示。 */
async function matchQuestionBlocks(q) {
  if (!QSubtype.isMatch(q.question_subtype)) return [];
  const prompts = MatchQ.list(q.match_prompts);
  const opts = Array.isArray(q.options) ? q.options : (() => { try { return JSON.parse(q.options || '[]'); } catch (_) { return []; } })();
  if (!prompts.length || !Array.isArray(opts) || !opts.length) return [];
  let images = q.images || [];
  if (typeof images === 'string') { try { images = JSON.parse(images); } catch (_) { images = []; } }
  const cell = async (text) => {
    const children = [];
    for (const part of text.split(/(\[图\d+\])/g)) {
      const m = /^\[图(\d+)\]$/.exec(part);
      if (m && images[Number(m[1]) - 1]) children.push(await imageParagraph(images[Number(m[1]) - 1]));
      else if (part) children.push(new Paragraph({ children: lines(part), spacing: { after: 80, line: 320 } }));
    }
    if (!children.length) children.push(P([T('')]));
    return new TableCell({ borders: NOBORDERS, width: { size: 50, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.TOP, children });
  };
  const rows = [];
  for (let i = 0; i < Math.max(prompts.length, opts.length); i++) rows.push(new TableRow({ cantSplit: true, children: [
    await cell(prompts[i] ? `${i + 1}. ${prompts[i]}` : ''),
    await cell(opts[i] != null ? `${LETTERS[i]}. ${optText(opts[i])}` : ''),
  ] }));
  return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER, insideHorizontal: NOBORDER, insideVertical: NOBORDER } })];
}

function band(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.CLEAR, fill: 'EEEEEE', color: 'auto' },
    spacing: { before: 120, after: 200, line: 400 },
    children: [new TextRun({ text, bold: true, size: 36, font: SANS_FONT })],
  });
}

/** 一张图 → 段落（读不到 / 格式不支持时给一句提示，不让整份导出失败） */
async function imageParagraph(src) {
  const buf = await readImageBytes(src);
  if (!buf) return P([T('[图片读取失败]', { color: '999999', size: 18 })]);
  let info;
  try { info = pdfimg.imageInfo(buf); } catch (e) { return P([T('[图片格式 Word 导出暂不支持，请在学习机上查看原图]', { color: '999999', size: 18 })]); }
  const w = Math.min(MAX_IMG_W, info.width);
  const h = Math.max(1, Math.round(info.height * (w / info.width)));
  const run = new ImageRun({ data: buf, transformation: { width: w, height: h } });
  // docx@8 把所有图片都命名成 .png；JPEG 字节挂 .png 名字 Word 也能开，但改成真实扩展名更稳
  if (info.type === 'jpg' && run.imageData && /\.png$/.test(run.imageData.fileName)) run.imageData.fileName = run.imageData.fileName.replace(/\.png$/, '.jpg');
  return new Paragraph({ children: [run], spacing: { before: 60, after: 100 }, keepNext: true });
}

/** 带 [图N] 的文字按原位置放入题图，避免选项图跑到题干末尾。 */
async function imageTextBlocks(text, images, prefix = [], opts = {}) {
  const out = []; let current = prefix.slice();
  for (const part of String(text || '').split(/(\[图\d+\])/g)) {
    const m = /^\[图(\d+)\]$/.exec(part), src = m && images[Number(m[1]) - 1];
    if (src) { if (current.length) out.push(P(current, opts)); current = []; out.push(await imageParagraph(src)); }
    else current.push(...lines(part));
  }
  if (current.length) out.push(P(current, opts));
  return out;
}

/** 明确引用的答案、解析图片不得作为未定位的旧题图片提前附到题面。 */
function imageRefs(...texts) {
  const refs = new Set();
  for (const text of texts) for (const m of String(text || '').matchAll(/\[图(\d+)\]/g)) refs.add(Number(m[1]) - 1);
  return refs;
}

/** 选项：都很短 → 两列表格（和样本一致）；否则一行一个 */
async function optionBlocks(q) {
  const match = await matchQuestionBlocks(q);
  if (match.length) return match;
  const opts = (q.options || []).map(optText);
  if (!opts.length || q.type === 'fill' || q.type === 'sort' || q.type === 'judge') return [];
  const items = opts.map((t, i) => `${LETTERS[i]}. ${t}`);
  if (items.some(s => /\[图\d+\]/.test(s))) {
    const blocks = [];
    for (const item of items) blocks.push(...await imageTextBlocks(item, q.images || [], [], { indent: { left: 360 }, keepLines: true }));
    return blocks;
  }
  const short = items.every((s) => s.length <= 22 && !/\n/.test(s));
  if (!short) return items.map((s) => P(lines(s), { indent: { left: 360 }, keepLines: true }));
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const cell = (s) => new TableCell({
      borders: NOBORDERS, width: { size: 50, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.TOP,
      children: [new Paragraph({ children: s ? lines(s) : [T('')], spacing: { after: 40, line: 320 } })],
    });
    rows.push(new TableRow({ cantSplit: true, children: [cell(items[i]), cell(items[i + 1] || '')] }));
  }
  return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER, insideHorizontal: NOBORDER, insideVertical: NOBORDER } })];
}

/**
 * 生成 docx。
 * @param {{student:{name:string}, subject:string, items:Array, generatedAt?:string, from?:string, to?:string, title?:string}} p
 * @returns {Promise<Buffer>}
 */
async function buildMistakeDocx({ student, subject, items, generatedAt, from, to, title, includeAnswers = true }) {
  const list = Array.isArray(items) ? items : [];
  const dates = list.map((m) => dateOf(m.updated_at)).filter(Boolean).sort();
  const d0 = from ? dateOf(from) : (dates[0] || dateOf(generatedAt));
  const d1 = to ? dateOf(to) : (dates[dates.length - 1] || dateOf(generatedAt));
  const today = dateOf(generatedAt) || new Date().toISOString().slice(0, 10);
  const children = [];

  // ---- 封面
  children.push(new Paragraph({ spacing: { before: 2600, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title || '错题集', bold: true, size: 64, font: SANS_FONT })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: `共${list.length}道错题`, size: 28, font: SANS_FONT, color: '555555' })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1400 }, children: [new TextRun({ text: `${cnDate(d0)} - ${cnDate(d1)}`, size: 26, font: SANS_FONT, color: '555555' })] }));
  const meta = [['姓名', (student && (student.name || student.username)) || ''], ['科目', subject || '全部科目'], ['日期', cnDate(today)]];
  meta.forEach(([k, v]) => children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: `${k}：${v}`, size: 28, font: SANS_FONT })] })));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---- 错题练习
  children.push(band('错题练习'));
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    children.push(P([T(dateOf(m.updated_at), { bold: true, size: 26, font: SANS_FONT })], { keepNext: true, spacing: { before: 200, after: 60 } }));
    if (Number(m.wrong_count) >= 2) children.push(P([T('⚑ 多次答错', { bold: true, size: 18, color: 'D93025', font: SANS_FONT })], { keepNext: true, spacing: { after: 40 } }));
    const images = Array.isArray(m.images) ? m.images : [];
    if (m.material) children.push(...await imageTextBlocks(m.material, images, [], { keepNext: true, indent: { left: 240 } }));
    children.push(...await imageTextBlocks(m.stem, images, [T(`${i + 1}. `, { bold: true })], { keepNext: true, keepLines: true }));
    const referenced = [m.material, m.stem, ...MatchQ.list(m.match_prompts), ...(m.options || []).map(optText)].join(' ');
    const used = imageRefs(referenced);
    const answerRefs = imageRefs(m.answer, m.analysis);
    (await optionBlocks(m)).forEach((b) => children.push(b));
    for (const [j, src] of images.entries()) if (src && !used.has(j) && !answerRefs.has(j)) children.push(await imageParagraph(src));
    if (m.point) children.push(P([T('知识点： ', { bold: true, font: SANS_FONT, size: 20 }), T(m.point, { size: 20 })], { spacing: { before: 80, after: 160 } }));
    else children.push(P([T('')], { spacing: { after: 120 } }));
  }
  if (!list.length) children.push(P([T('（没有符合条件的错题）', { color: '999999' })], { alignment: AlignmentType.CENTER }));
  // 仅题目模式不包含答案、解析或作答记录。
  if (includeAnswers) {
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---- 错题解析
  children.push(band('错题解析'));
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    children.push(P([T(dateOf(m.updated_at), { bold: true, size: 26, font: SANS_FONT })], { keepNext: true, spacing: { before: 200, after: 60 } }));
    if (Number(m.wrong_count) >= 2) children.push(P([T('⚑ 多次答错', { bold: true, size: 18, color: 'D93025', font: SANS_FONT })], { keepNext: true, spacing: { after: 40 } }));
    children.push(P([T(`${i + 1}.`, { bold: true })], { keepNext: true }));
    const images = Array.isArray(m.images) ? m.images : [];
    children.push(...await imageTextBlocks(answerText(m, m.answer) || '（暂无）', images, [T('答案：', { bold: true, font: SANS_FONT, size: 20 })], { keepNext: true }));
    children.push(...await imageTextBlocks(m.analysis || '（暂无解析）', images, [T('解析：', { bold: true, font: SANS_FONT, size: 20 })], { keepLines: false }));
    const recs = m.records || [];
    if (recs.length) {
      children.push(P([T('答题记录：', { bold: true, font: SANS_FONT, size: 20 })], { keepNext: true, spacing: { before: 60, after: 20 } }));
      recs.forEach((r) => {
        const ok = Number(r.is_correct) === 1;
        children.push(P([
          T(ok ? '✓ ' : '✗ ', { bold: true, color: ok ? '1E8E3E' : 'D93025' }),
          T(`${answerText(m, r.my_answer) || '（未作答）'}　`),
          T(String(r.created_at || '').slice(0, 16), { color: '777777', size: 20 }),
        ], { indent: { left: 360 }, spacing: { after: 20, line: 300 } }));
      });
    }
    children.push(P([T('')], { spacing: { after: 100 } }));
  }
  if (!list.length) children.push(P([T('（没有符合条件的错题）', { color: '999999' })], { alignment: AlignmentType.CENTER }));

  }

  const doc = new Document({
    creator: '智学课堂', title: `${(student && student.name) || ''}${subject || ''}错题集`.trim() || '错题集',
    // Prevent Word/WPS from stretching Chinese soft-return lines under inherited justification.
    compatibility: { doNotExpandShiftReturn: true },
    styles: { default: { document: { run: { font: BODY_FONT, size: 22 }, paragraph: { alignment: AlignmentType.LEFT } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'], size: 18, color: '777777', font: SANS_FONT })],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const nowStr = () => { const d = new Date(); return `${ymd(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

/**
 * 两个入口共用：把查询参数翻译成筛选条件 → 取错题 → 生成 docx → 作为附件发送。
 * query: subject / bucket(unresolved|all|resolved，默认 unresolved) / days(最近 N 天) / from / to / ids(逗号分隔)
 */
async function sendMistakeDocx(db, res, student, query = {}, access = {}) {
  const q = query || {};
  const opts = { studentOnlyReviewed: access.studentOnlyReviewed === true, subject: String(q.subject || '').trim(), bucket: ['all', 'resolved', 'unresolved'].includes(q.bucket) ? q.bucket : 'unresolved' };
  // Scope is supplied only by the authenticated route, never by query parameters.
  if (Object.hasOwn(access, 'questionUser')) opts.questionUser = access.questionUser;
  const days = Math.max(0, Math.min(3650, parseInt(q.days, 10) || 0));
  if (days) { const d = new Date(); d.setDate(d.getDate() - days + 1); opts.from = ymd(d); }
  if (/^\d{4}-\d{2}-\d{2}/.test(String(q.from || ''))) opts.from = String(q.from).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(String(q.to || ''))) opts.to = String(q.to).slice(0, 10);
  if (q.ids) opts.ids = String(q.ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 300);
  const items = collectMistakes(db, student.id, opts);
  if (!items.length) { res.status(200).json({ code: 1, msg: '没有符合条件的错题可以导出' }); return; }
  const buf = await buildMistakeDocx({ student, subject: opts.subject, items, generatedAt: nowStr(), from: opts.from, to: opts.to, includeAnswers: q.include_answers !== '0' });
  if (opts.questionUser && opts.questionUser.role === 'branch' &&
      !db.prepare("SELECT id FROM users WHERE id=? AND role='student' AND created_by=?").get(student.id, opts.questionUser.id)) {
    res.status(403).json({ code: 403, msg: '学生归属已变化，请重新导出' });
    return;
  }
  // Rendering may await image reads. Revalidate the exact rendered questions
  // before sending bytes, rather than silently replacing the checked item list.
  if ((opts.studentOnlyReviewed || Object.hasOwn(opts, 'questionUser')) &&
      !require('./qmeta').questionsAllowed(db, opts.studentOnlyReviewed ? null : opts.questionUser, items.map(item => item.question_id))) {
    res.status(403).json({ code: 403, msg: '题目审核状态或访问权限已变化，请重新导出' });
    return;
  }
  if (opts.studentOnlyReviewed && !require('./compose').studentQuestionsAllowed(db, items.map(item => item.question_id))) {
    res.status(403).json({ code: 403, msg: '题目适用学段已变化，请重新导出' });
    return;
  }
  const fname = `${(student.name || student.username || '学生')}-${opts.subject || '全部科目'}-错题集.docx`.replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="mistakes.docx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.setHeader('Content-Length', buf.length);
  res.setHeader('X-Mistake-Count', String(items.length));
  res.end(buf);
}

module.exports = { buildMistakeDocx, collectMistakes, answerText, readImageBytes, sendMistakeDocx, lines, imageParagraph, imageTextBlocks, imageRefs, matchQuestionBlocks };
