/* 统一录题入口：各方式保留独立工作流，审核结果集中在待审核页。 */
async function viewIntakeCenter() {
  let historyError = '';
  const runs = (await api('/api/admin/bank/mf/intake/runs', { silent: true }).catch((e) => { historyError = e.message || '读取批次失败'; return { list: [] }; })).list || [];
  const entries = [
    ['recognize', '拍照 / 截图识别', '上传题目图片，在工作台中识别和核对。', 'image'],
    ['document', 'PDF / Word 识别', '上传试卷或文档，识别后逐题核对。', 'doc'],
    ['excel', 'Excel 模板导入', '按题型模板填写，一次导入多道题。', 'grid'],
    ['skill', 'JSON / 技能包', '导入 AI 转写后的题目包，先进入待审核。', 'code'],
    ['capture', '网络采集', '在老师自己的浏览器中采集题目。', 'link'],
    ['phone', '手机扫码录题', '手机拍照提交，回到后台核对并入库。', 'phone'],
    ['manual', '手动创建', '输入题干、选项和答案，再进行分类审核。', 'edit'],
  ];
  const status = { draft: '待上传', recognized: '待核对', done: '已处理', error: '识别失败' };
  return {
    html: `<div class="r4-intake"><div class="r4-intake-head"><div><span class="r4-kicker">智能题库</span><h2>录题中心</h2><p>选择适合的方式录入题目，核对并分类后再入库。</p></div><button class="btn primary" type="button" id="r4-review">查看待审核题目</button></div>
      <div class="r4-steps" aria-label="录题步骤"><div><b>1</b><span><strong>准备资料</strong><small>选择学科、学段和文件</small></span></div><div><b>2</b><span><strong>上传或录入</strong><small>可随时查看处理状态</small></span></div><div><b>3</b><span><strong>核对入库</strong><small>检查答案和分类后入库</small></span></div></div>
      <h3>选择录题方式</h3><div class="r4-entry-grid">${entries.map(([id, title, text, icon]) => `<button type="button" class="r4-entry" data-intake="${id}"><span class="r4-entry-icon">${ic(icon)}</span><span><strong>${esc(title)}</strong><small>${esc(text)}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div>
      <div class="r4-history"><div class="r4-history-head"><div><h3>最近录题批次</h3><p>继续未完成的识别，或查看已处理批次。</p></div><button type="button" class="btn ghost sm" id="r4-history">管理批次</button></div>${historyError ? `<p role="alert">${esc(historyError)}，请点击管理批次重试；不能据此判断上次上传失败。</p>` : runs.length ? `<div class="r4-history-list">${runs.slice(0, 8).map((r) => `<div class="r4-history-row"><span><strong>${esc(r.title)}</strong><small>${esc(r.source_name || r.source_kind)} · ${Number(r.draft_count) || 0} 题</small></span><span class="r4-status ${r.status === 'error' ? 'error' : ''}">${esc(status[r.status] || r.status)}</span><button class="btn ghost sm" type="button" data-run="${r.id}" data-kind="${esc(r.source_kind)}">打开</button></div>`).join('')}</div>` : '<div class="r4-empty">还没有录题批次，选择上方方式开始。</div>'}</div></div>`,
    after: () => {
      R4Flow.bind(document.querySelector('.r4-intake'), 'center');
      const go = (route) => { location.hash = '#/' + route; };
      document.getElementById('r4-review').onclick = () => go('pending');
      document.getElementById('r4-history').onclick = () => go('mfi');
      document.querySelectorAll('[data-run]').forEach((b) => { b.onclick = () => { if (['image','pdf','word'].includes(b.dataset.kind)) mfIntakeWork(Number(b.dataset.run)); else go('pending'); }; });
      document.querySelectorAll('[data-intake]').forEach((b) => { b.onclick = () => {
        switch (b.dataset.intake) {
          case 'recognize': go('intake-photo'); break;
          case 'document': r4DocumentChoice(); break;
          case 'excel': go('intake-excel'); break;
          case 'skill': go('intake-skill'); break;
          case 'capture': go('mfc'); break;
          case 'phone': go('intake-teacher'); break;
          case 'manual': go('intake-manual'); break;
        }
      }; });
    },
  };
}
async function r4TeacherQr() {
  const result = await api('/api/admin/bank/teacher-upload-token', { method: 'POST' });
  const url = location.origin + result.url + '?t=' + encodeURIComponent(result.token);
  modal({ title: '手机扫码录题', okText: '完成', body: '<div class="r4-qr"><div id="r4-qr-code"></div><p>用手机扫码，选择学科和年级后拍照提交。题目将进入待审核，需核对题干和分类。</p><small>二维码 30 分钟内有效，请勿转发给他人。</small></div>', onMount: (w) => {
    const el = w.querySelector('#r4-qr-code');
    if (window.QRCode) new QRCode(el, { text: url, width: 208, height: 208, correctLevel: QRCode.CorrectLevel.M });
    else el.textContent = '二维码加载失败，请刷新页面后重试。';
  } });
}

function r4DocumentChoice() {
  modal({ title: '选择资料类型', body: `<div class="r4-entry-grid r4-doc-choice"><button type="button" class="r4-entry" data-doc="pdf"><span><strong>PDF 逐页识别</strong><small>转成页图后，在工作台选择识别方式。</small></span></button><button type="button" class="r4-entry" data-doc="word"><span><strong>Word 规则导入</strong><small>按 Word 格式要求解析；复杂文档可使用 AI 工作台。</small></span></button></div>`,
    onMount: (w) => w.querySelectorAll('[data-doc]').forEach((b) => { b.onclick = () => { w.remove(); location.hash = '#/intake-' + b.dataset.doc; }; }) });
}

/* Excel 上传是同步解析：进度条只代表文件上传，解析结果确认后才展示下一步。 */
async function viewIntakeExcel(mode = 'excel') {
  const isWord = mode === 'word';
  const [trees, data] = await Promise.all([tpTrees(), api('/api/admin/bank/mf/intake/runs', { silent: true }).catch(() => ({ list: [] }))]);
  const runs = (data.list || []).filter((r) => r.source_kind === mode).slice(0, 8);
  return {
    html: `<div class="r4-intake r4-excel">
      <button type="button" class="r4-back" id="rxBack">‹ 返回录题中心</button>
      <div class="r4-intake-head"><div><span class="r4-kicker">录题中心 / 资料导入</span><h2>${isWord ? 'Word 规则导入' : 'Excel 模板导入'}</h2><p>${isWord ? '按题目格式整理 Word，上传后核对题目和分类。' : '使用模板批量整理习题，上传后先核对，再选择入库。'}</p></div><button type="button" class="btn ghost" id="rxHelp">查看填写说明</button></div>
      <div class="r4-steps r4-excel-steps" aria-label="导入步骤"><div data-step="1" class="active"><b>1</b><span><strong>准备资料</strong><small>选择习题信息</small></span></div><div data-step="2"><b>2</b><span><strong>上传文件</strong><small>支持拖放或选择</small></span></div><div data-step="3"><b>3</b><span><strong>核对入库</strong><small>检查解析结果</small></span></div></div>
      <div class="r4-excel-layout"><main>
        <section class="r4-excel-panel" id="rxPrepare"><div class="r4-excel-sectionhead"><div><h3>准备习题资料</h3><p>先设置这批习题的默认信息，后续可在审核时逐题修改。</p></div></div>
          <div class="r4-excel-form"><label>学科<select id="rxSubject" class="input">${pdOpts(PD_SUBJECTS, '数学')}</select></label><label>学段<select id="rxStage" class="input">${pdOpts(PD_STAGES.slice(1), 'junior')}</select></label><label>年级<select id="rxGrade" class="input">${pdOpts(PD_GRADES, '', '暂不指定')}</select></label><label>教材版本<select id="rxEdition" class="input"><option value="">暂不指定</option></select></label><label>册别<select id="rxTerm" class="input"><option value="">暂不指定</option><option>上册</option><option>下册</option><option>全一册</option></select></label><label>资料类型<select id="rxMaterial" class="input"><option value="">暂不指定</option><option value="textbook">教材配套</option><option value="exercise">练习资料</option><option value="paper">试卷</option><option value="other">其他</option></select></label></div>
          <p class="r4-excel-note">版本、册别和资料类型将记录在导入批次中；题目节点需要在审核时确认。</p>
          <div class="r4-excel-guide"><strong>${isWord ? '选择适合文档的导入方式' : '还没有填写模板？'}</strong><span>${isWord ? '规则导入要求题号、选项与答案按指定格式排版；复杂文档可使用 AI 识别工作台。' : '原卷没有答案时可留空，导入后由老师核对。选择填空缺答案时，请下载十选项模板并填写完整选项；词块题的原顺序不会自动作为答案。'}</span><div><button type="button" class="btn ghost sm" id="rxTemplate">${isWord ? '查看 Word 格式要求' : '下载习题模板'}</button> <button type="button" class="btn ghost sm" id="rxEnglishTemplate">${isWord ? '打开 AI 识别工作台' : '英语细分题型模板'}</button>${isWord ? '' : ' <button type="button" class="btn ghost sm" id="rxMathTemplate">数学作图与连线模板</button> <button type="button" class="btn ghost sm" id="rxDifficultyTemplate">十级难度模板</button> <button type="button" class="btn ghost sm" id="rxOptionsTemplate">十选项模板</button>'}</div></div>
        </section>
        <section class="r4-excel-panel" id="rxUpload" hidden><div class="r4-excel-sectionhead"><div><h3>${isWord ? '上传 Word 文档' : '上传填写好的模板'}</h3><p>${isWord ? '支持 .docx，不超过 40 MB；旧版 .doc 请先另存为 .docx。' : '支持 .xlsx 和 .xls，单个文件不超过 40 MB。'}</p></div></div>
          <input id="rxFile" type="file" accept="${isWord ? '.docx' : '.xlsx,.xls'}" hidden><div class="r4-excel-drop" id="rxDrop" tabindex="0" role="button" aria-label="选择或拖放${isWord ? ' Word' : ' Excel'}文件"><span class="r4-excel-upload-icon">${ic('upload')}</span><strong>拖放文件到这里，或点击选择文件</strong><span>也可以粘贴剪贴板中的文件</span><button type="button" class="btn ghost sm" id="rxChoose">选择文件</button></div>
          <div id="rxFileStatus" class="r4-excel-file" aria-live="polite">尚未选择文件</div><div id="rxMessage" class="r4-excel-message" aria-live="polite"></div>
        </section>
        <section class="r4-excel-panel" id="rxResult" hidden><div class="r4-excel-sectionhead"><div><h3>文件已处理</h3><p>成功导入的题目已保存到待审核，核对后才能进入题库。</p></div></div><div id="rxResultBody" aria-live="polite"></div></section>
        <div class="r4-excel-actions"><button type="button" class="btn ghost" id="rxPrevious">取消</button><button type="button" class="btn primary" id="rxNext">下一步：选择文件</button></div>
      </main><aside class="r4-excel-aside"><div class="r4-history"><h3>最近 ${isWord ? 'Word' : 'Excel'} 批次</h3><p>可随时回到待审核继续处理。</p>${runs.length ? `<div class="r4-history-list">${runs.map((r) => `<div class="r4-history-row"><span><strong>${esc(r.source_name || r.title)}</strong><small>${Number(r.draft_count) || 0} 题 · ${r.status === 'done' ? '已处理' : '待核对'} · ${esc(r.created_at || '')}</small></span><button type="button" class="btn ghost sm" data-rx-history="${Number(r.id)}">查看</button></div>`).join('')}</div>` : '<div class="r4-empty">暂无导入记录</div>'}</div></aside></div></div>`,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const root = document.querySelector('.r4-excel'); R4Flow.bind(root, mode);
      let step = 1, file = null, busy = false, uncertain = false, lastResult = null;
      const openReview = (batchId) => { const st = ADM.page.pd = ADM.page.pd || { sel: {} }; st.source = mode; st.kw = ''; st.batch_id = Number(batchId) || 0; st.review = 'all'; st.sel = {}; ADM.page.pdPage = 1; location.hash = '#/pending'; };
      $('rxBack').onclick = () => { location.hash = '#/intake'; };
      const help = () => modal({ title: isWord ? 'Word 格式要求' : 'Excel 填写说明', wide: isWord, body: isWord ? PD_WORD_RULES : '<p>下载模板后按工作表里的题型填写，保留工作表名称、表头及列顺序。示例行不会导入。上传后请检查错误行，在待审核中核对题干、答案和分类。</p>' });
      $('rxHelp').onclick = help;
      $('rxTemplate').onclick = () => isWord ? help() : pdDownloadTemplate(false);
      $('rxEnglishTemplate').onclick = () => { if (isWord) location.hash = '#/mfi'; else pdDownloadTemplate(true); };
      if ($('rxMathTemplate')) $('rxMathTemplate').onclick = () => pdDownloadTemplate('math');
      if ($('rxDifficultyTemplate')) $('rxDifficultyTemplate').onclick = () => pdDownloadTemplate('difficulty10');
      if ($('rxOptionsTemplate')) $('rxOptionsTemplate').onclick = () => pdDownloadTemplate('options10');
      document.querySelectorAll('[data-rx-history]').forEach((b) => { b.onclick = () => openReview(b.dataset.rxHistory); });
      const scope = () => {
        const sub = $('rxSubject').value, stage = $('rxStage').value;
        const editions = [...new Set(trees.filter((t) => t.subject === sub && t.stage === stage && t.edition).map((t) => t.edition))];
        $('rxEdition').innerHTML = pdOpts(editions, '', editions.length ? '暂不指定' : '该学段学科暂无版本');
      };
      $('rxSubject').onchange = scope; $('rxStage').onchange = scope; scope();
      const paintStep = () => {
        $('rxPrepare').hidden = step !== 1; $('rxUpload').hidden = step !== 2; $('rxResult').hidden = step !== 3;
        document.querySelectorAll('.r4-excel-steps [data-step]').forEach((el) => { const n = Number(el.dataset.step); el.classList.toggle('active', n === step); el.classList.toggle('complete', n < step); });
        $('rxPrevious').textContent = step === 1 ? '取消' : step === 2 ? '上一步' : '返回录题中心';
        $('rxNext').textContent = step === 1 ? '下一步：选择文件' : step === 2 ? '上传并解析' : '去核对题目';
        $('rxPrevious').disabled = busy; $('rxNext').disabled = busy || uncertain || (step === 2 && !file);
      };
      const setFile = (next) => {
        if (busy || !next) return;
        if (!(isWord ? /\.docx$/i : /\.xlsx?$/i).test(next.name) || next.size > 40 * 1024 * 1024) { $('rxMessage').textContent = isWord ? '请选择不超过 40 MB 的 .docx 文件。' : '请选择不超过 40 MB 的 .xlsx 或 .xls 文件。'; return; }
        file = next; $('rxMessage').textContent = '';
        $('rxFileStatus').innerHTML = `<span><strong>${esc(file.name)}</strong><small>${(file.size / 1024 / 1024).toFixed(2)} MB · 待上传</small></span><button type="button" class="btn ghost sm" id="rxClear">移除</button>`;
        $('rxClear').onclick = () => { file = null; $('rxFile').value = ''; $('rxFileStatus').textContent = '尚未选择文件'; paintStep(); };
        paintStep();
      };
      $('rxChoose').onclick = (e) => { e.stopPropagation(); $('rxFile').click(); };
      $('rxDrop').onclick = () => $('rxFile').click();
      $('rxDrop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('rxFile').click(); } };
      $('rxFile').onchange = (e) => setFile(e.target.files[0]);
      ['dragenter', 'dragover'].forEach((name) => $('rxDrop').addEventListener(name, (e) => { e.preventDefault(); $('rxDrop').classList.add('dragging'); }));
      ['dragleave', 'drop'].forEach((name) => $('rxDrop').addEventListener(name, (e) => { e.preventDefault(); $('rxDrop').classList.remove('dragging'); if (name === 'drop') setFile(e.dataTransfer.files[0]); }));
      document.querySelector('.r4-excel').addEventListener('paste', (e) => { const f = e.clipboardData && e.clipboardData.files[0]; if (step === 2 && f) { e.preventDefault(); setFile(f); } });
      $('rxPrevious').onclick = () => { if (step === 2) { step = 1; paintStep(); } else location.hash = '#/intake'; };
      $('rxNext').onclick = () => {
        if (step === 1) { step = 2; paintStep(); return; }
        if (step === 3) { openReview(lastResult && lastResult.id); return; }
        if (!file || busy) return;
        busy = true; paintStep(); $('rxMessage').textContent = '';
        $('rxFileStatus').innerHTML = `<span><strong>${esc(file.name)}</strong><small id="rxProgressLabel">上传中… 0%</small><progress id="rxProgress" max="100" value="0"></progress></span>`;
        const fd = new FormData(); fd.append('file', file);
        [['subject','rxSubject'],['stage','rxStage'],['grade','rxGrade'],['edition','rxEdition'],['term','rxTerm'],['material_type','rxMaterial']].forEach(([name, id]) => fd.append(name, $(id).value));
        const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/admin/bank/mf/ext/import-${mode}`); xhr.setRequestHeader('Authorization', 'Bearer ' + Auth.token); xhr.responseType = 'json';
        xhr.upload.onprogress = (e) => { if (!e.lengthComputable) return; const n = Math.min(100, Math.round(e.loaded / e.total * 100)); $('rxProgress').value = n; $('rxProgressLabel').textContent = n === 100 ? '上传完成，正在解析…' : `上传中… ${n}%`; };
        xhr.onload = () => {
          busy = false; const result = xhr.response || {};
          if (xhr.status < 200 || xhr.status >= 300 || result.code !== 0) { $('rxMessage').textContent = result.msg || '导入失败，请检查文件后重试。'; $('rxProgressLabel').textContent = '处理失败'; paintStep(); return; }
          const d = result.data || {}; lastResult = { name: file.name, id: d.run_id }; step = 3;
          const errors = Array.isArray(d.errors) ? d.errors : [];
          $('rxResultBody').innerHTML = `<div class="r4-excel-success"><strong>已接收 ${Number(d.total) || 0} 道题</strong><span>${esc(file.name)}${d.examples_skipped ? ` · 忽略 ${Number(d.examples_skipped)} 行示例` : ''}</span></div>${errors.length ? `<div class="r4-excel-errors"><b>${Number(d.error_count) || errors.length} ${isWord ? '题' : '行'}未导入，请修正后另行上传</b>${errors.map((msg) => `<p>${esc(typeof msg === 'string' ? msg : `第 ${msg.para} 段（第 ${msg.no} 题）：${msg.msg}`)}</p>`).join('')}${Number(d.error_count) > errors.length ? '<p>其余错误请检查原文件。</p>' : ''}</div>` : '<p class="r4-excel-note">解析完成，没有发现格式错误。</p>'}${isWord && (d.warnings || []).length ? `<div class="r4-excel-guide"><strong>解析提醒</strong>${d.warnings.map((w) => `<span>${esc(`第 ${w.para} 段：${w.msg}`)}</span>`).join('')}</div>` : ''}`;
          paintStep();
        };
        xhr.onerror = () => { busy = false; uncertain = true; $('rxProgressLabel').textContent = '连接中断'; $('rxMessage').textContent = '连接中断，文件可能已处理。请先返回录题中心检查最近批次，再决定是否重新上传。'; paintStep(); };
        R4Flow.watch(xhr, root, mode, file.name); xhr.send(fd);
      };
      paintStep();
    },
  };
}

/* 图片上传后沿用既有识别工作台；每张图单独上传，以保留已成功的页。 */
async function viewIntakePhoto(mode = 'image') {
  const isPdf = mode === 'pdf';
  const [trees, data] = await Promise.all([tpTrees(), api('/api/admin/bank/mf/intake/runs', { silent: true }).catch(() => ({ list: [] }))]);
  const runs = (data.list || []).filter((r) => ['image', 'pdf'].includes(r.source_kind)).slice(0, 8);
  const status = { draft: '待识别', recognized: '待核对', done: '已处理', error: '识别失败' };
  return {
    html: `<div class="r4-intake r4-excel r4-photo"><button type="button" class="r4-back" id="rpBack">‹ 返回录题中心</button>
      <div class="r4-intake-head"><div><span class="r4-kicker">录题中心 / 资料识别</span><h2>${isPdf ? 'PDF 识别' : '拍照 / 截图识别'}</h2><p>${isPdf ? '上传 PDF 后逐页转换，在识别工作台核对题卡。' : '上传清晰的题目图片，在识别工作台核对题卡后进入待审核。'}</p></div><button type="button" class="btn ghost" id="rpHelp">${isPdf ? 'PDF 识别说明' : '拍摄与识别说明'}</button></div>
      <div class="r4-steps r4-excel-steps" aria-label="录题步骤"><div data-step="1" class="active"><b>1</b><span><strong>准备资料</strong><small>选择习题信息</small></span></div><div data-step="2"><b>2</b><span><strong>${isPdf ? '上传 PDF' : '上传图片'}</strong><small>${isPdf ? '按页转换' : '可添加多张'}</small></span></div><div data-step="3"><b>3</b><span><strong>识别与核对</strong><small>进入识别工作台</small></span></div></div>
      <div class="r4-excel-layout"><main>
        <section class="r4-excel-panel" id="rpPrepare"><div class="r4-excel-sectionhead"><h3>准备习题资料</h3><p>先设置默认信息，识别后的题目仍需审核分类。</p></div>
          <div class="r4-excel-form"><label>批次名称<input class="input" id="rpTitle" placeholder="如：七年级数学练习"></label><label>学科<select id="rpSubject" class="input">${pdOpts(PD_SUBJECTS, '数学')}</select></label><label>学段<select id="rpStage" class="input">${pdOpts(PD_STAGES.slice(1), 'junior')}</select></label><label>年级<select id="rpGrade" class="input">${pdOpts(PD_GRADES, '', '暂不指定')}</select></label><label>教材版本<select id="rpEdition" class="input"><option value="">暂不指定</option></select></label><label>册别<select id="rpTerm" class="input"><option value="">暂不指定</option><option>上册</option><option>下册</option><option>全一册</option></select></label><label>资料类型<select id="rpMaterial" class="input"><option value="">暂不指定</option><option value="textbook">教材配套</option><option value="exercise">练习资料</option><option value="paper">试卷</option><option value="other">其他</option></select></label></div>
          <p class="r4-excel-note">版本、册别和资料类型记录在批次中；题目节点需在审核时确认。</p></section>
        <section class="r4-excel-panel" id="rpUpload" hidden><div class="r4-excel-sectionhead"><h3>${isPdf ? '上传 PDF 文档' : '上传题目图片'}</h3><p>${isPdf ? '选择一个不超过 25 MB 的 PDF，最多 30 页。' : '支持多张图片，每张不超过 25 MB；请按题目顺序添加。'}</p></div>
          <input id="rpFile" type="file" accept="${isPdf ? '.pdf,application/pdf' : 'image/*'}" ${isPdf ? '' : 'multiple'} hidden><div class="r4-excel-drop" id="rpDrop" tabindex="0" role="button" aria-label="选择或拖放${isPdf ? 'PDF 文件' : '题目图片'}"><span class="r4-excel-upload-icon">${ic('upload')}</span><strong>拖放${isPdf ? '文件' : '图片'}到这里，或点击选择</strong><span>也可以粘贴剪贴板中的${isPdf ? '文件' : '截图'}</span><button type="button" class="btn ghost sm" id="rpChoose">选择${isPdf ? '文件' : '图片'}</button></div>
          <div id="rpFiles" class="r4-photo-files" aria-live="polite"><p class="r4-excel-note">尚未选择${isPdf ? '文件' : '图片'}</p></div><p id="rpMessage" class="r4-excel-message" aria-live="polite"></p><button type="button" class="btn ghost sm" id="rpOpenExisting" hidden>打开已有批次</button></section>
        <section class="r4-excel-panel" id="rpResult" hidden><div class="r4-excel-sectionhead"><h3>${isPdf ? 'PDF 页图已上传' : '图片已上传'}</h3><p>接下来在识别工作台选择全自动识别或半自动转写，识别进度和失败原因会显示在工作台。</p></div><div id="rpResultBody"></div></section>
        <div class="r4-excel-actions"><button type="button" class="btn ghost" id="rpPrevious">取消</button><button type="button" class="btn primary" id="rpNext">下一步：选择图片</button></div>
      </main><aside><div class="r4-history"><h3>最近识别批次</h3><p>可返回工作台继续识别或核对。</p>${runs.length ? `<div class="r4-history-list">${runs.map((r) => `<div class="r4-history-row"><span><strong>${esc(r.title)}</strong><small>${Number(r.page_count) || 0} 页 · ${Number(r.draft_count) || 0} 题 · ${esc(status[r.status] || r.status)}${r.error ? '：' + esc(r.error) : ''}</small></span><button type="button" class="btn ghost sm" data-rp-run="${Number(r.id)}">打开</button></div>`).join('')}</div>` : '<div class="r4-empty">暂无识别批次</div>'}</div></aside></div></div>`,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const root = document.querySelector('.r4-photo'); R4Flow.bind(root, mode);
      let step = 1, busy = false, runId = 0, entries = [], pdfName = '', pdfPrepared = false;
      $('rpBack').onclick = () => { if (!busy) location.hash = '#/intake'; };
      $('rpHelp').onclick = () => modal({ title: isPdf ? 'PDF 识别说明' : '拍摄与识别说明', body: isPdf ? '<p>PDF 会在浏览器中逐页转为图片，每次最多处理 30 页。上传后进入识别工作台，题目需要在待审核中确认后入库。</p>' : '<p>请保持文字清晰、画面光线均匀，尽量拍全题目和选项。图片上传后进入工作台，选择识别方式并核对题卡；题目最终需要在待审核中确认后入库。</p>' });
      document.querySelectorAll('[data-rp-run]').forEach((button) => { button.onclick = () => mfIntakeWork(Number(button.dataset.rpRun)); });
      const scope = () => { const editions = [...new Set(trees.filter((t) => t.subject === $('rpSubject').value && t.stage === $('rpStage').value && t.edition).map((t) => t.edition))]; $('rpEdition').innerHTML = pdOpts(editions, '', editions.length ? '暂不指定' : '该学段学科暂无版本'); };
      $('rpSubject').onchange = scope; $('rpStage').onchange = scope; scope();
      const openRun = () => { if (runId && !busy) mfIntakeWork(runId); };
      $('rpOpenExisting').onclick = openRun;
      const paint = () => {
        $('rpPrepare').hidden = step !== 1; $('rpUpload').hidden = step !== 2; $('rpResult').hidden = step !== 3;
        document.querySelectorAll('.r4-photo .r4-excel-steps [data-step]').forEach((el) => { const n = Number(el.dataset.step); el.classList.toggle('active', n === step); el.classList.toggle('complete', n < step); });
        $('rpPrevious').textContent = step === 2 && !runId ? '上一步' : '返回录题中心';
        $('rpNext').textContent = step === 1 ? (isPdf ? '下一步：选择文件' : '下一步：选择图片') : step === 2 ? (isPdf ? '转换并上传' : '上传图片') : '打开识别工作台';
        $('rpPrevious').disabled = busy; $('rpBack').disabled = busy; $('rpNext').disabled = busy || (step === 2 && (!entries.length || entries.some((f) => f.state === 'uncertain')));
        $('rpOpenExisting').hidden = !runId; $('rpOpenExisting').disabled = busy;
      };
      const fileRows = () => {
        $('rpFiles').innerHTML = entries.length ? entries.map((entry, i) => `<div class="r4-excel-file"><span><strong>${esc(entry.file.name || `截图 ${i + 1}`)}</strong><small>${entry.state === 'success' ? '上传完成' : entry.state === 'uploading' ? `上传中 ${entry.progress}%` : entry.state === 'error' ? '上传失败：' + esc(entry.error) : entry.state === 'uncertain' ? '连接中断，请打开批次确认是否上传成功' : '等待上传'}</small>${entry.state === 'uploading' ? `<progress max="100" value="${entry.progress}"></progress>` : ''}</span>${!busy && ['pending', 'error'].includes(entry.state) ? `<button type="button" class="btn ghost sm" data-rp-remove="${i}">移除</button>` : ''}</div>`).join('') : '<p class="r4-excel-note">尚未选择图片</p>';
      };
      $('rpFiles').onclick = (e) => { const b = e.target.closest('[data-rp-remove]'); if (b && !busy) { entries.splice(Number(b.dataset.rpRemove), 1); fileRows(); paint(); } };
      const addFiles = (files) => {
        if (busy) return;
        const incoming = [...files];
        if (isPdf) {
          if (runId || pdfPrepared) { $('rpMessage').textContent = '已开始处理，请打开已有批次继续，或返回后新建批次。'; return; }
          if (incoming.length !== 1 || !/\.pdf$/i.test(incoming[0].name) || incoming[0].size > 25 * 1024 * 1024) { $('rpMessage').textContent = '请选择一个不超过 25 MB 的 PDF 文件。'; return; }
          entries = [{ file: incoming[0], state: 'pending', progress: 0 }]; pdfName = incoming[0].name; $('rpMessage').textContent = ''; fileRows(); paint(); return;
        }
        if (entries.length + incoming.length > 30 || incoming.some((f) => !(/^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(f.name)) || f.size > 25 * 1024 * 1024)) { $('rpMessage').textContent = '请选择最多 30 张图片，每张不超过 25 MB。'; return; }
        incoming.forEach((file) => entries.push({ file, state: 'pending', progress: 0 })); $('rpMessage').textContent = ''; fileRows(); paint();
      };
      $('rpChoose').onclick = (e) => { e.stopPropagation(); $('rpFile').click(); };
      $('rpDrop').onclick = () => $('rpFile').click();
      $('rpDrop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('rpFile').click(); } };
      $('rpFile').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
      ['dragenter', 'dragover'].forEach((name) => $('rpDrop').addEventListener(name, (e) => { e.preventDefault(); $('rpDrop').classList.add('dragging'); }));
      ['dragleave', 'drop'].forEach((name) => $('rpDrop').addEventListener(name, (e) => { e.preventDefault(); $('rpDrop').classList.remove('dragging'); if (name === 'drop') addFiles(e.dataTransfer.files); }));
      document.querySelector('.r4-photo').addEventListener('paste', (e) => { if (step === 2 && e.clipboardData && e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
      $('rpPrevious').onclick = () => { if (step === 2 && !runId) { step = 1; paint(); } else location.hash = '#/intake'; };
      const send = (entry) => new Promise((resolve) => {
        entry.state = 'uploading'; entry.progress = 0; fileRows();
        const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/admin/bank/mf/intake/runs/${runId}/pages`); xhr.setRequestHeader('Authorization', 'Bearer ' + Auth.token); xhr.responseType = 'json';
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { entry.progress = Math.min(100, Math.round(e.loaded / e.total * 100)); fileRows(); } };
        xhr.onload = () => { const result = xhr.response || {}; entry.state = xhr.status >= 200 && xhr.status < 300 && result.code === 0 ? 'success' : 'error'; entry.error = result.msg || '请检查图片后重试'; fileRows(); resolve(); };
        xhr.onerror = () => { entry.state = 'uncertain'; fileRows(); resolve(); };
        xhr.addEventListener('loadend', () => resolve());
        const fd = new FormData(); fd.append('pages', entry.file, entry.file.name || 'screenshot.png'); R4Flow.watch(xhr, root, mode, entry.file.name, runId); xhr.send(fd);
      });
      $('rpNext').onclick = async () => {
        if (step === 1) { step = 2; paint(); return; }
        if (step === 3) return openRun();
        if (busy || !entries.length) return;
        busy = true; paint(); $('rpMessage').textContent = '';
        try {
          if (isPdf && !pdfPrepared) {
            if (!window.PdfPages) throw new Error('PDF 组件加载失败，请刷新页面后重试');
            const converted = await window.PdfPages.toCanvases(entries[0].file, { maxPages: 30, maxWidth: 1600, onProgress: (done, total) => { if (!root.isConnected) return; $('rpFiles').innerHTML = `<p class="r4-excel-note">正在转换 PDF：${done} / ${total} 页…</p>`; } });
            if (converted.truncated) throw new Error(`PDF 共 ${converted.total} 页，超过 30 页；请先拆分文件再上传。`);
            if (!converted.pages.length) throw new Error('PDF 没有可读取的页面');
            const pageFiles = [];
            for (const page of converted.pages) {
              const blob = await new Promise((resolve) => page.canvas.toBlob(resolve, 'image/png'));
              if (!blob) throw new Error(`第 ${page.page} 页转换失败，请重试`);
              pageFiles.push({ file: new File([blob], `page-${String(page.page).padStart(3, '0')}.png`, { type: 'image/png' }), state: 'pending', progress: 0 });
              page.canvas.width = page.canvas.height = 0;
            }
            if (!root.isConnected) return; entries = pageFiles; pdfPrepared = true; fileRows();
          }
          if (!runId) {
            const result = await api('/api/admin/bank/mf/intake/runs', { method: 'POST', body: { title: $('rpTitle').value.trim() || (isPdf ? pdfName : entries[0].file.name), subject: $('rpSubject').value, stage: $('rpStage').value, grade: $('rpGrade').value, edition: $('rpEdition').value, term: $('rpTerm').value, material_type: $('rpMaterial').value, source_kind: mode, source_name: isPdf ? pdfName : entries[0].file.name }, silent: true });
            runId = result.id;
          }
          for (const entry of entries) { if (!root.isConnected) return; if (entry.state === 'success') continue; await send(entry); if (!root.isConnected) return; if (entry.state !== 'success') break; }
          if (entries.every((entry) => entry.state === 'success')) { step = 3; $('rpResultBody').innerHTML = `<div class="r4-excel-success"><strong>已上传 ${entries.length} ${isPdf ? '页' : '张图片'}</strong><span>页图已保存到批次，可随时返回工作台继续识别。</span></div>`; }
          else $('rpMessage').textContent = entries.some((entry) => entry.state === 'uncertain') ? '连接中断，图片可能已经保存；请打开批次核对后继续。' : '有图片上传失败，可重试，已成功的图片不会重复上传。';
        } catch (err) { if (!root.isConnected) return; $('rpMessage').textContent = err.message || '创建批次失败，请重试'; }
        finally { busy = false; if (root.isConnected) { fileRows(); paint(); } }
      };
      paint();
    },
  };
}
function r4ManualDialog() {
  modal({ title: '手动录题', okText: '保存到待审核', wide: true,
    body: `<p class="pd-tip">先录入题目，保存后可在待审核中继续编辑和分类。 <button type="button" class="btn ghost xs" id="r4-group-open">录入材料和多道小题</button></p><div class="pd-grid">
      <div class="field"><label>学科</label><select class="input" id="r4-sub">${pdOpts(PD_SUBJECTS, '数学')}</select></div>
      <div class="field"><label>学段</label><select class="input" id="r4-stage">${pdOpts(PD_STAGES.slice(1), 'junior')}</select></div>
      <div class="field"><label>年级</label><select class="input" id="r4-grade">${pdOpts(PD_GRADES, '', '未指定')}</select></div>
      <div class="field"><label>题型</label><select class="input" id="r4-type">${pdOpts(PD_TYPES, 'single')}</select></div>
      <div class="field"><label>英语细分题型（选填）</label><select class="input" id="r4-subtype"><option value="">不细分</option></select></div></div>
      <div class="field"><label>题干</label><textarea class="input" id="r4-stem" rows="4" placeholder="输入题目内容"></textarea></div>
      <div class="field" id="r4-match-wrap" hidden><label>匹配左侧项目（每行一项）</label><textarea class="input" id="r4-match" rows="3" placeholder="例如：人物、图片或问题，每行一项"></textarea><small>选项中填写右侧候选项；答案按左侧顺序填写右侧序号，如 2,1,3。保存后在待审核编辑页添加听力音频。</small></div>
      <div class="field"><label>选项，每行一个（非选择题可留空）</label><textarea class="input" id="r4-options" rows="4" placeholder="每行输入一个选项"></textarea></div>
      <div class="field"><label>答案</label><input class="input" id="r4-answer" placeholder="可留空，审核时补充"></div>
      <div class="field"><label>解析</label><textarea class="input" id="r4-analysis" rows="3" placeholder="可留空，审核时补充"></textarea></div>`,
    onMount: (w) => {
      t8Enhance(w, { fields: ['#r4-stem', '#r4-analysis'] });
      const showMatch = () => { w.querySelector('#r4-match-wrap').style.display = QSubtype.isMatch(w.querySelector('#r4-subtype').value) ? '' : 'none'; };
      const update = () => { QSubtype.fillSelect(w.querySelector('#r4-subtype'), w.querySelector('#r4-sub').value, w.querySelector('#r4-type').value); showMatch(); };
      w.querySelector('#r4-sub').addEventListener('change', update); w.querySelector('#r4-type').addEventListener('change', update); update();
      w.querySelector('#r4-subtype').addEventListener('change', showMatch);
      w.querySelector('#r4-group-open').onclick = () => { w.remove(); r4CompoundDialog(); };
    },
    onOk: async (w) => {
      const v = (id) => w.querySelector(id).value.trim();
      if (!v('#r4-stem')) { toast('请填写题干', 'err'); return false; }
      await api('/api/admin/bank/mf/ext/pending/manual', { method: 'POST', body: { subject: v('#r4-sub'), stage: v('#r4-stage'), grade: v('#r4-grade'), type: v('#r4-type'), question_subtype: v('#r4-subtype'), match_prompts: v('#r4-match').split(/\r?\n/).filter(Boolean), stem: v('#r4-stem'), options: v('#r4-options').split(/\r?\n/).filter(Boolean), answer: v('#r4-answer'), analysis: v('#r4-analysis') } });
      toast('已保存到待审核', 'ok'); location.hash = '#/pending';
    },
  });
}

function r4CompoundDialog() {
  let audio = null;
  const questionRow = () => `<section class="r4-group-question"><div class="r4-group-qhead"><strong>小题</strong><button type="button" class="btn ghost xs" data-group-remove>删除小题</button></div>
    <div class="pd-grid"><div class="field"><label>基础题型</label><select class="input" data-group-type>${pdOpts(PD_TYPES, 'single')}</select></div></div>
    <div class="field"><label>小题题干</label><textarea class="input" data-group-stem rows="2"></textarea></div>
    <div class="field"><label>选项（选择题和排序题填写，每行一个）</label><textarea class="input" data-group-options rows="3"></textarea></div>
    <div class="field"><label>答案（可留空，审核时补充）</label><input class="input" data-group-answer placeholder="选择题填 A 或 A,C；排序题填 2,1,3"></div>
    <div class="field"><label>解析（选填）</label><textarea class="input" data-group-analysis rows="2"></textarea></div></section>`;
  modal({ title: '录入组合题', wide: true, okText: '保存小题到待审核',
    body: `<p class="pd-tip">填写一份材料和至少两道小题。每道小题会带上材料，分别审核和作答；后续修改单题材料只影响该题。</p>
      <div class="pd-grid"><div class="field"><label>学科</label><select class="input" id="r4g-sub">${pdOpts(PD_SUBJECTS, '英语')}</select></div>
      <div class="field"><label>学段</label><select class="input" id="r4g-stage">${pdOpts(PD_STAGES.slice(1), 'junior')}</select></div>
      <div class="field"><label>年级</label><select class="input" id="r4g-grade">${pdOpts(PD_GRADES, '', '未指定')}</select></div></div>
      <div class="field"><label>共用材料</label><textarea class="input" id="r4g-material" rows="5" placeholder="输入阅读材料或听力材料说明"></textarea></div>
      <div id="r4g-audio"></div><div id="r4g-questions"></div><button type="button" class="btn ghost sm" id="r4g-add">＋ 添加小题</button>`,
    onMount: (w) => {
      const box = w.querySelector('#r4g-questions');
      const renumber = () => box.querySelectorAll('.r4-group-question').forEach((row, i) => { row.querySelector('strong').textContent = `小题 ${i + 1}`; });
      const add = () => {
        if (box.children.length >= 30) return toast('最多添加 30 道小题', 'err');
        const holder = document.createElement('div'); holder.innerHTML = questionRow(); const row = holder.firstChild; box.appendChild(row);
        t8Enhance(row, { fields: ['[data-group-stem]', '[data-group-analysis]', '[data-group-options]'] });
        renumber();
      };
      box.onclick = (e) => { const b = e.target.closest('[data-group-remove]'); if (!b) return; if (box.children.length <= 2) return toast('至少保留两道小题', 'err'); b.closest('.r4-group-question').remove(); renumber(); };
      w.querySelector('#r4g-add').onclick = add;
      t8Enhance(w, { fields: ['#r4g-material'] });
      audio = t7AudioWidget(w.querySelector('#r4g-audio'), {});
      add(); add();
    },
    onOk: async (w, showErr) => {
      const v = (s) => w.querySelector(s).value.trim();
      const questions = [...w.querySelectorAll('.r4-group-question')].map((row) => ({
        type: row.querySelector('[data-group-type]').value,
        stem: row.querySelector('[data-group-stem]').value.trim(),
        options: row.querySelector('[data-group-options]').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        answer: row.querySelector('[data-group-answer]').value.trim(), analysis: row.querySelector('[data-group-analysis]').value.trim(),
      }));
      if (!v('#r4g-material')) return showErr('请填写组合题材料');
      if (questions.some((q) => !q.stem)) return showErr('请填写每道小题的题干');
      await api('/api/admin/bank/mf/ext/pending/manual-group', { method: 'POST', body: {
        subject: v('#r4g-sub'), stage: v('#r4g-stage'), grade: v('#r4g-grade'), material: v('#r4g-material'),
        audio_key: audio ? audio.get() : '', audio_play_limit: audio ? audio.getLimit() : 0, questions,
      } });
      toast('小题已保存到待审核', 'ok'); location.hash = '#/pending';
    },
  });
}
