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
const TYPES = ['single', 'multi', 'judge', 'fill', 'sort', 'answer'];
const schoolScope = require('./school-scope');

/** Classifications on linked content also apply to legacy questions with blank metadata.
 * Any high-school relationship excludes the whole question; never relabel it or
 * remove just one paper item, which would change stored scores and history.
 */
function supportedQuestionSql(alias = 'q') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid question alias');
  return `(${schoolScope.supportedSql(alias)}
    AND NOT EXISTS (SELECT 1 FROM chapters sc WHERE sc.id=${alias}.chapter_id AND NOT ${schoolScope.supportedSql('sc')})
    AND NOT EXISTS (SELECT 1 FROM videos sv LEFT JOIN chapters sc ON sc.id=sv.chapter_id
      LEFT JOIN sections ss ON ss.id=sv.section_id LEFT JOIN chapters ssc ON ssc.id=ss.chapter_id
      WHERE sv.id=${alias}.video_id AND (NOT ${schoolScope.supportedSql('sv', {stage:false})}
        OR NOT ${schoolScope.supportedSql('sc')} OR NOT ${schoolScope.supportedSql('ssc')}))
    AND NOT EXISTS (SELECT 1 FROM sections ss JOIN chapters sc ON sc.id=ss.chapter_id
      WHERE ss.id=${alias}.section_id AND NOT ${schoolScope.supportedSql('sc')})
    AND NOT EXISTS (SELECT 1 FROM question_nodes sqn JOIN bank_tree_nodes sn ON sn.id=sqn.node_id
      JOIN bank_trees st ON st.id=sn.tree_id WHERE sqn.question_id=${alias}.id AND NOT ${schoolScope.supportedSql('st', {grade:false})})
    AND NOT EXISTS (SELECT 1 FROM video_nodes svn JOIN bank_tree_nodes sn ON sn.id=svn.node_id
      JOIN bank_trees st ON st.id=sn.tree_id WHERE svn.video_id=${alias}.video_id AND NOT ${schoolScope.supportedSql('st', {grade:false})}))`;
}
/** Evaluate an original or proposed resource association without writing it. */
function questionScopeAllowed(db, scope = {}) {
  const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  return !!db.prepare(`SELECT 1 FROM (SELECT ? AS id, ? AS stage, ? AS grade,
    ? AS chapter_id, ? AS video_id, ? AS section_id) q WHERE ${supportedQuestionSql('q')}`)
    .get(id(scope.id), String(scope.stage || ''), String(scope.grade || ''), id(scope.chapter_id), id(scope.video_id), id(scope.section_id));
}
function studentQuestionScopeSql(alias = 'q') {
  return require('./qmeta').questionScopeSql(null, alias) + ' AND ' + supportedQuestionSql(alias);
}

/** Keep old records intact, but never serve a whole paper containing high-school questions. */
function studentQuestionsAllowed(db, ids) {
  if (!Array.isArray(ids)) return false;
  const values = [...new Set(ids.map(Number))];
  if (values.some(id => !Number.isSafeInteger(id) || id <= 0)) return false;
  if (!values.length) return true;
  return !db.prepare(`SELECT q.id FROM questions q WHERE q.id IN (${values.map(() => '?').join(',')})
    AND NOT ${supportedQuestionSql('q')} LIMIT 1`).get(...values);
}
function studentPaperAllowed(db, paper, kind = 'paper') {
  if (!paper || schoolScope.isSeniorScope(paper)) return false;
  let ids;
  if (kind === 'mfpaper') {
    ids = db.prepare("SELECT question_id FROM mf_paper_questions WHERE paper_id=? AND kind='question'").all(paper.id).map(row => row.question_id);
  } else {
    try { ids = JSON.parse(paper.q_ids || '[]'); } catch (_) { return false; }
    if (!Array.isArray(ids)) return false;
  }
  return studentQuestionsAllowed(db, ids);
}

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
  let where = ' WHERE ' + studentQuestionScopeSql('q'); const args = [];
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
function pickByCounts(db, opt, counts, ratios) {
  const want = TYPES.map((t) => ({ type: t, n: Math.max(0, Math.min(50, Number((counts || {})[t]) || 0)) })).filter((x) => x.n > 0);
  const rows = []; const missing = []; const used = new Set();
  const base = scopeSql(db, opt);
  // 最大余数法确定整卷难度目标；随后在各题型配额内分配，避免四舍五入后总数变化。
  const bands = [{ key: 'easy', sql: 'q.difficulty IN (1,2)' }, { key: 'medium', sql: 'q.difficulty=3' }, { key: 'hard', sql: 'q.difficulty IN (4,5)' }];
  const total = want.reduce((s, w) => s + w.n, 0);
  const apportion = (n, weights) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!sum) return weights.map(() => 0);
    const parts = weights.map((v, i) => ({ i, exact: n * v / sum, n: Math.floor(n * v / sum) }));
    let left = n - parts.reduce((s, p) => s + p.n, 0);
    [...parts].sort((a, b) => (b.exact - b.n) - (a.exact - a.n) || a.i - b.i).forEach(p => { if (left > 0 && p.n < weights[p.i]) { p.n++; left--; } });
    return parts.map(p => p.n);
  };
  let targets = null;
  if (ratios) {
    // 百分比权重不受题目总量限制，先计算整卷每档目标数。
    const raw = bands.map(b => total * ratios[b.key] / 100);
    targets = raw.map(Math.floor);
    let left = total - targets.reduce((a, b) => a + b, 0);
    raw.map((v, i) => ({ i, fraction: v - targets[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i).forEach(x => { if (left-- > 0) targets[x.i]++; });
  }
  let allocations = null;
  if (targets) {
    // 先结合每个题型在各难度的实际题量做最大流，避免题库明明够用却由于机械分配产生缺口。
    const available = want.map(() => bands.map(() => 0));
    db.prepare(`SELECT q.type,q.difficulty,COUNT(*) AS n FROM questions q${base.where} GROUP BY q.type,q.difficulty`).all(...base.args).forEach(row => {
      const i=want.findIndex(w=>w.type===row.type), d=Number(row.difficulty);
      const j=d===1||d===2?0:d===3?1:d===4||d===5?2:-1;
      if(i>=0&&j>=0)available[i][j]+=Number(row.n)||0;
    });
    const source=0, firstType=1, firstBand=firstType+want.length, sink=firstBand+bands.length, size=sink+1;
    const cap=Array.from({length:size},()=>Array(size).fill(0));
    want.forEach((w,i)=>{cap[source][firstType+i]=w.n;bands.forEach((_,j)=>{cap[firstType+i][firstBand+j]=available[i][j];});});
    targets.forEach((n,j)=>{cap[firstBand+j][sink]=n;});
    const residual=cap.map(row=>row.slice());
    while(true){
      const prev=Array(size).fill(-1), queue=[source];prev[source]=source;
      for(let p=0;p<queue.length&&prev[sink]<0;p++)for(let v=0;v<size;v++)if(prev[v]<0&&residual[queue[p]][v]>0){prev[v]=queue[p];queue.push(v);}
      if(prev[sink]<0)break;
      let n=Infinity;for(let v=sink;v!==source;v=prev[v])n=Math.min(n,residual[prev[v]][v]);
      for(let v=sink;v!==source;v=prev[v]){residual[prev[v]][v]-=n;residual[v][prev[v]]+=n;}
    }
    allocations=want.map((w,i)=>bands.map((_,j)=>cap[firstType+i][firstBand+j]-residual[firstType+i][firstBand+j]));
    const remaining=targets.map((n,j)=>n-allocations.reduce((s,row)=>s+row[j],0));
    allocations.forEach((row,i)=>{const shortage=want[i].n-row.reduce((a,b)=>a+b,0);const extra=apportion(shortage,remaining);extra.forEach((n,j)=>{row[j]+=n;remaining[j]-=n;});});
  }
  for (const [wi, w] of want.entries()) {
    const allocation = allocations ? allocations[wi] : [w.n];
    const groups = ratios ? bands : [null];
    groups.forEach((band, i) => {
      const n = allocation[i]; if (!n) return;
      let where = base.where + ' AND q.type=?'; const args = base.args.concat([w.type]);
      if (band) where += ` AND ${band.sql}`;
      if (used.size) { where += ` AND q.id NOT IN (${[...used].map(() => '?').join(',')})`; args.push(...used); }
      const got = db.prepare(`SELECT q.* FROM questions q${where} ORDER BY RANDOM() LIMIT ?`).all(...args, n);
      got.forEach((r) => { used.add(r.id); rows.push(r); });
      if (got.length < n) missing.push({ type: w.type, band: band && band.key, need: n - got.length });
    });
  }
  return { rows, missing, wanted: want.length };
}

/** 每个选中知识点从自身及后代中抽指定题量；重叠范围先处理更具体的节点，跨节点不重复。 */
function pickByNodes(db, opt, nodes, perNode) {
  const selected = nodes.map(n => ({ ...n, expanded: expandNodeIds(db, [n.id]) }))
    .sort((a, b) => a.expanded.size - b.expanded.size || Number(a.id) - Number(b.id));
  // 每个范围最多需要整卷题量个候选；使用增广匹配避免共享题目被先选节点占满，导致其他节点明明有解却报缺题。
  const maxCandidates = selected.length * perNode;
  const candidates = selected.map(node => {
    const base = scopeSql(db, { ...opt, nodeIds: [node.id] });
    const where = base.where + ` AND q.type IN (${TYPES.map(() => '?').join(',')})`;
    const args = base.args.concat(TYPES);
    return db.prepare(`SELECT q.* FROM questions q${where} ORDER BY RANDOM() LIMIT ?`).all(...args, maxCandidates);
  });
  const owner = new Map(), records = new Map();
  candidates.forEach(list => list.forEach(q => records.set(q.id, q)));
  const assign = (nodeIndex, seen) => {
    for (const row of candidates[nodeIndex]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (!owner.has(row.id) || assign(owner.get(row.id), seen)) { owner.set(row.id, nodeIndex); return true; }
    }
    return false;
  };
  selected.forEach((_, i) => { for (let n=0;n<perNode;n++) if (!assign(i, new Set())) break; });
  const matched = selected.map(() => []);
  owner.forEach((i, id) => matched[i].push(records.get(id)));
  const rows = matched.flat();
  const missing = selected.flatMap((n,i) => matched[i].length < perNode ? [{ id:n.id, name:n.name, need:perNode-matched[i].length }] : []);
  const nodeByQuestion = {};
  matched.forEach((list,i)=>list.forEach(q=>{nodeByQuestion[q.id]=selected[i].id;}));
  return { rows, missing, nodeByQuestion };
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
  const qCnt = db.prepare(`SELECT COUNT(*) c FROM question_nodes qn JOIN questions q ON q.id=qn.question_id WHERE qn.node_id=? AND ${studentQuestionScopeSql('q')}`);
  const qOne = db.prepare(`SELECT q.* FROM question_nodes qn JOIN questions q ON q.id=qn.question_id WHERE qn.node_id=? AND ${studentQuestionScopeSql('q')} ORDER BY RANDOM() LIMIT 1`);
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

/** 学生扫描：以真实叶节点为目标，即使缺题也保留；章节映射优先，兼容双挂题与未映射章节叶。 */
function planStudentScan(db, { ids, kind, subject, stage }) {
  if (schoolScope.isSeniorScope({ stage })) return { items: [], missing: [], target_total: 0, fallback_count: 0 };
  const nodes = db.prepare(`SELECT n.id,n.parent_id,n.name,n.tree_id,t.kind FROM bank_tree_nodes n
    JOIN bank_trees t ON t.id=n.tree_id WHERE t.subject=? AND (t.stage=? OR IFNULL(t.stage,'')='') ORDER BY n.sort,n.id`).all(subject, stage);
  const byId = new Map(nodes.map(n => [Number(n.id), n])), children = new Map();
  nodes.forEach(n => { const id = Number(n.parent_id) || 0; if (!children.has(id)) children.set(id, []); children.get(id).push(Number(n.id)); });
  const expand = roots => {
    const found = new Set(), todo = roots.map(Number);
    while (todo.length) { const id = todo.pop(); if (found.has(id) || !byId.has(id)) continue; found.add(id); todo.push(...(children.get(id) || [])); }
    return found;
  };
  const leaves = roots => [...expand(roots)].filter(id => !(children.get(id) || []).length);
  const selected = expand(ids), targets = new Map(), mapped = new Set(), inferred = new Set();
  const addKnowledge = id => leaves([id]).forEach(leaf => {
    const n = byId.get(leaf); if (n.kind === 'knowledge') targets.set(leaf, { ...n, fallback: false });
  });
  if (kind === 'knowledge') leaves(ids).forEach(id => { const n = byId.get(id); if (n.kind === kind) targets.set(id, { ...n, fallback: false }); });
  else if (selected.size) {
    const ph = [...selected].map(() => '?').join(',');
    db.prepare(`SELECT chapter_node_id,knowledge_node_id FROM bank_tree_node_mappings WHERE chapter_node_id IN (${ph})`).all(...selected).forEach(link => {
      const n = byId.get(Number(link.knowledge_node_id));
      if (n && n.kind === 'knowledge') { mapped.add(Number(link.chapter_node_id)); addKnowledge(n.id); }
    });
    // 老题双挂章节与知识点，也能确定其真实关联；待审核题不能泄漏或改变扫描范围。
    const base = scopeSql(db, { subject });
    db.prepare(`SELECT DISTINCT c.node_id AS chapter_node_id,k.node_id AS knowledge_node_id FROM questions q
      JOIN question_nodes c ON c.question_id=q.id JOIN question_nodes k ON k.question_id=q.id
      ${base.where} AND c.node_id IN (${ph}) AND (q.stage=? OR IFNULL(q.stage,'')='')`).all(...base.args, ...selected, stage).forEach(link => {
      const n = byId.get(Number(link.knowledge_node_id));
      if (n && n.kind === 'knowledge') { inferred.add(Number(link.chapter_node_id)); addKnowledge(n.id); }
    });
    leaves(ids).forEach(id => {
      if (inferred.has(id)) return;
      let n = byId.get(id); const seen = new Set();
      while (n && selected.has(Number(n.id)) && !seen.has(n.id)) {
        if (mapped.has(Number(n.id))) return;
        seen.add(n.id); n = byId.get(Number(n.parent_id));
      }
      const leaf = byId.get(id);
      if (leaf.kind === 'textbook') targets.set(id, { ...leaf, fallback: true });
    });
  }
  const ordered = [...targets.values()].sort((a,b) => Number(a.id)-Number(b.id));
  const base = scopeSql(db, { subject });
  const candidates = ordered.map(node => db.prepare(`SELECT q.* FROM questions q${base.where}
    AND (q.stage=? OR IFNULL(q.stage,'')='') AND q.type IN (${TYPES.map(() => '?').join(',')})
    AND q.id IN (SELECT question_id FROM question_nodes WHERE node_id=?) ORDER BY RANDOM() LIMIT ?`)
    .all(...base.args, stage, ...TYPES, node.id, ordered.length));
  // 增广匹配：同一题最多用一次，共享题可让位给只有它可用的知识点。
  const owners = new Map(), rows = new Map();
  candidates.forEach(list => list.forEach(q => rows.set(q.id,q)));
  const assign = (index, seen) => {
    for (const q of candidates[index]) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      if (!owners.has(q.id) || assign(owners.get(q.id), seen)) { owners.set(q.id,index); return true; }
    }
    return false;
  };
  ordered.forEach((_,i) => assign(i,new Set()));
  const byTarget = new Map(); owners.forEach((i,qid) => byTarget.set(i,rows.get(qid)));
  const items = [], missing = [];
  ordered.forEach((n,i) => {
    const item = { node_id:n.id, node_name:n.name, fallback:n.fallback };
    if (byTarget.has(i)) items.push({ ...item, row:byTarget.get(i) });
    else missing.push({ ...item, need:1, reason:candidates[i].length ? 'shared' : 'empty' });
  });
  return { items, missing, target_total:ordered.length, fallback_count:ordered.filter(n => n.fallback).length };
}

module.exports = { TYPES, expandNodeIds, scopeSql, poolCounts, pickByCounts, pickByNodes, pickPerNode, planStudentScan, studentQuestionsAllowed, studentPaperAllowed, studentQuestionScopeSql, supportedQuestionSql, questionScopeAllowed };
