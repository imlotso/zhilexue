'use strict';
process.env.STORAGE_DRIVER='local';process.env.AI_MOCK='1';process.env.TTS_MOCK='1';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function fixture(t){
 const pendingHTML='<section class="pd-workspace"><button id="pd-breview">AI 审核</button><input id="pending-draft" value="原草稿"></section>';
 const dom=new JSDOM('<body><main id="app">'+pendingHTML+'</main></body>',{url:'http://localhost/#/pending'});t.after(()=>dom.window.close());
 const calls=[],messages=[];let failure=false, hold=null, refreshHold=null, renders=0;
 const rows=[0,1,2].map(i=>({id:`run:1:${i}:12345678`,kind:'run',index:i,batch_id:1,edit_signature:'snapshot-'+i,source_label:'Word导入',subject:'数学',stage:'primary',grade:'四年级',type:'fill',type_name:'填空题',point:'加法',stem:'合成题 '+i,material:'',options:[],answer:'原答案 '+i,analysis:'原解析 '+i,images:[],difficulty_score_10:null,ai_answer_suggestion:i===0?{source:'review',token:'review-1',stale:false,summary:'请核对计算',issues:['答案可能有误'],answer:'AI参考答案',analysis:'AI参考解析'}:null}));
 const ctx={window:dom.window,document:dom.window.document,location:dom.window.location,Auth:{token:'session-one',user:{id:1,role:'admin'}},RENDER_SEQ:1,URLSearchParams,console,esc,ic:()=>'',ADM:{page:{pd:{source:'all',sel:{}}}},mtxTypeset:()=>{},t8Enhance:()=>{},toast:(message,type)=>messages.push({message,type}),render:async()=>{const version=++ctx.RENDER_SEQ;renders++;dom.window.document.querySelector('#app').innerHTML='<div>加载中</div>';if(refreshHold)await refreshHold;if(version===ctx.RENDER_SEQ)dom.window.document.querySelector('#app').innerHTML=pendingHTML;},
  api:async(url,options)=>{calls.push({url,options:JSON.parse(JSON.stringify(options))});if(hold)await hold;if(failure)throw Error('快照已变化，未保存任何修改');return url.endsWith('/ai-review')?{reviewed:1,failed:[],list:[rows[0]]}:{saved:options.body.items.length,list:[]};}
 };
 vm.createContext(ctx);
 const admin=fs.readFileSync(__dirname+'/public/admin/admin.js','utf8'),start=admin.indexOf('function modal('),end=admin.indexOf('\n/**',start);
 vm.runInContext(admin.slice(start,end),ctx);vm.runInContext(fs.readFileSync(__dirname+'/public/admin/pendingui.js','utf8'),ctx);
 const open=()=>{assert.equal(typeof ctx.pdBulkEdit,'function','bulk editor must be implemented');ctx.pdBulkEdit(rows.slice(0,2).map(x=>x.id),Object.fromEntries(rows.map(x=>[x.id,x])));return dom.window.document.querySelector('.mask');};
 return {ctx,rows,calls,messages,document:dom.window.document,open,setFailure:(value=true)=>{failure=value;},holdSave:()=>{let release;hold=new Promise(resolve=>{release=resolve;});return release;},renderCount:()=>renders,holdRender:()=>{let release;refreshHold=new Promise(resolve=>{release=resolve;});return release;},replacePage:(html,hash='#/students')=>{ctx.RENDER_SEQ++;dom.window.history.replaceState(null,'',hash);dom.window.document.querySelector('#app').innerHTML=html;},pendingHTML};
}
// Mount the production page and its delegated click/change handlers. Only the
// external API is synthetic; the buttons, selection rules and modal are real.
async function pendingPage(t){
 const f=fixture(t),request=f.ctx.api;
 Object.assign(f.ctx,{pagerHTML:()=>'',bindPager:()=>{}});
 f.ctx.api=(url,options)=>url.includes('/ext/pending?')?Promise.resolve({list:f.rows,counts:{all:3,word:3},status_counts:{all:3},page:1,size:20,total:3}):request(url,options);
 f.ctx.render=async()=>{const version=++f.ctx.RENDER_SEQ,view=await f.ctx.viewPending();if(version!==f.ctx.RENDER_SEQ)return;f.document.querySelector('#app').innerHTML=view.html;view.after();};
 await f.ctx.render();return f;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('double clicking the real single-question AI review sends one request and shows a busy button without importing',async t=>{
 const f=await pendingPage(t),button=f.document.querySelector('[data-act="review-ai"]'),release=f.holdSave();
 assert.equal(f.document.querySelector('#pd-breview').disabled,true,'no selection must not prevent single-question review');
 button.click();button.click();const during={count:f.calls.length,disabled:button.disabled,label:button.textContent};release();await settle();
 assert.equal(during.count,1,'two real clicks must send only one AI request');assert.equal(during.disabled,true);assert.match(during.label,/审核中/);
 assert.deepEqual(f.calls.map(call=>call.url),['/api/admin/bank/mf/ext/pending/ai-review']);
 assert.deepEqual(f.calls[0].options.body.items,[{id:f.rows[0].id,expected:'snapshot-0'}]);
 assert.equal(f.document.querySelectorAll('.mask').length,1);assert.equal(f.document.querySelector('[data-pd-field="answer"]').value,'原答案 0');
 assert.equal(f.document.querySelector('#pd-breview').disabled,true);assert.equal(f.document.querySelector('[data-act="review-ai"]').disabled,false);
});
test('a failed single-question review restores its real button for retry and leaves zero-selection bulk review disabled',async t=>{
 const f=await pendingPage(t),button=f.document.querySelector('[data-act="review-ai"]');f.setFailure();button.click();await settle();
 assert.equal(f.calls.length,1);assert.equal(button.disabled,false);assert.equal(button.textContent,'AI 审核');assert.equal(f.document.querySelector('#pd-breview').disabled,true);
 assert.ok(f.messages.some(message=>/快照已变化/.test(message.message)));assert.equal(f.document.querySelectorAll('.mask').length,0);
 f.setFailure(false);button.click();await settle();assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url.endsWith('/ai-review')));assert.equal(f.document.querySelectorAll('.mask').length,1);
});
for(const selectedAfter of [false,true])test('selection changes cannot enable bulk AI review during a request; final selected='+selectedAfter,async t=>{
 const f=await pendingPage(t),release=f.holdSave(),bulk=f.document.querySelector('#pd-breview'),single=f.document.querySelector('[data-act="review-ai"]'),checkbox=f.document.querySelector('[data-sel]');
 f.setFailure();single.click();checkbox.click();const selectedBusy=bulk.disabled;checkbox.click();const emptyBusy=bulk.disabled;if(selectedAfter)checkbox.click();
 release();await settle();assert.equal(selectedBusy,true,'paintSel must preserve the in-flight lock');assert.equal(emptyBusy,true);assert.equal(bulk.disabled,!selectedAfter);assert.equal(bulk.textContent,'AI 审核所选');assert.equal(single.disabled,false);
});
test('returning to a question while its AI review is pending keeps the recreated single-question button busy',async t=>{
 const f=await pendingPage(t),release=f.holdSave();f.document.querySelector('[data-act="review-ai"]').click();
 f.document.querySelectorAll('[data-select-item]')[1].click();assert.equal(f.document.querySelector('[data-act="review-ai"]').disabled,false,'a different question remains available');
 f.document.querySelectorAll('[data-select-item]')[0].click();const button=f.document.querySelector('[data-act="review-ai"]');button.click();const during={count:f.calls.length,disabled:button.disabled,label:button.textContent};release();await settle();
 assert.equal(during.count,1);assert.equal(during.disabled,true);assert.match(during.label,/审核中/);
});
test('the real AI review function deduplicates the same selected snapshots even when their order changes',async t=>{
 const f=fixture(t),release=f.holdSave(),byId=Object.fromEntries(f.rows.map(row=>[row.id,row]));
 const first=f.ctx.pdAiReview([f.rows[0].id,f.rows[1].id],byId),duplicate=f.ctx.pdAiReview([f.rows[1].id,f.rows[0].id],byId);const during=f.calls.length;release();await Promise.all([first,duplicate]);
 assert.equal(during,1);assert.equal(f.renderCount(),1);assert.equal(f.document.querySelectorAll('.mask').length,1,'the duplicate must not invalidate the first request');
});
for(const [name,change] of [
 ['new mounted page',f=>f.replacePage(f.pendingHTML,'#/pending')],
 ['new login session',f=>{f.ctx.Auth.token='new-session';}],
 ['new question snapshot',f=>{f.rows[0].edit_signature='updated-snapshot';}],
])test('AI review deduplication allows a '+name,async t=>{
 const f=fixture(t),release=f.holdSave(),byId=Object.fromEntries(f.rows.map(row=>[row.id,row])),first=f.ctx.pdAiReview([f.rows[0].id],byId);change(f);
 const second=f.ctx.pdAiReview([f.rows[0].id],byId);const during=f.calls.length;release();await Promise.all([first,second]);assert.equal(during,2);assert.equal(f.renderCount(),1);assert.equal(f.document.querySelectorAll('.mask').length,1);
});
test('bulk editor renders only selected cards and does not prefill AI or save by opening',t=>{
 const f=fixture(t),w=f.open();assert.equal(w.querySelectorAll('[data-pd-bulk-index]').length,2);assert.equal(w.querySelector('[data-pd-field="answer"]').value,'原答案 0');assert.equal(f.calls.length,0);assert.ok(!w.textContent.includes('合成题 2'));
});
test('bulk editor sends only changed fields with the selected card snapshot and no import',async t=>{
 const f=fixture(t),w=f.open();w.querySelector('[data-pd-field="answer"]').value='老师手改';await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/ext/pending/items'));
 assert.deepEqual(f.calls[0].options.body.items,[{id:f.rows[0].id,expected:'snapshot-0',patch:{answer:'老师手改'}}]);assert.ok(!f.document.querySelector('.mask'));
});
test('AI text stays editable and requires per-card human confirmation before bulk save',async t=>{
 const f=fixture(t),w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]');row.querySelector('[data-pd-suggestion="answer"]').click();const field=row.querySelector('[data-pd-field="answer"]');assert.equal(field.value,'AI参考答案');field.value='老师修订';field.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));
 await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,0);assert.ok(f.document.querySelector('.mask'));
 row.querySelector('[data-pd-ai-confirm]').click();await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,1);const change=f.calls[0].options.body.items[0];assert.equal(change.patch.answer,'老师修订');assert.deepEqual(change.ai_fields,['answer']);assert.equal(change.ai_token,'review-1');assert.equal(change.ai_confirmed,true);
});
test('failed atomic save keeps all manual edits visible for correction',async t=>{
 const f=fixture(t),w=f.open();f.setFailure();w.querySelector('[data-pd-field="answer"]').value='不可丢失的人工修改';await w.querySelector('#mOk').onclick();assert.equal(w.querySelector('[data-pd-field="answer"]').value,'不可丢失的人工修改');assert.ok(w.isConnected);assert.match(w.querySelector('#mErr').textContent,/未保存/);
});
test('stale AI report has no apply controls but manual editing stays available',t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.stale=true;const w=f.open();assert.equal(w.querySelectorAll('[data-pd-suggestion]').length,0);assert.equal(w.querySelector('[data-pd-field="answer"]').disabled,false);
});
test('AI review action sends exact selected snapshots then opens editable results without importing',async t=>{
 const f=fixture(t);assert.equal(typeof f.ctx.pdAiReview,'function');await f.ctx.pdAiReview([f.rows[0].id],Object.fromEntries(f.rows.map(x=>[x.id,x])));assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/ai-review'));assert.deepEqual(f.calls[0].options.body.items,[{id:f.rows[0].id,expected:'snapshot-0'}]);assert.ok(f.document.querySelector('.mask'));
});
test('untrusted AI report text is escaped instead of creating executable markup',t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.summary='<img src=x onerror=alert(1)>';f.rows[0].ai_answer_suggestion.answer='</textarea><script>bad()</script>';const w=f.open();assert.equal(w.querySelectorAll('script,img[onerror]').length,0);assert.ok(w.textContent.includes('<img src=x onerror=alert(1)>'));
});
test('manually typing the exact AI suggestion still requires and sends provenance confirmation',async t=>{
 const f=fixture(t),w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]');row.querySelector('[data-pd-field="answer"]').value='AI参考答案';row.querySelector('[data-pd-ai-confirm]').click();await w.querySelector('#mOk').onclick();const change=f.calls[0].options.body.items[0];assert.deepEqual(change.ai_fields,['answer']);assert.equal(change.ai_token,'review-1');assert.equal(change.ai_confirmed,true);
});

test('bulk editor locks fields during save and restores them after a failed request',async t=>{
 const f=fixture(t),w=f.open(),field=w.querySelector('[data-pd-field="answer"]');field.value='待保存答案';f.setFailure();const release=f.holdSave(),pending=w.querySelector('#mOk').onclick();assert.equal(field.disabled,true);release();await pending;assert.equal(field.disabled,false);assert.equal(field.value,'待保存答案');assert.ok(w.isConnected);
});
test('typing an expired AI suggestion gives a useful validation message instead of a null-control error',async t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.stale=true;const w=f.open();w.querySelector('[data-pd-field="answer"]').value='AI参考答案';await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,0);assert.ok(f.messages.some(x=>/过期/.test(x.message)));assert.equal(w.querySelector('#mErr').classList.contains('hide'),true);
});

test('real confirmation checkbox clicks survive bubbling input and change while content edits invalidate confirmation',t=>{
 const f=fixture(t),w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]'),check=row.querySelector('[data-pd-ai-confirm]');
 row.querySelector('[data-pd-suggestion="answer"]').click();
 const events=[];row.addEventListener('input',event=>{if(event.target===check)events.push('input');});row.addEventListener('change',event=>{if(event.target===check)events.push('change');});
 check.click();assert.deepEqual(events,['input','change']);assert.equal(check.checked,true);
 check.click();assert.equal(check.checked,false);check.click();assert.equal(check.checked,true);
 const field=row.querySelector('[data-pd-field="answer"]');field.value='再修改答案';field.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));assert.equal(check.checked,false);
 check.click();assert.equal(check.checked,true);const subject=row.querySelector('[data-pd-field="subject"]');subject.value='英语';subject.dispatchEvent(new f.ctx.window.Event('change',{bubbles:true}));assert.equal(check.checked,false);
 check.click();assert.equal(check.checked,true);row.querySelector('[data-pd-suggestion="analysis"]').click();assert.equal(check.checked,false);
});

function deferredReview(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function beginDelayedReview(f,index=0){const delayed=deferredReview();f.ctx.api=()=>delayed.promise;const work=f.ctx.pdAiReview([f.rows[index].id],Object.fromEntries(f.rows.map(item=>[item.id,item])));return {work,finish:()=>delayed.resolve({reviewed:1,failed:[],list:[f.rows[index]]}),fail:()=>delayed.reject(Error('旧请求失败'))};}
for(const [name,change] of [
 ['leaving pending for another form',f=>f.replacePage('<input id="other-draft" value="新页面未保存草稿">')],
 ['returning to pending through a new root with the same hash',f=>{f.replacePage('<p>别的页面</p>');f.replacePage(f.pendingHTML,'#/pending');}],
 ['re-rendering the same pending page',f=>f.replacePage(f.pendingHTML,'#/pending')],
 ['switching the pending batch',f=>{f.ctx.ADM.page.pd.batch_id=8;}],
 ['changing a pending filter',f=>{f.ctx.ADM.page.pd.review='no_answer';}],
 ['changing the account',f=>{f.ctx.Auth.user={id:2,role:'branch'};}],
 ['changing the session token',f=>{f.ctx.Auth.token='session-two';}],
 ['editing an unsaved field on the current page',f=>{const input=f.document.querySelector('#pending-draft');input.value='手动未保存';input.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));}],
 ['opening another editing dialog',f=>f.open()],
])test('delayed AI review does not repaint or open stale edits after '+name,async t=>{
 const f=fixture(t),request=beginDelayedReview(f);change(f);const before=[...f.document.querySelector('#app').children],fields=[...f.document.querySelectorAll('input,textarea,select')].map(node=>({node,value:node.value})),dialogs=f.document.querySelectorAll('.mask').length;request.finish();await request.work;
 assert.equal(f.renderCount(),0);assert.deepEqual([...f.document.querySelector('#app').children],before);for(const {node,value} of fields){assert.equal(node.isConnected,true);assert.equal(node.value,value);}assert.equal(f.document.querySelectorAll('.mask').length,dialogs);assert.equal(f.messages.length,0);
});
test('a newer review owns the same page and an older result cannot reset its busy state or open its questions',async t=>{
 const f=fixture(t),old=deferredReview(),fresh=deferredReview();let call=0;f.ctx.api=()=>++call===1?old.promise:fresh.promise;const byId=Object.fromEntries(f.rows.map(item=>[item.id,item]));
 const first=f.ctx.pdAiReview([f.rows[0].id],byId),second=f.ctx.pdAiReview([f.rows[1].id],byId);old.resolve({reviewed:1,failed:[],list:[f.rows[0]]});await first;
 assert.equal(f.renderCount(),0);assert.equal(f.document.querySelectorAll('.mask').length,0);assert.equal(f.document.querySelector('#pd-breview').disabled,true);
 fresh.resolve({reviewed:1,failed:[],list:[f.rows[1]]});await second;assert.equal(f.renderCount(),1);assert.equal(f.document.querySelectorAll('.mask').length,1);assert.equal(f.document.querySelector('[data-pd-field="stem"]').value,'合成题 1');
});
for(const [name,change] of [
 ['navigating away and editing a different page',f=>f.replacePage('<input id="other-draft" value="刷新期间的新草稿">')],
 ['a newer pending render',f=>f.replacePage(f.pendingHTML,'#/pending')],
 ['a different account session',f=>{f.ctx.Auth.token='new-session';}],
 ['an unrelated dialog',f=>f.open()],
])test('AI review checks ownership again after its awaited render: '+name,async t=>{
 const f=fixture(t),release=f.holdRender();let renderStarted;const started=new Promise(resolve=>{renderStarted=resolve;});const realRender=f.ctx.render;f.ctx.render=()=>{const promise=realRender();renderStarted();return promise;};
 const pending=f.ctx.pdAiReview([f.rows[0].id],Object.fromEntries(f.rows.map(item=>[item.id,item])));await started;change(f);const dialogs=f.document.querySelectorAll('.mask').length,other=f.document.querySelector('#other-draft');release();await pending;
 assert.equal(f.document.querySelectorAll('.mask').length,dialogs);if(other)assert.equal(f.document.querySelector('#other-draft'),other);
});
test('obsolete delayed AI failures are silent while the current pending failure remains visible',async t=>{
 const f=fixture(t),old=beginDelayedReview(f);f.replacePage('<input value="草稿">');old.fail();await old.work;assert.equal(f.messages.length,0);
 f.replacePage(f.pendingHTML,'#/pending');const current=beginDelayedReview(f);current.fail();await current.work;assert.equal(f.messages.length,1);assert.match(f.messages[0].message,/旧请求失败/);assert.equal(f.renderCount(),0);
});
