'use strict';
/**
 * 知识树教材版本（R2）自测： node tree-edition-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；同时直连 MySQL 造专用学科 / 树 / 学生，结束后清理。
 * 覆盖：
 *   1) 加列与迁移：bank_trees.edition 存在；种子章节树带正确版本和改正后的树名；迁移幂等（旧库状态能被修正、用户改过的树名不动）
 *   2) 默认版本表：GET / PUT /mf/editions；格式不对被拒；保存后立即影响取树
 *   3) pickTree：同 学段+学科 两个版本按 edition 取对的那棵、默认版本生效、默认版本不存在时退回第一棵、知识点树优先"通用"；
 *      前端 public/admin/treepick.js 的 pickTree 与后端逐个用例结果一致
 *   4) 导入格式：新建树、按路径合并（重复导入新增 0）、导出再导入一致、code/note、数组、文件上传、格式错误提示、?dry=1 不写库
 *   5) 命令行 scripts/import-trees.js：打印目标库名、--dry-run 不写库、幂等
 *   6) 学生端 scan-tree / scan-compose：按学生学段 + 默认版本返回树；改默认版本后跟着变；物理（草稿树）能选到
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { db, DB_INFO } = require('./src/db');
const { hash } = require('./src/auth');
const treePick = require('./src/treepick');
const treeIo = require('./src/treeio');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
const STU = '/api/stu/bank';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };

async function req(p, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  const j = ct.includes('json') ? await res.json() : {};
  j._status = res.status;
  return j;
}

const SUBJECT = 'R2测试学科';
const now = '2026-11-04 00:00:00';
const uniq = Date.now().toString().slice(-8);
let tmpDir = '';
const made = { users: [], questions: [] };
let origDefaults = null;
let createdPhysics = false;

const delTree = (id) => {
  db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=?').all(id).forEach((n) => db.prepare('DELETE FROM question_nodes WHERE node_id=?').run(n.id));
  db.prepare('DELETE FROM bank_tree_nodes WHERE tree_id=?').run(id);
  db.prepare('DELETE FROM bank_trees WHERE id=?').run(id);
};
const treesOf = (subject) => db.prepare('SELECT * FROM bank_trees WHERE subject=? ORDER BY id').all(subject);
function cleanup() {
  treesOf(SUBJECT).forEach((t) => delTree(t.id));
  made.questions.forEach((id) => { db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(id); db.prepare('DELETE FROM questions WHERE id=?').run(id); });
  db.prepare("SELECT id FROM users WHERE username LIKE 'r2s%'").all().forEach((u) => db.prepare('DELETE FROM users WHERE id=?').run(u.id));
  if (origDefaults !== null) db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('default_editions', origDefaults);
  if (createdPhysics) db.prepare("SELECT id FROM bank_trees WHERE subject IN ('物理','化学') AND source='draft:needs-verify'").all().forEach((t) => delTree(t.id));
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

const countNodes = (treeId) => Number(db.prepare('SELECT COUNT(*) n FROM bank_tree_nodes WHERE tree_id=?').get(treeId).n);
const totalTrees = () => Number(db.prepare('SELECT COUNT(*) n FROM bank_trees').get().n);
const totalNodes = () => Number(db.prepare('SELECT COUNT(*) n FROM bank_tree_nodes').get().n);

// 一棵小树：三级，含 code / note
const SAMPLE = (edition, extra) => ({
  format: 'zhilexue-tree', version: 1, kind: 'textbook', subject: SUBJECT, stage: 'primary', edition,
  name: `${edition}${SUBJECT}·教材章节`, source: 'yangcong:test',
  nodes: [
    { name: '三年级', children: [
      { name: '上册', children: [
        { name: '一 混合运算', code: 'U1', children: [
          { name: '混合运算与数量关系', note: '重点', children: [{ name: '混合运算' }, { name: '列算式解决问题' }] },
          '小节二（字符串写法）',
        ] },
        { name: '二 千米和吨' },
      ] },
      { name: '下册' },
    ] },
    ...(extra || []),
  ],
});

(async () => {
  console.log('\n=== 知识树教材版本（R2）· 自测 ===\n');
  cleanup();

  const adm = await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } });
  const AT = adm.data && adm.data.token;
  log(!!AT, '管理员登录');
  const dbSaved = db.prepare("SELECT v FROM settings WHERE k='default_editions'").get();
  origDefaults = dbSaved ? dbSaved.v : JSON.stringify(treePick.DEFAULT_EDITIONS);

  // ---------- 1) 加列与迁移 ----------
  const cols = db.prepare('SHOW COLUMNS FROM bank_trees').all().map((c) => c.Field);
  log(cols.includes('edition'), 'bank_trees 有 edition 列');
  const ncols = db.prepare('SHOW COLUMNS FROM bank_tree_nodes').all().map((c) => c.Field);
  log(ncols.includes('code') && ncols.includes('note'), 'bank_tree_nodes 有 code / note 列（树导入导出带编号和备注）');

  const seedTree = (kind, subject, stage) => db.prepare('SELECT * FROM bank_trees WHERE source=?').get(`seed:v1:${kind}:${subject}:${stage}`);
  const expect = [['数学', 'primary', '苏教版', '苏教版数学·教材章节'], ['数学', 'junior', '苏科版', '苏科版数学·教材章节'],
    ['英语', 'primary', '译林版', '译林版英语·教材章节'], ['英语', 'junior', '译林版', '译林版英语·教材章节']];
  for (const [sj, sg, ed, nm] of expect) {
    const t = seedTree('textbook', sj, sg);
    log(t && t.edition === ed && t.name === nm, `种子章节树 ${sj}/${sg}：版本=${ed}，树名「${nm}」`, t ? `${t.edition} / ${t.name}` : '没有这棵树');
  }
  const kt = ['数学', '英语'].map((sj) => ['primary', 'junior'].map((sg) => seedTree('knowledge', sj, sg))).flat();
  log(kt.every((t) => t && !t.edition), '种子知识点树不分版本（通用）', kt.map((t) => t && t.edition).join('|'));
  // 题库管理页里不能再有两个同名的「苏科版数学·教材章节」
  const listAll = await req(`${MF}/trees?kind=textbook`, { token: AT });
  // 下拉显示的是「版本 · 学段 · 名称」：不能有两项一模一样（审计发现过「苏科版数学·教材章节」出现两遍）
  const labels = (listAll.data.list || []).map((t) => `${t.edition || '通用'} · ${t.stage} · ${t.name}`);
  log(labels.length === new Set(labels).size, '章节树的下拉显示（版本 · 学段 · 名称）没有重复', labels.slice(0, 4).join(' / '));
  const mathNames = (listAll.data.list || []).filter((t) => t.subject === '数学' && t.source.startsWith('seed:')).map((t) => t.name);
  log(mathNames.length === 2 && mathNames[0] !== mathNames[1], '种子里小学 / 初中数学章节树的树名不再相同', mathNames.join(' / '));
  log(listAll.data.defaults && listAll.data.defaults['数学'] && listAll.data.defaults['数学'].primary, 'GET /trees 同时带回默认版本表（前端 pickTree 用）');

  // 迁移幂等：把旧库状态还原成"没有版本 + 错误树名"，再跑一遍种子 → 被修正；节点数不变；用户改过的名字不动
  const st1 = seedTree('textbook', '数学', 'primary');
  const nodes1 = countNodes(st1.id);
  db.prepare("UPDATE bank_trees SET edition='', name='苏科版数学·教材章节' WHERE id=?").run(st1.id);
  require('./src/mfseed').ensureSeed(db);
  const st1b = db.prepare('SELECT * FROM bank_trees WHERE id=?').get(st1.id);
  log(st1b.edition === '苏教版' && st1b.name === '苏教版数学·教材章节' && countNodes(st1.id) === nodes1, '旧库状态（无版本 + 错误树名）重新跑种子后被修正，节点数不变', `${st1b.edition} / ${st1b.name} / ${countNodes(st1.id)}`);
  db.prepare("UPDATE bank_trees SET name='我自己改的名字' WHERE id=?").run(st1.id);
  require('./src/mfseed').ensureSeed(db);
  log(db.prepare('SELECT name FROM bank_trees WHERE id=?').get(st1.id).name === '我自己改的名字', '用户改过的树名，种子迁移不会改回去');
  db.prepare("UPDATE bank_trees SET name='苏教版数学·教材章节' WHERE id=?").run(st1.id);
  log(seedTree('textbook', '数学', 'primary').source === 'seed:v1:textbook:数学:primary', '种子 source 标识不变（保持幂等识别）');

  // ---------- 2) 默认版本表 ----------
  const ed0 = await req(`${MF}/editions`, { token: AT });
  const d0 = ed0.data && ed0.data.defaults;
  log(ed0.code === 0 && d0['数学'].primary === '苏教版' && d0['数学'].junior === '苏科版' && d0['英语'].primary === '译林版' && d0['英语'].junior === '译林版'
    && d0['物理'].junior === '苏科版' && d0['化学'].junior === '沪教版', '默认版本表：数学 小学苏教版 / 初中苏科版，英语译林版，物理苏科版，化学沪教版', JSON.stringify(d0));
  const ex = (ed0.data.existing || []);
  log(ex.some((x) => x.subject === '数学' && x.stage === 'primary' && x.kind === 'textbook' && x.edition === '苏教版')
    && ed0.data.grouped['数学'].primary.textbook.includes('苏教版'), '接口带回每个 学段/学科 下已存在的版本列表', `${ex.length} 棵树`);
  const bad1 = await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: { 数学: { xx: '苏教版' } } } });
  const bad2 = await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: '苏教版' } });
  log(bad1.code !== 0 && bad2.code !== 0, '默认版本表格式不对（学段不认识 / 不是对象）被拒绝', `${bad1.msg} | ${bad2.msg}`);
  const put1 = await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: { ...d0, [SUBJECT]: { primary: '乙版', junior: '甲版' } } } });
  log(put1.code === 0 && put1.data.defaults[SUBJECT].primary === '乙版', '保存默认版本表后读回一致', JSON.stringify(put1.data && put1.data.defaults[SUBJECT]));
  const stuTok = await req('/api/login', { method: 'POST', body: { username: '13800000001', password: '123456', role: 'student' } });
  const noAuth = await req(`${MF}/editions`, { token: stuTok.data && stuTok.data.token });
  log(noAuth._status === 403 || noAuth.code !== 0, '学生 token 不能读 / 改默认版本表', `HTTP ${noAuth._status}`);

  // ---------- 3) pickTree：后端 + 前端一致 ----------
  const mk = (kind, stage, edition, name) => Number(db.prepare('INSERT INTO bank_trees (kind,subject,stage,name,source,edition,sort,created_at) VALUES (?,?,?,?,?,?,?,?)').run(kind, SUBJECT, stage, name, 'r2-test', edition, 0, now).lastInsertRowid);
  const tA = mk('textbook', 'primary', '甲版', '甲版树'), tB = mk('textbook', 'primary', '乙版', '乙版树');
  const tK0 = mk('knowledge', 'primary', '', '通用知识点'), tKA = mk('knowledge', 'primary', '甲版', '甲版知识点');
  const tJ = mk('textbook', 'junior', '丙版', '丙版树');
  const cases = [
    ['教材 指定乙版', { kind: 'textbook', stage: 'primary', edition: '乙版' }, tB],
    ['教材 指定甲版', { kind: 'textbook', stage: 'primary', edition: '甲版' }, tA],
    ['教材 不指定 → 默认版本（乙版）', { kind: 'textbook', stage: 'primary' }, tB],
    ['教材 指定的版本不存在 → 默认版本', { kind: 'textbook', stage: 'primary', edition: '没有这个版' }, tB],
    ['教材 初中 默认甲版不存在 → 退回第一棵（丙版树）', { kind: 'textbook', stage: 'junior' }, tJ],
    ['知识点 不指定 → 优先"通用"', { kind: 'knowledge', stage: 'primary' }, tK0],
    ['知识点 指定甲版', { kind: 'knowledge', stage: 'primary', edition: '甲版' }, tKA],
    ['该学段没有树 → null', { kind: 'textbook', stage: 'senior' }, null],
    ['该种类没有树 → null', { kind: 'knowledge', stage: 'junior' }, null],
  ];
  const treesRows = db.prepare('SELECT * FROM bank_trees WHERE subject=?').all(SUBJECT);
  const ctx = vm.createContext({ api: async () => ({ list: treesRows, defaults: treePick.getDefaultEditions(db) }), console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/admin/treepick.js'), 'utf8') + '\nthis.__tp = { pickTree, tpTrees, tpEditions, treeLabel, tpOrder, TP };', ctx);
  const FE = ctx.__tp;
  await FE.tpTrees();
  for (const [name, args, want] of cases) {
    const be = treePick.pickTree(db, { ...args, subject: SUBJECT });
    const fe = FE.pickTree(treesRows, { ...args, subject: SUBJECT });
    log((be ? be.id : null) === (want || null) && (fe ? fe.id : null) === (want || null), `pickTree ${name}`, `后端=${be && be.name} 前端=${fe && fe.name}`);
  }
  const put2 = await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: { ...d0, [SUBJECT]: { primary: '甲版' } } } });
  const beNow = treePick.pickTree(db, { kind: 'textbook', subject: SUBJECT, stage: 'primary' });
  log(put2.code === 0 && beNow.id === tA, '改默认版本（乙版→甲版）后，不指定版本立即取到甲版树', beNow && beNow.name);
  FE.TP.defaults = treePick.getDefaultEditions(db);
  log(FE.pickTree(treesRows, { kind: 'textbook', subject: SUBJECT, stage: 'primary' }).id === tA, '前端同样跟着默认版本表走');
  const kb = require('./src/kbtree');
  log(kb.findTree(db, SUBJECT, 'primary').id === tK0, 'kbtree.findTree 走 pickTree：知识点树取"通用"那棵', kb.findTree(db, SUBJECT, 'primary').name);
  log(FE.treeLabel(treesRows.find((t) => t.id === tA)) === '甲版 · 小学 · 甲版树' && FE.treeLabel(treesRows.find((t) => t.id === tK0)) === '通用 · 小学 · 通用知识点', '下拉显示为「版本 · 学段 · 名称」', FE.treeLabel(treesRows.find((t) => t.id === tA)));
  log(JSON.stringify(FE.tpEditions(treesRows, { kind: 'textbook', subject: SUBJECT, stage: 'primary' })) === JSON.stringify(['甲版', '乙版']), '版本下拉只列该 学段+学科 下存在的版本，默认版本排第一', JSON.stringify(FE.tpEditions(treesRows, { kind: 'textbook', subject: SUBJECT, stage: 'primary' })));
  const ord = FE.tpOrder(treesRows.filter((t) => t.kind === 'textbook'), SUBJECT, 'primary').map((t) => t.name);
  log(ord[0] === '甲版树' && ord[ord.length - 1] === '丙版树', '弹窗里的树下拉：默认版本第一', ord.join(' > '));
  // 手动建树：同 学段+学科+版本 不能重复；章节树必须选版本
  const dupP = await req(`${MF}/trees`, { method: 'POST', token: AT, body: { name: 'x', kind: 'textbook', subject: SUBJECT, stage: 'primary', edition: '甲版' } });
  const noEd = await req(`${MF}/trees`, { method: 'POST', token: AT, body: { name: 'x', kind: 'textbook', subject: SUBJECT, stage: 'primary' } });
  const okNew = await req(`${MF}/trees`, { method: 'POST', token: AT, body: { name: '丁版树', kind: 'textbook', subject: SUBJECT, stage: 'primary', edition: '丁版' } });
  log(dupP.code !== 0 && noEd.code !== 0 && okNew.code === 0, '创建树：同 学段+学科+版本 已有一棵时拒绝；章节树必须选版本；新版本可以创建', `${dupP.msg} | ${noEd.msg}`);
  if (okNew.data) delTree(okNew.data.id);

  // ---------- 4) 导入格式 ----------
  const before = { trees: totalTrees(), nodes: totalNodes() };
  const doc = SAMPLE('戊版');
  const walkCount = (ns) => ns.reduce((a, n) => a + 1 + (typeof n === 'object' && n.children ? walkCount(n.children) : 0), 0);
  const N = walkCount(doc.nodes);
  const dry = await req(`${MF}/trees/import?dry=1`, { method: 'POST', token: AT, body: doc });
  log(dry.code === 0 && dry.data.dry === true && dry.data.added === N && dry.data.results[0].created_tree === true, `预检（?dry=1）：将新建树并新增 ${N} 个节点`, dry.msg);
  log(totalTrees() === before.trees && totalNodes() === before.nodes, '预检不写库（树数、节点数都没变）');
  const imp1 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: doc });
  const r1 = imp1.data && imp1.data.results[0];
  log(imp1.code === 0 && r1.created_tree && r1.added === N && r1.existing === 0, `导入：新建树，新增 ${N} 个节点`, imp1.msg);
  const tree1 = db.prepare("SELECT * FROM bank_trees WHERE subject=? AND edition='戊版'").get(SUBJECT);
  log(tree1 && tree1.kind === 'textbook' && tree1.stage === 'primary' && tree1.source === 'yangcong:test' && tree1.name === `戊版${SUBJECT}·教材章节`, '新树的 kind / 学段 / 版本 / 来源 / 树名来自文件', tree1 && `${tree1.name} ${tree1.source}`);
  const imp2 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: doc });
  log(imp2.code === 0 && imp2.data.added === 0 && imp2.data.existing === N && !imp2.data.results[0].created_tree && countNodes(tree1.id) === N, '重复导入同一个文件：新增 0（幂等）', imp2.msg);
  // 顺序：同级按文件顺序
  const kids = (parentName) => {
    const p = db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND name=?').get(tree1.id, parentName);
    return db.prepare('SELECT name FROM bank_tree_nodes WHERE tree_id=? AND parent_id=? ORDER BY sort, id').all(tree1.id, p.id).map((x) => x.name);
  };
  log(JSON.stringify(kids('上册')) === JSON.stringify(['一 混合运算', '二 千米和吨']) && JSON.stringify(kids('混合运算与数量关系')) === JSON.stringify(['混合运算', '列算式解决问题']), '同级节点保持文件里的顺序（sort）');
  const codeRow = db.prepare("SELECT code, note FROM bank_tree_nodes WHERE tree_id=? AND name IN ('一 混合运算','混合运算与数量关系')").all(tree1.id);
  log(codeRow.some((r) => r.code === 'U1') && codeRow.some((r) => r.note === '重点'), '节点的 code / note 被保存');
  // 按路径合并：往已有树里补一个新分支 + 在已有路径下新增一个叶子；已有节点一个不重复
  const merge = SAMPLE('戊版', [{ name: '四年级', children: [{ name: '上册', children: [{ name: '一 新单元' }] }] }]);
  merge.nodes[0].children[0].children[0].children.push({ name: '新增小节' });
  const imp3 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: merge });
  log(imp3.code === 0 && imp3.data.added === 4 && imp3.data.existing === N, '按路径合并：已有路径不重复，只新增 4 个（四年级 / 上册 / 一 新单元 / 新增小节）', `新增 ${imp3.data && imp3.data.added}，已存在 ${imp3.data && imp3.data.existing}`);
  const upCount = db.prepare("SELECT COUNT(*) n FROM bank_tree_nodes WHERE tree_id=? AND name='上册'").get(tree1.id).n;
  log(Number(upCount) === 2, '「三年级/上册」与「四年级/上册」是两个节点（路径不同，不会误合并）', `上册 ${upCount} 个`);
  // 导出
  const exp = await req(`${MF}/trees/${tree1.id}/export`, { token: AT });
  const ed = exp.data;
  log(exp.code === 0 && ed.format === 'zhilexue-tree' && ed.version === 1 && ed.kind === 'textbook' && ed.subject === SUBJECT && ed.stage === 'primary' && ed.edition === '戊版'
    && ed.name === tree1.name && Array.isArray(ed.nodes) && ed.nodes[0].name === '三年级', '导出：同一格式（format / version / kind / subject / stage / edition / name / nodes）');
  // 导出再导入一致：换一个版本导进去 → 新树节点数相同、结构完全一致
  const copy = { ...ed, edition: '己版', name: '己版树' };
  const imp4 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: copy });
  const tree2 = db.prepare("SELECT * FROM bank_trees WHERE subject=? AND edition='己版'").get(SUBJECT);
  const exp2 = await req(`${MF}/trees/${tree2.id}/export`, { token: AT });
  const strip = (d) => JSON.stringify(d.nodes);
  log(imp4.code === 0 && imp4.data.added === countNodes(tree1.id) && strip(exp2.data) === strip(ed), '导出 → 改版本 → 再导入：节点数相同，导出结构逐字一致（含顺序、code、note）', `${countNodes(tree2.id)} 个`);
  const imp5 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: ed });
  log(imp5.code === 0 && imp5.data.added === 0, '导出的文件原样导回原树：新增 0', imp5.msg);
  // 数组 + 文件上传
  const arr = [SAMPLE('庚版'), { ...SAMPLE('庚版'), kind: 'knowledge', stage: 'junior', edition: '', name: '通用知识点（R2测试）' }];
  const imp6 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: arr });
  log(imp6.code === 0 && imp6.data.results.length === 2 && imp6.data.results.every((r) => r.created_tree && r.added === N), '一个文件可以是数组：两棵树（章节树 + 通用知识点树）一起导入', imp6.msg);
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify(SAMPLE('辛版'))], { type: 'application/json' }), '辛版.json');
  const imp7 = await req(`${MF}/trees/import`, { method: 'POST', token: AT, form: fd });
  log(imp7.code === 0 && imp7.data.added === N, '上传 .json 文件导入（multipart）', imp7.msg);
  // 格式错误：不写库，提示原因
  const badCases = [
    ['format 不对', { ...SAMPLE('壬版'), format: 'other' }],
    ['章节树没写 edition', { ...SAMPLE(''), edition: '' }],
    ['stage 不认识', { ...SAMPLE('壬版'), stage: 'college' }],
    ['kind 不认识', { ...SAMPLE('壬版'), kind: 'xx' }],
    ['nodes 为空', { ...SAMPLE('壬版'), nodes: [] }],
    ['节点缺 name', { ...SAMPLE('壬版'), nodes: [{ children: [] }] }],
    ['version 不支持', { ...SAMPLE('壬版'), version: 9 }],
  ];
  const t0 = totalTrees();
  for (const [name, body] of badCases) {
    const r = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body });
    log(r.code !== 0 && !!r.msg, `格式错误被拒绝：${name}`, r.msg);
  }
  const mixed = await req(`${MF}/trees/import`, { method: 'POST', token: AT, body: [SAMPLE('壬版'), { ...SAMPLE('癸版'), format: 'x' }] });
  log(mixed.code !== 0 && totalTrees() === t0 && !db.prepare("SELECT 1 x FROM bank_trees WHERE subject=? AND edition='壬版'").get(SUBJECT), '数组里有一棵格式错：整体拒绝，另一棵也没有被写入', mixed.msg);
  const notFound = await req(`${MF}/trees/99999999/export`, { token: AT });
  log(notFound.code !== 0, '导出不存在的树：提示');
  const noAuth2 = await req(`${MF}/trees/import`, { method: 'POST', token: stuTok.data && stuTok.data.token, body: SAMPLE('壬版') });
  log(noAuth2._status === 403 || noAuth2.code !== 0, '学生 token 不能导入树', `HTTP ${noAuth2._status}`);

  // ---------- 5) 命令行脚本 ----------
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2tree-'));
  const cliDir = path.join(tmpDir, 'trees');
  fs.mkdirSync(cliDir);
  fs.writeFileSync(path.join(cliDir, 'a.json'), JSON.stringify(SAMPLE('子版')));
  fs.writeFileSync(path.join(cliDir, 'b.json'), JSON.stringify([{ ...SAMPLE('丑版') }]));
  fs.writeFileSync(path.join(cliDir, 'bad.json'), JSON.stringify({ hello: 1 }));
  const runCli = (args) => {
    try { return { code: 0, out: execFileSync('node', [path.join(__dirname, 'scripts/import-trees.js'), ...args], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
  };
  const c0 = { trees: totalTrees(), nodes: totalNodes() };
  const dryRun = runCli([cliDir, '--dry-run']);
  log(dryRun.out.includes(DB_INFO.database) && dryRun.out.includes('dry-run') && totalNodes() === c0.nodes && totalTrees() === c0.trees, '脚本 --dry-run：打印目标库名、不写库', dryRun.out.split('\n')[0]);
  log(/新增 \d+/.test(dryRun.out) && dryRun.code === 1 && dryRun.out.includes('bad.json'), '格式不对的文件被跳过并提示，其它文件照常统计，退出码非 0', `exit ${dryRun.code}`);
  fs.rmSync(path.join(cliDir, 'bad.json'));
  const real = runCli([cliDir]);
  log(real.code === 0 && totalNodes() === c0.nodes + 2 * N && totalTrees() === c0.trees + 2, `脚本正式导入：2 个文件、新建 2 棵树、新增 ${2 * N} 个节点`, real.out.trim().split('\n').pop());
  const real2 = runCli([cliDir]);
  log(real2.code === 0 && totalNodes() === c0.nodes + 2 * N && /共新增 0 个节点/.test(real2.out), '脚本重复执行：新增 0（幂等）', real2.out.trim().split('\n').pop());
  const draftDry = runCli([path.join(__dirname, 'data/trees/draft'), '--dry-run']);
  log(draftDry.code === 0 && /物理/.test(draftDry.out) && /化学/.test(draftDry.out), '草稿目录 data/trees/draft 能被脚本识别（物理 / 化学）', draftDry.out.split('\n').filter((l) => /章节树/.test(l)).join(' | ').slice(0, 160));

  // ---------- 6) 学生端：按学生学段 + 默认版本取树 ----------
  const addStu = (i, grade) => {
    const username = `r2s${uniq}${i}`;
    const id = Number(db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,?,1,1,'2099-12-31',1,?)")
      .run(username, hash('123456'), 'R2学生' + i, grade, '上册', now).lastInsertRowid);
    made.users.push(id); return { id, username };
  };
  const sP = addStu(1, '四年级'), sJ = addStu(2, '八年级');
  const login = async (s) => (await req('/api/login', { method: 'POST', body: { username: s.username, password: '123456', role: 'student' } })).data.token;
  const tP = await login(sP), tJs = await login(sJ);
  // 学科用真实的"数学"：小学默认苏教版，再造一棵同学段同学科的"苏科版"章节树（只在本测试里存在）
  const extra = Number(db.prepare('INSERT INTO bank_trees (kind,subject,stage,name,source,edition,sort,created_at) VALUES (?,?,?,?,?,?,?,?)').run('textbook', '数学', 'primary', 'R2测试·苏科版数学小学', 'r2-test', '苏科版', 9, now).lastInsertRowid);
  const exNode = Number(db.prepare('INSERT INTO bank_tree_nodes (tree_id,parent_id,name,sort,created_at) VALUES (?,?,?,?,?)').run(extra, null, 'R2测试节点', 0, now).lastInsertRowid);
  const sd = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('数学')}`, { token: tP });
  log(sd.code === 0 && sd.data.tree_id === st1.id && sd.data.edition === '苏教版' && sd.data.nodes.length > 10 && sd.data.nodes.every((n) => n.tree_id === st1.id), '小学学生 scan-tree（数学）：返回默认版本「苏教版」的那一棵，不混入同学段的其它版本', `${sd.data && sd.data.tree_name} ${sd.data && sd.data.nodes.length} 节点`);
  const sdJ = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('数学')}`, { token: tJs });
  const jt = seedTree('textbook', '数学', 'junior');
  log(sdJ.code === 0 && sdJ.data.tree_id === jt.id && sdJ.data.edition === '苏科版', '初中学生 scan-tree（数学）：学段不同 → 初中苏科版', `${sdJ.data && sdJ.data.tree_name}`);
  const sdE = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('数学')}&edition=${encodeURIComponent('苏科版')}`, { token: tP });
  log(sdE.code === 0 && sdE.data.tree_id === extra, '指定 ?edition=苏科版 时返回该版本的树', sdE.data && sdE.data.tree_name);
  const cur = treePick.getDefaultEditions(db);
  await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: { ...cur, 数学: { ...cur['数学'], primary: '苏科版' } } } });
  const sd2 = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('数学')}`, { token: tP });
  log(sd2.code === 0 && sd2.data.tree_id === extra, '把小学数学的默认版本改成苏科版 → 学生端立即换成那一棵', sd2.data && sd2.data.tree_name);
  // scan-compose：用那棵树的节点组卷
  const qid = Number(db.prepare(`INSERT INTO questions (subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,created_at) VALUES ('数学','四年级','primary','fill','R2测试题 ____','[]','1','解析',3,'',?)`).run(now).lastInsertRowid);
  made.questions.push(qid);
  db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)').run(qid, exNode);
  const sc = await req(`${STU}/scan-compose`, { method: 'POST', token: tP, body: { kind: 'textbook', subject: '数学', node_ids: [exNode] } });
  log(sc.code === 0 && sc.data.items.length === 1 && sc.data.items[0].node_name === 'R2测试节点', '学生端章节组卷：用 scan-tree 给的那棵树里的节点组卷', sc.msg);
  const scBad = await req(`${STU}/scan-compose`, { method: 'POST', token: tP, body: { kind: 'textbook', subject: '英语', node_ids: [exNode] } });
  log(scBad.code !== 0, '节点不属于所选学科的树：拒绝', scBad.msg);
  await req(`${MF}/editions`, { method: 'PUT', token: AT, body: { defaults: cur } });
  const sd3 = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('数学')}`, { token: tP });
  log(sd3.data.tree_id === st1.id, '默认版本改回苏教版 → 学生端恢复', sd3.data && sd3.data.tree_name);
  delTree(extra);
  // 物理 / 化学：有树后学生端能选到（草稿树只在本测试里导入，测完删掉）
  if (!db.prepare("SELECT 1 x FROM bank_trees WHERE subject='物理' AND kind='textbook' AND stage='junior'").get()) {
    createdPhysics = true;
    runCli([path.join(__dirname, 'data/trees/draft')]);
  }
  const ph = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('物理')}`, { token: tJs });
  log(ph.code === 0 && ph.data.nodes.length > 50 && ph.data.edition === '苏科版', '初中学生 scan-tree（物理）：有树后能选到，版本苏科版', `${ph.data && ph.data.tree_name} ${ph.data && ph.data.nodes.length} 节点`);
  const chm = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('化学')}`, { token: tJs });
  log(chm.code === 0 && chm.data.nodes.length > 20 && chm.data.edition === '沪教版', '初中学生 scan-tree（化学）：沪教版', `${chm.data && chm.data.tree_name} ${chm.data && chm.data.nodes.length} 节点`);
  const phP = await req(`${STU}/scan-tree?kind=textbook&subject=${encodeURIComponent('物理')}`, { token: tP });
  log(phP.code === 0 && phP.data.nodes.length === 0, '小学学生看物理：没有树（物理只有初中）', `节点 ${phP.data && phP.data.nodes.length}`);

  cleanup();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (e2) { /* 忽略 */ } process.exit(1); });
