/* ============================================================
 * contacts.js —— 家校沟通模块
 *   列表 / 添加（录音文件上传） / 组合筛选 / 导出
 * ============================================================ */
(function (global) {
  'use strict';

  var ui = global.App.ui;
  var store = global.App.store;

  var $ = ui.$, esc = ui.esc;

  var WAYS = ['电话', '面谈'];
  var WAY_CLS = { '电话': 'chip-t1', '面谈': 'chip-t2' };

  var filter = { from: '', to: '', student: '', way: '', contact: '' };

  /* ---------------- 列表 ---------------- */
  function list() {
    return store.communications.all().filter(function (c) {
      if (filter.from && (c.date || '') < filter.from) return false;
      if (filter.to && (c.date || '') > filter.to) return false;
      if (filter.way && c.way !== filter.way) return false;
      if (filter.contact && c.contact !== filter.contact) return false;
      if (filter.student && (c.studentName || '').toLowerCase().indexOf(filter.student.toLowerCase()) < 0) return false;
      var cf = store.campusFilter();
      if (cf) {
        var stu = store.students.get(c.studentId);
        if (!stu || (stu.campus || '') !== cf) return false;
      }
      return true;
    }).sort(function (a, b) {
      if ((b.date || '') !== (a.date || '')) return (b.date || '').localeCompare(a.date || '');
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  function render() {
    var rows = list();
    var all = store.communications.all();
    var mon = ui.monthPrefix();

    document.getElementById('ctBody').innerHTML = rows.map(function (c) {
      return '<tr>' +
        '<td><span class="cell-strong">' + esc(c.date || '—') + '</span>' +
        '<div class="cell-sub">' + esc(ui.weekday(c.date)) + '</div></td>' +
        '<td>' + esc(c.studentName || '—') + '</td>' +
        '<td>' + (c.contact
          ? '<span class="chip chip-' + (c.contact === '爸爸' ? 't2' : c.contact === '妈妈' ? 't3' : 'gray') + '">' + esc(c.contact) + '</span>' +
            (c.contactName ? '<div class="cell-sub">' + esc(c.contactName) + '</div>' : '')
          : '<span class="cell-sub">—</span>') + '</td>' +
        '<td><span class="chip ' + (WAY_CLS[c.way] || 'chip-gray') + '">' + esc(c.way || '—') + '</span></td>' +
        '<td><div class="clip">' + esc(c.content || '—') + '</div></td>' +
        '<td><div class="clip">' + (c.result ? esc(c.result) : '<span class="cell-sub">未填写</span>') + '</div></td>' +
        '<td><div class="act-cell">' +
        (c.audioUrl ? '<button class="link-btn" data-audio="' + esc(c.id) + '">收听录音</button>' : '') +
        '<button class="link-btn" data-view="' + esc(c.id) + '">查看</button>' +
        '<button class="link-btn danger" data-del="' + esc(c.id) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    document.getElementById('ctEmpty').hidden = rows.length > 0;
    document.getElementById('ctEmpty').textContent = all.length ? '未找到符合筛选条件的沟通记录，请调整或重置筛选。' : '暂无沟通记录，点击「添加沟通记录」开始记录。';
    document.getElementById('ctMeta').textContent =
      '共 ' + rows.length + ' 条' + (rows.length !== all.length ? '（全部 ' + all.length + ' 条）' : '');

    var inMonth = all.filter(function (c) { return (c.date || '').slice(0, 7) === mon; });
    var monthStudents = {};
    inMonth.forEach(function (c) { if (c.studentId) monthStudents[c.studentId] = 1; });
    var visit = all.filter(function (c) { return c.way === '面谈'; }).length;

    document.getElementById('ctStats').innerHTML =
      stat('累计沟通记录', all.length, '条') +
      stat('本月沟通', inMonth.length, '次', 'brand') +
      stat('本月涉及学生', Object.keys(monthStudents).length, '人') +
      stat('累计面谈', visit, '次');
  }

  function stat(k, v, unit, cls) {
    return '<div class="stat ' + (cls || '') + '">' +
      '<div class="stat-k">' + k + '</div>' +
      '<div class="stat-v">' + v + '<small>' + unit + '</small></div></div>';
  }

  /* ---------------- 详情 / 删除 ---------------- */
  function view(id) {
    var c = store.communications.get(id);
    if (!c) return;
    var detail = ui.modal({
      title: '家校沟通记录详情',
      wide: true,
      bodyHTML:
        '<div class="detail-row"><div class="detail-k">日期</div><div class="detail-v">' +
        esc(ui.fmtCN(c.date)) + ' ' + esc(ui.weekday(c.date)) + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">学生</div><div class="detail-v">' + esc(c.studentName || '—') + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">联系人</div><div class="detail-v">' +
        esc(c.contact || '—') + (c.contactName ? '（' + esc(c.contactName) + '）' : '') +
        (c.contactPhone ? '　' + esc(c.contactPhone) : '') + '</div></div>' +
        '<div class="detail-row"><div class="detail-k">沟通方式</div><div class="detail-v">' +
        '<span class="chip ' + (WAY_CLS[c.way] || 'chip-gray') + '">' + esc(c.way || '—') + '</span></div></div>' +
        '<div class="detail-row"><div class="detail-k">沟通内容</div><div class="detail-v" style="white-space:pre-wrap">' + esc(c.content || '—') + '</div></div>' +
        (c.audioUrl
          ? '<div class="detail-row"><div class="detail-k">沟通录音</div><div class="detail-v">' +
            '<button class="btn" id="detailAudio" type="button">安全收听录音</button></div></div>'
          : '') +
        '<div class="detail-row"><div class="detail-k">跟进结果</div><div class="detail-v">' + esc(c.result || '—') + '</div></div>',
      buttons: [{ text: '关闭', cls: 'btn btn-primary' }]
    });
    var audioButton = $('#detailAudio', detail.el);
    if (audioButton) audioButton.addEventListener('click', function () {
      ui.playAudio(c.audioUrl, '沟通录音 · ' + (c.studentName || ''));
    });
  }

  function remove(id) {
    var c = store.communications.get(id);
    if (!c) return;
    ui.confirm({
      title: '删除沟通记录',
      message: '确认删除 ' + (c.date || '') + ' 与「' + (c.studentName || '未知学生') + '」' + (c.contact || '') + '的沟通记录？删除后不可恢复。',
      okText: '确认删除'
    }).then(function (ok) {
      if (!ok) return;
      store.communications.remove(id);
      ui.toast('已删除记录', 'ok');
    });
  }

  /* ---------------- 联系人选项（随学生联动） ---------------- */
  function contactOptions(sid) {
    var s = sid ? global.App.studentById(sid) : null;
    var arr = [];
    if (s) {
      arr.push({
        value: '爸爸',
        label: '学生爸爸' + (s.fatherName ? ' · ' + s.fatherName : ''),
        sub: s.fatherPhone || ''
      });
      arr.push({
        value: '妈妈',
        label: '学生妈妈' + (s.motherName ? ' · ' + s.motherName : ''),
        sub: s.motherPhone || ''
      });
      arr.push({
        value: '其他亲属',
        label: '其他亲属' + (s.otherName ? ' · ' + s.otherName : ''),
        sub: s.otherPhone || ''
      });
    } else {
      arr = [
        { value: '爸爸', label: '学生爸爸', sub: '' },
        { value: '妈妈', label: '学生妈妈', sub: '' },
        { value: '其他亲属', label: '其他亲属', sub: '' }
      ];
    }
    return arr;
  }

  function contactInfo(sid, relation) {
    var s = sid ? global.App.studentById(sid) : null;
    if (!s) return { name: '', phone: '' };
    if (relation === '爸爸') return { name: s.fatherName || '', phone: s.fatherPhone || '' };
    if (relation === '妈妈') return { name: s.motherName || '', phone: s.motherPhone || '' };
    return { name: s.otherName || '', phone: s.otherPhone || '' };
  }

  /* ---------------- 添加沟通记录 ---------------- */
  function form() {
    var html =
      '<div class="form-grid">' +
      '<label class="field"><span class="field-lab">日期</span>' +
      '<input class="input" type="date" id="fDate" value="' + ui.today() + '"></label>' +

      '<label class="field"><span class="field-lab">学生 *（支持输入姓名搜索）</span>' +
      '<div id="fStuSlot"></div></label>' +

      '<label class="field"><span class="field-lab">联系人</span>' +
      '<div id="fContactSlot"></div></label>' +

      '<label class="field"><span class="field-lab">沟通方式</span>' +
      '<select class="input" id="fWay">' +
      WAYS.map(function (w) { return '<option>' + w + '</option>'; }).join('') +
      '</select></label>' +

      '<div class="field full"><span class="field-lab">沟通内容 *（可直接手动输入）</span>' +
      '<textarea aria-label="沟通内容" aria-required="true" class="input" id="fContent" rows="6" placeholder="可直接手动输入沟通内容"></textarea>' +
      '</div>' +

      '<div class="field full"><span class="field-lab">沟通录音（选填，上传后可在记录中收听）</span>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-sm" id="fAudioBtn">' +
      '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>' +
      '上传录音文件</button>' +
      '<span class="small" id="fAudioName" style="color:var(--txt-3)">未选择录音</span>' +
      '</div>' +
      '<input type="file" id="fAudioFile" accept=".webm,.mp3,.m4a,.wav,.ogg,.aac,.amr,audio/*" hidden>' +
      '</div>' +

      '<label class="field full"><span class="field-lab">跟进结果</span>' +
      '<textarea class="input" id="fResult" rows="3" placeholder="家长的回应、达成的共识与后续安排"></textarea></label>' +
      '</div>';

    var refs = {};
    var ctx = ui.modal({
      title: '添加家校沟通记录',
      wide: true,
      bodyHTML: html,
      buttons: [
        { text: '取消', cls: 'btn' },
        { text: '保存记录', cls: 'btn btn-primary', onClick: function (c) { return saveRecord(c); } }
      ]
    });

    bind(ctx, refs);

    function saveRecord(c) {
      var sid = refs.stuCombo.getValue();
      if (!sid) { ui.fieldError(refs.stuCombo.input, '请选择学生'); ui.toast('请选择学生', 'err'); return false; }
      ui.fieldError(refs.stuCombo.input, '');
      var text = $('#fContent', c.el).value.trim();
      if (!text) { ui.fieldError($('#fContent', c.el), '请填写沟通内容'); ui.toast('请填写沟通内容', 'err'); return false; }
      ui.fieldError($('#fContent', c.el), '');

      var relation = refs.contactCombo.getValue();
      var info = contactInfo(sid, relation);

      store.communications.add({
        date: $('#fDate', c.el).value || ui.today(),
        studentId: sid,
        studentName: (global.App.studentById(sid) || {}).name || '',
        contact: relation,
        contactName: info.name,
        contactPhone: info.phone,
        way: $('#fWay', c.el).value,
        content: text,
        result: $('#fResult', c.el).value.trim(),
        audioUrl: refs.audioUrl || ''
      });
      ui.toast('已保存沟通记录', 'ok');
      return true;
    }
  }

  function bind(ctx, refs) {
    var el = ctx.el;

    /* 学生下拉（可搜索） */
    var opts = global.App.studentOptions();
    var stuCombo = ui.combo({
      placeholder: '点击选择或输入姓名搜索',
      options: opts,
      onChange: function (v) {
        contactCombo.setOptions(contactOptions(v));
        contactCombo.setValue(contactCombo.getValue() || '爸爸', true);
      }
    });
    $('#fStuSlot', el).appendChild(stuCombo.el);
    refs.stuCombo = stuCombo;
    stuCombo.input.setAttribute('aria-label', '学生'); stuCombo.input.setAttribute('aria-required', 'true');
    if (!opts.length) ui.toast('学生信息为空，请先到「学生信息」添加学生', 'err');

    /* 联系人下拉 */
    var contactCombo = ui.combo({
      placeholder: '请选择联系人',
      options: contactOptions(''),
      onChange: function () { }
    });
    $('#fContactSlot', el).appendChild(contactCombo.el);
    contactCombo.setValue('爸爸', true);
    refs.contactCombo = contactCombo;
    contactCombo.input.setAttribute('aria-label', '联系人');

    /* 录音文件上传 */
    var audioBtn = $('#fAudioBtn', el);
    var audioFile = $('#fAudioFile', el);
    var audioName = $('#fAudioName', el);
    audioName.setAttribute('role', 'status');
    $('#fContent', el).addEventListener('input', function () { ui.fieldError(this, ''); });

    audioBtn.addEventListener('click', function () { audioFile.click(); });
    audioFile.addEventListener('change', function () {
      var f = audioFile.files && audioFile.files[0];
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { ui.toast('录音文件不能超过 50MB', 'err'); return; }
      var saveButton = el.querySelector('.modal-foot .btn-primary');
      audioBtn.disabled = true; saveButton.disabled = true; audioBtn.setAttribute('aria-busy', 'true');
      audioName.dataset.state = 'pending';
      audioName.textContent = '正在上传「' + f.name + '」…';
      ui.uploadAudio(f).then(function (d) {
        refs.audioUrl = d.url; audioName.dataset.state = 'success';
        audioName.textContent = '已上传「' + (d.name || f.name) + '」，保存记录后可随时收听';
        ui.toast('录音已上传', 'ok');
      }).catch(function (e) {
        refs.audioUrl = '';
        audioName.dataset.state = 'error';
        audioName.textContent = '上传失败，请重试；填写的内容仍保留';
        ui.toast(e.message || '录音上传失败', 'err');
      }).finally(function () {
        audioBtn.disabled = false; saveButton.disabled = false; audioBtn.removeAttribute('aria-busy');
      });
      audioFile.value = '';
    });

  }

  /* ---------------- 筛选 / 导出 ---------------- */
  function filterInfo() {
    var f = [];
    if (filter.from || filter.to) f.push('日期：' + (filter.from || '不限') + ' ~ ' + (filter.to || '不限'));
    if (filter.student) f.push('学生：' + filter.student);
    if (filter.way) f.push('方式：' + filter.way);
    if (filter.contact) f.push('联系人：' + filter.contact);
    return f.length ? f : ['全部记录'];
  }

  function columns() {
    return [
      { title: '日期', key: 'date', width: 12, pw: 8 },
      { title: '学生', key: 'studentName', width: 10, pw: 7 },
      {
        title: '联系人', width: 18, pw: 12,
        get: function (r) { return r.contact + (r.contactName ? '（' + r.contactName + '）' : ''); }
      },
      { title: '联系电话', key: 'contactPhone', width: 14, pw: 10 },
      { title: '沟通方式', key: 'way', width: 10, pw: 7 },
      { title: '沟通内容', key: 'content', width: 52, pw: 37 },
      { title: '跟进结果', key: 'result', width: 26, pw: 19 }
    ];
  }

  function exportXlsx() {
    var rows = list();
    if (!rows.length) { ui.toast('当前筛选条件下没有记录', 'err'); return; }
    ui.exportXlsx({ filename: '家校沟通记录_' + ui.today(), sheet: '家校沟通', columns: columns(), rows: rows });
    ui.toast('已导出 ' + rows.length + ' 条记录（Excel）', 'ok');
  }

  function exportPdf() {
    ui.exportPdf({ title: '家校沟通记录', filters: filterInfo(), columns: columns(), rows: list() });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    document.getElementById('ctAdd').addEventListener('click', form);

    $('#ctFrom').addEventListener('change', function (e) { filter.from = e.target.value; render(); });
    $('#ctTo').addEventListener('change', function (e) { filter.to = e.target.value; render(); });
    $('#ctWay').addEventListener('change', function (e) { filter.way = e.target.value; render(); });
    $('#ctContact').addEventListener('change', function (e) { filter.contact = e.target.value; render(); });

    var timer = null;
    $('#ctStudent').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value.trim();
      timer = setTimeout(function () { filter.student = v; render(); }, 200);
    });

    document.getElementById('ctReset').addEventListener('click', function () {
      filter = { from: '', to: '', student: '', way: '', contact: '' };
      $('#ctFrom').value = ''; $('#ctTo').value = ''; $('#ctStudent').value = '';
      $('#ctWay').value = ''; $('#ctContact').value = '';
      render();
    });

    document.getElementById('ctXlsx').addEventListener('click', exportXlsx);
    document.getElementById('ctPdf').addEventListener('click', exportPdf);

    var body = document.getElementById('ctBody');
    body.addEventListener('click', function (e) {
      var au = e.target.closest('[data-audio]');
      if (au) {
        var ca = store.communications.get(au.dataset.audio);
        if (ca && ca.audioUrl) ui.playAudio(ca.audioUrl, '沟通录音 · ' + (ca.studentName || ''));
        return;
      }
      var v = e.target.closest('[data-view]');
      if (v) { view(v.dataset.view); return; }
      var d = e.target.closest('[data-del]');
      if (d) remove(d.dataset.del);
    });
  }

  global.App.pages = global.App.pages || {};
  global.App.pages.contacts = {
    title: '家校沟通',
    sub: '记录电话与面谈沟通，追踪每一次家校协作的结果',
    init: init,
    render: render
  };
})(window);
