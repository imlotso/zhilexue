'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pending=fs.readFileSync(__dirname+'/src/mfpending.js','utf8');
function section(source,a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start,a);return source.slice(start,end);}
for(const count of [3,6,7,200])test(`B7 Word paper with ${count} questions totals exactly 100 points in integer tenths`,async()=>{
 let handler,saved;
 const cards=Array.from({length:count},(_,i)=>({_type:'fill',stem:'synthetic '+i}));
 const context={admin:{post:(_route,...handlers)=>{handler=handlers.at(-1)}},upFile:{single:()=>()=>{}},parseWordUpload:async()=>({cards,name:'synthetic.docx',r:{bigCount:count,errors:[],warnings:[]}}),str:x=>String(x??''),int:x=>parseInt(x,10)||0,now:()=>'',jstr:JSON.stringify,CN_NUM:[],SEC_TITLE:{fill:'填空题'},require:name=>{assert.equal(name,'./mfbank');return{defaultLayout:()=>({})}},createRun:arg=>{saved=arg.cards;return 1},db:{transaction:fn=>fn,prepare:()=>({run:()=>({lastInsertRowid:1})})},ok:(res,data)=>res.json({code:0,data}),fail:(res,msg)=>res.json({code:1,msg})};
 vm.runInNewContext(section(pending,"  admin.post('/papers/import-word'",'\n  return { counts:'),context);
 const res={json(v){this.body=v;return v}};await handler({file:{},body:{subject:'数学',stage:'primary'}},res);
 assert.equal(res.body.code,0,res.body.msg);assert.equal(saved.reduce((sum,c)=>sum+Math.round(c._paper_score*10),0),1000);
 assert.ok(Math.max(...saved.map(c=>c._paper_score))-Math.min(...saved.map(c=>c._paper_score))<0.10000001);
});
for(const count of [3,6,200])test(`B7 existing recognition run converted to paper also totals 100 (${count} questions)`,()=>{
 let handler,saved;
 const cards=Array.from({length:count},(_,i)=>({stem:'synthetic '+i})),run={id:1,title:'synthetic',subject:'数学',stage:'primary',drafts:JSON.stringify(cards)};
 const context={admin:{post:(_route,...handlers)=>{handler=handlers.at(-1)}},str:x=>String(x??''),int:x=>parseInt(x,10)||0,parseArr:JSON.parse,stemOfCard:c=>c.stem,now:()=>'',jstr:JSON.stringify,require:name=>{assert.equal(name,'./mfbank');return{defaultLayout:()=>({})}},db:{transaction:fn=>fn,prepare:sql=>({get:()=>run,run:(...args)=>{if(sql.startsWith('UPDATE mf_recog_runs SET title='))saved=JSON.parse(args[5]);return {lastInsertRowid:1}}})},ok:(res,data)=>res.json({code:0,data}),fail:(res,msg)=>res.json({code:1,msg})};
 const start=pending.indexOf("  admin.post('/papers/from-run'");
 assert(start>=0,'run-paper route exists');
 vm.runInNewContext(pending.slice(start,pending.indexOf('\n  // 手动录入',start)),context);
 const res={json(v){this.body=v;return v}};handler({params:{id:1},body:{run_id:1,subject:'数学',stage:'primary'}},res);
 assert.equal(res.body.code,0,res.body.msg);assert.equal(saved.reduce((sum,c)=>sum+Math.round(c._paper_score*10),0),1000);
});
test('B7 manually set paper score remains exact and is not redistributed',()=>{
 const source=fs.readFileSync(__dirname+'/src/mfbank.js','utf8');let handler,args;
 const context={admin:{put:(_p,h)=>{handler=h}},int:x=>Number(x),num:x=>Number(x),ok:(res,data)=>res.json({code:0,data}),fail:(res,msg)=>res.json({code:1,msg}),db:{prepare:sql=>({get:()=>({kind:'question',score:33.3,question_type:'fill',partial_score:null}),run:(...a)=>{args=a;}})}};
 vm.runInNewContext(section(source,"admin.put('/papers/:id/rows/:rowId'",'\n});')+'\n});',context);
 const res={json(v){this.body=v;return v}};handler({params:{id:1,rowId:2},body:{score:17.25}},res);assert.equal(res.body.code,0);assert.equal(args[0],17.25);
});
function workerFixture(){
 let listener,id=0;const replies=[],connections=[],committed=[],events=[];
 const mysql={async createConnection(){const c={alive:true,pending:[],inTx:false,on(_event,cb){this.onError=cb},async end(){this.alive=false;this.pending=[]},disconnect(notify){this.alive=false;this.pending=[];this.inTx=false;if(notify)this.onError(Object.assign(Error('connection lost'),{fatal:true,code:'PROTOCOL_CONNECTION_LOST'}))},async query(sql,params){
 events.push(sql);const upper=String(sql).trim().toUpperCase();if(!this.alive)throw Object.assign(Error('closed state'),{fatal:true});
 if(upper.startsWith('SELECT VERSION'))return [[{version:'fake',db:'synthetic_test'}]];
 if(/^(CREATE|ALTER|USE|SET)/.test(upper))return [{}];if(upper==='SELECT 1')return [[{one:1}]];
 if(upper==='START TRANSACTION'||upper==='BEGIN'){if(this.failBegin){this.failBegin=false;throw Error('synthetic begin failure')}this.inTx=true;return [{}]}
 if(upper.startsWith('INSERT')){assert(this.inTx);this.pending.push(params[0]);return [{insertId:1,affectedRows:1}]}
 if(upper==='COMMIT'){if(this.failCommit){committed.push(...this.pending);this.disconnect(false);throw Object.assign(Error('lost reply after server commit'),{code:'ECONNRESET'})}committed.push(...this.pending);this.pending=[];this.inTx=false;return [{}]}
 if(upper==='ROLLBACK'){this.pending=[];this.inTx=false;return [{}]}throw Error('unexpected SQL '+sql);
 }};connections.push(c);return c}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/src/mysql-worker.js','utf8'),{require:name=>{if(name==='worker_threads')return{parentPort:{on:(_event,h)=>{listener=h}},workerData:{sab:new SharedArrayBuffer(4)}};if(name==='mysql2/promise')return mysql;throw Error(name)},process:{env:{},exit(){throw Error('unexpected exit')}},console:{error(){}},setInterval:()=>({unref(){}})});
 const send=async(msg)=>{const current=++id;await listener({...msg,id:current});const reply=replies.find(r=>r.id===current);assert(reply);return reply};
 return {connections,committed,events,init:()=>send({type:'init',config:{database:'synthetic_test'},reply:{postMessage:r=>replies.push(r)}}),query:(sql,params=[])=>send({type:'query',sql,params})};
}
for(const mode of ['healthy','fatal-event','closed-state','lost-commit-reply'])test(`B8 COMMIT preserves original transaction identity: ${mode}`,async()=>{
 const f=workerFixture();assert.equal((await f.init()).ok,true);assert.equal((await f.query('START TRANSACTION')).ok,true);assert.equal((await f.query('INSERT INTO synthetic VALUES (?)',['row'])).ok,true);
 if(mode==='fatal-event')f.connections[0].disconnect(true);if(mode==='closed-state')f.connections[0].disconnect(false);if(mode==='lost-commit-reply')f.connections[0].failCommit=true;
 const result=await f.query('COMMIT');assert.equal(result.ok,mode==='healthy');assert.equal(f.connections.length,1,'must not retry COMMIT on a new connection');assert.equal(f.committed.length,['healthy','lost-commit-reply'].includes(mode)?1:0);
 if(mode!=='healthy'){assert(result.error);assert.equal((await f.query('SELECT 1')).ok,true);assert.equal(f.connections.length,2,'ordinary work may reconnect after the failed transaction');}
});
test('B8 lost transaction write cannot reconnect; rollback exits transaction before later reconnect',async()=>{
 const f=workerFixture();await f.init();await f.query('START TRANSACTION');f.connections[0].disconnect(false);
 assert.equal((await f.query('INSERT INTO synthetic VALUES (?)',['row'])).ok,false);assert.equal(f.connections.length,1);
 assert.equal((await f.query('ROLLBACK')).ok,false);assert.equal(f.connections.length,1);
 assert.equal((await f.query('SELECT 1')).ok,true);assert.equal(f.connections.length,2);
});
test('B8 failed BEGIN alias releases transaction state so a later independent query can recover',async()=>{
 const f=workerFixture();await f.init();f.connections[0].failBegin=true;assert.equal((await f.query('BEGIN')).ok,false);f.connections[0].disconnect(true);
 assert.equal((await f.query('SELECT 1')).ok,true);assert.equal(f.connections.length,2);
});
