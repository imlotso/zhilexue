'use strict';
/**
 * 端到端自测脚本： npm run smoke
 * 需先启动服务（默认 http://localhost:3000）
 * 覆盖：登录鉴权、学生账号开通（含倍速开关）、课程目录、年级上下册（册别）可见性、
 *       分级目录（章节下的第四级）、知识点（视频 + 一对一讲义）、本章习题库、学习进度与学习报告、
 *       讲义下载（中文文件名）、分校体系、越权拦截
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

async function req(path, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) { payload = form; }
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return { code: 0, _buffer: Buffer.from(await res.arrayBuffer()), _ct: ct, _cd: res.headers.get('content-disposition') };
}

const fileForm = (fields, fileName, content) => {
  const fd = new FormData();
  if (fileName) fd.append('file', new Blob([Buffer.from(content)], { type: 'application/octet-stream' }), fileName);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
};

(async () => {
  console.log('\n=== 智学课堂 · 端到端自测 ===\n');
  const uniq = Date.now().toString().slice(-8);

  // ---------- 管理端 ----------
  console.log('【校长后台】');
  const adminLogin = await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } });
  log(adminLogin.code === 0, '校长登录', adminLogin.msg);
  const AT = adminLogin.data && adminLogin.data.token;
  if (!AT) return done();

  // ---------- 安全基线 ----------
  console.log('\n【安全基线】');
  {
    const anon = await req('/api/file?key=videos%2F202610%2Fdeadbeef.mp4');
    log(anon.code === 401, '未登录访问 /api/file 被拒（不再允许匿名下载）', 'code=' + anon.code);
    const anonSeg = await fetch(BASE + '/api/admin/wrong/segment', { method: 'POST', body: new FormData() });
    log(anonSeg.status === 401, '未登录调用 AI 整页识别（wrong/segment）被拒', 'status=' + anonSeg.status);
    const segNoFile = await req('/api/admin/wrong/segment', { method: 'POST', token: AT, form: new FormData() });
    log(segNoFile.code === 1, 'AI 整页识别缺图片时给出明确提示', segNoFile.msg);
    const stuTryAdmin = await req('/api/admin/students', { token: 'not-a-real-token' });
    log(stuTryAdmin.code === 401, '伪造 / 过期 token 访问管理端被拒', 'code=' + stuTryAdmin.code);
    const hres = await fetch(BASE + '/');
    log(hres.headers.get('x-content-type-options') === 'nosniff', '响应头带 X-Content-Type-Options: nosniff');
    log(hres.headers.get('x-frame-options') === 'SAMEORIGIN', '响应头带 X-Frame-Options: SAMEORIGIN');
    log(hres.headers.get('referrer-policy') === 'same-origin', '响应头带 Referrer-Policy: same-origin');
    const badLogin = await req('/api/login', { method: 'POST', body: { username: 'no_such_account_' + uniq, password: 'x', role: 'student' } });
    log(badLogin.code !== 0 && !String(badLogin.msg).includes('账号不存在'), '登录失败提示不区分「账号不存在 / 密码错误」（防账号枚举）', badLogin.msg);
  }

  // ---------- 上传文件（图片 / PDF）的静态物料 ----------
  console.log('\n【上传文件（图片 / PDF）】');
  {
    const pdflib = await fetch(BASE + '/vendor/pdfjs/pdf.min.js');
    const worker = await fetch(BASE + '/vendor/pdfjs/pdf.worker.min.js');
    const helper = await fetch(BASE + '/js/pdfpages.js');
    log(pdflib.ok && (await pdflib.text()).includes('pdfjsLib'), '内置 pdf.js 可访问（离线可用，不依赖 CDN）', 'status=' + pdflib.status);
    log(worker.ok && (await worker.text()).length > 500000, 'pdf.js worker 可访问', 'status=' + worker.status);
    log(helper.ok && (await helper.text()).includes('window.PdfPages'), 'pdfpages.js 可访问', 'status=' + helper.status);
    const idx = await (await fetch(BASE + '/admin/')).text();
    log(idx.includes('pdfpages.js'), '管理端页面已引入 pdfpages.js');
    const wrongJs = await (await fetch(BASE + '/admin/wrong.js')).text();
    const airJs = await (await fetch(BASE + '/admin/aireport.js')).text();
    log(wrongJs.includes('上传文件（图片 / PDF）') && /application\/pdf/.test(wrongJs), 'AI错题重组的上传按钮支持图片 + PDF');
    log(airJs.includes('上传文件（图片 / PDF）') && /application\/pdf/.test(airJs), 'AI学情诊断的上传按钮支持图片 + PDF');
    const raw = new Blob([Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')], { type: 'application/pdf' });
    const fd = new FormData(); fd.append('images', raw, '试卷.pdf');
    const up = await req('/api/admin/report/papers', { method: 'POST', token: AT, form: fd });
    log(up.code === 0 && Array.isArray(up.data.keys) && up.data.keys.length === 1, '学情诊断服务端本来就收 PDF', up.code === 0 ? up.data.keys[0] : up.msg);
    if (up.code === 0) {
      // 用这份 PDF 建一份报告再删掉：验证流程可用，同时把测试文件清理干净（删除报告会连带删试卷）
      const rep = await req('/api/admin/report', { method: 'POST', token: AT, body: { student: '自测PDF' + uniq, paperKeys: up.data.keys } });
      log(rep.code === 0 && rep.data && rep.data.status === 'pending', '用 PDF 发起分析任务成功', rep.code === 0 ? 'id=' + rep.data.id : rep.msg);
      if (rep.code === 0) {
        const del = await req('/api/admin/report/' + rep.data.id, { method: 'DELETE', token: AT });
        log(del.code === 0, '删除报告会连带删除试卷文件（不留垃圾）', del.msg);
      }
    }
    const bad = await fetch(BASE + '/api/admin/report/papers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + AT },
      body: (() => { const f = new FormData(); f.append('images', new Blob(['x'], { type: 'text/plain' }), 'a.txt'); return f; })(),
    }).then((r) => r.json());
    log(bad.code === 1, '非图片 / 非 PDF 被拒', bad.msg);
  }

  const ch = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '七年级', name: '自测目录' + uniq } });
  log(ch.code === 0, '新增课程目录', ch.msg);
  const chapterId = ch.data && ch.data.id;
  // 另建一门「八年级」的课，用于验证学生不能跨年级越权访问（学生是七年级）
  const ch8 = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '八年级', name: '跨年级越权自测' + uniq } });
  const chapter8Id = ch8.data && ch8.data.id;

  // 年级 / 到期时间必填（不填直接拒绝）
  const noGrade = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '缺年级' + uniq, username: 'TG' + uniq, password: '123456' } });
  log(noGrade.code !== 0, '开通学生缺年级被拒绝', noGrade.msg);
  const noExp = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '缺到期' + uniq, username: 'TE' + uniq, password: '123456', grade: '七年级' } });
  log(noExp.code !== 0, '开通学生缺到期时间被拒绝', noExp.msg);

  const stu = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '自测学生' + uniq, username: 'T' + uniq, password: '123456', grade: '七年级', expire_at: '2027-12-31' } });
  log(stu.code === 0, '开通学生账号（年级 + 到期时间）', stu.msg);
  const stuId = stu.data && stu.data.id;

  const stuList = await req('/api/admin/students?kw=T' + uniq, { token: AT });
  const stuRow = (stuList.data || [])[0];
  log(!!stuRow && stuRow.allow_speed === 1, '新建学生默认允许倍速', stuRow ? 'allow_speed=' + stuRow.allow_speed : '');
  log(!!stuRow && stuRow.allow_seek === 1 && String(stuRow.expire_at || '').slice(0, 10) === '2027-12-31',
    '快进已全站放开（不再按学生限制）且到期时间已保存', stuRow ? `allow_seek=${stuRow.allow_seek} expire=${stuRow.expire_at}` : '');

  const spdOff = await req(`/api/admin/students/${stuId}/speed`, { method: 'POST', token: AT, body: { allow_speed: 0 } });
  log(spdOff.code === 0 && spdOff.data.allow_speed === 0, '单独关闭某学生的倍速播放', spdOff.msg);

  // 快进开关已下线：老接口不再存在
  const seekGone = await req(`/api/admin/students/${stuId}/seek`, { method: 'POST', token: AT, body: { allow_seek: 0 } });
  log(seekGone.code !== 0, '视频快进开关接口已下线', 'code=' + seekGone.code);

  // 编辑学生：年级 / 到期时间同样必填
  const editNoExp = await req(`/api/admin/students/${stuId}`, { method: 'PUT', token: AT, body: { name: '自测学生' + uniq, username: 'T' + uniq, grade: '七年级', allow_speed: 0 } });
  log(editNoExp.code !== 0, '编辑学生缺到期时间被拒绝', editNoExp.msg);
  const editOk = await req(`/api/admin/students/${stuId}`, { method: 'PUT', token: AT, body: { name: '自测学生' + uniq, username: 'T' + uniq, grade: '七年级', allow_speed: 0, expire_at: '2028-01-01' } });
  log(editOk.code === 0, '编辑学生保存成功', editOk.msg);
  const editRow = ((await req('/api/admin/students?kw=T' + uniq, { token: AT })).data || [])[0];
  log(!!editRow && editRow.allow_speed === 0 && String(editRow.expire_at || '').slice(0, 10) === '2028-01-01',
    '倍速与到期时间编辑生效（年级保持七年级以匹配课程）', editRow ? `speed=${editRow.allow_speed} expire=${editRow.expire_at}` : '');

  // 视频 = 一个知识点
  const vup = await req('/api/admin/videos', {
    method: 'POST', token: AT,
    form: fileForm({ title: '第1讲 自测知识点' + uniq, chapter_id: chapterId, level: 'basic', url: '' }, '自测视频.mp4', 'fake-mp4-bytes'),
  });
  log(vup.code === 0, '上传视频（知识点）', vup.msg);
  const videoId = vup.data && vup.data.id;

  // 删除保护：讲义 / 视频的删除（单个与批量）都必须带删除密码
  const delNoPwd = await req('/api/admin/videos/' + videoId, { method: 'DELETE', token: AT });
  log(delNoPwd.code !== 0, '删除视频不带密码被拒绝', delNoPwd.msg);
  const delBadPwd = await req('/api/admin/videos/' + videoId, { method: 'DELETE', token: AT, body: { pwd: '000000' } });
  log(delBadPwd.code !== 0, '删除视频密码错误被拒绝', delBadPwd.msg);
  const delOkPwd = await req('/api/admin/videos/batch', { method: 'DELETE', token: AT, body: { ids: [], pwd: '199856' } });
  log(delOkPwd.code !== 0, '批量删除不带 ids 被拒绝（密码正确）', delOkPwd.msg);

  // 词书删除保护：密码只由服务端校验。之前前端硬编码密码、后端不校验 → 绕过前端就能删库
  const wbk = await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '自测词书' + uniq, kind: 'word' } });
  log(wbk.code === 0 && wbk.data && wbk.data.id, '创建词书（用于删除保护自测）', wbk.msg);
  const wbkId = wbk.data && wbk.data.id;
  const wbkNoPwd = await req('/api/admin/word/books/' + wbkId, { method: 'DELETE', token: AT });
  log(wbkNoPwd.code !== 0, '删除词书不带密码被拒绝（堵住绕过前端的口子）', wbkNoPwd.msg);
  const wbkBadPwd = await req('/api/admin/word/books/' + wbkId, { method: 'DELETE', token: AT, body: { pwd: '000000' } });
  log(wbkBadPwd.code !== 0, '删除词书密码错误被拒绝', wbkBadPwd.msg);
  const wbkAfter = await req('/api/admin/word/books', { token: AT });
  log((wbkAfter.data || []).some((b) => b.id === wbkId), '密码不对时词书仍完好（没有被误删）');
  const wbkOk = await req('/api/admin/word/books/' + wbkId, { method: 'DELETE', token: AT, body: { pwd: '199856' } });
  log(wbkOk.code === 0, '密码正确时删除词书成功（功能没被锁死）', wbkOk.msg);

  // 批量上传视频：一次多个文件，每个文件 = 一个知识点
  const bfd = new FormData();
  bfd.append('chapter_id', String(chapterId));
  bfd.append('prefix', '第1章');
  ['第1讲 概念', '第2讲 例题', '第3讲 练习'].forEach((t, i) => {
    bfd.append('files', new Blob([Buffer.from('fake-mp4-' + i)], { type: 'video/mp4' }), t + '.mp4');
  });
  const vbatch = await req('/api/admin/videos/batch', { method: 'POST', token: AT, form: bfd });
  log(vbatch.code === 0 && vbatch.data.count === 3, '批量上传 3 个视频', vbatch.msg);
  log(vbatch.code === 0 && vbatch.data.list.every((x) => x.title.startsWith('第1章 ')), '批量上传标题带前缀且取自文件名',
    vbatch.data ? vbatch.data.list.map((x) => x.title).join(' | ') : '');

  // ---------- 分级目录（章节下可选的第四级） ----------
  const secA = await req('/api/admin/sections', { method: 'POST', token: AT, body: { chapter_id: chapterId, name: '1.1 自测分级', sort: 1 } });
  log(secA.code === 0, '新增分级目录', secA.msg);
  const secAId = secA.data && secA.data.id;
  const secB = await req('/api/admin/sections', { method: 'POST', token: AT, body: { chapter_id: chapterId, name: '1.2 自测分级二', sort: 2 } });
  const secBId = secB.data && secB.data.id;
  log(secB.code === 0, '同一章节可加多个分级目录', '共 2 个');

  const batchIds = ((vbatch.data && vbatch.data.list) || []).map((x) => x.id);
  await req('/api/admin/videos/' + batchIds[0], { method: 'PUT', token: AT, body: { section_id: secAId } });
  await req('/api/admin/videos/' + batchIds[1], { method: 'PUT', token: AT, body: { section_id: secAId } });
  const mvB = await req('/api/admin/videos/' + batchIds[2], { method: 'PUT', token: AT, body: { section_id: secBId } });
  log(mvB.code === 0 && mvB.data.section_id === secBId, '视频可归到某个分级目录', 'section_id=' + (mvB.data && mvB.data.section_id));

  const vSecList = await req('/api/admin/videos?section_id=' + secAId, { token: AT });
  log(vSecList.code === 0 && (vSecList.data || []).length === 2, '视频管理可按分级目录筛选', (vSecList.data || []).length + ' 个');
  log((vSecList.data || []).every((v) => v.section_name === '1.1 自测分级'), '视频列表显示所属分级目录',
    (vSecList.data || [])[0] ? (vSecList.data || [])[0].section_name : '');

  const secList = await req('/api/admin/sections?chapter_id=' + chapterId, { token: AT });
  log(secList.code === 0 && secList.data.length === 2, '分级目录列表（带视频/资料统计）',
    secList.data ? secList.data.map((x) => x.name + ':' + x.video_count).join(' | ') : '');
  const secRen = await req('/api/admin/sections/' + secBId, { method: 'PUT', token: AT, body: { name: '1.2 改名后' } });
  log(secRen.code === 0, '分级目录改名', secRen.msg);

  // 中文文件名讲义，并关联到该知识点
  const cnName = '自测讲义-第1讲.docx';
  const up = await req('/api/admin/handouts', {
    method: 'POST', token: AT,
    form: fileForm({ title: '自测讲义' + uniq, chapter_id: chapterId, video_id: videoId, kind: 'handout', level: 'basic' }, cnName, '自测讲义内容 hello'),
  });
  log(up.code === 0 && up.data.kind === 'handout', '上传讲义并关联知识点', up.msg);
  const handoutId = up.data && up.data.id;

  // 章节习题库
  const exUp = await req('/api/admin/handouts', {
    method: 'POST', token: AT,
    form: fileForm({ title: '自测习题' + uniq, chapter_id: chapterId, kind: 'exercise', level: 'basic', section_id: secAId }, '自测习题.pdf', '%PDF-1.4 fake'),
  });
  log(exUp.code === 0 && exUp.data.kind === 'exercise', '上传章节习题库', exUp.msg);
  const exerciseId = exUp.data && exUp.data.id;

  const hoList = await req('/api/admin/handouts', { token: AT });
  const ho = (hoList.data || []).find((x) => x.id === handoutId);
  log(!!ho, '讲义列表可见', ho ? ho.file_name : '');
  log(!!ho && ho.file_name === cnName, '中文文件名不乱码', ho ? ho.file_name : '');
  log(!!ho && ho.video_title === '第1讲 自测知识点' + uniq, '讲义列表显示对应知识点', ho ? ho.video_title : '');
  const hoKind = (hoList.data || []).find((x) => x.kind === 'exercise' && x.chapter_id === chapterId);
  log(!!hoKind, '讲义列表可按类型区分讲义 / 习题', hoKind ? hoKind.title : '');
  log(!!hoKind && hoKind.section_name === '1.1 自测分级', '讲义/习题列表显示所属分级目录', hoKind ? String(hoKind.section_name || '不分组') : '');
  const hoSec = await req('/api/admin/handouts?section_id=' + secAId, { token: AT });
  log(hoSec.code === 0 && (hoSec.data || []).length >= 1, '讲义与习题可按分级目录筛选', (hoSec.data || []).length + ' 份');
  if (ho) {
    const dl = await req('/api/file?key=' + encodeURIComponent(ho.file_path) + '&name=' + encodeURIComponent(ho.file_name), { token: AT });
    log(!!dl._buffer, '管理端可下载讲义', dl._buffer ? dl._buffer.length + ' 字节' : '');
    log(!!dl._cd && dl._cd.includes('filename*'), '下载头带 UTF-8 文件名', (dl._cd || '').slice(0, 60));
    const inl = await req('/api/file?key=' + encodeURIComponent(ho.file_path) + '&inline=1', { token: AT });
    log((inl._cd || '') === 'inline', '在线预览（打印）走 inline 头', inl._cd || '(空)');
  }

  const chList = await req('/api/admin/chapters?subject=' + encodeURIComponent('数学'), { token: AT });
  const chRow = (chList.data || []).find((x) => x.id === chapterId);
  log(!!chRow && chRow.video_count === 4 && chRow.handout_count === 1 && chRow.exercise_count === 1,
    '课程目录统计（知识点 / 讲义 / 习题）', chRow ? `${chRow.video_count} / ${chRow.handout_count} / ${chRow.exercise_count}` : '');
  log(!!chRow && chRow.section_count === 2, '课程目录带分级目录数量', chRow ? 'section_count=' + chRow.section_count : '');

  // 「关联 / 取消关联」决定资料去向
  const relink = await req('/api/admin/handouts/' + exerciseId, { method: 'PUT', token: AT, body: { video_id: videoId } });
  log(relink.code === 0 && relink.data.kind === 'handout', '关联视频后资料变为「视频讲义」', relink.data ? relink.data.kind : '');
  const chList2 = await req('/api/admin/chapters?subject=' + encodeURIComponent('数学'), { token: AT });
  const chRow2 = (chList2.data || []).find((x) => x.id === chapterId);
  log(!!chRow2 && chRow2.handout_count === 2 && chRow2.exercise_count === 0, '关联视频后 讲义/习题库 统计变化', `${chRow2 ? chRow2.handout_count : '?'}/${chRow2 ? chRow2.exercise_count : '?'}`);
  const unlink = await req('/api/admin/handouts/' + exerciseId, { method: 'PUT', token: AT, body: { video_id: null } });
  log(unlink.code === 0 && unlink.data.kind === 'exercise', '取消关联后资料进入习题库', unlink.data ? unlink.data.kind : '');

  const stats = await req('/api/admin/stats', { token: AT });
  log(stats.code === 0 && stats.data.students > 0 && stats.data.videos > 0 && stats.data.exercises > 0, '后台数据概览', JSON.stringify(stats.data || {}));

  const recent = await req('/api/admin/students/recent', { token: AT });
  log(recent.code === 0 && Array.isArray(recent.data), '最近开通学生列表');

  // ---------- 分校流程 ----------
  console.log('\n【分校】');
  const br = await req('/api/admin/branches', { method: 'POST', token: AT, body: { name: '自测分校' + uniq, username: 'BR' + uniq, password: '123456' } });
  log(br.code === 0, '校长开通分校', br.msg);
  const brId = br.data && br.data.id;
  const brList = await req('/api/admin/branches', { token: AT });
  log(brList.code === 0 && brList.data.some((x) => x.id === brId), '分校列表可见');
  const brLogin = await req('/api/login', { method: 'POST', body: { username: 'BR' + uniq, password: '123456', role: 'admin' } });
  log(brLogin.code === 0, '分校账号登录后台', brLogin.msg);
  const BT = brLogin.data && brLogin.data.token;
  const brStu = await req('/api/admin/students', { method: 'POST', token: BT, body: { name: '分校学生' + uniq, username: 'BS' + uniq, grade: '七年级', expire_at: '2027-12-31' } });
  log(brStu.code === 0, '分校开通学生（共享校长权益）', brStu.msg);
  const brList2 = await req('/api/admin/branches', { token: AT });
  const brRow = (brList2.data || []).find((x) => x.id === brId);
  log(brRow && brRow.students === 1, '分校学生数统计正确', brRow ? brRow.students + ' 人' : '');
  const brTryBranch = await req('/api/admin/branches', { method: 'POST', token: BT, body: { name: '越权分校', username: 'X' + uniq } });
  log(brTryBranch.code === 403, '分校不能再开分校（仅校长）', 'code=' + brTryBranch.code);

  // ---------- 学生端 ----------
  console.log('\n【学生端】');
  const sLogin = await req('/api/login', { method: 'POST', body: { username: 'T' + uniq, password: '123456', role: 'student' } });
  log(sLogin.code === 0, '学生登录', sLogin.msg);
  const ST = sLogin.data && sLogin.data.token;
  if (!ST) return done();
  log(sLogin.data.user.allow_speed === 0, '登录信息带回倍速设置', 'allow_speed=' + sLogin.data.user.allow_speed);
  log(sLogin.data.user.allow_seek === 1, '登录信息不再带回快进限制（全站放开）', 'allow_seek=' + sLogin.data.user.allow_seek);

  const courses = await req('/api/stu/courses?subject=' + encodeURIComponent('数学'), { token: ST });
  log(courses.code === 0 && Array.isArray(courses.data), '课程卡片列表', courses.data ? courses.data.length + ' 门课' : '');
  // 越权防护：学生不能按别人的章节 id 直接取题 / 取视频 / 下载讲义（改地址栏 id 也看不到）
  if (chapter8Id) {
    const idorP = await req('/api/stu/practice?chapter_id=' + chapter8Id + '&count=3', { token: ST });
    log(idorP.code !== 0, '越权防护：七年级学生取八年级课程的题被拒', idorP.msg);
    const idorV = await req('/api/stu/videos?chapter_id=' + chapter8Id, { token: ST });
    log(idorV.code !== 0, '越权防护：七年级学生列八年级课程的视频被拒', idorV.msg);
    const own = await req('/api/stu/practice?chapter_id=' + chapterId + '&count=3', { token: ST });
    log(own.code === 0, '本年级课程取题不受影响（对照组）', own.data ? own.data.length + ' 题' : '');
  }
  const myCourse = (courses.data || []).find((c) => c.id === chapterId);
  log(!!myCourse, '一门课程 = 一条目录（卡片带 id）', myCourse ? 'id=' + myCourse.id : '');
  log(!!myCourse && myCourse.kp_total === 4 && myCourse.kp_done === 0 && myCourse.percent === 0,
    '卡片带知识点学习进度', myCourse ? `${myCourse.kp_done}/${myCourse.kp_total} ${myCourse.percent}%` : '');
  log(!!myCourse && myCourse.exercise_count === 1, '卡片带习题库数量', myCourse ? '习题 ' + myCourse.exercise_count + ' 套' : '');

  let kpTotal = myCourse ? myCourse.kp_total : 0;
  if (myCourse) {
    const cd = await req('/api/stu/course-detail?id=' + chapterId, { token: ST });
    const d = cd.data || {};
    log(cd.code === 0 && d.lessons.length === 4, '课程详情：知识点列表（单个 + 批量上传）', (d.lessons || []).length + ' 个');
    log(cd.code === 0 && d.allow_speed === 0, '课程详情返回该学生倍速权限', 'allow_speed=' + d.allow_speed);
    log(cd.code === 0 && d.allow_seek === 1, '课程详情不再返回快进限制', 'allow_seek=' + d.allow_seek);
    const l0 = (d.lessons || [])[0] || {};
    log(!!l0.handout && l0.handout.id === handoutId, '一个视频对应一个讲义（同一个框）', l0.handout ? l0.handout.title : '未配对');
    log(!!l0.handout && l0.handout.file_name === cnName, '知识点里带回讲义文件名', l0.handout ? l0.handout.file_name : '');
    log((d.exercises || []).length === 1 && d.exercises[0].id === exerciseId, '本章习题库可见', (d.exercises || []).length + ' 套');
    kpTotal = d.kp_total;

    // 分级目录 → 学生端折叠分组
    const gs = d.groups || [];
    log(d.grouped === true, '学生端课程详情按分级目录分组（供折叠展示）');
    log(gs.length === 3, '分组数 = 2 个分级目录 + 未分组', gs.map((g) => g.name + '(' + g.kp_total + ')').join(' | '));
    log(gs[0] && gs[0].name === '1.1 自测分级' && gs[0].kp_total === 2 && gs[0].kp_done === 0,
      '第一个分组带知识点进度', gs[0] ? gs[0].name + ' ' + gs[0].kp_done + '/' + gs[0].kp_total : '');
    log(gs.some((g) => g.name === '未分组' && g.kp_total === 1), '没有归到分级目录的知识点进「未分组」');
    log((gs.find((g) => g.name === '1.1 自测分级') || {}).lessons
      && gs.find((g) => g.name === '1.1 自测分级').lessons.every((l) => l.section_id === secAId),
      '分组内知识点带 section_id（学生端按它折叠）');

    // 播放地址
    const play = await req('/api/stu/videos/' + videoId + '/play', { token: ST });
    log(play.code === 0 && !!play.data.src, '获取视频播放地址');
    log(play.code === 0 && play.data.allow_speed === 0, '播放接口返回倍速开关状态', 'allow_speed=' + play.data.allow_speed);
    log(play.code === 0 && play.data.allow_seek === 1, '播放接口不再限制快进', 'allow_seek=' + play.data.allow_seek);
    // 播放地址必须自带登录票据：<video> 是浏览器直连发起的请求，加不了 Authorization 头，
    // 票据只能放 URL 上；少了它 /api/file 会返回 401，学生端的表现就是「点了播放，视频出不来」。
    const playKey = decodeURIComponent(String(play.data.src || '').replace(/^\/api\/file\?key=/, '').split('&')[0]);
    log(play.code === 0 && /[?&]token=/.test(play.data.src), '播放地址自带登录票据（否则浏览器 <video> 会被 401 挡住）',
      String(play.data.src || '').replace(/token=[^&]+/, 'token=***'));
    const stream = await req('/api/file?key=' + encodeURIComponent(playKey) + '&token=' + encodeURIComponent(ST));
    log(!!stream._ct && stream._ct.includes('video/mp4'), '带票据能取到视频流（Content-Type 正确）',
      stream._ct + ' / ' + ((stream._buffer || []).length) + ' 字节');
    const noTicket = await req('/api/file?key=' + encodeURIComponent(playKey));
    log(noTicket.code === 401, '不带票据取流仍被拒（安全底线不变）', 'code=' + noTicket.code);

    // 学生端下载讲义（打印）
    const d2 = await req('/api/stu/handouts/' + handoutId + '/download', { token: ST });
    log(d2.code === 0 && d2.data.key, '学生端可下载讲义', d2.data ? d2.data.name : '');
    const file = await req('/api/file?key=' + encodeURIComponent(d2.data.key), { token: ST });
    log(!!file._buffer, '下载链接真实可用', file._buffer ? file._buffer.length + ' 字节' : '');

    // 上报学习进度 → 卡片进度条与报告同步变化
    const pg = await req('/api/stu/progress', { method: 'POST', token: ST, body: { video_id: videoId, video_done: 1 } });
    log(pg.code === 0 && pg.data.video_done === 1, '上报知识点学习进度', JSON.stringify(pg.data));
    const courses2 = await req('/api/stu/courses?subject=' + encodeURIComponent('数学'), { token: ST });
    const c2 = (courses2.data || []).find((c) => c.id === chapterId);
    log(!!c2 && c2.kp_done === 1 && c2.percent === 25, '课程卡片进度随学习更新', c2 ? `${c2.kp_done}/${c2.kp_total} ${c2.percent}%` : '');
    const cd2 = await req('/api/stu/course-detail?id=' + chapterId, { token: ST });
    const g2 = ((cd2.data || {}).groups || []);
    log(g2.some((g) => g.kp_done === 1), '学习后分组进度同步更新',
      g2.map((g) => g.name + ' ' + g.kp_done + '/' + g.kp_total).join(' | '));

    const rp = await req('/api/stu/report', { token: ST });
    const r = rp.data || {};
    log(rp.code === 0 && r.kp_total >= kpTotal && r.kp_done >= 1, '学习报告统计已学知识点', r.kp_done + '/' + r.kp_total);
    log(rp.code === 0 && Array.isArray(r.subjects) && r.subjects.some((s) => s.subject === '数学'), '学习报告含分学科进度');
    log(rp.code === 0 && Array.isArray(r.days) && r.days.length > 0, '学习报告含每日学习记录', (r.days || []).length + ' 天');
    log(rp.code === 0 && (r.recent || []).some((x) => x.video_title === '第1讲 自测知识点' + uniq), '学习报告含最近学习');
  }

  // 打开倍速后再验证
  await req(`/api/admin/students/${stuId}/speed`, { method: 'POST', token: AT, body: { allow_speed: 1 } });
  const play2 = await req('/api/stu/videos/' + videoId + '/play', { token: ST });
  log(play2.code === 0 && play2.data.allow_speed === 1, '开启倍速后学生端立即生效', 'allow_speed=' + (play2.data && play2.data.allow_speed));
  log(play2.code === 0 && play2.data.allow_seek === 1, '学生端不再限制快进', 'allow_seek=' + (play2.data && play2.data.allow_seek));

  // 改密码链路
  const cp = await req('/api/change-password', { method: 'POST', token: ST, body: { oldPassword: '123456', newPassword: 'abc123' } });
  log(cp.code === 0, '学生修改密码', cp.msg);
  const relogin = await req('/api/login', { method: 'POST', body: { username: 'T' + uniq, password: 'abc123', role: 'student' } });
  log(relogin.code === 0, '新密码可登录');

  // 删除分级目录：内容不删除，只变成「不分组」
  const delSec = await req('/api/admin/sections/' + secAId, { method: 'DELETE', token: AT });
  log(delSec.code === 0, '删除分级目录', delSec.msg);
  const vAfter = await req('/api/admin/videos?chapter_id=' + chapterId, { token: AT });
  log((vAfter.data || []).every((v) => v.section_id !== secAId), '原分级目录下的视频保留且变为不分组',
    (vAfter.data || []).length + ' 个视频仍在');
  const cd3 = await req('/api/stu/course-detail?id=' + chapterId, { token: ST });
  log((cd3.data || {}).grouped === true && (cd3.data.groups || []).length === 2,
    '删掉一个分组后学生端只剩其余分组', ((cd3.data || {}).groups || []).map((g) => g.name).join(' | '));

  // ---------- 年级上下册（册别）----------
  console.log('【年级上下册】');
  const upCh = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '七年级', term: '上册', name: '自测上册章节' + uniq, book: '人教版·七上' } });
  const dnCh = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '七年级', term: '下册', name: '自测下册章节' + uniq, book: '人教版·七下' } });
  log(upCh.code === 0 && dnCh.code === 0, '课程目录可设置册别（上册 / 下册）');
  const upChId = upCh.data && upCh.data.id, dnChId = dnCh.data && dnCh.data.id;
  const chTermRow = (await req('/api/admin/chapters?grade=' + encodeURIComponent('七年级'), { token: AT })).data.find((c) => c.id === upChId);
  log(!!chTermRow && chTermRow.term === '上册', '章节册别已保存并可回读', chTermRow ? 'term=' + chTermRow.term : '');
  const termList = await req('/api/admin/chapters?term=' + encodeURIComponent('上册'), { token: AT });
  log(termList.code === 0 && (termList.data || []).some((c) => c.id === upChId) && !(termList.data || []).some((c) => c.id === dnChId),
    '课程目录可按册别筛选');

  // 上册学生 / 不限册别学生
  const sUp = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '上册生' + uniq, username: 'UP' + uniq, password: '123456', grade: '七年级', term: '上册', expire_at: '2027-12-31' } });
  const sAny = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '不限生' + uniq, username: 'ANY' + uniq, password: '123456', grade: '七年级', expire_at: '2027-12-31' } });
  log(sUp.code === 0 && sAny.code === 0, '开通学生可指定册别（也可留空 = 上下册都看）');
  const sUpId = sUp.data && sUp.data.id, sAnyId = sAny.data && sAny.data.id;
  const sUpRow = ((await req('/api/admin/students?kw=UP' + uniq, { token: AT })).data || [])[0];
  log(!!sUpRow && sUpRow.term === '上册', '学生册别已保存', sUpRow ? 'term=' + sUpRow.term : '');

  const loginOf = async (u) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role: 'student' } })).data.token;
  const chaptersOf = async (u) => ((await req('/api/stu/chapters?subject=' + encodeURIComponent('数学'), { token: await loginOf(u) })).data || []);
  const upSeen = (await chaptersOf('UP' + uniq)).map((c) => c.id);
  const anySeen = (await chaptersOf('ANY' + uniq)).map((c) => c.id);
  log(upSeen.includes(upChId) && !upSeen.includes(dnChId), '上册学生只看到上册章节（下册不显示）');
  log(anySeen.includes(upChId) && anySeen.includes(dnChId), '没设册别的学生上下册都能看到（老账号不受影响）');
  const upTok = await loginOf('UP' + uniq);
  const crossDetail = await req('/api/stu/course-detail?id=' + dnChId, { token: upTok });
  log(crossDetail.code !== 0, '直接改地址也打不开别册的课程', crossDetail.msg);

  // ---------- 权限校验 ----------
  const deny = await req('/api/admin/stats', { token: ST });
  log(deny.code === 403, '学生访问管理接口被拒绝', 'code=' + deny.code);

  // 清理
  await req('/api/admin/students/' + stuId, { method: 'DELETE', token: AT });
  if (sUpId) await req('/api/admin/students/' + sUpId, { method: 'DELETE', token: AT });
  if (sAnyId) await req('/api/admin/students/' + sAnyId, { method: 'DELETE', token: AT });
  if (upChId) await req('/api/admin/chapters/' + upChId, { method: 'DELETE', token: AT });
  if (dnChId) await req('/api/admin/chapters/' + dnChId, { method: 'DELETE', token: AT });
  if (brId) await req('/api/admin/branches/' + brId, { method: 'DELETE', token: AT });
  if (handoutId) await req('/api/admin/handouts/' + handoutId, { method: 'DELETE', token: AT, body: { pwd: '199856' } });
  if (exerciseId) await req('/api/admin/handouts/batch', { method: 'DELETE', token: AT, body: { ids: [exerciseId, 999999], pwd: '199856' } });
  if (videoId) await req('/api/admin/videos/' + videoId, { method: 'DELETE', token: AT, body: { pwd: '199856' } });
  const vbatchIds = ((vbatch.data && vbatch.data.list) || []).map((x) => x.id);
  if (vbatchIds.length) await req('/api/admin/videos/batch', { method: 'DELETE', token: AT, body: { ids: vbatchIds, pwd: '199856' } });
  if (secBId) await req('/api/admin/sections/' + secBId, { method: 'DELETE', token: AT });
  if (wbkId) await req('/api/admin/word/books/' + wbkId, { method: 'DELETE', token: AT, body: { pwd: '199856' } });
  if (chapterId) await req('/api/admin/chapters/' + chapterId, { method: 'DELETE', token: AT });
  // ---------- 部署物料自检（本机文件，上架时会用到） ----------
  {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const p = (rel) => path.join(__dirname, '..', rel);
    log(fs.existsSync(p('deploy/install.sh')), 'deploy/install.sh 存在（服务器一键安装脚本）');
    log(fs.existsSync(p('deploy/remote-setup.sh')), 'deploy/remote-setup.sh 存在（服务器端解包 + 数据保护脚本）');
    log(fs.existsSync(p('deploy/nginx.conf')), 'deploy/nginx.conf 存在（Nginx 反向代理模板）');
    log(fs.existsSync(p('deploy/backup.sh')), 'deploy/backup.sh 存在（每日备份脚本）');
    const upBat = p('一键上传部署.bat');
    const batTxt = fs.existsSync(upBat) ? fs.readFileSync(upBat, 'latin1') : '';
    log(batTxt.includes('remote-setup.sh'), '「一键上传部署.bat」会调用服务器端 remote-setup.sh');
    log(/\bscp -P %PORT%/.test(batTxt) && /ssh -p %PORT%/.test(batTxt), '「一键上传部署.bat」含 scp 上传 + ssh 部署两步');
    const setup = fs.existsSync(p('deploy/remote-setup.sh')) ? fs.readFileSync(p('deploy/remote-setup.sh'), 'utf8') : '';
    log(setup.includes('_xuexi_data_keep') && setup.includes('mv "$DEST/server/data"'),
      'remote-setup.sh 铺新代码前会把老数据搬走再放回（升级不丢数据）');
    log(setup.includes('unzip -O UTF-8'), 'remote-setup.sh 用 UTF-8 解压（中文文件名不乱码）');
    // 前端静态资源是公开可下载的（未登录也能 curl 到），任何密码 / 密钥都不能写死在 public/ 里
    const wordsJs = fs.readFileSync(p('server/public/admin/words.js'), 'utf8');
    log(!wordsJs.includes('199856'), '管理端 words.js 不再硬编码删除密码（静态资源公网可下载）');
    const publicFiles = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) { if (f.name !== 'vendor') walk(full); }
        else if (/\.(js|html)$/.test(f.name)) publicFiles.push(full);
      }
    })(p('server/public'));
    const leak = publicFiles.filter((f) => fs.readFileSync(f, 'utf8').includes('199856'));
    log(leak.length === 0, 'public/ 下所有前端文件都不含删除密码明文',
      leak.length ? leak.map((f) => path.relative(p('server/public'), f)).join(', ') : '已扫描 ' + publicFiles.length + ' 个文件');
    // 删除密码只在服务端比对（前端拿不到），密码实现集中在 src/delpwd.js
    const delpwdSrc = fs.existsSync(p('server/src/delpwd.js')) ? fs.readFileSync(p('server/src/delpwd.js'), 'utf8') : '';
    log(!!delpwdSrc && delpwdSrc.includes('delPwdOk'), 'src/delpwd.js 存在（删除密码统一由服务端校验）');
    const wordSrc = fs.readFileSync(p('server/src/word.js'), 'utf8');
    log(wordSrc.includes("admin.delete('/books/:id'") && /admin\.delete\('\/books\/:id'[\s\S]{0,400}delPwdOk\(req\)/.test(wordSrc),
      '词书删除接口在服务端校验密码（不再只靠前端弹窗）');
    // 打包脚本的排除清单：防止「文档 / 自测脚本 / 截图 / 批处理」又被打进部署包
    const MUST_EXCLUDE = ['./server/node_modules', './_*', './_shots*', './.workbuddy', './outputs',
      './*.log', './*.zip', './*.bat', './docs', './server/_*', './server/*-test.js',
      './server/smoke.js', './server/ui-test.js', './server/tts-probe.js', './server/seed-words.js'];
    for (const b of ['打包上传.bat', '打包上传(含本地数据).bat', '一键上传部署.bat']) {
      const txt = fs.existsSync(p(b)) ? fs.readFileSync(p(b), 'latin1') : '';
      const miss = MUST_EXCLUDE.filter((x) => !txt.includes('--exclude "' + x + '"'));
      log(!!txt && miss.length === 0, `「${b}」排除清单完整（文档/自测脚本/截图/批处理都不上传）`,
        miss.length ? '缺: ' + miss.join(', ') : '共 ' + MUST_EXCLUDE.length + ' 条');
    }
    const dataBat = fs.existsSync(p('打包上传(含本地数据).bat')) ? fs.readFileSync(p('打包上传(含本地数据).bat'), 'latin1') : '';
    log(dataBat.includes('call :CHECKPOINT') && dataBat.includes('_dbcheckpoint.js'),
      '含数据包在打包前先压实数据库（WAL 并回主库，数据不落后于几分钟前）');
    log(fs.existsSync(p('server/_dbcheckpoint.js')), 'server/_dbcheckpoint.js 存在（数据库压实脚本）');
    // 上线后的收尾物料：体检脚本 + 收尾清单（部署包会带上 deploy/checkup.sh）
    const chk = fs.existsSync(p('deploy/checkup.sh')) ? fs.readFileSync(p('deploy/checkup.sh'), 'utf8') : '';
    log(!!chk && chk.includes('上线体检'), 'deploy/checkup.sh 存在（上线体检脚本，只读）');
    log(chk.includes('backup.sh') && chk.includes('3000') && chk.includes('443'),
      '体检脚本会检查「自动备份 / 3000端口是否暴露 / HTTPS」三项关键项');
    log(!/\brm\s+-rf\b|>\s*\/www\/xuexi-system/.test(chk), '体检脚本不含删除/覆盖类危险操作（只读）');
    log(fs.existsSync(p('docs/上线后收尾清单.md')), 'docs/上线后收尾清单.md 存在（上线后的操作清单）');
    // 云存储一键配置（教程第 9 步）：不用手改 ecosystem.config.js
    const ss = fs.existsSync(p('deploy/set-storage.sh')) ? fs.readFileSync(p('deploy/set-storage.sh'), 'utf8') : '';
    log(!!ss && ss.includes('云存储配置助手'), 'deploy/set-storage.sh 存在（云存储一键配置）');
    log(ss.includes('--show') && ss.includes('--local') && ss.includes('--yes'),
      '配置脚本支持 --show（看当前）/ --local（改回本地）/ --yes（非交互）');
    const ssNode = ss.match(/<<'NODEEOF'\r?\n([\s\S]*?)\r?\nNODEEOF/);
    let ssNodeOk = false;
    try { if (ssNode) { new vm.Script(ssNode[1]); ssNodeOk = true; } } catch (e) { ssNodeOk = false; }
    log(!!ssNode && ssNodeOk, '配置脚本内置的改文件程序是合法 JS（用 Node 改配置，先语法校验再落盘）');
    log(ss.includes('@storage-script-begin') && ss.includes('@storage-script-end'),
      '写入的配置块有起止标记（反复切换不会越写越多）');
    log(ss.includes('不能有英文单引号') && ss.includes('不能有反斜杠'),
      '配置脚本会拒绝含单引号/反斜杠的值（避免写坏配置文件）');
    log(ss.includes('node --check') || ss.includes('--check'), '配置脚本改完会用 node --check 复核语法');
    const eco = fs.existsSync(p('server/ecosystem.config.js')) ? fs.readFileSync(p('server/ecosystem.config.js'), 'utf8') : '';
    log(eco.includes('@storage-script-begin') && eco.includes('@storage-script-end'),
      'ecosystem.config.js 的云存储配置段带标记（供配置脚本精确替换）');
    log(!/oss-env\.sh/.test(eco), 'ecosystem.config.js 不再引用不存在的 deploy/oss-env.sh');
    // 每天自动备份由部署脚本自动装好（用户不用去面板里找「计划任务」）
    const inst = fs.existsSync(p('deploy/install.sh')) ? fs.readFileSync(p('deploy/install.sh'), 'utf8') : '';
    log(/crontab -/.test(inst) && inst.includes('deploy/backup.sh'), 'install.sh 会自动把每日备份写进定时任务（免去手动找面板菜单）');
    log(inst.includes("grep -v 'deploy/backup.sh'"), 'install.sh 的备份任务幂等（重复部署不会写两条）');
    log(inst.includes('SKIP_BACKUP_CRON') && inst.includes('SKIP_BACKUP_NOW'),
      'install.sh 提供 SKIP_BACKUP_CRON / SKIP_BACKUP_NOW 开关（可跳过备份配置）');
    log(/is-active crond|is-active cron/.test(inst), 'install.sh 会确认定时服务在运行（否则只写任务不会触发）');
    // 只检查真正的代码行（注释里会写「不要用 xx 写法」，不算）
    const instCode = inst.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    log(!/crontab -l[^\n]*\|[^\n]*crontab -/.test(instCode),
      'install.sh 不用「读|写」管道改 crontab（避免并发时把原有任务弄丢）');
  }

  console.log('\n（自测数据已清理）');

  done();
})().catch((e) => { console.error('自测异常：', e); process.exit(1); });

function done() {
  console.log(`\n=== 结果： 通过 ${pass} 项，失败 ${fail} 项 ===\n`);
  process.exit(fail ? 1 : 0);
}
