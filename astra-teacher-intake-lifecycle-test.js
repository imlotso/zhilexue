'use strict';
// Run the complete teacher page and production api() in a VM. Only DOM,
// QR drawing, R4Flow setup, clipboard, time and fetch are synthetic boundaries.
// No browser, login, HTTP service, real data or token signing is involved.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const source = read('public/admin/intake-teacher.js');
const apiSource = read('public/js/api.js').split('\nfunction toast(')[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element(root, attributes = '') {
  const classes = new Set(), attrs = new Map();
  return {
    get isConnected() { return root.isConnected; },
    value: '', textContent: '', innerHTML: '', disabled: /\bdisabled\b/.test(attributes),
    hidden: /\bhidden\b/.test(attributes), dataset: {},
    classList: { toggle(name, force) { const next = force === undefined ? !classes.has(name) : force; if (next) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key),
  };
}
function rootFromHTML(html) {
  const nodes = new Map(), steps = [], root = { isConnected: true };
  for (const match of html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)) nodes.set(match[2], element(root, match[1]));
  for (const match of html.matchAll(/data-rt-step="(\d+)"/g)) { const step = element(root); step.dataset.rtStep = match[1]; steps.push(step); }
  root.querySelector = selector => nodes.get(selector.replace(/^#/, '')) || null;
  root.querySelectorAll = selector => selector === '[data-rt-step]' ? steps : [];
  root.click = id => { const node = nodes.get(id); assert.ok(node, 'Missing production button: ' + id); if (!node.disabled) return node.onclick(); };
  return root;
}
function fixture() {
  let current = null, time = 0, timerId = 0;
  const requests = [], errors = [], copies = [], openings = [], queues = { runs: [], token: [], clipboard: [] }, timers = new Map();
  const location = { hash: '#/intake-teacher', origin: 'https://fixture.invalid', hostname: 'fixture.invalid' };
  const context = {
    URL, location, Date: { now: () => time },
    document: {
      querySelector: selector => selector === '.rt-page' ? current : null,
      getElementById: id => current && current.querySelector('#' + id),
    },
    localStorage: { getItem: () => null, removeItem() {} },
    esc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    toast: (message, kind) => errors.push({ message, kind }),
    pdSelectBatch() {},
    R4Flow: { bind() {}, prepare() {}, scope: root => () => ({ subject: root.querySelector('#rtSubject').value, stage: 'junior' }) },
    setInterval: callback => { timers.set(++timerId, callback); return timerId; },
    clearInterval: id => timers.delete(id),
    navigator: { clipboard: { writeText: async text => { copies.push(text); if (queues.clipboard.length) return queues.clipboard.shift().promise; } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const key = url === '/api/admin/bank/mf/intake/runs' ? 'runs' : url === '/api/admin/bank/teacher-upload-token' ? 'token' : null;
      assert.ok(key, 'Unexpected fetch: ' + url);
      if (key === 'token') assert.equal(options.method, 'POST');
      const data = queues[key].length ? await queues[key].shift().promise : key === 'runs' ? { list: [] } : { token: 'synthetic-token', url: '/upload.html', expires_in: 1800 };
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
    },
  };
  context.window = { open: (...args) => openings.push(args) };
  context.QRCode = function (node, options) { node.qrText = options.text; node.innerHTML = '<canvas>synthetic QR</canvas>'; };
  context.QRCode.CorrectLevel = { M: 'M' }; context.window.QRCode = context.QRCode;
  vm.createContext(context); vm.runInContext(apiSource, context, { filename: 'public/js/api.js' });
  vm.runInContext(source, context, { filename: 'public/admin/intake-teacher.js' });
  return {
    queues, requests, errors, copies, openings, timers, location,
    get root() { return current; },
    async mount() {
      if (current) current.isConnected = false; current = null;
      location.hash = '#/intake-teacher'; const out = await context.viewIntakeTeacher();
      current = rootFromHTML(out.html); out.after(); return current;
    },
    leave() { if (current) current.isConnected = false; current = null; location.hash = '#/intake'; },
    advance(milliseconds) { time += milliseconds; for (const callback of [...timers.values()]) callback(); },
  };
}
const token = label => ({ token: 'synthetic-' + label, url: '/upload.html', expires_in: 1800 });
const run = subject => ({ list: [{ id: 17, source_kind: 'teacher_scan', subject, grade: '七年级', status: 'recognized', drafts: '[{"committed":false}]', draft_count: 1, created_at: '2026-11-07 01:00:00', processing: false }] });

test('a token response from a departed teacher page cannot overwrite its replacement', async () => {
  const f = fixture(), old = await f.mount(), late = deferred(); f.queues.token.push(late);
  const pending = old.click('rtCreate');
  const fresh = await f.mount();
  late.resolve(token('old')); await pending;
  assert.equal(fresh.querySelector('#rtScan').hidden, true, 'new page must stay on preparation');
  assert.equal(fresh.querySelector('#rtCode').innerHTML, '', 'old QR must not be painted in new page');
  assert.equal(f.timers.size, 0, 'departed generation must not start a timer');
});

test('a pending renewal cannot undo the teacher returning to the preparation step', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const late = deferred(); f.queues.token.push(late); const pending = root.click('rtRenew');
  root.click('rtChange');
  late.resolve(token('renewal')); await pending;
  assert.equal(root.querySelector('#rtPrepare').hidden, false);
  assert.equal(root.querySelector('#rtScan').hidden, true);
  assert.equal(root.querySelector('#rtCreate').disabled, false);
});

test('changing step permits a fresh generation while an obsolete renewal is pending', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const old = deferred(), fresh = deferred(); f.queues.token.push(old, fresh);
  const oldPending = root.click('rtRenew'); root.click('rtChange');
  root.querySelector('#rtSubject').value = '英语'; const newPending = root.click('rtCreate');
  assert.equal(f.requests.filter(r => r.url.endsWith('teacher-upload-token')).length, 3, 'new intent must not be blocked by obsolete busy state');
  fresh.resolve(token('new')); await newPending; old.resolve(token('old')); await oldPending;
  await root.click('rtCopy');
  assert.match(f.copies[0], /synthetic-new/);
});

test('returning to preparation before renewal failure does not flash an obsolete error', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const late = deferred(); f.queues.token.push(late); const pending = root.click('rtRenew'); root.click('rtChange');
  late.reject(new Error('synthetic network failure')); await pending;
  assert.equal(root.querySelector('#rtScanError').hidden, true);
  assert.deepEqual(f.errors, []);
});

test('a newer history response wins over a slower earlier refresh', async () => {
  const f = fixture(), root = await f.mount(), old = deferred(), fresh = deferred();
  await root.click('rtCreate');
  f.queues.runs.push(old, fresh); root.click('rtRefresh'); root.click('rtSubmitted');
  fresh.resolve(run('新批次')); await flush(); old.resolve(run('旧批次')); await flush();
  assert.match(root.querySelector('#rtHistory').innerHTML, /新批次/);
  assert.doesNotMatch(root.querySelector('#rtHistory').innerHTML, /旧批次/);
});

test('a stale history failure cannot replace current records with an error', async () => {
  const f = fixture(), root = await f.mount(), old = deferred(), fresh = deferred();
  await root.click('rtCreate');
  f.queues.runs.push(old, fresh); root.click('rtRefresh'); root.click('rtSubmitted');
  fresh.resolve(run('最新批次')); await flush(); old.reject(new Error('old failure')); await flush();
  assert.match(root.querySelector('#rtHistory').innerHTML, /最新批次/);
  assert.deepEqual(f.errors, []);
});

test('an earlier refresh completion must not release the newer refresh busy state', async () => {
  const f = fixture(), root = await f.mount(), old = deferred(), fresh = deferred();
  await root.click('rtCreate');
  f.queues.runs.push(old, fresh); root.click('rtRefresh'); root.click('rtSubmitted');
  old.resolve(run('旧批次')); await flush();
  assert.equal(root.querySelector('#rtRefresh').disabled, true);
  fresh.resolve(run('新批次')); await flush(); assert.equal(root.querySelector('#rtRefresh').disabled, false);
});

test('a copied link failure after leaving never writes to a replacement page', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const late = deferred(); f.queues.clipboard.push(late); const pending = root.click('rtCopy');
  const fresh = await f.mount(); late.reject(new Error('clipboard rejected')); await pending;
  assert.equal(fresh.querySelector('#rtScanError').hidden, true);
});

test('a copied link failure after leaving the teacher route is handled silently', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const late = deferred(); f.queues.clipboard.push(late); const pending = root.click('rtCopy');
  f.leave(); late.reject(new Error('clipboard rejected')); await assert.doesNotReject(pending);
  assert.deepEqual(f.errors, []);
});

test('a copy completion on a departed page does not toast over another task', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  const late = deferred(); f.queues.clipboard.push(late); const pending = root.click('rtCopy');
  f.leave(); late.resolve(); await pending; assert.deepEqual(f.errors, []);
});

test('current generation, copy and open retain the signed request subject', async () => {
  const f = fixture(), root = await f.mount(), late = deferred(); f.queues.token.push(late);
  root.querySelector('#rtSubject').value = '数学'; const pending = root.click('rtCreate');
  root.querySelector('#rtSubject').value = '英语'; late.resolve(token('math')); await pending;
  await root.click('rtCopy'); root.click('rtOpen');
  assert.equal(JSON.parse(f.requests.find(r => r.url.endsWith('teacher-upload-token')).options.body).subject, '数学');
  assert.equal(new URL(f.copies[0]).searchParams.get('subject'), '数学');
  assert.equal(f.openings[0][0], f.copies[0]);
  assert.equal(root.querySelector('#rtScan').hidden, false);
});

test('double generation only submits once, and a current failure can be retried', async () => {
  const f = fixture(), root = await f.mount(), late = deferred(); f.queues.token.push(late);
  const pending = root.click('rtCreate'); root.click('rtCreate');
  assert.equal(f.requests.filter(r => r.url.endsWith('teacher-upload-token')).length, 1);
  late.reject(new Error('current failure')); await pending;
  assert.equal(root.querySelector('#rtCreateError').hidden, false);
  assert.equal(root.querySelector('#rtCreate').disabled, false);
  assert.deepEqual(f.errors, [], 'production api must not duplicate the page-owned error');
  await root.click('rtCreate'); assert.equal(root.querySelector('#rtScan').hidden, false);
});

test('expired links disable copy/open and timers stop after departure', async () => {
  const f = fixture(), root = await f.mount(); await root.click('rtCreate');
  f.advance(1800001);
  assert.equal(root.querySelector('#rtCopy').disabled, true);
  assert.equal(root.querySelector('#rtOpen').disabled, true);
  assert.equal(f.timers.size, 0);
  await root.click('rtRenew'); f.leave(); f.advance(1000); assert.equal(f.timers.size, 0);
});

test('a current history failure stays visible and can be refreshed successfully', async () => {
  const f = fixture(), root = await f.mount(), failed = deferred(); f.queues.runs.push(failed);
  const pending = root.click('rtRefresh'); failed.reject(new Error('current failure')); await pending;
  assert.match(root.querySelector('#rtHistory').innerHTML, /网络连接失败/);
  assert.equal(root.querySelector('#rtRefresh').disabled, false);
  f.queues.runs.push({ promise: Promise.resolve(run('恢复后的批次')) }); await root.click('rtRefresh');
  assert.match(root.querySelector('#rtHistory').innerHTML, /恢复后的批次/);
});
