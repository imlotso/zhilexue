/* 管理端「上传文件」公共能力：图片直接用，PDF 逐页渲染成图片。
 *
 * 为什么要在浏览器端把 PDF 转成图片：
 *  - 学情诊断要把试卷交给视觉大模型，错题重组要在页图上框题 —— 两者最终都只认「图片」；
 *  - PDF 转图放在前端，服务端不用装 poppler / pdfium 这类原生依赖，部署包照旧一个 node 进程搞定；
 *  - pdf.js 是纯 JS，已内置在 public/vendor/pdfjs/，不联网也能用（不依赖任何 CDN）。
 *
 * 对外接口：window.PdfPages
 *   isPdf(file) / isImage(file)          判断文件类型（按 MIME + 扩展名，双保险）
 *   loadPdfJs()                          按需加载 pdf.js（只加载一次），返回 Promise
 *   toCanvases(file, opts)               PDF → [{canvas, page, total}]，可带进度回调
 *   progress(title, tip)                 进度浮层（PDF 页数多时渲染较慢，让老师看得见）
 *   upload(files, opts)                  统一入口：图片走 onImage，PDF 逐页走 onPage
 */
(function () {
  'use strict';

  const BASE = '/vendor/pdfjs/';   // 与 public/vendor/pdfjs 对应
  let loader = null;

  const extOf = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [, ''])[1];

  /** 是不是 PDF：MIME 优先，扩展名兜底（有些浏览器选文件后 type 为空） */
  function isPdf(file) {
    if (!file) return false;
    return /^application\/pdf$/i.test(file.type || '') || extOf(file.name) === 'pdf';
  }

  /** 是不是图片（png / jpg / webp / gif / bmp / heic） */
  function isImage(file) {
    if (!file) return false;
    if (/^image\//i.test(file.type || '')) return true;
    return /^(png|jpe?g|webp|gif|bmp|heic|heif)$/.test(extOf(file.name));
  }

  /** workerSrc 统一指向本地那份 worker（本地部署不联网也能跑；页面上已静态引过 pdf.js 也照设） */
  function ensureWorker(lib) {
    try {
      if (lib && lib.GlobalWorkerOptions && lib.GlobalWorkerOptions.workerSrc !== BASE + 'pdf.worker.min.js') {
        lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
      }
    } catch (e) { /* 忽略 */ }
    return lib;
  }

  /** 按需加载 pdf.js（页面里第一次用到 PDF 时才去取，不拖慢后台首屏） */
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(ensureWorker(window.pdfjsLib));
    if (loader) return loader;
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'pdf.min.js';
      s.onload = () => {
        if (!window.pdfjsLib) { loader = null; return reject(new Error('PDF 组件加载失败')); }
        resolve(ensureWorker(window.pdfjsLib));
      };
      s.onerror = () => {
        loader = null;
        reject(new Error('PDF 组件加载失败（找不到 ' + BASE + 'pdf.min.js）'));
      };
      document.head.appendChild(s);
    });
    return loader;
  }

  /** 进度浮层：PDF 逐页渲染时给个可见反馈，避免老师以为卡死了 */
  function progress(title, tip) {
    const wrap = document.createElement('div');
    wrap.className = 'mask';
    wrap.innerHTML = `<div class="modal">
      <div class="modal-h"><h3>${title}</h3></div>
      <div class="modal-b">
        <div style="height:10px;border-radius:6px;background:#eef2f8;overflow:hidden;margin-bottom:14px">
          <i class="pp-bar" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#2f6bff,#22d3ee);transition:width .25s"></i>
        </div>
        <p class="pp-msg" style="color:var(--text2);margin:0">准备中…</p>
        <p class="w-tip" style="margin:12px 0 0">${tip || 'PDF 需要逐页转成图片，页数越多越慢，请不要关闭页面。'}</p>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const bar = wrap.querySelector('.pp-bar');
    const msg = wrap.querySelector('.pp-msg');
    return {
      set: (done, total, text) => {
        if (bar) bar.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
        if (msg && text) msg.textContent = text;
      },
      close: () => wrap.remove(),
    };
  }

  /**
   * PDF → canvas 数组
   * @param {File|Blob} file
   * @param {{maxPages?:number, maxWidth?:number, onProgress?:(done:number,total:number)=>void}} opts
   * @returns {Promise<{pages:Array<{canvas:HTMLCanvasElement,page:number,total:number}>, total:number, truncated:boolean}>}
   */
  async function toCanvases(file, opts = {}) {
    const maxPages = Math.max(1, Number(opts.maxPages) || 20);   // 防止一个几百页的 PDF 把浏览器卡死
    const maxWidth = Math.max(600, Number(opts.maxWidth) || 1400);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const lib = await loadPdfJs();

    const buf = await file.arrayBuffer();
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    } catch (e) {
      const n = String((e && e.name) || '');
      if (n === 'PasswordException') throw new Error('这个 PDF 有密码保护，请先取消密码后再上传');
      if (n === 'InvalidPDFException') throw new Error('这个文件不是有效的 PDF（可能已损坏或只是改了后缀名）');
      throw new Error('PDF 打开失败：' + ((e && e.message) || e));
    }

    const total = doc.numPages || 0;
    const n = Math.min(total, maxPages);
    const pages = [];
    try {
      for (let i = 1; i <= n; i++) {
        if (onProgress) onProgress(i - 1, n);
        const page = await doc.getPage(i);
        const v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1, maxWidth / (v1.width || maxWidth)));
        const vp = page.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(vp.width));
        cv.height = Math.max(1, Math.round(vp.height));
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#fff';                       // PDF 底是透明的，先铺白，否则转出来的图是黑底
          ctx.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
        page.cleanup();
        pages.push({ canvas: cv, page: i, total });
      }
    } finally {
      try { doc.destroy(); } catch (e) { /* 忽略 */ }
      if (onProgress) onProgress(n, n);
    }
    return { pages, total, truncated: total > n };
  }

  /**
   * 统一上传入口：一个文件选择框同时收图片和 PDF。
   * 图片原样交给 onImage(file)；PDF 逐页渲染后每页交给 onPage(canvas, page, total)。
   *
   * @param {FileList|File[]} files
   * @param {{
   *   onImage?: (file:File)=>any,
   *   onPage?: (canvas:HTMLCanvasElement, page:number, total:number)=>any,
   *   onError?: (msg:string, file:File)=>void,
   *   maxPages?: number,          // 单个 PDF 最多取几页
   *   maxWidth?: number,          // 渲染宽度（像素）
   *   progressTitle?: string, progressTip?: string,
   * }} opts
   */
  async function upload(files, opts = {}) {
    const list = [...(files || [])];
    const stat = { images: 0, pages: 0, skipped: 0, truncated: 0 };
    const onError = typeof opts.onError === 'function' ? opts.onError : (m) => { console.warn('[PdfPages]', m); };
    const busy = opts.maxPages && opts.maxPages < 99;   // 只有真的要转多页时才弹进度

    for (const f of list) {
      if (isPdf(f)) {
        const bar = busy && list.length ? progress(opts.progressTitle || '📄 正在读取 PDF', opts.progressTip) : null;
        try {
          const r = await toCanvases(f, {
            maxPages: opts.maxPages,
            maxWidth: opts.maxWidth,
            onProgress: bar ? (d, t) => bar.set(d, t, `正在渲染「${f.name}」第 ${Math.min(d + 1, t)} / ${t} 页…`) : null,
          });
          if (!r.pages.length) { stat.skipped++; continue; }
          if (r.truncated) stat.truncated++;
          for (const p of r.pages) {
            if (opts.onPage) await opts.onPage(p.canvas, p.page, p.total);
            stat.pages++;
          }
        } catch (e) {
          stat.skipped++;
          onError((e && e.message) || 'PDF 读取失败', f);
        } finally {
          if (bar) bar.close();
        }
      } else if (isImage(f)) {
        if (opts.onImage) await opts.onImage(f);
        stat.images++;
      } else {
        stat.skipped++;
        onError('只支持图片（jpg / png / webp）或 PDF：「' + f.name + '」格式不支持', f);
      }
    }
    return stat;
  }

  window.PdfPages = { BASE, isPdf, isImage, loadPdfJs, toCanvases, progress, upload };
})();
