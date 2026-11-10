'use strict';
// 专用隔离库：学生取题不暴露解析图，逐题核对与交卷后返回解析图。
const assert=require('assert'), {db}=require('./src/db');
const base=process.env.BASE||'http://localhost:3000'; const ids={q:[],p:[]};
async function api(path,token,body) { const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();if(j.code)throw Error(path+': '+j.msg);return j.data; }
(async()=>{
 const token=(await api('/api/login','',{username:'13800000001',password:'123456',role:'student'})).token;
 const q=db.prepare("INSERT INTO questions (subject,stage,type,stem,material,options,answer,analysis,images,created_at) VALUES ('数学','junior','single',?,?,?,?,?,?,'2026-11-05')").run('题干 [图2]','',JSON.stringify([{label:'A',text:'选项 [图3]'},{label:'B',text:'其他'}]),'A','解析 [图1]',JSON.stringify(['https://img.invalid/solution.png','https://img.invalid/stem.png','https://img.invalid/option.png'])).lastInsertRowid;ids.q.push(q);
 const legacy=db.prepare("INSERT INTO questions (subject,stage,type,stem,options,answer,analysis,images,created_at) VALUES ('数学','junior','single','历史无图号','[]','A','',?,'2026-11-05')").run(JSON.stringify(['https://img.invalid/legacy.png'])).lastInsertRowid;ids.q.push(legacy);
 const p=db.prepare("INSERT INTO papers (title,subject,stage,grade,term,duration,total_score,q_ids,status,created_at) VALUES ('题图权限隔离测试','数学','','','',10,10,?,'published','2026-11-05')").run(JSON.stringify([q,legacy])).lastInsertRowid;ids.p.push(p);
 const paper=await api('/api/stu/bank/papers/'+p,token);const a=paper.questions.find(v=>v.id===q),b=paper.questions.find(v=>v.id===legacy);
 assert.deepStrictEqual(a.images,['','https://img.invalid/stem.png','https://img.invalid/option.png']);assert.deepStrictEqual(b.images,['https://img.invalid/legacy.png']);
 const checked=await api('/api/stu/bank/check',token,{items:[{question_id:q,quiz_ticket:a.quiz_ticket,my_answer:'A'}]});
 assert.equal(checked.list[0].analysis,'解析 [图1]');assert.deepStrictEqual(checked.list[0].solution_images,['https://img.invalid/solution.png','','']);
 const submitted=await api('/api/stu/bank/submit',token,{kind:'paper',paper_id:p,answers:[{question_id:q,my_answer:'A'}]});
 assert.deepStrictEqual(submitted.list.find(v=>v.question_id===q).solution_images,['https://img.invalid/solution.png','','']);
 console.log('试卷取题不泄露解析图、图号保留、核对/交卷后可查看、历史题图兼容通过');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 for(const p of ids.p){db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(p);db.prepare('DELETE FROM papers WHERE id=?').run(p);}
 for(const q of ids.q){for(const t of ['records','mistakes','question_nodes','question_tags'])try{db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q)}catch(_){} db.prepare('DELETE FROM questions WHERE id=?').run(q);}
});
