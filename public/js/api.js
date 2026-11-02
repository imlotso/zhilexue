/* 通用工具 + 接口封装 */
const PREFIX = window.STORAGE_PREFIX || 'xuexi';
const TOKEN_KEY = PREFIX + '_token';
const USER_KEY = PREFIX + '_user';

const Auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } },
  set user(v) { v ? localStorage.setItem(USER_KEY, JSON.stringify(v)) : localStorage.removeItem(USER_KEY); },
  clear() { this.token = ''; this.user = null; },
};

async function api(path, { method = 'GET', body, raw, silent } = {}) {
  const headers = {};
  if (Auth.token) headers.Authorization = 'Bearer ' + Auth.token;
  let payload = body;
  if (body && !raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload });
  let json;
  try { json = await res.json(); } catch (e) { json = { code: 500, msg: '服务器返回异常' }; }
  if (json.code === 401) { Auth.clear(); if (location.hash !== '#/login') location.hash = '#/login'; throw new Error(json.msg); }
  if (json.code !== 0) { if (!silent) toast(json.msg || '操作失败', 'err'); throw new Error(json.msg || '操作失败'); }
  return json.data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  const kind = type === 'err' || type === 'error' ? 'error' : type === 'ok' || type === 'success' ? 'success' : 'info';
  el.className = 'el-message el-message--' + kind + ' toast ' + type;
  el.innerHTML = `<i class="el-message__icon el-icon-${kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'info'}"></i><p class="el-message__content"></p>`;
  el.querySelector('.el-message__content').textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 2200);
}

/** 登录页科技感视频背景（文件：public/img/zxbx_bg_jp.mp4） */
function brandHTML(sub) {
  return `<div class="zx-logo">
    <img class="zx-mark" src="/img/logo.jpg" alt="智学课堂" width="40" height="40">
    <span class="zx-txt"><b>智学课堂</b>${sub ? `<em>${sub}</em>` : ''}</span>
  </div>`;
}

function loginBgHTML() {
  return `<div class="login-bg" aria-hidden="true">
    <video class="login-bg-video" autoplay muted loop playsinline preload="auto" poster="/img/login-bg.svg">
      <source src="/img/zxbx_bg_jp.mp4" type="video/mp4">
    </video>
    <div class="login-bg-mask"></div>
  </div>`;
}

/** Element UI 风格弹窗（与 admin modal 结构一致） */
function elDialog({ title, body, wide, footer }) {
  const wrap = document.createElement('div');
  wrap.className = 'el-dialog__wrapper mask';
  wrap.innerHTML = `<div role="dialog" class="el-dialog modal ${wide ? 'wide el-dialog--wide' : ''}">
    <div class="el-dialog__header modal-h">
      <span class="el-dialog__title">${esc(title)}</span>
      <button type="button" class="el-dialog__headerbtn close-x" aria-label="Close"><i class="el-dialog__close el-icon el-icon-close"></i></button>
    </div>
    <div class="el-dialog__body modal-b">${body}</div>
    ${footer ? `<div class="el-dialog__footer modal-f">${footer}</div>` : ''}
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.close-x').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return { el: wrap, close };
}

/** 替代浏览器 confirm：返回 Promise<boolean> */
function elConfirm({ title = '提示', message = '', okText = '确定', cancelText = '取消', danger } = {}) {
  return new Promise((resolve) => {
    const { el, close } = elDialog({
      title,
      body: `<div class="el-msg-text">${esc(message)}</div>`,
      footer: `<button type="button" class="el-button el-button--default btn ghost" id="elcNo">${esc(cancelText)}</button>
        <button type="button" class="el-button el-button--primary btn ${danger ? 'danger' : ''}" id="elcOk">${esc(okText)}</button>`,
    });
    el.querySelector('.el-dialog').classList.add('el-msgbox');
    const done = (v) => { close(); resolve(v); };
    el.querySelector('#elcOk').onclick = () => done(true);
    el.querySelector('#elcNo').onclick = () => done(false);
    el.querySelector('.close-x').onclick = () => done(false);
    el.addEventListener('click', (e) => { if (e.target === el) done(false); });
  });
}

/** 替代浏览器 prompt：确定返回字符串，取消返回 null */
function elPrompt({ title = '请输入', message = '', value = '', placeholder = '', okText = '确定' } = {}) {
  return new Promise((resolve) => {
    const { el, close } = elDialog({
      title,
      body: `${message ? `<p class="el-msg-text">${esc(message)}</p>` : ''}
        <input class="input" id="elpIn" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`,
      footer: `<button type="button" class="el-button el-button--default btn ghost" id="elcNo">取消</button>
        <button type="button" class="el-button el-button--primary btn" id="elcOk">${esc(okText)}</button>`,
    });
    el.querySelector('.el-dialog').classList.add('el-msgbox');
    const inp = el.querySelector('#elpIn');
    setTimeout(() => { if (inp) { inp.focus(); inp.select(); } }, 60);
    const done = (v) => { close(); resolve(v); };
    el.querySelector('#elcOk').onclick = () => done(inp.value);
    el.querySelector('#elcNo').onclick = () => done(null);
    el.querySelector('.close-x').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); };
  });
}

/** 替代浏览器 alert */
function elAlert({ title = '提示', message = '', okText = '知道了' } = {}) {
  return new Promise((resolve) => {
    const { el, close } = elDialog({
      title,
      body: `<div class="el-msg-text">${esc(message)}</div>`,
      footer: `<button type="button" class="el-button el-button--primary btn" id="elcOk">${esc(okText)}</button>`,
    });
    el.querySelector('.el-dialog').classList.add('el-msgbox');
    const done = () => { close(); resolve(); };
    el.querySelector('#elcOk').onclick = done;
    el.querySelector('.close-x').onclick = done;
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fileKind(name) {
  const e = (String(name || '').split('.').pop() || '').toLowerCase();
  if (e === 'pdf') return { cls: 'pdf', txt: 'PDF' };
  if (['doc', 'docx', 'wps'].includes(e)) return { cls: 'doc', txt: 'DOC' };
  if (['ppt', 'pptx'].includes(e)) return { cls: 'ppt', txt: 'PPT' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { cls: 'xls', txt: 'XLS' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(e)) return { cls: 'img', txt: 'IMG' };
  if (['html', 'htm'].includes(e)) return { cls: 'html', txt: 'HTML' };
  if (['txt', 'md'].includes(e)) return { cls: 'txt', txt: 'TXT' };
  return { cls: 'zip', txt: (e || 'FILE').toUpperCase().slice(0, 4) };
}

/** 能否在浏览器里直接预览 / 打印（否则只能下载） */
const PREVIEWABLE = ['pdf', 'img', 'html', 'txt'];
function canPreview(name) { return PREVIEWABLE.includes(fileKind(name).cls); }

const TYPE_NAME = { single: '单选题', multi: '多选题', fill: '填空题' };
const LEVEL_NAME = { basic: '普通', plus: '进阶', vip: '高级' };
const DIFF_NAME = { 1: '入门', 2: '基础', 3: '中等', 4: '较难', 5: '挑战' };

/** 拼接文件下载地址（本地驱动走后端代理，OSS 驱动由后端返回签名地址）
 *  必须带上登录票据：/api/file 已改为需要登录，否则会被拒。 */
function fileUrl(key, name, inline) {
  return '/api/file?key=' + encodeURIComponent(key)
    + '&token=' + encodeURIComponent(Auth.token)
    + (inline ? '&inline=1' : '')
    + (name ? '&name=' + encodeURIComponent(name) : '');
}

/** 给后端下发的「本地文件代理地址」补上登录票据。
 *  后端返回的 src 有时只带 key（如 /api/stu/videos/:id/play）。
 *  <video> / <iframe> 这类标签由浏览器直连发起，加不了 Authorization 头，
 *  票据只能放 URL 里，否则 /api/file 会返回 401，页面表现为「视频放不出来」。
 *  已经带 token 的、以及七牛/OSS 的外链原样返回。 */
function withTicket(url) {
  const u = String(url || '');
  if (u.indexOf('/api/file?') !== 0) return u;
  if (/([?&])token=/.test(u)) return u;
  return u + '&token=' + encodeURIComponent(Auth.token);
}

function downloadUrl(key, name) {
  const a = document.createElement('a');
  a.href = fileUrl(key, name);
  a.download = name || '';
  document.body.appendChild(a); a.click(); a.remove();
}
