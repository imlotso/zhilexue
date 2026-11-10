'use strict';
// Isolated production route / UI-function checks. No browser, server or real data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const backend = fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
const frontend = fs.readFileSync(path.join(__dirname,'public/js/bank.js'),'utf8');
const tick = () => new Promise(r=>setImmediate(r));
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
test('tree choices and exact ID enforce subject, stage and kind, while preserving default/edition selection',()=>{
  let db;
  try { const Database=require('better-sqlite3'); db=new Database(':memory:'); }
  catch (_) { const {DatabaseSync}=require('node:sqlite'); db=new DatabaseSync(':memory:'); }
  try {
    db.exec(`CREATE TABLE users(id INTEGER,stage TEXT,grade TEXT);INSERT INTO users VALUES(1,'primary','六年级');
      CREATE TABLE bank_trees(id INTEGER,name TEXT,edition TEXT,stage TEXT,subject TEXT,kind TEXT,sort INTEGER);
      INSERT INTO bank_trees VALUES(1,'Empty default','苏教版','primary','数学','textbook',0),(2,'Other book','第二版','primary','数学','textbook',1),(3,'Generic','','','数学','textbook',2),(4,'Junior','第二版','junior','数学','textbook',0),(5,'English','第二版','primary','英语','textbook',0),(6,'Knowledge','','primary','数学','knowledge',0);
      CREATE TABLE bank_tree_nodes(id INTEGER,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER);INSERT INTO bank_tree_nodes VALUES(20,2,NULL,'Unit',0),(30,3,NULL,'Generic unit',0);`);
    let handler;const a=backend.indexOf("stu.get('/scan-tree'");const b=backend.indexOf('\n});',a)+4;
    vm.runInNewContext(backend.slice(a,b),{db,stu:{get:(_,fn)=>handler=fn},stageOfGrade:s=>s,
      pickTree:require('./src/treepick').pickTree,ok:(r,x)=>r.data=x,fail:(r,x)=>r.error=x});
    const get=q=>{const r={};handler({user:{id:1},query:{subject:'数学',...q}},r);return r;};
    const d=get({}).data;assert.equal(d.tree_id,1);assert.equal(d.nodes.length,0);assert.deepEqual(Array.from(d.trees,x=>x.id),[1,2,3]);
    assert.equal(get({edition:'第二版'}).data.tree_id,2);
    assert.equal(get({tree_id:'3'}).data.nodes[0].id,30);
    for(const id of ['4','5','6','999','-1','2x','', '1.5'])assert.ok(get({tree_id:id}).error,id);
    assert.deepEqual(Array.from(get({kind:'knowledge'}).data.trees,x=>x.id),[6]);
  } finally {db.close();}
});
function ui(){
  const calls=[], errors=[],radars=[], elements={}; let mask;
  const element=id=>elements[id]||(elements[id]={value:id==='pkWant'?'5':'',textContent:'',innerHTML:'',disabled:false});
  const document={createElement:()=>mask={isConnected:false,innerHTML:'',handlers:{},selected:[],querySelector(s){if(s==='.pk-ck:checked')return this.selected[0]||null;return element(s.slice(1));},querySelectorAll(s){return s==='.pk-ck:checked'?this.selected:[];},addEventListener(n,f){this.handlers[n]=f;},remove(){this.isConnected=false;}},body:{appendChild:m=>m.isConnected=true}};
  const BankPages={showRadar:(...x)=>radars.push(x)};const location={hash:'#/papers'};
  const start=frontend.indexOf('  async scanFlow('),end=frontend.indexOf('  /** 雷达扫描',start);
  const method=frontend.slice(start,end).trim().replace(/,$/,'');
  Object.assign(BankPages,vm.runInNewContext('({'+method+'})',{BankPages,document,location,esc:x=>String(x??''),toast:x=>errors.push(x),api:(url,options)=>{assert.equal(options.silent,true,'only current dialog may display request errors');const d=deferred();calls.push({url,options,...d});return d.promise;}}));
  return {BankPages,elements,calls,errors,radars,get mask(){return mask;},element};
}
const tree=(id,empty=false)=>({tree_id:id,edition:'V'+id,trees:[{id:1,name:'Empty',edition:'V1'},{id:2,name:'Full',edition:'V2'}],nodes:empty?[]:[{id:id*10,parent_id:null,name:'Unit'}]});
test('empty default remains switchable; out-of-order trees and closed errors are ignored',async()=>{
 const f=ui();const opening=f.BankPages.scanFlow('textbook','数学',{isConnected:true});f.calls[0].resolve(tree(1,true));await opening;
 assert.equal(f.element('pkEdition').disabled,false);assert.match(f.element('pkTree').innerHTML,/当前版本还没有目录/);
 f.element('pkEdition').onchange({target:{value:'2'}});f.element('pkEdition').onchange({target:{value:'1'}});
 f.calls[2].resolve(tree(1,true));await tick();f.calls[1].resolve(tree(2));await tick();assert.equal(f.element('pkEdition').value,'1');
 f.element('pkEdition').onchange({target:{value:'2'}});f.element('pkSelX').onclick();f.calls[3].reject(new Error('late'));await tick();assert.deepEqual(f.errors,[]);
});
test('switch clears counts; old count and compose cannot reach a new edition or closed dialog',async()=>{
 const f=ui();const opening=f.BankPages.scanFlow('knowledge','数学',{isConnected:true});f.calls[0].resolve(tree(2));await opening;
 const choose=()=>{const cb={dataset:{nd:'20'},checked:true};f.mask.selected=[cb];f.mask.handlers.change({target:{closest:()=>cb}});};
 choose();f.element('pkEdition').onchange({target:{value:'1'}});f.mask.selected=[];
 f.calls[1].resolve({total:20});await tick();assert.equal(f.element('pkSelQ').textContent,'0');assert.equal(f.element('pkSelGo').disabled,true);
 f.calls[2].resolve(tree(2));await tick();choose();f.calls[3].resolve({total:20});await tick();
 const submit=f.element('pkSelGo').onclick();assert.match(f.calls[4].url,/scan-compose/);
 f.element('pkEdition').onchange({target:{value:'1'}});f.calls[4].resolve({items:[{}]});await submit;assert.equal(f.radars.length,0);
 f.element('pkSelCancel').onclick();f.calls[5].reject(new Error('closed'));await tick();assert.deepEqual(f.errors,[]);
});

test('current edition submits once; closing suppresses pending compose failures',async()=>{
 for(const fail of [false,true]) {
  const f=ui();const opening=f.BankPages.scanFlow('textbook','数学',{isConnected:true});f.calls[0].resolve(tree(2));await opening;
  const cb={dataset:{nd:'20'},checked:true};f.mask.selected=[cb];f.mask.handlers.change({target:{closest:()=>cb}});
  f.calls[1].resolve({total:5});await tick();const submit=f.element('pkSelGo').onclick();await f.element('pkSelGo').onclick();assert.equal(f.calls.length,3);
  assert.deepEqual(Array.from(f.calls[2].options.body.node_ids),[20]);
  if(fail){f.element('pkSelCancel').onclick();f.calls[2].reject(new Error('late compose'));}else f.calls[2].resolve({items:[{id:20}]});
  await submit;assert.equal(f.radars.length,fail?0:1);assert.equal(f.mask.isConnected,false);assert.deepEqual(f.errors,[]);
 }
});
