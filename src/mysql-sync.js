'use strict';
/**
 * 同步 MySQL 访问层，接口对齐 better-sqlite3：
 *   db.prepare(sql).get / .all / .run
 *   db.exec(sql)
 *   db.transaction(fn)
 * 业务代码不用改成 async。查询在独立线程里执行，主线程等待结果。
 */
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

function splitSql(sql) {
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      cur += c;
      if (c === quote && sql[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '\'' || c === '"') { quote = c; cur += c; continue; }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 把少量 SQLite 写法换成 MySQL 能执行的语句 */
function translateQuery(sql) {
  return String(sql)
    .replace(/\bRANDOM\s*\(\s*\)/gi, 'RAND()')
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'REPLACE INTO')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO')
    .replace(/ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE')
    .replace(/\bexcluded\.([A-Za-z_][A-Za-z0-9_]*)/gi, 'VALUES($1)');
}

function openMysql(config) {
  const sab = new SharedArrayBuffer(4);
  const signal = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'mysql-worker.js'), { workerData: { sab } });
  let seq = 0;
  let ready = false;
  let workerError = null;

  worker.on('error', (err) => { workerError = err; });
  worker.on('exit', (code) => {
    if (code !== 0 && !workerError) workerError = new Error('MySQL 工作线程已退出（' + code + '）');
  });

  function rpc(payload, transfer, timeoutMs) {
    if (workerError) throw workerError;
    const id = ++seq;
    Atomics.store(signal, 0, 0);
    // 上一次超时后迟到的旧回复还留在队列里，先清掉，否则本次会拿到旧应答、
    // 且之后每次调用都会永久错位（主线程是同步模型，同刻最多一个在途请求，清掉是安全的）
    for (;;) {
      const stale = receiveMessageOnPort(port1);
      if (!stale) break;
      console.error('[mysql] 丢弃上一次请求的迟到回复（id=' + (stale.message && stale.message.id) + '）');
    }
    worker.postMessage(Object.assign({ id }, payload), transfer || []);
    const deadline = Date.now() + (timeoutMs || 60000);
    let got;
    while (!(got = receiveMessageOnPort(port1))) {
      if (workerError) throw workerError;
      if (Date.now() > deadline) throw new Error('MySQL 操作超时');
      Atomics.wait(signal, 0, 0, 200);
    }
    const msg = got.message;
    if (!msg || msg.id !== id) throw new Error('MySQL 返回结果不匹配');
    if (!msg.ok) {
      const err = new Error(msg.error && msg.error.message ? msg.error.message : 'MySQL 错误');
      err.code = msg.error && msg.error.code;
      err.errno = msg.error && msg.error.errno;
      throw err;
    }
    return msg.data;
  }

  const info = rpc({ type: 'init', config, reply: port2 }, [port2], 20000);
  ready = true;

  function query(sql, params) {
    if (!ready) throw new Error('数据库还没连上');
    return rpc({ type: 'query', sql: translateQuery(sql), params: params || [] });
  }

  function exec(sql) {
    const parts = splitSql(translateQuery(sql));
    for (const stmt of parts) query(stmt);
  }

  function statement(sql) {
    return {
      get(...args) {
        const rows = query(sql, args);
        if (!Array.isArray(rows) || !rows.length) return undefined;
        return rows[0];
      },
      all(...args) {
        const rows = query(sql, args);
        return Array.isArray(rows) ? rows : [];
      },
      run(...args) {
        const r = query(sql, args);
        if (Array.isArray(r)) return { changes: 0, lastInsertRowid: 0 };
        return { changes: Number(r.changes || 0), lastInsertRowid: Number(r.lastInsertRowid || 0) };
      },
    };
  }

  function transaction(fn) {
    return function run(...args) {
      query('START TRANSACTION');
      try {
        const result = fn.apply(this, args);
        query('COMMIT');
        return result;
      } catch (e) {
        try { query('ROLLBACK'); } catch (e2) { /* 事务已经结束 */ }
        throw e;
      }
    };
  }

  function batch(sql, rows) {
    if (!rows || !rows.length) return { changes: 0, lastInsertRowid: 0 };
    const data = rpc({ type: 'batch', sql: translateQuery(sql), rows });
    return { changes: Number(data.changes || 0), lastInsertRowid: Number(data.lastInsertRowid || 0) };
  }

  return {
    info,
    prepare: (sql) => statement(sql),
    exec,
    transaction,
    batch,
    splitSql,
  };
}

module.exports = { openMysql, splitSql, translateQuery };
