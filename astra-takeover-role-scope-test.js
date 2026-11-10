'use strict';
// Actual bank handlers + fresh SQLite :memory: reads. Product writes intercepted
// and recorded, never executed. No auth/token creation, app boot, service or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const {DatabaseSync} = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
function slice(a,b){const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x,a);return source.slice(x,y+b.length);}
function fixture(t){
 const raw=openMemory();t.after(()=>raw.close());
 raw.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status INTEGER,created_by INTEGER,name TEXT,username TEXT,grade TEXT,term TEXT,stage TEXT,class_id INTEGER);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE papers(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,grade TEXT,term TEXT,stage TEXT,status TEXT,q_ids TEXT,published_at TEXT,due_at TEXT,duration INTEGER,total_score INTEGER);
 CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER,assigned_by INTEGER,created_at TEXT);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,stem TEXT);
 CREATE TABLE paper_uploads(question_id INTEGER,user_id INTEGER,status TEXT);
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score INTEGER,detail TEXT,created_at TEXT);
 INSERT INTO users VALUES(1,'admin',1,NULL,'principal','','','','',NULL),(10,'branch',1,1,'campus A','','','','',NULL),(20,'branch',1,1,'campus B','','','','',NULL);
 INSERT INTO users VALUES(101,'student',1,10,'A one','a1','四年级','上册','primary',NULL),(102,'student',1,10,'A two','a2','四年级','上册','primary',NULL),(103,'student',0,10,'A stopped','a3','四年级','上册','primary',NULL),(201,'student',1,20,'B one','b1','四年级','上册','primary',NULL),(104,'student',1,10,'A unassigned','a4','四年级','上册','primary',NULL);
 INSERT INTO papers VALUES(1,'assigned','数学','五年级','下册','primary','published','[1]','2026-01-01','',30,100),(2,'broadcast','数学','四年级','上册','primary','published','[1]','2026-01-01','',30,100),(3,'draft','数学','四年级','上册','primary','draft','[1]','2026-01-01','',30,100),(4,'other grade','数学','五年级','上册','primary','published','[1]','2026-01-01','',30,100);
 INSERT INTO paper_assignments VALUES(1,101,10,''),(1,102,10,''),(1,201,20,''),(1,103,10,'');
 INSERT INTO questions VALUES(1,'synthetic question');
 `);
 const writes=[];const db={prepare(sql){const q=raw.prepare(sql);return {get:(...a)=>q.get(...a),all:(...a)=>q.all(...a),run:(...a)=>{writes.push({sql,args:a});return {changes:1,lastInsertRowid:1};}};},transaction:fn=>()=>fn()};
 const admin={},stu={},middleware=[];
 const box={require:p=>require(path.join(__dirname,'src',p)),db,admin:{get:(p,f)=>admin['GET '+p]=f,post:(p,f)=>admin['POST '+p]=f},stu:{get:(p,f)=>stu[p]=f,use:f=>middleware.push(f)},
 ok:(res,data)=>res.data=data,fail:(res,error)=>res.error=error,now:()=> '2026-01-01',serveQ:q=>q,presentAttempt:t=>t||null};
 const snippets=[slice('const parseIds =','\n};'),slice('const stageOfGrade =','\n};'),slice('function paperDeadline(','\n}'),slice('const paperHasAssignees =',';'),slice('stu.use((req, res, next) => {','\n});'),
 ...['/papers/:id/assignees','/students-options'].map(p=>slice("admin.get('"+p+"',",'\n});')),slice("admin.post('/papers/:id/assign',",'\n});'),
 ...['/tasks','/papers','/papers/:id'].map(p=>slice("stu.get('"+p+"',",'\n});'))];
 vm.runInNewContext(snippets.join('\n'),box);
 const response=()=>({status(n){this.statusCode=n;return this;},json(j){this.jsonBody=j;return this;}});
 const invoke=(handler,user,opts={})=>{const res=response();handler({user,query:{},params:{id:1},body:{},...opts},res);return res;};
 return {raw,writes,admin:(p,user,opts)=>invoke(admin[p],user,opts),student:(p,id,paper=1)=>{const user={id,role:'student'},res=response();let next=false;middleware[0]({user},res,()=>{next=true;});if(!next)return res;stu[p]({user,params:{id:paper},query:{}},res);return res;},
 middleware:(id,role='student')=>{const res=response();let next=false;middleware[0]({user:{id,role}},res,()=>{next=true;});return {...res,next};},
 preflight:(uid,pid)=>{const res=response(),ctx={...box,uid,paperId:pid,kind:'paper',me:raw.prepare('SELECT * FROM users WHERE id=?').get(uid),res};
 vm.runInNewContext(snippets.slice(0,4).join('\n')+'\n(function(){'+slice('  let paper = null;','  if (kind === \'mfpaper\') {').replace("  if (kind === 'mfpaper') {",'')+'\nthis.allowed=allowedIds;}).call(this)',ctx);return {error:res.error,ids:ctx.allowed&&Array.from(ctx.allowed)};}};
}
const branch={id:10,role:'branch'},principal={id:1,role:'admin'};
test('same-campus existing recipients are idempotent even with duplicate requested ids',t=>{const f=fixture(t),r=f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102,101]}});assert.equal(r.error,undefined);assert.equal(r.data.total,2);assert.equal(r.data.added,0);assert.equal(f.writes.filter(x=>x.sql.startsWith('INSERT')).length,0);});
test('same-campus new recipients are inserted once per distinct requested id',t=>{const f=fixture(t),r=f.admin('POST /papers/:id/assign',branch,{params:{id:3},body:{user_ids:[101,102,101]}});assert.equal(r.error,undefined);assert.equal(r.data.total,2);assert.equal(r.data.added,2);const inserts=f.writes.filter(x=>x.sql.startsWith('INSERT'));assert.equal(inserts.length,2);assert.deepEqual(inserts.map(x=>x.args.slice(0,2)),[[3,101],[3,102]]);});
for(const ids of [[101,201],[101,103],[101,999],[101,10]])test('invalid/cross-campus assignment is rejected atomically '+ids,t=>{const f=fixture(t);assert.ok(f.admin('POST /papers/:id/assign',branch,{body:{user_ids:ids}}).error);assert.equal(f.writes.length,0);});
test('principal may assign active students across campuses',t=>{const f=fixture(t);assert.equal(f.admin('POST /papers/:id/assign',principal,{body:{user_ids:[101,201]}}).data.total,2);});
test('student options cannot override branch scope and exclude stopped accounts',t=>{const f=fixture(t);assert.deepEqual(Array.from(f.admin('GET /students-options',branch,{query:{campus:20}}).data,x=>x.id).sort(),[101,102,104]);assert.deepEqual(Array.from(f.admin('GET /students-options',principal,{query:{campus:20}}).data,x=>x.id),[201]);});
test('assignees response does not disclose another campus student',t=>{const f=fixture(t);const ids=Array.from(f.admin('GET /papers/:id/assignees',branch).data,x=>x.user_id);assert.ok(!ids.includes(201));assert.ok(ids.includes(101)&&ids.includes(102));assert.ok(Array.from(f.admin('GET /papers/:id/assignees',principal).data,x=>x.user_id).includes(201));});
test('assigned students both receive paper regardless of broadcast grade',t=>{const f=fixture(t);for(const id of [101,102]){for(const route of ['/tasks','/papers'])assert.ok(f.student(route,id).data.some(p=>p.id===1));assert.equal(f.student('/papers/:id',id).data.id,1);assert.deepEqual(f.preflight(id,1).ids,[1]);}assert.equal(f.writes.length,0);});
test('unassigned student cannot list read or submit targeted paper',t=>{const f=fixture(t);for(const route of ['/tasks','/papers'])assert.ok(!f.student(route,104).data.some(p=>p.id===1));assert.ok(f.student('/papers/:id',104).error);assert.ok(f.preflight(104,1).error);assert.equal(f.writes.length,0);});
test('draft and wrong-grade broadcast rejected by list read and submit',t=>{const f=fixture(t);for(const pid of [3,4]){assert.ok(!f.student('/papers',104).data.some(p=>p.id===pid));assert.ok(f.student('/papers/:id',104,pid).error);assert.ok(f.preflight(104,pid).error);}assert.equal(f.student('/papers/:id',104,2).data.id,2);assert.deepEqual(f.preflight(104,2).ids,[1]);});
test('removed and wrong-role callers fail student middleware',t=>{const f=fixture(t);assert.equal(f.middleware(999).next,false);assert.equal(f.middleware(10,'branch').next,false);});
test('stopped student with retained session is rejected before any paper route',t=>{const f=fixture(t);assert.equal(f.middleware(103).next,false);const r=f.student('/papers/:id',103);assert.equal(r.data,undefined);assert.equal(f.writes.length,0);});
