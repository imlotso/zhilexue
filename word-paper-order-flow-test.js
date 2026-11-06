'use strict';
// Synthetic Word only; isolate the test database. Never publish or accept into the question bank.
const assert = require('assert');
const fs = require('fs');
const { Document, Packer, Paragraph } = require('docx');
const { db } = require('./src/db');
const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
const unique = Date.now().toString(36);
let paperId = 0, runId = 0;
const createdQuestions = [];
async function api(p, method, token, body) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return res.json();
}
async function form(bytes, dryRun) {
  const f = new FormData(); f.append('file', new Blob([bytes]), '合成原序.docx');
  for (const [k, v] of Object.entries({title:'原序合成测试' + unique, subject:'数学', stage:'junior', ...(dryRun ? {dry_run:1} : {})})) f.append(k, String(v));
  return f;
}
(async () => {
  try {
    const login = await api('/api/login', 'POST', '', {username:'15152099970',password:'123456',role:'admin'});
    assert.strictEqual(login.code, 0, login.msg); const admin = login.data.token;
    const paras = ['单选题','1. 明确单选' + unique,'A. 甲','B. 乙','答案：A', '选择题','2. 未明确单双选' + unique,'A. 甲','B. 乙', '多选题','3. 明确多选' + unique,'A. 甲','B. 乙','答案：AB', '填空题','4. 有____空' + unique,'答案：x', '单选题','5. 最后单选' + unique,'A. 甲','B. 乙','答案：A'];
    const bytes = await Packer.toBuffer(new Document({sections:[{children:paras.map(text => new Paragraph(text))}]}));
    const expected = ['一、单选题','二、待核对选择题','三、多选题','四、填空题','五、单选题'];
    const dry = await api(MF + '/papers/import-word','POST',admin,await form(bytes,true));
    assert.strictEqual(dry.code,0,dry.msg);assert.strictEqual(dry.data.total,5);assert.deepStrictEqual(dry.data.sections.map(x=>x.name),expected);
    const imported = await api(MF + '/papers/import-word','POST',admin,await form(bytes,false));
    assert.strictEqual(imported.code,0,imported.msg);paperId=imported.data.paper_id;runId=imported.data.run_id;
    let rows=db.prepare('SELECT * FROM mf_paper_questions WHERE paper_id=? ORDER BY position,id').all(paperId);
    assert.deepStrictEqual(rows.filter(r=>r.kind==='text').map(r=>r.text_body),expected);
    const run=db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(runId);const cards=JSON.parse(run.drafts);
    assert.deepStrictEqual(cards.map(c=>c.qno),['1','2','3','4','5']);assert.deepStrictEqual(cards.map(c=>c._paper_position),[2,4,6,8,10]);
    assert.strictEqual(cards[1].type_unconfirmed,true);assert.strictEqual(cards[1].answer,'');
    const list=await api(MF+'/ext/pending?source=paper&size=100&batch_id='+runId,'GET',admin);assert.strictEqual(list.code,0,list.msg);
    const unknown=list.data.list.find(q=>q.qno==='2');assert(unknown&&unknown.type_unconfirmed&&unknown.answer==='');
    const blocked=await api(MF+'/ext/pending/commit','POST',admin,{ids:[unknown.id],subject:'数学',stage:'junior'});
    if(blocked.data?.question_ids)createdQuestions.push(...blocked.data.question_ids);
    assert.notStrictEqual(blocked.code,0);assert(/题型待/.test(blocked.msg));
    const checked=await api(MF+'/ext/pending/item','PUT',admin,{id:unknown.id,patch:{type:'multi',type_confirmed:true}});assert.strictEqual(checked.code,0,checked.msg);
    assert.strictEqual(checked.data.type,'multi');assert.strictEqual(checked.data.type_unconfirmed,false);assert.strictEqual(checked.data.answer,'');
    rows=db.prepare('SELECT * FROM mf_paper_questions WHERE paper_id=? ORDER BY position,id').all(paperId);
    const heading=rows.find(r=>r.text_body==='二、待核对选择题');assert(heading);
    const empty=await api(`${MF}/papers/${paperId}/rows/${heading.id}`,'PUT',admin,{text_body:'   '});assert.notStrictEqual(empty.code,0);assert(/不能为空/.test(empty.msg));
    const unchanged=db.prepare('SELECT * FROM mf_paper_questions WHERE id=?').get(heading.id);assert.strictEqual(unchanged.text_body,heading.text_body);
    const edited=await api(`${MF}/papers/${paperId}/rows/${heading.id}`,'PUT',admin,{text_body:'二、多选题（老师核对）'});assert.strictEqual(edited.code,0,edited.msg);
    const saved=db.prepare('SELECT * FROM mf_paper_questions WHERE id=?').get(heading.id);assert.strictEqual(saved.text_body,'二、多选题（老师核对）');
    assert.strictEqual(saved.position,heading.position);assert.strictEqual(saved.style,heading.style);assert.strictEqual(saved.text_align,heading.text_align);
    // Optional local browser check: CI may not have Playwright or Chromium installed.
    let chromium;try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}catch(__){}}
    if(chromium&&fs.existsSync('/usr/bin/chromium')) {
      const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
      try {
        const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(BASE+'/admin/',{waitUntil:'domcontentloaded'});await page.locator('input[type=text],input:not([type])').first().fill('15152099970');await page.locator('input[type=password]').first().fill('123456');await page.keyboard.press('Enter');
        await page.waitForSelector('.admin-app',{timeout:15000});await page.goto(BASE+'/admin/#/mfp',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof mfPaperDetail==='function');
        await page.evaluate(id=>mfPaperDetail(id),paperId);await page.waitForSelector(`[data-edit-text="${heading.id}"]`,{timeout:15000});await page.locator(`[data-edit-text="${heading.id}"]`).click();
        const dialog=page.locator('.mask').last();await dialog.locator('#ptEditBody').fill('   ');await dialog.locator('#mOk').click();await dialog.getByText('文本块内容不能为空').waitFor();
        await dialog.locator('#ptEditBody').fill('二、老师编辑标题');await dialog.locator('#mOk').click();await page.locator('#ptEditBody').waitFor({state:'detached'});await page.getByText('二、老师编辑标题',{exact:false}).waitFor();assert.deepStrictEqual(errors,[]);
        const fromUi=db.prepare('SELECT * FROM mf_paper_questions WHERE id=?').get(heading.id);assert.strictEqual(fromUi.text_body,'二、老师编辑标题');assert.strictEqual(fromUi.position,heading.position);assert.strictEqual(fromUi.style,heading.style);assert.strictEqual(fromUi.text_align,heading.text_align);
        console.log('浏览器：文本块编辑、空标题提示、原位置和样式保留通过');
      } finally { await browser.close(); }
    } else console.log('浏览器未安装，跳过文本块界面检查');
    console.log('Word 未确认题型中性标题、原题序、审核阻断和文本块编辑接口通过');
  } finally {
    if(runId)db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(runId);
    if(paperId){db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(paperId);db.prepare('DELETE FROM mf_papers WHERE id=?').run(paperId);}
    for(const id of createdQuestions)db.prepare('DELETE FROM questions WHERE id=?').run(id);
  }
})().catch(e=>{console.error(e);process.exitCode=1});
