'use strict';
// Isolated test data only; no AI request and no customer material.
const assert=require('assert'), crypto=require('crypto');
const port=Number(process.env.TEST_PORT)||3023;process.env.PORT=String(port);
const {db}=require('./src/db');require('./src/app');
const base=`http://127.0.0.1:${port}`, prefix='/api/admin/bank/mf';let token='', id=0;
async function req(path,data,method){const r=await fetch(base+path,{method:method||(data?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return r.json()}
(async()=>{
 for(let i=0;i<60;i++){try{await fetch(base+'/');break}catch{await new Promise(r=>setTimeout(r,100))}}
 let j=await req('/api/login',{username:'zlx-ci-admin',password:'123456',role:'admin'});assert.equal(j.code,0,j.msg);token=j.data.token;
 j=await req(prefix+'/intake/runs',{title:'合成跨页手动合并',subject:'数学',stage:'junior',source_kind:'pdf'});assert.equal(j.code,0,j.msg);id=j.data.id;
 const suggestion={token:'synthetic-token',basis:'old',answer:'合成建议',scope:'[]'};
 const cards=[{page:1,qno:'1',stem:'原题[图1]',questionType:'解答',options:[],figures:[{url:'/api/file?key=bank%2Fimg%2Fa.png'}],answer:'',analysis:'',_ai_card_id:'id-a',content_review_required:true,figure_review_required:true},{page:2,qno:'1',stem:'续题[图1]',questionType:'解答',options:[],figures:[{url:'/api/file?key=bank%2Fimg%2Fb.png'}],answer:'',analysis:'',_ai_card_id:'id-b',ai_answer_suggestion:suggestion,content_review_required:true,figure_review_required:true}];
 // Historical batches could be marked done while still containing unprocessed cards.
 db.prepare('UPDATE mf_recog_runs SET pages=?,drafts=?,status=? WHERE id=?').run(JSON.stringify([{key:'bank/recog/a.png'},{key:'bank/recog/b.png'}]),JSON.stringify(cards),'done',id);
 j=await req(prefix+`/ext/pending?source=photo&batch_id=${id}`);assert.equal(j.code,0,j.msg);assert.equal(j.data.list.length,2);
 const [a,b]=j.data.list.sort((x,y)=>x.index-y.index);
 j=await req(prefix+'/ext/pending/merge',{target_id:a.id,fragment_id:b.id,target_expected:'stale',fragment_expected:b.content_review_signature});assert.notEqual(j.code,0,'stale full snapshot must be rejected');
 j=await req(prefix+'/ext/pending/merge',{target_id:a.id,fragment_id:b.id,target_expected:a.content_review_signature,fragment_expected:b.content_review_signature});assert.equal(j.code,0,j.msg);const mergedId=j.data.id;
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(id).status,'recognized','历史未处理批次应恢复待审核状态');
 let saved=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(id).drafts);assert.equal(saved.length,2);assert.equal(saved[0].stem,'原题[图1]\n续题[图2]');assert.equal(saved[1].stem,'续题[图1]');assert.equal(saved[1]._merged_into.card_id,'id-a');
 assert.equal(saved[0].ai_answer_suggestion.answer,'合成建议');assert.equal(saved[0].ai_answer_suggestion.basis,'');assert.equal(saved[1].ai_answer_suggestion.basis,'old');
 j=await req(prefix+`/ext/pending?source=photo&batch_id=${id}`);assert.equal(j.data.list.length,1);assert.equal(j.data.list[0].id,mergedId);
 j=await req(prefix+'/ext/pending/commit',{ids:[mergedId]});assert.notEqual(j.code,0,'合并后须重新审核内容和图文');
 saved[1].stem='伪造归档';delete saved[1]._merged_into;
 j=await req(prefix+`/intake/runs/${id}/drafts`,{drafts:saved},'PUT');assert.notEqual(j.code,0,'不得篡改或解除已合并的归档片段');
 saved=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(id).drafts);assert.equal(saved[1].stem,'续题[图1]');assert(saved[1]._merged_into);
 j=await req(prefix+'/ext/pending/delete',{ids:[b.id]});saved=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(id).drafts);assert.equal(saved.length,2,'不可直接删除归档原片段');
 console.log('人工合并接口：快照校验、源片段归档、图号重映射、建议保留与审核阻断通过');
})().then(()=>{if(id)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);process.exit(0)}).catch(e=>{console.error(e);if(id)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);process.exit(1)});
