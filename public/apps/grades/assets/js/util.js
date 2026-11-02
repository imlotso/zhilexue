/* ==========================================================
   通用工具函数
   ========================================================== */
const U = (() => {
  const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).toString().replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  };

  const fmtNum = (n, d = 1) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d);

  const signNum = (n, d = 1) => (n == null || isNaN(n)) ? '—' : (n > 0 ? '+' + Number(n).toFixed(d) : Number(n).toFixed(d));

  const pct = (n, d = 1) => (n == null || isNaN(n)) ? '—' : (Number(n) * 100).toFixed(d) + '%';

  /** 日期格式化 2026-03-12 */
  const fmtDate = (d) => {
    if (!d) return '—';
    const t = new Date(d);
    if (isNaN(t)) return String(d);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  const today = () => fmtDate(new Date());
  const yearOf = (d) => (d ? String(d).slice(0, 4) : '');

  /** 年月：统一取 YYYY-MM（兼容历史 YYYY-MM-DD 数据） */
  const monthOf = (d) => {
    if (!d) return '';
    const s = String(d);
    return s.length >= 7 ? s.slice(0, 7) : s;
  };
  const fmtMonth = (d) => monthOf(d) || '—';
  const curMonth = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  };

  /**
   * 年月选择器：两个下拉（年 / 月），样式与其他筛选控件一致
   * @param {string} id 前缀，生成 #idY 与 #idM
   */
  const monthField = (id, value) => {
    const v = monthOf(value) || curMonth();
    const y = v.slice(0, 4), m = v.slice(5, 7);
    const cy = new Date().getFullYear();
    const years = [];
    for (let i = cy + 1; i >= cy - 5; i--) years.push(i);
    return `<div class="mp">
      <select id="${id}Y">${years.map(x => `<option ${String(x) === y ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <span class="mp-unit">年</span>
      <select id="${id}M">${Array.from({ length: 12 }, (_, i) => i + 1)
        .map(x => `<option value="${String(x).padStart(2, '0')}" ${String(x).padStart(2, '0') === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <span class="mp-unit">月</span>
    </div>`;
  };
  /** 读取 monthField → YYYY-MM */
  const monthVal = (id) => {
    const y = document.getElementById(id + 'Y'), m = document.getElementById(id + 'M');
    if (!y || !m) return '';
    return String(y.value) + '-' + String(m.value).padStart(2, '0');
  };

  const byDateAsc = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name));

  /** 姓名取末两字做头像（复姓取前两字） */
  const avatarText = (name) => {
    const n = String(name || '').trim();
    if (!n) return '?';
    return n.length <= 2 ? n : n.slice(-2);
  };

  /** 文本截断 */
  const clip = (s, n = 40) => {
    const t = String(s || '');
    return t.length > n ? t.slice(0, n) + '…' : t;
  };

  /** 简易防抖 */
  const debounce = (fn, wait = 250) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
  };

  /** 下载二进制 */
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  const toast = (msg, type = '') => {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = (type === 'ok' ? '✓ ' : type === 'err' ? '✕ ' : '') + esc(msg);
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2000);
    setTimeout(() => el.remove(), 2400);
  };

  /** 弹窗 */
  const modal = (opts) => {
    const root = document.getElementById('modalRoot');
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <div class="modal-head">
        <div class="modal-title">${esc(opts.title || '')}</div>
        <button class="modal-close" data-close="1">✕</button>
      </div>
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.foot === false ? '' : `<div class="modal-foot">${opts.foot || '<button class="btn" data-close="1">关闭</button>'}</div>`}
    `;
    root.hidden = false;
    if (opts.onMount) opts.onMount(box);
    box.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    return box;
  };
  const closeModal = () => {
    const root = document.getElementById('modalRoot');
    root.hidden = true;
    document.getElementById('modalBox').innerHTML = '';
  };

  const confirmBox = (msg, onOk, okText = '确认') => {
    modal({
      title: '操作确认',
      body: `<div style="font-size:13.5px;line-height:1.8">${msg}</div>`,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn ${/删除|清空/.test(okText) ? 'btn-danger' : 'btn-primary'}" id="__ok">${esc(okText)}</button>`,
      onMount(box) { box.querySelector('#__ok').onclick = () => { closeModal(); onOk && onOk(); }; }
    });
  };

  return { uid, esc, num, fmtNum, signNum, pct, fmtDate, today, yearOf, monthOf, fmtMonth, curMonth, monthField, monthVal, byDateAsc, avatarText, clip, debounce, downloadBlob, toast, modal, closeModal, confirmBox };
})();
