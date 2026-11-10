'use strict';
// Offline only. Usage: node evidence/intake-repro.cjs [absolute repository path]
// Never imports src/db, storage, providers, or mfbank as a module.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(process.argv[2]||process.cwd());
const localRequire=require('module').createRequire(path.join(root,'package.json'));
const mf=fs.readFileSync(path.join(root,'src/mfbank.js'),'utf8');
const start=mf.indexOf('function commitRunCards('),end=mf.indexOf("\nadmin.post('/intake/runs/:id/commit'",start);
assert(start>=0&&end>start);
let inserted;
const db={prepare(sql){return{run(...args){if(sql.startsWith('INSERT INTO questions (chapter_id'))inserted=args;return{lastInsertRowid:1}},get(){return{subject:'数学',type:'answer'}}}}};
const context={db,TYPE_MAP:{'解答':'answer'},choiceOptionsError:localRequire('./src/choice-options').choiceOptionsError,resolveDifficulty:localRequire('./src/difficulty').resolveDifficulty,jstr:JSON.stringify,int:(x,d=0)=>parseInt(x)||d,now:()=>'',audioKeyOf:x=>x||'',QSubtype:localRequire('./public/js/question-subtypes'),MatchQ:localRequire('./src/match-question'),AiAnswerReview:localRequire('./src/ai-answer-review')};
vm.createContext(context);vm.runInContext(mf.slice(start,end),context);
const input='若 1 < x < 3 且 y > 0，求 x+y。';context.commitRunCards({id:1,subject:'数学',stage:'junior'},[{questionType:'解答',stem:input,options:[],figures:[]}],{});
console.log('I1',JSON.stringify({input,stored_stem:inserted[5],stored_html:inserted[6]}));assert.equal(inserted[5],'若 1 0，求 x+y。');assert.equal(inserted[6],'');
let source=fs.readFileSync(path.join(root,'pending-ai-bulk-review-test.js'),'utf8');source=source.slice(0,source.indexOf("\ntest('AI review covers"));
source=source.replace(/commitRunCards:\(\)=>\{if\(!allowCommit\)[^\n]*?return \[42\];\}/,"commitRunCards:(_r,cards)=>[raw.prepare('INSERT INTO questions (stem,type) VALUES (?,?)').run(cards[0].stem,'fill').lastInsertRowid]");
source=source.replace('return {raw,call,list,snapshot,entry,review,edit,modelRequests,handlers,','return {raw,db,call,list,snapshot,entry,review,edit,modelRequests,handlers,');source+='\nmodule.exports=fixture;';
const moduleObject={exports:{}};vm.runInNewContext(source,{require:localRequire,module:moduleObject,exports:moduleObject.exports,process:{env:{}},Buffer,__dirname:root});
(async()=>{
 const clean=[];try{
  const f=moduleObject.exports({after:fn=>clean.push(fn)}),it=(await f.list()).find(x=>x.kind==='cap');
  const result=await f.call('PUT /ext/pending/item',{id:it.id,patch:{type:'single',options:[{label:'A',text:'错误项'},{label:'C',text:'正确项'}],answer:'C'}});
  const next=(await f.list()).find(x=>x.kind==='cap');const gate=localRequire('./src/choice-options').choiceOptionsError(next.type,next.options);const verdict=localRequire('./src/bank-judge').judgeQ(next,'B');
  console.log('I2',JSON.stringify({result:result.code,options:next.options,answer:next.answer,choiceGate:gate,studentChoosesDisplayedCorrectB:verdict}));assert.equal(result.code,0);assert.equal(next.options[1].label,'B');assert.equal(next.answer,'C');assert.equal(gate,'');assert.equal(verdict,false);
  const run=(await f.list()).find(x=>x.kind==='run'&&x.index===1),prepare=f.db.prepare;let inject=true;
  f.db.prepare=sql=>{if(inject&&sql.startsWith('UPDATE mf_recog_runs SET drafts=?, status=?')){inject=false;throw new Error('synthetic marker write failure')}return prepare(sql)};
  let error;try{await f.call('POST /ext/pending/commit',{ids:[run.id]})}catch(e){error=e.message}
  const before=f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n;const retry=await f.call('POST /ext/pending/commit',{ids:[run.id]});const after=f.raw.prepare('SELECT COUNT(*) n FROM questions').get().n;
  console.log('I3 legacy ids-only path',JSON.stringify({injected:error,questionsAfterFailure:before,retryCode:retry.code,questionsAfterRetry:after}));assert.equal(before,1);assert.equal(after,2);
 }finally{clean.forEach(fn=>fn())}
})().catch(e=>{console.error(e);process.exitCode=1});
