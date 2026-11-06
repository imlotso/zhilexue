'use strict';
// Astra follow-up: real local HTTP + Chromium submissions, no API stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const testDatabase = /audit|test|qa/i.test(process.env.MYSQL_DATABASE || '') || (process.env.GITHUB_ACTIONS === 'true' && process.env.MYSQL_DATABASE === 'xuexi');
if (!testDatabase || process.env.MYSQL_HOST !== '127.0.0.1' || process.env.STORAGE_DRIVER !== 'local' || process.env.AI_MOCK !== '1') throw Error('Requires isolated loopback test database, local storage and AI_MOCK=1');
const { db } = require('./src/db');
const { hash, sign } = require('./src/auth');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw Error('Loopback BASE only');
const OUT = process.env.ASTRA_OUTPUT || '/tmp/zhilexue-astra-retest';
fs.mkdirSync(OUT,{recursive:true});
const made={users:[],questions:[],papers:[]},results=[];
const tag='ASR2_'+Date.now();
let browser, admin, student;
const latex=String.raw`\frac{1}{2}+\sqrt{4}+x^{2}+a_{1}`;
function makeUser(role) {
  const username=tag+'_'+role;
  const id=Number(db.prepare('INSERT INTO users(role,username,password,name,grade,stage,term,status,expire_at,created_at) VALUES(?,?,?,?,?,?,?,1,?,?)').run(role,username,hash('synthetic-astra-only'),'QA Astra follow-up','七年级','junior','上册','2099-12-31',new Date().toISOString()).lastInsertRowid);
  made.users.push(id);const user={id,role,username,name:'QA Astra follow-up',grade:'七年级',stage:'junior',term:'上册'};return {user,token:sign(user)};
}
async function req(path,token,body) {
  const response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const j=await response.json();assert.equal(j.code,0,j.msg);return j.data;
}
async function createPaper(type,title,answer) {
  const q=await req('/api/admin/bank/mf/questions',admin.token,{type,stem:title+' 计算 \\(\\frac{1}{2}\\)',subject:'数学',stage:'junior',grade:'七年级',answer,options:type==='single'?[{label:'A',text:'1/4'},{label:'B',text:'1/2'},{label:'C',text:'3/4'}]:[]});
  made.questions.push(Number(q.id));
  const paper=await req('/api/admin/bank/papers',admin.token,{title,subject:'数学',stage:'junior',grade:'七年级',q_ids:[q.id],total_score:3,duration:5,status:'draft'});
  made.papers.push(Number(paper.id));await req(`/api/admin/bank/papers/${paper.id}/assign`,admin.token,{user_ids:[student.user.id]});
  return {qid:Number(q.id),pid:Number(paper.id)};
}
async function openPage(role) {
  const p=await browser.newPage({viewport:{width:1180,height:800},locale:'en-US'});p.setDefaultTimeout(8000);
  const info=role==='admin'?admin:student,prefix=role==='admin'?'xuexi_admin':'xuexi';
  await p.addInitScript(({info,prefix})=>{localStorage.setItem(prefix+'_token',info.token);localStorage.setItem(prefix+'_user',JSON.stringify(info.user));},{info,prefix});
  await p.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();return route.abort();});
  await p.goto(BASE+(role==='admin'?'/admin/#/intake-manual':'/#/papers'));
  if(role==='student')await p.locator('.bk-tabs [data-s="数学"]').click();
  return p;
}
async function test(name,fn) {
  if(process.env.ASTRA_CASE && !name.includes(process.env.ASTRA_CASE))return;
  let p;
  try{p=await openPage(name.startsWith('UI06')?'admin':'student');await fn(p);results.push({name,pass:true});console.log('PASS',name);}
  catch(e){results.push({name,pass:false,error:e.message});if(p)await p.screenshot({path:`${OUT}/${name}.png`,fullPage:true}).catch(()=>{});console.log('FAIL',name,e.message.split('\n')[0]);}
  finally{if(p)await p.close();}
}
async function submit(p) {await p.locator('#qzFinishCheck').click();await p.locator('#elcOk').click();await p.locator('#qzFinish').waitFor();}
(async()=>{
  admin=makeUser('admin');student=makeUser('student');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  await test('UI06-complete-localization',async p=>{
    for(const width of [1180,500]){
      await p.setViewportSize({width,height:800});
      for(let i=0;i<2;i++){
        await p.evaluate(()=>MLive.dialog({latex:'x^2'}));await p.locator('math-field').waitFor();
        await p.waitForFunction(()=>window.mathVirtualKeyboard && mathVirtualKeyboard.visible);
        await p.evaluate(()=>document.fonts.ready);
        const labels=await p.locator('math-field').evaluate(mf=>[mf.getAttribute('aria-label'),...['menu-toggle','virtual-keyboard-toggle'].map(part=>mf.shadowRoot.querySelector(`[part="${part}"] svg`).getAttribute('aria-label'))]);
        assert.deepEqual(labels,['公式输入框','公式菜单','切换虚拟键盘']);
        await p.locator('math-field').locator('[part=menu-toggle]').click();
        const menu=p.locator('[role=menu]').filter({visible:true}).first();await menu.waitFor();
        assert.doesNotMatch(await menu.innerText(),/\bInsert\b/);assert.match(await menu.innerText(),/插入/);
        await menu.getByText('插入',{exact:true}).hover();
        await p.locator('[role=menu]').filter({hasText:'绝对值'}).first().waitFor();
        const menuText=await p.locator('[role=menu]').allInnerTexts();assert.doesNotMatch(menuText.join(' '),/Absolute Value|Calculus|Complex Numbers|Derivative|Integral|Modulus/);
        await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.t8-mask') && !mathVirtualKeyboard.visible);
      }
    }
  });
  await test('UI07-new-subjective-real-submit',async p=>{
    const {qid,pid}=await createPaper('answer',tag+' subjective',`\\(${latex}\\)`);await p.reload();await p.locator('.bk-tabs [data-s="数学"]').click();
    let submits=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/stu/bank/submit'))submits++;});
    await p.locator(`[data-task="${pid}"]`).click();await p.locator('.t8-fbtn').click();await p.locator('math-field').waitFor();
    await p.locator('math-field').evaluate((mf,text)=>mf.setValue(text),latex);await p.locator('.t8-ok').click();
    const stored=await p.locator('.quiz-body textarea').inputValue();assert.match(stored,/\\frac/);
    await p.locator('#qzCheckOne').click();await p.waitForFunction(()=>document.querySelector('.qz-jb-r mjx-container'));
    assert.match(await p.locator('.r8-fb-tag').innerText(),/不自动判分/);
    await submit(p);await p.waitForFunction(()=>document.querySelector('.qz-rrow.my mjx-container'));assert.doesNotMatch(await p.locator('.qz-rrow.my').innerText(),/\\frac/);
    await p.locator('#qzFinish').click();await p.locator('.r4-subjective-item').filter({hasText:tag}).waitFor();
    const row=db.prepare('SELECT my_answer,score FROM subjective_responses WHERE user_id=? AND question_id=?').get(student.user.id,qid);
    assert.equal(row.my_answer,stored);assert.equal(row.score,null);assert.equal(submits,1);
    const item=p.locator('.r4-subjective-item').filter({hasText:tag});await item.locator('summary').click();await item.locator('p mjx-container').waitFor();assert.match(await item.innerText(),/待老师评分/);
  });
  await test('UI09-wrong-answer-close-real-submit',async p=>{
    const {pid}=await createPaper('single',tag+' wrong close','C');await p.reload();await p.locator('.bk-tabs [data-s="数学"]').click();
    const task=p.locator(`[data-task="${pid}"]`);assert.match(await task.innerText(),/未完成/);
    let submits=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/stu/bank/submit'))submits++;});
    await task.click();await p.locator('.qz-opt[data-i="0"]').click();await p.locator('#qzCheckOne').click();assert.match(await p.locator('.r8-fb-tag').innerText(),/答错/);
    await submit(p);assert.match(await p.locator('.qz-rrow.my').innerText(),/A/);await p.locator('#qzClose').click();
    await p.waitForFunction(pid=>document.querySelector(`[data-task="${pid}"]`)?.textContent.includes('重做'),pid);
    const before=await task.innerText();assert.match(before,/0/);assert.doesNotMatch(before,/未完成/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM paper_tries WHERE user_id=? AND paper_id=?').get(student.user.id,pid).n,1);assert.equal(submits,1);
    await p.reload();await p.locator('.bk-tabs [data-s="数学"]').click();assert.equal(await task.innerText(),before);assert.equal(submits,1);
  });
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  for(const id of made.users){for(const t of ['subjective_responses','paper_tries','paper_assignments','records','mistakes','practices'])db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id);db.prepare('DELETE FROM users WHERE id=?').run(id);}
  for(const id of made.papers)db.prepare('DELETE FROM papers WHERE id=?').run(id);
  for(const id of made.questions){for(const t of ['question_tags','question_nodes'])db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id);db.prepare('DELETE FROM questions WHERE id=?').run(id);}
  fs.writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(`${results.filter(x=>x.pass).length}/${results.length} passed`);process.exit(process.exitCode||results.some(x=>!x.pass)?1:0);
});
