'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const escape=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
async function fixture(){
 const dom=new JSDOM('<main></main>',{url:'http://localhost/admin/#/xreport',runScripts:'outside-only'}),w=dom.window;
 const det={student:{id:1,name:'合成学生',username:'fixture'},subjects:[{subject:'数学',n:2,correct:1}],rows:[{question_id:7,type:'answer',subject:'数学',stem:'自评题',is_correct:1,self_correct:1},{question_id:8,type:'answer',subject:'数学',stem:'自评错题',is_correct:0,self_correct:0},{question_id:9,type:'single',subject:'数学',stem:'客观题',is_correct:1,self_correct:null}],subjective:[{id:10,question_id:7,stem:'自评题',my_answer:'过程',self_correct:1,score:null,max_score:60},{id:11,question_id:8,stem:'自评错题',my_answer:'过程',self_correct:0,score:45,max_score:60}],papers:[]};
 Object.assign(w,{Auth:{user:{role:'branch'},token:'synthetic'},SUBJECTS:['数学'],esc:escape,ic:()=>'',expTag:()=>'',api:async url=>url.includes('/detail')?det:url.includes('/accuracy')?{courses:[],acc:{total:2,answered:2,correct:1,rate:50}}:{list:[{id:1,name:'合成学生',answered:2,correct:1,rate:50}],subjects:[]}});
 w.eval(fs.readFileSync('public/admin/reportui.js','utf8'));await w.r1OpenDrawer(1);
 return {w,d:w.document,close:()=>w.close()};
}
test('teacher report clearly separates student self-assessment from objective and teacher results',async()=>{
 const f=await fixture();try{
  const rows=[...f.d.querySelectorAll('tr')];
  assert.match(rows.find(r=>r.textContent.includes('自评题')&&!r.querySelector('[data-subjective-grade]')).textContent,/学生自评正确/);
  assert.match(rows.find(r=>r.textContent.includes('自评错题')&&!r.querySelector('[data-subjective-grade]')).textContent,/学生自评错误/);
  assert.doesNotMatch(rows.find(r=>r.textContent.includes('客观题')).textContent,/学生自评/);
  const ungraded=f.d.querySelector('[data-subjective-grade="10"]').closest('tr');assert.match(ungraded.textContent,/未评分/);assert.match(ungraded.textContent,/学生自评正确/);
  const graded=f.d.querySelector('[data-subjective-grade="11"]').closest('tr');assert.match(graded.textContent,/45 \/ 60/);assert.match(graded.textContent,/学生自评错误/);
  assert.match(f.d.querySelector('.r1-body').textContent,/不代表老师评分/);assert.doesNotMatch(f.d.querySelector('.r1-body').textContent,/问答题不自动判分，不计入/);
 }finally{f.close();}
});
test('exercise summary does not call student self-assessment already teacher-scored',async()=>{
 const f=await fixture();try{const page=await f.w.viewEReport();const wrap=f.d.createElement('div');wrap.innerHTML=page.html;assert.match(wrap.textContent,/学生自评/);assert.doesNotMatch(wrap.textContent,/已评分的有效作答/);}finally{f.close();}
});
