'use strict';
// 只使用合成原页和模拟保存，不连接真实题库或 AI。
const assert=require('assert');
let chromium;
try { ({chromium}=require('playwright')); } catch (_) { try { ({chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); } catch (_) { console.log('跳过裁图浏览器测试：Playwright 不可用'); process.exit(0); } }
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:800,height:700}}), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  let png, saved=false;
  await page.route('http://figure.test/**',async route=>{
   const u=route.request().url();
   if(u.includes('original-image')) return route.fulfill({status:200,contentType:'image/png',body:png});
   if(u.includes('/figure')) { saved=true; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:0})}); }
   return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body></body>'});
  });
  await page.goto('http://figure.test/');
  png=Buffer.from((await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,200,200);x.fillStyle='black';x.fillRect(20,20,70,60);return c.toDataURL('image/png').split(',')[1]})),'base64');
  await page.evaluate(()=>{window.PD_API='/api/admin/bank/mf';window.Auth={token:'test'};window.toast=()=>{};window.render=()=>{window.rendered=true};window.modal=(o)=>{const w=document.createElement('div');w.innerHTML=o.body+'<button id="ok">保存</button><p id="err"></p>';document.body.appendChild(w);w.querySelector('#ok').onclick=()=>o.onOk(w,m=>{w.querySelector('#err').textContent=m;return false});o.onMount(w);return {el:w};};});
  await page.addScriptTag({path:require('path').join(__dirname,'public/admin/pending-figure.js')});
  await page.evaluate(()=>pdCropFigure({id:'run:1:0',original_page:1,original_pages:2,source_pages:[1,2],figure_missing:[3],images:[]}));
  await page.waitForFunction(()=>document.querySelector('#pdFigStatus').textContent.includes('拖动框选'));
  assert.equal(await page.locator('#pdFigIndex').inputValue(),'3'); assert.equal(await page.locator('#pdFigPage option').count(),2);
  const b=await page.locator('#pdFigCanvas').boundingBox(); await page.mouse.move(b.x+20,b.y+20);await page.mouse.down();await page.mouse.move(b.x+110,b.y+95);await page.mouse.up();
  assert.match(await page.locator('#pdFigStatus').textContent(),/已框选/);
  await page.locator('#ok').click(); await page.waitForFunction(()=>window.rendered===true);
  assert(saved);assert.deepStrictEqual(errors,[]); console.log('裁图页面：多页来源、默认缺图编号、框选与保存通过');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
