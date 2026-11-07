'use strict';
// Evaluate production option builders and pure classifiers without booting the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const primary = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
const junior = ['七年级', '八年级', '九年级'];
function declaration(file, name) {
  const found = read(file).split('\n').find(line => new RegExp('^\\s*(?:const|var) ' + name + ' = ').test(line));
  assert.ok(found, file + ':' + name); return found;
}
function arrow(file, name) {
  const s = read(file), a = s.indexOf('const ' + name + ' = '), b = s.indexOf('\n};', a);
  assert.ok(a >= 0 && b > a, name); return s.slice(a, b + 3);
}
function value(code, expr) { return vm.runInNewContext(code + '\n' + expr); }
const lists = [
  ['public/admin/admin.js', 'GRADES'], ['public/admin/bankui.js', 'BK_GRADES'],
  ['public/admin/mfbankui.js', 'MF_GRADES'], ['public/admin/pendingui.js', 'PD_GRADES'],
  ['public/admin/intake-manual.js', 'grades'], ['public/upload.html', 'GRADES'],
  ['src/bank.js', 'GRADES'], ['src/kbtree.js', 'GRADES'],
];
for (const [file, name] of lists) test(file + ': grade options cover primary 1–6 without losing junior grades', () => {
  const grades = Array.from(value(declaration(file, name), name));
  assert.deepEqual(grades.slice(0, 6), primary);
  for (const grade of junior) assert.ok(grades.includes(grade));
  assert.equal(new Set(grades).size, grades.length);
});
for (const [file, name] of [['public/admin/ktreeui.js', 'KT_GRADES'], ['public/admin/mfui2.js', 'GRADES']]) test(file + ': primary tree and question scope includes grades 1–6', () => {
  const grades = value(declaration(file, name), name);
  assert.deepEqual(Array.from(grades.primary), primary);
  assert.deepEqual(Array.from(grades.junior).slice(0, 3), junior);
});
const appClassifiers = declaration('src/app.js', 'PRIMARY_GRADES') + '\n' + declaration('src/app.js', 'JUNIOR_GRADES') + '\n' + arrow('src/app.js', 'stageOfGrade') + '\n' + arrow('src/app.js', 'studentStage');
for (const file of ['src/app.js', 'src/bank.js']) {
  const code = file === 'src/app.js' ? appClassifiers : arrow(file, 'stageOfGrade');
  for (const grade of primary) test(file + ': infer ' + grade + ' as primary', () => assert.equal(value(code, `stageOfGrade('', '${grade}')`), 'primary'));
  test(file + ': preserve explicit stage and unknown-grade behavior', () => {
    assert.equal(value(code, "stageOfGrade('junior', '一年级')"), 'junior');
    assert.equal(value(code, "stageOfGrade('', '未知年级')"), '');
    assert.equal(value(code, "stageOfGrade('', '九年级')"), 'junior');
  });
}
for (const grade of primary.slice(0, 2)) {
  test('student validation accepts inferred primary for ' + grade, () => {
    const r = value(appClassifiers, `studentStage('', '${grade}')`); assert.equal(r.value, 'primary'); assert.equal(r.err, '');
  });
  test('student validation rejects junior mismatch for ' + grade, () => {
    const r = value(appClassifiers, `studentStage('junior', '${grade}')`); assert.equal(r.value, ''); assert.match(r.err, /属于小学/);
  });
  test('course knowledge binding infers primary for ' + grade, () => assert.equal(value(arrow('src/bank.js', 'chapterStage'), `chapterStage({grade:'${grade}'})`), 'primary'));
}
test('student account dropdown renders and preserves selected first grade', () => {
  const code = declaration('public/admin/admin.js', 'GRADES') + '\n' + declaration('public/admin/admin.js', 'gradePick');
  const html = value(code, "gradePick('一年级')");
  assert.match(html, /<option value="一年级" selected>一年级<\/option>/);
  assert.match(html, /请选择年级/);
});
test('manual question entry actually renders first and second grade in its form', async () => {
  const view = await vm.runInNewContext(read('public/admin/intake-manual.js') + '\nviewIntakeManual()', { esc: s => String(s) });
  const select = view.html.match(/id="r4m-grade"[\s\S]*?<\/select>/)[0];
  for (const g of primary) assert.ok(select.includes(`value="${g}"`), g);
});
test('pending review preserves first-grade classification when rendering options', () => {
  const s = read('public/admin/pendingui.js'), end = s.indexOf('const pdBr');
  const html = vm.runInNewContext(s.slice(0, end) + "pdOpts(PD_GRADES, '一年级', '未识别')", { esc: s => String(s) });
  assert.match(html, /value="一年级" selected/); assert.match(html, /value="二年级"/);
});
test('knowledge migration places first and second grade before later grades', () => {
  const code = declaration('src/kbtree.js', 'GRADES') + '\n' + declaration('src/kbtree.js', 'gradeSort');
  const sorted = value(code, "['三年级','二年级','一年级','九年级'].sort((a,b)=>gradeSort(a)-gradeSort(b))");
  assert.deepEqual(Array.from(sorted), ['一年级','二年级','三年级','九年级']);
});
test('both course list SQL order clauses retain ascending primary years', () => {
  const clauses = [...read('src/app.js').matchAll(/FIELD\(IFNULL\(c\.grade,''\),([^)]*)\)/g)];
  assert.equal(clauses.length, 2);
  for (const clause of clauses) assert.deepEqual([...clause[1].matchAll(/'([^']+)'/g)].map(x => x[1]).slice(0, 6), primary);
});

test('new primary years do not shift previously persisted knowledge grade sort values', () => {
  const code = declaration('src/kbtree.js', 'GRADES') + '\n' + declaration('src/kbtree.js', 'gradeSort');
  const old = ['三年级','四年级','五年级','六年级','七年级','八年级','九年级','中考冲刺'];
  for (let i = 0; i < old.length; i++) assert.equal(value(code, `gradeSort('${old[i]}')`), i);
  assert.equal(value(code, "gradeSort('未知')"), 8);
  assert.ok(value(code, "gradeSort('一年级')") < value(code, "gradeSort('二年级')"));
  assert.ok(value(code, "gradeSort('二年级')") < 0);
});

test('real knowledge writer inserts lower years ahead of an existing third-grade node without rewriting it', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE bank_trees(id INTEGER PRIMARY KEY, kind TEXT, subject TEXT, stage TEXT, edition TEXT, name TEXT, source TEXT, sort INTEGER, created_at TEXT);
      CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY, tree_id INTEGER, parent_id INTEGER, name TEXT, sort INTEGER, created_at TEXT);
      INSERT INTO bank_trees VALUES(1,'knowledge','数学','primary','','合成测试树','synthetic',0,'');
      INSERT INTO bank_tree_nodes VALUES(1,1,NULL,'教材单元知识点',99,'');
      INSERT INTO bank_tree_nodes VALUES(2,1,1,'三年级',0,'unchanged');`);
    const kb = require('./src/kbtree');
    const old = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=2').get();
    const second = kb.addUnit(db, '数学', 'primary', '二年级', '合成单元二', 0);
    const first = kb.addUnit(db, '数学', 'primary', '一年级', '合成单元一', 0);
    assert.deepEqual(db.prepare('SELECT name FROM bank_tree_nodes WHERE parent_id=1 ORDER BY sort,id').all().map(x => x.name), ['一年级','二年级','三年级']);
    assert.deepEqual(db.prepare('SELECT * FROM bank_tree_nodes WHERE id=2').get(), old);
    assert.equal(kb.addUnit(db, '数学', 'primary', '一年级', '合成单元一', 0), first);
    assert.ok(second !== first);
    assert.equal(kb.readUnits(db, '数学', 'primary', '一年级')[0].id, first);
  } finally { db.close(); }
});

function namedFunction(file, name) {
  const s = read(file), a = s.indexOf('function ' + name + '('), b = s.indexOf('\n}', a);
  assert.ok(a >= 0 && b > a); return s.slice(a, b + 2);
}
for (const grade of primary.slice(0, 2)) {
  test('student navigation infers ' + grade + ' and excludes junior exam categories', () => {
    const code = declaration('public/js/vue-app.js', 'CATEGORIES') + '\n' + namedFunction('public/js/vue-app.js', 'myStage') + '\n' + namedFunction('public/js/vue-app.js', 'catsForStudent');
    const c = { Auth: { user: { grade } } }; vm.createContext(c);
    vm.runInContext(code, c);
    assert.equal(vm.runInContext('myStage()', c), 'primary');
    assert.ok(!vm.runInContext('catsForStudent()', c).includes('中考冲刺'));
  });
  test('student form grade change updates ' + grade + ' to primary', () => {
    const s = read('public/admin/admin.js'), a = s.indexOf('      const syncStage = () => {'), b = s.indexOf('\n      };', a);
    assert.ok(a > 0 && b > a);
    const c = { g: { value: grade }, st: { value: 'junior' } };
    vm.runInNewContext(s.slice(a, b + 9) + '\nsyncStage()', c);
    assert.equal(c.st.value, 'primary');
  });
  test('import mapping derives primary stage from ' + grade + ' label', () => {
    const code = declaration('src/mfbank.js', 'MF_STAGE_MAP') + '\n' + namedFunction('src/mfbank.js', 'mfMapStage');
    assert.equal(value(code, `mfMapStage('${grade}上')`), 'primary');
    assert.equal(value(code, "mfMapStage('初中')"), 'junior');
    assert.equal(value(code, "mfMapStage('高中')"), 'senior');
    assert.equal(value(code, "mfMapStage('七年级')"), 'junior');
  });
}
