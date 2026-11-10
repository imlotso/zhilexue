'use strict';

// AI 结果与原题分开保存。签名用于在老师核对前发现题干、选项或答案已变化。
const crypto = require('crypto');
const MatchQ = require('./match-question');
const str = (v) => String(v == null ? '' : v);
const values = (card) => {
  const q = card && card._q || card || {};
  const wrapped = !!(card && card._q);
  const images = Array.isArray(q.images) ? q.images : Array.isArray(card && card.figures) ? card.figures : [];
  return {
    stem: str(q.stem), type: str(wrapped ? q.type : (card && card.questionType || q.type)),
    subject: str(wrapped ? (q.subject || card.subject) : (card && card.subject || q.subject)), stage: str(wrapped ? (q.stage || card.stage) : (card && card.stage || q.stage)), grade: str(wrapped ? (q.grade || card.grade) : (card && card.grade || q.grade)),
    material: str(card && card.material != null ? card.material : q.material),
    images: images.map((image) => typeof image === 'string' ? image : str(image && (image.url || image.key))),
    audio_key: str(card && card.audio_key || q.audio_key),
    question_subtype: str(card && card.question_subtype || q.question_subtype),
    match_prompts: MatchQ.list(card && card.match_prompts || q.match_prompts),
    options: (Array.isArray(q.options) ? q.options : []).map((o) =>
      typeof o === 'string' ? { label: '', text: o } : {
        label: str(o && o.label), text: str(o && (o.text != null ? o.text : o.content)),
      }),
    answer: str(q.answer), analysis: str(q.analysis),
    page: Number(card && card.page) || 0, qno: str(card && card.qno),
  };
};
const signature = (card) => crypto.createHash('sha256').update(JSON.stringify(values(card))).digest('hex');
// 放弃建议同样要求页面所见题目快照与批次范围一致，避免误删并发生成的新建议。
const discardSignature = (card, scope = '') => crypto.createHash('sha256').update(JSON.stringify([signature(card), str(scope)])).digest('hex');
function discardSuggestion(target, actor, at) {
  const suggestion = target && target.ai_answer_suggestion;
  if (!suggestion || !suggestion.token) throw new Error('AI 建议已变化，请刷新后重试');
  if (target.ai_answer_discard_history != null && !Array.isArray(target.ai_answer_discard_history)) throw new Error('历史审核记录格式异常，请先核对');
  const history = target.ai_answer_discard_history || [];
  if (history.length >= 100) throw new Error('本题舍弃记录已达上限，请先处理该题');
  const { token: ignored, ...snapshot } = suggestion;
  const record = { ...snapshot, source: str(snapshot.source) || 'generation', event_id: token(), discarded_by: actor, discarded_at: at };
  target.ai_answer_discard_history = [...history, record];
  delete target.ai_answer_suggestion;
  return record;
}
function withDiscardHistory(metadata, history) {
  const out = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  const prior = Array.isArray(out.discarded_suggestions) ? out.discarded_suggestions : [];
  const seen = new Set(prior.map((item) => item && item.event_id).filter(Boolean));
  const added = (Array.isArray(history) ? history : []).filter((item) => {
    if (!item || typeof item !== 'object' || item.event_id && seen.has(item.event_id)) return false;
    if (item.event_id) seen.add(item.event_id);
    return true;
  });
  if (prior.length || added.length) out.discarded_suggestions = [...prior, ...added];
  return out;
}
const legacySignature = (card) => {
  const q = card && card._q || card || {};
  return crypto.createHash('sha256').update(JSON.stringify({
    signature: signature(card), chapter_id: Number(card && card.chapter_id) || 0,
    point: str(card && card.point || q.point), difficulty: Number(card && card.difficulty || q.difficulty) || 0,
    difficulty_score_10: Number(card && card.difficulty_score_10 || q.difficulty_score_10) || 0,
    tags: Array.isArray(card && card.suggestedTags) ? card.suggestedTags : [],
  })).digest('hex');
};
// 审核后的 AI 答案也必须绑定题面：内容变更不清除原值，但须老师重新核对。
const contextSignature = (card, scope = '') => {
  const v = values(card);
  delete v.answer; delete v.analysis;
  return crypto.createHash('sha256').update(JSON.stringify({ values: v, scope: str(scope), group_ref: str(card && card.group_ref), group_position: Number(card && card.group_position) || 0, source_pages: card && card.source_pages || [] })).digest('hex');
};
const reviewedPendingFields = (card, scope = '') => {
  const q = card && card._q || card || {};
  const fields = card && card.ai_answer_review && card.ai_answer_review.fields || {};
  const basis = contextSignature(card, scope);
  return ['answer', 'analysis'].filter((field) => {
    const stamp = fields[field];
    // 升级前的已确认记录没有题面快照，保留原有状态。手工改写后的值不冒认 AI 建议。
    return stamp && stamp.basis && stamp.value === str(q[field]) && stamp.basis !== basis;
  });
};
const token = () => crypto.randomBytes(16).toString('hex');
// 只有旧版明确记录过补全才视作 AI 补全。历史识别题的来源不明，不能推断它一定由 AI 生成。
const legacyUnknownOrigin = (card) => !!(card && !card.ai_filled && !card._ai_review_schema && (Number(card.page) > 0 || ['semi', 'word'].includes(card.via)) && (str((card._q || card).answer).trim() || str((card._q || card).analysis).trim()));
const legacyPendingFields = (card) => {
  if (!card) return [];
  if (!card.ai_filled) return [];
  // 保留升级前已确认的历史记录；新版逐字段确认记录与当前题目快照绑定。
  if (card.ai_legacy_reviewed && !card.ai_legacy_reviewed_fields) return [];
  const q = card._q || card;
  const reviewed = card.ai_legacy_reviewed_fields || {};
  const current = legacySignature(card);
  const classification = !!card.ai_filled && (Number(card.chapter_id) > 0 || !!str(card.point || q.point).trim() || Number(card.difficulty || q.difficulty) > 0 || Number(card.difficulty_score_10 || q.difficulty_score_10) > 0 || (Array.isArray(card.suggestedTags) && card.suggestedTags.length > 0));
  return ['answer', 'analysis', 'classification'].filter((field) => (field === 'classification' ? classification : !!str(q[field]).trim()) && reviewed[field] !== current);
};
const legacyPending = (card) => legacyPendingFields(card).length > 0;
function confirmLegacy(card, fields, expected, actor, at) {
  const pending = legacyPendingFields(card);
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length || fields.some((field) => !pending.includes(field))) throw new Error('待核对内容已变化，请刷新后重新核对');
  if (String(expected || '') !== legacySignature(card)) throw new Error('题目或分类已变化，请重新核对');
  card._ai_card_id = card._ai_card_id || token();
  const sig = legacySignature(card), stamp = { confirmed_by: actor, confirmed_at: at };
  card.ai_legacy_reviewed_fields = { ...(card.ai_legacy_reviewed_fields || {}), ...Object.fromEntries(fields.map((field) => [field, sig])) };
  card.ai_legacy_reviewed = !legacyPending(card);
  const review = card.ai_answer_review || {};
  card.ai_answer_review = { ...review, legacy_confirmed: card.ai_legacy_reviewed, legacy_fields: { ...(review.legacy_fields || {}), ...Object.fromEntries(fields.map((field) => [field, stamp])) } };
}

module.exports = { values, signature, discardSignature, discardSuggestion, withDiscardHistory, legacySignature, contextSignature, reviewedPendingFields, token, legacyPending, legacyPendingFields, legacyUnknownOrigin, confirmLegacy };
