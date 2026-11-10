'use strict';
// Synthetic accounts exist only for the duration of explicitly isolated integration tests.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
function assertIsolated() {
  const { DB_INFO } = require('../src/db-connection');
  if (process.env.ZLX_ISOLATED_TEST !== '1' || process.env.STORAGE_DRIVER !== 'local' || !['127.0.0.1', 'localhost', '::1'].includes(DB_INFO.host) || (process.env.CI !== 'true' && !/(^|_)test(_|$)/i.test(DB_INFO.database))) {
    throw new Error('Integration tests require ZLX_ISOLATED_TEST=1, local storage and a separate local test database.');
  }
}
function create(db) {
  assertIsolated();
  const made = [];
  const insert = db.prepare('INSERT INTO users (role,username,password,name,grade,stage,status,expire_at,created_at) VALUES (?,?,?,?,?,?,1,?,?)');
  const make = (role) => {
    const password = crypto.randomBytes(24).toString('base64url');
    for (let attempt = 0; attempt < 8; attempt++) {
      const username = '199' + String(crypto.randomInt(0, 100000000)).padStart(8, '0');
      try {
        const row = insert.run(role, username, bcrypt.hashSync(password, 8), '合成测试', '七年级', 'junior', '2099-12-31', '2026-01-01 00:00:00');
        const result = { id: Number(row.lastInsertRowid), username, password }; made.push(result.id); return result;
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY' && e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e; }
    }
    throw new Error('Could not allocate a synthetic account.');
  };
  const dispose = () => { for (const id of made.reverse()) { try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch (_) {} } made.length = 0; };
  try { return { admin: make('admin'), student: make('student'), dispose }; }
  catch (e) { dispose(); throw e; }
}
module.exports = { assertIsolated, create };
