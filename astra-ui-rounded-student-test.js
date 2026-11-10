'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
 let app;
 const context={Auth:{token:'synthetic',user:{id:1,grade:'七年级',role:'student'}},localStorage:{getItem(){return null;}},location:{hash:'#/home'},window:{},document:{},canPreview(){},fileKind(){},fmtSize(){},Vue:{createApp(a){app=a;return{mount(){}};}}};
 vm.runInNewContext(fs.readFileSync('public/js/vue-app.js','utf8'),context);
 const state=Object.assign(app.data(),app.methods);
 for(const [k,get]of Object.entries(app.computed))Object.defineProperty(state,k,{get:()=>get.call(state)});
 return{app,state,context};
}
test('learning paths are derived from actual grouped or ungrouped lessons',()=>{
 const {state}=fixture();state.homeDetail={grouped:true,groups:[{lessons:[{video_id:4,title:'实际课程',done:true}]},{lessons:[{video_id:5,title:'下一讲',done:false}]}]};
 assert.equal(state.homeLessons.length,2);assert.equal(state.homeLessons[1].video_id,5);
 state.homeDetail={grouped:false,lessons:[]};assert.equal(state.homeLessons.length,0);
});
test('course preview selects the current actual lesson and preserves its action data',()=>{
 const {state}=fixture();state.course={grouped:true,next:{video_id:22},groups:[{id:9,name:'实际分组',lessons:[{video_id:21,title:'第一讲',qcount:3},{video_id:22,title:'第二讲',qcount:0}]}]};
 assert.equal(state.focusLesson.video_id,22);state.selectLesson(state.course.groups[0].lessons[0],9);
 assert.equal(state.activeGroupId,9);assert.equal(state.focusLesson.video_id,21);assert.equal(state.focusLesson.qcount,3);
 state.course={grouped:false,lessons:[]};assert.equal(state.focusLesson,null);
});
test('rounded navigation retains training, timer, subjects, papers and mistakes',()=>{
 const {app}=fixture();for(const href of ['#/home','#/courses','#/papers','#/mistakes','#/words/quick','#/timer'])assert.ok(app.template.includes(href),href);
 assert.match(app.template,/round-bottom-nav/);assert.match(app.template,/round-course-layout/);assert.match(app.template,/learn-path/);
 assert.match(fs.readFileSync('public/index.html','utf8'),/ui-rounded-student-20261108.css/);
});
