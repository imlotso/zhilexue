'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const backend = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
const front = fs.readFileSync(path.join(__dirname, 'public/js/bank.js'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
const dateCode = between(backend, 'const todayStr = () => {', '\n/** 知识点（视频）');
const bucketCode = between(front, '    const dayStart = new Date();', '\n    /** 把一组错题串成');
class FixedDate extends Date { constructor(...args) { if (args.length) super(...args); else super(2026, 10, 7, 12); } }
function run(code, expression, extra = {}) { return vm.runInNewContext(code + '\n' + expression, { Date: FixedDate, subject: '数学', ...extra }); }
for (const [base, offset, expected] of [
  ['2026-11-07', 1, '2026-11-08'], ['2026-11-07', 2, '2026-11-09'], ['2026-11-07', 4, '2026-11-11'],
  ['2026-01-31', 2, '2026-02-02'], ['2026-12-31', 1, '2027-01-01'],
  ['2028-02-28', 2, '2028-03-01'], ['2026-02-28', 1, '2026-03-01'],
  ['', 1, '2026-11-08'], ['2026-11-07', '2', '2026-11-09'],
]) test('review calendar ' + JSON.stringify([base, offset]) + ' => ' + expected, () => assert.equal(run(dateCode, `addDays(${JSON.stringify(base)},${JSON.stringify(offset)})`), expected));
for (const [age, bucket] of [[0,'d2'],[1,'d2'],[2,'d2'],[3,'d7'],[7,'d7'],[8,'d180'],[180,'d180'],[181,'history']]) {
  const d = new Date(2026,10,7); d.setDate(d.getDate()-age);
  const updated = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 16:20:00`;
  test('mistake age ' + age + ' is measured as calendar days', () => assert.equal(run(bucketCode, 'ageDays(m)', {m:{updated_at:updated}}), age));
  test('mistake age ' + age + ' belongs only to ' + bucket, () => {
    const m = {updated_at:updated, subject:'数学',resolved:0};
    assert.equal(run(bucketCode, 'bucketOf(m)', {m}), bucket);
    for (const b of ['d2','d7','d180']) assert.equal(run(bucketCode, `inBucket(m,'${b}')`,{m}),b===bucket);
  });
}
test('resolved and other-subject mistakes are excluded from strengthening buckets', () => {
  for (const m of [{updated_at:'2026-11-07',subject:'数学',resolved:1},{updated_at:'2026-11-07',subject:'英语',resolved:0}]) assert.equal(run(bucketCode,"inBucket(m,'d2')",{m}),false);
});
test('future timestamps remain clamped at zero days', () => assert.equal(run(bucketCode,'ageDays(m)',{m:{updated_at:'2026-11-08'}}),0));
for (const zone of ['Asia/Shanghai','America/New_York']) test('calendar increments handle DST boundaries in ' + zone, () => {
  const child = spawnSync(process.execPath,['-e',dateCode + "\nconsole.log(JSON.stringify([addDays('2026-03-07',2),addDays('2026-10-31',2)]));"],{env:{...process.env,TZ:zone},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),['2026-03-09','2026-11-02']);
});
