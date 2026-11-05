'use strict';
/**
 * 目录树的教材版本（R2）：默认版本表 + 统一取树 pickTree
 *
 * bank_trees.edition 是教材版本（苏教版 / 苏科版 / 译林版 / 沪教版 …）。同一 学段+学科+种类 下每个版本一棵树；
 * 知识点树可以不分版本（edition 为空 = 通用）。
 * 默认版本表存在 settings.default_editions（JSON：{ 学科: { 学段: 版本 } }），后台可改。
 *
 * 所有"按 学段+学科 取一棵树"的地方都走 pickTree，不要再自己 SELECT 取第一棵。
 * 前端有同逻辑的 pickTree（public/admin/treepick.js），两边改动要同步。
 */

const DEFAULT_EDITIONS = {
  数学: { primary: '苏教版', junior: '苏科版' },
  英语: { primary: '译林版', junior: '译林版' },
  物理: { junior: '苏科版' },
  化学: { junior: '沪教版' },
};
const SETTING_KEY = 'default_editions';

const clean = (v) => String(v == null ? '' : v).trim();

/** 默认版本表：settings 里存的覆盖内置默认（逐学科逐学段合并，settings 里缺的项回落到内置默认） */
function getDefaultEditions(db) {
  let saved = {};
  try {
    const r = db.prepare('SELECT v FROM settings WHERE k=?').get(SETTING_KEY);
    const j = r && r.v ? JSON.parse(r.v) : {};
    if (j && typeof j === 'object' && !Array.isArray(j)) saved = j;
  } catch (e) { saved = {}; }
  const out = {};
  const subjects = new Set([...Object.keys(DEFAULT_EDITIONS), ...Object.keys(saved)]);
  subjects.forEach((s) => {
    const m = { ...(DEFAULT_EDITIONS[s] || {}) };
    const sv = saved[s];
    if (sv && typeof sv === 'object') Object.keys(sv).forEach((st) => { m[st] = clean(sv[st]); });
    // 空字符串 = 明确"没有默认版本"，从表里去掉
    Object.keys(m).forEach((st) => { if (!m[st]) delete m[st]; });
    if (Object.keys(m).length) out[s] = m;
  });
  return out;
}

/** 校验并保存默认版本表。返回保存后的完整表；格式不对抛 Error（message 为中文原因） */
function setDefaultEditions(db, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('默认版本表应为 { 学科: { 学段: 版本 } } 的对象');
  const clean2 = {};
  for (const [subject, m] of Object.entries(input)) {
    const sj = clean(subject);
    if (!sj) continue;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(`「${sj}」的默认版本应为 { 学段: 版本 }`);
    clean2[sj] = {};
    for (const [stage, ed] of Object.entries(m)) {
      const sg = clean(stage);
      if (!['primary', 'junior', 'senior'].includes(sg)) throw new Error(`学段「${sg}」不认识，应为 primary / junior / senior`);
      const e = clean(ed);
      if (e.length > 40) throw new Error('版本名太长（最多 40 字）');
      clean2[sj][sg] = e;
    }
  }
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(SETTING_KEY, JSON.stringify(clean2));
  return getDefaultEditions(db);
}

/** 启动时把默认版本表写进 settings（没有才写，已有不动）。幂等 */
function ensureDefaults(db) {
  try {
    const r = db.prepare('SELECT v FROM settings WHERE k=?').get(SETTING_KEY);
    if (!r) db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').run(SETTING_KEY, JSON.stringify(DEFAULT_EDITIONS));
  } catch (e) { console.error('[treepick] 默认版本表写入失败:', e.message); }
}

const defaultEditionOf = (defaults, subject, stage) => clean(((defaults || {})[subject] || {})[stage]);

/**
 * 统一取树：同 kind+subject+stage 下选一棵。
 *  - edition 给了且有这个版本 → 用它；
 *  - 否则按默认版本表（知识点树先看"通用"即 edition 为空的那棵，再看默认版本）；
 *  - 都没有再退回 sort,id 最靠前的一棵。没有任何树返回 null。
 * 纯函数版：trees 是已取出的树行（{kind,subject,stage,edition,sort,id}），后端 pickTree 和前端同逻辑都基于它。
 */
function pickFrom(trees, { kind, subject, stage, edition }, defaults) {
  const list = (trees || []).filter((t) => t.kind === kind && t.subject === subject && (t.stage || '') === (stage || ''))
    .sort((a, b) => ((a.sort || 0) - (b.sort || 0)) || (a.id - b.id));
  if (!list.length) return null;
  const ed = clean(edition);
  if (ed) { const hit = list.find((t) => clean(t.edition) === ed); if (hit) return hit; }
  const def = defaultEditionOf(defaults, subject, stage);
  if (kind === 'knowledge') {
    const general = list.find((t) => !clean(t.edition));
    if (general) return general;
  }
  if (def) { const hit = list.find((t) => clean(t.edition) === def); if (hit) return hit; }
  return list[0];
}

function pickTree(db, { kind, subject, stage, edition } = {}) {
  const rows = db.prepare('SELECT * FROM bank_trees WHERE kind=? AND subject=? AND IFNULL(stage,\'\')=? ORDER BY sort, id')
    .all(kind || 'textbook', clean(subject), clean(stage));
  if (!rows.length) return null;
  return pickFrom(rows, { kind: kind || 'textbook', subject: clean(subject), stage: clean(stage), edition }, getDefaultEditions(db));
}

/** 接口 GET /editions 的返回：默认版本表 + 每个 学科/学段/种类 下已有的树（版本列表） */
function editionsOverview(db) {
  const rows = db.prepare(`SELECT t.id, t.kind, t.subject, t.stage, t.edition, t.name, t.source,
      (SELECT COUNT(*) FROM bank_tree_nodes n WHERE n.tree_id=t.id) AS node_count
    FROM bank_trees t ORDER BY t.subject, t.stage, t.kind, t.sort, t.id`).all();
  const existing = rows.map((r) => ({ tree_id: r.id, kind: r.kind, subject: r.subject, stage: r.stage || '', edition: r.edition || '', name: r.name, source: r.source || '', node_count: r.node_count }));
  // 便于前端直接用的分组：{ 学科: { 学段: { textbook: [版本…], knowledge: [版本…] } } }
  const grouped = {};
  existing.forEach((t) => {
    const g = (((grouped[t.subject] = grouped[t.subject] || {})[t.stage] = grouped[t.subject][t.stage] || { textbook: [], knowledge: [] }));
    if (!g[t.kind]) g[t.kind] = [];
    if (!g[t.kind].includes(t.edition)) g[t.kind].push(t.edition);
  });
  return { defaults: getDefaultEditions(db), existing, grouped };
}

module.exports = { DEFAULT_EDITIONS, SETTING_KEY, getDefaultEditions, setDefaultEditions, ensureDefaults, pickTree, pickFrom, editionsOverview };
