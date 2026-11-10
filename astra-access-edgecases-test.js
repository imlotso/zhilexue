'use strict';
const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm');

let open;
try {
  const D = require('better-sqlite3');
  const d = new D(':memory:');
  d.close();
  open = () => new D(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  open = () => new DatabaseSync(':memory:');
}

const branch = { id: 10, role: 'branch' },
  principal = { id: 1, role: 'admin' };

function fixture(t) {
  const db = open();
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER,role TEXT,created_by INTEGER); INSERT INTO users VALUES(101,'student',10),(201,'student',20); CREATE TABLE paper_uploads(id INTEGER,user_id INTEGER,status TEXT,question_id INTEGER); INSERT INTO paper_uploads VALUES(1,101,'pending',1),(2,201,'reviewed',2),(3,999,'pending',3),(4,201,'approved',4); CREATE TABLE questions(id INTEGER PRIMARY KEY,stem TEXT); INSERT INTO questions VALUES(1,'own'),(2,'foreign'),(3,'orphan'),(4,'approved'),(5,'shared'); CREATE TABLE mistakes(question_id INTEGER); CREATE TABLE question_tags(question_id INTEGER,tag TEXT); CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER); CREATE TABLE mf_paper_questions(question_id INTEGER,paper_id INTEGER,kind TEXT,position INTEGER,score REAL,created_at TEXT); CREATE TABLE papers(id INTEGER PRIMARY KEY,q_ids TEXT,title TEXT); CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,published INTEGER,status TEXT); CREATE TABLE mf_paper_tries(paper_id INTEGER); CREATE TABLE mf_recog_runs(drafts TEXT,status TEXT,source_kind TEXT); CREATE TABLE chapters(id INTEGER,name TEXT,subject TEXT,grade TEXT,stage TEXT,term TEXT,category TEXT); CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER); CREATE TABLE handouts(id INTEGER,video_id INTEGER,chapter_id INTEGER,section_id INTEGER); CREATE TABLE videos(id INTEGER,title TEXT,chapter_id INTEGER,section_id INTEGER); CREATE TABLE sections(id INTEGER,chapter_id INTEGER); CREATE TABLE bank_trees(id INTEGER,kind TEXT,edition TEXT); CREATE TABLE bank_tree_nodes(id INTEGER,tree_id INTEGER,name TEXT,parent_id INTEGER,sort INTEGER); ALTER TABLE questions ADD COLUMN chapter_id INTEGER; ALTER TABLE questions ADD COLUMN video_id INTEGER; ALTER TABLE questions ADD COLUMN section_id INTEGER; ALTER TABLE questions ADD COLUMN year TEXT; ALTER TABLE questions ADD COLUMN source TEXT; UPDATE questions SET year='Y'||id,source='S'||id; ALTER TABLE papers ADD COLUMN status TEXT; ALTER TABLE papers ADD COLUMN due_at TEXT; ALTER TABLE papers ADD COLUMN published_at TEXT; ALTER TABLE users ADD COLUMN status INTEGER DEFAULT 1; CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER,assigned_by INTEGER,created_at TEXT);`);
  const prepare = db.prepare.bind(db);
  db.prepare = sql => prepare(sql.replace(/ FOR UPDATE\b/g, ''));
  db.transaction = fn => (...a) => {
    db.exec('BEGIN');
    try {
      const result = fn(...a);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return db;
}

function handler(file, method, url, db, extras = {}) {
  const text = fs.readFileSync(__dirname + '/src/' + file, 'utf8');
  const a = text.indexOf(`admin.${method}('${url}',`),
    b = text.indexOf(file === 'paper-docx.js' ? '\n  });' : '\n});', a);
  assert.ok(a >= 0 && b > a);
  let fn;
  const context = {
    require: n => require(require('node:path').resolve(__dirname, 'src', n)),
    admin: { [method]: (url, f) => fn = f },
    db,
    int: (v, d = 0) => parseInt(v, 10) || d,
    qmeta: require('./src/qmeta'),
    accuracy: require('./src/accuracy'),
    csv: v => String(v || '').split(',').filter(Boolean),
    decorate: r => r,
    parseQ: r => r,
    SRC_KINDS: {},
    modes: { student: 1 },
    list: s => JSON.parse(s || '[]'),
    MatchQ: { list: () => [] },
    num: (v, d = 0) => Number(v) || d,
    now: () => '',
    parseIds: s => JSON.parse(s || '[]'),
    ok: (r, data) => r.body = { code: 0, data },
    fail: (r, msg, code = 1) => r.body = { code, msg },
    ...extras
  };
  vm.runInNewContext(text.slice(a, b + (file === 'paper-docx.js' ? 6 : 4)), context);
  return (id, user = branch, body = {}, query = {}) => {
    const res = {
      setHeader() {},
      end(buffer) {
        this.body = { code: 0, buffer };
      },
      status() {
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    const result = fn({ params: { id }, user, body, query }, res);
    return result && typeof result.then === 'function'
      ? result.then(() => res.body)
      : res.body;
  };
}

const qmeta = require('./src/qmeta');

for (const method of ['get', 'delete'])
  for (const id of ['14x', '2x', '1e1', '2e1', '0x2', 'NaN'])
    test(`mf question ${method} uses matching parse for ${id}`, t => {
      const db = fixture(t);
      db.exec("UPDATE users SET created_by=20 WHERE id=101; INSERT INTO questions(id,stem) VALUES(14,'foreign'); INSERT INTO paper_uploads VALUES(14,201,'pending',14)");
      assert.equal(handler('mfbank.js', method, '/questions/:id', db)(id).code, 403);
      assert.ok(db.prepare('SELECT * FROM questions WHERE id=2').get());
    });

for (const url of ['/papers/:id', '/papers/:id/preview', '/papers/:id/export'])
  for (const id of ['7x', '7e1', '0x7', 'NaN'])
    test(`mf paper ${url} uses matching parse for ${id}`, t => {
      const db = fixture(t);
      db.exec("INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(2,7,'question')");
      assert.equal(handler('mfbank.js', 'get', url, db)(id).code, 403);
    });

for (const user of [branch, principal, null])
  test('qmeta rejects malformed input before ' + (user?.role || 'public') + ' bypass', t => {
    const db = fixture(t);
    for (const ids of [[NaN], [0], [-1], [null], [''], [1, NaN], undefined])
      assert.equal(qmeta.questionsAllowed(db, user, ids), false);
    for (const id of [NaN, null, '', 0, '7x'])
      assert.equal(qmeta.paperQuestionsAllowed(db, user, id), false);
    assert.equal(qmeta.questionsAllowed(db, user, []), true);
  });

test('paper helpers allow null text row but reject invalid question row', t => {
  const db = fixture(t);
  db.exec("INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(NULL,7,'text')");
  assert.equal(qmeta.paperQuestionsAllowed(db, branch, 7), true);
  db.exec("INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(NULL,7,'question')");
  assert.equal(qmeta.paperQuestionsAllowed(db, branch, 7), false);
});

for (const user of [branch, principal])
  test(user.role + ' can withdraw historical pending published paper', t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,1,'done'); INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(1,7,'question')");
    assert.equal(handler('mfbank.js', 'put', '/papers/:id', db)(7, user, { published: 0 }).code, 0);
    assert.equal(db.prepare('SELECT published FROM mf_papers WHERE id=7').get().published, 0);
  });

for (const user of [branch, principal])
  test(user.role + ' still publishes approved and public mf questions', t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,0,'done'); INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(4,7,'question'),(5,7,'question')");
    assert.equal(handler('mfbank.js', 'put', '/papers/:id', db)(7, user, { published: 1 }).code, 0);
    assert.equal(db.prepare('SELECT published FROM mf_papers WHERE id=7').get().published, 1);
  });

test('DOCX rechecks exported ids after render even if paper membership cleared', async t => {
  const db = fixture(t);
  db.exec("INSERT INTO papers(id,q_ids,title) VALUES(7,'[1]','test')");
  const r = await handler('paper-docx.js', 'get', '/papers/:id/export-docx', db, {
    buildPaperDocx: async () => {
      db.exec("UPDATE users SET created_by=20 WHERE id=101; UPDATE papers SET q_ids='[]' WHERE id=7");
      return Buffer.from('synthetic');
    }
  })(7);
  assert.equal(r.code, 403);
  assert.equal(r.buffer, undefined);
});

for (const phase of ['save', 'url'])
  test('archive rechecks snapshot after ' + phase + ' and membership removal', async t => {
    const db = fixture(t);
    db.exec("INSERT INTO mf_papers VALUES(7,0,'done'); INSERT INTO mf_paper_questions(question_id,paper_id,kind) VALUES(1,7,'question')");
    const change = () => db.exec('UPDATE users SET created_by=20 WHERE id=101; DELETE FROM mf_paper_questions WHERE paper_id=7');
    const r = await handler('mfbank.js', 'post', '/papers/:id/archive', db, {
      Buffer,
      renderPaperHtml: () => '<p>synthetic</p>',
      bankFolder: () => 'test',
      store: {
        saveFile: async () => {
          if (phase === 'save') change();
          return { key: 'test' };
        },
        getUrl: async () => {
          if (phase === 'url') change();
          return 'isolated://test';
        }
      }
    })(7);
    assert.equal(r.code, 403);
    assert.equal(r.data, undefined);
  });
