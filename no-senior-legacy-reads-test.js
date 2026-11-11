'use strict';
// Production handlers and SQL, synthetic memory database. No server or credentials.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Database=require('better-sqlite3');
const source=fs.readFileSync(path.join(__dirname,'src/app.js'),'utf8');
function slice(start,end) {const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b+end.length);}
function fixture(t) {
 const db=new Database(':memory:');t.after(()=>db.close());
 db.function('FIELD',{varargs:true},(value,...items)=>items.indexOf(value)+1);
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,grade TEXT,stage TEXT,term TEXT);
 INSERT INTO users VALUES(1,'初中学生','八年级','junior',''),(2,'旧未设年级学生','','primary','');
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,name TEXT,subject TEXT,grade TEXT,stage TEXT,category TEXT,term TEXT,book TEXT,code TEXT,sort INTEGER);
 CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT,sort INTEGER);
 CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,title TEXT,grade TEXT,duration INTEGER,sort INTEGER,level TEXT,file_path TEXT,url TEXT);
 CREATE TABLE handouts(id INTEGER PRIMARY KEY,chapter_id INTEGER,video_id INTEGER,section_id INTEGER,title TEXT,grade TEXT,file_name TEXT,ext TEXT,size INTEGER,download_count INTEGER DEFAULT 0,kind TEXT,level TEXT,file_path TEXT);
 CREATE TABLE questions(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,video_id INTEGER,type TEXT,grade TEXT,stage TEXT,stem TEXT,options TEXT,answer TEXT,analysis TEXT,difficulty INTEGER);
 CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,chapter_id INTEGER,my_answer TEXT,is_correct INTEGER,self_response_id INTEGER,created_at TEXT);
 CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,review_stage INTEGER,next_review TEXT,updated_at TEXT,UNIQUE(user_id,question_id));
 CREATE TABLE practices(id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id INTEGER,total INTEGER,correct INTEGER,duration INTEGER,created_at TEXT);
 CREATE TABLE progress(id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id INTEGER,video_id INTEGER,subject TEXT,category TEXT,video_done INTEGER,handout_done INTEGER,updated_at TEXT,UNIQUE(user_id,video_id));
 CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,self_correct INTEGER);
 CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
 CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,name TEXT,sort INTEGER);
 CREATE TABLE paper_uploads(question_id INTEGER,status TEXT,user_id INTEGER);`);
 const cases=[[1,'八年级','junior','物理'],[2,'','senior','历史学科'],[3,'高一','','历史学科'],[4,'高二','junior','历史学科'],[5,'八年级','junior','化学'],[6,'一年级','primary','数学']];
 for(const [id,grade,stage,subject] of cases) {
  db.prepare("INSERT INTO chapters VALUES(?,?,?,?,?,'同步基础','','','',0)").run(id,'课程'+id,subject,grade,stage);
  db.prepare('INSERT INTO sections VALUES(?,?,?,0)').run(id,id,'组'+id);
  db.prepare("INSERT INTO videos VALUES(?,?,?,?,'',1,0,'basic',?,'')").run(id,id,id,'视频'+id,'videos/'+id+'.mp4');
  db.prepare("INSERT INTO handouts(id,chapter_id,video_id,section_id,title,grade,file_name,ext,size,kind,level,file_path) VALUES(?,?,?,?,?,'',?,'pdf',1,'handout','basic',?)").run(id,id,id,id,'讲义'+id,'讲义'+id+'.pdf','handouts/'+id+'.pdf');
  db.prepare("INSERT INTO questions VALUES(?,?,?,?,'single',?,?,?,'[\"A\",\"B\"]','A','解析',1)").run(id,id,id,id,grade,stage,'题'+id);
  db.prepare("INSERT INTO mistakes VALUES(?,1,?,1,'B',0,0,'','2026-11-01')").run(id,id);
 }
 db.exec(`INSERT INTO videos VALUES(7,1,1,'混入高中视频','高三',1,0,'basic','videos/7.mp4','');
 INSERT INTO handouts(id,chapter_id,video_id,section_id,title,grade,file_name,ext,size,kind,level,file_path) VALUES(7,1,1,1,'混入高中讲义','高三','秘密.pdf','pdf',1,'handout','basic','handouts/7.pdf');
 INSERT INTO questions VALUES(7,1,1,1,'single','高三','junior','混入高中题','["A","B"]','A','秘密解析',1);
 INSERT INTO mistakes VALUES(7,1,7,1,'B',0,0,'','2026-11-01');`);
 // File-route authorization reads the persisted account role, like production.
 db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'");
 require('./school-scope-test-fixture')(db);
 let storage=0;const handlers={};
 const context={db,path,console,require:p=>require(path.resolve(__dirname,'src',p)),
  app:{get:(p,...f)=>handlers['GET '+p]=f.at(-1)},auth:()=>()=>{},verifyFileTicket:()=>false,careAudio:{protectFile:()=>false},
  accuracy:require('./src/accuracy'),stu:{get:(p,...f)=>handlers['GET '+p]=f.at(-1),post:(p,...f)=>handlers['POST '+p]=f.at(-1)},
  ok:(r,data)=>{r.data=data;r.code=0;},fail:(r,msg,code=1)=>{r.error=msg;r.code=code;},
  now:()=> '2026-11-11',publicUser:u=>u,parseQ:q=>({...q,options:JSON.parse(q.options||'[]')}),judge:()=>true,
  store:{isCloudKey:()=>true,localPath:k=>k,getUrl:async key=>{storage++;return '/api/file?key='+key;}},withFileTicket:u=>u};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const FILE_KEY_RE ='),source.indexOf('// ================================================================== 管理端',source.indexOf('const FILE_KEY_RE ='))),context);
 vm.runInContext(source.slice(source.indexOf('const PRIMARY_GRADES ='),source.indexOf('// 学生头像池')),context);
 for(const name of ['legacyScopeError','visibleChapterWhere','canSeeChapter','ensureChapterVisible','lessonsOf','groupsOf','nextLessonOf','courseAccOf','courseQuestionCountOf','setProgress']) vm.runInContext(slice('function '+name+'(','\n}'),context);
 for(const route of ['/home','/chapters','/courses','/course-detail','/handouts','/handouts/:id/download','/videos','/videos/:id/play','/practice','/mistakes']) vm.runInContext(slice(`stu.get('${route}',`,'\n});'),context);
 for(const route of ['/progress','/practice/submit','/mistakes/:qid/resolve']) vm.runInContext(slice(`stu.post('${route}',`,'\n});'),context);
 return {db,storage:()=>storage,snapshot:()=>JSON.stringify(['users','chapters','videos','handouts','questions','records','mistakes','practices','progress'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all())),
  async call(method,route,{query={},body={},id=1,uid=1}={}){const res={status(n){this.code=n;return this;},send(x){this.error=x;return this;},redirect(x){this.location=x;return this;}};await handlers[method+' '+route]({query,body,params:{id,qid:id},user:{id:uid,role:'student'},headers:{}},res);return res;}};
}
for(const route of ['/chapters','/courses']) test(route+' excludes historic high-school scopes even for unclassified users',async t=>{
 const f=fixture(t),before=f.snapshot();for(const uid of [1,2]){const r=await f.call('GET',route,{uid});const ids=Array.from(r.data,x=>x.id);assert.ok(ids.includes(1));for(const id of [2,3,4])assert.ok(!ids.includes(id),String(id));}assert.equal(f.snapshot(),before);
});
test('home subjects do not advertise subjects that exist only in high school',async t=>{const f=fixture(t);const r=await f.call('GET','/home');assert.ok(!r.data.subjects.includes('历史学科'));assert.ok(r.data.subjects.includes('物理'));assert.ok(r.data.subjects.includes('化学'));});
test('direct course IDs block senior stage, blank-stage grade, and conflicting junior/high-school grade',async t=>{
 const f=fixture(t),before=f.snapshot();for(const id of [2,3,4])assert.ok((await f.call('GET','/course-detail',{query:{id},uid:2})).error);assert.equal((await f.call('GET','/course-detail',{query:{id:1}})).data.id,1);assert.equal(f.snapshot(),before);
});
for(const route of ['/videos','/handouts']) test(route+' lists exclude high-school own grades and historical parent scopes',async t=>{const f=fixture(t),before=f.snapshot();const rows=(await f.call('GET',route,{uid:2})).data;assert.deepEqual(Array.from(rows,x=>x.id).sort(),[1,5,6]);assert.equal(f.snapshot(),before);});
for(const route of ['/videos/:id/play','/handouts/:id/download']) test(route+' denies old direct links without storage or progress effects',async t=>{const f=fixture(t),before=f.snapshot();for(const id of [2,3,4,7])assert.ok((await f.call('GET',route,{id,uid:2})).error);assert.equal(f.storage(),0);assert.equal(f.snapshot(),before);});
test('course details do not expose high-school media attached to a junior chapter',async t=>{const f=fixture(t),before=f.snapshot();const r=(await f.call('GET','/course-detail',{query:{id:1}})).data;assert.deepEqual(Array.from(r.lessons,x=>x.video_id),[1]);assert.ok(!JSON.stringify(r).includes('混入高中'));assert.equal(r.lessons[0].qcount,1);assert.equal(f.snapshot(),before);});
test('old progress IDs cannot mark unsupported videos as learned',async t=>{const f=fixture(t),before=f.snapshot();for(const id of [2,3,4,7])assert.ok((await f.call('POST','/progress',{body:{video_id:id,video_done:1},uid:2})).error);assert.equal(f.snapshot(),before);assert.equal((await f.call('POST','/progress',{body:{video_id:1,video_done:1}})).code,0);});
for(const query of [{},{mode:'mistake'}]) test('legacy practice excludes high-school questions '+JSON.stringify(query),async t=>{const f=fixture(t),before=f.snapshot();const rows=(await f.call('GET','/practice',{query:{...query,count:50},uid:query.mode==='mistake'?1:2})).data;assert.deepEqual(Array.from(rows,x=>x.id).sort(),[1,5,6]);assert.equal(f.snapshot(),before);});
test('legacy mistakes omit high-school answer and explanation without deleting history',async t=>{const f=fixture(t),before=f.snapshot();const rows=(await f.call('GET','/mistakes')).data.list;assert.deepEqual(Array.from(rows,x=>x.question_id).sort(),[1,5,6]);assert.equal(f.snapshot(),before);});
test('mixed legacy answer submission rejects before all writes, and high-school mistakes cannot be resolved',async t=>{const f=fixture(t),before=f.snapshot();assert.ok((await f.call('POST','/practice/submit',{body:{answers:[{question_id:1,my_answer:'A'},{question_id:7,my_answer:'A'}]}})).error);assert.ok((await f.call('POST','/mistakes/:qid/resolve',{id:7})).error);assert.equal(f.snapshot(),before);});

test('saved file proxy links cannot bypass high-school media guards',async t=>{const f=fixture(t),before=f.snapshot();for(const key of ['videos/2.mp4','handouts/2.pdf','videos/7.mp4','handouts/7.pdf'])assert.equal((await f.call('GET','/api/file',{query:{key}})).code,403);assert.equal(f.storage(),0);assert.equal(f.snapshot(),before);assert.ok((await f.call('GET','/api/file',{query:{key:'videos/1.mp4'}})).location);});

test('legacy practice and direct submission reject blank-scope questions assigned to high-school trees',async t=>{
 const f=fixture(t);require('./school-scope-test-fixture')(f.db);
 f.db.exec("INSERT INTO bank_trees(id,stage) VALUES(1,'senior'); INSERT INTO bank_tree_nodes(id,tree_id,name,sort) VALUES(1,1,'历史高中知识',0); INSERT INTO question_nodes VALUES(1,1);");
 const before=f.snapshot(),r=await f.call('GET','/practice',{query:{count:50}});assert.ok(!r.data.some(q=>q.id===1));
 assert.ok((await f.call('POST','/practice/submit',{body:{answers:[{question_id:1,my_answer:'A'}]}})).error);assert.equal(f.snapshot(),before);
});

test('junior course list counts only supported videos and handouts',async t=>{const f=fixture(t),row=(await f.call('GET','/courses')).data.find(c=>c.id===1);assert.equal(row.video_count,1);assert.equal(row.handout_count,1);assert.equal(row.question_count,1);});

function attachMediaTreeScope(f, stage) {
 f.db.exec("UPDATE chapters SET stage='',grade='' WHERE id=1; UPDATE videos SET grade='' WHERE id=1; DELETE FROM questions WHERE chapter_id=1; DELETE FROM videos WHERE id=7; DELETE FROM handouts WHERE id=7;");
 f.db.prepare('INSERT INTO bank_trees(id,stage) VALUES(1,?)').run(stage);
 f.db.exec("INSERT INTO bank_trees(id,stage) VALUES(2,'primary'),(3,'junior'); INSERT INTO bank_tree_nodes(id,tree_id,name,sort) VALUES(1,1,'目标树',0),(2,2,'小学知识',0),(3,3,'初中知识',0); INSERT INTO video_nodes VALUES(1,2),(1,1),(1,3);");
}
for(const stage of ['senior',' SENIOR ','高中']) test('blank-scope media linked to '+stage+' tree is denied in direct play, download and file URLs before any effects',async t=>{
 const f=fixture(t);attachMediaTreeScope(f,stage);const before=f.snapshot();
 for(const route of ['/videos/:id/play','/handouts/:id/download']) assert.equal((await f.call('GET',route,{id:1})).code,403);
 for(const key of ['videos/1.mp4','handouts/1.pdf']) assert.equal((await f.call('GET','/api/file',{query:{key}})).code,403);
 assert.ok((await f.call('POST','/progress',{body:{video_id:1,video_done:1}})).error);
 assert.equal(f.storage(),0);assert.equal(f.snapshot(),before);
});
test('high-school tree media and its handout are excluded from every student listing and course entry',async t=>{
 const f=fixture(t);attachMediaTreeScope(f,'senior');const before=f.snapshot();
 for(const route of ['/videos','/handouts','/courses']) assert.ok(!(await f.call('GET',route)).data.some(row=>row.id===1),route);
 const chapter=(await f.call('GET','/chapters')).data.find(row=>row.id===1);assert.equal(chapter.video_count,0);assert.equal(chapter.handout_count,0);
 assert.ok((await f.call('GET','/course-detail',{query:{id:1}})).error);assert.equal(f.snapshot(),before);
});
for(const stage of ['primary','junior','']) test('supported '+JSON.stringify(stage)+' and mixed primary/junior tree links retain media access',async t=>{
 const f=fixture(t);attachMediaTreeScope(f,stage);
 for(const route of ['/videos','/handouts','/courses']) assert.ok((await f.call('GET',route)).data.some(row=>row.id===1),route);
 assert.equal((await f.call('GET','/course-detail',{query:{id:1}})).data.lessons[0].video_id,1);
 assert.equal((await f.call('GET','/videos/:id/play',{id:1})).code,0);
 assert.equal((await f.call('GET','/handouts/:id/download',{id:1})).code,0);
 for(const key of ['videos/1.mp4','handouts/1.pdf']) assert.ok((await f.call('GET','/api/file',{query:{key}})).location);
});
