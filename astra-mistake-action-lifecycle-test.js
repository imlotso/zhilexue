'use strict';
// Execute actual mistake action handlers and api with synthetic DOM/network only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const source = read('public/js/bank.js');
const start = source.indexOf('    /** 把一组错题串成一次重做弹层（答对移出，答错回炉） */');
const end = source.indexOf('    // 顶部学科 tab', start);
assert.ok(start > 0 && end > start);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  const messages = [], opened = [], appended = [], requests = [], queue = [];
  const button = { dataset: { similar: '12' }, disabled: false };
  const makeNode = () => ({ className: '', innerHTML: '', querySelector: () => ({ innerHTML: '', onclick: null }), addEventListener() {}, remove() {} });
  const c = { pageCurrent: true, paintVersion: 1, subject: '数学',
    isCurrent: () => c.pageCurrent, toast: (message, kind) => messages.push({ message, kind }),
    BankQuiz: { open: options => opened.push(options) }, BankPages: { mistakes() {} }, host: {},
    document: { createElement: makeNode, body: { appendChild: m => appended.push(m) } },
    location: { origin: 'https://test.invalid', hash: '#/mistakes' },
    localStorage: { getItem: () => '', removeItem() {} }, sessionStorage: {},
    bindImageZoom() {}, bindQuizAudio() {}, quizMistakes() {}, paint() {}, esc: s => String(s),
    fetch: async (url, options) => {
      requests.push({ url, options }); const result = queue.length ? await queue.shift().promise : { list: [{ id: 3 }], token: 'synthetic', point: '测试点' };
      return result && result.response ? result.response : { ok: true, status: 200, json: async () => ({ code: 0, data: result }) };
    },
  };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('public/js/api.js').split('\nfunction toast(')[0], c);
  vm.runInContext(source.slice(start, end) + '\nwindow.actions = {showQR,startReview,bindMistCards,quizMistakes};', c);
  const root = { querySelectorAll: selector => selector === '[data-similar]' ? [button] : [] };
  c.actions.bindMistCards(root, []);
  return { c, messages, opened, appended, requests, queue, button,
    run(kind) { return kind === 'similar' ? button.onclick() : c.actions[kind === 'qr' ? 'showQR' : 'startReview'](); },
    count(kind) { return kind === 'qr' ? appended.length : opened.length; },
  };
}
const result = { list: [{ id: 3 }], token: 'synthetic', point: '测试点' };
for (const kind of ['qr', 'review', 'similar']) {
  test(kind + ': current success opens its requested action', async () => {
    const f = fixture(); await f.run(kind); assert.equal(f.count(kind), 1);
  });
  for (const change of ['page', 'subpage', 'route']) {
    test(kind + ': late success after ' + change + ' change cannot open a popup', async () => {
      const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.run(kind);
      if (change === 'page') f.c.pageCurrent = false; else if (change === 'route') f.c.location.hash = '#/papers'; else f.c.paintVersion++;
      late.resolve(result); await pending; assert.equal(f.count(kind), 0);
    });
    test(kind + ': late failure after ' + change + ' change stays silent', async () => {
      const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.run(kind);
      if (change === 'page') f.c.pageCurrent = false; else if (change === 'route') f.c.location.hash = '#/papers'; else f.c.paintVersion++;
      late.reject(new Error('synthetic')); await pending; assert.equal(f.messages.length, 0);
    });
  }
  test(kind + ': current network error is reported exactly once and permits retry', async () => {
    const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.run(kind);
    late.reject(new Error('synthetic')); await pending; assert.equal(f.messages.length, 1);
    assert.match(f.messages[0].message, /网络/); await f.run(kind); assert.equal(f.count(kind), 1);
  });
}
for (const kind of ['qr', 'review']) {
  test(kind + ': repeated requests show only the newest result', async () => {
    const f = fixture(), old = deferred(), next = deferred(); f.queue.push(old, next);
    const p1 = f.run(kind), p2 = f.run(kind); next.resolve(result); await p2;
    old.resolve(result); await p1; assert.equal(f.count(kind), 1);
  });
}
test('a newer different action supersedes an older pending action', async () => {
  const f = fixture(), old = deferred(); f.queue.push(old); const pending = f.run('review');
  await f.run('qr'); old.resolve(result); await pending;
  assert.equal(f.appended.length, 1); assert.equal(f.opened.length, 0);
});
test('similar action ignores repeated clicks while request is pending', async () => {
  const f = fixture(), late = deferred(); f.queue.push(late); const pending = f.run('similar');
  await f.run('similar'); late.resolve(result); await pending;
  assert.equal(f.requests.length, 1); assert.equal(f.opened.length, 1); assert.equal(f.button.disabled, false);
});
test('current empty review queue and similar list show helpful feedback', async () => {
  for (const kind of ['review', 'similar']) { const f = fixture(), d = deferred(); f.queue.push(d); const pending = f.run(kind); d.resolve({ list: [] }); await pending; assert.equal(f.count(kind), 0); assert.equal(f.messages.length, 1); }
});


test('starting an immediate redo supersedes a pending review', async () => {
  const f = fixture(), old = deferred(); f.queue.push(old); const pending = f.run('review');
  f.c.actions.quizMistakes([{ question_id: 7, type: 'single' }], '当前重做', '');
  old.resolve(result); await pending;
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0].title, '当前重做');
});
for (const kind of ['qr', 'review', 'similar']) {
  test(kind + ': authentication expiry still redirects without stale error', async () => {
    const f = fixture(), d = deferred(); f.queue.push(d); const pending = f.run(kind);
    d.resolve({ response: { ok: false, status: 401, json: async () => ({ code: 401, msg: 'expired' }) } });
    await pending; assert.equal(f.c.location.hash, '#/login'); assert.equal(f.count(kind), 0); assert.equal(f.messages.length, 0);
  });
}


for (const kind of ['review', 'qr', 'similar']) {
  test('opening Word export supersedes pending ' + kind, async () => {
    const f = fixture(), old = deferred(); f.queue.push(old); const pending = f.run(kind);
    f.c.daysAgo = () => '2026-01-01'; f.c.data = { list: [] };
    f.c.document.createElement = () => ({ querySelector: () => ({ value: 'unresolved' }), querySelectorAll: () => [], addEventListener() {}, remove() {} });
    const a = source.indexOf('    const exportWord = () => {'), b = source.indexOf('    const paintSubject =', a);
    assert.ok(a > 0 && b > a);
    vm.runInContext(source.slice(a, b) + '\nwindow.openExport = exportWord;', f.c);
    f.c.openExport(); assert.equal(f.appended.length, 1);
    old.resolve(result); await pending;
    assert.equal(f.opened.length, 0); assert.equal(f.appended.length, 1);
  });
}
