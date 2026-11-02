/* ============================================================
 * app.js —— 应用入口：路由、页面注册、设置页逻辑
 * ============================================================ */
(function (global) {
  'use strict';

  var App = global.App;
  var ui = App.ui;
  var store = App.store;
  var $ = ui.$, esc = ui.esc;

  var ROUTES = ['talks', 'contacts', 'students', 'settings'];
  var current = '';

  /* ---------------- 路由 ---------------- */
  function route() {
    var hash = (location.hash || '').replace('#/', '').trim();
    var name = ROUTES.indexOf(hash) >= 0 ? hash : 'talks';

    ROUTES.forEach(function (r) {
      var page = document.getElementById('page-' + r);
      if (page) page.classList.toggle('active', r === name);
      var nav = document.querySelector('[data-nav="' + r + '"]');
      if (nav) nav.classList.toggle('active', r === name);
    });

    var meta = App.pages[name] || {};
    document.getElementById('pageTitle').textContent = meta.title || '';
    var sub = document.getElementById('pageSub');
    if (sub) sub.textContent = meta.sub || '';
    syncTopCampus();

    current = name;
    refresh();
    window.scrollTo(0, 0);
  }

  /* ---------------- 顶栏全局校区切换 ---------------- */
  function syncTopCampus() {
    var tc = document.getElementById('topCampus');
    if (!tc) return;
    var camps = store.campuses();
    tc.hidden = camps.length <= 1;
    if (camps.length > 1) {
      var cur = store.campusFilter();
      tc.innerHTML = '<option value="">全部校区</option>' +
        camps.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      tc.value = cur && camps.indexOf(cur) >= 0 ? cur : '';
    }
  }

  /* ---------------- 刷新当前页 + 导航计数 ---------------- */
  function refresh() {
    if (current && App.pages[current] && App.pages[current].render) {
      App.pages[current].render();
    }
    var s = store.stat();
    // 页头计数标签（与成绩管理模板一致）+ 学生信息按钮徽标
    var pc = document.getElementById('pageCount');
    if (pc) {
      if (current === 'contacts') pc.textContent = s.communications + ' 条沟通';
      else if (current === 'students') pc.textContent = s.students + ' 名学生';
      else if (current === 'settings') pc.textContent = '';
      else pc.textContent = s.talks + ' 条谈话';
    }
    var nStu = document.getElementById('navCountStudents');
    if (nStu) nStu.textContent = s.students;

    if (current === 'settings') {
      document.getElementById('setStat').textContent =
        '当前数据：学生 ' + s.students + ' 人 · 谈话记录 ' + s.talks + ' 条 · 沟通记录 ' + s.communications + ' 条';
    }
  }

  /* ---------------- 设置页 ---------------- */
  function initSettings() {
    var cfg = store.settings();
    $('#setAiMode').value = cfg.aiMode || 'local';
    $('#setAiUrl').value = cfg.aiUrl || '';
    $('#setAiKey').value = cfg.aiKey || '';
    $('#setAiModel').value = cfg.aiModel || 'gpt-4o-mini';

    $('#setAiSave').addEventListener('click', function () {
      store.settings({
        aiMode: $('#setAiMode').value,
        aiUrl: $('#setAiUrl').value.trim(),
        aiKey: $('#setAiKey').value.trim(),
        aiModel: $('#setAiModel').value.trim() || 'gpt-4o-mini'
      });
      ui.toast('AI 设置已保存', 'ok');
    });

    // ASR 设置
    $('#setAsrUrl').value = cfg.asrUrl || '';
    $('#setAsrKey').value = cfg.asrKey || '';
    $('#setAsrModel').value = cfg.asrModel || 'whisper-1';

    $('#setAsrSave').addEventListener('click', function () {
      store.settings({
        asrUrl: $('#setAsrUrl').value.trim(),
        asrKey: $('#setAsrKey').value.trim(),
        asrModel: $('#setAsrModel').value.trim() || 'whisper-1'
      });
      ui.toast('ASR 设置已保存', 'ok');
    });

    $('#setBackup').addEventListener('click', function () {
      var blob = new Blob([store.backup()], { type: 'application/json' });
      ui.download(blob, '班主任工作台备份_' + ui.today() + '.json');
      ui.toast('备份文件已导出', 'ok');
    });

    $('#setRestore').addEventListener('click', function () { $('#setFile').click(); });

    $('#setFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          store.restore(String(reader.result));
          ui.toast('数据已导入', 'ok');
        } catch (err) {
          ui.toast('导入失败：' + err.message, 'err');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#setDemo').addEventListener('click', function () {
      ui.confirm({
        title: '载入示例数据',
        message: '示例数据会覆盖当前全部记录，确定继续吗？建议先导出备份。',
        okText: '覆盖并载入'
      }).then(function (ok) {
        if (!ok) return;
        store.loadDemo();
        ui.toast('示例数据已载入', 'ok');
      });
    });

    $('#setClear').addEventListener('click', function () {
      ui.confirm({
        title: '清空全部数据',
        message: '将删除全部学生档案、谈话记录与沟通记录，且不可恢复。确定继续吗？',
        okText: '确认清空'
      }).then(function (ok) {
        if (!ok) return;
        store.clearAll();
        ui.toast('数据已清空', 'ok');
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    store.load();

    ['talks', 'contacts', 'students'].forEach(function (r) {
      if (App.pages[r] && App.pages[r].init) App.pages[r].init();
    });
    initSettings();

    store.on(refresh);

    // 顶栏校区切换（全局筛选三个列表页）
    var tcs = document.getElementById('topCampus');
    if (tcs) tcs.addEventListener('change', function (e) {
      store.campusFilter(e.target.value);
      refresh();
    });

    // 启动时同步管理后台学生账号（学生管理开通即自动进入本模块）
    store.syncRoster();

    var d = new Date();
    document.getElementById('todayChip').textContent =
      ui.fmtCN(ui.today()) + ' ' + ui.weekday(ui.today());

    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/talks';
    route();

    // 语音能力提示
    if (!App.ai.speechSupported()) {
      console.info('当前浏览器不支持 Web Speech API，语音转文字将自动降级为手动输入。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
