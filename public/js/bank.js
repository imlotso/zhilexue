/* 学生端 · 智能题库（2026-10 新增）
 *  - BankQuiz.open()   全屏做题弹层：单选 / 多选 / 判断 / 填空 / 排序（连词成句），交卷判分 + 答案解析
 *  - BankPages.papers()     学生端「试卷」页
 *  - BankPages.mistakes()   学生端「错题本」页（按学科分类，可重做、移出）
 * 被 vue-app.js 调用，依赖 api.js 的 api / esc / toast / elConfirm。 */
'use strict';

const QT_NAME = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序·连词成句' };
const QT_LETTERS = 'ABCDEFGHIJ';
const quizIsMatch = (q) => q && ['listen_match', 'math_match'].includes(q.question_subtype);
const quizTryText = (last) => !last ? '' : (last.ungraded_count ? `${last.objective_score_total ? `客观题 ${last.objective_score}/${last.objective_score_total} 分 · ` : ''}${last.manual_count ? `已评主观题 ${last.manual_score}/${last.manual_score_total} 分 · ` : ''}${last.ungraded_count} 题未评分` : (last.score == null ? '未评分' : `${last.score} 分`));

/** 稳定打乱（按题目 id 做种子，同一题每次进入顺序一致，避免「答案就是原顺序」的排序题泄题） */
function quizShuffle(arr, seed) {
  const a = arr.map((v, i) => ({ v, i }));
  let s = (Number(seed) || 1) * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 233280 + 8251) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;   // [{ v, i }]，i 是原始下标（1 基由调用方处理）
}

/** 把某道题的作答整理成可判分的字符串 */
function quizAnswerText(q, val) {
  if (!q || val === undefined || val === null) return '';
  if (q.type === 'multi') return (Array.isArray(val) ? val : []).join(',');
  if (q.type === 'fill') return (Array.isArray(val) ? val : []).map((s) => String(s || '').trim()).join('|');
  if (quizIsMatch(q)) {
    const expected = Array.isArray(q.match_prompts) ? q.match_prompts.length : 0;
    if (!Array.isArray(val) || !expected) return '';
    const entries = Array.from({ length: expected }, (_, i) => Number(val[i]) || 0);
    return entries.some(Boolean) ? entries.join(',') : '';
  }
  if (q.type === 'sort') return (Array.isArray(val) ? val : []).join(',');
  return String(val || '');
}

/** 正确率的展示文字（T6）：a = { total, answered, correct, rate } */
function quizAccText(a) {
  if (!a || !a.total) return '暂无习题';
  if (a.rate === null || a.rate === undefined) return `未做（共 ${a.total} 题）`;
  return `${a.rate}%（已做 ${a.answered} / ${a.total} 题，答对 ${a.correct}）`;
}

/* 选项文本归一化 optText() 已移到 js/api.js（学生端和后台共用） */

/** 答案转展示文本（结果页用；需要 options 原文） */
function quizAnswerDisplay(q, ans, options) {
  const s = String(ans || '').trim();
  const opts = (options || q.options || []).map(optText);
  if (q.type === 'single' || q.type === 'multi') {
    return s.split(',').map((L) => {
      const i = QT_LETTERS.indexOf(L.trim());
      return i >= 0 && opts[i] ? `${L}. ${opts[i]}` : L;
    }).join('　');
  }
  if (q.type === 'judge') return s || '—';
  if (q.type === 'fill') {
    // 先把备选分隔符 ||| 换成占位符再拆空，避免与空分隔符 | 混淆
    const PH = '\u0001';
    return String(s || '').replace(/\|\|\|/g, PH).split('|')
      .map((x) => x.split(PH).filter((y) => y !== '').join(' / '))
      .join('　|　');
  }
  if (quizIsMatch(q)) return s.split(',').map((n, i) => `${(q.match_prompts || [])[i] || `第 ${i + 1} 项`}：${Number(n) ? (opts[Number(n) - 1] || n) : '未连接'}`).join('；');
  if (q.type === 'sort') {
    return s.split(',').map((n) => {
      const i = Number(n) - 1;
      return i >= 0 && opts[i] ? opts[i] : n;
    }).join(' → ');
  }
  return s;
}

/** 题目图片：渲染 + 点击放大（纸质错题上传的题干图） */
function quizImagesHTML(q) {
  const imgs = (q && Array.isArray(q.images)) ? q.images : [];
  if (!imgs.length) return '';
  return `<div class="qz-imgs">${imgs.map((s) => r0FigHTML(s, '题目图片')).join('')}</div>`;
}

/** 题图（R0-B4）：单独成块、按原尺寸显示（大图限宽 70% / 高 360px，小图不放大），点击进灯箱看原图 */
function r0FigHTML(src, alt) {
  return `<span class="r0-qfig"><img class="qz-img r0-qimg" src="${esc(src)}" alt="${esc(alt || '题图')}" loading="lazy"></span>`;
}

/** 题干渲染：转义 + [图N] 占位替换为内联图片 + 换行转 <br>；返回 { stem, rest }（rest=未被占位引用的图） */
function stemImagesHTML(q) {
  const imgs = (q && Array.isArray(q.images)) ? q.images : [];
  const used = new Set();
  const stem = esc(String((q && q.stem) || '')).replace(/\n?\[图(\d+)\]\n?/g, (m, n) => {
    const src = imgs[Number(n) - 1];
    if (!src) return m;
    used.add(Number(n) - 1);
    return r0FigHTML(src, '图' + n);
  }).replace(/\n/g, '<br>');
  if (q) {
    const parts = [q.material, ...(q.match_prompts || []), ...(q.options || []).map(optText)];
    parts.forEach((part) => String(part || '').replace(/\[图(\d+)\]/g, (m, n) => { if (imgs[Number(n) - 1]) used.add(Number(n) - 1); return m; }));
  }
  const rest = imgs.map((s, i) => (!s || used.has(i) ? '' : r0FigHTML(s, '题目图片'))).join('');
  return { stem, rest: rest ? `<div class="qz-imgs">${rest}</div>` : '' };
}
function quizMatchContent(q, value) {
  return esc(String(value || '')).replace(/\[图(\d+)\]/g, (m, n) => {
    const src = (q.images || [])[Number(n) - 1];
    return src ? `<img class="qz-connect-img" src="${esc(src)}" alt="图${Number(n)}">` : m;
  });
}
/** 答题后才合并服务端返回的答案/解析专用图，保留原图号。 */
function quizSolutionContent(q, value, solutionImages) {
  const images = Array.isArray(q && q.images) ? q.images.slice() : [];
  (Array.isArray(solutionImages) ? solutionImages : []).forEach((src, i) => { if (src) images[i] = src; });
  return quizMatchContent({ images }, value).replace(/\n/g, '<br>');
}
/** R7 只读试卷题面预览：不包含答案、解析或作答控件。 */
function paperPreviewQuestionHTML(q, index) {
  const si = stemImagesHTML(q);
  const content = (value) => quizMatchContent(q, value).replace(/\n/g, '<br>');
  const material = q.material ? `<div class="qz-material"><div class="qz-mat-t">原文材料</div><div class="qz-mat-b">${content(q.material)}</div></div>` : '';
  const prompts = (q.match_prompts || []).map((text, i) => `<div class="r7-preview-prompt">${i + 1}. ${content(text)}</div>`).join('');
  const options = (q.options || []).map((option, i) => `<div class="qz-opt"><span class="qz-l">${QT_LETTERS[i] || i + 1}</span><span class="qz-ot">${content(optText(option))}</span></div>`).join('');
  return `<div class="pk-preview-q"><span>${index + 1}.</span><div>${material}${si.stem}${prompts}${options ? `<div class="qz-opts">${options}</div>` : ''}${si.rest}</div></div>`;
}

/** 公式键盘（T8）：只给 数学 / 物理 / 化学 的 填空 / 问答 题；英语等其它科目不出现 */
const T8_SUBJECTS = ['数学', '物理', '化学'];
const t8On = (q) => !!q && T8_SUBJECTS.includes(q.subject) && (q.type === 'fill' || q.type === 'answer');
const t8Btn = (i) => `<button type="button" class="t8-fbtn" data-t8="${i}" title="用公式键盘输入分数、根号、上下标等">∑ 公式</button>`;
function t8Bind(root) {
  (root || document).querySelectorAll('[data-t8]').forEach((b) => {
    b.onclick = () => {
      const ta = b.parentNode.querySelector('textarea');
      if (!ta) return;
      // 学生作答：回传裸 LaTeX（不带 \( \)），和标准答案按字符串比较，不做公式等价判定
      MLive.dialog({ title: '输入公式', delimit: false, onOk: (t) => MLive.insertAt(ta, t) });
    };
  });
}

/** 听力题的音频播放条（T7）。<audio> 是浏览器自己发请求、带不了登录头，本地存储的地址（/api/file?key=…）要把票据拼在 URL 上；云存储的签名外链原样用 */
function quizAudioSrc(u) {
  const s = String(u || '');
  if (!s) return '';
  if (s.startsWith('/api/file?') && !/[?&]token=/.test(s) && typeof Auth !== 'undefined' && Auth.token) return s + '&token=' + encodeURIComponent(Auth.token);
  return s;
}
function quizAudioHTML(q) {
  if (!q || !q.audio_url) return '';
  const limit = Math.max(0, Number(q.audio_play_limit) || 0);
  return `<div class="t7-audio" data-audio-qid="${esc(q.id || q.question_id || '')}" data-audio-limit="${limit}"><div class="t7-audio-t">先听音频，再作答${limit ? `（最多播放 ${limit} 次）` : '（可以反复听）'}</div>
    <audio controls playsinline preload="none" src="${esc(quizAudioSrc(q.audio_url))}"></audio>
    ${limit ? '<div class="t7-audio-left" aria-live="polite"></div>' : ''}
    <div class="t7-audio-err" hidden>音频没能加载，请检查网络后<a href="javascript:;" data-t7retry>点这里重试</a>；一直不行就告诉老师。</div></div>`;
}
function bindQuizAudio(root, counts = {}) {
  (root || document).querySelectorAll('.t7-audio audio').forEach((a) => {
    const box = a.closest('.t7-audio'); const err = box.querySelector('.t7-audio-err');
    const limit = Number(box.dataset.audioLimit) || 0, key = box.dataset.audioQid;
    const left = box.querySelector('.t7-audio-left');
    let started = false;
    const update = () => { if (left) left.textContent = `本次练习剩余 ${Math.max(0, limit - (counts[key] || 0))} 次`; };
    update();
    a.addEventListener('play', () => {
      if (limit && !started && (counts[key] || 0) >= limit) { a.pause(); update(); }
    });
    a.addEventListener('error', () => { err.hidden = false; });
    a.addEventListener('playing', () => {
      err.hidden = true;
      if (limit && !started) { started = true; counts[key] = (counts[key] || 0) + 1; update(); }
    });
    a.addEventListener('ended', () => { started = false; update(); });
    const r = box.querySelector('[data-t7retry]');
    if (r) r.onclick = () => { err.hidden = true; const src = a.getAttribute('src'); a.pause(); a.removeAttribute('src'); a.load(); a.setAttribute('src', src); a.load(); a.play().catch(() => {}); };
  });
}
/** 灯箱（R0-B4）：全屏遮罩显示原图，点遮罩 / 关闭按钮 / Esc 关闭；图片用原生 <img>，手机上可双指缩放。
 *  z-index 要高于做题弹层（1200），否则灯箱会被盖在下面。 */
function r0OpenLightbox(src) {
  const old = document.querySelector('.r0-lightbox'); if (old) old.remove();
  const m = document.createElement('div');
  m.className = 'r0-lightbox';
  m.innerHTML = `<button type="button" class="r0-lb-x" aria-label="关闭">×</button><img src="${esc(src)}" alt="查看原图"><p>点空白处或按 Esc 关闭</p>`;
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  m.onclick = (e) => { if (e.target !== m.querySelector('img')) close(); };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(m);
}
function bindImageZoom(root) {
  (root || document).querySelectorAll('.qz-img').forEach((im) => {
    im.onclick = () => r0OpenLightbox(im.currentSrc || im.src);
  });
}

/* ---- R8：做题弹窗用到的线性图标（stroke，继承 currentColor；不用 emoji） ---- */
const R8_ICON = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  no: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.6 4.3 4.4 1.6-4.4 1.6L12 15.3l-1.6-4.3L6 9.4l4.4-1.6z"/><path d="M18.5 14.5l.8 2.1 2.2.8-2.2.8-.8 2.1-.8-2.1-2.2-.8 2.2-.8z"/><path d="M5.5 15.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.6 1.8M9.5 2.8h5"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-7-6.5 16-2.6-6.6z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  steps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.6h.01"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
};
const r8Ic = (k, cls = '') => `<i class="r8-ic ${cls}">${R8_ICON[k] || ''}</i>`;

/** R8：AI 回复的轻量 Markdown → HTML（标题 / 列表 / 引用 / 粗体 / 行内代码；先转义，公式分隔符原样保留给 mtxTypeset）。
 *  「知识点 / 思路 / 步骤 / 易错点」四个三级标题渲染成带图标的分段标题。 */
const R8_SEC = { 知识点: 'book', 思路: 'bulb', 步骤: 'steps', 易错点: 'warn', 同类题: 'bulb', 再讲细一点: 'steps' };
function r8Md(src) {
  const inline = (s) => s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  const lines = esc(String(src || '')).split('\n');
  const out = []; let list = null; let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.t}>`); list = null; } };
  lines.forEach((raw) => {
    const ln = raw.replace(/\s+$/, '');
    let m;
    if (!ln.trim()) { flushPara(); flushList(); return; }
    if ((m = /^\s*#{1,4}\s+(.+)$/.exec(ln))) {
      flushPara(); flushList();
      const t = m[1].replace(/[*#]/g, '').trim();
      const key = Object.keys(R8_SEC).find((k) => t.startsWith(k));
      out.push(key ? `<h4 class="r8-md-sec" data-k="${key}">${r8Ic(R8_SEC[key])}${inline(t)}</h4>` : `<h4>${inline(t)}</h4>`);
      return;
    }
    if ((m = /^\s*(?:[-*•])\s+(.+)$/.exec(ln))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); return; }
    if ((m = /^\s*\d+[.、)]\s*(.+)$/.exec(ln))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); return; }
    if ((m = /^\s*&gt;\s?(.*)$/.exec(ln))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); return; }
    flushList(); para.push(ln);
  });
  flushPara(); flushList();
  return out.join('');
}

/** 把 mm:ss 秒数格式化成「x 分 y 秒」 */
const r8Dur = (s) => { s = Math.max(0, Math.round(s || 0)); return (s >= 60 ? Math.floor(s / 60) + ' 分 ' : '') + (s % 60) + ' 秒'; };

const BankQuiz = {
  /** 打开做题弹层（课文习题 / 小分组练习 / 试卷 / 错题重做 / 自组卷共用）
   *  opt: { title, subtitle, questions, submit(answers, duration) -> Promise<result>, scoreTotal, onDone, mode, onWatch?, watchText? }
   *  R8：桌面端定高（判分前后尺寸不变）、右侧题号四色方格 + 计时、逐题反馈、右下角 AI 老师浮层（流式）、做完后的报告。 */
  open(opt) {
    // 互斥：已有一个做题弹层时不再叠加（快速双击「开始作答」会开两层）
    if (document.querySelector('.quiz-mask')) { toast('请先完成当前的题目'); return; }
    const qs = (opt.questions || []).slice();
    if (!qs.length) { toast('这里还没有题目'); return; }
    const mask = document.createElement('div');
    mask.className = 'mask quiz-mask r8-qmask ui-quiz-workbench';
    document.body.appendChild(mask);

    const st = {
      idx: 0,
      answers: {},          // qid -> 作答（单选 letter / multi 数组 / judge 文本 / fill 数组 / sort 数组）
      phase: 'answer',      // answer | result
      result: null,
      startedAt: Date.now(),
      endedAt: 0,
      busy: false,
      checked: {},          // idx -> { ok, ungraded, answer, raw, analysis, my, myRaw, blanks }（做一题核对一题）
      matchFocus: {},
      drawingHistory: {}, drawingTool: {},
      audioCounts: {},      // 每次练习中跨题目切换保留播放次数
      fontSize: 'md',
    };
    const isStep = opt.mode === 'step';
    const total = qs.length;

    // 计时（所有模式都显示）
    let timerId = null;
    const paintTimer = () => {
      const el = mask.querySelector('#qzTimer');
      if (!el) return;
      const s = Math.floor(((st.endedAt || Date.now()) - st.startedAt) / 1000);
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')} : ${String(s % 60).padStart(2, '0')}`;
    };
    const startTimer = () => { stopTimer(); timerId = setInterval(paintTimer, 1000); paintTimer(); };
    const stopTimer = () => { if (timerId) { clearInterval(timerId); timerId = null; } };

    mask.innerHTML = `
      <div class="quiz-box r8-qz fs-md ${isStep ? 'quiz-step' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opt.title || '在线做题')}">
        <div class="quiz-h r8-qz-h">
          <div class="ui-quiz-brand"><img src="/img/ui-brand-20261108.png" alt=""><b>智乐学</b></div>
          <button type="button" class="close-x ui-quiz-exit" id="qzClose" title="退出练习"><i class="ai ai-logout" aria-hidden="true"></i><span>退出练习</span></button>
          <div class="quiz-h-t"><b title="${esc(opt.title || '在线做题')}">${esc(opt.title || '在线做题')}</b>${opt.subtitle ? `<span>${esc(opt.subtitle)}</span>` : ''}</div>
          <div class="quiz-h-r">
            <span class="qz-fs" id="qzFs" title="字体大小"><button data-fs="sm">小</button><button class="on" data-fs="md">中</button><button data-fs="lg">大</button></span>
          </div>
        </div>
        <div class="ui-quiz-progress"><span class="quiz-prog" id="qzProg" aria-live="polite"></span><div class="quiz-bar"><i id="qzBarFill"></i></div></div>
        <div class="r8-qz-main">
          <div class="r8-qz-left">
            <div class="quiz-body" id="qzBody"></div>
            <button type="button" class="r8-ai-fab" id="qzAiFab" hidden>${r8Ic('ai')}<span>AI 老师</span></button>
            <div class="qz-kpad" id="qzKpad" style="display:none"></div>
            <div class="quiz-f" id="qzFoot"></div>
          </div>
          <aside class="r8-qz-side" id="qzSide">
            <div class="r8-side-timer">${r8Ic('clock')}<span>已用时间</span><b class="qz-timer" id="qzTimer">00 : 00</b></div>
            <div class="r8-side-t">答题卡<em>（${total} 题）</em></div>
            <div class="quiz-dots r8-dots" id="qzDots"></div>
            <div class="r8-legend"><span><i class="u"></i>未做</span><span><i class="d"></i>已做</span><span><i class="ok"></i>答对</span><span><i class="no"></i>答错</span></div>
            <div class="ui-quiz-ai-dock" id="qzAiDock"></div>
          </aside>
        </div>
      </div>`;
    const $ = (sel) => mask.querySelector(sel);
    const box = $('.quiz-box');
    const bodyEl = $('#qzBody'), footEl = $('#qzFoot'), dotsEl = $('#qzDots'), fab = $('#qzAiFab');
    mask.querySelectorAll('#qzFs button').forEach((b) => b.onclick = () => {
      st.fontSize = b.dataset.fs;
      mask.querySelectorAll('#qzFs button').forEach((x) => x.classList.toggle('on', x === b));
      box.classList.remove('fs-sm', 'fs-md', 'fs-lg');
      box.classList.add('fs-' + st.fontSize);
    });
    startTimer();

    const onMathResize = () => {
      drawMathConnections();
      // Crossing into desktop must not lose the mobile launcher's only AI entry.
      if (window.matchMedia('(min-width: 900px)').matches && st.phase === 'answer' && !ai.open) aiOpenFor(qs[st.idx], false);
    };
    window.addEventListener('resize', onMathResize);
    let lastSubmitted = null, completionNotified = false;
    const notifyDone = () => { if (lastSubmitted && !completionNotified) { completionNotified = true; if (opt.onDone) opt.onDone(lastSubmitted); } };
    const destroy = () => { stopTimer(); aiDestroy(); mask.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onMathResize); notifyDone(); };
    const close = () => {
      if (st.phase === 'answer' && Object.keys(st.answers).length) {
        elConfirm({ title: '退出做题', message: '还没完成，退出后本次作答不会保存。确定退出？', okText: '退出' })
          .then((v) => { if (v) destroy(); });
      } else destroy();
    };
    $('#qzClose').onclick = close;
    const onKey = (e) => { if (e.key === 'Escape' && ai.open && !document.querySelector('.r0-lightbox')) { e.stopPropagation(); aiClose(); } };
    document.addEventListener('keydown', onKey, true);

    /* ---------------- 题号方格：未做 / 已做 / 答对 / 答错 四色，当前题加描边；可点击跳题 ---------------- */
    const dotState = (q, i) => {
      if (st.phase === 'result') {
        const r = (st.result && st.result.list || []).find((x) => x.question_id === q.id);
        return !r ? 'u' : r.ungraded ? 'd' : r.is_correct ? 'ok' : 'no';
      }
      const ck = st.checked[i];
      if (ck) return ck.ungraded ? 'd' : ck.ok ? 'ok' : 'no';
      return quizAnswerText(q, st.answers[q.id]) !== '' ? 'd' : 'u';
    };
    const renderDots = () => {
      dotsEl.innerHTML = qs.map((q, i) => {
        const s = dotState(q, i);
        const cls = { u: '', d: 'done', ok: 'ok', no: 'no' }[s];
        const status = { u: '未做', d: '已作答，待评分', ok: '答对', no: '答错' }[s];
        return `<button type="button" class="qz-dot r8-dot ${cls} ${st.phase !== 'result' && i === st.idx ? 'on cur' : ''}" data-i="${i}" title="第 ${i + 1} 题 · ${status}" aria-label="第 ${i + 1} 题，${status}" ${st.phase !== 'result' && i === st.idx ? 'aria-current="step"' : ''}>${i + 1}${s === 'ok' || s === 'no' ? r8Ic(s, 'ui-dot-status') : ''}</button>`;
      }).join('');
      dotsEl.querySelectorAll('.qz-dot').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.i);
        if (st.phase === 'result') { const card = bodyEl.querySelector(`.qz-rq[data-qid="${qs[i].id}"]`); if (card) bodyEl.scrollTo({ top: bodyEl.scrollTop + card.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 12, behavior: 'smooth' }); return; }
        st.idx = i; paint();
      });
      const checkedN = Object.keys(st.checked).length;
      $('#qzProg').innerHTML = st.phase === 'result' ? '已完成' : `已核对 <b>${checkedN}</b> / ${total} 题`;
      $('#qzBarFill').style.width = Math.round((st.phase === 'result' ? total : checkedN) / total * 100) + '%';
      const cur = dotsEl.querySelector('.cur');
      if (cur && dotsEl.scrollWidth > dotsEl.clientWidth) dotsEl.scrollLeft = Math.max(0, cur.offsetLeft - dotsEl.offsetLeft - dotsEl.clientWidth / 2 + cur.offsetWidth / 2);
    };

    /* ---------------- 选项 / 作答区（判分后进入只读、按对错着色） ---------------- */
    const letterSet = (s) => new Set((String(s || '').toUpperCase().match(/[A-J]/g) || []));
    const optionHTML = (q, ck) => {
      const opts = (q.options || []).map(optText);
      if (q.type === 'single' || q.type === 'multi') {
        const multi = q.type === 'multi';
        const right = ck ? letterSet(ck.raw) : null;
        return `<div class="qz-opts ${multi ? 'multi' : ''} ${ck ? 'r8-judged' : ''}">` + opts.map((t, i) => {
          const L = QT_LETTERS[i];
          const sel = multi ? (st.answers[q.id] || []).includes(L) : st.answers[q.id] === L;
          let cls = sel ? 'on' : '';
          let mark = '';
          if (ck && !ck.ungraded) {
            if (right.has(L)) { cls += ' r8-right'; mark = `<span class="ui-option-status">${r8Ic('ok', 'r8-om ok')}<small>正确答案</small></span>`; }
            else if (sel) { cls += ' r8-wrong'; mark = `<span class="ui-option-status">${r8Ic('no', 'r8-om no')}<small>你的选择</small></span>`; }
          }
          return `<button type="button" class="qz-opt ${cls}" data-i="${i}" ${ck ? 'disabled' : ''}>
            <span class="qz-l">${L}</span><span class="qz-ot">${quizMatchContent(q, t)}</span>${mark}</button>`;
        }).join('') + '</div>';
      }
      if (q.type === 'judge') {
        const cur = st.answers[q.id] || '';
        const rightV = ck ? (/^(正确|对|√|T|TRUE|A|Y|YES|是)$/i.test(String(ck.raw || '').trim()) ? '正确' : '错误') : '';
        const cls = (v) => {
          if (!ck) return cur === v ? `on ${v === '正确' ? 'ok' : 'no'}` : '';
          if (ck.ungraded) return cur === v ? 'on' : '';
          if (v === rightV) return 'r8-right';
          return cur === v ? 'r8-wrong' : '';
        };
        return `<div class="qz-judge ${ck ? 'r8-judged' : ''}">
          <button type="button" class="qz-jb ${cls('正确')}" data-v="正确" ${ck ? 'disabled' : ''}><i class="ai ai-check"></i> 正确</button>
          <button type="button" class="qz-jb ${cls('错误')}" data-v="错误" ${ck ? 'disabled' : ''}><i class="ai ai-delete"></i> 错误</button>
        </div>`;
      }
      if (q.type === 'fill') {
        const n = Math.max(1, Number(q.blanks) || 1);
        const arr = Array.isArray(st.answers[q.id]) ? st.answers[q.id] : [];
        // T6：固定宽高的输入区（字多字少都不变形）；R8：判分后逐空打 ✓ / ✗
        return `<div class="qz-fills t6-fills ${n === 1 ? 'single' : ''} ${ck ? 'r8-judged' : ''}">` + Array.from({ length: n }, (_, i) => {
          const bOk = ck && Array.isArray(ck.blanks) ? ck.blanks[i] : null;
          const mark = ck && !ck.ungraded && bOk !== null && bOk !== undefined ? r8Ic(bOk ? 'ok' : 'no', 'r8-bm ' + (bOk ? 'ok' : 'no')) : '';
          return `
          <label class="qz-fill t6-fill ${mark ? (bOk ? 'r8-bok' : 'r8-bno') : ''}"><span>${n === 1 ? '答案' : `第 ${i + 1} 空`}</span>
            <textarea class="t6-input" data-blank="${i}" maxlength="500" placeholder="点这里填写答案" autocomplete="off" spellcheck="false" ${ck ? 'readonly' : ''}>${esc(arr[i] || '')}</textarea>${mark}${!ck && t8On(q) ? t8Btn(i) : ''}</label>`;
        }).join('') + '</div>';
      }
      if (q.question_subtype === 'drawing') return `<div class="qz-drawing"><div class="qz-drawing-tools"><button type="button" class="btn ghost sm ${st.drawingTool[q.id] !== 'erase' ? 'on' : ''}" data-drawing-tool="pen" ${ck ? 'disabled' : ''}>画笔</button><button type="button" class="btn ghost sm ${st.drawingTool[q.id] === 'erase' ? 'on' : ''}" data-drawing-tool="erase" ${ck ? 'disabled' : ''}>橡皮</button><button type="button" class="btn ghost sm" data-drawing-undo ${ck ? 'disabled' : ''}>撤销</button><button type="button" class="btn ghost sm" data-drawing-clear ${ck ? 'disabled' : ''}>清空</button></div><canvas data-drawing-canvas width="800" height="500" aria-label="作图画布，使用鼠标或手指绘制"></canvas><p class="qz-drawing-tip">使用鼠标或手指作图；提交后由老师评分。</p></div>`;
      if (q.type === 'answer') {
        // 问答 / 解答题：大一点的固定输入区。不自动判分，提交后对照参考答案
        return `<div class="qz-fills t6-fills"><label class="qz-fill t6-fill t6-fill-long"><span>解答</span>
          <textarea class="t6-input t6-long" data-ans="1" maxlength="2000" placeholder="写下你的解答，本题不自动判分，可由老师评分" spellcheck="false" ${ck ? 'readonly' : ''}>${esc(String(st.answers[q.id] || ''))}</textarea>${!ck && t8On(q) ? t8Btn(0) : ''}</label></div>`;
      }
      if (q.question_subtype === 'math_match' && q.type === 'sort') {
        const prompts = Array.isArray(q.match_prompts) ? q.match_prompts : [];
        const values = Array.isArray(st.answers[q.id]) ? st.answers[q.id] : [];
        const focus = st.matchFocus[q.id];
        const left = prompts.map((text, i) => `<button type="button" class="qz-connect-item ${focus === i ? 'active' : ''}" data-connect-left="${i}" aria-pressed="${focus === i}" ${ck ? 'disabled' : ''}><span>${quizMatchContent(q, text)}</span>${values[i] ? `<small>已连至右侧第 ${Number(values[i])} 项</small>` : ''}</button>`).join('');
        const right = opts.map((text, i) => `<button type="button" class="qz-connect-item" data-connect-right="${i + 1}" ${ck ? 'disabled' : ''}>${quizMatchContent(q, text)}</button>`).join('');
        return `<div class="qz-connect-tip">先选择左侧一项，再选择右侧对应项；右侧选项可以重复连接。</div><div class="qz-connect-board"><svg class="qz-connect-svg" aria-hidden="true"></svg><div class="qz-connect-col">${left}</div><div class="qz-connect-col">${right}</div></div>`;
      }
      if (q.question_subtype === 'listen_match' && q.type === 'sort') {
        const prompts = Array.isArray(q.match_prompts) ? q.match_prompts : [];
        const values = Array.isArray(st.answers[q.id]) ? st.answers[q.id] : [];
        return `<div class="qz-match"><p class="qz-match-tip">为每个项目选择对应选项，每个选项使用一次。</p>${prompts.map((text, i) => `<label class="qz-match-row"><span>${i + 1}. ${esc(text)}</span><select data-match="${i}" aria-label="${esc(text)} 的对应选项" ${ck ? 'disabled' : ''}><option value="">请选择</option>${opts.map((v, j) => `<option value="${j + 1}" ${Number(values[i]) === j + 1 ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}</div>`;
      }
      if (q.type === 'sort') {
        // 排序 / 连词成句：展示顺序稳定打乱，学生按顺序点选，答案存原始位置序号
        const placed = Array.isArray(st.answers[q.id]) ? st.answers[q.id].slice() : [];
        const shuffled = quizShuffle(opts, q.id);
        const used = new Set(placed);
        return `<div class="qz-sort ${ck ? 'r8-judged' : ''}">
          <div class="qz-sort-built ${ck && !ck.ungraded ? (ck.ok ? 'r8-right' : 'r8-wrong') : ''}" id="qzSortBuilt">${placed.length
            ? placed.map((n, k) => `<button type="button" class="qz-chip" data-undo="${k}" ${ck ? 'disabled' : ''}>${esc(opts[n - 1] || ('#' + n))}</button>`).join('')
            : '<span class="qz-sort-tip">从下面按顺序点选，组成正确的顺序 →</span>'}</div>
          ${ck ? '' : `<div class="qz-sort-pool">${shuffled.map(({ v, i }) => {
            const n = i + 1;
            return `<button type="button" class="qz-pool-it ${used.has(n) ? 'used' : ''}" data-n="${n}" ${used.has(n) ? 'disabled' : ''}>${esc(v)}</button>`;
          }).join('')}</div>`}
        </div>`;
      }
      return '';
    };

    function drawMathConnections() {
      const board = bodyEl.querySelector('.qz-connect-board'); if (!board) return;
      const svg = board.querySelector('svg'), rect = board.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`); svg.replaceChildren();
      const q = qs[st.idx], values = st.answers[q.id] || [];
      values.forEach((v, i) => {
        if (!v) return;
        const left = board.querySelector(`[data-connect-left="${i}"]`), right = board.querySelector(`[data-connect-right="${Number(v)}"]`);
        if (!left || !right) return;
        const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
        const x1 = a.right - rect.left, y1 = a.top + a.height / 2 - rect.top, x2 = b.left - rect.left, y2 = b.top + b.height / 2 - rect.top;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`); svg.appendChild(path);
      });
    }
    const bindOptionEvents = (q) => {
      if (q.question_subtype === 'drawing') {
        const canvas = bodyEl.querySelector('[data-drawing-canvas]'); if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const restore = (value) => { ctx.clearRect(0, 0, canvas.width, canvas.height); if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height); img.src = value; } };
        restore(st.answers[q.id]);
        if (st.checked[st.idx]) return;
        const position = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
        let drawing = false, before = '';
        canvas.onpointerdown = (e) => { e.preventDefault(); drawing = true; before = st.answers[q.id] || ''; canvas.setPointerCapture(e.pointerId); const p = position(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .01, p.y + .01); ctx.lineWidth = st.drawingTool[q.id] === 'erase' ? 24 : 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = st.drawingTool[q.id] === 'erase' ? 'destination-out' : 'source-over'; ctx.strokeStyle = '#172b4d'; ctx.stroke(); };
        canvas.onpointermove = (e) => { if (!drawing) return; e.preventDefault(); const p = position(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
        const finish = () => { if (!drawing) return; drawing = false; ctx.closePath(); ctx.globalCompositeOperation = 'source-over'; const value = canvas.toDataURL('image/png'); if (value.length > 524310) { restore(before); toast('作图内容过大，请简化后重试', 'err'); return; } const hist = st.drawingHistory[q.id] = st.drawingHistory[q.id] || []; hist.push(before); if (hist.length > 20) hist.shift(); st.answers[q.id] = value; renderDots(); };
        canvas.onpointerup = finish; canvas.onpointercancel = finish;
        bodyEl.querySelectorAll('[data-drawing-tool]').forEach((b) => b.onclick = () => { st.drawingTool[q.id] = b.dataset.drawingTool; paint(); });
        bodyEl.querySelector('[data-drawing-undo]').onclick = () => { const hist = st.drawingHistory[q.id] || []; if (!hist.length) return; st.answers[q.id] = hist.pop(); paint(); };
        bodyEl.querySelector('[data-drawing-clear]').onclick = () => { const hist = st.drawingHistory[q.id] = st.drawingHistory[q.id] || []; hist.push(st.answers[q.id] || ''); if (hist.length > 20) hist.shift(); st.answers[q.id] = ''; paint(); };
        return;
      }
      if (q.question_subtype === 'math_match' && q.type === 'sort') {
        requestAnimationFrame(drawMathConnections);
        bodyEl.querySelectorAll('.qz-connect-img').forEach((img) => { if (!img.complete) img.addEventListener('load', drawMathConnections, { once: true }); });
        if (st.checked[st.idx]) return;
        bodyEl.querySelectorAll('[data-connect-left]').forEach((b) => b.onclick = () => { st.matchFocus[q.id] = Number(b.dataset.connectLeft); paint(); const next = bodyEl.querySelector('[data-connect-right]'); if (next) next.focus(); });
        bodyEl.querySelectorAll('[data-connect-right]').forEach((b) => b.onclick = () => {
          const index = st.matchFocus[q.id], value = Number(b.dataset.connectRight);
          if (!Number.isInteger(index)) return toast('请先选择左侧一项', 'err');
          const arr = Array.from({ length: (q.match_prompts || []).length }, (_, i) => Number((st.answers[q.id] || [])[i]) || 0);
          arr[index] = value; st.answers[q.id] = arr; delete st.matchFocus[q.id]; paint();
          const next = bodyEl.querySelector('[data-connect-left]'); if (next) next.focus();
        });
        return;
      }
      if (st.checked[st.idx]) return;   // 判分后只读
      if (q.type === 'single') {
        bodyEl.querySelectorAll('.qz-opt').forEach((b) => b.onclick = () => { st.answers[q.id] = QT_LETTERS[Number(b.dataset.i)]; paint(); });
      } else if (q.type === 'multi') {
        bodyEl.querySelectorAll('.qz-opt').forEach((b) => b.onclick = () => {
          const L = QT_LETTERS[Number(b.dataset.i)];
          const cur = (st.answers[q.id] || []).slice();
          const at = cur.indexOf(L);
          if (at >= 0) cur.splice(at, 1); else cur.push(L);
          cur.sort();
          st.answers[q.id] = cur;
          paint();
        });
      } else if (q.type === 'judge') {
        bodyEl.querySelectorAll('.qz-jb').forEach((btn) => btn.onclick = () => { st.answers[q.id] = st.answers[q.id] === btn.dataset.v ? '' : btn.dataset.v; paint(); });
      } else if (q.type === 'fill') {
        bodyEl.querySelectorAll('[data-blank]').forEach((inp) => {
          inp.oninput = () => {
            // 填空答案是单行：回车 / 粘贴里的换行都当空格
            if (/[\r\n]/.test(inp.value)) inp.value = inp.value.replace(/[\r\n]+/g, ' ');
            const n = Math.max(1, Number(q.blanks) || 1);
            const arr = Array.from({ length: n }, () => '');
            bodyEl.querySelectorAll('[data-blank]').forEach((x) => { arr[Number(x.dataset.blank)] = x.value; });
            st.answers[q.id] = arr;
            renderDots();
          };
          inp.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
          inp.onfocus = () => showKpad(inp);   // 点填空处弹出数学键盘（也可直接用物理键盘输入）
        });
      } else if (q.type === 'answer') {
        bodyEl.querySelectorAll('textarea[data-ans]').forEach((ta) => { ta.oninput = () => { st.answers[q.id] = ta.value; renderDots(); }; ta.onfocus = () => hideKpad(); });
      } else if (q.question_subtype === 'listen_match' && q.type === 'sort') {
        bodyEl.querySelectorAll('[data-match]').forEach((select) => select.onchange = () => {
          const n = Number(select.dataset.match), value = Number(select.value) || 0;
          const arr = Array.from({ length: (q.match_prompts || []).length }, (_, i) => Number((st.answers[q.id] || [])[i]) || 0);
          if (value && arr.some((v, i) => i !== n && v === value)) { select.value = String(arr[n] || ''); toast('每个选项只能使用一次', 'err'); return; }
          arr[n] = value; st.answers[q.id] = arr; renderDots();
        });
      } else if (q.type === 'sort') {
        bodyEl.querySelectorAll('.qz-pool-it').forEach((b) => b.onclick = () => {
          const cur = (st.answers[q.id] || []).slice(); cur.push(Number(b.dataset.n)); st.answers[q.id] = cur; paint();
        });
        bodyEl.querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => {
          const cur = (st.answers[q.id] || []).slice(); cur.splice(Number(b.dataset.undo), 1); st.answers[q.id] = cur; paint();
        });
      }
    };

    /* ---- 数学输入键盘（填空题点击输入框弹出，也可用物理键盘） ---- */
    const kpadEl = $('#qzKpad');
    let kpadInput = null; let kpadMode = 'num';
    const renderKpad = () => {
      const numKeys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'abc', '0', '.', '+'];
      const abcKeys = 'abcdefghijklmnopqrstuvwxyz'.split('');
      const syms = ['(', ')', '|', '<', '>', '≤', '≥', '≠', '='];
      kpadEl.innerHTML = `
        <div class="kpad-wrap">
          <div class="kpad-sym">${syms.map((k) => `<button class="kpad-k" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="kpad-grid">${kpadMode === 'num'
            ? numKeys.map((k) => `<button class="kpad-k ${k === 'abc' ? 'kpad-mode' : ''}" data-k="${k === 'abc' ? '' : k}" ${k === 'abc' ? 'data-act="mode"' : ''}>${k}</button>`).join('')
            : abcKeys.map((k) => `<button class="kpad-k" data-k="${k}">${k}</button>`).join('') + '<button class="kpad-k kpad-mode" data-act="mode">123</button>'}</div>
          <div class="kpad-fn">
            <button class="kpad-k" data-act="left">←</button>
            <button class="kpad-k" data-act="right">→</button>
            <button class="kpad-k" data-act="del">⌫</button>
            <button class="kpad-k kpad-hide" data-act="hide">收起</button>
          </div>
        </div>`;
    };
    renderKpad();
    const caretPos = () => (kpadInput ? (kpadInput.selectionStart ?? kpadInput.value.length) : 0);
    const kpadDispatch = () => { if (kpadInput) kpadInput.dispatchEvent(new Event('input', { bubbles: true })); };
    const insertAtCaret = (txt) => {
      if (!kpadInput || !txt) return;
      const el = kpadInput; const s = el.selectionStart ?? el.value.length; const e = el.selectionEnd ?? s;
      el.value = el.value.slice(0, s) + txt + el.value.slice(e);
      el.setSelectionRange(s + txt.length, s + txt.length);
      el.focus(); kpadDispatch();
    };
    const delAtCaret = () => {
      if (!kpadInput) return;
      const el = kpadInput; const s = el.selectionStart ?? el.value.length; const e = el.selectionEnd ?? s;
      if (s === e && s > 0) { el.value = el.value.slice(0, s - 1) + el.value.slice(e); el.setSelectionRange(s - 1, s - 1); }
      else if (s !== e) { el.value = el.value.slice(0, s) + el.value.slice(e); el.setSelectionRange(s, s); }
      el.focus(); kpadDispatch();
    };
    const moveCaret = (d) => {
      if (!kpadInput) return;
      const p = Math.max(0, Math.min(kpadInput.value.length, caretPos() + d));
      kpadInput.setSelectionRange(p, p); kpadInput.focus();
    };
    // 键盘浮在作答区底部（不改变弹窗高度，内容区内部滚动）
    const showKpad = (inp) => { if (inp.readOnly) return; kpadInput = inp; kpadEl.style.display = ''; };
    const hideKpad = () => { kpadInput = null; kpadEl.style.display = 'none'; };
    kpadEl.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.k) { insertAtCaret(b.dataset.k); if (kpadMode !== 'num') { kpadMode = 'num'; renderKpad(); } return; }
      const act = b.dataset.act;
      if (act === 'del') delAtCaret();
      else if (act === 'left') moveCaret(-1);
      else if (act === 'right') moveCaret(1);
      else if (act === 'hide') hideKpad();
      else if (act === 'mode') { kpadMode = kpadMode === 'num' ? 'abc' : 'num'; renderKpad(); }
    });

    /* ================= AI 老师浮层（R8）：当前窗口右下方，流式输出，可追问、可切换「直接讲解 / 一步步引导」 =================
     * 桌面端：浮层固定在视口右下角（400×60vh），做题弹窗整体向左让出位置，不遮挡题干和「下一题」按钮；
     * 窄屏（< 1000px）：底部抽屉（70vh）。每道题、每种模式各自一段对话，切换题目时内容跟着当前题走。 */
    const ai = { open: false, min: false, qid: 0, mode: 'explain', convs: {}, el: null, pill: null };
    const convKey = (qid, mode) => qid + ':' + mode;
    const curQ = () => qs.find((x) => x.id === ai.qid) || null;
    const myAnswerOf = (q) => {
      if (q.question_subtype === 'drawing') return '已提交作图';
      const i = qs.indexOf(q);
      const ck = st.checked[i];
      if (ck) return ck.myRaw;
      const r = st.result && (st.result.list || []).find((x) => x.question_id === q.id);
      return r ? r.my_answer : quizAnswerText(q, st.answers[q.id]);
    };
    const aiEnsure = () => {
      if (ai.el) return;
      const el = document.createElement('div');
      el.className = 'r8-ai ui-quiz-ai';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'AI 老师');
      el.innerHTML = `
        <div class="r8-ai-h">
          <b class="r8-ai-tt">${r8Ic('ai')}AI 老师</b>
          <div class="r8-ai-modes" role="tablist"><button type="button" data-m="explain" class="on">直接讲解</button><button type="button" data-m="guide">一步步引导</button></div>
          <button type="button" class="r8-ai-btn" data-act="min" title="收起 AI 老师" aria-label="收起 AI 老师">${R8_ICON.min}</button>
          <button type="button" class="r8-ai-btn" data-act="close" title="关闭 AI 老师" aria-label="关闭 AI 老师">${R8_ICON.x}</button>
        </div>
        <div class="r8-ai-q" id="r8AiQ"></div>
        <div class="r8-ai-body" id="r8AiBody"></div>
        <div class="r8-ai-f">
          <div class="r8-ai-chips"><button type="button" data-ask="再讲细一点">再讲细一点</button><button type="button" data-ask="出一道同类题考考我">出一道同类题考考我</button></div>
          <div class="ui-ai-answer-gate" id="qzAiGate"></div>
          <form class="r8-ai-in" autocomplete="off"><textarea rows="1" maxlength="500" aria-label="向 AI 老师提问" placeholder="说说你的想法…"></textarea><button type="submit" title="发送" aria-label="发送提问">${R8_ICON.send}</button></form>
        </div>`;
      $('#qzAiDock').appendChild(el);
      const pill = document.createElement('button');
      pill.type = 'button'; pill.className = 'r8-ai-pill'; pill.hidden = true;
      pill.innerHTML = `${r8Ic('ai')}<span>AI 老师</span><em>展开</em>`;
      $('#qzAiDock').appendChild(pill);
      ai.el = el; ai.pill = pill;
      el.querySelector('[data-act="min"]').onclick = () => { ai.min = true; el.classList.add('r8-hide'); pill.hidden = false; mask.classList.remove('r8-ai-on'); };
      el.querySelector('[data-act="close"]').onclick = () => aiClose();
      pill.onclick = () => { const q = curQ(); if (q) aiOpenFor(q, false); };
      el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { if (ai.mode === b.dataset.m) return; ai.mode = b.dataset.m; aiShow(true); });
      el.querySelectorAll('[data-ask]').forEach((b) => b.onclick = () => aiAsk(b.dataset.ask));
      const form = el.querySelector('.r8-ai-in'); const ta = form.querySelector('textarea');
      form.onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v) return; ta.value = ''; aiAsk(v); };
      ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); } };
    };
    const aiConv = () => {
      const k = convKey(ai.qid, ai.mode);
      if (!ai.convs[k]) ai.convs[k] = { msgs: [], busy: false, ctrl: null };
      return ai.convs[k];
    };
    /** 打开（或切换到）某道题的浮层；autoStart = 没对话时自动开讲 */
    const aiOpenFor = (q, autoStart) => {
      aiEnsure();
      ai.qid = q.id; ai.open = true; ai.min = false;
      ai.el.classList.remove('r8-hide'); ai.el.classList.add('show'); ai.pill.hidden = true;
      mask.classList.add('r8-ai-on');
      aiShow(autoStart);
    };
    const aiShow = (autoStart) => {
      const q = curQ(); if (!q) return;
      ai.el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === ai.mode));
      const n = qs.indexOf(q) + 1;
      ai.el.querySelector('#r8AiQ').innerHTML = `<span class="r8-ai-qno">第 ${n} 题</span><span class="r8-ai-qs">${esc(String(q.stem || '').replace(/\[图\d+\]/g, '（图）').replace(/\s+/g, ' ').slice(0, 60))}</span>`;
      const c = aiConv();
      const judged = st.phase === 'result' || !!st.checked[qs.indexOf(q)];
      if (!c.msgs.length && judged && autoStart) { aiSend(ai.mode === 'guide' ? '请一步步引导我做这道题。' : '请讲解这道题。', true); return; }
      aiPaint(true);
    };
    const aiPaint = (scroll) => {
      if (!ai.el) return;
      const q = curQ(); const c = aiConv(); const body = ai.el.querySelector('#r8AiBody');
      const judged = q && (st.phase === 'result' || !!st.checked[qs.indexOf(q)]);
      if (!c.msgs.length) {
        body.innerHTML = judged
          ? `<div class="r8-ai-empty">${r8Ic('ai')}<p>${ai.mode === 'guide' ? 'AI 老师会一步步提问，引导你自己做出来' : 'AI 老师会按「知识点 · 思路 · 步骤 · 易错点」讲解这道题'}</p><button type="button" class="btn primary sm" data-start="1">开始${ai.mode === 'guide' ? '引导' : '讲解'}</button></div>`
          : `<div class="r8-ai-empty">${r8Ic('ai')}<p>先作答并提交这道题，AI 老师再来讲解（这样不会提前看到答案）</p></div>`;
        const s = body.querySelector('[data-start]');
        if (s) s.onclick = () => aiSend(ai.mode === 'guide' ? '请一步步引导我做这道题。' : '请讲解这道题。', true);
      } else {
        body.innerHTML = c.msgs.map((m, i) => {
          if (m.hidden) return '';
          if (m.role === 'user') return `<div class="r8-msg me"><div class="r8-bub">${esc(m.content)}</div></div>`;
          if (m.err) return `<div class="r8-msg bot err"><div class="r8-bub">${r8Ic('warn')}<span>${esc(m.err)}</span><button type="button" class="btn ghost sm" data-retry="${i}">${r8Ic('retry')}重试</button></div></div>`;
          const typing = m.streaming ? '<span class="r8-caret"></span>' : '';
          return `<div class="r8-msg bot ${m.streaming ? 'streaming' : ''}" data-i="${i}"><div class="r8-bub r8-md">${m.content ? r8Md(m.content) : '<span class="r8-think">AI 老师正在思考<i></i><i></i><i></i></span>'}${typing}</div></div>`;
        }).join('');
        body.querySelectorAll('[data-retry]').forEach((b) => b.onclick = () => aiRetry(Number(b.dataset.retry)));
        if (window.mtxTypeset) mtxTypeset(body.querySelectorAll('.r8-msg.bot:not(.streaming) .r8-bub'));
      }
      const busy = c.busy || !judged;
      ai.el.querySelector('#qzAiGate').textContent = judged ? '本题已提交，可继续追问' : '先提交本题，再请 AI 老师讲解';
      ai.el.querySelectorAll('[data-ask], .r8-ai-in button, .r8-ai-in textarea, [data-m]').forEach((x) => { x.disabled = (x.dataset && x.dataset.m) ? c.busy : busy; });
      if (scroll) body.scrollTop = body.scrollHeight;
    };
    /** 流式请求：history = 之前的对话（不含出错 / 空消息），ask = 本次提问 */
    const aiSend = async (text, hidden) => {
      const q = curQ(); if (!q) return;
      const c = aiConv(); if (c.busy) return;
      const mode = ai.mode; const qid = q.id;
      const history = c.msgs.filter((m) => !m.err && m.content).map((m) => ({ role: m.role, content: m.content }));
      c.msgs.push({ role: 'user', content: text, hidden: !!hidden });
      const am = { role: 'assistant', content: '', streaming: true };
      c.msgs.push(am);
      c.busy = true;
      const ctrl = new AbortController(); c.ctrl = ctrl;
      const visible = () => ai.open && !ai.min && ai.qid === qid && ai.mode === mode;
      if (visible()) aiPaint(true);
      let raf = 0;
      const repaintLast = () => {
        raf = 0;
        if (!visible()) return;
        const body = ai.el.querySelector('#r8AiBody');
        const nodes = body.querySelectorAll('.r8-msg.bot');
        const last = nodes[nodes.length - 1];
        if (!last) return aiPaint(true);
        const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
        last.querySelector('.r8-bub').innerHTML = r8Md(am.content) + '<span class="r8-caret"></span>';
        if (nearBottom) body.scrollTop = body.scrollHeight;
      };
      try {
        const res = await fetch('/api/stu/bank/ai-explain/stream', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Auth.token || '') },
          body: JSON.stringify({ question_id: qid, quiz_ticket: q.quiz_ticket, my_answer: myAnswerOf(q), mode, history, ask: text }),
        });
        const ctype = res.headers.get('content-type') || '';
        if (!/event-stream/.test(ctype)) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.msg || ('请求失败（' + res.status + '）'));
        }
        const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let errMsg = '';
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let k;
          while ((k = buf.indexOf('\n\n')) >= 0) {
            const evt = buf.slice(0, k); buf = buf.slice(k + 2);
            const line = evt.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            let o; try { o = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
            if (o.t === 'delta') { am.content += o.text; if (!raf) raf = requestAnimationFrame(repaintLast); }
            else if (o.t === 'error') errMsg = o.msg || 'AI 老师暂时没有回应';
          }
        }
        if (errMsg && !am.content) throw new Error(errMsg);
        if (!am.content) throw new Error('AI 老师没有返回内容');
      } catch (e) {
        if (ctrl.signal.aborted) { if (!am.content) am.content = '（已停止）'; }
        else if (!am.content) { delete am.content; am.err = (e && e.message) || '网络异常，请重试'; am.content = ''; }
        else am.content += '\n\n（连接中断，内容可能不完整）';
      }
      am.streaming = false; c.busy = false; c.ctrl = null;
      if (raf) cancelAnimationFrame(raf);
      if (visible()) aiPaint(false);
      if (visible()) { const body = ai.el.querySelector('#r8AiBody'); const nb = body.scrollHeight - body.scrollTop - body.clientHeight < 140; if (nb) body.scrollTop = body.scrollHeight; }
    };
    const aiAsk = (text) => {
      const q = curQ(); if (!q) return;
      const judged = st.phase === 'result' || !!st.checked[qs.indexOf(q)];
      if (!judged) { toast('先提交这道题，再问 AI 老师'); return; }
      aiSend(text, false);
    };
    const aiRetry = (i) => {
      const c = aiConv(); if (c.busy) return;
      const u = c.msgs[i - 1];
      c.msgs.splice(i - 1, 2);
      if (u) aiSend(u.content, u.hidden);
    };
    const aiClose = () => {
      if (!ai.el) return;
      Object.values(ai.convs).forEach((c) => { if (c.ctrl) c.ctrl.abort(); });
      // Desktop has no floating launcher: retain a compact, keyboard-accessible reopen action.
      const docked = window.matchMedia('(min-width: 900px)').matches;
      ai.open = docked; ai.min = docked;
      ai.el.classList.remove('show'); ai.pill.hidden = !docked;
      mask.classList.remove('r8-ai-on');
    };
    const aiDestroy = () => {
      Object.values(ai.convs).forEach((c) => { if (c.ctrl) c.ctrl.abort(); });
      if (ai.el) ai.el.remove(); if (ai.pill) ai.pill.remove();
      ai.el = null; ai.pill = null; ai.open = false;
    };
    /** 切题时浮层跟着当前题走（不自动开讲，避免没必要的调用） */
    const aiFollow = (q) => {
      if (!ai.el || !ai.open || ai.qid === q.id) return;
      ai.qid = q.id;
      if (!ai.min) aiShow(false);
    };

    /* ---- 题目反馈：提交到管理端「错题反馈记录」 ---- */
    const openFeedback = (q, r) => {
      const reasons = ['答案有误', '题目显示不全', '图片缺失', '题干有错别字', '题目超纲', '其他问题'];
      const m = document.createElement('div');
      m.className = 'mask qz-ai-mask';
      m.innerHTML = `<div class="qz-ai-box qz-fb-box">
        <div class="qz-ai-h"><b>对题目有反馈？</b><button class="close-x" id="qzFbX">&times;</button></div>
        <div class="qz-ai-body">
          <div class="qz-fb-q">题目编号 <b>#${String(q.id).padStart(5, '0')}</b></div>
          <div class="qz-fb-stem">${esc(String(q.stem || '').slice(0, 150))}</div>
          <div class="qz-fb-rs">${reasons.map((x, i) => `<button class="qz-fb-r ${i === 0 ? 'on' : ''}" data-r="${x}">${x}</button>`).join('')}</div>
          <textarea id="qzFbNote" class="t6-input t6-note" placeholder="补充说明（选填）"></textarea>
        </div>
        <div class="qz-ai-f"><button class="btn ghost" id="qzFbCancel">取消</button><button class="btn primary" id="qzFbOk">提交反馈</button></div>
      </div>`;
      document.body.appendChild(m);
      m.querySelector('#qzFbX').onclick = () => m.remove();
      m.querySelector('#qzFbCancel').onclick = () => m.remove();
      m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
      m.querySelectorAll('.qz-fb-r').forEach((b) => b.onclick = () => {
        m.querySelectorAll('.qz-fb-r').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      m.querySelector('#qzFbOk').onclick = async () => {
        const btn = m.querySelector('#qzFbOk'); btn.disabled = true;
        try {
          await api('/api/stu/bank/feedback', { method: 'POST', body: {
            question_id: q.id,
            reason: (m.querySelector('.qz-fb-r.on') || {}).dataset ? m.querySelector('.qz-fb-r.on').dataset.r : '其他问题',
            note: m.querySelector('#qzFbNote').value,
            my_answer: r ? r.my_answer : quizAnswerText(q, st.answers[q.id]),
          } });
          toast('反馈已提交，老师会尽快核对', 'ok');
          m.remove();
        } catch (e) { toast(e.message || '提交失败', 'err'); btn.disabled = false; }
      };
    };

    /* ---------------- 逐题反馈：大标签「答对了 / 答错了」+ 你的答案 / 正确答案 + 解析 ---------------- */
    const stepJudgeHTML = (q, ck) => `
      <div class="qz-judge-box r8-fb ${ck.ungraded ? 'ung' : ck.ok ? 'ok' : 'no'}">
        <div class="r8-fb-tag">${ck.ungraded ? `${r8Ic('steps')}已提交，本题不自动判分` : ck.match_total ? `${ck.ok ? r8Ic('ok') : r8Ic('no')}连对 ${Number(ck.match_correct)} / ${Number(ck.match_total)} 项` : ck.ok ? `${r8Ic('ok')}答对了` : `${r8Ic('no')}答错了`}</div>
        <details class="ui-quiz-answer-details"><summary>查看作答与${ck.ungraded ? '参考' : '正确'}答案</summary>
        <div class="qz-jb-r"><span>你的答案</span><em class="${ck.ungraded ? '' : ck.ok ? 'ok' : 'no'}">${window.mtxAnswerHTML ? mtxAnswerHTML(ck.my || '未作答', q.subject) : esc(ck.my || '未作答')}</em></div>
        ${(ck.ok && !ck.ungraded) || (ck.ungraded && !String(ck.raw || '').trim() && !(ck.solution_images || []).length) ? '' : `<div class="qz-jb-r"><span>${ck.ungraded ? '参考答案' : '正确答案'}</span><em class="ok">${quizSolutionContent(q, ck.answer, ck.solution_images)}</em></div>`}
        </details>
        ${ck.analysis ? `<div class="qz-jb-ana"><span>解析</span><div class="r8-ana-t">${quizSolutionContent(q, ck.analysis, ck.solution_images)}</div></div>` : ''}
        <div class="r8-fb-acts"><button type="button" class="r8-link" data-fb="1">对题目有反馈？</button></div>
      </div>`;

    /* ---------------- 主渲染 ---------------- */
    const paint = () => {
      if (st.phase === 'result') return paintResult();
      const q = qs[st.idx];
      hideKpad();
      const si = stemImagesHTML(q);
      const ck = st.checked[st.idx];
      bodyEl.innerHTML = `
        <div class="r8-qcard">
          ${opt.notice ? `<div class="r9-sim-notice" role="status">${esc(opt.notice)}</div>` : ''}
          <div class="qz-qhead"><span class="qz-qno">第 ${st.idx + 1} 题</span>
            <span class="qz-qtype">${(typeof QSubtype !== 'undefined' && QSubtype.find(q.question_subtype) || {}).label || ({ listen_match: '听力匹配', math_match: '连线题', drawing: '作图题', translation: '翻译', writing: '书面表达', calculation: '计算题' })[q.question_subtype] || QT_NAME[q.type] || (q.type === 'answer' ? '问答题' : '')}</span>
            ${q.type === 'multi' ? '<span class="qz-qtip">可多选</span>' : ''}
            ${q.point ? `<span class="r8-qpoint">${esc(q.point)}</span>` : ''}
            <span class="qz-raqno" title="题目编号">#${String(q.id).padStart(5, '0')}</span></div>
          ${quizAudioHTML(q)}
          ${q.material ? `<div class="qz-material"><div class="qz-mat-t">原文材料</div><div class="qz-mat-b">${quizMatchContent(q, q.material).replace(/\n/g, '<br>')}</div></div>` : ''}
          <div class="qz-stem"><b>${si.stem}</b></div>
          ${q.question_subtype === 'translation' ? '<p class="qz-match-tip">本题按老师设置的参考译文比对；如有其他正确表达，可向老师反馈。</p>' : ''}
          ${si.rest}
          ${optionHTML(q, ck)}
          ${ck ? stepJudgeHTML(q, ck) : ''}
        </div>`;
      bodyEl.scrollTop = 0;
      // 判分后把反馈块滚进可视区（弹窗本身尺寸不变，只是内容区内部滚动）
      //（不用 scrollIntoView：它会连带滚动 overflow:hidden 的外层，手机上会把顶栏滚出去）
      if (ck) setTimeout(() => {
        const fb = bodyEl.querySelector('.r8-fb'); if (!fb) return;
        const d = fb.getBoundingClientRect().bottom - bodyEl.getBoundingClientRect().bottom + 70;
        if (d > 0) bodyEl.scrollTo({ top: bodyEl.scrollTop + d, behavior: 'smooth' });
      }, 80);
      bindOptionEvents(q);
      bindImageZoom(bodyEl);
      bindQuizAudio(bodyEl, st.audioCounts);
      t8Bind(bodyEl);
      if (window.mtxTypeset) mtxTypeset(bodyEl);   // 题干 / 选项 / 解析里的 LaTeX 排版
      bodyEl.querySelectorAll('.qz-material').forEach((m) => { m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded'); });
      bodyEl.querySelectorAll('[data-fb]').forEach((b) => b.onclick = () => openFeedback(q, { my_answer: q.question_subtype === 'drawing' ? '已作图' : (ck ? ck.myRaw : quizAnswerText(q, st.answers[q.id])) }));
      // 判分后：题卡右下角、「下一题」上方出现「AI 老师」（答错时高亮）
      fab.hidden = !ck;
      fab.classList.toggle('hot', !!ck && !ck.ok && !ck.ungraded);
      fab.onclick = () => aiOpenFor(q, true);
      const allDone = qs.every((_, i) => st.checked[i]);
      const nextUnchecked = () => { for (let k = 1; k <= total; k++) { const j = (st.idx + k) % total; if (!st.checked[j]) return j; } return -1; };
      if (ck) {
        const nx = nextUnchecked();
        footEl.innerHTML = `<button type="button" class="btn ghost" id="qzPrev" ${st.idx === 0 ? 'disabled' : ''}><i class="el-icon-arrow-left" aria-hidden="true"></i> 上一题</button>` + (allDone
          ? `<button type="button" class="btn primary" id="qzFinishCheck"><i class="ai ai-check"></i> 查看报告</button>`
          : `<button type="button" class="btn primary" id="qzGoNext">下一题 <i class="el-icon-arrow-right" aria-hidden="true"></i></button>`);
        $('#qzPrev').onclick = () => { if (st.idx > 0) { st.idx--; paint(); } };
        const go = $(allDone ? '#qzFinishCheck' : '#qzGoNext');
        go.onclick = async () => { if (allDone) { await doSubmit(); return; } st.idx = nx; paint(); };
      } else {
        footEl.innerHTML = `
          <button type="button" class="btn ghost" id="qzPrev" ${st.idx === 0 ? 'disabled' : ''}><i class="el-icon-arrow-left" aria-hidden="true"></i> 上一题</button>
          <button type="button" class="btn primary" id="qzCheckOne" ${st.busy ? 'disabled' : ''}><i class="ai ai-check"></i> 提交本题</button>`;
        const prevBtn = $('#qzPrev');
        if (prevBtn) prevBtn.onclick = () => { if (st.idx > 0) { st.idx--; paint(); } };
        $('#qzCheckOne').onclick = checkOne;
      }
      renderDots();
      aiFollow(q);
      if (ai.open && !ai.min && ai.qid === q.id) aiPaint(false);
    };

    /* ---------------- 做完后的报告：得分环 / 用时 / 题号红绿方块 / 各知识点掌握 / 薄弱知识点 / 错题已进错题本 ---------------- */
    const resultOne = (q, r, no) => {
      const okk = r && r.is_correct;
      const mine = q.question_subtype === 'drawing' ? '' : quizAnswerDisplay(q, r ? r.my_answer : quizAnswerText(q, st.answers[q.id]), q.options);
      const right = quizAnswerDisplay(q, r ? r.answer : '', q.options);
      const si = stemImagesHTML(q);
      const ung = !!(r && r.ungraded);
      return `<div class="qz-rq ${ung ? 'ung' : okk ? 'ok' : 'no'}" data-qid="${q.id}">
        <div class="qz-rq-h"><span class="r8-rno ${ung ? 'd' : okk ? 'ok' : 'no'}">${no}</span><span class="qz-rstate">${ung ? '暂未自动评分' : okk ? '答对了' : '答错了'}</span>
          <span class="qz-rtag">${({ calculation: '计算题', drawing: '作图题', writing: '书面表达', translation: '翻译' })[q.question_subtype] || QT_NAME[q.type] || '题目'}</span>${q.point ? `<span class="qz-rpoint">${esc(q.point)}</span>` : ''}
          <span class="qz-raqno">#${String(q.id).padStart(5, '0')}</span></div>
        ${quizAudioHTML(q)}
        ${q.material ? `<div class="qz-material folded"><div class="qz-mat-t">查看原文</div><div class="qz-mat-b">${quizMatchContent(q, q.material).replace(/\n/g, '<br>')}</div></div>` : ''}
        <div class="qz-stem"><b>${si.stem}</b></div>
        ${si.rest}
        ${['single','multi'].includes(q.type) && (q.options || []).length ? `<div class="qz-opts">${q.options.map((o,i) => `<div class="qz-opt"><span class="qz-l">${QT_LETTERS[i]}</span><span class="qz-ot">${quizMatchContent(q,optText(o))}</span></div>`).join('')}</div>` : ''}
        <div class="qz-rrow my"><span>我的答案</span>${q.question_subtype === 'drawing' && st.answers[q.id] ? `<img class="qz-drawing-result" src="${esc(st.answers[q.id])}" alt="我的作图">` : `<em class="${okk ? 'ok' : ung ? '' : 'no'}">${window.mtxAnswerHTML ? mtxAnswerHTML(mine || '未作答', q.subject) : esc(mine || '未作答')}</em>`}</div>
        ${r && r.match_total ? `<div class="qz-rrow"><span>连线结果</span><em>连对 ${Number(r.match_correct)} / ${Number(r.match_total)} 项${r.max_score != null ? `，得 ${Number(r.earned_score)} / ${Number(r.max_score)} 分` : ''}</em></div>` : ''}
        ${okk ? '' : `<div class="qz-rrow"><span>${ung ? '参考答案' : '正确答案'}</span><em class="ok">${quizSolutionContent(q, right || '未提供', r && r.solution_images)}</em></div>`}
        ${r && r.analysis ? `<div class="qz-ana"><span>解析</span><div>${quizSolutionContent(q, r.analysis, r.solution_images)}</div></div>` : ''}
        <div class="qz-racts">
          <button type="button" class="btn ghost sm r8-ai-mini ${okk || ung ? '' : 'hot'}" data-ai="${q.id}">${r8Ic('ai')}AI 老师讲解</button>
          <button type="button" class="btn ghost sm" data-fb="${q.id}">对题目有反馈？</button>
        </div>
      </div>`;
    };
    const reportHTML = (r) => {
      const list = r.list || [];
      const map = {}; list.forEach((x) => { map[x.question_id] = x; });
      const graded = list.filter((x) => !x.ungraded);
      const pct = graded.length ? Math.round(r.correct / graded.length * 100) : null;
      const secs = Math.round(((st.endedAt || Date.now()) - st.startedAt) / 1000);
      const noOf = (qid) => qs.findIndex((x) => x.id === qid) + 1;
      // 按知识点归组（题目自带的知识点文字；没标注的归「未标注知识点」）
      const pts = new Map();
      qs.forEach((q) => {
        const x = map[q.id]; if (!x || x.ungraded) return;
        const p = String(x.point || q.point || '').trim() || '未标注知识点';
        const o = pts.get(p) || { point: p, total: 0, correct: 0, wrong: [] };
        o.total++; if (x.is_correct) o.correct++; else o.wrong.push(noOf(q.id));
        pts.set(p, o);
      });
      const ptList = [...pts.values()];
      const weak = ptList.filter((p) => p.wrong.length).sort((a, b) => (a.correct / a.total) - (b.correct / b.total));
      const ungN = Number(r.ungraded_count) || list.filter((x) => x.ungraded).length;
      const scoreTxt = ungN ? (r.objective_score_total ? `客观题 ${r.objective_score} / ${r.objective_score_total}` : '')
        : (opt.scoreTotal || r.score_total ? `${r.score != null ? r.score : Math.round(r.correct / Math.max(1, r.total) * opt.scoreTotal)} / ${r.score_total || opt.scoreTotal}` : '');
      const ms = r.mastery || {};
      const mrow = (label, a) => (a && a.total ? `<div class="r8-rep-acc"><span>${esc(label)}</span><b>${a.rate === null || a.rate === undefined ? '未做' : a.rate + '%'}</b><em>已做 ${a.answered} / ${a.total} 题</em></div>` : '');
      return `
        <div class="r8-rep">
          <div class="r8-rep-top">
            <div class="r8-ring ${pct === null ? '' : pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low'}" style="--p:${pct || 0}"><div><b>${pct === null ? '—' : pct}${pct === null ? '' : '<small>%</small>'}</b><span>正确率</span></div></div>
            <div class="r8-rep-stats">
              <div><span>答对</span><b class="ok">${r.correct}</b></div>
              <div><span>答错</span><b class="no">${r.wrong}</b></div>
              <div><span>用时</span><b>${r8Dur(secs)}</b></div>
              ${scoreTxt ? `<div><span>得分</span><b>${scoreTxt}</b></div>` : ''}
            </div>
            <div class="r8-rep-msg">${r.wrong ? `${r8Ic('book')}<span>答错的 ${r.wrong} 道题已自动收进<b>错题本</b>，可以在错题本里重做和复习</span>` : !graded.length ? `${r8Ic('book')}<span>本次题目暂未自动评分，可查看已有参考内容或等待老师评分。</span>` : `${r8Ic('ok')}<span>客观题全部答对。</span>`}</div>
          </div>
          ${ms.video || ms.section ? `<div class="r8-rep-sec"><h4>现在的习题正确率</h4>${ms.video ? mrow('本视频「' + (ms.video.title || '') + '」', ms.video) : ''}${ms.section ? mrow('小分组「' + ms.section.name + '」', ms.section) : ''}</div>` : ''}
          <div class="r8-rep-sec"><h4>题号<em>点方块查看这道题的解析</em></h4>
            <div class="r8-rep-nos">${qs.map((q, i) => { const x = map[q.id]; const s = !x ? 'u' : x.ungraded ? 'd' : x.is_correct ? 'ok' : 'no'; return `<button type="button" class="r8-no ${s}" data-jump="${q.id}" title="第 ${i + 1} 题">${i + 1}</button>`; }).join('')}</div></div>
          ${ptList.length ? `<div class="r8-rep-sec"><h4>各知识点掌握情况</h4>${ptList.map((p) => {
            const v = Math.round(p.correct / p.total * 100);
            return `<div class="r8-bar-row"><span title="${esc(p.point)}">${esc(p.point)}</span><i class="r8-bar"><u class="${v >= 80 ? 'good' : v >= 60 ? 'mid' : 'low'}" style="width:${Math.max(v, 3)}%"></u></i><b>${p.correct} / ${p.total}</b></div>`;
          }).join('')}</div>` : ''}
          <div class="r8-rep-sec"><h4>薄弱知识点</h4>${weak.length ? weak.map((p) => `
            <div class="r8-weak"><span class="r8-weak-n">${esc(p.point)}</span><span class="r8-weak-r">正确率 ${Math.round(p.correct / p.total * 100)}%</span>
              <span class="r8-weak-q">${p.wrong.map((n) => `<button type="button" class="r8-no no" data-jump="${qs[n - 1].id}">${n}</button>`).join('')}</span></div>`).join('')
            : '<div class="r8-rep-empty">这次没有薄弱知识点</div>'}</div>
          ${ungN ? `<div class="r8-rep-sec"><div class="r8-rep-empty">另有 ${ungN} 道题不自动判分，可对照下方提供的参考内容。</div></div>` : ''}
          <div class="r8-rep-sec r8-rep-list"><h4>题目与解析</h4>
            <div class="qz-results">${qs.map((qq, i) => resultOne(qq, map[qq.id], i + 1)).join('')}</div></div>
        </div>`;
    };
    const paintResult = () => {
      const r = st.result;
      const map = {}; (r.list || []).forEach((x) => { map[x.question_id] = x; });
      hideKpad();
      fab.hidden = true;
      bodyEl.innerHTML = reportHTML(r);
      bodyEl.scrollTop = 0;
      footEl.innerHTML = `
        <button type="button" class="btn ghost" id="qzRedo"><i class="ai ai-refresh"></i> 再练一次</button>
        ${opt.onWatch ? `<button type="button" class="btn ghost" id="qzWatch"><i class="ai ai-play"></i> ${esc(opt.watchText || '去看视频')}</button>` : ''}
        <button type="button" class="btn primary" id="qzFinish">完 成</button>`;
      $('#qzFinish').onclick = destroy;
      const w = $('#qzWatch'); if (w) w.onclick = () => { destroy(); opt.onWatch(); };
      $('#qzRedo').onclick = () => {
        aiClose(); ai.convs = {};
        st.answers = {}; st.drawingHistory = {}; st.idx = 0; st.phase = 'answer'; st.result = null; st.startedAt = Date.now(); st.endedAt = 0; st.checked = {};
        startTimer(); paint();
      };
      bodyEl.querySelectorAll('.qz-material').forEach((m) => { m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded'); });
      bodyEl.querySelectorAll('[data-jump]').forEach((b) => b.onclick = () => {
        const card = bodyEl.querySelector(`.qz-rq[data-qid="${b.dataset.jump}"]`);
        if (card) { bodyEl.scrollTo({ top: bodyEl.scrollTop + card.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 12, behavior: 'smooth' }); card.classList.add('r8-flash'); setTimeout(() => card.classList.remove('r8-flash'), 1200); }
      });
      bodyEl.querySelectorAll('[data-ai]').forEach((b) => b.onclick = () => { const q = qs.find((x) => x.id === Number(b.dataset.ai)); if (q) aiOpenFor(q, true); });
      bodyEl.querySelectorAll('[data-fb]').forEach((b) => b.onclick = () => { const q = qs.find((x) => x.id === Number(b.dataset.fb)); if (q) openFeedback(q, map[q.id]); });
      renderDots();
      bindImageZoom(bodyEl); bindQuizAudio(bodyEl, st.audioCounts);
      if (window.mtxTypeset) mtxTypeset(bodyEl);
    };

    /* ---- 提交本题 → 立即核对（不落库），显示对错 / 答案 / 解析，出现 AI 老师 ---- */
    const checkOne = async () => {
      if (st.busy) return;
      const checkedIndex = st.idx;
      const q = qs[checkedIndex];
      const my = quizAnswerText(q, st.answers[q.id]);
      if (my === '') { toast('先作答，再提交'); return; }
      st.busy = true;
      const btn = $('#qzCheckOne'); if (btn) btn.disabled = true;
      try {
        const r = await api('/api/stu/bank/check', { method: 'POST', body: { items: [{ question_id: q.id, quiz_ticket: q.quiz_ticket, my_answer: my }] } });
        const x = (r.list || [])[0] || {};
        if (!mask.isConnected) return;
        st.checked[checkedIndex] = { ok: !!x.is_correct, ungraded: !!x.ungraded, raw: x.answer || '', answer: quizAnswerDisplay(q, x.answer, q.options), analysis: x.analysis || '', solution_images: x.solution_images || [], my: q.question_subtype === 'drawing' ? '已提交作图' : quizAnswerDisplay(q, my, q.options), myRaw: q.question_subtype === 'drawing' ? '已作图' : my, blanks: x.blanks || null, match_correct: x.match_correct, match_total: x.match_total };
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '核对失败，请重试', 'err'); if (btn) btn.disabled = false; }
      st.busy = false;
      const currentCheck = $('#qzCheckOne'); if (currentCheck) currentCheck.disabled = false;
    };

    const doSubmit = async () => {
      if (st.busy) return;
      if (!isStep && !(await elConfirm({ title: '交卷确认', message: '全部题目已核对，确定交卷吗？交卷后记录成绩，错题进错题本。', okText: '交卷' }))) return;
      st.busy = true;
      const answers = qs.map((q) => ({ question_id: q.id, quiz_ticket: q.quiz_ticket, my_answer: quizAnswerText(q, st.answers[q.id]) }));
      const duration = Math.round((Date.now() - st.startedAt) / 1000);
      try {
        const r = await opt.submit(answers, duration);
        lastSubmitted = r;
        if (!mask.isConnected) { notifyDone(); return; }
        st.endedAt = Date.now(); stopTimer(); paintTimer();
        st.result = r; st.phase = 'result';
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '交卷失败，请重试', 'err'); }
      st.busy = false;
    };

    paint();
    // The desktop panel starts in a locked state. Opening it never requests AI.
    if (window.matchMedia('(min-width: 900px)').matches) aiOpenFor(qs[st.idx], false);
    return { close: destroy };
  },
};

/* ================================================================ 学生端页面 */
const BK_SUBJECTS = ['数学', '英语', '物理', '化学'];
const BK_PAPER_CATEGORIES = { unit: '单元', midterm: '期中', final: '期末', entrance: '真题' };

/* 线性 SVG 小图标（stroke 风格，继承 currentColor，替代 emoji） */
const BK_ICONS = {
  math: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3.2" width="12" height="17.6" rx="2.2"/><path d="M9.2 7h5.6"/><path d="M9.2 11.6h.01M12 11.6h.01M14.8 11.6h.01M9.2 15h.01M12 15h.01M14.8 15h.01M9.2 18.4h5.6"/></svg>',
  eng: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6C10.4 5 8 4.4 4.4 4.4v13.4c3.6 0 6 .6 7.6 2.2 1.6-1.6 4-2.2 7.6-2.2V4.4C16 4.4 13.6 5 12 6.6z"/><path d="M12 6.6v13.4"/></svg>',
  phy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></svg>',
  chem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 3.4h5.2M10.6 3.4v5.4l-5 8.8a2.1 2.1 0 0 0 1.8 3.1h9.2a2.1 2.1 0 0 0 1.8-3.1l-5-8.8V3.4"/><path d="M8 14.6h8"/></svg>',
  points: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2"/></svg>',
  fav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 4.2l2.4 4.85 5.35.78-3.87 3.77.91 5.33L12 16.4l-4.79 2.53.91-5.33-3.87-3.77 5.35-.78z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="7" width="17.2" height="12.4" rx="2.4"/><path d="M8.8 7l1.3-2.3h3.8L15.2 7"/><circle cx="12" cy="13" r="3.1"/></svg>',
};
const bkIcon = (name, size = 18) => `<span class="bki" style="width:${size}px;height:${size}px">${BK_ICONS[name] || ''}</span>`;

// Vue reuses the bank host when switching between papers and mistakes.
// Only the latest page invocation may update it or report a pending error.
const BK_PAGE_RUNS = new WeakMap();
const bkPageRun = (host) => {
  const run = {};
  BK_PAGE_RUNS.set(host, run);
  return () => host.isConnected && BK_PAGE_RUNS.get(host) === run;
};

// R6：截止日期按设备本地时区展示；是否允许提交仍由服务器判断。
function paperDeadlineInfo(value) {
  if (!value) return { text: '', expired: false };
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return { text: '截止时间异常，请联系老师', expired: false };
  const date = new Date(time), pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = 'UTC' + (offset >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
  const local = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  const expired = Date.now() > time;
  return { text: `${expired ? '已截止' : '截止'}：${local}（本地时间 ${zone}，提交以服务器校验为准）`, expired };
}

const BankPages = {
  /* 学生端「试卷」页：我的任务（老师下发）/ 章节组卷 / 知识点组卷（自己组卷，只在本人名下做题，不能下发给别人）/ 试卷库 */
  async papers(host, currentSubject) {
    const isCurrent = bkPageRun(host);
    if (!isCurrent()) return;
    host.innerHTML = '<div class="loading-page">加载中…</div>';
    let tasks = [], lib = [], subjective = [], flt = { subjects: [], grades: [], years: [] };
    const find = { q: '', grade: '', year: '', category: '' };
    let subject = BK_SUBJECTS.includes(currentSubject) ? currentSubject : BK_SUBJECTS[0];
    let searchVersion = 0, libLoading = false, libError = '';
    try {
      // Page-owned error handling must run before toast; api() otherwise reports
      // stale failures before the page/request guards can discard them.
      const r = await Promise.all([
        api('/api/stu/bank/tasks', { silent: true }),
        api('/api/stu/bank/mfpapers?subject=' + encodeURIComponent(subject), { silent: true }),
        api('/api/stu/bank/mfpapers/filters', { silent: true }).catch((e) => {
          if (isCurrent()) toast('筛选条件加载失败：' + (e.message || '请重试'), 'err');
          return flt;
        }),
        api('/api/stu/bank/subjective-responses', { silent: true }).catch((e) => {
          if (isCurrent()) toast('主观题反馈加载失败：' + (e.message || '请重试'), 'err');
          return { list: [] };
        }),
      ]);
      tasks = r[0] || []; lib = r[1] || []; flt = r[2] || flt; subjective = r[3].list || [];
    } catch (e) { if (isCurrent()) host.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`; return; }
    if (!isCurrent()) return;
    const searchLib = async () => {
      if (!isCurrent()) return;
      const version = ++searchVersion;
      const qs = new URLSearchParams();
      if (subject) qs.set('subject', subject);
      if (find.q) qs.set('q', find.q);
      if (find.grade) qs.set('grade', find.grade);
      if (find.year) qs.set('year', find.year);
      if (find.category) qs.set('exam_category', find.category);
      lib = []; libLoading = true; libError = ''; paint();
      try {
        const result = await api('/api/stu/bank/mfpapers' + (qs.toString() ? '?' + qs.toString() : ''), { silent: true });
        if (!isCurrent() || version !== searchVersion) return;
        lib = result || [];
      } catch (e) {
        if (!isCurrent() || version !== searchVersion) return;
        libError = e.message || '搜索失败'; toast(libError, 'err');
      }
      libLoading = false; paint();
    };

    const taskRow = (p) => `
      <div class="pk-task" data-task="${p.id}">
        <div class="pk-t-main"><b>${esc(p.title)}</b>
          <span class="hint">${p.q_count} 题 · 满分 ${p.total_score}${p.assigned ? '' : ' · 全员卷'}</span>${p.due_at ? `<div class="hint r6-task-deadline">${esc(paperDeadlineInfo(p.due_at).text)}</div>` : ''}</div>
        ${p.tried && p.last ? `<span class="tag ok">${esc(quizTryText(p.last))}</span>` : '<span class="tag gray">未完成</span>'}
        <button class="btn primary sm">${p.tried ? '重做' : '开始'}</button>
      </div>`;

    const paint = () => {
      if (!isCurrent()) return;
      // The input is an unsubmitted draft; find.q is the last applied query.
      const queryInput = host.querySelector('#pkQ');
      const queryDraft = queryInput ? queryInput.value : find.q;
      const querySelection = queryInput && host.ownerDocument.activeElement === queryInput
        ? [queryInput.selectionStart, queryInput.selectionEnd, queryInput.selectionDirection] : null;
      const ft = subject ? tasks.filter((p) => p.subject === subject) : tasks;
      const fl = subject ? lib.filter((p) => p.subject === subject) : lib;
      host.innerHTML = `
        <div class="bk-tabs">${[''].concat(BK_SUBJECTS).map((s) => {
          // Only the selected subject has a complete response for this search.
          const count = subject === s && !libLoading && !libError ? `<i>${ft.length + fl.length}</i>` : '';
          return `<a class="${subject === s ? 'on' : ''}" data-s="${esc(s)}">${s || '全部'}${count}</a>`;
        }).join('')}</div>
        <div class="pk-grid">
          <div class="pk-box">
            <div class="pk-h">${bkIcon('history', 16)} 我的任务<span class="pk-sub">老师下发的试卷</span></div>
            <div class="pk-body">${ft.length ? ft.map(taskRow).join('') : '<div class="pk-empty"><span style="font-size:26px">🧾</span>老师还没有下发试卷</div>'}</div>
          </div>
          <div class="pk-box pk-entry" id="pkScan">
            <div class="pk-h">${bkIcon('points', 16)} 章节组卷<span class="pk-sub">按章节单元组卷</span></div>
            <div class="pk-entry-b">
              <p>选择教材单元和练习题量，做完查看做题报告。</p>
              <button class="btn primary">开始组卷</button>
            </div>
          </div>
          <div class="pk-box pk-entry" id="pkSprint">
            <div class="pk-h">${bkIcon('fav', 16)} 知识点组卷<span class="pk-sub">按知识点组卷</span></div>
            <div class="pk-entry-b">
              <p>选择想练的知识点，系统自动组一份小卷，做完出学情报告。</p>
              <button class="btn primary">开始组卷</button>
            </div>
          </div>
        </div>
        ${subjective.length ? `<div class="pk-lib r4-subjective"><div class="pk-h">主观题反馈<span class="pk-sub">每次作答单独评分</span></div><div class="r4-subjective-list">${subjective.filter((x) => !subject || x.subject === subject).slice(0, 20).map((x) => `<details class="r4-subjective-item" ${x.has_drawing ? `data-student-drawing="${Number(x.id)}"` : ''}><summary><span>${esc((x.stem || '题目已删除').slice(0, 60))}</span><b>${x.score === null || x.score === undefined ? '待老师评分' : `${Number(x.score)} / ${x.max_score == null ? 100 : Number(x.max_score)} 分`}</b></summary><div><p>我的作答：${x.has_drawing ? '<span data-drawing-status>打开后加载作图</span><img class="r4-drawing-image" data-drawing-image alt="我的作图">' : (window.mtxAnswerHTML ? mtxAnswerHTML(x.my_answer || '未作答', x.subject) : esc(x.my_answer || '未作答').replace(/\n/g, '<br>'))}</p>${x.reviewed_at ? `<p>老师评语：${esc(x.review_comment || '暂无评语').replace(/\n/g, '<br>')}</p>` : '<p>老师尚未评分。</p>'}<small>${esc((x.created_at || '').slice(0, 16))}</small></div></details>`).join('') || '<p class="hint">当前学科还没有主观题作答</p>'}</div></div>` : ''}
        <div class="pk-lib">
          <div class="pk-h">${bkIcon('math', 16)} 试卷库<span class="pk-sub">${libLoading ? '加载中…' : libError ? '加载失败' : `${fl.length} 份试卷`}</span></div>
          <div class="t10-search">
            <input id="pkQ" class="t10-q" placeholder="搜索试卷名称 / 年份，如 2024 中考" value="${esc(queryDraft)}" maxlength="60">
            <select id="pkGrade"><option value="">全部年级</option>${(flt.grades || []).map((g) => `<option ${find.grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
            <select id="pkYear"><option value="">全部年份</option>${(flt.years || []).map((y) => `<option value="${esc(y)}" ${find.year === y ? 'selected' : ''}>${esc(y)} 年</option>`).join('')}</select>
            <button class="btn primary sm" id="pkSearch">搜索</button>
            ${find.q || find.grade || find.year || find.category ? '<button class="btn ghost sm" id="pkClear">清除</button>' : ''}
          </div>
          <div class="pk-categories" aria-label="试卷类型"><span>类型</span>${[['','全部'], ...Object.entries(BK_PAPER_CATEGORIES)].map(([key, label]) => `<button type="button" class="${find.category === key ? 'on' : ''}" data-pk-category="${key}" aria-pressed="${find.category === key}">${label}</button>`).join('')}</div>
          ${libLoading ? '<div class="pk-empty">加载中…</div>' : libError ? `<div class="pk-empty">${esc(libError)}</div>` : fl.length ? `<div class="pk-lib-grid">${fl.map((p) => `
            <div class="pk-libcard">
              <b>${esc(p.title)}</b>
              <span class="hint">${esc(p.subject || '通用')}${p.grade ? ' · ' + esc(p.grade) : ''}${p.year ? ' · ' + esc(p.year) + ' 年' : ''}${p.exam_category ? ' · ' + esc(BK_PAPER_CATEGORIES[p.exam_category] || '未分类') : ''} · ${Number(p.q_count)} 题 · 满分 ${Number(p.total_score) || 0}</span>
              <div class="pk-lib-acts">${p.tried && p.last ? `<span class="tag ok">上次 ${esc(quizTryText(p.last))}</span>` : '<span class="tag gray">未做过</span>'}
                <button class="btn primary sm" data-lib="${p.id}">查看试卷</button></div>
            </div>`).join('')}</div>` : `<div class="pk-empty">${find.q || find.grade || find.year || find.category ? '没有找到符合条件的试卷，请调整筛选条件' : '试卷库暂无试卷，老师发布后出现在这里'}</div>`}
        </div>`;
      if (window.mtxTypeset) mtxTypeset(host);
      host.querySelectorAll('[data-student-drawing]').forEach((details) => { details.ontoggle = async () => {
        if (!details.open || details.dataset.loaded === '1') return;
        const status = details.querySelector('[data-drawing-status]'), image = details.querySelector('[data-drawing-image]');
        status.textContent = '正在加载作图…';
        try {
          const res = await fetch('/api/stu/bank/subjective-responses/' + Number(details.dataset.studentDrawing) + '/drawing', { headers: { Authorization: 'Bearer ' + Auth.token } });
          if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/png')) throw new Error('加载失败');
          const url = URL.createObjectURL(await res.blob()); if (!image.isConnected) { URL.revokeObjectURL(url); return; }
          image.onload = () => URL.revokeObjectURL(url); image.onerror = () => { URL.revokeObjectURL(url); status.textContent = '作图加载失败，请重试'; details.dataset.loaded = ''; };
          image.src = url; details.dataset.loaded = '1'; status.textContent = '';
        } catch (_) { status.textContent = '作图加载失败，请重试'; }
      }; });
      host.querySelectorAll('.bk-tabs a').forEach((a) => a.onclick = () => { subject = a.dataset.s; searchLib(); });
      const doSearch = () => { find.q = host.querySelector('#pkQ').value.trim(); find.grade = host.querySelector('#pkGrade').value; find.year = host.querySelector('#pkYear').value; searchLib(); };
      host.querySelector('#pkSearch').onclick = doSearch;
      host.querySelector('#pkQ').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
      host.querySelector('#pkGrade').onchange = doSearch; host.querySelector('#pkYear').onchange = doSearch;
      const clr = host.querySelector('#pkClear'); if (clr) clr.onclick = () => { find.q = find.grade = find.year = find.category = ''; host.querySelector('#pkQ').value = ''; searchLib(); };
      host.querySelectorAll('[data-pk-category]').forEach((el) => el.onclick = () => { find.category = el.dataset.pkCategory; searchLib(); });
      host.querySelectorAll('[data-task]').forEach((el) => el.onclick = () => BankPages.openPaper(Number(el.dataset.task), () => { if (isCurrent()) BankPages.papers(host, subject); }));
      host.querySelectorAll('[data-lib]').forEach((el) => el.onclick = () => BankPages.openLibPaper(Number(el.dataset.lib)));
      const scanBtn = host.querySelector('#pkScan .btn');
      if (scanBtn) scanBtn.onclick = () => BankPages.scanFlow('textbook', subject, host);
      const spBtn = host.querySelector('#pkSprint .btn');
      if (spBtn) spBtn.onclick = () => BankPages.scanFlow('knowledge', subject, host);
      if (querySelection && host.isConnected) {
        const input = host.querySelector('#pkQ');
        input.focus({ preventScroll: true });
        input.setSelectionRange(...querySelection);
      }
    };
    paint();
  },

  /** 章节组卷 / 知识点组卷：选范围 → 雷达扫描 → 每个小知识点 1 题 → 做题报告 / 学情报告 */
  async scanFlow(kind, subject, host) {
    if (!subject) { toast('先在上方选择一个学科', 'err'); return; }
    if (BankPages._closeScan) BankPages._closeScan();
    let nodes = [], byParent = {}, byId = new Map();
    const kidsOf = (id) => byParent[id] || [];
    let treeRequest = 0, countRequest = 0, available = 0, composing = false, selectionRevision = 0;
    const route = location.hash;
    const nodeRow = (n, depth) => {
      const kids = kidsOf(n.id);
      return `<div class="pk-node d${depth}">
        <label class="pk-nd"><input type="checkbox" class="pk-ck" data-nd="${n.id}"> ${esc(n.name)}</label>
        ${kids.length ? `<div class="pk-kids ${depth >= 2 ? 'fold' : ''}">${kids.map((k) => nodeRow(k, depth + 1)).join('')}</div>` : ''}
      </div>`;
    };
    const mask = document.createElement('div');
    mask.className = 'mask pk-sel-mask';
    mask.innerHTML = `
      <div class="pk-sel-box">
        <div class="pk-sel-h"><b>${kind === 'knowledge' ? '知识点组卷' : '章节组卷'} · ${esc(subject)}</b><button class="close-x" id="pkSelX">&times;</button></div>
        <div class="pk-sel-tip"><label for="pkEdition">教材版本</label> <select id="pkEdition" disabled><option>正在加载…</option></select></div>
        <div class="pk-sel-tip">勾选${kind === 'knowledge' ? '知识点' : '单元'}，勾选大项会包含全部下级范围。</div>
        <div class="pk-tree" id="pkTree">正在加载目录…</div>
        <div class="pk-sel-f">
          <span><label for="pkWant">练习题量</label> <select id="pkWant"><option value="5">5 题</option><option value="10">10 题</option><option value="20">20 题</option></select><br><span class="hint" aria-live="polite">范围内可用 <b id="pkSelQ">0</b> 题 <span id="pkSelShort"></span></span></span>
          <span><button class="btn ghost" id="pkSelCancel">取消</button>
          <button class="btn primary" id="pkSelGo" disabled>开始扫描</button></span>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const current = () => mask.isConnected && (!host || host.isConnected) && location.hash === route;
    const close = () => { ++treeRequest; ++countRequest; mask.remove(); if (BankPages._closeScan === close) BankPages._closeScan = null; };
    BankPages._closeScan = close;
    mask.querySelector('#pkSelX').onclick = close;
    mask.querySelector('#pkSelCancel').onclick = close;

    // 勾选联动：勾父级 = 勾全部子孙；展开 / 收起
    const setDesc = (id, v) => kidsOf(id).forEach((c) => {
      const cb = mask.querySelector(`.pk-ck[data-nd="${c.id}"]`);
      if (cb) cb.checked = v;
      setDesc(c.id, v);
    });
    // 父节点已包含全部后代，只提交最高层选中节点，避免大树提交大量重复 ID。
    const selectedRoots = () => {
      const selected = new Set([...mask.querySelectorAll('.pk-ck:checked')].map((c) => Number(c.dataset.nd)));
      return [...selected].filter((id) => {
        let parent = byId.get(id);
        while (parent && parent.parent_id) {
          if (selected.has(Number(parent.parent_id))) return false;
          parent = byId.get(Number(parent.parent_id));
        }
        return true;
      });
    };
    const updateCountChoice = () => {
      const hasSelection = !!mask.querySelector('.pk-ck:checked');
      const short = available < Number(mask.querySelector('#pkWant').value);
      mask.querySelector('#pkSelGo').disabled = composing || !hasSelection || short;
      mask.querySelector('#pkSelShort').textContent = hasSelection && short ? '，请减少题量或扩大范围' : '';
    };
    const refreshCount = async () => {
      const seq = ++countRequest;
      const ids = selectedRoots();
      const countEl = mask.querySelector('#pkSelQ');
      const go = mask.querySelector('#pkSelGo');
      available = 0; go.disabled = true; mask.querySelector('#pkSelShort').textContent = '';
      if (!ids.length) { countEl.textContent = '0'; return; }
      countEl.textContent = '查询中…';
      try {
        const data = await api('/api/stu/bank/scan-count', { method: 'POST', silent: true, body: { kind, node_ids: ids, subject } });
        if (!current() || seq !== countRequest) return;
        available = Number(data.total) || 0;
        countEl.textContent = String(available);
        updateCountChoice();
      } catch (err) {
        if (!current() || seq !== countRequest) return;
        countEl.textContent = '查询失败';
        toast(err.message || '查询题量失败', 'err');
      }
    };
    mask.addEventListener('change', (e) => {
      ++selectionRevision;
      const cb = e.target.closest('.pk-ck');
      if (cb) {
        setDesc(Number(cb.dataset.nd), cb.checked);
        if (!cb.checked) {
          let parent = byId.get(Number(cb.dataset.nd));
          while (parent && parent.parent_id) {
            const ancestor = mask.querySelector(`.pk-ck[data-nd="${Number(parent.parent_id)}"]`);
            if (ancestor) ancestor.checked = false;
            parent = byId.get(Number(parent.parent_id));
          }
        }
        refreshCount();
      }
      if (e.target.id === 'pkWant') updateCountChoice();
    });
    mask.addEventListener('click', (e) => {
      const nd = e.target.closest('.pk-nd');
      if (nd && !e.target.closest('.pk-ck')) {
        const kids = nd.parentElement.querySelector(':scope > .pk-kids');
        if (kids) kids.classList.toggle('fold');
      }
    });

    const loadTree = async (id) => {
      const seq = ++treeRequest; ++countRequest; composing = false; available = 0;
      nodes = []; byParent = {}; byId = new Map();
      mask.querySelector('#pkTree').textContent = '正在加载目录…';
      mask.querySelector('#pkSelQ').textContent = '0';
      mask.querySelector('#pkSelShort').textContent = '';
      mask.querySelector('#pkSelGo').disabled = true;
      try {
        const t = await api(`/api/stu/bank/scan-tree?kind=${kind}&subject=${encodeURIComponent(subject)}${id ? '&tree_id=' + encodeURIComponent(id) : ''}`, { silent: true });
        if (!current() || seq !== treeRequest) return;
        const select = mask.querySelector('#pkEdition');
        const choices = t.trees || (t.tree_id ? [{ id: t.tree_id, name: t.tree_name, edition: t.edition }] : []);
        select.innerHTML = choices.length ? choices.map(x => `<option value="${Number(x.id)}">${esc(x.edition || '通用')} · ${esc(x.name || '')}${x.stage === '' ? '（不限学段）' : ''}</option>`).join('') : '<option value="">暂无可用版本</option>';
        select.value = String(t.tree_id || ''); select.disabled = !choices.length;
        nodes = t.nodes || []; byParent = {}; byId = new Map(nodes.map(n => [Number(n.id), n]));
        nodes.forEach(n => { (byParent[n.parent_id || 0] = byParent[n.parent_id || 0] || []).push(n); });
        const roots = nodes.filter(n => !n.parent_id || !byId.has(Number(n.parent_id)));
        mask.querySelector('#pkTree').innerHTML = roots.length ? roots.map(n => nodeRow(n, 0)).join('') : '<div class="empty">当前版本还没有目录，请选择其他版本。</div>';
      } catch (err) {
        if (!current() || seq !== treeRequest) return;
        mask.querySelector('#pkTree').innerHTML = '<div class="empty">目录加载失败，请重试或选择其他版本。<button type="button" class="btn ghost" id="pkTreeRetry">重试</button></div>';
        mask.querySelector('#pkTreeRetry').onclick = () => loadTree(id);
        toast(err.message || '加载失败', 'err');
      }
    };
    mask.querySelector('#pkEdition').onchange = e => loadTree(e.target.value);
    mask.querySelector('#pkSelGo').onclick = async () => {
      if (composing || !current()) return;
      const ids = selectedRoots();
      if (!ids.length || available < Number(mask.querySelector('#pkWant').value)) return;
      const seq = treeRequest, countSeq = countRequest, revision = selectionRevision;
      composing = true; updateCountChoice();
      try {
        const d = await api('/api/stu/bank/scan-compose', { method: 'POST', silent: true, body: { kind, node_ids: ids, subject, count: Number(mask.querySelector('#pkWant').value) } });
        if (!current() || seq !== treeRequest || countSeq !== countRequest || revision !== selectionRevision) return;
        close();
        BankPages.showRadar(kind, subject, d.items || [], host);
      } catch (e) {
        if (current() && seq === treeRequest && countSeq === countRequest && revision === selectionRevision) toast(e.message || '组卷失败', 'err');
      } finally {
        if (current() && seq === treeRequest) { composing = false; updateCountChoice(); }
      }
    };
    await loadTree();
  },

  /** 雷达扫描动画页：小知识点逐个弹出 → 开始做题 → 做题报告 / 学情报告 */
  showRadar(kind, subject, items, host) {
    if (!items.length) { toast('这个范围里还没有题目', 'err'); return; }
    const title = kind === 'knowledge' ? `知识点组卷 · ${subject}` : `章节组卷 · ${subject}`;
    const reportName = kind === 'knowledge' ? '学情报告' : '做题报告';
    const mask = document.createElement('div');
    mask.className = 'mask pk-radar-mask';
    mask.innerHTML = `
      <div class="pk-radar-box">
        <div class="pk-radar-l">
          <div class="pk-radar" id="pkRadar">
            <i class="pk-ring r0"></i><i class="pk-ring r1"></i><i class="pk-ring r2"></i>
            <div class="pk-sweep"></div><div class="pk-center">${esc(subject)}</div>
          </div>
          <div class="pk-radar-tip" id="pkRTip">正在扫描知识点…</div>
        </div>
        <div class="pk-radar-r">
          <div class="pk-radar-title">${esc(title)}</div>
          <div class="pk-chips" id="pkChips"></div>
          <div class="pk-radar-acts">
            <button class="btn ghost" id="pkRCancel">取消</button>
            <button class="btn primary" id="pkRGo" style="display:none"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#pkRCancel').onclick = () => mask.remove();
    const chips = mask.querySelector('#pkChips');
    const groups = new Map();
    items.forEach((it) => { const name = it.node_name || '未命名知识点'; groups.set(name, (groups.get(name) || 0) + 1); });
    [...groups].forEach(([name, count], i) => {
      setTimeout(() => {
        chips.insertAdjacentHTML('beforeend', `<span class="pk-chip pop">${esc(name)}<b>${count} 题</b></span>`);
        chips.parentElement.scrollTop = chips.parentElement.scrollHeight;
        if (i === groups.size - 1) {
          const radar = mask.querySelector('#pkRadar');
          if (radar) radar.classList.add('done');
          mask.querySelector('#pkRTip').textContent = `扫描完成：${groups.size} 个知识点，共 ${items.length} 题`;
          const go = mask.querySelector('#pkRGo');
          go.style.display = '';
          go.textContent = `开始做题（${items.length} 题）`;
          go.onclick = () => {
            mask.remove();
            BankQuiz.open({
              mode: 'step',
              title,
              subtitle: `${subject} · ${items.length} 题 · 做一题核对一题`,
              questions: items.map((x) => x.question),
              submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'self', answers, duration } }),
              onDone: () => { BankPages.papers(host, subject); },
            });
          };
        }
      }, 400 + i * 220);
    });
  },

  /** 试卷库：试卷管理发布出来的卷子在线作答 */
  async openLibPaper(id) {
    let p;
    try { p = await api('/api/stu/bank/mfpapers/' + id); }
    catch (e) { toast(e.message || '试卷加载失败', 'err'); return; }
    if (!p.questions || !p.questions.length) { toast('这份试卷还没有题目'); return; }
    const mask = document.createElement('div');
    mask.className = 'mask pk-sel-mask';
    mask.innerHTML = `<div class="pk-sel-box pk-preview" role="dialog" aria-modal="true" aria-label="试卷预览">
      <div class="pk-sel-h"><b>${esc(p.title)}</b><button type="button" class="close-x" aria-label="关闭">&times;</button></div>
      <div class="pk-preview-body"><p class="hint">${[p.subject, p.grade, p.year ? p.year + ' 年' : '', BK_PAPER_CATEGORIES[p.exam_category], p.questions.length + ' 题', '满分 ' + (Number(p.total_score) || 0)].filter(Boolean).map(esc).join(' · ')}</p>
      <p class="pk-preview-caption">试题预览</p>${p.questions.slice(0, 5).map(paperPreviewQuestionHTML).join('')}${p.questions.length > 5 ? '<p class="hint">这里只展示前 5 道题，开始作答后可查看完整试卷。</p>' : ''}</div>
      <div class="pk-sel-f"><span></span><span><button type="button" class="btn ghost" id="pkPreviewClose">关闭</button> <button type="button" class="btn primary" id="pkPreviewStart">开始作答</button></span></div></div>`;
    document.body.appendChild(mask);
    mask.querySelector('.close-x').onclick = () => mask.remove();
    mask.querySelector('#pkPreviewClose').onclick = () => mask.remove();
    bindImageZoom(mask); if (window.mtxTypeset) mtxTypeset(mask);
    mask.querySelector('#pkPreviewStart').onclick = () => { mask.remove(); BankQuiz.open({
      title: p.title,
      subtitle: [p.subject, p.year ? p.year + ' 年' : '', p.questions.length + ' 题'].filter(Boolean).join(' · '),
      questions: p.questions,
      scoreTotal: p.total_score || 0,
      submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'mfpaper', paper_id: p.id, answers, duration } }),
      onDone: () => { if (window.__stuVm) window.__stuVm.courses = null; },
    }); };
  },

  async openPaper(id, onDone) {
    let p;
    try { p = await api('/api/stu/bank/papers/' + id); }
    catch (e) { toast(e.message || '试卷加载失败', 'err'); return; }
    if (!p.questions || !p.questions.length) { toast('这份试卷还没有题目'); return; }
    const deadline = paperDeadlineInfo(p.due_at);
    if (deadline.expired) toast('这份试卷已截止，可以查看题目；提交以服务器校验为准。', 'err');
    BankQuiz.open({
      title: p.title,
      subtitle: [p.subject, p.duration + ' 分钟', '满分 ' + p.total_score, deadline.text].filter(Boolean).join(' · '),
      notice: deadline.text,
      questions: p.questions,
      scoreTotal: p.total_score,
      submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'paper', paper_id: p.id, answers, duration } }),
      onDone: () => { if (window.__stuVm) window.__stuVm.courses = null; if (onDone) return onDone(); },
    });
  },

  /** 错题本：首页（横幅 + 四大学科卡片）→ 学科内页（时间强化 + 薄弱知识点 + 历史错题 + 上传的错题） */
  async mistakes(host) {
    const isCurrent = bkPageRun(host);
    if (!isCurrent()) return;
    host.innerHTML = '<div class="loading-page">加载中…</div>';
    let data;
    try { data = await api('/api/stu/bank/mistakes', { silent: true }); }
    catch (e) { if (isCurrent()) host.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`; return; }
    if (!isCurrent()) return;

    const SUBJ_META = { '数学': { icon: 'math', cls: 'smath' }, '英语': { icon: 'eng', cls: 'seng' }, '物理': { icon: 'phy', cls: 'sphy' }, '化学': { icon: 'chem', cls: 'schem' } };
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const ageDays = (m) => {
      const t = new Date(String(m.updated_at || '').slice(0, 10) + 'T00:00:00');
      return isNaN(t) ? 0 : Math.max(0, Math.round((dayStart - t) / 86400000));
    };
    const bucketOf = (m) => { const d = ageDays(m); return d <= 2 ? 'd2' : d <= 7 ? 'd7' : d <= 180 ? 'd180' : 'history'; };
    const inBucket = (m, b) => !m.resolved && (m.subject || '其他') === subject && bucketOf(m) === b;

    /** 把一组错题串成一次重做弹层（答对移出，答错回炉） */
    const quizMistakes = (list, title, subtitle) => {
      const actionIsCurrent = beginMistakeAction();
      if (!actionIsCurrent()) return;
      if (!list.length) { toast('这里暂时没有错题'); return; }
      BankQuiz.open({
        title, subtitle: subtitle || '答对的题自动移出错题本',
        questions: list.map((m) => ({
          id: m.question_id, quiz_ticket: m.quiz_ticket, type: m.type, question_subtype: m.question_subtype || '', match_prompts: m.match_prompts || [], subject: m.subject || '', stem: m.stem, material: m.material || '', options: m.options || [], images: m.images || [], point: m.point || '', audio_url: m.audio_url || '', audio_play_limit: m.audio_play_limit || 0,
          blanks: m.type === 'fill' ? String(m.answer || '').replace(/\|\|\|/g, '\u0001').split('|').length : 0,
        })),
        submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'redo', answers, duration } }),
        onDone: () => { if (isCurrent()) return BankPages.mistakes(host); },
      });
    };

    /** 错题卡片（历史错题列表复用） */
    const mistCard = (m) => {
      const stage = Math.min(3, Number(m.review_stage) || 0);
      return `
      <div class="bk-mist ${m.resolved ? 'resolved' : ''}">
        <div class="bm-top">
          <span class="tag">${QT_NAME[m.type] || '题目'}</span>
          ${m.point ? `<span class="tag gray">${esc(m.point)}</span>` : ''}
          <span class="tag gray">${esc(m.source || '练习')}</span>
          <span class="tag gray">答错 ${Number(m.wrong_count) || 0} 次</span>
          ${m.resolved ? '<span class="tag ok">已掌握</span>' : `<span class="bm-dots" title="复习连续答对 ${stage}/3 次">${'●'.repeat(stage)}${'○'.repeat(3 - stage)}</span>`}
          <span class="bm-time">${esc(String(m.updated_at || '').slice(0, 16))}</span>
        </div>
        ${m.material ? `<div class="qz-material folded"><div class="qz-mat-t">查看原文</div><div class="qz-mat-b">${esc(m.material)}</div></div>` : ''}
        ${quizAudioHTML(m)}
        <div class="bm-stem">${esc(m.stem)}</div>
        ${quizImagesHTML(m)}
        ${Array.isArray(m.options) && m.options.length && m.type !== 'fill' && m.type !== 'sort'
          ? `<div class="bm-opts">${m.options.map((t, i) => `<span class="bm-opt">${QT_LETTERS[i]}. ${esc(optText(t))}</span>`).join('')}</div>` : ''}
        <div class="qz-rrow my"><span>我的答案</span><em class="no">${esc(quizAnswerDisplay(m, m.last_answer, m.options))}</em></div>
        <div class="qz-rrow"><span>正确答案</span><em class="ok">${esc(quizAnswerDisplay(m, m.answer, m.options))}</em></div>
        ${m.analysis ? `<div class="qz-ana"><span>解析</span>${esc(m.analysis)}</div>` : ''}
        <div class="bm-acts">
          <button class="btn primary sm" data-redo="${m.question_id}"><i class="ai ai-refresh"></i> 重做</button>
          <button class="btn ghost sm" data-similar="${m.question_id}">举一反三</button>
          <button class="btn ghost sm" data-resolve="${m.question_id}">${m.resolved ? '恢复到错题本' : '我会了，移出错题本'}</button>
        </div>
      </div>`;
    };
    // Only the newest action in this rendered page may open a popup or report an error.
    let mistakeActionVersion = 0;
    const beginMistakeAction = () => {
      const action = ++mistakeActionVersion, version = paintVersion, hash = location.hash;
      return () => isCurrent() && version === paintVersion && hash === location.hash && action === mistakeActionVersion;
    };
    const bindMistCards = (root, arr) => {
      root.querySelectorAll('.qz-material').forEach((m) => { m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded'); });
      bindImageZoom(root);
      bindQuizAudio(root);
      if (window.mtxTypeset) mtxTypeset(root);
      root.querySelectorAll('[data-redo]').forEach((b) => b.onclick = () => {
        const hit = arr.find((m) => m.question_id === Number(b.dataset.redo));
        if (hit) quizMistakes([hit], '错题重做', '答对后自动移出错题本');
      });
      root.querySelectorAll('[data-similar]').forEach((b) => b.onclick = async () => {
        if (b.disabled) return;
        const actionIsCurrent = beginMistakeAction();
        if (!actionIsCurrent()) return;
        b.disabled = true;
        try {
          const result = await api(`/api/stu/bank/mistakes/${Number(b.dataset.similar)}/similar`, { silent: true });
          if (!actionIsCurrent()) return;
          const questions = result.list || [];
          if (!questions.length) return toast('该知识点暂时没有新题', 'err');
          BankQuiz.open({
            mode: 'step', title: '举一反三',
            subtitle: `${result.point || '同一知识点'} · ${questions.length} 题`,
            notice: questions.length < 3 ? `这个知识点目前有 ${questions.length} 道未做过的新题，题目不足 3 道。` : '',
            questions,
            submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'self', answers, duration } }),
            onDone: () => { if (isCurrent()) return BankPages.mistakes(host); },
          });
        } catch (e) { if (actionIsCurrent()) toast(e.message || '加载失败，请重试', 'err'); }
        finally { b.disabled = false; }
      });
      root.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => {
        const qid = Number(b.dataset.resolve);
        const hit = arr.find((m) => m.question_id === qid);
        try { await api(`/api/stu/mistakes/${qid}/resolve`, { method: 'POST', body: { resolved: hit && hit.resolved ? 0 : 1 } }); }
        catch (e) { return; }
        if (hit) hit.resolved = hit.resolved ? 0 : 1;
        paint();
      });
    };

    /** 微信扫码上传：弹二维码（长期活码，绑定本学生） */
    const showQR = async () => {
      const actionIsCurrent = beginMistakeAction(), requestedSubject = subject;
      if (!actionIsCurrent()) return;
      let r;
      try { r = await api('/api/stu/bank/upload-token', { method: 'POST', silent: true }); }
      catch (e) { if (actionIsCurrent()) toast(e.message || '获取二维码失败，请重试', 'err'); return; }
      if (!actionIsCurrent()) return;
      const url = location.origin + '/upload.html?t=' + r.token + '&subject=' + encodeURIComponent(requestedSubject);
      const m = document.createElement('div');
      m.className = 'mask';
      m.innerHTML = `<div class="qr-box">
        <button class="close-x" id="qrClose" title="关闭">&times;</button>
        <b class="qr-t">📱 手机扫码上传错题</b>
        <div id="qrCanvas"></div>
        <p class="qr-tip">用手机扫一扫 → 拍一张纸质错题的照片<br>系统会尝试识别题目，老师审核通过后会进入你的错题本</p>
        <p class="qr-exp ok">✓ 二维码长期有效，可截图保存或打印贴在书桌上</p>
      </div>`;
      document.body.appendChild(m);
      m.querySelector('#qrClose').onclick = () => m.remove();
      m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
      if (window.QRCode) new QRCode(m.querySelector('#qrCanvas'), { text: url, width: 208, height: 208, correctLevel: QRCode.CorrectLevel.M });
      else m.querySelector('#qrCanvas').innerHTML = `<a href="${esc(url)}" target="_blank">打开上传页</a>`;
    };

    /** 复习：今天到期的错题串成一组 */
    const startReview = async () => {
      const actionIsCurrent = beginMistakeAction();
      if (!actionIsCurrent()) return;
      let r;
      try { r = await api('/api/stu/bank/review-queue', { silent: true }); }
      catch (e) { if (actionIsCurrent()) toast(e.message || '加载失败', 'err'); return; }
      if (!actionIsCurrent()) return;
      if (!r.list || !r.list.length) { toast('今天没有到期的复习题，明天再来吧', 'ok'); return; }
      BankQuiz.open({
        title: '错题复习',
        subtitle: `共 ${r.list.length} 题 · 连续答对 3 次自动掌握`,
        questions: r.list,
        submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'review', answers, duration } }),
        onDone: () => { if (isCurrent()) return BankPages.mistakes(host); },
      });
    };

    // 顶部学科 tab（按红框顺序）：进入错题本直接显示第一个学科的内容页
    const MIST_ORDER = ['英语', '数学', '物理', '化学'];
    let subject = MIST_ORDER.find((s) => data.list.some((m) => m.subject === s && !m.resolved)) || MIST_ORDER.find((s) => data.counts[s]) || MIST_ORDER[0], sub = '';
    let mistFilter = { source: '', count: '', days: '', point: '' };   // sub: '' | points | history | uploads
    let paintVersion = 0;
    const paint = () => {
      if (!isCurrent()) return;
      const version = ++paintVersion;
      return sub ? paintSub(version) : paintSubject();
    };

    // ---- 顶部学科 tabs（渲染到顶栏白框的挂载点 #bkTabsMount，含错题数角标） ----
    const tabsHTML = () => `
      <div class="bk2-tabs">${MIST_ORDER.map((s) => `
        <a class="${subject === s ? 'on ' + SUBJ_META[s].cls : ''}" data-s="${s}">
          <span class="bmt-ic">${bkIcon(SUBJ_META[s].icon, 15)}</span>${s}<b>${data.counts[s] || 0}</b>
        </a>`).join('')}</div>`;
    const bindTabs = () => {
      if (!isCurrent()) return;
      const m = document.getElementById('bkTabsMount');
      if (!m) return;
      m.innerHTML = tabsHTML();
      m.querySelectorAll('.bk2-tabs a').forEach((a) => a.onclick = () => {
        if (subject === a.dataset.s && !sub) return;
        subject = a.dataset.s; sub = ''; paint();
      });
    };

    // ---- 学科页（T9 改版）：概览卡 + 三个时间段强化 + 功能入口 ----
    const ymdStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymdStr(d); };

    /** 导出错题 Word：选范围 → 下载 .docx（可编辑；版式见 src/mistake-docx.js） */
    const exportWord = () => {
      const actionIsCurrent = beginMistakeAction();
      if (!actionIsCurrent()) return;
      const RANGES = [
        ['unresolved', '全部未掌握的错题', {}],
        ['d2', '2天内的错题', { from: daysAgo(2) }],
        ['d7', '3-7天内的错题', { from: daysAgo(7), to: daysAgo(3) }],
        ['d180', '8-180天内的错题', { from: daysAgo(180), to: daysAgo(8) }],
        ['resolved', '已掌握的错题', { bucket: 'resolved' }],
        ['all', '全部错题（含已掌握）', { bucket: 'all' }],
      ];
      const m = document.createElement('div');
      m.className = 'mask';
      m.innerHTML = `<div class="t9-dlg">
        <button class="close-x" id="t9xClose" title="关闭">&times;</button>
        <b class="t9-dlg-t">📄 导出${esc(subject)}错题 Word</b>
        <p class="t9-dlg-s">选择打印内容和错题范围，生成可编辑的 Word。</p>
        <div class="r9-print-options"><label><input type="radio" name="r9-print" value="0"> <b>仅打印题目</b><small>适合重新练习</small></label><label><input type="radio" name="r9-print" value="1" checked> <b>打印题目和解析</b><small>包含答案与作答记录</small></label></div>
        <div class="t9-dlg-r">${RANGES.map(([k, t], i) => `<label class="t9-radio"><input type="radio" name="t9r" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <div class="t9-dlg-f"><button class="btn ghost" id="t9xCancel">取消</button><button class="btn primary" id="t9xGo">下载 Word</button></div>
      </div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      m.querySelector('#t9xClose').onclick = close; m.querySelector('#t9xCancel').onclick = close;
      m.addEventListener('click', (e) => { if (e.target === m) close(); });
      const updateCount = () => {
        const key = m.querySelector('input[name=t9r]:checked').value;
        const range = RANGES.find((r) => r[0] === key)[2];
        const n = data.list.filter((q) => { const date = String(q.updated_at || '').slice(0, 10); return q.subject === subject && (range.bucket === 'all' || (range.bucket === 'resolved' ? q.resolved : !q.resolved)) && (!range.from || date >= range.from) && (!range.to || date <= range.to); }).length;
        m.querySelector('#t9xGo').textContent = `下载 Word（${n} 题）`;
      };
      m.querySelectorAll('input[name=t9r]').forEach((el) => el.addEventListener('change', updateCount));
      updateCount();
      m.querySelector('#t9xGo').onclick = async () => {
        const key = (m.querySelector('input[name=t9r]:checked') || {}).value || 'unresolved';
        const range = RANGES.find((r) => r[0] === key)[2];
        const qs = new URLSearchParams(Object.assign({ subject, include_answers: (m.querySelector('input[name=r9-print]:checked') || {}).value || '1' }, range));
        const btn = m.querySelector('#t9xGo'); btn.disabled = true; btn.textContent = '生成中…';
        try {
          const res = await fetch('/api/stu/mistakes/export-docx?' + qs.toString(), { headers: { Authorization: 'Bearer ' + Auth.token } });
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) { const j = await res.json(); throw new Error(j.msg || '导出失败'); }
          if (!res.ok) throw new Error('导出失败（' + res.status + '）');
          const blob = await res.blob();
          const name = `${(Auth.user && Auth.user.name) || '我'}-${subject}-错题集.docx`;
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast(`已导出 ${res.headers.get('X-Mistake-Count') || ''} 道错题`, 'ok');
          close();
        } catch (e) { toast(e.message || '导出失败', 'err'); btn.disabled = false; updateCount(); }
      };
    };

    const paintSubject = () => {
      const list = data.list.filter((m) => (m.subject || '其他') === subject);
      const cnt = (b) => list.filter((m) => inBucket(m, b)).length;
      const d2 = cnt('d2'), d7 = cnt('d7'), d180 = cnt('d180');
      const open = list.filter((m) => !m.resolved).length;
      const mastered = list.filter((m) => m.resolved).length;
      const his = list.filter((m) => m.resolved || ageDays(m) > 180).length;
      const due = data.review.due || 0;
      const pct = list.length ? Math.round(mastered / list.length * 100) : 0;
      host.innerHTML = `
        <div class="t9-root">
          <section class="t9-hero t9-${SUBJ_META[subject] ? SUBJ_META[subject].cls : 'smath'}">
            <div class="t9-hero-l">
              <span class="t9-hero-k">${esc(subject)}错题本</span>
              <div class="t9-hero-n"><em>${open}</em><span>道待攻克</span></div>
              <div class="t9-hero-bar" title="已掌握 ${mastered} / 共 ${list.length} 题"><i style="width:${pct}%"></i></div>
              <span class="t9-hero-s">已掌握 ${mastered} 题 · 累计 ${list.length} 题${due ? ` · 今天有 <b>${due}</b> 题到期复习` : ''}</span>
            </div>
            <div class="t9-hero-acts">
              ${due ? '<button class="t9-btn t9-btn-main" id="bkReview"><i class="ai ai-flash"></i> 开始今日复习</button>' : ''}
              <button class="t9-btn" id="bkUpBtn">📱 手机扫码上传</button>
              <button class="t9-btn" id="bkDocx">📄 导出 Word</button>
            </div>
          </section>
          <div class="t9-sec">按时间强化</div>
          <div class="t9-buckets">
            <button class="t9-bucket c-red" id="bkD2" ${d2 ? '' : 'disabled'}><em>${d2}</em><span>2天内错题</span><i>${d2 ? '去强化 ›' : '暂无'}</i></button>
            <button class="t9-bucket c-orange" id="bkD7" ${d7 ? '' : 'disabled'}><em>${d7}</em><span>3-7天内错题</span><i>${d7 ? '去强化 ›' : '暂无'}</i></button>
            <button class="t9-bucket c-blue" id="bkD180" ${d180 ? '' : 'disabled'}><em>${d180}</em><span>8-180天内错题</span><i>${d180 ? '去强化 ›' : '暂无'}</i></button>
          </div>
          <div class="t9-sec">更多</div>
          <div class="t9-funcs">
            <button class="t9-func" id="bkPts">
              <span class="t9-func-ic i-purple">${bkIcon('points', 22)}</span>
              <span class="t9-func-m"><b>薄弱知识点<em class="t9-ai">AI</em></b><span>AI 识别错题考点，同类归在一起强化</span></span><i>›</i>
            </button>
            <button class="t9-func" id="bkAll">
              <span class="t9-func-ic i-blue">${bkIcon('history', 22)}</span>
              <span class="t9-func-m"><b>全部错题</b><span>按来源、次数、时间和知识点筛选</span></span><i>›</i>
            </button>
            <button class="t9-func" id="bkHis">
              <span class="t9-func-ic i-blue">${bkIcon('history', 22)}</span>
              <span class="t9-func-m"><b>历史错题</b><span>${his ? `${his} 题 · 已掌握或超期` : '暂无历史错题'}</span></span><i>›</i>
            </button>
            <button class="t9-func" id="bkUps">
              <span class="t9-func-ic i-pink">${bkIcon('upload', 22)}</span>
              <span class="t9-func-m"><b>上传的错题</b><span>手机扫码上传的纸质错题和审核进度</span></span><i>›</i>
            </button>
          </div>
        </div>`;
      bindTabs();
      const rb = host.querySelector('#bkReview');
      if (rb) rb.onclick = startReview;
      host.querySelector('#bkD2').onclick = () => quizMistakes(list.filter((m) => inBucket(m, 'd2')), `${subject}错题强化 · 2天内`, '连续答对自动移出错题本');
      host.querySelector('#bkD7').onclick = () => quizMistakes(list.filter((m) => inBucket(m, 'd7')), `${subject}错题强化 · 3-7天`, '连续答对自动移出错题本');
      host.querySelector('#bkD180').onclick = () => quizMistakes(list.filter((m) => inBucket(m, 'd180')), `${subject}错题强化 · 7-180天`, '连续答对自动移出错题本');
      host.querySelector('#bkPts').onclick = () => { sub = 'points'; paint(); };
      host.querySelector('#bkHis').onclick = () => { sub = 'history'; paint(); };
      host.querySelector('#bkAll').onclick = () => { sub = 'all'; paint(); };
      host.querySelector('#bkUps').onclick = () => { sub = 'uploads'; paint(); };
      host.querySelector('#bkUpBtn').onclick = showQR;
      host.querySelector('#bkDocx').onclick = exportWord;
    };

    // ---- 学科子页：薄弱知识点（AI 归类）/ 历史错题 / 上传的错题 ----
    const paintSub = (version) => {
      const subIsCurrent = () => isCurrent() && version === paintVersion;
      const bindBack = () => {
        const back = host.querySelector('#bkBack');
        if (back) back.onclick = () => { sub = ''; paint(); };
      };
      const list = data.list.filter((m) => (m.subject || '其他') === subject);
      const head = (t) => `<div class="bk-shead">
          <button class="btn ghost sm" id="bkBack">‹ 返回</button>
          <b class="bk-shead-t">${esc(subject)}错题本 · ${t}</b>
        </div>`;
      if (sub === 'points') {
        host.innerHTML = head('薄弱知识点') + `
          <div class="bk-ai-loading">
            <span class="bai-spin"></span>
            <b>AI 正在识别每道错题的知识点…</b>
            <span>首次识别约需 10~30 秒，识别结果会记住，下次秒开</span>
          </div>`;
        bindTabs();
        bindBack();
        api(`/api/stu/bank/mistake-points?subject=${encodeURIComponent(subject)}`, { silent: true }).then((r) => {
          if (!subIsCurrent()) return;
          const groups = r.groups || [];
          const cur = host.querySelector('.bk-ai-loading');
          if (!cur) return;   // 用户已切走
          host.innerHTML = head('薄弱知识点') + (groups.length ? `
            ${r.ai_used ? '<div class="bk-ai-done">✓ AI 已完成识别，同知识点的错题归纳在一起，点击即可开始强化</div>' : ''}
            <div class="bk-pt-list">${groups.map((g) => `
              <button class="bk-pt-it" data-p="${esc(g.point)}"><span class="bp-name">${esc(g.point)}</span><b>${g.count} 题</b><i>去强化 ›</i></button>`).join('')}</div>
            ${(r.ungrouped || 0) ? `<div class="bk-ai-rest">另有 ${r.ungrouped} 道题暂未识别出知识点，会随着 AI 学习逐步归类</div>` : ''}`
            : `<div class="empty">${r.ai_fail ? 'AI 识别暂时失败，请稍后重试' : '这个学科暂时没有薄弱知识点，去「做练习」挑战一下吧！'}</div>`);
          bindTabs();
          host.querySelectorAll('.bk-pt-it').forEach((b) => b.onclick = () => {
            const g = groups.find((x) => x.point === b.dataset.p);
            const qs = (g ? g.ids : []).map((qid) => list.find((m) => m.question_id === qid)).filter(Boolean);
            quizMistakes(qs, `${subject} · ${b.dataset.p}`, '攻克薄弱知识点');
          });
          const back = host.querySelector('#bkBack');
          if (back) back.onclick = () => { sub = ''; paint(); };
        }).catch((e) => {
          if (!subIsCurrent()) return;
          host.innerHTML = head('薄弱知识点') + `<div class="empty">${esc(e.message || '加载失败')}</div>`;
          bindTabs();
          const back = host.querySelector('#bkBack');
          if (back) back.onclick = () => { sub = ''; paint(); };
        });
        return;
      }
      if (sub === 'all') {
        const filtered = list.filter((q) => (!mistFilter.source || (q.source || '练习') === mistFilter.source)
          && (!mistFilter.count || (mistFilter.count === '2' ? Number(q.wrong_count) >= 2 : Number(q.wrong_count) === 1))
          && (!mistFilter.days || ageDays(q) <= Number(mistFilter.days))
          && (!mistFilter.point || (q.point || '') === mistFilter.point));
        host.innerHTML = head('全部错题') + `<div class="r9-list-head"><span>共 ${filtered.length} 题</span><button type="button" class="btn ghost sm" id="r9Filter">筛选</button></div>` + (filtered.length ? `<div class="bk-mist-list">${filtered.map(mistCard).join('')}</div>` : '<div class="empty">没有符合条件的错题</div>');
        bindTabs(); bindMistCards(host, filtered);
        host.querySelector('#bkBack').onclick = () => { sub = ''; paint(); };
        host.querySelector('#r9Filter').onclick = () => {
          const drawer = document.createElement('div'); drawer.className = 'r9-filter-mask';
          const opts = (items, selected) => items.map(([v,t]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
          const sources = [...new Set(list.map((q) => q.source || '练习'))].sort();
          const points = [...new Set(list.map((q) => q.point).filter(Boolean))].sort();
          drawer.innerHTML = `<div class="r9-filter" role="dialog" aria-modal="true" aria-label="错题筛选"><h3>筛选错题</h3>
            <label>来源<select name="source">${opts([['','全部来源'],...sources.map(x=>[x,x])],mistFilter.source)}</select></label>
            <label>错误次数<select name="count">${opts([['','全部次数'],['1','错过 1 次'],['2','错过 2 次及以上']],mistFilter.count)}</select></label>
            <label>时间<select name="days">${opts([['','全部时间'],['7','最近 7 天'],['30','最近 30 天'],['90','最近 90 天']],mistFilter.days)}</select></label>
            <label>知识点<select name="point">${opts([['','全部知识点'],...points.map(x=>[x,x])],mistFilter.point)}</select></label>
            <div class="r9-filter-actions"><button type="button" data-act="reset">重置</button><button type="button" data-act="apply">查看结果</button></div></div>`;
          document.body.appendChild(drawer);
          drawer.addEventListener('click', (e) => { if(e.target===drawer) drawer.remove(); });
          drawer.querySelector('[data-act=reset]').onclick = () => { drawer.querySelectorAll('select').forEach((el) => { el.value = ''; }); };
          drawer.querySelector('[data-act=apply]').onclick = () => { drawer.querySelectorAll('select').forEach((el) => { mistFilter[el.name] = el.value; }); drawer.remove(); paint(); };
        };
        return;
      }
      if (sub === 'history') {
        const his = list.filter((m) => m.resolved || ageDays(m) > 180);
        host.innerHTML = head('历史错题') + (his.length ? `<div class="bk-mist-list">${his.map(mistCard).join('')}</div>` : '<div class="empty">暂无历史错题</div>');
        bindTabs();
        bindMistCards(host, his);
        host.querySelector('#bkBack').onclick = () => { sub = ''; paint(); };
        return;
      }
      host.innerHTML = head('上传的错题') + '<div class="loading-page">加载中…</div>';
      bindTabs();
      bindBack();
      api('/api/stu/bank/uploads', { silent: true }).then((r) => {
        if (!subIsCurrent()) return;
        const ups = r.list || [];
        const ST = { pending: ['老师审核中', 'gray'], reviewed: ['老师核对中', ''], approved: ['老师已确认', 'ok'], rejected: ['已移除', 'no'] };
        host.innerHTML = head('上传的错题') + (ups.length ? `<div class="bk-up-list">${ups.map((u) => `
          <div class="bk-up-it">
            <div class="bu-top"><span class="tag ${ST[u.status] ? ST[u.status][1] : 'gray'}">${ST[u.status] ? ST[u.status][0] : esc(u.status)}</span>
              ${u.subject ? `<span class="tag subj">${esc(u.subject)}</span>` : ''}
              ${u.point ? `<span class="tag gray">${esc(u.point)}</span>` : ''}
              ${u.error_type ? `<span class="tag gray">${esc(u.error_type)}</span>` : ''}
              <span class="bm-time">${esc(String(u.created_at || '').slice(0, 16))}</span></div>
            ${u.stem_text ? `<div class="bu-note">${esc(u.stem_text)}</div>` : ''}
            ${u.note ? `<div class="bu-note">${esc(u.note)}</div>` : ''}
            <div class="qz-imgs">${(u.images || []).map((s) => `<img class="qz-img" src="${esc(s)}" loading="lazy">`).join('')}</div>
            ${u.status === 'approved' ? '<div class="bu-ok">✓ 老师已确认这道题，继续保持！</div>'
              : u.status === 'rejected' ? `<div class="bu-no">这道题被老师移出了错题本${u.review_note ? '：' + esc(u.review_note) : ''}</div>`
              : '<div class="bu-wait">已提交给老师审核，审核通过后进入错题本</div>'}
          </div>`).join('')}</div>` : '<div class="empty">还没有上传过错题，点上方「手机扫码上传」试试</div>');
        bindImageZoom(host);
        bindTabs();
        host.querySelector('#bkBack').onclick = () => { sub = ''; paint(); };
      }).catch((e) => {
        if (!subIsCurrent()) return;
        host.innerHTML = head('上传的错题') + `<div class="empty">${esc(e.message || '加载失败')}</div>`;
        bindBack();
      });
    };

    paint();
  },
};

window.BankQuiz = BankQuiz;
window.quizAccText = quizAccText;
window.BankPages = BankPages;
