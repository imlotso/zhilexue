/* 手动录题：准备、录入、核对三个步骤；所有题目先进入待审核。 */
'use strict';

async function viewIntakeManual() {
  const types = [
    ['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'], ['fill', '填空题'],
    ['sort', '排序题'], ['listen_match', '听力匹配'], ['math_match', '数学连线'], ['translation', '翻译'], ['writing', '书面表达'], ['calculation', '计算题'], ['drawing', '作图题'], ['answer', '问答题'],
  ];
  const grades = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
  const opts = (arr) => arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  const row = () => `<section class="r4m-question">
    <div class="r4m-question-head"><h3 data-question-title>小题</h3><button type="button" class="btn ghost sm" data-question-remove>删除小题</button></div>
    <div class="field"><label>题型<select class="input" data-question-type>${opts(types)}</select></label></div>
    <div class="field"><label>题干 <span aria-hidden="true">*</span><textarea class="input" rows="3" data-question-stem placeholder="填写题目内容"></textarea></label></div>
    <div class="field" data-match-field style="display:none"><label>匹配左侧项目<textarea class="input" rows="3" data-question-match placeholder="每行一项，如人物名称"></textarea></label><small data-match-hint></small></div>
    <div class="field" data-options-field><label>选项<textarea class="input" rows="4" data-question-options placeholder="每行填写一个选项，按 A、B、C 顺序排列"></textarea></label><small data-options-hint>每行填写一个选项。</small></div>
    <div class="field"><label>答案（选填）<input class="input" data-question-answer placeholder="单选填写 A，多选填写 A,C"></label><small>原题没有答案时可以留空，待审核时再补。</small></div>
    <div class="field"><label>解析（选填）<textarea class="input" rows="2" data-question-analysis placeholder="原题没有解析可留空"></textarea></label></div>
  </section>`;
  const html = `<div class="r4m-page">
    <div class="r4m-heading"><div><span class="r4m-kicker">录题中心</span><h2>手动录题</h2><p>录入后进入待审核，核对分类和内容后入库。</p></div><button type="button" class="btn ghost" id="r4m-back">返回录题中心</button></div>
    <ol class="r4m-steps" aria-label="录题步骤"><li data-step-label="1"><b>1</b><span>准备资料</span></li><li data-step-label="2"><b>2</b><span>录入题目</span></li><li data-step-label="3"><b>3</b><span>核对并送审</span></li></ol>
    <div class="r4m-content">
      <section data-step="1"><h3>准备资料</h3><p class="r4m-help">选择学科和录题方式，可为题目添加共用材料与听力音频。</p>
        <div class="r4m-grid"><div class="field"><label>学科<select class="input" id="r4m-subject">${opts([['数学','数学'],['英语','英语'],['物理','物理'],['化学','化学'],['语文','语文']])}</select></label></div>
          <div class="field"><label>学段<select class="input" id="r4m-stage">${opts([['primary','小学'],['junior','初中'],['senior','高中']])}</select></label></div>
          <div class="field"><label>年级（选填）<select class="input" id="r4m-grade"><option value="">未指定</option>${grades.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></label></div></div>
        <fieldset class="r4m-mode"><legend>录题方式</legend><label><input type="radio" name="r4m-kind" value="single" checked><span><b>单道题</b><small>录入一道题目</small></span></label><label><input type="radio" name="r4m-kind" value="group"><span><b>组合题</b><small>一份材料和多道小题</small></span></label></fieldset>
        <div class="field"><label>材料 / 原文<span id="r4m-material-required">（选填）</span><textarea class="input" id="r4m-material" rows="4" placeholder="可填写阅读材料或听力材料说明"></textarea></label><small>组合题的每道小题都会保存一份材料。</small></div><div id="r4m-audio"></div>
      </section>
      <section data-step="2" hidden><h3>录入题目</h3><p class="r4m-help">按题型填写题干和选项；可以先留空答案及解析。</p><div id="r4m-questions"></div><button type="button" class="btn ghost" id="r4m-add">＋ 添加小题</button></section>
      <section data-step="3" hidden><h3>核对并送审</h3><p class="r4m-help">请检查题干、选项与材料，送审后仍可在待审核页面修改和补充分类。</p><div id="r4m-summary"></div></section>
    </div>
    <div class="r4m-footer"><span class="r4m-footer-tip">题目将先保存到待审核</span><div><button type="button" class="btn ghost" id="r4m-prev">上一步</button><button type="button" class="btn primary" id="r4m-next">下一步</button></div></div>
  </div>`;
  return { html, after: () => {
    const root = document.querySelector('.r4m-page'); if (!root) return;
    const $ = (s) => root.querySelector(s);
    const box = $('#r4m-questions');
    let step = 1, busy = false;
    const questionImages = new WeakMap();
    const audio = t7AudioWidget($('#r4m-audio'), {});
    const val = (selector) => $(selector).value.trim();
    const mode = () => root.querySelector('[name="r4m-kind"]:checked').value;
    const lines = (value) => String(value || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const numberRows = () => {
      const isGroup = mode() === 'group';
      box.querySelectorAll('.r4m-question').forEach((q, i) => { q.hidden = !isGroup && i > 0; q.querySelector('[data-question-title]').textContent = isGroup ? `小题 ${i + 1}` : '题目'; q.querySelector('[data-question-remove]').hidden = !isGroup; });
      $('#r4m-add').hidden = !isGroup;
      $('#r4m-material-required').textContent = isGroup ? '（组合题必填）' : '（选填）';
    };
    const showQuestionType = (question) => {
      const type = question.querySelector('[data-question-type]').value;
      const fields = question.querySelector('[data-options-field]');
      fields.style.display = ['single', 'multi', 'sort', 'listen_match', 'math_match'].includes(type) ? '' : 'none';
      question.querySelector('[data-match-field]').style.display = ['listen_match', 'math_match'].includes(type) ? '' : 'none';
      question.querySelector('[data-match-hint]').textContent = type === 'math_match' ? '左右各 2–7 项，数量可以不同；多个左项可以连接同一个右项。' : '左右各 2–7 项，数量相同，每个右项使用一次。';
      question.querySelector('[data-options-hint]').textContent = ['listen_match', 'math_match'].includes(type) ? '每行填写一个右侧候选项，按顺序编号。' : '每行填写一个选项。';
      const hint = { single: '填写 A', multi: '填写 A,C', judge: '填写 正确 或 错误', fill: '多空用 | 分隔', sort: '按顺序填写序号，如 2,1,3', listen_match: '按左侧顺序填写右侧序号，如 2,1,3', math_match: '按左侧顺序填写右侧序号，如 2,1,3', translation: '可接受的译文用 ||| 分隔', writing: '参考范文选填，不自动判分', calculation: '参考解题过程选填，由老师评分', drawing: '参考作图说明选填，由老师评分', answer: '问答题供学生对照，不自动判分' };
      question.querySelector('[data-question-answer]').placeholder = hint[type];
    };
    const addQuestion = () => {
      if (box.children.length >= 30) { toast('最多添加 30 道小题', 'err'); return; }
      const holder = document.createElement('div'); holder.innerHTML = row(); const q = holder.firstChild; box.appendChild(q);
      const images = []; questionImages.set(q, images);
      q.querySelector('[data-question-type]').addEventListener('change', () => showQuestionType(q));
      if (typeof t8Enhance === 'function') t8Enhance(q, { fields: ['[data-question-stem]', '[data-question-options]', '[data-question-analysis]', '[data-question-match]'], images });
      showQuestionType(q); numberRows();
    };
    const dataQuestions = () => [...box.querySelectorAll('.r4m-question')].filter((q) => !q.hidden).map((q) => {
      const get = (key) => q.querySelector(`[data-question-${key}]`).value.trim();
      const selected = get('type');
      return { type: ['listen_match', 'math_match'].includes(selected) ? 'sort' : selected === 'translation' ? 'fill' : ['writing', 'calculation', 'drawing'].includes(selected) ? 'answer' : selected, question_subtype: ['listen_match', 'math_match', 'translation', 'writing', 'calculation', 'drawing'].includes(selected) ? selected : '',
        stem: get('stem'), options: ['single', 'multi', 'sort', 'listen_match', 'math_match'].includes(selected) ? lines(get('options')) : [],
        match_prompts: ['listen_match', 'math_match'].includes(selected) ? lines(get('match')) : [], answer: get('answer'), analysis: get('analysis'), images: questionImages.get(q) || [] };
    });
    const validate = () => {
      const qs = dataQuestions();
      if (mode() === 'group' && qs.length < 2) return '组合题至少需要两道小题';
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i]; const prefix = mode() === 'group' ? `第 ${i + 1} 小题：` : '';
        if (!q.stem) return prefix + '请填写题干';
        if (['translation', 'writing'].includes(q.question_subtype) && val('#r4m-subject') !== '英语') return prefix + '请选择英语学科';
        if (q.question_subtype === 'calculation' && val('#r4m-subject') !== '数学') return prefix + '计算题请选择数学学科';
        if (q.question_subtype === 'drawing' && !['数学', '物理', '化学'].includes(val('#r4m-subject'))) return prefix + '作图题请选择数学、物理或化学学科';
        if (['single', 'multi', 'sort'].includes(q.type)) {
          const max = q.type === 'sort' ? 7 : 10;
          if (q.options.length < 2 || q.options.length > max) return prefix + `请填写 2–${max} 个选项`;
        }
        if (['listen_match', 'math_match'].includes(q.question_subtype)) {
          if (val('#r4m-subject') !== (q.question_subtype === 'listen_match' ? '英语' : '数学')) return prefix + '请选择与匹配题对应的学科';
          if (q.match_prompts.length < 2 || q.match_prompts.length > 7 || (q.question_subtype === 'listen_match' && q.match_prompts.length !== q.options.length)) return prefix + (q.question_subtype === 'math_match' ? '左右各填写 2–7 项' : '匹配项目与选项数量须相同（2–7 项）');
        }
      }
      return '';
    };
    const makeSummary = () => {
      const kind = mode() === 'group' ? '组合题' : '单道题';
      const itemType = (q) => (types.find(([k]) => k === (q.question_subtype || q.type)) || [null, q.type])[1];
      const summary = $('#r4m-summary');
      summary.innerHTML = `<div class="r4m-summary-meta"><b>${esc(kind)}</b><span>${esc(val('#r4m-subject'))} · ${esc($('#r4m-stage').selectedOptions[0].textContent)}${val('#r4m-grade') ? ' · ' + esc(val('#r4m-grade')) : ''}</span><span>${audio.get() ? '已添加听力音频' : '未添加音频'}</span></div>
        ${val('#r4m-material') ? `<div class="r4m-summary-material"><b>材料 / 原文</b><p>${esc(val('#r4m-material')).replace(/\n/g, '<br>')}</p></div>` : ''}
        ${dataQuestions().map((q, i) => `<article class="r4m-summary-q"><b>${mode() === 'group' ? `小题 ${i + 1} · ` : ''}${esc(itemType(q))}</b><p>${esc(q.stem).replace(/\n/g, '<br>')}</p>${q.match_prompts.length ? `<div class="r4m-summary-label">匹配项目</div><ol>${q.match_prompts.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${q.options.length ? `<div class="r4m-summary-label">选项</div><ol type="A">${q.options.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}<div class="r4m-summary-answer">答案：${q.answer ? esc(q.answer) : '未填写'}　·　解析：${q.analysis ? esc(q.analysis) : '未填写'}</div></article>`).join('')}`;
    };
    const show = () => {
      root.querySelectorAll('[data-step]').forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
      root.querySelectorAll('[data-step-label]').forEach((el) => { const n = Number(el.dataset.stepLabel); el.classList.toggle('current', n === step); el.classList.toggle('done', n < step); if (n === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
      $('#r4m-prev').hidden = step === 1; $('#r4m-next').textContent = step === 3 ? '保存到待审核' : '下一步';
      if (step === 3) makeSummary();
      window.scrollTo(0, 0);
    };
    $('#r4m-back').onclick = () => { location.hash = '#/intake'; };
    root.querySelectorAll('[name="r4m-kind"]').forEach((el) => el.onchange = () => { if (mode() === 'group' && box.children.length < 2) addQuestion(); numberRows(); });
    box.onclick = (e) => { const remove = e.target.closest('[data-question-remove]'); if (!remove) return; if (box.children.length <= 2) return toast('组合题至少保留两道小题', 'err'); remove.closest('.r4m-question').remove(); numberRows(); };
    $('#r4m-add').onclick = addQuestion;
    $('#r4m-prev').onclick = () => { if (step > 1) { step--; show(); } };
    $('#r4m-next').onclick = async () => {
      if (busy) return;
      if (step === 1) {
        if (mode() === 'group' && !val('#r4m-material')) return toast('组合题请填写共用材料', 'err');
        step = 2; show(); return;
      }
      if (step === 2) { const error = validate(); if (error) return toast(error, 'err'); step = 3; show(); return; }
      const error = validate(); if (error) return toast(error, 'err');
      const common = { subject: val('#r4m-subject'), stage: val('#r4m-stage'), grade: val('#r4m-grade'), material: val('#r4m-material'), audio_key: audio.get(), audio_play_limit: audio.getLimit() };
      const group = mode() === 'group'; const questions = dataQuestions();
      busy = true; $('#r4m-next').disabled = true; $('#r4m-next').textContent = '保存中…';
      try {
        await api(`/api/admin/bank/mf/ext/pending/${group ? 'manual-group' : 'manual'}`, { method: 'POST', body: group ? { ...common, questions } : { ...common, ...questions[0] } });
        toast('已保存到待审核', 'ok'); location.hash = '#/pending';
      } catch (e) { toast(e.message || '保存失败，请重试', 'err'); busy = false; $('#r4m-next').disabled = false; $('#r4m-next').textContent = '保存到待审核'; }
    };
    addQuestion(); numberRows(); show();
  } };
}
