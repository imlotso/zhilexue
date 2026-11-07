'use strict';

/**
 * Safe T11 component regression. No application server, database, login or token.
 * node astra-takeover-admin-responsive-test.js                    (source contracts)
 * node astra-takeover-admin-responsive-test.js --write-fixture /tmp/admin-ui.html
 * CHROMIUM_PATH=/usr/bin/chromium node astra-takeover-admin-responsive-test.js --browser
 * The generated -viewer.html also has a normal “一键布局回归” button. It runs
 * the real 390/768/1440 iframe matrix and prints individual measured results.
 *
 * Browser mode renders real extracted UI functions and the real stylesheet order
 * with synthetic data. It does NOT validate authenticated business workflows.
 * All assets are embedded, all network APIs reject, and Playwright aborts requests.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const admin = read('public/admin/admin.js');
const apiSource = read('public/js/api.js');
const bankSource = read('public/admin/bankui.js');
const css = read('public/admin/theme.css');

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'Production component boundaries changed: ' + start);
  return source.slice(a, b);
}

const componentSource = [
  section(apiSource, 'function toast(', 'function loginBgHTML('),
  section(apiSource, 'const DialogUX =', '/** 题目选项归一'),
  section(admin, '/* 管理端 SPA', '/** Element 上传'),
  section(admin, 'function bindPager(', '/**\n * 删除密码确认弹窗'),
  section(admin, 'function shell(', '// ------------------------------------------------------------ 数据概览'),
  section(admin, 'async function viewStudents(', '// ------------------------------------------------------------ 分校管理'),
  section(admin, 'let r10ControlId =', 'let RENDER_SEQ ='),
  section(bankSource, 'async function bkVideoNodes(', '/** Word 批量上传习题'),
].join('\n');

const fixtureSource = String.raw`
'use strict';
const Auth = Object.freeze({ user: Object.freeze({ name: '合成管理员', role: 'admin' }) });
const fixtureStorage = new Map();
const localStorage = { getItem: key => fixtureStorage.get(key) || null, setItem: (key, value) => fixtureStorage.set(key, String(value)), removeItem: key => fixtureStorage.delete(key) };
window.fixtureCalls = [];
window.fixtureNetworkAttempts = [];
let fixturePendingCount = 3;
const fixtureRows = [{ id: 1, name: '合成学生', username: 'fixture-student', grade: '七年级', stage: 'junior', term: '上册', status: 1, expire_at: '2030-01-01', last_login: '2026-11-01 09:00:00' }];
async function api(url, options = {}) {
  window.fixtureCalls.push({ url, method: options.method || 'GET' });
  if (options.method && options.method !== 'GET') throw new Error('合成页面不执行数据提交');
  if (url.includes('/badge-counts')) return { pending: fixturePendingCount };
  if (url.startsWith('/api/admin/students?')) return { list: fixtureRows, total: 100, page: 1, size: 10 };
  if (url === '/api/admin/bank/videos/1/nodes') return { tree_id: 1, nodes: [], trees: [{ id: 1, name: '初中数学 · 人教版七年级上册知识点树' }] };
  if (url === '/api/admin/bank/mf/trees/1/nodes') return { list: [{ id: 1, parent_id: 0, name: '有理数及其运算', qcount: 8 }] };
  throw new Error('未定义的合成接口：' + url);
}
async function loadMeta() {}
const denyNetwork = () => { window.fixtureNetworkAttempts.push('blocked'); throw new Error('合成页面禁止网络访问'); };
window.fetch = async () => denyNetwork();
window.XMLHttpRequest = window.WebSocket = window.EventSource = denyNetwork;
window.open = denyNetwork;
navigator.sendBeacon = denyNetwork;
`;

const fixtureBootstrap = String.raw`
window.fixture = {
  setFolded(value) { sideFoldSet(value); return render(); },
  toggleBadge() { fixturePendingCount = fixturePendingCount ? 0 : 3; return render(); },
  measure() {
    const dialogs = [...document.querySelectorAll('.modal')].filter(el => el.getClientRects().length);
    const active = dialogs.at(-1) || null;
    const box = (selector, root = document) => {
      const el = selector ? root && root.querySelector(selector) : root; if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), overflowX: el.scrollWidth - el.clientWidth, display: getComputedStyle(el).display };
    };
    return { viewport: innerWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, card: box('#view > .card'), logout: box('#btnOut'), drawerLabel: box('.nav-leaf .txt'), pendingBadge: box('#t11BadgePending'), dialogs: dialogs.length, modal: box(null, active), modalBody: box('.modal-b', active), modalTitle: box('.el-dialog__title', active), modalClose: box('.close-x', active), filters: box('.r8-vn-bar', active), nodeSelect: box('#r8VnTree', active), nodeSearch: box('#r8VnKw', active) };
  },
  openNodes() {
    modal({ title: '视频关联知识点', wide: true, body: '<div id="fixtureNodes"></div>', onMount: w => bkVideoNodes(w.querySelector('#fixtureNodes'), 1) });
  },
  openLongDialog() {
    modal({ title: '七年级数学上册第一章有理数及其运算综合练习 · 知识点关联', wide: true,
      body: '<div class="field"><label>备注</label><textarea class="input" placeholder="合成输入"></textarea></div>' + '<p>合成长表单内容，不会提交。</p>'.repeat(45),
      onOk: async () => { window.fixtureSaveCount = (window.fixtureSaveCount || 0) + 1; await new Promise(resolve => { window.fixtureResolveSave = resolve; setTimeout(resolve, 1000); }); return false; }
    });
  }
};
let fixtureRenderSeq = 0;
async function render() {
  const seq = ++fixtureRenderSeq;
  const out = await viewStudents();
  if (seq !== fixtureRenderSeq) return;
  $app.innerHTML = shell(out.html + '<div class="card"><p>纯前端合成组件：未登录、无数据库、禁止提交与外部网络。</p><div class="toolbar"><button class="btn ghost" id="fixtureNodesOpen">知识点选择弹窗</button><button class="btn ghost" id="fixtureLongOpen">长标题 / 长表单弹窗</button><a class="btn ghost" href="#/intake-photo">长页面标题</a></div></div>');
  bindShell(); out.after(); r10Enhance(document.getElementById('view'));
  document.getElementById('fixtureNodesOpen').onclick = fixture.openNodes;
  document.getElementById('fixtureLongOpen').onclick = fixture.openLongDialog;
  document.getElementById('btnStu').onclick = event => event.preventDefault();
  window.fixtureReady = true;
}
window.addEventListener('hashchange', render);
render();
`;

// This runs as ordinary authored page code in the standalone fixture, not via
// DevTools, a real application session, or a browser security workaround.
const fixtureRegressionSource = String.raw`
window.fixture.runRegressionForWidth = async function (expectedWidth) {
  const checks = [], errors = [];
  const noteError = event => errors.push(String(event.message || event.reason || event));
  window.addEventListener('error', noteError);
  window.addEventListener('unhandledrejection', noteError);
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const until = async predicate => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('等待实际界面状态超时');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await paint();
  };
  const $ = selector => document.querySelector(selector);
  const box = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2), overflowX: element.scrollWidth - element.clientWidth, display: getComputedStyle(element).display };
  };
  const visible = element => !!(element && element.getClientRects().length && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
  const hit = element => {
    const r = element.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!(at && (at === element || element.contains(at)));
  };
  const hitDetails = element => {
    const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const at = document.elementFromPoint(x, y), ancestors = [];
    const name = el => el && (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''));
    let ancestor = element;
    while (ancestor && ancestors.length < 5) {
      const style = getComputedStyle(ancestor);
      ancestors.push({ node: name(ancestor), rect: box(ancestor), scrollTop: ancestor.scrollTop, scrollHeight: ancestor.scrollHeight, clientHeight: ancestor.clientHeight, overflowX: style.overflowX, overflowY: style.overflowY, pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex });
      ancestor = ancestor.parentElement;
    }
    return { rect: box(element), point: { x, y }, hit: hit(element), matched: name(at), matchedHTML: at && at.outerHTML.slice(0, 240), ancestors };
  };
  const click = async selector => {
    const el = $(selector); if (!el) throw new Error('组件不存在：' + selector);
    el.focus(); el.click(); await paint();
  };
  const verify = (name, pass, actual) => checks.push({ width: expectedWidth, name, status: pass ? 'PASS' : 'FAIL', actual });
  const route = async key => { location.hash = '#/' + key; await render(); await until(() => $('.tb-crumb b') && $('.tb-crumb b').textContent === TITLE[key]); };
  const drawer = async () => { await click('#btnFold'); await until(() => $('.admin-app').classList.contains('t11-drawer') && $('.side').getBoundingClientRect().left >= -1); };
  try {
    document.querySelectorAll('.mask').forEach(el => el.remove());
    fixtureStorage.clear(); fixturePendingCount = 3; window.fixtureSaveCount = 0;
    window.fixtureCalls.length = 0; window.fixtureNetworkAttempts.length = 0; ADM.page = {};
    await route('students'); await document.fonts.ready; await paint();
    const frameRect = frameElement && frameElement.getBoundingClientRect();
    const previewVisible = !frameRect || (frameRect.top >= 0 && frameRect.left >= 0 && frameRect.right <= parent.innerWidth + 1 && frameRect.bottom <= parent.innerHeight + 1);
    verify('iframe真实视口', innerWidth === expectedWidth && innerHeight === 844 && previewVisible, { actualWidth: innerWidth, actualHeight: innerHeight, expectedWidth, previewVisible, preview: frameRect && { top: frameRect.top, left: frameRect.left, right: frameRect.right, bottom: frameRect.bottom }, parentViewport: { width: parent.innerWidth, height: parent.innerHeight } });
    const overflow = document.documentElement.scrollWidth - innerWidth;
    verify('页面无横向溢出', overflow <= 1, { overflow });
    const card = box($('#view > .card'));
    verify('工具栏/操作留在卡片内', card.overflowX <= 1, card);
    const tableAction = $('tbody .r10-actions-col');
    verify('表格操作列保持可见', visible(tableAction) && box(tableAction).right <= innerWidth, box(tableAction));

    await click('#btnAdd'); await until(() => !!$('.modal'));
    const studentBody = box($('.modal-b'));
    verify('学生表单无横向裁切', studentBody.overflowX <= 1, studentBody);
    await click('#mCancel'); await until(() => !$('.modal'));
    verify('取消关闭并返回触发按钮', !$('.modal') && document.activeElement === $('#btnAdd'), { dialogs: document.querySelectorAll('.modal').length, active: document.activeElement.id });
    await click('#btnAdd');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(() => !$('.modal'));
    verify('重开后Escape关闭', !$('.modal'), { dialogs: document.querySelectorAll('.modal').length });

    await click('#fixtureNodesOpen'); await until(() => !!$('#r8VnTree2 input'));
    const nodesBody = box($('.modal-b')), search = box($('#r8VnKw'));
    verify('知识点弹窗无横向溢出', nodesBody.overflowX <= 1, nodesBody);
    verify('知识点搜索框可用宽度', search.w >= 200, search);
    $('#r8VnKw').value = '有理数'; $('#r8VnKw').dispatchEvent(new Event('input', { bubbles: true })); await paint();
    await click('#r8VnTree2 input');
    const chosen = !!$('#r8VnChosen .r8-vn-chip');
    await click('#r8VnChosen button');
    verify('知识点选择/移除可重复', chosen && !$('#r8VnChosen .r8-vn-chip'), { chosenBeforeRemove: chosen, chipsAfterRemove: document.querySelectorAll('#r8VnChosen .r8-vn-chip').length });
    await click('.close-x'); await until(() => !$('.modal'));
    verify('知识点弹窗关闭后无残留遮罩', !$('.mask'), { masks: document.querySelectorAll('.mask').length });

    await click('#fixtureLongOpen'); await until(() => !!$('.modal'));
    const title = box($('.el-dialog__title')), close = box($('.close-x'));
    const overlap = title.right > close.x && title.x < close.right && title.y < close.bottom && title.bottom > close.y;
    verify('长标题不遮挡关闭按钮', !overlap, { title, close, overlap });
    verify('关闭按钮保留标准点击面积', close.w >= 34 && close.h >= 34, close);
    $('.modal').scrollTop = $('.modal').scrollHeight; await paint();
    const footer = box($('.modal-f')), stickyClose = box($('.close-x')), modalBox = box($('.modal'));
    const cancelProbe = hitDetails($('#mCancel')), saveProbe = hitDetails($('#mOk'));
    verify('长表单滚动后操作仍可触达', footer.bottom <= innerHeight + 1 && stickyClose.y >= 0 && hit($('.close-x')) && cancelProbe.hit && saveProbe.hit && cancelProbe.rect.x >= modalBox.x && saveProbe.rect.right <= modalBox.right, { footer, close: stickyClose, closeHit: hit($('.close-x')), cancelHit: cancelProbe.hit, cancel: cancelProbe, save: saveProbe });
    $('#mOk').click(); $('#mOk').click();
    verify('重复保存只调用一次', window.fixtureSaveCount === 1, { calls: window.fixtureSaveCount, busy: $('[role=dialog]').getAttribute('aria-busy') });
    $('#mCancel').click(); $('.close-x').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    verify('保存中关闭/取消不打断', !!$('.modal') && $('#mCancel').disabled && $('.close-x').disabled, { dialogs: document.querySelectorAll('.modal').length, cancelDisabled: $('#mCancel').disabled, closeDisabled: $('.close-x').disabled });
    window.fixtureResolveSave(); await until(() => !$('#mCancel').disabled);
    await click('#mCancel'); await until(() => !$('.modal'));
    verify('保存结束后可取消并继续操作', !$('.mask'), { masks: document.querySelectorAll('.mask').length });

    for (const key of ['intake-photo', 'intake-skill']) {
      await route(key); const logout = box($('#btnOut'));
      verify('长页面标题保留退出入口：' + TITLE[key], logout.right <= innerWidth && logout.x >= 0, logout);
    }
    if (expectedWidth <= 820) {
      await fixture.setFolded(true); await paint(); await drawer();
      const label = box($('.nav-leaf .txt'));
      verify('桌面折叠状态不隐藏手机菜单文字', visible($('.nav-leaf .txt')), label);
      if (!$('[data-ng="g-bank"]').classList.contains('open')) await click('[data-ngt="g-bank"]');
      verify('手机抽屉显示非零角标', visible($('#t11BadgePending')) && $('#t11BadgePending').textContent === '3', box($('#t11BadgePending')));
      await fixture.toggleBadge(); await paint(); await drawer();
      verify('零条角标仍隐藏', $('#t11BadgePending').hidden && !visible($('#t11BadgePending')), { hidden: $('#t11BadgePending').hidden, geometry: box($('#t11BadgePending')) });
      await click('#t11Scrim'); await until(() => !$('.t11-drawer') && $('.side').getBoundingClientRect().right <= 1);
      verify('遮罩关闭抽屉', !$('.t11-drawer'), box($('.side')));
      await drawer(); await click('.nav-leaf[data-go=dash]');
      await until(() => $('.tb-crumb b').textContent === '首页' && !$('.t11-drawer'));
      verify('导航返回首页关闭抽屉', !$('.t11-drawer'), { title: $('.tb-crumb b').textContent, drawer: !!$('.t11-drawer') });
    } else {
      await click('#btnFold');
      verify('桌面折叠仍隐藏文字和角标', !visible($('.nav-leaf .txt')) && !visible($('#t11BadgePending')), { label: box($('.nav-leaf .txt')), badge: box($('#t11BadgePending')) });
      await click('#btnFold');
      verify('桌面可重复展开', visible($('.nav-leaf .txt')), box($('.nav-leaf .txt')));
    }
  } catch (error) {
    verify('场景执行异常', false, { message: error.message, geometry: fixture.measure() });
  } finally {
    verify('无页面脚本错误', errors.length === 0, errors);
    verify('无网络API尝试/业务提交', window.fixtureNetworkAttempts.length === 0 && window.fixtureCalls.every(call => call.method === 'GET'), { blockedNetworkAttempts: window.fixtureNetworkAttempts.length, calls: window.fixtureCalls });
    window.removeEventListener('error', noteError);
    window.removeEventListener('unhandledrejection', noteError);
  }
  return checks;
};
`;

const viewerRegressionSource = String.raw`
document.getElementById('regress').onclick = async () => {
  const output = document.getElementById('measureOut');
  const controls = [...document.querySelectorAll('header button')];
  controls.forEach(button => { button.disabled = true; });
  output.style.maxHeight = '340px';
  const checks = [];
  try {
    for (const width of [390, 768, 1440]) {
      output.textContent = JSON.stringify({ status: 'RUNNING', width, completed: checks.length });
      size(width);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      checks.push(...await frame.contentWindow.fixture.runRegressionForWidth(width));
    }
  } catch (error) {
    checks.push({ name: '回归入口异常', status: 'FAIL', actual: { message: error.message } });
  } finally {
    const failures = checks.filter(check => check.status === 'FAIL');
    const result = { scope: '真实前端组件 + 合成数据；无登录、数据库、网络或真实业务提交', total: checks.length, passed: checks.length - failures.length, failed: failures.length, failures, checks };
    window.fixtureRegressionResult = result;
    output.textContent = JSON.stringify(result, null, 2);
    size(Number(frame.width));
    controls.forEach(button => { button.disabled = false; });
  }
};
`;

const viewerSetupSource = String.raw`
const frame = document.querySelector('iframe');
function size(width) {
  frame.width = width;
  window.scrollTo(0, 0);
  const availableWidth = Math.max(1, document.documentElement.clientWidth - 24);
  const availableHeight = Math.max(1, innerHeight - frame.parentElement.getBoundingClientRect().top - 12);
  const scale = Math.min(1, availableWidth / width, availableHeight / 844);
  // Scale only the preview. The child viewport stays exactly width × 844.
  frame.style.transform = 'scale(' + scale + ')';
  frame.parentElement.style.width = (width * scale) + 'px';
  frame.parentElement.style.height = (844 * scale) + 'px';
}
document.querySelectorAll('[data-width]').forEach(button => { button.onclick = () => size(Number(button.dataset.width)); });
document.getElementById('folded').onclick = () => frame.contentWindow.fixture.setFolded(true);
document.getElementById('badge').onclick = () => frame.contentWindow.fixture.toggleBadge();
document.getElementById('title').onclick = () => { frame.contentWindow.location.hash = '#/intake-photo'; };
document.getElementById('student').onclick = () => frame.contentDocument.getElementById('btnAdd').click();
document.getElementById('nodes').onclick = () => frame.contentWindow.fixture.openNodes();
document.getElementById('long').onclick = () => frame.contentWindow.fixture.openLongDialog();
document.getElementById('measure').onclick = () => {
  document.getElementById('measureOut').textContent = JSON.stringify(frame.contentWindow.fixture.measure());
  size(Number(frame.width));
};
window.addEventListener('resize', () => size(Number(frame.width)));
size(390);
`;

function embeddedAsset(file) {
  const resolved = path.resolve(file);
  assert(resolved.startsWith(PUBLIC + path.sep), 'Only public assets may enter the fixture');
  const ext = path.extname(resolved);
  const mime = { '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext];
  assert(mime, 'Unsupported fixture asset: ' + resolved);
  return 'data:' + mime + ';base64,' + fs.readFileSync(resolved).toString('base64');
}

function stylesheet(file) {
  return fs.readFileSync(file, 'utf8').replace(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g, (all, doubleQuoted, singleQuoted, unquoted) => {
    const url = doubleQuoted || singleQuoted || unquoted;
    if (url.startsWith('data:')) return all;
    assert(!/^(https?:)?\/\//.test(url), 'External CSS asset is not allowed');
    const local = url.startsWith('/') ? path.join(PUBLIC, url) : path.resolve(path.dirname(file), url);
    return 'url("' + embeddedAsset(local.split('?')[0].split('#')[0]) + '")';
  });
}

function buildViewer(html) {
  const escaped = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>T11 响应式合成组件预览</title>' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; frame-src \'self\' about:; connect-src \'none\'; form-action \'none\'">' +
    '<style>body{margin:0;background:#dfe5ed;font:14px sans-serif;color:#1f2d3d}header{padding:12px;display:flex;gap:8px;flex-wrap:wrap;background:#fff}button{padding:8px 12px;cursor:pointer}p{margin:8px 12px}.frame{margin:12px;overflow:hidden}iframe{display:block;border:0;transform-origin:top left;background:#fff}</style>' +
    '<header><button data-width="390">390px 手机</button><button data-width="768">768px 平板</button><button data-width="1440">1440px 桌面</button>' +
    '<button id="folded">模拟已折叠桌面菜单</button><button id="badge">切换角标 0 / 3</button><button id="title">长页面标题</button><button id="student">学生表单</button><button id="nodes">知识点选择</button><button id="long">长标题 / 长表单</button><button id="measure">测量当前布局</button><button id="regress">一键布局回归</button></header><pre id="measureOut" style="margin:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto"></pre>' +
    '<p>仅合成界面和内存数据，无登录、数据库、提交或外部网络。iframe真实高度固定844；预览按外层可用宽高缩放。</p>' +
    '<div class="frame"><iframe title="后台合成组件" width="390" height="844" srcdoc="' + escaped + '"></iframe></div>' +
    '<script>' + viewerSetupSource + '\n' + viewerRegressionSource + '</script></html>';
}

function buildFixture() {
  const hrefs = [...read('public/admin/index.html').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1].split('?')[0]);
  const styles = [...hrefs.map(href => path.resolve(PUBLIC, 'admin', href)), path.join(PUBLIC, 'admin/r10.css')];
  const scripts = fixtureSource + '\n' + componentSource + '\n' + fixtureBootstrap + '\n' + fixtureRegressionSource;
  new vm.Script(scripts, { filename: 'synthetic-admin-components.js' });
  new vm.Script(viewerSetupSource + '\n' + viewerRegressionSource, { filename: 'synthetic-admin-viewer.js' });
  // Vue and Element are the repository's local vendor builds. They render the
  // existing date-picker; no application boot or authentication code is loaded.
  const vendor = ['vue2.min.js', 'element-ui.js'].map(name => '<script>' + read('public/vendor/' + name).replace(/<\/script/gi, '<\\/script') + '</script>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">' +
    '<title>T11 纯前端合成界面</title>' + styles.map(file => '<style>' + stylesheet(file) + '</style>').join('') + vendor +
    '</head><body class="t11"><div id="app"></div><script>' + scripts.replaceAll('/img/logo.jpg', embeddedAsset(path.join(PUBLIC, 'img/logo.jpg'))).replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
}

function contracts(html) {
  const checks = [
    ['components compile without application boot', () => { new vm.Script(fixtureSource + '\n' + componentSource + '\n' + fixtureBootstrap + '\n' + fixtureRegressionSource); assert(!componentSource.includes('(async function boot()')); }],
    ['fixture contains no authentication implementation or generated token', () => { assert(!componentSource.includes('const Auth =')); assert(!componentSource.includes('TOKEN_KEY')); assert(!fixtureSource.includes('token:')); }],
    ['network and submission are disabled', () => { assert(html.includes("connect-src 'none'")); assert(html.includes("form-action 'none'")); assert(fixtureSource.includes("options.method !== 'GET'")); assert(fixtureSource.includes('window.fetch =')); }],
    ['real shell, form, table, modal and nodes components are used', () => { for (const fn of ['shell', 'bindShell', 'viewStudents', 'studentForm', 'modal', 'r10Enhance', 'bkVideoNodes']) assert(componentSource.includes('function ' + fn + '('), fn); }],
    ['fixture has no external script or stylesheet requests', () => { assert(!/<script[^>]+src=|<link[^>]+href=/.test(html)); }],
    ['layout diagnostics measure the top dialog and handle a closed page', () => {
      const element = width => ({ getClientRects: () => [{}], getBoundingClientRect: () => ({ x: 0, y: 0, width, height: 100 }), querySelector: () => null, scrollWidth: width, clientWidth: width });
      let dialogs = [element(111), element(222)];
      const context = { window: {}, innerWidth: 390, document: { documentElement: { scrollWidth: 390 }, querySelector: () => null, querySelectorAll: () => dialogs }, getComputedStyle: () => ({ display: 'block' }) };
      vm.runInNewContext(section(fixtureBootstrap, 'window.fixture =', 'let fixtureRenderSeq ='), context);
      assert.equal(context.window.fixture.measure().modal.w, 222);
      dialogs = [];
      assert.equal(context.window.fixture.measure().modal, null);
    }],
    ['theme remains scoped to the admin body', () => {
      const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const selectors = [];
      flat.replace(/(^|[}{])\s*([^{}@]+)\{/g, (_, pre, sel) => { selectors.push(...sel.split(',').map(s => s.trim())); return ''; });
      assert(selectors.length > 100);
      assert.deepEqual(selectors.filter(s => s && !/^body\.t11(?:$|[\s.:#\[{])/.test(s)), []);
    }],
    ['mobile drawer labels override the saved desktop fold rule', () => {
      const mobile = section(css, '@media (max-width:820px)', '@media (max-width:480px)');
      const restore = mobile.match(/body\.t11 \.admin-app \.txt,[\s\S]*?\.ng-arrow\{([^}]+)\}/);
      assert(restore, 'Mobile label restoration rule must exist');
      assert(/display\s*:\s*revert\s*!important/.test(restore[1]), 'Legacy .side-fold labels use display:none!important; mobile restoration must win');
    }],
    ['mobile drawer restores nonempty badges without overriding hidden', () => {
      const mobile = section(css, '@media (max-width:820px)', '@media (max-width:480px)');
      assert(/\.side-fold \.t11-badge:not\(\[hidden\]\)\{display:inline-block\}/.test(mobile), 'Only a non-hidden pending count should be restored in the mobile drawer');
    }],
    ['narrow knowledge filters give each control a usable row', () => {
      const mobile = section(css, '@media (max-width:760px)', '/* ============================================================================');
      assert(/\.r8-vn-bar\{[^}]*flex-wrap:wrap/.test(mobile), 'Knowledge filter bar must wrap on narrow screens');
      assert(/\.r8-vn-bar \.input\{[^}]*flex:1 1 100%/.test(mobile), 'Search must not collapse beside the tree selector');
    }],
    ['modal title reserves space for a full-size close control', () => {
      const header = css.match(/body\.t11 \.el-dialog__header\.modal-h\{([^}]+)\}/);
      assert(header && /padding:14px 56px 14px 20px!important/.test(header[1]), 'Long titles must leave the close-control area clear');
      const close = css.match(/body\.t11 \.el-dialog__headerbtn\.close-x\{([^}]+)\}/);
      assert(close && /width:var\(--t11-h\)/.test(close[1]) && /height:var\(--t11-h\)/.test(close[1]), 'Close must retain the theme control size');
    }],
    ['modal actions do not inherit the full-width login button', () => {
      const actions = css.match(/body\.t11 \.el-dialog__footer\.modal-f \.btn\{([^}]+)\}/);
      assert(actions && /width:auto/.test(actions[1]), 'A full-width save button pushes the non-shrinking cancel button outside the modal');
    }],
  ];
  for (const [name, test] of checks) { test(); console.log('PASS ' + name); }
  return checks.length;
}

async function browserChecks(html) {
  const { chromium } = require('playwright');
  const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);
  const failures = [], errors = [], requests = [];
  let checks = 0;
  const verify = (name, condition, details) => { checks++; if (!condition) failures.push({ name, details }); console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ': ' + JSON.stringify(details))); };
  try {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(html);
      await page.waitForFunction(() => window.fixtureReady === true);
      await page.evaluate(() => document.fonts.ready);
      const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      verify(width + 'px page does not overflow', horizontal <= 1, horizontal);
      const card = await page.locator('#view > .card').first().evaluate(el => el.scrollWidth - el.clientWidth);
      verify(width + 'px controls stay inside the card', card <= 1, card);
      await page.locator('#btnAdd').click();
      const formOverflow = await page.locator('.modal-b').evaluate(el => el.scrollWidth - el.clientWidth);
      verify(width + 'px student form has no clipped horizontal content', formOverflow <= 1, formOverflow);
      await page.locator('#mCancel').click();
      verify(width + 'px cancel removes dialog', await page.locator('[role=dialog]').count() === 0);
      await page.locator('#btnAdd').click();
      await page.keyboard.press('Escape');
      verify(width + 'px reopen and Escape restore the page', await page.locator('[role=dialog]').count() === 0);
      await page.evaluate(() => fixture.openNodes());
      await page.waitForSelector('#r8VnTree2 input');
      const nodesOverflow = await page.locator('.modal-b').evaluate(el => el.scrollWidth - el.clientWidth);
      verify(width + 'px knowledge filters stay within the dialog', nodesOverflow <= 1, nodesOverflow);
      const searchWidth = await page.locator('#r8VnKw').evaluate(el => el.getBoundingClientRect().width);
      verify(width + 'px knowledge search remains usable', searchWidth >= 200, searchWidth);
      await page.locator('.close-x').click();
      await page.evaluate(() => fixture.openLongDialog());
      const titleOverlap = await page.evaluate(() => {
        const title = document.querySelector('.el-dialog__title').getBoundingClientRect();
        const close = document.querySelector('.close-x').getBoundingClientRect();
        return title.right > close.left && title.top < close.bottom && title.bottom > close.top;
      });
      verify(width + 'px long title leaves the close control clear', !titleOverlap);
      const footerActions = await page.evaluate(() => {
        const modal = document.querySelector('.modal'); modal.scrollTop = modal.scrollHeight;
        const outer = modal.getBoundingClientRect();
        return [...document.querySelectorAll('.modal-f .btn')].map(el => { const r = el.getBoundingClientRect(); return { id: el.id, x: r.x, right: r.right, width: r.width, inModal: r.x >= outer.x && r.right <= outer.right }; });
      });
      verify(width + 'px both footer actions remain inside the modal', footerActions.length === 2 && footerActions.every(action => action.inModal), footerActions);
      await page.locator('#mOk').evaluate(el => { el.click(); el.click(); });
      verify(width + 'px duplicate save is blocked', await page.evaluate(() => fixtureSaveCount === 1));
      await page.evaluate(() => fixtureResolveSave());
      await page.waitForFunction(() => !document.querySelector('#mCancel').disabled);
      await page.locator('#mCancel').click();
      await page.evaluate(() => { location.hash = '#/intake-photo'; });
      await page.waitForFunction(() => document.querySelector('.tb-crumb b').textContent.includes('拍照'));
      const topbar = await page.locator('#btnOut').boundingBox();
      verify(width + 'px long page title keeps logout in view', topbar && topbar.x + topbar.width <= width, topbar);
      if (width <= 820) {
        await page.evaluate(() => { sideFoldSet(true); return render(); });
        await page.locator('#btnFold').click();
        await page.waitForFunction(() => document.querySelector('.side').getBoundingClientRect().left >= -1);
        const labels = await page.locator('.side .nav-leaf .txt').isVisible();
        verify(width + 'px saved desktop collapse does not hide drawer labels', labels);
        if (!await page.locator('[data-ng="g-bank"]').evaluate(el => el.classList.contains('open'))) await page.locator('[data-ngt="g-bank"]').click();
        verify(width + 'px drawer displays a nonempty pending badge', await page.locator('#t11BadgePending').isVisible());
        await page.evaluate(() => fixture.toggleBadge());
        await page.locator('#btnFold').click();
        verify(width + 'px drawer keeps zero pending counts hidden', !await page.locator('#t11BadgePending').isVisible());
        await page.locator('#t11Scrim').click({ position: { x: width - 10, y: 300 } });
        verify(width + 'px backdrop closes drawer', await page.locator('.t11-drawer').count() === 0);
        await page.locator('#btnFold').click();
        await page.locator('.nav-leaf[data-go=dash]').click();
        await page.waitForFunction(() => document.querySelector('.tb-crumb b').textContent === '首页');
        verify(width + 'px menu navigation closes drawer', await page.locator('.t11-drawer').count() === 0);
      } else {
        await page.locator('#btnFold').click();
        verify('desktop fold still hides labels and pending badges', !await page.locator('.side .nav-leaf .txt').isVisible() && !await page.locator('#t11BadgePending').isVisible());
      }
      await context.close();
    }
    verify('no script errors', errors.length === 0, errors);
    verify('no network requests', requests.length === 0, requests);
  } finally { await browser.close(); }
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log(checks + ' browser component checks passed (synthetic data only).');
}

async function main() {
  const html = buildFixture();
  const count = contracts(html);
  const at = process.argv.indexOf('--write-fixture');
  if (at >= 0) {
    assert(process.argv[at + 1], 'Provide an output path after --write-fixture');
    fs.writeFileSync(path.resolve(process.argv[at + 1]), html);
    fs.writeFileSync(path.resolve(process.argv[at + 1]).replace(/\.html$/, '-viewer.html'), buildViewer(html));
    console.log('Wrote zero-network synthetic fixture: ' + path.resolve(process.argv[at + 1]));
  }
  console.log(count + ' source contracts passed.');
  if (process.argv.includes('--browser')) await browserChecks(html);
  else console.log('Browser layout checks NOT RUN; use --browser in a permitted browser environment.');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildFixture };
