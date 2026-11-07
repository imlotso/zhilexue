'use strict';
// Execute the full production auth module. Only JWT decoding and bcrypt are
// controlled boundaries; account reads use a fresh synthetic SQLite database.
// No app boot, credentials, filesystem persistence, network, or real database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const source = fs.readFileSync(path.join(__dirname, 'src/auth.js'), 'utf8');

function fixture(t) {
  const raw = openMemory(); t.after(() => raw.close());
  raw.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, status INTEGER, expire_at TEXT, username TEXT, name TEXT);
    INSERT INTO users VALUES (1,'admin',1,'','principal','校长'),(10,'branch',1,'2026-11-08','campus-a','分校A'),
      (101,'student',1,'2026-11-08','student-a','学生A');`);
  const db = { prepare: sql => raw.prepare(sql) };
  let claims = null, decodeError = false;
  const module = { exports: {} };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [2026, 10, 7, 12, 0, 0])); } }
  const box = { module, exports: module.exports, Buffer, Date: FixedDate,
    process: { env: { JWT_SECRET: 'synthetic-offline-test-only-not-a-production-secret' } },
    require(name) {
      if (name === './db') return { db, DATA_DIR: '/nonexistent-offline-test' };
      if (name === 'jsonwebtoken') return { verify() { if (decodeError) throw new Error('bad signature'); return { ...claims }; } };
      if (name === 'bcryptjs') return {};
      if (['crypto', 'fs', 'path'].includes(name)) return require(name);
      throw new Error('Unapproved dependency: ' + name);
    } };
  vm.runInNewContext(source, box, { filename: 'src/auth.js' });
  return { raw, invoke(payload, { required = true, role = null, token = 'synthetic-token', invalid = false } = {}) {
    claims = payload; decodeError = invalid;
    const req = { headers: token ? { authorization: 'Bearer ' + token } : {}, query: {} };
    const res = { status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    let next = 0;
    module.exports.auth(required, role)(req, res, () => next++);
    return { req, res, next };
  } };
}
const token = (id, role) => ({ id, role, username: 'old-name', name: 'old-display' });
for (const [id, role] of [[1, 'admin'], [10, 'branch'], [101, 'student']]) {
  test('active ' + role + ' keeps access and refreshes profile from the account row', t => {
    const f = fixture(t), r = f.invoke(token(id, role));
    assert.equal(r.next, 1); assert.equal(r.res.body, undefined);
    assert.equal(r.req.user.username, f.raw.prepare('SELECT username FROM users WHERE id=?').get(id).username);
  });
  test('stopped ' + role + ' cannot use a retained signed session', t => {
    const f = fixture(t); f.raw.prepare('UPDATE users SET status=0 WHERE id=?').run(id);
    const r = f.invoke(token(id, role)); assert.equal(r.next, 0); assert.equal(r.res.statusCode, 403); assert.equal(r.req.user, undefined);
  });
  test('deleted ' + role + ' cannot use a retained signed session', t => {
    const f = fixture(t); f.raw.prepare('DELETE FROM users WHERE id=?').run(id);
    const r = f.invoke(token(id, role)); assert.equal(r.next, 0); assert.equal(r.res.statusCode, 401);
  });
}
for (const [id, role] of [[10, 'branch'], [101, 'student']]) {
  test('expired ' + role + ' cannot bypass account expiry with an unexpired JWT', t => {
    const f = fixture(t); f.raw.prepare('UPDATE users SET expire_at=? WHERE id=?').run('2026-11-06', id);
    const r = f.invoke(token(id, role)); assert.equal(r.next, 0); assert.equal(r.res.statusCode, 403);
  });
  test(role + ' expiry day remains valid, and blank expiry remains unlimited', t => {
    const f = fixture(t);
    for (const date of ['2026-11-07', '']) { f.raw.prepare('UPDATE users SET expire_at=? WHERE id=?').run(date, id); assert.equal(f.invoke(token(id, role)).next, 1); }
  });
}
test('current role must match the signed role before admin/student routers run', t => {
  const f = fixture(t); f.raw.exec("UPDATE users SET role='student' WHERE id=10");
  const r = f.invoke(token(10, 'branch')); assert.equal(r.next, 0); assert.equal(r.res.statusCode, 401);
});
test('student middleware still rejects an active nonstudent account', t => {
  const f = fixture(t); const r = f.invoke(token(10, 'branch'), { role: 'student' }); assert.equal(r.next, 0); assert.equal(r.res.statusCode, 403);
});
test('missing or invalid token remains unauthorized, optional auth stays anonymous', t => {
  const f = fixture(t);
  for (const opts of [{ token: '' }, { invalid: true }]) {
    assert.equal(f.invoke(token(101, 'student'), opts).res.statusCode, 401);
    const r = f.invoke(token(101, 'student'), { ...opts, required: false }); assert.equal(r.next, 1); assert.equal(r.req.user, undefined);
  }
});
test('account state is checked per request rather than cached for the JWT lifetime', t => {
  const f = fixture(t); assert.equal(f.invoke(token(101, 'student')).next, 1);
  f.raw.exec('UPDATE users SET status=0 WHERE id=101'); assert.equal(f.invoke(token(101, 'student')).next, 0);
  f.raw.exec('UPDATE users SET status=1 WHERE id=101'); assert.equal(f.invoke(token(101, 'student')).next, 1);
});
