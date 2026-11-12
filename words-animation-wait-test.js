'use strict';
const {test,after}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');const {waitForMemoryAnimation}=require('./test/words-layout-animation.cjs');let browser;
after(async()=>{if(browser)await browser.close()});
test('measurement waits for both real scale transitions to finish',async()=>{
 browser ||= await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const page=await browser.newPage();
 try{
  await page.setContent(`<style>.item{height:80px;transition:transform .08s}.wq-big{transform:scale(1.35)}</style><div id="wqEn" class="item">word</div><div id="wqCn" class="item">意思</div><script>window.events=[];const en=document.querySelector('#wqEn'),cn=document.querySelector('#wqCn');window.start=()=>{en.classList.add('wq-big');setTimeout(()=>en.classList.remove('wq-big'),300);setTimeout(()=>{cn.classList.add('wq-big');window.events.push('cn-start');setTimeout(()=>{cn.classList.remove('wq-big');window.events.push('cn-end')},300)},400)};</script>`);
  const before=await page.locator('#wqEn').boundingBox();await page.evaluate(()=>window.start());await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('#wqEn')).transform).a>1.05);const during=await page.locator('#wqEn').boundingBox();assert.notEqual(Math.round(during.y),Math.round(before.y),'real animation changes screen bounds');
  await waitForMemoryAnimation(page);assert.deepEqual(await page.evaluate(()=>window.events),['cn-start','cn-end']);const after=await page.locator('#wqEn').boundingBox();assert.equal(Math.round(after.y),Math.round(before.y));assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#wqCn')).transform),'none');
 }finally{await page.close()}
});
test('missing expected second animation fails instead of hiding a layout problem',async()=>{
 browser ||= await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const page=await browser.newPage();try{await page.setContent('<style>.wq-big{transform:scale(1.35)}</style><div id="wqEn" class="wq-big"></div><div id="wqCn"></div>');await assert.rejects(waitForMemoryAnimation(page,250),/Timeout/)}finally{await page.close()}
});
