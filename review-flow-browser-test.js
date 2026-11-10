'use strict';
// Actual UI with synthetic in-memory records; every external request is blocked.
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {chromium}=require('playwright');const {buildFixture}=require('./ui-review-concept-test');
const root=process.env.ZLX_TEST_ARTIFACT_DIR || path.join(os.tmpdir(),'zlx-review-flow-artifacts');fs.mkdirSync(root,{recursive:true});
for (const [name,width,height] of [['desktop',1503,737],['mobile',390,844]]) test('review to explicit import: '+name,async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width,height}}),external=[];
 try{
  await page.route('**/*',r=>{external.push(r.request().url());return r.abort()});
  await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{for(const x of fixture.rows.slice(0,2)){x.content_review_pending=false;x.content_review_required=false;x.figure_missing=[];}fixture.rows[0].ai_origin_uncertain=true;await fixture.refresh();window.fixtureCalls=[];});
  assert.equal(await page.locator('[data-act="commit-current"]').isEnabled(),true);
  await page.locator('[data-act="commit-current"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:root+'/commit-flow-'+name+'.png'});
  await page.locator('[data-act="edit"]').click();await page.locator('#mOk').click();
  assert.equal((await page.evaluate(()=>window.fixtureCalls)).filter(x=>x.method==='PUT').length,0,'opening and saving an unchanged question must not write');
  await page.locator('[data-class-field="point"]').fill('人工修改的新知识点');
  await page.locator('[data-act="commit-current"]').click();await page.waitForSelector('#pdB-sub');
  let calls=await page.evaluate(()=>window.fixtureCalls);assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,1);assert.equal(calls.filter(x=>x.url.endsWith('/commit')).length,0);
  assert.equal(await page.evaluate(()=>fixture.rows[0].point),'人工修改的新知识点');
  await page.locator('#mCancel').click();
  await page.locator('[data-act="commit-current"]').click();await page.locator('#mOk').click();await page.waitForFunction(()=>window.fixtureCalls.some(x=>x.url.endsWith('/commit')));
  assert.equal((await page.evaluate(()=>window.fixtureCalls)).filter(x=>x.url.endsWith('/commit')).length,1,'single import requires the explicit final action');
  await page.evaluate(async()=>{Object.assign(fixture.rows[0],{ai_legacy_pending:true,ai_legacy_signature:'legacy-synthetic-0',ai_legacy_pending_fields:['answer','analysis','classification']});await fixture.refresh();window.fixtureCalls=[];});
  assert.equal(await page.locator('[data-act^="legacy-"]').count(),1);assert.equal(await page.locator('[data-act="commit-current"]').isDisabled(),true);
  await page.locator('[data-act="legacy-review"]').click();await page.locator('#elcOk').click();await page.waitForFunction(()=>!fixture.rows[0].ai_legacy_pending);
  calls=await page.evaluate(()=>window.fixtureCalls);assert.equal(calls.filter(x=>x.url.endsWith('/aifill/confirm')).length,1);assert.equal(calls.filter(x=>x.url.endsWith('/commit')).length,0);
  assert.equal(await page.locator('[data-act="commit-current"]').isEnabled(),true);
  await page.evaluate(async()=>{Object.assign(fixture.rows[0],{ai_review_pending_fields:['answer','analysis'],ai_review_signature:'recheck-synthetic'});await fixture.refresh();window.fixtureCalls=[];});
  assert.equal(await page.locator('[data-act^="recheck-"]').count(),1);await page.locator('[data-act="recheck-review"]').click();await page.locator('#elcOk').click();await page.waitForFunction(()=>fixture.rows[0].ai_review_pending_fields.length===0);
  calls=await page.evaluate(()=>window.fixtureCalls);assert.deepEqual(calls[0].body.fields,['answer','analysis']);assert.equal(calls.filter(x=>x.url.endsWith('/commit')).length,0);
  await page.evaluate(async()=>{Object.assign(fixture.rows[0],{ai_legacy_pending:true,ai_legacy_signature:'legacy-synthetic-1',ai_legacy_pending_fields:['answer','analysis','classification']});await fixture.refresh();window.fixtureCalls=[];});
  await page.locator('details.pd-advanced summary').click();await page.locator('.r4-review-list [data-sel="fixture-1"]').check();await page.locator('.r4-review-list [data-sel="fixture-2"]').check();await page.locator('#pd-bcommit').click();
  assert.match(await page.locator('.mask').last().innerText(),/本页所选 2 题/);
  await page.screenshot({path:root+'/commit-flow-batch-'+name+'.png'});
  await page.locator('#pdB-legacy').click();assert.match(await page.locator('#elcOk').innerText(),/保留待审核/);await page.locator('#elcOk').click();await page.waitForFunction(()=>!fixture.rows[0].ai_legacy_pending);
  calls=await page.evaluate(()=>window.fixtureCalls);assert.equal(calls.filter(x=>x.url.endsWith('/legacy-confirm')).length,1);assert.equal(calls.filter(x=>x.url.endsWith('/commit')).length,0);
  await page.locator('details.pd-advanced summary').click();await page.locator('#pd-bcommit').click();await page.locator('#mOk').click();await page.waitForFunction(()=>window.fixtureCalls.some(x=>x.url.endsWith('/commit')));
  calls=await page.evaluate(()=>window.fixtureCalls);const commit=calls.find(x=>x.url.endsWith('/commit'));assert.equal(commit.body.items.length,2);assert.equal(commit.body.detailed,true);
  await page.evaluate(async()=>{window.fixtureCommitFailure=true;await fixture.refresh();});
  await page.locator('[data-act="commit-current"]').scrollIntoViewIfNeeded();await page.locator('[data-act="commit-current"]').click();await page.locator('#mOk').click();
  await page.waitForSelector('.mask');await page.waitForFunction(()=>document.querySelector('.mask')?.textContent.includes('入库结果'));
  assert.match(await page.locator('.mask').innerText(),/题图缺失/);assert.deepEqual(external,[]);
 }finally{await page.close();await browser.close();}
});
