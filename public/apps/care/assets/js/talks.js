/* ============================================================
 * talks.js —— 谈话谈心模块
 *   列表（日期倒序） / 添加（录音文件上传） / 筛选 / 导出
 * ============================================================ */
(function (global) {
  'use strict';

  var ui = global.App.ui;
  var store = global.App.store;

  var $ = ui.$, esc = ui.esc;

  var TYPES = ['日常谈心', '成绩分析', '心理辅导', '纪律谈话'];
  var TYPE_CLS = { '日常谈心': 'chip-t1', '成绩分析': 'chip-t2', '心理辅导': 'chip-t3', '纪律谈话': 'chip-t4' };

  var filter = { from: '', to: '', student: '', type: '' };

  /* ---------------- 列表 ---------------- */
  function list() {
    return store.talks.all().filter(function (t) {
      if (filter.from && (t.date || '') < filter.from) return false;
      if (filter.to && (t.date || '') > filter.to) return false;
      if (filter.type && t.type !== filter.type) return false;
      if (filter.student && (t.studentName || '').toLowerCase().indexOf(filter.student.toLowerCase()) < 0) return false;
      var cf = store.campusFilter();
      if (cf) {
        var stu = store.students.get(t.studentId);
        if (!stu || (stu.campus || '') !== cf) return false;
      }
      return true;
    }).sort(function (a, b) {
      // 日期倒序，同日按创建时间倒序
      if ((b.date || '') !== (a.date || '')) return (b.date || '').localeCompare(a.date || '');
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  function followChip(t) {
    if (!t.followDate) return '';
    var d = ui.diffDays(t.followDate);
    var cls = 'chip-gray', txt = t.followDate.slice(5);
    if (d < 0) { cls = 'chip-t4'; txt = '逾期' + Math.abs(d) + '天'; }
    else if (d === 0) { cls = 'chip-t4'; txt = '今日跟进'; }
    else if (d <= 3) { cls = 'chip-t2'; txt = d + '天后'; }
    return '<span class="chip ' + cls + '">' + esc(txt) + '</span>';
  }

  function render() {
    var rows = list();
    var all = store.talks.all();
    var mon = ui.monthPrefix();

    document.getElementById('tkBody').innerHTML = rows.map(function (t) {
      return '<tr>' +
        '<td><span class="cell-strong">' + esc(t.date || '—') + '</span>' +
        '<div class="cell-sub">' + esc(ui.weekday(t.date)) + '</div></td>' +
        '<td>' + esc(t.studentName || '—') + '</td>' +
        '<td><span class="chip ' + (TYPE_CLS[t.type] || 'chip-gray') + '">' + esc(t.type || '其他') + '</span></td>' +
        '<td><div class="clip">' + esc(t.content || '—') + '</div></td>' +
        '<td>' + (t.followDate || t.followNote
          ? '<div><span class="cell-strong">' + esc(t.followDate || '未定日期') + '</span> ' + followChip(t) + '</div>' +
            '<div class="cell-sub clip">' + esc(t.followNote || '未填写跟进事项') + '</div>'
          : '<span class="cell-sub">暂无跟进安排</span>') + '</td>' +
        '<td><div class="act-cell">' +
        (t.audioUrl ? '<button class="link-btn" data-audio="' + esc(t.id) + '">收听录音</button>' : '') +
        '<button class="link-btn" data-view="' + esc(t.id) + '">查看</button>' +
        '<button class="link-btn danger" data-del="' + esc(t.id) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    document.getElementById('tkEmpty').hidden = rows.length > 0;
    document.getElementById('tkMeta').textContent =
      '共 ' + rows.length + ' 条' + (rows.length !== all.length ? '（全部 ' + all.length + ' 条）' : '');

    // 统计条
    var pending = all.filter(function (t) {
      if (!t.followDate || !t.followNote) return false;
      var d = ui.diffDays(t.followDate);
      return d >= 0 && d <= 7;
    }).length;
    var overdue = all.filter(function (t) {
      return t.followDate && t.followNote && ui.diffDays(t.followDate) < 0;
    }).length;
    var monthCount = all.filter(function (t) { return (t.date || '').slice(0, 7) === mon; }).length;

    document.getElementById('talkStats').innerHTML =
      stat('累计谈话记录', all.length, '') +
      stat('本月谈话', monthCount, '次', 'brand') +
      stat('7 日内待跟进', pending, '项', '') +
      stat('已逾期未跟进', overdue, '项', overdue > 0 ? 'warn' : '');
  }

  function stat(k, v, unit, cls) {
    return '<div class="stat ' + (cls || '') + '">' +
      '<div class="stat-k">' + k + '</div>' +
      '<div class="stat-v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</div></div>';
  }

  /* ---------------- 详情 ---------------- */
  function view(id) {
    var t = store.talks.get(id);
    if (!t) return;
    var detail = ui.modal({
      title: '谈话记录详情',
      wide: true,
      bodyHTML:
        '<div class="detail-row"><div class="detail-k">日期</div><div class="detail-v">' +
        esc(ui.fmtCN(t.date)) + ' ' + esc(ui.weekday(t.date)) + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">学生</div><div class="detail-v">' + esc(t.studentName || '—') + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">类别</div><div class="detail-v">' +
        '<span class="chip ' + (TYPE_CLS[t.type] || 'chip-gray') + '">' + esc(t.type || '其他') + '</span></div></div>' +
        '<div class="detail-row"><div class="detail-k">谈话内容</div><div class="detail-v" style="white-space:pre-wrap">' + esc(t.content || '—') + '</div></div>' +
        (t.audioUrl
          ? '<div class="detail-row"><div class="detail-k">谈话录音</div><div class="detail-v">' +
            '<button class="btn" id="detailAudio" type="button">安全收听录音</button></div></div>'
          : '') +
        '<div class="detail-row"><div class="detail-k">跟进日期</div><div class="detail-v">' +
        esc(t.followDate ? ui.fmtCN(t.followDate) : '未设置') + (t.followDate ? ' ' + followChip(t) : '') + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">跟进事项</div><div class="detail-v">' + esc(t.followNote || '—') + '</div></div>',
      buttons: [{ text: '关闭', cls: 'btn btn-primary' }]
    });
    var audioButton = $('#detailAudio', detail.el);
    if (audioButton) audioButton.addEventListener('click', function () {
      ui.playAudio(t.audioUrl, '谈话录音 · ' + (t.studentName || ''));
    });
  }

  function remove(id) {
    var t = store.talks.get(id);
    if (!t) return;
    ui.confirm({
      title: '删除谈话记录',
      message: '确认删除 ' + (t.date || '') + ' 与「' + (t.studentName || '未知学生') + '」的' + (t.type || '') + '记录？删除后不可恢复。',
      okText: '确认删除'
    }).then(function (ok) {
      if (!ok) return;
      store.talks.remove(id);
      ui.toast('已删除记录', 'ok');
    });
  }

  /* ---------------- 添加谈话 ---------------- */
  function form() {
    var html =
      '<div class="form-grid">' +
      '<label class="field"><span class="field-lab">日期</span>' +
      '<input class="input" type="date" id="fDate" value="' + ui.today() + '"></label>' +

      '<label class="field"><span class="field-lab">学生 *</span>' +
      '<div id="fStuSlot"></div></label>' +

      '<label class="field"><span class="field-lab">类别</span>' +
      '<select class="input" id="fType">' +
      TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') +
      '</select></label>' +

      '<label class="field"><span class="field-lab">跟进日期</span>' +
      '<input class="input" type="date" id="fFollowDate"></label>' +

      '<div class="field full"><span class="field-lab">谈话内容 *（可直接手动输入）</span>' +
      '<textarea class="input" id="fContent" rows="7" placeholder="可直接手动输入谈话内容"></textarea>' +
      '</div>' +
      '<div class="field full"><span class="field-lab">谈话录音（选填，上传后可在记录中收听）</span>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-sm" id="fAudioBtn">' +
      '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>' +
      '上传录音文件</button>' +
      '<span class="small" id="fAudioName" style="color:var(--txt-3)">未选择录音</span>' +
      '</div>' +
      '<input type="file" id="fAudioFile" accept=".webm,.mp3,.m4a,.wav,.ogg,.aac,.amr,audio/*" hidden>' +
      '</div>' +
      '<div class="field full"><span class="field-lab">跟进事项</span>' +
      '<input class="input" id="fFollowNote" placeholder="下一步跟进要做的事">' +
      '</div>';

    // refs 用于把表单控件暴露给保存回调（保存逻辑与表单 DOM 同处 form 作用域）
    var refs = {};
    var ctx = ui.modal({
      title: '添加谈话记录',
      wide: true,
      bodyHTML: html,
      buttons: [
        { text: '取消', cls: 'btn' },
        {
          text: '保存记录',
          cls: 'btn btn-primary',
          onClick: function (c) { return saveRecord(c); }
        }
      ]
    });

    bind(ctx, refs);

    function saveRecord(c) {
      var date = $('#fDate', c.el).value || ui.today();
      var sid = refs.combo.getValue();
      if (!sid) { ui.toast('请选择学生', 'err'); return false; }
      var sName = (global.App.studentById(sid) || {}).name || '';
      var text = $('#fContent', c.el).value.trim();
      if (!text) { ui.toast('请填写谈话内容', 'err'); $('#fContent', c.el).focus(); return false; }

      store.talks.add({
        date: date,
        studentId: sid,
        studentName: sName,
        type: $('#fType', c.el).value,
        content: text,
        followDate: $('#fFollowDate', c.el).value,
        followNote: $('#fFollowNote', c.el).value.trim(),
        audioUrl: refs.audioUrl || ''
      });
      ui.toast('已保存谈话记录', 'ok');
      return true;
    }
  }

  /* ---------------- 表单交互 ---------------- */
  function bind(ctx, refs) {
    var el = ctx.el;

    /* 学生下拉（可搜索，来源：学生信息） */
    var opts = global.App.studentOptions();
    var combo = ui.combo({
      placeholder: '点击选择或输入姓名搜索',
      options: opts,
      onChange: function () { }
    });
    $('#fStuSlot', el).appendChild(combo.el);
    refs.combo = combo;
    if (!opts.length) {
      ui.toast('学生信息为空，请先到「学生信息」添加学生', 'err');
    }

    /* 录音文件上传 */
    var audioBtn = $('#fAudioBtn', el);
    var audioFile = $('#fAudioFile', el);
    var audioName = $('#fAudioName', el);
    var content = $('#fContent', el);

    audioBtn.addEventListener('click', function () { audioFile.click(); });
    audioFile.addEventListener('change', function () {
      var f = audioFile.files && audioFile.files[0];
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { ui.toast('录音文件不能超过 50MB', 'err'); return; }
      audioName.textContent = '正在上传「' + f.name + '」…';
      ui.uploadAudio(f).then(function (d) {
        refs.audioUrl = d.url;
        audioName.textContent = '已上传「' + (d.name || f.name) + '」，保存记录后可随时收听';
        ui.toast('录音已上传', 'ok');
      }).catch(function (e) {
        refs.audioUrl = '';
        audioName.textContent = '未选择录音';
        ui.toast(e.message || '录音上传失败', 'err');
      });
      audioFile.value = '';
    });

  }

  /* ---------------- 筛选 / 导出 ---------------- */
  function filterInfo() {
    var f = [];
    if (filter.from || filter.to) f.push('日期：' + (filter.from || '不限') + ' ~ ' + (filter.to || '不限'));
    if (filter.student) f.push('学生：' + filter.student);
    if (filter.type) f.push('类别：' + filter.type);
    return f.length ? f : ['全部记录'];
  }

  function columns() {
    return [
      { title: '日期', key: 'date', width: 12, pw: 9 },
      { title: '学生', key: 'studentName', width: 10, pw: 8 },
      { title: '类别', key: 'type', width: 10, pw: 8 },
      { title: '谈话内容', key: 'content', width: 60, pw: 47 },
      { title: '跟进日期', key: 'followDate', width: 12, pw: 9 },
      { title: '跟进事项', key: 'followNote', width: 26, pw: 19 }
    ];
  }

  function exportXlsx() {
    var rows = list();
    if (!rows.length) { ui.toast('当前筛选条件下没有记录', 'err'); return; }
    ui.exportXlsx({ filename: '谈话谈心记录_' + ui.today(), sheet: '谈话谈心', columns: columns(), rows: rows });
    ui.toast('已导出 ' + rows.length + ' 条记录（Excel）', 'ok');
  }

  function exportPdf() {
    ui.exportPdf({ title: '谈话谈心记录', filters: filterInfo(), columns: columns(), rows: list() });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    document.getElementById('tkAdd').addEventListener('click', form);

    $('#tkFrom').addEventListener('change', function (e) { filter.from = e.target.value; render(); });
    $('#tkTo').addEventListener('change', function (e) { filter.to = e.target.value; render(); });
    $('#tkType').addEventListener('change', function (e) { filter.type = e.target.value; render(); });

    var timer = null;
    $('#tkStudent').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value.trim();
      timer = setTimeout(function () { filter.student = v; render(); }, 200);
    });

    document.getElementById('tkReset').addEventListener('click', function () {
      filter = { from: '', to: '', student: '', type: '' };
      $('#tkFrom').value = ''; $('#tkTo').value = ''; $('#tkStudent').value = ''; $('#tkType').value = '';
      render();
    });

    document.getElementById('tkXlsx').addEventListener('click', exportXlsx);
    document.getElementById('tkPdf').addEventListener('click', exportPdf);

    var body = document.getElementById('tkBody');
    body.addEventListener('click', function (e) {
      var au = e.target.closest('[data-audio]');
      if (au) {
        var ta = store.talks.get(au.dataset.audio);
        if (ta && ta.audioUrl) ui.playAudio(ta.audioUrl, '谈话录音 · ' + (ta.studentName || ''));
        return;
      }
      var v = e.target.closest('[data-view]');
      if (v) { view(v.dataset.view); return; }
      var d = e.target.closest('[data-del]');
      if (d) remove(d.dataset.del);
    });
  }

  global.App.pages = global.App.pages || {};
  global.App.pages.talks = {
    title: '谈话谈心',
    sub: '记录每一次师生谈心，语音转写后由 AI 自动整理结构化纪要',
    init: init,
    render: render
  };
})(window);
