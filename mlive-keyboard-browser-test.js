'use strict';

// Browser-only regression. No application bootstrap, backend, config, Auth or DB.
// Run: node mlive-keyboard-browser-test.js
// Optional: PLAYWRIGHT_PACKAGE_JSON=/path/to/package.json CHROMIUM_PATH=/path/to/chrome
//           FORMULA_EVIDENCE_DIR=/path/to/output
// Removing MLive's empty-input focus restoration must make all four cases fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = __dirname;
const output = path.resolve(process.env.FORMULA_EVIDENCE_DIR || path.join(root, 'formula-keyboard-evidence', 'regression'));
fs.mkdirSync(output, { recursive: true });
// Keep browser scratch files in the checkout. Short path avoids Unix socket limits.
const scratch = path.join(root, 'fktmp');
fs.mkdirSync(scratch, { recursive: true });
process.env.TMPDIR = scratch;
const dependencyRequire = process.env.PLAYWRIGHT_PACKAGE_JSON
  ? createRequire(path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON)) : require;
const { chromium } = dependencyRequire('playwright');
const appCSS = ['/css/app.css', '/css/ali-icons.css', '/vendor/element-ui.css', '/css/ruoyi.css'];
const styles = {
  admin: [...appCSS, '/admin/theme.css', '/admin/r3.css', '/admin/ktree.css', '/admin/intake-center.css', '/admin/intake-skill.css', '/admin/intake-teacher.css', '/admin/intake-manual.css', '/admin/r6-compose.css', '/admin/ui-review-20261108.css'],
  student: [...appCSS, '/css/ui-learning-20261108.css', '/css/ui-quiz-20261108.css'],
};
// Execute the real standalone dialog manager, but not the API/Auth definitions.
const utilities = fs.readFileSync(path.join(root, 'public/js/api.js'), 'utf8');
const start = utilities.indexOf('const DialogUX =');
const end = utilities.indexOf('/** Element UI 风格弹窗', start);
assert.ok(start >= 0 && end > start, 'Standalone DialogUX declaration must exist');
const dialogUX = utilities.slice(start, end);
function html(mode) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" href="data:,">
    ${styles[mode].map(url => `<link rel="stylesheet" href="${url}">`).join('')}
    </head><body class="${mode === 'admin' ? 't11' : ''}"><main style="padding:24px"><h1>公式键盘空输入回归</h1>
    <textarea id="answer">前后</textarea><button id="open">公式</button></main>
    <script>${dialogUX}</script><script src="/js/mlive.js"></script><script>
    window.results = []; window.inputEvents = 0;
    document.getElementById('answer').addEventListener('input', () => inputEvents++);
    document.getElementById('open').onclick = () => MLive.dialog({
      delimit: ${mode === 'admin'},
      onOk: (text, latex) => {
        results.push({text, latex});
        MLive.insertAt(document.getElementById('answer'), text);
      }
    });
    </script></body></html>`;
}
const requested = [], unexpected = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requested.push({method: req.method, path: url.pathname});
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(html(url.searchParams.get('mode') === 'student' ? 'student' : 'admin'));
    return;
  }
  // Serve only explicitly required public CSS, MathLive assets and mlive.js.
  const allowed = url.pathname === '/js/mlive.js'
    || Object.values(styles).flat().includes(url.pathname)
    || /^\/vendor\/mathlive\/(mathlive\.min\.js|fonts\/[\w-]+\.woff2)$/.test(url.pathname)
    || /^\/(css|vendor)\/fonts\/[\w.-]+\.(woff2?|ttf)$/.test(url.pathname);
  const file = path.resolve(root, 'public', '.' + url.pathname);
  if (!allowed || !file.startsWith(path.join(root, 'public') + '/')) {
    unexpected.push(url.pathname); res.writeHead(404); res.end(); return;
  }
  try {
    const content = fs.readFileSync(file);
    const types = {'.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'};
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(content);
  } catch (error) { unexpected.push(url.pathname); res.writeHead(404); res.end(); }
});
const cases = [];
async function runCase(browser, origin, mode, width) {
  const name = `${mode}-${width}`;
  const result = {name, width, height: width === 390 ? 844 : 900, pageErrors: [], externalRequests: []};
  cases.push(result);
  const context = await browser.newContext({viewport: {width, height: result.height}});
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    result.externalRequests.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  const key = value => page.locator('.MLK__layer.is-visible [data-keycap-value=' + JSON.stringify(value) + ']');
  try {
    await page.goto(`${origin}/?mode=${mode}`);
    await page.locator('#answer').evaluate(el => el.setSelectionRange(1, 1));
    await page.locator('#open').click();
    await page.waitForFunction(() => window.mathVirtualKeyboard?.visible);
    await page.locator('.t8-ok').click();
    assert.equal(await page.locator('.t8-tip').textContent(), '还没有输入公式');
    assert.equal(await page.evaluate(() => results.length), 0);
    // MathLive reconnects its keyboard asynchronously after focus (60ms internally).
    // Wait for real DOM focus, without clicking or otherwise focusing the field.
    await page.waitForFunction(() => document.activeElement.tagName === 'MATH-FIELD');
    result.focusAfterValidation = await page.evaluate(() => document.activeElement.tagName);
    // Real pointer clicks only: no fill(), setValue(), insert() or synthetic events.
    await key('1').click();
    await key('\\frac{#@}{#?}').click();
    await key('2').click();
    result.latex = await page.locator('.t8-mf').evaluate(el => el.getValue('latex'));
    await page.screenshot({path: path.join(output, `${name}-after-empty-insert.png`), fullPage: true});
    assert.equal(result.latex, '\\frac12', 'Screen keyboard must work immediately after empty Insert');
    assert.equal(result.focusAfterValidation, 'MATH-FIELD', 'Empty validation must return focus to the formula');
    await page.locator('.t8-ok').click();
    await page.waitForFunction(() => !document.querySelector('.t8-mask'));
    const actual = await page.evaluate(() => ({results, inputEvents, value: document.getElementById('answer').value, visible: mathVirtualKeyboard.visible}));
    const text = mode === 'admin' ? '\\(\\frac12\\)' : '\\frac12';
    assert.deepEqual(actual.results, [{text, latex: '\\frac12'}]);
    assert.equal(actual.value, '前' + text + '后');
    assert.equal(actual.inputEvents, 1);
    assert.equal(actual.visible, false);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.externalRequests, []);
    result.status = 'passed';
    console.log(`PASS ${name}: empty Insert → screen fraction → insert`);
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    await page.screenshot({path: path.join(output, `${name}-failure.png`), fullPage: true});
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || process.env.CHROME_BIN || undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    for (const mode of ['admin', 'student']) {
      for (const width of [390, 1440]) await runCase(browser, origin, mode, width);
    }
    const passed = cases.every(item => item.status === 'passed') && unexpected.length === 0;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({passed, browser: browser.version(), cases, requested, unexpected}, null, 2));
    console.log(`${cases.filter(item => item.status === 'passed').length}/${cases.length} passed; unexpected static requests: ${unexpected.length}`);
    if (!passed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
