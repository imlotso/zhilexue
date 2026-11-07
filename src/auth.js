'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR } = require('./db');

// 密钥：优先环境变量；未配置则生成一次并持久化到 data/.secret
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const p = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(p)) SECRET = fs.readFileSync(p, 'utf8').trim();
  else {
    SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(p, SECRET);
  }
}

const hash = (pwd) => bcrypt.hashSync(pwd, 10);
const check = (pwd, h) => bcrypt.compareSync(pwd, h);
const sign = (payload) => jwt.sign(payload, SECRET, { expiresIn: '30d' });

function auth(required = true, role = null) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    if (!token) {
      if (required) return res.status(401).json({ code: 401, msg: '请先登录' });
      return next();
    }
    let user;
    try {
      user = jwt.verify(token, SECRET);
    } catch (e) {
      if (required) return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
      return next();
    }
    if (role && user.role !== role) return res.status(403).json({ code: 403, msg: '无权限' });
    // JWT 有效期长于账号状态：每次请求复核真实账号，停用、删除、到期或改角色立即生效。
    const current = db.prepare('SELECT id,role,status,expire_at,username,name FROM users WHERE id=?').get(user.id);
    if (!current || current.role !== user.role) return res.status(401).json({ code: 401, msg: '登录已失效，请重新登录' });
    if (Number(current.status) !== 1) return res.status(403).json({ code: 403, msg: '账号已被停用，请联系管理员' });
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (['student', 'branch'].includes(current.role) && current.expire_at && String(current.expire_at).slice(0, 10) < today) {
      return res.status(403).json({ code: 403, msg: `账号已于 ${String(current.expire_at).slice(0, 10)} 到期，请${current.role === 'branch' ? '联系校长' : '联系老师'}续期` });
    }
    req.user = { ...user, ...current };
    next();
  };
}

/** 题图只读票据（R0-B9）：<img> 发不了 Authorization 头，本地存储的题图 /api/file?key=bank/img/… 就会 401。
 *  不把登录令牌拼进 URL（那样泄露的是整个登录态），而是给每个 key 单独签一个「只能读这一个文件」的短时票据：
 *  ft = <过期时间戳(秒)>.<HMAC-SHA256(key|exp) 前 32 位>，绑定具体 key、过期即失效、不是 JWT，不能当登录令牌用。 */
const FILE_TICKET_TTL = 6 * 3600;   // 6 小时：够一次做题 / 一次后台整理，过期刷新页面即可
function fileTicketSig(key, exp) {
  return crypto.createHmac('sha256', SECRET).update('file-ticket|' + key + '|' + exp).digest('base64url').slice(0, 32);
}
function signFileTicket(key, ttl = FILE_TICKET_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return exp + '.' + fileTicketSig(key, exp);
}
function verifyFileTicket(key, ticket) {
  const m = /^(\d{9,12})\.([A-Za-z0-9_-]{32})$/.exec(String(ticket || ''));
  if (!m || !key || Number(m[1]) < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(fileTicketSig(key, m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 学生做题票据：与学生和具体题目绑定，不能当登录令牌或文件票据使用。
const QUESTION_TICKET_TTL = 2 * 3600;
function questionTicketSig(uid, qid, exp) {
  return crypto.createHmac('sha256', SECRET).update(`question-ticket|${uid}|${qid}|${exp}`).digest('base64url').slice(0, 32);
}
function signQuestionTicket(uid, qid, ttl = QUESTION_TICKET_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return exp + '.' + questionTicketSig(uid, qid, exp);
}
function verifyQuestionTicket(uid, qid, ticket) {
  const m = /^(\d{9,12})\.([A-Za-z0-9_-]{32})$/.exec(String(ticket || ''));
  if (!Number.isSafeInteger(Number(uid)) || Number(uid) <= 0 || !Number.isSafeInteger(Number(qid)) || Number(qid) <= 0 || !m || Number(m[1]) <= Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(questionTicketSig(uid, qid, m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hash, check, sign, auth, signFileTicket, verifyFileTicket, signQuestionTicket, verifyQuestionTicket };
