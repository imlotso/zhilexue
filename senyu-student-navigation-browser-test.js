'use strict';
// Real browser geometry against production assets with synthetic transport only.
// This suite must be run in a permitted browser environment before visual sign-off.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const publicRoot = path.join(__dirname, 'public');
const fixtureRoot = path.join(__dirname, 'test/fixtures/ui-learning');
const entry = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const styles = (entry.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || []).join('\n').replace(/href="\.\//g, 'href="/');
const html = fs.readFileSync(path.join(fixtureRoot, 'learning-live.html'), 'utf8')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-ui-theme="senyu">')
  .replace('<body>', '<body class="sy-theme sy-core">')
  .replace('</head>', styles + '</head>')
  .replace('</body>', '<script src="/js/senyu-controls.js"></script></body>');
let server, browser, origin;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/fixtures/learning-live.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
    const fixture = url.pathname.startsWith('/fixtures/');
    const base = fixture ? fixtureRoot : publicRoot;
    const file = path.resolve(base, fixture ? url.pathname.slice(10) : url.pathname.slice(1));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
for (const width of [1440, 1024, 390]) test('student drawer uses one navigation scale at ' + width, async () => {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(origin + '/fixtures/learning-live.html');
    await page.locator('#learnHeroTitle').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const open = async () => { await page.locator('.learn-menu').click(); await page.waitForFunction(() => document.querySelector('.st-side').getBoundingClientRect().left >= -1); };
    await open();
    await page.locator('.round-drawer-close').click();
    await page.waitForFunction(() => !window.__stuVm.mobileNavOpen && document.activeElement === document.querySelector('.learn-menu'));
    assert.equal(await page.locator('.st-side').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.st-side').evaluate(side => side.inert && getComputedStyle(side).visibility === 'hidden'), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.st-side')), false, 'closed drawer is skipped by Tab');
    await open();
    assert.equal(await page.locator('.learn-tools[aria-label="学习工具"] .sy-student-nav-label').textContent(), '学习工具');
    const metrics = await page.locator('.st-side nav a').evaluateAll(links => links.map(link => {
      const s = getComputedStyle(link), icon = link.querySelector('.ai'), text = link.querySelector('.nt');
      return { label: text.textContent, font: s.fontSize, height: link.getBoundingClientRect().height, minHeight: s.minHeight, gap: s.gap, padding: s.padding, iconWidth: icon.getBoundingClientRect().width, iconHeight: icon.getBoundingClientRect().height, textLeft: text.getBoundingClientRect().left, color: s.color, weight: s.fontWeight, selected: link.classList.contains('on') };
    }));
    assert.equal(metrics.length, 9);
    for (const row of metrics) {
      assert.equal(row.font, '18px', row.label); assert.equal(row.minHeight, '48px', row.label); assert.ok(row.height >= 48, row.label);
      assert.equal(row.gap, '12px'); assert.equal(row.padding, '10px 14px'); assert.equal(row.iconWidth, 24); assert.equal(row.iconHeight, 24);
      assert.ok(Math.abs(row.textLeft - metrics[0].textLeft) < 1, 'shared text alignment: ' + row.label);
    }
    const paper = metrics.find(row => row.label === '试卷');
    for (const label of ['速记训练', '专注计时']) { const row = metrics.find(item => item.label === label); assert.equal(row.color, paper.color); assert.equal(row.weight, paper.weight); }
    const timer = page.locator('.learn-tools a[href="#/timer"]');
    for (const theme of ['day', 'green', 'eye']) {
      await page.mouse.move(width - 1, 1);
      await page.evaluate(theme => window.__stuVm.pickTheme(theme), theme);
      await timer.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.learn-tools a[href="#/timer"]')).backgroundColor === 'rgb(213, 227, 219)');
      const hover = await timer.evaluate(link => getComputedStyle(link).backgroundColor);
      assert.notEqual(hover, await page.locator('.st-side').evaluate(side => getComputedStyle(side).backgroundColor), theme + ' hover differs from the drawer');
    }
    await page.mouse.move(width - 1, 1);
    await page.locator('.learn-tools a[href="#/words/quick"]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await timer.evaluate(link => document.activeElement === link && link.matches(':focus-visible')), true);
    assert.equal(await timer.evaluate(link => getComputedStyle(link).outlineWidth), '2px');
    if (process.env.SENYU_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.SENYU_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SENYU_EVIDENCE_DIR, 'student-navigation-' + width + '.png'), fullPage: true });
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/timer' && !window.__stuVm.mobileNavOpen && document.activeElement === document.querySelector('.learn-menu'));
    await page.frameLocator('.tool-frame').locator('#btnStart').waitFor({ state: 'visible' });
    assert.equal(await page.frameLocator('.tool-frame').locator('#clock').textContent(), '25:00');
    await open();
    assert.equal(await timer.getAttribute('aria-current'), 'page');
    await timer.click();
    await page.waitForFunction(() => !window.__stuVm.mobileNavOpen && document.activeElement === document.querySelector('.learn-menu'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  } finally { await page.close(); }
});
