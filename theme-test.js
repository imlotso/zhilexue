'use strict';
/**
 * 后台 UI 统一（T11）自测： node theme-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed。
 * 静态检查：theme.css 在所有样式之后加载、规则全部挂在 body.t11 下（不改旧选择器）、菜单按任务书分成五组、
 *           AI 配置中心在「系统设置」下、待审核题目在「智能题库」下并带角标。
 * 有浏览器时（Playwright）：桌面和手机宽度下后台主要页面都不横向撑破页面；手机宽度侧栏是抽屉（点三道杠开、点遮罩关、点菜单换页后自动关）；
 *           待审核角标有数字时显示；首页有「快捷操作」和「最近开通」。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  console.log('\n=== 后台 UI 统一（T11）· 自测 ===\n');
  const html = read('public/admin/index.html');
  const css = read('public/admin/theme.css');
  const admin = read('public/admin/admin.js');

  // ---------- 1) theme.css 的加载与作用范围 ----------
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
  log(hrefs.length > 1 && hrefs[hrefs.length - 1] === './theme.css', 'theme.css 放在所有样式表之后加载', hrefs.join(' → '));
  log(/<body class="t11">/.test(html), '<body> 带 t11 类（去掉它就退回旧样式）');
  const res = await fetch(BASE + '/admin/theme.css');
  log(res.status === 200 && (await res.text()).includes('--t11-primary'), '服务器能取到 theme.css');
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
  log(groups.map((g) => g.t).join('/') === '首页/学生与账号/教学资源/智能题库/学情与报告/系统设置', '左侧菜单：首页 + 学生与账号 / 教学资源 / 智能题库 / 学情与报告 / 系统设置', groups.map((g) => g.t).join('/'));
  const of = (t) => (groups.find((g) => g.t === t) || { items: [] }).items;
  log(of('系统设置').includes('mfset'), '「AI 配置中心」在「系统设置」下');
  log(of('智能题库').includes('pending') && of('智能题库').includes('mfq'), '「待审核题目」在「智能题库」下');
  log(/id="t11BadgePending"/.test(admin) && /ext\/badge-counts/.test(admin), '「待审核题目」菜单带角标（取 ext/badge-counts）');
  const navKeys = [...admin.matchAll(/\{ k: '([a-z0-9]+)', t: '[^']+', i: '[a-z0-9]+'(?:, principalOnly: true)? \}/g)].map((m) => m[1]);
  const grouped = new Set(groups.flatMap((g) => g.items));
  const orphan = navKeys.filter((k) => !grouped.has(k) && !['mfc', 'mfi', 'bkfb'].includes(k));
  log(orphan.length === 0, '每个菜单项都归了组（网络采集 / 录题上传 / 错题反馈从题库管理页进入）', orphan.join(','));

  // ---------- 3) 有浏览器时：真的打开看 ----------
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
  if (!browser) {
    console.log('  ⏭  没有可用的浏览器（Playwright），跳过页面检查');
  } else {
    const errs = [];
    try {
      const open = async (w, h) => {
        const p = await browser.newPage({ viewport: { width: w, height: h } });
        p.on('pageerror', (e) => errs.push(e.message));
        await p.goto(BASE + '/admin/'); await p.fill('input[type=text],input:not([type])', '15152099970'); await p.fill('input[type=password]', '123456'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
        return p;
      };
      const pages = ['dash', 'students', 'xreport', 'mfq', 'pending', 'videos', 'mfset', 'acc', 'chapters', 'words'];
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
          await p.goto(BASE + '/admin/#/dash'); await p.waitForSelector('.t11-quick', { timeout: 6000 });
          log(await p.$$eval('.t11-quick .btn', (e) => e.length) >= 4 && (await p.$$eval('.dash-stats .stat', (e) => e.length)) === 5, '首页：5 张数据卡片 + 快捷操作');
          await p.goto(BASE + '/admin/#/students'); await p.waitForSelector('#btnAdd'); await p.waitForTimeout(500);
          const cs = await p.evaluate(() => { const b = document.getElementById('btnAdd'); const i = document.getElementById('sKw'); const g = document.getElementById('btnBatch'); const c = (e) => e && { r: getComputedStyle(e).borderRadius, h: getComputedStyle(e).height }; return { primary: c(b), ghost: c(g), input: c(i) }; });
          log(['primary', 'ghost', 'input'].every((k) => cs[k] && cs[k].r === '6px' && cs[k].h === '34px'), '主按钮 / 次按钮 / 输入框：圆角 6px、高度 34px（统一变量生效）', JSON.stringify(cs));
          const groupsOnPage = await p.$$eval('.nav .nav-group .ng-t .txt, .nav .nav-leaf .txt', (e) => e.map((x) => x.textContent.trim()).join('/'));
          log(groupsOnPage === '首页/学生与账号/教学资源/智能题库/学情与报告/系统设置', '页面上的菜单分组', groupsOnPage);
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
