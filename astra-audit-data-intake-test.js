'use strict';
// Synthetic VM/in-memory regressions; never load src/db, credentials or providers.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname,'src/mfbank.js'),'utf8');
function block(source,start,end) { const a=source.indexOf(start),b=source.indexOf(end,a); assert(a>=0&&b>a,start);return source.slice(a,b); }
function commitFixture() {
  const inserted=[];
  const db={prepare(sql){return {all:()=>[],get:()=>({subject:'数学',type:'answer'}),run(...args){if(sql.startsWith('INSERT INTO questions ('))inserted.push({sql,args});return {lastInsertRowid:inserted.length};}};}};
  const context={db,SchoolScope:require('./src/school-scope'),TYPE_MAP:{'解答':'answer','单选':'single','多选':'multi'},TYPES:['answer','single','multi'],SITES:{generic:'通用网页'},choiceOptionsError:require('./src/choice-options').choiceOptionsError,resolveDifficulty:require('./src/difficulty').resolveDifficulty,jstr:JSON.stringify,int:(x,d=0)=>parseInt(x,10)||d,now:()=>'',audioKeyOf:x=>x||'',QSubtype:require('./public/js/question-subtypes'),MatchQ:require('./src/match-question'),AiAnswerReview:require('./src/ai-answer-review'),parseObj:x=>JSON.parse(x||'{}'),require:name=>name==='./qmeta'?{questionScopeSql:()=> '1=1'}:require(path.resolve(__dirname,'src',name))};
  // Include the real content/choice helper declarations as the production file evolves.
  vm.createContext(context);
  vm.runInContext(block(src,'function htmlToText(', '\n/** 规则切题'),context);
  vm.runInContext(block(src,'function commitRunCards(',"\nadmin.post('/intake/runs/:id/commit'"),context);
  vm.runInContext(block(src,'function commitCaptureItems(',"\nadmin.post('/capture/batches/:id/commit'"),context);
  return {context,inserted};
}
for(const input of ['若 1 < x < 3 且 y > 0，求 x+y。','若1<x<3且y>0，求x+y。','文本 <variable> 是占位，x < 3，y > 0']) {
  for(const kind of ['run','capture']) test(`I1 ${kind} preserves plain mathematical/text angles: ${input}`,()=>{
    const f=commitFixture();
    if(kind==='run') f.context.commitRunCards({id:1,subject:'数学',stage:'junior'},[{questionType:'解答',stem:input,options:[],figures:[]}],{});
    else f.context.commitCaptureItems({id:1,site:'generic',subject:'数学'},[{questionId:'synthetic',type:'answer',stem:input,options:[]}],{});
    const row=f.inserted[0], offset=kind==='run'?5:4;
    assert.equal(row.args[offset],input);assert.equal(row.args[offset+1],'');
  });
}
test('I1 rich text still extracts content, decodes entities and preserves mixed inequalities',()=>{
  const f=commitFixture(),input='<p>若 1 < x < 3 且 y > 0，<b>求 x+y</b> &amp; z。</p><script>bad()</script>';
  f.context.commitRunCards({id:1},[{questionType:'解答',stem:input,options:[],figures:[]}],{});
  assert.equal(f.inserted[0].args[5],'若 1 < x < 3 且 y > 0，求 x+y & z。');
  assert.ok(f.inserted[0].args[6].includes('<b>求 x+y</b>'));
});
// Reuse the already-isolated full-router fixture, without importing its tests.
function pendingFixture(t) {
  let source=fs.readFileSync(path.join(__dirname,'pending-ai-bulk-review-test.js'),'utf8');
  source=source.slice(0,source.indexOf("\ntest('AI review covers"));
  source=source.replace(/commitRunCards:\(\)=>\{if\(!allowCommit\)[^\n]*?return \[42\];\}/,"commitRunCards:(_r,cards)=>[raw.prepare('INSERT INTO questions (stem,type) VALUES (?,?)').run(cards[0].stem,'fill').lastInsertRowid]");
  source=source.replace("commitCaptureItems:()=>{throw new Error('Review and edit must not import');}","commitCaptureItems:(_b,items)=>({ids:[raw.prepare('INSERT INTO questions (stem,type) VALUES (?,?)').run(items[0].stem,'fill').lastInsertRowid]})");
  source=source.replace('return {raw,call,list,snapshot,entry,review,edit,modelRequests,handlers,','return {raw,db,call,list,snapshot,entry,review,edit,modelRequests,handlers,');
  source+='\nmodule.exports=fixture;';
  const mod={exports:{}};vm.runInNewContext(source,{require,module:mod,exports:mod.exports,process:{env:{}},Buffer,__dirname});
  return mod.exports(t);
}
for(const kind of ['run','cap','scan']) test(`I2 ${kind} remaps surviving option/answer identity on editing`,async t=>{
  const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind===kind&&(kind!=='run'||x.index===1));
  const r=await f.call('PUT /ext/pending/item',{id:it.id,patch:{type:'single',options:[{label:'A',text:'错误项'},{label:'B',text:''},{label:'C',text:'正确项'}],answer:'C'}});
  assert.equal(r.code,0,r.msg);const next=(await f.list()).find(x=>x.id===it.id);
  assert.deepEqual(Array.from(next.options,x=>x.label),['A','B']);assert.equal(next.answer,'B');
  assert.equal(require('./src/bank-judge').judgeQ(next,'B'),true);
});
test('I2 omitted answer still follows surviving original option; multi supports gaps',async t=>{
  const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind==='cap');
  const options=['one','two','three','four'].map((text,i)=>({label:'ABCD'[i],text}));
  assert.equal((await f.call('PUT /ext/pending/item',{id:it.id,patch:{type:'multi',options,answer:'A,D'}})).code,0);
  const r=await f.call('PUT /ext/pending/item',{id:it.id,patch:{options:[options[0],{...options[1],text:''},options[2],options[3]]}});
  assert.equal(r.code,0,r.msg);assert.equal((await f.list()).find(x=>x.id===it.id).answer,'A,C');
});
for(const scenario of ['removed-correct','invalid-letter','invalid-syntax','ambiguous-label']) test(`I2 rejects ${scenario} without modifying the source`,async t=>{
  const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind==='cap'),before=f.snapshot();
  let options=[{label:'A',text:'one'},{label:'B',text:'two'},{label:'C',text:''}],answer='C';
  if(scenario==='invalid-letter')answer='J';
  if(scenario==='invalid-syntax')answer='correct B';
  if(scenario==='ambiguous-label'){options[1].label='A';answer='A';}
  const r=await f.call('PUT /ext/pending/item',{id:it.id,patch:{type:'single',options,answer}});
  assert.notEqual(r.code,0);assert.match(r.msg,/答案|选项/);assert.equal(f.snapshot(),before);
});
test('I2 empty answer remains a deliberate missing-answer draft',async t=>{
  const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind==='cap');
  const r=await f.call('PUT /ext/pending/item',{id:it.id,patch:{type:'single',options:[{label:'A',text:'one'},{label:'C',text:'two'}],answer:''}});
  assert.equal(r.code,0,r.msg);assert.equal((await f.list()).find(x=>x.id===it.id).answer,'');
});
for(const kind of ['run','cap']) test(`I3 legacy ${kind} commit rolls back insert if source marker fails, retry cannot duplicate`,async t=>{
  const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind===kind&&(kind!=='run'||x.index===1));
  const original=f.db.prepare;let inject=true;
  f.db.prepare=sql=>{if(inject&&sql.startsWith(kind==='run'?'UPDATE mf_recog_runs SET drafts=?, status=?':'UPDATE mf_capture_batches SET payload=?, status=?')){inject=false;throw Error('synthetic marker failure');}return original(sql);};
  let failed;try{failed=await f.call('POST /ext/pending/commit',{ids:[it.id]});}catch(e){failed={code:1,msg:e.message};}
  assert.notEqual(failed.code,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,0);
  const retry=await f.call('POST /ext/pending/commit',{ids:[it.id]});assert.equal(retry.code,0,retry.msg);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,1);
  await f.call('POST /ext/pending/commit',{ids:[it.id]});assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,1);
});
for(const kind of ['run','pack','capture'])test(`I2 ${kind} final import validates and remaps original choice identities`,()=>{
 const f=commitFixture(),options=[{label:'A',text:'wrong',content:'wrong'},{label:'B',text:'',content:''},{label:'C',text:'correct',content:'correct'}];
 const q={type:'single',stem:'synthetic',options,answer:'C'};
 if(kind==='capture')f.context.commitCaptureItems({id:1,site:'generic'},[{...q,questionId:'unique'}],{});
 else f.context.commitRunCards({id:1},[kind==='pack'?{_q:q}: {...q,questionType:'单选'}],{});
 const args=f.inserted[0].args,offset=kind==='run'?7:6;
 assert.deepEqual(JSON.parse(args[offset]).map(o=>o.label),['A','B']);assert.equal(args[offset+1],'B');
});
for(const kind of ['run','pack','capture'])test(`I2 ${kind} final import rejects answer referring to a removed option before insert`,()=>{
 const f=commitFixture(),q={type:'single',stem:'synthetic',options:[{label:'A',text:'one',content:'one'},{label:'B',text:'two',content:'two'}],answer:'C'};
 assert.throws(()=>kind==='capture'?f.context.commitCaptureItems({id:1,site:'generic'},[{...q,questionId:'unique'}],{}):f.context.commitRunCards({id:1},[kind==='pack'?{_q:q}:{...q,questionType:'单选'}],{}),/答案/);
 assert.equal(f.inserted.length,0);
});
test('I1 compact b variable is text, not a tag, even beside actual markup',()=>{
 const {questionStemFields}=require('./src/question-content');
 const plain='若1<b<3且c>0，求b+c';assert.deepEqual(questionStemFields(plain),{stem:plain,stem_html:''});
 assert.equal(questionStemFields('<p>'+plain+'</p>').stem,plain);
});
function scanCommitSchema(f) {
 f.raw.exec(`ALTER TABLE questions ADD COLUMN chapter_id INTEGER; ALTER TABLE questions ADD COLUMN sort INTEGER; ALTER TABLE questions ADD COLUMN source TEXT; ALTER TABLE questions ADD COLUMN year TEXT; ALTER TABLE questions ADD COLUMN video_id INTEGER; ALTER TABLE questions ADD COLUMN created_at TEXT;
 ALTER TABLE paper_uploads ADD COLUMN reviewed_by INTEGER; ALTER TABLE paper_uploads ADD COLUMN reviewed_at TEXT;
 CREATE TABLE mistakes(user_id INTEGER,question_id INTEGER,wrong_count INTEGER,last_answer TEXT,resolved INTEGER,updated_at TEXT,review_stage INTEGER,next_review TEXT);`);
}
test('I2 final scan import rejects invalid answer before creating a question or student mistake',async t=>{
 const f=pendingFixture(t);scanCommitSchema(f);
 f.raw.prepare('UPDATE paper_uploads SET draft_json=? WHERE id=3').run(JSON.stringify({type:'single',stem:'synthetic',options:[{label:'A',text:'one'},{label:'B',text:'two'}],answer:'C'}));
 const r=await f.call('POST /ext/pending/commit',{ids:['up:3']});assert.notEqual(r.code,0);assert.match(r.msg,/答案/);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM mistakes').get().n,0);
});
for(const legacy of [false,true])test(`I2 final scan import keeps student answer aligned when sparse labels survive (legacy=${legacy})`,async t=>{
 const f=pendingFixture(t);scanCommitSchema(f);const options=[{label:'A',text:'one'},{label:'C',text:'correct'}];
 if(legacy){f.raw.prepare("INSERT INTO questions(id,subject,stage,grade,stem,type,options,answer) VALUES(99,'数学','primary','四年级','synthetic','single',?,'C')").run(JSON.stringify(options));f.raw.exec('UPDATE paper_uploads SET question_id=99 WHERE id=3');}
 else f.raw.prepare('UPDATE paper_uploads SET draft_json=? WHERE id=3').run(JSON.stringify({type:'single',stem:'synthetic',options,answer:'C'}));
 const r=await f.call('POST /ext/pending/commit',{ids:['up:3']});assert.equal(r.code,0,r.msg);
 const saved=f.raw.prepare('SELECT * FROM questions WHERE id=?').get(r.data.question_ids[0]);assert.equal(saved.answer,'B');assert.deepEqual(JSON.parse(saved.options).map(o=>o.label),['A','B']);assert.equal(require('./src/bank-judge').judgeQ(saved,'B'),true);
});
test('I3 legacy batch preserves per-item failure reporting while good items commit atomically',async t=>{
 const f=pendingFixture(t),it=(await f.list()).find(x=>x.kind==='run'&&x.index===1);
 const r=await f.call('POST /ext/pending/commit',{ids:[it.id,'run:999:0','bad-id'],detailed:true});
 assert.equal(r.code,0,r.msg);assert.equal(r.data.committed,1);assert.equal(r.data.failed.length,2);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n,1);
});
for(const input of ['若 1<x>0，求 x。','若 a<b>c，求 b。','若a<variable>c，求a。'])test(`I1 rich text preserves adjacent mathematical brackets: ${input}`,()=>{
 const {questionStemFields}=require('./src/question-content');const result=questionStemFields('',`<p>${input}</p>`);
 assert.equal(result.stem,input);
 const {JSDOM}=require('jsdom');const dom=new JSDOM(result.stem_html);try{assert.equal(dom.window.document.body.textContent,input);}finally{dom.window.close();}
});
function duplicateCapture(old, incoming) {
 const f=commitFixture(),writes=[];
 f.context.db.prepare=sql=>({all:()=>[{id:11,source_detail:JSON.stringify({site:'generic',questionId:'same'}),source_type:'capture'}],get:()=>old,run:(...args)=>{writes.push({sql,args});return{changes:1}}});
 const result=f.context.commitCaptureItems({id:1,site:'generic'},[{questionId:'same',type:'single',stem:'synthetic',options:[{label:'A',text:'wrong'},{label:'B',text:''},{label:'C',text:'correct'}],answer:'C',...incoming}],{});
 return {result,writes};
}
test('I2 duplicate capture fills an answer using the stored original option labels, without rewriting options',()=>{
 const old={type:'single',stem:'synthetic',answer:'',analysis:'old analysis',point:'old point',options:JSON.stringify([{label:'A',text:'wrong'},{label:'C',text:'correct'}])};
 const f=duplicateCapture(old);const update=f.writes.find(w=>w.sql.startsWith('UPDATE questions SET answer='));
 assert.equal(update.args[0],'C');assert(!f.writes.some(w=>/SET options=/.test(w.sql)));
 assert.equal(require('./src/bank-judge').judgeQ({...old,answer:update.args[0]},'C'),true);
});
for(const scenario of ['different-options','ambiguous-text','changed-stem'])test(`I2 duplicate capture refuses uncertain answer mapping (${scenario})`,()=>{
 const old={type:'single',stem:scenario==='changed-stem'?'different question':'synthetic',answer:'',analysis:'old',point:'old',options:JSON.stringify(scenario==='different-options'?[{label:'A',text:'another'},{label:'B',text:'different'}]:scenario==='ambiguous-text'?[{label:'A',text:'correct'},{label:'B',text:'correct'}]:[{label:'A',text:'wrong'},{label:'B',text:'correct'}])};
 assert.throws(()=>duplicateCapture(old),/选项|题目|答案/);
});
test('I1 rich text attributes containing quoted angle brackets do not leak into content or break markup',()=>{
 const {questionStemFields}=require('./src/question-content');const input='<p title="x > 2 &amp; y < 4">若a<b>c，<b title=\'a > 1\'>求值</b>。</p>';
 const result=questionStemFields('',input);assert.equal(result.stem,'若a<b>c，求值。');
 const {JSDOM}=require('jsdom');const dom=new JSDOM(result.stem_html);try{assert.equal(dom.window.document.body.textContent,'若a<b>c，求值。');assert.equal(dom.window.document.querySelector('p').title,'x > 2 & y < 4');}finally{dom.window.close();}
});
function legacyStringScan(t, linked) {
 const f=pendingFixture(t),options=JSON.stringify(['甲','乙']);
 if(linked){f.raw.prepare("INSERT INTO questions(id,subject,stage,grade,stem,type,options,answer,point) VALUES(99,'数学','primary','四年级','旧扫码题','single',?,'','旧知识点')").run(options);f.raw.exec('UPDATE paper_uploads SET question_id=99 WHERE id=3');}
 else f.raw.prepare('UPDATE paper_uploads SET draft_json=? WHERE id=3').run(JSON.stringify({type:'single',stem:'旧扫码题',options:JSON.parse(options),answer:'',point:'旧知识点'}));
 return f;
}
for(const linked of [false,true])test(`I2 legacy string scan options retain labels/text in the real pending list (linked=${linked})`,async t=>{
 const f=legacyStringScan(t,linked),item=(await f.list()).find(x=>x.id==='up:3');
 assert.deepEqual(Array.from(item.options,o=>({label:o.label,text:o.text})),[{label:'A',text:'甲'},{label:'B',text:'乙'}]);
});
for(const linked of [false,true])test(`I2 legacy string scan accepts valid B editing without relaxing invalid C rejection (linked=${linked})`,async t=>{
 const f=legacyStringScan(t,linked);
 const edited=await f.call('PUT /ext/pending/item',{id:'up:3',patch:{stem:'合法修改',answer:'B',point:'新知识点'}});
 assert.equal(edited.code,0,edited.msg);const item=(await f.list()).find(x=>x.id==='up:3');assert.equal(item.stem,'合法修改');assert.equal(item.answer,'B');
 assert.deepEqual(Array.from(item.options,o=>({label:o.label,text:o.text})),[{label:'A',text:'甲'},{label:'B',text:'乙'}]);
 const before=f.snapshot();const invalid=await f.call('PUT /ext/pending/item',{id:'up:3',patch:{stem:'不应保存',answer:'C',point:'不应修改'}});
 assert.notEqual(invalid.code,0);assert.match(invalid.msg,/答案/);assert.equal(f.snapshot(),before);
});
test('I2 snapshot-bound bulk editor accepts an unchanged legacy string option list with a valid new answer',async t=>{
 const f=legacyStringScan(t,true),item=(await f.list()).find(x=>x.id==='up:3');
 const result=await f.edit([f.entry(item,{answer:'B'})]);assert.equal(result.code,0,result.msg);
 const row=f.raw.prepare('SELECT answer, options FROM questions WHERE id=99').get();assert.equal(row.answer,'B');assert.deepEqual(JSON.parse(row.options),[{label:'A',text:'甲'},{label:'B',text:'乙'}]);
});
