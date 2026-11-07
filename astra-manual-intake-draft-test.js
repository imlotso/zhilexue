'use strict';
// Execute the production save handler, draft listener, R4Flow persistence/post,
// and api() with synthetic form/fetch/storage boundaries. Not browser QA.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const manual = read('public/admin/intake-manual.js');
function extract(start, end) {
  const a = manual.indexOf(start), b = manual.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Production handler boundary missing: ' + start);
  return manual.slice(a, b);
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let now = 1000, failStorage = false;
  const storage = new Map([['xuexi_user', JSON.stringify({ id: 1 })]]), listeners = {}, messages = [], selected = [], requests = [], queue = [];
  const next = { disabled: false, textContent: '保存到待审核' };
  const fields = { subject: '数学', stage: 'junior', grade: '七年级', material: '' };
  const questionFields = { type: 'single', subtype: '', stem: '原始题干', options: '选项一\n选项二', match: '', answer: '', analysis: '' };
  const question = { querySelector: selector => { const key = /^\[data-question-(.+)\]$/.exec(selector)?.[1]; assert.ok(key in questionFields, selector); return { value: questionFields[key] }; } };
  const root = { isConnected: true, addEventListener: (name, callback) => { listeners[name] = callback; } };
  const context = {
    Date: { now: () => ++now }, Math, Map, Set, URL, root, step: 3, busy: false, draftRevision: 0,
    box: { children: [question], addEventListener() {} }, questionImages: new Map([[question, []]]),
    $: selector => { assert.equal(selector, '#r4m-next'); return next; },
    audio: { get: () => '', getLimit: () => 0 }, mode: () => 'single', validate: () => '',
    val: selector => fields[selector.replace('#r4m-', '')], scope: () => ({ subject: fields.subject, stage: fields.stage, edition: '', term: '', material_type: '' }),
    dataQuestions: () => [{ type: 'single', question_subtype: '', stem: questionFields.stem, options: ['选项一', '选项二'], match_prompts: [], answer: '', analysis: '', images: [] }],
    pdSelectBatch: (...args) => selected.push(args), toast: (message, kind) => messages.push({ message, kind }),
    location: { hash: '#/intake-manual' }, show: () => { next.textContent = context.step === 3 ? '保存到待审核' : '下一步'; },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (failStorage) throw new Error('synthetic quota'); storage.set(key, String(value)); }, removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: () => null, removeItem() {} },
    fetch: async (url, options) => { requests.push({ url, options }); const data = queue.length ? await queue.shift().promise : { run_id: 77 }; return data && data.__response ? data.__response : { ok: true, status: 200, json: async () => ({ code: 0, data }) }; },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('public/js/api.js').split('\nfunction toast(')[0], context, { filename: 'public/js/api.js' });
  vm.runInContext(read('public/admin/intake-flow.js'), context, { filename: 'public/admin/intake-flow.js' });
  // Notice rendering is unrelated to saving. The storage/post implementation is real.
  context.R4Flow.bind = () => {};
  vm.runInContext(extract('    const pageHash = location.hash', '\n    R4Flow.bind('), context, { filename: 'public/admin/intake-manual.js:owner' });
  vm.runInContext(extract("    const draft = R4Flow.read('manual-draft');", '\n    const $ ='), context, { filename: 'public/admin/intake-manual.js:restore' });
  vm.runInContext(extract("    $('#r4m-next').onclick = async () => {", '\n    addQuestion();'), context, { filename: 'public/admin/intake-manual.js:save' });
  vm.runInContext(extract('    const saveDraft = () => {', '\n    numberRows(); show();'), context, { filename: 'public/admin/intake-manual.js:draft' });
  listeners.input();
  return { context, root, next, messages, selected, requests, queue,
    draft: () => JSON.parse(JSON.stringify(context.R4Flow.read('manual-draft'))),
    edit(stem) { questionFields.stem = stem; listeners.input(); },
    replaceDraft(stem) { const draft = this.draft(); draft.questions[0].stem = stem; context.R4Flow.save('manual-draft', draft); },
    failStorage() { failStorage = true; },
    memoryDraft() {
      const getItem = context.localStorage.getItem;
      context.localStorage.getItem = key => { if (key.endsWith(':manual-draft')) throw new Error('synthetic storage unavailable'); return getItem(key); };
      try { return this.draft(); } finally { context.localStorage.getItem = getItem; }
    },
  };
}

test('an old manual save cannot delete a new draft after leaving and reopening', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.root.isConnected = false; f.replaceDraft('重新打开后录入的新题'); const latest = f.draft();
  late.resolve({ run_id: 77 }); await pending;
  assert.deepEqual(f.draft(), latest);
  assert.equal(f.context.location.hash, '#/intake-manual');
});

test('same-page changes made while saving stay editable and persisted', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.context.step = 2; f.edit('保存期间修订的新题干'); const latest = f.draft();
  late.resolve({ run_id: 77 }); await pending;
  assert.deepEqual(f.draft(), latest);
  assert.equal(f.context.location.hash, '#/intake-manual');
  assert.equal(f.next.disabled, false); assert.equal(f.context.busy, false);
  assert.equal(f.next.textContent, '下一步');
  assert.deepEqual(f.selected, []);
  assert.match(f.messages.at(-1).message, /保留/);
});

test('a newer draft from another tab survives this tab finishing its old save', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.replaceDraft('另一标签页的新题'); const latest = f.draft(); late.resolve({ run_id: 77 }); await pending;
  assert.deepEqual(f.draft(), latest);
});

test('another tab draft written before this save is not mistaken for the submitted form', async () => {
  const f = fixture(); f.replaceDraft('请求发起前另一标签已保存的新题'); const latest = f.draft();
  await f.next.onclick();
  assert.equal(JSON.parse(f.requests[0].options.body).stem, '原始题干');
  assert.deepEqual(f.draft(), latest);
});

test('a draft write failure before submitting cannot make an unrelated stored draft owned', async () => {
  const f = fixture(); f.replaceDraft('共享存储中的其他新题'); const latest = f.draft();
  f.failStorage(); f.edit('当前页面写盘失败的题目');
  await f.next.onclick();
  assert.deepEqual(f.draft(), latest);
  assert.equal(f.memoryDraft().questions[0].stem, '当前页面写盘失败的题目');
});

test('an unchanged current draft clears only after successful save and opens its batch', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  assert.notEqual(f.draft(), null); assert.equal(f.next.disabled, true);
  late.resolve({ run_id: 77 }); await pending;
  assert.equal(f.draft(), null); assert.equal(f.context.location.hash, '#/pending');
  assert.deepEqual(f.selected, [['manual', 77]]);
  assert.equal(JSON.parse(f.requests[0].options.body).stem, '原始题干');
});

test('a failed current save keeps the draft and permits retry', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const before = f.draft(), pending = f.next.onclick();
  late.reject(new Error('synthetic failure')); await pending;
  assert.deepEqual(f.draft(), before); assert.equal(f.next.disabled, false); assert.equal(f.context.busy, false);
  await f.next.onclick(); assert.equal(f.context.location.hash, '#/pending');
});

test('unchanged submitted data does not clear drafts after the hash has already changed', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick(), before = f.draft();
  f.context.location.hash = '#/intake'; late.resolve({ run_id: 77 }); await pending;
  assert.deepEqual(f.draft(), before); assert.equal(f.context.location.hash, '#/intake');
});

test('same-page edits survive even when newer draft persistence hits storage quota', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.failStorage(); f.context.step = 2; f.edit('存储失败时仍保留的当前输入');
  late.resolve({ run_id: 77 }); await pending;
  assert.equal(f.context.location.hash, '#/intake-manual');
  assert.equal(f.next.disabled, false);
  assert.equal(f.memoryDraft().questions[0].stem, '存储失败时仍保留的当前输入');
});

test('current manual save failure shows one error rather than API and page duplicates', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  late.reject(new Error('synthetic failure')); await pending;
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].message, /网络/);
});

test('failed save after leaving produces no stale message or detached button changes', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.root.isConnected = false; const label = f.next.textContent;
  late.reject(new Error('synthetic failure')); await pending;
  assert.deepEqual(f.messages, []);
  assert.equal(f.next.textContent, label);
  assert.equal(f.next.disabled, true);
});

test('failed save after route changes is silent and preserves the draft', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const before = f.draft(), pending = f.next.onclick();
  f.context.location.hash = '#/intake';
  late.reject(new Error('synthetic failure')); await pending;
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.draft(), before);
  assert.equal(f.context.location.hash, '#/intake');
});

test('failed save after returning to editing restores the current step button', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  f.context.step = 2; f.edit('继续修改的题干');
  late.reject(new Error('synthetic failure')); await pending;
  assert.equal(f.next.textContent, '下一步');
  assert.equal(f.next.disabled, false);
  assert.equal(f.context.busy, false);
  assert.equal(f.draft().questions[0].stem, '继续修改的题干');
});


test('server rejection is shown once and retains uncertain receipt for recovery', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  late.resolve({ __response: { ok: true, status: 200, json: async () => ({ code: 422, msg: '题干无效' }) } });
  await pending;
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].message, '题干无效');
  assert.equal(f.context.R4Flow.read('manual').phase, 'uncertain');
  assert.ok(f.context.R4Flow.read('manual').request_key);
  assert.ok(f.draft()); assert.equal(f.next.disabled, false);
});

test('silent manual transport still redirects expired authentication to login', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.next.onclick();
  late.resolve({ __response: { ok: false, status: 401, json: async () => ({ code: 401, msg: '登录已过期' }) } });
  await pending;
  assert.equal(f.context.location.hash, '#/login');
  assert.equal(f.context.localStorage.getItem('xuexi_user'), null);
  assert.deepEqual(f.messages, []);
});

test('other R4Flow callers retain automatic error messages and explicit request keys', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late);
  const pending = f.context.R4Flow.post('/synthetic/capture', 'capture', { title: '测试' }, 'existing-key');
  late.reject(new Error('synthetic failure'));
  await assert.rejects(pending, /网络/);
  assert.equal(f.messages.length, 1);
  assert.equal(f.requests[0].options.headers['X-Intake-Key'], 'existing-key');
  assert.equal(f.context.R4Flow.read('capture').phase, 'uncertain');
});
