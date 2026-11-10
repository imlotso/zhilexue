'use strict';

// 历史记录保留旧字段；含未评分题的新记录从 detail 读取客观题部分。
function presentAttempt(row) {
  if (!row) return null;
  let detail = [];
  try { detail = JSON.parse(row.detail || '[]'); } catch (_) { /* 旧记录没有明细 */ }
  if (!Array.isArray(detail)) detail = [];
  const ungraded = detail.filter((x) => x && x.ungraded);
  const graded = detail.filter((x) => x && !x.ungraded && !x.manual_graded);
  const manual = detail.filter((x) => x && x.manual_graded);
  const round = (n) => Math.round(n * 100) / 100;
  return { ...row, detail: undefined, ungraded_count: ungraded.length,
    objective_score: ungraded.length ? round(graded.reduce((s, x) => s + (Number(x.earned_score) || 0), 0)) : null,
    objective_score_total: ungraded.length ? round(graded.reduce((s, x) => s + (Number(x.max_score) || 0), 0)) : null,
    manual_count: manual.length,
    manual_score: ungraded.length && manual.length ? round(manual.reduce((s, x) => s + (Number(x.earned_score) || 0), 0)) : null,
    manual_score_total: ungraded.length && manual.length ? round(manual.reduce((s, x) => s + (Number(x.max_score) || 0), 0)) : null };
}
module.exports = { presentAttempt };
