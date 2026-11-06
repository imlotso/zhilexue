/* 录题中心：AI 转写包导入。成功批次统一进入待审核。 */
async function viewIntakeSkill() {
  const response = await api('/api/admin/bank/mf/intake/runs', { silent: true }).catch(() => ({ list: [] }));
  const runs = (response.list || []).filter((r) => r.source_kind === 'skill').slice(0, 8);
  const label = { draft: '待处理', recognized: '待核对', done: '已处理', error: '处理失败' };
  const prompts = {
    paper: '请把我提供的整卷逐题转写成 JSON 题目包。',
    image: '请把我提供的单题截图转写成 JSON 题目包。',
    web: '请根据我提供的网页内容逐题转写成 JSON 题目包。',
  };
  const promptGuide = '保留题干、选项、答案、解析、图片位置和公式，原文没有的答案或解析留空，不要编造。输出 questions 数组，每题包含 problem_text、options、answer、analysis、knowledge_points、difficulty_score_10。英语题目在 question_type 中保留原题型名称；共用材料和多个小题时，用一个对象包含 material（原文）和 children（小题数组），每个小题单独保留 problem_text、options、answer、analysis 和 question_type。听力音频由老师在待审核时上传。';
  return {
    html: `<div class="r4-intake r4-skill" id="rsPage">
      <button type="button" class="r4-back" id="rsBack">‹ 返回录题中心</button>
      <div class="r4-intake-head"><div><span class="r4-kicker">录题中心</span><h2>JSON / 技能包导入</h2><p>准备 AI 转写结果，导入后核对题目和分类。</p></div><button type="button" class="btn ghost" id="rsHelp">使用说明</button></div>
      <div class="r4-steps r4-skill-steps" aria-label="导入步骤"><div data-rs-step="1"><b>1</b><span><strong>准备资料</strong><small>获取技能包或提示词</small></span></div><div data-rs-step="2"><b>2</b><span><strong>上传或粘贴</strong><small>提交题目包</small></span></div><div data-rs-step="3"><b>3</b><span><strong>核对入库</strong><small>查看处理结果</small></span></div></div>
      <div class="r4-skill-layout"><main>
        <section class="r4-skill-panel" id="rsPrepare"><h3>准备题目包</h3><p>将原卷、截图或网页内容交给 AI 助手转写；已有 JSON 或 ZIP 题目包可直接进入下一步。</p>
          <div class="r4-skill-guide"><div><strong>下载转写技能包</strong><p>包含转写说明、数据格式和英语材料题示例。按包内说明交给 AI 助手使用。</p></div><button type="button" class="btn ghost sm" id="rsDownload">下载技能包</button></div>
          <div class="r4-skill-guide"><div><strong>复制提示词</strong><p>选择资料类型，把提示词和材料一起交给 AI 助手。</p><div class="r4-skill-prompt-actions"><button type="button" class="btn ghost sm" data-rs-prompt="paper">整卷</button><button type="button" class="btn ghost sm" data-rs-prompt="image">单题截图</button><button type="button" class="btn ghost sm" data-rs-prompt="web">网页</button></div></div></div>
          <p class="r4-skill-note">缺失的答案和解析应留空；听力音频和题目分类可在待审核时补充。</p>
        </section>
        <section class="r4-skill-panel" id="rsUpload" hidden><h3>上传或粘贴题目包</h3><p>支持 JSON、ZIP，单个文件不超过 60 MB。含本地图片的转写结果请按技能包说明打包成 ZIP。</p>
          <div class="r4-skill-mode" role="group" aria-label="选择导入方式"><button type="button" class="btn sm primary" id="rsModeFile" aria-pressed="true">上传文件</button><button type="button" class="btn ghost sm" id="rsModeText" aria-pressed="false">粘贴 JSON</button></div>
          <div id="rsFileMode"><input id="rsFile" type="file" accept=".json,.zip,application/json,application/zip" hidden><div class="r4-skill-drop" id="rsDrop" role="button" tabindex="0" aria-label="选择或拖放 JSON 或 ZIP 文件"><span class="r4-skill-upload-icon">${ic('upload')}</span><strong>拖放文件到这里，或点击选择文件</strong><span>也可以粘贴剪贴板中的文件</span><button type="button" class="btn ghost sm" id="rsChoose">选择文件</button></div><div class="r4-skill-file" id="rsFileStatus" aria-live="polite">尚未选择文件</div></div>
          <div id="rsTextMode" hidden><label for="rsText">JSON 内容</label><textarea class="input" id="rsText" rows="10" placeholder='粘贴 AI 返回的 JSON，例如 {"questions":[{"problem_text":"题干"}]}'></textarea><p class="r4-skill-note">只粘贴 JSON 内容；不要包含代码围栏或解释文字。</p></div>
          <div class="r4-skill-message" id="rsMessage" role="status" aria-live="polite"></div>
          <button type="button" class="btn ghost sm" id="rsAbort" hidden>中止等待</button>
        </section>
        <section class="r4-skill-panel" id="rsResult" hidden><h3>处理结果</h3><p>成功接收的题目已进入待审核，核对后才能入库。</p><div id="rsResultBody" aria-live="polite"></div><button type="button" class="btn ghost sm" id="rsAgain">继续导入其他题目包</button></section>
        <div class="r4-skill-actions"><button type="button" class="btn ghost" id="rsPrevious">取消</button><button type="button" class="btn primary" id="rsNext">下一步：上传或粘贴</button></div>
      </main><aside><div class="r4-history"><h3>最近技能包批次</h3><p>可随时回到待审核继续处理。</p>${runs.length ? `<div class="r4-history-list">${runs.map((r) => `<div class="r4-history-row"><span><strong>${esc(r.source_name || r.title)}</strong><small>${Number(r.draft_count) || 0} 题 · ${esc(label[r.status] || r.status)} · ${esc(r.created_at || '')}</small></span><button type="button" class="btn ghost sm" data-rs-history="${Number(r.id)}">查看</button></div>`).join('')}</div>` : '<div class="r4-empty">暂无技能包导入记录</div>'}</div></aside></div>
    </div>`,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const root = $('rsPage'); R4Flow.bind(root, 'skill');
      let step = 1, mode = 'file', file = null, busy = false, uncertain = false, xhr = null, lastResult = null;
      const alive = () => document.contains(root);
      const openReview = (id) => { const st = ADM.page.pd = ADM.page.pd || { sel: {} }; st.source = 'skill'; st.kw = ''; st.batch_id = Number(id) || 0; st.review = 'all'; st.sel = {}; ADM.page.pdPage = 1; location.hash = '#/pending'; };
      $('rsBack').onclick = () => { location.hash = '#/intake'; };
      $('rsHelp').onclick = () => modal({ title: '如何使用技能包导入', body: '<p>下载技能包后按其中说明使用 AI 助手转写；也可复制提示词自行生成题目包。将结果保存为 JSON 或 ZIP，或者直接粘贴 JSON。导入后请检查处理结果，再到待审核核对题干、答案、图片与分类。</p><p>答案、解析在原文中缺失时应留空。听力音频可在待审核中上传。</p>' });
      $('rsDownload').onclick = async () => {
        try {
          const r = await fetch('/api/admin/bank/mf/import-skill', { headers: { Authorization: 'Bearer ' + Auth.token } });
          if (!r.ok || !(r.headers.get('content-type') || '').includes('zip')) {
            let msg = '技能包下载失败'; try { msg = (await r.json()).msg || msg; } catch (_) {} throw new Error(msg);
          }
          const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'zhilexue-question-transcribe.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
          toast('技能包已开始下载', 'ok');
        } catch (e) { toast(e.message || '下载失败', 'err'); }
      };
      root.querySelectorAll('[data-rs-prompt]').forEach((button) => { button.onclick = async () => {
        const value = prompts[button.dataset.rsPrompt] + promptGuide;
        try { await navigator.clipboard.writeText(value); toast('提示词已复制', 'ok'); }
        catch (_) { modal({ title: '复制提示词', body: `<p>请手动复制下面的内容：</p><textarea class="input" rows="7" readonly>${esc(value)}</textarea>`, onMount: (w) => { const el = w.querySelector('textarea'); el.focus(); el.select(); } }); }
      }; });
      root.querySelectorAll('[data-rs-history]').forEach((b) => { b.onclick = () => openReview(b.dataset.rsHistory); });
      const message = (text) => { $('rsMessage').textContent = text || ''; };
      const paint = () => {
        $('rsPrepare').hidden = step !== 1; $('rsUpload').hidden = step !== 2; $('rsResult').hidden = step !== 3;
        root.querySelectorAll('[data-rs-step]').forEach((el) => { const n = Number(el.dataset.rsStep); el.classList.toggle('active', n === step); el.classList.toggle('complete', n < step); });
        $('rsPrevious').textContent = step === 1 ? '取消' : step === 2 ? '上一步' : '返回录题中心';
        $('rsNext').textContent = step === 1 ? '下一步：上传或粘贴' : step === 2 ? '上传并解析' : '去核对题目';
        $('rsPrevious').disabled = busy;
        $('rsNext').disabled = busy || uncertain || (step === 2 && !(mode === 'file' ? file : $('rsText').value.trim())) || (step === 3 && !(lastResult && lastResult.run_id));
        $('rsModeFile').disabled = busy; $('rsModeText').disabled = busy; $('rsAbort').hidden = !busy;
      };
      const setMode = (next) => {
        if (busy) return; mode = next; $('rsFileMode').hidden = mode !== 'file'; $('rsTextMode').hidden = mode !== 'text';
        $('rsModeFile').className = mode === 'file' ? 'btn sm primary' : 'btn ghost sm'; $('rsModeText').className = mode === 'text' ? 'btn sm primary' : 'btn ghost sm';
        $('rsModeFile').setAttribute('aria-pressed', String(mode === 'file')); $('rsModeText').setAttribute('aria-pressed', String(mode === 'text')); message(''); paint();
      };
      const setFile = (next) => {
        if (busy || !next) return;
        if (!/\.(json|zip)$/i.test(next.name) || next.size > 60 * 1024 * 1024) { file = null; $('rsFile').value = ''; $('rsFileStatus').textContent = '尚未选择文件'; message('请选择不超过 60 MB 的 JSON 或 ZIP 文件。'); paint(); return; }
        file = next; message('');
        $('rsFileStatus').innerHTML = `<span><strong>${esc(file.name)}</strong><small>${(file.size / 1024 / 1024).toFixed(2)} MB · 待上传</small></span><button type="button" class="btn ghost sm" id="rsClear">移除</button>`;
        $('rsClear').onclick = () => { file = null; $('rsFile').value = ''; $('rsFileStatus').textContent = '尚未选择文件'; paint(); };
        setMode('file');
      };
      $('rsModeFile').onclick = () => setMode('file'); $('rsModeText').onclick = () => setMode('text');
      const textDraft = R4Flow.read('skill-text'); if (textDraft && typeof textDraft.text === 'string') $('rsText').value = textDraft.text;
      $('rsText').oninput = () => { R4Flow.save('skill-text', { text: $('rsText').value }); message(''); paint(); };
      $('rsChoose').onclick = (e) => { e.stopPropagation(); $('rsFile').click(); };
      $('rsDrop').onclick = () => $('rsFile').click();
      $('rsDrop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('rsFile').click(); } };
      $('rsFile').onchange = (e) => { setFile(e.target.files[0]); };
      ['dragenter', 'dragover'].forEach((name) => $('rsDrop').addEventListener(name, (e) => { e.preventDefault(); $('rsDrop').classList.add('dragging'); }));
      ['dragleave', 'drop'].forEach((name) => $('rsDrop').addEventListener(name, (e) => { e.preventDefault(); $('rsDrop').classList.remove('dragging'); if (name === 'drop') setFile(e.dataTransfer.files[0]); }));
      root.addEventListener('paste', (e) => { const f = e.clipboardData && e.clipboardData.files[0]; if (step === 2 && f) { e.preventDefault(); setFile(f); } });
      $('rsPrevious').onclick = () => { if (step === 2) { step = 1; paint(); } else location.hash = '#/intake'; };
      $('rsAgain').onclick = () => { file = null; lastResult = null; $('rsFile').value = ''; $('rsFileStatus').textContent = '尚未选择文件'; $('rsText').value = ''; step = 2; setMode('file'); };
      $('rsAbort').onclick = () => { if (xhr) xhr.abort(); };
      $('rsNext').onclick = () => {
        if (step === 1) { step = 2; paint(); return; }
        if (step === 3) { if (lastResult && lastResult.run_id) openReview(lastResult.run_id); return; }
        if (busy || uncertain) return;
        let selected = file;
        if (mode === 'text') {
          const raw = $('rsText').value.trim(); if (!raw) { message('请先粘贴 JSON 内容。'); return; }
          try { JSON.parse(raw); } catch (e) { message('JSON 格式不正确：' + e.message); return; }
          selected = new File([raw], 'questions.json', { type: 'application/json' });
        }
        if (!selected) { message('请先选择文件或粘贴 JSON。'); return; }
        if (selected.size > 60 * 1024 * 1024) { message('内容超过 60 MB，请拆分后导入。'); return; }
        busy = true; message('正在上传…'); paint();
        const fd = new FormData(); fd.append('file', selected);
        xhr = new XMLHttpRequest(); xhr.open('POST', '/api/admin/bank/mf/import-pack'); xhr.setRequestHeader('Authorization', 'Bearer ' + Auth.token); xhr.responseType = 'json';
        xhr.upload.onprogress = (e) => { if (!alive() || !e.lengthComputable) return; const n = Math.min(100, Math.round(e.loaded / e.total * 100)); message(n === 100 ? '上传完成，正在解析和保存…' : `正在上传… ${n}%`); };
        xhr.onload = () => {
          if (!alive()) return;
          busy = false; const status = xhr.status; const result = xhr.response || {}; xhr = null;
          if (status < 200 || status >= 300 || result.code !== 0) { message(result.msg || `导入失败（HTTP ${status || '异常'}），请检查内容后重试。`); paint(); return; }
          const d = result.data || {}; R4Flow.clear('skill-text'); lastResult = { run_id: Number(d.run_id) || 0 }; step = 3;
          const errors = Array.isArray(d.errors) ? d.errors : [], warnings = Array.isArray(d.warnings) ? d.warnings : [];
          const staged = Number(d.staged) || 0, failed = Number(d.failed) || 0, skipped = Number(d.skipped) || 0, updated = Number(d.updated) || 0;
          $('rsResultBody').innerHTML = `<div class="r4-skill-success"><strong>${staged ? `已接收 ${staged} 道题，等待核对` : '没有新的题目进入待审核'}</strong><span>共 ${Number(d.total) || 0} 道 · 跳过 ${skipped} 道 · 失败 ${failed} 道${updated ? ` · 已有题目补图 ${updated} 道` : ''}</span></div>${errors.length ? `<div class="r4-skill-errors"><b>未导入的题目</b>${errors.map((e) => `<p>${esc((e.recordKey ? e.recordKey + '：' : '') + (e.msg || '处理失败'))}</p>`).join('')}${failed > errors.length ? '<p>其余错误请检查原始题目包。</p>' : ''}</div>` : ''}${warnings.length ? `<div class="r4-skill-warnings"><b>需要留意</b>${warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}`;
          paint();
        };
        xhr.onerror = () => { if (!alive()) return; busy = false; uncertain = true; xhr = null; message('连接中断，题目包可能已处理。请先返回录题中心检查最近批次，再决定是否重新上传。'); paint(); };
        xhr.onabort = () => { if (!alive()) return; busy = false; uncertain = true; xhr = null; message('已中止等待，服务器可能仍在处理。请先返回录题中心检查最近批次，再决定是否重新上传。'); paint(); };
        R4Flow.watch(xhr, root, 'skill', selected.name); xhr.send(fd);
      };
      paint();
    },
  };
}
