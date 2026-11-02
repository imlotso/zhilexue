'use strict';
/**
 * MySQL 工作线程。
 * 主线程用同步方式发 SQL（见 mysql-sync.js），查询在这里异步执行，
 * 这样业务代码可以继续用原来的 db.prepare().get/all/run 写法。
 */
const { parentPort, workerData } = require('worker_threads');
const mysql = require('mysql2/promise');

const signal = new Int32Array(workerData.sab);
let replyPort = null;
let conn = null;
let inTx = false;
let cfg = null;
let dead = false;
let connecting = null;

function assertDbName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ''))) {
    throw new Error('数据库名不合法：' + name);
  }
  return name;
}

async function connect(config) {
  cfg = config;
  const database = assertDbName(config.database);
  if (conn) {
    try { await conn.end(); } catch (e) { /* 旧连接已断开 */ }
    conn = null;
  }
  conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectTimeout: 10000,
    multipleStatements: false,
    typeCast(field, next) {
      if (field.type === 'NEWDECIMAL' || field.type === 'DECIMAL') {
        const s = field.string();
        if (s == null || s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : s;
      }
      return next();
    },
  });
  await conn.query(
    'CREATE DATABASE IF NOT EXISTS `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  await conn.query('USE `' + database + '`');
  await conn.query(
    'ALTER DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  dead = false;
  const c = conn;
  conn.on('error', (e) => { if (c === conn && e && e.fatal) dead = true; });
  // 去掉 ONLY_FULL_GROUP_BY，让原来按 SQLite 写的分组查询能直接跑
  await conn.query(
    "SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
  );
}

function plain(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  return value;
}

function shape(rows) {
  if (Array.isArray(rows)) {
    return rows.map((row) => {
      const out = {};
      for (const k of Object.keys(row)) out[k] = plain(row[k]);
      return out;
    });
  }
  return {
    changes: Number(rows && rows.affectedRows ? rows.affectedRows : 0),
    lastInsertRowid: Number(rows && rows.insertId ? rows.insertId : 0),
  };
}

function normParams(params) {
  if (!params || !params.length) return [];
  return params.map((v) => (v === undefined ? null : v));
}

const LOST_CODES = ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'];

function isLost(e) {
  return !!e && (e.fatal === true || LOST_CODES.includes(e.code) || /closed state|connection lost|not connected/i.test(String(e.message)));
}

function reconnect() {
  if (!connecting) {
    connecting = connect(cfg)
      .then(() => { console.error('[mysql] 已重新连接'); })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

async function ensureConn() {
  if (connecting) return connecting;
  if (!conn || dead) {
    console.error('[mysql] 连接已失效，重连中');
    await reconnect();
  }
}

async function query(sql, params) {
  if (!inTx) await ensureConn();
  else if (connecting) await connecting;
  try {
    const [rows] = await conn.query(sql, normParams(params));
    return shape(rows);
  } catch (e) {
    const readOnly = /^\s*(SELECT|SHOW)\b/i.test(String(sql));
    const neverSent = /closed state/i.test(String(e && e.message));
    if (isLost(e) && !inTx && cfg && (readOnly || neverSent)) {
      await reconnect();
      const [rows] = await conn.query(sql, normParams(params));
      return shape(rows);
    }
    throw e;
  }
}

function reply(id, ok, data, error) {
  replyPort.postMessage({ id, ok, data: data === undefined ? null : data, error: error || null });
  Atomics.store(signal, 0, id);
  Atomics.notify(signal, 0);
}

parentPort.on('message', async (msg) => {
  let data = null;
  let error = null;
  try {
    if (msg.type === 'init') {
      replyPort = msg.reply;
      await connect(msg.config);
      const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
      data = { version: rows[0].version, database: rows[0].db };
    } else if (!replyPort) {
      throw new Error('MySQL 工作线程尚未初始化');
    } else if (msg.type === 'query') {
      const upper = String(msg.sql || '').trim().toUpperCase();
      if (upper.startsWith('START TRANSACTION') || upper === 'BEGIN') { await ensureConn(); inTx = true; }
      if (upper === 'COMMIT' || upper === 'ROLLBACK') inTx = false;
      data = await query(msg.sql, msg.params);
    } else if (msg.type === 'batch') {
      let changes = 0;
      let lastInsertRowid = 0;
      for (const params of msg.rows || []) {
        const r = await query(msg.sql, params);
        changes += r.changes || 0;
        if (r.lastInsertRowid) lastInsertRowid = r.lastInsertRowid;
      }
      data = { changes, lastInsertRowid };
    } else {
      throw new Error('未知指令：' + msg.type);
    }
  } catch (e) {
    error = { message: e.message || String(e), code: e.code || '', errno: e.errno || 0 };
    if (String(msg.sql || '').trim().toUpperCase().startsWith('START TRANSACTION')) inTx = false;
  }
  if (!replyPort) {
    console.error('[mysql] 初始化失败且无法回传：', error && error.message);
    process.exit(1);
  }
  reply(msg.id, !error, data, error);
});

setInterval(async () => {
  if (!cfg || !replyPort || inTx || connecting) return;
  try {
    if (!conn || dead) await reconnect();
    else await conn.query('SELECT 1');
  } catch (e) {
    if (isLost(e) && !inTx) {
      try { await reconnect(); } catch (e2) { console.error('[mysql] 心跳重连失败：', e2.message); }
    }
  }
}, 30000).unref();
