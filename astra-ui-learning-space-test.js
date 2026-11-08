'use strict';
// Isolated synthetic boundaries execute actual production Vue options, never a service/database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(api=async()=>[]) {
  let app;
  const Auth={token:'synthetic-session',user:{id:71,role:'student',grade:'三年级'},clear(){this.token='';this.user=null;}};
  const localStorage={getItem(){return null;},setItem(){}};
  const context={Auth,localStorage,location:{hash:'#/home'},window:{},document:{},api,canPreview(){},fileKind(){},fmtSize(){},Vue:{createApp(a){app=a;return{mount(){}};}}};
  vm.runInNewContext(fs.readFileSync('public/js/vue-app.js','utf8'),context);
  const state=app.data();Object.assign(state,app.methods);for(const [k,get] of Object.entries(app.computed)) Object.defineProperty(state,k,{get:()=>get.call(state)});
  state.page='home';state.$nextTick=fn=>Promise.resolve().then(fn);
  return {app,state,context,Auth};
}
const course={id:12,name:'合成学习课程',subject:'数学',category:'同步基础',grade:'三年级',book:'苏教版',kp_total:7,kp_done:2,percent:29,acc:{total:8,answered:4,correct:3,rate:75}};
test('new home is separate from all existing course, training, paper and mistake routes',()=>{
  const f=fixture();f.state.syncRoute();assert.equal(f.state.page,'home');
  for(const [hash,page] of [['#/courses','courses'],['#/course/12','course'],['#/words/quick','words'],['#/papers','papers'],['#/mistakes','mistakes'],['#/timer','tool']]){f.context.location.hash=hash;f.state.syncRoute();assert.equal(f.state.page,page);}
});
test('home loads real course statistics and tasks, and selects an unfinished course',async()=>{
  const calls=[];const f=fixture(async url=>{calls.push(url);if(url==='/api/stu/courses')return [{...course,id:1,kp_done:7},course];if(url==='/api/stu/bank/tasks')return [{id:9,title:'真实接口任务',q_count:13,tried:0}];if(url==='/api/stu/course-detail?id=12')return {...course,next:{title:'下一节课'}};throw Error(url);});
  await f.state.loadHome();assert.equal(f.state.homeCourse.id,12);assert.equal(f.state.homeCourse.kp_total,7);assert.equal(f.state.homeCourse.acc.rate,75);assert.equal(f.state.homeTasks[0].q_count,13);assert.equal(f.state.homeDetail.next.title,'下一节课');assert.equal(calls.length,3);
});
test('empty data and request failures clear previous course/task values without sample stats',async()=>{
  let fail=false;const f=fixture(async url=>{if(fail)throw Error('synthetic offline');return url.includes('detail')?course:url.includes('/courses')?[course]:[{id:9}];});
  await f.state.loadHome();fail=true;await f.state.loadHome();assert.equal(f.state.homeCourse,null);assert.equal(f.state.homeTasks.length,0);assert.match(f.state.homeCourseError,/offline/);assert.match(f.state.homeTaskError,/offline/);
  const e=fixture();await e.state.loadHome();assert.equal(e.state.homeCourse,null);assert.equal(e.state.homeTasks.length,0);
});
test('late home responses cannot repopulate state after account changes or leaving home',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);const f=fixture(()=>pending);const run=f.state.loadHome();f.Auth.token='another-account';f.Auth.user={id:72};f.state.resetLearningHome();resolve([course]);await run;assert.equal(f.state.homeCourse,null);assert.equal(f.state.homeTasks.length,0);
  let done;const later=new Promise(r=>{done=r;});const g=fixture(()=>later);const second=g.state.loadHome();g.state.page='papers';done([course]);await second;assert.equal(g.state.homeCourse,null);assert.equal(g.state.homeTasks.length,0);
});
test('home actions delegate to existing real paper and scan flows',async()=>{
  const calls=[];const f=fixture();f.context.window.BankPages={openPaper(id,cb){calls.push(['paper',id]);},scanFlow(){}};f.context.BankPages=f.context.window.BankPages;
  f.state.homeTasks=[{id:9}];f.state.openHomeTask({id:9});assert.equal(calls[0][1],9);
  f.state.homeCourses=[course];f.state.goSelfPractice('knowledge');assert.equal(f.context.location.hash,'#/papers');assert.equal(f.state.pendingSelfPractice,'knowledge');assert.equal(f.state.subject,'数学');
});
test('layout includes real hero, task empty state, local icons and semantic navigation',()=>{
  const f=fixture();assert.match(f.app.template,/class="learn-home"/);assert.match(f.app.template,/homeCourse\.kp_done/);assert.match(f.app.template,/homeTasks/);assert.match(f.app.template,/暂无学习任务/);assert.match(f.app.template,/href="#\/home"/);assert.match(fs.readFileSync('public/index.html','utf8'),/ui-learning-20261108\.css/);
});
test('more home tasks opens their actual subject instead of the default English filter',()=>{
  const f=fixture();f.state.subject='英语';f.state.homeTasks=[{id:1,subject:'数学'},{id:2,subject:'数学'},{id:3,subject:'数学'},{id:4,subject:'数学'}];
  assert.equal(typeof f.state.goHomeTasks,'function');f.state.goHomeTasks();assert.equal(f.state.subject,'数学');assert.equal(f.context.location.hash,'#/papers');assert.equal(f.state.homeTasks.length,4);
});
