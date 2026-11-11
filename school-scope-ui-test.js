'use strict';
// Offline UI regression: real selectors/renderers and local draft storage only.
// No database, service, remote requests or customer data are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function fixture(t, html = '<main id="view"></main>') {
  const dom = new JSDOM(html, { url: 'https://ui.invalid/admin/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, context = dom.getInternalVMContext();
  Object.assign(w, { esc, ic: () => '', ADM: { page: {}, chapters: [] }, Auth: { user: { id: 1 }, token: 'synthetic' }, api: async () => ({ list: [] }) });
  w.fetch = () => { throw new Error('Unexpected network request'); };
  return { w, d: w.document, run: expression => vm.runInContext(expression, context), load: file => vm.runInContext(read(file), context, { filename: file }) };
}
const values = select => [...select.options].filter(o => !o.disabled).map(o => o.value).filter(Boolean);

test('all shared school-stage choices retain primary/junior and remove senior', t => {
  const f = fixture(t);
  for (const [file, constant] of [
    ['ktreeui.js', 'KT_STAGES'], ['mfbankui.js', 'MF_STAGES'], ['pendingui.js', 'PD_STAGES'], ['treepanel.js', 'TPN_STAGES'],
  ]) {
    f.load('public/admin/' + file);
    assert.deepEqual(JSON.parse(f.run(`JSON.stringify(${constant}.map(x => x[0]).filter(Boolean))`)), ['primary', 'junior'], file);
  }
  f.load('public/admin/mfui2.js');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(Object.keys(MF_STAGE_NAMES))')), ['primary', 'junior']);
});

test('pending classification keeps historical values selected but unavailable as new choices', t => {
  const f = fixture(t); f.load('public/admin/pendingui.js');
  const item = { subject: '物理', stage: 'senior', grade: '高一' }, before = JSON.stringify(item);
  f.w.item = item;
  f.d.getElementById('view').innerHTML = f.run('pdClassificationHTML(item)');
  const stage = f.d.getElementById('pd-class-stage'), grade = f.d.getElementById('pd-class-grade');
  assert.equal(stage.value, 'senior'); assert.equal(grade.value, '高一');
  assert.equal(stage.selectedOptions[0].disabled, true); assert.equal(grade.selectedOptions[0].disabled, true);
  assert.match(stage.selectedOptions[0].textContent, /历史/);
  assert.deepEqual(values(stage), ['primary', 'junior']);
  assert.equal(JSON.stringify(item), before, 'rendering must not rewrite historical classification');
  assert.ok(values(f.d.getElementById('pd-class-sub')).includes('物理'));
  assert.ok(values(f.d.getElementById('pd-class-sub')).includes('化学'));
});

test('manual entry and captured-tree import offer only primary and junior stages', async t => {
  const f = fixture(t); f.load('public/admin/intake-manual.js');
  f.d.getElementById('view').innerHTML = (await f.run('viewIntakeManual()')).html;
  assert.deepEqual(values(f.d.getElementById('r4m-stage')), ['primary', 'junior']);
  assert.ok(values(f.d.getElementById('r4m-subject')).includes('化学'));
  let modal; f.w.tpTrees = async () => []; f.w.modal = options => { modal = options; };
  f.load('public/admin/capture-tree-import.js'); await f.run('mfTreeImportDialog()');
  f.d.getElementById('view').innerHTML = modal.body;
  assert.deepEqual(values(f.d.getElementById('ctStage')), ['primary', 'junior']);
});

test('legacy question editor never silently converts a high-school question to primary', async t => {
  const f = fixture(t); f.load('public/admin/mfbankui.js'); f.load('public/admin/mfui2.js'); f.load('public/admin/treepick.js');
  const question = { id: 9, type: 'single', subject: '物理', stage: 'senior', grade: '高一', stem: '合成历史题', options: [], nodes: [] };
  f.w.api = async url => url.endsWith('/questions/9') ? { question } : { list: [] };
  f.w.optText = value => value.text || ''; let modal;
  f.w.modal = options => { modal = options; };
  await f.run('mfQEdit(9)'); f.d.getElementById('view').innerHTML = modal.body;
  const select = f.d.getElementById('qeStage');
  assert.equal(select.value, 'senior'); assert.equal(select.selectedOptions[0].disabled, true);
  assert.deepEqual(values(select), ['primary', 'junior']);
});

test('capture JSON cannot relabel an explicitly high-school source as junior', async t => {
  const f = fixture(t); f.load('public/admin/capture-tree-import.js');
  f.w.tpTrees = async () => []; let modal; f.w.modal = options => { modal = options; };
  let calls = 0; f.w.api = async () => { calls++; return { new_tree: true, tree_name: '测试', created: 1, merged: 0 }; };
  await f.run('mfTreeImportDialog()');
  const root = f.d.getElementById('view'); root.innerHTML = modal.body; modal.onMount(root);
  for (const [id, value] of Object.entries({ ctStage: 'junior', ctSubject: '数学', ctKind: 'knowledge' })) {
    const el = f.d.getElementById(id); el.value = value; el.dispatchEvent(new f.w.Event('change'));
  }
  const edition = f.d.getElementById('ctEdition'); edition.value = '__general__'; edition.dispatchEvent(new f.w.Event('change'));
  f.d.getElementById('ctJson').value = JSON.stringify({ stage: 'senior', nodes: [{ name: '合成节点' }] });
  await f.d.getElementById('ctPreview').onclick();
  assert.equal(calls, 0); assert.match(f.d.getElementById('ctStatus').textContent, /仅支持小学和初中/);
});

test('capture JSON validates nested classification before flattening but does not classify names or question text', async t => {
  const f = fixture(t); f.load('public/admin/capture-tree-import.js');
  f.w.tpTrees = async () => []; let modal; f.w.modal = options => { modal = options; };
  const calls = []; f.w.api = async (url, options) => { calls.push({ url, body: JSON.parse(JSON.stringify(options.body)) }); return { new_tree: true, tree_name: '合成树', created: 1, merged: 0 }; };
  await f.run('mfTreeImportDialog()');
  const root = f.d.getElementById('view'); root.innerHTML = modal.body; modal.onMount(root);
  for (const [id, value] of Object.entries({ ctStage: 'junior', ctSubject: '数学', ctKind: 'knowledge' })) {
    const el = f.d.getElementById(id); el.value = value; el.dispatchEvent(new f.w.Event('change'));
  }
  const edition = f.d.getElementById('ctEdition'); edition.value = '__general__'; edition.dispatchEvent(new f.w.Event('change'));
  const json = f.d.getElementById('ctJson');
  const sources = [
    { grade: '十年级', nodes: [{ name: '合成节点' }] },
    { grade: '11年级', nodes: [{ name: '合成节点' }] },
    { stage: ' 高　中 ', nodes: [{ name: '合成节点' }] },
    { nodes: [{ name: '合成节点', meta: { stage: 'senior' } }] },
    { nodes: [{ name: '合成节点', children: [{ name: '合成子节点', grade: '高２' }] }] },
    [{ name: '合成节点', metadata: { grade: '十二年级' } }],
    { nodes: [{ site_node_id: 'n1', name: '合成节点', stage: { label: '高中' } }] },
    { meta: { stage: { code: 'senior' } }, nodes: [{ name: '合成节点' }] },
  ];
  for (const source of sources) {
    json.value = JSON.stringify(source); json.dispatchEvent(new f.w.Event('input'));
    await f.d.getElementById('ctPreview').onclick();
    assert.equal(calls.length, 0, JSON.stringify(source));
    assert.match(f.d.getElementById('ctStatus').textContent, /仅支持小学和初中/);
    assert.equal(f.d.getElementById('ctImport').disabled, true);
  }
  json.value = JSON.stringify({ stage: 'junior', grade: '八年级', name: '初中提高一班', meta: { note: '高中只是说明文字' }, nodes: [{ name: '高中准备说明', stem: '题干可提及高中', children: [{ name: '初中单元' }] }] });
  json.dispatchEvent(new f.w.Event('input')); await f.d.getElementById('ctPreview').onclick();
  assert.equal(calls.length, 1); assert.equal(calls[0].body.dry, true);
  assert.equal(calls[0].body.stage, 'junior'); assert.equal(calls[0].body.nodes[0].name, '高中准备说明');
  assert.equal(f.d.getElementById('ctImport').disabled, false);
  await f.d.getElementById('ctImport').onclick();
  assert.equal(calls.length, 2); assert.equal(calls[1].body.dry, false);
  assert.equal(calls[1].body.stage, 'junior'); assert.match(f.d.getElementById('ctStatus').textContent, /导入完成/);
});

test('intake shared scope removes senior choices and retains a stale draft without recategorizing it', t => {
  const f = fixture(t); f.load('public/admin/intake-flow.js');
  const root = f.d.getElementById('view');
  f.w.R4Flow.save('word-scope', { stage: 'senior', subject: '数学' });
  const raw = f.w.localStorage.getItem('r4-intake-v2:user-1:word-scope');
  const getScope = f.w.R4Flow.scope(root, 'word', root);
  const stage = f.d.getElementById('word-scope-stage');
  assert.deepEqual(values(stage), ['primary', 'junior']);
  assert.equal(stage.value, 'senior'); assert.equal(stage.selectedOptions[0].disabled, true);
  assert.equal(getScope().stage, 'senior', 'unsupported draft must not silently become unrestricted');
  assert.equal(f.w.localStorage.getItem('r4-intake-v2:user-1:word-scope'), raw);
});

test('restored photo preparation preserves a disabled historical school stage instead of becoming unrestricted', t => {
  const f = fixture(t, '<main id="view"><select id="rpStage"><option value="primary">小学</option><option value="junior">初中</option></select></main>');
  f.load('public/admin/intake-flow.js');
  f.w.R4Flow.save('image-prepare', { fields: { rpStage: 'senior' } });
  f.w.R4Flow.prepare(f.d.getElementById('view'), 'image', ['rpStage']);
  const stage = f.d.getElementById('rpStage');
  assert.equal(stage.value, 'senior'); assert.equal(stage.selectedOptions[0].disabled, true);
});

test('manual stale draft remains intact and cannot advance until the stage is reselected', async t => {
  const f = fixture(t); const messages = [];
  f.w.toast = message => messages.push(message); f.w.scrollTo = () => {};
  f.w.QSubtype = { find: () => null, fillSelect: () => {} };
  f.w.t7AudioWidget = () => ({ get: () => '', getLimit: () => 0 });
  f.load('public/admin/intake-flow.js'); f.load('public/admin/intake-manual.js');
  f.w.R4Flow.save('manual-draft', { count: 1, fields: [['#r4m-stage', 'senior'], ['#r4m-grade', '高一']], questions: [{ type: 'single', stem: '原有题干', options: '甲\n乙', answer: 'A' }] });
  const before = f.w.localStorage.getItem('r4-intake-v2:user-1:manual-draft');
  const result = await f.run('viewIntakeManual()'); f.d.getElementById('view').innerHTML = result.html; result.after();
  const stage = f.d.getElementById('r4m-stage');
  assert.equal(stage.value, 'senior'); assert.equal(stage.selectedOptions[0].disabled, true);
  f.d.getElementById('r4m-next').click();
  assert.match(messages.at(-1), /仅支持小学和初中/);
  assert.equal(f.d.querySelector('[data-step="1"]').hidden, false);
  assert.equal(f.w.localStorage.getItem('r4-intake-v2:user-1:manual-draft'), before);
});

test('tree pickers exclude historical high-school trees without changing returned records', async t => {
  const f = fixture(t); f.load('public/admin/treepick.js');
  const list = [
    { id: 1, stage: 'primary' }, { id: 2, stage: 'junior' }, { id: 3, stage: '' },
    { id: 4, stage: 'senior' }, { id: 5, stage: '高中' }, { id: 6, stage: '', grade: '高二' },
  ];
  const before = JSON.stringify(list); f.w.api = async () => ({ list });
  const trees = await f.run('tpTrees()');
  assert.deepEqual(Array.from(trees, tree => tree.id), [1, 2, 3]);
  assert.equal(JSON.stringify(list), before);
});

test('knowledge-tree manager drops a stale senior selection before querying or creating trees', async t => {
  const f = fixture(t); f.load('public/admin/treepick.js'); f.load('public/admin/ktreeui.js');
  Object.assign(f.w.ADM.page, { kt: { kind: 'knowledge', stage: 'senior', subject: '数学', edition: '旧版本', treeId: '9', open: {}, q: '' } });
  const result = await f.run('viewKTree()');
  f.d.getElementById('view').innerHTML = result.html;
  assert.equal(f.w.ADM.page.kt.stage, 'junior');
  assert.deepEqual(values(f.d.getElementById('kt-stage')), ['primary', 'junior']);
  assert.doesNotMatch(result.html, /senior|高中/);
});

test('parent grade reporting removes high school and rejects a high-school grade before local persistence', t => {
  const f = fixture(t, read('public/apps/grades/parent-upload.html'));
  f.d.querySelectorAll('script').forEach(script => { if (!script.src) f.run(script.textContent); });
  assert.deepEqual(values(f.d.getElementById('pStage')), ['小学', '初中']);
  const previous = { campuses: [{ id: 'synthetic-campus' }], parentUploads: [{ id: 'old', stage: '高中', grade: '高一' }] };
  const key = 'campus_grade_db_v1', raw = JSON.stringify(previous); f.w.localStorage.setItem(key, raw);
  for (const [id, value] of Object.entries({ pName: '合成学生', pExam: '单元练习', pSubject: '物理', pFull: '100', pScore: '80', pGrade: '高一', pStage: '初中' })) f.d.getElementById(id).value = value;
  f.d.getElementById('pSubmit').click();
  assert.match(f.d.getElementById('pErr').textContent, /仅支持小学和初中/);
  assert.equal(f.w.localStorage.getItem(key), raw, 'existing records remain untouched');
  f.d.getElementById('pGrade').value = '八年级';
  f.d.getElementById('pSubmit').click();
  assert.equal(f.w.localStorage.getItem(key), raw, 'unowned v1 history remains untouched after supported submission');
  const demoKey = Object.keys(f.w.localStorage).find(k => k === 'campus_grade_parent_demo_v1');
  assert.ok(demoKey, 'parent reporting writes only its separate local demonstration store');
  const saved = JSON.parse(f.w.localStorage.getItem(demoKey));
  assert.equal(saved.parentUploads.length, 1);
  assert.equal(saved.parentUploads[0].stage, '初中'); assert.equal(saved.parentUploads[0].subject, '物理');
  assert.match(f.d.querySelector('#puCard').textContent, /未发送给老师/);
});

test('care class placeholder uses a junior example and does not alter stored class values', t => {
  assert.doesNotMatch(read('public/apps/care/assets/js/students.js'), /placeholder="[^"]*(?:高一|高中)/);
  assert.match(read('public/apps/care/assets/js/students.js'), /value="' \+ esc\(s\.klass\)/);
});

test('injected capture toolbar has no high-school option and does not relabel high-school source trees', async t => {
  const f = fixture(t, '<title>高中数学</title><div class="tk-tree" tree-id="10"><ul><li tree-id="11"><span class="tree-label">函数</span></li></ul></div>');
  // jsdom has no layout-derived innerText; this fixture has plain text only.
  Object.defineProperty(f.w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  f.w.__MFPROXY__ = { page: 'https://zujuan.xkw.com/gzsx/' };
  const calls = []; f.w.fetch = async url => { calls.push(String(url)); return { json: async () => ({ code: 0 }) }; };
  f.load('public/admin/collect-inject.js');
  f.d.dispatchEvent(new f.w.Event('DOMContentLoaded'));
  const stage = f.d.getElementById('mfTStage');
  assert.deepEqual(values(stage), ['primary', 'junior']);
  assert.equal(stage.value, '', 'unsupported source must not default to primary/junior');
  stage.value = 'junior';
  f.d.getElementById('mfTSub').value = '数学'; f.d.getElementById('mfTKind').value = 'knowledge'; f.d.getElementById('mfTEdition').value = '__general__';
  f.d.querySelector('[data-act="tree"]').click(); await new Promise(setImmediate);
  assert.equal(calls.filter(url => url.includes('/tree-push')).length, 0);
  assert.match(f.d.getElementById('mfMsg').textContent, /仅支持小学和初中/);
});
