/* ============================================================
 * store.js —— 本地数据层（localStorage）
 *   三张表：students / talks / communications
 * ============================================================ */
(function (global) {
  'use strict';

  var DATA_KEY = '';
  var SET_KEY = '';

  var db = { students: [], talks: [], communications: [] };
  var listeners = [];

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // 原示例含未经核实的个人资料，不随恢复包分发或自动载入。
  var session = null;
  var generation = 0;
  var lockListeners = [];
  function emptyData() { return { students: [], talks: [], communications: [] }; }
  function token() {
    try { return localStorage.getItem('xuexi_admin_token') || ''; }
    catch (_) { throw new Error('无法读取登录状态，请允许本地存储后刷新'); }
  }
  function lock(message) {
    generation++;
    session = null;
    db = emptyData();
    Store._role = ''; Store._branches = []; Store._campusFilter = '';
    lockListeners.forEach(function (fn) { fn(message || '登录账号已变更，请重新登录并刷新'); });
  }
  function requireSession() {
    if (!session || token() !== session.token) {
      lock();
      throw new Error('登录账号已变更或尚未验证，请重新登录并刷新');
    }
  }
  function checkRequest(g, tk) {
    if (generation !== g || token() !== tk) throw new Error('登录账号已变更，请刷新');
  }
  function request(url, tk) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('登录验证或花名册读取失败，请重新登录后刷新');
        return r.json();
      }).then(function (j) {
        if (!j || j.code !== 0 || !j.data) throw new Error('登录验证或花名册读取失败，请刷新重试');
        return j.data;
      });
  }
  function parseData(raw) {
    if (!raw) return emptyData();
    var p;
    try { p = JSON.parse(raw); } catch (_) { throw new Error('本地记录格式损坏，已保留原数据，请先核对备份'); }
    if (!p || !Array.isArray(p.students) || !Array.isArray(p.talks) || !Array.isArray(p.communications)) {
      throw new Error('本地记录格式不正确，已保留原数据');
    }
    ['students', 'talks', 'communications'].forEach(function (key) {
      var seen = Object.create(null);
      p[key].forEach(function (row) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id || seen[row.id]) {
          throw new Error('本地记录格式不正确（缺少有效唯一ID），原数据未改变');
        }
        if (key === 'students' && (typeof row.name !== 'string' || !row.name.trim())) throw new Error('学生姓名字段格式不正确，原记录未改变');
        var textFields = ['name', 'sex', 'sno', 'klass', 'fatherName', 'fatherPhone', 'motherName', 'motherPhone',
          'otherName', 'otherPhone', 'remark', 'campus', '_acctId', 'date', 'studentId', 'studentName', 'type',
          'content', 'followDate', 'followNote', 'createdAt', 'contact', 'contactName', 'contactPhone', 'way', 'result', 'audioUrl'];
        textFields.forEach(function (field) {
          if (row[field] != null && typeof row[field] !== 'string') throw new Error('本地记录字段格式不正确：' + field);
        });
        seen[row.id] = true;
      });
    });
    return p;
  }
  global.addEventListener('storage', function (e) {
    if (!e.key || e.key === 'xuexi_admin_token' || e.key === DATA_KEY || e.key === SET_KEY) lock('账号或本机数据已在其他页面更新，请刷新');
  });

  /* ---------------- 持久化 ---------------- */
  function persist() {
    requireSession();
    if (localStorage.getItem(DATA_KEY) !== session.raw) {
      lock('本机数据已在其他页面更新，请刷新后重试');
      throw new Error('本机数据已在其他页面更新，请刷新后重试');
    }
    try {
      var raw = JSON.stringify(db);
      localStorage.setItem(DATA_KEY, raw);
      session.raw = raw;
    }
    catch (_) {
      db = parseData(session.raw);
      throw new Error('本地存储保存失败，草稿尚未保存；请保留当前输入并检查空间');
    }
  }

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } }); }

  function load() {
    var g = ++generation;
    session = null; db = emptyData();
    var tk;
    try { tk = token(); } catch (e) { return Promise.reject(e); }
    if (!tk) return Promise.reject(new Error('请先登录管理后台，再打开班主任工作台'));
    var user;
    return request('/api/me', tk).then(function (u) {
      checkRequest(g, tk);
      if (!Number.isSafeInteger(u.id) || u.id <= 0 || ['admin', 'branch'].indexOf(u.role) < 0) {
        throw new Error('当前账号无权打开班主任工作台');
      }
      user = u;
      return request('/api/admin/grades-roster', tk);
    }).then(function (roster) {
      checkRequest(g, tk);
      if (roster.role !== user.role || !Array.isArray(roster.students)) throw new Error('花名册格式不正确，请刷新重试');
      DATA_KEY = 'bzw.data.v2:' + user.role + ':' + user.id;
      SET_KEY = 'bzw.settings.v2:' + user.role + ':' + user.id;
      var raw = localStorage.getItem(DATA_KEY);
      var loaded = parseData(raw);
      session = { token: tk, id: user.id, role: user.role, raw: raw };
      db = loaded;
      applyRoster(roster);
      migrateWay();
      persist();
      return true;
    }).catch(function (e) {
      if (generation === g) lock(e.message);
      throw e;
    });
  }

  /* ---------------- 服务器花名册同步 ----------------
     学生信息与管理后台「学生管理」账号绑定：开通账号即自动进入本模块；
     性别/学号/家长联系方式等缺失信息可在「学生信息」页补充编辑（本地保存）。 */
  function applyRoster(roster) {
    // 角色 / 校区列表（运行时，不入盘）
    Store._role = roster.role;
    Store._branches = roster.branches || [];
    var dirty = false;
    var alive = {};   // 本次花名册中存在的账号学生
    (roster.students || []).forEach(function (s) {
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
  }
  function syncRoster() {
    requireSession();
    var g = generation, tk = session.token, role = session.role;
    return request('/api/admin/grades-roster', tk).then(function (roster) {
      checkRequest(g, tk); requireSession();
      if (roster.role !== role || !Array.isArray(roster.students)) throw new Error('花名册格式不正确');
      applyRoster(roster); persist(); emit(); return true;
    }).catch(function (e) { if (generation === g) lock(e.message); throw e; });
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
      all: function () { requireSession(); return db[key].slice(); },
      get: function (id) {
        requireSession();
        for (var i = 0; i < db[key].length; i++) if (db[key][i].id === id) return db[key][i];
        return null;
      },
      add: function (obj) {
        requireSession();
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
        requireSession();
        var before = db[key].length;
        db[key] = db[key].filter(function (o) { return o.id !== id; });
        if (db[key].length !== before) { persist(); emit(); }
        return db[key].length !== before;
      },
      setAll: function (list) { requireSession(); db[key] = list; persist(); emit(); }
    };
  }

  var Store = {
    students: makeRepo('students', 'stu'),
    talks: makeRepo('talks', 'tk'),
    communications: makeRepo('communications', 'ct'),

    on: function (fn) { listeners.push(fn); },
    onLock: function (fn) { lockListeners.push(fn); },
    hasLegacyData: function () { requireSession(); return !!(localStorage.getItem('bzw.data.v1') || localStorage.getItem('bzw.settings.v1')); },
    emit: emit,
    load: load,
    syncRoster: syncRoster,

    /* 校区：来自花名册；多校区时前端显示筛选 */
    role: function () { requireSession(); return Store._role; },
    campuses: function () {
      requireSession();
      var arr = [];
      db.students.forEach(function (s) {
        if (s.campus && arr.indexOf(s.campus) < 0) arr.push(s.campus);
      });
      return arr;
    },
    isMultiCampus: function () { return Store.campuses().length > 1; },
    /* 全局校区筛选（顶栏切换器，作用于学生/谈话/沟通三个列表） */
    campusFilter: function (v) {
      requireSession();
      if (typeof v === 'string') Store._campusFilter = v;
      return Store._campusFilter || '';
    },

    loadDemo: function () { throw new Error('本恢复版本不提供未经核实的示例数据'); },
    clearAll: function () { requireSession(); db = { students: [], talks: [], communications: [] }; persist(); emit(); },

    backup: function () { requireSession(); return JSON.stringify(db, null, 2); },
    restore: function (json) {
      requireSession();
      if (typeof json !== 'string' || !json.trim()) throw new Error('导入文件格式不正确，原记录未改变');
      var loaded = parseData(json);
      db = loaded; persist(); emit();
    },
    stat: function () {
      requireSession();
      return { students: db.students.length, talks: db.talks.length, communications: db.communications.length };
    },

    /* ---------------- 设置 ---------------- */
    settings: function (patch) {
      requireSession();
      var cur = { aiMode: 'local', aiUrl: '', aiKey: '', aiModel: 'gpt-4o-mini', asrUrl: '', asrKey: '', asrModel: 'whisper-1' };
      try {
        var raw = localStorage.getItem(SET_KEY);
        if (raw) cur = Object.assign(cur, JSON.parse(raw));
      } catch (e) { throw new Error('本地设置格式损坏或无法读取，已保留原数据'); }
      if (patch) {
        cur = Object.assign(cur, patch);
        try { localStorage.setItem(SET_KEY, JSON.stringify(cur)); }
        catch (_) { throw new Error('设置保存失败，请检查本地存储空间'); }
      }
      return cur;
    },

    uid: uid
  };

  global.App = global.App || {};
  global.App.store = Store;
})(window);
