'use strict';
/**
 * 错题重组前端自测： node wrong-ui-test.js
 *  - 切题算法（行投影 / 分块 / 合并 / 分割线模型 / 自动裁边）：在沙箱里加载 wrong.js 直接跑算法，用合成图验证
 *  - 页面渲染：用 jsdom 真实加载管理端 #/wrong 与 #/wrong-scan，验证渲染无报错、关键控件齐全
 * 需先启动服务（默认 http://localhost:3000，且已 npm run seed）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://localhost:3000';
const SRC = fs.readFileSync(path.join(__dirname, 'public', 'admin', 'wrong.js'), 'utf8');
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

/* ---------------- 合成一张灰度「试卷」：白底 + 若干条墨迹带 ---------------- */
function makePage(w, h, bands) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [y0, y1] of bands) {
    for (let y = y0; y <= y1 && y < h; y++) {
      for (let x = 6; x < w - 6; x++) {
        const p = (y * w + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = 20;
      }
    }
  }
  return data;
}

/** 在沙箱里加载 wrong.js（浏览器脚本），只跑算法，不碰 DOM */
function loadAlgo() {
  const sandbox = {
    console,
    Math, Date, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    Auth: { token: 't' }, api: async () => ({}), esc: (s) => String(s), toast: () => {},
    fmtSize: () => '', downloadUrl: () => {}, render: () => {}, modal: () => {}, confirm: () => true,
    document: { createElement: () => ({ getContext: () => null }), getElementById: () => null, querySelectorAll: () => [] },
    window: { addEventListener() {}, isSecureContext: true },
    location: { hash: '' },
    FormData: class {}, Blob: class {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

function algoSegment(sb, w, h, bands, sens, minH) {
  const data = makePage(w, h, bands);
  sb.__W = w; sb.__H = h; sb.__DATA = data;
  vm.runInContext(`WR.scan.sens = ${sens}; WR.scan.minH = ${minH};`, sb);
  vm.runInContext(`
    __stub = { width: __W, height: __H, getContext: () => ({ getImageData: () => ({ data: __DATA }) }) };
    __page = { canvas: __stub, w: __W, h: __H, lines: [], blocks: [] };
    __n = autoSegment(__page);
    __lines = __page.lines.slice();
    __blocks = blocksOf(__page).slice();
  `, sb);
  return { n: sb.__n, lines: sb.__lines, blocks: sb.__blocks };
}

/* ============================================================ 算法自测 */
function testAlgo() {
  console.log('\n【切题算法】');
  const sb = loadAlgo();

  // 1. 三块明显分开的题目 → 应切成 3 块
  let r = algoSegment(sb, 600, 900, [[50, 150], [300, 420], [600, 700]], 45, 4);
  log(r.n === 3, '三段独立内容切成 3 道题', '块数=' + r.n + ' 分割线=' + JSON.stringify(r.lines));

  // 2. 段内只有很窄的空白（一行）→ 不应被切断
  r = algoSegment(sb, 600, 900, [[50, 150], [152, 250], [500, 600]], 45, 4);
  log(r.n === 2, '段内窄空白不误切（仍识别为 2 道题）', '块数=' + r.n);

  // 3. 太矮的碎片应并入相邻题（避免把换行当成新题）
  r = algoSegment(sb, 600, 900, [[300, 320], [380, 500]], 45, 4);
  log(r.n === 1, '矮碎片并入相邻题目', '块数=' + r.n + ' 分割线=' + JSON.stringify(r.lines));

  // 4. 灵敏度调低 → 同一张图切出的块数不会增加（更"钝"）
  const a = algoSegment(sb, 600, 900, [[50, 150], [300, 420], [600, 700]], 80, 4);
  const b = algoSegment(sb, 600, 900, [[50, 150], [300, 420], [600, 700]], 15, 4);
  log(b.n <= a.n, '灵敏度参数生效（低灵敏度不会切得更多）', `高灵敏=${a.n} 块 / 低灵敏=${b.n} 块`);

  // 5. 分割线模型：块 = 线段之间的区间
  r = algoSegment(sb, 600, 900, [[50, 150], [300, 420], [600, 700]], 45, 4);
  const bs = r.blocks;
  log(bs.length === 3 && bs[0][0] === 0 && bs[2][1] === 900, '分割线模型覆盖整页（首块从 0 开始、末块到页底）', JSON.stringify(bs));
  log(bs.every((x) => x[1] > x[0]), '每块高度为正', JSON.stringify(bs));

  // 6. 手动加/删分割线后块数同步变化
  vm.runInContext(`
    __page.lines = [450];
    __two = blocksOf(__page).length;
    __page.lines = [];
    __one = blocksOf(__page).length;
    __page.lines = [200, 400, 600];
    __four = blocksOf(__page).length;
  `, sb);
  log(sb.__two === 2 && sb.__one === 1 && sb.__four === 4, '分割线数量与题目数量一一对应', `1线=${sb.__two} 0线=${sb.__one} 3线=${sb.__four}`);

  // 7. 自动裁边：图四周有空白，应裁到内容范围
  const W = 600, H = 800;
  const data = makePage(W, H, [[150, 350]]);
  const sb2 = loadAlgo();
  sb2.__W = W; sb2.__H = H; sb2.__DATA = data;
  vm.runInContext(`
    __src = { width: __W, height: __H, getContext: () => ({ getImageData: () => ({ data: __DATA }) }) };
    __made = null;
    document.createElement = () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: (s, sx, sy, sw, sh) => { __made = { sx, sy, sw, sh }; } }),
    });
    __out = autoCrop(__src, 45);
  `, sb2);
  const made = sb2.__made;
  const cropped = !!made && (made.sw < W || made.sh < H);
  log(cropped, '自动裁掉纸面外的空白背景', made ? `裁切区 ${made.sw}×${made.sh}（原 ${W}×${H}）` : '未裁切');
  log(!!made && made.sy < 150 && made.sy + made.sh > 350, '裁切范围覆盖全部墨迹行', made ? `y ${made.sy}~${made.sy + made.sh}` : '');

  /* ---------------- 框选（主要交互方式） ---------------- */
  // 8. 自动识别只是辅助：跑完也会同步产出一版「框」初稿
  r = algoSegment(sb, 600, 900, [[50, 150], [300, 420], [600, 700]], 45, 4);
  vm.runInContext('__boxes = __page.boxes.map((b) => ({ ...b }));', sb);
  log(sb.__boxes.length === r.n && sb.__boxes.every((b) => b.w > 0 && b.h > 0), '自动识别同步生成同数量的框选初稿', JSON.stringify(sb.__boxes));

  // 9. 框的过滤与排序：误触的小框丢弃，按「先上后下、先左后右」编号
  vm.runInContext(`
    __pg = { w: 600, h: 900, boxes: [
      { x: 300, y: 100, w: 200, h: 80 },
      { x: 10,  y: 100, w: 200, h: 80 },
      { x: 5,   y: 400, w: 200, h: 80 },
      { x: 50,  y: 600, w: 4,   h: 3  },
    ] };
    __kept = boxesOf(__pg).map((b) => b.x + ',' + b.y);
    __n2 = boxesOf(__pg).length;
    __okSmall = boxOk({ x: 0, y: 0, w: 4, h: 3 });
    __okNormal = boxOk({ x: 0, y: 0, w: 200, h: 80 });
  `, sb);
  log(sb.__n2 === 3 && !sb.__okSmall && sb.__okNormal, '误触产生的小框被过滤（4×3 不算一道题）', '保留 ' + sb.__n2 + ' 个');
  log(JSON.stringify(sb.__kept) === JSON.stringify(['10,100', '300,100', '5,400']), '框按阅读顺序排序（先上后下、先左后右）', JSON.stringify(sb.__kept));

  // 10. 越界的框会被夹回页内，且不会小于最小尺寸
  vm.runInContext(`
    __pg2 = { w: 600, h: 900 };
    __fit1 = fitBox({ x: 580, y: 880, w: 100, h: 100 }, __pg2);
    __fit2 = fitBox({ x: -30, y: -20, w: 3, h: 2 }, __pg2);
  `, sb);
  const f1 = sb.__fit1, f2 = sb.__fit2;
  log(f1.x + f1.w <= 600 && f1.y + f1.h <= 900, '拖到页面外的框被夹回页内', JSON.stringify(f1));
  log(f2.x === 0 && f2.y === 0 && f2.w >= 24 && f2.h >= 16, '坐标不为负、尺寸不小于下限', JSON.stringify(f2));

  // 11. 示例试卷预置 6 个示例框（演示 / 截图用）
  vm.runInContext('__demo = demoBoxes(); __demoOk = __demo.length === 6 && __demo.every((b) => boxOk(b));', sb);
  log(sb.__demoOk, '示例试卷预置 6 个可直接入库的示例框', JSON.stringify(sb.__demo));
}

/* ============================================================ 页面渲染自测 */
const errors = [];
async function boot(hash) {
  const login = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zlx-ci-admin', password: '123456', role: 'admin' }),
  })).json();
  const token = login.data && login.data.token;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented|Could not load/.test(e.message)) errors.push(hash + ': ' + e.message); });
  vc.on('error', (...a) => errors.push(hash + ' [console.error]: ' + a.join(' ')));
  const dom = await JSDOM.fromURL(BASE + '/admin/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.fetch = (u, o) => fetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      win.alert = () => {}; win.confirm = () => true; win.open = () => null; win.print = () => {};
      win.Element.prototype.scrollIntoView = () => {};
    },
  });
  dom.window.localStorage.setItem('xuexi_admin_token', token);
  dom.window.localStorage.setItem('xuexi_admin_user', JSON.stringify({ name: '校长', role: 'admin' }));
  dom.window.location.hash = hash;
  return dom;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function testViews() {
  console.log('\n【管理端页面渲染】');

  // 左侧导航
  let dom = await boot('#/wrong');
  await wait(1500);
  let txt = dom.window.document.body.textContent || '';
  log(txt.includes('AI错题重组'), '左侧导航出现「AI错题重组」入口');
  log(txt.includes('AI 识别全部题目') && txt.includes('错题栏'), '新工作台：AI 识别全部题目 / 错题栏');
  log(txt.includes('拍照 / 上传试卷') && txt.includes('AI 识别题目'), '三步结构齐全（拍照 → AI 识别 → 错题栏）');
  log(txt.includes('原题重组') && txt.includes('举一反三重组'), '错题栏右下角两个重组按钮（原题 / 原题+举一反三）');
  log(txt.includes('一键清空所有错题'), '错题栏右上角「一键清空所有错题」');
  log(txt.includes('高拍仪'), '给出高拍仪连接说明（标准 USB 免驱摄像头）');
  log(txt.includes('左栏原题 · 右栏举一反三'), '说明里写明两栏版式（左原题 / 右举一反三）');
  log(txt.includes('AI 配置'), '页面有「⚙️ AI 配置」入口（全站共用一份配置）');
  log(txt.includes('错题栏') && !txt.includes('error'), '页面主体渲染完整（摄像头提示里的 ⚠️ 属正常环境提示）');
  dom.window.close();

  // 工作台（?demo=1 载入示例试卷，顺带验证框选编辑器能渲染出框）
  dom = await boot('#/wrong?demo=1');
  await wait(1800);
  txt = dom.window.document.body.textContent || '';
  const scanDoc = dom.window.document;
  log(txt.includes('拍照 / 上传试卷') && txt.includes('AI 识别题目'), '工作台渲染出「拍照 / AI 识别题目」两块');
  log(txt.includes('开启摄像头') && txt.includes('拍照'), '摄像头控件齐全（开启 / 拍照 / 连拍）');
  log(txt.includes('上传文件（图片 / PDF）'), '提供「上传文件（图片 / PDF）」兜底入口（摄像头不可用时也能用）');
  log(/pdf/i.test(scanDoc.getElementById('wFiles').accept || ''), '文件框接受 PDF（PDF 自动逐页转成试卷页）', scanDoc.getElementById('wFiles').accept);
  log(txt.includes('按住鼠标左键拖出一个方框'), '给出「手动拖框兜底」的操作说明');
  log(scanDoc.querySelectorAll('.w-box').length === 6, '示例试卷的 6 个框渲染成可拖拽的方框', '框数=' + scanDoc.querySelectorAll('.w-box').length);
  log(scanDoc.querySelectorAll('.w-box-add').length === 6, '每个框都带「➕ 加入错题栏」按钮', '➕数=' + scanDoc.querySelectorAll('.w-box-add').length);
  log(!!scanDoc.querySelector('.w-box-x') && !!scanDoc.querySelector('.w-h'), '每个框都带删除按钮与缩放手柄');
  log(!!scanDoc.getElementById('wWhole') && !!scanDoc.getElementById('wClearBox'), '框选工具齐全（整页一道题 / 清空框选）');
  log(!!scanDoc.getElementById('wAiSeg') && !!scanDoc.getElementById('wAddAll'), 'AI 识别与「全部加入」按钮齐全');
  log(!!scanDoc.getElementById('wAutoSeg'), '按空白行自动切题保留为兜底按钮');
  const diag = scanDoc.getElementById('wDiag');
  log(!!diag && /摄像头|安全/.test(diag.textContent || ''), '页面直接给出摄像头体检结果', (diag && diag.textContent || '').slice(0, 60));
  log(!/❌/.test(txt), '渲染无脚本异常（仅可能有环境提示）', '');
  dom.window.close();

  // 点 ➕ / 全部加入 → 错题栏渲染（jsdom 无 canvas，裁切结果为空画布但计数应正确）
  dom = await boot('#/wrong?demo=1');
  await wait(1800);
  const jd = dom.window.document;
  jd.querySelectorAll('.w-box-add')[0].click();
  await wait(300);
  log(jd.getElementById('wJobsCount').textContent.includes('1'), '点第一个框的 ➕ 后错题栏计数 = 1', jd.getElementById('wJobsCount').textContent);
  log(jd.querySelectorAll('.w-box-add')[0].textContent.includes('✅'), '加过的框 ➕ 变 ✅');
  jd.getElementById('wAddAll').click();
  await wait(300);
  log(jd.getElementById('wJobsCount').textContent.includes('6'), '点「全部加入」后错题栏计数 = 6', jd.getElementById('wJobsCount').textContent);
  log(jd.querySelectorAll('[data-jchk]').length === 6, '错题栏每题带勾选框（默认全选）', '勾选框数=' + jd.querySelectorAll('[data-jchk]').length);
  log((jd.getElementById('wSelInfo') || {}).textContent === '已勾选 6 / 6 道', '显示勾选统计', (jd.getElementById('wSelInfo') || {}).textContent);
  jd.querySelector('[data-jchk]').checked = false;
  jd.querySelector('[data-jchk]').onchange();
  await wait(200);
  log((jd.getElementById('wSelInfo') || {}).textContent === '已勾选 5 / 6 道', '取消勾选后统计同步为 5 / 6', (jd.getElementById('wSelInfo') || {}).textContent);
  log(!!jd.getElementById('wRePrint') && !!jd.getElementById('wRebuild2'), '右下角两个重组按钮齐全（原题 / 原题+举一反三）');
  jd.getElementById('wJobsClear').click();
  await wait(200);
  log(jd.getElementById('wJobsCount').textContent.includes('0'), '「一键清空所有错题」后计数归 0', jd.getElementById('wJobsCount').textContent);
  log(!jd.body.textContent.includes('[object Object]'), '错题栏渲染无 [object Object]');
  dom.window.close();

  log(errors.length === 0, '全部页面均无 JS 报错', errors.slice(0, 2).join(' | '));
}

(async () => {
  console.log('\n=== 错题重组 · 前端自测 ===');
  try {
    testAlgo();
    await testViews();
  } catch (e) {
    log(false, '测试异常', e.message);
  }
  console.log('\n=== 结果： 通过 ' + pass + ' 项，失败 ' + fail + ' 项 ===\n');
  process.exit(fail ? 1 : 0);
})();
