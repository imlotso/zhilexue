'use strict';
// Execute the real fitter with browser measurements reproduced from Windows Chromium.
// The full glyph/layout matrix remains in astra-takeover-word-responsive-test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, 'public/js/t13-fit.js'), 'utf8');
function fixture(base, height, measuredHeight) {
  const frames = [], events = {};
  const element = { style: { fontSize: '' }, clientWidth: 212, clientHeight: height,
    get scrollWidth() { return 212; },
    get scrollHeight() { return measuredHeight(parseFloat(this.style.fontSize) || base); } };
  let mutations;
  const body = {};
  vm.runInNewContext(source, {
    document: { body, querySelectorAll: () => [element] },
    getComputedStyle: el => ({ fontSize: el.style.fontSize || base + 'px' }),
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    MutationObserver: function(callback) { mutations = callback; this.observe = () => {}; },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
  });
  const run = () => { while (frames.length) frames.shift()(); };
  return { element, run, events, change: () => mutations([{ type: 'characterData' }]) };
}
test('one vertical overflow pixel triggers shrinking instead of clipping a descender', () => {
  // Actual 48px Windows word: 60px region, scrollHeight=61, glyph bottom +1.406px.
  const f = fixture(48, 60, size => size >= 48 ? 61 : 55);
  f.run();
  assert.ok(parseFloat(f.element.style.fontSize) < 48, '1px scroll overflow was incorrectly accepted');
  assert.ok(f.element.scrollHeight <= 60);
  assert.equal(f.element.clientHeight, 60, 'the fixed region must not grow');
});
test('wrapped narrow word is refitted when integer overflow is only one pixel', () => {
  const f = fixture(34, 43, size => size >= 18.9 ? Math.ceil(size * 2.3) : 40);
  f.run();
  assert.ok(parseFloat(f.element.style.fontSize) < 18.9, 'wrapped descender still falls below the fixed region');
  assert.ok(f.element.scrollHeight <= 43);
});
test('a fitting word retains its original size and fixed region', () => {
  const f = fixture(48, 60, () => 60); f.run();
  assert.equal(f.element.style.fontSize, '');
  assert.equal(f.element.clientHeight, 60);
});
test('resize and new content reset the prior shrink before fitting again', () => {
  let overflow = true;
  const f = fixture(48, 60, size => overflow && size >= 48 ? 61 : 55);
  f.run(); assert.ok(f.element.style.fontSize);
  overflow = false; f.events.resize(); f.run();
  assert.equal(f.element.style.fontSize, '');
  overflow = true; f.change(); f.run();
  assert.ok(parseFloat(f.element.style.fontSize) < 48);
});
test('hidden regions are left alone and extreme content respects the minimum size', () => {
  const hidden = fixture(48, 0, () => 100); hidden.run();
  assert.equal(hidden.element.style.fontSize, '');
  const extreme = fixture(48, 60, () => 100); extreme.run();
  assert.equal(parseFloat(extreme.element.style.fontSize), 20.16);
});
