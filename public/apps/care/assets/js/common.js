/* ============================================================
 * common.js —— 通用能力层
 *   DOM / 日期 / 提示 / 模态框 / 可搜索下拉 / Excel / PDF 导出
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- DOM ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 日期 ---------------- */
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function toISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return toISO(new Date()); }
  function parse(s) {
    if (!s) return null;
    var p = String(s).split('-');
    if (p.length < 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(s, n) {
    var d = parse(s) || new Date();
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function weekday(s) {
    var d = parse(s);
    return d ? WEEK[d.getDay()] : '';
  }
  function fmtCN(s) {
    var d = parse(s);
    if (!d) return '—';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function monthPrefix() { return today().slice(0, 7); }
  /** 距今天数：正数为未来，负数为已过去 */
  function diffDays(s) {
    var d = parse(s);
    if (!d) return NaN;
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var b = new Date();
    b = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((a - b) / 86400000);
  }

  /* ---------------- Toast ---------------- */
  var toastBox = null;
  function toast(msg, type) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.id = 'toastBox';
      document.body.appendChild(toastBox);
    }
    var t = document.createElement('div');
    t.setAttribute('role', type === 'err' ? 'alert' : 'status');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, 2400);
  }

  /* ---------------- 模态框 ---------------- */
  /**
   * openModal({title, bodyHTML, wide, buttons:[{text,cls,onClick(ctx)}]})
   * onClick 返回 false 时不关闭；ctx = {el, close}
   */
  function openModal(opts) {
    var root = document.getElementById('modalRoot');
    [...root.children].forEach(function (old) { if (old.closeModal) old.closeModal(); else old.remove(); });
    var returnFocus = document.activeElement;
    var mask = document.createElement('div');
    mask.className = 'mask';
    var modal = document.createElement('div');
    modal.className = 'modal sy-dialog' + (opts.wide ? ' wide' : '');
    var titleId = 'care-dialog-title-' + (openModal.sequence = (openModal.sequence || 0) + 1);
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal.tabIndex = -1;
    modal.innerHTML = '<div class="modal-head"><div class="modal-title" id="' + titleId + '">' + esc(opts.title || '') + '</div>' +
      '<button class="modal-close" type="button" aria-label="关闭">&times;</button></div>' +
      '<div class="modal-body">' + (opts.bodyHTML || '') + '</div>';
    var closed = false, busy = false;
    var ctx = { el: modal, close: function () { close(true); } };
    var buttons = opts.buttons || [];
    if (buttons.length) {
      var foot = document.createElement('div'); foot.className = 'modal-foot';
      buttons.forEach(function (b) {
        var btn = document.createElement('button'); btn.type = 'button';
        btn.className = b.cls || 'btn'; btn.textContent = b.text;
        btn.addEventListener('click', function () {
          if (busy || closed) return;
          try {
            var result = typeof b.onClick === 'function' ? b.onClick(ctx) : undefined;
            if (result && typeof result.then === 'function') {
              busy = true;
              var states = Array.from(modal.querySelectorAll('.modal-foot button, .modal-close')).map(function (el) { return [el, el.disabled]; });
              states.forEach(function (pair) { pair[0].disabled = true; });
              btn.setAttribute('aria-busy', 'true'); modal.setAttribute('aria-busy', 'true'); btn.textContent = '保存中…';
              function restore() {
                busy = false;
                states.forEach(function (pair) { pair[0].disabled = pair[1]; });
                btn.removeAttribute('aria-busy'); modal.removeAttribute('aria-busy'); btn.textContent = b.text;
              }
              Promise.resolve(result).then(function (value) {
                if (closed) return;
                restore(); if (value !== false) close();
              }, function (e) {
                if (closed) return;
                restore(); toast(e.message || '保存失败，请重试；当前内容仍保留', 'err');
              });
            } else if (result !== false) close();
          } catch (e) { toast(e.message || '保存失败，请重试；当前内容仍保留', 'err'); }
        });
        foot.appendChild(btn);
      });
      modal.appendChild(foot);
    }
    function close(force) {
      if (closed || (busy && !force)) return;
      closed = true; mask.remove(); document.removeEventListener('keydown', onKey);
      if (typeof opts.onClose === 'function') opts.onClose();
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
    }
    mask.closeModal = function () { close(true); };
    function focusable() {
      return Array.from(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')).filter(function (el) {
        return !el.disabled && el.type !== 'hidden' && el.tabIndex >= 0 && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';
      });
    }
    function onKey(e) {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        var items = focusable(), first = items[0], last = items[items.length - 1];
        if (!items.length) { e.preventDefault(); modal.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    }
    modal.querySelector('.modal-close').addEventListener('click', function () { close(); });
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    mask.appendChild(modal); root.appendChild(mask);
    Promise.resolve().then(function () {
      if (closed) return;
      var items = focusable();
      var target = items.find(function (el) { return el.hasAttribute('autofocus'); }) || items.find(function (el) { return el.matches('input, select, textarea'); }) || items[0] || modal;
      target.focus();
    });
    return ctx;
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      openModal({
        title: opts.title || '确认操作',
        bodyHTML: '<div style="line-height:1.8">' + esc(opts.message || '') + '</div>',
        buttons: [
          { text: '取消', cls: 'btn', onClick: function () { resolve(false); } },
          { text: opts.okText || '确认', cls: 'btn btn-danger', onClick: function () { resolve(true); } }
        ]
      });
    });
  }

  function alert(opts) {
    openModal({
      title: opts.title || '提示',
      bodyHTML: '<div style="line-height:1.8">' + (opts.html || esc(opts.message || '')) + '</div>',
      buttons: [{ text: '知道了', cls: 'btn btn-primary' }]
    });
  }

  /* ---------------- 可搜索下拉 ---------------- */
  /**
   * combo({placeholder, options:[{value,label,sub}], onChange})
   * 返回 {el, getValue, setValue, setOptions, input}
   */
  function combo(cfg) {
    var wrap = document.createElement('div'); wrap.className = 'combo';
    var input = document.createElement('input'); input.type = 'text';
    input.className = 'input combo-input sy-input'; input.autocomplete = 'off';
    input.placeholder = cfg.placeholder || '请选择';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    var list = document.createElement('div'); list.className = 'combo-list';
    list.id = 'care-combo-' + (combo.sequence = (combo.sequence || 0) + 1);
    list.setAttribute('role', 'listbox'); input.setAttribute('aria-controls', list.id);
    wrap.appendChild(input); wrap.appendChild(list);
    var options = cfg.options || [], value = '', cb = cfg.onChange || null, hit = [], active = -1;
    function close() { list.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function highlight() {
      $$('.combo-opt', list).forEach(function (node, index) { node.classList.toggle('sel', index === active); });
      var current = list.children[active];
      if (current && active >= 0) { input.setAttribute('aria-activedescendant', current.id); if (current.scrollIntoView) current.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function render(keyword) {
      var kw = (keyword || '').trim().toLowerCase();
      hit = options.filter(function (o) { return !kw || (o.label + ' ' + (o.sub || '') + ' ' + o.value).toLowerCase().indexOf(kw) >= 0; });
      active = -1;
      list.innerHTML = hit.length ? hit.map(function (o, i) {
        return '<div class="combo-opt" role="option" id="' + list.id + '-' + i + '" aria-selected="' + (o.value === value) + '" data-i="' + i + '">' + esc(o.label) + (o.sub ? '<span class="opt-sub">' + esc(o.sub) + '</span>' : '') + '</div>';
      }).join('') : '<div class="combo-empty" role="status">未找到匹配项</div>';
      $$('.combo-opt', list).forEach(function (node) { node.addEventListener('mousedown', function (e) { e.preventDefault(); pick(hit[+node.dataset.i]); }); });
    }
    function open() { render(value ? '' : input.value); list.classList.add('open'); input.setAttribute('aria-expanded', 'true'); }
    function pick(o) { if (!o) return; value = o.value; input.value = o.label; close(); fieldError(input, ''); if (cb) cb(value, o); }
    input.addEventListener('focus', open);
    input.addEventListener('input', function () { value = ''; fieldError(input, ''); open(); if (cb) cb('', null); });
    input.addEventListener('blur', function () { setTimeout(function () { close(); var cur = options.find(function (o) { return o.value === value; }); if (cur) input.value = cur.label; }, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!list.classList.contains('open')) open();
        if (hit.length) { active = e.key === 'ArrowDown' ? Math.min(active + 1, hit.length - 1) : (active < 0 ? hit.length - 1 : Math.max(active - 1, 0)); highlight(); }
      } else if (e.key === 'Enter' && list.classList.contains('open') && active >= 0) { e.preventDefault(); pick(hit[active]); }
      else if (e.key === 'Escape' && list.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') close();
    });
    return {
      el: wrap, input: input, getValue: function () { return value; },
      setValue: function (v, silent) { value = v || ''; var cur = options.find(function (o) { return o.value === value; }); input.value = cur ? cur.label : ''; close(); if (!silent && cb) cb(value, cur || null); },
      setOptions: function (list2) { options = list2 || []; var cur = options.find(function (o) { return o.value === value; }); input.value = cur ? cur.label : ''; if (!cur) value = ''; if (list.classList.contains('open')) open(); }
    };
  }

  function fieldError(input, message) {
    var errorId = input.id ? input.id + '-error' : (input.id = 'care-field-' + (fieldError.sequence = (fieldError.sequence || 0) + 1)) + '-error';
    var error = document.getElementById(errorId);
    if (!message) {
      input.removeAttribute('aria-invalid');
      var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) { return id && id !== errorId; });
      if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
      if (error) error.remove(); return;
    }
    input.setAttribute('aria-invalid', 'true');
    var described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (described.indexOf(errorId) < 0) described.push(errorId); input.setAttribute('aria-describedby', described.join(' '));
    if (!error) { error = document.createElement('div'); error.id = errorId; error.className = 'sy-field-error'; error.setAttribute('role', 'alert'); input.parentNode.appendChild(error); }
    error.textContent = message; input.focus();
  }

  /* ---------------- 下载 / 导出 ---------------- */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function safeName(s) { return (s || '导出').replace(/[\\\/:\[\]?*"]/g, '_'); }

  /**
   * 导出 Excel
   * columns: [{key, title, width}]
   * rows: 数据对象数组（支持函数取值）
   */
  function exportXlsx(cfg) {
    var columns = cfg.columns;
    var rows = cfg.rows;
    var data = [columns.map(function (c) { return c.title; })];
    rows.forEach(function (r) {
      data.push(columns.map(function (c) {
        return typeof c.get === 'function' ? c.get(r) : r[c.key];
      }));
    });
    var widths = columns.map(function (c) { return c.width || 18; });
    var blob = global.XlsxWriter.build(cfg.sheet || '数据', data, widths);
    download(blob, safeName(cfg.filename) + '.xlsx');
    return rows.length;
  }

  /**
   * 导出 PDF：生成排版好的打印视图并调起打印（选择「另存为 PDF」）
   * 原因：中文字体嵌入 PDF 需数 MB 字体文件，打印导出可保证中文矢量清晰且不依赖网络
   */
  function exportPdf(cfg) {
    var columns = cfg.columns;
    var rows = cfg.rows;

    var meta = [];
    (cfg.filters || []).forEach(function (f) { meta.push(esc(f)); });
    meta.push('导出时间：' + fmtCN(today()) + ' ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));

    var html = '<div class="pr-head">' +
      '<div class="pr-title">' + esc(cfg.title) + '</div>' +
      '<div class="pr-meta">' + meta.join('　|　') + '　|　共 ' + rows.length + ' 条记录</div>' +
      '</div>';

    if (!rows.length) {
      html += '<div class="pr-meta">当前筛选条件下没有记录。</div>';
    } else {
      html += '<table class="pr-table">' +
        '<colgroup><col style="width:40px">' +
        columns.map(function (c) { return '<col style="width:' + (c.pw || 0) + '%">'; }).join('') +
        '</colgroup>' +
        '<thead><tr><th>#</th>' +
        columns.map(function (c) { return '<th>' + esc(c.title) + '</th>'; }).join('') +
        '</tr></thead><tbody>';

      rows.forEach(function (r, i) {
        html += '<tr><td>' + (i + 1) + '</td>' + columns.map(function (c) {
          var v = typeof c.get === 'function' ? c.get(r) : r[c.key];
          return '<td>' + (v == null || v === '' ? '—' : esc(v)) + '</td>';
        }).join('') + '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="pr-foot">本文档由班主任工作台生成 · 数据来源：本机记录</div>';

    var root = document.getElementById('printRoot');
    root.innerHTML = html;

    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      root.innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60000);

    toast('已生成 PDF 预览，在打印对话框中选择「另存为 PDF」');
    setTimeout(function () { window.print(); }, 260);
    return rows.length;
  }

  /* ---------------- 录音文件上传（谈心谈话 / 家校沟通共用） ---------------- */
  function uploadAudio(file) {
    var fd = new FormData();
    fd.append('file', file, file.name || 'rec.webm');
    var tk = '';
    try { tk = localStorage.getItem('xuexi_admin_token') || localStorage.getItem('xuexi_token') || ''; } catch (e) { /* 忽略 */ }
    return fetch('/api/admin/upload-audio', {
      method: 'POST',
      body: fd,
      headers: tk ? { Authorization: 'Bearer ' + tk } : {}
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.code !== 0 || !j.data || !j.data.url) throw new Error((j && j.msg) || '上传失败');
      return j.data;   // { url, name, size }
    });
  }

  function audioToken() {
    try { return localStorage.getItem('xuexi_admin_token') || localStorage.getItem('xuexi_token') || ''; }
    catch (e) { return ''; }
  }

  /* 仅向同源、受保护的录音路由发送认证头。旧地址只作服务器映射键，绝不据此认领归属。 */
  function loadAudio(value, signal) {
    return Promise.resolve().then(function () {
      var url;
      try { url = new URL(String(value || ''), global.location.href); } catch (e) { /* 下方统一提示 */ }
      if (!url || url.origin !== global.location.origin || url.username || url.password || url.search || url.hash ||
          !(/^\/api\/admin\/care-audio\/[a-f0-9]{32}$/.test(url.pathname) ||
            /^\/uploads\/audio\/[A-Za-z0-9_-]+\.(webm|mp3|m4a|wav|ogg|aac|amr)$/i.test(url.pathname))) {
        throw new Error('此录音链接归属待核对，请联系管理员；原记录仍保留');
      }
      var tk = audioToken();
      if (!tk) throw new Error('请先登录后收听录音');
      return fetch(url.pathname, {
        headers: { Authorization: 'Bearer ' + tk }, credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', signal: signal
      }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.msg || '录音暂不可用，请确认登录状态或联系管理员核对归属');
        });
        if (!/^audio\//i.test(r.headers.get('Content-Type') || '')) throw new Error('录音响应格式无效');
        return r.blob();
      }).then(function (blob) {
        if (tk !== audioToken()) throw new Error('登录状态已变化，请重新打开录音');
        return blob;
      });
    });
  }

  /* 列表/详情共用；弹窗关闭、替换或离开页面时撤销 blob，并中止尚未完成的请求。 */
  function playAudio(url, title) {
    var objectUrl = '', closed = false;
    var controller = new AbortController();
    var player;
    function cleanup() {
      if (closed) return;
      closed = true; controller.abort();
      if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
      global.removeEventListener('pagehide', cleanup);
      global.removeEventListener('storage', onStorage);
    }
    function onStorage(e) {
      if (!e.key || e.key === 'xuexi_admin_token' || e.key === 'xuexi_token') ctx.close();
    }
    var ctx = openModal({
      title: title || '收听录音',
      bodyHTML: '<div class="audio-status" role="status">正在安全加载录音…</div>' +
        '<audio controls style="width:100%;margin-top:4px" hidden></audio>',
      buttons: [{ text: '关闭', cls: 'btn btn-primary' }],
      onClose: cleanup
    });
    player = $('audio', ctx.el);
    global.addEventListener('pagehide', cleanup);
    global.addEventListener('storage', onStorage);
    loadAudio(url, controller.signal).then(function (blob) {
      if (closed) return;
      objectUrl = URL.createObjectURL(blob);
      player.src = objectUrl; player.hidden = false;
      $('.audio-status', ctx.el).textContent = '录音仅对当前获授权账号开放。';
      player.play().catch(function () { /* 浏览器禁止自动播放时保留手动播放按钮 */ });
    }).catch(function (e) {
      if (!closed) $('.audio-status', ctx.el).textContent = e.message || '录音加载失败，请重试';
    });
  }

  global.App = global.App || {};
  global.App.ui = {
    $: $, $$: $$, esc: esc,
    today: today, parse: parse, addDays: addDays, weekday: weekday, fmtCN: fmtCN,
    monthPrefix: monthPrefix, diffDays: diffDays,
    toast: toast, fieldError: fieldError, modal: openModal, confirm: confirm, alert: alert, combo: combo,
    download: download, exportXlsx: exportXlsx, exportPdf: exportPdf,
    safeName: safeName,
    uploadAudio: uploadAudio, playAudio: playAudio, loadAudio: loadAudio
  };
})(window);
