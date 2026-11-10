'use strict';
// Offline synthetic transport only. Production Vue, BankPages, styles and assets are executed unchanged.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const ROOT=__dirname,OUT=path.join(ROOT,'docs/ui-evidence-20261108/rounded-student');
let server,browser,origin;
before(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://fixture.invalid'),fixture=u.pathname.startsWith('/fixtures/');
  const base=path.join(ROOT,fixture?'test/fixtures/ui-learning':'public');
  const file=path.resolve(base,fixture?u.pathname.slice(10):u.pathname.slice(1));
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  if(file.endsWith('learning-live.html'))return res.end(fs.readFileSync(file,'utf8').replace('</head>','<link rel="stylesheet" href="/css/ui-rounded-student-20261108.css"><link rel="stylesheet" href="/css/ui-desktop-20261109.css"></head>'));
  if(file.endsWith('learning-data.js'))return res.end(fs.readFileSync(file,'utf8').replace("data=[];\n else throw", "data={list:[{question_id:990001,type:'single',subject:'数学',stem:'计算 6 × (4 + 5) 的结果。',options:['54','29','45','60'],point:'混合运算',source:'练习',last_answer:'B',answer:'A',analysis:'先算括号内，再计算乘法。',wrong_count:1,resolved:0,review_stage:0,updated_at:new Date().toISOString(),quiz_ticket:'synthetic-offline-question'},{question_id:990002,type:'fill',subject:'数学',stem:'24 ÷ 3 + 7 = ____。',point:'运算顺序',source:'试卷',last_answer:'8',answer:'15',analysis:'先除后加。',wrong_count:2,resolved:0,review_stage:1,updated_at:new Date().toISOString(),quiz_ticket:'synthetic-offline-question'}],counts:{数学:2},review:{due:0}};\n else if(u.pathname.includes('/videos/')&&u.pathname.endsWith('/play'))data={src:''};\n else if(u.pathname==='/api/stu/bank/lesson-questions')data={list:[syntheticQuestion]};\n else if(u.pathname==='/api/stu/bank/mistake-uploads')data={list:[]};\n else throw"));
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.CHROMIUM||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
for(const width of [1487,1440,390])test('rounded student home/course/mistakes at '+width,async()=>{
 const page=await browser.newPage({viewport:{width,height:width===390?844:1058},deviceScaleFactor:1});
 const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
 try{
  await page.goto(origin+'/fixtures/learning-live.html');await page.locator('#learnHeroTitle').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(OUT,'home-populated-'+width+'.png'),fullPage:true});
  const noOverflow=async()=>{const b=await page.locator('#view').boundingBox();assert.ok(b.x>=-1&&b.x+b.width<=width+1,'content must not be clipped behind the rail: '+JSON.stringify(b));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');};
  await noOverflow();
  assert.equal(await page.locator('.round-path-row').count(),1);
  if(width===390){assert.equal(await page.locator('.round-bottom-nav').isVisible(),true);assert.equal(await page.locator('.round-main-nav').isVisible(),false);}
  else {assert.equal(await page.locator('.round-main-nav').isVisible(),false);assert.equal(await page.locator('.st-side').getAttribute('aria-hidden'),'false');assert.equal(await page.locator('.st-side').isVisible(),true);assert.equal(Math.round((await page.locator('.st-side').boundingBox()).width),104);}
  await page.locator('.st-theme-btn').click();await page.locator('.theme-menu').waitFor();await page.evaluate(()=>window.__stuVm.pickTheme('green'));assert.equal(await page.getAttribute('body','data-theme'),'green');await page.evaluate(()=>window.__stuVm.pickTheme('day'));
  if(width===390){await page.locator('.learn-menu').click();await page.waitForFunction(()=>document.querySelector('.st-side').getBoundingClientRect().left>=-1);assert.equal(await page.locator('.st-side a[href="#/words/quick"]').isVisible(),true);assert.equal(await page.locator('.st-side a[href="#/timer"]').isVisible(),true);await page.locator('.round-drawer-close').click();await page.waitForFunction(()=>document.querySelector('.st-side').getBoundingClientRect().right<=0);}
  await page.locator('.learn-task-start').click();await page.locator('.quiz-mask').waitFor();await page.locator('#qzClose').click();
  await page.evaluate(async()=>{syntheticTasks.splice(0);await window.__stuVm.load();});await page.locator('.learn-tasks .learn-empty').waitFor();await page.screenshot({path:path.join(OUT,'home-'+width+'.png'),fullPage:true});
  if(width===390){
   const firstScreen=await page.evaluate(()=>({taskHeight:document.querySelector('.learn-tasks').getBoundingClientRect().height,practiceBottom:document.querySelectorAll('.learn-practice-row')[1].getBoundingClientRect().bottom,navTop:document.querySelector('.round-bottom-nav').getBoundingClientRect().top}));
   assert.ok(firstScreen.taskHeight<=68,'mobile empty task stays a compact single row: '+JSON.stringify(firstScreen));
   assert.ok(firstScreen.practiceBottom<=firstScreen.navTop,'both self-practice actions fit above bottom navigation in the matched empty-task fixture: '+JSON.stringify(firstScreen));
  }
  await page.locator('.learn-primary').click();await page.locator('.round-course-layout').waitFor();await noOverflow();
  await page.screenshot({path:path.join(OUT,'course-'+width+'.png'),fullPage:true});
  await page.locator('.round-video-play').click();await page.waitForFunction(()=>fixtureRequests.includes('/api/stu/videos/990011/play'));
  await page.locator('.round-practice-banner button').click();await page.locator('.quiz-mask').waitFor();await page.locator('#qzClose').click();
  await page.evaluate(()=>window.__stuVm.goBank('mistakes'));await page.locator('.round-mist-root').waitFor();await noOverflow();
  assert.equal(await page.locator('.bk-mist').count(),2);
  await page.locator('.toast').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
  await page.screenshot({path:path.join(OUT,'mistakes-'+width+'.png'),fullPage:true});
  await page.locator('.round-mist-answer summary').first().click();assert.equal(await page.locator('.round-mist-answer[open]').count(),1);
  await page.locator('.round-mist-toolbar select[name=point]').selectOption('运算顺序');assert.equal(await page.locator('.bk-mist').count(),1);
  await page.locator('.round-mist-toolbar select[name=point]').selectOption('');assert.equal(await page.locator('.bk-mist').count(),2);
  await page.locator('[data-redo="990001"]').click();await page.locator('.quiz-mask').waitFor();await page.locator('#qzClose').click();
  await page.locator('#bkDocx').click();await page.locator('.t9-dlg').waitFor();assert.equal(await page.locator('#t9xGo').textContent(),'下载 Word（2 题）');await page.locator('#t9xClose').click();
  await page.locator('#bkAll').click();await page.locator('#r9Filter').waitFor();await page.locator('#bkBack').click();await page.locator('.round-mist-root').waitFor();assert.equal(await page.locator('.bk2-tabs').count(),1);
  await page.evaluate(()=>document.querySelector('.rounded-student').scrollTop=500);await page.evaluate(()=>window.__stuVm.goCourses());await page.locator('.round-course-heading').waitFor();assert.equal(await page.evaluate(()=>document.querySelector('.rounded-student').scrollTop),0);
  await page.evaluate(async()=>{window.__stuVm.goHome();});await page.locator('#learnHeroTitle').waitFor();
  await page.evaluate(async()=>{fixtureMode='empty';await window.__stuVm.load();});assert.equal(await page.locator('progress').count(),0);
  await page.evaluate(async()=>{fixtureMode='error';await window.__stuVm.load();});assert.match(await page.locator('#learnHeroTitle').textContent(),/未能加载/);
  await noOverflow();assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  fs.writeFileSync(path.join(OUT,'browser-'+width+'.json'),JSON.stringify({scope:'Actual production frontend, synthetic offline data; no database or service use',width,errors,failed,passed:true},null,2));
 }finally{await page.close();}
});

test('grouped directory and full-screen word geometry retain existing access',async()=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await page.goto(origin+'/fixtures/learning-live.html');await page.locator('#learnHeroTitle').waitFor();
  await page.evaluate(()=>{syntheticDetail.grouped=true;syntheticDetail.groups=[{id:51,name:'分组一',lessons:[syntheticDetail.lessons[0]],practice_count:1,acc:{total:2,rate:null}},{id:52,name:'分组二',lessons:[{...syntheticDetail.lessons[0],video_id:990012,title:'另一节实际课程',handout:{id:99,title:'配套讲义',size:1024}}],practice_count:0,acc:{total:0}}];window.__stuVm.openCourse(syntheticDetail.id);});
  await page.locator('.round-course-layout').waitFor();assert.equal(await page.locator('.round-course-group').count(),2);
  await page.locator('.round-group-title').nth(1).click();await page.locator('.round-course-group').nth(1).locator('.round-lesson-select').click();
  assert.equal(await page.locator('.round-lesson-title').textContent(),'另一节实际课程');
  assert.equal(await page.locator('.round-handout').isVisible(),true);
  await page.screenshot({path:path.join(OUT,'course-grouped-390.png')});
  // The existing word renderer creates its full-screen stage on #view.
  await page.evaluate(()=>{document.body.classList.add('wt-stage');document.querySelector('#view').innerHTML='<section style="height:1400px">Synthetic word-stage geometry boundary</section>';});
  const metrics=await page.locator('#view').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,overflow:getComputedStyle(e).overflowY,scrollable:e.scrollHeight>e.clientHeight}));
  assert.equal(metrics.width,390);assert.equal(metrics.height,844);assert.equal(metrics.overflow,'auto');assert.equal(metrics.scrollable,true);
  assert.equal(await page.locator('.round-bottom-nav').isVisible(),false);
 }finally{await page.close();}
});
