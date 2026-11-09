/* 学习报告（词书 / 视频 / 习题）+ 操作日志 —— 组织管理 / 系统模块
 * 依赖 admin.js 的公共设施：api / Auth / esc / ic / toast / modal / pagerHTML / bindPager / ADM / expTag
 */
/* eslint-disable no-undef */

const REPORT_IS_PRINCIPAL = () => Auth.user && Auth.user.role === 'admin';

/** 校区筛选（总校显示下拉：全部分校+总校 / 总校 / 各分校；分校不显示=锁定本校） */
async function reportBranchBar(sel, onchangeId) {
  if (!REPORT_IS_PRINCIPAL()) return '';
  let branches = [];
  try { branches = await api('/api/admin/branches'); } catch (e) { branches = []; }
  window.__reportBranches = branches;
  return `<select id="${onchangeId}" style="min-width:150px">
    <option value="all" ${sel === 'all' ? 'selected' : ''}>全部分校 + 总校</option>
    <option value="none" ${sel === 'none' ? 'selected' : ''}>总校（校长开通）</option>
    ${branches.map((b) => `<option value="${b.id}" ${sel === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
  </select>`;
}
const reportBranchBind = (id, st) => {
  const el = document.getElementById(id);
  if (el) el.onchange = () => { st.branch = el.value; render(); };
};

/** 学段徽标 / 学科进度小标签（与原词书进度同款样式） */
const rptStage = (s) => s.stage === 'primary' ? '<span class="tag" style="background:#e7f8ef;color:#0e9f5f">小学</span>'
  : s.stage === 'junior' ? '<span class="tag" style="background:#eef4ff;color:#2f6bff">初中</span>'
    : '<span class="tag gray">未设置</span>';
const rptChip = (label, n, done, color) => {
  const has = n > 0;
  return `<span class="tag" style="background:${has ? color.bg : '#f2f4f8'};color:${has ? color.fg : '#98a2b3'};margin:2px 4px 2px 0" title="${label}：${has ? `${done}/${n}` : '还没练'}">${label} ${has ? `${done}/${n}` : '—'}</span>`;
};
const RPT_BLUE = { bg: '#eef4ff', fg: '#2f6bff' };
const RPT_GREEN = { bg: '#e7f8ef', fg: '#0e9f5f' };

/* ============================================================
   学习报告总入口（侧边栏一个菜单，页内三个子标签切换）
   ============================================================ */
const XREP_TABS = [
  { k: 'w', t: '词书学习报告', i: 'chart' },
  { k: 'v', t: '视频学习报告', i: 'video' },
  { k: 'e', t: '习题学习报告', i: 'doc' },
  { k: 'm', t: '错题记录', i: 'puzzle' },
];
let XREP_TAB = 'w';
/** 旧「知识点正确率」（#/acc[?user_id=]）并入习题学习报告：切到该页签，有 user_id 时直接打开该学生的详情 */
function xrepOpenExercise(uid) { XREP_TAB = 'e'; EREP.openUid = Number(uid) || 0; }
const xrepTabs = () => `<div class="toolbar r1-report-tabs" aria-label="学习报告类型">
  ${XREP_TABS.map((t) => `<button class="btn ${XREP_TAB === t.k ? 'primary-sm' : 'ghost'}" data-xrep="${t.k}">${ic(t.i)} ${t.t}</button>`).join('')}</div>`;

async function viewXReport() {
  // #/xreport?tab=w|v|e|m[&user_id=N]：切页签；习题页签带 user_id 时直接打开该学生详情。读完立刻清掉参数，免得之后切页签被它覆盖
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.has('tab') || q.has('user_id')) {
    if (XREP_TABS.some((t) => t.k === q.get('tab'))) XREP_TAB = q.get('tab');
    if (XREP_TAB === 'e' && Number(q.get('user_id'))) xrepOpenExercise(q.get('user_id'));
    try { history.replaceState(null, '', '#/xreport'); } catch (e) { /* 忽略 */ }
  }
  const map = { w: viewWReport, v: viewVReport, e: viewEReport, m: viewMistakeLog };
  const out = await (map[XREP_TAB] || viewWReport)();
  out.html = '<section class="r1-rounded-report"><header class="r1-report-heading"><h2>学习报告</h2><p>从视频学习、练习表现到错题，看到完整学习过程。</p></header>' + xrepTabs() + out.html + '</section>';
  const oldAfter = out.after;
  out.after = () => {
    document.querySelectorAll('[data-xrep]').forEach((b) => b.onclick = () => { XREP_TAB = b.dataset.xrep; render(); });
    if (oldAfter) oldAfter();
  };
  return out;
}

/* ============================================================
   ① 词书学习报告（原「词书管理 > 学生学习进度」迁移而来）
   ============================================================ */
const WPROG = { branch: 'all', kw: '' };

async function viewWReport() {
  const st = WPROG;
  const branchBar = await reportBranchBar(st.branch, 'wrBranch');
  const d = await api(`/api/admin/word/progress?branch=${encodeURIComponent(st.branch)}`);
  let list = d.list || [];
  if (st.kw) {
    const kw = st.kw.toLowerCase();
    list = list.filter((s) => String(s.name || '').toLowerCase().includes(kw) || String(s.username || '').toLowerCase().includes(kw));
  }
  return {
    html: `
    <div class="card">
      <div class="card-h"><h3>${ic('chart')} 词书学习报告 <span class="tag gray">${list.length}</span></h3></div>
      <div class="toolbar">
        ${branchBar}
        <input class="input" id="wrKw" style="width:260px;flex:0 1 260px" placeholder="搜索姓名 / 账号" value="${esc(st.kw)}">
        <button class="btn ghost" id="wrSearch">查询</button>
        <button class="btn ghost" id="wrReset">重置</button>
      </div>
      <p class="w-tip" style="margin:0 0 12px">每个学生在速记各模块的作答统计（<b>对/总</b>），点「详情」看 TA 训练过哪些词书、每本词书哪些分组已完成。分组完成情况由学生端练完四步后自动上报。</p>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>姓名</th><th>账号</th><th>年级</th><th>学段</th><th>册别</th><th>校区</th><th>速记模块作答（对/总）</th><th>词书</th><th>完成分组</th><th>最近训练</th><th>到期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${list.map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td>
          <td>${esc(s.grade || '-')}</td><td>${rptStage(s)}</td>
          <td>${s.term ? esc(s.term) : '<span style="color:var(--text3)">不限</span>'}</td>
          <td>${esc(s.branch || '总校')}</td>
          <td>${(d.modules || []).map((m) => rptChip((d.moduleLabels || {})[m] || m, (s.modules[m] || {}).n, (s.modules[m] || {}).correct, RPT_BLUE)).join('')}</td>
          <td>${(s.books || []).length ? s.books.length + ' 本' : '<span style="color:var(--text3)">还没练</span>'}</td>
          <td>${s.group_done ? `<b>${s.group_done}</b> 组` : '<span style="color:var(--text3)">0 组</span>'}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((s.last_at || s.last_login || '').slice(0, 16)) || '-'}</td>
          <td>${expTag(s.expire_at)}</td>
          <td>${s.status ? '<span class="tag ok">正常</span>' : '<span class="tag gray">停用</span>'}</td>
          <td><button class="link-btn" data-detail="${s.id}">详情</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">暂无记录</div>'}
    </div>`,
    after: () => {
      reportBranchBind('wrBranch', st);
      document.getElementById('wrSearch').onclick = () => { st.kw = document.getElementById('wrKw').value.trim(); render(); };
      document.getElementById('wrKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('wrSearch').click(); };
      document.getElementById('wrReset').onclick = () => { st.kw = ''; if (REPORT_IS_PRINCIPAL()) st.branch = 'all'; render(); };
      document.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => {
        const s = list.find((x) => x.id === Number(b.dataset.detail));
        if (s) wprogDetail(s, d.moduleLabels || {});
      });
    },
  };
}

/** 词书报告详情弹窗（原 wprogDetail 原样迁移） */
function wprogDetail(s, labels) {
  const MOD_NAME = { quick: '单词速记', phrase: '短语速记', pos: '词性训练', context: '课文朗读', build: '连词成句', listen: '听音拼句', syllabus: '考纲单词', ...(labels || {}) };
  const bookRows = (s.books || []).map((b) => {
    const mods = Object.entries(b.modules || {}).map(([m, st]) => `<span class="tag" style="background:#eef4ff;color:#2f6bff;margin:2px 4px 2px 0">${esc(MOD_NAME[m] || m)} ${st.correct}/${st.n}</span>`).join('');
    return `<tr><td><b>${esc(b.title)}</b></td><td>${mods || '<span style="color:var(--text3)">—</span>'}</td><td style="font-size:12px;color:var(--text3)">${esc((b.last_at || '').slice(0, 16))}</td></tr>`;
  }).join('');
  const grpRows = (s.groups || []).map((g) => `<tr>
      <td>${esc(g.book_title)}</td><td>${esc(MOD_NAME[g.module] || g.module)}</td>
      <td>${g.unit ? esc(g.unit) : '<span style="color:var(--text3)">整本</span>'}</td>
      <td>第 ${g.gi + 1} 组</td><td>${g.n || '?'} 词${g.size ? ` / 每组 ${g.size}` : ''}</td>
      <td style="font-size:12px;color:var(--text3)">${esc((g.done_at || '').slice(0, 16))}</td></tr>`).join('');
  modal({
    title: `${s.name} · 词书学习报告`,
    wide: true,
    body: `
      <p class="w-tip" style="margin:0 0 12px">${esc(s.grade || '')} ${s.stage === 'primary' ? '小学' : s.stage === 'junior' ? '初中' : ''} ${s.term || ''} · 账号 ${esc(s.username)} · ${esc(s.branch || '总校')} · 到期 ${esc(String(s.expire_at || '').slice(0, 10) || '未设置')}</p>
      <div style="font-weight:600;margin-bottom:6px">按词书统计</div>
      ${(s.books || []).length ? `<table style="margin-bottom:16px"><thead><tr><th>词书</th><th>模块作答（对/总）</th><th>最近作答</th></tr></thead><tbody>${bookRows}</tbody></table>`
        : '<p class="w-tip" style="margin:0 0 16px">还没有任何词书训练记录</p>'}
      <div style="font-weight:600;margin-bottom:6px">已完成的分组（练完 学习 → 记忆 → 连连看 → 默写 四步）</div>
      ${(s.groups || []).length ? `<div style="max-height:34vh;overflow:auto"><table><thead><tr><th>词书</th><th>模块</th><th>单元</th><th>分组</th><th>词数</th><th>完成时间</th></tr></thead><tbody>${grpRows}</tbody></table></div>`
        : '<p class="w-tip" style="margin:0">还没有完整练完的分组</p>'}`,
    okText: '关闭',
    onOk: async () => true,
  });
}

/* ============================================================
   ② 视频学习报告
   ============================================================ */
const VREP = { branch: 'all', kw: '' };

async function viewVReport() {
  const st = VREP;
  const branchBar = await reportBranchBar(st.branch, 'vrBranch');
  const d = await api(`/api/admin/xreport/videos?branch=${encodeURIComponent(st.branch)}&kw=${encodeURIComponent(st.kw)}`);
  const list = d.list || [];
  return {
    html: `
    <div class="card">
      <div class="card-h"><h3>${ic('video')} 视频学习报告 <span class="tag gray">${list.length}</span></h3></div>
      <div class="toolbar">
        ${branchBar}
        <input class="input" id="vrKw" style="width:260px;flex:0 1 260px" placeholder="搜索姓名 / 账号" value="${esc(st.kw)}">
        <button class="btn ghost" id="vrSearch">查询</button>
        <button class="btn ghost" id="vrReset">重置</button>
      </div>
      <p class="w-tip" style="margin:0 0 12px">每个学生看过的知识点（视频）进度：「已看完」= 学生端看完标记；「在看」= 打开过但还没看完；「讲义」= 已下载/查看讲义。点「详情」看具体每个知识点的观看记录。</p>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>姓名</th><th>账号</th><th>年级</th><th>学段</th><th>册别</th><th>校区</th><th>学科观看（看完/打开）</th><th>已看完</th><th>在看</th><th>讲义</th><th>最近学习</th><th>到期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${list.map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td>
          <td>${esc(s.grade || '-')}</td><td>${rptStage(s)}</td>
          <td>${s.term ? esc(s.term) : '<span style="color:var(--text3)">不限</span>'}</td>
          <td>${esc(s.branch || '总校')}</td>
          <td>${(s.subjects || []).map((x) => rptChip(x.subject, x.n, x.done, RPT_GREEN)).join('')}</td>
          <td>${s.watched ? `<b style="color:#0e9f5f">${s.watched}</b>` : '<span style="color:var(--text3)">0</span>'}</td>
          <td>${s.started - s.watched > 0 ? s.started - s.watched : '<span style="color:var(--text3)">0</span>'}</td>
          <td>${s.handouts ? s.handouts : '<span style="color:var(--text3)">0</span>'}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((s.last_at || s.last_login || '').slice(0, 16)) || '-'}</td>
          <td>${expTag(s.expire_at)}</td>
          <td>${s.status ? '<span class="tag ok">正常</span>' : '<span class="tag gray">停用</span>'}</td>
          <td><button class="link-btn" data-vdetail="${s.id}">详情</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">暂无记录</div>'}
    </div>`,
    after: () => {
      reportBranchBind('vrBranch', st);
      document.getElementById('vrSearch').onclick = () => { st.kw = document.getElementById('vrKw').value.trim(); render(); };
      document.getElementById('vrKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('vrSearch').click(); };
      document.getElementById('vrReset').onclick = () => { st.kw = ''; if (REPORT_IS_PRINCIPAL()) st.branch = 'all'; render(); };
      document.querySelectorAll('[data-vdetail]').forEach((b) => b.onclick = async () => {
        try {
          const det = await api('/api/admin/xreport/videos/' + b.dataset.vdetail + '/detail');
          vrepDetail(det);
        } catch (e) { /* api 已提示 */ }
      });
    },
  };
}

function vrepDetail(d) {
  const s = d.student || {};
  const stTag = (r) => Number(r.video_done) === 1
    ? '<span class="tag ok">已看完</span>'
    : '<span class="tag" style="background:#fff5e6;color:#c77700">在看</span>';
  const rows = (d.rows || []).map((r) => `<tr>
    <td>${esc([r.book, r.chapter_name].filter(Boolean).join(' · ') || '—')}</td>
    <td><b>${esc(r.video_title || '知识点已删除')}</b></td>
    <td><span class="tag">${esc(r.subject || '—')}</span></td>
    <td>${esc(r.category || '—')}</td>
    <td>${Number(r.handout_done) === 1 ? '<span class="tag ok">已查看</span>' : '<span class="tag gray">未查看</span>'}</td>
    <td>${stTag(r)}</td>
    <td style="font-size:12px;color:var(--text3)">${esc((r.updated_at || '').slice(0, 16))}</td>
  </tr>`).join('');
  modal({
    title: `${s.name} · 视频学习报告`,
    wide: true,
    body: `
      <p class="w-tip" style="margin:0 0 12px">${esc(s.grade || '')} ${s.stage === 'primary' ? '小学' : s.stage === 'junior' ? '初中' : ''} ${s.term || ''} · 账号 ${esc(s.username)}</p>
      <div style="margin-bottom:12px">${(d.subjects || []).map((x) => rptChip(x.subject, x.n, x.done, RPT_GREEN)).join('')}</div>
      <div style="font-weight:600;margin-bottom:6px">知识点观看记录（最近 500 条）</div>
      ${rows ? `<div style="max-height:46vh;overflow:auto"><table><thead><tr><th>课程 / 章节</th><th>知识点</th><th>学科</th><th>分类</th><th>讲义</th><th>观看状态</th><th>最近时间</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="w-tip" style="margin:0">还没有观看过任何知识点视频</p>'}`,
    okText: '关闭',
    onOk: async () => true,
  });
}

/* ============================================================
   ③ 习题学习报告
   ============================================================ */
const EREP = { branch: 'all', kw: '', openUid: 0 };

const QT_NAME = { answer: '解答', single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序', compound: '组合', cloze: '完形', reading: '阅读' };

async function viewEReport() {
  const st = EREP;
  const branchBar = await reportBranchBar(st.branch, 'erBranch');
  const d = await api(`/api/admin/xreport/exercises?branch=${encodeURIComponent(st.branch)}&kw=${encodeURIComponent(st.kw)}`);
  const list = d.list || [];
  return {
    html: `
    <div class="card">
      <div class="card-h"><h3>${ic('doc')} 习题学习报告 <span class="tag gray">${list.length}</span></h3></div>
      <div class="toolbar">
        ${branchBar}
        <input class="input" id="erKw" style="width:260px;flex:0 1 260px" placeholder="搜索姓名 / 账号" value="${esc(st.kw)}">
        <button class="btn ghost" id="erSearch">查询</button>
        <button class="btn ghost" id="erReset">重置</button>
      </div>
      <p class="w-tip" style="margin:0 0 12px">统计学生端「做练习 / 试卷」的作答数据：做题数与正确率来自客观判分和学生自评，自评不代表老师评分；错题按错题本（含复习进度）统计，试卷取自智能组卷的交卷记录。点「详情」看试卷成绩和最近的作答明细。</p>
      <div class="r1-student-cards">${list.length ? list.map(s => `<article class="r1-student-card"><header><span class="r1-student-avatar" aria-hidden="true">${ic('user')}</span><div><h3>${esc(s.name || s.username)}</h3><p>${esc([s.grade,s.branch || '总校'].filter(Boolean).join(' · '))}</p></div><button type="button" class="btn ghost sm" data-edetail="${s.id}">查看报告 ${ic('arrow-right')}</button></header><div class="r1-student-metrics"><div><span>已做习题</span><strong>${Number(s.answered) || 0}</strong><small>作答记录</small></div><div><span>习题正确率</span><strong>${s.rate == null ? '—' : esc(s.rate) + '%'}</strong><small>${s.rate == null ? '暂无可统计作答' : '客观判分 / 学生自评'}</small></div><div><span>待复习错题</span><strong>${Number(s.wrong_open) || 0}</strong><small>已掌握 ${Number(s.mastered) || 0} 题</small></div></div><footer><span>${s.last_at ? '最近练习 ' + esc(s.last_at.slice(0,16)) : '暂无可统计的练习或试卷记录'}</span><button type="button" class="link-btn" data-edocx="${s.id}">导出错题 Word</button></footer></article>`).join('') : '<div class="r1-report-empty"><span class="r1-empty-book" aria-hidden="true">'+ic('book')+'</span><h3>完成练习后生成报告</h3><p>暂未产生可统计的练习记录，或当前筛选下没有学生。</p><small>暂无数据不代表正确率为 0%。</small></div>'}</div>
      <details class="r1-all-fields"><summary>查看全部统计字段</summary>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>姓名</th><th>账号</th><th>年级</th><th>校区</th><th>学科做题（对/总）</th><th>做题数</th><th>正确率</th><th>待复习错题</th><th>已掌握</th><th>试卷</th><th>平均分</th><th>最高分</th><th>最近做题</th><th>到期</th><th>状态</th><th class="r1-act-cell">操作</th></tr></thead>
        <tbody>${list.map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td>
          <td>${esc(s.grade || '-')}</td>
          <td>${esc(s.branch || '总校')}</td>
          <td>${(s.subjects || []).map((x) => rptChip(x.subject, x.n, x.correct, RPT_BLUE)).join('')}</td>
          <td>${s.answered || '<span style="color:var(--text3)">0</span>'}</td>
          <td>${s.rate === null ? '<span style="color:var(--text3)">—</span>' : `<b style="color:${s.rate >= 80 ? '#0e9f5f' : s.rate >= 60 ? '#c77700' : '#d33'}">${s.rate}%</b>`}</td>
          <td>${s.wrong_open ? `<b style="color:#d33">${s.wrong_open}</b>` : '<span style="color:var(--text3)">0</span>'}</td>
          <td>${s.mastered ? `<b style="color:#0e9f5f">${s.mastered}</b>` : '<span style="color:var(--text3)">0</span>'}</td>
          <td>${s.paper_tries ? s.paper_tries + ' 次' : '<span style="color:var(--text3)">未考</span>'}</td>
          <td>${s.paper_avg === null ? '—' : s.paper_avg}</td>
          <td>${s.paper_best === null ? '—' : s.paper_best}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((s.last_at || '').slice(0, 16)) || '-'}</td>
          <td>${expTag(s.expire_at)}</td>
          <td>${s.status ? '<span class="tag ok">正常</span>' : '<span class="tag gray">停用</span>'}</td>
          <td class="r1-act-cell"><div class="r1-acts"><button class="link-btn" data-edetail="${s.id}">详情</button><button class="link-btn" data-edocx="${s.id}" title="导出该学生未掌握的错题（可编辑的 Word）">导出错题 Word</button></div></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">暂无记录</div>'}</details>
    </div>`,
    after: () => {
      reportBranchBind('erBranch', st);
      document.getElementById('erSearch').onclick = () => { st.kw = document.getElementById('erKw').value.trim(); render(); };
      document.getElementById('erKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('erSearch').click(); };
      document.getElementById('erReset').onclick = () => { st.kw = ''; if (REPORT_IS_PRINCIPAL()) st.branch = 'all'; render(); };
      document.querySelectorAll('[data-edetail]').forEach((b) => b.onclick = () => r1OpenDrawer(Number(b.dataset.edetail)));
      document.querySelectorAll('[data-edocx]').forEach((b) => b.onclick = () => {
        const s = list.find((x) => x.id === Number(b.dataset.edocx));
        if (s) r1DownloadMistakes(s, {}, b);
      });
      if (st.openUid) { const uid = st.openUid; st.openUid = 0; r1OpenDrawer(uid); }
    },
  };
}

/* ------------------------------------------------------------
   R1：习题学习报告详情抽屉（合并原「知识点正确率」）
   ① 学科总览  ② 课程 → 小分组 → 视频 正确率（可折叠 / 只看未掌握）  ③ 试卷成绩 + 最近作答
   顶部：导出错题 Word（学科 / 范围 / 时间）。口径见 src/accuracy.js：每道题取最近一次作答。
   ------------------------------------------------------------ */
const R1_WEAK = 80;                                   // 正确率低于 80% 记为「未掌握」
const r1Weak = (a) => !!a && a.answered > 0 && a.rate !== null && a.rate < R1_WEAK;
const R1_SUBJ_ICON = { 数学: 'math', 英语: 'english', 物理: 'physics', 化学: 'chemistry' };
const r1RateCls = (r) => (r >= R1_WEAK ? 'good' : r >= 60 ? 'mid' : 'low');

/** 正确率徽标：暂无习题 / 未做 / xx% + 已做 a / t 题 · 答对 c（沿用 .t6-acc 的配色） */
function r1RateHTML(a) {
  if (!a || !a.total) return '<span class="t6-acc">暂无习题</span>';
  if (a.rate === null || a.rate === undefined) return `<span class="t6-acc">未做 · 共 ${a.total} 题</span>`;
  return `<span class="t6-acc ${r1RateCls(a.rate)}">${a.rate}%</span><span class="t6-acc-n">已做 ${a.answered} / ${a.total} 题 · 答对 ${a.correct}</span>`;
}

/** 导出某个学生的错题 Word：带登录票据下载，再触发浏览器保存。opts = { subject, bucket, days } */
async function r1DownloadMistakes(stu, opts, btn) {
  opts = opts || {};
  const qs = new URLSearchParams({ user_id: stu.id, bucket: opts.bucket || 'unresolved' });
  if (opts.subject) qs.set('subject', opts.subject);
  if (opts.days) qs.set('days', opts.days);
  const old = btn.innerHTML; btn.disabled = true; btn.textContent = '生成中…';
  try {
    const res = await fetch('/api/admin/bank/mistakes/export-docx?' + qs.toString(), { headers: { Authorization: 'Bearer ' + Auth.token } });
    if ((res.headers.get('content-type') || '').includes('json')) { const j = await res.json(); throw new Error(j.msg || '导出失败'); }
    if (!res.ok) throw new Error('导出失败（' + res.status + '）');
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${stu.name || stu.username}-${opts.subject || '全部科目'}-错题集.docx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 ' + (res.headers.get('X-Mistake-Count') || '') + ' 道错题', 'ok');
  } catch (e) { toast(e.message || '导出失败', 'err'); }
  btn.disabled = false; btn.innerHTML = old;
}

/** ② 课程 → 小分组 → 视频/分组习题。onlyWeak保留正确率低于80%的视频、独立分组习题及其上级。 */
function r1TreeHTML(courses, onlyWeak, closed) {
  const caret = (key) => `aria-expanded="${closed.has(key) ? 'false' : 'true'}" data-tog="${key}"`;
  const out = [];
  courses.forEach((c) => {
    const groups = c.groups.map((g) => ({
      ...g,
      videos: onlyWeak ? g.videos.filter((v) => r1Weak(v.acc)) : g.videos,
      showOwn: !!g.own_acc && g.own_acc.total > 0 && (!onlyWeak || r1Weak(g.own_acc)),
    })).filter((g) => g.videos.length || g.showOwn);
    if (!groups.length) return;
    const ck = 'c' + c.id;
    out.push(`<div class="r1-course">
      <button type="button" class="r1-row r1-lv1" ${caret(ck)}><i class="r1-caret"></i><b class="r1-name">${esc(c.name)}</b><span class="r1-meta">${esc([c.subject, c.grade, c.term].filter(Boolean).join(' · '))}</span><span class="r1-rate">${r1RateHTML(c.acc)}</span></button>
      <div class="r1-kids" ${closed.has(ck) ? 'hidden' : ''}>${groups.map((g) => {
    const gk = `g${c.id}-${g.id}`;
    return `<div class="r1-group">
        <button type="button" class="r1-row r1-lv2" ${caret(gk)}><i class="r1-caret"></i><span class="r1-name">${esc(g.name)}</span><span class="r1-rate">${r1RateHTML(g.acc)}</span></button>
        <div class="r1-kids" ${closed.has(gk) ? 'hidden' : ''}>${g.videos.map((v) => `<div class="r1-row r1-lv3" data-vid="${v.id}"><span class="r1-name">${ic('video')}${esc(v.title)}</span><span class="r1-rate">${r1RateHTML(v.acc)}</span></div>`).join('')}${g.showOwn ? `<div class="r1-row r1-lv3 r1-own"><span class="r1-name">${ic('doc')}分组习题</span><span class="r1-rate">${r1RateHTML(g.own_acc)}</span></div>` : ''}</div>
      </div>`;
  }).join('')}</div>
    </div>`);
  });
  return out.join('');
}

function r1Close() { document.querySelectorAll('.r1-mask').forEach((m) => m.remove()); document.removeEventListener('keydown', r1Esc); }
function r1Esc(e) { if (e.key === 'Escape') r1Close(); }

async function r1OpenDrawer(uid) {
  r1Close();
  const wrap = document.createElement('div');
  wrap.className = 'r1-mask r1-rounded-mask';
  wrap.innerHTML = `<aside class="r1-drawer r1-rounded-drawer" role="dialog" aria-label="习题学习报告详情">
    <header class="r1-dh"><div class="r1-dt"><h3>习题学习报告</h3><p class="r1-sub">加载中…</p></div>
      <button type="button" class="r1-x" aria-label="关闭"><i class="el-icon-close"></i></button></header>
    <div class="r1-body"><div class="loading-page">加载中…</div></div>
  </aside>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) r1Close(); });
  wrap.querySelector('.r1-x').onclick = r1Close;
  document.addEventListener('keydown', r1Esc);
  window.addEventListener('hashchange', r1Close, { once: true });

  let det; let acc = null; let accErr = '';
  try {
    [det, acc] = await Promise.all([
      api('/api/admin/xreport/exercises/' + uid + '/detail'),
      api('/api/admin/bank/accuracy?user_id=' + uid).catch((e) => { accErr = (e && e.message) || '正确率加载失败'; return null; }),
    ]);
  } catch (e) { r1Close(); return; }   // api 已提示
  if (!document.body.contains(wrap)) return;
  const s = det.student || {};
  const stage = s.stage === 'primary' ? '小学' : s.stage === 'junior' ? '初中' : '';
  wrap.querySelector('.r1-dt').innerHTML = `<h3>${esc(s.name || s.username)} · 习题学习报告</h3>
    <p class="r1-sub">${esc([s.grade, stage, s.term].filter(Boolean).join(' '))} · 账号 ${esc(s.username)} · 到期 ${esc(String(s.expire_at || '').slice(0, 10) || '未设置')}</p>`;

  // ① 学科总览
  const subs = det.subjects || [];
  const totalN = subs.reduce((t, x) => t + x.n, 0); const totalC = subs.reduce((t, x) => t + x.correct, 0);
  const hasPractice = totalN > 0 || (det.rows || []).length > 0 || (det.subjective || []).length > 0 || (det.papers || []).length > 0;
  const hasPendingGrading = (det.subjective || []).some(r => r.score == null) || (det.papers || []).some(p => Number(p.ungraded_count) > 0);
  const subCards = subs.map((x) => {
    const rate = x.n ? Math.round(x.correct / x.n * 100) : null;
    return `<div class="r1-subj ${x.n ? '' : 'empty'}" data-subj="${esc(x.subject)}">
      <div class="r1-subj-h">${ic(R1_SUBJ_ICON[x.subject] || 'book')}<b>${esc(x.subject)}</b></div>
      <div class="r1-subj-v ${rate === null ? '' : r1RateCls(rate)}">${rate === null ? '—' : rate + '%'}</div>
      <div class="r1-subj-n">${x.n ? `做题 ${x.n} · 答对 ${x.correct}` : '还没做题'}</div>
      <div class="r1-bar"><i style="width:${rate || 0}%" class="${rate === null ? '' : r1RateCls(rate)}"></i></div>
    </div>`;
  }).join('');
  const sum = `<div class="r1-sum">
    <span>总做题 <b>${totalN}</b></span>
    <span>整体正确率 <b class="${totalN ? r1RateCls(Math.round(totalC / totalN * 100)) : ''}">${totalN ? Math.round(totalC / totalN * 100) + '%' : '—'}</b></span>
    <span>待复习错题 <b class="low">${det.wrong_open || 0}</b></span>
    <span>已掌握 <b class="good">${det.mastered || 0}</b></span>
  </div>`;

  // ③ 试卷成绩 / 最近作答
  const paperRows = (det.papers || []).map((p) => {
    const full = Number(p.total_score) || 100;                      // 试卷满分；score 已按满分折算
    if (p.ungraded_count) {
      const objective = p.objective_score_total ? `客观题 ${p.objective_score} / ${p.objective_score_total}` : '暂无客观题';
      return `<tr><td><b>${esc(p.title || '试卷已删除')}</b></td><td>${esc(objective)} · ${p.ungraded_count} 题未评分</td><td>${p.correct} / ${p.total} 题</td><td>—</td><td class="r1-time">${esc((p.created_at || '').slice(0, 16))}</td></tr>`;
    }
    const rate = Math.round(Number(p.score) / full * 100);
    return `<tr><td><b>${esc(p.title || '试卷已删除')}</b></td><td><b class="r1-c-${r1RateCls(rate)}">${p.score}</b> / ${full}</td><td>${p.correct} / ${p.total} 题</td><td>${rate}%</td><td class="r1-time">${esc((p.created_at || '').slice(0, 16))}</td></tr>`;
  }).join('');
  const recRows = (det.rows || []).map((r) => `<tr>
    <td>${esc(QT_NAME[r.type] || r.type || '—')}</td><td>${esc(r.subject || '—')}</td>
    <td title="${esc(r.stem || '')}">${esc(String(r.stem || '').slice(0, 40))}${String(r.stem || '').length > 40 ? '…' : ''}</td>
    <td>${r.self_correct === 0 || r.self_correct === 1 ? `<span class="tag ${r.self_correct ? 'ok' : 'no'}">学生自评${r.self_correct ? '正确' : '错误'}</span>` : r.match_total ? `<span class="tag ${Number(r.is_correct) === 1 ? 'ok' : 'no'}">连对 ${Number(r.match_correct)} / ${Number(r.match_total)} 项</span>` : Number(r.is_correct) === 1 ? '<span class="tag ok">对</span>' : '<span class="tag no">错</span>'}</td>
    <td class="r1-time">${esc((r.created_at || '').slice(0, 16))}</td></tr>`).join('');
  const subjectiveRows = (det.subjective || []).map((r) => `<tr><td>${esc(({ writing: '书面表达', translation: '翻译', calculation: '计算题', drawing: '作图题' })[r.question_subtype] || '问答题')}</td><td>${esc(r.subject || '—')}</td><td>${esc(r.stem || '题目已删除')}</td><td>${r.has_drawing ? `<button type="button" class="btn ghost xs" data-subjective-drawing="${Number(r.id)}">查看作图</button>` : esc(r.my_answer || '未作答').replace(/\n/g, '<br>')}</td><td>${r.score == null ? '未评分' : `${Number(r.score)} / ${r.max_score == null ? 100 : Number(r.max_score)} 分`}${r.self_correct === 0 || r.self_correct === 1 ? `<div>学生自评${r.self_correct ? '正确' : '错误'}（不代表老师评分）</div>` : ''}${r.review_comment ? `<div>${esc(r.review_comment).replace(/\n/g, '<br>')}</div>` : ''}</td><td class="r1-time">${esc((r.created_at || '').slice(0, 16))}</td><td><button type="button" class="btn ghost xs" data-subjective-grade="${Number(r.id)}">${r.score == null ? '评分' : '修改评分'}</button></td></tr>`).join('');

  const body = wrap.querySelector('.r1-body');
  body.innerHTML = `
    <div class="r1-export">
      <span class="r1-export-t">${ic('doc')} 导出错题 Word</span>
      <select id="r1Subj" aria-label="学科"><option value="">全部科目</option>${SUBJECTS.map((x) => `<option>${x}</option>`).join('')}</select>
      <select id="r1Bucket" aria-label="范围"><option value="unresolved">未掌握</option><option value="all">全部（含已掌握）</option><option value="resolved">已掌握</option></select>
      <select id="r1Days" aria-label="时间范围"><option value="0">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select>
      <button type="button" class="btn sm" id="r1Docx">${ic('download')} 导出错题 Word</button>
    </div>
    <section class="r1-sec"><h4><span class="r1-n">1</span>学科总览</h4>${sum}<div class="r1-subjs">${subCards}</div></section>
    <div class="r1-report-grid"><section class="r1-sec r1-knowledge-panel"><h4><span class="r1-n">2</span>知识点与小分组
        <span class="r1-tools"><label class="r1-chk"><input type="checkbox" id="r1Weak"> 只看未掌握（&lt; ${R1_WEAK}%）</label>
        <button type="button" class="link-btn" id="r1Open">全部展开</button><button type="button" class="link-btn" id="r1Fold">全部收起</button></span></h4>
      <p class="r1-note">每道题取学生<b>最近一次</b>作答的对错；小分组 = 组内所有视频的题合在一起算。已自评的问答题计入个人掌握度，未自评不计入；学生自评不代表老师评分。</p>
      ${acc ? `<div class="r1-accsum">全部课程合计 ${r1RateHTML(acc.acc)}</div>` : ''}
      <div class="r1-tree" id="r1Tree">${accErr ? `<div class="empty">${esc(accErr)}</div>` : ''}</div>
    </section><aside class="r1-feedback"><h4>${ic('chat')} 学习反馈</h4><div class="r1-empty-book" aria-hidden="true">${ic('book')}</div><h3>${hasPractice ? (hasPendingGrading && !totalN ? '已有作答，等待人工评分' : '每一步练习，都看得见') : '完成练习后生成报告'}</h3><p>${hasPractice ? (hasPendingGrading && !totalN ? '已收到主观题或试卷作答，人工评分完成后可查看相应结果。' : '结合知识点正确率与最近作答，了解需要巩固的内容。') : '这里会呈现题目结果、知识点掌握情况和需要复习的内容。'}</p><div class="r1-feedback-note">${hasPendingGrading ? '有作答待人工评分，请在下方试卷与作答记录中单独查看。' : '暂无可统计数据不代表正确率为 0%。'}<br>正确率与学习进度分别呈现。</div></aside></div>
    <section class="r1-sec"><h4><span class="r1-n">3</span>试卷成绩</h4>
      ${paperRows ? `<div class="r1-scroll"><table><thead><tr><th>试卷</th><th>得分</th><th>答对</th><th>得分率</th><th>交卷时间</th></tr></thead><tbody>${paperRows}</tbody></table></div>` : '<p class="r1-note">还没有参加过试卷</p>'}
      <h4 class="r1-h4b">最近作答（最近 100 条）</h4>
      ${recRows ? `<div class="r1-scroll r1-scroll-tall"><table><thead><tr><th>题型</th><th>学科</th><th>题目</th><th>结果</th><th>时间</th></tr></thead><tbody>${recRows}</tbody></table></div>` : '<p class="r1-note">还没有做题记录</p>'}
      <h4 class="r1-h4b">主观题作答（每次作答单独评分）</h4>${subjectiveRows ? `<div class="r1-scroll r1-scroll-tall"><table><thead><tr><th>题型</th><th>学科</th><th>题目</th><th>学生作答</th><th>评分与评语</th><th>时间</th><th>操作</th></tr></thead><tbody>${subjectiveRows}</tbody></table></div>` : '<p class="r1-note">还没有主观题作答</p>'}
    </section>`;

  // 交互：导出 / 树折叠 / 只看未掌握
  body.querySelector('#r1Docx').onclick = (e) => r1DownloadMistakes(s, {
    subject: body.querySelector('#r1Subj').value, bucket: body.querySelector('#r1Bucket').value, days: Number(body.querySelector('#r1Days').value) || 0,
  }, e.currentTarget);
  const loadDrawing = async (id, image, status) => {
    try {
      const res = await fetch('/api/admin/xreport/subjective/' + id + '/drawing', { headers: { Authorization: 'Bearer ' + Auth.token } });
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/png')) throw new Error('作图加载失败');
      const url = URL.createObjectURL(await res.blob());
      if (!image.isConnected) { URL.revokeObjectURL(url); return; }
      image.onload = () => URL.revokeObjectURL(url); image.onerror = () => { URL.revokeObjectURL(url); status.textContent = '作图加载失败'; };
      image.src = url; status.textContent = '';
    } catch (_) { status.textContent = '作图加载失败，请重试'; }
  };
  body.querySelectorAll('[data-subjective-drawing]').forEach((button) => { button.onclick = () => {
    const id = Number(button.dataset.subjectiveDrawing);
    modal({ title: '学生作图', body: '<p data-drawing-status>正在加载…</p><img class="r4-drawing-image" data-drawing-image alt="学生作图">', onMount: (w) => loadDrawing(id, w.querySelector('[data-drawing-image]'), w.querySelector('[data-drawing-status]')) });
  }; });
  body.querySelectorAll('[data-subjective-grade]').forEach((button) => {
    button.onclick = () => {
      const response = (det.subjective || []).find((r) => String(r.id) === button.dataset.subjectiveGrade); if (!response) return;
      const max = response.max_score == null ? 100 : Number(response.max_score);
      modal({ title: '主观题评分', okText: '保存评分', wide: true,
        body: `<p class="pd-tip">此评分只作用于 ${esc((response.created_at || '').slice(0, 16))} 的这次作答。满分 ${max} 分。${!response.try_id && ['paper', 'mfpaper'].includes(response.kind) ? ' 这条历史作答未关联具体试卷记录，评分不会修改旧试卷总分。' : ''}</p><p><b>题目：</b>${esc(response.stem || '题目已删除')}</p><p><b>学生作答：</b>${response.has_drawing ? '<span data-drawing-status>正在加载作图…</span><img class="r4-drawing-image" data-drawing-image alt="学生作图">' : esc(response.my_answer || '未作答').replace(/\n/g, '<br>')}</p><div class="field"><label>分数（0–${max}）<input class="input" type="number" min="0" max="${max}" step="0.01" id="r1SubjScore" value="${response.score == null ? '' : Number(response.score)}"></label></div><div class="field"><label>评语（选填）<textarea class="input" id="r1SubjComment" rows="3">${esc(response.review_comment || '')}</textarea></label></div>`,
        onMount: (w) => { if (response.has_drawing) loadDrawing(response.id, w.querySelector('[data-drawing-image]'), w.querySelector('[data-drawing-status]')); },
        onOk: async (w, showErr) => {
          const raw = w.querySelector('#r1SubjScore').value;
          if (raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > max) return showErr(`分数应在 0 至 ${max} 之间`);
          await api('/api/admin/xreport/subjective/' + response.id + '/grade', { method: 'POST', body: { score: Number(raw), comment: w.querySelector('#r1SubjComment').value } });
          toast('已保存本次作答评分', 'ok'); setTimeout(() => r1OpenDrawer(uid), 0);
        } });
    };
  });
  if (!acc) return;
  const closed = new Set();
  const tree = body.querySelector('#r1Tree');
  const draw = () => {
    const only = body.querySelector('#r1Weak').checked;
    const html = r1TreeHTML(acc.courses || [], only, closed);
    tree.innerHTML = html || `<div class="empty">${only ? `没有正确率低于 ${R1_WEAK}% 的视频或分组习题，继续保持` : '还没有给视频或小分组绑定习题（课文习题里绑定后这里才有数据）'}</div>`;
  };
  tree.onclick = (e) => {
    const t = e.target.closest('[data-tog]'); if (!t) return;
    const k = t.dataset.tog; if (closed.has(k)) closed.delete(k); else closed.add(k);
    t.setAttribute('aria-expanded', closed.has(k) ? 'false' : 'true');
    const kids = t.nextElementSibling; if (kids) kids.hidden = closed.has(k);
  };
  body.querySelector('#r1Weak').onchange = draw;
  body.querySelector('#r1Open').onclick = () => { closed.clear(); draw(); };
  body.querySelector('#r1Fold').onclick = () => { (acc.courses || []).forEach((c) => { closed.add('c' + c.id); }); draw(); };
  draw();
}

/* ============================================================
   ④ 操作日志（仅总后台）
   ============================================================ */
async function viewOplog() {
  const st = ADM.page.ol = ADM.page.ol || { kw: '', role: '', result: '' };
  const page = Math.max(1, Number(ADM.page.olPage) || 1);
  const size = Math.max(1, Number(ADM.page.olPageSize) || 20);
  const qs = `page=${page}&size=${size}&kw=${encodeURIComponent(st.kw)}&role=${encodeURIComponent(st.role)}&result=${encodeURIComponent(st.result)}`;
  const data = await api('/api/admin/logs?' + qs);
  ADM.page.olPage = data.page; ADM.page.olPageSize = data.size;
  const list = data.list || [];
  const roleTag = (r) => r === '校长' ? '<span class="tag" style="background:#eef4ff;color:#2f6bff">校长</span>'
    : r === '分校' ? '<span class="tag" style="background:#fff5e6;color:#c77700">分校</span>'
      : r === '学生' ? '<span class="tag" style="background:#e7f8ef;color:#0e9f5f">学生</span>'
        : `<span class="tag gray">${esc(r || '—')}</span>`;
  return {
    html: `
    <div class="card">
      <div class="card-h"><h3>${ic('doc')} 操作日志 <span class="tag gray">${data.total}</span></h3></div>
      <div class="toolbar">
        <input class="input" id="olKw" placeholder="搜索账号 / 姓名 / IP / 详情" value="${esc(st.kw)}" style="min-width:220px">
        <select id="olRole" style="min-width:110px">
          <option value="">全部角色</option>
          <option value="校长" ${st.role === '校长' ? 'selected' : ''}>校长</option>
          <option value="分校" ${st.role === '分校' ? 'selected' : ''}>分校</option>
          <option value="学生" ${st.role === '学生' ? 'selected' : ''}>学生</option>
        </select>
        <select id="olResult" style="min-width:110px">
          <option value="">全部结果</option>
          <option value="ok" ${st.result === 'ok' ? 'selected' : ''}>成功</option>
          <option value="fail" ${st.result === 'fail' ? 'selected' : ''}>失败</option>
        </select>
        <button class="btn ghost" id="olSearch">查询</button>
        <button class="btn ghost" id="olReset">重置</button>
      </div>
      <p class="w-tip" style="margin:0 0 12px">记录所有账号（校长 / 分校 / 学生）的登录成功与失败（含 IP），以及后台的新增 / 修改 / 删除操作。仅总后台可查看。</p>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>时间</th><th>用户</th><th>账号</th><th>角色</th><th>模块</th><th>动作</th><th>IP 归属地</th><th>结果</th><th>详情</th></tr></thead>
        <tbody>${list.map((l) => `<tr>
          <td style="font-size:12px;white-space:nowrap">${esc(String(l.created_at || '').slice(0, 19))}</td>
          <td><b>${esc(l.name || '—')}</b></td>
          <td>${esc(l.username || '—')}</td>
          <td>${roleTag(l.role)}</td>
          <td>${esc(l.module || '—')}</td>
          <td>${esc(l.action || '—')}</td>
          <td style="font-size:12px;white-space:nowrap">${esc(l.ip || '—')}${l.loc ? `<span style="color:var(--text3)">（${esc(l.loc)}）</span>` : ''}</td>
          <td>${Number(l.ok) === 1 ? '<span class="tag ok">成功</span>' : '<span class="tag no">失败</span>'}</td>
          <td style="font-size:12px;color:var(--text3);max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.detail)}">${esc(l.detail || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
      ${pagerHTML(data.page, data.size, data.total, 'olPage')}`
      : '<div class="empty">暂无日志</div>'}
    </div>`,
    after: () => {
      bindPager('olPage');
      const go = () => {
        st.kw = document.getElementById('olKw').value.trim();
        st.role = document.getElementById('olRole').value;
        st.result = document.getElementById('olResult').value;
        ADM.page.olPage = 1;
        render();
      };
      document.getElementById('olSearch').onclick = go;
      document.getElementById('olKw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      ['olRole', 'olResult'].forEach((id) => { document.getElementById(id).onchange = go; });
      document.getElementById('olReset').onclick = () => { ADM.page.ol = { kw: '', role: '', result: '' }; ADM.page.olPage = 1; render(); };
    },
  };
}
