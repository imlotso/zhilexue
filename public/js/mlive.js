/* 公式输入（T8）：MathLive 公式编辑框 + 虚拟键盘，学生端和后台共用。
 *
 * MathLive 放在 public/vendor/mathlive/（本地文件，不走 CDN）；它有 840KB，所以第一次点「公式」按钮时才加载，平时不占页面。
 * 用法：
 *   MLive.dialog({ title, latex, delimit: true, onOk(text) })
 *     delimit = true  → 回传 \( … \)（题干 / 选项 / 解析：存进库，学生端 MathJax 渲染）
 *     delimit = false → 回传裸 LaTeX（学生作答：和标准答案按字符串比较，不带分隔符）
 *   MLive.insertAt(el, text)  在 textarea / input 的光标处插入文字并触发 input 事件
 * 公式的渲染仍然是 MathJax（mathlib.js 的 mtxTypeset），这里只负责"输入"。 */
(function () {
  'use strict';
  var BASE = '/vendor/mathlive/';
  var loading = null;
  // MathLive 0.109.2 的简体中文词典遗漏了插入子菜单等文案。
  // 使用库的词典扩展接口，不改供应商代码及公式模板。
  var CHINESE_STRINGS = {
    'tooltip.cut to clipboard': '剪切到剪贴板',
    'tooltip.paste from clipboard': '从剪贴板粘贴',
    'tooltip.menu': '公式菜单',
    'tooltip.toggle virtual keyboard': '切换虚拟键盘',
    'menu.insert': '插入',
    'menu.insert.abs': '绝对值',
    'menu.insert.nth-root': 'n 次根',
    'menu.insert.log-base': '以 a 为底的对数',
    'menu.insert.heading-calculus': '微积分',
    'menu.insert.derivative': '导数',
    'menu.insert.nth-derivative': 'n 阶导数',
    'menu.insert.integral': '积分',
    'menu.insert.sum': '求和',
    'menu.insert.product': '连乘',
    'menu.insert.heading-complex-numbers': '复数',
    'menu.insert.modulus': '模',
    'menu.insert.argument': '辐角',
    'menu.insert.real-part': '实部',
    'menu.insert.imaginary-part': '虚部',
    'menu.insert.conjugate': '共轭',
    'menu.copy-as-typst': '复制为 Typst',
  };

  /** 懒加载 MathLive；失败时 reject，调用方提示"公式键盘加载失败" */
  function load() {
    if (window.MathLive && customElements.get('math-field')) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = BASE + 'mathlive.min.js';
      s.onload = function () {
        try {
          var ME = window.MathLive && window.MathLive.MathfieldElement;
          if (ME) {
            ME.fontsDirectory = BASE + 'fonts';
            ME.soundsDirectory = null;        // 不要按键音（也就不去拉 sounds 文件）
            ME.plonkSound = null; ME.keypressSound = null;
          }
          customElements.whenDefined('math-field').then(resolve, resolve);
        } catch (e) { reject(e); }
      };
      s.onerror = function () { loading = null; reject(new Error('公式键盘加载失败，请检查网络后重试')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** 弹出公式编辑框：上面是 <math-field>（可以直接用键盘敲，也可以点虚拟键盘），下面「插入」 */
  function dialog(opt) {
    opt = opt || {};
    var mask = document.createElement('div');
    mask.className = 't8-mask';
    mask.innerHTML = '<div class="t8-dlg" role="dialog">' +
      '<div class="t8-h"><b>' + esc(opt.title || '输入公式') + '</b><button type="button" class="t8-x" aria-label="关闭">&times;</button></div>' +
      '<p class="t8-tip">' + esc(opt.hint || '点下面的公式框，用屏幕键盘输入分数、根号、上下标等；也可以直接敲键盘。') + '</p>' +
      '<div class="t8-box"><span class="t8-loading">公式键盘加载中…</span></div>' +
      '<div class="t8-f"><button type="button" class="btn ghost t8-cancel">取消</button><button type="button" class="btn primary t8-ok" disabled>插入</button></div>' +
      '</div>';
    document.body.appendChild(mask);
    if (typeof DialogUX !== 'undefined') DialogUX.bind(mask);
    var mf = null, keyboardHost = null;
    function close() {
      try { if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide(); } catch (e) { /* 忽略 */ }
      if (window.mathVirtualKeyboard && window.mathVirtualKeyboard.container === keyboardHost) window.mathVirtualKeyboard.container = document.body;
      mask.remove();
    }
    mask.querySelector('.t8-x').onclick = close;
    mask.querySelector('.t8-cancel').onclick = close;
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    var ok = mask.querySelector('.t8-ok');
    ok.onclick = function () {
      var latex = mf ? String(mf.getValue('latex') || '').trim() : '';
      if (!latex) {
        mask.querySelector('.t8-tip').textContent = '还没有输入公式';
        // 点击插入会移走焦点；空输入时归还给公式框，让屏幕键盘可以继续输入。
        if (mf) mf.focus();
        return;
      }
      close();
      if (opt.onOk) opt.onOk(opt.delimit === false ? latex : '\\(' + latex + '\\)', latex);
    };
    load().then(function () {
      if (!mask.isConnected) return;
      var ME = customElements.get('math-field');
      ME.strings = { 'zh-cn': CHINESE_STRINGS };
      ME.locale = 'zh-cn';
      mf = document.createElement('math-field');
      mf.className = 't8-mf';
      mf.setAttribute('aria-label', '公式输入框');
      mf.setAttribute('math-virtual-keyboard-policy', 'manual');   // 我们自己在下面 show()，不依赖"是不是触屏设备"
      mf.textContent = opt.latex || '';
      var box = mask.querySelector('.t8-box');
      box.innerHTML = '';
      // 库在脚本初始化时缓存了 SVG 名称，切 locale 不会更新它们。
      function localizeControls() {
        var root = mf.shadowRoot;
        if (!root) return;
        [['menu-toggle', '公式菜单'], ['virtual-keyboard-toggle', '切换虚拟键盘']].forEach(function (item) {
          var control = root.querySelector('[part="' + item[0] + '"]');
          if (!control) return;
          control.setAttribute('aria-label', item[1]);
          control.setAttribute('title', item[1]);
          var icon = control.querySelector('svg');
          if (icon) { icon.setAttribute('aria-label', item[1]); icon.setAttribute('aria-hidden', 'true'); }
        });
      }
      mf.addEventListener('mount', localizeControls);
      box.appendChild(mf);
      localizeControls();
      // 放进同一焦点范围，但不参与弹层的横向 flex 布局。
      keyboardHost = document.createElement('div');
      keyboardHost.className = 't8-keyboard-host';
      keyboardHost.style.cssText = 'position:fixed;inset:0;pointer-events:none';
      mask.appendChild(keyboardHost);
      if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.container = keyboardHost;
      ok.disabled = false;
      mf.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok.click(); });
      setTimeout(function () {
        if (!mask.isConnected) return;
        mf.focus();
        try { if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show(); } catch (e) { /* 忽略 */ }
      }, 60);
    }).catch(function (e) {
      mask.querySelector('.t8-box').innerHTML = '<span class="t8-err">' + esc(e.message || '公式键盘加载失败') + '</span>';
    });
    return { close: close };
  }

  /** 在 textarea / input 的光标处插入 text，并触发 input 事件（让页面上的预览 / 状态同步） */
  function insertAt(el, text) {
    if (!el) return;
    var v = el.value || '';
    var s = typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
    var e = typeof el.selectionEnd === 'number' ? el.selectionEnd : s;
    el.value = v.slice(0, s) + text + v.slice(e);
    var p = s + text.length;
    try { el.setSelectionRange(p, p); } catch (err) { /* 忽略 */ }
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  window.MLive = { load: load, dialog: dialog, insertAt: insertAt };
})();
