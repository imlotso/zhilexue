'use strict';
// Real bank handlers and SQL transactions in a new SQLite :memory: database.
// Synthetic users only; never loads src/db, boots the app or uses credentials/network.
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
const source=fs.readFileSync(path.join(__dirname, 'src/bank.js'),'utf8');
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
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score INTEGER,detail TEXT,created_at TEXT,total_score_snapshot REAL);
 INSERT INTO users VALUES(1,'admin',1,NULL,'principal','','','','',NULL),(10,'branch',1,1,'campus A','','','','',NULL),(20,'branch',1,1,'campus B','','','','',NULL);
 INSERT INTO users VALUES(101,'student',1,10,'A one','a1','四年级','上册','primary',NULL),(102,'student',1,10,'A two','a2','四年级','上册','primary',NULL),(103,'student',0,10,'A stopped','a3','四年级','上册','primary',NULL),(201,'student',1,20,'B one','b1','四年级','上册','primary',NULL),(104,'student',1,10,'A unassigned','a4','四年级','上册','primary',NULL);
 INSERT INTO papers VALUES(1,'assigned','数学','五年级','下册','primary','published','[1]','2026-01-01','',30,100),(2,'broadcast','数学','四年级','上册','primary','published','[1]','2026-01-01','',30,100),(3,'draft','数学','四年级','上册','primary','draft','[1]','2026-01-01','',30,100),(4,'other grade','数学','五年级','上册','primary','published','[1]','2026-01-01','',30,100);
 INSERT INTO paper_assignments VALUES(1,101,10,''),(1,102,10,''),(1,201,20,''),(1,103,10,'');
 INSERT INTO questions VALUES(1,'synthetic question');
 `);
 raw.exec(`
ALTER TABLE papers ADD COLUMN question_scores TEXT;
ALTER TABLE papers ADD COLUMN question_partial_scores TEXT;
ALTER TABLE questions ADD COLUMN type TEXT;
ALTER TABLE questions ADD COLUMN answer TEXT;
ALTER TABLE questions ADD COLUMN chapter_id INTEGER;
ALTER TABLE questions ADD COLUMN options TEXT;
ALTER TABLE questions ADD COLUMN point TEXT;
UPDATE questions SET type='single',answer='A',options='["one","two"]',point='synthetic';
CREATE TABLE records(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,chapter_id INTEGER,my_answer TEXT,is_correct INTEGER,match_correct INTEGER,match_total INTEGER,created_at TEXT);
CREATE TABLE mistakes(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT,UNIQUE(user_id,question_id));
CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,kind TEXT,paper_id INTEGER,my_answer TEXT,created_at TEXT,drawing_data TEXT,try_id INTEGER,max_score REAL);
DELETE FROM paper_assignments;
UPDATE papers SET status='draft' WHERE id=1;
`);
 const db={prepare(sql){return raw.prepare(sql);},transaction:fn=>()=>{raw.exec('BEGIN');try{const v=fn();raw.exec('COMMIT');return v;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 const admin={},stu={},middleware=[];
 const box={db,admin:{get:(p,f)=>admin['GET '+p]=f,post:(p,f)=>admin['POST '+p]=f},stu:{get:(p,f)=>stu[p]=f,post:(p,f)=>stu['POST '+p]=f,use:f=>middleware.push(f)},
 ok:(res,data)=>res.data=data,fail:(res,error)=>res.error=error,now:()=> '2026-01-01',serveQ:q=>q,...require('./src/bank-judge'), ...require('./src/paper-attempt'), require:p=>require(path.join(__dirname, 'src', p.replace('./','')))};
 const snippets=[slice('const normOpts =','const parseIds =').replace('const parseIds =',''),slice('const isUngradedQ =',';'),slice('const roundScore =',';'),slice('function paperScores(','\n}'),slice('const todayStr =','\n};'),slice('const addDays =','\n};'),slice("stu.post('/submit',",'\n});'),slice('const parseIds =','\n};'),slice('const stageOfGrade =','\n};'),slice('function paperDeadline(','\n}'),slice('const paperHasAssignees =',';'),slice('stu.use((req, res, next) => {','\n});'),
 ...['/papers/:id/assignees','/students-options'].map(p=>slice("admin.get('"+p+"',",'\n});')),slice("admin.post('/papers/:id/assign',",'\n});'),
 ...['/tasks','/papers','/papers/:id'].map(p=>slice("stu.get('"+p+"',",'\n});'))];
 vm.runInNewContext(snippets.join('\n'),box);
 const response=()=>({status(n){this.statusCode=n;return this;},json(j){this.jsonBody=j;return this;}});
 const invoke=(handler,user,opts={})=>{const res=response();handler({user,query:{},params:{id:1},body:{},...opts},res);return res;};
 return {raw,submit:(id,answers)=>invoke(stu['POST /submit'],{id,role:'student'},{body:{kind:'paper',paper_id:1,answers}}),admin:(p,user,opts)=>invoke(admin[p],user,opts),student:(p,id,paper=1)=>{const user={id,role:'student'},res=response();let next=false;middleware[0]({user},res,()=>{next=true;});if(!next)return res;stu[p]({user,params:{id:paper},query:{}},res);return res;}
 };
}

const branch={id:10,role:'branch'};
test('two students: persisted assignment, task visibility, separate scored submissions and mistakes',t=>{
 const f=fixture(t);
 assert.equal(f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102,101]}}).data.added,2);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,2);
 assert.equal(f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102]}}).data.added,0);
 for(const id of [101,102]) assert.ok(f.student('/tasks',id).data.some(p=>p.id===1));
 assert.ok(!f.student('/tasks',104).data.some(p=>p.id===1));
 const a=f.submit(101,[{question_id:1,my_answer:'A'}]);assert.equal(a.data.score,100);
 const b=f.submit(102,[{question_id:1,my_answer:'B'}]);assert.equal(b.data.score,0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM records').get().n,2);
 const tries=f.raw.prepare('SELECT user_id,score FROM paper_tries ORDER BY id').all();
 assert.deepEqual(tries.map(r=>[r.user_id,r.score]),[[101,100],[102,0]]);
 assert.deepEqual(f.raw.prepare('SELECT user_id,question_id FROM mistakes').all().map(r=>[r.user_id,r.question_id]),[[102,1]]);
 assert.equal(f.student('/tasks',101).data.find(p=>p.id===1).last.score,100);
});
test('submit transaction rolls back all records and mistakes when attempt insertion fails',t=>{
 const f=fixture(t);f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102]}});
 f.raw.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON paper_tries BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
 assert.throws(()=>f.submit(102,[{question_id:1,my_answer:'B'}]),/injected failure/);
 for(const table of ['records','mistakes','paper_tries']) assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});
test('assignment rolls back new recipients when publication fails',t=>{
 const f=fixture(t);
 f.raw.exec("CREATE TRIGGER reject_publish BEFORE UPDATE ON papers BEGIN SELECT RAISE(ABORT,'injected publish failure'); END;");
 assert.throws(()=>f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102]}}),/injected publish failure/);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,0);
 assert.equal(f.raw.prepare('SELECT status FROM papers WHERE id=1').get().status,'draft');
});

test('failed reassignment preserves existing recipients and the published deadline',t=>{
 const f=fixture(t);
 f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101],due_at:'2026-12-01T12:00:00Z'}});
 const before=f.raw.prepare('SELECT status,due_at,published_at FROM papers WHERE id=1').get();
 f.raw.exec("CREATE TRIGGER reject_publish BEFORE UPDATE ON papers BEGIN SELECT RAISE(ABORT,'injected publish failure'); END;");
 assert.throws(()=>f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102],due_at:'2026-12-02T12:00:00Z'}}),/injected publish failure/);
 assert.deepEqual(f.raw.prepare('SELECT user_id FROM paper_assignments ORDER BY user_id').all().map(r=>r.user_id),[101]);
 assert.deepEqual(f.raw.prepare('SELECT status,due_at,published_at FROM papers WHERE id=1').get(),before);
});
test('an assignment insertion failure rolls back every new recipient and leaves the paper unpublished',t=>{
 const f=fixture(t);
 f.raw.exec("CREATE TRIGGER reject_second_recipient BEFORE INSERT ON paper_assignments WHEN NEW.user_id=102 BEGIN SELECT RAISE(ABORT,'injected assignment failure'); END;");
 assert.throws(()=>f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102]}}),/injected assignment failure/);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,0);
 assert.equal(f.raw.prepare('SELECT status FROM papers WHERE id=1').get().status,'draft');
});
test('retry after a publication failure adds the intended recipients exactly once',t=>{
 const f=fixture(t);
 f.raw.exec("CREATE TRIGGER reject_publish BEFORE UPDATE ON papers BEGIN SELECT RAISE(ABORT,'injected publish failure'); END;");
 assert.throws(()=>f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102]}}),/injected publish failure/);
 f.raw.exec('DROP TRIGGER reject_publish');
 const result=f.admin('POST /papers/:id/assign',branch,{body:{user_ids:[101,102],due_at:'2026-12-01T12:00:00Z'}});
 assert.equal(result.data.added,2);
 assert.equal(result.data.total,2);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,2);
 assert.equal(f.raw.prepare('SELECT status FROM papers WHERE id=1').get().status,'published');
 for(const id of [101,102]) assert.ok(f.student('/tasks',id).data.some(p=>p.id===1));
});
