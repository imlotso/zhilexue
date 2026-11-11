'use strict';
// Actual handlers, synthetic SQLite only. Never boot the app, network or src/db.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
// Use the locked project dependency so the same real-SQL checks run on Node 20 and 24.
const Database = require('better-sqlite3');
const root = process.env.QUARANTINE_SOURCE || __dirname;
const sources = Object.fromEntries(['bank','app','mistake-docx'].map(n=>[n,fs.readFileSync(path.join(root,'src',n+'.js'),'utf8')]));
function extract(file, start, end='\n});') {
 const s=sources[file], a=s.indexOf(start), b=s.indexOf(end,a);
 assert.ok(a>=0&&b>a,start); return s.slice(a,b+end.length);
}
function fixture(t) {
 const db = new Database(':memory:'); t.after(()=>db.close());
 db.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER,grade TEXT,term TEXT,stage TEXT);
 INSERT INTO users VALUES(1,'student',10,'四年级','上册','primary');
 CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,status TEXT);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,type TEXT,stem TEXT,answer TEXT,options TEXT,chapter_id INTEGER,video_id INTEGER,section_id INTEGER,subject TEXT,stage TEXT,point TEXT,question_subtype TEXT,match_prompts TEXT,analysis TEXT,material TEXT,difficulty INTEGER,images TEXT,audio_key TEXT,audio_play_limit INTEGER,source TEXT);
 CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,title TEXT,sort INTEGER);
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,grade TEXT,term TEXT,stage TEXT,category TEXT,name TEXT);
 CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT);
 INSERT INTO chapters VALUES(1,'四年级','上册','primary','同步基础','课程');
 INSERT INTO sections VALUES(1,1,'小组');
 INSERT INTO videos VALUES(1,1,1,'课',1);
 CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT,ai_point TEXT);
 CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,my_answer TEXT,is_correct INTEGER,created_at TEXT);
 CREATE TABLE papers(id INTEGER PRIMARY KEY,status TEXT,q_ids TEXT,grade TEXT,term TEXT,stage TEXT,due_at TEXT);
 CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER);
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);
 INSERT INTO papers VALUES(1,'published','[1,3]','','','','');
 CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,published INTEGER,status TEXT);
 INSERT INTO mf_papers VALUES(1,1,'published');
 CREATE TABLE mf_paper_questions(paper_id INTEGER,question_id INTEGER,kind TEXT,position INTEGER,id INTEGER,score INTEGER);
 INSERT INTO mf_paper_questions VALUES(1,1,'question',1,1,50),(1,3,'question',2,2,50);
 CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,kind TEXT,subject TEXT,stage TEXT);
 CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER DEFAULT 0);
 CREATE TABLE bank_tree_node_mappings(chapter_node_id INTEGER,knowledge_node_id INTEGER);
 CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER);
 CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
 CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,my_answer TEXT,score INTEGER,max_score INTEGER,review_comment TEXT,reviewed_at TEXT,created_at TEXT,drawing_data TEXT,self_correct INTEGER);
 INSERT INTO subjective_responses VALUES(1,1,1,'self',0,'secret',NULL,1,'','','','image',NULL);
 `);
 for(let id=1;id<=4;id++){
 db.prepare("INSERT INTO questions VALUES(?,'single',?,'A','[]',1,1,1,'数学','primary','加法','','[]','解析','',1,'[]','',0,'manual')").run(id,'stem-'+id);
 db.prepare("INSERT INTO mistakes VALUES(?,1,?,1,'B',0,'2026-01-01',0,'','')").run(id,id);
 }
 db.exec("INSERT INTO paper_uploads VALUES(1,1,1,'pending'),(2,1,2,'reviewed'),(3,1,3,'approved');");
 db.exec("ALTER TABLE questions ADD COLUMN grade TEXT DEFAULT ''; ALTER TABLE videos ADD COLUMN grade TEXT DEFAULT ''");
 require('./school-scope-test-fixture')(db);
 let tickets=[],writes=[];
 const wrapped={prepare(sql){const s=db.prepare(sql); return {get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>{writes.push(sql);return s.run(...a);}}},transaction:fn=>fn};
 const routes={};
 const box={db:wrapped,stu:{get:(p,f)=>routes['GET '+p]=f,post:(p,f)=>routes['POST '+p]=f},
 require:p=>{if(p==='./qmeta')return require('./src/qmeta'); if(p==='./compose')return require('./src/compose'); if(p==='./school-scope')return require('./src/school-scope'); if(p==='./question-images')return {solutionImages:()=>[]};throw Error('unexpected dependency '+p);},
 ok:(r,data)=>r.data=data,fail:(r,msg,status)=>{r.error=msg;r.statusCode=status;},
 now:()=> '2026-01-01',todayStr:()=> '2026-01-01',stageOfGrade:()=> 'primary',
 parseIds:JSON.parse,parseQ:q=>({...q,options:[]}),presentAttempt:x=>x,
 serveQ:q=>{tickets.push(q.id);return {id:q.id,stem:q.stem,quiz_ticket:'ticket'};},
 signQuestionTicket:(uid,qid)=>{tickets.push(qid);return 'ticket';},verifyQuestionTicket:()=>true,
 stuSeesChapter:()=>true,ensureChapterVisible:()=>true,
 accuracy:{SEC_EXPR:'v.section_id'},store:{getUrlSync:()=>''},
 QSubtype:{compatible:()=>'',isMatch:()=>false},judgeQ:()=>true,matchScore:()=>null,isUngradedQ:()=>false,
 paperHasAssignees:()=>false,roundScore:x=>x,scanScope:()=>({ids:[1],treeIds:[1],subject:'数学',kind:'knowledge',stage:'primary'}),
 compose:require('./src/compose'),
 };
 function load(file,method,route){
 vm.runInNewContext(extract(file,`stu.${method}('${route}',`),box);
 return async(body={},query={},params={})=>{
 const res={status(n){this.statusCode=n;return this;},json(data){this.jsonBody=data;return this;},send(data){this.sent=data;},setHeader(){},type(){}};
 await routes[method.toUpperCase()+' '+route]({user:{id:1,role:'student'},body,query,params},res);return res;
 };
 }
 vm.runInNewContext(extract('app','function legacyScopeError(','\n}'),box);
 vm.runInNewContext(extract('bank','function sectionPracticeQs(','\n}'),box);
 return {db,box,load,tickets,writes};
}
for(const [file,route,query] of [['bank','/lesson-questions',{video_id:1}],['bank','/section-questions',{section_id:1}],['bank','/review-queue',{}],['app','/practice',{}],['app','/practice',{mode:'mistake'}]]){
 test(file+' '+route+' filters unreviewed before issuing tickets',async t=>{
 const f=fixture(t), r=await f.load(file,'get',route)({},query);
 assert.equal(r.error,undefined); const list=Array.isArray(r.data)?r.data:r.data.list;
 assert.deepEqual(Array.from(list,x=>x.id).sort(),[3,4]); assert.ok(!f.tickets.includes(1)&&!f.tickets.includes(2));
 });
}
for(const route of ['/papers/:id','/mfpapers/:id'])test(route+' rejects entire existing mixed paper',async t=>{
 const f=fixture(t),r=await f.load('bank','get',route)({}, {}, {id:1});assert.match(r.error,/审核/);assert.equal(f.tickets.length,0);
});
for(const kind of ['paper','mfpaper','practice','section','self','redo','review'])test('submit '+kind+' rejects old tickets before writes',async t=>{
 const f=fixture(t),r=await f.load('bank','post','/submit')({kind,paper_id:1,video_id:1,section_id:1,answers:[{question_id:1,quiz_ticket:'old'}]});
 assert.match(r.error,/审核/);assert.equal(f.writes.length,0);
});
for(const kind of ['paper','mfpaper'])test(kind+' rejects unreviewed omitted from answers',async t=>{
 const f=fixture(t),r=await f.load('bank','post','/submit')({kind,paper_id:1,answers:[{question_id:3}]});
 assert.match(r.error,/审核/);assert.equal(f.writes.length,0);
});
for(const ids of [[3,1],[1,3]])test('mixed approved/pending answers '+ids.join(',')+' reject the whole submission before writes',async t=>{
 const f=fixture(t),r=await f.load('bank','post','/submit')({kind:'practice',answers:ids.map(question_id=>({question_id,quiz_ticket:'old',my_answer:'A'}))});
 assert.match(r.error,/审核/);assert.equal(f.writes.length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM records').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM paper_tries').get().n,0);
});
for(const route of ['/check','/ai-explain','/ai-explain/stream','/feedback'])test(route+' denies old ticket and never invokes AI',async t=>{
 const f=fixture(t),r=await f.load('bank','post',route)({question_id:1,quiz_ticket:'old',items:[{question_id:1,quiz_ticket:'old'}]});
 assert.match(r.error,/审核/);assert.equal(f.writes.length,0);
});
test('legacy submit and resolve reject pending',async t=>{
 const f=fixture(t);
 assert.match((await f.load('app','post','/practice/submit')({answers:[{question_id:2}]})).error,/审核/);
 assert.match((await f.load('app','post','/mistakes/:qid/resolve')({}, {}, {qid:2})).error,/审核/);
 assert.equal(f.writes.length,0);
});
for(const file of ['app','bank'])test(file+' mistakes exclude private rows and tickets',async t=>{
 const f=fixture(t),r=await f.load(file,'get','/mistakes')();
 assert.deepEqual(Array.from(r.data.list,x=>x.question_id),[3,4]);assert.ok(!f.tickets.includes(1)&&!f.tickets.includes(2));
});
test('review count excludes quarantined personal mistakes',async t=>{
 const f=fixture(t);assert.equal((await f.load('bank','get','/mistake-count')()).data.pending,2);
});
test('mistake points never forwards pending stem to AI',async t=>{
 const f=fixture(t); const r=await f.load('bank','get','/mistake-points')();assert.deepEqual(Array.from(r.data.groups[0].ids),[3,4]);
});
test('subjective history and drawing cannot expose pending',async t=>{
 const f=fixture(t);assert.equal((await f.load('bank','get','/subjective-responses')()).data.list.length,0);
 assert.match((await f.load('bank','get','/subjective-responses/:id/drawing')({}, {}, {id:1})).error,/审核/);
});
function seedScan(f) {
 f.db.exec("INSERT INTO bank_trees VALUES(1,'knowledge','数学','primary'); INSERT INTO bank_tree_nodes(id,tree_id,parent_id,name) VALUES(1,1,NULL,'运算'),(11,1,1,'第一点'),(12,1,1,'第二点'),(13,1,1,'第三点'),(14,1,1,'第四点'); INSERT INTO question_nodes VALUES(1,11),(2,12),(3,13),(4,14);");
}
test('student scan counts all real points but pending questions never receive tickets',async t=>{
 const f=fixture(t);seedScan(f);const count=(await f.load('bank','post','/scan-count')()).data;
 assert.equal(count.total,2);assert.equal(count.target_total,4);assert.equal(count.missing.length,2);
 const r=await f.load('bank','post','/scan-compose')();assert.equal(r.error,undefined);
 assert.deepEqual(Array.from(r.data.items,x=>x.question.id).sort(),[3,4]);assert.deepEqual(f.tickets.sort(),[3,4]);
 assert.deepEqual(Array.from(r.data.missing,x=>x.node_id).sort(),[11,12]);assert.ok(!JSON.stringify(r.data).includes('stem-1'));
});
test('approved and unrelated shared questions still pass check',async t=>{
 const f=fixture(t),r=await f.load('bank','post','/check')({items:[{question_id:3},{question_id:4}]});
 assert.equal(r.error,undefined);assert.equal(r.data.list?.length || r.data.length,2);
});
test('student export filters rows; teacher export remains unchanged',t=>{
 const f=fixture(t);
 vm.runInNewContext(extract('mistake-docx','function collectMistakes(','\n}'),f.box);
 const student=f.box.collectMistakes(f.db,1,{studentOnlyReviewed:true});
 assert.deepEqual(Array.from(student,x=>x.question_id),[3,4]);
 assert.equal(f.box.collectMistakes(f.db,1).length,4);
});
test('review state is checked afresh, not source or previous ticket',async t=>{
 const f=fixture(t),call=f.load('bank','post','/check');
 f.db.exec("UPDATE paper_uploads SET status='approved' WHERE question_id=1");
 assert.equal((await call({items:[{question_id:1}]})).error,undefined);
 f.db.exec("UPDATE paper_uploads SET status='reviewed' WHERE question_id=1");
 assert.match((await call({items:[{question_id:1}]})).error,/审核/);
});
test('similar questions cannot start from pending and never suggest pending candidates',async t=>{
 const f=fixture(t),call=f.load('bank','get','/mistakes/:id/similar');
 assert.ok((await call({}, {}, {id:1})).error);
 f.db.exec('DELETE FROM mistakes WHERE question_id<>3');
 const r=await call({}, {}, {id:3});
 assert.deepEqual(Array.from(r.data.list,x=>x.id),[4]);
});
test('node mastery excludes pending historical answers and stems',async t=>{
 const f=fixture(t);
 f.db.exec("INSERT INTO bank_trees VALUES(1,'knowledge','数学','primary'); INSERT INTO bank_tree_nodes(id,tree_id,parent_id,name) VALUES(1,1,NULL,'加法'); INSERT INTO question_nodes VALUES(1,1),(2,1),(3,1),(4,1); INSERT INTO records VALUES(1,1,1,'B',0,'2026-01-01'),(2,1,3,'A',1,'2026-01-01');");
 f.box.accuracy.lastAnswers=require('./src/accuracy').lastAnswers;
 const r=await f.load('bank','get','/node-mastery')({}, {node_id:1});
 assert.equal(r.data.total,2);assert.deepEqual(Array.from(r.data.list,x=>x.id),[3]);
});
test('legacy count request still covers reviewed points and reports quarantined shortages',async t=>{
 const f=fixture(t);seedScan(f);const r=await f.load('bank','post','/scan-compose')({count:5});
 assert.equal(r.error,undefined);assert.equal(r.data.target_total,4);assert.equal(r.data.total,2);assert.equal(r.data.missing.length,2);
 assert.deepEqual(f.tickets.sort(),[3,4]);
});
test('student export policy is supplied by server, never a query override',()=>{
 assert.match(extract('app',"stu.get('/mistakes/export-docx',"),/sendMistakeDocx\(db, res, me, req.query, \{ studentOnlyReviewed: true \}\)/);
 assert.match(extract('mistake-docx','async function sendMistakeDocx(','\n}'),/studentOnlyReviewed: access.studentOnlyReviewed === true/);
});
