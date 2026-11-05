'use strict';
const assert=require('assert');
const review=require('./src/ai-answer-review');
assert.notStrictEqual(review.signature({stem:'选择题',options:['甲','乙']}),review.signature({stem:'选择题',options:['甲','丙']}),'字符串选项变化必须使建议失效');
assert.notStrictEqual(review.signature({stem:'选择题',options:[{label:'A',content:'甲'}]}),review.signature({stem:'选择题',options:[{label:'A',content:'乙'}]}),'对象选项变化必须使建议失效');
const inputs={stem:'题目',figures:[{url:'/image/1'}],audio_key:'bank/audio/1.mp3',question_subtype:'math_match',match_prompts:['甲','乙']};
for(const [name,change] of Object.entries({
  图片:{figures:[{url:'/image/2'}]}, 音频:{audio_key:'bank/audio/2.mp3'},
  连线左项:{match_prompts:['甲','丙']}, 细分题型:{question_subtype:'listen_match'},
})) assert.notStrictEqual(review.signature(inputs),review.signature({...inputs,...change}),`${name}变化必须使建议失效`);
assert.notStrictEqual(review.signature({_q:{stem:'题目',images:['/image/1']}}),review.signature({_q:{stem:'题目',images:['/image/2']}}),'转写题图片变化必须使建议失效');
assert.notStrictEqual(review.signature({stem:'题目',images:['/image/1']}),review.signature({stem:'题目',images:['/image/2']}),'采集或扫码图片变化必须使建议失效');
const port=Number(process.env.TEST_PORT)||3019;
process.env.PORT=String(port);
const {db}=require('./src/db');
const mf=require('./src/mfcollect');
mf.mfAiInvoke=async()=>({text:JSON.stringify({items:Array.from({length:20},(_,i)=>({i,answer:'5',analysis:'先加后算'}))})});
require('./src/app');
const base='http://127.0.0.1:'+port;const runIds=[],qIds=[],batchIds=[],uploadIds=[];let token;
async function req(p,body,method){const r=await fetch(base+p,{method:method||(body?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()}
const prefix='/api/admin/bank/mf';
function create(cards){const id=db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,grade,source_kind,source_name,status,pages,drafts,ocr_texts,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('AI建议验证','数学','junior','七年级','image','AIreview_test','recognized','[]',JSON.stringify(cards),'[]','','2026-11-05 00:00:00').lastInsertRowid;runIds.push(id);return id}
async function getItems(id,source='photo'){const j=await req(prefix+'/ext/pending?source='+source+'&batch_id='+id);assert.strictEqual(j.code,0,j.msg);return j.data.list}
const card=(stem)=>({stem,questionType:'填空',options:[],answer:'',analysis:'',checked:true});
async function testCapturedAndScanned(){
  // 模型兜底识别时，即使模型返回了答案/解析，也不能假定原文有对应内容。
  const ai=require('./src/ai'), oldFetch=mf.fetchPageAuto, oldChat=ai.chat;
  mf.fetchPageAuto=async()=>({status:200,buf:Buffer.from('<p>根据下列条件计算两数之和是多少？这里提供充足的上下文以供题目识别，原文没有答案也没有解析。</p>'),headers:{'content-type':'text/html; charset=utf-8'}});
  ai.chat=async()=>({text:JSON.stringify([{type:'fill',stem:'根据下列条件计算两数之和是多少',answer:'虚构答案',analysis:'虚构解析'}])});
  try {
    const extracted=await req(prefix+'/capture/auto',{url:'https://example.com/ai-review-fixture'});
    assert.strictEqual(extracted.code,0,extracted.msg);assert.strictEqual(extracted.data.via,'ai');
    assert.strictEqual(extracted.data.questions[0].answer,'');assert.strictEqual(extracted.data.questions[0].analysis,'');
    assert.strictEqual(extracted.data.questions[0].type_unconfirmed,true,'模型推断题型必须由老师确认');
  } finally { mf.fetchPageAuto=oldFetch; ai.chat=oldChat; }
  const now='2026-11-05 00:00:00', student=db.prepare("SELECT id FROM users WHERE username='13800000001'").get().id;
  const payload=[0,1,2,3,4].map(i=>({site:'zujuan',questionId:'ai-cap-'+Date.now()+'-'+i,stem:`采集建议${i} ____`,type:'fill',options:[],answer:i===3?'采集答案':'',analysis:'',...(i===4?{type_unconfirmed:true}:{})}));
  const existing=db.prepare("INSERT INTO questions (subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,images,source_type,source_detail,created_at) VALUES ('数学','七年级','fill',?,'[]','已有正式答案','',3,0,'junior','[]','capture',?,?)").run(payload[3].stem,JSON.stringify({site:'zujuan',questionId:payload[3].questionId}),now).lastInsertRowid;qIds.push(existing);
  const batch=db.prepare('INSERT INTO mf_capture_batches (title,site,url,subject,stage,grade,payload,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('AI采集建议验证','zujuan','', '数学','junior','七年级',JSON.stringify(payload),'pending',now).lastInsertRowid; batchIds.push(batch);
  const makeUpload=(stem, legacy)=>{
    let question=0;
    if(legacy){question=db.prepare("INSERT INTO questions (subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,images,created_at) VALUES ('数学','七年级','fill',?,'[]','','',3,0,'junior','[]',?)").run(stem,now).lastInsertRowid;qIds.push(question)}
    const draft=JSON.stringify({stem,type:'fill',options:[],answer:'',analysis:''});
    const id=db.prepare('INSERT INTO paper_uploads (user_id,subject,stage,grade,images,draft_json,status,question_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(student,'数学','junior','七年级','[]',draft,'pending',question,now).lastInsertRowid;uploadIds.push(id);return id;
  };
  const uploads=[makeUpload('扫码未确认 ____',false),makeUpload('扫码旧题 ____',true),makeUpload('扫码已修改 ____',false)];
  const all=async()=>{const r=await req(prefix+'/ext/pending?size=200');assert.strictEqual(r.code,0,r.msg);return r.data.list};
  let items=await all();const cap=i=>items.find(x=>x.kind==='cap'&&Number(x.batch_id)===Number(batch)&&x.index===i);const up=i=>items.find(x=>x.kind==='scan'&&Number(x.id.split(':')[1])===Number(uploads[i]));
  const ids=[cap(0),cap(1),cap(2),cap(3),cap(4),up(0),up(1),up(2)].map(item=>{assert(item);return item.id});
  let j=await req(prefix+'/ext/pending/ai-answer',{ids});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.suggested,ids.length,JSON.stringify(j.data.failed));items=await all();
  for(const item of [cap(0),cap(1),cap(2),up(0),up(1),up(2)]){assert(item&&item.ai_answer_suggestion&&!item.ai_answer_suggestion.stale,'各来源必须保留未确认建议');assert.strictEqual(item.answer,'');assert.strictEqual(item.analysis,'')}
  // 未确认直接审核，生成的题目仍无正式答案和解析。
  for(const item of [cap(0),up(0)]){j=await req(prefix+'/ext/pending/commit',{ids:[item.id]});assert.strictEqual(j.code,0,j.msg);const id=j.data.question_ids[0];qIds.push(id);const q=db.prepare('SELECT answer,analysis FROM questions WHERE id=?').get(id);assert.strictEqual(q.answer,'');assert.strictEqual(q.analysis,'')}
  // 采集与已有 question_id 的历史扫码题分别确认后入库。
  for(const item of [cap(1),up(1)]){j=await req(prefix+'/ext/pending/ai-answer/confirm',{id:item.id,token:item.ai_answer_suggestion.token,fields:['answer','analysis']});assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/ext/pending/commit',{ids:[item.id]});assert.strictEqual(j.code,0,j.msg);const id=j.data.question_ids[0];if(!qIds.includes(id))qIds.push(id);const q=db.prepare('SELECT answer,analysis FROM questions WHERE id=?').get(id);assert.strictEqual(q.answer,'5');assert.strictEqual(q.analysis,'先加后算')}
  const duplicate=cap(3);assert(duplicate.ai_answer_suggestion);j=await req(prefix+'/ext/pending/ai-answer/confirm',{id:duplicate.id,token:duplicate.ai_answer_suggestion.token,fields:['analysis']});assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/ext/pending/commit',{ids:[duplicate.id]});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.question_ids[0],existing);const preserved=db.prepare('SELECT answer,analysis,ai_review_metadata FROM questions WHERE id=?').get(existing);assert.strictEqual(preserved.answer,'已有正式答案');assert.strictEqual(preserved.analysis,'先加后算');assert(JSON.parse(preserved.ai_review_metadata).fields.analysis);assert(!JSON.parse(preserved.ai_review_metadata).fields.answer);
  const uncertain=cap(4);assert(uncertain.type_unconfirmed&&uncertain.ai_answer_suggestion);j=await req(prefix+'/ext/pending/ai-answer/confirm',{id:uncertain.id,token:uncertain.ai_answer_suggestion.token,fields:['answer']});assert.strictEqual(j.code,0,j.msg);items=await all();assert(cap(4).type_unconfirmed,'采纳答案建议不能确认题型');j=await req(prefix+'/ext/pending/commit',{ids:[cap(4).id]});assert.notStrictEqual(j.code,0,'题型未确认不得入库');
  // 编辑后的题目不得采纳旧建议。
  for(const item of [cap(2),up(2)]){const old=item.ai_answer_suggestion.token;j=await req(prefix+'/ext/pending/item',{id:item.id,patch:{stem:item.stem+' 修改'}},'PUT');assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/ext/pending/ai-answer/confirm',{id:item.id,token:old,fields:['answer']});assert.notStrictEqual(j.code,0,'题目变化后建议必须失效')}
}
async function testRecognizedAnswers(){
  const storage=require('./src/storage'), oldRead=storage.readBuffer, oldInvoke=mf.mfAiInvoke;
  storage.readBuffer=async()=>Buffer.from('synthetic image');
  mf.mfAiInvoke=async()=>({text:JSON.stringify({questions:[{qno:'1',questionType:'填空',stemMarkdown:'识别题 2+3=____',answerMarkdown:'5',analysisMarkdown:'2 加 3 得 5'}]})});
  try {
    for(const kind of ['recognize','structure','word']) {
      const run=create([{...card('人工题'),answer:'人工原答案',analysis:'人工原解析'}]);
      if(kind==='recognize') db.prepare('UPDATE mf_recog_runs SET pages=? WHERE id=?').run(JSON.stringify([{key:'test/fixture.png'}]),run);
      let j;
      if(kind==='word') {
        const {Document,Packer,Paragraph}=require('docx');
        const data=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('识别题 2+3=____ 原文')]}]}));
        const form=new FormData();form.append('file',new Blob([data]),'test.docx');
        j=await (await fetch(base+prefix+'/intake/runs/'+run+'/word',{method:'POST',headers:{Authorization:'Bearer '+token},body:form})).json();
      } else j=await req(prefix+'/intake/runs/'+run+'/'+kind,kind==='recognize'?{page:1}:{text:'识别题 2+3=____'});
      assert.strictEqual(j.code,0,j.msg);
      const saved=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(run).drafts);
      assert.strictEqual(saved[0].answer,'人工原答案');assert.strictEqual(saved[0].analysis,'人工原解析');
      const source=kind==='word'?'word':'photo';let items=await getItems(run,source), item=items.find(x=>x.index===1);
      assert.strictEqual(item.answer,'');assert.strictEqual(item.analysis,'');
      assert.strictEqual(item.ai_answer_suggestion.source,'recognition');
      assert.strictEqual(item.ai_answer_suggestion.answer,'5');
      j=await req(prefix+'/intake/runs/'+run+'/aifill/confirm',{index:1,token:item.ai_answer_suggestion.token,fields:['answer']});
      assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.card.answer,'5');assert.strictEqual(j.data.card.analysis,'');
      items=await getItems(run,source);item=items.find(x=>x.index===1);j=await req(prefix+'/ext/pending/commit',{ids:[item.id]});assert.strictEqual(j.code,0,j.msg);
      qIds.push(...j.data.question_ids);const q=db.prepare('SELECT answer,analysis FROM questions WHERE id=?').get(j.data.question_ids[0]);
      assert.strictEqual(q.answer,'5');assert.strictEqual(q.analysis,'','未采纳的模型解析不能入正式题库');
    }
  } finally { storage.readBuffer=oldRead; mf.mfAiInvoke=oldInvoke; }
}
(async()=>{for(let i=0;i<50;i++){try{await fetch(base+'/');break}catch{await new Promise(r=>setTimeout(r,100))}}const login=await req('/api/login',{username:'15152099970',password:'123456',role:'admin'});assert.strictEqual(login.code,0,login.msg);token=login.data.token;
const run=create([card('2+3=____'),{...card('6-1=____'),_q:{stem:'6-1=____',subject:'数学',stage:'junior',grade:'七年级',type:'fill',options:[],answer:'',analysis:'',detail:{test:'ai-review',stamp:Date.now()}}},{...card('旧题'),answer:'旧答案',analysis:'旧解析',ai_filled:true},{...card('历史有原页题'),page:1,answer:'保留旧答案',analysis:'保留旧解析'},{...card('纯人工题'),answer:'人工答案',analysis:'人工解析'}]);
let j=await req(prefix+'/intake/runs/'+run+'/aifill',{indexes:[0,1]});assert.strictEqual(j.code,0,j.msg);let cards=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(run).drafts);assert.strictEqual(cards[0].answer,'');assert.strictEqual(cards[0].analysis,'');assert.strictEqual(cards[0].ai_answer_suggestion.answer,'5');assert.strictEqual(cards[1]._q.answer,'');
let items=await getItems(run),first=items.find(x=>x.index===0),second=items.find(x=>x.index===1),legacy=items.find(x=>x.index===2);assert(first.ai_answer_suggestion&&!first.ai_answer_suggestion.stale);assert(legacy.ai_legacy_pending);
// 即使直接调用入库，未采纳建议也不会写入答案/解析。
j=await req(prefix+'/ext/pending/commit',{ids:[first.id]});assert.strictEqual(j.code,0,j.msg);qIds.push(...j.data.question_ids);let q=db.prepare('SELECT answer,analysis,ai_review_metadata FROM questions WHERE id=?').get(qIds[0]);assert.strictEqual(q.answer,'');assert.strictEqual(q.analysis,'');assert(!q.ai_review_metadata);
// 逐项确认独立生效，保留审阅者和时间。
j=await req(prefix+'/intake/runs/'+run+'/aifill/confirm',{index:1,token:second.ai_answer_suggestion.token,fields:['answer']});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.card._q.answer,'5');assert.strictEqual(j.data.card._q.analysis,'');assert.strictEqual(j.data.card.answer,'5');
const token2=j.data.card.ai_answer_suggestion.token;j=await req(prefix+'/intake/runs/'+run+'/aifill/confirm',{index:1,token:token2,fields:['analysis']});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.card._q.analysis,'先加后算');items=await getItems(run);second=items.find(x=>x.index===1);j=await req(prefix+'/ext/pending/commit',{ids:[second.id]});assert.strictEqual(j.code,0,j.msg);qIds.push(...j.data.question_ids);q=db.prepare('SELECT answer,analysis,ai_review_metadata FROM questions WHERE id=?').get(qIds[1]);assert.strictEqual(q.answer,'5');assert.strictEqual(q.analysis,'先加后算');assert(JSON.parse(q.ai_review_metadata).fields.answer.confirmed_by);
// 旧版 ai_filled 必须确认；伪造工作台字段不能跳过。
items=await getItems(run);legacy=items.find(x=>x.index===2);j=await req(prefix+'/ext/pending/commit',{ids:[legacy.id]});assert.notStrictEqual(j.code,0,'旧 AI 内容不应直接入库');cards=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(run).drafts);cards[2].ai_legacy_reviewed=true;j=await req(prefix+'/intake/runs/'+run+'/drafts',{drafts:cards},'PUT');assert.strictEqual(j.code,0,j.msg);items=await getItems(run);legacy=items.find(x=>x.index===2);assert(legacy.ai_legacy_pending,'工作台不能伪造旧版确认');j=await req(prefix+'/intake/runs/'+run+'/aifill/confirm',{index:2,legacy:true,expected:legacy.ai_legacy_signature});assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/ext/pending/commit',{ids:[legacy.id]});assert.strictEqual(j.code,0,j.msg);qIds.push(...j.data.question_ids);q=db.prepare('SELECT ai_review_metadata FROM questions WHERE id=?').get(qIds[2]);assert(JSON.parse(q.ai_review_metadata).legacy_confirmed);
items=await getItems(run);const historic=items.find(x=>x.index===3),manual=items.find(x=>x.index===4);assert(historic.ai_legacy_pending,'历史有原页答案必须保守核对');assert(!manual.ai_legacy_pending,'纯人工题无需历史 AI 核对');j=await req(prefix+'/ext/pending/commit',{ids:[historic.id]});assert.notStrictEqual(j.code,0);j=await req(prefix+'/intake/runs/'+run+'/aifill/confirm',{index:3,legacy:true,expected:historic.ai_legacy_signature});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.card.answer,'保留旧答案');assert.strictEqual(j.data.card.analysis,'保留旧解析');j=await req(prefix+'/ext/pending/commit',{ids:[historic.id,manual.id]});assert.strictEqual(j.code,0,j.msg);assert.strictEqual(j.data.committed,2);qIds.push(...j.data.question_ids);
// 题目编辑后，旧建议不能被采纳。
const run2=create([{...card('7-2=____'),figures:[{url:'/image/1'}]}]);j=await req(prefix+'/intake/runs/'+run2+'/aifill',{indexes:[0]});assert.strictEqual(j.code,0,j.msg);items=await getItems(run2);let item=items[0],oldToken=item.ai_answer_suggestion.token;cards=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(run2).drafts);cards[0].figures=[{url:'/image/2'}];j=await req(prefix+'/intake/runs/'+run2+'/drafts',{drafts:cards},'PUT');assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/intake/runs/'+run2+'/aifill/confirm',{index:0,token:oldToken,fields:['answer']});assert.notStrictEqual(j.code,0,'题图改变后不能采纳旧建议');
j=await req(prefix+'/intake/runs/'+run2+'/aifill',{indexes:[0]});assert.strictEqual(j.code,0,j.msg);items=await getItems(run2);item=items[0];oldToken=item.ai_answer_suggestion.token;j=await req(prefix+'/ext/pending/item',{id:item.id,patch:{stem:'8-2=____'}},'PUT');assert.strictEqual(j.code,0,j.msg);j=await req(prefix+'/intake/runs/'+run2+'/aifill/confirm',{index:0,token:oldToken,fields:['answer']});assert.notStrictEqual(j.code,0,'题干改变后不能采纳旧建议');
await testCapturedAndScanned();
await testRecognizedAnswers();
console.log('AI 建议独立保存、逐项确认、未确认入库、旧记录防绕过与过期保护通过');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(()=>{for(const id of uploadIds)try{db.prepare('DELETE FROM paper_uploads WHERE id=?').run(id)}catch{}for(const id of batchIds)try{db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id)}catch{}for(const id of qIds){try{db.prepare('DELETE FROM mistakes WHERE question_id=?').run(id);db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(id);db.prepare('DELETE FROM question_tags WHERE question_id=?').run(id);db.prepare('DELETE FROM questions WHERE id=?').run(id)}catch{}}for(const id of runIds)try{db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id)}catch{}setTimeout(()=>process.exit(process.exitCode||0),100)});
