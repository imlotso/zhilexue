'use strict';
// 隔离库合成题：七入口的补充范围保持到审核，包内明确信息不被默认值改写。
const assert = require('assert'), crypto = require('crypto');
const { db } = require('./src/db');
const base = process.env.BASE || 'http://localhost:3000', mf = '/api/admin/bank/mf';
const runs = new Set(), caps = new Set();
async function post(path, token, body, key) {
  const form = body instanceof FormData;
  return fetch(base + path, {method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(!form?{'Content-Type':'application/json'}:{}),...(key?{'X-Intake-Key':key}:{})},body:form?body:JSON.stringify(body)}).then(r=>r.json());
}
(async()=>{
  const login = await post('/api/login','',{username:'15152099970',password:'123456',role:'admin'}), token=login.data.token;
  const tree=db.prepare("SELECT edition FROM bank_trees WHERE subject='英语' AND stage='junior' AND edition<>'' LIMIT 1").get();assert(tree);
  const scope={subject:'英语',stage:'junior',edition:tree.edition,term:'下册',material_type:'paper'};
  const cases=[['manual',mf+'/ext/pending/manual',{...scope,stem:'资料范围合成单题',type:'answer'}],['manual',mf+'/ext/pending/manual-group',{...scope,material:'共同材料',questions:[{stem:'甲',type:'answer'},{stem:'乙',type:'answer'}]}],['image',mf+'/intake/runs',{...scope,title:'资料范围合成图片',source_kind:'image'}],['pdf',mf+'/intake/runs',{...scope,title:'资料范围合成PDF',source_kind:'pdf'}],['capture',mf+'/capture/batches',{...scope,questions:[{stem:'资料范围合成采集',type:'answer'}]}]];
  for(const [kind,path,body] of cases){const r=await post(path,token,body,crypto.randomUUID());assert.equal(r.code,0,r.msg);const id=r.data.id;(kind==='capture'?caps:runs).add(id);const row=db.prepare(`SELECT * FROM ${kind==='capture'?'mf_capture_batches':'mf_recog_runs'} WHERE id=?`).get(id);for(const key of ['edition','term','material_type'])assert.equal(row[key],scope[key]);}
  const file=new FormData();file.append('file',new Blob([JSON.stringify({questions:[{subject:'英语',stage:'junior',stem:'包内学科',type:'answer'}]})]),'scope.json');Object.entries({...scope,subject:'数学',edition:''}).forEach(([k,v])=>file.append(k,v));
  const pack=await post(mf+'/import-pack',token,file,crypto.randomUUID());assert.equal(pack.code,0,pack.msg);runs.add(pack.data.run_id);const card=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(pack.data.run_id).drafts)[0];assert.equal(card.subject,'英语');assert.equal(card.term,'下册');assert.equal(card._q.subject,'英语');
  const unknownStage=await post(mf+'/import-pack',token,{...scope,pack:{questions:[{subject:'英语',stage:'无法判断的学段',stem:'不应套用默认学段',type:'answer'}]}},crypto.randomUUID());assert.equal(unknownStage.data.failed,1);assert.equal(unknownStage.data.run_id,0);
  const ticket=await post('/api/admin/bank/teacher-upload-token',token,scope);assert.equal(ticket.code,0,ticket.msg);
  const info=await fetch(base+'/api/up/info?t='+encodeURIComponent(ticket.data.token)).then(r=>r.json());assert.equal(info.data.defaults.edition,scope.edition);
  const makePhoto=(subject)=>{const f=new FormData();f.append('images',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'synthetic.png');f.append('subject',subject);f.append('grade','七年级');f.append('stem_text','资料范围合成扫码');return f;};
  const upload='/api/up/submit?t='+encodeURIComponent(ticket.data.token),key=crypto.randomUUID();
  const teacher=await post(upload,'',makePhoto('英语'),key);assert.equal(teacher.code,0,teacher.msg);runs.add(teacher.data.run_id);const row=db.prepare('SELECT edition,term,material_type FROM mf_recog_runs WHERE id=?').get(teacher.data.run_id);assert.deepEqual({...row},{edition:scope.edition,term:scope.term,material_type:scope.material_type});
  const repeat=await post(upload,'',makePhoto('英语'),key);assert(repeat.data.recovered);assert.equal(repeat.data.run_id,teacher.data.run_id);
  const conflict=await post(upload,'',makePhoto('数学'),crypto.randomUUID());assert.notEqual(conflict.code,0,'扫码不能把英语版本挂到数学题');
  const pending=await fetch(base+mf+'/ext/pending',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(pending.code,0,pending.msg);
  console.log('手工/组合/图片/PDF/采集范围保存、JSON 原分类保留、扫码签名范围/冲突拒绝和同凭据恢复通过');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const id of runs)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);for(const id of caps)db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id);});
