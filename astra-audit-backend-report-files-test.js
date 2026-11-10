'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'),vm=require('node:vm');
let Database; try { Database=require('better-sqlite3'); new Database(':memory:').close(); } catch(_){Database=require('node:sqlite').DatabaseSync;}
const own='report/202611/1111111111111111.jpg', foreign='report/202611/2222222222222222.jpg';
function fixture(t){
 const raw=new Database(':memory:'); t.after(()=>raw.close());
 raw.exec(`CREATE TABLE ai_reports(id INTEGER PRIMARY KEY,title TEXT,student TEXT,subject TEXT,grade TEXT,paper_keys TEXT,status TEXT,model TEXT,report TEXT,error TEXT,created_by INTEGER,created_at TEXT);
 CREATE TABLE report_uploads(file_key TEXT PRIMARY KEY,created_by INTEGER,created_at TEXT);
 CREATE TABLE users(id INTEGER,name TEXT,role TEXT);`);
 raw.prepare("INSERT INTO report_uploads VALUES(?,10,'now')").run(own); raw.prepare("INSERT INTO report_uploads VALUES(?,20,'now')").run(foreign);
 const db={prepare:s=>raw.prepare(s.replace(/ FOR UPDATE\b/g,'')),transaction:fn=>(...a)=>{raw.exec('BEGIN');try{const r=fn(...a);raw.exec('COMMIT');return r;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 const routers=[], deletes=[], reads=[]; const store={CLOUD_READ_ONLY:false,saveFile:async()=>({key:'report/202611/3333333333333333.jpg'}),readBuffer:async key=>{reads.push(key);return Buffer.from('synthetic');},deleteFile:async key=>{deletes.push(key);},assertDeleteAllowed:()=>{}};
 const multer=()=>({array:()=>()=>{}});multer.memoryStorage=()=>({});
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'src/report.js'),'utf8'),{module,Buffer,console,require:n=>{
 if(n==='./db')return {db};if(n==='./storage')return store;if(n==='express')return{Router:()=>{const r={};for(const m of ['get','post','put','delete'])r[m]=(p,...handlers)=>r[m+' '+p]=handlers.at(-1);routers.push(r);return r;}};
 if(n==='multer')return multer;if(n==='./ai')return{analyzePaper:async()=>({report:{},model:'mock'}),normalizeReport:r=>r};if(n==='./pdfimg')return{};
 return n.startsWith('./')?require(path.join(__dirname,'src',n)):require(n);
 }});
 async function call(route,{body={},id=1,user={id:10,role:'branch'},files=[],query={},scan=false}={}){
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};
  await routers[scan?1:0][route]({body,params:{id},user,files,query},res); await Promise.resolve(); await Promise.resolve();return res;
 }
 const add=(keys,owner=10,id=1)=>raw.prepare("INSERT INTO ai_reports(id,paper_keys,created_by,status) VALUES(?,?,?,'done')").run(id,JSON.stringify(keys),owner);
 return {raw,call,add,store,deletes,reads};
}
for(const key of ['../outside/keep.txt','bank/img/shared.png',foreign])test('report creation rejects unowned or invalid attachment '+key,async t=>{
 const f=fixture(t),r=await f.call('post /',{body:{paperKeys:[key]}});assert.notEqual(r.body.code,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM ai_reports').get().n,0);assert.equal(f.reads.length,0);
});
test('owned upload may create and analyze a report',async t=>{const f=fixture(t),r=await f.call('post /',{body:{paperKeys:[own]}});assert.equal(r.body.code,0);assert.deepEqual(f.reads,[own]);});
test('upload persists ownership before returning keys',async t=>{const f=fixture(t),r=await f.call('post /papers',{files:[{originalname:'x.jpg',mimetype:'image/jpeg',buffer:Buffer.from('synthetic')}]});assert.equal(r.body.code,0);assert.equal(f.raw.prepare('SELECT created_by FROM report_uploads WHERE file_key=?').get(r.body.data.keys[0])?.created_by,10);});
test('legacy invalid or unowned report can be removed but cannot delete any file',async t=>{
 const f=fixture(t);f.add(['../outside/keep.txt',foreign,'bank/img/shared.png']);const r=await f.call('delete /:id');assert.equal(r.body.code,0);assert.deepEqual(f.deletes,[]);assert.match(r.body.msg,/未验证|未确认|保留/);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM ai_reports').get().n,0);
});
test('legacy retry cannot read an unowned attachment',async t=>{const f=fixture(t);f.add([foreign]);const r=await f.call('post /:id/retry');assert.notEqual(r.body.code,0);assert.deepEqual(f.reads,[]);});
test('owned unshared attachment deletes but foreign metadata survives',async t=>{const f=fixture(t);f.add([own]);const r=await f.call('delete /:id');assert.equal(r.body.code,0);assert.deepEqual(f.deletes,[own]);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM report_uploads WHERE file_key=?').get(foreign).n,1);});
test('deleting one report retains an attachment still referenced by another',async t=>{const f=fixture(t);f.add([own]);f.add([own],10,2);const r=await f.call('delete /:id');assert.equal(r.body.code,0);assert.deepEqual(f.deletes,[]);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM report_uploads WHERE file_key=?').get(own).n,1);});
test('principal deletes branch report using original uploader ownership',async t=>{const f=fixture(t);f.add([own]);const r=await f.call('delete /:id',{user:{id:1,role:'admin'}});assert.equal(r.body.code,0);assert.deepEqual(f.deletes,[own]);});
test('another branch cannot delete a report or attachment',async t=>{const f=fixture(t);f.add([own]);const r=await f.call('delete /:id',{user:{id:20,role:'branch'}});assert.notEqual(r.body.code,0);assert.deepEqual(f.deletes,[]);});
test('cloud read-only preflight preserves report and owned attachment',async t=>{const f=fixture(t);f.add([own]);f.store.CLOUD_READ_ONLY=true;f.store.assertDeleteAllowed=()=>{const e=new Error('云存储只读');e.code='STORAGE_CLOUD_READ_ONLY';throw e;};const r=await f.call('delete /:id');assert.notEqual(r.body.code,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM ai_reports').get().n,1);assert.deepEqual(f.deletes,[]);});
test('scan upload ownership belongs to the teacher who issued token',async t=>{const f=fixture(t),token=await f.call('post /scan-token');const r=await f.call('post /',{scan:true,query:{token:token.body.data.token},files:[{originalname:'x.jpg',mimetype:'image/jpeg',buffer:Buffer.from('synthetic')}]});assert.equal(r.body.code,0);assert.equal(f.raw.prepare("SELECT created_by FROM report_uploads WHERE file_key='report/202611/3333333333333333.jpg'").get()?.created_by,10);});
