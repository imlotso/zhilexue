/* 手机扫码录题：签发短期链接，手机提交后在同一处查看真实批次。 */
async function viewIntakeTeacher() {
  let history = [], historyError = '';
  try { const data = await api('/api/admin/bank/mf/intake/runs', { silent: true }); history = (data.list || []).filter((r) => r.source_kind === 'teacher_scan').slice(0, 12); }
  catch (e) { historyError = e.message || '无法读取录题记录，请稍后重试'; }
  return {
    html: `<div class="r4-intake rt-page">
      <button type="button" class="r4-back" id="rtBack">‹ 返回录题中心</button>
      <div class="r4-intake-head"><div><span class="r4-kicker">录题中心 / 手机录题</span><h2>手机扫码录题</h2><p>用手机拍下习题，回到电脑检查题目和分类后入库。</p></div></div>
      <div class="r4-steps rt-steps" aria-label="手机录题步骤"><div data-rt-step="1"><b>1</b><span><strong>准备</strong><small>选择学科</small></span></div><div data-rt-step="2"><b>2</b><span><strong>扫码录入</strong><small>手机拍照提交</small></span></div><div data-rt-step="3"><b>3</b><span><strong>核对入库</strong><small>在待审核中确认</small></span></div></div>
      <div class="rt-layout"><main>
        <section class="rt-panel" id="rtPrepare"><div class="rt-panel-head"><h3>准备录题</h3><p>手机上还可以选择年级、填写题干或备注。</p></div>
          <label class="rt-label" for="rtSubject">预选学科 <span>（可选）</span></label><select id="rtSubject" class="input"><option value="">到手机上选择</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option></select>
          <div class="rt-guide"><strong>拍照建议</strong><p>一次对准一道题，保持画面清晰；跨页题可连续添加多张照片。提交后还可以在待审核中补充和修改。</p></div>
          <div class="rt-actions"><button type="button" class="btn primary" id="rtCreate">生成二维码</button></div><p class="rt-error" id="rtCreateError" role="alert" hidden></p>
        </section>
        <section class="rt-panel" id="rtScan" hidden><div class="rt-panel-head"><h3>扫码录入</h3><p>打开手机相机扫描二维码，选择年级并拍照提交。</p></div>
          <div class="rt-code-wrap"><div id="rtCode" class="rt-code" aria-label="手机录题二维码"></div><div class="rt-code-text"><strong id="rtTimer" aria-live="polite"></strong><p>二维码供本次录题使用，请勿转发给他人。</p><p id="rtLocalWarning" class="rt-warning" hidden>当前地址可能只能在本机访问，手机扫码前请使用手机可访问的系统地址。</p><div class="rt-code-buttons"><button type="button" class="btn ghost sm" id="rtCopy">复制录题链接</button><button type="button" class="btn ghost sm" id="rtOpen">在本设备打开</button><button type="button" class="btn ghost sm" id="rtRenew">重新生成</button></div><p class="rt-error" id="rtScanError" role="alert" hidden></p></div></div>
          <div class="rt-actions"><button type="button" class="btn ghost" id="rtChange">上一步</button><button type="button" class="btn primary" id="rtSubmitted">我已提交，查看记录</button></div>
        </section>
        <section class="rt-panel" id="rtReview" hidden><div class="rt-panel-head"><h3>核对入库</h3><p>手机提交的题目保存在待审核中，检查题干、答案和分类后再入库。</p></div><div class="rt-review-note">每次手机提交都会形成一条录题记录。若刚提交后还没看到，请刷新下方记录。</div><div class="rt-actions"><button type="button" class="btn ghost" id="rtAgain">继续扫码录题</button><button type="button" class="btn primary" id="rtPending">查看待审核</button></div></section>
      </main><aside class="rt-history"><div class="rt-history-head"><div><h3>最近手机录题</h3><p>显示最近的手机扫码批次</p></div><button type="button" class="btn ghost sm" id="rtRefresh">刷新</button></div><div id="rtHistory" aria-live="polite"></div></aside></div>
    </div>`,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const root = document.querySelector('.rt-page'); R4Flow.bind(root, 'teacher');
      const scope = R4Flow.scope(root, 'teacher', $('rtPrepare'), {subject:'rtSubject'});
      let step = 1, url = '', expiresAt = 0, timer = null, busy = false;
      const parseDrafts = (v) => { try { const a = Array.isArray(v) ? v : JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
      const openReview = (batchId) => { const state = ADM.page.pd = ADM.page.pd || { sel: {} }; state.source = 'teacher_scan'; state.kw = ''; state.batch_id = Number(batchId) || 0; state.review = 'all'; state.sel = {}; ADM.page.pdPage = 1; location.hash = '#/pending'; };
      const drawHistory = () => {
        const el = $('rtHistory'); if (!el) return;
        if (historyError) { el.innerHTML = `<p class="rt-error">${esc(historyError)}</p>`; return; }
        if (!history.length) { el.innerHTML = '<div class="rt-empty">暂无手机录题记录</div>'; return; }
        el.innerHTML = `<div class="rt-history-list">${history.map((r) => { const cards = parseDrafts(r.drafts); const left = cards.filter((c) => c && !c.committed).length; const processed = r.status === 'done' || (cards.length && !left); const bad = r.status === 'error'; return `<div class="rt-history-row"><div><strong>${esc(r.subject || '未指定学科')}${r.grade ? ' · ' + esc(r.grade) : ''}</strong><small>${esc(r.created_at || '')} · ${Number(r.draft_count) || cards.length || 0} 题</small>${bad && r.error ? `<small class="rt-error">${esc(r.error)}</small>` : ''}</div><span class="rt-history-status ${bad ? 'error' : processed ? 'done' : ''}">${r.processing ? '正在识别' : bad ? '处理异常' : processed ? '已处理' : '待审核'}</span>${processed ? '' : `<button type="button" class="btn ghost sm" data-rt-history="${Number(r.id)}">核对</button>`}</div>`; }).join('')}</div>`;
      };
      const refreshHistory = async () => {
        $('rtRefresh').disabled = true;
        try { const data = await api('/api/admin/bank/mf/intake/runs', { silent: true }); history = (data.list || []).filter((r) => r.source_kind === 'teacher_scan').slice(0, 12); historyError = ''; }
        catch (e) { historyError = e.message || '无法读取录题记录，请稍后重试'; }
        finally { if (root.isConnected) { $('rtRefresh').disabled = false; drawHistory(); } }
      };
      const showStep = (n) => {
        step = n; $('rtPrepare').hidden = n !== 1; $('rtScan').hidden = n !== 2; $('rtReview').hidden = n !== 3;
        root.querySelectorAll('[data-rt-step]').forEach((el) => { const i = Number(el.dataset.rtStep); el.classList.toggle('active', i === n); el.classList.toggle('complete', i < n); if (i === n) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
      };
      const tick = () => {
        if (!root.isConnected) { clearInterval(timer); timer = null; return; }
        const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        $('rtTimer').textContent = seconds ? `二维码有效期 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '二维码已过期，请重新生成';
        $('rtCopy').disabled = $('rtOpen').disabled = !seconds || !url;
        $('rtCode').classList.toggle('expired', !seconds);
        if (!seconds && timer) { clearInterval(timer); timer = null; }
      };
      const generate = async () => {
        if (busy) return; busy = true;
        const btn = step === 1 ? $('rtCreate') : $('rtRenew'), error = step === 1 ? $('rtCreateError') : $('rtScanError');
        btn.disabled = true; error.hidden = true;
        try {
          const data = await api('/api/admin/bank/teacher-upload-token', { method: 'POST', body:scope(), silent: true });
          if (!data || !data.token || !/^\/(?!\/)/.test(String(data.url || ''))) throw new Error('无法生成录题链接，请重试');
          const link = new URL(data.url, location.origin);
          if (link.origin !== location.origin) throw new Error('录题链接地址无效，请重试');
          link.searchParams.set('t', data.token); if ($('rtSubject').value) link.searchParams.set('subject', $('rtSubject').value);
          const ttl = Number(data.expires_in); url = link.href; expiresAt = Date.now() + (Number.isFinite(ttl) ? Math.max(0, ttl) : 1800) * 1000;
          const code = $('rtCode'); code.innerHTML = '';
          if (window.QRCode) new QRCode(code, { text: url, width: 204, height: 204, correctLevel: QRCode.CorrectLevel.M });
          else code.textContent = '二维码未能加载，请使用录题链接。';
          $('rtLocalWarning').hidden = !/^(localhost|127(?:\.\d+){3}|\[::1\])$/i.test(location.hostname);
          if (timer) clearInterval(timer); showStep(2); tick(); timer = setInterval(tick, 1000);
        } catch (e) { error.textContent = e.message || '生成二维码失败，请重试'; error.hidden = false; }
        finally { busy = false; if (root.isConnected) btn.disabled = false; }
      };
      $('rtBack').onclick = () => { location.hash = '#/intake'; };
      $('rtCreate').onclick = generate; $('rtRenew').onclick = generate;
      $('rtChange').onclick = () => showStep(1); $('rtAgain').onclick = () => { showStep(2); tick(); };
      $('rtSubmitted').onclick = () => { showStep(3); refreshHistory(); };
      $('rtPending').onclick = () => openReview(0); $('rtRefresh').onclick = refreshHistory;
      $('rtHistory').onclick = (event) => { const button = event.target.closest('[data-rt-history]'); if (button) openReview(button.dataset.rtHistory); };
      $('rtCopy').onclick = async () => {
        if (!url || Date.now() >= expiresAt) return tick();
        try { await navigator.clipboard.writeText(url); toast('录题链接已复制', 'ok'); }
        catch (_) { $('rtScanError').textContent = '复制失败，请使用二维码或在本设备打开。'; $('rtScanError').hidden = false; }
      };
      $('rtOpen').onclick = () => { if (url && Date.now() < expiresAt) window.open(url, '_blank', 'noopener,noreferrer'); else tick(); };
      R4Flow.prepare(root, 'teacher', ['rtSubject']); drawHistory(); showStep(1);
    },
  };
}
