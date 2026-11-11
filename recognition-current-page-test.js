'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('src/mfbank.js','utf8');
const fn = source.slice(source.indexOf('async function visionCall('), source.indexOf('/** AI 识别：'));
const reads = [], payloads = [];
const fakeRequire = name => {
  assert.equal(name,'./mfcollect');
  return {mfAiInvoke: async p => {payloads.push(p); return {text:'ok'};}};
};
const context = {store:{readBuffer:async key=>{reads.push(key);return Buffer.from(key);}},require:fakeRequire,Buffer,aiLib:{}};
vm.createContext(context); vm.runInContext(fn,context);
(async()=>{
  await context.visionCall({key:'current.png'},'system','user',{key:'previous.png'});
  assert.deepStrictEqual(reads,['current.png'],'recognition must not send previous-page image as current-page evidence');
  assert.equal(payloads[0].images.length,1);
  context.require=()=>({mfAiInvoke:async()=>{throw new Error('synthetic unavailable')}});
  context.aiLib={visionChat:async p=>{assert.equal(p.images.length,1);assert.equal(p.images[0].mime,'image/png');assert.equal(p.images[0].buf.toString(),'current.png');return {text:'fallback'}}};
  assert.equal(await context.visionCall({key:'current.png'},'system','user',{key:'previous.jpg'}),'fallback');
  assert.deepStrictEqual(reads,['current.png','current.png']);
  const R=require('./src/recognition-pages');
  assert.equal(typeof R.pageInput,'function');
  const input=R.pageInput(3,[{page:2,qno:'13',questionType:'单选',stem:'DO_NOT_ECHO_PREVIOUS_STEM',options:[{label:'A',content:'DO_NOT_ECHO_OPTION'}]}]);
  assert(input.includes('第 3 页'));
  assert(!input.includes('DO_NOT_ECHO'));
  assert(input.includes('13'));
  console.log('Current-page visual and textual evidence isolation passed');
})().catch(e=>{console.error(e);process.exit(1)});
