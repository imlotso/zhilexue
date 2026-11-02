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

/** 选项文本归一化：兼容 {label,text} 对象（后台批量导入）与字符串两种格式 */
function optText(t) {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return String(t.text || t.content || '');
  return String(t || '');
}

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
  return `<div class="qz-imgs">${imgs.map((s) => `<img class="qz-img" src="${esc(s)}" alt="题目图片" loading="lazy">`).join('')}</div>`;
}

/** 题干渲染：转义 + [图N] 占位替换为内联图片 + 换行转 <br>；返回 { stem, rest }（rest=未被占位引用的图） */
function stemImagesHTML(q) {
  const imgs = (q && Array.isArray(q.images)) ? q.images : [];
  const used = new Set();
  const stem = esc(String((q && q.stem) || '')).replace(/\[图(\d+)\]/g, (m, n) => {
    const src = imgs[Number(n) - 1];
    if (!src) return m;
    used.add(Number(n) - 1);
    return `<img class="qz-img qz-img-inline" src="${esc(src)}" alt="图${n}" loading="lazy">`;
  }).replace(/\n/g, '<br>');
  const rest = imgs.map((s, i) => (used.has(i) ? '' : `<img class="qz-img" src="${esc(s)}" alt="题目图片" loading="lazy">`)).join('');
  return { stem, rest: rest ? `<div class="qz-imgs">${rest}</div>` : '' };
}
function bindImageZoom(root) {
  (root || document).querySelectorAll('.qz-img').forEach((im) => {
    im.onclick = () => {
      const m = document.createElement('div');
      m.className = 'mask imgzoom-mask';
      m.innerHTML = `<div class="imgzoom-box"><img src="${esc(im.src)}" alt="查看图片"><p>点空白处关闭</p></div>`;
      m.onclick = (e) => { if (e.target === m) m.remove(); };
      document.body.appendChild(m);
    };
  });
}

const BankQuiz = {
  /** 打开全屏做题弹层
   *  opt: { title, subtitle, questions, submit(answers, duration) -> Promise<result> , scoreTotal, onDone } */
  open(opt) {
    // 互斥：已有一个做题弹层时不再叠加（快速双击「开始作答」会开两层）
    if (document.querySelector('.quiz-mask')) { toast('请先完成当前的题目'); return; }
    const qs = (opt.questions || []).slice();
    if (!qs.length) { toast('这里还没有题目'); return; }
    const mask = document.createElement('div');
    mask.className = 'mask quiz-mask';
    document.body.appendChild(mask);

    const st = {
      idx: 0,
      answers: {},          // qid -> 作答（单选 letter / multi 数组 / judge 文本 / fill 数组 / sort 数组）
      phase: 'answer',      // answer | result
      result: null,
      startedAt: Date.now(),
      busy: false,
      checked: {},          // step 模式：idx -> { ok, answer, analysis, my }（做一题核对一题）
      fontSize: 'md',       // step 模式：sm | md | lg 字体大小
    };
    const isStep = opt.mode === 'step';
    const total = qs.length;

    // 顶部计时器（step 模式显示用时）
    let timerId = null;
    const paintTimer = () => {
      const el = mask.querySelector('#qzTimer');
      if (!el) return;
      const s = Math.floor((Date.now() - st.startedAt) / 1000);
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')} : ${String(s % 60).padStart(2, '0')}`;
    };
    if (isStep) timerId = setInterval(paintTimer, 1000);
    const stopTimer = () => { if (timerId) { clearInterval(timerId); timerId = null; } };

    const html = `
      <div class="quiz-box ${isStep ? 'quiz-step' : ''}">
        <div class="quiz-h">
          <div class="quiz-h-t"><b>${esc(opt.title || '在线做题')}</b>${opt.subtitle ? `<span>${esc(opt.subtitle)}</span>` : ''}</div>
          <div class="quiz-h-r">
            <span class="quiz-prog" id="qzProg"></span>
            ${isStep ? `<span class="qz-timer" id="qzTimer">00 : 00</span>
            <span class="qz-fs" id="qzFs"><button data-fs="sm">小</button><button class="on" data-fs="md">中</button><button data-fs="lg">大</button></span>` : ''}
            <button class="close-x" id="qzClose" title="退出">&times;</button>
          </div>
        </div>
        <div class="quiz-bar"><i id="qzBarFill"></i></div>
        <div class="quiz-dots" id="qzDots"></div>
        <div class="quiz-body" id="qzBody"></div>
        <div class="qz-kpad" id="qzKpad" style="display:none"></div>
        <div class="quiz-f" id="qzFoot"></div>
      </div>`;
    mask.innerHTML = html;
    if (isStep) {
      mask.querySelectorAll('#qzFs button').forEach((b) => b.onclick = () => {
        st.fontSize = b.dataset.fs;
        mask.querySelectorAll('#qzFs button').forEach((x) => x.classList.toggle('on', x === b));
        const box = mask.querySelector('.quiz-box');
        box.classList.remove('fs-sm', 'fs-md', 'fs-lg');
        box.classList.add('fs-' + st.fontSize);
      });
    }

    const $ = (sel) => mask.querySelector(sel);
    const bodyEl = $('#qzBody'), footEl = $('#qzFoot'), dotsEl = $('#qzDots');

    const close = () => {
      if (st.phase === 'answer' && Object.keys(st.answers).length) {
        elConfirm({ title: '退出做题', message: isStep ? '还没完成，退出后本次作答不会保存。确定退出？' : '还没交卷，退出后本次作答不会保存。确定退出？', okText: '退出' })
          .then((v) => { if (v) { stopTimer(); mask.remove(); } });
      } else { stopTimer(); mask.remove(); }
    };
    $('#qzClose').onclick = close;

    const renderDots = () => {
      dotsEl.innerHTML = qs.map((q, i) => {
        const answered = quizAnswerText(q, st.answers[q.id]) !== '';
        const checked = !!st.checked[i];
        const locked = isStep && i > st.idx && !checked;   // step 模式：没做到的题锁定
        const stateCls = isStep ? (checked ? (st.checked[i].ok ? 'ok' : 'no') : (i === st.idx ? 'on' : '')) : (i === st.idx ? 'on' : '') + (answered ? ' done' : '');
        return `<button class="qz-dot ${stateCls}" data-i="${i}" ${locked ? 'disabled title="先完成前面的题"' : ''}>${i + 1}</button>`;
      }).join('');
      dotsEl.querySelectorAll('.qz-dot:not([disabled])').forEach((b) => b.onclick = () => { st.idx = Number(b.dataset.i); paint(); });
      const answeredN = isStep ? Object.keys(st.checked).length : qs.filter((q) => quizAnswerText(q, st.answers[q.id]) !== '').length;
      $('#qzProg').textContent = st.phase === 'result' ? '已交卷' : isStep ? `已核对 ${answeredN} / ${total}` : `${answeredN} / ${total} 已作答`;
      $('#qzBarFill').style.width = Math.round(answeredN / total * 100) + '%';
    };

    const optionHTML = (q) => {
      const opts = (q.options || []).map(optText);
      const letters = opts.map((_, i) => QT_LETTERS[i]);
      if (q.type === 'single' || q.type === 'multi') {
        const multi = q.type === 'multi';
        return `<div class="qz-opts ${multi ? 'multi' : ''}">` + opts.map((t, i) => {
          const sel = multi ? (st.answers[q.id] || []).includes(QT_LETTERS[i]) : st.answers[q.id] === QT_LETTERS[i];
          return `<button class="qz-opt ${sel ? 'on' : ''}" data-i="${i}">
            <span class="qz-l">${QT_LETTERS[i]}</span><span class="qz-ot">${esc(t)}</span></button>`;
        }).join('') + '</div>';
      }
      if (q.type === 'judge') {
        const cur = st.answers[q.id] || '';
        return `<div class="qz-judge">
          <button class="qz-jb ${cur === '正确' ? 'on ok' : ''}" data-v="正确"><i class="ai ai-check"></i> 正确</button>
          <button class="qz-jb ${cur === '错误' ? 'on no' : ''}" data-v="错误"><i class="ai ai-delete"></i> 错误</button>
        </div>`;
      }
      if (q.type === 'fill') {
        const n = Math.max(1, Number(q.blanks) || 1);
        const arr = Array.isArray(st.answers[q.id]) ? st.answers[q.id] : [];
        // T6：固定宽高的输入区（字多字少都不变形，内容多时框内滚动）；单空稍高、多空每空一行半
        return `<div class="qz-fills t6-fills ${n === 1 ? 'single' : ''}">` + Array.from({ length: n }, (_, i) => `
          <label class="qz-fill t6-fill"><span>${n === 1 ? '答案' : `第 ${i + 1} 空`}</span>
            <textarea class="t6-input" data-blank="${i}" maxlength="500" placeholder="点这里填写答案" autocomplete="off" spellcheck="false">${esc(arr[i] || '')}</textarea></label>`).join('') + '</div>';
      }
      if (q.type === 'answer') {
        // 问答 / 解答题：大一点的固定输入区。不自动判分，交卷后对照参考答案
        return `<div class="qz-fills t6-fills"><label class="qz-fill t6-fill t6-fill-long"><span>解答</span>
          <textarea class="t6-input t6-long" data-ans="1" maxlength="2000" placeholder="写下你的解答（问答题不自动判分，交卷后对照参考答案）" spellcheck="false">${esc(String(st.answers[q.id] || ''))}</textarea></label></div>`;
      }
      if (q.type === 'sort') {
        // 排序 / 连词成句：展示顺序稳定打乱，学生按顺序点选，答案存原始位置序号
        const placed = Array.isArray(st.answers[q.id]) ? st.answers[q.id].slice() : [];
        const shuffled = quizShuffle(opts, q.id);
        const used = new Set(placed);
        return `<div class="qz-sort">
          <div class="qz-sort-built" id="qzSortBuilt">${placed.length
            ? placed.map((n, k) => `<button class="qz-chip" data-undo="${k}">${esc(opts[n - 1] || ('#' + n))}</button>`).join('')
            : '<span class="qz-sort-tip">从下面按顺序点选，组成正确的顺序 →</span>'}</div>
          <div class="qz-sort-pool">${shuffled.map(({ v, i }) => {
            const n = i + 1;
            return `<button class="qz-pool-it ${used.has(n) ? 'used' : ''}" data-n="${n}" ${used.has(n) ? 'disabled' : ''}>${esc(v)}</button>`;
          }).join('')}</div>
        </div>`;
      }
      return '';
    };

    const bindOptionEvents = (q) => {
      if (q.type === 'single') {
        bodyEl.querySelectorAll('.qz-opt').forEach((b) => b.onclick = () => {
          st.answers[q.id] = QT_LETTERS[Number(b.dataset.i)];
          paint();
        });
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
        bodyEl.querySelectorAll('.qz-jb').forEach((btn) => btn.onclick = () => {
          st.answers[q.id] = st.answers[q.id] === btn.dataset.v ? '' : btn.dataset.v;
          paint();
        });
      } else if (q.type === 'fill') {
        bodyEl.querySelectorAll('[data-blank]').forEach((inp) => {
          inp.oninput = () => {
            // 填空答案是单行：回车 / 粘贴里的换行都当空格
            if (/[\r\n]/.test(inp.value)) inp.value = inp.value.replace(/[\r\n]+/g, ' ');
            const n = Math.max(1, Number(q.blanks) || 1);
            const arr = Array.from({ length: n }, (_, i) => '');
            bodyEl.querySelectorAll('[data-blank]').forEach((x) => { arr[Number(x.dataset.blank)] = x.value; });
            st.answers[q.id] = arr;
          };
          inp.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
          // 点填空处弹出数学键盘（也可直接用物理键盘输入）
          inp.onfocus = () => showKpad(inp);
        });
      } else if (q.type === 'answer') {
        bodyEl.querySelectorAll('textarea[data-ans]').forEach((ta) => { ta.oninput = () => { st.answers[q.id] = ta.value; }; ta.onfocus = () => hideKpad(); });
      } else if (q.type === 'sort') {
        bodyEl.querySelectorAll('.qz-pool-it').forEach((b) => b.onclick = () => {
          const cur = (st.answers[q.id] || []).slice();
          cur.push(Number(b.dataset.n));
          st.answers[q.id] = cur;
          paint();
        });
        bodyEl.querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => {
          const cur = (st.answers[q.id] || []).slice();
          cur.splice(Number(b.dataset.undo), 1);
          st.answers[q.id] = cur;
          paint();
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
            : abcKeys.map((k) => `<button class="kpad-k" data-k="${k}">${k}</button>`).join('') + `<button class="kpad-k kpad-mode" data-act="mode">123</button>`}</div>
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
    const showKpad = (inp) => { kpadInput = inp; kpadEl.style.display = ''; };
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

    /* ---- AI 老师：苏格拉底式分步引导讲解 ---- */
    const openAiExplain = (q, r) => {
      const m = document.createElement('div');
      m.className = 'mask qz-ai-mask';
      m.innerHTML = `<div class="qz-ai-box">
        <div class="qz-ai-h"><b>🧑‍🏫 AI 老师 · 分步引导</b><button class="close-x" id="qzAiX">&times;</button></div>
        <div class="qz-ai-body" id="qzAiBody"><div class="bk-ai-loading"><span class="bai-spin"></span><b>AI 老师正在准备引导讲解…</b><span>大约需要几秒钟</span></div></div>
        <div class="qz-ai-f" id="qzAiF"></div>
      </div>`;
      document.body.appendChild(m);
      m.querySelector('#qzAiX').onclick = () => m.remove();
      m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
      api('/api/stu/bank/ai-explain', { method: 'POST', body: { question_id: q.id, my_answer: r ? r.my_answer : quizAnswerText(q, st.answers[q.id]) } })
        .then((d) => {
          let step = 0;
          const body = m.querySelector('#qzAiBody'); const foot = m.querySelector('#qzAiF');
          const paintStep = () => {
            const s = d.steps[step];
            body.innerHTML = `
              <div class="qz-ai-stem">${stemImagesHTML(q).stem}</div>
              <div class="qz-ai-step"><span class="qz-ai-no">第 ${step + 1} / ${d.steps.length} 步</span>
                <p class="qz-ai-ask">${esc(s.ask)}</p>
                <p class="qz-ai-hint">${esc(s.hint)}</p></div>`;
            foot.innerHTML = `<button class="btn primary" id="qzAiNext">${step + 1 < d.steps.length ? '想好了，下一步 ›' : '看总结'}</button>`;
            m.querySelector('#qzAiNext').onclick = () => {
              step++;
              if (step < d.steps.length) { paintStep(); return; }
              body.innerHTML = `
                <div class="qz-ai-stem">${stemImagesHTML(q).stem}</div>
                <div class="qz-ai-step done"><span class="qz-ai-no">总结</span><p class="qz-ai-hint">${esc(d.conclusion || '继续加油！')}</p></div>`;
              foot.innerHTML = `<button class="btn primary" id="qzAiOk">我知道了</button>`;
              m.querySelector('#qzAiOk').onclick = () => m.remove();
            };
            if (window.mtxTypeset) mtxTypeset(body);
          };
          paintStep();
        })
        .catch((e) => { m.querySelector('#qzAiBody').innerHTML = `<div class="empty">${esc(e.message || 'AI 讲解暂时不可用')}</div>`; });
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

    const resultOne = (q, r) => {
      const okk = r && r.is_correct;
      const mine = quizAnswerDisplay(q, r ? r.my_answer : quizAnswerText(q, st.answers[q.id]), q.options);
      const right = quizAnswerDisplay(q, r ? r.answer : '', q.options);
      const si = stemImagesHTML(q);
      const ung = !!(r && r.ungraded);
      return `<div class="qz-rq ${ung ? 'ung' : okk ? 'ok' : 'no'}" data-qid="${q.id}">
        <div class="qz-rq-h"><span class="qz-rstate">${ung ? '✎ 对照参考答案（不计分）' : okk ? '✓ 回答正确' : '✗ 回答错误'}</span>
          <span class="qz-rtag">${QT_NAME[q.type] || '题目'}</span>${q.point ? `<span class="qz-rpoint">${esc(q.point)}</span>` : ''}
          <span class="qz-raqno">#${String(q.id).padStart(5, '0')}</span></div>
        ${q.material ? `<div class="qz-material folded"><div class="qz-mat-t">查看原文</div><pre class="qz-mat-b">${esc(q.material)}</pre></div>` : ''}
        <div class="qz-stem"><b>${si.stem}</b></div>
        ${si.rest}
        <div class="qz-rrow my"><span>我的答案</span><em class="${okk ? 'ok' : ung ? '' : 'no'}">${esc(mine || '未作答')}</em></div>
        ${okk ? '' : `<div class="qz-rrow"><span>${ung ? '参考答案' : '正确答案'}</span><em class="ok">${esc(right)}</em></div>`}
        ${r && r.analysis ? `<div class="qz-ana"><span>解析</span>${esc(r.analysis)}</div>` : ''}
        ${okk || ung ? '' : `<div class="qz-racts">
          <button class="btn ghost sm" data-ai="${q.id}">🧑‍🏫 AI 老师分步讲解</button>
          <button class="btn ghost sm" data-fb="${q.id}">对题目有反馈？</button>
        </div>`}
      </div>`;
    };

    /** 学习报告（T6）：本次各知识点对错 + 视频 / 小分组现在的正确率 */
    const reportHTML = (r) => {
      let h = '';
      const ungN = (r.list || []).filter((x) => x.ungraded).length;
      if (r.mastery) {
        const v = r.mastery.video; const sc = r.mastery.section;
        h += `<div class="t6-report"><div class="t6-rep-t">掌握情况</div>
          <div class="t6-rep-row"><span>本视频习题</span><b>${esc(quizAccText(v))}</b></div>
          ${sc ? `<div class="t6-rep-row"><span>小分组「${esc(sc.name)}」</span><b>${esc(quizAccText(sc))}</b></div>` : ''}</div>`;
      }
      if (r.by_point && r.by_point.length) {
        h += `<div class="t6-report"><div class="t6-rep-t">本次各知识点</div>${r.by_point.map((p) => {
          const pct = p.total ? Math.round(p.correct / p.total * 100) : 0;
          return `<div class="t6-rep-row"><span>${esc(p.point)}</span><b>${p.correct} / ${p.total}</b><i class="t6-bar"><u class="${pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'low'}" style="width:${pct}%"></u></i></div>`;
        }).join('')}</div>`;
      }
      if (ungN) h += `<div class="t6-report"><div class="t6-rep-row"><span>另有 ${ungN} 道问答题不自动判分，请对照下面的参考答案自己批改</span></div></div>`;
      return h;
    };

    const paint = () => {
      const q = qs[st.idx];
      if (st.phase === 'result') {
        const r = st.result;
        const map = {};
        (r.list || []).forEach((x) => { map[x.question_id] = x; });
        bodyEl.innerHTML = `
          <div class="qz-score ${r.correct >= r.total / 2 ? 'good' : 'bad'}">
            <div class="v">${r.correct}<span> / ${r.total}</span></div>
            <div class="l">答对 ${r.correct} 题 · 答错 ${r.wrong} 题${opt.scoreTotal ? ` · 得分 ${r.score != null ? r.score : Math.round(r.correct / Math.max(1, r.total) * opt.scoreTotal)} / ${r.score_total || opt.scoreTotal}` : ''}</div>
            ${r.wrong ? '<div class="tip">答错的题已自动收进错题本，可以在错题本里重练</div>' : '<div class="tip">全对，太棒了！继续保持 🎉</div>'}
          </div>
          ${reportHTML(r)}
          ${(r.list || []).length ? `<div class="qz-results">${qs.map((qq) => resultOne(qq, map[qq.id])).join('')}</div>` : ''}`;
        footEl.innerHTML = `
          <button class="btn ghost" id="qzRedo"><i class="ai ai-refresh"></i> 再做一遍</button>
          <button class="btn primary" id="qzFinish">完 成</button>`;
        $('#qzFinish').onclick = () => { mask.remove(); if (opt.onDone) opt.onDone(st.result); };
        $('#qzRedo').onclick = () => {
          st.answers = {}; st.idx = 0; st.phase = 'answer'; st.result = null; st.startedAt = Date.now(); st.checked = {};
          stopTimer();
          if (isStep) { timerId = setInterval(paintTimer, 1000); paintTimer(); }
          paint();
        };
        // 原文折叠
        bodyEl.querySelectorAll('.qz-material').forEach((m) => {
          m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded');
        });
        // AI 讲解 / 反馈
        bodyEl.querySelectorAll('[data-ai]').forEach((b) => b.onclick = () => {
          const q = qs.find((x) => x.id === Number(b.dataset.ai));
          if (q) openAiExplain(q, map[q.id]);
        });
        bodyEl.querySelectorAll('[data-fb]').forEach((b) => b.onclick = () => {
          const q = qs.find((x) => x.id === Number(b.dataset.fb));
          if (q) openFeedback(q, map[q.id]);
        });
        dotsEl.style.display = 'none';
        renderDots();
        bindImageZoom(bodyEl);
        if (window.mtxTypeset) mtxTypeset(bodyEl);   // 题干/解析里的 LaTeX 排版
        return;
      }
      dotsEl.style.display = '';
      hideKpad();
      const si = stemImagesHTML(q);
      const ck = st.checked[st.idx];
      bodyEl.innerHTML = `
        <div class="qz-qhead"><span class="qz-qno">第 ${st.idx + 1} / ${total} 题</span>
          <span class="qz-qtype">${QT_NAME[q.type] || ''}</span>
          ${q.type === 'multi' ? '<span class="qz-qtip">可多选</span>' : ''}
          <span class="qz-raqno" title="题目编号">#${String(q.id).padStart(5, '0')}</span></div>
        ${q.material ? `<div class="qz-material"><div class="qz-mat-t">原文材料</div><pre class="qz-mat-b">${esc(q.material)}</pre></div>` : ''}
        <div class="qz-stem"><b>${si.stem}</b></div>
        ${si.rest}
        ${optionHTML(q)}
        ${ck ? stepJudgeHTML(q, ck) : ''}`;
      bindOptionEvents(q);
      bindImageZoom(bodyEl);
      if (window.mtxTypeset) mtxTypeset(bodyEl);   // 题干/选项里的 LaTeX 排版
      bodyEl.querySelectorAll('.qz-material').forEach((m) => {
        m.querySelector('.qz-mat-t').onclick = () => m.classList.toggle('folded');
      });
      bodyEl.querySelectorAll('[data-ai]').forEach((b) => b.onclick = () => openAiExplain(q, { my_answer: ck ? ck.my : quizAnswerText(q, st.answers[q.id]) }));
      bodyEl.querySelectorAll('[data-fb]').forEach((b) => b.onclick = () => openFeedback(q, { my_answer: ck ? ck.my : quizAnswerText(q, st.answers[q.id]) }));
      const last = st.idx >= total - 1;
      if (ck) {
        // 已核对：滚动到核对结果面板，只能去下一题 / 查看成绩
        const panel = bodyEl.querySelector('.qz-judge-box');
        if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
        footEl.innerHTML = last
          ? `<button class="btn primary" id="qzFinishCheck"><i class="ai ai-check"></i> 查看成绩</button>`
          : `<button class="btn primary" id="qzGoNext">下一题 ›</button>`;
        const go = mask.querySelector(last ? '#qzFinishCheck' : '#qzGoNext');
        go.onclick = async () => {
          if (last) { await doSubmit(); return; }
          st.idx++; paint();
        };
      } else {
        footEl.innerHTML = `
          ${st.idx > 0 ? '<button class="btn ghost" id="qzPrev">上一题</button>' : ''}
          <button class="btn primary" id="qzCheckOne"><i class="ai ai-check"></i> 提交本题</button>`;
        const prevBtn = mask.querySelector('#qzPrev');
        if (prevBtn) prevBtn.onclick = () => { if (st.idx > 0) { st.idx--; paint(); } };
        $('#qzCheckOne').onclick = checkOne;
      }
      renderDots();
    };

    /* ---- step 模式：提交本题 → 立即核对（不落库），显示对错 / 答案 / 解析 / AI 讲解 ---- */
    const stepJudgeHTML = (q, ck) => `
      <div class="qz-judge-box ${ck.ok ? 'ok' : 'no'}">
        <div class="qz-jb-h">${ck.ungraded ? '<i>✎</i> 已提交，请对照参考答案（问答题不计分）' : ck.ok ? '<i>✓</i> 回答正确，真棒！' : '<i>✗</i> 回答错误'}</div>
        <div class="qz-jb-r"><span>你的答案</span><em class="${ck.ok ? 'ok' : 'no'}">${esc(ck.my || '未作答')}</em></div>
        ${ck.ok && !ck.ungraded ? '' : `<div class="qz-jb-r"><span>${ck.ungraded ? '参考答案' : '正确答案'}</span><em class="ok">${esc(ck.answer)}</em></div>`}
        ${ck.analysis ? `<div class="qz-jb-ana"><span>解析</span>${esc(ck.analysis)}</div>` : ''}
        ${ck.ok || ck.ungraded ? '' : `<div class="qz-racts">
          <button class="btn ghost sm" data-ai="1">🧑‍🏫 AI 老师分步讲解</button>
          <button class="btn ghost sm" data-fb="1">对题目有反馈？</button>
        </div>`}
      </div>`;

    const checkOne = async () => {
      if (st.busy) return;
      const q = qs[st.idx];
      const my = quizAnswerText(q, st.answers[q.id]);
      if (my === '') { toast('先作答，再提交核对'); return; }
      st.busy = true;
      const btn = $('#qzCheckOne'); if (btn) btn.disabled = true;
      try {
        const r = await api('/api/stu/bank/check', { method: 'POST', body: { items: [{ question_id: q.id, my_answer: my }] } });
        const x = (r.list || [])[0] || {};
        st.checked[st.idx] = { ok: !!x.is_correct, ungraded: !!x.ungraded, answer: quizAnswerDisplay(q, x.answer, q.options), analysis: x.analysis || '', my: quizAnswerDisplay(q, my, q.options) };
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '核对失败，请重试', 'err'); if (btn) btn.disabled = false; }
      st.busy = false;
    };

    const doSubmit = async () => {
      if (st.busy) return;
      if (!isStep) {
        const unanswered = qs.filter((q) => quizAnswerText(q, st.answers[q.id]) === '').length;
        if (unanswered && !(await elConfirm({ title: '交卷确认', message: `还有 ${unanswered} 题没作答，未作答按错误计。确定交卷？`, okText: '交卷' }))) return;
        if (!unanswered && !(await elConfirm({ title: '交卷确认', message: '确定交卷吗？交卷后立即判分。', okText: '交卷' }))) return;
      } else {
        // step 模式：全部逐题核对完成后才会走到这里，直接落库
        const miss = qs.filter((q, i) => !st.checked[i] && quizAnswerText(q, st.answers[q.id]) === '').length;
        if (miss) { toast(`还有 ${miss} 题没有作答，先完成它们`); return; }
      }
      st.busy = true;
      stopTimer();
      const answers = qs.map((q) => ({ question_id: q.id, my_answer: quizAnswerText(q, st.answers[q.id]) }));
      const duration = Math.round((Date.now() - st.startedAt) / 1000);
      try {
        const r = await opt.submit(answers, duration);
        st.result = r; st.phase = 'result';
        if (typeof FX !== 'undefined') FX.pop();
        paint();
      } catch (e) { toast(e.message || '交卷失败，请重试', 'err'); }
      st.busy = false;
    };

    paint();
    return { close: () => mask.remove() };
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
          id: m.question_id, type: m.type, stem: m.stem, material: m.material || '', options: m.options || [], images: m.images || [], point: m.point || '',
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
