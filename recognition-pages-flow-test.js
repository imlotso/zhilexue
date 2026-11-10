'use strict';
// Synthetic model output exercises the real recognition API without external AI.
const assert = require('assert');
const port = Number(process.env.TEST_PORT) || 3022;
process.env.PORT = String(port);
delete process.env.RECOGNITION_DIAGNOSTICS;
const { db } = require('./src/db');
const storage = require('./src/storage');
storage.readBuffer = async () => Buffer.from('synthetic page');
const mf = require('./src/mfcollect');
const calls = [];
mf.mfAiInvoke = async ({ user, images }) => {
  calls.push({ user, images: images.length });
  if (user.includes('这是第 1 页（当前页）')) return { text: JSON.stringify({ materials: [{ ref: 'story', materialMarkdown: '第一段', sourcePages: [1] }], questions: [] }) };
  if (user.includes('第二张是第 2 页')) return { text: JSON.stringify({ materials: [{ ref: 'story', materialMarkdown: '第二段', sourcePages: [2], continuesPrevious:true }], questions: [
    { number: 1, type: 'fill', questionText: '第一个小问', materialRef: 'story', groupRef: 'story', groupPosition: 1 },
    { qno: '2', questionType: '填空', stemMarkdown: '第二个小问', materialRef: 'story', groupRef: 'story', groupPosition: 2, answer: 'AI建议', analysis: 'AI解析' },
  ] }) };
  if (user.includes('第二张是第 3 页')) return { text: JSON.stringify({ materials: [], questions: [
    { qno: '1', continuationOf: '1', questionType: '单选', stemMarkdown: '第一个小问', materialRef:'story', groupRef:'story', groupPosition:1, options: [{label:'A',content:'甲'},{label:'B',content:'乙'}], sourcePages:[2,3] },
  ] }) };
  if (user.includes('第二张是第 5 页')) {
    // Simulate a teacher edit while the provider call is in flight.
    const row=db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(id);
    const edited=JSON.parse(row.drafts); edited[0].stem='老师并发编辑';
    db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(JSON.stringify(edited),id);
    return {text:JSON.stringify({materials:[],questions:[{qno:'3',questionType:'填空',stemMarkdown:'新题'}]})};
  }
  return { text: 'not a JSON object' };
};
require('./src/app');
const base = `http://127.0.0.1:${port}`; let token = '', id = 0;
async function req(path, data) {
  const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return res.json();
}
const prefix = '/api/admin/bank/mf';
(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(base + '/'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  let j = await req('/api/login',{username:'zlx-ci-admin',password:'123456',role:'admin'}); assert.equal(j.code,0,j.msg); token=j.data.token;
  j=await req(prefix+'/intake/runs',{title:'合成跨页识别',subject:'英语',stage:'junior',source_kind:'pdf'}); assert.equal(j.code,0,j.msg); id=j.data.id;
  const pages=[1,2,3,4,5].map(i=>({key:`bank/test/p${i}.png`,name:`p${i}.png`}));
  db.prepare('UPDATE mf_recog_runs SET pages=? WHERE id=?').run(JSON.stringify(pages),id);
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:1}); assert.equal(j.code,0,j.msg); assert.equal(j.data.added,0); assert.equal(j.data.material_count,1);
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:1}); assert.equal(j.code,0,j.msg); assert(j.data.already_recognized); assert.equal(calls.length,1);
  process.env.RECOGNITION_DIAGNOSTICS='1';
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:2}); assert.equal(j.code,0,j.msg); assert.equal(j.data.added,2); assert.equal(calls[1].images,2);
  delete process.env.RECOGNITION_DIAGNOSTICS;
  const diagnosticPages=JSON.parse(db.prepare('SELECT pages FROM mf_recog_runs WHERE id=?').get(id).pages);
  assert(!diagnosticPages[0].recognition_diagnostics,'默认不得保存诊断');
  const diag=diagnosticPages[1].recognition_diagnostics.questions[0].fields.questionText;
  assert.deepStrictEqual(diag,{type:'string',length:5});assert(!JSON.stringify(diagnosticPages[1].recognition_diagnostics).includes('第一个小问'));
  let q1=j.data.drafts[0], q2=j.data.drafts[1]; assert.equal(q1.material,'第一段\n第二段'); assert.equal(q1._material_ref,'story'); assert.equal(q1.group_ref,q2.group_ref); assert.equal(q1.group_position,1);
  assert.equal(q2.answer,''); assert.equal(q2.analysis,''); assert.equal(q2.ai_answer_suggestion.answer,'AI建议');
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:3}); assert.equal(j.code,0,j.msg); assert.equal(j.data.merged,1); assert.equal(j.data.added,0);
  q1=j.data.drafts[0]; assert.equal(q1.stem,'第一个小问'); assert.equal(q1.options.length,2); assert.equal(q1.questionType,'填空'); assert(q1.type_unconfirmed); assert(q1.content_review_required); assert(q1.figure_review_required);
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:4}); assert.notEqual(j.code,0,'无效 JSON 不能报告成功');
  const row=db.prepare('SELECT pages,drafts FROM mf_recog_runs WHERE id=?').get(id); assert.equal(JSON.parse(row.drafts).length,2); assert(!JSON.parse(row.pages)[3].recognition_complete);
  j=await req(prefix+`/intake/runs/${id}/recognize`,{page:5}); assert.notEqual(j.code,0,'并发编辑必须拒绝过期结果');
  const afterConcurrent=db.prepare('SELECT pages,drafts FROM mf_recog_runs WHERE id=?').get(id); assert.equal(JSON.parse(afterConcurrent.drafts)[0].stem,'老师并发编辑'); assert(!JSON.parse(afterConcurrent.pages)[4].recognition_complete);
  console.log('跨页识别接口：纯材料、共享题组、续题、AI建议隔离、重复页和失败保留通过');
})().then(()=>{ if(id)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);process.exit(0); }).catch(e=>{console.error(e);if(id)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);process.exit(1);});
