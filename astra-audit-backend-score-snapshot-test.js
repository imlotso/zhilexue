'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Reuse the existing isolated real-submit fixture, without running its tests or app bootstrap.
const fixtureSource=fs.readFileSync(path.join(__dirname,'student-self-grade-test.js'),'utf8');
const scope={require,__dirname,Buffer,console};
vm.runInNewContext(fixtureSource.slice(0,fixtureSource.indexOf("test('submitted constructed response"))+'\nthis.fixture=fixture;',scope);
for(const kind of ['paper','mfpaper'])test(kind+' partial answer snapshots the full original 100, not only answered 50',t=>{
 const f=scope.fixture(t);const table=kind==='paper'?'paper_tries':'mf_paper_tries';
 f.raw.exec("UPDATE questions SET type='single',answer='A' WHERE id=1; UPDATE papers SET question_scores='{\"1\":50,\"2\":50}'; UPDATE mf_paper_questions SET score=50;");
 const r=f.call('/submit',{kind,paper_id:1,answers:[f.answer(2,'A')]}).body;assert.equal(r.code,0);assert.equal(r.data.score,50);
 let attempt=f.raw.prepare('SELECT * FROM '+table).get();assert.equal(attempt.total_score_snapshot,100);
 f.raw.exec("UPDATE papers SET total_score=50; UPDATE mf_paper_questions SET score=25");
 attempt=f.raw.prepare('SELECT * FROM '+table).get();assert.equal(attempt.total_score_snapshot,100);assert.equal(attempt.score,50);
});
for(const kind of ['paper','mfpaper'])test(kind+' teacher grading changes earned score but never full-score snapshot',t=>{
 const f=scope.fixture(t);const table=kind==='paper'?'paper_tries':'mf_paper_tries';
 const r=f.call('/submit',{kind,paper_id:1,answers:[f.self(false),f.answer(2,'A')]}).body;assert.equal(r.code,0);
 assert.equal(f.raw.prepare('SELECT total_score_snapshot FROM '+table).get().total_score_snapshot,100);
 const response=f.raw.prepare('SELECT id FROM subjective_responses').get();const graded=f.call('admin/subjective/:id/grade',{score:45},10,{id:response.id}).body;assert.equal(graded.code,0);
 const row=f.raw.prepare('SELECT * FROM '+table).get();assert.equal(row.score,85);assert.equal(row.total_score_snapshot,100);
});
const {JSDOM}=require('jsdom');
async function render(paper){const dom=new JSDOM('<main></main>',{url:'http://localhost/admin/#/xreport',runScripts:'outside-only'}),w=dom.window;
 const det={student:{id:1,name:'Synthetic'},subjects:[],rows:[],subjective:[],papers:[paper]};
 Object.assign(w,{Auth:{user:{role:'branch'},token:'synthetic'},SUBJECTS:['数学'],esc:v=>String(v??''),ic:()=>'',expTag:()=>'',api:async url=>url.includes('/detail')?det:{courses:[],acc:{total:0,answered:0,correct:0,rate:null}}});
 w.eval(fs.readFileSync(path.join(__dirname,'public/admin/reportui.js'),'utf8'));await w.r1OpenDrawer(1);return {dom,row:[...w.document.querySelectorAll('tr')].find(r=>r.textContent.includes('Synthetic paper'))};}
test('old unknown full score displays an explanation and no invented percentage',async()=>{const f=await render({title:'Synthetic paper',score:50,total:1,correct:1,total_score:null});try{assert.match(f.row.textContent,/满分未记录/);assert.doesNotMatch(f.row.textContent,/%/);assert.match(f.row.textContent,/50/);}finally{f.dom.window.close();}});
test('partial 50 out of a trusted 100 snapshot renders as 50 percent',async()=>{const f=await render({title:'Synthetic paper',score:50,total:1,correct:1,total_score:100});try{assert.match(f.row.textContent,/50\s*\/\s*100/);assert.match(f.row.textContent,/50%/);}finally{f.dom.window.close();}});
