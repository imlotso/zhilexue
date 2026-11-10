'use strict';
/**
 * 智能题库判分（独立模块：不依赖数据库，便于本地单测）
 * 支持：single 单选 / multi 多选 / judge 判断 / fill 填空 / sort 排序
 *  · single/multi：答案字母归一后比对（A,B 与 AB 等价）
 *  · judge：正确/错误（容忍 对/错/T/F/√/× 等写法）
 *  · fill：多空按 | 对齐；一个空可有多个可接受答案（||| 分隔）；忽略大小写与空格
 *  · sort：按「选项位置序号」序列比对（1 基，如 3,1,2,4,5），字母序列 C,A,B 会先转成序号
 */
const LETTERS = 'ABCDEFGHIJ';
const MatchQ = require('./match-question');

// 多选少选规则只判断资格，具体分值由试卷或老师明确配置。
function multiPartialEligible(q, myAnswer) {
  if (!q || q.type !== 'multi') return false;
  const choices = (value) => {
    const text = String(value == null ? '' : value).trim().toUpperCase();
    if (!text || !/^[A-J\s,，、;；]+$/.test(text)) return null;
    return new Set(text.match(/[A-J]/g) || []);
  };
  const expected = choices(q.answer), selected = choices(myAnswer);
  return !!(expected && expected.size >= 2 && selected && selected.size > 0 &&
    selected.size < expected.size && [...selected].every((letter) => expected.has(letter)));
}

// 连线每个左项等权，空项记 0；标准答案仍须满足对应题型的完整约束。
function matchScore(q, myAnswer) {
  if (!q || q.type !== 'sort' || !['math_match', 'listen_match'].includes(q.question_subtype)) return null;
  let opts = q.options;
  if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (_) { opts = []; } }
  const correct = MatchQ.normalize(q.match_prompts, opts, q.answer, false, q.question_subtype);
  if (correct.error) return null;
  const expected = correct.answer.split(',').map(Number);
  const text = String(myAnswer == null ? '' : myAnswer).trim();
  let submitted = [];
  if (/^[A-G\s,，、;；]+$/i.test(text)) submitted = (text.toUpperCase().match(/[A-G]/g) || []).map((v) => LETTERS.indexOf(v) + 1);
  else if (/^[0-7\s,，、;；]*$/.test(text)) submitted = text ? text.split(/[,，、;；]/).map((s) => /^\s*[0-7]\s*$/.test(s) ? Number(s.trim()) : 0) : [];
  if (submitted.length > expected.length) submitted = [];
  const parts = expected.map((n, i) => submitted[i] === n);
  return { match_correct: parts.filter(Boolean).length, match_total: expected.length, match_parts: parts };
}

function judgeQ(q, myAnswer) {
  if (q.type === 'answer' || ['writing', 'drawing'].includes(q.question_subtype) || (q.question_subtype === 'translation' && !String(q.answer || '').trim())) throw new Error('该题不支持自动判分');
  const mine = String(myAnswer == null ? '' : myAnswer).trim();
  const ans = String(q.answer || '').trim();
  if (!mine) return false;
  const type = q.type;
  if (type === 'single' || type === 'multi') {
    const norm = (s) => {
      const value = String(s).trim().toUpperCase();
      if (!/^[A-J\s,，、;；]+$/.test(value)) return '';
      return [...new Set(value.match(/[A-J]/g) || [])].sort().join(',');
    };
    return norm(ans) !== '' && norm(ans) === norm(mine);
  }
  if (type === 'judge') {
    const POS = ['正确', '对', '√', 'T', 'TRUE', 'A', 'Y', 'YES', '是'];
    const NEG = ['错误', '错', '×', 'X', 'F', 'FALSE', 'B', 'N', 'NO', '否'];
    const side = (s) => { const u = String(s || '').trim().toUpperCase(); return POS.includes(u) ? '正确' : NEG.includes(u) ? '错误' : ''; };
    const a = side(ans); const b = side(mine);
    return a !== '' && a === b;
  }
  if (type === 'fill') {
    // 公式（T8）：老师在答案里用公式按钮会存成 \( … \)，学生用公式键盘输入的是裸 LaTeX，比较前把分隔符和等价写法抹平
    const normBlank = (s) => String(s || '').trim()
      .replace(/\\\(|\\\)|\\\[|\\\]|\$/g, '').replace(/\\(?:(?:left|right|displaystyle|quad)(?![a-zA-Z])|[,;!])/g, '').replace(/\\[dt]frac/g, '\\frac')
      .toLowerCase().replace(/\s+/g, '');
    // 先把备选分隔符 ||| 换成占位符，再按 | 拆空，最后按占位符拆备选
    const PH = '\u0001';
    const pre = (s) => String(s || '').replace(/\|\|\|/g, PH);
    const a = pre(ans).split('|').map((s) => s.split(PH).map(normBlank).filter((x) => x !== ''));
    const b = pre(mine).split('|').map(normBlank);
    if (a.length !== b.length) return false;
    return a.every((alt, i) => (alt.length ? alt.includes(b[i]) : b[i] === ''));
  }
  if (type === 'sort') {
    if (q.question_subtype === 'math_match' || q.question_subtype === 'listen_match') {
      const score = matchScore(q, mine);
      return !!score && score.match_correct === score.match_total;
    }
    const toSeq = (s) => {
      const up = String(s || '').toUpperCase();
      if (/[A-G]/.test(up) && !/[1-9]/.test(up)) {
        return (up.match(/[A-G]/g) || []).map((L) => LETTERS.indexOf(L) + 1).join('');
      }
      return (up.match(/\d+/g) || []).join('');
    };
    const a = toSeq(ans);
    return a !== '' && a === toSeq(mine);
  }
  return mine === ans;
}

module.exports = { judgeQ, matchScore, multiPartialEligible };
