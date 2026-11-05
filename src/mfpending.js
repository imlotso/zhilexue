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
const SRC_LABEL = { photo: '拍照识别', word: 'Word导入', excel: 'Excel导入', skill: '技能包', capture: '网络采集', scan: '手机扫码（错题）', teacher_scan: '老师手机扫码', manual: '手动录入', paper: '真题试卷', lesson: '课文习题' };
const SRC_ORDER = ['photo', 'word', 'excel', 'skill', 'capture', 'scan', 'teacher_scan', 'manual', 'paper', 'lesson'];
const KIND_SRC = { image: 'photo', pdf: 'photo', word: 'word', excel: 'excel', skill: 'skill', teacher_scan: 'teacher_scan', manual: 'manual', paper: 'paper', lesson: 'lesson' };
const TYPE_CN = { single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序', answer: '解答' };
const TYPE_NAME = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题', answer: '解答题' };
const QSubtype = require('../public/js/question-subtypes');
const MatchQ = require('./match-question');
const { resolveDifficulty } = require('./difficulty');
const AiAnswerReview = require('./ai-answer-review');
const { choiceOptionsError } = require('./choice-options');
const ImageReview = require('./image-review');
const ContentReview = require('./content-review');

module.exports = function mountPending(d) {
  const { admin, db, ok, fail, now, int, parseArr, parseObj, jstr, TYPE_MAP, TYPES, commitRunCards, commitCaptureItems, store, bankFolder } = d;
  const upFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
  const str = (v) => (v == null ? '' : String(v));
  const score10 = (v) => v == null || v === '' || !Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 10 ? null : Number(v);
  // 听力音频（T7）：只认题库音频目录下的 key；条目里同时带 audio_key（存什么）和 audio_url（给后台播放预览）
  const audioKeyOf = (v) => { const k = str(v).trim(); return k && k.startsWith(bankFolder() + '/audio/') && !k.includes('..') ? k.slice(0, 255) : ''; };
  const audioLimitOf = (v) => Math.min(5, Math.max(0, int(v, 0)));
  const audioFields = (key, limit) => ({ audio_key: str(key), audio_url: key ? store.getUrlSync(key) : '', audio_play_limit: audioLimitOf(limit) });
  const safeImages = (images, errors) => (Array.isArray(images) ? images : []).map((url, i) => (Array.isArray(errors) && errors.some((e) => Number(e.index) === i)) ? '' : url);
  // 旧版拍照/PDF 卡没有核对标记，也可能完全漏掉原页中的图；统一要求老师对照原页。
  const needsFigureReview = (run, c) => !!c.figure_review_required || (['image', 'pdf'].includes(str(run.source_kind)) && int(c.page) > 0);
  // id 里带题干指纹：待审核项按"批次+序号"定位，别人删过/改过之后序号会变，旧页面上的 id 可能指向另一道题。
  // 操作前核对指纹，对不上就拒绝，避免把别的题入库/删掉。
  const fpOf = (stem) => crypto.createHash('md5').update(str(stem).trim()).digest('hex').slice(0, 8);

  // ------------------------------------------------------------ 各数据源 → 统一的待审核项
  function cardToItem(run, c, i, paper, pages) {
    const src = KIND_SRC[run.source_kind] || 'photo';
    const q = c._q;
    const type = q ? q.type : (TYPE_MAP[str(c.questionType)] || ((c.options || []).length >= 2 ? 'single' : 'answer'));
    const options = q
      ? (q.options || []).map((o) => ({ label: str(o.label), text: str(o.text) }))
      : (c.options || []).map((o) => ({ label: str(o.label), text: str(o.content != null ? o.content : o.text) }));
    const images = q ? (q.images || []) : (c.figures || []).map((x) => (x && x.url) || (typeof x === 'string' ? x : ''));
    return {
      id: `run:${run.id}:${i}:${fpOf(q ? q.stem : c.stem)}`, kind: 'run', source: src, source_label: SRC_LABEL[src],
      qno: str(c.qno), group_ref: str(c.group_ref), group_position: int(c.group_position, 0),
      batch_id: run.id, batch_title: run.title, index: i,
      original_page: int(c.page) > 0 && (pages || [])[int(c.page) - 1] && ((pages || [])[int(c.page) - 1].key || (pages || [])[int(c.page) - 1].url) ? int(c.page) : 0,
      original_pages: (pages || []).length, source_pages: Array.isArray(c.source_pages) ? c.source_pages : [],
      figure_review_required: needsFigureReview(run, c), figure_review_signature: ImageReview.signature(c), figure_review_issue: ImageReview.issue({ ...c, figure_review_required: needsFigureReview(run, c) }), figure_missing: ImageReview.missing(c),
      content_review_required: !!(c.content_review_required || c.type_unconfirmed), content_review_pending: ContentReview.pending(c, run), content_review_signature: ContentReview.signature(c, run), type_unconfirmed: !!c.type_unconfirmed,
      recognition_notes: Array.isArray(c.recognition_notes) ? c.recognition_notes.map(str) : [], cross_page_review_required: !!c.cross_page_review_required,
      paper_id: paper ? Number(paper.id) : 0, paper_subject: paper ? str(paper.subject) : '', paper_stage: paper ? str(paper.stage) : '',
      edition: paper ? str(paper.edition) : str(run.edition), term: paper ? str(paper.term) : str(run.term),
      subject: str(c.subject || (q && q.subject) || run.subject), stage: str(c.stage || (q && q.stage) || run.stage), grade: str(c.grade || (q && q.grade) || run.grade),
      type, type_name: TYPE_NAME[type] || type, type_unconfirmed: c.type_unconfirmed === true,
      question_subtype: str(c.question_subtype || (q && q.question_subtype)),
      match_prompts: MatchQ.list(c.match_prompts || (q && q.match_prompts)),
      stem: str(q ? q.stem : c.stem), material: str(c.material), options,
      answer: str(q ? q.answer : c.answer), analysis: str(q ? q.analysis : c.analysis),
      point: str(c.point || (q && q.point)), difficulty: int(c.difficulty || (q && q.difficulty), 0), difficulty_score_10: score10(c.difficulty_score_10 != null ? c.difficulty_score_10 : q && q.difficulty_score_10), chapter_id: int(c.chapter_id, 0),
      ai_recognized: !!c.ai_recognized, ai_point_suggestion: str(c.ai_point_suggestion), upload_note: str(c.upload_note),
      ai_answer_suggestion: c.ai_answer_suggestion ? { ...c.ai_answer_suggestion, stale: c.ai_answer_suggestion.basis !== AiAnswerReview.signature(c) || c.ai_answer_suggestion.scope !== JSON.stringify([run.subject || '', run.stage || '', run.grade || '']) } : null,
      ai_answer_discard_history: Array.isArray(c.ai_answer_discard_history) ? c.ai_answer_discard_history : [], ai_discard_signature: AiAnswerReview.discardSignature(c, JSON.stringify([run.subject || '', run.stage || '', run.grade || ''])),
      ai_legacy_pending: AiAnswerReview.legacyPending(c), ai_legacy_pending_fields: AiAnswerReview.legacyPendingFields(c), ai_legacy_signature: AiAnswerReview.legacyPending(c) ? AiAnswerReview.legacySignature(c) : '',
      ai_answer_review: c.ai_answer_review || null,
      ai_review_pending_fields: AiAnswerReview.reviewedPendingFields(c, JSON.stringify([run.subject || '', run.stage || '', run.grade || ''])), ai_review_signature: AiAnswerReview.signature(c),
      tags: Array.isArray(c.suggestedTags) ? c.suggestedTags : [], images: safeImages(images, c._image_errors), image_errors: Array.isArray(c._image_errors) ? c._image_errors : [], created_at: str(run.created_at),
      ...audioFields(c.audio_key, c.audio_play_limit),
    };
  }
  function runItems() {
    const out = [], papers = new Map();
    // 旧版可能因忽略空题干而把尚有未处理题卡的批次标成 done，仍须恢复到待审核。
    db.prepare('SELECT * FROM mf_recog_runs ORDER BY id DESC').all().forEach((run) => {
      const pages = parseArr(run.pages);
      parseArr(run.drafts).forEach((c, i) => {
        if (!c || c.committed || c._merged_into) return;
        const paperId = int(c._paper_id);
        if (paperId && !papers.has(paperId)) papers.set(paperId, db.prepare('SELECT id,subject,stage,edition,term FROM mf_papers WHERE id=?').get(paperId) || null);
        out.push(cardToItem(run, c, i, paperId ? papers.get(paperId) : null, pages));
      });
    });
    return out;
  }
  function capItems() {
    const out = [];
    // 同样兼容历史批次：旧版会忽略空题干并将批次错误标为已处理。
    db.prepare('SELECT * FROM mf_capture_batches ORDER BY id DESC').all().forEach((b) => {
      parseArr(b.payload).forEach((q, i) => {
        if (!q || q._done) return;
        const options = (q.options || []).map((t, k) => ({ label: str(t && t.label || LETTERS[k] || ''), text: str(t && typeof t === 'object' ? (t.text != null ? t.text : t.content) : t) }));
        const type = TYPES.includes(q.type) ? q.type : (options.length >= 2 ? 'single' : 'answer');
        const item = {
          id: `cap:${b.id}:${i}:${fpOf(q.stem || q.stemHtml)}`, kind: 'cap', source: 'capture', source_label: SRC_LABEL.capture,
          batch_id: b.id, batch_title: b.title, index: i,
          subject: str(q.subject || b.subject), stage: str(q.stage || b.stage), grade: str(q.grade || b.grade),
          type, type_name: TYPE_NAME[type] || type, type_unconfirmed: q.type_unconfirmed === true,
          question_subtype: str(q.question_subtype),
          match_prompts: MatchQ.list(q.match_prompts),
          stem: str(q.stem || q.stemHtml), material: str(q.material), options, answer: str(q.answer), analysis: str(q.analysis),
          qno: str(q.qno || q.questionId), group_ref: str(q.group_ref), group_position: int(q.group_position, 0), year: str(q.year), source_text: str(q.source_text),
          figure_missing: ImageReview.missing(q),
          point: str(q.point || ((q.meta && q.meta.knowledgePoints) || []).join('、')), difficulty: int(q.difficulty, 0), difficulty_score_10: score10(q.difficulty_score_10), chapter_id: 0,
          tags: [], images: safeImages(q.images, q._image_errors), image_errors: Array.isArray(q._image_errors) ? q._image_errors : [], created_at: str(b.created_at),
          ...audioFields(q.audio_key, q.audio_play_limit),
        };
        item.ai_answer_suggestion = suggestionFor(item, q.ai_answer_suggestion);
        item.ai_answer_review = q.ai_answer_review || null;
        item.ai_answer_discard_history = Array.isArray(q.ai_answer_discard_history) ? q.ai_answer_discard_history : [];
        item.ai_discard_signature = AiAnswerReview.discardSignature(item);
        item.ai_review_pending_fields = AiAnswerReview.reviewedPendingFields(item);
        item.ai_review_signature = AiAnswerReview.signature(item);
        out.push(item);
      });
    });
    return out;
  }
  function scanItems() {
    const rows = db.prepare(`SELECT pu.id AS up_id, pu.status AS up_status, pu.images AS up_images, pu.point AS pu_point, pu.subject AS pu_subject, pu.stage AS pu_stage,
        pu.grade AS pu_grade, pu.created_at AS up_created, pu.stem_text AS up_stem_text, pu.note AS up_note, pu.answer AS pu_answer, pu.draft_json AS pu_draft,
        q.id AS qid, q.stem, q.options, q.answer, q.analysis, q.type, q.difficulty, q.difficulty_score_10, q.point, q.images AS q_images, q.material, q.audio_key, q.audio_play_limit, q.question_subtype, q.match_prompts,
        u.name AS student_name
      FROM paper_uploads pu LEFT JOIN questions q ON q.id=pu.question_id JOIN users u ON u.id=pu.user_id
      WHERE pu.status IN ('pending','reviewed') ORDER BY pu.created_at DESC, pu.id DESC`).all();
    return rows.map((r) => {
      const draft = parseObj(r.pu_draft);
      const ups = parseArr(r.up_images); const qimgs = parseArr(r.q_images);
      const opts = (r.qid ? parseArr(r.options) : (draft.options || [])).map((o) => ({ label: str(o.label), text: str(o.text != null ? o.text : o.content) }));
      const item = {
        id: `up:${r.up_id}`, kind: 'scan', source: 'scan', source_label: SRC_LABEL.scan,
        batch_id: r.up_id, batch_title: `${r.student_name || '学生'} 扫码上传`, index: 0, qid: r.qid, up_status: r.up_status,
        subject: str(r.pu_subject), stage: str(r.pu_stage), grade: str(r.pu_grade),
        type: str(r.type || draft.type) || 'single', type_name: TYPE_NAME[r.type || draft.type] || '题目', stem: str(r.stem || draft.stem || r.up_stem_text || '（纸质错题，看图作答）'), material: str(r.material || draft.material), options: opts,
        question_subtype: str(r.qid ? r.question_subtype : draft.question_subtype),
        match_prompts: MatchQ.list(r.qid ? r.match_prompts : draft.match_prompts),
        answer: str(r.qid ? r.answer : (Object.prototype.hasOwnProperty.call(draft, 'answer') ? draft.answer : r.pu_answer)), analysis: str(r.qid ? r.analysis : draft.analysis), point: str(r.pu_point || r.point), difficulty: int(r.difficulty || draft.difficulty, 0), difficulty_score_10: score10(r.qid ? r.difficulty_score_10 : draft.difficulty_score_10), chapter_id: 0,
        tags: [], images: [...new Set([...ups, ...qimgs])], created_at: str(r.up_created), upload_note: str(r.up_note),
        ...audioFields(r.audio_key || draft.audio_key, r.qid ? r.audio_play_limit : draft.audio_play_limit),
      };
      item.ai_answer_suggestion = suggestionFor(item, draft.ai_answer_suggestion);
      item.ai_answer_review = draft.ai_answer_review || null;
      item.ai_answer_discard_history = Array.isArray(draft.ai_answer_discard_history) ? draft.ai_answer_discard_history : [];
      item.ai_discard_signature = AiAnswerReview.discardSignature(item);
      item.ai_review_pending_fields = AiAnswerReview.reviewedPendingFields(item);
      item.ai_review_signature = AiAnswerReview.signature(item);
      return item;
    });
  }
  function suggestionFor(item, suggestion) {
    return suggestion ? { ...suggestion, stale: suggestion.basis !== AiAnswerReview.signature(item) } : null;
  }
  const allItems = () => [].concat(runItems(), capItems(), scanItems());


  // 采集和学生扫码的建议独立暂存，逐项确认时在事务内锁住来源记录。
  // 历史扫码题可能已有正式题目，必须同时锁住其题目记录，防止并发审核或编辑。
  function mutateExternalAi(id, fn) {
    return db.transaction(() => {
      const p = parseId(id);
      if (!p || !['cap', 'up'].includes(p.kind)) throw new Error('题目来源不支持');
      let row, container, target;
      if (p.kind === 'cap') {
        row = db.prepare('SELECT * FROM mf_capture_batches WHERE id=? FOR UPDATE').get(p.batch);
        if (!row || row.status !== 'pending') throw new Error(STALE);
        container = parseArr(row.payload); target = container[p.index];
        if (!target || target._done || p.fp && p.fp !== fpOf(stemOfCap(target))) throw new Error(STALE);
      } else {
        row = db.prepare('SELECT * FROM paper_uploads WHERE id=? FOR UPDATE').get(p.batch);
        if (!row || !['pending', 'reviewed'].includes(row.status)) throw new Error(STALE);
        container = parseObj(row.draft_json); target = container;
        if (row.question_id && !db.prepare('SELECT id FROM questions WHERE id=? FOR UPDATE').get(row.question_id)) throw new Error(STALE);
      }
      const item = allItems().find((x) => x.id === id);
      if (!item) throw new Error(STALE);
      const result = fn({ p, row, target, item });
      if (p.kind === 'cap') db.prepare('UPDATE mf_capture_batches SET payload=? WHERE id=?').run(jstr(container), row.id);
      else db.prepare('UPDATE paper_uploads SET draft_json=? WHERE id=?').run(jstr(container), row.id);
      return result;
    })();
  }
  admin.post('/ext/pending/ai-answer', async (req, res) => {
    const ids = [...new Set(Array.isArray((req.body || {}).ids) ? req.body.ids.map(str) : [])];
    if (!ids.length || ids.length > 20) return fail(res, '请选择 1 到 20 道待审核题目');
    const current = new Map(allItems().map((x) => [x.id, x]));
    const list = ids.map((id) => current.get(id));
    if (list.some((x) => !x || !['cap', 'scan'].includes(x.kind))) return fail(res, '题目已变化，或该来源请使用录题 AI 建议入口');
    const failed = [];
    const needed = list.map((item, i) => ({ item, i, basis: AiAnswerReview.signature(item) })).filter(({ item }) => {
      if (!str(item.stem).trim() || item.stem === '（纸质错题，看图作答）') { failed.push({ id: item.id, msg: '请先补充可供解题的题干文字' }); return false; }
      if (item.ai_answer_suggestion) { failed.push({ id: item.id, msg: '已有未处理的 AI 建议，请先逐项采纳或明确舍弃' }); return false; }
      return !str(item.answer).trim() || !str(item.analysis).trim();
    });
    if (!needed.length) return ok(res, { suggested: 0, failed }, failed.length ? failed[0].msg : '所选题目已有答案和解析');
    const system = '你是中小学解题助手。只为原题缺失的答案或解析提出供老师审核的建议，不确定留空，不改写已有内容。选择题用选项字母，多选用逗号分隔；填空多个空用 | 分隔，同一空的可接受答案用 ||| 分隔。只输出 JSON：{"items":[{"i":0,"answer":"","analysis":""}]}，i 为题目编号。';
    const user = needed.map(({ item, i }) => `[i=${i}] 学科:${item.subject} 学段:${item.stage} 年级:${item.grade} 题型:${item.type}\n题干:${item.stem.slice(0, 800)}\n材料:${item.material.slice(0, 800)}\n选项:${item.options.map((o) => `${o.label}.${o.text}`).join(' ')}\n已有答案:${item.answer || '（空）'} 已有解析:${item.analysis || '（空）'}\n需要答案建议:${!str(item.answer).trim()} 需要解析建议:${!str(item.analysis).trim()}`).join('\n---\n');
    let parsed;
    try {
      const result = await require('./mfcollect').mfAiInvoke({ role: 'reasoning', system, user: user.slice(0, 50000), maxTokens: 8000, temperature: 0.1, json: true });
      const match = /\{[\s\S]*\}/.exec(str(result.text));
      if (!match) return fail(res, 'AI 没有返回有效结果，请重试');
      parsed = JSON.parse(match[0]);
    } catch (e) { return fail(res, 'AI 建议生成失败，请重试'); }
    const byIndex = new Map((Array.isArray(parsed.items) ? parsed.items : []).filter((x) => x && Number.isInteger(Number(x.i))).map((x) => [Number(x.i), x]));
    let suggested = 0;
    for (const entry of needed) {
      const answer = byIndex.get(entry.i);
      if (!answer) continue;
      try {
        const saved = mutateExternalAi(entry.item.id, ({ target, item }) => {
          if (target.ai_answer_suggestion || AiAnswerReview.signature(item) !== entry.basis) throw new Error('题目或建议已变化，请刷新后核对');
          const a = !str(item.answer).trim() ? str(answer.answer).trim().slice(0, 4000) : '';
          const explanation = !str(item.analysis).trim() ? str(answer.analysis).trim().slice(0, 12000) : '';
          if (!a && !explanation) return false;
          target.ai_answer_suggestion = { token: AiAnswerReview.token(), basis: entry.basis, answer: a, analysis: explanation };
          return true;
        });
        if (saved) suggested++;
      } catch (e) { failed.push({ id: entry.item.id, msg: e.message }); }
    }
    return ok(res, { suggested, failed }, `已生成 ${suggested} 题的 AI 建议，须老师逐项确认`);
  });
  admin.post('/ext/pending/ai-answer/discard', (req, res) => {
    const b = req.body || {}, id = str(b.id);
    try {
      mutateExternalAi(id, ({ target, item }) => {
        if (!target.ai_answer_suggestion || !target.ai_answer_suggestion.token || str(b.token) !== target.ai_answer_suggestion.token || str(b.expected) !== AiAnswerReview.discardSignature(item)) throw new Error('题目或建议已变化，请刷新后重新核对');
        AiAnswerReview.discardSuggestion(target, req.user.id, now());
      });
      return ok(res, null, '已舍弃未采纳建议；原内容、操作者和时间已保留');
    } catch (e) { return fail(res, e.message || '题目已更新，请刷新后重新核对'); }
  });
  admin.post('/ext/pending/ai-answer/confirm', (req, res) => {
    const b = req.body || {}, id = str(b.id);
    const fields = [...new Set(Array.isArray(b.fields) ? b.fields : [])];
    if (fields.length !== 1 || fields.some((x) => !['answer', 'analysis'].includes(x))) return fail(res, '请逐项选择要采纳的答案或解析建议');
    try {
      mutateExternalAi(id, ({ p, row, target, item }) => {
        if (b.recheck === true) {
          const field = fields[0];
          if (str(b.expected) !== AiAnswerReview.signature(item) || !AiAnswerReview.reviewedPendingFields(item).includes(field)) throw new Error('题目已变化，请重新核对');
          const stamp = { confirmed_by: req.user.id, confirmed_at: now(), basis: AiAnswerReview.contextSignature(item), value: str(item[field]) };
          target.ai_answer_review.fields[field] = stamp;
          if (p.kind === 'up' && row.question_id) {
            const metadata = parseObj(db.prepare('SELECT ai_review_metadata FROM questions WHERE id=?').get(row.question_id).ai_review_metadata);
            metadata.fields = { ...(metadata.fields || {}), [field]: stamp };
            db.prepare('UPDATE questions SET ai_review_metadata=? WHERE id=?').run(jstr(metadata), row.question_id);
          }
          return;
        }
        const suggestion = target.ai_answer_suggestion;
        if (!suggestion || !suggestion.token || str(b.token) !== suggestion.token || suggestion.basis !== AiAnswerReview.signature(item)) throw new Error('AI 建议已过期，请重新生成并核对');
        for (const field of fields) {
          if (!str(suggestion[field]).trim()) throw new Error('所选建议为空');
          if (str(item[field]).trim()) throw new Error('已有内容，请先人工编辑，不会自动覆盖');
        }
        const review = target.ai_answer_review || {};
        fields.forEach((field) => { item[field] = str(suggestion[field]).trim(); if (p.kind !== 'up' || !row.question_id) target[field] = item[field]; delete suggestion[field]; });
        const stamp = (field) => ({ confirmed_by: req.user.id, confirmed_at: now(), basis: AiAnswerReview.contextSignature(item), value: str(item[field]) });
        review.fields = { ...(review.fields || {}), ...Object.fromEntries(fields.map((field) => [field, stamp(field)])) };
        target.ai_answer_review = review;
        if (p.kind === 'up' && row.question_id) {
          const existing = db.prepare('SELECT ai_review_metadata FROM questions WHERE id=?').get(row.question_id);
          const metadata = parseObj(existing.ai_review_metadata);
          metadata.fields = { ...(metadata.fields || {}), ...Object.fromEntries(fields.map((field) => [field, stamp(field)])) };
          fields.forEach((field) => db.prepare(`UPDATE questions SET ${field}=? WHERE id=?`).run(item[field], row.question_id));
          db.prepare('UPDATE questions SET ai_review_metadata=? WHERE id=?').run(jstr(metadata), row.question_id);
        }
        if (!suggestion.answer && !suggestion.analysis) delete target.ai_answer_suggestion;
        else suggestion.basis = AiAnswerReview.signature(item);
      });
      return ok(res, null, '已确认，题目仍在待审核');
    } catch (e) { return fail(res, e.message || '题目已更新，请刷新后重试'); }
  });

  // 仅生成供老师确认的分类建议，不写入题目、答案、解析或节点关联。
  admin.post('/ext/pending/ai-classify', async (req, res) => {
    const ids = [...new Set(Array.isArray((req.body || {}).ids) ? req.body.ids.map(str) : [])];
    if (!ids.length || ids.length > 20) return fail(res, '请选择 1 到 20 道待审核题目');
    const current = new Map(allItems().map((item) => [item.id, item]));
    const groups = new Map(), out = [];
    ids.forEach((id) => {
      const item = current.get(id);
      if (!item) { out.push({ id, nodes: [], error: '题目已变化或不在待审核中，请刷新' }); return; }
      const subject = str(item.subject).trim(), stage = str(item.stage).trim();
      if (!subject || !stage) { out.push({ id, nodes: [], error: '请先编辑并填写学科和学段' }); return; }
      if (item.paper_id && ((item.paper_subject && item.paper_subject !== subject) || (item.paper_stage && item.paper_stage !== stage))) { out.push({ id, nodes: [], error: '题目的学科或学段与所属试卷不一致，请先核对' }); return; }
      const edition = str(item.edition).trim(), term = str(item.term).trim(), grade = str(item.grade).trim();
      const key = JSON.stringify([subject, stage, edition, term, grade]);
      if (!groups.has(key)) groups.set(key, { subject, stage, edition, term, grade, items: [] });
      groups.get(key).items.push(item);
    });
    const mock = process.env.AI_MOCK === '1';
    for (const group of groups.values()) {
      let nodes = db.prepare(`SELECT n.id, n.name, n.parent_id, t.id AS tree_id, t.name AS tree_name, t.kind, t.edition
        FROM bank_tree_nodes n JOIN bank_trees t ON t.id=n.tree_id
        WHERE t.subject=? AND (t.stage=? OR IFNULL(t.stage,'')='') AND t.kind IN ('textbook','knowledge') ORDER BY t.sort,t.id,n.sort,n.id`).all(group.subject, group.stage);
      const byTree = new Map();
      nodes.forEach((node) => byTree.set(`${node.tree_id}:${node.id}`, node));
      nodes.forEach((node) => {
        const names = [], seen = new Set(); let cur = node;
        while (cur && !seen.has(cur.id) && names.length < 30) { seen.add(cur.id); names.unshift(cur.name); cur = byTree.get(`${node.tree_id}:${cur.parent_id}`); }
        node.path = names.join(' / ');
      });
      nodes = nodes.filter((node) => {
        if (group.edition && node.kind === 'textbook' && str(node.edition) !== group.edition) return false;
        if (group.edition && node.kind === 'knowledge' && node.edition && str(node.edition) !== group.edition) return false;
        if (node.kind !== 'textbook') return true;
        const grades = node.path.match(/[一二三四五六七八九]年级/g) || [];
        const terms = node.path.match(/上册|下册|全一册/g) || [];
        const exactGrade = /^[一二三四五六七八九]年级$/.test(group.grade) ? group.grade : '';
        return !(exactGrade && grades.length && !grades.includes(exactGrade)) && !(group.term && terms.length && !terms.includes(group.term));
      });
      // 有大量节点时优先给出名称出现在题干中的候选，并对请求规模设置上限。
      const text = group.items.map((item) => item.stem).join(' ');
      nodes.sort((a, b) => Number(text.includes(b.name)) - Number(text.includes(a.name)) ||
        Number(!!group.term && b.path.includes(group.term)) - Number(!!group.term && a.path.includes(group.term)) ||
        Number(!!group.grade && b.path.includes(group.grade)) - Number(!!group.grade && a.path.includes(group.grade)) || a.id - b.id);
      const candidates = nodes.slice(0, 500);
      const byId = new Map(candidates.map((node) => [Number(node.id), node]));
      let suggestions;
      if (mock) {
        suggestions = group.items.map((item, i) => ({ i, type: item.type, difficulty_score_10: item.difficulty_score_10 || 6, node_ids: candidates.filter((n) => n.name.length >= 2 && item.stem.includes(n.name)).slice(0, 3).map((n) => n.id) }));
      } else {
        const system = '你是中小学题目分类助手。只从给定候选节点中选择与题目直接相关的章节或知识点，拿不准就留空。题型只能从 single（单选）、multi（多选）、judge（判断）、fill（填空）、sort（排序）、answer（解答）中选；difficulty_score_10 为 1–10 整数（1 最容易、10 最难）。题型或难度拿不准就给 null。不要作答，不要生成答案或解析。仅输出 JSON：{"items":[{"i":0,"type":null,"difficulty_score_10":null,"node_ids":[节点数字ID]}]}，每题最多三个节点。';
        const user = `学科：${group.subject}；学段：${group.stage}；年级：${group.grade || '未指定'}；教材版本：${group.edition || '未指定'}；册别：${group.term || '未指定'}\n候选节点（ID | 类型 | 版本 | 树名 | 路径）：\n${candidates.map((n) => `${n.id}|${n.kind}|${n.edition || '通用'}|${n.tree_name}|${n.path}`).join('\n')}\n题目：\n${group.items.map((item, i) => `[${i}] ${item.stem.slice(0, 1000)} ${(item.options || []).map((o) => `${o.label}.${o.text}`).join(' ').slice(0, 600)}`).join('\n')}`;
        try {
          const response = await require('./mfcollect').mfAiInvoke({ role: 'light', system, user, maxTokens: 2400, temperature: 0.1, json: true });
          const m = /\{[\s\S]*\}/.exec(str(response.text));
          if (!m) throw new Error('AI 未返回有效 JSON');
          const parsed = JSON.parse(m[0]); suggestions = Array.isArray(parsed.items) ? parsed.items : [];
        } catch (e) {
          group.items.forEach((item) => out.push({ id: item.id, nodes: [], error: `AI 分类建议失败：${e.message}` }));
          continue;
        }
      }
      group.items.forEach((item, i) => {
        const result = suggestions.find((s) => s && Number(s.i) === i) || {};
        const ids = [...new Set((Array.isArray(result.node_ids) ? result.node_ids : []).map(Number).filter((n) => byId.has(n)))].slice(0, 3);
        const proposedType = str(result.type).trim();
        const compatibleType = TYPES.includes(proposedType) && (!['single', 'multi', 'sort'].includes(proposedType) || (item.options || []).length >= 2)
          && (!item.question_subtype || !!QSubtype.compatible(item.question_subtype, item.subject, proposedType)) ? proposedType : '';
        const difficultyScore = score10(result.difficulty_score_10);
        const warning = !nodes.length ? (group.edition ? '所选教材版本、年级或册别暂无可用分类节点，请手动核对分类树' : '该学科和学段暂无分类树，请手动核对') : group.edition && !nodes.some((n) => n.kind === 'textbook') ? '所选版本或册别暂无可用章节节点，请手动核对分类树' : '';
        out.push({ id: item.id, scope: { edition: group.edition, term: group.term, grade: group.grade }, warning, type: compatibleType || null, difficulty_score_10: difficultyScore, nodes: ids.map((id) => { const n = byId.get(id); return { id, name: n.name, path: n.path, tree_name: n.tree_name, kind: n.kind, edition: n.edition || '' }; }) });
      });
    }
    return ok(res, { list: out, mock }, '分类建议仅供老师确认，尚未更改题目');
  });
  const countBy = (items) => {
    const c = { all: items.length };
    SRC_ORDER.forEach((k) => { c[k] = 0; });
    items.forEach((it) => { c[it.source]++; });
    return c;
  };

  // 批次视图从真实批次及上传记录生成，题量按当前存储的题卡统计。
  admin.get('/ext/pending/batches', (req, res) => {
    const source = SRC_ORDER.includes(str(req.query.source)) ? str(req.query.source) : 'all';
    const kw = str(req.query.kw).trim().toLowerCase();
    const rows = [];
    db.prepare('SELECT id,title,subject,stage,source_kind,status,error,drafts,created_at FROM mf_recog_runs ORDER BY id DESC LIMIT 300').all().forEach((run) => {
      const src = KIND_SRC[run.source_kind] || 'photo';
      const cards = parseArr(run.drafts).filter((c) => c && !c._merged_into);
      const pending = cards.filter((c) => c && !c.committed && !c._merged_into).length;
      const status = run.status === 'error' ? '识别失败' : pending ? '待核对' : run.status === 'draft' && !cards.length ? '待识别' : '已处理';
      rows.push({ kind: 'run', id: run.id, source: src, source_label: SRC_LABEL[src], title: run.title, subject: run.subject, stage: run.stage, total: cards.length, pending, status, error: run.status === 'error' ? run.error : '', created_at: run.created_at });
    });
    db.prepare('SELECT id,title,subject,stage,status,payload,created_at FROM mf_capture_batches ORDER BY id DESC LIMIT 300').all().forEach((batch) => {
      const cards = parseArr(batch.payload).filter(Boolean);
      const pending = cards.filter((q) => !q._done).length;
      rows.push({ kind: 'cap', id: batch.id, source: 'capture', source_label: SRC_LABEL.capture, title: batch.title, subject: batch.subject, stage: batch.stage, total: cards.length, pending, status: pending ? '待核对' : '已处理', error: '', created_at: batch.created_at });
    });
    db.prepare(`SELECT p.id,p.subject,p.stage,p.status,p.created_at,u.name AS student_name FROM paper_uploads p
      LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 300`).all().forEach((up) => {
      const pending = ['pending', 'reviewed'].includes(up.status) ? 1 : 0;
      rows.push({ kind: 'scan', id: up.id, source: 'scan', source_label: SRC_LABEL.scan, title: `${up.student_name || '学生'} 扫码上传`, subject: up.subject, stage: up.stage, total: 1, pending, status: pending ? '待核对' : up.status === 'rejected' ? '已拒绝' : '已处理', error: '', created_at: up.created_at });
    });
    const filtered = rows.filter((r) => (source === 'all' || r.source === source) && (!kw || `${r.title} ${r.subject} ${r.source_label}`.toLowerCase().includes(kw)));
    filtered.sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)) || b.id - a.id);
    return ok(res, { total: filtered.length, list: filtered.slice(0, 200) });
  });

  // ------------------------------------------------------------ 列表
  admin.get('/ext/pending', (req, res) => {
    const source = SRC_ORDER.includes(str(req.query.source)) ? str(req.query.source) : 'all';
    const kw = str(req.query.kw).trim().toLowerCase();
    const page = Math.max(1, int(req.query.page, 1));
    const size = Math.min(100, Math.max(1, int(req.query.size, 20)));
    const items = allItems();
    const counts = countBy(items);
    let list = items.filter((it) => source === 'all' || it.source === source);
    const batchId = int(req.query.batch_id, 0);
    if (batchId > 0 && source !== 'all') list = list.filter((it) => it.batch_id === batchId);
    if (kw) list = list.filter((it) => [it.stem, it.qno, it.batch_title, it.point, it.answer, it.material].some((t) => str(t).toLowerCase().includes(kw)));
    const missing = {
      no_answer: (it) => !str(it.answer).trim(),
      no_analysis: (it) => !str(it.analysis).trim(),
      no_image: (it) => (it.image_errors || []).length > 0 || (it.figure_missing || []).length > 0 || !!it.figure_review_issue,
      no_class: (it) => !it.subject || !it.stage || !it.point,
    };
    const statusCounts = { all: list.length };
    Object.keys(missing).forEach((key) => { statusCounts[key] = list.filter(missing[key]).length; });
    const status = str(req.query.review_status);
    if (missing[status]) list = list.filter(missing[status]);
    list.sort((a, b) => (str(b.created_at) > str(a.created_at) ? 1 : str(b.created_at) < str(a.created_at) ? -1 : 0) || (b.batch_id - a.batch_id) || (a.index - b.index));
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(page, pages);
    return ok(res, { total, page: p, size, list: list.slice((p - 1) * size, p * size), counts, status_counts: statusCounts });
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

  // 两张题卡由老师明确选择，源片段保留原字段与合并标记，不物理删除。
  admin.post('/ext/pending/merge', (req, res) => {
    const a = parseId(req.body && req.body.target_id), b = parseId(req.body && req.body.fragment_id);
    if (!a || !b || a.kind !== 'run' || b.kind !== 'run' || a.batch !== b.batch || a.index >= b.index || !a.fp || !b.fp) return fail(res, '请选择同一批次、按原顺序排列的两张待审核题卡');
    const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(a.batch);
    if (!run) return fail(res, '批次不存在或已处理');
    const cards = parseArr(run.drafts), first = cards[a.index], second = cards[b.index];
    if (!first || !second || first.committed || second.committed || first._merged_into || second._merged_into || a.fp !== fpOf(stemOfCard(first)) || b.fp !== fpOf(stemOfCard(second))) return fail(res, STALE);
    if (str(req.body.target_expected) !== ContentReview.signature(first, run) || str(req.body.fragment_expected) !== ContentReview.signature(second, run)) return fail(res, '题卡内容已变化，请刷新后重新选择');
    if (int(first.page) > 0 && int(second.page) > 0 && int(first.page) > int(second.page)) return fail(res, '请按原页顺序选择先后片段');
    try {
      const merged = require('./pending-merge').merge(first, second);
      merged._ai_card_id = merged._ai_card_id || AiAnswerReview.token();
      cards[a.index] = merged;
      cards[b.index] = { ...second, _merged_into: { index: a.index, card_id: merged._ai_card_id, by: req.user.id, at: now() } };
      const changed = db.prepare("UPDATE mf_recog_runs SET drafts=?,status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(jstr(cards), a.batch, run.drafts);
      if (!changed.changes) return fail(res, STALE);
      return ok(res, { id: `run:${a.batch}:${a.index}:${fpOf(stemOfCard(merged))}` }, '已合并；请重新对照原页核对内容、题型和图片');
    } catch (e) { return fail(res, e.message || '无法安全合并，请手动整理'); }
  });

  // 原页只从当前题目所属批次读取；指定跨页号须在同一批次范围内。
  admin.get('/ext/pending/original', (req, res) => {
    const p = parseId(req.query.id);
    if (!p || p.kind !== 'run') return fail(res, '这道题没有可对照的原页');
    const run = db.prepare('SELECT pages,drafts FROM mf_recog_runs WHERE id=?').get(p.batch);
    if (!run) return fail(res, '批次不存在');
    const card = parseArr(run.drafts)[p.index];
    if (!card || card.committed || card._merged_into || p.fp && p.fp !== fpOf(stemOfCard(card))) return fail(res, STALE);
    const pageNo = req.query.page == null ? int(card.page) : int(req.query.page), pages = parseArr(run.pages), page = pageNo > 0 ? pages[pageNo - 1] : null;
    if (!page || !(page.key || page.url)) return fail(res, '这道题没有可对照的原页');
    const url = page.key ? store.getUrlSync(page.key) : str(page.url);
    return ok(res, { page: pageNo, total: pages.length, url });
  });

  // 同源读取批次原页，避免云存储跨域导致画布无法裁剪；不接受外部 URL。
  admin.get('/ext/pending/original-image', async (req, res) => {
    const p = parseId(req.query.id);
    if (!p || p.kind !== 'run') return fail(res, '这道题没有可对照的原页');
    const run = db.prepare('SELECT pages,drafts FROM mf_recog_runs WHERE id=?').get(p.batch);
    if (!run) return fail(res, '批次不存在');
    const card = parseArr(run.drafts)[p.index];
    if (!card || card.committed || card._merged_into || p.fp && p.fp !== fpOf(stemOfCard(card))) return fail(res, STALE);
    const pageNo = req.query.page == null ? int(card.page) : int(req.query.page);
    const page = parseArr(run.pages)[pageNo - 1];
    const key = page && String(page.key || '');
    if (!key || !store.isBankKey(key, bankFolder())) return fail(res, '无法读取此批次原页');
    try {
      const bytes = await store.readBuffer(key);
      const ext = bytes && bytes.length <= 25 * 1024 * 1024 && require('./remote-image').imageType(bytes);
      if (!ext) return fail(res, '原页不存在或图片格式不受支持');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.type(ext === 'jpg' ? 'image/jpeg' : 'image/' + ext).send(bytes);
    } catch (e) { return fail(res, '读取原页失败'); }
  });

  // 老师从原页裁剪或上传题图。index 对应 [图N]，与当前批次题目绑定。
  admin.post('/ext/pending/figure', upFile.single('file'), async (req, res) => {
    const p = parseId(req.body && req.body.id), index = Number(req.body && req.body.index);
    if (!p || !['run', 'cap'].includes(p.kind) || !Number.isInteger(index) || index < 0 || index >= 30) return fail(res, '题目或图片编号无效');
    const file = req.file, image = require('./remote-image');
    if (!file || file.size > image.MAX_BYTES) return fail(res, '请选择不超过 5 MB 的图片');
    const ext = image.imageType(file.buffer);
    if (!ext) return fail(res, '只支持 PNG、JPEG、GIF 或 WebP 图片');
    const run = p.kind === 'run' ? db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch) : db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(p.batch);
    if (!run) return fail(res, '批次不存在');
    const raw = p.kind === 'run' ? run.drafts : run.payload, cards = parseArr(raw), c = cards[p.index];
    if (!c || c.committed || c._merged_into || c._done || p.fp && p.fp !== fpOf(p.kind === 'run' ? stemOfCard(c) : stemOfCap(c))) return fail(res, STALE);
    try {
      const saved = await store.saveFile(file.buffer, `figure.${ext}`, `${bankFolder()}/img`);
      const url = '/api/file?key=' + encodeURIComponent(saved.key);
      if (p.kind === 'cap') { c.images = Array.isArray(c.images) ? c.images : []; while (c.images.length <= index) c.images.push(''); c.images[index] = url; }
      else if (c._q) { c._q.images = Array.isArray(c._q.images) ? c._q.images : []; while (c._q.images.length <= index) c._q.images.push(''); c._q.images[index] = url; }
      else { c.figures = Array.isArray(c.figures) ? c.figures : []; while (c.figures.length <= index) c.figures.push(null); c.figures[index] = { url }; }
      delete c.figure_review_signature;
      if (Array.isArray(c._image_errors)) c._image_errors = c._image_errors.filter(e => Number(e.index) !== index);
      const changed = p.kind === 'run'
        ? db.prepare("UPDATE mf_recog_runs SET drafts=?,status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(jstr(cards), p.batch, raw)
        : db.prepare("UPDATE mf_capture_batches SET payload=?,status=CASE WHEN status='done' THEN 'pending' ELSE status END WHERE id=? AND payload=?").run(jstr(cards), p.batch, raw);
      if (!changed.changes) return fail(res, STALE);
      return ok(res, { url, index }, '题图已保存，请核对归属');
    } catch (e) { return fail(res, '图片保存失败：' + e.message); }
  });

  admin.post('/ext/pending/figure/confirm', (req, res) => {
    const p = parseId(req.body && req.body.id);
    if (!p || p.kind !== 'run') return fail(res, '题目标识无效');
    const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch);
    if (!run) return fail(res, '批次不存在');
    const cards = parseArr(run.drafts), c = cards[p.index];
    if (!c || c.committed || c._merged_into || p.fp && p.fp !== fpOf(stemOfCard(c)) || String(req.body.expected || '') !== ImageReview.signature(c)) return fail(res, STALE);
    if (ImageReview.missing(c).length || (Array.isArray(c._image_errors) && c._image_errors.length)) return fail(res, '还有题图未补充，请先完成补图');
    c.figure_review_required = needsFigureReview(run, c);
    c.figure_review_signature = ImageReview.signature(c);
    c.figure_review_by = req.user.id; c.figure_review_at = now();
    const changed = db.prepare("UPDATE mf_recog_runs SET drafts=?,status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(jstr(cards), p.batch, run.drafts);
    if (!changed.changes) return fail(res, STALE);
    return ok(res, null, '已确认题图与原题一致');
  });

  // 内容审核不自动采纳任何 AI 答案或解析；确认仅作用于这次原页对照的题目快照。
  admin.post('/ext/pending/content/confirm', (req, res) => {
    const p = parseId(req.body && req.body.id);
    if (!p || p.kind !== 'run') return fail(res, '题目标识无效');
    const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch);
    if (!run) return fail(res, '批次不存在或已处理');
    const cards = parseArr(run.drafts), c = cards[p.index];
    if (!c || c.committed || c._merged_into || p.fp && p.fp !== fpOf(stemOfCard(c))) return fail(res, STALE);
    if (!(c.content_review_required || c.type_unconfirmed) || str(req.body.expected) !== ContentReview.signature(c, run)) return fail(res, '题目已变化，请刷新并重新对照原页');
    if (c.type_unconfirmed) { c.type_unconfirmed = false; c.content_review_required = true; }
    c.content_review_signature = ContentReview.signature(c, run);
    c.content_review_by = req.user.id; c.content_review_at = now();
    const changed = db.prepare("UPDATE mf_recog_runs SET drafts=?,status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(jstr(cards), p.batch, run.drafts);
    if (!changed.changes) return fail(res, STALE);
    return ok(res, null, '已确认题目内容；AI 答案或解析仍须分别确认');
  });

  // 外链转存失败的题图，由老师从本地选图替换后才可入库。
  admin.post('/ext/pending/image', upFile.single('file'), async (req, res) => {
    const p = parseId(req.body && req.body.id);
    const index = Number(req.body && req.body.index);
    if (!p || !['run', 'cap'].includes(p.kind) || !Number.isInteger(index) || index < 0) return fail(res, '题目或图片标识无效');
    const file = req.file;
    const image = require('./remote-image');
    if (!file || file.size > image.MAX_BYTES) return fail(res, '请选择不超过 5 MB 的图片');
    const ext = image.imageType(file.buffer);
    if (!ext) return fail(res, '只支持 PNG、JPEG、GIF 或 WebP 图片');
    const read = () => {
      const row = p.kind === 'run' ? db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch) : db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(p.batch);
      if (!row) return null;
      const list = parseArr(p.kind === 'run' ? row.drafts : row.payload);
      const item = list[p.index];
      if (!item || item.committed || item._merged_into || item._done || p.fp && p.fp !== fpOf(p.kind === 'run' ? stemOfCard(item) : stemOfCap(item))) return null;
      if (!(Array.isArray(item._image_errors) && item._image_errors.some((x) => Number(x.index) === index))) return null;
      return { row, list, item };
    };
    if (!read()) return fail(res, STALE);
    try {
      const saved = await store.saveFile(file.buffer, `replacement.${ext}`, `${bankFolder()}/img`);
      const data = read();
      if (!data) return fail(res, STALE);
      const url = '/api/file?key=' + encodeURIComponent(saved.key);
      if (p.kind === 'run') {
        if (data.item._q && Array.isArray(data.item._q.images)) data.item._q.images[index] = url;
        if (Array.isArray(data.item.figures)) data.item.figures[index] = { url };
      } else data.item.images[index] = url;
      data.item._image_errors = data.item._image_errors.filter((x) => Number(x.index) !== index);
      const changed = p.kind === 'run'
        ? db.prepare("UPDATE mf_recog_runs SET drafts=?,status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(jstr(data.list), p.batch, data.row.drafts)
        : db.prepare("UPDATE mf_capture_batches SET payload=?,status=CASE WHEN status='done' THEN 'pending' ELSE status END WHERE id=? AND payload=?").run(jstr(data.list), p.batch, data.row.payload);
      if (!changed.changes) return fail(res, STALE);
      return ok(res, null, '图片已替换');
    } catch (e) { return fail(res, '图片保存失败：' + e.message); }
  });

  // ------------------------------------------------------------ 编辑单题
  admin.put('/ext/pending/item', (req, res) => {
    const b = req.body || {};
    const p = parseId(b.id);
    if (!p) return fail(res, '题目标识不对');
    const patch = b.patch && typeof b.patch === 'object' ? b.patch : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
    const rawOpts = has('options') ? (Array.isArray(patch.options) ? patch.options : []).map((o, k) => ({ label: str(o && o.label) || LETTERS[k] || '', text: str(o && (o.text != null ? o.text : o.content)) })) : null;
    const opts = rawOpts ? rawOpts.filter((o) => o.text.trim()) : null;
    if (opts && opts.length > 10) return fail(res, '最多支持 10 个选项');
    const type = has('type') && TYPES.includes(patch.type) ? patch.type : null;
    if ((rawOpts && rawOpts.length !== opts.length) || has('match_prompts')) {
      const old = allItems().find((x) => x.id === str(b.id));
      const subtype = has('question_subtype') ? patch.question_subtype : old && old.question_subtype;
      if (QSubtype.isMatch(subtype) && rawOpts && rawOpts.length !== opts.length) return fail(res, '匹配题的右侧选项不能为空');
      if (QSubtype.isMatch(subtype) && has('match_prompts') && (!Array.isArray(patch.match_prompts) || patch.match_prompts.some((v) => !str(v).trim()))) return fail(res, '匹配题的左侧项目不能为空');
    }
    // AI 建议确认时携带页面所见快照，避免覆盖别人刚修改的题型、难度或归属。
    if (b.expected && typeof b.expected === 'object') {
      const item = allItems().find((x) => x.id === str(b.id));
      if (!item || ['stem', 'type', 'question_subtype', 'subject', 'stage', 'difficulty', 'difficulty_score_10'].some((key) => str(item[key]) !== str(b.expected[key]))) return fail(res, '题目已更新，请刷新后重新核对 AI 建议');
      if (type && item.question_subtype && !QSubtype.compatible(item.question_subtype, item.subject, type)) return fail(res, '建议题型与原有细分题型不兼容，请先手动核对');
      if (type && ['single', 'multi', 'sort'].includes(type) && (item.options || []).length < 2) return fail(res, '该题选项不足，请先手动核对题型');
    }

    if (p.kind === 'run') {
      const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(p.batch);
      if (!run) return fail(res, '批次不存在');
      const cards = parseArr(run.drafts);
      const c = cards[p.index];
      if (!c || c.committed || c._merged_into) return fail(res, '这道题已经不在待审核里了');
      if (p.fp && p.fp !== fpOf(stemOfCard(c))) return fail(res, STALE);
      const q = c._q;
      const nextDifficulty = has('difficulty') || has('difficulty_score_10') ? resolveDifficulty(patch, { difficulty: c.difficulty || (q && q.difficulty), difficulty_score_10: c.difficulty_score_10 != null ? c.difficulty_score_10 : q && q.difficulty_score_10 }) : null;
      if (nextDifficulty && nextDifficulty.error) return fail(res, nextDifficulty.error);
      if (has('stem')) { if (q) { q.stem = str(patch.stem); q.stem_html = ''; } else c.stem = str(patch.stem); }
      if (has('answer')) { if (q) q.answer = str(patch.answer); else c.answer = str(patch.answer); }
      if (has('analysis')) { if (q) q.analysis = str(patch.analysis); else c.analysis = str(patch.analysis); }
      if (opts) { if (q) q.options = opts; else c.options = opts.map((o) => ({ label: o.label, content: o.text })); }
      if (type) { if (q) q.type = type; else c.questionType = TYPE_CN[type]; }
      if (patch.type_confirmed === true && type) c.type_unconfirmed = false;
      if (has('question_subtype')) c.question_subtype = (QSubtype.find(patch.question_subtype) || {}).code || '';
      if (has('match_prompts')) c.match_prompts = MatchQ.list(patch.match_prompts);
      if (nextDifficulty) { if (q) { q.difficulty = nextDifficulty.difficulty; q.difficulty_score_10 = nextDifficulty.difficulty_score_10; } c.difficulty = nextDifficulty.difficulty; c.difficulty_score_10 = nextDifficulty.difficulty_score_10; }
      ['point', 'material', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) { c[k] = str(patch[k]).trim(); if (q) q[k] = c[k]; } });
      if (has('chapter_id')) c.chapter_id = int(patch.chapter_id, 0);
      if (has('audio_key')) c.audio_key = audioKeyOf(patch.audio_key);
      if (has('audio_play_limit')) c.audio_play_limit = audioLimitOf(patch.audio_play_limit);
      if (has('tags')) c.suggestedTags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => str(t).trim()).filter(Boolean);
      const saved = jstr(cards);
      const changed = db.prepare("UPDATE mf_recog_runs SET drafts=?, status=CASE WHEN status='done' THEN 'recognized' ELSE status END WHERE id=? AND drafts=?").run(saved, run.id, run.drafts);
      if (!changed.changes && (db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(run.id) || {}).drafts !== saved) return fail(res, STALE);
      return ok(res, cardToItem(run, c, p.index), '已保存');
    }
    if (p.kind === 'cap') {
      const bt = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(p.batch);
      if (!bt) return fail(res, '批次不存在');
      const items = parseArr(bt.payload);
      const q = items[p.index];
      if (!q || q._done) return fail(res, '这道题已经不在待审核里了');
      if (p.fp && p.fp !== fpOf(stemOfCap(q))) return fail(res, STALE);
      const nextDifficulty = has('difficulty') || has('difficulty_score_10') ? resolveDifficulty(patch, q) : null;
      if (nextDifficulty && nextDifficulty.error) return fail(res, nextDifficulty.error);
      if (has('stem')) { q.stem = str(patch.stem); q.stemHtml = ''; }
      if (has('answer')) q.answer = str(patch.answer);
      if (has('analysis')) q.analysis = str(patch.analysis);
      if (has('material')) q.material = str(patch.material).trim();
      if (opts) q.options = opts.map((o) => o.text);
      if (type) q.type = type;
      if (patch.type_confirmed === true && type) q.type_unconfirmed = false;
      if (has('question_subtype')) q.question_subtype = (QSubtype.find(patch.question_subtype) || {}).code || '';
      if (has('match_prompts')) q.match_prompts = MatchQ.list(patch.match_prompts);
      if (nextDifficulty) { q.difficulty = nextDifficulty.difficulty; q.difficulty_score_10 = nextDifficulty.difficulty_score_10; }
      if (has('point')) { q.point = str(patch.point).trim(); q.meta = q.meta || {}; q.meta.knowledgePoints = q.point ? q.point.split(/[、,，]/).map((t) => t.trim()).filter(Boolean) : []; }
      ['subject', 'stage', 'grade'].forEach((k) => { if (has(k)) q[k] = str(patch[k]).trim(); });
      if (has('audio_key')) q.audio_key = audioKeyOf(patch.audio_key);
      if (has('audio_play_limit')) q.audio_play_limit = audioLimitOf(patch.audio_play_limit);
      const saved = jstr(items);
      const changed = db.prepare("UPDATE mf_capture_batches SET payload=?, status=CASE WHEN status='done' THEN 'pending' ELSE status END WHERE id=? AND payload=?").run(saved, bt.id, bt.payload);
      if (!changed.changes && (db.prepare('SELECT payload FROM mf_capture_batches WHERE id=?').get(bt.id) || {}).payload !== saved) return fail(res, STALE);
      return ok(res, capItems().find((x) => x.batch_id === p.batch && x.index === p.index) || null, '已保存');
    }
    // 手机扫码：新记录编辑审核草稿；兼容历史上已提前入库的记录。
    const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(p.batch);
    if (!up || !['pending', 'reviewed'].includes(up.status)) return fail(res, '上传记录不存在或已处理');
    if (up.status === 'approved') return fail(res, '该题已审核通过，不能再修改');
    if (!up.question_id) {
      const draft = parseObj(up.draft_json);
      const nextDifficulty = has('difficulty') || has('difficulty_score_10') ? resolveDifficulty(patch, draft) : null;
      if (nextDifficulty && nextDifficulty.error) return fail(res, nextDifficulty.error);
      ['stem', 'answer', 'analysis', 'material'].forEach((k) => { if (has(k)) draft[k] = str(patch[k]); });
      if (opts) draft.options = opts;
      if (type) draft.type = type;
      if (has('question_subtype')) draft.question_subtype = (QSubtype.find(patch.question_subtype) || {}).code || '';
      if (has('match_prompts')) draft.match_prompts = MatchQ.list(patch.match_prompts);
      if (nextDifficulty) { draft.difficulty = nextDifficulty.difficulty; draft.difficulty_score_10 = nextDifficulty.difficulty_score_10; }
      if (has('audio_key')) draft.audio_key = audioKeyOf(patch.audio_key);
      if (has('audio_play_limit')) draft.audio_play_limit = audioLimitOf(patch.audio_play_limit);
      db.prepare("UPDATE paper_uploads SET draft_json=?, status='reviewed' WHERE id=?").run(jstr(draft), up.id);
      ['point', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) db.prepare(`UPDATE paper_uploads SET ${k}=? WHERE id=?`).run(str(patch[k]).trim(), up.id); });
      return ok(res, scanItems().find((x) => x.id === p.id) || null, '已保存');
    }
    const existing = db.prepare('SELECT * FROM questions WHERE id=?').get(up.question_id);
    // 历史扫码题已经在正式题库：不能先改题面而继续对外暴露不再匹配的已确认 AI 答案。
    const currentItem = scanItems().find((item) => item.id === `up:${up.id}`);
    if (currentItem) {
      const projected = { ...currentItem };
      ['stem', 'answer', 'analysis', 'material', 'subject', 'stage', 'grade', 'question_subtype', 'match_prompts', 'audio_key'].forEach((key) => { if (has(key)) projected[key] = patch[key]; });
      if (opts) projected.options = opts;
      if (type) projected.type = type;
      if (AiAnswerReview.reviewedPendingFields(projected).length) return fail(res, '题目变化会使已确认的 AI 内容失效；请先清空相关答案或解析，再修改题目并重新核对');
    }
    const nextDifficulty = has('difficulty') || has('difficulty_score_10') ? resolveDifficulty(patch, existing) : null;
    if (nextDifficulty && nextDifficulty.error) return fail(res, nextDifficulty.error);
    const targetType = type || existing.type;
    const targetSubject = has('subject') ? str(patch.subject).trim() : existing.subject;
    const targetSubtype = QSubtype.compatible(has('question_subtype') ? patch.question_subtype : existing.question_subtype, targetSubject, targetType);
    if (QSubtype.isMatch(targetSubtype)) {
      const validated = MatchQ.normalize(has('match_prompts') ? patch.match_prompts : existing.match_prompts, opts || parseArr(existing.options), has('answer') ? patch.answer : existing.answer, true, targetSubtype);
      if (validated.error) return fail(res, validated.error);
    }
    const sets = []; const args = [];
    if (has('stem')) { sets.push('stem=?'); args.push(str(patch.stem)); }
    if (has('answer')) { sets.push('answer=?'); args.push(str(patch.answer)); }
    if (has('analysis')) { sets.push('analysis=?'); args.push(str(patch.analysis)); }
    if (opts) { sets.push('options=?'); args.push(jstr(opts)); }
    if (type) { sets.push('type=?'); args.push(type); }
    if (has('question_subtype')) { sets.push('question_subtype=?'); args.push(QSubtype.compatible(patch.question_subtype, has('subject') ? str(patch.subject).trim() : up.subject, type || db.prepare('SELECT type FROM questions WHERE id=?').get(up.question_id).type)); }
    if (has('match_prompts')) { sets.push('match_prompts=?'); args.push(jstr(MatchQ.list(patch.match_prompts))); }
    if (nextDifficulty) { sets.push('difficulty=?', 'difficulty_score_10=?'); args.push(nextDifficulty.difficulty, nextDifficulty.difficulty_score_10); }
    if (has('audio_key')) { sets.push('audio_key=?'); args.push(audioKeyOf(patch.audio_key)); }
    if (has('audio_play_limit')) { sets.push('audio_play_limit=?'); args.push(audioLimitOf(patch.audio_play_limit)); }
    ['point', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) { sets.push(`${k}=?`); args.push(str(patch[k]).trim()); } });
    if (sets.length) db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id=?`).run(...args, up.question_id);
    ['point', 'subject', 'stage', 'grade'].forEach((k) => { if (has(k)) db.prepare(`UPDATE paper_uploads SET ${k}=? WHERE id=?`).run(str(patch[k]).trim(), up.id); });
    if (up.status === 'pending') db.prepare("UPDATE paper_uploads SET status='reviewed' WHERE id=?").run(up.id);
    return ok(res, scanItems().find((x) => x.id === p.id) || null, '已保存');
  });

  // ------------------------------------------------------------ 入库（逐题 / 批量）
  admin.post('/ext/pending/commit', (req, res) => {
    const b = req.body || {};
    if (b.expected_scope && typeof b.expected_scope === 'object') {
      const ids = Array.isArray(b.ids) ? b.ids : [];
      const item = ids.length === 1 ? allItems().find((x) => x.id === str(ids[0])) : null;
      if (!item || ['stem', 'subject', 'stage', 'grade', 'edition', 'term'].some((key) => str(item[key]) !== str(b.expected_scope[key]))) return fail(res, '题目或教材范围已更新，请刷新后重新核对 AI 建议');
    }
    const g = groupIds(b.ids);
    if (!(g.run.size || g.cap.size || g.up.length)) return fail(res, '请先选择要入库的题目');
    const opt = {
      subject: str(b.subject).trim(), stage: str(b.stage).trim(), grade: str(b.grade).trim(),
      node_ids: Array.isArray(b.node_ids) ? b.node_ids : [], tags: Array.isArray(b.tags) ? b.tags : [],
    };
    const nodeIds = [...new Set(opt.node_ids.map(Number))];
    if (nodeIds.length > 100 || nodeIds.some((n) => !Number.isSafeInteger(n) || n <= 0)) return fail(res, '选择的分类节点无效，请重新选择');
    opt.node_ids = nodeIds;
    const selectedNodes = nodeIds.length ? db.prepare(`SELECT n.id, t.subject, t.stage FROM bank_tree_nodes n JOIN bank_trees t ON t.id=n.tree_id WHERE n.id IN (${nodeIds.map(() => '?').join(',')})`).all(...nodeIds) : [];
    if (selectedNodes.length !== nodeIds.length) return fail(res, '分类节点不存在或已删除，请重新选择');
    const nodeError = (subject, stage) => selectedNodes.some((n) => (n.subject && n.subject !== subject) || (n.stage && n.stage !== stage))
      ? '所选分类节点与题目的学科或学段不一致，请分开入库或重新选择分类' : '';
    // 去重时可能复用旧题：以实际题目字段再次校验，并确保复用题也挂上已选节点。
    const attachNodes = (qid) => {
      if (!selectedNodes.length) return;
      const q = db.prepare('SELECT subject, stage FROM questions WHERE id=?').get(qid);
      const err = q && nodeError(str(q.subject).trim(), str(q.stage).trim());
      if (!q || err) throw new Error(err || '关联题目不存在');
      const ins = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
      nodeIds.forEach((id) => ins.run(qid, id));
    };
    const questionIds = []; const failed = [];
    // R0-B8：学科、学段是题库里筛选 / 组卷 / 统计的基础，缺了不能入库（弹窗里选，或者先在「编辑」里补）
    const lacks = (subject, stage) => (!str(subject).trim() ? '没有学科，请先选好学科再入库' : (!str(stage).trim() ? '没有学段，请先选好学段再入库' : ''));
    g.bad.forEach((x) => failed.push({ id: x, msg: '题目标识不对' }));

    g.run.forEach((idxs, runId) => {
      const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(runId);
      if (!run) return idxs.forEach(({ index: i }) => failed.push({ id: `run:${runId}:${i}`, msg: '批次不存在' }));
      const cards = parseArr(run.drafts);
      uniqBy(idxs).sort((a, c) => a.index - c.index).forEach(({ index: i, fp }) => {
        const c = cards[i];
        if (!c || c.committed || c._merged_into) return failed.push({ id: `run:${runId}:${i}`, msg: '这道题已经不在待审核里了' });
        if (fp && fp !== fpOf(stemOfCard(c))) return failed.push({ id: `run:${runId}:${i}`, msg: STALE });
        if (!str(stemOfCard(c)).trim()) return failed.push({ id: `run:${runId}:${i}`, msg: '题干为空，请先对照原页补录' });
        if (AiAnswerReview.legacyPending(c)) return failed.push({ id: `run:${runId}:${i}`, msg: '历史答案、解析或分类的来源不确定，请先对照原文逐项核对' });
        const aiScope = JSON.stringify([run.subject || '', run.stage || '', run.grade || '']);
        const trackedAi = Object.values(c.ai_answer_review && c.ai_answer_review.fields || {}).some((s) => s && s.basis);
        const scopeChanged = ['subject', 'stage', 'grade'].some((key) => opt[key] && opt[key] !== str(c[key] || (c._q && c._q[key]) || run[key]));
        if (AiAnswerReview.reviewedPendingFields(c, aiScope).length || (trackedAi && scopeChanged)) return failed.push({ id: `run:${runId}:${i}`, msg: '题目内容或分类已变化，请先在编辑中调整分类，并逐项重新核对已采纳的 AI 答案和解析' });
        if (c.type_unconfirmed === true) return failed.push({ id: `run:${runId}:${i}`, msg: '题型待老师对照原题确认' });
        if (Array.isArray(c._image_errors) && c._image_errors.length) return failed.push({ id: `run:${runId}:${i}`, msg: '题图转存失败，请先补图' });
        const imageIssue = ImageReview.issue({ ...c, figure_review_required: needsFigureReview(run, c) });
        if (imageIssue) return failed.push({ id: `run:${runId}:${i}`, msg: imageIssue });
        if (ContentReview.pending(c, run)) return failed.push({ id: `run:${runId}:${i}`, msg: '识别内容尚未核对，请对照全部原页确认题型、题干、选项、公式和小问' });
        const subject = str(opt.subject || (c._q ? c._q.subject : c.subject) || run.subject).trim();
        const stage = str(opt.stage || (c._q ? c._q.stage : c.stage) || run.stage).trim();
        const miss = lacks(subject, stage) || nodeError(subject, stage);
        if (miss) return failed.push({ id: `run:${runId}:${i}`, msg: miss });
        if (c.question_subtype === 'writing' && (subject !== '英语' || (c._q ? c._q.type : TYPE_MAP[c.questionType]) !== 'answer')) return failed.push({ id: `run:${runId}:${i}`, msg: '书面表达须选择英语学科和问答基础题型' });
        if (c.question_subtype === 'drawing' && !QSubtype.compatible('drawing', subject, c._q ? c._q.type : TYPE_MAP[c.questionType])) return failed.push({ id: `run:${runId}:${i}`, msg: '作图题须选择数学、物理或化学学科及问答基础题型' });
        if (QSubtype.isMatch(c.question_subtype)) {
          if (!QSubtype.compatible(c.question_subtype, subject, c._q ? c._q.type : TYPE_MAP[c.questionType])) return failed.push({ id: `run:${runId}:${i}`, msg: '匹配题的学科或基础题型不正确' });
          const validated = MatchQ.normalize(c.match_prompts, c._q ? c._q.options : c.options, c._q ? c._q.answer : c.answer, true, c.question_subtype);
          if (validated.error) return failed.push({ id: `run:${runId}:${i}`, msg: validated.error });
          if (c._q) c._q.answer = validated.answer; else c.answer = validated.answer;
        }
        try {
          const paper = c._paper_id ? db.prepare('SELECT id, year FROM mf_papers WHERE id=?').get(int(c._paper_id)) : null;
          if (c._paper_id && !paper) throw new Error('关联试卷已删除，请重新导入');
          const video = c._lesson_video_id ? db.prepare('SELECT id, chapter_id FROM videos WHERE id=?').get(int(c._lesson_video_id)) : null;
          if (c._lesson_video_id && !video) throw new Error('关联视频已删除，请重新选择视频');
          const section = c._lesson_section_id ? db.prepare('SELECT id, chapter_id FROM sections WHERE id=?').get(int(c._lesson_section_id)) : null;
          if (c._lesson_section_id && !section) throw new Error('关联小分组已删除，请重新选择小分组');
          const ids = db.transaction(() => {
            // 允许原卷只出现图 3 等稀疏编号；入库时连同占位符一起压紧，保持图号与图片位置一致。
            const result = commitRunCards(run, [ImageReview.compact(JSON.parse(JSON.stringify(c)))], opt);
            attachNodes(result[0]);
            if (video) db.prepare('UPDATE questions SET video_id=?, chapter_id=? WHERE id=?').run(video.id, video.chapter_id || null, result[0]);
            if (section) db.prepare('UPDATE questions SET section_id=?, chapter_id=?, video_id=NULL WHERE id=?').run(section.id, section.chapter_id || null, result[0]);
            if (paper) {
              db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, score, kind, created_at) VALUES (?,?,?,?, 'question',?)")
                .run(paper.id, result[0], int(c._paper_position), Number(c._paper_score) || 0, now());
              if (paper.year) db.prepare('UPDATE questions SET year=? WHERE id=?').run(paper.year, result[0]);
            }
            return result;
          })();
          c.committed = ids[0];
          questionIds.push(ids[0]);
        } catch (e) { failed.push({ id: `run:${runId}:${i}`, msg: '入库失败：' + e.message }); }
      });
      const left = cards.filter((c) => c && !c.committed && !c._merged_into).length;
      db.prepare('UPDATE mf_recog_runs SET drafts=?, status=? WHERE id=?').run(jstr(cards), left ? (run.status === 'done' ? 'recognized' : run.status) : 'done', run.id);
    });

    g.cap.forEach((idxs, batchId) => {
      const bt = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(batchId);
      if (!bt) return idxs.forEach(({ index: i }) => failed.push({ id: `cap:${batchId}:${i}`, msg: '批次不存在' }));
      const items = parseArr(bt.payload);
      uniqBy(idxs).sort((a, c) => a.index - c.index).forEach(({ index: i, fp }) => {
        const q = items[i];
        if (!q || q._done) return failed.push({ id: `cap:${batchId}:${i}`, msg: '这道题已经不在待审核里了' });
        if (fp && fp !== fpOf(stemOfCap(q))) return failed.push({ id: `cap:${batchId}:${i}`, msg: STALE });
        if (!str(stemOfCap(q)).trim()) return failed.push({ id: `cap:${batchId}:${i}`, msg: '题干为空，请先对照原题补录' });
        const reviewItem = capItems().find((item) => item.batch_id === batchId && item.index === i);
        if (reviewItem && AiAnswerReview.reviewedPendingFields({ ...reviewItem, subject: opt.subject || reviewItem.subject, stage: opt.stage || reviewItem.stage, grade: opt.grade || reviewItem.grade }).length) return failed.push({ id: `cap:${batchId}:${i}`, msg: '题目内容或分类已变化，请逐项重新核对已采纳的 AI 答案和解析' });
        if (Array.isArray(q._image_errors) && q._image_errors.length) return failed.push({ id: `cap:${batchId}:${i}`, msg: '题图转存失败，请先补图' });
        if (ImageReview.missing(q).length) return failed.push({ id: `cap:${batchId}:${i}`, msg: '题图占位符缺少对应图片，请先补图' });
        const subject = str(opt.subject || q.subject || bt.subject).trim(), stage = str(opt.stage || q.stage || bt.stage).trim();
        const missC = lacks(subject, stage) || nodeError(subject, stage);
        if (missC) return failed.push({ id: `cap:${batchId}:${i}`, msg: missC });
        if (q.question_subtype === 'writing' && (subject !== '英语' || q.type !== 'answer')) return failed.push({ id: `cap:${batchId}:${i}`, msg: '书面表达须选择英语学科和问答基础题型' });
        if (q.question_subtype === 'drawing' && !QSubtype.compatible('drawing', subject, q.type)) return failed.push({ id: `cap:${batchId}:${i}`, msg: '作图题须选择数学、物理或化学学科及问答基础题型' });
        if (QSubtype.isMatch(q.question_subtype)) {
          if (!QSubtype.compatible(q.question_subtype, subject, q.type)) return failed.push({ id: `cap:${batchId}:${i}`, msg: '匹配题的学科或基础题型不正确' });
          const validated = MatchQ.normalize(q.match_prompts, q.options, q.answer, true, q.question_subtype);
          if (validated.error) return failed.push({ id: `cap:${batchId}:${i}`, msg: validated.error });
          q.answer = validated.answer;
        }
        try {
          // 无来源题号的题使用稳定的批次内编号，避免漏题和重复入库。
          if (!q.questionId || /^temp-/.test(str(q.questionId))) q.questionId = `review-${batchId}-${i}-${fpOf(stemOfCap(q))}`;
          const r = db.transaction(() => {
            const result = commitCaptureItems(bt, [ImageReview.compact(JSON.parse(JSON.stringify(q)))], { subject, stage, grade: opt.grade || q.grade, node_ids: opt.node_ids, tags: opt.tags });
            if (result.ids.length) attachNodes(result.ids[0]);
            return result;
          })();
          if (!r.ids.length) return failed.push({ id: `cap:${batchId}:${i}`, msg: '题目内容为空，无法入库' });
          q._done = r.ids[0];
          questionIds.push(r.ids[0]);
        } catch (e) { failed.push({ id: `cap:${batchId}:${i}`, msg: '入库失败：' + e.message }); }
      });
      const left = items.filter((q) => q && !q._done).length;
      db.prepare('UPDATE mf_capture_batches SET payload=?, status=? WHERE id=?').run(jstr(items), left ? bt.status : 'done', bt.id);
    });

    [...new Set(g.up)].forEach((upId) => {
      const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(upId);
      if (!up || !['pending', 'reviewed'].includes(up.status)) return failed.push({ id: `up:${upId}`, msg: '这道题已经不在待审核里了' });
      const reviewItem = scanItems().find((item) => item.id === `up:${upId}`);
      if (reviewItem && AiAnswerReview.reviewedPendingFields({ ...reviewItem, subject: opt.subject || reviewItem.subject, stage: opt.stage || reviewItem.stage, grade: opt.grade || reviewItem.grade }).length) return failed.push({ id: `up:${upId}`, msg: '题目内容或分类已变化，请逐项重新核对已采纳的 AI 答案和解析' });
      const subj = ['数学', '英语', '物理', '化学'].includes(opt.subject) ? opt.subject : up.subject;
      if (!['数学', '英语', '物理', '化学'].includes(str(subj))) return failed.push({ id: `up:${upId}`, msg: '学科没识别出来，请先编辑选好学科再入库' });
      const stg = opt.stage || str(up.stage).trim();
      if (!stg) return failed.push({ id: `up:${upId}`, msg: '没有学段，请先选好学段再入库' });
      const invalidNode = nodeError(str(subj).trim(), stg);
      if (invalidNode) return failed.push({ id: `up:${upId}`, msg: invalidNode });
      const grd = opt.grade || str(up.grade).trim();
      const scanDraft = up.question_id ? db.prepare('SELECT * FROM questions WHERE id=?').get(up.question_id) : parseObj(up.draft_json);
      if (!scanDraft) return failed.push({ id: `up:${upId}`, msg: '关联题目不存在，请先核对' });
      const scanOptions = up.question_id ? parseArr(scanDraft.options) : scanDraft.options;
      const choiceError = choiceOptionsError(scanDraft.type, scanOptions);
      if (choiceError) return failed.push({ id: `up:${upId}`, msg: choiceError });
      if (scanDraft.question_subtype === 'writing' && (subj !== '英语' || scanDraft.type !== 'answer')) return failed.push({ id: `up:${upId}`, msg: '书面表达须选择英语学科和问答基础题型' });
      if (scanDraft.question_subtype === 'drawing' && !QSubtype.compatible('drawing', subj, scanDraft.type)) return failed.push({ id: `up:${upId}`, msg: '作图题须选择数学、物理或化学学科及问答基础题型' });
      if (QSubtype.isMatch(scanDraft.question_subtype)) {
        if (!QSubtype.compatible(scanDraft.question_subtype, subj, scanDraft.type)) return failed.push({ id: `up:${upId}`, msg: '匹配题的学科或基础题型不正确' });
        const validated = MatchQ.normalize(scanDraft.match_prompts, up.question_id ? parseArr(scanDraft.options) : scanDraft.options, scanDraft.answer, true, scanDraft.question_subtype);
        if (validated.error) return failed.push({ id: `up:${upId}`, msg: validated.error });
      }
      try {
        const qid = db.transaction(() => {
          let id = up.question_id;
          if (!id) {
            const draft = parseObj(up.draft_json);
            const difficulty = score10(draft.difficulty_score_10) != null
              ? resolveDifficulty({ difficulty_score_10: draft.difficulty_score_10 }) : resolveDifficulty({}, draft);
            id = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,audio_key,created_at)
              VALUES (NULL,?,?,?,?,?,?,?,?,0,?,?,?,'学生上传','',NULL,?,?,?)`)
              .run(subj, grd, TYPES.includes(draft.type) ? draft.type : 'answer', str(draft.stem || up.stem_text || '（纸质错题，看图作答）'), jstr(draft.options || []), str(Object.prototype.hasOwnProperty.call(draft, 'answer') ? draft.answer : up.answer), str(draft.analysis), difficulty.difficulty, stg, str(up.point), str(draft.material), up.images || '[]', audioKeyOf(draft.audio_key), now()).lastInsertRowid;
            if (draft.ai_answer_review || (Array.isArray(draft.ai_answer_discard_history) && draft.ai_answer_discard_history.length)) db.prepare('UPDATE questions SET ai_review_metadata=? WHERE id=?').run(jstr(AiAnswerReview.withDiscardHistory(draft.ai_answer_review, draft.ai_answer_discard_history)), id);
            if (difficulty.difficulty_score_10 != null) db.prepare('UPDATE questions SET difficulty_score_10=? WHERE id=?').run(difficulty.difficulty_score_10, id);
            if (draft.audio_play_limit) db.prepare('UPDATE questions SET audio_play_limit=? WHERE id=?').run(audioLimitOf(draft.audio_play_limit), id);
            const subtype = QSubtype.compatible(draft.question_subtype, subj, draft.type);
            if (subtype) db.prepare('UPDATE questions SET question_subtype=? WHERE id=?').run(subtype, id);
            if (QSubtype.isMatch(subtype)) db.prepare('UPDATE questions SET match_prompts=? WHERE id=?').run(jstr(MatchQ.list(draft.match_prompts)), id);
            db.prepare("INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review) VALUES (?,?,1,'',0,?,0,'')").run(up.user_id, id, now());
          } else {
            db.prepare('UPDATE questions SET subject=?, stage=?, grade=? WHERE id=?').run(subj, stg, grd, id);
            const history = parseObj(up.draft_json).ai_answer_discard_history;
            if (Array.isArray(history) && history.length) {
              const existing = db.prepare('SELECT ai_review_metadata FROM questions WHERE id=?').get(id);
              db.prepare('UPDATE questions SET ai_review_metadata=? WHERE id=?').run(jstr(AiAnswerReview.withDiscardHistory(parseObj(existing.ai_review_metadata), history)), id);
            }
          }
          const insNode = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
          opt.node_ids.map((n) => int(n)).filter(Boolean).forEach((n) => insNode.run(id, n));
          const insTag = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
          opt.tags.map((t) => str(t).trim()).filter(Boolean).forEach((t) => insTag.run(id, t));
          db.prepare("UPDATE paper_uploads SET question_id=?, subject=?, stage=?, grade=?, status='approved', reviewed_by=?, reviewed_at=? WHERE id=?").run(id, subj, stg, grd, req.user ? req.user.id : 0, now(), up.id);
          return id;
        })();
        questionIds.push(qid);
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
        const linked = cards[i] && cards.some(c => c && c._merged_into && c._merged_into.card_id === cards[i]._ai_card_id);
        if (cards[i] && !cards[i].committed && !cards[i]._merged_into && !linked && (!fp || fp === fpOf(stemOfCard(cards[i])))) { cards.splice(i, 1); n++; } else stale++;
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
    const positions = {};
    cards.forEach((card) => { if (card.group_ref) card.group_position = positions[card.group_ref] = (positions[card.group_ref] || 0) + 1; });
    const info = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, subject || '', stage || '', grade || '', kind, name || '', 'recognized', '[]', jstr(cards), '[]', '', now());
    return info.lastInsertRowid;
  }
  function manualFigures(images) {
    if (!Array.isArray(images)) return [];
    if (images.length > 30) return null;
    const keys = images.map((url) => store.bankImageKey(url, bankFolder()));
    if (keys.some((key) => !key || !key.startsWith(`${bankFolder()}/img/`))) return null;
    return keys.map((key) => ({ url: store.bankImageProxyUrl(key) }));
  }
  // 图片/PDF 工作台识别完成后保存成试卷草稿，题卡审核时按原顺序回挂。
  admin.post('/papers/from-run', (req, res) => {
    const b = req.body || {};
    const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(int(b.run_id));
    if (!run) return fail(res, '录题批次不存在');
    const cards = parseArr(run.drafts);
    const active = cards.filter(c => c && !c._merged_into);
    if (cards.some(c => !c) || !active.length || active.some(c => c.committed || c._paper_id || !str(stemOfCard(c)).trim())) return fail(res, '请先完成题卡识别；已入库或已关联试卷的批次不能重复生成');
    const title = str(b.title || run.title).trim();
    const subject = str(b.subject || run.subject).trim(), stage = str(b.stage || run.stage).trim(), grade = str(b.grade || run.grade).trim();
    const year = /^\d{4}$/.test(str(b.year)) ? str(b.year) : '';
    const examCategory = str(b.exam_category || '');
    if (!['', 'unit', 'midterm', 'final', 'entrance'].includes(examCategory)) return fail(res, '请选择有效的试卷类型');
    const edition = str(b.edition).trim().slice(0, 80), term = str(b.term).trim();
    if (!['', '上册', '下册', '全一册'].includes(term)) return fail(res, '请选择有效的册别');
    if (!title || !subject || !stage) return fail(res, '请填写试卷名称、学科和学段');
    const result = db.transaction(() => {
      const pid = db.prepare(`INSERT INTO mf_papers (title,subject,stage,grade,year,status,paper_type,layout_json,folder_id,trashed_from,published,created_at)
        VALUES (?,?,?,?,?,'basket','uniform',?,NULL,'',0,?)`).run(title,subject,stage,grade,year,jstr(require('./mfbank').defaultLayout()),now()).lastInsertRowid;
      if (examCategory) db.prepare('UPDATE mf_papers SET exam_category=? WHERE id=?').run(examCategory, pid);
      if (edition || term) db.prepare('UPDATE mf_papers SET edition=?,term=? WHERE id=?').run(edition,term,pid);
      const score = Math.round(100 / active.length * 10) / 10;
      active.forEach((c, i) => { c._paper_id=pid; c._paper_position=i+1; c._paper_score=score; });
      db.prepare('UPDATE mf_recog_runs SET title=?, subject=?, stage=?, grade=?, source_kind=?, drafts=? WHERE id=?').run(title,subject,stage,grade,'paper',jstr(cards),run.id);
      return { paper_id:pid, count:active.length };
    })();
    return ok(res, result, '试卷草稿已创建，题目审核后自动加入试卷');
  });
  // 手动录入也先保存到审核批次；不会直接写入正式题库。
  admin.post('/ext/pending/manual', (req, res) => {
    const b = req.body || {};
    const stem = str(b.stem).trim();
    if (!stem) return fail(res, '请填写题干');
    if (!['数学', '英语', '物理', '化学', '语文'].includes(str(b.subject))) return fail(res, '请选择学科');
    if (!['primary', 'junior', 'senior'].includes(str(b.stage))) return fail(res, '请选择学段');
    const type = TYPES.includes(str(b.type)) ? str(b.type) : 'answer';
    if (QSubtype.isMatch(b.question_subtype) && !QSubtype.compatible(b.question_subtype, str(b.subject), type)) return fail(res, '匹配题的学科或基础题型不正确');
    if (str(b.question_subtype) === 'writing' && (str(b.subject) !== '英语' || type !== 'answer')) return fail(res, '书面表达须选择英语学科和问答基础题型');
    if (str(b.question_subtype) === 'drawing' && !QSubtype.compatible('drawing', str(b.subject), type)) return fail(res, '作图题须选择数学、物理或化学学科及问答基础题型');
    if (Array.isArray(b.options) && b.options.length > 10) return fail(res, '最多支持 10 个选项');
    const rawOptions = (Array.isArray(b.options) ? b.options : []).map((o, i) => ({ label: LETTERS[i], content: str(o).trim() }));
    const options = rawOptions.filter((o) => o.content);
    let match = null;
    if (QSubtype.isMatch(b.question_subtype)) {
      if (rawOptions.length !== options.length) return fail(res, '匹配题的右侧选项不能为空');
      match = MatchQ.normalize(b.match_prompts, options, b.answer, true, b.question_subtype);
      if (match.error) return fail(res, match.error);
    }
    const figures = manualFigures(b.images); if (!figures) return fail(res, '题图无效或超过 30 张，请重新上传');
    const card = { stem, questionType: TYPE_FROM_CODE(type), question_subtype: QSubtype.compatible(b.question_subtype, str(b.subject), type), match_prompts: match ? match.prompts : MatchQ.list(b.match_prompts), options, figures, material: str(b.material).trim(), audio_key: audioKeyOf(b.audio_key), audio_play_limit: audioLimitOf(b.audio_play_limit), answer: match ? match.answer : str(b.answer).trim(), analysis: str(b.analysis).trim(), subject: str(b.subject), stage: str(b.stage), grade: str(b.grade).trim(), point: str(b.point).trim() };
    const id = createRun({ title: '手动录题', kind: 'manual', name: '手动录题', subject: card.subject, stage: card.stage, grade: card.grade, cards: [card] });
    return ok(res, { id }, '已保存到待审核');
  });
  // 组合题保存为同一批次的独立小题；每张题卡保留材料快照，逐题审核和作答。
  admin.post('/ext/pending/manual-group', (req, res) => {
    const b = req.body || {};
    const subject = str(b.subject).trim(), stage = str(b.stage).trim(), grade = str(b.grade).trim();
    const material = str(b.material).trim();
    if (!['数学', '英语', '物理', '化学', '语文'].includes(subject)) return fail(res, '请选择学科');
    if (!['primary', 'junior', 'senior'].includes(stage)) return fail(res, '请选择学段');
    if (!material) return fail(res, '请填写组合题材料');
    if (!Array.isArray(b.questions) || b.questions.length < 2 || b.questions.length > 30) return fail(res, '组合题需要 2 至 30 道小题');
    const cards = [];
    for (let i = 0; i < b.questions.length; i++) {
      const q = b.questions[i] || {}, stem = str(q.stem).trim();
      const type = TYPES.includes(str(q.type)) ? str(q.type) : '';
      if (QSubtype.isMatch(q.question_subtype) && !QSubtype.compatible(q.question_subtype, subject, type)) return fail(res, `第 ${i + 1} 小题：匹配题的学科或基础题型不正确`);
      if (str(q.question_subtype) === 'writing' && (subject !== '英语' || type !== 'answer')) return fail(res, `第 ${i + 1} 小题：书面表达须选择英语学科和问答基础题型`);
      if (str(q.question_subtype) === 'drawing' && !QSubtype.compatible('drawing', subject, type)) return fail(res, `第 ${i + 1} 小题：作图题须选择数学、物理或化学学科及问答基础题型`);
      if (!stem || !type) return fail(res, `第 ${i + 1} 小题请填写题干并选择题型`);
      const rawOptionText = (Array.isArray(q.options) ? q.options : []).map((o) => str(o).trim());
      const optionText = rawOptionText.filter(Boolean);
      if (QSubtype.isMatch(q.question_subtype) && rawOptionText.length !== optionText.length) return fail(res, `第 ${i + 1} 小题：匹配题的右侧选项不能为空`);
      const optionMax = ['single', 'multi'].includes(type) ? 10 : 7;
      if (optionText.length > optionMax) return fail(res, `第 ${i + 1} 小题最多支持 ${optionMax} 个选项`);
      const options = optionText.map((content, k) => ({ label: LETTERS[k], content }));
      if (['single', 'multi', 'sort'].includes(type) && options.length < 2) return fail(res, `第 ${i + 1} 小题至少需要两个选项`);
      const answer = str(q.answer).trim();
      if (answer && ['single', 'multi'].includes(type)) {
        const letters = answer.toUpperCase().replace(/[\s,，、;；]/g, '');
        if (!/^[A-J]+$/.test(letters) || [...letters].some((v) => LETTERS.indexOf(v) >= options.length) || new Set(letters).size !== letters.length || (type === 'single' && letters.length !== 1) || (type === 'multi' && letters.length < 2)) return fail(res, `第 ${i + 1} 小题的答案与选项不匹配`);
      }
      if (answer && type === 'judge' && !['正确', '对', '√', 'T', 'TRUE', 'A', 'Y', 'YES', '是', '错误', '错', '×', 'X', 'F', 'FALSE', 'B', 'N', 'NO', '否'].includes(answer.toUpperCase())) return fail(res, `第 ${i + 1} 小题的判断答案请填正确或错误`);
      if (answer && type === 'sort' && !QSubtype.isMatch(q.question_subtype)) {
        const seq = /^[A-G\s,，、;；]+$/i.test(answer) ? (answer.toUpperCase().match(/[A-G]/g) || []).map((v) => LETTERS.indexOf(v) + 1) : answer.split(/[\s,，、;；]+/).filter(Boolean).map(Number);
        if (seq.length !== options.length || new Set(seq).size !== options.length || seq.some((v) => !Number.isInteger(v) || v < 1 || v > options.length)) return fail(res, `第 ${i + 1} 小题的排序答案应包含每个选项一次`);
      }
      const subtype = QSubtype.compatible(q.question_subtype, subject, type);
      if (QSubtype.isMatch(subtype)) {
        const checked = MatchQ.normalize(q.match_prompts, options, answer, true, subtype);
        if (checked.error) return fail(res, `第 ${i + 1} 小题：${checked.error}`);
      }
      const figures = manualFigures(q.images); if (!figures) return fail(res, `第 ${i + 1} 小题：题图无效或超过 30 张，请重新上传`);
      cards.push({ stem, questionType: TYPE_FROM_CODE(type), question_subtype: subtype, match_prompts: MatchQ.list(q.match_prompts), options, figures,
        material, answer, analysis: str(q.analysis).trim(), subject, stage, grade, group_ref: 'manual',
        audio_key: audioKeyOf(b.audio_key), audio_play_limit: audioLimitOf(b.audio_play_limit) });
    }
    const id = createRun({ title: '手动录入组合题', kind: 'manual', name: '手动录入组合题', subject, stage, grade, cards });
    return ok(res, { id, count: cards.length }, '小题已保存到待审核');
  });
  const fileNameOf = (f) => {
    const s = str(f && f.originalname);
    if (!/[\u0080-ÿ]/.test(s)) return s;
    try { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('�') ? s : u; } catch (e) { return s; }
  };

  // 默认原样提供客户模板；扩展字段仅追加到各工作表末尾。
  admin.get('/ext/import-template', (req, res) => {
    const p = require('path').join(__dirname, '..', 'data', '习题导入模板.xlsx');
    if (!require('fs').existsSync(p)) return fail(res, '模板文件不存在');
    const english = String(req.query.english_subtypes || '') === '1';
    const math = String(req.query.math_subtypes || '') === '1';
    const difficulty10 = String(req.query.difficulty_10 || '') === '1';
    const options10 = String(req.query.options_10 || '') === '1';
    if (!english && !math && !difficulty10 && !options10) return res.download(p, '习题导入模板.xlsx');
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(p);
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      const headers = english ? ['英语细分题型（选填）', '匹配左侧项目（每行一项）', '十级难度（1–10，选填）'] : math ? ['数学细分题型（选填）', '匹配左侧项目（每行一项）', '十级难度（1–10，选填）'] : difficulty10 ? ['十级难度（1–10，选填）'] : [];
      if (['单选题', '多选题', '完形填空题', '选择填空题', '阅读理解题'].includes(name.replace(/\s+/g, ''))) {
        const present = new Set(XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: '' })[0].map((v) => String(v).replace(/\s+/g, '').replace(/[（(][^）)]*[)）]/g, '')));
        for (const letter of LETTERS) if (!present.has('选项' + letter)) headers.push('选项' + letter + '（选填）');
      }
      if (!headers.length) return;
      XLSX.utils.sheet_add_aoa(ws, [headers], { origin: { r: 0, c: range.e.c + 1 } });
    });
    if (english) {
      const writing = XLSX.utils.aoa_to_sheet([
        ['题目（必填）', '参考范文（选填）', '解析（选填）', '标签（选填）', '十级难度（1–10，选填）'],
        ['【例题】写一篇关于你学校的短文', '', '', '书面表达', ''],
      ]);
      XLSX.utils.book_append_sheet(wb, writing, '书面表达题');
    }
    if (math) {
      const drawing = XLSX.utils.aoa_to_sheet([
        ['题目（必填）', '参考答案（选填）', '解析（选填）', '标签（选填）', '十级难度（1–10，选填）'],
        ['【例题】作出线段 AB 的垂直平分线', '', '', '作图', ''],
      ]);
      XLSX.utils.book_append_sheet(wb, drawing, '作图题');
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('习题导入模板.xlsx'));
    return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
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
      question_subtype: str(q.question_subtype), match_prompts: MatchQ.list(q.match_prompts), group_ref: str(q.group_ref),
      options: (q.options || []).map((t, k) => ({ label: LETTERS[k], content: str(t) })),
      ...(q.difficulty != null ? { difficulty: q.difficulty } : {}),
      ...(q.difficulty_score_10 != null ? { difficulty_score_10: q.difficulty_score_10 } : {}),
      answer: str(q.answer), analysis: str(q.analysis), point: str(q.point), suggestedTags: [], figures: [], checked: true,
    }));
    const b = req.body || {};
    if (str(b.subject).trim() && cards.some((c) => c.question_subtype && !QSubtype.compatible(c.question_subtype, str(b.subject).trim(), TYPE_MAP[c.questionType]))) return fail(res, '细分题型与所选学科不匹配，请修改学科或细分题型');
    const subject = str(b.subject).trim(), stage = str(b.stage).trim(), edition = str(b.edition).trim();
    const term = str(b.term).trim(), materialType = str(b.material_type).trim();
    if (edition && !db.prepare("SELECT id FROM bank_trees WHERE subject=? AND stage=? AND edition=? LIMIT 1").get(subject, stage, edition)) return fail(res, '教材版本与学科或学段不一致，请重新选择');
    if (!['', '上册', '下册', '全一册'].includes(term)) return fail(res, '请选择有效的册别');
    if (!['', 'textbook', 'exercise', 'paper', 'other'].includes(materialType)) return fail(res, '请选择有效的资料类型');
    const runId = db.transaction(() => {
      const id = createRun({ title: `Excel导入 ${name}`, kind: 'excel', name, subject, stage, grade: str(b.grade).trim(), cards });
      if (edition || term || materialType) db.prepare('UPDATE mf_recog_runs SET edition=?,term=?,material_type=? WHERE id=?').run(edition, term, materialType, id);
      return id;
    })();
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
          try { const saved = await store.saveFile(buf, fname, `${bankFolder()}/img`); return store.bankImageKey(saved.key, bankFolder()) ? store.bankImageProxyUrl(saved.key) : await store.getUrl(saved.key); } catch (e) { return ''; }
        },
      });
    } catch (e) { return { err: '文档解析失败：' + e.message }; }
    const r = require('./wordq').parseWordQuestions(doc.paras);
    const lines = r.errors.slice(0, 5).map((e) => `第 ${e.para} 段（第 ${e.no} 题）：${e.msg}`);
    if (!r.list.length) {
      return { err: r.errors.length ? `没有可导入的题目。${lines.join('；')}` : '没认出题目。请确认格式：题目要有序号（1. 2. 3、），选项用 A. 或 A、，答案和解析各另起一行（见「Word 导入格式要求」）' };
    }
    const figs = doc.figs || [];
    if (r.list.some((q) => q.imgRefs.some((n) => !(figs[n - 1] && figs[n - 1].url)))) return { err: '文档中的题图未能保存，请检查存储后重新导入' };
    const cards = r.list.map((q) => ({
      ...(() => {
        const remap = (value) => str(value).replace(/\[图(\d+)\]/g, (m, n) => { const i = q.imgRefs.indexOf(Number(n)); return i < 0 ? m : `[图${i + 1}]`; });
        return { qno: q.sub ? `${q.no}(${q.sub})` : String(q.no), questionType: TYPE_FROM_CODE(q.type), question_subtype: q.question_subtype || '', type_unconfirmed: !!q.type_unconfirmed, match_prompts: MatchQ.list(q.match_prompts).map(remap), group_ref: q.group_ref || '', stem: remap(q.stem), material: remap(q.material), options: q.options.map((o) => ({ label: o.label, content: remap(o.content) })), answer: q.answer, analysis: remap(q.analysis) };
      })(),
      ...(q.difficulty_score_10 != null ? { difficulty_score_10: q.difficulty_score_10 } : {}),
      suggestedTags: [], figures: q.imgRefs.map((n) => figs[n - 1]).filter((f) => f && f.url).map((f) => ({ url: f.url })), checked: true,
      _type: q.type,
    }));
    return { r, cards, name };
  }

  admin.post('/ext/import-word', upFile.single('file'), async (req, res) => {
    const b = req.body || {};
    const subject = str(b.subject).trim(), stage = str(b.stage).trim(), edition = str(b.edition).trim();
    const term = str(b.term).trim(), materialType = str(b.material_type).trim();
    if (edition && !db.prepare('SELECT id FROM bank_trees WHERE subject=? AND stage=? AND edition=? LIMIT 1').get(subject, stage, edition)) return fail(res, '教材版本与学科或学段不一致，请重新选择');
    if (!['', '上册', '下册', '全一册'].includes(term)) return fail(res, '请选择有效的册别');
    if (!['', 'textbook', 'exercise', 'paper', 'other'].includes(materialType)) return fail(res, '请选择有效的资料类型');
    const pw = await parseWordUpload(req.file);
    if (pw.err) return fail(res, pw.err);
    const { r, cards, name } = pw;
    const runId = db.transaction(() => {
      const id = createRun({ title: `Word导入 ${name}`, kind: 'word', name, subject, stage, grade: str(b.grade).trim(), cards });
      if (edition || term || materialType) db.prepare('UPDATE mf_recog_runs SET edition=?,term=?,material_type=? WHERE id=?').run(edition, term, materialType, id);
      return id;
    })();
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
    const examCategory = str(b.exam_category || '');
    if (!['', 'unit', 'midterm', 'final', 'entrance'].includes(examCategory)) return fail(res, '请选择有效的试卷类型');
    const edition = str(b.edition).trim().slice(0, 80), term = str(b.term).trim();
    if (!['', '上册', '下册', '全一册'].includes(term)) return fail(res, '请选择有效的册别');
    // 只合并相邻的同类题，保留文档题序；题型未确认的选择题不得预写成单选或多选。
    const sections = [];
    cards.forEach((c, i) => {
      const key = c.type_unconfirmed && ['single', 'multi'].includes(c._type) ? 'choice_unconfirmed' : c._type;
      let sec = sections[sections.length - 1];
      if (!sec || sec.type !== key) { sec = { type: key, idx: [] }; sections.push(sec); }
      sec.idx.push(i);
    });
    const sectionName = (sec, i) => `${CN_NUM[i] || i + 1}、${sec.type === 'choice_unconfirmed' ? '待核对选择题' : (SEC_TITLE[sec.type] || '题目')}`;
    const summary = { total: cards.length, big_count: r.bigCount, error_count: r.errors.length, errors: r.errors.slice(0, 50), warnings: r.warnings.slice(0, 20),
      sections: sections.map((sec, i) => ({ name: sectionName(sec, i), count: sec.idx.length })),
      sample: cards.slice(0, 3).map((c) => ({ type: c.questionType, stem: str(c.stem).slice(0, 500), options: (c.options || []).slice(0, 8) })), title, year };
    if (String(b.dry_run) === '1') return ok(res, summary, `识别出 ${cards.length} 题${r.errors.length ? `，${r.errors.length} 题格式不对（不会导入）` : ''}`);

    if (!cards.length) return fail(res, '没有识别到可导入的题目');
    if (!subject || !stage) return fail(res, '请选择学科和学段');
    const each = Math.round(100 / cards.length * 10) / 10;
    const created = db.transaction(() => {
      const pid = db.prepare(`INSERT INTO mf_papers (title, subject, stage, grade, year, status, paper_type, layout_json, folder_id, trashed_from, published, created_at)
        VALUES (?,?,?,?,?,'basket','uniform',?,?,'',0,?)`)
        .run(title, subject, stage, grade, year, jstr(Object.assign({}, require('./mfbank').defaultLayout(), { header: { style: 'exam', title, lines: [] } })), int(b.folder_id) || null, now()).lastInsertRowid;
      if (examCategory) db.prepare('UPDATE mf_papers SET exam_category=? WHERE id=?').run(examCategory, pid);
      if (edition || term) db.prepare('UPDATE mf_papers SET edition=?,term=? WHERE id=?').run(edition,term,pid);
      const insT = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, kind, text_body, style, text_align, created_at) VALUES (?,NULL,?, 'text',?, 'title','left',?)");
      let pos = 0;
      sections.forEach((sec, i) => {
        insT.run(pid, ++pos, sectionName(sec, i), now());
        sec.idx.forEach((ci) => { cards[ci]._paper_id = pid; cards[ci]._paper_position = ++pos; cards[ci]._paper_score = each; delete cards[ci]._type; });
      });
      const runId = createRun({ title, kind: 'paper', name: '真题试卷', subject, stage, grade, cards });
      return { pid, runId };
    })();
    return ok(res, Object.assign({ paper_id: created.pid, run_id: created.runId, question_ids: [], published: 0, score_each: each }, summary),
      `已创建试卷草稿，${cards.length} 道题已进入待审核；审核入库后会自动加入试卷。`);
  });

  return { counts: () => countBy(allItems()) };
};
