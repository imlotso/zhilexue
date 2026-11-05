'use strict';

// difficulty 是原有 1–5 星级；difficulty_score_10 是来源明确的 1–10 精确值。
// 未知的十级值保持 null，绝不把已有星级反推为某个确切数值。
function resolveDifficulty(input = {}, current = {}) {
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const hasLegacy = has(input, 'difficulty') && input.difficulty !== undefined && input.difficulty !== null && input.difficulty !== '';
  const hasScore = has(input, 'difficulty_score_10') && input.difficulty_score_10 !== undefined;
  const oldLegacy = Math.min(5, Math.max(1, parseInt(current.difficulty, 10) || 3));
  const oldScore = Number(current.difficulty_score_10);
  const previousScore = current.difficulty_score_10 !== null && current.difficulty_score_10 !== undefined && current.difficulty_score_10 !== '' && Number.isInteger(oldScore) && oldScore >= 1 && oldScore <= 10 ? oldScore : null;
  let legacy = hasLegacy ? Math.min(5, Math.max(1, parseInt(input.difficulty, 10) || 3)) : oldLegacy;
  if (hasScore) {
    if (input.difficulty_score_10 === null || input.difficulty_score_10 === '') return { difficulty: legacy, difficulty_score_10: null, error: '' };
    const score = Number(input.difficulty_score_10);
    if (!Number.isInteger(score) || score < 1 || score > 10) return { error: '十级难度须为 1 至 10 的整数' };
    const derived = Math.ceil(score / 2);
    if (hasLegacy && legacy !== derived) return { error: '十级难度与五星难度不一致，请重新选择' };
    return { difficulty: derived, difficulty_score_10: score, error: '' };
  }
  return { difficulty: legacy, difficulty_score_10: hasLegacy && legacy !== oldLegacy ? null : previousScore, error: '' };
}

module.exports = { resolveDifficulty };
