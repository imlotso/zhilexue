/**
 * 学习报告（管理端 · 组织管理）
 * 三类报告共用的校区/学生筛选逻辑与词书进度一致：
 *   分校账号只能看自己开通的学生；总校长可按校区筛选（all=全部 / none=总校 / <分校用户id>）。
 *   GET /videos            视频学习报告（按学生汇总知识点观看进度）
 *   GET /videos/:id/detail 某学生的知识点观看明细
 *   GET /exercises         习题学习报告（按学生汇总做题/错题/试卷）
 *   GET /exercises/:id/detail 某学生的做题明细（试卷 + 最近作答 + 学科统计）
 */
const express = require('express');
const { db } = require('./db');
const { presentAttempt } = require('./paper-attempt');
const { decodeDrawing } = require('./drawing-answer');

const admin = express.Router();
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败', code = 1) => res.json({ code, msg });

const SUBJECTS = ['数学', '英语', '物理', '化学'];

/** 学生列表 + 校区过滤（与 word.js /progress 完全同一套规则） */
function studentsOf(req) {
  const isPrincipal = req.user.role === 'admin';
  const branchSel = String(req.query.branch || 'all');
  let rows = db.prepare(`
    SELECT s.id, s.username, s.name, s.grade, s.stage, s.term, s.status, s.expire_at, s.last_login,
      c.id AS creator_id, c.name AS creator_name, c.role AS creator_role
    FROM users s LEFT JOIN users c ON s.created_by = c.id
    WHERE s.role = 'student' ORDER BY s.id DESC`).all();
  if (!isPrincipal) {
    rows = rows.filter((r) => r.creator_id === req.user.id);
  } else if (branchSel === 'none') {
    rows = rows.filter((r) => !r.creator_id || r.creator_role === 'admin');
  } else if (branchSel !== 'all') {
    rows = rows.filter((r) => r.creator_id === Number(branchSel));
  }
  return rows.map((s) => ({
    ...s,
    branch: s.creator_role === 'branch' ? (s.creator_name || '分校') : '总校',
  }));
}

const kwFilter = (rows, kw) => {
  const k = String(kw || '').trim().toLowerCase();
  if (!k) return rows;
  return rows.filter((s) => String(s.name || '').toLowerCase().includes(k) || String(s.username || '').toLowerCase().includes(k));
};

/** 把对象数组转成固定学科顺序的数组（缺的学科补 0） */
const subjectChips = (map) => SUBJECTS.map((sub) => {
  const st = map[sub] || { n: 0, correct: 0, done: 0 };
  return { subject: sub, n: st.n || 0, correct: st.correct || 0, done: st.done || 0 };
});

// ================================================================ 视频学习报告
admin.get('/videos', (req, res) => {
  const students = kwFilter(studentsOf(req), req.query.kw);
  // 每个学生的知识点观看汇总
  const agg = new Map();   // user_id -> { total, done, handout, last_at, subjects:{} }
  for (const p of db.prepare('SELECT user_id, video_done, handout_done, subject, updated_at FROM progress').all()) {
    let a = agg.get(p.user_id);
    if (!a) agg.set(p.user_id, a = { total: 0, done: 0, handout: 0, last_at: '', subjects: {} });
    a.total++;
    if (Number(p.video_done) === 1) a.done++;
    if (Number(p.handout_done) === 1) a.handout++;
    if (p.updated_at > a.last_at) a.last_at = p.updated_at;
    const sub = p.subject || '其他';
    const sm = a.subjects[sub] || (a.subjects[sub] = { n: 0, correct: 0, done: 0 });
    sm.n++; if (Number(p.video_done) === 1) sm.done++;
  }
  // 平台知识点总数（按学生可见范围会因学段不同，这里给全量做参考）
  const totalVideos = Number((db.prepare('SELECT COUNT(*) n FROM videos').get() || {}).n || 0);
  const list = students.map((s) => {
    const a = agg.get(s.id) || { total: 0, done: 0, handout: 0, last_at: '', subjects: {} };
    return {
      ...s, total_videos: totalVideos,
      started: a.total, watched: a.done, handouts: a.handout,
      last_at: a.last_at, subjects: subjectChips(a.subjects),
    };
  });
  ok(res, { list, subjects: SUBJECTS });
});

admin.get('/videos/:id/detail', (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT id, username, name, grade, stage, term, expire_at, status, last_login, created_by FROM users WHERE id=? AND role='student'").get(id);
  if (!s) return fail(res, '学生不存在');
  if (req.user.role !== 'admin' && Number(s.created_by) !== Number(req.user.id)) return fail(res, '无权查看该学生', 403);
  delete s.created_by;
  const rows = db.prepare(`
    SELECT p.video_id, p.video_done, p.handout_done, p.subject, p.category, p.updated_at,
      v.title AS video_title, v.duration, c.name AS chapter_name, c.book
    FROM progress p
    LEFT JOIN videos v ON v.id = p.video_id
    LEFT JOIN chapters c ON c.id = p.chapter_id
    WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 500`).all(id);
  const subjects = {};
  for (const r of rows) {
    const sub = r.subject || '其他';
    const sm = subjects[sub] || (subjects[sub] = { n: 0, correct: 0, done: 0 });
    sm.n++; if (Number(r.video_done) === 1) sm.done++;
  }
  ok(res, { student: s, subjects: subjectChips(subjects), rows });
});

// ================================================================ 习题学习报告
admin.get('/exercises', (req, res) => {
  const students = kwFilter(studentsOf(req), req.query.kw);
  // 做题记录汇总
  const rec = new Map();   // user_id -> { n, correct, last_at, subjects:{} }
  for (const r of db.prepare(`
    SELECT r.user_id, r.is_correct, r.created_at, IFNULL(q.subject,'') AS subject
    FROM records r LEFT JOIN questions q ON q.id = r.question_id`).all()) {
    let a = rec.get(r.user_id);
    if (!a) rec.set(r.user_id, a = { n: 0, correct: 0, last_at: '', subjects: {} });
    a.n++; if (Number(r.is_correct) === 1) a.correct++;
    if (r.created_at > a.last_at) a.last_at = r.created_at;
    const sub = r.subject || '其他';
    const sm = a.subjects[sub] || (a.subjects[sub] = { n: 0, correct: 0, done: 0 });
    sm.n++; if (Number(r.is_correct) === 1) sm.correct++;
  }
  // 错题本：待复习 / 已掌握
  const mis = new Map();
  for (const m of db.prepare('SELECT user_id, resolved, COUNT(*) n FROM mistakes GROUP BY user_id, resolved').all()) {
    if (!mis.has(m.user_id)) mis.set(m.user_id, { open: 0, mastered: 0 });
    const st = mis.get(m.user_id);
    if (Number(m.resolved) === 1) st.mastered += m.n; else st.open += m.n;
  }
  // 试卷
  const pap = new Map();
  for (const t of db.prepare('SELECT user_id, score, total, created_at FROM paper_tries').all()) {
    let a = pap.get(t.user_id);
    if (!a) pap.set(t.user_id, a = { tries: 0, scored: 0, sum: 0, best: 0, last_at: '', avg: 0 });
    a.tries++;
    if (t.score !== null && t.score !== undefined) { a.scored++; a.sum += Number(t.score) || 0; a.best = Math.max(a.best, Number(t.score) || 0); }
    if (t.created_at > a.last_at) a.last_at = t.created_at;
  }
  const list = students.map((s) => {
    const a = rec.get(s.id) || { n: 0, correct: 0, last_at: '', subjects: {} };
    const m = mis.get(s.id) || { open: 0, mastered: 0 };
    const p = pap.get(s.id) || { tries: 0, sum: 0, best: 0, last_at: '' };
    return {
      ...s,
      answered: a.n, correct: a.correct,
      rate: a.n ? Math.round(a.correct / a.n * 100) : null,
      wrong_open: m.open, mastered: m.mastered,
      paper_tries: p.tries,
      paper_avg: p.scored ? Math.round((p.sum / p.scored) * 10) / 10 : null,
      paper_best: p.scored ? p.best : null,
      last_at: [a.last_at, p.last_at].sort().pop() || '',
      subjects: subjectChips(a.subjects),
    };
  });
  ok(res, { list, subjects: SUBJECTS });
});

admin.get('/exercises/:id/detail', (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT id, username, name, grade, stage, term, expire_at, status, last_login, created_by FROM users WHERE id=? AND role='student'").get(id);
  if (!s) return fail(res, '学生不存在');
  if (req.user.role !== 'admin' && Number(s.created_by) !== Number(req.user.id)) return fail(res, '无权查看该学生', 403);
  delete s.created_by;
  // 试卷记录
  const papers = db.prepare(`
    SELECT t.id, t.score, t.total, t.correct, t.detail, t.created_at, p.title, p.total_score
    FROM paper_tries t LEFT JOIN papers p ON p.id = t.paper_id
    WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 100`).all(id).map(presentAttempt);
  // 主观题单独保存，不计对错；仅在通过分校学生归属校验后返回。
  const subjective = db.prepare(`SELECT r.id, r.question_id, r.kind, r.paper_id, r.try_id, r.my_answer, r.score, r.max_score, r.review_comment, r.reviewed_at, r.created_at,
    CASE WHEN r.drawing_data IS NOT NULL AND r.drawing_data<>'' THEN 1 ELSE 0 END AS has_drawing, q.stem, q.subject, q.question_subtype
    FROM subjective_responses r LEFT JOIN questions q ON q.id=r.question_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 100`).all(id);
  // 学科统计
  const subjects = {};
  for (const r of db.prepare(`
    SELECT IFNULL(q.subject,'') AS subject, r.is_correct
    FROM records r LEFT JOIN questions q ON q.id = r.question_id WHERE r.user_id = ?`).all(id)) {
    const sub = r.subject || '其他';
    const sm = subjects[sub] || (subjects[sub] = { n: 0, correct: 0, done: 0 });
    sm.n++; if (Number(r.is_correct) === 1) sm.correct++;
  }
  // 最近作答（最近 100 条）
  const rows = db.prepare(`
    SELECT r.question_id, r.my_answer, r.is_correct, r.match_correct, r.match_total, r.created_at,
      q.stem, q.type, q.subject
    FROM records r LEFT JOIN questions q ON q.id = r.question_id
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 100`).all(id);
  // 错题概览
  const mis = db.prepare('SELECT resolved, COUNT(*) n FROM mistakes WHERE user_id=? GROUP BY resolved').all(id);
  const wrong_open = Number((mis.find((m) => Number(m.resolved) !== 1) || {}).n || 0);
  const mastered = Number((mis.find((m) => Number(m.resolved) === 1) || {}).n || 0);
  ok(res, { student: s, papers, subjects: subjectChips(subjects), rows, subjective, wrong_open, mastered });
});

admin.get('/subjective/:id/drawing', (req, res) => {
  const row = db.prepare(`SELECT r.drawing_data, u.created_by FROM subjective_responses r JOIN users u ON u.id=r.user_id
    WHERE r.id=? AND u.role='student'`).get(Number(req.params.id));
  if (!row || !row.drawing_data || (req.user.role !== 'admin' && Number(row.created_by) !== Number(req.user.id))) return res.status(404).send('作图不存在');
  try { const image = decodeDrawing(row.drawing_data); res.setHeader('Cache-Control', 'private, no-store'); res.type('image/png'); return res.send(image); }
  catch (_) { return res.status(404).send('作图不可读取'); }
});

// 老师对一次具体主观题作答评分；总校可看全部，分校仅限本人开通的学生。
admin.post('/subjective/:id/grade', (req, res) => {
  const id = Number(req.params.id), raw = req.body && req.body.score;
  if (!Number.isSafeInteger(id) || id <= 0 || raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) return fail(res, '请输入有效分数');
  const score = Number(raw), comment = String((req.body || {}).comment || '').trim().slice(0, 2000);
  try {
    const result = db.transaction(() => {
      const row = db.prepare(`SELECT r.*, u.created_by FROM subjective_responses r JOIN users u ON u.id=r.user_id WHERE r.id=? AND u.role='student' FOR UPDATE`).get(id);
      if (!row) throw new Error('作答不存在');
      if (req.user.role !== 'admin' && Number(row.created_by) !== Number(req.user.id)) throw new Error('无权评分该学生的作答');
      const max = row.max_score === null || row.max_score === undefined ? 100 : Number(row.max_score);
      if (score < 0 || score > max) throw new Error(`分数应在 0 至 ${max} 之间`);
      const reviewedAt = new Date().toISOString();
      db.prepare('UPDATE subjective_responses SET score=?, review_comment=?, reviewed_by=?, reviewed_at=? WHERE id=?')
        .run(score, comment, req.user.id, reviewedAt, id);
      let finalScore = null, pending = null;
      if (row.try_id && ['paper', 'mfpaper'].includes(row.kind)) {
        const table = row.kind === 'paper' ? 'paper_tries' : 'mf_paper_tries';
        const attempt = db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=? AND paper_id=? FOR UPDATE`).get(row.try_id, row.user_id, row.paper_id);
        if (!attempt) throw new Error('原试卷作答已不存在');
        let detail; try { detail = JSON.parse(attempt.detail || '[]'); } catch (_) { detail = []; }
        if (!Array.isArray(detail)) throw new Error('原试卷明细格式不正确');
        const item = detail.find((x) => Number(x.response_id) === id);
        if (!item) throw new Error('原试卷中未找到该次作答');
        item.ungraded = false; item.manual_graded = true; item.earned_score = score; item.max_score = max;
        pending = detail.filter((x) => x && x.ungraded).length;
        finalScore = pending ? null : Math.round(detail.reduce((sum, x) => sum + (Number(x && x.earned_score) || 0), 0) * 100) / 100;
        db.prepare(`UPDATE ${table} SET score=?, detail=? WHERE id=?`).run(finalScore, JSON.stringify(detail), attempt.id);
      }
      return { id, score, max_score: max, reviewed_at: reviewedAt, pending, final_score: finalScore, legacy_unlinked: !row.try_id && ['paper', 'mfpaper'].includes(row.kind) };
    })();
    return ok(res, result, '已保存本次作答评分');
  } catch (e) { return fail(res, e.message || '评分失败'); }
});

module.exports = { admin };
