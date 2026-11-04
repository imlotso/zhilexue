'use strict';
/**
 * R3 题库管理页自测： node r3-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local）并 npm run seed；直连同一个 MySQL 造题目，结束后清理。
 * 接口：
 *   - 按节点筛题默认含子孙（关联），node_mode=exact 只认节点自身（精准）
 *   - 胶囊筛选组合：题型 / 难度 / 来源 / 年份 / 完整度 都能多选（组内「或」、组间「且」），关键字、knows（已选知识点）、src_kind（来源分类）
 *   - 题目附带章节路径 / 知识点 / 版本 / 组卷次数，sort=used 按组卷次数排序，unused=1 过滤已用
 *   - 批量挂分类 questions/batch op=node：追加 / 替换（只替换同类树上的挂载）
 *   - questions-facets 给出年份
 * 浏览器（有 Playwright 时）：
 *   - 级联选择器切换 学段 / 学科 后左树换成对应的树；搜索节点只留匹配项并展开祖先
 *   - 点节点后右侧题数 = 接口按该节点（含子孙）查出的题数；胶囊筛选组合后的题数 = 接口
 *   - 勾两题 → 批量挂分类（树形选择器）→ 题卡上出现新的章节路径和知识点
 *   - 加入试题篮后悬浮按钮数字变化；没有脚本报错；1440 / 390 宽都没有横向溢出
 */
const { db } = require('./src/db');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  if (body) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json(); j._status = res.status; return j;
}
const TAG = 'R3自测';
const uniq = Date.now().toString().slice(-6);
const made = { papers: [], mfpapers: [] };

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id));
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`DELETE FROM papers WHERE title LIKE '${TAG}%'`).run();
  db.prepare(`SELECT id FROM mf_papers WHERE title LIKE '${TAG}%'`).all().forEach((p) => { db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(p.id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(p.id); });
}

/** 按 学段+学科+种类 取默认那棵树（与 treepick 一致：章节树取默认版本，知识点树取通用） */
function treeOf(kind, subject, stage) {
  const list = db.prepare("SELECT * FROM bank_trees WHERE kind=? AND subject=? AND IFNULL(stage,'')=? ORDER BY sort, id").all(kind, subject, stage);
  const def = { 数学: { primary: '苏教版', junior: '苏科版' }, 英语: { primary: '译林版', junior: '译林版' } }[subject] || {};
  return (kind === 'knowledge' ? list.find((t) => !t.edition) : list.find((t) => t.edition === def[stage])) || list[0];
}
const nodeId = (treeId, name) => { const r = db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND name=?').get(treeId, name); return r ? r.id : 0; };

(async () => {
  console.log('\n=== R3 题库管理页 · 自测 ===\n');
  cleanup();
  const AT = (await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } })).data.token;
  const JT = treeOf('textbook', '数学', 'junior'); const JK = treeOf('knowledge', '数学', 'junior');
  if (!JT || !JK) { log(false, '缺少初中数学章节树 / 知识点树（先 npm run seed 并启动一次服务）'); process.exit(1); }
  const ch2 = nodeId(JT.id, '第2章 有理数'), s21 = nodeId(JT.id, '2.1 正数与负数'), s22 = nodeId(JT.id, '2.2 数轴'), s23 = nodeId(JT.id, '2.3 绝对值与相反数'), s31 = nodeId(JT.id, '3.1 字母表示数');
  const kRat = nodeId(JK.id, '有理数'), kAlg = nodeId(JK.id, '代数式');
  log(ch2 && s21 && s22 && s23 && s31 && kRat && kAlg, '夹具：初中数学（苏科版）章节树与知识点树节点齐全', `第2章=${ch2} 2.1=${s21} 有理数=${kRat}`);

  // ---------- 夹具：8 道题，覆盖不同 题型 / 难度 / 来源 / 年份 / 完整度 / 挂载 ----------
  const mk = (o) => req(MF + '/questions', { method: 'POST', token: AT, body: { subject: '数学', stage: 'junior', grade: '七年级', options: ['甲', '乙', '丙', '丁'], answer: 'A', analysis: '解析', ...o, stem: `${TAG}${uniq} ${o.stem}` } }).then((r) => r.data.id);
  const Q = {};
  Q.a = await mk({ stem: '正负数 单选 易', type: 'single', difficulty: 1, source: '2025 七上月考 · 绍兴', year: '2025', source_type: 'capture', nodes: [s21, kRat] });
  Q.b = await mk({ stem: '正负数 判断 较易', type: 'judge', options: ['对', '错'], answer: '对', difficulty: 2, source: '同步练习 2.1', year: '2025', nodes: [s21, kRat] });
  Q.c = await mk({ stem: '数轴 填空 中', type: 'fill', options: [], answer: '3|5', analysis: '', difficulty: 3, source: '2024 七上期中 · 苏州', year: '2024', nodes: [s22, kRat] });
  Q.d = await mk({ stem: '绝对值 单选 难', type: 'single', difficulty: 4, source: '2024 中考真题 · 江苏', year: '2024', nodes: [s23] });
  Q.e = await mk({ stem: '第2章 直接挂 单选 易', type: 'single', difficulty: 1, source: '2026 七上期末 · 南京', year: '2026', nodes: [ch2, kRat] });
  Q.f = await mk({ stem: '代数式 解答 缺答案', type: 'answer', options: [], answer: '', difficulty: 3, source: '2025 中考模拟 · 宿迁', year: '2025', source_type: 'recog', nodes: [s31, kAlg] });
  Q.g = await mk({ stem: '未分类 单选', type: 'single', difficulty: 2, source: '', year: '', nodes: [] });
  Q.h = await mk({ stem: '未分类 多选', type: 'multi', answer: 'AB', difficulty: 2, source: '', year: '2023', nodes: [] });
  log(Object.values(Q).every(Boolean), '夹具：8 道题入库', Object.values(Q).join(','));
  const KW = encodeURIComponent(`${TAG}${uniq}`);
  const list = async (qs) => (await req(`${MF}/questions?size=100&kw=${KW}&${qs}`, { token: AT })).data;
  const ids = (d) => d.list.map((q) => q.id).sort((x, y) => x - y);
  const same = (a, b) => JSON.stringify(a.slice().sort((x, y) => x - y)) === JSON.stringify(b.slice().sort((x, y) => x - y));

  // ---------- 按节点：关联（含子孙）/ 精准 ----------
  let d = await list(`nodes=${ch2}`);
  log(same(ids(d), [Q.a, Q.b, Q.c, Q.d, Q.e]), '选「第2章」：默认含子孙节点（2.1 / 2.2 / 2.3 和直接挂在第2章的题）', ids(d).join(','));
  d = await list(`nodes=${ch2}&node_mode=exact`);
  log(same(ids(d), [Q.e]), 'node_mode=exact（精准）：只取直接挂在「第2章」上的题', ids(d).join(','));
  d = await list(`nodes=${s21},${s22}`);
  log(same(ids(d), [Q.a, Q.b, Q.c]), '多选节点（2.1 + 2.2）取并集', ids(d).join(','));
  d = await list(`nodes=${ch2}&knows=${kRat}`);
  log(same(ids(d), [Q.a, Q.b, Q.c, Q.e]), 'knows（已选知识点）：章节范围内只留挂了「有理数」的题', ids(d).join(','));

  // ---------- 胶囊筛选组合 ----------
  d = await list('type=single,judge&difficulty=1,2');
  log(same(ids(d), [Q.a, Q.b, Q.e, Q.g]), '题型（单选|判断）且 难度（很容易|较易）', ids(d).join(','));
  d = await list('type=single&year=2024,2026');
  log(same(ids(d), [Q.d, Q.e]), '题型 单选 且 年份（2024|2026）', ids(d).join(','));
  d = await list('source_type=capture,recog');
  log(same(ids(d), [Q.a, Q.f]), '来源（网络采集|录题识别）', ids(d).join(','));
  d = await list('complete=noans,noana');
  log(same(ids(d), [Q.c, Q.f]), '完整度（缺答案|缺解析）', ids(d).join(','));
  d = await list('complete=nocat');
  log(same(ids(d), [Q.d, Q.g, Q.h]), '完整度「缺分类」：章节或知识点少挂任意一种', ids(d).join(','));
  d = await list(`nodes=${ch2}&type=single&difficulty=1,4&complete=full`);
  log(same(ids(d), [Q.a, Q.d, Q.e]), '节点 + 题型 + 难度 + 完整度 组合', ids(d).join(','));
  d = await list('src_kind=midterm,zhongkao');
  log(same(ids(d), [Q.c, Q.d]), '来源分类 src_kind（期中|中考真题，中考模拟不算真题）', ids(d).join(','));

  // ---------- 题目附带信息 ----------
  d = await list(`nodes=${s21}`);
  const qa = d.list.find((q) => q.id === Q.a);
  log(qa && qa.chapters.length === 1 && qa.chapters[0].names.join('/') === `七年级/上册/第2章 有理数/2.1 正数与负数` && qa.edition === JT.edition, '题目带章节路径（年级 › 册别 › 章 › 节）和教材版本', qa && qa.chapters[0] && qa.chapters[0].names.join(' › '));
  log(qa && qa.knows.length === 1 && qa.knows[0].name === '有理数' && qa.mount.chapter && qa.mount.knowledge, '题目带知识点名，挂载状态正确');
  const facets = (await req(`${MF}/questions-facets?subject=${encodeURIComponent('数学')}&stage=junior`, { token: AT })).data;
  log(['2023', '2024', '2025', '2026'].every((y) => facets.years.some((x) => x.v === y)) && facets.src_kinds.length >= 5, 'questions-facets 给出年份和来源分类', facets.years.map((x) => x.v).join(','));

  // ---------- 组卷次数 / 排序 / 过滤已用 ----------
  const pp = await req('/api/admin/bank/papers', { method: 'POST', token: AT, body: { title: TAG + '组卷次数', subject: '数学', stage: 'junior', q_ids: [Q.c, Q.d] } });
  const mp = await req(MF + '/papers', { method: 'POST', token: AT, body: { title: TAG + '试卷管理', status: 'basket' } });
  await req(`${MF}/papers/${mp.data.id}/questions`, { method: 'POST', token: AT, body: { question_ids: [Q.d] } });
  d = await list('sort=used');
  log(d.list[0].id === Q.d && d.list[0].use === 2 && d.list[1].id === Q.c && d.list[1].use === 1, 'sort=used：按组卷次数倒序（两种试卷都算），每题带 use', d.list.slice(0, 3).map((q) => `${q.id}:${q.use}`).join(' '));
  d = await list('unused=1');
  log(!ids(d).includes(Q.c) && !ids(d).includes(Q.d) && ids(d).length === 6, 'unused=1：过滤已组过卷的题', ids(d).length + ' 题');
  log(pp.code === 0 && mp.code === 0, '（夹具）试卷创建成功');

  // ---------- 批量挂分类 ----------
  let r = await req(MF + '/questions/batch', { method: 'POST', token: AT, body: { ids: [Q.g, Q.h], op: 'node', nodes: [s23, kRat] } });
  d = await list(`nodes=${s23}`);
  log(r.code === 0 && same(ids(d), [Q.d, Q.g, Q.h]), '批量挂分类（追加）：两题挂到 2.3 + 有理数，按 2.3 能筛到', r.msg);
  d = await list('complete=nocat');
  log(same(ids(d), [Q.d]), '挂完后这两题不再算「缺分类」', ids(d).join(','));
  r = await req(MF + '/questions/batch', { method: 'POST', token: AT, body: { ids: [Q.g], op: 'node', nodes: [s31], replace: 1 } });
  const nodesG = db.prepare('SELECT node_id FROM question_nodes WHERE question_id=?').all(Q.g).map((x) => x.node_id).sort();
  log(r.code === 0 && same(nodesG, [s31, kRat]), '批量挂分类（替换）：只替换章节挂载（2.3 → 3.1），知识点挂载保留', nodesG.join(','));
  r = await req(MF + '/questions/batch', { method: 'POST', token: AT, body: { ids: [Q.g], op: 'node', nodes: [999999999] } });
  log(r.code !== 0, '挂到不存在的节点：拒绝', r.msg);
  r = await req(MF + '/questions/batch', { method: 'POST', token: AT, body: { ids: [], op: 'node', nodes: [s21] } });
  log(r.code !== 0, '没勾题：拒绝', r.msg);

  // ---------- 浏览器 ----------
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
  if (!browser) { console.log('  ⏭  没有可用的浏览器（Playwright），跳过浏览器部分'); }
  else {
    const errs = [];
    try {
      const ap = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      ap.on('pageerror', (e) => errs.push(e.message));
      ap.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
      await ap.goto(BASE + '/admin/'); await ap.fill('input[type=text],input:not([type])', '15152099970'); await ap.fill('input[type=password]', '123456'); await ap.keyboard.press('Enter'); await ap.waitForTimeout(1500);
      await ap.evaluate(() => { try { localStorage.removeItem('zx_qbasket_' + ((Auth.user && Auth.user.id) || 'me')); } catch (e) { /* ignore */ } ADM.page.mfq = { tp: { stage: 'primary', subject: '数学', kind: 'textbook' } }; location.hash = '#/mfq'; });
      await ap.waitForSelector('.r3-tn[data-tn]:not(.r3-tn-all)', { timeout: 10000 }); await ap.waitForTimeout(800);
      const topNames = () => ap.$$eval('.r3-tp-tree > .r3-tn-wrap > .r3-tn .r3-tn-name', (a) => a.map((x) => x.textContent.trim()));
      const t0 = await topNames();
      log(t0.includes('三年级') && /小学 \/ 数学/.test(await ap.textContent('.r3-cas-txt')), '默认：小学 / 数学，章节树顶层是年级（三年级…）', t0.slice(0, 3).join(','));
      // 级联：初中 → 数学
      await ap.click('.r3-cas-btn'); await ap.hover('[data-cs="junior"]'); await ap.waitForTimeout(150); await ap.click('[data-cj="数学"]'); await ap.waitForTimeout(1200);
      const t1 = await topNames();
      log(t1.includes('七年级') && !t1.includes('三年级') && /初中 \/ 数学 \/ /.test(await ap.textContent('.r3-cas-txt')), '级联选择器切到「初中 / 数学」：左树换成七年级起的初中章节树', t1.join(','));
      // 级联：初中 → 英语（不同的树），再切回数学
      await ap.click('.r3-cas-btn'); await ap.hover('[data-cs="junior"]'); await ap.waitForTimeout(100); await ap.hover('[data-cj="英语"]'); await ap.waitForTimeout(150);
      const eds = await ap.$$eval('[data-ce]', (a) => a.map((x) => x.textContent));
      await ap.click('[data-ce]'); await ap.waitForTimeout(1200);
      const engRows = await ap.$$eval('.r3-tn .r3-tn-name', (a) => a.map((x) => x.textContent).join('|'));
      log(eds.length >= 1 && /Unit|Module/.test(engRows), '级联第三列选版本（英语）：左树换成英语教材章节（Unit / Module）', eds.join(','));
      await ap.click('.r3-cas-btn'); await ap.hover('[data-cs="junior"]'); await ap.waitForTimeout(100); await ap.click('[data-cj="数学"]'); await ap.waitForTimeout(1200);
      // 搜索节点
      await ap.fill('[data-tp="q"]', '绝对值'); await ap.waitForTimeout(500);
      const hits = await ap.$$eval('.r3-tn[data-tn]:not(.r3-tn-all)', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
      log(hits.some((x) => x.includes('2.3 绝对值与相反数')) && hits.some((x) => x.includes('第2章 有理数')) && !hits.some((x) => x.includes('2.1 正数与负数')) && await ap.$('.r3-tn mark') !== null, '搜索「绝对值」：只留匹配节点和它的祖先（自动展开），匹配字高亮', hits.length + ' 行');
      // 点节点 → 右侧题数与接口一致
      await ap.locator('.r3-tn', { hasText: '2.3 绝对值与相反数' }).first().click(); await ap.waitForTimeout(1200);
      await ap.fill('[data-tp="q"]', ''); await ap.waitForTimeout(400);
      const uiTotal = Number(await ap.textContent('#r3Total'));
      const apiTotal = (await req(`${MF}/questions?size=1&stage=junior&subject=${encodeURIComponent('数学')}&nodes=${s23}`, { token: AT })).data.total;
      log(uiTotal === apiTotal && uiTotal >= 3, '点「2.3 绝对值与相反数」：右侧题数 = 接口按该节点（含子孙）查出的题数', `${uiTotal} / ${apiTotal}`);
      log(/2\.3 绝对值与相反数/.test(await ap.textContent('.r3-selbar')), '已选节点以可删除的标签显示');
      // 胶囊筛选组合
      await ap.click('.r3-tn-all'); await ap.waitForTimeout(800);
      await ap.fill('#r3Kw', `${TAG}${uniq}`); await ap.waitForTimeout(1200);
      await ap.click('[data-fk="type"][data-fv="single"]'); await ap.waitForTimeout(700);
      await ap.click('[data-fk="type"][data-fv="judge"]'); await ap.waitForTimeout(700);
      await ap.click('[data-fk="diff"][data-fv="1"]'); await ap.waitForTimeout(700);
      await ap.click('[data-fk="diff"][data-fv="2"]'); await ap.waitForTimeout(1000);
      const ui2 = Number(await ap.textContent('#r3Total'));
      const api2 = (await req(`${MF}/questions?size=1&stage=junior&subject=${encodeURIComponent('数学')}&kw=${KW}&type=single,judge&difficulty=1,2`, { token: AT })).data.total;
      const onChips = await ap.$$eval('.r3-chip.on', (a) => a.map((x) => x.textContent).join(','));
      log(ui2 === api2 && ui2 === 4, '胶囊多选（单选+判断 × 很容易+较易）：题数与接口一致', `${ui2} / ${api2}；选中 ${onChips}`);
      await ap.click('[data-fk="type"][data-fv=""]'); await ap.click('[data-fk="diff"][data-fv=""]').catch(() => {}); await ap.waitForTimeout(800);
      await ap.click('[data-fk="diff"][data-fv=""]').catch(() => {}); await ap.waitForTimeout(800);
      // 批量挂分类：只看缺分类的
      await ap.click('[data-fk="comp"][data-fv="nocat"]'); await ap.waitForTimeout(1000);
      const nNocat = Number(await ap.textContent('#r3Total'));
      log(nNocat === 1, '完整度「缺分类」筛出 1 题（Q.d 只挂了章节）', String(nNocat));
      await ap.click('[data-fk="comp"][data-fv=""]'); await ap.waitForTimeout(1000);
      // 勾 Q.f（代数式）和 Q.b（判断）两题，挂到 2.2 数轴 + 代数式（替换）
      await ap.check(`[data-qck="${Q.f}"]`); await ap.check(`[data-qck="${Q.b}"]`); await ap.waitForTimeout(200);
      log(/已选 2 题/.test((await ap.textContent('.r3-batch')).replace(/\s+/g, ' ')), '勾选两题：批量条显示「已选 2 题」');
      await ap.click('[data-batch="hang"]'); await ap.waitForSelector('#r3HgC .r3-tn', { timeout: 8000 }); await ap.waitForTimeout(600);
      const dlg = ap.locator('.el-dialog.modal');
      const ch2Row = dlg.locator('#r3HgC .r3-tn', { hasText: '第2章 有理数' }).first();
      if (!(await dlg.locator('#r3HgC .r3-tn', { hasText: '2.2 数轴' }).count())) await ch2Row.locator('[data-tw]').click();
      await dlg.locator('#r3HgC .r3-tn', { hasText: '2.2 数轴' }).first().click();
      const ksRow = dlg.locator('#r3HgK .r3-tn', { hasText: '数与式' }).first();
      if (!(await dlg.locator('#r3HgK .r3-tn', { hasText: '代数式' }).count())) await ksRow.locator('[data-tw]').click();
      await dlg.locator('#r3HgK .r3-tn', { hasText: '代数式' }).first().click();
      await ap.click('input[name="r3hgm"][value="1"]');
      const chosen = (await dlg.locator('.r3-hang-sel').allTextContents()).join(' | ');
      await ap.click('#mOk'); await ap.waitForTimeout(1800);
      const cardF = (await ap.textContent(`.r3-qcard[data-qid="${Q.f}"]`)).replace(/\s+/g, ' ');
      const cardB = (await ap.textContent(`.r3-qcard[data-qid="${Q.b}"]`)).replace(/\s+/g, ' ');
      log(/2\.2 数轴/.test(cardF) && /代数式/.test(cardF) && /2\.2 数轴/.test(cardB) && !/2\.1 正数与负数/.test(cardB) && !/3\.1 字母表示数/.test(cardF), '批量挂分类（树形选择器，替换）后题卡显示新的章节路径和知识点', chosen);
      const dbF = db.prepare('SELECT node_id FROM question_nodes WHERE question_id=?').all(Q.f).map((x) => x.node_id).sort();
      log(same(dbF, [s22, kAlg]), '库里两题的挂载已更新', dbF.join(','));
      // 答案与解析原位展开
      await ap.click(`.r3-qcard[data-qid="${Q.c}"] [data-qans]`); await ap.waitForTimeout(400);
      log(await ap.isVisible(`.r3-qcard[data-qid="${Q.c}"] .r3-ans`) && /3/.test(await ap.textContent(`.r3-qcard[data-qid="${Q.c}"] .r3-ans`)), '「答案与解析」原位展开（填空题按空显示）');
      // 试题篮
      const n0 = await ap.textContent('.r3-fab-n');
      await ap.click(`.r3-qcard[data-qid="${Q.a}"] [data-qbask]`); await ap.waitForTimeout(300);
      const n1 = await ap.textContent('.r3-fab-n');
      log(Number(n1) === Number(n0) + 1 && /已加入/.test(await ap.textContent(`.r3-qcard[data-qid="${Q.a}"] [data-qbask]`)), '「加入试题篮」后悬浮按钮数字 +1，按钮变成「已加入」', `${n0} → ${n1}`);
      await ap.click(`.r3-qcard[data-qid="${Q.a}"] [data-qbask]`); await ap.waitForTimeout(200);
      // 溢出
      const ov1 = await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      log(ov1 <= 1, '1440 宽：没有横向溢出', String(ov1));
      const mp2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
      mp2.on('pageerror', (e) => errs.push(e.message));
      await mp2.goto(BASE + '/admin/'); await mp2.fill('input[type=text],input:not([type])', '15152099970'); await mp2.fill('input[type=password]', '123456'); await mp2.keyboard.press('Enter'); await mp2.waitForTimeout(1500);
      await mp2.goto(BASE + '/admin/#/mfq'); await mp2.waitForSelector('.r3-qcard, .r3-empty', { timeout: 10000 }); await mp2.waitForTimeout(800);
      await mp2.click('.r3-cas-btn'); await mp2.waitForTimeout(300);
      const ov2 = await mp2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      log(ov2 <= 1, '390 宽：没有横向溢出（级联面板展开时也不撑破）', String(ov2));
      log(errs.length === 0, '页面没有脚本报错', errs.slice(0, 3).join(' ; '));
    } catch (e) { log(false, '浏览器检查异常', e.message.split('\n')[0]); }
    await browser.close();
  }

  cleanup();
  log(!db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).get(), '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { cleanup(); } catch (e2) { /* ignore */ } process.exit(1); });
