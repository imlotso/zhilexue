'use strict';
/**
 * 首次切到 MySQL 时，把原来的 data/xuexi.db 导入进去。
 * 只在 MySQL 的 users 表还是空的时候跑一次，避免重复导入。
 */
const path = require('path');
const fs = require('fs');

function safeName(name) {
  return /^[A-Za-z0-9_]+$/.test(name);
}

function importIfEmpty(db, dataDir) {
  const sqlitePath = path.join(dataDir, 'xuexi.db');
  if (!fs.existsSync(sqlitePath)) return;
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n && Number(n.n) > 0) return;

  let Database;
  try { Database = require('better-sqlite3'); }
  catch (e) {
    console.log('· 未导入旧数据：缺少 better-sqlite3，MySQL 将以空库启动');
    return;
  }

  console.log('· 正在把 SQLite 数据导入 MySQL …');
  const sdb = new Database(sqlitePath);
  try { sdb.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* 没有 WAL 就跳过 */ }

  const tables = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  db.exec('SET FOREIGN_KEY_CHECKS=0');
  const tx = db.transaction(() => {
    for (const { name } of tables) {
      if (!safeName(name)) continue;
      const exists = db.prepare(
        'SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
      ).get(name);
      if (!exists) continue;
      const rows = sdb.prepare('SELECT * FROM ' + name).all();
      if (!rows.length) continue;
      const mysqlCols = db.prepare(
        'SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?'
      ).all(name).map((c) => c.name);
      const use = Object.keys(rows[0]).filter((c) => safeName(c) && mysqlCols.indexOf(c) >= 0);
      if (!use.length) continue;
      const sql = 'INSERT INTO `' + name + '` (' + use.map((c) => '`' + c + '`').join(',') + ') VALUES (' + use.map(() => '?').join(',') + ')';
      const params = rows.map((row) => use.map((c) => (row[c] === undefined ? null : row[c])));
      db.batch(sql, params);
      console.log('  ' + name + '  ' + rows.length + ' 行');
    }
  });
  try {
    tx();
  } catch (e) {
    db.exec('SET FOREIGN_KEY_CHECKS=1');
    sdb.close();
    throw e;
  }
  db.exec('SET FOREIGN_KEY_CHECKS=1');

  for (const { name } of tables) {
    if (!safeName(name)) continue;
    const col = db.prepare(
      "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%'"
    ).get(name);
    if (!col) continue;
    const max = db.prepare('SELECT MAX(id) AS m FROM `' + name + '`').get();
    if (max && max.m) db.exec('ALTER TABLE `' + name + '` AUTO_INCREMENT = ' + (Number(max.m) + 1));
  }
  sdb.close();
  console.log('· SQLite 数据已导入 MySQL');
}

module.exports = { importIfEmpty };
