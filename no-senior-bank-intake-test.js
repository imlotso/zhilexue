'use strict';
// Production request handlers on synthetic memory data. No app, real database,
// AI requests, uploads, or filesystem writes are used.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let open;try {const Database=require('better-sqlite3');open=()=>new Database(':memory:');} catch(_){const {DatabaseSync}=require('node:sqlite');open=()=>new DatabaseSync(':memory:');}
const source=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8');
function slice(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b+end.length);}
function fixture(t){
 const db=open();t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,grade TEXT,stage TEXT);
 INSERT INTO users VALUES(1,'八年级','junior'),(2,'高一','senior');
 CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,grade TEXT,subject TEXT);
 INSERT INTO videos VALUES(1,1,'八年级','物理'),(2,2,'','物理');
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,stage TEXT,grade TEXT,subject TEXT);
 INSERT INTO chapters VALUES(1,'junior','八年级','物理'),(2,'senior','','物理');
 CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER);
 INSERT INTO sections VALUES(1,1),(2,2);
 CREATE TABLE mf_recog_runs(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,source_kind TEXT,source_name TEXT,status TEXT,pages TEXT,drafts TEXT,ocr_texts TEXT,error TEXT,created_at TEXT);
 CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY,user_id INTEGER,subject TEXT,grade TEXT,stage TEXT,stem_text TEXT,answer TEXT,chapter TEXT,point TEXT,error_type TEXT,note TEXT,images TEXT,status TEXT,created_at TEXT);`);
 require('./school-scope-test-fixture')(db);
 const routes={},writes=[];
 const box={db,require:n=>require(path.resolve(__dirname,'src',n)),TYPES:['single','multi','judge','fill','sort','answer'],LETTERS:'ABCDEFGHIJ',SUBJECTS:['数学','英语','物理','化学'],KB_EDITIONS:{数学:{primary:'苏教版'}},resolveDifficulty:require('./src/difficulty').resolveDifficulty,
   ok:(r,data)=>r.data=data,okUp:(r,data)=>r.data=data,fail:(r,error)=>r.error=error,now:()=>'',parseUp:r=>r,
   admin:{post:(p,...f)=>routes[p]=f.at(-1)},up:{post:(p,...f)=>routes['up'+p]=f.at(-1)},
   upload:{single:()=>()=>{}},upAuth:()=>{},upUpload:{array:()=>()=>{}},uploadReceipts:{guard:fn=>fn,commit:(_,fn)=>fn()},
   fs:{writeFileSync:(...a)=>writes.push(a)},path,UP_DIR:'/synthetic',crypto:{randomBytes:()=>({toString:()=> 'synthetic'})},
   aiRecognizeUpload:async()=>{},recognizeTeacherPhoto:async()=>{},parseBankWorkbook:()=>({items:[],errors:[]})};
 vm.createContext(box);vm.runInContext(slice('function normalizeBankQ(','\n}'),box);vm.runInContext(slice('const stageOfGrade =','\n};'),box);
 vm.runInContext(slice("admin.post('/questions/import',",'\n});'),box);
 vm.runInContext(slice("admin.post('/kbtree/generate',",'\n});'),box);
 vm.runInContext(slice("admin.post('/kbtree/unit',",'\n});'),box);
 vm.runInContext(slice("admin.post('/kbtree/point',",'\n});'),box);
 const a=source.indexOf("up.post('/submit',"),b=source.indexOf('\n}));',a);vm.runInContext(source.slice(a,b+5),box);
 const call=(route,body={},extra={})=>{const res={};return Promise.resolve(routes[route]({body,file:{buffer:Buffer.from('test')},files:[{mimetype:'image/png',buffer:Buffer.from('synthetic')}],upUid:1,upRole:'up',upDefaults:{},...extra},res)).then(()=>res);};
 return {db,box,writes,call};
}
const valid={type:'single',stem:'初中题',options:['甲','乙'],answer:'A',subject:'物理',stage:'junior',grade:'八年级'};
test('old bank normalization rejects explicit, inherited and linked high-school scopes without relabeling',t=>{
 const f=fixture(t);
 for(const b of [{...valid,stage:'senior'},{...valid,grade:'高一'},{...valid,video_id:2},{...valid,section_id:2},{...valid,chapter_id:2}]) assert.match(f.box.normalizeBankQ(b).err,/高中/);
 assert.match(f.box.normalizeBankQ(valid,{stage:'senior',grade:'高一'}).err,/高中/);
 assert.equal(f.box.normalizeBankQ(valid).q.grade,'八年级');assert.equal(f.writes.length,0);
});
test('old Excel import refuses a mixed high-school row batch and invalid defaults before staging',async t=>{
 const f=fixture(t);f.box.parseBankWorkbook=()=>({items:[{...valid},{...valid,stage:'',grade:'高二'}],errors:[]});
 assert.match((await f.call('/questions/import',{})).error,/高中/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mf_recog_runs').get().n,0);
 f.box.parseBankWorkbook=()=>({items:[valid],errors:[]});assert.match((await f.call('/questions/import',{stage:'senior'})).error,/高中/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mf_recog_runs').get().n,0);
 assert.equal((await f.call('/questions/import',{})).data.imported,1);
});
test('student/teacher scan upload rejects body, inherited account and signed high-school scope before saving files',async t=>{
 const f=fixture(t);
 for(const [body,extra] of [[{grade:'高一'},{}],[{stage:'senior'},{}],[{}, {upUid:2}],[{subject:'物理',grade:'八年级'},{upRole:'upteacher',upDefaults:{stage:'senior'}}]]) {
   assert.match((await f.call('up/submit',body,extra)).error,/高中/);
 }
 assert.equal(f.writes.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM paper_uploads').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mf_recog_runs').get().n,0);
});
test('legacy knowledge APIs reject high-school scope before AI or changes and expose controlled errors',async t=>{
 const f=fixture(t);let changes=0;
 f.box.kbtree={addUnit:()=>{changes++;return 1;},addPoint:()=>{throw Error('暂不支持高中内容，请选择小学或初中');}};
 assert.match((await f.call('/kbtree/unit',{subject:'数学',stage:'senior',name:'单元'})).error,/高中/);
 assert.match((await f.call('/kbtree/point',{unit_id:2,name:'知识点'})).error,/高中/);
 assert.match((await f.call('/kbtree/generate',{subject:'数学',stage:'primary',grade:'高三'})).error,/高中/);
 assert.equal(changes,0);
});

test('AI classification rejects high-school output instead of silently relabeling it junior',async t=>{
 const f=fixture(t);f.box.kbtree={unitLines:()=>[]};
 const originalRequire=f.box.require;
 f.box.require=n=>n==='./ai'?{chat:async()=>({text:'{"stage":"senior","grade":"高一","unit":"高中函数"}'})}:originalRequire(n);
 vm.runInContext(slice("admin.post('/ai-attri',",'\n});'),f.box);
 const r=await f.call('/ai-attri',{subject:'数学',stem:'synthetic question'});
 assert.match(r.error,/高中/);assert.equal(r.data,undefined);
});
test('lesson Word import rejects high-school targets before parsing or staging',async t=>{
 const f=fixture(t);let parses=0;
 const originalRequire=f.box.require;
 f.box.require=n=>n==='./docxtext'?{parseDocx:async()=>{parses++;return {paras:[],figs:[]};},parseDocxQuestions:()=>({list:[]})}:originalRequire(n);
 vm.runInContext(slice('async function importLessonDocx(','\n}'),f.box);
 f.db.exec("INSERT INTO videos(id,chapter_id,grade,subject) VALUES(3,1,'高一','物理'),(4,1,'','物理'); INSERT INTO bank_trees(id,stage) VALUES(1,'senior'); INSERT INTO bank_tree_nodes(id,tree_id) VALUES(1,1); INSERT INTO video_nodes VALUES(4,1)");
 for(const [kind,id] of [['video',2],['section',2],['video',3],['video',4]]) {
   const res={};await f.box.importLessonDocx({params:{id},body:{},file:{originalname:'test.docx',buffer:Buffer.from('synthetic')}},res,kind);
   assert.match(res.error,/高中/);
 }
 assert.equal(parses,0);assert.equal(f.writes.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mf_recog_runs').get().n,0);
});
