'use strict';
// Pure Node render/CSS contract checks. These are NOT browser geometry tests.
// No app, auth, service, database, audio, browser or network is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'public/js/words.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'public/css/app.css'), 'utf8');
let pass = 0, fail = 0;
function test(name, run) {
  try { run(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'real render function must be available');
  return source.slice(start, end + 2);
}
function readFixture(words, stage = false) {
  const root = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) };
  const bar = { getBoundingClientRect: () => ({ bottom: 74 }), querySelector: () => ({ textContent: '' }), parentNode: null };
  const listeners = {};
  const elements = {};
  const box = { html: '', closest: () => root, getBoundingClientRect: () => ({ top: 520 - root.scrollTop }), set innerHTML(html) {
    this.html = html;
    for (const key of Object.keys(elements)) if (key !== 'wtQuickBox') delete elements[key];
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = { onclick: null };
  }, get innerHTML() { return this.html; } };
  elements.wtQuickBox = box;
  const state = { quick: { step: 'read', read: { i: 0, spoke: null }, words } };
  const c = vm.createContext({ WT: state, WT_STEPS: [{ t: '单词学习' }],
    document: { body: { classList: { add() {}, remove() {}, contains: name => stage && name === 'wt-stage' }, appendChild() {} }, querySelectorAll: () => [], getElementById: id => elements[id] || null }, WT_STAGE_BAR: bar,
    window: { addEventListener: (name,fn) => listeners[name]=fn, removeEventListener: (name,fn) => { if(listeners[name]===fn)delete listeners[name]; } },
    wtFsGet: () => 'big', WT_DRILL_REVIEW: false,
    wtProg: (i, n) => `<div class="wt-prog">${i}/${n}</div>`, wtIc: () => '',
    wtNoun: () => '单词', esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    speak() { throw Error('audio must not run'); }, wtLater() {},
    wtDoneHTML: () => '<div class="empty">完成</div>', wtBindDone() {},
  });
  for (const name of ['wtQuickReveal','wtQuickRevealCurrent']) if(source.includes('function '+name+'(')) vm.runInContext(functionSource(name),c);
  vm.runInContext(functionSource('wtStageOn')+'\n'+functionSource('wtStageOff'), c);
  vm.runInContext(functionSource('wtQuickRead'), c);
  return { render: () => c.wtQuickRead(), state, box, elements, root, context: c, listeners };
}
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'));
  assert.ok(match, 'dedicated stage-only CSS rule must exist');
  return match[1];
}
const samples = [
  { id: 1, word: 'a', meaning: '一个' },
  { id: 2, word: 'characteristically', phonetic: '/test/', meaning: '用于布局回归的较长合成释义' },
];
test('read rendering marks only its existing action row for the dedicated footer', () => {
  const f = readFixture(samples); f.render();
  assert.ok(/class="wt-acts t13-read-actions"/.test(f.box.html), 'read action row lacks dedicated scope');
  assert.ok(/class="t13-read-controls"/.test(f.box.html), 'read footer lacks its own positioning container');
  assert.equal((f.box.html.match(/id="wqNext"/g) || []).length, 1, 'there must be one primary action');
  assert.ok(/class="wt-card center t13-card"/.test(f.box.html), 'fixed card contract must remain');
});
test('rendered next action advances exactly one word and is removed on completion', () => {
  const f = readFixture(samples); f.render();
  f.elements.wqNext.onclick();
  assert.equal(f.state.quick.read.i, 1);
  assert.equal((f.box.html.match(/id="wqNext"/g) || []).length, 1);
  f.elements.wqNext.onclick();
  assert.equal(f.state.quick.read.i, 2);
  assert.ok(!f.box.html.includes('t13-read-controls'), 'completed read step must remove its footer');
});
test('short and long samples keep the fixed card markup and one action', () => {
  for (const word of samples) {
    const f = readFixture([word]); f.render();
    assert.ok(/class="wt-card center t13-card"/.test(f.box.html));
    assert.equal((f.box.html.match(/id="wqNext"/g) || []).length, 1);
  }
});
test('only the read control container is viewport-fixed; its flow row reserves safe-area space', () => {
  const row = declarations('body.wt-stage .wt-root .t13-read-actions');
  const controls = declarations('body.wt-stage .wt-root .t13-read-controls');
  assert.ok(/min-height\s*:\s*calc\(var\(--t13-read-controls-height\)\s*\+\s*env\(safe-area-inset-bottom(?:,\s*0px)?\)/.test(row), 'flow row must reserve footer plus safe area');
  assert.ok(!/position\s*:\s*(fixed|absolute)/.test(row), 'spacer must stay in normal flow');
  assert.ok(/position\s*:\s*fixed/.test(controls) && /bottom\s*:\s*0/.test(controls), 'only controls belong at viewport bottom');
  assert.ok(/var\(--t13-read-controls-height\)/.test(controls) && /safe-area-inset-bottom/.test(controls), 'footer must share the reserved height contract');
  assert.ok(/background\s*:\s*var\(--card/.test(controls), 'footer must use an opaque themed background');
});
test('other word action rows are not opted into the read footer', () => {
  for (const name of ['wtQuickMem', 'wtQuickListen', 'wtQuickSpell']) {
    assert.ok(!functionSource(name).includes('t13-read-'), 'another training step must not inherit the read footer');
  }
});
test('many group selectors do not leave a newly rendered read card below the stage toolbar', () => {
  const f = readFixture(samples, true); f.render();
  assert.equal(f.root.scrollTop, 434);
  f.root.scrollTop = 900; f.elements.wqNext.onclick();
  assert.equal(f.root.scrollTop, 434, 'next word must not inherit end-of-card scroll');
  f.root.scrollTop = 900; f.elements.wqNext.onclick();
  assert.equal(f.root.scrollTop, 434, 'completion prompt must be revealed too');
});
test('non-stage read rendering does not move page scroll', () => {
  const f = readFixture(samples, false); f.root.scrollTop = 123; f.render();
  assert.equal(f.root.scrollTop, 123);
});
test('stage resize reveals active read content and listener is removed on exit', () => {
  const f=readFixture(samples,true); f.context.wtStageOn(); f.render();
  f.root.scrollTop=900; assert.equal(typeof f.listeners.resize,'function','stage resize handler is missing');
  f.listeners.resize(); assert.equal(f.root.scrollTop,434);
  f.state.quick.step='memorize'; f.root.scrollTop=777; f.listeners.resize();
  assert.equal(f.root.scrollTop,434,'resize must reveal memory content after viewport reflow');
  f.state.quick.step='match'; f.root.scrollTop=777; f.listeners.resize();
  assert.equal(f.root.scrollTop,777,'resize must not reposition unrelated listening/spelling steps');
  f.context.wtStageOff(); assert.equal(f.listeners.resize,undefined,'exit must detach resize handler');
});
console.log(`${pass} passed, ${fail} failed; render/CSS contracts only, browser geometry pending`);
if (fail) process.exitCode = 1;
