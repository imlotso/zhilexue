'use strict';
const crypto = require('crypto');
const { resolveDifficulty } = require('./difficulty');

// 将外部题卡转成现有 mofang-question-pack；不补造答案、解析或分类。
// 只转换可识别的纯 JSON 数据，未知格式明确报错，避免静默丢题。
function text(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (typeof value === 'object') return text(value.text ?? value.content ?? value.value ?? value.label ?? '');
  return '';
}
function values(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
  return [];
}
function optionsOf(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v, i) => ({label: text(v && (v.label ?? v.key ?? v.option)) || String.fromCharCode(65 + i), text: text(v)})).filter(v => v.text);
  if (typeof raw === 'object') return Object.entries(raw).map(([label, value]) => ({label, text:text(value)})).filter(v => v.text);
  throw new Error('选项格式不受支持，请使用数组或键值对象');
}
function pickQuestions(pack) {
  if (Array.isArray(pack)) return pack;
  if (!pack || typeof pack !== 'object') throw new Error('题目包必须是 JSON 对象或题目数组');
  for (const key of ['questions', 'question_cards', 'questionCards', 'cards']) {
    if (Array.isArray(pack[key])) return pack[key];
  }
  if (pack.question && typeof pack.question === 'object') return [pack.question];
  if (pack.problem_text || pack.stem || pack.question_text) return [pack];
  throw new Error('未找到 questions 或题卡数组，请检查文件格式');
}
function normalizePack(pack) {
  if (pack && pack.format === 'mofang-question-pack') return pack;
  const input = pickQuestions(pack);
  if (!input.length) throw new Error('题目包没有题目');
  const items = [];
  input.forEach((parent, i) => {
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) throw new Error(`第 ${i + 1} 题不是对象`);
    if (!Array.isArray(parent.children) || !parent.children.length) { items.push(parent); return; }
    const content = parent.content && typeof parent.content === 'object' ? parent.content : parent;
    const material = text(content.material ?? parent.material ?? content.passage ?? parent.passage);
    if (!material) throw new Error(`第 ${i + 1} 题有小题但缺少材料，不能安全导入`);
    if (parent.children.length > 30) throw new Error(`第 ${i + 1} 题的小题超过 30 道`);
    const inherited = { ...parent }; delete inherited.children; delete inherited.content;
    delete inherited.question_type; delete inherited.questionType; delete inherited.type; delete inherited.question_subtype; delete inherited.subtype;
    const parentKey = text(parent.recordKey ?? parent.id ?? parent.question_id) || String(i + 1);
    parent.children.forEach((child, j) => {
      if (!child || typeof child !== 'object' || Array.isArray(child) || (Array.isArray(child.children) && child.children.length)) throw new Error(`第 ${i + 1} 题的小题 ${j + 1} 格式不受支持`);
      const childContent = child.content && typeof child.content === 'object' ? child.content : child;
      items.push({ ...inherited, ...child, content: { ...childContent, material, images: childContent.images ?? child.images ?? content.images ?? parent.images ?? [] },
        recordKey: `${parentKey}:sub:${text(child.recordKey ?? child.id ?? child.question_id) || j + 1}`,
        _group_ref: `json:${i + 1}`, _group_position: j + 1 });
    });
  });
  const assets = [];
  const rows = items.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${i + 1} 题不是对象`);
    const c = item.content && typeof item.content === 'object' ? item.content : item;
    const stem = text(c.problem_text ?? c.stem ?? c.question_text ?? c.question ?? c.title);
    if (!stem) throw new Error(`第 ${i + 1} 题缺少题干`);
    const images = c.images ?? item.images ?? [];
    if (!Array.isArray(images)) throw new Error(`第 ${i + 1} 题的图片格式不受支持`);
    const figures = images.map((image, j) => {
      const url = typeof image === 'string' ? image : image && image.url;
      if (!url || !/^https?:\/\//i.test(url)) throw new Error(`第 ${i + 1} 题的图片不是可识别的 URL，不能安全导入`);
      const id = `external-${i}-${j}`; assets.push({id, _url:url}); return {ref:j + 1, assetId:id};
    });
    const rawScore = item.difficulty_score_10 ?? c.difficulty_score_10;
    let diff = text(item.difficulty ?? c.difficulty);
    let score = null;
    if (rawScore !== null && rawScore !== undefined && rawScore !== '') {
      const converted = resolveDifficulty({ difficulty_score_10: rawScore });
      if (converted.error) throw new Error(`第 ${i + 1} 题：${converted.error}`);
      if (diff && /^[1-5]$/.test(diff) && Number(diff) !== converted.difficulty) throw new Error(`第 ${i + 1} 题：十级难度与五星难度不一致`);
      diff = String(converted.difficulty); score = converted.difficulty_score_10;
    }
    return {
      recordKey: text(item.recordKey ?? item.id ?? item.question_id) || String(i + 1),
      content: {stem, material: text(c.material ?? item.material ?? c.passage ?? item.passage), match_prompts: values(c.match_prompts ?? item.match_prompts), options: optionsOf(c.options ?? item.options), answer: text(c.answer ?? item.answer), analysis: text(c.analysis ?? item.analysis), figures},
      metadata: {
        subject: {label: text(item.subject ?? c.subject)}, stage: {label: text(item.stage ?? c.stage ?? item.grade ?? c.grade)},
        grade: {label: text(item.grade ?? c.grade)},
        questionType: {label: text(item.question_type ?? item.questionType ?? item.type ?? c.type)},
        questionSubtype: {label: text(item.question_subtype ?? item.subtype ?? c.question_subtype ?? c.subtype)},
        questionGroup: item._group_ref ? { ref: item._group_ref, position: item._group_position } : undefined,
        difficulty: {raw: diff, ...(score !== null ? {score_10: score} : {})}, knowledgePoints: values(item.knowledge_points ?? item.knowledgePoints ?? c.knowledge_points), suggestedTags: values(item.tags)
      }
    };
  });
  const packageId = text(pack.packageId ?? pack.id) || 'external-' + crypto.createHash('sha256').update(JSON.stringify(pack)).digest('hex');
  return {format:'mofang-question-pack', schemaVersion:1, packageId, questions:rows, assets, sources:[]};
}
module.exports = { normalizePack };
