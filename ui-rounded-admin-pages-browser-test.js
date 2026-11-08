'use strict';
// Offline browser integration: production renderers and actions, synthetic API boundaries.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {test}=require('node:test'),{chromium}=require('playwright');
const {buildFixture}=require('./ui-review-concept-test');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const extra = [
"const MF_API='/api/admin/bank/mf', MF_TYPES=[['single','单选题'],['fill','填空题']];",
"const tpEditions=(trees,ctx)=>[...new Set(trees.filter(t=>t.kind===ctx.kind&&t.subject===ctx.subject&&t.stage===ctx.stage).map(t=>t.edition))]; const tpDefaultEdition=()=>'';",
"const pickTree=(trees,ctx)=>trees.find(t=>t.kind===ctx.kind&&t.subject===ctx.subject&&t.stage===ctx.stage);",
"const R4Flow={bind(){},prepare(){},send(){throw Error('fixture forbids uploads')}};",
"function viewMistakeLog(){return {html:'<div>合成错题记录</div>'}}",
read('public/admin/qbasket.js'),read('public/admin/treepanel.js'),read('public/admin/qcard.js'),
read('public/admin/r6-compose.js'),read('public/admin/intake-center.js'),read('public/admin/reportui.js'),
"window.fixtureView=async function(name){ r1Close(); location.hash='#/'+({compose:'paper',intake:'intake',word:'intake-word',report:'xreport'}[name]||'pending'); XREP_TAB='e'; if(name==='report')location.hash='#/xreport?tab=e'; const out=await ({compose:viewPaperR6,intake:viewIntakeCenter,word:()=>viewIntakeExcel('word'),report:viewXReport}[name]()); $app.innerHTML=shell(out.html);bindShell();out.after();r10Enhance(document.getElementById('view'));window.fixtureCurrent=name; }; render=()=>window.fixtureView(window.fixtureCurrent||'intake');"
].join('\n');
const apiExtra = [
"if(url==='/api/admin/branches')return [];",
"if(url.includes('/intake/runs'))return {list:[]};",
"if(url.includes('/word/progress'))return {list:[],modules:[]};",
"if(url.includes('/xreport/videos'))return {list:[]};",
"if(url.includes('/xreport/exercises/1/detail'))return {student:{id:1,name:'合成学生',username:'fixture',grade:'七年级',stage:'junior'},subjects:[{subject:'数学',n:0,correct:0}],wrong_open:0,mastered:0,papers:[],rows:[],subjective:window.fixtureSubjectiveOnly?[{id:11,question_subtype:'calculation',subject:'数学',stem:'计算题',my_answer:'1',score:null}]:[]};",
"if(url.includes('/xreport/exercises?'))return {list:[{id:1,name:'合成学生',username:'fixture',grade:'七年级',rate:null,answered:0,paper_avg:null,paper_best:null,status:1}]};",
"if(url.includes('/bank/accuracy?'))return {acc:{total:5,answered:0,correct:0,rate:null},courses:[{id:1,name:'第一章 有理数',subject:'数学',grade:'七年级',acc:{total:5,answered:0,rate:null},groups:[{id:1,name:'有理数的认识',acc:{total:5,answered:0,rate:null},own_acc:{total:2,answered:0,rate:null},videos:[{id:1,title:'有理数的概念',acc:{total:3,answered:0,rate:null}}]}]}]};",
"if(url.includes('/questions?'))return {list:[{id:101,type:'single',subject:'数学',stage:'junior',stem:'下面各数中，属于负数的是（    ）。',options:['3','−2','0'],answer:'B',analysis:'小于零的数是负数。',chapters:[],knows:[],images:[]},{id:102,type:'fill',subject:'数学',stage:'junior',stem:'计算：（−3）² + 2 ×（−4） = （    ）。',answer:'1',analysis:'先算乘方，再算乘法，最后相加。',chapters:[],knows:[],images:[]}],total:2,page:1};",
"if(url.includes('/questions/101'))return {question:{id:101,type:'single',subject:'数学',stage:'junior',stem:'负数的概念',answer:'B'}};",
"if(url.includes('/questions/102'))return {question:{id:102,type:'fill',subject:'数学',stage:'junior',stem:'有理数的运算',answer:'1'}};",
"if(url.includes('/trees/')&&url.endsWith('/nodes'))return {list:[{id:1,parent_id:0,name:'第一章 有理数',qcount:2},{id:2,parent_id:1,name:'有理数的概念',qcount:1},{id:3,parent_id:1,name:'有理数的运算',qcount:1}]};"
].join('\n');
function fixture(){
 let html=buildFixture().replace('async function api(url, options={}) {','async function api(url, options={}) {'+apiExtra)
 .replace('const tpTrees=async()=>[];', "const tpTrees=async()=>[{id:1,kind:'textbook',subject:'数学',stage:'primary',edition:'人教版'}];");
 html=html.replace('</body>','<script>'+extra.replace(/<\/script/gi,'<\\/script')+'</script></body>');
 return html.replaceAll('/img/ui-rounded-word-20261108.png','data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'public/img/ui-rounded-word-20261108.png')).toString('base64'));
}
test('rounded admin pages: responsive layout, real navigation, basket, upload steps, report detail and dismissal',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const out=path.join(__dirname,'docs/ui-evidence-20261108/rounded-admin-pages');fs.mkdirSync(out,{recursive:true});
 try{
 for(const width of [1487,1440,820,390]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:1058},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.abort());await page.setContent(fixture());await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>fixtureView('intake'));
 await page.waitForFunction(()=>document.querySelector('.r4-document-art').naturalWidth>500);
 await page.evaluate(()=>{window.scrollTo(0,0);const list=document.getElementById('r6-results');if(list)list.scrollTop=0;});await page.screenshot({path:path.join(out,'intake-'+width+'.png'),fullPage:true});await page.screenshot({path:path.join(out,'intake-viewport-'+width+'.png')});
 assert.equal(await page.locator('[data-intake]').count(),8);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'intake does not overflow');
 await page.locator('[data-intake="word"]').click();assert.equal(await page.evaluate(()=>location.hash),'#/intake-word');
 await page.evaluate(()=>fixtureView('word'));await page.locator('#rxNext').click();
 assert.equal(await page.locator('#rxUpload').isVisible(),true);assert.equal(await page.locator('#rxNext').isDisabled(),true);
 await page.locator('#rxPrevious').click();assert.equal(await page.locator('#rxPrepare').isVisible(),true);
 await page.evaluate(()=>fixtureView('compose'));await page.waitForSelector('[data-r6add]');
 await page.locator('[data-r6add="101"]').click();
 assert.match(await page.locator('#r6-basket-preview').innerText(),/1 题/);
 assert.equal(await page.locator('[data-r6add="101"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-r6add="102"]').click();assert.match(await page.locator('#r6-basket-preview').innerText(),/2 题/);
 await page.evaluate(()=>{window.scrollTo(0,0);const list=document.getElementById('r6-results');if(list)list.scrollTop=0;});await page.screenshot({path:path.join(out,'compose-'+width+'.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'compose does not overflow');
 await page.locator('[data-basket-open]').click();await page.waitForSelector('#r6-title');
 await page.locator('[data-remove="101"]').click();
 await page.locator('#mCancel').click();
 assert.equal(await page.locator('.mask').count(),0);
 assert.match(await page.locator('#r6-basket-preview').innerText(),/1 题/);
 assert.equal(await page.locator('[data-r6add="101"]').getAttribute('aria-pressed'),'false');
 assert.match(await page.locator('[data-r6add="101"]').innerText(),/加入试题篮/);
 await page.evaluate(()=>fixtureView('report'));
 await page.evaluate(()=>{window.scrollTo(0,0);const list=document.getElementById('r6-results');if(list)list.scrollTop=0;});await page.screenshot({path:path.join(out,'report-'+width+'.png'),fullPage:true});
 assert.match(await page.locator('.r1-student-cards').innerText(),/暂无可统计作答/);
 await page.locator('.r1-student-card [data-edetail]').click();await page.waitForSelector('.r1-feedback');
 assert.match(await page.locator('.r1-feedback').innerText(),/不代表正确率为 0%/);
 await page.evaluate(()=>{window.scrollTo(0,0);const list=document.getElementById('r6-results');if(list)list.scrollTop=0;});await page.screenshot({path:path.join(out,'report-detail-'+width+'.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'report does not overflow');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.r1-mask').count(),0);
 await page.evaluate(()=>{window.fixtureSubjectiveOnly=true;return fixtureView('report')});
 await page.locator('.r1-student-card [data-edetail]').click();await page.waitForSelector('.r1-feedback');
 assert.match(await page.locator('.r1-feedback h3').innerText(),/已有作答，等待人工评分/);
 assert.doesNotMatch(await page.locator('.r1-feedback').innerText(),/完成练习后生成报告/);
 assert.match(await page.locator('.r1-feedback').innerText(),/待人工评分/);
 await page.screenshot({path:path.join(out,'report-subjective-pending-'+width+'.png'),fullPage:true});
 await page.locator('.r1-x').click();assert.equal(await page.locator('.r1-mask').count(),0);
 assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser.close();}
});
module.exports={fixture};
