/* ============================================================
 * students.js —— 学生信息模块
 *   作为【谈话谈心】【家校沟通】的学生数据来源
 * ============================================================ */
(function (global) {
  'use strict';

  var ui = global.App.ui;
  var store = global.App.store;
  var $ = ui.$, $$ = ui.$$, esc = ui.esc;

  var filter = { keyword: '', klass: '' };
  var els = {};

  /* ---------------- 列表 ---------------- */
  function matches(s) {
    var cf = store.campusFilter();
    if (cf && (s.campus || '') !== cf) return false;
    if (filter.klass && s.klass !== filter.klass) return false;
    if (filter.keyword) {
      var kw = filter.keyword.toLowerCase();
      var hay = (s.name + ' ' + (s.sno || '') + ' ' + (s.klass || '')).toLowerCase();
      if (hay.indexOf(kw) < 0) return false;
    }
    return true;
  }

  function list() {
    return store.students.all()
      .filter(matches)
      .sort(function (a, b) {
        return (a.sno || '').localeCompare(b.sno || '', 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN');
      });
  }

  function contactsText(s) {
    var arr = [];
    if (s.fatherName) arr.push('爸爸 ' + s.fatherName + (s.fatherPhone ? ' · ' + s.fatherPhone : ''));
    if (s.motherName) arr.push('妈妈 ' + s.motherName + (s.motherPhone ? ' · ' + s.motherPhone : ''));
    if (s.otherName) arr.push('其他 ' + s.otherName + (s.otherPhone ? ' · ' + s.otherPhone : ''));
    return arr;
  }

  function render() {
    var rows = list();
    var all = store.students.all();

    els.body.innerHTML = rows.map(function (s) {
      var cs = contactsText(s);
      return '<tr>' +
        '<td><span class="cell-strong">' + esc(s.name) + '</span>' +
        (store.isMultiCampus() && s.campus ? '<div class="cell-sub">' + esc(s.campus) + '</div>' : '') +
        (s.remark ? '<div class="cell-sub">' + esc(s.remark) + '</div>' : '') + '</td>' +
        '<td>' + esc(s.sex || '—') + '</td>' +
        '<td>' + esc(s.sno || '—') + '</td>' +
        '<td>' + esc(s.klass || '—') + '</td>' +
        '<td>' + (cs.length ? cs.map(function (c) { return '<div>' + esc(c) + '</div>'; }).join('') : '<span class="cell-sub">未登记</span>') + '</td>' +
        '<td><div class="act-cell">' +
        '<button class="link-btn" data-edit="' + esc(s.id) + '">' + (s._acctId ? '补充信息' : '编辑') + '</button>' +
        (s._acctId ? '' : '<button class="link-btn danger" data-del="' + esc(s.id) + '">删除</button>') +
        '</div></td>' +
        '</tr>';
    }).join('');

    els.empty.hidden = rows.length > 0;
    els.meta.textContent = '共 ' + rows.length + ' 人' + (rows.length !== all.length ? '（全部 ' + all.length + ' 人）' : '');

    // 班级下拉
    var classes = [];
    all.forEach(function (s) { if (s.klass && classes.indexOf(s.klass) < 0) classes.push(s.klass); });
    els.klass.innerHTML = '<option value="">全部班级</option>' +
      classes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    els.klass.value = filter.klass;
  }

  /* ---------------- 表单 ---------------- */
  function form(s) {
    var isEdit = !!s;
    s = s || { name: '', sex: '男', sno: '', klass: '', fatherName: '', fatherPhone: '', motherName: '', motherPhone: '', otherName: '', otherPhone: '', remark: '' };

    var classes = [];
    store.students.all().forEach(function (o) { if (o.klass && classes.indexOf(o.klass) < 0) classes.push(o.klass); });

    function row(label, id, value, type) {
      return '<label class="field"><span class="field-lab">' + label + '</span>' +
        '<input class="input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value) + '"></label>';
    }

    var html =
      '<div class="form-grid">' +
      row('姓名 *', 'fName', s.name) +
      '<label class="field"><span class="field-lab">性别</span><select class="input" id="fSex">' +
      ['男', '女'].map(function (o) { return '<option' + (s.sex === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select></label>' +
      row('学号', 'fSno', s.sno) +
      '<label class="field"><span class="field-lab">班级</span>' +
      '<input class="input" id="fKlass" list="fKlassList" value="' + esc(s.klass) + '" placeholder="如 七年级(1)班">' +
      '<datalist id="fKlassList">' + classes.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      '</label>' +
      row('父亲姓名', 'fFaName', s.fatherName) +
      row('父亲电话', 'fFaPhone', s.fatherPhone, 'tel') +
      row('母亲姓名', 'fMoName', s.motherName) +
      row('母亲电话', 'fMoPhone', s.motherPhone, 'tel') +
      row('其他亲属姓名', 'fOtName', s.otherName) +
      row('其他亲属电话', 'fOtPhone', s.otherPhone, 'tel') +
      '<label class="field full"><span class="field-lab">备注</span>' +
      '<textarea class="input" id="fRemark" rows="2">' + esc(s.remark) + '</textarea></label>' +
      '</div>';

    ui.modal({
      title: isEdit ? '编辑学生档案' : '添加学生',
      wide: true,
      bodyHTML: html,
      buttons: [
        { text: '取消', cls: 'btn' },
        {
          text: isEdit ? '保存修改' : '确认添加',
          cls: 'btn btn-primary',
          onClick: function (ctx) {
            var name = $('#fName', ctx.el).value.trim();
            if (!name) {
              ui.toast('请填写学生姓名', 'err');
              $('#fName', ctx.el).focus();
              return false;
            }
            var payload = {
              name: name,
              sex: $('#fSex', ctx.el).value,
              sno: $('#fSno', ctx.el).value.trim(),
              klass: $('#fKlass', ctx.el).value.trim(),
              fatherName: $('#fFaName', ctx.el).value.trim(),
              fatherPhone: $('#fFaPhone', ctx.el).value.trim(),
              motherName: $('#fMoName', ctx.el).value.trim(),
              motherPhone: $('#fMoPhone', ctx.el).value.trim(),
              otherName: $('#fOtName', ctx.el).value.trim(),
              otherPhone: $('#fOtPhone', ctx.el).value.trim(),
              remark: $('#fRemark', ctx.el).value.trim()
            };

            if (isEdit) {
              store.students.update(s.id, payload);
              syncName(s.id, payload.name);
              ui.toast('已保存修改', 'ok');
            } else {
              store.students.add(payload);
              ui.toast('已添加学生：' + name, 'ok');
            }
            render();
          }
        }
      ]
    });
  }

  /** 学生改名后，同步历史记录中的姓名，避免数据不一致 */
  function syncName(id, name) {
    store.talks.all().forEach(function (t) {
      if (t.studentId === id) store.talks.update(t.id, { studentName: name });
    });
    store.communications.all().forEach(function (c) {
      if (c.studentId === id) store.communications.update(c.id, { studentName: name });
    });
  }

  /* ---------------- 删除 ---------------- */
  function remove(id) {
    var s = store.students.get(id);
    if (!s) return;
    var tCount = store.talks.all().filter(function (t) { return t.studentId === id; }).length;
    var cCount = store.communications.all().filter(function (c) { return c.studentId === id; }).length;

    ui.confirm({
      title: '删除学生',
      message: '确认删除「' + s.name + '」的档案？' +
        (tCount || cCount ? '该生名下还有 ' + tCount + ' 条谈话记录、' + cCount + ' 条沟通记录，删除档案后这些历史记录仍会保留。' : ''),
      okText: '确认删除'
    }).then(function (ok) {
      if (!ok) return;
      store.students.remove(id);
      ui.toast('已删除档案', 'ok');
    });
  }

  /* ---------------- 导出 ---------------- */
  function columns() {
    var cols = [
      { title: '姓名', key: 'name', width: 12, pw: 8 }
    ];
    if (store.isMultiCampus()) cols.push({ title: '校区', key: 'campus', width: 10, pw: 7 });
    cols = cols.concat([
      { title: '性别', key: 'sex', width: 6, pw: 5 },
      { title: '学号', key: 'sno', width: 14, pw: 9 },
      { title: '班级', key: 'klass', width: 14, pw: 9 },
      { title: '父亲姓名', key: 'fatherName', width: 12, pw: 8 },
      { title: '父亲电话', key: 'fatherPhone', width: 14, pw: 9 },
      { title: '母亲姓名', key: 'motherName', width: 12, pw: 8 },
      { title: '母亲电话', key: 'motherPhone', width: 14, pw: 9 },
      { title: '其他亲属', key: 'otherName', width: 12, pw: 8 },
      { title: '其他亲属电话', key: 'otherPhone', width: 15, pw: 10 },
      { title: '备注', key: 'remark', width: 24, pw: 17 }
    ]);
    return cols;
  }

  function filterInfo() {
    var f = [];
    if (filter.klass) f.push('班级：' + filter.klass);
    if (filter.keyword) f.push('关键词：' + filter.keyword);
    return f.length ? f : ['全部学生'];
  }

  function exportXlsx() {
    var rows = list();
    if (!rows.length) { ui.toast('当前无可导出的记录', 'err'); return; }
    ui.exportXlsx({
      filename: '学生信息_' + ui.today(),
      sheet: '学生信息',
      columns: columns(),
      rows: rows
    });
    ui.toast('已导出 ' + rows.length + ' 条记录（Excel）', 'ok');
  }

  function exportPdf() {
    var rows = list();
    ui.exportPdf({
      title: '学生信息档案',
      filters: filterInfo(),
      columns: columns(),
      rows: rows
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    els.body = $('#stBody');
    els.empty = $('#stEmpty');
    els.meta = $('#stMeta');
    els.klass = $('#stClass');

    $('#stKeyword').addEventListener('input', function (e) { filter.keyword = e.target.value.trim(); render(); });
    els.klass.addEventListener('change', function (e) { filter.klass = e.target.value; render(); });
    $('#stAdd').addEventListener('click', function () { form(null); });
    $('#stXlsx').addEventListener('click', exportXlsx);
    $('#stPdf').addEventListener('click', exportPdf);

    els.body.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]');
      if (ed) { form(store.students.get(ed.dataset.edit)); return; }
      var del = e.target.closest('[data-del]');
      if (del) remove(del.dataset.del);
    });
  }

  global.App.pages = global.App.pages || {};
  global.App.pages.students = {
    title: '学生信息',
    sub: '学生档案与家长联系方式，供谈话、沟通记录调用',
    init: init,
    render: render
  };

  /* 供其他模块调用 */
  global.App.studentOptions = function () {
    return store.students.all()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); })
      .map(function (s) {
        return {
          value: s.id,
          label: s.name,
          sub: s.klass ? s.klass : '',
          data: s
        };
      });
  };

  global.App.studentById = function (id) { return store.students.get(id); };
})(window);
