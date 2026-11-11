'use strict';
// Execute production route handlers and composition SQL on disposable memory data.
// Never load src/db, credentials, a server, or a real database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let openMemory;
try { const Database = require('better-sqlite3'); const probe = new Database(':memory:'); probe.close(); openMemory = () => new Database(':memory:'); }
catch (_) { const { DatabaseSync } = require('node:sqlite'); openMemory = () => new DatabaseSync(':memory:'); }
const compose = require('./src/compose');
const source = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b + end.length);
}
function fixture(t, practice = false) {
  const db = openMemory(); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status INTEGER,grade TEXT,stage TEXT,term TEXT,created_by INTEGER);
    INSERT INTO users VALUES(1,'student',1,'八年级','junior','',NULL);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,subject TEXT,stage TEXT,grade TEXT,type TEXT,answer TEXT,point TEXT);
    INSERT INTO questions VALUES(1,'物理','junior','八年级','single','A',''),(2,'物理','senior','高一','single','A',''),
      (3,'物理','','高二','single','A',''),(4,'化学','junior','九年级','single','A','');
    CREATE TABLE paper_uploads(question_id INTEGER,status TEXT,user_id INTEGER);
    CREATE TABLE papers(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,term TEXT,status TEXT,q_ids TEXT,published_at TEXT,due_at TEXT,duration INTEGER,total_score INTEGER);
    CREATE TABLE paper_assignments(paper_id INTEGER,user_id INTEGER);
    CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);
    CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,year TEXT,exam_category TEXT,edition TEXT,term TEXT,created_at TEXT,published INTEGER,status TEXT);
    CREATE TABLE mf_paper_questions(id INTEGER PRIMARY KEY,paper_id INTEGER,question_id INTEGER,kind TEXT,position INTEGER,score REAL);
    CREATE TABLE mf_paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);
    CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,kind TEXT,subject TEXT,stage TEXT,edition TEXT,name TEXT,sort INTEGER);
    CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER DEFAULT 0);
    CREATE TABLE bank_tree_node_mappings(chapter_node_id INTEGER,knowledge_node_id INTEGER);
    CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER);
    INSERT INTO bank_trees VALUES(1,'knowledge','物理','junior','','初中知识',0),(2,'knowledge','物理','senior','','高中知识',0);
    INSERT INTO bank_tree_nodes VALUES(1,1,NULL,'力学',0),(2,2,NULL,'高中力学',0);
    INSERT INTO question_nodes VALUES(1,1),(2,1),(3,1),(2,2);
    INSERT INTO paper_tries VALUES(1,1,2,1,1,100,'[]','2026-01-01');
    INSERT INTO mf_paper_tries VALUES(1,1,2,1,1,100,'[]','2026-01-01');`);
  const cases = [
    [1, 'junior', '八年级', [1]], [2, 'senior', '高一', [2]],
    [3, '', '高二', [3]], [4, '', '', [1, 2]], [5, 'junior', '九年级', [4]],
    [6, ' SENIOR ', '', [1]], [7, '', '高中三年级', [1]],
  ];
  for (const [id, stage, grade, ids] of cases) {
    const subject = id === 5 ? '化学' : '物理';
    db.prepare("INSERT INTO papers VALUES(?,?,?,?,?,'','published',?,'2026-01-01','',30,100)").run(id, '试卷'+id, subject, stage, grade, JSON.stringify(ids));
    db.prepare('INSERT INTO paper_assignments VALUES(?,1)').run(id);
    db.prepare("INSERT INTO mf_papers VALUES(?,?,?,?,?,'2026','final','','','',1,'published')").run(id, '试卷'+id, subject, stage, grade);
    ids.forEach((qid, index) => db.prepare("INSERT INTO mf_paper_questions(paper_id,question_id,kind,position,score) VALUES(?,?,'question',?,?)").run(id,qid,index,100/ids.length));
  }
  const handlers = {};
  const context = { db, compose, console,
    require: name => require(path.resolve(__dirname, 'src', name)),
    stu: { get: (route, fn) => handlers['GET '+route] = fn, post: (route, fn) => handlers['POST '+route] = fn },
    ok: (res, data) => { res.data=data; }, fail: (res, msg, code=1) => { res.error=msg; res.code=code; },
    serveQ: q => ({id:q.id}), parseIds: JSON.parse, presentAttempt: x=>x, roundScore:x=>x,
    paperHasAssignees: id => !!db.prepare('SELECT 1 FROM paper_assignments WHERE paper_id=?').get(id),
    verifyQuestionTicket:()=>true, pickTree:()=>null,
  };
  vm.createContext(context);
  vm.runInContext(slice('const stageOfGrade =', '\n};'), context);
  for (const route of ['/tasks','/papers','/papers/:id','/mfpapers/:id','/scan-tree']) vm.runInContext(slice(`stu.get('${route}',`, '\n});'), context);
  vm.runInContext(slice('const MFP_OPEN =', '\n});'), context);
  vm.runInContext(slice("stu.get('/mfpapers/filters',", '\n});'), context);
  vm.runInContext(slice("stu.post('/submit',", '\n});'), context);
  vm.runInContext(source.slice(source.indexOf('function scanScope('),source.indexOf('// ---------- 错题本',source.indexOf('function scanScope('))),context);
  const call = (method, route, {id=1,query={},body={}}={}) => {
    const res = { status(n){this.code=n;return this;},json(value){Object.assign(this,value);return this;} };
    handlers[method+' '+route]({user:{id:1,role:'student'},params:{id},query,body},res);
    return res;
  };
  const snapshot = () => JSON.stringify(['papers','questions','paper_tries','mf_papers','mf_paper_questions','mf_paper_tries'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  if (!practice) require('./school-scope-test-fixture')(db);
  return {db,call,snapshot,context,handlers};
}
for(const route of ['/tasks','/papers']) test(route+' hides assigned high-school and mixed papers but retains junior physics/chemistry',t=>{
  const f=fixture(t), before=f.snapshot();
  const r=f.call('GET',route); assert.deepEqual(Array.from(r.data,x=>x.id).sort(),[1,5]); assert.equal(f.snapshot(),before);
});
test('published library filters before limit, and filter choices exclude high-school grades',t=>{
  const f=fixture(t),before=f.snapshot();
  assert.deepEqual(Array.from(f.call('GET','/mfpapers',{query:{size:2}}).data,x=>x.id).sort(),[1,5]);
  const options=f.call('GET','/mfpapers/filters').data;
  assert.deepEqual(Array.from(options.grades).sort(),['九年级','八年级'].sort());
  assert.deepEqual(Array.from(options.subjects).sort(),['化学','物理']); assert.equal(f.snapshot(),before);
});
for(const route of ['/papers/:id','/mfpapers/:id']) test(route+' denies direct IDs of high-school and mixed papers without altering records',t=>{
  const f=fixture(t),before=f.snapshot();
  for(const id of [2,3,4,6,7]) assert.ok(f.call('GET',route,{id}).error,'paper '+id);
  assert.equal(f.call('GET',route,{id:1}).data.questions[0].id,1);
  assert.equal(f.call('GET',route,{id:5}).data.questions[0].id,4); assert.equal(f.snapshot(),before);
});
for(const kind of ['paper','mfpaper']) test(kind+' submission cannot bypass a removed paper via ID or omitted high-school answer',t=>{
  const f=fixture(t),before=f.snapshot();
  for(const id of [2,3,4,6,7]) {
    const r=f.call('POST','/submit',{body:{kind,paper_id:id,answers:[{question_id:1,my_answer:'A'}]}});
    assert.ok(r.error,'paper '+id);
  }
  assert.equal(f.snapshot(),before);
});
test('scan candidate SQL excludes blank-stage high-school grades before its limit',t=>{
  const f=fixture(t);
  for(let i=0;i<30;i++) {
    const plan=compose.planStudentScan(f.db,{ids:[1],kind:'knowledge',subject:'物理',stage:'junior'});
    assert.deepEqual(Array.from(plan.items,x=>x.row.id),[1]);
  }
  const before=f.snapshot();
  for(const route of ['/scan-count','/scan-compose']) assert.ok(f.call('POST',route,{body:{kind:'knowledge',subject:'物理',node_ids:[2]}}).error);
  assert.ok(f.call('GET','/scan-tree',{query:{subject:'物理',kind:'knowledge',tree_id:2}}).error);
  assert.equal(f.snapshot(),before);
});

test('composition core also refuses a directly supplied high-school stage', t => {
  const f = fixture(t);
  const plan = compose.planStudentScan(f.db, {ids:[2],kind:'knowledge',subject:'物理',stage:'senior'});
  assert.equal(plan.target_total,0); assert.equal(plan.items.length,0);
});

function practiceFixture(t) {
  const f=fixture(t, true), {db,context,handlers}=f;
  for(const column of ['stem TEXT','analysis TEXT',"options TEXT DEFAULT '[]'",'chapter_id INTEGER DEFAULT 1','video_id INTEGER DEFAULT 1','section_id INTEGER',"question_subtype TEXT DEFAULT ''","match_prompts TEXT DEFAULT '[]'","images TEXT DEFAULT '[]'","material TEXT DEFAULT ''",'difficulty INTEGER DEFAULT 1',"audio_key TEXT DEFAULT ''",'audio_play_limit INTEGER DEFAULT 0',"source TEXT DEFAULT ''"]) db.exec('ALTER TABLE questions ADD COLUMN '+column);
  db.exec(`UPDATE questions SET stem='content-'||id,analysis='explanation-'||id,point='力学';
    CREATE TABLE chapters(id INTEGER PRIMARY KEY,grade TEXT,stage TEXT,term TEXT,category TEXT,name TEXT);
    INSERT INTO chapters VALUES(1,'八年级','junior','','同步基础','初中课'),(2,'','senior','','同步基础','高中课');
    CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,title TEXT,sort INTEGER);
    INSERT INTO videos VALUES(1,1,1,'初中视频',0),(2,2,2,'高中视频',0);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT);
    INSERT INTO sections VALUES(1,1,'初中小分组'),(2,2,'高中小分组');
    CREATE TABLE handouts(id INTEGER PRIMARY KEY,section_id INTEGER,chapter_id INTEGER,video_id INTEGER);
    CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
    INSERT INTO video_nodes VALUES(1,1),(2,2);
    CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT,ai_point TEXT,UNIQUE(user_id,question_id));
    CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,chapter_id INTEGER,my_answer TEXT,is_correct INTEGER,match_correct INTEGER,match_total INTEGER,created_at TEXT);
    CREATE TABLE practices(id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id INTEGER,total INTEGER,correct INTEGER,duration INTEGER,created_at TEXT);
    CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,my_answer TEXT,score REAL,max_score REAL,review_comment TEXT,reviewed_at TEXT,created_at TEXT,drawing_data TEXT,self_correct INTEGER,try_id INTEGER);
    CREATE TABLE bank_feedback(user_id INTEGER,question_id INTEGER,reason TEXT,note TEXT,my_answer TEXT,status TEXT,created_at TEXT);
    ALTER TABLE paper_uploads ADD COLUMN id INTEGER;
    ALTER TABLE paper_uploads ADD COLUMN stage TEXT;
    ALTER TABLE paper_uploads ADD COLUMN grade TEXT;
    ALTER TABLE paper_uploads ADD COLUMN stem_text TEXT;
    ALTER TABLE paper_uploads ADD COLUMN created_at TEXT;
    INSERT INTO paper_uploads(question_id,status,user_id,id,stage,grade,stem_text,created_at) VALUES
      (1,'approved',1,1,'junior','八年级','upload-1','2026-01-01'),(2,'approved',1,2,'senior','高一','upload-2','2026-01-01'),(3,'approved',1,3,'','','upload-3','2026-01-01');`);
  for(const id of [1,2,3,4]) {
    db.prepare("INSERT INTO mistakes VALUES(?,1,?,1,'B',0,'2026-01-01',0,'','力学')").run(id,id);
    db.prepare("INSERT INTO records VALUES(?,1,?,1,'B',0,0,0,'2026-01-01')").run(id,id);
    db.prepare("INSERT INTO subjective_responses(id,user_id,question_id,kind,my_answer,created_at,drawing_data) VALUES(?,1,?,'self','written response','2026-01-01','drawing')").run(id,id);
  }
  db.exec('ALTER TABLE records ADD COLUMN self_response_id INTEGER');
  require('./school-scope-test-fixture')(db);
  let aiCalls=0;
  context.require=name=> {
    if(name==='./ai') return {chat:async()=>{aiCalls++;return {text:'{"steps":[{"ask":"hint","hint":"hint"}],"conclusion":"done"}'};},getConfig:()=>({mock:false})};
    if(name==='./ai-client') return {chatStream:async(options,delta)=>{aiCalls++;delta('Explanation');return {model:'synthetic',text:'Explanation'};}};
    return require(path.resolve(__dirname,'src',name));
  };
  Object.assign(context,{accuracy:require('./src/accuracy'),parseQ:q=>({...q,options:[]}),parseUp:q=>q,
    signQuestionTicket:(uid,qid)=>'test:'+uid+':'+qid,store:{getUrlSync:()=>''},
    QSubtype:require('./public/js/question-subtypes'),todayStr:()=> '2026-11-11',now:()=> '2026-11-11',addDays:()=> '2026-11-12',
    judgeQ:()=>true,matchScore:()=>null,isUngradedQ:()=>false,canSelfGradeQ:()=>false,
    decodeDrawing:()=>Buffer.from('image'),TYPE_NAMES:{single:'单选'},LETTERS:'ABCDEFGHIJ',
    REVIEW_STEPS:[2,4],AbortController,AI_EXPLAIN_SYS:'',AI_GUIDE_SYS:'',aiQuestionBrief:q=>q.stem});
  for(const [start,end] of [['function stuSeesChapter(','\n}'],['function sectionPracticeQs(','\n}']]) vm.runInContext(slice(start,end),context);
  for(const route of ['/lesson-questions','/section-questions','/node-mastery','/subjective-responses','/subjective-responses/:id/drawing','/mistakes','/mistakes/:id/similar','/mistake-count','/mistake-points','/review-queue','/uploads']) vm.runInContext(slice(`stu.get('${route}',`,'\n});'),context);
  for(const route of ['/check','/feedback','/ai-explain','/ai-explain/stream']) vm.runInContext(slice(`stu.post('${route}',`,'\n});'),context);
  const call=async(method,route,{id=1,query={},body={}}={})=>{
    const res={headers:{},output:'',status(n){this.code=n;return this;},json(value){Object.assign(this,value);return this;},setHeader(k,v){this.headers[k]=v;},type(){return this;},send(v){this.sent=v;return this;},on(){},write(s){this.output+=s;},end(){this.ended=true;}};
    await handlers[method+' '+route]({user:{id:1,role:'student'},params:{id},query,body},res);
    return res;
  };
  const snapshot=()=>JSON.stringify(['questions','mistakes','records','paper_tries','mf_paper_tries','subjective_responses'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all()));
  return {...f,call,snapshot,aiCalls:()=>aiCalls};
}
test('lesson/section practice filters high-school questions, and denies direct high-school course IDs',async t=>{
  const f=practiceFixture(t),before=f.snapshot();
  for(const [route,param] of [['/lesson-questions','video_id'],['/section-questions','section_id']]) {
    assert.deepEqual(Array.from((await f.call('GET',route,{query:{[param]:1}})).data.list,q=>q.id),[1,4]);
    assert.ok((await f.call('GET',route,{query:{[param]:2}})).error);
  }
  assert.equal(f.snapshot(),before);
});
test('mistakes, review, subjective history and uploads never expose removed question contents',async t=>{
  const f=practiceFixture(t),before=f.snapshot();
  for(const route of ['/mistakes','/review-queue','/subjective-responses','/uploads']) {
    const r=await f.call('GET',route); const ids=Array.from(r.data.list,x=>x.question_id || x.id);
    assert.ok(ids.includes(1),route); assert.ok(!ids.includes(2)&&!ids.includes(3),route);
  }
  assert.equal((await f.call('GET','/mistake-count')).data.pending,2);
  assert.equal((await f.call('GET','/mistake-points',{query:{subject:'物理'}})).data.groups[0].count,1);
  assert.ok((await f.call('GET','/subjective-responses/:id/drawing',{id:2})).error);
  assert.ok((await f.call('GET','/subjective-responses/:id/drawing',{id:1})).sent);
  assert.equal(f.aiCalls(),0); assert.equal(f.snapshot(),before);
});
test('knowledge mastery and similar practice reject high-school source IDs and candidates',async t=>{
  const f=practiceFixture(t),before=f.snapshot();
  const result=await f.call('GET','/node-mastery',{query:{node_id:1}});
  assert.deepEqual(Array.from(result.data.list,q=>q.id),[1,4]);
  assert.ok((await f.call('GET','/node-mastery',{query:{node_id:2}})).error);
  assert.ok((await f.call('GET','/mistakes/:id/similar',{id:2})).error);
  // Candidate metadata can disagree with the current student's stage.
  f.db.exec("DELETE FROM mistakes WHERE question_id<>1; DELETE FROM records WHERE question_id<>1; UPDATE questions SET stage='junior' WHERE id=3");
  const similar=await f.call('GET','/mistakes/:id/similar',{id:1});
  assert.ok(similar.error); // no supported unseen physics question remains
  assert.ok(!JSON.stringify(similar).includes('content-3'));
});
test('valid old tickets cannot check, explain or add feedback for high-school IDs',async t=>{
  const f=practiceFixture(t),before=f.snapshot();
  for(const route of ['/check','/ai-explain','/ai-explain/stream','/feedback']) {
    const body=route==='/check'?{items:[{question_id:1,quiz_ticket:'old',my_answer:'A'},{question_id:2,quiz_ticket:'old',my_answer:'A'}]}:{question_id:2,quiz_ticket:'old'};
    const result=await f.call('POST',route,{body}); assert.equal(result.code,403,route); assert.ok(result.error,route);
    assert.equal(result.headers['Content-Type'],undefined,route); assert.equal(result.output,'',route);
  }
  assert.equal(f.aiCalls(),0); assert.equal(f.snapshot(),before);
  assert.equal((await f.call('POST','/check',{body:{items:[{question_id:1,quiz_ticket:'old',my_answer:'A'}]}})).data.list.length,1);
});
for(const kind of ['practice','section','redo','review','self']) test(kind+' rejects a mixed high-school answer batch before any writes',async t=>{
  const f=practiceFixture(t),before=f.snapshot();
  const result=await f.call('POST','/submit',{body:{kind,video_id:1,section_id:1,answers:[{question_id:1,quiz_ticket:'old',my_answer:'A'},{question_id:3,quiz_ticket:'old',my_answer:'A'}]}});
  assert.equal(result.code,403); assert.ok(result.error); assert.equal(f.snapshot(),before);
});

test('ordinary paper create/edit/publish/assign deny high-school and mixed papers while withdrawal keeps history',async t=>{
  const f=practiceFixture(t),{context,handlers}=f;
  context.admin={post:(route,fn)=>handlers['ADMIN '+route]=fn,put:(route,fn)=>handlers['ADMIN PUT '+route]=fn};
  for(const route of ['/papers','/papers/:id/publish','/papers/:id/assign']) vm.runInContext(slice(`admin.post('${route}',`,'\n});'),context);
  vm.runInContext(slice("admin.put('/papers/:id',",'\n});'),context);
  const invoke=(route,id,body={})=>{const res={};handlers[route]({user:{id:99,role:'admin'},params:{id},body},res);return res;};
  const before=f.snapshot();
  for(const id of [2,3,4,6,7]) {
    assert.match(invoke('ADMIN /papers/:id/publish',id,{publish:1}).error,/高中/);
    assert.match(invoke('ADMIN /papers/:id/assign',id,{user_ids:[1]}).error,/高中/);
    assert.match(invoke('ADMIN PUT /papers/:id',id,{title:'changed'}).error,/高中/);
  }
  assert.match(invoke('ADMIN /papers',null,{title:'High school',stage:'senior',q_ids:[1]}).error,/高中/);
  assert.match(invoke('ADMIN /papers',null,{title:'Mixed',stage:'junior',q_ids:[1,2]}).error,/高中/);
  assert.equal(f.snapshot(),before);
  assert.equal(invoke('ADMIN /papers/:id/publish',2,{publish:0}).data.status,'draft');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM paper_tries WHERE paper_id=2').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM questions').get().n,4);
});
test('ordinary composition pool and random selection exclude high-school metadata before limits',t=>{
  const f=fixture(t);
  assert.equal(compose.poolCounts(f.db,{}).total,2);
  for(let i=0;i<20;i++) assert.deepEqual(compose.pickByCounts(f.db,{}, {single:10}).rows.map(q=>q.id).sort(),[1,4]);
});

for(const [name,link] of [
  ['question knowledge tree',"INSERT INTO question_nodes VALUES(1,2)"],
  ['direct course',"UPDATE questions SET chapter_id=2 WHERE id=1"],
  ['video course',"UPDATE questions SET video_id=2 WHERE id=1"],
  ['section course',"UPDATE questions SET section_id=2 WHERE id=1"],
  ['video grade',"UPDATE videos SET grade='高二' WHERE id=1"],
  ['video knowledge tree',"INSERT INTO video_nodes VALUES(1,2)"],
]) test('blank-scope legacy question inherits high-school exclusion from '+name,async t=>{
  const f=practiceFixture(t);
  f.db.exec("UPDATE questions SET stage='',grade='',chapter_id=NULL,video_id=NULL,section_id=NULL WHERE id=1; UPDATE questions SET video_id=1 WHERE id=1; UPDATE questions SET subject='物理',video_id=NULL WHERE id=4; INSERT INTO question_nodes VALUES(4,1)");
  // A junior tree link remains, too. Any proven high-school link wins.
  f.db.exec(link);
  const before=f.snapshot();
  assert.equal(compose.studentQuestionsAllowed(f.db,[1]),false);
  assert.equal(compose.studentQuestionsAllowed(f.db,[4]),true);
  assert.deepEqual(compose.pickByCounts(f.db,{}, {single:10}).rows.map(q=>q.id),[4]);
  assert.equal(compose.poolCounts(f.db,{}).total,1);
  assert.deepEqual(compose.planStudentScan(f.db,{ids:[1],kind:'knowledge',subject:'物理',stage:'junior'}).items.map(x=>x.row.id),[4]);
  for(const route of ['/papers/:id','/mfpapers/:id']) assert.ok((await f.call('GET',route,{id:1})).error,route);
  for(const route of ['/mistakes','/review-queue','/subjective-responses','/uploads']) {
    const r=await f.call('GET',route);assert.ok(!Array.from(r.data.list,x=>x.question_id||x.id).includes(1),route);
  }
  for(const route of ['/tasks','/papers','/mfpapers']) assert.ok(!Array.from((await f.call('GET',route)).data,x=>x.id).includes(1),route);
  assert.equal((await f.call('POST','/check',{body:{items:[{question_id:1,quiz_ticket:'old',my_answer:'A'}]}})).code,403);
  assert.equal((await f.call('POST','/submit',{body:{kind:'self',answers:[{question_id:1,quiz_ticket:'old',my_answer:'A'}]}})).code,403);
  assert.equal(f.snapshot(),before);
});
