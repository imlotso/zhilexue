'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(extra=''){
 const dom=new JSDOM('<!doctype html><html data-ui-theme="senyu"><body class="sy-theme"><label for="day">记录日期</label><input id="day" name="day" type="date" value="2026-11-09" min="2026-11-02" max="2026-12-15"><button id="after">下一步</button>'+extra+'</body></html>',{runScripts:'outside-only',url:'http://localhost'});
 const path='public/js/senyu-controls.js';dom.window.eval(fs.existsSync(path)?fs.readFileSync(path,'utf8'):'');return dom;
}
const click=(win,el)=>el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
function dayButton(doc,name){return [...doc.querySelectorAll('.sy-calendar button')].find(e=>e.getAttribute('aria-label')===name);}
test('choosing a permitted date updates the original field once and restores focus',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');const events=[];for(const x of ['input','change'])input.addEventListener(x,()=>events.push([x,input.value]));click(w,input);
 assert.ok(d.querySelector('[role=dialog][aria-label="选择日期"]'),'the themed picker opens');assert.equal(input.type,'date');assert.equal(input.name,'day');assert.equal(dayButton(d,'2026年11月1日').disabled,true);click(w,dayButton(d,'2026年11月16日'));
 assert.equal(input.value,'2026-11-16');assert.deepEqual(events,[['input','2026-11-16'],['change','2026-11-16']]);assert.equal(d.querySelector('.sy-calendar'),null);assert.equal(d.activeElement,input);dom.window.close();
});
test('Escape cancels without changing the date and Alt+Down reopens it',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));assert.ok(d.querySelector('.sy-calendar'));d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(d.querySelector('.sy-calendar'),null);assert.equal(input.value,'2026-11-09');assert.equal(d.activeElement,input);dom.window.close();
});
test('disabled, readonly and out-of-step days cannot mutate the original value',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');input.disabled=true;click(w,input);assert.equal(d.querySelector('.sy-calendar'),null);input.disabled=false;input.readOnly=true;click(w,input);assert.equal(d.querySelector('.sy-calendar'),null);input.readOnly=false;input.step='7';click(w,input);assert.ok(d.querySelector('.sy-calendar'));assert.equal(dayButton(d,'2026年11月10日').disabled,true);assert.equal(dayButton(d,'2026年11月16日').disabled,false);input.disabled=true;click(w,dayButton(d,'2026年11月16日'));assert.equal(input.value,'2026-11-09');dom.window.close();
});
test('month changes and keyboard arrows retain one picker and valid dates',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');click(w,input);let selected=dayButton(d,'2026年11月9日');selected.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(d.activeElement.getAttribute('aria-label'),'2026年11月10日');click(w,d.querySelector('[data-sy-month="1"]'));assert.match(d.querySelector('.sy-calendar-title').textContent,/2026年12月/);assert.equal(dayButton(d,'2026年12月16日').disabled,true);assert.equal(d.querySelectorAll('.sy-calendar').length,1);dom.window.close();
});
test('dynamic inputs use their own values, reset can clear, and disconnected inputs cannot save',()=>{
 const dom=setup(),w=dom.window,d=w.document;const other=d.createElement('input');other.type='date';other.value='2027-02-03';d.body.appendChild(other);click(w,other);assert.match(d.querySelector('.sy-calendar-title').textContent,/2027年2月/);click(w,d.querySelector('[data-sy-clear]'));assert.equal(other.value,'');click(w,d.getElementById('day'));d.getElementById('day').remove();click(w,dayButton(d,'2026年11月16日'));assert.equal(other.value,'');assert.equal(d.querySelector('.sy-calendar'),null);dom.window.close();
});
test('calendar keyboard events do not escape into an owning modal focus trap',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day'),seen=[];
 d.addEventListener('keydown',e=>seen.push(e.key));click(w,input);
 d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 assert.deepEqual(seen,[],'the calendar owns its Tab and date navigation');dom.window.close();
});
test('removing or hiding an owning modal dismisses its calendar without stealing focus',async()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');
 const modal=d.createElement('section');modal.setAttribute('role','dialog');input.replaceWith(modal);modal.appendChild(input);click(w,input);modal.hidden=true;
 await new Promise(r=>w.setTimeout(r,0));assert.equal(d.querySelector('.sy-calendar'),null,'hidden owner closes date popup');
 modal.hidden=false;click(w,input);modal.remove();d.getElementById('after').focus();await new Promise(r=>w.setTimeout(r,0));
 assert.equal(d.querySelector('.sy-calendar'),null,'removed owner closes date popup');assert.equal(d.activeElement.id,'after');dom.window.close();
});
test('explicit owner close ignores another date and restores pre-existing input ARIA',()=>{
 const dom=setup('<input id="other" type="date">'),w=dom.window,d=w.document,input=d.getElementById('day');
 input.setAttribute('aria-expanded','false');input.setAttribute('aria-haspopup','dialog');input.setAttribute('aria-controls','existing-description');click(w,input);
 w.SenyuControls.closeDate(d.getElementById('other'));assert.ok(d.querySelector('.sy-calendar'));w.SenyuControls.closeDate(input);
 assert.equal(d.querySelector('.sy-calendar'),null);assert.equal(input.getAttribute('aria-expanded'),'false');assert.equal(input.getAttribute('aria-controls'),'existing-description');dom.window.close();
});
test('PageUp and PageDown clamp month-end navigation, including leap February',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');input.removeAttribute('min');input.removeAttribute('max');
 for(const [value,key,expected] of [['2026-01-31','PageDown','2026年2月28日'],['2026-03-31','PageUp','2026年2月28日'],['2028-01-31','PageDown','2028年2月29日']]){input.value=value;w.SenyuControls.closeDate();click(w,input);d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));assert.equal(d.activeElement.getAttribute('aria-label'),expected);assert.equal(input.value,value,'navigation does not commit');}
 dom.window.close();
});
test('open calendar refreshes live min/max/step constraints without committing a value',async()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');let changes=0;input.addEventListener('change',()=>changes++);input.max='2026-11-09';click(w,input);assert.equal(dayButton(d,'2026年11月10日').disabled,true);input.max='2026-11-30';await new Promise(r=>w.setTimeout(r,0));assert.equal(dayButton(d,'2026年11月10日').disabled,false);input.step='7';await new Promise(r=>w.setTimeout(r,0));assert.equal(dayButton(d,'2026年11月10日').disabled,true);assert.equal(dayButton(d,'2026年11月16日').disabled,false);input.min='2026-11-16';await new Promise(r=>w.setTimeout(r,0));assert.equal(dayButton(d,'2026年11月9日').disabled,true);assert.equal(input.value,'2026-11-09');assert.equal(changes,0);dom.window.close();
});
test('arrow navigation skips disallowed step days while respecting range limits',()=>{
 const dom=setup(),w=dom.window,d=w.document,input=d.getElementById('day');input.step='7';click(w,input);d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(d.activeElement.getAttribute('aria-label'),'2026年11月16日');w.SenyuControls.closeDate();input.min='2026-11-01';input.step='2';click(w,input);d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(d.activeElement.getAttribute('aria-label'),'2026年11月17日');assert.equal(input.value,'2026-11-09');dom.window.close();
});
