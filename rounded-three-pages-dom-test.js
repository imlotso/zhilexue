'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, 'public');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function app(kind, hash = kind === 'care' ? 'talks' : 'records') {
  const file = path.join(root, 'apps', kind, 'index.html');
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { url: 'https://synthetic.test/apps/' + kind + '/index.html#/' + hash, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  await new Promise(resolve => dom.window.document.readyState === 'loading' ? dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }) : resolve());
  const context = dom.getInternalVMContext();
  const w = dom.window; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.localStorage.setItem('xuexi_admin_token', 'synthetic-only');
  w.fetch = async url => ({ ok: true, json: async () => ({ code: 0, data: url === '/api/me' ? { id: 901, role: 'admin' } : { role: 'admin', branches: [{ id: 1, name: '测试校区' }], students: [{ id: 101, name: '测试学生甲', grade: '七年级', created_by: 1, branch_name: '测试校区' }, { id: 102, name: '测试学生乙', grade: '七年级', created_by: 1, branch_name: '测试校区' }] } }) });
  for (const script of w.document.querySelectorAll('script[src]')) {
    const url = new URL(script.src);
    if (url.pathname.includes('/vendor/')) continue;
    const local = path.join(root, url.pathname);
    if (fs.existsSync(local)) vm.runInContext(fs.readFileSync(local, 'utf8'), context, { filename: local });
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait(30);
  return { dom, w, d: w.document, evaluate: code => vm.runInContext(code, context), close: () => { w.close(); assert.deepEqual(errors, [], 'no uncaught DOM event errors'); } };
}
const key = (w, el, name, extra) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));

test('real care modal traps focus, names the dialog and restores the invoking action', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    d.querySelector('#tkAdd').focus(); d.querySelector('#tkAdd').click(); await wait(0);
    const dialog = d.querySelector('[role=dialog]'); assert.ok(dialog, 'dialog has accessible role');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(d.getElementById(dialog.getAttribute('aria-labelledby')).textContent, '添加谈话记录');
    const first = dialog.querySelector('button'), last = [...dialog.querySelectorAll('button')].at(-1);
    first.focus(); key(w, first, 'Tab', { shiftKey: true }); assert.equal(d.activeElement, last);
    key(w, last, 'Tab'); assert.equal(d.activeElement, first);
    key(w, first, 'Escape'); assert.equal(d.querySelector('.mask'), null);
    assert.equal(d.activeElement.id, 'tkAdd');
  } finally { f.close(); }
});

test('real care combo supports keyboard selection and Escape without selecting a different record', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    const c = w.App.ui.combo({ placeholder: '选择学生', options: [{ value: 'a', label: '测试学生甲' }, { value: 'b', label: '测试学生乙' }] });
    d.body.append(c.el); c.input.focus();
    assert.equal(c.input.getAttribute('role'), 'combobox');
    key(w, c.input, 'ArrowDown'); key(w, c.input, 'ArrowDown'); key(w, c.input, 'Enter');
    assert.equal(c.getValue(), 'b'); assert.equal(c.input.value, '测试学生乙');
    key(w, c.input, 'ArrowUp'); key(w, c.input, 'Escape');
    assert.equal(c.getValue(), 'b'); assert.equal(c.input.getAttribute('aria-expanded'), 'false');
    assert.equal(d.activeElement, c.input);
  } finally { f.close(); }
});

test('care async modal waits, rejects duplicate submission, keeps input after failure and retries', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    let calls = 0, reject; let fail = true;
    w.App.ui.modal({ title: '异步测试', bodyHTML: '<input id="draft" value="测试草稿">', buttons: [{ text: '保存', cls: 'btn btn-primary', onClick() { calls++; if (!fail) return true; return new Promise((res, rej) => { reject = rej; }); } }] });
    const btn = d.querySelector('.modal-foot button'); btn.click(); btn.click();
    assert.equal(calls, 1); assert.equal(btn.disabled, true); assert.equal(btn.getAttribute('aria-busy'), 'true');
    key(w, btn, 'Escape'); assert.ok(d.querySelector('#draft'));
    reject(new Error('合成保存错误')); await wait(0);
    assert.equal(d.querySelector('#draft').value, '测试草稿'); assert.equal(btn.disabled, false);
    fail = false; btn.click(); assert.equal(d.querySelector('.mask'), null); assert.equal(calls, 2);
  } finally { f.close(); }
});

test('care validation is connected to fields and empty filtered results do not claim there are no records', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    d.querySelector('#tkAdd').click(); d.querySelector('.modal-foot .btn-primary').click();
    const student = d.querySelector('#fStuSlot input'); assert.equal(student.getAttribute('aria-invalid'), 'true');
    assert.match(d.getElementById(student.getAttribute('aria-describedby')).textContent, /请选择学生/);
    student.focus(); key(w, student, 'ArrowDown'); key(w, student, 'Enter');
    d.querySelector('#fContent').value = '合成谈话内容'; d.querySelector('.modal-foot .btn-primary').click();
    assert.equal(d.querySelectorAll('#tkBody tr').length, 1);
    const filter = d.querySelector('#tkStudent'); filter.value = '没有此学生'; filter.dispatchEvent(new w.Event('input')); await wait(250);
    assert.match(d.querySelector('#tkEmpty').textContent, /未找到.*筛选/);
    d.querySelector('#tkReset').click(); assert.equal(d.querySelectorAll('#tkBody tr').length, 1);
  } finally { f.close(); }
});

test('grades modal retains form contents while open and restores focus after Escape', async () => {
  const f = await app('grades'); const { d, w } = f;
  try {
    const trigger = d.querySelector('#ibManual'); trigger.focus(); trigger.click();
    const dialog = d.querySelector('[role=dialog]'); assert.ok(dialog); assert.equal(dialog.getAttribute('aria-modal'), 'true');
    d.querySelector('#mName').value = '合成学生'; key(w, d.querySelector('#mName'), 'Escape');
    assert.equal(d.querySelector('#modalRoot').hidden, true); assert.equal(d.activeElement, trigger);
  } finally { f.close(); }
});


test('contact form keeps student/contact linkage, result, filtered exports and persisted records', async () => {
  const f = await app('care', 'contacts'); const { d, w } = f;
  try {
    d.querySelector('#ctAdd').click();
    const student = d.querySelector('#fStuSlot input'); student.focus(); key(w, student, 'ArrowDown'); key(w, student, 'Enter');
    const contact = d.querySelector('#fContactSlot input'); contact.focus(); key(w, contact, 'ArrowDown'); key(w, contact, 'ArrowDown'); key(w, contact, 'Enter');
    assert.equal(contact.value, '学生妈妈');
    d.querySelector('#fContent').value = '合成家校沟通内容'; d.querySelector('#fResult').value = '合成跟进结果';
    d.querySelector('.modal-foot .btn-primary').click();
    const saved = w.App.store.communications.all(); assert.equal(saved.length, 1); assert.equal(saved[0].contact, '妈妈'); assert.equal(saved[0].result, '合成跟进结果');
    assert.match(d.querySelector('#ctBody').textContent, /合成家校沟通内容/);
    const from = d.querySelector('#ctFrom'); from.value = '2099-01-01'; from.dispatchEvent(new w.Event('change')); assert.equal(d.querySelectorAll('#ctBody tr').length, 0);
    assert.match(d.querySelector('#ctEmpty').textContent, /未找到.*筛选/); d.querySelector('#ctReset').click();
    let exported; w.App.ui.exportXlsx = config => { exported = config; }; d.querySelector('#ctXlsx').click();
    assert.equal(exported.rows.length, 1); assert.equal(exported.rows[0].result, '合成跟进结果');
    let printed; w.print = () => { printed = d.querySelector('#printRoot').textContent; }; d.querySelector('#ctPdf').click(); await wait(280); assert.match(printed, /合成跟进结果/);
    d.querySelector('#ctBody [data-view]').click(); assert.match(d.querySelector('.modal-body').textContent, /合成跟进结果/);
    assert.ok([...Array(w.localStorage.length)].map((_, i) => w.localStorage.getItem(w.localStorage.key(i))).some(value => value.includes('合成家校沟通内容')));
  } finally { f.close(); }
});

test('both care forms show upload pending/error states and preserve optional-audio save rules', async () => {
  for (const kind of ['talks', 'contacts']) {
    const f = await app('care', kind); const { d, w } = f;
    try {
      d.querySelector(kind === 'talks' ? '#tkAdd' : '#ctAdd').click();
      const student = d.querySelector('#fStuSlot input'); student.focus(); key(w, student, 'ArrowDown'); key(w, student, 'Enter');
      d.querySelector('#fContent').value = '上传失败后仍保留的合成草稿';
      let reject; w.App.ui.uploadAudio = () => new Promise((resolve, fail) => { reject = fail; });
      const file = d.querySelector('#fAudioFile'); Object.defineProperty(file, 'files', { value: [new w.File(['test'], 'synthetic.wav', { type: 'audio/wav' })] }); file.dispatchEvent(new w.Event('change'));
      assert.equal(d.querySelector('#fAudioBtn').getAttribute('aria-busy'), 'true');
      assert.equal(d.querySelector('.modal-foot .btn-primary').disabled, true);
      reject(new Error('合成网络失败')); await wait(0);
      assert.match(d.querySelector('#fAudioName').textContent, /上传失败.*重试/);
      assert.equal(d.querySelector('#fContent').value, '上传失败后仍保留的合成草稿'); assert.equal(d.querySelector('.modal-foot .btn-primary').disabled, false);
      d.querySelector('.modal-foot .btn-primary').click();
      const rows = kind === 'talks' ? w.App.store.talks.all() : w.App.store.communications.all(); assert.equal(rows.length, 1); assert.equal(rows[0].audioUrl, '');
    } finally { f.close(); }
  }
});

test('grades keep current-filter pagination, detail expansion, edit entry and profile routes', async () => {
  const f = await app('grades'); const { d, w } = f;
  try {
    f.evaluate(`(() => {
      const a = Store.addExam({ name: '合成月考一', date: '2026-09-01', type: '月考' });
      const b = Store.addExam({ name: '合成月考二', date: '2026-10-01', type: '月考' });
      Store.addRecords([a, b].flatMap((e, n) => Array.from({ length: 13 }, (_, i) => ({ examId: e.id, studentName: '合成学生' + String(i + 1).padStart(2, '0'), stage: '初中·七年级', grade: '七年级', subject: '数学', fullScore: 100, score: 60 + i + n * 5, classRank: 20 - i - n, gradeRank: 40 - i - n, type: '月考', date: e.date, comment: '合成评语' }))));
      App.refresh();
    })()`);
    assert.equal(d.querySelectorAll('#listCard tbody tr[data-key]').length, 10);
    for (const size of ['20', '30']) { const select = d.querySelector('#pgSize'); select.value = size; select.dispatchEvent(new w.Event('change')); assert.equal(d.querySelectorAll('#listCard tbody tr[data-key]').length, Math.min(26, Number(size))); }
    const input = d.querySelector('#fq'); input.value = '合成学生01'; input.dispatchEvent(new w.Event('input')); await wait(350); assert.equal(d.querySelectorAll('#listCard tbody tr[data-key]').length, 2);
    let exported; f.evaluate('Excel.exportAOA = rows => { window.__exported = rows; };'); d.querySelector('#btnExportXlsx').click(); exported = w.__exported; assert.equal(exported.length, 3); assert.equal(exported[1][0], '合成学生01');
    d.querySelector('#btnReset').click(); d.querySelector('#listCard tbody tr[data-key]').click(); assert.ok(d.querySelector('.detail-box'));
    d.querySelector('[data-edit]').click(); assert.equal(d.querySelector('#modalRoot').hidden, false); assert.match(d.querySelector('.modal-title').textContent, /编辑/); f.evaluate('U.closeModal()');
    d.querySelector('[data-profile]').click(); await wait(20); assert.match(w.location.hash, /student/); assert.ok(d.querySelector('.profile-head'));
    for (const route of ['dashboard', 'tracking', 'students']) { w.location.hash = '#/' + route; await wait(20); assert.ok(d.querySelector('#mainView > *')); }
    assert.equal(f.evaluate('Store.allRecords().length'), 26);
  } finally { f.close(); }
});

test('grades associate visible labels and retain accessible sort, row, tabs and pagination controls', async () => {
  const f = await app('grades'); const { d, w } = f;
  try {
    assert.equal(d.querySelector('label[for="rSubject"]').textContent, '学科');
    f.evaluate(`(() => { const exam = Store.addExam({ name: '键盘测试月考', date: '2026-11-01', type: '月考' }); Store.addRecords([{ examId: exam.id, studentName: '合成学生', subject: '数学', score: 80, fullScore: 100, date: exam.date }]); App.refresh(); })()`);
    assert.equal(d.querySelector('#pgSize').getAttribute('aria-label'), '每页记录数');
    assert.equal(d.querySelector('.pg-btn.active').getAttribute('aria-current'), 'page');
    const sort = d.querySelector('th[data-sort="studentName"] button'); sort.click(); assert.equal(d.querySelector('th[data-sort="studentName"]').getAttribute('aria-sort'), 'ascending'); assert.equal(d.activeElement, d.querySelector('th[data-sort="studentName"] button'));
    const row = d.querySelector('.row-toggle'); assert.equal(row.getAttribute('aria-expanded'), 'false'); row.click(); assert.equal(d.querySelector('.row-toggle').getAttribute('aria-expanded'), 'true'); assert.equal(d.activeElement, d.querySelector('.row-toggle'));
    const tabs = [...d.querySelectorAll('[role="tab"]')]; assert.equal(tabs.length, 2); key(w, tabs[0], 'ArrowRight'); assert.equal(d.querySelector('[role=tab][aria-selected=true]').dataset.tab, 'kn'); assert.equal(d.activeElement.getAttribute('role'), 'tab');
    d.querySelector('#ibManual').click(); const label = d.querySelector('label[for="mName"]'); assert.ok(label); assert.match(label.textContent, /姓名/);
  } finally { f.close(); }
});

for (const kind of ['care', 'grades']) test(kind + ' keeps a draft when Escape cancels an IME composition', async () => {
  const f = await app(kind); const { d, w } = f;
  try {
    d.querySelector(kind === 'care' ? '#tkAdd' : '#ibManual').click(); await wait(0);
    const selector = kind === 'care' ? '#fContent' : '#mName', input = d.querySelector(selector);
    input.value = '合成中文草稿'; input.focus();
    key(w, input, 'Escape', { isComposing: true });
    assert.equal(d.querySelector(selector)?.value, '合成中文草稿');
    key(w, input, 'Escape', { keyCode: 229 });
    assert.equal(d.querySelector(selector)?.value, '合成中文草稿');
    key(w, input, 'Escape'); assert.equal(d.querySelector(selector), null);
  } finally { f.close(); }
});

test('care initial dialog focus skips disabled and hidden fields', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    d.querySelector('#tkAdd').focus();
    w.App.ui.modal({ title: '焦点边界', bodyHTML: '<input disabled><div hidden><input></div><input id="focusUsable">', buttons: [{ text: '关闭' }] });
    await wait(0); assert.equal(d.activeElement.id, 'focusUsable');
  } finally { f.close(); }
});


// These adapters are private to the embedded apps. The paused global redesign must not leak in.
test('grade and care documents load only their local rounded adapter and retain native date/select inputs', async () => {
  for (const kind of ['grades', 'care']) {
    const f = await app(kind);
    try {
      assert.ok(f.d.body.classList.contains('rounded-' + kind));
      const styles = [...f.d.querySelectorAll('link[rel=stylesheet]')].map(e => new URL(e.href).pathname);
      assert.equal(styles.at(-1), '/apps/' + kind + '/assets/css/rounded-workspace.css');
      assert.ok(styles.every(url => url.startsWith('/apps/' + kind + '/')));
      assert.ok([...f.d.querySelectorAll('script[src]')].every(e => new URL(e.src).pathname.startsWith('/apps/' + kind + '/')));
      const css = fs.readFileSync(path.join(root, styles.at(-1)), 'utf8');
      const style = f.d.createElement('style'); style.textContent = css; f.d.head.append(style);
      assert.equal(f.w.getComputedStyle(f.d.body).getPropertyValue(kind === 'grades' ? '--primary' : '--brand').trim(), '#0c5947');
      const select = f.d.querySelector('select'); assert.ok(select); assert.equal(select.getAttribute('role'), null);
      if (kind === 'care') { assert.equal(f.d.querySelector('#tkFrom').type, 'date'); assert.equal(f.d.querySelector('#ctFrom').type, 'date'); }
    } finally { f.close(); }
  }
});

test('care forms retain saved audio only after its upload finishes, then persist it once', async () => {
  for (const kind of ['talks', 'contacts']) {
    const f = await app('care', kind); const { d, w } = f;
    try {
      d.querySelector(kind === 'talks' ? '#tkAdd' : '#ctAdd').click();
      const student = d.querySelector('#fStuSlot input'); student.focus(); key(w, student, 'ArrowDown'); key(w, student, 'Enter');
      d.querySelector('#fContent').value = '等待录音完成的合成记录';
      let resolve; w.App.ui.uploadAudio = () => new Promise(done => { resolve = done; });
      const file = d.querySelector('#fAudioFile'); Object.defineProperty(file, 'files', { value: [new w.File(['sound'], 'synthetic.wav', { type: 'audio/wav' })] }); file.dispatchEvent(new w.Event('change'));
      const repo = kind === 'talks' ? w.App.store.talks : w.App.store.communications;
      const save = d.querySelector('.modal-foot .btn-primary'); save.click();
      assert.equal(repo.all().length, 0); assert.ok(d.querySelector('#fContent'));
      resolve({ url: '/api/admin/care-audio/' + 'a'.repeat(32), name: 'synthetic.wav' }); await wait(0);
      assert.equal(save.disabled, false); save.click(); save.click();
      assert.equal(repo.all().length, 1); assert.equal(repo.all()[0].audioUrl, '/api/admin/care-audio/' + 'a'.repeat(32));
    } finally { f.close(); }
  }
});

test('care async form failures keep drafts and retry without losing linked student or content', async () => {
  for (const kind of ['talks', 'contacts']) {
    const f = await app('care', kind); const { d, w } = f;
    try {
      d.querySelector(kind === 'talks' ? '#tkAdd' : '#ctAdd').click();
      const student = d.querySelector('#fStuSlot input'); student.focus(); key(w, student, 'ArrowDown'); key(w, student, 'Enter');
      d.querySelector('#fContent').value = '保存失败后重试的合成草稿';
      const repo = kind === 'talks' ? w.App.store.talks : w.App.store.communications;
      const add = repo.add; let reject;
      repo.add = () => new Promise((resolve, fail) => { reject = fail; });
      const save = d.querySelector('.modal-foot .btn-primary'); save.click();
      assert.ok(d.querySelector('#fContent')); assert.equal(save.disabled, true);
      reject(new Error('合成保存失败')); await wait(0);
      assert.equal(d.querySelector('#fContent').value, '保存失败后重试的合成草稿'); assert.equal(student.value, '测试学生甲'); assert.equal(save.disabled, false);
      repo.add = add; save.click(); assert.equal(repo.all().length, 1); assert.equal(repo.all()[0].content, '保存失败后重试的合成草稿');
    } finally { f.close(); }
  }
});

test('care pending saves lock editable controls and restore their previous disabled states after failure', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    let reject;
    w.App.ui.modal({ title: '保存中', bodyHTML: '<input id="editDraft" value="草稿"><button id="startUpload">上传</button><input id="alreadyDisabled" disabled>', buttons: [{ text: '保存', cls: 'btn btn-primary', onClick: () => new Promise((resolve, fail) => { reject = fail; }) }] });
    d.querySelector('.modal-foot button').click();
    assert.equal(d.querySelector('#editDraft').disabled, true); assert.equal(d.querySelector('#startUpload').disabled, true);
    reject(new Error('合成保存失败')); await wait(0);
    assert.equal(d.querySelector('#editDraft').disabled, false); assert.equal(d.querySelector('#alreadyDisabled').disabled, true); assert.equal(d.querySelector('#editDraft').value, '草稿');
  } finally { f.close(); }
});

test('care combo stays open after quickly refocusing a searchable field', async () => {
  const f = await app('care'); const { d, w } = f;
  try {
    const c = w.App.ui.combo({ options: [{ value: 'a', label: '测试学生甲' }] });
    d.body.append(c.el); c.input.focus(); c.input.blur(); c.input.focus(); await wait(150);
    assert.equal(c.input.getAttribute('aria-expanded'), 'true');
    key(w, c.input, 'ArrowDown'); key(w, c.input, 'Enter'); assert.equal(c.getValue(), 'a');
  } finally { f.close(); }
});

test('grade student rows expose native profile links and their charts use the page primary color without changing score data', async () => {
  const f = await app('grades', 'students'); const { d, w } = f;
  try {
    const style = d.createElement('style'); style.textContent = 'body { --primary: #0c5947; }'; d.head.append(style);
    f.evaluate(`(() => { const a = Store.addExam({ name: '合成一', date: '2026-09-01', type: '月考' }); const b = Store.addExam({ name: '合成二', date: '2026-10-01', type: '月考' }); Store.addRecords([a,b].map((exam,i) => ({ examId: exam.id, studentName: '合成学生/甲', subject: '数学', score: 80+i*10, fullScore: 100, date: exam.date }))); window.__charts = []; App.chart = (el, cfg) => window.__charts.push(cfg); App.refresh(); })()`);
    const link = d.querySelector('a.student-profile-link'); assert.ok(link, 'students must be keyboard-reachable links');
    assert.match(link.getAttribute('href'), /%2F/); link.click(); await wait(20);
    assert.match(d.querySelector('.profile-name').textContent, /合成学生\/甲/);
    const score = w.__charts.find(c => c.data.datasets[0].label === '总分'); assert.ok(score);
    assert.equal(score.data.datasets[0].borderColor, '#0c5947'); assert.deepEqual(Array.from(score.data.datasets[0].data), [80, 90]);
  } finally { f.close(); }
});

test('embedded page navigation retains original colors with the actual admin stylesheet loading order',()=>{
 const html=fs.readFileSync(path.join(root,'admin/index.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://synthetic.test/admin/',runScripts:'outside-only'});
 try{const d=dom.window.document;d.querySelector('#app').innerHTML='<div class="admin-app"><nav class="r10-embed-nav"><button class="active">总览看板</button></nav></div>';
  dom.window.eval(fs.readFileSync(path.join(root,'admin/admin.js'),'utf8').split('\n')[1]);
  for(const link of [...d.querySelectorAll('link[rel="stylesheet"]')]){const file=new URL(link.href).pathname.split('/').pop();if(!['ui-rounded-pages-20261108.css','r10.css'].includes(file))continue;const style=d.createElement('style');style.textContent=fs.readFileSync(path.join(root,'admin',file),'utf8');link.replaceWith(style);}
  const css=dom.window.getComputedStyle(d.querySelector('.r10-embed-nav button'));assert.equal(css.backgroundColor,'rgb(12, 89, 71)');assert.equal(css.color,'rgb(255, 255, 255)');
 }finally{dom.window.close();}
});
