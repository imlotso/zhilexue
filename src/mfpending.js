'use strict';
/**
 * 待审核题目（T3）：把各入口的"入库前"题目放到同一个列表里，逐题查看、编辑、入库。不新建表，数据源是：
 *   · mf_recog_runs.drafts   录题批次的题卡。source_kind：image/pdf=拍照识别，word=Word 导入，excel=Excel 导入，skill=技能包
 *   · mf_capture_batches.payload   网络采集批次里还没入库的题（status=pending）
 *   · paper_uploads   手机扫码上传的纸质错题（pending/reviewed；题目此前已自动入库+进学生错题本，审核=核对归类后通过）
 * 每条待审核题有 id：run:<批次>:<序号> / cap:<批次>:<序号> / up:<上传记录>，来源标签由数据源决定。
 *
 * 逐题入库后，题卡/采集项上打 committed/_done 标记（保留在批次里不再出现在待审核）；一个批次里的题全部处理完，批次状态变 done。
 * 由 mfbank.js 在末尾挂载：mountPending({ admin, db, ok, fail, now, int, parseArr, parseObj, jstr, TYPE_MAP, TYPES, commitRunCards, commitCaptureItems, store, bankFolder })
 */
const multer = require('multer');
const crypto = require('crypto');

const LETTERS = 'ABCDEFGHIJ';
const SRC_LABEL = { photo: '拍照识别', word: 'Word导入', excel: 'Excel导入', skill: '技能包', capture: '网络采集', scan: '手机扫码（错题）' };
const SRC_ORDER = ['photo', 'word', 'excel', 'skill', 'capture', 'scan'];
const KIND_SRC = { image: 'photo', pdf: 'photo', word: 'word', excel: 'excel', skill: 'skill' };
const TYPE_CN = { single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序', answer: '解答' };
const TYPE_NAME = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题', answer: '解答题' };

module.exports = function mountPending(d) {
  const { admin, db, ok, fail, now, int, parseArr, parseObj, jstr, TYPE_MAP, TYPES, commitRunCards, commitCaptureItems, store, bankFolder } = d;
  const upFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
  const str = (v) => (v == null ? '' : String(v));
  // 听力音频（T7）：只认题库音频目录下的 key；条目里同时带 audio_key（存什么）和 audio_url（给后台播放预览）
  const audioKeyOf = (v) => { const k = str(v).trim(); return k && k.startsWith(bankFolder() + '/audio/') && !k.includes('..') ? k.slice(0, 255) : ''; };
  const audioFields = (key) => ({ audio_key: str(key), audio_url: key ? store.getUrlSync(key) : '' });
  // id 里带题干指纹：待审核项按"批次+序号"定位，别人删过/改过之后序号会变，旧页面上的 id 可能指向另一道题。
  // 操作前核对指纹，对不上就拒绝，避免把别的题入库/删掉。
  const fpOf = (stem) => crypto.createHash('md5').update(str(stem).trim()).digest('hex').slice(0, 8);

  // ------------------------------------------------------------ 各数据源 → 统一的待审核项
  function cardToItem(run, c, i) {
    const src = KIND_SRC[run.source_kind] || 'photo';
    const q = c._q;
    const type = q ? q.type : (TYPE_MAP[str(c.questionType)] || ((c.options || []).length >= 2 ? 'single' : 'answer'));
    const options = q
      ? (q.options || []).map((o) => ({ label: str(o.label), text: str(o.text) }))
      : (c.options || []).map((o) => ({ label: str(o.label), text: str(o.content != null ? o.content : o.text) }));
    const images = q ? (q.images || []) : (c.figures || []).map((x) => (x && x.url) || x).filter(Boolean);
    return {
      id: `run:${run.id}:${i}:${fpOf(q ? q.stem : c.stem)}`, kind: 'run', source: src, source_label: SRC_LABEL[src],
      batch_id: run.id, batch_title: run.title, index: i,
      subject: str(c.subject || (q && q.subject) || run.subject), stage: str(c.stage || (q && q.stage) || run.stage), grade: str(c.grade || (q && q.grade) || run.grade),
      type, type_name: TYPE_NAME[type] || type,
      stem: str(q ? q.stem : c.stem), material: str(c.material), options,
      answer: str(q ? q.answer : c.answer), analysis: str(q ? q.analysis : c.analysis),
      point: str(c.point || (q && q.point)), difficulty: int(c.difficulty || (q && q.difficulty), 0), chapter_id: int(c.chapter_id, 0),
      tags: Array.isArray(c.suggestedTags) ? c.suggestedTags : [], images, created_at: str(run.created_at),
      ...audioFields(c.audio_key),
    };
  }
  function runItems() {
    const out = [];
    db.prepare("SELECT * FROM mf_recog_runs WHERE status<>'done' ORDER BY id DESC").all().forEach((run) => {
      parseArr(run.drafts).forEach((c, i) => {
        if (!c || c.committed || !str(c._q ? c._q.stem : c.stem).trim()) return;
        out.push(cardToItem(run, c, i));
      });
    });
    return out;
  }
  function capItems() {
    const out = [];
    db.prepare("SELECT * FROM mf_capture_batches WHERE status='pending' ORDER BY id DESC").all().forEach((b) => {
      parseArr(b.payload).forEach((q, i) => {
        if (!q || q._done || !str(q.stem || q.stemHtml).trim()) return;
        const options = (q.options || []).map((t, k) => ({ label: LETTERS[k] || '', text: str(t && t.text != null ? t.text : t) }));
        const type = TYPES.includes(q.type) ? q.type : (options.length >= 2 ? 'single' : 'answer');
        out.push({
          id: `cap:${b.id}:${i}:${fpOf(q.stem || q.stemHtml)}`, kind: 'cap', source: 'capture', source_label: SRC_LABEL.capture,
          batch_id: b.id, batch_title: b.title, index: i,
          subject: str(q.subject || b.subject), stage: str(q.stage || b.stage), grade: str(q.grade || b.grade),
          type, type_name: TYPE_NAME[type] || type,
          stem: str(q.stem || q.stemHtml), material: '', options, answer: str(q.answer), analysis: str(q.analysis),
          point: str(q.point || ((q.meta && q.meta.knowledgePoints) || []).join('、')), difficulty: int(q.difficulty, 0), chapter_id: 0,
          tags: [], images: Array.isArray(q.images) ? q.images : [], created_at: str(b.created_at),
          ...audioFields(q.audio_key),
        });
      });
    });
    return out;
  }
  function scanItems() {
    const rows = db.prepare(`SELECT pu.id AS up_id, pu.status AS up_status, pu.images AS up_images, pu.point AS pu_point, pu.subject AS pu_subject, pu.stage AS pu_stage,
        pu.grade AS pu_grade, pu.created_at AS up_created, pu.stem_text AS up_stem_text, pu.note AS up_note,
        q.id AS qid, q.stem, q.options, q.answer, q.analysis, q.type, q.difficulty, q.point, q.images AS q_images, q.material, q.audio_key,
        u.name AS student_name
      FROM paper_uploads pu JOIN questions q ON q.id=pu.question_id JOIN users u ON u.id=pu.user_id
      WHERE pu.status IN ('pending','reviewed') AND pu.question_id>0 ORDER BY pu.created_at DESC, pu.id DESC`).all();
    return rows.map((r) => {
      const ups = parseArr(r.up_images); const qimgs = parseArr(r.q_images);
      const opts = parseArr(r.options).map((o) => ({ label: str(o.label), text: str(o.text != null ? o.text : o.content) }));
      return {
        id: `up:${r.up_id}`, kind: 'scan', source: 'scan', source_label: SRC_LABEL.scan,
        batch_id: r.up_id, batch_title: `${r.student_name || '学生'} 扫码上传`, index: 0, qid: r.qid, up_status: r.up_status,
        subject: str(r.pu_subject), stage: str(r.pu_stage), grade: str(r.pu_grade),
        type: str(r.type) || 'single', type_name: TYPE_NAME[r.type] || '题目', stem: str(r.stem), material: str(r.material), options: opts,
        answer: str(r.answer), analysis: str(r.analysis), point: str(r.pu_point || r.point), difficulty: int(r.difficulty, 0), chapter_id: 0,
        tags: [], images: [...new Set([...ups, ...qimgs])], created_at: str(r.up_created),
        ...audioFields(r.audio_key),
      };
    });
  }
  const allItems = () => [].concat(runItems(), capItems(), scanItems());
  const countBy = (items) => {
    const c = { all: items.length };
    SRC_ORDER.forEach((k) => { c[k] = 0; });
    items.forEach((it) => { c[it.source]++; });
    return c;
  };

  // ------------------------------------------------------------ 列表
  admin.get('/ext/pending', (req, res) => {
    const source = SRC_ORDER.includes(str(req.query.source)) ? str(req.query.source) : 'all';
    const kw = str(req.query.kw).trim().toLowerCase();
    const page = Math.max(1, int(req.query.page, 1));
    const size = Math.min(100, Math.max(1, int(req.query.size, 20)));
    const items = allItems();
    const counts = countBy(items);
    let list = items.filter((it) => source === 'all' || it.source === source);
    if (kw) list = list.filter((it) => [it.stem, it.batch_title, it.point, it.answer, it.material].some((t) => str(t).toLowerCase().includes(kw)));
    list.sort((a, b) => (str(b.created_at) > str(a.created_at) ? 1 : str(b.created_at) < str(a.created_at) ? -1 : 0) || (b.batch_id - a.batch_id) || (a.index - b.index));
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(page, pages);
    return ok(res, { total, page: p, size, list: list.slice((p - 1) * size, p * size), counts });
  });

  // ------------------------------------------------------------ id 解析与分组
  const parseId = (id) => {
    let m = /^(run|cap):(\d+):(\d+)(?::([0-9a-f]{8}))?$/.exec(str(id));
    if (m) return { kind: m[1], batch: Number(m[2]), index: Number(m[3]), fp: m[4] || '', id: str(id) };
    m = /^up:(\d+)$/.exec(str(id));
    if (m) return { kind: 'up', batch: Number(m[1]), index: 0, id: str(id) };
    return null;
  };
  const uniqBy = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.index + ':' + x.fp; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const groupIds = (ids) => {
    const g = { run: new Map(), cap: new Map(), up: [], bad: [] };
    (Array.isArray(ids) ? ids : []).forEach((x) => {
      const p = parseId(x);
      if (!p) return g.bad.push(str(x));
      if (p.kind === 'up') return g.up.push(p.batch);
      const m = g[p.kind];
      if (!m.has(p.batch)) m.set(p.batch, []);
      m.get(p.batch).push({ index: p.index, fp: p.fp });
    });
    return g;
  };

  const STALE = '列表已过期（这道题已被处理、修改或删除），请刷新后再操作';
  const stemOfCard = (c) => (c._q ? c._q.stem : c.stem);
  const stemOfCap = (q) => q.stem || q.stemHtml;

  // ------------------------------------------------------------ 编辑单题
  admin.put('/ext/pending/item', (req, res) => {
    const b = req.body || {};
    const p = parseId(b.id);
    if (!p) return fail(res, '题目标识不对');
    const patch = b.patch && typeof b.patch === 'object' ? b.patch : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
    const opts = has('options') ? (Array.isArray(patch.options) ? patch.options : []).map((o, k) => ({ label: str(o.label) || LETTERS[k] || '', text: str(o.text != null ? o.text : o.content) })).filter((o) => o.text.trim()) : null;
    const type = has('type') && TYPES.includes(patch.type) ? patch.type : null;

    if (p.kind === 'run') {
      const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch);
      if (!run) return fail(res, '批次不存在');
      const cards = parseArr(run.drafts);
      const c = cards[p.index];
      if (!c || c.committed) return fail(res, '这道题已经不在待审核里了');
      if (p.fp && p.fp !== fpOf(stemOfCard(c))) return fail(res, STALE);
      const q = c._q;
      if (has('stem')) { if (q) { q.stem = str(patch.stem); q.stem_html = ''; } else c.stem = str(patch.stem); }
      if (has('answer')) { if (q) q.answer = str(patch.answer); else c.answer = str(patch.answer); }
      if (has('analysis')) { if (q) q.analysis = str(patch.analysis); else c.analysis = str(patch.analysis); }
      if (opts) { if (q) q.options = opts; else c.options = opts.map((o) => ({ label: o.label, content: o.text })); }
      if (type) { if (q) q.type = type; else c.questionType = TYPE_CN[type]; }
      if (has('difficulty')) { const v = Math.min(5, Math.max(1, int(patch.difficulty, 3))); if (q) q.difficulty = v; c.difficulty = v; }
      ['point', 'material', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) c[k] = str(patch[k]).trim(); });
      if (has('chapter_id')) c.chapter_id = int(patch.chapter_id, 0);
      if (has('audio_key')) c.audio_key = audioKeyOf(patch.audio_key);
      if (has('tags')) c.suggestedTags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => str(t).trim()).filter(Boolean);
      db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(jstr(cards), run.id);
      return ok(res, cardToItem(run, c, p.index), '已保存');
    }
    if (p.kind === 'cap') {
      const bt = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(p.batch);
      if (!bt) return fail(res, '批次不存在');
      const items = parseArr(bt.payload);
      const q = items[p.index];
      if (!q || q._done) return fail(res, '这道题已经不在待审核里了');
      if (p.fp && p.fp !== fpOf(stemOfCap(q))) return fail(res, STALE);
      if (has('stem')) { q.stem = str(patch.stem); q.stemHtml = ''; }
      if (has('answer')) q.answer = str(patch.answer);
      if (has('analysis')) q.analysis = str(patch.analysis);
      if (opts) q.options = opts.map((o) => o.text);
      if (type) q.type = type;
      if (has('difficulty')) q.difficulty = Math.min(5, Math.max(1, int(patch.difficulty, 3)));
      if (has('point')) { q.point = str(patch.point).trim(); q.meta = q.meta || {}; q.meta.knowledgePoints = q.point ? q.point.split(/[、,，]/).map((t) => t.trim()).filter(Boolean) : []; }
      ['subject', 'stage', 'grade'].forEach((k) => { if (has(k)) q[k] = str(patch[k]).trim(); });
      if (has('audio_key')) q.audio_key = audioKeyOf(patch.audio_key);
      db.prepare('UPDATE mf_capture_batches SET payload=? WHERE id=?').run(jstr(items), bt.id);
      return ok(res, capItems().find((x) => x.batch_id === p.batch && x.index === p.index) || null, '已保存');
    }
    // 手机扫码：题目已在库里，直接改题目行并把上传记录标为"已核对"
    const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(p.batch);
    if (!up || !up.question_id) return fail(res, '上传记录不存在');
    if (up.status === 'approved') return fail(res, '该题已审核通过，不能再修改');
    const sets = []; const args = [];
    if (has('stem')) { sets.push('stem=?'); args.push(str(patch.stem)); }
    if (has('answer')) { sets.push('answer=?'); args.push(str(patch.answer)); }
    if (has('analysis')) { sets.push('analysis=?'); args.push(str(patch.analysis)); }
    if (opts) { sets.push('options=?'); args.push(jstr(opts)); }
    if (type) { sets.push('type=?'); args.push(type); }
    if (has('difficulty')) { sets.push('difficulty=?'); args.push(Math.min(5, Math.max(1, int(patch.difficulty, 3)))); }
    if (has('audio_key')) { sets.push('audio_key=?'); args.push(audioKeyOf(patch.audio_key)); }
    ['point', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) { sets.push(`${k}=?`); args.push(str(patch[k]).trim()); } });
    if (sets.length) db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id=?`).run(...args, up.question_id);
    ['point', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) db.prepare(`UPDATE paper_uploads SET ${k}=? WHERE id=?`).run(str(patch[k]).trim(), up.id); });
    if (up.status === 'pending') db.prepare("UPDATE paper_uploads SET status='reviewed' WHERE id=?").run(up.id);
    return ok(res, scanItems().find((x) => x.id === p.id) || null, '已保存');
  });

  // ------------------------------------------------------------ 入库（逐题 / 批量）
  admin.post('/ext/pending/commit', (req, res) => {
    const b = req.body || {};
    const g = groupIds(b.ids);
    if (!(g.run.size || g.cap.size || g.up.length)) return fail(res, '请先选择要入库的题目');
    const opt = {
      subject: str(b.subject).trim(), stage: str(b.stage).trim(), grade: str(b.grade).trim(),
      node_ids: Array.isArray(b.node_ids) ? b.node_ids : [], tags: Array.isArray(b.tags) ? b.tags : [],
    };
    const questionIds = []; const failed = [];
    g.bad.forEach((x) => failed.push({ id: x, msg: '题目标识不对' }));

    g.run.forEach((idxs, runId) => {
      const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(runId);
      if (!run) return idxs.forEach(({ index: i }) => failed.push({ id: `run:${runId}:${i}`, msg: '批次不存在' }));
      const cards = parseArr(run.drafts);
      uniqBy(idxs).sort((a, c) => a.index - c.index).forEach(({ index: i, fp }) => {
        const c = cards[i];
        if (!c || c.committed) return failed.push({ id: `run:${runId}:${i}`, msg: '这道题已经不在待审核里了' });
        if (fp && fp !== fpOf(stemOfCard(c))) return failed.push({ id: `run:${runId}:${i}`, msg: STALE });
        if (!str(stemOfCard(c)).trim()) return failed.push({ id: `run:${runId}:${i}`, msg: '题干为空' });
        try {
          const ids = commitRunCards(run, [c], opt);
          c.committed = ids[0];
          questionIds.push(ids[0]);
        } catch (e) { failed.push({ id: `run:${runId}:${i}`, msg: '入库失败：' + e.message }); }
      });
      const left = cards.filter((c) => c && !c.committed && str(c._q ? c._q.stem : c.stem).trim()).length;
      db.prepare('UPDATE mf_recog_runs SET drafts=?, status=? WHERE id=?').run(jstr(cards), left ? run.status : 'done', run.id);
    });

    g.cap.forEach((idxs, batchId) => {
      const bt = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(batchId);
      if (!bt) return idxs.forEach(({ index: i }) => failed.push({ id: `cap:${batchId}:${i}`, msg: '批次不存在' }));
      const items = parseArr(bt.payload);
      uniqBy(idxs).sort((a, c) => a.index - c.index).forEach(({ index: i, fp }) => {
        const q = items[i];
        if (!q || q._done) return failed.push({ id: `cap:${batchId}:${i}`, msg: '这道题已经不在待审核里了' });
        if (fp && fp !== fpOf(stemOfCap(q))) return failed.push({ id: `cap:${batchId}:${i}`, msg: STALE });
        try {
          const r = commitCaptureItems(bt, [q], { subject: opt.subject || q.subject, stage: opt.stage || q.stage, grade: opt.grade || q.grade, node_ids: opt.node_ids, tags: opt.tags });
          if (!r.ids.length) return failed.push({ id: `cap:${batchId}:${i}`, msg: '没有题目编号（临时采集的题），无法入库' });
          q._done = r.ids[0];
          questionIds.push(r.ids[0]);
        } catch (e) { failed.push({ id: `cap:${batchId}:${i}`, msg: '入库失败：' + e.message }); }
      });
      const left = items.filter((q) => q && !q._done && str(q.stem || q.stemHtml).trim()).length;
      db.prepare('UPDATE mf_capture_batches SET payload=?, status=? WHERE id=?').run(jstr(items), left ? bt.status : 'done', bt.id);
    });

    [...new Set(g.up)].forEach((upId) => {
      const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(upId);
      if (!up || !up.question_id || !['pending', 'reviewed'].includes(up.status)) return failed.push({ id: `up:${upId}`, msg: '这道题已经不在待审核里了' });
      const subj = ['数学', '英语', '物理', '化学'].includes(opt.subject) ? opt.subject : up.subject;
      if (!['数学', '英语', '物理', '化学'].includes(str(subj))) return failed.push({ id: `up:${upId}`, msg: '学科没识别出来，请先编辑选好学科再入库' });
      try {
        db.prepare('UPDATE questions SET subject=? WHERE id=?').run(subj, up.question_id);
        const insNode = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
        opt.node_ids.map((n) => int(n)).filter(Boolean).forEach((n) => insNode.run(up.question_id, n));
        const insTag = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
        opt.tags.map((t) => str(t).trim()).filter(Boolean).forEach((t) => insTag.run(up.question_id, t));
        db.prepare("UPDATE paper_uploads SET subject=?, status='approved', reviewed_by=?, reviewed_at=? WHERE id=?").run(subj, req.user ? req.user.id : 0, now(), up.id);
        questionIds.push(up.question_id);
      } catch (e) { failed.push({ id: `up:${upId}`, msg: '入库失败：' + e.message }); }
    });

    if (!questionIds.length) return fail(res, failed.length ? failed[0].msg : '没有可入库的题目');
    return ok(res, { committed: questionIds.length, question_ids: questionIds, failed }, `已入库 ${questionIds.length} 题${failed.length ? `，${failed.length} 题失败` : ''}`);
  });

  // ------------------------------------------------------------ 删除（批量）
  admin.post('/ext/pending/delete', (req, res) => {
    const g = groupIds((req.body || {}).ids);
    if (!(g.run.size || g.cap.size || g.up.length)) return fail(res, '请先选择要删除的题目');
    let n = 0, stale = 0;
    g.run.forEach((idxs, runId) => {
      const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(runId);
      if (!run) return;
      const cards = parseArr(run.drafts);
      uniqBy(idxs).sort((a, c) => c.index - a.index).forEach(({ index: i, fp }) => {   // 从后往前删，序号不错位
        if (cards[i] && !cards[i].committed && (!fp || fp === fpOf(stemOfCard(cards[i])))) { cards.splice(i, 1); n++; } else stale++;
      });
      db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(jstr(cards), run.id);
    });
    g.cap.forEach((idxs, batchId) => {
      const bt = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(batchId);
      if (!bt) return;
      const items = parseArr(bt.payload);
      uniqBy(idxs).sort((a, c) => c.index - a.index).forEach(({ index: i, fp }) => {
        if (items[i] && !items[i]._done && (!fp || fp === fpOf(stemOfCap(items[i])))) { items.splice(i, 1); n++; } else stale++;
      });
      db.prepare('UPDATE mf_capture_batches SET payload=? WHERE id=?').run(jstr(items), bt.id);
    });
    [...new Set(g.up)].forEach((upId) => {
      const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(upId);
      if (!up || !['pending', 'reviewed'].includes(up.status)) return;
      // 与 bank.js 的"拒绝"一致：题目是学生上传时自动入库的，拒绝要连学生错题本里这道题一起删
      if (up.question_id) {
        db.prepare('DELETE FROM mistakes WHERE question_id=?').run(up.question_id);
        try { db.prepare('DELETE FROM records WHERE question_id=?').run(up.question_id); } catch (e) { /* 无记录 */ }
        db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(up.question_id);
        db.prepare('DELETE FROM questions WHERE id=?').run(up.question_id);
      }
      db.prepare("UPDATE paper_uploads SET status='rejected', review_note=?, reviewed_by=?, reviewed_at=?, question_id=0 WHERE id=?")
        .run('在待审核页删除', req.user ? req.user.id : 0, now(), up.id);
      n++;
    });
    if (!n && stale) return fail(res, STALE);
    return ok(res, { deleted: n, stale }, `已删除 ${n} 题${stale ? `；${stale} 题列表已过期没有删除，请刷新` : ''}`);
  });

  // ------------------------------------------------------------ 导入：Excel（按客户 9 个 sheet 的模板）
  const TYPE_FROM_CODE = (t) => TYPE_CN[t] || '解答';
  function createRun({ title, kind, name, subject, stage, grade, cards }) {
    const info = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, subject || '', stage || '', grade || '', kind, name || '', 'recognized', '[]', jstr(cards), '[]', '', now());
    return info.lastInsertRowid;
  }
  const fileNameOf = (f) => {
    const s = str(f && f.originalname);
    if (!/[\u0080-ÿ]/.test(s)) return s;
    try { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('�') ? s : u; } catch (e) { return s; }
  };

  // 客户给的《习题导入模板》（9 个 sheet）原样提供，不改列顺序和表头；文件是 docs/原始需求 里那份的逐字节副本
  admin.get('/ext/import-template', (req, res) => {
    const p = require('path').join(__dirname, '..', 'data', '习题导入模板.xlsx');
    if (!require('fs').existsSync(p)) return fail(res, '模板文件不存在');
    res.download(p, '习题导入模板.xlsx');
  });

  admin.post('/ext/import-excel', upFile.single('file'), (req, res) => {
    if (!req.file) return fail(res, '请选择 .xlsx 文件');
    const name = fileNameOf(req.file);
    if (!/\.xlsx?$/i.test(name)) return fail(res, '只支持 Excel（.xlsx）文件，请使用「习题导入模板」');
    let r;
    try { r = require('./bank-excel').parseBankWorkbook(req.file.buffer); } catch (e) { return fail(res, 'Excel 解析失败：' + e.message); }
    if (!r.items.length) {
      return fail(res, r.errors.length ? `没有可导入的题目：${r.errors.slice(0, 3).join('；')}` : '表格里没有读到题目（请使用「习题导入模板」，从第 2 行开始填，示例行会被忽略）');
    }
    const cards = r.items.map((q) => ({
      questionType: TYPE_FROM_CODE(q.type), stem: str(q.stem), material: str(q.material),
      options: (q.options || []).map((t, k) => ({ label: LETTERS[k], content: str(t) })),
      answer: str(q.answer), analysis: str(q.analysis), point: str(q.point), suggestedTags: [], figures: [], checked: true,
    }));
    const b = req.body || {};
    const runId = createRun({ title: `Excel导入 ${name}`, kind: 'excel', name, subject: str(b.subject).trim(), stage: str(b.stage).trim(), grade: str(b.grade).trim(), cards });
    return ok(res, { run_id: runId, total: cards.length, errors: r.errors.slice(0, 50), error_count: r.errors.length, examples_skipped: r.examples || 0 },
      `已放入待审核：${cards.length} 题${r.errors.length ? `，${r.errors.length} 行有问题没导入` : ''}${r.examples ? `（忽略 ${r.examples} 行示例）` : ''}`);
  });

  // ------------------------------------------------------------ 导入：Word（按客户《word (1).docx》规则，不调 AI）
  /** 读 .docx → 规则解析 → { r, cards, name }；失败返回 { err } */
  async function parseWordUpload(file) {
    if (!file) return { err: '请选择 .docx 文件' };
    const name = fileNameOf(file);
    if (!/\.docx$/i.test(name)) return { err: '只支持 .docx（老 .doc 请先用 Word 另存为 .docx）' };
    let doc;
    try {
      doc = await require('./docxtext').parseDocx(file.buffer, {
        saveImage: async (buf, fname) => {
          try { const saved = await store.saveFile(buf, fname, `${bankFolder()}/img`); return await store.getUrl(saved.key); } catch (e) { return ''; }
        },
      });
    } catch (e) { return { err: '文档解析失败：' + e.message }; }
    const r = require('./wordq').parseWordQuestions(doc.paras);
    const lines = r.errors.slice(0, 5).map((e) => `第 ${e.para} 段（第 ${e.no} 题）：${e.msg}`);
    if (!r.list.length) {
      return { err: r.errors.length ? `没有可导入的题目。${lines.join('；')}` : '没认出题目。请确认格式：题目要有序号（1. 2. 3、），选项用 A. 或 A、，答案和解析各另起一行（见「Word 导入格式要求」）' };
    }
    const figs = doc.figs || [];
    const cards = r.list.map((q) => ({
      qno: q.sub ? `${q.no}(${q.sub})` : String(q.no), questionType: TYPE_FROM_CODE(q.type), stem: q.stem, material: q.material,
      options: q.options.map((o) => ({ label: o.label, content: o.content })), answer: q.answer, analysis: q.analysis,
      suggestedTags: [], figures: q.imgRefs.map((n) => figs[n - 1]).filter((f) => f && f.url).map((f) => ({ url: f.url })), checked: true,
      _type: q.type,
    }));
    return { r, cards, name };
  }

  admin.post('/ext/import-word', upFile.single('file'), async (req, res) => {
    const pw = await parseWordUpload(req.file);
    if (pw.err) return fail(res, pw.err);
    const { r, cards, name } = pw;
    const b = req.body || {};
    const runId = createRun({ title: `Word导入 ${name}`, kind: 'word', name, subject: str(b.subject).trim(), stage: str(b.stage).trim(), grade: str(b.grade).trim(), cards });
    return ok(res, { run_id: runId, total: cards.length, big_count: r.bigCount, errors: r.errors.slice(0, 50), error_count: r.errors.length, warnings: r.warnings.slice(0, 20) },
      `已放入待审核：${r.bigCount} 道大题，共 ${cards.length} 题${r.errors.length ? `；${r.errors.length} 题格式不对没导入` : ''}`);
  });

  // ------------------------------------------------------------ 上传真题试卷（T10）：Word → 一张试卷 + 题目同时入题库
  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const SEC_TITLE = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题', answer: '解答题' };
  /**
   * POST /papers/import-word（multipart: file + title / subject / stage / grade / year / folder_id / publish / dry_run）
   *   dry_run=1：只解析，返回识别结果（题数、大题分布、不合规的题）给老师确认，什么都不写
   *   否则：① 题目写入题库（来源=真题试卷，年份 / 学科 / 年级随卷）② 新建试卷（已定稿），按题型分「一、单选题 …」文本块 ③ 每题默认分值 = 100 ÷ 题数（可在试卷里改）
   *   ④ publish=1 时同时发布到学生端「试卷库」
   */
  admin.post('/papers/import-word', upFile.single('file'), async (req, res) => {
    const pw = await parseWordUpload(req.file);
    if (pw.err) return fail(res, pw.err);
    const { r, cards, name } = pw;
    const b = req.body || {};
    const title = str(b.title).trim() || name.replace(/\.docx$/i, '');
    const subject = str(b.subject).trim(), stage = str(b.stage).trim(), grade = str(b.grade).trim();
    const year = /^\d{4}$/.test(str(b.year).trim()) ? str(b.year).trim() : '';
    // 按题型归成大题：大题的先后 = 各题型第一次出现的先后，同一大题里保持文档里的原顺序
    // （规范的试卷本来就是按题型分段的；题型交错的文档（如从题库导出的一批题）也能得到整齐的"一、单选题 二、填空题 …"）
    const sections = [];
    cards.forEach((c, i) => {
      let sec = sections.find((x) => x.type === c._type);
      if (!sec) { sec = { type: c._type, idx: [] }; sections.push(sec); }
      sec.idx.push(i);
    });
    const summary = { total: cards.length, big_count: r.bigCount, error_count: r.errors.length, errors: r.errors.slice(0, 50), warnings: r.warnings.slice(0, 20),
      sections: sections.map((sec, i) => ({ name: `${CN_NUM[i] || i + 1}、${SEC_TITLE[sec.type] || '题目'}`, count: sec.idx.length })), title, year };
    if (String(b.dry_run) === '1') return ok(res, summary, `识别出 ${cards.length} 题${r.errors.length ? `，${r.errors.length} 题格式不对（不会导入）` : ''}`);

    const run = { id: 0, source_name: '真题试卷', source_kind: 'paper', subject, stage, grade };
    const ids = commitRunCards(run, cards.map((c) => { const x = Object.assign({}, c); delete x._type; return x; }), { subject, stage, grade });
    if (year) db.prepare(`UPDATE questions SET year=? WHERE id IN (${ids.map(() => '?').join(',')})`).run(year, ...ids);
    const folderId = int(b.folder_id) || null;
    const publish = String(b.publish) === '1' || b.publish === true;
    const pid = db.prepare(`INSERT INTO mf_papers (title, subject, stage, grade, year, status, paper_type, layout_json, folder_id, trashed_from, published, created_at)
      VALUES (?,?,?,?,?,'done','uniform',?,?,'',?,?)`)
      .run(title, subject, stage, grade, year, jstr(Object.assign({}, require('./mfbank').defaultLayout(), { header: { style: 'exam', title, lines: [] } })), folderId, publish ? 1 : 0, now()).lastInsertRowid;
    const each = Math.round(100 / ids.length * 10) / 10;
    const insQ = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, score, kind, created_at) VALUES (?,?,?,?, 'question',?)");
    const insT = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, kind, text_body, style, text_align, created_at) VALUES (?,NULL,?, 'text',?, 'title','left',?)");
    let pos = 0;
    sections.forEach((sec, i) => {
      insT.run(pid, ++pos, `${CN_NUM[i] || i + 1}、${SEC_TITLE[sec.type] || '题目'}`, now());
      sec.idx.forEach((ci) => insQ.run(pid, ids[ci], ++pos, each, now()));
    });
    return ok(res, Object.assign({ paper_id: pid, question_ids: ids, published: publish ? 1 : 0, score_each: each }, summary),
      `已生成试卷「${title}」：${ids.length} 题已同时入题库${publish ? '，已发布到学生端试卷库' : '（还没发布，在试卷管理里点「发布」）'}`);
  });

  return { counts: () => countBy(allItems()) };
};
