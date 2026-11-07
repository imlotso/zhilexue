'use strict';
// Pure regression: real SQL in a fresh in-memory database; never loads src/db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const accuracy = require('./src/accuracy');
let openMemory;
let adapter;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
  openMemory = () => new Database(':memory:');
  adapter = 'better-sqlite3 :memory:';
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
  adapter = 'node:sqlite :memory:';
}
console.log('Adapter: ' + adapter);

const bankSource = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
const routeStart = bankSource.indexOf("admin.get('/accuracy',");
const routeEnd = bankSource.indexOf('// 后台：导出某个学生的错题 Word', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'locate the actual accuracy route');
const reportSource = fs.readFileSync(path.join(__dirname, 'public/admin/reportui.js'), 'utf8');
const uiStart = reportSource.indexOf('const R1_WEAK =');
const uiEnd = reportSource.indexOf('function r1Close()', uiStart);
assert.ok(uiStart >= 0 && uiEnd > uiStart, 'locate actual report renderer');
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = vm.runInNewContext(reportSource.slice(uiStart, uiEnd) + '\n({r1TreeHTML, r1RateHTML});', { esc, ic: () => '' });

function fixture() {
  const db = openMemory();
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, username TEXT, grade TEXT, term TEXT, role TEXT, created_by INTEGER);
    CREATE TABLE chapters (id INTEGER PRIMARY KEY, name TEXT, subject TEXT, grade TEXT, term TEXT);
    CREATE TABLE sections (id INTEGER PRIMARY KEY, chapter_id INTEGER, name TEXT, sort INTEGER);
    CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT, chapter_id INTEGER, section_id INTEGER, sort INTEGER);
    CREATE TABLE handouts (id INTEGER PRIMARY KEY, video_id INTEGER, chapter_id INTEGER, section_id INTEGER);
    CREATE TABLE questions (id INTEGER PRIMARY KEY, video_id INTEGER, section_id INTEGER, chapter_id INTEGER, type TEXT);
    CREATE TABLE records (id INTEGER PRIMARY KEY, user_id INTEGER, question_id INTEGER, is_correct INTEGER);
    INSERT INTO users VALUES (1,'QA student','qa_student','四年级','上','student',90);
    INSERT INTO chapters VALUES (100,'QA mixed course','数学','四年级','上'),(200,'QA own-only course','数学','四年级','上'),(300,'QA unanswered course','数学','四年级','上');
    INSERT INTO sections VALUES (10,100,'QA mixed group',1),(20,200,'QA own-only group',1),(30,300,'QA unanswered group',1);
    INSERT INTO videos VALUES (1000,'QA mastered video',100,10,1);
    INSERT INTO questions VALUES (1001,1000,NULL,100,'single'),(1002,NULL,10,100,'fill'),(1003,NULL,10,100,'answer'),(2001,NULL,20,200,'single'),(3001,NULL,30,300,'fill');
    INSERT INTO records VALUES (1,1,1001,1),(2,1,1002,0),(3,1,2001,1),(4,2,1002,1);
  `);
  let handler;
  const sandbox = {
    db, accuracy,
    admin: { get: (route, fn) => { assert.equal(route, '/accuracy'); handler = fn; } },
    ok: (res, data) => { res.value = { code: 0, data }; },
    fail: (res, msg, code = 1) => { res.value = { code, msg }; },
  };
  vm.runInNewContext(bankSource.slice(routeStart, routeEnd), sandbox);
  return {
    db,
    report(user = { id: 90, role: 'admin' }, userId = 1) {
      const res = {};
      handler({ query: { user_id: userId }, user }, res);
      return res.value;
    },
    close: () => db.close(),
  };
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function withFixture(fn) { const f = fixture(); try { fn(f); } finally { f.close(); } }
const course = (r, id) => r.data.courses.find((c) => Number(c.id) === id);

check('mixed group includes independent question: 1/2 = 50%', () => withFixture((f) => {
  const c = course(f.report(), 100);
  assert.equal(c.acc.total, 2);
  assert.equal(c.acc.answered, 2);
  assert.equal(c.acc.correct, 1);
  assert.equal(c.acc.rate, 50);
  assert.equal(c.groups[0].own_acc.total, 1);
  assert.equal(c.groups[0].own_acc.rate, 0);
  assert.equal(c.groups[0].videos[0].acc.rate, 100);
}));
check('own-only course and group are present without video', () => withFixture((f) => {
  const c = course(f.report(), 200);
  assert.ok(c, 'own-only course must exist');
  assert.equal(c.groups[0].videos.length, 0);
  assert.equal(c.groups[0].own_acc.total, 1);
  assert.equal(c.acc.rate, 100);
}));
check('unanswered independent questions remain null, not zero percent', () => withFixture((f) => {
  const c = course(f.report(), 300);
  assert.ok(c, 'unanswered course must exist');
  assert.equal(c.acc.total, 1);
  assert.equal(c.acc.answered, 0);
  assert.equal(c.acc.rate, null);
}));
check('subjective answers do not increase objective total', () => withFixture((f) => {
  f.db.exec('INSERT INTO records VALUES (5,1,1003,1)');
  assert.equal(course(f.report(), 100).groups[0].own_acc.total, 1);
}));
check('latest student answer replaces old attempt, without denominator growth', () => withFixture((f) => {
  f.db.exec('INSERT INTO records VALUES (5,1,1002,1)');
  const a = course(f.report(), 100).acc;
  assert.equal(a.total, 2); assert.equal(a.answered, 2); assert.equal(a.correct, 2); assert.equal(a.rate, 100);
}));
check('legacy dual binding counts once in shared student/admin aggregation', () => withFixture((f) => {
  f.db.exec("INSERT INTO questions VALUES (1004,1000,10,100,'single'); INSERT INTO records VALUES (5,1,1004,1)");
  const own = accuracy.ofVideo(accuracy.sectionOwnStats(f.db, 1, [10]), 10);
  const video = accuracy.ofVideo(accuracy.videoStats(f.db, 1, [1000]), 1000);
  assert.equal(own.total, 1, 'direct section statistics must not include video-bound question');
  assert.equal(accuracy.sum([own, video]).total, 3);
  assert.equal(course(f.report(), 100).acc.total, 3);
}));
check('handout-inherited video group includes direct questions', () => withFixture((f) => {
  f.db.exec("INSERT INTO videos VALUES (1001,'QA inherited video',100,NULL,2); INSERT INTO handouts VALUES (1,1001,100,10); INSERT INTO questions VALUES (1004,1001,NULL,100,'single'); INSERT INTO records VALUES (5,1,1004,1)");
  const c = course(f.report(), 100);
  assert.equal(c.groups.length, 1); assert.equal(c.acc.total, 3); assert.equal(c.acc.rate, 67);
}));
check('cross-course section reference does not relocate video into another course group', () => withFixture((f) => {
  f.db.exec('UPDATE videos SET section_id=20 WHERE id=1000');
  const c = course(f.report(), 100);
  assert.ok(c.groups.some((g) => Number(g.id) === 0 && g.videos.length === 1));
  assert.ok(c.groups.some((g) => Number(g.id) === 10 && g.own_acc.total === 1));
  assert.equal(course(f.report(), 200).acc.total, 1);
}));
check('branch permission and missing student checks remain enforced', () => withFixture((f) => {
  assert.equal(f.report({ id: 90, role: 'branch' }).code, 0);
  assert.equal(f.report({ id: 91, role: 'branch' }).code, 403);
  assert.notEqual(f.report(undefined, 999).code, 0);
  assert.notEqual(f.report(undefined, 0).code, 0);
}));
check('report is read-only', () => withFixture((f) => {
  const before = f.db.prepare('SELECT total_changes() AS n').get().n;
  f.report();
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n, before);
}));

const a = (total, answered, correct) => accuracy.withRate({ total, answered, correct });
const uiCourse = (own, videos = []) => [{ id: 1, name: 'QA visible course', subject: '数学', groups: [{ id: 10, name: 'QA visible group', own_acc: own, videos, acc: accuracy.sum([own, ...videos.map((v) => v.acc)]) }], acc: accuracy.sum([own, ...videos.map((v) => v.acc)]) }];
check('renderer shows independent-only group and its own row', () => {
  const html = ui.r1TreeHTML(uiCourse(a(1, 1, 1)), false, new Set());
  assert.match(html, /QA visible group/); assert.match(html, /分组习题/); assert.match(html, /100%/);
});
check('weak filter retains weak independent questions when all videos mastered', () => {
  const html = ui.r1TreeHTML(uiCourse(a(1, 1, 0), [{ id: 1, title: 'QA mastered video', acc: a(1, 1, 1) }]), true, new Set());
  assert.match(html, /QA visible group/); assert.match(html, /分组习题/); assert.doesNotMatch(html, /QA mastered video/);
});
check('weak filter hides mastered and unanswered own-only groups', () => {
  assert.equal(ui.r1TreeHTML(uiCourse(a(1, 1, 1)), true, new Set()), '');
  assert.equal(ui.r1TreeHTML(uiCourse(a(1, 0, 0)), true, new Set()), '');
});
check('normal view retains unanswered own-only group with correct label', () => {
  const html = ui.r1TreeHTML(uiCourse(a(1, 0, 0)), false, new Set());
  assert.match(html, /未做 · 共 1 题/); assert.match(html, /QA visible group/);
});
check('existing video-only response shape remains compatible', () => {
  const list = uiCourse(a(0, 0, 0), [{ id: 1, title: 'QA old video', acc: a(1, 1, 0) }]);
  delete list[0].groups[0].own_acc;
  const html = ui.r1TreeHTML(list, false, new Set(['g1-10']));
  assert.match(html, /QA old video/); assert.match(html, /aria-expanded="false"/);
});
console.log(`Accuracy takeover regression: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
