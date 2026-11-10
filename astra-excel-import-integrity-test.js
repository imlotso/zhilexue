'use strict';
// Real XLSX bytes and production importers; no database, storage or network.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const XLSX = require('xlsx');
const { parseBankWorkbook } = require('./src/bank-excel');
const { parseWorkbook } = require('./src/excel');
function workbook(name, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const headers = ['题干', '小题序号', '小题题目', '小题答案'];
test('separate selection-cloze groups with identical instructions do not borrow each other\'s answers', () => {
  const result = parseBankWorkbook(workbook('选择填空题', [headers,
    ['根据句意选择合适的单词填空', 1, '第一组第一空', 'apple'],
    ['', 2, '第一组第二空', 'banana'],
    ['根据句意选择合适的单词填空', 1, '第二组第一空', 'cat'],
    ['', 2, '第二组第二空', 'dog'],
  ]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items.slice(0, 2).map(q => [...q.options].sort()), [['apple', 'banana'], ['apple', 'banana']]);
  assert.deepEqual(result.items.slice(2).map(q => [...q.options].sort()), [['cat', 'dog'], ['cat', 'dog']]);
  assert.deepEqual(result.items.map(q => q.options['ABCDEFGHIJ'.indexOf(q.answer)]), ['apple', 'banana', 'cat', 'dog']);
  assert.notEqual(result.items[0].group_ref, result.items[2].group_ref);
});
for (const material of ['__proto__', 'constructor', 'toString']) test('material text is treated as text rather than an object property: ' + material, () => {
  const result = parseBankWorkbook(workbook('选择填空题', [headers, [material, 1, '第一空', 'one'], ['', 2, '第二空', 'two']]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(q => [...q.options].sort()), [['one', 'two'], ['one', 'two']]);
});
test('an incomplete word-bank group cannot pass by borrowing answers from another equal-material group', () => {
  const result = parseBankWorkbook(workbook('选择填空题', [headers,
    ['选择合适的词', 1, '孤立小题', 'red'],
    ['选择合适的词', 1, '另一组第一空', 'blue'],
    ['', 2, '另一组第二空', 'green'],
  ]));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /第 2 行.*至少填 1 个干扰项/);
  assert.deepEqual(result.items.map(q => q.stem), ['另一组第一空', '另一组第二空']);
});
test('Excel error locations preserve physical row numbers after empty rows', () => {
  const result = parseBankWorkbook(workbook('单选题', [
    ['题目', '选项A', '选项B', '答案'],
    ['合法题', '甲', '乙', 'A'], [], [], ['错误题', '甲', '乙', 'C'],
  ]));
  assert.equal(result.items.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^单选题 第 5 行：/);
});
test('legacy Excel preserves numeric zero as a valid fill answer', () => {
  const result = parseWorkbook(workbook('题库', [['题型', '题干', '答案'], ['填空题', '1 - 1 = ____', 0]]), []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].answer, '0');
});
test('legacy Excel preserves numeric zero in the first option instead of reporting a gap', () => {
  const result = parseWorkbook(workbook('题库', [['题型', '题干', '选项A', '选项B', '答案'], ['单选题', '1 - 1 = ?', 0, 1, 'A']]), []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items[0].options, ['0', '1']);
  assert.equal(result.items[0].answer, 'A');
});
test('explicit options and unknown answers are preserved when material repeats', () => {
  const result = parseBankWorkbook(workbook('选择填空题', [[...headers, '选项A', '选项B'],
    ['相同说明', 1, '已知答案', '乙', '甲', '乙'],
    ['相同说明', 1, '未知答案', '', '丙', '丁'],
  ]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items.map(q => ({ options: q.options, answer: q.answer })), [
    { options: ['甲', '乙'], answer: 'B' }, { options: ['丙', '丁'], answer: '' },
  ]);
});
test('empty rows do not break one selection-cloze group or shift its source row', () => {
  const result = parseBankWorkbook(workbook('选择填空题', [headers, [], ['同一组', 1, '第一空', 'one'], [], ['', 2, '第二空', 'two']]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(q => [...q.options].sort()), [['one', 'two'], ['one', 'two']]);
  assert.equal(result.items[0].group_ref, '选择填空题:3');
  assert.equal(result.items[1].group_ref, '选择填空题:3');
});
