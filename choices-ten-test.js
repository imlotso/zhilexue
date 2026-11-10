'use strict';
const assert = require('assert');
const XLSX = require('xlsx');
const { parseBankWorkbook } = require('./src/bank-excel');
const { parseWordQuestions } = require('./src/wordq');
const { parseDocxQuestions } = require('./src/docxtext');
const { parseWorkbook } = require('./src/excel');
const { normalizePack } = require('./src/mfpack-adapter');
const { judgeQ } = require('./src/bank-judge');

const letters = [...'ABCDEFGHIJ'];
const options = letters.map((l) => `内容${l}`);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['题目', ...letters.map((l) => `选项${l}`), '正确选项'],
  ['十选项测试', ...options, 'AJ'],
]), '多选题');
const parse = () => parseBankWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
let excel = parse();
assert.deepStrictEqual(excel.errors, []);
assert.deepStrictEqual(excel.items[0].options, options);
assert.strictEqual(excel.items[0].answer, 'A,J');
assert.strictEqual(judgeQ(excel.items[0], 'J,A'), true);
assert.strictEqual(judgeQ(excel.items[0], 'A,K,J'), false);
assert.strictEqual(judgeQ(excel.items[0], 'A'), false);
delete wb.Sheets['多选题'].E2;
excel = parse();
assert.strictEqual(excel.items.length, 0);
assert(excel.errors.some((x) => x.includes('连续')));

const word = parseWordQuestions(['多选题', '1. 测试十项', ...letters.map((l) => `${l}. 内容${l}`), '答案：AJ']);
assert.deepStrictEqual(word.errors, []);
assert.strictEqual(word.list[0].options.length, 10);
assert.strictEqual(word.list[0].answer, 'A,J');
const badWord = parseWordQuestions(['多选题', '1. 非法答案', ...letters.map((l) => `${l}. 内容${l}`), '答案：AJK']);
assert.strictEqual(badWord.list.length, 0);
assert(badWord.errors.length);
const legacyWord = parseDocxQuestions(['1.（多选题）十选项', ...letters.map((l) => `${l}. 内容${l}`), '答案：AJ']);
assert.strictEqual(legacyWord.list[0].options.length, 10);
const legacyWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(legacyWb, XLSX.utils.json_to_sheet([{题型:'多选题', 题干:'十选项测试', ...Object.fromEntries(letters.map((l, i) => ['选项' + l, options[i]])), 答案:'AJ'}]), '题库');
const legacyExcel = parseWorkbook(XLSX.write(legacyWb, { type:'buffer', bookType:'xlsx' }), []);
assert.deepStrictEqual(legacyExcel.errors, []);
assert.strictEqual(legacyExcel.items[0].answer, 'A,J');
const pack = normalizePack({questions:[{stem:'JSON 十选项测试', type:'multi', options, answer:'AJ'}]});
assert.strictEqual(pack.questions[0].content.options.length, 10);
assert.strictEqual(pack.questions[0].content.options[9].label, 'J');
console.log('十选项 Excel、Word、JSON 和判分验证通过');
