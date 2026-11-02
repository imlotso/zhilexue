'use strict';
/**
 * 组卷核心（T5）：管理端「一键组卷」和学生端「章节组卷 / 知识点组卷」共用同一套"从题库按范围抽题"的逻辑。
 * 差别只在入口：管理端有"下发"，学生端没有（学生自组卷只在本人名下做题，不进 papers 表、不能下发给别人）。
 *
 * 范围 = 学科 / 学段 / 年级 / 难度 / 知识点文本 + 树节点（章节树或知识点树里选中的节点，含全部后代）。
 * 两种抽法：
 *   pickByCounts  按题型数量抽（管理端：单选 10、多选 5 …）
 *   pickPerNode   每个"最小的有题节点"抽 1 题（学生端雷达扫描：每个小知识点 1 题）
 */
const TYPES = ['single', 'multi', 'judge', 'fill', 'sort'];

/** 选中节点 + 全部后代的 id 集合（节点可来自不同的树） */
function expandNodeIds(db, ids) {
  const sel = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!sel.length) return new Set();
  const trees = db.prepare(`SELECT DISTINCT tree_id FROM bank_tree_nodes WHERE id IN (${sel.map(() => '?').join(',')})`).all(...sel).map((r) => r.tree_id);
  if (!trees.length) return new Set();
  const nodes = db.prepare(`SELECT id, parent_id FROM bank_tree_nodes WHERE tree_id IN (${trees.map(() => '?').join(',')})`).all(...trees);
  const kids = {};
  nodes.forEach((n) => { if (n.parent_id) (kids[n.parent_id] = kids[n.parent_id] || []).push(n.id); });
  const out = new Set();
  const stack = sel.slice();
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    (kids[id] || []).forEach((k) => stack.push(k));
  }
  return out;
}

/** 候选题的 WHERE 片段。opt: { subject, stage, grade, difficulty, point, nodeIds } */
function scopeSql(db, opt) {
  let where = ' WHERE 1=1'; const args = [];
  if (opt.subject) { where += ' AND q.subject=?'; args.push(opt.subject); }
  if (opt.stage) { where += " AND IFNULL(q.stage,'')=?"; args.push(opt.stage); }
  if (opt.grade) { where += " AND IFNULL(q.grade,'')=?"; args.push(opt.grade); }
  if (opt.difficulty) { where += ' AND q.difficulty=?'; args.push(Number(opt.difficulty)); }
  const points = String(opt.point || '').split(/&&|,|，/).map((s) => s.trim()).filter(Boolean);
  if (points.length) {
    where += ' AND (' + points.map(() => "IFNULL(q.point,'') LIKE ?").join(' OR ') + ')';
    points.forEach((p) => args.push(`%${p}%`));
  }
  const nodes = opt.nodeIds === undefined ? null : expandNodeIds(db, opt.nodeIds);
  if (nodes && Array.isArray(opt.nodeIds) && opt.nodeIds.length) {
    if (!nodes.size) { where += ' AND 1=0'; } else {
      where += ` AND q.id IN (SELECT question_id FROM question_nodes WHERE node_id IN (${[...nodes].map(() => '?').join(',')}))`;
      args.push(...nodes);
    }
  }
  return { where, args };
}

/** 范围内各题型有多少题（管理端组卷时给老师参考） */
function poolCounts(db, opt) {
  const { where, args } = scopeSql(db, opt);
  const out = { total: 0 };
  TYPES.forEach((t) => { out[t] = 0; });
  db.prepare(`SELECT q.type AS type, COUNT(*) AS n FROM questions q${where} GROUP BY q.type`).all(...args)
    .forEach((r) => { if (TYPES.includes(r.type)) { out[r.type] = Number(r.n) || 0; out.total += Number(r.n) || 0; } });
  return out;
}

/** 按题型数量抽题。counts: {single: 10, ...}；返回 { rows, missing:[{type, need}] }（题库不够时 missing 列出缺口） */
function pickByCounts(db, opt, counts) {
  const want = TYPES.map((t) => ({ type: t, n: Math.max(0, Math.min(50, Number((counts || {})[t]) || 0)) })).filter((x) => x.n > 0);
  const rows = []; const missing = []; const used = new Set();
  const base = scopeSql(db, opt);
  for (const w of want) {
    let where = base.where + ' AND q.type=?'; const args = base.args.concat([w.type]);
    if (used.size) { where += ` AND q.id NOT IN (${[...used].map(() => '?').join(',')})`; args.push(...used); }
    const got = db.prepare(`SELECT q.* FROM questions q${where} ORDER BY RANDOM() LIMIT ?`).all(...args, w.n);
    got.forEach((r) => { used.add(r.id); rows.push(r); });
    if (got.length < w.n) missing.push({ type: w.type, need: w.n - got.length });
  }
  return { rows, missing, wanted: want.length };
}

/**
 * 每个"最小的有题节点"抽 1 题。allNodes：可选范围内的全部节点 [{id,parent_id,name}]；ids：选中的节点。
 * 选中节点及其后代里有题的节点，若它更深处没有有题的后代，就是一个"小知识点"，从中随机抽 1 题。
 * 返回 [{ node_id, node_name, count, row }]，按可用题数从多到少。
 */
function pickPerNode(db, allNodes, ids) {
  const childrenOf = {};
  allNodes.forEach((n) => { (childrenOf[n.parent_id || 0] = childrenOf[n.parent_id || 0] || []).push(n); });
  const sel = new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean));
  let frontier = [...sel];
  while (frontier.length) {
    const next = [];
    frontier.forEach((pid) => (childrenOf[pid] || []).forEach((ch) => { if (!sel.has(ch.id)) { sel.add(ch.id); next.push(ch.id); } }));
    frontier = next;
  }
  const qCnt = db.prepare('SELECT COUNT(*) c FROM question_nodes qn JOIN questions q ON q.id=qn.question_id WHERE qn.node_id=?');
  const qOne = db.prepare('SELECT q.* FROM question_nodes qn JOIN questions q ON q.id=qn.question_id WHERE qn.node_id=? ORDER BY RANDOM() LIMIT 1');
  const withQ = new Map();
  [...sel].forEach((nid) => { const c = qCnt.get(nid).c; if (c) withQ.set(nid, c); });
  const hasQDesc = (nid) => (childrenOf[nid] || []).some((ch) => withQ.has(ch.id) || hasQDesc(ch.id));
  const items = [];
  withQ.forEach((cnt, nid) => {
    if (hasQDesc(nid)) return;   // 更深处还有题：这层不单独出题
    const node = allNodes.find((n) => n.id === nid);
    const row = qOne.get(nid);
    if (!node || !row) return;
    items.push({ node_id: nid, node_name: node.name, count: cnt, row });
  });
  items.sort((a, b) => b.count - a.count);
  return items;
}

module.exports = { TYPES, expandNodeIds, scopeSql, poolCounts, pickByCounts, pickPerNode };
