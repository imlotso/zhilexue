'use strict';
/**
 * 习题正确率（T6）：按「视频」「小分组」「课程」聚合某个学生的作答，不新增表。
 *
 * 数据来源：`records`（每次作答一行：user_id, question_id, is_correct）+ `questions.video_id`（题目绑定的视频）。
 * 口径（手算可复核）：
 *   · 一道题取该学生**最近一次**作答的对错（重做答对了，掌握度就上升；不会因为反复做同一题而重复计数）
 *   · 已做 answered = 绑定到该视频、且作答过的题数；总数 total = 绑定到该视频的题数
 *   · 正确 correct = 已做的题里最近一次答对的题数
 *   · 正确率 rate = correct / answered 取整百分数；一题没做过时 rate = null（前端显示"未做"）
 *   · 小分组 = 该分组下所有视频的题 + 直接挂在小分组上的题（R8：questions.section_id）合并后再算（不是各视频百分比的平均）
 * 问答题（type='answer'）不能自动判分，不进 records，也就不进正确率。
 */

/** 一批视频各自的统计：Map(video_id -> { total, answered, correct }) */
function videoStats(db, userId, videoIds) {
  const ids = [...new Set((videoIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT q.video_id AS vid, COUNT(*) AS total,
      SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN r.is_correct=1 THEN 1 ELSE 0 END) AS correct
    FROM questions q
    LEFT JOIN records r ON r.id = (SELECT MAX(r2.id) FROM records r2 WHERE r2.user_id=? AND r2.question_id=q.id)
    WHERE q.video_id IN (${ph}) AND q.type<>'answer'
    GROUP BY q.video_id`).all(Number(userId), ...ids);
  rows.forEach((r) => out.set(Number(r.vid), { total: Number(r.total) || 0, answered: Number(r.answered) || 0, correct: Number(r.correct) || 0 }));
  return out;
}

/** R8：直接挂在小分组上的题（questions.section_id）各小分组的统计：Map(section_id -> { total, answered, correct })。口径同 videoStats */
function sectionOwnStats(db, userId, sectionIds) {
  const ids = [...new Set((sectionIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT q.section_id AS sid, COUNT(*) AS total,
      SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN r.is_correct=1 THEN 1 ELSE 0 END) AS correct
    FROM questions q
    LEFT JOIN records r ON r.id = (SELECT MAX(r2.id) FROM records r2 WHERE r2.user_id=? AND r2.question_id=q.id)
    WHERE q.section_id IN (${ph}) AND q.type<>'answer' AND (q.video_id IS NULL OR q.video_id=0)
    GROUP BY q.section_id`).all(Number(userId), ...ids);
  rows.forEach((r) => out.set(Number(r.sid), { total: Number(r.total) || 0, answered: Number(r.answered) || 0, correct: Number(r.correct) || 0 }));
  return out;
}

/** R8：一组题目各自最近一次作答：Map(question_id -> { is_correct, at, my_answer })；没做过的不在 Map 里 */
function lastAnswers(db, userId, questionIds) {
  const ids = [...new Set((questionIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  db.prepare(`SELECT r.question_id AS qid, r.is_correct, r.created_at, r.my_answer FROM records r
    WHERE r.id IN (SELECT MAX(r2.id) FROM records r2 WHERE r2.user_id=? AND r2.question_id IN (${ph}) GROUP BY r2.question_id)`)
    .all(Number(userId), ...ids)
    .forEach((r) => out.set(Number(r.qid), { is_correct: Number(r.is_correct) === 1, at: r.created_at || '', my_answer: r.my_answer || '' }));
  return out;
}

const EMPTY = () => ({ total: 0, answered: 0, correct: 0 });

/** 把若干 {total, answered, correct} 相加并补上 rate */
function sum(list) {
  const s = EMPTY();
  (list || []).forEach((x) => { if (x) { s.total += x.total || 0; s.answered += x.answered || 0; s.correct += x.correct || 0; } });
  return withRate(s);
}

function withRate(s) {
  const o = { total: s.total || 0, answered: s.answered || 0, correct: s.correct || 0 };
  o.rate = o.answered ? Math.round(o.correct / o.answered * 100) : null;
  return o;
}

/** 单个视频的统计（没有绑题 → total 0，rate null） */
function ofVideo(stats, vid) {
  return withRate(stats.get(Number(vid)) || EMPTY());
}

/** 视频所属的小分组：视频自己的 section_id，没有时跟着它的讲义走（与学生端课程页的分组口径一致） */
const SEC_EXPR = `COALESCE(NULLIF(v.section_id,0), (SELECT h.section_id FROM handouts h WHERE h.video_id=v.id AND h.chapter_id=v.chapter_id AND h.section_id IS NOT NULL ORDER BY h.id LIMIT 1), 0)`;

function sectionOfVideo(db, videoId) {
  const r = db.prepare(`SELECT ${SEC_EXPR} AS sid FROM videos v WHERE v.id=?`).get(Number(videoId));
  return r ? Number(r.sid) || 0 : 0;
}

/** 同一课程里属于同一个小分组的全部视频 id */
function sectionVideoIds(db, chapterId, sectionId) {
  if (!chapterId || !sectionId) return [];
  return db.prepare(`SELECT v.id FROM videos v WHERE v.chapter_id=? AND ${SEC_EXPR}=?`)
    .all(Number(chapterId), Number(sectionId)).map((r) => r.id);
}

module.exports = { videoStats, sectionOwnStats, lastAnswers, sum, withRate, ofVideo, sectionOfVideo, sectionVideoIds, SEC_EXPR };
