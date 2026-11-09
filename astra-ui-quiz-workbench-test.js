'use strict';
// Real BankQuiz renderer + isolated HTTP fixture. No app server, database, credentials or external services.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = __dirname;
const evidence = path.join(root, 'evidence/ui-quiz');
fs.mkdirSync(evidence, {recursive:true});
const fixture = `<!doctype html><html lang="zh-CN" data-ui-theme="senyu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/ali-icons.css"><link rel="stylesheet" href="/vendor/element-ui.css"><link rel="stylesheet" href="/css/ruoyi.css"><link rel="stylesheet" href="/css/ui-quiz-20261108.css"><link rel="stylesheet" href="/css/senyu-tokens.css"><link rel="stylesheet" href="/css/senyu-components.css"><link rel="stylesheet" href="/css/senyu-workspaces.css"><body class="sy-theme sy-core"><button id="launch">打开练习</button><script src="/js/api.js"></script><script src="/js/bank.js"></script></body></html>`;
const questions = Array.from({length:10},(_,i)=>({id:9001+i,type:'single',subject:'数学',quiz_ticket:'synthetic-only',stem:'计算 36 + 12 × 3 时，正确的计算顺序是（ ）。',options:['先算 36 + 12，再乘 3','按照从左到右的顺序计算','先算 12 × 3，再加 36','先把三个数相加，再计算']}));
let server, browser, origin, delayedResolve, checkCalls = [], aiCalls = [], holdCheck = false;
test.before(async()=>{
  server=http.createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
    if(req.url.startsWith('/api/')){
      let raw='';for await(const x of req)raw+=x;
      const body=JSON.parse(raw||'{}');
      if(req.url==='/api/stu/bank/check'){
        checkCalls.push(body);
        if(holdCheck)await new Promise(resolve=>{delayedResolve=resolve;});
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify({code:0,data:{list:body.items.map(x=>({question_id:x.question_id,is_correct:x.my_answer==='C',answer:'C',analysis:'没有括号时，先乘除，后加减。'}))}}));
      }
      if(req.url==='/api/stu/bank/ai-explain/stream'){
        aiCalls.push(body);res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({t:'delta',text:'先看算式里有哪些运算。乘法和加法，应该先算哪一个？'})+'\n\n');
      }
      res.statusCode=500;return res.end('unexpected fixture API');
    }
    const file=path.join(root,'public',decodeURIComponent(req.url.split('?')[0]));
    if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end('missing');}
    res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.woff':'font/woff','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
});
test.after(async()=>{if(delayedResolve)delayedResolve();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function open(width=1487,height=1058,qs=questions){
  checkCalls=[];aiCalls=[];holdCheck=false;
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/fixture');
  await page.evaluate(qs=>{window.testDone=0;window.testSubmits=0;window.quizHandle=BankQuiz.open({mode:'step',title:'混合运算与数量关系',subtitle:'三年级数学 · 章节练习',questions:qs,submit:async answers=>{window.testSubmits++;return{total:answers.length,correct:answers.filter(x=>x.my_answer==='C').length,list:answers.map(x=>({question_id:x.question_id,my_answer:x.my_answer,answer:'C',is_correct:x.my_answer==='C',analysis:'没有括号时，先乘除，后加减。'}))};},onDone:()=>window.testDone++});},qs);
  return {page,errors};
}
async function choose(page,index){await page.locator('.qz-opt').nth(index).click();await page.locator('#qzCheckOne').click();await page.locator('.r8-judged').waitFor();}
async function bounds(page,selector){return page.locator(selector).boundingBox();}
test('desktop uses full viewport and a docked, gated AI panel without making an AI request',async()=>{
  const {page,errors}=await open();
  try{
    const frame=await bounds(page,'.quiz-box');assert.ok(frame.width>=1470,'workbench must occupy viewport width');assert.ok(frame.height>=1040,'workbench must occupy viewport height');
    const side=await bounds(page,'.r8-qz-side'),left=await bounds(page,'.r8-qz-left');assert.ok(side.width>360&&side.width<440,'answer sidebar should match approved rounded concept proportion');assert.ok(left.width>900);
    assert.equal(await page.locator('#qzAiDock .r8-ai').count(),1,'AI belongs inside sidebar, not independent floating popup');
    assert.match(await page.locator('#r8AiBody').innerText(),/先作答/);
    assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);assert.equal(aiCalls.length,0);
    const dotBox=await bounds(page,'#qzDots'), lastDot=await bounds(page,'.qz-dot:last-child');assert.ok(lastDot.y+lastDot.height<=dotBox.y+dotBox.height+1,'ten-question answer card must show its last row without clipping');
    assert.equal(await page.locator('.r8-fb').count(),0);assert.equal(await page.locator('.r8-right').count(),0);
    await page.screenshot({path:path.join(evidence,'quiz-unchecked-1487.png')});assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('checked state retains previous navigation, feedback labels and question-bound AI gating',async()=>{
  const {page,errors}=await open();
  try{
    await choose(page,2);await page.locator('#qzGoNext').click();await choose(page,2);await page.locator('#qzGoNext').click();await choose(page,0);
    assert.equal(await page.locator('#qzPrev').count(),1,'previous is available after checking a question');
    assert.match(await page.locator('.r8-wrong').innerText(),/你的选择/);assert.match(await page.locator('.r8-right').innerText(),/正确答案/);
    await page.locator('.r8-ai-modes [data-m="guide"]').click();await page.locator('#r8AiBody').getByText('先看算式里有哪些运算。乘法和加法，应该先算哪一个？').waitFor();
    assert.equal(aiCalls.length,1);assert.equal(aiCalls[0].question_id,9003);
    await page.screenshot({path:path.join(evidence,'quiz-checked-1487.png')});
    await page.locator('#qzPrev').click();assert.match(await page.locator('.qz-qno').innerText(),/第 2 题/);
    await page.locator('.qz-dot[data-i="3"]').click();assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);assert.match(await page.locator('#r8AiBody').innerText(),/先作答/);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('desktop close/minimize remains recoverable and follows the current question without an automatic request',async()=>{
  const {page,errors}=await open(1440,1000);
  try{
    await page.locator('.r8-ai [data-act="close"]').click();assert.equal(await page.locator('.r8-ai').isVisible(),false);assert.equal(await page.locator('.r8-ai-pill').isVisible(),true);
    await page.locator('.qz-dot[data-i="1"]').click();await page.locator('.r8-ai-pill').click();assert.equal(await page.locator('.r8-ai').isVisible(),true);assert.match(await page.locator('#r8AiQ').innerText(),/第 2 题/);assert.equal(aiCalls.length,0);
    await page.locator('.r8-ai [data-act="min"]').click();await page.locator('.qz-dot[data-i="2"]').click();await page.locator('.r8-ai-pill').click();assert.match(await page.locator('#r8AiQ').innerText(),/第 3 题/);
    await choose(page,0);await page.locator('.ui-quiz-answer-details summary').click();assert.match(await page.locator('.ui-quiz-answer-details').innerText(),/你的答案/);await page.locator('.ui-quiz-answer-details summary').click();
    await page.screenshot({path:path.join(evidence,'quiz-checked-1440.png')});assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('delayed checking remains bound to original question when navigating to another question',async()=>{
  const {page,errors}=await open();
  try{
    holdCheck=true;await page.locator('.qz-opt').nth(2).click();await page.locator('#qzCheckOne').click();
    await page.waitForFunction(()=>document.querySelector('#qzCheckOne').disabled);await page.locator('.qz-dot[data-i="1"]').click();
    while(!delayedResolve)await new Promise(resolve=>setTimeout(resolve,10));delayedResolve();delayedResolve=null;holdCheck=false;
    await page.waitForTimeout(100);assert.equal(await page.locator('.r8-judged').count(),0,'unanswered second question must not receive first question result');
    await page.locator('.qz-dot[data-i="0"]').click();assert.equal(await page.locator('.r8-right').count(),1);assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('390px keeps question controls reachable while AI drawer can open and close without moving header',async()=>{
  const {page,errors}=await open(390,844);
  try{
    const before=await bounds(page,'.r8-qz-h');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await choose(page,0);await page.locator('#qzAiFab').click();await page.locator('.r8-ai.show').waitFor();
    const ai=await bounds(page,'.r8-ai');assert.ok(ai.x>=0&&ai.x+ai.width<=391&&ai.y>=0,'mobile AI stays on screen');
    await page.locator('.r8-ai [data-act="close"]').click();
    const after=await bounds(page,'.r8-qz-h');assert.deepEqual(after,before);
    const next=await bounds(page,'#qzGoNext');assert.ok(next.y>=0&&next.y+next.height<=844,'next action remains in viewport');
    await page.screenshot({path:path.join(evidence,'quiz-checked-390.png')});assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('long ten-option questions scroll inside the question region and preserve submit control',async()=>{
  const long={id:9990,type:'multi',subject:'数学',stem:'请仔细阅读下列问题。'.repeat(25),options:Array.from({length:10},(_,i)=>'第 '+(i+1)+' 个选项 '+ '较长的内容与说明'.repeat(7))};
  const {page,errors}=await open(390,844,[long]);
  try{
    assert.equal(await page.locator('.qz-opt').count(),10);const b=await bounds(page,'#qzCheckOne');assert.ok(b.y+b.height<=844);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.locator('.qz-opt').last().scrollIntoViewIfNeeded();await page.locator('.qz-opt').last().click();assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('many questions keep the desktop AI dock and footer reachable',async()=>{
  const qs=Array.from({length:40},(_,i)=>({...questions[0],id:9500+i}));const {page,errors}=await open(1487,1058,qs);
  try{
    const dots=await bounds(page,'#qzDots'),ai=await bounds(page,'.r8-ai');assert.ok(dots.height<=200);assert.ok(ai.y+ai.height<=1058);
    await page.locator('.qz-dot').last().click();assert.match(await page.locator('.qz-qno').innerText(),/第 40 题/);assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('resizing a mobile attempt into desktop restores the locked AI dock',async()=>{
  const {page,errors}=await open(390,844);
  try{
    assert.equal(await page.locator('.r8-ai').count(),0);await page.setViewportSize({width:1487,height:1058});await page.locator('.r8-ai.show').waitFor();
    assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);assert.equal(aiCalls.length,0);assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('completion notifies once, redo clears checked answers and close destroys dock',async()=>{
  const {page,errors}=await open(1440,1000,questions.slice(0,1));
  try{
    await choose(page,2);await page.locator('#qzFinishCheck').click();await page.locator('#qzRedo').waitFor();
    assert.equal(await page.evaluate(()=>testSubmits),1);await page.locator('#qzRedo').click();assert.equal(await page.locator('.r8-judged').count(),0);
    await page.locator('.r8-ai-pill').click();assert.equal(await page.locator('.r8-ai').isVisible(),true);assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);
    await page.evaluate(()=>{quizHandle.close();quizHandle.close();});assert.equal(await page.evaluate(()=>testDone),1);assert.equal(await page.locator('.r8-ai').count(),0);assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

for (const width of [1487,1440]) test('desktop '+width+'px to mobile collapses AI and preserves accessible question controls',async()=>{
  const {page,errors}=await open(width,1058);
  try{
    await page.locator('.qz-opt').nth(1).click();
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.r8-ai').isVisible(),false,'desktop dock must not become an unrequested mobile overlay');
    assert.equal(await page.locator('.r8-ai-pill').isVisible(),true,'collapsed AI remains recoverable before checking');
    assert.equal(await page.locator('.qz-opt').nth(1).evaluate(el=>el.classList.contains('on')),true,'resize preserves selected answer');
    await page.locator('.qz-opt').nth(2).click({timeout:1500});
    await page.locator('#qzCheckOne').click({trial:true,timeout:1500});
    await page.screenshot({path:path.join(evidence,'quiz-resized-'+width+'-390.png')});
    await page.locator('.qz-dot[data-i="1"]').click();
    await page.locator('.r8-ai-pill').click();
    assert.match(await page.locator('#r8AiQ').innerText(),/第 2 题/);
    assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);
    assert.equal(aiCalls.length,0,'reopening locked AI does not request a service');
    await page.setViewportSize({width:390,height:720});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.r8-ai').isVisible(),true,'mobile height changes must not dismiss a deliberately opened drawer');
    await page.locator('.r8-ai [data-act="min"]').click();
    await page.locator('.r8-ai-pill').click();
    await page.locator('.r8-ai [data-act="close"]').click();
    assert.equal(await page.locator('.r8-ai').isVisible(),false);
    await page.locator('.qz-opt').nth(2).click({timeout:1500});
    await page.setViewportSize({width,height:1058});
    await page.locator('.r8-ai.show').waitFor();
    assert.equal(await page.locator('.r8-ai-in textarea').isDisabled(),true);
    assert.equal(aiCalls.length,0); assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('approved fill question keeps original input and numeric keypad usable',async()=>{
 const qs=Array.from({length:8},(_,i)=>({id:9800+i,type:'fill',subject:'数学',blanks:1,quiz_ticket:'synthetic-only',stem:'计算：(−3)² + 2 × (−4) =（ ）。'}));
 const {page,errors}=await open(1487,1058,qs);
 try{await page.locator('.quiz-h-t b').evaluate(e=>e.textContent='第一章 有理数 · 配套练习');await page.locator('.quiz-h-t span').evaluate(e=>e.textContent='数学 · 章节练习');await page.locator('.t6-input').click();await page.locator('#qzKpad').waitFor({state:'visible'});await page.locator('#qzKpad [data-k="1"]').click();assert.equal(await page.locator('.t6-input').inputValue(),'1');await page.locator('.t6-input').fill('');const input=await bounds(page,'.t6-input'),pad=await bounds(page,'#qzKpad');assert.ok(input.height<=80,'rounded single answer remains a concise field');assert.ok(pad.y-input.y-input.height<80,'keyboard follows the answer instead of leaving a large empty gap');await page.screenshot({path:path.join(evidence,'quiz-fill-1487.png')});for(const [width,height] of [[1366,768],[390,844]]){await page.setViewportSize({width,height});await page.waitForTimeout(250);const submit=await bounds(page,'#qzCheckOne');assert.ok(submit.y+submit.height<=height,'fill submit remains visible after resizing');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.locator('.t6-input').fill('1');await page.locator('#qzCheckOne').click({trial:true});await page.screenshot({path:path.join(evidence,'quiz-fill-'+width+'.png')});}assert.deepEqual(errors,[]);}finally{await page.close();}
});
