'use strict';
// Actual legacy bank mutation handlers and real SQLite. Synthetic rows only:
// no app startup, production DB, AI, uploads or network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Database=require('better-sqlite3');
const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
function slice(start,end='\n});') {const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b+end.length);}
const valid={type:'single',stem:'初中物理题',options:['甲','乙'],answer:'A',subject:'物理',stage:'junior',grade:'八年级'};
function fixture(t) {
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,type TEXT,stem TEXT,options TEXT,answer TEXT,analysis TEXT,difficulty INTEGER,difficulty_score_10 INTEGER,sort INTEGER,stage TEXT,grade TEXT,subject TEXT,point TEXT,material TEXT,source TEXT,year TEXT,video_id INTEGER,section_id INTEGER,chapter_id INTEGER,images TEXT,created_at TEXT);
 CREATE TABLE paper_uploads(question_id INTEGER,user_id INTEGER,status TEXT);
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,stage TEXT,grade TEXT,subject TEXT,name TEXT);
 INSERT INTO chapters VALUES(1,'junior','八年级','物理','初中课'),(2,'senior','','物理','高中课');
 CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER);INSERT INTO sections VALUES(1,1),(2,2);
 CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,grade TEXT,subject TEXT,title TEXT);
 INSERT INTO videos VALUES(1,1,1,'','物理','初中'),(2,2,NULL,'','物理','高中课程'),(3,1,NULL,'高一','物理','高中年级'),(4,1,NULL,'','物理','高中树'),(5,1,2,'','物理','高中分组');
 CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,kind TEXT,subject TEXT,stage TEXT,name TEXT,sort INTEGER);
 INSERT INTO bank_trees VALUES(1,'knowledge','物理','junior','初中树',0),(2,'knowledge','物理','senior','高中树',0);
 CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER,name TEXT,sort INTEGER);
 INSERT INTO bank_tree_nodes VALUES(1,1,'初中点',0),(2,2,'高中点',0);
 CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER);
 INSERT INTO question_nodes VALUES(1,1),(5,2);
 CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);INSERT INTO video_nodes VALUES(1,1),(4,2);
 CREATE TABLE records(id INTEGER PRIMARY KEY,question_id INTEGER,my_answer TEXT);INSERT INTO records VALUES(1,2,'historical answer');
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,detail TEXT);INSERT INTO paper_tries VALUES(1,'historical attempt');`);
 const ins=db.prepare("INSERT INTO questions(id,type,stem,options,answer,difficulty,stage,grade,subject,video_id,section_id,chapter_id,images) VALUES(?,'single','历史题','[\"甲\",\"乙\"]','A',3,?,?,'物理',?,?,?,'[]')");
 ins.run(1,'junior','八年级',null,null,null);ins.run(2,'','',2,null,null);ins.run(3,'','',null,2,null);ins.run(4,'','',null,null,2);ins.run(5,'','',null,null,null);ins.run(6,'senior','高一',null,null,null);
 const routes={},box={db,TYPES:['single','multi','judge','fill','sort','answer'],LETTERS:'ABCDEFGHIJ',resolveDifficulty:require('./src/difficulty').resolveDifficulty,
 require:n=>require(path.resolve(__dirname,'src',n)),now:()=>'',ok:(r,data,msg)=>{r.data=data;r.msg=msg;},fail:(r,error,code=1)=>{r.error=error;r.code=code;},
 admin:{post:(p,fn)=>routes['POST '+p]=fn,put:(p,fn)=>routes['PUT '+p]=fn,get:(p,fn)=>routes['GET '+p]=fn}};
 vm.createContext(box);vm.runInContext(slice('function normalizeBankQ(','\n}')+'\n'+slice('const chapterStage =','\n};'),box);
 for(const route of ['/videos/:id/bind','/sections/:id/bind','/videos/:id/nodes','/questions'])vm.runInContext(slice(`admin.post('${route}',`),box);
 vm.runInContext(slice("admin.put('/questions/:id',"),box);vm.runInContext(slice("admin.get('/videos/:id/nodes',"),box);
 const call=(method,route,id,body={})=>{const res={};routes[method+' '+route]({user:{id:1,role:'admin'},params:{id},body,query:{}},res);return res;};
 const snapshot=()=>JSON.stringify(['questions','question_nodes','video_nodes','records','paper_tries'].map(table=>db.prepare('SELECT * FROM '+table).all()));
 return {db,call,snapshot};
}
test('video/section binding cannot clear or move an existing high-school question to a junior resource',t=>{
 const f=fixture(t),before=f.snapshot();
 for(const id of [2,3,4,5,6])for(const [route,target,body] of [
   ['/videos/:id/bind',0,{unbind:1}],['/videos/:id/bind',1,{}],['/sections/:id/bind',1,{}],['/sections/:id/bind',2,{unbind:1}],
 ]) assert.match(f.call('POST',route,target,{ids:[1,id],...body}).error,/高中/,route+' '+id);
 assert.equal(f.snapshot(),before);
});
test('binding checks target video grade, course, section and tree and target section before any write',t=>{
 const f=fixture(t),before=f.snapshot();
 for(const id of [2,3,4,5]) assert.match(f.call('POST','/videos/:id/bind',id,{ids:[1]}).error,/高中/);
 assert.match(f.call('POST','/sections/:id/bind',2,{ids:[1]}).error,/高中/);
 assert.equal(f.snapshot(),before);
});
test('legacy PUT cannot erase original high-school relationships; create/edit reject new high-school video-tree links',t=>{
 const f=fixture(t),before=f.snapshot();
 for(const id of [2,3,4,5,6]) assert.match(f.call('PUT','/questions/:id',id,{...valid,video_id:0,section_id:0,chapter_id:0}).error,/高中/);
 for(const id of [2,3,4,5]) {
   assert.match(f.call('POST','/questions',0,{...valid,video_id:id}).error,/高中/);
   assert.match(f.call('PUT','/questions/:id',1,{...valid,video_id:id}).error,/高中/);
 }
 assert.equal(f.snapshot(),before);
});
test('video node replacement refuses both previous and proposed high-school scope, including clear-all',t=>{
 const f=fixture(t),before=f.snapshot();
 for(const id of [2,3,4,5])for(const node_ids of [[],[1]]) assert.match(f.call('POST','/videos/:id/nodes',id,{node_ids}).error,/高中/);
 assert.match(f.call('POST','/videos/:id/nodes',1,{node_ids:[1,2]}).error,/高中/);
 assert.equal(f.snapshot(),before);
});
test('junior question editing, binding, unbinding and node replacement remain available',t=>{
 const f=fixture(t);
 for(const [route,id,body] of [['/videos/:id/bind',1,{ids:[1]}],['/videos/:id/bind',0,{ids:[1],unbind:1}],['/sections/:id/bind',1,{ids:[1]}],['/sections/:id/bind',1,{ids:[1],unbind:1}],['/videos/:id/nodes',1,{node_ids:[]}],['/videos/:id/nodes',1,{node_ids:[1]}]]) assert.equal(f.call('POST',route,id,body).error,undefined);
 assert.equal(f.call('PUT','/questions/:id',1,valid).error,undefined);
 assert.equal(f.db.prepare('SELECT grade FROM questions WHERE id=1').get().grade,'八年级');
 assert.equal(f.db.prepare('SELECT my_answer FROM records').get().my_answer,'historical answer');
 assert.equal(f.db.prepare('SELECT detail FROM paper_tries').get().detail,'historical attempt');
});
test('video tree choices exclude high-school trees and refuse removed target videos',t=>{
 const f=fixture(t),before=f.snapshot();
 assert.deepEqual(Array.from(f.call('GET','/videos/:id/nodes',1).data.trees,t=>t.id),[1]);
 assert.match(f.call('GET','/videos/:id/nodes',4).error,/高中/);
 assert.equal(f.snapshot(),before);
});
