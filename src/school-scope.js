'use strict';
// Keep detection separate from normalization: identified high-school content must
// never become an unclassified question or inherit a primary/junior default.
const STAGES = ['primary', 'junior'];
const SENIOR_MARKERS = ['senior', '高中', '高一', '高二', '高三', '高1', '高2', '高3', '10年级', '11年级', '12年级', '十年级', '十一年级', '十二年级'];
const MESSAGE = '暂不支持高中内容，请选择小学或初中';
function isSeniorValue(value) {
  const text = String(value == null ? '' : value).replace(/[ \t\r\n\u3000]/g, '').toLowerCase();
  return SENIOR_MARKERS.some(marker => text.includes(marker));
}
function isSeniorScope(scope = {}) {
  return !!scope && (isSeniorValue(scope.stage) || isSeniorValue(scope.grade));
}
function contentScopeError(input) {
  if (!input || typeof input !== 'object') return '';
  if (Array.isArray(input)) return input.map(contentScopeError).find(Boolean) || '';
  const label = value => value && typeof value === 'object' ? value.label : value;
  const error = scopeError({ stage: label(input.stage), grade: label(input.grade) });
  if (error) return error;
  for (const key of ['_q', 'meta', 'metadata', 'content', 'children', 'questions', 'extra', 'zhilexue']) {
    const nested = contentScopeError(input[key]);
    if (nested) return nested;
  }
  return '';
}
function assertContentScope(input) { const error = contentScopeError(input); if (error) throw new Error(error); return input; }
function scopeError(scope) { return isSeniorScope(scope) ? MESSAGE : ''; }
function assertScope(scope) { const error = scopeError(scope); if (error) throw new Error(error); return scope; }
function cleanIds(values) { return [...new Set((Array.isArray(values) ? values : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))]; }
function questionIdsError(db, values) {
  const ids = cleanIds(values);
  if (!ids.length) return '';
  const rows = db.prepare(`SELECT stage, grade FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return rows.some(isSeniorScope) ? MESSAGE : '';
}
function nodeIdsError(db, values) {
  const ids = cleanIds(values);
  if (!ids.length) return '';
  const rows = db.prepare(`SELECT t.stage FROM bank_tree_nodes n JOIN bank_trees t ON t.id=n.tree_id WHERE n.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return rows.some(isSeniorScope) ? MESSAGE : '';
}
function paperQuestionsError(db, paperId) {
  const rows = db.prepare("SELECT q.stage, q.grade FROM mf_paper_questions p JOIN questions q ON q.id=p.question_id WHERE p.paper_id=? AND p.kind='question'").all(paperId);
  return rows.some(isSeniorScope) ? MESSAGE : '';
}
// Alias/column expressions are trusted source code only, never request values.
function supportedSql(alias = '', { stage = true, grade = true } = {}) {
  const prefix = alias ? alias + '.' : '';
  const fields = [...(stage ? [prefix + 'stage'] : []), ...(grade ? [prefix + 'grade'] : [])];
  if (!fields.length) return '(1=1)';
  const normalized = field => `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${field},''),' ',''),CHAR(9),''),CHAR(10),''),CHAR(13),''),'　',''))`;
  return '(' + fields.flatMap(field => SENIOR_MARKERS.map(marker => `${normalized(field)} NOT LIKE '%${marker}%'`)).join(' AND ') + ')';
}
module.exports = { STAGES, MESSAGE, isSeniorValue, isSeniorScope, scopeError, assertScope, supportedSql, contentScopeError, assertContentScope, questionIdsError, nodeIdsError, paperQuestionsError };
