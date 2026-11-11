'use strict';

// Cross-page association is evidence-sensitive: never replace edited, confirmed or
// committed work. An ambiguous fragment remains a separate card for the teacher.
const AiReview = require('./ai-answer-review');
const crypto = require('crypto');
const str = (x) => String(x == null ? '' : x).trim();
const short = (x, n) => str(x).slice(0, n);
const arr = (x) => Array.isArray(x) ? x : [];
const opt = (o) => ({ label: short(o && o.label, 5), content: str(o && (o.content != null ? o.content : o.text)) });
const STEM_KEYS = ['stemMarkdown', 'stem', 'stemText', 'stem_text', 'questionStem', 'question_stem', 'questionText', 'question_text', 'problemText', 'problem_text', 'question'];
const MATERIAL_KEYS = ['materialMarkdown', 'material', 'materialText', 'material_text', 'sharedMaterial', 'shared_material', 'passage'];
const OPTION_KEYS = ['options', 'choices', 'answerOptions', 'answer_options'];
const ANSWER_KEYS = ['answerMarkdown', 'answer'];
const ANALYSIS_KEYS = ['analysisMarkdown', 'analysis'];
const TYPE_KEYS = ['questionType', 'question_type', 'type'];
const NUMBER_KEYS = ['qno','questionNumber','question_number','question_no','number'];
const DIAGNOSTIC_KEYS = [...new Set([...NUMBER_KEYS, ...STEM_KEYS, ...MATERIAL_KEYS, ...OPTION_KEYS, ...ANSWER_KEYS, ...ANALYSIS_KEYS, ...TYPE_KEYS, 'materialRef', 'material_ref', 'groupRef', 'group_ref', 'continuationOf', 'sourcePages', 'questionSubtype'])];
function pickString(q, keys) {
  const values = keys.filter(k => typeof q[k] === 'string' && q[k].trim());
  return { value: values.length ? q[values[0]].trim() : '', conflict: values.some(k => q[k].trim() !== q[values[0]].trim()) };
}
function optionsFrom(value) {
  if (Array.isArray(value)) return value.map(o => {
    if (typeof o === 'string') {
      const m = /^\s*([A-J])\s*[.、．:]\s*(.*)$/i.exec(o);
      return m ? { label: m[1].toUpperCase(), content: m[2] } : { label: '', content: o };
    }
    if (!o || typeof o !== 'object') return { label:'', content:'' };
    return { label: pickString(o, ['label','letter','key']).value, content: pickString(o, ['content','text','optionText','option_text','value']).value };
  });
  if (value && typeof value === 'object' && Object.keys(value).every(k => /^[A-J]$/i.test(k))) return Object.entries(value).map(([label, content]) => ({ label: label.toUpperCase(), content: typeof content === 'string' ? content : '' }));
  return [];
}
function normalizedOptions(q) {
  const values = OPTION_KEYS.map(k => q[k]).filter(v => Array.isArray(v) || v && typeof v === 'object');
  const normalized = values.map(optionsFrom).filter(v => v.length);
  return { value: normalized[0] || [], conflict: normalized.some(v => JSON.stringify(v) !== JSON.stringify(normalized[0])) };
}
function normalizeQuestion(value) {
  const q = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const stem = pickString(q, STEM_KEYS), material = pickString(q, MATERIAL_KEYS), type = pickString(q, TYPE_KEYS);
  const options = normalizedOptions(q), answer = pickString(q, ANSWER_KEYS), analysis = pickString(q, ANALYSIS_KEYS);
  const numbers = NUMBER_KEYS.map(k => q[k]).filter(v => (typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v))).map(v => String(v).trim());
  const typeAliases = {single:'单选', multi:'多选', fill:'填空', answer:'解答', judge:'判断', sort:'排序'};
  const notes = arr(q.uncertainties || q.recognition_notes).map(x => typeof x === 'string' ? x : '').filter(Boolean);
  if (stem.conflict) notes.push('模型返回多个不同的题干字段，请对照原页核对。');
  if (material.conflict) notes.push('模型返回多个不同的共同材料字段，请对照原页核对。');
  if (type.conflict) notes.push('模型返回多个不同的题型字段，请对照原页核对。');
  if (options.conflict) notes.push('模型返回多个不同的选项字段，请对照原页核对。');
  if (answer.conflict || analysis.conflict) notes.push('模型返回的答案或解析字段互相冲突，请对照原页核对。');
  if (numbers.some(v => v !== numbers[0])) notes.push('模型返回多个不同的题号，请对照原页核对。');
  return { ...q, qno: numbers[0] || '', stemMarkdown: stem.value, materialMarkdown: material.value,
    questionType: typeAliases[type.value.toLowerCase()] || type.value || '解答', options: options.value,
    answerMarkdown: answer.value, analysisMarkdown: analysis.value, uncertainties: notes };
}
function modelDiagnostics(questions) {
  return arr(questions).map(value => {
    const q = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fields = {};
    for (const k of DIAGNOSTIC_KEYS) if (Object.prototype.hasOwnProperty.call(q,k)) {
      const v=q[k], type=Array.isArray(v)?'array':v===null?'null':typeof v;
      fields[k] = { type, length: typeof v==='string'||Array.isArray(v) ? v.length : v&&type==='object' ? Object.keys(v).length : 0 };
    }
    return { fields, other_field_count:Object.keys(q).filter(k=>!DIAGNOSTIC_KEYS.includes(k)).length };
  });
}
const hasFigureRefs = (c) => /\[\s*图\s*\d+\s*\]/.test([str(c && c.stem), str(c && c.material), ...arr(c && c.options).map(o => opt(o).content)].join('\n'));
const pagesOf = (x, page) => [...new Set([...arr(x).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= page), ...(page > 0 ? [page] : [])])].sort((a, b) => a - b);

function materialsFrom(model, page) {
  return arr(model && model.materials).map(m => ({
    ref: short(m && m.ref, 100), text: short(pickString(m && typeof m === 'object' ? m : {}, [...MATERIAL_KEYS, 'text', 'content']).value, 100000),
    source_pages: pagesOf(m && (m.sourcePages || m.source_pages), page),
    continues_previous: !!(m && m.continuesPrevious === true),
  })).filter(m => m.ref && m.text);
}
function resolveCurrentMaterials(prior, incoming, page) {
  const refs = new Set(arr(prior).map(m => m.ref));
  const renames = new Map();
  const ambiguous = new Set();
  const seenCurrent = new Set();
  const current = arr(incoming).map(m => {
    if (seenCurrent.has(m.ref)) throw new Error(`第 ${page} 页共同材料标识重复，无法安全区分，请重试并核对原页`);
    seenCurrent.add(m.ref);
    if (!refs.has(m.ref) || m.continues_previous) return m;
    let fresh = `${m.ref.slice(0, 75)}@page${page}`;
    for (let i = 2; refs.has(fresh); i++) fresh = `${m.ref.slice(0, 70)}@page${page}-${i}`;
    refs.add(fresh);
    renames.set(m.ref, fresh);
    ambiguous.add(fresh);
    return { ...m, ref: fresh, requires_review: true };
  });
  return { current, renames, ambiguous };
}
function availableMaterials(pages, page) {
  const result = new Map();
  for (const p of arr(pages).slice(0, page)) {
    for (const m of arr(p && p.recognition_materials)) if (m && m.ref && m.text) result.set(String(m.ref), m);
  }
  return [...result.values()];
}
function combineMaterials(prior, current) {
  const map = new Map(arr(prior).map(m => [m.ref, { ...m }]));
  for (const m of arr(current)) {
    const old = map.get(m.ref);
    if (!old) { map.set(m.ref, m); continue; }
    const left = str(old.text), right = str(m.text);
    const text = right.includes(left) ? right : left.includes(right) ? left : `${left}\n${right}`;
    map.set(m.ref, { ref: m.ref, text, source_pages: [...new Set([...arr(old.source_pages), ...arr(m.source_pages)])].sort((a,b) => a-b), requires_review: !!(old.requires_review || m.requires_review) });
  }
  return [...map.values()];
}
function materialContext(pages, page) {
  return availableMaterials(pages, page).map(m => ({ ref: m.ref, materialMarkdown: m.text, sourcePages: m.source_pages })).slice(-12);
}
function wordFigures(figures, card) {
  const c = card || {};
  const text = [c.stem, c.material, c._ai_recognized_answer, c._ai_recognized_analysis,
    ...arr(c.options).map(o => o && (o.content != null ? o.content : o.text)), ...arr(c.match_prompts)].join('\n');
  // The document's image numbers are global. Preserve vacant indices until the
  // image-review compaction step rewrites all matching placeholders together.
  return arr(figures).map(f => f && new RegExp('\\[图' + Number(f.n) + '\\]').test(text) ? f : null);
}
function enrichCard(card, original, page, materials, subject) {
  const q = original || {};
  const mref = short(q.materialRef || q.material_ref, 100);
  const material = materials.find(m => m.ref === mref);
  card.material = pickString(q, MATERIAL_KEYS).value || str(material && material.text);
  const originalGroupRef = short(q.groupRef || q.group_ref || mref, 100);
  // Namespace the model's group label by its material. Identical labels in
  // unrelated reading passages must not become a single paper group.
  const materialKey = mref ? crypto.createHash('sha256').update(mref).digest('hex').slice(0, 16) : '';
  let rawGroupRef = originalGroupRef;
  // The model sometimes repeats our own namespaced ID from its context. Keep
  // its original output as evidence but do not prefix that namespace again.
  while (materialKey && rawGroupRef.startsWith(`${materialKey}::`)) rawGroupRef = rawGroupRef.slice(materialKey.length + 2);
  rawGroupRef = short(rawGroupRef, 70);
  const groupRef = mref ? short(`${materialKey}::${rawGroupRef}`, 100) : short(`page${page}::${rawGroupRef}`, 100);
  const pos = Number(q.groupPosition || q.group_position || (/^\d+$/.test(str(card.qno)) && Number(card.qno)));
  if (rawGroupRef && card.material && Number.isInteger(pos) && pos > 0 && pos <= 1000) {
    card.group_ref = groupRef;
    card.group_position = pos;
  }
  card._material_ref = mref;
  card._raw_group_ref = originalGroupRef;
  card.source_pages = pagesOf([...arr(q.sourcePages || q.source_pages), ...(material ? arr(material.source_pages) : [])], page);
  if (page > 0) card.figure_review_required = true;
  card.content_review_required = true;
  // The model can misclassify a page-spanning section even when it returns a
  // definite label. Require a teacher to verify the type against the source.
  card.type_unconfirmed = true;
  card.recognition_notes = arr(q.uncertainties || q.recognition_notes).map(x => short(x, 300)).filter(Boolean).slice(0, 20);
  if (mref && !card.material) card.recognition_notes.push('模型关联的共同材料未找到，请对照原页补全。');
  if (material && material.requires_review) card.recognition_notes.push('材料标识与前页冲突，已隔离分组，请对照原页核对。');
  card.cross_page_review_required = card.source_pages.length > 1;
  const subtype = str(q.questionSubtype || q.question_subtype);
  if (subtype === 'drawing' && card.questionType === '解答' && ['数学', '物理', '化学'].includes(subject)) card.question_subtype = 'drawing';
  if (subtype === 'math_match' && subject === '数学' && card.questionType === '排序') {
    card.question_subtype = subtype;
    card.match_prompts = arr(q.matchPrompts || q.match_prompts).map(x => short(x, 10000));
  }
  card._recognition_continuation = short(q.continuationOf || q.continuation_of, 100);
  if (q._leadingFragment) {
    card.qno = '';
    card._recognition_continuation = '';
    card.cross_page_review_required = true;
    card.continuation_candidate = short(q._continuationCandidate, 100);
    card.recognition_notes.push('页首无题号续片，已独立保留；' + (card.continuation_candidate ? '可能接第' + card.continuation_candidate + '题，' : '') + '仅为候选关联，请对照原页手动合并，未自动拼接。');
  }
  return card;
}
function snapshot(card) {
  return crypto.createHash('sha256').update(JSON.stringify([
    AiReview.signature(card), str(card.group_ref), Number(card.group_position) || 0, str(card._material_ref), str(card._raw_group_ref), arr(card.source_pages),
  ])).digest('hex');
}
function untouched(card) {
  return !!(card && !card.committed && !card.ai_answer_review && !card.ai_answer_suggestion && !str(card.answer) && !str(card.analysis)
    && !card.content_review_signature && !card.figure_review_signature
    && card._recognition_snapshot && card._recognition_snapshot === snapshot(card));
}
function extendMaterials(cards, prior, current, page) {
  const originals = new Map(arr(prior).map(m => [m.ref, m]));
  for (const m of arr(current)) {
    const old = originals.get(m.ref);
    if (!old || old.text === m.text || !str(m.text).includes(str(old.text))) continue;
    for (const card of cards) {
      if (card._material_ref !== m.ref || str(card.material) !== str(old.text) || !untouched(card)) continue;
      card.material = m.text;
      card.source_pages = pagesOf([...arr(card.source_pages), ...arr(m.source_pages)], page);
      card.content_review_required = true;
      card.figure_review_required = true;
      card.cross_page_review_required = true;
      card.recognition_notes = [...new Set([...arr(card.recognition_notes), '共同材料跨页续接，请对照原页核对完整性。'])];
      card._recognition_snapshot = snapshot(card);
    }
  }
}
function finish(cards, incoming, page) {
  const out = cards.slice();
  let merged = 0;
  for (const card of incoming) {
    const continuation = card._recognition_continuation;
    delete card._recognition_continuation;
    const compactText = s => str(s).normalize('NFKC').replace(/\s+/g, '');
    const candidates = out.filter(x => {
      // Model continuationOf is not evidence: the model can echo the previous
      // page or attach a continuation to the wrong number. The data itself must
      // independently establish a uniquely matching option-only continuation.
      if (!str(card.qno) || (continuation && continuation !== str(card.qno)) || str(x.qno) !== str(card.qno) || Number(x.page) !== page - 1) return false;
      if (!str(x._material_ref) || x._material_ref !== card._material_ref || !str(x.material) || str(x.material) !== str(card.material)) return false;
      if (!str(x.group_ref) || x.group_ref !== card.group_ref || arr(x.options).length || arr(card.options).length < 2) return false;
      if (!arr(card.source_pages).includes(page - 1) || !arr(card.source_pages).includes(page)) return false;
      const newStem = compactText(card.stem);
      return !newStem || compactText(x.stem).includes(newStem) || compactText(card.material).includes(newStem);
    });
    const inferred = !continuation && candidates.length === 1;
    const prev = candidates.length === 1 ? candidates[0] : null;
    // Model-provided answer/analysis remain separate suggestions and are never
    // silently attached to a prior question, even when the model says to merge.
    let canMerge = prev && untouched(prev) && !card.ai_answer_suggestion;
    // Page-local image numbers are not global IDs. When both fragments contain
    // references, retain both cards for manual reconciliation rather than
    // silently treating two unrelated [图1]s as one figure.
    const previousMatches = continuation ? out.filter(x => str(x.qno) === continuation && Number(x.page) === page - 1) : [];
    const imageConflict = !!(hasFigureRefs(card) && ((prev && hasFigureRefs(prev)) || previousMatches.some(hasFigureRefs)));
    if (imageConflict) canMerge = false;
    const oldOpts = arr(prev && prev.options).map(opt);
    const newOpts = arr(card.options).map(opt);
    if (canMerge && newOpts.some(n => oldOpts.some(o => o.label === n.label && o.content !== n.content))) canMerge = false;
    if (canMerge) {
      // Candidate text was already verified against the old stem or shared
      // material above. Do not append model-repeated paragraphs a second time.
      for (const n of newOpts) if (!oldOpts.some(o => o.label === n.label)) oldOpts.push(n);
      prev.options = oldOpts;
      if (newOpts.length && (!['单选', '多选'].includes(prev.questionType) || prev.questionType !== card.questionType)) {
        prev.type_unconfirmed = true;
        prev.recognition_notes = [...arr(prev.recognition_notes), '题型与选项可能不符，请对照大题标题确认单选或多选。'];
      }
      // Never replace existing material with model-rewritten material.
      if (!str(prev.material) && card.material) prev.material = card.material;
      if (!prev.group_ref && card.group_ref) { prev.group_ref = card.group_ref; prev.group_position = card.group_position; }
      prev.source_pages = [...new Set([...arr(prev.source_pages), ...card.source_pages])].sort((a,b) => a-b);
      prev.cross_page_review_required = true;
      prev.figure_review_required = true;
      prev.content_review_required = true;
      prev.recognition_notes = [...new Set([...arr(prev.recognition_notes), inferred ? '相邻页同题号的共同材料与选项已关联，请核对题干、选项、题型和原页。' : '跨页片段已关联，请对照各页核对题干、选项和小问。', ...arr(card.recognition_notes)])];
      if (prev.ai_answer_suggestion) delete prev.ai_answer_suggestion;
      prev._recognition_snapshot = snapshot(prev);
      merged++;
    } else {
      const sameNumber = !continuation && str(card.qno) && out.some(x => str(x.qno) === str(card.qno) && Number(x.page) === page - 1);
      if (sameNumber) {
        card.cross_page_review_required = true;
        card.recognition_notes = [...arr(card.recognition_notes), '相邻页有同题号，是否重复或续题需要老师核对。'];
      }
      if (continuation) {
        card.cross_page_review_required = true;
        card.recognition_notes = [...arr(card.recognition_notes), imageConflict ? '跨页片段均有图片编号，无法安全合并，请核对各页题图后手动整理。' : '跨页关联未能安全确认，请对照原卷手动合并。'];
      }
      card._recognition_snapshot = snapshot(card);
      out.push(card);
    }
  }
  return { drafts: out, added: out.length - cards.length, merged };
}

// Do not give the model previous stems/materials/options to echo. The last
// identifier is only a hint for a visible continuation, never source content.
function pageQuestions(model, page, drafts) {
  if (!Array.isArray(model.leadingFragments)) throw new Error('页首续片格式无效，请重试');
  const last = arr(drafts).filter(c => Number(c.page) === page - 1).slice(-1)[0];
  const candidate = short(last && last.qno, 100);
  const leading = arr(model.leadingFragments).map(q => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error('页首续片格式无效，请重试');
    const normalized = normalizeQuestion(q);
    if (!str(normalized.stemMarkdown) && !str(normalized.materialMarkdown) && !arr(normalized.options).some(o => str(o.content))) throw new Error('页首续片没有可见内容，请核对原页并重试');
    return {...normalized, qno:null, continuationOf:'', continuation_of:'', _leadingFragment:true, _continuationCandidate:candidate};
  });
  return [...leading, ...arr(model.questions)];
}
function pageInput(page, drafts, pages = []) {
  const last = arr(drafts).filter(c => Number(c.page) === page - 1).slice(-1)
    .map(c => ({ qno: short(c.qno, 100), questionType: short(c.questionType, 20) }));
  const refs = availableMaterials(pages, page - 1).map(m => ({ref:m.ref, sourcePages:m.source_pages})).slice(-12);
  return `这是第 ${page} 页（当前页），只有这一张图片。先从页顶逐行检查至第一道新题号之前：其中无题号的选项、小问、续句必须逐字输出到 leadingFragments（即使没有题干或只有一行），不得略去或塞入下一道题；卷名、页眉页脚、页码、装订线、仅有大题分节标题不是续片，不要生成题卡。没有则返回空数组。然后输出新题到 questions；不要在两个数组重复输出同一片段。只输出图片内实际可见内容。不要补齐不可见的题干或选项；不确定内容请标注。上一页最后题号提示（不是原文，不能据此生成题目）：${JSON.stringify(last)}。已有材料标识（仅供明确续材料沿用，不代表本页有此材料）：${JSON.stringify(refs)}。sourcePages 仅写本页 ${page}；续题可填 continuationOf，但只抄本页片段。无题目和材料时返回 questions:[]、materials:[]。`;
}
module.exports = { pageQuestions, pageInput, normalizeQuestion, modelDiagnostics, materialsFrom, resolveCurrentMaterials, availableMaterials, combineMaterials, materialContext, wordFigures, enrichCard, extendMaterials, finish, snapshot };
