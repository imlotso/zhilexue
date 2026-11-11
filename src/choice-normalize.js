'use strict';
const { choiceOptionsError } = require('./choice-options');
const LETTERS = 'ABCDEFGHIJ';
// Labels identify the original options. Filter once, then translate the answer
// using the same mapping; never silently drop an option selected as correct.
function normalizeChoiceOptions(type, options, answer) {
  if (!['single', 'multi'].includes(type)) return { options, answer };
  const source = Array.isArray(options) ? options : [];
  const countError = choiceOptionsError(type, source);
  if (countError) return { error: countError };
  const seen = new Set(), mapping = new Map(), next = [];
  for (const [i, option] of source.entries()) {
    const object = option && typeof option === 'object';
    const label = String(object && option.label || LETTERS[i] || '').trim().toUpperCase();
    if (!/^[A-J]$/.test(label) || seen.has(label)) return { error: '选项字母重复或无效，请重新核对' };
    seen.add(label);
    const text = String(object ? (option.text != null ? option.text : option.content != null ? option.content : '') : option == null ? '' : option).trim();
    if (!text) continue;
    const newLabel = LETTERS[next.length];
    mapping.set(label, newLabel); next.push({ label: newLabel, text });
  }
  const value = String(answer == null ? '' : answer).trim();
  if (!value) return { options: next, answer: '' }; // Existing missing-answer workflow.
  if (!/^[A-J\s,，、;；]+$/i.test(value)) return { error: '选择题答案应为 A–J 选项字母' };
  const selected = [...new Set(value.toUpperCase().match(/[A-J]/g) || [])];
  if (!selected.length || (type === 'single' && selected.length !== 1)) return { error: '选择题答案与题型不匹配，请重新核对' };
  if (selected.some(label => !mapping.has(label))) return { error: '答案指向已删除、清空或不存在的选项，请重新核对答案' };
  return { options: next, answer: selected.map(label => mapping.get(label)).sort().join(',') };
}
// Duplicate capture may fill a missing answer, but must not relabel an already
// stored question. Match unique option text and translate to the stored labels.
function answerForExistingChoices(type, options, answer, existing) {
  if (!['single', 'multi'].includes(type) || !String(answer || '').trim()) return { answer };
  if (existing.type !== type) return { error: '已有题目题型不同，无法安全补充答案，请人工核对' };
  let stored = existing.options;
  if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch (_) { stored = null; } }
  if (!Array.isArray(stored) || stored.length !== options.length) return { error: '已有题目选项不同，无法安全补充答案，请人工核对' };
  const byText = new Map(), labels = new Set();
  for (const [i, option] of stored.entries()) {
    const object = option && typeof option === 'object';
    const text = String(object ? (option.text != null ? option.text : option.content || '') : option || '').trim();
    const label = String(object && option.label || LETTERS[i] || '').trim().toUpperCase();
    if (!text || byText.has(text) || !/^[A-J]$/.test(label) || labels.has(label)) return { error: '已有题目选项含重复或无效内容，无法安全补充答案，请人工核对' };
    byText.set(text, label); labels.add(label);
  }
  if (new Set(options.map(option => option.text)).size !== options.length || options.some(option => !byText.has(option.text))) return { error: '已有题目选项不同，无法安全补充答案，请人工核对' };
  const incoming = new Map(options.map(option => [option.label, option.text]));
  return { answer: answer.split(',').map(label => byText.get(incoming.get(label))).sort().join(',') };
}
module.exports = { normalizeChoiceOptions, answerForExistingChoices };
