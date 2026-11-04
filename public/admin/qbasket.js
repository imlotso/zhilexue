/* 试题篮（R3 / R6 共用）：老师在题库管理、智能组卷里逐题「加入试题篮」，篮子里的题在智能组卷页生成试卷。
 * 只存在当前浏览器（localStorage，按登录账号分开）：它是"正在挑的题"，生成试卷后才落库；读写都包了 try/catch，存不了就只在本页内存里。
 * 每项：{ id, type, score }，顺序即卷面顺序。
 *   QB.list() / QB.has(id) / QB.add(q) / QB.remove(id) / QB.toggle(q) / QB.clear() / QB.count() / QB.set(list)
 *   QB.on(fn) 订阅变化（返回取消函数）
 *   qbFab(opts) 右侧悬浮的「试题篮」按钮（显示数量）；opts.onOpen 不给时点了跳到智能组卷页
 */
'use strict';
const QB_DEFAULT_SCORE = { single: 3, multi: 4, judge: 2, fill: 3, sort: 4, answer: 10 };
const QB = (() => {
  let mem = null;
  const subs = new Set();
  const key = () => 'zx_qbasket_' + ((window.Auth && Auth.user && Auth.user.id) || 'me');
  const read = () => {
    if (mem) return mem;
    try { const a = JSON.parse(localStorage.getItem(key()) || '[]'); mem = Array.isArray(a) ? a.filter((x) => x && x.id) : []; } catch (e) { mem = []; }
    return mem;
  };
  const write = (list) => {
    mem = list;
    try { localStorage.setItem(key(), JSON.stringify(list)); } catch (e) { /* 存不了就只留在内存 */ }
    subs.forEach((fn) => { try { fn(list); } catch (e) { /* ignore */ } });
  };
  return {
    list: () => read().slice(),
    count: () => read().length,
    has: (id) => read().some((x) => Number(x.id) === Number(id)),
    add(q) {
      if (!q || !q.id || this.has(q.id)) return false;
      write([...read(), { id: Number(q.id), type: q.type || 'single', score: Number(q.score) || QB_DEFAULT_SCORE[q.type] || 3 }]);
      return true;
    },
    addMany(qs) { const cur = read(); const have = new Set(cur.map((x) => Number(x.id))); const add = (qs || []).filter((q) => q && q.id && !have.has(Number(q.id))).map((q) => ({ id: Number(q.id), type: q.type || 'single', score: Number(q.score) || QB_DEFAULT_SCORE[q.type] || 3 })); if (add.length) write([...cur, ...add]); return add.length; },
    remove(id) { write(read().filter((x) => Number(x.id) !== Number(id))); },
    toggle(q) { if (this.has(q.id)) { this.remove(q.id); return false; } this.add(q); return true; },
    clear() { write([]); },
    set(list) { write((list || []).filter((x) => x && x.id)); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();

const QB_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 9l3.5-5 3.5 5M9.5 13v3.5M14.5 13v3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** 右侧悬浮试题篮按钮。返回 { el, remove } */
let qbFabCur = null;
function qbFab(opts = {}) {
  if (qbFabCur) qbFabCur.remove();
  document.querySelectorAll('.r3-fab').forEach((x) => x.remove());
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'r3-fab';
  el.title = '试题篮';
  const paint = () => {
    const n = QB.count();
    el.innerHTML = `<span class="r3-fab-ic">${QB_SVG}</span><span class="r3-fab-t">试题篮</span><b class="r3-fab-n ${n ? '' : 'z'}">${n > 99 ? '99+' : n}</b>`;
    el.setAttribute('aria-label', `试题篮，已选 ${n} 题`);
  };
  paint();
  const off = QB.on(() => { paint(); el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 200); });
  el.onclick = () => { if (typeof opts.onOpen === 'function') opts.onOpen(); else location.hash = '#/paper'; };
  (document.querySelector('.admin-app') || document.body).appendChild(el);
  // 宽屏时给页面内容右侧留出悬浮按钮的位置（样式见 theme.css 的 r3-fab-gutter）
  const view = document.getElementById('view');
  if (view) view.classList.add('r3-fab-gutter');
  // 换页（hash 变化）后自动移除，避免留在别的页面上
  const onHash = () => { const k = (location.hash.replace('#/', '').split('?')[0]); if (!(opts.pages || []).includes(k)) { el.remove(); off(); window.removeEventListener('hashchange', onHash); } };
  window.addEventListener('hashchange', onHash);
  qbFabCur = { el, paint, remove: () => { el.remove(); off(); window.removeEventListener('hashchange', onHash); qbFabCur = null; } };
  return qbFabCur;
}
window.QB = QB;
window.qbFab = qbFab;
