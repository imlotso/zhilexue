/* 魔方采集注入脚本（经代理注入到组卷网/菁优网/二一页面；页面跑在 sandbox 的 iframe 里，没有 allow-same-origin，
 * 是「不透明源」——读不到后台的 localStorage / 令牌，也访问不到 parent.document；与父页面只靠 postMessage 通信）
 * 由 /api/mfproxy/inject.js 提供；配置读 window.__MFPROXY__（代理 HTML 注入的引导变量）。
 * 功能：XHR/fetch 代理补丁、悬浮工具栏、试题篮/选中采集、组卷网知识树解析回传。
 */
(function () {
  'use strict';
  if (window.__MF_INJECT__) return;
  window.__MF_INJECT__ = true;
  var CFG = window.__MFPROXY__ || {};
  var API = CFG.api || '/api/mfproxy';
  var CAP = CFG.capture || '';
  var PAGE = CFG.page || location.href;

  /* ---------- 0. 沙箱适配（R0-B5） ----------
   * 去掉 allow-same-origin 后，站点自己的脚本读 localStorage / sessionStorage / document.cookie 会抛 SecurityError，
   * 页面会因此白屏。这里在站点脚本之前补上内存版实现；cookie 仍会同步进服务器 jar（见下面 syncCookies）。 */
  function memStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[String(k)] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = {}; },
      key: function (i) { return Object.keys(m)[i] || null; },
      get length() { return Object.keys(m).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (nm) {
    try { void window[nm]; } catch (e) {
      try { Object.defineProperty(window, nm, { value: memStorage(), configurable: true }); } catch (e2) { /* 忽略 */ }
    }
  });
  var CK_SHIM = false;
  try { void document.cookie; } catch (e) { CK_SHIM = true; }
  var MEM_CK = {};
  /** 站点请求一律不带凭据（代理靠 URL 里的票据鉴权，不需要 Cookie；CORS 也没有开 Allow-Credentials） */
  try { Object.defineProperty(XMLHttpRequest.prototype, 'withCredentials', { get: function () { return false; }, set: function () {}, configurable: true }); } catch (e) { /* 忽略 */ }
  /** 告诉外层后台「现在在看哪个真实网址」（外层读不到 iframe 的 location 了） */
  function notifyParent(msg) { try { msg.mfp = 1; window.parent.postMessage(msg, '*'); } catch (e) { /* 忽略 */ } }
  notifyParent({ type: 'page', url: PAGE });

  /* ---------- 1. XHR / fetch 代理补丁：站点自己的相对请求也走代理 ---------- */
  function toProxy(u) {
    try {
      if (!u) return u;
      var s = String(u);
      if (/^(data:|blob:|javascript:|mailto:|about:)/i.test(s)) return s;
      if (s.indexOf(API) === 0 || s.indexOf('/api/') === 0) return s; // 我们自己的接口不动
      var abs = new URL(s, PAGE).href;
      if (!/^https?:/i.test(abs)) return s;
      if (abs.indexOf(location.origin) === 0 && s.indexOf(API) !== 0 && s.indexOf('/api/') !== 0) {
        // 站点 JS 生成了指回本代理源的绝对地址（用站点域名拼的）→ 不动
        if (s.indexOf(location.host) >= 0) return s;
      }
      return API + '?k=' + encodeURIComponent(CFG.k || '') + '&u=' + encodeURIComponent(abs);
    } catch (e) { return u; }
  }
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, u) {
    var args = [].slice.call(arguments);
    args[1] = toProxy(u);
    return _open.apply(this, args);
  };
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (typeof input === 'string') return _fetch.call(window, toProxy(input), Object.assign({}, init || {}, { credentials: 'omit' }));
      if (input && input.url) return _fetch.call(window, Object.assign({}, input, { url: toProxy(input.url) }), init);
    } catch (e) { /* 落回原样 */ }
    return _fetch.apply(window, arguments);
  };

  /* ---------- 1.5 链接留在代理内：点 <a> 一律在当前 iframe 内跳转，绝不弹新标签/顶出外层 ---------- */
  // window.open → 在本框内打开（代理化）
  try {
    var _openWin = window.open;
    window.open = function (u) {
      try { if (u) location.href = toProxy(u); } catch (e) { /* 忽略 */ }
      return null;
    };
  } catch (e) { /* 忽略 */ }
  // 捕获阶段拦点击：target=_blank / _top / JS 改写的链接都拉回本框内跳
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^(javascript:|#|mailto:|tel:)/i.test(href.trim()) || href.trim() === '') return;
    e.preventDefault();
    e.stopPropagation();
    try {
      var abs = new URL(href, PAGE).href;
      if (!/^https?:/i.test(abs)) return;
      location.href = toProxy(abs);
    } catch (err) { /* 忽略 */ }
  }, true);
  // 周期性摘掉 target=_blank/_top/_parent（JS 动态插入的链接也有）
  setInterval(function () {
    try {
      var els = document.querySelectorAll('a[target], form[target]');
      for (var i = 0; i < els.length; i++) els[i].removeAttribute('target');
    } catch (e) { /* 忽略 */ }
  }, 1200);
  // 表单一律本框提交（action 已被服务端重写）
  document.addEventListener('submit', function (e) {
    try { e.target.setAttribute('target', '_self'); } catch (err) { /* 忽略 */ }
  }, true);

  /* cookie 回传：站点 JS 写的 cookie（如反爬挑战算出来的通行证）要同步进服务器 jar */
  var CK_BASE = (API || '/api/mfproxy/r').replace(/\/r$/, ''); // /api/mfproxy —— /ck 挂在代理根上，不能拼到 /r 后面
  function syncCookies(syncMode) {
    try {
      if (!document.cookie || !CFG.k) return;
      var url = CK_BASE + '/ck?k=' + encodeURIComponent(CFG.k) + '&u=' + encodeURIComponent(PAGE) + '&c=' + encodeURIComponent(document.cookie);
      if (syncMode === false) {
        // 同步模式：挑战页写完 cookie 会立刻 location.reload(true)，
        // 异步请求来不及发出就被导航取消，必须用同步 XHR 抢在 reload 前送到
        var x = new XMLHttpRequest();
        x.open('GET', url, false);
        try { x.send(); } catch (e2) { /* 忽略 */ }
      } else {
        new Image().src = url;
      }
    } catch (e) { /* 忽略 */ }
  }
  setInterval(function () { syncCookies(true); }, 3000);
  setTimeout(function () { syncCookies(true); }, 300);
  // 钩住 document.cookie 写入：挑战页设置完 cookie 往往立刻 reload，必须抢在前面回传
  if (CK_SHIM) {
    try {
      Object.defineProperty(document, 'cookie', {
        get: function () { return Object.keys(MEM_CK).map(function (k) { return k + '=' + MEM_CK[k]; }).join('; '); },
        set: function (v) {
          var parts = String(v).split(';'); var kv = parts[0]; var eq = kv.indexOf('=');
          if (eq > 0) {
            var name = kv.slice(0, eq).trim(), val = kv.slice(eq + 1).trim(), gone = false;
            parts.slice(1).forEach(function (a) {
              var p = a.trim().toLowerCase();
              if (p.indexOf('max-age=') === 0 && Number(p.slice(8)) <= 0) gone = true;
              if (p.indexOf('expires=') === 0 && Date.parse(a.trim().slice(8)) < Date.now()) gone = true;
            });
            if (gone) delete MEM_CK[name]; else MEM_CK[name] = val;
          }
          syncCookies(false);
        },
        configurable: true
      });
    } catch (e) { /* 忽略 */ }
  }
  try {
    var d = Document.prototype;
    var cDesc = CK_SHIM ? null : Object.getOwnPropertyDescriptor(d, 'cookie');
    if (cDesc && cDesc.set) {
      Object.defineProperty(document, 'cookie', {
        get: function () { return cDesc.get.call(document); },
        set: function (v) { cDesc.set.call(document, v); syncCookies(false); },
        configurable: true,
      });
    }
  } catch (e) { /* 忽略 */ }

  /* ---------- 2. 工具 ---------- */
  function txt(el) { return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; }
  function md5(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16); }
  function realHost() {
    // 代理模式下 location.hostname 是我们自己的服务器，站点必须从真实页面地址（CFG.page）判断
    try { return new URL(PAGE, location.href).hostname || ''; } catch (e) { return location.hostname || ''; }
  }
  function site() {
    var h = realHost();
    return h.indexOf('xkw.com') >= 0 ? 'zujuan' : (h.indexOf('jyeoo.com') >= 0 ? 'jyeoo' : (h.indexOf('21cnjy') >= 0 ? '21cnjy' : 'generic'));
  }
  var SITE_NAME = { zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一组卷网', generic: '网页' };

  var basket = []; // {questionId,stem,options,type,difficulty,knowledge,answer,analysis,checked}

  /* ---------- 3. 站点适配抽题 ---------- */
  function pickZujuan() {
    var qs = [];
    // 试题页两套结构：.tk-quest-item[questionid]（试卷详情/试题篮）和 .exam-item（组卷页）
    document.querySelectorAll('.tk-quest-item[questionid],.quest-basket .mini-quest-item,.quest-basket .tk-mini-quest,.exam-item').forEach(function (el, i) {
      var qid = el.getAttribute('questionid') || el.getAttribute('data-questionid') || ('zj-' + md5(txt(el)).slice(0, 8));
      var stem = txt(el.querySelector('.exam-item__cnt')) || txt(el.querySelector('.quest-cont')) || txt(el);
      if (!stem || stem.length < 4) return;
      var opts = [];
      el.querySelectorAll('.option,.selectoption,.exam-item__opt,.exam-item__option td').forEach(function (o) {
        var t = txt(o); if (t) opts.push(t.replace(/^[A-E][.、．]\s*/, ''));
      });
      qs.push({
        questionId: String(qid), stem: stem, options: opts.slice(0, 6),
        type: txt(el.querySelector('.ques-type')) || '',
        difficulty: txt(el.querySelector('.ques-hard')) || '',
        knowledge: [].slice.call(el.querySelectorAll('.knowledge-name')).map(txt).filter(Boolean),
        answer: '', analysis: '', checked: true
      });
    });
    return qs;
  }
  function pickJyeoo() {
    var qs = [];
    document.querySelectorAll('fieldset.quesborder,.ques-basket .basket-list fieldset').forEach(function (el, i) {
      var p1 = el.querySelector('.pt1'); if (!p1) return;
      var clone = p1.cloneNode(true);
      clone.querySelectorAll('.qseq,.ques-source,.sanwser').forEach(function (n) { n.remove(); });
      var stem = txt(clone); if (!stem || stem.length < 4) return;
      var opts = [];
      el.querySelectorAll('.pt2 td.selectoption label,.pt2 label').forEach(function (o) {
        var t = txt(o); if (t) opts.push(t.replace(/^[A-E][.、．]\s*/, ''));
      });
      qs.push({ questionId: 'jyeoo-' + md5(stem + opts.join('')), stem: stem, options: opts.slice(0, 6), type: '', difficulty: '', knowledge: [], answer: '', analysis: '', checked: true });
    });
    return qs;
  }
  function pickGeneric() {
    var qs = [];
    var sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel && sel.length > 10) qs.push({ questionId: 'sel-' + md5(sel).slice(0, 12), stem: sel, options: [], type: '', difficulty: '', knowledge: [], answer: '', analysis: '', checked: true });
    return qs;
  }
  function pickAll() {
    var s = site();
    var qs = s === 'zujuan' ? pickZujuan() : s === 'jyeoo' ? pickJyeoo() : [];
    if (!qs.length) qs = pickGeneric();
    // 去重（按 questionId / 题干）
    var seen = {};
    basket.forEach(function (q) { seen[q.questionId] = 1; });
    var added = 0;
    qs.forEach(function (q) { if (!seen[q.questionId]) { basket.push(q); seen[q.questionId] = 1; added++; } });
    return added;
  }

  /* ---------- 4. 组卷网知识树解析（对齐魔方 tree-collect：li[tree-id] 嵌套，data-tree-type=1 主树） ---------- */
  function parseZujuanTree() {
    var rootEl = document.querySelector('.tk-tree[tree-id]');
    if (!rootEl) return null;
    var rootId = rootEl.getAttribute('tree-id') || '';
    var nodes = [];
    var seen = {};
    function walk(ul, parentKey) {
      var sort = 0;
      [].slice.call(ul.children).forEach(function (li) {
        if (li.tagName !== 'LI') return;
        var id = li.getAttribute('tree-id');
        var type = li.getAttribute('data-tree-type');
        var label = li.querySelector(':scope > .tree-label, :scope > div, :scope > span');
        var name = txt(label || li).slice(0, 60);
        if (!id || seen[id] || !name) { /* 辅树/重复节点跳过 */ }
        else if (String(type) === '1' || type == null) {
          seen[id] = 1;
          nodes.push({ site_node_id: id, name: name.replace(/\(\d+\)\s*$/, ''), parent_site_node_id: parentKey, sort: sort });
        }
        sort++;
        [].slice.call(li.children).forEach(function (c) { if (c.tagName === 'UL') walk(c, id || parentKey); });
      });
    }
    [].slice.call(rootEl.children).forEach(function (c) { if (c.tagName === 'UL') walk(c, null); });
    // 主体学科/学段推断：面包屑或页标题
    var subject = '', stage = '';
    var crumb = txt(document.querySelector('.crumb, .breadcrumb, .location'));
    var m = /(初中|高中|小学)/.exec(crumb + document.title); if (m) stage = m[1];
    var sub = /(语文|数学|英语|物理|化学|生物|历史|地理|政治|科学)/.exec(crumb + document.title); if (sub) subject = sub[1];
    var rootEl2 = document.querySelector('.tk-tree[tree-id] li[tree-id="' + rootId + '"]');
    var rootTxt = txt(rootEl2) || document.title.replace(/_组卷网.*$/, '').replace(/组卷网/, '').trim();
    var rootName = ('组卷网·' + (subject || '') + (rootTxt ? '·' + rootTxt.slice(0, 20) : '')).slice(0, 50);
    return { site: 'zujuan', root_id: rootId, root_name: rootName, nodes: nodes, stage: stage, subject: subject };
  }

  /* ---------- 5. 回传 ---------- */
  function pushQuestions(list) {
    var payload = { site: site(), url: PAGE, title: document.title.slice(0, 80), questions: list };
    return fetch('/api/mfcap/push?token=' + encodeURIComponent(CAP), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  function pushTree(stage, subject) {
    var t = parseZujuanTree();
    if (!t || !t.nodes.length) return Promise.resolve({ code: 1, msg: '这一页不是组卷网知识点树页面（找不到 .tk-tree）' });
    // R0-B7：学段 + 学科以老师在悬浮球里选的为准（页面推断的只当默认值）；缺一个都不回传，后端也会拒绝
    t.stage = stage; t.subject = subject;
    if (!t.stage || !t.subject) return Promise.resolve({ code: 1, msg: '请先选好学段和学科再采集知识树' });
    return fetch('/api/mfcap/tree-push?token=' + encodeURIComponent(CAP), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t)
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 6. 悬浮工具栏 ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '#mfbar{position:fixed;right:16px;top:10px;z-index:2147483600;font-family:system-ui,sans-serif}',
    '#mfbar .mfbar-main{display:flex;flex-direction:column;gap:6px;align-items:flex-end}',
    '#mfbar button{all:unset;cursor:pointer;background:#4f46e5;color:#fff;font-size:13px;padding:8px 14px;border-radius:20px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:block}',
    '#mfbar button.mf-ghost{background:#fff;color:#4f46e5;border:1px solid #c7d2fe}',
    '#mfbar button:hover{filter:brightness(1.08)}',
    '#mfbar .mf-panel{background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:12px;width:300px;max-height:50vh;display:flex;flex-direction:column;gap:8px}',
    '#mfbar .mf-panel h4{margin:0;font-size:14px;color:#1e293b}',
    '#mfbar .mf-qlist{overflow:auto;max-height:32vh;display:flex;flex-direction:column;gap:6px}',
    '#mfbar .mf-qi{border:1px solid #e2e8f0;border-radius:8px;padding:6px;font-size:12px;color:#334155;display:flex;gap:6px;align-items:flex-start}',
    '#mfbar .mf-qi span{flex:1;max-height:52px;overflow:hidden}',
    '#mfbar .mf-treesel{display:none;gap:6px}',
    '#mfbar .mf-treesel select{all:revert;flex:1;font-size:12px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1e293b}',
    '#mfbar .mf-msg{font-size:12px;color:#059669;min-height:16px}',
    '#mfbar .mf-msg.err{color:#dc2626}'
  ].join('\n');
  document.addEventListener('DOMContentLoaded', build);
  if (document.readyState !== 'loading') build();
  // SPA 框架可能在挂载时清掉 body 重建 DOM，悬浮球被吞掉后要自动补回来
  setInterval(function () {
    try { if (document.body && !document.getElementById('mfbar')) build(); } catch (e) { /* 忽略 */ }
  }, 2000);

  function build() {
    if (document.getElementById('mfbar')) return;
    document.head.appendChild(css);
    var bar = document.createElement('div');
    bar.id = 'mfbar';
    bar.innerHTML = '<div class="mfbar-main">' +
      '<button data-act="toggle">∨ 魔方采集</button>' +
      '<div class="mf-panel" style="display:none">' +
      '<h4>魔方采集 · ' + SITE_NAME[site()] + '</h4>' +
      '<div class="mf-msg" id="mfMsg"></div>' +
      '<div class="mf-qlist" id="mfQList"></div>' +
      '<button data-act="pick">＋ 采集本页题目</button>' +
      '<button data-act="send" class="mf-ghost">⇩ 回传到采集篮（<span id="mfCount">0</span> 题）</button>' +
      '<div class="mf-treesel" id="mfTreeSel" style="display:' + (site() === 'zujuan' ? 'flex' : 'none') + '">' +
        '<select id="mfTStage" title="知识树要归到哪个学段"><option value="">学段…</option><option value="primary">小学</option><option value="junior">初中</option><option value="senior">高中</option></select>' +
        '<select id="mfTSub" title="知识树要归到哪个学科"><option value="">学科…</option>' + ['数学', '英语', '物理', '化学', '语文', '生物', '历史', '地理', '政治', '科学'].map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select></div>' +
      '<button data-act="tree" class="mf-ghost" style="display:' + (site() === 'zujuan' ? 'block' : 'none') + '">🌲 采集本页知识树（并入所选学段学科的树）</button>' +
      '<button data-act="hide" class="mf-ghost" style="background:#f1f5f9;color:#64748b;border:0">收起</button>' +
      '</div></div>';
    document.body.appendChild(bar);
    // 学段 / 学科默认值：按页面面包屑 / 标题推断，老师可改
    try {
      var pre = parseZujuanTree();
      if (pre) {
        var sm = { '小学': 'primary', '初中': 'junior', '高中': 'senior' };
        if (sm[pre.stage]) bar.querySelector('#mfTStage').value = sm[pre.stage];
        if (pre.subject) bar.querySelector('#mfTSub').value = pre.subject;
      }
    } catch (e) { /* 忽略 */ }
    // 组卷网等站点会给 body 加 transform/filter，position:fixed 会退化成相对 body 定位；
    // 挂到 <html> 下（html 上一般没有 transform）才能钉在视口右下角
    try { if (document.body.getBoundingClientRect().top !== 0 || getComputedStyle(document.body).transform !== 'none') {
      document.documentElement.appendChild(bar);
    } } catch (e) { /* 忽略 */ }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      var panel = bar.querySelector('.mf-panel');
      if (act === 'toggle' || act === 'hide') { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; return; }
      var msg = bar.querySelector('#mfMsg');
      function say(t, err) { msg.textContent = t; msg.className = 'mf-msg' + (err ? ' err' : ''); }
      if (act === 'pick') {
        var added = pickAll();
        render();
        say(added ? '本页采到 ' + added + ' 题（重复的已跳过）' : '这一页没找到题目：先把题加进试题篮，或选中题目文字再点一次', !added);
      } else if (act === 'send') {
        var list = basket.filter(function (q) { return q.checked !== false; });
        if (!list.length) return say('篮子是空的，先「采集本页题目」', true);
        b.disabled = true; say('回传中…');
        pushQuestions(list).then(function (j) {
          b.disabled = false;
          if (j && j.code === 0) { say('已收到 ' + list.length + ' 题，批次《' + (j.data && j.data.title || '') + '》已进采集篮'); basket = []; render(); }
          else say('回传失败：' + (j && j.msg || '未知'), true);
        }).catch(function (e) { b.disabled = false; say('回传失败：' + e.message, true); });
      } else if (act === 'tree') {
        var tStage = bar.querySelector('#mfTStage').value, tSub = bar.querySelector('#mfTSub').value;
        if (!tStage || !tSub) return say('先在上面选好「学段」和「学科」，知识树才知道归到哪棵树里', true);
        b.disabled = true; say('正在解析知识树…');
        pushTree(tStage, tSub).then(function (j) {
          b.disabled = false;
          say(j && j.code === 0 ? (j.msg || '导入完成') + '（回后台「题库管理」查看）' : (j && j.msg || '导入失败'), !(j && j.code === 0));
        }).catch(function (e) { b.disabled = false; say('导入失败：' + e.message, true); });
      }
    });
    function render() {
      var box = bar.querySelector('#mfQList');
      box.innerHTML = basket.map(function (q, i) {
        return '<label class="mf-qi"><input type="checkbox" data-i="' + i + '" ' + (q.checked !== false ? 'checked' : '') + '><span>' +
          (q.stem || '').slice(0, 80).replace(/</g, '&lt;') + '</span></label>';
      }).join('');
      bar.querySelector('#mfCount').textContent = String(basket.length);
    }
    bar.addEventListener('change', function (e) {
      if (e.target.matches('.mf-qi input')) {
        var i = Number(e.target.getAttribute('data-i'));
        if (basket[i]) basket[i].checked = e.target.checked;
        bar.querySelector('#mfCount').textContent = String(basket.filter(function (q) { return q.checked !== false; }).length);
      }
    });
  }
})();
