'use strict';
/**
 * AI 试卷分析测评报告（管理端）
 *
 * 流程：上传/拍摄试卷照片 → 创建分析任务（status=pending）→ 后台调视觉大模型 → done + report JSON
 *      前端轮询列表拿状态，完成后进报告页渲染（可打印为 PDF）
 * 照片存 report/ 目录（本地，不入七牛——只是分析素材，无需长期占用云存储）
 *
 * 手机扫码：管理端 POST /scan-token 拿限时 token（30 分钟，内存 Map）→ 二维码指向 /scan-report.html
 *          家长手机把照片+信息 POST 到免登录的 /api/report-scan?token=xxx，
 *          报告 created_by 落在生成二维码的账号上 → 分校数据自然隔离。
 *
 * 分校权限：branch 角色只能看到/操作自己创建的报告（created_by=自己），总后台（admin）看全部。
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

const { db } = require('./db');
const store = require('./storage');
const ai = require('./ai');
const SchoolScope = require('./school-scope');

const admin = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: 15 * 1024 * 1024 } });

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败') => res.json({ code: 1, msg });

const rowOut = (r) => {
  if (!r) return r;
  let report = null;
  try { report = r.report ? JSON.parse(r.report) : null; } catch (e) { report = null; }
  let paperKeys = [];
  try { paperKeys = JSON.parse(r.paper_keys || '[]'); } catch (e) { paperKeys = []; }
  return { ...r, visible: undefined, paperKeys, report };
};

/** 分校只能看自己创建的报告；总后台看全部 */
function reportWhere(user) {
  if (user && user.role === 'branch') return { sql: ' WHERE r.created_by=?', args: [user.id] };
  return { sql: '', args: [] };
}
function reportGet(user, id) {
  const w = reportWhere(user);
  return db.prepare(`SELECT * FROM ai_reports WHERE${w.sql ? ' created_by=? AND' : ''} id=?`).get(...w.args, id);
}

// ------------------------------------------------------------------ AI 配置
admin.get('/config', (req, res) => ok(res, ai.getConfig()));
admin.put('/config', (req, res) => res.json({ code: 1, msg: 'AI 配置已统一到「设置 → AI 配置中心」，请在那里新增并启用模型档案' }));

// ------------------------------------------------------------------ 试卷照片
admin.post('/papers', upload.array('images', 6), async (req, res) => {
  try {
    const scopeError = SchoolScope.scopeError(req.body);
    if (scopeError) return fail(res, scopeError);
    const files = req.files || [];
    if (!files.length) return fail(res, '请选择试卷照片');
    const keys = [];
    for (const f of files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/i.test(f.mimetype || '') && !/\.(png|jpe?g|webp|pdf)$/i.test(name)) {
        return fail(res, '只支持照片（png/jpg/webp）或 PDF');
      }
      const saved = await store.saveFile(f.buffer, name, 'report');
      keys.push(saved.key);
    }
    ok(res, { keys });
  } catch (e) {
    fail(res, '上传失败：' + e.message);
  }
});

// ------------------------------------------------------------------ 分析任务
admin.post('/', async (req, res) => {
  const b = req.body || {};
  const scopeError = SchoolScope.scopeError(b);
  if (scopeError) return fail(res, scopeError);
  // paperKeys 兼容数组与 JSON 字符串两种形式
  let paperKeys = Array.isArray(b.paperKeys) ? b.paperKeys : [];
  if (!paperKeys.length && b.paperKeys) {
    try { paperKeys = JSON.parse(b.paperKeys); } catch (e) { paperKeys = []; }
  }
  if (!Array.isArray(paperKeys) || !paperKeys.length) return fail(res, '请先上传试卷照片');
  if (paperKeys.length > 6) return fail(res, '一次最多 6 张照片');

  const student = String(b.student || '').trim();
  const title = String(b.title || '').trim() || (student ? student + ' 学情诊断报告' : '学情诊断报告 ' + now().slice(5, 16));
  const info = db.prepare(`INSERT INTO ai_reports (title, student, subject, grade, paper_keys, status, model, report, error, created_by, created_at)
    VALUES (?,?,?,?,?, 'pending', '', '', ?, ?, ?)`)
    .run(title, student, String(b.subject || '').trim(), String(b.grade || '').trim(),
      JSON.stringify(paperKeys), '', req.user ? req.user.id : null, now());
  const id = info.lastInsertRowid;

  // 后台执行，接口立即返回；前端轮询状态
  runAnalysis(id).catch(() => {});
  ok(res, { id, status: 'pending' }, '已开始分析');
});

/** 执行一次分析并把结果写回（mock / 真实调用都在这里） */
async function runAnalysis(id) {
  const row = db.prepare('SELECT * FROM ai_reports WHERE id=?').get(id);
  if (!row || SchoolScope.isSeniorScope(row)) return;
  let keys = [];
  try { keys = JSON.parse(row.paper_keys || '[]'); } catch (e) { keys = []; }
  try {
    const images = [];
    for (const k of keys) {
      const buf = await store.readBuffer(k);
      if (!buf) throw new Error('试卷照片已不存在');
      const mime = /\.pdf$/i.test(k) ? 'application/pdf' : /\.png$/i.test(k) ? 'image/png' : /\.webp$/i.test(k) ? 'image/webp' : 'image/jpeg';
      images.push({ buf, mime });
    }
    const hint = `学生：${row.student || '（未填）'}；年级：${row.grade || '（未填）'}；学科：${row.subject || '（未填）'}。请按江苏地区学情口径分析试卷并输出学情诊断报告 JSON。`;
    const { report, model } = await ai.analyzePaper({ images, userHint: hint });
    db.prepare(`UPDATE ai_reports SET status='done', report=?, model=?, error='' WHERE id=?`)
      .run(JSON.stringify(ai.normalizeReport(report)), model || '', id);
  } catch (e) {
    db.prepare(`UPDATE ai_reports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 500), id);
  }
}

const pdfimg = require('./pdfimg');

// ------------------------------------------------------------------ 查询 / 删除
admin.post('/export-pdf', upload.array('pages', 20), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return fail(res, '没有可导出的页面');
  try {
    const A4 = [595.28, 841.89];
    const pages = files.map((f) => {
      const info = pdfimg.imageInfo(f.buffer);
      let iw = A4[0];
      let ih = A4[0] * (info.height / info.width);
      if (ih > A4[1]) { const k = A4[1] / ih; iw *= k; ih *= k; }
      return { images: [{ buf: f.buffer, x: (A4[0] - iw) / 2, y: (A4[1] - ih) / 2, w: iw, h: ih }] };
    });
    const buf = pdfimg.build({ size: A4, pages });
    const name = (String((req.body && req.body.title) || '学情诊断报告').replace(/[\\/:*?"<>|]/g, '').trim() || '学情诊断报告') + '.pdf';
    const saved = await store.saveFile(buf, name, 'report');
    ok(res, { key: saved.key, file_name: name }, '已导出');
  } catch (e) {
    fail(res, '导出失败：' + (e.message || e));
  }
});

admin.get('/', (req, res) => {
  const w = reportWhere(req.user);
  const rows = db.prepare(`SELECT r.*, u.name AS branch_name FROM ai_reports r
    LEFT JOIN users u ON u.id = r.created_by AND u.role='branch'
    ${w.sql} ORDER BY r.id DESC LIMIT 100`).all(...w.args);
  ok(res, rows.map(rowOut));
});

admin.get('/:id', (req, res) => {
  const row = reportGet(req.user, req.params.id);
  if (!row) return fail(res, '报告不存在');
  ok(res, rowOut(row));
});

admin.post('/:id/retry', async (req, res) => {
  const row = reportGet(req.user, req.params.id);
  if (!row) return fail(res, '报告不存在');
  const scopeError = SchoolScope.scopeError(row);
  if (scopeError) return fail(res, scopeError);
  db.prepare(`UPDATE ai_reports SET status='pending', error='' WHERE id=?`).run(row.id);
  runAnalysis(row.id).catch(() => {});
  ok(res, { id: row.id, status: 'pending' }, '已重新发起分析');
});

admin.delete('/:id', (req, res) => {
  const row = reportGet(req.user, req.params.id);
  if (!row) return fail(res, '报告不存在');
  let keys = [];
  try { keys = JSON.parse(row.paper_keys || '[]'); } catch (e) { keys = []; }
  if (store.CLOUD_READ_ONLY) {
    try { for (const key of keys) store.assertDeleteAllowed(key); }
    catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
  }
  db.prepare('DELETE FROM ai_reports WHERE id=?').run(row.id);
  Promise.all(keys.map((k) => store.deleteFile(k).catch(() => {}))).finally(() => ok(res, null, '已删除'));
});

// ------------------------------------------------------------------ 手机扫码：限时 token + 免登录上传
/** token → { adminId, exp }。内存态即可：30 分钟有效期，重启清空属正常（二维码重新生成就好） */
const scanTokens = new Map();
const SCAN_TOKEN_TTL = 30 * 60 * 1000;

admin.post('/scan-token', (req, res) => {
  // 顺手清理过期 token，防止 Map 慢慢变大
  const t = Date.now();
  for (const [k, v] of scanTokens) if (v.exp < t) scanTokens.delete(k);
  const token = crypto.randomBytes(16).toString('hex');
  scanTokens.set(token, { adminId: req.user.id, exp: t + SCAN_TOKEN_TTL });
  ok(res, { token, expires_minutes: 30 });
});

/** 免登录上传（家长手机）：POST /api/report-scan?token=xxx，multipart images + 学生信息字段 */
const scan = express.Router();
function requireScanToken(req, res, next) {
  const hit = scanTokens.get(String(req.query.token || ''));
  if (!hit || hit.exp < Date.now()) return fail(res, '二维码已过期，请让老师在电脑端刷新二维码后重新扫码');
  next();
}
// Reject unauthorised callers before parsing bytes; recheck expiry below after upload.
scan.post('/', requireScanToken, upload.array('images', 6), async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const hit = scanTokens.get(token);
    if (!hit || hit.exp < Date.now()) return fail(res, '二维码已过期，请让老师在电脑端刷新二维码后重新扫码');
    const b = req.body || {};
    const scopeError = SchoolScope.scopeError(b);
    if (scopeError) return fail(res, scopeError);
    const files = req.files || [];
    if (!files.length) return fail(res, '请先拍摄或选择试卷照片');
    const keys = [];
    for (const f of files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/i.test(f.mimetype || '') && !/\.(png|jpe?g|webp|pdf)$/i.test(name)) {
        return fail(res, '只支持照片（png/jpg/webp）或 PDF');
      }
      const saved = await store.saveFile(f.buffer, name, 'report');
      keys.push(saved.key);
    }
    if (keys.length > 6) return fail(res, '一次最多 6 张照片');
    const student = String(b.student || '').trim();
    const title = String(b.title || '').trim() || (student ? student + ' 学情诊断报告' : '学情诊断报告 ' + now().slice(5, 16));
    const info = db.prepare(`INSERT INTO ai_reports (title, student, subject, grade, paper_keys, status, model, report, error, created_by, created_at)
      VALUES (?,?,?,?,?, 'pending', '', '', ?, ?, ?)`)
      .run(title, student, String(b.subject || '').trim(), String(b.grade || '').trim(),
        JSON.stringify(keys), '', hit.adminId, now());
    runAnalysis(info.lastInsertRowid).catch(() => {});
    ok(res, { id: info.lastInsertRowid, status: 'pending' }, '提交成功，AI 正在分析');
  } catch (e) {
    fail(res, '上传失败：' + e.message);
  }
});

module.exports = admin;
module.exports.scan = scan;

// 进程重启后，上次没跑完的分析不会自己续上，列表里会一直显示「分析中」
db.prepare(`UPDATE ai_reports SET status='failed', error=? WHERE status='pending' AND ${SchoolScope.supportedSql('', { stage: false })}`)
  .run('上次分析已中断，请点重新分析');
