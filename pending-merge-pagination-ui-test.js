'use strict';
// 合成数据：跨列表分页暂存两个片段，服务端的快照校验仍然生效。
const assert=require('assert'); const path=require('path'); let chromium;
try { ({chromium}=require('playwright')); } catch (_) { try { ({chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); } catch (_) { console.log('跳过：Playwright 不可用'); process.exit(0); } }
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const p=await b.newPage(); await p.setContent('<body></body>');
 await p.evaluate(()=>{
  window.ADM={page:{pdPage:1}};window.esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');window.ic=()=>'';window.optText=o=>o.text||o.content||o;window.optLabel=(o,i)=>o.label||String.fromCharCode(65+i);window.pagerHTML=()=>'';window.bindPager=()=>{};window.mtxTypeset=()=>{};window.toast=()=>{};window.elConfirm=async()=>true;
  window.api=async (url,opts)=>{if(opts&&opts.method==='POST'){window.mergeBody=opts.body;return {}}; const n=ADM.page.pdPage;return {page:n,size:20,total:2,counts:{},status_counts:{},list:[{id:`run:7:${n-1}:fp${n}`,kind:'run',batch_id:7,index:n-1,source:'photo',source_label:'拍照',type:'answer',type_name:'解答',stem:`第${n}段`,options:[],images:[],answer:'',analysis:'',tags:[],content_review_signature:`sig${n}`}]}};
  window.render=async()=>{const v=await viewPending();document.body.innerHTML=v.html;v.after();};
 });
 await p.addScriptTag({path:path.join(__dirname,'public/admin/pendingui.js')});await p.evaluate(()=>render());
 await p.locator('.pd-item-tools summary').click();await p.locator('[data-act="merge-pin"]').click();await p.waitForFunction(()=>ADM.page.pd.mergePins.length===1);
 await p.evaluate(()=>{ADM.page.pdPage=2;return render()});await p.locator('.pd-item-tools summary').click();await p.locator('[data-act="merge-pin"]').click();await p.waitForFunction(()=>ADM.page.pd.mergePins.length===2);
 await p.locator('.pd-advanced summary').click();await p.locator('#pd-bmerge').click();await p.waitForFunction(()=>window.mergeBody);
 const result=await p.evaluate(()=>window.mergeBody);assert.equal(result.target_id,'run:7:0:fp1');assert.equal(result.fragment_id,'run:7:1:fp2');assert.equal(result.target_expected,'sig1');assert.equal(result.fragment_expected,'sig2');
 console.log('跨分页暂存同批次片段、顺序和审核快照通过');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
