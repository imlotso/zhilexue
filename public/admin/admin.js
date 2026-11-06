// R10 首页及嵌入工作台样式，按需加载，独立于各子应用。
if (!document.getElementById('r10Styles')) { const link = document.createElement('link'); link.id = 'r10Styles'; link.rel = 'stylesheet'; link.href = '/admin/r10.css'; document.head.appendChild(link); }
/* 管理端 SPA（校长后台 / 分校后台） */
const $app = document.getElementById('app');
const ADM = { chapters: [], page: {} };

const ic = (name) => `<i class="ai ai-${name}" aria-hidden="true"></i>`;
window.ic = ic;
const NAV = [
  { k: 'dash', t: '首页', i: 'dashboard' },
  { k: 'branches', t: '分校管理', i: 'building', principalOnly: true },
  { k: 'students', t: '学生管理', i: 'student' },
  { k: 'xreport', t: '学习报告', i: 'chart' },
  { k: 'grades', t: '成绩管理', i: 'doc' },
  { k: 'talks', t: '谈心谈话', i: 'chat' },
  { k: 'care', t: '家校沟通', i: 'phone' },
  { k: 'chapters', t: '课程目录', i: 'list' },
  { k: 'handouts', t: '讲义资料', i: 'book' },
  { k: 'videos', t: '视频管理', i: 'video' },
  { k: 'paper', t: '智能组卷', i: 'doc' },
  { k: 'lessonq', t: '课文习题', i: 'list' },
  { k: 'mfq', t: '题库管理', i: 'doc' },
  { k: 'pending', t: '待审核题目', i: 'doc' },
  { k: 'ktree', t: '知识树管理', i: 'list' },
  { k: 'mfc', t: '网络采集', i: 'link' },
  { k: 'mfp', t: '试卷管理', i: 'folder' },
  { k: 'mfi', t: '录题上传', i: 'upload' },
  { k: 'intake', t: '录题中心', i: 'upload' },
  { k: 'bkfb', t: '错题反馈', i: 'chat' },
  { k: 'mfset', t: 'AI 配置中心', i: 'setting' },
  { k: 'words', t: '词书管理', i: 'book' },
  { k: 'letters', t: '字母乐园', i: 'english' },
  { k: 'phonics', t: '音标训练', i: 'volume' },
  { k: 'aireport', t: 'AI学情诊断', i: 'chart' },
  { k: 'oplog', t: '操作日志', i: 'doc', principalOnly: true },
];
const NAV_GROUPS = [
  { k: 'g-home', t: '首页', i: 'home', leaf: 'dash' },
  { k: 'g-org', t: '学生与账号', i: 'building', items: ['branches', 'students', 'xreport'] },
  { k: 'g-res', t: '教学资源', i: 'folder', items: ['chapters', 'videos', 'handouts', 'words', 'letters', 'phonics'] },
  { k: 'g-bank', t: '智能题库', i: 'doc', items: ['mfq', 'intake', 'pending', 'ktree', 'mfp', 'paper', 'lessonq', 'bkup'] },
  { k: 'g-study', t: '学情与报告', i: 'chart', items: ['grades', 'talks', 'care', 'aireport'] },
  { k: 'g-sys', t: '系统设置', i: 'setting', items: ['mfset', 'oplog'] },
];
const navItem = (k) => NAV.find((n) => n.k === k);
const navOf = () => NAV.filter((n) => !n.principalOnly || (Auth.user && Auth.user.role === 'admin'));
const TITLE = { intake: '录题中心', 'intake-excel': 'Excel 模板导入', mfq: '题库管理', pending: '待审核题目', ktree: '知识树管理', mfset: 'AI 配置中心', mfc: '网络采集', mfp: '试卷管理', mfi: '录题上传', bkfb: '错题反馈记录', grades: '成绩管理', talks: '谈心谈话', care: '家校沟通', dash: '首页', branches: '分校管理', students: '学生管理', xreport: '学习报告', oplog: '操作日志', chapters: '课程目录', handouts: '讲义资料', videos: '视频管理', paper: '智能组卷', lessonq: '课文习题', mistakelog: '错题记录', bkup: '上传审核', words: '词书管理', letters: '字母乐园', phonics: '音标训练', aireport: 'AI学情诊断', 'aireport-view': '学情报告' };
TITLE['intake-photo'] = '拍照 / 截图识别';
TITLE['intake-pdf'] = 'PDF 识别'; TITLE['intake-word'] = 'Word 规则导入';
TITLE['intake-skill'] = 'JSON / 技能包导入'; TITLE['intake-teacher'] = '老师扫码录题'; TITLE['intake-manual'] = '手动创建';
function sideFoldGet() { try { return localStorage.getItem('xuexi_admin_side') === '1'; } catch (e) { return false; } }
function sideFoldSet(v) { try { localStorage.setItem('xuexi_admin_side', v ? '1' : '0'); } catch (e) { /* 忽略 */ } }
function openGroupsGet() {
  try { return JSON.parse(localStorage.getItem('xuexi_admin_nav') || '[]'); } catch (e) { return []; }
}
function openGroupsSet(arr) { try { localStorage.setItem('xuexi_admin_nav', JSON.stringify(arr)); } catch (e) { /* 忽略 */ } }
function navGroupsHTML(cur) {
  const allow = new Set(navOf().map((n) => n.k));
  const open = new Set(openGroupsGet());
  NAV_GROUPS.forEach((g) => {
    if (g.leaf && (cur === g.leaf || cur.startsWith(g.leaf + '-'))) open.add(g.k);
    (g.items || []).forEach((k) => { if (cur === k || cur.startsWith(k + '-')) open.add(g.k); });
  });
  return NAV_GROUPS.map((g) => {
    if (g.leaf) {
      if (!allow.has(g.leaf)) return '';
      const n = navItem(g.leaf);
      const on = cur === n.k || cur.startsWith(n.k + '-');
      return `<a data-go="${n.k}" class="nav-leaf ${on ? 'on' : ''}" title="${n.t}"><span class="ico">${ic(n.i)}</span><span class="txt">${n.t}</span></a>`;
    }
    const items = (g.items || []).map(navItem).filter((n) => n && allow.has(n.k));
    if (!items.length) return '';
    const isOpen = open.has(g.k);
    const childOn = items.some((n) => cur === n.k || cur.startsWith(n.k + '-'));
    return `<div class="nav-group ${isOpen ? 'open' : ''} ${childOn ? 'has-on' : ''}" data-ng="${g.k}">
      <button type="button" class="ng-t" data-ngt="${g.k}" title="${g.t}">
        <span class="ico">${ic(g.i)}</span><span class="txt">${g.t}</span>
        <span class="ng-arrow">▾</span>
      </button>
      <div class="ng-sub">${items.map((n) => {
        const on = cur === n.k || cur.startsWith(n.k + '-');
        const badge = n.k === 'pending' ? '<em class="t11-badge" id="t11BadgePending" hidden></em>' : '';
        return `<a data-go="${n.k}" class="${on ? 'on' : ''}" title="${n.t}"><span class="ico">${ic(n.i)}</span><span class="txt">${n.t}</span>${badge}</a>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

// ---------- 业务常量：仅 4 门学科；年级 3-9 年级 + 中考冲刺；每科统一 4 大类课程 ----------
const SUBJECTS = ['数学', '英语', '物理', '化学'];
const GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const CATEGORIES = ['同步基础', '同步培优', '专项提升', '中考冲刺'];
const CATEGORY_MAP = { '数学': CATEGORIES, '英语': CATEGORIES, '物理': CATEGORIES, '化学': CATEGORIES };
const gradeOptions = (sel) => [''].concat(GRADES).map((g) => `<option value="${g}" ${sel === g ? 'selected' : ''}>${g || '全部年级'}</option>`).join('');
/** 表单里的年级选择：必填，第一项是「请选择年级」占位（不能用「全部年级」） */
const gradePick = (sel) => [''].concat(GRADES).map((g) => `<option value="${g}" ${sel === g ? 'selected' : ''}>${g || '请选择年级'}</option>`).join('');

/* ---------------- 学段（小学 / 初中） ----------------
 * 「专项提升、中考冲刺」这两类课程按学段定位，学生端不再看年级和上下册：
 * 小学账号只看小学专项，初中账号看初中专项 + 全部中考冲刺。
 * 其余分类（同步基础 / 同步培优）仍然按「年级 + 册别」定位。 */
const STAGE_OPTS = [['primary', '小学'], ['junior', '初中']];
const stageLabel = (s) => (s === 'primary' ? '小学' : s === 'junior' ? '初中' : '通用');
const stageTagText = (s) => (s === 'primary' ? '小学专项' : s === 'junior' ? '初中专项' : '未设学段');
const catByStage = (cat) => cat === '专项提升' || cat === '中考冲刺';
/** 章节的定位维度值：专项 / 中考 = 学段，其余 = 年级 */
const chDim = (c) => (catByStage(c.category || '') ? String(c.stage || '') : String(c.grade || ''));
/** 章节列表里显示的「年级 / 学段」文字 */
const chHead = (c) => (catByStage(c.category || '') ? stageTagText(c.stage) : (c.grade || '通用'));
/** 级联 / 筛选里这一级的名称：分类决定它是「年级」还是「学段」 */
const dimName = (cat) => (catByStage(cat) ? '学段' : '年级');
/** 级联 / 筛选第 ② 级的选项 */
function dimOpts(cat, sel, allLabel) {
  const rows = catByStage(cat) ? (cat === '中考冲刺' ? [['junior', '初中']] : STAGE_OPTS) : GRADES.map((g) => [g, g]);
  return `<option value="">${allLabel}</option>`
    + rows.map(([v, t]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${t}</option>`).join('');
}
/** 课程目录被选中后在章节下拉里显示的文字 */
const chOptLabel = (c) => [chHead(c), c.book, c.name].filter(Boolean).join(' · ');
/** 到期时间展示：已过期标红，7 天内标黄，便于一眼看出该续费的学生 */
function expTag(exp) {
  const d = String(exp || '').slice(0, 10);
  if (!d) return '<span class="tag" style="background:#fff5e6;color:#c77700">未设置</span>';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(d + 'T00:00:00');
  const days = Math.round((t - today) / 86400000);
  if (days < 0) return `${d} <span class="tag" style="background:#fdeaea;color:#d33">已到期</span>`;
  if (days <= 7) return `${d} <span class="tag" style="background:#fff5e6;color:#c77700">${days === 0 ? '今天到期' : days + ' 天后到期'}</span>`;
  return d;
}
const subjectOptions2 = (sel, allLabel) => [''].concat(SUBJECTS).map((s) => `<option value="${s}" ${sel === s ? 'selected' : ''}>${s || allLabel}</option>`).join('');

/** 列表分页：返回当前页切片与分页元数据 */
function pageOf(list, pageKey, size = 10) {
  const total = (list || []).length;
  const sz = Math.max(1, Number(ADM.page[pageKey + 'Size']) || size);
  const pages = Math.max(1, Math.ceil(total / sz) || 1);
  let page = Math.max(1, Number(ADM.page[pageKey]) || 1);
  if (page > pages) page = pages;
  ADM.page[pageKey] = page;
  ADM.page[pageKey + 'Size'] = sz;
  const start = (page - 1) * sz;
  return { list: (list || []).slice(start, start + sz), total, page, size: sz, pages };
}

/** Element 风格底部分页条 */
function pagerHTML(page, size, total, pageKey) {
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const sizes = [10, 20, 50];
  let nums = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) nums.push(i);
  } else {
    nums = [1];
    const L = Math.max(2, page - 1);
    const R = Math.min(pages - 1, page + 1);
    if (L > 2) nums.push('…');
    for (let i = L; i <= R; i++) nums.push(i);
    if (R < pages - 1) nums.push('…');
    nums.push(pages);
  }
  return `<div class="ry-pager" data-pkey="${esc(pageKey)}">
    <span class="ry-pager-total">共 ${total} 条</span>
    <select class="ry-pager-size" data-psize="${esc(pageKey)}">${sizes.map((s) => `<option value="${s}" ${s === size ? 'selected' : ''}>${s} 条/页</option>`).join('')}</select>
    <button type="button" class="ry-pager-btn" data-page="${esc(pageKey)}" data-to="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>
    ${nums.map((n) => (n === '…'
      ? '<span class="ry-pager-gap">…</span>'
      : `<button type="button" class="ry-pager-btn ${n === page ? 'on' : ''}" data-page="${esc(pageKey)}" data-to="${n}">${n}</button>`)).join('')}
    <button type="button" class="ry-pager-btn" data-page="${esc(pageKey)}" data-to="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>
  </div>`;
}

/** 把原生日期框换成 Element 日期选择器，值仍写回原 input */
function mountElDate(input) {
  if (!input || typeof Vue === 'undefined' || typeof ELEMENT === 'undefined') return;
  const host = document.createElement('div');
  input.insertAdjacentElement('afterend', host);
  input.hidden = true;
  new Vue({
    el: host,
    data: { v: input.value || '' },
    watch: { v(val) { input.value = val || ''; } },
    template: '<el-date-picker v-model="v" type="date" value-format="yyyy-MM-dd" placeholder="选择日期" style="width:100%"></el-date-picker>',
  });
}

/** Element 上传。list 模式是文件名列表，名字后面有叉号，点掉再保存。 */
function mountElUpload(box, input, opt) {
  if (!box || !input) return;
  opt = opt || {};
  if (typeof Vue === 'undefined' || typeof ELEMENT === 'undefined') {
    input.hidden = false;
    box.appendChild(input);
    if (opt.onPick) input.onchange = () => opt.onPick(input.files[0] || null);
    return;
  }
  const accept = opt.accept || '';
  const multiple = !!opt.multiple;
  const tip = opt.tip || '点击选取文件';
  const existingName = opt.existingName || '';
  if (!opt.list) {
    new Vue({
      el: box,
      methods: {
        sync(file, list) {
          const dt = new DataTransfer();
          (list || []).forEach((f) => { if (f.raw) dt.items.add(f.raw); });
          input.files = dt.files;
          if (opt.onPick) opt.onPick(input.files[0] || null);
        },
      },
      template: `<el-upload class="zx-upload" action="#" :auto-upload="false" :multiple="${multiple}" accept="${accept}" drag :on-change="sync" :on-remove="sync">
        <i class="el-icon-upload"></i>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <div class="el-upload__tip" slot="tip">${tip}</div>
      </el-upload>`,
    });
    return;
  }
  new Vue({
    el: box,
    data() {
      return { list: existingName ? [{ name: existingName, status: 'success', uid: 1 }] : [] };
    },
    methods: {
      sync(file, list) {
        this.list = list || [];
        const dt = new DataTransfer();
        this.list.forEach((f) => { if (f.raw) dt.items.add(f.raw); });
        input.files = dt.files;
        const kept = this.list.some((f) => !f.raw);
        input.dataset.clear = (existingName && !input.files.length && !kept) ? '1' : '';
        if (opt.onPick) opt.onPick(input.files[0] || null);
      },
      onExceed(files) {
        this.$refs.up.clearFiles();
        this.$refs.up.handleStart(files[0]);
      },
    },
    template: `<el-upload ref="up" class="zx-upload zx-file" action="#" :auto-upload="false" :limit="${multiple ? 30 : 1}" :multiple="${multiple}" :file-list="list" accept="${accept}" :on-change="sync" :on-remove="sync" :on-exceed="onExceed">
      <el-button size="small" type="primary">选取文件</el-button>
      <div slot="tip" class="el-upload__tip">${tip}</div>
    </el-upload>`,
  });
}

function bindPager(pageKey) {
  document.querySelectorAll(`[data-page="${pageKey}"]`).forEach((b) => {
    b.onclick = () => {
      if (b.disabled) return;
      const to = Number(b.dataset.to);
      if (!to || to < 1) return;
      ADM.page[pageKey] = to;
      render();
    };
  });
  document.querySelectorAll(`[data-psize="${pageKey}"]`).forEach((sel) => {
    sel.onchange = () => {
      ADM.page[pageKey + 'Size'] = Number(sel.value) || 10;
      ADM.page[pageKey] = 1;
      render();
    };
  });
}

// ------------------------------------------------------------ 通用弹窗
function modal({ title, body, wide, okText = '保存', onOk, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'el-dialog__wrapper mask';
  wrap.innerHTML = `<div role="dialog" class="el-dialog modal ${wide ? 'wide el-dialog--wide' : ''}">
    <div class="el-dialog__header modal-h">
      <span class="el-dialog__title">${esc(title)}</span>
      <button type="button" class="el-dialog__headerbtn close-x" aria-label="Close"><i class="el-dialog__close el-icon el-icon-close"></i></button>
    </div>
    <div class="el-dialog__body modal-b"><div id="mErr" class="el-alert el-alert--error alert hide" style="margin-bottom:12px"><div class="el-alert__content"><span class="el-alert__title"></span></div></div>${body}</div>
    ${onOk ? `<div class="el-dialog__footer modal-f">
      <button type="button" class="el-button el-button--default btn ghost" id="mCancel">取消</button>
      <button type="button" class="el-button el-button--primary btn" id="mOk">${esc(okText)}</button>
    </div>` : ''}
  </div>`;
  document.body.appendChild(wrap);
  let saving = false;
  const close = () => { if (!saving) wrap.remove(); };
  if (typeof DialogUX !== 'undefined') DialogUX.bind(wrap);
  wrap.querySelector('.close-x').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const c = wrap.querySelector('#mCancel'); if (c) c.onclick = close;
  const errBox = wrap.querySelector('#mErr');
  const errTitle = errBox.querySelector('.el-alert__title') || errBox;
  errBox.setAttribute('role', 'alert');
  const showErr = (m) => {
    if (errTitle !== errBox) errTitle.textContent = m; else errBox.textContent = m;
    errBox.classList.remove('hide');
    return false;
  };
  if (onOk) wrap.querySelector('#mOk').onclick = async () => {
    if (saving) return; saving = true;
    const controls = [wrap.querySelector('#mOk'), wrap.querySelector('#mCancel'), wrap.querySelector('.close-x')].filter(Boolean);
    controls.forEach(el=>{el.disabled=true;});wrap.querySelector('[role="dialog"]').setAttribute('aria-busy','true');
    try {
      const r = await onOk(wrap, showErr);
      if (r !== false) { saving = false; close(); }
    } catch (e) { showErr(e.message || '保存失败，请重试'); }
    finally { saving = false; if(wrap.isConnected){controls.forEach(el=>{el.disabled=false;});wrap.querySelector('[role="dialog"]').removeAttribute('aria-busy');} }
  };
  if (onMount) { try { const mounting = onMount(wrap, showErr); if(mounting && mounting.catch)mounting.catch(e=>showErr(e.message || '表单加载失败')); } catch(e) { showErr(e.message || '表单加载失败，请重试'); } }
  if (typeof r10Enhance === 'function') r10Enhance(wrap);
  return { el: wrap, close };
}

/**
 * 删除密码确认弹窗：讲义 / 视频的 单个删除 与 批量删除 都要先输入删除密码。
 * 密码由服务端校验（环境变量 DEL_PWD），前端不保存也不比对密码明文。
 * onOk(pwd, err) 里做真正的删除请求；密码错误时后端返回 msg，由 modal 统一弹出并保持输入。
 */
function askPwd(title, tip, onOk) {
  modal({
    title,
    okText: '确认删除',
    body: `
      <p class="w-tip" style="margin:0 0 12px">${esc(tip || '删除操作不可恢复，请输入删除密码确认。')}</p>
      <div class="field"><label>删除密码</label>
        <input class="input" type="password" id="delPwd" placeholder="请输入删除密码" autocomplete="off"></div>`,
    onMount: (w) => setTimeout(() => { const i = w.querySelector('#delPwd'); if (i) i.focus(); }, 80),
    onOk: async (w, err) => {
      const pwd = w.querySelector('#delPwd').value.trim();
      if (!pwd) return err('请输入删除密码');
      await onOk(pwd, err);
    },
  });
}

/**
 * AI 配置的唯一入口（T2）：顶栏「⚙️ AI 配置」、错题重组页的「AI 配置」都跳到「设置 → AI 配置中心」。
 * 全站所有 AI 能力（学情报告 / AI 补全 / 拍照识别 / 单词 AI…）读的是那里启用的模型档案，不再有第二份配置。
 */
function openAiConfig() {
  if (location.hash === '#/mfset') render(); else location.hash = '#/mfset';
}

/**
 * 修改当前登录账号（校长 / 分校）的密码。
 * 正式上线前必须把初始密码 123456 改掉——之前后台没有这个入口，只能靠改数据库，所以补在这里。
 */
function openChangePwdAdmin() {
  modal({
    title: '修改密码',
    okText: '保存',
    body: `<div class="field"><label>原密码</label><input class="input" id="ap1" type="password" autocomplete="current-password"></div>
      <div class="field"><label>新密码</label><input class="input" id="ap2" type="password" autocomplete="new-password" placeholder="至少 6 位"></div>
      <div class="field"><label>确认密码</label><input class="input" id="ap3" type="password" autocomplete="new-password"></div>`,
    onOk: async (w, err) => {
      const a = w.querySelector('#ap1').value;
      const b = w.querySelector('#ap2').value;
      const c = w.querySelector('#ap3').value;
      if (!a) return err('请输入原密码');
      if (b.length < 6) return err('新密码至少 6 位');
      if (b !== c) return err('两次输入的新密码不一致');
      if (b === a) return err('新密码不能和原密码相同');
      await api('/api/change-password', { method: 'POST', body: { oldPassword: a, newPassword: b } });
      toast('密码修改成功，请牢记新密码', 'ok');
    },
  });
}

/**
 * 级联选择课程目录：① 学科 → ② 课程分类 → ③ 年级/学段 → ④ 课程目录（章节）→ ⑤ 分级目录（可选）
 * ③ 的名称与选项跟着 ② 的分类变：同步基础 / 同步培优 选「年级」，专项提升 / 中考冲刺 选「学段」。
 * p 为 id 前缀（同一页面多个弹窗不冲突）；sel 传章节对象用于回显；secId 传分级目录 id 用于回显
 */
const gradeLabel = (g) => g || '通用（不限年级）';
const chapterCascadeHTML = (p, sel, secId) => {
  const sub = sel ? sel.subject : '';
  const cat = sel ? sel.category : '';
  const dim = sel ? chDim(sel) : '';
  const dims = sel ? dimOpts(cat, dim, '通用（不限）') : dimOpts('', '', '通用（不限）');
  const chId = sel ? sel.id : '';
  const chs = (sub && cat) ? ADM.chapters.filter((c) => c.subject === sub && (c.category || '') === cat && (!dim || chDim(c) === dim)) : [];
  return `<div class="cas">
    <div class="field"><label>① 学科 *</label>
      <select class="input" id="${p}-subject"><option value="">请选择学科</option>
        ${SUBJECTS.map((s) => `<option value="${s}" ${sub === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>② 课程分类 *</label>
      <select class="input" id="${p}-category" ${sub ? '' : 'disabled'}><option value="">${sub ? '请选择课程分类' : '请先选学科'}</option>
        ${sub ? CATEGORIES.map((c) => `<option value="${c}" ${cat === c ? 'selected' : ''}>${c}</option>`).join('') : ''}</select></div>
    <div class="field"><label>③ ${dimName(cat)}</label>
      <select class="input" id="${p}-grade" ${sub ? '' : 'disabled'}>${sub ? dims : '<option value="">请先选学科</option>'}</select></div>
    <div class="field"><label>④ 课程目录（章节） *</label>
      <select class="input" id="${p}-chapter" ${(sub && cat) ? '' : 'disabled'}><option value="">${(sub && cat) ? '请选择课程目录' : '请先选上级'}</option>
        ${chs.map((c) => `<option value="${c.id}" ${Number(chId) === c.id ? 'selected' : ''}>${esc(chOptLabel(c))}</option>`).join('')}</select></div>
    <div class="field cas-full"><label>⑤ 分级目录（可选，学生端会折叠成一层）</label>
      <select class="input" id="${p}-section" disabled><option value="">不分组（直接放在章节下）</option></select></div>
  </div>`;
};
const cascadeChapterId = (root, p) => (root.querySelector('#' + p + '-chapter') || {}).value || '';
const cascadeSectionId = (root, p) => (root.querySelector('#' + p + '-section') || {}).value || '';
function bindChapterCascade(root, p, onChange) {
  const sSel = root.querySelector('#' + p + '-subject');
  const gSel = root.querySelector('#' + p + '-grade');
  const cSel = root.querySelector('#' + p + '-category');
  const hSel = root.querySelector('#' + p + '-chapter');
  const secSel = root.querySelector('#' + p + '-section');
  const has = (sel, v) => [...sel.options].some((o) => o.value === v);
  const emit = () => { if (onChange) onChange(cascadeChapterId(root, p), cascadeSectionId(root, p)); };
  const fillSections = (keepId) => {
    const cid = hSel.value;
    const list = cid ? sectionsOf(cid) : [];
    if (secSel) {
      secSel.disabled = !cid;
      secSel.innerHTML = `<option value="">不分组（直接放在章节下）</option>`
        + list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
      if (keepId && has(secSel, String(keepId))) secSel.value = String(keepId);
    }
    emit();
  };
  const fillChapters = (keepId, keepSection) => {
    const sub = sSel.value, dim = gSel.value, cat = cSel.value;
    const list = (sub && cat) ? ADM.chapters.filter((c) => c.subject === sub && (c.category || '') === cat && (!dim || chDim(c) === dim)) : [];
    hSel.disabled = !(sub && cat);
    hSel.innerHTML = `<option value="">${(sub && cat) ? (list.length ? '请选择课程目录' : `该${dimName(cat)}/分类下暂无章节，请先到「课程目录」新增`) : '请先选上级'}</option>` +
      list.map((c) => `<option value="${c.id}">${esc(chOptLabel(c))}</option>`).join('');
    if (keepId && has(hSel, String(keepId))) hSel.value = String(keepId);
    fillSections(keepSection);
  };
  // 分类变了 → 年级这一级在「年级 / 学段」之间切换（选项与已选值都要换）
  const fillDims = (keepDim) => {
    const cat = cSel.value;
    const prev = keepDim === undefined ? gSel.value : keepDim;
    gSel.innerHTML = dimOpts(cat, '', '通用（不限）');
    if (prev && has(gSel, prev)) gSel.value = prev;
    else gSel.value = '';
  };
  const fillCats = () => {
    const prevCat = cSel.value, prevCh = hSel.value, prevSec = secSel ? secSel.value : '', sub = sSel.value;
    gSel.disabled = !sub; // 选了学科后年级/学段即可选
    cSel.disabled = !sub;
    cSel.innerHTML = `<option value="">${sub ? '请选择课程分类' : '请先选学科'}</option>` +
      (sub ? CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('') : '');
    if (prevCat && has(cSel, prevCat)) cSel.value = prevCat;
    fillDims();          // 回显时保留已选年级/学段；分类变了由 cSel.onchange 重置
    fillChapters(prevCh, prevSec);
  };
  sSel.onchange = () => { cSel.value = ''; fillCats(); };
  gSel.onchange = () => fillChapters(hSel.value, secSel ? secSel.value : '');
  cSel.onchange = () => { fillDims(''); fillChapters(); };
  hSel.onchange = () => fillSections(); // 手动选定章节：保留章节选中值，刷新分级目录并通知回调
  if (secSel) secSel.onchange = emit;
  fillCats();
}
const levelSelectHTML = (sel) => ['basic', 'plus', 'vip'].map((k) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${LEVEL_NAME[k]}</option>`).join('');

/**
 * 列表页五级筛选：① 学科 → ② 年级/学段 → ③ 课程分类 → ④ 课程目录 → ⑤ 分级目录（每级都可选「全部」）
 * 同样地，② 跟着 ③ 的分类在「年级」和「学段」之间切换。
 * 状态存在 ADM.page[p] = { subject, grade, category, chapter, section }
 */
const chapterFilterHTML = (p) => `<span id="${p}-wrap" class="cas-filter">
  <select id="${p}-subject" style="min-width:104px"><option value="">全部学科</option>${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select>
  <select id="${p}-category" style="min-width:118px" disabled><option value="">全部分类</option></select>
  <select id="${p}-grade" style="min-width:110px">${dimOpts('', '', '全部年级')}</select>
  <select id="${p}-chapter" style="min-width:190px"><option value="">全部章节</option></select>
  <select id="${p}-section" style="min-width:150px" disabled><option value="">全部分级</option></select></span>`;
function bindChapterFilter(root, p, onChange) {
  const st = ADM.page[p] = ADM.page[p] || { subject: '', grade: '', category: '', chapter: '', section: '' };
  const sSel = root.querySelector('#' + p + '-subject');
  const gSel = root.querySelector('#' + p + '-grade');
  const cSel = root.querySelector('#' + p + '-category');
  const hSel = root.querySelector('#' + p + '-chapter');
  const secSel = root.querySelector('#' + p + '-section');
  const has = (sel, v) => sel && [...sel.options].some((o) => o.value === v);
  let inited = false;
  const emit = () => { if (inited && onChange) onChange(st); };
  const match = (c) => (!st.subject || c.subject === st.subject)
    && (!st.category || (c.category || '') === st.category)
    && (!st.grade || chDim(c) === st.grade);
  const fillSecs = () => {
    if (!secSel) return;
    st.chapter = hSel.value;
    const list = hSel.value ? sectionsOf(hSel.value) : [];
    secSel.disabled = !hSel.value;
    secSel.innerHTML = `<option value="">全部分级</option>` + list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if (st.section && has(secSel, String(st.section))) secSel.value = String(st.section);
    st.section = secSel.value;
    emit();
  };
  const fillChs = () => {
    st.subject = sSel.value; st.grade = gSel.value; st.category = cSel.value;
    const l = ADM.chapters.filter(match);
    hSel.innerHTML = `<option value="">全部章节</option>` + l.map((c) => `<option value="${c.id}">${esc(chOptLabel(c))}</option>`).join('');
    if (st.chapter && has(hSel, String(st.chapter))) hSel.value = String(st.chapter);
    fillSecs();
  };
  const fillDims = (keep) => {
    const prev = keep === undefined ? (gSel.value || st.grade || '') : keep;
    gSel.innerHTML = dimOpts(cSel.value, '', dimName(cSel.value) === '学段' ? '全部学段' : '全部年级');
    gSel.value = prev && has(gSel, prev) ? prev : '';
  };
  sSel.value = st.subject || '';
  const fillCats = () => {
    const sub = sSel.value;
    cSel.disabled = !sub;
    cSel.innerHTML = `<option value="">全部分类</option>` + (sub ? CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('') : '');
    if (st.category && has(cSel, st.category)) cSel.value = st.category;
    fillDims();
    fillChs();
  };
  sSel.onchange = () => { cSel.value = ''; st.category = ''; fillCats(); };
  gSel.onchange = fillChs;
  cSel.onchange = () => { fillDims(''); fillChs(); };
  hSel.onchange = fillSecs;
  if (secSel) secSel.onchange = fillSecs;
  fillCats();
  inited = true;
}
/** 按五级筛选状态过滤带 chapter_id / section_id 的行 */
const filterByChapterState = (st, rows) => {
  /* 章节/目录可能已在别处删除：状态里残留失效 id 会把列表过滤成空，先自愈 */
  if (st.chapter && !ADM.chapters.some((c) => Number(c.id) === Number(st.chapter))) st.chapter = '';
  if (st.section && !(ADM.sections || []).some((s) => Number(s.id) === Number(st.section))) st.section = '';
  const ids = new Set(ADM.chapters
    .filter((c) => (!st.subject || c.subject === st.subject)
      && (!st.category || (c.category || '') === st.category)
      && (!st.grade || chDim(c) === st.grade))
    .map((c) => c.id));
  return rows.filter((r) => {
    if (st.chapter && Number(r.chapter_id) !== Number(st.chapter)) return false;
    if (!st.chapter && !ids.has(Number(r.chapter_id))) return false;
    if (st.section && Number(r.section_id) !== Number(st.section)) return false;
    return true;
  });
};

async function loadMeta() {
  ADM.chapters = await api('/api/admin/chapters');
  ADM.sections = await api('/api/admin/sections').catch(() => []);
}
/** 某章节下的分级目录（学生端会折叠成一层） */
const sectionsOf = (chapterId) => (ADM.sections || []).filter((s) => Number(s.chapter_id) === Number(chapterId));

// ------------------------------------------------------------ 登录
function renderLogin() {
  $app.innerHTML = `
  <div class="lg2-wrap">
    <section class="lg2-brand">
      <div class="lg2-top">
        <img class="lg2-logo" src="/img/logo.jpg" alt="智学课堂">
        <div class="lg2-head">
          <h1>纸屏结合Ai智学系统</h1>
          <p>线上看课&nbsp;&nbsp;线下刷题</p>
        </div>
      </div>
      <div class="lg2-cards">
        <div class="lg2-card">江苏地区专版</div>
        <div class="lg2-card">英语&nbsp;&nbsp;数学&nbsp;&nbsp;物理&nbsp;&nbsp;化学</div>
        <div class="lg2-card">基础&nbsp;&nbsp;培优&nbsp;&nbsp;专项&nbsp;&nbsp;压轴</div>
      </div>
      <svg class="lg2-illus" viewBox="0 0 620 170" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="lg2bk1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#9dbdf2"/><stop offset="1" stop-color="#3a68c8"/>
          </linearGradient>
          <linearGradient id="lg2bk2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#c4d8f7"/><stop offset="1" stop-color="#5b8ad8"/>
          </linearGradient>
          <linearGradient id="lg2scr" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4a86f0"/><stop offset="1" stop-color="#2b5ce6"/>
          </linearGradient>
        </defs>
        <ellipse cx="92" cy="142" rx="78" ry="10" fill="rgba(8,26,84,.28)"/>
        <ellipse cx="264" cy="144" rx="60" ry="9" fill="rgba(8,26,84,.22)"/>
        <ellipse cx="452" cy="152" rx="84" ry="11" fill="rgba(8,26,84,.30)"/>
        <g transform="rotate(-5 92 120)">
          <rect x="22" y="102" width="140" height="34" rx="7" fill="url(#lg2bk1)" stroke="#1c3fa8" stroke-width="2"/>
          <rect x="31" y="108" width="122" height="11" rx="3" fill="#fff" opacity=".95"/>
          <path d="M37 115.5 h110 M41 119 h102" stroke="#c9d9f4" stroke-width="1.4"/>
          <path d="M50 128 h86" stroke="rgba(255,255,255,.75)" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        <g transform="rotate(6 88 84)">
          <rect x="32" y="68" width="124" height="32" rx="7" fill="url(#lg2bk2)" stroke="#16308f" stroke-width="2"/>
          <rect x="40" y="73" width="108" height="10" rx="3" fill="#fff" opacity=".95"/>
          <path d="M46 80.5 h96 M50 84 h88" stroke="#d6e3f8" stroke-width="1.3"/>
          <circle cx="54" cy="90" r="3.5" fill="#fff" opacity=".9"/>
          <path d="M66 90 h70" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        <g transform="rotate(-4 258 82)">
          <path d="M204 24 h96 v100 l-22 20 h-74 z" fill="#fff" opacity=".98"/>
          <path d="M218 44 h60 M218 60 h60 M218 76 h60 M218 92 h40" stroke="#5b83d8" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M278 124 q-4 -14 0 -22 l22 22 h-22 z" fill="#dbe6f8"/>
          <path d="M278 124 h22" stroke="#9fb8e6" stroke-width="2.5"/>
          <path d="M276 124 q-2 -10 2 -18" stroke="#b9cdf0" stroke-width="2"/>
        </g>
        <path d="M418 18 h104 l28 118 h-160 z" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linejoin="round"/>
        <rect x="368" y="28" width="140" height="104" rx="12" fill="#173063" stroke="#0d1f4a" stroke-width="2"/>
        <rect x="376" y="36" width="124" height="88" rx="7" fill="#eef4ff"/>
        <rect x="384" y="44" width="44" height="36" rx="6" fill="url(#lg2scr)"/>
        <circle cx="398" cy="56" r="5" fill="rgba(255,255,255,.85)"/>
        <path d="M438 52 h52 M438 64 h40 M438 76 h56 M438 88 h34" stroke="#7fa3e8" stroke-width="4.5" stroke-linecap="round"/>
        <rect x="384" y="100" width="24" height="9" rx="4" fill="#a9c3f2"/>
        <rect x="414" y="100" width="24" height="9" rx="4" fill="#c9daf7"/>
        <rect x="444" y="100" width="36" height="9" rx="4" fill="#a9c3f2"/>
        <path d="M368 54 v64" stroke="rgba(255,255,255,.4)" stroke-width="2.5"/>
        <g fill="rgba(255,255,255,.6)">
          <circle cx="184" cy="26" r="3"/><circle cx="340" cy="20" r="2.5"/><circle cx="540" cy="26" r="3"/>
          <circle cx="566" cy="80" r="2.5"/><circle cx="580" cy="136" r="3"/><circle cx="320" cy="150" r="2.5"/>
        </g>
      </svg>
    </section>
    <section class="lg2-main">
      <div class="lg2-card-form">
        <div class="lg2-flogo"><img src="/img/logo.jpg" alt="智学课堂"><b>校长/教师登录</b></div>
        <div id="loginErr" class="alert hide" role="alert" aria-live="polite"></div>
        <form id="loginForm" novalidate>
          <div class="field"><label>账号</label><input class="input" name="username" required autocomplete="username" placeholder="请输入账号"></div>
          <div class="field"><label>密码</label><input class="input" name="password" type="password" required autocomplete="current-password" placeholder="请输入密码"></div>
          <button class="btn lg2-submit" type="submit" id="loginBtn">登 录</button>
        </form>
        <p class="lg2-reg"><span>如需开通账号，请联系校长或平台管理员</span><a href="/" class="lg2-back">返回学生端</a></p>
      </div>
    </section>
  </div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = document.getElementById('loginBtn'), err = document.getElementById('loginErr');
    const missing = !f.username.value.trim() ? f.username : !f.password.value ? f.password : null;
    if (missing) { err.textContent = missing === f.username ? '请输入账号' : '请输入密码'; err.classList.remove('hide'); missing.focus(); return; }
    err.classList.add('hide');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 登录中';
    try {
      const d = await api('/api/login', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value, role: 'admin' } });
      Auth.token = d.token; Auth.user = d.user;
      location.hash = '#/dash';
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); btn.disabled = false; btn.textContent = '登 录'; }
  };
}

// ------------------------------------------------------------ 外壳
function shell(inner) {
  const cur = (location.hash.replace('#/', '').split('?')[0]) || 'dash';
  const u = Auth.user || {};
  const title = TITLE[cur] || '首页';
  const folded = sideFoldGet();
  return `
  <div class="layout admin-app ${folded ? 'side-fold' : ''}">
    <div class="t11-scrim" id="t11Scrim"></div>
    <aside class="side">
      <div class="brand">${brandHTML('管理端')}</div>
      <nav class="nav">${navGroupsHTML(cur)}</nav>
      <div class="side-foot">${u.role === 'branch' ? '分校管理端' : '系统管理端'}</div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="tb-title">
          <button type="button" class="ry-fold" id="btnFold" title="${folded ? '展开菜单' : '收起菜单'}"><i></i><i></i><i></i></button>
          <div class="tb-crumb">${ic('home')} <span>/</span> <b>${title}</b></div>
        </div>
        <div class="who">
          <button class="link-btn" id="btnPwd">${ic('lock')} 修改密码</button>
          <a href="/" target="_blank" class="link-btn" id="btnStu">${ic('user')} 学生端</a>
          <div class="who-user">
            <div class="avatar">${esc((u.name || 'A').slice(0, 1))}</div>
            <span>${esc(u.name || '管理员')}${u.role === 'branch' ? ' · 分校' : ''}</span>
          </div>
          <button class="link-btn danger" id="btnOut">${ic('logout')} 退出</button>
        </div>
      </div>
      <div class="content" id="view">${inner}</div>
    </div>
  </div>`;
}
function bindShell() {
  document.querySelectorAll('.nav a[data-go]').forEach((a) => a.onclick = () => { location.hash = '#/' + a.dataset.go; });
  document.querySelectorAll('[data-ngt]').forEach((b) => {
    b.onclick = () => {
      const g = b.dataset.ngt;
      const box = b.closest('.nav-group');
      const open = !box.classList.contains('open');
      box.classList.toggle('open', open);
      const arr = openGroupsGet().filter((x) => x !== g);
      if (open) arr.push(g);
      openGroupsSet(arr);
    };
  });
  const f = document.getElementById('btnFold');
  if (f) f.onclick = () => {
    const app = document.querySelector('.admin-app');
    // 手机宽度：侧栏是抽屉，点三道杠开 / 关（不记住；换页会重新渲染成关闭状态）；宽屏：沿用原来的"折叠成图标栏"
    if (window.matchMedia && window.matchMedia('(max-width:820px)').matches) { app.classList.toggle('t11-drawer'); return; }
    sideFoldSet(!sideFoldGet()); app.classList.toggle('side-fold', sideFoldGet());
  };
  const scrim = document.getElementById('t11Scrim');
  if (scrim) scrim.onclick = () => document.querySelector('.admin-app').classList.remove('t11-drawer');
  // 「待审核题目」菜单角标：入库前还没审的题目数（0 不显示）
  const bp = document.getElementById('t11BadgePending');
  if (bp) api('/api/admin/bank/mf/ext/badge-counts', { silent: true }).then((c) => {
    const n = Number(c && c.pending) || 0;
    if (n > 0 && document.getElementById('t11BadgePending')) { bp.textContent = n > 99 ? '99+' : String(n); bp.hidden = false; }
  }).catch(() => { /* 角标取不到不影响使用 */ });
  const o = document.getElementById('btnOut');
  if (o) o.onclick = async () => {
    if (await elConfirm({ title: '退出登录', message: '确定退出登录？', okText: '退出' })) {
      Auth.clear(); location.hash = '#/login';
    }
  };
  const ac = document.getElementById('btnAiCfg');
  if (ac) ac.onclick = () => openAiConfig();
  const pw = document.getElementById('btnPwd');
  if (pw) pw.onclick = () => openChangePwdAdmin();
  // 页内导航是不带 href 的 <a>，阻止默认跳转（否则地址栏 hash 会被清掉）
  if (!window.__navGuard) {
    window.__navGuard = 1;
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a:not([href])') : null;
      if (a) e.preventDefault();
    });
  }
}

// ------------------------------------------------------------ 数据概览
async function viewDash() {
  const d = await api('/api/admin/dashboard');
  // 题目审核池尚未按分校隔离，分校首页不展示全局待审核数量。
  const bc = Auth.user && Auth.user.role === 'admin' ? await api('/api/admin/bank/mf/ext/badge-counts', { silent: true }).catch(() => null) : null;
  const period = ADM.page.dashPeriod === 'week' ? 'week' : 'today';
  const data = d[period];
  const rate = data.answers ? Math.round(data.correct * 100 / data.answers) + '%' : '—';
  const max = Math.max(1, ...d.trend.map((x) => x.answers));
  const pending = bc && Number.isFinite(Number(bc.pending)) ? Number(bc.pending) : null;
  const metrics = [
    ['活跃学生', data.active, '登录、做题或学习进度有更新'],
    ['做题量', data.answers, '提交的题目作答次数'],
    ['答题正确率', rate, '正确作答次数 ÷ 作答次数'],
    ['视频完播', data.completed, '已完播且进度在所选期间更新'],
    ['待复习错题', d.due, '截至今天待复习的错题'],
  ];
  const quick = [['students','student','学生管理'],['mfq','doc','题库管理'],['pending','list','待审核题目'],['paper','book','智能组卷'],['videos','video','视频管理'],['xreport','chart','学习报告']];
  return { html: `<section class="r10-dash">
    <div class="r10-heading"><div><h2>学习概览</h2><p>关注学生学习进展与需要处理的事项</p></div><div class="r10-period" role="group" aria-label="统计时间"><button class="${period === 'today' ? 'active' : ''}" data-period="today">今日</button><button class="${period === 'week' ? 'active' : ''}" data-period="week">本周</button></div></div>
    <div class="r10-metrics">${metrics.map(([name,value,hint]) => `<div class="r10-metric" title="${esc(hint)}"><span>${name}</span><strong>${value}</strong><small>${esc(hint)}</small></div>`).join('')}</div>
    <div class="r10-grid"><section class="card r10-panel"><div class="r10-panel-head"><div><h3>近 14 天学习趋势</h3><p>每日题目作答次数</p></div></div><div class="r10-chart" role="img" aria-label="近14天每日题目作答次数">${d.trend.map((x) => `<div class="r10-bar-col" title="${esc(x.date)}：${x.answers} 次"><span>${x.answers || ''}</span><div class="r10-bar" style="height:${Math.max(x.answers ? 4 : 1, Math.round(x.answers / max * 100))}%"></div><small>${esc(x.date.slice(5))}</small></div>`).join('')}</div></section>
    <section class="card r10-panel"><div class="r10-panel-head"><div><h3>待办事项</h3><p>及时跟进教学工作</p></div></div><div class="r10-todos">${pending === null ? '' : `<button data-go="pending"><span>待审核题目</span><b>${pending}</b></button>`}<button data-go="bkfb"><span>待处理错题反馈</span><b>${d.feedback}</b></button><button data-go="students"><span>7 天内到期学生</span><b>${d.expiring}</b></button></div></section></div>
    <section class="card r10-panel"><div class="r10-panel-head"><div><h3>快捷入口</h3><p>常用教学管理功能</p></div></div><div class="r10-quick">${quick.map(([go,icon,name]) => `<button data-go="${go}">${ic(icon)}<span>${name}</span></button>`).join('')}</div></section>
  </section>`, after: () => {
    document.querySelectorAll('.r10-dash [data-go]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.go; });
    document.querySelectorAll('.r10-dash [data-period]').forEach((b) => b.onclick = () => { ADM.page.dashPeriod = b.dataset.period; render(); });
  } };
}

// ------------------------------------------------------------ 学生管理
async function viewStudents() {
  await loadMeta();
  const kw = (ADM.page.stuKw || '');
  const grade = ADM.page.stuGrade || '';
  const page = Math.max(1, Number(ADM.page.stuPage) || 1);
  const size = Math.max(1, Number(ADM.page.stuPageSize) || 10);
  const data = await api(`/api/admin/students?kw=${encodeURIComponent(kw)}&grade=${encodeURIComponent(grade)}&page=${page}&size=${size}`);
  const list = Array.isArray(data) ? data : (data.list || []);
  const total = Array.isArray(data) ? list.length : Number(data.total || 0);
  const curPage = Array.isArray(data) ? 1 : Number(data.page || page);
  const curSize = Array.isArray(data) ? size : Number(data.size || size);
  ADM.page.stuPage = curPage;
  ADM.page.stuPageSize = curSize;
  return {
    html: `
    <div class="card">
      <div class="card-h">
        <h3>${ic('student')} 学生账号 <span class="tag gray">${total}</span></h3>
        <div style="display:flex;gap:10px">
          <button class="btn ghost" id="btnStuDel" style="color:#F56C6C;border-color:#fbc4c4">批量删除</button>
          <button class="btn ghost" id="btnBatch">批量开通</button>
          <button class="btn primary-sm" id="btnAdd">${ic('plus')} 开通学生</button>
        </div>
      </div>
      <div class="toolbar">
        <input class="input" id="sKw" placeholder="搜索姓名/账号" style="width:240px;flex:0 0 240px" value="${esc(kw)}">
        <select id="sGrade">${gradeOptions(grade)}</select>
        <button class="btn ghost" id="sSearch">查询</button>
        <button class="btn ghost" id="sReset">重置</button>
      </div>
      ${list.length ? `<div style="overflow-x:auto"><table>
        <thead><tr><th style="width:34px"><input type="checkbox" id="stuAll" title="全选 / 全不选"></th><th>姓名</th><th>账号</th><th>年级</th><th>学段</th><th>册别</th><th>倍速播放</th><th>状态</th><th>到期</th><th>最后登录</th><th>操作</th></tr></thead>
        <tbody>${list.map((s) => `<tr>
          <td><input type="checkbox" class="stu-chk" value="${s.id}"></td><td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td>
          <td>${esc(s.grade || '-')}</td>
          <td>${s.stage ? `<span class="tag" style="background:${s.stage === 'primary' ? '#e7f8ef' : '#eef4ff'};color:${s.stage === 'primary' ? '#0e9f5f' : '#2f6bff'}">${s.stage === 'primary' ? '小学' : '初中'}</span>` : '<span class="tag gray">未设置</span>'}</td>
          <td>${s.term ? `<span class="tag">${esc(s.term)}</span>` : '<span class="tag gray">不限</span>'}</td>
          <td><button class="switch ${s.allow_speed ? 'on' : ''}" data-speed="${s.id}" data-cur="${s.allow_speed ? 1 : 0}" title="点击切换该学生的视频倍速播放权限"><i></i></button>
            <span style="font-size:12px;color:var(--text3);margin-left:6px">${s.allow_speed ? '允许' : '禁止'}</span></td>
          <td>${s.status ? '<span class="tag ok">正常</span>' : '<span class="tag gray">停用</span>'}</td>
          <td>${expTag(s.expire_at)}</td>
          <td style="font-size:12px;color:var(--text3)">${esc(s.last_login || '-')}</td>
          <td><div class="acts">
            <button class="link-btn" data-edit="${s.id}">编辑</button>
            <button class="link-btn" data-pwd="${s.id}">重置密码</button>
            <button class="link-btn danger" data-del="${s.id}">删除</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>
        ${pagerHTML(curPage, curSize, total, 'stuPage')}`
      : '<div class="empty">暂无学生</div>'}
    </div>`,
    after: () => bindStudents(list),
  };
}

function bindStudents(list) {
  bindPager('stuPage');
  document.getElementById('sSearch').onclick = () => { ADM.page.stuKw = document.getElementById('sKw').value; ADM.page.stuGrade = document.getElementById('sGrade').value; ADM.page.stuPage = 1; render(); };
  document.getElementById('sReset').onclick = () => { ADM.page.stuKw = ''; ADM.page.stuGrade = ''; ADM.page.stuPage = 1; render(); };
  document.getElementById('sKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('sSearch').click(); };
  document.getElementById('btnAdd').onclick = () => studentForm(null);
  document.getElementById('btnBatch').onclick = () => batchForm();
  // 批量删除：勾选 → 确认 → 逐个删（不需要密码）
  document.getElementById('btnStuDel').onclick = async () => {
    const ids = [...document.querySelectorAll('.stu-chk:checked')].map((c) => Number(c.value));
    if (!ids.length) return toast('先勾选要删除的学生（表格第一列）', 'err');
    const names = list.filter((s) => ids.includes(s.id)).map((s) => s.name);
    if (!await elConfirm({ title: '批量删除学生', message: `确定删除选中的 ${ids.length} 名学生？\n${names.slice(0, 10).join('、')}${names.length > 10 ? ` 等 ${names.length} 人` : ''}\n做题记录与错题会一并删除，不可恢复。`, okText: '删除', danger: true })) return;
    let ok = 0;
    for (const id of ids) {
      try { await api('/api/admin/students/' + id, { method: 'DELETE', silent: true }); ok++; } catch (e) { /* 单个失败继续删其余 */ }
    }
    toast(`已删除 ${ok} / ${ids.length} 名学生`, ok === ids.length ? 'ok' : 'err');
    render();
  };
  const stuAll = document.getElementById('stuAll');
  if (stuAll) stuAll.onchange = () => document.querySelectorAll('.stu-chk').forEach((c) => { c.checked = stuAll.checked; });
  document.querySelectorAll('[data-speed]').forEach((b) => b.onclick = async () => {
    const next = Number(b.dataset.cur) ? 0 : 1;
    const d = await api(`/api/admin/students/${b.dataset.speed}/speed`, { method: 'POST', body: { allow_speed: next } });
    b.dataset.cur = String(d.allow_speed);
    b.classList.toggle('on', !!d.allow_speed);
    b.parentElement.querySelector('span').textContent = d.allow_speed ? '允许' : '禁止';
    toast(d.allow_speed ? '已开启倍速播放' : '已禁止倍速播放', 'ok');
  });
  document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => studentForm(list.find((x) => x.id === Number(b.dataset.edit))));
  document.querySelectorAll('[data-pwd]').forEach((b) => b.onclick = async () => {
    const s = list.find((x) => x.id === Number(b.dataset.pwd));
    const pwd = await elPrompt({ title: '重置密码', message: `为【${s.name}】设置新密码（留空则重置为 123456）`, value: '123456' });
    if (pwd === null) return;
    const d = await api(`/api/admin/students/${s.id}/reset-password`, { method: 'POST', body: { password: pwd || '123456' } });
    toast(d.password ? `密码已重置为 ${d.password}` : '已重置', 'ok');
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    const s = list.find((x) => x.id === Number(b.dataset.del));
    if (!await elConfirm({ title: '删除学生', message: `确定删除学生【${s.name}】？做题记录与错题会一并删除，不可恢复。`, okText: '删除', danger: true })) return;
    await api('/api/admin/students/' + s.id, { method: 'DELETE' });
    toast('已删除', 'ok'); render();
  });
}

function studentForm(s) {
  modal({
    title: s ? '编辑学生' : '开通学生账号',
    body: `
      <div class="grid g2" style="gap:0 16px">
        <div class="field"><label>姓名 *</label><input class="input" id="fName" value="${esc(s ? s.name : '')}"></div>
        <div class="field"><label>登录账号 *（手机号 / 学号）</label><input class="input" id="fUser" value="${esc(s ? s.username : '')}"></div>
        ${s ? '' : `<div class="field"><label>初始密码（默认 123456）</label><input class="input" id="fPwd" value="123456"></div>`}
        <div class="field" style="grid-column:1/-1"><label>学段 *<span style="color:var(--text3);font-weight:400">（决定「专项提升 / 中考冲刺」能看到哪些课）</span></label>
          <select class="input" id="fStage">
            ${STAGE_OPTS.map(([v, t]) => `<option value="${v}" ${(s ? s.stage || '' : '') === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        <div style="display:flex;gap:16px;grid-column:1/-1">
          <div class="field" style="flex:1"><label>年级 *<span style="color:var(--text3);font-weight:400">（学生端按年级匹配课程）</span></label><select class="input" id="fGrade">${gradePick(s ? s.grade : '')}</select></div>
          <div class="field" style="flex:1"><label>册别<span style="color:var(--text3);font-weight:400">（只显示本册 + 通用的课程）</span></label>
            <select class="input" id="fTerm">
              ${[['上册', '上册'], ['下册', '下册']].map(([v, t]) => `<option value="${v}" ${(s ? s.term || '上册' : '上册') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
        </div>
        <div class="field"><label>到期时间 *<span style="color:var(--text3);font-weight:400">（必填，到期后无法登录）</span></label><input class="input" type="date" id="fExpire" value="${esc(s && s.expire_at ? String(s.expire_at).slice(0, 10) : '')}"></div>
        ${s ? `<div class="field" style="grid-column:1/-1"><label>状态</label><select class="input" id="fStatus"><option value="1" ${s.status ? 'selected' : ''}>正常</option><option value="0" ${!s.status ? 'selected' : ''}>停用</option></select></div>` : ''}
      </div>`,
    onMount: (w) => {
      mountElDate(w.querySelector('#fExpire'));
      // 学段只有 小学/初中 两项，且跟年级联动：选年级自动带出学段（进入弹窗时也先同步一次）
      const g = w.querySelector('#fGrade'), st = w.querySelector('#fStage');
      const syncStage = () => {
        if (/^[三四五六]年级$/.test(g.value)) st.value = 'primary';
        else if (/^[七八九]年级$|^中考冲刺$/.test(g.value)) st.value = 'junior';
      };
      if (g && st) { g.onchange = syncStage; syncStage(); }
    },
    onOk: async (w, err) => {
      const name = w.querySelector('#fName').value.trim();
      const username = w.querySelector('#fUser').value.trim();
      if (!name || !username) return err('姓名和账号必填');
      const grade = w.querySelector('#fGrade').value.trim();
      const stageSel = w.querySelector('#fStage');
      const stage = stageSel && stageSel.value;
      const term = w.querySelector('#fTerm').value;
      const expire = w.querySelector('#fExpire').value.trim();
      if (!grade) return err('请选择年级');
      if (!stage) return err('请选择学段（小学 / 初中）');
      const isPrimary = ['三年级', '四年级', '五年级', '六年级'].includes(grade);
      const isJunior = ['七年级', '八年级', '九年级', '中考冲刺'].includes(grade);
      if ((isPrimary && stage !== 'primary') || (isJunior && stage !== 'junior')) {
        return err(`${grade} 属于${isPrimary ? '小学' : '初中'}，与所选学段不一致`);
      }
      if (!expire) return err('请填写到期时间');
      if (s) {
        await api('/api/admin/students/' + s.id, { method: 'PUT', body: {
          name, username, grade, stage, term,
          level: s.level || 'basic', status: w.querySelector('#fStatus').value,
          expire_at: expire } });
        toast('保存成功', 'ok');
      } else {
        await api('/api/admin/students', { method: 'POST', body: {
          name, username, password: w.querySelector('#fPwd').value || '123456',
          grade, stage, term, expire_at: expire } });
        toast('学生账号创建成功', 'ok');
      }
      render();
    },
  });
}

function batchForm() {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  const defExp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  modal({
    title: '批量开通学生',
    wide: true,
    body: `
      <p style="color:var(--text2);margin-bottom:12px">每行一个学生，格式：<b>姓名,账号,密码,年级,到期时间,册别</b>。其中<b>年级和到期时间必填</b>，密码可省略（默认 123456），册别可省略（填 上册 / 下册；不填 = 上下册都显示）。<b>学段按年级自动识别</b>（三~六年级 = 小学，七~九年级 / 中考冲刺 = 初中），也可以额外写一列 小学 / 初中 手动指定。</p>
      <textarea class="input" id="bulk" style="height:220px;font-family:ui-monospace,Consolas,monospace" placeholder="张三,13800000001,123456,七年级,${defExp},上册
李四,13800000002,,七年级,${defExp},下册
王五,13800000003,,三年级,${defExp},小学"></textarea>
`,
    okText: '开始导入',
    onOk: async (w, err) => {
      const lines = w.querySelector('#bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return err('请输入至少一行');
      /* 手填日期可能是 2027-10-8 这类格式，服务端要求严格的 YYYY-MM-DD，这里统一补零 */
      const normExp = (s) => {
        const p = String(s || '').replace(/[\/.]/g, '-').split('-');
        return p.length === 3 ? [p[0], p[1].padStart(2, '0'), p[2].padStart(2, '0')].join('-') : String(s || '');
      };
      const list = lines.map((l) => {
        const parts = l.split(/[,，\t]/).map((s) => (s || '').trim());
        const [name, username, password] = parts;
        const rest = parts.slice(3).filter(Boolean);
        const expireRaw = rest.find((p) => /^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(p)) || '';
        const expire_at = normExp(expireRaw);
        const term = rest.find((p) => /^(上|下)(册)?$/.test(p)) || '';
        const stageTok = rest.find((p) => /^(小学|初中)$/.test(p)) || '';
        const stage = stageTok === '小学' ? 'primary' : stageTok === '初中' ? 'junior' : '';
        const grade = rest.find((p) => p !== expireRaw && p !== term && p !== stageTok) || '';
        return { name, username, password, grade, stage, term, expire_at };
      });
      const d2 = await api('/api/admin/students/batch', { method: 'POST', body: { list } });
      toast(`成功开通 ${d2.count} 个账号` + (d2.errs.length ? `，${d2.errs.length} 条跳过` : ''), 'ok');
      if (d2.errs.length) await elAlert({ title: '部分未导入', message: d2.errs.join('\n') });
      render();
    },
  });
}

// ------------------------------------------------------------ 课程目录（章节）
async function viewChapters() {
  await loadMeta(); // ADM.chapters 保持全量（供各处级联选择使用）
  const p = ADM.page;
  const subject = p.chSubject || '', dim = p.chDim || '', category = p.chCategory || '';
  const term = p.chTerm || '';
  const byStage = catByStage(category);   // 选了专项 / 中考 → ② 是学段，其余是年级
  const qs = [`subject=${encodeURIComponent(subject)}`, `category=${encodeURIComponent(category)}`, `term=${encodeURIComponent(term)}`,
    byStage ? `stage=${encodeURIComponent(dim)}` : `grade=${encodeURIComponent(dim)}`].join('&');
  const list = await api('/api/admin/chapters?' + qs);
  const catOpts = (sel) => [''].concat((subject && CATEGORY_MAP[subject]) || []).map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${c || '全部分类'}</option>`).join('');
  const termOpts = (sel) => [['', '全部册别'], ['上册', '上册'], ['下册', '下册'], ['none', '通用（不分册）']]
    .map(([v, t]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${t}</option>`).join('');
  // 一级 = 学科，二级 = 课程分类，三级 = 年级 / 学段，四级 = 册别（仅同步类），五级 = 章节目录
  const bySubject = new Map();
  for (const c of list) {
    const s = c.subject || '未分类';
    if (!bySubject.has(s)) bySubject.set(s, new Map());
    const byCat = bySubject.get(s);
    const k = c.category || '未分类';
    if (!byCat.has(k)) byCat.set(k, new Map());
    const byDim = byCat.get(k);
    const g = catByStage(k) ? chHead(c) : (c.grade || '通用');
    if (!byDim.has(g)) byDim.set(g, new Map());
    const byTerm = byDim.get(g);
    const tm = catByStage(k) ? '通用' : (c.term || '通用');
    if (!byTerm.has(tm)) byTerm.set(tm, []);
    byTerm.get(tm).push(c);
  }
  const rowHTML = (c) => `<tr>
      <td><b>${esc(c.name)}</b>${catByStage(c.category || '') ? ` <span class="tag" style="background:#eef4ff;color:#2f6bff">${esc(chHead(c))}</span>`
    : (c.term ? ` <span class="tag">${esc(c.term)}</span>` : ' <span class="tag gray">通用</span>')}</td>
      <td style="width:180px">${esc(c.book || '—')}</td>
      <td style="width:150px">知识点 ${c.video_count} · 讲义 ${c.handout_count} · 习题 ${c.exercise_count}</td>
      <td style="width:130px"><div class="acts"><button class="link-btn" data-edit="${c.id}">编辑</button><button class="link-btn danger" data-del="${c.id}">删除</button></div></td>
    </tr>`;
  // 章节下的「分级目录」：可选；设了学生端就会折叠成一层，点击才展开
  const secRowHTML = (c) => {
    const secs = sectionsOf(c.id);
    return `<tr class="sec-tr"><td colspan="8">
      <div class="sec-bar">
        <span class="sec-lbl">分级目录</span>
        ${secs.length
          ? secs.map((s) => `<span class="sec-chip">${esc(s.name)}<i>视频 ${s.video_count} · 资料 ${s.handout_count}</i>
              <button class="link-btn" data-sec-edit="${s.id}">改名</button>
              <button class="link-btn danger" data-sec-del="${s.id}">删除</button></span>`).join('')
          : '<span class="sec-none">未设置 → 学生端直接平铺展示知识点</span>'}
        <button class="btn ghost sm" data-sec-add="${c.id}">+ 分级目录</button>
      </div></td></tr>`;
  };
  const groupedHTML = [...bySubject.entries()].map(([sub, byCat]) => `
    <div class="grp">
      <div class="grp-h"><span class="grp-ic">${ic(({ '数学': 'math', '英语': 'english', '物理': 'physics', '化学': 'chemistry' })[sub] || 'book')}</span>
        <b>${esc(sub)}</b><span class="tag gray">${[...byCat.values()].reduce((n, x) => n + [...x.values()].reduce((m, y) => m + [...y.values()].reduce((a, arr) => a + arr.length, 0), 0), 0)} 个章节</span></div>
      ${[...byCat.entries()].map(([cat, byDim]) => `
        <div class="grp-sub"><span class="grp-cat">${esc(cat)}</span><span class="grp-line"></span></div>
        ${[...byDim.entries()].map(([gname, byTerm]) => {
    const nAll = [...byTerm.values()].reduce((n, x) => n + x.length, 0);
    return `
          <div class="grp-grade"><span>${esc(gname)}</span><i>${nAll} 个章节</i></div>
          ${catByStage(cat)
        ? `<table><thead><tr><th>章节名称</th><th style="width:180px">二级名称</th><th style="width:150px">内容统计</th><th style="width:130px">操作</th></tr></thead>
             <tbody>${(byTerm.get('通用') || []).map((c) => rowHTML(c) + secRowHTML(c)).join('')}</tbody></table>`
        : [['上册', '上册'], ['下册', '下册'], ['通用', '通用 · 上下册都能看']].map(([key, label]) => {
          const chs = byTerm.get(key) || [];
          if (!chs.length) return '';
          return `
            <div class="grp-term"><span>${esc(label)}</span><i>${chs.length} 个章节</i></div>
            <table><thead><tr><th>章节名称</th><th style="width:180px">二级名称</th><th style="width:150px">内容统计</th><th style="width:130px">操作</th></tr></thead>
            <tbody>${chs.map((c) => rowHTML(c) + secRowHTML(c)).join('')}</tbody></table>`;
        }).join('')}`;
  }).join('')}`).join('')}
    </div>`).join('');
  return {
    html: `<div class="card">
      <div class="card-h"><h3>${ic('list')} 课程目录 <span class="tag gray">${list.length}</span></h3><button class="btn primary-sm" id="add">${ic('plus')} 新增章节</button></div>
      <div class="toolbar">
        <select id="chSubject" style="min-width:120px">${subjectOptions2(subject, '全部学科')}</select>
        <select id="chCategory" style="min-width:120px">${catOpts(category)}</select>
        <select id="chDim" style="min-width:120px">${dimOpts(category, dim, byStage ? '全部学段' : '全部年级')}</select>
        <select id="chTerm" style="min-width:120px">${termOpts(term)}</select>
        <button class="btn ghost" id="chSearch">查询</button>
        <button class="btn ghost" id="chReset">重置</button>
      </div>
      ${(() => {
        const pg = pageOf(list, 'chPage', 10);
        const rows = pg.list;
        if (!rows.length) return '<div class="empty">暂无章节</div>';
        return `<div style="overflow-x:auto"><table><thead><tr>
          <th>学科</th><th>分类</th><th>年级 / 学段</th><th>册别</th><th>章节名称</th><th>二级名称</th><th>内容</th><th>操作</th>
        </tr></thead><tbody>${rows.map((c) => `<tr>
          <td>${esc(c.subject || '—')}</td>
          <td>${esc(c.category || '—')}</td>
          <td>${esc(chHead(c))}</td>
          <td>${c.term ? esc(c.term) : '<span class="tag gray">通用</span>'}</td>
          <td><b>${esc(c.name)}</b></td>
          <td>${esc(c.book || '—')}</td>
          <td style="white-space:nowrap">知识点 ${c.video_count} · 讲义 ${c.handout_count} · 习题 ${c.exercise_count}</td>
          <td><div class="acts">
            <button class="link-btn" data-edit="${c.id}">编辑</button>
            <button class="link-btn" data-sec-add="${c.id}">分级</button>
            <button class="link-btn danger" data-del="${c.id}">删除</button>
          </div></td>
        </tr>${secRowHTML(c)}`).join('')}</tbody></table></div>${pagerHTML(pg.page, pg.size, pg.total, 'chPage')}`;
      })()}
    </div>`,
    after: () => {
      bindPager('chPage');
      document.getElementById('chSearch').onclick = () => {
        Object.assign(ADM.page, {
          chSubject: document.getElementById('chSubject').value,
          chDim: document.getElementById('chDim').value,
          chTerm: document.getElementById('chTerm').value,
          chCategory: document.getElementById('chCategory').value,
          chPage: 1,
        });
        render();
      };
      document.getElementById('chReset').onclick = () => { Object.assign(ADM.page, { chSubject: '', chDim: '', chTerm: '', chCategory: '', chPage: 1 }); render(); };
      const chSub = document.getElementById('chSubject'), chCat = document.getElementById('chCategory'), chDimSel = document.getElementById('chDim');
      chSub.onchange = () => {
        ADM.page.chSubject = chSub.value;
        ADM.page.chCategory = '';
        ADM.page.chDim = '';
        chCat.innerHTML = [''].concat((ADM.page.chSubject && CATEGORY_MAP[ADM.page.chSubject]) || []).map((c) => `<option value="${c}">${c || '全部分类'}</option>`).join('');
        chDimSel.innerHTML = dimOpts('', '', '全部年级');
        chDimSel.value = '';
      };
      // 分类变了 → 第 ③ 级在「年级 / 学段」之间切换
      chCat.onchange = () => {
        const cat = chCat.value;
        chDimSel.innerHTML = dimOpts(cat, '', catByStage(cat) ? '全部学段' : '全部年级');
        chDimSel.value = '';
      };
      document.getElementById('add').onclick = () => chapterForm(null);
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => chapterForm(list.find((x) => x.id === Number(b.dataset.edit))));
      // 分级目录（章节下的可选第四级）
      document.querySelectorAll('[data-sec-add]').forEach((b) => b.onclick = () => {
        sectionForm(list.find((x) => x.id === Number(b.dataset.secAdd)), null);
      });
      document.querySelectorAll('[data-sec-edit]').forEach((b) => b.onclick = () => {
        const s = (ADM.sections || []).find((x) => x.id === Number(b.dataset.secEdit));
        sectionForm(list.find((x) => x.id === Number(s && s.chapter_id)), s);
      });
      document.querySelectorAll('[data-sec-del]').forEach((b) => b.onclick = async () => {
        if (!await elConfirm({ title: '删除分级目录', message: '删除该分级目录？里面的视频与资料不会删除，只会变成「不分组」。', okText: '删除', danger: true })) return;
        await api('/api/admin/sections/' + b.dataset.secDel, { method: 'DELETE' }); toast('已删除', 'ok'); render();
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!await elConfirm({ title: '删除章节', message: '删除后，该目录下的分级目录会一并删除，讲义/视频将变为「未分类」（文件保留）。确定删除？', okText: '删除', danger: true })) return;
        await api('/api/admin/chapters/' + b.dataset.del, { method: 'DELETE' }); toast('已删除', 'ok'); render();
      });
    },
  };
}
function chapterForm(c) {
  const curSub = c ? c.subject : '数学';
  const curCat = (c && c.category) || (CATEGORY_MAP[curSub] || [])[0] || '同步基础';
  const byStage = catByStage(curCat);
  const curStage = (c && c.stage) || (curCat === '中考冲刺' ? 'junior' : '');
  // 学段下拉：首项是「请选择学段」占位，避免新增/编辑时默认落到「小学」把旧数据静默改掉
  const stageSelHTML = (sel) => `<option value="" ${sel ? '' : 'selected'}>请选择学段</option>`
    + STAGE_OPTS.map(([v, t]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${t}</option>`).join('');
  modal({
    title: c ? '编辑章节' : '新增章节（课程目录）',
    body: `
      <div class="field"><label>① 学科 *</label><select class="input" id="kSubject">${SUBJECTS.map((s) => `<option value="${s}" ${curSub === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>② 课程分类 *</label><select class="input" id="kCategory">${(CATEGORY_MAP[curSub] || []).map((k) => `<option value="${k}" ${curCat === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="field" id="kStageWrap" style="${byStage ? '' : 'display:none'}"><label>③ 学段 *<span style="color:var(--text3);font-weight:400">（专项提升 / 中考冲刺 只按学段分发，不看年级和上下册）</span></label>
        <select class="input" id="kStage" ${curCat === '中考冲刺' ? 'disabled' : ''}>${stageSelHTML(curStage)}</select></div>
      <div class="field" id="kGradeWrap" style="${byStage ? 'display:none' : ''}"><label>③ 年级</label><select class="input" id="kGrade">${gradeOptions(c ? c.grade : '')}</select></div>
      <div class="field" id="kTermWrap" style="${byStage ? 'display:none' : ''}"><label>④ 册别<span style="color:var(--text3);font-weight:400">（学生只看到自己那一册 + 通用的章节及其视频、讲义）</span></label>
        <select class="input" id="kTerm">
          ${[['', '通用（上下册都显示）'], ['上册', '上册'], ['下册', '下册']].map(([v, t]) => `<option value="${v}" ${(c ? c.term || '' : '') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>章节名称 *（自己创建，如：第一章 有理数）</label><input class="input" id="kName" value="${esc(c ? c.name : '')}" placeholder="输入章节名称，学生端会按这个名字显示课程卡片"></div>
      <div class="field"><label>二级名称（可选，显示在学生端章节卡片的副标题位置）</label><input class="input" id="kBook" value="${esc(c ? c.book : '')}" placeholder="如：苏科版·七年级上册 / 小升初衔接"></div>
      <div class="field"><label>排序（越小越靠前，可不填）</label><input class="input" type="number" id="kSort" value="${c ? c.sort : 0}"></div>
      <p style="color:var(--text3);font-size:12px" id="kTip"></p>`,
    onMount: (w) => {
      const sub = w.querySelector('#kSubject'), cat = w.querySelector('#kCategory');
      const stageWrap = w.querySelector('#kStageWrap'), gradeWrap = w.querySelector('#kGradeWrap'), termWrap = w.querySelector('#kTermWrap');
      const stageSel = w.querySelector('#kStage'), tip = w.querySelector('#kTip');
      const sync = () => {
        const by = catByStage(cat.value);
        const exam = cat.value === '中考冲刺';
        stageWrap.style.display = by ? '' : 'none';
        gradeWrap.style.display = by ? 'none' : '';
        termWrap.style.display = by ? 'none' : '';
        stageSel.disabled = exam;
        if (exam) stageSel.value = 'junior';
        tip.innerHTML = by
          ? ' <b>专项提升 / 中考冲刺</b>：学生端按<b>学段</b>显示 —— 小学账号看全部小学专项，初中账号看全部初中专项 + 全部中考冲刺课程，<b>不看年级也不分上下册</b>。接着去「视频管理」上传视频（每个视频 = 一个知识点），再在「讲义资料」里配讲义 / 传习题。'
          : ' <b>同步类</b>：学生端只显示与自己<b>年级、册别</b>一致的章节（册别选「通用」则上下册都能看到）。接着去「视频管理」上传视频（每个视频 = 一个知识点），再在「讲义资料」里配讲义 / 传习题。';
      };
      sub.onchange = () => {
        cat.innerHTML = (CATEGORY_MAP[sub.value] || []).map((k) => `<option value="${k}">${k}</option>`).join('');
        sync();
      };
      cat.onchange = sync;
      sync();
    },
    onOk: async (w, err) => {
      const category = w.querySelector('#kCategory').value;
      const byStage = catByStage(category);
      const stage = byStage ? (category === '中考冲刺' ? 'junior' : w.querySelector('#kStage').value) : '';
      const body = {
        subject: w.querySelector('#kSubject').value,
        grade: byStage ? '' : w.querySelector('#kGrade').value,
        term: byStage ? '' : w.querySelector('#kTerm').value,
        category,
        stage,
        name: w.querySelector('#kName').value.trim(),
        book: w.querySelector('#kBook').value.trim(),
        code: c ? c.code : '',
        sort: Number(w.querySelector('#kSort').value) || 0,
      };
      if (!body.name) return err('请填写章节名称');
      if (byStage && !body.stage) return err('请选择学段（小学 / 初中）');
      if (c) await api('/api/admin/chapters/' + c.id, { method: 'PUT', body });
      else await api('/api/admin/chapters', { method: 'POST', body });
      toast('章节已保存', 'ok'); render();
    },
  });
}


/** 新增 / 改名「分级目录」（章节下的可选第四级，学生端会折叠成一层） */
function sectionForm(chapter, sec) {
  if (!chapter) return toast('章节不存在，请刷新后重试');
  modal({
    title: sec ? '编辑分级目录' : '新增分级目录',
    body: `
      <div class="field"><label>所属章节</label>
        <input class="input" value="${esc([chapter.subject, chapter.category, chHead(chapter), chapter.name].filter(Boolean).join(' · '))}" disabled></div>
      <div class="field"><label>分级目录名称 *</label>
        <input class="input" id="sName" value="${esc(sec ? sec.name : '')}" placeholder="如：1.1 正数与负数"></div>
      <div class="field"><label>排序（越小越靠前，可不填）</label>
        <input class="input" type="number" id="sSort" value="${sec ? sec.sort : 0}"></div>
      <p style="color:var(--text3);font-size:12px">
        添加后，去「视频管理 / 讲义资料」把内容归到这个分级目录下；学生端课程详情里就会显示为一个可折叠的分组，<b>点击标题才展开</b>。<br>
        不设置分级目录时，学生端仍按原来的方式平铺展示该章节的所有知识点。
      </p>`,
    okText: '保存',
    onOk: async (w, err) => {
      const name = w.querySelector('#sName').value.trim();
      if (!name) return err('请填写分级目录名称');
      const sort = Number(w.querySelector('#sSort').value) || 0;
      if (sec) await api('/api/admin/sections/' + sec.id, { method: 'PUT', body: { name, sort } });
      else await api('/api/admin/sections', { method: 'POST', body: { chapter_id: chapter.id, name, sort } });
      toast('已保存', 'ok'); render();
    },
  });
}


// ------------------------------------------------------------ 讲义 / 习题
async function viewHandouts() {
  await loadMeta();
  const kw = ADM.page.hKw || '', kind = ADM.page.hKind || '';
  const all = await api(`/api/admin/handouts?kw=${encodeURIComponent(kw)}&kind=${kind}`);
  const st = ADM.page.hf = ADM.page.hf || { subject: '', category: '', chapter: '', section: '' };
  const filtered = filterByChapterState(st, all);
  const pg = pageOf(filtered, 'hfPage', 10);
  const list = pg.list;
  const kindTag = (k) => (k === 'exercise'
    ? '<span class="tag warn">习题库</span>'
    : '<span class="tag">视频讲义</span>');
  return {
    html: `<div class="card">
      <div class="card-h"><h3>${ic('book')} 讲义资料 <span class="tag gray">${pg.total}</span></h3>
        <div style="display:flex;gap:10px">
          <button class="btn ghost" id="hBatchDel" style="display:none">批量删除（<span id="hDelN">0</span>）</button>
          <button class="btn primary-sm" id="btnUp">${ic('upload')} 上传资料</button>
        </div></div>
      <div class="toolbar">
        ${chapterFilterHTML('hf')}
        <select id="hKind" style="min-width:130px">
          <option value="">全部资料</option>
          <option value="handout" ${kind === 'handout' ? 'selected' : ''}>视频讲义</option>
          <option value="exercise" ${kind === 'exercise' ? 'selected' : ''}>习题库</option>
        </select>
        <input class="input" id="hKw" placeholder="搜索标题" value="${esc(kw)}">
        <button class="btn ghost" id="hSearch">查询</button>
        <button class="btn ghost" id="hReset">重置</button>
      </div>
      ${list.length ? `<div style="overflow-x:auto"><table><thead><tr><th style="width:34px"><input type="checkbox" id="hChkAll"></th><th>标题</th><th>去向</th><th>所属章节</th><th>分级目录</th><th>关联知识点</th><th>大小</th><th>下载</th><th>上传时间</th><th>操作</th></tr></thead>
        <tbody>${list.map((h) => `<tr>
          <td><input type="checkbox" class="hChk" data-id="${h.id}"></td>
          <td><b>${esc(h.title)}</b><div style="font-size:12px;color:var(--text3)">${esc(h.file_name)}</div></td>
          <td>${kindTag(h.kind)}</td>
          <td>${esc(h.chapter_name || '未分类')}</td>
          <td>${h.section_name ? esc(h.section_name) : '<span style="color:var(--text3)">不分组</span>'}</td>
          <td>${esc(h.video_title || '—')}</td>
          <td>${fmtSize(h.size)}</td>
          <td>${h.download_count}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((h.created_at || '').slice(0, 16))}</td>
          <td><div class="acts">
            <button class="link-btn" data-edit="${h.id}">修改</button>
            <button class="link-btn" data-dl="${h.id}">下载</button>
            <button class="link-btn danger" data-del="${h.id}">删除</button></div></td>
        </tr>`).join('')}</tbody></table></div>
        ${pagerHTML(pg.page, pg.size, pg.total, 'hfPage')}`
      : '<div class="empty">暂无资料</div>'}
    </div>`,
    after: () => {
      bindPager('hfPage');
      const apply = () => { ADM.page.hKind = document.getElementById('hKind').value; ADM.page.hKw = document.getElementById('hKw').value; ADM.page.hfPage = 1; render(); };
      bindChapterFilter(document, 'hf', () => { ADM.page.hfPage = 1; render(); });
      document.getElementById('hSearch').onclick = apply;
      document.getElementById('hKind').onchange = apply;
      document.getElementById('hReset').onclick = () => { Object.assign(ADM.page, { hf: { subject: '', grade: '', category: '', chapter: '', section: '' }, hKind: '', hKw: '', hfPage: 1 }); render(); };
      document.getElementById('btnUp').onclick = handoutForm;
      document.querySelectorAll('[data-dl]').forEach((b) => b.onclick = () => {
        const h = list.find((x) => x.id === Number(b.dataset.dl));
        downloadUrl(h.file_path, h.file_name);
      });
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
        editHandoutForm(list.find((x) => x.id === Number(b.dataset.edit)));
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const h = list.find((x) => x.id === Number(b.dataset.del));
        if (!await elConfirm({ title: '删除资料', message: `确定删除资料【${h.title}】？文件也会被删除。`, okText: '删除', danger: true })) return;
        askPwd('删除讲义资料', `将删除「${h.title}」，删除后不可恢复。`, async (pwd, err) => {
          await api('/api/admin/handouts/' + h.id, { method: 'DELETE', body: { pwd } });
          toast('已删除', 'ok'); render();
        });
      });
      // 批量删除：勾选 → 输删除密码 → 一次删掉
      const syncSel = () => {
        const n = document.querySelectorAll('.hChk:checked').length;
        const btn = document.getElementById('hBatchDel');
        btn.style.display = n ? '' : 'none';
        document.getElementById('hDelN').textContent = n;
        const all = document.getElementById('hChkAll');
        if (all) all.checked = n === list.length;
      };
      document.querySelectorAll('.hChk').forEach((c) => c.onchange = syncSel);
      const allChk = document.getElementById('hChkAll');
      if (allChk) allChk.onchange = () => {
        document.querySelectorAll('.hChk').forEach((c) => { c.checked = allChk.checked; });
        syncSel();
      };
      document.getElementById('hBatchDel').onclick = async () => {
        const ids = [...document.querySelectorAll('.hChk:checked')].map((c) => Number(c.dataset.id));
        if (!ids.length) return toast('请先勾选要删除的资料', 'err');
        if (!await elConfirm({ title: '批量删除', message: `确定批量删除选中的 ${ids.length} 份资料？文件也会被删除，不可恢复。`, okText: '删除', danger: true })) return;
        askPwd('批量删除讲义资料', `将删除选中的 ${ids.length} 份资料，删除后不可恢复。`, async (pwd, err) => {
          const r = await api('/api/admin/handouts/batch', { method: 'DELETE', body: { ids, pwd } });
          toast(r.msg || '已删除', 'ok'); render();
        });
      };
    },
  };
}

/**
 * 关联知识点选择器：列出该章节已上传的视频（与视频管理模块同步），单选勾选。
 * box 为容器 div；chapterId 为空显示提示；selected 用于回显。
 */
async function fillVideoPicker(box, chapterId, selected) {
  if (!chapterId) { box.innerHTML = '<div class="vpick-empty">请先在上方选好 课程章节</div>'; return; }
  box.innerHTML = '<div class="vpick-empty">正在加载该章节的视频…</div>';
  const vs = await api('/api/admin/videos?chapter_id=' + encodeURIComponent(chapterId)).catch(() => []);
  if (!vs.length) {
    box.innerHTML = '<div class="vpick-empty">暂无视频</div>';
    return;
  }
  box.innerHTML = `<label class="vpick-item"><input type="radio" name="${box.id}-pick" value="" ${!selected ? 'checked' : ''}>
      <span>不关联（进入本章习题库）</span></label>`
    + vs.map((v) => `<label class="vpick-item"><input type="radio" name="${box.id}-pick" value="${v.id}" ${Number(selected) === v.id ? 'checked' : ''}>
      <span>${esc(v.title)}</span><i>${v.url ? '外链' : '本地'}</i></label>`).join('');
}
const pickVideoId = (box) => { const r = box.querySelector('input[type=radio]:checked'); return r ? r.value : ''; };

/** 上传讲义 / 习题：可一次选多个文件，每个文件各自选择要关联的视频，一键上传 */
function handoutForm() {
  let root = null;
  let curChapter = '';
  let videos = [];
  let hasHandout = new Set();
  let items = [];
  const NONE = 'none';

  const norm = (name) => String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*第?\s*[0-9一二三四五六七八九十]+\s*[讲课节章.、．\-_)）]*\s*/, '')
    .replace(/[\s\u3000.、．,，:：;；()（）\[\]【】_\-]+/g, '')
    .toLowerCase();
  const lcs = (a, b) => {
    let best = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) best = prev[j];
        diag = tmp;
      }
    }
    return best;
  };
  const taken = (except) => new Set(items
    .filter((x, k) => k !== except && x.video && x.video !== NONE)
    .map((x) => String(x.video)));

  const autoMatch = () => {
    items.forEach((it, i) => {
      if (it.video || !videos.length) return;
      const used = taken(i);
      const a = norm(it.file.name);
      let best = null;
      let bestLen = 0;
      videos.forEach((v) => {
        if (used.has(String(v.id))) return;
        const len = lcs(a, norm(v.title));
        if (len > bestLen) { bestLen = len; best = v; }
      });
      if (!best) return;
      const base = Math.max(1, Math.min(a.length, norm(best.title).length));
      if (bestLen >= 3 && bestLen / base >= 0.6) it.video = String(best.id);
    });
  };
  const matchByOrder = () => {
    const used = taken(-1);
    const free = videos.filter((v) => !used.has(String(v.id)));
    items.forEach((it) => { if (!it.video && free.length) it.video = String(free.shift().id); });
  };

  const renderRows = () => {
    if (!root) return;
    const box = root.querySelector('#hRows');
    const sum = root.querySelector('#hSum');
    const chosen = items.filter((x) => x.video).length;
    sum.textContent = items.length ? '已选 ' + items.length + ' 个文件，已对应 ' + chosen + ' 个' : '';
    if (!items.length) {
      box.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:6px 0">还没有选择文件</div>';
      return;
    }
    box.innerHTML = items.map((it, i) => {
      const used = taken(i);
      const opts = [
        '<option value="">' + (curChapter ? '请选择关联的视频…' : '请先在上方选好课程章节') + '</option>',
        '<option value="' + NONE + '"' + (it.video === NONE ? ' selected' : '') + '>不关联（进入本章习题库）</option>',
      ].concat(videos.map((v) => {
        const dis = used.has(String(v.id));
        const label = v.title + (v.section_name ? ' · ' + v.section_name : '')
          + (hasHandout.has(Number(v.id)) ? '（已有讲义）' : '') + (dis ? '（已被选）' : '');
        return '<option value="' + v.id + '"' + (String(it.video) === String(v.id) ? ' selected' : '')
          + (dis ? ' disabled' : '') + '>' + esc(label) + '</option>';
      })).join('');
      const bad = it.status === 'fail'
        ? '<span style="color:#F56C6C;font-size:12px;white-space:nowrap" title="' + esc(it.msg || '') + '">失败</span>' : '';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed #e5e7eb">'
        + '<span style="flex:1 1 40%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.file.name) + '">' + esc(it.file.name) + '</span>'
        + '<select class="input" data-i="' + i + '" style="flex:1 1 50%;min-width:0"' + (curChapter ? '' : ' disabled') + '>' + opts + '</select>'
        + bad
        + '<button type="button" class="link-btn danger" data-x="' + i + '">移除</button></div>';
    }).join('');
    box.querySelectorAll('select[data-i]').forEach((s) => {
      s.onchange = () => { items[Number(s.dataset.i)].video = s.value; renderRows(); };
    });
    box.querySelectorAll('[data-x]').forEach((b) => {
      b.onclick = () => { items.splice(Number(b.dataset.x), 1); renderRows(); };
    });
  };

  const addFiles = (fl) => {
    [...fl].forEach((f) => {
      if (!items.some((x) => x.file.name === f.name && x.file.size === f.size)) {
        items.push({ file: f, video: '', status: '', msg: '' });
      }
    });
    items.sort((a, b) => a.file.name.localeCompare(b.file.name, 'zh-Hans-CN', { numeric: true }));
    autoMatch();
    renderRows();
  };

  const loadVideos = async (chapterId) => {
    curChapter = chapterId || '';
    videos = [];
    hasHandout = new Set();
    items.forEach((it) => { it.video = ''; });
    if (chapterId) {
      try {
        const [vs, hs] = await Promise.all([
          api('/api/admin/videos?chapter_id=' + encodeURIComponent(chapterId)),
          api('/api/admin/handouts?kind=handout&chapter_id=' + encodeURIComponent(chapterId)),
        ]);
        videos = vs || [];
        hasHandout = new Set((hs || []).map((h) => Number(h.video_id)).filter(Boolean));
      } catch (e) { /* api 已经提示 */ }
    }
    autoMatch();
    renderRows();
  };

  modal({
    title: '上传讲义 / 习题',
    wide: true,
    body: `${chapterCascadeHTML('hu', null)}
      <div class="field"><label>选择文件 *（可一次选多个：PDF / Word / PPT / 图片 / 网页 / TXT）</label>
        <div id="hDrop" style="border:1px dashed #c9cdd4;border-radius:8px;padding:22px 12px;text-align:center;color:var(--text3);cursor:pointer">将文件拖到此处，或<span style="color:#2f6bff">点击选择（可多选）</span></div>
        <input type="file" id="hFile" multiple hidden></div>
      <div class="field"><label>文件与关联视频<span id="hSum" style="color:var(--text3);font-weight:400;margin-left:10px"></span></label>
        <div style="margin-bottom:6px"><button type="button" class="btn ghost sm" id="hByOrder">按文件名顺序依次对应视频</button></div>
        <div id="hRows"></div>
        <p style="color:var(--text3);font-size:12px;margin-top:6px">
          <b>选了视频</b> → 学生端把这份资料作为该知识点的讲义；<b>选「不关联」</b> → 进入学生端「本章习题库」。<br>
          同一批里一个视频只能被一个文件选中；标「已有讲义」只是提醒，仍可选择。
        </p></div>
      <div class="field"><label>标题（只上传一个文件时可填；留空或一次上传多个文件时，每个文件都用各自的文件名）</label>
        <input class="input" id="hTitle" placeholder="如 第1讲 有理数的概念 讲义"></div>
      <p style="color:var(--text3);font-size:12px">单个文件建议不超过 200MB。多个文件会依次上传，上传过程中请不要关闭页面。</p>`,
    okText: '上传',
    onMount: (w) => {
      root = w;
      bindChapterCascade(w, 'hu', (chapterId) => loadVideos(chapterId));
      const input = w.querySelector('#hFile');
      const drop = w.querySelector('#hDrop');
      drop.onclick = () => input.click();
      input.onchange = () => { addFiles(input.files); input.value = ''; };
      drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = '#2f6bff'; };
      drop.ondragleave = () => { drop.style.borderColor = '#c9cdd4'; };
      drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = '#c9cdd4'; addFiles(e.dataTransfer.files); };
      w.querySelector('#hByOrder').onclick = () => { matchByOrder(); renderRows(); };
      renderRows();
    },
    onOk: async (w, err) => {
      const chapterId = cascadeChapterId(w, 'hu');
      if (!chapterId) return err('请依次选择 学科 → 年级/学段 → 课程分类 → 课程章节');
      if (!items.length) return err('请选择要上传的文件');
      if (items.some((it) => !it.video)) return err('请为每个文件选择关联的视频；不关联请选「不关联（进入本章习题库）」');
      const btn = w.querySelector('#mOk');
      const secId = String(cascadeSectionId(w, 'hu') || '');
      const title1 = items.length === 1 ? w.querySelector('#hTitle').value.trim() : '';
      const todo = items.slice();
      let okN = 0;
      const bad = [];
      for (let k = 0; k < todo.length; k++) {
        const it = todo[k];
        it.status = '';
        btn.innerHTML = '<span class="spinner"></span> 上传中 ' + (k + 1) + '/' + todo.length;
        const fd = new FormData();
        fd.append('file', it.file);
        fd.append('title', title1);
        fd.append('chapter_id', chapterId);
        fd.append('section_id', it.video === NONE ? secId : '');
        fd.append('video_id', it.video === NONE ? '' : it.video);
        fd.append('level', 'basic');
        try {
          const res = await fetch('/api/admin/handouts', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const json = await res.json();
          if (json.code !== 0) throw new Error(json.msg || '上传失败');
          it.status = 'ok';
          okN++;
        } catch (e) {
          it.status = 'fail';
          it.msg = (e && e.message) || '上传失败';
          bad.push(it.file.name + '：' + it.msg);
        }
      }
      items = items.filter((x) => x.status !== 'ok');
      if (okN) render();
      if (bad.length) {
        btn.textContent = '上传';
        renderRows();
        return err('成功 ' + okN + ' 个，失败 ' + bad.length + ' 个（失败的已留在列表里，可直接重试）：' + bad.slice(0, 3).join('；'));
      }
      toast('已上传 ' + okN + ' 个文件', 'ok');
    },
  });
}

/** 修改资料：标题、归属、关联知识点，也可以换文件 */
function editHandoutForm(h) {
  const ch = ADM.chapters.find((c) => c.id === Number(h.chapter_id)) || null;
  modal({
    title: '修改资料',
    wide: true,
    body: `${chapterCascadeHTML('lk', ch, h.section_id)}
      <div class="field"><label>标题 *</label><input class="input" id="lTitle" value="${esc(h.title)}"></div>
      <div class="field"><label>关联知识点（勾选该章节已上传的视频，可不勾）</label>
        <div class="vpick" id="lVideoList"><div class="vpick-empty">加载中…</div></div>
        <p style="color:var(--text3);font-size:12px;margin-top:6px">勾选某个视频后，这份资料就是该知识点的讲义；不勾选则放进本章习题库。</p></div>
      <div class="field"><label>更换文件（不选则保留原来的，点文件名后面的叉号再保存即去掉）</label>
        <div id="lFileBox"></div>
        <input type="file" id="lFile" hidden></div>`,
    okText: '保存',
    onMount: async (w) => {
      bindChapterCascade(w, 'lk', (chapterId) => fillVideoPicker(w.querySelector('#lVideoList'), chapterId, h.video_id));
      await fillVideoPicker(w.querySelector('#lVideoList'), cascadeChapterId(w, 'lk'), h.video_id);
      mountElUpload(w.querySelector('#lFileBox'), w.querySelector('#lFile'), {
        list: true,
        existingName: h.file_name || '',
        tip: '选取后文件名会留在下面，点叉号可去掉',
      });
    },
    onOk: async (w, err) => {
      const chapterId = cascadeChapterId(w, 'lk');
      const title = w.querySelector('#lTitle').value.trim();
      if (!chapterId) return err('请依次选择 学科 → 年级/学段 → 课程分类 → 课程章节');
      if (!title) return err('标题不能为空');
      const file = w.querySelector('#lFile').files[0];
      const fd = new FormData();
      fd.append('title', title);
      fd.append('chapter_id', chapterId);
      fd.append('section_id', cascadeSectionId(w, 'lk') || '');
      fd.append('video_id', pickVideoId(w.querySelector('#lVideoList')) || '');
      if (file) fd.append('file', file);
      else if (w.querySelector('#lFile').dataset.clear === '1') fd.append('clear_file', '1');
      const btn = w.querySelector('#mOk');
      btn.innerHTML = '<span class="spinner"></span> 保存中';
      const res = await fetch('/api/admin/handouts/' + h.id, { method: 'PUT', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
      const json = await res.json().catch(() => ({ code: 1, msg: '保存失败' }));
      if (json.code !== 0) { btn.textContent = '保存'; return err(json.msg || '保存失败'); }
      toast('已保存', 'ok');
      render();
    },
  });
}

/** 编辑里展示的已有视频名：文件名留在上传列表里，点叉号可去掉 */
function storedVideoName(v) {
  if (v.file_path) {
    const ext = (String(v.file_path).split('.').pop() || 'mp4').toLowerCase();
    const base = String(v.title || '视频').replace(/\.[a-z0-9]+$/i, '');
    return base + '.' + ext;
  }
  return v.url ? '外链视频' : '';
}

/** 编辑视频：改标题、章节和分级目录，也可以换一个视频文件。没有文件也能保存。 */
function renameForm(v) {
  const ch = ADM.chapters.find((c) => c.id === Number(v.chapter_id)) || null;
  modal({
    title: '编辑视频',
    wide: true,
    body: `${chapterCascadeHTML('ev', ch, v.section_id)}
      <div class="field"><label>视频标题（学生端「知识点」名称）*</label><input class="input" id="rTitle" value="${esc(v.title)}"></div>
      <div class="field"><label>视频文件</label>
        <div id="rFileBox"></div>
        <input type="file" id="rFile" accept="video/*" hidden></div>`,
    okText: '保存',
    onMount: (w) => {
      bindChapterCascade(w, 'ev');
      mountElUpload(w.querySelector('#rFileBox'), w.querySelector('#rFile'), {
        list: true,
        accept: 'video/*',
        existingName: storedVideoName(v),
        tip: '选取后文件名留在下面，点后面的叉号可去掉，再点保存',
      });
    },
    onOk: async (w, err) => {
      const chapterId = cascadeChapterId(w, 'ev');
      const title = w.querySelector('#rTitle').value.trim();
      if (!chapterId) return err('请依次选择 学科 → 年级/学段 → 课程分类 → 课程章节');
      if (!title) return err('标题不能为空');
      const file = w.querySelector('#rFile').files[0];
      const btn = w.querySelector('#mOk');
      const body = { title, chapter_id: chapterId, section_id: cascadeSectionId(w, 'ev') || '' };
      try {
        if (file) {
          body.file_key = await uploadVideoDirect(file, (done, total) => {
            btn.innerHTML = '<span class="spinner"></span> 上传中 ' + done + '/' + total;
          });
        } else if (w.querySelector('#rFile').dataset.clear === '1') body.clear_file = '1';
        await api('/api/admin/videos/' + v.id, { method: 'PUT', body, silent: true });
      } catch (e) {
        btn.textContent = '保存';
        return err(e.message || '保存失败');
      }
      toast('已保存', 'ok');
      render();
    },
  });
}

// ------------------------------------------------------------ 视频
async function viewVideos() {
  await loadMeta();
  const all = await api(`/api/admin/videos`);
  const st = ADM.page.vf = ADM.page.vf || { subject: '', grade: '', category: '', chapter: '', section: '' };
  const filtered = filterByChapterState(st, all);
  const dragOn = !!st.chapter; // 选了具体章节才能拖拽排序
  const pg = dragOn ? { list: filtered, total: filtered.length, page: 1, size: Math.max(filtered.length, 1), pages: 1 } : pageOf(filtered, 'vfPage', 10);
  const handleTh = dragOn ? '<th style="width:40px"></th>' : '';
  const handleTd = dragOn ? '<td class="vDrag" title="拖动排序">⋮⋮</td>' : '';
  const pagerOrTip = dragOn ? '<div style="padding:12px 4px 4px;font-size:12px;color:var(--text3)">共 ' + pg.total + ' 条 · 按住左侧 ⋮⋮ 上下拖动调整顺序，松手自动保存（只能在同一分级目录内拖动）</div>' : pagerHTML(pg.page, pg.size, pg.total, 'vfPage');
  const list = pg.list;
  return {
    html: `<div class="card">
      <div class="card-h"><h3>${ic('video')} 视频管理 <span class="tag gray">${pg.total}</span></h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn ghost" id="vBatchDel" style="display:none">批量删除（<span id="vDelN">0</span>）</button>
          <button class="btn primary-sm" id="btnAdd">${ic('plus')} 新增</button>
        </div></div>
      <div class="toolbar">
        ${chapterFilterHTML('vf')}
        <button class="btn ghost" id="vReset">重置</button>
      </div>
      ${list.length ? `<table><thead><tr><th style="width:34px"><input type="checkbox" id="vChkAll"></th>${handleTh}<th>标题</th><th>所属章节</th><th>分级目录</th><th>上传时间</th><th>操作</th></tr></thead>
        <tbody id="vBody">${list.map((v) => `<tr data-id="${v.id}" data-sec="${v.section_id || 0}">
          <td><input type="checkbox" class="vChk" data-id="${v.id}"></td>${handleTd}
          <td><b>${esc(v.title)}</b></td><td>${esc(v.chapter_name || '未分类')}</td>
          <td>${v.section_name ? esc(v.section_name) : '<span style="color:var(--text3)">不分组</span>'}</td>
          <td style="font-size:12px;color:var(--text3)">${esc((v.created_at || '').slice(0, 16))}</td>
          <td><div class="acts"><button class="link-btn" data-play="${v.id}">预览</button><button class="link-btn" data-ren="${v.id}">编辑</button><button class="link-btn danger" data-del="${v.id}">删除</button></div></td>
        </tr>`).join('')}</tbody></table>
        ${pagerOrTip}`
      : '<div class="empty">暂无视频</div>'}
    </div>`,
    after: () => {
      if (!dragOn) bindPager('vfPage');
      bindChapterFilter(document, 'vf', () => { ADM.page.vfPage = 1; render(); });
      document.getElementById('vReset').onclick = () => { ADM.page.vf = { subject: '', grade: '', category: '', chapter: '', section: '' }; ADM.page.vfPage = 1; render(); };
      document.getElementById('btnAdd').onclick = addVideoForm;
      if (dragOn) bindVideoDrag(list, all, st);
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const v = list.find((x) => x.id === Number(b.dataset.del));
        if (!await elConfirm({ title: '删除视频', message: `确定删除视频【${v.title}】？`, okText: '删除', danger: true })) return;
        askPwd('删除视频', `将删除「${v.title}」，删除后不可恢复。`, async (pwd, err) => {
          await api('/api/admin/videos/' + v.id, { method: 'DELETE', body: { pwd } });
          toast('已删除', 'ok'); render();
        });
      });
      // 批量删除：勾选 → 输删除密码 → 一次删掉
      const syncSel = () => {
        const n = document.querySelectorAll('.vChk:checked').length;
        const btn = document.getElementById('vBatchDel');
        btn.style.display = n ? '' : 'none';
        document.getElementById('vDelN').textContent = n;
        const all = document.getElementById('vChkAll');
        if (all) all.checked = n === list.length;
      };
      document.querySelectorAll('.vChk').forEach((c) => c.onchange = syncSel);
      const allChk = document.getElementById('vChkAll');
      if (allChk) allChk.onchange = () => {
        document.querySelectorAll('.vChk').forEach((c) => { c.checked = allChk.checked; });
        syncSel();
      };
      document.getElementById('vBatchDel').onclick = async () => {
        const ids = [...document.querySelectorAll('.vChk:checked')].map((c) => Number(c.dataset.id));
        if (!ids.length) return toast('请先勾选要删除的视频', 'err');
        if (!await elConfirm({ title: '批量删除', message: `确定批量删除选中的 ${ids.length} 个视频？不可恢复。`, okText: '删除', danger: true })) return;
        askPwd('批量删除视频', `将删除选中的 ${ids.length} 个视频，删除后不可恢复。`, async (pwd, err) => {
          const r = await api('/api/admin/videos/batch', { method: 'DELETE', body: { ids, pwd } });
          toast(r.msg || '已删除', 'ok'); render();
        });
      };
      document.querySelectorAll('[data-ren]').forEach((b) => b.onclick = () => {
        const v = list.find((x) => x.id === Number(b.dataset.ren));
        renameForm(v);
      });
      document.querySelectorAll('[data-play]').forEach((b) => b.onclick = async () => {
        const v = list.find((x) => x.id === Number(b.dataset.play));
        if (v.url) return openPlayer(v.title, v.url);
        if (!v.file_path) return toast('还没有视频', 'err');
        openPlayer(v.title, fileUrl(v.file_path));
      });
    },
  };
}
/** 视频列表拖拽排序：只在选定章节时启用；松手后把整章新顺序存到后端 */
function bindVideoDrag(list, all, st) {
  const body = document.getElementById('vBody');
  if (!body) return;
  const chapterAll = all.filter((v) => Number(v.chapter_id) === Number(st.chapter));
  const subset = new Set(list.map((v) => v.id));
  const before = list.map((v) => v.id).join(',');
  const rows = () => [...body.querySelectorAll('tr[data-id]')];
  let dragging = null;
  rows().forEach((tr) => {
    const h = tr.querySelector('.vDrag');
    if (!h) return;
    h.style.cssText = 'cursor:grab;text-align:center;color:var(--text3);user-select:none;font-weight:700';
    h.onmousedown = () => { tr.draggable = true; };
    h.onmouseup = () => { tr.draggable = false; };
    tr.ondragstart = (e) => {
      dragging = tr;
      tr.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tr.dataset.id); } catch (err) { /* 忽略 */ }
    };
    tr.ondragover = (e) => {
      if (!dragging || dragging === tr || dragging.dataset.sec !== tr.dataset.sec) return;
      e.preventDefault();
      const rect = tr.getBoundingClientRect();
      body.insertBefore(dragging, e.clientY > rect.top + rect.height / 2 ? tr.nextSibling : tr);
    };
    tr.ondragend = async () => {
      tr.style.opacity = '';
      tr.draggable = false;
      if (!dragging) return;
      dragging = null;
      const order = rows().map((r) => Number(r.dataset.id));
      if (order.join(',') === before) return;
      let k = 0;
      const ids = chapterAll.map((v) => (subset.has(v.id) ? order[k++] : v.id));
      try {
        await api('/api/admin/video-order', { method: 'POST', body: { ids } });
        toast('顺序已保存', 'ok');
      } catch (e) {
        toast((e && e.message) || '保存失败', 'err');
      }
      render();
    };
  });
}
function openPlayer(title, src) {
  const isFile = /\/api\/file|\.(mp4|webm|ogg|mov)(\?|$)/i.test(src);
  const wrap = document.createElement('div');
  wrap.className = 'mask';
  wrap.innerHTML = `<div class="modal wide"><div class="modal-h"><h3>${esc(title)}</h3><button class="close-x">&times;</button></div>
    <div class="modal-b"><div class="player-wrap">${isFile ? `<video src="${esc(src)}" controls autoplay></video>` : `<iframe src="${esc(src)}" allowfullscreen></iframe>`}</div></div></div>`;
  document.body.appendChild(wrap);
  const close = () => { const v = wrap.querySelector('video'); if (v) v.pause(); wrap.remove(); };
  wrap.querySelector('.close-x').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
}

/** 视频从浏览器分片直传 OSS，不经过本服务器。每个分片临上传前再要一次 6 小时有效的地址。 */
async function uploadVideoDirect(file, onProgress) {
  await checkVideoCodec(file);   // H.265 会黑屏只有声音：上传前拦下，不占用云存储（vcodec.js）
  const partSize = 8 * 1024 * 1024;
  const init = await api('/api/admin/videos/direct/init', { method: 'POST', body: { name: file.name, size: file.size }, silent: true });
  const total = Math.max(1, Math.ceil(file.size / partSize));
  const parts = [];
  try {
    for (let i = 0; i < total; i++) {
      const blob = file.slice(i * partSize, Math.min(file.size, (i + 1) * partSize));
      const sign = await api('/api/admin/videos/direct/sign', {
        method: 'POST', silent: true,
        body: { key: init.key, uploadId: init.uploadId, partNumber: i + 1 },
      });
      const up = await fetch(sign.url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!up.ok) throw new Error('分片上传失败（' + up.status + '）');
      let etag = up.headers.get('ETag') || up.headers.get('etag') || '';
      if (!etag) throw new Error('云存储没有返回分片校验值');
      if (etag.charAt(0) !== '"') etag = '"' + etag + '"';
      parts.push({ number: i + 1, etag });
      if (onProgress) onProgress(i + 1, total);
    }
    await api('/api/admin/videos/direct/complete', {
      method: 'POST', silent: true,
      body: { key: init.key, uploadId: init.uploadId, parts },
    });
    return init.key;
  } catch (e) {
    api('/api/admin/videos/direct/abort', { method: 'POST', silent: true, body: { key: init.key, uploadId: init.uploadId } }).catch(() => {});
    throw e;
  }
}

/** 新增视频：可以一次选多个文件，每个文件各存成一条。 */
function addVideoForm() {
  modal({
    title: '新增视频',
    wide: true,
    body: `${chapterCascadeHTML('nv', null)}
      <div class="field"><label>视频标题（学生端「知识点」名称）</label><input class="input" id="nTitle" placeholder="只传一个时必填，如 第1讲 有理数；多个时用文件名"></div>
      <div class="field"><label>视频文件（可不传；可一次选多个）</label>
        <div id="nFileBox"></div>
        <input type="file" id="nFile" accept="video/*" multiple hidden></div>`,
    okText: '保存',
    onMount: (w) => {
      bindChapterCascade(w, 'nv');
      mountElUpload(w.querySelector('#nFileBox'), w.querySelector('#nFile'), {
        list: true,
        multiple: true,
        accept: 'video/*',
        tip: '可一次选多个，直接传到阿里云。单个最大 4GB。选了多个时，每条视频的标题用文件名',
      });
    },
    onOk: async (w, err) => {
      const chapterId = cascadeChapterId(w, 'nv');
      const title = w.querySelector('#nTitle').value.trim();
      const files = [...w.querySelector('#nFile').files];
      if (!chapterId) return err('请依次选择 学科 → 年级/学段 → 课程分类 → 课程章节');
      if (files.length <= 1 && !title) return err('请填写视频标题');
      const btn = w.querySelector('#mOk');
      const batch = files.length ? files : [null];
      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const oneTitle = files.length > 1 ? file.name.replace(/\.[^.]+$/, '') : title;
        let fileKey = '';
        try {
          if (file) {
            fileKey = await uploadVideoDirect(file, (done, total) => {
              const head = files.length > 1 ? `第 ${i + 1}/${files.length} 个 · ` : '';
              btn.innerHTML = '<span class="spinner"></span> ' + head + `上传中 ${done}/${total}`;
            });
          }
          await api('/api/admin/videos', {
            method: 'POST', silent: true,
            body: { title: oneTitle, chapter_id: chapterId, section_id: cascadeSectionId(w, 'nv') || '', level: 'basic', file_key: fileKey },
          });
        } catch (e) {
          btn.textContent = '保存';
          return err((file ? file.name + '：' : '') + (e.message || '保存失败'));
        }
      }
      toast(files.length > 1 ? `已添加 ${files.length} 个视频` : '视频已添加', 'ok');
      render();
    },
  });
}

// ------------------------------------------------------------ 分校管理（仅校长）
async function viewBranches() {
  if (Auth.user.role !== 'admin') {
    return { html: '<div class="empty"><div class="e-ic"></div>仅校长可管理分校账号</div>', after: () => {} };
  }
  const list = await api('/api/admin/branches');
  return {
    html: `<div class="card">
      <div class="card-h"><h3> 分校账号 <span class="tag gray">${list.length} 个</span></h3>
        <button class="btn primary-sm" id="btnAdd">+ 开通分校</button></div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:12px">分校编号开通后固定不变——改名称 / 换登录手机号，已绑定学生与学情数据都不受影响。登录账号即手机号。</p>
      ${list.length ? `<table><thead><tr><th>编号</th><th>分校名称</th><th>登录账号（手机号）</th><th>已开通学生</th><th>到期时间</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead>
        <tbody>${list.map((b) => {
          const expired = b.expire_at && String(b.expire_at).slice(0, 10) < new Date().toLocaleDateString('sv-SE');
          return `<tr>
          <td><span class="tag gray">${esc(b.code || '—')}</span></td><td><b>${esc(b.name)}</b></td><td>${esc(b.username)}</td>
          <td>${b.students} 人${b.max_students ? ` <span class="tag gray">上限 ${b.max_students}</span>` : ''}</td>
          <td>${b.expire_at ? `<span class="tag ${expired ? 'no' : ''}">${esc(String(b.expire_at).slice(0, 10))}${expired ? ' 已到期' : ''}</span>` : '<span style="color:var(--text3)">长期有效</span>'}</td>
          <td>${b.status ? '<span class="tag ok">正常</span>' : '<span class="tag gray">停用</span>'}</td>
          <td style="font-size:12px;color:var(--text3)">${esc(b.last_login || '-')}</td>
          <td><div class="acts">
            <button class="link-btn" data-edit="${b.id}">编辑</button>
            <button class="link-btn ${b.status ? 'danger' : ''}" data-toggle="${b.id}" data-st="${b.status ? 0 : 1}">${b.status ? '停用' : '启用'}</button>
            <button class="link-btn danger" data-del="${b.id}">删除</button>
          </div></td></tr>`;
        }).join('')}</tbody></table>`
      : '<div class="empty"><div class="e-ic"></div>还没有分校账号，点击右上角"开通分校"添加</div>'}
    </div>`,
    after: () => {
      document.getElementById('btnAdd').onclick = () => branchForm(null);
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => branchForm(list.find((x) => x.id === Number(b.dataset.edit))));
      document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
        const s = list.find((x) => x.id === Number(b.dataset.toggle));
        await api('/api/admin/branches/' + s.id, { method: 'PUT', body: { name: s.name, status: Number(b.dataset.st) } });
        toast(b.dataset.st === '1' ? '已启用' : '已停用', 'ok'); render();
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const s = list.find((x) => x.id === Number(b.dataset.del));
        if (!await elConfirm({ title: '删除分校', message: `确定删除分校【${s.name}】？删除后该账号无法登录（其开通的学生账号不受影响）。`, okText: '删除', danger: true })) return;
        await api('/api/admin/branches/' + s.id, { method: 'DELETE' });
        toast('已删除', 'ok'); render();
      });
    },
  };
}

function branchForm(b) {
  const isEdit = !!b;
  const limitsRow = `
      <div class="field"><label>限制学生人数（0 或留空 = 不限制）</label><input class="input" id="bMax" type="number" min="0" value="${isEdit ? Number(b.max_students || 0) : 0}" placeholder="如 50"></div>
      <div class="field"><label>到期时间（留空 = 长期有效；到期后该分校账号无法登录）</label><input class="input" id="bExp" type="date" value="${isEdit && b.expire_at ? esc(String(b.expire_at).slice(0, 10)) : ''}"></div>`;
  modal({
    title: isEdit ? `编辑分校 · ${b.name}` : '开通分校账号',
    body: `
      ${isEdit ? `<div class="field"><label>分校编号（开通后固定，不可修改）</label><input class="input" value="${esc(b.code || '—')}" disabled></div>` : ''}
      <div class="field"><label>分校名称 *</label><input class="input" id="bName" value="${esc(isEdit ? b.name : '')}" placeholder="如：城南分校"></div>
      <div class="field"><label>登录账号（手机号）* ${isEdit ? '可修改，改后用新手机号登录，编号与学生绑定不变' : ''}</label><input class="input" id="bUser" value="${esc(isEdit ? (b.username || '') : '')}" placeholder="11 位手机号，如 15152099971"></div>
      ${isEdit ? `
      <div class="field"><label>重置密码（留空 = 不修改）</label><input class="input" id="bPwd" type="text" placeholder="输入新密码，留空保持原密码"></div>`
      : `<div class="field"><label>初始密码（默认 123456）</label><input class="input" id="bPwd" value="123456"></div>`}
      ${limitsRow}`,
    onOk: async (w, err) => {
      const name = w.querySelector('#bName').value.trim();
      if (!name) return err('分校名称必填');
      const username = w.querySelector('#bUser').value.trim();
      if (!/^\d{11}$/.test(username)) return err('登录账号需为 11 位手机号');
      const maxStudents = Math.max(0, Number(w.querySelector('#bMax').value) || 0);
      const expireAt = w.querySelector('#bExp').value || '';
      if (isEdit) {
        const body = { name, username, status: b.status, max_students: maxStudents, expire_at: expireAt };
        const pwd = w.querySelector('#bPwd').value;
        if (pwd) body.password = pwd;
        await api('/api/admin/branches/' + b.id, { method: 'PUT', body });
        toast(pwd ? '分校信息已保存，密码已重置' : '分校信息已保存', 'ok');
      } else {
        await api('/api/admin/branches', { method: 'POST', body: { name, username, password: w.querySelector('#bPwd').value || '123456', max_students: maxStudents, expire_at: expireAt } });
        toast('分校已开通，编号自动分配', 'ok');
      }
      render();
    },
  });
}

// ------------------------------------------------------------ 路由
/* ---------------- 学情管理 · 成绩管理（iframe 嵌入校区成绩系统） ---------------- */
function r10EmbeddedApp(kind, initial) {
  const grades = kind === 'grades';
  const tabs = grades ? [['dashboard','总览看板'],['records','成绩列表'],['tracking','考试对比'],['students','学生档案']] : [['talks','谈心谈话'],['contacts','家校沟通'],['students','学生信息'],['settings','设置']];
  const src = grades ? '/apps/grades/index.html' : '/apps/care/index.html';
  return {
    html: `<div class="r10-embed"><div class="r10-embed-nav" role="navigation" aria-label="${grades ? '成绩管理' : '班主任工作台'}">${tabs.map(([key,label]) => `<button type="button" data-r10-tab="${key}">${label}</button>`).join('')}${grades ? '<div class="r10-embed-actions"><button type="button" data-r10-action="btnCampusManage">校区管理</button><button type="button" data-r10-action="btnPrintPage">打印本页</button></div>' : ''}</div><iframe class="grades-frame" id="r10Embedded" src="${src}#/${initial}" ${grades ? '' : 'allow="microphone; camera"'} title="${grades ? '成绩管理' : '班主任工作台'}"></iframe></div>`,
    after: () => {
      const frame = document.getElementById('r10Embedded');
      const root = frame && frame.closest('.r10-embed');
      if (!frame || !root) return;
      const highlight = (key) => root.querySelectorAll('[data-r10-tab]').forEach((button) => { const active = button.dataset.r10Tab === key; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); });
      highlight(initial);
      root.querySelectorAll('[data-r10-tab]').forEach((button) => { button.onclick = () => { frame.contentWindow.location.hash = '#/' + button.dataset.r10Tab; highlight(button.dataset.r10Tab); }; });
      root.querySelectorAll('[data-r10-action]').forEach((button) => { button.onclick = () => { const target = frame.contentDocument && frame.contentDocument.getElementById(button.dataset.r10Action); if (target) target.click(); }; });
      frame.addEventListener('load', () => {
        try {
          const doc = frame.contentDocument;
          const style = doc.createElement('style');
          style.textContent = grades ? '.topbar,.sidebar{display:none!important}.layout{display:block!important}.main{margin:0!important;width:auto!important;max-width:none!important;padding:16px!important}body{background:#f6f8fc!important}' : '.topbar{display:none!important}.content{padding:16px!important}body{background:#f6f8fc!important}';
          doc.head.appendChild(style);
          const sync = () => highlight(frame.contentWindow.location.hash.replace(/^#\//,'').split('?')[0] || initial);
          frame.contentWindow.addEventListener('hashchange', sync); sync();
        } catch (_) { /* 独立应用仍可在 iframe 中使用 */ }
      });
    },
  };
}
function viewGrades() { return r10EmbeddedApp('grades', 'dashboard'); }
function viewCareApp(page) { return r10EmbeddedApp('care', page === 'care' ? 'contacts' : 'talks'); }

const VIEWS = {
  dash: viewDash, branches: viewBranches, students: viewStudents, chapters: viewChapters,
  handouts: viewHandouts, videos: viewVideos,
  bank: () => viewBank(), paper: () => viewPaperR6(), lessonq: () => viewLessonQ(), mistakelog: () => viewMistakeLog(), bkup: () => viewUploads(),
  intake: () => viewIntakeCenter(), 'intake-excel': () => viewIntakeExcel(), 'intake-word': () => viewIntakeExcel('word'), 'intake-photo': () => viewIntakePhoto(), 'intake-pdf': () => viewIntakePhoto('pdf'), 'intake-skill': () => viewIntakeSkill(), 'intake-teacher': () => viewIntakeTeacher(), 'intake-manual': () => viewIntakeManual(), mfq: () => viewMfBank(), pending: () => viewPending(), ktree: () => viewKTree(), mfc: () => viewMfCapture(), mfp: () => viewMfPapers(), mfi: () => viewMfIntake(), mfset: () => viewMfSet(),
  bkfb: () => viewBankFeedback(),
  words: () => viewWords(),
  letters: () => viewPhonicsLetters(), phonics: () => viewPhonicsPhonetic(),
  xreport: () => viewXReport(),
  oplog: () => viewOplog(),
  aireport: () => viewAireport(), 'aireport-view': () => viewAireportView(),
  grades: () => viewGrades(),
  talks: () => viewCareApp('talks'), care: () => viewCareApp('care'),
};

let r10ControlId = 0, r10ViewObserver = null;
function r10Enhance(root) {
  if (!root) return;
  root.querySelectorAll('label:not([for])').forEach(label=>{
    if(label.querySelector('input,select,textarea'))return;
    const field=label.closest('.field') || label.parentElement;
    const controls=field && field.querySelectorAll('input:not([type="hidden"]),select,textarea');
    if(controls && controls.length===1){const el=controls[0];if(!el.id)el.id='r10-field-'+(++r10ControlId);label.htmlFor=el.id;}
  });
  root.querySelectorAll('select,input[placeholder],textarea[placeholder]').forEach(el=>{
    if(el.getAttribute('aria-label') || el.labels && el.labels.length)return;
    const title=el.getAttribute('title') || el.getAttribute('placeholder') || (el.tagName==='SELECT' && el.options[0] && el.options[0].textContent);
    if(title)el.setAttribute('aria-label',title);
  });
  root.querySelectorAll('table').forEach(table=>{
    const head=table.querySelector('thead tr');if(!head)return;
    [...head.cells].filter(cell=>cell.textContent.trim()==='操作').forEach(cell=>{
      cell.classList.add('r10-actions-col');const index=cell.cellIndex;
      table.querySelectorAll('tbody tr').forEach(row=>{if(row.cells.length===head.cells.length && row.cells[index])row.cells[index].classList.add('r10-actions-col');});
    });
    let parent=table.parentElement;
    while(parent && parent!==root){const css=getComputedStyle(parent);if(['auto','scroll'].includes(css.overflowX)){if(parent.scrollWidth>parent.clientWidth+1){parent.tabIndex=0;parent.setAttribute('role','region');parent.setAttribute('aria-label','表格，可横向滚动查看其他列');}break;}parent=parent.parentElement;}
  });
}
let RENDER_SEQ = 0;   // 渲染序号：慢的旧渲染不允许覆盖新渲染（快速连点导航时页面不会串）
async function render() {
  const mySeq = ++RENDER_SEQ;
  if(r10ViewObserver){r10ViewObserver.disconnect();r10ViewObserver=null;}
  if (!Auth.token) {
    if (typeof closeWordDrawer === 'function') closeWordDrawer();
    renderLogin();
    return;
  }
  const key = (location.hash.replace('#/', '').split('?')[0]) || 'dash';
  if (key !== 'words' && typeof closeWordDrawer === 'function') closeWordDrawer();
  if (key === 'login') { renderLogin(); return; }
  if (key === 'acc') {   // 旧「知识点正确率」已并入「学习报告 → 习题学习报告」（R1）：旧书签跳过去，user_id 原样带上
    location.replace('#/xreport?tab=e' + (location.hash.split('?')[1] ? '&' + location.hash.split('?')[1] : ''));
    return;
  }
  const view = VIEWS[key] || viewDash;
  $app.innerHTML = shell('<div class="loading-page">加载中…</div>');
  bindShell();
  try {
    const out = await view();
    if (mySeq !== RENDER_SEQ) return;               // 已经有更新的渲染在跑了
    if (!document.getElementById('view')) return;   // 页面已被替换
    document.getElementById('view').innerHTML = out.html;
    if (out.after) out.after();
    const root = document.getElementById('view'); r10Enhance(root);
    if(root){let queued=false;r10ViewObserver=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(root.isConnected)r10Enhance(root);});});r10ViewObserver.observe(root,{childList:true,subtree:true});}
  } catch (e) {
    if (mySeq !== RENDER_SEQ) return;
    const v = document.getElementById('view');
    const msg = String(e && e.message || e);
    // 脚本偶发没加载全（not defined / 网络抖动）时给出可自助恢复的提示
    const reloadTip = /not defined|is not a function|Failed to fetch|NetworkError/i.test(msg)
      ? `<p style="margin-top:10px;color:#6b7280">页面脚本没有加载全（网络抖动），<a href="javascript:location.reload()" style="color:#2563eb">点此刷新</a>即可恢复。</p>`
      : '';
    if (v) { v.innerHTML = `<div class="empty r10-page-error" role="alert"><div class="e-ic">${ic('info')}</div><p>${esc(msg)}</p>${reloadTip}<button type="button" class="btn primary" id="r10-retry-page">重新加载本页</button></div>`; v.querySelector('#r10-retry-page').onclick = render; }
  }
}
window.addEventListener('hashchange', render);

/* 书签小工具备用回传通道：#/mfcap?d=<payload>
 * 组卷网/菁优网是 https 页面，向 http 后台 fetch 会被浏览器「混合内容」拦截，
 * 所以书签 fetch 失败时会打开 本地址#/mfcap?d=… 把题目带回来，这里负责接收入库。 */
async function mfcapSave(raw) {
  let d = null;
  try { d = JSON.parse(raw); if (!d || !Array.isArray(d.questions) || !d.questions.length) d = null; } catch (e) { d = null; }
  if (!d) { toast('书签回传数据无效，请重新点书签采集', 'err'); return; }
  try {
    await R4Flow.post('/api/admin/bank/mf/capture/batches', 'capture', {site:d.site,url:d.url,title:d.title,questions:d.questions}, d._intake_key);
    toast(`书签采集成功：已收到 ${d.questions.length} 题，已送入待审核，请核对题目和分类后入库`, 'ok');
    if ((location.hash.replace('#/', '').split('?')[0]) === 'mfc') render();
  } catch (e) { /* api 已提示 */ }
}
async function mfcapConsume() {
  const m = /^#\/mfcap\?d=(.+)$/.exec(location.hash || '');
  if (!m) return;
  const raw = decodeURIComponent(m[1]);
  location.hash = '#/mfc';           // 先清掉载荷，防止刷新页面重复入库
  if (!Auth.token) { toast('请先登录管理后台，再重新点一次书签', 'err'); return; }
  await mfcapSave(raw);
}
(async function boot() {
  await mfcapConsume();
  if (!Auth.token) { location.hash = '#/login'; renderLogin(); return; }
  try { Auth.user = await api('/api/me'); } catch (e) { /* ignore */ }
  render();
})();
