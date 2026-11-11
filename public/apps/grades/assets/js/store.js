/* ==========================================================
   数据层：校区 / 考试批次 / 成绩记录（localStorage 持久化）
   ========================================================== */
const Store = (() => {
  const KEY = 'campus_grade_db_v1';
  const KEY_CUR = 'campus_grade_current_v1';

  /* localStorage 安全封装：兼容 file:// 打开、隐私模式等不可用场景 */
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  const state = {
    campuses: [],      // {id,name}
    exams: [],         // {id,campusId,name,date,type,createdAt}
    records: [],       // {id,examId,campusId,studentName,stage,grade,className,subject,type,fullScore,score,classRank,gradeRank,comment,date}
    students: [],      // {id,campusId,name,stage,grade,className}
    papers: [],        // 试卷快照与知识点打点 {id,examId,campusId,subject,images:[{name,dataUrl}],questions:[{no,knowledge,full,avgScore,scores:{姓名:得分}}],createdAt}
    parentUploads: []  // 家长扫码上报待审核 {id,campusId,examId,studentName,subject,fullScore,score,comment,createdAt,status}
  };
  let currentCampusId = null;

  /* ---------------- 持久化 ---------------- */
  function load() {
    try {
      const raw = LS.get(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        state.campuses = d.campuses || [];
        state.exams = d.exams || [];
        state.records = d.records || [];
        state.students = d.students || [];
        state.papers = d.papers || [];
        state.parentUploads = d.parentUploads || [];
      }
    } catch (e) { console.warn('数据读取失败', e); }
    currentCampusId = LS.get(KEY_CUR);
    if (!state.campuses.find(c => c.id === currentCampusId)) {
      currentCampusId = state.campuses.length ? state.campuses[0].id : null;
    }
    return state;
  }
  function save() {
    try { LS.set(KEY, JSON.stringify(state)); }
    catch (e) { U.toast('本地存储写入失败，数据量可能过大', 'err'); }
    if (currentCampusId) LS.set(KEY_CUR, currentCampusId);
  }
  const reset = () => {
    state.campuses = []; state.exams = []; state.records = []; state.students = [];
    state.papers = []; state.parentUploads = [];
    currentCampusId = null; save();
  };

  /* ---------------- 校区 ---------------- */
  const campuses = () => state.campuses;
  const campus = (id) => state.campuses.find(c => c.id === (id || currentCampusId)) || null;
  const campusName = (id) => (campus(id) ? campus(id).name : '未选择校区');
  const currentId = () => currentCampusId;
  const setCurrent = (id) => { currentCampusId = id; LS.set(KEY_CUR, id); };

  function addCampus(name) {
    name = String(name || '').trim();
    if (!name) return null;
    if (state.campuses.some(c => c.name === name)) { U.toast('该校区已存在', 'err'); return null; }
    const c = { id: U.uid('cp'), name };
    state.campuses.push(c);
    if (!currentCampusId) currentCampusId = c.id;
    save(); return c;
  }
  function renameCampus(id, name) {
    const c = campus(id); if (!c) return;
    c.name = String(name || '').trim() || c.name; save();
  }
  function removeCampus(id) {
    const i = state.campuses.findIndex(c => c.id === id);
    if (i < 0) return;
    state.campuses.splice(i, 1);
    state.exams = state.exams.filter(e => e.campusId !== id);
    state.records = state.records.filter(r => r.campusId !== id);
    state.students = state.students.filter(s => s.campusId !== id);
    state.papers = state.papers.filter(p => p.campusId !== id);
    state.parentUploads = state.parentUploads.filter(u => u.campusId !== id);
    if (currentCampusId === id) currentCampusId = state.campuses.length ? state.campuses[0].id : null;
    save();
  }

  /* ---------------- 考试批次 ---------------- */
  const exams = (campusId) => state.exams
    .filter(e => e.campusId === (campusId || currentCampusId))
    .slice().sort(U.byDateAsc);
  const exam = (id) => state.exams.find(e => e.id === id) || null;

  function addExam({ campusId, name, date, type }) {
    campusId = campusId || currentCampusId;
    const exist = state.exams.find(e => e.campusId === campusId && e.name === name && e.date === date);
    if (exist) return exist;
    const e = { id: U.uid('ex'), campusId, name: String(name || '未命名考试'), date: date || U.today(), type: type || '其他', createdAt: Date.now() };
    state.exams.push(e); save(); return e;
  }
  function updateExam(id, patch) {
    const e = exam(id); if (!e) return;
    Object.assign(e, patch); save();
  }
  function deleteExam(id) {
    state.exams = state.exams.filter(e => e.id !== id);
    state.records = state.records.filter(r => r.examId !== id);
    state.papers = state.papers.filter(p => p.examId !== id);
    save();
  }

  /* ---------------- 成绩记录 ---------------- */
  const records = (opt = {}) => {
    const cid = opt.campusId || currentCampusId;
    return state.records.filter(r => {
      if (cid && r.campusId !== cid) return false;
      if (opt.examId && r.examId !== opt.examId) return false;
      if (opt.studentName && r.studentName !== opt.studentName) return false;
      if (opt.subject && r.subject !== opt.subject) return false;
      if (opt.type && r.type !== opt.type) return false;
      if (opt.stage && r.stage !== opt.stage) return false;
      if (opt.from && String(r.date) < opt.from) return false;
      if (opt.to && String(r.date) > opt.to) return false;
      if (opt.year && String(r.date).slice(0, 4) !== String(opt.year)) return false;
      return true;
    });
  };
  const allRecords = () => state.records;

  /** 学生 key：校区 + 姓名 */
  const stuKey = (campusId, name) => campusId + '::' + name;

  /* ---------------- 服务器花名册同步 ----------------
     校区 = 管理后台「分校管理」里开通的分校（id 稳定映射为 br<分校id>）
     学生 = 管理后台「学生管理」开通的账号（自动进入对应分校的学生档案） */
  const roster = { branches: [], students: [] };
  const stageText = (s) => (s === 'primary' ? '小学' : s === 'junior' ? '初中' : '');

  function applyRoster() {
    const camps = (roster.branches || []).map(b => ({ id: 'br' + b.id, name: b.name }));
    if (!camps.length) camps.push({ id: 'br0', name: '总校' });
    state.campuses = camps;
    if (!state.campuses.find(c => c.id === currentCampusId)) currentCampusId = state.campuses[0].id;
    LS.set(KEY_CUR, currentCampusId);
    syncStudents(); save();
  }

  async function syncRoster() {
    try {
      // 管理端 token 存在 xuexi_admin_token，学生端为 xuexi_token，两者都试
      const tk = LS.get('xuexi_admin_token') || LS.get('xuexi_token') || '';
      const r = await fetch('/api/admin/grades-roster', { headers: tk ? { Authorization: 'Bearer ' + tk } : {} });
      const j = await r.json();
      if (j && j.code === 0 && j.data) {
        roster.branches = j.data.branches || [];
        roster.students = j.data.students || [];
        applyRoster();
        return true;
      }
    } catch (e) { console.warn('花名册同步失败', e); }
    return false;
  }

  /** 同步学生档案表（服务器账号 + 成绩记录派生，有成绩以成绩为准） */
  function syncStudents() {
    const map = new Map();
    const defCid = state.campuses.length ? state.campuses[0].id : null;
    (roster.students || []).forEach(s => {
      const want = 'br' + (s.created_by == null ? '' : s.created_by);
      const cid = state.campuses.find(c => c.id === want) ? want : defCid;
      if (!cid) return;
      const k = stuKey(cid, s.name);
      if (!map.has(k)) map.set(k, {
        id: k, campusId: cid, name: s.name,
        stage: [stageText(s.stage), s.grade || ''].filter(Boolean).join('·'),
        grade: s.grade || '', className: '', lastDate: ''
      });
    });
    state.records.forEach(r => {
      const k = stuKey(r.campusId, r.studentName);
      const cur = map.get(k);
      if (!cur || String(r.date) > String(cur.lastDate)) {
        map.set(k, {
          id: k, campusId: r.campusId, name: r.studentName,
          stage: r.stage || '', grade: r.grade || '', className: r.className || '', lastDate: r.date
        });
      }
    });
    state.students = Array.from(map.values());
  }
  const students = (campusId) => {
    syncStudents();
    const cid = campusId || currentCampusId;
    return state.students.filter(s => !cid || s.campusId === cid)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  };
  const student = (key) => { syncStudents(); return state.students.find(s => s.id === key) || null; };

  // Only classification fields determine scope; shared subjects and free-text comments remain valid.
  // Do not normalize saved history: loading, displaying and exporting old records stays lossless.
  function scopeError(record = {}) {
    const normalize = value => String(value == null ? '' : value).normalize('NFKC');
    const senior = value => /senior|高中|高[一二三123]|(?:10|11|12|十|十一|十二)年级/i.test(normalize(value).replace(/[\s\u3000]/g, ''));
    // A class label may contain 提高一班 / 提高1班. Only a separate school-stage label counts here.
    const seniorClass = /(?:^|[\s·•/|,，;；:：()（）【】\[\]_-])(?:senior(?:$|[^a-z])|高\s*中|高\s*[一二三123]|(?:10|11|12|十|十一|十二)\s*年级)/i.test(normalize(record.className));
    return ['stage', 'grade'].some(field => senior(record[field])) || seniorClass
      ? '仅支持小学和初中，请核对学段、年级和班级' : '';
  }
  function addRecords(list) {
    const error = list.map(scopeError).find(Boolean);
    if (error) { U.toast(error, 'err'); return false; }
    list.forEach(r => {
      r.id = r.id || U.uid('rc');
      r.campusId = r.campusId || currentCampusId;
      r.date = r.date || U.today();
      state.records.push(r);
    });
    syncStudents(); save(); return true;
  }
  function updateRecord(id, patch) {
    const r = state.records.find(x => x.id === id);
    if (!r) return false;
    const error = scopeError(r) ? '历史高中成绩仅保留查看，不能修改或覆盖' : scopeError({ ...r, ...patch });
    if (error) { U.toast(error, 'err'); return false; }
    Object.assign(r, patch); save(); return true;
  }
  function deleteRecord(id) {
    state.records = state.records.filter(r => r.id !== id);
    syncStudents(); save();
  }
  function deleteRecordsByExam(examId) {
    state.records = state.records.filter(r => r.examId !== examId);
    syncStudents(); save();
  }
  function clearCampus(campusId) {
    const cid = campusId || currentCampusId;
    state.exams = state.exams.filter(e => e.campusId !== cid);
    state.records = state.records.filter(r => r.campusId !== cid);
    state.students = state.students.filter(s => s.campusId !== cid);
    state.papers = state.papers.filter(p => p.campusId !== cid);
    state.parentUploads = state.parentUploads.filter(u => u.campusId !== cid);
    save();
  }

  /* ---------------- 试卷快照 / 知识点打点 ---------------- */
  const papers = (campusId, examId) => state.papers.filter(p =>
    p.campusId === (campusId || currentCampusId) && (!examId || p.examId === examId));

  const paper = (examId, subject) => state.papers.find(p => p.examId === examId && p.subject === subject) || null;

  function savePaper(p) {
    const exist = state.papers.find(x => x.examId === p.examId && x.subject === p.subject);
    if (exist) {
      Object.assign(exist, p, { id: exist.id, createdAt: exist.createdAt || Date.now() });
      save(); return exist;
    }
    const np = Object.assign({ id: U.uid('pp'), createdAt: Date.now(), images: [], questions: [] }, p);
    state.papers.push(np); save(); return np;
  }
  function deletePaper(id) {
    state.papers = state.papers.filter(p => p.id !== id); save();
  }
  function papersWithData(campusId) {
    return papers(campusId).filter(p => (p.questions || []).length > 0);
  }

  /* ---------------- 家长扫码上报 ---------------- */
  const parentUploads = (campusId) => state.parentUploads.filter(u =>
    !campusId || u.campusId === campusId);
  const pendingUploads = (campusId) => parentUploads(campusId).filter(u => u.status === 'pending');

  function addParentUpload(list) {
    const error = list.map(scopeError).find(Boolean);
    if (error) { U.toast(error, 'err'); return false; }
    list.forEach(u => {
      state.parentUploads.push(Object.assign({
        id: U.uid('pu'), createdAt: Date.now(), status: 'pending'
      }, u));
    });
    save(); return true;
  }
  function setUploadStatus(id, status) {
    const u = state.parentUploads.find(x => x.id === id);
    if (!u) return false;
    const error = status === 'approved' ? scopeError(u) : '';
    if (error) { U.toast(error, 'err'); return false; }
    u.status = status; save(); return true;
  }
  function removeUpload(id) {
    state.parentUploads = state.parentUploads.filter(u => u.id !== id); save();
  }

  /* ---------------- 派生字典（筛选器用） ---------------- */
  function facets(campusId) {
    const rs = records({ campusId: campusId || currentCampusId });
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh'));
    return {
      stages: uniq(rs.map(r => r.stage).concat(rs.map(r => r.grade))),
      subjects: uniq(rs.map(r => r.subject)),
      types: uniq(rs.map(r => r.type)),
      years: uniq(rs.map(r => String(r.date || '').slice(0, 4))).sort().reverse(),
      months: uniq(rs.map(r => String(r.date || '').slice(0, 7))).sort().reverse()
    };
  }

  /* ==========================================================
     示例数据
     ========================================================== */
  /** 将总分拆分到各科（保证各科之和等于总分，使趋势判定稳定可信） */
  function splitScores(total, weights, offset, fulls) {
    const s = weights.map((w, i) => {
      const v = Math.round(total * w + offset[i]);
      return Math.min(fulls[i], Math.max(25, v));
    });
    let d = total - s.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (d !== 0 && guard++ < 400) {
      let moved = false;
      for (let i = 0; i < s.length && d !== 0; i++) {
        const step = d > 0 ? 1 : -1;
        const nv = s[i] + step;
        if (nv >= 25 && nv <= fulls[i]) { s[i] = nv; d -= step; moved = true; }
      }
      if (!moved) break;
    }
    return s;
  }

  function seed(force) {
    if (state.records.length && !force) { U.toast('已有数据，未重复载入'); return; }
    if (force) reset();

    const cpA = addCampus('城南校区');
    const cpB = addCampus('城北校区');

    // ---- 城南校区：初中七年级，5 次考试 ----
    const examsA = [
      { name: '9月单元测', date: '2025-09', type: '单元测' },
      { name: '10月月考', date: '2025-10', type: '月考' },
      { name: '期中考试', date: '2025-11', type: '期中' },
      { name: '12月单元测', date: '2025-12', type: '单元测' },
      { name: '期末考试', date: '2026-01', type: '期末' }
    ];
    const namesA = ['陈子涵', '林思远', '赵一诺', '孙雨桐', '周嘉懿', '吴宇轩',
      '郑心怡', '王梓睿', '李沐辰', '何书瑶', '徐浩然', '马语汐'];
    // 趋势类型：up 稳步进步 / down 持续退步 / wave 波动 / flat 稳定
    // 退步人数设为 7 人，便于演示「显示更多 / 小滚动条」
    const slopes = ['up', 'up', 'down', 'down', 'down', 'down', 'down', 'down', 'wave', 'flat', 'up', 'down'];
    const baseA = [300, 292, 312, 318, 296, 305, 288, 310, 300, 302, 279, 315];
    const subjectsA = ['语文', '数学', '英语'];
    const fullA = { 语文: 120, 数学: 120, 英语: 120 };
    const wA = [0.34, 0.33, 0.33];
    const fullsA = [120, 120, 120];

    const commentPool = {
      up: ['本次较上次明显提升，基础知识扎实，继续保持错题整理的习惯。',
        '进步显著，课堂专注度提高，建议适当增加压轴题训练。',
        '状态稳定向上，计算失误明显减少，下一步重点突破阅读理解。'],
      down: ['本次成绩下滑，主要失分在基础题，需加强课后巩固与错题复盘。',
        '退步明显，近段时间作业完成质量下降，已与家长沟通，需共同督促。',
        '知识点遗忘较多，建议本周内完成薄弱环节专项练习。'],
      wave: ['成绩起伏较大，发挥不稳定，需重视考试心态与审题习惯。',
        '本次回升，但波动明显，建议固定每日复习节奏，避免临时突击。',
        '学科间不均衡，优势科目保持、弱势科目需补课跟进。'],
      flat: ['成绩基本稳定，建议在此基础上提升解题速度，争取突破。',
        '保持平稳，无明显波动，可尝试更高难度的综合训练。',
        '稳定发挥，注意书写规范与答题格式，避免非智力失分。']
    };

    examsA.forEach((ex, ei) => {
      const e = addExam({ campusId: cpA.id, name: ex.name, date: ex.date, type: ex.type });
      const totals = [];
      namesA.forEach((nm, i) => {
        const slope = slopes[i];
        // 构造总分随考试次数的变化（严格单调递增 / 递减 / 波动 / 平稳）
        let t = baseA[i];
        if (slope === 'up') t += ei * 8;
        else if (slope === 'down') t -= ei * 8;
        else if (slope === 'wave') t += [0, 12, -6, 10, -4][ei];
        else t += [0, 2, 0, 2, 1][ei];
        t = Math.max(150, Math.min(350, Math.round(t)));
        totals.push({ name: nm, total: t, slope });

        // 拆科：保持稳定不变的个人科目偏好，且三科之和等于总分
        const o0 = ((i % 3) - 1) * 5, o1 = (i % 2 ? 6 : -6);
        const offset = [o0, o1, -(o0 + o1)];
        const scores = splitScores(t, wA, offset, fullsA);
        subjectsA.forEach((sub, si) => {
          // 第三次单元测：老师未写评语（用于演示"未写总结"提示）
          const hasComment = !(ei === 3) && ((i + ei) % 5 !== 0);
          state.records.push({
            id: U.uid('rc'), examId: e.id, campusId: cpA.id, date: e.date,
            studentName: nm, stage: '初中·七年级', grade: '七年级', className: '七(1)班',
            subject: sub, type: ex.type, fullScore: fullA[sub], score: scores[si],
            classRank: null, gradeRank: null,
            comment: hasComment ? commentPool[slope][(i + ei) % 3] : ''
          });
        });
      });
      // 名次：按总分降序
      totals.sort((a, b) => b.total - a.total);
      totals.forEach((o, idx) => {
        state.records.filter(r => r.examId === e.id && r.studentName === o.name).forEach(r => {
          r.classRank = idx + 1;
          r.gradeRank = idx * 3 + 1 + (o.name.length % 3);
        });
      });
    });

    // ---- 城北校区：小学六年级，4 次考试 ----
    const examsB = [
      { name: '9月单元测', date: '2025-09', type: '单元测' },
      { name: '期中考试', date: '2025-11', type: '期中' },
      { name: '12月月考', date: '2025-12', type: '月考' },
      { name: '期末考试', date: '2026-01', type: '期末' }
    ];
    const namesB = ['黄子谦', '刘诗涵', '杨明轩', '朱家怡', '胡俊熙', '曾雅静'];
    const slopesB = ['up', 'wave', 'down', 'flat', 'up', 'wave'];
    const baseB = [258, 246, 268, 252, 262, 240];
    const subjectsB = ['语文', '数学', '英语'];
    const fullB = { 语文: 100, 数学: 100, 英语: 100 };
    const wB = [0.35, 0.33, 0.32];
    const fullsB = [100, 100, 100];

    examsB.forEach((ex, ei) => {
      const e = addExam({ campusId: cpB.id, name: ex.name, date: ex.date, type: ex.type });
      const totals = [];
      namesB.forEach((nm, i) => {
        const slope = slopesB[i];
        let t = baseB[i];
        if (slope === 'up') t += ei * 7;
        else if (slope === 'down') t -= ei * 7;
        else if (slope === 'wave') t += [0, 10, -5, 8][ei];
        else t += [0, 2, 0, 2][ei];
        t = Math.max(150, Math.min(296, Math.round(t)));
        totals.push({ name: nm, total: t });
        const o0 = ((i % 3) - 1) * 4, o1 = (i % 2 ? 5 : -5);
        const offset = [o0, o1, -(o0 + o1)];
        const scores = splitScores(t, wB, offset, fullsB);
        subjectsB.forEach((sub, si) => {
          const sc = scores[si];
          const hasComment = (i + ei) % 4 !== 0;
          state.records.push({
            id: U.uid('rc'), examId: e.id, campusId: cpB.id, date: e.date,
            studentName: nm, stage: '小学·六年级', grade: '六年级', className: '六(2)班',
            subject: sub, type: ex.type, fullScore: fullB[sub], score: sc,
            classRank: null, gradeRank: null,
            comment: hasComment ? commentPool[slope][(i + ei) % 3] : ''
          });
        });
      });
      totals.sort((a, b) => b.total - a.total);
      totals.forEach((o, idx) => {
        state.records.filter(r => r.examId === e.id && r.studentName === o.name).forEach(r => {
          r.classRank = idx + 1;
          r.gradeRank = idx * 4 + 1;
        });
      });
    });

    syncStudents(); save();
    setCurrent(cpA.id);
    U.toast('示例数据已载入', 'ok');
  }

  return {
    state, load, save, reset, seed, syncRoster,
    campuses, campus, campusName, currentId, setCurrent, addCampus, renameCampus, removeCampus,
    exams, exam, addExam, updateExam, deleteExam, deleteRecordsByExam,
    records, allRecords, scopeError, addRecords, updateRecord, deleteRecord, clearCampus,
    students, student, stuKey, facets,
    papers, paper, savePaper, deletePaper, papersWithData,
    parentUploads, pendingUploads, addParentUpload, setUploadStatus, removeUpload
  };
})();
