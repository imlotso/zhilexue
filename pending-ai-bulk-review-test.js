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
function fixture(t, captureModel = false, allowCommit = false) {
  const raw = openMemory(); t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE bank_trees(id INTEGER PRIMARY KEY,subject TEXT,stage TEXT,kind TEXT,edition TEXT,name TEXT,sort INTEGER);
    CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY,tree_id INTEGER,parent_id INTEGER,name TEXT,sort INTEGER);
    INSERT INTO bank_trees VALUES(1,'数学','primary','knowledge','','知识树',0),(2,'数学','primary','textbook','','章节树',0),(3,'英语','primary','knowledge','','英语树',0);
    INSERT INTO bank_tree_nodes VALUES(11,1,NULL,'加法',0),(12,2,NULL,'第一章',0),(13,3,NULL,'单词',0);
    CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER,PRIMARY KEY(question_id,node_id));
    CREATE TABLE question_tags(question_id INTEGER,tag TEXT,PRIMARY KEY(question_id,tag));
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
  let failCommitUpdate=false;
  const db = { exec: sql => raw.exec(sql), prepare: sql => {
    const statement=raw.prepare(sql.replace(/ FOR UPDATE\b/g,''));
    if(failCommitUpdate && sql.startsWith('UPDATE mf_recog_runs SET drafts=?, status=? WHERE id=?')) return {get:(...a)=>statement.get(...a),all:(...a)=>statement.all(...a),run:()=>{throw Error('synthetic batch update failure');}};
    return statement;
  }, transaction: fn => (...args) => {
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
        return {mfAiInvoke:async request=>{modelRequests.push(request);return {text:JSON.stringify({items:[0,1].map(i=>({i,summary:'请由老师核对匹配关系',issues:[],stem:'修订后的合成题干',answer:'',analysis:''}))})};}};
      }
      return require(name.startsWith('.') ? path.resolve(__dirname,'src',name) : name);
    }
  }, {filename:'src/mfpending.js'});
  const parseArr = text => { try { const a=JSON.parse(text||'[]');return Array.isArray(a)?a:[]; } catch(_) { return []; } };
  const parseObj = text => { try { return JSON.parse(text||'{}')||{}; } catch(_) { return {}; } };
  mod.exports({admin,db,ok:(res,data,msg)=>res.json({code:0,data,msg}),fail:(res,msg,code=1)=>res.json({code,msg}),now:()=> '2026-11-09 10:00:00',int:(x,d=0)=>parseInt(x,10)||d,parseArr,parseObj,jstr:JSON.stringify,
    TYPE_MAP:{'填空':'fill','单选':'single','解答':'answer','排序':'sort'},TYPES:['single','multi','judge','fill','sort','answer'],store:{getUrlSync:key=>'/api/file?key='+key},bankFolder:()=> 'bank',
    commitRunCards:()=>{if(!allowCommit)throw new Error('Review and edit must not import'); raw.prepare("INSERT INTO questions(id,subject,stage,stem) VALUES(42,'数学','primary','合成测试')").run(); return [42];},commitCaptureItems:()=>{throw new Error('Review and edit must not import');}});
  const mfbank = fs.readFileSync(path.join(__dirname, 'src/mfbank.js'), 'utf8');
  const fillStart = mfbank.indexOf("admin.post('/intake/runs/:id/aifill',"), fillEnd = mfbank.indexOf('\n});', fillStart) + 4;
  vm.runInNewContext(mfbank.slice(fillStart, fillEnd), { admin, db, AiAnswerReview: Review, int: Number, parseArr, jstr: JSON.stringify, singleIntakeJob: () => (_q,_s,next)=>next(), require: name => { if (name === './mfcollect') return {mfAiInvoke: async request => { modelRequests.push(request); return {text:JSON.stringify({items:[]})}; }}; return require(name); }, ok: (res,data,msg)=>res.json({code:0,data,msg}), fail:(res,msg)=>res.json({code:1,msg}) });
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
  return {raw,call,list,snapshot,entry,review,edit,modelRequests,handlers,failCommitUpdate:()=>{failCommitUpdate=true;}};
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
test('explicit type confirmation can be saved with an unchanged type',async t=>{
  const f=fixture(t),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  cards[1].type_unconfirmed=true;f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const item=(await f.list()).find(x=>x.kind==='run'&&x.index===1),r=await f.edit([f.entry(item,{type:item.type,type_confirmed:true})]);
  assert.equal(r.code,0,r.msg);const after=(await f.list()).find(x=>x.id===item.id);assert.equal(after.type_unconfirmed,false);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});
test('unchanged original-page confirmation checks the snapshot and preserves every question value',async t=>{
  const f=fixture(t),item=(await f.list()).find(x=>x.kind==='run'&&x.index===0),before=f.snapshot();
  const stale=await f.call('POST /ext/pending/content/confirm',{id:item.id,expected:'stale-signature'});assert.notEqual(stale.code,0);assert.equal(f.snapshot(),before);
  const confirmed=await f.call('POST /ext/pending/content/confirm',{id:item.id,expected:item.content_review_signature});assert.equal(confirmed.code,0,confirmed.msg);
  const after=(await f.list()).find(x=>x.id===item.id);assert.equal(after.content_review_pending,false);
  for(const field of ['stem','answer','analysis','material','options','images'])assert.deepEqual(after[field],item[field]);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('old imports without an AI-fill marker do not require fake AI confirmations',async t=>{
  const f=fixture(t),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  Object.assign(cards[1],{page:1,via:'word',answer:'原有答案',analysis:'原有解析'});delete cards[1]._ai_review_schema;
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);
  assert.equal(item.ai_legacy_pending,false);assert.equal(item.ai_origin_uncertain,true);
  assert.equal(item.answer,'原有答案');assert.equal(item.analysis,'原有解析');
});

test('one explicit legacy review covers existing fields and never imports',async t=>{
  const f=fixture(t),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  Object.assign(cards[1],{ai_filled:true,answer:'已有答案',analysis:'已有解析',point:'已有分类'});
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const item=(await f.list()).find(x=>x.kind==='run'&&x.index===1), before=f.snapshot();
  const stale=await f.call('POST /intake/runs/:id/aifill/confirm',{index:1,legacy:true,expected:'stale',fields:item.ai_legacy_pending_fields});
  assert.notEqual(stale.code,0);assert.equal(f.snapshot(),before);
  const ok=await f.call('POST /intake/runs/:id/aifill/confirm',{index:1,legacy:true,expected:item.ai_legacy_signature,fields:item.ai_legacy_pending_fields});
  assert.equal(ok.code,0,ok.msg);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
  const after=(await f.list()).find(x=>x.id===item.id);assert.equal(after.ai_legacy_pending,false);
  assert.equal(after.answer,'已有答案');assert.equal(after.analysis,'已有解析');
});
test('changed questions can recheck adopted answer and analysis together without importing',async t=>{
  const f=fixture(t),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  Object.assign(cards[1],{answer:'5',analysis:'原有解析',ai_answer_review:{fields:{answer:{basis:'old',value:'5'},analysis:{basis:'old',value:'原有解析'}}}});
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  let item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);assert.equal(item.ai_review_pending_fields.length,2);
  const result=await f.call('POST /intake/runs/:id/aifill/confirm',{index:1,recheck:true,expected:item.ai_review_signature,fields:['answer','analysis']});
  assert.equal(result.code,0,result.msg);item=(await f.list()).find(x=>x.id===item.id);assert.equal(item.ai_review_pending_fields.length,0);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('batch legacy review is atomic, snapshot-bound, and separate from import',async t=>{
  const f=fixture(t),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  for(const i of [1,2]) Object.assign(cards[i],{ai_filled:true,answer:'答案'+i,analysis:'解析'+i,point:'分类'+i});
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  let rows=(await f.list()).filter(x=>x.kind==='run'&&x.index>0), entries=rows.map(x=>({id:x.id,expected:x.edit_signature,legacy_expected:x.ai_legacy_signature,fields:x.ai_legacy_pending_fields}));
  const before=f.snapshot(),stale=JSON.parse(JSON.stringify(entries));stale[1].expected='outdated';
  assert.notEqual((await f.call('POST /ext/pending/legacy-confirm',{items:stale})).code,0);assert.equal(f.snapshot(),before);
  const ok=await f.call('POST /ext/pending/legacy-confirm',{items:entries});assert.equal(ok.code,0,ok.msg);assert.equal(ok.data.confirmed,2);
  rows=(await f.list()).filter(x=>x.kind==='run'&&x.index>0);assert(rows.every(x=>!x.ai_legacy_pending));
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
  assert.deepEqual(Array.from(rows,x=>x.answer),['答案1','答案2']);
});

test('final commit rejects a concurrently edited answer before writing or changing review state',async t=>{
  const f=fixture(t,false,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);
  const changed=await f.call('PUT /ext/pending/item',{id:item.id,patch:{answer:'并发人工答案'}});assert.equal(changed.code,0,changed.msg);
  const before=f.snapshot(),r=await f.call('POST /ext/pending/commit',{ids:[item.id],items:[{id:item.id,expected:item.edit_signature}],detailed:true});
  assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('explicit snapshot-bound batch commit imports a correct unchanged item and reports a missing image separately',async t=>{
  const f=fixture(t,false,true),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  Object.assign(cards[1],{page:1,via:'word',answer:'原有答案',analysis:'原有解析'});delete cards[1]._ai_review_schema;
  Object.assign(cards[2],{stem:'请看[图1]作答',figures:[]});
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const rows=(await f.list()).filter(x=>x.kind==='run'&&x.index>0);
  const r=await f.call('POST /ext/pending/commit',{ids:rows.map(x=>x.id),items:rows.map(x=>({id:x.id,expected:x.edit_signature})),detailed:true});
  assert.equal(r.code,0,r.msg);assert.equal(r.data.committed,1);assert.equal(r.data.failed.length,1);assert.match(r.data.failed[0].msg,/图/);
  const left=(await f.list()).filter(x=>x.kind==='run');assert(left.some(x=>x.index===2));assert(!left.some(x=>x.index===1));
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,1);
});
test('per-item import failures roll back their insert while successful items remain explicit',async t=>{
  const f=fixture(t,false,true),rows=(await f.list()).filter(x=>x.kind==='run'&&x.index>0);
  const r=await f.call('POST /ext/pending/commit',{ids:rows.map(x=>x.id),items:rows.map(x=>({id:x.id,expected:x.edit_signature})),detailed:true});
  assert.equal(r.code,0,r.msg);assert.equal(r.data.committed,1);assert.equal(r.data.failed.length,1);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,1);
  assert.equal((await f.list()).filter(x=>x.kind==='run'&&x.index>0).length,1);
});
test('failure saving the batch status rolls back newly inserted questions',async t=>{
  const f=fixture(t,false,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1),before=f.snapshot();f.failCommitUpdate();
  const r=await f.call('POST /ext/pending/commit',{ids:[item.id],items:[{id:item.id,expected:item.edit_signature}],detailed:true});
  assert.notEqual(r.code,0);assert.equal(f.snapshot(),before);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('synthetic HTTP flow confirms once, persists after reload and imports only on explicit final request',async t=>{
  const express=require('express'),f=fixture(t,false,true),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  Object.assign(cards[1],{ai_filled:true,answer:'5',analysis:'2加3',point:'加法'});
  f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=principal;next();});
  for(const [key,fns] of f.handlers){const [method,url]=key.split(' ');app[method.toLowerCase()](url,...fns);}
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const http=async(method,url,body)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return response.json();};
  const list=async()=>(await http('GET','/ext/pending?size=20')).data.list;
  let item=(await list()).find(x=>x.kind==='run'&&x.index===1);
  const reviewed=await http('POST','/intake/runs/1/aifill/confirm',{index:1,legacy:true,expected:item.ai_legacy_signature,fields:item.ai_legacy_pending_fields});
  assert.equal(reviewed.code,0,reviewed.msg);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
  item=(await list()).find(x=>x.kind==='run'&&x.index===1);assert.equal(item.ai_legacy_pending,false);
  const commit=await http('POST','/ext/pending/commit',{ids:[item.id],items:[{id:item.id,expected:item.edit_signature}],detailed:true});
  assert.equal(commit.code,0,commit.msg);assert.equal(commit.data.committed,1);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,1);
  assert(!(await list()).some(x=>x.id===item.id));
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


test('AI review persists a stem suggestion and atomic adoption records its origin without importing',async t=>{
 const f=fixture(t,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===0);const r=await f.review([item]);assert.equal(r.code,0);
 const current=(await f.list()).find(x=>x.id===item.id),suggestion=current.ai_answer_suggestion;assert.equal(suggestion.stem,'修订后的合成题干');
 const e={...f.entry(current,{stem:suggestion.stem}),ai_fields:['stem'],ai_token:suggestion.token,ai_confirmed:true};
 assert.equal((await f.edit([e])).code,0);const saved=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts)[0];assert.equal(saved.stem,suggestion.stem);assert.equal(saved.ai_answer_review.fields.stem.original_value,item.stem);assert.equal(saved.ai_answer_review.fields.stem.source,'review');assert.equal(saved.content_review_required,true);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});


test('selected classification nodes save atomically as draft, refresh, and reject stale or out-of-scope suggestions',async t=>{
 const f=fixture(t),items=(await f.list()).filter(x=>x.kind==='run'),r=await f.edit([f.entry(items[0],{draft_node_ids:[11,12]}),f.entry(items[1],{draft_node_ids:[11],difficulty_score_10:5})]);assert.equal(r.code,0,r.msg);
 const after=await f.list();assert.deepEqual(Array.from(after.find(x=>x.id===items[0].id).draft_node_ids),[11,12]);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
 const before=f.snapshot();const bad=await f.edit([f.entry(after.find(x=>x.id===items[0].id),{draft_node_ids:[13]}),f.entry(after.find(x=>x.id===items[1].id),{difficulty_score_10:4})]);assert.notEqual(bad.code,0);assert.equal(f.snapshot(),before);
 const stale=await f.edit([f.entry(items[0],{draft_node_ids:[11]})]);assert.notEqual(stale.code,0);assert.equal(f.snapshot(),before);
});


test('explicit later commit validates and attaches the classification saved in each draft',async t=>{
 const f=fixture(t,false,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);assert.equal((await f.edit([f.entry(item,{draft_node_ids:[11,12]})])).code,0);
 const current=(await f.list()).find(x=>x.id===item.id),result=await f.call('POST /ext/pending/commit',{ids:[current.id]});assert.equal(result.code,0,result.msg);assert.deepEqual(f.raw.prepare('SELECT node_id FROM question_nodes WHERE question_id=42 ORDER BY node_id').all().map(x=>x.node_id),[11,12]);
});

test('adopting one unchanged AI suggestion leaves remaining suggestions usable after refresh',async t=>{
 const f=fixture(t),initial=(await f.list()).find(x=>x.kind==='run'&&x.index===1);await f.review([initial]);const first=(await f.list()).find(x=>x.id===initial.id),s=first.ai_answer_suggestion;
 const save=await f.edit([{...f.entry(first,{answer:s.answer}),ai_fields:['answer'],ai_token:s.token,ai_confirmed:true}]);assert.equal(save.code,0,save.msg);
 const next=(await f.list()).find(x=>x.id===first.id);assert.equal(next.ai_answer_suggestion.stale,false);assert.ok(next.ai_answer_suggestion.analysis);assert.ok(!next.ai_answer_suggestion.answer);
 const finish=await f.edit([{...f.entry(next,{analysis:next.ai_answer_suggestion.analysis}),ai_fields:['analysis'],ai_token:s.token,ai_confirmed:true}]);assert.equal(finish.code,0,finish.msg);
});

test('AI adoption refuses to drop original numbered image markers',async t=>{
 const f=fixture(t,true),items=(await f.list()).filter(x=>x.kind==='run'),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);cards[0].stem='看图 [图1]，求值';f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));const old=(await f.list()).find(x=>x.kind==='run'&&x.index===0);await f.review([old]);const item=(await f.list()).find(x=>x.id===old.id),s=item.ai_answer_suggestion,before=f.snapshot();const result=await f.edit([{...f.entry(item,{stem:s.stem}),ai_fields:['stem'],ai_token:s.token,ai_confirmed:true}]);assert.notEqual(result.code,0);assert.match(result.msg,/图.*标记/);assert.equal(f.snapshot(),before);
});

test('keeping one original field persists that decision without changing its text or other suggestions',async t=>{
 const f=fixture(t),initial=(await f.list()).find(x=>x.kind==='run'&&x.index===1);await f.review([initial]);const item=(await f.list()).find(x=>x.id===initial.id),s=item.ai_answer_suggestion;
 const r=await f.edit([{...f.entry(item,{}),ai_keep_fields:['answer'],ai_token:s.token,ai_confirmed:true}]);assert.equal(r.code,0,r.msg);const current=(await f.list()).find(x=>x.id===item.id);assert.equal(current.answer,item.answer);assert.equal(current.ai_answer_suggestion.answer,undefined);assert.ok(current.ai_answer_suggestion.analysis);assert.equal(current.ai_answer_suggestion.stale,false);assert.equal(current.ai_answer_review.kept_fields.answer.suggested_value,s.answer);
});

test('stored classification refuses final commit if grade changes after selecting nodes',async t=>{
 const f=fixture(t,false,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1);assert.equal((await f.edit([f.entry(item,{draft_node_ids:[11]})])).code,0);let current=(await f.list()).find(x=>x.id===item.id);assert.equal((await f.edit([f.entry(current,{grade:'五年级'})])).code,0);current=(await f.list()).find(x=>x.id===item.id);const r=await f.call('POST /ext/pending/commit',{ids:[current.id]});assert.notEqual(r.code,0);assert.match(r.msg,/分类.*变化/);assert.equal(f.raw.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('supplement generation rejects stale selected question snapshots before invoking a model',async t=>{
 const f=fixture(t,true),item=(await f.list()).find(x=>x.kind==='cap'),before=f.snapshot();const r=await f.call('POST /ext/pending/ai-answer',{ids:[item.id],items:[{id:item.id,expected:'outdated'}]});assert.notEqual(r.code,0);assert.equal(f.modelRequests.length,0);assert.equal(f.snapshot(),before);
});


test('run supplement generation checks the selected snapshot before calling the model',async t=>{
 const f=fixture(t,true),item=(await f.list()).find(x=>x.kind==='run'&&x.index===1),before=f.snapshot();const r=await f.call('POST /intake/runs/:id/aifill',{indexes:[1],expected:[{index:1,signature:'outdated',subject:item.subject,stage:item.stage,grade:item.grade}]});assert.notEqual(r.code,0);assert.equal(f.modelRequests.length,0);assert.equal(f.snapshot(),before);
});

test('run supplement rejects malformed expected snapshots without reaching the model',async t=>{
 const f=fixture(t,true),before=f.snapshot();const r=await f.call('POST /intake/runs/:id/aifill',{indexes:[0],expected:[null]});assert.notEqual(r.code,0);assert.equal(f.modelRequests.length,0);assert.equal(f.snapshot(),before);
});

test('AI adoption cannot silently remove unnumbered image or table placeholders',async t=>{
 const f=fixture(t,true),cards=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);cards[0].stem='看[图]及【表格1】，求值';f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));const old=(await f.list()).find(x=>x.kind==='run'&&x.index===0);await f.review([old]);const item=(await f.list()).find(x=>x.id===old.id),s=item.ai_answer_suggestion,before=f.snapshot();const result=await f.edit([{...f.entry(item,{stem:s.stem}),ai_fields:['stem'],ai_token:s.token,ai_confirmed:true}]);assert.notEqual(result.code,0);assert.match(result.msg,/图.*标记/);assert.equal(f.snapshot(),before);
});

for (const source of ['run','cap','scan']) {
  test('high-school draft edits are refused without writes for ' + source, async t => {
    const f = fixture(t), item = (await f.list()).find(x => x.kind === source);
    assert.ok(item, source);
    for (const patch of [{stage:'senior'},{stage:'高中'},{grade:'高一'},{grade:'十二年级'}]) {
      const before = f.snapshot(), result = await f.call('PUT /ext/pending/item',{id:item.id,patch});
      assert.notEqual(result.code,0); assert.match(result.msg,/高中/); assert.equal(f.snapshot(),before);
    }
  });
}
test('a later high-school edit rolls back all earlier edits in the same batch', async t => {
  const f = fixture(t), rows = (await f.list()).filter(x=>x.kind==='run'), before = f.snapshot();
  const result = await f.edit([f.entry(rows[1],{stem:'不应留下的修改'}), f.entry(rows[2],{grade:'高二'})]);
  assert.notEqual(result.code,0); assert.match(result.msg,/高中/); assert.equal(f.snapshot(),before);
});
test('mixed pending commits accept supported cards and keep high-school cards uncommitted', async t => {
  const f = fixture(t,false,true), cards = JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  cards[2].grade='高三'; f.raw.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=1').run(JSON.stringify(cards));
  const rows=(await f.list()).filter(x=>x.kind==='run'&&x.index>0);
  const result=await f.call('POST /ext/pending/commit',{ids:rows.map(x=>x.id)});
  assert.equal(result.code,0,result.msg); assert.equal(result.data.committed,1); assert.equal(result.data.failed.length,1); assert.match(result.data.failed[0].msg,/高中/);
  const saved=JSON.parse(f.raw.prepare('SELECT drafts FROM mf_recog_runs WHERE id=1').get().drafts);
  assert.equal(saved[1].committed,42); assert.equal(saved[2].committed,undefined); assert.equal(saved[2].grade,'高三');
});
test('commit override cannot turn a senior batch into an allowed junior item', async t => {
  const f=fixture(t,false,true); f.raw.exec("UPDATE mf_recog_runs SET stage='senior',grade='高一' WHERE id=1");
  const item=(await f.list()).find(x=>x.kind==='run'&&x.index===1), result=await f.call('POST /ext/pending/commit',{ids:[item.id],stage:'junior',grade:'七年级'});
  assert.notEqual(result.code,0); assert.match(result.msg,/高中/); assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,0);
  assert.equal(f.raw.prepare('SELECT stage FROM mf_recog_runs WHERE id=1').get().stage,'senior');
});
