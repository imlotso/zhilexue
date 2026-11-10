'use strict';
// Synthetic local integration only. No external service, real question, or production database.
const path=require('path'),assert=require('assert/strict');
const root=path.resolve(process.argv[2]||process.cwd()),r=require('module').createRequire(root+'/package.json');
r('./test/isolated-accounts').assertIsolated();
const {db}=r('./src/db'),base=process.env.BASE,MF='/api/admin/bank/mf';
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base));
const info=r('./src/db-connection').DB_INFO;
assert(/(^|_)test(_|$)/i.test(info.database),'A disposable test-named database is required even in CI');
assert.equal(process.env.AI_MOCK,'1');assert.equal(process.env.TTS_MOCK,'1');
assert.equal(process.env.ZLX_AUDIT_ALLOW_SYNTHETIC_HTTP,'1','Explicit audit-only local HTTP opt-in required');
const made={runs:[],batches:[],questions:[]};let accounts;
const failures=[];
function verify(actual,expected,label){try{assert.deepEqual(actual,expected);console.log('PASS',label);}catch(e){failures.push(label+': '+e.message);console.error('FAIL',label);}}
async function call(url,token,body,method){const res=await fetch(base+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await res.json();assert.equal(j.code,0,j.msg);return j.data;}
(async()=>{try{
 accounts=r('./test/isolated-accounts').create(db);
 const admin=(await call('/api/login',null,{username:accounts.admin.username,password:accounts.admin.password,role:'admin'})).token;
 const student=(await call('/api/login',null,{username:accounts.student.username,password:accounts.student.password,role:'student'})).token;
 const list=async()=> (await call(MF+'/ext/pending?size=100',admin)).list;
 const input='若 1 < x < 3 且 y > 0，求 x+y。';
 const manual=await call(MF+'/ext/pending/manual',admin,{stem:input,type:'answer',subject:'数学',stage:'junior',grade:'七年级',answer:'合成答案',analysis:'隔离复现',options:[]});made.runs.push(manual.id);
 let item=(await list()).find(x=>x.kind==='run'&&x.batch_id===manual.id);assert(item);
 let committed=await call(MF+'/ext/pending/commit',admin,{ids:[item.id],items:[{id:item.id,expected:item.edit_signature}],detailed:true});assert.equal(committed.committed,1);made.questions.push(...committed.question_ids);
 const saved=(await call(MF+'/questions/'+committed.question_ids[0],admin)).question;
 console.log('LIVE I1',JSON.stringify({input,stored_stem:saved.stem,stored_html:saved.stem_html}));verify(saved.stem,input,'I1 plain inequality retained');
 const cap=await call(MF+'/capture/batches',admin,{title:'合成选项错位复现',subject:'数学',stage:'junior',grade:'七年级',questions:[{stem:'合成题：选择正确文字',type:'single',options:['错误项','将清空项','正确项'],answer:'C',analysis:'第三项为正确答案'}]});made.batches.push(cap.id);
 item=(await list()).find(x=>x.kind==='cap'&&x.batch_id===cap.id);assert(item);
 await call(MF+'/ext/pending/item',admin,{id:item.id,patch:{options:[{label:'A',text:'错误项'},{label:'C',text:'正确项'}],answer:'C'}},'PUT');
 item=(await list()).find(x=>x.kind==='cap'&&x.batch_id===cap.id);assert.equal(item.options[1].label,'B');verify(item.answer,'B','I2 answer follows renumbered correct option');
 committed=await call(MF+'/ext/pending/commit',admin,{ids:[item.id],items:[{id:item.id,expected:item.edit_signature}],detailed:true});assert.equal(committed.committed,1);made.questions.push(...committed.question_ids);
 const qid=committed.question_ids[0],sid=accounts.student.id;
 db.prepare("INSERT INTO mistakes(user_id,question_id,wrong_count,last_answer,resolved,updated_at) VALUES (?,?,1,'A',0,'2026-11-10 00:00:00')").run(sid,qid);
 const shown=(await call('/api/stu/bank/mistakes',student)).list.find(q=>Number(q.question_id)===Number(qid));assert(shown&&shown.quiz_ticket);
 const verdict=(await call('/api/stu/bank/check',student,{items:[{question_id:qid,my_answer:'B',quiz_ticket:shown.quiz_ticket}]})).list[0];
 console.log('LIVE I2',JSON.stringify({displayed_options:item.options,stored_answer:item.answer,student_selected:'B',is_correct:verdict.is_correct}));verify(verdict.is_correct,true,'I2 displayed correct option receives credit');
 assert.equal(failures.length,0,failures.join('\n'));
 console.log('Both P1 data-integrity regressions pass through actual local HTTP application and database.');
}finally{
 for(const id of made.questions){for(const table of ['mistakes','records','question_nodes','question_tags','mf_paper_questions'])db.prepare(`DELETE FROM ${table} WHERE question_id=?`).run(id);db.prepare('DELETE FROM questions WHERE id=?').run(id);}
 for(const id of made.runs)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);
 for(const id of made.batches)db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id);
 if(accounts)accounts.dispose();
 console.log('Only synthetic test records and temporary accounts cleaned up.');
}})().catch(e=>{console.error(e);process.exitCode=1;});
