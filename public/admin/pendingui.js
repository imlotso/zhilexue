/* 待审核题目（T3）：各入口（Excel / Word / 拍照识别 / 技能包 / 网络采集 / 手机扫码）入库前的题目统一在这里，
 * 逐题看、改、入库。数据来自 mfpending.js 的 /ext/pending 系列接口。
 * 由 admin.js 的 VIEWS.pending 调用；依赖 admin.js 的 ADM / modal / esc / ic / render / pagerHTML / bindPager，
 * api.js 的 api / toast / elConfirm，mathlib.js 的 mtxTypeset。
 */
const PD_API = '/api/admin/bank/mf';
const PD_SRC = [['all', '全部'], ['photo', '拍照识别'], ['word', 'Word导入'], ['excel', 'Excel导入'], ['skill', '技能包'], ['capture', '网络采集'], ['scan', '手机扫码（错题）']];
const PD_TYPES = [['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'], ['fill', '填空题'], ['sort', '排序题'], ['answer', '解答题']];
const PD_STAGES = [['', '未识别'], ['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const PD_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const PD_GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const pdStageName = (k) => (PD_STAGES.find((s) => s[0] === k) || [])[1] || '';
const pdOpts = (list, cur, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : '')
  + list.map((x) => { const v = Array.isArray(x) ? x[0] : x; const t = Array.isArray(x) ? x[1] : x; return `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
const pdBr = (s) => esc(s).replace(/\n/g, '<br>');

/** Word 导入的格式要求（客户《word (1).docx》原意） */
const PD_WORD_RULES = `
  <div class="pd-rules">
    <p><b>通用</b>：每道题要有序号（<code>1.</code> <code>2.</code> <code>3、</code>）；选项用 <code>A.</code> 或 <code>A、</code>（不能用（A）、【A】、A)，可在 Word 里用 Ctrl+F 批量替换）；四个选项可放一行，但之间要隔开一段距离；<b>答案、解析都要另起一行</b>，无解析可不写。</p>
    <p><b>单选 / 多选</b>：答案写选项字母，多选 2 个及以上（如 <code>答案：CD</code>）。<b>判断</b>：答案 对/错、正确/错误、正/误。</p>
    <p><b>填空</b>：空用 <code>_______</code> 或括号（），<b>一个空一个答案，答案另起一行、用「；」隔开</b>（<code>答案：Does；often；fishing</code>）。</p>
    <p><b>问答</b>：计算题、简答题、论述题一概写成问答题。有多个小问时，小问号用（1）（2），整题放在 <code>[问答题]</code> 和 <code>[问答题结束]</code> 之间。</p>
    <p>题型可以用小节标题（<code>单选题</code>、<code>多选题</code>…）或题号后的括号（<code>1.（单选题）…</code>）标明，每个小节题号可以从 1 重新开始。导入后每道题都会先进待审核，不会直接入库。</p>
  </div>`;

async function viewPending() {
  const st = ADM.page.pd = ADM.page.pd || { source: 'all', kw: '', sel: {} };
  const page = Math.max(1, Number(ADM.page.pdPage) || 1);
  const size = Number(ADM.page.pdPageSize) || 20;
  const qs = `source=${encodeURIComponent(st.source)}&page=${page}&size=${size}${st.kw ? '&kw=' + encodeURIComponent(st.kw) : ''}`;
  const data = await api(`${PD_API}/ext/pending?${qs}`);
  ADM.page.pdPage = data.page;
  const list = data.list || [];
  const counts = data.counts || {};
  const byId = {};
  list.forEach((it) => { byId[it.id] = it; });
  Object.keys(st.sel).forEach((id) => { if (!byId[id]) delete st.sel[id]; });   // 不在当前页的选择自动取消（换页/过滤/处理后）
  const selIds = () => Object.keys(st.sel).filter((id) => st.sel[id]);

  const itemHTML = (it) => {
    const miss = [];
    if (!it.subject) miss.push('未识别学科');
    return `<div class="pd-item" data-id="${esc(it.id)}">
      <label class="pd-chk"><input type="checkbox" data-sel="${esc(it.id)}" ${st.sel[it.id] ? 'checked' : ''}></label>
      <div class="pd-main">
        <div class="pd-meta">
          <span class="pd-tag pd-src-${esc(it.source)}">${esc(it.source_label)}</span>
          <span class="pd-type">${esc(it.type_name)}</span>
          ${it.subject ? `<span class="pd-cls">${esc(it.subject)}${it.stage ? ' · ' + esc(pdStageName(it.stage)) : ''}${it.grade ? ' · ' + esc(it.grade) : ''}</span>` : ''}
          ${it.difficulty ? `<span class="pd-cls">难度 ${it.difficulty}</span>` : ''}
          ${it.point ? `<span class="pd-cls" title="知识点">📌 ${esc(it.point)}</span>` : ''}
          ${(it.tags || []).slice(0, 4).map((t) => `<span class="pd-cls">#${esc(t)}</span>`).join('')}
          ${miss.map((m) => `<span class="pd-warn">${esc(m)}</span>`).join('')}
          <span class="pd-batch" title="来自哪个批次">${esc(it.batch_title || '')}</span>
        </div>
        ${it.material ? `<div class="pd-mat">${pdBr(it.material)}</div>` : ''}
        <div class="pd-stem">${pdBr(it.stem)}</div>
        ${(it.options || []).length ? `<ol class="pd-opts">${it.options.map((o, i) => `<li><b>${esc(optLabel(o, i))}.</b> ${esc(optText(o))}</li>`).join('')}</ol>` : ''}
        ${(it.images || []).length ? `<div class="pd-imgs">${it.images.slice(0, 6).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="题图" loading="lazy"></a>`).join('')}</div>` : ''}
        <div class="pd-ans"><b>答案：</b>${it.answer ? pdBr(it.answer) : '<span class="pd-warn">未填</span>'}${it.analysis ? `<div class="pd-ana"><b>解析：</b>${pdBr(it.analysis)}</div>` : ''}</div>
      </div>
      <div class="pd-acts">
        <button type="button" class="btn sm primary" data-act="commit">入库</button>
        <button type="button" class="btn sm ghost" data-act="edit">编辑</button>
        <button type="button" class="btn sm ghost danger" data-act="del">删除</button>
      </div>
    </div>`;
  };

  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('doc')} 待审核题目</h3></div>
    <p class="pd-tip">Excel、Word、拍照识别、技能包、网络采集、手机扫码——各种方式录入的题目都先到这里，每道题标着来源。逐题看过、改好再点「入库」，入库后才会出现在题库管理里。</p>
    <div class="pd-bar">
      <button type="button" class="btn sm" id="pd-excel">${ic('upload')} 导入 Excel</button>
      <button type="button" class="btn sm" id="pd-word">${ic('upload')} 导入 Word</button>
      <span class="sp"></span>
      <input class="input pd-kw" id="pd-kw" placeholder="搜索题干 / 批次 / 知识点" value="${esc(st.kw)}">
    </div>
    <div class="pd-tabs">${PD_SRC.map(([k, t]) => `<a class="pd-tab ${st.source === k ? 'on' : ''}" data-src="${k}">${esc(t)}<em>${counts[k] || 0}</em></a>`).join('')}</div>
    <div class="pd-batchbar">
      <label><input type="checkbox" id="pd-all"> 全选本页</label>
      <span class="pd-selcnt" id="pd-selcnt">已选 0 题</span>
      <button type="button" class="btn sm primary" id="pd-bcommit">批量入库</button>
      <button type="button" class="btn sm ghost" id="pd-bai" title="对选中的拍照识别 / Word / Excel / 技能包题目，用 AI 补全缺的答案、解析，并建议章节、知识点、难度">✨ AI 补全答案/分类</button>
      <button type="button" class="btn sm ghost danger" id="pd-bdel">批量删除</button>
    </div>
    <div class="pd-list" id="pd-list">${list.length ? list.map(itemHTML).join('') : `<div class="empty"><div class="e-ic">🎉</div>${st.kw ? '没有符合搜索条件的题目' : '没有待审核的题目'}<div style="margin-top:8px;color:#97a3b8">可以用上面的「导入 Excel / 导入 Word」，或者到「录题上传」「网络采集」里录入</div></div>`}</div>
    ${pagerHTML(data.page, data.size, data.total, 'pdPage')}
  </div>`;

  return {
    html,
    after: () => {
      const $ = (id) => document.getElementById(id);
      const paintSel = () => {
        const n = selIds().length;
        $('pd-selcnt').textContent = `已选 ${n} 题`;
        $('pd-all').checked = list.length > 0 && n === list.length;
      };
      paintSel();
      mtxTypeset($('pd-list'));
      bindPager('pdPage');
      document.querySelectorAll('.pd-tab').forEach((a) => a.onclick = () => { st.source = a.dataset.src; st.sel = {}; ADM.page.pdPage = 1; render(); });
      let kwTimer = 0;
      $('pd-kw').oninput = (e) => { clearTimeout(kwTimer); kwTimer = setTimeout(() => { st.kw = e.target.value.trim(); ADM.page.pdPage = 1; render(); }, 500); };
      $('pd-all').onchange = (e) => { list.forEach((it) => { st.sel[it.id] = e.target.checked; }); document.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; }); paintSel(); };
      $('pd-list').onchange = (e) => { const c = e.target.closest('[data-sel]'); if (c) { st.sel[c.dataset.sel] = c.checked; paintSel(); } };

      // 单题操作
      $('pd-list').onclick = async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const it = byId[b.closest('.pd-item').dataset.id];
        if (!it) return;
        if (b.dataset.act === 'edit') return pdEdit(it);
        if (b.dataset.act === 'commit') return pdBatchCommit([it.id], byId);   // R0-B8：单题入库也弹分类框（和批量入库同一个弹窗）
        if (b.dataset.act === 'del') {
          const ok = await elConfirm({ title: '删除这道题', danger: true, okText: '删除', message: it.source === 'scan' ? '这是学生扫码上传的题，删除会同时从该学生的错题本里删掉这道题。确定删除吗？' : '删除后不能恢复。确定删除这道题吗？' });
          if (ok) pdDelete([it.id]);
        }
      };

      // 批量操作
      $('pd-bcommit').onclick = () => { const ids = selIds(); if (!ids.length) return toast('请先勾选要入库的题目', 'err'); pdBatchCommit(ids, byId); };
      $('pd-bdel').onclick = async () => {
        const ids = selIds(); if (!ids.length) return toast('请先勾选要删除的题目', 'err');
        const hasScan = ids.some((id) => (byId[id] || {}).source === 'scan');
        const ok = await elConfirm({ title: '批量删除', danger: true, okText: '删除', message: `确定删除选中的 ${ids.length} 道题？${hasScan ? '其中手机扫码的题会同时从学生错题本里删除。' : ''}删除后不能恢复。` });
        if (ok) pdDelete(ids);
      };
      $('pd-bai').onclick = () => pdAiFill(selIds(), byId);
      $('pd-excel').onclick = () => pdImportDialog('excel');
      $('pd-word').onclick = () => pdImportDialog('word');
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
  const treeOpts = (kind) => trees.filter((t) => t.kind === kind).map((t) => [t.id, `${treeLabel(t)}（${t.subject || '不限学科'}）`]);
  modal({
    title: one ? '入库这道题' : `批量入库（${items.length} 题）`, okText: '入库', wide: false,
    body: `<p class="pd-tip" style="margin-top:0">来源：${esc([...new Set(items.map((i) => i.source_label))].join('、'))}。${one ? '确认学科、学段、年级和归属的章节 / 知识点后入库；学科和学段必须有。' : '下面不填就沿用每道题自己的学科/学段/年级，题目自己没有学科或学段的必须在这里选。'}</p>
      <div class="pd-grid">
        <div class="field"><label>学科${one ? '' : '（统一改）'}${star('subject')}</label><select id="pdB-sub" class="input">${pdOpts(PD_SUBJECTS, same('subject'), lackLabel('subject'))}</select></div>
        <div class="field"><label>学段${star('stage')}</label><select id="pdB-stage" class="input">${pdOpts(PD_STAGES.slice(1), same('stage'), lackLabel('stage'))}</select></div>
        <div class="field"><label>年级</label><select id="pdB-grade" class="input">${pdOpts(PD_GRADES, same('grade'), '沿用各题')}</select></div>
      </div>
      <div class="field"><label>挂到知识点树节点（可选）</label>
        <select id="pdB-ktree" class="input">${pdOpts(treeOpts('knowledge'), '', '不挂')}</select>
        <select id="pdB-knode" class="input" style="margin-top:6px" disabled><option value="">先选知识点树</option></select></div>
      <div class="field"><label>挂到章节树节点（可选）</label>
        <select id="pdB-ctree" class="input">${pdOpts(treeOpts('textbook'), '', '不挂')}</select>
        <select id="pdB-cnode" class="input" style="margin-top:6px" disabled><option value="">先选章节树</option></select></div>
      <div class="field"><label>标签（可选，多个用空格或逗号隔开）</label><input id="pdB-tags" class="input" placeholder="如：期中 易错"></div>`,
    onMount: (w) => {
      const wire = (treeSel, nodeSel) => {
        w.querySelector(treeSel).onchange = async (e) => {
          const nodeEl = w.querySelector(nodeSel);
          if (!e.target.value) { nodeEl.disabled = true; nodeEl.innerHTML = '<option value="">先选树</option>'; return; }
          const nodes = ((await api(`${PD_API}/trees/${e.target.value}/nodes`, { silent: true }).catch(() => ({ list: [] }))) || {}).list || [];
          const kids = {}; nodes.forEach((n) => { (kids[n.parent_id || 0] = kids[n.parent_id || 0] || []).push(n); });
          const out = []; const walk = (pid, depth) => (kids[pid] || []).sort((a, b) => (a.sort - b.sort) || (a.id - b.id)).forEach((n) => { out.push(`<option value="${n.id}">${'　'.repeat(depth)}${esc(n.name)}</option>`); walk(n.id, depth + 1); });
          walk(0, 0);
          nodeEl.disabled = false; nodeEl.innerHTML = '<option value="">不挂</option>' + out.join('');
        };
      };
      wire('#pdB-ktree', '#pdB-knode'); wire('#pdB-ctree', '#pdB-cnode');
    },
    onOk: async (w) => {
      const v = (id) => w.querySelector(id).value;
      if (!v('#pdB-sub') && lack('subject')) { toast('请先选择学科，没有学科的题不能入库', 'err'); return false; }
      if (!v('#pdB-stage') && lack('stage')) { toast('请先选择学段，没有学段的题不能入库', 'err'); return false; }
      const nodes = [v('#pdB-knode'), v('#pdB-cnode')].filter(Boolean).map(Number);
      const tags = v('#pdB-tags').split(/[\s,，、]+/).filter(Boolean);
      const r = await api(`${PD_API}/ext/pending/commit`, { method: 'POST', body: { ids, subject: v('#pdB-sub'), stage: v('#pdB-stage'), grade: v('#pdB-grade'), node_ids: nodes, tags } });
      toast(`已入库 ${r.committed} 题${r.failed.length ? `；${r.failed.length} 题失败：${r.failed[0].msg}` : ''}`, r.failed.length ? 'err' : 'ok');
      render();
    },
  });
}

/** AI 补全：对选中的批次型题目（拍照识别 / Word / Excel / 技能包）调用录题工作台的 aifill；采集和扫码的题请在编辑里手动补 */
async function pdAiFill(ids, byId) {
  if (!ids.length) return toast('请先勾选题目', 'err');
  const byRun = {};
  let skipped = 0;
  ids.forEach((id) => {
    const m = /^run:(\d+):(\d+)/.exec(id);
    if (m) (byRun[m[1]] = byRun[m[1]] || []).push(Number(m[2])); else skipped++;
  });
  const runs = Object.keys(byRun);
  if (!runs.length) return toast('采集和手机扫码的题暂不支持 AI 批量补全，请点「编辑」手动补', 'err');
  const btn = document.getElementById('pd-bai');
  btn.disabled = true; btn.textContent = '补全中…';
  let done = 0; let err = '';
  for (const rid of runs) {
    try { await api(`${PD_API}/intake/runs/${rid}/aifill`, { method: 'POST', body: { indexes: byRun[rid] }, silent: true }); done += byRun[rid].length; } catch (e) { err = e.message || String(e); }
  }
  toast(err ? `已补全 ${done} 题；有批次失败：${err}` : `AI 已补全 ${done} 题${skipped ? `（${skipped} 题来源不支持，已跳过）` : ''}`, err ? 'err' : 'ok');
  render();
}

/** 编辑单题 */
function pdEdit(it) {
  let pdAud = null;   // 听力音频字段（T7）
  const optRow = (o, i) => `<div class="pd-optrow"><b class="pd-optlb">${String.fromCharCode(65 + i)}</b><input class="input pd-opt" value="${esc(optText(o))}"><button type="button" class="link-btn danger" data-delopt>删</button></div>`;
  modal({
    title: `编辑题目 · ${it.source_label}`, okText: '保存', wide: true,
    body: `<div class="pd-grid">
        <div class="field"><label>题型</label><select id="pdE-type" class="input">${pdOpts(PD_TYPES, it.type)}</select></div>
        <div class="field"><label>学科</label><select id="pdE-sub" class="input">${pdOpts(PD_SUBJECTS, it.subject, '未识别')}</select></div>
        <div class="field"><label>学段</label><select id="pdE-stage" class="input">${pdOpts(PD_STAGES.slice(1), it.stage, '未识别')}</select></div>
        <div class="field"><label>年级</label><select id="pdE-grade" class="input">${pdOpts(PD_GRADES, it.grade, '未识别')}</select></div>
        <div class="field"><label>难度</label><select id="pdE-diff" class="input">${pdOpts([1, 2, 3, 4, 5], it.difficulty || 3)}</select></div>
      </div>
      ${it.kind === 'scan' ? '' : `<div class="field"><label>材料 / 原文（复合题共用，没有可不填）</label><textarea id="pdE-mat" class="input" rows="3">${esc(it.material)}</textarea></div>`}
      <div class="field"><label>题干（公式用 \\( … \\)）</label><textarea id="pdE-stem" class="input" rows="5">${esc(it.stem)}</textarea></div>
      <div class="field" id="pdE-optbox"><label>选项</label><div id="pdE-opts">${(it.options || []).map(optRow).join('')}</div><button type="button" class="btn ghost xs" id="pdE-addopt">＋ 添加选项</button></div>
      <div class="field"><label>答案<span class="pd-hint">选择题填字母（多选如 A,C）；判断题 正确/错误；填空多个空用 | 隔开</span></label><input id="pdE-ans" class="input" value="${esc(it.answer)}"></div>
      <div class="field"><label>解析</label><textarea id="pdE-ana" class="input" rows="3">${esc(it.analysis)}</textarea></div>
      <div class="field"><label>知识点</label><input id="pdE-point" class="input" value="${esc(it.point)}" placeholder="如：有理数的加法"></div>
      <div id="pdE-audio"></div>
      ${(it.images || []).length ? `<div class="pd-imgs">${it.images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="题图"></a>`).join('')}</div>` : ''}`,
    onMount: (w) => {
      t8Enhance(w, { fields: ['#pdE-stem', '#pdE-ana', '#pdE-mat', ...w.querySelectorAll('.pd-opt')] });   // 公式输入（T8）
      pdAud = t7AudioWidget(w.querySelector('#pdE-audio'), { key: it.audio_key, url: it.audio_url });   // 听力音频在这里逐题补充（T7）
      const optBox = w.querySelector('#pdE-opts');
      const relabel = () => optBox.querySelectorAll('.pd-optlb').forEach((b, i) => { b.textContent = String.fromCharCode(65 + i); });
      const showOpts = () => { const t = w.querySelector('#pdE-type').value; w.querySelector('#pdE-optbox').style.display = ['single', 'multi', 'sort'].includes(t) ? '' : 'none'; };
      showOpts();
      w.querySelector('#pdE-type').onchange = showOpts;
      w.querySelector('#pdE-addopt').onclick = () => { const d = document.createElement('div'); d.innerHTML = optRow({ text: '' }, optBox.children.length); optBox.appendChild(d.firstChild); };
      optBox.onclick = (e) => { if (e.target.closest('[data-delopt]')) { e.target.closest('.pd-optrow').remove(); relabel(); } };
    },
    onOk: async (w) => {
      const v = (id) => w.querySelector(id).value;
      const patch = {
        type: v('#pdE-type'), subject: v('#pdE-sub'), stage: v('#pdE-stage'), grade: v('#pdE-grade'), difficulty: Number(v('#pdE-diff')),
        stem: v('#pdE-stem').trim(), answer: v('#pdE-ans').trim(), analysis: v('#pdE-ana').trim(), point: v('#pdE-point').trim(),
        options: [...w.querySelectorAll('.pd-opt')].map((x, i) => ({ label: String.fromCharCode(65 + i), text: x.value.trim() })).filter((o) => o.text),
      };
      if (w.querySelector('#pdE-mat')) patch.material = v('#pdE-mat').trim();
      if (pdAud) patch.audio_key = pdAud.get();
      if (!patch.stem) { toast('题干不能为空', 'err'); return false; }
      await api(`${PD_API}/ext/pending/item`, { method: 'PUT', body: { id: it.id, patch } });
      toast('已保存', 'ok');
      render();
    },
  });
}

/** 下载客户的 Excel 模板（要带登录票据，所以用 fetch 再保存） */
async function pdDownloadTemplate() {
  try {
    const r = await fetch(`${PD_API}/ext/import-template`, { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = '习题导入模板.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  } catch (e) { toast('模板下载失败：' + e.message, 'err'); }
}

/** 导入 Excel / Word：先选默认的 学科/学段/年级（Excel 模板里没有这几列），再选文件；结果里列出没导入的行和原因 */
function pdImportDialog(kind) {
  const isExcel = kind === 'excel';
  const w = modal({
    title: isExcel ? '导入 Excel（习题导入模板）' : '导入 Word（.docx）', okText: '选择文件并导入',
    body: `${isExcel
      ? `<p class="pd-tip" style="margin-top:0">请使用「习题导入模板」（9 个 sheet：单选 / 多选 / 判断 / 组合 / 填空 / 排序 / 完形填空 / 选择填空 / 阅读理解），<b>不要改动表头和列顺序</b>；模板里的【例题】示例行会被自动忽略。<a href="javascript:;" id="pdI-tpl">下载模板</a></p>`
      : `<p class="pd-tip" style="margin-top:0">按下面的格式要求排好版，不用 AI，格式不对的题会告诉你在第几段、哪里不对。<a href="javascript:;" id="pdI-rule">${'查看格式要求'}</a></p><div id="pdI-rulebox" style="display:none">${PD_WORD_RULES}</div>`}
      <div class="pd-grid">
        <div class="field"><label>学科</label><select id="pdI-sub" class="input">${pdOpts(PD_SUBJECTS, '数学', '不指定')}</select></div>
        <div class="field"><label>学段</label><select id="pdI-stage" class="input">${pdOpts(PD_STAGES.slice(1), 'junior', '不指定')}</select></div>
        <div class="field"><label>年级</label><select id="pdI-grade" class="input">${pdOpts(PD_GRADES, '', '不指定')}</select></div>
      </div>
      <input type="file" id="pdI-file" accept="${isExcel ? '.xlsx,.xls' : '.docx'}" style="display:none">
      <div id="pdI-res" style="font-size:13px;line-height:1.8;margin-top:6px"></div>`,
    onMount: (el) => {
      const tpl = el.querySelector('#pdI-tpl'); if (tpl) tpl.onclick = pdDownloadTemplate;
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
          el.querySelector('#pdI-done').onclick = () => { el.closest('.mask').remove(); const st = ADM.page.pd = ADM.page.pd || { sel: {} }; st.source = kind; st.sel = {}; ADM.page.pdPage = 1; render(); };
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
