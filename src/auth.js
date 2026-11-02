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

module.exports = { hash, check, sign, auth };
