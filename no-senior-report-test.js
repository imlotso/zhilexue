'use strict';
// Real Express/multer routes, synthetic memory DB and inert storage/AI boundaries.
// Never load application configuration, production DB, storage credentials or AI.
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Database=require('better-sqlite3'),express=require('express');
const source=fs.readFileSync(path.join(__dirname,'src/report.js'),'utf8');
async function fixture(t) {
 const raw=new Database(':memory:');
 raw.exec(`CREATE TABLE users(id INTEGER,role TEXT,name TEXT);
 CREATE TABLE report_uploads(file_key TEXT PRIMARY KEY,created_by INTEGER,created_at TEXT);
 CREATE TABLE ai_reports(id INTEGER PRIMARY KEY,title TEXT,student TEXT,subject TEXT,grade TEXT,paper_keys TEXT,status TEXT,model TEXT,report TEXT,error TEXT,created_by INTEGER,created_at TEXT);
 INSERT INTO ai_reports VALUES(1,'历史高中报告','合成学生','数学','高一','["report/old.jpg"]','done','old-model','{"old":true}','',7,'2026-01-01');
 INSERT INTO ai_reports VALUES(2,'历史待处理高中报告','合成学生','物理','十二年级','["report/old2.jpg"]','pending','','','旧状态',7,'2026-01-01');`);
 raw.prepare('INSERT INTO report_uploads VALUES(?,?,?)').run('report/202611/1111111111111111.jpg',7,'synthetic');
 const beforeStartup=JSON.stringify(raw.prepare('SELECT * FROM ai_reports ORDER BY id').all());
 const calls={save:0,read:0,ai:0,delete:0};
 const store={saveFile:async()=>{calls.save++;return {key:'report/202611/2222222222222222.jpg'};},readBuffer:async()=>{calls.read++;return Buffer.from('synthetic');},assertDeleteAllowed:()=>{},deleteFile:async()=>{calls.delete++;}};
 const ai={analyzePaper:async()=>{calls.ai++;return {report:{synthetic:true},model:'mock'};},normalizeReport:x=>x,getConfig:()=>({mock:true})};
 const module={exports:{}};
 const context={module,Buffer,console,require:name=>{
  if(name==='express'||name==='multer'||name==='crypto')return require(name);
  if(name==='./db')return {db:raw};if(name==='./storage')return store;if(name==='./ai')return ai;if(name==='./pdfimg')return {};
  if(name==='./report-file-access')return require('./src/report-file-access');
  if(name==='./school-scope')return require('./src/school-scope');
  throw new Error('Forbidden dependency in isolated report test: '+name);
 }};
 vm.runInNewContext(source,context,{filename:'report.js'});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:7,role:'admin'};next();});app.use('/api/admin/report',module.exports);app.use('/api/report-scan',module.exports.scan);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});raw.close();});
 const base='http://127.0.0.1:'+server.address().port;
 async function request(url,body,method='POST'){
  const form=body instanceof FormData;
  const res=await fetch(base+url,{method,headers:body&&!form?{'content-type':'application/json'}:undefined,body:body?(form?body:JSON.stringify(body)):undefined});
  const result=await res.json();await new Promise(setImmediate);return result;
 }
 function photos(scope){const form=new FormData();for(const [key,value]of Object.entries(scope))form.set(key,value);form.append('images',new Blob(['synthetic'],{type:'image/jpeg'}),'synthetic.jpg');return form;}
 return {raw,calls,request,photos,beforeStartup,runAnalysis:context.runAnalysis,snapshot:()=>JSON.stringify(raw.prepare('SELECT * FROM ai_reports ORDER BY id').all())};
}
for(const scope of [{grade:'高一'},{grade:'11年级'},{stage:' SENIOR ',grade:'七年级'}])test('report creation rejects high-school classifications before DB/AI '+JSON.stringify(scope),async t=>{
 const f=await fixture(t),before=f.snapshot();const r=await f.request('/api/admin/report',{...scope,paperKeys:['report/202611/1111111111111111.jpg']});
 assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,{save:0,read:0,ai:0,delete:0});
});
for(const url of ['/api/admin/report/papers','/api/report-scan'])test('report photo upload rejects high-school before storage '+url,async t=>{
 const f=await fixture(t),before=f.snapshot();const token=(await f.request('/api/admin/report/scan-token',{})).data.token;
 const r=await f.request(url+(url.endsWith('report-scan')?'?token='+token:''),f.photos({grade:'高 2 年级'}));
 assert.notEqual(r.code,0);assert.match(r.msg,/高中/);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,{save:0,read:0,ai:0,delete:0});
});
test('historical high-school retry and background execution leave records untouched',async t=>{
 const f=await fixture(t),before=f.snapshot();const r=await f.request('/api/admin/report/1/retry',{});
 assert.notEqual(r.code,0);assert.match(r.msg,/高中/);await f.runAnalysis(1);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,{save:0,read:0,ai:0,delete:0});
});
test('module startup does not rewrite historical high-school pending reports',async t=>{
 const f=await fixture(t);assert.equal(f.snapshot(),f.beforeStartup);
});
test('historical high-school reports remain readable and explicitly deletable',async t=>{
 const f=await fixture(t);const r=await f.request('/api/admin/report/1',null,'GET');assert.equal(r.code,0);assert.equal(r.data.grade,'高一');assert.equal(r.data.report.old,true);
 const deleted=await f.request('/api/admin/report/1',null,'DELETE');assert.equal(deleted.code,0);assert.equal(f.raw.prepare('SELECT id FROM ai_reports WHERE id=1').get(),undefined);assert.equal(f.calls.delete,0);assert.equal(deleted.data.retained_files,1,'legacy unverified attachment must be preserved');
});
test('junior creation and scan uploads still analyze, without inspecting report titles',async t=>{
 const f=await fixture(t);const r=await f.request('/api/admin/report',{grade:'七年级',title:'高一题只是标题',paperKeys:['report/202611/1111111111111111.jpg']});assert.equal(r.code,0);
 const token=(await f.request('/api/admin/report/scan-token',{})).data.token;
 const scanned=await f.request('/api/report-scan?token='+token,f.photos({grade:'九年级',subject:'物理'}));assert.equal(scanned.code,0);
 assert.equal(f.calls.save,1);assert.equal(f.calls.ai,2);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ai_reports WHERE id>2 AND status='done'").get().n,2);
});

for(const key of ['report/old.jpg','report/202611/3333333333333333.jpg'])test('junior creation still rejects unverified or foreign attachments '+key,async t=>{
 const f=await fixture(t);f.raw.prepare('INSERT INTO report_uploads VALUES(?,?,?)').run('report/202611/3333333333333333.jpg',8,'synthetic');const before=f.snapshot();
 const result=await f.request('/api/admin/report',{grade:'七年级',paperKeys:[key]});
 assert.notEqual(result.code,0);assert.match(result.msg,/附件|账号|上传/);assert.equal(f.snapshot(),before);assert.deepEqual(f.calls,{save:0,read:0,ai:0,delete:0});
});
test('verified attachment does not allow retrying a historical high-school report',async t=>{
 const f=await fixture(t);f.raw.prepare('UPDATE ai_reports SET paper_keys=? WHERE id=1').run(JSON.stringify(['report/202611/1111111111111111.jpg']));const before=f.snapshot();
 const result=await f.request('/api/admin/report/1/retry',{});assert.notEqual(result.code,0);assert.match(result.msg,/高中/);assert.equal(f.snapshot(),before);assert.equal(f.calls.ai,0);
});
