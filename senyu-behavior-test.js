'use strict';
// Real existing frontend functions, real DOM, synthetic API responses only.
// This suite does not claim layout, Shadow DOM keyboard or browser visual verification.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM,VirtualConsole}=require('jsdom');
const read=p=>fs.readFileSync(p,'utf8'),settle=()=>new Promise(r=>setTimeout(r,0));
function setup(t,body=''){
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<!doctype html><html data-ui-theme="senyu"><body class="sy-theme sy-core">'+body+'</body></html>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});t.after(()=>{if(dom.window.__quiz)dom.window.__quiz.close();dom.window.close();assert.deepEqual(errors,[],'no uncaught component event errors');});
 const w=dom.window;w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.scrollTo=function(o){this.scrollTop=o.top||0;};
 w.fetch=async()=>{throw Error('Unexpected network request');};return {w,d:w.document};
}
test('real quiz retains question-bound AI gate and does not auto-request explanations',async t=>{
 const {w,d}=setup(t);const requests=[];w.fetch=async(url,opt)=>{requests.push([url,JSON.parse(opt.body)]);assert.equal(url,'/api/stu/bank/check');return {ok:true,status:200,json:async()=>({code:0,data:{list:[{question_id:1,is_correct:true,answer:'B',analysis:'合成解析'}]}})};};
 w.eval(read('public/js/api.js')+'\n'+read('public/js/bank.js'));
 const handle=w.BankQuiz.open({mode:'step',title:'合成回归',questions:[{id:1,type:'single',subject:'数学',stem:'1+1',options:['1','2']},{id:2,type:'single',subject:'数学',stem:'2+2',options:['3','4']}],submit:async()=>{throw Error('Submit not requested');}});w.__quiz=handle;
 assert.match(d.querySelector('#r8AiBody').textContent,/先作答/);assert.equal(d.querySelector('.r8-ai-in textarea').disabled,true);assert.equal(requests.length,0);
 d.querySelectorAll('.qz-opt')[1].click();d.querySelector('#qzCheckOne').click();await settle();await settle();assert.equal(requests.length,1);assert.equal(requests[0][1].items[0].question_id,1);assert.equal(d.querySelector('.r8-ai-in textarea').disabled,false);assert.ok(d.querySelector('.r8-right'));
 d.querySelector('#qzGoNext').click();assert.equal(d.querySelector('.r8-ai-in textarea').disabled,true);assert.match(d.querySelector('#r8AiBody').textContent,/先作答/);assert.equal(d.querySelector('.r8-right'),null);assert.equal(requests.length,1);
});
test('real numeric keypad inserts, deletes, moves caret and hides without changing submission semantics',t=>{
 const {w,d}=setup(t);w.eval(read('public/js/api.js')+'\n'+read('public/js/bank.js'));
 const handle=w.BankQuiz.open({mode:'step',title:'合成填空',questions:[{id:3,type:'fill',subject:'数学',stem:'1+1=____',blanks:1}],submit:async()=>{throw Error('No submit requested');}});w.__quiz=handle;
 const input=d.querySelector('.qz-fill textarea');assert.ok(input);input.focus();assert.notEqual(d.querySelector('#qzKpad').style.display,'none');
 d.querySelector('.kpad-k[data-k="1"]').click();d.querySelector('.kpad-k[data-k="2"]').click();assert.equal(input.value,'12');d.querySelector('[data-act="left"]').click();d.querySelector('.kpad-k[data-k="3"]').click();assert.equal(input.value,'132');d.querySelector('[data-act="del"]').click();assert.equal(input.value,'12');assert.equal(d.activeElement,input);d.querySelector('.kpad-hide').click();assert.equal(d.querySelector('#qzKpad').style.display,'none');
});
test('real chapter and knowledge tree scopes retain selection and search ancestor behavior',async t=>{
 const {w,d}=setup(t,'<div id="tree"></div>');const trees=[{id:10,kind:'textbook',stage:'primary',subject:'数学',edition:'合成版'},{id:11,kind:'knowledge',stage:'primary',subject:'数学',edition:'合成版'}];
 w.esc=s=>String(s);w.tpTrees=async()=>trees;w.tpEditions=()=>['合成版'];w.tpDefaultEdition=()=>'';w.pickTree=(list,q)=>list.find(x=>x.kind===q.kind);w.api=async url=>({list:url.includes('/10/')?[{id:101,parent_id:0,name:'第一章',qcount:1},{id:102,parent_id:101,name:'加法',qcount:1}]:[{id:201,parent_id:0,name:'知识点根',qcount:1},{id:202,parent_id:201,name:'乘法',qcount:1}]});w.eval(read('public/admin/treepanel.js'));
 const panel=w.treePanel(d.getElementById('tree'),{state:{stage:'primary',subject:'数学',kind:'textbook',edition:'合成版'}});await panel.ready;
 d.querySelector('[data-tn="102"]').click();assert.deepEqual(Array.from(panel.ctx().sel),[102]);assert.equal(d.querySelector('[data-tn="102"]').getAttribute('aria-selected'),'true');
 const search=d.querySelector('[data-tp="q"]');search.value='加法';search.dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,180));assert.ok(d.querySelector('[data-tn="101"]'));assert.equal(d.querySelector('mark').textContent,'加法');
 d.querySelector('[data-kind="knowledge"]').click();await settle();assert.equal(panel.ctx().kind,'knowledge');assert.deepEqual(Array.from(panel.ctx().sel),[]);assert.ok(d.querySelector('[data-tn="202"]'));assert.equal(d.querySelector('[data-tn="102"]'),null);
});
test('real formula dialog retains loading/cancel handling and insertion event contract',t=>{
 const {w,d}=setup(t,'<textarea id="answer">前后</textarea><button id="open">公式</button>');w.eval(read('public/js/mlive.js'));
 const handle=w.MLive.dialog({onOk:()=>{throw Error('Unloaded formula must not submit');}});assert.match(d.querySelector('.t8-loading').textContent,/加载中/);assert.equal(d.querySelector('.t8-ok').disabled,true);d.querySelector('.t8-cancel').click();assert.equal(d.querySelector('.t8-mask'),null);
 const input=d.getElementById('answer');input.setSelectionRange(1,1);let events=0;input.addEventListener('input',()=>events++);w.MLive.insertAt(input,'\\(x^2\\)');assert.equal(input.value,'前\\(x^2\\)后');assert.equal(events,1);assert.equal(d.activeElement,input);handle.close();
});
async function keyboardTree(t){
 const {w,d}=setup(t,'<button id="before">前</button><div id="tree"></div><button id="after">后</button>');const trees=[{id:10,kind:'textbook',stage:'primary',subject:'数学',edition:'合成版'},{id:11,kind:'knowledge',stage:'primary',subject:'数学',edition:'合成版'}];
 w.esc=s=>String(s);w.tpTrees=async()=>trees;w.tpEditions=()=>['合成版'];w.tpDefaultEdition=()=>'';w.pickTree=(list,q)=>list.find(x=>x.kind===q.kind);w.api=async()=>({list:[{id:101,parent_id:0,name:'第一章',qcount:1},{id:102,parent_id:101,name:'加法',qcount:1}]});w.eval(read('public/admin/treepanel.js'));const panel=w.treePanel(d.getElementById('tree'),{state:{stage:'primary',subject:'数学',kind:'textbook',edition:'合成版'}});await panel.ready;return {w,d,panel};
}
const press=(w,el,key)=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
test('tree keyboard has one Tab stop, arrow navigation, collapse and selection without changing scope',async t=>{
 const {w,d,panel}=await keyboardTree(t);const stops=[...d.querySelectorAll('[role=treeitem]')].filter(x=>x.tabIndex===0);assert.equal(stops.length,1);stops[0].focus();press(w,stops[0],'ArrowDown');assert.equal(d.activeElement.dataset.tn,'101');press(w,d.activeElement,'ArrowDown');assert.equal(d.activeElement.dataset.tn,'102');press(w,d.activeElement,'Enter');assert.deepEqual(Array.from(panel.ctx().sel),[102]);assert.equal(d.activeElement.dataset.tn,'102');press(w,d.activeElement,'ArrowLeft');assert.equal(d.activeElement.dataset.tn,'101');press(w,d.activeElement,'ArrowLeft');assert.equal(d.activeElement.getAttribute('aria-expanded'),'false');assert.equal(d.querySelector('[data-tn="102"]'),null);assert.equal(panel.ctx().kind,'textbook');
});
test('real cascading scope popup exposes labelled options and keyboard selection/Escape',async t=>{
 const {w,d,panel}=await keyboardTree(t);const trigger=d.querySelector('[data-tp=cas]');trigger.focus();press(w,trigger,'ArrowDown');assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'true');assert.equal(d.activeElement.getAttribute('role'),'option');assert.equal(d.activeElement.closest('[role=listbox]').getAttribute('aria-label'),'学段');
 press(w,d.activeElement,'ArrowRight');assert.equal(d.activeElement.closest('[role=listbox]').getAttribute('aria-label'),'学科');press(w,d.activeElement,'ArrowRight');assert.equal(d.activeElement.closest('[role=listbox]').getAttribute('aria-label'),'教材版本');press(w,d.activeElement,'Enter');await settle();assert.equal(panel.ctx().edition,'合成版');assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'false');assert.equal(d.activeElement.dataset.tp,'cas');
 press(w,d.activeElement,'ArrowDown');press(w,d.activeElement,'Escape');assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'false');assert.equal(d.activeElement.dataset.tp,'cas');
});
test('real long student report retains scrollable modal content under all entry styles',async t=>{
 const {w,d}=setup(t);const path=require('node:path');const entry=new JSDOM(read('public/index.html'));
 for(const link of entry.window.document.querySelectorAll('link[rel=stylesheet]')){const style=d.createElement('style');style.textContent=read(path.resolve('public',link.getAttribute('href').split('?')[0]));d.head.appendChild(style);}entry.window.close();
 w.eval(read('public/js/api.js'));w.esc=String;w.api=async()=>({kp_done:1,kp_total:9,percent:11,handout_done:1,active_days:14,subjects:Array.from({length:9},(_,i)=>({subject:'合成学科'+i,percent:11,done:1,total:9})),days:Array.from({length:14},(_,i)=>({d:'2026-11-'+String(i+1).padStart(2,'0'),n:1})),recent:[]});
 const source=read('public/js/vue-app.js'),start=source.indexOf('    async openReport() {'),end=source.indexOf('\n  },\n  template:',start);assert.ok(start>=0&&end>start);w.eval('window.reportMethods={'+source.slice(start,end)+'};');await w.reportMethods.openReport();
 assert.equal(d.querySelectorAll('.rp-row').length,9);const styles=w.getComputedStyle(d.querySelector('.modal'));assert.equal(styles.maxHeight,'88vh');assert.equal(styles.overflow,'auto','long report must remain scrollable instead of being clipped');
});
test('mixed pointer and keyboard cascader use keeps focus and Escape local after redraw',async t=>{
 const {w,d}=await keyboardTree(t);d.querySelector('[data-tp=cas]').click();d.querySelector('[data-cs="junior"]').dispatchEvent(new w.MouseEvent('mouseenter',{bubbles:false}));assert.notEqual(d.activeElement,d.body);assert.ok(d.activeElement.closest('.r3-cas-slot'));press(w,d.activeElement,'Escape');assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'false');
 d.querySelector('[data-tp=cas]').click();d.querySelector('[data-cs="junior"]').click();assert.notEqual(d.activeElement,d.body);press(w,d.activeElement,'Escape');assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'false');
});
test('clicking a leaf caret cannot pollute expansion state or consume the next expand-all action',async t=>{
 const {w,d,panel}=await keyboardTree(t);w.api=async()=>({list:[{id:101,parent_id:0,name:'第一章',qcount:1},{id:102,parent_id:101,name:'加法',qcount:1},{id:103,parent_id:0,name:'独立叶子',qcount:1}]});await panel.reload();d.querySelector('[data-tp=toggle]').click();assert.equal(d.querySelector('[data-tn="102"]'),null);d.querySelector('[data-tw="103"]').click();assert.equal(d.querySelector('[data-tp=toggle]').title,'全部展开');d.querySelector('[data-tp=toggle]').click();assert.ok(d.querySelector('[data-tn="102"]'));
});
test('real student confirmation dialog overrides legacy primary palette and important corners',async t=>{
 const {w,d}=setup(t);const path=require('node:path'),entry=new JSDOM(read('public/index.html'));for(const link of entry.window.document.querySelectorAll('link[rel=stylesheet]')){const style=d.createElement('style');style.textContent=read(path.resolve('public',link.getAttribute('href').split('?')[0]));d.head.appendChild(style);}entry.window.close();w.eval(read('public/js/api.js'));const result=w.elConfirm({title:'退出做题',message:'合成确认'});const button=d.getElementById('elcOk');assert.ok(button.classList.contains('el-button--primary'));
 assert.equal(w.getComputedStyle(d.body).getPropertyValue('--ry-primary').trim(),'var(--sy-color-primary)');
 const rules=[...d.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.selectorText&&r.style);const matching=rules.filter(r=>r.selectorText.split(',').some(selector=>{try{return button.matches(selector.trim());}catch{return false;}}));assert.ok(matching.some(r=>r.style.getPropertyPriority('background')==='important'&&r.style.background==='var(--sy-color-primary)'), 'actual confirmation primary needs an important theme override');
 assert.equal(w.getComputedStyle(d.querySelector('.el-msgbox')).borderRadius,'24px');d.getElementById('elcNo').click();assert.equal(await result,false);
});
test('cascader closes on real external focusout and never steals focus during a pending hover redraw',async t=>{
 const {w,d}=await keyboardTree(t);d.querySelector('[data-tp=cas]').click();const option=d.querySelector('[data-cs="junior"]');d.getElementById('after').focus();option.dispatchEvent(new w.MouseEvent('mouseenter',{bubbles:false}));assert.equal(d.activeElement.id,'after');await settle();assert.equal(d.querySelector('[data-tp=cas]').getAttribute('aria-expanded'),'false');assert.equal(d.activeElement.id,'after');
});
