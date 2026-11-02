'use strict';
/**
 * 智能题库判分（独立模块：不依赖数据库，便于本地单测）
 * 支持：single 单选 / multi 多选 / judge 判断 / fill 填空 / sort 排序
 *  · single/multi：答案字母归一后比对（A,B 与 AB 等价）
 *  · judge：正确/错误（容忍 对/错/T/F/√/× 等写法）
 *  · fill：多空按 | 对齐；一个空可有多个可接受答案（||| 分隔）；忽略大小写与空格
 *  · sort：按「选项位置序号」序列比对（1 基，如 3,1,2,4,5），字母序列 C,A,B 会先转成序号
 */
const LETTERS = 'ABCDEFG';

function judgeQ(q, myAnswer) {
  const mine = String(myAnswer == null ? '' : myAnswer).trim();
  const ans = String(q.answer || '').trim();
  if (!mine) return false;
  const type = q.type;
  if (type === 'single' || type === 'multi') {
    const norm = (s) => [...new Set((String(s).toUpperCase().match(/[A-G]/g) || []))].sort().join(',');
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

module.exports = { judgeQ };
