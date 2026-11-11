'use strict';
// Real route bodies + synthetic in-memory SQL. No application bootstrap or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let Database; try { Database = require('better-sqlite3'); new Database(':memory:').close(); } catch (_) { Database = require('node:sqlite').DatabaseSync; }
function fixture(t) {
  const raw = new Database(':memory:'); t.after(() => raw.close());
  raw.exec(`CREATE TABLE questions(id INTEGER PRIMARY KEY, stem TEXT); INSERT INTO questions VALUES(1,'referenced'),(2,'unused');
    CREATE TABLE papers(id INTEGER PRIMARY KEY, title TEXT, q_ids TEXT); INSERT INTO papers VALUES(7,'Synthetic published paper','[1,10]');
    CREATE TABLE mistakes(question_id INTEGER); INSERT INTO mistakes VALUES(1),(2);
    CREATE TABLE question_tags(question_id INTEGER); INSERT INTO question_tags VALUES(1),(2);
    CREATE TABLE question_nodes(question_id INTEGER); INSERT INTO question_nodes VALUES(1),(2);
    CREATE TABLE mf_paper_questions(id INTEGER,question_id INTEGER,paper_id INTEGER,kind TEXT); INSERT INTO mf_paper_questions(question_id) VALUES(1),(2);
    CREATE TABLE mf_papers(id INTEGER,published INTEGER); CREATE TABLE mf_paper_tries(id INTEGER,paper_id INTEGER);`);
  const db = { prepare: sql => raw.prepare(sql.replace(/ FOR UPDATE\b/g, '')), transaction: fn => (...a) => { raw.exec('BEGIN'); try { const r = fn(...a); raw.exec('COMMIT'); return r; } catch(e) { raw.exec('ROLLBACK'); throw e; } } };
  return { raw, db };
}
function call(f, file, method, route, body, id = 1) {
  const source = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
  const start = source.indexOf(`admin.${method}('${route}',`), end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  let handler;
  vm.runInNewContext(source.slice(start, end + 4), { db: f.db, admin: { [method]: (_, fn) => handler = fn },
    require: n => n === './qmeta' ? { questionsAllowed: () => true } : require(path.join(__dirname, 'src', n)),
    int: n => Number(n) || 0, ok: (r, data, msg) => r.json({code:0,data,msg}), fail: (r,msg,code=1) => r.json({code,msg}) });
  const res = { statusCode: 200, status(n) { this.statusCode=n; return this; }, json(b) { this.body=b; return this; } };
  handler({user:{id:1,role:'admin'},params:{id,rowId:1},body}, res); return res;
}
const entries = [ ['app.js','delete','/questions/:id',{}], ['bank.js','delete','/questions/:id',{}], ['bank.js','post','/questions/batch-delete',{ids:[2,1]}], ['mfbank.js','delete','/questions/:id',{}], ['mfbank.js','post','/questions/batch',{op:'delete',ids:[2,1]}] ];
for (const [file,method,route,body] of entries) {
  test(`${file} ${route} rejects referenced question before any destructive change`, t => {
    const f=fixture(t); const r=call(f,file,method,route,body);
    assert.equal(r.statusCode,409); assert.equal(r.body.code,409); assert.match(r.body.msg,/试卷.*引用/);
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,2);
    for (const table of ['mistakes','question_tags','question_nodes','mf_paper_questions']) assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,2);
    assert.equal(f.raw.prepare('SELECT q_ids FROM papers WHERE id=7').get().q_ids,'[1,10]');
  });
  test(`${file} ${route} still deletes unreferenced questions`, t => {
    const f=fixture(t); const r=call(f,file,method,route,{...body,ids:[2]},2);
    assert.equal(r.body.code,0); assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions WHERE id=2').get().n,0);
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions WHERE id=1').get().n,1);
  });
}
test('reference guard uses exact numeric membership, including string IDs', t => {
  const f=fixture(t); f.raw.exec("UPDATE papers SET q_ids='[\"1\",10]'");
  const r=call(f,'app.js','delete','/questions/:id',{},1); assert.equal(r.statusCode,409);
  const r2=call(f,'app.js','delete','/questions/:id',{},2); assert.equal(r2.body.code,0);
});

for (const [published, attempted, blocked] of [[1,0,true],[0,1,true],[1,1,true],[0,0,false]]) {
  for (const [file,method,route,body] of entries) test(`${file} ${route} mf published=${published} attempted=${attempted}`,t=>{
    const f=fixture(t); f.raw.exec("UPDATE papers SET q_ids='[]'; INSERT INTO mf_papers VALUES(9,"+published+"); UPDATE mf_paper_questions SET id=1,paper_id=9,kind='question' WHERE question_id=1;");
    if(attempted)f.raw.exec('INSERT INTO mf_paper_tries VALUES(1,9)');
    const r=call(f,file,method,route,body);
    assert.equal(r.statusCode,blocked?409:200); assert.equal(r.body.code,blocked?409:0);
    if(blocked){assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,2);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM mf_paper_questions').get().n,2);}
    else assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions WHERE id=1').get().n,0);
  });
  test(`mf row deletion published=${published} attempted=${attempted}`,t=>{
    const f=fixture(t); f.raw.exec("INSERT INTO mf_papers VALUES(9,"+published+"); UPDATE mf_paper_questions SET id=1,paper_id=9,kind='question' WHERE question_id=1;");
    if(attempted)f.raw.exec('INSERT INTO mf_paper_tries VALUES(1,9)');
    const r=call(f,'mfbank.js','delete','/papers/:id/rows/:rowId',{},9);
    assert.equal(r.statusCode,blocked?409:200);assert.equal(r.body.code,blocked?409:0);
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM mf_paper_questions WHERE id=1').get().n,blocked?1:0);
  });
}

test('published MF layout-only row can still be removed',t=>{
 const f=fixture(t);f.raw.exec("INSERT INTO mf_papers VALUES(9,1); UPDATE mf_paper_questions SET id=1,paper_id=9,kind='text',question_id=NULL WHERE question_id=1;");
 const r=call(f,'mfbank.js','delete','/papers/:id/rows/:rowId',{},9);assert.equal(r.body.code,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM mf_paper_questions WHERE id=1').get().n,0);
});
