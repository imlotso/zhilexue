'use strict';
// Actual browser + actual frontend modules, synthetic HTTP data only. No service/database.
// Run in the authorized native terminal because exec Chromium sockets are restricted.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const ROOT=__dirname, OUT=path.join(ROOT,'docs/ui-evidence-20261108/learning');
let server,browser,origin;
before(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://fixture.invalid').pathname);
  const base=pathname.startsWith('/fixtures/')?path.join(ROOT,'test/fixtures/ui-learning'):path.join(ROOT,'public');
  const relative=pathname.startsWith('/fixtures/')?pathname.slice(10):pathname.slice(1);
  const file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){console.error('Fixture resource not found:',pathname);res.writeHead(404);res.end();return;}
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream';
  res.setHeader('Content-Type',type);fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
for(const width of [1487,1440,390])test('learning UI '+width+'px renders real source and completes interactions',async()=>{
 const page=await browser.newPage({viewport:{width,height:1058},deviceScaleFactor:1});
 const errors=[],consoleErrors=[],failedResources=[];page.on('response',r=>{if(r.status()>=400)failedResources.push({url:r.url(),status:r.status()});});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),location:m.location()});});
 await page.goto(origin+'/fixtures/learning-live.html');await page.locator('#learnHeroTitle').waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(OUT,'learning-'+width+'.png'),fullPage:false});
 const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},overflow:document.documentElement.scrollWidth>innerWidth+1,themeIconWidth:document.querySelector('.st-theme-btn .ai').getBoundingClientRect().width,hero:{width:document.querySelector('.learn-hero').getBoundingClientRect().width,height:document.querySelector('.learn-hero').getBoundingClientRect().height}}));
 assert.equal(metrics.overflow,false);assert.ok(metrics.themeIconWidth>=20,'theme icon remains legible');
 const results=await page.evaluate(()=>runLearningTests());
 fs.writeFileSync(path.join(OUT,'browser-'+width+'.json'),JSON.stringify({scope:'Synthetic isolated fixture, actual production Vue and BankPages, Chromium rendered',metrics,results,errors,consoleErrors,failedResources},null,2));
 assert.equal(results.at(-1).name,'COMPLETE',JSON.stringify(results));assert.equal(results.every(r=>r.pass),true);assert.deepEqual(errors,[]);assert.deepEqual(failedResources,[]);assert.deepEqual(consoleErrors,[]);
 if(width===390){await page.locator('#view').evaluate(e=>e.scrollTop=e.scrollHeight);await page.screenshot({path:path.join(OUT,'learning-390-lower.png')});}
 await page.close();
});
test('more mathematics tasks survive navigation from the login-default English subject',async()=>{
 const page=await browser.newPage({viewport:{width:1487,height:1058}});
 await page.goto(origin+'/fixtures/learning-live.html');await page.locator('#learnHeroTitle').waitFor();
 await page.evaluate(async()=>{syntheticTasks.push({...syntheticTasks[0],id:990022,title:'合成任务三'},{...syntheticTasks[0],id:990023,title:'合成任务四'});window.__stuVm.subject='英语';await window.__stuVm.load();});
 await page.getByRole('link',{name:'按学科查看任务',exact:true}).click();await page.locator('#papersHost .pk-task').first().waitFor();
 assert.equal(await page.locator('#papersHost .pk-task').count(),4);
 assert.equal(await page.evaluate(()=>window.__stuVm.subject),'数学');
 await page.close();
});
