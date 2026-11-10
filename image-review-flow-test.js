'use strict';
// 只在隔离数据库运行：题图引用、原页边界、人工确认、稀疏图号入库。
const assert = require('assert');
const { db } = require('./src/db');
const store = require('./src/storage');
const Review = require('./src/image-review');
const BASE = process.env.BASE || 'http://localhost:3000', MF='/api/admin/bank/mf';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=','base64');
let runId=0, questionId=0, keys=[], extraRuns=[], extraCaps=[], extraQuestions=[];
async function req(path,{method='GET',body,form,token}={}) { const h={}; if(token) h.Authorization='Bearer '+token; if(body) h['Content-Type']='application/json'; const r=await fetch(BASE+path,{method,headers:h,body:form|| (body?JSON.stringify(body):undefined)}); const type=r.headers.get('content-type')||''; return type.includes('json')?r.json():{code:0,status:r.status,bytes:Buffer.from(await r.arrayBuffer())}; }
async function upload(id,index,token) { const f=new FormData(); f.append('id',id); f.append('index',String(index)); f.append('file',new Blob([pixel],{type:'image/png'}),'test.png'); return req(MF+'/ext/pending/figure',{method:'POST',form:f,token}); }
(async()=>{
 const login=await req('/api/login',{method:'POST',body:{username:'zlx-ci-admin',password:'123456',role:'admin'}}); assert.equal(login.code,0); const token=login.data.token;
 const saved=await store.saveFile(pixel,'original.png','bank/recog'); keys.push(saved.key);
 const c={page:1,source_pages:[1],figure_review_required:true,stem:'合成题 [图3]',questionType:'单选',options:[{label:'A',content:'选项 [图1]'},{label:'B',content:'文字'}],figures:[],answer:'',analysis:'',subject:'数学',stage:'junior'};
 const table={page:1,source_pages:[1],figure_review_required:true,stem:'对照表格 [表N]',questionType:'解答',figures:[{url:'/unrelated.png'}],answer:'',analysis:'',subject:'数学',stage:'junior'};
 const legacy={page:1,stem:'旧照片识别题未标图',questionType:'解答',figures:[],answer:'',analysis:'',subject:'数学',stage:'junior'};
 runId=db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,grade,source_kind,source_name,status,pages,drafts,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('图文审核合成测试','数学','junior','','image','','recognized',JSON.stringify([{key:saved.key}]),JSON.stringify([c,legacy,table]),'','2026-11-05 00:00:00').lastInsertRowid;
 const id=`run:${runId}:0`, tableId=`run:${runId}:2`;
 let tableResult=await req(MF+'/ext/pending/figure/confirm',{method:'POST',token,body:{id:tableId,expected:Review.signature(table)}}); assert.notEqual(tableResult.code,0,'表格占位不能用无关图片确认');
 tableResult=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[tableId]}}); assert.match(tableResult.msg || tableResult.data.failed[0].msg,/表格占位符/,'表格占位不能入库');
 const noAuth=await fetch(BASE+`${MF}/ext/pending/original-image?id=${encodeURIComponent(id)}&page=1`); assert([401,403].includes(noAuth.status));
 let r=await req(`${MF}/ext/pending/original-image?id=${encodeURIComponent(id)}&page=1`,{token}); assert.equal(r.status,200); assert(r.bytes.equals(pixel));
 r=await req(`${MF}/ext/pending/original-image?id=${encodeURIComponent(id)}&page=2`,{token}); assert.notEqual(r.code,0);
 r=await req(`${MF}/ext/pending/original-image?id=run:999999999:0&page=1`,{token}); assert.notEqual(r.code,0);
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[`run:${runId}:1`]}}); assert.match(r.msg || r.data.failed[0].msg,/图文归属尚未核对/, '历史无占位符照片卡也必须核对原页');
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[id]}}); assert.match(r.msg || r.data.failed[0].msg,/图1/);
 r=await req(MF+'/ext/pending/figure/confirm',{method:'POST',token,body:{id,expected:Review.signature(c)}}); assert.notEqual(r.code,0);
 for(const index of [0,2]) { r=await upload(id,index,token); assert.equal(r.code,0,r.msg); keys.push(new URL(r.data.url,'http://localhost').searchParams.get('key')); }
 const read=()=>JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(runId).drafts)[0];
 let card=read(); assert.deepStrictEqual(Review.missing(card),[]);
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[id]}}); assert.match(r.msg || r.data.failed[0].msg,/图文归属尚未核对/);
 r=await req(MF+'/ext/pending/figure/confirm',{method:'POST',token,body:{id,expected:Review.signature(card)}}); assert.equal(r.code,0,r.msg);
 r=await req(MF+'/ext/pending/item',{method:'PUT',token,body:{id,patch:{material:'新增材料'}}}); assert.equal(r.code,0,r.msg);
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[id]}}); assert.match(r.msg || r.data.failed[0].msg,/图文归属尚未核对/);
 card=read(); r=await req(MF+'/ext/pending/figure/confirm',{method:'POST',token,body:{id,expected:Review.signature(card)}}); assert.equal(r.code,0,r.msg);
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[id]}}); assert.equal(r.data.committed,1,JSON.stringify(r)); questionId=r.data.question_ids[0];
 const q=db.prepare('SELECT * FROM questions WHERE id=?').get(questionId); const imgs=JSON.parse(q.images), opts=JSON.parse(q.options);
 assert.equal(imgs.length,2); assert(q.stem.includes('[图2]')); assert(opts[0].text.includes('[图1]'));
 const vis=require('./src/question-images'), detail=JSON.parse(q.source_detail);
 assert.deepStrictEqual(detail.question_image_public,[1,2]); assert.equal(detail.question_image_public_basis,vis.publicBasis(q));
 // 技能包无页码旧卡在工作台保存时，不得清空、伪造或通过改变数量丢弃转存错误。
 const packCard={stem:'技能包题',figures:[{url:'/failed.png'}],_image_errors:[{index:0,message:'转存失败'}],_q:{stem:'技能包题',type:'answer',subject:'数学',stage:'junior',images:['/failed.png'],options:[],answer:'',analysis:''}};
 const pack=db.prepare("INSERT INTO mf_recog_runs (title,subject,stage,source_kind,status,pages,drafts,error,created_at) VALUES ('图片错误保护','数学','junior','word','recognized','[]',?,'','2026-11-05')").run(JSON.stringify([packCard])).lastInsertRowid; extraRuns.push(pack);
 const tampered=JSON.parse(JSON.stringify(packCard));tampered._image_errors=[];tampered._q.stem='老师修改题干';
 r=await req(MF+`/intake/runs/${pack}/drafts`,{method:'PUT',token,body:{drafts:[tampered]}});assert.equal(r.code,0,r.msg);
 let savedPack=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(pack).drafts)[0];
 assert.equal(savedPack._q.stem,'老师修改题干');assert.deepStrictEqual(savedPack._image_errors,packCard._image_errors);
 r=await req(MF+`/intake/runs/${pack}/drafts`,{method:'PUT',token,body:{drafts:[]}});assert.notEqual(r.code,0,'不能通过删除旧卡绕过转存错误');
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[`run:${pack}:0`]}});assert.match(r.msg||r.data.failed[0].msg,/题图转存失败/);
 async function replace(id) {const f=new FormData();f.append('id',id);f.append('index','0');f.append('file',new Blob([pixel],{type:'image/png'}),'replacement.png');return req(MF+'/ext/pending/image',{method:'POST',token,form:f});}
 r=await replace(`run:${pack}:0`);assert.equal(r.code,0,r.msg);
 savedPack=JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(pack).drafts)[0];assert.deepStrictEqual(savedPack._image_errors,[]);keys.push(new URL(savedPack._q.images[0],'http://localhost').searchParams.get('key'));
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[`run:${pack}:0`]}});assert.equal(r.code,0,r.msg);extraQuestions.push(...r.data.question_ids);
 // 采集卡没有工作台批量保存入口，单题编辑也不能清除错误；只能通过补图清除。
 const capCard={stem:'采集题',type:'answer',subject:'数学',stage:'junior',images:['/failed.png'],_image_errors:[{index:0,message:'转存失败'}]};
 const cap=db.prepare("INSERT INTO mf_capture_batches (title,site,subject,stage,status,payload,created_at) VALUES ('采集图片错误保护','test','数学','junior','pending',?,'2026-11-05')").run(JSON.stringify([capCard])).lastInsertRowid;extraCaps.push(cap);
 r=await req(MF+'/ext/pending/item',{method:'PUT',token,body:{id:`cap:${cap}:0`,patch:{stem:'采集题编辑',_image_errors:[]}}});assert.equal(r.code,0,r.msg);
 let savedCap=JSON.parse(db.prepare('SELECT payload FROM mf_capture_batches WHERE id=?').get(cap).payload)[0];assert.deepStrictEqual(savedCap._image_errors,capCard._image_errors);
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[`cap:${cap}:0`]}});assert.match(r.msg||r.data.failed[0].msg,/题图转存失败/);
 r=await replace(`cap:${cap}:0`);assert.equal(r.code,0,r.msg);
 savedCap=JSON.parse(db.prepare('SELECT payload FROM mf_capture_batches WHERE id=?').get(cap).payload)[0];assert.deepStrictEqual(savedCap._image_errors,[]);keys.push(new URL(savedCap.images[0],'http://localhost').searchParams.get('key'));
 r=await req(MF+'/ext/pending/commit',{method:'POST',token,body:{ids:[`cap:${cap}:0`]}});assert.equal(r.code,0,r.msg);extraQuestions.push(...r.data.question_ids);
 console.log('原页同批次访问、缺图阻断、补图、显式确认、修改失效与图号入库通过');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{ if(questionId)db.prepare('DELETE FROM questions WHERE id=?').run(questionId); for(const id of extraQuestions)db.prepare('DELETE FROM questions WHERE id=?').run(id); if(runId)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(runId);for(const id of extraRuns)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);for(const id of extraCaps)db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id); for(const key of keys)if(key)await store.deleteFile(key); });
