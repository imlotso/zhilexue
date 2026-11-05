'use strict';
/**
 * 知识树统一（T4）
 * 以 bank_trees / bank_tree_nodes 为唯一编辑源。旧「教材知识点树」（kb_units / kb_points，按 学科+学段+年级 → 单元 → 知识点）
 * 保留表和旧接口，只做"复制"：并入该 学科+学段 已有的知识点树（kind=knowledge），作为一个独立的一级分支：
 *
 *   知识点树（学科+学段 下的"通用"知识点树，经 treepick.pickTree 取）
 *   └─ 教材单元知识点          ← BRANCH，本模块维护
 *      └─ 七年级              ← 年级节点（kb_units.grade；空则"不分年级"）
 *         └─ 第1单元 有理数    ← 单元节点（kb_units.name）
 *            └─ 正数和负数     ← 知识点节点（kb_points.name）
 *
 * 所有函数都是幂等的"找或建"（同父同名不重复建），只增不删。迁移只复制，不改 kb_* 表。
 */
const { pickTree } = require('./treepick');
const STAGE_NAME = { primary: '小学', junior: '初中' };
const GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const BRANCH = '教材单元知识点';
const NO_GRADE = '不分年级';

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const gradeSort = (g) => { const i = GRADES.indexOf(g); return i < 0 ? GRADES.length : i; };

/** 学科+学段下的知识点树（R2：统一走 treepick.pickTree——优先"通用"（版本为空）的那棵，再按默认版本，最后取第一棵） */
function findTree(db, subject, stage, kind = 'knowledge', edition = '') {
  return pickTree(db, { kind, subject, stage, edition });
}

function ensureKnowledgeTree(db, subject, stage) {
  const t = findTree(db, subject, stage);
  if (t) return t;
  const name = `${subject}·${STAGE_NAME[stage] || stage}知识点树`;
  const info = db.prepare('INSERT INTO bank_trees (kind, subject, stage, name, source, edition, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('knowledge', subject, stage, name, `kbtree:${subject}:${stage}`, '', 0, now());
  return { id: info.lastInsertRowid, kind: 'knowledge', subject, stage, name };
}

function nodeFind(db, treeId, parentId, name) {
  return parentId == null
    ? db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id IS NULL AND name=?').get(treeId, name)
    : db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id=? AND name=?').get(treeId, parentId, name);
}

/**
 * 找或建一个节点；st.created 累计新建个数。
 * dry=true 只计数不写库：将要新建的节点记在 st.virtual 里并返回负数 id，同一个"将要新建的节点"被再次引用时不重复计数
 */
function nodeEnsure(db, treeId, parentId, name, sort, st, dry) {
  name = String(name || '').trim().slice(0, 120);
  if (!name) return null;
  if (dry) {
    st.virtual = st.virtual || new Map();
    const virtualParent = treeId < 0 || (parentId != null && parentId < 0);
    if (!virtualParent) {
      const row = nodeFind(db, treeId, parentId, name);
      if (row) return row.id;
    }
    const key = `${treeId}|${parentId}|${name}`;
    if (st.virtual.has(key)) return st.virtual.get(key);
    const vid = -(st.virtual.size + 1);
    st.virtual.set(key, vid);
    st.created = (st.created || 0) + 1;
    return vid;
  }
  const row = nodeFind(db, treeId, parentId, name);
  if (row) return row.id;
  st.created = (st.created || 0) + 1;
  const info = db.prepare('INSERT INTO bank_tree_nodes (tree_id, parent_id, name, sort, created_at) VALUES (?,?,?,?,?)')
    .run(treeId, parentId, name, Number(sort) || 0, now());
  return info.lastInsertRowid;
}

/** 该 学科+学段 的"教材单元知识点"分支；没有返回 null */
function branchOf(db, subject, stage) {
  const tree = findTree(db, subject, stage);
  if (!tree) return null;
  const b = nodeFind(db, tree.id, null, BRANCH);
  return b ? { tree, branch: b } : null;
}

const hasLegacy = (db, subject, stage) =>
  !!db.prepare('SELECT 1 AS x FROM kb_units WHERE subject=? AND stage=? LIMIT 1').get(subject, stage);

/** 把一个 学科+学段 的 kb_units/kb_points 复制进知识点树。返回 {units, points, created}；dry=true 只统计 */
function migrateOne(db, subject, stage, { dry = false } = {}) {
  const units = db.prepare('SELECT * FROM kb_units WHERE subject=? AND stage=? ORDER BY sort, id').all(subject, stage);
  const out = { subject, stage, units: units.length, points: 0, created: 0 };
  if (!units.length) return out;
  const st = { created: 0 };
  const tree = dry ? (findTree(db, subject, stage) || { id: -1 }) : ensureKnowledgeTree(db, subject, stage);
  const branch = nodeEnsure(db, tree.id, null, BRANCH, 99, st, dry);
  const ptsOf = db.prepare('SELECT * FROM kb_points WHERE unit_id=? ORDER BY sort, id');
  units.forEach((u) => {
    const g = String(u.grade || '').trim() || NO_GRADE;
    const gid = nodeEnsure(db, tree.id, branch, g, gradeSort(g), st, dry);
    const uid = nodeEnsure(db, tree.id, gid, u.name, u.sort, st, dry);
    ptsOf.all(u.id).forEach((p) => { out.points++; nodeEnsure(db, tree.id, uid, p.name, p.sort, st, dry); });
  });
  out.created = st.created;
  return out;
}

/** 全部 学科+学段 */
function migrateAll(db, opts = {}) {
  const pairs = db.prepare('SELECT DISTINCT subject, stage FROM kb_units ORDER BY subject, stage').all();
  const list = pairs.map((p) => migrateOne(db, p.subject, p.stage, opts));
  return {
    list,
    units: list.reduce((a, x) => a + x.units, 0),
    points: list.reduce((a, x) => a + x.points, 0),
    created: list.reduce((a, x) => a + x.created, 0),
  };
}

/** 保证分支存在（没有就先把旧表内容复制进来，再没有就建空分支）。写入类接口用 */
function ensureBranch(db, subject, stage) {
  let b = branchOf(db, subject, stage);
  if (b) return b;
  if (hasLegacy(db, subject, stage)) migrateOne(db, subject, stage);
  const tree = ensureKnowledgeTree(db, subject, stage);
  nodeEnsure(db, tree.id, null, BRANCH, 99, {}, false);
  b = branchOf(db, subject, stage);
  return b;
}

const childrenOf = (db, parentId) => db.prepare('SELECT id, name, sort FROM bank_tree_nodes WHERE parent_id=? ORDER BY sort, id').all(parentId);

/** 旧接口 GET /kbtree 的返回结构：[{id, name, points:[{id,name}]}]，id 为新树节点 id。尚未复制且旧表有数据时先复制 */
function readUnits(db, subject, stage, grade) {
  if (!branchOf(db, subject, stage) && hasLegacy(db, subject, stage)) migrateOne(db, subject, stage);
  const b = branchOf(db, subject, stage);
  if (!b) return [];
  const g = nodeFind(db, b.tree.id, b.branch.id, String(grade || '').trim() || NO_GRADE);
  if (!g) return [];
  return childrenOf(db, g.id).map((u) => ({ id: u.id, name: u.name, points: childrenOf(db, u.id).map((p) => ({ id: p.id, name: p.name })) }));
}

/** 新增单元（旧接口 POST /kbtree/unit） */
function addUnit(db, subject, stage, grade, name, sort) {
  const b = ensureBranch(db, subject, stage);
  const g = String(grade || '').trim() || NO_GRADE;
  const gid = nodeEnsure(db, b.tree.id, b.branch.id, g, gradeSort(g), {}, false);
  return nodeEnsure(db, b.tree.id, gid, name, sort, {}, false);
}

/** 在单元下新增知识点（旧接口 POST /kbtree/point） */
function addPoint(db, unitNodeId, name, sort) {
  const u = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=?').get(Number(unitNodeId));
  if (!u) return null;
  return nodeEnsure(db, u.tree_id, u.id, name, sort, {}, false);
}

/** 删节点及全部后代，并清掉题目关联。返回删除的节点数 */
function deleteNode(db, id) {
  const n = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=?').get(Number(id));
  if (!n) return 0;
  const all = db.prepare('SELECT id, parent_id FROM bank_tree_nodes WHERE tree_id=?').all(n.tree_id);
  const kids = {};
  all.forEach((x) => { if (x.parent_id) (kids[x.parent_id] = kids[x.parent_id] || []).push(x.id); });
  const del = new Set([n.id]); const stack = [n.id];
  while (stack.length) { const c = stack.pop(); (kids[c] || []).forEach((k) => { if (!del.has(k)) { del.add(k); stack.push(k); } }); }
  const dl = db.prepare('DELETE FROM question_nodes WHERE node_id=?');
  const dn = db.prepare('DELETE FROM bank_tree_nodes WHERE id=?');
  del.forEach((x) => { dl.run(x); dn.run(x); });
  return del.size;
}

/** AI 生成结果合并进树：只新增、不删除（树上挂着题目关联，覆盖会丢）。返回 {units, points, created} */
function mergeGenerated(db, subject, stage, grade, units) {
  const b = ensureBranch(db, subject, stage);
  const st = { created: 0 };
  const gname = String(grade || '').trim() || NO_GRADE;
  const gid = nodeEnsure(db, b.tree.id, b.branch.id, gname, gradeSort(gname), st, false);
  let nu = 0, np = 0;
  units.forEach((u, i) => {
    const uid = nodeEnsure(db, b.tree.id, gid, u.name, i, st, false);
    if (!uid) return;
    nu++;
    (Array.isArray(u.points) ? u.points : []).forEach((p, k) => { if (nodeEnsure(db, b.tree.id, uid, p, k, st, false)) np++; });
  });
  return { units: nu, points: np, created: st.created };
}

/**
 * 知识点名称清单（给 AI 补全 / 下拉框用）：知识点树里所有"叶子"节点的名字。
 * grade 非空时，排除"教材单元知识点"分支里其它年级下的节点。stage 为空 = 该学科所有学段。
 * 新树里没有这个 学科+学段 的教材分支、但旧表有数据时，补上旧表的知识点名（还没迁移的老库行为不变）。
 */
function pointNames(db, { subject, stage = '', grade = '' }) {
  const trees = stage
    ? db.prepare("SELECT id, stage FROM bank_trees WHERE kind='knowledge' AND subject=? AND stage=?").all(subject, stage)
    : db.prepare("SELECT id, stage FROM bank_trees WHERE kind='knowledge' AND subject=?").all(subject);
  const names = [];
  const seen = new Set();
  const push = (n) => { const t = String(n || '').trim(); if (t && !seen.has(t)) { seen.add(t); names.push(t); } };
  trees.forEach((t) => {
    const nodes = db.prepare('SELECT id, parent_id, name FROM bank_tree_nodes WHERE tree_id=? ORDER BY sort, id').all(t.id);
    const byId = {}; const hasKid = new Set();
    nodes.forEach((n) => { byId[n.id] = n; if (n.parent_id) hasKid.add(n.parent_id); });
    // 节点在"教材单元知识点"分支里时返回 {grade, depth}（depth：分支=1 年级=2 单元=3 知识点=4）；不在分支里返回 null
    const inBranch = (n) => {
      let cur = n; const path = [];
      while (cur) { path.unshift(cur); cur = cur.parent_id ? byId[cur.parent_id] : null; }
      return path[0] && path[0].name === BRANCH ? { grade: path[1] ? path[1].name : null, depth: path.length } : null;
    };
    nodes.forEach((n) => {
      if (hasKid.has(n.id)) return;
      const b = inBranch(n);
      if (b) {
        if (b.depth < 4) return;                 // 空的分支/年级/单元节点不是知识点
        if (grade && b.grade !== grade) return;  // 其它年级的知识点
      }
      push(n.name);
    });
  });
  const stages = stage ? [stage] : ['primary', 'junior'];
  stages.forEach((sg) => {
    if (branchOf(db, subject, sg)) return;
    db.prepare('SELECT p.name FROM kb_points p JOIN kb_units u ON u.id=p.unit_id WHERE u.subject=? AND u.stage=?' + (grade ? ' AND u.grade=?' : '') + ' ORDER BY u.sort, p.sort, p.id')
      .all(...(grade ? [subject, sg, grade] : [subject, sg])).forEach((r) => push(r.name));
  });
  return names;
}

/** 给 AI 归属建议做参照：[{stage, grade, name}]（单元级） */
function unitLines(db, subject) {
  const out = [];
  ['primary', 'junior'].forEach((stage) => {
    const b = branchOf(db, subject, stage);
    if (b) {
      childrenOf(db, b.branch.id).forEach((g) => childrenOf(db, g.id).forEach((u) => out.push({ stage, grade: g.name === NO_GRADE ? '' : g.name, name: u.name })));
    } else {
      db.prepare('SELECT stage, grade, name FROM kb_units WHERE subject=? AND stage=? ORDER BY sort, id').all(subject, stage).forEach((u) => out.push(u));
    }
  });
  return out;
}

module.exports = {
  BRANCH, NO_GRADE, STAGE_NAME,
  findTree, ensureKnowledgeTree, branchOf, migrateOne, migrateAll, ensureBranch,
  readUnits, addUnit, addPoint, deleteNode, mergeGenerated, pointNames, unitLines,
};
