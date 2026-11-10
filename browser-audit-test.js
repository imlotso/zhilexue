'use strict';
// Synthetic browser regressions for the 2026-11-06 audit. Never run on production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { Document, Packer, Paragraph } = require('docx');
const testDatabase = /audit|test|qa/i.test(process.env.MYSQL_DATABASE || '') || (process.env.GITHUB_ACTIONS === 'true' && process.env.MYSQL_DATABASE === 'xuexi');
if (!testDatabase || process.env.MYSQL_HOST !== '127.0.0.1' || process.env.STORAGE_DRIVER !== 'local' || process.env.AI_MOCK !== '1') throw Error('Requires isolated loopback test database, local storage and AI_MOCK=1');
const { db } = require('./src/db');
const { hash, sign } = require('./src/auth');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw Error('Loopback BASE only');
const out = process.env.AUDIT_OUTPUT || '/tmp/zhilexue-browser-audit';
fs.mkdirSync(out, { recursive: true });
const results = [];
const created = [];
const createdRuns = new Set(), responseJobs = [];
let bookId;
function user(role) {
  const username = `audit_${role}_${Date.now()}`;
  const id = Number(db.prepare('INSERT INTO users(role,username,password,name,grade,status,created_at) VALUES(?,?,?,?,?,1,?)').run(role, username, hash('synthetic-audit-only'), 'QA browser audit', '四年级', new Date().toISOString()).lastInsertRowid);
  created.push(id);
  const u = { id, role, username, name: 'QA browser audit', grade: '四年级' };
  return { user: u, token: sign(u) };
}
let browser, admin, student;
async function pageFor(who, route = '') {
  const p = await browser.newPage({ viewport: { width: 1180, height: 800 }, locale: 'en-US' });
  p.setDefaultTimeout(6000);
  p.on('response', r => { if (r.request().method() === 'POST' && /\/ext\/(?:import-word|pending\/manual(?:-group)?)$/.test(r.url())) responseJobs.push(r.json().then(j => { const id=Number(j.data && (j.data.run_id || j.data.id)); if(j.code===0 && id) createdRuns.add(id); }).catch(()=>{})); });
  const a = who === 'admin' ? admin : student;
  const prefix = who === 'admin' ? 'xuexi_admin' : 'xuexi';
  await p.addInitScript(({ prefix, a }) => { localStorage.setItem(prefix + '_token', a.token); localStorage.setItem(prefix + '_user', JSON.stringify(a.user)); }, { prefix, a });
  if (process.env.AUDIT_BASELINE === '1') {
    const { execFileSync } = require('node:child_process');
    for (const file of ['public/js/words.js', 'public/js/bank.js', 'public/js/mathlib.js']) await p.route('**/' + file.replace('public/', '') + '*', r => r.fulfill({ contentType:'application/javascript', body:execFileSync('git',['show','5eeb542:' + file],{encoding:'utf8'}) }));
  }
  await p.goto(BASE + (who === 'admin' ? '/admin/' : '/') + route);
  await p.waitForFunction(() => typeof api === 'function');
  return p;
}
async function test(name, work) {
  if (process.env.AUDIT_CASE && !name.includes(process.env.AUDIT_CASE)) return;
  let p;
  try { await work(async (...args) => (p = await pageFor(...args))); if (process.env.AUDIT_SCREENSHOTS === '1' && p) await p.screenshot({path:`${out}/${name}.png`,fullPage:true}); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { if (p) await p.screenshot({ path: `${out}/${name.replace(/[^a-z0-9-]/ig, '_')}.png`, fullPage: true }).catch(() => {}); results.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message.split('\n')[0]); }
  finally { if (p) await p.close(); }
}
async function mathIn(p, sel, count = 1) { await p.waitForFunction(({ sel, count }) => document.querySelectorAll(sel + ' mjx-container').length >= count, { sel, count }, { timeout: 5000 }); }
const frac = String.raw`\frac{1}{2}+\sqrt{x_1^2}`;
(async () => {
  admin = user('admin'); student = user('student');
  bookId = Number(db.prepare('INSERT INTO word_books(title,grade,kind,created_at) VALUES(?,?,?,?)').run('QA audit words', '四年级', 'word', new Date().toISOString()).lastInsertRowid);
  for (let i=0;i<10;i++) db.prepare('INSERT INTO words(book_id,unit,word,meaning,example,created_at) VALUES(?,?,?,?,?,?)').run(bookId, 'Unit 1', i ? 'hello' + i : 'characteristically', '合成释义'.repeat(i ? 1 : 15), 'A synthetic example. '.repeat(i ? 1 : 15), new Date().toISOString());
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  await test('UI01-login', async (open) => {
    const p = await open('admin', '#/login');
    await p.evaluate(() => { Auth.clear(); location.hash = '#/login'; return render(); });
    await p.locator('#loginForm').waitFor();
    await p.locator('#loginBtn').click();
    assert.match(await p.locator('#loginErr').innerText(), /账号/);
    await p.locator('[name=username]').fill('QA'); await p.locator('#loginBtn').click();
    assert.match(await p.locator('#loginErr').innerText(), /密码/);
    assert.equal(await p.locator('.lg2-back').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
  });
  await test('D01-empty-scope-access', async (open) => {
    const p = await open('admin', '#/mfq'); await p.locator('.r3-cas-btn').waitFor();
    await p.locator('.r3-cas-btn').click(); await p.locator('[data-cs=junior]').click();
    assert.equal(await p.locator('[data-cj="物理"]').count(), 1);
    assert.equal(await p.locator('[data-cj="化学"]').count(), 1);
    await p.locator('[data-cj="物理"]').click();
    assert.match(await p.locator('.r3-cas-btn').innerText(), /物理/);
    assert.equal(await p.locator('.r3-sel-chip').count(), 0);
  });
  await test('UI05-manual-width', async (open) => {
    const p = await open('admin', '#/intake-manual'); await p.locator('#r4m-next').click();
    for (const width of [1180, 800, 500]) {
      await p.setViewportSize({ width, height: 800 });
      await p.locator('[data-question-stem]').fill('QA ' + 'longtext'.repeat(100));
      const box = await p.locator('#r4m-next').boundingBox();
      const dims = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert.ok(dims[0] <= dims[1] + 1, `${width}: page overflow ${dims}`);
      assert.ok(box.x + box.width <= width, `${width}: next button clipped`);
    }
    await p.setViewportSize({width:1180,height:800});
    for (let i=0;i<2;i++) {
      await p.locator('#btnFold').click();
      const dims=await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth,document.getElementById('r4m-next').getBoundingClientRect().right]);
      assert.ok(dims[0]<=dims[1]+1 && dims[2]<=dims[1],'folded/expanded navigation keeps footer inside page');
    }
  });
  await test('UI07-manual-summary', async (open) => {
    const p = await open('admin', '#/intake-manual'); await p.locator('#r4m-next').click();
    await p.locator('[data-question-stem]').fill(`QA \\(${frac}\\) <img src=x onerror=alert(1)>`);
    await p.locator('[data-question-options]').fill('1\n2');
    await p.locator('#r4m-next').click(); await mathIn(p, '#r4m-summary');
    assert.equal(await p.locator('#r4m-summary img').count(), 0);
    assert.match(await p.locator('[data-question-stem]').inputValue(), /frac/);
  });
  await test('UI07-paper-preview', async (open) => {
    const p = await open('admin', '#/paper'); await p.waitForFunction(() => typeof bkPaperPreview === 'function');
    await p.evaluate((f) => bkPaperPreview({ id: 0, title: 'QA formula', subject: '数学', questions: [{ id: 1, type: 'single', stem: `求 \\(${f}\\)`, options: ['1','2'], answer: 'A', analysis: `解 \\(${f}\\)` }], total_score: 1, duration: 1 }), frac);
    await mathIn(p, '#ppPrevBody'); await p.locator('#ppAnsToggle').click(); await mathIn(p, '#ppPrevBody', 2);
    await p.locator('#ppAnsToggle').click(); await mathIn(p, '#ppPrevBody');
    assert.doesNotMatch(await p.locator('#ppPrevBody').innerText(), /答案：/);
  });
  await test('UI06-formula-keyboard', async (open) => {
    const p = await open('admin', '#/intake-manual');
    await p.evaluate(() => MLive.dialog({ latex: '\\frac{1}{2}' })); await p.locator('math-field').waitFor();
    await p.waitForFunction(() => window.mathVirtualKeyboard && mathVirtualKeyboard.visible, null, {timeout:6000});
    assert.match(await p.evaluate(() => String(customElements.get('math-field').locale)), /^zh/);
    const visible = await p.evaluate(() => { const el = document.querySelector('.MLK__plate'); if (!el) return false; const r=el.getBoundingClientRect(); return r.height > 80 && r.top < innerHeight && el.contains(document.elementFromPoint(r.left+r.width/2,r.top+30)); });
    assert.ok(visible, 'keyboard must be above dialog and clickable');
    for (const width of [1180,500]) {
      await p.setViewportSize({width,height:800});
      const dims=await p.evaluate(()=>({dialog:document.querySelector('.t8-dlg').getBoundingClientRect().width,keyboard:document.querySelector('.MLK__plate').getBoundingClientRect().width}));
      assert.ok(dims.dialog>=Math.min(560,width-28)-2,`${width}: keyboard shrinks dialog ${JSON.stringify(dims)}`);
      assert.ok(dims.keyboard>=width-30,`${width}: keyboard must use screen width`);
    }
    const before=await p.locator('math-field').evaluate(el=>el.getValue());
    await p.locator('.MLK__keycap[aria-label="7"]:visible').first().click();
    assert.notEqual(await p.locator('math-field').evaluate(el=>el.getValue()),before,'screen keyboard inserts into formula');
  });
  await test('UI07-UI10-subjective', async (open) => {
    const p = await open('student');
    await p.route('**/api/stu/bank/subjective-responses', route => route.fulfill({ json: { code: 0, data: { list: [{ id: 1, subject: '数学', stem: `QA \\(${frac}\\)`, my_answer: frac, score: 100, max_score: 100, review_comment: 'QA good', reviewed_at: '2026-11-06' }] } } }));
    await p.evaluate(() => { document.body.insertAdjacentHTML('beforeend','<div id="auditHost"></div>'); return BankPages.papers(document.getElementById('auditHost'), '数学'); });
    await p.locator('.r4-subjective-item summary').click(); await mathIn(p, '.r4-subjective-item', 2);
    const colors = await p.locator('.r4-subjective-item p').first().evaluate(el => [getComputedStyle(el).color, getComputedStyle(el.closest('.pk-lib')).backgroundColor]);
    const lum = c => c.match(/[\d.]+/g).slice(0,3).map(Number).map(x => (x/=255)<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
    const [a,b] = colors.map(lum); assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5, `low contrast ${colors}`);
    await p.evaluate(() => document.body.dataset.theme='night');
    const dark = await p.locator('.r4-subjective-item').evaluate(el => getComputedStyle(el).color); assert.notEqual(dark, colors[0]);
  });
  await test('UI07-quiz-feedback-report', async (open) => {
    const p = await open('student');
    await p.route('**/api/stu/bank/check', r => r.fulfill({json:{code:0,data:{list:[{question_id:1,ungraded:true,answer:'3',analysis:'QA'}]}}}));
    await p.evaluate(f => BankQuiz.open({ mode:'step', title:'QA audit formula', questions:[{id:1,type:'answer',subject:'数学',stem:'QA formula'}], submit:async answers=>({total:1,correct:0,ungraded_count:1,list:[{question_id:1,ungraded:true,my_answer:answers[0].my_answer,answer:'3'}]}) }), frac);
    await p.locator('.quiz-body textarea').fill(frac);
    await p.locator('#qzCheckOne').click(); await mathIn(p,'.qz-jb-r');
    await p.locator('#qzFinishCheck').click(); await mathIn(p,'.qz-rrow.my');
    assert.doesNotMatch(await p.locator('.qz-rrow.my').innerText(), /frac/);
    await p.locator('#qzFinish').click();
  });
  await test('UI07-answer-escaping', async (open) => {
    const p = await open('student');
    const result = await p.evaluate(f => { const div=document.createElement('div'); div.id='auditMath'; document.body.appendChild(div); const values=[f, '混排 \\(x^2+\\sqrt{2}\\) 与文字', '<img src=x onerror=alert(1)>', 'plain answer']; div.innerHTML=values.map(x=>`<p>${mtxAnswerHTML(x)}</p>`).join(''); mtxTypeset(div); return {images:div.querySelectorAll('img').length,text:div.textContent}; },frac);
    assert.equal(result.images,0); assert.match(result.text, /<img/); await mathIn(p,'#auditMath',2);
  });
  await test('UI07-script-only-answers', async (open) => {
    const p = await open('student');
    await p.evaluate(() => { const div=document.createElement('div'); div.id='auditScripts'; document.body.appendChild(div); div.innerHTML=['x^2','x_1','2^{3}'].map(x=>`<p>${mtxAnswerHTML(x,'数学')}</p>`).join('') + `<p id="auditEnglish">${mtxAnswerHTML('ice_cream','英语')}</p>`; mtxTypeset(div); });
    await mathIn(p,'#auditScripts',3); assert.equal(await p.locator('#auditEnglish').innerText(),'ice_cream');
  });
  await test('UI09-report-exits', async (open) => {
    const p=await open('student');
    await p.route('**/api/stu/bank/check',r=>r.fulfill({json:{code:0,data:{list:[{question_id:1,ungraded:true,answer:'QA'}]}}}));
    for (const action of ['close','finish','api']) {
      await p.evaluate(() => { window.auditDone=0; window.auditSubmits=0; window.auditHandle=BankQuiz.open({mode:'step',questions:[{id:1,subject:'数学',type:'answer',stem:'QA'}],submit:async()=>{window.auditSubmits++;return {total:1,correct:0,list:[{question_id:1,ungraded:true,my_answer:'QA'}]};},onDone:()=>window.auditDone++}); });
      await p.locator('.quiz-body textarea').fill('QA'); await p.locator('#qzCheckOne').click(); await p.locator('#qzFinishCheck').click(); await p.locator('#qzFinish').waitFor();
      if(action==='api') await p.evaluate(()=>{auditHandle.close();auditHandle.close();}); else await p.locator(action==='close'?'#qzClose':'#qzFinish').click();
      assert.deepEqual(await p.evaluate(()=>[auditDone,auditSubmits]),[1,1],action);
    }
    await p.evaluate(()=>{window.auditDone=0;BankQuiz.open({questions:[{id:1,type:'answer',stem:'QA abandoned'}],onDone:()=>window.auditDone++});}); await p.locator('#qzClose').click(); assert.equal(await p.evaluate(()=>auditDone),0);
  });
  await test('UI11-review-navigation-state', async (open) => {
    const p = await open('admin', '#/pending');
    const state=await p.evaluate(() => { ADM.page.pd={source:'excel',batch_id:99,kw:'stale',review:'no_answer',mode:'batches',active:'old',sel:{old:true},mergePins:[{id:'old'}]}; pdSelectBatch('manual',7); return ADM.page.pd; });
    assert.deepEqual([state.source,state.batch_id,state.kw,state.review,state.mode,state.active,Object.keys(state.sel).length,state.mergePins.length],['manual',7,'','all','questions','',0,0]);
  });
  await test('UI11-capture-navigation', async (open) => {
    const p = await open('admin', '#/mfc'); await p.locator('#capReviewAll').waitFor();
    await p.evaluate(() => { ADM.page.pd={source:'excel',batch_id:99,kw:'stale',review:'no_answer',mode:'batches',sel:{old:true},mergePins:[{id:'old'}]}; });
    await p.locator('#capReviewAll').click(); await p.locator('#pd-batches').waitFor();
    const state = await p.evaluate(() => ADM.page.pd);
    assert.deepEqual([state.source,state.mode,state.batch_id,state.mergePins.length],['capture','questions',0,0]);
  });
  await test('UI11-manual-submit', async (open) => {
    const p = await open('admin', '#/intake-manual');
    await p.evaluate(() => { ADM.page.pd={source:'excel',batch_id:99,kw:'stale',review:'no_answer',mode:'batches',sel:{old:true}}; });
    await p.locator('#r4m-next').click(); await p.locator('[data-question-stem]').fill('QA audit manual new batch');
    await p.locator('[data-question-options]').fill('1\n2'); await p.locator('#r4m-next').click(); await p.locator('#r4m-next').click();
    await p.locator('.r4-review-row').waitFor();
    const state=await p.evaluate(() => ADM.page.pd);
    assert.equal(state.source,'manual'); assert.ok(state.batch_id>0,'select actual saved batch');
    assert.match(await p.locator('.r4-review-row').first().innerText(), /QA audit manual/);
  });
  await test('UI09-return-refresh', async (open) => {
    const p = await open('student');
    await p.route('**/api/stu/bank/papers/901', r => r.fulfill({ json: { code: 0, data: { id: 901, title: 'QA', subject: '数学', duration: 1, total_score: 1, questions: [{ id: 1, type:'single', stem:'QA', options:['1','2'] }] } } }));
    await p.evaluate(async () => { document.body.insertAdjacentHTML('beforeend','<div id="auditHost"></div>'); await BankPages.papers(document.getElementById('auditHost'), '数学'); BankQuiz.open = opt => { window.auditQuiz = opt; }; document.getElementById('auditHost').insertAdjacentHTML('beforeend','<div data-task="901">QA</div>'); });
    let reads = 0; p.on('request', r => { if (r.url().endsWith('/api/stu/bank/tasks')) reads++; });
    // Use a real task card binding, supplied by a synthetic task response.
    await p.route('**/api/stu/bank/tasks', r => r.fulfill({ json: { code: 0, data: [{ id:901, title:'QA', subject:'数学', q_count:1, total_score:1 }] } }));
    await p.evaluate(() => BankPages.papers(document.getElementById('auditHost'), '数学'));
    await p.locator('[data-task="901"]').click(); await p.waitForFunction(() => window.auditQuiz);
    const before = reads; await p.evaluate(() => window.auditQuiz.onDone({ score: 0 }));
    await p.waitForFunction(() => document.querySelector('#auditHost .bk-tabs .on')?.dataset.s === '数学');
    assert.ok(reads > before, 'task list must be read after finishing');
  });
  await test('UI11-import-filters', async (open) => {
    const p = await open('admin', '#/pending'); await p.locator('#pd-batches').waitFor();
    await p.evaluate(() => { Object.assign(ADM.page.pd,{source:'excel', batch_id:999999, kw:'old-search',review:'missing_answer',mode:'batches',sel:{old:true},active:'old'}); pdImportDialog('word'); });
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: ['一、单选题','1. QA audit import 1+1=?','A. 1  B. 2','答案：B','解析：QA synthetic'].map(text => new Paragraph(text)) }] }));
    await p.locator('#pdI-file').setInputFiles({ name:'qa-audit.docx', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer:bytes });
    await p.locator('#pdI-done').click(); await p.waitForTimeout(200);
    const state = await p.evaluate(() => ADM.page.pd);
    assert.equal(state.source,'word'); assert.equal(state.kw,''); assert.notEqual(state.batch_id,999999); assert.equal(state.review,'all'); assert.equal(state.mode,'questions');
    assert.ok(await p.locator('.r4-review-row').count(), 'new imported batch visible immediately');
  });
  await test('UI03-words-selection', async (open) => {
    // Fresh sessions land on home and redirect direct word links there. Enter courses first.
    const p = await open('student', '#/courses');
    await p.waitForFunction(() => window.__stuVm && !window.__stuVm.loading && window.__stuVm.page === 'courses');
    await p.evaluate(() => location.hash = '#/words/quick');
    await p.locator('#wtBook').waitFor();
    assert.equal(await p.locator('[data-wu=""].on').count(), 0, 'all units is not selected on first entry');
    await p.locator('#wtBook').selectOption(String(bookId));
    await p.locator('[data-wu="Unit 1"]').waitFor();
    assert.equal(await p.locator('#wtBook').inputValue(), String(bookId), 'use the synthetic audit book, not the default seed book');
    assert.equal(await p.locator('[data-wu=""].on').count(), 0, 'changing books leaves all units unselected');
    await p.locator('[data-wu="Unit 1"]').click(); await p.locator('#wtGroups .wt-grp').first().waitFor();
    assert.equal(await p.locator('#wtGroups .wt-grp.on').count(), 0, 'no group is selected until clicked');
    await p.locator('#wtGroups .wt-grp').first().click(); assert.equal(await p.locator('#wtGroups .wt-grp.on').count(), 1);
    // Group order is shuffled. Reach the long fixture word through the real next action.
    const currentWord = p.locator('#wtQuickBox .t13-word-text');
    for (let i = 0; i < 4 && await currentWord.innerText() !== 'characteristically'; i++) await p.locator('#wqNext').click();
    assert.equal(await currentWord.innerText(), 'characteristically', 'the selected group displays the synthetic long word');
    for (const width of [1180,500]) {
      await p.setViewportSize({width,height:800});
      const next = p.locator('#wqNext');
      await next.scrollIntoViewIfNeeded(); assert.ok(await next.isVisible(), 'large panel primary action reachable');
    }
  });
  await test('UI08-grades-spacing', async (open) => {
    const p = await open('admin', '#/grades'); await p.locator('[data-r10-tab=records]').click();
    const f = p.frameLocator('#r10Embedded'); await f.locator('#rSubject').waitFor();
    for (const width of [1180,800,500]) {
      await p.setViewportSize({ width, height:800 });
      const h = await f.locator('.page-head > div').first().boundingBox();
      assert.ok(h.height < 150, `${width}: title reserves ${h.height}px blank space`);
    }
  });
})().catch(e => { console.error(e); process.exitCode=1; }).finally(async () => {
  if(browser) await browser.close();
  await Promise.allSettled(responseJobs);
  for (const id of createdRuns) db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id);
  if (bookId) { db.prepare('DELETE FROM words WHERE book_id=?').run(bookId); db.prepare('DELETE FROM word_books WHERE id=?').run(bookId); }
  for (const id of created) db.prepare('DELETE FROM users WHERE id=?').run(id);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results,null,2));
  console.log(`${results.filter(r=>r.pass).length}/${results.length} passed; evidence ${out}`);
  if(results.some(r=>!r.pass)) process.exitCode=1;
  process.exit(process.exitCode || 0);
});
