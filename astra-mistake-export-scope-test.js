'use strict';
// Synthetic SQLite and extracted real handlers/functions only: no app, real DB,
// service, network, credentials, or rendering/image fetches.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let open;
try { const Database = require('better-sqlite3'); const probe = new Database(':memory:'); probe.close(); open = () => new Database(':memory:'); }
catch (_) { const { DatabaseSync } = require('node:sqlite'); open = () => new DatabaseSync(':memory:'); }
const root=process.env.MISTAKE_SCOPE_SOURCE||__dirname;
function source(file,start,end='\n}') {
 const s=fs.readFileSync(path.join(root,'src',file+'.js'),'utf8');
 const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a,start);return s.slice(a,b+end.length);
}
function fixture(t){
 const db=open();t.after(()=>db.close());
 db.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER,name TEXT,username TEXT,grade TEXT);
 INSERT INTO users VALUES(1,'admin',NULL,'总校','',''),(10,'branch',1,'甲校','',''),(20,'branch',1,'乙校','',''),(101,'student',10,'甲生','',''),(201,'student',20,'乙生','','');
 CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,status TEXT);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,type TEXT,question_subtype TEXT,match_prompts TEXT,stem TEXT,options TEXT,answer TEXT,analysis TEXT,material TEXT,subject TEXT,point TEXT,images TEXT,difficulty INTEGER);
 CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT);
 CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,my_answer TEXT,is_correct INTEGER,created_at TEXT);
 INSERT INTO paper_uploads VALUES(1,101,1,'pending'),(2,201,2,'pending'),(3,101,3,'reviewed'),(4,201,3,'pending'),(5,201,4,'approved');
 `);
 for(let id=1;id<=5;id++){
 db.prepare("INSERT INTO questions VALUES(?,'single','','[]',?,'[]','A','解析','','数学','知识点','[]',1)").run(id,'题'+id);
 db.prepare("INSERT INTO mistakes VALUES(?,101,?,1,'B',0,'2026-01-01',0,'')").run(id,id);
 }
 const handlers={},calls=[];
 let buildHook=()=>{};
 const box={db,console,parseQ:x=>x,nowStr:()=> '2026-01-01',
 admin:{get:(p,f)=>handlers[p]=f},ok:(r,data)=>r.data=data,fail:(r,msg,status)=>{r.error=msg;r.statusCode=status;},
 buildMistakeDocx:async o=>{calls.push(o.items.map(x=>x.question_id));await buildHook();return Buffer.from('fake docx');},
 require:p=>{if(p==='./qmeta')return require('./src/qmeta');if(p==='./mistake-docx')return {sendMistakeDocx:box.sendMistakeDocx};throw Error(p);}
 };
 vm.runInNewContext(source('mistake-docx','function collectMistakes(')+'\n'+source('mistake-docx','async function sendMistakeDocx('),box);
 for(const route of ['/mistakes','/mistakes/export-docx'])vm.runInNewContext(source('bank',"admin.get('"+route+"',",'\n});'),box);
 const response=()=>({status(n){this.statusCode=n;return this;},json(v){this.jsonBody=v;return this;},setHeader(k,v){(this.headers||={})[k]=v;},end(v){this.bytes=v;}});
 const invoke=async(route,user,query={})=>{const res=response();await handlers[route]({user,query:{user_id:101,...query}},res);return res;};
 return {db,box,calls,invoke,response,setBuildHook:fn=>buildHook=fn};
}
const branch={id:10,role:'branch'},admin={id:1,role:'admin'};
test('branch mistake list and total reject foreign and cross-campus-linked pending questions',async t=>{
 const f=fixture(t),r=await f.invoke('/mistakes',branch);
 assert.deepEqual(Array.from(r.data.list,x=>x.question_id),[1,4,5]);assert.equal(r.data.total,3);
});
test('principal list retains all questions',async t=>{
 const f=fixture(t),r=await f.invoke('/mistakes',admin);assert.equal(r.data.total,5);
});
test('teacher export uses authenticated server scope, ignoring forged query scope',async t=>{
 const f=fixture(t),r=await f.invoke('/mistakes/export-docx',branch,{questionUser:admin,studentOnlyReviewed:false,access:{questionUser:admin}});
 assert.ok(r.bytes);assert.deepEqual(Array.from(f.calls[0]),[1,4,5]);
});
test('principal export retains all questions',async t=>{
 const f=fixture(t),r=await f.invoke('/mistakes/export-docx',admin);assert.ok(r.bytes);assert.equal(f.calls[0].length,5);
});
test('student strict export wins over any teacher/query hints',async t=>{
 const f=fixture(t),r=f.response();
 await f.box.sendMistakeDocx(f.db,r,{id:101},{questionUser:admin},{studentOnlyReviewed:true,questionUser:admin});
 assert.deepEqual(Array.from(f.calls[0]),[4,5]);assert.ok(r.bytes);
});
test('branch export still denies a foreign student',async t=>{
 const f=fixture(t),r=await f.invoke('/mistakes/export-docx',branch,{user_id:201});assert.equal(r.statusCode,403);assert.equal(f.calls.length,0);
});
test('teacher export rechecks original rendered ids after await and sends no file on ownership change',async t=>{
 const f=fixture(t);
 f.setBuildHook(()=>f.db.exec('UPDATE users SET created_by=20 WHERE id=101'));
 const r=await f.invoke('/mistakes/export-docx',branch);
 assert.equal(r.bytes,undefined);assert.equal(r.statusCode,403);assert.equal(r.headers,undefined);
});
test('student export rechecks original rendered ids after approved becomes reviewed',async t=>{
 const f=fixture(t),r=f.response();
 f.setBuildHook(()=>f.db.exec("UPDATE paper_uploads SET status='reviewed' WHERE question_id=4"));
 await f.box.sendMistakeDocx(f.db,r,{id:101},{},{studentOnlyReviewed:true});
 assert.equal(r.bytes,undefined);assert.equal(r.statusCode,403);assert.equal(r.headers,undefined);
});
test('a newly attached foreign pending linkage invalidates an already rendered teacher export',async t=>{
 const f=fixture(t);
 f.setBuildHook(()=>f.db.exec("INSERT INTO paper_uploads VALUES(6,201,1,'pending')"));
 const r=await f.invoke('/mistakes/export-docx',branch);
 assert.equal(r.bytes,undefined);assert.equal(r.statusCode,403);
});

test('teacher export rechecks student campus after rendering even with only approved questions', async t => {
 const f = fixture(t);
 f.db.exec("UPDATE paper_uploads SET status='approved'");
 f.setBuildHook(() => f.db.exec('UPDATE users SET created_by=20 WHERE id=101'));
 const r = await f.invoke('/mistakes/export-docx', branch);
 assert.equal(r.bytes, undefined);
 assert.equal(r.statusCode, 403);
 assert.equal(r.headers, undefined);
});
