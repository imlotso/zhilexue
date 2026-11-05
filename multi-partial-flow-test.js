'use strict';
// 隔离数据库、合成题、模拟 AI：覆盖两种试卷配置、计分、缺答案及批阅重算。
const assert = require('assert');
const { db } = require('./src/db');
const base = process.env.BASE || 'http://localhost:3000';
const ids = { questions: [], papers: [], mf: [] };
async function api(path, token, body, method) {
  const res = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}
async function ok(path, token, body, method) { const j = await api(path, token, body, method); if (j.code) throw Error(path + ': ' + j.msg); return j.data; }
function addQ(type, answer) {
  const id = db.prepare('INSERT INTO questions (subject,stage,type,stem,answer,options,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('物理', 'junior', type, '合成计分题', answer, JSON.stringify(['甲','乙','丙','丁']), '2026-11-05 00:00:00').lastInsertRowid;
  ids.questions.push(id); return id;
}
(async () => {
  const admin = (await ok('/api/login', '', { username:'15152099970',password:'123456',role:'admin' })).token;
  const student = (await ok('/api/login', '', { username:'13800000001',password:'123456',role:'student' })).token;
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get('13800000001').id;
  const q = addQ('multi', 'A,B');
  const missing = addQ('single', '');
  const drawing = (await ok('/api/admin/bank/mf/questions', admin, { subject:'物理',stage:'junior',type:'answer',question_subtype:'drawing',stem:'合成物理作图题',options:[],answer:'' })).id;
  ids.questions.push(drawing);
  assert.strictEqual((await ok('/api/admin/bank/mf/questions/'+drawing,admin)).question.question_subtype,'drawing','物理作图题应保留细分题型');
  const create = async (qs, partial) => {
    const scores = Object.fromEntries(qs.map(id => [id, 2]));
    const r = await ok('/api/admin/bank/papers', admin, { title:'多选计分测试', q_ids:qs, question_scores:scores, ...(partial === undefined ? {} : {question_partial_scores:partial}), status:'published' });
    ids.papers.push(r.id); return r.id;
  };
  const invalid = await api('/api/admin/bank/papers', admin, { title:'边界', q_ids:[q], question_scores:{[q]:2}, question_partial_scores:{[q]:2} });
  assert.notStrictEqual(invalid.code, 0, '部分分不能等于满分');
  const invalidType = await api('/api/admin/bank/papers', admin, { title:'边界', q_ids:[missing], question_scores:{[missing]:2}, question_partial_scores:{[missing]:1} });
  assert.notStrictEqual(invalidType.code, 0, '单选不能配置多选部分分');
  const paper = await create([q], { [q]:1.25 });
  assert.deepStrictEqual(JSON.parse((await ok('/api/admin/bank/papers/'+paper, admin)).question_partial_scores), { [q]:1.25 });
  for (const [answer,expected] of [['AB',2],['A',1.25],['B',1.25],['AC',0],['C',0],['',0]]) {
    const got=await ok('/api/stu/bank/submit', student, {kind:'paper',paper_id:paper,answers:[{question_id:q,my_answer:answer}]});
    assert.strictEqual(got.score,expected, '普通卷 '+answer);
    const saved=db.prepare('SELECT detail FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid,paper);
    assert.strictEqual(JSON.parse(saved.detail)[0].earned_score,expected);
  }
  const legacy=await create([q]);
  assert.strictEqual((await ok('/api/stu/bank/submit',student,{kind:'paper',paper_id:legacy,answers:[{question_id:q,my_answer:'A'}]})).score,0,'未配置保持全对计分');
  const zero=await create([q],{[q]:0});
  assert.strictEqual(JSON.parse((await ok('/api/admin/bank/papers/'+zero,admin)).question_partial_scores)[q],0,'显式零分与未设置区分');
  const mixed=await create([q,missing],{[q]:1.25});
  const quiz=await ok('/api/stu/bank/papers/'+mixed,student);
  const ticket=quiz.questions.find(x=>x.id===missing).quiz_ticket;
  const checked=await ok('/api/stu/bank/check',student,{items:[{question_id:missing,quiz_ticket:ticket,my_answer:'A'}]});
  assert.strictEqual(checked.list[0].ungraded,true,'未提供正式答案应标待评分');
  const mixedResult=await ok('/api/stu/bank/submit',student,{kind:'paper',paper_id:mixed,answers:[{question_id:q,my_answer:'A'},{question_id:missing,my_answer:'A'}]});
  assert.strictEqual(mixedResult.score,null); assert.strictEqual(mixedResult.objective_score,1.25); assert.strictEqual(mixedResult.ungraded_count,1);
  assert(!db.prepare('SELECT id FROM mistakes WHERE user_id=? AND question_id=?').get(uid,missing),'无答案不能误进错题');
  assert(!db.prepare('SELECT id FROM records WHERE user_id=? AND question_id=?').get(uid,missing),'无答案不能污染正确率');
  const report=await ok('/api/admin/xreport/exercises/'+uid+'/detail',admin);
  assert(!report.rows.some(r=>r.question_id===missing),'未评分题不进入报告的客观对错记录');
  assert(report.subjective.some(r=>r.question_id===missing && r.score==null),'未评分题应在报告中待老师评分');
  const response=db.prepare("SELECT id FROM subjective_responses WHERE user_id=? AND paper_id=? AND kind='paper' ORDER BY id DESC LIMIT 1").get(uid,mixed);
  await ok('/api/admin/bank/papers/'+mixed,admin,{question_partial_scores:{[q]:0.5}},'PUT');
  assert.strictEqual((await ok('/api/admin/xreport/subjective/'+response.id+'/grade',admin,{score:1})).final_score,2.25);
  const mf=db.prepare("INSERT INTO mf_papers (title,subject,stage,status,published,created_at) VALUES ('部分分测试','物理','','done',1,'2026-11-05')").run().lastInsertRowid; ids.mf.push(mf);
  const row=db.prepare("INSERT INTO mf_paper_questions (paper_id,question_id,position,score,kind,created_at) VALUES (?,?,1,2,'question','2026-11-05')").run(mf,q).lastInsertRowid;
  db.prepare("INSERT INTO mf_paper_questions (paper_id,question_id,position,score,kind,created_at) VALUES (?,?,2,2,'question','2026-11-05')").run(mf,missing);
  const rowPath='/api/admin/bank/mf/papers/'+mf+'/rows/'+row;
  assert.notStrictEqual((await api(rowPath,admin,{partial_score:2},'PUT')).code,0);
  await ok(rowPath,admin,{partial_score:1.25},'PUT');
  assert.strictEqual(Number(db.prepare('SELECT partial_score FROM mf_paper_questions WHERE id=?').get(row).partial_score),1.25);
  assert.notStrictEqual((await api(rowPath,admin,{score:1},'PUT')).code,0,'不能把满分改到小于已设部分分');
  const mfResult=await ok('/api/stu/bank/submit',student,{kind:'mfpaper',paper_id:mf,answers:[{question_id:q,my_answer:'A'},{question_id:missing,my_answer:'A'}]});
  assert.strictEqual(mfResult.score,null); assert.strictEqual(mfResult.objective_score,1.25);
  const mfResponse=db.prepare("SELECT id FROM subjective_responses WHERE user_id=? AND paper_id=? AND kind='mfpaper' ORDER BY id DESC LIMIT 1").get(uid,mf);
  await ok(rowPath,admin,{partial_score:0.5},'PUT');
  assert.strictEqual((await ok('/api/admin/xreport/subjective/'+mfResponse.id+'/grade',admin,{score:1})).final_score,2.25);
  const wrong=await ok('/api/stu/bank/submit',student,{kind:'mfpaper',paper_id:mf,answers:[{question_id:q,my_answer:'AC'},{question_id:missing,my_answer:'A'}]});
  assert.strictEqual(wrong.objective_score,0,'真题卷错选不得分');
  // 旧真题卷可能同一题已有多行：不删历史行，满分和少选分按各行累加。
  const dup=db.prepare("INSERT INTO mf_papers (title,subject,stage,status,published,created_at) VALUES ('旧卷重复题测试','物理','','done',1,'2026-11-05')").run().lastInsertRowid; ids.mf.push(dup);
  db.prepare("INSERT INTO mf_paper_questions (paper_id,question_id,position,score,partial_score,kind,created_at) VALUES (?,?,1,2,1,'question','2026-11-05')").run(dup,q);
  db.prepare("INSERT INTO mf_paper_questions (paper_id,question_id,position,score,partial_score,kind,created_at) VALUES (?,?,2,3,0.75,'question','2026-11-05')").run(dup,q);
  const oldPaper=await ok('/api/stu/bank/mfpapers/'+dup,student); assert.strictEqual(oldPaper.total_score,5);
  const oldFull=await ok('/api/stu/bank/submit',student,{kind:'mfpaper',paper_id:dup,answers:[{question_id:q,my_answer:'AB'}]}); assert.strictEqual(oldFull.score,5); assert.strictEqual(oldFull.score_total,5);
  const oldPartial=await ok('/api/stu/bank/submit',student,{kind:'mfpaper',paper_id:dup,answers:[{question_id:q,my_answer:'A'}]}); assert.strictEqual(oldPartial.score,1.75); assert.strictEqual(oldPartial.score_total,5);
  const oldWrong=await ok('/api/stu/bank/submit',student,{kind:'mfpaper',paper_id:dup,answers:[{question_id:q,my_answer:'AC'}]}); assert.strictEqual(oldWrong.score,0);
  const rowsBefore=db.prepare("SELECT COUNT(*) AS n FROM mf_paper_questions WHERE paper_id=? AND kind='question'").get(dup).n;
  const added=await ok('/api/admin/bank/mf/papers/'+dup+'/questions',admin,{question_ids:[q,q,missing,missing],score:2});
  assert.strictEqual(added.added,1); assert.strictEqual(added.skipped,1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM mf_paper_questions WHERE paper_id=? AND kind='question'").get(dup).n,rowsBefore+1,'新加题去重并保留已有行');
  console.log('普通卷与真题卷多选部分分配置、边界、未设置、无答案待评分与人工重算通过');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  ids.questions.forEach(id=>{ for(const t of ['subjective_responses','records','mistakes']) db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id); db.prepare('DELETE FROM questions WHERE id=?').run(id); });
  ids.papers.forEach(id=>{ db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(id); db.prepare('DELETE FROM papers WHERE id=?').run(id); });
  ids.mf.forEach(id=>{ db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(id); });
});
