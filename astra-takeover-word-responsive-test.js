'use strict';
/**
 * T13 responsive regression. Default: pure Node rendering/scroll contracts.
 * --browser: real Chromium geometry against a synthetic, offline component page.
 * --fixture <file>: write that self-contained page for a normal browser.
 * --viewer <file> --before <fixture>: compare versions in measured iframe viewports.
 * This is NOT the authenticated application: all data is synthetic; API/audio are
 * stubbed; no auth/config/database modules are imported and no server is started.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'public/js/words.js'), 'utf8');
const sourceCss = fs.readFileSync(path.join(__dirname, 'public/css/app.css'), 'utf8');
const samples = [
  { id: 101, word: 'a', meaning: '一个', phonetic: '/ə/' },
  { id: 102, word: 'characteristically', meaning: '典型地；具有代表性地；用来说明某人或事物最明显、最容易辨认的特点，也可以描述经常出现的行为方式。', phonetic: '/ˌkærəktəˈrɪstɪkli/' },
  { id: 103, word: 'internationalization', meaning: '国际化；使产品适用于不同国家、语言和文化环境的过程。' },
  { id: 104, word: 'environment', meaning: '环境；周围的自然条件和生活条件', phonetic: '/ɪnˈvaɪrənmənt/' },
  { id: 105, word: 'book', meaning: '书；预订' },
];
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `real function ${name} is present`);
  return source.slice(start, end + 2);
}
function fixture({ stage = true, phase = 'ask', index = 0 } = {}) {
  const root = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) };
  const elements = {};
  const box = {
    html: '', closest: () => root, getBoundingClientRect: () => ({ top: 520 - root.scrollTop }),
    set innerHTML(value) {
      this.html = value;
      for (const id of Object.keys(elements)) if (id !== 'wtQuickBox') delete elements[id];
      for (const match of value.matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = {
        onclick: null, style: {}, classList: { add() {}, remove() {} }, innerHTML: '', textContent: '',
      };
    },
    get innerHTML() { return this.html; }, querySelectorAll: () => [],
  };
  elements.wtQuickBox = box;
  const state = { curSub: 'quick', data: { words: samples }, quick: {
    step: 'memorize', words: samples.slice(), mem: { i: index, phase, revealed: phase === 'learn', spoke: null },
    read: { i: 0, spoke: null }, right: 0, wrong: 0,
  } };
  const context = vm.createContext({ WT: state, WT_TTS_TAG: 0,
    document: { body: { classList: { contains: name => stage && name === 'wt-stage' } }, getElementById: id => elements[id] || null },
    WT_STAGE_BAR: { getBoundingClientRect: () => ({ bottom: 74 }) },
    WT_STEPS: [{ t: '单词学习' }], wtIc: () => '', wtNoun: () => '单词',
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    shuffle: values => values.slice(), pick: (values, n) => values.slice(0, n),
    wtLater() {}, speak() {}, wtRecord() {}, wtWrongWordAdd() {},
    setInterval: () => 1, clearInterval() {},
  });
  for (const name of ['wtQuickReveal', 'wtQuickRevealCurrent', 'wtProg', 'wtDoneHTML', 'wtBindDone', 'wtQuickRead', 'wtQuickMem', 'wtMemLearn']) {
    vm.runInContext(functionSource(name), context);
  }
  return { root, box, state, elements, context, render: () => context.wtQuickMem() };
}
// Shared assertion helpers; the browser supplies all geometry. Node checks only
// the predicates, including false-positive examples from the actual v2 report.
function glyphInkBounds(range, probe, metrics) {
  const scale=range.height/probe.height;
  const baseline=range.y+probe.baselineOffset*scale;
  return {top:baseline-metrics.inkAscent*scale,bottom:baseline+metrics.inkDescent*scale};
}
function textClipIssue(region) {
  const clip = region.clip || region.rect, text = region.text;
  // scrollHeight includes trailing padding and integer rounding. The rendered
  // text must instead fit inside the actual padding-box clipping boundary.
  if (text.x < clip.x - 1 || text.x + text.width > clip.right + 1) return 'horizontal text clipping';
  if (region.ink && region.ink.error) return 'ink measurement unavailable: ' + region.ink.error;
  const top = region.ink ? region.ink.top : text.y;
  const bottom = region.ink ? region.ink.bottom : text.y + text.height;
  if (top < clip.y - 1 || bottom > clip.bottom + 1) return 'vertical text clipping';
  return null;
}
function alignmentIssue(metrics) {
  const gap = metrics.box.y - metrics.toolbar.bottom;
  if (gap < 10) return 'content overlaps the toolbar: gap ' + gap;
  if (metrics.box.y >= metrics.viewport.height) return 'active content is outside the viewport';
  if (gap <= 14) return null;
  const root = metrics.root;
  const atEnd = root && Math.abs(root.scrollTop - Math.max(0, root.scrollHeight - root.clientHeight)) <= 1;
  return atEnd ? null : 'content has not reached its available scroll position: gap ' + gap;
}
function runNode() {
  let pass = 0, fail = 0;
  function test(name, fn) {
    try { fn(); pass++; console.log('PASS', name); }
    catch (error) { fail++; console.error('FAIL', name, error.message); }
  }
  test('memory entry reveals the new card below the stage toolbar', () => {
    const f = fixture(); f.render();
    assert.equal(f.root.scrollTop, 434, 'memory rendering leaves the card behind the group selector');
  });
  test('revealing a meaning resets inherited end-of-card scroll without changing the queue', () => {
    const f = fixture(); f.render(); f.root.scrollTop = 900; f.elements.wqNo.onclick();
    assert.equal(f.state.quick.mem.phase, 'learn');
    assert.equal(f.state.quick.words.length, samples.length + 1);
    assert.equal(f.state.quick.wrong, 1);
    assert.equal(f.root.scrollTop, 434, 'revealed word should not retain the previous scroll position');
  });
  test('memory next renders exactly the next word and brings its start into view', () => {
    const f = fixture({ phase: 'learn' }); f.render(); f.root.scrollTop = 900; f.elements.wqNext.onclick();
    assert.equal(f.state.quick.mem.i, 1);
    assert.equal(f.state.quick.mem.phase, 'ask');
    assert.equal(f.state.quick.mem.revealed, false);
    assert.equal(f.root.scrollTop, 434);
  });
  test('memory completion reveals its existing next-stage action', () => {
    const f = fixture({ index: samples.length }); f.root.scrollTop = 900; f.render();
    assert.ok(f.elements.wtNext);
    assert.equal(f.root.scrollTop, 434);
  });
  test('non-stage memory rendering does not move page scroll', () => {
    const f = fixture({ stage: false }); f.root.scrollTop = 123; f.render();
    assert.equal(f.root.scrollTop, 123);
  });
  test('memory keeps the fixed card and one set of existing phase actions', () => {
    for (const phase of ['ask', 'quiz', 'learn']) {
      const f = fixture({ phase }); f.render();
      assert.ok(/class="wt-card center t13-card"/.test(f.box.html));
      assert.equal((f.box.html.match(/id="wqEn"/g) || []).length, 1);
      assert.equal((f.box.html.match(/id="wqNext"/g) || []).length, phase === 'learn' ? 1 : 0);
      assert.equal((f.box.html.match(/id="wqYes"/g) || []).length, phase === 'ask' ? 1 : 0);
      assert.ok(!f.box.html.includes('t13-read-controls'));
    }
  });
  test('memory resize and font changes reveal the active card while other steps retain scroll', () => {
    const f = fixture(); f.render(); f.root.scrollTop = 900;
    f.context.wtQuickRevealCurrent();
    assert.equal(f.root.scrollTop, 434, 'memory is omitted from the existing resize/font handler');
    for (const step of ['match', 'spell']) {
      f.state.quick.step = step; f.root.scrollTop = 777; f.context.wtQuickRevealCurrent();
      assert.equal(f.root.scrollTop, 777, 'unrelated steps must retain their scrolling');
    }
  });
  test('read and memory separate wrappable text from the pronunciation button', () => {
    const f = fixture({ index: 1 });
    for (const render of [() => f.context.wtQuickRead(), f.render]) {
      render();
      assert.ok(/<span class="t13-word-text">[^<]+<\/span>\s*<button class="wq-spk"/.test(f.box.html), 'text needs its own shrinkable region so the speaker is never pushed outside');
      assert.equal((f.box.html.match(/id="wqSpk"/g) || []).length, 1);
    }
  });
  test('the scoped text region can shrink and wrap within the existing fixed word row', () => {
    const rule = sourceCss.match(/\.t13-card \.t13-word-text\s*\{([^}]+)\}/);
    assert.ok(rule, 'the dedicated text container needs scoped CSS');
    assert.match(rule[1], /min-width\s*:\s*0/);
    assert.match(rule[1], /white-space\s*:\s*normal/);
    assert.match(rule[1], /overflow-wrap\s*:\s*anywhere/);
  });
  test('the actual fixture snapshot used by the matrix survives real exit/reset state', () => {
    const html = harnessHtml();
    const line = html.split('\n').find(value => value.trim().startsWith('state() { return { step: WT.quick.step'));
    assert.ok(line, 'the actual generated fixture snapshot must be tested');
    const readState = '(function ' + line.trim().replace(/,$/, '') + ')()';
    const f = fixture();
    assert.equal(vm.runInContext(readState, f.context).read, 0);
    f.context.wtStopSpeech = () => {};
    f.context.WT_DRILL_REVIEW = false;
    vm.runInContext(functionSource('wtReset') + '\nwtReset("quick");', f.context);
    f.context.document.body.classList.contains = () => false;
    const state = vm.runInContext(readState, f.context);
    assert.equal(state.stage, false);
    assert.equal(state.step, '');
    assert.equal(state.read, undefined);
    assert.equal(state.memory, undefined);
  });
  test('geometry predicate accepts measured complete option text despite padding overflow', () => {
    const region = { scrollWidth:100,clientWidth:100,scrollHeight:60,clientHeight:58,
      rect:{x:49,y:529.06,right:151,bottom:589.06},clip:{x:50,y:530.06,right:150,bottom:588.06},
      text:{x:60.16,y:533.14,width:79.69,height:50.88} };
    assert.equal(textClipIssue(region),null);
    assert.ok(textClipIssue({ ...region,text:{...region.text,y:region.clip.y-3} }), 'true vertical clipping must still fail');
    assert.ok(textClipIssue({ ...region,text:{...region.text,x:27.95,width:254.09} }), 'the observed pre-fix cropped long word must still fail');
  });
  test('geometry predicate permits larger toolbar gaps only at the real scroll limit', () => {
    const metrics = { box:{y:102.78},toolbar:{bottom:62},viewport:{height:844},root:{scrollTop:400,scrollHeight:1244,clientHeight:844} };
    assert.equal(alignmentIssue(metrics),null);
    assert.ok(alignmentIssue({...metrics,root:{...metrics.root,scrollTop:200}}), 'an unscrolled card must not pass');
    assert.ok(alignmentIssue({...metrics,box:{y:880}}), 'an offscreen card must not pass even at a scroll limit');
    assert.ok(alignmentIssue({...metrics,box:{y:50}}), 'a card behind the toolbar must not pass');
  });
  test('fixed-card options exclude font-size from transitions used during fit measurement', () => {
    const rules = [...sourceCss.matchAll(/\.t13-card \.wt-opt\s*\{([^}]+)\}/g)].map(match=>match[1]);
    const rule = rules.find(value => /transition-property\s*:/.test(value));
    assert.ok(rule, 'font fitting must not measure an animated old font size');
    const properties = rule.match(/transition-property\s*:\s*([^;}]*)/)[1].split(',').map(value=>value.trim());
    assert.ok(!properties.includes('all') && !properties.includes('font-size'));
    assert.ok(properties.includes('color') && properties.includes('border-color'), 'existing visual feedback transitions must remain');
  });
  test('glyph-ink checks distinguish font-metric whitespace from actual vertical clipping', () => {
    const region = {rect:{x:0,y:0,right:200,bottom:55},clip:{x:0,y:0,right:200,bottom:55},
      text:{x:20,y:-2.78,width:153,height:59},ink:{top:12,bottom:43,glyphs:4}};
    assert.equal(textClipIssue(region),null,'an em box is not a glyph ink box');
    assert.ok(textClipIssue({...region,ink:{...region.ink,top:-3}}),'ink above the clip boundary must still fail');
    assert.ok(textClipIssue({...region,ink:{...region.ink,bottom:60}}),'ink below the clip boundary must still fail');
    assert.ok(textClipIssue({...region,text:{...region.text,x:-20}}),'the original horizontal cropping check must remain');
  });
  test('glyph bounds use the measured DOM baseline rather than primary-font fallback ratios', () => {
    const bounds=glyphInkBounds({y:100,height:27},{height:27,baselineOffset:22},{fontAscent:17,fontDescent:4,inkAscent:17,inkDescent:2});
    assert.equal(bounds.top,105);
    assert.equal(bounds.bottom,124);
  });
  console.log(`${pass} passed, ${fail} failed; synthetic render/scroll contracts only, not browser geometry`);
  if (fail) process.exitCode = 1;
}
function harnessHtml() {
  const escapeScript = text => text.replace(/<\/script/gi, '<\\/script');
  const css = ['public/css/app.css', 'public/css/ali-icons.css', 'public/vendor/element-ui.css', 'public/css/ruoyi.css']
    .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  const fit = fs.readFileSync(path.join(__dirname, 'public/js/t13-fit.js'), 'utf8');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'">
<title>T13 Synthetic Offline Component Test</title><style>${css}
#fixtureLauncher{padding:20px;display:flex;gap:10px;flex-wrap:wrap}#fixtureLauncher p{flex-basis:100%}#fixtureLauncher button{padding:10px 16px;cursor:pointer}body.wt-stage #fixtureLauncher{display:none}
</style></head><body data-theme="day">
<section id="fixtureLauncher"><p>纯前端合成数据组件测试。API和语音均为本页桩，无账号、无数据库、无网络请求。退出后可切换案例。</p>
<button onclick="wordHarness.start();wordHarness.show('read',0)">读词：短词</button>
<button onclick="wordHarness.start();wordHarness.show('read',1)">读词：长词长释义</button>
<button onclick="wordHarness.start();wordHarness.show('read',5)">读词完成 → 进入记忆</button>
<button onclick="wordHarness.start();wordHarness.show('memorize',0)">记忆：认识吗</button>
<button onclick="wordHarness.start();wordHarness.show('memorize',1,'learn')">记忆：长释义</button>
<button onclick="wordHarness.start();wordHarness.show('memorize',1,'quiz')">记忆：选择题（真实5秒倒计时）</button>
</section>
<div class="st-layout st-biz"><main class="st-main"><div class="st-content wt-root wt-fluid"><div class="wt-wrap"><div class="card"><div id="wtSteps" class="wt-steps"></div><div id="wtGroups"></div><div id="wtQuickBox"></div></div></div></div></main></div>
<script>
window.__syntheticCalls = [];
window.api = async (...args) => { window.__syntheticCalls.push(args); return {}; };
window.esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
window.toast = () => {};
const memoryStorage = new Map();
Object.defineProperty(window, 'localStorage', { value: { getItem: k => memoryStorage.get(k) || null, setItem: (k,v) => memoryStorage.set(k,String(v)), removeItem: k => memoryStorage.delete(k) } });
Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [{ lang: 'en-US' }], cancel() {} } });
</script><script>${escapeScript(source)}</script><script>${escapeScript(fit)}</script><script>
speak = () => {};
const fixtureWords = ${JSON.stringify(samples)};
window.render = () => wtQuickStart(false);
window.wordHarness = {
  reset(size = 'big') {
    wtStageOff(); wtStopSpeech();
    WT.curSub = 'quick'; WT.bookId = 'synthetic-layout'; WT.unit = '';
    WT.books = [{ id: 'synthetic-layout', title: 'Synthetic test data', grade: '三年级', kind: 'word' }];
    WT.data.words = Array.from({ length: 26 }, (_, group) => fixtureWords.map((w, i) => ({ ...w, id: 1000 + group * 5 + i }))).flat();
    wtReset('quick'); wtFsSet(size); render();
  },
  start(size = 'big') {
    this.reset(size); wtStartGroup(0, false);
    WT.quick.words = fixtureWords.map(w => ({ ...w })); WT.quick.read.i = 0;
    wtQuickRender();
  },
  show(step, index = 0, phase = 'ask') {
    WT.quick.step = step;
    if (step === 'read') WT.quick.read.i = index;
    if (step === 'memorize') Object.assign(WT.quick.mem, { i: index, phase, revealed: phase === 'learn' });
    wtQuickRender();
  },
  state() { return { step: WT.quick.step, read: WT.quick.read && WT.quick.read.i, memory: WT.quick.mem && WT.quick.mem.i, phase: WT.quick.mem && WT.quick.mem.phase, stage: document.body.classList.contains('wt-stage') }; },
};
wordHarness.reset();
</script></body></html>`;
}
async function runBrowser() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const output = process.env.WORD_UI_EVIDENCE_DIR;
  try {
    const context = await browser.newContext({ viewport:{ width:1440,height:1000 },serviceWorkers:'block' });
    const requests = [], errors = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // Run exactly the same visible-button matrix as the normal-browser fallback.
    // No production server or credentials are needed, and no request may leave.
    await page.setContent(viewerHtml(harnessHtml(),harnessHtml()),{ waitUntil:'load' });
    await page.waitForFunction(() => {
      const iframe = document.getElementById('preview');
      return iframe && iframe.contentWindow && iframe.contentWindow.wordHarness;
    });
    await page.locator('#runMatrix').click();
    await page.waitForFunction(() => !!window.wordMatrixReport,null,{ timeout:120000 });
    const report = await page.evaluate(() => window.wordMatrixReport);
    if (output) {
      fs.mkdirSync(output,{ recursive:true });
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
      if (report.fail) await page.screenshot({ path:path.join(output,'matrix-failure.png') });
    }
    for (const result of report.cases) console.log(result.pass ? 'PASS' : 'FAIL',result.viewport,result.font,result.name,result.error || '');
    assert.deepEqual(errors,[],'the component page must have no script errors');
    assert.deepEqual(requests,[],'the component page must make no outgoing requests');
    assert.equal(report.total,130,'the complete matrix must run');
    assert.equal(report.fail,0,'see individual real-DOM failures above');
    console.log(`${report.pass} passed, ${report.fail} failed; Chromium geometry on offline synthetic components only`);
    await context.close();
  } finally { await browser.close(); }
}
// A DOM Range describes font metrics, including empty ascender/descender space.
// Resolve each displayed glyph against the browser's actual Canvas font metrics
// and its own DOM range; never assume a font family, baseline or viewport position.
function measureTextInk(element) {
  const doc=element.ownerDocument,win=doc.defaultView;
  if(!measureTextInk.contexts)measureTextInk.contexts=new WeakMap();
  let state=measureTextInk.contexts.get(doc);
  if(!state){
    const ctx=doc.createElement('canvas').getContext('2d');
    if(!ctx)return {error:'Canvas 2D is unavailable'};
    const host=doc.createElement('span');
    host.setAttribute('aria-hidden','true');
    host.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre;margin:0;padding:0;border:0;';
    const text=doc.createTextNode('');
    const marker=doc.createElement('span');
    marker.style.cssText='display:inline-block;width:0;height:0;line-height:0;padding:0;margin:0;border:0;vertical-align:baseline;';
    host.append(text,marker);
    // The production fit observer watches document.body. An out-of-flow probe
    // directly under the document element neither triggers it nor shifts cards.
    doc.documentElement.appendChild(host);
    state={ctx,host,text,marker,baselines:new Map()};measureTextInk.contexts.set(doc,state);
  }
  const {ctx,host,text,marker,baselines}=state;
  const initial=element.getBoundingClientRect();
  const walker=doc.createTreeWalker(element,win.NodeFilter.SHOW_TEXT);
  let node,top=Infinity,bottom=-Infinity,glyphs=0,topGlyph=null,bottomGlyph=null;
  while((node=walker.nextNode())){
    const style=win.getComputedStyle(node.parentElement);
    if(style.visibility==='hidden'||style.display==='none')continue;
    const font=style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
    ctx.font='1px sans-serif';ctx.font=font;ctx.textBaseline='alphabetic';ctx.textAlign='left';
    if(ctx.font==='1px sans-serif'&&style.fontSize!=='1px')return {error:'the computed browser font could not be measured'};
    let offset=0;
    for(const character of node.textContent){
      const start=offset;offset+=character.length;
      if(/\s/.test(character))continue;
      const range=doc.createRange();range.setStart(node,start);range.setEnd(node,offset);
      const r=range.getBoundingClientRect();if(!r.height)continue;
      const m=ctx.measureText(character);
      if(![m.fontBoundingBoxAscent,m.fontBoundingBoxDescent,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent].every(Number.isFinite))return {error:'actual/font bounding-box metrics are unavailable'};
      const key=[font,style.lineHeight,style.fontFeatureSettings,style.fontVariationSettings,character].join('|');
      let probe=baselines.get(key);
      if(!probe){
        host.style.font=font;host.style.lineHeight=style.lineHeight;
        host.style.fontFeatureSettings=style.fontFeatureSettings;
        host.style.fontVariationSettings=style.fontVariationSettings;
        text.textContent=character;
        const glyphRange=doc.createRange();glyphRange.selectNodeContents(text);
        const glyph=glyphRange.getBoundingClientRect(),baseline=marker.getBoundingClientRect().top;
        probe={height:glyph.height,baselineOffset:baseline-glyph.top};
        if(!Number.isFinite(probe.height)||probe.height<=0||!Number.isFinite(probe.baselineOffset))return {error:'the DOM baseline probe could not be measured'};
        baselines.set(key,probe);
      }
      const metrics={fontAscent:m.fontBoundingBoxAscent,fontDescent:m.fontBoundingBoxDescent,inkAscent:m.actualBoundingBoxAscent,inkDescent:m.actualBoundingBoxDescent};
      const bounds=glyphInkBounds({y:r.top,height:r.height},probe,metrics);
      const evidence={character,rangeY:r.top,rangeHeight:r.height,font:ctx.font,probeHeight:probe.height,baselineOffset:probe.baselineOffset,...metrics};
      if(bounds.top<top){top=bounds.top;topGlyph=evidence;}
      if(bounds.bottom>bottom){bottom=bounds.bottom;bottomGlyph=evidence;}
      glyphs++;
    }
  }
  const final=element.getBoundingClientRect();
  const layoutUnchanged=['x','y','width','height'].every(key=>Math.abs(initial[key]-final[key])<0.01);
  if(!layoutUnchanged)return {error:'the baseline probe changed target layout'};
  return glyphs?{top,bottom,glyphs,layoutUnchanged,topGlyph,bottomGlyph}:{top:null,bottom:null,glyphs:0,layoutUnchanged};
}
async function sampleCountdown(font, onSample) {
  const win = frame.contentWindow, doc = frame.contentDocument;
  win.wordHarness.start(font); win.wordHarness.show('memorize',1,'quiz');
  await doc.fonts.ready;
  const start = performance.now(), samples = [], issues = [];
  try {
    for (const target of [250,1250,2250,3250,4250]) {
      await new Promise(resolve => setTimeout(resolve,Math.max(0,target-(performance.now()-start))));
      await new Promise(resolve => win.requestAnimationFrame(resolve));
      const metrics = collectMetrics();
      const remaining = doc.getElementById('wqTimer') && doc.getElementById('wqTimer').textContent;
      const options = metrics.regions.filter(region => region.className.includes('wt-opt'));
      const elapsed = Math.round(performance.now()-start);
      if (!remaining || options.length !== 4) issues.push({elapsed,error:'quiz was not present during the scheduled observation'});
      for (const option of options) {
        const issue = textClipIssue(option);
        if (issue) issues.push({elapsed,remaining,error:issue,content:option.content,fontSize:option.fontSize,inlineFontSize:option.inlineFontSize,text:option.text,ink:option.ink,clip:option.clip});
      }
      samples.push({elapsed,remaining,options});
      if (onSample) onSample(samples.length,issues.length);
    }
  } finally {
    const exit = doc.querySelector('.wt-stage-exit');
    if (exit) exit.click();
  }
  return {font,samples,issues};
}
async function runCountdownProbe() {
  const controls = [...document.querySelectorAll('header select,header button,header input')];
  controls.forEach(control=>{control.disabled=true;});
  const output=document.getElementById('metrics'),progress=document.getElementById('runProgress');
  const report={scope:'Actual 320px iframe geometry across real five-second countdown ticks; no timer stubs',version:document.getElementById('version').value,cases:[]};
  try {
    document.getElementById('viewport').value='320,640';sizeFrame();
    for(const font of ['big','mid','small']) {
      const result=await sampleCountdown(font,(count,errors)=>{progress.textContent=font+'：'+count+'/5 个真实时刻，'+errors+' 个裁字';});
      report.cases.push(result);
    }
  } catch(error){report.error=error.message;}
  report.fail=report.cases.reduce((total,result)=>total+result.issues.length,0);
  window.wordCountdownReport=report;output.textContent=JSON.stringify(report,null,2);
  progress.textContent='倒计时实测完成：'+report.fail+' 个裁字'+(report.error?'，基础设施错误':'');
  controls.forEach(control=>{control.disabled=false;});
}
// Executed only by the viewer's visible button, inside its synthetic iframe.
// Every measurement comes from the live browser DOM after fonts and animation frames settle.
async function runInlineMatrix() {
  const output = document.getElementById('metrics');
  const progress = document.getElementById('runProgress');
  const runButton = document.getElementById('runMatrix');
  const controls = [...document.querySelectorAll('header select, header button, header input')];
  controls.forEach(control => { control.disabled = true; });
  const cases = [];
  const version = document.getElementById('version').value;
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  let current = {};
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  function record(name, check, evidence) {
    let failure = null;
    try { check(); } catch (error) { failure = error.message; }
    cases.push({ ...current, name, pass: !failure, ...(failure ? { error: failure,uncertain:failure.includes('ink measurement unavailable') } : {}), evidence });
    progress.textContent = '已测 ' + cases.length + ' 项，失败 ' + cases.filter(item => !item.pass).length;
    output.textContent = progress.textContent + '\n' + cases.slice(-3).map(item => (item.pass ? 'PASS ' : 'FAIL ') + item.viewport + ' ' + item.font + ' ' + item.name + (item.error ? ': ' + item.error : '')).join('\n');
  }
  async function settle() {
    await doc.fonts.ready;
    // MutationObserver schedules t13-fit in the next frame; allow it to run and
    // require stable layout on consecutive frames before collecting geometry.
    let previous = '', stable = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => win.requestAnimationFrame(resolve));
      const signature = [...doc.querySelectorAll('.t13-card,.wq-word,.wq-mean,.wt-opt,.wt-stage-bar')].map(element => {
        const r = element.getBoundingClientRect();
        return [r.x,r.y,r.width,r.height,element.scrollWidth,element.scrollHeight,win.getComputedStyle(element).fontSize].join(',');
      }).join('|');
      stable = signature === previous ? stable + 1 : 0;
      if (stable >= 2) return;
      previous = signature;
    }
    throw new Error('layout did not settle within 12 animation frames');
  }
  async function viewport(value) {
    document.getElementById('viewport').value = value;
    sizeFrame(); await settle();
  }
  function sameRegions(a, b) {
    for (const name of ['card','word','meaning']) {
      const get = metrics => name === 'card' ? metrics.card : metrics.regions.find(region => region.className.includes(name === 'word' ? 'wq-word' : 'wq-mean')).rect;
      const old = get(a), next = get(b);
      for (const key of ['y','height']) assert(Math.abs(old[key] - next[key]) <= 1, name + '.' + key + ' moved: ' + old[key] + ' -> ' + next[key]);
    }
  }
  function textFits(metrics) {
    assert(metrics.root.scrollWidth <= metrics.root.clientWidth + 1, 'stage has horizontal overflow');
    for (const region of metrics.regions) {
      if (region.visibility === 'hidden' || region.className.includes('wq-phon')) continue;
      const issue = textClipIssue(region);
      assert(!issue, region.className + ': ' + issue);
    }
    const speaker = metrics.actions.find(action => action.id === 'wqSpk');
    assert(speaker && speaker.centerHittable, 'pronunciation button is clipped or covered');
    const word = metrics.regions.find(region => region.className.includes('wq-word')).clip;
    assert(speaker.rect.x >= word.x - 1 && speaker.rect.right <= word.right + 1 && speaker.rect.y >= word.y - 1 && speaker.rect.bottom <= word.bottom + 1, 'pronunciation button is partly clipped');
  }
  function aligned(metrics) {
    const issue = alignmentIssue(metrics);
    assert(!issue, issue);
  }
  try {
    for (const size of ['390,844','320,640','768,1024','1440,900','844,390']) {
      await viewport(size);
      for (const font of ['big','mid','small']) {
        current = { viewport: size.replace(',', ' × '), font };
        win.wordHarness.start(font); await settle();
        const short = collectMetrics();
        for (let index = 1; index < 5; index++) {
          doc.getElementById('wqNext').click(); await settle();
          const metrics = collectMetrics();
          record('read word ' + index + ': fixed regions, full text and speaker', () => {
            sameRegions(short, metrics); textFits(metrics);
            assert(metrics.actions.find(action => action.id === 'wqNext').centerHittable, 'read next action is not reachable');
          }, { card:metrics.card, word:metrics.regions[0], regions:metrics.regions, actions:metrics.actions });
        }
        doc.getElementById('wqNext').click(); await settle();
        doc.getElementById('wtNext').click(); await settle();
        const memory = collectMetrics();
        record('read completion enters visible memory content', () => {
          aligned(memory);
          const actions = memory.actions.filter(action => action.id === 'wqYes' || action.id === 'wqNo');
          assert(actions.length === 2, 'memory ask actions are missing');
          if (memory.viewport.height >= 600) assert(actions.every(action => action.centerHittable && action.insideViewport), 'memory ask actions require scrolling on a full-height viewport');
          else {
            doc.getElementById('wqYes').scrollIntoView({ block:'center' });
            assert(collectMetrics().actions.find(action => action.id === 'wqYes').centerHittable, 'landscape memory action cannot be scrolled into view');
          }
        }, { box:memory.box, toolbar:memory.toolbar, root:memory.root, actions:memory.actions });
        for (const phase of ['learn','quiz']) {
          win.wordHarness.show('memorize',0,phase); await settle();
          const first = collectMetrics();
          win.wordHarness.show('memorize',1,phase); await settle();
          const metrics = collectMetrics();
          record('memory ' + phase + ': short/long fixed regions and unclipped text', () => {
            sameRegions(first,metrics); textFits(metrics);
          }, { card:metrics.card, regions:metrics.regions, actions:metrics.actions });
        }
        doc.querySelector('.wt-stage-exit').click(); await settle();
        const exited = !win.wordHarness.state().stage && !doc.querySelector('.wt-stage-bar') && !doc.querySelector('.t13-read-controls');
        doc.querySelector('[data-g="0"]').click(); await settle();
        record('exit and re-entry have one toolbar and one read action', () => {
          assert(exited, 'exit leaves stage controls behind');
          assert(doc.querySelectorAll('.wt-stage-bar').length === 1, 'duplicate stage toolbar');
          assert(doc.querySelectorAll('#wqNext').length === 1, 'duplicate or missing next action');
        }, win.wordHarness.state());
      }
    }
    for (const [from,to] of [['390,844','320,640'],['844,390','390,844'],['390,844','844,390']]) {
      current = { viewport: from + ' → ' + to, font:'big' };
      await viewport(from); win.wordHarness.start(); win.wordHarness.show('memorize',1,'learn'); await settle();
      await viewport(to);
      const metrics = collectMetrics();
      record('memory follows viewport reflow', () => aligned(metrics), { box:metrics.box, toolbar:metrics.toolbar, root:metrics.root, actions:metrics.actions });
    }
    for (const font of ['small','mid','big']) {
      current = { viewport:document.getElementById('viewport').value, font };
      doc.querySelector('[data-fs="' + font + '"]').click(); await settle();
      const metrics = collectMetrics();
      record('memory follows the actual font-size control', () => aligned(metrics), { box:metrics.box, toolbar:metrics.toolbar });
    }
    await viewport('390,844'); current = { viewport:'390 × 844',font:'big' };
    win.wordHarness.start(); win.wordHarness.show('memorize'); await settle();
    doc.getElementById('wqNo').click();
    const learned = win.wordHarness.state().phase === 'learn';
    doc.getElementById('wqNext').click();
    const next = win.wordHarness.state().memory === 1 && win.wordHarness.state().phase === 'ask';
    doc.querySelector('[data-step="read"]').click();
    const back = win.wordHarness.state().step === 'read';
    doc.querySelector('.wt-stage-exit').click(); doc.querySelector('[data-g="0"]').click();
    await new Promise(resolve => setTimeout(resolve,1100)); await settle();
    record('not-known, next, back, exit and repeated entry preserve navigation', () => {
      assert(learned && next && back, 'existing phase navigation changed');
      assert(win.wordHarness.state().step === 'read' && win.wordHarness.state().read === 0, 'a stale callback changed the new session');
    }, win.wordHarness.state());
    await viewport('320,640');
    for (const font of ['big','mid','small']) {
      current = { viewport:'320 × 640',font };
      const timeline = await sampleCountdown(font);
      record('real countdown keeps every option text visible at each tick', () => {
        assert(timeline.issues.length === 0, timeline.issues[0] ? JSON.stringify(timeline.issues[0]) : 'countdown text clipping');
      }, timeline);
    }
  } catch (error) {
    record('matrix infrastructure', () => { throw error; });
  } finally {
    const report = { scope:'Actual Chromium iframe DOM geometry with synthetic data and API/audio stubs; not authenticated business UI',version,pass:cases.filter(item=>item.pass).length,fail:cases.filter(item=>!item.pass).length,total:cases.length,
      limits:['Iframe viewport changes are not a physical device or browser zoom test.','Large fixed cards may require vertical scrolling on short landscape viewports.','No server, audio, database or authenticated API integration is tested.'],cases };
    window.wordMatrixReport = report;
    output.textContent=JSON.stringify(report,null,2);
    progress.textContent='完成：'+report.pass+' 通过，'+report.fail+' 失败 / '+report.total;
    controls.forEach(control => { control.disabled = false; });
    runButton.disabled = false;
  }
}
function viewerHtml(before, after) {
  // Both versions need the same safe test snapshot after exiting. Only repair the
  // fixture helper here; the archived pre-change production script/CSS stay intact.
  before = before.replace('read: WT.quick.read.i, memory: WT.quick.mem && WT.quick.mem.i',
    'read: WT.quick.read && WT.quick.read.i, memory: WT.quick.mem && WT.quick.mem.i');
  const versions = JSON.stringify({ before, after }).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'">
<title>T13 Offline Responsive Viewer</title><style>
body{margin:0;padding:12px;font:14px/1.4 sans-serif;background:#eef3f7;color:#15233a}header{display:flex;gap:8px;flex-wrap:wrap;align-items:center}header p{flex-basis:100%;margin:0}button,select{padding:7px 10px;font:inherit}#status{font-weight:700}#frameHolder{position:relative;margin-top:10px;overflow:auto;background:#d8e2ec}iframe{border:0;transform-origin:top left;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:12px;font-size:13px}label{white-space:nowrap}
</style></head><body><header><p>真实前端源码 + 合成数据，纯本页API桩。iframe尺寸是实际CSS视口；缩小预览只改变外观，不改变iframe内部布局。非真实业务UI/设备验收。</p>
<select id="version"><option value="before">修前</option><option value="after" selected>修后</option></select>
<select id="viewport"><option value="390,844">390 × 844</option><option value="320,640">320 × 640</option><option value="768,1024">768 × 1024</option><option value="1440,900">1440 × 900</option><option value="844,390">844 × 390</option></select>
<label><input id="fitPreview" type="checkbox" checked>适应预览</label><button id="measure">测量当前页面</button><button id="runMatrix">一键布局回归</button><button id="runCountdown">倒计时实测（13秒）</button><span id="status"></span><span id="runProgress"></span>
</header><div id="frameHolder"><iframe id="preview" title="T13合成组件"></iframe></div><pre id="metrics">请选择案例，点击正常界面按钮；然后点“测量当前页面”。</pre>
<script>
const versions = ${versions};
const frame = document.getElementById('preview');
function sizeFrame() {
  const [width,height] = document.getElementById('viewport').value.split(',').map(Number);
  frame.style.width=width+'px';frame.style.height=height+'px';
  const scale=document.getElementById('fitPreview').checked?Math.min(1,(innerWidth-24)/width,Math.max(260,innerHeight-150)/height):1;
  frame.style.transform='scale('+scale+')';
  document.getElementById('frameHolder').style.height=Math.ceil(height*scale)+'px';
  document.getElementById('status').textContent=width+' × '+height+'，预览 '+Math.round(scale*100)+'%';
}
function loadVersion() {frame.srcdoc=versions[document.getElementById('version').value];sizeFrame();}
document.getElementById('version').onchange=loadVersion;
document.getElementById('viewport').onchange=sizeFrame;
document.getElementById('fitPreview').onchange=sizeFrame;
window.addEventListener('resize',sizeFrame);
function collectMetrics(){
  const win=frame.contentWindow,doc=frame.contentDocument;
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:+r.x.toFixed(2),y:+r.y.toFixed(2),width:+r.width.toFixed(2),height:+r.height.toFixed(2),bottom:+r.bottom.toFixed(2),right:+r.right.toFixed(2)};};
  const root=doc.querySelector('.wt-root'),card=doc.querySelector('.t13-card');
  const metrics={scope:'纯前端合成组件，不是真实业务UI',version:document.getElementById('version').value,viewport:{width:win.innerWidth,height:win.innerHeight},state:win.wordHarness.state(),toolbar:rect(doc.querySelector('.wt-stage-bar')),box:rect(doc.getElementById('wtQuickBox')),card:rect(card),root:{scrollTop:root.scrollTop,clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,clientHeight:root.clientHeight,scrollHeight:root.scrollHeight},
  actions:[...doc.querySelectorAll('#wqNext,#wqNo,#wqYes,#wtNext,#wqSpk')].map(el=>{const r=el.getBoundingClientRect(),hit=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {id:el.id,rect:rect(el),insideViewport:r.left>=0&&r.top>=0&&r.right<=win.innerWidth&&r.bottom<=win.innerHeight,centerHittable:!!hit&&(hit===el||el.contains(hit))};}),
  regions:[...doc.querySelectorAll('.t13-card .wq-word,.t13-card .wq-phon,.t13-card .wq-mean,.t13-card .wt-opt')].map(el=>{const style=win.getComputedStyle(el),range=doc.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();const box=el.getBoundingClientRect();return {className:el.className,content:el.textContent.trim(),rect:rect(el),clip:{x:box.x+el.clientLeft,y:box.y+el.clientTop,right:box.x+el.clientLeft+el.clientWidth,bottom:box.y+el.clientTop+el.clientHeight},inlineFontSize:el.style.fontSize,transitionProperty:style.transitionProperty,fontSize:style.fontSize,visibility:style.visibility,overflowX:style.overflowX,overflowY:style.overflowY,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,text:{x:+text.x.toFixed(2),y:+text.y.toFixed(2),width:+text.width.toFixed(2),height:+text.height.toFixed(2)},ink:measureTextInk(el)};})};
  return metrics;
}
document.getElementById('measure').onclick=()=>{document.getElementById('metrics').textContent=JSON.stringify(collectMetrics(),null,2);};
${textClipIssue.toString()}
${alignmentIssue.toString()}
${glyphInkBounds.toString()}
${measureTextInk.toString()}
${sampleCountdown.toString()}
${runCountdownProbe.toString()}
${runInlineMatrix.toString()}
document.getElementById('runMatrix').onclick=runInlineMatrix;
document.getElementById('runCountdown').onclick=runCountdownProbe;
loadVersion();
</script></body></html>`;
}
if (process.argv.includes('--viewer')) {
  const file = process.argv[process.argv.indexOf('--viewer') + 1];
  const beforeArg = process.argv.indexOf('--before');
  if (!file || beforeArg < 0 || !process.argv[beforeArg + 1]) throw new Error('--viewer <file> requires --before <pre-change fixture>');
  fs.writeFileSync(file, viewerHtml(fs.readFileSync(process.argv[beforeArg + 1], 'utf8'), harnessHtml()));
  console.log(`Synthetic offline responsive viewer written: ${file}`);
} else if (process.argv.includes('--fixture')) {
  const file = process.argv[process.argv.indexOf('--fixture') + 1];
  if (!file) throw new Error('--fixture requires an output HTML file');
  fs.writeFileSync(file, harnessHtml()); console.log(`Synthetic offline component fixture written: ${file}`);
} else if (process.argv.includes('--browser')) {
  runBrowser().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else runNode();
