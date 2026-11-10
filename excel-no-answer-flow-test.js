'use strict';
// Isolated test database and local server only; imported fixtures stay pending.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { db } = require('./src/db');
const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
const marker = `无答案Excel自测${Date.now()}`;
let runId = 0;
async function api(route, method, token, body) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + route, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return r.json();
}
(async () => {
  try {
    const login = await api('/api/login', 'POST', '', { username:'zlx-ci-admin', password:'123456', role:'admin' });
    assert.strictEqual(login.code, 0, login.msg); const admin = login.data.token;
    const baseTemplate = await fetch(BASE + MF + '/ext/import-template', { headers: { Authorization: 'Bearer ' + admin } });
    assert(baseTemplate.ok); const original = fs.readFileSync(path.join(__dirname, 'docs', '原始需求', '习题导入模板_math_questions.xlsx'));
    assert.deepStrictEqual(Buffer.from(await baseTemplate.arrayBuffer()), original, '默认模板必须与客户原件逐字节相同');
    const extended = await fetch(BASE + MF + '/ext/import-template?options_10=1', { headers: { Authorization: 'Bearer ' + admin } });
    assert(extended.ok); const template = XLSX.read(Buffer.from(await extended.arrayBuffer()), { type:'buffer' });
    const headers = XLSX.utils.sheet_to_json(template.Sheets['选择填空题'], { header:1, defval:'' })[0].map(v => String(v).replace(/\s+/g, '').replace(/[（(][^）)]*[)）]/g, ''));
    for (const l of 'ABCDEFGHIJ') assert(headers.includes('选项' + l), `选择填空扩展模板缺少选项 ${l}`);
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    add('单选题', [['题目','选项A','选项B','答案'], [marker + '单选','甲','乙','']]);
    add('多选题', [['题目','选项A','选项B','答案'], [marker + '多选','甲','乙','']]);
    add('判断题', [['题目','答案'], [marker + '判断','']]);
    add('填空题', [['题目','第1空答案'], [marker + '填空 __','']]);
    add('排序题', [['题目','选项A','选项B','答案'], [marker + '排序','甲','乙','']]);
    add('组合题', [['题目'], [marker + '词块一；词块二']]);
    add('完形填空题', [['原文','小题序号','选项A','选项B','正确选项'], [marker + '完形材料',1,'甲','乙','']]);
    add('阅读理解题', [['原文','小题序号','小题题型','小题题目','选项A','选项B','正确选项'], [marker + '阅读材料',1,'选择题',marker + '阅读','甲','乙','']]);
    add('选择填空题', [['题干','小题序号','小题题目','小题答案','选项A','选项B'], [marker + '共享材料',1,marker + '词库','','甲','乙']]);
    const form = new FormData(); form.append('file', new Blob([XLSX.write(wb, {type:'buffer',bookType:'xlsx'})]), '无答案.xlsx');
    form.append('subject','数学'); form.append('stage','junior');
    const result = await api(MF + '/ext/import-excel', 'POST', admin, form);
    assert.strictEqual(result.code, 0, result.msg); assert.strictEqual(result.data.total, 9); assert.strictEqual(result.data.error_count, 0); runId = result.data.run_id;
    const pending = await api(MF + '/ext/pending?source=excel&size=100&batch_id=' + runId, 'GET', admin);
    assert.strictEqual(pending.code, 0, pending.msg); assert.strictEqual(pending.data.list.length, 9);
    assert(pending.data.list.every(q => q.answer === ''), '所有正式答案必须保持空白');
    const group = pending.data.list.find(q => q.stem === '将所给的词块排列成一句通顺的话');
    assert(group && group.options.length === 2 && group.answer === '', '词块原顺序不得自动当答案');
    const choice = pending.data.list.find(q => q.stem === marker + '词库');
    assert(choice && choice.material === marker + '共享材料' && choice.options.map(o => o.content || o.text).join('|') === '甲|乙' && choice.answer === '');
    const found = await api(MF + '/questions?kw=' + encodeURIComponent(marker) + '&size=20', 'GET', admin);
    assert.strictEqual(found.code, 0, found.msg); assert.strictEqual(found.data.total, 0, '导入后题目仍需审核，不得直接进入题库');
    console.log('Excel 原模板逐字节不变、扩展选项列、九类缺答案导入和待审核保留空答案均通过');
  } finally {
    if (runId) db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(runId);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
