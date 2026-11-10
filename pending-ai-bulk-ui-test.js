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

test('all ten requested actions are inside the disclosure in two ordered groups with selection intact',async t=>{
 const f=await pendingPage(t),details=f.document.querySelector('.pd-advanced');
 const groups=[['pd-bedit','pd-bcommit','pd-bmerge','pd-bclassify','pd-bdel'],['pd-breview','pd-bapply-stem','pd-bapply-answer','pd-bai','pd-bfill-review']];
 assert.equal(details.open,false);
 for(const [i,ids] of groups.entries())for(const id of ids){const b=f.document.getElementById(id);assert.ok(details.contains(b),id);assert.equal(b.closest('[data-pd-tool-group]').dataset.pdToolGroup,i===0?'batch':'ai');assert.equal(typeof b.onclick,'function',id);}
 details.open=true;f.document.querySelector('#pd-all').click();assert.match(f.document.querySelector('#pd-selcnt').textContent,/已选 3 题/);assert.match(f.document.querySelector('#pd-tool-selection').textContent,/已选 3 题/);
 details.open=false;assert.equal(f.document.querySelectorAll('[data-review-row] input:checked').length,3);details.open=true;assert.equal(f.document.querySelector('#pd-all').checked,true);
});
test('rearranged toolbar actions still dispatch to their original handlers for selected questions',async t=>{
 const f=await pendingPage(t),calls=[];f.document.querySelectorAll('[data-review-row] input')[0].click();f.document.querySelectorAll('[data-review-row] input')[1].click();
 f.ctx.pdBulkEdit=(ids,_by,_notes,field)=>calls.push(['bulk',field||'edit',ids.length]);f.ctx.pdAiReview=ids=>calls.push(['review',ids.length]);
 f.ctx.pdBatchCommit=ids=>calls.push(['commit',ids.length]);f.ctx.pdAiClassify=ids=>calls.push(['classify',ids.length]);f.ctx.pdAiFill=ids=>calls.push(['fill',ids.length]);
 f.ctx.elConfirm=async x=>{calls.push(['confirm',x.title]);return false};
 for(const id of ['pd-bedit','pd-bcommit','pd-bmerge','pd-bclassify','pd-bdel','pd-breview','pd-bapply-stem','pd-bapply-answer','pd-bai','pd-bfill-review']){f.document.getElementById(id).click();await settle();}
 assert.deepEqual(calls,[['bulk','edit',2],['commit',2],['confirm','合并两段跨页题'],['classify',2],['confirm','批量删除'],['review',2],['bulk','stem',2],['bulk','answer',2],['fill',2],['bulk','supplement',2]]);assert.equal(f.calls.length,0);
});

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
test('unchanged bulk editor closes without writing and explains how to continue review',async t=>{
 const f=fixture(t),w=f.open();await w.querySelector('#mOk').onclick();
 assert.equal(f.calls.length,0);assert.equal(f.document.querySelector('.mask'),null);
 assert.ok(f.messages.some(m=>/无需保存/.test(m.message)&&/核对/.test(m.message)));
});
test('commit guidance shows every actual blocker and locates the first required action without writing',async t=>{
 const f=await pendingPage(t),row=f.rows[0];Object.assign(row,{content_review_required:true,content_review_pending:true,figure_missing:[1],ai_legacy_pending:true,ai_legacy_pending_fields:['answer','analysis','classification']});await f.ctx.render();
 const hint=f.document.querySelector('#pd-commit-hint'),next=f.document.querySelector('#pd-review-next');
 assert.equal(f.document.querySelector('#pd-current-commit').disabled,true);
 assert.match(hint.textContent,/原页/);assert.match(hint.textContent,/题图/);assert.match(hint.textContent,/答案.*解析.*分类/);assert.match(hint.textContent,/无需修改/);
 assert.ok(next&&!next.hidden);let scrolled=false;const content=f.document.querySelector('[data-act="content-review"]');content.scrollIntoView=()=>{scrolled=true};next.click();assert.equal(scrolled,true);assert.equal(f.calls.length,0);
});
test('unmodified questions can proceed while actual image and AI review gates remain specific',async t=>{
 const f=await pendingPage(t),row=f.rows[0];row.ai_answer_suggestion={source:'review',stem:'合成建议',token:'x'};await f.ctx.render();
 assert.equal(f.document.querySelector('#pd-current-commit').disabled,false);assert.match(f.document.querySelector('#pd-commit-hint').textContent,/无需修改/);
 row.figure_review_required=true;row.figure_review_issue='图文待确认';row.ai_review_pending_fields=['answer','analysis'];await f.ctx.render();
 assert.equal(f.document.querySelector('#pd-current-commit').disabled,true);const hint=f.document.querySelector('#pd-commit-hint').textContent;assert.match(hint,/图文/);assert.match(hint,/答案.*解析/);
 assert.ok(f.document.querySelector('[data-act="confirm-figure"]'));assert.ok(f.document.querySelector('[data-act="recheck-answer"]'));assert.ok(f.document.querySelector('[data-act="recheck-analysis"]'));assert.equal(f.calls.length,0);
});
test('bulk editor sends only changed fields with the selected card snapshot and no import',async t=>{
 const f=fixture(t),w=f.open();w.querySelector('[data-pd-field="answer"]').value='老师手改';await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/ext/pending/items'));
 assert.deepEqual(f.calls[0].options.body.items,[{id:f.rows[0].id,expected:'snapshot-0',patch:{answer:'老师手改'}}]);assert.ok(!f.document.querySelector('.mask'));assert.ok(f.messages.some(m=>/保存 1 题/.test(m.message)&&/1 题无需保存/.test(m.message)));
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

test('inline suggestion diff marks changed characters and preserves newlines without executing HTML',t=>{
 const f=fixture(t);const s=f.rows[0].ai_answer_suggestion;s.stem='合成题，0<script>';s.answer='原答案！0';const w=f.open();
 const stem=w.querySelector('[data-pd-diff="stem"]'),answer=w.querySelector('[data-pd-diff="answer"]');
 assert.ok(stem&&answer,'题干、答案旁展示差异');assert.ok(stem.querySelector('ins'));assert.ok(answer.querySelector('del,ins'));assert.equal(w.querySelectorAll('script').length,0);assert.match(stem.textContent,/<script>/);
});
test('bulk apply fills only untouched valid suggestions and permits further manual edits',t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.stem='新题干';f.rows[1].ai_answer_suggestion={source:'review',token:'two',stale:true,answer:'不能覆盖'};const w=f.open();
 const answer=w.querySelector('[data-pd-bulk-index="0"] [data-pd-field="answer"]');answer.value='我手写的';answer.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));w.querySelector('[data-pd-apply-field="stem"]').click();w.querySelector('[data-pd-apply-field="answer"]').click();
 assert.equal(answer.value,'我手写的');assert.equal(w.querySelector('[data-pd-bulk-index="0"] [data-pd-field="stem"]').value,'新题干');assert.equal(w.querySelector('[data-pd-bulk-index="1"] [data-pd-field="answer"]').value,'原答案 1');assert.match(w.textContent,/跳过/);
});

test('classification select-all saves selected nodes and fields to draft in one atomic request, never commit',async t=>{
 const f=fixture(t);f.ctx.document.querySelector('.pd-workspace').insertAdjacentHTML('beforeend','<button id="pd-bclassify"></button>');
 const call=f.ctx.api;f.ctx.api=async(url,options)=>url.endsWith('/ai-classify')?{mock:false,list:[{id:f.rows[0].id,type:'fill',difficulty_score_10:3,nodes:[{id:11,kind:'knowledge',name:'加法',path:'数学 / 加法',tree_name:'知识树'}]}]}:call(url,options);
 await f.ctx.pdAiClassify([f.rows[0].id],Object.fromEntries(f.rows.map(x=>[x.id,x])));const w=f.document.querySelector('.mask');w.querySelector('[data-ai-select-all]').click();await w.querySelector('#mOk').onclick();
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/ext/pending/items'));assert.deepEqual(f.calls[0].options.body.items[0].patch.draft_node_ids,[11]);assert.ok(f.calls.every(c=>!c.url.endsWith('/commit')));
});

test('a deliberate bulk confirmation confirms only rows with adopted suggestions',t=>{
 const f=fixture(t),w=f.open();w.querySelector('[data-pd-apply-field="answer"]').click();w.querySelector('[data-pd-confirm-all]').click();assert.equal(w.querySelector('[data-pd-bulk-index="0"] [data-pd-ai-confirm]').checked,true);assert.equal(w.querySelectorAll('[data-pd-ai-confirm]:checked').length,1);
});
test('character diff preserves text, whitespace, formula and image markers on both sides',t=>{
 const f=fixture(t),a='甲\n$x+1$ [图1]。',b='甲\n$x+2$ [图1]！',el=f.document.createElement('div');el.innerHTML=f.ctx.pdDiffHTML(a,b);let old='',now='';for(const node of el.childNodes){if(node.nodeName!=='INS')old+=node.textContent;if(node.nodeName!=='DEL')now+=node.textContent;}assert.equal(old,a);assert.equal(now,b);assert.equal(el.querySelector('script'),null);
});

test('late classification response cannot open a dialog over another page or unsaved form',async t=>{
 const f=fixture(t),delayed=deferredReview();f.document.querySelector('.pd-workspace').insertAdjacentHTML('beforeend','<button id="pd-bclassify"></button>');f.ctx.api=()=>delayed.promise;
 const work=f.ctx.pdAiClassify([f.rows[0].id],Object.fromEntries(f.rows.map(x=>[x.id,x])));f.replacePage('<input id="other-draft" value="保留">');delayed.resolve({mock:false,list:[]});await work;assert.equal(f.document.querySelectorAll('.mask').length,0);assert.equal(f.document.querySelector('#other-draft').value,'保留');
});

test('keeping a single suggestion is an explicit persistent decision without changing the original',async t=>{
 const f=fixture(t),w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]');row.querySelector('[data-pd-keep="answer"]').click();assert.equal(row.querySelector('[data-pd-field="answer"]').value,'原答案 0');assert.match(row.querySelector('[data-pd-keep="answer"]').textContent,/已选择/);await w.querySelector('#mOk').onclick();assert.deepEqual(f.calls[0].options.body.items[0].ai_keep_fields,['answer']);assert.equal(f.calls[0].options.body.items[0].ai_token,'review-1');
});

test('changed classification scope requires explicit confirmation before retaining draft nodes',async t=>{
 const f=fixture(t);Object.assign(f.rows[0],{draft_node_ids:[11],draft_node_stale:true});f.ctx.document.querySelector('.pd-workspace').insertAdjacentHTML('beforeend','<button id="pd-bclassify"></button>');const call=f.ctx.api;f.ctx.api=async(url,options)=>url.endsWith('/ai-classify')?{mock:false,list:[{id:f.rows[0].id,nodes:[],current_nodes:[{id:11,kind:'knowledge',name:'加法',path:'加法'}]}]}:call(url,options);
 await f.ctx.pdAiClassify([f.rows[0].id],Object.fromEntries(f.rows.map(x=>[x.id,x])));const w=f.document.querySelector('.mask');await w.querySelector('#mOk').onclick();assert.equal(f.calls.length,0);assert.ok(f.messages.some(m=>/范围已变化/.test(m.message)));w.querySelector('[data-ai-scope-confirm]').click();await w.querySelector('#mOk').onclick();assert.deepEqual(f.calls[0].options.body.items[0].patch.draft_node_ids,[11]);
});

test('preview places review diffs inside original stem and answer instead of separate suggestion cards',async t=>{
 const f=await pendingPage(t);f.rows[0].ai_answer_suggestion.stem='修订题 0';await f.ctx.render();
 const stem=f.document.querySelector('.pd-stem'),answer=f.document.querySelector('.pd-answer-line');
 assert.ok(stem.querySelector('del') && stem.querySelector('ins'),'题干原位置包含差异');assert.ok(answer.querySelector('del') && answer.querySelector('ins'),'答案原位置包含差异');assert.equal(stem.nextElementSibling?.classList.contains('pd-suggestion'),false);
});
test('editor starts with inline comparison and switches to editing without losing manual text',t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.stem='合成新题';const w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]');const input=row.querySelector('[data-pd-field="stem"]'),view=row.querySelector('[data-pd-field-view="stem"]');
 assert.equal(input.hidden,true);assert.ok(view.querySelector('del')&&view.querySelector('ins'));row.querySelector('[data-pd-edit-field="stem"]').click();assert.equal(input.hidden,false);assert.equal(view.hidden,true);input.value='老师手动题干';input.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));row.querySelector('[data-pd-view-field="stem"]').click();row.querySelector('[data-pd-edit-field="stem"]').click();assert.equal(input.value,'老师手动题干');
});
test('separate review bulk controls only fill corresponding field and skip stale or supplemental suggestions',t=>{
 const f=fixture(t);f.rows[0].ai_answer_suggestion.stem='修订题干';f.rows[1].ai_answer_suggestion={source:'review',token:'two',stale:true,stem:'过期题干',answer:'过期答案'};f.rows[2].ai_answer_suggestion={token:'fill',stale:false,answer:'补充答案'};
 f.ctx.pdBulkEdit(f.rows.map(x=>x.id),Object.fromEntries(f.rows.map(x=>[x.id,x])));const w=f.document.querySelector('.mask'),r0=w.querySelector('[data-pd-bulk-index="0"]'),r1=w.querySelector('[data-pd-bulk-index="1"]'),r2=w.querySelector('[data-pd-bulk-index="2"]');
 w.querySelector('[data-pd-apply-field="stem"]').click();assert.equal(r0.querySelector('[data-pd-field="stem"]').value,'修订题干');assert.equal(r0.querySelector('[data-pd-field="answer"]').value,'原答案 0');assert.equal(r1.querySelector('[data-pd-field="stem"]').value,'合成题 1');assert.match(w.querySelector('[data-pd-apply-status]').textContent,/过期/);
 w.querySelector('[data-pd-apply-field="answer"]').click();assert.equal(r0.querySelector('[data-pd-field="answer"]').value,'AI参考答案');assert.equal(r0.querySelector('[data-pd-field="analysis"]').value,'原解析 0');assert.equal(r2.querySelector('[data-pd-field="answer"]').value,'原答案 2');
});
test('review bulk does not override text touched by a person even when reverted to original',t=>{
 const f=fixture(t),w=f.open(),row=w.querySelector('[data-pd-bulk-index="0"]'),field=row.querySelector('[data-pd-field="answer"]');row.querySelector('[data-pd-edit-field="answer"]').click();field.value='临时';field.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));field.value='原答案 0';field.dispatchEvent(new f.ctx.window.Event('input',{bubbles:true}));w.querySelector('[data-pd-apply-field="answer"]').click();assert.equal(field.value,'原答案 0');assert.match(w.querySelector('[data-pd-apply-status]').textContent,/人工/);
});

test('supplemental flow only fills blank fields and never fills review proposals',t=>{
 const f=fixture(t);f.rows[1].answer='';f.rows[1].analysis='';f.rows[1].ai_answer_suggestion={token:'supplement',answer:'补充答案',analysis:'补充解析',stale:false};const w=f.open();w.querySelector('[data-pd-apply-supplement]').click();const a=w.querySelector('[data-pd-bulk-index="0"]'),b=w.querySelector('[data-pd-bulk-index="1"]');assert.equal(a.querySelector('[data-pd-field="answer"]').value,'原答案 0');assert.equal(b.querySelector('[data-pd-field="answer"]').value,'补充答案');assert.equal(b.querySelector('[data-pd-field="analysis"]').value,'补充解析');assert.match(w.querySelector('[data-pd-apply-status]').textContent,/补充/);
});

test('supplement generation sends the selected snapshot, reports skips, and does not touch review suggestions',async t=>{
 const f=fixture(t),r=f.rows[1];Object.assign(r,{answer:'',analysis:'',ai_review_signature:'signature-one'});f.document.querySelector('.pd-workspace').insertAdjacentHTML('beforeend','<button id="pd-bai"></button>');f.ctx.api=async(url,options)=>{f.calls.push({url,options:JSON.parse(JSON.stringify(options))});return {suggested:1,stale:0,pending_suggestions:0}};
 await f.ctx.pdAiFill([f.rows[0].id,r.id],Object.fromEntries(f.rows.map(x=>[x.id,x])));assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/aifill'));assert.deepEqual(f.calls[0].options.body.indexes,[1]);assert.equal(f.calls[0].options.body.expected[0].signature,'signature-one');assert.ok(f.messages.some(m=>/已生成 1 题/.test(m.message)&&/已有/.test(m.message)));
});

test('inline review retains image markers and escapes untrusted AI text; stale text stays original',t=>{
 const f=fixture(t),item={stem:'算 $x+1$ [图1]。',images:['/safe.png'],ai_answer_suggestion:{source:'review',stem:'算 $x+2$ [图1]。<script>bad()</script>',stale:false}},el=f.document.createElement('div');el.innerHTML=f.ctx.pdInlineReview(item,'stem','原题');assert.equal(el.querySelectorAll('img').length,1);assert.equal(el.querySelectorAll('script').length,0);assert.ok(el.textContent.includes('[图1]'));assert.ok(el.textContent.includes('<script>'));item.ai_answer_suggestion.stale=true;el.innerHTML=f.ctx.pdInlineReview(item,'stem','原题');assert.equal(el.querySelector('del,ins'),null);assert.match(el.textContent,/过期/);
});
