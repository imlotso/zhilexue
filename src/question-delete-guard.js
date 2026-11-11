'use strict';

// Ordinary papers store ordered question IDs in JSON. Never silently remove a
// referenced question: doing so changes the attainable score and old attempts.
function assertQuestionsDeletable(db, ids) {
  const deleting = new Set(ids.map(Number));
  for (const paper of db.prepare('SELECT id, q_ids FROM papers').all()) {
    let refs;
    try { refs = JSON.parse(paper.q_ids || '[]'); } catch (_) { refs = null; }
    if (!Array.isArray(refs) || refs.some((id) => deleting.has(Number(id)))) {
      const error = new Error(!Array.isArray(refs)
        ? '试卷题目引用数据异常，请先检查试卷后再删除题目'
        : '题目已被试卷引用，不能删除。请先在试卷管理中处理引用，以保留试卷计分和历史记录');
      error.code = 'QUESTION_IN_USE'; error.status = 409;
      throw error;
    }
  }
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const referenced = db.prepare(`SELECT p.id FROM mf_paper_questions r JOIN mf_papers p ON p.id=r.paper_id
    WHERE r.question_id IN (${ph}) AND r.kind='question' AND
      (p.published=1 OR EXISTS (SELECT 1 FROM mf_paper_tries t WHERE t.paper_id=p.id)) LIMIT 1`).get(...ids);
  if (referenced) throw lockedMfPaperError();
}
function lockedMfPaperError() {
  const error = new Error('题目或卷内行已被已发布或有作答记录的试卷引用，不能删除；请复制为新草稿后修改，以保留原卷和历史计分');
  error.code = 'QUESTION_IN_USE'; error.status = 409; return error;
}
function assertMfPaperRowsDeletable(db, paperId) {
  const paper = db.prepare(`SELECT p.id FROM mf_papers p WHERE p.id=? AND
    (p.published=1 OR EXISTS (SELECT 1 FROM mf_paper_tries t WHERE t.paper_id=p.id))`).get(Number(paperId));
  if (paper) throw lockedMfPaperError();
}
module.exports = { assertQuestionsDeletable, assertMfPaperRowsDeletable };
