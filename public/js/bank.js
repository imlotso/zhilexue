/* 学生端 · 智能题库（2026-10 新增）
 *  - BankQuiz.open()   全屏做题弹层：单选 / 多选 / 判断 / 填空 / 排序（连词成句），交卷判分 + 答案解析
 *  - BankPages.papers()     学生端「试卷」页
 *  - BankPages.mistakes()   学生端「错题本」页（按学科分类，可重做、移出）
 * 被 vue-app.js 调用，依赖 api.js 的 api / esc / toast / elConfirm。 */
'use strict';

const QT_NAME = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序·连词成句' };
const QT_LETTERS = 'ABCDEFG';

/** 稳定打乱（按题目 id 做种子，同一题每次进入顺序一致，避免「答案就是原顺序」的排序题泄题） */
function quizShuffle(arr, seed) {
  const a = arr.map((v, i) => [v, i]);
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
  const rest = imgs.map((s, i) => (used.has(i) ? '' : r0FigHTML(s, '题目图片'))).join('');
  return { stem, rest: rest ? `<div class="qz-imgs">${rest}</div>` : '' };
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
  return `<div class="t7-audio"><div class="t7-audio-t">🎧 先听音频，再作答（可以反复听）</div>
    <audio controls playsinline preload="none" src="${esc(quizAudioSrc(q.audio_url))}"></audio>
    <div class="t7-audio-err" hidden>音频没能加载，请检查网络后<a href="javascript:;" data-t7retry>点这里重试</a>；一直不行就告诉老师。</div></div>`;
}
function bindQuizAudio(root) {
  (root || document).querySelectorAll('.t7-audio audio').forEach((a) => {
    const box = a.closest('.t7-audio'); const err = box.querySelector('.t7-audio-err');
    a.addEventListener('error', () => { err.hidden = false; });
    a.addEventListener('playing', () => { err.hidden = true; });
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
    mask.className = 'mask quiz-mask r8-qmask';
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
      <div class="quiz-box r8-qz fs-md ${isStep ? 'quiz-step' : ''}">
        <div class="quiz-h r8-qz-h">
          <div class="quiz-h-t"><b title="${esc(opt.title || '在线做题')}">${esc(opt.title || '在线做题')}</b>${opt.subtitle ? `<span>${esc(opt.subtitle)}</span>` : ''}</div>
          <div class="quiz-h-r">
            <span class="quiz-prog" id="qzProg"></span>
            <span class="qz-fs" id="qzFs" title="字体大小"><button data-fs="sm">小</button><button class="on" data-fs="md">中</button><button data-fs="lg">大</button></span>
            <button class="close-x" id="qzClose" title="退出">&times;</button>
          </div>
        </div>
        <div class="quiz-bar"><i id="qzBarFill"></i></div>
        <div class="r8-qz-main">
          <div class="r8-qz-left">
            <div class="quiz-body" id="qzBody"></div>
            <button type="button" class="r8-ai-fab" id="qzAiFab" hidden>${r8Ic('ai')}<span>AI 老师</span></button>
            <div class="qz-kpad" id="qzKpad" style="display:none"></div>
            <div class="quiz-f" id="qzFoot"></div>
          </div>
          <aside class="r8-qz-side" id="qzSide">
            <div class="r8-side-timer">${r8Ic('clock')}<span>已用时间</span><b class="qz-timer" id="qzTimer">00 : 00</b></div>
            <div class="r8-side-t">题号<em>（${total} 题）</em></div>
            <div class="quiz-dots r8-dots" id="qzDots"></div>
            <div class="r8-legend"><span><i class="u"></i>未做</span><span><i class="d"></i>已做</span><span><i class="ok"></i>答对</span><span><i class="no"></i>答错</span></div>
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

    const destroy = () => { stopTimer(); aiDestroy(); mask.remove(); document.removeEventListener('keydown', onKey, true); };
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
        return `<button type="button" class="qz-dot r8-dot ${cls} ${st.phase !== 'result' && i === st.idx ? 'on cur' : ''}" data-i="${i}" title="第 ${i + 1} 题">${i + 1}</button>`;
      }).join('');
      dotsEl.querySelectorAll('.qz-dot').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.i);
        if (st.phase === 'result') { const card = bodyEl.querySelector(`.qz-rq[data-qid="${qs[i].id}"]`); if (card) bodyEl.scrollTo({ top: bodyEl.scrollTop + card.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 12, behavior: 'smooth' }); return; }
        st.idx = i; paint();
      });
      const checkedN = Object.keys(st.checked).length;
      $('#qzProg').textContent = st.phase === 'result' ? '已完成' : `已核对 ${checkedN} / ${total}`;
      $('#qzBarFill').style.width = Math.round((st.phase === 'result' ? total : checkedN) / total * 100) + '%';
      const cur = dotsEl.querySelector('.cur');
      if (cur && dotsEl.scrollWidth > dotsEl.clientWidth) dotsEl.scrollLeft = Math.max(0, cur.offsetLeft - dotsEl.offsetLeft - dotsEl.clientWidth / 2 + cur.offsetWidth / 2);
    };

    /* ---------------- 选项 / 作答区（判分后进入只读、按对错着色） ---------------- */
    const letterSet = (s) => new Set((String(s || '').toUpperCase().match(/[A-G]/g) || []));
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
            if (right.has(L)) { cls += ' r8-right'; mark = r8Ic('ok', 'r8-om ok'); }
            else if (sel) { cls += ' r8-wrong'; mark = r8Ic('no', 'r8-om no'); }
          }
          return `<button type="button" class="qz-opt ${cls}" data-i="${i}" ${ck ? 'disabled' : ''}>
            <span class="qz-l">${L}</span><span class="qz-ot">${esc(t)}</span>${mark}</button>`;
        }).join('') + '</div>';
      }
      if (q.type === 'judge') {
        const cur = st.answers[q.id] || '';
        const rightV = ck ? (/^(正确|对|√|T|TRUE|A|Y|YES|是)$/i.test(String(ck.raw || '').trim()) ? '正确' : '错误') : '';
        const cls = (v) => {
          if (!ck) return cur === v ? `on ${v === '正确' ? 'ok' : 'no'}` : '';
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
      if (q.type === 'answer') {
        // 问答 / 解答题：大一点的固定输入区。不自动判分，提交后对照参考答案
        return `<div class="qz-fills t6-fills"><label class="qz-fill t6-fill t6-fill-long"><span>解答</span>
          <textarea class="t6-input t6-long" data-ans="1" maxlength="2000" placeholder="写下你的解答（问答题不自动判分，提交后对照参考答案）" spellcheck="false" ${ck ? 'readonly' : ''}>${esc(String(st.answers[q.id] || ''))}</textarea>${!ck && t8On(q) ? t8Btn(0) : ''}</label></div>`;
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

    const bindOptionEvents = (q) => {
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
      const i = qs.indexOf(q);
      const ck = st.checked[i];
      if (ck) return ck.myRaw;
      const r = st.result && (st.result.list || []).find((x) => x.question_id === q.id);
      return r ? r.my_answer : quizAnswerText(q, st.answers[q.id]);
    };
    const aiEnsure = () => {
      if (ai.el) return;
      const el = document.createElement('div');
      el.className = 'r8-ai';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'AI 老师');
      el.innerHTML = `
        <div class="r8-ai-h">
          <b class="r8-ai-tt">${r8Ic('ai')}AI 老师</b>
          <div class="r8-ai-modes" role="tablist"><button type="button" data-m="explain" class="on">直接讲解</button><button type="button" data-m="guide">一步步引导</button></div>
          <button type="button" class="r8-ai-btn" data-act="min" title="最小化">${R8_ICON.min}</button>
          <button type="button" class="r8-ai-btn" data-act="close" title="关闭">${R8_ICON.x}</button>
        </div>
        <div class="r8-ai-q" id="r8AiQ"></div>
        <div class="r8-ai-body" id="r8AiBody"></div>
        <div class="r8-ai-f">
          <div class="r8-ai-chips"><button type="button" data-ask="再讲细一点">再讲细一点</button><button type="button" data-ask="出一道同类题考考我">出一道同类题考考我</button></div>
          <form class="r8-ai-in" autocomplete="off"><textarea rows="1" maxlength="500" placeholder="有不懂的地方，直接问 AI 老师…"></textarea><button type="submit" title="发送">${R8_ICON.send}</button></form>
        </div>`;
      document.body.appendChild(el);
      const pill = document.createElement('button');
      pill.type = 'button'; pill.className = 'r8-ai-pill'; pill.hidden = true;
      pill.innerHTML = `${r8Ic('ai')}<span>AI 老师</span><em>展开</em>`;
      document.body.appendChild(pill);
      ai.el = el; ai.pill = pill;
      el.querySelector('[data-act="min"]').onclick = () => { ai.min = true; el.classList.add('r8-hide'); pill.hidden = false; mask.classList.remove('r8-ai-on'); };
      el.querySelector('[data-act="close"]').onclick = () => aiClose();
      pill.onclick = () => { ai.min = false; el.classList.remove('r8-hide'); pill.hidden = true; mask.classList.add('r8-ai-on'); aiPaint(true); };
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
          body: JSON.stringify({ question_id: qid, my_answer: myAnswerOf(q), mode, history, ask: text }),
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
      ai.open = false; ai.min = false;
      ai.el.classList.remove('show'); ai.pill.hidden = true;
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
        <div class="r8-fb-tag">${ck.ungraded ? `${r8Ic('steps')}已提交，请对照参考答案（问答题不计分）` : ck.ok ? `${r8Ic('ok')}答对了` : `${r8Ic('no')}答错了`}</div>
        <div class="qz-jb-r"><span>你的答案</span><em class="${ck.ungraded ? '' : ck.ok ? 'ok' : 'no'}">${esc(ck.my || '未作答')}</em></div>
        ${ck.ok && !ck.ungraded ? '' : `<div class="qz-jb-r"><span>${ck.ungraded ? '参考答案' : '正确答案'}</span><em class="ok">${esc(ck.answer)}</em></div>`}
        ${ck.analysis ? `<div class="qz-jb-ana"><span>解析</span><div class="r8-ana-t">${esc(ck.analysis)}</div></div>` : ''}
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
          <div class="qz-qhead"><span class="qz-qno">第 ${st.idx + 1} / ${total} 题</span>
            <span class="qz-qtype">${QT_NAME[q.type] || (q.type === 'answer' ? '问答题' : '')}</span>
            ${q.type === 'multi' ? '<span class="qz-qtip">可多选</span>' : ''}
            ${q.point ? `<span class="r8-qpoint">${esc(q.point)}</span>` : ''}
            <span class="qz-raqno" title="题目编号">#${String(q.id).padStart(5, '0')}</span></div>
          ${quizAudioHTML(q)}
          ${q.material ? `<div class="qz-material"><div class="qz-mat-t">原文材料</div><pre class="qz-mat-b">${esc(q.material)}</pre></div>` : ''}
          <div class="qz-stem"><b>${si.stem}</b></div>
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
      bindQuizAudio(bodyEl);
      t8Bind(bodyEl);
      if (window.mtxTypeset) mtxTypeset(bodyEl);   // 题干 / 选项 / 解析里的 LaTeX 排版
      bodyEl.querySelectorAll('.qz-material').forEach((m) => { m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded'); });
      bodyEl.querySelectorAll('[data-fb]').forEach((b) => b.onclick = () => openFeedback(q, { my_answer: ck ? ck.myRaw : quizAnswerText(q, st.answers[q.id]) }));
      // 判分后：题卡右下角、「下一题」上方出现「AI 老师」（答错时高亮）
      fab.hidden = !ck;
      fab.classList.toggle('hot', !!ck && !ck.ok && !ck.ungraded);
      fab.onclick = () => aiOpenFor(q, true);
      const allDone = qs.every((_, i) => st.checked[i]);
      const nextUnchecked = () => { for (let k = 1; k <= total; k++) { const j = (st.idx + k) % total; if (!st.checked[j]) return j; } return -1; };
      if (ck) {
        const nx = nextUnchecked();
        footEl.innerHTML = allDone
          ? `<button type="button" class="btn primary" id="qzFinishCheck"><i class="ai ai-check"></i> 查看报告</button>`
          : `<button type="button" class="btn primary" id="qzGoNext">下一题 ›</button>`;
        const go = $(allDone ? '#qzFinishCheck' : '#qzGoNext');
        go.onclick = async () => { if (allDone) { await doSubmit(); return; } st.idx = nx; paint(); };
      } else {
        footEl.innerHTML = `
          ${st.idx > 0 ? '<button type="button" class="btn ghost" id="qzPrev">上一题</button>' : ''}
          <button type="button" class="btn primary" id="qzCheckOne"><i class="ai ai-check"></i> 提交本题</button>`;
        const prevBtn = $('#qzPrev');
        if (prevBtn) prevBtn.onclick = () => { if (st.idx > 0) { st.idx--; paint(); } };
        $('#qzCheckOne').onclick = checkOne;
      }
      renderDots();
      aiFollow(q);
    };

    /* ---------------- 做完后的报告：得分环 / 用时 / 题号红绿方块 / 各知识点掌握 / 薄弱知识点 / 错题已进错题本 ---------------- */
    const resultOne = (q, r, no) => {
      const okk = r && r.is_correct;
      const mine = quizAnswerDisplay(q, r ? r.my_answer : quizAnswerText(q, st.answers[q.id]), q.options);
      const right = quizAnswerDisplay(q, r ? r.answer : '', q.options);
      const si = stemImagesHTML(q);
      const ung = !!(r && r.ungraded);
      return `<div class="qz-rq ${ung ? 'ung' : okk ? 'ok' : 'no'}" data-qid="${q.id}">
        <div class="qz-rq-h"><span class="r8-rno ${ung ? 'd' : okk ? 'ok' : 'no'}">${no}</span><span class="qz-rstate">${ung ? '对照参考答案（不计分）' : okk ? '答对了' : '答错了'}</span>
          <span class="qz-rtag">${QT_NAME[q.type] || '题目'}</span>${q.point ? `<span class="qz-rpoint">${esc(q.point)}</span>` : ''}
          <span class="qz-raqno">#${String(q.id).padStart(5, '0')}</span></div>
        ${quizAudioHTML(q)}
        ${q.material ? `<div class="qz-material folded"><div class="qz-mat-t">查看原文</div><pre class="qz-mat-b">${esc(q.material)}</pre></div>` : ''}
        <div class="qz-stem"><b>${si.stem}</b></div>
        ${si.rest}
        <div class="qz-rrow my"><span>我的答案</span><em class="${okk ? 'ok' : ung ? '' : 'no'}">${esc(mine || '未作答')}</em></div>
        ${okk ? '' : `<div class="qz-rrow"><span>${ung ? '参考答案' : '正确答案'}</span><em class="ok">${esc(right)}</em></div>`}
        ${r && r.analysis ? `<div class="qz-ana"><span>解析</span><div>${esc(r.analysis)}</div></div>` : ''}
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
      const pct = graded.length ? Math.round(r.correct / graded.length * 100) : 0;
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
      const scoreTxt = opt.scoreTotal || r.score_total ? `${r.score != null ? r.score : Math.round(r.correct / Math.max(1, r.total) * opt.scoreTotal)} / ${r.score_total || opt.scoreTotal}` : '';
      const ms = r.mastery || {};
      const mrow = (label, a) => (a && a.total ? `<div class="r8-rep-acc"><span>${esc(label)}</span><b>${a.rate === null || a.rate === undefined ? '未做' : a.rate + '%'}</b><em>已做 ${a.answered} / ${a.total} 题</em></div>` : '');
      const ungN = list.filter((x) => x.ungraded).length;
      return `
        <div class="r8-rep">
          <div class="r8-rep-top">
            <div class="r8-ring ${pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low'}" style="--p:${pct}"><div><b>${pct}<small>%</small></b><span>正确率</span></div></div>
            <div class="r8-rep-stats">
              <div><span>答对</span><b class="ok">${r.correct}</b></div>
              <div><span>答错</span><b class="no">${r.wrong}</b></div>
              <div><span>用时</span><b>${r8Dur(secs)}</b></div>
              ${scoreTxt ? `<div><span>得分</span><b>${scoreTxt}</b></div>` : ''}
            </div>
            <div class="r8-rep-msg">${r.wrong ? `${r8Ic('book')}<span>答错的 ${r.wrong} 道题已自动收进<b>错题本</b>，可以在错题本里重做和复习</span>` : `${r8Ic('ok')}<span>全部答对，太棒了，继续保持！</span>`}</div>
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
          ${ungN ? `<div class="r8-rep-sec"><div class="r8-rep-empty">另有 ${ungN} 道问答题不自动判分，请对照下面的参考答案自己批改</div></div>` : ''}
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
      $('#qzFinish').onclick = () => { destroy(); if (opt.onDone) opt.onDone(st.result); };
      const w = $('#qzWatch'); if (w) w.onclick = () => { destroy(); if (opt.onDone) opt.onDone(st.result); opt.onWatch(); };
      $('#qzRedo').onclick = () => {
        aiClose(); ai.convs = {};
        st.answers = {}; st.idx = 0; st.phase = 'answer'; st.result = null; st.startedAt = Date.now(); st.endedAt = 0; st.checked = {};
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
      bindImageZoom(bodyEl); bindQuizAudio(bodyEl);
      if (window.mtxTypeset) mtxTypeset(bodyEl);
    };

    /* ---- 提交本题 → 立即核对（不落库），显示对错 / 答案 / 解析，出现 AI 老师 ---- */
    const checkOne = async () => {
      if (st.busy) return;
      const q = qs[st.idx];
      const my = quizAnswerText(q, st.answers[q.id]);
      if (my === '') { toast('先作答，再提交'); return; }
      st.busy = true;
      const btn = $('#qzCheckOne'); if (btn) btn.disabled = true;
      try {
        const r = await api('/api/stu/bank/check', { method: 'POST', body: { items: [{ question_id: q.id, my_answer: my }] } });
        const x = (r.list || [])[0] || {};
        st.checked[st.idx] = { ok: !!x.is_correct, ungraded: !!x.ungraded, raw: x.answer || '', answer: quizAnswerDisplay(q, x.answer, q.options), analysis: x.analysis || '', my: quizAnswerDisplay(q, my, q.options), myRaw: my, blanks: x.blanks || null };
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '核对失败，请重试', 'err'); if (btn) btn.disabled = false; }
      st.busy = false;
    };

    const doSubmit = async () => {
      if (st.busy) return;
      if (!isStep && !(await elConfirm({ title: '交卷确认', message: '全部题目已核对，确定交卷吗？交卷后记录成绩，错题进错题本。', okText: '交卷' }))) return;
      st.busy = true;
      const answers = qs.map((q) => ({ question_id: q.id, my_answer: quizAnswerText(q, st.answers[q.id]) }));
      const duration = Math.round((Date.now() - st.startedAt) / 1000);
      try {
        const r = await opt.submit(answers, duration);
        st.endedAt = Date.now(); stopTimer(); paintTimer();
        st.result = r; st.phase = 'result';
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '交卷失败，请重试', 'err'); }
      st.busy = false;
    };

    paint();
    return { close: destroy };
  },
};

/* ================================================================ 学生端页面 */
const BK_SUBJECTS = ['数学', '英语', '物理', '化学'];

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

const BankPages = {
  /* 学生端「试卷」页：我的任务（老师下发）/ 章节组卷 / 知识点组卷（自己组卷，只在本人名下做题，不能下发给别人）/ 试卷库 */
  async papers(host) {
    host.innerHTML = '<div class="loading-page">加载中…</div>';
    let tasks = [], lib = [], flt = { subjects: [], grades: [], years: [] };
    const find = { q: '', grade: '', year: '' };   // 试卷库搜索条件（T10）
    try {
      const r = await Promise.all([api('/api/stu/bank/tasks'), api('/api/stu/bank/mfpapers'), api('/api/stu/bank/mfpapers/filters').catch(() => flt)]);
      tasks = r[0] || []; lib = r[1] || []; flt = r[2] || flt;
    } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`; return; }
    let subject = '';
    const searchLib = async () => {
      const qs = new URLSearchParams();
      if (find.q) qs.set('q', find.q);
      if (find.grade) qs.set('grade', find.grade);
      if (find.year) qs.set('year', find.year);
      try { lib = await api('/api/stu/bank/mfpapers' + (qs.toString() ? '?' + qs.toString() : '')) || []; }
      catch (e) { toast(e.message || '搜索失败', 'err'); return; }
      paint();
    };

    const taskRow = (p) => `
      <div class="pk-task" data-task="${p.id}">
        <div class="pk-t-main"><b>${esc(p.title)}</b>
          <span class="hint">${p.q_count} 题 · 满分 ${p.total_score}${p.assigned ? '' : ' · 全员卷'}</span></div>
        ${p.tried && p.last ? `<span class="tag ok">${p.last.score} 分</span>` : '<span class="tag gray">未完成</span>'}
        <button class="btn primary sm">${p.tried ? '重做' : '开始'}</button>
      </div>`;

    const paint = () => {
      const ft = subject ? tasks.filter((p) => p.subject === subject) : tasks;
      const fl = subject ? lib.filter((p) => p.subject === subject) : lib;
      host.innerHTML = `
        <div class="bk-tabs">${[''].concat(BK_SUBJECTS).map((s) => {
          const n = s ? tasks.filter((p) => p.subject === s).length + lib.filter((p) => p.subject === s).length : tasks.length + lib.length;
          return `<a class="${subject === s ? 'on' : ''}" data-s="${esc(s)}">${s || '全部'}<i>${n}</i></a>`;
        }).join('')}</div>
        <div class="pk-grid">
          <div class="pk-box">
            <div class="pk-h">${bkIcon('history', 16)} 我的任务<span class="pk-sub">老师下发的试卷</span></div>
            <div class="pk-body">${ft.length ? ft.map(taskRow).join('') : '<div class="pk-empty"><span style="font-size:26px">🧾</span>老师还没有下发试卷</div>'}</div>
          </div>
          <div class="pk-box pk-entry" id="pkScan">
            <div class="pk-h">${bkIcon('points', 16)} 章节组卷<span class="pk-sub">按章节单元组卷</span></div>
            <div class="pk-entry-b">
              <p>选择教材单元，系统像雷达一样扫描每个小知识点，各出 1 道题，做完出做题报告。</p>
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
        <div class="pk-lib">
          <div class="pk-h">${bkIcon('math', 16)} 试卷库<span class="pk-sub">${fl.length} 份试卷</span></div>
          <div class="t10-search">
            <input id="pkQ" class="t10-q" placeholder="搜索试卷名称 / 年份，如 2024 中考" value="${esc(find.q)}" maxlength="60">
            <select id="pkGrade"><option value="">全部年级</option>${(flt.grades || []).map((g) => `<option ${find.grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
            <select id="pkYear"><option value="">全部年份</option>${(flt.years || []).map((y) => `<option value="${esc(y)}" ${find.year === y ? 'selected' : ''}>${esc(y)} 年</option>`).join('')}</select>
            <button class="btn primary sm" id="pkSearch">搜索</button>
            ${find.q || find.grade || find.year ? '<button class="btn ghost sm" id="pkClear">清除</button>' : ''}
          </div>
          ${fl.length ? `<div class="pk-lib-grid">${fl.map((p) => `
            <div class="pk-libcard" data-lib="${p.id}">
              <b>${esc(p.title)}</b>
              <span class="hint">${esc(p.subject || '通用')}${p.grade ? ' · ' + esc(p.grade) : ''}${p.year ? ' · ' + esc(p.year) + ' 年' : ''} · ${p.q_count} 题</span>
              <div class="pk-lib-acts">${p.tried && p.last ? `<span class="tag ok">上次 ${p.last.score} 分</span>` : '<span class="tag gray">未做过</span>'}
                <button class="btn primary sm">${p.tried ? '重新做' : '开始作答'}</button></div>
            </div>`).join('')}</div>` : `<div class="pk-empty"><span style="font-size:26px">📚</span>${find.q || find.grade || find.year ? '没有找到符合条件的试卷，换个关键字试试' : '试卷库暂无试卷，老师发布后出现在这里'}</div>`}
        </div>`;
      host.querySelectorAll('.bk-tabs a').forEach((a) => a.onclick = () => { subject = a.dataset.s; paint(); });
      const doSearch = () => { find.q = host.querySelector('#pkQ').value.trim(); find.grade = host.querySelector('#pkGrade').value; find.year = host.querySelector('#pkYear').value; searchLib(); };
      host.querySelector('#pkSearch').onclick = doSearch;
      host.querySelector('#pkQ').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
      host.querySelector('#pkGrade').onchange = doSearch; host.querySelector('#pkYear').onchange = doSearch;
      const clr = host.querySelector('#pkClear'); if (clr) clr.onclick = () => { find.q = find.grade = find.year = ''; searchLib(); };
      host.querySelectorAll('[data-task]').forEach((el) => el.onclick = () => BankPages.openPaper(Number(el.dataset.task)));
      host.querySelectorAll('[data-lib]').forEach((el) => el.onclick = () => BankPages.openLibPaper(Number(el.dataset.lib)));
      const scanBtn = host.querySelector('#pkScan .btn');
      if (scanBtn) scanBtn.onclick = () => BankPages.scanFlow('textbook', subject, host);
      const spBtn = host.querySelector('#pkSprint .btn');
      if (spBtn) spBtn.onclick = () => BankPages.scanFlow('knowledge', subject, host);
    };
    paint();
  },

  /** 章节组卷 / 知识点组卷：选范围 → 雷达扫描 → 每个小知识点 1 题 → 做题报告 / 学情报告 */
  async scanFlow(kind, subject, host) {
    if (!subject) { toast('先在上方选择一个学科', 'err'); return; }
    let t;
    try { t = await api(`/api/stu/bank/scan-tree?kind=${kind}&subject=${encodeURIComponent(subject)}`); }
    catch (e) { toast(e.message || '加载失败', 'err'); return; }
    const nodes = t.nodes || [];
    if (!nodes.length) { toast(kind === 'knowledge' ? '该学科还没有知识点分类' : '该学科还没有章节分类', 'err'); return; }
    const byParent = {};
    nodes.forEach((n) => { (byParent[n.parent_id || 0] = byParent[n.parent_id || 0] || []).push(n); });
    const kidsOf = (id) => byParent[id] || [];
    const leavesOf = (id) => { const k = kidsOf(id); return k.length ? k.reduce((s, c) => s + leavesOf(c.id), 0) : 1; };
    const nameOf = (id) => (nodes.find((n) => n.id === id) || {}).name || '';

    const nodeRow = (n, depth) => {
      const kids = kidsOf(n.id);
      return `<div class="pk-node d${depth}">
        <label class="pk-nd"><input type="checkbox" class="pk-ck" data-nd="${n.id}"> ${esc(n.name)}</label>
        ${kids.length ? `<div class="pk-kids ${depth >= 2 ? 'fold' : ''}">${kids.map((k) => nodeRow(k, depth + 1)).join('')}</div>` : ''}
      </div>`;
    };
    const roots = byParent[0] || nodes.filter((n) => !byParent[n.parent_id] && n.parent_id !== 0 && !nodes.some((x) => x.id === n.parent_id));
    const mask = document.createElement('div');
    mask.className = 'mask pk-sel-mask';
    mask.innerHTML = `
      <div class="pk-sel-box">
        <div class="pk-sel-h"><b>${kind === 'knowledge' ? '知识点组卷' : '章节组卷'} · ${esc(subject)}</b><button class="close-x" id="pkSelX">&times;</button></div>
        <div class="pk-sel-tip">勾选${kind === 'knowledge' ? '知识点' : '单元'}（勾大项 = 包含里面所有小项），每个小知识点只出 1 道题</div>
        <div class="pk-tree" id="pkTree">${roots.map((n) => nodeRow(n, 0)).join('')}</div>
        <div class="pk-sel-f">
          <span class="hint">已选 <b id="pkSelN">0</b> 个小知识点 · 约 <b id="pkSelQ">0</b> 题</span>
          <span><button class="btn ghost" id="pkSelCancel">取消</button>
          <button class="btn primary" id="pkSelGo">开始扫描</button></span>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#pkSelX').onclick = () => mask.remove();
    mask.querySelector('#pkSelCancel').onclick = () => mask.remove();

    // 勾选联动：勾父级 = 勾全部子孙；展开 / 收起
    const setDesc = (id, v) => kidsOf(id).forEach((c) => {
      const cb = mask.querySelector(`.pk-ck[data-nd="${c.id}"]`);
      if (cb) cb.checked = v;
      setDesc(c.id, v);
    });
    mask.addEventListener('change', (e) => {
      const cb = e.target.closest('.pk-ck');
      if (cb) setDesc(Number(cb.dataset.nd), cb.checked);
      // 统计：勾选集合的后代闭包里的叶子数（去重）
      const checked = [...mask.querySelectorAll('.pk-ck:checked')].map((c) => Number(c.dataset.nd));
      const sel = new Set(checked);
      let frontier = checked.slice();
      while (frontier.length) {
        const next = [];
        frontier.forEach((pid) => kidsOf(pid).forEach((c) => { if (!sel.has(c.id)) { sel.add(c.id); next.push(c.id); } }));
        frontier = next;
      }
      let leafN = 0;
      sel.forEach((id) => { if (!kidsOf(id).some((c) => sel.has(c.id))) leafN++; });
      mask.querySelector('#pkSelN').textContent = leafN;
      mask.querySelector('#pkSelQ').textContent = leafN;
    });
    mask.addEventListener('click', (e) => {
      const nd = e.target.closest('.pk-nd');
      if (nd && !e.target.closest('.pk-ck')) {
        const kids = nd.parentElement.querySelector(':scope > .pk-kids');
        if (kids) kids.classList.toggle('fold');
      }
    });

    mask.querySelector('#pkSelGo').onclick = async () => {
      const ids = [...mask.querySelectorAll('.pk-ck:checked')].map((c) => Number(c.dataset.nd));
      if (!ids.length) { toast('先勾选要测评的范围', 'err'); return; }
      let d;
      try {
        d = await api('/api/stu/bank/scan-compose', { method: 'POST', body: { kind, node_ids: ids, subject } });
      } catch (e) { toast(e.message || '组卷失败', 'err'); return; }
      mask.remove();
      BankPages.showRadar(kind, subject, d.items || [], host);
    };
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
    items.forEach((it, i) => {
      setTimeout(() => {
        chips.insertAdjacentHTML('beforeend', `<span class="pk-chip pop">${esc(it.node_name)}<b>${it.count} 题</b></span>`);
        chips.parentElement.scrollTop = chips.parentElement.scrollHeight;
        if (i === items.length - 1) {
          const radar = mask.querySelector('#pkRadar');
          if (radar) radar.classList.add('done');
          mask.querySelector('#pkRTip').textContent = `扫描完成：共发现 ${items.length} 个知识点`;
          const go = mask.querySelector('#pkRGo');
          go.style.display = '';
          go.textContent = `开始做题（${items.length} 题）`;
          go.onclick = () => {
            mask.remove();
            BankQuiz.open({
              mode: 'step',
              title,
              subtitle: `${subject} · 每个知识点 1 题 · 做一题核对一题`,
              questions: items.map((x) => x.question),
              submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'self', answers, duration } }),
              onDone: () => { BankPages.papers(host); },
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
    BankQuiz.open({
      title: p.title,
      subtitle: [p.subject, p.year ? p.year + ' 年' : '', p.questions.length + ' 题'].filter(Boolean).join(' · '),
      questions: p.questions,
      scoreTotal: p.total_score || 0,
      submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'mfpaper', paper_id: p.id, answers, duration } }),
      onDone: () => { if (window.__stuVm) window.__stuVm.courses = null; },
    });
  },

  async openPaper(id) {
    let p;
    try { p = await api('/api/stu/bank/papers/' + id); }
    catch (e) { toast(e.message || '试卷加载失败', 'err'); return; }
    if (!p.questions || !p.questions.length) { toast('这份试卷还没有题目'); return; }
    BankQuiz.open({
      title: p.title,
      subtitle: [p.subject, p.duration + ' 分钟', '满分 ' + p.total_score].filter(Boolean).join(' · '),
      questions: p.questions,
      scoreTotal: p.total_score,
      submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'paper', paper_id: p.id, answers, duration } }),
      onDone: () => { if (window.__stuVm) window.__stuVm.courses = null; },
    });
  },

  /** 错题本：首页（横幅 + 四大学科卡片）→ 学科内页（时间强化 + 薄弱知识点 + 历史错题 + 上传的错题） */
  async mistakes(host) {
    host.innerHTML = '<div class="loading-page">加载中…</div>';
    let data;
    try { data = await api('/api/stu/bank/mistakes'); }
    catch (e) { host.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`; return; }

    const SUBJ_META = { '数学': { icon: 'math', cls: 'smath' }, '英语': { icon: 'eng', cls: 'seng' }, '物理': { icon: 'phy', cls: 'sphy' }, '化学': { icon: 'chem', cls: 'schem' } };
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const ageDays = (m) => {
      const t = new Date(String(m.updated_at || '').slice(0, 10).replace(/-/g, '/') + 'T00:00:00');
      return isNaN(t) ? 0 : Math.max(0, Math.round((dayStart - t) / 86400000));
    };
    const bucketOf = (m) => { const d = ageDays(m); return d <= 2 ? 'd2' : d <= 7 ? 'd7' : 'd180'; };
    const inBucket = (m, b) => !m.resolved && (m.subject || '其他') === subject && bucketOf(m) === b;

    /** 把一组错题串成一次重做弹层（答对移出，答错回炉） */
    const quizMistakes = (list, title, subtitle) => {
      if (!list.length) { toast('这里暂时没有错题'); return; }
      BankQuiz.open({
        title, subtitle: subtitle || '答对的题自动移出错题本',
        questions: list.map((m) => ({
          id: m.question_id, type: m.type, subject: m.subject || '', stem: m.stem, material: m.material || '', options: m.options || [], images: m.images || [], point: m.point || '', audio_url: m.audio_url || '',
          blanks: m.type === 'fill' ? String(m.answer || '').replace(/\|\|\|/g, '\u0001').split('|').length : 0,
        })),
        submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'redo', answers, duration } }),
        onDone: () => BankPages.mistakes(host),
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
          ${m.resolved ? '<span class="tag ok">已掌握</span>' : `<span class="bm-dots" title="复习连续答对 ${stage}/3 次">${'●'.repeat(stage)}${'○'.repeat(3 - stage)}</span>`}
          <span class="bm-time">${esc(String(m.updated_at || '').slice(0, 16))}</span>
        </div>
        ${m.material ? `<div class="qz-material folded"><div class="qz-mat-t">查看原文</div><pre class="qz-mat-b">${esc(m.material)}</pre></div>` : ''}
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
          <button class="btn ghost sm" data-resolve="${m.question_id}">${m.resolved ? '恢复到错题本' : '我会了，移出错题本'}</button>
        </div>
      </div>`;
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
      let r;
      try { r = await api('/api/stu/bank/upload-token', { method: 'POST' }); }
      catch (e) { toast(e.message || '获取二维码失败，请重试', 'err'); return; }
      const url = location.origin + '/upload.html?t=' + r.token + '&subject=' + encodeURIComponent(subject);
      const m = document.createElement('div');
      m.className = 'mask';
      m.innerHTML = `<div class="qr-box">
        <button class="close-x" id="qrClose" title="关闭">&times;</button>
        <b class="qr-t">📱 手机扫码上传错题</b>
        <div id="qrCanvas"></div>
        <p class="qr-tip">用手机扫一扫 → 拍一张纸质错题的照片<br>AI 会自动识别学科、知识点和题型，题目马上进入你的错题本，老师审核后确认</p>
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
      let r;
      try { r = await api('/api/stu/bank/review-queue'); }
      catch (e) { toast(e.message || '加载失败', 'err'); return; }
      if (!r.list || !r.list.length) { toast('今天没有到期的复习题，明天再来吧', 'ok'); return; }
      BankQuiz.open({
        title: '错题复习',
        subtitle: `共 ${r.list.length} 题 · 连续答对 3 次自动掌握`,
        questions: r.list,
        submit: (answers, duration) => api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'review', answers, duration } }),
        onDone: () => BankPages.mistakes(host),
      });
    };

    // 顶部学科 tab（按红框顺序）：进入错题本直接显示第一个学科的内容页
    const MIST_ORDER = ['英语', '数学', '物理', '化学'];
    let subject = MIST_ORDER[0], sub = '';   // sub: '' | points | history | uploads
    const paint = () => (sub ? paintSub() : paintSubject());

    // ---- 顶部学科 tabs（渲染到顶栏白框的挂载点 #bkTabsMount，含错题数角标） ----
    const tabsHTML = () => `
      <div class="bk2-tabs">${MIST_ORDER.map((s) => `
        <a class="${subject === s ? 'on ' + SUBJ_META[s].cls : ''}" data-s="${s}">
          <span class="bmt-ic">${bkIcon(SUBJ_META[s].icon, 15)}</span>${s}<b>${data.counts[s] || 0}</b>
        </a>`).join('')}</div>`;
    const bindTabs = () => {
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
      const RANGES = [
        ['unresolved', '全部未掌握的错题', {}],
        ['d2', '2天内的错题', { from: daysAgo(2) }],
        ['d7', '3-7天内的错题', { from: daysAgo(7), to: daysAgo(3) }],
        ['d180', '7-180天内的错题', { from: daysAgo(180), to: daysAgo(8) }],
        ['resolved', '已掌握的错题', { bucket: 'resolved' }],
        ['all', '全部错题（含已掌握）', { bucket: 'all' }],
      ];
      const m = document.createElement('div');
      m.className = 'mask';
      m.innerHTML = `<div class="t9-dlg">
        <button class="close-x" id="t9xClose" title="关闭">&times;</button>
        <b class="t9-dlg-t">📄 导出${esc(subject)}错题 Word</b>
        <p class="t9-dlg-s">生成可编辑的 .docx（Word / WPS 都能打开）：先是「错题练习」，后面是「错题解析」（答案、解析、答题记录），带页码，可以直接打印。</p>
        <div class="t9-dlg-r">${RANGES.map(([k, t], i) => `<label class="t9-radio"><input type="radio" name="t9r" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <div class="t9-dlg-f"><button class="btn ghost" id="t9xCancel">取消</button><button class="btn primary" id="t9xGo">下载 Word</button></div>
      </div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      m.querySelector('#t9xClose').onclick = close; m.querySelector('#t9xCancel').onclick = close;
      m.addEventListener('click', (e) => { if (e.target === m) close(); });
      m.querySelector('#t9xGo').onclick = async () => {
        const key = (m.querySelector('input[name=t9r]:checked') || {}).value || 'unresolved';
        const range = RANGES.find((r) => r[0] === key)[2];
        const qs = new URLSearchParams(Object.assign({ subject }, range));
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
        } catch (e) { toast(e.message || '导出失败', 'err'); btn.disabled = false; btn.textContent = '下载 Word'; }
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
            <button class="t9-bucket c-blue" id="bkD180" ${d180 ? '' : 'disabled'}><em>${d180}</em><span>7-180天内错题</span><i>${d180 ? '去强化 ›' : '暂无'}</i></button>
          </div>
          <div class="t9-sec">更多</div>
          <div class="t9-funcs">
            <button class="t9-func" id="bkPts">
              <span class="t9-func-ic i-purple">${bkIcon('points', 22)}</span>
              <span class="t9-func-m"><b>薄弱知识点<em class="t9-ai">AI</em></b><span>AI 识别错题考点，同类归在一起强化</span></span><i>›</i>
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
      host.querySelector('#bkUps').onclick = () => { sub = 'uploads'; paint(); };
      host.querySelector('#bkUpBtn').onclick = showQR;
      host.querySelector('#bkDocx').onclick = exportWord;
    };

    // ---- 学科子页：薄弱知识点（AI 归类）/ 历史错题 / 上传的错题 ----
    const paintSub = () => {
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
        api(`/api/stu/bank/mistake-points?subject=${encodeURIComponent(subject)}`).then((r) => {
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
          host.innerHTML = head('薄弱知识点') + `<div class="empty">${esc(e.message || '加载失败')}</div>`;
          bindTabs();
          const back = host.querySelector('#bkBack');
          if (back) back.onclick = () => { sub = ''; paint(); };
        });
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
      api('/api/stu/bank/uploads').then((r) => {
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
              : '<div class="bu-wait">✓ 已自动进入你的错题本，老师审核中（如题目不合适会被移出）</div>'}
          </div>`).join('')}</div>` : '<div class="empty">还没有上传过错题，点上方「手机扫码上传」试试</div>');
        bindImageZoom(host);
        bindTabs();
        host.querySelector('#bkBack').onclick = () => { sub = ''; paint(); };
      }).catch((e) => { host.innerHTML = head('上传的错题') + `<div class="empty">${esc(e.message || '加载失败')}</div>`; });
    };

    paint();
  },
};

window.BankQuiz = BankQuiz;
window.quizAccText = quizAccText;
window.BankPages = BankPages;
