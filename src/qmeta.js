'use strict';
/**
 * 题目附加信息（R3）：组卷次数 + 章节路径 / 知识点名。
 * 被 mfbank.js 的题库列表（GET /questions）用，R6 组卷选题列表也用。
 *
 * 组卷次数（use）= 这道题被放进过多少份试卷：智能组卷 papers.q_ids（JSON 数组）+ 试卷管理 mf_paper_questions。
 * 不另存计数列：每次按现有试卷现算，删卷后自动回落，不会和实际不一致（试卷表很小，一次全表读取开销可以忽略）。
 */

/** qid → 被组卷次数 */
function usageMap(db) {
  const m = new Map();
  const add = (qid, n) => { if (qid) m.set(qid, (m.get(qid) || 0) + n); };
  db.prepare('SELECT q_ids FROM papers').all().forEach((r) => {
    let arr = [];
    try { arr = JSON.parse(r.q_ids || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) return;
    new Set(arr.map((x) => Number(x)).filter(Boolean)).forEach((qid) => add(qid, 1));
  });
  db.prepare("SELECT question_id AS qid, COUNT(DISTINCT paper_id) AS c FROM mf_paper_questions WHERE question_id IS NOT NULL AND IFNULL(kind,'question')='question' GROUP BY question_id")
    .all().forEach((r) => add(Number(r.qid), Number(r.c) || 0));
  return m;
}

/**
 * 给一批题目算出挂载信息：
 *   chapters: [{ id, tree_id, edition, names:[年级, 册别, 章, 节] }]  —— 只保留最深的节点（同时挂了「第2章」和「2.1」只显示 2.1）
 *   knows:    [{ id, name, names }]                                 —— 知识点树上的节点，同样只保留最深的
 *   edition:  第一条章节挂载所在树的教材版本（题卡顶栏显示）
 * 返回 Map(qid → { chapters, knows, edition, chapter:boolean, knowledge:boolean })
 */
function mountInfo(db, qids) {
  const out = new Map();
  const ids = [...new Set((qids || []).map(Number).filter(Boolean))];
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT qn.question_id AS qid, qn.node_id AS nid, bn.tree_id AS tid, bt.kind AS kind, IFNULL(bt.edition,'') AS edition
    FROM question_nodes qn JOIN bank_tree_nodes bn ON bn.id=qn.node_id JOIN bank_trees bt ON bt.id=bn.tree_id
    WHERE qn.question_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const treeIds = [...new Set(rows.map((r) => r.tid))];
  const nodes = new Map();
  if (treeIds.length) {
    db.prepare(`SELECT id, parent_id, name FROM bank_tree_nodes WHERE tree_id IN (${treeIds.map(() => '?').join(',')})`).all(...treeIds)
      .forEach((n) => nodes.set(n.id, n));
  }
  const pathOf = (nid) => {
    const names = []; const chain = []; let cur = nodes.get(nid); let guard = 0;
    while (cur && guard++ < 20) { names.unshift(cur.name); chain.unshift(cur.id); cur = cur.parent_id ? nodes.get(cur.parent_id) : null; }
    return { names, chain };
  };
  const byQ = new Map();
  rows.forEach((r) => { if (!byQ.has(r.qid)) byQ.set(r.qid, []); byQ.get(r.qid).push(r); });
  ids.forEach((qid) => {
    const list = (byQ.get(qid) || []).map((r) => ({ ...r, ...pathOf(r.nid) }));
    // 只留最深：某个节点是另一个已挂节点的祖先就去掉
    const anc = new Set();
    list.forEach((r) => r.chain.slice(0, -1).forEach((a) => anc.add(a)));
    const deep = list.filter((r) => !anc.has(r.nid));
    const chapters = deep.filter((r) => r.kind === 'textbook').map((r) => ({ id: r.nid, tree_id: r.tid, edition: r.edition, names: r.names }));
    const knows = deep.filter((r) => r.kind === 'knowledge').map((r) => ({ id: r.nid, tree_id: r.tid, name: r.names[r.names.length - 1] || '', names: r.names }));
    out.set(qid, {
      chapters, knows,
      edition: (chapters[0] && chapters[0].edition) || '',
      chapter: list.some((r) => r.kind === 'textbook'),
      knowledge: list.some((r) => r.kind === 'knowledge'),
    });
  });
  return out;
}

/** 一组节点的全部子孙（含自身）；exact=true 时只返回自身 */
function expandNodes(db, nodeIds, exact) {
  const req = [...new Set((nodeIds || []).map(Number).filter(Boolean))];
  if (exact || !req.length) return req;
  const all = db.prepare('SELECT id, parent_id FROM bank_tree_nodes').all();
  const kids = {};
  all.forEach((n) => { if (n.parent_id) (kids[n.parent_id] = kids[n.parent_id] || []).push(n.id); });
  const set = new Set();
  req.forEach((nid) => {
    if (set.has(nid)) return;
    set.add(nid); const stack = [nid];
    while (stack.length) { const cur = stack.pop(); (kids[cur] || []).forEach((k) => { if (!set.has(k)) { set.add(k); stack.push(k); } }); }
  });
  return [...set];
}

module.exports = { usageMap, mountInfo, expandNodes };
