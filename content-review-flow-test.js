'use strict';
// 只使用隔离测试数据库与合成题，不访问真实试卷或外部 AI。
const assert = require('assert/strict');
const {db} = require('./src/db');
const base=process.env.BASE || 'http://127.0.0.1:3000';
const api='/api/admin/bank/mf';
let token='', runId=0, questionId=0;
async function request(path, data, method) {
 const r=await fetch(base+path,{method:method || (data?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 return r.json();
}
(async()=>{
 const login=await request('/api/login',{username:'zlx-ci-admin',password:'123456',role:'admin'});assert.equal(login.code,0,login.msg);token=login.data.token;
 const card={_ai_card_id:'content-review-fixture-'+Date.now(),_ai_review_schema:1,stem:'合成题：计算 2+3',questionType:'填空',options:[],answer:'',analysis:'',checked:true,content_review_required:true,recognition_notes:['符号待核对'],cross_page_review_required:true,source_pages:[1,2]};
 runId=db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,grade,source_kind,source_name,status,pages,drafts,ocr_texts,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('识别内容核对测试','数学','junior','七年级','image','synthetic','recognized','[]',JSON.stringify([card]),'[]','','2026-11-05 00:00:00').lastInsertRowid;
 const item=async()=>{const r=await request(api+'/ext/pending?source=photo&batch_id='+runId);assert.equal(r.code,0,r.msg);assert.equal(r.data.list.length,1);return r.data.list[0];};
 let q=await item();assert(q.content_review_pending);assert.deepEqual(q.recognition_notes,['符号待核对']);assert(q.cross_page_review_required);
 let r=await request(api+'/ext/pending/commit',{ids:[q.id]});assert.notEqual(r.code,0,JSON.stringify(r));assert.match(r.msg,/内容尚未核对/);
 r=await request(api+'/ext/pending/content/confirm',{id:q.id,expected:'tampered'});assert.notEqual(r.code,0,'错误签名不得确认');
 r=await request(api+'/ext/pending/content/confirm',{id:q.id,expected:q.content_review_signature});assert.equal(r.code,0,r.msg);
 q=await item();assert.equal(q.content_review_pending,false);
 // 对题目进行人工修改后旧确认失效，不能沿用旧确认直接入库。
 r=await request(api+'/ext/pending/item',{id:q.id,patch:{stem:'合成题：计算 2+4'}},'PUT');assert.equal(r.code,0,r.msg);
 q=await item();assert(q.content_review_pending,'编辑题干应使确认失效');
 r=await request(api+'/ext/pending/commit',{ids:[q.id]});assert.notEqual(r.code,0,JSON.stringify(r));assert.match(r.msg,/内容尚未核对/);
 // 旧入口的整批保存不得剥去风险标记或伪造确认。
 let cards=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(runId).drafts);
 const forged={...cards[0],content_review_required:false,content_review_signature:'forged',recognition_notes:[]};
 r=await request(api+`/intake/runs/${runId}/drafts`,{drafts:[forged]},'PUT');assert.equal(r.code,0,r.msg);
 q=await item();assert(q.content_review_pending);assert.deepEqual(q.recognition_notes,['符号待核对']);
 r=await request(api+'/ext/pending/content/confirm',{id:q.id,expected:q.content_review_signature});assert.equal(r.code,0,r.msg);
 q=await item();r=await request(api+'/ext/pending/commit',{ids:[q.id]});assert.equal(r.data.committed,1,JSON.stringify(r));questionId=r.data.question_ids[0];
 const stored=db.prepare('SELECT answer,analysis FROM questions WHERE id=?').get(questionId);assert.equal(stored.answer,'');assert.equal(stored.analysis,'');
 console.log('识别内容未确认不得入库、编辑失效、旧入口防篡改与逐题确认通过');
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{if(questionId)db.prepare('DELETE FROM questions WHERE id=?').run(questionId);if(runId)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(runId)});
