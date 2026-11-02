/* 知识树管理（T4）：章节树 / 知识点树 的统一编辑页。
 * 数据全部来自 bank_trees / bank_tree_nodes（mfbank.js 的 /trees、/nodes），题库管理、组卷、录题、学生端选知识点用的是同一棵树。
 * 由 admin.js 的 VIEWS.ktree 调用；依赖 admin.js 的 ADM / esc / ic / render，api.js 的 api / toast / elConfirm / elPrompt。
 */
const KT_API = '/api/admin/bank/mf';
const KT_KINDS = [['knowledge', '知识点树'], ['textbook', '章节树']];
const KT_STAGES = [['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const KT_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const KT_GRADES = { primary: ['三年级', '四年级', '五年级', '六年级'], junior: ['七年级', '八年级', '九年级', '中考冲刺'] };
// 能用「AI 拆解教材单元知识点」的 学科 → 学段（与 bank.js 的 KB_EDITIONS 一致：有对应江苏教材版本才能拆）
const KT_AI_STAGES = { 数学: ['primary', 'junior'], 英语: ['primary', 'junior'], 物理: ['junior'], 化学: ['junior'] };

async function viewKTree() {
  const st = ADM.page.kt = ADM.page.kt || { kind: 'knowledge', stage: 'junior', subject: '数学', treeId: '', open: {}, openFor: '' };
  const kindName = (KT_KINDS.find((k) => k[0] === st.kind) || [])[1] || '';
  const stageName = (KT_STAGES.find((s) => s[0] === st.stage) || [])[1] || st.stage;

  const trees = ((await api(KT_API + '/trees')) || {}).list || [];
  const cands = trees.filter((t) => t.kind === st.kind && t.subject === st.subject && t.stage === st.stage);
  const tree = cands.find((t) => String(t.id) === String(st.treeId)) || cands[0] || null;
  st.treeId = tree ? String(tree.id) : '';
  const nodes = tree ? (((await api(`${KT_API}/trees/${tree.id}/nodes`)) || {}).list || []) : [];

  const kids = {};
  nodes.forEach((n) => { const p = n.parent_id || 0; (kids[p] = kids[p] || []).push(n); });
  Object.values(kids).forEach((a) => a.sort((x, y) => (x.sort - y.sort) || (x.id - y.id)));
  const total = {};   // 子树题数（含自己）
  const desc = {};    // 后代节点数
  const walk = (n) => {
    let q = n.qcount || 0, d = 0;
    (kids[n.id] || []).forEach((k) => { const r = walk(k); q += r[0]; d += 1 + r[1]; });
    total[n.id] = q; desc[n.id] = d;
    return [q, d];
  };
  (kids[0] || []).forEach(walk);
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });
  if (st.openFor !== st.treeId) {   // 换了一棵树：只展开第一层
    st.open = {};
    (kids[0] || []).forEach((r) => { st.open[r.id] = true; });
    st.openFor = st.treeId;
  }

  const row = (n, depth) => {
    const ks = kids[n.id] || [];
    const isOpen = !!st.open[n.id];
    return `<div class="t4-node" data-id="${n.id}">
      <div class="t4-row" style="padding-left:${8 + depth * 22}px">
        <span class="t4-tog ${ks.length ? '' : 'leaf'}" data-act="tog">${ks.length ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span class="t4-name" data-act="tog">${esc(n.name)}</span>
        ${total[n.id] ? `<span class="t4-cnt" title="本节点及子节点下挂的题目数">${total[n.id]} 题</span>` : ''}
        ${ks.length ? `<span class="t4-sub">${ks.length} 个子节点</span>` : ''}
        <span class="t4-acts">
          <button type="button" class="link-btn" data-act="add" title="在这个节点下添加子节点">＋子节点</button>
          <button type="button" class="link-btn" data-act="ren">改名</button>
          <button type="button" class="link-btn" data-act="up" title="同级内上移">↑</button>
          <button type="button" class="link-btn" data-act="down" title="同级内下移">↓</button>
          <button type="button" class="link-btn danger" data-act="del">删除</button>
        </span>
      </div>
      ${ks.length && isOpen ? ks.map((k) => row(k, depth + 1)).join('') : ''}
    </div>`;
  };
  const treeHTML = () => ((kids[0] || []).map((r) => row(r, 0)).join('')) || '<div class="empty">这棵树还没有节点，点上面的「＋ 添加根节点」开始</div>';

  const canAi = st.kind === 'knowledge' && (KT_AI_STAGES[st.subject] || []).includes(st.stage);
  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('list')} 知识树管理</h3></div>
    <p class="t4-tip">题库管理、组卷、录题、学生端选知识点用的都是这里的树（一个 学段+学科 一棵）。改名不会影响已挂的题；删除节点会取消它和子节点下题目的关联，题目本身不会删。</p>
    <div class="bk-filters">
      <select id="kt-kind">${KT_KINDS.map(([k, t]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="kt-stage">${KT_STAGES.map(([k, t]) => `<option value="${k}" ${st.stage === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="kt-subject">${KT_SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${cands.length > 1 ? `<select id="kt-tree">${cands.map((t) => `<option value="${t.id}" ${tree && t.id === tree.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
    </div>
    ${!tree ? `<div class="empty"><div class="e-ic">🌱</div>${esc(st.subject)} · ${esc(stageName)} 还没有${kindName}
        <div style="margin-top:12px"><button type="button" class="btn primary" id="kt-newtree">＋ 创建${esc(st.subject)}·${esc(stageName)}${kindName}</button></div></div>` : `
    <div class="t4-bar">
      <b class="t4-title">${esc(tree.name)}</b><span class="tag gray">${nodes.length} 个节点</span>
      <span class="sp"></span>
      <button type="button" class="btn sm" id="kt-addroot">＋ 添加根节点</button>
      <button type="button" class="btn ghost sm" id="kt-expand">全部展开</button>
      <button type="button" class="btn ghost sm" id="kt-collapse">全部收起</button>
      ${canAi ? '<button type="button" class="btn ghost sm" id="kt-ai" title="按江苏教材拆解某个年级的单元与知识点，合并进「教材单元知识点」分支（只新增，不删除已有节点）">✨ AI 拆解教材知识点</button>' : ''}
      <button type="button" class="btn ghost sm" id="kt-rename">树改名</button>
      <button type="button" class="btn ghost sm danger" id="kt-deltree">删除整棵树</button>
    </div>
    <div class="t4-tree" id="t4-tree">${treeHTML()}</div>`}
  </div>`;

  return {
    html,
    after: () => {
      const $ = (id) => document.getElementById(id);
      $('kt-kind').onchange = (e) => { st.kind = e.target.value; st.treeId = ''; render(); };
      $('kt-stage').onchange = (e) => { st.stage = e.target.value; st.treeId = ''; render(); };
      $('kt-subject').onchange = (e) => { st.subject = e.target.value; st.treeId = ''; render(); };
      if ($('kt-tree')) $('kt-tree').onchange = (e) => { st.treeId = e.target.value; render(); };
      const done = async (fn, okMsg) => {
        try { await fn(); if (okMsg) toast(okMsg, 'ok'); render(); } catch (e) { /* api() 已弹出错误提示 */ }
      };
      if (!tree) {
        $('kt-newtree').onclick = () => done(() => api(KT_API + '/trees', { method: 'POST', body: { name: `${st.subject}·${stageName}${kindName}`, kind: st.kind, subject: st.subject, stage: st.stage, source: 'manual' } }), '已创建');
        return;
      }
      const paint = () => { $('t4-tree').innerHTML = treeHTML(); };
      const askName = (title, value) => elPrompt({ title, value: value || '', placeholder: '节点名称', okText: '确定' }).then((v) => (v == null ? null : String(v).trim()));
      $('kt-addroot').onclick = async () => {
        const name = await askName('添加根节点');
        if (name) done(() => api(`${KT_API}/trees/${tree.id}/nodes`, { method: 'POST', body: { name } }), '已添加');
      };
      $('kt-expand').onclick = () => { nodes.forEach((n) => { if ((kids[n.id] || []).length) st.open[n.id] = true; }); paint(); };
      $('kt-collapse').onclick = () => { st.open = {}; paint(); };
      $('kt-rename').onclick = async () => {
        const name = await askName('树改名', tree.name);
        if (name && name !== tree.name) done(() => api(`${KT_API}/trees/${tree.id}`, { method: 'PUT', body: { name } }), '已保存');
      };
      $('kt-deltree').onclick = async () => {
        const ok = await elConfirm({ title: '删除整棵树', danger: true, okText: '删除', message: `确定删除「${tree.name}」？将删除它的 ${nodes.length} 个节点，并取消这些节点上题目的关联（题目本身不会删）。此操作不可恢复。` });
        if (ok) { st.treeId = ''; done(() => api(`${KT_API}/trees/${tree.id}`, { method: 'DELETE' })); }
      };
      if (canAi) {
        $('kt-ai').onclick = async () => {
          const grades = KT_GRADES[st.stage] || [];
          const g = await elPrompt({ title: 'AI 拆解教材知识点', message: `输入要拆解的年级（${grades.join(' / ')}）。会调用 AI，约需半分钟；结果合并进「教材单元知识点」分支，已有节点保留。`, value: grades[0] || '', okText: '开始拆解' });
          const grade = g == null ? '' : String(g).trim();
          if (!grade) return;
          if (!grades.includes(grade)) return toast('年级请从 ' + grades.join(' / ') + ' 中选一个', 'err');
          const btn = $('kt-ai'); btn.disabled = true; btn.textContent = '拆解中…';
          try {
            const r = await api('/api/admin/bank/kbtree/generate', { method: 'POST', body: { subject: st.subject, stage: st.stage, grade } });
            toast((r && r.created != null) ? (r.created ? `已合并，新增 ${r.created} 个节点` : '内容已都在树里，没有新增') : '已完成', 'ok');
            render();
          } catch (e) { btn.disabled = false; btn.textContent = '✨ AI 拆解教材知识点'; }
        };
      }
      // 节点操作：事件委托
      $('t4-tree').onclick = async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const nodeEl = b.closest('.t4-node');
        const id = Number(nodeEl.dataset.id);
        const n = byId[id];
        const act = b.dataset.act;
        if (act === 'tog') { if ((kids[id] || []).length) { st.open[id] = !st.open[id]; paint(); } return; }
        if (act === 'add') {
          const name = await askName(`在「${n.name}」下添加子节点`);
          if (name) { st.open[id] = true; done(() => api(`${KT_API}/trees/${tree.id}/nodes`, { method: 'POST', body: { name, parent_id: id } }), '已添加'); }
        } else if (act === 'ren') {
          const name = await askName('节点改名', n.name);
          if (name && name !== n.name) done(() => api(`${KT_API}/nodes/${id}`, { method: 'PUT', body: { name } }), '已保存');
        } else if (act === 'up' || act === 'down') {
          done(() => api(`${KT_API}/nodes/${id}/move`, { method: 'POST', body: { dir: act } }));
        } else if (act === 'del') {
          const sub = desc[id] ? `及其 ${desc[id]} 个子节点` : '';
          const q = total[id] ? `这些节点下挂着 ${total[id]} 道题，它们会取消和这些节点的关联（题目本身不会删）。` : '';
          const ok = await elConfirm({ title: '删除节点', danger: true, okText: '删除', message: `确定删除「${n.name}」${sub}？${q}此操作不可恢复。` });
          if (ok) done(() => api(`${KT_API}/nodes/${id}`, { method: 'DELETE' }));
        }
      };
    },
  };
}
