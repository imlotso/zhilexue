'use strict';
// 需要本地测试服务和种子数据库，测试使用独立题目并在结束时清理。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { db } = require('./src/db');
const base = process.env.BASE || 'http://localhost:3000';
const ids = { questions: [], papers: [], mf: [] };
async function api(path, token, body) {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json(); if (j.code) throw Error(path + ': ' + j.msg); return j.data;
}
function addQuestion(type, subtype, answer, prompts, options) {
  const id = db.prepare('INSERT INTO questions (subject,stage,type,question_subtype,stem,answer,match_prompts,options,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('数学', 'junior', type, subtype, '连线部分分验证', answer, JSON.stringify(prompts || []), JSON.stringify(options || []), '2026-11-05 00:00:00').lastInsertRowid;
  ids.questions.push(id); return id;
}
function regularPaper(qs, scores, total) {
  const id = db.prepare("INSERT INTO papers (title,subject,stage,grade,term,duration,total_score,question_scores,q_ids,status,created_at) VALUES ('部分分测试','数学','','','',10,?,?,?,'published','2026-11-05')")
    .run(total, scores ? JSON.stringify(scores) : null, JSON.stringify(qs)).lastInsertRowid;
  ids.papers.push(id); return id;
}
function mfPaper(qs, scores) {
  const id = db.prepare("INSERT INTO mf_papers (title,subject,stage,status,published,created_at) VALUES ('部分分测试','数学','','done',1,'2026-11-05')").run().lastInsertRowid;
  ids.mf.push(id);
  qs.forEach((qid, i) => db.prepare("INSERT INTO mf_paper_questions (paper_id,question_id,position,score,kind,created_at) VALUES (?,?,?,?,'question','2026-11-05')").run(id, qid, i + 1, scores[i]));
  return id;
}
(async () => {
  // 运行实际浏览器端序列化代码：未连的项目必须保留位置，不能吞掉已连的线。
  const source = fs.readFileSync(require.resolve('./public/js/bank.js'), 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source + '\nwindow.serializeForTest = quizAnswerText;', context);
  const serialize = context.window.serializeForTest;
  assert.strictEqual(serialize({ type: 'sort', question_subtype: 'math_match', match_prompts: ['一','二','三','四'] }, [1, 0, 1, 0]), '1,0,1,0');
  assert.strictEqual(serialize({ type: 'sort', question_subtype: 'math_match', match_prompts: ['一','二'] }, [0, 0]), '');
  const admin = (await api('/api/login', '', { username: '15152099970', password: '123456', role: 'admin' })).token;
  const student = (await api('/api/login', '', { username: '13800000001', password: '123456', role: 'student' })).token;
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get('13800000001').id;
  const match = addQuestion('sort', 'math_match', '1,2,1,2', ['甲','乙','丙','丁'], ['甲图','乙图']);
  const single = addQuestion('single', '', 'A', [], ['甲','乙']);
  const subjective = addQuestion('answer', '', '', [], []);
  const paper = regularPaper([match, single], { [match]: 5, [single]: 2 }, 7);
  const studentPaper = await api('/api/stu/bank/papers/' + paper, student);
  const q = studentPaper.questions.find((x) => x.id === match);
  const check = await api('/api/stu/bank/check', student, { items: [{ question_id: match, quiz_ticket: q.quiz_ticket, my_answer: '1,0,1,0' }] });
  assert.strictEqual(check.list[0].match_correct, 2); assert.strictEqual(check.list[0].match_total, 4);
  const submit = await api('/api/stu/bank/submit', student, { kind: 'paper', paper_id: paper, answers: [{ question_id: match, my_answer: '1,0,1,0' }] });
  assert.strictEqual(submit.score, 2.5); assert.strictEqual(submit.total, 2); // 漏答单选记零分
  assert.strictEqual(submit.list.find((x) => x.question_id === match).earned_score, 2.5);
  let attempt = db.prepare('SELECT score,detail FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, paper);
  assert.strictEqual(Number(attempt.score), 2.5); assert.strictEqual(JSON.parse(attempt.detail).find((x) => x.question_id === match).earned_score, 2.5);
  const record = db.prepare('SELECT match_correct,match_total,is_correct FROM records WHERE user_id=? AND question_id=? ORDER BY id DESC LIMIT 1').get(uid, match);
  assert.strictEqual(record.match_correct, 2); assert.strictEqual(record.match_total, 4); assert.strictEqual(record.is_correct, 0);
  assert.strictEqual(db.prepare('SELECT resolved FROM mistakes WHERE user_id=? AND question_id=?').get(uid, match).resolved, 0);
  const mf = mfPaper([match, single], [5, 2]);
  const mfr = await api('/api/stu/bank/submit', student, { kind: 'mfpaper', paper_id: mf, answers: [{ question_id: match, my_answer: '1,0,1,0' }] });
  assert.strictEqual(mfr.score, 2.5);
  attempt = db.prepare('SELECT score,detail FROM mf_paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, mf);
  assert.strictEqual(Number(attempt.score), 2.5); assert.strictEqual(JSON.parse(attempt.detail).find((x) => x.question_id === match).earned_score, 2.5);
  const fractional = mfPaper([match], [4.02]);
  const fractionalPaper = await api('/api/stu/bank/mfpapers/' + fractional, student);
  assert.strictEqual(fractionalPaper.total_score, 4.02);
  const fractionalResult = await api('/api/stu/bank/submit', student, { kind: 'mfpaper', paper_id: fractional, answers: [{ question_id: match, my_answer: '1,0,0,0' }] });
  assert.strictEqual(fractionalResult.score, 1.01);
  const report = await api('/api/admin/xreport/exercises/' + uid + '/detail', admin);
  const recent = report.rows.find((r) => r.question_id === match);
  assert.strictEqual(recent.match_correct, 1); assert.strictEqual(recent.match_total, 4);
  const redoPart = await api('/api/stu/bank/submit', student, { kind: 'redo', answers: [{ question_id: match, my_answer: '1,0,0,0' }] });
  assert.strictEqual(redoPart.list[0].match_correct, 1);
  assert.strictEqual(db.prepare('SELECT resolved FROM mistakes WHERE user_id=? AND question_id=?').get(uid, match).resolved, 0);
  const redoFull = await api('/api/stu/bank/submit', student, { kind: 'redo', answers: [{ question_id: match, my_answer: '1,2,1,2' }] });
  assert.strictEqual(redoFull.list[0].match_correct, 4);
  assert.strictEqual(db.prepare('SELECT resolved FROM mistakes WHERE user_id=? AND question_id=?').get(uid, match).resolved, 1);
  const mixed = regularPaper([match, subjective], { [match]: 5, [subjective]: 2 }, 7);
  const mixedResult = await api('/api/stu/bank/submit', student, { kind: 'paper', paper_id: mixed, answers: [{ question_id: match, my_answer: '1,0,1,0' }, { question_id: subjective, my_answer: '解答' }] });
  assert.strictEqual(mixedResult.score, null); assert.strictEqual(mixedResult.objective_score, 2.5);
  const response = db.prepare('SELECT id FROM subjective_responses WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, mixed);
  const graded = await api('/api/admin/xreport/subjective/' + response.id + '/grade', admin, { score: 1.2 });
  assert.strictEqual(graded.final_score, 3.7);
  assert.strictEqual(Number(db.prepare('SELECT score FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, mixed).score), 3.7);
  const mixedMf = mfPaper([match, subjective], [5, 2]);
  const mixedMfResult = await api('/api/stu/bank/submit', student, { kind: 'mfpaper', paper_id: mixedMf, answers: [{ question_id: match, my_answer: '1,0,1,0' }, { question_id: subjective, my_answer: '解答' }] });
  assert.strictEqual(mixedMfResult.objective_score, 2.5);
  const mfResponse = db.prepare("SELECT id FROM subjective_responses WHERE user_id=? AND paper_id=? AND kind='mfpaper' ORDER BY id DESC LIMIT 1").get(uid, mixedMf);
  const mfGraded = await api('/api/admin/xreport/subjective/' + mfResponse.id + '/grade', admin, { score: 1.2 });
  assert.strictEqual(mfGraded.final_score, 3.7);
  assert.strictEqual(Number(db.prepare('SELECT score FROM mf_paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, mixedMf).score), 3.7);
  const legacy = regularPaper([match, single, subjective], null, 10);
  const full = await api('/api/stu/bank/submit', student, { kind: 'paper', paper_id: legacy, answers: [{ question_id: match, my_answer: '1,2,1,2' }, { question_id: single, my_answer: 'A' }, { question_id: subjective, my_answer: '解答' }] });
  assert.strictEqual(full.objective_score, 6.67);
  const legacyResponse = db.prepare('SELECT id,max_score FROM subjective_responses WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, legacy);
  const legacyGraded = await api('/api/admin/xreport/subjective/' + legacyResponse.id + '/grade', admin, { score: Number(legacyResponse.max_score) });
  assert.strictEqual(legacyGraded.final_score, 10);
  console.log('连线漏答保留、部分分、两类试卷持久化、错题记录、教师评分汇总通过');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  ids.questions.forEach((id) => {
    db.prepare('DELETE FROM subjective_responses WHERE question_id=?').run(id);
    db.prepare('DELETE FROM records WHERE question_id=?').run(id);
    db.prepare('DELETE FROM mistakes WHERE question_id=?').run(id);
    db.prepare('DELETE FROM questions WHERE id=?').run(id);
  });
  ids.papers.forEach((id) => { db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(id); db.prepare('DELETE FROM papers WHERE id=?').run(id); });
  ids.mf.forEach((id) => { db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(id); });
});
