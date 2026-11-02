/* ============================================================
 * store.js —— 本地数据层（localStorage）
 *   三张表：students / talks / communications
 * ============================================================ */
(function (global) {
  'use strict';

  var DATA_KEY = 'bzw.data.v1';
  var SET_KEY = 'bzw.settings.v1';

  var db = { students: [], talks: [], communications: [] };
  var listeners = [];

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 示例数据 ---------------- */
  function demoData() {
    var S = [
      ['陈亦然', '女', '20260101', '高一(1)班', '陈建国', '13800138001', '林淑芬', '13800138002', '', ''],
      ['李思远', '男', '20260102', '高一(1)班', '李伟民', '13800138003', '王雅琴', '13800138004', '', ''],
      ['王雨桐', '女', '20260103', '高一(1)班', '王大海', '13800138005', '周敏', '13800138006', '', ''],
      ['张子谦', '男', '20260104', '高一(1)班', '张宏', '13800138007', '刘颖', '13800138008', '张奶奶', '13800138009'],
      ['刘思彤', '女', '20260105', '高一(1)班', '刘振国', '13800138010', '陈丽', '13800138011', '', ''],
      ['赵启明', '男', '20260106', '高一(1)班', '赵德海', '13800138012', '孙秀英', '13800138013', '', ''],
      ['孙佳怡', '女', '20260107', '高一(1)班', '孙立平', '13800138014', '吴芳', '13800138015', '', ''],
      ['周浩然', '男', '20260108', '高一(1)班', '周成', '13800138016', '郑红梅', '13800138017', '', ''],
      ['吴静怡', '女', '20260109', '高一(1)班', '吴建华', '13800138018', '何秀兰', '13800138019', '', ''],
      ['郑天成', '男', '20260110', '高一(1)班', '郑光明', '13800138020', '马丽娟', '13800138021', '', '']
    ];
    var students = S.map(function (r, i) {
      return {
        id: 'stu' + (i + 1),
        name: r[0], sex: r[1], sno: r[2], klass: r[3],
        fatherName: r[4], fatherPhone: r[5],
        motherName: r[6], motherPhone: r[7],
        otherName: r[8], otherPhone: r[9],
        remark: ''
      };
    });

    var talks = [
      {
        id: 'tk1', date: '2026-10-09', studentId: 'stu2', studentName: '李思远', type: '成绩分析',
        content: '【学生当前状态】月考数学下滑 22 分，情绪低落但态度诚恳。\n【本次谈话核心问题】函数与导数章节基础薄弱，作业完成度下降。\n【学生反馈与承诺】承诺每天额外完成 5 道基础题，主动到办公室问问题。\n【班主任跟进计划】两周后复查错题本，联系数学老师安排课后辅导。',
        followDate: '2026-10-23', followNote: '检查错题本整理情况，与数学老师沟通辅导安排',
        createdAt: '2026-10-09T15:20:00'
      },
      {
        id: 'tk2', date: '2026-10-14', studentId: 'stu4', studentName: '张子谦', type: '心理辅导',
        content: '【学生当前状态】近期课堂注意力不集中，自述睡眠不足、压力大。\n【本次谈话核心问题】与同桌发生摩擦后情绪持续低落，担心影响成绩。\n【学生反馈与承诺】愿意尝试调整作息，表示会主动和对方沟通化解。\n【班主任跟进计划】一周后回访情绪状态，必要时联系家长协助作息管理。',
        followDate: '2026-10-21', followNote: '回访情绪与睡眠情况，必要时联系家长',
        createdAt: '2026-10-14T10:05:00'
      },
      {
        id: 'tk3', date: '2026-10-16', studentId: 'stu1', studentName: '陈亦然', type: '纪律谈话',
        content: '【学生当前状态】承认晚自习两次使用手机，态度配合、表达悔意。\n【本次谈话核心问题】自律意识不足，对班级纪律要求认识不到位。\n【学生反馈与承诺】承诺手机交由班主任代为保管至学期末，接受全班监督。\n【班主任跟进计划】每周日晚自习抽查，月末向家长反馈表现。',
        followDate: '2026-10-26', followNote: '晚自习抽查手机使用情况，月末向家长反馈',
        createdAt: '2026-10-16T16:40:00'
      },
      {
        id: 'tk4', date: '2026-10-20', studentId: 'stu7', studentName: '孙佳怡', type: '日常谈心',
        content: '【学生当前状态】学习状态稳定，担任班级文艺委员后责任感明显增强。\n【本次谈话核心问题】担心文艺活动占用复习时间，希望平衡两者。\n【学生反馈与承诺】承诺制定周计划表，保证每天两小时自习时间。\n【班主任跟进计划】协助制定时间管理表，期中考后复盘执行效果。',
        followDate: '2026-11-10', followNote: '期中考后复盘时间管理表执行情况',
        createdAt: '2026-10-20T09:15:00'
      }
    ];

    var communications = [
      {
        id: 'ct1', date: '2026-10-10', studentId: 'stu2', studentName: '李思远',
        contact: '妈妈', contactName: '王雅琴', way: '电话',
        content: '沟通月考数学成绩下滑情况，说明在校课堂表现与作业完成情况，请家长周末督促基础题训练，减少电子设备使用时间。',
        result: '家长表示会配合监督，周末由父亲负责检查数学作业，同意暂时收手机。',
        createdAt: '2026-10-10T19:30:00'
      },
      {
        id: 'ct2', date: '2026-10-15', studentId: 'stu4', studentName: '张子谦',
        contact: '爸爸', contactName: '张宏', way: '电话',
        content: '反馈孩子近期情绪低落、与同学发生摩擦的情况，了解家庭作息与亲子沟通现状，建议家长关注孩子睡眠与情绪表达。',
        result: '家长反馈孩子晚间常熬夜玩手机，承诺限制就寝前使用，并增加周末户外活动。',
        createdAt: '2026-10-15T20:10:00'
      },
      {
        id: 'ct3', date: '2026-10-18', studentId: 'stu3', studentName: '王雨桐',
        contact: '其他亲属', contactName: '外婆', way: '面谈',
        content: '家访了解学生居家学习环境，孩子父母长期在外务工，平日由外婆照顾，反映孩子英语听力练习缺少设备。',
        result: '已协助申请学校英语听力设备借用，约定每月一次电话回访，外婆负责督促作业签字。',
        createdAt: '2026-10-18T15:00:00'
      },
      {
        id: 'ct4', date: '2026-10-21', studentId: 'stu1', studentName: '陈亦然',
        contact: '妈妈', contactName: '林淑芬', way: '面谈',
        content: '约谈学生晚自习违规使用手机问题，说明班级纪律要求与处理办法，请家长协同做好手机管理。',
        result: '家长同意手机由班主任代为保管至学期末，签署纪律承诺，约定月底再次沟通。',
        createdAt: '2026-10-21T14:20:00'
      }
    ];

    return { students: students, talks: talks, communications: communications };
  }

  /* ---------------- 持久化 ---------------- */
  function persist() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('本地存储写入失败', e);
    }
  }

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } }); }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) { /* 忽略 */ }

    if (raw) {
      try {
        var p = JSON.parse(raw);
        db.students = Array.isArray(p.students) ? p.students : [];
        db.talks = Array.isArray(p.talks) ? p.talks : [];
        db.communications = Array.isArray(p.communications) ? p.communications : [];
        migrateWay();
        return;
      } catch (e) { /* 数据损坏则使用空数据 */ }
    }
    // 不再自动载入示例数据：生产环境从空数据开始（示例数据可在「系统设置→数据管理」手动载入）
    db = { students: [], talks: [], communications: [] };
    persist();
  }

  /* ---------------- 服务器花名册同步 ----------------
     学生信息与管理后台「学生管理」账号绑定：开通账号即自动进入本模块；
     性别/学号/家长联系方式等缺失信息可在「学生信息」页补充编辑（本地保存）。 */
  function syncRoster() {
    var tk = '';
    try { tk = localStorage.getItem('xuexi_admin_token') || localStorage.getItem('xuexi_token') || ''; } catch (e) { /* 忽略 */ }
    return fetch('/api/admin/grades-roster', { headers: tk ? { Authorization: 'Bearer ' + tk } : {} })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.students)) return false;
        // 角色 / 校区列表（运行时，不入盘）
        Store._role = j.data.role || 'admin';
        Store._branches = j.data.branches || [];
        var dirty = false;
        var alive = {};   // 本次花名册中存在的账号学生
        (j.data.students || []).forEach(function (s) {
          var acctId = 'acct' + s.id;
          alive[acctId] = true;
          var hit = null;
          db.students.forEach(function (x) { if (!hit && (x._acctId === acctId || x.id === acctId)) hit = x; });
          if (!hit) {
            // 老数据按姓名归并，避免重复档案
            db.students.forEach(function (x) { if (!hit && !x._acctId && x.name === s.name) hit = x; });
          }
          var campus = s.branch_name || '';
          if (hit) {
            if (hit.name !== s.name) { hit.name = s.name; dirty = true; }
            if (hit._acctId !== acctId) { hit._acctId = acctId; dirty = true; }
            if (!hit.klass && s.grade) { hit.klass = s.grade; dirty = true; }
            if (hit.campus !== campus) { hit.campus = campus; dirty = true; }
          } else {
            db.students.push({
              id: acctId, _acctId: acctId, name: s.name, sex: '', sno: '',
              klass: s.grade || '', campus: campus,
              fatherName: '', fatherPhone: '', motherName: '', motherPhone: '',
              otherName: '', otherPhone: '', remark: ''
            });
            dirty = true;
          }
        });
        // 学生管理已删除/停用的账号学生 → 同步移除（legacy 手工档案不受影响；历史记录保留）
        for (var i = db.students.length - 1; i >= 0; i--) {
          var x = db.students[i];
          if (x._acctId && !alive[x._acctId]) { db.students.splice(i, 1); dirty = true; }
        }
        if (dirty) { persist(); emit(); }
        return true;
      })
      .catch(function (e) { console.warn('花名册同步失败', e); return false; });
  }

  /* 沟通方式迁移：校访/家访/微信 → 面谈/电话 */
  function migrateWay() {
    if (!db.communications.length) return;
    var dirty = false;
    db.communications.forEach(function (c) {
      if (c.way === '校访' || c.way === '家访') { c.way = '面谈'; dirty = true; }
      else if (c.way === '微信') { c.way = '电话'; dirty = true; }
    });
    if (dirty) persist();
  }

  /* ---------------- 通用集合操作 ---------------- */
  function makeRepo(key, prefix) {
    return {
      all: function () { return db[key].slice(); },
      get: function (id) {
        for (var i = 0; i < db[key].length; i++) if (db[key][i].id === id) return db[key][i];
        return null;
      },
      add: function (obj) {
        obj.id = obj.id || uid(prefix);
        obj.createdAt = obj.createdAt || new Date().toISOString();
        db[key].unshift(obj);
        persist(); emit();
        return obj;
      },
      update: function (id, patch) {
        var it = this.get(id);
        if (!it) return null;
        Object.keys(patch).forEach(function (k) { it[k] = patch[k]; });
        persist(); emit();
        return it;
      },
      remove: function (id) {
        var before = db[key].length;
        db[key] = db[key].filter(function (o) { return o.id !== id; });
        if (db[key].length !== before) { persist(); emit(); }
        return db[key].length !== before;
      },
      setAll: function (list) { db[key] = list; persist(); emit(); }
    };
  }

  var Store = {
    students: makeRepo('students', 'stu'),
    talks: makeRepo('talks', 'tk'),
    communications: makeRepo('communications', 'ct'),

    on: function (fn) { listeners.push(fn); },
    emit: emit,
    load: load,
    syncRoster: syncRoster,

    /* 校区：来自花名册；多校区时前端显示筛选 */
    role: function () { return Store._role || 'admin'; },
    campuses: function () {
      var arr = [];
      db.students.forEach(function (s) {
        if (s.campus && arr.indexOf(s.campus) < 0) arr.push(s.campus);
      });
      return arr;
    },
    isMultiCampus: function () { return Store.campuses().length > 1; },
    /* 全局校区筛选（顶栏切换器，作用于学生/谈话/沟通三个列表） */
    campusFilter: function (v) {
      if (typeof v === 'string') Store._campusFilter = v;
      return Store._campusFilter || '';
    },

    loadDemo: function () { db = demoData(); persist(); emit(); },
    clearAll: function () { db = { students: [], talks: [], communications: [] }; persist(); emit(); },

    backup: function () { return JSON.stringify(db, null, 2); },
    restore: function (json) {
      var p = JSON.parse(json);
      if (!p || typeof p !== 'object') throw new Error('文件格式不正确');
      db.students = Array.isArray(p.students) ? p.students : [];
      db.talks = Array.isArray(p.talks) ? p.talks : [];
      db.communications = Array.isArray(p.communications) ? p.communications : [];
      persist(); emit();
    },
    stat: function () {
      return { students: db.students.length, talks: db.talks.length, communications: db.communications.length };
    },

    /* ---------------- 设置 ---------------- */
    settings: function (patch) {
      var cur = { aiMode: 'local', aiUrl: '', aiKey: '', aiModel: 'gpt-4o-mini', asrUrl: '', asrKey: '', asrModel: 'whisper-1' };
      try {
        var raw = localStorage.getItem(SET_KEY);
        if (raw) cur = Object.assign(cur, JSON.parse(raw));
      } catch (e) { /* 忽略 */ }
      if (patch) {
        cur = Object.assign(cur, patch);
        try { localStorage.setItem(SET_KEY, JSON.stringify(cur)); } catch (e) { /* 忽略 */ }
      }
      return cur;
    },

    uid: uid
  };

  global.App = global.App || {};
  global.App.store = Store;
})(window);
