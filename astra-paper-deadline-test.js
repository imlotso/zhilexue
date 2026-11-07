'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'public/js/bank.js'),'utf8');
const NOW=Date.parse('2026-11-07T12:00:00Z');
class FixedDate extends Date { constructor(...a){super(...(a.length?a:[NOW]));} static now(){return NOW;} }
function fixture(due_at){
 const paper={id:7,title:'截止时间测试',subject:'数学',q_count:1,total_score:10,duration:30,questions:[{id:1,stem:'题干'}],due_at};
 let quiz;const calls=[],messages=[],nodes={};const host={isConnected:true,ownerDocument:{activeElement:null},innerHTML:'',querySelector(s){return s==='#pkQ'&&!this.innerHTML.includes('id="pkQ"')?null:nodes[s]||(nodes[s]={value:''});},querySelectorAll(){return [];}};
 const box={Date:FixedDate,window:{},esc:v=>String(v??'').replace(/</g,'&lt;').replace(/"/g,'&quot;'),location:{hash:'#/papers'},URLSearchParams,
 toast:m=>messages.push(m),api:async(url,options)=>{calls.push({url,options});if(url==='/api/stu/bank/tasks')return[paper];if(url==='/api/stu/bank/papers/7')return paper;if(url.includes('/filters'))return{};if(url.includes('/subjective-responses'))return{list:[]};return[];}};
 vm.runInNewContext(source,box);box.window.BankQuiz.open=o=>{quiz=o;};return {box,paper,host,messages,calls,quiz:()=>quiz,open:()=>box.window.BankPages.openPaper(7),list:()=>box.window.BankPages.papers(host,'数学')};
}
test('task card shows future deadline and timezone',async()=>{const f=fixture('2026-11-08T12:00:00Z');await f.list();assert.match(f.host.innerHTML,/截止/);assert.match(f.host.innerHTML,/2026/);assert.match(f.host.innerHTML,/本地时间/);assert.doesNotMatch(f.host.innerHTML,/已截止/);});
test('expired task is explicitly labeled without hiding it',async()=>{const f=fixture('2026-11-06T12:00:00Z');await f.list();assert.match(f.host.innerHTML,/已截止/);assert.match(f.host.innerHTML,/data-task="7"/);});
test('quiz subtitle preserves duration and shows deadline',async()=>{const f=fixture('2026-11-08T12:00:00Z');await f.open();assert.match(f.quiz().subtitle,/30 分钟/);assert.match(f.quiz().subtitle,/截止/);});
test('expired paper warns before answering but preserves server authority',async()=>{const f=fixture('2026-11-06T12:00:00Z');await f.open();assert.match(f.messages.join(''),/已截止/);assert.ok(f.quiz());await f.quiz().submit([{question_id:1,my_answer:'A'}],12);assert.equal(f.calls.at(-1).options.body.kind,'paper');assert.equal(f.calls.at(-1).options.body.paper_id,7);});
for(const due of ['',null,undefined])test('no deadline keeps ordinary task behavior '+due,async()=>{const f=fixture(due);await f.list();assert.doesNotMatch(f.host.innerHTML,/已截止|本地时间|时间异常/);await f.open();assert.equal(f.messages.length,0);assert.ok(f.quiz());});
test('invalid stored deadline is visible instead of invented',async()=>{const f=fixture('not-a-date<script>');await f.list();assert.match(f.host.innerHTML,/截止时间异常/);assert.doesNotMatch(f.host.innerHTML,/<script>/);});
test('exact deadline instant matches server strict greater-than boundary',async()=>{const f=fixture('2026-11-07T12:00:00Z');await f.list();assert.doesNotMatch(f.host.innerHTML,/已截止/);await f.open();assert.equal(f.messages.length,0);});
test('reopening after deadline recalculates current status',async()=>{const f=fixture('2026-11-08T12:00:00Z');await f.open();f.paper.due_at='2026-11-06T12:00:00Z';await f.open();assert.match(f.quiz().subtitle,/已截止/);});
test('deadline is also in question-body notice because mobile hides subtitle',async()=>{const f=fixture('2026-11-08T12:00:00Z');await f.open();assert.match(f.quiz().notice||'',/截止/);assert.match(f.quiz().notice||'',/本地时间/);});
