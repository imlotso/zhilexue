'use strict';
// Real Vue summary rendering and recount; synthetic course data, no backend/browser.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
async function fixture(t){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="app"></div>',{url:'https://synthetic.test/',runScripts:'outside-only',virtualConsole:vc}),w=dom.window;
 w.Auth={token:'synthetic-only',user:{id:71,name:'合成学生',grade:'七年级',role:'student'}};
 w.fileKind=()=>'';w.fmtSize=()=>'';w.canPreview=()=>false;
 let captured;w.Vue={createApp(options){captured=options;return {mount(){}};}};
 w.eval(fs.readFileSync('public/js/vue-app.js','utf8'));w.eval(fs.readFileSync('public/vendor/vue.global.prod.js','utf8'));
 const start=captured.template.indexOf('<div class="round-course-summary">'),end=captured.template.indexOf('</aside>',start);assert.ok(start>=0&&end>start);
 const course={id:71,name:'合成课程',grouped:false,kp_done:1,kp_total:3,percent:33,acc:{rate:60,answered:3,total:5},lessons:[{video_id:1,done:true},{video_id:2,done:false},{video_id:3,done:false}],groups:[]};
 const app=w.Vue.createApp({data(){return {course};},computed:captured.computed,methods:captured.methods,template:captured.template.slice(start,end)}),state=app.mount('#app');await w.Vue.nextTick();
 t.after(()=>{app.unmount();w.close();assert.deepEqual(errors,[]);});
 return {d:w.document,state,tick:()=>w.Vue.nextTick()};
}
test('course summary retains completion percentage alongside learned count and whole-course accuracy',async t=>{
 const f=await fixture(t),summary=f.d.querySelector('.round-course-summary');
 assert.match(summary.textContent,/已学 1 \/ 3 课/);assert.match(summary.textContent,/课程正确率 60%/);assert.match(summary.textContent,/已做 3 \/ 5 题/);
 assert.match(f.d.querySelector('.round-course-progress')?.textContent||'',/课程完成\s*33%/);
});
test('course percentage distinguishes zero progress from absent or invalid totals',async t=>{
 const f=await fixture(t);
 for(const [done,total,want] of [[0,3,'0%'],[3,3,'100%'],[0,0,null],[undefined,3,null],[null,3,null],[1,undefined,null],[1,NaN,null],[1,-1,null]]){
  Object.assign(f.state.course,{kp_done:done,kp_total:total,percent:99});await f.tick();
  const text=f.d.querySelector('.round-course-progress')?.textContent||'';
  if(want)assert.match(text,new RegExp('课程完成\\s*'+want));else{assert.match(text,/暂无课程进度/);assert.doesNotMatch(text,/%/);}
 }
});
test('marking a lesson complete updates the rendered course percentage through real recount',async t=>{
 const f=await fixture(t);f.state.course.lessons[1].done=true;f.state.recount();await f.tick();
 assert.match(f.d.querySelector('.round-course-progress')?.textContent||'',/67%/);assert.match(f.d.querySelector('.round-course-summary').textContent,/已学 2 \/ 3 课/);
 f.state.course.grouped=true;f.state.course.groups=[{id:1,lessons:[{video_id:1,done:true}]},{id:2,lessons:[{video_id:2,done:false}]}];f.state.recount();await f.tick();
 assert.match(f.d.querySelector('.round-course-progress')?.textContent||'',/50%/);assert.match(f.d.querySelector('.round-course-summary').textContent,/已学 1 \/ 2 课/);
});
