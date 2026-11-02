/* ==========================================================
   分析引擎 v2
   - 单次考试聚合（总分 / 单科）
   - 名次校正判定：分数下滑但名次前进 = 试卷偏难，不算退步
   - 提分率 / 危险预警（连续两次退步）
   - 评语覆盖率
   ========================================================== */
const Analytics = (() => {

  const TOTAL_SUBJECTS = ['总分', '总成绩', '总分数', '合计', '总计'];
  const isTotalSubject = (s) => TOTAL_SUBJECTS.includes(String(s || '').trim());
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  /* ---------------- 聚合 ---------------- */
  function aggExam(examId) {
    const rs = Store.allRecords().filter(r => r.examId === examId);
    const map = new Map();
    rs.forEach(r => {
      const k = r.studentName;
      if (!map.has(k)) map.set(k, {
        studentName: k, examId, campusId: r.campusId, date: r.date,
        stage: r.stage || '', grade: r.grade || '', className: r.className || '',
        subjects: [], sum: 0, full: 0, totalRow: null,
        classRanks: [], gradeRanks: [], comments: []
      });
      const o = map.get(k);
      if (String(r.date) > String(o.date)) o.date = r.date;
      if (isTotalSubject(r.subject)) {
        o.totalRow = r;
      } else {
        o.subjects.push({
          id: r.id, subject: r.subject, score: Number(r.score) || 0, full: Number(r.fullScore) || 0,
          comment: r.comment || '', classRank: r.classRank ?? null, gradeRank: r.gradeRank ?? null
        });
        o.sum += Number(r.score) || 0;
        o.full += Number(r.fullScore) || 0;
      }
      if (r.classRank != null && r.classRank !== '') o.classRanks.push(Number(r.classRank));
      if (r.gradeRank != null && r.gradeRank !== '') o.gradeRanks.push(Number(r.gradeRank));
      if (r.comment) o.comments.push({ subject: r.subject || '', text: String(r.comment) });
    });

    const exam = Store.exam(examId);
    return Array.from(map.values()).map(o => {
      const total = o.totalRow ? Number(o.totalRow.score) : o.sum;
      const full = o.totalRow ? Number(o.totalRow.fullScore) : (o.full || null);
      const ck = (o.totalRow && o.totalRow.classRank != null) ? Number(o.totalRow.classRank)
        : (o.classRanks.length ? Math.round(avg(o.classRanks)) : null);
      const gk = (o.totalRow && o.totalRow.gradeRank != null) ? Number(o.totalRow.gradeRank)
        : (o.gradeRanks.length ? Math.round(avg(o.gradeRanks)) : null);
      return {
        studentName: o.studentName, examId, campusId: o.campusId, date: o.date,
        examName: exam ? exam.name : '', type: exam ? exam.type : '',
        stage: o.stage, grade: o.grade, className: o.className,
        total, full, rate: full ? total / full : null,
        classRank: ck, gradeRank: gk,
        subjects: o.subjects, comments: o.comments,
        hasComment: o.comments.length > 0
      };
    });
  }

  /** 聚合行 → 「单科视角」：分数、名次、评语均只取该科 */
  function toSubjectRow(row, subject) {
    if (!subject) return row;
    const s = (row.subjects || []).find(x => x.subject === subject);
    if (!s) return null;
    const sr = row.subjects.find(x => x.subject === subject && x.classRank != null);
    const gr = row.subjects.find(x => x.subject === subject && x.gradeRank != null);
    const cm = (row.comments || []).filter(c => c.subject === subject);
    return Object.assign({}, row, {
      total: s.score, full: s.full || null, rate: s.full ? s.score / s.full : null,
      classRank: (sr ? Number(sr.classRank) : row.classRank),
      gradeRank: (gr ? Number(gr.gradeRank) : row.gradeRank),
      comments: cm,
      hasComment: cm.length > 0
    });
  }

  function aggExamBy(examId, subject) {
    const rows = aggExam(examId);
    if (!subject) return rows;
    return rows.map(r => toSubjectRow(r, subject)).filter(Boolean);
  }

  /* ---------------- 名次校正判定 ---------------- */
  const JUDGE_REASON = {
    score_down_rank_up: '分数下降但名次前进，试卷偏难，属相对进步',
    rank_up: '名次前进',
    score_up_rank_down: '分数上升但名次下滑，试卷偏易，属相对退步',
    rank_down: '名次下滑',
    rank_flat: '名次持平',
    score: '按分数判定'
  };

  /**
   * 单步判定：a=上次，b=本次
   * 有班级名次时以名次为主（分数受试卷难度影响），无名次时退回分数比较
   */
  function stepJudge(a, b) {
    if (!a || !b) return { kind: 'none', reason: 'first', scoreDelta: null, rankDelta: null, thr: 0, text: '' };
    const sd = b.total - a.total;
    const hasRank = a.classRank != null && b.classRank != null;
    const rd = hasRank ? (a.classRank - b.classRank) : null;
    const full = b.full || a.full || 100;
    const thr = Math.max(2, Math.round(full * 0.01));
    let kind, reason;
    if (hasRank) {
      if (rd > 0) { kind = 'up'; reason = sd < -thr ? 'score_down_rank_up' : 'rank_up'; }
      else if (rd < 0) { kind = 'down'; reason = sd > thr ? 'score_up_rank_down' : 'rank_down'; }
      else { kind = sd > thr ? 'up' : sd < -thr ? 'down' : 'flat'; reason = 'rank_flat'; }
    } else {
      kind = sd > thr ? 'up' : sd < -thr ? 'down' : 'flat';
      reason = 'score';
    }
    return { kind, reason, scoreDelta: sd, rankDelta: rd, thr, text: JUDGE_REASON[reason] };
  }

  /* ---------------- 学生历次 ---------------- */
  function studentTimeline(campusId, studentName, subject) {
    const exams = Store.exams(campusId);
    const out = [];
    exams.forEach(e => {
      const row = aggExamBy(e.id, subject).find(x => x.studentName === studentName);
      if (row) out.push(row);
    });
    out.sort(U.byDateAsc);
    let prev = null;
    out.forEach(o => {
      const j = stepJudge(prev, o);
      o.judge = j.kind;
      o.judgeReason = j.reason;
      o.judgeText = j.text;
      o.delta = prev ? (o.total - prev.total) : null;
      o.deltaRate = (prev && o.full) ? (o.total - prev.total) / o.full : null;
      o.rankDelta = j.rankDelta;
      o.gradeRankDelta = (prev && o.gradeRank != null && prev.gradeRank != null) ? (prev.gradeRank - o.gradeRank) : null;
      prev = o;
    });
    return out;
  }

  /* ---------------- 趋势判定 ---------------- */
  function trendStatus(timeline) {
    if (!timeline || timeline.length < 2) return { key: 'none', label: '数据不足', delta: null };
    const steps = timeline.slice(1).map(o => o.judge).filter(k => k && k !== 'none');
    if (!steps.length) return { key: 'none', label: '数据不足', delta: null };
    const last = timeline[timeline.length - 1];
    const prev = timeline[timeline.length - 2];
    const delta = last.total - prev.total;
    const recent = steps.slice(-3);
    let key = 'wave';
    if (recent.every(k => k === 'flat')) key = 'flat';
    else if (recent.length >= 2 && recent.every(k => k === 'up')) key = 'up';
    else if (recent.length >= 2 && recent.every(k => k === 'down')) key = 'down';
    else if (recent.length === 1) key = recent[0] === 'up' ? 'up' : recent[0] === 'down' ? 'down' : 'flat';
    const label = { up: '进步', down: '退步', wave: '波动', flat: '稳定', none: '数据不足' }[key];
    return { key, label, delta, deltaRate: last.full ? delta / last.full : null };
  }

  const STATUS_TAG = { up: 'tag-up', down: 'tag-down', wave: 'tag-wave', flat: 'tag-flat', none: 'tag-flat' };
  const STATUS_ICON = { up: '▲', down: '▼', wave: '◆', flat: '—', none: '·' };

  /* ---------------- 科目进退 ---------------- */
  function subjectDeltas(timeline) {
    if (!timeline || timeline.length < 2) return [];
    const a = timeline[timeline.length - 2], b = timeline[timeline.length - 1];
    const map = new Map();
    (a.subjects || []).forEach(s => map.set(s.subject, { subject: s.subject, before: s.score, after: null, full: s.full, aRank: s.classRank, bRank: null }));
    (b.subjects || []).forEach(s => {
      const cur = map.get(s.subject) || { subject: s.subject, before: null, full: s.full, aRank: null, bRank: null };
      cur.after = s.score; cur.full = s.full; cur.bRank = s.classRank; map.set(s.subject, cur);
    });
    return Array.from(map.values())
      .map(s => ({ ...s, delta: (s.before != null && s.after != null) ? s.after - s.before : null }))
      .sort((x, y) => (y.delta ?? -999) - (x.delta ?? -999));
  }

  /* ---------------- 任意两次考试对比 ---------------- */
  function compareExams(examIdA, examIdB, subject) {
    const A = aggExamBy(examIdA, subject), B = aggExamBy(examIdB, subject);
    const mapA = new Map(A.map(o => [o.studentName, o]));
    const rows = [];
    B.forEach(b => {
      const a = mapA.get(b.studentName);
      if (!a) return;
      const j = stepJudge(a, b);
      rows.push({
        studentName: b.studentName,
        stage: b.stage || a.stage, grade: b.grade || a.grade, className: b.className || a.className,
        scoreA: a.total, scoreB: b.total, full: b.full || a.full,
        delta: b.total - a.total,
        deltaRate: (b.full || a.full) ? (b.total - a.total) / (b.full || a.full) : null,
        rankA: a.classRank, rankB: b.classRank, rankDelta: j.rankDelta,
        gradeRankA: a.gradeRank, gradeRankB: b.gradeRank,
        gradeRankDelta: (a.gradeRank != null && b.gradeRank != null) ? (a.gradeRank - b.gradeRank) : null,
        judge: j.kind, judgeReason: j.reason, judgeText: j.text,
        commentA: a.comments.map(c => c.text).join(' '),
        commentB: b.comments.map(c => c.text).join(' '),
        hasCommentB: b.comments.length > 0,
        subject
      });
    });
    rows.sort((x, y) => y.delta - x.delta);
    return rows;
  }

  /* ---------------- 提分率 ---------------- */
  function campusLiftRate(examIdA, examIdB, subject) {
    const rows = compareExams(examIdA, examIdB, subject);
    const total = rows.length;
    const up = rows.filter(r => r.delta > 0).length;
    const down = rows.filter(r => r.delta < 0).length;
    const rankUp = rows.filter(r => r.rankDelta != null && r.rankDelta > 0).length;
    const rankDown = rows.filter(r => r.rankDelta != null && r.rankDelta < 0).length;
    const avgDelta = total ? rows.reduce((s, r) => s + r.delta, 0) / total : null;
    return {
      total, up, down, flat: total - up - down,
      rate: total ? up / total : 0,
      rankRate: total ? rankUp / total : 0,
      rankUp, rankDown, avgDelta,
      judgeUp: rows.filter(r => r.judge === 'up').length,
      judgeDown: rows.filter(r => r.judge === 'down').length,
      rows
    };
  }

  /* ---------------- 危险预警：连续两次以上综合退步 ---------------- */
  function dangerList(campusId, subject) {
    const cid = campusId || Store.currentId();
    return Store.students(cid).map(s => {
      const tl = studentTimeline(cid, s.name, subject);
      if (tl.length < 3) return null;
      let streak = 0, cum = 0, cumRank = 0;
      for (let i = tl.length - 1; i >= 1; i--) {
        if (tl[i].judge === 'down') { streak++; cum += tl[i].delta || 0; cumRank += tl[i].rankDelta || 0; }
        else break;
      }
      if (streak < 2) return null;
      const last = tl[tl.length - 1];
      return {
        name: s.name, stage: s.stage, grade: s.grade, className: s.className,
        streak, cumDelta: cum, cumRankDelta: cumRank,
        lastTotal: last.total, lastRank: last.classRank,
        lastExam: last.examName, lastDate: last.date, timeline: tl
      };
    }).filter(Boolean).sort((a, b) => b.streak - a.streak || a.cumDelta - b.cumDelta);
  }

  /* ---------------- 评语 / 班级概况 ---------------- */
  function commentCoverage(examId) {
    const rows = aggExam(examId);
    const withC = rows.filter(r => r.hasComment);
    return {
      total: rows.length, withComment: withC.length,
      missing: rows.filter(r => !r.hasComment).map(r => r.studentName),
      rate: rows.length ? withC.length / rows.length : 0
    };
  }

  function examSummary(examId, subject) {
    const rows = aggExamBy(examId, subject);
    if (!rows.length) return null;
    const totals = rows.map(r => r.total);
    const rates = rows.map(r => r.rate).filter(x => x != null);
    return {
      count: rows.length, avg: avg(totals), max: Math.max(...totals), min: Math.min(...totals),
      avgRate: avg(rates),
      passRate: rates.length ? rates.filter(r => r >= 0.6).length / rates.length : null,
      excellentRate: rates.length ? rates.filter(r => r >= 0.85).length / rates.length : null
    };
  }

  /** 试卷难度变化（以平均得分率差衡量） */
  function paperDifficulty(examIdA, examIdB, subject) {
    const a = examSummary(examIdA, subject), b = examSummary(examIdB, subject);
    if (!a || !b || a.avgRate == null || b.avgRate == null) return null;
    return { rateA: a.avgRate, rateB: b.avgRate, diff: b.avgRate - a.avgRate };
  }

  /* ---------------- 分析文案 ---------------- */
  function analysisText(timeline) {
    if (!timeline.length) return '暂无成绩数据。';
    const last = timeline[timeline.length - 1];
    if (timeline.length === 1) {
      return `目前仅「${last.examName}」（${last.date}）单次记录，${last.full ? `得分 ${Math.round(last.total)}/${Math.round(last.full)}（得分率 ${U.pct(last.rate)}）` : `得分 ${Math.round(last.total)}`}` +
        (last.classRank != null ? `，班级第 ${last.classRank} 名` : '') + '。再上传一次考试成绩即可生成进退步分析。';
    }
    const prev = timeline[timeline.length - 2];
    const st = trendStatus(timeline);
    const p = [];
    p.push(`${last.studentName}共记录 ${timeline.length} 次考试。最近一次「${last.examName}」（${last.date}）` +
      (last.full ? `得分 ${Math.round(last.total)}/${Math.round(last.full)}（${U.pct(last.rate)}）` : `得分 ${Math.round(last.total)}`) +
      `，较上次${last.delta >= 0 ? '增加' : '减少'} ${Math.abs(Math.round(last.delta))} 分。`);

    if (last.classRank != null && prev.classRank != null) {
      const d = prev.classRank - last.classRank;
      p.push(`班级名次 ${prev.classRank} → ${last.classRank}（${d > 0 ? '前进 ' + d + ' 名' : d < 0 ? '后退 ' + (-d) + ' 名' : '持平'}）。`);
    }
    if (last.judge === 'up' && last.delta < 0) {
      p.push('综合判定：分数下降但名次前进，说明本次试卷整体偏难、全班得分普遍偏低，该生相对位置上升，不应判定为退步。');
    } else if (last.judge === 'down' && last.delta > 0) {
      p.push('综合判定：分数上升但名次下滑，说明试卷偏易、全班得分普遍提高，该生相对位置下滑，需要关注。');
    } else if (last.judge === 'down') {
      p.push('综合判定：名次与分数同步下滑，属实质退步，建议尽快安排学情沟通。');
    } else if (last.judge === 'up') {
      p.push('综合判定：名次前进，学习状态向好。');
    } else if (last.judge === 'flat') {
      p.push('综合判定：名次与分数基本持平。');
    }

    const sd = subjectDeltas(timeline).filter(s => s.delta != null);
    if (sd.length) {
      const best = sd[0], worst = sd[sd.length - 1];
      if (best.delta > 0) p.push(`${best.subject}提升最明显（${best.before} → ${best.after}，${U.signNum(best.delta, 0)} 分）。`);
      if (worst.delta < 0) p.push(`${worst.subject}回落较多（${worst.before} → ${worst.after}，${U.signNum(worst.delta, 0)} 分）。`);
    }

    const tail = {
      up: '整体判断：持续进步，建议保持节奏并适度提升训练难度。',
      down: '整体判断：持续退步，建议教师约谈并制定薄弱点专项补弱计划。',
      wave: '整体判断：成绩波动，建议固定复习节奏、加强错题复盘。',
      flat: '整体判断：整体稳定，可在此基础上做拔高训练。',
      none: ''
    }[st.key];
    if (tail) p.push(tail);
    return p.join('');
  }

  /** 校区全员趋势 */
  function campusTrends(campusId, subject) {
    const cid = campusId || Store.currentId();
    return Store.students(cid).map(s => {
      const tl = studentTimeline(cid, s.name, subject);
      const st = trendStatus(tl);
      const last = tl.length ? tl[tl.length - 1] : null;
      return {
        id: s.id, name: s.name, stage: s.stage, grade: s.grade, className: s.className,
        count: tl.length, status: st.key, label: st.label, delta: st.delta,
        lastTotal: last ? last.total : null, lastRate: last ? last.rate : null,
        lastRank: last ? last.classRank : null,
        judge: last ? last.judge : 'none',
        timeline: tl
      };
    }).sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
  }

  return {
    aggExam, aggExamBy, toSubjectRow, stepJudge, studentTimeline, trendStatus,
    subjectDeltas, compareExams, campusLiftRate, dangerList, commentCoverage,
    examSummary, paperDifficulty, analysisText, campusTrends,
    STATUS_TAG, STATUS_ICON, JUDGE_REASON, isTotalSubject
  };
})();
