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

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
