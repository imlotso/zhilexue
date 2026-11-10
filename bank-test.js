'use strict';
/**
 * 智能题库本地自测（不需要数据库 / 不需要启动服务）：
 *   node bank-test.js
 *  ① 判分逻辑 judgeQ：全部题型逐用例
 *  ② Excel 解析 parseBankWorkbook：用「题库模版」文件夹里的真实模板验证（存在时）
 */
const path = require('path');
const fs = require('fs');
const { judgeQ } = require('./src/bank-judge');
const { parseBankWorkbook, makeBankTemplate } = require('./src/bank-excel');

let pass = 0; let failCount = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { failCount++; console.error('  ✗ ' + name); }
}

console.log('=== ① 判分 judgeQ ===');
// 单选
t('单选 正确', judgeQ({ type: 'single', answer: 'B' }, 'B') === true);
t('单选 错误', judgeQ({ type: 'single', answer: 'B' }, 'A') === false);
t('单选 空', judgeQ({ type: 'single', answer: 'B' }, '') === false);
// 多选
t('多选 顺序无关', judgeQ({ type: 'multi', answer: 'A,B' }, 'B,A') === true);
t('多选 少选算错', judgeQ({ type: 'multi', answer: 'A,B' }, 'A') === false);
t('多选 无逗号', judgeQ({ type: 'multi', answer: 'AB' }, 'BA') === true);
// 判断
t('判断 正确=对', judgeQ({ type: 'judge', answer: '正确' }, '对') === true);
t('判断 错误=×', judgeQ({ type: 'judge', answer: '错误' }, '×') === true);
t('判断 反了', judgeQ({ type: 'judge', answer: '正确' }, '错误') === false);
t('判断 F=错误', judgeQ({ type: 'judge', answer: '错误' }, 'F') === true);
// 填空
t('填空 单空', judgeQ({ type: 'fill', answer: 'hobbies' }, 'Hobbies ') === true);
t('填空 多空', judgeQ({ type: 'fill', answer: 'playing|the|guitar' }, 'Playing|The|Guitar') === true);
t('填空 空数不同算错', judgeQ({ type: 'fill', answer: 'a|b' }, 'a') === false);
t('填空 备选答案 |||', judgeQ({ type: 'fill', answer: 'Is|||Are|it' }, 'are|it') === true);
t('填空 备选答案 都不对', judgeQ({ type: 'fill', answer: 'Is|||Are|it' }, 'am|it') === false);
t('填空 空答案为空匹配', judgeQ({ type: 'fill', answer: 'a||c' }, 'a||c') === true);
// 排序
t('排序 字母答案', judgeQ({ type: 'sort', answer: '3,1,2,4,5' }, '3,1,2,4,5') === true);
t('排序 序号错误', judgeQ({ type: 'sort', answer: '3,1,2,4,5' }, '1,2,3,4,5') === false);
t('排序 字母转序号（老格式）', judgeQ({ type: 'sort', answer: 'C,A,B' }, '3,1,2') === true);
t('排序 连词成句原序', judgeQ({ type: 'sort', answer: '1,2,3,4' }, '1,2,3,4') === true);
t('排序 未作答', judgeQ({ type: 'sort', answer: '1,2' }, '') === false);

console.log('=== ② Excel 模板解析 ===');
// 生成模板再读回来（自洽验证）
const tmp = path.join(__dirname, 'data', '_bank-template-test.xlsx');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
makeBankTemplate(tmp, '英语');
{
  const { items, errors } = parseBankWorkbook(fs.readFileSync(tmp));
  t('模板自洽：无解析错误', errors.length === 0);
  const byType = {};
  items.forEach((q) => { byType[q.type] = (byType[q.type] || 0) + 1; });
  t('模板自洽：单选有题', (byType.single || 0) >= 2);
  t('模板自洽：判断有题', (byType.judge || 0) >= 1);
  t('模板自洽：填空有题', (byType.fill || 0) >= 2);
  t('模板自洽：排序有题', (byType.sort || 0) >= 2);
  const cloze = items.filter((q) => q.material && q.type === 'single');
  t('模板自洽：完形/阅读原文沿用', cloze.length >= 2);
  const r = items.find((q) => q.type === 'sort' && q.stem === '将所给的词块排列成一句通顺的话');
  t('模板自洽：组合题词块拆分但不把原顺序当正式答案', r && r.options.length === 4 && r.answer === '');
  const sortQ = items.find((q) => q.type === 'sort' && q.answer.includes(','));
  t('模板自洽：排序答案为序号序列', !sortQ || /^[0-9,]+$/.test(sortQ.answer));
}
try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }

// 用户提供的真实模板（存在时验证）
const REAL = [
  ['C:/Users/Administrator/Desktop/题库模版/数学物理化学/习题导入模板_math_questions.xlsx', '数学'],
  ['C:/Users/Administrator/Desktop/题库模版/英语/习题导入模板_english_questions.xlsx', '英语'],
];
for (const [f, label] of REAL) {
  if (!fs.existsSync(f)) { console.log(`（未找到 ${label} 真实模板，跳过）`); continue; }
  const { items, errors } = parseBankWorkbook(fs.readFileSync(f));
  console.log(`  ${label} 真实模板：解析出 ${items.length} 道题，${errors.length} 条未通过`);
  t(`${label} 真实模板：至少解析出 10 题`, items.length >= 10);
  t(`${label} 真实模板：单选含例题`, items.some((q) => q.type === 'single' && q.options.length >= 2));
  t(`${label} 真实模板：填空带备选`, items.some((q) => q.type === 'fill' && String(q.answer).includes('|')));
  t(`${label} 真实模板：完形/阅读带原文`, items.some((q) => q.material && q.material.length > 20));
  t(`${label} 真实模板：排序题为序号`, items.filter((q) => q.type === 'sort').every((q) => /^[0-9,]+$/.test(q.answer)));
  const noAns = items.filter((q) => String(q.answer) === '');
  t(`${label} 真实模板：全部题目有答案`, noAns.length === 0);
}

console.log(`\n结果：${pass} 项通过，${failCount} 项失败`);
process.exit(failCount ? 1 : 0);
