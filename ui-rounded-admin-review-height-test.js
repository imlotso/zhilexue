'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {test}=require('node:test'),{chromium}=require('playwright');
const {buildFixture}=require('./ui-review-concept-test');
test('review compact desktop keeps content readable and actions reachable by scrolling',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const folder=path.join(__dirname,'docs/ui-evidence-20261108/rounded-admin-pages');fs.mkdirSync(folder,{recursive:true});
 const results=[];
 try{
  for(const width of [1366,1024]){
   const page=await browser.newPage({viewport:{width,height:768},deviceScaleFactor:1});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.abort());await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
   const geometry=await page.evaluate(()=>Object.fromEntries(['.pd-workspace','.pd-review-footer','.pd-classification','[data-act="edit"]','[data-act="save-classification"]','#pd-current-commit'].map(selector=>{
    const el=document.querySelector(selector),r=el.getBoundingClientRect(),center=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return [selector,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,hit:!!center&&(center===el||el.contains(center)),minHeight:getComputedStyle(el).minHeight,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}];
   })));
   results.push({width,height:768,geometry});
   fs.writeFileSync(path.join(folder,'review-compact-geometry.json'),JSON.stringify(results,null,2));
   await page.screenshot({path:path.join(folder,'review-compact-'+width+'-768.png')});
   const accessible=async selector=>{await page.locator(selector).scrollIntoViewIfNeeded();return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,hit:!!hit&&(hit===el||el.contains(hit))}})};
   for(const selector of ['[data-act="edit"]','[data-act="save-classification"]','#pd-current-commit']){
    const r=await accessible(selector);assert(r.top>=0&&r.bottom<=768&&r.hit,selector+' unreachable at '+width+'x768: '+JSON.stringify(r));
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await page.locator('[data-act="edit"]').click();await page.waitForSelector('.mask');await page.locator('.mask .close-x').click();
   assert.equal(await page.locator('.mask').count(),0);
   await page.locator('#pd-class-point').fill('短屏分类保存验证');
   await page.locator('[data-act="save-classification"]').click();
   await page.waitForFunction(()=>fixture.rows[0].point==='短屏分类保存验证');
   await page.locator('.pd-advanced>summary').click();
   assert(await page.locator('.pd-question-body').evaluate(e=>e.clientHeight)>=180,'expanded tools must not compress question text');
   assert(await page.locator('.pd-list-rows').evaluate(e=>e.clientHeight)>=120,'expanded tools must not compress the queue');
   for(const selector of ['[data-act="edit"]','[data-act="save-classification"]','#pd-current-commit']){
    const r=await accessible(selector);assert(r.top>=0&&r.bottom<=768&&r.hit,'expanded tools hide '+selector+': '+JSON.stringify(r));
   }
   await page.locator('.pd-advanced>summary').click();
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
