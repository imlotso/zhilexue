'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let Database;try{Database=require('better-sqlite3');new Database(':memory:').close();}catch(_){Database=require('node:sqlite').DatabaseSync;}
function fixture(t){
 const raw=new Database(':memory:');t.after(()=>raw.close());
 raw.exec(`CREATE TABLE mf_papers(id INTEGER,published INTEGER);CREATE TABLE mf_paper_tries(paper_id INTEGER);CREATE TABLE mf_paper_questions(paper_id INTEGER,question_id INTEGER,kind TEXT);
 CREATE TABLE papers(id INTEGER,q_ids TEXT); INSERT INTO papers VALUES(1,'[11]');
 CREATE TABLE questions(id INTEGER);INSERT INTO questions VALUES(11);
 CREATE TABLE paper_uploads(id INTEGER,question_id INTEGER,user_id INTEGER,status TEXT,review_note TEXT,reviewed_by INTEGER,reviewed_at TEXT);INSERT INTO paper_uploads VALUES(1,11,101,'reviewed','',NULL,'');
 CREATE TABLE mistakes(question_id INTEGER);INSERT INTO mistakes VALUES(11);
 CREATE TABLE records(question_id INTEGER);INSERT INTO records VALUES(11);
 CREATE TABLE question_nodes(question_id INTEGER);INSERT INTO question_nodes VALUES(11);
 CREATE TABLE mf_recog_runs(id INTEGER,drafts TEXT);INSERT INTO mf_recog_runs VALUES(2,'[{"stem":"keep draft"}]');`);
 const db={prepare:s=>raw.prepare(s.replace(/ FOR UPDATE\b/g,'')),transaction:fn=>fn};let fn;
 const env={db,require:n=>n==='./qmeta'?{questionsAllowed:()=>true}:require(path.join(__dirname,'src',n)),admin:{post:(_,f)=>fn=f,delete:(_,f)=>fn=f},canManageStudentRecord:()=>true,now:()=>'',ok:(r,data,msg)=>r.json({code:0,data,msg}),fail:(r,msg,code=1)=>r.json({code,msg}),
 scanAccessError:()=>null,groupIds:()=>({run:new Map([[2,[{index:0}]]]),cap:new Map(),up:[1]}),uniqBy:a=>a,parseArr:JSON.parse,fpOf:s=>s,stemOfCard:c=>c.stem,jstr:JSON.stringify};
 const bank=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8'),a=bank.indexOf('function removeUploadQuestion('),b=bank.indexOf('\n}',a);
 vm.runInNewContext(bank.slice(a,b+2),env);
 function call(kind){const pending=kind==='pending',source=pending?fs.readFileSync(path.join(__dirname,'src/mfpending.js'),'utf8'):bank;
 const route=kind==='review'?"admin.post('/uploads/:id/review',":kind==='delete'?"admin.delete('/uploads/:id',":"admin.post('/ext/pending/delete',";
 const a=source.indexOf(route),endMark=pending?'\n  });':'\n});',b=source.indexOf(endMark,a);assert.ok(a>=0&&b>a);
 vm.runInNewContext(source.slice(a,b+endMark.length),env);
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};
 fn({user:{id:1,role:'admin'},params:{id:1},body:{status:'rejected',ids:['up:1','run:2:0']}},res);return res;
 }
 return {raw,call};
}
for(const kind of ['review','delete','pending'])test(kind+' cannot delete a historical ordinary-paper question or partially remove drafts',t=>{
 const f=fixture(t),r=f.call(kind);assert.equal(r.statusCode,409);assert.equal(r.body.code,409);assert.match(r.body.msg,/试卷.*引用/);
 for(const table of ['questions','mistakes','records','question_nodes','paper_uploads'])assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);
 assert.equal(f.raw.prepare('SELECT status FROM paper_uploads').get().status,'reviewed');assert.equal(JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs').get().drafts).length,1);
});
for(const kind of ['review','delete','pending'])test(kind+' retains normal deletion when the upload question has no paper references',t=>{
 const f=fixture(t);f.raw.exec("UPDATE papers SET q_ids='[]'");const r=f.call(kind);assert.equal(r.body.code,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,0);
});
