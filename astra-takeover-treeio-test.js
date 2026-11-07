'use strict';
// Pure Node + in-memory SQLite. Never load src/db, start a server, or read account configuration.
const assert = require('node:assert/strict');
const { test } = require('node:test');
let MemoryDatabase, adapter;
try {
  MemoryDatabase = require('better-sqlite3');
  const probe = new MemoryDatabase(':memory:'); probe.close();
  adapter = 'better-sqlite3 :memory:';
} catch (err) {
  if (!/Cannot find module|Could not locate the bindings file|NODE_MODULE_VERSION/.test(err.message)) throw err;
  // Node 20 CI uses installed better-sqlite3; Node 24 can fall back when this export lacks its binary.
  MemoryDatabase = require('node:sqlite').DatabaseSync;
  adapter = 'node:sqlite :memory: (better-sqlite3 binary unavailable)';
}
console.log('Tree import test adapter: ' + adapter);
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const io = require('./src/treeio');

function memoryDb(t, subjectCollation = 'BINARY') {
  const sqlite = new MemoryDatabase(':memory:');
  sqlite.exec(`CREATE TABLE bank_trees (id INTEGER PRIMARY KEY, kind TEXT, subject TEXT COLLATE ${subjectCollation}, stage TEXT, edition TEXT,
    name TEXT, source TEXT, sort INTEGER, created_at TEXT);
    CREATE TABLE bank_tree_nodes (id INTEGER PRIMARY KEY, tree_id INTEGER, parent_id INTEGER, name TEXT,
    sort INTEGER, code TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE question_nodes (question_id INTEGER, node_id INTEGER);`);
  const calls = [], writes = [];
  const db = {
    sqlite, calls, writes, readOnly: false, transactions: 0,
    prepare(sql) {
      calls.push(sql);
      if (db.readOnly && !/^SELECT\s/i.test(sql)) throw new Error('Dry-run attempted a non-SELECT: ' + sql);
      const stmt = sqlite.prepare(sql);
      return {
        get: (...args) => stmt.get(...args), all: (...args) => stmt.all(...args),
        run(...args) { writes.push({ sql, args }); return stmt.run(...args); },
      };
    },
    transaction(fn) { return () => {
      db.transactions++;
      sqlite.exec('BEGIN');
      try { const out = fn(); sqlite.exec('COMMIT'); return out; }
      catch (err) { sqlite.exec('ROLLBACK'); throw err; }
    }; },
  };
  t.after(() => sqlite.close());
  return db;
}
const doc = (nodes, extra = {}) => ({ format: 'zhilexue-tree', version: 1, kind: 'textbook',
  subject: '合成验收学科', stage: 'junior', edition: '合成甲版', name: '合成目录', nodes, ...extra });
const summary = (rows) => rows.map(({ added, existing, total, created_tree }) => ({ added, existing, total, created_tree }));
const snapshot = (db) => JSON.stringify({
  trees: db.sqlite.prepare('SELECT * FROM bank_trees ORDER BY id').all(),
  nodes: db.sqlite.prepare('SELECT * FROM bank_tree_nodes ORDER BY id').all(),
  links: db.sqlite.prepare('SELECT * FROM question_nodes ORDER BY question_id,node_id').all(),
});
const counts = (db) => [db.sqlite.prepare('SELECT COUNT(*) n FROM bank_trees').get().n,
  db.sqlite.prepare('SELECT COUNT(*) n FROM bank_tree_nodes').get().n];
function runCli(db, files, dry = true) {
  // Execute the real CLI; only its external filesystem and database connection are substituted.
  const logs = []; let exitCode;
  const root = '/synthetic-trees';
  const vfs = {
    existsSync: (p) => p === root || Object.hasOwn(files, path.basename(p)),
    statSync: (p) => ({ isDirectory: () => p === root }),
    readdirSync: () => Object.keys(files),
    readFileSync: (p) => typeof files[path.basename(p)] === 'string' ? files[path.basename(p)] : JSON.stringify(files[path.basename(p)]),
  };
  const exit = Symbol('cli exit');
  const context = { console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    process: { argv: ['node', 'scripts/import-trees.js', root, ...(dry ? ['--dry-run'] : [])],
      cwd: () => root, exit(code) { exitCode = code; throw exit; } },
    require(name) {
      if (name === 'fs') return vfs;
      if (name === 'path') return path;
      if (name === '../src/db') return { db, DB_INFO: { database: 'memory-only', host: 'none', port: 0 } };
      if (name === '../src/treeio') return io;
      throw new Error('Unexpected CLI dependency: ' + name);
    },
  };
  try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'scripts/import-trees.js'), 'utf8'), context, { filename: 'scripts/import-trees.js' }); }
  catch (err) { if (err !== exit) throw err; }
  return { exitCode, text: logs.join('\n') };
}

test('121-character node names fail before writes instead of merging identical 120-character prefixes', (t) => {
  const db = memoryDb(t), prefix = '甲'.repeat(120);
  assert.equal(io.normalizeInput(doc([prefix]))[0].nodes[0].name, prefix);
  assert.throws(() => io.importAll(db, [doc(['合成有效节点']), doc([{ name: '合成父', children: [prefix + '一', prefix + '二'] }])]),
    (err) => /120/.test(err.message) && /第 2 棵树/.test(err.message) && /children\[0\]/.test(err.message));
  assert.equal(db.writes.length, 0);
  assert.deepEqual(counts(db), [0, 0]);
});

test('oversized external codes cannot truncate away a metadata conflict', (t) => {
  const db = memoryDb(t), prefix = 'C'.repeat(100);
  assert.equal(io.normalizeInput(doc([{ name: '合成叶', code: prefix }]))[0].nodes[0].code, prefix);
  assert.throws(() => io.importAll(db, doc([{ name: '合成叶', code: prefix + 'A' }, { name: '合成叶', code: prefix + 'B' }])),
    (err) => /code/.test(err.message) && /100/.test(err.message));
  assert.equal(db.writes.length, 0);
});

test('same-tree overlapping documents share dry state, match real import, and stay idempotent', (t) => {
  const db = memoryDb(t), input = [doc([{ name: '合成父', children: ['合成甲'] }]), doc([{ name: '合成父', children: ['合成甲', '合成乙'] }])];
  db.readOnly = true;
  const before = snapshot(db), dry = io.importAll(db, input, { dry: true });
  assert.deepEqual(summary(dry), [{ added: 2, existing: 0, total: 2, created_tree: true }, { added: 1, existing: 2, total: 3, created_tree: false }]);
  assert.equal(snapshot(db), before);
  assert.ok(db.calls.every((sql) => /^SELECT\s/i.test(sql)));
  assert.deepEqual(dry.map((r) => r.tree_id), [null, null]);
  db.readOnly = false;
  assert.deepEqual(summary(io.importAll(db, input)), summary(dry));
  assert.deepEqual(counts(db), [1, 3]);
  assert.deepEqual(io.importAll(db, input).map((r) => r.added), [0, 0]);
});

for (const field of ['code', 'note']) {
  test(`conflicting nonempty ${field} within a document is rejected before any writes`, (t) => {
    const db = memoryDb(t);
    assert.throws(() => io.importAll(db, doc([{ name: '合成父', children: [{ name: '合成叶', [field]: '甲' }, { name: '合成叶', [field]: '乙' }] }])),
      (err) => err.message.includes(field) && err.message.includes('合成父') && err.message.includes('合成叶'));
    assert.equal(db.writes.length, 0);
  });
  test(`conflicting nonempty ${field} across same-tree documents rejects the entire API input before writes`, (t) => {
    const db = memoryDb(t);
    assert.throws(() => io.importAll(db, [doc([{ name: '合成叶', [field]: '甲' }]), doc([{ name: '合成叶', [field]: '乙' }])]), /冲突/);
    assert.equal(db.writes.length, 0);
    assert.deepEqual(counts(db), [0, 0]);
  });
  test(`conflicting nonempty ${field} against an existing node rejects earlier unrelated additions without writes`, (t) => {
    const db = memoryDb(t);
    io.importAll(db, doc([{ name: '合成叶', [field]: '原值' }]));
    const before = snapshot(db); db.writes.length = 0;
    assert.throws(() => io.importAll(db, [doc(['另一棵新节点'], { edition: '合成乙版' }), doc([{ name: '合成叶', [field]: '新值' }])]), /冲突/);
    assert.equal(db.writes.length, 0);
    assert.equal(snapshot(db), before);
  });
}

test('empty metadata fills, equal metadata merges, and node IDs/order/question links survive', (t) => {
  const db = memoryDb(t);
  const first = io.importAll(db, doc([{ name: '合成父', children: ['合成叶', '合成旧末项'] }]))[0];
  const leaf = db.sqlite.prepare("SELECT id,sort FROM bank_tree_nodes WHERE name='合成叶'").get();
  db.sqlite.prepare('INSERT INTO question_nodes VALUES (?,?)').run(7, leaf.id);
  const input = [doc([{ name: '合成父', children: [{ name: '合成叶', code: 'A' }] }]),
    doc([{ name: '合成父', children: [{ name: '合成叶', code: 'A', note: '合成备注' }, '合成新末项'] }])];
  const before = snapshot(db); db.readOnly = true;
  const preview = io.importAll(db, input, { dry: true }); assert.equal(snapshot(db), before);
  db.readOnly = false;
  assert.deepEqual(summary(io.importAll(db, input)), summary(preview));
  const saved = db.sqlite.prepare("SELECT id,sort,code,note FROM bank_tree_nodes WHERE name='合成叶'").get();
  assert.deepEqual({ ...saved }, { ...leaf, code: 'A', note: '合成备注' });
  assert.equal(db.sqlite.prepare('SELECT node_id FROM question_nodes WHERE question_id=7').get().node_id, leaf.id);
  assert.deepEqual(io.exportTree(db, first.tree_id).nodes[0].children.map((n) => n.name), ['合成叶', '合成旧末项', '合成新末项']);
  assert.equal(io.importAll(db, io.exportTree(db, first.tree_id))[0].added, 0);
});

test('metadata filled earlier in the batch participates in later conflict detection', (t) => {
  const db = memoryDb(t); io.importAll(db, doc(['合成叶'])); db.writes.length = 0;
  assert.throws(() => io.importAll(db, [doc([{ name: '合成叶', note: '甲' }]), doc([{ name: '合成叶', note: '乙' }])]), /冲突/);
  assert.equal(db.writes.length, 0);
});

test('same names under different parents and editions remain separate', (t) => {
  const db = memoryDb(t), input = [doc([{ name: '父甲', children: [{ name: '同名叶', code: 'A' }] }, { name: '父乙', children: [{ name: '同名叶', code: 'B' }] }]),
    doc([{ name: '父甲', children: [{ name: '同名叶', code: 'C' }] }], { edition: '合成乙版' })];
  const preview = io.importAll(db, input, { dry: true });
  assert.deepEqual(preview.map((r) => r.added), [4, 2]);
  assert.deepEqual(summary(io.importAll(db, input)), summary(preview));
  assert.deepEqual(counts(db), [2, 6]);
});

test('direct normalized importDoc also rejects a late conflict before writes and preserves explicit tree target', (t) => {
  const db = memoryDb(t), tree = io.importAll(db, doc([{ name: '合成旧叶', code: 'A' }]))[0];
  const input = io.normalizeInput(doc(['合成新叶', { name: '合成旧叶', code: 'B' }]))[0];
  db.writes.length = 0;
  assert.throws(() => io.importDoc(db, input, { treeId: tree.tree_id }), /冲突/);
  assert.equal(db.writes.length, 0);
  assert.throws(() => io.importDoc(db, input, { treeId: tree.tree_id + 100 }), /不一致/);
});

test('API retains transaction rollback when a later SQL write fails', (t) => {
  const db = memoryDb(t);
  db.sqlite.exec("CREATE TRIGGER fail_leaf BEFORE INSERT ON bank_tree_nodes WHEN NEW.name='合成写入失败' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;");
  assert.throws(() => io.importAll(db, [doc(['合成第一项']), doc(['合成写入失败'], { edition: '合成乙版' })]), /synthetic write failure/);
  assert.equal(db.transactions, 1);
  assert.deepEqual(counts(db), [0, 0]);
});

test('preview context shares valid files, rolls back rejected-file state, and is scoped to its database', (t) => {
  const db = memoryDb(t), context = {};
  assert.equal(io.importAll(db, doc([{ name: '合成原项', note: 'A' }]), { dry: true, previewContext: context })[0].added, 1);
  assert.throws(() => io.importAll(db, [doc(['合成失败文件新增']), doc([{ name: '合成原项', note: 'B' }])], { dry: true, previewContext: context }), /冲突/);
  const last = io.importAll(db, doc(['合成原项', '合成失败文件新增']), { dry: true, previewContext: context })[0];
  assert.deepEqual(summary([last]), [{ added: 1, existing: 1, total: 2, created_tree: false }]);
  assert.equal(db.writes.length, 0);
  const other = memoryDb(t);
  assert.throws(() => io.importAll(other, doc(['合成原项']), { dry: true, previewContext: context }), /预检|数据库/);
  assert.equal(io.importAll(other, doc(['合成原项']), { dry: true })[0].added, 1);
});

test('CLI same-tree files predict unique additions and continue past malformed/conflicting files', (t) => {
  const files = {
    '01-first.json': doc([{ name: '合成父', children: [{ name: '合成甲', code: 'A' }] }]),
    '02-conflict.json': [doc(['失败文件独有项']), doc([{ name: '合成父', children: [{ name: '合成甲', code: 'B' }] }])],
    '03-malformed.json': '{',
    '04-last.json': doc([{ name: '合成父', children: [{ name: '合成甲', code: 'A' }, '合成乙'] }, '失败文件独有项']),
  };
  const previewDb = memoryDb(t); previewDb.readOnly = true;
  const preview = runCli(previewDb, files);
  assert.equal(preview.exitCode, 1);
  assert.match(preview.text, /02-conflict\.json/); assert.match(preview.text, /冲突/);
  assert.match(preview.text, /03-malformed\.json/);
  assert.match(preview.text, /2 个文件成功，2 个文件有问题，共新增 4 个节点/);
  assert.equal((preview.text.match(/\[新建树\]/g) || []).length, 1);
  assert.equal(previewDb.writes.length, 0);
  const writeDb = memoryDb(t), actual = runCli(writeDb, files, false);
  assert.equal(actual.exitCode, 1);
  assert.match(actual.text, /2 个文件成功，2 个文件有问题，共新增 4 个节点/);
  assert.deepEqual(counts(writeDb), [1, 4]);
  const repeated = runCli(writeDb, files, false);
  assert.match(repeated.text, /共新增 0 个节点/);
});

for (const existing of [false, true]) {
  test(`case-insensitive target aliases share dry state (${existing ? 'existing' : 'new'} tree)`, (t) => {
    const db = memoryDb(t, 'NOCASE');
    if (existing) io.importAll(db, doc(['existing leaf'], { subject: 'Math' }));
    const input = [doc([{ name: 'alias leaf', code: 'A' }], { subject: 'Math' }),
      doc([{ name: 'alias leaf', code: 'A' }], { subject: 'math' })];
    db.writes.length = 0; db.readOnly = true;
    const dry = io.importAll(db, input, { dry: true });
    assert.deepEqual(dry.map((r) => r.added), [1, 0]);
    assert.equal(db.writes.length, 0); db.readOnly = false;
    assert.deepEqual(summary(io.importAll(db, input)), summary(dry));
    assert.equal(counts(db)[0], 1);
  });
  test(`case-insensitive target aliases reject conflicting metadata before writes (${existing ? 'existing' : 'new'} tree)`, (t) => {
    const db = memoryDb(t, 'NOCASE');
    if (existing) io.importAll(db, doc(['existing leaf'], { subject: 'Math' }));
    const input = [doc([{ name: 'alias leaf', code: 'A' }], { subject: 'Math' }),
      doc([{ name: 'alias leaf', code: 'B' }], { subject: 'math' })];
    const before = snapshot(db); db.writes.length = 0; db.readOnly = true;
    assert.throws(() => io.importAll(db, input, { dry: true }), /冲突/);
    db.readOnly = false; assert.throws(() => io.importAll(db, input), /冲突/);
    assert.equal(db.writes.length, 0); assert.equal(snapshot(db), before);
  });
}

test('binary target comparison keeps distinct case-sensitive trees separate', (t) => {
  const db = memoryDb(t);
  const input = [doc([{ name: 'same leaf', code: 'A' }], { subject: 'Math' }),
    doc([{ name: 'same leaf', code: 'B' }], { subject: 'math' })];
  const dry = io.importAll(db, input, { dry: true });
  assert.deepEqual(dry.map((r) => r.added), [1, 1]);
  assert.deepEqual(summary(io.importAll(db, input)), summary(dry));
  assert.deepEqual(counts(db), [2, 2]);
});

test('CLI previews preserve alias state across file snapshots and discard failed-file additions', (t) => {
  const files = {
    '01-first.json': doc([{ name: 'alias leaf', code: 'A' }], { subject: 'Math' }),
    '02-conflict.json': doc(['failed addition', { name: 'alias leaf', code: 'B' }], { subject: 'math' }),
    '03-last.json': doc([{ name: 'alias leaf', code: 'A' }, 'failed addition'], { subject: 'math' }),
  };
  const db = memoryDb(t, 'NOCASE'); db.readOnly = true;
  const preview = runCli(db, files);
  assert.equal(preview.exitCode, 1); assert.match(preview.text, /2 个文件成功，1 个文件有问题，共新增 2 个节点/);
  assert.equal((preview.text.match(/\[新建树\]/g) || []).length, 1);
  assert.equal(db.writes.length, 0); db.readOnly = false;
  const actual = runCli(db, files, false);
  assert.equal(actual.exitCode, 1); assert.match(actual.text, /共新增 2 个节点/);
  assert.deepEqual(counts(db), [1, 2]);
});

// Run the real collection core without loading its routers, live DB, credentials or network clients.
function collectionCore(db) {
  db.sqlite.exec(`CREATE TABLE mf_dict_entries (kind TEXT, site TEXT, code TEXT, label TEXT, active INTEGER);
    CREATE TABLE mf_tree_source_map (node_id INTEGER PRIMARY KEY, site TEXT, site_node_id TEXT, site_node_name TEXT);`);
  const source = fs.readFileSync(path.join(__dirname, 'src/mfcollect.js'), 'utf8');
  const start = source.indexOf('function normStage(raw) {');
  const end = source.indexOf('// admin /collect-tree', start);
  assert.ok(start >= 0 && end > start, 'Collection core must be available for isolated execution');
  return vm.runInNewContext(source.slice(start, end) + '\nimportTreeCore;', {
    db, require(name) { if (name === './treeio') return io; throw new Error('Unexpected collection dependency: ' + name); },
  }, { filename: 'src/mfcollect.js' });
}
const capture = (nodes, extra = {}) => ({ site: 'synthetic', root_id: 'first', root_name: '合成采集树',
  kind: 'knowledge', stage: 'senior', subject: '生物', edition_selected: true, nodes, ...extra });
const sourceRows = (db) => JSON.stringify(db.sqlite.prepare('SELECT * FROM mf_tree_source_map ORDER BY node_id').all());

test('B7 collection merges changed source IDs by path without changing existing metadata or question links', (t) => {
  const db = memoryDb(t), collect = collectionCore(db);
  const first = collect(capture([
    { site_node_id: 'a1', name: '合成根', parent_site_node_id: null, sort: 0 },
    { site_node_id: 'a2', name: '合成节', parent_site_node_id: 'a1', sort: 0 },
    { site_node_id: 'a3', name: '合成点', parent_site_node_id: 'a2', sort: 0 },
  ]));
  assert.equal(first.code, 0, first.msg); assert.equal(first.created, 3);
  const original = db.sqlite.prepare('SELECT id,parent_id,name,sort,code FROM bank_tree_nodes ORDER BY id').all();
  db.sqlite.prepare('INSERT INTO question_nodes VALUES (?,?)').run(81, original[2].id);
  const second = capture([
    { site_node_id: 'b1', name: '合成根', parent_site_node_id: null, sort: 0 },
    { site_node_id: 'b2', name: '合成节', parent_site_node_id: 'b1', sort: 0 },
    { site_node_id: 'b3', name: '合成点', parent_site_node_id: 'b2', sort: 0 },
    { site_node_id: 'b4', name: '合成新点', parent_site_node_id: 'b2', sort: 1 },
  ], { root_id: 'second' });
  const before = snapshot(db), maps = sourceRows(db); db.writes.length = 0; db.readOnly = true;
  const preview = collect({ ...second, dry: true });
  assert.equal(preview.code, 0, preview.msg);
  assert.equal(preview.created, 1); assert.equal(preview.merged, 3); assert.equal(preview.tree_id, first.tree_id);
  assert.equal(db.writes.length, 0); assert.equal(snapshot(db), before); assert.equal(sourceRows(db), maps);
  db.readOnly = false;
  const actual = collect(second);
  assert.equal(actual.code, 0, actual.msg); assert.equal(actual.created, 1); assert.equal(actual.merged, 3);
  assert.equal(actual.tree_id, first.tree_id); assert.deepEqual(counts(db), [1, 4]);
  assert.deepEqual(db.sqlite.prepare('SELECT id,parent_id,name,sort,code FROM bank_tree_nodes WHERE id<=? ORDER BY id').all(original[2].id), original);
  const added = db.sqlite.prepare("SELECT parent_id,sort,code FROM bank_tree_nodes WHERE name='合成新点'").get();
  assert.deepEqual({ ...added }, { parent_id: original[1].id, sort: 1, code: 'b4' });
  assert.equal(db.sqlite.prepare('SELECT node_id FROM question_nodes WHERE question_id=81').get().node_id, original[2].id);
  assert.deepEqual(db.sqlite.prepare('SELECT site_node_id FROM mf_tree_source_map ORDER BY node_id').all().map(r => r.site_node_id), ['a1', 'a2', 'a3', 'b4']);
  const repeated = collect(second);
  assert.equal(repeated.code, 0, repeated.msg); assert.equal(repeated.created, 0); assert.equal(repeated.merged, 4);
  assert.deepEqual(counts(db), [1, 4]);
});

test('collection aliases within one batch merge their children while retaining the first source code', (t) => {
  const db = memoryDb(t), collect = collectionCore(db);
  const input = capture([
    { site_node_id: 'root-a', name: '合成根', parent_site_node_id: null },
    { site_node_id: 'root-b', name: '合成根', parent_site_node_id: null },
    { site_node_id: 'leaf-a', name: '甲', parent_site_node_id: 'root-a' },
    { site_node_id: 'leaf-b', name: '乙', parent_site_node_id: 'root-b' },
  ]);
  const preview = collect({ ...input, dry: true });
  assert.equal(preview.code, 0, preview.msg); assert.equal(preview.created, 3); assert.equal(preview.merged, 1);
  const actual = collect(input);
  assert.equal(actual.code, 0, actual.msg); assert.equal(actual.created, 3); assert.equal(actual.merged, 1);
  const exported = io.exportTree(db, actual.tree_id);
  assert.equal(exported.nodes.length, 1); assert.equal(exported.nodes[0].code, 'root-a');
  assert.deepEqual(exported.nodes[0].children.map(n => n.name), ['甲', '乙']);
});

test('a collection-looking source label cannot bypass ordinary JSON code conflict protection', (t) => {
  const db = memoryDb(t), source = 'collect:synthetic:root';
  io.importAll(db, doc([{ name: '合成节点', code: 'first' }], { source }));
  const before = snapshot(db); db.writes.length = 0;
  const conflicting = doc([{ name: '合成节点', code: 'other' }], { source });
  assert.throws(() => io.importAll(db, conflicting, { dry: true }), /code.*冲突/);
  assert.throws(() => io.importAll(db, conflicting), /code.*冲突/);
  assert.equal(db.writes.length, 0); assert.equal(snapshot(db), before);
});

test('collection code aliases never waive conflicting notes', (t) => {
  const db = memoryDb(t);
  const first = io.importAll(db, doc([{ name: '合成节点', code: 'first', note: '原备注' }]))[0];
  const conflicting = io.normalizeInput(doc([{ name: '合成节点', code: 'alias', note: '不同备注' }]))[0];
  const before = snapshot(db); db.writes.length = 0;
  for (const dry of [true, false]) {
    assert.throws(() => io.importDoc(db, conflicting, { dry, treeId: first.tree_id, preserveSourceCode: true }), /note.*冲突/);
  }
  assert.equal(db.writes.length, 0); assert.equal(snapshot(db), before);
});

test('collection alias merge rolls back new nodes and source mappings when a later write fails', (t) => {
  const db = memoryDb(t), collect = collectionCore(db);
  const first = collect(capture([{ site_node_id: 'first', name: '合成根' }]));
  assert.equal(first.code, 0, first.msg);
  const before = snapshot(db), maps = sourceRows(db);
  db.sqlite.exec("CREATE TRIGGER fail_capture BEFORE INSERT ON mf_tree_source_map WHEN NEW.site_node_id='fail-map' BEGIN SELECT RAISE(ABORT, 'synthetic mapping failure'); END;");
  const result = collect(capture([
    { site_node_id: 'alias', name: '合成根' },
    { site_node_id: 'new-map', name: '先新增', parent_site_node_id: 'alias' },
    { site_node_id: 'fail-map', name: '后失败', parent_site_node_id: 'alias' },
  ]));
  assert.equal(result.code, 1); assert.match(result.msg, /synthetic mapping failure/);
  assert.equal(snapshot(db), before); assert.equal(sourceRows(db), maps);
});
