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
    /* 防止连点叠加：打开新弹窗前先关闭已有弹窗 */
    var root = document.getElementById('modalRoot');
    [...root.children].forEach(function (old) { old.remove(); });
    var mask = document.createElement('div');
    mask.className = 'mask';

    var modal = document.createElement('div');
    modal.className = 'modal' + (opts.wide ? ' wide' : '');

    modal.innerHTML =
      '<div class="modal-head">' +
      '<div class="modal-title">' + esc(opts.title || '') + '</div>' +
      '<button class="modal-close" type="button" aria-label="关闭">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.bodyHTML || '') + '</div>';

    var ctx = {
      el: modal,
      close: function () { close(); }
    };

    var buttons = opts.buttons || [];
    if (buttons.length) {
      var foot = document.createElement('div');
      foot.className = 'modal-foot';
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b.cls || 'btn';
        btn.textContent = b.text;
        btn.addEventListener('click', function () {
          var keep = false;
          if (typeof b.onClick === 'function') keep = b.onClick(ctx) === false;
          if (!keep) close();
        });
        foot.appendChild(btn);
      });
      modal.appendChild(foot);
    }

    function close() { mask.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    modal.querySelector('.modal-close').addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    mask.appendChild(modal);
    document.getElementById('modalRoot').appendChild(mask);
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
    var wrap = document.createElement('div');
    wrap.className = 'combo';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'input combo-input';
    input.autocomplete = 'off';
    input.placeholder = cfg.placeholder || '请选择';

    var list = document.createElement('div');
    list.className = 'combo-list';

    wrap.appendChild(input);
    wrap.appendChild(list);

    var options = cfg.options || [];
    var value = '';
    var cb = cfg.onChange || null;

    function open() { render(input.value); list.classList.add('open'); }
    function close() { list.classList.remove('open'); }

    function render(keyword) {
      var kw = (keyword || '').trim().toLowerCase();
      var hit = options.filter(function (o) {
        if (!kw) return true;
        return (o.label + ' ' + (o.sub || '') + ' ' + o.value).toLowerCase().indexOf(kw) >= 0;
      });
      if (!hit.length) {
        list.innerHTML = '<div class="combo-empty">未找到匹配项</div>';
        return;
      }
      list.innerHTML = hit.map(function (o, i) {
        return '<div class="combo-opt" data-i="' + i + '">' + esc(o.label) +
          (o.sub ? '<span class="opt-sub">' + esc(o.sub) + '</span>' : '') + '</div>';
      }).join('');
      $$('.combo-opt', list).forEach(function (node) {
        node.addEventListener('mousedown', function (e) {
          e.preventDefault();
          pick(hit[+node.dataset.i]);
        });
      });
    }

    function pick(o) {
      value = o.value;
      input.value = o.label;
      close();
      if (cb) cb(value, o);
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', function () {
      value = '';
      open();
      if (cb) cb('', null);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        close();
        var cur = options.filter(function (o) { return o.value === value; })[0];
        if (cur) input.value = cur.label;
      }, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); }
    });

    return {
      el: wrap,
      input: input,
      getValue: function () { return value; },
      setValue: function (v, silent) {
        value = v || '';
        var cur = options.filter(function (o) { return o.value === value; })[0];
        input.value = cur ? cur.label : '';
        if (!silent && cb) cb(value, cur || null);
      },
      setOptions: function (list2) {
        options = list2 || [];
        if (value) {
          var cur = options.filter(function (o) { return o.value === value; })[0];
          input.value = cur ? cur.label : '';
          if (!cur) value = '';
        }
      }
    };
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

  /* 录音播放弹窗：列表/详情共用 */
  function playAudio(url, title) {
    openModal({
      title: title || '收听录音',
      bodyHTML: '<audio controls autoplay style="width:100%;margin-top:4px" src="' + esc(url) + '"></audio>' +
        '<div class="small" style="color:var(--txt-3);margin-top:6px">若浏览器无法播放，请下载后使用本地播放器收听。</div>',
      buttons: [{ text: '关闭', cls: 'btn btn-primary' }]
    });
  }

  global.App = global.App || {};
  global.App.ui = {
    $: $, $$: $$, esc: esc,
    today: today, parse: parse, addDays: addDays, weekday: weekday, fmtCN: fmtCN,
    monthPrefix: monthPrefix, diffDays: diffDays,
    toast: toast, modal: openModal, confirm: confirm, alert: alert, combo: combo,
    download: download, exportXlsx: exportXlsx, exportPdf: exportPdf,
    safeName: safeName,
    uploadAudio: uploadAudio, playAudio: playAudio
  };
})(window);
