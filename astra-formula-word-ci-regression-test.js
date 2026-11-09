'use strict';
// Execute the CI scripts' selection/assertion steps against real frontend DOM.
// No service, database, browser process or network. Keyboard/layout checks stay in CI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const latex = String.raw`\frac{1}{2}`;

function segment(file, start, end) {
  const source = read(file), a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${file}: executable test steps must exist`);
  return source.slice(a, b);
}

function fixture(route = '', data = () => { throw Error('Unexpected API request'); }) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: 'http://127.0.0.1:3000/' + route, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, context = dom.getInternalVMContext();
  w.matchMedia = query => ({ matches: !query.includes('max-width'), addEventListener() {}, removeEventListener() {} });
  // Geometry/animation and audio are outside these DOM contracts.
  // Keep real timers: JSDOM uses them to dispatch actual hashchange events.
  w.requestAnimationFrame = () => 0;
  w.scrollTo = () => {};
  w.Audio = class { constructor() { throw Error('Audio is forbidden in this offline fixture'); } };
  w.fetch = async url => {
    const parsed = new URL(url, w.location.href);
    assert.equal(parsed.origin, w.location.origin, 'no external requests');
    return { ok: true, status: 200, json: async () => ({ code: 0, data: data(parsed) }) };
  };
  w.localStorage.setItem('xuexi_token', 'synthetic-offline-session');
  w.localStorage.setItem('xuexi_user', JSON.stringify({ id: 71, role: 'student', name: 'QA', grade: '四年级' }));
  const run = code => vm.runInContext(code, context);
  const load = file => run(read(file));
  load('public/js/api.js');
  const evaluate = (fn, arg) => run('(' + fn.toString() + ')')(arg);
  const poll = async predicate => {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
    throw Error(`Condition not reached; actual route ${w.location.hash}, page ${w.__stuVm && w.__stuVm.page}; ${w.document.body.textContent.slice(-400)}`);
  };
  const locator = (selector, index) => {
    const all = () => [...w.document.querySelectorAll(selector)];
    const one = () => { const nodes = all(); if (index === undefined) assert.equal(nodes.length, 1, selector); assert.ok(nodes[index || 0], selector); return nodes[index || 0]; };
    return {
      first: () => locator(selector, 0), nth: i => locator(selector, i),
      count: async () => all().length,
      waitFor: () => poll(() => !!all()[index || 0]),
      click: async () => { await poll(() => !!all()[index || 0]); one().click(); await tick(); },
      inputValue: async () => { await poll(() => !!all()[index || 0]); return one().value; },
      innerText: async () => { await poll(() => !!all()[index || 0]); return one().textContent; },
      selectOption: async value => { await poll(() => !!all()[index || 0]); const el = one(); el.value = value; assert.equal(el.value, value); el.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(); },
    };
  };
  const page = {
    evaluate, locator,
    inputValue: selector => locator(selector).inputValue(),
    click: selector => locator(selector).click(),
    waitForSelector: selector => locator(selector).waitFor(),
    waitForFunction: (fn, arg) => poll(() => evaluate(fn, arg)),
  };
  return { dom, w, run, load, page, poll };
}

const formulaSteps = segment('formula-test.js', '      const val = await sp.', '      const ap = await browser.newPage');
async function checkFormula({ aiText = '', value = latex, keyboard = true, store = true } = {}) {
  const f = fixture();
  try {
    f.load('public/js/bank.js');
    f.load('public/js/mlive.js');
    f.run(`BankQuiz.open({ questions: [
      { id: 1, type: 'fill', subject: '数学', stem: 'QA fraction' },
      { id: 2, type: 'answer', subject: '物理', stem: 'QA next' }
    ] });`);
    const answer = f.w.document.querySelector('#qzBody textarea[data-blank="0"]');
    const ai = f.w.document.querySelector('.r8-ai-in textarea');
    assert.ok(ai && answer, 'real quiz must render both answer and separate AI input');
    ai.value = aiText;
    if (store) f.w.MLive.insertAt(answer, value); else answer.value = value;
    const results = [];
    await vm.runInNewContext('(async () => {' + formulaSteps + '})()', {
      sp: f.page, kb: keyboard, log: (ok, name, detail) => results.push({ ok, name, detail }),
    });
    return results;
  } finally { f.dom.window.close(); }
}

test('formula CI reads only the answer, with empty or populated AI inputs', async () => {
  for (const aiText of ['', 'independent AI draft']) {
    const results = await checkFormula({ aiText });
    assert.ok(results.length > 0);
    for (const result of results) assert.equal(result.ok, true, `${result.name}: ${result.detail}`);
  }
});

test('formula CI still rejects corrupt values and a missing virtual keyboard', async () => {
  for (const input of [{ value: latex + '|' }, { value: '' }, { keyboard: false }]) {
    assert.ok((await checkFormula(input)).some(result => !result.ok), JSON.stringify(input));
  }
});

test('formula CI checks that insertion survives a question change, not only a DOM value', async () => {
  assert.ok((await checkFormula({ store: false })).some(result => !result.ok), 'a value without an input event must not pass');
});

const wordSteps = segment('browser-audit-test.js', "  await test('UI03-words-selection'", '    for (const width').split('async (open) => {')[1];
test('word CI enters its course route and selects its own book/unit/group despite a different default book', async () => {
  const bookId = 902, otherId = 901;
  const words = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, book_id: bookId, unit: 'Unit 1', word: i ? 'hello' + i : 'characteristically', meaning: '合成释义', example: 'A synthetic example.' }));
  let f;
  try {
    const open = async (who, route = '') => {
      assert.equal(who, 'student');
      f = fixture(route, url => {
        if (url.pathname === '/api/me') return { id: 71, role: 'student', name: 'QA', grade: '四年级' };
        if (url.pathname === '/api/stu/courses' || url.pathname === '/api/stu/bank/tasks') return [];
        if (url.pathname === '/api/stu/bank/mistake-count') return { pending: 0 };
        if (url.pathname === '/api/stu/word/books') return [
          { id: otherId, title: 'Other seed book', kind: 'word', grade: '四年级', word_count: 1 },
          { id: bookId, title: 'QA audit words', kind: 'word', grade: '四年级', word_count: 10 },
        ];
        if (url.pathname === '/api/stu/word/words') return url.searchParams.get('book_id') === String(bookId) ? words : [{ id: 1, book_id: otherId, unit: 'Other unit', word: 'unrelated', meaning: '其它' }];
        if (url.pathname === '/api/stu/word/sentences' || url.pathname === '/api/stu/word/pos') return [];
        if (url.pathname === '/api/stu/word/stats') return {};
        throw Error('Unexpected fixture API ' + url);
      });
      f.load('public/vendor/vue.global.prod.js');
      f.load('public/js/words.js');
      f.load('public/js/vue-app.js');
      return f.page;
    };
    await vm.runInNewContext('(async () => {' + wordSteps + '})()', { open, assert, bookId });
    assert.equal(f.run('WT.bookId'), String(bookId));
    assert.equal(f.run('WT.unit'), 'Unit 1');
    assert.equal(f.run('WT.groupIdx'), 0);
    assert.equal(f.run('WT.needPick'), false);
    assert.equal(f.run('WT.quick.words.length'), 5);
    assert.equal(f.run('WT.quick.words.some(w => w.word === "characteristically")'), true);
    assert.equal(f.w.document.querySelectorAll('#wqNext').length, 1);
  } finally { if (f) f.dom.window.close(); }
});
