'use strict';
/**
 * 前端渲染自测：用 jsdom 真实加载页面并执行前端 JS，验证各视图能正常渲染。
 *
 * 需要额外安装 jsdom（不属于运行依赖，仅在开发自测时使用）：
 *   npm install -D jsdom
 * 运行（需先启动服务，并已 npm run seed）：
 *   node ui-test.js
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

const errors = [];

async function boot(path, { token, user, hash, fresh } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (!/Could not parse CSS|Not implemented|Could not load/.test(e.message)) errors.push(path + ': ' + e.message);
  });
  vc.on('error', (...a) => errors.push(path + ' [console.error]: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.fetch = (url, opts) => {
        const u = typeof url === 'string' && url.startsWith('/') ? BASE + url : url;
        return fetch(u, opts);
      };
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      win.alert = () => {};
      win.confirm = () => true;
      win.open = () => null;
      win.print = () => {};
      win.Element.prototype.scrollIntoView = () => {};
      win.HTMLMediaElement.prototype.play = () => Promise.resolve();
      win.HTMLMediaElement.prototype.pause = () => {};
    },
  });
  if (token) {
    dom.window.localStorage.setItem((dom.window.STORAGE_PREFIX || 'xuexi') + '_token', token);
    dom.window.localStorage.setItem((dom.window.STORAGE_PREFIX || 'xuexi') + '_user', JSON.stringify(user || {}));
    // 模拟「已在使用中的会话」，否则学生端新会话兜底会强制回到课程首页
    if (!fresh) dom.window.sessionStorage.setItem((dom.window.STORAGE_PREFIX || 'xuexi') + '_seen', '1');
  }
  if (hash) dom.window.location.hash = hash;
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (dom) => dom.window.document.body.textContent || '';
const json = async (path, opts) => (await fetch(BASE + path, opts)).json();

async function adminPost(path, token, body) {
  return json(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
}

(async () => {
  console.log('\n=== 前端渲染自测（jsdom） ===\n');

  const aLogin = await json('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zlx-ci-admin', password: '123456', role: 'admin' }),
  });
  let sLogin = await json('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '13800000001', password: '123456', role: 'student' }),
  });
  // 演示学生可能被删除：自建一个临时学生（年级与示例课程匹配，跑完清理）
  let tempStu = null;
  if (!sLogin.data && aLogin.data) {
    tempStu = 'UISTU' + Date.now().toString().slice(-6);
    await adminPost('/api/admin/students', aLogin.data.token, {
      name: 'UI测试学生', username: tempStu, password: '123456', grade: '七年级', expire_at: '2027-12-31',
    });
    sLogin = await json('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: tempStu, password: '123456', role: 'student' }),
    });
  }
  if (!aLogin.data || !sLogin.data) { console.log('无法登录，请先启动服务并 npm run seed'); process.exit(1); }
  const SH = { headers: { Authorization: 'Bearer ' + sLogin.data.token } };

  // ---------- 学生端 ----------
  console.log('【学生端页面渲染】');
  let dom = await boot('/');
  await wait(1500);
  log(text(dom).includes('智学课堂') && text(dom).includes('登 录'), '登录页渲染');
  log(!!dom.window.document.querySelector('input[name="password"]'), '登录表单存在');
  dom.window.close();

  dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/courses' });
  await wait(1800);
  const doc = dom.window.document;
  let body = text(dom);
  log(!!doc.querySelector('#btnSet') && doc.querySelector('#btnSet').textContent.includes('设置'), '顶栏「设置」按钮渲染');
  const wtHome = doc.querySelector('[data-wordhome]');
  log(!!wtHome && wtHome.textContent.includes('速记') && !wtHome.textContent.includes('单词记忆'), '左侧第一目录为「速记」（单词记忆已改名）');
  log(doc.querySelectorAll('[data-wordsub]').length === 0 && doc.querySelectorAll('.st-tabs [data-cat]').length === 4,
    '课程页顶栏只显示课程分类（速记模块不混入）');
  log(text(dom).includes('同步基础') && !text(dom).includes('单词速记'), '课程页不出现速记模块的二级入口');
  const subjA = [...doc.querySelectorAll('.st-subj a')];
  log(subjA.length === 4 && subjA[0].textContent.includes('英语') && subjA[1].textContent.includes('数学'),
    '左侧学科 4 项，英语与数学已互换位置（英语在前）',
    subjA.map((a) => a.textContent.trim()).join('、'));
  log(doc.querySelectorAll('.st-tabs a').length === 4, '顶部课程二级目录 4 项（同步基础/同步培优/专项提升/中考冲刺）',
    [...doc.querySelectorAll('.st-tabs a')].map((a) => a.textContent.trim().replace(/\d+$/, '')).join('、'));
  log(body.includes('同步基础') && body.includes('同步培优') && body.includes('专项提升') && body.includes('中考冲刺')
    && !body.includes('专项提升·小学') && !body.includes('专项提升·初中'), '四大类型全部显示（专项提升已合并，小学/初中按学段自动区分）');
  log(!!doc.querySelector('#btnSet'), '顶栏设置按钮可打开主题、说明和报告');
  // 侧栏「我的」：随机头像 + 年级挪到改密码位置 + 无改密码 + 退出放大
  const me = doc.querySelector('.st-me');
  log(!!me && !!me.querySelector('.avatar.av-rand') && !/^[\\u4e00-\\u9fa5]$/.test(me.querySelector('.avatar').textContent.trim()),
    '侧栏头像是随机生成的（emoji 吉祥物 + 随机渐变色，非姓名首字）',
    me ? me.querySelector('.avatar').textContent.trim() : '');
  const gradeEl = doc.querySelector('.st-me-grade');
  log(!!gradeEl && gradeEl.textContent.includes('七年级上册'), '「七年级上册」显示在侧栏头像下方（原改密码位置）');
  log(!doc.querySelector('#btnPwd') && !me.textContent.includes('改密码'), '侧栏不再有「改密码」入口');
  log(!!doc.querySelector('#btnOut.st-out'), '「退出登录」放大成胶囊按钮');
  log(!doc.querySelector('.st-top .st-grade'), '顶栏右上角不再显示「七年级上册 · 姓名」');
  log(!doc.querySelector('#btnSfx'), '顶栏不再有音效开关（音效默认开启，无需设置）');

  // 主题：日间 / 夜间 / 护眼 / 豆沙绿（改 body[data-theme]，日间不挂属性）
  log(!doc.body.hasAttribute('data-theme'), '默认「日间」主题：body 不挂 data-theme');
  doc.getElementById('btnSet').click();
  await wait(200);
  const tmItems = [...doc.querySelectorAll('[data-theme-pick]')];
  log(tmItems.length === 4 && tmItems.map((b) => b.dataset.themePick).join(',') === 'day,night,eye,green',
    '主题菜单弹出 4 套主题（日间/夜间/护眼/豆沙绿）', tmItems.map((b) => b.textContent.trim().replace(/\s+/g, ' ')).join(' | '));
  log(doc.querySelectorAll('.theme-menu .tm-sw').length === 4, '每个主题都有配色预览色块');
  tmItems.find((b) => b.dataset.themePick === 'night').click();
  await wait(200);
  log(doc.body.getAttribute('data-theme') === 'night', '选「夜间」→ body[data-theme=night]');
  log(!doc.querySelector('.theme-menu'), '选完主题后菜单自动关闭');
  log(dom.window.localStorage.getItem('xuexi_theme') === 'night', '主题选择写入 localStorage（全局 key，登录页也跟随）');
  doc.getElementById('btnSet').click();
  await wait(200);
  doc.querySelector('[data-theme-pick="eye"]').click();
  await wait(200);
  log(doc.body.getAttribute('data-theme') === 'eye' && !!doc.getElementById('eyeMask'),
    '选「护眼」→ 暖色低蓝光膜 eyeMask 出现');
  doc.getElementById('btnSet').click();
  await wait(200);
  doc.querySelector('[data-theme-pick="green"]').click();
  await wait(200);
  log(doc.body.getAttribute('data-theme') === 'green' && !doc.getElementById('eyeMask'),
    '选「豆沙绿」→ 切换主题色且撤掉护眼膜');
  doc.getElementById('btnSet').click();
  await wait(200);
  doc.querySelector('[data-theme-pick="day"]').click();
  await wait(200);
  log(!doc.body.hasAttribute('data-theme'), '切回「日间」→ body 移除 data-theme，恢复原始配色');
  log(!!doc.querySelector('.st-side .sbrand .sb-mark'), '左侧栏品牌图标已美化（方形标识）');
  log(doc.querySelectorAll('.st-subj a .ic').length === 4 && !!doc.querySelector('.st-card .head .wm'),
    '学科图标与课程卡片水印渲染（学生端 v5 美化）');
  log(!body.includes('我的课程') && !body.includes('讲义中心') && !body.includes('错题本') && !body.includes('章节练习'), '已移除「我的课程 / 讲义中心 / 做题」入口');
  log(doc.querySelectorAll('.st-card').length > 0, '课程卡片渲染', doc.querySelectorAll('.st-card').length + ' 张');
  log(doc.querySelectorAll('.st-card .pbar').length > 0, '课程卡片用「知识点学习进度条」');
  log(!body.includes('视频 1 讲') && !body.includes('讲义 1 份'), '卡片不再显示「视频N讲·讲义N份」');
  const subjActive = doc.querySelector('.st-subj a.on');
  log(!!subjActive && subjActive.textContent.includes('英语'), '默认选中英语（一级目录第一位，已与数学互换）');

  // 切换学科 + 切换分类
  const engTab = [...doc.querySelectorAll('.st-subj a')].find((a) => a.textContent.includes('数学'));
  engTab.click();
  await wait(1200);
  log(text(dom).includes('数学'), '切换到数学学科');
  const sprintTab = [...doc.querySelectorAll('.st-tabs a')].find((a) => a.textContent.includes('中考冲刺'));
  sprintTab.click();
  await wait(1200);
  log(!!doc.querySelector('.st-tabs a.on') && doc.querySelector('.st-tabs a.on').textContent.includes('中考冲刺'), '切换到中考冲刺分类');

  // 学习报告弹窗
  doc.getElementById('btnSet').click();
  await wait(200);
  doc.querySelector('[data-set="report"]').click();
  await wait(1200);
  log(text(dom).includes('我的学习报告'), '学习报告弹窗打开');
  log(doc.querySelectorAll('.rp-tile').length === 4, '学习报告 4 个统计指标');
  log(doc.querySelectorAll('.rp-block').length >= 3, '学习报告含总进度 / 分学科 / 每日记录');
  log(!!doc.querySelector('.rp-row .pbar'), '学习报告分学科进度条渲染');

  // 速记弹层：点侧栏「速记」→ 全屏弹层（不跳页面），✕ 关闭后回到原页面
  const hashBefore = dom.window.location.hash;
  doc.querySelector('[data-wordhome]').click();
  await wait(2000);
  log(!!doc.querySelector('#wtLayer'), '点侧栏「速记」打开全屏弹层（不跳页面）');
  log((dom.window.location.hash || '') === '#/words/quick', '弹层打开（地址同步为速记模块，模块内换词书/单元不会误关弹层）', dom.window.location.hash);
  log(!!doc.querySelector('#wtLayerView #wtBook') || text(dom).includes('还没有'), '弹层里渲染出速记模块（词书 / 单元选择或空态提示）');
  log(doc.querySelectorAll('#wtLayerTabs [data-wordsub]').length === 7, '弹层顶栏可切 7 个速记子模块');
  const phTab = [...doc.querySelectorAll('#wtLayerTabs [data-wordsub]')].find((a) => a.dataset.wordsub === 'phrase');
  if (phTab) phTab.click();
  await wait(1500);
  log((dom.window.location.hash || '').includes('words/phrase'), '弹层内切到短语速记（hash 跟随）', dom.window.location.hash);
  const closeBtn = doc.querySelector('#wtLayerClose');
  if (closeBtn) closeBtn.click();
  await wait(1500);
  log(!doc.querySelector('#wtLayer'), '点「✕ 关闭」收起弹层');
  log((dom.window.location.hash || '') === hashBefore, '关闭后回到原页面地址', dom.window.location.hash);
  log(!!doc.querySelector('.st-tabs [data-cat]'), '关闭弹层后底层课程页恢复渲染');

  // 从速记跳走时必须收起全屏学习舞台（否则 wt-stage 残留：内容区 fixed、顶栏隐藏、「学习中」浮条挂在别的页面上）
  if (typeof dom.window.wtStageOn === 'function') {
    dom.window.location.hash = '#/words/quick';   // 先进页内速记（模拟刷新后停留在速记的形态）
    await wait(1500);
    dom.window.wtStageOn();
    log(doc.body.classList.contains('wt-stage') && !!doc.querySelector('.wt-stage-bar'), '全屏学习舞台开启（body.wt-stage + 浮条）');
    dom.window.location.hash = '#/courses';       // 再从速记跳去课程页
    await wait(1500);
    log(!doc.body.classList.contains('wt-stage'), '从速记跳到课程页后 wt-stage 被收起', doc.body.className);
    log(!doc.querySelector('.wt-stage-bar'), '跳走后「学习中」浮条不再残留');
    log(doc.querySelector('.st-top') && dom.window.getComputedStyle(doc.querySelector('.st-top')).visibility !== 'hidden', '跳走后顶栏恢复可见');
  }
  dom.window.close();

  // ---------- 课程详情 ----------
  const cList = await json('/api/stu/courses?subject=' + encodeURIComponent('数学'), SH);
  let target = null;
  for (const c of cList.data || []) {
    const d = await json('/api/stu/course-detail?id=' + c.id, SH);
    const dd = d.data || {};
    if (dd.lessons && dd.lessons[0] && dd.lessons[0].handout && /\.html?$/i.test(dd.lessons[0].handout.file_name) && (dd.exercises || []).length) { target = dd; break; }
  }
  if (!target) { console.log('  ⚠️  未找到含讲义与习题的示例课程，请先 npm run seed'); }
  else {
    dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/course/' + target.id });
    await wait(1800);
    const d2 = dom.window.document;
    body = text(dom);
    log(body.includes('返回'), '课程详情页返回条渲染');
    log(body.includes('知识点学习'), '知识点区块渲染');
    log(d2.querySelectorAll('.kp-box').length === target.lessons.length, '知识点框数量正确', d2.querySelectorAll('.kp-box').length + ' 个');
    log(!!d2.querySelector('.kp-box .kp-doc'), '讲义与视频放在同一个框里');
    log(d2.querySelectorAll('.kp-box [data-play]').length === target.lessons.length, '每个知识点都有「播放视频」按钮');
    log(d2.querySelectorAll('.kp-box [data-print]').length === target.lessons.length, '每个知识点都有「打印讲义」按钮');
    log(!d2.querySelector('.kp-box .hos-list'), '讲义不再单独放在视频下面');
    log(body.includes('本章习题库'), '本章习题库区块渲染');
    log(d2.querySelectorAll('.ex-row').length === target.exercises.length, '习题库条目渲染', d2.querySelectorAll('.ex-row').length + ' 条');
    log(!!d2.querySelector('.bb-prog .pbar'), '详情页顶部进度条渲染');

    // 分级目录：折叠分组，点击标题才展开
    if (target.grouped && (target.groups || []).length) {
      log(d2.querySelectorAll('.kp-group').length === target.groups.length, '分级目录分组渲染',
        d2.querySelectorAll('.kp-group').length + ' 组 / 数据 ' + target.groups.length + ' 组');
      log(d2.querySelectorAll('.kp-group.open').length === 0, '分组默认折叠（学生点击才展开）');
      const gh = d2.querySelector('.kp-group-h');
      gh.click();
      await wait(400);
      log(d2.querySelectorAll('.kp-group.open').length === 1, '点击分组标题后展开');
      log(!!d2.querySelector('.kp-group.open .kp-box'), '展开后能看到该分组的知识点');
      log((d2.querySelector('.kp-group-h .g-meta') || {}).textContent.includes('/'), '分组标题显示知识点进度');
      d2.querySelector('.kp-group.open .kp-group-h').click();
      await wait(400);
      log(d2.querySelectorAll('.kp-group.open').length === 0, '再次点击可收起');
      const foldBtn = d2.querySelector('#btnFold');
      if (foldBtn) {
        foldBtn.click();
        await wait(400);
        log(d2.querySelectorAll('.kp-group.open').length === target.groups.length, '「全部展开」按钮生效');
      }
    } else {
      log(d2.querySelectorAll('.kp-groups').length === 0, '章节未设分级目录时保持平铺列表');
    }

    // 播放视频 → 弹窗播放器 + 倍速
    d2.querySelector('.kp-box [data-play]').click();
    await wait(1600);
    log(!!d2.querySelector('.video-box .player-wrap'), '点击「播放视频」后播放器出现');
    log(d2.querySelectorAll('.video-box .spd-b').length === 5, '允许倍速时提供 5 档倍速按钮');
    // 播放器的 src 必须带登录票据：<video> 由浏览器直连发起，加不了 Authorization 头，
    // 少了 token /api/file 会 401，学生端表现为「点了播放，视频出不来」
    const stV1 = d2.querySelector('.video-box #stVideo');
    const stSrc = stV1 ? String(stV1.getAttribute('src') || '') : '';
    const isLocal = stSrc.indexOf('/api/file?') === 0;
    log(!!stSrc && (!isLocal || /[?&]token=/.test(stSrc)),
      isLocal ? '播放器 video 的 src 自带登录票据' : '播放器 video 的 src 是外链（原样使用）',
      stSrc.replace(/token=[^&]+/, 'token=***'));
    const wt = dom.window.withTicket;
    log(typeof wt === 'function' && /[?&]token=[^&]+$/.test(wt('/api/file?key=a%2Fb.mp4')), 'withTicket 会给出后端代理地址补票据');
    log(wt('https://media.w3.org/a.mp4') === 'https://media.w3.org/a.mp4', 'withTicket 不动外链地址');
    log(wt('/api/file?key=a&token=x') === '/api/file?key=a&token=x', 'withTicket 不会重复补票据');
    log(!text(dom).includes('未开启快进'), '默认允许快进时不显示限制提示');

    // 打印讲义 → 打印预览弹窗
    d2.querySelector('.kp-box [data-print]').click();
    await wait(1600);
    log(!!d2.querySelector('.print-box .print-frame'), '点击「打印讲义」打开打印预览');
    log(!!d2.querySelector('#pDo'), '打印预览带「打印」按钮');
    log(!!d2.querySelector('#pDl'), '打印预览带「下载」按钮');
    dom.window.close();

    // 关闭倍速后：播放器不提供倍速
    await adminPost(`/api/admin/students/${sLogin.data.user.id}/speed`, aLogin.data.token, { allow_speed: 0 });
    dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/course/' + target.id });
    await wait(1800);
    const d3 = dom.window.document;
    const pb = d3.querySelector('.kp-box [data-play]');
    if (pb) pb.click();
    await wait(1600);
    log(d3.querySelectorAll('.video-box .spd-b').length === 0, '关闭倍速后无倍速按钮');
    log(text(dom).includes('未开启倍速'), '关闭倍速后提示文案出现');
    dom.window.close();
    await adminPost(`/api/admin/students/${sLogin.data.user.id}/speed`, aLogin.data.token, { allow_speed: 1 });

    // 快进已全站放开：不再有开关，学生端也不出现任何限制提示
    const seekGone = await adminPost(`/api/admin/students/${sLogin.data.user.id}/seek`, aLogin.data.token, { allow_seek: 0 });
    log(seekGone.code !== 0, '快进开关接口已下线（返回非 0）', 'code=' + seekGone.code);
    dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/course/' + target.id });
    await wait(1800);
    const d4 = dom.window.document;
    const pb4 = d4.querySelector('.kp-box [data-play]');
    if (pb4) pb4.click();
    await wait(1600);
    log(!text(dom).includes('未开启快进') && !text(dom).includes('请按顺序观看'), '播放器不再出现任何快进限制提示');
    const v4 = d4.querySelector('.video-box #stVideo');
    if (v4) {
      try {
        v4.currentTime = 60;
        v4.dispatchEvent(new dom.window.Event('seeking'));
        await wait(150);
        log(v4.currentTime === 60, '快进不再被拉回（学生可自由拖动进度条）', 'currentTime=' + v4.currentTime);
      } catch (e) { log(false, '模拟快进', e.message); }
    } else { log(false, '未找到播放器 video 元素'); }
    dom.window.close();
  }

  // ---------- 学生端：分级目录折叠展开 ----------
  console.log('\n【学生端分级目录（折叠）】');
  let gCourse = null;
  for (const c of cList.data || []) {
    const d = await json('/api/stu/course-detail?id=' + c.id, SH);
    if (d.data && d.data.grouped && (d.data.groups || []).length >= 2) { gCourse = d.data; break; }
  }
  if (!gCourse) console.log('  ⚠️  未找到含分级目录的课程，请先 npm run seed');
  else {
    dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/course/' + gCourse.id });
    await wait(1800);
    const gd = dom.window.document;
    log(gd.querySelectorAll('.kp-group').length === gCourse.groups.length, '分级目录分组渲染',
      gd.querySelectorAll('.kp-group').length + ' 组（' + gCourse.groups.map((g) => g.name).join(' / ') + '）');
    log(gd.querySelectorAll('.kp-group.open').length === 0, '分组默认全部折叠，学生点击才展开');
    const gh = gd.querySelector('.kp-group-h');
    gh.click();
    await wait(400);
    log(gd.querySelectorAll('.kp-group.open').length === 1, '点击分组标题 → 展开该分组');
    log(!!gd.querySelector('.kp-group.open .kp-box [data-play]'), '展开后能看到并播放该分组的知识点');
    log((gd.querySelector('.kp-group-h .g-meta') || {}).textContent.includes('/'), '分组标题带知识点进度');
    gh.click();
    await wait(400);
    log(gd.querySelectorAll('.kp-group.open').length === 0, '再次点击 → 收起');
    const fb = gd.querySelector('#btnFold');
    log(!!fb, '有「全部展开 / 全部收起」按钮');
    if (fb) {
      fb.click();
      await wait(400);
      log(gd.querySelectorAll('.kp-group.open').length === gCourse.groups.length, '「全部展开」一次展开所有分组');
      fb.click();
      await wait(400);
      log(gd.querySelectorAll('.kp-group.open').length === 0, '「全部收起」一次收起所有分组');
    }
    dom.window.close();
  }

  // ---------- 学生端：速记（独立模块，顶栏二级入口，四步学习流） ----------
  console.log('\n【学生端速记模块】');
  dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/words/quick' });
  await wait(2500);
  const wd = dom.window.document;
  const wBody = text(dom);
  log(wd.querySelectorAll('.st-tabs [data-wordsub]').length === 7, '速记页顶栏显示模块二级入口 7 项（含短语速记、考纲单词）',
    [...wd.querySelectorAll('.st-tabs [data-wordsub]')].map((a) => a.textContent.trim()).join('、'));
  log(wd.querySelectorAll('.st-tabs [data-cat]').length === 0, '速记页顶栏不再显示课程分类（独立模块）');
  log(wd.querySelectorAll('[data-wordhome]').length === 1, '左侧保留「速记」模块入口');
  log(!wBody.includes('[object Object]'), '页面没有 [object Object] 渲染错误');
  log(!!wd.querySelector('#wtBook'), '词书下拉选择渲染');
  const wtHead = wd.querySelector('.wt-head');
  log(!!wtHead && !!wtHead.querySelector('#wtBook') && !!wtHead.querySelector('#wtUnit') && !wtHead.textContent.includes('选择词书'),
    '词书和单元下拉直接放到「选择词书」卡片位置（标题让位给下拉）');
  // 单元必选：词书有单元时，未选单元不允许开练
  log(!!wd.querySelector('#wtUnit') && wd.querySelector('#wtUnit').value === '' && wBody.includes('请先在上方选择'),
    '单元必选：进入模块先提示「请先在上方选择单元」，不渲染练习区');
  const FORCE_UNIT = '(function(){const s=document.getElementById("wtUnit");if(s&&!s.value&&s.options[1]){s.value=s.options[1].value;s.onchange();}})()';
  dom.window.eval(FORCE_UNIT);
  await wait(1500);
  const wb2 = text(dom);  // 选完单元、分组渲染后的正文
  // 单词速记 = 分组 + 四步学习流（先勾选分组 → 进全屏学习舞台）
  const grps = [...wd.querySelectorAll('.wt-grp')];
  log(grps.length >= 1, '单词按分组展示（小学3-6年级 5 词/组，初中7-9年级 10 词/组）',
    grps.map((g) => g.textContent.trim()).join('、'));
  log(grps.some((g) => g.classList.contains('on')) && grps.every((g) => !g.classList.contains('done')),
    '默认勾选第一个未完成分组，未完成分组为灰色');
  log(!!wd.querySelector('.wq-grp-tip'), '分组条下方有练习说明（每组从单词学习开始，做完变绿）');
  // 单元选好后先停在「勾选分组」页，不自动进全屏（否则点退出会被立刻弹回去）
  log(!dom.window.eval('document.body.classList.contains("wt-stage")') && wb2.includes('点上面任意一个'),
    '未勾选分组时不自动进入全屏学习，提示先点分组');
  const steps = [...wd.querySelectorAll('.wt-step')];
  log(steps.length === 4, '单词速记含 4 个学习步骤',
    steps.map((a) => a.textContent.trim()).join(' → '));
  log(steps.length === 4 && steps[0].textContent.includes('单词学习') && steps[1].textContent.includes('记忆学习')
    && steps[2].textContent.includes('连连看') && steps[3].textContent.includes('默写'),
    '步骤顺序为 单词学习 → 记忆学习 → 中英连连看 → 默写练习');
  // 点分组 → 进全屏学习舞台
  grps[0].click();
  await wait(1500);
  log(dom.window.eval('document.body.classList.contains("wt-stage")'), '勾选分组后进入全屏学习舞台');
  log(!!wd.querySelector('.wt-stage-bar .wt-stage-exit') && !!wd.querySelector('.wt-stage-fs'),
    '全屏舞台右上角有「退出学习」和字号三档（大/中/小）');
  const steps2 = [...wd.querySelectorAll('.wt-step')];
  log(steps2[0].classList.contains('on') && steps2[1].classList.contains('lock') && steps2[3].classList.contains('lock'),
    '每轮都从「单词学习」开始，后面的步骤先锁定');
  log(text(dom).includes('写好了，下一个') && !wd.querySelector('#wqMic') && !wd.querySelector('#wqSkip'),
    '学习步骤无麦克风按钮，只有「写好了，下一个」');
  // 学习步骤全部做完的完成页：大按钮进下一步、不再有「再来一轮」
  dom.window.eval('(function(){const q=WT.quick;q.read.i=q.words.length;wtQuickRead()})()');
  await wait(400);
  log(!!wd.querySelector('#wtNext.primary-lg') && !wd.querySelector('#wtAgain'),
    '完成页「进入下一步」为大按钮（primary-lg），且没有「再来一轮」');
  log(!wd.querySelector('.wq-syls') && !wd.querySelector('#wqSpkSyl'), '单词学习不再分音节：只有整词发音按钮，无音节切分行');
  log(!wd.querySelector('.wq-task') && !wd.querySelector('#wqMic'), '不再出现勾选打卡清单');
  // 退出全屏：回到分组选择页（此前的 bug 是点了又立刻被弹回全屏）
  wd.querySelector('.wt-stage-bar .wt-stage-exit').click();
  await wait(1500);
  log(!dom.window.eval('document.body.classList.contains("wt-stage")') && !!wd.querySelector('.wt-grp') && text(dom).includes('点上面任意一个'),
    '点「退出学习」回到分组选择页（不自动弹回全屏）');
  wd.querySelector('.wt-grp').click();
  await wait(1500);
  log(dom.window.eval('document.body.classList.contains("wt-stage")'), '再次点分组可以重新进入全屏学习');
  // ---------- 错词本：单词速记头部入口，答错自动收集，可一键重练默写 ----------
  log(!!wd.querySelector('#wtWrongWordBtn'), '单词速记头部有「错词本」入口（与错句本同位置）');
  dom.window.eval('wtWrongWordAdd({id:801, word:"nothing", phonetic:"[ˈnʌθɪŋ]", meaning:"没有什么；无零", unit:"Unit 1"})');
  dom.window.eval('wtWrongWordAdd({id:802, word:"borrow", phonetic:"[ˈbɒrəʊ]", meaning:"借入", unit:""})');
  await wait(300);
  log(wd.querySelector('.wt-wwrong-n') && wd.querySelector('.wt-wwrong-n').textContent === '2', '答错的单词自动收进错词本（头部角标计数 2）');
  wd.querySelector('#wtWrongWordBtn').click();
  await wait(300);
  log(wd.querySelectorAll('.wt-ws-item').length === 2 && text(dom).includes('nothing'),
    '错词本弹窗列出错词（单词 + 音标 + 释义 + 单元标签）');
  log(!!wd.querySelector('#wtWwGo') && wd.querySelector('#wtWwGo').textContent.includes('重练'), '错词本支持一键重练');
  wd.querySelector('#wtWwGo').click();
  await wait(1500);
  log(text(dom).includes('错词重练') && !!wd.querySelector('#wsInput'), '点「开始重练」直接进入错词默写重练');
  dom.window.eval('(function(){const s=WT.quick.spell;s.queue[s.i]&&(document.getElementById("wsInput").value=s.queue[s.i].word);wtSpellSubmit(false)})()');
  await wait(900);
  log(dom.window.eval('wtWrongWordList().length') === 1, '重练写对一个 → 自动移出错词本（剩 1 词）');
  // 默写练习（分组正常流程）：拼错 → 亮出正确拼写并排到队尾，错词收进错词本
  dom.window.eval('wtReset("quick"); WT.needPick=false; wtQuickStart(false)');
  await wait(900);
  const spellQ0 = dom.window.eval('WT.quick.spell.queue.length');
  dom.window.eval('wtGoto("spell")');
  await wait(600);
  log(!wd.querySelector('.wq-answer-big') && !text(dom).includes('错词重练'), '回到分组练习后恢复默认默写流程');
  dom.window.eval('document.getElementById("wsInput").value = "wrongguess"; wtSpellSubmit(false)');
  await wait(300);
  log(text(dom).includes('正确拼写') && !!wd.querySelector('.wq-spell-ans') && !!wd.querySelector('#wsNext'), '默写拼错：大字亮出正确拼写，出现「下一个」按钮，不自动跳题');
  log(dom.window.eval('WT.quick.spell.queue.length') === spellQ0 + 1, '拼错的单词排到队尾，后面再考直到拼对');
  log(dom.window.eval('wtWrongWordList().length') === 2, '默写拼错的单词也自动收进错词本');
  // 「英语音标大冒险」已删除；模块顺序：… → 连词成句 → 考纲单词 → 指法练习
  const subs = [...wd.querySelectorAll('.st-tabs [data-wordsub]')].map((a) => a.dataset.wordsub);
  log(subs.indexOf('build') < subs.indexOf('syllabus') && subs.indexOf('syllabus') < subs.indexOf('typing') && !subs.includes('phonics'),
    '音标大冒险已删除，模块顺序：连词成句 → 考纲单词 → 指法练习', subs.join(' → '));
  // 未锁定的步骤可以直接进入第 2 步：认识 / 不认识（模拟学完第 1 步后进入）
  dom.window.eval('wtGoto("memorize")');
  await wait(700);
  log(!!wd.querySelector('#wqYes') && !!wd.querySelector('#wqNo'), '记忆学习步骤有「认识 / 不认识」两个按钮');
  const bYes = wd.querySelector('#wqYes'), bNo = wd.querySelector('#wqNo');
  log(bYes && bNo && bYes.className.includes('btn') && bNo.className.includes('btn')
    && !bYes.className.includes('primary-sm'), '认识/不认识使用同一尺寸按钮（不再一大一小）');
  // 从速记模块点学科应能回到课程页（此前点不动）
  const backSub = [...wd.querySelectorAll('.st-subj a')].find((a) => a.textContent.includes('数学'));
  backSub.click();
  await wait(1400);
  log((dom.window.location.hash || '').startsWith('#/courses'), '在速记模块点学科可跳回课程页',
    'hash=' + dom.window.location.hash);
  log(text(dom).includes('同步基础') && text(dom).includes('数学'), '跳回后课程页正常（课程分类 + 数学课程）');
  // 独立小模块（iframe 嵌入自包含小游戏）：只剩指法练习；音标大冒险路由已下线
  dom.window.location.hash = '#/words/phonics';
  await wait(1200);
  log(!wd.querySelector('iframe.wt-frame') && text(dom).includes('单词速记'), '音标大冒险入口已删除（访问旧地址回落到单词速记）');
  dom.window.location.hash = '#/words/typing';
  await wait(1200);
  log(!!wd.querySelector('iframe.wt-frame[src="/apps/typing.html"]'), '指法练习以内嵌页面打开');
  // 词性训练：背诵学习 / 词形默写 / 词性判断 三种模式
  dom.window.location.hash = '#/words/pos';
  await wait(1500);
  dom.window.eval('(function(){const s=document.getElementById("wtUnit");if(s&&!s.value&&s.options[1]){s.value=s.options[1].value;s.onchange();}})()');
  await wait(1500);
  log([...wd.querySelectorAll('[data-posmode]')].map((b) => b.dataset.posmode).join(',') === 'learn,judge,dict',
    '词性训练有 背诵学习 / 词性判断 / 词形默写 三种模式（判断在默写前）',
    [...wd.querySelectorAll('[data-posmode]')].map((b) => b.textContent.trim()).join('、'));
  log(!!wd.querySelector('.pos-chain') && wd.querySelectorAll('.pos-row').length >= 2,
    '背诵学习默认打开：按原词聚成转换链展示（care (v.) → careful (adj.) 小心的…）');
  wd.querySelector('[data-posmode="dict"]').click();
  await wait(600);
  log(!!wd.querySelector('#wpInput') && !!wd.querySelector('.pos-blank'), '词形默写：转换链挖空 + 输入框作答');
  // ---------- 错句本：句子类模块头部入口，答错自动收集，可一键重练 ----------
  dom.window.location.hash = '#/words/build';
  await wait(1500);
  dom.window.eval('(function(){const s=document.getElementById("wtUnit");if(s&&!s.value&&s.options[1]){s.value=s.options[1].value;s.onchange();}})()');
  await wait(1500);
  log(!!wd.querySelector('#wtWrongBtn'), '连词成句头部有「错句本」入口（错句本只在连词成句）');
  log(!wd.querySelector('#wbSkip'), '连词成句没有「跳过」按钮（拼错自动进错句本）');
  dom.window.eval('wtWrongAdd({id:901,text:"Have you ever been to Beijing?",translation:"你去过北京吗？"})');
  dom.window.eval('wtWrongAdd({id:902,text:"I have already finished my homework.",translation:"我已经完成作业了。"})');
  await wait(300);
  log(wd.querySelector('.wt-wrong-n') && wd.querySelector('.wt-wrong-n').textContent === '2', '答错的句子自动收进错句本（头部角标计数 2）');
  wd.querySelector('#wtWrongBtn').click();
  await wait(300);
  log(wd.querySelectorAll('.wt-ws-item').length === 2 && text(dom).includes('Have you ever been to Beijing?'),
    '错句本弹窗列出错句（原句 + 中文释义 + 单元标签）');
  log(!wd.querySelector('#wtWsClear') && !wd.querySelector('.wt-ws-del'), '错句本没有「清空本组」和单句「移出」按钮');
  log(!!wd.querySelector('#wtWsGo') && wd.querySelector('#wtWsGo').textContent.includes('重练'), '错句本支持一键重练');
  wd.querySelector('#wtWsGo').click();
  await wait(1500);
  log((dom.window.location.hash || '').includes('/words/build') && !!wd.querySelector('#wtBuildBox .wt-tile'),
    '点「开始重练」直接进入连词成句重练错句');
  dom.window.eval('(function(){const b=WT.build;const s=b.list[b.i];b.picked=s.text.split(/\\s+/).map((t,i)=>({t,i}));renderBuild();document.getElementById("wbOk").click();})()');
  await wait(400);
  log(dom.window.eval('wtWrongList().length') === 1, '错句重练拼对一句 → 自动移出错句本（剩 1 句）');
  dom.window.location.hash = '#/words/context';
  await wait(1500);
  dom.window.eval('(function(){const s=document.getElementById("wtUnit");if(s&&!s.value&&s.options[1]){s.value=s.options[1].value;s.onchange();}})()');
  await wait(1500);
  // 课文朗读（原语境记忆改版）：句子卡片 + 倍速 + 全文朗读，没有答题也就没有错句本
  log(!wd.querySelector('#wtWrongBtn') && !!wd.querySelector('.rd-toolbar'), '课文朗读头部没有「错句本」，有朗读工具条');
  log(wd.querySelectorAll('.rd-card').length > 0, '课文朗读按模板渲染句子卡片（英文 + 中文）', '本视图 ' + wd.querySelectorAll('.rd-card').length + ' 句');
  log(!!wd.querySelector('#rdAll') && wd.querySelector('#rdAll').textContent.includes('全文朗读'), '右上角有「▶ 全文朗读」按钮');
  log(!!wd.querySelector('#rdSizes') && wd.querySelectorAll('#rdSizes [data-rdsize]').length === 3,
    '朗读工具条有「小 / 中 / 大」三档缩放按钮（大档 ≈ 考纲单词学习框）');
  dom.window.eval('document.querySelector(\'#rdSizes [data-rdsize="big"]\').click()');
  log(wd.querySelector('.rd-narrow') && wd.querySelector('.rd-narrow').dataset.rdsize === 'big'
    && !!wd.querySelector('#rdSizes [data-rdsize="big"].on'),
    '点「大」后容器切换到大档且按钮高亮（localStorage 记住）');
  log(!!wd.querySelector('#rdRate'), '右上角有「播放倍速」下拉');
  log(wd.querySelectorAll('.rd-card .rd-spk').length === wd.querySelectorAll('.rd-card').length, '每张卡片右侧都有🔊小喇叭（替代语音测评）');
  // jsdom 没有语音引擎：桩一个「不出声也不触发 onend」的 speechSynthesis（发音走兜底定时器，连读状态可断言）
  dom.window.SpeechSynthesisUtterance = function (t) { this.text = String(t); };
  dom.window.speechSynthesis = { cancel() {}, resume() {}, speak() {} };
  wd.querySelector('.rd-card .rd-spk').click();
  await wait(600);
  log(dom.window.eval('document.querySelectorAll(".rd-card").length') > 0, '点小喇叭不报错（发音走服务端/浏览器兜底）');
  dom.window.eval('document.getElementById("rdAll").click()');
  await wait(700);
  log(dom.window.eval('WT.read.playing') === true && !!wd.querySelector('.rd-card.playing'), '点「全文朗读」→ 连读开始，当前句卡片高亮');
  dom.window.eval('document.getElementById("rdAll").click()');
  await wait(300);
  log(dom.window.eval('WT.read.playing') === false, '再点「停止朗读」→ 连读停止');
  // 课文分组：造带分组的句子书验证分组条（与连词成句共用同一句子库）

  // 课文分组：上传带「分组」列的句子表 → 学生端单元下出现分组筛选条
  const grpCsv = '句子,翻译,单元,分组\nThis is our big lesson. ,这是大课文。,Unit 1,大课文\nThis is our small lesson. ,这是小课文。,Unit 1,小课文\n';
  const grpBook = (await adminPost('/api/admin/word/books', aLogin.data.token, { title: '分组测试句子书 ' + Date.now(), kind: 'sent' })).data;
  const grpFd = new FormData();
  grpFd.append('file', new Blob([grpCsv], { type: 'text/csv' }), 'grp.csv');
  grpFd.append('kind', 'sentence');
  grpFd.append('book_id', String(grpBook.id));
  const grpUp = await json('/api/admin/word/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + aLogin.data.token }, body: grpFd });
  log(grpUp.code === 0 && /2/.test(grpUp.msg || ''), '句子上传支持「分组」列（大课文/小课文）', grpUp.msg);
  dom.window.eval('WT.books=null;WT.subState.context=null;WT.subState.build=null;render()');
  await wait(1500);
  dom.window.eval('(function(){const s=document.getElementById("wtBook");const o=[...s.options].find(function(o){return o.textContent.includes("分组测试句子书")});if(o){s.value=o.value;s.onchange();}})()');
  await wait(1500);
  dom.window.eval('(function(){const s=document.getElementById("wtUnit");if(s&&!s.value&&s.options[1]){s.value=s.options[1].value;s.onchange();}})()');
  await wait(1500);
  log(wd.querySelectorAll('.rd-chip').length >= 3, '单元下出现「课文分组」筛选条（全部 + 大课文 + 小课文）', 'chips=' + wd.querySelectorAll('.rd-chip').length);
  dom.window.eval('(function(){const c=[...document.querySelectorAll(".rd-chip")].find(function(x){return x.textContent==="小课文"});c.click();})()');
  await wait(1500);
  log(wd.querySelectorAll('.rd-card').length === 1 && text(dom).includes('This is our small lesson.'),
    '点「小课文」→ 卡片只显示该分组的句子');
  log(dom.window.eval('wtReadList().length') === 1 && dom.window.eval('WT.readGrp') === '小课文', '分组筛选状态生效（连词成句同享此筛选）');

  // ---------- 考纲单词：三步流程（学前检测 60 词大组 · 纸条核对 · ➕ 筛生词 → 单词识记 → 学后检测） ----------
  console.log('\n【考纲单词模块】');
  // 造一本「考纲单词书」：考纲模块与单词速记的词书互不混用
  const sylCsv = '单词,音标,释义,单元\n' + ['apple', 'banana', 'car', 'dog', 'egg', 'frog', 'grape', 'hand']
    .map((w, i) => w + ',[x],' + '释义' + (i + 1) + ',Unit 1').join('\n') + '\n';
  const sylBookRes = await adminPost('/api/admin/word/books', aLogin.data.token, { title: '考纲测试词书 ' + Date.now(), kind: 'syllabus' });
  log(sylBookRes.code === 0 && sylBookRes.data.kind === 'syllabus', '可创建「考纲单词书」类型词书');
  const sylFd = new FormData();
  sylFd.append('file', new Blob([sylCsv], { type: 'text/csv' }), 'syl.csv');
  sylFd.append('kind', 'word');
  sylFd.append('book_id', String(sylBookRes.data.id));
  const sylUp = await json('/api/admin/word/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + aLogin.data.token }, body: sylFd });
  log(sylUp.code === 0 && /8/.test(sylUp.msg || ''), '考纲词书上传 8 个单词', sylUp.msg);
  // 词书缓存是进页面时拉的，置空让它重新拉（考纲测试词书刚建好）
  dom.window.eval('WT.books=null;WT.subState.syllabus=null');
  dom.window.location.hash = '#/words/syllabus';
  await wait(2500);
  log(!!wd.querySelector('#wtBook') && !wd.querySelector('#wtUnit'),
    '考纲单词不按单元划分：只有词书下拉，没有单元下拉');
  log(dom.window.eval('wtModBooks("syllabus").length') > 0 && dom.window.eval('wtModBooks("syllabus").every(function(b){return b.kind==="syllabus"})'),
    '考纲模块只显示「考纲单词书」');
  log(dom.window.eval('wtModBooks("quick").some(function(b){return b.kind==="syllabus"})') === false,
    '单词速记看不到考纲词书（两种词书互不混用）');
  const sylSteps = [...wd.querySelectorAll('.syl-steps .wt-step')].map((a) => a.textContent.trim());
  log(sylSteps.length === 3 && sylSteps[0].includes('学前检测') && sylSteps[1].includes('单词识记') && sylSteps[2].includes('学后检测'),
    '顶部三段流程条：学前检测 → 单词识记 → 学后检测（抗遗忘复习已删除）', sylSteps.join(' → '));
  log(wd.querySelectorAll('.syl-steps .wt-step.lock').length === 2,
    '学前检测没完成：「单词识记 / 学后检测」都是锁着的（流程一步步来）');
  log(text(dom).includes('点击核对') && wd.querySelectorAll('.syl-frow').length === 8,
    '学前检测：单词列表 + 释义被「纸条」挡住（点击核对）', '本大组 ' + wd.querySelectorAll('.syl-frow').length + ' 词');
  log(text(dom).includes('第 1 / 1 大组') && text(dom).includes('每大组 60 词'),
    '学前检测自动按每 60 个单词为一个大组（8 词 → 1 个大组）');
  wd.querySelector('.syl-frow .syl-slip').click();
  await wait(500);
  log(wd.querySelector('.syl-frow .syl-slip').classList.contains('open') && text(dom).includes('释义1'),
    '点纸条「点击核对」→ 亮出中文意思（并朗读发音）');
  // ➕ 筛生词：前 3 个词加入生词本
  for (let i = 0; i < 3; i++) { wd.querySelectorAll('.syl-frow .syl-fadd')[i].click(); await wait(350); }
  log(dom.window.eval('sylWords().length') === 3, '点 ➕ → 该词加入生词本（待学池 = 亲手筛出来的）', '生词 ' + dom.window.eval('sylWords().length'));
  log(dom.window.eval('WT.syl.stat.wrong') === 3, '➕ 计入学前检测的「错误」计数');
  log(wd.querySelectorAll('.syl-frow.in').length === 3 && text(dom).includes('您已经筛选出'), '生词行高亮，底部实时汇总「已筛选出 N 个生词」');
  log(!!wd.querySelector('#sylFDone'), '最后一大组出现「✅ 完成学前检测」按钮');
  wd.querySelector('#sylFDone').click();
  await wait(1200);
  log(dom.window.eval('WT.syl.fdone') === true && dom.window.eval('WT.syl.phase') === 'learn',
    '完成学前检测 → 自动进入「单词识记」');
  log(dom.window.eval('sylKnownN()') === 5, '没核对到的 5 个词自动按「已会」处理', '已会 ' + dom.window.eval('sylKnownN()'));
  log(wd.querySelectorAll('.syl-steps .wt-step.lock').length === 0, '学前检测完成后，后面的步骤解锁');
  const sgrps = [...wd.querySelectorAll('.wt-grp')];
  log(sgrps.length === 1 && sgrps[0].textContent.includes('3'), '筛出的 3 个生词按每组 5/10 个自动分组', sgrps.map((g) => g.textContent.trim()).join('、'));
  sgrps[0].click();
  await wait(1600);
  log(dom.window.eval('document.body.classList.contains("wt-stage")'), '点分组进入全屏学习舞台');
  const cards = [...wd.querySelectorAll('.syl-lcard')];
  log(cards.length === 3, '单词识记：本组词排成词卡墙', '共 ' + cards.length + ' 张');
  log(!wd.querySelector('#sylGame') && !wd.querySelector('#sylPrevGrp') && !wd.querySelector('#sylNextGrp') && !text(dom).includes('趣味游戏'),
    '识记页底部已删除 上一组 / 下一组 / 趣味游戏');
  log(!!wd.querySelector('#sylToTest') && wd.querySelector('#sylToTest').textContent.includes('学完了'),
    '底部只保留「学完了，去学后检测」一个按钮');
  wd.querySelector('#sylToTest').click();
  await wait(900);
  log(!!wd.querySelector('#sylQuizBox') && !!wd.querySelector('.wt-opt'), '点「学完了 → 学后检测」→ 进入逐题检测（考纲只出识记选择题）');
  log(!wd.querySelector('#sylInput'), '考纲学后检测没有默写拼写输入框（已取消默写环节）');
  log(dom.window.eval('WT.syl.quiz.list.length') === 3 * 2, '每组 3 个词各识记 2 遍（一轮 6 题）', dom.window.eval('WT.syl.quiz.list.length') + ' 题');
  {
    const tps = [...new Set(dom.window.eval('WT.syl.quiz.list.map(function(c){return c.type})'))];
    log(tps.every((t) => ['en2cn', 'cn2en', 'listen'].includes(t)), '题目只使用识记题型（看英选义 / 看义选英 / 听音辨义）', tps.join(','));
  }
  for (let k = 0; k < 30; k++) {
    if (!wd.querySelector('#sylQuizBox')) break;
    const opts = [...wd.querySelectorAll('#sylQuizBox .wt-opt:not([disabled])')];
    if (!opts.length) break;
    const right = dom.window.eval('(function(){var s=WT.syl.quiz;var c=s.list[s.i];return (c.type==="en2cn"||c.type==="listen")?(c.w.meaning||"（没写释义）"):c.w.word})()');
    const target = opts.find((b) => b.textContent.trim() === String(right).trim()) || opts[0];
    target.click();
    await wait(900);
  }
  await wait(600);
  log(text(dom).includes('学后检测结果') && text(dom).includes('正确率'), '交卷出「正确 / 错误 / 正确率」结果页');
  log(dom.window.eval('wtGroupDone(WT.groupIdx)'), '整组检测全对 → 该分组标记为已完成');
  wd.querySelector('#sylBackLearn').click();
  await wait(1400);
  log(!dom.window.eval('document.body.classList.contains("wt-stage")') && !!wd.querySelector('.wt-grp'),
    '「回单词识记」→ 退出舞台回到分组页');
  // 错词本「开始重练」：考纲模块里直接进「错词重练」（识记题，不默写）
  dom.window.eval('wtWrongWordSave([])');
  dom.window.eval('wtWrongWordAdd({id:801, word:"nothing", phonetic:"[ˈnʌθɪŋ]", meaning:"没有什么；无零"})');
  await wait(300);
  wd.querySelector('#wtWrongWordBtn').click();
  await wait(300);
  wd.querySelector('#wtWwGo').click();
  await wait(1800);
  log((dom.window.location.hash || '').includes('words/syllabus') && !!wd.querySelector('.wt-opt') && !wd.querySelector('#sylInput') && text(dom).includes('错词重练'),
    '考纲模块错词本「开始重练」→ 留在本模块进「错词重练」（识记题，不默写）', String(dom.window.location.hash));
  log(dom.window.eval('(function(){var s=WT.syl.quiz;return s&&s.drill===true})()'), '重练轮标记为 drill（不参与分组变绿）');
  dom.window.eval('sylQuizChoose(sylQuizOptions(WT.syl.quiz.list[0].w, WT.syl.quiz.list[0].type).find(function(o){return String(o)===(WT.syl.quiz.list[0].type==="cn2en"?WT.syl.quiz.list[0].w.word:(WT.syl.quiz.list[0].w.meaning||"（没写释义）"))}))');
  await wait(1200);
  log(dom.window.eval('wtWrongWordList().length') === 0, '考纲重练认对 → 自动移出错词本');
  wd.querySelector('.wt-stage-bar .wt-stage-exit').click();
  await wait(1400);
  log(!dom.window.eval('document.body.classList.contains("wt-stage")') && !!wd.querySelector('.wt-grp'),
    '重练结束退出舞台 → 回到分组选择页');
  // 回学前检测补筛：标记与统计都在，可以继续 ➕
  [...wd.querySelectorAll('[data-sylstep]')].find((a) => a.dataset.sylstep === 'filter').click();
  await wait(1000);
  log(!!wd.querySelector('#sylStat') && wd.querySelectorAll('.syl-frow.in').length === 3,
    '回到学前检测：标记与统计都在（生词行保持高亮）');
  wd.querySelectorAll('.syl-frow .syl-fadd')[3].click();
  await wait(500);
  log(dom.window.eval('sylWords().length') === 4, '补筛：再点一个 ➕ → 生词数 +1');
  const recSyl = await json('/api/stu/word/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sLogin.data.token },
    body: JSON.stringify({ module: 'syllabus', bookId: 0, correct: true }),
  });
  log(recSyl.code === 0, '服务端接受考纲单词的作答记录（module=syllabus）', recSyl.msg);
  // 清理：删掉本次自测建的考纲词书（否则管理端词书列表会越堆越多）
  await json('/api/admin/word/books/' + sylBookRes.data.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aLogin.data.token }, body: JSON.stringify({ pwd: '199856' }) });

  dom.window.location.hash = '#/words/quick';
  await wait(1500);
  log(!wd.querySelector('#wtWrongBtn'), '单词速记页不显示错句本入口（仅句子类模块）');
  dom.window.close();

  // 新会话直接打开时（浏览器记住上次停在单词页的情况）→ 兜底回到课程首页
  dom = await boot('/', { token: sLogin.data.token, user: sLogin.data.user, hash: '#/words/quick', fresh: true });
  await wait(2500);
  log((dom.window.location.hash || '').startsWith('#/courses'), '新会话打开学生端自动回到课程首页（不被单词页地址残留带偏）',
    'hash=' + dom.window.location.hash);
  dom.window.close();

  // ---------- 管理端 ----------
  console.log('\n【管理端页面渲染】');
  dom = await boot('/admin/');
  await wait(1500);
  log(text(dom).includes('校长后台') && text(dom).includes('登 录'), '管理端登录页渲染');
  dom.window.close();

  const aRoutes = [
    ['#/dash', ['数据概览', '快捷操作', '最近开通的学生']],
    ['#/branches', ['分校账号', '开通分校']],
    ['#/students', ['学生账号', '开通学生']],
    ['#/chapters', ['课程目录', '新增章节']],
    ['#/handouts', ['讲义资料', '上传资料', '本章习题库']],
    ['#/videos', ['视频管理', '上传视频']],
    ['#/wrong', ['AI错题重组', 'AI 识别全部题目', '错题栏', '原题重组', '举一反三', '上传文件（图片 / PDF）']],
    ['#/guide', ['使用说明', '上传新说明', '学生端看到的样子']],
    ['#/words', ['词书管理', '考纲单词', '学生学习进度', '已有单词书', '单词库']],
    ['#/aireport', ['AI学情诊断', '提供试卷照片或 PDF', '分析报告', '连拍（每 2 秒一张）', '摄像头体检', '上传文件（图片 / PDF）']],
  ];
  for (const [h, keys] of aRoutes) {
    dom = await boot('/admin/', { token: aLogin.data.token, user: aLogin.data.user, hash: h });
    await wait(1800);
    const b = text(dom);
    const ok = keys.every((k) => b.includes(k));
    log(ok, `管理端 ${h} 渲染`, ok ? '' : '缺失：' + keys.filter((k) => !b.includes(k)).join('、'));
    if (h === '#/wrong') {
      log(/pdf/i.test(dom.window.document.getElementById('wFiles').accept || '')
        && /image/.test(dom.window.document.getElementById('wFiles').accept || ''),
        '错题重组的文件框同时接受图片与 PDF', dom.window.document.getElementById('wFiles').accept);
      log(typeof dom.window.PdfPages === 'object' && typeof dom.window.PdfPages.upload === 'function',
        'pdfpages.js 已随页面加载（PDF 逐页转图能力可用）');
    }
    if (h === '#/aireport') {
      log(/pdf/i.test(dom.window.document.getElementById('arFiles').accept || '')
        && /image/.test(dom.window.document.getElementById('arFiles').accept || ''),
        '学情诊断的文件框同时接受图片与 PDF', dom.window.document.getElementById('arFiles').accept);
      log(typeof dom.window.PdfPages === 'object', '学情诊断页也能拿到 PdfPages 能力');
    }
    if (h === '#/students') {
      log(!!dom.window.document.getElementById('btnStuDel'), '学生管理有「🗑 批量删除」按钮（免密码）');
      const stChk = dom.window.document.querySelectorAll('.stu-chk');
      log(stChk.length === dom.window.document.querySelectorAll('tbody tr').length && stChk.length > 0,
        '学生表格每行带勾选框（共 ' + stChk.length + ' 行）');
    }
    if (h === '#/dash') {
      const navText = [...dom.window.document.querySelectorAll('.nav a')].map((a) => a.textContent.trim()).join('|');
      log(dom.window.document.querySelectorAll('.nav a').length === 10, '侧边导航 10 项', dom.window.document.querySelectorAll('.nav a').length + ' 项');
      log(navText.includes('AI错题重组') && navText.includes('讲义资料') && navText.includes('视频管理'), '导航含 AI错题重组 / 讲义资料 / 视频管理', navText);
      log(navText.includes('AI学情诊断') && navText.includes('AI单词训练'), '导航含 AI单词训练 / AI学情诊断', navText);
      const navArr = [...dom.window.document.querySelectorAll('.nav a')].map((a) => a.textContent.trim());
      log(navArr[navArr.length - 1].includes('使用说明'), '使用说明固定在最下面一个模块', navArr.join('|'));
      log(navArr.findIndex((t) => t.includes('AI单词训练')) < navArr.findIndex((t) => t.includes('错题重组')),
        'AI单词训练排在 AI错题重组前面（两个模块位置已调整）', navArr.join('|'));
      log(!b.includes('题库管理') && !b.includes('班级管理'), '题库 / 班级管理已移除');
      log(b.includes('习题数量'), '数据概览含习题统计');
      // 统一 AI 配置：顶栏全局入口，任何模块都能打开，全站共用一份
      const aiBtn = dom.window.document.querySelector('#btnAiCfg');
      log(!!aiBtn, '顶栏有「AI 配置」全局入口（各 AI 模块共用一份配置）');
      if (aiBtn) {
        aiBtn.click();
        await wait(1000);
        const cModal = dom.window.document.querySelector('.mask .modal');
        log(!!cModal, 'AI 配置弹窗可打开');
        log(!!dom.window.document.querySelector('#cBase') && !!dom.window.document.querySelector('#cModel')
          && !!dom.window.document.querySelector('#cKey') && !!dom.window.document.querySelector('#cTest'),
          'AI 配置弹窗含 接口地址 / 模型 / API Key / 测试连接');
        const cx = dom.window.document.querySelector('.mask .modal .close-x');
        if (cx) cx.click();
        await wait(300);
      }
      // 校长改密码入口：正式上线后必须能把初始密码 123456 改掉（此前后台没有这个入口）
      const pwdBtn = dom.window.document.querySelector('#btnPwd');
      log(!!pwdBtn, '后台顶栏有「修改密码」入口（可改掉初始密码）');
      if (pwdBtn) {
        pwdBtn.click();
        await wait(800);
        const pModal = dom.window.document.querySelector('.mask .modal');
        log(!!pModal && !!dom.window.document.querySelector('#ap1')
          && !!dom.window.document.querySelector('#ap2') && !!dom.window.document.querySelector('#ap3'),
          '改密码弹窗含 原密码 / 新密码 / 确认新密码 三个输入框');
        const px = dom.window.document.querySelector('.mask .modal .close-x');
        if (px) px.click();
        await wait(300);
      }
    }
    if (h === '#/chapters') {
      log(b.includes('分级目录'), '课程目录页每个章节下有「分级目录」');
      log(dom.window.document.querySelectorAll('[data-sec-add]').length > 0, '章节下有「+ 分级目录」按钮');
      log(/不分组|视频 \d+ · 资料 \d+/.test(b), '分级目录条显示状态或内容统计');
      // 册别（第 4 级分组）：筛选 + 表单 + 分组标题
      log(!!dom.window.document.querySelector('#chTerm'), '课程目录可按册别筛选');
      log(/上册|下册|通用/.test(b), '课程目录按册别分组展示');
      dom.window.document.querySelector('#add').click();
      await wait(300);
      const kt = dom.window.document.querySelector('#kTerm');
      log(!!kt, '新增章节表单可选择册别');
      log(!!kt && [...kt.options].some((o) => o.value === '上册') && [...kt.options].some((o) => o.value === '下册')
        && [...kt.options].some((o) => o.value === '' && /通用/.test(o.textContent)),
        '册别选项含 上册 / 下册 / 通用');
      // 分类决定「② 级」是年级还是学段：同步类 → 年级 + 册别；专项提升 → 学段；中考冲刺 → 学段固定初中
      const cw = dom.window.document;
      const catSel = cw.querySelector('#kCategory');
      log(cw.querySelector('#kGradeWrap').style.display !== 'none' && cw.querySelector('#kStageWrap').style.display === 'none'
        && cw.querySelector('#kTermWrap').style.display !== 'none',
        '同步分类下：显示「年级 + 册别」，隐藏「学段」');
      dom.window.eval('(function(){const c=document.getElementById("kCategory");c.value="专项提升";c.onchange();})()');
      await wait(150);
      log(cw.querySelector('#kStageWrap').style.display !== 'none' && cw.querySelector('#kGradeWrap').style.display === 'none'
        && cw.querySelector('#kTermWrap').style.display === 'none',
        '选「专项提升」后：出现「学段」，隐藏「年级 / 册别」（专项不看年级册别）');
      dom.window.eval('(function(){const c=document.getElementById("kCategory");c.value="中考冲刺";c.onchange();})()');
      await wait(150);
      const ks = cw.querySelector('#kStage');
      log(!!ks && ks.value === 'junior' && ks.disabled, '选「中考冲刺」后：学段固定为初中（不可改）');
      const kx = dom.window.document.querySelector('.mask .modal .close-x');
      if (kx) kx.click();
      await wait(250);
    }
    if (h === '#/handouts') {
      log(!!dom.window.document.querySelector('#hKind'), '讲义资料页有类型筛选');
      log(!!dom.window.document.querySelector('#hf-section'), '讲义资料页可按分级目录筛选');
      log(dom.window.document.querySelectorAll('tbody tr').length > 0, '资料列表有数据');
    }
    if (h === '#/words') {
      log(!!dom.window.document.querySelector('#wdTpl'), '词书管理页有「下载模板」按钮');
      const wTabs = [...dom.window.document.querySelectorAll('[data-wview]')].map((x) => x.textContent.trim());
      log(wTabs.length === 3 && wTabs.some((t) => t.includes('词书管理')) && wTabs.some((t) => t.includes('考纲单词'))
        && wTabs.every((t) => !t.includes('AI单词训练')),
        'AI单词训练子标签：词书管理 / 考纲单词 / 学生学习进度', wTabs.join('|'));
      // 词书按类型分区：没有「全部词书」混排，默认落在「单词书」
      const allBooks = (await json('/api/admin/word/books', { headers: { Authorization: 'Bearer ' + aLogin.data.token } })).data || [];
      const idsOf = (k) => allBooks.filter((b) => (b.kind || 'word') === k).map((b) => String(b.id)).sort();
      const bkRows = () => [...dom.window.document.querySelectorAll('.w-bk')];
      const kindBtns = [...dom.window.document.querySelectorAll('[data-wkind]')].map((x) => x.dataset.wkind);
      log(kindBtns.join(',') === 'word,phrase,pos,sent',
        '词书管理按类型分区：单词书 / 短语书 / 词形转换书 / 句子书（考纲单词另有独立窗口）', kindBtns.join('|'));
      log(!text(dom).includes('全部词书'), '已取消「全部词书」混排视图（各类型词书不再堆在一起）');
      // 顶部「已有词书」列表：只显示当前分区的类型（点单词书只看单词书，绝不混排），带徽标 + 编辑 / 删除
      log(bkRows().length === idsOf('word').length && bkRows().every((r) => r.querySelector('.w-bk-kind').textContent.includes('单词书')),
        '「已有词书」列表只列当前分区的词书：单词书分区里全是单词书（短语书 / 句子书不会混进来）',
        bkRows().length + ' 行 / 单词书 ' + idsOf('word').length + ' 本');
      log(bkRows().filter((r) => r.classList.contains('on')).length === 1 && bkRows().find((r) => r.classList.contains('on')).querySelector('.w-bk-kind').textContent.includes('单词书'),
        '当前分区（单词书）选中的词书在列表里高亮');
      log(!!dom.window.document.querySelector('[data-bkedit]') && !!dom.window.document.querySelector('[data-bkdel]'),
        '每本词书行上都有「✏️ 编辑」「删除」按钮（可就地编辑）');
      log(!!dom.window.document.getElementById('wdBatchDel') && bkRows().length > 0 && bkRows().every((r) => !!r.querySelector('.w-bk-chk')),
        '词书管理有「🗑 批量删除」按钮，每本词书带勾选框（删除需输入删除密码）');
      // 就地编辑：只改名称（类型锁定，保证各分区互不混）
      const editTarget = allBooks.find((b) => (b.kind || 'word') === 'word') || allBooks[0];
      dom.window.eval('editBook(' + Number(editTarget.id) + ')');
      await wait(400);
      const eModal = dom.window.document.querySelector('.mask .modal');
      log(!!eModal && !!eModal.querySelector('#ebTitle') && !eModal.querySelector('#ebKind'),
        '点「✏️ 编辑」弹出编辑框：可改名 / 年级 / 备注，类型锁定不可改');
      if (eModal && eModal.querySelector('#ebTitle')) {
        eModal.querySelector('#ebTitle').value = '编辑测试单词书 ' + Date.now();
        eModal.querySelector('#mOk').click();
        await wait(1200);
        const after = (await json('/api/admin/word/books', { headers: { Authorization: 'Bearer ' + aLogin.data.token } })).data || [];
        const edited = after.find((b) => String(b.id) === String(editTarget.id));
        log(edited && /^编辑测试单词书 \d{13}$/.test(edited.title) && (edited.kind || 'word') === (editTarget.kind || 'word'),
          '编辑保存生效：标题已更新、类型保持不变', edited && edited.title);
        if (edited && /^编辑测试单词书/.test(edited.title)) {   // 改回原名，不污染演示数据
          await json('/api/admin/word/books/' + edited.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aLogin.data.token }, body: JSON.stringify({ title: editTarget.title, kind: editTarget.kind || 'word', grade: edited.grade || '', remark: edited.remark || '' }) });
        }
      }
      // 编辑测试可能把分区切到了「句子书」：切回「单词书」再断言库标签
      [...dom.window.document.querySelectorAll('[data-wkind]')].find((x) => x.dataset.wkind === 'word').click();
      await wait(900);
      const tabsNow = [...dom.window.document.querySelectorAll('[data-tab]')].map((x) => x.dataset.tab);
      log(tabsNow.includes('word') && !tabsNow.includes('phrase'),
        '单词书分区里绝不会出现「短语库」（短语只在短语书分区）', tabsNow.join('|'));
      log(dom.window.eval('WB.kind="word";WB.tab="word";JSON.stringify(bookTabs({word_count:9,sentence_count:0,pos_count:0,phrase_count:0}))') === '["word"]',
        '纯单词书（没有句子/词性数据）只显示「单词库」一个标签');
      log(dom.window.eval('JSON.stringify(bookTabs({word_count:9,sentence_count:3,pos_count:0,phrase_count:0}))') === '["word","sentence"]',
        '单词书里确实存了句子数据时，才多出「句子库」标签（老数据不丢）');
      // 切「短语书」→ 上传区变成短语表、无单词库标签（短语书只能看到短语的）
      [...dom.window.document.querySelectorAll('[data-wkind]')].find((x) => x.dataset.wkind === 'phrase').click();
      await wait(900);
      log(dom.window.eval('curBook() ? (curBook().kind||"word")==="phrase" : true') && dom.window.eval('WB.tab') === 'phrase',
        '切到「短语书」分区后，当前词书只可能是短语书');
      log(bkRows().length === idsOf('phrase').length && bkRows().every((r) => r.querySelector('.w-bk-kind').textContent.includes('短语书')),
        '短语书分区的「已有词书」列表里全是短语书（看不到单词书 / 句子书）',
        bkRows().length + ' 行 / 短语书 ' + idsOf('phrase').length + ' 本');
      log(text(dom).includes('上传短语库到') && !text(dom).includes('上传单词库到'),
        '短语书分区只管理短语库（上传的是短语表，看不到单词库）');
      log(text(dom).includes('下载模板') && /模板里第一行就是标准表头/.test(text(dom)),
        '上传区提示先下载模板（表头 + 示例行 + 填写说明）');
      // 新建按钮跟随分区：短语书分区点「＋ 新建」只能建短语书（类型锁定，无类型下拉）
      dom.window.eval('newBook("phrase")');
      await wait(400);
      const nModal = dom.window.document.querySelector('.mask .modal');
      log(!!nModal && !!nModal.querySelector('#nbTitle') && !nModal.querySelector('#nbKind'),
        '「＋ 新建短语书」弹窗没有类型下拉（类型锁定为当前分区）');
      const nTitle = nModal && nModal.querySelector('.modal-h h3');
      log(!!nTitle && nTitle.textContent.includes('短语书'), '新建弹窗标题 = 「＋ 新建短语书」', nTitle && nTitle.textContent);
      if (nModal) nModal.querySelector('.close-x').click();
      await wait(300);
      // 📋 考纲单词独立窗口
      [...dom.window.document.querySelectorAll('[data-wview]')].find((x) => x.dataset.wview === 'sylbook').click();
      await wait(900);
      const b2 = text(dom);
      log(b2.includes('考纲单词') && b2.includes('每 60 个单词为一个大组'), '「📋 考纲单词」独立窗口：说明 60 词大组流程');
      // 已有考纲词书：像「词书管理」一样列成列表（只列考纲书，带 ✏️ 编辑 / 删除）
      const sylRows = () => [...dom.window.document.querySelectorAll('.w-booklist .w-bk')];
      log(!!dom.window.document.querySelector('.w-booklist .w-booklist-h')
        && text(dom).includes('已有考纲单词书'),
        '考纲窗口顶部有「📚 已有考纲单词书」列表（与词书管理同款）');
      log(sylRows().length === idsOf('syllabus').length
        && sylRows().every((r) => r.querySelector('.w-bk-kind').textContent.includes('考纲单词书')),
        '考纲列表只显示考纲词书', '列表 ' + sylRows().length + ' 本 / 考纲书 ' + idsOf('syllabus').length + ' 本');
      log(sylRows().every((r) => !!r.querySelector('[data-bkedit]') && !!r.querySelector('[data-bkdel]')),
        '考纲列表每行都有「✏️ 编辑 / 删除」按钮（可就地改名，不用切窗口）');
      log(sylRows().filter((r) => r.classList.contains('on')).length <= 1,
        '考纲列表选中行高亮（最多一行 on）');
      if (sylRows().length) {
        log(/≈ 学前检测 \d+ 个大组|还是空的/.test(sylRows()[0].querySelector('.w-bk-cnt').textContent),
          '考纲列表行显示单词数与学前检测大组数', sylRows()[0].querySelector('.w-bk-cnt').textContent.slice(0, 40));
        sylRows()[0].click();
        await wait(900);
        log(String(dom.window.eval('WB.bookId')) === sylRows()[0].dataset.bk,
          '点考纲列表某一行 → 该词书被选中', 'bookId=' + dom.window.eval('WB.bookId'));
      }
      log(!dom.window.document.querySelector('[data-tab="phrase"]') && !!dom.window.document.querySelector('#wdTpl'),
        '考纲窗口只上传单词表（无短语/句子库标签）');
      log(b2.includes('不需要单元列') && b2.includes('每 60 个单词为一个大组'),
        '考纲上传区写明「不需要单元列，自动按 60 词分大组」，模板为考纲专用（无单元列）');
    }
    if (h === '#/videos') {
      log(!!dom.window.document.querySelector('#vf-section'), '视频管理页可按分级目录筛选');
      log(b.includes('分级目录'), '视频列表有「分级目录」列');
    }
    if (h === '#/students') {
      log(dom.window.document.querySelectorAll('tbody tr').length >= 3, '学生列表有数据');
      log(dom.window.document.querySelectorAll('.switch').length >= 3, '学生列表有倍速开关');
      log(b.includes('倍速播放'), '学生列表含倍速列');
      log(!b.includes('视频快进') && dom.window.document.querySelectorAll('[data-seek]').length === 0,
        '视频快进开关已从学生列表移除');
      log(b.includes('到期'), '学生列表含到期时间列');
      log(b.includes('册别'), '学生列表含册别列');
      // 开通学生弹窗：年级 / 到期时间必填，快进设置已下线
      dom.window.document.querySelector('#btnAdd').click();
      await wait(200);
      const fd = dom.window.document;
      log(!fd.querySelector('#fSeek'), '开通学生弹窗不再有「视频快进」设置');
      log(!!fd.querySelector('#fTerm') && [...fd.querySelector('#fTerm').options].some((o) => o.value === '上册'),
        '开通学生弹窗可设置册别（上册 / 下册 / 不限）');
      log(!!fd.querySelector('#fGrade') && fd.querySelector('#fGrade').options[0].textContent.includes('请选择年级'),
        '年级为必填下拉（占位「请选择年级」）');
      log(!!fd.querySelector('#fStage') && fd.querySelector('#fStage').options[0].textContent.includes('请选择学段'),
        '新增「学段」必填下拉（小学 / 初中，决定专项提升与中考冲刺的可见范围）');
      const fExpire = fd.querySelector('#fExpire');
      log(!!fExpire && fExpire.type === 'date', '到期时间为必填日期输入');
      // 不填年级 / 到期时间 → 前端直接拦截
      const uiStuUser = 'UISTU' + Date.now().toString().slice(-6);
      fd.querySelector('#fName').value = 'UI测试学生';
      fd.querySelector('#fUser').value = uiStuUser;
      fd.querySelector('#fGrade').value = '';
      fd.querySelector('#fStage').value = '';
      fd.querySelector('#fExpire').value = '';
      let errMsg = '';
      const mErr = fd.querySelector('#mErr');
      fd.querySelector('#mOk').click();
      await wait(400);
      errMsg = mErr && !mErr.classList.contains('hide') ? mErr.textContent : '';
      log(errMsg.includes('年级'), '不填年级时开通被拦截', errMsg);
      fd.querySelector('#fGrade').value = '七年级';
      fd.querySelector('#mOk').click();
      await wait(400);
      errMsg = mErr && !mErr.classList.contains('hide') ? mErr.textContent : '';
      log(errMsg.includes('学段'), '不填学段时开通被拦截', errMsg);
      // 年级自动带出学段（七年级 → 初中），学段与年级不一致也会被拦
      dom.window.eval('(function(){const g=document.getElementById("fGrade"),s=document.getElementById("fStage");g.value="六年级";s.value="junior";g.onchange();})()');
      await wait(200);
      log(fd.querySelector('#fStage').value === 'primary', '改年级时自动带出对应学段（六年级 → 小学）');
      fd.querySelector('#fGrade').value = '七年级';
      fd.querySelector('#fStage').value = 'junior';
      fd.querySelector('#mOk').click();
      await wait(400);
      errMsg = mErr && !mErr.classList.contains('hide') ? mErr.textContent : '';
      log(errMsg.includes('到期时间'), '不填到期时间时开通被拦截', errMsg);
      // 填全后开通成功
      fd.querySelector('#fExpire').value = '2027-12-31';
      fd.querySelector('#mOk').click();
      await wait(1200);
      log(!dom.window.document.querySelector('#fExpire'), '年级、学段与到期时间填全后开通成功（弹窗关闭）');
      // 清理：删掉刚开通的测试学生
      const uiStuList = await json('/api/admin/students?kw=' + uiStuUser, { headers: { Authorization: 'Bearer ' + aLogin.data.token } });
      const uiStuRow = (uiStuList.data || [])[0];
      if (uiStuRow) await json('/api/admin/students/' + uiStuRow.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aLogin.data.token } });
      log(true, '测试学生已清理', uiStuUser);
    }
    dom.window.close();
  }

  // ---------- 学段（小学 / 初中）：专项提升、中考冲刺按学段分发 ----------
  console.log('\n【学段课程可见性】');
  const mkStu = async (grade, stage) => {
    const un = 'UISTG' + Date.now().toString().slice(-6);
    const r = await adminPost('/api/admin/students', aLogin.data.token, {
      name: 'UI学段测试', username: un, password: '123456', grade, stage, expire_at: '2027-12-31',
    });
    const lg = await json('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: un, password: '123456', role: 'student' }) });
    return { id: r.data && r.data.id, username: un, tok: lg.data && lg.data.token, user: lg.data && lg.data.user };
  };
  const allCourses = async (tok) => {
    let a = [];
    for (const s of ['数学', '英语', '物理', '化学']) {
      const r = await json('/api/stu/courses?subject=' + encodeURIComponent(s), { headers: { Authorization: 'Bearer ' + tok } });
      a = a.concat(r.data || []);
    }
    return a;
  };
  const pri = await mkStu('六年级', 'primary');
  const jun = await mkStu('七年级', 'junior');
  log(!!pri.tok && !!jun.tok, '开通小学 / 初中两个学段的测试账号成功');
  log(pri.user && pri.user.stage === 'primary' && jun.user && jun.user.stage === 'junior',
    '登录信息带学段字段（publicUser.stage）', (pri.user || {}).stage + '/' + (jun.user || {}).stage);
  // 学段与年级不一致时后台直接拒绝
  const badStage = await adminPost('/api/admin/students', aLogin.data.token, {
    name: 'UI学段错配', username: 'UISTGX' + Date.now().toString().slice(-5), password: '123456', grade: '三年级', stage: 'junior', expire_at: '2027-12-31',
  });
  log(badStage.code !== 0 && /学段/.test(badStage.msg || ''), '年级与学段不一致时被拒绝', badStage.msg);
  const priAll = await allCourses(pri.tok);
  const junAll = await allCourses(jun.tok);
  log(priAll.length >= 0 && priAll.every((c) => c.category !== '中考冲刺'), '小学账号看不到中考冲刺课程', `小学可见 ${priAll.length} 门`);
  log(priAll.every((c) => c.category !== '专项提升' || c.stage === 'primary'), '小学账号只看到小学专项课程');
  log(junAll.some((c) => c.category === '中考冲刺'), '初中账号能看到中考冲刺课程（7~9 年级都能看到）');
  log(junAll.some((c) => c.category === '专项提升' && c.stage === 'junior'), '初中账号能看到初中专项课程');
  log(junAll.every((c) => c.category !== '专项提升' || c.stage === 'junior'), '初中账号看不到小学专项课程');
  // 专项 / 中考不按年级和上下册过滤：九年级账号也能看到七年级的初中专项
  const jun9 = await mkStu('九年级', 'junior');
  const jun9All = await allCourses(jun9.tok);
  log(jun9All.some((c) => c.category === '专项提升'), '专项课程不看年级：九年级账号也能看到初中专项课');
  // 直接改地址也拦得住
  const examCh = (await json('/api/admin/chapters?category=' + encodeURIComponent('中考冲刺'), { headers: { Authorization: 'Bearer ' + aLogin.data.token } })).data[0];
  if (examCh) {
    const deny = await json('/api/stu/course-detail?id=' + examCh.id, { headers: { Authorization: 'Bearer ' + pri.tok } });
    log(deny.code !== 0, '小学账号直接访问中考冲刺课程被拒绝', deny.msg);
    const allow = await json('/api/stu/course-detail?id=' + examCh.id, { headers: { Authorization: 'Bearer ' + jun.tok } });
    log(allow.code === 0, '初中账号可以直接访问中考冲刺课程');
  }
  // 学生端分类标签随学段变化
  let stDom = await boot('/', { token: pri.tok, user: pri.user, hash: '#/courses' });
  await wait(1800);
  const stDoc = stDom.window.document;
  log(stDoc.querySelectorAll('.st-tabs [data-cat]').length === 3, '小学账号顶栏只有 3 个分类（无中考冲刺）',
    [...stDoc.querySelectorAll('.st-tabs [data-cat]')].map((a) => a.textContent.trim().replace(/\d+$/, '')).join('、'));
  stDom.window.close();
  stDom = await boot('/', { token: jun.tok, user: jun.user, hash: '#/courses' });
  await wait(1800);
  log(stDom.window.document.querySelectorAll('.st-tabs [data-cat]').length === 4, '初中账号顶栏 4 个分类（含中考冲刺）');
  stDom.window.close();
  // 清理测试账号
  for (const s of [pri, jun, jun9]) {
    if (s.id) await fetch(BASE + '/api/admin/students/' + s.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aLogin.data.token } });
  }
  const badRow = await json('/api/admin/students?kw=UISTGX', { headers: { Authorization: 'Bearer ' + aLogin.data.token } });
  for (const r of badRow.data || []) await fetch(BASE + '/api/admin/students/' + r.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aLogin.data.token } });
  log(true, '学段测试账号已清理');

  // 分校账号登录：看不到「分校管理」入口
  const brUser = 'BRUI' + Date.now().toString().slice(-6);
  const brCreate = await adminPost('/api/admin/branches', aLogin.data.token, { name: 'UI测试分校', username: brUser, password: '123456' });
  const bl = await json('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: brUser, password: '123456', role: 'admin' }),
  });
  if (bl.data) {
    dom = await boot('/admin/', { token: bl.data.token, user: bl.data.user, hash: '#/dash' });
    await wait(1800);
    const navTexts = [...dom.window.document.querySelectorAll('.nav a')].map((a) => a.textContent);
    log(!navTexts.some((t) => t.includes('分校管理')), '分校后台不显示分校管理入口');
    log(text(dom).includes('分校后台'), '分校后台标题正确');
    dom.window.close();
  }
  if (brCreate.data && brCreate.data.id) await fetch(BASE + '/api/admin/branches/' + brCreate.data.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aLogin.data.token } });
  // 清理临时学生
  if (tempStu) {
    const tl = await json('/api/admin/students?kw=' + tempStu, { headers: { Authorization: 'Bearer ' + aLogin.data.token } });
    const tr = (tl.data || [])[0];
    if (tr) await json('/api/admin/students/' + tr.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + aLogin.data.token } });
  }

  console.log('\n【运行期错误】');
  if (errors.length) errors.forEach((e) => log(false, 'JS 错误', e));
  else log(true, '无 JS 运行错误');

  console.log(`\n=== 结果： 通过 ${pass} 项，失败 ${fail} 项 ===\n`);
  process.exit(fail ? 1 : 0);
})();
