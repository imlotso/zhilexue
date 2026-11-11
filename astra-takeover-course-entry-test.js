'use strict';
// Actual course routes/helpers, real SQL, fresh :memory: only. No app/db/auth startup.
// Removing question entry checks must fail objective + subjective cases; widening
// them to chapter_id alone must fail orphan/cross-course binding controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const accuracy = require('./src/accuracy');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const source = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
function slice(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle), end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, 'actual source boundary: ' + startNeedle);
  return source.slice(start, end + endNeedle.length);
}
const helpers = ['legacyScopeError', 'visibleChapterWhere', 'canSeeChapter', 'lessonsOf', 'groupsOf', 'nextLessonOf', 'courseAccOf'];
// Optional only to run this regression against the original, pre-fix source.
if (source.includes('function courseQuestionCountOf(')) helpers.push('courseQuestionCountOf');
const actual = [slice('const stageOfGrade =', '\n};'),
  ...helpers.map(name => slice('function ' + name + '(', '\n}')),
  slice("stu.get('/courses',", '\n});'), slice("stu.get('/course-detail',", '\n});')].join('\n');
function fixture(t) {
  const db = openMemory(); t.after(() => db.close());
  db.function('FIELD', { varargs: true }, (value, ...items) => items.indexOf(value) + 1);
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, grade TEXT, term TEXT, stage TEXT);
    CREATE TABLE chapters(id INTEGER PRIMARY KEY,name TEXT,subject TEXT,category TEXT,grade TEXT,term TEXT,book TEXT,code TEXT,stage TEXT,sort INTEGER);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT,sort INTEGER);
    CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,title TEXT,duration INTEGER,sort INTEGER);
    CREATE TABLE handouts(id INTEGER PRIMARY KEY,chapter_id INTEGER,video_id INTEGER,section_id INTEGER,title TEXT,file_name TEXT,ext TEXT,size INTEGER,download_count INTEGER);
    CREATE TABLE progress(id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id INTEGER,video_id INTEGER,video_done INTEGER,handout_done INTEGER);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,video_id INTEGER,type TEXT);
    CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,is_correct INTEGER,self_response_id INTEGER);
    CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,self_correct INTEGER);
    CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
    CREATE TABLE bank_tree_nodes(id INTEGER,name TEXT,sort INTEGER);
    INSERT INTO users VALUES(1,'四年级','上册','primary');
  `);
  const add = db.prepare('INSERT INTO chapters VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let id = 1; id <= 18; id++) {
    add.run(id, 'QA ' + id, id === 10 ? '英语' : '数学',
      [11,12].includes(id) ? '专项提升' : id === 13 ? '中考冲刺' : '同步基础',
      id === 8 ? '五年级' : '四年级', id === 9 ? '下册' : '上册', '', '', id === 12 || id === 13 ? 'junior' : 'primary', id);
    db.prepare('INSERT INTO sections VALUES(?,?,?,1)').run(id * 10, id, 'QA group');
  }
  db.exec(`
    INSERT INTO videos(id,chapter_id,section_id,sort) VALUES(100,1,10,1),(1400,14,140,1);
    INSERT INTO handouts(id,chapter_id) VALUES(1,2);
    INSERT INTO questions VALUES
      (1,3,30,NULL,'single'),(2,4,40,NULL,'answer'),(3,5,50,0,'fill'),
      (4,6,NULL,NULL,'single'),(5,7,999,NULL,'single'),
      (6,8,80,NULL,'single'),(7,9,90,NULL,'answer'),(8,10,100,NULL,'single'),
      (9,11,110,NULL,'single'),(10,12,120,NULL,'single'),(11,13,130,NULL,'single'),
      (12,14,NULL,1400,'single'),(13,14,140,1400,'answer'),
      (14,15,140,NULL,'single'),(15,16,160,1400,'single'),
      (16,17,170,9999,'single');
  `);
  db.exec("ALTER TABLE questions ADD COLUMN stage TEXT DEFAULT ''; ALTER TABLE questions ADD COLUMN grade TEXT DEFAULT ''");
  require('./school-scope-test-fixture')(db);
  db.exec("ALTER TABLE handouts ADD COLUMN grade TEXT DEFAULT ''");
  const handlers = {};
  vm.runInNewContext(actual, {require:p=>require(path.resolve(__dirname,'src',p)), db, accuracy, stu: {get(route, handler) { handlers[route] = handler; }},
    ok(res, data) { res.data = data; }, fail(res, error) { res.error = error; }}, {timeout: 1000});
  function invoke(route, query) { const res = {}; handlers[route]({user:{id:1},query},res); return res; }
  return { db, list(query = {}) { return invoke('/courses', {subject:'数学', ...query}).data; }, detail(id) { return invoke('/course-detail',{id}); } };
}
for (const [id, name] of [[3,'unattempted objective'],[4,'subjective only'],[5,'zero video sentinel']]) {
  test(name + ' group-only course appears in list', t => {
    const f = fixture(t), row = f.list().find(x => x.id === id);
    assert.ok(row); assert.equal(row.question_count, 1); assert.equal(row.exercise_count, 0);
    assert.equal(row.acc.total, id === 4 ? 0 : 1); assert.equal(row.acc.rate, null);
  });
  test(name + ' group-only course opens with practice', t => {
    const f = fixture(t), result = f.detail(id);
    assert.equal(result.error, undefined); assert.equal(result.data.groups.length, 1);
    assert.equal(result.data.groups[0].practice_count, 1); assert.equal(result.data.kp_total, 0);
    assert.equal(result.data.acc.total, id === 4 ? 0 : 1); assert.equal(result.data.acc.rate, null);
  });
}
test('answered pure group course remains reachable with its accuracy', t => {
  const f = fixture(t); f.db.exec('INSERT INTO records(id,user_id,question_id,is_correct) VALUES(1,1,1,1)');
  assert.equal(f.list().find(x => x.id === 3)?.acc.rate, 100);
  assert.equal(f.detail(3).data?.acc.rate, 100);
});
test('video and handout-only entries retain their counts and access', t => {
  const f = fixture(t);
  for (const id of [1,2,14]) { assert.ok(f.list().some(x => x.id === id)); assert.ok(f.detail(id).data); }
  assert.equal(f.list().find(x => x.id === 2).exercise_count, 1);
  assert.equal(f.list().find(x => x.id === 14).question_count, 4); // actual bindings, each row once
});
for (const id of [6,7,15,16,17,18]) {
  test('unbound/orphan/cross-course/empty course ' + id + ' remains inaccessible', t => {
    const f = fixture(t); assert.ok(!f.list().some(x => x.id === id)); assert.ok(f.detail(id).error);
  });
}
test('grade, term, subject, category and stage filters are preserved', t => {
  const f = fixture(t); const ids = f.list().map(x => x.id);
  for (const id of [8,9,10,12,13]) assert.ok(!ids.includes(id));
  for (const id of [8,9,12,13]) assert.ok(f.detail(id).error);
  assert.ok(ids.includes(11)); assert.ok(f.detail(11).data);
  assert.ok(f.list({subject:'英语'}).some(x => x.id === 10));
  assert.deepEqual(Array.from(f.list({category:'专项提升'}), x => x.id), [11]);
});
test('course reads leave the database unchanged', t => {
  const f = fixture(t), before = f.db.prepare('SELECT total_changes() n').get().n;
  f.list(); for (const id of [1,2,3,4,5,8,11,17,18]) f.detail(id);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
});

for (const chapterId of [null, 0, 8, 14]) {
  for (const type of ['single', 'answer']) {
    test('valid direct group binding survives legacy chapter_id=' + chapterId + ' type=' + type, t => {
      const f = fixture(t);
      f.db.prepare('INSERT INTO questions(id,chapter_id,section_id,video_id,type) VALUES(99,?,180,NULL,?)').run(chapterId, type);
      const row = f.list().find(x => x.id === 18);
      assert.ok(row, 'actual section ownership makes this course reachable');
      assert.equal(row.question_count, 1);
      assert.equal(row.acc.total, type === 'answer' ? 0 : 1);
      const detail = f.detail(18);
      assert.equal(detail.error, undefined);
      assert.equal(detail.data.groups[0].practice_count, 1);
      assert.equal(detail.data.acc.total, type === 'answer' ? 0 : 1);
    });
  }
  test('video binding counts under actual course despite legacy chapter_id=' + chapterId, t => {
    const f = fixture(t);
    f.db.prepare('INSERT INTO questions(id,chapter_id,section_id,video_id,type) VALUES(99,?,NULL,100,?)').run(chapterId, 'single');
    assert.equal(f.list().find(x => x.id === 1).question_count, 1);
    assert.equal(f.detail(1).data.lessons[0].qcount, 1);
  });
}
