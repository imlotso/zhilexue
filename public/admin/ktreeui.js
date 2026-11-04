/* 知识树管理（T4 / R2）：章节树 / 知识点树 的统一编辑页。
 * 数据全部来自 bank_trees / bank_tree_nodes（mfbank.js 的 /trees、/nodes），题库管理、组卷、录题、学生端选知识点用的是同一棵树。
 * R2：同一 学段+学科+种类 下每个教材版本一棵树（顶部「版本」下拉）；支持按名称搜索、JSON 导入 / 导出（格式见 docs/tree-import-format.md）。
 * 由 admin.js 的 VIEWS.ktree 调用；依赖 admin.js 的 ADM / esc / ic / render，api.js 的 api / toast / elConfirm / elPrompt，treepick.js 的 tpTrees / pickTree / tpEditions。
 */
const KT_API = '/api/admin/bank/mf';
const KT_KINDS = [['knowledge', '知识点树'], ['textbook', '章节树']];
const KT_STAGES = [['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const KT_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const KT_GRADES = { primary: ['三年级', '四年级', '五年级', '六年级'], junior: ['七年级', '八年级', '九年级', '中考冲刺'] };
// 能用「AI 拆解教材单元知识点」的 学科 → 学段（与 bank.js 的 KB_EDITIONS 一致：有对应江苏教材版本才能拆）
const KT_AI_STAGES = { 数学: ['primary', 'junior'], 英语: ['primary', 'junior'], 物理: ['junior'], 化学: ['junior'] };

async function viewKTree() {
  // edition：undefined = 自动（默认版本）；字符串 = 指定的版本（知识点树的 '' = 通用）。q：节点名搜索词
  const st = ADM.page.kt = ADM.page.kt || { kind: 'knowledge', stage: 'junior', subject: '数学', treeId: '', open: {}, openFor: '', q: '' };
  if (st.q == null) st.q = '';
  const kindName = (KT_KINDS.find((k) => k[0] === st.kind) || [])[1] || '';
  const stageName = (KT_STAGES.find((s) => s[0] === st.stage) || [])[1] || st.stage;

  const trees = await tpTrees();
  // 版本下拉：该 类型+学段+学科 下已有的版本 ∪ 默认版本（还没建树也能选，直接去创建）∪ 刚输入的新版本
  const edSet = tpEditions(trees, { kind: st.kind, subject: st.subject, stage: st.stage });
  const defEd = tpDefaultEdition(st.subject, st.stage);
  if (defEd && !edSet.includes(defEd) && st.kind === 'textbook') edSet.unshift(defEd);
  if (st.kind === 'knowledge' && !edSet.includes('')) edSet.push('');
  if (st.edition !== undefined && !edSet.includes(st.edition)) edSet.push(st.edition);
  const autoTree = pickTree(trees, { kind: st.kind, subject: st.subject, stage: st.stage });
  const edition = st.edition !== undefined ? st.edition : (autoTree ? String(autoTree.edition || '') : (st.kind === 'knowledge' ? '' : defEd));
  const tree = trees.find((t) => t.kind === st.kind && t.subject === st.subject && t.stage === st.stage && String(t.edition || '') === edition) || null;
  st.treeId = tree ? String(tree.id) : '';
  const edLabel = (e) => (e || '通用') + (e && e === defEd ? '（默认）' : '');
  const nodes = tree ? (((await api(`${KT_API}/trees/${tree.id}/nodes`)) || {}).list || []) : [];

  const kids = {};
  nodes.forEach((n) => { const p = n.parent_id || 0; (kids[p] = kids[p] || []).push(n); });
  Object.values(kids).forEach((a) => a.sort((x, y) => (x.sort - y.sort) || (x.id - y.id)));
  const total = {};   // 子树题数（含自己）
  const desc = {};    // 后代节点数
  const walk = (n) => {
    let q = n.qcount || 0, d = 0;   // 接口的 qcount 已含全部子孙节点（去重）
    (kids[n.id] || []).forEach((k) => { const r = walk(k); d += 1 + r[1]; });
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

  // 按名称搜索：命中的节点高亮，它的所有祖先自动展开
  let hit = new Set(), forceOpen = new Set(), q = '';
  const runSearch = () => {
    q = String(st.q || '').trim().toLowerCase();
    hit = new Set(); forceOpen = new Set();
    if (!q) return;
    nodes.forEach((n) => {
      if (String(n.name).toLowerCase().includes(q)) {
        hit.add(n.id);
        let p = byId[n.parent_id];
        while (p) { forceOpen.add(p.id); p = byId[p.parent_id]; }
      }
    });
  };
  runSearch();
  const nameHtml = (n) => {
    if (!q || !hit.has(n.id)) return esc(n.name);
    const name = String(n.name), i = name.toLowerCase().indexOf(q);
    return `${esc(name.slice(0, i))}<mark class="r2-hit">${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
  };

  const row = (n, depth) => {
    const ks = kids[n.id] || [];
    const isOpen = !!st.open[n.id] || forceOpen.has(n.id);
    return `<div class="t4-node" data-id="${n.id}">
      <div class="t4-row ${hit.has(n.id) ? 'r2-hitrow' : ''}" style="padding-left:${8 + depth * 22}px">
        <span class="t4-tog ${ks.length ? '' : 'leaf'}" data-act="tog">${ks.length ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span class="t4-name" data-act="tog">${nameHtml(n)}</span>
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
  const treeHTML = () => ((kids[0] || []).map((r) => row(r, 0)).join('')) || '<div class="empty">这棵树还没有节点，点上面的「＋ 添加根节点」开始，或用「导入 JSON」一次导入整棵树</div>';

  const canAi = st.kind === 'knowledge' && (KT_AI_STAGES[st.subject] || []).includes(st.stage);
  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('list')} 知识树管理</h3></div>
    <p class="t4-tip">题库管理、组卷、录题、学生端选知识点用的都是这里的树（一个 学段+学科+版本 一棵）。改名不会影响已挂的题；删除节点会取消它和子节点下题目的关联，题目本身不会删。</p>
    <div class="bk-filters r2-kt-filters">
      <label class="r2-fl"><span>类型</span><select id="kt-kind">${KT_KINDS.map(([k, t]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="r2-fl"><span>学段</span><select id="kt-stage">${KT_STAGES.map(([k, t]) => `<option value="${k}" ${st.stage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="r2-fl"><span>学科</span><select id="kt-subject">${KT_SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="r2-fl"><span>版本</span><select id="kt-edition">${edSet.map((e) => `<option value="${esc(e)}" ${edition === e ? 'selected' : ''}>${esc(edLabel(e))}</option>`).join('')}<option value="__new">＋ 其它版本…</option></select></label>
      <span class="sp"></span>
      <button type="button" class="btn ghost sm" id="kt-import" title="导入符合 docs/tree-import-format.md 的 JSON：按 类型+学段+学科+版本 找树（没有就建），节点按路径合并，只增不删">导入 JSON</button>
      <input type="file" id="kt-importfile" accept=".json,application/json" style="display:none">
    </div>
    ${!tree ? `<div class="empty"><div class="e-ic">🌱</div>${esc(st.subject)} · ${esc(stageName)} · ${esc(edition || '通用')} 还没有${kindName}
        <div style="margin-top:12px"><button type="button" class="btn primary" id="kt-newtree">＋ 创建${esc(edition)}${esc(st.subject)}·${esc(stageName)}${kindName}</button></div>
        <div class="hint" style="margin-top:8px">也可以点上面的「导入 JSON」，直接导入采集好的整棵树</div></div>` : `
    <div class="t4-bar">
      <b class="t4-title">${esc(tree.name)}</b><span class="tag gray">${nodes.length} 个节点</span>${tree.edition ? `<span class="tag">${esc(tree.edition)}</span>` : ''}
      <span class="sp"></span>
      <span class="r2-search"><input type="search" id="kt-search" class="r2-search-inp" placeholder="按名称搜索节点" value="${esc(st.q)}" aria-label="按名称搜索节点"><span class="r2-search-n" id="kt-searchn">${q ? (hit.size ? `${hit.size} 处匹配` : '没有匹配') : ''}</span></span>
      <button type="button" class="btn sm" id="kt-addroot">＋ 添加根节点</button>
      <button type="button" class="btn ghost sm" id="kt-expand">全部展开</button>
      <button type="button" class="btn ghost sm" id="kt-collapse">全部收起</button>
      ${canAi ? '<button type="button" class="btn ghost sm" id="kt-ai" title="按江苏教材拆解某个年级的单元与知识点，合并进「教材单元知识点」分支（只新增，不删除已有节点）">✨ AI 拆解教材知识点</button>' : ''}
      <button type="button" class="btn ghost sm" id="kt-export" title="导出为 JSON（格式同导入，可导入到别的库）">导出 JSON</button>
      <button type="button" class="btn ghost sm" id="kt-rename">树改名</button>
      <button type="button" class="btn ghost sm danger" id="kt-deltree">删除整棵树</button>
    </div>
    <div class="t4-tree r2-hover" id="t4-tree">${treeHTML()}</div>`}
  </div>`;

  return {
    html,
    after: () => {
      const $ = (id) => document.getElementById(id);
      $('kt-kind').onchange = (e) => { st.kind = e.target.value; st.treeId = ''; st.edition = undefined; render(); };
      $('kt-stage').onchange = (e) => { st.stage = e.target.value; st.treeId = ''; st.edition = undefined; render(); };
      $('kt-subject').onchange = (e) => { st.subject = e.target.value; st.treeId = ''; st.edition = undefined; render(); };
      $('kt-edition').onchange = async (e) => {
        let v = e.target.value;
        if (v === '__new') {
          const name = await elPrompt({ title: '新增教材版本', message: `输入版本名（如 苏教版、苏科版、译林版、沪教版），随后创建${st.subject}·${stageName}的${kindName}。`, value: '', placeholder: '版本名', okText: '确定' });
          v = name == null ? null : String(name).trim().slice(0, 40);
          if (!v) { render(); return; }
        }
        st.edition = v; st.treeId = ''; render();
      };
      const done = async (fn, okMsg) => {
        try { await fn(); if (okMsg) toast(okMsg, 'ok'); render(); } catch (e) { /* api() 已弹出错误提示 */ }
      };

      /* —— 导入 JSON：先预检（dry）告诉用户会新增多少，再确认写入 —— */
      $('kt-import').onclick = () => $('kt-importfile').click();
      $('kt-importfile').onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        let doc;
        try { doc = JSON.parse((await f.text()).replace(/^﻿/, '')); } catch (err) { return toast('这不是有效的 JSON 文件：' + err.message, 'err'); }
        let pre;
        try { pre = await api(KT_API + '/trees/import?dry=1', { method: 'POST', body: doc }); } catch (err) { return; }
        const lines = pre.results.map((r) => `${r.kind === 'textbook' ? '章节树' : '知识点树'} ${r.subject} ${r.edition || '通用'}「${r.name}」${r.created_tree ? '（新建）' : ''}：新增 ${r.added}，已存在 ${r.existing}`);
        if (!pre.added && !pre.results.some((r) => r.created_tree)) return toast('文件里的节点都已经在树里了，没有新增', 'ok');
        const ok = await elConfirm({ title: '确认导入', okText: '导入', message: `${lines.join('\n')}\n\n按路径合并，只增不删，已有节点不会改动。确定导入？` });
        if (!ok) return;
        try {
          const r = await api(KT_API + '/trees/import', { method: 'POST', body: doc });
          toast(`导入完成，新增 ${r.added} 个节点`, 'ok');
          const first = r.results[0];
          if (first) { st.kind = first.kind; st.stage = first.stage; st.subject = first.subject; st.edition = first.edition; st.treeId = ''; st.openFor = ''; }
          render();
        } catch (err) { /* api() 已提示 */ }
      };

      if (!tree) {
        $('kt-newtree').onclick = () => done(() => api(KT_API + '/trees', { method: 'POST', body: { name: `${edition}${st.subject}·${stageName}${kindName}`, kind: st.kind, subject: st.subject, stage: st.stage, edition, source: 'manual' } }), '已创建');
        return;
      }
      const paint = () => { $('t4-tree').innerHTML = treeHTML(); };
      const askName = (title, value) => elPrompt({ title, value: value || '', placeholder: '节点名称', okText: '确定' }).then((v) => (v == null ? null : String(v).trim()));

      /* —— 按名称搜索（输入即时高亮并展开，不重新拉数据） —— */
      $('kt-search').oninput = (e) => {
        st.q = e.target.value;
        runSearch();
        paint();
        $('kt-searchn').textContent = q ? (hit.size ? `${hit.size} 处匹配` : '没有匹配') : '';
        const first = document.querySelector('#t4-tree .r2-hitrow');
        if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
      };

      /* —— 导出 JSON：下载为 <树名>.json —— */
      $('kt-export').onclick = async () => {
        try {
          const doc = await api(`${KT_API}/trees/${tree.id}/export`);
          const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${tree.name}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          toast('已导出', 'ok');
        } catch (e) { /* api() 已提示 */ }
      };

      $('kt-addroot').onclick = async () => {
        const name = await askName('添加根节点');
        if (name) done(() => api(`${KT_API}/trees/${tree.id}/nodes`, { method: 'POST', body: { name } }), '已添加');
      };
      $('kt-expand').onclick = () => { nodes.forEach((n) => { if ((kids[n.id] || []).length) st.open[n.id] = true; }); paint(); };
      $('kt-collapse').onclick = () => { st.open = {}; st.q = ''; $('kt-search').value = ''; runSearch(); $('kt-searchn').textContent = ''; paint(); };
      $('kt-rename').onclick = async () => {
        const name = await askName('树改名', tree.name);
        if (name && name !== tree.name) done(() => api(`${KT_API}/trees/${tree.id}`, { method: 'PUT', body: { name } }), '已保存');
      };
      $('kt-deltree').onclick = async () => {
        const ok = await elConfirm({ title: '删除整棵树', danger: true, okText: '删除', message: `确定删除「${tree.name}」？将删除它的 ${nodes.length} 个节点，并取消这些节点上题目的关联（题目本身不会删）。此操作不可恢复。` });
        if (ok) { st.treeId = ''; st.edition = undefined; done(() => api(`${KT_API}/trees/${tree.id}`, { method: 'DELETE' })); }
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
        if (act === 'tog') { if ((kids[id] || []).length) { st.open[id] = !(st.open[id] || forceOpen.has(id)); paint(); } return; }
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
          const q2 = total[id] ? `这些节点下挂着 ${total[id]} 道题，它们会取消和这些节点的关联（题目本身不会删）。` : '';
          const ok = await elConfirm({ title: '删除节点', danger: true, okText: '删除', message: `确定删除「${n.name}」${sub}？${q2}此操作不可恢复。` });
          if (ok) done(() => api(`${KT_API}/nodes/${id}`, { method: 'DELETE' }));
        }
      };
    },
  };
}
