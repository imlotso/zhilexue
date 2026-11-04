'use strict';
/**
 * 目录树导入 / 导出（R2）。格式见 docs/tree-import-format.md。
 *
 * 导入：按 kind + subject + stage + edition 找树（没有就建），节点按"路径"合并——同父同名不重复建，只增不删，
 * 已有节点不动（只在 code / note 为空时补上），新增节点排在同级末尾并保持文件里的先后顺序。幂等：同一个文件导两次，第二次新增 0。
 * 导出：同样的格式，导出再导入新增 0。
 * 被 mfbank.js 的 /trees/import、/trees/:id/export 和 scripts/import-trees.js 共用。
 */
const FORMAT = 'zhilexue-tree';
const VERSION = 1;
const KINDS = ['textbook', 'knowledge'];
const STAGES = ['primary', 'junior', 'senior'];
const STAGE_NAME = { primary: '小学', junior: '初中', senior: '高中' };
const MAX_NODES = 60000;
const MAX_DEPTH = 12;
const NAME_MAX = 120;

const clean = (v) => String(v == null ? '' : v).trim();
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 默认树名：「苏教版数学·教材章节」/「数学·知识点（小学）」 */
function defaultName(kind, subject, stage, edition) {
  if (kind === 'textbook') return `${edition || ''}${subject}·教材章节`;
  return `${edition ? edition : ''}${subject}·知识点（${STAGE_NAME[stage] || stage}）`;
}

/**
 * 校验并整理一棵树的导入文档。返回 { doc } 或 { error }（error 是中文原因，带上是第几棵树）
 * 节点可以直接写字符串（只有名字），或 { name, code?, note?, children? }
 */
function normalizeDoc(raw, idx = 0) {
  const at = idx >= 0 ? `第 ${idx + 1} 棵树：` : '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at}不是树对象` };
  if (raw.format !== FORMAT) return { error: `${at}format 应为 "${FORMAT}"（当前：${raw.format === undefined ? '没有' : JSON.stringify(raw.format)}）` };
  const ver = Number(raw.version);
  if (!Number.isFinite(ver) || ver < 1 || ver > VERSION) return { error: `${at}version 应为 ${VERSION}（当前：${JSON.stringify(raw.version)}）` };
  const kind = clean(raw.kind);
  if (!KINDS.includes(kind)) return { error: `${at}kind 应为 textbook 或 knowledge` };
  const subject = clean(raw.subject);
  if (!subject) return { error: `${at}subject 必填（如 数学）` };
  const stage = clean(raw.stage);
  if (!STAGES.includes(stage)) return { error: `${at}stage 应为 primary / junior / senior` };
  const edition = clean(raw.edition);
  if (edition.length > 40) return { error: `${at}edition 太长（最多 40 字）` };
  if (kind === 'textbook' && !edition) return { error: `${at}教材章节树（textbook）必须写 edition（如 苏教版）` };
  if (!Array.isArray(raw.nodes) || !raw.nodes.length) return { error: `${at}nodes 必须是非空数组` };

  let count = 0;
  let bad = '';
  const walk = (list, depth, path) => {
    if (!Array.isArray(list)) { bad = `${path} 的 children 应为数组`; return []; }
    if (depth > MAX_DEPTH) { bad = `${path} 层级超过 ${MAX_DEPTH} 层`; return []; }
    const out = [];
    for (let i = 0; i < list.length && !bad; i++) {
      const it = list[i];
      const o = (typeof it === 'string') ? { name: it } : it;
      if (!o || typeof o !== 'object' || Array.isArray(o)) { bad = `${path}[${i}] 不是节点对象`; break; }
      const name = clean(o.name).slice(0, NAME_MAX);
      if (!name) { bad = `${path}[${i}] 缺少 name`; break; }
      if (++count > MAX_NODES) { bad = `节点数超过 ${MAX_NODES}`; break; }
      const n = { name };
      if (clean(o.code)) n.code = clean(o.code).slice(0, 100);
      if (clean(o.note)) n.note = String(o.note).trim();
      if (o.children !== undefined && o.children !== null) n.children = walk(o.children, depth + 1, `${path}[${i}].children`);
      out.push(n);
    }
    return out;
  };
  const nodes = walk(raw.nodes, 1, 'nodes');
  if (bad) return { error: `${at}${bad}` };
  return {
    doc: {
      kind, subject, stage, edition,
      name: clean(raw.name).slice(0, 200) || defaultName(kind, subject, stage, edition),
      source: clean(raw.source).slice(0, 200) || 'import',
      nodes, count,
    },
  };
}

/** 把任意解析好的 JSON（单棵树对象 / 树数组）整理成 docs 数组；有错抛 Error */
function normalizeInput(input) {
  const arr = Array.isArray(input) ? input : [input];
  if (!arr.length) throw new Error('文件里没有树');
  return arr.map((raw, i) => {
    const r = normalizeDoc(raw, Array.isArray(input) ? i : -1);
    if (r.error) throw new Error(r.error);
    return r.doc;
  });
}

/**
 * 导入一棵（已整理过的）树。dry=true 只统计不写库。
 * 返回 { tree_id, name, kind, subject, stage, edition, created_tree, added, existing, total }
 */
function importDoc(db, doc, { dry = false } = {}) {
  let tree = db.prepare('SELECT * FROM bank_trees WHERE kind=? AND subject=? AND IFNULL(stage,\'\')=? AND IFNULL(edition,\'\')=? ORDER BY sort, id')
    .get(doc.kind, doc.subject, doc.stage, doc.edition);
  let createdTree = false;
  if (!tree) {
    createdTree = true;
    if (dry) tree = { id: 0, name: doc.name };
    else {
      const info = db.prepare('INSERT INTO bank_trees (kind, subject, stage, name, source, edition, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(doc.kind, doc.subject, doc.stage, doc.name, doc.source, doc.edition, 0, now());
      tree = { id: Number(info.lastInsertRowid), name: doc.name };
    }
  }
  // 内存里的节点索引：key = 父id|名字；maxSort = 每个父下现有最大 sort
  const index = new Map();
  const maxSort = new Map();
  if (tree.id) {
    db.prepare('SELECT id, parent_id, name, sort, code, note FROM bank_tree_nodes WHERE tree_id=?').all(tree.id).forEach((n) => {
      const p = n.parent_id == null ? 0 : n.parent_id;
      const key = `${p}|${n.name}`;
      if (!index.has(key)) index.set(key, n);
      maxSort.set(p, Math.max(maxSort.has(p) ? maxSort.get(p) : -1, Number(n.sort) || 0));
    });
  }
  const st = { added: 0, existing: 0, total: 0, virtual: 0 };
  const ins = dry ? null : db.prepare('INSERT INTO bank_tree_nodes (tree_id, parent_id, name, sort, code, note, created_at) VALUES (?,?,?,?,?,?,?)');
  const fillMeta = dry ? null : db.prepare('UPDATE bank_tree_nodes SET code=?, note=? WHERE id=?');

  const walk = (list, parent) => {
    list.forEach((n) => {
      st.total++;
      const p = parent == null ? 0 : parent;
      const key = `${p}|${n.name}`;
      let row = index.get(key);
      if (row) {
        st.existing++;
        if (!dry && ((n.code && !clean(row.code)) || (n.note && !clean(row.note)))) {
          const code = clean(row.code) || n.code || '';
          const note = clean(row.note) || n.note || '';
          fillMeta.run(code, note, row.id);
          row.code = code; row.note = note;
        }
      } else {
        st.added++;
        const sort = (maxSort.has(p) ? maxSort.get(p) : -1) + 1;
        maxSort.set(p, sort);
        let id;
        if (dry) id = -(++st.virtual);
        else id = Number(ins.run(tree.id, parent == null ? null : parent, n.name, sort, n.code || '', n.note || '', now()).lastInsertRowid);
        row = { id, parent_id: parent, name: n.name, sort, code: n.code || '', note: n.note || '' };
        index.set(key, row);
      }
      if (n.children && n.children.length) walk(n.children, row.id);
    });
  };
  walk(doc.nodes, null);
  return {
    tree_id: tree.id || null, name: tree.name, kind: doc.kind, subject: doc.subject, stage: doc.stage, edition: doc.edition,
    created_tree: createdTree, added: st.added, existing: st.existing, total: st.total,
  };
}

/** 导入一批树（整个 JSON 文件的内容）。非 dry 时放在一个事务里：中途出错整体回滚 */
function importAll(db, input, { dry = false } = {}) {
  const docs = normalizeInput(input);
  const run = () => docs.map((d) => importDoc(db, d, { dry }));
  const results = (!dry && typeof db.transaction === 'function') ? db.transaction(run)() : run();
  return results;
}

/** 导出一棵树为导入格式（嵌套，按 sort,id 排序）。树不存在返回 null */
function exportTree(db, treeId) {
  const t = db.prepare('SELECT * FROM bank_trees WHERE id=?').get(Number(treeId));
  if (!t) return null;
  const rows = db.prepare('SELECT id, parent_id, name, sort, code, note FROM bank_tree_nodes WHERE tree_id=? ORDER BY sort, id').all(t.id);
  const kids = {};
  rows.forEach((n) => { const p = n.parent_id == null ? 0 : n.parent_id; (kids[p] = kids[p] || []).push(n); });
  const build = (pid) => (kids[pid] || []).map((n) => {
    const o = { name: n.name };
    if (clean(n.code)) o.code = n.code;
    if (clean(n.note)) o.note = n.note;
    const ch = build(n.id);
    if (ch.length) o.children = ch;
    return o;
  });
  return {
    format: FORMAT, version: VERSION,
    kind: t.kind, subject: t.subject || '', stage: t.stage || '', edition: t.edition || '',
    name: t.name, source: t.source || '',
    nodes: build(0),
  };
}

module.exports = { FORMAT, VERSION, normalizeDoc, normalizeInput, importDoc, importAll, exportTree, defaultName };
