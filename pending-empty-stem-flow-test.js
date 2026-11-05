'use strict';
// 隔离数据库：空题干题卡不可被丢弃，须保持可见、可编辑、不能入库。
const assert=require('assert'),{db}=require('./src/db'),store=require('./src/storage');
const base=process.env.BASE||'http://localhost:3000', MF='/api/admin/bank/mf';
let runs=[],caps=[],questions=[],keys=[];
async function api(path,token,body,method){ const r=await fetch(base+path,{method:method|| (body?'POST':'GET'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json(); }
(async()=>{
 const login=await api('/api/login','',{username:'15152099970',password:'123456',role:'admin'});assert.equal(login.code,0);const token=login.data.token;
 const blank={page:1,qno:'13',stem:'',material:'公共材料',questionType:'单选',options:[{label:'A',content:'选项一'},{label:'B',content:'选项二'}]};
 const archived={page:2,qno:'12',stem:'合并的历史片段',_merged_into:{card_id:'kept'}};
 const create=(status,drafts)=>{const id=db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,source_kind,status,pages,drafts,error,created_at) VALUES ('空题干回归','数学','junior','image',?,?,?,'','2026-11-05')").run(status,JSON.stringify([{key:'bank/recog/test.png'}]),JSON.stringify(drafts)).lastInsertRowid;runs.push(id);return id;};
 const active=create('recognized',[blank,archived]),legacy=create('done',[{...blank,qno:'14',content_review_required:true,type_unconfirmed:true}]);
 const doneFigure=create('done',[{...blank,qno:'图文恢复'}]);
 const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.append('id',`run:${doneFigure}:0`);form.append('index','0');form.append('file',new Blob([img],{type:'image/png'}),'synthetic.png');
 const up=await fetch(base+MF+'/ext/pending/figure',{method:'POST',headers:{Authorization:'Bearer '+token},body:form}).then(r=>r.json());assert.equal(up.code,0,up.msg);keys.push(new URL(up.data.url,'http://localhost').searchParams.get('key'));
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(doneFigure).status,'recognized','历史空卡补图须安全恢复批次');
 const doneContent=create('done',[{...blank,qno:'内容恢复',content_review_required:true}]);
 const contentItem=(await api(`${MF}/ext/pending?source=photo&batch_id=${doneContent}&size=100`,token)).data.list[0];
 const restoreContent=await api(MF+'/ext/pending/content/confirm',token,{id:contentItem.id,expected:contentItem.content_review_signature});assert.equal(restoreContent.code,0,restoreContent.msg);
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(doneContent).status,'recognized','历史空卡内容核对须安全恢复批次');
 const doneWithCommitted=create('done',[{...blank,qno:'15'},{stem:'已经入库的题',committed:12345}]);
 const allCommitted=create('done',[{page:1,stem:'整批已处理',committed:54321}]);
 const closedDrafts=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(allCommitted).drafts);
 const closed=await api(`${MF}/intake/runs/${allCommitted}/drafts`,token,{drafts:closedDrafts},'PUT');assert.notEqual(closed.code,0,'全已处理批次不得重开');
 const closedFigureForm=new FormData();closedFigureForm.append('id',`run:${allCommitted}:0`);closedFigureForm.append('index','0');closedFigureForm.append('file',new Blob([img],{type:'image/png'}),'synthetic.png');
 const closedFigure=await fetch(base+MF+'/ext/pending/figure',{method:'POST',headers:{Authorization:'Bearer '+token},body:closedFigureForm}).then(r=>r.json());assert.notEqual(closedFigure.code,0,'已入库题卡不得补图改写');
 const snapshot=db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(doneWithCommitted).drafts, bulk=JSON.parse(snapshot);
 bulk[1].stem='试图篡改已入库题';
 let blockedBulk=await api(`${MF}/intake/runs/${doneWithCommitted}/drafts`,token,{drafts:bulk},'PUT');assert.notEqual(blockedBulk.code,0,'不能修改已处理题卡');
 assert.equal(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(doneWithCommitted).drafts,snapshot);
 const validBulk=JSON.parse(snapshot);validBulk[0].stem='工作台补录原文';validBulk[0].page=0;validBulk[0].qno='篡改题号';validBulk[0].committed=99999;
 const restoredBulk=await api(`${MF}/intake/runs/${doneWithCommitted}/drafts`,token,{drafts:validBulk},'PUT');assert.equal(restoredBulk.code,0,restoredBulk.msg);
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(doneWithCommitted).status,'recognized');
 const guarded=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(doneWithCommitted).drafts)[0];
 assert.equal(guarded.stem,'工作台补录原文');assert.equal(guarded.page,1,'旧卡页码不能由客户端改写');assert.equal(guarded.qno,'15','旧卡题号不能由客户端改写');assert(!guarded.committed,'客户端不能伪造已入库标记');
 const cap=db.prepare("INSERT INTO mf_capture_batches (title,site,subject,stage,status,payload,created_at) VALUES ('空题干采集回归','test','数学','junior','done',?,'2026-11-05')").run(JSON.stringify([{stem:'',options:['A','B'],questionId:'sample-1'}])).lastInsertRowid;caps.push(cap);
 for(const [id,no] of [[active,'13'],[legacy,'14']]){
  const list=await api(`${MF}/ext/pending?source=photo&batch_id=${id}&size=100`,token);assert.equal(list.code,0);assert.equal(list.data.total,1);const item=list.data.list[0];assert.equal(item.stem,'');assert.equal(item.qno,no);assert.equal(item.options.length,2);assert.equal(item.original_page,1);
  const blocked=await api(MF+'/ext/pending/commit',token,{ids:[item.id]});assert.notEqual(blocked.code,0);assert.match(blocked.msg,/题干为空/);
  const edit=await api(MF+'/ext/pending/item',token,{id:item.id,patch:{stem:'补录的原题题干',type:'single',type_confirmed:true}},'PUT');assert.equal(edit.code,0,edit.msg);assert.equal(edit.data.stem,'补录的原题题干');
 }
 const batch=await api(MF+'/ext/pending/batches?source=photo',token);assert.equal(batch.code,0);const b=batch.data.list.find(x=>x.id===active);assert.equal(b.total,1,'合并归档片段不计入总数');assert.equal(b.pending,1,'空题干卡必须计入待处理');assert.equal(b.status,'待核对');
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(legacy).status,'recognized','历史误标完成批次编辑后恢复待审核');
 let recovered=(await api(`${MF}/ext/pending?source=photo&batch_id=${legacy}&size=100`,token)).data.list[0];
 const content=await api(MF+'/ext/pending/content/confirm',token,{id:recovered.id,expected:recovered.content_review_signature});assert.equal(content.code,0,content.msg);
 recovered=(await api(`${MF}/ext/pending?source=photo&batch_id=${legacy}&size=100`,token)).data.list[0];
 const fig=await api(MF+'/ext/pending/figure/confirm',token,{id:recovered.id,expected:recovered.figure_review_signature});assert.equal(fig.code,0,fig.msg);
 const committed=await api(MF+'/ext/pending/commit',token,{ids:[recovered.id]});assert.equal(committed.code,0,committed.msg);questions.push(...committed.data.question_ids);
 const mixed=create('recognized',[{...blank,qno:'15'},{page:0,qno:'16',stem:'可入库的独立题',questionType:'解答',options:[],answer:'',analysis:'',subject:'数学',stage:'junior'}]);
 const ok=await api(MF+'/ext/pending/commit',token,{ids:[`run:${mixed}:1`]});assert.equal(ok.code,0,ok.msg);questions.push(...ok.data.question_ids);
 assert.equal(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(mixed).status,'recognized','同批次空题干未处理时不能错误标记全部完成');
 const still=await api(`${MF}/ext/pending?source=photo&batch_id=${mixed}&size=100`,token);assert.equal(still.data.total,1);assert.equal(still.data.list[0].qno,'15');
 const capList=await api(`${MF}/ext/pending?source=capture&batch_id=${cap}&size=100`,token);assert.equal(capList.data.total,1);const capItem=capList.data.list[0];
 const capBlocked=await api(MF+'/ext/pending/commit',token,{ids:[capItem.id]});assert.notEqual(capBlocked.code,0);assert.match(capBlocked.msg,/题干为空/);
 const capEdit=await api(MF+'/ext/pending/item',token,{id:capItem.id,patch:{stem:'人工补录题干'}},'PUT');assert.equal(capEdit.code,0);assert.equal(db.prepare('SELECT status FROM mf_capture_batches WHERE id=?').get(cap).status,'pending');
 console.log('空题干和旧误完成批次可见、可编辑、禁入库；合并归档不计数通过');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{for(const id of runs)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);for(const id of caps)db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id);for(const id of questions)db.prepare('DELETE FROM questions WHERE id=?').run(id);for(const key of keys)if(key)await store.deleteFile(key);});
