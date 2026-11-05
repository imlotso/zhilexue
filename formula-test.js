'use strict';
/**
 * 公式输入（T8）自测： node formula-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local）并 npm run seed；直连同一个 MySQL 造学生 / 题目，结束后清理。
 * 覆盖：本地 MathLive 文件 → 含分数 / 根号的题目存 \( … \) → 学生端取题带 subject（决定要不要显示「公式」按钮）→
 *       学生用公式键盘输入的裸 LaTeX 能和 \( … \) 形式的标准答案判对（不做公式等价）→ 页面接线检查；
 *       有浏览器时（Playwright）再真的点一遍：录题端和学生端弹出 MathLive 键盘、插入后文本框里是正确的 LaTeX。
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./src/db');
const { hash } = require('./src/auth');
const { judgeQ } = require('./src/bank-judge');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (body) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const j = await res.json(); j._status = res.status; return j;
}
const uniq = Date.now().toString().slice(-8);
const TAG = 'T8公式测试';
const made = { users: [] };
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['mistakes', 'records', 'question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`SELECT id FROM mf_papers WHERE title LIKE '${TAG}%'`).all().forEach((p) => { db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(p.id); db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(p.id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(p.id); });
  made.users.forEach((id) => { ['mistakes', 'records', 'practices', 'mf_paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM users WHERE id=?').run(id); });
}

(async () => {
  console.log('\n=== 公式输入（T8）· 自测 ===\n');
  cleanup();
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const sid = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'T8学生','九年级','上册',1,1,'2099-12-31',1,'2026-11-02')").run('t8s' + uniq, hash('123456')).lastInsertRowid; made.users.push(sid);
  const ST = await login('t8s' + uniq, 'student');
  log(!!AT && !!ST, '管理员和测试学生登录');

  // ---------- 1) 本地文件：不走 CDN ----------
  const ml = await fetch(BASE + '/vendor/mathlive/mathlive.min.js');
  const mlText = await ml.text();
  log(ml.status === 200 && mlText.length > 100000, 'MathLive 脚本是本地文件', `/vendor/mathlive/mathlive.min.js ${mlText.length} 字节`);
  const fontFiles = fs.readdirSync(path.join(__dirname, 'public/vendor/mathlive/fonts'));
  const f1 = await fetch(BASE + '/vendor/mathlive/fonts/' + fontFiles[0]);
  log(fontFiles.length >= 10 && f1.status === 200, 'MathLive 字体也是本地文件', fontFiles.length + ' 个');
  log(fs.existsSync(path.join(__dirname, 'public/vendor/mathlive/LICENSE.txt')), 'MathLive 许可证文件随库保留（MIT）');
  const mlive = read('public/js/mlive.js');
  log(!/https?:\/\//.test(mlive.replace(/\/\*[\s\S]*?\*\//g, '')), '公共加载脚本 mlive.js 里没有外网地址');

  // ---------- 2) 录题：分数、根号以 \( … \) 存入 ----------
  const stem = TAG + ' 化简 \\(\\frac{\\sqrt{8}}{2}\\)，结果是 ____';
  const q1 = await req(MF + '/questions', { method: 'POST', token: AT, body: { type: 'fill', subject: '数学', stage: 'junior', grade: '九年级', stem, answer: '\\(\\sqrt{2}\\)', analysis: '\\(\\frac{2\\sqrt{2}}{2}=\\sqrt{2}\\)' } });
  const id1 = q1.data && q1.data.id;
  log(q1.code === 0 && !!id1, '录入含分数、根号的数学填空题', q1.msg);
  const row = db.prepare('SELECT stem,answer,analysis FROM questions WHERE id=?').get(id1);
  log(row && row.stem === stem && row.analysis.includes('\\frac{2\\sqrt{2}}{2}'), '题干 / 解析里的 LaTeX 原样存库（反斜杠不丢）');
  const q2 = await req(MF + '/questions', { method: 'POST', token: AT, body: { type: 'answer', subject: '物理', stage: 'junior', grade: '九年级', stem: TAG + ' 写出牛顿第二定律', answer: 'F=ma' } });
  const q3 = await req(MF + '/questions', { method: 'POST', token: AT, body: { type: 'fill', subject: '英语', stage: 'junior', grade: '九年级', stem: TAG + ' English ____', answer: 'abc' } });
  const q4 = await req(MF + '/questions', { method: 'POST', token: AT, body: { type: 'single', subject: '数学', stage: 'junior', grade: '九年级', stem: TAG + ' 选择', options: [{ label: 'A', text: '1' }, { label: 'B', text: '2' }], answer: 'A' } });
  const ids = [id1, q2.data && q2.data.id, q3.data && q3.data.id, q4.data && q4.data.id];
  log(ids.every(Boolean), '再录入物理问答、英语填空、数学单选各一道');

  // ---------- 3) 学生端取题：带 subject，前端据此决定显不显示「公式」按钮 ----------
  const p = await req(MF + '/papers', { method: 'POST', token: AT, body: { title: TAG + '卷', subject: '数学', stage: 'junior', grade: '九年级' } });
  const pid = p.data && p.data.id;
  await req(`${MF}/papers/${pid}/questions`, { method: 'POST', token: AT, body: { question_ids: ids } });
  await req(`${MF}/papers/${pid}`, { method: 'PUT', token: AT, body: { status: 'done', published: 1 } });
  const paper = await req('/api/stu/bank/mfpapers/' + pid, { token: ST });
  const qs = (paper.data && (paper.data.questions || paper.data.list)) || [];
  const bySub = Object.fromEntries(qs.map((q) => [q.id, q.subject]));
  log(paper.code === 0 && bySub[ids[0]] === '数学' && bySub[ids[1]] === '物理' && bySub[ids[2]] === '英语', '学生端取题返回 subject 字段', JSON.stringify(bySub));
  const js = read('public/js/bank.js');
  log(/T8_SUBJECTS = \['数学', '物理', '化学'\]/.test(js) && /type === 'fill' \|\| q\.type === 'answer'/.test(js), '前端只对数学 / 物理 / 化学的填空、问答题显示「公式」按钮');
  log(/MLive\.dialog\(\{[^}]*delimit: false/.test(js.replace(/\s+/g, ' ')), '学生作答插入的是裸 LaTeX（不带 \\( \\)）');

  // ---------- 4) 判分：沿用 judge，不做公式等价 ----------
  const r1 = judgeQ({ type: 'fill', answer: '\\(\\sqrt{2}\\)' }, '\\sqrt{2}');
  log(r1 === true, '标准答案存成 \\(\\sqrt{2}\\)，学生用公式键盘输入 \\sqrt{2}：判对');
  log(judgeQ({ type: 'fill', answer: '\\frac{1}{2}' }, '\\dfrac{1}{2}') === true, '\\frac 与 \\dfrac 视为同一写法');
  log(judgeQ({ type: 'fill', answer: '\\frac{1}{2}' }, '\\frac{1}{3}') === false && judgeQ({ type: 'fill', answer: '\\frac{1}{2}' }, '0.5') === false, '不做公式等价：1/2 与 0.5 不互判（沿用 judge）');
  log(judgeQ({ type: 'fill', answer: '\\rightarrow' }, 'arrow') === false, '去分隔符时不会误伤 \\rightarrow 这类命令');
  log(judgeQ({ type: 'fill', answer: 'abc|de' }, 'ABC | de') === true, '原有填空规则不变（多空、大小写、空格）');
  const sub1 = await req('/api/stu/bank/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: [{ question_id: id1, my_answer: '\\sqrt{2}' }] } });
  log(sub1.code === 0 && sub1.data.correct === 1, '学生提交公式键盘输入的答案，服务端判对', sub1.msg);
  const sub2 = await req('/api/stu/bank/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: [{ question_id: id1, my_answer: '\\sqrt{3}' }] } });
  const wrongFormula = (sub2.data && sub2.data.list || []).find((q) => q.question_id === id1);
  log(sub2.code === 0 && wrongFormula && wrongFormula.is_correct === false && sub2.data.correct === 0 && sub2.data.wrong === 3 && sub2.data.ungraded_count === 1, '答错的公式判错；未答的客观题计错、问答题待评分', sub2.msg);

  // ---------- 5) 页面接线 ----------
  const adm = read('public/admin/index.html'), stu = read('public/index.html');
  log(/mlive\.js/.test(adm) && /formulaui\.js/.test(adm) && /mlive\.js/.test(stu), '后台和学生端页面都加载了 mlive.js，后台还加载了 formulaui.js');
  const fu = read('public/admin/formulaui.js');
  log(/插入公式/.test(fu) && /paste/.test(fu) && /drop/.test(fu) && /\/asset/.test(fu), '后台：题干 / 选项 / 解析旁有「插入公式」，输入框支持粘贴 / 拖拽图片（走 /asset）');
  log(/t8Enhance/.test(read('public/admin/mfui2.js')) && /t8Enhance/.test(read('public/admin/pendingui.js')), '后台录题、编辑题、待审核编辑三处都接入了公式按钮');
  const upImg = await fetch(BASE + MF + '/asset', { method: 'POST', headers: { Authorization: 'Bearer ' + AT }, body: (() => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')], { type: 'image/png' }), 'p.png'); return fd; })() });
  const upJ = await upImg.json();
  log(upJ.code === 0 && /^bank\//.test((upJ.data && upJ.data.key) || ''), '粘贴 / 拖拽的图片上传：存到 bank/ 目录', upJ.data && upJ.data.key);
  if (upJ.data && upJ.data.key) { try { fs.unlinkSync(require('./src/storage').localPath(upJ.data.key)); } catch (e) { /* ignore */ } }

  // ---------- 6) 有浏览器时：真的点一遍 ----------
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
  if (!browser) {
    console.log('  ⏭  没有可用的浏览器（Playwright），跳过键盘点击检查');
  } else {
    const errs = []; const ext = [];
    const watch = (pg, tag) => { pg.on('pageerror', (e) => errs.push(tag + ':' + e.message)); pg.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) ext.push(u); }); };
    try {
      const sp = await browser.newPage({ viewport: { width: 1100, height: 900 } }); watch(sp, 'stu');
      await sp.goto(BASE + '/'); await sp.waitForTimeout(700);
      await sp.fill('input[type=text],input[type=tel],input:not([type])', 't8s' + uniq); await sp.fill('input[type=password]', '123456'); await sp.keyboard.press('Enter'); await sp.waitForTimeout(1500);
      await sp.goto(BASE + '/#/papers'); await sp.waitForSelector('.pk-libcard', { timeout: 8000 });
      await sp.fill('#pkQ', TAG); await sp.keyboard.press('Enter'); await sp.waitForTimeout(800);
      await sp.click('.pk-libcard'); await sp.waitForSelector('.quiz-body, #qzBody', { timeout: 8000 });
      log(await sp.$$eval('.t8-fbtn', (e) => e.length) === 1 && (await sp.$$eval('svg', (e) => e.length)) > 0, '学生端：数学填空题有「公式」按钮，题干里的分数 / 根号已渲染成公式');
      await sp.click('.t8-fbtn'); await sp.waitForSelector('math-field', { timeout: 15000 });
      await sp.evaluate(() => document.querySelector('math-field').setValue('\\frac{1}{2}')); await sp.waitForTimeout(200);
      const kb = await sp.evaluate(() => !!(window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible));
      await sp.click('.t8-ok'); await sp.waitForTimeout(300);
      const val = await sp.evaluate(() => [...document.querySelectorAll('textarea,input.t6-fill')].map((x) => x.value).join('|'));
      log(kb && val === '\\frac{1}{2}', '学生端：点「公式」弹出 MathLive 虚拟键盘，输入后答案框里是 \\frac{1}{2}', val);
      const ap = await browser.newPage({ viewport: { width: 1300, height: 950 } }); watch(ap, 'admin');
      await ap.goto(BASE + '/admin/'); await ap.fill('input[type=text],input:not([type])', '15152099970'); await ap.fill('input[type=password]', '123456'); await ap.keyboard.press('Enter'); await ap.waitForTimeout(1500);
      await ap.goto(BASE + '/admin/#/mfq'); await ap.waitForTimeout(1500);
      await ap.evaluate((i) => mfQEdit(i, () => {}), id1); await ap.waitForSelector('.t8-bar .t8-fx', { timeout: 8000 });
      await ap.evaluate(() => { const t = document.querySelector('#qeAns'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
      await ap.locator('#qeAns').locator('xpath=preceding-sibling::*[contains(@class,"t8-bar")][1]').locator('.t8-fx').click();
      await ap.waitForSelector('math-field', { timeout: 15000 });
      await ap.evaluate(() => document.querySelector('math-field').setValue('x^{2}+1')); await ap.waitForTimeout(200);
      await ap.click('.t8-ok'); await ap.waitForTimeout(300);
      const av = await ap.inputValue('#qeAns');
      log(/\\\(x\^\{2\}\+1\\\)$/.test(av), '后台：点「插入公式」，结果以 \\( … \\) 插入到光标处', av);
      log(errs.length === 0, '页面没有脚本报错', errs.join(' ; '));
      log(ext.length === 0, '公式键盘加载过程没有访问外网', ext.slice(0, 3).join(' '));
    } catch (e) { log(false, '浏览器检查异常', e.message); }
    await browser.close();
  }

  cleanup();
  const left = db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE '${TAG}%'`).get().n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 't8s%'").get().n;
  log(Number(left) === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
