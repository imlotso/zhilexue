'use strict';
// 组合题整组加入：保留已有分值，跨题型按原顺序连续排布且不重复。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = vm.createContext({ window: {}, localStorage: { getItem: () => null, setItem: () => {} } });
vm.runInContext(fs.readFileSync('public/admin/qbasket.js', 'utf8'), context);
vm.runInContext(`
const g = {source_type:'recog', source_detail:{question_group:{run_id:1,ref:'manual'}}};
const other = {source_type:'recog', source_detail:{question_group:{run_id:2,ref:'manual'}}};
const key = qbGroupKey(g);
if (key === qbGroupKey(other)) throw Error('不同批次不可合组');
QB.add({id:9,type:'judge'});
QB.add({id:2,type:'fill',score:17});
QB.add({id:8,type:'single'});
QB.add({id:1,type:'single',score:5});
QB.addGroup([{id:1,type:'single'},{id:2,type:'fill'},{id:3,type:'answer'},{id:3,type:'answer'}],key);
`, context);
const rows = JSON.parse(vm.runInContext('JSON.stringify(QB.list())', context));
assert.deepStrictEqual(rows.map(x => x.id), [9, 1, 2, 3, 8]);
assert.deepStrictEqual(rows.slice(1, 4).map(x => x.type), ['single', 'fill', 'answer']);
assert.strictEqual(rows[1].score, 5);
assert.strictEqual(rows[2].score, 17);
vm.runInContext('QB.addGroup([{id:1,type:"single"},{id:2,type:"fill"},{id:3,type:"answer"}],key)', context);
assert.strictEqual(vm.runInContext('QB.count()', context), 5);
vm.runInContext('QB.remove(2)', context);
assert.strictEqual(vm.runInContext('QB.has(2)', context), false);
console.log('组合题篮顺序、批次隔离、分值与去重通过');
