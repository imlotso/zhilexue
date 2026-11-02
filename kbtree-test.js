'use strict';
/**
 * 知识树统一（T4）自测： node kbtree-test.js
 * 直接用 src/db（需要 MySQL，库里已执行过 npm run seed 更佳）。测试数据用专用学科/年级名，结束后清理。
 * 覆盖：旧 kb_* → bank_trees 复制（并入已有知识点树、幂等、dry-run）、旧接口返回结构、增删级联、AI 合并不删、
 *       知识点清单（含未迁移时回退读旧表）。
 */
const { db } = require('./src/db');
const kb = require('./src/kbtree');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { console.log(`  ${c ? 'OK ' : 'FAIL'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nodeCount = () => db.prepare('SELECT COUNT(*) AS n FROM bank_tree_nodes').get().n;
const treeCount = (subject, stage) => db.prepare("SELECT COUNT(*) AS n FROM bank_trees WHERE kind='knowledge' AND subject=? AND stage=?").get(subject, stage).n;
const now = '2026-11-02 00:00:00';
const GR = 'T4测试年级', GR2 = 'T4另一年级';
const created = { units: [], points: [] };

function addKb(subject, stage, grade, unitName, points, sort) {
  const u = db.prepare('INSERT INTO kb_units (subject,stage,grade,edition,name,sort,created_at) VALUES (?,?,?,?,?,?,?)').run(subject, stage, grade, '测试版', unitName, sort, now).lastInsertRowid;
  created.units.push(u);
  points.forEach((p, i) => { created.points.push(db.prepare('INSERT INTO kb_points (unit_id,name,sort,created_at) VALUES (?,?,?,?)').run(u, p, i, now).lastInsertRowid); });
  return u;
}
function cleanup() {
  created.points.forEach((id) => db.prepare('DELETE FROM kb_points WHERE id=?').run(id));
  created.units.forEach((id) => db.prepare('DELETE FROM kb_units WHERE id=?').run(id));
  // 数学·初中：只删本测试建的"教材单元知识点"分支（种子树保留）；物理·小学：整棵测试树删掉
  ['数学:junior', '物理:primary'].forEach((k) => {
    const [subject, stage] = k.split(':');
    const b = kb.branchOf(db, subject, stage);
    if (b) kb.deleteNode(db, b.branch.id);
  });
  const t = kb.findTree(db, '物理', 'primary');
  if (t && String(t.source) === 'kbtree:物理:primary') db.prepare('DELETE FROM bank_trees WHERE id=?').run(t.id);
  db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(999999);
}

(async () => {
  cleanup();   // 上次中断留下的残余

  // ---------- 准备：数学·初中 已有种子知识点树；物理·小学 没有树 ----------
  const seeded = kb.findTree(db, '数学', 'junior');
  ok(!!seeded, '数学·初中 已有种子知识点树（npm run seed / 启动时自动建）', seeded ? 'tree#' + seeded.id : '没有，请先 npm run seed');
  if (!seeded) { console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(1); }
  ok(kb.findTree(db, '物理', 'primary') === null, '物理·小学 没有知识点树（用来测"新建树"）');

  addKb('数学', 'junior', GR, 'T4单元一', ['T4知识点甲', 'T4知识点乙'], 0);
  addKb('数学', 'junior', GR, 'T4单元二', ['T4知识点丙'], 1);
  addKb('数学', 'junior', GR2, 'T4单元三', ['T4知识点丁'], 0);
  addKb('物理', 'primary', '', 'T4物理单元', ['T4物理点'], 0);

  // ---------- 未迁移时：读取回退到旧表，不改库 ----------
  const nBefore = nodeCount();
  ok(eq(kb.pointNames(db, { subject: '物理', stage: 'primary' }), ['T4物理点']), '未迁移：知识点清单回退读旧表', JSON.stringify(kb.pointNames(db, { subject: '物理', stage: 'primary' })));
  ok(kb.unitLines(db, '物理').some((u) => u.name === 'T4物理单元'), '未迁移：AI 归属参照回退读旧表');
  ok(nodeCount() === nBefore, '只读回退不修改 bank_tree_nodes');

  // ---------- dry-run ----------
  const d = kb.migrateOne(db, '数学', 'junior', { dry: true });
  ok(d.created === 1 + 2 + 3 + 4 && nodeCount() === nBefore,
    'dry-run 只统计不写库', `将新增 ${d.created}（分支1 + 年级2 + 单元3 + 知识点4）；节点数 ${nBefore} → ${nodeCount()}`);
  const dNew = kb.migrateOne(db, '物理', 'primary', { dry: true });
  ok(dNew.created === 1 + 1 + 1 + 1 && nodeCount() === nBefore && kb.findTree(db, '物理', 'primary') === null,
    'dry-run 对没有树的学科也不建树', 'created=' + dNew.created);

  // ---------- 真迁移：并入已有树 ----------
  const m = kb.migrateOne(db, '数学', 'junior');
  ok(m.created === 10 && m.units === 3 && m.points === 4, '数学·初中 复制成功', JSON.stringify(m));
  ok(treeCount('数学', 'junior') === 1, '并入已有知识点树，没有新建第二棵（题库管理按"学段+学科唯一一棵树"取树）', '树数=' + treeCount('数学', 'junior'));
  const b = kb.branchOf(db, '数学', 'junior');
  ok(b && b.tree.id === seeded.id && b.branch.id > 0, '分支「教材单元知识点」建在种子树下', 'tree#' + (b && b.tree.id));
  const grades = db.prepare('SELECT name FROM bank_tree_nodes WHERE parent_id=? ORDER BY sort, id').all(b.branch.id).map((r) => r.name);
  ok(eq(grades.sort(), [GR, GR2].sort()), '分支下按年级分层', grades.join(' / '));
  const m2 = kb.migrateOne(db, '数学', 'junior');
  ok(m2.created === 0 && nodeCount() === nBefore + 10, '重复执行幂等：新增 0 个节点', 'created=' + m2.created);
  const all = kb.migrateAll(db);
  ok(all.list.some((x) => x.subject === '物理') && treeCount('物理', 'primary') === 1, 'migrateAll 覆盖其它学科，并为没有树的学科新建一棵', all.list.map((x) => x.subject + x.stage).join(','));
  ok(kb.migrateAll(db).created === 0, 'migrateAll 重复执行幂等');
  ok(db.prepare('SELECT COUNT(*) AS n FROM kb_units').get().n >= 4, '旧表 kb_units 保持不变（只复制不删）');

  // ---------- 旧接口返回结构 ----------
  const units = kb.readUnits(db, '数学', 'junior', GR);
  ok(units.length === 2 && units[0].name === 'T4单元一' && eq(units[0].points.map((p) => p.name), ['T4知识点甲', 'T4知识点乙']) && units[0].id > 0 && units[0].points[0].id > 0,
    'readUnits 保持旧结构 [{id,name,points:[{id,name}]}]（按年级）', JSON.stringify(units.map((u) => u.name)));
  ok(kb.readUnits(db, '数学', 'junior', '不存在的年级').length === 0, '没有的年级返回空数组');

  // ---------- 知识点清单 ----------
  const names = kb.pointNames(db, { subject: '数学', stage: 'junior' });
  ok(['T4知识点甲', 'T4知识点乙', 'T4知识点丙', 'T4知识点丁'].every((n) => names.includes(n)), '知识点清单含迁移来的全部知识点');
  ok(!names.includes(GR) && !names.includes('T4单元一') && !names.includes('教材单元知识点'), '知识点清单不含年级/单元/分支名');
  ok(names.length > 4, '知识点清单还含种子知识点树（组卷网分类）的叶子', '共 ' + names.length + ' 个');
  const g1 = kb.pointNames(db, { subject: '数学', stage: 'junior', grade: GR });
  ok(g1.includes('T4知识点甲') && !g1.includes('T4知识点丁'), '指定年级时排除分支里其它年级的知识点');
  ok(kb.pointNames(db, { subject: '物理', stage: 'primary' }).filter((n) => n === 'T4物理点').length === 1, '迁移后与旧表不重复计入（物理点只出现 1 次）');

  // ---------- 旧接口写入：增 / 删级联 ----------
  const uid = kb.addUnit(db, '数学', 'junior', GR, 'T4新增单元', 5);
  const pid = kb.addPoint(db, uid, 'T4新增知识点', 0);
  ok(uid > 0 && pid > 0 && kb.readUnits(db, '数学', 'junior', GR).some((u) => u.name === 'T4新增单元' && u.points.some((p) => p.name === 'T4新增知识点')), 'addUnit / addPoint 写入知识点树');
  ok(kb.addUnit(db, '数学', 'junior', GR, 'T4新增单元', 5) === uid, '同名单元不重复建');
  ok(kb.addPoint(db, 99999999, 'x', 0) === null, '单元不存在时 addPoint 返回 null');
  db.prepare('INSERT INTO question_nodes (question_id, node_id) VALUES (?,?)').run(999999, pid);
  const delN = kb.deleteNode(db, uid);
  ok(delN === 2, 'deleteNode 连同子节点删除', '删了 ' + delN + ' 个');
  ok(db.prepare('SELECT COUNT(*) AS n FROM question_nodes WHERE node_id=?').get(pid).n === 0, '删除节点时清掉题目关联');
  ok(kb.deleteNode(db, 99999999) === 0, '删除不存在的节点返回 0');

  // ---------- AI 合并：只增不删 ----------
  const before = nodeCount();
  const g = kb.mergeGenerated(db, '数学', 'junior', GR, [{ name: 'T4单元一', points: ['T4知识点甲', 'T4生成点'] }, { name: 'T4生成单元', points: ['T4生成点2'] }]);
  ok(g.created === 3 && nodeCount() === before + 3, 'mergeGenerated 只新增不存在的节点（已有的单元与知识点保留）', JSON.stringify(g));
  ok(kb.readUnits(db, '数学', 'junior', GR).some((u) => u.name === 'T4单元二'), '合并后，AI 没提到的旧单元仍在（不会被覆盖删除）');
  ok(kb.mergeGenerated(db, '数学', 'junior', GR, [{ name: 'T4生成单元', points: ['T4生成点2'] }]).created === 0, '合并重复执行新增 0');

  // ---------- AI 归属参照 ----------
  ok(kb.unitLines(db, '数学').some((u) => u.name === 'T4单元三' && u.grade === GR2 && u.stage === 'junior'), 'unitLines 来自知识点树（含年级）');

  cleanup();
  ok(db.prepare("SELECT COUNT(*) AS n FROM bank_tree_nodes WHERE name LIKE 'T4%'").get().n === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* 忽略 */ } process.exit(1); });
