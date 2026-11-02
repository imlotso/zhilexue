/* AI错题重组：摄像头/高拍仪/照片扫描试卷 → AI 整页识别所有题目 → 点「➕」加入错题栏
 *   → 勾选错题 → 「🖨 原题重组」（可设栏数/间隔）或「⚡ 原题+举一反三重组」→ 两栏 PDF
 *
 * 主要流程（对齐错题录入 App 的体验）：
 *   ① 拍照 / 上传（得力等高拍仪 = 标准 USB 免驱摄像头，设备下拉框直接可选）；
 *   ② 点「AI 识别全部题目」：整页交给视觉模型，返回每道题的边界框，在图上渲染成一个个
 *      识别框，每个框右上角有「➕」，点一下就把这道题裁出来加入下方错题栏；
 *      识别不准可直接在图上手动拖框兜底（拖拽/移动/缩放交互保留）。
 *   ③ 错题栏：每道题带勾选框（默认全选），右上角「🗑 一键清空所有错题」，
 *      右下角两个按钮：「🖨 原题重组」＝把勾选的原题排成练习卷（栏数 / 题间距可设）；
 *      「⚡ 原题+举一反三重组」＝每题再让 AI 生成同类变式题，排成左原题 / 右举一反三两栏卷。
 *
 * 单页工作台（#/wrong，旧的 #/wrong-scan 已合并）。
 */
const WR = {
  scan: { pages: [], deviceId: '', stream: null, cur: -1, sens: 45, minH: 4, busy: false, timer: null, autoShot: null },
  jobs: [],     // 错题栏（已加入的题目） [{id, canvas, w, h, sel}]  sel=1 参与重组
  busy: false,  // 正在重组（防止重复点击）
  segBusy: false, // 正在 AI 整页识别
};

const W_MAXW = 1400;      // 工作画布最大宽度（像素）
const W_EXPORT_W = 1000;  // 入库题目图片最大宽度（按栏宽约 90mm 算，足够 200dpi 打印）
const W_MIN_BOX_W = 24;   // 框选有效框的最小宽/高（页图坐标），比这更小视为误触
const W_MIN_BOX_H = 16;

const pdfUrl = (key, name) => `/api/file?key=${encodeURIComponent(key)}&inline=1&token=${encodeURIComponent(Auth.token)}${name ? '&name=' + encodeURIComponent(name) : ''}`;
const wNow = () => new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');

/* ============================================================ 图像处理 */

/** 画布 → 灰度数组 + 行/列墨迹投影（自适应局部阈值，能适应台灯阴影） */
function inkProjection(canvas, sens) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext && canvas.getContext('2d');
  // 无 canvas 能力的环境（自动化测试等）返回空投影，后续逻辑会自然退化为「不裁切 / 不识别」
  if (!ctx || !ctx.getImageData) return { rows: new Uint32Array(h), cols: new Uint32Array(w), w, h };
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

  // 积分图 → 任意矩形均值
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    for (let x = 0; x < w; x++) { rs += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + rs; }
  }
  const r = Math.max(6, Math.round(w / 50));
  const k = 0.04 + (Number(sens) || 45) / 100 * 0.26; // 灵敏度越高，越容易把浅色笔画判成墨迹
  const rows = new Uint32Array(h);
  const cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const baseTop = y0 * (w + 1), baseBot = (y1 + 1) * (w + 1);
    let cnt = 0;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const sum = S[baseBot + x1 + 1] - S[baseTop + x1 + 1] - S[baseBot + x0] + S[baseTop + x0];
      const mean = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
      if (g[y * w + x] < mean * (1 - k)) { rows[y]++; cols[x]++; cnt++; }
    }
    if (cnt) cnt = cnt;
  }
  return { rows, cols, w, h };
}

/** 去阴影：按大窗口背景把纸面提亮，颜色保留（红笔、照片不会被压成黑白） */
function enhanceCanvas(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx || !ctx.getImageData) return canvas;
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    for (let x = 0; x < w; x++) { rs += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + rs; }
  }
  const r = Math.max(12, Math.round(w / 12));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const baseTop = y0 * (w + 1), baseBot = (y1 + 1) * (w + 1);
    const rowsN = (y1 - y0 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const colsN = (x1 - x0 + 1);
      const bg = (S[baseBot + x1 + 1] - S[baseTop + x1 + 1] - S[baseBot + x0] + S[baseTop + x0]) / (rowsN * colsN);
      const factor = bg < 1 ? 1 : 242 / bg;
      const p = (y * w + x) * 4;
      d[p] = Math.min(255, d[p] * factor);
      d[p + 1] = Math.min(255, d[p + 1] * factor);
      d[p + 2] = Math.min(255, d[p + 2] * factor);
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

/** 自动裁掉纸面外的背景（摄像头拍的照片四周有桌面/手指），返回裁切矩形；裁不动返回 null */
function autoCropRect(canvas, sens) {
  const { rows, cols, w, h } = inkProjection(canvas, sens);
  const thR = Math.max(2, Math.round(w * 0.004)), thC = Math.max(2, Math.round(h * 0.004));
  let y0 = -1, y1 = -1, x0 = -1, x1 = -1;
  for (let y = 0; y < h; y++) if (rows[y] > thR) { if (y0 < 0) y0 = y; y1 = y; }
  for (let x = 0; x < w; x++) if (cols[x] > thC) { if (x0 < 0) x0 = x; x1 = x; }
  if (y0 < 0 || x0 < 0) return null;
  const pad = Math.round(Math.min(w, h) * 0.015);
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad);
  const cx1 = Math.min(w - 1, x1 + pad), cy1 = Math.min(h - 1, y1 + pad);
  const nw = cx1 - cx0 + 1, nh = cy1 - cy0 + 1;
  if (nw < w * 0.2 || nh < h * 0.2) return null; // 裁得太狠就不裁，避免误判
  return { x: cx0, y: cy0, w: nw, h: nh };
}

function cropRegion(canvas, r) {
  const c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  const cctx = c.getContext && c.getContext('2d');
  if (!cctx) return canvas;
  cctx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

function autoCrop(canvas, sens) {
  const r = autoCropRect(canvas, sens);
  return r ? cropRegion(canvas, r) : canvas;
}

/** 自动切题：按行墨迹投影找「连续空白带」作为题目分界 */
function autoSegment(page) {
  const { rows, h } = inkProjection(page.canvas, WR.scan.sens);
  const emptyTh = Math.max(1, Math.round(page.w * 0.002));
  const gapPx = Math.max(6, Math.round(h * (0.005 + (100 - WR.scan.sens) / 100 * 0.015)));
  const minBlock = Math.max(10, Math.round(h * (WR.scan.minH / 100)));

  const blocks = [];
  let start = -1, emptyRun = 0;
  for (let y = 0; y < h; y++) {
    if (rows[y] > emptyTh) {
      if (start < 0) start = y;
      emptyRun = 0;
    } else if (start >= 0) {
      emptyRun++;
      if (emptyRun >= gapPx) { blocks.push([start, y - emptyRun]); start = -1; emptyRun = 0; }
    }
  }
  if (start >= 0) blocks.push([start, h - 1]);

  // 太矮的块（多半是上一题的换行或小题号）合并到相邻块
  const merged = [];
  for (const b of blocks) {
    if (merged.length && (b[1] - b[0] + 1) < minBlock) merged[merged.length - 1][1] = b[1];
    else merged.push(b.slice());
  }
  if (merged.length > 1 && (merged[0][1] - merged[0][0] + 1) < minBlock) {
    merged[1][0] = merged[0][0];
    merged.shift();
  }
  // 上下留白
  const pad = Math.max(4, Math.round(h * 0.006));
  merged.forEach((b) => { b[0] = Math.max(0, b[0] - pad); b[1] = Math.min(h - 1, b[1] + pad); });
  for (let i = 1; i < merged.length; i++) if (merged[i][0] <= merged[i - 1][1]) merged[i][0] = merged[i - 1][1] + 1;

  // 转成「分割线」模型：块之间一条线
  page.blocks = merged;
  page.lines = merged.slice(1).map((b, i) => Math.round((merged[i][1] + b[0]) / 2));
  // 同时给出一版「框选」初稿：每个块 → 一个矩形框（自动识别只是辅助，可直接在图上增删改）
  page.boxes = merged.map((b) => ({ x: 0, y: b[0], w: page.w, h: b[1] - b[0] + 1 }));
  return merged.length;
}

/** 分割线 → 题目块 */
function blocksOf(page) {
  const lines = (page.lines || []).slice().sort((a, b) => a - b);
  const edges = [0, ...lines, page.h];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const y0 = Math.round(edges[i]), y1 = Math.round(edges[i + 1]);
    if (y1 - y0 >= 8) out.push([y0, y1]); // 小于 8px 的碎片忽略
  }
  return out;
}

/* ------------------------------------------------------------ 框选（一个框 = 一道题） */

const wClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 有效的框：宽高都够大（拖拽过程中的极小框、误触点都过滤掉） */
function boxOk(b) {
  return !!b && Number(b.w) >= W_MIN_BOX_W && Number(b.h) >= W_MIN_BOX_H;
}

/** 阅读顺序：先上后下、先左后右 */
function sortBoxes(list) {
  return (list || []).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** 页面上真正会被裁切入库的框（已排序、已过滤）：addBoxJob / addAllBoxes / 缩略图计数都用它 */
function boxesOf(page) {
  return sortBoxes((page && page.boxes) || []).filter(boxOk);
}

/** 把一个框限制在页内，并保证不小于最小尺寸 */
function fitBox(b, page) {
  const w = wClamp(Math.round(Number(b.w) || 0), W_MIN_BOX_W, page.w);
  const h = wClamp(Math.round(Number(b.h) || 0), W_MIN_BOX_H, page.h);
  return { x: wClamp(Math.round(Number(b.x) || 0), 0, page.w - w), y: wClamp(Math.round(Number(b.y) || 0), 0, page.h - h), w, h };
}

/* ============================================================ 错题重组工作台
 *
 * 新版流程（扫码即出卷，不保存、不留历史）：
 *   ① 拍照 / 上传试卷 → ② 在页图上框出每道错题 → ③ 一键重组
 * 每道题都会交给 AI 识别题干与知识点，并在右栏生成「举一反三」的同类变式例题（含答案与解析），
 * 最终排成两栏 A4 练习卷：左栏 = 原题图片，右栏 = 举一反三例题。
 * 右栏文字由浏览器画成图片再贴进 PDF（这样 PDF 里不需要中文字体，离线也能生成）。
 */

async function viewWrong() {
  const cur = WR.scan.pages[WR.scan.cur];
  return {
    html: `
    <div class="card">
      <div class="card-h">
        <h3>AI错题重组</h3>
        <button class="btn primary-sm" id="wRebuild">原题+举一反三重组</button>
      </div>
      <div class="w-scan">
        <div>
          <div class="w-cam">
            <video id="wVideo" playsinline autoplay muted></video>
            <div class="w-cam-tip" id="wTip">摄像头未开启</div>
          </div>
          <div class="toolbar" style="margin-top:10px">
            <select id="wDev" style="min-width:180px"><option value="">默认摄像头</option></select>
            <button class="btn primary-sm" id="wCamOn">开启摄像头</button>
            <button class="btn ghost" id="wShot">拍照</button>
            <label class="w-chk"><input type="checkbox" id="wAuto"> 连拍（每 2 秒一张）</label>
            <label class="btn ghost" id="wUploadBtn">上传文件<input type="file" id="wFiles" accept="image/*,.pdf,application/pdf" multiple style="display:none"></label>
            <button class="btn ghost" id="wDemo">载入示例</button>
            <button class="btn ghost" id="wClearPages">清空</button>
          </div>
        </div>
        <div>
          <div class="w-thumbs" id="wThumbs"></div>
        </div>
      </div>
    </div>

    <div class="card" id="wSegCard">
      <div class="card-h">
        <h3>识别题目 <span class="tag gray" id="wSegCount">${cur ? boxesOf(cur).length + ' 道' : '0 道'}</span></h3>
        <div class="acts">
          <button class="btn primary-sm" id="wAiSeg">AI 识别全部题目</button>
          <button class="btn ghost" id="wAddAll">全部加入错题栏</button>
          <button class="btn ghost" id="wWhole">整页一道题</button>
          <button class="btn ghost" id="wAutoSeg">按空白行切题</button>
          <button class="btn ghost" id="wClearBox">清空框选</button>
        </div>
      </div>
      ${cur ? `
      <div class="w-canvas-wrap" id="wCanvasWrap"></div>
      <div class="toolbar" id="wAutoBar" style="display:none;margin-top:10px">
        <label class="w-slider">空白灵敏度 <input type="range" id="wSens" min="10" max="90" value="${WR.scan.sens}"><b id="wSensV">${WR.scan.sens}</b></label>
        <label class="w-slider">最小题高 <input type="range" id="wMinH" min="1" max="15" value="${WR.scan.minH}"><b id="wMinHV">${WR.scan.minH}%</b></label>
      </div>`
        : `<div class="empty">还没有试卷页</div>`}
    </div>

    <div class="card" id="wJobsCard">
      <div class="card-h">
        <h3>错题栏 <span class="tag gray" id="wJobsCount">${WR.jobs.length} 道</span></h3>
        <button class="btn ghost" id="wJobsClear">清空错题</button>
      </div>
      <div id="wJobsBox"></div>
      <div class="w-jobs-foot" id="wJobsFoot">
        <span class="w-selinfo" id="wSelInfo"></span>
        <span style="flex:1"></span>
        <button class="btn ghost" id="wRePrint">原题重组</button>
        <button class="btn primary-sm" id="wRebuild2">原题+举一反三重组</button>
      </div>
    </div>`,
    after: () => {
      const aiBtn = document.getElementById('wAiCfg');
      if (aiBtn) aiBtn.onclick = () => openAiConfig();
      const rb1 = document.getElementById('wRebuild');
      if (rb1) rb1.onclick = rebuildAll;
      const rb2 = document.getElementById('wRebuild2');
      if (rb2) rb2.onclick = rebuildAll;
      const rp = document.getElementById('wRePrint');
      if (rp) rp.onclick = reprintChecked;
      const seg = document.getElementById('wAiSeg');
      if (seg) seg.onclick = aiSegmentPage;
      const aa = document.getElementById('wAddAll');
      if (aa) aa.onclick = addAllBoxes;
      const jc = document.getElementById('wJobsClear');
      if (jc) jc.onclick = async () => {
        if (!WR.jobs.length) return toast('错题栏已经是空的', 'err');
        if (!await elConfirm({ title: '清空错题', message: `确定清空所有错题？共 ${WR.jobs.length} 道，删除后不可恢复。`, okText: '清空', danger: true })) return;
        WR.jobs = []; renderJobs(); renderSegEditor(); renderThumbs(); updateSegCount();
      };
      const cp = document.getElementById('wClearPages');
      if (cp) cp.onclick = async () => {
        if (!WR.scan.pages.length) return toast('还没有扫描页', 'err');
        if (!await elConfirm({ title: '清空扫描页', message: `清空 ${WR.scan.pages.length} 张扫描页？（待重组清单不受影响）`, okText: '清空', danger: true })) return;
        WR.scan.pages = []; WR.scan.cur = -1;
        render(); return;
      };
      bindCamera();
      const demo = document.getElementById('wDemo');
      if (demo) demo.onclick = () => {
        addPage(demoPage(), demoBoxes());
        renderThumbs(); rerenderSegArea();
        toast('已载入示例试卷，并预置了 6 个示例框：点框上的 ➕ 加入错题栏，也可拖动/缩放/删除或自己拖新框', 'ok');
      };
      if (location.hash.includes('demo=1') && !WR.scan.pages.length) addPage(demoPage(), demoBoxes());
      renderThumbs();
      renderJobs();
      if (cur) bindSegEditor();
    },
  };
}

/** 错题栏（已加入的题目，本地暂存；每题可勾选，右上角一键清空） */
function renderJobs() {
  const box = document.getElementById('wJobsBox');
  const cnt = document.getElementById('wJobsCount');
  const sel = WR.jobs.filter((j) => j.sel);
  if (cnt) cnt.textContent = `${WR.jobs.length} 道`;
  const info = document.getElementById('wSelInfo');
  if (info) info.textContent = WR.jobs.length ? `已勾选 ${sel.length} / ${WR.jobs.length} 道` : '';
  if (!box) return;
  if (!WR.jobs.length) {
    box.innerHTML = '<div class="empty" style="padding:20px">还没有错题</div>';
    return;
  }
  box.innerHTML = `<div class="w-grid">${WR.jobs.map((j, i) => `
    <div class="w-item ${j.sel ? '' : 'off'}">
      <label class="w-item-chk" title="勾选后才会参与重组"><input type="checkbox" data-jchk="${i}" ${j.sel ? 'checked' : ''}></label>
      <canvas data-job="${i}" width="${j.w}" height="${j.h}"></canvas>
      <div class="w-item-bar"><span class="w-seq">#${i + 1}</span><span class="w-dim">${j.w}×${j.h}</span>
        <button class="link-btn danger" data-jobdel="${i}">移除</button></div>
    </div>`).join('')}</div>`;
  WR.jobs.forEach((j, i) => {
    const cv = box.querySelector(`[data-job="${i}"]`);
    const c2d = cv && cv.getContext ? cv.getContext('2d') : null;
    if (c2d) c2d.drawImage(j.canvas, 0, 0);
  });
  box.querySelectorAll('[data-jchk]').forEach((c) => c.onchange = () => {
    WR.jobs[Number(c.dataset.jchk)].sel = c.checked ? 1 : 0;
    renderJobs();
  });
  box.querySelectorAll('[data-jobdel]').forEach((b) => b.onclick = () => {
    WR.jobs.splice(Number(b.dataset.jobdel), 1);
    renderJobs();
  });
}

/** 一键重组（举一反三）：勾选的题逐题交给 AI 识别 + 生成变式，再排成两栏 PDF */
async function rebuildAll() {
  if (WR.busy) return toast('正在重组中，请稍等…', 'err');
  const jobs = WR.jobs.filter((j) => j.sel);
  if (!WR.jobs.length) return toast('错题栏还是空的：先 AI 识别 / 拖框，点 ➕ 把错题加进来', 'err');
  if (!jobs.length) return toast('请先在错题栏勾选要重组的题目', 'err');

  // 没配 AI 也能出卷（右栏留提示），但先提醒一句
  try {
    const cfg = await api('/api/admin/ai/config');
    if (cfg && !cfg.mock && !cfg.hasKey) {
      if (!await elConfirm({ title: '未配置 AI', message: '还没有配置 AI 接口密钥，无法识别题目、也生成不了「举一反三」。\n\n点「确定」继续（右栏会印一句提示，只排原题），点「取消」先去配好 AI。', okText: '继续' })) return;
    }
  } catch (e) { /* 读配置失败不阻塞 */ }

  WR.busy = true;
  const total = jobs.length;
  const bar = rebuildProgress(total);
  const items = [];
  const answerEntries = [];
  const warns = [];
  try {
    for (let i = 0; i < total; i++) {
      bar.set(i, `AI 正在识别第 ${i + 1} / ${total} 题（题干 + 知识点 + 举一反三）…`);
      const j = jobs[i];
      let d = null;
      try {
        const blob = await canvasToBlob(j.canvas);
        if (!blob) throw new Error('图片导出失败');
        const fd = new FormData();
        fd.append('image', blob, 'q.png');
        d = await api('/api/admin/wrong/analyze', { method: 'POST', body: fd, raw: true });
      } catch (e) {
        warns.push(`第 ${i + 1} 题识别失败：${e.message || e}`);
        continue;
      }
      if (!d) { warns.push(`第 ${i + 1} 题：服务端没有返回结果`); continue; }
      if (d.error) warns.push(`第 ${i + 1} 题：${d.error}`);
      const vc = renderVariantCard(i + 1, d.info || {}, d.variants || []);
      items.push({ key: d.key, variant: vc ? vc.toDataURL('image/png') : '', ai: d.info || null });
      answerEntries.push({ no: i + 1, variants: d.variants || [] });
    }
    if (!items.length) {
      bar.close(); WR.busy = false;
      return toast('所有题目都没能识别成功', 'err');
    }
    bar.set(items.length, 'AI 生成完毕，正在排版两栏 A4 练习卷…');
    const title = 'AI错题重组 ' + wNow().slice(0, 16);
    const banner = makeRebuildHeader('AI错题重组 · 左栏原题 / 右栏举一反三', wNow().slice(0, 16) + ' · ' + items.length + ' 题');
    const answers = renderAnswerPages(answerEntries);
    const out = await api('/api/admin/wrong/rebuild', { method: 'POST', body: { title, items, banner, answers } });
    bar.close();
    WR.busy = false;
    showRebuildResult(out, warns);
  } catch (e) {
    bar.close();
    WR.busy = false;
    toast('重组失败：' + (e.message || e), 'err');
  }
}

/** 简单的进度浮层（AI 逐题识别较慢，让老师看得见进度） */
function rebuildProgress(total) {
  const wrap = document.createElement('div');
  wrap.className = 'mask';
  wrap.innerHTML = `<div class="modal">
    <div class="modal-h"><h3>正在原题+举一反三重组</h3></div>
    <div class="modal-b">
      <div style="height:10px;border-radius:6px;background:#eef2f8;overflow:hidden;margin-bottom:14px">
        <i id="rbBar" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#2f6bff,#22d3ee);transition:width .3s"></i>
      </div>
      <p id="rbMsg" style="color:var(--text2);margin:0">准备中…</p>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  return {
    set: (done, msg) => {
      const b = wrap.querySelector('#rbBar');
      const m = wrap.querySelector('#rbMsg');
      if (b) b.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
      if (m) m.textContent = msg || '';
    },
    close: () => wrap.remove(),
  };
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) return canvas.toBlob((b) => resolve(b), 'image/png');
    try {
      const url = canvas.toDataURL('image/png');
      const bin = atob(url.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type: 'image/png' }));
    } catch (e) { resolve(null); }
  });
}

/**
 * 把 AI 生成的「举一反三」渲染成一张图片（PDF 里不需要中文字体，中文靠浏览器画好再贴进去）
 * @param {number} no        题号
 * @param {object} info      { subject, knowledge, type, stem }
 * @param {Array}  variants  [{stem, answer, analysis}]
 */
function renderVariantCard(no, info, variants) {
  const probe = document.createElement('canvas');
  const m = probe.getContext && probe.getContext('2d');
  if (!m) return null;
  const W = 900;
  const PAD = 28;
  const maxW = W - PAD * 2;
  const F = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';

  const rows = [];
  const gap = (n) => rows.push({ gap: n });
  const wrapText = (text, size, weight) => {
    m.font = `${weight || 400} ${size}px ${F}`;
    const out = [];
    for (const para of String(text || '').split('\n')) {
      let curLine = '';
      for (const ch of para) {
        if (curLine && m.measureText(curLine + ch).width > maxW) { out.push(curLine); curLine = ch; }
        else curLine += ch;
      }
      out.push(curLine);
    }
    return out;
  };
  const put = (text, o) => {
    if (!text) return;
    const size = o.size || 24;
    const lh = o.lh || Math.round(size * 1.55);
    for (const line of wrapText(text, size, o.weight)) {
      rows.push({ text: line, size, weight: o.weight || 400, color: o.color || '#1a1a1a', lh });
    }
  };

  // 标题区
  put(`举一反三 · 第 ${no} 题`, { size: 28, weight: 700, color: '#2f6bff', lh: 42 });
  const sub = [info.subject, info.knowledge].filter(Boolean).join(' · ');
  if (sub) put(sub, { size: 22, color: '#0e9f5f', lh: 34 });
  else if (info.type) put(info.type, { size: 22, color: '#0e9f5f', lh: 34 });
  gap(14);

  if (!variants.length) {
    put('（没有生成变式题）', { size: 22, color: '#c77700', lh: 34 });
  } else {
    variants.forEach((v, i) => {
      put(`变式${['一', '二', '三', '四'][i] || i + 1}`, { size: 24, weight: 700, color: '#111827', lh: 36 });
      put(v.stem, { size: 24, lh: 37 });
      if (i !== variants.length - 1) gap(18);
    });
  }

  let h = PAD;
  for (const r of rows) h += r.gap !== undefined ? r.gap : (r.lh || 0);
  h += PAD;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.max(180, Math.min(4400, Math.round(h)));
  const x = c.getContext && c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#2f6bff';
  x.fillRect(0, 0, 6, c.height);          // 左侧色条：和「原题」一眼区分
  x.textBaseline = 'top';
  let y = PAD;
  for (const r of rows) {
    if (r.gap !== undefined) { y += r.gap; continue; }
    x.fillStyle = r.color;
    x.font = `${r.weight} ${r.size}px ${F}`;
    x.fillText(r.text, PAD, y);
    y += r.lh;
  }
  return c;
}

/** 答案与解析单独成页：题目页只留题干，答案整卷收在后面 */
function renderAnswerPages(entries) {
  const list = (entries || []).filter((e) => (e.variants || []).some((v) => v.answer || v.analysis));
  if (!list.length) return [];
  const probe = document.createElement('canvas');
  const m = probe.getContext && probe.getContext('2d');
  if (!m) return [];
  const W = 1200;
  const PAD = 48;
  const maxW = W - PAD * 2;
  const MAX_H = 1680;
  const F = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';
  const pages = [];
  let rows = [];
  let used = PAD;

  const wrapText = (text, size, weight) => {
    m.font = `${weight || 400} ${size}px ${F}`;
    const out = [];
    for (const para of String(text || '').split('\n')) {
      let curLine = '';
      for (const ch of para) {
        if (curLine && m.measureText(curLine + ch).width > maxW) { out.push(curLine); curLine = ch; }
        else curLine += ch;
      }
      if (curLine || !para) out.push(curLine);
    }
    return out;
  };
  const blockOf = (entry) => {
    const block = [];
    const put = (text, o) => {
      if (!text) return;
      const size = o.size || 26;
      const lh = o.lh || Math.round(size * 1.5);
      for (const line of wrapText(text, size, o.weight)) {
        block.push({ text: line, size, weight: o.weight || 400, color: o.color || '#1a1a1a', lh });
      }
    };
    put(`第 ${entry.no} 题`, { size: 30, weight: 700, color: '#111827', lh: 46 });
    (entry.variants || []).forEach((v, i) => {
      if (!v.answer && !v.analysis) return;
      put(`变式${['一', '二', '三', '四'][i] || i + 1}`, { size: 26, weight: 700, color: '#2f6bff', lh: 40 });
      if (v.answer) put('答案：' + v.answer, { size: 26, weight: 600, color: '#0e9f5f', lh: 40 });
      if (v.analysis) put('解析：' + v.analysis, { size: 24, color: '#3d4a5c', lh: 38 });
    });
    block.push({ gap: 28 });
    return block;
  };
  const blockHeight = (rs) => rs.reduce((n, r) => n + (r.gap !== undefined ? r.gap : r.lh), 0);
  const flush = () => {
    if (!rows.length) return;
    const first = pages.length === 0;
    const h = used + PAD;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = Math.max(240, Math.round(h));
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.textBaseline = 'top';
    let y = PAD;
    if (first) {
      x.fillStyle = '#111';
      x.font = `700 40px ${F}`;
      x.fillText('答案与解析', PAD, y);
      y += 64;
    }
    for (const r of rows) {
      if (r.gap !== undefined) { y += r.gap; continue; }
      x.fillStyle = r.color;
      x.font = `${r.weight} ${r.size}px ${F}`;
      x.fillText(r.text, PAD, y);
      y += r.lh;
    }
    pages.push(c.toDataURL('image/png'));
    rows = [];
    used = PAD;
  };

  for (const entry of list) {
    const block = blockOf(entry);
    const bh = blockHeight(block);
    if (rows.length && used + bh > MAX_H - PAD) flush();
    if (!rows.length && pages.length === 0) used += 64;
    rows.push(...block);
    used += bh;
  }
  flush();
  return pages;
}

/** 卷头：标题 + 日期 + 两栏标题（栏位与 PDF 版心对齐） */
function makeRebuildHeader(title, subtitle) {
  const c = document.createElement('canvas');
  if (!c.getContext) return '';
  c.width = 1608;
  c.height = 172;
  const x = c.getContext('2d');
  const F = '"Microsoft YaHei","PingFang SC",sans-serif';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.textBaseline = 'middle';
  x.fillStyle = '#111'; x.font = `700 46px ${F}`;
  x.fillText(String(title).slice(0, 30), 8, 46);
  x.fillStyle = '#5a6b85'; x.font = `28px ${F}`; x.textAlign = 'right';
  x.fillText(String(subtitle || ''), c.width - 8, 50);
  x.textAlign = 'left';
  // 页宽 595.28pt、左右边距 34pt、栏距 18pt → 栏宽 (527.28-18)/2 = 254.64pt
  const s = c.width / (595.28 - 68);
  const chip = (label, cx, color) => {
    x.fillStyle = color;
    x.fillRect(cx, 108, 156, 46);
    x.fillStyle = '#fff';
    x.font = `600 28px ${F}`;
    x.textAlign = 'center';
    x.fillText(label, cx + 78, 132);
  };
  chip('原题', 0, '#111827');
  chip('举一反三', Math.round((254.64 + 18) * s), '#2f6bff');
  x.textAlign = 'left';
  x.strokeStyle = '#222'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(0, c.height - 3); x.lineTo(c.width, c.height - 3); x.stroke();
  return c.toDataURL('image/png');
}

/** 重组结果：直接预览 + 打印 / 下载 */
function showRebuildResult(out, warns) {
  const url = pdfUrl(out.key, out.file_name);
  const warnBox = (warns && warns.length)
    ? `<div style="background:#fff5e6;color:#c77700;border:1px solid #ffe0b2;padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px">
        ⚠️ ${warns.slice(0, 5).map(esc).join('<br>')}${warns.length > 5 ? `<br>…共 ${warns.length} 条提示` : ''}
       </div>` : '';
  modal({
    title: `重组完成：${out.count} 题 / ${out.pages} 页`,
    wide: true,
    body: `${warnBox}
      <iframe src="${url}" style="width:100%;height:64vh;border:0;background:#fff"></iframe>
      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary-sm" id="rbPrint">打印</button>
        <button class="btn ghost" id="rbDl">下载 PDF</button>
        <button class="btn ghost" id="rbAgain">重新生成</button>
      </div>`,
    onMount: (w, err) => {
      w.querySelector('#rbPrint').onclick = () => window.open(url, '_blank');
      w.querySelector('#rbDl').onclick = () => downloadUrl(out.key, out.file_name);
      w.querySelector('#rbAgain').onclick = async () => {
        w.remove();
        await rebuildAll();
      };
      void err;
    },
  });
}

/* ------------------------------------------------------------ AI 整页识别 + 按题加入 */

/** 把 AI 返回的相对坐标框换算成页图像素框（兼容 0~1 与 0~1000 两种刻度） */
function relBoxesToPage(questions, page) {
  const arr = Array.isArray(questions) ? questions : [];
  const over = arr.some((q) => [q.x, q.y, q.w, q.h].some((v) => Number(v) > 1.5)); // 有些模型按 0~1000 输出
  const k = over ? 1000 : 1;
  return arr.map((q) => fitBox({
    x: (Number(q.x) || 0) / k * page.w,
    y: (Number(q.y) || 0) / k * page.h,
    w: (Number(q.w) || 0.9) / k * page.w,
    h: (Number(q.h) || 0.05) / k * page.h,
  }, page)).map((b, i) => ({ ...b, stem: (questions[i] && questions[i].stem) || '' }));
}

/** AI 整页识别：整页照片 → 每道题一个框（可拖动微调）；已有框时先确认再覆盖 */
async function aiSegmentPage() {
  const page = WR.scan.pages[WR.scan.cur];
  if (!page) return toast('先拍一张（或用「上传文件」「载入示例试卷」）再识别', 'err');
  if (WR.segBusy) return toast('正在识别中，请稍等…', 'err');
  const nOld = boxesOf(page).length;
  if (nOld && page.boxes.some((b) => b.added) && !await elConfirm({ title: '重新识别', message: `当前页已有 ${nOld} 个框（部分已加入错题栏）。\n重新识别会覆盖这些框（错题栏里已加入的不受影响），继续吗？` })) return;

  const btn = document.getElementById('wAiSeg');
  WR.segBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = '识别中…'; }
  try {
    const blob = await canvasToBlob(page.canvas);
    if (!blob) throw new Error('页面图片导出失败');
    const fd = new FormData();
    fd.append('image', blob, 'page.png');
    const d = await api('/api/admin/wrong/segment', { method: 'POST', body: fd, raw: true });
    const qs = relBoxesToPage(d && d.questions, page);
    if (!qs.length) throw new Error('没识别出题目：这张图可能太模糊，或题目排布特殊，请直接手动拖框');
    page.boxes = qs;
    page.lines = []; page.blocks = [];
    renderSegEditor(); renderThumbs(); updateSegCount();
    toast(`AI 识别出 ${qs.length} 道题：点每个框上的 ➕ 加入错题栏（框不准可直接拖动微调）`, 'ok');
  } catch (e) {
    toast('AI 识别失败：' + (e.message || e) + '。可以直接在图上手动拖框。', 'err');
  } finally {
    WR.segBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'AI 识别全部题目'; }
  }
}

/** 把一个框裁成题目图片，加入错题栏（每题一个 ➕，加过的显示 ✅） */
function addBoxJob(page, ref) {
  const b = page && page.boxes[Number(ref)];
  if (!b) return;
  if (b.added) return toast('这道题已经在错题栏里了', 'err');
  const scale = Math.min(1, W_EXPORT_W / page.w);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(b.w * scale));
  c.height = Math.max(8, Math.round(b.h * scale));
  const ctx = c.getContext && c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(page.canvas, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  }
  WR.jobs.push({ id: 'j' + Date.now() + Math.random().toString(16).slice(2, 6), canvas: c, w: c.width, h: c.height, sel: 1 });
  b.added = 1;
  renderSegEditor(); renderThumbs(); renderJobs(); updateSegCount();
  toast(`已加入错题栏（第 ${WR.jobs.length} 道），继续点下一题的 ➕ 或去下方勾选重组`, 'ok');
}

/** 把当前页所有未加入的框全部加入错题栏 */
function addAllBoxes() {
  const page = WR.scan.pages[WR.scan.cur];
  if (!page) return toast('先拍一张（或用「上传文件」「载入示例试卷」）再操作', 'err');
  const bs = boxesOf(page).filter((b) => !b.added);
  if (!bs.length) return toast(boxesOf(page).length ? '这一页的题都已在错题栏里' : '当前页还没有框：先 AI 识别或手动拖框', 'err');
  const scale = Math.min(1, W_EXPORT_W / page.w);
  bs.forEach((b, i) => {
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(b.w * scale));
    c.height = Math.max(8, Math.round(b.h * scale));
    const ctx = c.getContext && c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(page.canvas, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
    }
    b.added = 1;
    WR.jobs.push({ id: 'j' + Date.now() + i + Math.random().toString(16).slice(2, 6), canvas: c, w: c.width, h: c.height, sel: 1 });
  });
  renderSegEditor(); renderThumbs(); renderJobs(); updateSegCount();
  toast(`已把 ${bs.length} 道题加入错题栏（共 ${WR.jobs.length} 道），在下方勾选后即可重组`, 'ok');
}

/** 原题重组：勾选的原题 → 弹窗设置栏数/题间距 → 上传入库 → 排成练习卷 PDF */
async function reprintChecked() {
  const jobs = WR.jobs.filter((j) => j.sel);
  if (!WR.jobs.length) return toast('错题栏还是空的：先 AI 识别 / 拖框，点 ➕ 把错题加进来', 'err');
  if (!jobs.length) return toast('请先在错题栏勾选要重组的题目', 'err');
  if (WR.busy) return toast('正在生成中，请稍等…', 'err');

  modal({
    title: `原题重组（${jobs.length} 道）`,
    body: `
      <div class="field"><label>每页栏数</label>
        <select class="input" id="rpCols">
          <option value="2" selected>2 栏（推荐，A4 两栏）</option>
          <option value="1">1 栏（题目更大）</option>
          <option value="3">3 栏（小题多时用）</option>
        </select></div>
      <div class="field"><label>题目之间的间隔：<b id="rpGapV">10</b> pt</label>
        <input type="range" id="rpGap" min="0" max="40" value="10" style="width:100%"></div>
      <label class="w-chk" style="display:flex;align-items:center;gap:8px;margin-top:6px"><input type="checkbox" id="rpIdx" checked> 显示题号</label>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
        <button class="btn ghost" id="rpCancel">取消</button>
        <button class="btn primary-sm" id="rpGo">生成练习卷</button>
      </div>`,
    onMount: (w) => {
      const gap = w.querySelector('#rpGap');
      gap.oninput = () => { w.querySelector('#rpGapV').textContent = gap.value; };
      w.querySelector('#rpCancel').onclick = () => w.remove();
      w.querySelector('#rpGo').onclick = async () => {
        WR.busy = true;
        const btn = w.querySelector('#rpGo');
        btn.disabled = true; btn.textContent = '正在生成…';
        try {
          const fd = new FormData();
          for (const j of jobs) {
            const blob = await canvasToBlob(j.canvas);
            if (!blob) throw new Error('题目图片导出失败');
            fd.append('images', blob, 'q.png');
          }
          const up = await api('/api/admin/wrong/items', { method: 'POST', body: fd, raw: true });
          const ids = (up && up.items ? up.items : []).map((x) => x.id);
          if (!ids.length) throw new Error('题目入库失败');
          const out = await api('/api/admin/wrong/sets', {
            method: 'POST',
            body: {
              itemIds: ids,
              columns: Number(w.querySelector('#rpCols').value) || 2,
              lineGap: Number(gap.value) || 0,
              showIndex: w.querySelector('#rpIdx').checked ? 1 : 0,
              title: '错题重组 ' + wNow().slice(0, 16),
            },
          });
          w.remove();
          showRebuildResult(out, []);
        } catch (e) {
          toast('原题重组失败：' + (e.message || e), 'err');
          btn.disabled = false; btn.textContent = '生成练习卷';
        } finally { WR.busy = false; }
      };
    },
  });
}

/** 示例试卷：用浏览器自带的画布画一张「假试卷」，让用户没摄像头也能先把流程走一遍 */
function demoPage() {
  const w = 1240, h = 1650;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext && c.getContext('2d');
  if (!x) return c; // 无 canvas 能力的环境只返回空画布，示例框仍可用
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#111';
  x.font = '600 40px "Microsoft YaHei","PingFang SC",sans-serif';
  x.fillText('七年级数学 · 第一章 有理数 · 单元测试', 60, 110);
  x.strokeStyle = '#333'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(60, 135); x.lineTo(w - 60, 135); x.stroke();
  const qs = [
    '1. 计算：(-3) + 5 - (-2) = ______',
    '2. 解方程：2x + 5 = 13，则 x = ______',
    '3. 化简：(3a - 2b) - (a + 4b) = ______',
    '4. 已知 x² - 5x + 6 = 0，求 x 的值。',
    '5. 一架飞机以 800 km/h 飞行 3.5 小时，共飞行多少千米？',
    '6. 计算：(-2)³ × 3 - (-4) ÷ 2 = ______',
    '7. 比较大小：-3/4 ___ -5/6（填 > 或 <）',
    '8. 数轴上点 A 表示 -2，点 B 与 A 相距 5 个单位，求 B 表示的数。',
  ];
  let y = 200;
  qs.forEach((t) => {
    x.fillStyle = '#111'; x.font = '34px "Microsoft YaHei","PingFang SC",sans-serif';
    x.fillText(t, 70, y);
    y += 42; // 答题行紧跟题干（间距小，不会被切开）
    x.fillStyle = '#8a97ad'; x.font = '30px "Microsoft YaHei","PingFang SC",sans-serif';
    x.fillText('答：', 90, y);
    y += 208; // 题与题之间留大段空白（自动识别就靠这个；手动框选不需要）
  });
  return c;
}

/** 示例试卷上预先画好的 6 个示例框（位置与 demoPage 的画法对应），让人一眼看懂「框」长什么样 */
function demoBoxes() {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const stem = 200 + i * 250; // demoPage 里第 i 题的题干基线
    out.push({ x: 40, y: stem - 38, w: 1160, h: 110 });
  }
  return out;
}

/* ============================================================ 旧路由兼容 */
/** 旧路由 #/wrong-scan 已与 #/wrong 合并为同一个工作台（新版不需要单独页面） */
const viewWrongScan = () => viewWrong();

/* ------------------------------------------------------------ 摄像头自检 */
/** 判断当前环境能不能调摄像头：https 或 localhost 都算安全上下文（浏览器规定） */
function camEnv() {
  const host = (location.hostname || '');
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  return { host, isLocalHost, secure: !!window.isSecureContext || isLocalHost };
}

/** 把各种报错翻译成「该怎么办」 */
function camErrorHint(e) {
  const n = (e && e.name) || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError')
    return '权限被拒绝。① 点浏览器地址栏左侧的 🔒/⚙ 图标 → 把「摄像头」改成「允许」；② Windows 打开 设置 → 隐私和安全性 → 摄像头，确认「允许桌面应用访问你的摄像头」是开着的；改完刷新页面再点一次。';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError')
    return '没找到摄像头设备。确认 USB 摄像头插好了（笔记本自带摄像头在设备管理器里是否正常），然后点「🔄 重新检测摄像头」。';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError' || n === 'SourceUnavailableError')
    return '摄像头被别的程序占用了（相机 App、腾讯会议、钉钉、Zoom，或另一个浏览器标签页正在用）。把那些程序关掉，再点「开启摄像头」。';
  if (n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError')
    return '这个摄像头不支持所要求的分辨率，已自动改用默认参数重试。';
  if (n === 'SecurityError')
    return '浏览器安全限制：必须用 https:// 或 http://localhost 打开后台页面才能调用摄像头（局域网 IP 直连不行）。';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return '当前页面环境不提供摄像头接口：请用 https:// 或 http://localhost:3000 打开后台（局域网 IP 不行）。这段时间可以直接用「📎 上传文件」上传图片或 PDF。';
  return (e && e.message) || '未知错误';
}

/** 摄像头体检：把「能不能用、为什么不能用、怎么办」直接写在页面上 */
async function camDiagnose() {
  const box = document.getElementById('wDiag');
  if (!box) return;
  const ok = (t) => `<div class="w-diag-row ok">✅ ${t}</div>`;
  const bad = (t) => `<div class="w-diag-row bad">⚠️ ${t}</div>`;
  const inf = (t) => `<div class="w-diag-row">· ${t}</div>`;
  const out = [];
  const env = camEnv();

  if (env.secure) out.push(ok(`页面地址 ${esc(location.protocol)}//${esc(location.host)} 是安全上下文，浏览器允许网页调用摄像头。`));
  else out.push(bad(`当前地址是 ${esc(location.protocol)}//${esc(location.host)}，不是安全上下文——浏览器规定只有 <b>https://</b> 或 <b>localhost / 127.0.0.1</b> 才允许网页调用摄像头，所以电脑明明有摄像头也用不了。`));
  if (!env.secure) out.push(inf('办法：① 在装了本系统的那台电脑上，用 <b>http://localhost:3000</b> 打开后台；② 手机/其他电脑访问，等域名备案后用 https；③ 现在就想用，直接点「📎 上传文件」上传手机拍好的照片或试卷 PDF，效果完全一样。'));

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    out.push(bad('这个浏览器没有提供摄像头接口（浏览器太旧，或页面不是 https/localhost）。建议用较新的 Chrome / Edge。'));
  } else {
    out.push(ok('浏览器支持网页调用摄像头。'));
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (!devs.length) out.push(bad('没有枚举到任何摄像头设备（可能被系统隐私设置屏蔽，或驱动异常）。检查 设备管理器 → 照相机，以及 设置 → 隐私和安全性 → 摄像头 →「允许桌面应用访问你的摄像头」。'));
      else {
        const named = devs.filter((d) => d.label);
        out.push(ok(`检测到 ${devs.length} 个摄像头${named.length ? '：' + named.map((d) => esc(d.label)).join('、') : '（名称要在授权一次之后才会显示）'}。`));
      }
    } catch (e) { out.push(inf('设备列表读取失败：' + esc(e.message || e))); }
  }
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: 'camera' });
      if (st.state === 'denied') out.push(bad('浏览器已记住「拒绝」：点地址栏左侧图标 → 摄像头 → 允许，然后刷新页面。'));
      else if (st.state === 'granted') out.push(ok('摄像头权限已授权。'));
      else out.push(inf('摄像头权限还没授权：点「开启摄像头」时浏览器会弹窗，选「允许」就好。'));
    }
  } catch (e) { /* 部分浏览器不支持查询 camera 权限，忽略 */ }
  if (WR.scan.stream) out.push(ok('摄像头正在使用中。'));
  box.innerHTML = out.join('');
}


function bindCamera() {
  const video = document.getElementById('wVideo');
  const tip = document.getElementById('wTip');
  const show = (t) => { if (tip) tip.textContent = t; };

  // 拍下第一张后会整页重绘（让框选编辑区展开），新的 <video> 元素需要重新挂上已有的摄像头流，
  // 否则预览变黑、再点「拍照」会提示「摄像头还没就绪」，必须手动重开。
  if (video && WR.scan.stream) {
    video.srcObject = WR.scan.stream;
    video.play().catch(() => {});
  }

  const stop = () => {
    if (WR.scan.stream) { WR.scan.stream.getTracks().forEach((t) => t.stop()); WR.scan.stream = null; }
  };
  // 离开页面时关闭摄像头：只绑一次（每次 render 都绑会累积监听）
  if (!WR.camHashBound) {
    WR.camHashBound = true;
    window.addEventListener('hashchange', stop);
  }

  const openCamera = async () => {
    const btn = document.getElementById('wCamOn');
    if (btn) { btn.disabled = true; btn.textContent = '正在开启…'; }
    show('正在请求摄像头…');
    try {
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const err = new Error('当前页面环境不提供摄像头接口');
        err.name = 'SecurityError';
        throw err;
      }
      const wanted = WR.scan.deviceId
        ? { deviceId: { exact: WR.scan.deviceId } }
        : { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: wanted });
      } catch (e1) {
        // 分辨率/前后摄像头这类「要求过严」的失败，退回到最朴素的参数再来一次
        if (e1 && /Overconstrained|ConstraintNotSatisfied/i.test(e1.name || '')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } else throw e1;
      }
      WR.scan.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      show('摄像头已开启');
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const sel = document.getElementById('wDev');
        if (sel && devs.length) {
          sel.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === WR.scan.deviceId ? 'selected' : ''}>${esc(d.label || '摄像头 ' + (i + 1))}</option>`).join('');
          sel.onchange = () => { WR.scan.deviceId = sel.value; openCamera(); };
        }
      } catch (e) { /* 枚举失败不影响拍照 */ }
    } catch (e) {
      const hint = camErrorHint(e);
      show('摄像头开启失败');
      toast(hint, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '开启摄像头'; }
    }
  };
  document.getElementById('wCamOn').onclick = openCamera;

  document.getElementById('wShot').onclick = () => captureFrame(video, show);
  const auto = document.getElementById('wAuto');
  auto.onchange = () => {
    if (WR.scan.autoShot) { clearInterval(WR.scan.autoShot); WR.scan.autoShot = null; }
    if (auto.checked) {
      WR.scan.autoShot = setInterval(() => {
        if (WR.scan.busy) return;
        captureFrame(video, show, true);
      }, 2000);
    }
  };
  const diagBtn = document.getElementById('wDiagBtn');
  if (diagBtn) diagBtn.onclick = () => camDiagnose();
  document.getElementById('wFiles').onchange = onPickFiles;
}

/** 上传文件（图片 / PDF）：图片直接入页，PDF 交给 PdfPages 逐页转成页面 */
async function onPickFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  if (!window.PdfPages) return toast('上传组件没加载成功，请刷新页面（Ctrl+F5）后重试', 'err');
  let added = 0;
  if (!document.getElementById('wCanvasWrap')) await render();   // 空态先渲染出框选区，避免整页重绘打断后续几页

  const st = await PdfPages.upload(files, {
    maxPages: 20,
    maxWidth: W_MAXW,
    progressTitle: '正在读取文件',
    progressTip: '',
    onImage: async (f) => {
      const first = !WR.scan.pages.length;
      const okAdd = await imageFileToPage(f);
      if (!okAdd) return;
      added++;
      if (first) await new Promise((r) => setTimeout(r, 60)); // 首张会整页重绘，等它把框选区挂上再继续
    },
    onPage: async (cv) => {
      const first = !WR.scan.pages.length;
      addPage(cv, [], { raw: true });                          // PDF 页本身干净，不再做去阴影/自动裁边
      added++;
      if (first) await new Promise((r) => setTimeout(r, 60));
    },
    onError: (msg) => toast(msg, 'err'),
  });

  if (added) {
    renderThumbs(); rerenderSegArea();
    toast(`已添加 ${added} 页试卷${st.pages ? '（其中 PDF ' + st.pages + ' 页）' : ''}，在图上拖框选题目`, 'ok');
  } else if (!st.skipped) {
    toast('没有可用的文件', 'err');
  }
  if (st.truncated) toast('这个 PDF 页数较多，只取了前 20 页；剩下的可以再上传一次', 'err');
}

/** 单张图片文件 → 试卷页（按 W_MAXW 等比缩放） */
function imageFileToPage(f) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => {
      const vw = i.naturalWidth || W_MAXW, vh = i.naturalHeight || W_MAXW;
      const scale = Math.min(1, W_MAXW / vw);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(vw * scale));
      c.height = Math.max(1, Math.round(vh * scale));
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(i.src);
      addPage(c);
      resolve(true);
    };
    i.onerror = () => { URL.revokeObjectURL(i.src); toast('图片读取失败：' + (f.name || ''), 'err'); resolve(false); };
    i.src = URL.createObjectURL(f);
  });
}

function captureFrame(video, show, silent) {
  if (!video || !video.videoWidth) { if (!silent) toast('摄像头还没就绪', 'err'); return; }
  const scale = Math.min(1, W_MAXW / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  addPage(c);
  if (!silent) { toast('已拍照', 'ok'); if (show) show('已拍照'); }
}

/** 实拍图 → 扫描图：去阴影、白底、字迹加深。拍照和上传都先过这一步再进页面。 */
function scanCanvas(src) {
  if (!src || !src.width || !src.height) return src;
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0, w, h);
  let img;
  try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return src; }
  const d = img.data;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  }
  const bs = 48;
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  const grid = new Uint16Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * bs;
      const y0 = gy * bs;
      const x1 = Math.min(w, x0 + bs);
      const y1 = Math.min(h, y0 + bs);
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) { sum += gray[y * w + x]; cnt++; }
      }
      grid[gy * gw + gx] = cnt ? (sum / cnt) | 0 : 255;
    }
  }
  const hist = new Uint32Array(256);
  const corr = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) / bs - 0.5;
    let gy0 = Math.floor(fy);
    if (gy0 < 0) gy0 = 0;
    if (gy0 > gh - 1) gy0 = gh - 1;
    let gy1 = gy0 + 1;
    if (gy1 > gh - 1) gy1 = gh - 1;
    let ty = fy - gy0;
    if (ty < 0) ty = 0;
    if (ty > 1) ty = 1;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) / bs - 0.5;
      let gx0 = Math.floor(fx);
      if (gx0 < 0) gx0 = 0;
      if (gx0 > gw - 1) gx0 = gw - 1;
      let gx1 = gx0 + 1;
      if (gx1 > gw - 1) gx1 = gw - 1;
      let tx = fx - gx0;
      if (tx < 0) tx = 0;
      if (tx > 1) tx = 1;
      let bg = grid[gy0 * gw + gx0] * (1 - tx) * (1 - ty)
        + grid[gy0 * gw + gx1] * tx * (1 - ty)
        + grid[gy1 * gw + gx0] * (1 - tx) * ty
        + grid[gy1 * gw + gx1] * tx * ty;
      if (bg < 28) bg = 28;
      let v = Math.round(gray[y * w + x] * 236 / bg);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      corr[y * w + x] = v;
      hist[v]++;
    }
  }
  const loN = (n * 0.02) | 0;
  const hiN = (n * 0.90) | 0;
  let lo = 0;
  let hi = 255;
  let seen = 0;
  for (let i = 0; i < 256; i++) { seen += hist[i]; if (seen >= loN) { lo = i; break; } }
  seen = 0;
  for (let i = 0; i < 256; i++) { seen += hist[i]; if (seen >= hiN) { hi = i; break; } }
  if (hi <= lo + 8) { lo = 0; hi = 255; }
  const span = hi - lo || 1;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let t = (corr[i] - lo) / span;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    let v = Math.round(t * 255);
    if (v >= 214) v = 255;
    else if (v <= 48) v = (v * 0.72) | 0;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 拍照 / 上传进来的一帧，先做成扫描图再成为试卷页 */
function addPage(frameCanvas, boxes) {
  WR.scan.busy = true;
  let page = null;
  try {
    const canvas = scanCanvas(frameCanvas);
    page = {
      id: Date.now() + Math.random().toString(16).slice(2, 6),
      canvas, w: canvas.width, h: canvas.height, lines: [], blocks: [],
      boxes: (boxes || []).map((b) => ({ ...b })),
    };
    WR.scan.pages.push(page);
    WR.scan.cur = WR.scan.pages.length - 1;
  } finally {
    WR.scan.busy = false;
  }
  // 框选区如果还是「空态」（本次是第一张），整页刷新一次让编辑区展开
  if (!document.getElementById('wCanvasWrap')) { render(); return page; }
  renderThumbs();
  rerenderSegArea();
  return page;
}

/** 页面列表（缩略图，可切换/删除/旋转） */
function renderThumbs() {
  const box = document.getElementById('wThumbs');
  if (!box) return;
  const pages = WR.scan.pages;
  if (!pages.length) { box.innerHTML = '<div class="w-thumb-empty">还没有页面</div>'; return; }
  box.innerHTML = pages.map((p, i) => `
    <div class="w-thumb ${i === WR.scan.cur ? 'on' : ''}" data-i="${i}">
      <canvas width="${p.w}" height="${p.h}" data-cv="${i}"></canvas>
      <div class="w-thumb-bar"><span>${i + 1}</span><span>${boxesOf(p).length} 道</span>
        <button class="link-btn" data-rot="${i}">旋转</button>
        <button class="link-btn danger" data-rm="${i}">删除</button></div>
    </div>`).join('');
  pages.forEach((p, i) => {
    const cv = box.querySelector(`[data-cv="${i}"]`);
    const c2d = cv && cv.getContext ? cv.getContext('2d') : null; // jsdom 等无 canvas 环境下为 null
    if (c2d) c2d.drawImage(p.canvas, 0, 0);
  });
  box.querySelectorAll('[data-i]').forEach((el) => el.onclick = (e) => {
    if (e.target.dataset.rot !== undefined || e.target.dataset.rm !== undefined) return;
    WR.scan.cur = Number(el.dataset.i);
    renderThumbs(); rerenderSegArea();
  });
  box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    WR.scan.pages.splice(Number(b.dataset.rm), 1);
    WR.scan.cur = Math.min(WR.scan.cur, WR.scan.pages.length - 1);
    renderThumbs(); rerenderSegArea();
  });
  box.querySelectorAll('[data-rot]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const p = WR.scan.pages[Number(b.dataset.rot)];
    rotatePage(p);
    renderThumbs(); rerenderSegArea();
  });
}

function rotatePage(page) {
  const c = document.createElement('canvas');
  c.width = page.h; c.height = page.w;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate(Math.PI / 2);
  x.drawImage(page.canvas, -page.w / 2, -page.h / 2);
  page.canvas = c; page.w = c.width; page.h = c.height;
  page.boxes = [];   // 转 90° 后原来的框位置全失效，清掉重框（比错位好）
  page.lines = []; page.blocks = [];
}

/** 框选区整体重绘（页签切换/参数变化后调用）；空态也要把按钮绑上，否则点了没反应 */
function rerenderSegArea() {
  const card = document.getElementById('wSegCard');
  if (!card) return;
  const cur = WR.scan.pages[WR.scan.cur];
  const needPage = () => { if (!cur) { toast('先拍一张（或用「上传文件」「载入示例试卷」）再操作', 'err'); return true; } return false; };

  const whole = document.getElementById('wWhole');
  if (whole) whole.onclick = () => {
    if (needPage()) return;
    cur.boxes = [{ x: 0, y: 0, w: cur.w, h: cur.h }];
    renderSegEditor(); renderThumbs(); updateSegCount();
  };
  const clear = document.getElementById('wClearBox');
  if (clear) clear.onclick = async () => {
    if (needPage()) return;
    const n = boxesOf(cur).length;
    if (!n) return toast('当前页没有框', 'err');
    if (!await elConfirm({ title: '清空框选', message: `清空当前页画好的 ${n} 个框？`, okText: '清空', danger: true })) return;
    cur.boxes = []; renderSegEditor(); renderThumbs(); updateSegCount();
  };
  const auto = document.getElementById('wAutoSeg');
  if (auto) auto.onclick = () => {
    if (needPage()) return;
    const n = autoSegment(cur);
    const autoBar = document.getElementById('wAutoBar');
    if (autoBar) autoBar.style.display = '';
    renderSegEditor(); renderThumbs(); updateSegCount();
    toast(n ? `自动识别出 ${n} 道题（只是初稿，拖框改成你要的）` : '这张图没识别出题目，直接手动拖框吧', n ? 'ok' : 'err');
  };
  if (!cur) return;

  const wrap = document.getElementById('wCanvasWrap');
  if (wrap) renderSegEditor();
  updateSegCount();

  const sens = document.getElementById('wSens');
  const minH = document.getElementById('wMinH');
  if (sens) sens.oninput = () => {
    WR.scan.sens = Number(sens.value);
    const v = document.getElementById('wSensV'); if (v) v.textContent = WR.scan.sens;
    clearTimeout(WR.scan.timer);
    WR.scan.timer = setTimeout(() => { autoSegment(cur); renderSegEditor(); updateSegCount(); }, 220);
  };
  if (minH) minH.oninput = () => {
    WR.scan.minH = Number(minH.value);
    const v = document.getElementById('wMinHV'); if (v) v.textContent = WR.scan.minH + '%';
    clearTimeout(WR.scan.timer);
    WR.scan.timer = setTimeout(() => { autoSegment(cur); renderSegEditor(); updateSegCount(); }, 220);
  };
}

function bindSegEditor() {
  rerenderSegArea();
}

function updateSegCount() {
  const el = document.getElementById('wSegCount');
  const cur = WR.scan.pages[WR.scan.cur];
  if (el && cur) el.textContent = boxesOf(cur).length + ' 道';
}

/* ------------------------------------------------------------ 框选编辑器 */
/** 页图 + 可直接拖拽的矩形框：空白处拖 = 新建框；框内拖 = 移动；右下角 = 缩放；× = 删除 */
function renderSegEditor() {
  const page = WR.scan.pages[WR.scan.cur];
  const wrap = document.getElementById('wCanvasWrap');
  if (!page || !wrap) return;
  if (!Array.isArray(page.boxes)) page.boxes = [];
  const maxW = Math.min(760, Math.max(320, wrap.clientWidth || 660));
  const k = maxW / page.w;
  wrap.innerHTML = '';
  wrap.style.position = 'relative';
  wrap.style.width = maxW + 'px';
  wrap.style.height = Math.round(page.h * k) + 'px';

  const cv = document.createElement('canvas');
  cv.width = page.w; cv.height = page.h;
  const dctx = cv.getContext ? cv.getContext('2d') : null;
  if (dctx) dctx.drawImage(page.canvas, 0, 0);
  cv.style.width = '100%'; cv.style.height = '100%';
  cv.className = 'w-seg-canvas';
  wrap.appendChild(cv);

  const ordered = boxesOf(page);
  ordered.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'w-box' + (b.added ? ' added' : '');
    el.dataset.ref = String(page.boxes.indexOf(b));
    el.style.left = Math.round(b.x * k) + 'px';
    el.style.top = Math.round(b.y * k) + 'px';
    el.style.width = Math.round(b.w * k) + 'px';
    el.style.height = Math.round(b.h * k) + 'px';
    const no = b.added ? '已加' : '加入';
    el.innerHTML = `<span class="w-box-no" title="${esc(b.stem || '')}">${i + 1}</span>
      <button class="w-box-add" title="${b.added ? '已在错题栏' : '把这道题加入错题栏'}${b.stem ? '：' + esc(b.stem) : ''}">${no}</button>
      <button class="w-box-x" title="删掉这个框">×</button><i class="w-h" title="拖动缩放"></i>`;
    wrap.appendChild(el);
  });
  wrap.querySelectorAll('.w-box-add').forEach((btn) => btn.onclick = (e) => {
    e.stopPropagation();
    addBoxJob(page, btn.closest('.w-box').dataset.ref);
  });
  wrap.querySelectorAll('.w-box-x').forEach((btn) => btn.onclick = (e) => {
    e.stopPropagation();
    page.boxes.splice(Number(btn.closest('.w-box').dataset.ref), 1);
    renderSegEditor(); renderThumbs(); updateSegCount();
  });
  bindBoxDrag(wrap, page, k);
}

/** 拖拽交互：全部在页图坐标系里算，再乘缩放比 k 回写到屏幕 */
function bindBoxDrag(wrap, page, k) {
  const toPage = (e) => {
    const r = wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  let st = null, ghost = null, el = null;

  const onMove = (e) => {
    if (!st) return;
    const p = toPage(e);
    if (st.mode === 'new') {
      const x = wClamp(Math.min(st.p0.x, p.x), 0, page.w);
      const y = wClamp(Math.min(st.p0.y, p.y), 0, page.h);
      const w = wClamp(Math.max(st.p0.x, p.x), 0, page.w) - x;
      const h = wClamp(Math.max(st.p0.y, p.y), 0, page.h) - y;
      st.cur = { x, y, w, h };
      ghost.style.left = Math.round(x * k) + 'px';
      ghost.style.top = Math.round(y * k) + 'px';
      ghost.style.width = Math.round(w * k) + 'px';
      ghost.style.height = Math.round(h * k) + 'px';
    } else if (st.mode === 'move') {
      st.b.x = wClamp(st.o.x + (p.x - st.p0.x), 0, page.w - st.b.w);
      st.b.y = wClamp(st.o.y + (p.y - st.p0.y), 0, page.h - st.b.h);
      el.style.left = Math.round(st.b.x * k) + 'px';
      el.style.top = Math.round(st.b.y * k) + 'px';
    } else {
      st.b.w = wClamp(st.o.w + (p.x - st.p0.x), W_MIN_BOX_W, page.w - st.b.x);
      st.b.h = wClamp(st.o.h + (p.y - st.p0.y), W_MIN_BOX_H, page.h - st.b.y);
      el.style.width = Math.round(st.b.w * k) + 'px';
      el.style.height = Math.round(st.b.h * k) + 'px';
    }
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const s = st;
    st = null; el = null;
    if (!s) return;
    if (s.mode === 'new') {
      if (ghost) { ghost.remove(); ghost = null; }
      const b = s.cur;
      if (b && boxOk(b)) {
        page.boxes.push(fitBox(b, page));
      } else if (b && (b.w >= 6 || b.h >= 6)) {
        toast('框太小了，拖大一点再松手', 'err');
      }
    }
    renderSegEditor(); renderThumbs(); updateSegCount();
  };

  wrap.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    const p = toPage(e);
    const boxEl = t.closest ? t.closest('.w-box') : null;
    if (boxEl && (t.closest('.w-box-x') || t.closest('.w-box-add'))) return; // 删除/加入按钮自己处理
    if (boxEl) {
      const b = page.boxes[Number(boxEl.dataset.ref)];
      if (!b) return;
      el = boxEl;
      st = { mode: t.classList.contains('w-h') ? 'size' : 'move', b, p0: p, o: { ...b } };
    } else {
      st = { mode: 'new', p0: p };
      ghost = document.createElement('div');
      ghost.className = 'w-marquee';
      wrap.appendChild(ghost);
    }
    e.preventDefault();
    wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
}
