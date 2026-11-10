'use strict';
// Production composition SQL against synthetic memory data. Never load src/db.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const compose = require('./src/compose');
let open;
try { const Database = require('better-sqlite3'); const probe = new Database(':memory:'); probe.close(); open = () => new Database(':memory:'); }
catch (_) { const { DatabaseSync } = require('node:sqlite'); open = () => new DatabaseSync(':memory:'); }
function fixture(t) {
  const db = open(); t.after(() => db.close());
  db.exec(`CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,kind TEXT,subject TEXT,stage TEXT);
    CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER DEFAULT 0);
    CREATE TABLE bank_tree_node_mappings(chapter_node_id INTEGER,knowledge_node_id INTEGER);
    CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,subject TEXT,stage TEXT,type TEXT,answer TEXT,point TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,created_by INTEGER);
    CREATE TABLE paper_uploads(question_id INTEGER,status TEXT,user_id INTEGER);
    INSERT INTO bank_trees VALUES(1,'textbook','数学','primary'),(2,'knowledge','数学','primary'),(3,'knowledge','英语','primary'),(4,'knowledge','数学','junior');
    INSERT INTO bank_tree_nodes VALUES(1,1,NULL,'第一章',0),(2,1,1,'第一节',0),(3,1,1,'第二节',0),(4,1,NULL,'第二章',0),
      (100,2,NULL,'运算',0),(101,2,100,'加法',0),(102,2,100,'减法',1),(103,2,NULL,'乘法',1),
      (201,3,NULL,'English',0),(301,4,NULL,'初中',0);`);
  const q = (id, nodes, extra = {}) => {
    db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?)').run(id, extra.subject || '数学', extra.stage || 'primary', extra.type || 'single', 'A', '');
    nodes.forEach(n => db.prepare('INSERT INTO question_nodes VALUES(?,?)').run(id, n));
    if (extra.pending) db.prepare("INSERT INTO paper_uploads VALUES(?,'pending',99)").run(id);
  };
  const scan = (ids, kind = 'textbook') => compose.planStudentScan(db, { ids, kind, subject: '数学', stage: 'primary' });
  return { db, q, scan };
}
test('all selected chapter mappings expand to smallest points and report empty points', t => {
  const f = fixture(t); f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(1,100),(4,103)');
  f.q(1,[101]); f.q(2,[103]);
  const result = f.scan([1,4,2,1]);
  assert.equal(result.target_total,3);
  assert.deepEqual(result.items.map(x => x.node_id).sort(),[101,103]);
  assert.deepEqual(result.missing.map(x => [x.node_id,x.node_name,x.need]),[[102,'减法',1]]);
});
test('a shared question is reassigned to cover both points instead of greedy shortages', t => {
  const f = fixture(t); f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(1,100)');
  f.q(1,[101,102]); f.q(2,[101]);
  for(let i=0;i<15;i++) {
    const r=f.scan([1]); assert.equal(r.items.length,2); assert.equal(new Set(r.items.map(x=>x.row.id)).size,2); assert.equal(r.missing.length,0);
    assert.equal(r.items.find(x=>x.node_id===102).row.id,1);
  }
});
test('more than twenty points are all represented without count truncation', t => {
  const f=fixture(t);f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(1,100)');
  for(let i=0;i<26;i++){const n=400+i;f.db.prepare('INSERT INTO bank_tree_nodes VALUES(?,2,100,?,?)').run(n,'点'+i,i);f.q(n,[n]);}
  f.q(1,[101]);f.q(2,[102]);
  const r=f.scan([1]);assert.equal(r.target_total,28);assert.equal(r.items.length,28);assert.equal(r.missing.length,0);
});
test('legacy dual mounts infer points and unmapped chapter leaves keep explicit fallback', t => {
  const f=fixture(t);f.q(1,[2,101]);f.q(2,[3]);f.q(3,[4]);
  const r=f.scan([1,4]);assert.deepEqual(r.items.map(x=>x.node_id).sort((a,b)=>a-b),[3,4,101]);
  assert.equal(r.items.find(x=>x.node_id===3).fallback,true);
  assert.equal(r.items.find(x=>x.node_id===101).fallback,false);
});
test('mapping shared by chapters is deduplicated and inferred knowledge does not duplicate it', t => {
  const f=fixture(t);f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(2,101),(4,101)');
  f.q(1,[2,101]);f.q(2,[3]);
  const r=f.scan([1,4]);assert.equal(r.target_total,2);assert.equal(r.items.length,2);
});
test('pending, foreign subject/stage and invalid mapping cannot enter candidates', t => {
  const f=fixture(t);f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(1,100),(1,201),(1,301)');
  f.q(1,[101],{pending:true});f.q(2,[102],{subject:'英语'});f.q(3,[102],{stage:'junior'});f.q(4,[201],{subject:'英语'});f.q(5,[301],{stage:'junior'});
  const r=f.scan([1]);assert.equal(r.items.length,0);assert.equal(r.target_total,2);assert.equal(r.missing.length,2);
});
test('knowledge leaf shortage never disappears because its ancestor has a question', t => {
  const f=fixture(t);f.q(1,[100]);f.q(2,[101]);
  const r=f.scan([100,101],'knowledge');assert.equal(r.target_total,2);assert.equal(r.items.length,1);assert.equal(r.missing[0].node_id,102);
});
test('two leaves sharing their only question report one distinct-question shortage', t => {
  const f=fixture(t);f.q(1,[101,102]);
  const r=f.scan([100],'knowledge');assert.equal(r.target_total,2);assert.equal(r.items.length,1);assert.equal(r.missing.length,1);assert.equal(r.missing[0].reason,'shared');
});
function routes(f) {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
  f.db.exec("ALTER TABLE users ADD COLUMN grade TEXT; ALTER TABLE users ADD COLUMN stage TEXT; INSERT INTO users(id,grade,stage) VALUES(1,'四年级','primary');");
  const handlers={};const start=source.indexOf('function scanScope('),end=source.indexOf('// ---------- 错题本',start);
  vm.runInNewContext(source.slice(start,end),{db:f.db,compose,stageOfGrade:s=>s,pickTree:()=>({}),require:n=>require(path.resolve(__dirname,'src',n)),serveQ:q=>({id:q.id}),
    stu:{post:(route,fn)=>handlers[route]=fn},ok:(res,data)=>res.data=data,fail:(res,error)=>res.error=error});
  return (route,body)=>{const res={};handlers[route]({user:{id:1},body:{subject:'数学',kind:'textbook',...body}},res);return res;};
}
test('API count and compose share coverage; old numeric count cannot truncate scan',t=>{
  const f=fixture(t),call=routes(f);f.db.exec('INSERT INTO bank_tree_node_mappings VALUES(1,100)');f.q(1,[101]);
  const count=call('/scan-count',{node_ids:[1]}),r=call('/scan-compose',{node_ids:[1],count:5});
  assert.equal(count.data.target_total,2);assert.equal(count.data.total,1);assert.equal(count.data.missing.length,1);
  assert.equal(r.data.target_total,2);assert.equal(r.data.items.length,1);assert.equal(r.data.missing.length,1);
});
test('API refuses unknown, mixed, malformed and wrong-kind node selections',t=>{
  const f=fixture(t),call=routes(f);
  for(const node_ids of [[9999],[1,9999],[1,'bad'],[1,201],[301],[101],[-1],[1.5]]) {
    assert.ok(call('/scan-count',{node_ids}).error,JSON.stringify(node_ids));
    assert.ok(call('/scan-compose',{node_ids}).error,JSON.stringify(node_ids));
  }
});
test('a parent-only legacy dual mount cannot hide an unmapped child chapter',t=>{
 const f=fixture(t);f.q(1,[1,101]);f.q(2,[2]);f.q(3,[3]);
 const r=f.scan([1]);assert.deepEqual(r.items.map(x=>x.node_id).sort((a,b)=>a-b),[2,3,101]);
 assert.equal(r.fallback_count,2);
});
