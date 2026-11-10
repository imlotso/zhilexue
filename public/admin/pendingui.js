/* 待审核题目（T3）：各入口（Excel / Word / 拍照识别 / 技能包 / 网络采集 / 手机扫码）入库前的题目统一在这里，
 * 逐题看、改、入库。数据来自 mfpending.js 的 /ext/pending 系列接口。
 * 由 admin.js 的 VIEWS.pending 调用；依赖 admin.js 的 ADM / modal / esc / ic / render / pagerHTML / bindPager，
 * api.js 的 api / toast / elConfirm，mathlib.js 的 mtxTypeset。
 */
const PD_API = '/api/admin/bank/mf';
const PD_SRC = [['all', '全部'], ['photo', '拍照识别'], ['word', 'Word导入'], ['excel', 'Excel导入'], ['skill', '技能包'], ['capture', '网络采集'], ['scan', '手机扫码（错题）'], ['teacher_scan', '老师手机扫码'], ['manual', '手动录入'], ['paper', '真题试卷'], ['lesson', '课文习题']];
const PD_REVIEW = [['all', '全部题目'], ['needs_review', '待核对'], ['no_answer', '缺答案'], ['no_analysis', '缺解析'], ['no_image', '待补图'], ['no_class', '缺分类']];
const PD_TYPES = [['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'], ['fill', '填空题'], ['sort', '排序题'], ['answer', '解答题']];
const PD_STAGES = [['', '未识别'], ['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const PD_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const PD_GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const pdStageName = (k) => (PD_STAGES.find((s) => s[0] === k) || [])[1] || '';
const pdOpts = (list, cur, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : '')
  + list.map((x) => { const v = Array.isArray(x) ? x[0] : x; const t = Array.isArray(x) ? x[1] : x; return `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
const pdBr = (s) => esc(s).replace(/\n/g, '<br>');
// 新批次进入核对时，来源、批次和列表筛选必须一起切换。
function pdSelectBatch(source, batchId) {
  const st = ADM.page.pd = ADM.page.pd || {};
  Object.assign(st, { source, batch_id: Number(batchId) || 0, kw: '', review: 'all', mode: 'questions', active: '', sel: {}, mergePins: [] });
  ADM.page.pdPage = 1;
}
const pdImage = (src, alt) => {
  const url = String(src || '').trim();
  if (!/^(?:https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url)) return '';
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy"></a>`;
};
function pdStemImages(it) {
  const images = Array.isArray(it.images) ? it.images : [], used = new Set();
  const render = (value) => pdBr(value || '').replace(/\[图(\d+)\]/g, (m, n) => {
    const index = Number(n) - 1, img = pdImage(images[index], `图${n}`);
    if (!img) return m;
    used.add(index); return `<span class="pd-inline-img">${img}</span>`;
  });
  const html = render(it.stem);
  const material = render(it.material);
  const analysis = render(it.analysis);
  const prompts = (it.match_prompts || []).map(render);
  const options = (it.options || []).map((o) => render(optText(o)));
  const rest = images.slice(0, 30).map((url, i) => used.has(i) ? '' : pdImage(url, '题图')).join('');
  return { html, material, analysis, prompts, options, rest };
}

/** Word 导入的格式要求（客户《word (1).docx》原意） */
const PD_WORD_RULES = `
  <div class="pd-rules">
    <p><b>通用</b>：每道题要有序号（<code>1.</code> <code>2.</code> <code>3、</code>）；选项用 <code>A.</code> 或 <code>A、</code>（不能用（A）、【A】、A)，可在 Word 里用 Ctrl+F 批量替换）；四个选项可放一行，但之间要隔开一段距离；原文有答案、解析时请各另起一行。<b>原文没有答案或解析可以不写</b>，待审核会提示缺答案；未注明单选或多选且没有答案时，须老师确认题型。</p>
    <p><b>单选 / 多选</b>：答案写选项字母，多选 2 个及以上（如 <code>答案：CD</code>）。<b>判断</b>：答案 对/错、正确/错误、正/误。</p>
    <p><b>填空</b>：空用 <code>_______</code> 或括号（），提供答案时一个空一个答案，答案另起一行、用「；」隔开（<code>答案：Does；often；fishing</code>）。</p>
    <p><b>十级难度（选填）</b>：每题单独写一行 <code>难度（1–10）：7</code> 或 <code>十级难度：7</code>，必须是 1 至 10 的整数；不填时保留未知。多小问可先写大题难度，并在小问内单独覆盖。</p>
    <p><b>问答</b>：计算题、简答题、论述题一概写成问答题。有多个小问时，小问号用（1）（2），整题放在 <code>[问答题]</code> 和 <code>[问答题结束]</code> 之间。</p>
    <p>题型可以用小节标题（<code>单选题</code>、<code>多选题</code>…）或题号后的括号（<code>1.（单选题）…</code>）标明，每个小节题号可以从 1 重新开始。导入后每道题都会先进待审核，不会直接入库。</p>
    <p>英语单题也可在小节标题或题号后注明「听力选择题」「听力判断题」「单词拼写题」等已有的细分题型。</p>
    <p><b>听力匹配 / 数学连线</b>：小节标题写「听力匹配题」或「连线题」，每道题的左侧项目各占一行并以「匹配项：」开头；右侧选项按 A.、B. 顺序逐行填写，答案按左侧顺序写字母或序号（如 B,A 或 2,1），缺答案可留空。听力题导入后请在待审核编辑页添加音频。</p>
    <pre>听力匹配题\n1. 听录音，将人物与地点匹配\n匹配项：甲\n匹配项：乙\nA. 学校\nB. 图书馆\n答案：B,A</pre>
    <p><b>数学作图</b>：标题写「作图题」，题干按原有题号规则填写；参考答案和解析可留空。学生在系统内画布作答，由老师人工评分。</p>
  </div>`;

// These hints reflect server review flags, never create a local "confirmed" state.
// The existing commit dialog/API remains the authority for all validations.
function pdReviewBlocker(it) {
  if (it.content_review_pending || it.type_unconfirmed) return '请先对照原页核对内容';
  if ((it.figure_missing || []).length || (it.image_errors || []).length) return '请先补齐题目图片';
  if (it.figure_review_required && it.figure_review_issue) return '请先确认图文归属';
  if (it.ai_legacy_pending || (it.ai_review_pending_fields || []).length) return '请先核对 AI 内容';
  return '';
}
function pdClassificationChanged(it, patch) {
  return ['subject', 'stage', 'grade', 'point'].some((key) => String(it[key] || '').trim() !== String(patch[key] || '').trim());
}
// Imported or legacy classifications can be outside the current choices. Keep
// their exact persisted value selected instead of turning an untouched form dirty.
function pdClassOpts(list, current) {
  const value = current == null ? '' : String(current);
  const choices = value && !list.some((entry) => String(Array.isArray(entry) ? entry[0] : entry) === value) ? [...list, [value, value]] : list;
  return pdOpts(choices, value, '未识别');
}
function pdClassificationHTML(it) {
  const chapter = (ADM.chapters || []).find((c) => String(c.id) === String(it.chapter_id));
  return `<aside class="pd-classification" aria-label="分类与核对">
    <h3>${ic('book')} 分类与核对</h3>
    <div class="pd-class-fields">
      <label for="pd-class-sub">学科</label><select id="pd-class-sub" class="input" data-class-field="subject">${pdClassOpts(PD_SUBJECTS, it.subject)}</select>
      <label for="pd-class-stage">学段</label><select id="pd-class-stage" class="input" data-class-field="stage">${pdClassOpts(PD_STAGES.slice(1), it.stage)}</select>
      <label for="pd-class-grade">年级</label><select id="pd-class-grade" class="input" data-class-field="grade">${pdClassOpts(PD_GRADES, it.grade)}</select>
      <span>教材</span><span class="pd-class-value">${esc(it.edition || '未记录')}</span>
    </div>
    <div class="pd-class-fields pd-class-detail">
      <span>章节</span><span class="pd-class-value">${esc(chapter ? chapter.name : '未关联章节')}</span>
      <label for="pd-class-point">知识点</label><input id="pd-class-point" class="input" data-class-field="point" value="${esc(it.point || '')}" placeholder="填写知识点">
    </div>
    ${it.ai_point_suggestion ? `<div class="pd-class-notice"><strong>${ic('help')} AI 分类建议 · 待老师核对</strong><p>${esc(it.ai_point_suggestion)}</p><small>建议不等于已确认分类，请核对后填写。</small></div>` : `<p class="pd-class-help">分类修改保存到待审核题目。章节 / 知识点树节点在入库前统一核对。</p>`}
    <button type="button" class="btn primary pd-class-save" data-act="save-classification">保存分类</button>
    <button type="button" class="btn ghost pd-class-discard" data-act="discard-classification" hidden>撤销修改</button>
    <p class="pd-class-help">保存不代表入库；最终归属请在「核对并入库」中确认。</p>
  </aside>`;
}

async function viewPending() {
  const st = ADM.page.pd = ADM.page.pd || { source: 'all', kw: '', sel: {} };
  st.mergePins = Array.isArray(st.mergePins) ? st.mergePins : [];
  if (window.__pdReviewKey) { document.removeEventListener('keydown', window.__pdReviewKey); window.__pdReviewKey = null; }
  if (st.mode === 'batches' && !st.batch_id) return viewPendingBatches(st);
  const page = Math.max(1, Number(ADM.page.pdPage) || 1);
  const size = Number(ADM.page.pdPageSize) || 20;
  const qs = `source=${encodeURIComponent(st.source)}&review_status=${encodeURIComponent(st.review || 'all')}&page=${page}&size=${size}${st.kw ? '&kw=' + encodeURIComponent(st.kw) : ''}${st.batch_id ? '&batch_id=' + encodeURIComponent(st.batch_id) : ''}`;
  const data = await api(`${PD_API}/ext/pending?${qs}`);
  ADM.page.pdPage = data.page;
  const list = data.list || [];
  const counts = data.counts || {};
  const reviewCounts = data.status_counts || {};
  const byId = {};
  list.forEach((it) => { byId[it.id] = it; });
  if (!byId[st.active]) st.active = list[0] ? list[0].id : '';
  Object.keys(st.sel).forEach((id) => { if (!byId[id]) delete st.sel[id]; });   // 不在当前页的选择自动取消（换页/过滤/处理后）
  const selIds = () => Object.keys(st.sel).filter((id) => st.sel[id]);

  const itemHTML = (it) => {
    const preview = pdStemImages(it);
    const sourcePages = [...new Set((Array.isArray(it.source_pages) && it.source_pages.length ? it.source_pages : [it.original_page]).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= Number(it.original_pages || n)))];
    const miss = [];
    if (!String(it.stem || '').trim()) miss.push('题干缺失，待补录');
    if (!it.subject) miss.push('未识别学科');
    if (!it.answer) miss.push('缺答案');
    if (!it.analysis) miss.push('缺解析');
    if (!it.stage || !it.point) miss.push('缺分类');
    if (it.type_unconfirmed) miss.push('题型待老师确认');
    if ((it.image_errors || []).length || (it.figure_missing || []).length) miss.push('待补图');
    if (it.figure_review_required && it.figure_review_issue && !(it.figure_missing || []).length) miss.push('图文归属待核对');
    return `<div class="pd-item" data-id="${esc(it.id)}">
      <label class="pd-chk"><input type="checkbox" data-sel="${esc(it.id)}" ${st.sel[it.id] ? 'checked' : ''}></label>
      <div class="pd-main">
        <header class="pd-preview-heading"><h3>题目预览 <small>${it.qno ? '原题号 ' + esc(it.qno) : esc(it.type_name)}</small></h3><div><span class="pd-preview-source">${esc(it.source_label)}${it.original_page ? ' · 第 ' + Number(it.original_page) + ' 页' : ''}</span>${sourcePages.length ? `<button type="button" class="link-btn" data-act="original" data-page="${sourcePages[0]}">查看原页 ${ic('link')}</button>` : ''}</div></header>
        <div class="pd-question-body">
        <details class="pd-provenance"><summary>来源、标签与审核详情</summary><div class="pd-meta">
          <span class="pd-tag pd-src-${esc(it.source)}">${esc(it.source_label)}</span>
          <span class="pd-type">${it.type_unconfirmed ? `暂按${esc(it.type_name)}` : esc(it.type_name)}</span>
          ${it.qno ? `<span class="pd-cls">原题号 ${esc(it.qno)}</span>` : ''}
          ${it.group_ref ? `<span class="pd-cls">组合题 · 小题 ${Number(it.group_position) || ''}</span>` : ''}
          ${it.subject ? `<span class="pd-cls">${esc(it.subject)}${it.stage ? ' · ' + esc(pdStageName(it.stage)) : ''}${it.grade ? ' · ' + esc(it.grade) : ''}</span>` : ''}
          ${it.difficulty_score_10 != null ? `<span class="pd-cls">难度 ${Number(it.difficulty_score_10)} / 10</span>` : it.difficulty ? `<span class="pd-cls">难度 ${it.difficulty} / 5 星</span>` : ''}
          ${it.point ? `<span class="pd-cls" title="知识点">${esc(it.point)}</span>` : ''}
          ${it.ai_recognized ? '<span class="pd-cls">AI 已识别，请核对</span>' : ''}
          ${it.content_review_required ? `<span class="${it.content_review_pending ? 'pd-warn' : 'pd-cls'}">${it.content_review_pending ? '识别内容待核对' : '识别内容已核对'}</span>` : ''}
          ${it.ai_answer_review && it.ai_answer_review.fields && Object.keys(it.ai_answer_review.fields).length ? '<span class="pd-cls">AI 建议已由老师确认</span>' : ''}
          ${it.ai_point_suggestion ? `<span class="pd-warn">AI 建议知识点：${esc(it.ai_point_suggestion)}（未确认）</span>` : ''}
          ${(it.tags || []).slice(0, 4).map((t) => `<span class="pd-cls">#${esc(t)}</span>`).join('')}
          ${miss.map((m) => `<span class="pd-warn">${esc(m)}</span>`).join('')}
          <span class="pd-batch" title="来自哪个批次">${esc(it.batch_title || '')}</span>
        </div></details>
        ${it.material ? `<div class="pd-mat">${preview.material}</div>` : ''}
        ${it.upload_note ? `<div class="pd-upload-note"><b>上传备注：</b>${pdBr(it.upload_note)}</div>` : ''}

        ${(it.image_errors || []).map((e) => `<div class="pd-upload-note"><b>图${Number(e.index) + 1} 转存失败：</b>${esc(e.message)}。请从原网页保存图片后补传。 <label class="btn ghost sm">选择图片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-replace-image="${Number(e.index)}" style="display:none"></label></div>`).join('')}
        ${(it.figure_missing || []).filter((n) => n > 0 && n <= 30).map((n) => `<div class="pd-upload-note"><b>图${Number(n)} 尚未补充。</b> 可从原页框选，或上传对应图像。 <label class="btn ghost sm">上传图${Number(n)}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-supply-figure="${Number(n) - 1}" style="display:none"></label></div>`).join('')}
        ${(it.figure_missing || []).includes('未编号') ? '<div class="pd-upload-note"><b>题目含图片或表格占位标记。</b>请点击编辑，将 [图]、[图N]、[表1] 等改为对应的 [图1]、[图2] 等唯一图号，再从原页裁取并补充实际图片或表格。</div>' : ''}
        <div class="pd-stem">${preview.html || '<span class="pd-warn">题干缺失，待补录。请对照原页补录后再入库。</span>'}</div>
        ${preview.prompts.length ? `<div><b>匹配项目</b><ol>${preview.prompts.map((v) => `<li>${v}</li>`).join('')}</ol></div>` : ''}
        ${(it.options || []).length ? `<ol class="pd-opts">${it.options.map((o, i) => `<li><b>${esc(optLabel(o, i))}.</b> ${preview.options[i]}</li>`).join('')}</ol>` : ''}
        ${preview.rest ? `<div class="pd-imgs">${preview.rest}</div>` : ''}
        <div class="pd-ans"><div class="pd-answer-line"><b>参考答案</b><span>${it.answer ? pdBr(it.answer) : '<span class="pd-warn">未填</span>'}</span></div>${it.analysis ? `<div class="pd-ana"><b>解析</b><div>${preview.analysis}</div></div>` : ''}</div>
        ${it.content_review_required ? `<div class="pd-upload-note pd-content-review"><b>${it.content_review_pending ? '请对照原页核对题型、题干、选项、公式、共同材料和小问' : '老师已核对当前题目内容'}</b>${it.content_review_pending ? '<p>AI 识别内容可能包含推断、漏字或串题，请以原页为准。</p>' : ''}${it.cross_page_review_required ? '<p>此题涉及跨页内容，请逐页核对并补全关联。</p>' : ''}${(it.recognition_notes || []).map((note) => `<p>AI 提示（可能包含推断，请对照原页核对）：${esc(note)}</p>`).join('')}</div>` : ''}
        ${it.ai_legacy_pending ? `<div class="pd-upload-note"><b>历史 AI 补全内容待核对：</b>来源无法确定，请对照原文逐项确认。 ${(it.ai_legacy_pending_fields || []).includes('answer') ? '<button type="button" class="btn ghost sm" data-act="legacy-answer">确认答案</button>' : ''} ${(it.ai_legacy_pending_fields || []).includes('analysis') ? '<button type="button" class="btn ghost sm" data-act="legacy-analysis">确认解析</button>' : ''} ${(it.ai_legacy_pending_fields || []).includes('classification') ? '<button type="button" class="btn ghost sm" data-act="legacy-classification">确认分类</button>' : ''}</div>` : ''}
        ${(it.ai_review_pending_fields || []).length ? `<div class="pd-upload-note"><b>题目内容已变化：</b>已采纳的 AI 内容须对照当前题目逐项重新核对。 ${(it.ai_review_pending_fields || []).includes('answer') ? '<button type="button" class="btn ghost sm" data-act="recheck-answer">重新确认答案</button>' : ''} ${(it.ai_review_pending_fields || []).includes('analysis') ? '<button type="button" class="btn ghost sm" data-act="recheck-analysis">重新确认解析</button>' : ''}</div>` : ''}
        ${pdAiReviewReport(it)}
        ${it.ai_answer_suggestion ? `<div class="pd-upload-note"><b>${it.ai_answer_suggestion.source === 'recognition' ? 'AI 转写内容（请对照原文核对，未经确认不会入库）' : 'AI 建议（未经确认，不会入库）'}</b>${it.ai_answer_suggestion.source !== 'recognition' ? '<p class="pd-warn">建议仅依据题目文字生成，未读取题图；答案和解析可能不一致，请分别核对。</p>' : ''}${it.ai_answer_suggestion.stale ? '<p class="pd-warn">题目已修改，请重新生成建议。</p>' : ''}${it.ai_answer_suggestion.answer ? `<div><b>答案建议：</b>${pdBr(it.ai_answer_suggestion.answer)} ${!it.ai_answer_suggestion.stale && it.ai_answer_suggestion.source !== 'review' && !it.answer ? '<button type="button" class="btn ghost sm" data-act="ai-answer">采纳答案</button>' : ''}</div>` : ''}${it.ai_answer_suggestion.analysis ? `<div><b>解析建议：</b>${pdBr(it.ai_answer_suggestion.analysis)} ${!it.ai_answer_suggestion.stale && it.ai_answer_suggestion.source !== 'review' && !it.analysis ? '<button type="button" class="btn ghost sm" data-act="ai-analysis">采纳解析</button>' : ''}</div>` : ''}<button type="button" class="btn ghost sm" data-act="bulk-edit">编辑并核对建议</button> <button type="button" class="btn ghost sm" data-act="discard-ai">舍弃未采纳建议</button></div>` : ''}
        ${(it.ai_answer_discard_history || []).length ? `<details class="pd-upload-note"><summary>查看已舍弃 AI 内容（${it.ai_answer_discard_history.length}）</summary>${it.ai_answer_discard_history.map((h) => `<div><b>操作人：</b>${esc(String(h.discarded_by || ''))} <b>时间：</b>${esc(h.discarded_at || '')}${h.answer ? `<p><b>答案：</b>${pdBr(h.answer)}</p>` : ''}${h.analysis ? `<p><b>解析：</b>${pdBr(h.analysis)}</p>` : ''}</div>`).join('')}</details>` : ''}
      <details class="pd-item-tools"><summary>原页、图片与更多操作</summary><div class="pd-acts">
        ${sourcePages.map((page) => `<button type="button" class="btn sm ghost" data-act="original" data-page="${page}">查看原页 · 第 ${page} 页</button>`).join('')}
        ${it.original_page ? `<button type="button" class="btn sm ghost" data-act="crop-figure">从原页补图</button>` : ''}
        ${it.figure_review_required && it.figure_review_issue ? `<button type="button" class="btn sm ghost" data-act="confirm-figure">确认图文归属</button>` : ''}
        ${it.kind === 'run' ? `<button type="button" class="btn sm ghost" data-act="merge-pin">${st.mergePins.some(p => p.id === it.id) ? '取消暂存片段' : '暂存为合并片段'}</button>` : ''}
        <button type="button" class="btn sm ghost danger" data-act="del">删除</button>
      </div></details>
      </div>
        <div class="pd-edit-row">${it.content_review_required ? `<div class="pd-content-action">${it.content_review_pending ? '<button type="button" class="btn ghost" data-act="content-review">确认已对照原页</button>' : `<span>${ic('check')} 老师已核对当前题目内容</span>`}</div>` : ''}<button type="button" class="btn ghost" data-act="review-ai">AI 审核</button><button type="button" class="btn ghost" data-act="edit">${ic('edit')} 编辑题目</button></div>
      </div>
      ${pdClassificationHTML(it)}
    </div>`;
  };

  const html = `
  <section class="pd-workspace">
    <header class="pd-workspace-heading"><div><h2>待审核题目</h2><p>先核对，再入库，让每道题都有清晰来源</p></div>
      <ol class="pd-workflow" aria-label="录题进度"><li class="done"><span>${ic('check')}</span>上传资料</li><li class="current" aria-current="step"><span>2</span>逐题核对</li><li><span>3</span>确认入库</li></ol>
    </header>
    <div class="pd-filter-area">
      <div class="pd-filter-row">
        <button type="button" class="btn ghost pd-batch-picker" id="pd-batches">${esc(st.batch_id && list[0] ? list[0].batch_title || '所选批次' : '全部批次')} · ${Number(data.total) || 0} 题 ${ic('folder')}</button>
        <label class="pd-source-label"><span class="sr-only">题目来源</span><select id="pd-source" class="input">${PD_SRC.map(([k,t])=>`<option value="${k}" ${st.source === k ? 'selected' : ''}>${esc(t)} · ${Number(counts[k]) || 0}</option>`).join('')}</select></label>
        <div class="pd-tabs pd-review-tabs" aria-label="按题目完整度筛选">${PD_REVIEW.map(([k,t])=>`<button type="button" class="pd-tab ${(!st.review ? 'all' : st.review) === k ? 'on' : ''}" data-review="${k}" aria-pressed="${(!st.review ? 'all' : st.review) === k}">${esc(k === 'all' ? '全部' : t)}<em>${Number(reviewCounts[k]) || 0}</em></button>`).join('')}</div>
      </div>
      <details class="pd-advanced"><summary><span class="pd-tools-icon">${ic('setting')}</span><span class="pd-tools-copy"><strong>搜索、导入与批量操作</strong><small>查找题目、导入文件或处理所选题目</small></span><span id="pd-tool-selection"></span><span class="pd-tools-action"><span class="pd-tools-open">展开工具</span><span class="pd-tools-close">收起工具</span><span class="pd-tools-chevron" aria-hidden="true"></span></span></summary>
      <p class="pd-tip">各种方式录入的题目均先进入待审核；核对、修改后再入库。</p>
      <div class="pd-bar">
        <button type="button" class="btn sm" id="pd-excel">${ic('upload')} 导入 Excel</button>
        <button type="button" class="btn sm" id="pd-word">${ic('upload')} 导入 Word</button>
        <input class="input pd-kw" id="pd-kw" aria-label="搜索待审核题目" placeholder="搜索题干 / 批次 / 知识点" value="${esc(st.kw)}">
      </div>
    <div class="pd-batchbar">
      <label><input type="checkbox" id="pd-all"> 全选本页</label>
      <span class="pd-selcnt" id="pd-selcnt">已选 0 题</span>
      <button type="button" class="btn sm" id="pd-breview">AI 审核所选</button>
      <button type="button" class="btn sm ghost" id="pd-bedit">批量编辑</button>
      <button type="button" class="btn sm primary" id="pd-bcommit">批量入库</button>
      <button type="button" class="btn sm ghost" id="pd-bmerge">合并两段跨页题</button>
      ${st.mergePins.length ? `<span class="pd-selcnt">已暂存 ${st.mergePins.length}/2 段（可翻页）</span><button type="button" class="btn sm ghost" id="pd-merge-clear">清空片段</button>` : ''}
      <button type="button" class="btn sm ghost" id="pd-bclassify">AI 分类建议</button>
      <button type="button" class="btn sm ghost" id="pd-bai" title="为缺失的答案或解析生成待老师确认的建议">AI 生成答案/解析建议</button>
      <button type="button" class="btn sm ghost danger" id="pd-bdel">批量删除</button>
    </div>
    ${st.batch_id ? `<p class="pd-tip">正在查看所选批次 <button type="button" class="btn ghost xs" id="pd-clear-batch">查看全部批次</button></p>` : ''}
      </details>
    </div>
    <div class="pd-list r4-review-layout" id="pd-list">${list.length ? `<aside class="r4-review-list" aria-label="待审核题目列表"><div class="pd-list-heading"><h3>${ic('book')} ${st.batch_id ? '本批题目' : '待审队列'}</h3><span>${data.total} 题</span></div><div class="pd-list-rows">${list.map((it, i) => `<div class="r4-review-row ${it.id === st.active ? 'on' : ''}" data-review-row="${esc(it.id)}"><label><input type="checkbox" data-sel="${esc(it.id)}" ${st.sel[it.id] ? 'checked' : ''} aria-label="选择第 ${i + 1} 题"></label><button type="button" data-select-item="${esc(it.id)}"><span class="pd-row-number">${String((data.page-1)*data.size+i+1).padStart(2,'0')}</span><strong>${esc((it.stem || '').slice(0, 70) || `题干缺失${it.qno ? ' · 原题号 ' + it.qno : ''}`)}</strong><span class="pd-row-source">${esc(it.source_label)}</span><small class="${!it.answer || (it.figure_missing || []).length ? 'warn' : ''}">${!it.answer ? '缺答案' : (it.figure_missing || []).length || (it.image_errors || []).length ? '待补图' : pdReviewBlocker(it) ? '待核对' : !it.subject || !it.stage || !it.point ? '缺分类' : '待入库'}</small></button></div>`).join('')}</div>${pagerHTML(data.page, data.size, data.total, 'pdPage')}</aside><div class="r4-review-preview" id="pd-preview">${itemHTML(byId[st.active])}</div>` : `<div class="empty">${st.kw ? '没有符合搜索条件的题目' : '没有待审核的题目'}<div style="margin-top:8px;color:#97a3b8">可从录题中心导入或录入题目</div></div>`}</div>
    ${list.length ? `<footer class="pd-review-footer"><div class="pd-review-navigation"><button type="button" class="btn ghost" id="pd-prev">${ic('arrow-left')} 上一题</button><span id="pd-position" aria-live="polite"></span><button type="button" class="btn ghost" id="pd-next">下一题 ${ic('arrow-right')}</button></div><div class="pd-review-commit"><span id="pd-commit-hint"></span><button type="button" class="btn primary" id="pd-current-commit">核对并入库</button></div></footer>` : ''}
  </section>`;

  return {
    html,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const paintSel = () => {
        const n = selIds().length;
        $('pd-selcnt').textContent = `已选 ${n} 题`;
        if ($('pd-tool-selection')) $('pd-tool-selection').textContent = n ? `已选 ${n} 题` : '';
        $('pd-all').checked = list.length > 0 && n === list.length;
        ['pd-breview', 'pd-bedit'].forEach((id) => { $(id).disabled = n === 0 || n > 20; $(id).title = '请选择 1 到 20 道题'; });
        pdPaintAiReviewButtons($('pd-breview').closest('.pd-workspace'));
      };
      paintSel();
      mtxTypeset($('pd-list'));
      bindPager('pdPage');
      $('pd-batches').onclick = () => { st.mode = 'batches'; st.batch_id = 0; st.sel = {}; render(); };
      let classificationSaving = false;
      const classificationPatch = () => Object.fromEntries([...document.querySelectorAll('#pd-preview [data-class-field]')].map((field) => [field.dataset.classField, field.value.trim()]));
      const canLeaveClassification = () => {
        const item = byId[st.active];
        if (classificationSaving || (item && pdClassificationChanged(item, classificationPatch()))) {
          toast(classificationSaving ? '分类正在保存，请稍候' : '分类尚未保存，请先保存或撤销修改', 'err'); return false;
        }
        return true;
      };
      // Central guard covers batch actions, filters, pagination and navigation,
      // including future callers of existing handlers. Viewing original pages is safe.
      const workspace = $('pd-list').closest('.ui-review-shell') || $('pd-list').closest('.pd-workspace');
      workspace.addEventListener('click', (event) => {
        const button = event.target.closest('button,a'); if (!button) return;
        const changesView = button.dataset.act !== 'original' && button.matches('#pd-breview,#pd-bedit,#pd-bcommit,#pd-bmerge,#pd-merge-clear,#pd-bclassify,#pd-bai,#pd-bdel,#pd-batches,#pd-clear-batch,#pd-excel,#pd-word,[data-page],[data-src],[data-review],.nav [data-go],#btnOut');
        const changesItem = button.dataset.act && !['save-classification', 'discard-classification', 'original'].includes(button.dataset.act);
        const selectsOther = button.dataset.selectItem && button.dataset.selectItem !== st.active;
        if ((changesView || changesItem || selectsOther) && !canLeaveClassification()) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      workspace.addEventListener('change', (event) => {
        const field = event.target;
        if (!field.matches('#pd-source,[data-psize="pdPage"],[data-replace-image],[data-supply-figure]') || canLeaveClassification()) return;
        field.value = field.id === 'pd-source' ? st.source : field.hasAttribute('data-psize') ? String(data.size) : '';
        event.preventDefault(); event.stopImmediatePropagation();
      }, true);
      const updateCommitState = () => {
        const item = byId[st.active]; if (!item || !$('pd-current-commit')) return;
        const dirty = pdClassificationChanged(item, classificationPatch());
        const blocker = dirty ? '分类已修改，请先保存' : pdReviewBlocker(item);
        $('pd-current-commit').disabled = !!blocker || classificationSaving;
        const discard = document.querySelector('#pd-preview [data-act="discard-classification"]'); if (discard) discard.hidden = !dirty;
        $('pd-commit-hint').textContent = blocker || '入库前将再次核对分类';
      };
      const selectItem = (id, scroll) => {
        if (!byId[id] || (id !== st.active && !canLeaveClassification())) return;
        st.active = id;
        const preview = $('pd-preview'); preview.innerHTML = itemHTML(byId[id]);
        pdPaintAiReviewButtons($('pd-breview').closest('.pd-workspace'));
        updateCommitState();
        document.querySelectorAll('[data-review-row]').forEach((row) => { const active = row.dataset.reviewRow === id; row.classList.toggle('on', active); const b = row.querySelector('[data-select-item]'); if (b) b.setAttribute('aria-current', active ? 'true' : 'false'); });
        const index = list.findIndex((item) => item.id === id);
        if ($('pd-position')) $('pd-position').textContent = `${index + 1} / ${list.length}`;
        if ($('pd-prev')) $('pd-prev').disabled = index <= 0;
        if ($('pd-next')) $('pd-next').disabled = index >= list.length - 1;
        if (scroll) { const row = [...document.querySelectorAll('[data-review-row]')].find((r) => r.dataset.reviewRow === id); if (row) row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        mtxTypeset(preview);
      };
      const move = (delta) => { const index = list.findIndex((item) => item.id === st.active), next = index + delta; if (next < 0 || next >= list.length) return false; selectItem(list[next].id, true); return true; };
      if (list.length) {
        selectItem(st.active, false);
        $('pd-prev').onclick = () => move(-1); $('pd-next').onclick = () => move(1);
        $('pd-current-commit').onclick = () => { const item = byId[st.active]; if (!item || classificationSaving || pdReviewBlocker(item) || pdClassificationChanged(item, classificationPatch())) return; pdBatchCommit([item.id], byId); };
        const listElement = $('pd-list');
        window.__pdReviewKey = (event) => {
          if (!document.body.contains(listElement) || document.querySelector('.mask') || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
          const target = event.target;
          if (target && (target.isContentEditable || target.closest && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))) return;
          const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
          if (delta && move(delta)) event.preventDefault();
        };
        document.addEventListener('keydown', window.__pdReviewKey);
      }
      $('pd-source').onchange = (e) => { st.source = e.target.value; st.batch_id = 0; st.sel = {}; st.active = ''; st.mergePins = []; ADM.page.pdPage = 1; render(); };
      document.querySelectorAll('[data-src]').forEach((a) => a.onclick = () => { st.source = a.dataset.src; st.batch_id = 0; st.sel = {}; ADM.page.pdPage = 1; render(); });
      if ($('pd-clear-batch')) $('pd-clear-batch').onclick = () => { st.batch_id = 0; st.sel = {}; ADM.page.pdPage = 1; render(); };
      document.querySelectorAll('[data-review]').forEach((b) => b.onclick = () => { st.review = b.dataset.review; st.sel = {}; st.active = ''; ADM.page.pdPage = 1; render(); });
      let kwTimer = 0;
      $('pd-kw').oninput = (e) => { clearTimeout(kwTimer); if (!canLeaveClassification()) { e.target.value = st.kw || ''; return; } kwTimer = setTimeout(() => { if (!canLeaveClassification()) { e.target.value = st.kw || ''; return; } st.kw = e.target.value.trim(); st.sel = {}; st.active = ''; ADM.page.pdPage = 1; render(); }, 500); };
      $('pd-all').onchange = (e) => { list.forEach((it) => { st.sel[it.id] = e.target.checked; }); document.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; }); paintSel(); };
      $('pd-list').oninput = (e) => { if (e.target.matches('[data-class-field]')) updateCommitState(); };
      $('pd-list').onchange = async (e) => {
        if (e.target.matches('[data-class-field]')) { updateCommitState(); return; }
        const c = e.target.closest('[data-sel]'); if (c) { st.sel[c.dataset.sel] = c.checked; paintSel(); return; }
        const input = e.target.closest('[data-replace-image], [data-supply-figure]');
        if (!input || !input.files[0]) return;
        if (input.files[0].size > 5 * 1024 * 1024) { toast('图片不能超过 5 MB', 'err'); input.value = ''; return; }
        const item = byId[input.closest('.pd-item').dataset.id]; if (!item) return;
        input.disabled = true;
        try {
          const supplied = input.hasAttribute('data-supply-figure');
          const fd = new FormData(); fd.append('id', item.id); fd.append('index', supplied ? input.dataset.supplyFigure : input.dataset.replaceImage); fd.append('file', input.files[0]);
          const r = await fetch(`${PD_API}/ext/pending/${supplied ? 'figure' : 'image'}`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json(); if (j.code !== 0) throw new Error(j.msg || '上传失败');
          toast('图片已补充', 'ok'); render();
        } catch (err) { toast(err.message || '上传失败', 'err'); input.disabled = false; input.value = ''; }
      };

      // 单题操作
      $('pd-list').onclick = async (e) => {
        const pick = e.target.closest('[data-select-item]');
        if (pick) {
          if (pick.dataset.selectItem === st.active) return;
          selectItem(pick.dataset.selectItem, false);
          return;
        }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const it = byId[b.closest('.pd-item').dataset.id];
        if (!it) return;
        if (b.dataset.act === 'discard-classification') {
          if (classificationSaving) return;
          document.querySelectorAll('#pd-preview [data-class-field]').forEach((field) => { field.value = it[field.dataset.classField] || ''; });
          updateCommitState(); return;
        }
        if (b.dataset.act === 'save-classification') {
          if (b.disabled) return;
          const card = b.closest('.pd-item');
          const patch = Object.fromEntries([...card.querySelectorAll('[data-class-field]')].map((field) => [field.dataset.classField, field.value.trim()]));
          if (!patch.subject || !patch.stage) return toast('请先选择学科和学段', 'err');
          const expected = Object.fromEntries(['stem', 'type', 'question_subtype', 'subject', 'stage', 'difficulty', 'difficulty_score_10'].map((key) => [key, it[key] == null ? '' : it[key]]));
          classificationSaving = true;
          const fields = [...card.querySelectorAll('[data-class-field], [data-act="discard-classification"]')]; fields.forEach((field) => { field.disabled = true; });
          b.disabled = true; b.textContent = '保存中…'; updateCommitState();
          try {
            await api(`${PD_API}/ext/pending/item`, { method: 'PUT', body: { id: it.id, patch, expected } });
            toast('分类已保存，题目仍在待审核', 'ok'); render();
          } catch (err) { classificationSaving = false; fields.forEach((field) => { field.disabled = false; }); b.disabled = false; b.textContent = '保存分类'; updateCommitState(); }
          return;
        }
        if (b.dataset.act === 'merge-pin') {
          const pos = st.mergePins.findIndex(p => p.id === it.id);
          if (pos >= 0) st.mergePins.splice(pos, 1);
          else {
            if (st.mergePins.length >= 2) return toast('已暂存两段，请先合并或清空', 'err');
            if (st.mergePins.length && st.mergePins[0].batch_id !== it.batch_id) return toast('只能暂存同一批次的片段', 'err');
            st.mergePins.push({id:it.id, kind:it.kind, batch_id:it.batch_id, index:it.index, stem:it.stem, content_review_signature:it.content_review_signature});
          }
          render(); return;
        }
        if (b.dataset.act === 'review-ai') return pdAiReview([it.id], byId);
        if (b.dataset.act === 'bulk-edit') return pdBulkEdit([it.id], byId);
        if (b.dataset.act === 'edit') return pdEdit(it);
        if (b.dataset.act === 'discard-ai') {
          if (!it.ai_answer_suggestion) return toast('建议已变化，请刷新后重试', 'err');
          if (!(await elConfirm({ title: '舍弃未采纳的 AI 内容', message: '舍弃只移除当前未采纳的建议，不会修改已填写的正式答案或解析；建议原文、操作者和时间会保留以供追溯。', okText: '确认舍弃' }))) return;
          const common = { token: it.ai_answer_suggestion.token, expected: it.ai_discard_signature };
          const body = it.kind === 'run' ? { ...common, index: it.index } : { ...common, id: it.id };
          const url = it.kind === 'run' ? `${PD_API}/intake/runs/${it.batch_id}/aifill/discard` : `${PD_API}/ext/pending/ai-answer/discard`;
          try { await api(url, { method: 'POST', body }); toast('建议已舍弃，记录已保留', 'ok'); render(); } catch (err) { /* api 已提示 */ }
          return;
        }
        if (b.dataset.act === 'content-review') {
          if (!(await elConfirm({ title: '确认识别内容', message: '请先对照所有相关原页，核对并修正题型、题干、选项、公式、材料及小问。确认仅适用于当前题目内容；AI 答案和解析仍须分别确认。', okText: '已对照原页并核对' }))) return;
          try { await api(`${PD_API}/ext/pending/content/confirm`, { method: 'POST', body: { id: it.id, expected: it.content_review_signature } }); toast('题目内容已核对', 'ok'); render(); } catch (err) { /* api 已提示 */ }
          return;
        }
        if (b.dataset.act === 'crop-figure') return pdCropFigure(it);
        if (b.dataset.act === 'confirm-figure') {
          if ((it.figure_missing || []).length || (it.image_errors || []).length) return toast('请先补齐占位符对应的题图', 'err');
          if (!(await elConfirm({ title: '确认图文归属', message: '请对照原页检查题干、选项和各小问的图片是否完整、位置是否正确；没有图时也请确认原题确实无图。', okText: '已核对并确认' }))) return;
          try { await api(`${PD_API}/ext/pending/figure/confirm`, { method: 'POST', body: { id: it.id, expected: it.figure_review_signature } }); toast('图文归属已确认', 'ok'); render(); } catch (err) { /* api 已提示 */ }
          return;
        }
        if (['legacy-answer', 'legacy-analysis', 'legacy-classification', 'ai-answer', 'ai-analysis', 'recheck-answer', 'recheck-analysis'].includes(b.dataset.act)) {
          const legacy = b.dataset.act.startsWith('legacy-');
          const recheck = b.dataset.act.startsWith('recheck-');
          const fields = [b.dataset.act.endsWith('-answer') ? 'answer' : b.dataset.act.endsWith('-classification') ? 'classification' : 'analysis'];
          if (legacy && !(await elConfirm({ title: `确认历史${fields[0] === 'answer' ? '答案' : fields[0] === 'classification' ? '分类' : '解析'}`, message: '历史内容来源不确定，请对照原文核对当前内容。如需修改，请先点编辑。', okText: '已核对并确认' }))) return;
          if (recheck && !(await elConfirm({ title: `重新确认${fields[0] === 'answer' ? '答案' : '解析'}`, message: '题目或图片已变化，请核对当前内容仍与这道题匹配。', okText: '已核对并确认' }))) return;
          const body = legacy ? { index: it.index, legacy: true, expected: it.ai_legacy_signature, fields } : recheck ? { ...(it.kind === 'run' ? { index: it.index } : { id: it.id }), recheck: true, expected: it.ai_review_signature, fields } : it.kind === 'run' ? { index: it.index, token: it.ai_answer_suggestion.token, fields } : { id: it.id, token: it.ai_answer_suggestion.token, fields };
          const url = it.kind === 'run' ? `${PD_API}/intake/runs/${it.batch_id}/aifill/confirm` : `${PD_API}/ext/pending/ai-answer/confirm`;
          try { await api(url, { method: 'POST', body }); toast('已确认，题目仍在待审核', 'ok'); render(); } catch (err) { /* api 已提示 */ }
          return;
        }
        if (b.dataset.act === 'commit') return pdBatchCommit([it.id], byId);   // R0-B8：单题入库也弹分类框（和批量入库同一个弹窗）
        if (b.dataset.act === 'original') {
          try {
            const original = await api(`${PD_API}/ext/pending/original?id=${encodeURIComponent(it.id)}&page=${encodeURIComponent(b.dataset.page || it.original_page)}`, { silent: true });
            const img = pdImage(withTicket(original.url), `原始第 ${original.page} 页`);
            if (!img) return toast('原页地址无效，请检查批次', 'err');
            modal({ title: `原页对照 · 第 ${original.page} / ${original.total} 页`, wide: true, body: `<div class="r4-original-page">${img}<p class="hint">点击图片可在新窗口放大。</p></div>`, onMount: (w) => { const image = w.querySelector('.r4-original-page img'); if (image) image.onerror = () => { image.alt = '原页加载失败，请返回批次检查图片'; }; } });
          } catch (err) { toast(err.message || '原页加载失败', 'err'); }
          return;
        }
        if (b.dataset.act === 'del') {
          const ok = await elConfirm({ title: '删除这道题', danger: true, okText: '删除', message: it.source === 'scan' ? '这是学生扫码上传的题，删除会同时从该学生的错题本里删掉这道题。确定删除吗？' : '删除后不能恢复。确定删除这道题吗？' });
          if (ok) pdDelete([it.id]);
        }
      };

      // 批量操作
      $('pd-bcommit').onclick = () => { const ids = selIds(); if (!ids.length) return toast('请先勾选要入库的题目', 'err'); pdBatchCommit(ids, byId); };
      if ($('pd-merge-clear')) $('pd-merge-clear').onclick = () => { st.mergePins = []; render(); };
      $('pd-bmerge').onclick = async () => {
        const ids = selIds();
        const pair = st.mergePins.length ? st.mergePins.slice() : ids.map((id) => byId[id]);
        if (pair.length !== 2) return toast('请暂存两段片段，或勾选本页两题', 'err');
        if (pair.some((it) => !it || it.kind !== 'run') || pair[0].batch_id !== pair[1].batch_id) return toast('只能合并同一录题批次的两段题目', 'err');
        pair.sort((a, b) => a.index - b.index);
        const earlier = (pair[0].stem || '').replace(/\s+/g, ' ').slice(0, 60), later = (pair[1].stem || '').replace(/\s+/g, ' ').slice(0, 60);
        if (!(await elConfirm({ title: '合并两段跨页题', message: `将按原顺序合并：\n第一段：${earlier}\n第二段：${later}\n合并会保留两页原文与图号，合并后必须重新核对题型、内容和图片。已有答案、解析或互相冲突的字段会被拒绝。`, okText: '确认合并' }))) return;
        try { await api(`${PD_API}/ext/pending/merge`, { method: 'POST', body: { target_id: pair[0].id, fragment_id: pair[1].id, target_expected: pair[0].content_review_signature, fragment_expected: pair[1].content_review_signature } }); st.sel = {}; st.mergePins = []; st.active = ''; toast('片段已合并，请重新核对', 'ok'); render(); } catch (err) { /* api 已提示 */ }
      };
      $('pd-bdel').onclick = async () => {
        const ids = selIds(); if (!ids.length) return toast('请先勾选要删除的题目', 'err');
        const hasScan = ids.some((id) => (byId[id] || {}).source === 'scan');
        const ok = await elConfirm({ title: '批量删除', danger: true, okText: '删除', message: `确定删除选中的 ${ids.length} 道题？${hasScan ? '其中手机扫码的题会同时从学生错题本里删除。' : ''}删除后不能恢复。` });
        if (ok) pdDelete(ids);
      };
      $('pd-breview').onclick = () => pdAiReview(selIds(), byId);
      $('pd-bedit').onclick = () => pdBulkEdit(selIds(), byId);
      $('pd-bai').onclick = () => pdAiFill(selIds(), byId);
      $('pd-bclassify').onclick = () => pdAiClassify(selIds(), byId);
      $('pd-excel').onclick = () => pdImportDialog('excel');
      $('pd-word').onclick = () => pdImportDialog('word');
    },
  };
}

async function viewPendingBatches(st) {
  const q = new URLSearchParams({ source: st.source || 'all', kw: st.kw || '' });
  const data = await api(`${PD_API}/ext/pending/batches?${q}`);
  const rows = data.list || [];
  return {
    html: `<div class="card"><div class="card-h"><h3>${ic('doc')} 待审核批次</h3><div class="card-h-r"><button type="button" class="btn ghost sm" id="pd-questions">返回逐题核对</button></div></div>
      <p class="pd-tip">按导入来源查看批次和当前处理状态；各来源最多读取最近 300 条记录。批次中没有待核对题目时，可返回录题中心查看原始资料。</p>
      <div class="pd-bar"><label>来源 <select id="pd-batch-source" class="input">${pdOpts(PD_SRC, st.source || 'all')}</select></label><input class="input pd-kw" id="pd-batch-kw" placeholder="搜索批次 / 学科" value="${esc(st.kw || '')}"><button type="button" class="btn ghost sm" id="pd-batch-search">搜索</button></div>
      <div class="r4-batch-list">${rows.length ? rows.map((r) => `<article class="r4-batch-row"><div><strong>${esc(r.title || '未命名批次')}</strong><small>${esc(r.source_label)}${r.subject ? ' · ' + esc(r.subject) : ''}${r.stage ? ' · ' + esc(pdStageName(r.stage)) : ''} · ${esc(r.created_at || '')}</small>${r.error ? `<small class="r4-batch-error">${esc(r.error)}</small>` : ''}</div><div class="r4-batch-meta"><span>${Number(r.total) || 0} 题 · 待核对 ${Number(r.pending) || 0} 题</span><span class="r4-status ${r.status === '识别失败' ? 'error' : ''}">${esc(r.status)}</span><button type="button" class="btn ghost sm" data-pd-batch="${Number(r.id)}" data-pd-source="${esc(r.source)}">查看</button></div></article>`).join('') : '<div class="empty">没有符合条件的批次</div>'}</div>
      ${data.total > rows.length ? `<p class="pd-tip">显示最近 ${rows.length} 个批次，请按来源或关键字缩小范围。</p>` : ''}</div>`,
    after: () => {
      document.getElementById('pd-questions').onclick = () => { st.mode = 'questions'; st.batch_id = 0; st.sel = {}; ADM.page.pdPage = 1; render(); };
      document.getElementById('pd-batch-source').onchange = (e) => { st.source = e.target.value; render(); };
      const search = () => { st.kw = document.getElementById('pd-batch-kw').value.trim(); render(); };
      document.getElementById('pd-batch-search').onclick = search;
      document.getElementById('pd-batch-kw').onkeydown = (e) => { if (e.key === 'Enter') search(); };
      document.querySelectorAll('[data-pd-batch]').forEach((button) => { button.onclick = () => { st.mode = 'questions'; st.source = button.dataset.pdSource; st.batch_id = Number(button.dataset.pdBatch); st.kw = ''; st.review = 'all'; st.sel = {}; ADM.page.pdPage = 1; render(); }; });
    },
  };
}

async function pdCommit(ids, body) {
  try {
    const r = await api(`${PD_API}/ext/pending/commit`, { method: 'POST', body: Object.assign({ ids }, body || {}) });
    toast(`已入库 ${r.committed} 题${r.failed.length ? `；${r.failed.length} 题失败：${r.failed[0].msg}` : ''}`, r.failed.length ? 'err' : 'ok');
  } catch (e) { /* api() 已弹出原因 */ }
  render();
}
async function pdDelete(ids) {
  try { const r = await api(`${PD_API}/ext/pending/delete`, { method: 'POST', body: { ids } }); toast(`已删除 ${r.deleted} 题`, 'ok'); } catch (e) { /* 已提示 */ }
  render();
}

/** 入库（单题和批量共用同一个弹窗）：学科 / 学段 / 年级，并挂到知识点树 / 章节树的节点、加标签。
 *  学科、学段是必填的：题目自己已经有就沿用（单题时直接预选），没有就必须在这里选，否则不让入库（R0-B8）。 */
async function pdBatchCommit(ids, byId) {
  const items = ids.map((id) => byId[id]).filter(Boolean);
  const one = items.length === 1;
  const lack = (k) => items.some((i) => !i[k]);
  const same = (k) => { const vs = [...new Set(items.map((i) => i[k] || ''))]; return vs.length === 1 ? vs[0] : ''; };
  const lackLabel = (k) => (lack(k) ? '请选择（必填）' : '沿用各题');
  const star = (k) => (lack(k) ? ' <b style="color:#dc2626">*</b>' : '');
  const trees = await tpTrees();
  modal({
    title: one ? '入库这道题' : `批量入库（${items.length} 题）`, okText: '入库', wide: false,
    body: `<p class="pd-tip" style="margin-top:0">来源：${esc([...new Set(items.map((i) => i.source_label))].join('、'))}。${one ? '确认学科、学段、年级和归属的章节 / 知识点后入库；学科和学段必须有。' : '下面不填就沿用每道题自己的学科/学段/年级，题目自己没有学科或学段的必须在这里选。'}</p>
      <div class="pd-grid">
        <div class="field"><label>学科${one ? '' : '（统一改）'}${star('subject')}</label><select id="pdB-sub" class="input">${pdOpts(PD_SUBJECTS, same('subject'), lackLabel('subject'))}</select></div>
        <div class="field"><label>学段${star('stage')}</label><select id="pdB-stage" class="input">${pdOpts(PD_STAGES.slice(1), same('stage'), lackLabel('stage'))}</select></div>
        <div class="field"><label>年级</label><select id="pdB-grade" class="input">${pdOpts(PD_GRADES, same('grade'), '沿用各题')}</select></div>
      </div>
      <div class="field"><label>挂到知识点树节点（可选）</label>
        <select id="pdB-ktree" class="input" disabled><option value="">先选择学科和学段</option></select>
        <select id="pdB-knode" class="input" style="margin-top:6px" disabled><option value="">先选知识点树</option></select></div>
      <div class="field"><label>挂到章节树节点（可选）</label>
        <select id="pdB-ctree" class="input" disabled><option value="">先选择学科和学段</option></select>
        <select id="pdB-cnode" class="input" style="margin-top:6px" disabled><option value="">先选章节树</option></select></div>
      <p class="hint">选择分类节点时，仅显示对应学科和学段的树；不同学科或学段的题目请分批归类，或先统一修改。</p>
      <div class="field"><label>标签（可选，多个用空格或逗号隔开）</label><input id="pdB-tags" class="input" placeholder="如：期中 易错"></div>`,
    onMount: (w) => {
      let treeRequest = 0;
      const refreshTrees = () => {
        ++treeRequest;
        const subject = w.querySelector('#pdB-sub').value || same('subject');
        const stage = w.querySelector('#pdB-stage').value || same('stage');
        [['#pdB-ktree', '#pdB-knode', 'knowledge'], ['#pdB-ctree', '#pdB-cnode', 'textbook']].forEach(([treeSel, nodeSel, kind]) => {
          const treeEl = w.querySelector(treeSel), nodeEl = w.querySelector(nodeSel);
          nodeEl.disabled = true; nodeEl.innerHTML = '<option value="">先选树</option>';
          if (!subject || !stage) {
            treeEl.disabled = true; treeEl.innerHTML = '<option value="">请先统一学科和学段</option>';
            return;
          }
          const matching = trees.filter((t) => t.kind === kind && (!t.subject || t.subject === subject) && (!t.stage || t.stage === stage));
          treeEl.disabled = !matching.length;
          treeEl.innerHTML = pdOpts(matching.map((t) => [t.id, treeLabel(t)]), '', matching.length ? '不挂' : '该范围暂无分类树');
        });
      };
      const wire = (treeSel, nodeSel) => {
        let request = 0;
        w.querySelector(treeSel).onchange = async (e) => {
          const seq = ++request, scopeVersion = treeRequest;
          const nodeEl = w.querySelector(nodeSel);
          if (!e.target.value) { nodeEl.disabled = true; nodeEl.innerHTML = '<option value="">先选树</option>'; return; }
          const id = e.target.value;
          nodeEl.disabled = true; nodeEl.innerHTML = '<option value="">加载中…</option>';
          let nodes;
          try { nodes = ((await api(`${PD_API}/trees/${id}/nodes`, { silent: true })) || {}).list || []; }
          catch (err) { if (seq === request && scopeVersion === treeRequest) nodeEl.innerHTML = '<option value="">加载失败，请重新选择树</option>'; return; }
          if (seq !== request || scopeVersion !== treeRequest || e.target.value !== id) return;
          const kids = {}; nodes.forEach((n) => { (kids[n.parent_id || 0] = kids[n.parent_id || 0] || []).push(n); });
          const out = []; const walk = (pid, depth) => (kids[pid] || []).sort((a, b) => (a.sort - b.sort) || (a.id - b.id)).forEach((n) => { out.push(`<option value="${n.id}">${'　'.repeat(depth)}${esc(n.name)}</option>`); walk(n.id, depth + 1); });
          walk(0, 0);
          nodeEl.disabled = false; nodeEl.innerHTML = '<option value="">不挂</option>' + out.join('');
        };
      };
      wire('#pdB-ktree', '#pdB-knode'); wire('#pdB-ctree', '#pdB-cnode');
      w.querySelector('#pdB-sub').onchange = refreshTrees;
      w.querySelector('#pdB-stage').onchange = refreshTrees;
      refreshTrees();
    },
    onOk: async (w) => {
      const v = (id) => w.querySelector(id).value;
      if (!v('#pdB-sub') && lack('subject')) { toast('请先选择学科，没有学科的题不能入库', 'err'); return false; }
      if (!v('#pdB-stage') && lack('stage')) { toast('请先选择学段，没有学段的题不能入库', 'err'); return false; }
      if ((v('#pdB-ktree') && !v('#pdB-knode')) || (v('#pdB-ctree') && !v('#pdB-cnode'))) { toast('请选择树中的节点，或将分类树改为不挂', 'err'); return false; }
      const nodes = [v('#pdB-knode'), v('#pdB-cnode')].filter(Boolean).map(Number);
      const tags = v('#pdB-tags').split(/[\s,，、]+/).filter(Boolean);
      const r = await api(`${PD_API}/ext/pending/commit`, { method: 'POST', body: { ids, subject: v('#pdB-sub'), stage: v('#pdB-stage'), grade: v('#pdB-grade'), node_ids: nodes, tags } });
      toast(`已入库 ${r.committed} 题${r.failed.length ? `；${r.failed.length} 题失败：${r.failed[0].msg}` : ''}`, r.failed.length ? 'err' : 'ok');
      render();
    },
  });
}

/** 初审报告与正式题目分开呈现，不用 AI 结论替代老师核对。 */
function pdAiReviewReport(item) {
  const report = item.ai_answer_suggestion;
  if (!report || report.source !== 'review') return '';
  return `<div class="pd-upload-note pd-ai-review-report"><b>AI 初审报告 · 待人工核对${report.mock ? '（本地模拟）' : ''}</b>
    ${report.summary ? `<p>${pdBr(report.summary)}</p>` : ''}${(report.issues || []).length ? `<ul>${report.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>` : ''}
    <p class="pd-hint">仅依据题目文字初审，未读取题图或音频。请对照原题核对，AI 结论不代表审核通过。</p></div>`;
}
let pdAiReviewSequence = 0;
const pdAiReviewPending = new WeakMap();
function pdAiReviewSession() {
  const user = typeof Auth !== 'undefined' && Auth.user;
  return JSON.stringify([typeof Auth !== 'undefined' ? Auth.token : '', user && user.id, user && user.role]);
}
function pdPaintAiReviewButtons(root) {
  if (!root || !root.isConnected || root !== document.querySelector('.pd-workspace')) return;
  const session = pdAiReviewSession();
  const requests = [...(pdAiReviewPending.get(root) || new Map()).values()].filter((request) => request.session === session);
  const button = root.querySelector('#pd-breview'), count = Object.values((ADM.page.pd || {}).sel || {}).filter(Boolean).length;
  if (button) { button.disabled = requests.length > 0 || count === 0 || count > 20; button.textContent = requests.length ? 'AI 审核中…' : 'AI 审核所选'; }
  root.querySelectorAll('[data-act="review-ai"]').forEach((single) => {
    const id = single.closest('.pd-item').dataset.id;
    const busy = requests.some((request) => request.items.some((item) => item.id === id));
    single.disabled = busy; single.textContent = busy ? 'AI 审核中…' : 'AI 审核';
  });
}
async function pdAiReview(ids, byId) {
  if (!ids.length || ids.length > 20) return toast('请选择 1 到 20 道待审核题目', 'err');
  if (ids.some((id) => !byId[id] || !byId[id].edit_signature)) return toast('列表已变化，请刷新后重新选择', 'err');
  const button = document.getElementById('pd-breview'), root = button && button.closest('.pd-workspace');
  const route = window.location.hash, state = ADM.page.pd;
  if (!root || !root.isConnected || route.split('?')[0] !== '#/pending') return;
  const generation = () => typeof RENDER_SEQ === 'number' ? RENDER_SEQ : 0;
  const session = pdAiReviewSession;
  const scope = () => { const st = ADM.page.pd || {}; return JSON.stringify([st.source || 'all', st.review || 'all', st.kw || '', st.batch_id || 0, st.mode || 'questions', st.active || '', Number(ADM.page.pdPage) || 1, Number(ADM.page.pdPageSize) || 20]); };
  const originalGeneration = generation(), originalSession = session(), originalScope = scope();
  const items = ids.map((id) => ({ id, expected: byId[id].edit_signature }));
  const key = JSON.stringify([originalSession, items.slice().sort((a, b) => a.id.localeCompare(b.id))]);
  const requests = pdAiReviewPending.get(root) || new Map();
  // Deduplicate before changing result ownership. A repeat must not invalidate
  // its original request; different questions, snapshots and sessions may run.
  if (requests.has(key)) return;
  requests.set(key, { session: originalSession, items }); pdAiReviewPending.set(root, requests);
  const sequence = ++pdAiReviewSequence;
  let invalidated = false;
  const invalidate = () => { invalidated = true; };
  // A result belongs to this mounted page, session and request, not merely its URL.
  // Unsaved edits and other dialogs must never be replaced by a background completion.
  const ownsPage = (version, pageRoot) => sequence === pdAiReviewSequence && !invalidated
    && generation() === version && session() === originalSession && ADM.page.pd === state && scope() === originalScope
    && window.location.hash === route && pageRoot && pageRoot.isConnected && pageRoot === document.querySelector('.pd-workspace')
    && !document.querySelector('.mask');
  root.addEventListener('input', invalidate, true);
  root.addEventListener('change', invalidate, true);
  window.addEventListener('hashchange', invalidate);
  pdPaintAiReviewButtons(root);
  try {
    const result = await api(`${PD_API}/ext/pending/ai-review`, { method: 'POST', body: { items }, silent: true });
    if (!ownsPage(originalGeneration, root)) return;
    const failures = result.failed || [], rows = result.list || [];
    const refreshing = render(), refreshGeneration = generation();
    await refreshing;
    if (!ownsPage(refreshGeneration, document.querySelector('.pd-workspace'))) return;
    toast(`已初审 ${result.reviewed || 0} 题${failures.length ? `；${failures.length} 题未审核：${failures[0].msg}` : '，请核对后修改'}`, failures.length ? 'err' : 'ok');
    if (rows.length) pdBulkEdit(rows.map((item) => item.id), Object.fromEntries(rows.map((item) => [item.id, item])), failures.map((error) => error.msg));
  } catch (e) { if (ownsPage(originalGeneration, root)) toast(e.message || 'AI 审核失败，请稍后重试', 'err'); }
  finally {
    root.removeEventListener('input', invalidate, true); root.removeEventListener('change', invalidate, true);
    window.removeEventListener('hashchange', invalidate);
    requests.delete(key); if (!requests.size) pdAiReviewPending.delete(root);
    if (session() === originalSession) pdPaintAiReviewButtons(root);
  }
}

/** 每题使用自己的编辑框，只提交有变化的字段；保存与入库始终分开。 */
function pdBulkEdit(ids, byId, notices = []) {
  if (!ids.length || ids.length > 20) return toast('请选择 1 到 20 道待审核题目', 'err');
  if (new Set(ids).size !== ids.length || ids.some((id) => !byId[id] || !byId[id].edit_signature)) return toast('列表已变化，请刷新后重新选择', 'err');
  const items = ids.map((id) => byId[id]);
  const textField = (field, label, value, rows = 2) => `<div class="field"><label>${label}<textarea class="input" rows="${rows}" data-pd-field="${field}">${esc(value || '')}</textarea></label></div>`;
  return modal({
    title: `批量编辑与人工核对（${items.length} 题）`, wide: true, okText: '保存修改，保留待审核',
    body: `<p class="pd-tip">仅编辑本次选中的 ${items.length} 题。AI 建议需逐项填入，可继续手动修改；使用建议的题目请逐题勾选已核对。保存后回到待审核，核对完成再入库。</p>
      ${notices.length ? `<div class="pd-upload-note"><b>本次初审提醒</b><ul>${[...new Set(notices)].map((note) => `<li>${esc(note)}</li>`).join('')}</ul></div>` : ''}
      ${items.map((item, index) => {
        const suggestion = item.ai_answer_suggestion;
        const proposed = (field, title) => suggestion && suggestion[field] ? `<div class="pd-upload-note"><b>${title}建议：</b>${pdBr(suggestion[field])}${!suggestion.stale ? ` <button type="button" class="btn ghost sm" data-pd-suggestion="${field}">填入本题${title}，继续编辑</button>` : ''}</div>` : '';
        return `<section class="pd-bulk-card card" data-pd-bulk-index="${index}" style="padding:16px;margin-top:16px">
          <h3>${index + 1}. ${esc(item.source_label)}${item.qno ? ' · 原题号 ' + esc(item.qno) : ''}</h3>
          ${pdAiReviewReport(item)}${suggestion && suggestion.stale ? '<p class="pd-warn">AI 建议已过期，不能直接填入。可手动修改题目，或返回题卡舍弃后重新生成。</p>' : ''}
          <div class="pd-grid">
            <div class="field"><label>题型<select class="input" data-pd-field="type">${pdClassOpts(PD_TYPES, item.type)}</select></label></div>
            <div class="field"><label>学科<select class="input" data-pd-field="subject">${pdClassOpts(PD_SUBJECTS, item.subject)}</select></label></div>
            <div class="field"><label>学段<select class="input" data-pd-field="stage">${pdClassOpts(PD_STAGES.slice(1), item.stage)}</select></label></div>
            <div class="field"><label>年级<select class="input" data-pd-field="grade">${pdClassOpts(PD_GRADES, item.grade)}</select></label></div>
            <div class="field"><label>十级难度<select class="input" data-pd-field="difficulty_score_10">${pdOpts([1,2,3,4,5,6,7,8,9,10], item.difficulty_score_10, '未记录')}</select></label></div>
            <div class="field"><label>知识点<input class="input" data-pd-field="point" value="${esc(item.point || '')}"></label></div>
          </div>
          ${textField('material', '材料 / 原文', item.material)}${textField('stem', '题干', item.stem, 3)}
          ${(item.options || []).map((option, n) => `<div class="field"><label>选项 ${esc(option.label || String.fromCharCode(65 + n))}<textarea class="input" data-pd-option="${n}" rows="2">${esc(option.text)}</textarea></label></div>`).join('')}
          ${(item.images || []).length ? `<div class="pd-imgs">${item.images.map((url) => pdImage(url, '原题图片')).join('')}</div>` : ''}
          ${proposed('answer', '答案')}${textField('answer', '答案（可手动修改）', item.answer)}
          ${proposed('analysis', '解析')}${textField('analysis', '解析（可手动修改）', item.analysis, 3)}
          ${suggestion && !suggestion.stale && (suggestion.answer || suggestion.analysis) ? '<label class="pd-upload-note"><input type="checkbox" data-pd-ai-confirm> 我已逐项核对本题所用的 AI 建议及最终修改</label>' : ''}
          <p class="pd-hint">${pdReviewBlocker(item) ? esc(pdReviewBlocker(item)) + '。' : ''}来源、原题图片及审核记录保留。</p>
        </section>`;
      }).join('')}`,
    onMount: (w) => {
      mtxTypeset(w);
      w.querySelectorAll('[data-pd-bulk-index]').forEach((row) => {
        const item = items[Number(row.dataset.pdBulkIndex)];
        const clearConfirmation = () => { const check = row.querySelector('[data-pd-ai-confirm]'); if (check) check.checked = false; };
        row.addEventListener('input', (event) => { if (!event.target.matches('[data-pd-ai-confirm]')) clearConfirmation(); });
        row.addEventListener('change', (event) => { if (!event.target.matches('[data-pd-ai-confirm]')) clearConfirmation(); });
        row.querySelectorAll('[data-pd-suggestion]').forEach((button) => { button.onclick = () => {
          const field = button.dataset.pdSuggestion, input = row.querySelector(`[data-pd-field="${field}"]`);
          input.value = item.ai_answer_suggestion[field]; input.dataset.pdAiUsed = '1'; clearConfirmation(); input.focus();
        }; });
      });
    },
    onOk: async (w) => {
      const changes = [];
      for (const row of w.querySelectorAll('[data-pd-bulk-index]')) {
        const item = items[Number(row.dataset.pdBulkIndex)], patch = {}, used = [];
        for (const input of row.querySelectorAll('[data-pd-field]')) {
          const field = input.dataset.pdField;
          const value = field === 'difficulty_score_10' ? (input.value ? Number(input.value) : null) : input.value;
          const previous = field === 'difficulty_score_10' ? (item[field] == null ? null : Number(item[field])) : String(item[field] == null ? '' : item[field]);
          if (value !== previous) { patch[field] = value; if (input.dataset.pdAiUsed === '1' || ['answer', 'analysis'].includes(field) && item.ai_answer_suggestion && item.ai_answer_suggestion[field] && value === item.ai_answer_suggestion[field]) used.push(field); }
        }
        const options = [...row.querySelectorAll('[data-pd-option]')].map((input, n) => ({ ...item.options[n], text: input.value }));
        if (JSON.stringify(options) !== JSON.stringify(item.options || [])) patch.options = options;
        if (!Object.keys(patch).length) continue;
        if (Object.hasOwn(patch, 'stem') && !patch.stem.trim()) { toast(`第 ${Number(row.dataset.pdBulkIndex) + 1} 题题干不能为空`, 'err'); return false; }
        const entry = { id: item.id, expected: item.edit_signature, patch };
        if (used.length) {
          if (item.ai_answer_suggestion.stale) { toast(`第 ${Number(row.dataset.pdBulkIndex) + 1} 题的 AI 建议已过期，请重新生成后核对`, 'err'); return false; }
          if (!row.querySelector('[data-pd-ai-confirm]').checked) { toast(`请先核对第 ${Number(row.dataset.pdBulkIndex) + 1} 题所用的 AI 建议`, 'err'); return false; }
          Object.assign(entry, { ai_fields: used, ai_token: item.ai_answer_suggestion.token, ai_confirmed: true });
        }
        changes.push(entry);
      }
      if (!changes.length) { toast('没有修改题目内容', 'err'); return false; }
      const controls = [...w.querySelectorAll('[data-pd-field], [data-pd-option], [data-pd-suggestion], [data-pd-ai-confirm]')];
      controls.forEach((control) => { control.disabled = true; });
      try {
        const result = await api(`${PD_API}/ext/pending/items`, { method: 'PUT', body: { items: changes } });
        if (ADM.page.pd) ADM.page.pd.sel = {};
        toast(`已保存 ${result.saved} 题，仍在待审核`, 'ok');
        render();
      } finally { controls.forEach((control) => { control.disabled = false; }); }
    },
  });
}

/** AI 分类只提供候选，逐项勾选并确认后才用于入库。 */
async function pdAiClassify(ids, byId) {
  if (!ids.length || ids.length > 20) return toast('请选择 1 到 20 道待审核题目', 'err');
  const button = document.getElementById('pd-bclassify');
  button.disabled = true; button.textContent = '正在生成建议…';
  let result;
  try { result = await api(`${PD_API}/ext/pending/ai-classify`, { method: 'POST', body: { ids }, silent: true }); }
  catch (e) { toast(e.message || 'AI 分类建议失败', 'err'); return; }
  finally { button.disabled = false; button.textContent = 'AI 分类建议'; }
  const rows = result.list || [];
  modal({ title: '核对 AI 分类建议', wide: true, okText: '确认已选建议',
    body: `<p class="hint">${result.mock ? '当前为演示模式。' : ''}请逐项勾选确认：题型和十级难度会保存到待审核；勾选分类节点的题目会同时入库。修改题型后请核对已有答案格式。此操作不会补写答案或解析。</p>
      <div>${rows.map((row, index) => {
        const item = byId[row.id] || {};
        return `<section style="padding:12px 0;border-bottom:1px solid var(--line,#e5e7eb)"><b>${index + 1}. ${esc((item.stem || '题目已变化').slice(0, 100))}</b><div class="hint">${[item.subject, pdStageName(item.stage), item.grade, item.edition, item.term].filter(Boolean).map(esc).join(' · ')}</div>
          ${row.warning ? `<p class="pd-warn">${esc(row.warning)}</p>` : ''}${row.error ? `<p class="pd-warn">${esc(row.error)}</p>` : `
            ${row.type ? `<label style="display:block;margin-top:7px"><input type="checkbox" data-ai-row="${index}" data-ai-field="type" value="${esc(row.type)}"> 建议题型：<b>${esc((PD_TYPES.find(([code]) => code === row.type) || [row.type, row.type])[1])}</b>（当前：${esc(item.type_name || '未指定')}）</label>` : ''}
            ${row.difficulty_score_10 ? `<label style="display:block;margin-top:7px"><input type="checkbox" data-ai-row="${index}" data-ai-field="difficulty_score_10" value="${Number(row.difficulty_score_10)}"> 建议难度：<b>${Number(row.difficulty_score_10)} / 10</b>${item.difficulty_score_10 != null ? `（当前：${Number(item.difficulty_score_10)} / 10）` : item.difficulty ? `（当前：${Number(item.difficulty)} / 5 星，未记录十级值）` : ''}</label>` : ''}
            ${row.nodes.length ? row.nodes.map((node) => `<label style="display:block;margin-top:7px"><input type="checkbox" data-ai-row="${index}" data-ai-node value="${node.id}"> ${esc(node.kind === 'textbook' ? '章节' : '知识点')} · ${esc(node.edition || '通用')} · ${esc(node.tree_name)} · <b>${esc(node.path || node.name)}</b></label>`).join('') : '<p class="hint">没有把握选择分类，请手动分类。</p>'}`}</section>`;
      }).join('')}</div>`,
    onOk: async (w) => {
      const selected = [...w.querySelectorAll('[data-ai-row]:checked')];
      if (!selected.length) { toast('请勾选要确认的建议', 'err'); return false; }
      const grouped = new Map();
      selected.forEach((el) => { const i = Number(el.dataset.aiRow); if (!grouped.has(i)) grouped.set(i, { nodes: [], patch: {} }); const group = grouped.get(i); if (el.hasAttribute('data-ai-node')) group.nodes.push(Number(el.value)); else if (el.dataset.aiField === 'type') group.patch.type = el.value; else if (el.dataset.aiField === 'difficulty_score_10') group.patch.difficulty_score_10 = Number(el.value); });
      let committed = 0, saved = 0, failures = [];
      for (const [i, group] of grouped) {
        try {
          const item = byId[rows[i].id];
          if (!item) throw new Error('题目已变化，请刷新后重试');
          if (Object.keys(group.patch).length) {
            const expected = Object.fromEntries(['stem', 'type', 'question_subtype', 'subject', 'stage', 'difficulty', 'difficulty_score_10'].map((key) => [key, item[key] == null ? '' : item[key]]));
            await api(`${PD_API}/ext/pending/item`, { method: 'PUT', body: { id: rows[i].id, patch: group.patch, expected }, silent: true });
            saved++;
          }
          if (group.nodes.length) {
            const expected_scope = Object.fromEntries(['stem', 'subject', 'stage', 'grade', 'edition', 'term'].map((key) => [key, item[key] == null ? '' : item[key]]));
            const r = await api(`${PD_API}/ext/pending/commit`, { method: 'POST', body: { ids: [rows[i].id], node_ids: group.nodes, expected_scope }, silent: true });
            committed += r.committed || 0;
            if (r.failed && r.failed.length) failures.push(r.failed[0].msg);
          }
        } catch (e) { failures.push(e.message || '入库失败'); }
      }
      toast(`已保存 ${saved} 题的建议，入库 ${committed} 题${failures.length ? `；${failures.length} 题失败：${failures[0]}` : ''}`, failures.length ? 'err' : 'ok');
      render();
    },
  });
}

/** AI 只生成建议，老师在题卡上逐项采纳后才写入待审核的正式字段。 */
async function pdAiFill(ids, byId) {
  if (!ids.length) return toast('请先勾选题目', 'err');
  const byRun = {}, external = [];
  ids.forEach((id) => {
    const m = /^run:(\d+):(\d+)/.exec(id);
    if (m) (byRun[m[1]] = byRun[m[1]] || []).push(Number(m[2])); else external.push(id);
  });
  const btn = document.getElementById('pd-bai');
  btn.disabled = true; btn.textContent = '生成建议中…';
  let done = 0; const errors = [];
  for (const rid of Object.keys(byRun)) {
    try {
      const r = await api(`${PD_API}/intake/runs/${rid}/aifill`, { method: 'POST', body: { indexes: byRun[rid] }, silent: true });
      done += Number(r.suggested) || 0;
    } catch (e) { errors.push(e.message || String(e)); }
  }
  for (let i = 0; i < external.length; i += 20) {
    try {
      const r = await api(`${PD_API}/ext/pending/ai-answer`, { method: 'POST', body: { ids: external.slice(i, i + 20) }, silent: true });
      done += Number(r.suggested) || 0;
      if (r.failed && r.failed.length) errors.push(r.failed[0].msg);
    } catch (e) { errors.push(e.message || String(e)); }
  }
  toast(`已生成 ${done} 题的 AI 建议，请逐项核对并采纳${errors.length ? `；部分失败：${errors[0]}` : ''}`, errors.length ? 'err' : 'ok');
  render();
}

/** 编辑单题 */
function pdEdit(it) {
  let pdAud = null;   // 听力音频字段（T7）
  const optRow = (o, i) => `<div class="pd-optrow"><button type="button" class="pd-optlb" aria-label="将选项 ${String.fromCharCode(65 + i)} 设为答案" aria-pressed="false">${String.fromCharCode(65 + i)}</button><input class="input pd-opt" value="${esc(optText(o))}" aria-label="选项 ${String.fromCharCode(65 + i)} 内容"><button type="button" class="link-btn danger" data-delopt>删</button></div>`;
  modal({
    title: `编辑题目 · ${it.source_label}`, okText: '保存', wide: true,
    body: `<div class="pd-grid">
        <div class="field"><label>题型</label><select id="pdE-type" class="input">${pdOpts(PD_TYPES, it.type)}</select>${it.type_unconfirmed ? '<label><input type="checkbox" id="pdE-type-confirm"> 已对照原题确认题型</label>' : ''}</div>
        <div class="field"><label>细分题型（选填）</label><select id="pdE-subtype" class="input"><option value="">不细分</option></select></div>
        <div class="field"><label>学科</label><select id="pdE-sub" class="input">${pdClassOpts(PD_SUBJECTS, it.subject)}</select></div>
        <div class="field"><label>学段</label><select id="pdE-stage" class="input">${pdClassOpts(PD_STAGES.slice(1), it.stage)}</select></div>
        <div class="field"><label>年级</label><select id="pdE-grade" class="input">${pdClassOpts(PD_GRADES, it.grade)}</select></div>
        <div class="field"><label>难度（五星）</label><select id="pdE-diff" class="input">${pdOpts([1, 2, 3, 4, 5], it.difficulty || 3)}</select></div>
        <div class="field"><label>十级难度（选填）</label><select id="pdE-diff10" class="input">${pdOpts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], it.difficulty_score_10, '未记录')}</select><small class="hint">选择十级后自动同步五星；旧题没有十级值时保持空白。</small></div>
      </div>
      <div class="field"><label>材料 / 原文（复合题共用，没有可不填）</label><textarea id="pdE-mat" class="input" rows="3">${esc(it.material)}</textarea></div>
      <div class="field"><label>题干（公式用 \\( … \\)）</label><textarea id="pdE-stem" class="input" rows="5">${esc(it.stem)}</textarea></div>
      <div class="field" id="pdE-match-wrap" style="display:none"><label>匹配左侧项目（每行一项）</label><textarea id="pdE-match" class="input" rows="3">${esc((it.match_prompts || []).join('\n'))}</textarea><small>右侧选项按下方选项填写；答案按左侧顺序填写右侧序号，如 2,1,3。</small></div>
      <div class="field" id="pdE-optbox"><label>选项 <span class="pd-hint">单选、多选可点击字母设置答案</span></label><div id="pdE-opts">${(it.options || []).map(optRow).join('')}</div><button type="button" class="btn ghost xs" id="pdE-addopt">＋ 添加选项</button></div>
      <div class="field"><label>答案<span class="pd-hint">选择题填字母（多选如 A,C）；判断题 正确/错误；填空多个空用 | 隔开</span></label><input id="pdE-ans" class="input" value="${esc(it.answer)}"></div>
      <div class="field"><label>解析</label><textarea id="pdE-ana" class="input" rows="3">${esc(it.analysis)}</textarea></div>
      <div class="field"><label>知识点</label><input id="pdE-point" class="input" value="${esc(it.point)}" placeholder="如：有理数的加法"></div>
      <div id="pdE-audio"></div>
      ${(it.images || []).length ? `<div class="pd-imgs">${it.images.map((u) => pdImage(u, '题图')).join('')}</div>` : ''}`,
    onMount: (w) => {
      t8Enhance(w, { fields: ['#pdE-stem', '#pdE-ana', '#pdE-mat', ...w.querySelectorAll('.pd-opt')] });   // 公式输入（T8）
      pdAud = t7AudioWidget(w.querySelector('#pdE-audio'), { key: it.audio_key, url: it.audio_url, limit: it.audio_play_limit });
      const showMatch = () => { w.querySelector('#pdE-match-wrap').style.display = QSubtype.isMatch(w.querySelector('#pdE-subtype').value) ? '' : 'none'; };
      w.querySelector('#pdE-diff10').onchange = (e) => { if (e.target.value) w.querySelector('#pdE-diff').value = String(Math.ceil(Number(e.target.value) / 2)); };
      w.querySelector('#pdE-diff').onchange = (e) => { const ten = w.querySelector('#pdE-diff10'); if (ten.value && Math.ceil(Number(ten.value) / 2) !== Number(e.target.value)) ten.value = ''; };
      const subtypeUpdate = (current) => { QSubtype.fillSelect(w.querySelector('#pdE-subtype'), w.querySelector('#pdE-sub').value, w.querySelector('#pdE-type').value, current); showMatch(); };
      subtypeUpdate(it.question_subtype);
      w.querySelector('#pdE-sub').addEventListener('change', () => subtypeUpdate());
      w.querySelector('#pdE-subtype').addEventListener('change', showMatch);
      const optBox = w.querySelector('#pdE-opts');
      const ans = w.querySelector('#pdE-ans');
      const selectedLetters = () => {
        const value = ans.value.trim().toUpperCase();
        return /^[A-J](?:[A-J,，、\s]*[A-J])?$/.test(value) ? [...new Set(value.match(/[A-J]/g))] : [];
      };
      const paintAnswer = () => {
        const isChoice = ['single', 'multi'].includes(w.querySelector('#pdE-type').value);
        const selected = isChoice ? selectedLetters() : [];
        optBox.querySelectorAll('.pd-optlb').forEach((b) => {
          const on = selected.includes(b.textContent);
          b.classList.toggle('is-answer', on); b.setAttribute('aria-pressed', String(on));
          b.disabled = !isChoice;
        });
      };
      const relabel = () => optBox.querySelectorAll('.pd-optrow').forEach((row, i) => {
        const letter = String.fromCharCode(65 + i), b = row.querySelector('.pd-optlb');
        b.textContent = letter; b.setAttribute('aria-label', `将选项 ${letter} 设为答案`);
        row.querySelector('.pd-opt').setAttribute('aria-label', `选项 ${letter} 内容`);
      });
      const showOpts = () => { const t = w.querySelector('#pdE-type').value; w.querySelector('#pdE-optbox').style.display = ['single', 'multi', 'sort'].includes(t) ? '' : 'none'; };
      showOpts(); paintAnswer();
      ans.addEventListener('input', paintAnswer);
      w.querySelector('#pdE-type').onchange = () => { showOpts(); paintAnswer(); subtypeUpdate(); };
      w.querySelector('#pdE-addopt').onclick = () => { if (optBox.children.length >= 10) return toast('最多支持 10 个选项', 'err'); const d = document.createElement('div'); d.innerHTML = optRow({ text: '' }, optBox.children.length); optBox.appendChild(d.firstChild); paintAnswer(); };
      optBox.onclick = (e) => {
        const letterButton = e.target.closest('.pd-optlb');
        if (letterButton && !letterButton.disabled) {
          const letter = letterButton.textContent, type = w.querySelector('#pdE-type').value;
          const selected = selectedLetters();
          ans.value = type === 'single' ? letter : (selected.includes(letter) ? selected.filter((x) => x !== letter) : selected.concat(letter)).sort().join(',');
          paintAnswer(); return;
        }
        const del = e.target.closest('[data-delopt]');
        if (!del) return;
        const rows = [...optBox.querySelectorAll('.pd-optrow')];
        const row = del.closest('.pd-optrow'), removedIndex = rows.indexOf(row);
        const selected = selectedLetters();
        // 只改可以明确识别的字母答案，避免改写导入的自由文本答案。
        if (selected.length && ['single', 'multi'].includes(w.querySelector('#pdE-type').value)) {
          ans.value = selected.map((letter) => letter.charCodeAt(0) - 65).filter((i) => i !== removedIndex).map((i) => String.fromCharCode(65 + i - (i > removedIndex ? 1 : 0))).join(',');
        }
        row.remove(); relabel(); paintAnswer();
      };
    },
    onOk: async (w) => {
      const v = (id) => w.querySelector(id).value;
      const patch = {
        type: v('#pdE-type'), question_subtype: v('#pdE-subtype'), match_prompts: v('#pdE-match').split(/\r?\n/).map((s) => s.trim()).filter(Boolean), subject: v('#pdE-sub'), stage: v('#pdE-stage'), grade: v('#pdE-grade'), difficulty: Number(v('#pdE-diff')), difficulty_score_10: v('#pdE-diff10') ? Number(v('#pdE-diff10')) : null,
        stem: v('#pdE-stem').trim(), answer: v('#pdE-ans').trim(), analysis: v('#pdE-ana').trim(), point: v('#pdE-point').trim(),
        options: [...w.querySelectorAll('.pd-opt')].map((x, i) => ({ label: String.fromCharCode(65 + i), text: x.value.trim() })).filter((o) => o.text),
      };
      if (w.querySelector('#pdE-mat')) patch.material = v('#pdE-mat').trim();
      if (it.type_unconfirmed && w.querySelector('#pdE-type-confirm').checked) patch.type_confirmed = true;
      if (pdAud) { patch.audio_key = pdAud.get(); patch.audio_play_limit = pdAud.getLimit(); }
      if (!patch.stem) { toast('题干不能为空', 'err'); return false; }
      await api(`${PD_API}/ext/pending/item`, { method: 'PUT', body: { id: it.id, patch } });
      toast('已保存', 'ok');
      render();
    },
  });
}

/** 下载客户的 Excel 模板（要带登录票据，所以用 fetch 再保存） */
async function pdDownloadTemplate(extended = false) {
  try {
    const query = extended === 'difficulty10' ? '?difficulty_10=1' : extended === 'math' ? '?math_subtypes=1' : extended === 'options10' ? '?options_10=1' : extended === true ? '?english_subtypes=1' : '';
    const r = await fetch(`${PD_API}/ext/import-template${query}`, { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = extended === 'difficulty10' ? '十级难度习题导入模板.xlsx' : extended === 'math' ? '数学作图与连线导入模板.xlsx' : extended === 'options10' ? '十选项习题导入模板.xlsx' : extended === true ? '英语细分题型导入模板.xlsx' : '习题导入模板.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  } catch (e) { toast('模板下载失败：' + e.message, 'err'); }
}

/** 导入 Excel / Word：先选默认的 学科/学段/年级（Excel 模板里没有这几列），再选文件；结果里列出没导入的行和原因 */
function pdImportDialog(kind) {
  const isExcel = kind === 'excel';
  const w = modal({
    title: isExcel ? '导入 Excel（习题导入模板）' : '导入 Word（.docx）', okText: '选择文件并导入',
    body: `${isExcel
      ? `<p class="pd-tip" style="margin-top:0">请使用「习题导入模板」（9 个 sheet：单选 / 多选 / 判断 / 组合 / 填空 / 排序 / 完形填空 / 选择填空 / 阅读理解），<b>不要改动现有表头和列顺序</b>；模板里的【例题】示例行会被自动忽略。<a href="javascript:;" id="pdI-tpl">下载原模板</a> · <a href="javascript:;" id="pdI-engtpl">英语细分题型模板</a> · <a href="javascript:;" id="pdI-mathtpl">数学作图与连线模板</a> · <a href="javascript:;" id="pdI-optstpl">十选项模板</a></p><p class="pd-tip">原卷没有答案时可留空，导入后由老师核对；选择填空缺答案时，请使用十选项模板填写完整选项，不能只填干扰项。词块题原顺序不会自动作为标准答案。数学连线请在排序题工作表的细分题型列填写「连线」，作图请使用「作图题」工作表。</p>`
      : `<p class="pd-tip" style="margin-top:0">按下面的格式要求排好版，不用 AI，格式不对的题会告诉你在第几段、哪里不对。<a href="javascript:;" id="pdI-rule">${'查看格式要求'}</a></p><div id="pdI-rulebox" style="display:none">${PD_WORD_RULES}</div>`}
      <div class="pd-grid">
        <div class="field"><label>学科</label><select id="pdI-sub" class="input">${pdOpts(PD_SUBJECTS, '数学', '不指定')}</select></div>
        <div class="field"><label>学段</label><select id="pdI-stage" class="input">${pdOpts(PD_STAGES.slice(1), 'junior', '不指定')}</select></div>
        <div class="field"><label>年级</label><select id="pdI-grade" class="input">${pdOpts(PD_GRADES, '', '不指定')}</select></div>
      </div>
      <input type="file" id="pdI-file" accept="${isExcel ? '.xlsx,.xls' : '.docx'}" style="display:none">
      <div id="pdI-res" style="font-size:13px;line-height:1.8;margin-top:6px"></div>`,
    onMount: (el) => {
      const tpl = el.querySelector('#pdI-tpl'); if (tpl) tpl.onclick = () => pdDownloadTemplate(false);
      const engtpl = el.querySelector('#pdI-engtpl'); if (engtpl) engtpl.onclick = () => pdDownloadTemplate(true);
      const mathtpl = el.querySelector('#pdI-mathtpl'); if (mathtpl) mathtpl.onclick = () => pdDownloadTemplate('math');
      const optstpl = el.querySelector('#pdI-optstpl'); if (optstpl) optstpl.onclick = () => pdDownloadTemplate('options10');
      const rl = el.querySelector('#pdI-rule'); if (rl) rl.onclick = () => { const b = el.querySelector('#pdI-rulebox'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
      el.querySelector('#pdI-file').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const out = el.querySelector('#pdI-res');
        out.innerHTML = '<span style="color:#6366f1">导入中，请稍候…</span>';
        try {
          const fd = new FormData();
          fd.append('file', f);
          ['sub:subject', 'stage:stage', 'grade:grade'].forEach((p) => { const [id, k] = p.split(':'); fd.append(k, el.querySelector('#pdI-' + id).value); });
          const r = await fetch(`${PD_API}/ext/import-${kind}`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.msg || '导入失败');
          const d = j.data || {};
          const errs = (d.errors || []);
          const errHTML = isExcel ? errs.map((x) => `<div>${esc(x)}</div>`).join('') : errs.map((x) => `<div>第 ${x.para} 段（第 ${x.no} 题）：${esc(x.msg)}</div>`).join('');
          const warnHTML = (d.warnings || []).map((x) => `<div>第 ${x.para} 段：${esc(x.msg)}</div>`).join('');
          out.innerHTML = `<b style="color:#16a34a">✅ ${esc(j.msg)}</b>
            ${errHTML ? `<div style="color:#dc2626;margin-top:6px">没导入的题（${d.error_count}）：${errHTML}${d.error_count > errs.length ? `<div>…另有 ${d.error_count - errs.length} 条</div>` : ''}</div>` : ''}
            ${warnHTML ? `<div style="color:#d97706;margin-top:6px">提醒：${warnHTML}</div>` : ''}
            <div style="margin-top:8px"><button type="button" class="btn sm primary" id="pdI-done">去看看这批题</button></div>`;
          el.querySelector('#pdI-done').onclick = () => { el.closest('.mask').remove(); pdSelectBatch(kind, d.run_id); render(); };
        } catch (er) {
          out.innerHTML = `<span style="color:#dc2626">❌ ${esc(er.message)}</span>`;
        }
        e.target.value = '';
      };
    },
    onOk: async (el) => { el.querySelector('#pdI-file').click(); return false; },
  });
  return w;
}
