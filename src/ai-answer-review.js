'use strict';

// AI 结果与原题分开保存。签名用于在老师核对前发现题干、选项或答案已变化。
const crypto = require('crypto');
const MatchQ = require('./match-question');
const str = (v) => String(v == null ? '' : v);
const values = (card) => {
  const q = card && card._q || card || {};
  const images = Array.isArray(q.images) ? q.images : Array.isArray(card && card.figures) ? card.figures : [];
  return {
    stem: str(q.stem), type: str(card && card.questionType || q.type),
    subject: str(card && card.subject || q.subject), stage: str(card && card.stage || q.stage), grade: str(card && card.grade || q.grade),
    material: str(card && card.material || q.material),
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
const token = () => crypto.randomBytes(16).toString('hex');
const legacyPending = (card) => {
  if (!card || card.ai_legacy_reviewed) return false;
  if (card.ai_filled) return true;
  // 旧版识别未保留模型来源；带原页或工作台模型整理标记的历史题需保守核对，原值不动。
  const possibleRecognition = !card._ai_review_schema && (Number(card.page) > 0 || ['semi', 'word'].includes(card.via));
  const q = card._q || card;
  return !!(possibleRecognition && (str(q.answer).trim() || str(q.analysis).trim()));
};

module.exports = { values, signature, token, legacyPending };
