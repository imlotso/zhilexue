'use strict';
// Full pending routes against a fresh in-memory DB. Never loads src/db or calls a live model.
process.env.STORAGE_DRIVER = 'local'; process.env.AI_MOCK = '1'; process.env.TTS_MOCK = '1';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const Review = require('./src/ai-answer-review');
const principal = { id: 1, role: 'admin' }, branch = { id: 10, role: 'branch' };
function fixture(t, captureModel = false) {
  const raw = openMemory(); t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, created_by INTEGER, name TEXT);
    INSERT INTO users VALUES(101,'student',10,'A学生'),(201,'student',20,'B学生');
    CREATE TABLE mf_recog_runs(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,source_kind TEXT,status TEXT,error TEXT,drafts TEXT,pages TEXT,created_at TEXT);
    CREATE TABLE mf_capture_batches(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,status TEXT,payload TEXT,created_at TEXT);
    CREATE TABLE questions(id INTEGER PRIMARY KEY,subject TEXT,stage TEXT,grade TEXT,stem TEXT,options TEXT,answer TEXT,analysis TEXT,type TEXT,difficulty INTEGER,difficulty_score_10 INTEGER,point TEXT,images TEXT,material TEXT,audio_key TEXT,audio_play_limit INTEGER,question_subtype TEXT,match_prompts TEXT,ai_review_metadata TEXT);
    CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT,question_id INTEGER,subject TEXT,stage TEXT,grade TEXT,images TEXT,point TEXT,created_at TEXT,stem_text TEXT,note TEXT,answer TEXT,draft_json TEXT);
  `);
  const cards = [0,1,2].map(i => ({ stem:`原题 ${i}：2+3=____`, questionType:'填空', options:[], answer:i === 0 ? '5' : '', analysis:i === 0 ? '原始解析' : '', figures:[{url:'/api/file?key=bank%2Fimg%2Fone.png'}], content_review_required:i === 0, _ai_review_schema:1 }));
  raw.prepare("INSERT INTO mf_recog_runs VALUES(1,'合成批次','数学','primary','四年级','word','recognized','',?,'[]','2026-11-09')").run(JSON.stringify(cards));
  raw.prepare("INSERT INTO mf_capture_batches VALUES(2,'合成采集','数学','primary','四年级','pending',?,'2026-11-09')").run(JSON.stringify([{stem:'采集原题', type:'fill',options:[],answer:'已有答案',analysis:'',images:['/bank/cap.png']}]));
  for (const [id,user] of [[3,101],[4,201]]) raw.prepare("INSERT INTO paper_uploads VALUES(?,?,'pending',0,'数学','primary','四年级','[]','','2026-11-09','','','',?)").run(id,user,JSON.stringify({stem:'扫码原题 '+id,type:'fill',options:[],answer:'',analysis:''}));
  const db = { prepare: sql => raw.prepare(sql.replace(/ FOR UPDATE\b/g,'')), transaction: fn => (...args) => {
    raw.exec('BEGIN'); try { const value = fn(...args); raw.exec('COMMIT'); return value; } catch(e) { raw.exec('ROLLBACK'); throw e; }
  } };
  const handlers = new Map(), modelRequests = [];
  const admin = Object.fromEntries(['get','post','put','delete'].map(method => [method, (url,...fns) => handlers.set(method.toUpperCase()+' '+url,fns)]));
  const multipart = () => ({single:() => (_q,_s,next) => next()}); multipart.memoryStorage=()=>({});
  const mod = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'src/mfpending.js'),'utf8'), {
    module:mod,exports:mod.exports,Buffer,process:{env:{STORAGE_DRIVER:'local',AI_MOCK:captureModel?'0':'1',TTS_MOCK:'1'}},
    require(name) {
      if(name==='multer') return multipart;
      // Exercise the production request builder against a local recorder only.
      // Never load mfcollect or any network-capable provider in this fixture.
      if(name==='./mfcollect') {
        if(!captureModel) throw new Error('Mock mode must never call live AI');
        return {mfAiInvoke:async request=>{modelRequests.push(request);return {text:JSON.stringify({items:[0,1].map(i=>({i,summary:'请由老师核对匹配关系',issues:[],answer:'',analysis:''}))})};}};
      }
      return require(name.startsWith('.') ? path.resolve(__dirname,'src',name) : name);
    }
  }, {filename:'src/mfpending.js'});
  const parseArr = text => { try { const a=JSON.parse(text||'[]');return Array.isArray(a)?a:[]; } catch(_) { return []; } };
  const parseObj = text => { try { return JSON.parse(text||'{}')||{}; } catch(_) { return {}; } };
  mod.exports({admin,db,ok:(res,data,msg)=>res.json({code:0,data,msg}),fail:(res,msg,code=1)=>res.json({code,msg}),now:()=> '2026-11-09 10:00:00',int:(x,d=0)=>parseInt(x,10)||d,parseArr,parseObj,jstr:JSON.stringify,
    TYPE_MAP:{'填空':'fill','单选':'single','解答':'answer','排序':'sort'},TYPES:['single','multi','judge','fill','sort','answer'],store:{getUrlSync:key=>'/api/file?key='+key},bankFolder:()=> 'bank',
    commitRunCards:()=>{throw new Error('Review and edit must not import');},commitCaptureItems:()=>{throw new Error('Review and edit must not import');}});
  const mfbank = fs.readFileSync(path.join(__dirname, 'src/mfbank.js'), 'utf8');
  const confirmStart = mfbank.indexOf("admin.post('/intake/runs/:id/aifill/confirm',"), confirmEnd = mfbank.indexOf('\n});', confirmStart) + 4;
  vm.runInNewContext(mfbank.slice(confirmStart, confirmEnd), { admin, db, AiAnswerReview: Review, int: Number, parseArr, jstr: JSON.stringify, now: () => '2026-11-09 10:00:00', ok: (res, data, msg) => res.json({ code: 0, data, msg }), fail: (res, msg) => res.json({ code: 1, msg }) });
  const call=async (route,body={},user=principal) => {
    const fns=handlers.get(route);assert.ok(fns,'required route exists: '+route);
    const res={json(value){this.body=value;return this;}};
    for(const fn of fns){await fn({user,body,query:{size:100},params:{id:1}},res,()=>{});if(res.body)break;}
    return res.body;
  };
  const list=async(user)=> (await call('GET /ext/pending',{},user)).data.list;
  const snapshot=()=>JSON.stringify(['mf_recog_runs','mf_capture_batches','paper_uploads','questions'].map(table=>raw.prepare('SELECT * FROM '+table).all()));
  const entry=(item,patch={})=>({id:item.id,expected:item.edit_signature,patch});
  const review=async(items,user)=>call('POST /ext/pending/ai-review',{items:items.map(item=>entry(item))},user);
  const edit=async(items,user)=>call('PUT /ext/pending/items',{items},user);
  return {raw,call,list,snapshot,entry,review,edit,modelRequests};
}

test('AI review covers selected sources, leaves existing answers and unrelated cards unchanged',async t=>{
  const f=fixture(t), items=await f.list(), selected=[items.find(x=>x.kind==='run'&&x.index===0),items.find(x=>x.kind==='cap'),items.find(x=>x.id==='up:3')];
  const r=await f.review(selected);assert.equal(r.code,0,r.msg);assert.equal(r.data.reviewed,3);assert.equal(r.data.failed.length,0);
  const after=await f.list();
  for(const old of selected){const next=after.find(x=>x.id===old.id);assert.equal(next.answer,old.answer);assert.equal(next.analysis,old.analysis);assert.equal(next.ai_answer_suggestion.source,'review');assert.equal(next.ai_answer_suggestion.stale,false);assert.ok(next.ai_answer_suggestion.summary);assert.deepEqual(next.images,old.images);}
  assert.equal(after.find(x=>x.kind==='run'&&x.index===1).ai_answer_suggestion,null);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});
test('AI review rejects stale or invalid selections before modifying any card',async t=>{
  const f=fixture(t), items=(await f.list()).slice(0,2), before=f.snapshot();
  items[1].edit_signature='outdated';const r=await f.review(items);assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});
test('AI request race cannot attach a review to edited content',async t=>{
  const f=fixture(t), item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);
  const pending=f.review([item]);
  const row=f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get(), cards=JSON.parse(row.drafts);cards[1].analysis='并发人工修改';
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const r=await pending;assert.equal(r.code,0,r.msg);assert.equal(r.data.reviewed,0);assert.equal(r.data.failed.length,1);
  const updated=(await f.list()).find(x=>x.id===item.id);assert.equal(updated.ai_answer_suggestion,null);assert.equal(updated.analysis,'并发人工修改');
});
test('AI review preserves existing unhandled suggestions',async t=>{
  const f=fixture(t), item=(await f.list()).find(x=>x.index===1&&x.kind==='run');
  assert.equal((await f.review([item])).code,0);const current=(await f.list()).find(x=>x.id===item.id), token=current.ai_answer_suggestion.token;
  const r=await f.review([current]);assert.equal(r.data.reviewed,0);assert.equal(r.data.failed.length,1);assert.equal((await f.list()).find(x=>x.id===item.id).ai_answer_suggestion.token,token);
});
test('bulk editing saves separate selected drafts and leaves images and unselected cards intact',async t=>{
  const f=fixture(t), before=await f.list(), run=before.find(x=>x.kind==='run'&&x.index===1),cap=before.find(x=>x.kind==='cap'), untouched=before.find(x=>x.kind==='run'&&x.index===2);
  const r=await f.edit([f.entry(run,{answer:'老师答案',analysis:'老师解析'}),f.entry(cap,{stem:'人工改题干'})]);assert.equal(r.code,0,r.msg);assert.equal(r.data.saved,2);
  const after=await f.list();assert.equal(after.find(x=>x.kind==='run'&&x.index===1).answer,'老师答案');assert.equal(after.find(x=>x.kind==='cap').stem,'人工改题干');
  assert.deepEqual(after.find(x=>x.id===untouched.id),untouched);assert.deepEqual(after.find(x=>x.kind==='cap').images,cap.images);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});
test('bulk save is atomic when a later card fails existing validation',async t=>{
  const f=fixture(t), items=(await f.list()).filter(x=>x.kind==='run'), before=f.snapshot();
  const r=await f.edit([f.entry(items[0],{answer:'不得部分保存'}),f.entry(items[1],{difficulty_score_10:99})]);assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});
test('bulk save refuses concurrent answer edits even when stem and id are unchanged',async t=>{
  const f=fixture(t), items=(await f.list()).filter(x=>x.kind==='run');
  await f.call('PUT /ext/pending/item',{id:items[1].id,patch:{answer:'并发更新'}});
  const before=f.snapshot(), r=await f.edit([f.entry(items[0],{analysis:'不应保存'}),f.entry(items[1],{answer:'旧页面覆盖'})]);assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});
test('bulk save rejects duplicate identities and protected provenance fields',async t=>{
  const f=fixture(t), item=(await f.list())[0], before=f.snapshot();
  assert.notEqual((await f.edit([f.entry(item,{answer:'一'}),f.entry(item,{answer:'二'})])).code,0);
  assert.notEqual((await f.edit([f.entry(item,{ai_answer_review:{},committed:9})])).code,0);assert.equal(f.snapshot(),before);
});
test('review and bulk edit reject cross-campus scans before any write',async t=>{
  const f=fixture(t), items=(await f.list()).filter(x=>x.kind==='scan'), before=f.snapshot();
  assert.equal((await f.review(items,branch)).code,403);assert.equal((await f.edit(items.map(x=>f.entry(x,{answer:'x'})),branch)).code,403);assert.equal(f.snapshot(),before);
});
test('editing a selected AI suggestion requires explicit review and retains original AI text with manual final value',async t=>{
  const f=fixture(t), initial=(await f.list()).find(x=>x.kind==='run'&&x.index===1);await f.review([initial]);
  const item=(await f.list()).find(x=>x.id===initial.id), suggestion=item.ai_answer_suggestion;
  const change={...f.entry(item,{answer:'老师修订后的答案'}),ai_fields:['answer'],ai_token:suggestion.token};
  const before=f.snapshot();assert.notEqual((await f.edit([change])).code,0);assert.equal(f.snapshot(),before);
  const r=await f.edit([{...change,ai_confirmed:true}]);assert.equal(r.code,0,r.msg);
  const saved=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts)[1];
  assert.equal(saved.answer,'老师修订后的答案');assert.equal(saved.ai_answer_review.fields.answer.source,'review');assert.equal(saved.ai_answer_review.fields.answer.suggested_value,suggestion.answer);assert.equal(saved.ai_answer_review.fields.answer.value,'老师修订后的答案');assert.equal(saved.ai_answer_review.fields.answer.confirmed_by,1);assert.ok(saved.ai_answer_suggestion);
  assert.deepEqual(Review.reviewedPendingFields(saved,JSON.stringify(['数学','primary','四年级'])),[]);
});
test('bulk edits do not clear image or original-content final review gates',async t=>{
  const f=fixture(t), item=(await f.list()).find(x=>x.kind==='run'&&x.index===0);assert.equal(item.content_review_pending,true);
  const r=await f.edit([f.entry(item,{analysis:'人工修改'})]);assert.equal(r.code,0,r.msg);
  const after=(await f.list()).find(x=>x.id===item.id);assert.equal(after.content_review_pending,true);assert.deepEqual(after.images,item.images);
});
test('bulk edit refuses a legacy scan whose question is shared by an unselected pending record',async t=>{
  const f=fixture(t);f.raw.exec("INSERT INTO questions(id,stem,type,options,answer,analysis,material) VALUES(9,'旧扫码题','fill','[]','原答案','','原材料'); UPDATE paper_uploads SET question_id=9 WHERE id IN(3,4)");
  const item=(await f.list()).find(x=>x.id==='up:3'),before=f.snapshot();const r=await f.edit([f.entry(item,{answer:'只能改选中题'})]);assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});
test('bulk edit saves a legacy scan material change rather than reporting a silent success',async t=>{
  const f=fixture(t);f.raw.exec("INSERT INTO questions(id,stem,type,options,answer,analysis,material) VALUES(9,'旧扫码题','fill','[]','原答案','','原材料'); UPDATE paper_uploads SET question_id=9 WHERE id=3");
  const item=(await f.list()).find(x=>x.id==='up:3');const r=await f.edit([f.entry(item,{material:'老师修改后的材料'})]);assert.equal(r.code,0,r.msg);assert.equal(f.raw.prepare('SELECT material FROM questions WHERE id=9').get().material,'老师修改后的材料');
});
test('legacy quick adoption cannot discard a new AI review report or its provenance',async t=>{
  const f=fixture(t),item=(await f.list()).find(x=>x.id==='up:3');await f.review([item]);const current=(await f.list()).find(x=>x.id===item.id),before=f.snapshot();
  const r=await f.call('POST /ext/pending/ai-answer/confirm',{id:item.id,token:current.ai_answer_suggestion.token,fields:['answer']});assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});
test('AI review rechecks campus access after model work',async t=>{
 const f=fixture(t),item=(await f.list(branch)).find(x=>x.id==='up:3'),pending=f.review([item],branch);f.raw.exec('UPDATE users SET created_by=20 WHERE id=101');const r=await pending;assert.equal(r.code,0,r.msg);assert.equal(r.data.reviewed,0);assert.equal(r.data.failed.length,1);assert.equal(JSON.parse(f.raw.prepare('SELECT draft_json FROM paper_uploads WHERE id=3').get().draft_json).ai_answer_suggestion,undefined);
});

test('run quick-adoption route keeps new review reports for the provenance-aware editor',async t=>{
 const f=fixture(t),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);await f.review([item]);const current=(await f.list()).find(x=>x.id===item.id),before=f.snapshot();const r=await f.call('POST /intake/runs/:id/aifill/confirm',{index:1,token:current.ai_answer_suggestion.token,fields:['answer']});assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);
});

test('production AI request includes bounded matching prompts and subtype without transmitting images or audio',async t=>{
 const f=fixture(t,true),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
 Object.assign(cards[0],{questionType:'排序',question_subtype:'math_match',match_prompts:['左侧甲','左侧乙'],options:[{label:'A',content:'右侧甲'},{label:'B',content:'右侧乙'}],answer:'2,1'});
 Object.assign(cards[1],{questionType:'排序',question_subtype:'listen_match',match_prompts:['听力人物甲','听力人物乙',...Array.from({length:7},(_,i)=>'项目'+i+'长'.repeat(1200))],options:[{label:'A',content:'地点甲'},{label:'B',content:'地点乙'}],audio_key:'bank/audio/private-fixture.mp3'});
 f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));const items=(await f.list()).filter(item=>item.kind==='run'&&item.index<2);
 const r=await f.review(items);assert.equal(r.code,0,r.msg);assert.equal(r.data.reviewed,2);assert.equal(f.modelRequests.length,1);
 const payload=JSON.parse(f.modelRequests[0].user);assert.equal(payload[0].type,'sort');assert.equal(payload[0].question_subtype,'math_match');assert.deepEqual(payload[0].match_prompts,['左侧甲','左侧乙']);
 assert.equal(payload[1].question_subtype,'listen_match');assert.deepEqual(payload[1].match_prompts.slice(0,2),['听力人物甲','听力人物乙']);assert.equal(payload[1].match_prompts.length,7);assert.equal(payload[1].match_prompts[2].length,1000);assert.equal(payload[1].has_audio,true);assert.equal(payload[0].has_images,true);
 assert.ok(payload.every(item=>!Object.hasOwn(item,'images')&&!Object.hasOwn(item,'audio_key')));assert.ok(!f.modelRequests[0].user.includes('private-fixture.mp3'));assert.ok(!f.modelRequests[0].user.includes('one.png'));
});
