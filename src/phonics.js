'use strict';
/**
 * 语音基础（学生端「训练 → 语音基础」）
 *
 *   - 字母乐园 letters：26 个字母（笔顺动图、字母发音、示范视频、讲义资料）
 *   - 音标训练 phonetic：48 个国际音标（拟音 / 发音要领 / 口型视频 / 教学视频 / 示范词 / 讲义资料）
 *
 * 管理端（/api/admin/phonics）：条目增删改、初始化默认数据、文件上传（返回 key）
 * 学生端（/api/stu/phonics）：按模块取条目（只读）
 *
 * 文件统一走 storage.saveFile 存成 key，学生端用 /api/file?key= 播放 / 下载，
 * 与「教学资源 → 视频管理 / 讲义资料」用的是同一套存储与取文件方式。
 */
const express = require('express');
const multer = require('multer');
const path = require('path');

const { db } = require('./db');
const store = require('./storage');
const { delPwdOk } = require('./delpwd');

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败') => res.json({ code: 1, msg });
const KINDS = ['letters', 'phonetic'];
const normKind = (k) => (KINDS.includes(String(k || '')) ? String(k) : 'letters');
const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);
const jsonArr = (v) => {
  try {
    const a = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v || []));
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
};
function fixFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/* ============================================================ 管理端 */
const admin = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: 200 * 1024 * 1024 } });
const COLS = `id, kind, code, title, type, grp, group_name, sub, len, cue, mnemonic, emoji, tip, spell,
  audio, stroke, video_mouth, video_teach, samples, files, sort, updated_at`;

admin.get('/list', (req, res) => {
  const kind = normKind(req.query.kind);
  const rows = db.prepare(`SELECT ${COLS} FROM phonics_items WHERE kind=? ORDER BY sort ASC, id ASC`).all(kind);
  ok(res, rows.map((r) => ({ ...r, samples: jsonArr(r.samples), files: jsonArr(r.files) })));
});

/** 新增 / 修改一条（id 为空 = 新增） */
admin.post('/save', (req, res) => {
  const b = req.body || {};
  const kind = normKind(b.kind);
  const id = Number(b.id) || 0;
  const f = {
    code: str(b.code, 40), title: str(b.title, 80), type: str(b.type, 20), grp: str(b.grp, 30),
    group_name: str(b.group_name, 40), sub: str(b.sub, 30), len: str(b.len, 20),
    cue: str(b.cue, 60), mnemonic: str(b.mnemonic, 60), emoji: str(b.emoji, 16),
    tip: str(b.tip, 600), spell: str(b.spell, 120),
    audio: str(b.audio, 400), stroke: str(b.stroke, 400),
    video_mouth: str(b.video_mouth, 400), video_teach: str(b.video_teach, 400),
    samples: JSON.stringify(jsonArr(b.samples)), files: JSON.stringify(jsonArr(b.files)),
    sort: Number(b.sort) || 0, updated_at: now(),
  };
  if (!f.title) return fail(res, '请填写显示名称（如 Aa 或 /iː/）');
  if (id) {
    /* code 是内部标识（学生端音标表按它定位格子），编辑时锁定不允许改，防止把表格改出空洞 */
    const orig = db.prepare('SELECT code FROM phonics_items WHERE id=? AND kind=?').get(id, kind);
    if (orig && orig.code) f.code = orig.code;
    db.prepare(`UPDATE phonics_items SET code=?, title=?, type=?, grp=?, group_name=?, sub=?, len=?, cue=?, mnemonic=?, emoji=?, tip=?, spell=?,
      audio=?, stroke=?, video_mouth=?, video_teach=?, samples=?, files=?, sort=?, updated_at=? WHERE id=? AND kind=?`)
      .run(f.code, f.title, f.type, f.grp, f.group_name, f.sub, f.len, f.cue, f.mnemonic, f.emoji, f.tip, f.spell,
        f.audio, f.stroke, f.video_mouth, f.video_teach, f.samples, f.files, f.sort, f.updated_at, id, kind);
    ok(res, { id }, '已保存');
  } else {
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(f.code)) return fail(res, '标识必须是字母开头的内部 key（如 ae / schwa / aw:），不要填音标符号本身');
    const info = db.prepare(`INSERT INTO phonics_items (kind, code, title, type, grp, group_name, sub, len, cue, mnemonic, emoji, tip, spell,
      audio, stroke, video_mouth, video_teach, samples, files, sort, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(kind, f.code, f.title, f.type, f.grp, f.group_name, f.sub, f.len, f.cue, f.mnemonic, f.emoji, f.tip, f.spell,
        f.audio, f.stroke, f.video_mouth, f.video_teach, f.samples, f.files, f.sort, f.updated_at);
    ok(res, { id: info.lastInsertRowid }, '已添加');
  }
});

/** 删除一条（沿用系统统一删除密码） */
admin.post('/del', (req, res) => {
  const b = req.body || {};
  const id = Number(b.id) || 0;
  if (!id) return fail(res, '参数错误');
  if (!delPwdOk(req)) return fail(res, '删除密码不正确');
  const r = db.prepare('DELETE FROM phonics_items WHERE id=?').run(id);
  if (!r.changes) return fail(res, '条目不存在');
  ok(res, null, '已删除');
});

/** 初始化默认数据（26 字母 / 48 音标）：只在该模块还没有数据时写入 */
admin.post('/seed', (req, res) => {
  const b = req.body || {};
  const kind = normKind(b.kind);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return fail(res, '没有可初始化的数据');
  const exists = db.prepare('SELECT COUNT(*) n FROM phonics_items WHERE kind=?').get(kind);
  if (exists && exists.n > 0 && !b.force) return fail(res, `该模块已有 ${exists.n} 条数据，如需覆盖请勾选「覆盖重建」`);
  if (exists && exists.n > 0 && b.force) db.prepare('DELETE FROM phonics_items WHERE kind=?').run(kind);
  const ins = db.prepare(`INSERT INTO phonics_items (kind, code, title, type, grp, group_name, sub, len, cue, mnemonic, emoji, tip, spell,
    audio, stroke, video_mouth, video_teach, samples, files, sort, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  items.forEach((it, i) => {
    ins.run(kind, str(it.code, 40), str(it.title, 80), str(it.type, 20), str(it.grp, 30), str(it.group_name, 40),
      str(it.sub, 30), str(it.len, 20), str(it.cue, 60), str(it.mnemonic, 60), str(it.emoji, 16), str(it.tip, 600), str(it.spell, 120),
      str(it.audio, 400), str(it.stroke, 400), '', '',
      JSON.stringify(jsonArr(it.samples)), '[]', Number(it.sort) || i, now());
  });
  ok(res, { n: items.length }, `已初始化 ${items.length} 条`);
});

/** 文件上传（音频 / 笔顺动图 / 讲义资料）：复用教学资源的存储，返回 key */
admin.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, '请选择文件');
  // multer 把 multipart 文件名按 latin1 解码，中文会变乱码，这里还原成 utf8（与讲义资料一致）
  const name = fixFileName(Buffer.from(req.file.originalname || 'file', 'latin1').toString('utf8'));
  const dir = ['audio', 'image', 'video', 'file'].includes(String(req.body && req.body.kind)) ? String(req.body.kind) : 'file';
  try {
    const saved = await store.saveFile(req.file.buffer, name, 'phonics/' + dir);
    ok(res, { key: saved.key, name, size: saved.size }, '上传成功');
  } catch (e) {
    console.error('[phonics] 上传失败', (e && e.message) || e);
    fail(res, '上传失败：' + ((e && e.message) || '未知错误'));
  }
});

/* ============================================================ 模块级资源（字母歌 / 配套资料） */
const MODS = ['letters', 'phonetic'];
const normMod = (m) => (MODS.includes(String(m || '')) ? String(m) : 'letters');
/* 字母歌改为多条管理：补 sort 排序列 + cover 封面列（老库自动迁移） */
try { db.prepare('ALTER TABLE phonics_extras ADD COLUMN sort INTEGER DEFAULT 0').run(); } catch (e) { /* 列已存在 */ }
try { db.prepare("ALTER TABLE phonics_extras ADD COLUMN cover VARCHAR(400) DEFAULT ''").run(); } catch (e) { /* 列已存在 */ }
const extrasRows = (mod) => db.prepare(
  'SELECT id, module, k, title, file, size, mime, cover, sort, created_at FROM phonics_extras WHERE module=? ORDER BY sort ASC, id ASC'
).all(mod);
const extrasOut = (mod) => {
  const rows = extrasRows(mod);
  const songs = rows.filter((r) => r.k === 'song');
  return {
    song: songs[0] || null,   // 兼容旧字段：第一条字母歌
    songs,                    // 全部字母歌（按排序）
    materials: rows.filter((r) => r.k === 'material'),
  };
};

/** 管理端：字母歌 + 配套资料列表 */
admin.get('/extras', (req, res) => {
  ok(res, extrasOut(normMod(req.query.mod)));
});
/** 管理端：保存（带 id = 编辑标题/排序/换视频；不带 id = 新增。字母歌与配套资料共用） */
admin.post('/extras/save', (req, res) => {
  const b = req.body || {};
  const mod = normMod(b.mod);
  const k = String(b.k || '') === 'song' ? 'song' : 'material';
  const file = str(b.file, 400);
  const id = Number(b.id) || 0;
  const sort = Number(b.sort) || 0;
  const title = str(b.title, 200) || (k === 'song' ? 'ABC字母歌' : '资料');
  if (id) {
    const row = db.prepare('SELECT id FROM phonics_extras WHERE id=?').get(id);
    if (!row) return fail(res, '条目不存在');
    const cover = str(b.cover, 400);
    if (file) {
      db.prepare('UPDATE phonics_extras SET title=?, sort=?, file=?, size=?, mime=?, cover=? WHERE id=?')
        .run(title, sort, file, Number(b.size) || 0, str(b.mime, 120), cover, id);
    } else if (cover) {
      db.prepare('UPDATE phonics_extras SET title=?, sort=?, cover=? WHERE id=?').run(title, sort, cover, id);
    } else {
      db.prepare('UPDATE phonics_extras SET title=?, sort=? WHERE id=?').run(title, sort, id);
    }
    return ok(res, { id }, '已保存');
  }
  if (!file) return fail(res, '请先上传文件');
  const info = db.prepare(
    'INSERT INTO phonics_extras (module, k, title, file, size, mime, cover, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(mod, k, title, file, Number(b.size) || 0, str(b.mime, 120), str(b.cover, 400), sort, now());
  ok(res, { id: info.lastInsertRowid }, k === 'song' ? '字母歌已上传' : '资料已上传');
});
/** 管理端：删除一条（字母歌 / 资料） */
admin.post('/extras/del', (req, res) => {
  const b = req.body || {};
  const id = Number(b.id) || 0;
  if (!id) return fail(res, '参数错误');
  const r = db.prepare('DELETE FROM phonics_extras WHERE id=?').run(id);
  if (!r.changes) return fail(res, '条目不存在');
  ok(res, null, '已删除');
});

/* ============================================================ 系统课（课程 → 课时）+ 训练场题库（仅音标训练用） */
/* MySQL 原生建表（db.prepare 直传 DDL），不依赖 db.js 的 schema（线上 db.js 与本地不同步，勿动） */
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS phonics_courses (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    module VARCHAR(20) NOT NULL DEFAULT 'phonetic',
    title VARCHAR(200) NOT NULL,
    sub VARCHAR(200) DEFAULT '',
    cover VARCHAR(400) DEFAULT '',
    docs MEDIUMTEXT,
    sort INT DEFAULT 0,
    created_at VARCHAR(32) NOT NULL
  )`).run();
  /* 老库补列：cover 课程封面（上传/AI 生成）、docs 课程级配套讲义 JSON */
  try { db.prepare("ALTER TABLE phonics_courses ADD COLUMN cover VARCHAR(400) DEFAULT ''").run(); } catch (e) { /* 已存在 */ }
  try { db.prepare('ALTER TABLE phonics_courses ADD COLUMN docs MEDIUMTEXT').run(); } catch (e) { /* 已存在 */ }
  db.prepare(`CREATE TABLE IF NOT EXISTS phonics_course_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    cate VARCHAR(100) DEFAULT '',
    title VARCHAR(200) NOT NULL,
    video VARCHAR(400) DEFAULT '',
    size INT DEFAULT 0,
    docs MEDIUMTEXT,
    sort INT DEFAULT 0,
    created_at VARCHAR(32) NOT NULL
  )`).run();
  /* 老库补 docs 列（讲义资料 JSON，[{title,key,size,mime}]） */
  try { db.prepare('ALTER TABLE phonics_course_items ADD COLUMN docs MEDIUMTEXT').run(); } catch (e) { /* 已存在 */ }
  db.prepare(`CREATE TABLE IF NOT EXISTS phonics_quiz_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mode VARCHAR(20) NOT NULL,
    q VARCHAR(300) DEFAULT '',
    say VARCHAR(400) DEFAULT '',
    saytext VARCHAR(200) DEFAULT '',
    options MEDIUMTEXT,
    ans VARCHAR(200) DEFAULT '',
    created_at VARCHAR(32) NOT NULL
  )`).run();
} catch (e) { console.error('[phonics] 建表失败', (e && e.message) || e); }

const QUIZ_MODES = ['find', 'listen', 'sort'];
const quizOut = (r) => ({ id: r.id, mode: r.mode, q: r.q, say: r.say, sayText: r.saytext, options: jsonArr(r.options), ans: r.ans });

/** 题干按题型自动生成（find 听音标找单词 / listen 听单词找音标 / sort 元辅音分类） */
const quizQ = (mode, sayText) =>
  mode === 'find' ? `哪个单词里有 ${sayText || ''}？`
    : mode === 'listen' ? '听发音，选出你听到的音标'
      : `${sayText || ''} 是元音还是辅音？`;

/** 旧数据迁移：原来「系统课视频」（extras k=song, mod=phonetic）转成课程（一门课一个视频课时），只跑一次 */
const ensureCourseMigrate = (mod) => {
  if (mod !== 'phonetic') return;
  try {
    const has = db.prepare('SELECT COUNT(*) n FROM phonics_courses WHERE module=?').get('phonetic');
    if (has && has.n > 0) return;
    const songs = db.prepare("SELECT id, title, file, size, mime, created_at FROM phonics_extras WHERE module='phonetic' AND k='song' ORDER BY sort ASC, id ASC").all();
    if (!songs.length) return;
    songs.forEach((s, i) => {
      const c = db.prepare('INSERT INTO phonics_courses (module, title, sub, sort, created_at) VALUES (?,?,?,?,?)')
        .run('phonetic', str(s.title, 200) || ('系统课 ' + (i + 1)), '', i, s.created_at || now());
      db.prepare('INSERT INTO phonics_course_items (course_id, cate, title, video, size, sort, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(Number(c.lastInsertRowid), '', str(s.title, 200) || ('课时 ' + (i + 1)), s.file, Number(s.size) || 0, 0, s.created_at || now());
    });
    console.log('[phonics] 已把', songs.length, '条旧系统课视频迁移为课程');
  } catch (e) { console.error('[phonics] 系统课迁移失败', (e && e.message) || e); }
};

/* ---- 管理端：系统课课程 ---- */
admin.get('/courses', (req, res) => {
  const mod = normMod(req.query.mod);
  ensureCourseMigrate(mod);
  const rows = db.prepare('SELECT * FROM phonics_courses WHERE module=? ORDER BY sort ASC, id ASC').all(mod);
  const cnt = db.prepare('SELECT course_id, COUNT(*) n FROM phonics_course_items GROUP BY course_id');
  const m = new Map(cnt.all().map((c) => [Number(c.course_id), Number(c.n)]));
  ok(res, rows.map((r) => ({ ...r, docs: jsonArr(r.docs), itemCount: m.get(Number(r.id)) || 0 })));
});
admin.post('/courses/save', (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 200);
  if (!title) return fail(res, '请填写课程标题');
  const cover = str(b.cover, 400);
  const docs = JSON.stringify(docsNorm(b.docs));
  const id = Number(b.id) || 0;
  if (id) {
    db.prepare('UPDATE phonics_courses SET title=?, sub=?, cover=?, docs=?, sort=? WHERE id=?')
      .run(title, str(b.sub, 200), cover, docs, Number(b.sort) || 0, id);
    return ok(res, { id }, '已保存');
  }
  const info = db.prepare('INSERT INTO phonics_courses (module, title, sub, cover, docs, sort, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(normMod(b.mod), title, str(b.sub, 200), cover, docs, Number(b.sort) || 0, now());
  ok(res, { id: info.lastInsertRowid }, '课程已创建');
});
admin.post('/courses/del', (req, res) => {
  const id = Number((req.body || {}).id) || 0;
  if (!id) return fail(res, '参数错误');
  db.prepare('DELETE FROM phonics_course_items WHERE course_id=?').run(id);
  db.prepare('DELETE FROM phonics_courses WHERE id=?').run(id);
  ok(res, null, '已删除');
});

/* ---- 管理端：课程课时（每个课时一个视频 + 可选配套讲义，讲义存服务器本地 phonics 目录） ---- */
/** 讲义数组清洗：[{title,key,size,mime}]，最多 10 份，必须有 key */
const docsNorm = (v) => (Array.isArray(v) ? v : [])
  .map((d) => ({ title: str(d && d.title, 100), key: str(d && d.key, 400), size: Number(d && d.size) || 0, mime: str(d && d.mime, 100) }))
  .filter((d) => d.key).slice(0, 10);

admin.get('/course-items', (req, res) => {
  const cid = Number(req.query.courseId) || 0;
  if (!cid) return fail(res, '参数错误');
  ok(res, db.prepare('SELECT * FROM phonics_course_items WHERE course_id=? ORDER BY sort ASC, id ASC').all(cid)
    .map((r) => ({ ...r, docs: jsonArr(r.docs) })));
});
admin.post('/course-items/save', (req, res) => {
  const b = req.body || {};
  const cid = Number(b.courseId) || 0;
  const title = str(b.title, 200);
  if (!cid) return fail(res, '参数错误');
  if (!title) return fail(res, '请填写课时标题');
  const cate = str(b.cate, 100);
  const video = str(b.video, 400);
  const sort = Number(b.sort) || 0;
  const docs = JSON.stringify(docsNorm(b.docs));
  const id = Number(b.id) || 0;
  if (id) {
    const row = db.prepare('SELECT id FROM phonics_course_items WHERE id=? AND course_id=?').get(id, cid);
    if (!row) return fail(res, '课时不存在');
    if (video) db.prepare('UPDATE phonics_course_items SET cate=?, title=?, video=?, size=?, docs=?, sort=? WHERE id=?')
      .run(cate, title, video, Number(b.size) || 0, docs, sort, id);
    else db.prepare('UPDATE phonics_course_items SET cate=?, title=?, docs=?, sort=? WHERE id=?').run(cate, title, docs, sort, id);
    return ok(res, { id }, '已保存');
  }
  if (!video) return fail(res, '请先上传课时视频');
  const info = db.prepare('INSERT INTO phonics_course_items (course_id, cate, title, video, size, docs, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(cid, cate, title, video, Number(b.size) || 0, docs, sort, now());
  ok(res, { id: info.lastInsertRowid }, '课时已添加');
});
admin.post('/course-items/del', (req, res) => {
  const id = Number((req.body || {}).id) || 0;
  if (!id) return fail(res, '参数错误');
  db.prepare('DELETE FROM phonics_course_items WHERE id=?').run(id);
  ok(res, null, '已删除');
});
/** 课时自由排序：前端传全量 [{id, sort}]，按序落库 */
admin.post('/course-items/reorder', (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
  let n = 0;
  for (const it of items) {
    const id = Number(it && it.id) || 0;
    if (!id) continue;
    n += db.prepare('UPDATE phonics_course_items SET sort=? WHERE id=?').run(Number(it.sort) || 0, id).changes;
  }
  ok(res, { updated: n }, '已重新排序');
});
/** 只替换课时视频 key + 大小（H.265 转码回传用，不动其他字段） */
admin.post('/course-items/video-key', (req, res) => {
  const b = req.body || {};
  const id = Number(b.id) || 0;
  const video = str(b.video, 400);
  if (!id || !video) return fail(res, '参数错误');
  const r = db.prepare('UPDATE phonics_course_items SET video=?, size=? WHERE id=?').run(video, Number(b.size) || 0, id);
  if (!r.changes) return fail(res, '课时不存在');
  ok(res, { id }, '已更新');
});

/* ---- 管理端：课程封面 AI 生成（根据课程名称） ---- */
/* 走阿里云百炼 DashScope 文生图（wan2.2-t2i-flash，异步任务），失败用本地 SVG 模板封面兜底。
   ⚠️ 线上 Node 16 没有全局 fetch，必须用 https 模块（与 ai.js 无关，别学它）。 */
const https = require('https');
const AICFG = require('./builtin-config').ai || {};
const DS_BASE = 'https://dashscope.aliyuncs.com/api/v1';
/** 极简 https 请求（Node16 兼容）：返回 {status, headers, buf}，GET 自动跟随最多 3 次重定向 */
const httpsReq = (url, { method = 'GET', headers = {}, body = null, timeout = 30000 } = {}, redirectLeft = 3) => new Promise((resolve, reject) => {
  let u;
  try { u = new URL(url); } catch (e) { return reject(e); }
  const req = https.request(u, { method, headers, timeout }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectLeft > 0 && method === 'GET') {
      res.resume();
      return httpsReq(new URL(res.headers.location, u).href, { method, headers, timeout }, redirectLeft - 1).then(resolve, reject);
    }
    const chunks = [];
    res.on('data', (c2) => chunks.push(c2));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
  });
  req.on('timeout', () => req.destroy(new Error('请求超时')));
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});
const coverPrompt = (title) =>
  `为小学英语音标课程《${title}》设计一张课程封面插画。扁平儿童插画风格，色彩明快和谐，画面点缀字母、发音口型、书本、音符等教育元素，构图简洁有留白，画面中不要出现任何文字，横版 16:9 卡通封面。`;
const coverSvg = (title) => {
  const t = String(title || '音标课程').slice(0, 22);
  const escX = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = 0; for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const palettes = [['#2f6fd8', '#7fb0ff'], ['#1f8c82', '#7ed0c4'], ['#b4762f', '#edc079'], ['#8c4a6b', '#d79cb8'], ['#3f6b4e', '#8cbf9a']];
  const [c1, c2] = palettes[h % palettes.length];
  const dots = Array.from({ length: 16 }, (_, i) =>
    `<circle cx="${(h >> i) % 960}" cy="${(h >> (i + 3)) % 540}" r="${3 + ((h >> (i + 5)) % 9)}" fill="rgba(255,255,255,${(0.10 + ((h >> i) % 3) * 0.06).toFixed(2)})"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect width="960" height="540" fill="url(#g)"/>${dots}`
    + `<circle cx="820" cy="110" r="160" fill="rgba(255,255,255,.10)"/><circle cx="110" cy="460" r="120" fill="rgba(255,255,255,.10)"/>`
    + `<rect x="60" y="66" width="230" height="54" rx="27" fill="rgba(255,255,255,.22)"/>`
    + `<text x="92" y="104" font-size="28" font-weight="700" fill="#fff" font-family="'Microsoft YaHei',sans-serif">音标系统课</text>`
    + `<text x="60" y="300" font-size="66" font-weight="800" fill="#fff" font-family="'Microsoft YaHei',sans-serif">${escX(t)}</text>`
    + `</svg>`;
};
admin.post('/course-cover-ai', async (req, res) => {
  const title = str((req.body || {}).title, 60);
  if (!title) return fail(res, '请先填写课程标题，再生成封面');
  const aiKey = String(AICFG.apiKey || '').trim();
  const tryAi = async () => {
    if (!aiKey) throw new Error('未配置 AI 密钥');
    const sub = await httpsReq(DS_BASE + '/services/aigc/text2image/image-synthesis', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + aiKey, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: 'wan2.2-t2i-flash', input: { prompt: coverPrompt(title) }, parameters: { size: '960*540', n: 1 } }),
    });
    const sj = JSON.parse(sub.buf.toString('utf8') || '{}');
    const taskId = sj && sj.output && sj.output.task_id;
    if (!taskId) throw new Error((sj && sj.message) || '提交生图任务失败');
    for (let i = 0; i < 10; i++) {
      await new Promise((r2) => setTimeout(r2, 3000));
      const st = await httpsReq(DS_BASE + '/tasks/' + taskId, { headers: { Authorization: 'Bearer ' + aiKey } });
      const o = (JSON.parse(st.buf.toString('utf8') || '{}').output) || {};
      if (o.task_status === 'SUCCEEDED') {
        const u = o.results && o.results[0] && o.results[0].url;
        if (!u) throw new Error('AI 未返回图片');
        return u;
      }
      if (o.task_status === 'FAILED' || o.task_status === 'CANCELED' || o.task_status === 'UNKNOWN') throw new Error('AI 绘图失败');
    }
    throw new Error('AI 绘图超时');
  };
  try {
    let buf, name;
    try {
      const url = await tryAi();
      const r = await httpsReq(url, { timeout: 45000 });
      if (r.status !== 200) throw new Error('下载封面失败（' + r.status + '）');
      buf = r.buf;
      name = 'ai-cover-' + Date.now() + '.jpg';
    } catch (e) {
      console.error('[phonics] AI 封面失败，用 SVG 模板兜底：', (e && e.message) || e);
      buf = Buffer.from(coverSvg(title), 'utf8');
      name = 'ai-cover-' + Date.now() + '.svg';
    }
    const saved = await store.saveFile(buf, name, 'phonics/image');
    ok(res, { key: saved.key, size: saved.size, fallback: name.endsWith('.svg') }, '封面已生成');
  } catch (e) {
    fail(res, '封面生成失败：' + ((e && e.message) || '未知错误'));
  }
});

/* ---- 管理端：训练场题库（find 音标侦探 / listen 听力挑战 / sort 分类高手） ---- */
admin.get('/quiz-list', (req, res) => {
  const mode = String(req.query.mode || '');
  const rows = mode && QUIZ_MODES.includes(mode)
    ? db.prepare('SELECT * FROM phonics_quiz_items WHERE mode=? ORDER BY id DESC').all(mode)
    : db.prepare('SELECT * FROM phonics_quiz_items ORDER BY id DESC').all();
  ok(res, rows.map(quizOut));
});

/* ---- 题库 Excel 模板下载 + 批量导入 ---- */
const XLSXQ = require('xlsx');
const QUIZ_MODE_NAMES = { find: '音标侦探', listen: '听力挑战', sort: '分类高手' };
const QUIZ_MODE_BY_NAME = { '音标侦探': 'find', '听力挑战': 'listen', '分类高手': 'sort', find: 'find', listen: 'listen', sort: 'sort' };
/** GET /quiz/template → 训练题库 xlsx 模板（含示例 + 填写说明两个 sheet） */
admin.get('/quiz/template', (req, res) => {
  const HEAD = ['题型', '音标或单词', '选项1', '选项2', '选项3', '选项4', '正确答案'];
  const rows = [
    { '题型': '音标侦探', '音标或单词': '/iː/', '选项1': 'sheep', '选项2': 'ship', '选项3': 'shop', '选项4': 'shape', '正确答案': 'sheep' },
    { '题型': '听力挑战', '音标或单词': 'fish', '选项1': '/i/', '选项2': '/iː/', '选项3': '/e/', '选项4': '/æ/', '正确答案': '/i/' },
    { '题型': '分类高手', '音标或单词': '/ʃ/', '选项1': '', '选项2': '', '选项3': '', '选项4': '', '正确答案': '辅音' },
  ];
  const ws = XLSXQ.utils.json_to_sheet(rows, { header: HEAD });
  ws['!cols'] = HEAD.map((h) => ({ wch: h === '音标或单词' ? 18 : 14 }));
  const help = [
    ['字段', '填写说明'],
    ['题型', '音标侦探 / 听力挑战 / 分类高手（三选一，也接受 find / listen / sort）'],
    ['音标或单词', '音标侦探：填音标（如 /iː/）；听力挑战：填单词（如 fish）；分类高手：填音标'],
    ['选项1~4', '音标侦探：填 4 个单词；听力挑战：填 4 个音标；分类高手：留空（不用填）'],
    ['正确答案', '音标侦探：填其中一个单词；听力挑战：填其中一个音标；分类高手：填 元音 或 辅音'],
    ['', ''],
    ['提示', '示例三行可直接删掉；题目数量不限；保存为 .xlsx 后在管理端点「批量导入」上传'],
  ];
  const ws2 = XLSXQ.utils.aoa_to_sheet(help);
  ws2['!cols'] = [{ wch: 14 }, { wch: 90 }];
  const wb = XLSXQ.utils.book_new();
  XLSXQ.utils.book_append_sheet(wb, ws, '题库模板');
  XLSXQ.utils.book_append_sheet(wb, ws2, '填写说明');
  const buf = XLSXQ.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="phonics-quiz-template.xlsx"');
  res.send(buf);
});
/** POST /quiz/import (multipart file) → 批量导入题库 */
admin.post('/quiz/import', upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, '请选择模板文件');
  let rows;
  try {
    const wb = XLSXQ.read(req.file.buffer, { type: 'buffer' });
    rows = XLSXQ.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) {
    return fail(res, '文件解析失败，请用「下载模板」里的 xlsx 格式');
  }
  const errors = [];
  const items = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const mode = QUIZ_MODE_BY_NAME[String(r['题型'] || '').trim()];
    const sayText = String(r['音标或单词'] || '').trim();
    const options = [1, 2, 3, 4].map((n) => String(r['选项' + n] || '').trim()).filter(Boolean);
    const ans = String(r['正确答案'] || '').trim();
    if (!mode && !sayText && !ans) return; /* 空行跳过 */
    if (!mode) { errors.push('第 ' + line + ' 行：题型无法识别（应为 音标侦探/听力挑战/分类高手）'); return; }
    if (!sayText) { errors.push('第 ' + line + ' 行：「音标或单词」为空'); return; }
    if (!ans) { errors.push('第 ' + line + ' 行：「正确答案」为空'); return; }
    if (mode === 'sort') {
      if (ans !== '元音' && ans !== '辅音') { errors.push('第 ' + line + ' 行：分类高手的正确答案只能填 元音 或 辅音'); return; }
      items.push({ mode, sayText, say: '', options: [], ans });
      return;
    }
    if (options.length < 2) { errors.push('第 ' + line + ' 行：至少填写 2 个选项'); return; }
    if (!options.includes(ans)) { errors.push('第 ' + line + ' 行：正确答案必须是选项之一（' + ans + '）'); return; }
    items.push({ mode, sayText, say: mode === 'listen' ? sayText : '', options, ans });
  });
  if (!items.length) return fail(res, errors[0] || ('没有可导入的题目' + (errors.length ? '，另有 ' + errors.length + ' 条错误' : '')));
  const ins = db.prepare('INSERT INTO phonics_quiz_items (mode, q, say, saytext, options, ans, created_at) VALUES (?,?,?,?,?,?,?)');
  const run = db.transaction(() => {
    let n = 0;
    for (const it of items) {
      ins.run(it.mode, quizQ(it.mode, it.sayText), str(it.say, 400), str(it.sayText, 200), JSON.stringify(it.options), it.ans, now());
      n++;
    }
    return n;
  });
  const added = run();
  ok(res, { added, failed: errors.length, errors: errors.slice(0, 10), sample: 3 }, errors.length ? ('已导入 ' + added + ' 题，' + errors.length + ' 条格式错误被跳过') : '已全部导入');
});

admin.post('/quiz/save', (req, res) => {
  const b = req.body || {};
  const mode = String(b.mode || '');
  if (!QUIZ_MODES.includes(mode)) return fail(res, '请选择题型');
  const sayText = str(b.sayText, 200);
  if (mode !== 'listen' && !sayText) return fail(res, mode === 'find' ? '请填写音标' : '请填写音标');
  if (mode === 'listen' && !sayText) return fail(res, '请填写单词');
  const options = jsonArr(b.options).map((o) => str(o, 100)).filter(Boolean);
  const ans = str(b.ans, 200);
  if (mode !== 'sort' && options.length < 2) return fail(res, '请至少填写 2 个选项');
  if (!ans) return fail(res, '请选择正确答案');
  const q = quizQ(mode, sayText);
  const id = Number(b.id) || 0;
  if (id) {
    db.prepare('UPDATE phonics_quiz_items SET mode=?, q=?, say=?, saytext=?, options=?, ans=? WHERE id=?')
      .run(mode, q, str(b.say, 400), sayText, JSON.stringify(options), ans, id);
    return ok(res, { id }, '已保存');
  }
  const info = db.prepare('INSERT INTO phonics_quiz_items (mode, q, say, saytext, options, ans, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(mode, q, str(b.say, 400), sayText, JSON.stringify(options), ans, now());
  ok(res, { id: info.lastInsertRowid }, '题目已添加');
});
admin.post('/quiz/del', (req, res) => {
  const id = Number((req.body || {}).id) || 0;
  if (!id) return fail(res, '参数错误');
  db.prepare('DELETE FROM phonics_quiz_items WHERE id=?').run(id);
  ok(res, null, '已删除');
});

/* ============================================================ 学生端 */
const stu = express.Router();

/** 学生端：字母歌 + 配套资料（登录后即可查看 / 下载） */
stu.get('/extras', (req, res) => {
  ok(res, extrasOut(normMod(req.query.mod)));
});

/** 学生端：系统课课程（含课时，按排序） */
stu.get('/courses', (req, res) => {
  const mod = normMod(req.query.mod);
  ensureCourseMigrate(mod);
  const courses = db.prepare('SELECT id, title, sub, cover, docs, sort FROM phonics_courses WHERE module=? ORDER BY sort ASC, id ASC').all(mod);
  const items = db.prepare('SELECT id, course_id, cate, title, video, size, docs, sort FROM phonics_course_items ORDER BY sort ASC, id ASC').all();
  ok(res, courses.map((c) => ({
    ...c,
    docs: jsonArr(c.docs),
    items: items.filter((i) => Number(i.course_id) === Number(c.id)).map((i) => ({
      id: i.id, cate: i.cate, title: i.title, video: i.video, size: i.size, sort: i.sort, docs: jsonArr(i.docs),
    })),
  })));
});

/** 学生端：训练场题库（按题型；题库不足时学生端自动回退内置出题） */
stu.get('/quiz-list', (req, res) => {
  const mode = String(req.query.mode || '');
  if (!QUIZ_MODES.includes(mode)) return ok(res, []);
  ok(res, db.prepare('SELECT * FROM phonics_quiz_items WHERE mode=? ORDER BY id ASC').all(mode).map(quizOut));
});

stu.get('/list', (req, res) => {
  const kind = normKind(req.query.kind);
  const rows = db.prepare(`SELECT ${COLS} FROM phonics_items WHERE kind=? ORDER BY sort ASC, id ASC`).all(kind);
  ok(res, rows.map((r) => ({
    id: r.id, code: r.code, title: r.title, type: r.type, grp: r.grp, groupName: r.group_name,
    sub: r.sub, len: r.len, cue: r.cue, mnemonic: r.mnemonic, emoji: r.emoji, tip: r.tip, spell: r.spell,
    audio: r.audio, stroke: r.stroke, videoMouth: r.video_mouth, videoTeach: r.video_teach,
    samples: jsonArr(r.samples), files: jsonArr(r.files),
  })));
});

/** 训练场作答记录（只统计，不进错词本） */
stu.post('/record', (req, res) => {
  const b = req.body || {};
  ok(res, { ok: true, module: str(b.module, 20), right: Number(b.right) || 0, total: Number(b.total) || 0 });
});

module.exports = { admin, stu };
