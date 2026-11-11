'use strict';
// Execute the real grades store, Excel parser and modal flows with synthetic local storage only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, 'public/apps/grades');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const key = 'campus_grade_db_v2:admin:101';
const copy = value => JSON.parse(JSON.stringify(value));
const normal = (extra = {}) => ({ id: 'junior', campusId: 'br1', examId: 'ex', studentName: '合成初中生', stage: '初中·八年级', grade: '八年级', className: '八(1)班', subject: '物理', fullScore: 100, score: 80, date: '2026-11', ...extra });
const legacy = (extra = {}) => normal({ id: 'legacy', studentName: '合成历史生', stage: '高中·高二', grade: '高二', className: '高二(1)班', ...extra });
async function fixture({ records = [], uploads = [], workbook = false } = {}) {
  const dom = new JSDOM('<div id="modalRoot" hidden><div id="modalBox"></div></div><div id="toastRoot"></div><input type="file" id="imageInput"><input type="file" id="fileInput">', { runScripts: 'outside-only', url: 'http://localhost/apps/grades/' });
  const w = dom.window;
  // Synthetic identity/roster responses exercise the real v2 authorization boundary.
  w.fetch = async url => {
    assert.ok(['/api/me', '/api/admin/grades-roster'].includes(url), 'Unexpected network access');
    return { ok: true, json: async () => ({ code: 0, data: url === '/api/me'
      ? { id: 101, role: 'admin' }
      : { branches: [{ id: 1, name: '合成校区' }], students: [] } }) };
  };
  w.localStorage.setItem('xuexi_admin_token', 'synthetic-test-token');
  const seed = { currentCampusId: 'br1', campuses: [{ id: 'br1', name: '合成校区' }], exams: [{ id: 'ex', campusId: 'br1', name: '合成考试', date: '2026-11', type: '月考' }], records, students: [], papers: [], parentUploads: uploads };
  w.localStorage.setItem(key, JSON.stringify(seed));

  const writes = [], setItem = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function(k, v) { writes.push(k); return setItem.call(this, k, v); };
  if (workbook) w.eval(read('vendor/xlsx.full.min.js'));
  w.eval(['util.js', 'store.js', 'analytics.js', 'excel.js', 'views/import.js'].map(f => read('assets/js/' + f)).join('\n') + '\nwindow.gradeTest = { Store, Excel, ViewImport, U };');
  const { Store, Excel, ViewImport, U } = w.gradeTest;
  Store.load();
  assert.equal(await Store.syncRoster(), true);
  writes.length = 0;
  let refreshes = 0;
  w.App = { refresh() { refreshes++; } };
  return { dom, w, Store, Excel, ViewImport, U, writes, seed,
    get refreshes() { return refreshes; },
    get notices() { return w.document.querySelector('#toastRoot').textContent; },
    get saved() { return w.localStorage.getItem(key); },
    field(id, value) { const el = w.document.getElementById(id); assert.ok(el, id); if (value !== undefined) el.value = value; return el; },
    close() { dom.window.close(); }
  };
}
const head = ['姓名', '学段', '年级', '班级', '科目', '满分', '得分', '老师评语'];
const row = (name, stage = '初中', grade = '八年级', className = '八(1)班', comment = '') => [name, stage, grade, className, '化学', 100, 82, comment];
async function upload(f, matrix, name = '合成导入考试') {
  f.ViewImport.openUploadModal();
  f.field('upName', name); f.field('upDateY', '2026'); f.field('upDateM', '11');
  const wb = f.w.XLSX.utils.book_new();
  f.w.XLSX.utils.book_append_sheet(wb, f.w.XLSX.utils.aoa_to_sheet(matrix), '成绩');
  const file = new f.w.File([f.w.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], 'synthetic.xlsx');
  Object.defineProperty(f.field('fileInput'), 'files', { configurable: true, value: [file] });
  f.field('fileInput').dispatchEvent(new f.w.Event('change'));
  for (let i = 0; i < 100 && !f.field('upPreview').textContent; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(f.field('upPreview').textContent, /表头识别成功/, 'real workbook must reach the parser and preview');
}

test('grades classifier checks stage, grade and class labels without examining comments or shared subjects', async () => {
  const f = await fixture(); try {
    for (const field of ['stage', 'grade', 'className']) {
      for (const value of ['高中', '高一', '高二(1)班', '高3', 'SENIOR', ' 高　中 ', '10年级', '十一年级', '十二年级', '高２']) {
        assert.match(f.Store.scopeError({ [field]: value }), /小学.*初中/, `${field}=${value}`);
      }
    }
    for (const r of [normal(), normal({ stage: '小学·六年级', grade: '六年级', className: '六(12)班' }), normal({ subject: '化学', comment: '高中目标仅为评语文字' }), { stage: '', grade: '', className: '' }]) {
      assert.equal(f.Store.scopeError(r), '');
    }
    for (const className of ['提高一班', '提高1班', '初二提高一班', '八年级提高1班', '初中·提高一班', '小学提高２班', '基础班 / 提高三班']) {
      assert.equal(f.Store.scopeError(normal({ className })), '', className);
    }
    for (const className of ['高一年级', '高一(1)班', '高二（2）班', '实验班·高三', '数学 高1班', '分类：高中', '高中提高一班', '十一年级(2)班']) {
      assert.match(f.Store.scopeError(normal({ className })), /小学.*初中/, className);
    }
  } finally { f.close(); }
});

test('store rejects an entire invalid additions batch before mutating inputs, state or persisted history', async () => {
  const old = legacy(), f = await fixture({ records: [old] }); try {
    const before = f.saved, list = [normal({ id: undefined }), normal({ id: undefined, stage: 'senior' })], input = copy(list);
    assert.equal(f.Store.addRecords(list), false);
    assert.deepEqual(copy(list), input); assert.deepEqual(copy(f.Store.allRecords()), [old]);
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []);
    assert.match(f.notices, /小学.*初中/);
    assert.equal(f.Store.addRecords([normal()]), true);
    assert.equal(f.Store.allRecords().length, 2); assert.deepEqual(copy(f.Store.allRecords()[0]), old);
  } finally { f.close(); }
});

test('store refuses reclassification and edits of legacy high-school records, while junior edits work', async () => {
  const old = legacy(), f = await fixture({ records: [old, normal()] }); try {
    const before = f.saved;
    assert.equal(f.Store.updateRecord('junior', { grade: '十年级' }), false);
    assert.equal(f.Store.updateRecord('legacy', { score: 91 }), false);
    assert.equal(f.Store.updateRecord('legacy', { stage: '初中', grade: '八年级', className: '八(1)班' }), false);
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []);
    assert.deepEqual(copy(f.Store.allRecords()), [old, normal()]);
    assert.equal(f.Store.updateRecord('junior', { score: 91, comment: '继续努力' }), true);
    assert.equal(f.Store.allRecords()[1].score, 91); assert.deepEqual(copy(f.Store.allRecords()[0]), old);
  } finally { f.close(); }
});

test('parent upload store rejects high-school batches and legacy approval without changing pending history', async () => {
  const old = legacy({ id: 'upload', status: 'pending' }), f = await fixture({ uploads: [old] }); try {
    const before = f.saved;
    assert.equal(f.Store.addParentUpload([normal(), legacy()]), false);
    assert.equal(f.Store.setUploadStatus('upload', 'approved'), false);
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []);
    assert.deepEqual(copy(f.Store.parentUploads()), [old]);
    assert.equal(f.Store.addParentUpload([normal({ id: 'new-upload' })]), true);
    assert.equal(f.Store.parentUploads().length, 2);
  } finally { f.close(); }
});

test('real Excel parser identifies every classification column and preserves invalid source values for feedback', async () => {
  const f = await fixture(); try {
    const res = f.Excel.parseMatrix([head, row('合成甲', 'senior'), row('合成乙', '初中', '高一'), row('合成丙', '初中', '八年级', '高三(2)班'), row('合成丁', '初中', '八年级', '八(1)班', '将来高中也要保持努力')]);
    assert.equal(res.rows.length, 4); assert.equal(res.errors.length, 3);
    for (const r of res.errors) assert.match(r._err.join('；'), /小学.*初中/);
    assert.equal(res.rows[0].stage, 'senior'); assert.equal(res.rows[1].grade, '高一'); assert.equal(res.rows[2].className, '高三(2)班');
    assert.equal(res.rows[3]._err.length, 0); assert.equal(res.rows[3].subject, '化学');
  } finally { f.close(); }
});

test('manual form rejects high-school stage, grade and class before creating an exam; valid subjects still save', async () => {
  const old = legacy(), f = await fixture({ records: [old] }); try {
    const before = f.saved;
    f.ViewImport.openManualModal();
    f.field('mName', '合成新增生'); f.field('mExamName', '合成新增考试'); f.field('mSubject', '物理'); f.field('mScore', '88');
    for (const [field, value] of [['mStage', '高中'], ['mGrade', '11年级'], ['mClass', '高二(1)班']]) {
      f.field('mStage', '初中'); f.field('mGrade', '八年级'); f.field('mClass', '八(1)班'); f.field(field, value);
      f.field('mOk').click();
      assert.equal(f.saved, before); assert.deepEqual(f.writes, []); assert.equal(f.Store.exams().length, 1);
      assert.match(f.notices, /小学.*初中/); assert.equal(f.w.document.querySelector('#modalRoot').hidden, false);
    }
    f.field('mClass', '八(1)班'); f.field('mOk').click();
    assert.equal(f.Store.allRecords().length, 2); assert.equal(f.Store.allRecords()[1].subject, '物理');
    assert.deepEqual(copy(f.Store.allRecords()[0]), old); assert.equal(f.refreshes, 1);
  } finally { f.close(); }
});

test('legacy grade editor refuses without mutation, and a supported record still edits through the real modal', async () => {
  const old = legacy(), f = await fixture({ records: [old, normal()] }); try {
    const before = f.saved;
    f.ViewImport.openEditRecord('ex', old.studentName);
    assert.equal(f.w.document.querySelector('#modalRoot').hidden, true);
    assert.match(f.notices, /高中.*历史|历史.*高中/);
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []);
    f.ViewImport.openEditRecord('ex', normal().studentName);
    f.w.document.querySelector('[data-f="score"]').value = '93'; f.field('erOk').click();
    assert.equal(f.Store.allRecords()[1].score, 93); assert.deepEqual(copy(f.Store.allRecords()[0]), old);
  } finally { f.close(); }
});

test('real workbook preview explains blocked rows and imports only supported rows without altering history', async () => {
  const old = legacy(), f = await fixture({ records: [old], workbook: true }); try {
    await upload(f, [head, row('合成高中生', '高中'), row('合成新生')]);
    assert.match(f.field('upPreview').textContent, /小学.*初中/);
    f.field('upOk').click();
    assert.equal(f.Store.allRecords().length, 2); assert.equal(f.Store.allRecords()[1].studentName, '合成新生');
    assert.deepEqual(copy(f.Store.allRecords()[0]), old); assert.match(f.notices, /跳过异常 1 条/);
  } finally { f.close(); }
});

test('an entirely high-school workbook does not create an empty exam or write storage', async () => {
  const f = await fixture({ workbook: true }); try {
    const before = f.saved;
    await upload(f, [head, row('合成高中生', '初中', '八年级', '高三(1)班')]);
    assert.match(f.field('upPreview').textContent, /小学.*初中/);
    assert.equal(f.field('upOk').disabled, true);
    f.field('upOk').onclick(); // Submission guard must also work independently of button disabled state.
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []); assert.equal(f.Store.exams().length, 1);
  } finally { f.close(); }
});

for (const overwrite of [false, true]) test(`workbook ${overwrite ? 'replacement cannot overwrite a high-school history row' : 'blank classification cannot inherit high-school history into a new exam'}`, async () => {
  const old = legacy({ subject: '化学' }), f = await fixture({ records: [old], workbook: true }); try {
    const before = f.saved;
    await upload(f, [head, overwrite ? row(old.studentName) : row(old.studentName, '', '', '')], overwrite ? '合成考试' : '合成新考试');
    f.field('upOk').click();
    assert.equal(f.saved, before); assert.deepEqual(f.writes, []); assert.equal(f.Store.exams().length, 1);
    assert.deepEqual(copy(f.Store.allRecords()), [old]); assert.match(f.notices, /小学.*初中|历史.*高中|高中.*历史/);
    assert.equal(f.w.document.querySelector('#modalRoot').hidden, false);
  } finally { f.close(); }
});

test('legacy parent approval checks source and replacement before exam creation, deletion or status changes', async () => {
  for (const overwrite of [false, true]) {
    const old = legacy(), pending = (overwrite ? normal : legacy)({ id: 'upload', studentName: old.studentName, status: 'pending', createdAt: 1, examId: overwrite ? 'ex' : '', examName: '合成待审考试' });
    const f = await fixture({ records: [old], uploads: [pending] }); try {
      const before = f.saved;
      f.ViewImport.showPendingUploads(); f.w.document.querySelector('[data-ok="upload"]').click();
      assert.equal(f.saved, before); assert.deepEqual(f.writes, []); assert.equal(f.Store.exams().length, 1);
      assert.deepEqual(copy(f.Store.allRecords()), [old]); assert.equal(f.Store.parentUploads()[0].status, 'pending');
      assert.match(f.notices, /小学.*初中|高中.*历史|历史.*高中/);
    } finally { f.close(); }
  }
});

test('supported workbook replacement updates the intended row and keeps unrelated historical records intact', async () => {
  const old = legacy(), junior = normal({ subject: '化学' }), f = await fixture({ records: [old, junior], workbook: true }); try {
    await upload(f, [head, row(junior.studentName)], '合成考试');
    f.field('upOk').click();
    assert.equal(f.Store.exams().length, 1); assert.equal(f.Store.allRecords().length, 2);
    const changed = f.Store.allRecords().find(r => r.studentName === junior.studentName);
    assert.equal(changed.score, 82); assert.equal(changed.stage, '初中'); assert.equal(changed.examId, 'ex');
    assert.deepEqual(copy(f.Store.allRecords().find(r => r.id === old.id)), old);
    assert.match(f.notices, /覆盖 1 条/); assert.equal(f.refreshes, 1);
  } finally { f.close(); }
});

test('supported parent approval still replaces a matching junior row and marks only that upload approved', async () => {
  const old = legacy(), junior = normal(), pending = normal({ id: 'upload', status: 'pending', score: 94, createdAt: 1 });
  const f = await fixture({ records: [old, junior], uploads: [pending] }); try {
    f.ViewImport.showPendingUploads(); f.w.document.querySelector('[data-ok="upload"]').click();
    assert.equal(f.Store.allRecords().length, 2); assert.equal(f.Store.exams().length, 1);
    assert.equal(f.Store.allRecords().find(r => r.studentName === junior.studentName).score, 94);
    assert.equal(f.Store.parentUploads()[0].status, 'approved');
    assert.deepEqual(copy(f.Store.allRecords().find(r => r.id === old.id)), old);
    assert.match(f.notices, /已通过并写入成绩/); assert.equal(f.refreshes, 1);
  } finally { f.close(); }
});

test('junior improvement classes can be manually added, edited and imported through real form flows', async () => {
  const f = await fixture({ workbook: true }); try {
    f.ViewImport.openManualModal('ex');
    f.field('mName', '合成提高生'); f.field('mStage', '初中'); f.field('mGrade', '八年级');
    f.field('mClass', '初二提高一班'); f.field('mSubject', '化学'); f.field('mScore', '76'); f.field('mOk').click();
    assert.equal(f.Store.allRecords().length, 1);
    f.ViewImport.openEditRecord('ex', '合成提高生');
    f.w.document.querySelector('[data-f="score"]').value = '79'; f.field('erOk').click();
    assert.equal(f.Store.allRecords()[0].score, 79);
    await upload(f, [head, row('合成提高生', '初中', '八年级', '八年级提高1班')], '合成考试');
    assert.doesNotMatch(f.field('upPreview').textContent, /仅支持小学和初中/);
    f.field('upOk').click();
    assert.equal(f.Store.allRecords().length, 1); assert.equal(f.Store.allRecords()[0].score, 82);
    assert.equal(f.Store.allRecords()[0].className, '八年级提高1班'); assert.equal(f.refreshes, 3);
  } finally { f.close(); }
});

test('merged scope and atomicity: quota failure on mixed workbook preserves all history and retry imports only junior rows', async () => {
  const old = legacy(), f = await fixture({ records: [old], workbook: true });
  const setItem = f.w.Storage.prototype.setItem;
  try {
    const before = f.saved;
    await upload(f, [head, row('合成高中生', '高中'), row('合成初中新生')]);
    f.w.Storage.prototype.setItem = function(k, v) { if (k === key) throw new Error('Synthetic quota'); return setItem.call(this, k, v); };
    f.field('upOk').click();
    assert.equal(f.saved, before); assert.deepEqual(copy(f.Store.allRecords()), [old]);
    assert.equal(f.Store.exams().length, 1); assert.equal(f.w.document.querySelector('#modalRoot').hidden, false);
    f.w.Storage.prototype.setItem = setItem;
    f.field('upOk').click();
    assert.equal(f.Store.allRecords().length, 2); assert.equal(f.Store.exams().length, 2);
    assert.deepEqual(copy(f.Store.allRecords()[0]), old);
    assert.equal(f.Store.allRecords()[1].studentName, '合成初中新生');
    assert.equal(f.Store.allRecords()[1].stage, '初中');
    assert.match(f.notices, /跳过异常 1 条/);
  } finally { f.w.Storage.prototype.setItem = setItem; f.close(); }
});

test('merged scope and identity: token changes invalidate saved grades even for an otherwise valid junior write', async () => {
  const old = legacy(), f = await fixture({ records: [old] });
  try {
    const before = f.saved;
    f.w.localStorage.setItem('xuexi_admin_token', 'synthetic-other-account');
    assert.throws(() => f.Store.addRecords([normal()]), /登录|验证/);
    assert.equal(f.saved, before); assert.equal(f.Store.allRecords().length, 0);
    assert.equal(JSON.parse(f.saved).records[0].stage, old.stage);
  } finally { f.close(); }
});
