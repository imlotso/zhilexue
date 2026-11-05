'use strict';
// 组合题接口及试卷保存回归。需启动本地服务与隔离测试数据库；测试数据在结束后清理。
const assert = require('assert');
const crypto = require('crypto');
const { db } = require('./src/db');
const { hash } = require('./src/auth');
const base = process.env.BASE || 'http://localhost:3000';
const ids = [];
let userId = 0, paperId = 0, token = '';
async function req(path, body, method = 'POST') {
  const r = await fetch(base + path, {
    method: body ? method : 'GET',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
async function ok(path, body, method) {
  const result = await req(path, body, method);
  assert.strictEqual(result.code, 0, `${path}: ${result.msg}`);
  return result.data;
}
(async () => {
  const suffix = crypto.randomBytes(8).toString('hex');
  const username = `group_test_${suffix}`;
  const password = crypto.randomBytes(16).toString('hex');
  userId = db.prepare("INSERT INTO users (role,username,password,name,created_at) VALUES ('admin',?,?,?,?)")
    .run(username, hash(password), '组合题测试', '2026-11-05').lastInsertRowid;
  token = (await ok('/api/login', { username, password, role: 'admin' })).token;
  const insert = db.prepare("INSERT INTO questions (subject,stage,grade,type,stem,material,options,answer,analysis,difficulty,sort,created_at,source_type,source_detail) VALUES ('英语','junior','初一',?,?,'组合测试共同材料',?,?,'',2,0,'2026-11-05','recog',?)");
  const run = Date.now(), title = `组合题测试${suffix}`;
  for (const [type, position, runId] of [['single', 1, run], ['fill', 2, run], ['answer', 3, run], ['fill', 1, run + 1]]) {
    ids.push(insert.run(type, `${title}-${position}-${runId}`, type === 'single' ? '[{"label":"A","text":"a"},{"label":"B","text":"b"}]' : '[]', type === 'single' ? 'A' : 'x', JSON.stringify({ question_group: { run_id: runId, ref: 'manual', position } })).lastInsertRowid);
  }
  const root = '/api/admin/bank/mf/questions/';
  const group = await ok(root + ids[1] + '/group');
  assert.deepStrictEqual(group.list.map(x => x.id), ids.slice(0, 3));
  assert.deepStrictEqual((await ok(root + ids[3] + '/group')).list.map(x => x.id), [ids[3]]);
  let question = (await ok(root + ids[1])).question;
  assert.strictEqual(question.material, '组合测试共同材料');
  const { source_type, source_detail, material, ...edit } = question;
  await ok(root + ids[1], edit, 'PUT');
  question = (await ok(root + ids[1])).question;
  assert.strictEqual(question.material, material);
  assert.strictEqual(question.source_type, source_type);
  assert.deepStrictEqual(question.source_detail, source_detail);
  paperId = (await ok('/api/admin/bank/papers', { title, subject: '英语', stage: 'junior', duration: 90, q_ids: group.list.map(x => x.id), question_scores: { [ids[0]]: 3, [ids[1]]: 17, [ids[2]]: 10 }, status: 'draft' })).id;
  const paper = db.prepare('SELECT q_ids,question_scores FROM papers WHERE id=?').get(paperId);
  assert.deepStrictEqual(JSON.parse(paper.q_ids), ids.slice(0, 3));
  assert.strictEqual(JSON.parse(paper.question_scores)[ids[1]], 17);
  db.prepare('UPDATE questions SET source_detail=? WHERE id=?').run(JSON.stringify({ question_group: { run_id: run, ref: 'manual', position: 1 } }), ids[1]);
  assert.notStrictEqual((await req(root + ids[0] + '/group')).code, 0, '位置重复应拒绝整组加入');
  console.log('组合题跨批次隔离、单题材料、来源保留与试卷顺序通过');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  if (paperId) db.prepare('DELETE FROM papers WHERE id=?').run(paperId);
  for (const id of ids) db.prepare('DELETE FROM questions WHERE id=?').run(id);
  if (userId) {
    db.prepare('DELETE FROM audit_logs WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM users WHERE id=?').run(userId);
  }
});
