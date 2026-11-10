'use strict';
// Execute production quiz request/lifecycle functions without external browser access.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'public/js/bank.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function ui(){
 const calls=[],sends=[],toasts=[],st={idx:0,answers:{1:'original',2:'A'},checked:{},busy:false,phase:'answer',startedAt:Date.now()},qs=[{id:1,type:'answer',quiz_ticket:'q1',options:[]},{id:2,type:'single',quiz_ticket:'q2',options:[]}];
 const mask={isConnected:true},buttons={};const $=s=>buttons[s]||(buttons[s]={disabled:false});
 const box={st,qs,mask,$,Date,quizAnswerText:(q,a)=>String(a||''),quizAnswerDisplay:(q,a)=>a,toast:m=>toasts.push(m),paint:()=>{},paintTimer:()=>{},stopTimer:()=>{},notifyDone:()=>{},lastSubmitted:null,isStep:true,
  api:(url,options)=>{const d=deferred();calls.push({url,options,...d});return d.promise;},opt:{submit:(answers)=>{const d=deferred();sends.push({answers,...d});return d.promise;}},elConfirm:async()=>true};
 const a=source.indexOf('    const checkOne = async'),b=source.indexOf('\n    paint();',a);
 vm.createContext(box);vm.runInContext(source.slice(a,b)+'\nthis.actions={checkOne,doSubmit};',box);
 return{...box,calls,sends,toasts,box};
}
const response={list:[{question_id:1,is_correct:false,ungraded:true,answer:'reference',self_grade_allowed:true,self_grade_ticket:'proof'}]};
test('check result stores self permission and proof only on the submitted question',async()=>{
 const f=ui();const pending=f.actions.checkOne();f.st.idx=1;f.calls[0].resolve(response);await pending;
 assert.equal(f.st.checked[0].selfAllowed,true);assert.equal(f.st.checked[0].selfTicket,'proof');assert.equal(f.st.checked[1],undefined);
});
test('changed answer invalidates a delayed check and releases the busy guard',async()=>{
 const f=ui();const pending=f.actions.checkOne();f.st.answers[1]='edited';f.calls[0].resolve(response);await pending;
 assert.equal(f.st.checked[0],undefined);assert.equal(f.st.busy,false);assert.match(f.toasts[0],/重新提交/);
});
test('final request persists explicit false and does not send self fields for objective questions',async()=>{
 const f=ui();f.st.checked={0:{selfAllowed:true,selfCorrect:false,selfTicket:'proof'},1:{ok:true}};
 const pending=f.actions.doSubmit();assert.equal(f.sends.length,1);assert.equal(f.sends[0].answers[0].self_correct,false);assert.equal(f.sends[0].answers[0].self_grade_ticket,'proof');assert.equal('self_correct' in f.sends[0].answers[1],false);
 f.sends[0].resolve({list:[]});await pending;await f.actions.doSubmit();assert.equal(f.sends.length,1,'report phase cannot resubmit');
});
test('concurrent final clicks during confirmation send one request and cancellation recovers',async()=>{
 const f=ui(),confirm=deferred();f.box.isStep=false;f.box.elConfirm=()=>confirm.promise;
 const one=f.actions.doSubmit(),two=f.actions.doSubmit();confirm.resolve(true);await tick();assert.equal(f.sends.length,1);f.sends[0].resolve({list:[]});await Promise.all([one,two]);assert.equal(f.st.busy,false);
});
test('closed and failed requests cannot recreate UI, and retry preserves the self choice',async()=>{
 const f=ui();const pending=f.actions.checkOne();f.mask.isConnected=false;f.calls[0].reject(Error('late'));await pending;assert.equal(f.toasts.length,0);assert.equal(f.st.busy,false);
 const g=ui();g.st.checked={0:{selfAllowed:true,selfCorrect:true,selfTicket:'proof'}};const first=g.actions.doSubmit();g.sends[0].reject(Error('retry'));await first;assert.equal(g.st.phase,'answer');assert.equal(g.st.checked[0].selfCorrect,true);const second=g.actions.doSubmit();assert.equal(g.sends.length,2);g.sends[1].resolve({list:[]});await second;
});
test('production self buttons preserve only the latest choice and ignore actions during submit/navigation',()=>{
 const st={phase:'answer',busy:false,idx:0,checked:{}},ck={selfAllowed:true,ungraded:true};st.checked[0]=ck;
 const buttons=[{dataset:{selfCorrect:'true'}},{dataset:{selfCorrect:'false'}}];let paints=0;
 const start=source.indexOf("      bodyEl.querySelectorAll('[data-self-correct]')"),end=source.indexOf("      bodyEl.querySelectorAll('[data-fb]')",start);
 vm.runInNewContext(source.slice(start,end),{st,ck,bodyEl:{querySelectorAll:()=>buttons},paint:()=>paints++});
 buttons[0].onclick();buttons[1].onclick();assert.equal(ck.selfCorrect,false);assert.equal(ck.ok,false);assert.equal(ck.ungraded,false);assert.equal(paints,2);
 st.busy=true;buttons[0].onclick();assert.equal(ck.selfCorrect,false);st.busy=false;st.idx=1;buttons[0].onclick();assert.equal(ck.selfCorrect,false);st.idx=0;buttons[0].onclick();assert.equal(ck.selfCorrect,true);
});
test('self-evaluated paper report labels personal accuracy and never fabricates a formal score',()=>{
 const a=source.indexOf('    const resultOne ='),b=source.indexOf('    const paintResult =',a);
 const q={id:1,type:'answer',subject:'数学',stem:'解答',point:'加法',options:[]};
 const box={qs:[q],st:{answers:{1:'独立解答'},startedAt:Date.now()},opt:{scoreTotal:100},window:{},esc:String,r8Ic:()=>'',r8Dur:()=>'',QT_NAME:{answer:'解答题'},quizAnswerDisplay:(q,x)=>x,quizAnswerText:(q,x)=>x,stemImagesHTML:()=>({stem:'解答',rest:''}),quizAudioHTML:()=>'',quizSolutionContent:(q,a)=>a};
 vm.createContext(box);vm.runInContext(source.slice(a,b)+'\nthis.render=reportHTML;',box);
 const html=box.render({total:1,correct:1,wrong:0,score:null,score_total:100,pending_manual_count:1,self_graded_count:1,ungraded_count:0,objective_score:0,objective_score_total:0,list:[{question_id:1,my_answer:'独立解答',is_correct:true,self_graded:true}]});
 assert.match(html,/自评正确/);assert.match(html,/待老师评分/);assert.match(html,/不代表老师评分/);assert.ok(!html.includes('100 / 100'));
});
test('canceling or closing the final confirmation releases the submit guard without writing',async()=>{
 for(const closed of [false,true]){const f=ui(),confirm=deferred();f.box.isStep=false;f.box.elConfirm=()=>confirm.promise;const pending=f.actions.doSubmit();if(closed)f.mask.isConnected=false;confirm.resolve(closed);await pending;assert.equal(f.st.busy,false);assert.equal(f.sends.length,0);}
});
