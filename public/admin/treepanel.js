/* 可复用的目录树面板（R3）：洋葱式「学段 / 学科 / 版本」级联选择 + 章节 | 知识点 切换 + 多层可折叠树
 *
 *   const tp = treePanel(el, {
 *     state,                 // 持久状态对象（页面自己存，例如 ADM.page.mfq.tp）；面板会读写 stage / subject / edition / kind / sel / open / multi / q
 *     kinds: ['textbook', 'knowledge'],   // 显示哪些分段；只给一个时不显示分段
 *     cascader: true,        // 顶部级联选择器
 *     pick: false,           // true = 选择器模式（弹窗里用）：一直显示复选框，不显示「多选」开关
 *     allLabel: '全部章节',   // 顶部「全部」行的文字（pick 模式不显示）
 *     maxHeight: '',         // 树区域的最大高度（CSS 值），默认由样式决定
 *     onChange(ctx),         // 选中节点变化
 *     onScope(ctx),          // 学段 / 学科 / 版本 / 章节知识点 切换后（树已重新载入）
 *   });
 *   tp.ctx()  → { stage, subject, edition, kind, tree, sel:[id], node(id), pathOf(id)→[名称…], nameOf(id), nodes:[...] }
 *   tp.reload() 重新取节点（题数会更新）；tp.setSel(ids)；tp.remove(id)；tp.clear()
 *
 * 选中规则：单选模式点行 = 只选这一个（再点取消）；按住 Ctrl / ⌘ 点 = 追加；打开「多选」开关后行前出复选框。
 * 选中的节点在后端按「含子孙」筛题（GET /questions?nodes=…），题数徽标是子孙去重后的题数。
 * 依赖：treepick.js 的 tpTrees / pickTree / tpEditions / tpDefaultEdition；api.js 的 api / esc。
 */
'use strict';
const TPN_STAGES = [['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const TPN_SUBJ_ORDER = ['数学', '英语', '语文', '物理', '化学', '生物', '历史', '地理', '政治'];
const TPN_SVG = {
  caret: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4M4 2.5h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4M4 13.5h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  book: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.2c1.8-.6 3.6-.5 5.5.6v9.4c-1.9-1.1-3.7-1.2-5.5-.6zM13.5 3.2c-1.8-.6-3.6-.5-5.5.6v9.4c1.9-1.1 3.7-1.2 5.5-.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  tag: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 2.5h5l6 6-5 5-6-6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="5.3" cy="5.3" r="1" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

/** 当前学期：8 月到次年 1 月算上册，其余算下册（默认展开用） */
function tpnTerm() { const m = new Date().getMonth() + 1; return (m >= 8 || m <= 1) ? '上册' : '下册'; }

function treePanel(el, opt = {}) {
  const st = opt.state || {};
  const kinds = opt.kinds && opt.kinds.length ? opt.kinds : ['textbook', 'knowledge'];
  if (!kinds.includes(st.kind)) st.kind = kinds[0];
  if (!Array.isArray(st.sel)) st.sel = [];
  st.sel = st.sel.map(String);
  if (!st.open || typeof st.open !== 'object') st.open = {};
  if (st.q == null) st.q = '';
  const pick = !!opt.pick;
  let trees = opt.trees || null;
  let tree = null; let nodes = []; let byId = new Map(); let kids = {};
  let casOpen = false; let casStage = ''; let casSubj = '';
  const uid = 'tpn' + Math.random().toString(36).slice(2, 8);

  // 分类入口不应因目录尚未导入而消失；空范围仍展示真实空态，不制造树或节点。
  const stagesOf = () => TPN_STAGES;
  const subjectsOf = (stage) => [...new Set([
    ...(stage === 'primary' ? ['数学', '英语', '语文'] : ['数学', '英语', '语文', '物理', '化学']),
    ...trees.filter((t) => (t.stage || '') === stage && t.subject).map((t) => t.subject),
  ])]
    .sort((a, b) => ((TPN_SUBJ_ORDER.indexOf(a) + 1 || 99) - (TPN_SUBJ_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b, 'zh'));
  const editionsOf = (stage, subject) => {
    const tb = tpEditions(trees, { kind: 'textbook', subject, stage });
    const editions = tb.length ? tb : tpEditions(trees, { kind: 'knowledge', subject, stage });
    return editions.length ? editions : [''];
  };
  const stageName = (k) => (TPN_STAGES.find((x) => x[0] === k) || [k, k || '不限学段'])[1];
  const pathOf = (id) => { const out = []; let n = byId.get(String(id)); let g = 0; while (n && g++ < 20) { out.unshift(n.name); n = n.parent_id ? byId.get(String(n.parent_id)) : null; } return out; };
  const ctx = () => ({
    stage: st.stage, subject: st.subject, edition: st.edition || '', kind: st.kind, tree, nodes,
    sel: st.sel.filter((id) => byId.has(id)).map(Number),
    node: (id) => byId.get(String(id)) || null, pathOf, nameOf: (id) => (byId.get(String(id)) || {}).name || '',
  });

  /** 规范学段 / 学科 / 版本：没有的值退回第一个可用的 */
  function normScope() {
    const sts = stagesOf();
    if (!sts.some(([k]) => k === st.stage)) st.stage = (sts[0] || ['primary'])[0];
    const subs = subjectsOf(st.stage);
    if (!subs.includes(st.subject)) st.subject = subs.includes('数学') ? '数学' : (subs[0] || '');
    const eds = editionsOf(st.stage, st.subject);
    if (!eds.includes(st.edition || '')) st.edition = eds[0] || '';
  }

  async function loadTree() {
    tree = pickTree(trees, { kind: st.kind, subject: st.subject, stage: st.stage, edition: st.edition });
    nodes = []; byId = new Map(); kids = {};
    if (tree) {
      nodes = (await api(`/api/admin/bank/mf/trees/${tree.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
    }
    nodes.forEach((n) => { byId.set(String(n.id), n); const p = String(n.parent_id || 0); (kids[p] = kids[p] || []).push(n); });
    st.sel = st.sel.filter((id) => byId.has(id));
    // 第一次打开这棵树：默认展开题最多的一个顶层节点（通常就是常用年级），章节树再展开当前学期的册别
    if (tree && !st.open[tree.id]) {
      const op = {};
      const top = kids['0'] || [];
      const best = top.slice().sort((a, b) => (b.qcount || 0) - (a.qcount || 0))[0];
      if (best) {
        op[best.id] = 1;
        const sub = kids[String(best.id)] || [];
        if (st.kind === 'textbook' && sub.length) {
          const vol = sub.find((v) => v.name.includes(tpnTerm()) && (v.qcount || 0) > 0) || sub.find((v) => (v.qcount || 0) > 0) || sub.find((v) => v.name.includes(tpnTerm())) || sub[0];
          op[vol.id] = 1;
        }
      }
      st.open[tree.id] = op;
    }
  }

  // ---------------------------------------------------------------- 渲染
  function casHtml() {
    if (opt.cascader === false) return '';
    const label = [stageName(st.stage), st.subject || '—', (st.edition || '通用')].join(' / ');
    if (!casOpen) return `<div class="r3-cas"><button type="button" class="r3-cas-btn" data-tp="cas" aria-haspopup="listbox" aria-expanded="false" title="${esc(label)}"><span class="r3-cas-txt">${esc(label)}</span><i class="r3-cas-ar">${TPN_SVG.down}</i></button></div>`;
    const cs = casStage || st.stage; const subs = subjectsOf(cs);
    const cj = casSubj && subs.includes(casSubj) ? casSubj : (cs === st.stage && subs.includes(st.subject) ? st.subject : '');
    const eds = cj ? editionsOf(cs, cj) : [];
    const def = cj ? tpDefaultEdition(cj, cs) : '';
    const col = (items, cls) => `<ul class="r3-cas-col ${cls}" role="listbox">${items}</ul>`;
    return `<div class="r3-cas open"><button type="button" class="r3-cas-btn on" data-tp="cas" aria-expanded="true" title="${esc(label)}"><span class="r3-cas-txt">${esc(label)}</span><i class="r3-cas-ar">${TPN_SVG.down}</i></button>
      <div class="r3-cas-pop">
        ${col(stagesOf().map(([k, t]) => `<li class="r3-cas-it has ${k === cs ? 'on' : ''}" data-cs="${k}">${t}<i>${TPN_SVG.caret}</i></li>`).join(''), 'c1')}
        ${col(subs.map((s) => `<li class="r3-cas-it has ${s === cj ? 'on' : ''}" data-cj="${esc(s)}">${esc(s)}<i>${TPN_SVG.caret}</i></li>`).join('') || '<li class="r3-cas-none">没有学科</li>', 'c2')}
        ${col(cj ? eds.map((e) => `<li class="r3-cas-it ${cs === st.stage && cj === st.subject && e === (st.edition || '') ? 'on' : ''}" data-ce="${esc(e)}">${esc(e || '通用')}${e && e === def ? '<em>默认</em>' : ''}</li>`).join('') : '<li class="r3-cas-none">先选学科</li>', 'c3')}
      </div></div>`;
  }

  function rowHtml(n, depth, vis, hitSet) {
    const id = String(n.id);
    if (vis && !vis.has(id)) return '';
    const ch = kids[id] || [];
    const open = vis ? true : !!(st.open[tree.id] || {})[id];
    const on = st.sel.includes(id);
    const showCk = pick || st.multi;
    const nm = esc(n.name);
    const name = (st.q && hitSet && hitSet.has(id)) ? nm.replace(new RegExp(esc(st.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`) : nm;
    const cnt = n.qcount || 0;
    return `<div class="r3-tn-wrap">
      <div class="r3-tn ${on ? 'on' : ''} ${depth === 0 ? 'top' : ''}" data-tn="${id}" role="treeitem" aria-selected="${on}" ${ch.length ? `aria-expanded="${open}"` : ''} tabindex="-1" title="${esc(pathOf(id).join(' / '))}">
        <button type="button" class="r3-tn-car ${ch.length ? (open ? 'open' : '') : 'leaf'}" data-tw="${id}" tabindex="-1" aria-label="${open ? '收起' : '展开'}">${ch.length ? TPN_SVG.caret : '<i></i>'}</button>
        ${showCk ? `<input type="checkbox" class="r3-tn-ck" data-ck="${id}" ${on ? 'checked' : ''} tabindex="-1" aria-label="选择">` : ''}
        <span class="r3-tn-name">${name}</span>
        <span class="r3-tn-n ${cnt ? '' : 'z'}">${cnt}</span>
      </div>
      ${ch.length && open ? `<div class="r3-tn-kids" role="group">${ch.map((c) => rowHtml(c, depth + 1, vis, hitSet)).join('')}</div>` : ''}
    </div>`;
  }

  function treeHtml() {
    if (!tree) return `<div class="r3-tp-empty">该学段 + 学科还没有${st.kind === 'textbook' ? '教材章节' : '知识点'}树<br><a href="#/ktree">去「知识树管理」建树</a></div>`;
    let vis = null; let hitSet = null; let hits = 0;
    const q = String(st.q || '').trim().toLowerCase();
    if (q) {
      vis = new Set(); hitSet = new Set();
      nodes.forEach((n) => {
        if (String(n.name).toLowerCase().includes(q)) {
          hits++; hitSet.add(String(n.id));
          let p = n; let g = 0; while (p && g++ < 20) { vis.add(String(p.id)); p = p.parent_id ? byId.get(String(p.parent_id)) : null; }
        }
      });
    }
    const top = kids['0'] || [];
    // 「全部」行不显示数字：右侧列表在不选节点时按 学段+学科 取题（含还没挂到这棵树上的题），和树上挂载数不是一回事
    const allRow = pick ? '' : `<div class="r3-tn r3-tn-all ${st.sel.length ? '' : 'on'}" data-tn="" role="treeitem" aria-selected="${!st.sel.length}"><span class="r3-tn-car leaf"><i></i></span><span class="r3-tn-name">${esc(opt.allLabel || (st.kind === 'textbook' ? '全部章节' : '全部知识点'))}</span></div>`;
    const body = top.map((n) => rowHtml(n, 0, vis, hitSet)).join('');
    if (q && !hits) return `${allRow}<div class="r3-tp-empty">没有名称包含「${esc(st.q)}」的节点</div>`;
    return (q ? `<div class="r3-tp-hits">找到 <b>${hits}</b> 个节点</div>` : '') + allRow + (body || '<div class="r3-tp-empty">这棵树还没有节点</div>');
  }

  function render() {
    const anyOpen = tree && Object.keys(st.open[tree.id] || {}).length > 0;
    el.innerHTML = `<div class="r3-tp ${pick ? 'pick' : ''}" id="${uid}">
      <div class="r3-cas-slot">${casHtml()}</div>
      ${kinds.length > 1 ? `<div class="r3-seg" role="tablist">${kinds.map((k) => `<button type="button" role="tab" class="r3-seg-it ${st.kind === k ? 'on' : ''}" aria-selected="${st.kind === k}" data-kind="${k}">${k === 'textbook' ? '章节' : '知识点'}</button>`).join('')}</div>` : ''}
      <div class="r3-tp-tools">
        <label class="r3-tp-search">${TPN_SVG.search}<input type="search" data-tp="q" placeholder="搜索${st.kind === 'textbook' ? '章节' : '知识点'}" value="${esc(st.q)}" aria-label="搜索节点"></label>
        <button type="button" class="r3-tp-tbtn" data-tp="toggle" title="${anyOpen ? '全部收起' : '全部展开'}" aria-label="${anyOpen ? '全部收起' : '全部展开'}">${anyOpen ? TPN_SVG.collapse : TPN_SVG.expand}<span>${anyOpen ? '收起' : '展开'}</span></button>
        ${pick ? '' : `<label class="r3-tp-multi" title="打开后可勾选多个节点（也可按住 Ctrl / ⌘ 点击）"><input type="checkbox" data-tp="multi" ${st.multi ? 'checked' : ''}><span class="r3-sw"></span>多选</label>`}
      </div>
      <div class="r3-tp-tree" role="tree" aria-multiselectable="${!!(pick || st.multi)}" ${opt.maxHeight ? `style="max-height:${opt.maxHeight}"` : ''}>${treeHtml()}</div>
    </div>`;
    bind();
  }

  function emit(scope) {
    const c = ctx();
    if (scope && typeof opt.onScope === 'function') opt.onScope(c);
    if (typeof opt.onChange === 'function') opt.onChange(c);
  }

  function setSel(ids, silent) {
    st.sel = [...new Set((ids || []).map(String))].filter((id) => byId.has(id));
    renderTree();
    if (!silent) emit(false);
  }
  function renderTree() {
    const box = el.querySelector('.r3-tp-tree');
    if (!box) return render();
    const sc = box.scrollTop;
    box.innerHTML = treeHtml();
    box.scrollTop = sc;
    bindTree();
    const anyOpen = tree && Object.keys(st.open[tree.id] || {}).length > 0;
    const tb = el.querySelector('[data-tp="toggle"]');
    if (tb) { tb.innerHTML = `${anyOpen ? TPN_SVG.collapse : TPN_SVG.expand}<span>${anyOpen ? '收起' : '展开'}</span>`; tb.title = anyOpen ? '全部收起' : '全部展开'; }
  }

  async function changeScope(patch) {
    const origin = document.activeElement;
    const restoreCascader = !!(el.querySelector('.r3-cas-slot') && el.querySelector('.r3-cas-slot').contains(origin));
    Object.assign(st, patch);
    st.sel = []; st.q = '';
    normScope();
    await loadTree();
    const restoreFocus = restoreCascader && (document.activeElement === origin || document.activeElement === document.body);
    render();
    if (restoreFocus) el.querySelector('[data-tp="cas"]').focus();
    emit(true);
  }

  function bindTree() {
    const box = el.querySelector('.r3-tp-tree');
    const rows = () => [...box.querySelectorAll('[data-tn]')];
    const focusRow = id => {
      const target = rows().find(row => row.dataset.tn === String(id));
      if (!target) return;
      rows().forEach(row => { row.tabIndex = row === target ? 0 : -1; });
      target.focus();
    };
    const first = rows().find(row => row.getAttribute('aria-selected') === 'true') || rows()[0];
    rows().forEach(row => { row.tabIndex = row === first ? 0 : -1; });
    box.querySelectorAll('[data-tw]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        if (!tree || st.q) return;
        const op = (st.open[tree.id] = st.open[tree.id] || {}), id = b.dataset.tw;
        if (!(kids[id] || []).length) return;
        op[id] ? delete op[id] : (op[id] = 1);
        renderTree();
        focusRow(id);
      };
    });
    rows().forEach(row => {
      row.onclick = e => {
        if (e.target.closest('[data-tw]')) return;
        const id = row.dataset.tn;
        if (!id) { if (st.sel.length) setSel([]); focusRow(''); return; }
        const multi = pick || st.multi || e.ctrlKey || e.metaKey || e.target.classList.contains('r3-tn-ck');
        if (multi) setSel(st.sel.includes(id) ? st.sel.filter(x => x !== id) : [...st.sel, id]);
        else setSel(st.sel.length === 1 && st.sel[0] === id ? [] : [id]);
        focusRow(id);
      };
      row.ondblclick = () => { const b = row.querySelector('[data-tw]'); if (b && !b.classList.contains('leaf')) b.click(); };
    });
    box.onkeydown = e => {
      const row = e.target.closest('[data-tn]');
      if (!row || !box.contains(row)) return;
      const list = rows(), index = list.indexOf(row), id = row.dataset.tn;
      const go = n => focusRow(list[Math.max(0, Math.min(list.length - 1, n))].dataset.tn);
      if (e.key === 'ArrowDown') go(index + 1);
      else if (e.key === 'ArrowUp') go(index - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'ArrowRight') {
        if (row.getAttribute('aria-expanded') === 'false') row.querySelector('[data-tw]').click();
        else if (row.getAttribute('aria-expanded') === 'true') go(index + 1);
      } else if (e.key === 'ArrowLeft') {
        if (row.getAttribute('aria-expanded') === 'true' && !st.q) row.querySelector('[data-tw]').click();
        else { const group = row.parentElement.closest('.r3-tn-kids'); const parent = group && group.parentElement.querySelector('.r3-tn'); if (parent) focusRow(parent.dataset.tn); }
      } else if (e.key === 'Enter' || e.key === ' ') {
        row.onclick({ target: row, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
        focusRow(id);
      } else return;
      e.preventDefault(); e.stopPropagation();
    };
  }

  function renderCas(preferredFocus) {
    const slot = el.querySelector('.r3-cas-slot');
    if (!slot) return;
    const active = document.activeElement, hadFocus = slot.contains(active);
    const attribute = active && ['data-cs', 'data-cj', 'data-ce'].find(name => active.hasAttribute(name));
    const logicalFocus = preferredFocus || (attribute ? { attribute, value: active.getAttribute(attribute) } : null);
    slot.innerHTML = casHtml();
    bindCas();
    if (hadFocus) {
      const target = casOpen && logicalFocus && [...slot.querySelectorAll('.r3-cas-it')].find(option => option.getAttribute(logicalFocus.attribute) === logicalFocus.value);
      (target || slot.querySelector('[data-tp="cas"]')).focus();
    }
  }
  function onCasFocusOut() {
    const slot = el.querySelector('.r3-cas-slot');
    queueMicrotask(() => { if (casOpen && el.isConnected && slot && !slot.contains(document.activeElement)) { casOpen = false; renderCas(); } });
  }
  function bindCas() {
    const slot = el.querySelector('.r3-cas-slot');
    const casBtn = slot && slot.querySelector('[data-tp="cas"]');
    if (!casBtn) return;
    const focusColumn = index => {
      if (index < 0) { slot.querySelector('[data-tp="cas"]').focus(); return; }
      const col = slot.querySelectorAll('.r3-cas-col')[index];
      const target = col && (col.querySelector('.r3-cas-it.on') || col.querySelector('.r3-cas-it'));
      if (target) target.focus();
    };
    const closeCas = () => { casOpen = false; renderCas(); focusColumn(-1); };
    casBtn.onclick = e => { e.stopPropagation(); casOpen = !casOpen; casStage = st.stage; casSubj = st.subject; renderCas(); focusColumn(casOpen ? 0 : -1); };
    casBtn.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (!casOpen) { casOpen = true; casStage = st.stage; casSubj = st.subject; renderCas(); } focusColumn(0); }
      else if (e.key === 'Escape' && casOpen) { e.preventDefault(); e.stopPropagation(); closeCas(); }
    };
    slot.querySelectorAll('.r3-cas-col').forEach((col, index) => {
      col.setAttribute('aria-label', ['学段', '学科', '教材版本'][index]);
      col.querySelectorAll('.r3-cas-it').forEach(option => { option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(option.classList.contains('on'))); option.tabIndex = -1; });
    });
    slot.onkeydown = e => {
      const option = e.target.closest('.r3-cas-it'); if (!option || !casOpen) return;
      const col = option.closest('.r3-cas-col'), cols = [...slot.querySelectorAll('.r3-cas-col')];
      const items = [...col.querySelectorAll('.r3-cas-it')], i = items.indexOf(option), c = cols.indexOf(col);
      if (e.key === 'Escape') closeCas();
      else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
      else if (e.key === 'ArrowUp') items[(i + items.length - 1) % items.length].focus();
      else if (e.key === 'Home') items[0].focus();
      else if (e.key === 'End') items[items.length - 1].focus();
      else if (e.key === 'ArrowLeft') focusColumn(c - 1);
      else if (e.key === 'ArrowRight') { if (c < 2) { if (option.onmouseenter) option.onmouseenter(); focusColumn(c + 1); } }
      else if (e.key === 'Enter' || e.key === ' ') { option.click(); if (c === 0) focusColumn(1); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    slot.removeEventListener('focusout', onCasFocusOut);
    slot.addEventListener('focusout', onCasFocusOut);
    slot.querySelectorAll('[data-cs]').forEach((li) => {
      li.onclick = (e) => { e.stopPropagation(); casStage = li.dataset.cs; casSubj = ''; renderCas({ attribute: 'data-cs', value: li.dataset.cs }); };
      li.onmouseenter = () => { if (casStage !== li.dataset.cs) { casStage = li.dataset.cs; casSubj = ''; renderCas({ attribute: 'data-cs', value: li.dataset.cs }); } };
    });
    slot.querySelectorAll('[data-cj]').forEach((li) => {
      li.onmouseenter = () => { if (casSubj !== li.dataset.cj) { casSubj = li.dataset.cj; renderCas({ attribute: 'data-cj', value: li.dataset.cj }); } };
      // 点学科 = 用该学科的默认版本直接切过去；想换版本就点第三列
      li.onclick = (e) => {
        e.stopPropagation();
        const cs = casStage || st.stage; const eds = editionsOf(cs, li.dataset.cj); const def = tpDefaultEdition(li.dataset.cj, cs);
        casOpen = false; changeScope({ stage: cs, subject: li.dataset.cj, edition: eds.includes(def) ? def : (eds[0] || '') });
      };
    });
    slot.querySelectorAll('[data-ce]').forEach((li) => {
      li.onclick = (e) => { e.stopPropagation(); const cs = casStage || st.stage; const cj = casSubj || st.subject; casOpen = false; changeScope({ stage: cs, subject: cj, edition: li.dataset.ce }); };
    });
  }
  // 点级联面板外面任何地方就收起（每个面板只挂一个监听；面板被移出页面后自动解绑）
  const outside = (e) => {
    if (!document.body.contains(el)) { document.removeEventListener('mousedown', outside, true); return; }
    if (!casOpen) return;
    const slot = el.querySelector('.r3-cas-slot');
    if (slot && slot.contains(e.target)) return;
    casOpen = false; renderCas();
  };
  document.addEventListener('mousedown', outside, true);

  function bind() {
    const root = el.querySelector('.r3-tp');
    bindCas();
    root.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { if (st.kind !== b.dataset.kind) changeScope({ kind: b.dataset.kind }); }; });
    const q = root.querySelector('[data-tp="q"]');
    let tm = null;
    q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { st.q = q.value.trim(); renderTree(); }, 160); };
    q.onkeydown = (e) => { if (e.key === 'Escape') { q.value = ''; st.q = ''; renderTree(); } };
    root.querySelector('[data-tp="toggle"]').onclick = () => {
      if (!tree) return;
      const op = st.open[tree.id] || {};
      if (Object.keys(op).length) st.open[tree.id] = {};
      else { const all = {}; nodes.forEach((n) => { if ((kids[String(n.id)] || []).length) all[n.id] = 1; }); st.open[tree.id] = all; }
      renderTree();
    };
    const mt = root.querySelector('[data-tp="multi"]');
    if (mt) mt.onchange = () => { st.multi = mt.checked; if (!st.multi && st.sel.length > 1) { st.sel = st.sel.slice(-1); emit(false); } renderTree(); root.querySelector('.r3-tp-tree').setAttribute('aria-multiselectable', String(!!st.multi)); };
    bindTree();
  }

  const api_ = {
    ctx,
    setSel: (ids) => setSel(ids),
    remove: (id) => setSel(st.sel.filter((x) => x !== String(id))),
    clear: () => setSel([]),
    async reload() { await loadTree(); renderTree(); },
    el,
  };
  api_.ready = (async () => {
    if (!trees) trees = await tpTrees();
    normScope();
    await loadTree();
    render();
    emit(true);
    return api_;
  })();
  return api_;
}
window.treePanel = treePanel;
