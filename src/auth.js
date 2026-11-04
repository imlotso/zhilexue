'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DATA_DIR } = require('./db');

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
    try {
      const user = jwt.verify(token, SECRET);
      if (role && user.role !== role) return res.status(403).json({ code: 403, msg: '无权限' });
      req.user = user;
      next();
    } catch (e) {
      if (required) return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
      next();
    }
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

module.exports = { hash, check, sign, auth, signFileTicket, verifyFileTicket };
