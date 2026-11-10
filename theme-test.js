'use strict';
/**
 * 后台 UI 统一（T11）自测： node theme-test.js
 * 无服务 / 无浏览器：node theme-test.js --ui-only（样式作用域 + 真实后台 DOM；不验证浏览器布局）。
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed。
 * 静态检查：theme.css 在通用样式之后加载，后置页面样式只影响各自页面；主题规则全部挂在 body.t11 下、菜单按任务书分组，
 *           AI 配置中心在「系统设置」下、待审核题目在「智能题库」下并带角标。
 * 有浏览器时（Playwright）：桌面和手机宽度下后台主要页面都不横向撑破页面；手机宽度侧栏是抽屉（点三道杠开、点遮罩关、点菜单换页后自动关）；
 *           待审核角标有数字时显示；首页有「快捷操作」和「最近开通」。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const UI_ONLY = process.argv.includes('--ui-only');
const MENU_GROUPS = '工作台/学生与账号/教学资源/智能题库/学情与报告/系统设置';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

// Commas inside :is(), :has() or attribute values are not selector boundaries.
function splitSelectors(value) {
  const selectors = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) { selectors.push(value.slice(start, i).trim()); start = i + 1; }
  }
  selectors.push(value.slice(start).trim());
  return selectors.filter(Boolean);
}

async function checkAdminDom(html) {
  const { JSDOM } = require('jsdom');
  const vm = require('vm');
  const dom = new JSDOM(html, { url: 'http://ui.invalid/admin/#/students', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  const account = { id: 1, role: 'admin', name: '合成管理员' };
  const unexpected = [], errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.STORAGE_PREFIX = 'theme_test';
  w.localStorage.setItem('theme_test_token', 'synthetic');
  w.localStorage.setItem('theme_test_user', JSON.stringify(account));
  // Only transport is replaced: production api.js, admin boot, shell and student view run unchanged.
  w.fetch = async url => {
    const key = String(url).split('?')[0];
    const routes = { '/api/me': account, '/api/admin/chapters': [], '/api/admin/sections': [],
      '/api/admin/students': { list: [], total: 0, page: 1, size: 10 }, '/api/admin/bank/mf/ext/badge-counts': { pending: 7 } };
    if (!Object.hasOwn(routes, key)) { unexpected.push(key); throw new Error('Unexpected UI request: ' + key); }
    return { ok: true, status: 200, json: async () => ({ code: 0, data: routes[key] }) };
  };
  try {
    for (const file of ['public/js/api.js', 'public/admin/admin.js']) vm.runInContext(read(file), dom.getInternalVMContext(), { filename: file });
    for (let i = 0; i < 20 && !d.getElementById('btnAdd'); i++) await new Promise(setImmediate);
    const names = [...d.querySelectorAll('.nav .nav-group .ng-t .txt, .nav .nav-leaf .txt')].map(e => e.textContent.trim()).join('/');
    log(names === MENU_GROUPS, '真实后台 DOM：工作台和五组菜单按顺序呈现', names);
    log(['btnAdd', 'btnBatch', 'sKw'].every(id => d.getElementById(id)) && !!d.querySelector('.admin-app.ui-rounded-shell'), '真实后台 DOM：圆角外壳和学生页主按钮 / 次按钮 / 输入框保留');
    const badge = d.getElementById('t11BadgePending');
    log(!!badge && !badge.hidden && badge.textContent === '7', '真实后台 DOM：待审核角标显示接口返回的 7 题');
    w.matchMedia = () => ({ matches: true });
    d.getElementById('btnFold').click();
    const opened = d.querySelector('.admin-app').classList.contains('t11-drawer');
    d.getElementById('t11Scrim').click();
    log(opened && !d.querySelector('.admin-app').classList.contains('t11-drawer'), '真实后台 DOM：手机菜单按钮打开抽屉，遮罩关闭抽屉');
    log(errors.length === 0 && unexpected.length === 0 && !d.querySelector('.r10-page-error'), '真实后台 DOM：没有脚本错误或未约定的接口请求', errors.concat(unexpected).join(' | '));
  } finally { w.close(); }
}

(async () => {
  console.log('\n=== 后台 UI 统一（T11）· 自测 ===\n');
  const html = read('public/admin/index.html');
  const css = read('public/admin/theme.css');
  const admin = read('public/admin/admin.js');

  // ---------- 1) theme.css 的加载与作用范围 ----------
  const { JSDOM } = require('jsdom');
  const document = new JSDOM(html).window.document;
  const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map(el => el.getAttribute('href').split('?')[0]);
  document.defaultView.close();
  // Only the approved 2026-11-08 theme layers may override shared theme styles.
  const pageStyles = {
    './r3.css': /^(?:(?:body\.t11\s+(?:\.admin-app\s+)?)?\.(?:r3|qc|qb)-[\w-]+\b|body\.t11\s+\.admin-app\s+#view\.r3-fab-gutter\b)/,
    './ktree.css': /^(?:body\.t11\s+)?\.kt-[\w-]+\b/,
    './intake-center.css': /^(?:body\.t11\s+)?\.(?:r4|pd)-[\w-]+\b/,
    './intake-skill.css': /^(?:body\.t11\s+)?\.(?:r4|r4s)-[\w-]+\b/,
    './intake-teacher.css': /^(?:body\.t11\s+)?\.rt-[\w-]+\b/,
    './intake-manual.css': /^(?:body\.t11\s+)?\.(?:r4|r4m)-[\w-]+\b/,
    './r6-compose.css': /^(?:body\.t11\s+)?\.(?:r6|pp)-[\w-]+\b/,
    './r10.css': /^(?:body\.t11\s+)?\.r10-[\w-]+\b/,
    './ui-review-20261108.css': /^(?:body\.t11\s+\.ui-review-shell\b|\.(?:pd|r4)-[\w-]+\b)/,
    './ui-rounded-shell-20261108.css': /^body\.t11(?:$|\s+(?:\.admin-app\.ui-rounded-shell\b|\.rounded-[\w-]+\b))/,
    './ui-rounded-pages-20261108.css': /^body\.t11(?:\s+(?:\.(?:pd|r6|r4|r1|t8|r10)-[\w-]+\b|\.ui-review-shell\b|\.admin-app(?:\.ui-rounded-shell\.ui-review-shell|\s+\.r6-rounded-(?:grid|page)\b|\s+#view\.r3-fab-gutter:has\(\.r6-rounded-page\))|:is\(\.r6-rounded-page,\.r4-intake,\.r1-rounded-report\))|:has\(\.r6-rounded-page\)\s+\.r3-fab\b)/,
  };
  const themeIndex = hrefs.indexOf('./theme.css');
  const afterTheme = hrefs.slice(themeIndex + 1);
  log(themeIndex > 0 && hrefs.lastIndexOf('./theme.css') === themeIndex && afterTheme.every(h => pageStyles[h]), 'theme.css 在基础样式之后，后置样式仅限页面组件和已批准的主题覆盖', hrefs.join(' → '));
  const approved = ['./ui-review-20261108.css', './ui-rounded-shell-20261108.css', './ui-rounded-pages-20261108.css'];
  log(afterTheme.slice(-3).join('|') === approved.join('|') && approved.every(h => hrefs.filter(x => x === h).length === 1), '已批准覆盖按 review → rounded-shell → rounded-pages 加载且不重复');
  const unscoped = [];
  afterTheme.filter(h => pageStyles[h]).forEach(h => {
    const pageCss = read('public/admin/' + h.slice(2)).replace(/\/\*[\s\S]*?\*\//g, '');
    pageCss.replace(/(^|[}{])\s*([^{}@]+)\{/g, (_, pre, sel) => {
      splitSelectors(sel).forEach(s => { if (!pageStyles[h].test(s)) unscoped.push(`${h}: ${s}`); });
      return '';
    });
  });
  log(unscoped.length === 0, '后置选择器均限定在对应组件或 body.t11 圆角外壳内', unscoped.slice(0, 3).join(' | '));
  log(/<body class="t11">/.test(html), '<body> 带 t11 类（去掉它就退回旧样式）');
  if (!UI_ONLY) {
    const res = await fetch(BASE + '/admin/theme.css');
    log(res.status === 200 && (await res.text()).includes('--t11-primary'), '服务器能取到 theme.css');
  }
  // 规则全部挂在 body.t11 下：去掉注释和 @media 外壳后，每个选择器都以 body.t11 开头（:root 之类全局规则不允许）
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  flat.replace(/(^|[}{])\s*([^{}@]+)\{/g, (_, pre, sel) => { sel.split(',').forEach((s) => { s = s.trim(); if (s) selectors.push(s); }); return ''; });
  const stray = selectors.filter((s) => !/^body\.t11[\s.:#\[{]|^body\.t11$/.test(s));
  log(selectors.length > 100 && stray.length === 0, `theme.css 的 ${selectors.length} 个选择器全部挂在 body.t11 下，不改旧选择器`, stray.slice(0, 3).join(' | '));
  const newClasses = [...new Set([...flat.matchAll(/\.(t11-[a-z0-9-]+)/g)].map((m) => m[1]))];
  log(newClasses.length > 0, '新增的类名都以 t11- 开头', newClasses.join(' '));
  log(/--t11-primary:/.test(css) && /--t11-r:/.test(css) && /--t11-h:/.test(css) && /--t11-gap:/.test(css) && /--t11-fs:/.test(css), '用 CSS 变量统一：主色、圆角、控件高度、间距、字号');
  ['.btn.ghost', '.btn.danger', 'select', 'table th', '.tag.ok', '.el-dialog__footer.modal-f', '.stat'].forEach((k) => {
    log(css.includes(k), `覆盖到：${k}`);
  });

  // ---------- 2) 菜单分组 ----------
  const groupsSrc = admin.slice(admin.indexOf('const NAV_GROUPS = ['), admin.indexOf('];', admin.indexOf('const NAV_GROUPS = [')));
  const groups = [...groupsSrc.matchAll(/\{ k: '([^']+)', t: '([^']+)'[^}]*?(?:items: \[([^\]]*)\]|leaf: '([^']+)')/g)].map((m) => ({ k: m[1], t: m[2], items: (m[3] || m[4] || '').replace(/'/g, '').split(',').map((s) => s.trim()).filter(Boolean) }));
  log(groups.map((g) => g.t).join('/') === MENU_GROUPS, '左侧菜单：工作台 + 学生与账号 / 教学资源 / 智能题库 / 学情与报告 / 系统设置', groups.map((g) => g.t).join('/'));
  const of = (t) => (groups.find((g) => g.t === t) || { items: [] }).items;
  log(of('学生与账号').join(',') === 'branches,students,xreport', '「学生与账号」：分校管理 / 学生管理 / 学习报告（R1）', of('学生与账号').join(','));
  log(of('学情与报告').join(',') === 'grades,talks,care,aireport', '「学情与报告」：成绩管理 / 谈心谈话 / 家校沟通 / AI 学情诊断（R1，「知识点正确率」已并入习题学习报告）', of('学情与报告').join(','));
  log(of('系统设置').includes('mfset'), '「AI 配置中心」在「系统设置」下');
  log(of('智能题库').includes('pending') && of('智能题库').includes('mfq'), '「待审核题目」在「智能题库」下');
  log(/id="t11BadgePending"/.test(admin) && /ext\/badge-counts/.test(admin), '「待审核题目」菜单带角标（取 ext/badge-counts）');
  const navKeys = [...admin.matchAll(/\{ k: '([a-z0-9]+)', t: '[^']+', i: '[a-z0-9]+'(?:, principalOnly: true)? \}/g)].map((m) => m[1]);
  const grouped = new Set(groups.flatMap((g) => g.items));
  const orphan = navKeys.filter((k) => !grouped.has(k) && !['mfc', 'mfi', 'bkfb'].includes(k));
  log(orphan.length === 0, '每个菜单项都归了组（网络采集 / 录题上传 / 错题反馈从题库管理页进入）', orphan.join(','));

  await checkAdminDom(html);
  if (UI_ONLY) {
    console.log('  ⏭  --ui-only 不验证服务端资源、浏览器尺寸与页面溢出');
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
    return;
  }

  // ---------- 3) 有浏览器时：真的打开看 ----------
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] }); } catch (e) { browser = null; } }
  if (!browser) {
    console.log('  ⏭  没有可用的浏览器（Playwright），跳过页面检查');
  } else {
    const errs = [];
    try {
      const open = async (w, h) => {
        const p = await browser.newPage({ viewport: { width: w, height: h } });
        p.on('pageerror', (e) => errs.push(e.message));
        await p.goto(BASE + '/admin/'); await p.fill('input[type=text],input:not([type])', 'zlx-ci-admin'); await p.fill('input[type=password]', '123456'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
        return p;
      };
      const pages = ['dash', 'students', 'xreport', 'mfq', 'pending', 'videos', 'mfset', 'acc', 'chapters', 'words']; // acc：旧路由，会跳转到 #/xreport
      for (const [w, h, label] of [[1300, 900, '桌面'], [390, 800, '手机']]) {
        const p = await open(w, h);
        const bad = [];
        for (const k of pages) {
          await p.goto(BASE + '/admin/#/' + k); await p.waitForTimeout(900);
          const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (ov > 1) bad.push(k + '+' + ov);
        }
        log(bad.length === 0, `${label}宽度（${w}px）：${pages.length} 个主要页面都不横向撑破页面`, bad.join(' '));
        if (w === 1300) {
          await p.goto(BASE + '/admin/#/dash'); await p.waitForSelector('.r10-quick', { timeout: 6000 });
          log(await p.$$eval('.r10-quick button', (e) => e.length) >= 4 && (await p.$$eval('.r10-metrics .r10-metric', (e) => e.length)) === 5, '首页：学习指标数据卡片 + 快捷操作');
          await p.goto(BASE + '/admin/#/students'); await p.waitForSelector('#btnAdd'); await p.waitForTimeout(500);
          const cs = await p.evaluate(() => { const b = document.getElementById('btnAdd'); const i = document.getElementById('sKw'); const g = document.getElementById('btnBatch'); const c = (e) => e && { r: getComputedStyle(e).borderRadius, h: getComputedStyle(e).height }; return { primary: c(b), ghost: c(g), input: c(i) }; });
          const radii = { primary: '24px', ghost: '14px', input: '13px' };
          log(Object.keys(radii).every((k) => cs[k] && cs[k].r === radii[k] && cs[k].h === '40px'), '圆角主题：主按钮 24px / 次按钮 14px / 输入框 13px，高度均 40px', JSON.stringify(cs));
          const groupsOnPage = await p.$$eval('.nav .nav-group .ng-t .txt, .nav .nav-leaf .txt', (e) => e.map((x) => x.textContent.trim()).join('/'));
          log(groupsOnPage === MENU_GROUPS, '页面上的菜单分组', groupsOnPage);
          await p.goto(BASE + '/admin/#/mfq'); await p.waitForSelector('.nav-group.open .ng-sub'); await p.waitForTimeout(800);
          const badge = await p.evaluate(() => { const b = document.getElementById('t11BadgePending'); return b ? { hidden: b.hidden, text: b.textContent } : null; });
          log(!!badge && (badge.hidden ? badge.text === '' : /^\d+\+?$/.test(badge.text)), '待审核题目角标：没有待审核题时隐藏，有就显示数字', JSON.stringify(badge));
        } else {
          const st = () => p.evaluate(() => ({ left: Math.round(document.querySelector('.admin-app .side').getBoundingClientRect().left), open: document.querySelector('.admin-app').classList.contains('t11-drawer') }));
          await p.goto(BASE + '/admin/#/dash'); await p.waitForTimeout(900);
          const s0 = await st(); await p.click('#btnFold'); await p.waitForTimeout(350); const s1 = await st();
          log(s0.left < 0 && !s0.open && s1.left === 0 && s1.open, '手机：侧栏默认收起，点三道杠滑出抽屉', JSON.stringify([s0, s1]));
          await p.click('#t11Scrim', { position: { x: 370, y: 400 } }); await p.waitForTimeout(350);
          log((await st()).left < 0, '手机：点遮罩收起抽屉');
          await p.click('#btnFold'); await p.waitForTimeout(300); await p.click('.ng-t[data-ngt=g-org]'); await p.waitForTimeout(150); await p.click('.nav a[data-go=students]'); await p.waitForTimeout(1000);
          const s2 = await st(); const hash = await p.evaluate(() => location.hash);
          log(hash === '#/students' && s2.left < 0 && !s2.open, '手机：点菜单项换页后抽屉自动收起', hash);
        }
        await p.close();
      }
      log(errs.length === 0, '页面没有脚本报错', errs.slice(0, 2).join(' ; '));
    } catch (e) { log(false, '浏览器检查异常', e.message); }
    await browser.close();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
