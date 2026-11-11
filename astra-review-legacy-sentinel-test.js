'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const Database=require('better-sqlite3');
const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
const countSql=/due: one\(`([^`]+)`/.exec(source)[1];
const start=source.indexOf("stu.get('/review-queue'");const end=source.indexOf('\n});',start)+5;assert.ok(start>0&&end>start);
function fixture(t,records){
 const db=new Database(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE questions(id INTEGER PRIMARY KEY,status TEXT);CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,resolved INTEGER,review_stage INTEGER,next_review TEXT,updated_at TEXT);");
 for(const [i,r] of records.entries()){db.prepare('INSERT INTO questions VALUES(?,?)').run(i+1,r.status||'active');db.prepare('INSERT INTO mistakes VALUES(?,?,?,?,?,?,?)').run(i+1,r.user||1,i+1,r.resolved||0,r.stage||0,r.date===undefined?'NaN-NaN-NaN':r.date,'2026-11-01 10:00:00');}
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER); CREATE TABLE paper_uploads(question_id INTEGER,user_id INTEGER,status TEXT); INSERT INTO paper_uploads SELECT id,1,'pending' FROM questions WHERE status<>'active'");
 require('./school-scope-test-fixture')(db);
 const before=JSON.stringify(db.prepare('SELECT * FROM mistakes ORDER BY id').all());db.pragma('query_only = ON');
 const box={db,todayStr:()=> '2026-11-07',require:name=>{if(name==='./compose')return require('./src/compose');if(name==='./qmeta')return require('./src/qmeta');throw Error('unexpected dependency '+name);},serveQ:q=>({id:q.id}),ok:(res,data)=>{res.data=data;},stu:{get:(route,fn)=>{box.handler=fn;}}};vm.runInNewContext(source.slice(start,end),box);
 return {queue(uid=1){const res={};box.handler({user:{id:uid}},res);return res.data.list;},count(uid=1){return vm.runInNewContext('db.prepare(`'+countSql+'`).get(uid,todayStr()).n',{...box,uid});},unchanged(){assert.equal(JSON.stringify(db.prepare('SELECT * FROM mistakes ORDER BY id').all()),before);}};
}
test('legacy exact sentinel unresolved records return to queue without writes',t=>{const f=fixture(t,[{},{}]);assert.deepEqual(Array.from(f.queue(),q=>q.id),[1,2]);assert.equal(f.count(),2);f.unchanged();});
test('legacy sentinel preserves review stage',t=>{const f=fixture(t,[{stage:2}]);assert.equal(f.queue()[0]?.review_stage,2);f.unchanged();});
test('resolved sentinel remains excluded',t=>{const f=fixture(t,[{resolved:1}]);assert.equal(f.queue().length,0);assert.equal(f.count(),0);f.unchanged();});
test('other student sentinel remains excluded',t=>{const f=fixture(t,[{user:2},{}]);assert.deepEqual(Array.from(f.queue(),q=>q.id),[2]);assert.equal(f.count(),1);f.unchanged();});
test('unapproved question sentinel remains excluded',t=>{const f=fixture(t,[{status:'pending'},{}]);assert.deepEqual(Array.from(f.queue(),q=>q.id),[2]);assert.equal(f.count(),1);f.unchanged();});
for(const [date,due] of [['2026-11-08',false],['2026-11-07',true],['2026-11-06',true],['',true],[null,true],['NaN',false],['nan-nan-nan',false],['NaN-NaN-NaN ',false],['not-a-date',false]])test('existing date boundary '+JSON.stringify(date),t=>{const f=fixture(t,[{date}]);assert.equal(f.queue().length,due?1:0);assert.equal(f.count(),due?1:0);f.unchanged();});
test('due count remains uncapped while queue keeps fifty item limit',t=>{const f=fixture(t,Array.from({length:55},()=>({})));assert.equal(f.queue().length,50);assert.equal(f.count(),55);f.unchanged();});
