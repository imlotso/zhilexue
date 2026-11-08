/* 学生端 Vue 3
 * 登录、顶栏、课程列表、课程详情都是 Vue 组件。
 * 速记练习（单词 / 课文 / 考纲）仍由 words.js 画进本页的一块区域，换词书时走 window.render。 */
const SUBJECTS = ['英语', '数学', '物理', '化学'];
const CATEGORIES = ['同步基础', '同步培优', '专项提升', '中考冲刺'];
/* 分类标签图标（AI 生成，与 /img/wt/ 系列同风格：圆角渐变方块 + 白色图形） */
const CAT_ICON = {
  '同步基础': '/img/cat/jc.png',   // 蓝色 · 书本基石
  '同步培优': '/img/cat/py.png',   // 绿色 · 上升箭头
  '专项提升': '/img/cat/ts.png',   // 橙色 · 靶心命中
  '中考冲刺': '/img/cat/zc.png',   // 红色 · 全速冲刺
};
const SUBJ_ICON = { '数学': 'math', '英语': 'english', '物理': 'physics', '化学': 'chemistry' };
/* 左侧栏 AI 图标（与主题蓝渐变风格统一）；没有图的条目回退到图标字体 */
const RAIL_IMG = {
  '训练': '/img/wt/g_train.png',
  '英语': '/img/wt/g_english.png',
  '数学': '/img/wt/g_math.png',
  '物理': '/img/wt/g_physics.png',
  '化学': '/img/wt/g_chemistry.png',
  '试卷': '/img/wt/g_paper.png',
  '计时': '/img/wt/g_clock.png',
};
const THEMES = [
  { k: 'day', t: '日间', ic: 'sun', d: '清爽蓝白，白天光线充足' },
  { k: 'eye', t: '护眼', ic: 'eye', d: '暖黄低蓝光，久看不累' },
  { k: 'green', t: '豆沙绿', ic: 'leaf', d: '经典豆沙绿，柔和不晃眼' },
];
const THEME_META = { day: '#2f6bff', night: '#0e1520', eye: '#b7761a', green: '#2e7d4f' };

function gradeTerm(o) {
  const g = String((o && o.grade) || '').trim();
  const t = String((o && o.term) || '').trim();
  return (g + t).trim();
}
function stageName(s) { return s === 'primary' ? '小学' : s === 'junior' ? '初中' : ''; }
function myStage() {
  const u = Auth.user || {};
  const s = String(u.stage || '').trim();
  if (s === 'primary' || s === 'junior') return s;
  const g = String(u.grade || '');
  if (/^[一二三四五六]年级/.test(g)) return 'primary';
  if (/^[七八九]年级/.test(g) || /中考/.test(g)) return 'junior';
  return '';
}
function catsForStudent() {
  return myStage() === 'primary' ? CATEGORIES.filter((c) => c !== '中考冲刺') : CATEGORIES.slice();
}
function courseSub(c) {
  const cat = String(c.category || '');
  if (cat === '专项提升') return [stageName(c.stage) ? stageName(c.stage) + '专项' : '专项提升', c.book].filter(Boolean).join(' · ') || '专项提升';
  if (cat === '中考冲刺') return ['中考冲刺', c.book].filter(Boolean).join(' · ');
  return [gradeTerm(c), c.book].filter(Boolean).join(' · ');
}
function themeKey() {
  const u = Auth.user || {};
  return 'xuexi_theme:' + (u.id || u.username || 'me');
}
function themeGet() {
  let v = '';
  try { v = localStorage.getItem(themeKey()) || localStorage.getItem('xuexi_theme') || ''; } catch (e) { /* 隐私模式 */ }
  if (!THEMES.some((t) => t.k === v)) {
    try { if (localStorage.getItem('xuexi_eye:' + ((Auth.user && (Auth.user.id || Auth.user.username)) || 'me')) === '1') v = 'eye'; } catch (e) { /* 忽略 */ }
  }
  return THEMES.some((t) => t.k === v) ? v : 'day';
}
function themeApply() {
  const k = themeGet();
  if (k === 'day') document.body.removeAttribute('data-theme');
  else document.body.dataset.theme = k;
  let mask = document.getElementById('eyeMask');
  if (k === 'eye') {
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'eyeMask';
      mask.className = 'eye-mask';
      document.body.appendChild(mask);
    }
  } else if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META[k] || THEME_META.day;
}
function parseHash() {
  const raw = location.hash || '#/home';
  const [key, arg] = raw.replace(/^#\/?/, '').split('?')[0].split('/');
  return { key: key || 'courses', arg: arg ? decodeURIComponent(arg) : '', raw };
}
const AV_FACES = ['/img/av/1.svg', '/img/av/2.svg', '/img/av/3.svg', '/img/av/4.svg', '/img/av/5.svg', '/img/av/6.svg'];
function avatarOf(u) {
  const name = String((u && u.name) || '同学').trim() || '同学';
  // 创建学生时后端已随机分配头像（/img/av/p1.jpg ~ p10.jpg），有则直接用
  if (u && u.avatar) return { src: u.avatar, name };
  const seed = String((u && (u.id || u.username)) || name);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
  return { src: AV_FACES[h % AV_FACES.length], name };
}

const WordsPane = {
  name: 'WordsPane',
  props: { sub: { type: String, default: 'quick' } },
  data() { return { seq: 0 }; },
  template: '<div class="words-pane"></div>',
  mounted() { this.paint(); },
  watch: { sub() { this.paint(); } },
  methods: {
    async paint() {
      const seq = ++this.seq;
      if (typeof wtStopSpeech === 'function') wtStopSpeech();
      this.$el.innerHTML = '<div class="loading-page">加载中…</div>';
      try {
        const out = await viewWords(this.sub || 'quick');
        if (seq !== this.seq) return;
        this.$el.innerHTML = (out && out.html) || '';
        if (out && out.after) out.after();
      } catch (e) {
        if (seq !== this.seq) return;
        this.$el.innerHTML = '<div class="empty">' + esc(e.message || '加载失败') + '</div>';
      }
    },
  },
};

const App = {
  components: { WordsPane },
  data() {
    return {
      page: 'boot',
      wordSub: 'quick',
      wtSideOpen: (function () { try { return localStorage.getItem('xuexi_wtside') !== '0'; } catch (e) { return true; } })(),
      wtAccent: (function () { try { return localStorage.getItem('xuexi_wtaccent') === 'uk' ? 'uk' : 'us'; } catch (e) { return 'us'; } })(),
      courseId: '',
      user: Auth.user || {},
      subject: SUBJECTS[0],
      category: '',
      courses: null,
      cachedSubject: '',
      course: null,
      activeGroupId: '',
      openMap: {},
      loading: false,
      error: '',
      loginErr: '',
      loginBusy: false,
      username: '',
      password: '',
      theme: themeGet(),
      themeOpen: false,
      themeStyle: { top: '56px', left: '16px' },
      speed: 1,
      subjects: SUBJECTS,
      catIcon: CAT_ICON,
      mistCount: 0,
      homeCourses: [],
      homeTasks: [],
      homeDetail: null,
      homeCourseError: '',
      homeTaskError: '',
      homeRequest: 0,
      loadRequest: 0,
      pendingSelfPractice: '',
      mobileNavOpen: false,
    };
  },
  computed: {
    cats() { return catsForStudent(); },
    homeCourse() {
      const all = this.homeCourses || [];
      return all.find((c) => c.kp_done > 0 && c.kp_done < c.kp_total)
        || all.find((c) => c.kp_total > 0 && c.kp_done < c.kp_total) || all[0] || null;
    },
    homeSubtitle() {
      const c = this.homeCourse;
      return c ? [c.grade, c.subject, c.book].filter(Boolean).join(' · ') : [this.gradeText, '从今天开始，慢慢积累'].filter(Boolean).join(' · ');
    },
    homeProgress() {
      const c = this.homeCourse;
      return c && c.kp_total > 0 ? Math.max(0, Math.min(100, Math.round(c.kp_done / c.kp_total * 100))) : 0;
    },
    homeAccuracy() {
      const a = this.homeCourse && this.homeCourse.acc;
      return a && a.total && a.rate !== null && a.rate !== undefined ? a.rate + '%' : (a && a.total ? '未做' : '暂无可自动判分的习题');
    },
    counts() {
      const m = {};
      (this.courses || []).forEach((c) => { m[c.category] = (m[c.category] || 0) + 1; });
      return m;
    },
    courseList() {
      return (this.courses || []).filter((c) => c.category === this.category);
    },
    inWords() { return this.page === 'words'; },
    pageTitle() { return this.inWords ? '速记训练' : (this.subject || SUBJECTS[0]); },
    avatar() { return avatarOf(this.user); },
    gradeText() { return gradeTerm(this.user); },
    subs() { return (typeof WT_SUBS !== 'undefined' && WT_SUBS) || []; },
    wordGroups() { return (typeof WT_GROUPS !== 'undefined' && WT_GROUPS) || []; },
    curWordGroup() {
      return this.wordGroups.find((g) => g.subs.indexOf(this.wordSub) >= 0) || null;
    },
    sideSubs() {
      const g = this.curWordGroup;
      if (!g) return [];
      return g.subs.map((k) => this.subs.find((s) => s.k === k)).filter(Boolean);
    },
    loginBg() { return loginBgHTML(); },
    loginBrand() { return brandHTML('学生登录'); },
    brand() { return brandHTML('学生端'); },
    subjIcon() { return SUBJ_ICON; },
    railImg() { return RAIL_IMG; },
    activeGroup() {
      const gs = (this.course && this.course.groups) || [];
      return gs.find((g) => g.id === this.activeGroupId) || gs[0] || null;
    },
    activeGroupLessons() {
      const g = this.activeGroup;
      return (g && g.lessons) || [];
    },
    themeList() { return THEMES; },
    curTheme() { return THEMES.find((t) => t.k === this.theme) || THEMES[0]; },
  },
  created() {
    window.__stuVm = this;
    window.render = () => {
      const route = parseHash();
      if (route.key === 'words' && this.$refs.wordsPane) return this.$refs.wordsPane.paint();
      return this.load();
    };
    window.addEventListener('hashchange', () => this.load());
    document.addEventListener('click', () => { this.themeOpen = false; });
  },
  async mounted() {
    themeApply();
    if (!Auth.token) {
      if (!location.hash || location.hash === '#/' ) location.hash = '#/login';
      this.page = 'login';
      return;
    }
    try {
      Auth.user = await api('/api/me');
      this.user = Auth.user;
      if (Auth.user.role !== 'student') {
        Auth.clear();
        location.hash = '#/login';
        this.page = 'login';
        return;
      }
    } catch (e) { /* 交给页面提示 */ }
    const P = window.STORAGE_PREFIX || 'xuexi';
    const fresh = !sessionStorage.getItem(P + '_seen');
    sessionStorage.setItem(P + '_seen', '1');
    if (fresh && String(location.hash || '').startsWith('#/words')) location.hash = '#/home';
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/home';
    this.theme = themeGet();
    themeApply();
    await this.load();
  },
  methods: {
    courseSub,
    /** 习题正确率标签（T6）：a = { total, answered, correct, rate }；没有绑题的视频 / 分组不显示 */
    accText(a, short) {
      if (!a || !a.total) return '';
      if (a.rate === null || a.rate === undefined) return short ? '未做' : `习题未做 · 共 ${a.total} 题`;
      return short ? `${a.rate}%` : `正确率 ${a.rate}% · ${a.correct}/${a.answered}`;
    },
    accCls(a) {
      if (!a || a.rate === null || a.rate === undefined) return '';
      return a.rate >= 80 ? 'good' : a.rate >= 60 ? 'mid' : 'low';
    },
    syncRoute() {
      const r = parseHash();
      if (!Auth.token || r.key === 'login') { this.page = 'login'; this.resetLearningHome(); return; }
      if (r.key === 'home') { this.page = 'home'; return; }
      if (r.key === 'course' && r.arg) { this.page = 'course'; this.courseId = r.arg; return; }
      if (r.key === 'words') { this.page = 'words'; this.wordSub = r.arg || 'quick'; return; }
      if (r.key === 'timer') { this.page = 'tool'; return; }
      if (r.key === 'papers') { this.page = 'papers'; return; }
      if (r.key === 'mistakes') { this.page = 'mistakes'; return; }
      this.page = 'courses';
    },
    async load() {
      this.syncRoute();
      const request = this.loadRequest = (this.loadRequest || 0) + 1;
      this.mobileNavOpen = false;
      if (this.page !== 'papers') this.pendingSelfPractice = '';
      this.error = '';
      if (this.page === 'login') { themeApply(); return; }
      themeApply();
      this.refreshMistCount();
      if (this.page === 'tool') {   // 计时页：纯本地 iframe，不用取任何数据
        this.loading = false; this.error = '';
        return;
      }
      if (this.page !== 'words') {
        if (typeof wtStopSpeech === 'function') wtStopSpeech();
        if (typeof wtStageOff === 'function') wtStageOff();
      } else {
        this.loading = false;
        this.error = '';
        return;
      }
      // 试卷 / 错题本：整页交给 bank.js 渲染（DOM 引擎，与做题弹层同源）
      if (this.page === 'papers' || this.page === 'mistakes') {
        this.loading = false;
        this.error = '';
        this.$nextTick(() => {
          const host = document.getElementById(this.page + 'Host');
          if (host && window.BankPages) {
            const kind = this.pendingSelfPractice;
            this.pendingSelfPractice = '';
            Promise.resolve(BankPages[this.page](host, this.subject)).then(() => {
              if (kind && request === this.loadRequest && this.page === 'papers' && host.isConnected) BankPages.scanFlow(kind, this.subject, host);
            });
          }
        });
        return;
      }
      this.loading = true;
      try {
        if (this.page === 'home') await this.loadHome();
        else if (this.page === 'courses') await this.loadCourses();
        else if (this.page === 'course') await this.loadCourse();
      } catch (e) {
        if (request === this.loadRequest) this.error = e.message || '加载失败';
      } finally {
        if (request === this.loadRequest) { this.loading = false; window.scrollTo(0, 0); }
      }
    },
    resetLearningHome() {
      this.homeRequest = (this.homeRequest || 0) + 1;
      this.homeCourses = [];
      this.homeTasks = [];
      this.homeDetail = null;
      this.homeCourseError = '';
      this.homeTaskError = '';
      this.pendingSelfPractice = '';
    },
    async loadHome() {
      this.resetLearningHome();
      const request = this.homeRequest, token = Auth.token, account = (Auth.user || {}).id;
      const current = () => request === this.homeRequest && this.page === 'home' && Auth.token === token && (Auth.user || {}).id === account;
      await Promise.all([
        (async () => {
          try {
            const courses = await api('/api/stu/courses', { silent: true });
            if (!current()) return;
            this.homeCourses = Array.isArray(courses) ? courses : [];
            const c = this.homeCourse;
            if (c) {
              try {
                const detail = await api('/api/stu/course-detail?id=' + encodeURIComponent(c.id), { silent: true });
                if (current()) this.homeDetail = detail;
              } catch (e) { /* 列表数据仍有效；详情可在进入课程后重试。 */ }
            }
          } catch (e) { if (current()) this.homeCourseError = e.message || '课程加载失败'; }
        })(),
        (async () => {
          try {
            const tasks = await api('/api/stu/bank/tasks', { silent: true });
            if (current()) this.homeTasks = Array.isArray(tasks) ? tasks : [];
          } catch (e) { if (current()) this.homeTaskError = e.message || '任务加载失败'; }
        })(),
      ]);
    },
    goHome() { if (this.page === 'home') this.load(); else location.hash = '#/home'; },
    goHomeTasks() {
      // The existing paper page filters by subject. Enter a subject that is
      // actually represented on the home page rather than the login default.
      const task = (this.homeTasks || []).find((item) => SUBJECTS.includes(item.subject));
      if (task) this.subject = task.subject;
      this.goBank('papers');
    },
    openHomeTask(task) {
      if (!task || !window.BankPages) return;
      const token = Auth.token;
      BankPages.openPaper(Number(task.id), () => { if (this.page === 'home' && Auth.token === token) return this.load(); });
    },
    goSelfPractice(kind) {
      if (kind !== 'textbook' && kind !== 'knowledge') return;
      if (this.homeCourse && this.homeCourse.subject) this.subject = this.homeCourse.subject;
      this.pendingSelfPractice = kind;
      location.hash = '#/papers';
    },
    homeTaskStatus(task) {
      if (!task.tried) return '未完成';
      return task.last && typeof quizTryText === 'function' ? quizTryText(task.last) : '已提交';
    },
    homeTaskDeadline(task) {
      return task.due_at && typeof paperDeadlineInfo === 'function' ? paperDeadlineInfo(task.due_at).text : '';
    },
    async loadCourses() {
      const subject = this.subject || SUBJECTS[0];
      this.subject = subject;
      if (!this.courses || this.cachedSubject !== subject) {
        this.courses = await api('/api/stu/courses?subject=' + encodeURIComponent(subject));
        this.cachedSubject = subject;
      }
      const cats = this.cats;
      if (!cats.includes(this.category)) this.category = cats[0];
    },
    async loadCourse() {
      this.course = await api('/api/stu/course-detail?id=' + encodeURIComponent(this.courseId));
      if (this.course && this.course.subject) this.subject = this.course.subject;
      // 分组课程：默认选中第一个分组（左侧导航）
      const gs = (this.course && this.course.groups) || [];
      if (this.course && this.course.grouped && gs.length && !gs.some((g) => g.id === this.activeGroupId)) {
        this.activeGroupId = gs[0].id;
      }
    },
    async onLogin() {
      this.loginBusy = true;
      this.loginErr = '';
      try {
        const d = await api('/api/login', { method: 'POST', body: { username: this.username.trim(), password: this.password, role: 'student' } });
        Auth.token = d.token;
        Auth.user = d.user;
        this.user = d.user;
        this.resetLearningHome();
        this.course = null;
        this.mistCount = 0;
        this.courses = null;
        this.cachedSubject = '';
        this.subject = SUBJECTS[0];
        this.category = '';
        if (typeof FX !== 'undefined') FX.pop();
        location.hash = '#/home';
      } catch (e) {
        this.loginErr = e.message || '登录失败';
      } finally {
        this.loginBusy = false;
      }
    },
    pickSubject(s) {
      if (this.page === 'courses' && this.subject === s) return;
      if (typeof FX !== 'undefined') FX.tap();
      this.subject = s;
      this.courses = null;
      this.cachedSubject = '';
      if (location.hash && location.hash !== '#/courses' && location.hash !== '#/') location.hash = '#/courses';
      else this.load();
    },
    pickCat(c) {
      if (this.category !== c && typeof FX !== 'undefined') FX.tap();
      this.category = c;
      if (this.page === 'tool') location.hash = '#/courses';   // 计时页上点分类：回课程列表
    },
    openCourse(id) {
      if (typeof FX !== 'undefined') FX.tap();
      location.hash = '#/course/' + id;
    },
    goCourses() { location.hash = '#/courses'; },
    toggleWtSide(v) {
      this.wtSideOpen = v;
      try { localStorage.setItem('xuexi_wtside', v ? '1' : '0'); } catch (e) { /* 忽略 */ }
    },
    toggleAccent() {
      const v = this.wtAccent === 'us' ? 'uk' : 'us';
      this.wtAccent = v;
      if (typeof wtAccentSet === 'function') wtAccentSet(v);
      if (typeof FX !== 'undefined') FX.tap();
    },
    goWords(sub) {
      const next = sub || 'quick';
      if (this.page === 'words' && this.wordSub === next) return;
      if (typeof FX !== 'undefined') FX.tap();
      location.hash = '#/words/' + next;
    },
    goTool() {
      if (this.page === 'tool') return;
      if (typeof FX !== 'undefined') FX.tap();
      location.hash = '#/timer';
    },
    goBank(k) {
      if (this.page === k) return;
      if (typeof FX !== 'undefined') FX.tap();
      location.hash = '#/' + k;
    },
    /** 顶栏错题本角标：未掌握错题数（轻量接口，路由切换时顺手刷新） */
    async refreshMistCount() {
      try {
        const d = await api('/api/stu/bank/mistake-count');
        this.mistCount = (d && d.pending) || 0;
      } catch (e) { /* 未登录或网络异常时静默 */ }
    },
    /** R8「继续学习」：播放下一个没学完的视频（全部学完就从第一个开始），并把左侧切到它所在的小分组 */
    continueLearn() {
      const c = this.course; if (!c) return;
      const all = c.grouped ? (c.groups || []).reduce((a, g) => a.concat(g.lessons), []) : (c.lessons || []);
      const target = (c.next && all.find((l) => l.video_id === c.next.video_id)) || all[0];
      if (!target) return;
      if (c.next && c.next.group_id !== undefined && c.grouped) this.activeGroupId = c.next.group_id;
      this.playVideo(target);
    },
    /** R8 小分组练习：本组视频的题 + 小分组自己挂的题，一次做完，正确率计入小分组 */
    async doSectionPractice(g) {
      if (typeof FX !== 'undefined') FX.tap();
      let d;
      try { d = await api('/api/stu/bank/section-questions?section_id=' + g.id); }
      catch (e) { toast(e.message || '练习加载失败', 'err'); return; }
      if (!d || !d.list || !d.list.length) { toast('这个小分组还没有练习题'); return; }
      const first = (g.lessons || [])[0];
      BankQuiz.open({
        mode: 'step',
        title: g.name + ' · 小分组练习',
        subtitle: `${d.list.length} 道题 · 做一题核对一题`,
        questions: d.list,
        onWatch: first ? () => this.playVideo(first) : null,
        watchText: '去看视频',
        submit: async (answers, duration) => {
          const r = await api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'section', section_id: g.id, answers, duration } });
          // 交卷成功后使课程卡正确率缓存失效，返回列表时重新读取。
          this.courses = null;
          this.cachedSubject = '';
          this.loadCourse().catch(() => {});
          return r;
        },
      });
    },
    /** R8 点视频卡上的知识点标签：弹出这个知识点的掌握情况（做过的题、正确率、本课程里讲它的视频） */
    async showNodeMastery(n) {
      let d;
      try { d = await api('/api/stu/bank/node-mastery?node_id=' + n.id + '&course_id=' + encodeURIComponent(this.courseId)); }
      catch (e) { toast(e.message || '加载失败', 'err'); return; }
      const rate = d.rate;
      const cls = rate === null ? '' : rate >= 80 ? 'good' : rate >= 60 ? 'mid' : 'low';
      const TN = { single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序' };
      const m = document.createElement('div');
      m.className = 'mask r8-nm-mask';
      m.innerHTML = `<div class="r8-nm" role="dialog">
        <div class="r8-nm-h"><div><span>知识点</span><b>${esc(d.node.name)}</b></div><button class="close-x" type="button" title="关闭">&times;</button></div>
        <div class="r8-nm-top">
          <div class="r8-nm-ring ${cls}" style="--p:${rate || 0}"><div><b>${rate === null ? '—' : rate + '<small>%</small>'}</b><span>正确率</span></div></div>
          <div class="r8-nm-stats">
            <div><span>做过</span><b>${d.answered}</b><em>题</em></div>
            <div><span>答对</span><b class="ok">${d.correct}</b><em>题</em></div>
            <div><span>相关题目</span><b>${d.total}</b><em>题</em></div>
          </div>
        </div>
        <div class="r8-nm-tip">${d.answered ? (rate >= 80 ? '这个知识点掌握得不错，继续保持。' : '这个知识点还不太牢固，建议再看一遍视频后做练习。') : '这个知识点下的题你还没有做过，先看视频再做练习吧。'}</div>
        ${d.videos && d.videos.length ? `<div class="r8-nm-sec"><h5>讲这个知识点的视频</h5>${d.videos.map((v) => `<button type="button" class="r8-nm-v" data-v="${v.video_id}"><i class="ai ai-play"></i><span>${esc(v.title)}</span></button>`).join('')}</div>` : ''}
        <div class="r8-nm-sec"><h5>做过的题<em>（最近一次作答）</em></h5>${d.list.length ? `<div class="r8-nm-list">${d.list.map((q) => `
          <div class="r8-nm-q ${q.is_correct ? 'ok' : 'no'}"><i class="r8-nm-st">${q.is_correct ? '对' : '错'}</i><span class="r8-nm-t">${TN[q.type] || '题'}</span><span class="r8-nm-s">${esc(q.stem)}</span></div>`).join('')}</div>` : '<div class="r8-nm-empty">还没有做过这个知识点的题</div>'}</div>
      </div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      m.querySelector('.close-x').onclick = close;
      m.addEventListener('click', (e) => { if (e.target === m) close(); });
      m.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => {
        const all = (this.course.grouped ? (this.course.groups || []).reduce((a, g) => a.concat(g.lessons), []) : (this.course.lessons || []));
        const l = all.find((x) => x.video_id === Number(b.dataset.v));
        close();
        if (l) this.playVideo(l);
      });
      if (window.mtxTypeset) mtxTypeset(m);
    },
    /** 知识点【做练习】：取题 → 全屏做题弹层 → 错题自动进错题本 */
    async doPractice(lesson) {
      if (typeof FX !== 'undefined') FX.tap();
      let d;
      try { d = await api('/api/stu/bank/lesson-questions?video_id=' + lesson.video_id); }
      catch (e) { toast(e.message || '练习加载失败', 'err'); return; }
      if (!d || !d.list || !d.list.length) { toast('这个知识点还没有配套练习题'); return; }
      BankQuiz.open({
        mode: 'step',
        title: (lesson.title || d.title || '配套练习') + ' · 做练习',
        subtitle: `${d.list.length} 道题 · 做一题核对一题`,
        questions: d.list,
        onWatch: () => this.playVideo(lesson),   // R8：报告页「再看一遍视频」
        watchText: '再看一遍视频',
        // 交卷成功就刷新课程数据：视频 / 小分组的正确率马上变化（弹层关掉后看到的已是新数字）
        submit: async (answers, duration) => {
          const r = await api('/api/stu/bank/submit', { method: 'POST', body: { kind: 'practice', video_id: lesson.video_id, answers, duration } });
          // 交卷成功后使课程卡正确率缓存失效，返回列表时重新读取。
          this.courses = null;
          this.cachedSubject = '';
          this.loadCourse().catch(() => {});
          return r;
        },
      });
    },
    toggleTheme(e) {
      e.stopPropagation();
      if (typeof FX !== 'undefined') FX.pop();
      this.themeOpen = !this.themeOpen;
      if (!this.themeOpen) return;
      this.$nextTick(() => {
        const btn = this.$refs.themeBtn;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const w = 292;
        const left = Math.max(10, Math.min(window.innerWidth - w - 10, Math.round(r.left)));
        this.themeStyle = { top: Math.round(r.bottom + 8) + 'px', left: left + 'px', right: 'auto' };
      });
    },
    pickTheme(k) {
      if (!THEMES.some((t) => t.k === k)) return;
      try { localStorage.setItem(themeKey(), k); localStorage.setItem('xuexi_theme', k); } catch (e) { /* 忽略 */ }
      this.theme = k;
      themeApply();
      this.themeOpen = false;
      if (typeof FX !== 'undefined') FX.tap();
    },
    async logout() {
      if (await elConfirm({ title: '退出登录', message: '确定退出登录？', okText: '退出' })) {
        if (typeof wtStopSpeech === 'function') wtStopSpeech();
        if (typeof wtStageOff === 'function') wtStageOff();
        Auth.clear();
        this.resetLearningHome();
        this.courses = null; this.course = null; this.cachedSubject = ''; this.mistCount = 0;
        this.user = {};
        location.hash = '#/login';
      }
    },
    isGroupOpen(gid) { return !!this.openMap[this.courseId + ':' + gid]; },
    toggleGroup(gid) {
      const k = this.courseId + ':' + gid;
      this.openMap[k] = !this.openMap[k];
    },
    toggleAll() {
      const groups = (this.course && this.course.groups) || [];
      const toOpen = groups.some((g) => !this.isGroupOpen(g.id));
      groups.forEach((g) => { this.openMap[this.courseId + ':' + g.id] = toOpen; });
    },
    allOpen() {
      const groups = (this.course && this.course.groups) || [];
      return groups.length > 0 && groups.every((g) => this.isGroupOpen(g.id));
    },
    fileKind, fmtSize, canPreview,
    async playVideo(lesson) {
      const videoId = lesson.video_id;
      const v = await api('/api/stu/videos/' + videoId + '/play').catch((e) => { toast(e.message || '视频加载失败'); return null; });
      if (!v) return;
      if (!v.src) { toast('该知识点还没有上传视频文件，请联系老师'); return; }
      const isFile = v.is_file !== undefined ? v.is_file : /\/api\/file|\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(v.src);
      const canSpeed = v.allow_speed !== 0;
      const rates = [0.75, 1, 1.25, 1.5, 2];
      const wrap = document.createElement('div');
      wrap.className = 'mask video-mask';
      wrap.innerHTML = `<div class="video-box">
        <div class="video-h"><b>${esc(lesson.title || v.title)}</b><button class="close-x">&times;</button></div>
        <div class="player-wrap t1-pw">${isFile
          ? `<video id="stVideo" src="${esc(withTicket(v.src))}" controls playsinline webkit-playsinline x5-playsinline x5-video-player-type="h5-page" x5-video-player-fullscreen="false" preload="metadata"></video><div class="t1-vp-layer" hidden></div>`
          : `<iframe src="${esc(withTicket(v.src))}" allowfullscreen></iframe>`}</div>
        <div class="st-player-bar"><div class="pb-title">${esc(lesson.title || v.title)}</div>
          <div class="pb-right">${isFile && canSpeed
            ? `<span class="pb-lbl">倍速</span><div class="spd">${rates.map((r) => `<button class="spd-b ${r === this.speed ? 'on' : ''}" data-rate="${r}">${r === 1 ? '1.0' : r}</button>`).join('')}</div>`
            : '<span class="pb-lock">播放</span>'}</div></div>
      </div>`;
      document.body.appendChild(wrap);
      const vid = wrap.querySelector('#stVideo');
      let closed = false, stallTimer = 0;
      const close = () => { closed = true; clearTimeout(stallTimer); if (vid) vid.pause(); wrap.remove(); };
      wrap.querySelector('.close-x').onclick = close;
      wrap.onclick = (e) => { if (e.target === wrap) close(); };
      if (!vid) return;
      // ---- 手机播放兜底：播放被拒 / 加载出错 / 卡住 / 只有声音没有画面（H.265 等），都给出明确提示 ----
      const layer = wrap.querySelector('.t1-vp-layer');
      const hideLayer = () => { layer.hidden = true; layer.innerHTML = ''; layer.className = 't1-vp-layer'; };
      const tryPlay = () => {
        // 只有"浏览器不让脚本播放"才提示点按；NotSupportedError（没有可播放的源）由 error 事件给出真实原因，
        // AbortError 是被新的加载/暂停打断，都不能用点按提示盖掉错误层
        const fail = (e) => {
          const n = e && e.name;
          if (closed || n === 'AbortError' || n === 'NotSupportedError' || /t1-vp-err/.test(layer.className)) return;
          showTap();
        };
        try { const p = vid.play(); if (p && p.catch) p.catch(fail); } catch (e) { fail(e); }
      };
      const showTap = () => {   // 浏览器拒绝了脚本发起的播放（常见于 iOS Safari / 微信内置浏览器）
        layer.className = 't1-vp-layer t1-vp-tap';
        layer.innerHTML = '<button type="button" class="t1-vp-btn t1-vp-go">▶ 点击视频开始播放</button>';
        layer.hidden = false;
        layer.querySelector('.t1-vp-go').onclick = () => { hideLayer(); tryPlay(); };
      };
      const showErr = (msg, soft) => {   // soft=true：可能只是网络慢，恢复播放后自动消失
        if (closed) return;
        clearTimeout(stallTimer);
        layer.className = 't1-vp-layer t1-vp-err' + (soft ? ' t1-vp-soft' : '');
        layer.innerHTML = `<div class="t1-vp-msg">${esc(msg)}</div><div class="t1-vp-acts"><button type="button" class="t1-vp-btn t1-vp-reload">重新加载</button><a class="t1-vp-btn t1-vp-open" target="_blank" rel="noopener" href="${esc(withTicket(v.src))}">用浏览器打开</a></div>`;
        layer.hidden = false;
        layer.querySelector('.t1-vp-reload').onclick = reload;
      };
      const reload = async () => {   // 重新请求播放地址（兼容一小时签名过期）
        hideLayer();
        const nv = await api('/api/stu/videos/' + videoId + '/play').catch(() => null);
        if (closed) return;
        if (!nv || !nv.src) { showErr('重新获取播放地址失败，请检查网络后再试'); return; }
        v.src = nv.src;
        noPic = false;
        vid.src = withTicket(nv.src);
        vid.load();
        tryPlay();
      };
      const ERR_TEXT = {
        2: '网络出错，视频加载中断了',
        3: '视频解码失败：这个视频的编码当前浏览器无法解码',
        4: '当前浏览器不支持这个视频格式，或视频链接已失效',
      };
      vid.addEventListener('error', () => {
        const c = vid.error && vid.error.code;
        if (c === 1) return;   // 1 = 用户主动中止，不算错误
        showErr(ERR_TEXT[c] || '视频播放出错了');
      });
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => { if (!closed && vid.readyState < 3 && !vid.error) showErr('视频加载很慢或网络中断了，可以点“重新加载”', true); }, 10000);
      };
      vid.addEventListener('stalled', armStall);
      vid.addEventListener('waiting', armStall);
      vid.addEventListener('abort', () => { if (!closed && vid.readyState === 0 && !vid.error) armStall(); });
      ['canplay', 'canplaythrough'].forEach((ev) => vid.addEventListener(ev, () => clearTimeout(stallTimer)));
      vid.addEventListener('playing', () => {
        clearTimeout(stallTimer);
        if (/t1-vp-(soft|tap)/.test(layer.className)) hideLayer();
      });
      // H.265 等浏览器解不了的画面编码：声音正常播放、画面全黑，而且浏览器不会触发 error 事件，只能靠 videoWidth===0 识别
      let noPic = false;
      const checkNoPicture = () => {
        if (closed || noPic || !(vid.duration > 0) || vid.videoWidth !== 0) return;
        noPic = true;
        vid.pause();
        showErr('这个视频只有声音、没有可显示的画面：画面编码（如 H.265）当前浏览器不支持。可以点“用浏览器打开”换个浏览器试试，或联系老师重新上传 H.264 编码的 MP4');
      };
      vid.addEventListener('loadeddata', checkNoPicture);
      // 竖屏视频（高>宽）不套固定 16:9，保持按视频比例显示，否则在手机上会缩成一条
      vid.addEventListener('loadedmetadata', () => { if (vid.videoHeight > vid.videoWidth) wrap.querySelector('.player-wrap').classList.add('t1-portrait'); });
      vid.addEventListener('timeupdate', () => { if (vid.currentTime > 0.5) checkNoPicture(); });
      const apply = (r) => { try { vid.playbackRate = r; } catch (e) { /* 忽略 */ } };
      if (canSpeed) {
        apply(this.speed || 1);
        vid.addEventListener('loadedmetadata', () => apply(this.speed || 1));  // 个别浏览器在元数据就绪后会重置倍速
        wrap.querySelectorAll('.spd-b').forEach((b) => b.onclick = () => {
          this.speed = Number(b.dataset.rate);
          apply(this.speed);
          wrap.querySelectorAll('.spd-b').forEach((x) => x.classList.toggle('on', x === b));
        });
      }
      let marked = false;
      const mark = async () => {
        if (marked) return;
        marked = true;
        try { await api('/api/stu/progress', { method: 'POST', body: { video_id: videoId, video_done: 1 }, silent: true }); }
        catch (e) { marked = false; return; }
        lesson.done = true;
        this.recount();
        this.courses = null;
      };
      vid.addEventListener('ended', mark);
      vid.addEventListener('timeupdate', () => { if (vid.duration && vid.currentTime / vid.duration >= 0.9) mark(); });
      tryPlay();
    },
    recount() {
      const c = this.course;
      if (!c) return;
      const lessons = c.grouped && c.groups ? c.groups.flatMap((g) => g.lessons || []) : (c.lessons || []);
      const done = lessons.filter((l) => l.done).length;
      c.kp_done = done;
      c.kp_total = lessons.length;
      c.percent = lessons.length ? Math.round(done / lessons.length * 100) : 0;
      (c.groups || []).forEach((g) => {
        const n = (g.lessons || []).length;
        const d = (g.lessons || []).filter((l) => l.done).length;
        g.kp_done = d;
        g.kp_total = n;
        g.percent = n ? Math.round(d / n * 100) : 0;
      });
    },
    async downloadDoc(id) {
      let d;
      try { d = await api('/api/stu/handouts/' + id + '/download'); }
      catch (e) { toast(e.message || '下载失败，请稍后重试', 'err'); return; }
      if (!d || !d.key) { toast('文件不存在或已被删除', 'err'); return; }
      this.courses = null;
      downloadUrl(d.key, d.name);
    },
    async printDoc(id, title) {
      let d;
      try { d = await api('/api/stu/handouts/' + id + '/download'); }
      catch (e) { toast(e.message || '讲义加载失败，请稍后重试', 'err'); return; }
      if (!d || !d.key) { toast('文件不存在或已被删除', 'err'); return; }
      this.courses = null;
      if (!canPreview(d.name)) { toast('该格式暂不支持在线打印，已为你下载文件'); downloadUrl(d.key, d.name); return; }
      const wrap = document.createElement('div');
      wrap.className = 'mask print-mask';
      wrap.innerHTML = `<div class="print-box">
        <div class="print-h"><b>${esc(title || d.name)}</b>
          <div class="print-acts"><button class="kb kb-dl" id="pDl">下载</button><button class="kb kb-play" id="pDo">打印</button><button class="close-x">&times;</button></div>
        </div>
        <iframe class="print-frame" src="${fileUrl(d.key, '', true)}" title="讲义预览"></iframe>
      </div>`;
      document.body.appendChild(wrap);
      const close = () => wrap.remove();
      wrap.querySelector('.close-x').onclick = close;
      wrap.onclick = (e) => { if (e.target === wrap) close(); };
      wrap.querySelector('#pDl').onclick = () => downloadUrl(d.key, d.name);
      wrap.querySelector('#pDo').onclick = () => {
        const f = wrap.querySelector('.print-frame');
        try { f.contentWindow.focus(); f.contentWindow.print(); }
        catch (e) { toast('请在预览窗口中按 Ctrl + P 打印'); }
      };
    },
    async openReport() {
      let r;
      try { r = await api('/api/stu/report'); }
      catch (e) { toast(e.message || '学习报告加载失败，请稍后重试', 'err'); return; }
      if (!r) return;
      r.days = r.days || []; r.subjects = r.subjects || []; r.recent = r.recent || [];
      const maxDay = Math.max(1, ...r.days.map((x) => x.n));
      elDialog({
        title: '学习报告',
        wide: true,
        body: `<div class="rp-tiles">
          <div class="rp-tile"><div class="v">${r.kp_done}<span>/${r.kp_total}</span></div><div class="l">已学知识点</div></div>
          <div class="rp-tile"><div class="v">${r.percent}<span>%</span></div><div class="l">整体完成率</div></div>
          <div class="rp-tile"><div class="v">${r.handout_done}<span> 份</span></div><div class="l">已看讲义</div></div>
          <div class="rp-tile"><div class="v">${r.active_days}<span> 天</span></div><div class="l">累计学习天数</div></div>
        </div>
        <div class="rp-block"><div class="rp-h">总进度</div><div class="pbar lg"><i style="width:${r.percent}%"></i></div></div>
        <div class="rp-block"><div class="rp-h">分学科进度</div>
          ${r.subjects.length ? r.subjects.map((s) => `<div class="rp-row"><span class="nm">${esc(s.subject)}</span><div class="pbar"><i style="width:${s.percent}%"></i></div><span class="pct">${s.done}/${s.total}</span></div>`).join('') : '<div class="rp-empty">还没有学习记录</div>'}
        </div>
        <div class="rp-block"><div class="rp-h">最近 14 天</div>
          ${r.days.length ? `<div class="rp-chart">${r.days.map((x) => `<div class="rp-col" title="${esc(x.d)}"><i style="height:${Math.min(82, Math.max(6, Math.round(x.n / maxDay * 80)))}%"></i><span>${esc(String(x.d).slice(5))}</span></div>`).join('')}</div>` : '<div class="rp-empty">还没有学习记录</div>'}
        </div>`,
      });
    },
  },
  template: `
  <div v-if="page==='boot'" class="loading-page">加载中…</div>
  <div v-else-if="page==='login'" class="lg2-wrap">
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
        <!-- 地面投影 -->
        <ellipse cx="92" cy="142" rx="78" ry="10" fill="rgba(8,26,84,.28)"/>
        <ellipse cx="264" cy="144" rx="60" ry="9" fill="rgba(8,26,84,.22)"/>
        <ellipse cx="452" cy="152" rx="84" ry="11" fill="rgba(8,26,84,.30)"/>
        <!-- 叠放的两本书（下） -->
        <g transform="rotate(-5 92 120)">
          <rect x="22" y="102" width="140" height="34" rx="7" fill="url(#lg2bk1)" stroke="#1c3fa8" stroke-width="2"/>
          <rect x="31" y="108" width="122" height="11" rx="3" fill="#fff" opacity=".95"/>
          <path d="M37 115.5 h110 M41 119 h102" stroke="#c9d9f4" stroke-width="1.4"/>
          <path d="M50 128 h86" stroke="rgba(255,255,255,.75)" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        <!-- 叠放的两本书（上） -->
        <g transform="rotate(6 88 84)">
          <rect x="32" y="68" width="124" height="32" rx="7" fill="url(#lg2bk2)" stroke="#16308f" stroke-width="2"/>
          <rect x="40" y="73" width="108" height="10" rx="3" fill="#fff" opacity=".95"/>
          <path d="M46 80.5 h96 M50 84 h88" stroke="#d6e3f8" stroke-width="1.3"/>
          <circle cx="54" cy="90" r="3.5" fill="#fff" opacity=".9"/>
          <path d="M66 90 h70" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        <!-- 纸页（底部大卷角） -->
        <g transform="rotate(-4 258 82)">
          <path d="M204 24 h96 v100 l-22 20 h-74 z" fill="#fff" opacity=".98"/>
          <path d="M218 44 h60 M218 60 h60 M218 76 h60 M218 92 h40" stroke="#5b83d8" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M278 124 q-4 -14 0 -22 l22 22 h-22 z" fill="#dbe6f8"/>
          <path d="M278 124 h22" stroke="#9fb8e6" stroke-width="2.5"/>
          <path d="M276 124 q-2 -10 2 -18" stroke="#b9cdf0" stroke-width="2"/>
        </g>
        <!-- 支架平板 -->
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
        <!-- 星点点缀 -->
        <g fill="rgba(255,255,255,.6)">
          <circle cx="184" cy="26" r="3"/><circle cx="340" cy="20" r="2.5"/><circle cx="540" cy="26" r="3"/>
          <circle cx="566" cy="80" r="2.5"/><circle cx="580" cy="136" r="3"/><circle cx="320" cy="150" r="2.5"/>
        </g>
      </svg>
    </section>
    <section class="lg2-main">
      <div class="lg2-card-form">
        <div class="lg2-flogo"><img src="/img/logo.jpg" alt="智学课堂"><b>学生登录</b></div>
        <div v-if="loginErr" class="alert">{{ loginErr }}</div>
        <form @submit.prevent="onLogin">
          <div class="field"><label>账号</label>
            <input class="input" v-model="username" placeholder="请输入账号" autocomplete="username" required></div>
          <div class="field"><label>密码</label>
            <input class="input" v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" required></div>
          <button class="btn lg2-submit" type="submit" :disabled="loginBusy">{{ loginBusy ? '登录中…' : '登录' }}</button>
        </form>
        <p class="lg2-reg">如需注册，请联系工作人员协助开通</p>
      </div>
    </section>
  </div>
  <div v-else class="st-layout st-biz st-rail learn-shell" :class="{ 'learn-nav-open': mobileNavOpen, 'learn-is-home': page==='home' }">
    <button v-if="mobileNavOpen" class="learn-nav-shade" @click="mobileNavOpen=false" aria-label="关闭导航"></button>
    <aside class="st-side">
      <a class="sbrand" href="#/home" @click.prevent="goHome" title="智乐学学习空间"><img src="/img/ui-brand-20261108.png" alt=""><span class="learn-brand-text"><b>智乐学</b><em>学生端</em></span></a>
      <nav class="st-subj" aria-label="学习导航">
        <a href="#/home" :class="{ on: page==='home' }" :aria-current="page==='home' ? 'page' : null" @click.prevent="goHome"><span class="ic"><i class="ai ai-home"></i></span><span class="nt">学习空间</span></a>
        <a v-for="s in ['数学','英语','物理','化学']" :key="s" href="#/courses" :class="{ on: (page==='courses' || page==='course') && subject===s }" @click.prevent="pickSubject(s)">
          <span class="ic"><i class="ai" :class="'ai-'+(subjIcon[s]||'book')"></i></span><span class="nt">{{ s }}</span>
        </a>
        <a class="learn-nav-divider" href="#/papers" :class="{ on: page==='papers' }" @click.prevent="goBank('papers')"><span class="ic"><i class="ai ai-doc"></i></span><span class="nt">试卷</span></a>
        <a href="#/mistakes" :class="{ on: page==='mistakes' }" @click.prevent="goBank('mistakes')"><span class="ic"><i class="ai ai-list"></i></span><span class="nt">错题本</span><small v-if="mistCount" class="learn-mist-count">{{ mistCount }}</small></a>
      </nav>
      <nav class="learn-tools" aria-label="学习工具">
        <a href="#/words/quick" :class="{ on: inWords }" @click.prevent="goWords('quick')"><i class="ai ai-flash"></i>速记训练</a>
        <a href="#/timer" :class="{ on: page==='tool' }" @click.prevent="goTool"><i class="ai ai-clock"></i>专注计时</a>
      </nav>
      <div class="st-me" :title="user.name">
        <span class="st-me-name">{{ user.name }}</span>
        <button class="st-out" title="退出登录" @click="logout"><i class="ai ai-logout"></i><span>退出</span></button>
      </div>
    </aside>
    <div class="st-main">
    <header class="st-top">
      <button class="learn-menu" aria-label="打开学习导航" :aria-expanded="mobileNavOpen" @click="mobileNavOpen=!mobileNavOpen"><i class="ai ai-list"></i></button>
      <h1 v-if="page==='home'" class="learn-page-title">学习空间</h1>
      <div v-else class="st-tabs">
        <template v-if="inWords">
          <a v-for="g in wordGroups" :key="g.k" :class="{ on: curWordGroup && curWordGroup.k===g.k }" @click.prevent="goWords(g.subs[0])"><img v-if="g.img" class="wt-tab-ic" :src="g.img" alt=""><i v-else class="ai" :class="'ai-'+g.i"></i>{{ g.t }}</a>
        </template>
        <template v-else-if="page==='papers' || page==='mistakes'">
          <a v-if="page==='papers'" class="on st-page-title">试卷</a>
          <!-- 错题本：学科 tab 由 bank.js 渲染到顶栏这里的挂载点 -->
          <span v-if="page==='mistakes'" id="bkTabsMount"></span>
        </template>
        <template v-else-if="page!=='tool'">
          <a v-for="c in cats" :key="c" :class="{ on: category===c }" @click.prevent="pickCat(c)"><img v-if="catIcon[c]" class="wt-tab-ic" :src="catIcon[c]" alt="">{{ c }}<i v-if="counts[c]" class="n">{{ counts[c] }}</i></a>
        </template>
      </div>
      <div class="st-top-r">
        <button v-if="inWords" class="st-report learn-accent-btn" @click="toggleAccent" title="切换发音口音：美音(女声) / 英音(男声)"><i class="ai ai-volume"></i><span>{{ wtAccent==='uk' ? '英音' : '美音' }}</span></button>
        <button v-if="page!=='home'" class="st-report" @click="goTool" title="专注计时"><i class="ai ai-clock"></i><span>计时</span></button>
        <button class="st-report st-theme-btn" ref="themeBtn" title="切换显示主题" aria-label="切换显示主题" :class="{ on: themeOpen }" :aria-expanded="themeOpen" @click="toggleTheme">
          <i class="ai" :class="'ai-'+curTheme.ic"></i><span>{{ curTheme.t }}</span>
        </button>
        <button v-if="page!=='home'" class="st-mist-btn" :class="{ on: page==='mistakes' }" @click="goBank('mistakes')" title="错题本：做错的题都在这里，可重做和复习"><img src="/img/wt/g_mistake.png" alt=""><span>错题本</span><i v-if="mistCount" class="st-mist-n">{{ mistCount }}</i></button>
        <img class="learn-account" :src="avatar.src" :alt="avatar.name" :title="avatar.name">
      </div>
    </header>
    <div class="st-content wt-root" id="view" :class="{ 'wt-fluid': inWords, 'tool-full': page==='tool' }">
      <div v-if="loading" class="loading-page">加载中…</div>
      <div v-else-if="error" class="empty">{{ error }}</div>
      <section v-else-if="page==='home'" class="learn-home">
        <div class="learn-greeting"><h2>把今天的一小步，学扎实</h2><p>{{ homeSubtitle }}</p></div>
        <section class="learn-hero" aria-labelledby="learnHeroTitle">
          <div class="learn-hero-copy">
            <div class="learn-eyebrow"><i class="ai ai-book"></i>{{ homeCourse && homeCourse.kp_done ? '继续学习' : '开始学习' }}</div>
            <template v-if="homeCourse">
              <h2 id="learnHeroTitle">{{ homeCourse.name }}</h2>
              <p class="learn-next">{{ homeDetail && homeDetail.next ? homeDetail.next.title : (homeCourse.kp_total ? (homeCourse.kp_done >= homeCourse.kp_total ? '已学完本课程，可以继续练习巩固' : courseSub(homeCourse)) : '查看课程资料与配套练习') }}</p>
              <div class="learn-progress-row">
                <template v-if="homeCourse.kp_total"><span>已完成 <b>{{ homeCourse.kp_done }}</b> / {{ homeCourse.kp_total }} 课</span><progress :value="homeProgress" max="100" :aria-label="'课程完成 ' + homeProgress + '%'"></progress></template>
                <span v-else>暂无视频课程</span>
                <span class="learn-accuracy">练习正确率 <b :class="{ 'learn-no-rate': !(homeCourse.acc && homeCourse.acc.total && homeCourse.acc.rate !== null) }">{{ homeAccuracy }}</b></span>
              </div>
              <button class="learn-primary" @click="openCourse(homeCourse.id)"><i class="ai ai-play"></i>{{ homeCourse.kp_done ? '继续学习' : '进入课程' }}</button>
            </template>
            <template v-else>
              <h2 id="learnHeroTitle">{{ homeCourseError ? '课程暂时未能加载' : '准备好开始学习了吗' }}</h2>
              <p class="learn-next">{{ homeCourseError || '暂无可学习课程，开通后会显示在这里。' }}</p>
              <button class="learn-primary" @click="homeCourseError ? load() : pickSubject(subject)"><i class="ai" :class="homeCourseError ? 'ai-refresh' : 'ai-book'"></i>{{ homeCourseError ? '重新加载' : '查看课程' }}</button>
            </template>
          </div>
          <img class="learn-hero-art" src="/img/ui-learning-hero-20261108.png" alt="" aria-hidden="true">
        </section>
        <div class="learn-lower">
          <section class="learn-tasks" aria-labelledby="learnTaskTitle">
            <div class="learn-section-heading"><h2 id="learnTaskTitle"><i class="ai ai-doc"></i>我的任务</h2><a href="#/papers" @click.prevent="goBank('papers')">去试卷库找一份练习<i class="ai ai-arrow-right"></i></a></div>
            <div v-if="homeTaskError" class="learn-empty">{{ homeTaskError }}<button @click="load">重新加载</button></div>
            <div v-else-if="!homeTasks.length" class="learn-empty">暂无学习任务<span>老师布置的练习会显示在这里，也可以试试自主练习。</span></div>
            <article v-for="task in homeTasks.slice(0,3)" v-else :key="task.id" class="learn-task-row">
              <div class="learn-task-name"><h3>{{ task.title }}</h3><p>{{ [task.subject, task.q_count + ' 题'].filter(Boolean).join(' · ') }}</p><small v-if="task.due_at">{{ homeTaskDeadline(task) }}</small></div>
              <span class="learn-task-status" :class="{ done: task.tried }">{{ homeTaskStatus(task) }}</span>
              <button :class="task.tried ? 'learn-task-again' : 'learn-task-start'" @click="openHomeTask(task)">{{ task.tried ? '重新练习' : '开始练习' }}<i v-if="task.tried" class="ai ai-arrow-right"></i></button>
            </article>
            <a v-if="homeTasks.length>3" class="learn-all-tasks" href="#/papers" @click.prevent="goHomeTasks">按学科查看任务<i class="ai ai-arrow-right"></i></a>
          </section>
          <section class="learn-practice" aria-labelledby="learnPracticeTitle">
            <div class="learn-section-heading"><h2 id="learnPracticeTitle"><i class="ai ai-edit"></i>自主练习</h2></div>
            <button class="learn-practice-row" @click="goSelfPractice('textbook')"><i class="ai ai-folder"></i><span><b>章节组卷</b><small>按教材单元练习</small></span><i class="ai ai-arrow-right"></i></button>
            <button class="learn-practice-row" @click="goSelfPractice('knowledge')"><i class="ai ai-puzzle"></i><span><b>知识点组卷</b><small>针对薄弱点练习</small></span><i class="ai ai-arrow-right"></i></button>
          </section>
        </div>
      </section>
      <template v-else-if="page==='courses'">
        <div v-if="courseList.length" class="st-cards">
          <div v-for="c in courseList" :key="c.id" class="st-card" :class="['st-'+c.subject, 'cat-'+c.category]" @click="openCourse(c.id)">
            <div class="sc-face">
              <b class="sc-title">{{ c.name }}</b>
              <div class="sc-meta">{{ courseSub(c) || '通用课程' }}</div>
              <span v-if="c.category" class="cat-pill">{{ c.category }}</span>
              <span class="sc-enter">进入</span>
              <i class="sc-deco"></i>
            </div>
            <div class="sc-prog">
              <div class="fb-top"><span>知识点进度</span><b :class="{ full: c.percent>=100 }">{{ c.kp_total ? (c.kp_done+' / '+c.kp_total) : '—' }}</b></div>
              <div class="pbar"><i :style="{ width: (c.percent||0)+'%' }"></i></div>
              <div class="r8-sc-acc" :class="accCls(c.acc)"><span>习题正确率</span><b>{{ c.acc && c.acc.total ? (c.acc.rate === null ? '未做' : c.acc.rate + '%') : '暂无习题' }}</b><em v-if="c.acc && c.acc.answered">已做 {{ c.acc.answered }} / {{ c.acc.total }} 题</em></div>
            </div>
          </div>
        </div>
        <div v-else class="empty">暂无课程</div>
      </template>
      <template v-else-if="page==='course' && course">
        <div class="st-backbar" :class="'st-'+course.subject">
          <button class="st-back" @click="goCourses"><i class="ai ai-arrow-left"></i> 返回</button>
          <div class="bb-tt"><b>{{ course.name }}</b><span>{{ [course.subject, course.category, courseSub(course)].filter(Boolean).join(' · ') }}</span></div>
          <div class="bb-prog r8-bb-prog">
            <div class="r8-bb-cell">
              <div class="fb-top"><span>进度</span><b :class="{ full: course.percent>=100 }">{{ course.kp_done }} / {{ course.kp_total }}</b></div>
              <div class="pbar"><i :style="{ width: (course.percent||0)+'%' }"></i></div>
            </div>
            <div class="r8-bb-cell r8-bb-acc" :class="accCls(course.acc)">
              <div class="fb-top"><span>正确率</span><b>{{ course.acc && course.acc.total ? (course.acc.rate === null ? '未做' : course.acc.rate + '%') : '—' }}</b></div>
              <div class="pbar"><i :style="{ width: ((course.acc && course.acc.rate) || 0)+'%' }"></i></div>
            </div>
          </div>
        </div>
        <div class="r8-hero" :class="'st-'+course.subject">
          <div class="r8-hero-ring" :style="{ '--p': course.kp_total ? Math.round(course.kp_done / course.kp_total * 100) : 0 }">
            <div><b>{{ course.kp_done }}<small> / {{ course.kp_total }}</small></b><span>知识点掌握</span></div>
          </div>
          <div class="r8-hero-stats">
            <div class="r8-hs" :class="accCls(course.acc)"><span>习题正确率</span><b>{{ course.acc && course.acc.total ? (course.acc.rate === null ? '未做' : course.acc.rate + '%') : '—' }}</b><em>{{ course.acc && course.acc.total ? '已做 ' + course.acc.answered + ' / ' + course.acc.total + ' 题' : '暂无可自动判分的习题' }}</em></div>
            <div class="r8-hs"><span>学习进度</span><b>{{ course.percent || 0 }}%</b><em>已学 {{ course.kp_done }} / {{ course.kp_total }} 个视频</em></div>
          </div>
          <div class="r8-hero-go">
            <button class="r8-go-btn" type="button" :disabled="!course.kp_total" @click="continueLearn"><i class="ai ai-play"></i>{{ course.next ? '继续学习' : '再学一遍' }}</button>
            <div class="r8-go-next" :title="course.next ? course.next.title : ''">{{ course.next ? '即将学习：「' + course.next.title + '」' : (course.kp_total ? '全部视频都学完了，可以做练习巩固' : '暂无视频') }}</div>
          </div>
        </div>
        <div class="st-sec">
          <div class="sec-h"><b>知识点</b><span v-if="course.acc && course.acc.total" class="t6-acc-sum">习题正确率 {{ course.acc.rate === null ? '未做' : course.acc.rate + '%' }}（已做 {{ course.acc.answered }} / {{ course.acc.total }} 题）</span></div>
          <div v-if="course.grouped && course.groups && course.groups.length" class="kp-layout">
            <aside class="kp-side">
              <a v-for="g in course.groups" :key="g.id" class="kp-side-item r8-gside" :class="{ on: activeGroup && activeGroup.id===g.id }" @click.prevent="activeGroupId=g.id">
                <span class="gs-name" :title="g.name">{{ g.name }}</span>
                <span class="r8-gs-meta">已学 {{ g.kp_done }}/{{ g.kp_total }}<i></i>正确率 <b :class="accCls(g.acc)">{{ g.acc && g.acc.total ? (g.acc.rate === null ? '未做' : g.acc.rate + '%') : '—' }}</b></span>
                <button v-if="g.id && g.practice_count" class="r8-gs-btn" type="button" @click.stop.prevent="doSectionPractice(g)"><i class="ai ai-doc"></i>小分组练习（{{ g.practice_count }} 题）</button>
              </a>
            </aside>
            <div class="kp-list kp-main-list">
              <div v-for="(l, i) in activeGroupLessons" :key="l.video_id" class="kp-box" :class="{ done: l.done }">
                <div class="kp-idx">{{ String(i+1).padStart(2,'0') }}</div>
                <div class="kp-main">
                  <div class="kp-tt"><b>{{ l.title }}</b><span class="kp-state">{{ l.done ? '✓ 已学完' : '未学习' }}</span><span v-if="l.acc && l.acc.total" class="t6-acc" :class="accCls(l.acc)" :title="'已做 '+l.acc.answered+' / '+l.acc.total+' 题，最近一次答对 '+l.acc.correct+' 题'">{{ accText(l.acc) }}</span></div>
                  <div v-if="l.nodes && l.nodes.length" class="r8-ktags"><span class="r8-ktags-l">知识点</span><button v-for="n in l.nodes" :key="n.id" type="button" class="r8-ktag" :title="'查看「'+n.name+'」的掌握情况'" @click="showNodeMastery(n)">{{ n.name }}</button></div>
                  <div v-if="l.handout" class="kp-doc"><i class="doc-dot"></i><span class="dl">讲义：</span><span class="dn">{{ l.handout.title }}</span><span class="ds">{{ fmtSize(l.handout.size) }}</span></div>
                  <div v-else class="kp-doc off"><i class="doc-dot"></i>暂无配套讲义</div>
                  <div class="kp-acts">
                    <button class="kb kb-play" @click="playVideo(l)"><i class="ai ai-play"></i> 播放</button>
                    <button v-if="l.handout" class="kb kb-print" @click="printDoc(l.handout.id, l.handout.title)"><i class="ai ai-print"></i> 讲义</button>
                    <button v-if="l.qcount" class="kb kb-quiz" @click="doPractice(l)"><i class="ai ai-doc"></i> 练习<span class="kb-n">{{ l.qcount }}</span></button>
                  </div>
                </div>
              </div>
              <div v-if="!activeGroupLessons.length" class="ch-empty">暂无知识点</div>
            </div>
          </div>
          <div v-else-if="course.lessons && course.lessons.length" class="kp-list">
            <div v-for="(l, i) in course.lessons" :key="l.video_id" class="kp-box" :class="{ done: l.done }">
              <div class="kp-idx">{{ String(i+1).padStart(2,'0') }}</div>
              <div class="kp-main">
                <div class="kp-tt"><b>{{ l.title }}</b><span class="kp-state">{{ l.done ? '✓ 已学完' : '未学习' }}</span><span v-if="l.acc && l.acc.total" class="t6-acc" :class="accCls(l.acc)" :title="'已做 '+l.acc.answered+' / '+l.acc.total+' 题，最近一次答对 '+l.acc.correct+' 题'">{{ accText(l.acc) }}</span></div>
                  <div v-if="l.nodes && l.nodes.length" class="r8-ktags"><span class="r8-ktags-l">知识点</span><button v-for="n in l.nodes" :key="n.id" type="button" class="r8-ktag" :title="'查看「'+n.name+'」的掌握情况'" @click="showNodeMastery(n)">{{ n.name }}</button></div>
                <div v-if="l.handout" class="kp-doc"><i class="doc-dot"></i><span class="dl">讲义：</span><span class="dn">{{ l.handout.title }}</span><span class="ds">{{ fmtSize(l.handout.size) }}</span></div>
                <div v-else class="kp-doc off"><i class="doc-dot"></i>暂无配套讲义</div>
                <div class="kp-acts">
                  <button class="kb kb-play" @click="playVideo(l)"><i class="ai ai-play"></i> 播放</button>
                  <button v-if="l.handout" class="kb kb-print" @click="printDoc(l.handout.id, l.handout.title)"><i class="ai ai-print"></i> 讲义</button>
                  <button v-if="l.qcount" class="kb kb-quiz" @click="doPractice(l)"><i class="ai ai-doc"></i> 练习<span class="kb-n">{{ l.qcount }}</span></button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="ch-empty">暂无知识点</div>
        </div>
        <div class="st-sec">
          <div class="sec-h"><b>配套练习</b></div>
          <div v-if="course.exercises && course.exercises.length" class="ex-list">
            <div v-for="h in course.exercises" :key="h.id" class="ex-row">
              <div class="doc-ic" :class="fileKind(h.file_name).cls">{{ fileKind(h.file_name).txt }}</div>
              <div class="ex-info"><b>{{ h.title }}</b><span>{{ fmtSize(h.size) }}</span></div>
              <div class="ex-acts">
                <button v-if="canPreview(h.file_name)" class="kb kb-print" @click="printDoc(h.id, h.title)"><i class="ai ai-print"></i> 打印</button>
                <button class="kb kb-dl" @click="downloadDoc(h.id)"><i class="ai ai-download"></i> 下载</button>
              </div>
            </div>
          </div>
          <div v-else class="ch-empty">暂无习题</div>
        </div>
      </template>
      <div v-else-if="page==='tool'" class="tool-page">
        <iframe class="tool-frame" src="/apps/timer.html" title="计时"></iframe>
      </div>
      <div v-else-if="page==='papers' || page==='mistakes'" class="bank-host" :id="page + 'Host'"></div>
      <div v-else-if="page==='words'" class="wt-layout" :class="{ 'side-closed': sideSubs.length>1 && !wtSideOpen }">
        <aside class="wt-sidenav" v-if="sideSubs.length>1 && wtSideOpen">
          <div class="wt-side-bar"><button class="wt-side-fold" type="button" title="收起导航" @click="toggleWtSide(false)"><i class="ai ai-arrow-left"></i></button></div>
          <a v-for="s in sideSubs" :key="s.k" :class="{ on: wordSub===s.k }" @click.prevent="goWords(s.k)"><img v-if="s.img" class="wt-side-ic" :src="s.img" alt=""><i v-else class="ai" :class="'ai-'+(s.i||'flash')"></i>{{ s.t }}</a>
        </aside>
        <button v-if="sideSubs.length>1 && !wtSideOpen" class="wt-side-unfold" type="button" title="展开导航" @click="toggleWtSide(true)"><i class="ai ai-arrow-right"></i></button>
        <words-pane ref="wordsPane" :sub="wordSub"></words-pane>
      </div>    </div>
    </div>
    <teleport to="body">
      <div v-if="themeOpen" class="theme-menu" :style="themeStyle" @click.stop>
        <div class="theme-menu-h"><b>选择主题</b><button class="tm-close" type="button" @click="themeOpen=false">×</button></div>
        <div class="theme-menu-list">
          <button v-for="t in themeList" :key="t.k" type="button" class="tm-item" :class="{ on: theme===t.k }" @click="pickTheme(t.k)">
            <span class="tm-sw" :class="'sw-'+t.k"><i></i><i></i><i></i></span>
            <span class="tm-tt"><b><i class="ai" :class="'ai-'+t.ic"></i> {{ t.t }}</b><em>{{ t.d }}</em></span>
            <span class="tm-ck">✓</span>
          </button>
        </div>
      </div>
    </teleport>
  </div>`,
};

Vue.createApp(App).mount('#app');
