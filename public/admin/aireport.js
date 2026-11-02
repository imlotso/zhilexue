/* AI 试卷分析测评报告
 *
 * 视图：
 *   #/aireport        工作台（电脑上传 / 手机扫码 两个入口 + 分析报告列表）
 *   #/aireport-view   报告渲染页（?id=N，仿「学情诊断报告」版式，可打印为 PDF）
 *
 * 分析在后台进行：创建任务后这里轮询列表状态；模型返回结构化 JSON 后按模板绘制。
 * 手机扫码：管理端生成限时 token → 二维码指向 /scan-report.html，家长手机填写上传，
 *          报告归属生成二维码的账号（分校各自隔离）。
 */
const AR = { photos: [], pollTimer: null, viewId: '' };

const arUrl = (key, inline) => `/api/file?key=${encodeURIComponent(key)}&token=${encodeURIComponent(Auth.token)}${inline ? '&inline=1' : ''}`;
const arNow = () => new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');

/* ============================================================ 工作台 */

async function viewAireport() {
  const list = (await api('/api/admin/report')) || [];
  scheduleArPoll(list);

  const pending = list.filter((r) => r.status === 'pending').length;
  const branchName = (r) => (Auth.user && Auth.user.role === 'admin' ? (r.branch_name ? `<div style="font-size:12px;color:var(--text3)">${esc(r.branch_name)}</div>` : '') : '');
  return {
    html: `
    <div class="card">
      <div class="card-h"><h3>AI学情诊断</h3><span class="tag gray">江苏地区学情口径</span></div>
      <div class="ar-entry">
        <button class="ar-entry-card" id="arPcBtn">
          <span class="ar-entry-ic">💻</span>
          <span class="ar-entry-t">电脑上传 · 分析</span>
          <span class="ar-entry-d">在本机选择试卷照片 / PDF 上传，填写学生信息后开始分析</span>
        </button>
        <button class="ar-entry-card" id="arScanBtn">
          <span class="ar-entry-ic">📱</span>
          <span class="ar-entry-t">手机扫码 · 分析</span>
          <span class="ar-entry-d">微信扫一扫，在手机上拍照上传试卷，报告自动汇总到这里</span>
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h3>分析报告 <span class="tag gray">${list.length}</span>${pending ? ` <span class="tag" style="background:#fdf6ec;color:#e6a23c;border:1px solid #faecd8">${pending} 份分析中</span>` : ''}</h3></div>
      ${list.length ? `<div style="overflow-x:auto"><table><thead><tr><th>报告</th><th>学生</th><th>科目</th>${Auth.user && Auth.user.role === 'admin' ? '<th>校区</th>' : ''}<th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>${list.map((r) => {
          const st = r.status === 'done' ? '<span class="tag ok">已完成</span>'
            : r.status === 'failed' ? `<span class="tag" style="background:#fef0f0;color:#f56c6c;border:1px solid #fde2e2">失败</span>${r.error ? `<div style="font-size:12px;color:var(--text3);max-width:240px;margin-top:4px">${esc(r.error)}</div>` : ''}`
            : '<span class="tag" style="background:#fdf6ec;color:#e6a23c;border:1px solid #faecd8">分析中</span>';
          return `<tr>
          <td><b>${esc(r.title)}</b>${r.model ? `<div style="font-size:12px;color:var(--text3)">${esc(r.model)} · ${(r.paperKeys || []).length} 张</div>` : ''}</td>
          <td>${esc(r.student || '—')}</td>
          <td>${esc([r.subject, r.grade].filter(Boolean).join(' · ') || '—')}</td>
          ${Auth.user && Auth.user.role === 'admin' ? `<td>${esc(r.branch_name || '总校区')}${branchName(r) ? '' : ''}</td>` : ''}
          <td>${st}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((r.created_at || '').slice(0, 16))}</td>
          <td><div class="acts">
            ${r.status === 'done' ? `<button class="link-btn" data-open="${r.id}">查看</button>` : ''}
            ${r.status !== 'pending' ? `<button class="link-btn" data-retry="${r.id}">重新分析</button>` : ''}
            <button class="link-btn danger" data-del="${r.id}">删除</button>
          </div></td></tr>`;
        }).join('')}</tbody></table></div>`
        : '<div class="empty">暂无报告</div>'}
    </div>`,
    after: () => {
      document.getElementById('arPcBtn').onclick = openArUpload;
      document.getElementById('arScanBtn').onclick = openArScan;
      document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { location.hash = '#/aireport-view?id=' + b.dataset.open; });
      document.querySelectorAll('[data-retry]').forEach((b) => b.onclick = async () => {
        await api('/api/admin/report/' + b.dataset.retry + '/retry', { method: 'POST' });
        toast('已重新发起分析', 'ok'); render();
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!await elConfirm({ title: '删除报告', message: '删除这份报告？试卷照片也会一并删除。', okText: '删除', danger: true })) return;
        await api('/api/admin/report/' + b.dataset.del, { method: 'DELETE' });
        toast('已删除', 'ok'); render();
      });
    },
  };
}

/* ---------------- 电脑上传 · 分析：弹窗（学生信息 + 试卷文件上传） ---------------- */

function openArUpload() {
  AR.photos = [];
  modal({
    title: '电脑上传 · 学情分析',
    wide: true,
    okText: '开始分析',
    body: `
      <div class="grid g4" style="gap:12px">
        <div class="field"><label>学生姓名</label><input class="input" id="arStudent" placeholder="如：陈同学"></div>
        <div class="field"><label>学科</label><input class="input" id="arSubject" placeholder="如：数学"></div>
        <div class="field"><label>年级</label><input class="input" id="arGrade" placeholder="如：五年级"></div>
        <div class="field"><label>报告标题</label><input class="input" id="arTitle" placeholder="留空自动生成"></div>
      </div>
      <div class="ar-upload-zone" id="arZone">
        <b>📄 上传试卷</b>
        <p>支持照片（png / jpg / webp）和 PDF，最多 6 张；PDF 自动按页拆分</p>
        <label class="btn primary-sm">选择文件<input type="file" id="arFiles" accept="image/*,.pdf,application/pdf" multiple style="display:none"></label>
      </div>
      <div class="ar-photos" id="arPhotos"><div class="w-thumb-empty">还没有选择试卷文件</div></div>`,
    onMount: (w) => { w.querySelector('#arFiles').onchange = onArPickFiles; },
    onOk: async (w, err) => startArAnalysis(w, err),
  });
}

/* ---------------- 手机扫码 · 分析：弹二维码 ---------------- */

async function openArScan() {
  const { el, close } = modal({
    title: '手机扫码 · 学情分析',
    body: `
      <div class="ar-scan-box">
        <div id="arQr" class="ar-qr"></div>
        <div class="ar-scan-tips">
          <p><b>①</b> 用微信「扫一扫」扫描左侧二维码（30 分钟内有效）</p>
          <p><b>②</b> 在手机上填写学生信息、拍摄或选择试卷照片</p>
          <p><b>③</b> 提交后 AI 自动分析，报告出现在本页「分析报告」列表</p>
        </div>
      </div>
      <div style="text-align:center;margin-top:10px"><button class="btn ghost" id="arQrNew">刷新二维码</button></div>`,
  });
  // 弹窗开着时每 5 秒刷新一次背后的报告列表：家长手机一提交，列表里立刻出现新报告，不用手动刷新
  const poll = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(poll); return; }
    if (location.hash.startsWith('#/aireport') && !location.hash.includes('-view')) render();
  }, 5000);
  const draw = async () => {
    try {
      const { token } = await api('/api/admin/report/scan-token', { method: 'POST', silent: true });
      const url = location.origin + '/scan-report.html?token=' + encodeURIComponent(token);
      const box = el.querySelector('#arQr');
      box.innerHTML = '';
      new QRCode(box, { text: url, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
      el.dataset.token = token;
    } catch (e) {
      el.querySelector('#arQr').innerHTML = `<div class="w-thumb-empty">二维码生成失败：${esc(e.message)}</div>`;
    }
  };
  await draw();
  const re = el.querySelector('#arQrNew');
  if (re) re.onclick = draw;
}

/** 列表里有分析中的任务 → 自动轮询刷新（有分析中任务时 4 秒一刷，尽快把结果刷出来） */
function scheduleArPoll(list) {
  clearTimeout(AR.pollTimer);
  if ((list || []).some((r) => r.status === 'pending') && document.getElementById('arPcBtn')) {
    AR.pollTimer = setTimeout(() => { if (location.hash.startsWith('#/aireport') && !location.hash.includes('-view')) render(); }, 4000);
  }
}

/** 上传文件（图片 / PDF）：图片直接入列，PDF 逐页渲染成 JPEG 后入列（都受 6 张上限约束） */
async function onArPickFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  if (!window.PdfPages) return toast('上传组件没加载成功，请刷新页面（Ctrl+F5）后重试', 'err');
  if (AR.photos.length >= 6) return toast('已经有 6 张了，先删掉几张再上传', 'err');

  const room = () => 6 - AR.photos.length;      // 学情诊断一次最多 6 张，PDF 也按页数算
  let added = 0;
  const st = await PdfPages.upload(files, {
    maxPages: room(),
    maxWidth: 1600,
    progressTitle: '正在读取文件',
    progressTip: '',
    onImage: (f) => { if (room() > 0) { addArPhoto(f, f.name, true); added++; } },
    onPage: (cv, page, total) => new Promise((resolve) => {
      if (room() <= 0) return resolve();
      cv.toBlob((blob) => {
        if (blob) { addArPhoto(blob, `第 ${page}/${total} 页`, true); added++; }
        resolve();
      }, 'image/jpeg', 0.92);
    }),
    onError: (msg) => toast(msg, 'err'),
  });

  if (added) toast(`已上传 ${added} 张${st.pages ? '（其中 PDF ' + st.pages + ' 页）' : ''}，可直接发起分析`, 'ok');
  else if (!st.skipped) toast('没有可用的文件', 'err');
  if (AR.photos.length >= 6) toast('已到 6 张上限：多余的已忽略，可以先分析再分批上传', 'err');
  else if (st.truncated) toast('这个 PDF 页数较多，只取了前面的页；剩下的可以再上传一次', 'err');
}

function renderArPhotos() {
  const box = document.getElementById('arPhotos');
  if (!box) return;
  if (!AR.photos.length) { box.innerHTML = '<div class="w-thumb-empty">还没有选择试卷文件</div>'; return; }
  box.innerHTML = `<div class="w-thumbs" style="max-height:300px">${AR.photos.map((p, i) => `
    <div class="w-thumb ${i === 0 ? 'on' : ''}" data-i="${i}">
      <img src="${p.url}" style="width:100%;max-height:120px;object-fit:contain;background:#fafcff;border-radius:6px;display:block">
      <div class="w-thumb-bar"><span>${i + 1}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">${esc(p.name)}</span>
        <button class="link-btn danger" data-rm="${i}">删除</button></div>
    </div>`).join('')}</div>`;
  box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const p = AR.photos.splice(Number(b.dataset.rm), 1)[0];
    if (p) URL.revokeObjectURL(p.url);
    renderArPhotos();
  });
}

/** silent=true：批量上传（PDF 多页）时不再逐张弹提示，由调用方汇总一条 */
function addArPhoto(blob, name, silent) {
  if (AR.photos.length >= 6) return silent ? undefined : toast('最多 6 张，删掉几张再传', 'err');
  const url = URL.createObjectURL(blob);
  AR.photos.push({ blob, name, url });
  renderArPhotos();
  return undefined;
}

async function startArAnalysis(w, err) {
  if (!AR.photos.length) return err('请先选择试卷照片或 PDF');
  const btn = w.querySelector('#mOk');
  if (btn) { btn.disabled = true; btn.textContent = '上传照片中…'; }
  try {
    const fd = new FormData();
    for (const p of AR.photos) fd.append('images', p.blob, p.name || 'paper.jpg');
    const up = await api('/api/admin/report/papers', { method: 'POST', body: fd, raw: true });
    const body = {
      student: w.querySelector('#arStudent').value,
      subject: w.querySelector('#arSubject').value,
      grade: w.querySelector('#arGrade').value,
      title: w.querySelector('#arTitle').value,
      paperKeys: up.keys,
    };
    const out = await api('/api/admin/report', { method: 'POST', body });
    toast('已开始分析（约 30 秒～3 分钟）', 'ok');
    AR.photos.forEach((p) => URL.revokeObjectURL(p.url));
    AR.photos = [];
    location.hash = '#/aireport-view?id=' + out.id;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '开始分析'; }
    throw e;   // 交给 modal 弹错误
  }
}

/* ============================================================ 报告渲染页 */

async function viewAireportView() {
  const id = (location.hash.split('?')[1] || '').match(/id=(\d+)/);
  AR.viewId = id ? id[1] : '';
  if (!AR.viewId) return { html: '<div class="card"><div class="empty"><div class="e-ic">🤖</div>未指定报告，去 <a href="#/aireport">AI学情诊断</a> 选择一份</div></div>' };
  const r = await api('/api/admin/report/' + AR.viewId);

  if (r.status === 'pending') {
    setTimeout(() => { if (location.hash === '#/aireport-view?id=' + AR.viewId) render(); }, 3000);
    return { html: `<div class="card"><div class="empty"><div class="e-ic">⏳</div>AI 正在分析这份试卷…（约 30 秒～3 分钟，页面每 3 秒自动刷新）
      <div style="margin-top:10px"><a class="btn ghost" href="#/aireport">← 返回列表</a></div></div></div>` };
  }
  if (r.status === 'failed') {
    return { html: `<div class="card"><div class="empty"><div class="e-ic">❌</div>分析失败：${esc(r.error || '未知原因')}
      <div style="margin-top:10px"><button class="btn primary-sm" id="arRetry">重新分析</button> <a class="btn ghost" href="#/aireport">← 返回列表</a></div></div></div>`,
      after: () => { const b = document.getElementById('arRetry'); if (b) b.onclick = async () => { await api('/api/admin/report/' + AR.viewId + '/retry', { method: 'POST' }); toast('已重新发起', 'ok'); render(); }; } };
  }
  const rep = r.report;
  return {
    html: `
    <div id="rpToolbar" class="no-print">
      <a class="btn ghost" href="#/aireport">← 返回列表</a>
      <b>${esc(r.title)}</b>
      <span class="tag gray">${esc(r.model || '')}</span>
      <span style="margin-left:auto;display:flex;gap:8px">
        <button class="btn ghost" id="rpPrint">打印</button>
        <button class="btn primary-sm" id="rpExport">导出 PDF</button>
      </span>
    </div>
    <div class="rp-pages" id="rpPages"></div>`,
    after: () => {
      document.getElementById('rpPages').innerHTML = renderReport(rep, r);
      rpPaginate();
      document.getElementById('rpPrint').onclick = () => window.print();
      document.getElementById('rpExport').onclick = () => exportReportPdf(r.title);
    },
  };
}

/** 把一页报告画成图片，再交给服务端拼成 PDF */
function pageToJpeg(el) {
  if (typeof html2canvas !== 'function') return Promise.reject(new Error('导出组件没加载，请 Ctrl+F5 后再试'));
  return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then((c) => new Promise((resolve, reject) => {
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))), 'image/jpeg', 0.92);
  }));
}

async function exportReportPdf(title) {
  if (window.innerWidth <= 860) return toast('窗口太窄会影响 A4 排版，请把浏览器窗口放大后再导出', 'err');
  const nodes = [...document.querySelectorAll('#rpPages .rp-page')];
  if (!nodes.length) return toast('还没有可导出的页面', 'err');
  const btn = document.getElementById('rpExport');
  if (btn) { btn.disabled = true; btn.textContent = '正在导出…'; }
  try {
    const fd = new FormData();
    fd.append('title', title || '学情诊断报告');
    for (let i = 0; i < nodes.length; i++) {
      fd.append('pages', await pageToJpeg(nodes[i]), 'p' + (i + 1) + '.jpg');
    }
    const data = await api('/api/admin/report/export-pdf', { method: 'POST', body: fd, raw: true, silent: true });
    downloadUrl(data.key, data.file_name);
    toast('PDF 已开始下载', 'ok');
  } catch (e) {
    toast(e.message || '导出失败', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '导出 PDF'; }
  }
}

const rpPct = (v) => Math.round((Number(v) || 0) * 1000) / 10;
const rpColor = { '1星': '#22c55e', '2星': '#f59e0b', '3星': '#8b5cf6', '4星': '#ef4444' };

/* ---------------- A4 拆页 ----------------
 * .rp-page 固定 794×1123（A4 @96dpi 精确比例），导出时每页截图等比铺满 A4 不留白。
 * 内容超出 1123px 时把尾部块挪到追加页（追加页同尺寸），保证「所见页 = 导出页」。
 * 仅桌面宽度生效（<=860px 时 height:auto 浏览模式，不拆页）。 */
function rpPaginate() {
  const box = document.getElementById('rpPages');
  if (!box) return;
  if (window.innerWidth <= 860) return;
  for (let guard = 0; guard < 12; guard++) {
    const over = [...box.querySelectorAll('.rp-page')].find((p) => p.scrollHeight > p.clientHeight + 2);
    if (!over) break;
    if (over.children.length <= 1) {
      // 只剩一个块仍超高：若是表格，按行拆分到新页（复制表头，尾部行搬过去）
      const tb = over.children[0] && over.children[0].tagName === 'TABLE' ? over.children[0] : null;
      if (!tb || !tb.tBodies[0] || tb.tBodies[0].rows.length < 4) break;  // 不是表格/行太少就不硬拆
      const np = document.createElement('div');
      np.className = over.className;
      np.classList.remove('rp-cover');
      const nt = document.createElement('table');
      nt.className = tb.className;
      if (tb.tHead) nt.appendChild(tb.tHead.cloneNode(true));
      const ntb = document.createElement('tbody');
      const tbody = tb.tBodies[0];
      while (over.scrollHeight > over.clientHeight + 2 && tbody.rows.length > 3) {
        ntb.insertBefore(tbody.rows[tbody.rows.length - 1], ntb.firstChild);
      }
      if (!ntb.rows.length) { np.remove(); break; }
      nt.appendChild(ntb);
      np.appendChild(nt);
      over.after(np);
      continue;
    }
    const np = document.createElement('div');
    np.className = over.className;
    np.classList.remove('rp-cover');        // 追加页不做封面版式
    while (over.scrollHeight > over.clientHeight + 2 && over.children.length > 1) {
      np.insertBefore(over.lastElementChild, np.firstChild);
    }
    if (!np.children.length) break;
    over.after(np);
  }
}

/** 难度环形图（纯 CSS conic-gradient） */
function rpDonut(difficulty, total) {
  const segs = [];
  let acc = 0;
  const colors = ['#22c55e', '#f59e0b', '#8b5cf6', '#ef4444'];
  difficulty.forEach((d, i) => {
    const frac = total ? (Number(d.count) || 0) / total : 0;
    segs.push(`${colors[i % 4]} ${acc * 100}% ${(acc + frac) * 100}%`);
    acc += frac;
  });
  if (acc < 1) segs.push('#e5eaf2 ' + acc * 100 + '% 100%');
  return `<div class="rp-donut"><div class="rp-donut-in"><b>${total}题</b></div></div>
    <style>.rp-donut{background:conic-gradient(${segs.join(',')})}</style>
    <div class="rp-legend">${difficulty.map((d, i) => `<span><i style="background:${colors[i % 4]}"></i>${esc(d.level)}</span>`).join('')}</div>`;
}

function renderReport(rep, r) {
  const m = rep.meta || {}, o = rep.overall || {};
  const k = rep.knowledge || {};
  const total = Number(m.totalQuestions) || (Number(o.correct) || 0) + (Number(o.wrong) || 0);
  const pct = rpPct(o.correctRate);
  const reportDate = (() => {
    const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.created_at || ''));
    if (hit) return `${hit[1]}.${Number(hit[2])}.${Number(hit[3])}`;
    const n = new Date();
    return `${n.getFullYear()}.${n.getMonth() + 1}.${n.getDate()}`;
  })();
  const pages = [];

  /* ---- 封面 ---- */
  pages.push(`<div class="rp-page rp-cover">
    <div class="rp-top"><span>${esc(r.student ?  ' · 学情诊断中心' : '学情诊断中心')}</span><span class="rp-badge">试卷分析诊断报告</span></div>
    <div class="rp-cover-main">
      <div class="rp-eyebrow">学 情 诊 断 报 告</div>
      <h1>${esc(r.title || (r.student ? r.student + ' 学情诊断报告' : '学情诊断报告'))}</h1>
      <div class="rp-sub">${esc([m.grade, m.subject, reportDate].filter(Boolean).join(' · '))}</div>
      <div class="rp-score-row">
        <div class="rp-score"><div class="big">${pct}<i>%</i></div><div class="l">整 体 正 确 率</div></div>
        <div class="rp-mini"><b>${Number(o.correct) || 0}<i>/${total}</i></b><div class="l">答对题数</div></div>
        <div class="rp-mini red"><b>${Number(o.wrong) || 0}<i>题</i></b><div class="l">答错题数</div></div>
      </div>
      <blockquote class="rp-quote"><b>诊断摘要</b><p>${esc(o.summary || '')}</p></blockquote>
    </div>
    <div class="rp-foot">
      <div>${esc([m.grade, m.subject].filter(Boolean).join(' · '))} · 共 ${total} 题<br>涉及 ${Number(m.totalKnowledge) || (k.mastered || []).length + (k.partial || []).length + (k.weak || []).length} 个知识点</div>
      <div style="text-align:right">报告日期：${esc(reportDate)}<br>  AI 学情诊断系统</div>
    </div>
  </div>`);

  /* ---- 第 2 页：诊断概览 + 难度分布 + 知识点掌握 ---- */
  pages.push(`<div class="rp-page">
    <div class="rp-sec"><i class="no">1</i><h2>诊断概览</h2></div>
    <div class="rp-tiles3">
      <div class="rp-tile g"><b>${(k.mastered || []).length}</b><span>已掌握知识点</span></div>
      <div class="rp-tile o"><b>${(k.partial || []).length}</b><span>部分掌握</span></div>
      <div class="rp-tile r"><b>${(k.weak || []).length}</b><span>未掌握</span></div>
    </div>
    <div class="rp-note"><b>试卷整体评价</b><p>** ${esc(o.difficultyComment || '')} **</p></div>

    <div class="rp-sec"><i class="no">2</i><h2>难度分布分析</h2></div>
    <div class="rp-diff">
      <div class="rp-donut-wrap">${rpDonut(rep.difficulty || [], total)}</div>
      <table class="rp-table"><thead><tr><th>难度值</th><th>题数</th><th>答对数</th><th>正确率</th><th>学情表现</th></tr></thead>
      <tbody>${(rep.difficulty || []).map((d) => `<tr>
        <td><b>${esc(d.level)}</b></td><td>${Number(d.count) || 0}</td><td>${Number(d.correct) || 0}</td>
        <td class="${rpPct(d.rate) >= 80 ? 'g' : rpPct(d.rate) >= 50 ? 'o' : 'r'}">${rpPct(d.rate)}%</td>
        <td class="cm">${esc(d.comment || '')}</td></tr>`).join('')}</tbody></table>
    </div>

    <div class="rp-sec"><i class="no">3</i><h2>知识点掌握详情</h2></div>
    <div class="rp-map">
      <div class="rp-map-root">知识点掌握总览</div>
      <div class="rp-map-branches">
        <div class="rp-map-g"><span class="dot g"></span><b>已掌握（${(k.mastered || []).length} 项）</b>
          <div class="rp-chips">${(k.mastered || []).map((x) => `<span class="chip g">${esc(x)}</span>`).join('') || '<span class="chip none">—</span>'}</div></div>
        <div class="rp-map-g"><span class="dot r"></span><b>未掌握（${(k.weak || []).length} 项）</b>
          <div class="rp-chips">${(k.weak || []).map((x) => `<span class="chip r">${esc(x)}</span>`).join('') || '<span class="chip none">—</span>'}</div></div>
        <div class="rp-map-g"><span class="dot o"></span><b>部分掌握（${(k.partial || []).length} 项）</b>
          <div class="rp-chips">${(k.partial || []).map((x) => `<span class="chip o">${esc(x)}</span>`).join('') || '<span class="chip none">—</span>'}</div></div>
      </div>
    </div>
  </div>`);

  /* ---- 第 3 页：知识点分析 + 错题深度解析 ---- */
  pages.push(`<div class="rp-page">
    ${(k.masteredComment || k.partialComment || k.weakComment) ? `
    <div class="rp-cmt g"><b>已掌握知识点分析</b><p>** ${esc(k.masteredComment || '')} **</p></div>
    <div class="rp-cmt o"><b>部分掌握知识点分析</b><p>** ${esc(k.partialComment || '')} **</p></div>
    <div class="rp-cmt r"><b>需关注知识点分析</b><p>** ${esc(k.weakComment || '')} **</p></div>` : ''}
    <div class="rp-sec"><i class="no">4</i><h2>错题深度解析</h2><span class="cnt">共 ${Number(o.wrong) || (rep.wrongQuestions || []).length} 题</span></div>
    <table class="rp-table"><thead><tr><th style="width:44px">题号</th><th style="width:22%">涉及知识点</th><th>错误原因溯源</th><th style="width:24%">核心能力</th></tr></thead>
    <tbody>${(rep.wrongQuestions || []).map((w) => `<tr>
      <td><b>${Number(w.no) || ''}</b></td><td>${esc(w.knowledge || '')}</td><td class="cm">${esc(w.cause || '')}</td>
      <td>${(w.abilities || []).map((a) => `<span class="chip b">${esc(a)}</span>`).join('')}</td></tr>`).join('')}</tbody></table>
    ${(rep.crossValidation || []).length ? `
    <div class="rp-sec" style="margin-top:20px"><i class="no">5</i><h2>交叉验证学情分析</h2></div>
    <p class="rp-lead">通过对比不同知识点不同难度题目的表现，发现以下学情特征：</p>
    ${(rep.crossValidation || []).map((t, i) => `<p class="rp-para"><b>${i + 1}.</b> ${esc(t)}</p>`).join('')}` : ''}
  </div>`);

  /* ---- 第 4 页：分析师寄语 + 附错题详情 ---- */
  pages.push(`<div class="rp-page">
    <div class="rp-sec"><i class="no">6</i><h2>分析师寄语</h2></div>
    <div class="rp-letter"><b>寄语</b><p>${esc(rep.teacherNote || '')}</p><div class="sig">——  AI 学情分析团队</div></div>
    ${(rep.wrongDetails || []).length ? `
    <div class="rp-sec" style="margin-top:20px"><i class="no plus">附</i><h2>错题详情</h2><span class="cnt">举一反三练习</span></div>
    ${(rep.wrongDetails || []).map((d) => `<div class="rp-q"><b>第${Number(d.no) || ''}题（${esc(d.subject || m.subject || '')}）</b><p>${esc(d.stem || '')}</p></div>`).join('')}` : ''}
  </div>`);

  return pages.join('');
}
