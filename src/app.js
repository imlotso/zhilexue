'use strict';
/**
 * 学习系统主服务
 *  - 学生端：  http://localhost:3000/
 *  - 管理端：  http://localhost:3000/admin/
 *  - 接口前缀：/api
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { db, DATA_DIR, DB_INFO } = require('./db');
const { resolveDifficulty } = require('./difficulty');
const { hash, check, sign, auth, signFileTicket, verifyFileTicket } = require('./auth');
const store = require('./storage');
const accuracy = require('./accuracy');
const { makeTemplate, parseWorkbook } = require('./excel');
const { speakToBuffer } = require('./win-speak');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const careAudio = require('./care-audio').createCareAudio({ db, dataDir: DATA_DIR, publicDir: PUBLIC, auth });
// Block every historical public-audio path before routers or static mounts.
app.use(careAudio.legacyBoundary);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ------------------------------------------------------------------ 基础安全响应头
// 不引入 helmet 依赖，几行足够覆盖常见风险：
//   nosniff        —— 禁止浏览器按内容猜类型（防止上传的文件被当作 HTML/JS 执行）
//   SAMEORIGIN     —— 只允许同源 iframe 嵌套（讲义打印预览依赖同源 iframe，不能用 DENY）
//   Referrer-Policy—— 跨站请求不带完整地址（避免 URL 里的 token/key 通过 Referer 外泄）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// 小文件（表格 / 图片 / 讲义）走内存：体积可控、处理链路简单
const upload = multer({ storage: multer.memoryStorage(), limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: 100 * 1024 * 1024 } });

// 视频走磁盘暂存：上传过程完全不占内存（2G 内存的服务器也能安全收几百 MB 的视频），
// 落盘后交给存储层直接搬走（本地驱动 rename、云端驱动流式上传），处理完立刻删掉临时文件。
const TMP_DIR = path.join(DATA_DIR, 'tmp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { /* 目录已存在 */ }
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, 'v' + Date.now() + '-' + Math.random().toString(16).slice(2, 10)),
  }),
  limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: 4 * 1024 * 1024 * 1024 },
});

/** 收完视频后清掉磁盘暂存的临时文件（本地驱动可能已 rename 走，删不到就忽略） */
function dropTmp(file) {
  if (!file || !file.path) return;
  try { fs.unlinkSync(file.path); } catch (e) { /* 已搬走 / 已删除 */ }
}

// ------------------------------------------------------------------ 工具
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败', code = 1) => res.json({ code, msg });

/**
 * 把当前请求的登录票据拼到「本地文件代理地址」后面。
 *
 * 为什么必须这么做：<video> / <iframe> / <img> 这些标签是浏览器自己发起的直连请求，
 * 没法像 fetch 那样加 Authorization 头，票据只能放在 URL 上。
 * /api/file 是需要登录的接口，少了 token 就会被 401 打回——
 * 学生端的表现就是「点了播放，转圈或者一片黑，视频出不来」。
 * 只处理 /api/file 开头的本地代理地址；七牛 / OSS 的签名外链原样返回。
 */
function withFileTicket(url, req) {
  const u = String(url || '');
  if (!u.startsWith('/api/file?')) return u;      // 外链 / 云存储签名地址：不动
  if (/([?&])token=/.test(u)) return u;           // 已经带了，不重复拼
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || '');
  return token ? u + '&token=' + encodeURIComponent(token) : u;
}

/** 题图只读票据（R0-B9）：把 JSON 响应里本地存储的题库图片地址 /api/file?key=bank/img/xxx.png 补上
 *  &ft=<只读这一个文件的短时票据>。<img> 发不了 Authorization 头；不用登录令牌是为了不把整个登录态暴露在 URL / 日志 / Referer 里。
 *  只处理：本地代理地址、题库目录（bank/，目录名可在设置里改）、图片扩展名。已有的旧 ft（题目保存时带进库里的）会被换成新的。 */
const TICKET_IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
function addBankImgTickets(str) {
  let folder = 'bank';
  try { folder = require('./mfbank').bankFolder(); } catch (e) { /* 用默认值 */ }
  return str.replace(/(\/api\/file\?key=)([A-Za-z0-9_%.\-\/]+)(&ft=[A-Za-z0-9_.\-]+)?/g, (m, head, rawKey) => {
    let key = rawKey;
    try { key = decodeURIComponent(rawKey); } catch (e) { return m; }
    const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
    if (!TICKET_IMG_EXT.has(ext) || key.includes('..')) return m;
    if (!(store.isBankKey(key) || store.isBankKey(key, folder))) return m;
    return head + rawKey + '&ft=' + signFileTicket(key);
  });
}
function bankImgTicketJson(req, res, next) {
  res.json = function (body) {
    let folder = 'bank';
    try { folder = require('./mfbank').bankFolder(); } catch (_) { /* 使用默认目录 */ }
    const normalized = require('./bank-images').normalizeBankImages(body, folder);
    let s = JSON.stringify(normalized);
    if (s === undefined) return res.send();
    if (s.includes('/api/file?key=')) s = addBankImgTickets(s);
    if (!res.get('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8');
    return res.send(s);
  };
  next();
}

/** 判断题答案 */
function judge(q, myAnswer) {
  const mine = String(myAnswer == null ? '' : myAnswer).trim();
  const ans = String(q.answer || '').trim();
  if (q.type === 'fill') {
    const a = ans.split('|').map((s) => s.trim().toLowerCase().replace(/\s+/g, ''));
    const b = mine.split('|').map((s) => s.trim().toLowerCase().replace(/\s+/g, ''));
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  const norm = (s) => /^[A-J\s,，、;；]+$/i.test(s) ? [...new Set((s.toUpperCase().match(/[A-J]/g) || []))].sort().join(',') : '';
  return norm(ans) !== '' && norm(ans) === norm(mine);
}

const parseQ = (row) => {
  if (!row) return row;
  let options = [];
  try { options = JSON.parse(row.options || '[]'); } catch (e) { options = []; }
  return { ...row, options };
};

/** multer 会把中文文件名按 latin1 解码，这里还原成 UTF-8，否则中文文件名乱码 */
function fixFileName(name) {
  if (!name) return name;
  if (!/[\u0080-\u00ff]/.test(name)) return name; // 纯 ASCII，无需处理
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    return fixed.includes('\uFFFD') ? name : fixed;
  } catch (e) { return name; }
}

// ------------------------------------------------------------------ 登录限流
// 内存计数即可：服务按单进程部署，重启清零不影响安全。
// 作用：阻止脚本对同一 IP 高频撞库；正常用户连续输错几次不会被误伤。
const LOGIN_WINDOW = 15 * 60 * 1000;   // 统计窗口 15 分钟
const LOGIN_MAX_FAIL = 20;             // 窗口内最多失败 20 次
const loginFails = new Map();          // ip -> { n, at }
function clientIp(req) {
  const sock = String(req.socket.remoteAddress || 'unknown');
  // 只有当连接来自「本机 / 内网反向代理」（宝塔 Nginx 反代就是 127.0.0.1）时才采信 X-Forwarded-For，
  // 否则直连用户随手伪造一个 XFF 头就能绕过限流。公网直连一律用 TCP 源地址。
  const localProxy = sock === '::1' || /^::ffff:127\./.test(sock) || /^127\./.test(sock)
    || /^10\./.test(sock) || /^192\.168\./.test(sock) || /^172\.(1[6-9]|2\d|3[01])\./.test(sock);
  if (localProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return sock;
}
function loginBlocked(ip) {
  const r = loginFails.get(ip);
  if (!r) return false;
  if (Date.now() - r.at > LOGIN_WINDOW) { loginFails.delete(ip); return false; }
  return r.n >= LOGIN_MAX_FAIL;
}
function loginFail(ip) {
  const r = loginFails.get(ip);
  if (!r || Date.now() - r.at > LOGIN_WINDOW) loginFails.set(ip, { n: 1, at: Date.now() });
  else r.n++;
  // 顺手清理过期记录，避免 map 无限增长
  if (loginFails.size > 5000) {
    for (const [k, v] of loginFails) if (Date.now() - v.at > LOGIN_WINDOW) loginFails.delete(k);
  }
}

// ---------------- 操作日志（总后台「系统 > 操作日志」） ----------------
// 记录：所有角色的登录成功/失败 + 后台的增删改操作。写入失败不影响主流程。
const AUDIT_ROLE = { admin: '校长', branch: '分校', student: '学生' };
function auditWrite(o) {
  try {
    db.prepare(`INSERT INTO audit_logs (user_id,username,name,role,action,module,method,path,ip,ok,detail,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.user_id || null, String(o.username || ''), String(o.name || ''), String(o.role || ''),
        String(o.action || ''), String(o.module || ''), String(o.method || ''), String(o.path || ''),
        String(o.ip || ''), o.ok === false ? 0 : 1, String(o.detail || '').slice(0, 500), now());
    // 低频修剪：只保留最近 7 天（前台只展示 7 天，过期直接删除，不在库里留旧数据占空间）
    if (Math.random() < 0.05) {
      db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(auditCutBefore());
    }
  } catch (e) { console.error('[audit]', (e && e.message) || e); }
}
/** 后台接口路径 → 模块名（操作日志展示用） */
const AUDIT_MODULE = [
  [/^\/students/, '学生管理'], [/^\/branches/, '分校管理'], [/^\/chapters|^\/sections/, '课程目录'],
  [/^\/videos/, '视频管理'], [/^\/handouts/, '讲义资料'], [/^\/video-order/, '视频管理'],
  [/^\/word/, '词书管理'], [/^\/bank/, '智能题库'], [/^\/paper\/|^\/papers/, '智能题库'],
  [/^\/phonics/, '发音训练'], [/^\/ai/, 'AI 配置'], [/^\/report/, '学情报告'],
  [/^\/wrong/, '错题重组'], [/^\/sites/, '常用网站'], [/^\/guides/, '使用说明'],
  [/^\/xreport/, '学习报告'], [/^\/logs/, '操作日志'],
];
const auditModuleOf = (p) => (AUDIT_MODULE.find(([re]) => re.test(p)) || [])[1] || '其他';

/** 7 天前的时间串（操作日志保留期限） */
const auditCutBefore = () => {
  const d = new Date(Date.now() - 7 * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

// ---------------- IP 归属地解析（百度 opendata 免费接口，内存缓存 7 天，仅操作日志页展示用） ----------------
const https = require('https');
const ipGeoCache = new Map();                 // ip -> { loc, at }
const IP_GEO_TTL = 7 * 24 * 3600 * 1000;
const ipGeoOf = (ip) => {
  const c = ipGeoCache.get(String(ip || ''));
  return c && Date.now() - c.at < IP_GEO_TTL ? c.loc : '';
};
function ipGeoLookup(ip) {
  return new Promise((resolve) => {
    const req = https.get(`https://opendata.baidu.com/api.php?query=${encodeURIComponent(ip)}&resource_id=6006&oe=utf8`, { timeout: 3000 }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; if (d.length > 8192) req.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
async function ipGeoResolve(rawIp) {
  const ip = String(rawIp || '').replace(/^::ffff:/i, '');   // IPv4-mapped IPv6 前缀归一化
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return '';
  // 内网 / 本机地址直接标记，不发外网请求
  if (ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    ipGeoCache.set(String(rawIp), { loc: '内网', at: Date.now() });
    return '内网';
  }
  const j = await ipGeoLookup(ip);
  let loc = '';
  if (j && j.status === '0' && Array.isArray(j.data) && j.data[0] && j.data[0].location) {
    loc = String(j.data[0].location).trim().split(/\s+/)[0].replace(/省|市/g, '') || '';  // 「江苏省徐州市 电信」→「江苏徐州」
  }
  if (loc) {
    ipGeoCache.set(String(rawIp), { loc, at: Date.now() });
    if (ipGeoCache.size > 3000) for (const [k, v] of ipGeoCache) if (Date.now() - v.at > IP_GEO_TTL) ipGeoCache.delete(k);
  }
  return loc; // 查询失败不缓存，下次打开日志页自动重试
}


// ------------------------------------------------------------------ 鉴权
app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  if (loginBlocked(ip)) return fail(res, '密码错误次数过多，请 15 分钟后再试');
  const { username, password, role } = req.body || {};
  if (!username || !password) return fail(res, '请输入账号和密码');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  // 账号不存在与密码错误返回同一句提示，避免被用来枚举有效账号
  if (!u) {
    loginFail(ip);
    auditWrite({ username: String(username).trim(), role: AUDIT_ROLE[role] || '', action: '登录', module: '认证', method: 'POST', path: '/api/login', ip, ok: false, detail: '账号或密码不正确' });
    return fail(res, '账号或密码不正确');
  }
  if (!check(String(password), u.password)) {
    loginFail(ip);
    auditWrite({ user_id: u.id, username: u.username, name: u.name, role: AUDIT_ROLE[u.role] || u.role, action: '登录', module: '认证', method: 'POST', path: '/api/login', ip, ok: false, detail: '密码错误' });
    return fail(res, '账号或密码不正确');
  }
  if (u.status !== 1) {
    auditWrite({ user_id: u.id, username: u.username, name: u.name, role: AUDIT_ROLE[u.role] || u.role, action: '登录', module: '认证', method: 'POST', path: '/api/login', ip, ok: false, detail: '账号已被停用' });
    return fail(res, '账号已被停用，请联系管理员');
  }
  // 到期时间：填了就以它为准（当天仍可用），过期后不允许登录（学生账号与分校账号都生效）
  if (['student', 'branch'].includes(u.role) && u.expire_at && String(u.expire_at).slice(0, 10) < now().slice(0, 10)) {
    auditWrite({ user_id: u.id, username: u.username, name: u.name, role: AUDIT_ROLE[u.role] || u.role, action: '登录', module: '认证', method: 'POST', path: '/api/login', ip, ok: false, detail: `账号已到期（${String(u.expire_at).slice(0, 10)}）` });
    return fail(res, `账号已于 ${String(u.expire_at).slice(0, 10)} 到期，请${u.role === 'branch' ? '联系校长' : '联系老师'}续期`);
  }
  if (role === 'student' && u.role !== 'student') return fail(res, '该账号是后台账号，请使用校长后台登录');
  if (role === 'admin' && !['admin', 'branch'].includes(u.role)) return fail(res, '学生请使用学生端登录');
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), u.id);
  loginFails.delete(ip);   // 登录成功，清掉该 IP 的失败计数
  auditWrite({ user_id: u.id, username: u.username, name: u.name, role: AUDIT_ROLE[u.role] || u.role, action: '登录', module: '认证', method: 'POST', path: '/api/login', ip, ok: true, detail: `登录成功（${u.role === 'student' ? '学生端' : '管理后台'}）` });
  const token = sign({ id: u.id, role: u.role, username: u.username, name: u.name });
  ok(res, { token, user: publicUser(u) }, '登录成功');
});

// ---------------- 学段（小学 / 初中） ----------------
// 学段决定「专项提升、中考冲刺」两类课程能看到哪些内容（这两类不再按年级和上下册过滤）。
// 学生账号可以在后台手动指定；没指定时按年级自动推断（一~六年级 = 小学，七~九年级 / 中考冲刺 = 初中）。
const PRIMARY_GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
const JUNIOR_GRADES = ['七年级', '八年级', '九年级', '中考冲刺'];
const stageOfGrade = (stage, grade) => {
  const s = String(stage || '').trim().toLowerCase();
  if (s === 'primary' || s === 'junior') return s;
  const g = String(grade || '').trim();
  if (PRIMARY_GRADES.includes(g)) return 'primary';
  if (JUNIOR_GRADES.includes(g)) return 'junior';
  return '';   // 未设置：专项/中考都看不到，同步类仍按年级走
};
const STAGE_NAME = { primary: '小学', junior: '初中' };
const stageName = (s) => STAGE_NAME[s] || '';
const CATEGORIES = ['同步基础', '同步培优', '专项提升', '中考冲刺'];
const CATEGORY_RENAME = {
  '同步学': '同步基础', '培优学': '同步培优', '技巧课': '专项提升', '语法': '专项提升',
  '专项课': '专项提升', '专项提升·小学': '专项提升', '专项提升·初中': '专项提升', '': '同步基础',
};
/** 章节写库前统一分类名 & 学段：专项提升按学段，中考冲刺固定初中，同步类不记学段 */
function normChapter(subject, grade, category, stage) {
  const cat = CATEGORY_RENAME[String(category || '').trim()] || String(category || '').trim();
  let st = '';
  if (cat === '专项提升') st = stageOfGrade(stage, grade) || '';
  else if (cat === '中考冲刺') st = 'junior';
  return { category: cat, grade: String(grade || '').trim(), stage: st };
}

// 学生头像池：public/img/av/p1.jpg ~ p10.jpg，创建学生时随机取一个
const STUDENT_AVATARS = Array.from({ length: 10 }, (_, i) => '/img/av/p' + (i + 1) + '.jpg');
const randAvatar = () => STUDENT_AVATARS[Math.floor(Math.random() * STUDENT_AVATARS.length)];

const publicUser = (u) => ({
  id: u.id, role: u.role, username: u.username, name: u.name,
  grade: u.grade, term: u.term || '', subject: u.subject, level: u.level,
  stage: stageOfGrade(u.stage, u.grade),
  status: u.status, expire_at: u.expire_at, class_id: u.class_id,
  avatar: u.avatar || '',
  allow_speed: u.allow_speed === undefined || u.allow_speed === null ? 1 : Number(u.allow_speed),
  allow_seek: u.allow_seek === undefined || u.allow_seek === null ? 1 : Number(u.allow_seek),
});

app.get('/api/me', auth(), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return fail(res, '用户不存在');
  ok(res, publicUser(u));
});

app.post('/api/change-password', auth(), (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return fail(res, '新密码至少 6 位');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!check(String(oldPassword || ''), u.password)) return fail(res, '原密码错误');
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash(String(newPassword)), u.id);
  ok(res, null, '密码修改成功');
});

// ------------------------------------------------------------------ 文件下载 / 在线预览
// 存储键白名单：目录/年月/随机名.扩展名（storage.buildKey 生成的就是这个形状）。
// 只允许字母数字、下划线、短横线与 / ，从字符集层面杜绝路径穿越与畸形路径。
const FILE_KEY_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]{1,8}$/;
const RISKY_EXT = ['html', 'htm', 'xhtml', 'svg', 'xml'];
const INLINE_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
};

/** /api/file 的鉴权：带了有效的题图只读票据（ft，只对 bank/ 下的图片、且绑定这个 key）就放行，否则照旧要登录 */
function fileAuth(req, res, next) {
  const key = String(req.query.key || '');
  if (req.query.ft && /\.(png|jpe?g|gif|webp)$/i.test(key) && !key.includes('..') && verifyFileTicket(key, req.query.ft)
    && (store.isBankKey(key) || store.isBankKey(key, require('./mfbank').bankFolder()))) return next();
  return auth()(req, res, next);
}
app.get('/api/file', fileAuth, async (req, res) => {
  const key = String(req.query.key || '');
  if (!key || key.includes('..') || key.includes('\\') || !FILE_KEY_RE.test(key)) {
    return res.status(400).send('bad request');
  }
  const viewer = req.user && (req.user.role === 'student' ? db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id) : req.user);
  if (!require('./video-file-access').canReadVideoFile(db, viewer, key, canSeeChapter)) return res.status(403).send('无权访问该课程视频');
  if (careAudio.protectFile(store.localPath(key), res)) return;
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const wantInline = String(req.query.inline || '') === '1';
  // 下载名补真实扩展名：前端传的 name 常是讲义标题（如「打印出来辅助学习」，无后缀），
  // 不补的话浏览器收到的附件没有扩展名，Windows 识别不了类型（PDF 变未知文件打不开）。
  let dlName = String(req.query.name || '');
  if (dlName && ext && !dlName.toLowerCase().endsWith('.' + ext)) dlName += '.' + ext;
  // 弹窗里用 iframe 预览 PDF / 图片时，不能 302 到云存储：浏览器的 PDF 查看器跟不过跨域跳转，窗口会是一片白。
  if (wantInline && INLINE_MIME[ext]) {
    let buf;
    try { buf = await store.readBuffer(key); }
    catch (_) { return res.status(500).send('文件读取失败'); }
    if (!buf) return res.status(404).send('文件不存在');
    res.setHeader('Content-Type', INLINE_MIME[ext]);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  }
  let abs;
  try {
    if (store.isCloudKey(key)) return res.redirect(await store.getUrl(key, wantInline ? undefined : (dlName || undefined)));
    abs = store.localFilePath(key);
  } catch (_) { return res.status(500).send('文件读取失败'); }
  if (!abs) return res.status(404).send('文件不存在');
  if (wantInline) {
    // 在线预览（学生端「打印讲义 / 打印习题」用浏览器自带打印）：样式与排版照常，脚本一律禁止
    res.setHeader('Content-Disposition', 'inline');
    if (RISKY_EXT.includes(ext)) res.setHeader('Content-Security-Policy', 'sandbox');
  } else if (dlName) {
    const ascii = dlName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(dlName)}`);
  } else if (RISKY_EXT.includes(ext)) {
    // 没明确要求预览的可执行类型：直接当附件下载，绝不让浏览器在站点域名下渲染它
    res.setHeader('Content-Disposition', 'attachment');
  }
  res.sendFile(abs);
});

// ================================================================== 管理端（校长 admin / 分校 branch，权限完全一致）
const admin = express.Router();
admin.use(auth(true));
admin.use((req, res, next) => {
  if (!['admin', 'branch'].includes(req.user.role)) return res.status(403).json({ code: 403, msg: '无权限' });
  next();
});
// 后台增删改操作 → 操作日志（响应完成后落库，带结果成败；查询类不记）
admin.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const started = Date.now();
  res.on('finish', () => {
    try {
      const u = req.user || {};
      const base = String(req.baseUrl || '').replace(/^\/api\/admin\/?/, '');
      const p = '/' + base + String(req.path || '');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // 敏感字段脱敏后写入详情（字段比之前更全，便于核对具体改了什么）
      const safe = {};
      for (const k of ['name', 'title', 'stem', 'grade', 'ids', 'kind', 'subject', 'bookId', 'status', 'max_students', 'expire_at',
        'username', 'phone', 'chapter_id', 'section_id', 'video_id', 'point', 'branch_id', 'note', 'reason', 'type', 'paper_id', 'question_id', 'word', 'answer']) {
        if (body[k] !== undefined && body[k] !== '') safe[k] = body[k];
      }
      let detail = '';
      try { detail = JSON.stringify(safe); } catch (e) { detail = ''; }
      auditWrite({
        user_id: u.id, username: u.username, name: u.name,
        role: AUDIT_ROLE[u.role] || u.role,
        action: req.method === 'DELETE' ? '删除' : req.method === 'PUT' ? '修改' : '新增/提交',
        module: auditModuleOf(base + req.path),
        method: req.method, path: p.slice(0, 120), ip: clientIp(req),
        ok: res.statusCode < 400,
        detail: `${res.statusCode < 400 ? '成功' : '失败'}(${res.statusCode}) ${(detail || '').slice(0, 400)} ${Date.now() - started}ms`,
      });
    } catch (e) { /* 日志不影响主流程 */ }
  });
  next();
});

const isPrincipal = (req) => req.user.role === 'admin';

// 管理端纸质化生成（词书管理页）：与学生端同款默写表。数据走 /api/admin/word/*（已有），
// AI 句子拆解与 PDF 导出直接复用学生端的处理函数（文件后部定义，函数声明提升，运行时可用）
admin.post('/paper/sent-structs', (req, res, next) => sentStructsHandler(req, res).catch(next));
admin.post('/paper/pdf', upload.array('pages', 12), paperPdfHandler);

// ---------- 危险操作密码：讲义 / 视频 / 词书 的 单个删除 与 批量删除 都必须带上这个密码 ----------
// 实现在 src/delpwd.js（词书模块也要用同一份，避免两边不一致留下绕过口子）
const { delPwdOk } = require('./delpwd');

// ---------- 分校管理（仅校长可操作） ----------
admin.get('/branches', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可管理分校', 403);
  const rows = db.prepare(`
    SELECT u.id, u.code, u.username, u.name, u.phone, u.status, u.created_at, u.last_login, u.max_students, u.expire_at,
      (SELECT COUNT(*) FROM users s WHERE s.role='student' AND s.created_by=u.id) AS students
    FROM users u WHERE u.role='branch' ORDER BY u.code ASC, u.id ASC`).all();
  ok(res, rows);
});

admin.post('/branches', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可开通分校', 403);
  const { username, name, password, max_students, expire_at } = req.body || {};
  if (!username || !name) return fail(res, '分校账号和名称必填');
  if (!/^1\d{10}$/.test(String(username).trim())) return fail(res, '登录账号需为 11 位手机号');
  if (db.prepare('SELECT id FROM users WHERE username=?').get(String(username).trim())) return fail(res, '该账号已存在');
  // 分校编号：取已有最大编号 +1，开通后固定不变（改名称 / 换登录手机号都不影响编号与绑定关系）
  const maxCode = db.prepare("SELECT code FROM users WHERE role='branch'").all()
    .reduce((m, r) => Math.max(m, /^\d+$/.test(r.code || '') ? Number(r.code) : 0), 0);
  const code = String(maxCode + 1).padStart(3, '0');
  const maxStudents = Math.max(0, Number(max_students) || 0);
  const expireAt = String(expire_at || '').trim().slice(0, 10);
  const info = db.prepare("INSERT INTO users (role,code,username,password,name,status,max_students,expire_at,created_at) VALUES ('branch',?,?,?,?,1,?,?,?)")
    .run(code, String(username).trim(), hash(String(password || '123456')), String(name).trim(), maxStudents, expireAt, now());
  ok(res, { id: info.lastInsertRowid, code }, `分校已开通，编号 ${code}`);
});

// 编辑分校：编号固定不可改；名称 / 登录手机号(username) / 状态 / 密码 / 学生人数上限 / 到期时间（未传的字段保留原值）
// 学生与学情按分校的用户 id 绑定（created_by），改名称 / 换手机号均不影响绑定
admin.put('/branches/:id', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可管理分校', 403);
  const cur = db.prepare("SELECT * FROM users WHERE id=? AND role='branch'").get(Number(req.params.id));
  if (!cur) return fail(res, '分校不存在');
  const b = req.body || {};
  const name = b.name === undefined ? cur.name : String(b.name).trim();
  if (!name) return fail(res, '分校名称不能为空');
  let username = cur.username;
  if (b.username !== undefined) {
    username = String(b.username).trim();
    if (!/^1\d{10}$/.test(username)) return fail(res, '登录账号需为 11 位手机号');
    if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username, cur.id)) return fail(res, '该手机号已被其他账号使用');
  }
  const status = b.status === undefined ? cur.status : Number(b.status);
  const maxStudents = b.max_students === undefined ? (cur.max_students || 0) : Math.max(0, Number(b.max_students) || 0);
  const expireAt = b.expire_at === undefined ? (cur.expire_at || '') : String(b.expire_at || '').trim().slice(0, 10);
  const password = b.password ? hash(String(b.password)) : cur.password;
  db.prepare("UPDATE users SET name=?, username=?, phone=?, status=?, max_students=?, expire_at=?, password=? WHERE id=? AND role='branch'")
    .run(name, username, username, status, maxStudents, expireAt, password, cur.id);
  ok(res, { username }, '已保存');
});

// 修改分校账号手机号（登录账号与手机号合一，两处同步）
admin.put('/branches/:id/phone', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可管理分校', 403);
  const phone = String((req.body || {}).phone || '').trim();
  if (phone && !/^1\d{10}$/.test(phone)) return fail(res, '手机号格式不正确');
  if (phone && db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(phone, Number(req.params.id))) return fail(res, '该手机号已被其他账号使用');
  db.prepare("UPDATE users SET phone=?, username=CASE WHEN ?<>'' THEN ? ELSE username END WHERE id=? AND role='branch'").run(phone, phone, phone, Number(req.params.id));
  ok(res, { phone }, '登录手机号已保存');
});

admin.post('/branches/:id/reset-password', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可管理分校', 403);
  const pwd = String((req.body && req.body.password) || '123456');
  db.prepare("UPDATE users SET password=? WHERE id=? AND role='branch'").run(hash(pwd), Number(req.params.id));
  ok(res, { password: pwd }, `分校密码已重置为 ${pwd}`);
});

admin.delete('/branches/:id', (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅校长可管理分校', 403);
  db.prepare("DELETE FROM users WHERE id=? AND role='branch'").run(Number(req.params.id));
  ok(res, null, '分校账号已删除');
});

// ---------- 学生管理 ----------
admin.get('/students', (req, res) => {
  const { kw = '', grade = '', status = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 10));
  let where = ` WHERE u.role='student'`;
  const args = [];
  if (req.user.role === 'branch') { where += ' AND u.created_by=?'; args.push(req.user.id); }   // 分校只见本校区学生
  if (kw) { where += ' AND (u.name LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (grade) { where += ' AND u.grade = ?'; args.push(grade); }
  if (status !== '') { where += ' AND u.status = ?'; args.push(Number(status)); }
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM users u${where}`).get(...args) || {}).n || 0);
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const pageSafe = Math.min(page, pages);
  const rows = db.prepare(`SELECT u.* FROM users u${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (pageSafe - 1) * size)
    .map((u) => ({
      ...publicUser(u),
      created_at: u.created_at, last_login: u.last_login,
    }));
  ok(res, { list: rows, total, page: pageSafe, size });
});

/** 开通/编辑学生时的必填校验：年级、到期时间必须有值（看板与学生管理页都靠它） */
const checkStudentFields = (grade, expireAt) => {
  if (!String(grade || '').trim()) return '请选择年级';
  const exp = String(expireAt || '').trim();
  if (!exp) return '请填写到期时间';
  if (!/^\d{4}-\d{2}-\d{2}/.test(exp)) return '到期时间格式应为 YYYY-MM-DD';
  return '';
};

/** 学生学段：手动指定优先，否则按年级推断 */
const studentStage = (stage, grade) => {
  const s = stageOfGrade(stage, grade);
  if (!s) return { value: '', err: '请选择学段（小学 / 初中）' };
  const g = String(grade || '').trim();
  if (PRIMARY_GRADES.includes(g) && s !== 'primary') return { value: '', err: `学段与年级不一致：${g} 属于小学` };
  if (JUNIOR_GRADES.includes(g) && s !== 'junior') return { value: '', err: `学段与年级不一致：${g} 属于初中` };
  return { value: s, err: '' };
};

/** 册别取值：上册 / 下册 / ''（不限制，上下册都能看）；容错处理「上」「下」「七上」等写法 */
const TERMS = ['上册', '下册'];
function termText(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (TERMS.includes(s)) return s;
  if (s.includes('下')) return '下册';
  if (s.includes('上')) return '上册';
  return '';
}

// 分校学生人数上限：返回 {max, cur}；未设上限返回 null
const branchStudentLimit = (uid) => {
  const b = db.prepare("SELECT max_students FROM users WHERE id=? AND role='branch'").get(uid);
  if (!b || !Number(b.max_students)) return null;
  const n = Number((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='student' AND created_by=?").get(uid) || {}).n || 0);
  return { max: Number(b.max_students), cur: n };
};

admin.post('/students', (req, res) => {
  const { username, name, password, grade, term, subject, level, expire_at, allow_speed, stage } = req.body || {};
  if (!username || !name) return fail(res, '账号和姓名必填');
  if (req.user.role === 'branch') {
    const lim = branchStudentLimit(req.user.id);
    if (lim && lim.cur >= lim.max) return fail(res, `本校学生人数已达上限（${lim.max} 人），请联系校长调整`);
  }
  const bad = checkStudentFields(grade, expire_at);
  if (bad) return fail(res, bad);
  const st = studentStage(stage, grade);
  if (st.err) return fail(res, st.err);
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
  if (exists) return fail(res, '该账号已存在');
  const speed = Number(allow_speed) === 0 ? 0 : 1;
  const info = db.prepare(`INSERT INTO users (role,username,password,name,phone,grade,stage,term,subject,level,allow_speed,allow_seek,avatar,expire_at,created_by,created_at)
    VALUES ('student',?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(
    String(username).trim(), hash(String(password || '123456')), String(name).trim(), '',
    String(grade).trim(), st.value, termText(term), subject || '', level || 'basic', speed,
    randAvatar(), String(expire_at).slice(0, 10), req.user.id, now()
  );
  ok(res, { id: info.lastInsertRowid }, '学生账号创建成功');
});

admin.put('/students/:id', (req, res) => {
  const { name, username, phone, grade, term, subject, level, status, expire_at, allow_speed, stage } = req.body || {};
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id);
  if (!cur) return fail(res, '学生不存在');
  if (req.user.role === 'branch' && cur.created_by !== req.user.id) return fail(res, '无权操作其他分校的学生', 403);
  const bad = checkStudentFields(grade, expire_at);
  if (bad) return fail(res, bad);
  const st = studentStage(stage, grade);
  if (st.err) return fail(res, st.err);
  const speed = allow_speed === undefined ? (cur.allow_speed === 0 ? 0 : 1) : (Number(allow_speed) === 0 ? 0 : 1);
  // 前端表单没带的字段（手机号、科目等）不能被写空：undefined 才保留原值，显式传空串才清空
  const keep = (v, curV) => (v === undefined ? curV : String(v).trim());
  const nu = keep(username, cur.username);
  if (nu !== cur.username && db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(nu, id)) {
    return fail(res, '该账号已被其他用户使用');
  }
  db.prepare(`UPDATE users SET name=?, username=?, phone=?, grade=?, stage=?, term=?, subject=?, level=?, allow_speed=?, allow_seek=1, status=?, expire_at=? WHERE id=? AND role='student'`)
    .run(keep(name, cur.name), nu, keep(phone, cur.phone), String(grade).trim(), st.value, termText(term),
      keep(subject, cur.subject), keep(level, cur.level) || 'basic', speed,
      status === undefined ? 1 : Number(status), String(expire_at).slice(0, 10), id);
  ok(res, null, '保存成功');
});

// 单独切换某个学生的「视频倍速播放」权限（列表里一键开关）
admin.post('/students/:id/speed', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id);
  if (!cur) return fail(res, '学生不存在');
  if (req.user.role === 'branch' && cur.created_by !== req.user.id) return fail(res, '无权操作其他分校的学生', 403);
  const next = Number((req.body || {}).allow_speed) === 0 ? 0 : 1;
  db.prepare('UPDATE users SET allow_speed=? WHERE id=?').run(next, id);
  ok(res, { allow_speed: next }, next ? '已开启倍速播放' : '已禁止倍速播放');
});

admin.post('/students/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id);
  if (!cur) return fail(res, '学生不存在');
  if (req.user.role === 'branch' && cur.created_by !== req.user.id) return fail(res, '无权操作其他分校的学生', 403);
  const pwd = String((req.body && req.body.password) || '123456');
  db.prepare('UPDATE users SET password=? WHERE id=? AND role=\'student\'').run(hash(pwd), id);
  ok(res, { password: pwd }, `密码已重置为 ${pwd}`);
});

admin.delete('/students/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id);
  if (!cur) return fail(res, '学生不存在');
  if (req.user.role === 'branch' && cur.created_by !== req.user.id) return fail(res, '无权操作其他分校的学生', 403);
  db.prepare('DELETE FROM users WHERE id=? AND role=\'student\'').run(id);
  db.prepare('DELETE FROM records WHERE user_id=?').run(id);
  db.prepare('DELETE FROM mistakes WHERE user_id=?').run(id);
  db.prepare('DELETE FROM progress WHERE user_id=?').run(id);
  db.prepare('DELETE FROM practices WHERE user_id=?').run(id);
  db.prepare('DELETE FROM word_records WHERE student_id=?').run(id);
  db.prepare('DELETE FROM word_group_done WHERE student_id=?').run(id);
  db.prepare('DELETE FROM paper_tries WHERE user_id=?').run(id);
  ok(res, null, '已删除');
});

// 批量开通学生：每行  姓名,账号,密码,年级,到期时间,册别（册别可不填；年级与到期时间必填）
// 学段按年级自动识别，也可以额外写一列 小学 / 初中 手动指定
admin.post('/students/batch', (req, res) => {
  const list = (req.body && req.body.list) || [];
  let n = 0, row = 0; const errs = [];
  const ins = db.prepare(`INSERT INTO users (role,username,password,name,grade,stage,term,allow_seek,avatar,expire_at,level,created_by,created_at) VALUES ('student',?,?,?,?,?,?,1,?,?,?,?,?)`);
  for (const it of list) {
    row++;
    const username = String(it.username || '').trim();
    const name = String(it.name || '').trim();
    if (!username || !name) { errs.push(`第 ${row} 行：姓名和账号必填`); continue; }
    const bad = checkStudentFields(it.grade, it.expire_at);
    if (bad) { errs.push(`${name || username}：${bad}`); continue; }
    if (req.user.role === 'branch') {
      const lim = branchStudentLimit(req.user.id);
      if (lim && lim.cur >= lim.max) { errs.push(`${name || username}：本校学生人数已达上限（${lim.max} 人）`); continue; }
    }
    const st = studentStage(it.stage, it.grade);
    if (st.err) { errs.push(`${name || username}：${st.err}`); continue; }
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) { errs.push(`${username} 已存在，跳过`); continue; }
    ins.run(username, hash(String(it.password || '123456')), name, String(it.grade).trim(), st.value, termText(it.term),
      randAvatar(), String(it.expire_at).slice(0, 10), 'basic', req.user.id, now());
    n++;
  }
  ok(res, { count: n, errs }, `成功开通 ${n} 个学生账号` + (errs.length ? `，${errs.length} 条跳过` : ''));
});

// ---------- 学情管理·成绩管理：花名册（分校=校区，学生账号=学生档案） ----------
admin.get('/grades-roster', (req, res) => {
  let branches = db.prepare("SELECT id, name FROM users WHERE role='branch' AND status=1 ORDER BY id ASC").all();
  if (req.user.role === 'branch') branches = branches.filter((b) => b.id === req.user.id);   // 分校只见本校区
  let where = " WHERE role='student' AND status=1";
  const args = [];
  if (req.user.role === 'branch') { where += ' AND created_by=?'; args.push(req.user.id); }
  const students = db.prepare(`SELECT id, name, grade, stage, created_by FROM users${where} ORDER BY id ASC`).all(...args);
  const bmap = {};
  branches.forEach((b) => { bmap[b.id] = b.name; });
  students.forEach((s) => {
    s.branch_id = s.created_by;
    s.branch_name = bmap[s.created_by] || '总校区';   // 总校区直建学生
  });
  ok(res, { role: req.user.role, branches, students });
});

// ---------- 班主任工作台：私有录音，服务器归属与校区鉴权 ----------
admin.post('/upload-audio', careAudio.requireHeader, careAudio.uploadMiddleware, careAudio.upload);
admin.get('/care-audio/:id', careAudio.requireHeader, careAudio.read);

// ---------- 常用网站：管理端收藏夹（settings 表存 JSON，key=common_sites） ----------
function sitesRead() {
  let list = [];
  try { list = JSON.parse((db.prepare('SELECT v FROM settings WHERE k=?').get('common_sites') || {}).v || '[]') || []; } catch (e) { list = []; }
  return Array.isArray(list) ? list : [];
}
function sitesWrite(list) {
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('common_sites', JSON.stringify(list));
}
function siteNormUrl(u) {
  let s = String(u || '').trim();
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}
function siteCheck(name, url) {
  if (!name || !String(name).trim()) return '网站名称必填';
  if (String(name).trim().length > 30) return '网站名称不能超过 30 个字';
  const u = siteNormUrl(url);
  if (!u) return '网站地址必填';
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(u)) return '网站地址格式不正确';
  return '';
}

admin.get('/sites', (req, res) => ok(res, { list: sitesRead() }));

admin.post('/sites', (req, res) => {
  const { name, url } = req.body || {};
  const bad = siteCheck(name, url);
  if (bad) return fail(res, bad);
  const list = sitesRead();
  if (list.length >= 100) return fail(res, '最多收藏 100 个网站');
  list.push({ name: String(name).trim(), url: siteNormUrl(url) });
  sitesWrite(list);
  ok(res, { list }, '已添加');
});

admin.put('/sites/:i', (req, res) => {
  const i = Number(req.params.i);
  const list = sitesRead();
  if (!list[i]) return fail(res, '该网站不存在');
  const { name, url } = req.body || {};
  const bad = siteCheck(name, url);
  if (bad) return fail(res, bad);
  list[i] = { name: String(name).trim(), url: siteNormUrl(url) };
  sitesWrite(list);
  ok(res, { list }, '已保存');
});

admin.delete('/sites/:i', (req, res) => {
  const i = Number(req.params.i);
  const list = sitesRead();
  if (!list[i]) return fail(res, '该网站不存在');
  list.splice(i, 1);
  sitesWrite(list);
  ok(res, { list }, '已删除');
});

// ---------- 班级 ----------
admin.get('/classes', (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id=c.id AND u.role='student') AS students FROM classes c ORDER BY c.id DESC`).all();
  ok(res, rows);
});
admin.post('/classes', (req, res) => {
  const { name, grade, remark } = req.body || {};
  if (!name) return fail(res, '班级名称必填');
  const info = db.prepare('INSERT INTO classes (name,grade,remark,created_at) VALUES (?,?,?,?)').run(name, grade || '', remark || '', now());
  ok(res, { id: info.lastInsertRowid }, '已创建');
});
admin.put('/classes/:id', (req, res) => {
  const { name, grade, remark } = req.body || {};
  db.prepare('UPDATE classes SET name=?, grade=?, remark=? WHERE id=?').run(name || '', grade || '', remark || '', Number(req.params.id));
  ok(res, null, '已保存');
});
admin.delete('/classes/:id', (req, res) => {
  db.prepare('DELETE FROM classes WHERE id=?').run(Number(req.params.id));
  ok(res, null, '已删除');
});

// ---------- 章节 ----------
admin.get('/chapters', (req, res) => {
  const { subject = '', grade = '', category = '', term = '', stage = '' } = req.query;
  let sql = 'SELECT c.*, (SELECT COUNT(*) FROM questions q WHERE q.chapter_id=c.id) AS question_count, (SELECT COUNT(*) FROM handouts h WHERE h.chapter_id=c.id AND h.video_id IN (SELECT id FROM videos WHERE chapter_id=c.id)) AS handout_count, (SELECT COUNT(*) FROM handouts h WHERE h.chapter_id=c.id AND (h.video_id IS NULL OR h.video_id NOT IN (SELECT id FROM videos WHERE chapter_id=c.id))) AS exercise_count, (SELECT COUNT(*) FROM videos v WHERE v.chapter_id=c.id) AS video_count, (SELECT COUNT(*) FROM sections s WHERE s.chapter_id=c.id) AS section_count FROM chapters c WHERE 1=1';
  const args = [];
  if (subject) { sql += ' AND c.subject=?'; args.push(subject); }
  if (grade) { sql += ' AND c.grade=?'; args.push(grade); }
  if (category) { sql += ' AND c.category=?'; args.push(category); }
  if (stage) { sql += " AND IFNULL(c.stage,'')=?"; args.push(stage); }
  if (term === 'none') { sql += " AND IFNULL(c.term,'')=''"; }
  else if (term) { sql += " AND IFNULL(c.term,'')=?"; args.push(term); }
  sql += " ORDER BY FIELD(c.subject,'数学','英语','物理','化学'), FIELD(IFNULL(c.category,''),'同步基础','同步培优','专项提升','中考冲刺'), FIELD(IFNULL(c.grade,''),'一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级','中考冲刺'), FIELD(IFNULL(c.stage,''),'primary','junior'), FIELD(IFNULL(c.term,''),'上册','下册'), c.sort, c.id";
  // 分类名再兜底规范化一次（老库里可能还留着「专项提升·小学 / ·初中」）
  ok(res, db.prepare(sql).all(...args).map((c) => ({ ...c, category: CATEGORY_RENAME[String(c.category || '').trim()] || c.category || '' })));
});
admin.post('/chapters', (req, res) => {
  const { subject, grade, term, book, name, code, sort, category, stage } = req.body || {};
  if (!name) return fail(res, '章节名称必填');
  const n = normChapter(subject, grade, category, stage);
  if (n.category === '专项提升' && !n.stage) return fail(res, '「专项提升」请选择学段（小学 / 初中）');
  const info = db.prepare('INSERT INTO chapters (subject,grade,term,book,name,code,sort,category,stage,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(subject || '数学', n.grade, termText(term), book || '', name, code || '', Number(sort) || 0, n.category, n.stage, now());
  ok(res, { id: info.lastInsertRowid }, '已添加');
});
admin.put('/chapters/:id', (req, res) => {
  const { subject, grade, term, book, name, code, sort, category, stage } = req.body || {};
  const n = normChapter(subject, grade, category, stage);
  if (n.category === '专项提升' && !n.stage) return fail(res, '「专项提升」请选择学段（小学 / 初中）');
  db.prepare('UPDATE chapters SET subject=?, grade=?, term=?, book=?, name=?, code=?, sort=?, category=?, stage=? WHERE id=?')
    .run(subject || '数学', n.grade, termText(term), book || '', name || '', code || '', Number(sort) || 0, n.category, n.stage, Number(req.params.id));
  ok(res, null, '已保存');
});
admin.delete('/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  // 绑在该章节视频上的练习题解绑回题库；学习进度清理（视频/讲义文件按惯例保留）
  db.prepare('UPDATE questions SET video_id=NULL WHERE video_id IN (SELECT id FROM videos WHERE chapter_id=?)').run(id);
  // R8：挂在本章小分组上的题同样解绑回题库
  db.prepare('UPDATE questions SET section_id=NULL WHERE section_id IN (SELECT id FROM sections WHERE chapter_id=?)').run(id);
  db.prepare('DELETE FROM progress WHERE chapter_id=?').run(id);
  db.prepare('DELETE FROM sections WHERE chapter_id=?').run(id);
  db.prepare('DELETE FROM chapters WHERE id=?').run(id);
  ok(res, null, '已删除');
});

// ---------- 分级目录（章节下可选的第四级） ----------
admin.get('/sections', (req, res) => {
  const { chapter_id = '' } = req.query;
  let sql = `SELECT s.*, c.name AS chapter_name, c.subject, c.grade, c.category,
      (SELECT COUNT(*) FROM videos v WHERE v.section_id=s.id) AS video_count,
      (SELECT COUNT(*) FROM handouts h WHERE h.section_id=s.id) AS handout_count
    FROM sections s LEFT JOIN chapters c ON c.id=s.chapter_id WHERE 1=1`;
  const args = [];
  if (chapter_id) { sql += ' AND s.chapter_id=?'; args.push(Number(chapter_id)); }
  sql += ' ORDER BY c.grade, c.sort, s.sort, s.id';
  ok(res, db.prepare(sql).all(...args));
});
admin.post('/sections', (req, res) => {
  const { chapter_id, name, sort } = req.body || {};
  const nm = String(name || '').trim();
  if (!chapter_id) return fail(res, '请先选择课程章节');
  if (!nm) return fail(res, '分级目录名称必填');
  const ch = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(chapter_id));
  if (!ch) return fail(res, '课程章节不存在');
  const info = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,?,?)')
    .run(ch.id, nm, Number(sort) || 0, now());
  ok(res, { id: info.lastInsertRowid }, '分级目录已添加');
});
admin.put('/sections/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  if (!s) return fail(res, '分级目录不存在');
  const b = req.body || {};
  const nm = b.name === undefined ? s.name : String(b.name).trim();
  if (!nm) return fail(res, '名称不能为空');
  db.prepare('UPDATE sections SET name=?, sort=? WHERE id=?')
    .run(nm, b.sort === undefined ? s.sort : (Number(b.sort) || 0), s.id);
  ok(res, null, '已保存');
});
// 删除分级目录：里面的视频 / 资料不删除，只变成「不分组」
admin.delete('/sections/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  if (!s) return fail(res, '分级目录不存在');
  db.prepare('UPDATE videos SET section_id=NULL WHERE section_id=?').run(s.id);
  db.prepare('UPDATE handouts SET section_id=NULL WHERE section_id=?').run(s.id);
  db.prepare('UPDATE questions SET section_id=NULL WHERE section_id=?').run(s.id);   // R8：小分组习题解绑回题库
  db.prepare('DELETE FROM sections WHERE id=?').run(s.id);
  ok(res, { id: s.id }, '已删除（原有视频与资料已变为不分组）');
});

// ---------- 题库 ----------
admin.get('/questions', (req, res) => {
  const { chapter_id = '', type = '', kw = '', page = 1, size = 20 } = req.query;
  let where = ' WHERE ' + require('./qmeta').questionScopeSql(req.user, 'q'); const args = [];
  if (chapter_id) { where += ' AND q.chapter_id=?'; args.push(Number(chapter_id)); }
  if (type) { where += ' AND q.type=?'; args.push(type); }
  if (kw) { where += ' AND q.stem LIKE ?'; args.push(`%${kw}%`); }
  const total = db.prepare('SELECT COUNT(*) n FROM questions q' + where).get(...args).n;
  const rows = db.prepare(`SELECT q.*, c.name AS chapter_name FROM questions q LEFT JOIN chapters c ON c.id=q.chapter_id ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`)
    .all(...args, Number(size), (Number(page) - 1) * Number(size)).map(parseQ);
  ok(res, { total, list: rows });
});
admin.post('/questions', (req, res) => {
  const diff = resolveDifficulty(req.body || {});
  if (diff.error) return fail(res, diff.error);
  const q = normalizeQ(req.body || {});
  if (!q) return fail(res, '题型/题干/答案请填写完整');
  const info = db.prepare('INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,difficulty_score_10,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(q.chapter_id, q.subject, q.grade, q.type, q.stem, JSON.stringify(q.options), q.answer, q.analysis, diff.difficulty, diff.difficulty_score_10, 0, now());
  ok(res, { id: info.lastInsertRowid }, '已添加');
});
admin.put('/questions/:id', (req, res) => {
  if (!require('./qmeta').questionsAllowed(db, req.user, [Number(req.params.id)])) return fail(res, '无权访问题目', 403);
  const cur = db.prepare('SELECT difficulty,difficulty_score_10 FROM questions WHERE id=?').get(Number(req.params.id));
  if (!cur) return fail(res, '题目不存在');
  const diff = resolveDifficulty(req.body || {}, cur);
  if (diff.error) return fail(res, diff.error);
  const q = normalizeQ(req.body || {});
  if (!q) return fail(res, '题型/题干/答案请填写完整');
  db.prepare('UPDATE questions SET chapter_id=?,subject=?,grade=?,type=?,stem=?,options=?,answer=?,analysis=?,difficulty=?,difficulty_score_10=? WHERE id=?')
    .run(q.chapter_id, q.subject, q.grade, q.type, q.stem, JSON.stringify(q.options), q.answer, q.analysis, diff.difficulty, diff.difficulty_score_10, Number(req.params.id));
  ok(res, null, '已保存');
});
admin.delete('/questions/:id', (req, res) => {
  if (!require('./qmeta').questionsAllowed(db, req.user, [Number(req.params.id)])) return fail(res, '无权访问题目', 403);
  try { require('./question-delete-guard').assertQuestionsDeletable(db, [Number(req.params.id)]); }
  catch (e) { if (e.code === 'QUESTION_IN_USE') return res.status(409).json({ code: 409, msg: e.message }); throw e; }
  db.prepare('DELETE FROM questions WHERE id=?').run(Number(req.params.id));
  ok(res, null, '已删除');
});

function normalizeQ(b) {
  const type = ['single', 'multi', 'fill'].includes(b.type) ? b.type : null;
  const stem = String(b.stem || '').trim();
  const answer = String(b.answer || '').trim();
  if (!type || !stem || !answer) return null;
  let options = Array.isArray(b.options) ? b.options.map((s) => String(s).trim()).filter(Boolean) : [];
  if (type !== 'fill' && options.length < 2) return null;
  let chapter = null;
  if (b.chapter_id) chapter = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(b.chapter_id));
  return {
    chapter_id: b.chapter_id || null,
    subject: b.subject || (chapter ? chapter.subject : ''),
    grade: b.grade || (chapter ? chapter.grade : ''),
    type, stem,
    options: type === 'fill' ? [] : options,
    answer, analysis: String(b.analysis || '').trim(),
    difficulty: Math.min(5, Math.max(1, Number(b.difficulty) || 3)),
  };
}

// 题库 Excel 导入
admin.post('/questions/import', upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  let parsed;
  try {
    const chapters = db.prepare('SELECT * FROM chapters').all();
    parsed = parseWorkbook(req.file.buffer, chapters);
  } catch (e) {
    return fail(res, '文件解析失败：' + e.message);
  }
  const ins = db.prepare('INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)');
  const tx = db.transaction((items) => {
    for (const q of items) ins.run(q.chapter_id, q.subject, q.grade, q.type, q.stem, JSON.stringify(q.options), q.answer, q.analysis, q.difficulty, now());
  });
  tx(parsed.items);
  ok(res, { imported: parsed.items.length, errors: parsed.errors }, `成功导入 ${parsed.items.length} 道题`);
});

admin.get('/questions/template', (req, res) => {
  const tmp = path.join(__dirname, '..', 'data', '题库导入模板.xlsx');
  makeTemplate(tmp);
  res.download(tmp, '题库导入模板.xlsx');
});

// ---------- 讲义 / 习题 ----------
admin.get('/handouts', (req, res) => {
  const { chapter_id = '', kw = '', kind = '', section_id = '' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (chapter_id) { where += ' AND h.chapter_id=?'; args.push(Number(chapter_id)); }
  if (section_id) { where += ' AND h.section_id=?'; args.push(Number(section_id)); }
  if (kind) { where += " AND IFNULL(h.kind,'handout')=?"; args.push(kind); }
  if (kw) { where += ' AND h.title LIKE ?'; args.push(`%${kw}%`); }
  const rows = db.prepare(`SELECT h.*, c.name AS chapter_name, v.title AS video_title, s.name AS section_name
    FROM handouts h LEFT JOIN chapters c ON c.id=h.chapter_id LEFT JOIN videos v ON v.id=h.video_id
    LEFT JOIN sections s ON s.id=h.section_id
    ${where} ORDER BY h.id DESC`).all(...args);
  ok(res, rows.map((r) => ({ ...r, kind: r.kind || 'handout' })));
});
admin.post('/handouts', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, '请选择要上传的文件');
  const { title, chapter_id, level, subject, grade, video_id, section_id } = req.body || {};
  const originalName = fixFileName(req.file.originalname);
  let chapter = chapter_id ? db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(chapter_id)) : null;
  // 关联到某个视频 → 视频讲义；不关联 → 本章习题库
  let vid = video_id ? Number(video_id) : null;
  if (vid) {
    const v = db.prepare('SELECT * FROM videos WHERE id=?').get(vid);
    if (!v) vid = null;
    else if (!chapter && v.chapter_id) chapter = db.prepare('SELECT * FROM chapters WHERE id=?').get(v.chapter_id);
  }
  const k = vid ? 'handout' : 'exercise';
  // 归属分级目录：优先用表单值，若关联了视频而没选，则跟随该视频的归属
  let sid = normSection((chapter && chapter.id) || chapter_id, section_id);
  if (!sid && vid) {
    const v = db.prepare('SELECT section_id FROM videos WHERE id=?').get(vid);
    sid = (v && v.section_id) || null;
  }
  let saved;
  try { saved = await store.saveFile(req.file.buffer, originalName, 'handouts'); }
  catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
  const ext = path.extname(originalName).replace('.', '').toLowerCase();
  const info = db.prepare(`INSERT INTO handouts (chapter_id,video_id,section_id,kind,subject,grade,title,file_path,file_name,ext,size,level,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    (chapter && chapter.id) || (chapter_id ? Number(chapter_id) : null), vid, sid, k,
    subject || (chapter ? chapter.subject : ''),
    grade || (chapter ? chapter.grade : ''),
    title || originalName,
    saved.key, originalName, ext, saved.size, level || 'basic', now()
  );
  ok(res, { id: info.lastInsertRowid, kind: k }, vid ? '讲义已上传（已关联知识点）' : '已上传（进入本章习题库）');
});
// 修改资料：标题、章节、关联知识点，也可以更换文件
admin.put('/handouts/:id', upload.single('file'), async (req, res) => {
  const h = db.prepare('SELECT * FROM handouts WHERE id=?').get(Number(req.params.id));
  if (!h) return fail(res, '资料不存在');
  const b = req.body || {};
  const title = b.title === undefined ? h.title : String(b.title).trim();
  if (!title) return fail(res, '标题不能为空');
  const chapterId = b.chapter_id === undefined ? h.chapter_id : (b.chapter_id ? Number(b.chapter_id) : null);
  const videoId = b.video_id === undefined ? h.video_id : (b.video_id ? Number(b.video_id) : null);
  const kind = videoId ? 'handout' : 'exercise';
  let sid = b.section_id === undefined ? h.section_id : normSection(chapterId, b.section_id);
  if (!sid && b.section_id === undefined) {
    const v = videoId ? db.prepare('SELECT section_id FROM videos WHERE id=?').get(videoId) : null;
    sid = (v && v.section_id) || null;
  }
  let filePath = h.file_path || '';
  let fileName = h.file_name || '';
  let ext = h.ext || '';
  let size = h.size || 0;
  if (req.file) {
    try {
      const originalName = fixFileName(req.file.originalname);
      const saved = await store.saveFile(req.file.buffer, originalName, 'handouts');
      if (filePath && filePath !== saved.key) await dropStored(filePath);
      filePath = saved.key;
      fileName = originalName;
      ext = path.extname(originalName).replace('.', '').toLowerCase();
      size = saved.size;
    } catch (e) {
      return fail(res, '资料上传失败：' + (e.message || '存储服务拒绝'));
    }
  } else if (String(b.clear_file || '') === '1') {
    try { await dropStored(filePath); }
    catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
    filePath = '';
    fileName = '';
    ext = '';
    size = 0;
  }
  db.prepare('UPDATE handouts SET title=?, chapter_id=?, video_id=?, section_id=?, kind=?, file_path=?, file_name=?, ext=?, size=? WHERE id=?')
    .run(title, chapterId, videoId, sid || null, kind, filePath, fileName, ext, size, h.id);
  ok(res, { kind, section_id: sid || null }, '已保存');
});
// 批量删除资料（必须在 /handouts/:id 之前注册，否则 batch 会被当成 id）
admin.delete('/handouts/batch', async (req, res) => {
  if (!delPwdOk(req)) return fail(res, '删除密码错误');
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请选择要删除的资料');
  if (store.CLOUD_READ_ONLY) {
    try {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM handouts WHERE id=?').get(id);
        if (row) store.assertDeleteAllowed(row.file_path);
      }
    } catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
  }
  let n = 0;
  for (const id of ids) {
    const h = db.prepare('SELECT * FROM handouts WHERE id=?').get(id);
    if (h) { try { await store.deleteFile(h.file_path); } catch (e) { /* 文件可能已不存在 */ } db.prepare('DELETE FROM handouts WHERE id=?').run(id); n++; }
  }
  ok(res, { count: n }, `已删除 ${n} 份资料`);
});
admin.delete('/handouts/:id', async (req, res) => {
  if (!delPwdOk(req)) return fail(res, '删除密码错误');
  const h = db.prepare('SELECT * FROM handouts WHERE id=?').get(Number(req.params.id));
  if (h) {
    try { await store.deleteFile(h.file_path); }
    catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
    db.prepare('DELETE FROM handouts WHERE id=?').run(h.id);
  }
  ok(res, null, '已删除');
});
admin.get('/handouts/:id/download', (req, res) => res.redirect(`/api/file?key=${encodeURIComponent((db.prepare('SELECT file_path FROM handouts WHERE id=?').get(Number(req.params.id)) || {}).file_path || '')}`));

// ---------- 视频（分级） ----------
admin.get('/videos', (req, res) => {
  const { chapter_id = '', level = '', section_id = '' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (chapter_id) { where += ' AND v.chapter_id=?'; args.push(Number(chapter_id)); }
  if (section_id) { where += ' AND v.section_id=?'; args.push(Number(section_id)); }
  if (level) { where += ' AND v.level=?'; args.push(level); }
  const rows = db.prepare(`SELECT v.*, c.name AS chapter_name, s.name AS section_name
    FROM videos v LEFT JOIN chapters c ON c.id=v.chapter_id LEFT JOIN sections s ON s.id=v.section_id
    ${where} ORDER BY v.section_id, v.sort, v.id`).all(...args);
  ok(res, rows);
});
/** 归一化 section_id：必须属于该章节，否则置空（不分组） */
function normSection(chapterId, sectionId) {
  const sid = sectionId ? Number(sectionId) : null;
  if (!sid || !chapterId) return null;
  const s = db.prepare('SELECT * FROM sections WHERE id=? AND chapter_id=?').get(sid, Number(chapterId));
  return s ? s.id : null;
}
/** 浏览器直传 OSS：初始化分片。文件不经过本服务器。 */
admin.post('/videos/direct/init', async (req, res) => {
  try {
    const b = req.body || {};
    ok(res, await store.initVideoUpload(b.name, b.size));
  } catch (e) {
    fail(res, (e && e.message) || '无法开始上传');
  }
});
/** 给一个分片签发直传地址。有效期 6 小时，临上传前再签，避免 3G 传到一半过期。 */
admin.post('/videos/direct/sign', (req, res) => {
  try {
    const b = req.body || {};
    ok(res, store.signVideoPart(b.key, b.uploadId, b.partNumber));
  } catch (e) {
    fail(res, (e && e.message) || '签发上传地址失败');
  }
});
admin.post('/videos/direct/complete', async (req, res) => {
  try {
    const b = req.body || {};
    await store.completeVideoUpload(b.key, b.uploadId, b.parts);
    ok(res, { key: b.key });
  } catch (e) {
    fail(res, (e && e.message) || '合并视频失败');
  }
});
admin.post('/videos/direct/abort', async (req, res) => {
  const b = req.body || {};
  try { await store.abortVideoUpload(b.key, b.uploadId); }
  catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
  ok(res, null);
});

admin.post('/videos', videoUpload.single('file'), async (req, res) => {
  const { title, chapter_id, level, url, section_id, file_key } = req.body || {};
  if (!title) { dropTmp(req.file); return fail(res, '请填写视频标题'); }
  let filePath = '';
  if (file_key) {
    const key = String(file_key);
    if (!store.isVideoKey(key) || !(await store.videoExists(key))) {
      dropTmp(req.file);
      return fail(res, '视频还没传到云端');
    }
    filePath = key;
  } else if (req.file) {
    try {
      filePath = (await store.saveFile(req.file.path, fixFileName(req.file.originalname), 'videos')).key;
    } catch (e) {
      dropTmp(req.file);
      return fail(res, '视频上传失败：' + (e.message || '存储服务拒绝'));
    } finally { dropTmp(req.file); }
  }
  const sid = normSection(chapter_id, section_id);
  const info = db.prepare('INSERT INTO videos (chapter_id,section_id,subject,grade,title,file_path,url,duration,level,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
    .run(chapter_id || null, sid, '', '', title, filePath, filePath ? '' : (url || ''), 0, level || 'basic', now());
  db.prepare('UPDATE videos SET sort=? WHERE id=?').run(nextVideoSort(chapter_id, info.lastInsertRowid), info.lastInsertRowid);
  ok(res, { id: info.lastInsertRowid }, filePath || url ? '视频已上传' : '已保存');
});
/** 新视频排到本章节末尾：sort = 本章节现有最大值 + 10（excludeId = 刚插入的这条） */
function nextVideoSort(chapterId, excludeId) {
  const ex = Number(excludeId || 0);
  const r = chapterId
    ? db.prepare('SELECT MAX(sort) AS m FROM videos WHERE chapter_id=? AND id<>?').get(Number(chapterId), ex)
    : db.prepare('SELECT MAX(sort) AS m FROM videos WHERE chapter_id IS NULL AND id<>?').get(ex);
  return Number((r && r.m) || 0) + 10;
}
/** 视频排序：前端传来某章节视频的新顺序（ids），按顺序把 sort 重编为 10、20、30… */
admin.post('/video-order', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) return fail(res, '视频列表不合法');
  if (ids.length > 2000 || new Set(ids).size !== ids.length) return fail(res, '视频列表不合法');
  const rows = db.prepare('SELECT id, chapter_id FROM videos WHERE id IN (' + ids.map(() => '?').join(',') + ')').all(...ids);
  if (rows.length !== ids.length) return fail(res, '有视频不存在，请刷新后重试');
  if (new Set(rows.map((r) => r.chapter_id)).size > 1) return fail(res, '只能给同一章节的视频排序');
  const upd = db.prepare('UPDATE videos SET sort=? WHERE id=?');
  const run = () => { ids.forEach((id, i) => upd.run((i + 1) * 10, id)); };
  if (typeof db.transaction === 'function') db.transaction(run)(); else run();
  ok(res, { count: ids.length }, '顺序已保存');
});
// 批量删除视频（必须在 /videos/:id 之前注册，否则 batch 会被当成 id）
admin.delete('/videos/batch', async (req, res) => {
  if (!delPwdOk(req)) return fail(res, '删除密码错误');
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请选择要删除的视频');
  if (store.CLOUD_READ_ONLY) {
    try {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM videos WHERE id=?').get(id);
        if (row) store.assertDeleteAllowed(row.file_path);
      }
    } catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); throw e; }
  }
  let n = 0;
  for (const id of ids) {
    const v = db.prepare('SELECT * FROM videos WHERE id=?').get(id);
    if (v) {
      if (v.file_path) { try { await store.deleteFile(v.file_path); } catch (e) { /* 文件可能已不存在 */ } }
      db.prepare('DELETE FROM videos WHERE id=?').run(id);
      // 绑在该视频上的练习题解绑回题库（题目保留，可重新绑定其他视频）
      db.prepare('UPDATE questions SET video_id=NULL WHERE video_id=?').run(id);
      db.prepare('DELETE FROM video_nodes WHERE video_id=?').run(id);   // R8：视频关联的知识点
      n++;
    }
  }
  ok(res, { count: n }, `已删除 ${n} 个视频`);
});
admin.delete('/videos/:id', async (req, res) => {
  if (!delPwdOk(req)) return fail(res, '删除密码错误');
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (v && v.file_path) { try { await store.deleteFile(v.file_path); } catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') return fail(res, e.message); /* 文件可能已不存在，不影响删除记录 */ } }
  db.prepare('DELETE FROM videos WHERE id=?').run(Number(req.params.id));
  // 题库与视频只靠绑定关系关联（T12）：删视频只解绑，题目（含图片 / 音频）原样保留，可重新绑定其他视频
  if (v) db.prepare('UPDATE questions SET video_id=NULL WHERE video_id=?').run(v.id);
  if (v) db.prepare('DELETE FROM video_nodes WHERE video_id=?').run(v.id);   // R8：视频关联的知识点
  ok(res, null, '已删除');
});
/** 删掉一条视频文件：云端对象和切换 OSS 之前留在磁盘上的旧文件都清掉 */
async function dropStored(key) {
  if (!key) return;
  if (store.CLOUD_READ_ONLY) store.assertDeleteAllowed(key);
  try { await store.deleteFile(key); } catch (e) { /* 云端没有这份文件时忽略 */ }
  try {
    const abs = store.localPath(key);
    if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) { /* 本地没有这份文件时忽略 */ }
}

// 编辑视频：标题、章节、分级目录，以及更换文件 / 改外链 / 去掉已上传的文件
admin.put('/videos/:id', videoUpload.single('file'), async (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) { dropTmp(req.file); return fail(res, '视频不存在'); }
  const b = req.body || {};
  const title = b.title === undefined ? v.title : String(b.title).trim();
  if (!title) { dropTmp(req.file); return fail(res, '标题不能为空'); }
  const chapterId = b.chapter_id === undefined ? v.chapter_id : (b.chapter_id ? Number(b.chapter_id) : null);
  const sid = b.section_id === undefined ? v.section_id : normSection(chapterId, b.section_id);
  let filePath = v.file_path || '';
  let url = b.url === undefined ? (v.url || '') : String(b.url || '').trim();
  const wantClear = String(b.clear_file || '') === '1';
  if (store.CLOUD_READ_ONLY && filePath && ((b.file_key && filePath !== String(b.file_key)) || req.file || wantClear)) {
    try { store.assertDeleteAllowed(filePath); }
    catch (e) { if (e.code === 'STORAGE_CLOUD_READ_ONLY') { dropTmp(req.file); return fail(res, e.message); } throw e; }
  }
  if (b.file_key) {
    const key = String(b.file_key);
    if (!store.isVideoKey(key) || !(await store.videoExists(key))) {
      dropTmp(req.file);
      return fail(res, '视频还没传到云端');
    }
    if (filePath && filePath !== key) await dropStored(filePath);
    filePath = key;
    url = '';
  } else if (req.file) {
    let saved;
    try {
      saved = await store.saveFile(req.file.path, fixFileName(req.file.originalname), 'videos');
    } catch (e) {
      dropTmp(req.file);
      return fail(res, '视频上传失败：' + (e.message || '存储服务拒绝'));
    } finally {
      dropTmp(req.file);
    }
    if (filePath && filePath !== saved.key) await dropStored(filePath);
    filePath = saved.key;
    url = '';
  } else if (wantClear) {
    await dropStored(filePath);
    filePath = '';
    url = '';
  }
  db.prepare('UPDATE videos SET title=?, section_id=?, chapter_id=?, file_path=?, url=? WHERE id=?')
    .run(title, sid || null, chapterId || null, filePath, url, v.id);
  ok(res, { id: v.id, title, section_id: sid || null }, '已保存');
});

// 批量上传视频：一次选多个文件，每个文件 = 一个知识点（标题默认用文件名）
admin.post('/videos/batch', videoUpload.array('files', 30), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return fail(res, '请选择要上传的视频文件');
  const { chapter_id, prefix, section_id } = req.body || {};
  const chapter = chapter_id ? db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(chapter_id)) : null;
  const sid = normSection(chapter_id, section_id);
  const ins = db.prepare('INSERT INTO videos (chapter_id,section_id,subject,grade,title,file_path,url,duration,level,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const made = [];
  for (const f of files) {
    const originalName = fixFileName(f.originalname);
    let saved;
    try { saved = await store.saveFile(f.path, originalName, 'videos'); }
    catch (e) {
      if (e.code === 'STORAGE_CLOUD_READ_ONLY') {
        files.forEach(dropTmp); // Multer has already received every file in this request.
        return fail(res, e.message);
      }
      throw e;
    }
    finally { dropTmp(f); }
    const base = path.basename(originalName, path.extname(originalName)).trim() || originalName;
    const title = (String(prefix || '').trim() ? String(prefix).trim() + ' ' : '') + base;
    const info = ins.run(chapter ? chapter.id : null, sid, chapter ? chapter.subject : '', chapter ? chapter.grade : '',
      title, saved.key, '', 0, 'basic', nextVideoSort(chapter ? chapter.id : null, 0), now());
    made.push({ id: info.lastInsertRowid, title });
  }
  ok(res, { count: made.length, list: made }, `成功上传 ${made.length} 个视频`);
});

// ---------- 统计 ----------
admin.get('/stats', (req, res) => {
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  ok(res, {
    students: g("SELECT COUNT(*) n FROM users WHERE role='student'").n,
    branches: g("SELECT COUNT(*) n FROM users WHERE role='branch'").n,
    chapters: g('SELECT COUNT(*) n FROM chapters').n,
    handouts: g("SELECT COUNT(*) n FROM handouts WHERE IFNULL(kind,'handout')<>'exercise'").n,
    exercises: g("SELECT COUNT(*) n FROM handouts WHERE kind='exercise'").n,
    videos: g('SELECT COUNT(*) n FROM videos').n,
    downloads: g('SELECT IFNULL(SUM(download_count),0) n FROM handouts').n,
  });
});

// 后台首页：所有学生相关统计按当前分校限定，日期范围使用服务器本地日历。
admin.get('/dashboard', (req, res) => {
  const today = new Date();
  const date = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (days) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d.setDate(d.getDate()+days); return date(d); };
  const scope = req.user.role === 'branch' ? ' AND u.created_by=?' : '';
  const args = req.user.role === 'branch' ? [req.user.id] : [];
  const startWeek = shift(-((today.getDay()+6)%7));
  const activity = (start) => Number(db.prepare(`SELECT COUNT(DISTINCT u.id) n FROM users u WHERE u.role='student'${scope} AND (u.last_login>=? OR EXISTS (SELECT 1 FROM records r WHERE r.user_id=u.id AND r.created_at>=?) OR EXISTS (SELECT 1 FROM progress p WHERE p.user_id=u.id AND p.updated_at>=?))`).get(...args, start, start, start).n) || 0;
  const questions = (start) => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(r.is_correct),0) correct FROM records r JOIN users u ON u.id=r.user_id WHERE u.role='student'${scope} AND r.created_at>=?`).get(...args, start);
  const day = questions(shift(0)), week = questions(startWeek);
  const completed = (start) => Number(db.prepare(`SELECT COUNT(*) n FROM progress p JOIN users u ON u.id=p.user_id WHERE u.role='student'${scope} AND p.video_done=1 AND p.updated_at>=?`).get(...args, start).n) || 0;
  const due = Number(db.prepare(`SELECT COUNT(*) n FROM mistakes m JOIN users u ON u.id=m.user_id WHERE u.role='student'${scope} AND m.resolved=0 AND (m.next_review='' OR m.next_review IS NULL OR m.next_review<=?)`).get(...args, shift(0)).n) || 0;
  const expiring = Number(db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.role='student'${scope} AND u.expire_at>=? AND u.expire_at<?`).get(...args, shift(0), shift(8)).n) || 0;
  const feedback = Number(db.prepare(`SELECT COUNT(*) n FROM bank_feedback f JOIN users u ON u.id=f.user_id WHERE u.role='student'${scope} AND f.status='pending'`).get(...args).n) || 0;
  const trendRows = db.prepare(`SELECT SUBSTR(r.created_at,1,10) d, COUNT(*) n FROM records r JOIN users u ON u.id=r.user_id WHERE u.role='student'${scope} AND r.created_at>=? GROUP BY SUBSTR(r.created_at,1,10)`).all(...args, shift(-13));
  const byDay = new Map(trendRows.map((r) => [r.d, Number(r.n)]));
  ok(res, { today: { active: activity(shift(0)), answers: Number(day.n), correct: Number(day.correct), completed: completed(shift(0)) }, week: { active: activity(startWeek), answers: Number(week.n), correct: Number(week.correct), completed: completed(startWeek) }, due, expiring, feedback, trend: Array.from({length:14}, (_, i) => { const d=shift(i-13); return { date:d, answers:byDay.get(d)||0 }; }) });
});

// 最近开通的学生（首页展示用）
admin.get('/students/recent', (req, res) => {
  let where = " WHERE role='student'";
  const args = [];
  if (req.user.role === 'branch') { where += ' AND created_by=?'; args.push(req.user.id); }   // 分校只见本校区学生
  const rows = db.prepare(`SELECT * FROM users${where} ORDER BY id DESC LIMIT 8`).all(...args);
  ok(res, rows.map(publicUser));
});

admin.get('/reports/students', (req, res) => {
  const scope = require('./student-report-access').studentScope(req.user, 'u', req.query.branch || 'all');
  const rows = db.prepare(`
    SELECT u.id, u.name, u.username, u.grade,
      (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.video_done=1) AS done,
      (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.handout_done=1) AS handout_done,
      (SELECT MAX(updated_at) FROM progress p WHERE p.user_id=u.id) AS last_time
    FROM users u WHERE ${scope.sql} ORDER BY done DESC`).all(...scope.args);
  ok(res, rows);
});

admin.get('/reports/student/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='student'").get(id);
  if (!u) return fail(res, '学生不存在');
  if (!require('./student-report-access').canReadStudent(req.user, u)) return fail(res, '无权查看该学生', 403);
  ok(res, studentReport(id, u));
});

// ---------- 统一的 AI 配置（学情诊断报告 / 错题 / 单词等所有 AI 能力共用一份，后台配一次即可） ----------
admin.use('/ai', require('./ai').router);

// ---------- 错题重组（扫描试卷 → 自动切题 → 勾选 → 双栏错题集 PDF） ----------
admin.use('/wrong', require('./wrong'));

// ---------- 学习报告（组织管理：词书 / 视频 / 习题 三类；分校只能看自己学生的数据） ----------
admin.use('/xreport', require('./reports').admin);

// ---------- 操作日志（仅总后台可查） ----------
admin.get('/logs', async (req, res) => {
  if (!isPrincipal(req)) return fail(res, '仅总后台可查看操作日志', 403);
  // 只保留最近 7 天：查询时顺手把过期记录删掉（有 created_at 索引，代价很低）
  try { db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(auditCutBefore()); } catch (e) { /* 清理失败不影响查询 */ }
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
  const { kw = '', role = '', result = '' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (kw) { where += ' AND (username LIKE ? OR name LIKE ? OR ip LIKE ? OR detail LIKE ? OR path LIKE ?)'; const k = `%${kw}%`; args.push(k, k, k, k, k); }
  if (role) { where += ' AND role=?'; args.push(role); }
  if (result === 'ok') where += ' AND ok=1';
  if (result === 'fail') where += ' AND ok=0';
  const total = Number((db.prepare('SELECT COUNT(*) n FROM audit_logs' + where).get(...args) || {}).n || 0);
  const pages = Math.max(1, Math.ceil(total / size));
  const pg = Math.min(page, pages);
  const list = db.prepare(`SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (pg - 1) * size);
  // IP 归属地：本页去重后查询（内存缓存命中则不发请求），附到每条记录上
  try {
    const uniq = [...new Set(list.map((l) => l.ip).filter(Boolean))];
    await Promise.all(uniq.map((ip) => ipGeoResolve(ip)));
    list.forEach((l) => { l.loc = ipGeoOf(l.ip); });
  } catch (e) { list.forEach((l) => { l.loc = ''; }); }
  ok(res, { list, total, page: pg, size });
});

// ---------- AI 试卷分析测评报告（拍照 → 视觉大模型 → 学情诊断报告） ----------
admin.use('/report', require('./report'));

// ---------- AI 单词记忆（管理端上传词表 → 学生端速记/词性/语境/连词成句） ----------
admin.use('/word', require('./word').admin);

// ================================================================== 学生端
const stu = express.Router();
stu.use(auth(true, 'student'));

stu.use('/word', require('./word').stu);
admin.use('/phonics', require('./phonics').admin);
stu.use('/phonics', require('./phonics').stu);
// ---------- 智能题库（题库管理 / 智能组卷 / 课文习题 / 错题记录） ----------
admin.use('/bank', require('./bank').admin);
admin.use('/bank/tree-mapping', require('./tree-mapping'));
stu.use('/bank', require('./bank').stu);
// ---------- 魔方题库（题库管理·目录树 / 网络采集 / 试卷管理 / 录题工作台） ----------
// 挂 /bank/mf 下，复用智能题库的鉴权与操作日志分类；采集回传单独走 /api/mfcap（采集票据）
admin.use('/bank/mf', require('./mfbank').admin);
app.use('/api/mfcap', require('./mfbank').cap);
// ---------- 魔方复刻扩展（五角色模型档案 / 代理内嵌浏览器 / 字典映射 / 知识树导入） ----------
admin.use('/bank/mf/ext', require('./mfcollect').admin);
app.use('/api/mfproxy', require('./mfcollect').proxy);
app.use('/api/mfcap', require('./mfcollect').cap);
// 微信扫码上传错题（开放接口，短时 token 鉴权，不走登录）
app.use('/api/up', require('./bank').up);

stu.get('/home', (req, res) => {
  const uid = req.user.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const done = db.prepare('SELECT COUNT(*) n, SUM(is_correct) c FROM records WHERE user_id=?').get(uid);
  const days = db.prepare("SELECT DISTINCT substr(created_at,1,10) d FROM records WHERE user_id=? ORDER BY d DESC LIMIT 60").all(uid)
    .map((r) => r.d);
  let streak = 0;
  const today = now().slice(0, 10);
  const set = new Set(days);
  for (let i = 0; i < 400; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (set.has(s)) streak++; else if (i > 0 || !set.has(today)) break;
  }
  const subjects = db.prepare('SELECT DISTINCT subject FROM chapters WHERE subject<>\'\'').all().map((r) => r.subject);
  ok(res, {
    user: publicUser(u),
    done: done.n || 0,
    correct: done.c || 0,
    accuracy: done.n ? Math.round(done.c / done.n * 100) : 0,
    mistakes: db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=0').get(uid).n,
    streak,
    grade: u.grade,
    subjects,
  });
});

stu.get('/chapters', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { subject = '' } = req.query;
  const W = visibleChapterWhere(u);
  let sql = `SELECT c.* FROM chapters c WHERE 1=1${W.sql}`; const args = [...W.args];
  if (subject) { sql += ' AND c.subject=?'; args.push(subject); }
  sql += ' ORDER BY c.subject, c.sort, c.id';
  const chapters = db.prepare(sql).all(...args);
  const qHandout = db.prepare('SELECT COUNT(*) n FROM handouts WHERE chapter_id=?');
  const qVideo = db.prepare('SELECT COUNT(*) n FROM videos WHERE chapter_id=?');
  const out = chapters.map((c) => ({
    ...c,
    handout_count: qHandout.get(c.id).n,
    video_count: qVideo.get(c.id).n,
  }));
  ok(res, out);
});

/**
 * 章节可见性（学生的账号决定能看到哪些课）：
 *  · 同步基础 / 同步培优：只看到「本年级或全年级通用」+「本册或上下册通用」的章节（老规则）；
 *  · 专项提升：按「学段」看——小学账号看全部小学专项，初中账号看全部初中专项，
 *              不再按年级和上下册过滤（所以同一学段 1~6 年级 / 7~9 年级都能看到）；
 *  · 中考冲刺：只要账号是初中（七~九年级 / 中考冲刺），全部中考冲刺课程都能看到；
 *  · 学生的册别为空 = 不限（上下册都看），老账号不会因为没设册别而看不到课。
 */
function visibleChapterWhere(u, alias = 'c') {
  const grade = String((u && u.grade) || '').trim();
  const term = String((u && u.term) || '').trim();
  const stage = stageOfGrade(u && u.stage, grade);
  const A = alias;
  const args = [];
  // ① 同步类：年级 + 册别
  let sync = `(IFNULL(${A}.category,'') NOT IN ('专项提升','中考冲刺'))`;
  if (grade) { sync += ` AND (${A}.grade=? OR ${A}.grade='')`; args.push(grade); }
  if (term) { sync += ` AND (IFNULL(${A}.term,'')=? OR IFNULL(${A}.term,'')='')`; args.push(term); }
  // ② 专项提升：只按学段（没有学段的账号看不到任何专项课）
  let spec = '0';
  if (stage) { spec = `(IFNULL(${A}.category,'')='专项提升' AND IFNULL(${A}.stage,'')=?)`; args.push(stage); }
  // ③ 中考冲刺：初中账号全看
  const exam = stage === 'junior' ? `(IFNULL(${A}.category,'')='中考冲刺')` : '0';
  return { sql: ` AND ((${sync}) OR ${spec} OR ${exam})`, args };
}

/** 某章节能被这个学生看到吗（用于 course-detail 的直接访问校验） */
function canSeeChapter(u, c) {
  if (!c) return false;
  const cat = String(c.category || '');
  if (cat === '专项提升') return !!stageOfGrade(u && u.stage, u && u.grade) && String(c.stage || '') === stageOfGrade(u.stage, u.grade);
  if (cat === '中考冲刺') return stageOfGrade(u && u.stage, u && u.grade) === 'junior';
  const grade = String((u && u.grade) || '').trim();
  const term = String((u && u.term) || '').trim();
  if (grade && String(c.grade || '') && String(c.grade) !== grade) return false;
  if (term && String(c.term || '') && String(c.term) !== term) return false;
  return true;
}

/**
 * 学生端内容越权校验：凡是「按 id 直接取资源」的接口都必须先过这一关。
 * 以前只在校验了课程列表 / 课程详情，而 视频播放、讲义下载、取题练习 都是直接按 id 取，
 * 学生改一下地址栏的 id 就能看到别的年级 / 别的学段的内容（越权访问）。
 * 返回章节对象表示可访问；返回 null 表示已写出错误响应，调用方直接 return。
 */
function ensureChapterVisible(u, chapterId, res) {
  const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(chapterId) || 0);
  if (!c) { fail(res, '课程不存在'); return null; }
  if (!canSeeChapter(u, c)) { fail(res, '这门课不属于你的年级 / 学段，请到对应课程里查看'); return null; }
  return c;
}

const SUBJECT_ORDER = ['数学', '英语', '物理', '化学'];
const subjectRank = (s) => { const i = SUBJECT_ORDER.indexOf(s); return i < 0 ? 99 : i; };

/**
 * 一门课程 = 一条课程目录（章节）；一门课程由若干「知识点」组成。
 * 一个知识点 = 一个视频 + 一对一讲义。
 *
 * 资料的两条去向（由「是否关联视频」决定）：
 *   · 关联了本章的某个视频 → 该知识点的「讲义」（学生端和视频放在同一个框里）
 *   · 没有关联视频       → 进入本章「习题库」（学生端统一在课程页底部展示）
 */
function lessonsOf(chapterId, userId) {
  const cid = Number(chapterId);
  const videos = db.prepare('SELECT id,title,duration,section_id FROM videos WHERE chapter_id=? ORDER BY sort, id').all(cid);
  const videoIds = new Set(videos.map((v) => v.id));
  // 每个知识点绑定的练习题数（智能题库 → 学生端「做练习」按钮）
  const qCount = new Map();
  if (videoIds.size) {
    const ph = [...videoIds].map(() => '?').join(',');
    db.prepare(`SELECT video_id, COUNT(*) n FROM questions WHERE video_id IN (${ph}) GROUP BY video_id`).all(...videoIds)
      .forEach((r) => qCount.set(r.video_id, r.n));
  }
  const docs = db.prepare('SELECT id,title,file_name,ext,size,download_count,video_id,section_id FROM handouts WHERE chapter_id=? ORDER BY id').all(cid);
  const byVideo = new Map(), library = [];
  for (const d of docs) {
    if (d.video_id && videoIds.has(d.video_id) && !byVideo.has(d.video_id)) byVideo.set(d.video_id, d);
    else library.push(d);
  }
  const prog = new Map();
  if (userId) {
    for (const p of db.prepare('SELECT video_id,video_done,handout_done FROM progress WHERE user_id=? AND chapter_id=?').all(userId, cid)) {
      prog.set(p.video_id, p);
    }
  }
  // 习题正确率（T6）：按视频聚合最近一次作答，见 src/accuracy.js
  const accStats = userId ? accuracy.videoStats(db, userId, [...videoIds]) : new Map();
  // R8：视频关联的知识点树节点（后台「课文习题 → 管理习题 → 关联知识点」），学生端显示成标签
  const nodesOf = new Map();
  if (videoIds.size) {
    const ph = [...videoIds].map(() => '?').join(',');
    db.prepare(`SELECT vn.video_id AS vid, n.id, n.name FROM video_nodes vn JOIN bank_tree_nodes n ON n.id=vn.node_id
      WHERE vn.video_id IN (${ph}) ORDER BY n.sort, n.id`).all(...videoIds)
      .forEach((r) => { if (!nodesOf.has(r.vid)) nodesOf.set(r.vid, []); nodesOf.get(r.vid).push({ id: r.id, name: r.name }); });
  }
  const lessons = videos.map((v) => {
    const doc = byVideo.get(v.id) || null;
    const p = prog.get(v.id) || {};
    return {
      video_id: v.id, title: v.title, duration: v.duration || 0,
      section_id: v.section_id || (doc && doc.section_id) || 0,
      qcount: qCount.get(v.id) || 0,
      acc: accuracy.ofVideo(accStats, v.id),
      nodes: nodesOf.get(v.id) || [],
      done: Number(p.video_done) === 1 ? 1 : 0,
      handout: doc ? {
        id: doc.id, title: doc.title, file_name: doc.file_name, ext: doc.ext || '',
        size: doc.size || 0, download_count: doc.download_count || 0,
        done: Number(p.handout_done) === 1 ? 1 : 0,
      } : null,
    };
  });
  return { lessons, library };
}

/**
 * 按「分级目录」把知识点分组（学生端点击分组标题才展开）：
 *   · 章节下建过分级目录 → 返回 groups（含「未分组」兜底组）
 *   · 章节下没有分级目录 → grouped = false，学生端仍按平铺列表展示
 */
function groupsOf(chapterId, lessons, userId) {
  const secs = db.prepare('SELECT id,name,sort FROM sections WHERE chapter_id=? ORDER BY sort, id').all(Number(chapterId));
  if (!secs.length) return { grouped: false, groups: [], own: accuracy.sum([]) };
  // R8：直接挂在小分组上的题（题数 + 本人正确率）；小分组的正确率 = 组内视频的题 + 小分组自己的题 合并计算
  const ownN = new Map();
  const sph = secs.map(() => '?').join(',');
  db.prepare(`SELECT section_id AS sid, COUNT(*) n FROM questions WHERE section_id IN (${sph}) AND (video_id IS NULL OR video_id=0) GROUP BY section_id`).all(...secs.map((x) => x.id))
    .forEach((r) => ownN.set(Number(r.sid), Number(r.n) || 0));
  const ownStats = userId ? accuracy.sectionOwnStats(db, userId, secs.map((x) => x.id)) : new Map();
  const bucket = new Map(secs.map((s) => [s.id, []]));
  const loose = [];
  for (const l of lessons) {
    if (l.section_id && bucket.has(Number(l.section_id))) bucket.get(Number(l.section_id)).push(l);
    else loose.push(l);
  }
  const mk = (id, name, arr) => {
    const own = accuracy.ofVideo(ownStats, id);   // 结构相同：Map(section_id -> stats)
    const ownCount = ownN.get(id) || 0;
    return {
      id, name, lessons: arr, kp_total: arr.length,
      acc: accuracy.sum(arr.map((x) => x.acc).concat([own])),
      own_qcount: ownCount, own_acc: own,
      practice_count: ownCount + arr.reduce((n, x) => n + (x.qcount || 0), 0),   // 小分组练习 = 本组视频的题 + 小分组自己的题
      kp_done: arr.filter((x) => x.done).length,
      percent: arr.length ? Math.round(arr.filter((x) => x.done).length / arr.length * 100) : 0,
    };
  };
  // 有视频或有小分组习题的分组都显示（只挂了题、还没传视频的小分组也能做练习）
  const groups = secs.filter((s) => bucket.get(s.id).length || ownN.get(s.id)).map((s) => mk(s.id, s.name, bucket.get(s.id)));
  if (loose.length) groups.push(mk(0, '未分组', loose)); // 没有归入分级目录的知识点
  return { grouped: true, groups, own: accuracy.sum(secs.map((x) => accuracy.ofVideo(ownStats, x.id))) };
}

/** R8：下一个要学的知识点（按页面顺序第一个没看完的视频）；全部学完返回 null */
function nextLessonOf(grouped, groups, lessons) {
  const order = grouped ? groups.reduce((a, g) => a.concat(g.lessons.map((l) => ({ l, g }))), []) : lessons.map((l) => ({ l, g: null }));
  const hit = order.find((x) => !x.l.done);
  return hit ? { video_id: hit.l.video_id, title: hit.l.title, group_id: hit.g ? hit.g.id : 0, group_name: hit.g ? hit.g.name : '' } : null;
}

/** R8：课程列表卡片上的习题正确率（本课程所有视频的题 + 小分组的题，口径同 course-detail） */
function courseAccOf(chapterId, userId) {
  const vids = db.prepare('SELECT id FROM videos WHERE chapter_id=?').all(Number(chapterId)).map((r) => r.id);
  const secs = db.prepare('SELECT id FROM sections WHERE chapter_id=?').all(Number(chapterId)).map((r) => r.id);
  const vs = accuracy.videoStats(db, userId, vids);
  const ss = accuracy.sectionOwnStats(db, userId, secs);
  return accuracy.sum(vids.map((id) => accuracy.ofVideo(vs, id)).concat(secs.map((id) => accuracy.ofVideo(ss, id))));
}

/** 写入/更新某个知识点（视频）的学习进度 */
function setProgress(userId, videoId, patch = {}) {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(videoId));
  if (!v) return null;
  const c = v.chapter_id ? db.prepare('SELECT * FROM chapters WHERE id=?').get(v.chapter_id) : null;
  const cur = db.prepare('SELECT * FROM progress WHERE user_id=? AND video_id=?').get(userId, v.id) || {};
  const videoDone = patch.video_done === undefined ? Number(cur.video_done) === 1 : !!patch.video_done;
  const handoutDone = patch.handout_done === undefined ? Number(cur.handout_done) === 1 : !!patch.handout_done;
  db.prepare(`INSERT INTO progress (user_id,chapter_id,video_id,subject,category,video_done,handout_done,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,video_id) DO UPDATE SET video_done=excluded.video_done, handout_done=excluded.handout_done, updated_at=excluded.updated_at`)
    .run(userId, v.chapter_id || 0, v.id, (c && c.subject) || '', (c && c.category) || '',
      videoDone ? 1 : 0, handoutDone ? 1 : 0, now());
  return { video_id: v.id, video_done: videoDone ? 1 : 0, handout_done: handoutDone ? 1 : 0 };
}

/** 可进入课程的题：按视频/直接分组的实际归属计数（含问答题），不依赖冗余 questions.chapter_id。 */
function courseQuestionCountOf(chapterId) {
  const id = Number(chapterId);
  return db.prepare(`SELECT COUNT(*) n FROM questions q WHERE (
    q.video_id IN (SELECT id FROM videos WHERE chapter_id=?)
    OR ((q.video_id IS NULL OR q.video_id=0)
      AND q.section_id IN (SELECT id FROM sections WHERE chapter_id=?)))`).get(id, id).n;
}

// 课程列表：一门课程 = 一条目录（章节），卡片上直接带「知识点学习进度」
stu.get('/courses', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { subject = '', category = '' } = req.query;
  const W = visibleChapterWhere(u);
  let sql = `SELECT c.* FROM chapters c WHERE 1=1${W.sql}`; const args = [...W.args];
  if (subject) { sql += ' AND c.subject=?'; args.push(subject); }
  if (category) { sql += " AND IFNULL(c.category,'')=?"; args.push(category); }
  sql += " ORDER BY FIELD(c.subject,'数学','英语','物理','化学'), FIELD(IFNULL(c.category,''),'同步基础','同步培优','专项提升','中考冲刺'), FIELD(IFNULL(c.grade,''),'一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级','中考冲刺'), FIELD(IFNULL(c.stage,''),'primary','junior'), FIELD(IFNULL(c.term,''),'上册','下册'), c.sort, c.id";
  const chapters = db.prepare(sql).all(...args);
  const qV = db.prepare('SELECT COUNT(*) n FROM videos WHERE chapter_id=?');
  // 讲义 = 关联到本章视频的资料；习题库 = 没有关联视频的资料
  const qH = db.prepare('SELECT COUNT(*) n FROM handouts h WHERE h.chapter_id=? AND h.video_id IN (SELECT id FROM videos WHERE chapter_id=?)');
  const qE = db.prepare("SELECT COUNT(*) n FROM handouts h WHERE h.chapter_id=? AND (h.video_id IS NULL OR h.video_id NOT IN (SELECT id FROM videos WHERE chapter_id=?))");
  const qD = db.prepare(`SELECT COUNT(*) n FROM progress p JOIN videos v ON v.id=p.video_id
    WHERE p.user_id=? AND p.chapter_id=? AND p.video_done=1`);
  const list = chapters.map((c) => {
    const total = qV.get(c.id).n;
    const done = Math.min(total, qD.get(req.user.id, c.id).n);
    return {
      id: c.id, key: String(c.id), name: c.name,
      subject: c.subject || '', category: c.category || '同步基础',
      grade: c.grade || '', term: c.term || '', book: c.book || '', code: c.code || '',
      stage: c.stage || '',
      video_count: total, handout_count: qH.get(c.id, c.id).n, exercise_count: qE.get(c.id, c.id).n,
      question_count: courseQuestionCountOf(c.id),
      kp_total: total, kp_done: done,
      percent: total ? Math.round(done / total * 100) : 0,
      acc: courseAccOf(c.id, req.user.id),   // R8：课程卡片底部显示习题正确率
    };
  }).filter((c) => c.video_count > 0 || c.handout_count > 0 || c.exercise_count > 0 || c.question_count > 0);
  ok(res, list);
});

// 课程详情：知识点（按分级目录分组）+ 本章习题库
stu.get('/course-detail', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(req.query.id || req.query.key || 0));
  if (!c) return fail(res, '课程不存在');
  // 可见性校验：防止直接改地址看到不属于自己的课（专项 / 中考按学段，同步类按年级 + 册别）
  if (!canSeeChapter(u, c)) {
    const cat = String(c.category || '');
    if (cat === '专项提升') return fail(res, '这门专项课不属于你的学段，请到对应学段的专项提升里查看');
    if (cat === '中考冲刺') return fail(res, '中考冲刺课程仅初中账号可以查看');
    return fail(res, `这门课属于「${[c.grade, c.term].filter(Boolean).join(' ')}」，你的账号是「${[u.grade, u.term].filter(Boolean).join(' ')}」，请到对应年级 / 册别查看`);
  }
  const { lessons, library } = lessonsOf(c.id, u.id);
  const { grouped, groups, own } = groupsOf(c.id, lessons, u.id);
  const exercises = library.map((x) => ({ ...x, ext: x.ext || '' }));
  if (!lessons.length && !exercises.length && !courseQuestionCountOf(c.id)) return fail(res, '该课程暂无可学习内容');
  const kpDone = lessons.filter((l) => l.done).length;
  ok(res, {
    id: c.id, name: c.name, subject: c.subject || '', category: c.category || '同步基础',
    grade: c.grade || '', term: c.term || '', book: c.book || '', code: c.code || '',
    stage: c.stage || '',
    allow_speed: u.allow_speed === 0 ? 0 : 1,
    allow_seek: u.allow_seek === 0 ? 0 : 1,
    grouped, groups,
    acc: accuracy.sum(lessons.map((l) => l.acc).concat([own])),   // R8：含小分组自己的题
    next: nextLessonOf(grouped, groups, lessons),                     // R8：「继续学习」要去的视频
    kp_total: lessons.length, kp_done: kpDone,
    percent: lessons.length ? Math.round(kpDone / lessons.length * 100) : 0,
    lessons, exercises,
  });
});

// 上报学习进度（看完视频 / 打印或下载讲义）
stu.post('/progress', (req, res) => {
  const r = setProgress(req.user.id, (req.body || {}).video_id, req.body || {});
  if (!r) return fail(res, '知识点不存在');
  ok(res, r);
});

// 资料检索（备用：按目录/关键字查讲义与习题）
stu.get('/handouts', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { chapter_id = '', kw = '', kind = '' } = req.query;
  let sql = `SELECT h.id,h.title,h.file_name,h.ext,h.size,h.level,h.download_count,h.chapter_id,h.video_id,
                    IFNULL(h.kind,'handout') AS kind,
                    c.name AS chapter_name, c.subject, c.category
             FROM handouts h LEFT JOIN chapters c ON c.id=h.chapter_id WHERE 1=1`;
  const args = [];
  if (chapter_id) { sql += ' AND h.chapter_id=?'; args.push(Number(chapter_id)); }
  if (kind) { sql += " AND IFNULL(h.kind,'handout')=?"; args.push(kind); }
  if (kw) { sql += ' AND (h.title LIKE ? OR h.file_name LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }
  // 只给本年级、本册的资料（跟着所属章节走）
  const W = visibleChapterWhere(u);
  sql += ` AND (h.chapter_id IS NULL OR h.chapter_id IN (SELECT c.id FROM chapters c WHERE 1=1${W.sql}))`;
  args.push(...W.args);
  sql += ' ORDER BY c.subject, c.category, h.id DESC';
  ok(res, db.prepare(sql).all(...args));
});

stu.get('/handouts/:id/download', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const h = db.prepare('SELECT * FROM handouts WHERE id=?').get(Number(req.params.id));
  if (!h) return fail(res, '讲义不存在');
  // 越权校验：讲义挂在章节上时必须属于该学生的年级 / 学段（防止枚举 id 下载别年级的资料）
  if (h.chapter_id && !ensureChapterVisible(u, h.chapter_id, res)) return;
  db.prepare('UPDATE handouts SET download_count=download_count+1 WHERE id=?').run(h.id);
  // 打印/下载讲义 = 该知识点的讲义部分已完成（只要这份讲义挂在某个知识点上）
  if (h.chapter_id && (h.kind || 'handout') !== 'exercise') {
    const { lessons } = lessonsOf(h.chapter_id, u.id);
    const hit = lessons.find((l) => l.handout && l.handout.id === h.id);
    if (hit) setProgress(u.id, hit.video_id, { handout_done: 1 });
  }
  ok(res, { url: '', key: h.file_path, name: h.file_name });
});

stu.get('/videos', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { chapter_id = '' } = req.query;
  let sql = `SELECT v.id,v.title,v.level,v.duration,v.file_path,v.url,v.chapter_id,c.name AS chapter_name
             FROM videos v LEFT JOIN chapters c ON c.id=v.chapter_id WHERE 1=1`;
  const args = [];
  if (chapter_id) {
    // 越权校验：不允许拿别的年级 / 别的学段的章节 id 来取视频清单
    if (!ensureChapterVisible(u, chapter_id, res)) return;
    sql += ' AND v.chapter_id=?'; args.push(Number(chapter_id));
  }
  const scope = visibleChapterWhere(u, 'c');
  sql += ` AND (v.chapter_id IS NULL OR v.chapter_id=0 OR (c.id IS NOT NULL${scope.sql}))`;
  args.push(...scope.args);
  sql += ' ORDER BY v.sort, v.id';
  ok(res, db.prepare(sql).all(...args));
});

stu.get('/videos/:id/play', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '视频不存在');
  // 越权校验：防止枚举视频 id 播放不属于自己的课程（含付费讲座视频）
  if (v.chapter_id && !ensureChapterVisible(u, v.chapter_id, res)) return;
  // 本地文件代理地址必须带上登录票据：<video> 由浏览器直连拉流，带不了 Authorization 头
  const src = withFileTicket(v.url || await store.getUrl(v.file_path), req);
  const isFile = !v.url || /\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(v.url);
  ok(res, {
    src, title: v.title,
    is_file: !!isFile,
    allow_speed: u.allow_speed === 0 ? 0 : 1, // 该学生是否允许倍速播放（后台按学生设置）
    allow_seek: u.allow_seek === 0 ? 0 : 1,   // 该学生是否允许快进（后台按学生设置）
  });
});

// 取题练习（不下发答案）
stu.get('/practice', (req, res) => {
  const { chapter_id = '', count = 10, mode = 'normal' } = req.query;
  const uid = req.user.id;
  const n = Math.min(50, Math.max(1, Number(count) || 10));
  let rows;
  if (mode === 'mistake') {
    rows = db.prepare(`SELECT q.* FROM mistakes m JOIN questions q ON q.id=m.question_id WHERE ${require('./qmeta').questionScopeSql(null, 'q')} AND m.user_id=? AND m.resolved=0 ORDER BY m.updated_at DESC LIMIT ?`).all(uid, n);
  } else {
    let sql = 'SELECT * FROM questions q WHERE ' + require('./qmeta').questionScopeSql(null, 'q'); const args = [];
    if (chapter_id) {
      // 越权校验：不允许按别的年级 / 学段的章节 id 取题（题目本身不含答案，但内容属于付费范围）
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
      if (!ensureChapterVisible(u, chapter_id, res)) return;
      sql += ' AND chapter_id=?'; args.push(Number(chapter_id));
    }
    sql += ' ORDER BY RANDOM() LIMIT ?'; args.push(n);
    rows = db.prepare(sql).all(...args);
  }
  ok(res, rows.map((q) => {
    const o = parseQ(q);
    return { id: o.id, chapter_id: o.chapter_id, type: o.type, stem: o.stem, options: o.options, difficulty: o.difficulty };
  }));
});

// 提交答案 → 判分 + 回传答案与解析
stu.post('/practice/submit', (req, res) => {
  const uid = req.user.id;
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const { chapter_id = null, answers = [], duration = 0 } = req.body || {};
  if (!require('./qmeta').questionsAllowed(db, null, (Array.isArray(answers) ? answers : []).map(a => Number(a && a.question_id)))) return fail(res, '题目待老师审核，暂不能练习', 403);
  const results = [];
  let correct = 0;
  const insRec = db.prepare('INSERT INTO records (user_id,question_id,chapter_id,my_answer,is_correct,created_at) VALUES (?,?,?,?,?,?)');
  const upMis = db.prepare(`INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at) VALUES (?,?,1,?,0,?)
     ON CONFLICT(user_id,question_id) DO UPDATE SET wrong_count=wrong_count+1, last_answer=excluded.last_answer, resolved=0, updated_at=excluded.updated_at`);
  const rmMis = db.prepare('DELETE FROM mistakes WHERE user_id=? AND question_id=?');
  const getChapter = db.prepare('SELECT * FROM chapters WHERE id=?');
  const tx = db.transaction(() => {
    for (const a of answers) {
      const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(a.question_id));
      if (!q) continue;
      // 越权校验：只判「属于该学生可见章节」的题。
      // 否则可以枚举 question_id 提交，借返回的 answer / analysis 骗出任意题目的答案。
      if (q.chapter_id && !canSeeChapter(me, getChapter.get(q.chapter_id))) continue;
      const isCorrect = judge(q, a.my_answer);
      if (isCorrect) correct++;
      insRec.run(uid, q.id, q.chapter_id || chapter_id, String(a.my_answer || ''), isCorrect ? 1 : 0, now());
      if (isCorrect) {
        const m = db.prepare('SELECT * FROM mistakes WHERE user_id=? AND question_id=?').get(uid, q.id);
        if (m) { m.wrong_count >= 1 ? db.prepare('UPDATE mistakes SET resolved=1, updated_at=? WHERE id=?').run(now(), m.id) : rmMis.run(uid, q.id); }
      } else {
        upMis.run(uid, q.id, String(a.my_answer || ''), now());
      }
      results.push({
        question_id: q.id, type: q.type, stem: q.stem, options: parseQ(q).options,
        my_answer: String(a.my_answer || ''), answer: q.answer, analysis: q.analysis,
        difficulty: q.difficulty, is_correct: isCorrect,
      });
    }
    db.prepare('INSERT INTO practices (user_id,chapter_id,total,correct,duration,created_at) VALUES (?,?,?,?,?,?)')
      .run(uid, chapter_id, answers.length, correct, Number(duration) || 0, now());
  });
  tx();
  ok(res, { total: answers.length, correct, wrong: answers.length - correct, list: results },
    `本次共 ${answers.length} 题，答对 ${correct} 题`);
});

// 错题 Word 导出（T9）：把自己的错题导出成可编辑的 .docx；版式见 src/mistake-docx.js
stu.get('/mistakes/export-docx', async (req, res) => {
  try {
    const me = db.prepare("SELECT id, name, username FROM users WHERE id=? AND role='student'").get(req.user.id);
    if (!me) return res.status(403).json({ code: 403, msg: '仅学生账号可导出' });
    await require('./mistake-docx').sendMistakeDocx(db, res, me, req.query, { studentOnlyReviewed: true });
  } catch (e) {
    console.error('[mistakes/export-docx]', (e && e.message) || e);
    if (!res.headersSent) res.status(200).json({ code: 1, msg: '导出失败：' + ((e && e.message) || e) });
  }
});

// 收藏/标记掌握（前端传 resolved=0 可恢复回错题本）
stu.post('/mistakes/:qid/resolve', (req, res) => {
  if (!require('./qmeta').questionsAllowed(db, null, [Number(req.params.qid)])) return fail(res, '题目待老师审核，暂不能标记掌握', 403);
  const flag = Number((req.body || {}).resolved) === 0 ? 0 : 1;
  if (flag === 1) {
    db.prepare('UPDATE mistakes SET resolved=1, review_stage=0, updated_at=? WHERE user_id=? AND question_id=?').run(now(), req.user.id, Number(req.params.qid));
  } else {
    // 恢复：回到复习第 1 轮，明天再来
    db.prepare("UPDATE mistakes SET resolved=0, review_stage=0, next_review=strftime('%Y-%m-%d','now','localtime','+1 day'), updated_at=? WHERE user_id=? AND question_id=?").run(now(), req.user.id, Number(req.params.qid));
  }
  ok(res, { resolved: flag }, flag ? '已标记为掌握' : '已恢复到错题本');
});

stu.get('/mistakes', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`SELECT m.*, q.type, q.stem, q.options, q.answer, q.analysis, q.difficulty, c.name AS chapter_name
    FROM mistakes m JOIN questions q ON q.id=m.question_id LEFT JOIN chapters c ON c.id=q.chapter_id
    WHERE ${require('./qmeta').questionScopeSql(null, 'q')} AND m.user_id=? ORDER BY m.resolved, m.updated_at DESC`).all(uid).map((r) => ({ ...r, options: parseQ(r).options }));
  ok(res, {
    list: rows,
    pending: rows.filter((r) => !r.resolved).length,
    resolved: rows.filter((r) => r.resolved).length,
  });
});

stu.get('/report', (req, res) => {
  ok(res, studentReport(req.user.id, db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});

/** 学习报告：基于「知识点学习进度」，不再依赖做题数据 */
function studentReport(uid, u) {
  const W = visibleChapterWhere(u);
  const totalKp = db.prepare(`SELECT COUNT(*) n FROM videos v JOIN chapters c ON c.id=v.chapter_id WHERE 1=1${W.sql}`).get(...W.args).n;
  const doneKp = db.prepare(`SELECT COUNT(*) n FROM progress p JOIN videos v ON v.id=p.video_id JOIN chapters c ON c.id=v.chapter_id
    WHERE p.user_id=? AND p.video_done=1${W.sql}`).get(uid, ...W.args).n;
  const handoutDone = db.prepare(`SELECT COUNT(*) n FROM progress p JOIN videos v ON v.id=p.video_id JOIN chapters c ON c.id=v.chapter_id
    WHERE p.user_id=? AND p.handout_done=1${W.sql}`).get(uid, ...W.args).n;
  const activeDays = db.prepare('SELECT COUNT(DISTINCT substr(updated_at,1,10)) n FROM progress WHERE user_id=?').get(uid).n;
  const subjects = db.prepare(`SELECT c.subject AS subject, COUNT(v.id) AS total,
      SUM(CASE WHEN p.video_done=1 THEN 1 ELSE 0 END) AS done
    FROM videos v JOIN chapters c ON c.id=v.chapter_id
    LEFT JOIN progress p ON p.video_id=v.id AND p.user_id=?
    WHERE c.subject<>''${W.sql} GROUP BY c.subject`).all(uid, ...W.args)
    .map((r) => ({ subject: r.subject, total: r.total, done: r.done || 0, percent: r.total ? Math.round((r.done || 0) / r.total * 100) : 0 }))
    .sort((a, b) => subjectRank(a.subject) - subjectRank(b.subject));
  const courses = db.prepare(`SELECT c.id, c.name, c.subject, c.category, COUNT(v.id) AS total,
      SUM(CASE WHEN p.video_done=1 THEN 1 ELSE 0 END) AS done
    FROM chapters c JOIN videos v ON v.chapter_id=c.id
    LEFT JOIN progress p ON p.video_id=v.id AND p.user_id=?
    WHERE 1=1${W.sql} GROUP BY c.id, c.name, c.subject, c.category, c.sort ORDER BY c.sort, c.id`).all(uid, ...W.args)
    .map((r) => ({ ...r, done: r.done || 0, percent: r.total ? Math.round((r.done || 0) / r.total * 100) : 0 }));
  const days = db.prepare(`SELECT substr(updated_at,1,10) d, COUNT(*) n FROM progress WHERE user_id=?
    GROUP BY substr(updated_at,1,10) ORDER BY d DESC LIMIT 14`).all(uid).reverse();
  const recent = db.prepare(`SELECT p.updated_at, p.video_done, p.handout_done, v.title AS video_title,
      c.name AS chapter_name, c.subject, c.category
    FROM progress p JOIN videos v ON v.id=p.video_id LEFT JOIN chapters c ON c.id=v.chapter_id
    WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT 10`).all(uid);
  return {
    user: { id: u.id, name: u.name, grade: u.grade || '', term: u.term || '' },
    kp_total: totalKp,
    kp_done: Math.min(totalKp, doneKp),
    percent: totalKp ? Math.round(Math.min(totalKp, doneKp) / totalKp * 100) : 0,
    handout_done: handoutDone,
    active_days: activeDays,
    subjects, courses, days, recent,
  };
}

// 单词发音：Windows 自带语音（英文 Zira / 中文慧慧）生成 wav。<audio> 不能加请求头，票据放在 query 上
app.get('/api/speak', auth(), async (req, res) => {
  const text = String(req.query.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return res.status(400).end();
  const lang = /^zh/i.test(String(req.query.lang || '')) ? 'zh-CN' : 'en-US';
  let r = Number(req.query.r);
  if (!Number.isFinite(r)) r = 1;
  const rate = Math.max(-6, Math.min(6, Math.round((r - 1) * 8)));
  try {
    const buf = await speakToBuffer(text, lang, rate);
    const mp3 = buf.length > 2 && (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0));
    res.setHeader('Content-Type', mp3 ? 'audio/mpeg' : 'audio/wav');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (e) {
    console.error('[speak]', (e && e.message) || e);
    if (!res.headersSent) res.status(500).end();
  }
});

// 纸质化默写表：AI 补齐句子结构标注（whole=整句结构短语；parts=按语法成分切分的连续片段 [{t:片段原文,s:成分名}]，拼接须还原整句）。
// 结果内存缓存，前端另有 localStorage 缓存，二次生成不重复调 AI。老缓存值是纯字符串（兼容）
const sentStructCache = new Map();   // 句子文本 -> {whole, parts} 或老版字符串
async function sentStructsHandler(req, res) {
  try {
    const texts = (Array.isArray(req.body && req.body.texts) ? req.body.texts : [])
      .map((t) => String(t || '').trim()).filter(Boolean).slice(0, 20);
    if (!texts.length) return res.json({ code: 0, data: [] });
    const out = texts.map((t) => sentStructCache.get(t) || '');
    const missIdx = texts.map((t, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
    if (missIdx.length) {
      const { chat } = require('./ai');
      const sys = '你是中小学英语语法老师。对输入的每个英语句子完成两项分析：'
        + '1) whole：用简短中文短语给出核心句子结构（12字以内），如：主谓宾/主系表/定语从句/状语从句/宾语从句/there be句型/祈使句/主谓宾+宾语从句；'
        + '2) parts：把句子按语法成分切分成若干个连续片段（原样保留单词拼写与标点，标点归前一片段末尾），'
        + '每个片段给出成分名称 s（主语/谓语/定语/宾语/直接宾语/间接宾语/表语/宾补/状语/同位语），片段原文存 t，所有片段按顺序拼接必须还原整句。'
        + '只输出一个 JSON 数组，与输入顺序一一对应，格式：'
        + '[{"whole":"主谓双宾","parts":[{"t":"The mother","s":"主语"},{"t":"gave","s":"谓语"}]},...]，不要输出任何解释。';
      const { text: reply } = await chat({
        system: sys,
        user: JSON.stringify(missIdx.map((i) => texts[i])),
        maxTokens: 2600, temperature: 0.2,
      });
      let arr = null;
      try { arr = JSON.parse(reply); } catch (e) {
        const m = String(reply).match(/\[[\s\S]*\]/);
        if (m) { try { arr = JSON.parse(m[0]); } catch (e2) { /* 保持 null */ } }
      }
      if (Array.isArray(arr)) {
        missIdx.forEach((i, k) => {
          const v = arr[k];
          let val = '';
          if (v && typeof v === 'object') {
            const whole = String(v.whole || '').trim().slice(0, 30);
            const parts = (Array.isArray(v.parts) ? v.parts : [])
              .map((p) => ({ t: String((p && p.t) || '').trim(), s: String((p && p.s) || '').trim() }))
              .filter((p) => p.t).slice(0, 26);
            if (whole || parts.length) val = { whole, parts };
          } else {
            const s = String(v || '').trim().slice(0, 30);
            if (s) val = s;   // 老格式兜底
          }
          if (val) { out[i] = val; sentStructCache.set(texts[i], val); }
        });
      }
    }
    res.json({ code: 0, data: out });
  } catch (e) {
    res.status(500).json({ code: 1, msg: 'AI 结构分析失败：' + (e.message || e) });
  }
}
stu.post('/sent-structs', sentStructsHandler);

app.use('/api/admin', bankImgTicketJson, admin);
app.use('/api/stu', bankImgTicketJson, stu);

// 纸质化默写表导出 PDF：前端 html2canvas 逐页截图 → 这里拼成 A4 PDF 直接回传下载（复用 pdfimg，不落盘）
function paperPdfHandler(req, res) {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ code: 1, msg: '没有可导出的页面' });
  try {
    const pdfimg = require('./pdfimg');
    const A4 = [595.28, 841.89];
    const pages = files.map((f) => {
      const info = pdfimg.imageInfo(f.buffer);
      let iw = A4[0];
      let ih = A4[0] * (info.height / info.width);
      if (ih > A4[1]) { const k = A4[1] / ih; iw *= k; ih *= k; }
      return { images: [{ buf: f.buffer, x: (A4[0] - iw) / 2, y: (A4[1] - ih) / 2, w: iw, h: ih }] };
    });
    const buf = pdfimg.build({ size: A4, pages });
    const name = (String(req.query.title || '').replace(/[\\/:*?"<>|]/g, '').trim() || '默写表') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="paper.pdf"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) {
    console.error('[paper-pdf]', (e && e.message) || e);
    res.status(500).json({ code: 1, msg: '导出失败：' + ((e && e.message) || e) });
  }
}
stu.post('/paper-pdf', upload.array('pages', 30), paperPdfHandler);

// 手机扫码上传试卷（家长手机端，免登录：token 由管理端 /api/admin/report/scan-token 签发，30 分钟有效）
app.use('/api/report-scan', require('./report').scan);
// 上传相关错误统一返回 JSON（文件太大 / 超出数量等）
app.use((err, req, res, next) => {
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE')) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '单个文件超过大小限制'
      : err.code === 'LIMIT_UNEXPECTED_FILE' ? '一次上传的文件数量太多，请分批上传' : '上传失败：' + err.message;
    return res.json({ code: 1, msg });
  }
  next(err);
});

// 兜底异常处理：Express 默认处理器在非生产模式会把完整堆栈写回页面（信息泄露），
// 这里统一转成简短提示，堆栈只打到服务端日志。
app.use((err, req, res, next) => {
  console.error('[未捕获异常]', req.method, req.originalUrl, (err && err.stack) || err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ code: 500, msg: '服务器内部错误，请稍后重试' });
  res.status(500).send('服务器内部错误');
});

// ------------------------------------------------------------------ 静态站点
/** 页面 / 脚本 / 样式一律让浏览器回源校验（ETag 命中自动 304，文件改了立刻生效）。
 *  不这样设的话，浏览器会长时间用缓存里的旧 js / css，
 *  就会出现「后台明明改好了，打开还是老样子」这种假故障。 */
const noStale = (res, filePath) => {
  if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
};
app.use('/admin', careAudio.protectStatic(path.join(PUBLIC, 'admin')), express.static(path.join(PUBLIC, 'admin'), { setHeaders: noStale }));
app.use('/', careAudio.protectStatic(PUBLIC), express.static(PUBLIC, { setHeaders: noStale }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ code: 404, msg: '接口不存在' });
  res.status(404).send('页面不存在');
});

app.listen(PORT, () => {
  console.log('====================================================');
  console.log('  学习系统已启动');
  console.log('  学生端： http://localhost:' + PORT + '/');
  console.log('  管理端： http://localhost:' + PORT + '/admin/');
  console.log('  数据库： MySQL ' + DB_INFO.database + ' @ ' + DB_INFO.host + ':' + DB_INFO.port);
  console.log('  存储驱动：' + store.driverName()
    + (store.usingCdn() ? '（CDN 分发：' + store.CDN_DOMAIN + '）'
      : store.isOss() ? '（签名直链，未启用 CDN）'
      : store.isQiniu() ? '，外链域名：' + store.getQiniuDomain() : ''));
  console.log('====================================================');
});
