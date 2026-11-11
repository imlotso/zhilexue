'use strict';
// Real app.js route handlers, SQL and Excel parser; disposable memory only.
// Never load src/db.js, account credentials, cloud storage or the HTTP server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const source = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b + end.length);
}
function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,username TEXT,password TEXT,name TEXT,phone TEXT,
    grade TEXT,stage TEXT,term TEXT,subject TEXT,level TEXT,allow_speed INTEGER,allow_seek INTEGER,avatar TEXT,
    expire_at TEXT,created_by INTEGER,created_at TEXT,status INTEGER);
    CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,grade TEXT,remark TEXT,created_at TEXT);
    CREATE TABLE chapters(id INTEGER PRIMARY KEY,subject TEXT,grade TEXT,term TEXT,book TEXT,name TEXT,code TEXT,
      sort INTEGER,category TEXT,stage TEXT,created_at TEXT);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,chapter_id INTEGER,subject TEXT,stage TEXT DEFAULT '',grade TEXT,
      type TEXT,stem TEXT,options TEXT,answer TEXT,analysis TEXT,difficulty INTEGER,difficulty_score_10 INTEGER,sort INTEGER,created_at TEXT);
    CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER,name TEXT,sort INTEGER,created_at TEXT);
    CREATE TABLE videos(id INTEGER PRIMARY KEY,chapter_id INTEGER,section_id INTEGER,subject TEXT,grade TEXT,
      title TEXT,file_path TEXT,url TEXT,duration INTEGER,level TEXT,sort INTEGER,created_at TEXT);
    CREATE TABLE handouts(id INTEGER PRIMARY KEY,chapter_id INTEGER,video_id INTEGER,section_id INTEGER,kind TEXT,
      subject TEXT,grade TEXT,title TEXT,file_path TEXT,file_name TEXT,ext TEXT,size INTEGER,level TEXT,created_at TEXT);
    INSERT INTO users(id,role,username,name,grade,stage,expire_at,created_by) VALUES
      (1,'student','junior','初中学生','八年级','junior','2027-01-01',1),
      (2,'student','senior','历史学生','高一','junior','2027-01-01',1);
    INSERT INTO classes VALUES(1,'初中班','八年级','',''),(2,'历史班','高一','','');
    INSERT INTO chapters(id,subject,grade,name,code,stage,category,sort) VALUES
      (1,'物理','八年级','初中课程','J8','junior','同步基础',0),
      (2,'物理','','历史学段课程','S1','senior','专项提升',0),
      (3,'数学','高一','历史年级课程','S2','','同步基础',0),
      (4,'数学','一年级','小学课程','P1','primary','同步基础',0);
    INSERT INTO sections VALUES(1,1,'初中组',0,''),(2,2,'历史组',0,'');
    INSERT INTO videos VALUES(1,1,1,'物理','八年级','初中视频','','',0,'basic',0,''),
      (2,2,2,'物理','','历史视频','','',0,'basic',0,'');
    INSERT INTO handouts(id,chapter_id,video_id,section_id,title,grade) VALUES
      (1,1,1,1,'初中讲义','八年级'),(2,2,2,2,'历史讲义','');
    INSERT INTO questions(id,chapter_id,subject,stage,grade,type,stem,options,answer,difficulty,difficulty_score_10) VALUES
      (1,1,'物理','junior','八年级','single','初中题','["1","2"]','A',3,5),
      (2,2,'物理','senior','','single','历史题','["1","2"]','A',3,5);`);
  require('./school-scope-test-fixture')(db);
  const handlers = {}, effects = [];
  const register = method => (route, ...args) => { handlers[method + ' ' + route] = args.at(-1); };
  const context = { db, path, console,
    require: name => name === './qmeta' ? { questionsAllowed: () => true } : require(path.resolve(__dirname, 'src', name)),
    admin: { post: register('POST'), put: register('PUT') },
    upload: {single:()=>()=>{}},videoUpload:{single:()=>()=>{},array:()=>()=>{}},
    ok: (res, data, msg) => Object.assign(res, { code:0, data, msg }),
    fail: (res, msg, code=1) => Object.assign(res, {code,msg}),
    now: () => '2026-11-11', hash: value => value, randAvatar: () => '',
    resolveDifficulty: require('./src/difficulty').resolveDifficulty,
    parseWorkbook: require('./src/excel').parseWorkbook,
    fixFileName: value=>value, dropTmp: f=>{if(f) effects.push('tmp');},
    dropStored: async()=>effects.push('delete'),
    store: { saveFile: async()=>{effects.push('save');return {key:'synthetic/key',size:1};} },
  };
  vm.createContext(context);
  const declarations = source.slice(source.indexOf('const PRIMARY_GRADES ='), source.indexOf('// 学生头像池'));
  vm.runInContext(declarations,context);
  for(const name of ['checkStudentFields','studentStage']) vm.runInContext(slice('const '+name+' =','\n};'),context);
  vm.runInContext("const TERMS=['上册','下册'];\n" + slice('function termText(', '\n}'),context);
  for(const name of ['normalizeQ','normSection','nextVideoSort']) vm.runInContext(slice('function '+name+'(', '\n}'),context);
  // Optional when running RED against the unmodified production source.
  if(source.includes('function legacyScopeError(')) vm.runInContext(slice('function legacyScopeError(', '\n}'),context);
  for(const [method,route] of [
    ['POST','/students'],['PUT','/students/:id'],['POST','/students/batch'],
    ['POST','/classes'],['PUT','/classes/:id'],['POST','/chapters'],['PUT','/chapters/:id'],
    ['POST','/sections'],['PUT','/sections/:id'],['POST','/questions'],['PUT','/questions/:id'],
    ['POST','/questions/import'],['POST','/handouts'],['PUT','/handouts/:id'],
    ['POST','/videos'],['PUT','/videos/:id'],['POST','/videos/batch'],
  ]) vm.runInContext(slice(`admin.${method.toLowerCase()}('${route}',`,'\n});'),context);
  return { db,effects,context,
    snapshot:()=>JSON.stringify(['users','classes','chapters','sections','questions','videos','handouts'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all())),
    async call(method,route,body={},id=1,extra={}) {
      const res={}; await handlers[method+' '+route]({body,params:{id},user:{id:1,role:'admin'},...extra},res); return res;
    },
  };
}
const student = {username:'new',name:'新学生',grade:'八年级',stage:'junior',expire_at:'2027-01-01'};
const chapter = {name:'新课程',subject:'物理',grade:'八年级',stage:'junior',category:'同步基础'};
const question = {chapter_id:1,subject:'物理',grade:'八年级',type:'single',stem:'新题',options:['1','2'],answer:'A'};
function rejected(result) { assert.notEqual(result.code,0); assert.match(result.msg,/高中/); }

for(const [stage,grade] of [['junior','高一'],['senior','八年级'],['primary','十年级'],['','高中三年级']]) {
  test(`student create and update reject raw ${stage}/${grade} without changing existing users`,async t=>{
    const f=fixture(t),before=f.snapshot();
    for(const [method,route] of [['POST','/students'],['PUT','/students/:id']]) rejected(await f.call(method,route,{...student,stage,grade}));
    assert.equal(f.snapshot(),before);
  });
}
test('student batch skips unsupported rows while retaining primary and junior accounts',async t=>{
  const f=fixture(t); const result=await f.call('POST','/students/batch',{list:[
    {...student,username:'bad',grade:'高一'},{...student,username:'primary',grade:'一年级',stage:''},student,
  ]});
  assert.equal(result.data.count,2); assert.equal(result.data.errs.length,1); assert.match(result.data.errs[0],/高中/);
  assert.equal(f.db.prepare("SELECT stage FROM users WHERE username='primary'").get().stage,'primary');
});
for(const [stage,grade,category] of [['senior','八年级','同步基础'],['','高一','同步基础'],['senior','','中考冲刺'],['junior','高二','专项提升']]) {
  test(`chapter create/update rejects raw scope before normalization: ${stage}/${grade}/${category}`,async t=>{
    const f=fixture(t),before=f.snapshot();
    for(const [method,route] of [['POST','/chapters'],['PUT','/chapters/:id']]) rejected(await f.call(method,route,{...chapter,stage,grade,category}));
    assert.equal(f.snapshot(),before);
  });
}
for(const patch of [{stage:'senior'}, {grade:'高一'}, {chapter_id:2}, {chapter_id:3}]) test('legacy question rejects explicit or inherited high-school scope '+JSON.stringify(patch),async t=>{
  const f=fixture(t),before=f.snapshot();
  for(const [method,route] of [['POST','/questions'],['PUT','/questions/:id']]) rejected(await f.call(method,route,{...question,...patch}));
  assert.equal(f.snapshot(),before);
});
test('editing historical rows cannot silently reclassify them as primary/junior',async t=>{
  const f=fixture(t),before=f.snapshot();
  for(const [route,body] of [['/students/:id',student],['/classes/:id',{name:'初中班',grade:'八年级'}],['/chapters/:id',chapter],['/questions/:id',question]]) rejected(await f.call('PUT',route,body,2));
  assert.equal(f.snapshot(),before);
});
for(const method of ['POST','PUT']) test(method+' class rejects high-school grades',async t=>{
  const f=fixture(t),before=f.snapshot(); rejected(await f.call(method,method==='POST'?'/classes':'/classes/:id',{name:'测试班',grade:'高三'}));assert.equal(f.snapshot(),before);
});
function workbook(rows) {
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'题库');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
test('Excel import validates the whole parsed batch before insertion, including hidden senior chapter metadata',async t=>{
  const f=fixture(t),before=f.snapshot(),row={题型:'单选题',题干:'合成题',选项A:'1',选项B:'2',答案:'A',章节编码:'J8',年级:'八年级'};
  for(const bad of [{年级:'高一'},{章节编码:'S1'},{章节编码:'S2',年级:'八年级'}]) {
    rejected(await f.call('POST','/questions/import',{},1,{file:{buffer:workbook([row,{...row,...bad}])}}));
    assert.equal(f.snapshot(),before);
  }
  const valid=await f.call('POST','/questions/import',{},1,{file:{buffer:workbook([row,{...row,章节编码:'P1',年级:''}])}});
  assert.equal(valid.code,0);assert.equal(valid.data.imported,2);
});
for(const [method,route,body,id,extra] of [
  ['POST','/sections',{chapter_id:2,name:'新分组'},1,{}],
  ['PUT','/sections/:id',{name:'新分组'},2,{}],
  ['POST','/handouts',{chapter_id:2,title:'新资料'},1,{file:{buffer:Buffer.from('file'),originalname:'test.pdf'}}],
  ['POST','/handouts',{chapter_id:1,video_id:2,title:'新资料'},1,{file:{buffer:Buffer.from('file'),originalname:'test.pdf'}}],
  ['POST','/handouts',{chapter_id:1,grade:'高二',title:'新资料'},1,{file:{buffer:Buffer.from('file'),originalname:'test.pdf'}}],
  ['PUT','/handouts/:id',{chapter_id:2,title:'新资料'},1,{}],
  ['PUT','/handouts/:id',{chapter_id:1,video_id:1,title:'新资料'},2,{}],
  ['POST','/videos',{chapter_id:2,title:'新视频'},1,{}],
  ['PUT','/videos/:id',{chapter_id:2,title:'新视频'},1,{}],
  ['PUT','/videos/:id',{chapter_id:1,section_id:1,title:'新视频'},2,{}],
  ['POST','/videos/batch',{chapter_id:2},1,{files:[{path:'/synthetic',originalname:'test.mp4'}]}],
]) test(method+' '+route+' refuses high-school linked resources before storage or writes '+JSON.stringify(body),async t=>{
  const f=fixture(t),before=f.snapshot(); rejected(await f.call(method,route,body,id,extra));
  assert.equal(f.snapshot(),before);assert.ok(!f.effects.some(effect=>effect==='save'||effect==='delete'));
});
test('supported students, classes, chapters, sections, questions and resources still save',async t=>{
  const f=fixture(t);
  for(const [method,route,body,extra] of [
    ['POST','/students',student],['PUT','/students/:id',{...student,username:'junior'}],
    ['POST','/classes',{name:'初中班',grade:'八年级'}],['PUT','/classes/:id',{name:'初中班',grade:'八年级'}],
    ['POST','/chapters',chapter],['PUT','/chapters/:id',chapter],
    ['POST','/sections',{chapter_id:1,name:'新分组'}],['PUT','/sections/:id',{name:'新分组'}],
    ['POST','/questions',question],['PUT','/questions/:id',question],
    ['POST','/handouts',{chapter_id:1,title:'新资料'},{file:{buffer:Buffer.from('file'),originalname:'test.pdf'}}],
    ['PUT','/handouts/:id',{title:'新资料'}],['POST','/videos',{chapter_id:1,title:'新视频'}],
    ['PUT','/videos/:id',{title:'新视频'}],['POST','/videos/batch',{chapter_id:1},{files:[{path:'/synthetic',originalname:'test.mp4'}]}],
  ]) assert.equal((await f.call(method,route,body,1,extra)).code,0,method+' '+route);
});
