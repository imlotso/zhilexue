'use strict';
// 合成数据、隔离数据库；覆盖无标准答案的连线/匹配题完整工作流。
const assert=require('assert');
const XLSX=require('xlsx');
const {Document,Paragraph,Packer}=require('docx');
const {db}=require('./src/db');
const BASE=process.env.BASE||'http://localhost:3000';
const MF='/api/admin/bank/mf';
const made={runs:[],questions:[],papers:[]};
async function call(path,token,body,method='POST',form=false){const headers={};if(token)headers.Authorization='Bearer '+token;if(body&&!form)headers['Content-Type']='application/json';const r=await fetch(BASE+path,{method,headers,body:body?(form?body:JSON.stringify(body)):undefined});return r.json();}
async function ok(path,token,body,method,form){const j=await call(path,token,body,method,form);if(j.code)throw Error(path+': '+j.msg);return j.data;}
function upload(name,buf){const fd=new FormData();fd.append('file',new Blob([buf]),name);fd.append('subject','数学');fd.append('stage','junior');return fd;}
(async()=>{
 const admin=(await ok('/api/login','',{username:'15152099970',password:'123456',role:'admin'})).token;
 const stu=(await ok('/api/login','',{username:'13800000001',password:'123456',role:'student'})).token;
 const uid=db.prepare('SELECT id FROM users WHERE username=?').get('13800000001').id;
 const shape={subject:'数学',stage:'junior',type:'sort',question_subtype:'math_match',stem:'无答案多对一连线',match_prompts:['甲','乙','丙','丁'],options:['一','二'],answer:''};
 const badLeft=await call(MF+'/ext/pending/manual',admin,{...shape,match_prompts:['甲','', '乙']}); assert.notStrictEqual(badLeft.code,0,'不能丢失空左项');
 const badRight=await call(MF+'/ext/pending/manual',admin,{...shape,options:['一','','二']}); assert.notStrictEqual(badRight.code,0,'不能丢失空右项');
 const badAnswer=await call(MF+'/ext/pending/manual',admin,{...shape,answer:'1,2,1,3'}); assert.notStrictEqual(badAnswer.code,0,'有答案时不能越界');
 const manual=await ok(MF+'/ext/pending/manual',admin,shape);made.runs.push(manual.id);
 const listen=await ok(MF+'/ext/pending/manual',admin,{...shape,subject:'英语',question_subtype:'listen_match',stem:'无答案听力匹配',match_prompts:['甲','乙'],options:['一','二']});made.runs.push(listen.id);
 const listenBad=await call(MF+'/ext/pending/manual',admin,{...shape,subject:'英语',question_subtype:'listen_match',match_prompts:['甲','乙'],options:['一','二'],answer:'1,1'});assert.notStrictEqual(listenBad.code,0,'听力匹配仍禁止重复使用右项');
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['题目','选项A','选项B','答案','数学细分题型（选填）','匹配左侧项目（每行一项）'],['Excel无答案连线','一','二','','连线','甲\n乙\n丙\n丁']]),'排序题');
 const excel=await ok(MF+'/ext/import-excel',admin,upload('测试.xlsx',XLSX.write(wb,{type:'buffer',bookType:'xlsx'})),'POST',true); made.runs.push(excel.run_id);assert.strictEqual(excel.total,1);
 const doc=new Document({sections:[{children:['连线题','1. Word无答案连线','匹配项：甲','匹配项：乙','匹配项：丙','匹配项：丁','A. 一','B. 二'].map(text=>new Paragraph(text))}]});
 const word=await ok(MF+'/ext/import-word',admin,upload('测试.docx',await Packer.toBuffer(doc)),'POST',true); made.runs.push(word.run_id);assert.strictEqual(word.total,1);assert.strictEqual(word.error_count,0);
 for(const runId of made.runs){
  const item='run:'+runId+':0';
  const committed=await ok(MF+'/ext/pending/commit',admin,{ids:[item]});
  assert.strictEqual(committed.committed,1,`${runId}: ${JSON.stringify(committed.failed)}`);
  const id=committed.question_ids[0];made.questions.push(id);
  let q=(await ok(MF+'/questions/'+id,admin,null,'GET')).question;
  const isListen=runId===listen.id;assert.strictEqual(q.answer,'');assert.strictEqual(q.question_subtype,isListen?'listen_match':'math_match');assert.strictEqual(q.match_prompts.length,isListen?2:4);assert.strictEqual(q.options.length,2);
  await ok(MF+'/questions/'+id,admin,{...q,answer:''},'PUT');
  const invalid=await call(MF+'/questions/'+id,admin,{...q,answer:'1,2,1,3'},'PUT');assert.notStrictEqual(invalid.code,0,'题库编辑仍拒绝无效匹配答案');
  q=(await ok(MF+'/questions/'+id,admin,null,'GET')).question;assert.strictEqual(q.answer,'');
 }
 const qid=made.questions[0];
 const paper=(await ok('/api/admin/bank/papers',admin,{title:'无答案连线合成卷',subject:'数学',stage:'junior',q_ids:[qid],question_scores:{[qid]:4},status:'published'})).id;made.papers.push(paper);
 const sq=(await ok('/api/stu/bank/papers/'+paper,stu,null,'GET')).questions[0];
 const checked=await ok('/api/stu/bank/check',stu,{items:[{question_id:qid,quiz_ticket:sq.quiz_ticket,my_answer:'1,0,1,0'}]});assert.strictEqual(checked.list[0].ungraded,true);
 const result=await ok('/api/stu/bank/submit',stu,{kind:'paper',paper_id:paper,answers:[{question_id:qid,my_answer:'1,0,1,0'}]});
 assert.strictEqual(result.score,null);assert.strictEqual(result.ungraded_count,1);assert.strictEqual(result.wrong,0);assert.strictEqual(result.list[0].ungraded,true);
 assert(!db.prepare('SELECT id FROM records WHERE user_id=? AND question_id=?').get(uid,qid));assert(!db.prepare('SELECT id FROM mistakes WHERE user_id=? AND question_id=?').get(uid,qid));
 const response=db.prepare("SELECT id FROM subjective_responses WHERE user_id=? AND paper_id=? AND kind='paper' ORDER BY id DESC LIMIT 1").get(uid,paper);
 assert.strictEqual((await ok('/api/admin/xreport/subjective/'+response.id+'/grade',admin,{score:2.5})).final_score,2.5);
 const lqid=made.questions[1];
 const lp=(await ok('/api/admin/bank/papers',admin,{title:'无答案听力匹配合成卷',subject:'英语',stage:'junior',q_ids:[lqid],question_scores:{[lqid]:2},status:'published'})).id;made.papers.push(lp);
 const lq=(await ok('/api/stu/bank/papers/'+lp,stu,null,'GET')).questions[0];
 const lc=await ok('/api/stu/bank/check',stu,{items:[{question_id:lqid,quiz_ticket:lq.quiz_ticket,my_answer:'1,2'}]});assert.strictEqual(lc.list[0].ungraded,true);
 const lr=await ok('/api/stu/bank/submit',stu,{kind:'paper',paper_id:lp,answers:[{question_id:lqid,my_answer:'1,2'}]});assert.strictEqual(lr.score,null);assert.strictEqual(lr.ungraded_count,1);assert.strictEqual(lr.wrong,0);
 assert(!db.prepare('SELECT id FROM records WHERE user_id=? AND question_id=?').get(uid,lqid));assert(!db.prepare('SELECT id FROM mistakes WHERE user_id=? AND question_id=?').get(uid,lqid));
 console.log('无答案连线：手工、Excel、Word 入库和编辑；未评分、错题隔离、老师评分通过');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 for(const id of made.questions){for(const t of ['subjective_responses','records','mistakes'])db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id);db.prepare('DELETE FROM questions WHERE id=?').run(id);}
 for(const id of made.papers){db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(id);db.prepare('DELETE FROM papers WHERE id=?').run(id);}
 for(const id of made.runs)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);
});
