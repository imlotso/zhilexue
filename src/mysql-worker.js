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
let readOnly = false;

function assertDbName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ''))) {
    throw new Error('数据库名不合法：' + name);
  }
  return name;
}

async function connect(config) {
  cfg = config;
  const database = assertDbName(config.database);
  const restored = process.env.RESTORED_DB_MODE === '1';
  if (restored && config.socketPath !== undefined && config.socketPath !== '/run/db/mysql.sock') throw new Error('RESTORED_DB_SOCKET_MISMATCH');
  if (restored && (config.host !== '127.0.0.1' || Number(config.port) !== 13307 || config.user !== 'zx_restore_20261108' || database !== 'zhilexue_original_restore_20261108')) throw new Error('RESTORED_DB_TARGET_MISMATCH');
  if (conn) {
    try { await conn.end(); } catch (e) { /* 旧连接已断开 */ }
    conn = null;
  }
  const next = await mysql.createConnection({
    ...(readOnly || restored ? { database } : {}),
    ...(restored && config.socketPath ? { socketPath: config.socketPath } : {}),
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
  try {
    if (restored) {
      const [rows] = await next.query('SELECT DATABASE() AS db, CURRENT_USER() AS account, @@server_uuid AS server_uuid');
      if (rows.length !== 1 || rows[0].db !== database || rows[0].account !== 'zx_restore_20261108@172.17.0.1' || rows[0].server_uuid !== 'c2460962-da9c-11f1-a7bd-0afb9d5ba49c') throw new Error('RESTORED_DB_IDENTITY_MISMATCH');
    }
    if (readOnly) {
      // Applies to every transaction, including autocommit and reconnects.
      // Failure is fatal: never fall back to the initializing connection path.
      await next.query('SET SESSION TRANSACTION READ ONLY');
    } else if (!restored) {
      await next.query('CREATE DATABASE IF NOT EXISTS `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await next.query('USE `' + database + '`');
      await next.query('ALTER DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    }
    await next.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    conn = next;
    dead = false;
    next.on('error', (e) => { if (next === conn && e && e.fatal) dead = true; });
  } catch (e) {
    try { await next.end(); } catch (_) { /* preserve setup error */ }
    throw e;
  }
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

function assertReadQuery(sql) {
  if (!readOnly) return;
  // Deliberately narrow guard for these internal preview SELECTs, not a SQL
  // parser or a security boundary for arbitrary/untrusted SQL. The server's
  // read-only session also enforces data protection. No multi-statements,
  // comments, SELECT INTO, locking reads or session changes are accepted.
  const text = String(sql || '');
  if (!/^\s*SELECT\b/i.test(text) || /;|\/\*|\*\/|--|#|:=|\bINTO\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\b/i.test(text)) {
    throw new Error('只读预检连接仅允许 SELECT 查询');
  }
}

async function query(sql, params) {
  assertReadQuery(sql);
  if (!inTx) await ensureConn();
  else if (!conn || dead) {
    const e = new Error('事务连接已失效，不能在新连接上继续或确认提交');
    e.code = 'TRANSACTION_CONNECTION_LOST';
    throw e;
  }
  try {
    const [rows] = await conn.query(sql, normParams(params));
    return shape(rows);
  } catch (e) {
    if (isLost(e)) dead = true;
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
      if (replyPort) throw new Error('MySQL 工作线程已初始化');
      replyPort = msg.reply;
      readOnly = msg.config.readOnly === true;
      await connect(msg.config);
      const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
      data = { version: rows[0].version, database: rows[0].db };
    } else if (!replyPort) {
      throw new Error('MySQL 工作线程尚未初始化');
    } else if (msg.type === 'query') {
      assertReadQuery(msg.sql);
      const upper = String(msg.sql || '').trim().toUpperCase();
      if (upper.startsWith('START TRANSACTION') || upper === 'BEGIN') { await ensureConn(); inTx = true; }
      const finishesTransaction = upper === 'COMMIT' || upper === 'ROLLBACK';
      try { data = await query(msg.sql, msg.params); }
      finally { if (finishesTransaction) inTx = false; }
    } else if (msg.type === 'batch') {
      assertReadQuery(msg.sql);
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
    const upper = String(msg.sql || '').trim().toUpperCase();
    if (upper.startsWith('START TRANSACTION') || upper === 'BEGIN') inTx = false;
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
