'use strict';
// 原始页图的引用与老师确认绑定到题目当前内容，避免图片或题干变更后沿用旧确认。
const crypto = require('crypto');
const string = v => v == null ? '' : String(v);
function contents(card) {
  const q = card && card._q || card || {};
  return [string(q.stem), string(q.stem_html), string(q.stemHtml), string(card && card.material != null ? card.material : q.material),
    ...(Array.isArray(q.options) ? q.options.map(o => string(o && typeof o === 'object' ? (o.content != null ? o.content : o.text) : o)) : []),
    ...(Array.isArray(card && card.match_prompts) ? card.match_prompts.map(string) : (Array.isArray(q.match_prompts) ? q.match_prompts.map(string) : [])), string(q.answer), string(q.analysis)];
}
function figures(card) {
  const q = card && card._q;
  const a = q && Array.isArray(q.images) ? q.images : (Array.isArray(card && card.figures) ? card.figures : (Array.isArray(card && card.images) ? card.images : []));
  return a.map(v => string(v && typeof v === 'object' ? v.url : v));
}
function missing(card) {
  const imgs = figures(card), refs = new Set(); let unnamed = false;
  for (const text of contents(card)) {
    for (const m of text.matchAll(/\[图(\d+)\]/g)) refs.add(Number(m[1]));
    // 模型也会输出未编号图片或表格占位；渲染器只认识 [图数字]。
    for (const m of text.matchAll(/\[(?:图片|图像|图表|表格|示意图|图(?=[0-9a-zA-Z\s:：\]])|表(?=[0-9a-zA-Z\s:：\]]))[^\]\n]{0,2000}\]|【(?:图片|图像|图表|表格|示意图|图(?=[0-9a-zA-Z\s:：】])|表(?=[0-9a-zA-Z\s:：】]))[^】\n]{0,2000}】/g)) {
      if (!/^\[图\d+\]$/.test(m[0])) unnamed = true;
    }
    // 超过解析上限也要拒绝，而不是让过长的图片标记绕过检查。
    if (/\[(?:图片|图像|图表|表格|示意图|图(?=[0-9a-zA-Z\s:：\]])|表(?=[0-9a-zA-Z\s:：\]]))[^\]\n]{2001}|【(?:图片|图像|图表|表格|示意图|图(?=[0-9a-zA-Z\s:：】])|表(?=[0-9a-zA-Z\s:：】]))[^】\n]{2001}/.test(text)) unnamed = true;
  }
  const missing = [...refs].filter(n => n < 1 || n > 30 || !imgs[n - 1]).sort((a,b) => a-b);
  if (unnamed) missing.push('未编号');
  return missing;
}
function signature(card) {
  return crypto.createHash('sha256').update(JSON.stringify([contents(card), figures(card), Number(card && card.page) || 0, card && card.source_pages || []])).digest('hex');
}
function issue(card) {
  const nums = missing(card);
  if (nums.length) return nums.includes('未编号') ? '存在未编号图片或表格占位符，请先在编辑中改为 [图1] 等唯一图号并补图' : `题图 ${nums.map(n => '图' + n).join('、')} 尚未补充，请先补图`;
  if (card && card.figure_review_required && card.figure_review_signature !== signature(card)) return '图文归属尚未核对，请对照原页确认题图完整或本题无图';
  return '';
}
// 题库存储的图片数组必须与占位符编号一致；稀疏编号在入库前重排。
function compact(card) {
  const imgs = figures(card), map = new Map(), next = [];
  imgs.forEach((url, i) => { if (url) { next.push(url); map.set(i + 1, next.length); } });
  const fix = v => string(v).replace(/\[图(\d+)\]/g, (m, n) => map.has(Number(n)) ? `[图${map.get(Number(n))}]` : m);
  const q = card._q || card;
  q.stem = fix(q.stem);
  if (q.stem_html) q.stem_html = fix(q.stem_html);
  if (q.stemHtml) q.stemHtml = fix(q.stemHtml);
  if (card.material != null) card.material = fix(card.material); else if (q.material != null) q.material = fix(q.material);
  if (q.analysis != null) q.analysis = fix(q.analysis);
  if (q.answer != null) q.answer = fix(q.answer);
  if (Array.isArray(q.options)) q.options = q.options.map(o => typeof o === 'string' ? fix(o) : ({ ...o, ...(o.content != null ? { content: fix(o.content) } : {}), ...(o.text != null ? { text: fix(o.text) } : {}) }));
  if (Array.isArray(card.match_prompts)) card.match_prompts = card.match_prompts.map(fix);
  if (q !== card && Array.isArray(q.match_prompts)) q.match_prompts = q.match_prompts.map(fix);
  if (card._q || (!Array.isArray(card.figures) && Array.isArray(card.images))) q.images = next;
  else card.figures = next.map(url => ({ url }));
  return card;
}
module.exports = { contents, figures, missing, signature, issue, compact };
