'use strict';
// 匹配题以固定左侧项目 + 右侧选项排列保存。答案为每个左项对应的右项序号（1 基）。
function list(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { v = []; }
  }
  return Array.isArray(v) ? v.map((s) => String(s || '').trim()).filter(Boolean) : [];
}
function normalize(prompts, options, answer, allowMissing = false, subtype = 'listen_match') {
  const unpack = (value) => { if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return []; } } return value; };
  const rawLeft = unpack(prompts), rawRight = unpack(options);
  const left = list(prompts);
  const opts = Array.isArray(options) ? options : list(options);
  const math = subtype === 'math_match';
  const optionText = (o) => o && typeof o === 'object' ? (o.text != null ? o.text : o.content != null ? o.content : o.html) : o;
  if (!Array.isArray(rawLeft) || rawLeft.length !== left.length || !Array.isArray(rawRight) || rawRight.some((o) => !String(optionText(o) == null ? '' : optionText(o)).trim())) return { error: '匹配项目和右侧选项都不能为空，请逐项核对' };
  if (left.length < 2 || left.length > 7 || opts.length < 2 || opts.length > 7 || (!math && opts.length !== left.length)) return { error: math ? '数学连线需要各 2–7 个左侧项目和右侧选项，数量可以不同' : '听力匹配需要 2–7 个左侧项目，并有数量相同的右侧选项' };
  const value = String(answer || '').trim();
  if (!value) return allowMissing ? { prompts: left, answer: '' } : { error: '请填写匹配答案后再入库' };
  const letters = 'ABCDEFG';
  const seq = /^[A-G\s,，、;；]+$/i.test(value)
    ? (value.toUpperCase().match(/[A-G]/g) || []).map((v) => letters.indexOf(v) + 1)
    : value.split(/[\s,，、;；]+/).filter(Boolean).map(Number);
  if (seq.length !== left.length || (!math && new Set(seq).size !== left.length) || seq.some((v) => !Number.isInteger(v) || v < 1 || v > opts.length)) return { error: math ? '请按左侧项目顺序填写右侧序号，可重复使用右侧选项，如 1,2,1,2' : '匹配答案应按左侧项目顺序填写，每个右侧选项使用一次，如 2,1,3' };
  return { prompts: left, answer: seq.join(',') };
}
module.exports = { list, normalize };
