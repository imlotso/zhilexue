'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lock = require('./package-lock.json');
function atLeast(actual, minimum) {
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}
for (const [name, minimum] of [['body-parser','1.20.9'],['qs','6.16.1'],['ws','8.21.0'],['xlsx','0.20.3']]) {
  test(`locked ${name} includes the reviewed security fixes`, () => {
    const dependency = lock.packages['node_modules/' + name];
    assert.ok(atLeast(dependency.version, minimum), `${name} ${dependency.version} is older than ${minimum}`);
    assert.ok(dependency.integrity, 'lockfile must retain package integrity');
  });
}
const browserFile = path.join(__dirname, 'public/vendor/sheetjs/xlsx.full.min.js');
test('admin spreadsheet browser bundle has the same patched SheetJS version', () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(browserFile, 'utf8'), ctx);
  assert.ok(atLeast(ctx.XLSX.version, '0.20.3'), `browser SheetJS ${ctx.XLSX.version} is older than 0.20.3`);
});
for (const [label, getXLSX] of [
  ['server', () => require('xlsx')],
  ['admin browser', () => { const ctx={}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(browserFile,'utf8'),ctx); return ctx.XLSX; }]
]) {
  test(`${label} preserves Chinese, inequalities, options and formula cells in XLSX roundtrip`, () => {
    const XLSX = getXLSX();
    const values = [['题目','选项A','答案'],['若 1 < x < 3 且 y > 0，求 x+y。','中文 & 数学','A']];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet.D1 = {t:'n',v:3,f:'SUM(1,2)'}; sheet['!ref'] = 'A1:D2';
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,'合成题目');
    const bytes = XLSX.write(book,{type:'base64',bookType:'xlsx'});
    const restored = XLSX.read(bytes,{type:'base64'}).Sheets['合成题目'];
    assert.equal(restored.A2.v,values[1][0]); assert.equal(restored.B2.v,values[1][1]);
    assert.equal(restored.C2.v,'A'); assert.equal(restored.D1.f,'SUM(1,2)');
  });
}
