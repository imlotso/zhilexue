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
const xrepTabs = () => `<div class="toolbar" style="gap:6px;margin-bottom:14px">
  ${XREP_TABS.map((t) => `<button class="btn ${XREP_TAB === t.k ? 'primary-sm' : 'ghost'}" data-xrep="${t.k}">${ic(t.i)} ${t.t}</button>`).join('')}</div>`;

async function viewXReport() {
  const map = { w: viewWReport, v: viewVReport, e: viewEReport, m: viewMistakeLog };
  const out = await (map[XREP_TAB] || viewWReport)();
  out.html = xrepTabs() + out.html;
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
          const det = await api('/api/admin/xreport/videos/' + b.dataset.vdetail);
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
const EREP = { branch: 'all', kw: '' };

const QT_NAME = { single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序', compound: '组合', cloze: '完形', reading: '阅读' };

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
      <p class="w-tip" style="margin:0 0 12px">统计学生端「做练习 / 试卷」的作答数据：做题数与正确率来自练习作答，错题按错题本（含复习进度）统计，试卷取自智能组卷的交卷记录。点「详情」看试卷成绩和最近的作答明细。</p>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>姓名</th><th>账号</th><th>年级</th><th>校区</th><th>学科做题（对/总）</th><th>做题数</th><th>正确率</th><th>待复习错题</th><th>已掌握</th><th>试卷</th><th>平均分</th><th>最高分</th><th>最近做题</th><th>到期</th><th>状态</th><th>操作</th></tr></thead>
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
          <td><button class="link-btn" data-edetail="${s.id}">详情</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">暂无记录</div>'}
    </div>`,
    after: () => {
      reportBranchBind('erBranch', st);
      document.getElementById('erSearch').onclick = () => { st.kw = document.getElementById('erKw').value.trim(); render(); };
      document.getElementById('erKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('erSearch').click(); };
      document.getElementById('erReset').onclick = () => { st.kw = ''; if (REPORT_IS_PRINCIPAL()) st.branch = 'all'; render(); };
      document.querySelectorAll('[data-edetail]').forEach((b) => b.onclick = async () => {
        try {
          const det = await api('/api/admin/xreport/exercises/' + b.dataset.edetail);
          erepDetail(det);
        } catch (e) { /* api 已提示 */ }
      });
    },
  };
}

function erepDetail(d) {
  const s = d.student || {};
  const paperRows = (d.papers || []).map((p) => `<tr>
    <td><b>${esc(p.title || '试卷已删除')}</b></td>
    <td><b style="color:${Number(p.score) >= Number(p.total) * 0.8 ? '#0e9f5f' : Number(p.score) >= Number(p.total) * 0.6 ? '#c77700' : '#d33'}">${p.score}</b> / ${p.total}</td>
    <td>${p.total ? Math.round(p.score / p.total * 100) : 0}%</td>
    <td style="font-size:12px;color:var(--text3)">${esc((p.created_at || '').slice(0, 16))}</td>
  </tr>`).join('');
  const recRows = (d.rows || []).map((r) => `<tr>
    <td>${esc(QT_NAME[r.type] || r.type || '—')}</td>
    <td>${esc(r.subject || '—')}</td>
    <td title="${esc(r.stem || '')}">${esc(String(r.stem || '').slice(0, 40))}${String(r.stem || '').length > 40 ? '…' : ''}</td>
    <td>${Number(r.is_correct) === 1 ? '<span class="tag ok">对</span>' : '<span class="tag no">错</span>'}</td>
    <td style="font-size:12px;color:var(--text3)">${esc((r.created_at || '').slice(0, 16))}</td>
  </tr>`).join('');
  modal({
    title: `${s.name} · 习题学习报告`,
    wide: true,
    body: `
      <p class="w-tip" style="margin:0 0 12px">${esc(s.grade || '')} ${s.stage === 'primary' ? '小学' : s.stage === 'junior' ? '初中' : ''} ${s.term || ''} · 账号 ${esc(s.username)} · 到期 ${esc(String(s.expire_at || '').slice(0, 10) || '未设置')}</p>
      <div style="margin-bottom:6px"><b>学科做题统计</b>　待复习错题 <b style="color:#d33">${d.wrong_open || 0}</b>　已掌握 <b style="color:#0e9f5f">${d.mastered || 0}</b></div>
      <div style="margin-bottom:14px">${(d.subjects || []).map((x) => rptChip(x.subject, x.n, x.correct, RPT_BLUE)).join('')}</div>
      <div style="font-weight:600;margin-bottom:6px">试卷成绩</div>
      ${paperRows ? `<table style="margin-bottom:16px"><thead><tr><th>试卷</th><th>得分</th><th>得分率</th><th>交卷时间</th></tr></thead><tbody>${paperRows}</tbody></table>`
        : '<p class="w-tip" style="margin:0 0 16px">还没有参加过试卷</p>'}
      <div style="font-weight:600;margin-bottom:6px">最近作答（最近 100 条）</div>
      ${recRows ? `<div style="max-height:36vh;overflow:auto"><table><thead><tr><th>题型</th><th>学科</th><th>题目</th><th>结果</th><th>时间</th></tr></thead><tbody>${recRows}</tbody></table></div>`
        : '<p class="w-tip" style="margin:0">还没有做题记录</p>'}`,
    okText: '关闭',
    onOk: async () => true,
  });
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
