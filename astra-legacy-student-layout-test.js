'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(file,'utf8');
async function fixture(desktopNav) {
  const dom = new JSDOM('<div id="app"></div>',{url:'http://localhost/#/home',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window; let captured;
  Object.assign(w,{ Auth:{token:'synthetic',user:{id:1,name:'合成学生',role:'student',grade:'七年级'}},api:async()=>[],canPreview:()=>false,fileKind:()=>'',fmtSize:()=>'',scrollTo(){},Vue:{createApp(a){captured=a;return {mount(){}};}} });
  w.eval(read('public/js/vue-app.js'));w.eval(read('public/vendor/vue.global.prod.js'));
  const start=captured.template.indexOf('<header class="round-topbar">'),end=captured.template.indexOf('</aside>',start)+8;
  const app=w.Vue.createApp({data(){return {...captured.data(),page:'home',desktopNav,mobileNavOpen:false};},computed:captured.computed,methods:captured.methods,template:'<main>'+captured.template.slice(start,end)+'</main>'});
  const state=app.mount('#app');await w.Vue.nextTick();
  return {w,state,captured,d:w.document,tick:()=>w.Vue.nextTick(),close(){app.unmount();w.close();}};
}
test('desktop navigation remains accessible when the mobile drawer is closed',async()=>{
  const f=await fixture(true);try{const nav=f.d.querySelector('.st-side');assert.equal(nav.hasAttribute('inert'),false);assert.equal(nav.getAttribute('aria-hidden'),'false');assert.ok(nav.id);for(const a of nav.querySelectorAll('nav a')){assert.ok(a.querySelector('.ic'));assert.ok(a.querySelector('.nt'));}}finally{f.close();}
});
test('mobile closed navigation is not keyboard reachable, and repeated current route closes it',async()=>{
  const f=await fixture(false);try{const nav=f.d.querySelector('.st-side');assert.equal(nav.hasAttribute('inert'),true);f.state.mobileNavOpen=true;await f.tick();const link=nav.querySelector('a[href="#/home"]:not(.sbrand)');link.click();await f.tick();assert.equal(f.state.mobileNavOpen,false);assert.equal(nav.getAttribute('aria-hidden'),'true');}finally{f.close();}
});
test('subject, papers and learning tools announce the actual selected destination',async()=>{
  const f=await fixture(true);try{for(const [page,wordSub,text] of [['home','quick','学习空间'],['papers','quick','试卷'],['mistakes','quick','错题本'],['words','quick','速记训练'],['tool','quick','专注计时']]){f.state.page=page;f.state.wordSub=wordSub;await f.tick();const active=f.d.querySelectorAll('.st-side nav a[aria-current="page"]');assert.equal(active.length,1);assert.equal(active[0].querySelector('.nt').textContent,text);}f.state.page='courses';f.state.subject='英语';await f.tick();assert.equal(f.d.querySelector('.st-side [aria-current="page"] .nt').textContent,'英语');}finally{f.close();}
});

test('navigation media subscription follows resize and is removed when the app unmounts', async()=>{
 const f=await fixture(false);try{
  let onChange,removed;f.w.matchMedia=()=>({matches:false,addEventListener(type,fn){assert.equal(type,'change');onChange=fn;},removeEventListener(type,fn){removed=fn;}});
  f.captured.created.call(f.state); f.state.mobileNavOpen=true; onChange({matches:true}); await f.tick();
  assert.equal(f.state.desktopNav,true);assert.equal(f.state.mobileNavOpen,false);assert.equal(f.d.querySelector('.st-side').hasAttribute('inert'),false);
  onChange({matches:false});await f.tick();assert.equal(f.d.querySelector('.st-side').hasAttribute('inert'),true);
  f.captured.beforeUnmount.call(f.state);assert.equal(removed,onChange);
 }finally{f.close();}
});
test('a browser without matchMedia can still initialize the mobile navigation', async()=>{
 const f=await fixture(false);try{assert.doesNotThrow(()=>f.captured.created.call(f.state));assert.doesNotThrow(()=>f.captured.beforeUnmount.call(f.state));}finally{f.close();}
});
