/* 魔方助教复刻 UI 第二期（2026-10-29）
 * 覆盖 mfbankui.js 里的 viewMfBank / viewMfCapture，并新增 viewMfSet（设置）。
 *  - 题库管理：左栏「挑题方式 + 树 + 知识节点折叠树」一比一复刻；右栏筛选 + 批量条（删除/标签/AI 整理/AI 建议/标记错题/加入试题篮）+ 题卡。
 *  - 网络采集：浏览器 / 试题采集 / 整卷下载 三个标签；代理内嵌浏览器（组卷网 / 菁优网 / 二一组卷网快捷入口）。
 *  - 设置：AI 配置管理（学生端+管理后台全部 AI 能力按可共用模型分组配置）/ 字典树映射。
 * 依赖：mfbankui.js 的 mfState / mfCommitForm / MF_API / MF_TYPES 常量；admin.js 的 api/esc/toast/modal/ic/elConfirm/render。
 */
'use strict';
const MFX = '/api/admin/bank/mf/ext';
const MF_SITES = [
  { k: 'zujuan', t: '组卷网', url: 'https://zujuan.xkw.com/', host: 'zujuan.xkw.com' },
  { k: 'jyeoo', t: '菁优网', url: 'https://www.jyeoo.com/', host: 'jyeoo.com' },
  { k: '21cnjy', t: '二一组卷网', url: 'https://www.21cnjy.com/', host: '21cnjy.com' },
];
const MF_STAGE_NAMES = { primary: '小学', junior: '初中', senior: '高中' };
const MF_DIFF_NAMES = { 1: '很容易', 2: '较易', 3: '中等', 4: '较难', 5: '很难' };

/* ================================================================ 题库管理（知识树一比一） */
async function viewMfBank() {
  const st = mfState('mfq');
  ['kw', 'stage', 'subject', 'type', 'difficulty', 'source', 'complete', 'node', 'grade', 'volume'].forEach((k) => { st[k] = st[k] == null ? '' : st[k]; });
  st.pmode = st.pmode === 'chapter' ? 'chapter' : 'knowledge';
  if (!st.special) st.special = ''; // '' | 'uncat' | 'review'
  if (!Array.isArray(st.units)) st.units = [];
  if (!st.open) st.open = {};
  if (!st.uexp) st.uexp = {};
  if (!st.sel) st.sel = {};
  if (!st.stage) st.stage = 'primary';
  if (!st.subject) st.subject = '数学';
  // 学段决定科目：物理/化学只有初中才有
  const PC_SUBJ = st.stage === 'junior' ? ['英语', '数学', '物理', '化学'] : ['英语', '数学'];
  if (!PC_SUBJ.includes(st.subject)) st.subject = '数学';
  const page = Math.max(1, Number(ADM.page.mfqPage) || 1);
  const size = 20;

  // 派生树：章节树(textbook) / 知识点树(knowledge) 由 学段+科目 唯一确定（启动时种子自动建好）
  const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const chapTree = trees.find((t) => t.kind === 'textbook' && t.subject === st.subject && t.stage === st.stage) || null;
  const knowTree = trees.find((t) => t.kind === 'knowledge' && t.subject === st.subject && t.stage === st.stage) || null;
  const activeTree = st.pmode === 'chapter' ? chapTree : knowTree;
  let nodes = [];
  if (activeTree) nodes = (await api(`${MF_API}/trees/${activeTree.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
  const kids = {};
  nodes.forEach((n) => { const p = n.parent_id || 0; (kids[p] = kids[p] || []).push(n); });
  // 章节模式：年级 → 册别 → 单元（多选，可展开小知识点）
  const gradeNodes = kids[0] || [];
  const curGrade = gradeNodes.find((g) => String(g.id) === String(st.grade)) || gradeNodes[0] || null;
  if (curGrade) st.grade = String(curGrade.id);
  const volNodes = curGrade ? (kids[curGrade.id] || []) : [];
  const curVol = volNodes.find((v) => String(v.id) === String(st.volume)) || volNodes[0] || null;
  if (curVol) st.volume = String(curVol.id);
  const unitNodes = curVol ? (kids[curVol.id] || []) : [];
  const nodeIdSet = new Set(nodes.map((n) => String(n.id)));
  st.units = st.units.filter((id) => nodeIdSet.has(String(id)));
  const totalQ = (await api(`${MF_API}/questions?page=1&size=1`, { silent: true }).catch(() => ({ total: 0 }))).total || 0;
  const badges = await api(`${MFX}/badge-counts`, { silent: true }).catch(() => ({ uncat: 0, review: 0 }));

  let data;
  if (st.special === 'review') {
    data = await api(`${MFX}/review-list?page=${page}&size=${size}${st.kw ? '&kw=' + encodeURIComponent(st.kw) : ''}`);
  } else {
    const qs = Object.entries({
      stage: st.stage, subject: st.subject, type: st.type, difficulty: st.difficulty,
      source_type: st.source, complete: st.complete, kw: st.kw,
      node: (!st.special && st.pmode === 'knowledge') ? st.node : '',
      nodes: (!st.special && st.pmode === 'chapter' && st.units.length) ? st.units.join(',') : '',
      uncat: st.special === 'uncat' ? '1' : '',
    }).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    data = await api(`${MF_API}/questions?page=${page}&size=${size}${qs ? '&' + qs : ''}`);
  }
  ADM.page.mfqPage = data.page;
  const selCount = Object.values(st.sel).filter(Boolean).length;

  const nodeName = (id) => { const n = nodes.find((x) => String(x.id) === String(id)); return n ? n.name : ''; };
  const selNames = st.special ? [] : (st.pmode === 'chapter' ? st.units : (st.node ? [st.node] : [])).map(nodeName).filter(Boolean);

  const unitRow = (n) => {
    const secs = kids[n.id] || [];
    const on = st.units.includes(String(n.id));
    const exp = !!st.uexp[n.id];
    return `<div style="padding:3px 0;border-bottom:1px dashed #f1f5f9">
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;line-height:1.8">
        <input type="checkbox" data-unit="${n.id}" ${on ? 'checked' : ''}>
        <span style="flex:1;overflow-wrap:anywhere">${esc(n.name)}<i class="mf-nq"> ${n.qcount || 0}</i></span>
        ${secs.length ? `<a href="javascript:;" class="mf-tw" data-ux="${n.id}" style="color:#94a3b8">${exp ? '▾' : '▸'}</a>` : ''}
      </label>
      ${exp && secs.length ? secs.map((sc) => `<label style="display:flex;gap:6px;align-items:center;font-size:12.5px;color:#475569;cursor:pointer;padding-left:26px;margin:2px 0"><input type="checkbox" data-unit="${sc.id}" ${st.units.includes(String(sc.id)) ? 'checked' : ''}><span style="flex:1;overflow-wrap:anywhere">${esc(sc.name)}<i class="mf-nq"> ${sc.qcount || 0}</i></span></label>`).join('') : ''}
    </div>`;
  };
  const treeRow = (n, depth) => {
    const children = kids[n.id] || [];
    const isOpen = !!st.open[n.id];
    const on = String(st.node) === String(n.id);
    return `<div class="mf-node" style="padding-left:${depth * 16 + 4}px">
      <a href="javascript:;" class="mf-tw ${children.length ? '' : 'leaf'}" data-tw="${n.id}">${children.length ? (isOpen ? '▾' : '▸') : '·'}</a>
      <a href="javascript:;" class="${on ? 'on' : ''}" data-node="${n.id}" title="${esc(n.name)}">${esc(n.name)}</a>
      <span class="mf-nq">${n.qcount || 0}</span></div>`
      + (isOpen ? children.map((c) => treeRow(c, depth + 1)).join('') : '');
  };
  const treeHtml = (kids[0] || []).map((n) => treeRow(n, 0)).join('')
    || '<div class="empty" style="padding:18px 0">这棵树还没有节点，点「加子节点」或用浏览器采集知识树</div>';

  const typeSel = (id, label, opts, cur) => `<select id="${id}" class="mf-fsel"><option value="">${label}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const srcOpts = [['capture', '网络采集'], ['local', '本地录入'], ['recog', '录题']];
  const compOpts = [['full', '齐全'], ['noans', '缺答案'], ['noana', '缺解析']];

  const qCard = (q, i) => {
    const tags = q.tags || [];
    const meta = [
      MF_TYPE_NAME[q.type] || q.type,
      MF_STAGE_NAMES[q.stage] || '',
      q.grade || '',
      q.difficulty ? (MF_DIFF_NAMES[q.difficulty] || q.difficulty) : '',
      (MF_SRC_NAME[q.source_type || 'local'] || '') + ((q.source_detail && q.source_detail.site) ? ('·' + (({ zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一' })[q.source_detail.site] || '')) : ''),
    ].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const tagHtml = tags.length ? `<span class="mf-qtags">${tags.map((t) => `<span class="tag ok">${esc(t)}</span>`).join('')}</span>` : '';
    const mt = q.mount || {};
    const missTxt = `${mt.chapter ? '' : '缺章节'}${(!mt.chapter && !mt.knowledge) ? '+' : ''}${mt.knowledge ? '' : '缺知识点'}`;
    const missHtml = (!mt.chapter || !mt.knowledge) ? `<span class="tag" style="background:#fef2f2;color:#dc2626">${missTxt}</span>` : '';
    const stemHtml = (q.stem_html && q.stem_html.trim()) ? q.stem_html : esc(q.stem || '').replace(/\n/g, '<br>');
    const optsHtml = (q.options || []).length && !/class=["'][^"']*options/.test(stemHtml)
      ? `<div class="mf-qopts">${q.options.map((o) => `<span>${esc(o)}</span>`).join('')}</div>` : '';
    const nodeHtml = selNames.length ? `<div class="hint" style="margin-top:4px">归属：${esc(selNames.join(' / '))}</div>` : '';
    return `<div class="mf-qitem" data-id="${q.id}">
      <div class="mf-qhead">
        <input type="checkbox" class="mf-qck" data-id="${q.id}" ${st.sel[q.id] ? 'checked' : ''}>
        <b class="mf-qno">${(data.page - 1) * size + i + 1}.</b>
        <div class="mf-qstem">${stemHtml}${optsHtml}${nodeHtml}</div>
      </div>
      <div class="mf-qmeta">${meta}${missHtml}${tagHtml}
        <span class="mf-qacts">
          ${(!mt.chapter || !mt.knowledge) ? `<a href="javascript:;" data-hang="${q.id}" style="color:#d97706">挂分类</a>` : ''}
          <a href="javascript:;" data-edit="${q.id}">编辑</a>
          <a href="javascript:;" data-del="${q.id}">删除</a>
        </span></div>
      <div class="mf-qfold">
        <details><summary ${q.answer && q.answer.trim() ? '' : 'class="dim"'}>答案</summary><div class="mf-qans">${esc(q.answer || '（无）')}</div></details>
        <details><summary ${q.analysis && q.analysis.trim() ? '' : 'class="dim"'}>解析</summary><div class="mf-qans">${esc(q.analysis || '（无）')}</div></details>
      </div></div>`;
  };

  const revCard = (it, i) => {
    const meta = [
      it.subject || it.pu_subject,
      MF_STAGE_NAMES[it.stage || it.pu_stage] || '',
      it.grade || it.pu_grade,
      it.point || it.pu_point,
      it.up_status === 'reviewed' ? '已核对' : '待审核',
    ].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const stemHtml = esc(it.stem || it.up_stem_text || '（无题干，看图核对）').replace(/\n/g, '<br>');
    const imgs = it.up_images || [];
    const imgHtml = imgs.length ? `<div class="mf-rvimgs">${imgs.map((u) => `<img src="${esc(u)}" data-upimg="${esc(u)}" title="点击看大图">`).join('')}</div>` : '';
    return `<div class="mf-qitem">
      <div class="mf-qhead">
        <b class="mf-qno">${(data.page - 1) * size + i + 1}.</b>
        <div class="mf-qstem">
          <div class="hint" style="margin-bottom:4px">学生：${esc(it.student_name || '')}${it.student_grade ? ' · ' + esc(it.student_grade) : ''} · ${(it.up_created || '').slice(0, 16).replace('T', ' ')}</div>
          ${stemHtml}${imgHtml}
        </div>
      </div>
      <div class="mf-qmeta">${meta}
        <span class="mf-qacts"><a href="javascript:;" data-rev="${it.up_id}" style="color:#d97706">✏️ 核对</a></span></div>
    </div>`;
  };

  const html = `
  <div class="bk-mods" style="padding:0 0 10px">
    <button class="bk-mod" data-mod="mfc"><span class="bm-ico">${ic('link')}</span><span class="bm-tt">网络采集<em>组卷网等题库一键采集</em></span></button>
    <button class="bk-mod" data-mod="mfi"><span class="bm-ico">${ic('upload')}</span><span class="bm-tt">录题上传<em>Word / 图片批量录题</em></span></button>
    <button class="bk-mod" data-mod="bkfb"><span class="bm-ico">${ic('chat')}</span><span class="bm-tt">错题反馈<em>学生反馈的题目核对</em><i class="bm-badge" id="bkFbBadge" style="display:none"></i></span></button>
  </div>
  <div class="mf-wrap" style="align-items:stretch">
    <div class="card mf-card" style="width:320px;flex:0 0 320px">
      <div class="card-b">
        <div style="display:flex;gap:8px">
          <select id="mfbStage" class="mf-fsel" style="flex:1">
            <option value="primary" ${st.stage === 'primary' ? 'selected' : ''}>小学</option>
            <option value="junior" ${st.stage === 'junior' ? 'selected' : ''}>初中</option>
          </select>
          <select id="mfbSubject" class="mf-fsel" style="flex:1">
            ${PC_SUBJ.map((sp) => `<option ${st.subject === sp ? 'selected' : ''}>${sp}</option>`).join('')}
          </select>
        </div>
        <div class="mf-segbox">
          <button type="button" class="mf-segit ${st.pmode === 'chapter' ? 'on' : ''}" id="mfbModeChapter"><b>章节</b></button>
          <button type="button" class="mf-segit ${st.pmode === 'knowledge' ? 'on' : ''}" id="mfbModeKnow"><b>知识点</b></button>
        </div>
        ${st.pmode === 'chapter' ? `
          <div style="display:flex;gap:8px;margin-top:8px">
            <select id="mfbGrade" class="mf-fsel" style="flex:1">${gradeNodes.map((g) => `<option value="${g.id}" ${String(st.grade) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('') || '<option value="">（无年级）</option>'}</select>
            <select id="mfbVolume" class="mf-fsel" style="flex:1">${volNodes.map((v) => `<option value="${v.id}" ${String(st.volume) === String(v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('') || '<option value="">（无册别）</option>'}</select>
          </div>
          <div class="hint" style="margin:6px 0 2px">${unitNodes.length} 个单元 · 勾选单元或小知识点（可多选）</div>
          <div class="mf-treebox" style="max-height:390px">${unitNodes.map(unitRow).join('') || '<div class="empty" style="padding:18px 0">该年级 / 册别下还没有单元数据</div>'}</div>
        ` : `
          <div class="hint" style="margin:8px 0 2px">${nodes.length} 个知识点节点 · 题库共 ${totalQ} 题</div>
          <div class="mf-treebox" style="max-height:410px">${treeHtml}</div>
          <div class="hint" style="margin-top:6px;line-height:1.6">点击知识点筛选（含子级挂的题）；点 ▸ 折叠/展开</div>
        `}
        ${activeTree ? '' : '<div class="empty" style="padding:10px 0">该学段 + 科目暂无' + (st.pmode === 'chapter' ? '教材章节' : '知识点') + '树</div>'}
      </div>
    </div>
    <div class="card mf-card grow">
      <div class="card-h"><h3>${ic('doc')} ${st.special === 'uncat' ? '未分类题目' : st.special === 'review' ? '待审核题目' : '题库管理'}${st.special ? '<a href="javascript:;" id="mfSpcExit" style="font-size:12px;color:#6366f1;text-decoration:none;margin-left:10px;font-weight:400">✕ 退出</a>' : ''}</h3>
        <div class="card-h-r" style="display:flex;gap:8px;align-items:center"><span class="hint">题库共 ${data.total} 题</span><button class="btn ghost xs ${badges.review ? 'mf-revhot' : ''}" id="mfReviewBtn">待审核题目<b class="rev-n">${badges.review || 0}</b></button><button class="btn ghost xs" id="mfImportBtn">导入题库</button><button class="btn xs" id="mfNewQBtn">新建题</button></div></div>
      <div class="card-b">
        <div class="mf-fbar">
          <input id="mfbKw" class="inp" style="width:200px;flex:0 1 200px" placeholder="搜题干关键词..." value="${esc(st.kw)}">
          ${typeSel('mfbType', '全部题型', Object.entries(MF_TYPE_NAME), st.type)}
          ${typeSel('mfbDiff', '全部难度', Object.entries(MF_DIFF_NAMES), st.difficulty)}
          ${typeSel('mfbSrc', '全部来源', srcOpts, st.source)}
          ${typeSel('mfbComp', '齐全度', compOpts, st.complete)}
        </div>
        ${st.special === 'review' ? '' : `<div class="mf-batchbar">
          <b>已选 ${selCount} 项</b>
          <button class="btn ghost xs" data-batch="del" ${selCount ? '' : 'disabled'}>批量删除</button>
          <button class="btn ghost xs" data-batch="tag" ${selCount ? '' : 'disabled'}>批量添加标签</button>
          <button class="btn ghost xs" data-batch="aiclean" ${selCount ? '' : 'disabled'}>AI 整理</button>
          <button class="btn ghost xs" data-batch="aisug" ${selCount ? '' : 'disabled'}>AI 建议</button>
          <button class="btn ghost xs" data-batch="wrong" ${selCount ? '' : 'disabled'}>批量标记错题</button>
          <button class="btn ghost xs" data-batch="basket" ${selCount ? '' : 'disabled'}>批量加入试题篮</button>
          <button class="btn ghost xs" data-batch="clear" ${selCount ? '' : 'disabled'}>取消选择</button>
        </div>`}
        ${st.special === 'review'
          ? (data.list.length ? data.list.map(revCard).join('') : '<div class="mf-empty"><div style="font-size:40px">✅</div>没有待核对的学生上传题目</div>')
          : (data.list.length ? data.list.map(qCard).join('') : `<div class="mf-empty"><div style="font-size:40px">🧊</div>${st.special === 'uncat' ? '太棒了，没有未分类的题目' : '暂无题目，去采集或新建题开始积累题库'}</div>`)}
        ${data.total > size ? pagerHTML(data.page, size, data.total, 'mfqPage') : ''}
      </div>
    </div></div>`;

  return {
    html,
    after: () => {
      mtxTypeset(document.getElementById('app'));
      const rerender = () => render();

      /* —— 顶部模块入口：网络采集 / 录题上传 / 错题反馈（集合进题库管理） —— */
      document.querySelectorAll('.bk-mod[data-mod]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.mod; });
      api('/api/admin/bank/feedback?status=pending&size=1', { silent: true })
        .then((d) => {
          const n = (d && d.total) || 0;
          const el = document.getElementById('bkFbBadge');
          if (el && n > 0) { el.textContent = n > 99 ? '99+' : n; el.style.display = ''; }
        }).catch(() => {});

      /* —— 导入题库 / 新建题 —— */
      document.getElementById('mfImportBtn').onclick = () => mfImportDialog(rerender);
      document.getElementById('mfNewQBtn').onclick = () => mfNewQDialog(rerender);

      /* —— 待审核（右上角入口） —— */
      document.getElementById('mfReviewBtn').onclick = () => { st.special = st.special === 'review' ? '' : 'review'; ADM.page.mfqPage = 1; rerender(); };
      const spcExit = document.getElementById('mfSpcExit');
      if (spcExit) spcExit.onclick = () => { st.special = ''; ADM.page.mfqPage = 1; rerender(); };
      document.querySelectorAll('[data-rev]').forEach((a) => { a.onclick = () => mfReviewDialog(data.list.find((x) => x.up_id === Number(a.dataset.rev)), rerender); });
      document.querySelectorAll('[data-upimg]').forEach((im) => { im.onclick = () => mfImgView(im.dataset.upimg); });
      document.querySelectorAll('[data-hang]').forEach((a) => { a.onclick = () => mfHangDialog(Number(a.dataset.hang), rerender); });

      /* —— 左栏联动（学段 → 科目 → 模式 → 年级/册别/单元 / 知识点树） —— */
      document.getElementById('mfbStage').onchange = (e) => { st.stage = e.target.value; st.grade = ''; st.volume = ''; st.units = []; st.node = ''; st.open = {}; st.uexp = {}; ADM.page.mfqPage = 1; rerender(); };
      document.getElementById('mfbSubject').onchange = (e) => { st.subject = e.target.value; st.grade = ''; st.volume = ''; st.units = []; st.node = ''; st.open = {}; st.uexp = {}; ADM.page.mfqPage = 1; rerender(); };
      const switchMode = (m) => { st.pmode = m; st.node = ''; st.units = []; st.open = {}; st.uexp = {}; ADM.page.mfqPage = 1; rerender(); };
      document.getElementById('mfbModeChapter').onclick = () => { if (st.pmode !== 'chapter') switchMode('chapter'); };
      document.getElementById('mfbModeKnow').onclick = () => { if (st.pmode !== 'knowledge') switchMode('knowledge'); };
      const mfbG = document.getElementById('mfbGrade');
      if (mfbG) mfbG.onchange = (e) => { st.grade = e.target.value; st.volume = ''; st.units = []; st.uexp = {}; ADM.page.mfqPage = 1; rerender(); };
      const mfbV = document.getElementById('mfbVolume');
      if (mfbV) mfbV.onchange = (e) => { st.volume = e.target.value; st.units = []; st.uexp = {}; ADM.page.mfqPage = 1; rerender(); };
      document.querySelectorAll('[data-unit]').forEach((ck) => { ck.onchange = () => { const id = ck.dataset.unit; if (ck.checked) { if (!st.units.includes(id)) st.units.push(id); } else st.units = st.units.filter((x) => x !== id); ADM.page.mfqPage = 1; rerender(); }; });
      document.querySelectorAll('[data-ux]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const id = a.dataset.ux; st.uexp[id] = !st.uexp[id]; rerender(); }; });
      document.querySelectorAll('[data-tw]').forEach((a) => { a.onclick = (e) => { e.stopPropagation(); const id = a.dataset.tw; st.open[id] = !st.open[id]; rerender(); }; });
      document.querySelectorAll('[data-node]').forEach((a) => { a.onclick = () => { st.node = st.node === a.dataset.node ? '' : a.dataset.node; ADM.page.mfqPage = 1; rerender(); }; });

      /* —— 筛选 —— */
      const bindSel = (id, key) => { const el = document.getElementById(id); if (el) el.onchange = () => { st[key] = el.value; ADM.page.mfqPage = 1; rerender(); }; };
      bindSel('mfbType', 'type');
      bindSel('mfbDiff', 'difficulty'); bindSel('mfbSrc', 'source'); bindSel('mfbComp', 'complete');
      const kwEl = document.getElementById('mfbKw');
      let kwTimer = null;
      kwEl.oninput = () => { clearTimeout(kwTimer); kwTimer = setTimeout(() => { st.kw = kwEl.value.trim(); ADM.page.mfqPage = 1; rerender(); }, 400); };

      /* —— 题卡勾选 —— */
      document.querySelectorAll('.mf-qck').forEach((ck) => { ck.onchange = () => { st.sel[ck.dataset.id] = ck.checked; if (!ck.checked) delete st.sel[ck.dataset.id]; rerender(); }; });
      document.querySelectorAll('[data-edit]').forEach((a) => { a.onclick = () => mfQEdit(a.dataset.edit, rerender); });
      document.querySelectorAll('[data-del]').forEach((a) => { a.onclick = async () => {
        if (!(await elConfirm({ title: '删除题目', message: '删除后不可恢复（试卷里引用它的行会一并移除）。确定？', okText: '删除', danger: true }))) return;
        await api(`${MF_API}/questions/${a.dataset.del}`, { method: 'DELETE' }); toast('已删除', 'ok'); rerender();
      }; });

      /* —— 批量操作 —— */
      bindPager('mfqPage');
      const selIds = () => Object.keys(st.sel).filter((k) => st.sel[k]).map(Number);
      document.querySelectorAll('[data-batch]').forEach((b) => {
        b.onclick = () => mfBatch(b.dataset.batch, selIds(), st, rerender);
      });
    },
  };
}

/** 图片查看大图 */
function mfImgView(src) {
  modal({
    title: '查看图片', okText: '关闭',
    body: `<div style="text-align:center"><img src="${esc(src)}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`,
  });
}

/** 挂分类（章节分类 + 知识点分类，两种都必须挂）：未分类题目快捷操作，保存后离开未分类列表 */
async function mfHangDialog(qid, done) {
  const d = await api(`${MF_API}/questions/${qid}`);
  const q = d.question;
  const cur = (q.nodes || []).slice();
  const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  if (!chapTrees.length || !knowTrees.length) return toast('缺少章节树或知识点树（学段+科目的种子树启动时会自动创建）', 'err');
  // 学生上传的占位题：single/multi 无选项过不了校验，自动降级为解答题
  let type = q.type;
  if ((type === 'single' || type === 'multi') && (q.options || []).length < 2) type = 'answer';
  const treeSel = (id, label, list) => {
    const def = list.find((t) => t.subject === q.subject && t.stage === q.stage) || list[0];
    return `<div class="field"><label>${label}</label><select id="${id}" class="inp">${list.map((t) => `<option value="${t.id}" ${def && t.id === def.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
  };
  modal({
    title: `挂分类 · 题目 #${qid}`, wide: true, okText: '保存',
    body: `<div class="mf-grid2">
      <div>${treeSel('hgCTree', '章节分类（教材目录）', chapTrees)}<div id="hgCNodes" class="mf-pick" style="max-height:240px"></div></div>
      <div>${treeSel('hgKTree', '知识点分类', knowTrees)}<div id="hgKNodes" class="mf-pick" style="max-height:240px"></div></div>
    </div>
    <div class="hint" style="margin-top:6px">两边的分类都至少勾一项；保存后这道题就从「未分类」进入对应章节 / 知识点的筛选范围</div>`,
    onOk: async (w, showErr) => {
      const chapIds = [...w.querySelectorAll('.hg-cnd:checked')].map((x) => Number(x.value));
      const knowIds = [...w.querySelectorAll('.hg-knd:checked')].map((x) => Number(x.value));
      if (!chapIds.length) return showErr('章节分类至少勾一项');
      if (!knowIds.length) return showErr('知识点分类至少勾一项');
      await api(`${MF_API}/questions/${qid}`, { method: 'PUT', body: {
        stem: q.stem, stem_html: q.stem_html, options: q.options, answer: q.answer, analysis: q.analysis,
        subject: q.subject, stage: q.stage, grade: q.grade, type, difficulty: q.difficulty, point: q.point,
        material: q.material, source: q.source, year: q.year, images: q.images,
        source_type: q.source_type, source_detail: q.source_detail, tags: q.tags,
        nodes: [...new Set([...chapIds, ...knowIds])],
      } });
      toast('已挂章节 + 知识点分类', 'ok'); if (typeof done === 'function') done();
    },
    onMount: (w) => {
      const load = async (treeSelId, boxId, cls) => {
        const tid = w.querySelector('#' + treeSelId).value;
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${cur.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bind = (treeSelId, boxId, cls) => {
        w.querySelector('#' + treeSelId).onchange = () => load(treeSelId, boxId, cls);
        load(treeSelId, boxId, cls);
      };
      bind('hgCTree', 'hgCNodes', 'hg-cnd');
      bind('hgKTree', 'hgKNodes', 'hg-knd');
    },
  });
}

/** 逐条核对学生上传的错题：看图 → 改字段/挂知识点 → 通过 / 仅保存 / 拒绝 */
async function mfReviewDialog(it, done) {
  if (!it) return;
  const qid = it.qid;
  const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const curSub = it.subject || it.pu_subject || '';
  const curStage = it.stage || it.pu_stage || '';
  const def = knowTrees.find((t) => t.subject === curSub && t.stage === curStage) || knowTrees[0];
  const defC = chapTrees.find((t) => t.subject === curSub && t.stage === curStage) || chapTrees[0];
  let curNodes = [];
  try { curNodes = ((await api(`${MF_API}/questions/${qid}`)).question.nodes || []).slice(); } catch (e) { /* 忽略 */ }
  const imgs = it.up_images || [];
  let qImgs = [];
  try { qImgs = typeof it.q_images === 'string' ? (JSON.parse(it.q_images || '[]') || []) : (it.q_images || []); } catch (e) { qImgs = []; }
  const reviewSave = async (w, status, showErr) => {
    const chapIds = [...w.querySelectorAll('.rv-cnd:checked')].map((x) => Number(x.value));
    const knowIds = [...w.querySelectorAll('.rv-nd:checked')].map((x) => Number(x.value));
    if (status === 'approved') {
      if (!chapTrees.length || !knowTrees.length) { toast('缺少章节树或知识点树，请先建树再审核', 'err'); return; }
      if (!chapIds.length) return showErr('审核通过前请先勾选「章节分类」——每道题必须同时归属章节和知识点');
      if (!knowIds.length) return showErr('审核通过前请先勾选「知识点分类」——每道题必须同时归属章节和知识点');
    }
    const sub = w.querySelector('#rvSub').value, stage = w.querySelector('#rvStage').value;
    const grade = w.querySelector('#rvGrade').value.trim(), point = w.querySelector('#rvPoint').value.trim();
    await api(`${MF_API}/questions/${qid}`, { method: 'PUT', body: {
      stem: w.querySelector('#rvStem').value.trim() || '（纸质错题，看图作答）',
      answer: w.querySelector('#rvAns').value.trim(),
      subject: sub, stage, grade, point,
      nodes: [...new Set([...chapIds, ...knowIds])], options: [], tags: [], images: qImgs,
      type: 'answer', difficulty: it.difficulty || 3,
      analysis: it.analysis || '', material: it.material || '', source: it.source || '学生上传',
      source_type: it.source_type || 'local', source_detail: it.source_detail || {},
    } });
    await api(`/api/admin/bank/uploads/${it.up_id}/review`, { method: 'POST', body: { status, subject: sub, stage, grade, point } });
    toast(status === 'approved' ? '审核通过，已归类入库' : '已保存核对结果', 'ok');
    w.remove(); if (typeof done === 'function') done();
  };
  modal({
    title: `核对学生错题（学生：${it.student_name || ''}）`, wide: true, okText: '✅ 审核通过',
    body: `
      ${imgs.length ? `<div class="mf-rvimgs" style="margin-bottom:10px">${imgs.map((u) => `<img src="${esc(u)}" data-rvimg="${esc(u)}" title="点击看大图">`).join('')}</div>` : ''}
      <div class="mf-form">
        <div class="field"><label>学科</label><select id="rvSub">${MF_SUBJECTS.map((sp) => `<option ${curSub === sp ? 'selected' : ''}>${sp}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="rvStage"><option value="">未分组</option>${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${curStage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>年级</label><input id="rvGrade" class="inp" value="${esc(it.grade || it.pu_grade || '')}"></div>
        <div class="field"><label>知识点标签</label><input id="rvPoint" class="inp" value="${esc(it.point || it.pu_point || '')}"></div>
      </div>
      <div class="field wide"><label>题干（AI 识别结果，可修正）</label><textarea id="rvStem" class="inp" rows="4">${esc(it.stem || it.up_stem_text || '')}</textarea></div>
      <div class="field wide"><label>答案（可空）</label><textarea id="rvAns" class="inp" rows="2">${esc(it.answer || '')}</textarea></div>
      <div class="field wide"><label>挂载分类（章节 + 知识点，审核通过前两边都要勾）</label>
        <div class="mf-grid2">
          <div><select id="rvCTree" class="inp">${chapTrees.length ? chapTrees.map((t) => `<option value="${t.id}" ${defC && t.id === defC.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('') : '<option value="">（暂无章节树）</option>'}</select>
            <div id="rvCNodes" class="mf-pick" style="margin-top:6px;max-height:180px"></div></div>
          <div><select id="rvTree" class="inp">${knowTrees.length ? knowTrees.map((t) => `<option value="${t.id}" ${def && t.id === def.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('') : '<option value="">（暂无知识点树）</option>'}</select>
            <div id="rvNodes" class="mf-pick" style="margin-top:6px;max-height:180px"></div></div>
        </div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn ghost xs" id="rvSave">💾 仅保存核对</button>
        <button class="btn ghost xs" id="rvReject" style="color:#dc2626">❌ 拒绝并删除</button>
      </div>`,
    onOk: async (w, showErr) => { await reviewSave(w, 'approved', showErr); },
    onMount: (w) => {
      const loadNodes = async (selId, boxId, cls) => {
        const tid = w.querySelector('#' + selId).value;
        if (!tid) { w.querySelector('#' + boxId).innerHTML = '<span class="hint">暂无可用分类树</span>'; return; }
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${curNodes.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bindTree = (selId, boxId, cls) => {
        w.querySelector('#' + selId).onchange = () => loadNodes(selId, boxId, cls);
        loadNodes(selId, boxId, cls);
      };
      bindTree('rvCTree', 'rvCNodes', 'rv-cnd');
      bindTree('rvTree', 'rvNodes', 'rv-nd');
      w.querySelectorAll('[data-rvimg]').forEach((im) => { im.onclick = () => mfImgView(im.dataset.rvimg); });
      w.querySelector('#rvSave').onclick = async () => { await reviewSave(w, 'reviewed'); };
      w.querySelector('#rvReject').onclick = async () => {
        if (!(await elConfirm({ title: '拒绝', message: '拒绝后这道题会从题库和该学生的错题本中一起删除。确定？', okText: '拒绝', danger: true }))) return;
        await api(`/api/admin/bank/uploads/${it.up_id}/review`, { method: 'POST', body: { status: 'rejected' } });
        toast('已拒绝并删除', 'ok'); w.remove(); if (typeof done === 'function') done();
      };
    },
  });
}

/** 题目编辑弹层（题干/选项/答案/解析/章节+知识点双归属；PUT 全字段回传避免重置丢数据） */
async function mfQEdit(id, done) {
  const d = await api(`${MF_API}/questions/${id}`);
  const q = d.question;
  const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  const curNodes = q.nodes || [];
  const pickTree = (list) => list.find((t) => t.subject === q.subject && t.stage === q.stage) || list[0] || null;
  const defC = pickTree(chapTrees); const defK = pickTree(knowTrees);
  let aud = null;   // 听力音频字段（T7）
  modal({
    title: `编辑题目 #${q.id}`, wide: true, okText: '保存',
    body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
      <div class="mf-form">
        <div class="field"><label>题型</label><select id="qeType">${Object.entries(MF_TYPE_NAME).map(([k, t]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>学科</label><select id="qeSub">${MF_SUBJECTS.map((s) => `<option ${q.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="qeStage">${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${q.stage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>难度(1-5)</label><input id="qeDiff" class="inp" type="number" min="1" max="5" value="${q.difficulty || 3}"></div>
      </div>
      <div class="field wide"><label>题干（支持 $...$ LaTeX，换行分段）</label><textarea id="qeStem" class="inp" rows="5">${esc(q.stem || '')}</textarea></div>
      <div class="field wide"><label>选项（一行一个，可空）</label><textarea id="qeOpts" class="inp" rows="3">${esc((q.options || []).join('\n'))}</textarea></div>
      <div class="mf-form">
        <div class="field wide"><label>答案</label><textarea id="qeAns" class="inp" rows="2">${esc(q.answer || '')}</textarea></div>
        <div class="field wide"><label>解析</label><textarea id="qeAna" class="inp" rows="2">${esc(q.analysis || '')}</textarea></div>
      </div>
      <div id="qeAudio"></div>
      <div class="field wide"><label>挂载分类 *（章节分类 + 知识点分类，两边都至少勾一项）</label>
        <div class="mf-grid2">
          <div><select id="qeCTree" class="inp">${chapTrees.length ? chapTrees.map((t) => `<option value="${t.id}" ${defC && t.id === defC.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('') : '<option value="">（暂无章节树）</option>'}</select>
            <div id="qeCNodes" class="mf-pick" style="margin-top:6px;max-height:160px"></div></div>
          <div><select id="qeKTree" class="inp">${knowTrees.length ? knowTrees.map((t) => `<option value="${t.id}" ${defK && t.id === defK.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('') : '<option value="">（暂无知识点树）</option>'}</select>
            <div id="qeKNodes" class="mf-pick" style="margin-top:6px;max-height:160px"></div></div>
        </div></div>
    </div>`,
    onMount: (w) => {
      aud = t7AudioWidget(w.querySelector('#qeAudio'), { key: q.audio_key, url: q.audio_url });
      if (!Array.isArray(q.images)) q.images = [];
      t8Enhance(w, { fields: ['#qeStem', '#qeOpts', '#qeAns', '#qeAna'], images: q.images });   // 公式输入 + 粘贴 / 拖拽图片（T8）
      const loadNodes = async (selId, boxId, cls) => {
        const tid = w.querySelector('#' + selId).value;
        if (!tid) { w.querySelector('#' + boxId).innerHTML = '<span class="hint">暂无可用分类树</span>'; return; }
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${curNodes.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bindTree = (selId, boxId, cls) => {
        w.querySelector('#' + selId).onchange = () => loadNodes(selId, boxId, cls);
        loadNodes(selId, boxId, cls);
      };
      bindTree('qeCTree', 'qeCNodes', 'qe-cnd');
      bindTree('qeKTree', 'qeKNodes', 'qe-knd');
    },
    onOk: async (w, showErr) => {
      const chapIds = [...w.querySelectorAll('.qe-cnd:checked')].map((c) => Number(c.value));
      const knowIds = [...w.querySelectorAll('.qe-knd:checked')].map((c) => Number(c.value));
      if (!chapTrees.length || !knowTrees.length) return showErr('缺少章节树或知识点树，请先建树');
      if (!chapIds.length) return showErr('章节分类至少勾一项');
      if (!knowIds.length) return showErr('知识点分类至少勾一项');
      const body = {
        type: w.querySelector('#qeType').value, subject: w.querySelector('#qeSub').value, stage: w.querySelector('#qeStage').value,
        difficulty: Number(w.querySelector('#qeDiff').value) || 3,
        stem: w.querySelector('#qeStem').value,
        stem_html: q.stem_html || '',
        options: w.querySelector('#qeOpts').value.split('\n').map((s) => s.trim()).filter(Boolean),
        answer: w.querySelector('#qeAns').value, analysis: w.querySelector('#qeAna').value,
        grade: q.grade || '', point: q.point || '', material: q.material || '', source: q.source || '',
        year: q.year || '', images: q.images || [], tags: q.tags || [],
        audio_key: aud ? aud.get() : (q.audio_key || ''),
        source_type: q.source_type || 'local', source_detail: q.source_detail || {},
        nodes: [...new Set([...chapIds, ...knowIds])],
      };
      await api(`${MF_API}/questions/${id}`, { method: 'PUT', body });
      toast('已保存', 'ok'); done && done();
    },
  });
}

/** 批量操作分发 */
async function mfBatch(op, ids, st, done) {
  if (op === 'clear') { st.sel = {}; return done(); }
  if (!ids.length) return toast('先勾选题目', 'err');
  if (op === 'del') {
    if (!(await elConfirm({ title: '批量删除', message: `确定删除选中的 ${ids.length} 题？不可恢复。`, okText: '删除', danger: true }))) return;
    await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'delete' } });
    st.sel = {}; toast(`已删除 ${ids.length} 题`, 'ok'); return done();
  }
  if (op === 'tag' || op === 'wrong') {
    const tags = op === 'wrong' ? ['错题'] : null;
    if (!tags) {
      await new Promise((resolve) => {
        modal({ title: '批量添加标签', body: `<div class="field"><label>标签（逗号分隔）</label><input id="btTags" class="inp" placeholder="如：期中,高频考点"></div>`,
          onOk: async (w) => {
            const t = w.querySelector('#btTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            if (!t.length) return false;
            await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'tag', tags: t } });
            toast('已打标', 'ok'); resolve(); done();
          } });
      });
      return;
    }
    await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'tag', tags } });
    toast(`已给 ${ids.length} 题标记「${tags[0]}」`, 'ok'); return done();
  }
  if (op === 'aiclean') return mfBatchAiClean(ids, done);
  if (op === 'aisug') return mfBatchAiSuggest(ids, st, done);
  if (op === 'basket') {
    const papers = (await api(`${MF_API}/papers?status=basket`, { silent: true }).catch(() => ({ list: [] }))).list || [];
    modal({ title: '批量加入试题篮', body: `<div class="field"><label>加入哪个试题篮（试卷）</label>
      <select id="bbPaper">${papers.map((p) => `<option value="${p.id}">${esc(p.title)}（${p.qcount}题）</option>`).join('')}</select>
      <div class="hint" style="margin-top:6px">没有合适的？先去「试卷管理」新建一个（篮状态），或直接选「新建」</div>
      <div class="field" style="margin-top:8px"><label>或新建试题篮</label><input id="bbNew" class="inp" placeholder="填了就按这个名称新建"></div></div>`,
      onOk: async (w) => {
        let pid = w.querySelector('#bbPaper').value;
        const newName = w.querySelector('#bbNew').value.trim();
        if (newName) {
          const d = await api(MF_API + '/papers', { method: 'POST', body: { title: newName, status: 'basket' } });
          pid = d.id;
        }
        if (!pid) return false;
        await api(`${MF_API}/papers/${pid}/questions`, { method: 'POST', body: { question_ids: ids } });
        toast(`已把 ${ids.length} 题加入试题篮，去「试卷管理」排版`, 'ok'); done();
      } });
    return;
  }
}

/** AI 整理（逐题 AI 清洗 + 对照确认，对齐魔方 AiCleanDialog） */
async function mfBatchAiClean(ids, done) {
  const results = [];
  const tip = toast(`AI 整理中：0/${ids.length}`, '');
  for (let i = 0; i < ids.length; i++) {
    try {
      const d = await api(`${MF_API}/ai-clean`, { method: 'POST', body: { id: ids[i], field: 'stem' } });
      const q = await api(`${MF_API}/questions/${ids[i]}`, { silent: true });
      results.push({ id: ids[i], before: (q.question.stem || '').slice(0, 500), after: d.text });
    } catch (e) { /* 单题失败跳过 */ }
    if (tip) tip.querySelector('.el-message__content').textContent = `AI 整理中：${i + 1}/${ids.length}`;
  }
  setTimeout(() => tip && tip.remove(), 300);
  if (!results.length) return toast('没有题目整理成功', 'err');
  let idx = 0;
  const showOne = () => {
    const r = results[idx];
    modal({
      title: `AI 整理对照（${idx + 1}/${results.length}）`, wide: true, okText: idx === results.length - 1 ? '应用并完成' : '应用，下一题',
      body: `<div class="mf-grid2">
        <div class="mf-box"><h4>整理前</h4><div class="mf-qtext" style="max-height:220px;overflow:auto">${esc(r.before)}</div></div>
        <div class="mf-box" style="border-color:#a5b4fc"><h4 style="color:#4f46e5">整理后</h4><div class="mf-qtext" style="max-height:220px;overflow:auto">${esc(r.after)}</div></div>
      </div>`,
      onOk: async () => {
        await api(`${MF_API}/questions/${r.id}`, { method: 'PUT', body: { stem: r.after, stem_html: esc(r.after).replace(/\n/g, '<br>') } });
        idx++;
        if (idx < results.length) showOne();
        else { toast('AI 整理完成', 'ok'); done(); }
      },
    });
  };
  showOne();
}

/** AI 建议（打标 + 挂树建议，人确认后写入） */
async function mfBatchAiSuggest(ids, st, done) {
  toast('AI 正在分析，请稍候…', '');
  const d = await api(MFX + '/ai-suggest', { method: 'POST', body: { ids } });
  const list = d.list || [];
  modal({
    title: 'AI 建议（勾选后应用）', wide: true, okText: '应用所选',
    body: `<div style="max-height:400px;overflow:auto">${list.map((r) => `<div class="mf-qcard" data-id="${r.id}">
      <b>#${r.id}</b>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
        ${(r.tags || []).map((t) => `<label class="tag" style="cursor:pointer"><input type="checkbox" class="as-tag" data-id="${r.id}" value="${esc(t)}" checked> ${esc(t)}</label>`).join('') || '<span class="hint">无标签建议</span>'}
      </div>
      <div class="row" style="gap:6px;margin-top:4px">
        ${r.tree_name ? `<label class="hint" style="cursor:pointer"><input type="checkbox" class="as-node" data-id="${r.id}" data-tree="${r.tree_id}" value="${(r.node_ids || [])[0] || ''}" ${(r.node_ids || []).length ? 'checked' : ''}> 挂到「${esc(r.tree_name)}」建议节点</label>` : '<span class="hint">无挂树建议（该学科还没有树）</span>'}
      </div></div>`).join('')}</div>`,
    onOk: async (w) => {
      let nTag = 0, nNode = 0;
      const byId = {};
      w.querySelectorAll('.as-tag:checked').forEach((c) => { (byId[c.dataset.id] = byId[c.dataset.id] || { tags: [], nodes: {} }); byId[c.dataset.id].tags.push(c.value); });
      w.querySelectorAll('.as-node:checked').forEach((c) => { const v = Number(c.value); if (v) { (byId[c.dataset.id] = byId[c.dataset.id] || { tags: [], nodes: {} }); byId[c.dataset.id].nodes[v] = c.dataset.tree; } });
      for (const [qid, v] of Object.entries(byId)) {
        if (v.tags.length) { await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids: [Number(qid)], op: 'tag', tags: v.tags } }); nTag++; }
        const nodes = Object.keys(v.nodes).map(Number);
        if (nodes.length) { await api(`${MF_API}/questions/${qid}/nodes`, { method: 'POST', body: { node_ids: nodes } }); nNode++; }
      }
      toast(`已应用：${nTag} 题打标、${nNode} 题挂树`, 'ok'); done();
    },
  });
}

/* ================================================================ 网络采集（内嵌浏览器） */
async function viewMfCapture() {
  const st = mfState('mfc');
  st.tab = st.tab || 'browser';
  st.hist = st.hist || [];
  st.hi = st.hi || 0;
  if (!st.url) st.url = MF_SITES[0].url;
  const batches = (await api(MF_API + '/capture/batches?questions=1', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const stName = { zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一组卷网', generic: '通用' };

  const batchesTable = (list, paperMode) => list.length ? `<table class="tb"><thead><tr><th style="min-width:180px">批次</th><th style="width:100px">来源</th><th style="width:64px">题数</th><th style="width:80px">状态</th><th style="width:${paperMode ? 210 : 200}px">操作</th></tr></thead>
    <tbody>${list.map((b) => `<tr><td>${esc(b.title)}</td><td>${stName[b.site] || b.site}</td><td>${b.count}</td>
      <td><span class="tag ${b.status === 'done' ? 'ok' : ''}">${b.status === 'done' ? '已入库' : '待入库'}</span></td>
      <td><button class="btn ghost xs" data-view="${b.id}">查看</button>
          <button class="btn ghost xs" data-commit="${b.id}">入库</button>
          ${paperMode ? `<button class="btn ghost xs" data-mkpaper="${b.id}">建卷导出</button>` : ''}
          <button class="btn ghost xs" data-delb="${b.id}">删</button></td></tr>`).join('')}</tbody></table>`
    : `<div class="mf-empty"><div style="font-size:36px">🧺</div>${paperMode ? '还没有整卷批次' : '还没有采集批次，去「浏览器」标签逛一逛，或用一键采集'}</div>`;

  const basketBatches = batches.filter((b) => !Number(b.paper_mode));
  const paperBatches = batches.filter((b) => Number(b.paper_mode));
  const TYPE_CN = { single: '单选', multi: '多选', judge: '判断', fill: '填空', answer: '解答' };
  const basketCards = [];
  basketBatches.forEach((b) => {
    (b.questions || []).forEach((q, i) => {
      basketCards.push(`<div class="mf-qcard">
        <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
          <input type="checkbox" class="bkck" data-bid="${b.id}" data-idx="${i}" checked style="margin-top:3px">
          <span><b>#${basketCards.length + 1}</b>（${TYPE_CN[q.type] || '解答'}）
            <span class="tag">${stName[b.site] || b.site || '网页'}</span> <span class="hint">${esc(b.title)}</span></span>
        </label>
        <div class="mf-qtext">${esc(String(q.stem || q.stemHtml || '').replace(/<[^>]+>/g, ' ').slice(0, 220))}</div>
        ${q.answer ? `<div class="hint">答案：${esc(String(q.answer).slice(0, 120))}</div>` : ''}
        <a href="javascript:;" class="bk-del hint" data-bid="${b.id}" data-idx="${i}" style="color:#dc2626">移除</a>
      </div>`);
    });
  });
  const basketCount = basketBatches.reduce((s, b) => s + (b.questions ? b.questions.length : b.count), 0);

  const html = `<div style="max-width:1200px;margin:0 auto">
    <div style="margin-bottom:8px"><a href="#/paper" style="color:#6b7280;font-size:13px;text-decoration:none">← 返回</a></div>
    <div class="card">
      <div class="card-h"><h3>${ic('link')} 网络采集</h3>
        <div class="card-h-r row" style="gap:8px">
          <div class="mf-segs">
            <button class="btn sm ${st.tab === 'browser' ? 'primary' : 'ghost'}" data-tab="browser">浏览器</button>
            <button class="btn sm ${st.tab === 'capture' ? 'primary' : 'ghost'}" data-tab="capture">试题采集</button>
            <button class="btn sm ${st.tab === 'paper' ? 'primary' : 'ghost'}" data-tab="paper">整卷下载</button>
          </div>
          <button class="btn ghost sm" data-go-paper>返回组卷</button>
        </div></div>
    <div class="card-b">
      ${st.tab === 'browser' ? `
        <div class="mf-nav">
          <button class="btn ghost sm" id="mfBack" title="后退">←</button>
          <button class="btn ghost sm" id="mfFwd" title="前进">→</button>
          <button class="btn ghost sm" id="mfReload" title="刷新">⟳</button>
          <input id="mfUrlBar" class="inp" style="flex:1;height:34px" placeholder="输入网址，回车打开" value="${esc(st.url)}">
          <span class="mf-dot" id="mfSiteDot">● ${esc((MF_SITES.find((s) => st.url.includes(s.host)) || {}).t || '网页')}</span>
          ${MF_SITES.map((s) => `<button class="btn sm ${st.url.includes(s.host) ? 'primary' : 'ghost'}" data-site="${s.url}">${s.t}</button>`).join('')}
          <button class="btn ghost sm" data-tab="capture" id="mfExport">导出试题篮</button>
          <button class="btn ghost sm" data-tab="paper" id="mfWhole">整卷下载</button>
          <button class="btn ghost sm" id="mfClose">关闭浏览器</button>
        </div>
        <div class="mf-browser">
          <iframe id="mfFrame" src="about:blank" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-modals" style="width:100%;height:calc(100vh - 250px);min-height:520px;border:0;border-radius:8px;background:#fff"></iframe>
        </div>
        <div class="hint" style="margin-top:8px">页面右下角有「魔方采集」悬浮球：逛到有题的页面点「采集本页题目」，题进试题篮 → 到「试题采集」选学段学科入库；组卷网知识树页面会出现「采集本页知识树」。</div>
      ` : ''}
      ${st.tab === 'capture' ? `
        <div class="mf-box" style="margin-bottom:16px">
          <h4 style="margin:0 0 8px">⚡ 直链采集 · 粘贴试卷网址一键解析入库</h4>
          <div class="row" style="gap:10px">
            <input id="mfAutoUrl" class="inp" style="flex:1;height:36px" placeholder="粘贴试卷网址，如 https://zujuan.xkw.com/xxxxx">
            <button class="btn primary" id="mfAutoGo" style="height:36px;padding:0 20px">⚡ 解析试卷</button>
            <button class="btn ghost" id="mfLogin" style="height:36px;padding:0 14px" title="需要登录的网站先在这里登录一次">🔑 登录 / 扫码</button>
          </div>
          <div class="hint" style="margin-top:6px">解析后先<b>预览题目</b>，确认无误点「直接入库」；需要登录的网站点「登录 / 扫码」在代理浏览器里登录一次（账号密码或扫码都行），cookie 自动保存，之后解析免登录。</div>
          <div id="mfParsed" style="margin-top:10px"></div>
        </div>
        <div class="row" style="gap:10px;margin-bottom:12px">
          <span style="color:#374151">学段:</span>
          <select id="bkStage" class="inp" style="width:130px;height:34px">
            <option value="">请选择</option>
            ${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${st.bStage === k ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <span style="color:#374151">学科:</span>
          <select id="bkSub" class="inp" style="width:130px;height:34px">
            <option value="">请选择</option>
            ${MF_SUBJECTS.map((s) => `<option ${st.bSub === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="btn primary" id="bkCommit" style="height:34px;padding:0 24px">入库</button>
          <button class="btn ghost sm" id="bkNew">＋ 新建试题篮</button>
        </div>
        <h4 style="margin:2px 0 8px">试题篮 · ${basketCount} 题</h4>
        <div id="bkList">${basketCards.join('') || '<div class="mf-empty"><div style="font-size:36px">🧺</div>试题篮是空的：去「浏览器」逛题目页点悬浮球采集，或在上方用直链采集收题</div>'}</div>
        <details style="margin:14px 0 0"><summary style="cursor:pointer;color:#6b7280;font-size:13px">更多采集方式：书签小工具 / 粘贴网页源码或题目文本</summary>
        <div class="mf-grid2" style="margin-top:10px">
          <div class="mf-box"><h4>书签小工具</h4>
            <p class="hint">在组卷网/菁优网把题加进试题篮，点收藏夹里的书签自动回传。</p>
            <button class="btn sm" id="mfBmToken">生成采集票据</button>
            <button class="btn ghost sm" id="mfBmJs">复制书签脚本</button>
            <textarea id="mfBmBox" class="inp" rows="3" placeholder="点上面按钮后出现内容"></textarea></div>
          <div class="mf-box"><h4>粘贴网页源码 / 题目文本</h4>
            <textarea id="mfRaw" class="inp" rows="4" placeholder="网页源代码 HTML 或纯文字题"></textarea>
            <div class="row"><input id="mfUrl" class="inp" placeholder="来源网址（选填）"><button class="btn sm" id="mfParse">解析</button></div></div>
        </div></details>
        <h4 style="margin:14px 0 8px">暂存批次</h4>
        ${batchesTable(basketBatches, false)}
      ` : ''}
      ${st.tab === 'paper' ? `
        <div class="mf-box" style="max-width:780px">
          <h4 style="margin:0 0 10px">整卷下载（组卷网）</h4>
          <div class="row" style="gap:10px">
            <input id="wpUrl" class="inp" style="flex:1;height:36px" placeholder="https://zujuan.xkw.com/4p2338916.html">
            <button class="btn primary" id="wpGo" style="height:36px;padding:0 18px">整卷下载</button>
          </div>
          <div class="hint" style="margin-top:6px">粘贴组卷整卷详情页 URL（(bankId)p(paperId).html），不占试题篮</div>
          <div id="wpOut" style="margin-top:10px"></div>
        </div>
        <h4 style="margin:14px 0 8px">整卷批次</h4>
        ${batchesTable(paperBatches, true)}
      ` : ''}
    </div></div></div>`;

  return {
    html,
    after: () => {
      document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { st.tab = b.dataset.tab; render(); }; });
      document.querySelectorAll('[data-go-paper]').forEach((b) => { b.onclick = () => { location.hash = '#/paper'; }; });
      const rerender = () => render();

      /* —— 浏览器标签 —— */
      if (st.tab === 'browser') {
        const frame = document.getElementById('mfFrame');
        const bar = document.getElementById('mfUrlBar');
        const dot = document.getElementById('mfSiteDot');
        const nav = async (url, push = true) => {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          const t = await api(MFX + '/proxy-ticket', { method: 'POST', silent: false }).catch(() => null);
          if (!t) return toast('拿不到代理票据，请重新登录', 'err');
          st.k = t.k; st.cap = t.capture;
          st.url = url;
          if (push) { st.hist = st.hist.slice(0, st.hi + 1); st.hist.push(url); st.hi = st.hist.length - 1; }
          frame.src = `/api/mfproxy/r?k=${encodeURIComponent(t.k)}&u=${encodeURIComponent(url)}`;
          dot.textContent = '● ' + ((MF_SITES.find((s) => url.includes(s.host)) || {}).t || '网页');
          bar.value = url;
        };
        if (window.__mfAutoNav) delete window.__mfAutoNav;
        // 进入页面自动打开上次网址（首次带票据）
        nav(st.url, false);
        frame.addEventListener('load', () => {
          try {
            const h = frame.contentWindow.location.href;
            if (h && h !== 'about:blank' && h.includes('/api/mfproxy')) {
              const u = new URL(h);
              const real = u.searchParams.get('u');
              if (real) { bar.value = real; st.url = real; dot.textContent = '● ' + ((MF_SITES.find((s) => real.includes(s.host)) || {}).t || '网页'); }
            }
          } catch (e) { /* 忽略 */ }
        });
        document.getElementById('mfBack').onclick = () => { if (st.hi > 0) { st.hi--; nav(st.hist[st.hi], false); } };
        document.getElementById('mfFwd').onclick = () => { if (st.hi < st.hist.length - 1) { st.hi++; nav(st.hist[st.hi], false); } };
        document.getElementById('mfReload').onclick = () => { nav(st.url, false); };
        document.getElementById('mfClose').onclick = () => { frame.src = 'about:blank'; };
        bar.onkeydown = (e) => { if (e.key === 'Enter') nav(bar.value.trim()); };
        document.querySelectorAll('[data-site]').forEach((b) => { b.onclick = () => nav(b.dataset.site); });
      }

      /* —— 试题采集标签 —— */
      if (st.tab === 'capture') {
        /* 试题篮：勾选题 → 选学段学科 → 入库 */
        document.getElementById('bkCommit').onclick = async () => {
          const stage = document.getElementById('bkStage').value, subject = document.getElementById('bkSub').value;
          if (!stage || !subject) return toast('先选好学段和学科再入库', 'err');
          st.bStage = stage; st.bSub = subject;
          const sel = {};
          document.querySelectorAll('.bkck:checked').forEach((c) => { (sel[c.dataset.bid] = sel[c.dataset.bid] || []).push(Number(c.dataset.idx)); });
          const keys = Object.keys(sel);
          if (!keys.length) return toast('试题篮里没有勾选题目', 'err');
          let created = 0, updated = 0;
          for (const bid of keys) {
            const d = await api(`${MF_API}/capture/batches/${bid}/commit`, { method: 'POST', body: { selected: sel[bid], subject, stage, grade: '' } });
            created += d.created || 0; updated += d.updated || 0;
          }
          toast(`入库完成：新增 ${created} 题、补缺 ${updated} 题，都进「题库管理」了`, 'ok'); rerender();
        };
        document.getElementById('bkNew').onclick = async () => {
          await api(MF_API + '/capture/batches', { method: 'POST', body: { basket: 1, title: `试题篮 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` } });
          toast('新试题篮已建好：接下来用悬浮球「采集本页题目」或一键采集，题会收进最新的空篮', 'ok');
          rerender();
        };
        document.querySelectorAll('.bk-del').forEach((a) => { a.onclick = async () => {
          await api(`${MF_API}/capture/batches/${a.dataset.bid}/q/${a.dataset.idx}`, { method: 'DELETE' });
          toast('已移除', 'ok'); rerender();
        }; });
        document.getElementById('bkStage').onchange = (e) => { st.bStage = e.target.value; };
        document.getElementById('bkSub').onchange = (e) => { st.bSub = e.target.value; };

        const showParsed = (d, url) => {
          const parsed = d.questions || [];
          document.getElementById('mfParsed').innerHTML = `<div class="mf-parsed">
            <div class="row" style="justify-content:space-between">
              <b>解析出 ${parsed.length} 题（${stName[d.site] || d.site}${d.via === 'ai' ? ' · AI 识别' : ''}）</b>
              <span>
                <button class="btn primary sm" id="mfDirectCommit">✅ 直接入库</button>
                <button class="btn sm" id="mfSaveBatch">存进试题篮</button></span></div>
            ${parsed.map((q, i) => `<div class="mf-qcard">
              <label><input type="checkbox" class="mfpck" value="${i}" checked> 第 ${i + 1} 题（${({ single: '单选', multi: '多选', judge: '判断', fill: '填空', answer: '解答' })[q.type] || '解答'}）</label>
              <div class="mf-qtext">${esc((q.stem || '').slice(0, 200))}</div>
              ${q.answer ? `<div class="hint">答案：${esc(q.answer)}</div>` : ''}</div>`).join('')}
            <div class="hint" style="margin-top:6px">直接入库用上方的学段/学科选择；默认全部勾选，去掉勾选的题不入库。</div></div>`;
          const selIdx = () => [...document.querySelectorAll('.mfpck:checked')].map((c) => Number(c.value));
          document.getElementById('mfDirectCommit').onclick = async (ev) => {
            const btn = ev.currentTarget;
            const sel = selIdx();
            if (!sel.length) return toast('至少勾一题', 'err');
            const stage = (document.getElementById('bkStage') || {}).value || st.bStage || '';
            const subject = (document.getElementById('bkSub') || {}).value || st.bSub || '';
            if (!stage || !subject) return toast('先在上面的「学段 / 学科」里选好再直接入库', 'err');
            st.bStage = stage; st.bSub = subject;
            btn.disabled = true; btn.textContent = '入库中…';
            try {
              const b = await api(MF_API + '/capture/batches', { method: 'POST', body: { title: `直链采集 ${stName[d.site] || d.site} ${sel.length} 题`, site: d.site, url, questions: sel.map((i) => parsed[i]) } });
              const r = await api(`${MF_API}/capture/batches/${b.id}/commit`, { method: 'POST', body: { selected: sel, subject, stage, grade: '' } });
              toast(`入库完成：新增 ${r.created || 0} 题、补缺 ${r.updated || 0} 题，都进「题库管理」了`, 'ok');
              rerender();
            } catch (e) { btn.disabled = false; btn.textContent = '✅ 直接入库'; }
          };
          document.getElementById('mfSaveBatch').onclick = async () => {
            const sel = selIdx();
            if (!sel.length) return toast('至少勾一题', 'err');
            await api(MF_API + '/capture/batches', { method: 'POST', body: { title: `${stName[d.site] || d.site}采集 ${sel.length} 题`, site: d.site, url, questions: sel.map((i) => parsed[i]) } });
            toast('已存进试题篮', 'ok'); rerender();
          };
        };
        const autoBtn = document.getElementById('mfAutoGo');
        autoBtn.onclick = async () => {
          const url = document.getElementById('mfAutoUrl').value.trim();
          if (!url) { document.getElementById('mfAutoUrl').focus(); return toast('先粘贴网址', 'err'); }
          autoBtn.disabled = true; autoBtn.textContent = '解析中…';
          try {
            const d = await api(MF_API + '/capture/auto', { method: 'POST', body: { url } });
            showParsed(d, url);
          } catch (e) { /* api 已提示 */ }
          autoBtn.disabled = false; autoBtn.textContent = '⚡ 解析试卷';
        };
        document.getElementById('mfAutoUrl').onkeydown = (e) => { if (e.key === 'Enter') autoBtn.click(); };
        document.getElementById('mfLogin').onclick = () => {
          const raw = document.getElementById('mfAutoUrl').value.trim();
          if (raw) { try { st.url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; } catch (e) { /* 保持原网址 */ } }
          st.tab = 'browser';
          toast('已在「浏览器」标签打开该网站：在页面里登录账号或扫码，完成后 cookie 自动保存，回「试题采集」直接解析即可', 'ok');
          render();
        };
        document.getElementById('mfBmToken').onclick = async () => {
          const d = await api(MF_API + '/capture/token');
          document.getElementById('mfBmBox').value = d.token;
          toast('票据已生成（90 天有效）', 'ok');
        };
        document.getElementById('mfBmJs').onclick = async () => {
          const d = await api(`${MF_API}/capture/bookmarklet?base=${encodeURIComponent(location.origin)}`);
          const box = document.getElementById('mfBmBox');
          box.value = d.js; box.select();
          try { document.execCommand('copy'); toast('脚本已复制：新建书签，网址填它即可', 'ok'); } catch (e) { toast('已生成，请手动复制', 'ok'); }
        };
        document.getElementById('mfParse').onclick = async () => {
          const raw = document.getElementById('mfRaw').value;
          if (!raw.trim()) return toast('先粘贴内容', 'err');
          const url = document.getElementById('mfUrl').value.trim();
          const isHtml = /<[a-z][\s\S]*>/i.test(raw);
          const d = await api(MF_API + '/capture/parse', { method: 'POST', body: { [isHtml ? 'html' : 'text']: raw, url } });
          showParsed(d, url);
        };
      }

      /* —— 整卷下载标签 —— */
      if (st.tab === 'paper') {
        const go = document.getElementById('wpGo');
        go.onclick = async () => {
          const url = document.getElementById('wpUrl').value.trim();
          if (!/^https?:\/\//i.test(url)) { document.getElementById('wpUrl').focus(); return toast('先粘贴整卷详情页网址', 'err'); }
          go.disabled = true; go.textContent = '下载中…';
          try {
            const d = await api(MF_API + '/capture/auto', { method: 'POST', body: { url } });
            const qs = d.questions || [];
            if (!qs.length) {
              toast('抓到了页面，但没认出题目：可能要登录（去「浏览器」登录后再试）或页面是图片卷', 'err');
            } else {
              await api(MF_API + '/capture/batches', { method: 'POST', body: { paper_mode: 1, site: d.site, url, title: `整卷 ${d.site_name || d.site || ''} ${qs.length} 题`, questions: qs } });
              document.getElementById('wpOut').innerHTML = `<div class="mf-tip">✅ 解析出 <b>${qs.length}</b> 题${d.via === 'ai' ? '（AI 识别）' : ''}，已存为整卷批次 —— 在下方列表「入库」选学段学科，或「建卷导出」直接成卷。</div>`;
              toast(`整卷下载完成：解析出 ${qs.length} 题`, 'ok');
              setTimeout(rerender, 800);
            }
          } catch (e) { /* api 已提示 */ }
          go.disabled = false; go.textContent = '整卷下载';
        };
        document.getElementById('wpUrl').onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
      }

      /* —— 批次操作（两个标签共用） —— */
      document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = async () => {
        const d = await api(`${MF_API}/capture/batches/${b.dataset.view}`);
        modal({ title: d.batch.title, wide: true, okText: '关闭', body: d.batch.questions.map((q, i) =>
          `<div class="mf-qcard"><b>${i + 1}.</b> ${esc((q.stem || q.stemHtml || '').slice(0, 300))}
          ${(q.options || []).length ? `<div class="hint">${esc((q.options || []).join(' / ').slice(0, 200))}</div>` : ''}
          ${q.answer ? `<div class="hint">答案：${esc(q.answer)}</div>` : ''}</div>`).join('') });
      }; });
      document.querySelectorAll('[data-commit]').forEach((b) => { b.onclick = () => mfCommitForm(Number(b.dataset.commit)); });
      document.querySelectorAll('[data-mkpaper]').forEach((b) => {
        b.onclick = () => {
          modal({ title: '整卷建卷', body: `<div class="mf-form">
            <div class="field wide"><label>试卷名</label><input id="mpTitle" class="inp"></div>
            <div class="field"><label>学科</label><select id="mpSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
            <div class="field"><label>学段</label><select id="mpStage">${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div></div>`,
            onOk: async (w) => {
              const d = await api(MF_API + '/capture/batches/' + b.dataset.mkpaper);
              const title = w.querySelector('#mpTitle').value.trim() || d.batch.title;
              await api(MF_API + '/papers', { method: 'POST', body: { title, subject: w.querySelector('#mpSub').value, stage: w.querySelector('#mpStage').value, status: 'basket' } });
              toast(`试卷《${title}》已建好，入库时「加入试卷」选它即可`, 'ok');
              // 打开入库表单（复用弹层），入库完成题就进了题库和这份卷
              mfCommitForm(Number(b.dataset.mkpaper));
            } });
        };
      });
      document.querySelectorAll('[data-delb]').forEach((b) => { b.onclick = async () => {
        if (!(await elConfirm({ title: '删除批次', message: '只删暂存，不影响已入库的题目。确定？', okText: '删除', danger: true }))) return;
        await api(`${MF_API}/capture/batches/${b.dataset.delb}`, { method: 'DELETE' }); toast('已删除', 'ok'); rerender();
      }; });
    },
  };
}

/* ================================================================ 设置（AI 配置管理 / 字典映射） */
async function viewMfSet() {
  const prof = await api(MFX + '/profiles', { silent: true }).catch(() => ({ list: [], roles: [], presets: [], total: 0, enabled_count: 0 }));
  const dict = await api(MFX + '/dict', { silent: true }).catch(() => ({ counts: { total: 0, unknown: 0, trees: 0 } }));
  const cur = await api('/api/admin/ai/config', { silent: true }).catch(() => null);   // 现在实际生效的配置（T2）

  // AI 能力清单：学生端 + 管理后台所有用到 AI 大模型的接口，按「可共用一个模型」分组
  const AI_GROUPS = [
    {
      role: 'reasoning', icon: '💬', name: '文本生成（共用一个对话模型）',
      desc: '所有文字类 AI 能力共用这一个模型，配置一次全部生效。',
      feats: [
        ['AI 学情诊断 / 学习报告分析', '管理后台 · AI学情诊断，学生端 · 学习报告'],
        ['词汇速记 AI（例句结构 / 记忆提示）', '学生端 · 单词速记 / 语境记忆 / 连词成句'],
        ['智能组卷 AI 解析', '管理后台 · 智能组卷'],
        ['题库 AI（AI 整理 / AI 归属建议 / 采集清洗）', '管理后台 · 题库管理 / 网络采集 / 录题上传'],
      ],
    },
    {
      role: 'vision', icon: '📷', name: '图像识别（共用一个视觉模型）',
      desc: '所有拍照识图类 AI 能力共用这一个模型（需勾选「支持图片输入」）。',
      feats: [
        ['录题上传整页识别', '管理后台 · 录题上传（整页试卷图 → 题卡）'],
        ['习题拍照识别入库', '管理后台 · 智能组卷 / 课程习题拍照录题'],
      ],
    },
    {
      role: '', icon: '🔊', name: '语音 / 图像生成（内置，无需配置）',
      desc: '走服务器内置的阿里云百炼通道，已配好 Key，不占用上面的对话 / 视觉模型。',
      feats: [
        ['发音合成 TTS（音标 / 单词 / 例句朗读）', '学生端 · 音标训练 / 词书跟读 / 听写'],
        ['课程封面 AI 生成', '管理后台 · 音标训练课程封面'],
      ],
    },
  ];
  const roleStatus = (role) => {
    if (!role) return '<span class="tag ok">内置已配置</span>';
    const ps = prof.list.filter((p) => p.role === role);
    const on = ps.find((p) => p.is_enabled);
    if (on) return `<span class="tag ok">已启用：${esc(on.name)} · ${esc(on.model)}</span>`;
    if (ps.length) return `<span class="tag warn">已建 ${ps.length} 个档案 · 未启用</span>`;
    return '<span class="tag err">未配置（用其它已启用的档案；都没有就用内置配置）</span>';
  };

  const html = `<div class="card" style="max-width:980px;margin:0 auto">
    <div class="card-h"><h3>${ic('setting')} AI 配置中心</h3></div>
    <div class="card-b">

      <div class="mf-setcard">
        <div class="mf-sett"><b>AI 配置（全站唯一入口）</b></div>
        <div class="hint">学生端 + 管理后台<b>所有用到 AI 大模型的能力</b>都读这里启用的档案，按「能不能共用一个模型」分组 —— 配置一次全部生效，切换档案后立即全站切换。一个档案 = 一个接口：选<b>格式</b>（OpenAI 兼容 / Anthropic / Gemini）→ 填接口地址、密钥、模型 → 测试连接 → 启用。密钥保存在服务器数据库里，界面只写不回显。</div>
        <div class="mf-prole" style="margin-top:10px"><div class="mf-prole-t"><b>⚡ 当前生效</b>　${cur ? (cur.mock ? '<span class="tag warn">演示模式（AI_MOCK=1，不调外部接口）</span>' : (cur.hasKey ? `<span class="tag ok">${esc(cur.via === 'builtin' ? '内置配置（没有启用任何档案）' : cur.via)} · ${esc(cur.model)} · ${esc({ openai: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini' }[cur.format] || cur.format)}</span>` : '<span class="tag err">没有可用配置</span>')) : '<span class="tag">读取失败</span>'}
          <button class="btn ghost xs" id="mfTestCur" style="margin-left:8px">测试当前配置</button><span id="mfTestCurMsg" class="hint" style="margin-left:8px"></span></div></div>
        ${AI_GROUPS.map((g) => `
          <div class="mf-prole" style="margin-top:10px">
            <div class="mf-prole-t"><b>${g.icon} ${g.name}</b>　${roleStatus(g.role)}</div>
            <div class="hint" style="margin:2px 0 6px">${g.desc}</div>
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;background:#fafbff">
              ${g.feats.map(([t, w]) => `<div style="display:flex;gap:10px;font-size:13px;line-height:1.9"><span style="flex:0 0 auto">· ${esc(t)}</span><span style="flex:1;color:#94a3b8;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w)}</span></div>`).join('')}
            </div>
            ${g.role ? `<div style="margin-top:8px"><button class="btn primary sm" data-aigroup="${g.role}">配置${g.role === 'vision' ? '视觉' : '对话'}模型</button>
              <span class="hint">　新建档案 / 快捷设置 / 测试 / 启用</span></div>` : ''}
          </div>`).join('')}
        <div class="hint" style="margin-top:12px;border-top:1px dashed #e5e7eb;padding-top:10px">
          某个角色没有启用的档案时，会自动用别的已启用档案（所以只配一个模型也能全站通用）；一个档案都没启用时才用服务器内置配置。
          <a href="javascript:;" id="mfAiHelp" style="color:#6366f1;margin-left:8px">📖 配置教程（去哪个网站、怎么拿 Key）</a></div>
      </div>

      <div class="mf-setcard">
        <div class="mf-sett"><b>字典 / 树映射</b><button class="btn ghost sm" id="mfOpenDict">查看映射</button></div>
        <div class="hint">采集来源同义值 → 标准码映射、知识树站点来源的只读查看；未识别的字典值可在此指认归位。</div>
        <div class="mf-setnum">字典 ${dict.counts.total} 行 · 未知值 ${dict.counts.unknown} · 树 ${dict.counts.trees} 棵</div>
      </div>

    </div></div>`;

  return {
    html,
    after: () => {
      document.querySelectorAll('[data-aigroup]').forEach((b) => { b.onclick = () => mfProfileDialog(b.dataset.aigroup); });
      document.getElementById('mfOpenDict').onclick = () => mfDictDialog();
      document.getElementById('mfTestCur').onclick = async () => {
        const box = document.getElementById('mfTestCurMsg'); box.style.color = ''; box.textContent = '测试中…';
        try { const r = await api('/api/admin/ai/test', { method: 'POST', silent: true }); box.style.color = '#0e9f5f'; box.textContent = '✅ ' + ((r && r.message) || '连接正常'); }
        catch (e) { box.style.color = '#e0343f'; box.textContent = '❌ ' + (e.message || '连接失败'); }
      };
      document.getElementById('mfAiHelp').onclick = () => mfHelpDialog();
    },
  };
}

/** 模型配置弹层（R1-R5 五角色档案列表 + 新建 + 快捷设置 + 测试 + 启用；onlyRole 只看某一个角色） */
async function mfProfileDialog(onlyRole) {
  const d = await api(MFX + '/profiles');
  const roles = onlyRole ? d.roles.filter((r) => r[0] === onlyRole) : d.roles;
  if (onlyRole && !roles.length) return toast('没有这个角色的档案定义', 'err');
  const roleRow = ([rk, rt, rd]) => {
    const ps = d.list.filter((p) => p.role === rk);
    const on = ps.find((p) => p.is_enabled);
    return `<div class="mf-prole" data-role="${rk}">
      <div class="mf-prole-t"><b>${rt}</b> <span class="hint">${rd}</span></div>
      <div class="mf-prole-b">
        ${on ? `<span class="tag ok">已启用：${esc(on.name)} · ${esc(on.model)}</span>` : `<span class="tag">${ps.length ? '未启用（测通后启用）' : '未配置'}</span>`}
        <button class="btn ghost xs" data-new="${rk}">新建档案</button>
        <button class="btn ghost xs" data-quick="${rk}">快捷设置</button>
        ${ps.map((p) => `<span class="mf-pitem">${esc(p.name)}（${esc(p.model)}）<span class="tag">${esc(p.format_name || 'OpenAI 兼容')}</span>${p.last_test_ok ? '<span class="tag ok">测通</span>' : (p.last_test_ok === false ? '<span class="tag err">未测通</span>' : '<span class="tag">未测</span>')}
          <a href="javascript:;" data-test="${p.id}">测试</a><a href="javascript:;" data-edit="${p.id}">编辑</a>${p.is_enabled ? '' : `<a href="javascript:;" data-en="${p.id}">启用</a>`}<a href="javascript:;" data-rm="${p.id}">删</a></span>`).join('')}
      </div></div>`;
  };
  modal({
    title: onlyRole ? `AI 配置 · ${MF_ROLE_NAME[onlyRole] || onlyRole}` : '模型配置', wide: true, okText: '关闭',
    body: `<div class="mf-tip" style="margin-bottom:10px">五个角色各管一摊，多用一个档多一份 capability；新档案须先测连通才能启用。Key 加密存本机，编辑时留空即不换 Key。</div>
      ${roles.map(roleRow).join('')}
      <div style="text-align:right;margin-top:14px"><a href="javascript:;" id="mfHelp" style="color:#6366f1;font-size:13px">📖 配置教程（去哪个网站、怎么拿 Key）</a></div>`,
    onMount: (w) => {
      const hp = w.querySelector('#mfHelp'); if (hp) hp.onclick = () => mfHelpDialog();
      w.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => mfProfileForm(b.dataset.new, null, onlyRole); });
      w.querySelectorAll('[data-edit]').forEach((a) => { a.onclick = () => {
        const p = d.list.find((x) => x.id === Number(a.dataset.edit));
        if (p) mfProfileForm(p.role, p, onlyRole);
      }; });
      w.querySelectorAll('[data-quick]').forEach((b) => { b.onclick = () => {
        const role = b.dataset.quick;
        const presets = d.presets.filter((p) => p.role === role);
        modal({ title: `快捷设置（${{ reasoning: 'R1 推理', vision: 'R2 OCR', light: 'R3 轻', embedding: 'R4 向量', specialty: 'R5 专用' }[role]}）——填入 API Key 一键接入`,
          body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
            <div class="field"><label>推荐项</label><select id="qsPre">${presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select></div>
            <div class="field"><label>API Key</label><input id="qsKey" class="inp" type="password" placeholder="粘贴 Key"></div>
            <div class="hint">点确定后自动建档 + 测连通 + 启用；失败会保留档案供修改重试。</div></div>`,
          onOk: async (wq) => {
            const p = presets[Number(wq.querySelector('#qsPre').value)];
            if (!p) return false;
            const key = wq.querySelector('#qsKey').value.trim();
            if (!key) return false;
            const r = await api(MFX + '/profiles/quick', { method: 'POST', body: { role, base_url: p.base_url, model: p.model, api_key: key } });
            toast(r && r.id ? '已配置并启用' : '已配置', 'ok'); mfProfileDialog(onlyRole);
          } });
      }; });
      w.querySelectorAll('[data-test]').forEach((a) => { a.onclick = async () => {
        a.textContent = '测试中…';
        await api(`${MFX}/profiles/${a.dataset.test}/test`, { method: 'POST' });
        toast('测通成功', 'ok'); mfProfileDialog(onlyRole);
      }; });
      w.querySelectorAll('[data-en]').forEach((a) => { a.onclick = async () => {
        await api(`${MFX}/profiles/${a.dataset.en}/enable`, { method: 'POST' });
        toast('已启用', 'ok'); mfProfileDialog(onlyRole);
      }; });
      w.querySelectorAll('[data-rm]').forEach((a) => { a.onclick = async () => {
        if (!(await elConfirm({ title: '删除档案', message: '确定删除这个模型档案？', okText: '删除', danger: true }))) return;
        await api(`${MFX}/profiles/${a.dataset.rm}`, { method: 'DELETE' }); mfProfileDialog(onlyRole);
      }; });
    },
  });
}

/** 五角色 AI 配置教程（模型配置弹窗右下角入口） */
function mfHelpDialog() {
  const step = (n, t) => `<div style="display:flex;gap:8px;margin:6px 0"><span style="flex:0 0 22px;height:22px;border-radius:50%;background:#6366f1;color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center">${n}</span><div style="flex:1;font-size:13px;line-height:1.7">${t}</div></div>`;
  const card = (t, inner) => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px"><div style="font-weight:700;margin-bottom:4px;font-size:14px">${t}</div>${inner}</div>`;
  modal({
    title: '五角色 AI 配置教程（跟着点就行）', wide: true, okText: '我知道了',
    body: `
    <div class="mf-tip" style="margin-bottom:10px">每个角色 = 一条独立通道。配置套路都一样：<b>① 去平台注册 → ② 创建 API Key 并复制 → ③ 回这里点「快捷设置」粘贴 Key → 确定</b>（自动建档+测连通+启用）。不配也能用：系统会自动回落内置 AI。</div>

    ${card('R1 推理 — 推荐用 DeepSeek（便宜、讲题强）', `
      ${step(1, '打开官网：<b>platform.deepseek.com</b>（开放平台，注意不是聊天版 chat.deepseek.com），手机号注册登录。')}
      ${step(2, '左侧菜单点「<b>API keys</b>」→「创建 API key」→ 随便起个名 → 复制弹出的 Key（<b>只显示这一次</b>，当场复制）。')}
      ${step(3, '左侧「<b>充值</b>」→ 微信/支付宝充值（10 元起，够用很久）。没余额调用会报错。')}
      ${step(4, '回到本页 → R1 那行点「<b>快捷设置</b>」→ 推荐项选「DeepSeek 推理」→ 粘贴 Key → 确定。')}`)}

    ${card('R2 OCR（看图识题）— 推荐硅基流动（有免费档）', `
      ${step(1, '打开官网：<b>cloud.siliconflow.cn</b>，注册登录（手机号/微信都行）。')}
      ${step(2, '左侧「<b>API 密钥</b>」→「新建 API 密钥」→ 复制。新用户送额度，部分小模型长期免费。')}
      ${step(3, '回到本页 → R2 那行点「<b>快捷设置</b>」→ 选「硅基流动 OCR」→ 粘贴 Key → 确定。')}
      <div style="font-size:12.5px;color:#6b7280;margin-top:6px">备选：阿里百炼 bailian.console.aliyun.com → 开通百炼 →「API-KEY 管理」创建 Key → 快捷设置选「阿里百炼视觉」。</div>`)}

    ${card('R3 轻（打标/分类）— 直接复用 R1 的 DeepSeek Key', `
      ${step(1, '<b>不用再去注册</b>。R3 干的是轻活，用 deepseek-chat 就够。')}
      ${step(2, 'R3 那行点「<b>快捷设置</b>」→ 选「DeepSeek 轻」→ 粘贴 <b>和 R1 同一个 Key</b> → 确定。')}`)}

    ${card('R4 向量（相似题检索）— 用硅基流动（免费），手动建档', `
      ${step(1, 'R4 没有「快捷设置」，点「<b>新建档案</b>」。')}
      ${step(2, '档案名称：填「硅基向量」；接口地址：<b>https://api.siliconflow.cn/v1</b>；模型名：<b>BAAI/bge-m3</b>（免费）；API Key：粘贴 <b>和 R2 同一个硅基流动 Key</b> → 保存。')}
      ${step(3, '回到列表点该档案的「<b>测试</b>」→ 测通后点「<b>启用</b>」。')}`)}

    ${card('R5 专用 — 预留位，平时不用管', `
      <div style="font-size:13px;line-height:1.7">留给以后接特殊第三方接口（非 openai-chat 协议）。现在空着完全不影响使用。</div>`)}

    ${card('测不通常见原因', `
      <div style="font-size:13px;line-height:1.9">
      ① Key 复制时带了空格或少了字符 → 删掉档案重新粘贴；<br>
      ② 账户没余额（DeepSeek 必须充值后才 能调用）；<br>
      ③ 手动填接口地址时没填到 <b>/v1</b> 为止；<br>
      ④ Key 被平台封禁（去平台后台看调用日志）。<br>
      Key 加密存在你这台服务器上，不会上传别处；编辑档案时 Key 留空 = 不修改原 Key。</div>`)}
    `,
  });
}

/** 导入题库（mofang-question-pack v1：JSON 或 ZIP，技能包可下载） */
function mfImportDialog(done) {
  modal({
    title: '导入题库',
    body: `<div style="font-size:13.5px;line-height:1.7">选择转写 <b>JSON</b> 或 <b>ZIP</b> 开始导入，也可以先获取技能包。</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin:14px 0 4px">
        <input type="file" id="mfImpFile" accept=".json,.zip" style="display:none">
        <button class="btn xs" id="mfImpPick">选择文件</button>
        <button class="btn ghost xs" id="mfImpCancel">取消</button></div>
      <div id="mfImpResult" style="font-size:13px;line-height:1.8"></div>
      <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:12px;font-size:13px;line-height:2">
        <b>还没有可导入的转写结果？先获取「魔方录题转写」技能包：</b><br>
        1、点【获取转写skill】，把技能包 ZIP 保存到电脑；<br>
        2、按技能包内的说明，把它装入你自己的 AI 助手；<br>
        3、把题目材料（截图 / 文档 / 文字）交给它转写；<br>
        4、回到本面板，把它生成的 JSON 或 ZIP 导入。<br>
        <button class="btn ghost xs" id="mfImpSkill" style="margin-top:6px">获取转写skill</button></div>`,
    onMount: (w) => {
      w.querySelector('#mfImpCancel').onclick = () => w.remove();
      w.querySelector('#mfImpSkill').onclick = async () => {
        try {
          const r = await fetch(MF_API + '/import-skill', { headers: { Authorization: 'Bearer ' + Auth.token } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const b = await r.blob();
          const u = URL.createObjectURL(b);
          const a = document.createElement('a'); a.href = u; a.download = 'mofang-question-transcribe.zip'; a.click();
          setTimeout(() => URL.revokeObjectURL(u), 4000);
          toast('技能包已开始下载', 'ok');
        } catch (e) { toast('下载失败：' + e.message, 'err'); }
      };
      w.querySelector('#mfImpPick').onclick = () => w.querySelector('#mfImpFile').click();
      w.querySelector('#mfImpFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const out = w.querySelector('#mfImpResult');
        out.innerHTML = '<span style="color:#6366f1">导入中，请稍候…</span>';
        try {
          const fd = new FormData(); fd.append('file', f);
          const r = await fetch(MF_API + '/import-pack', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.msg || '导入失败');
          const d = j.data || {};
          let html = `<b style="color:#16a34a">✅ ${esc(j.msg || '导入完成')}</b>（共 ${d.total} 题）`;
          if (d.warnings && d.warnings.length) html += `<div style="color:#d97706">${d.warnings.map(esc).join('<br>')}</div>`;
          if (d.errors && d.errors.length) html += `<div style="color:#dc2626;margin-top:4px">失败明细：<br>${d.errors.map((x) => esc((x.recordKey || '') + '：' + x.msg)).join('<br>')}</div>`;
          out.innerHTML = html;
          toast(j.msg, 'ok');
          if (typeof done === 'function') done();
        } catch (er) {
          out.innerHTML = `<span style="color:#dc2626">❌ ${esc(er.message)}</span>`;
        }
        e.target.value = '';
      };
    },
  });
}

/** 新建题目（章节分类 + 知识点分类 + AI 归属建议 + 公式计算器） */
async function mfNewQDialog(done) {
  let nqAud = null;   // 听力音频字段（T7）
  const imgs = []; const tags = []; const katChips = []; // 知识点归属 chips {id,name}
  const secSel = []; // 章节小知识点选中 ids
  let dStage = 'primary'; let dSub = '数学';
  let chapNodes = [], knowNodes = [];
  let gradeName = ''; let volName = '上册'; let unitId = '';
  let katExp = '';
  const GRADES = { primary: ['三年级', '四年级', '五年级', '六年级'], junior: ['七年级', '八年级', '九年级'] };
  const SUBJECTS4 = ['英语', '数学', '物理', '化学'];

  const loadTrees = async () => {
    const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
    const ct = trees.find((t) => t.kind === 'textbook' && t.subject === dSub && t.stage === dStage);
    const kt = trees.find((t) => t.kind === 'knowledge' && t.subject === dSub && t.stage === dStage);
    chapNodes = ct ? (await api(`${MF_API}/trees/${ct.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [] : [];
    knowNodes = kt ? (await api(`${MF_API}/trees/${kt.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [] : [];
  };
  const kidsOf = (list) => { const k = {}; list.forEach((n) => { const p = n.parent_id || 0; (k[p] = k[p] || []).push(n); }); return k; };

  modal({
    title: '新建题目', wide: true,
    body: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px">
        <div class="field"><label>学段</label><select id="nqStage" class="inp"><option value="primary">小学</option><option value="junior">初中</option></select></div>
        <div class="field"><label>学科</label><select id="nqSub" class="inp">${SUBJECTS4.map((x) => `<option ${x === '数学' ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label>题型（可空）</label><select id="nqType" class="inp"><option value="">未设置</option>${Object.entries(MF_TYPE_NAME).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
        <div class="field"><label>难度（可空）</label><select id="nqDiff" class="inp"><option value="">未设置</option>${Object.entries(MF_DIFF_NAMES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>章节分类 *（年级 → 册别 → 单元 → 小知识点）</label>
        <div style="display:flex;gap:8px">
          <select id="nqGrade" class="inp" style="flex:1"></select>
          <select id="nqVol" class="inp" style="flex:1"></select>
          <select id="nqUnit" class="inp" style="flex:2"></select>
        </div>
        <div id="nqSecs" style="display:flex;gap:8px 14px;flex-wrap:wrap;margin-top:6px;font-size:12.5px"></div>
      </div>
      <div class="field"><label>知识点分类 *（按学段，不含年级）</label>
        <select id="nqKat" class="inp"></select>
        <div id="nqKatKids" style="display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:6px;font-size:12.5px;align-items:center"></div>
      </div>
      <div class="field"><label>题面（必填）</label>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button class="btn ghost xs" id="nqFx" title="插入公式（计算器）">∑ fx</button>
          <button class="btn ghost xs" id="nqImg" title="插入图片">🖼</button>
          <button class="btn ghost xs" id="nqTbl" title="插入表格">▦</button>
          <button class="btn ghost xs" id="nqLst" title="插入列表">≡</button>
          <input type="file" id="nqImgFile" accept="image/*" style="display:none">
        </div>
        <div id="nqFpad" style="display:none;margin-bottom:6px"></div>
        <textarea id="nqStem" class="inp" rows="5" style="width:100%" placeholder="题干，公式点 ∑ fx 用公式计算器插入，图片点 🖼 上传"></textarea>
        <div id="nqImgs" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin:2px 0 8px">
        <div style="display:flex;gap:8px">
          <button class="btn ghost xs" id="nqAnsBtn">• 答案（空·点击补充）</button>
          <button class="btn ghost xs" id="nqAnaBtn">• 解析（空·点击补充）</button>
        </div>
        <span style="display:flex;gap:10px;align-items:center">
          <span class="hint" style="line-height:1.5">点 AI 归属建议：<br>AI 自动判断学段 / 年级 / 知识点 / 难度</span>
          <button class="btn ghost xs" id="nqAI" style="white-space:nowrap">✨ AI 归属建议</button>
        </span>
      </div>
      <div id="nqAnsWrap" style="display:none;margin-bottom:8px"><textarea id="nqAns" class="inp" rows="3" style="width:100%" placeholder="答案，支持公式；留空则入库为「缺答案」"></textarea></div>
      <div id="nqAnaWrap" style="display:none;margin-bottom:8px"><textarea id="nqAna" class="inp" rows="3" style="width:100%" placeholder="解析"></textarea></div>
      <div id="nqAudio"></div>
      <div class="field"><label>普通标签（与知识点分开）</label>
        <div style="display:flex;gap:8px"><input id="nqTagInp" class="inp" style="flex:1" placeholder="输入标签后回车或添加">
        <button class="btn ghost xs" id="nqTagAdd">添加标签</button></div>
        <div id="nqTags" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div></div>`,
    okText: '保存',
    onOk: async (w, showErr) => {
      const stem = w.querySelector('#nqStem').value.trim();
      if (!stem) return showErr('题面（题干）必填');
      const secIds = [...w.querySelectorAll('[data-sec]')].filter((x) => x.checked).map((x) => Number(x.dataset.sec)).filter(Boolean);
      const chapIds = secIds.length ? secIds : (unitId ? [Number(unitId)] : []);
      if (!chapIds.length) return showErr('请选择章节分类（年级 / 册别 / 单元）——每道题都必须归属章节');
      if (!katChips.length) return showErr('请在「知识点分类」至少勾选一个知识点——每道题都必须归属知识点');
      const nodeIds = [...new Set([...chapIds, ...katChips.map((c) => c.id)])];
      const gradeSel = w.querySelector('#nqGrade');
      await api(MF_API + '/questions', { method: 'POST', body: {
        stem,
        type: w.querySelector('#nqType').value || 'answer',
        stage: dStage,
        subject: dSub,
        grade: gradeSel.value || '',
        difficulty: w.querySelector('#nqDiff').value || 3,
        answer: w.querySelector('#nqAns').value.trim(),
        analysis: w.querySelector('#nqAna').value.trim(),
        options: [],
        images: imgs,
        audio_key: nqAud ? nqAud.get() : '',
        tags,
        nodes: nodeIds,
      } });
      toast('题目已入库', 'ok'); if (typeof done === 'function') done();
    },
    onMount: (w) => {
      nqAud = t7AudioWidget(w.querySelector('#nqAudio'), {});
      t8Enhance(w, { fields: ['#nqStem', '#nqAns', '#nqAna'], images: imgs, onImage: () => renderImgs() });   // 公式输入 + 粘贴 / 拖拽图片（T8）
      const ta = w.querySelector('#nqStem');
      const renderTags = () => { w.querySelector('#nqTags').innerHTML = tags.map((t, i) => `<span class="mf-pitem">${esc(t)}<a href="javascript:;" data-ti="${i}">✕</a></span>`).join(''); };
      const renderImgs = () => { w.querySelector('#nqImgs').innerHTML = imgs.map((u, i) => `<span style="position:relative;display:inline-block"><img src="${esc(u)}" style="height:44px;border-radius:6px;border:1px solid #e5e7eb"><a href="javascript:;" data-ii="${i}" style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border-radius:50%;width:16px;height:16px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none">✕</a></span>`).join(''); };

      /* —— 章节分类级联 —— */
      const renderChapter = () => {
        const ck = kidsOf(chapNodes);
        const gradeSel = w.querySelector('#nqGrade');
        const grades = GRADES[dStage] || [];
        gradeSel.innerHTML = grades.map((g) => `<option ${g === gradeName ? 'selected' : ''}>${g}</option>`).join('') || '<option value="">（无年级数据）</option>';
        gradeName = gradeSel.value;
        const gNode = chapNodes.find((n) => n.name === gradeName);
        const vols = gNode ? (ck[gNode.id] || []) : [];
        const volSel = w.querySelector('#nqVol');
        volSel.innerHTML = vols.length ? vols.map((v) => `<option value="${v.id}" ${v.name === volName ? 'selected' : ''}>${esc(v.name)}</option>`).join('') : '<option value="">（无册别）</option>';
        volName = (volSel.selectedOptions[0] && volSel.selectedOptions[0].textContent) || '';
        const vNode = vols.find((v) => String(v.id) === String(volSel.value));
        const units = vNode ? (ck[vNode.id] || []) : [];
        const unitSel = w.querySelector('#nqUnit');
        unitSel.innerHTML = units.length ? units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('') : '<option value="">（无单元数据）</option>';
        unitId = unitSel.value;
        const uNode = units.find((u) => String(u.id) === String(unitId));
        const secs = uNode ? (ck[uNode.id] || []) : [];
        [...secSel].forEach((id) => { if (!secs.some((x) => String(x.id) === String(id))) secSel.splice(secSel.indexOf(id), 1); });
        w.querySelector('#nqSecs').innerHTML = secs.length
          ? secs.map((sc) => `<label style="display:inline-flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-sec="${sc.id}" ${secSel.includes(Number(sc.id)) || secSel.includes(String(sc.id)) ? 'checked' : ''}> ${esc(sc.name)}</label>`).join('')
          : '<span class="hint">该单元下没有更细的小知识点，保存时归属整个单元</span>';
      };
      /* —— 知识点分类级联 —— */
      const renderKnowledge = () => {
        const kk = kidsOf(knowNodes);
        const roots = kk[0] || [];
        const katSel1 = w.querySelector('#nqKat');
        katSel1.innerHTML = roots.length ? roots.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') : '<option value="">（该学段科目暂无知识点树）</option>';
        const rNode = roots.find((r) => String(r.id) === String(katSel1.value));
        const children = rNode ? (kk[rNode.id] || []) : [];
        const box = w.querySelector('#nqKatKids');
        const chip = (n) => `<span class="mf-chipck ${katChips.some((x) => String(x.id) === String(n.id)) ? 'on' : ''}"><a href="javascript:;" data-kat="${n.id}">${katChips.some((x) => String(x.id) === String(n.id)) ? '☑' : '☐'} ${esc(n.name)}</a></span>`;
        box.innerHTML = children.length ? children.map((c) => {
          const gc = kk[c.id] || [];
          const exp = String(katExp) === String(c.id) && gc.length;
          return `<span style="display:inline-flex;gap:4px;align-items:center">${chip(c)}${gc.length ? `<a href="javascript:;" class="mf-kx" data-kexp="${c.id}">${exp ? '▴' : '▾'}</a>` : ''}</span>${exp ? gc.map(chip).join('') : ''}`;
        }).join('') : (rNode ? chip(rNode) : '<span class="hint">暂无知识点数据</span>');
      };
      const reloadTrees = async () => {
        gradeName = ''; volName = '上册'; unitId = ''; katExp = '';
        await loadTrees();
        renderChapter(); renderKnowledge();
      };

      /* —— 学段 / 学科切换 —— */
      w.querySelector('#nqStage').onchange = async (e) => {
        dStage = e.target.value;
        if (dStage === 'primary' && (dSub === '物理' || dSub === '化学')) { dSub = '数学'; w.querySelector('#nqSub').value = '数学'; }
        await reloadTrees();
      };
      w.querySelector('#nqSub').onchange = async (e) => { dSub = e.target.value; await reloadTrees(); };
      w.querySelector('#nqGrade').onchange = (e) => { gradeName = e.target.value; volName = '上册'; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqVol').onchange = (e) => { volName = (e.target.selectedOptions[0] && e.target.selectedOptions[0].textContent) || ''; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqUnit').onchange = (e) => { unitId = e.target.value; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqSecs').addEventListener('change', (e) => {
        const ck = e.target.closest('[data-sec]'); if (!ck) return;
        const id = Number(ck.dataset.sec);
        if (ck.checked) { if (!secSel.includes(id)) secSel.push(id); }
        else { const i = secSel.indexOf(id); if (i >= 0) secSel.splice(i, 1); }
      });
      w.querySelector('#nqKat').onchange = () => { katExp = ''; renderKnowledge(); };
      w.querySelector('#nqKatKids').onclick = (e) => {
        const kx = e.target.closest('[data-kexp]');
        if (kx) { katExp = String(katExp) === kx.dataset.kexp ? '' : kx.dataset.kexp; renderKnowledge(); return; }
        const a = e.target.closest('[data-kat]'); if (!a) return;
        const id = Number(a.dataset.kat);
        const all = knowNodes.find((n) => Number(n.id) === id);
        const i = katChips.findIndex((x) => String(x.id) === String(id));
        if (i >= 0) katChips.splice(i, 1);
        else katChips.push({ id, name: all ? all.name : a.textContent.replace(/^[☐☑]\s*/, '') });
        renderKnowledge();
      };

      /* —— 题面工具 + 公式计算器 —— */
      const insAt = (txt) => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(txt, s, e, 'end'); ta.focus(); };
      const fpad = w.querySelector('#nqFpad');
      w.querySelector('#nqFx').onclick = () => {
        if (fpad.style.display === 'none') { mfFormulaPad(ta, fpad); fpad.style.display = ''; }
        else fpad.style.display = 'none';
      };
      w.querySelector('#nqTbl').onclick = () => insAt('\n| 表头1 | 表头2 |\n| --- | --- |\n| 内容 | 内容 |\n');
      w.querySelector('#nqLst').onclick = () => insAt('\n1. \n2. \n');
      w.querySelector('#nqImg').onclick = () => w.querySelector('#nqImgFile').click();
      w.querySelector('#nqImgFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const fd = new FormData(); fd.append('file', f);
          const r = await fetch(MF_API + '/asset', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.msg || '上传失败');
          imgs.push(j.data.url); insAt(`\n[图${imgs.length}]`); renderImgs(); toast('图片已上传', 'ok');
        } catch (er) { toast(er.message, 'err'); }
        e.target.value = '';
      };

      /* —— AI 归属建议 —— */
      const aiBtn = w.querySelector('#nqAI');
      aiBtn.onclick = async () => {
        const stem = ta.value.trim();
        if (!stem) return toast('先填题干再点 AI 归属建议', 'err');
        aiBtn.disabled = true; const oldTxt = aiBtn.textContent; aiBtn.textContent = '✨ AI 判断中…';
        try {
          const r = await api(MFX + '/ai-attrib', { method: 'POST', body: { stem, subject: dSub } });
          let filled = [];
          if (r.stage && ['primary', 'junior'].includes(r.stage)) { dStage = r.stage; w.querySelector('#nqStage').value = r.stage; filled.push('学段'); }
          if (r.subject && SUBJECTS4.includes(r.subject)) { dSub = r.subject; w.querySelector('#nqSub').value = r.subject; filled.push('学科'); }
          await loadTrees();
          if (r.grade) {
            const g = (GRADES[dStage] || []).find((x) => String(r.grade).includes(x) || x.includes(String(r.grade)));
            if (g) { gradeName = g; filled.push('年级'); }
          }
          // 教材章节回填：找到返回的 textbook 节点 → 定位单元 + 勾选小知识点
          const tbNode = (r.nodes || []).find((n) => n.tree === 'textbook');
          if (tbNode) {
            const n = chapNodes.find((x) => Number(x.id) === Number(tbNode.id));
            if (n) {
              const ck = kidsOf(chapNodes);
              let unit = n;
              while (unit) { // 上溯到「单元层」：父是册别、祖父是年级
                const par = chapNodes.find((x) => x.id === unit.parent_id);
                if (!par) { unit = null; break; } // n 本身是年级层
                const gp = chapNodes.find((x) => x.id === par.parent_id);
                if (!gp || !gp.parent_id) break; // par 是册别层 → unit 已是单元
                unit = par;
              }
              unitId = String(unit.id);
              secSel.length = 0;
              (r.nodes || []).forEach((nn) => { if (nn.tree === 'textbook' && Number(nn.id) !== Number(unit.id)) secSel.push(Number(nn.id)); });
              filled.push('章节');
            }
          }
          renderChapter();
          // 知识点回填
          (r.nodes || []).forEach((nn) => {
            if (nn.tree === 'knowledge' && !katChips.some((x) => String(x.id) === String(nn.id))) katChips.push({ id: Number(nn.id), name: nn.name });
          });
          if (katChips.length) filled.push('知识点');
          if (r.difficulty) { w.querySelector('#nqDiff').value = String(r.difficulty); filled.push('难度'); }
          renderKnowledge();
          toast(filled.length ? `AI 建议已回填：${filled.join(' / ')}，检查后保存` : 'AI 没能判断出归属，请手动选择', filled.length ? 'ok' : 'err');
        } catch (er) { toast(er.message, 'err'); }
        aiBtn.disabled = false; aiBtn.textContent = oldTxt;
      };

      /* —— 答案 / 解析 / 标签 —— */
      const upd = () => {
        w.querySelector('#nqAnsBtn').textContent = '• 答案' + (w.querySelector('#nqAns').value.trim() ? '（已填）' : '（空·点击补充）');
        w.querySelector('#nqAnaBtn').textContent = '• 解析' + (w.querySelector('#nqAna').value.trim() ? '（已填）' : '（空·点击补充）');
      };
      w.querySelector('#nqAnsBtn').onclick = () => { const x = w.querySelector('#nqAnsWrap'); x.style.display = x.style.display === 'none' ? '' : 'none'; };
      w.querySelector('#nqAnaBtn').onclick = () => { const x = w.querySelector('#nqAnaWrap'); x.style.display = x.style.display === 'none' ? '' : 'none'; };
      w.querySelector('#nqAns').oninput = upd; w.querySelector('#nqAna').oninput = upd;
      w.querySelector('#nqTagAdd').onclick = () => { const v = w.querySelector('#nqTagInp').value.trim(); if (v && !tags.includes(v)) tags.push(v); w.querySelector('#nqTagInp').value = ''; renderTags(); };
      w.querySelector('#nqTagInp').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); w.querySelector('#nqTagAdd').onclick(); } };
      w.querySelector('#nqTags').onclick = (e) => { const a = e.target.closest('[data-ti]'); if (a) { tags.splice(Number(a.dataset.ti), 1); renderTags(); } };
      w.querySelector('#nqImgs').onclick = (e) => { const a = e.target.closest('[data-ii]'); if (a) { imgs.splice(Number(a.dataset.ii), 1); renderImgs(); } };

      reloadTrees();
    },
  });
}

/** 公式计算器（魔方式：常用/运算符号/希腊/函数/上下标 + 输入框 + 行内/独立成行） */
function mfFormulaPad(ta, mount) {
  const PADS = {
    '常用': ['×', '÷', '±', '≠', '≤', '≥', '√', 'π', '°', '²', '³', '℃', '%', '′', '″', '∶'],
    '运算符号': ['+', '−', '×', '÷', '±', '=', '≠', '≈', '<', '>', '≤', '≥', '∵', '∴', '∈', '∪', '∩', '∑', '∏', '∫', '∞', '⊥', '∥', '△', '∠'],
    '希腊': ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Θ', 'Λ', 'Π', 'Σ', 'Φ', 'Ω'],
    '函数': ['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lg', 'lim', 'f(x)', '\\frac{}{}', '\\sqrt{}', '\\sqrt[3]{}'],
    '上下标': ['^{2}', '_{1}', '^{n}', 'a^{2}+b^{2}=c^{2}', '\\frac{a}{b}', '\\sqrt{a}', 'x_{1}+x_{2}', '\\tfrac{1}{2}'],
  };
  let tab = '常用'; let mode = 'inline';
  const draw = () => {
    mount.innerHTML = `<div class="mf-fpad">
      <div class="mf-fpad-h"><b>∑ 插入公式</b><span class="hint">点符号即输</span><span style="flex:1"></span><a href="javascript:;" class="mf-fpad-x" data-fpx>✕</a></div>
      <input class="inp mf-fpad-in" placeholder="输入或点下方符号，完成后点「插入」">
      <div class="mf-fpad-tabs">${Object.keys(PADS).map((t) => `<a href="javascript:;" data-fpt="${t}" class="${t === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
      <div class="mf-fpad-grid">${PADS[tab].map((x) => `<button class="mf-fpad-k" data-fpk="${esc(x)}">${esc(x.replace(/\\/g, ''))}</button>`).join('')}</div>
      <div class="mf-fpad-b">
        <span>排版：<a href="javascript:;" data-fpm="inline" class="${mode === 'inline' ? 'on' : ''}">行内</a> · <a href="javascript:;" data-fpm="block" class="${mode === 'block' ? 'on' : ''}">独立成行</a></span>
        <span style="flex:1"></span>
        <button class="btn ghost xs" data-fpc>取消</button>
        <button class="btn xs" data-fpi>插入</button>
      </div></div>`;
    const inp = mount.querySelector('.mf-fpad-in');
    mount.querySelector('[data-fpx]').onclick = () => { mount.style.display = 'none'; };
    mount.querySelector('[data-fpc]').onclick = () => { mount.style.display = 'none'; };
    mount.querySelectorAll('[data-fpt]').forEach((a) => { a.onclick = () => { tab = a.dataset.fpt; draw(); }; });
    mount.querySelectorAll('[data-fpm]').forEach((a) => { a.onclick = () => { mode = a.dataset.fpm; draw(); }; });
    mount.querySelectorAll('[data-fpk]').forEach((b) => { b.onclick = () => {
      const v = b.dataset.fpk;
      const s = inp.selectionStart, e = inp.selectionEnd;
      inp.setRangeText(v, s, e, 'end'); inp.focus();
    }; });
    mount.querySelector('[data-fpi]').onclick = () => {
      const v = inp.value.trim();
      if (!v) return toast('先点符号或输入公式内容', 'err');
      const txt = mode === 'inline' ? `$${v}$` : `\n$$\n${v}\n$$\n`;
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.setRangeText(txt, s, e, 'end'); ta.focus();
      mount.style.display = 'none';
    };
  };
  draw();
}

/** 知识节点多选器（跨树选择，勾选回填） */
function mfNodePickMulti(nodes, onDone) {
  (async () => {
    const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
    if (!trees.length) return toast('先在左侧建一棵知识树再选节点', 'err');
    modal({
      title: '选择知识节点（可多选）',
      body: `<div class="field"><label>知识树</label><select id="npTree" class="inp">${trees.map((t) => `<option value="${t.id}">${esc(t.name)}（${t.node_count}节点）</option>`).join('')}</select></div>
        <div id="npList" class="mf-treebox" style="max-height:360px;margin-top:6px"></div>`,
      okText: '确定',
      onOk: () => { if (typeof onDone === 'function') onDone(); },
      onMount: (w) => {
        const cur = new Set(nodes.map((n) => n.id));
        const load = async () => {
          const tid = w.querySelector('#npTree').value;
          const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
          const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
          const dep = (n) => { let d = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); d++; if (d > 9) break; } return d; };
          w.querySelector('#npList').innerHTML = ns.map((n) => `<div data-npid="${n.id}" style="padding-left:${dep(n) * 18}px;cursor:pointer;line-height:2;font-size:13px">${cur.has(n.id) ? '☑' : '☐'} ${esc(n.name)}</div>`).join('') || '<div class="hint">这棵树还没有节点</div>';
          w.querySelector('#npList').onclick = (e) => {
            const row = e.target.closest('[data-npid]'); if (!row) return;
            const id = Number(row.dataset.npid);
            const name = row.textContent.replace(/^[☐☑]\s*/, '');
            if (cur.has(id)) { cur.delete(id); row.textContent = row.textContent.replace('☑', '☐'); }
            else { cur.add(id); row.textContent = row.textContent.replace('☐', '☑'); }
            nodes.length = 0;
            [...cur].forEach((nid) => {
              const old = nodes.find((x) => x.id === nid) || (ns.find((x) => x.id === nid) ? { id: nid, name: ns.find((x) => x.id === nid).name } : null);
              if (old) nodes.push(old); else nodes.push({ id: nid, name });
            });
          };
        };
        w.querySelector('#npTree').onchange = load;
        load();
      },
    });
  })();
}

/** 新建 / 编辑模型档案（魔方式：可拉取平台模型列表自由接入任何 OpenAI 兼容模型） */
const MF_ROLE_NAME = { reasoning: 'R1 推理', vision: 'R2 OCR', light: 'R3 轻', embedding: 'R4 向量', specialty: 'R5 专用' };
/** 档案格式（与 src/ai-client.js 的 FORMATS / FORMAT_HINTS 对应）：不绑定厂商，只给各协议标准的地址写法做提示 */
const MF_FORMATS = [
  ['openai', 'OpenAI 兼容', 'https://你的服务商/v1', '填到 /v1 为止，系统自动补 /chat/completions。通义、DeepSeek、智谱、Moonshot、OpenAI 等都选这一类。'],
  ['anthropic', 'Anthropic Messages', 'https://api.anthropic.com', '填到域名为止，系统自动补 /v1/messages（填了 /v1 也行）。'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com', '填到域名为止，系统自动补 /v1beta/models/{模型名}:generateContent。'],
];
function mfProfileForm(role, prof, fromRole) {
  const isEdit = !!prof;
  const curFmt = (isEdit && prof.format) || 'openai';
  modal({
    title: `${isEdit ? '编辑档案' : '新建档案'} · ${MF_ROLE_NAME[role] || role}`,
    body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
      <div class="field"><label>名称</label><input id="pfName" class="inp" placeholder="如：DeepSeek 官方" value="${isEdit ? esc(prof.name) : ''}"></div>
      <div class="field"><label>供应商</label><input id="pfProv" class="inp" placeholder="如：deepseek" value="${isEdit ? esc(prof.provider || '') : ''}"></div>
      <div class="field"><label>格式</label><select id="pfFormat" class="inp">${MF_FORMATS.map(([k, t]) => `<option value="${k}" ${k === curFmt ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>接口地址</label><input id="pfBase" class="inp" placeholder="${esc((MF_FORMATS.find((f) => f[0] === curFmt) || MF_FORMATS[0])[2])}" value="${isEdit ? esc(prof.base_url) : ''}">
        <div class="hint" id="pfFmtHint">${esc((MF_FORMATS.find((f) => f[0] === curFmt) || MF_FORMATS[0])[3])}</div></div>
      <div class="field"><label>API Key</label><input id="pfKey" class="inp" type="password" placeholder="${isEdit ? '留空 = 不修改原 Key' : '粘贴 API Key（sk-…，加密托管于本机）'}"></div>
      <div class="field"><label>模型</label><div style="display:flex;gap:8px;align-items:center">
        <input id="pfModel" class="inp" list="pfModelList" placeholder="如：deepseek-chat（可直接输入 id）" style="flex:1" value="${isEdit ? esc(prof.model) : ''}">
        <button type="button" class="btn ghost xs" id="pfFetch" style="flex:0 0 auto">获取模型列表</button></div>
        <datalist id="pfModelList"></datalist>
        <div class="hint">点「获取模型列表」从平台拉取该 Key 可用的全部模型，也可直接手输模型 id。</div></div>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:2px"><input type="checkbox" id="pfVision" ${((isEdit ? (prof.capability || '') : '') || (role === 'vision' ? 'vision' : '')) ? 'checked' : ''}> 该模型支持图片输入（R2 OCR 需要）</label>
    </div>`,
    onOk: async (w, showErr) => {
      const name = w.querySelector('#pfName').value.trim();
      const base = w.querySelector('#pfBase').value.trim();
      const model = w.querySelector('#pfModel').value.trim();
      const key = w.querySelector('#pfKey').value.trim();
      const body = {
        name, base_url: base, model,
        format: w.querySelector('#pfFormat').value,
        provider: w.querySelector('#pfProv').value.trim(),
        capability: w.querySelector('#pfVision').checked ? 'vision' : '',
      };
      if (!name || !base || !model) return showErr('名称 / Base URL / 模型名都要填');
      if (isEdit) {
        if (key) body.api_key = key; // 留空 = 不改原 Key
        await api(`${MFX}/profiles/${prof.id}`, { method: 'PUT', body });
      } else {
        if (!key) return showErr('API Key 要填（平台控制台创建后粘贴进来）');
        body.role = role; body.api_key = key;
        await api(MFX + '/profiles', { method: 'POST', body });
      }
      toast(isEdit ? '已保存，请重新测试连通' : '档案已建，先测连通再启用', 'ok'); mfProfileDialog(fromRole);
    },
    onMount: (w) => {
      // 换格式：更新地址提示（只换提示，不改用户已经填的地址）
      w.querySelector('#pfFormat').onchange = () => {
        const f = MF_FORMATS.find((x) => x[0] === w.querySelector('#pfFormat').value) || MF_FORMATS[0];
        w.querySelector('#pfBase').placeholder = f[2];
        w.querySelector('#pfFmtHint').textContent = f[3];
      };
      // 测试连接：不用先保存，填完直接测
      const testRow = document.createElement('div');
      testRow.style.cssText = 'margin:2px 0 0;display:flex;gap:10px;align-items:center';
      testRow.innerHTML = '<button type="button" class="btn ghost xs" id="pfTest">测试连接</button><span id="pfTestMsg" class="hint"></span>';
      w.querySelector('#pfModel').closest('.field').appendChild(testRow);
      w.querySelector('#pfTest').onclick = async () => {
        const msgEl = w.querySelector('#pfTestMsg');
        const body = { role, id: isEdit ? prof.id : undefined, name: w.querySelector('#pfName').value.trim(), format: w.querySelector('#pfFormat').value,
          base_url: w.querySelector('#pfBase').value.trim(), model: w.querySelector('#pfModel').value.trim(), api_key: w.querySelector('#pfKey').value.trim() };
        msgEl.style.color = ''; msgEl.textContent = '测试中…';
        try { const r = await api(MFX + '/profiles/test-draft', { method: 'POST', body, silent: true }); msgEl.style.color = '#0e9f5f'; msgEl.textContent = '✅ ' + (r && r.ms != null ? `连接成功（${r.ms} ms）` : '连接成功'); }
        catch (e) { msgEl.style.color = '#e0343f'; msgEl.textContent = '❌ ' + (e.message || '连接失败'); }
      };
      w.querySelector('#pfFetch').onclick = async () => {
        const base = w.querySelector('#pfBase').value.trim();
        const key = w.querySelector('#pfKey').value.trim();
        if (!base) return toast('先填 Base URL（一般到 /v1 为止）', 'err');
        if (!key) return toast(isEdit ? '编辑模式拉列表需在 Key 框粘贴 Key（留空保存时不影响原 Key）' : '先粘贴 API Key 再拉列表', 'err');
        const btn = w.querySelector('#pfFetch');
        btn.textContent = '拉取中…'; btn.disabled = true;
        try {
          const r = await api(MFX + '/profiles/models', { method: 'POST', body: { format: w.querySelector('#pfFormat').value, base_url: base, api_key: key } });
          w.querySelector('#pfModelList').innerHTML = (r.models || []).map((m) => `<option value="${esc(m)}">`).join('');
          toast(`拉到 ${(r.models || []).length} 个模型——点模型输入框即可从下拉选择`, 'ok');
        } catch (e) { toast(e.message || '拉取失败', 'err'); }
        btn.textContent = '获取模型列表'; btn.disabled = false;
      };
    },
  });
}

/** 字典/树映射弹层 */
async function mfDictDialog() {
  const d = await api(MFX + '/dict');
  const rows = d.list || [];
  modal({
    title: `字典 / 树映射（${d.counts.total} 行 · 未知值 ${d.counts.unknown} · 树 ${d.counts.trees} 棵）`, wide: true, okText: '关闭',
    body: `<div class="mf-tip" style="margin-bottom:8px">采集来源同义值 → 标准码映射；未识别的值可在此指认归位（映射加一行即可）。</div>
      ${(d.counts.unknown_values || []).length ? `<div class="mf-box" style="border-color:#fca5a5;margin-bottom:8px"><h4 style="color:#dc2626">未识别的取值</h4>
        ${(d.counts.unknown_values || []).map((v) => `<span class="tag err" style="margin:2px">${esc(v)}</span>`).join('')}</div>` : ''}
      <div style="max-height:340px;overflow:auto"><table class="tb"><thead><tr><th>类型</th><th>站点</th><th>原文</th><th>标准码</th><th>归一名</th><th style="width:150px">操作</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.kind === 'subject' ? '学科' : r.kind}</td>
        <td>${r.site ? ({ zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一' })[r.site] || r.site : '—'}</td>
        <td>${esc(r.site ? r.source_label || r.label : r.label)}</td>
        <td>${esc(r.code)}</td>
        <td>${esc(r.resolved_label || '')}</td>
        <td>${r.site ? `<a href="javascript:;" data-dm="${r.id}">删</a>` : '<span class="hint">归一行</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="mf-box" style="margin-top:10px"><h4>添加映射</h4>
        <div class="row">
          <select id="dmSite" class="mf-fsel" style="width:110px"><option value="">（归一行）</option><option value="zujuan">组卷网</option><option value="jyeoo">菁优网</option><option value="21cnjy">二一</option></select>
          <input id="dmSrc" class="inp" style="width:140px" placeholder="原文，如 道法">
          <input id="dmCode" class="inp" style="width:140px" placeholder="标准码，如 morality-law">
          <button class="btn sm" id="dmAdd">添加</button></div></div>`,
    onMount: (w) => {
      w.querySelector('#dmAdd').onclick = async () => {
        await api(MFX + '/dict', { method: 'POST', body: { kind: 'subject', site: w.querySelector('#dmSite').value, source_label: w.querySelector('#dmSrc').value.trim(), code: w.querySelector('#dmCode').value.trim() } });
        toast('已添加', 'ok'); mfDictDialog();
      };
      w.querySelectorAll('[data-dm]').forEach((a) => { a.onclick = async () => {
        await api(`${MFX}/dict/${a.dataset.dm}`, { method: 'DELETE' }); mfDictDialog();
      }; });
    },
  });
}
