'use strict';
// Node 20/24 with the locked SQLite dependency; no network/config. Real CLI/core modules, synthetic memory only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

if (process.argv[2] === '--fixture-worker') {
  const Module = require('node:module');
  const scenario = process.argv[3], script = process.argv[4], args = process.argv.slice(5);
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE bank_trees (id INTEGER PRIMARY KEY, kind TEXT, subject TEXT, stage TEXT, edition TEXT, name TEXT, source TEXT, sort INTEGER, created_at TEXT);
    CREATE TABLE bank_tree_nodes (id INTEGER PRIMARY KEY, tree_id INTEGER, parent_id INTEGER, name TEXT, sort INTEGER, code TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE question_nodes (question_id INTEGER, node_id INTEGER);
    CREATE TABLE kb_units (id INTEGER PRIMARY KEY, subject TEXT, stage TEXT, grade TEXT, name TEXT, sort INTEGER);
    CREATE TABLE kb_points (id INTEGER PRIMARY KEY, unit_id INTEGER, name TEXT, sort INTEGER);
    CREATE TABLE settings (k TEXT, v TEXT);
    INSERT INTO settings VALUES ('default_editions','{}');
    INSERT INTO bank_trees VALUES (10,'knowledge','合成甲','junior','','合成树','fixture',0,'synthetic');
    INSERT INTO bank_tree_nodes VALUES (20,10,NULL,'教材单元知识点',99,'','','synthetic'),(21,10,20,'七年级',0,'','','synthetic'),(22,10,21,'合成单元',0,'','','synthetic'),(23,10,22,'合成旧点',0,'','','synthetic');
    INSERT INTO question_nodes VALUES (9001,23);
    INSERT INTO kb_units VALUES (1,'合成甲','junior','七年级','合成单元',0),(2,'合成甲','junior','七年级','合成单元',1),(3,'合成乙','primary','','合成新单元',0);
    INSERT INTO kb_points VALUES (1,1,'合成旧点',0),(2,1,'合成新点',1),(3,2,'合成新点',0),(4,3,'合成新点',0);
  `);
  if (scenario === 'empty') sqlite.exec('DELETE FROM kb_points; DELETE FROM kb_units');
  if (scenario.startsWith('missing:')) {
    const table = scenario.slice(8);
    assert.ok(['bank_trees', 'bank_tree_nodes', 'kb_units', 'kb_points'].includes(table));
    sqlite.exec('DROP TABLE ' + table);
  }
  const snapshot = () => JSON.stringify(sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => ({ ...t, rows: sqlite.prepare(`SELECT * FROM ${t.name} ORDER BY rowid`).all() })));
  const before = snapshot(), calls = [], loaded = [];
  let connections = 0;
  sqlite.exec('PRAGMA query_only=ON');
  const db = { prepare(sql) {
    calls.push(sql);
    assert.match(sql, /^SELECT\s/i, 'dry-run attempted non-SELECT SQL');
    return sqlite.prepare(sql);
  }, transaction() { throw new Error('dry-run attempted a transaction'); } };
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    loaded.push(name);
    if (name === '../src/db-connection') return { openReadOnly() {
      connections++;
      return { db, DB_INFO: { user: 'synthetic', host: 'none', port: 0, database: 'memory' } };
    } };
    const permitted = new Set(['fs', 'path', '../src/treeio', '../src/kbtree', './treepick', './school-scope', path.join(__dirname, script)]);
    assert.ok(permitted.has(name), 'Unexpected dependency blocked: ' + name);
    return originalLoad.call(this, name, parent, isMain);
  };
  const exit = Symbol('exit'); let status = 0;
  process.argv = [process.execPath, path.join(__dirname, script), ...args];
  process.exit = code => { status = code; throw exit; };
  try { require(path.join(__dirname, script)); }
  catch (error) { if (error !== exit) { status = 1; console.error(error.message); } }
  finally {
    Module._load = originalLoad;
    console.log('FIXTURE_AUDIT:' + JSON.stringify({ unchanged: before === snapshot(), calls, loaded, connections, queryOnly: sqlite.prepare('PRAGMA query_only').get().query_only }));
    sqlite.close(); process.exitCode = status;
  }
} else {
  const { test } = require('node:test');
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  function run(script, scenario = 'seed', args = ['--dry-run']) {
    const result = spawnSync(process.execPath, [__filename, '--fixture-worker', scenario, script, ...args], {
      cwd: __dirname, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_NO_WARNINGS: '1' },
    });
    assert.ifError(result.error); assert.equal(result.signal, null);
    const line = result.stdout.split('\n').find(s => s.startsWith('FIXTURE_AUDIT:'));
    assert.ok(line, result.stderr + result.stdout);
    const audit = JSON.parse(line.slice('FIXTURE_AUDIT:'.length));
    assert.equal(audit.unchanged, true); assert.equal(audit.queryOnly, 1);
    assert.ok(audit.calls.every(sql => /^SELECT\s/i.test(sql)));
    assert.ok(!audit.loaded.some(name => /config|mysql|^\.\.\/src\/db$/.test(name)));
    return { ...result, audit, text: result.stdout.replace(/^FIXTURE_AUDIT:.*$/m, '') };
  }
  const migrate = 'scripts/migrate-kb-to-trees.js';
  test('real migration CLI merges existing paths and virtual duplicates; repeated previews stay identical', () => {
    const first = run(migrate), second = run(migrate);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.text, /合计：3 个单元、4 个知识点，将新增 5 个节点/);
    assert.match(first.text, /合成甲 · 初中：2 个单元、3 个知识点 → 将新增 1 个节点/);
    assert.match(first.text, /合成乙 · 小学：1 个单元、1 个知识点 → 将新增 4 个节点/);
    assert.equal(second.text, first.text); assert.equal(second.status, 0);
    assert.equal(first.audit.connections, 1);
    assert.ok(first.audit.loaded.includes('./treepick'));
  });
  test('real migration CLI handles empty legacy tables without building any nodes', () => {
    const r = run(migrate, 'empty'); assert.equal(r.status, 0, r.stderr);
    assert.match(r.text, /旧表里没有数据/); assert.match(r.text, /将新增 0 个节点/);
  });
  for (const table of ['bank_trees', 'bank_tree_nodes', 'kb_units', 'kb_points']) {
    test(`real migration CLI fails closed for missing ${table} without schema initialization`, () => {
      const r = run(migrate, 'missing:' + table);
      assert.equal(r.status, 1); assert.match(r.stderr, new RegExp('no such table: ' + table));
      assert.doesNotMatch(r.text, /合计：/);
    });
  }
  const doc = nodes => ({ format: 'zhilexue-tree', version: 1, kind: 'textbook', subject: '合成输入', stage: 'junior', edition: '合成版', name: '合成目录', nodes });
  function directory(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-cli-offline-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
  }
  test('real import CLI traverses nested files, handles BOM/uppercase extension and overlaps across files', t => {
    const root = directory(t); fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, '01.JSON'), '\uFEFF' + JSON.stringify(doc([{ name: '父', children: ['甲'] }])));
    fs.writeFileSync(path.join(root, 'nested', '02.json'), JSON.stringify(doc([{ name: '父', children: ['甲', '乙'] }])));
    fs.writeFileSync(path.join(root, 'ignored.txt'), '{invalid');
    const r = run('scripts/import-trees.js', 'seed', [root, '-n']);
    assert.equal(r.status, 0, r.stderr); assert.match(r.text, /2 个文件成功，共新增 3 个节点/);
    assert.equal((r.text.match(/\[新建树\]/g) || []).length, 1);
    const repeated = run('scripts/import-trees.js', 'seed', [root, '--dry-run']);
    assert.equal(repeated.text, r.text); assert.equal(repeated.status, 0);
  });
  test('real invalid JSON and invalid tree shape fail before loading a connection', t => {
    const root = directory(t);
    fs.writeFileSync(path.join(root, '01.json'), '{invalid');
    fs.writeFileSync(path.join(root, '02.json'), JSON.stringify(doc(['长'.repeat(121)])));
    const r = run('scripts/import-trees.js', 'seed', [root, '--dry-run']);
    assert.equal(r.status, 1); assert.equal(r.audit.connections, 0); assert.deepEqual(r.audit.calls, []);
    assert.match(r.text, /0 个文件成功，2 个文件有问题，共新增 0 个节点/);
    assert.match(r.stderr, /120/);
  });
  test('real import CLI missing target table fails and does not initialize schema', t => {
    const root = directory(t); fs.writeFileSync(path.join(root, '01.json'), JSON.stringify(doc(['合成节点'])));
    const r = run('scripts/import-trees.js', 'missing:bank_trees', [root, '--dry-run']);
    assert.equal(r.status, 1); assert.match(r.stderr, /no such table: bank_trees/);
    assert.match(r.text, /0 个文件成功，1 个文件有问题，共新增 0 个节点/);
  });
}
