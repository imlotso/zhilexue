'use strict';
/**
 * R1 二轮整改测试： node r1-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local AI_MOCK=1 TTS_MOCK=1）并 npm run seed；直连同一个 MySQL 造演示数据，结束后清理。
 *   · B2：视频 / 习题学习报告的 /detail 接口可用，分校账号不能看别校学生
 *   · 菜单：学习报告在「学生与账号」下，AI 学情诊断在「家校沟通」后，没有「知识点正确率」
 *   · 合并：#/acc 跳转到习题学习报告；详情抽屉里有 课程 → 小分组 → 视频 四级正确率（数字与 /api/admin/bank/accuracy 一致）+ 导出错题 Word
 * 环境变量：R1_KEEP=1 结束时不清理演示数据（截图用）；R1_DEMO_ONLY=1 只造数据不检查。
 */
const { db } = require('./src/db');
const { hash } = require('./src/auth');
const { readReportSections } = require('./legacy-ui-contract-test');

const BASE = process.env.BASE || 'http://localhost:3000';
const ADM = '/api/admin/bank';
const STU = '/api/stu/bank';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  if (raw) return res;
  const j = await res.json(); j._status = res.status; return j;
}
const uniq = Date.now().toString().slice(-8);
const TAG = 'R1演示' + uniq;
const made = { users: [], chapters: [], videos: [], sections: [], questions: [], papers: [] };
const NOW = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function cleanup() {
  const run = (sql, ...a) => { try { db.prepare(sql).run(...a); } catch (e) { /* ignore */ } };
  const qs = db.prepare("SELECT id FROM questions WHERE stem LIKE 'R1演示%'").all().map((q) => q.id);
  qs.forEach((id) => { ['mistakes', 'records', 'question_tags', 'question_nodes'].forEach((t) => run(`DELETE FROM ${t} WHERE question_id=?`, id)); run('DELETE FROM questions WHERE id=?', id); });
  made.papers.forEach((id) => { ['paper_assignments', 'paper_tries'].forEach((t) => run(`DELETE FROM ${t} WHERE paper_id=?`, id)); run('DELETE FROM papers WHERE id=?', id); });
  made.videos.forEach((id) => run('DELETE FROM videos WHERE id=?', id));
  made.sections.forEach((id) => run('DELETE FROM sections WHERE id=?', id));
  made.chapters.forEach((id) => run('DELETE FROM chapters WHERE id=?', id));
  made.users.forEach((id) => { ['mistakes', 'records', 'practices', 'paper_tries', 'paper_assignments'].forEach((t) => run(`DELETE FROM ${t} WHERE user_id=?`, id)); run('DELETE FROM users WHERE id=?', id); });
}
/** 清掉上次中断留下的演示数据 */
function cleanupOld() {
  made.users.push(...db.prepare("SELECT id FROM users WHERE username LIKE 'r1%'").all().map((u) => u.id));
  made.chapters.push(...db.prepare("SELECT id FROM chapters WHERE name LIKE 'R1演示%'").all().map((c) => c.id));
  if (made.chapters.length) {
    const ph = made.chapters.map(() => '?').join(',');
    made.videos.push(...db.prepare(`SELECT id FROM videos WHERE chapter_id IN (${ph})`).all(...made.chapters).map((v) => v.id));
    made.sections.push(...db.prepare(`SELECT id FROM sections WHERE chapter_id IN (${ph})`).all(...made.chapters).map((v) => v.id));
  }
  made.papers.push(...db.prepare("SELECT id FROM papers WHERE title LIKE 'R1演示%'").all().map((p) => p.id));
  cleanup();
  Object.values(made).forEach((a) => { a.length = 0; });
}

/** 造演示数据：2 名总校学生 + 1 名分校学生；数学 / 物理 两门课，每门课分小分组，视频绑题，学生做题，一份试卷 */
async function makeDemo() {
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const mkUser = (role, username, name, extra = {}) => {
    const id = db.prepare("INSERT INTO users (role,username,password,name,grade,term,stage,allow_speed,allow_seek,expire_at,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,1,1,'2099-12-31',1,?,?)")
      .run(role, username, hash('123456'), name, '七年级', '上册', 'junior', extra.created_by || null, NOW()).lastInsertRowid;
    made.users.push(id); return id;
  };
  const brId = mkUser('branch', 'r1br' + uniq, 'R1演示分校');
  const s1 = mkUser('student', 'r1a' + uniq, 'R1演示甲');
  const s2 = mkUser('student', 'r1b' + uniq, 'R1演示乙');
  const s3 = mkUser('student', 'r1c' + uniq, 'R1演示丙', { created_by: brId });
  const ST1 = await login('r1a' + uniq, 'student');
  const ST3 = await login('r1c' + uniq, 'student');
  const BT = await login('r1br' + uniq, 'branch');

  const mkChapter = async (subject, name) => {
    const r = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject, category: '同步基础', grade: '七年级', name } });
    made.chapters.push(r.data.id); return r.data.id;
  };
  const mkSection = (chId, name, sort) => { const id = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,?,?)').run(chId, name, sort, NOW()).lastInsertRowid; made.sections.push(id); return id; };
  const mkVideo = (chId, secId, title, sort) => { const id = db.prepare("INSERT INTO videos (chapter_id,section_id,title,level,sort,created_at) VALUES (?,?,?,'basic',?,?)").run(chId, secId || null, title, sort, NOW()).lastInsertRowid; made.videos.push(id); return id; };
  let qn = 0;
  const mkQ = (subject, vid, chId) => {
    const i = ++qn;
    const id = db.prepare('INSERT INTO questions (chapter_id,video_id,subject,grade,type,stem,options,answer,analysis,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(chId, vid, subject, '七年级', 'single', `${TAG}第${i}题：${i}+${i}=?`, JSON.stringify([String(i), String(2 * i), String(3 * i), String(4 * i)]), 'B', `${i}+${i}=${2 * i}`, NOW()).lastInsertRowid;
    made.questions.push(id); return id;
  };
  const bindQs = (subject, vid, chId, n) => Array.from({ length: n }, () => mkQ(subject, vid, chId));

  const math = await mkChapter('数学', 'R1演示·有理数');
  const phy = await mkChapter('物理', 'R1演示·机械运动');
  const g1 = mkSection(math, '正数与负数', 1), g2 = mkSection(math, '数轴与相反数', 2), g3 = mkSection(phy, '长度与时间', 1);
  const v1 = mkVideo(math, g1, '正数和负数的意义', 1), v2 = mkVideo(math, g1, '有理数的分类', 2), v3 = mkVideo(math, g2, '数轴上的点', 3);
  const v4 = mkVideo(phy, g3, '长度的测量', 1), v5 = mkVideo(phy, g3, '时间的测量', 2);
  const q = { v1: bindQs('数学', v1, math, 4), v2: bindQs('数学', v2, math, 3), v3: bindQs('数学', v3, math, 4), v4: bindQs('物理', v4, phy, 4), v5: bindQs('物理', v5, phy, 2) };
  const submit = (tok, vid, ids, nRight) => req(`${STU}/submit`, { method: 'POST', token: tok, body: { kind: 'practice', video_id: vid, answers: ids.map((id, i) => ({ question_id: id, my_answer: i < nRight ? 'B' : 'A' })) } });
  // 甲：数学 v1 3/4、v2 3/3、v3 1/4（小分组「数轴与相反数」未掌握）；物理 v4 4/4，v5 没做
  const rs = [await submit(ST1, v1, q.v1, 3), await submit(ST1, v2, q.v2, 3), await submit(ST1, v3, q.v3, 1), await submit(ST1, v4, q.v4, 4)];
  // 丙（分校学生）：v1 2/4
  const rs3 = await submit(ST3, v1, q.v1, 2);
  // 一份试卷，下发给甲，4 题答对 3
  const paperQs = [...q.v1.slice(0, 2), ...q.v2.slice(0, 2)];
  const saved = await req(`${ADM}/papers`, { method: 'POST', token: AT, body: { title: TAG + '·单元测验', subject: '数学', stage: 'junior', grade: '七年级', q_ids: paperQs, status: 'draft' } });
  const pid = saved.data && saved.data.id; if (pid) made.papers.push(pid);
  await req(`${ADM}/papers/${pid}/assign`, { method: 'POST', token: AT, body: { user_ids: [s1] } });
  const ps = await req(`${STU}/submit`, { method: 'POST', token: ST1, body: { kind: 'paper', paper_id: pid, answers: paperQs.map((id, i) => ({ question_id: id, my_answer: i < 3 ? 'B' : 'A' })) } });
  const all = [...rs, rs3, ps];
  return { AT, BT, ST1, ST3, brId, s1, s2, s3, math, phy, vids: { v1, v2, v3, v4, v5 }, ok: all.every((r) => r.code === 0), errs: all.filter((r) => r.code !== 0).map((r) => r.msg) };
}

/** 把 /api/admin/bank/accuracy 的返回展开成「页面上应该看到的行」：课程 / 小分组 / 视频，各自的名称和正确率徽标文字 */
function expectedRows(acc, onlyWeak) {
  const badge = (a) => (!a || !a.total ? '暂无习题' : a.rate === null ? `未做 · 共 ${a.total} 题` : `${a.rate}%`);
  const weak = (a) => !!a && a.answered > 0 && a.rate !== null && a.rate < 80;
  const rows = [];
  (acc.courses || []).forEach((c) => {
    const gs = c.groups.map((g) => ({ g, vs: onlyWeak ? g.videos.filter((v) => weak(v.acc)) : g.videos })).filter((x) => x.vs.length);
    if (!gs.length) return;
    rows.push({ lv: 1, name: c.name, badge: badge(c.acc) });
    gs.forEach(({ g, vs }) => { rows.push({ lv: 2, name: g.name, badge: badge(g.acc) }); vs.forEach((v) => rows.push({ lv: 3, name: v.title, badge: badge(v.acc) })); });
  });
  return rows;
}
const domRows = (p) => p.$$eval('#r1Tree .r1-row', (els) => els.map((e) => ({
  lv: e.classList.contains('r1-lv1') ? 1 : e.classList.contains('r1-lv2') ? 2 : 3,
  name: e.querySelector('.r1-name').textContent.trim(),
  badge: (e.querySelector('.r1-rate .t6-acc') || {}).textContent || '',
})));

async function main() {
  console.log('\n=== R1 二轮整改：菜单调整 + 习题学习报告合并（含 B2） ===\n');
  cleanupOld();
  const d = await makeDemo();
  log(d.ok, '造演示数据：3 名学生（含 1 名分校学生）、2 门课 / 3 个小分组 / 5 个视频、做题 + 一份试卷', d.errs.join(' '));

  // ---------- 1) B2：详情接口 ----------
  console.log('【1 接口：/detail】');
  const vd = await req(`/api/admin/xreport/videos/${d.s1}/detail`, { token: d.AT });
  log(vd.code === 0 && vd.data.student.id === d.s1 && Array.isArray(vd.data.rows), '视频学习报告详情 /videos/:id/detail → 200', vd.msg);
  const ed = await req(`/api/admin/xreport/exercises/${d.s1}/detail`, { token: d.AT });
  log(ed.code === 0 && ed.data.student.id === d.s1, '习题学习报告详情 /exercises/:id/detail → 200', ed.msg);
  const math = ed.data.subjects.find((x) => x.subject === '数学'); const phy = ed.data.subjects.find((x) => x.subject === '物理');
  log(math.n === 15 && math.correct === 10 && phy.n === 4 && phy.correct === 4, '详情里的学科统计：数学 10/15、物理 4/4', JSON.stringify(ed.data.subjects));
  log(ed.data.papers.length === 1 && ed.data.papers[0].score === 75 && ed.data.papers[0].total_score >= 1, '试卷成绩带满分（75 分 / 满分），不再把分数除以题数', JSON.stringify(ed.data.papers[0]));
  log(!('created_by' in ed.data.student), '学生信息里不带 created_by');
  const old = await fetch(`${BASE}/api/admin/xreport/exercises/${d.s1}`, { headers: { Authorization: 'Bearer ' + d.AT } });
  log(old.status === 404, '不带 /detail 的旧路径确实不存在（前端要用 /detail）', String(old.status));
  const lst = await req('/api/admin/xreport/exercises?kw=r1a' + uniq, { token: d.AT });
  log(lst.code === 0 && lst.data.list.length === 1 && lst.data.list[0].paper_tries === 1 && lst.data.list[0].paper_avg === 75, '习题学习报告列表：有交卷记录的学生不再让列表 500（试卷 1 次、平均分 75）', lst.msg);
  const bOk = await req(`/api/admin/xreport/exercises/${d.s3}/detail`, { token: d.BT });
  const bNo = await req(`/api/admin/xreport/exercises/${d.s1}/detail`, { token: d.BT });
  const bNoV = await req(`/api/admin/xreport/videos/${d.s1}/detail`, { token: d.BT });
  const bNoA = await req(`${ADM}/accuracy?user_id=${d.s1}`, { token: d.BT });
  const bNoX = await fetch(`${BASE}${ADM}/mistakes/export-docx?user_id=${d.s1}`, { headers: { Authorization: 'Bearer ' + d.BT } });
  log(bOk.code === 0 && bNo.code !== 0 && bNoV.code !== 0 && bNoA.code !== 0 && (bNoX.headers.get('content-type') || '').includes('json'), '分校账号：能看自己的学生；别校学生的详情 / 正确率 / 错题导出都被拒绝', [bOk.code, bNo.msg, bNoV.msg, bNoA.msg].join(' | '));
  const bl = await req('/api/admin/xreport/exercises', { token: d.BT });
  log(bl.code === 0 && bl.data.list.length === 1 && bl.data.list[0].id === d.s3, '分校账号的习题学习报告列表只有本校区学生', String(bl.data.list && bl.data.list.length));
  const acc = (await req(`${ADM}/accuracy?user_id=${d.s1}`, { token: d.AT })).data;
  const mathC = acc.courses.find((c) => c.name === 'R1演示·有理数');
  log(!!mathC && mathC.groups.length === 2 && mathC.groups[1].videos[0].acc.rate === 25, '正确率接口：课程 → 2 个小分组 →「数轴上的点」25%', JSON.stringify(mathC && mathC.groups.map((g) => g.acc.rate)));

  // ---------- 2) 页面 ----------
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox'] }); } catch (e) { browser = null; } }
  if (!browser) {
    console.log('  ⏭  没有可用的浏览器（Playwright），跳过页面检查');
  } else {
    const errs = [];
    try {
      const open = async (w, h) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
        const p = await ctx.newPage();
        p.on('pageerror', (e) => errs.push(e.message));
        // 记下页面给下载文件起的名字（无头 Chromium 对中文文件名会回落成 "download"，不影响真实浏览器）
        await p.addInitScript(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dlName = this.download; return c.call(this); }; });
        await p.goto(BASE + '/admin/'); await p.fill('input[type=text],input:not([type])', '15152099970'); await p.fill('input[type=password]', '123456'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
        return p;
      };
      const p = await open(1440, 900);
      const dlPK = async (trigger) => {
        const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), trigger()]);
        const buf = require('fs').readFileSync(await dl.path());
        return { name: await p.evaluate(() => window.__dlName || ''), head: buf.slice(0, 2).toString(), size: buf.length, zip: buf.toString('latin1').includes('word/document.xml') };
      };

      console.log('【2 菜单】');
      await p.goto(BASE + '/admin/#/xreport'); await p.waitForSelector('.nav .nav-group'); await p.waitForTimeout(500);
      const menu = await p.$$eval('.nav .nav-group, .nav .nav-leaf', (gs) => gs.map((g) => ({
        t: (g.querySelector('.txt') || {}).textContent.trim(),
        items: [...g.querySelectorAll('.ng-sub a .txt')].map((x) => x.textContent.trim()),
      })));
      const items = (t) => (menu.find((g) => g.t === t) || { items: [] }).items.join('/');
      log(menu.map((g) => g.t).join('/') === '工作台/学生与账号/教学资源/智能题库/学情与报告/系统设置', '菜单分组顺序：工作台 / 学生与账号 / 教学资源 / 智能题库 / 学情与报告 / 系统设置', menu.map((g) => g.t).join('/'));
      log(items('学生与账号') === '分校管理/学生管理/学习报告', '「学习报告」在「学生与账号」下、「学生管理」后面', items('学生与账号'));
      log(items('学情与报告') === '成绩管理/谈心谈话/家校沟通/AI学情诊断', '「学情与报告」：成绩管理 / 谈心谈话 / 家校沟通 / AI学情诊断（诊断排在家校沟通后）', items('学情与报告'));
      log(items('教学资源') === '课程目录/视频管理/讲义资料/词书管理/字母乐园/音标训练' && items('智能题库') === '题库管理/录题中心/待审核题目/知识树管理/试卷管理/智能组卷/课文习题' && items('系统设置') === 'AI 配置中心/操作日志', '教学资源和系统设置保持原组，智能题库包含统一录题中心');
      log(!(await p.$$eval('.nav a', (a) => a.some((x) => /知识点正确率/.test(x.textContent)))), '菜单里没有「知识点正确率」');
      const onItem = await p.$eval('.nav a.on .txt', (e) => e.textContent.trim());
      const crumb = await p.$eval('.tb-crumb b', (e) => e.textContent.trim());
      const onGroup = await p.$eval('.nav-group.has-on .ng-t .txt', (e) => e.textContent.trim());
      log(onItem === '学习报告' && crumb === '学习报告' && onGroup === '学生与账号', '在学习报告页：菜单高亮「学习报告」、所在分组展开高亮、面包屑「学习报告」', [onItem, crumb, onGroup].join('/'));

      console.log('【3 旧路由 #/acc 跳转】');
      await p.goto(BASE + '/admin/#/acc'); await p.waitForSelector('#erKw', { timeout: 8000 }); await p.waitForTimeout(300);
      const hash = await p.evaluate(() => location.hash);
      const tabOn = await p.$eval('[data-xrep].primary-sm', (e) => e.textContent.trim());
      log(hash === '#/xreport' && tabOn.includes('习题学习报告'), '#/acc → 跳转到「学习报告」的「习题学习报告」页签（地址栏变为 #/xreport）', hash + ' ' + tabOn);
      log((await p.$eval('.tb-crumb b', (e) => e.textContent.trim())) === '学习报告', '面包屑是「学习报告」');
      await p.goto(BASE + '/admin/#/acc?user_id=' + d.s1); await p.waitForSelector('.r1-drawer #r1Tree .r1-course', { timeout: 8000 });
      const title = await p.$eval('.r1-dt h3', (e) => e.textContent.trim());
      log(title.includes('R1演示甲'), '#/acc?user_id=N 直接打开该学生的详情', title);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      log((await p.$$('.r1-mask')).length === 0, 'Esc 关闭详情抽屉');
      await p.click('[data-xrep=w]'); await p.waitForTimeout(800);
      log((await p.$$('.r1-mask')).length === 0 && (await p.$eval('[data-xrep].primary-sm', (e) => e.textContent.trim())).includes('词书'), '之后手动切页签不会被旧参数拉回习题页签');

      console.log('【4 习题学习报告：列表 + 详情抽屉】');
      await p.click('[data-xrep=e]'); await p.waitForSelector('#erKw');
      await p.fill('#erKw', 'r1a' + uniq); await p.click('#erSearch'); await p.waitForSelector('[data-edetail]'); await p.waitForTimeout(300);
      const heads = await p.$$eval('.card table thead th', (e) => e.map((x) => x.textContent.trim()));
      log(['学科做题（对/总）', '做题数', '正确率', '待复习错题', '已掌握', '试卷', '平均分', '最高分'].every((h) => heads.includes(h)), '列表保留原有列：学科做题 / 做题数 / 正确率 / 错题 / 试卷 / 平均分…', heads.join(','));
      const row = await p.$eval('tbody tr', (tr) => ({ btns: [...tr.querySelectorAll('.link-btn')].map((b) => b.textContent.trim()), paper: tr.children[9].textContent.trim(), avg: tr.children[10].textContent.trim() }));
      log(row.btns.join('/') === '详情/导出错题 Word' && row.paper === '1 次' && row.avg === '75', '每行操作：「详情」「导出错题 Word」；试卷 1 次、平均分 75', JSON.stringify(row));
      const rowDl = await dlPK(() => p.click('[data-edocx]'));
      log(rowDl.head === 'PK' && rowDl.zip && /\.docx$/.test(rowDl.name), '行内「导出错题 Word」→ 下载 .docx（PK 压缩包，含 word/document.xml）', `${rowDl.name} ${rowDl.size}B`);

      await p.click('[data-edetail]'); await p.waitForSelector('.r1-drawer #r1Tree .r1-course', { timeout: 8000 });
      const report = await p.evaluate(readReportSections);
      const secs = report.headings;
      log(secs.length === 5 && /学科总览/.test(secs[0]) && /知识点与小分组/.test(secs[1]) && /试卷成绩/.test(secs[2]) && /最近作答/.test(secs[3]) && /主观题作答/.test(secs[4]), '详情抽屉：学科总览、知识点与小分组、试卷成绩、最近作答和主观评分', secs.join(' | '));
      const subj = await p.$$eval('.r1-subj', (c) => c.map((x) => `${x.dataset.subj}:${x.querySelector('.r1-subj-v').textContent.trim()}`).join(','));
      log(subj === '数学:67%,英语:—,物理:100%,化学:—', '学科总览：数学 67%（10/15）、物理 100%（4/4），没做的学科显示「—」', subj);
      const got = await domRows(p);
      const want = expectedRows(acc, false);
      log(got.length > 0 && JSON.stringify(got) === JSON.stringify(want), `四级正确率：页面 ${got.length} 行（课程 / 小分组 / 视频）与 /api/admin/bank/accuracy 逐行一致`, JSON.stringify(got.filter((r) => /R1|正数|数轴|有理|长度|时间/.test(r.name)).map((r) => r.name + ' ' + r.badge)));
      const v25 = got.find((r) => r.name === '数轴上的点');
      log(!!v25 && v25.badge === '25%', '「数轴上的点」视频 25%（答对 1 / 4 题）', v25 && v25.badge);
      const paperTxt = report.paperText;
      log(/单元测验/.test(paperTxt) && /75 \/ \d+/.test(paperTxt) && /3 \/ 4 题/.test(paperTxt), '试卷成绩：试卷名、75 分、答对 3 / 4 题', paperTxt.slice(0, 120));
      log(report.recordCount === 19, '最近作答：19 条记录（不混入主观评分表）');
      log(report.subjectiveText === '还没有主观题作答' && report.gradeIds.length === 0, '纯客观题夹具：主观评分区显示空态，不误生成评分记录');

      // 折叠
      await p.click('.r1-lv1[data-tog]'); await p.waitForTimeout(100);
      const folded = await p.$eval('.r1-course .r1-kids', (e) => e.hidden);
      await p.click('#r1Fold'); await p.waitForTimeout(100);
      const allFolded = await p.$$eval('#r1Tree .r1-lv2', (e) => e.filter((x) => !x.closest('[hidden]')).length);
      await p.click('#r1Open'); await p.waitForTimeout(100);
      const allOpen = await p.$$eval('#r1Tree .r1-lv3', (e) => e.filter((x) => !x.closest('[hidden]')).length);
      log(folded === true && allFolded === 0 && allOpen === want.filter((r) => r.lv === 3).length, '课程行可折叠；全部收起 / 全部展开可用');
      // 只看未掌握
      await p.check('#r1Weak'); await p.waitForTimeout(150);
      const gotW = await domRows(p); const wantW = expectedRows(acc, true);
      log(JSON.stringify(gotW) === JSON.stringify(wantW) && gotW.some((r) => r.name === '数轴上的点') && !gotW.some((r) => r.name === '长度的测量') && gotW.length < got.length, `「只看未掌握（< 80%）」：只留正确率低于 80% 的视频及其上级（${gotW.length} 行），已掌握的物理课消失`, JSON.stringify(gotW.map((r) => r.name)));
      await p.uncheck('#r1Weak');
      // 详情内导出
      await p.selectOption('#r1Subj', '数学'); await p.selectOption('#r1Bucket', 'all'); await p.selectOption('#r1Days', '30');
      const dl = await dlPK(() => p.click('#r1Docx'));
      log(dl.head === 'PK' && dl.zip && dl.name.includes('R1演示甲') && dl.name.includes('数学'), '详情顶部「导出错题 Word」（数学 / 全部 / 近 30 天）→ .docx（PK 头）', `${dl.name} ${dl.size}B`);
      await p.keyboard.press('Escape');

      console.log('【5 B2：视频学习报告详情 / 无脚本报错】');
      await p.click('[data-xrep=v]'); await p.waitForSelector('#vrKw'); await p.fill('#vrKw', 'r1a' + uniq); await p.click('#vrSearch'); await p.waitForSelector('[data-vdetail]');
      await p.click('[data-vdetail]'); await p.waitForSelector('.el-dialog__title', { timeout: 6000 });
      const vt = await p.$eval('.el-dialog__title', (e) => e.textContent.trim());
      log(/R1演示甲 · 视频学习报告/.test(vt), '视频学习报告：点「详情」打开弹窗（改前 404「接口不存在」）', vt);
      await p.click('.close-x');
      log(errs.length === 0, '页面没有脚本报错', errs.slice(0, 2).join(' ; '));
      await p.context().close();

      console.log('【6 手机宽度 390】');
      const m = await open(390, 844);
      const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await m.goto(BASE + '/admin/#/xreport'); await m.waitForSelector('[data-xrep=e]'); await m.click('[data-xrep=e]'); await m.waitForSelector('#erKw'); await m.waitForTimeout(400);
      log((await overflow()) <= 1, '习题学习报告列表：390 宽不横向撑破页面', String(await overflow()));
      await m.fill('#erKw', 'r1a' + uniq); await m.click('#erSearch'); await m.waitForSelector('[data-edetail]');
      const btnVis = await m.$eval('[data-edetail]', (b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.width > 0; });
      log(btnVis, '手机上「详情」按钮在可视范围内（操作列吸在右侧）');
      await m.click('[data-edetail]'); await m.waitForSelector('.r1-drawer #r1Tree .r1-course', { timeout: 8000 }); await m.waitForTimeout(300);
      const dw = await m.$eval('.r1-drawer', (e) => e.getBoundingClientRect().width);
      const ov = await overflow();
      log(ov <= 1 && dw <= 390, '详情抽屉：390 宽满屏、不横向溢出', `溢出 ${ov} 抽屉宽 ${dw}`);
      const treeOv = await m.$eval('.r1-body', (e) => e.scrollWidth - e.clientWidth);
      log(treeOv <= 1, '手机上正确率树和三块内容不撑出横向滚动', String(treeOv));
      await m.keyboard.press('Escape');
      await m.goto(BASE + '/admin/#/dash'); await m.waitForTimeout(600); await m.click('#btnFold'); await m.waitForTimeout(400);
      log((await m.$$eval('.ng-sub a[data-go=xreport]', (a) => a.length)) === 1, '手机抽屉菜单里能看到「学习报告」');
      await m.context().close();
      log(errs.length === 0, '手机端也没有脚本报错', errs.slice(0, 2).join(' ; '));
    } catch (e) { log(false, '浏览器检查异常', e.message); }
    await browser.close();
  }

  if (!process.env.R1_KEEP) cleanupOld();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

module.exports = { makeDemo, cleanupOld, cleanup };
if (require.main === module) {
  if (process.env.R1_DEMO_ONLY) {
    (async () => { cleanupOld(); const d = await makeDemo(); console.log('demo', JSON.stringify({ s1: d.s1, s2: d.s2, s3: d.s3, ok: d.ok, errs: d.errs })); process.exit(0); })().catch((e) => { console.error(e); process.exit(1); });
  } else {
    main().catch((e) => { console.error('测试异常：', e); try { cleanupOld(); } catch (x) { /* ignore */ } process.exit(1); });
  }
}
