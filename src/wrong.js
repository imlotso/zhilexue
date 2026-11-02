'use strict';
/**
 * AI错题重组模块（管理端）
 *
 * 业务流程：扫描/上传试卷照片 → 前端自动切题并人工微调 → 题目图片入库（wrong_items）
 *          → 勾选题目 → 按 1/2 栏排版生成错题集 PDF（wrong_sets）→ 在线预览 / 下载 / 打印
 *
 * 设计取舍：
 *  - 不做 OCR：题目以「图片」形式保存，离线可用、无外部服务费用、不依赖服务器算力；
 *  - PDF 由自研极简生成器输出（见 pdfimg.js），无第三方依赖；
 *  - 图片与 PDF 统一放 wrong/ 目录，storage.js 保证该目录始终留在服务器本地。
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { db } = require('./db');
const store = require('./storage');
const pdfimg = require('./pdfimg');
const ai = require('./ai');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const A4 = [595.28, 841.89]; // A4（pt）

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败') => res.json({ code: 1, msg });

/** 读取文件字节：优先本地；若被配置成云端存储（如 QINIU_FOLDERS=*），回退为下载 */
async function readBytes(key) {
  const abs = store.localPath(key);
  if (fs.existsSync(abs)) return fs.readFileSync(abs);
  const url = await store.getUrl(key);
  const r = await fetch(url);
  if (!r.ok) throw new Error('读取图片失败：' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/** base64 / dataURL → Buffer（用于页眉横幅图片） */
function dataUrlBuffer(s) {
  if (!s) return null;
  const m = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/i.exec(String(s).trim());
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new Error('页眉图片过大');
  return buf;
}

// ------------------------------------------------------------------ 批次
router.get('/batches', (req, res) => {
  const rows = db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM wrong_items i WHERE i.batch_id=b.id) AS items,
      (SELECT COUNT(*) FROM wrong_items i WHERE i.batch_id=b.id AND i.selected=1) AS selected
    FROM wrong_batches b ORDER BY b.id DESC LIMIT 200`).all();
  ok(res, rows);
});

router.post('/batches', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim() || '扫描 ' + now().slice(0, 16);
  const info = db.prepare('INSERT INTO wrong_batches (title,subject,grade,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(title, String(b.subject || ''), String(b.grade || ''), req.user ? req.user.id : null, now());
  ok(res, { id: info.lastInsertRowid, title }, '批次已创建');
});

router.put('/batches/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM wrong_batches WHERE id=?').get(Number(req.params.id));
  if (!row) return fail(res, '批次不存在');
  const b = req.body || {};
  db.prepare('UPDATE wrong_batches SET title=?, subject=?, grade=? WHERE id=?').run(
    b.title === undefined ? row.title : String(b.title).trim() || row.title,
    b.subject === undefined ? row.subject : String(b.subject),
    b.grade === undefined ? row.grade : String(b.grade),
    row.id
  );
  ok(res, null, '已保存');
});

router.delete('/batches/:id', async (req, res) => {
  const id = Number(req.params.id);
  const items = db.prepare('SELECT * FROM wrong_items WHERE batch_id=?').all(id);
  for (const it of items) await store.deleteFile(it.file_path);
  db.prepare('DELETE FROM wrong_items WHERE batch_id=?').run(id);
  db.prepare('DELETE FROM wrong_batches WHERE id=?').run(id);
  ok(res, { removed: items.length }, '批次已删除');
});

// ------------------------------------------------------------------ 题目（切题结果）
/** 上传切好的题目图片（可一次多张，每个文件 = 一道题） */
router.post('/items', upload.array('images', 60), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return fail(res, '请选择题目图片');
  let batchId = Number((req.body || {}).batch_id) || 0;
  if (!batchId) {
    const info = db.prepare('INSERT INTO wrong_batches (title,subject,grade,created_by,created_at) VALUES (?,?,?,?,?)')
      .run('扫描 ' + now().slice(0, 16), '', '', req.user ? req.user.id : null, now());
    batchId = info.lastInsertRowid;
  }
  const batch = db.prepare('SELECT * FROM wrong_batches WHERE id=?').get(batchId);
  if (!batch) return fail(res, '批次不存在');

  const ins = db.prepare('INSERT INTO wrong_items (batch_id,seq,file_path,file_name,w,h,size,selected,created_at) VALUES (?,?,?,?,?,?,?,1,?)');
  const base = db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM wrong_items WHERE batch_id=?').get(batchId).m;
  const made = [];
  let seq = base;
  for (const f of files) {
    let info2;
    try { info2 = pdfimg.imageInfo(f.buffer); } catch (e) { return fail(res, '第 ' + (made.length + 1) + ' 张图片格式不支持：' + e.message); }
    const saved = await store.saveFile(f.buffer, 'q' + Date.now() + (info2.type === 'png' ? '.png' : '.jpg'), 'wrong');
    const r = ins.run(batchId, ++seq, saved.key, f.originalname || '', info2.width, info2.height, saved.size, now());
    made.push({ id: r.lastInsertRowid, batch_id: batchId, seq, key: saved.key, w: info2.width, h: info2.height, selected: 1 });
  }
  ok(res, { batch_id: batchId, items: made }, `已入库 ${made.length} 道题`);
});

/** 题目列表：可按批次 / 勾选状态 / 关键字（按 id 区间）过滤 */
router.get('/items', (req, res) => {
  const { batch_id = '', selected = '', limit = '200', offset = '0' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (batch_id) { where += ' AND i.batch_id=?'; args.push(Number(batch_id)); }
  if (selected === '0' || selected === '1') { where += ' AND i.selected=?'; args.push(Number(selected)); }
  const total = db.prepare('SELECT COUNT(*) AS n FROM wrong_items i' + where).get(...args).n;
  const rows = db.prepare(`SELECT i.*, b.title AS batch_title, b.subject AS batch_subject
    FROM wrong_items i LEFT JOIN wrong_batches b ON b.id=i.batch_id
    ${where} ORDER BY i.batch_id DESC, i.seq, i.id LIMIT ? OFFSET ?`)
    .all(...args, Math.min(500, Number(limit) || 200), Number(offset) || 0);
  ok(res, { total, rows });
});

router.patch('/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM wrong_items WHERE id=?').get(Number(req.params.id));
  if (!row) return fail(res, '题目不存在');
  const b = req.body || {};
  const sel = b.selected === undefined ? row.selected : (Number(b.selected) ? 1 : 0);
  const seq = b.seq === undefined ? row.seq : Number(b.seq) || 0;
  db.prepare('UPDATE wrong_items SET selected=?, seq=? WHERE id=?').run(sel, seq, row.id);
  ok(res, { id: row.id, selected: sel, seq });
});

/** 批量勾选 / 取消：{ ids:[], selected:1|0 } 或 { batch_id, selected } */
router.post('/items/select', (req, res) => {
  const b = req.body || {};
  const sel = Number(b.selected) ? 1 : 0;
  if (Array.isArray(b.ids) && b.ids.length) {
    const st = db.prepare('UPDATE wrong_items SET selected=? WHERE id=?');
    const tx = db.transaction((ids) => ids.forEach((id) => st.run(sel, Number(id))));
    tx(b.ids);
    return ok(res, { count: b.ids.length }, sel ? '已勾选' : '已取消勾选');
  }
  if (b.batch_id) {
    const r = db.prepare('UPDATE wrong_items SET selected=? WHERE batch_id=?').run(sel, Number(b.batch_id));
    return ok(res, { count: r.changes }, sel ? '已勾选' : '已取消勾选');
  }
  return fail(res, '缺少参数');
});

router.delete('/items/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM wrong_items WHERE id=?').get(Number(req.params.id));
  if (row) { await store.deleteFile(row.file_path); db.prepare('DELETE FROM wrong_items WHERE id=?').run(row.id); }
  ok(res, null, '已删除');
});

// ------------------------------------------------------------------ 排版生成错题集
/**
 * @param {Array} items [{buf, w, h}] 已解码的题目图片（按输出顺序）
 * @param {Object} opt   {columns, showIndex, lineGap, banner:{buf,w,h}}
 * @returns {{pages:Array, pageCount:number}}
 */
function layout(items, opt) {
  const columns = Math.max(1, Math.min(3, Number(opt.columns) || 2));
  const showIndex = opt.showIndex === undefined ? 1 : Number(opt.showIndex) ? 1 : 0;
  // 注意 Number(undefined) 是 NaN，必须先判空，否则 lineGap 变 NaN 会让分页判断整体失效
  const rawGap = opt.lineGap === undefined || opt.lineGap === null || opt.lineGap === '' ? 10 : Number(opt.lineGap);
  const lineGap = Number.isFinite(rawGap) ? Math.max(0, Math.min(40, rawGap)) : 10;
  const banner = opt.banner || null;

  const marginX = 34;      // ≈12mm
  const marginTop = 34;
  const marginBottom = 46; // 给页码留位置
  const gutter = 18;       // 栏间距
  const contentW = A4[0] - marginX * 2;
  const colW = (contentW - gutter * (columns - 1)) / columns;
  const bannerH = banner ? Math.min(70, contentW * (banner.h / banner.w)) : 0;
  const contentTop = A4[1] - marginTop - (bannerH ? bannerH + 12 : 0);
  const contentBottom = marginBottom;
  const contentH = contentTop - contentBottom;

  const pages = [];
  let page = null, col = 0, y = 0;
  const newPage = () => {
    page = { w: A4[0], h: A4[1], images: [], texts: [] };
    if (banner) page.images.push({ buf: banner.buf, x: marginX, y: A4[1] - marginTop - bannerH, w: contentW, h: bannerH });
    pages.push(page);
    col = 0;
    y = contentTop;
  };
  newPage();

  const labelH = showIndex ? 15 : 0;
  items.forEach((it, i) => {
    const ratio = it.h / it.w;
    let w = colW, h = colW * ratio;
    const maxH = contentH - labelH;
    if (h > maxH) { h = maxH; w = h / ratio; }        // 单题过高时按高度缩放
    const need = h + labelH + lineGap;
    if (y - need < contentBottom) {
      col++;
      if (col >= columns) { newPage(); col = 0; y = contentTop; } else { y = contentTop; }
    }
    const x = marginX + col * (colW + gutter);
    if (showIndex) page.texts.push({ x, y: y - 10, text: String(i + 1) + '.', size: 10, color: '0.1 0.1 0.1' });
    page.images.push({ buf: it.buf, x: x + (colW - w) / 2, y: y - labelH - h, w, h });
    y = y - labelH - h - lineGap;
  });

  pages.forEach((p, i) => {
    p.texts.push({ x: A4[0] - marginX, y: marginBottom - 30, text: `${i + 1} / ${pages.length}`, size: 9, align: 'right' });
    p.texts.push({ x: marginX, y: marginBottom - 30, text: 'Cuoti Set', size: 8, color: '0.6 0.6 0.6' });
  });
  return { pages, pageCount: pages.length };
}

router.post('/sets', async (req, res) => {
  const b = req.body || {};
  const ids = (Array.isArray(b.itemIds) ? b.itemIds : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请先勾选要生成的题目');
  if (ids.length > 400) return fail(res, '一次最多生成 400 道题，请分批');
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM wrong_items WHERE id IN (${placeholders})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!ordered.length) return fail(res, '勾选的题目不存在');

  const title = String(b.title || '').trim() || '错题集 ' + now().slice(0, 16);
  const images = [];
  for (const r of ordered) {
    const buf = await readBytes(r.file_path);
    const info = pdfimg.imageInfo(buf);
    images.push({ buf, w: info.width, h: info.height });
  }
  const bannerBuf = dataUrlBuffer(b.banner);
  const banner = bannerBuf ? (() => { const i = pdfimg.imageInfo(bannerBuf); return { buf: bannerBuf, w: i.width, h: i.height }; })() : null;

  let pdf, pageCount = 0;
  try {
    const laid = layout(images, { columns: b.columns, showIndex: b.showIndex, lineGap: b.lineGap, banner });
    pdf = pdfimg.build({ size: A4, pages: laid.pages });
    pageCount = laid.pageCount;
  } catch (e) {
    return fail(res, '排版失败：' + e.message);
  }

  const fname = (title.replace(/[\\/:*?"<>|]/g, '_') || 'cuoti') + '.pdf';
  const saved = await store.saveFile(pdf, fname, 'wrong');
  const info = db.prepare(`INSERT INTO wrong_sets (title,column_count,show_index,item_count,page_count,item_ids,file_path,file_name,size,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    title, Math.max(1, Math.min(3, Number(b.columns) || 2)), Number(b.showIndex) ? 1 : 0,
    ordered.length, pageCount, JSON.stringify(ids), saved.key, fname, saved.size,
    req.user ? req.user.id : null, now()
  );
  ok(res, { id: info.lastInsertRowid, key: saved.key, file_name: fname, pages: pageCount, count: ordered.length, size: saved.size }, '错题集已生成');
});

router.get('/sets', (req, res) => {
  const rows = db.prepare('SELECT * FROM wrong_sets ORDER BY id DESC LIMIT 200').all();
  ok(res, rows);
});

router.delete('/sets/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM wrong_sets WHERE id=?').get(Number(req.params.id));
  if (row) { await store.deleteFile(row.file_path); db.prepare('DELETE FROM wrong_sets WHERE id=?').run(row.id); }
  ok(res, null, '已删除');
});

/** 汇总信息（页面顶部统计） */
router.get('/stats', (req, res) => {
  const g = (sql) => db.prepare(sql).get().n;
  ok(res, {
    items: g('SELECT COUNT(*) AS n FROM wrong_items'),
    selected: g('SELECT COUNT(*) AS n FROM wrong_items WHERE selected=1'),
    sets: g('SELECT COUNT(*) AS n FROM wrong_sets'),
    batches: g('SELECT COUNT(*) AS n FROM wrong_batches'),
  });
});

/* ==================================================================
 * AI 整页识别：整页照片 → 每道题的边界框（相对坐标 0~1）+ 题干预览
 *   前端在页图上渲染识别框，老师点每题「➕」加入错题栏；识别不准可手动拖框兜底。
 *   只返回坐标、不落盘（页图在前端本地已有）。
 * ================================================================== */
router.post('/segment', upload.single('image'), async (req, res) => {
  const f = req.file;
  if (!f) return fail(res, '请上传整页试卷图片');
  let mime = 'image/jpeg';
  try {
    const info = pdfimg.imageInfo(f.buffer);
    mime = info.type === 'png' ? 'image/png' : 'image/jpeg';
  } catch (e) { return fail(res, '图片格式不支持：' + e.message); }
  try {
    const out = await ai.segmentPage({ buf: f.buffer, mime });
    ok(res, { questions: out.questions, model: out.model }, `AI 识别出 ${out.questions.length} 道题`);
  } catch (e) {
    fail(res, 'AI 整页识别失败：' + (e.message || e));
  }
});

/* ==================================================================
 * 一键重组（新版）：拍照 → 框选 → AI 识别 + 举一反三 → 两栏 PDF
 *   左栏 = 原题图片（学生错的那道原题），右栏 = AI 生成的同类变式例题
 *   全程不落库、不留历史，扫码即出卷。
 * ================================================================== */

/** 识别单道题 + 生成举一反三。前端逐题调用：可显示进度，单题失败不影响整卷 */
router.post('/analyze', upload.single('image'), async (req, res) => {
  const f = req.file;
  if (!f) return fail(res, '请上传题目图片');
  let info;
  try { info = pdfimg.imageInfo(f.buffer); } catch (e) { return fail(res, '图片格式不支持：' + e.message); }
  let saved;
  try { saved = await store.saveFile(f.buffer, 'r' + Date.now() + (info.type === 'png' ? '.png' : '.jpg'), 'wrong'); }
  catch (e) { return fail(res, '题目图片保存失败：' + (e.message || e)); }

  let out = null; let err = '';
  try {
    out = await ai.analyzeWrongQuestion({ buf: f.buffer, mime: info.type === 'png' ? 'image/png' : 'image/jpeg' });
  } catch (e) { err = String((e && e.message) || e); }
  // 注意：AI 失败也返回 code 0 —— 前端会照常把「原题」排进卷子，右栏给出提示文字
  ok(res, {
    key: saved.key, w: info.width, h: info.height,
    info: out ? out.info : null,
    variants: out ? out.info.variants : [],
    model: out ? out.model : '',
    error: err,
  }, err ? '已保留原题，AI 识别失败：' + err : '识别完成');
});

/**
 * 两栏排版：左右两栏一一对应，一行 = 一道题（左原题 / 右举一反三）
 * @param {Array} lefts  [{buf,w,h}] 原题图片
 * @param {Array} rights [{buf,w,h}|null] 右栏图片（前端把 AI 文本渲染成图片），可缺省
 * @param {Object} opt   {banner:{buf,w,h}}
 */
function layoutPairs(lefts, rights, opt) {
  const banner = (opt && opt.banner) || null;
  const marginX = 34;
  const marginTop = 34;
  const marginBottom = 46;
  const gutter = 18;
  const rowGap = 16;
  const contentW = A4[0] - marginX * 2;
  const colW = (contentW - gutter) / 2;
  const bannerH = banner ? Math.min(70, contentW * (banner.h / banner.w)) : 0;
  const contentTop = A4[1] - marginTop - (bannerH ? bannerH + 12 : 0);
  const contentBottom = marginBottom;
  const contentH = contentTop - contentBottom;

  const pages = [];
  let page = null;
  let y = 0;
  const newPage = () => {
    page = { w: A4[0], h: A4[1], images: [], texts: [] };
    if (banner) page.images.push({ buf: banner.buf, x: marginX, y: A4[1] - marginTop - bannerH, w: contentW, h: bannerH });
    pages.push(page);
    y = contentTop;
  };
  newPage();

  for (let i = 0; i < lefts.length; i++) {
    const L = lefts[i];
    const R = rights[i];
    // 左右两格都按栏宽等比缩放
    let lw = colW; let lh = colW * (L.h / L.w);
    let rw = colW; let rh = R ? colW * (R.h / R.w) : 20;
    let rowH = Math.max(lh, rh);
    if (rowH > contentH) {                    // 单题超过一整页：整行等比缩小，保证放得下
      const k = contentH / rowH;
      lw *= k; lh *= k; rw *= k; rh *= k; rowH = contentH;
    }
    if (y - rowH < contentBottom) newPage();
    const x1 = marginX;
    const x2 = marginX + colW + gutter;
    page.images.push({ buf: L.buf, x: x1 + (colW - lw) / 2, y: y - lh, w: lw, h: lh });
    if (R) page.images.push({ buf: R.buf, x: x2 + (colW - rw) / 2, y: y - rh, w: rw, h: rh });
    y = y - rowH - rowGap;
  }

  const answers = (opt && opt.answers) || [];
  for (const A of answers) {
    page = { w: A4[0], h: A4[1], images: [], texts: [] };
    pages.push(page);
    const maxH = A4[1] - marginTop - marginBottom;
    let aw = contentW;
    let ah = contentW * (A.h / A.w);
    if (ah > maxH) { const k = maxH / ah; aw *= k; ah *= k; }
    page.images.push({ buf: A.buf, x: marginX + (contentW - aw) / 2, y: A4[1] - marginTop - ah, w: aw, h: ah });
  }

  pages.forEach((p, i) => {
    p.texts.push({ x: A4[0] - marginX, y: marginBottom - 30, text: `${i + 1} / ${pages.length}`, size: 9, align: 'right' });
    p.texts.push({ x: marginX, y: marginBottom - 30, text: 'Cuoti Rebuild', size: 8, color: '0.6 0.6 0.6' });
  });
  return { pages, pageCount: pages.length };
}

/** 一键重组：{ title, banner, items:[{key, variant}] } → 两栏 A4 PDF */
router.post('/rebuild', async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return fail(res, '还没有可重组的题目：先拍照并在图上框选题目');
  if (items.length > 200) return fail(res, '一次最多重组 200 道题，请分批');

  const lefts = [];
  const rights = [];
  for (const it of items) {
    const key = String((it && it.key) || '');
    if (!key) return fail(res, '题目图片参数缺失');
    let buf;
    try { buf = await readBytes(key); } catch (e) { return fail(res, '读取题目图片失败：' + (e.message || e)); }
    const info = pdfimg.imageInfo(buf);
    lefts.push({ buf, w: info.width, h: info.height });
    let vb = null;
    try { vb = (it && it.variant) ? dataUrlBuffer(it.variant) : null; } catch (e) { vb = null; }
    rights.push(vb ? (() => { const i2 = pdfimg.imageInfo(vb); return { buf: vb, w: i2.width, h: i2.height }; })() : null);
  }

  const bannerBuf = dataUrlBuffer(b.banner);
  const banner = bannerBuf ? (() => { const i = pdfimg.imageInfo(bannerBuf); return { buf: bannerBuf, w: i.width, h: i.height }; })() : null;
  const answers = [];
  for (const src of (Array.isArray(b.answers) ? b.answers : [])) {
    let buf = null;
    try { buf = dataUrlBuffer(src); } catch (e) { buf = null; }
    if (!buf) continue;
    const info = pdfimg.imageInfo(buf);
    answers.push({ buf, w: info.width, h: info.height });
  }

  const title = String(b.title || '').trim() || 'AI错题重组 ' + now().slice(0, 16);
  let pdf; let pageCount = 0;
  try {
    const laid = layoutPairs(lefts, rights, { banner, answers });
    pdf = pdfimg.build({ size: A4, pages: laid.pages });
    pageCount = laid.pageCount;
  } catch (e) {
    return fail(res, '排版失败：' + (e.message || e));
  }

  const fname = (title.replace(/[\\/:*?"<>|]/g, '_') || 'cuoti') + '.pdf';
  let saved;
  try { saved = await store.saveFile(pdf, fname, 'wrong'); }
  catch (e) { return fail(res, 'PDF 保存失败：' + (e.message || e)); }
  ok(res, { key: saved.key, file_name: fname, pages: pageCount, count: lefts.length, size: saved.size },
    `已重组 ${lefts.length} 道题（${pageCount} 页）`);
});

module.exports = router;
module.exports.layout = layout;
module.exports.layoutPairs = layoutPairs;
