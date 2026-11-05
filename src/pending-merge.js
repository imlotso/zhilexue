'use strict';
// Teacher-selected source fragments only: preserve both texts, page provenance,
// image references and unreviewed suggestions; never choose conflicting values.
const AiReview = require('./ai-answer-review');
const text = v => String(v == null ? '' : v);
const list = v => Array.isArray(v) ? v : [];
const clone = v => JSON.parse(JSON.stringify(v));
const has = v => v !== undefined && v !== null && text(v).trim() !== '';
const numbered = card => {
  const fields = [card.stem, card.material, card.analysis, ...list(card.options).map(o => typeof o === 'string' ? o : o && (o.content != null ? o.content : o.text)), ...list(card.match_prompts)];
  return fields.flatMap(s => [...text(s).matchAll(/\[图(\d+)\]/g)].map(m => Number(m[1])));
};
function remapSource(card, offset) {
  const fix = v => text(v).replace(/\[图(\d+)\]/g, (_, n) => `[图${Number(n)+offset}]`);
  for (const k of ['stem', 'material', 'analysis']) if (card[k] != null) card[k] = fix(card[k]);
  if (Array.isArray(card.options)) card.options = card.options.map(o => typeof o === 'string' ? fix(o) : ({ ...o, ...(o.content != null ? {content:fix(o.content)} : {}), ...(o.text != null ? {text:fix(o.text)} : {}) }));
  if (Array.isArray(card.match_prompts)) card.match_prompts = card.match_prompts.map(fix);
}
function joinText(a, b) {
  a=text(a).trim(); b=text(b).trim();
  if (!a) return b; if (!b || a === b || a.includes(b)) return a; if (b.includes(a)) return b;
  return `${a}\n${b}`;
}
function merge(target, fragment) {
  if (!target || !fragment || target.committed || fragment.committed) throw Error('题卡已处理，请刷新后重新选择');
  if (target._q || fragment._q) throw Error('包含已关联题库数据的题卡不能自动合并，请手动整理');
  if (target._paper_id || fragment._paper_id || target._lesson_video_id || fragment._lesson_video_id || target._lesson_section_id || fragment._lesson_section_id) throw Error('已挂试卷或课文的题卡不能自动合并，请先保留原题并手动整理');
  const a = clone(target), b = clone(fragment);
  for (const c of [a,b]) {
    if (has(c.answer) || has(c.analysis) || c.ai_answer_review || c.ai_legacy_reviewed || AiReview.legacyPending(c)) throw Error('题卡已有答案、解析或已确认的 AI 内容，请保留原题并手动整理，不能自动合并');
  }
  if (a.ai_answer_suggestion && b.ai_answer_suggestion) throw Error('两张题卡均有 AI 建议，暂不能安全合并；请保留原题并人工处理建议');
  for (const k of ['subject','stage','grade','audio_key','audio_play_limit','difficulty','difficulty_score_10','chapter_id','point','year','group_ref','group_position','question_subtype']) {
    const present = v => has(v) && !(['group_position','chapter_id','difficulty','difficulty_score_10'].includes(k) && Number(v) === 0);
    if (present(a[k]) && present(b[k]) && text(a[k]) !== text(b[k])) throw Error(`两张题卡的 ${k} 不一致，请先在原卡核对后手动整理`);
    if (!present(a[k]) && present(b[k])) a[k]=b[k];
  }
  const errorIndexes = c => list(c._image_errors).map(x => Number(x && x.index));
  if ([...errorIndexes(a),...errorIndexes(b)].some(n => !Number.isInteger(n) || n < 0 || n >= 30)) throw Error('题图错误记录无效，请先核对或补图');
  const n1 = Math.max(0, list(a.figures).length, ...numbered(a), ...errorIndexes(a).map(n=>n+1));
  const n2 = Math.max(0, list(b.figures).length, ...numbered(b), ...errorIndexes(b).map(n=>n+1));
  if (n1+n2 > 30) throw Error('合并后的题图编号超过 30，请先手动整理图片');
  const figuresA = list(a.figures).slice(), figuresB=list(b.figures).slice();
  while (figuresA.length < n1) figuresA.push(null);
  while (figuresB.length < n2) figuresB.push(null);
  remapSource(b,n1);
  const options = list(a.options).slice();
  for (const item of list(b.options)) {
    const label = text(item && item.label).trim();
    const same = label && options.find(o => text(o && o.label).trim() === label);
    if (same && JSON.stringify(same) !== JSON.stringify(item)) throw Error(`选项 ${label} 内容冲突，请先在原卡核对后手动整理`);
    if (!same) options.push(item);
  }
  if (options.length > 10) throw Error('合并后选项超过 10 个，请先手动整理');
  a.stem=joinText(a.stem,b.stem); a.material=joinText(a.material,b.material); a.options=options;
  a.figures=[...figuresA,...figuresB];
  a.match_prompts=[...list(a.match_prompts),...list(b.match_prompts)];
  a.source_pages=[...new Set([...list(a.source_pages),Number(a.page),...list(b.source_pages),Number(b.page)].map(Number).filter(n=>Number.isInteger(n)&&n>0))].sort((x,y)=>x-y);
  a._image_errors=[...list(a._image_errors),...list(b._image_errors).map(x=>({...x,index:Number(x.index)+n1}))];
  a.recognition_notes=[...new Set([...list(a.recognition_notes),...list(b.recognition_notes),...(a.questionType && b.questionType && a.questionType !== b.questionType ? ['原片段题型不同，请确认合并后的题型。'] : []),'老师已手动合并跨页片段，请重新对照全部原页核对题型、内容和图片。'])];
  a.figure_review_required=true; a.content_review_required=true; a.cross_page_review_required=true; a.type_unconfirmed=true;
  // Preserve the prior confirmation metadata as audit evidence; changed source
  // pages/content make those signatures stale and require review again.
  a.merged_fragments=[...list(a.merged_fragments),{card:clone(fragment),merge_reason:'teacher-selected'}];
  // 显式舍弃的建议仍需在合并后的题卡上可见，原片段亦作为独立档案保留。
  a.ai_answer_discard_history=[...list(a.ai_answer_discard_history),...list(b.ai_answer_discard_history)];
  if (!a.ai_answer_suggestion && b.ai_answer_suggestion) a.ai_answer_suggestion=b.ai_answer_suggestion;
  if (a.ai_answer_suggestion) a.ai_answer_suggestion={...a.ai_answer_suggestion,basis:'',invalidated_by_merge:true};
  return a;
}
module.exports={merge};
