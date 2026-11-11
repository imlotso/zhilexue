'use strict';
// Execute production association routes against isolated SQLite. No app bootstrap,
// live database, credentials, external network or AI calls.
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Database=require('better-sqlite3'),SchoolScope=require('./src/school-scope');
const source=fs.readFileSync(path.join(__dirname,'src/mfbank.js'),'utf8');
function fixture(t){
 const raw=new Database(':memory:');t.after(()=>raw.close());raw.exec(`
 CREATE TABLE questions(id INTEGER PRIMARY KEY,stage TEXT,grade TEXT,subject TEXT);
 INSERT INTO questions VALUES(1,'junior','七年级','数学'),(2,'senior','','数学'),(3,'junior','高一','数学');
 CREATE TABLE users(id INTEGER,role TEXT,created_by INTEGER);
 CREATE TABLE paper_uploads(question_id INTEGER,user_id INTEGER,status TEXT);
 CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,stage TEXT,grade TEXT,status TEXT,published INTEGER,trashed_from TEXT);
 INSERT INTO mf_papers VALUES(1,'junior','七年级','done',0,''),(2,'senior','高一','done',0,'');
 CREATE TABLE mf_paper_questions(paper_id INTEGER,question_id INTEGER,position INTEGER,score REAL,kind TEXT,created_at TEXT);
 CREATE TABLE mf_recog_runs(drafts TEXT,status TEXT,source_kind TEXT);
 CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,stage TEXT,kind TEXT);
 INSERT INTO bank_trees VALUES(1,'junior','knowledge'),(2,'senior','knowledge');
 CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER);
 INSERT INTO bank_tree_nodes VALUES(11,1),(22,2);
 CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER,UNIQUE(question_id,node_id));
 INSERT INTO question_nodes VALUES(1,11);
 `);
 const db={prepare:sql=>raw.prepare(sql.replace(/ FOR UPDATE\b/g,'')),transaction:fn=>raw.transaction(fn)};
 function call(method,url,id,body){
  const a=source.indexOf(`admin.${method}('${url}',`),b=source.indexOf('\n});',a)+4;assert.ok(a>=0&&b>a,url);let fn;
  vm.runInNewContext(source.slice(a,b),{SchoolScope,db,admin:{[method]:(url,handler)=>{fn=handler;}},
   require:name=>require(path.resolve(__dirname,'src',name)),int:(x,d=0)=>parseInt(x,10)||d,num:(x,d=0)=>Number(x)||d,now:()=>'',parseArr:s=>JSON.parse(s||'[]'),
   PAPER_STATUS:{done:'完成',archived:'归档'},EXAM_CATEGORIES:[''],ok:(res,data)=>{res.body={code:0,data};},fail:(res,msg)=>{res.body={code:1,msg};}});
  const res={};fn({params:{id},body,user:{id:1,role:'admin'},query:{}},res);return res.body;
 }
 return {raw,call,snapshot:()=>JSON.stringify(['mf_papers','mf_paper_questions','question_nodes'].map(table=>raw.prepare('SELECT * FROM '+table).all()))};
}
for(const qid of [2,3])test('adding historical high-school question '+qid+' cannot hide a junior paper',t=>{
 const f=fixture(t),before=f.snapshot(),r=f.call('post','/papers/:id/questions',1,{question_ids:[1,qid]});assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);
});
test('supported questions cannot be appended to a historical high-school paper',t=>{
 const f=fixture(t),before=f.snapshot(),r=f.call('post','/papers/:id/questions',2,{question_ids:[1]});assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);
});
test('a junior paper containing historical senior questions cannot be published',t=>{
 const f=fixture(t);f.raw.exec("INSERT INTO mf_paper_questions VALUES(1,2,1,0,'question','')");const before=f.snapshot(),r=f.call('put','/papers/:id',1,{published:1});assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);
});
test('supported paper association and publication still succeed',t=>{
 const f=fixture(t);assert.equal(f.call('post','/papers/:id/questions',1,{question_ids:[1]}).code,0);assert.equal(f.call('put','/papers/:id',1,{published:1}).code,0);assert.equal(f.raw.prepare('SELECT published FROM mf_papers WHERE id=1').get().published,1);
});
for(const [qid,nids] of [[1,[22]],[2,[11]]])test('direct node assignment rejects a senior question or tree '+qid+':'+nids,t=>{
 const f=fixture(t),before=f.snapshot(),r=f.call('post','/questions/:id/nodes',qid,{node_ids:nids});assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);
});
test('batch node assignment rejects mixed trees before replacing existing links',t=>{
 const f=fixture(t),before=f.snapshot(),r=f.call('post','/questions/batch',0,{ids:[1],op:'node',nodes:[11,22],replace:1});assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);
});
test('a junior tree node cannot be reparented under a historical senior node',t=>{
 const f=fixture(t);f.raw.exec("ALTER TABLE bank_tree_nodes ADD COLUMN parent_id INTEGER; ALTER TABLE bank_tree_nodes ADD COLUMN name TEXT; ALTER TABLE bank_tree_nodes ADD COLUMN sort INTEGER");
 const before=JSON.stringify(f.raw.prepare('SELECT * FROM bank_tree_nodes').all()),r=f.call('put','/nodes/:id',11,{parent_id:22,name:'不能留下的名称修改'});
 assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(JSON.stringify(f.raw.prepare('SELECT * FROM bank_tree_nodes').all()),before);
});
test('a new junior tree node cannot use a senior parent id',t=>{
 const f=fixture(t),r=f.call('post','/trees/:id/nodes',1,{parent_id:22,name:'合成节点'});
 assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM bank_tree_nodes').get().n,2);
});
