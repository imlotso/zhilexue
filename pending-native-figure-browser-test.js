'use strict';
// Synthetic source page; real Chromium canvas crop and network contract, no production data.
const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const width of [900,390]){
   const page=await browser.newPage({viewport:{width,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let png,saved;
   await page.route('http://native.test/**',async route=>{
    const u=route.request().url();
    if(u.includes('original-image'))return route.fulfill({status:200,contentType:'image/png',body:png});
    if(u.includes('/original?'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:0,data:{figure_candidates:[{x:.1,y:.2,w:.3,h:.4}]}})});
    if(u.includes('/figure')){saved=route.request().postDataBuffer();return route.fulfill({status:200,contentType:'application/json',body:'{"code":0}'});}
    return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><style>body{font:14px sans-serif;margin:16px}.input{max-width:100%;box-sizing:border-box}</style><h1>合成候选框浏览器回归</h1>'});
   });
   await page.goto('http://native.test/');
   png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,200,200);x.fillStyle='black';x.fillRect(20,40,60,80);return c.toDataURL().split(',')[1]}),'base64');
   await page.evaluate(()=>{window.PD_API='/api/admin/bank/mf';window.Auth={token:'synthetic'};window.toast=()=>{};window.render=()=>{window.saved=true};window.modal=o=>{const w=document.createElement('section');w.innerHTML=o.body+'<button id="save">保存</button><p id="error"></p>';document.body.append(w);w.querySelector('#save').onclick=()=>o.onOk(w,m=>w.querySelector('#error').textContent=m);o.onMount(w);return w;};});
   await page.addScriptTag({path:path.join(__dirname,'public/admin/pending-figure.js')});await page.evaluate(()=>pdCropFigure({id:'run:1:0',original_pages:1,original_page:1,images:[]}));
   await page.waitForFunction(()=>!document.querySelector('#pdFigCandidate').disabled);
   assert.equal(saved,undefined);await page.locator('#pdFigCandidate').selectOption('0');assert.equal(saved,undefined);
   assert.match(await page.locator('#pdFigStatus').innerText(),/尚未保存/);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   if(process.env.NATIVE_FIGURE_UI_EVIDENCE){fs.mkdirSync(process.env.NATIVE_FIGURE_UI_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.NATIVE_FIGURE_UI_EVIDENCE,`synthetic-native-candidate-${width}.png`),fullPage:true});}
   await page.locator('#save').click();await page.waitForFunction(()=>window.saved);
   const at=saved.indexOf(Buffer.from([137,80,78,71,13,10,26,10]));assert(at>=0);assert.equal(saved.readUInt32BE(at+16),60);assert.equal(saved.readUInt32BE(at+20),80);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Native candidate manual-only selection, real crop, desktop/mobile layout passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
