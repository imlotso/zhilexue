'use strict';
/**
 * Excel 导入解析自测： node excel-test.js （不需要数据库和服务）
 * 以客户《习题导入模板_math_questions.xlsx》（9 个 sheet）为准：模板原样 → 示例行被忽略；把示例当真实数据 → 全部能导入、0 报错。
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseBankWorkbook } = require('./src/bank-excel');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { console.log(`  ${c ? 'OK ' : 'FAIL'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const tpl = fs.readFileSync(path.join(__dirname, 'docs', '原始需求', '习题导入模板_math_questions.xlsx'));

const wb0 = XLSX.read(tpl, { type: 'buffer' });
ok(wb0.SheetNames.join('|') === '单选题|多选题|判断题|组合题|填空题|排序题|完形填空题|选择填空题|阅读理解题', '客户模板有 9 个 sheet，顺序不变', wb0.SheetNames.join('|'));

const asIs = parseBankWorkbook(tpl);
ok(asIs.items.length === 0 && asIs.errors.length === 0 && asIs.examples === 9, '模板原样：9 组【例题】示例全部忽略，0 题 0 报错', `items=${asIs.items.length} errors=${asIs.errors.length} examples=${asIs.examples}`);

// 把示例当真实数据（去掉【例题】前缀）
const wb = XLSX.read(tpl, { type: 'buffer' });
wb.SheetNames.forEach((n) => { const ws = wb.Sheets[n]; Object.keys(ws).forEach((k) => { if (k[0] !== '!' && ws[k].t === 's') ws[k].v = String(ws[k].v).replace(/^\s*【例题】\s*/, ''); }); });
const real = parseBankWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const by = real.items.reduce((a, q) => { a[q.type] = (a[q.type] || 0) + 1; return a; }, {});
ok(real.errors.length === 0, '示例当真实数据：9 个 sheet 全部能解析，0 报错', real.errors.join('；'));
ok(real.items.length === 18 && by.single === 11 && by.multi === 1 && by.judge === 1 && by.sort === 2 && by.fill === 3, '题数与题型', JSON.stringify(by));
const sel = real.items.filter((q) => q.material && q.material.indexOf('根据句意选择合适的单词填空') === 0);
ok(sel.length === 5 && sel.every((q) => q.type === 'single' && q.options.length >= 2), '选择填空题：客户示例（干扰项列全空）5 个小题全部能导入，不再报"至少需要 1 个干扰项"', `${sel.length} 题`);
ok(sel.every((q) => q.options['ABCDE'.indexOf(q.answer)] !== undefined), '每个小题的答案字母都能对应到选项', sel.map((q) => q.answer).join(','));
// 另造 3 个不同答案的小题：共用词库，每题 3 个选项，各自的答案字母指向各自的答案
const sw = XLSX.read(tpl, { type: 'buffer' });
const sws = sw.Sheets['选择填空题'];
XLSX.utils.sheet_add_aoa(sws, [['选词填空', 1, '一加一等于____', '二', '', '', '', '否', '', ''], ['', 2, '二加二等于____', '四', '', '', '', '', '', ''], ['', 3, '三加三等于____', '六', '', '', '', '', '', '']], { origin: 7 });
const rs = parseBankWorkbook(XLSX.write(sw, { type: 'buffer', bookType: 'xlsx' }));
const mine = rs.items.filter((q) => q.material === '选词填空');
ok(mine.length === 3 && mine.every((q) => q.options.length === 3 && new Set(q.options).size === 3), '3 个不同答案的小题：共用词库，每题 3 个选项', mine.map((q) => q.options.join('/')).join(' | '));
ok(['二', '四', '六'].every((a, i) => mine[i].options['ABC'.indexOf(mine[i].answer)] === a), '每题的答案字母指向它自己的答案', mine.map((q) => q.answer).join(','));
const clz = real.items.filter((q) => q.material && q.material.indexOf('Mary and Tony') === 0);
ok(clz.length === 3 && clz.every((q) => q.type === 'single' && q.material.length > 50), '完形填空：3 个小题共用原文', `${clz.length} 题`);

// 选择填空只有 1 个小题又没干扰项：仍要报错（选项不够）
const one = XLSX.read(tpl, { type: 'buffer' });
const ws = one.Sheets['选择填空题']; XLSX.utils.sheet_add_aoa(ws, [['单独一题的题干', 1, '小题?', '答案甲', '', '', '', '否', '', '']], { origin: 7 });
const r1 = parseBankWorkbook(XLSX.write(one, { type: 'buffer', bookType: 'xlsx' }));
ok(r1.errors.length === 1 && /至少填 1 个干扰项/.test(r1.errors[0]), '只有 1 个小题又没填干扰项：明确报错（选项不够）', r1.errors[0]);

const subtypeWb = XLSX.utils.book_new();
const subtypeSheet = XLSX.utils.aoa_to_sheet([
  ['题目', '选项A', '选项B', '正确选项', '英语细分题型（选填）'],
  ['听音选答', 'a', 'b', 'A', '听力选择'],
  ['错误题型', 'a', 'b', 'A', '听力填空'],
]);
XLSX.utils.book_append_sheet(subtypeWb, subtypeSheet, '单选题');
const subtypeResult = parseBankWorkbook(XLSX.write(subtypeWb, { type: 'buffer', bookType: 'xlsx' }));
ok(subtypeResult.items.length === 1 && subtypeResult.items[0].question_subtype === 'listen_choice' && subtypeResult.errors.some((e) => /不匹配/.test(e)), '英语细分题型正确导入，不匹配时明确报错');
const matchWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(matchWb, XLSX.utils.aoa_to_sheet([
  ['题目', '选项A', '选项B', '答案', '英语细分题型（选填）', '匹配左侧项目（每行一项）'],
  ['听音匹配', '苹果', '香蕉', 'BA', '听力匹配', '甲\n乙'],
]), '排序题');
const matchResult = parseBankWorkbook(XLSX.write(matchWb, { type: 'buffer', bookType: 'xlsx' }));
ok(matchResult.items.length === 1 && matchResult.items[0].question_subtype === 'listen_match' && matchResult.items[0].match_prompts.join() === '甲,乙' && matchResult.items[0].answer === '2,1', '听力匹配扩展表保留左右项目及答案', matchResult.errors.join('；'));
const mathWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(mathWb, XLSX.utils.aoa_to_sheet([
  ['题目', '选项A', '选项B', '答案', '数学细分题型（选填）', '匹配左侧项目（每行一项）'],
  ['数字连线', '二', '一', '2,1', '连线', '1\n2'],
  ['无答案连线', '二', '一', '', '连线', '1\n2'],
]), '排序题');
XLSX.utils.book_append_sheet(mathWb, XLSX.utils.aoa_to_sheet([['题目', '参考答案'], ['画直线', '']]), '作图题');
const mathResult = parseBankWorkbook(XLSX.write(mathWb, { type: 'buffer', bookType: 'xlsx' }));
ok(mathResult.errors.length === 0 && mathResult.items.length === 3 && mathResult.items[0].answer === '2,1' && mathResult.items[1].answer === '' && mathResult.items[2].question_subtype === 'drawing', '数学扩展表支持连线和作图，缺答案保留空白', mathResult.errors.join('；'));

const diffWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(diffWb, XLSX.utils.aoa_to_sheet([
  ['题目', '选项A', '选项B', '正确选项', '难度（1–5）', '十级难度（1–10，选填）'],
  ['双口径一致', '甲', '乙', 'A', 4, 7],
  ['只提供五星', '甲', '乙', 'A', 3, ''],
  ['只提供十级', '甲', '乙', 'A', '', 10],
  ['数值冲突', '甲', '乙', 'A', 2, 7],
  ['十级越界', '甲', '乙', 'A', '', 11],
  ['五星越界', '甲', '乙', 'A', 8, ''],
]), '单选题');
const diffResult = parseBankWorkbook(XLSX.write(diffWb, { type:'buffer', bookType:'xlsx' }));
ok(diffResult.items.length === 3 && diffResult.items[0].difficulty === 4 && diffResult.items[0].difficulty_score_10 === 7 && diffResult.items[1].difficulty === 3 && diffResult.items[1].difficulty_score_10 === null && diffResult.items[2].difficulty === 5 && diffResult.items[2].difficulty_score_10 === 10, 'Excel 分别保留五星和明确十级难度，旧五星不反推分值');
ok(diffResult.errors.length === 3 && diffResult.errors.some(e=>/不一致/.test(e)) && diffResult.errors.some(e=>/十级难度须/.test(e)) && diffResult.errors.some(e=>/五星难度须/.test(e)), '难度冲突与越界逐行报错');
const alternateWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(alternateWb, XLSX.utils.aoa_to_sheet([['题目','第1空答案','难度（1–10）'],['另一个十级表头','答案',1]]), '填空题');
const alternate = parseBankWorkbook(XLSX.write(alternateWb, { type:'buffer', bookType:'xlsx' }));
ok(alternate.items.length === 1 && alternate.items[0].difficulty === 1 && alternate.items[0].difficulty_score_10 === 1, '带范围的十级表头不会误判为旧五星列');

// 无答案的真实试卷允许进入待审核，任何题型都不能把原顺序或别题答案当成本题标准答案。
const missingWb = XLSX.utils.book_new();
const addMissing = (name, rows) => XLSX.utils.book_append_sheet(missingWb, XLSX.utils.aoa_to_sheet(rows), name);
addMissing('单选题', [['题目','选项A','选项B','答案'], ['无答案单选','甲','乙','']]);
addMissing('多选题', [['题目','选项A','选项B','答案'], ['无答案多选','甲','乙','']]);
addMissing('判断题', [['题目','答案'], ['无答案判断','']]);
addMissing('填空题', [['题目','第1空答案','第2空答案'], ['无答案填空 __ __','','']]);
addMissing('排序题', [['题目','选项A','选项B','选项C','答案'], ['无答案排序','甲','乙','丙','']]);
addMissing('组合题', [['题目'], ['乱序词；其他词']]);
addMissing('完形填空题', [['原文','小题序号','选项A','选项B','正确选项'], ['完形共享材料',1,'甲','乙','']]);
addMissing('阅读理解题', [['原文','小题序号','小题题型','小题题目','选项A','选项B','正确选项','第1空答案'], ['阅读共享材料',1,'选择题','阅读选择','甲','乙','',''], ['',2,'填空题','阅读填空 __','','','','']]);
addMissing('选择填空题', [['题干','小题序号','小题题目','小题答案','干扰项1','干扰项2','选项A','选项B'], ['选择填空共享材料',1,'完整选项无答案','','','','甲','乙']]);
const missingResult = parseBankWorkbook(XLSX.write(missingWb, { type:'buffer', bookType:'xlsx' }));
ok(missingResult.errors.length === 0 && missingResult.items.length === 10 && missingResult.items.every(q => q.answer === ''), '单选、多选、判断、填空、排序、完形、阅读及词块题缺答案时保留为空', missingResult.errors.join('；'));
const missingCloze = missingResult.items.find(q => q.material === '完形共享材料');
const missingReading = missingResult.items.filter(q => q.material === '阅读共享材料');
const missingWords = missingResult.items.find(q => q.stem === '将所给的词块排列成一句通顺的话');
const missingSelection = missingResult.items.find(q => q.stem === '完整选项无答案');
ok(!!missingCloze && missingReading.length === 2 && missingReading.every(q => q.group_ref) && missingWords.options.join('|') === '乱序词|其他词' && missingWords.answer === '' && missingSelection.options.join('|') === '甲|乙', '缺答案仍保留共用材料、组标识、原词块和显式选项顺序');

const invalidWb = XLSX.utils.book_new();
const addInvalid = (name, rows) => XLSX.utils.book_append_sheet(invalidWb, XLSX.utils.aoa_to_sheet(rows), name);
addInvalid('单选题', [['题目','选项A','选项B','答案'], ['越界','甲','乙','C'], ['答案重复','甲','乙','A,A'], ['合法单选','甲','乙','B']]);
addInvalid('多选题', [['题目','选项A','选项B','答案'], ['多选少于两个','甲','乙','A'], ['合法多选','甲','乙','A,B']]);
addInvalid('判断题', [['题目','答案'], ['无效判断','不确定']]);
addInvalid('填空题', [['题目','第1空答案','第2空答案'], ['缺少前空','', '后空']]);
addInvalid('排序题', [['题目','选项A','选项B','选项C','答案'], ['排序重复','甲','乙','丙','AAB'], ['排序缺项','甲','乙','丙','AB'], ['排序混入无效字符','甲','乙','丙','A?BC'], ['合法排序','甲','乙','丙','CAB']]);
addInvalid('选择填空题', [['题干','小题序号','小题题目','小题答案','干扰项1','干扰项2','选项A','选项B'], ['不完整选项组',1,'缺少正确选项','','错误一','错误二','',''], ['','2','显式完整选项','乙','','','甲','乙']]);
const invalidResult = parseBankWorkbook(XLSX.write(invalidWb, { type:'buffer', bookType:'xlsx' }));
ok(invalidResult.errors.length === 9 && invalidResult.items.length === 4 && invalidResult.errors.some(e => /第 1 空答案缺失/.test(e)) && invalidResult.errors.some(e => /提供完整的选项/.test(e)), '非空无效答案严格报错，答案缺失时干扰项不能冒充完整选项', invalidResult.errors.join('；'));
const explicitChoice = invalidResult.items.find(q => q.stem === '显式完整选项');
ok(explicitChoice && explicitChoice.options.join('|') === '甲|乙' && explicitChoice.answer === 'B' && invalidResult.items.find(q => q.stem === '合法排序').answer === '3,1,2', '显式答案严格对应原选项，合法排序保持标准化');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
