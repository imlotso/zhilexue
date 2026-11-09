'use strict';
// Mount the production Vue drawer template and methods with synthetic route state.
// CSSOM assertions do not claim real browser geometry or screenshot verification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, 'public');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
async function fixture() {
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><html data-ui-theme="senyu"><head></head><body class="sy-theme sy-core"><div id="app"></div></body></html>', { url: 'https://synthetic.test/#/home', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  w.Auth = { token: 'synthetic-only', user: { id: 71, name: '合成学生', grade: '七年级', role: 'student' } };
  w.scrollTo = () => {}; w.api = async url => url.includes('mistake-count') ? { pending: 0 } : [];
  w.canPreview = () => false; w.fileKind = () => ''; w.fmtSize = () => '';
  let captured; w.Vue = { createApp(options) { captured = options; return { mount() {} }; } };
  w.eval(read('js/vue-app.js'));
  w.eval(read('vendor/vue.global.prod.js'));
  const start = captured.template.indexOf('<aside class="st-side"'), end = captured.template.indexOf('</aside>', start) + 8;
  assert.ok(start >= 0 && end > start);
  const headerStart = captured.template.indexOf('<header class="round-topbar">');
  const header = captured.template.slice(headerStart, captured.template.indexOf('</header>', headerStart) + 9);
  assert.ok(headerStart >= 0);
  const shade = captured.template.match(/<button\b[^>]*class="learn-nav-shade"[\s\S]*?<\/button>/)[0];
  const app = w.Vue.createApp({
    data() { return { ...captured.data(), page: 'home', mobileNavOpen: true }; },
    computed: captured.computed, methods: captured.methods,
    template: '<div class="st-layout st-biz st-rail learn-shell rounded-student" :class="{\'learn-nav-open\':mobileNavOpen}">' + shade + header + captured.template.slice(start, end) + '<button id="externalFocus">页面内其他操作</button></div>'
  });
  const state = app.mount('#app'); await w.Vue.nextTick();
  return { w, d, state, tick: () => w.Vue.nextTick(), close() { app.unmount(); w.close(); assert.deepEqual(errors, []); } };
}
function addStyles(f) {
  const index = new JSDOM(read('index.html')).window.document;
  for (const link of index.querySelectorAll('link[rel=stylesheet]')) {
    const pathname = link.getAttribute('href').replace(/^\.\//, '').split('?')[0];
    const style = f.d.createElement('style'); style.textContent = read(pathname); f.d.head.append(style);
  }
}

test('student entry loads drawer adapter after shared workspace presentation', () => {
  const d = new JSDOM(read('index.html')).window.document;
  const css = [...d.querySelectorAll('link[rel=stylesheet]')].map(link => link.getAttribute('href'));
  const shared = css.findIndex(src => src.includes('senyu-workspaces.css')), drawer = css.findIndex(src => src.includes('senyu-student-navigation.css'));
  assert.ok(drawer > shared && shared >= 0);
});

test('learning tools retain their separate named group and the same icon/text structure', async () => {
  const f = await fixture();
  try {
    const groups = f.d.querySelectorAll('.st-side nav'); assert.equal(groups.length, 2);
    assert.equal(groups[1].getAttribute('aria-label'), '学习工具');
    for (const link of f.d.querySelectorAll('.st-side nav a')) { assert.ok(link.querySelector('.ic > .ai')); assert.ok(link.querySelector('.nt')); }
    assert.equal(groups[1].querySelectorAll('a').length, 2); assert.match(groups[1].textContent, /速记训练/); assert.match(groups[1].textContent, /专注计时/);
  } finally { f.close(); }
});

test('main and tool links share moderate typography, row sizing, icon sizing and alignment', async () => {
  const f = await fixture();
  try {
    addStyles(f);
    for (const link of f.d.querySelectorAll('.st-side nav a')) {
      const style = f.w.getComputedStyle(link);
      assert.equal(style.fontSize, '18px'); assert.equal(style.minHeight, '48px'); assert.equal(style.gap, '12px'); assert.equal(style.padding, '10px 14px');
      assert.equal(f.w.getComputedStyle(link.querySelector('.ic')).width, '28px'); assert.equal(f.w.getComputedStyle(link.querySelector('.ai')).width, '24px');
    }
    const paper = f.d.querySelector('.st-subj a[href="#/papers"]'), tool = f.d.querySelector('.learn-tools a');
    assert.equal(f.w.getComputedStyle(tool).color, f.w.getComputedStyle(paper).color);
    assert.equal(f.w.getComputedStyle(tool).fontWeight, f.w.getComputedStyle(paper).fontWeight);
  } finally { f.close(); }
});

test('every drawer route keeps its original destination and closes on repeated selection', async () => {
  const f = await fixture();
  try {
    for (const href of ['#/home', '#/papers', '#/mistakes', '#/words/quick', '#/timer']) {
      f.w.location.hash = href; f.state.syncRoute(); f.state.mobileNavOpen = true; await f.tick();
      f.d.querySelector('.st-side a[href="' + href + '"]:not(.sbrand)').click(); await f.tick();
      assert.equal(f.w.location.hash, href); assert.equal(f.state.mobileNavOpen, false, href + ' repeated selection closes the drawer');
    }
    f.state.page = 'courses'; f.state.subject = '数学'; f.state.mobileNavOpen = true; f.w.location.hash = '#/courses'; await f.tick();
    [...f.d.querySelectorAll('.st-subj a')].find(a => a.textContent === '数学').click(); await f.tick(); assert.equal(f.state.mobileNavOpen, false); assert.equal(f.state.subject, '数学');
    f.state.mobileNavOpen = true; await f.tick(); f.d.querySelector('.learn-tools a[href="#/timer"]').click(); await f.tick(); assert.equal(f.w.location.hash, '#/timer'); assert.equal(f.state.mobileNavOpen, false);
  } finally { f.close(); }
});

test('current item semantics follow actual page/subject state across both groups', async () => {
  const f = await fixture();
  try {
    for (const [hash, text] of [['#/home', '学习空间'], ['#/papers', '试卷'], ['#/mistakes', '错题本'], ['#/words/quick', '速记训练'], ['#/timer', '专注计时']]) {
      f.w.location.hash = hash; f.state.syncRoute(); await f.tick();
      const current = f.d.querySelectorAll('.st-side nav a[aria-current="page"]'); assert.equal(current.length, 1); assert.equal(current[0].querySelector('.nt').textContent, text); assert.ok(current[0].classList.contains('on'));
    }
    f.w.location.hash = '#/courses'; f.state.syncRoute(); f.state.subject = '数学'; await f.tick(); assert.equal(f.d.querySelector('.st-side nav a[aria-current=page] .nt').textContent, '数学');
    f.state.mistCount = 4; await f.tick(); assert.equal(f.d.querySelector('.st-subj a[href="#/mistakes"] small').textContent, '4');
  } finally { f.close(); }
});

test('adapter priority beats the shipped important desktop/tablet rail rules, not just source order', async () => {
  const f = await fixture();
  try {
    addStyles(f);
    const rules = [];
    function collect(list) { for (const rule of list) { if (rule.selectorText) rules.push(rule); if (rule.cssRules) collect(rule.cssRules); } }
    for (const sheet of f.d.styleSheets) collect(sheet.cssRules);
    const oldSelector = '.st-layout.st-biz.st-rail.learn-shell .st-subj a';
    const legacy = rules.filter(rule => rule.selectorText === oldSelector && rule.style.getPropertyValue('font-size'));
    assert.ok(legacy.some(rule => rule.style.getPropertyValue('font-size') === '23px' && rule.style.getPropertyPriority('font-size') === 'important' && rule.style.getPropertyValue('min-height') === '61px'));
    assert.ok(legacy.some(rule => rule.style.getPropertyValue('font-size') === '20px' && rule.style.getPropertyPriority('font-size') === 'important'));
    assert.ok(rules.some(rule => rule.selectorText === '.learn-tools a' && rule.style.getPropertyValue('font-size') === '15px' && rule.style.getPropertyValue('min-height') === '37px'));
    const main = 'body.sy-core .st-layout.st-biz.st-rail.learn-shell.rounded-student .st-side .st-subj a';
    const tools = main.replace('.st-subj a', '.learn-tools a');
    const adapter = rules.find(rule => rule.selectorText.split(',').map(x => x.trim()).includes(main) && rule.style.getPropertyValue('font-size') === '18px');
    assert.ok(adapter); assert.ok(adapter.selectorText.split(',').map(x => x.trim()).includes(tools));
    assert.equal(adapter.style.getPropertyPriority('font-size'), 'important'); assert.equal(adapter.style.getPropertyPriority('min-height'), 'important');
    // These selected selectors are simple class/type chains (no :is/:where/:not).
    // More class selectors beat every shipped font-size rule even when !important.
    const classes = selector => (selector.match(/\.[\w-]+/g) || []).length;
    for (const rule of legacy) assert.ok(classes(main) > classes(rule.selectorText));
    const hover = rules.find(rule => rule.selectorText.split(',').map(x => x.trim()).includes(main + ':hover'));
    const focus = rules.find(rule => rule.selectorText.split(',').map(x => x.trim()).includes(main + ':focus-visible'));
    const selected = rules.find(rule => rule.selectorText.split(',').map(x => x.trim()).includes(main + '.on'));
    for (const [rule, suffix] of [[hover, ':hover'], [focus, ':focus-visible'], [selected, '.on']]) { assert.ok(rule); assert.ok(rule.selectorText.split(',').map(x => x.trim()).includes(tools + suffix)); }
    assert.equal(hover.style.getPropertyValue('background'), 'var(--sy-color-border)');
    // The saved green/eye drawer uses --learn-side -> --sy-color-surface-subtle.
    // Keep hover visibly different from both that surface and the default white.
    const palette = rules.find(rule => rule.selectorText === ':root[data-ui-theme="senyu"]');
    const themeRoot = rules.find(rule => rule.selectorText === 'body.sy-core .st-layout.st-biz.st-rail.learn-shell.rounded-student');
    const themedDrawer = rules.find(rule => rule.selectorText === 'body[data-theme] .st-layout.st-biz.st-rail.learn-shell .st-side');
    assert.equal(themeRoot.style.getPropertyValue('--learn-side'), 'var(--sy-color-surface-subtle)');
    assert.equal(themedDrawer.style.getPropertyValue('background'), 'var(--learn-side)');
    for (const surface of ['--sy-color-surface', '--sy-color-surface-subtle']) assert.notEqual(palette.style.getPropertyValue('--sy-color-border'), palette.style.getPropertyValue(surface));
    assert.equal(selected.style.getPropertyValue('background'), 'var(--sy-color-primary)');
    assert.match(focus.style.getPropertyValue('outline'), /2px solid/);
  } finally { f.close(); }
});


test('closing from current or new drawer routes returns owned focus to the visible menu trigger', async () => {
  const f = await fixture();
  try {
    const trigger = f.d.querySelector('.learn-menu');
    for (const hash of ['#/papers', '#/words/quick', '#/timer']) {
      f.w.location.hash = hash; f.state.syncRoute(); f.state.mobileNavOpen = true; await f.tick();
      const link = f.d.querySelector('.st-side a[href="' + hash + '"]'); link.focus(); assert.equal(f.d.activeElement, link);
      link.click(); await f.tick();
      assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, trigger, hash + ' current route focus');
    }
    f.w.location.hash = '#/home'; f.state.syncRoute(); f.state.mobileNavOpen = true; await f.tick();
    const next = f.d.querySelector('.st-side a[href="#/papers"]'); next.focus(); next.click(); await f.tick();
    assert.equal(f.w.location.hash, '#/papers'); assert.equal(f.d.activeElement, trigger, 'new route focus');
    f.state.page = 'courses'; f.state.subject = '数学'; f.state.mobileNavOpen = true; await f.tick();
    const subject = [...f.d.querySelectorAll('.st-subj a')].find(a => a.textContent === '数学'); subject.focus(); subject.click(); await f.tick();
    assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, trigger, 'current subject focus');
  } finally { f.close(); }
});

test('drawer close button and Escape restore owned focus while composing Escape is ignored', async () => {
  const f = await fixture();
  try {
    const close = f.d.querySelector('.round-drawer-close'), trigger = f.d.querySelector('.learn-menu');
    close.focus(); close.click(); await f.tick(); assert.equal(f.d.activeElement, trigger);
    f.state.mobileNavOpen = true; await f.tick(); close.focus();
    close.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true })); await f.tick();
    assert.equal(f.state.mobileNavOpen, true); assert.equal(f.d.activeElement, close);
    close.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, trigger);
  } finally { f.close(); }
});

test('closing a drawer does not steal external focus or a focus change during its render', async () => {
  const f = await fixture();
  try {
    const close = f.d.querySelector('.round-drawer-close'), outside = f.d.getElementById('externalFocus');
    outside.focus(); close.click(); await f.tick(); assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, outside);
    f.state.mobileNavOpen = true; await f.tick(); close.focus(); close.click(); outside.focus(); await f.tick(); assert.equal(f.d.activeElement, outside);
    f.state.mobileNavOpen = true; await f.tick(); close.focus(); close.click(); f.state.mobileNavOpen = true; await f.tick(); assert.equal(f.d.activeElement, close, 'reopened drawer keeps its focus');
  } finally { f.close(); }
});

test('closed drawer is hidden from keyboard and assistive technology with a connected expanded trigger', async () => {
  const f = await fixture();
  try {
    addStyles(f);
    const drawer = f.d.querySelector('.st-side'), trigger = f.d.querySelector('.learn-menu');
    assert.equal(trigger.getAttribute('aria-controls'), drawer.id); assert.notEqual(drawer.id, '');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true'); assert.equal(drawer.hasAttribute('inert'), false); assert.equal(drawer.getAttribute('aria-hidden'), 'false');
    f.d.querySelector('.round-drawer-close').click(); await f.tick();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(drawer.hasAttribute('inert'), true); assert.equal(drawer.getAttribute('aria-hidden'), 'true');
    assert.equal(f.w.getComputedStyle(drawer).visibility, 'hidden');
    trigger.click(); await f.tick(); assert.equal(trigger.getAttribute('aria-expanded'), 'true'); assert.equal(drawer.hasAttribute('inert'), false); assert.equal(f.w.getComputedStyle(drawer).visibility, 'visible');
  } finally { f.close(); }
});

test('the owned backdrop can return focus without taking it from an external page control', async () => {
  const f = await fixture();
  try {
    const trigger = f.d.querySelector('.learn-menu'), outside = f.d.getElementById('externalFocus');
    const shade = f.d.querySelector('.learn-nav-shade'); shade.focus(); shade.click(); await f.tick(); assert.equal(f.d.activeElement, trigger);
    f.state.mobileNavOpen = true; await f.tick(); outside.focus(); f.d.querySelector('.learn-nav-shade').click(); await f.tick(); assert.equal(f.d.activeElement, outside);
  } finally { f.close(); }
});

test('Escape on the expanded trigger closes its drawer and route loading uses the same focus lifecycle', async () => {
  const f = await fixture();
  try {
    const trigger = f.d.querySelector('.learn-menu'); trigger.focus();
    trigger.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, trigger);
    f.state.mobileNavOpen = true; await f.tick(); f.d.querySelector('.st-side a[href="#/timer"]').focus();
    f.w.location.hash = '#/timer'; await f.state.load(); await f.tick(); assert.equal(f.state.mobileNavOpen, false); assert.equal(f.d.activeElement, trigger);
  } finally { f.close(); }
});

test('closing never restores focus to a trigger hidden by its own or an ancestor stylesheet', async () => {
  const f = await fixture();
  try {
    const trigger = f.d.querySelector('.learn-menu'), header = trigger.parentElement, close = f.d.querySelector('.round-drawer-close');
    let attempts = 0; const focus = trigger.focus.bind(trigger); trigger.focus = options => { attempts++; focus(options); };
    for (const [node, property, value] of [[trigger, 'display', 'none'], [header, 'display', 'none'], [header, 'visibility', 'hidden']]) {
      f.state.mobileNavOpen = true; await f.tick(); close.focus(); close.click(); node.style[property] = value; await f.tick();
      assert.equal(attempts, 0, 'CSS-hidden return target must not be focused: ' + property);
      node.style[property] = '';
    }
  } finally { f.close(); }
});
