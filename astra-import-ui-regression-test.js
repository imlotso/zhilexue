'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(p,'utf8');
function harness(){
 const dom=new JSDOM('<div id="view"></div>',{url:'https://example.test/admin/',runScripts:'outside-only'});
 const w=dom.window;
 Object.assign(w,{esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),ic:()=>'',ADM:{page:{}},toast:()=>{},render:()=>{},optDisplay:s=>s,mtxTypeset:()=>{},optText:s=>s});
 w.eval(read('public/admin/mfbankui.js')); w.eval(read('public/admin/pendingui.js'));
 return dom;
}
test('fill answer preview distinguishes alternatives and blanks, without changing source',()=>{
 const d=harness(), w=d.window;
 const item={type:'fill',answer:'100|||三|<x>'};
 const html=w.pdAnswerHTML(item);
 assert.match(html,/100.*或.*三/);assert.match(html,/第 2 空/);assert.match(html,/&lt;x&gt;/);assert.doesNotMatch(html,/\|\|\|/);
 assert.equal(item.answer,'100|||三|<x>');
 assert.equal(w.pdAnswerHTML({type:'answer',answer:'a|b|||c'}),'a|b|||c');d.window.close();
});
test('empty workbench disables unavailable actions and enables after adding a card',async()=>{
 const d=harness(), w=d.window; const run={id:1,title:'合成测试',source_kind:'image',pages:[],drafts:[],ocr_texts:[]};
 w.api=async(url,opts)=>{ if(url.endsWith('/drafts')){run.drafts=opts.body.drafts;return{};} if(url.includes('/intake/runs/'))return {run}; return {list:[]}; };
 await w.mfIntakeWork(1);
 for(const id of ['wkAuto','wkSemi','wkAllStruct','wkAiFill','wkAsPaper','wkCommit'])assert.equal(w.document.getElementById(id).disabled,true,id);
 assert.match(w.document.querySelector('[aria-label="试卷导入步骤"]').textContent,/保存为试卷草稿/);
 await w.document.getElementById('wkAddCard').onclick();
 assert.equal(w.document.getElementById('wkAiFill').disabled,false);
 assert.equal(w.document.getElementById('wkCommit').disabled,false);
 assert.equal(w.document.getElementById('wkAuto').disabled,true);
 d.window.close();
});
test('student login labels identify inputs; entry titles use consistent brand',()=>{
 const source=read('public/js/vue-app.js');
 const part=source.slice(source.indexOf('<form @submit.prevent="onLogin">'),source.indexOf('</form>',source.indexOf('<form @submit.prevent="onLogin">'))+7);
 const d=new JSDOM(part);
 for(const name of ['账号','密码']){const label=[...d.window.document.querySelectorAll('label')].find(e=>e.textContent===name);assert.ok(label.control,name);}
 assert.match(read('public/index.html'),/<title>智乐学 · 学生端<\/title>/);
 assert.match(read('public/admin/index.html'),/<title>智乐学 · 校长后台<\/title>/);d.window.close();
});
test('recognition locks competing actions and restores them after failure without writing',async()=>{
 const d=harness(),w=d.window;let finish;const writes=[];
 const run={id:1,title:'test',source_kind:'image',pages:[{url:'/test.png'}],drafts:[],ocr_texts:[]};
 w.api=async(url,opts)=>{if(opts)writes.push(url);if(url.endsWith('/recognize')){await new Promise(r=>finish=r);throw Error('synthetic failure');}if(url.endsWith('/runs/1'))return {run};return {list:[]};};
 await w.mfIntakeWork(1);const pending=w.document.getElementById('wkAuto').onclick();
 while(!finish)await new Promise(r=>setImmediate(r));
 for(const id of ['wkSemi','wkUpload','wkWord','wkAllStruct','wkAiFill','wkAsPaper','wkCommit','wkDel','wkAddCard','wkSub','wkStage'])assert.equal(w.document.getElementById(id).disabled,true,id);
 assert.equal(w.document.getElementById('wkAuto').disabled,false,'stop remains available');
 await w.document.getElementById('wkDel').onclick();
 assert.equal(writes.some(url=>url.endsWith('/runs/1')),false);
 finish();await pending;
 assert.equal(w.document.getElementById('wkAuto').disabled,false);
 assert.equal(w.document.getElementById('wkUpload').disabled,false);
 assert.equal(w.document.getElementById('wkAsPaper').disabled,true,'still no cards');
 d.window.close();
});
test('Word text enables all-structure, clearing it disables, and request uses edited text',async()=>{
 const d=harness(),w=d.window;const requests=[];
 const run={id:1,title:'Word',source_kind:'word',pages:[],drafts:[],ocr_texts:['original']};
 w.api=async(url,opts)=>{if(opts)requests.push({url,opts});if(url.endsWith('/runs/1'))return{run};if(url.endsWith('/structure'))return{drafts:[],added:0};return{list:[]};};
 await w.mfIntakeWork(1);const ta=w.document.getElementById('wkOcr1');
 assert.equal(w.document.getElementById('wkAllStruct').disabled,false);
 ta.value='';ta.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.getElementById('wkAllStruct').disabled,true);
 ta.value='edited';ta.dispatchEvent(new w.Event('input',{bubbles:true}));await w.document.getElementById('wkAllStruct').onclick();
 const request=requests.find(r=>r.url.endsWith('/structure'));assert.ok(request);assert.equal(request.opts.body.text,'edited');d.window.close();
});
test('AI fill late completion does not replace a page opened after leaving workbench',async()=>{
 const d=harness(),w=d.window;let finish;
 const run={id:1,title:'test',source_kind:'image',pages:[],drafts:[{type:'answer',stem:'test'}],ocr_texts:[]};
 w.api=async(url,opts)=>{if(url.endsWith('/aifill')){await new Promise(r=>finish=r);return{drafts:run.drafts};}if(url.endsWith('/runs/1'))return{run};return{list:[]};};
 await w.mfIntakeWork(1);const pending=w.document.getElementById('wkAiFill').onclick();while(!finish)await new Promise(r=>setImmediate(r));
 w.document.getElementById('view').innerHTML='<p id="new-page">new page</p>';finish();await pending;assert.ok(w.document.getElementById('new-page'));d.window.close();
});
