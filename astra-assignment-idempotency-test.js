'use strict';
// ISSUE-001: use the actual table definition; never invent a test-only pair index.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Database=require('better-sqlite3');
const bank=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
const schema=fs.readFileSync(path.join(__dirname,'src/db.js'),'utf8');
function part(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,start);return text.slice(a,b+end.length);}
function fixture(t){
 const raw=new Database(':memory:');t.after(()=>raw.close());
 raw.exec(part(schema,'CREATE TABLE IF NOT EXISTS paper_assignments (',');'));
 raw.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,grade TEXT,role TEXT,status INTEGER,created_by INTEGER);
 CREATE TABLE papers(id INTEGER PRIMARY KEY,q_ids TEXT,status TEXT,due_at TEXT,published_at TEXT);
 CREATE TABLE paper_tries(id INTEGER PRIMARY KEY,paper_id INTEGER,user_id INTEGER,detail TEXT);
 CREATE TABLE records(id INTEGER PRIMARY KEY,my_answer TEXT);
 CREATE TABLE mistakes(id INTEGER PRIMARY KEY,last_answer TEXT);
 CREATE TABLE subjective_responses(id INTEGER PRIMARY KEY,my_answer TEXT);
 INSERT INTO papers VALUES(1,'[9]','draft','2026-12-01T12:34:00.123Z',NULL);
 INSERT INTO users VALUES(4,'A','六年级','student',1,10),(5,'B','六年级','student',1,10),(6,'C','六年级','student',1,20);
 INSERT INTO paper_tries VALUES(1,1,4,'preserved attempt');INSERT INTO records VALUES(1,'preserved record');INSERT INTO mistakes VALUES(1,'preserved mistake');INSERT INTO subjective_responses VALUES(1,'preserved drawing');`);
 require('./school-scope-test-fixture')(raw);
 raw.exec("CREATE TABLE paper_uploads(question_id INTEGER,user_id INTEGER,status TEXT); INSERT INTO questions(id,stage,grade) VALUES(9,'primary','六年级')");
 const handlers={},writes=[];let beforeTx=null;
 const db={prepare:sql=>{const s=raw.prepare(sql);return {get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>{writes.push(sql);return s.run(...a);}};},transaction:fn=>()=>{if(beforeTx){const f=beforeTx;beforeTx=null;f();}return raw.transaction(fn)();}};
 const box={db,admin:{get:(p,f)=>handlers['GET '+p]=f,post:(p,f)=>handlers['POST '+p]=f},now:()=> '2026-11-07T12:00:00Z',parseIds:s=>JSON.parse(s),ok:(r,d)=>r.data=d,fail:(r,e)=>r.error=e,require:p=>{assert.ok(['./qmeta','./compose','./school-scope'].includes(p));return require(path.join(__dirname,'src',p));}};
 vm.runInNewContext(part(bank,'function paperDeadline(','\n}')+'\n'+["admin.get('/papers',","admin.get('/papers/:id/assignees',","admin.post('/papers/:id/assign',"].map(s=>part(bank,s,'\n});')).join('\n'),box);
 const call=(key,body={},role='branch')=>{const res={};handlers[key]({user:{id:10,role},params:{id:'1'},query:{},body},res);return res;};
 const snapshot=()=>Object.fromEntries(['paper_assignments','paper_tries','records','mistakes','subjective_responses'].map(s=>[s,raw.prepare('SELECT * FROM '+s+' ORDER BY id').all()]));
 return {raw,db,writes,box,call,snapshot,beforeTx:f=>beforeTx=f};
}
test('four legal reassignments keep two physical rows without a pair index',t=>{
 const f=fixture(t);const added=[];
 for(const due of [undefined,undefined,'2026-12-02T00:00:00Z',''])added.push(f.call('POST /papers/:id/assign',{user_ids:[4,5,4],...(due===undefined?{}:{due_at:due})}).data.added);
 assert.deepEqual(added,[2,0,0,0]);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,2);
 assert.equal(f.call('GET /papers').data[0].assign_count,2);assert.equal(f.call('GET /papers/:id/assignees').data.length,2);
 assert.equal(f.raw.prepare('SELECT due_at FROM papers').get().due_at,'');
});
test('legacy duplicate rows are presented once and preserved byte-for-byte',t=>{
 const f=fixture(t);for(let i=0;i<4;i++)for(const id of [4,5])f.raw.prepare('INSERT INTO paper_assignments(paper_id,user_id,assigned_by,created_at) VALUES(1,?,?,?)').run(id,10+i,'2026-11-0'+(i+1));
 const before=f.snapshot();const r=f.call('POST /papers/:id/assign',{user_ids:[4,5]});assert.equal(r.data.added,0);assert.deepEqual(f.snapshot(),before);
 assert.equal(f.call('GET /papers').data[0].assign_count,2);assert.deepEqual(Array.from(f.call('GET /papers/:id/assignees').data,x=>x.user_id).sort(),[4,5]);
});
test('omitted deadline preserves a newer value committed before the assignment transaction',t=>{
 const f=fixture(t);f.beforeTx(()=>f.raw.prepare('UPDATE papers SET due_at=? WHERE id=1').run('2027-01-02T03:04:05.678Z'));
 f.call('POST /papers/:id/assign',{user_ids:[4,5]});assert.equal(f.raw.prepare('SELECT due_at FROM papers').get().due_at,'2027-01-02T03:04:05.678Z');
 assert.match(f.writes[0],/^UPDATE papers/,'serialize same-paper writers before assignment reads');
});
test('insertion error rolls back publication, deadline and every newly assigned student',t=>{
 const f=fixture(t);const before=f.snapshot(),paper=f.raw.prepare('SELECT * FROM papers').get();f.raw.exec("CREATE TRIGGER fail_assignment BEFORE INSERT ON paper_assignments WHEN NEW.user_id=5 BEGIN SELECT RAISE(ABORT,'injected');END;");
 assert.throws(()=>f.call('POST /papers/:id/assign',{user_ids:[4,5],due_at:''}),/injected/);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.raw.prepare('SELECT * FROM papers').get(),paper);
});
test('unauthorized branch recipient is rejected before any assignment mutation',t=>{
 const f=fixture(t);const before=f.snapshot();assert.ok(f.call('POST /papers/:id/assign',{user_ids:[4,6]}).error);assert.deepEqual(f.snapshot(),before);assert.equal(f.writes.length,0);
});
function constraint(f,runSchema=sql=>f.raw.exec(sql)){const box={...f.box,runSchema,result:null};vm.runInNewContext(part(schema,'function ensurePaperAssignmentUniqueness(','\n}')+'\nresult=ensurePaperAssignmentUniqueness();',box);return box.result;}
test('clean database gains an idempotent pair constraint from production migration',t=>{
 const f=fixture(t);constraint(f);constraint(f);f.raw.prepare('INSERT INTO paper_assignments(paper_id,user_id,created_at) VALUES(1,4,?)').run('x');assert.throws(()=>f.raw.prepare('INSERT INTO paper_assignments(paper_id,user_id,created_at) VALUES(1,4,?)').run('y'),/UNIQUE/);
});
test('legacy duplicates prevent constraint creation without discarding any history',t=>{
 const f=fixture(t);f.raw.exec("INSERT INTO paper_assignments(paper_id,user_id,created_at) VALUES(1,4,'a'),(1,4,'b')");const before=f.snapshot();constraint(f);assert.deepEqual(f.snapshot(),before);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_passign_pair_unique'").get().n,0);
});
test('constraint migration runs after legacy import, never before it',()=>{
 const call=schema.indexOf('const assignmentUniqueness = ensurePaperAssignmentUniqueness();');assert.ok(call>schema.indexOf('importIfEmpty(db, DATA_DIR);'));
});
test('paper deleted between initial validation and transaction cannot receive orphan assignments',t=>{
 const f=fixture(t);f.beforeTx(()=>f.raw.prepare('DELETE FROM papers WHERE id=1').run());assert.throws(()=>f.call('POST /papers/:id/assign',{user_ids:[4,5]}),/试卷已不存在/);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,0);
});
test('duplicate inserted by an old writer during index creation is reported without deleting it',t=>{
 const f=fixture(t);const r=constraint(f,()=>{f.raw.exec("INSERT INTO paper_assignments(paper_id,user_id,created_at) VALUES(1,4,'a'),(1,4,'b')");throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY',errno:1062});});assert.equal(r.enforced,false);assert.equal(r.duplicate_groups,1);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM paper_assignments').get().n,2);
});
test('unexpected index errors propagate instead of being reported as successful migration',t=>{
 const f=fixture(t);assert.throws(()=>constraint(f,()=>{throw Object.assign(new Error('permission denied'),{code:'ER_TABLEACCESS_DENIED_ERROR'});}),/permission denied/);
});
