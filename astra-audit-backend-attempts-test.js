'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let Database;try{Database=require('better-sqlite3');new Database(':memory:').close();}catch(_){Database=require('node:sqlite').DatabaseSync;}
function fixture(t){
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER,username TEXT,name TEXT,grade TEXT,stage TEXT,term TEXT,status INTEGER,expire_at TEXT,last_login TEXT,created_by INTEGER,role TEXT);
 INSERT INTO users(id,created_by,role)VALUES(101,10,'student'),(201,20,'student');INSERT INTO users(id,name,role)VALUES(10,'own branch','branch'),(20,'foreign branch','branch');
 CREATE TABLE questions(id INTEGER,subject TEXT,stem TEXT,type TEXT,question_subtype TEXT);
 CREATE TABLE records(id INTEGER,user_id INTEGER,question_id INTEGER,is_correct INTEGER,created_at TEXT,my_answer TEXT,match_correct INTEGER,match_total INTEGER,self_response_id INTEGER);
 CREATE TABLE mistakes(user_id INTEGER,resolved INTEGER);
 CREATE TABLE paper_tries(id INTEGER,user_id INTEGER,paper_id INTEGER,score REAL,total INTEGER,correct INTEGER,detail TEXT,created_at TEXT);
 CREATE TABLE mf_paper_tries(id INTEGER,user_id INTEGER,paper_id INTEGER,score REAL,total INTEGER,correct INTEGER,detail TEXT,created_at TEXT);
 CREATE TABLE papers(id INTEGER,title TEXT,total_score REAL);
 CREATE TABLE mf_papers(id INTEGER,title TEXT);
 CREATE TABLE mf_paper_questions(paper_id INTEGER,kind TEXT,score REAL);
 CREATE TABLE subjective_responses(id INTEGER,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,try_id INTEGER,my_answer TEXT,score REAL,max_score REAL,review_comment TEXT,reviewed_at TEXT,created_at TEXT,drawing_data TEXT,self_correct INTEGER);
 INSERT INTO papers VALUES(1,'ordinary',100);INSERT INTO mf_papers VALUES(1,'mf');INSERT INTO mf_paper_questions VALUES(1,'question',100);
 INSERT INTO paper_tries VALUES(1,101,1,60,2,1,'[]','2026-11-01');
 INSERT INTO mf_paper_tries VALUES(1,101,1,90,2,2,'[]','2026-11-02'),(2,101,1,NULL,2,1,'[{"ungraded":true,"max_score":100}]','2026-11-03'),(3,201,1,20,2,0,'[]','2026-11-04');`);
 db.exec('ALTER TABLE paper_tries ADD COLUMN total_score_snapshot REAL; ALTER TABLE mf_paper_tries ADD COLUMN total_score_snapshot REAL;');
 const routes={};const router={get:(p,f)=>routes['get '+p]=f,post:(p,f)=>routes['post '+p]=f};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'src/reports.js'),'utf8'),{module:{exports:{}},require:n=>n==='express'?{Router:()=>router}:n==='./db'?{db}:n==='./qmeta'?{questionScopeSql:()=> '1=1'}:require(path.join(__dirname,'src',n))});
 const call=(route,id=101,user={id:10,role:'branch'},query={})=>{const res={json(b){this.body=b;return this;},status(){return this;}};routes[route]({user,query,params:{id}},res);return res.body;};
 return {db,call};
}
test('exercise report combines ordinary and mf attempts and excludes pending scores from average',t=>{
 const f=fixture(t),r=f.call('get /exercises');assert.equal(r.code,0);assert.equal(r.data.list.length,1);const s=r.data.list[0];assert.equal(s.paper_tries,3);assert.equal(s.paper_avg,75);assert.equal(s.paper_best,90);assert.equal(s.last_at,'2026-11-03');
});
test('mf-only student has nonzero paper count and score',t=>{const f=fixture(t),r=f.call('get /exercises',201,{id:20,role:'branch'});assert.equal(r.data.list[0].paper_tries,1);assert.equal(r.data.list[0].paper_avg,20);});
test('detail preserves attempt source despite overlapping IDs, titles and pending presentation',t=>{
 const f=fixture(t),r=f.call('get /exercises/:id/detail');assert.equal(r.code,0);const papers=r.data.papers;assert.equal(papers.length,3);assert.deepEqual(Array.from(papers,x=>[x.kind,x.id]),[['mfpaper',2],['mfpaper',1],['paper',1]]);assert.equal(papers[0].score,null);assert.equal(papers[0].ungraded_count,1);assert.equal(papers[1].title,'mf');assert.equal(papers[2].title,'ordinary');assert.ok(papers.every(x=>x.detail===undefined));assert.equal(papers[1].total_score,null);
});
test('report sees updated mf manual score without duplicating the attempt',t=>{const f=fixture(t);f.db.exec("UPDATE mf_paper_tries SET score=80,detail='[{\"manual_graded\":true,\"earned_score\":80,\"max_score\":100}]' WHERE id=2");const r=f.call('get /exercises');assert.equal(r.data.list[0].paper_tries,3);assert.equal(r.data.list[0].paper_avg,76.7);assert.equal(f.call('get /exercises/:id/detail').data.papers[0].score,80);});
test('new detail keeps foreign student authorization boundary',t=>{const f=fixture(t);assert.equal(f.call('get /exercises/:id/detail',201).code,403);});

test('trusted full-score snapshot survives later MF row edits',t=>{
 const f=fixture(t);f.db.exec('UPDATE mf_paper_tries SET total_score_snapshot=100 WHERE id=1');f.db.prepare('UPDATE mf_paper_tries SET detail=? WHERE id=1').run(JSON.stringify([{question_id:1,max_score:50,earned_score:50},{question_id:2,max_score:50,earned_score:40}]));
 f.db.exec('UPDATE mf_paper_questions SET score=50');
 const row=f.call('get /exercises/:id/detail').data.papers.find(x=>x.kind==='mfpaper'&&x.id===1);assert.equal(row.score,90);assert.equal(row.total_score,100);assert.equal(row.total_score_source,'attempt');
});
for(const detail of ['[]','broken','[{"question_id":1,"max_score":50}]','[{"max_score":50},{"max_score":null}]'])test('incomplete historical denominator is unknown, never current MF total: '+detail,t=>{
 const f=fixture(t);f.db.prepare('UPDATE mf_paper_tries SET detail=? WHERE id=1').run(detail);
 const row=f.call('get /exercises/:id/detail').data.papers.find(x=>x.kind==='mfpaper'&&x.id===1);assert.equal(row.score,90);assert.equal(row.total_score,null);assert.equal(row.total_score_source,'unknown');
});
test('ordinary explicit full snapshot and manually graded response retain confirmed full score',t=>{
 const f=fixture(t);f.db.exec('UPDATE paper_tries SET total_score_snapshot=100 WHERE id=1');f.db.prepare('UPDATE paper_tries SET detail=? WHERE id=1').run(JSON.stringify([{question_id:1,max_score:20,earned_score:20},{question_id:2,max_score:30,earned_score:30},{question_id:3,response_id:9,manual_graded:true,max_score:50,earned_score:10}]));
 f.db.exec('UPDATE papers SET total_score=20');const row=f.call('get /exercises/:id/detail').data.papers.find(x=>x.kind==='paper');assert.equal(row.total_score,100);assert.equal(row.score,60);
});

test('even valid max_score on every legacy detail item cannot prove the full original paper',t=>{
 const f=fixture(t);f.db.prepare('UPDATE mf_paper_tries SET score=50,total=1,detail=? WHERE id=1').run(JSON.stringify([{question_id:1,max_score:50,earned_score:50}]));
 const row=f.call('get /exercises/:id/detail').data.papers.find(x=>x.kind==='mfpaper'&&x.id===1);assert.equal(row.score,50);assert.equal(row.total_score,null);
});
