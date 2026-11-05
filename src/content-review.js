'use strict';

// 老师确认绑定当前题型、材料、题干、选项、公式、题图和来源页；任何修改都必须重新核对。
const crypto = require('crypto');
const AiAnswerReview = require('./ai-answer-review');
function signature(card, run) {
  const c = card || {}, r = run || {};
  const q = c._q || c;
  const values = AiAnswerReview.values(c);
  // 使用和入库一致的实际字段，不把显式清空的共用材料回退到旧值。
  values.material = String(c.material != null ? c.material : (q.material != null ? q.material : ''));
  values.type = String(c._q ? (q.type || '') : (c.questionType || ''));
  return crypto.createHash('sha256').update(JSON.stringify({
    values,
    scope: [r.subject || '', r.stage || '', r.grade || ''],
    source_pages: Array.isArray(c.source_pages) ? c.source_pages : [],
    group_ref: c.group_ref || '', group_position: c.group_position || 0,
    type_unconfirmed: !!c.type_unconfirmed,
  })).digest('hex');
}
function pending(card, run) {
  return !!(card && (card.content_review_required || card.type_unconfirmed) && card.content_review_signature !== signature(card, run));
}
module.exports = { signature, pending };
