'use strict';
/**
 * 错题集 Word 导出（T9）：把一个学生的错题生成可编辑的 .docx。
 *
 * 版式沿用客户给的《错题集》样本（docs/原始需求/马英惠-数学…错题集.pdf）：
 *   封面（错题集 / 共 N 道错题 / 日期范围 / 姓名·科目·日期）
 *   → 「错题练习」：每题 日期 · [多次答错] · 题号 + 题干（含图片）· 选项 · 知识点
 *   → 「错题解析」：每题 日期 · 题号 · 答案 · 解析 · 答题记录（对错 + 当时的答案 + 时间）
 *   页脚：第 X 页 / 共 Y 页
 * 公式按 LaTeX 文本原样写入（不转 OMML）。图片从本地 public/ 或存储读取字节后内嵌（只支持 JPEG / PNG，其它格式在原位置留一句提示）。
 *
 * 两个入口共用：学生端 GET /api/stu/mistakes/export-docx、后台 GET /api/admin/bank/mistakes/export-docx。
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Footer, PageNumber, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, VerticalAlign,
} = require('docx');
const pdfimg = require('./pdfimg');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BODY_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体', cs: 'Times New Roman' };
const SANS_FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: '微软雅黑', cs: 'Arial' };
const MAX_IMG_W = 480;        // 内嵌图片最大宽度（像素，约 12.7cm）
const MAX_IMGS_PER_Q = 4;

const optText = (t) => (typeof t === 'string' ? t : (t && typeof t === 'object' ? String(t.text || t.content || '') : String(t == null ? '' : t)));
const dateOf = (s) => String(s || '').slice(0, 10);
const cnDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(s || ''); };

/** 作答 / 标准答案 → 人能看的文字（与学生端 quizAnswerDisplay 一致的口径） */
function answerText(q, ans) {
  const s = String(ans == null ? '' : ans).trim();
  if (!s) return '';
  const opts = (Array.isArray(q.options) ? q.options : []).map(optText);
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
  const rel = s.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;
  const local = path.join(__dirname, '..', 'public', rel);
  try { if (fs.existsSync(local)) return fs.readFileSync(local); } catch (e) { /* 继续走存储 */ }
  try { return await require('./storage').readBuffer(rel); } catch (e) { return null; }
}

/** 取出要导出的错题。opts: { subject, bucket: 'unresolved'|'all'|'resolved', days, from, to, ids } */
function collectMistakes(db, userId, opts = {}) {
  let where = ' WHERE m.user_id=?'; const args = [Number(userId)];
  if (opts.subject) { where += ' AND q.subject=?'; args.push(String(opts.subject)); }
  const bucket = opts.bucket || 'unresolved';
  if (bucket === 'unresolved') where += ' AND m.resolved=0';
  else if (bucket === 'resolved') where += ' AND m.resolved=1';
  if (opts.from) { where += ' AND m.updated_at>=?'; args.push(String(opts.from).slice(0, 10) + ' 00:00:00'); }
  if (opts.to) { where += ' AND m.updated_at<=?'; args.push(String(opts.to).slice(0, 10) + ' 23:59:59'); }
  const ids = (Array.isArray(opts.ids) ? opts.ids : []).map(Number).filter(Boolean);
  if (ids.length) { where += ` AND m.question_id IN (${ids.map(() => '?').join(',')})`; args.push(...ids); }
  let rows = db.prepare(`SELECT m.question_id, m.wrong_count, m.last_answer, m.resolved, m.updated_at,
      q.type, q.stem, q.options, q.answer, q.analysis, q.material, q.subject, q.point, q.images
    FROM mistakes m JOIN questions q ON q.id=m.question_id${where}
    ORDER BY SUBSTR(m.updated_at,1,10) DESC, m.id DESC LIMIT 300`).all(...args).reverse();   // 取最近的 300 道，再按时间从早到晚排（打印出来按先后顺序看）
  const rec = db.prepare('SELECT my_answer, is_correct, created_at FROM records WHERE user_id=? AND question_id=? ORDER BY id DESC LIMIT 8');
  rows = rows.map((r) => {
    const j = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    const records = rec.all(Number(userId), r.question_id);
    // 只有一条"最后作答"、没有作答流水时（如手机扫码上传的纸质题），用 last_answer 补一条
    if (!records.length && r.last_answer) records.push({ my_answer: r.last_answer, is_correct: 0, created_at: r.updated_at });
    return { ...r, options: j(r.options), images: j(r.images), records };
  });
  return rows;
}

// ------------------------------------------------------------ 段落小工具
const T = (text, o = {}) => new TextRun(Object.assign({ text: String(text), font: BODY_FONT, size: 22 }, o));   // 11pt
const lines = (text, o = {}) => {
  // 多行文字：换行写成 Word 的软回车，保持在同一段里
  const parts = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  return parts.map((p, i) => new TextRun(Object.assign({ text: p, font: BODY_FONT, size: 22, break: i ? 1 : 0 }, o)));
};
const P = (children, o = {}) => new Paragraph(Object.assign({ children, spacing: { after: 80, line: 340 } }, o));
const NOBORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NOBORDERS = { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER };

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

/** 选项：都很短 → 两列表格（和样本一致）；否则一行一个 */
function optionBlocks(q) {
  const opts = (q.options || []).map(optText);
  if (!opts.length || q.type === 'fill' || q.type === 'sort' || q.type === 'judge') return [];
  const items = opts.map((t, i) => `${LETTERS[i]}. ${t}`);
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
async function buildMistakeDocx({ student, subject, items, generatedAt, from, to, title }) {
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
    if (m.material) children.push(P(lines(m.material, { color: '444444', size: 20 }), { keepNext: true, indent: { left: 240 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 6 } } }));
    children.push(P([T(`${i + 1}. `, { bold: true }), ...lines(m.stem)], { keepNext: true, keepLines: true }));
    for (const src of (m.images || []).slice(0, MAX_IMGS_PER_Q)) children.push(await imageParagraph(src));
    optionBlocks(m).forEach((b) => children.push(b));
    if (m.point) children.push(P([T('知识点： ', { bold: true, font: SANS_FONT, size: 20 }), T(m.point, { size: 20 })], { spacing: { before: 80, after: 160 } }));
    else children.push(P([T('')], { spacing: { after: 120 } }));
  }
  if (!list.length) children.push(P([T('（没有符合条件的错题）', { color: '999999' })], { alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---- 错题解析
  children.push(band('错题解析'));
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    children.push(P([T(dateOf(m.updated_at), { bold: true, size: 26, font: SANS_FONT })], { keepNext: true, spacing: { before: 200, after: 60 } }));
    if (Number(m.wrong_count) >= 2) children.push(P([T('⚑ 多次答错', { bold: true, size: 18, color: 'D93025', font: SANS_FONT })], { keepNext: true, spacing: { after: 40 } }));
    children.push(P([T(`${i + 1}.`, { bold: true })], { keepNext: true }));
    children.push(P([T('答案：', { bold: true, font: SANS_FONT, size: 20 }), ...lines(answerText(m, m.answer) || '（暂无）')], { keepNext: true }));
    children.push(P([T('解析：', { bold: true, font: SANS_FONT, size: 20 }), ...lines(m.analysis || '（暂无解析）')], { keepLines: false }));
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

  const doc = new Document({
    creator: '智学课堂', title: `${(student && student.name) || ''}${subject || ''}错题集`.trim() || '错题集',
    styles: { default: { document: { run: { font: BODY_FONT, size: 22 } } } },
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
async function sendMistakeDocx(db, res, student, query = {}) {
  const q = query || {};
  const opts = { subject: String(q.subject || '').trim(), bucket: ['all', 'resolved', 'unresolved'].includes(q.bucket) ? q.bucket : 'unresolved' };
  const days = Math.max(0, Math.min(3650, parseInt(q.days, 10) || 0));
  if (days) { const d = new Date(); d.setDate(d.getDate() - days + 1); opts.from = ymd(d); }
  if (/^\d{4}-\d{2}-\d{2}/.test(String(q.from || ''))) opts.from = String(q.from).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(String(q.to || ''))) opts.to = String(q.to).slice(0, 10);
  if (q.ids) opts.ids = String(q.ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 300);
  const items = collectMistakes(db, student.id, opts);
  if (!items.length) { res.status(200).json({ code: 1, msg: '没有符合条件的错题可以导出' }); return; }
  const buf = await buildMistakeDocx({ student, subject: opts.subject, items, generatedAt: nowStr(), from: opts.from, to: opts.to });
  const fname = `${(student.name || student.username || '学生')}-${opts.subject || '全部科目'}-错题集.docx`.replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="mistakes.docx"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.setHeader('Content-Length', buf.length);
  res.setHeader('X-Mistake-Count', String(items.length));
  res.end(buf);
}

module.exports = { buildMistakeDocx, collectMistakes, answerText, readImageBytes, sendMistakeDocx };
