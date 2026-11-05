'use strict';
// Requires the isolated test database and server used by pending-test.js.
const assert = require('assert');
const XLSX = require('xlsx');
const { db } = require('./src/db');
const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let runId = 0, questionId = 0;
async function api(path, method, token, body) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return res.json();
}
(async () => {
  try {
    const admin = (await api('/api/login', 'POST', '', { username:'15152099970', password:'123456', role:'admin' })).data.token;
    const student = (await api('/api/login', 'POST', '', { username:'13800000001', password:'123456', role:'student' })).data.token;
    const template = await fetch(BASE + MF + '/ext/import-template?options_10=1', { headers:{ Authorization:'Bearer ' + admin } });
    assert(template.ok);
    const workbook = XLSX.read(Buffer.from(await template.arrayBuffer()), {type:'buffer'});
    for (const name of ['单选题', '多选题', '完形填空题', '阅读理解题']) {
      const headers = XLSX.utils.sheet_to_json(workbook.Sheets[name], {header:1})[0]
        .map(s => String(s).replace(/\s+/g, '').replace(/[（(][^）)]*[)）]/g, ''));
      for (const letter of 'ABCDEFGHIJ') assert(headers.includes('选项' + letter), `${name} 缺少选项 ${letter}`);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['题目', ...[...'ABCDEFGHIJ'].map(l => '选项' + l), '正确选项'],
      ['十选项流程验证' + Date.now(), ...[...'ABCDEFGHIJ'].map(l => '内容' + l), 'AJ'],
    ]), '多选题');
    const form = new FormData();
    form.append('file', new Blob([XLSX.write(wb, {type:'buffer',bookType:'xlsx'})]), '十选项.xlsx');
    form.append('subject', '数学'); form.append('stage', 'junior');
    const imported = await api(MF + '/ext/import-excel', 'POST', admin, form);
    assert.strictEqual(imported.code, 0, imported.msg); runId = imported.data.run_id;
    const pending = await api(MF + '/ext/pending?size=100', 'GET', admin);
    const item = pending.data.list.find(q => q.kind === 'run' && Number(q.batch_id) === Number(runId));
    assert(item); assert.strictEqual(item.options.length, 10); assert.strictEqual(item.options[9].label, 'J');
    const committed = await api(MF + '/ext/pending/commit', 'POST', admin, {ids:[item.id]});
    assert.strictEqual(committed.code, 0, committed.msg); questionId = committed.data.question_ids[0]; assert(questionId);
    const detail = await api(MF + '/questions/' + questionId, 'GET', admin);
    assert.strictEqual(detail.data.question.options.length, 10);
    assert.strictEqual(detail.data.question.answer, 'A,J');
    const studentId = db.prepare("SELECT id FROM users WHERE username='13800000001'").get().id;
    db.prepare('INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at) VALUES (?,?,1,?,0,?)').run(studentId, questionId, 'A', '2026-11-05 00:00:00');
    const mistakes = await api('/api/stu/bank/mistakes', 'GET', student);
    const served = mistakes.data.list.find(q => Number(q.question_id) === Number(questionId));
    assert(served && served.quiz_ticket, '学生取题应返回作答票据');
    const checked = await api('/api/stu/bank/check', 'POST', student, {items:[{question_id:questionId,my_answer:'J,A',quiz_ticket:served.quiz_ticket}, {question_id:questionId,my_answer:'A',quiz_ticket:served.quiz_ticket}]});
    assert.strictEqual(checked.code, 0, checked.msg);
    const result = checked.data.list;
    assert.strictEqual(result[0].is_correct, true); assert.strictEqual(result[1].is_correct, false);
    console.log('十选项扩展模板下载、Excel 导入、审核入库和学生 A/J 判分均通过');
  } finally {
    if (questionId) {
      for (const table of ['question_nodes', 'question_tags', 'mistakes']) db.prepare(`DELETE FROM ${table} WHERE question_id=?`).run(questionId);
      db.prepare('DELETE FROM questions WHERE id=?').run(questionId);
    }
    if (runId) db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(runId);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
