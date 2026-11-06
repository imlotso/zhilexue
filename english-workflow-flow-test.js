'use strict';
// 只在隔离测试库中运行，合成英语题贯通 JSON/Word/Excel→待审核→入库→取题→核对→交卷。
const assert=require('assert'),XLSX=require('xlsx');
const {Document,Paragraph,Packer}=require('docx');
const Q=require('./public/js/question-subtypes');
const {db}=require('./src/db');
const base=process.env.BASE||'http://localhost:3000',mf='/api/admin/bank/mf';
const made={runs:[],questions:[],papers:[]};
async function call(path,token,body,method){const form=body instanceof FormData;const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(!form&&body?{'Content-Type':'application/json'}:{})},body:body?form?body:JSON.stringify(body):undefined});return r.json()}
async function ok(path,token,body,method){const r=await call(path,token,body,method);assert.equal(r.code,0,path+': '+r.msg);return r.data}
const file=(buf,name)=>{const f=new FormData();f.append('file',new Blob([buf]),name);return f};
(async()=>{
 const at=(await ok('/api/login','',{username:'15152099970',password:'123456',role:'admin'})).token;
 const st=(await ok('/api/login','',{username:'13800000001',password:'123456',role:'student'})).token;
 const templateResponse=await fetch(base+mf+'/ext/import-template?english_subtypes=1',{headers:{Authorization:'Bearer '+at}});assert(templateResponse.ok);const template=XLSX.read(Buffer.from(await templateResponse.arrayBuffer()));assert(template.SheetNames.includes('问答题'));assert.equal(XLSX.utils.sheet_to_json(template.Sheets['英语题型说明']).length,23);
 const qs=Q.list.filter(x=>Q.matchesSubject(x,'英语')).map((s,i)=>({id:'english-'+i,subject:'英语',stage:'junior',type:s.type,question_subtype:s.code,stem:'合成英语 '+s.label,options:['single','sort'].includes(s.type)?['first','second']:[],match_prompts:Q.isMatch(s.code)?['Tom','Ann']:[],answer:s.type==='single'?'A':s.type==='judge'?'正确':s.type==='fill'?'hello|||hi':s.type==='sort'?'2,1':'',analysis:''}));
 qs.push({id:'open-task',subject:'英语',stage:'junior',type:'answer',subtype:'task_reading',stem:'开放任务型阅读',answer:''},{id:'open-dialogue',subject:'英语',stage:'junior',type:'answer',subtype:'dialogue',stem:'开放对话',answer:''});
 const imp=await ok(mf+'/import-pack',at,file(JSON.stringify({questions:qs}),'english-synthetic.json'));made.runs.push(imp.run_id);assert.equal(imp.failed,0);assert.equal(imp.staged,qs.length);
 const word=await Packer.toBuffer(new Document({sections:[{children:['听力排序题','1. Listen and sort.','A. first','B. second','答案：B,A','阅读还原题','[材料]','Shared reading passage.','[材料结束]','1. Choose a sentence.','A. first','B. second','答案：A','2. Choose again.','A. first','B. second','答案：B'].map(x=>new Paragraph(x))}]}));
 const wf=file(word,'english-synthetic.docx');wf.append('subject','英语');wf.append('stage','junior');const wi=await ok(mf+'/ext/import-word',at,wf);made.runs.push(wi.run_id);assert.equal(wi.total,3);assert.equal(wi.error_count,0);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{'题目':'补全对话 ____','第1空答案':'hello|||hi','英语细分题型':'补全对话'}]),'填空题');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{'题目':'开放阅读问答','参考答案':'','英语细分题型':'任务型阅读'}]),'问答题');const ef=file(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'english-synthetic.xlsx');ef.append('subject','英语');ef.append('stage','junior');const ei=await ok(mf+'/ext/import-excel',at,ef);made.runs.push(ei.run_id);assert.equal(ei.total,2);
 for(const run of made.runs){const pending=await ok(mf+`/ext/pending?source=all&batch_id=${run}&size=100`,at);const ids=pending.list.filter(x=>x.batch_id===run).map(x=>x.id);assert(ids.length);const c=await ok(mf+'/ext/pending/commit',at,{ids,subject:'英语',stage:'junior'});made.questions.push(...c.question_ids);assert.equal(c.failed.length,0,JSON.stringify(c.failed))}
 const paper=db.prepare("INSERT INTO papers (title,subject,status,q_ids,created_at) VALUES ('合成英语流程','英语','published',?,'2026-11-06')").run(JSON.stringify(made.questions)).lastInsertRowid;made.papers.push(paper);
 const data=await ok('/api/stu/bank/papers/'+paper,st);
 const list=data.questions||[];
 const items=[];
 for(const id of made.questions){const q=list.find(x=>x.id===id);assert(q,'取题 '+id);
  const raw=db.prepare('SELECT * FROM questions WHERE id=?').get(id);assert.equal(q.question_subtype,raw.question_subtype);
  assert.equal(q.answer,undefined,'取题不能提前泄露答案');const my=raw.type==='fill'?'hi':raw.answer||'my essay';
  const result=(await ok('/api/stu/bank/check',st,{items:[{question_id:id,quiz_ticket:q.quiz_ticket,my_answer:my}]})).list[0];
  if(raw.type==='answer') assert(result.ungraded);else assert.equal(result.is_correct,1,JSON.stringify({subtype:raw.question_subtype,type:raw.type,answer:raw.answer,my,result}));
  items.push({question_id:id,quiz_ticket:q.quiz_ticket,my_answer:my});
 }
 const submitted=await ok('/api/stu/bank/submit',st,{kind:'paper',paper_id:paper,answers:items});
 const responses=db.prepare('SELECT id,max_score FROM subjective_responses WHERE paper_id=?').all(paper);assert(responses.length>=3);
 for(const response of responses){await ok('/api/admin/xreport/subjective/'+response.id+'/grade',at,{score:response.max_score,comment:'合成测试人工评分'});}
 assert.notEqual(db.prepare('SELECT score FROM paper_tries WHERE paper_id=?').get(paper).score,null,'人工评分后回写试卷总分');
 const shared=made.questions.map(id=>db.prepare('SELECT material,source_detail FROM questions WHERE id=?').get(id)).filter(q=>q.material==='Shared reading passage.');assert.equal(shared.length,2);assert.equal(JSON.parse(shared[0].source_detail).question_group.ref,JSON.parse(shared[1].source_detail).question_group.ref);
 // JSON 共用音频只用现有 bank/audio key，不下载文件、生成语音或请求 AI。
 const audio=await ok(mf+'/import-pack',at,file(JSON.stringify({questions:[{subject:'英语',stage:'junior',material:'共同听力材料',audio_key:'bank/audio/synthetic.wav',audio_play_limit:2,children:[{stem:'Listen 1',type:'single',subtype:'listen_choice',options:['a','b']},{stem:'Listen 2',type:'fill',subtype:'listen_fill'}]}]}),'audio-synthetic.json'));made.runs.push(audio.run_id);assert.equal(audio.failed,0);const saved=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(audio.run_id).drafts);assert(saved.every(q=>q.audio_key==='bank/audio/synthetic.wav'&&q.audio_play_limit===2&&q.answer===''));
 const bad=await ok(mf+'/import-pack',at,file(JSON.stringify({questions:[{stem:'非法音频',type:'fill',audio_key:'videos/file.mp4'},{stem:'非法次数',type:'fill',audio_play_limit:6},{stem:'未知细分',type:'fill',subtype:'not-a-subtype'}]}),'invalid-english.json'));assert.equal(bad.failed,3);assert.equal(bad.staged,0);
 console.log(`英语 23 种细分题型及开放题变体（JSON ${qs.length} 题）、Word 排序/材料及 Excel 对话贯通审核入库、学生取题核对和交卷、人工评分回写；共用音频与空答案保留通过`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 for(const id of made.questions){for(const table of ['mistakes','records','subjective_responses','question_tags','question_nodes']){try{db.prepare(`DELETE FROM ${table} WHERE question_id=?`).run(id)}catch{}}try{db.prepare('DELETE FROM questions WHERE id=?').run(id)}catch{}}
 for(const id of made.papers){db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(id);db.prepare('DELETE FROM papers WHERE id=?').run(id)}
 for(const id of made.runs)try{db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id)}catch{}
});
