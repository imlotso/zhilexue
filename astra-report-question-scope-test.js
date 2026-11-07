'use strict';
// Actual report router and bank /points handler against synthetic memory SQLite.
// No application bootstrap, live database, network or services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
let open;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  open = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  open = () => new DatabaseSync(':memory:');
}
const branch = { id: 10, role: 'branch' }, principal = { id: 1, role: 'admin' };
function fixture(t) {
  const raw = open(); t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE users(id INTEGER,username TEXT,name TEXT,grade TEXT,stage TEXT,term TEXT,expire_at TEXT,status INTEGER,last_login TEXT,created_by INTEGER,role TEXT);
    INSERT INTO users(id,created_by,role) VALUES(101,10,'student'),(201,20,'student');
    CREATE TABLE questions(id INTEGER PRIMARY KEY,stem TEXT,subject TEXT,type TEXT,question_subtype TEXT,point TEXT);
    INSERT INTO questions VALUES(1,'own private stem','数学','answer','','own-point'),(2,'foreign private stem','数学','answer','','foreign-point'),
      (3,'orphan private stem','数学','answer','','orphan-point'),(4,'approved shared stem','数学','answer','','approved-point'),(5,'shared stem','数学','answer','','shared-point');
    CREATE TABLE paper_uploads(user_id INTEGER,status TEXT,question_id INTEGER);
    INSERT INTO paper_uploads VALUES(101,'pending',1),(201,'reviewed',2),(999,'pending',3),(201,'approved',4);
    CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,my_answer TEXT,is_correct INTEGER,match_correct INTEGER,match_total INTEGER,created_at TEXT);
    CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,try_id INTEGER,my_answer TEXT,score REAL,max_score REAL,review_comment TEXT,reviewed_at TEXT,created_at TEXT,drawing_data TEXT,reviewed_by INTEGER);
    CREATE TABLE papers(id INTEGER,title TEXT,total_score REAL);
    CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,score REAL,total INTEGER,correct INTEGER,detail TEXT,created_at TEXT);
    CREATE TABLE mistakes(user_id INTEGER,resolved INTEGER);
    INSERT INTO mistakes VALUES(101,0),(101,1);
    CREATE TABLE bank_trees(id INTEGER,kind TEXT,subject TEXT,stage TEXT,sort INTEGER); CREATE TABLE settings(k TEXT,v TEXT); CREATE TABLE kb_units(id INTEGER,subject TEXT,stage TEXT,grade TEXT,sort INTEGER); CREATE TABLE kb_points(id INTEGER,unit_id INTEGER,name TEXT,sort INTEGER);
    CREATE TABLE bank_tree_nodes(id INTEGER,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER);
    INSERT INTO bank_trees VALUES(1,'knowledge','数学','primary',0);
    INSERT INTO bank_tree_nodes VALUES(1,1,NULL,'textbook-point',1);
  `);
  for (const qid of [1, 2, 3, 4, 5]) {
    raw.prepare("INSERT INTO records VALUES(?,101,?,'historical answer',1,NULL,NULL,'2026-11-07')").run(qid, qid);
    raw.prepare("INSERT INTO subjective_responses(id,user_id,question_id,kind,my_answer,score,max_score) VALUES(?,101,?,'practice','historical answer',4,10)").run(qid, qid);
  }
  raw.exec("INSERT INTO subjective_responses(id,user_id,question_id,kind,my_answer,score,max_score,drawing_data) VALUES(6,201,2,'practice','foreign student answer',4,10,'private drawing')");
  const detail = JSON.stringify([{ question_id: 2, stem: 'foreign private stem', ungraded: true, earned_score: 3, max_score: 10 }]);
  raw.prepare("INSERT INTO paper_tries VALUES(1,101,7,8,5,4,?,'2026-11-07')").run(detail);
  raw.exec("INSERT INTO papers VALUES(7,'historical paper',10)");
  const db = { prepare: sql => raw.prepare(sql.replace(/ FOR UPDATE\b/g, '')), transaction: fn => (...args) => {
    raw.exec('BEGIN'); try { const result = fn(...args); raw.exec('COMMIT'); return result; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  } };
  const routes = new Map();
  const admin = Object.fromEntries(['get', 'post'].map(method => [method, (url, fn) => routes.set(method + ' ' + url, fn)]));
  const localRequire = name => require(path.resolve(__dirname, 'src', name));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/reports.js'), 'utf8'), {
    module: { exports: {} }, require(name) {
      if (name === 'express') return { Router: () => admin };
      if (name === './db') return { db };
      return localRequire(name);
    },
  });
  const bank = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
  const a = bank.indexOf("admin.get('/points',"), b = bank.indexOf('\n});', a);
  assert.ok(a >= 0 && b > a);
  vm.runInNewContext(bank.slice(a, b + 4), { admin, db, require: localRequire,
    SUBJECTS: ['数学', '英语', '物理', '化学'], kbtree: localRequire('./kbtree'),
    ok: (res, data) => res.json({ code: 0, data }),
  });
  function call(route, { user = branch, id = 101, body = {}, query = {} } = {}) {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { this.body = data; return this; }, send(data) { this.body = data; return this; } };
    routes.get(route)({ user, params: { id }, query, body }, res);
    return res;
  }
  return { raw, call, detail };
}
for (const user of [branch, principal]) for (const key of ['rows', 'subjective']) test(user.role + ' report ' + key + ' filters private content without changing historical totals', t => {
  const f = fixture(t), r = f.call('get /exercises/:id/detail', { user });
  assert.equal(r.body.code, 0);
  const expected = user.role === 'admin' ? [1, 2, 3, 4, 5] : [1, 4, 5];
  assert.deepEqual(Array.from(r.body.data[key], row => row.question_id).sort(), expected);
  assert.equal(r.body.data.subjects.find(s => s.subject === '数学').n, 5);
  assert.equal(r.body.data.wrong_open, 1); assert.equal(r.body.data.mastered, 1);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n, 5);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM subjective_responses').get().n, 6);
});
test('attempt presentation never exposes stored detail stem and preserves grades and stored detail', t => {
  const f = fixture(t), r = f.call('get /exercises/:id/detail');
  const attempt = r.body.data.papers[0];
  assert.equal(attempt.score, 8); assert.equal(attempt.total, 5); assert.equal(attempt.correct, 4);
  assert.equal(attempt.detail, undefined);
  assert.ok(!JSON.stringify(attempt).includes('foreign private stem'));
  assert.equal(f.raw.prepare('SELECT detail FROM paper_tries WHERE id=1').get().detail, f.detail);
});
for (const user of [branch, principal]) for (const query of [{}, { subject: '数学' }]) test(user.role + ' points scope preserves approved/shared and textbook points ' + JSON.stringify(query), t => {
  const f = fixture(t), r = f.call('get /points', { user, query });
  const expected = ['own-point', 'approved-point', 'shared-point', 'textbook-point'];
  if (user.role === 'admin') expected.push('foreign-point', 'orphan-point');
  assert.deepEqual(Array.from(r.body.data).sort(), expected.sort());
});
test('branch cannot read another campus student report or drawing, or grade their response', t => {
  const f = fixture(t);
  assert.equal(f.call('get /exercises/:id/detail', { id: 201 }).body.code, 403);
  assert.equal(f.call('get /subjective/:id/drawing', { id: 6 }).statusCode, 404);
  const result = f.call('post /subjective/:id/grade', { id: 6, body: { score: 7 } });
  assert.notEqual(result.body.code, 0);
  assert.equal(f.raw.prepare('SELECT score FROM subjective_responses WHERE id=6').get().score, 4);
});
test('own student response grading remains allowed and changes no question content', t => {
  const f = fixture(t), before = f.raw.prepare('SELECT * FROM questions').all();
  assert.equal(f.call('post /subjective/:id/grade', { id: 1, body: { score: 7 } }).body.code, 0);
  assert.equal(f.raw.prepare('SELECT score FROM subjective_responses WHERE id=1').get().score, 7);
  assert.deepEqual(f.raw.prepare('SELECT * FROM questions').all(), before);
});
