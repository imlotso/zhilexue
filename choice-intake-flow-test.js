'use strict';
// 合成夹具，仅使用隔离数据库：校验录题/采集/扫码选择题选项，以及无答案旧题库接口。
const assert = require('assert');
const { db } = require('./src/db');
const Content = require('./src/content-review');
const { choiceOptionsError } = require('./src/choice-options');
const base = process.env.BASE || 'http://127.0.0.1:3000';
const mf = '/api/admin/bank/mf';
const runs = [], captures = [], uploads = [], questions = [];
let token = '';
async function api(path, body, method) {
  const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
function blocked(result) { assert.notStrictEqual(result.code, 0, JSON.stringify(result)); assert.match(result.msg || '', /至少.*两.*非空选项/); }
(async () => {
  assert(choiceOptionsError('single', [{label:'A',content:'   '},{label:'B',content:'甲'}]));
  assert(choiceOptionsError('multi', ['甲',' ',null]));
  assert.strictEqual(choiceOptionsError('single', ['甲','乙']), '');
  assert.strictEqual(choiceOptionsError('fill', []), '');
  let res = await api('/api/login', { username:'15152099970', password:'123456', role:'admin' }); assert.strictEqual(res.code,0); token = res.data.token;
  const runScope = { subject:'数学', stage:'junior', grade:'七年级' };
  const first = { questionType:'单选', stem:'合成缺选项单选题', options:[], answer:'', analysis:'', content_review_required:true };
  first.content_review_signature = Content.signature(first, runScope); // 模拟老师已确认题面，仍不能绕过缺选项。
  const cards = [first,
    { questionType:'多选', stem:'合成一项多选题', options:[{label:'A',content:'甲'},{label:'B',content:'  '}], answer:'', analysis:'' },
    { questionType:'单选', stem:'合成完整单选题', options:[{label:'A',content:'甲'},{label:'B',content:'乙'}], answer:'', analysis:'' },
    { stem:'合成技能包缺选项', _q:{ stem:'合成技能包缺选项', type:'single', options:[{label:'A',text:'甲'},{label:'B',text:'  '}], answer:'', analysis:'', subject:'数学', stage:'junior', grade:'七年级', detail:{ test:'choice-intake', stamp:Date.now() } } },
  ];
  const runId = db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,grade,source_kind,status,pages,drafts,error,created_at) VALUES (?,?,?,?,?,'recognized','[]',?,'','2026-11-05')").run('合成选择题入库校验','数学','junior','七年级','manual',JSON.stringify(cards)).lastInsertRowid; runs.push(runId);
  for (const index of [0,1,3]) { res=await api(mf+'/ext/pending/commit',{ids:[`run:${runId}:${index}`]}); blocked(res); }
  res=await api(mf+'/ext/pending/commit',{ids:[`run:${runId}:2`]}); assert.strictEqual(res.code,0,res.msg); assert.strictEqual(res.data.committed,1); questions.push(...res.data.question_ids);
  let saved=db.prepare('SELECT answer FROM questions WHERE id=?').get(res.data.question_ids[0]); assert.strictEqual(saved.answer,'','缺答案应保留空白');
  const payload = [
    { site:'synthetic',questionId:'choice-'+Date.now()+'-0',stem:'采集合成缺项',type:'single',options:[],answer:'' },
    { site:'synthetic',questionId:'choice-'+Date.now()+'-1',stem:'采集合成空项',type:'multi',options:['甲','  '],answer:'' },
    { site:'synthetic',questionId:'choice-'+Date.now()+'-2',stem:'采集合成完整',type:'single',options:['甲','乙'],answer:'' },
  ];
  const capId=db.prepare("INSERT INTO mf_capture_batches (title,site,url,subject,stage,grade,payload,status,created_at) VALUES ('选项校验','synthetic','','数学','junior','七年级',?,'pending','2026-11-05')").run(JSON.stringify(payload)).lastInsertRowid;captures.push(capId);
  for(const index of [0,1]) { res=await api(mf+'/ext/pending/commit',{ids:[`cap:${capId}:${index}`]});blocked(res); }
  res=await api(mf+'/ext/pending/commit',{ids:[`cap:${capId}:2`]});assert.strictEqual(res.code,0,res.msg);questions.push(...res.data.question_ids);saved=db.prepare('SELECT answer FROM questions WHERE id=?').get(res.data.question_ids[0]);assert.strictEqual(saved.answer,'');
  const student=db.prepare("SELECT id FROM users WHERE username='13800000001'").get();assert(student);
  const mkScan=(options)=>{const draft={stem:'扫码合成选择题',type:'single',options,answer:'',analysis:''};const id=db.prepare("INSERT INTO paper_uploads (user_id,subject,stage,grade,images,draft_json,status,question_id,created_at) VALUES (?,'数学','junior','七年级','[]',?,'pending',0,'2026-11-05')").run(student.id,JSON.stringify(draft)).lastInsertRowid;uploads.push(id);return id;};
  const badScan=mkScan([{label:'A',text:'甲'},{label:'B',text:' '}]);res=await api(mf+'/ext/pending/commit',{ids:[`up:${badScan}`]});blocked(res);
  const goodScan=mkScan([{label:'A',text:'甲'},{label:'B',text:'乙'}]);res=await api(mf+'/ext/pending/commit',{ids:[`up:${goodScan}`]});assert.strictEqual(res.code,0,res.msg);questions.push(...res.data.question_ids);saved=db.prepare('SELECT answer FROM questions WHERE id=?').get(res.data.question_ids[0]);assert.strictEqual(saved.answer,'');
  const kinds=[['single',['甲','乙']],['multi',['甲','乙']],['judge',[]],['fill',[]],['sort',['甲','乙']]];
  for(const [type,options] of kinds){const body={subject:'数学',stage:'junior',grade:'七年级',type,stem:`旧接口${type}`,options,answer:'',analysis:''};res=await api('/api/admin/bank/questions',body);assert.strictEqual(res.code,0,`${type}: ${res.msg}`);const id=res.data.id;questions.push(id);assert.strictEqual(db.prepare('SELECT answer FROM questions WHERE id=?').get(id).answer,'');res=await api(`/api/admin/bank/questions/${id}`,body,'PUT');assert.strictEqual(res.code,0,`${type} 编辑: ${res.msg}`);}
  res=await api('/api/admin/bank/questions',{type:'single',stem:'答案越界',options:['甲','乙'],answer:'C'});assert.notStrictEqual(res.code,0,'非空无效答案仍须拒绝');
  res=await api('/api/admin/bank/questions',{type:'judge',stem:'错误判断答案',options:[],answer:'也许'});assert.notStrictEqual(res.code,0,'非空无效判断答案仍须拒绝');
  console.log('录题/采集/扫码选择题缺少非空选项阻断、空答案保留及旧接口非空答案校验通过');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const id of uploads){try{db.prepare('DELETE FROM paper_uploads WHERE id=?').run(id)}catch{}}for(const id of captures){try{db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id)}catch{}}for(const id of runs){try{db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id)}catch{}}for(const id of questions){try{db.prepare('DELETE FROM mistakes WHERE question_id=?').run(id);db.prepare('DELETE FROM questions WHERE id=?').run(id)}catch{}}});
