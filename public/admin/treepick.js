/* 目录树选择小工具（R2：教材版本维度）
 * 同一 学段+学科+种类 下每个教材版本一棵树，所有"按 学段+学科 取一棵树"的页面都走这里，不要再写 trees.find(...)。
 * 逻辑与后端 src/treepick.js 的 pickTree 一致（改一边要同步另一边）：
 *   指定了版本且存在 → 用它；否则按默认版本表（知识点树先看"通用"= 版本为空的那棵，再看默认版本）；都没有退回第一棵。
 * 由 admin/index.html 在 admin.js 之后、各页面脚本之前加载。依赖 api.js 的 api()；MF_API 在 mfbankui.js 里定义，调用时才用到。
 */
const TP = { defaults: {} };
const TP_STAGE_NAMES = { primary: '小学', junior: '初中', senior: '高中' };

/** 拉全部目录树，同时缓存默认版本表（GET /trees 一并返回 defaults） */
async function tpTrees(kind) {
  const r = await api('/api/admin/bank/mf/trees' + (kind ? '?kind=' + encodeURIComponent(kind) : ''), { silent: true }).catch(() => ({ list: [] }));
  if (r && r.defaults) TP.defaults = r.defaults;
  return (r && r.list) || [];
}

/** 默认版本：subject + stage → '苏教版' / ''（没有默认） */
function tpDefaultEdition(subject, stage) {
  return String((((TP.defaults || {})[subject] || {})[stage]) || '').trim();
}

/** 在 trees 里取 kind+subject+stage(+edition) 对应的那一棵；没有返回 null */
function pickTree(trees, { kind, subject, stage, edition } = {}) {
  const list = (trees || []).filter((t) => t.kind === kind && t.subject === subject && (t.stage || '') === (stage || ''))
    .sort((a, b) => ((a.sort || 0) - (b.sort || 0)) || (a.id - b.id));
  if (!list.length) return null;
  const ed = String(edition || '').trim();
  if (ed) { const hit = list.find((t) => String(t.edition || '').trim() === ed); if (hit) return hit; }
  if (kind === 'knowledge') { const general = list.find((t) => !String(t.edition || '').trim()); if (general) return general; }
  const def = tpDefaultEdition(subject, stage);
  if (def) { const hit = list.find((t) => String(t.edition || '').trim() === def); if (hit) return hit; }
  return list[0];
}

/** 某 kind+subject+stage 下已有的版本列表（默认版本排最前；知识点树的"通用"用空串表示） */
function tpEditions(trees, { kind, subject, stage } = {}) {
  const set = [];
  (trees || []).filter((t) => t.kind === kind && t.subject === subject && (t.stage || '') === (stage || ''))
    .forEach((t) => { const e = String(t.edition || '').trim(); if (!set.includes(e)) set.push(e); });
  const def = tpDefaultEdition(subject, stage);
  return set.sort((a, b) => (b === def) - (a === def) || (a === '') - (b === '') || a.localeCompare(b, 'zh'));
}

/** 下拉里显示的树名：「版本 · 学段 · 名称」，不再出现同名两项 */
function treeLabel(t) {
  const ed = String(t.edition || '').trim() || '通用';
  const sg = TP_STAGE_NAMES[t.stage] || '不限学段';
  return `${ed} · ${sg} · ${t.name}`;
}

/** 弹窗里的树下拉：与题目（或当前选择）同 学科+学段 的排前面，其中默认版本那棵排第一；返回新数组，选中项取第一个 */
function tpOrder(list, subject, stage) {
  const kind = (list[0] || {}).kind;
  const best = pickTree(list, { kind, subject, stage });
  const score = (t) => (best && t.id === best.id ? 0 : (t.subject === subject && (t.stage || '') === (stage || '') ? 1 : 2));
  return list.slice().sort((a, b) => score(a) - score(b) || ((a.sort || 0) - (b.sort || 0)) || (a.id - b.id));
}
