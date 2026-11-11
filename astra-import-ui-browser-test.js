'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
 try{for(const width of [1212,390]){
  const p=await browser.newPage({viewport:{width,height:799}});p.setDefaultTimeout(6000);
  await p.goto('about:blank');await p.setContent('<body class="t11"><div id="view"></div></body>');
  for(const file of ['public/css/app.css','public/admin/theme.css'])await p.addStyleTag({path:path.join(__dirname,file)});
  await p.evaluate(()=>{
   window.esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');window.ic=()=>'';window.render=()=>{};window.toast=()=>{};window.optDisplay=s=>s;
   window.run={id:1,title:'测试'.repeat(100)+'.pdf',subject:'化学',stage:'junior',pages:[],drafts:[],ocr_texts:[]};
   window.api=async(url,opts)=>{if(url.endsWith('/runs/1'))return{run};if(url.endsWith('/drafts')){run.drafts=opts.body.drafts;return{};}if(url.endsWith('/recognize')){await new Promise(r=>window.finishRecognition=r);throw Error('合成失败');}return{list:[]};};
  });
  // about:blank storage is intentionally unavailable, supply only isolated test storage.
  await p.evaluate(()=>Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}}}));
  await p.addScriptTag({path:path.join(__dirname,'public/admin/mfbankui.js')});await p.evaluate(()=>mfIntakeWork(1));
  assert(await p.locator('#wkAuto').isDisabled());assert(await p.locator('#wkAsPaper').isDisabled());
  assert.equal(await p.locator('.mf-wk-title').evaluate(e=>getComputedStyle(e).textOverflow),'ellipsis');
  assert.equal(await p.locator('.mf-wk-title').evaluate(e=>e.getBoundingClientRect().width <= innerWidth),true);
  await p.evaluate(()=>{run.pages=[{url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}];return mfIntakeWork(1);});
  await p.locator('#wkAuto').click();await p.waitForFunction(()=>window.finishRecognition);
  for(const id of ['wkSemi','wkUpload','wkDel','wkAsPaper','wkCommit','wkAddCard'])assert(await p.locator('#'+id).isDisabled(),id);
  assert(await p.locator('#wkAuto').isEnabled());
  await p.evaluate(()=>finishRecognition());await p.waitForFunction(()=>document.querySelector('.mf-wk-top').textContent.includes('合成失败'));
  assert(await p.locator('#wkAuto').isEnabled());
  await p.close();
 }
 console.log('PASS: desktop/mobile empty state, long filename and running-action locks recover safely');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
