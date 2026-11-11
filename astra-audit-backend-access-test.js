'use strict';
// Real SQL and route/function bodies, synthetic in-memory users/content only.
const { test }=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let Database;try{Database=require('better-sqlite3');new Database(':memory:').close();}catch(_){Database=require('node:sqlite').DatabaseSync;}
const source=fs.readFileSync(path.join(__dirname,'src/app.js'),'utf8');
const branch={id:10,role:'branch'},admin={id:1,role:'admin'},student={id:101,role:'student'};
function fixture(t){
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER,role TEXT,name TEXT,username TEXT,grade TEXT,stage TEXT,term TEXT,created_by INTEGER);
 INSERT INTO users VALUES(101,'student','Own','own','一年级','primary','上册',10),(201,'student','Foreign','foreign','九年级','junior','下册',20),(10,'branch','Branch','branch','','','',1),(1,'admin','Admin','admin','','','',NULL);
 CREATE TABLE progress(user_id INTEGER,video_done INTEGER,handout_done INTEGER,updated_at TEXT);
 CREATE TABLE chapters(id INTEGER,name TEXT,grade TEXT,stage TEXT,term TEXT,category TEXT);
 INSERT INTO chapters VALUES(1,'Visible','一年级','primary','上册','同步基础'),(2,'Hidden','九年级','junior','下册','同步基础'),(3,'Special','六年级','primary','下册','专项提升');
 CREATE TABLE videos(id INTEGER,title TEXT,level TEXT,duration INTEGER,file_path TEXT,url TEXT,chapter_id INTEGER,sort INTEGER);
 INSERT INTO videos VALUES(1,'Visible','',1,'videos/visible.mp4','',1,0),(2,'Hidden','',1,'videos/hidden.mp4','',2,0),(3,'Special','',1,'videos/special.mp4','',3,0),(4,'Orphan','',1,'videos/orphan.mp4','',999,0),(5,'Standalone','',1,'videos/standalone.mp4','',NULL,0),(6,'Other folder hidden','',1,'misc/hidden.mp4','',2,0),(7,'Proxy url hidden','',1,'','/api/file?inline=1&key=misc%2Furl.mp4',2,0);`);
 db.exec(`ALTER TABLE videos ADD COLUMN section_id INTEGER; ALTER TABLE videos ADD COLUMN grade TEXT;
 CREATE TABLE sections(id INTEGER,chapter_id INTEGER,grade TEXT,stage TEXT);
 CREATE TABLE handouts(id INTEGER,file_path TEXT,chapter_id INTEGER,section_id INTEGER,grade TEXT,stage TEXT);
 CREATE TABLE video_nodes(video_id INTEGER,node_id INTEGER);
 CREATE TABLE bank_tree_nodes(id INTEGER,tree_id INTEGER);
 CREATE TABLE bank_trees(id INTEGER,stage TEXT);
 INSERT INTO chapters VALUES(4,'Senior','高一','senior','上册','专项提升');
 INSERT INTO videos(id,title,file_path,chapter_id,grade) VALUES(8,'Senior direct','videos/senior.mp4',NULL,'高一'),(9,'Senior course','videos/senior-course.mp4',4,''),(10,'Senior tree','videos/senior-tree.mp4',NULL,''),(11,'Senior section','videos/senior-section.mp4',NULL,'');
 INSERT INTO bank_trees VALUES(1,'senior'); INSERT INTO bank_tree_nodes VALUES(1,1); INSERT INTO video_nodes VALUES(10,1);
 INSERT INTO sections VALUES(1,NULL,'高二','senior'); UPDATE videos SET section_id=1 WHERE id=11;
 INSERT INTO handouts VALUES(1,'handouts/senior.pdf',4,NULL,'','');
 INSERT INTO videos(id,title,url,grade) VALUES(12,'Senior proxy','/api/file?key=misc%2Fsenior-url.mp4','高一'),(13,'Junior proxy','/api/file?key=misc%2Fjunior-url.mp4','七年级'); UPDATE videos SET sort=0 WHERE id IN (12,13);`);
 let captured;const reads=[];
 const context={db,require:n=>require(path.join(__dirname,'src',n)),fileAuth:()=>{},careAudio:{protectFile:()=>false},
  FILE_KEY_RE:/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]{1,8}$/,RISKY_EXT:['html'],INLINE_MIME:{png:'image/png'},
  store:{localPath:k=>'/synthetic/'+k,isCloudKey:k=>{reads.push(k);return true;},getUrl:async k=>'https://synthetic.invalid/'+k,localFilePath:()=>null,readBuffer:async k=>{reads.push(k);return Buffer.from('fake');}},
  ok:(r,data)=>r.json({code:0,data}),fail:(r,msg,code=1)=>r.json({code,msg}),studentReport:(id,u)=>({id,user:u}),
  app:{get:(_, ...f)=>captured=f.at(-1)},admin:{get:(_,fn)=>captured=fn},stu:{get:(_,fn)=>captured=fn}};
 const stage=source.slice(source.indexOf('const PRIMARY_GRADES'),source.indexOf('const STAGE_NAME'));
 const visibility=source.slice(source.indexOf('function visibleChapterWhere'),source.indexOf('const SUBJECT_ORDER'));
 const scopeStart=source.indexOf('function legacyScopeError('),scopeEnd=source.indexOf('\n}\n',scopeStart)+2;
 vm.runInNewContext(source.slice(scopeStart,scopeEnd)+'\n'+stage+'\n'+visibility,context);
 async function call(owner,route,{user=branch,id=101,query={}}={}){
  const start=source.indexOf(`${owner}.get('${route}',`),end=source.indexOf('\n});',start);assert.ok(start>=0&&end>start);
  vm.runInNewContext(source.slice(start,end+4),context);
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;},setHeader(){},redirect(url){this.url=url;return this;},end(b){this.bytes=b;return this;}};
  await captured({user,params:{id},query},res);return res;
 }
 return{db,call,reads};
}
test('legacy student list is scoped to the branch in SQL',async t=>{const f=fixture(t),r=await f.call('admin','/reports/students');assert.deepEqual(Array.from(r.body.data,x=>x.id),[101]);});
test('principal legacy list still includes students in all branches',async t=>{const f=fixture(t),r=await f.call('admin','/reports/students',{user:admin});assert.deepEqual(Array.from(r.body.data,x=>x.id).sort(),[101,201]);});
for(const id of [201,10,1])test('legacy detail rejects foreign or nonstudent '+id,async t=>{const f=fixture(t),r=await f.call('admin','/reports/student/:id',{id});assert.notEqual(r.body.code,0);});
test('own student detail remains available',async t=>{const f=fixture(t),r=await f.call('admin','/reports/student/:id');assert.equal(r.body.code,0);});
test('video list without chapter excludes invisible and dangling courses',async t=>{const f=fixture(t),r=await f.call('stu','/videos',{user:student});assert.deepEqual(Array.from(r.body.data,x=>x.id),[1,3,5,13]);});
test('explicit visible chapter list stays available',async t=>{const f=fixture(t),r=await f.call('stu','/videos',{user:student,query:{chapter_id:1}});assert.deepEqual(Array.from(r.body.data,x=>x.id),[1]);});
for(const key of ['videos/hidden.mp4','videos/orphan.mp4','videos/unregistered.mp4','misc/hidden.mp4','misc/url.mp4','videos/senior.mp4','videos/senior-course.mp4','videos/senior-tree.mp4','videos/senior-section.mp4','handouts/senior.pdf'])test('generic file route denies hidden or unregistered video '+key,async t=>{
 const f=fixture(t),r=await f.call('app','/api/file',{user:student,query:{key}});assert.equal(r.statusCode,403);assert.equal(f.reads.length,0);assert.equal(r.url,undefined);
});
for(const key of ['videos/visible.mp4','videos/special.mp4','videos/standalone.mp4','bank/img/shared.png'])test('generic file route preserves visible or shared resource '+key,async t=>{const f=fixture(t),r=await f.call('app','/api/file',{user:student,query:{key}});assert.equal(r.statusCode,200);assert.ok(r.url);});
test('manager can preview an uploaded but not yet linked video',async t=>{const f=fixture(t),r=await f.call('app','/api/file',{user:admin,query:{key:'videos/unregistered.mp4'}});assert.equal(r.statusCode,200);assert.ok(r.url);});
test('public bank image ticket path is not blocked by video scope',async t=>{const f=fixture(t),r=await f.call('app','/api/file',{user:null,query:{key:'bank/img/shared.png'}});assert.equal(r.statusCode,200);assert.ok(r.url);});

test('proxy-only historical video cannot bypass high-school scope',async t=>{const f=fixture(t),r=await f.call('app','/api/file',{user:student,query:{key:'misc/senior-url.mp4'}});assert.equal(r.statusCode,403);assert.equal(f.reads.length,0);assert.equal(r.url,undefined);});

test('proxy-only supported junior video remains available',async t=>{const f=fixture(t),r=await f.call('app','/api/file',{user:student,query:{key:'misc/junior-url.mp4'}});assert.equal(r.statusCode,200);assert.ok(r.url);});
