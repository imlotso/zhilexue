'use strict';
// Actual bank/check, bank/submit and teacher grading against a disposable in-memory DB.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
let open;try {const Database=require('better-sqlite3');const p=new Database(':memory:');p.close();open=()=>new Database(':memory:');}
catch(_){const {DatabaseSync}=require('node:sqlite');open=()=>new DatabaseSync(':memory:');}
const bank=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
function fixture(t){
 const raw=open();t.after(()=>raw.close());
 raw.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER,grade TEXT,stage TEXT,term TEXT);
 INSERT INTO users VALUES(1,'student',10,'四年级','primary','上册'),(2,'student',10,'四年级','primary','上册');
 CREATE TABLE paper_uploads(question_id INTEGER,status TEXT,user_id INTEGER);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,type TEXT,subject TEXT,stem TEXT,answer TEXT,analysis TEXT,question_subtype TEXT,options TEXT DEFAULT '[]',material TEXT DEFAULT '',point TEXT DEFAULT '运算',images TEXT DEFAULT '[]',difficulty INTEGER DEFAULT 3,chapter_id INTEGER DEFAULT 10,video_id INTEGER DEFAULT 20,section_id INTEGER,stem_html TEXT DEFAULT '',match_prompts TEXT DEFAULT '[]',audio_key TEXT DEFAULT '',audio_play_limit INTEGER DEFAULT 0,source_detail TEXT DEFAULT '{}');
 INSERT INTO questions(id,type,subject,stem,answer,analysis,question_subtype) VALUES
 (1,'answer','数学','说明过程','参考过程','逐步分析',''),(2,'single','数学','选择','A','选择分析',''),
 (3,'fill','数学','未提供答案','','',''),(4,'answer','数学','未提供参考','','',''),
 (5,'fill','英语','Write about school','Example','写作说明','writing'),(6,'answer','数学','作图','[图1]','','drawing');
 CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,chapter_id INTEGER,my_answer TEXT,is_correct INTEGER,match_correct INTEGER,match_total INTEGER,created_at TEXT,self_response_id INTEGER);
 CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,my_answer TEXT,created_at TEXT,drawing_data TEXT,try_id INTEGER,max_score REAL,score REAL,review_comment TEXT,reviewed_at TEXT,reviewed_by INTEGER,self_correct INTEGER);
 CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT,UNIQUE(user_id,question_id));
 CREATE TABLE practices(id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id INTEGER,total INTEGER,correct INTEGER,duration INTEGER,created_at TEXT);
 CREATE TABLE papers(id INTEGER PRIMARY KEY,status TEXT,q_ids TEXT,grade TEXT,stage TEXT,term TEXT,due_at TEXT,total_score REAL,question_scores TEXT,question_partial_scores TEXT);
 INSERT INTO papers VALUES(1,'published','[1,2]','四年级','primary','上册','',100,'{"1":60,"2":40}','{}');
 CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER);
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);
 CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,published INTEGER,status TEXT);
 INSERT INTO mf_papers VALUES(1,1,'published');
 CREATE TABLE mf_paper_questions(paper_id INTEGER,question_id INTEGER,kind TEXT,score REAL,partial_score REAL);
 INSERT INTO mf_paper_questions VALUES(1,1,'question',60,NULL),(1,2,'question',40,NULL);
 CREATE TABLE mf_paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);
 CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,title TEXT);
 INSERT INTO videos VALUES(20,10,30,'讲解');
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,grade TEXT,stage TEXT,term TEXT,category TEXT);
 INSERT INTO chapters VALUES(10,'四年级','primary','上册','同步基础');
 CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT);
 INSERT INTO sections VALUES(30,10,'运算');
 CREATE TABLE handouts(id INTEGER PRIMARY KEY,section_id INTEGER,chapter_id INTEGER,video_id INTEGER);`);
 let beforeTransaction=null,inTransaction=false;const transactionReads=[];
 require('./school-scope-test-fixture')(raw);
 const db={prepare(sql){const statement=raw.prepare(sql.replace(/ FOR UPDATE\b/g,''));return {
  get(...args){if(inTransaction)transactionReads.push({sql,args});return statement.get(...args);},
  all:(...args)=>statement.all(...args),run:(...args)=>statement.run(...args)};},
  transaction:fn=>(...args)=>{const interleave=beforeTransaction;beforeTransaction=null;if(interleave)interleave(raw);raw.exec('BEGIN');inTransaction=true;
   try{const v=fn(...args);raw.exec('COMMIT');return v;}catch(e){raw.exec('ROLLBACK');throw e;}finally{inTransaction=false;}}};
 const handlers={};const router=prefix=>Object.fromEntries(['post','get'].map(m=>[m,(p,fn)=>handlers[prefix+p]=fn]));
 const localRequire=n=>require(path.resolve(__dirname,'src',n));
 const box={db,crypto,Buffer,ticketEpoch:require('./src/ticket-epoch'),upSecret:()=> 'isolated-self-grade-fixture-key',require:localRequire,
  stu:router(''),admin:router('admin'),ok:(r,data)=>r.body={code:0,data},fail:(r,msg,code=1)=>r.body={code,msg},
  verifyQuestionTicket:(uid,qid,ticket)=>ticket===`fixture:${uid}:${qid}`,now:()=> '2026-11-09 08:00:00',todayStr:()=> '2026-11-09',addDays:()=> '2026-11-10',REVIEW_STEPS:[2,4],
  stageOfGrade:s=>s,paperHasAssignees:()=>false,parseIds:s=>JSON.parse(s||'[]'),paperScores:s=>s?JSON.parse(s):null,roundScore:n=>Math.round(n*100)/100,num:(v,d=0)=>Number(v)||d,
  parseQ:q=>({...q,options:JSON.parse(q.options||'[]')}),presentAttempt:require('./src/paper-attempt').presentAttempt,
  ...require('./src/bank-judge'),decodeDrawing:require('./src/drawing-answer').decodeDrawing,accuracy:require('./src/accuracy')};
 vm.createContext(box);
 vm.runInContext(bank.slice(bank.indexOf('const isUngradedQ'),bank.indexOf("const kbtree =")),box);
 for(const route of ['/check','/submit']){const a=bank.indexOf(`stu.post('${route}',`),b=bank.indexOf('\n});',a);vm.runInContext(bank.slice(a,b+4),box);}
 const reports=fs.readFileSync(path.join(__dirname,'src/reports.js'),'utf8');const a=reports.indexOf("admin.post('/subjective/:id/grade',"),b=reports.indexOf('\n});',a);vm.runInContext(reports.slice(a,b+4),box);
 const call=(route,body={},uid=1,params={})=>{const r={status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};handlers[route]({body,user:{id:uid,role:route.startsWith('admin')?'admin':'student'},params},r);return r;};
 const answer=(qid=1,my='我的独立解答',uid=1)=>({question_id:qid,quiz_ticket:`fixture:${uid}:${qid}`,my_answer:my});
 const checked=(a=answer(),uid=1)=>call('/check',{items:[a]},uid).body.data.list[0];
 const self=(value,a=answer(),uid=1)=>({...a,self_correct:value,self_grade_ticket:checked(a,uid).self_grade_ticket});
 return {raw,call,answer,checked,self,transactionReads,beforeTransaction(fn){beforeTransaction=fn;}};
}
test('submitted constructed response receives an answer-bound self-evaluation ticket without writes',t=>{
 const f=fixture(t);const r=f.checked();assert.equal(r.self_grade_allowed,true);assert.ok(r.self_grade_ticket);assert.equal(r.ungraded,true);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM subjective_responses').get().n,0);
});
test('final selected false/true persists to study report, mistakes and latest mastery',t=>{
 const f=fixture(t);const bad=f.self(false);let r=f.call('/submit',{kind:'self',answers:[bad,bad]}).body;
 assert.equal(r.code,0);assert.equal(r.data.wrong,1);assert.equal(r.data.list[0].self_graded,true);assert.equal(r.data.list[0].is_correct,false);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,1);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records r JOIN subjective_responses sr ON sr.id=r.self_response_id WHERE r.user_id=sr.user_id AND r.question_id=sr.question_id AND r.is_correct=sr.self_correct').get().n,1);assert.equal(f.raw.prepare('SELECT self_correct FROM subjective_responses').get().self_correct,0);
 assert.equal(f.raw.prepare('SELECT wrong_count FROM mistakes').get().wrong_count,1);
 const good=f.self(true);r=f.call('/submit',{kind:'practice',video_id:20,answers:[good]}).body;
 assert.equal(r.code,0);assert.equal(r.data.correct,1);assert.equal(r.data.by_point[0].correct,1);assert.equal(r.data.mastery.video.answered,1);assert.equal(r.data.mastery.video.correct,1);
 assert.equal(f.raw.prepare('SELECT resolved FROM mistakes').get().resolved,1);assert.equal(f.raw.prepare('SELECT self_correct FROM subjective_responses ORDER BY id DESC').get().self_correct,1);
});
test('objective, missing-reference and drawing questions cannot obtain self-evaluation tickets',t=>{
 const f=fixture(t);for(const id of [2,3,4]){const r=f.checked(f.answer(id));assert.ok(!r.self_grade_allowed);assert.ok(!r.self_grade_ticket);}
 assert.equal(f.checked(f.answer(5,'My school')).self_grade_allowed,true);
 assert.ok(!f.checked(f.answer(1,'   ')).self_grade_allowed);
});
test('forged, stale, cross-question/user and non-boolean choices fail atomically',t=>{
 const f=fixture(t),valid=f.self(true);
 const invalid=[{...valid,self_grade_ticket:'forged'},{...valid,my_answer:'改过的答案'},{...valid,question_id:2,quiz_ticket:'fixture:1:2'},
  {...valid,self_correct:'true'},{...valid,self_correct:1},{...valid,self_correct:null},{...valid,quiz_ticket:'unseen'}];
 for(const bad of invalid){const r=f.call('/submit',{kind:'self',answers:[f.answer(2,'A'),bad]});assert.notEqual(r.body.code,0,JSON.stringify(bad));}
 assert.notEqual(f.call('/submit',{kind:'self',answers:[{...valid,quiz_ticket:'fixture:2:1'}]},2).body.code,0);
 f.raw.prepare("UPDATE questions SET answer='已修订参考答案' WHERE id=1").run();assert.notEqual(f.call('/submit',{kind:'self',answers:[valid]}).body.code,0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM subjective_responses').get().n,0);
});
test('unseen checks and a later quarantine never authorize self-evaluation',t=>{
 const f=fixture(t);assert.equal(f.call('/check',{items:[{...f.answer(),quiz_ticket:'unseen'}]}).statusCode,403);
 const a=f.self(true);f.raw.exec("INSERT INTO paper_uploads VALUES(1,'pending',1)");assert.notEqual(f.call('/submit',{kind:'self',answers:[a]}).body.code,0);
});
for(const kind of ['paper','mfpaper'])test(kind+' self-evaluation stays separate from pending and subsequent teacher grade',t=>{
 const f=fixture(t);const response=f.call('/submit',{kind,paper_id:1,answers:[f.self(false),f.answer(2,'A')]}).body;
 assert.equal(response.code,0);const r=response.data;assert.equal(r.correct,1);assert.equal(r.wrong,1);assert.equal(r.score,null);assert.equal(r.pending_manual_count,1);assert.equal(r.objective_score,40);assert.equal(r.objective_score_total,40);
 const row=f.raw.prepare('SELECT * FROM subjective_responses').get();assert.equal(row.self_correct,0);assert.equal(row.score,null);assert.equal(row.max_score,60);
 const table=kind==='paper'?'paper_tries':'mf_paper_tries';let attempt=f.raw.prepare('SELECT * FROM '+table).get();let detail=JSON.parse(attempt.detail);
 assert.equal(attempt.total,1);assert.equal(attempt.correct,1);assert.equal(detail.length,2);assert.equal(detail.find(x=>x.question_id===1).ungraded,true);assert.equal(detail.find(x=>x.question_id===1).self_correct,0);
 const graded=f.call('admin/subjective/:id/grade',{score:45,comment:'老师批阅'},10,{id:row.id}).body;
 assert.equal(graded.code,0);assert.equal(graded.data.final_score,85);assert.equal(f.raw.prepare('SELECT self_correct FROM subjective_responses').get().self_correct,0);
 detail=JSON.parse(f.raw.prepare('SELECT detail FROM '+table).get().detail);assert.equal(detail.find(x=>x.question_id===1).self_correct,0);assert.equal(detail.find(x=>x.question_id===1).manual_graded,true);
});
test('no self choice preserves legacy ungraded and blank-objective contracts',t=>{
 const f=fixture(t);const r=f.call('/submit',{kind:'self',answers:[f.answer(1),f.answer(3)]}).body.data;
 assert.equal(r.ungraded_count,2);assert.equal(r.total,0);assert.equal(r.wrong,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,0);
 assert.ok(f.raw.prepare('SELECT self_correct FROM subjective_responses').all().every(x=>x.self_correct===null));
});
test('scan report uses the actual selected leaf rather than unrelated free-text question tags',t=>{
 const f=fixture(t);f.raw.exec(`ALTER TABLE bank_trees ADD COLUMN subject TEXT; ALTER TABLE bank_trees ADD COLUMN kind TEXT; ALTER TABLE bank_tree_nodes ADD COLUMN name TEXT; ALTER TABLE bank_tree_nodes ADD COLUMN parent_id INTEGER;
 INSERT INTO bank_trees(id,subject,stage,kind) VALUES(1,'数学','primary','knowledge'),(2,'英语','primary','knowledge');INSERT INTO bank_tree_nodes VALUES(101,1,'小数加法',NULL),(201,2,'English',NULL);INSERT INTO question_nodes VALUES(1,101),(1,201);`);
 const r=f.call('/submit',{kind:'self',answers:[{...f.self(false),point_node_id:101}]}).body;
 assert.equal(r.code,0);assert.equal(r.data.by_point[0].point,'小数加法');assert.equal(r.data.list[0].point,'小数加法');
 for(const point_node_id of [9999,201])assert.notEqual(f.call('/submit',{kind:'self',answers:[{...f.self(true),point_node_id}]}).body.code,0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,1);
});

// These edits occur after /check, without changing the student's answer or the reference answer.
// The prior implementation bound only type/answer/analysis/images and wrongly accepted them.
const displayedQuestionEdits = [
 ['stem','另一道证明题'], ['stem_html','<p>换成另一组条件</p>'], ['material','新的材料与约束'],
 ['options','["新条件甲","新条件乙"]'], ['match_prompts','["新连线条件"]'],
 ['audio_key','bank/audio/new-question.mp3'], ['audio_play_limit',1],
 ['source_detail','{"question_image_public":[1],"question_image_public_basis":"new"}'],
];
for(const [field,value] of displayedQuestionEdits)test('self-evaluation rejects a changed question snapshot: '+field,t=>{
 const f=fixture(t),choice=f.self(true);f.raw.prepare(`UPDATE questions SET ${field}=? WHERE id=1`).run(value);
 const r=f.call('/submit',{kind:'paper',paper_id:1,answers:[f.answer(2,'A'),choice]}).body;
 assert.equal(r.code,403);assert.match(r.msg,/自评/);
 for(const table of ['records','subjective_responses','mistakes','paper_tries'])assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
});
for(const kind of ['paper','mfpaper','self'])for(const [label,sql] of [
 ['type',"UPDATE questions SET type='single',answer='B' WHERE id=1"],
 ['answer',"UPDATE questions SET answer='新参考答案' WHERE id=1"],
 ['analysis',"UPDATE questions SET analysis='新解析' WHERE id=1"],
 ['stem',"UPDATE questions SET stem='另一道证明题' WHERE id=1"],
 ['material',"UPDATE questions SET material='新的条件' WHERE id=1"],
 ['deleted question','DELETE FROM questions WHERE id=1'],
])test(kind+' rejects '+label+' edited between preflight and transaction and rolls back earlier answers',t=>{
 const f=fixture(t),choice=f.self(true);let changed=false;
 f.beforeTransaction(raw=>{raw.exec(sql);changed=true;});
 const r=f.call('/submit',{kind,paper_id:1,answers:[f.answer(2,'A'),choice]}).body;
 assert.equal(changed,true,'interleaving must happen after preflight and before BEGIN');
 assert.equal(r.code,403);assert.match(r.msg,/自评/);
 assert.ok(f.transactionReads.some(r=>/FROM questions WHERE id=\? FOR UPDATE/.test(r.sql)&&r.args[0]===1),'verify the current question under a row lock');
 for(const table of ['records','subjective_responses','mistakes','practices','paper_tries','mf_paper_tries'])assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table+' must be rolled back');
});
test('unchanged self-evaluation verifies the locked question inside the write transaction',t=>{
 const f=fixture(t),choice=f.self(false);const r=f.call('/submit',{kind:'paper',paper_id:1,answers:[f.answer(2,'A'),choice]}).body;
 assert.equal(r.code,0);assert.equal(r.data.self_graded_count,1);
 assert.ok(f.transactionReads.some(r=>/FROM questions WHERE id=\? FOR UPDATE/.test(r.sql)&&r.args[0]===1));
});

test('a constructed response with an explanation-only reference can be self-assessed without becoming a teacher grade',t=>{
 const f=fixture(t);f.raw.exec("UPDATE questions SET answer='',analysis='按顺序先计算括号，再给出推导过程。' WHERE id=1");
 const checked=f.checked();assert.equal(checked.self_grade_allowed,true);assert.match(checked.analysis,/推导/);
 const r=f.call('/submit',{kind:'paper',paper_id:1,answers:[{...f.answer(),self_correct:true,self_grade_ticket:checked.self_grade_ticket},f.answer(2,'A')]}).body;
 assert.equal(r.code,0);assert.equal(r.data.list.find(x=>x.question_id===1).self_graded,true);assert.equal(r.data.score,null);assert.equal(r.data.pending_manual_count,1);
});
