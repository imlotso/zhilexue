'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {chromium}=require('playwright');
const {buildFixture}=require('./ui-review-concept-test');

test('expanded and collapsed review areas remain readable, scrollable and operable',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const [width,height] of [[1538,948],[1503,737],[1366,768],[1024,768],[900,700],[821,600],[390,844],[320,700]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[],requests=[];page.setDefaultTimeout(6000);
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
   try{
    await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
    await page.evaluate(async()=>{fixture.rows[0].analysis=Array.from({length:60},(_,i)=>`合成解析第 ${i+1} 行，用于验证滚动。`).join('\n');await fixture.refresh();});
    await page.locator('.pd-advanced>summary').click();
    const metrics=await page.evaluate(()=>Object.fromEntries(['.pd-list','.pd-list-rows','.pd-main','.pd-question-body','.pd-classification','.pd-review-footer'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return [s,{height:r.height,top:r.top,bottom:r.bottom,client:e.clientHeight,scroll:e.scrollHeight}]})));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}: no horizontal overflow`);
    if(width===1503)await page.screenshot({path:'/home/bobo/Documents/Codex/2026-11-10/task-2/review-layout-expanded-top.png'});
    if(width>820){
     assert(metrics['.pd-list'].height>=400,`${width}: review area collapsed ${JSON.stringify(metrics)}`);
     assert(metrics['.pd-list-rows'].client>=120,`${width}: queue collapsed ${JSON.stringify(metrics)}`);
     assert(metrics['.pd-question-body'].client>=180,`${width}: question text collapsed ${JSON.stringify(metrics)}`);
     assert(metrics['.pd-classification'].height>=400,`${width}: classification collapsed ${JSON.stringify(metrics)}`);
     assert(metrics['.pd-review-footer'].top>=metrics['.pd-list'].bottom-1,`${width}: footer overlaps review`);
     await page.locator('.pd-question-body').hover();await page.mouse.wheel(0,500);
     await page.waitForFunction(()=>document.querySelector('.pd-question-body').scrollTop>0,null,{timeout:3000});
     await page.locator('[data-review-row]').last().scrollIntoViewIfNeeded();
     assert(await page.locator('.pd-list-rows').evaluate(e=>e.scrollTop)>0,`${width}: queue cannot scroll`);
     if(width===1503){await page.locator('.pd-question-body').evaluate(e=>{e.scrollTop=0});await page.locator('.pd-list').evaluate(e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:'/home/bobo/Documents/Codex/2026-11-10/task-2/review-layout-expanded-content.png'});}
    }else{
     assert(metrics['.pd-question-body'].height>180,`${width}: mobile content collapsed`);
     assert(metrics['.pd-review-footer'].top>=metrics['.pd-classification'].bottom-1,`${width}: mobile footer overlaps`);
    }
    await page.locator('[data-act="edit"]').click();await page.locator('.mask').waitFor();await page.locator('.mask .close-x').click();
    await page.locator('#pd-class-point').scrollIntoViewIfNeeded();assert.equal(await page.locator('#pd-class-point').isVisible(),true);
    await page.locator('#pd-next').click();assert.equal(await page.locator('.pd-item').getAttribute('data-id'),'fixture-2');
    await page.locator('#pd-prev').click();assert.equal(await page.locator('.pd-item').getAttribute('data-id'),'fixture-1');
    await page.locator('#pd-class-point').fill('合成未保存分类');await page.locator('.pd-advanced>summary').click();
    assert.equal(await page.locator('#pd-class-point').inputValue(),'合成未保存分类');await page.locator('.pd-advanced>summary').click();
    assert.equal(await page.locator('#pd-class-point').inputValue(),'合成未保存分类');await page.locator('#pd-class-point').fill('两步混合运算');await page.locator('.pd-advanced>summary').click();
    if(width>820){const closed=await page.locator('.pd-question-body').evaluate(e=>e.clientHeight);assert(closed>=180,`${width}: collapsed tools shrink question to ${closed}px`);}
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log(JSON.stringify({width,height,expanded:metrics,controls:'passed'}));
   }finally{await page.close();}
  }
 }finally{await browser.close();}
});
