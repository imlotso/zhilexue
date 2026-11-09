'use strict';
// Runs the real iframe applications against synthetic, loopback-only roster data.
// No production server, database, credentials or external network is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
let browser, server, origin;
const publicRoot = path.join(__dirname, 'public');
const evidence = process.env.SENYU_EVIDENCE_DIR;
const roster = { role: 'admin', branches: [{ id: 1, name: '测试校区' }], students: [
  { id: 101, name: '测试学生甲', grade: '七年级', stage: 'junior', created_by: 1, branch_name: '测试校区' },
  { id: 102, name: '测试学生乙', grade: '七年级', stage: 'junior', created_by: 1, branch_name: '测试校区' }
] };
before(async () => {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/me') return res.end(JSON.stringify({ code: 0, data: { id: 901, role: 'admin', name: '合成测试账号' } }));
      if (pathname === '/api/admin/grades-roster') return res.end(JSON.stringify({ code: 0, data: roster }));
      res.statusCode = 503; return res.end(JSON.stringify({ code: 1, msg: '合成上传失败，请重试' }));
    }
    const target = path.resolve(publicRoot, '.' + pathname);
    if (!target.startsWith(publicRoot + path.sep)) { res.statusCode = 403; return res.end(); }
    try {
      const file = fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target;
      const ext = path.extname(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch (_) { res.statusCode = 404; res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function open(app, hash, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 } });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem('xuexi_admin_token', 'senyu-synthetic-test-only'));
  await page.goto(origin + '/apps/' + app + '/index.html#/' + hash);
  await page.waitForSelector(app === 'care' ? '#careWorkbench:not([hidden])' : '#mainView > *');
  return page;
}
async function shot(page, name) { if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true }); }
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'page must not overflow the viewport'); }
async function seedGrades(page) {
  await page.evaluate(() => {
    const a = Store.addExam({ name: '测试月考一', date: '2026-09-01', type: '月考' });
    const b = Store.addExam({ name: '测试月考二', date: '2026-10-01', type: '月考' });
    Store.addRecords([a, b].flatMap((e, n) => Array.from({ length: 13 }, (_, i) => ({ examId: e.id, studentName: '测试学生' + String(i + 1).padStart(2, '0'), stage: '初中·七年级', grade: '七年级', className: '测试班', subject: '数学', fullScore: 100, score: 60 + i + n * 5, classRank: 20 - i - n, gradeRank: 40 - i - n, type: '月考', date: e.date, comment: '合成测试评语' }))));
    App.refresh();
  });
}

test('both iframe documents render the approved palette and remain usable at desktop and narrow widths', async () => {
  for (const width of [1440, 1024, 390]) for (const [app, route] of [['grades', 'dashboard'], ['care', 'talks'], ['care', 'contacts']]) {
    const page = await open(app, route, width);
    try {
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(248, 247, 242)');
      await noOverflow(page);
      if (app === 'grades') assert.equal(await page.locator('#btnPrintPage').isVisible(), true, 'standalone print remains reachable at every width');
      const action = page.locator(app === 'grades' ? '#goImport' : route === 'talks' ? '#tkAdd' : '#ctAdd');
      assert.equal(await action.evaluate(e => getComputedStyle(e).color), 'rgb(20, 58, 51)');
      assert.ok((await action.boundingBox()).height >= 44);
      await shot(page, app + '-' + route + '-' + width);
    } finally { await page.close(); }
  }
});

test('care student picker works with keyboard, validates inline, preserves records, filters and exports', async () => {
  const page = await open('care', 'talks');
  try {
    await page.locator('#tkAdd').click();
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    assert.equal(await page.locator('#fStuSlot input').getAttribute('aria-invalid'), 'true');
    await page.locator('#fStuSlot input').fill('测试学生乙');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#fStuSlot input').inputValue(), '测试学生乙');
    await page.locator('#fContent').fill('用于界面验证的合成谈话内容');
    await page.locator('#fFollowNote').fill('用于验证的跟进事项');
    await shot(page, 'care-talk-form');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await page.waitForSelector('#tkBody tr');
    assert.equal(await page.locator('#tkBody tr').count(), 1);
    await page.reload(); await page.waitForSelector('#tkBody tr');
    assert.match(await page.locator('#tkBody').innerText(), /测试学生乙/);
    await page.locator('#tkStudent').fill('不匹配的学生');
    await page.waitForTimeout(260);
    assert.match(await page.locator('#tkEmpty').innerText(), /未找到.*筛选/);
    await page.locator('#tkReset').click();
    assert.equal(await page.locator('#tkBody tr').count(), 1);
    const download = page.waitForEvent('download'); await page.locator('#tkXlsx').click();
    assert.match((await download).suggestedFilename(), /\.xlsx$/);
    await page.evaluate(() => { window.print = () => { window.__printed = document.getElementById('printRoot').textContent; }; });
    await page.locator('#tkPdf').click(); await page.waitForFunction(() => window.__printed);
    assert.match(await page.evaluate(() => window.__printed), /用于界面验证的合成谈话内容/);
    await page.locator('[data-view]').click();
    assert.match(await page.locator('.modal-body').innerText(), /用于验证的跟进事项/);
    await shot(page, 'care-talk-detail');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mask').count(), 0);
  } finally { await page.close(); }
});

test('care and grades dialogs trap keyboard focus and return it on dismissal', async () => {
  for (const app of ['care', 'grades']) {
    const page = await open(app, app === 'care' ? 'contacts' : 'records', 390);
    try {
      const trigger = app === 'care' ? '#ctAdd' : '#ibManual';
      await page.locator(trigger).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate(e => e.contains(document.activeElement)), true);
      await noOverflow(page); await shot(page, app + '-dialog-mobile');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator(trigger).evaluate(e => e === document.activeElement), true);
      await page.locator(trigger).click(); await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').isVisible(), false);
    } finally { await page.close(); }
  }
});

test('care async actions stay open while saving, block repeated clicks and retain drafts on failure', async () => {
  const page = await open('care', 'talks');
  try {
    await page.evaluate(() => {
      window.__calls = 0;
      App.ui.modal({ title: '测试异步保存', bodyHTML: '<input id="draft" value="保留草稿">', buttons: [{ text: '测试保存', cls: 'btn btn-primary', onClick() { window.__calls++; return new Promise((resolve, reject) => { window.__reject = reject; }); } }] });
    });
    await page.getByRole('button', { name: '测试保存' }).click();
    assert.equal(await page.locator('.modal-foot button').isDisabled(), true);
    assert.equal(await page.locator('.modal-foot button').getAttribute('aria-busy'), 'true');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#draft').isVisible(), true);
    await page.evaluate(() => window.__reject(new Error('合成保存失败')));
    await page.waitForFunction(() => !document.querySelector('.modal-foot button').disabled);
    assert.equal(await page.locator('#draft').inputValue(), '保留草稿');
    assert.equal(await page.evaluate(() => window.__calls), 1);
    await page.keyboard.press('Escape');
  } finally { await page.close(); }
});

test('grades retain filtering, 10/20/30 pagination, details, compare routes and profile charts', async () => {
  const page = await open('grades', 'records');
  try {
    await seedGrades(page);
    assert.equal(await page.locator('#listCard tbody tr[data-key]').count(), 10);
    const size = page.locator('#pgSize');
    await size.selectOption('20'); assert.equal(await page.locator('#listCard tbody tr[data-key]').count(), 20);
    await size.selectOption('30'); assert.equal(await page.locator('#listCard tbody tr[data-key]').count(), 26);
    await page.locator('#fq').fill('测试学生01'); await page.waitForTimeout(400);
    assert.equal(await page.locator('#listCard tbody tr[data-key]').count(), 2);
    await page.locator('#btnReset').click();
    await page.locator('#listCard tbody tr[data-key]').first().click();
    assert.equal(await page.locator('.detail-box').count(), 1);
    await shot(page, 'grades-records-detail');
    for (const route of ['dashboard', 'tracking', 'students']) {
      await page.evaluate(hash => { location.hash = '#/' + hash; }, route);
      await page.waitForTimeout(120); await noOverflow(page); await shot(page, 'grades-' + route + '-data');
    }
    await page.locator('[data-go]').first().click(); await page.waitForSelector('canvas');
    assert.equal(await page.evaluate(() => Chart.getChart(document.querySelector('canvas')).data.datasets[0].borderColor), '#0C594B');
    await shot(page, 'grades-profile');
    await page.goBack(); await page.waitForSelector('#sq');
  } finally { await page.close(); }
});
