'use strict';
// Offline worker/CLI regression: controlled mysql2 boundary, never a real database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function worker({ missing = false, failReadOnly = false } = {}) {
  let handler, heartbeat, id = 0, lost = false, onError;
  const calls = [], options = [], replies = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/mysql-worker.js'), 'utf8'), {
    require(name) {
      if (name === 'worker_threads') return { workerData: { sab: new SharedArrayBuffer(4) }, parentPort: { on: (_, fn) => { handler = fn; } } };
      assert.equal(name, 'mysql2/promise');
      return { async createConnection(opts) {
        options.push(opts);
        if (missing && opts.database) throw Object.assign(new Error('Unknown database'), { code: 'ER_BAD_DB_ERROR' });
        return { async end() {}, on(_, fn) { onError = fn; }, async query(sql) {
          calls.push(sql);
          if (failReadOnly && /TRANSACTION READ ONLY/.test(sql)) throw new Error('read-only unavailable');
          if (lost && sql === 'SELECT 42') { lost = false; throw Object.assign(new Error('connection lost'), { fatal: true }); }
          return [[{ version: 'synthetic', db: 'fixture' }]];
        } };
      } };
    }, console: { error() {} }, process: { exit() { throw new Error('unexpected exit'); } },
    setInterval(fn) { heartbeat = fn; return { unref() {} }; }, SharedArrayBuffer, Int32Array, Atomics,
  });
  return { calls, options, fatal: () => onError({ fatal: true }), heartbeat: () => heartbeat(), lose: () => { lost = true; }, async send(msg) {
    await handler({ id: ++id, reply: { postMessage: (r) => replies.push(r) }, ...msg });
    return replies.at(-1);
  } };
}
const config = { database: 'fixture', readOnly: true };
test('read-only init and reconnect select existing database without DDL/DML', async () => {
  const w = worker();
  assert.equal((await w.send({ type: 'init', config })).ok, true);
  assert.equal(w.options[0].database, 'fixture');
  assert.ok(w.calls.includes('SET SESSION TRANSACTION READ ONLY'));
  w.lose(); assert.equal((await w.send({ type: 'query', sql: 'SELECT 42' })).ok, true);
  await w.heartbeat();
  assert.equal(w.options.length, 2);
  assert.equal(w.calls.filter(s => s === 'SET SESSION TRANSACTION READ ONLY').length, 2);
  assert.ok(!w.calls.some(s => /^(CREATE|ALTER|UPDATE)/i.test(s)));
});
test('missing database and failed read-only setup fail closed', async () => {
  for (const scenario of [{ missing: true }, { failReadOnly: true }]) {
    const w = worker(scenario);
    assert.equal((await w.send({ type: 'init', config })).ok, false);
    assert.ok(!w.calls.some(s => /^(CREATE|ALTER|UPDATE)/i.test(s)));
  }
});
test('read-only worker rejects query and batch writes before driver invocation', async () => {
  const w = worker(); await w.send({ type: 'init', config });
  for (const type of ['query', 'batch']) for (const sql of ['UPDATE bank_trees SET name=?', 'CREATE TABLE x(id INT)', 'SET SESSION TRANSACTION READ WRITE', 'SELECT 1 INTO OUTFILE "/tmp/x"', 'SELECT 1; DELETE FROM x', 'START TRANSACTION', 'SELECT /*!50000 1 */']) {
    const before = w.calls.length;
    const r = await w.send({ type, sql, rows: [[1]], params: [1] });
    assert.equal(r.ok, false, sql); assert.equal(w.calls.length, before, sql);
  }
});
test('normal worker retains database creation and alteration', async () => {
  const w = worker(); assert.equal((await w.send({ type: 'init', config: { database: 'fixture' } })).ok, true);
  assert.ok(w.calls.some(s => s.startsWith('CREATE DATABASE')));
  assert.ok(w.calls.some(s => s.startsWith('ALTER DATABASE')));
  assert.equal((await w.send({ type: 'query', sql: 'UPDATE x SET n=1' })).ok, true);
});
function cli(script, flag, invalid = false, missing = false) {
  const loaded = []; let code;
  const stop = Symbol(); const db = { prepare: () => ({ get: () => ({ u: 0, p: 0, n: 0 }), all: () => [] }) };
  const io = { normalizeInput(raw) { if (invalid) throw new Error('bad shape'); return raw; }, importAll: () => [] };
  const context = { console: { log() {}, error() {} }, process: { argv: ['node', script, ...(script.includes('import-') ? ['x.json'] : []), flag], cwd: () => '/', exit(n) { code = n; throw stop; } }, require(name) {
    loaded.push(name);
    if (name === 'fs') return { existsSync: () => !missing, statSync: () => ({ isDirectory: () => false }), readFileSync: () => '{}' };
    if (name === 'path') return path;
    if (name === '../src/treeio') return io;
    if (name === '../src/kbtree') return { migrateAll: () => ({ list: [], units: 0, points: 0, created: 0 }) };
    if (name === '../src/db' || name === '../src/db-connection') return { db, DB_INFO: {}, openReadOnly: () => ({ db, DB_INFO: {} }) };
    throw new Error(name);
  } };
  try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, script), 'utf8'), context); } catch (e) { if (e !== stop) throw e; }
  return { loaded, code };
}
for (const [script, flag] of [['scripts/import-trees.js', '--dry-run'], ['scripts/import-trees.js', '-n'], ['scripts/migrate-kb-to-trees.js', '--dry-run']]) test(`${script} ${flag} never loads initializing db`, () => {
  const result = cli(script, flag); assert.equal(result.code, 0); assert.ok(!result.loaded.includes('../src/db'));
});
test('invalid import data is rejected before connecting', () => {
  const result = cli('scripts/import-trees.js', '--dry-run', true);
  assert.equal(result.code, 1); assert.ok(!result.loaded.includes('../src/db')); assert.ok(!result.loaded.includes('../src/db-connection'));
});
function connectionModule(env, local, error) {
  let opened;
  const context = { module: { exports: {} }, process: { env }, require(name) {
    if (name === './config.local') { if (error) throw error; return { mysql: local }; }
    assert.equal(name, './mysql-sync'); return { openMysql(config) { opened = config; return {}; } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/db-connection.js'), 'utf8'), context);
  return { ...context.module.exports, opened: () => opened };
}
test('configuration retains environment > local > defaults and explicit read-only option', () => {
  const local = { host: 'local-host', port: 3307, user: 'local-user', password: 'synthetic', database: 'local-db' };
  const env = { MYSQL_HOST: 'env-host', MYSQL_PORT: '3308', MYSQL_USER: 'env-user', MYSQL_PASSWORD: 'env-synthetic', MYSQL_DATABASE: 'env-db' };
  const c = connectionModule(env, local);
  assert.deepEqual(JSON.parse(JSON.stringify(c.DB_INFO)), { host: 'env-host', port: 3308, user: 'env-user', password: 'env-synthetic', database: 'env-db' });
  c.openReadOnly(); assert.equal(c.opened().readOnly, true); assert.equal(c.opened().database, 'env-db');
  assert.deepEqual(JSON.parse(JSON.stringify(connectionModule({}, local).DB_INFO)), local);
  assert.deepEqual(JSON.parse(JSON.stringify(connectionModule({}, {}).DB_INFO)), { host: '', port: 3306, user: '', password: '', database: 'xuexi' });
  assert.equal(connectionModule({ MYSQL_PASSWORD: '' }, local).DB_INFO.password, 'synthetic');
});
test('normal config fallback remains compatible; read-only config errors fail closed', () => {
  const absent = Object.assign(new Error("Cannot find module './config.local'"), { code: 'MODULE_NOT_FOUND' });
  assert.equal(connectionModule({}, {}, absent).DB_INFO.database, 'xuexi');
  const broken = connectionModule({ MYSQL_DATABASE: 'env-db' }, {}, new Error('broken config: synthetic-secret'));
  assert.equal(broken.DB_INFO.database, 'env-db');
  assert.throws(() => broken.openReadOnly(), (e) => /config.local/.test(e.message) && !/synthetic-secret/.test(e.message));
  const nested = connectionModule({}, {}, Object.assign(new Error("Cannot find module 'other-dependency'"), { code: 'MODULE_NOT_FOUND' }));
  assert.equal(nested.DB_INFO.database, 'xuexi');
  assert.throws(() => nested.openReadOnly(), /config.local/);
});
test('read-only mode cannot be downgraded by second init', async () => {
  const w = worker(); await w.send({ type: 'init', config });
  assert.equal((await w.send({ type: 'init', config: { database: 'fixture' } })).ok, false);
  assert.equal((await w.send({ type: 'query', sql: 'UPDATE x SET n=1' })).ok, false);
  assert.ok(!w.calls.some(s => /^(CREATE|ALTER|UPDATE)/i.test(s)));
});
test('failed read-only setup remains closed for later query and heartbeat', async () => {
  const w = worker({ failReadOnly: true });
  await w.send({ type: 'init', config });
  assert.equal((await w.send({ type: 'query', sql: 'SELECT 42' })).ok, false);
  await w.heartbeat();
  assert.ok(!w.calls.includes('SELECT 42'));
  assert.ok(!w.calls.some(s => /^(CREATE|ALTER|UPDATE)/i.test(s)));
});

test('missing import file fails before any database module is loaded', () => {
  const r = cli('scripts/import-trees.js', '--dry-run', false, true);
  assert.equal(r.code, 2);
  assert.ok(!r.loaded.includes('../src/db'));
  assert.ok(!r.loaded.includes('../src/db-connection'));
});
test('heartbeat reconnect retains read-only setup and never initializes schema', async () => {
  const w = worker(); await w.send({ type: 'init', config });
  w.fatal(); await w.heartbeat();
  assert.equal(w.options.length, 2);
  assert.equal(w.calls.filter(s => s === 'SET SESSION TRANSACTION READ ONLY').length, 2);
  assert.ok(!w.calls.some(s => /^(CREATE|ALTER|UPDATE)/i.test(s)));
});
