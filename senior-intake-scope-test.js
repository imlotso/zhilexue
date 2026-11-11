'use strict';
// Pure validation and VM handlers only: never load src/db or account configuration.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const intakeScope = require('./src/intake-scope');
const treeIo = require('./src/treeio');
const noDb = { prepare() { throw new Error('Unexpected database access'); } };
for (const scope of [{ stage: 'senior' }, { stage: '高中' }, { stage: 'SENIOR' }, { stage: 'junior', grade: '高一' }, { grade: '高二上学期' }, { stage: '', grade: '高三' }]) {
  test('intake refuses high-school scope ' + JSON.stringify(scope), () => {
    assert.throws(() => intakeScope(noDb, scope), /高中/);
  });
}
test('primary and junior intake preserve their classification', () => {
  for (const stage of ['primary', 'junior']) assert.equal(intakeScope(noDb, { stage, grade: '七年级' }).stage, stage);
  assert.equal(intakeScope(noDb, {}).stage, '');
});
test('tree imports reject senior trees before any database access', () => {
  const doc = {format:'zhilexue-tree',version:1,kind:'knowledge',subject:'数学',stage:'senior',nodes:['合成节点']};
  assert.throws(() => treeIo.importAll(noDb, doc), /高中/);
  assert.throws(() => treeIo.importDoc(noDb, {...doc,edition:''}), /高中/);
});
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SchoolScope = require('./src/school-scope');
const treePick = require('./src/treepick');
function productionFunction(file, start, end, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  const context = { SchoolScope, db: noDb, ...globals };
  return vm.runInNewContext(source.slice(a, b) + '\n' + /function (\w+)/.exec(start)[1], context);
}
test('direct question normalization refuses high school before content normalization', () => {
  const normalize = productionFunction('src/mfbank.js', 'function normalizeQ(', "admin.post('/questions',");
  for (const scope of [{stage:'senior'},{grade:'高三'}]) assert.match(normalize({stem:'合成题',type:'answer',...scope}).err, /高中/);
});
test('run commits reject high school from the card, package card, batch, or override before SQL', () => {
  const commit = productionFunction('src/mfbank.js', 'function commitRunCards(', "admin.post('/intake/runs/:id/commit',");
  for (const [run, cards, options] of [[{},[{stage:'senior'}],{}],[{},[{_q:{grade:'高二'}}],{}],[{stage:'senior'},[{}],{}],[{},[{}],{grade:'高一'}]]) {
    assert.throws(() => commit(run,cards,options), /高中/);
  }
});
test('capture commits reject high school batch and individual metadata before SQL', () => {
  const commit = productionFunction('src/mfbank.js', 'function commitCaptureItems(', "admin.post('/capture/batches/:id/commit',");
  for (const [batch, cards, options] of [[{stage:'senior'},[{}],{}],[{},[{stage:'senior'}],{}],[{},[{meta:{stage:'高中'}}],{}],[{},[{}],{grade:'高三'}]]) {
    assert.throws(() => commit(batch,cards,options), /高中/);
  }
});
test('default editions cannot enable senior and reads hide legacy senior defaults without writes', () => {
  assert.throws(() => treePick.setDefaultEditions(noDb, {数学:{senior:'人教版'}}), /高中/);
  const db = {prepare(){return {get(){return {v:JSON.stringify({数学:{senior:'人教版',junior:'测试版'}})};}};}};
  assert.equal(treePick.getDefaultEditions(db).数学.senior, undefined);
  assert.equal(treePick.getDefaultEditions(db).数学.junior, '测试版');
});
test('tree selection never returns a stored senior tree', () => {
  assert.equal(treePick.pickFrom([{id:1,kind:'knowledge',subject:'数学',stage:'senior'}],{kind:'knowledge',subject:'数学',stage:'senior'},{}),null);
});
test('scope SQL and JS share the same senior classification without excluding physics or chemistry', () => {
  const Database = require('better-sqlite3'), db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE questions (stage TEXT, grade TEXT)');
    const rows = [{stage:' SENIOR ',grade:''},{stage:'高中',grade:''},{stage:'junior',grade:'高一上册'},{stage:'junior',grade:'11 年级'},{stage:'',grade:'十二年级'},{stage:'',grade:'高二'},{stage:'primary',grade:'六年级'},{stage:'junior',grade:'九年级'},{stage:null,grade:null}];
    for (const row of rows) db.prepare('INSERT INTO questions VALUES (?,?)').run(row.stage,row.grade);
    const allowed = db.prepare('SELECT * FROM questions q WHERE ' + SchoolScope.supportedSql('q')).all().map(r=>({...r}));
    assert.deepEqual(allowed, rows.filter(row=>!SchoolScope.isSeniorScope(row)));
  } finally {db.close();}
});
test('collected tree rejects Chinese high-school grade before subject lookup', () => {
  const importTree = productionFunction('src/mfcollect.js', 'function importTreeCore(', '// admin /collect-tree', {normStage:()=>'',normSubjectLabel:()=>{throw new Error('Unexpected dictionary lookup');}});
  const result = importTree({stage:'高一',nodes:[{site_node_id:'1',name:'合成节点'}]});
  assert.match(result.msg, /高中/);
});
test('pending single edits reject a senior patch before changing any draft', () => {
  const edit = productionFunction('src/mfpending.js', 'function editPendingItem(', "  admin.put('/ext/pending/item',", {ok:()=>{},fail:(_,msg)=>msg,parseId:()=>({kind:'run',batch:1,index:0}),scanAccessError:()=>''});
  assert.match(edit({body:{id:'run:1:0',patch:{stage:'senior'}}},{}), /高中/);
});
test('pending run creation rejects high-school item data even under junior defaults', () => {
  const create = productionFunction('src/mfpending.js', 'function createRun(', '  function manualFigures(', {require(name){if(name==='./intake-scope') return intakeScope;throw new Error('Unexpected dependency');}});
  assert.throws(() => create({subject:'数学',stage:'junior',cards:[{grade:'高三'}]}), /高中/);
});
for (const grade of ['10年级','11 年级','12年级','十年级','十一年级','十二年级','高1年级','高2年级','高3年级']) {
  test('numeric high school grade is refused: ' + grade, () => assert.throws(() => intakeScope(noDb,{stage:'junior',grade}),/高中/));
}
test('content detection does not inspect prose that mentions high school', () => {
  assert.equal(SchoolScope.contentScopeError({stage:'junior',grade:'七年级',stem:'提高一题的分数，高中作为背景资料',answer:'高三'}),'');
});
const kb = require('./src/kbtree');
test('legacy knowledge-tree writers reject high school before creating nodes', () => {
  assert.throws(() => kb.ensureKnowledgeTree(noDb,'数学','senior'),/高中/);
  assert.throws(() => kb.addUnit(noDb,'数学','junior','高三','合成节点',0),/高中/);
  assert.throws(() => kb.mergeGenerated(noDb,'数学','junior','高三',[]),/高中/);
});
test('recognized high-school classification is rejected before card normalization can discard it', () => {
  const norm = productionFunction('src/mfbank.js','function normCards(', '// 模型转写内容', {require(){throw new Error('Normalization boundary reached');}});
  assert.throws(() => norm({questions:[{stage:'senior',stemMarkdown:'合成题'}]},1,[],'数学'),/高中/);
});
test('normalization cannot hide an existing senior question by clearing its stage', () => {
  const normalize = productionFunction('src/mfbank.js','function normalizeQ(',"admin.post('/questions',");
  assert.match(normalize({stage:'',stem:'合成题',type:'answer'},{stage:'senior',grade:''}).err,/高中/);
});
test('a legacy senior empty basket does not block a new junior capture', async () => {
  const Database = require('better-sqlite3'), db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE mf_capture_batches(id INTEGER PRIMARY KEY,title TEXT,site TEXT,url TEXT,subject TEXT,stage TEXT,grade TEXT,payload TEXT,status TEXT,paper_mode INTEGER DEFAULT 0,created_at TEXT); INSERT INTO mf_capture_batches(id,title,stage,grade,payload,status) VALUES(1,'历史高中空篮','senior','高一','[]','pending')");
    const before = {...db.prepare('SELECT * FROM mf_capture_batches WHERE id=1').get()};
    const source=fs.readFileSync(path.join(__dirname,'src/mfbank.js'),'utf8'),a=source.indexOf("cap.post('/push',"),b=source.indexOf('/** 后台自己粘贴',a);
    let handler; const result={};
    vm.runInNewContext(source.slice(a,b),{SchoolScope,db,cap:{post:(route,...handlers)=>{handler=handlers.at(-1);}},intakeReceipts:{middleware:()=>()=>{},guard:f=>f,commit:(req,fn)=>fn()},
      require(name){assert.equal(name,'./capture-images');return {storeImages:async questions=>({questions,failed:0})};},store:{},bankFolder:()=> 'bank',jstr:JSON.stringify,now:()=> '2026-11-11',ok:(res,data)=>{res.code=0;res.data=data;},fail:(res,msg)=>{res.code=1;res.msg=msg;}});
    await handler({body:{title:'新初中采集',stage:'junior',grade:'七年级',questions:[{stem:'合成题',type:'answer'}]}},result);
    assert.equal(result.code,0,result.msg);assert.equal(result.data.id,2);assert.deepEqual({...db.prepare('SELECT * FROM mf_capture_batches WHERE id=1').get()},before);
  } finally {db.close();}
});
