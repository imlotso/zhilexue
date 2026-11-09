'use strict';
// Binding ownership regression: actual source + SQLite :memory: only.
// No server, credentials, real database, network, or submit write transaction.
// Removing the direct-question video NULL/0 guard must fail these tests.
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
const helpers = ['visibleChapterWhere', 'canSeeChapter', 'lessonsOf', 'groupsOf', 'nextLessonOf', 'courseAccOf'];
// Optional only to run this regression against the original, pre-fix source.
if (source.includes('function courseQuestionCountOf(')) helpers.push('courseQuestionCountOf');
const actual = [slice('const stageOfGrade =', '\n};'),
  ...helpers.map(name => slice('function ' + name + '(', '\n}')),
  slice("stu.get('/courses',", '\n});'), slice("stu.get('/course-detail',", '\n});')].join('\n');
function fixture(t) {
  const db = openMemory(); t.after(() => db.close());
  db.function('FIELD', { varargs: true }, (value, ...items) => items.indexOf(value) + 1);
  db.exec(`
    CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,status TEXT);
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
  const handlers = {};
  vm.runInNewContext(actual, {db, accuracy, stu: {get(route, handler) { handlers[route] = handler; }},
    ok(res, data) { res.data = data; }, fail(res, error) { res.error = error; }}, {timeout: 1000});
  function invoke(route, query) { const res = {}; handlers[route]({user:{id:1},query},res); return res; }
  return { db, list(query = {}) { return invoke('/courses', {subject:'数学', ...query}).data; }, detail(id) { return invoke('/course-detail',{id}); } };
}

const bankSource = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
function bankSlice(startNeedle, endNeedle) {
  const start = bankSource.indexOf(startNeedle), end = bankSource.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, 'actual bank source boundary: ' + startNeedle);
  return bankSource.slice(start, end + endNeedle.length);
}
const bankHelpers = slice('const stageOfGrade =', '\n};') + '\n' +
  bankSlice('function stuSeesChapter(', '\n}') + '\n' + bankSlice('function sectionPracticeQs(', '\n}');
const submitPreflight = bankSlice('  let section = null;', '  // 知识点校验：视频所属课程对该学生可见');
function harness(t) {
  const f = fixture(t), handlers = {};
  f.db.exec('DELETE FROM questions');
  const box = { require:p=>require(path.join(__dirname,"src",p.replace("./",""))), db:f.db, accuracy, stu:{get(route, fn) { handlers[route] = fn; }},
    serveQ:q => q, ok(res, data) { res.data = data; }, fail(res, error) { res.error = error; } };
  vm.runInNewContext(bankHelpers + '\n' + bankSlice("stu.get('/section-questions',", '\n});'), box);
  return { ...f,
    read(id) { const res = {}; handlers['/section-questions']({user:{id:1},query:{section_id:id}},res); return res; },
    preflight(id) {
      const ctx = {...box,uid:1,kind:'section',b:{section_id:id},res:{},allowedIds:null};
      // Stop before all grading/writing code. Production preflight alone computes allowedIds.
      vm.runInNewContext(bankHelpers + '\n(function(){' + submitPreflight + '\n})()', ctx);
      return {error:ctx.res.error, ids:ctx.allowedIds && Array.from(ctx.allowedIds).sort((a,b)=>a-b)};
    },
    add(id, section, video, type='single') {
      // Deliberately stale chapter_id: ownership comes from video/section, not q.chapter_id.
      f.db.prepare('INSERT INTO questions VALUES(?,8,?,?,?)').run(id,section,video,type);
    }
  };
}
function ids(f, section) { return Array.from(f.read(section).data.list, q=>q.id).sort((a,b)=>a-b); }
function group(f, course, section) { return f.detail(course).data.groups.find(g=>g.id===section); }
function unchanged(f, fn) {
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  fn();
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before, 'read/preflight never writes');
}
test('NULL/zero direct questions and video inheritance remain available, including subjective', t => {
  const f=harness(t); f.add(501,10,null); f.add(502,10,0,'answer'); f.add(503,null,100);
  unchanged(f,()=>{
    assert.deepEqual(ids(f,10),[501,502,503]); assert.deepEqual(f.preflight(10).ids,[501,502,503]);
    const g=group(f,1,10); assert.equal(g.practice_count,3); assert.equal(g.own_qcount,2); assert.equal(g.acc.total,2);
    assert.equal(f.list().find(c=>c.id===1).question_count,3);
    assert.equal(f.read(10).data.list[0].id,503,'video questions precede direct questions');
  });
});
test('same-group dual bindings count once and follow video order before direct questions', t => {
  const f=harness(t); f.add(501,10,100); f.add(502,10,null);
  unchanged(f,()=>{
    const g=group(f,1,10); assert.equal(g.practice_count,2); assert.equal(g.own_qcount,1); assert.equal(g.acc.total,2);
    assert.deepEqual(ids(f,10),[501,502]); assert.deepEqual(f.preflight(10).ids,[501,502]);
    assert.equal(f.read(10).data.list[0].id,501);
  });
});
test('same-course cross-group dual binding belongs only to video group', t => {
  const f=harness(t); f.db.exec("INSERT INTO sections VALUES(11,1,'other',2)");
  f.add(501,11,100); f.add(502,11,null);
  unchanged(f,()=>{
    assert.deepEqual(ids(f,10),[501]); assert.deepEqual(ids(f,11),[502]);
    assert.deepEqual(f.preflight(10).ids,[501]); assert.deepEqual(f.preflight(11).ids,[502]);
    assert.equal(group(f,1,10).practice_count,1); assert.equal(group(f,1,11).practice_count,1);
  });
});
test('visible cross-course dual binding is available only under its actual video course', t => {
  const f=harness(t); f.add(501,30,100); f.add(502,30,null);
  unchanged(f,()=>{
    assert.deepEqual(ids(f,10),[501]); assert.deepEqual(ids(f,30),[502]);
    assert.deepEqual(f.preflight(30).ids,[502]); assert.equal(group(f,3,30).practice_count,1);
    assert.equal(group(f,1,10).practice_count,1);
  });
});
test('hidden grade-five video cannot leak into visible grade-four section or submit preflight', t => {
  const f=harness(t); f.db.exec('INSERT INTO videos(id,chapter_id,section_id,sort) VALUES(8000,8,80,1)');
  f.add(501,30,8000); f.add(502,30,null);
  unchanged(f,()=>{
    assert.ok(f.detail(8).error); assert.ok(!f.list().some(c=>c.id===8));
    assert.ok(f.read(80).error); assert.ok(f.preflight(80).error); assert.equal(f.preflight(80).ids,null);
    assert.deepEqual(ids(f,30),[502]); assert.deepEqual(f.preflight(30).ids,[502]);
    const g=group(f,3,30); assert.equal(g.practice_count,1); assert.equal(g.acc.total,1);
    assert.equal(f.list().find(c=>c.id===3).question_count,1);
  });
});
test('orphan nonzero video never falls back to direct section ownership', t => {
  const f=harness(t); f.add(501,30,99999); f.add(502,30,null);
  unchanged(f,()=>{
    assert.deepEqual(ids(f,30),[502]); assert.deepEqual(f.preflight(30).ids,[502]);
    assert.equal(group(f,3,30).practice_count,1);
  });
});
