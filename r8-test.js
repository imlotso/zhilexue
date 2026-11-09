'use strict';
/**
 * R8 二轮整改（课文习题 + 学生端课程页 + 做题弹窗 + AI 浮层）自测： node r8-test.js
 * 需先启动服务（默认 http://localhost:3000，AI_MOCK=1、STORAGE_DRIVER=local）并 npm run seed；直连同一个 MySQL 造专用数据，结束后清理。
 * 接口层：
 *   · 小分组挂题 / 解绑（与视频绑定二选一）、video_nodes 读写、lessons 带小分组题数和视频知识点
 *   · course-detail：小分组题数 / 练习题数 / 正确率（含小分组自己的题）、视频知识点标签、继续学习、右上角正确率；课程卡片正确率
 *   · 小分组练习取题 / 交卷（不能夹带别处的题）、知识点掌握情况（题目继承视频的知识点）、填空逐空判分
 *   · SSE 讲解接口：AI_MOCK 下 text/event-stream、分多块、追问带上下文；学生 token 不能调后台接口
 * 浏览器（有 Playwright 时）：课程页顶部数字与接口一致、右上角显示正确率；做题弹窗判分前后 boundingBox 相同；
 *   700×500 题图宽 ≥ 320；答错后出现 AI 老师按钮 → 浮层贴视口右下、不压「下一题」、流式文本逐步变长、自由追问有第二条回复；
 *   手机 390 宽 AI 浮层是底部抽屉、顶栏不换行；报告页题号方块数量正确；全程无页面脚本报错。
 */
const zlib = require('zlib');
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, form } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') || '';
  const j = ct.includes('json') ? await res.json() : { _text: await res.text() };
  j._status = res.status; j._ctype = ct; return j;
}
/** 读 SSE：返回 { ctype, events:[{t,text,...}], chunks, text } */
async function sse(token, body) {
  const res = await fetch(BASE + '/api/stu/bank/ai-explain/stream', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ctype = res.headers.get('content-type') || '';
  if (!/event-stream/.test(ctype)) return { ctype, status: res.status, json: await res.json().catch(() => null), events: [], chunks: 0, text: '' };
  const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let chunks = 0; const events = [];
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks++; buf += dec.decode(value, { stream: true }); }
  buf.split('\n\n').forEach((e) => { const l = e.split('\n').find((x) => x.startsWith('data:')); if (l) { try { events.push(JSON.parse(l.slice(5).trim())); } catch (er) { /* ignore */ } } });
  return { ctype, status: res.status, events, chunks, text: events.filter((x) => x.t === 'delta').map((x) => x.text).join('') };
}
function makePng(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 120 + Math.floor(100 * x / w); raw[o + 1] = 180; raw[o + 2] = 235 - Math.floor(80 * y / h); } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const now = '2026-11-04 09:00:00';
const uniq = Date.now().toString().slice(-8);
const TAG = 'R8测试';
const OPTS = JSON.stringify(['甲', '乙', '丙', '丁']);

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['records', 'mistakes', 'question_nodes', 'question_tags', 'bank_feedback'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`SELECT id FROM chapters WHERE name LIKE '${TAG}%'`).all().forEach((c) => {
    db.prepare('SELECT id FROM videos WHERE chapter_id=?').all(c.id).forEach((v) => db.prepare('DELETE FROM video_nodes WHERE video_id=?').run(v.id));
    db.prepare('DELETE FROM videos WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM sections WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM progress WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM chapters WHERE id=?').run(c.id);
  });
  db.prepare(`SELECT id FROM bank_trees WHERE name LIKE '${TAG}%'`).all().forEach((t) => {
    db.prepare('DELETE FROM bank_tree_nodes WHERE tree_id=?').run(t.id);
    db.prepare('DELETE FROM bank_trees WHERE id=?').run(t.id);
  });
  db.prepare("SELECT id FROM users WHERE username LIKE 'r8s%'").all().forEach((u) => {
    ['records', 'mistakes', 'practices', 'paper_tries', 'progress'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(u.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
}

(async () => {
  console.log('\n=== R8 课文习题 + 课程页 + 做题弹窗 + AI 浮层 · 自测 ===\n');
  cleanup();
  // ---------------- 造数：课程（2 个小分组）、3 个视频、知识点树、学生 ----------------
  const ch = db.prepare("INSERT INTO chapters (subject,grade,term,book,name,code,sort,category,stage,created_at) VALUES ('数学','七年级','上册','',?,'',999,'同步基础','junior',?)").run(TAG + '课程' + uniq, now).lastInsertRowid;
  const sA = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,1,?)').run(ch, TAG + '小分组A', now).lastInsertRowid;
  const sB = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,2,?)').run(ch, TAG + '小分组B', now).lastInsertRowid;
  const mkV = (title, sec, sort) => db.prepare("INSERT INTO videos (chapter_id,section_id,subject,grade,title,file_path,url,duration,level,sort,created_at) VALUES (?,?,'数学','七年级',?,'','https://example.com/v.mp4',60,'basic',?,?)").run(ch, sec, TAG + title, sort, now).lastInsertRowid;
  const v1 = mkV('视频一', sA, 1), v2 = mkV('视频二', sA, 2), v3 = mkV('视频三', sB, 3);
  const addQ = (type, stem, answer, point, extra = {}) => db.prepare(`INSERT INTO questions (chapter_id,subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,video_id,images,created_at) VALUES (?,?,?,?,?,?,?,?,?,3,?,?,?,?)`)
    .run(extra.video ? ch : null, '数学', '七年级', 'junior', type, `${TAG}${stem}`, type === 'single' ? OPTS : '[]', answer, '解析：' + stem, point, extra.video || null, JSON.stringify(extra.images || []), now).lastInsertRowid;
  const q1 = addQ('single', '视频一第1题', 'A', '有理数', { video: v1 });
  const q2 = addQ('fill', '视频一填空 ____ 和 ____', '2|1', '有理数', { video: v1 });
  const q3 = addQ('single', '视频二第1题', 'B', '数轴', { video: v2 });
  const q4 = addQ('single', '视频三第1题', 'C', '绝对值', { video: v3 });
  const s1 = addQ('single', '小分组A自己的题1', 'A', '有理数');
  const s2 = addQ('judge', '小分组A自己的题2', '正确', '有理数');
  const free = addQ('single', '题库里的散题', 'D', '其它');
  const tree = db.prepare("INSERT INTO bank_trees (kind,subject,stage,name,source,sort,created_at) VALUES ('knowledge','数学','junior',?,'test',999,?)").run(TAG + '知识点树', now).lastInsertRowid;
  const mkN = (name, parent) => db.prepare('INSERT INTO bank_tree_nodes (tree_id,parent_id,name,sort,created_at) VALUES (?,?,?,0,?)').run(tree, parent, TAG + name, now).lastInsertRowid;
  const nRoot = mkN('数与式', null), nRat = mkN('有理数', nRoot), nAbs = mkN('绝对值', nRoot);
  const mkU = (u, grade) => db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,'上册',1,1,'2099-12-31',1,?)").run(u, hash('123456'), 'R8学生', grade, now).lastInsertRowid;
  const uA = mkU('r8s' + uniq + 'a', '七年级');
  mkU('r8s' + uniq + 'b', '八年级');
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const TA = await login('r8s' + uniq + 'a', 'student');
  const TB = await login('r8s' + uniq + 'b', 'student');
  log(AT && TA && TB, '造数：1 门课 2 个小分组 3 个视频、4 道视频题 + 2 道待挂小分组的题、一棵知识点树、七年级 / 八年级两个学生');

  // ---------------- 后台：小分组挂题 / 解绑 ----------------
  let r = await req(`/api/admin/bank/sections/${sA}/bind`, { method: 'POST', token: AT, body: { ids: [s1, s2] } });
  let sq = await req(`/api/admin/bank/sections/${sA}/questions`, { token: AT });
  log(r.code === 0 && sq.code === 0 && sq.data.list.map((q) => q.id).sort().join() === [s1, s2].sort().join() && sq.data.video_question_count === 3,
    '小分组挂题：POST /sections/:id/bind 后 GET /sections/:id/questions 列出这 2 题，并给出组内视频题数 3', `${sq.data && sq.data.list.length} 题，视频题 ${sq.data && sq.data.video_question_count}`);
  const qs1 = db.prepare('SELECT chapter_id, video_id, section_id FROM questions WHERE id=?').get(s1);
  log(Number(qs1.section_id) === sA && Number(qs1.chapter_id) === ch && !qs1.video_id, '挂到小分组：section_id / chapter_id 写好，video_id 为空', JSON.stringify(qs1));
  await req(`/api/admin/bank/videos/${v1}/bind`, { method: 'POST', token: AT, body: { ids: [s2] } });
  const qs2 = db.prepare('SELECT video_id, section_id FROM questions WHERE id=?').get(s2);
  log(Number(qs2.video_id) === v1 && !qs2.section_id, '同一道题再绑到视频：自动从小分组上取下（二选一）', JSON.stringify(qs2));
  await req(`/api/admin/bank/sections/${sA}/bind`, { method: 'POST', token: AT, body: { ids: [s2] } });
  const qs3 = db.prepare('SELECT video_id, section_id FROM questions WHERE id=?').get(s2);
  log(!qs3.video_id && Number(qs3.section_id) === sA, '再挂回小分组：video_id 清空', JSON.stringify(qs3));
  r = await req(`/api/admin/bank/sections/${sB}/bind`, { method: 'POST', token: AT, body: { ids: [s1], unbind: 1 } });
  log(r.code === 0 && r.data.count === 0 && Number(db.prepare('SELECT section_id FROM questions WHERE id=?').get(s1).section_id) === sA, '解绑只作用于挂在该小分组上的题（拿别的小分组 id 解绑无效）');
  await req(`/api/admin/bank/sections/${sA}/bind`, { method: 'POST', token: AT, body: { ids: [free] } });
  r = await req(`/api/admin/bank/sections/${sA}/bind`, { method: 'POST', token: AT, body: { ids: [free], unbind: 1 } });
  const qf = db.prepare('SELECT section_id, chapter_id FROM questions WHERE id=?').get(free);
  log(r.code === 0 && r.data.count === 1 && !qf.section_id && !qf.chapter_id, '解绑：题目回到题库（section_id、chapter_id 清空，题目保留）', JSON.stringify(qf));
  const freeList = await req('/api/admin/bank/questions?video=free&kw=' + encodeURIComponent(TAG) + '&size=50', { token: AT });
  const freeIds = (freeList.data.list || []).map((q) => q.id);
  log(freeIds.includes(free) && !freeIds.includes(s1) && !freeIds.includes(q1), '「从题库选择」只列既没绑视频也没挂小分组的题（video=free）');
  r = await req('/api/admin/bank/questions', { method: 'POST', token: AT, body: { type: 'single', subject: '数学', stem: TAG + '后台直接给小分组B加的题', options: ['1', '2'], answer: 'B', section_id: sB } });
  const qNew = db.prepare('SELECT section_id, video_id FROM questions WHERE id=?').get(r.data.id);
  log(r.code === 0 && Number(qNew.section_id) === sB && !qNew.video_id, '课文习题里「添加习题」带 section_id：新题直接挂到小分组 B');

  // ---------------- 后台：视频关联知识点 ----------------
  r = await req(`/api/admin/bank/videos/${v1}/nodes`, { method: 'POST', token: AT, body: { node_ids: [nRat, nRoot, 99999999] } });
  let vn = await req(`/api/admin/bank/videos/${v1}/nodes`, { token: AT });
  log(r.code === 0 && r.data.count === 2 && vn.data.nodes.map((n) => n.id).sort().join() === [nRat, nRoot].sort().join(), 'video_nodes 写入：不存在的节点 id 被忽略，读回 2 个', JSON.stringify(vn.data && vn.data.nodes.map((n) => n.name)));
  log(vn.data.trees.length >= 1 && vn.data.subject === '数学' && vn.data.stage === 'junior' && vn.data.trees[0].subject === '数学' && vn.data.trees[0].stage === 'junior',
    '候选知识点树：学科 + 学段（七年级 → 初中）对应的树排在第一', vn.data.trees[0] && vn.data.trees[0].name);
  await req(`/api/admin/bank/videos/${v3}/nodes`, { method: 'POST', token: AT, body: { node_ids: [nAbs] } });
  await req(`/api/admin/bank/videos/${v2}/nodes`, { method: 'POST', token: AT, body: { node_ids: [nAbs] } });
  r = await req(`/api/admin/bank/videos/${v2}/nodes`, { method: 'POST', token: AT, body: { node_ids: [] } });
  log(r.code === 0 && db.prepare('SELECT COUNT(*) n FROM video_nodes WHERE video_id=?').get(v2).n === 0, '整体替换：传空数组清空视频关联的知识点');
  const les = await req(`/api/admin/bank/chapters/${ch}/lessons`, { token: AT });
  const secA = les.data.sections.find((x) => x.id === sA), lv1 = les.data.videos.find((x) => x.id === v1);
  log(Number(secA.question_count) === 2 && lv1.nodes.length === 2 && Number(lv1.question_count) === 2, '课文习题列表：小分组带「小分组习题 N」，视频带关联的知识点', `小分组A ${secA.question_count} 题，视频一 ${lv1.nodes.map((n) => n.name).join('、')}`);
  const vq = await req(`/api/admin/bank/videos/${v1}/questions`, { token: AT });
  log(vq.code === 0 && vq.data.nodes.length === 2, '视频习题接口顺带返回关联的知识点（编辑题目时默认继承）');

  // ---------------- 权限：学生 token 不能调后台接口 ----------------
  const deny = await Promise.all([
    req(`/api/admin/bank/sections/${sA}/questions`, { token: TA }),
    req(`/api/admin/bank/sections/${sA}/bind`, { method: 'POST', token: TA, body: { ids: [free] } }),
    req(`/api/admin/bank/videos/${v1}/nodes`, { token: TA }),
    req(`/api/admin/bank/videos/${v1}/nodes`, { method: 'POST', token: TA, body: { node_ids: [] } }),
  ]);
  log(deny.every((x) => x._status === 401 || x._status === 403 || (x.code && x.code !== 0)) && db.prepare('SELECT COUNT(*) n FROM video_nodes WHERE video_id=?').get(v1).n === 2,
    '学生 token 调后台的小分组 / 知识点接口一律被拒，数据不变', deny.map((x) => x._status).join(','));
  const denyAi = await req('/api/stu/bank/ai-explain/stream', { method: 'POST', token: AT, body: { question_id: q1 } });
  log(denyAi._status === 403, '后台 token 不能调学生端 SSE 讲解接口', String(denyAi._status));

  // ---------------- 学生端：课程页数据 ----------------
  await req('/api/stu/progress', { method: 'POST', token: TA, body: { video_id: v1, video_done: 1 } });
  let cd = (await req(`/api/stu/course-detail?id=${ch}`, { token: TA })).data;
  const gA = () => cd.groups.find((g) => g.id === sA), gB = () => cd.groups.find((g) => g.id === sB);
  log(gA().own_qcount === 2 && gA().practice_count === 5 && gA().acc.total === 5 && gB().own_qcount === 1 && gB().practice_count === 2,
    'course-detail：小分组 A 自己 2 题、练习共 5 题（组内视频 3 + 自己 2），小分组 B 自己 1 题、练习 2 题', `A ${gA().own_qcount}/${gA().practice_count}，B ${gB().own_qcount}/${gB().practice_count}`);
  const lv = cd.lessons.find((l) => l.video_id === v1);
  log(lv.nodes.length === 2 && lv.nodes.every((n) => n.id && n.name), '视频卡带关联的知识点标签（来自 video_nodes）', lv.nodes.map((n) => n.name).join('、'));
  log(cd.next && cd.next.video_id === v2 && cd.next.group_id === sA, '「继续学习」指向第一个没学完的视频（视频二）', JSON.stringify(cd.next));
  log(cd.acc.total === 7 && cd.acc.rate === null && cd.kp_done === 1 && cd.kp_total === 3, '课程正确率总题数含小分组自己的题（4 视频题 + 3 小分组题 = 7），还没做过为 null', JSON.stringify(cd.acc));

  // ---------------- 学生端：小分组练习 ----------------
  const sqs = await req(`/api/stu/bank/section-questions?section_id=${sA}`, { token: TA });
  const sqIds = (sqs.data.list || []).map((q) => q.id);
  log(sqs.code === 0 && sqIds.length === 5 && [q1, q2, q3, s1, s2].every((id) => sqIds.includes(id)) && !('answer' in sqs.data.list[0]),
    '小分组练习取题：组内视频的题 + 小分组自己的题，共 5 题，不下发答案');
  const other = await req(`/api/stu/bank/section-questions?section_id=${sA}`, { token: TB });
  log(other.code !== 0, '别的年级的学生取不到这个小分组的题', other.msg);
  r = await req('/api/stu/bank/submit', { method: 'POST', token: TA, body: { kind: 'section', section_id: sA, duration: 40, answers: [
    { question_id: q1, my_answer: 'A' }, { question_id: q2, my_answer: '2|3' }, { question_id: q3, my_answer: 'B' }, { question_id: s1, my_answer: 'B' }, { question_id: s2, my_answer: '正确' }, { question_id: q4, my_answer: 'C' }] } });
  log(r.code === 0 && r.data.total === 5 && r.data.correct === 3 && r.data.mastery && r.data.mastery.section && r.data.mastery.section.rate === 60,
    '小分组交卷：夹带的别组题（视频三）不计；5 题对 3，回传小分组现在的正确率 60%', r.data && JSON.stringify(r.data.mastery && r.data.mastery.section));
  log(r.data.list.every((x) => typeof x.point === 'string'), '交卷结果每题带知识点（报告页「薄弱知识点 + 题号」用）');
  cd = (await req(`/api/stu/course-detail?id=${ch}`, { token: TA })).data;
  log(gA().acc.answered === 5 && gA().acc.correct === 3 && gA().acc.rate === 60 && gA().own_acc.answered === 2 && gA().own_acc.correct === 1,
    '小分组正确率 = 组内视频题 + 小分组自己的题合并计算（60%），小分组自己的题 1/2', JSON.stringify(gA().acc));
  log(cd.acc.answered === 5 && cd.acc.rate === 60, '课程（右上角）正确率同步更新为 60%', JSON.stringify(cd.acc));
  const courses = await req('/api/stu/courses?subject=' + encodeURIComponent('数学'), { token: TA });
  const myC = (courses.data || []).find((c) => c.id === ch);
  log(myC && myC.acc && myC.acc.rate === 60 && myC.acc.total === 7, '课程列表卡片带正确率（与课程页一致）', myC && JSON.stringify(myC.acc));

  // ---------------- 知识点掌握情况 ----------------
  db.prepare('INSERT INTO question_nodes (question_id,node_id) VALUES (?,?)').run(s1, nRat);
  const nm = await req(`/api/stu/bank/node-mastery?node_id=${nRoot}&course_id=${ch}`, { token: TA });
  // 「数与式」含子孙：视频一（关联了 有理数 / 数与式）的 q1、q2 + 直接挂「有理数」的 s1 + 视频三（关联 绝对值）的 q4
  log(nm.code === 0 && nm.data.total === 4 && nm.data.answered === 3 && nm.data.correct === 1 && nm.data.rate === 33,
    '知识点掌握：父节点含子孙；视频的题自动算到视频关联的知识点下；做过 3 题对 1 题', nm.data && `${nm.data.answered}/${nm.data.total} 对 ${nm.data.correct}`);
  log(nm.data.videos.map((v) => v.video_id).sort().join() === [v1, v3].sort().join() && nm.data.list.length === 3 && nm.data.list.every((x) => typeof x.is_correct === 'boolean'),
    '知识点掌握：返回本课程里讲这个知识点的视频（视频一、视频三）和做过的题（最近一次对错）');

  // ---------------- 逐题核对：填空逐空 ----------------
  const lessonTicket = await req(`/api/stu/bank/lesson-questions?video_id=${v1}`, { token: TA });
  const lessonQ = lessonTicket.data.list.find((q) => q.id === q1);
  const lessonCheck = await req('/api/stu/bank/check', { method: 'POST', token: TA, body: { items: [{ question_id: q1, quiz_ticket: lessonQ.quiz_ticket, my_answer: 'B' }] } });
  log(lessonCheck.code === 0, '视频课文习题票据可用于核对');
  const ticketQ1 = sqs.data.list.find((q) => q.id === q1).quiz_ticket;
  const ticketQ2 = sqs.data.list.find((q) => q.id === q2).quiz_ticket;
  r = await req('/api/stu/bank/check', { method: 'POST', token: TA, body: { items: [{ question_id: q2, quiz_ticket: ticketQ2, my_answer: '2|3' }] } });
  log(r.code === 0 && JSON.stringify(r.data.list[0].blanks) === '[true,false]' && r.data.list[0].is_correct === false, '填空逐空判分：第 1 空对、第 2 空错', JSON.stringify(r.data.list[0].blanks));

  // ---------------- SSE 讲解（AI_MOCK） ----------------
  const t0 = Date.now();
  const e1 = await sse(TA, { question_id: q1, quiz_ticket: ticketQ1, my_answer: 'B' });
  const deltas = e1.events.filter((x) => x.t === 'delta');
  log(/text\/event-stream/.test(e1.ctype) && deltas.length >= 5 && e1.chunks >= 3 && e1.events.some((x) => x.t === 'done'),
    'SSE：返回 text/event-stream，分多块推送（delta 事件若干 + done）', `${deltas.length} 个 delta / ${e1.chunks} 次读到数据 / ${Date.now() - t0}ms`);
  log(['知识点', '思路', '步骤', '易错点'].every((k) => e1.text.includes('### ' + k)), '讲解按「知识点 / 思路 / 步骤 / 易错点」分段（Markdown 三级标题）');
  const e2 = await sse(TA, { question_id: q1, quiz_ticket: ticketQ1, my_answer: 'B', history: [{ role: 'user', content: '请讲解这道题。' }, { role: 'assistant', content: e1.text }], ask: '出一道同类题考考我' });
  log(e2.text.length > 20 && e2.text !== e1.text && /同类/.test(e2.text), '追问（带上之前的对话）：得到新的回复', e2.text.slice(0, 30).replace(/\n/g, ' '));
  const e3 = await sse(TA, { question_id: q1, quiz_ticket: ticketQ1, my_answer: 'B', mode: 'guide' });
  log(e3.events.some((x) => x.t === 'start' && x.mode === 'guide') && /第 1 步/.test(e3.text), '「一步步引导」模式：同一个接口，按引导口吻输出');
  const e4 = await sse(TA, { question_id: 99999999 });
  log(!/event-stream/.test(e4.ctype) && e4.json && e4.json.code !== 0, '题目不存在：直接返回 JSON 错误（不进流）', e4.json && e4.json.msg);

  // ================= 浏览器 =================
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] }); } catch (e) { browser = null; } }
  if (!browser) {
    console.log('  ⏭  没有可用的浏览器（Playwright），跳过浏览器部分');
  } else {
    // 题图 700×500：走后台上传，得到真实可访问的题图地址，挂到视频一的第 1 题
    const fd = new FormData(); fd.append('file', new Blob([makePng(700, 500)], { type: 'image/png' }), 'r8big.png');
    const up = await req(MF + '/asset', { method: 'POST', token: AT, form: fd });
    db.prepare('UPDATE questions SET images=?, stem=? WHERE id=?').run(JSON.stringify([up.data.url.replace(/&ft=[^&]+/, '')]), TAG + '看图作答 [图1] 选哪个', q1);
    const errs = [];
    const open = async (w, h) => {
      const pg = await browser.newPage({ viewport: { width: w, height: h } });
      pg.on('pageerror', (e) => errs.push(`${w}:` + e.message));
      await pg.goto(BASE + '/'); await pg.waitForTimeout(600);
      await pg.fill('input[type=text],input[type=tel],input:not([type])', 'r8s' + uniq + 'a'); await pg.fill('input[type=password]', '123456'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1300);
      await pg.goto(BASE + '/#/course/' + ch); await pg.waitForSelector('.r8-hero', { timeout: 8000 }); await pg.waitForTimeout(500);
      return pg;
    };
    try {
      const pg = await open(1440, 900);
      cd = (await req(`/api/stu/course-detail?id=${ch}`, { token: TA })).data;
      const summary = await pg.$eval('.round-course-summary', (e) => e.innerText.replace(/\s+/g, ' '));
      const hero = await pg.$eval('.r8-hero', (e) => e.innerText.replace(/\s+/g, ' '));
      log(summary.includes(`${cd.kp_done} / ${cd.kp_total}`) && summary.includes(cd.acc.rate + '%') && summary.includes(`已做 ${cd.acc.answered} / ${cd.acc.total} 题`) && hero.includes(cd.next.title),
        '课程汇总的已学/总数、正确率、做题数和当前视频与接口一致', summary + ' | ' + hero);
      const progress = await pg.locator('.round-course-summary .round-course-progress').innerText();
      log(progress.includes(cd.percent + '%'), '课程汇总同时显示学习进度百分比和正确率', progress + ' | ' + summary);
      const group = pg.locator('.round-course-group').filter({ has: pg.locator('.round-group-title', { hasText: TAG + '小分组A' }) });
      await group.locator('.round-group-title').click();
      log((await group.locator('.round-group-actions').innerText()).includes('60%'), '小分组A显示60%正确率');
      await group.getByRole('button', { name: '分组练习', exact: true }).click();
      await pg.waitForSelector('#qzDots .qz-dot');
      log(await pg.locator('#qzDots .qz-dot').count() === 5, '分组练习入口打开完整的5道题');
      await pg.click('#qzClose');
      // The redesigned page shows tags for the selected video, not every video at once.
      await group.locator('.round-lesson-select').filter({ hasText: TAG + '视频一' }).click();
      const tags = await pg.$$eval('.r8-ktag', (a) => a.map((x) => x.textContent.trim()));
      log(tags.length >= 2, '视频卡显示关联的知识点标签', tags.join('、'));
      await pg.click('.r8-ktag'); await pg.waitForSelector('.r8-nm', { timeout: 4000 });
      log(/正确率/.test(await pg.$eval('.r8-nm', (e) => e.innerText)), '点知识点标签弹出该知识点的掌握情况');
      await pg.click('.r8-nm .close-x');

      // 做题弹窗：视频一的练习（2 题：带图单选 + 填空）
      await group.getByRole('button', { name: '练习' + TAG + '视频一', exact: true }).click(); await pg.waitForSelector('.r8-qz .r0-qimg', { timeout: 8000 });
      await pg.waitForFunction(() => { const i = document.querySelector('.r0-qimg'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
      const imgW = await pg.$eval('.r0-qimg', (i) => i.getBoundingClientRect().width);
      log(imgW >= 320, '700×500 的题图在做题弹窗里显示宽度 ≥ 320px', imgW.toFixed(0) + 'px');
      const box = () => pg.$eval('.quiz-box', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v)).join(','); });
      const b1 = await box();
      log(await pg.$('#qzAiFab[hidden]') !== null, '判分前不出现「AI 老师」按钮');
      await pg.click('.qz-opt >> nth=1'); await pg.click('#qzCheckOne'); await pg.waitForSelector('.r8-fb', { timeout: 5000 }); await pg.waitForTimeout(400);
      const b2 = await box();
      log(b1 === b2, '判分前后做题弹窗位置和尺寸完全相同（定高，内容区内部滚动）', `${b1} → ${b2}`);
      const fb = await pg.evaluate(() => ({ tag: document.querySelector('.r8-fb-tag').textContent.trim(), wrong: document.querySelectorAll('.qz-opt.r8-wrong').length, right: document.querySelectorAll('.qz-opt.r8-right').length, dot: document.querySelector('.r8-dot.no') !== null }));
      log(fb.tag === '答错了' && fb.wrong === 1 && fb.right === 1 && fb.dot, '答错：大标签「答错了」、选错的选项标红、正确项标绿、题号方格变红', JSON.stringify(fb));
      const fabOk = await pg.$eval('#qzAiFab', (e) => !e.hidden && e.classList.contains('hot'));
      log(fabOk, '答错后题卡右下角出现（高亮的）「AI 老师」按钮');
      await pg.click('#qzAiFab'); await pg.waitForSelector('.r8-ai.show', { timeout: 4000 });
      await pg.waitForFunction(() => { const b = document.querySelector('.r8-msg.bot .r8-bub'); return b && b.textContent.length > 8; }, null, { timeout: 8000 });
      const len1 = await pg.$eval('.r8-msg.bot .r8-bub', (e) => e.textContent.length);
      await pg.waitForTimeout(700);
      const len2 = await pg.$eval('.r8-msg.bot .r8-bub', (e) => e.textContent.length);
      log(len2 > len1, 'AI 讲解流式输出：文字逐步变长', `${len1} → ${len2} 字`);
      const geo = await pg.evaluate(() => {
        const p = document.querySelector('.r8-ai').getBoundingClientRect(); const n = document.querySelector('#qzGoNext').getBoundingClientRect(); const q = document.querySelector('.qz-stem').getBoundingClientRect();
        const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        return { right: innerWidth - p.right, bottom: innerHeight - p.bottom, w: Math.round(p.width), h: Math.round(p.height), vh: innerHeight, hitNext: hit(p, n), hitStem: hit(p, q) };
      });
      log(geo.right >= 0 && geo.right <= 24 && geo.bottom >= 0 && geo.bottom <= 24 && geo.w >= 360 && geo.w <= 440 && Math.abs(geo.h - geo.vh * 0.6) < 40,
        'AI 浮层在当前窗口右下方：右、下贴边，约 400 宽、60vh 高', JSON.stringify(geo));
      log(!geo.hitNext && !geo.hitStem, 'AI 浮层不遮挡「下一题」按钮和题干');
      await pg.waitForFunction(() => !document.querySelector('.r8-msg.bot.streaming'), null, { timeout: 15000 });
      const secTitles = await pg.$$eval('.r8-msg.bot .r8-md-sec', (a) => a.map((x) => x.textContent.trim()));
      log(['知识点', '思路', '步骤', '易错点'].every((k) => secTitles.includes(k)), '讲解按「知识点 / 思路 / 步骤 / 易错点」分段渲染', secTitles.join(' / '));
      await pg.fill('.r8-ai-in textarea', '为什么不能选乙？'); await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => document.querySelectorAll('.r8-msg.bot').length >= 2 && !document.querySelector('.r8-msg.bot.streaming'), null, { timeout: 15000 });
      const replies = await pg.$$eval('.r8-msg.bot .r8-bub', (a) => a.map((x) => x.textContent.trim()));
      const mine = await pg.$$eval('.r8-msg.me', (a) => a.map((x) => x.textContent.trim()));
      log(replies.length === 2 && replies[1].length > 10 && mine.includes('为什么不能选乙？'), '自由输入追问：显示我的问题，并得到第二条回复', replies[1].slice(0, 30));
      await pg.click('.r8-ai [data-m=guide]'); await pg.waitForFunction(() => { const b = document.querySelector('.r8-msg.bot .r8-bub'); return b && /第 1 步/.test(b.textContent); }, null, { timeout: 10000 });
      log(await pg.$('.qz-ai-mask') === null, '「一步步引导」是浮层里的模式切换，不再弹居中遮罩小窗');
      await pg.click('.r8-ai [data-act=min]');
      log(await pg.$eval('.r8-ai', (e) => getComputedStyle(e).display === 'none') && await pg.$('.r8-ai-pill:not([hidden])') !== null, 'AI 浮层可以最小化（右下角留一个「AI 老师 · 展开」）');
      await pg.click('.r8-ai-pill');
      await pg.click('#qzGoNext'); await pg.waitForTimeout(500);
      const follow = await pg.$eval('#r8AiQ', (e) => e.textContent);
      log(/第 2 题/.test(follow), '切换题目时，浮层内容跟着当前题走', follow.slice(0, 20));
      await pg.click('.r8-ai [data-act=close]');
      await pg.fill('[data-blank="0"]', '2'); await pg.fill('[data-blank="1"]', '5'); await pg.click('#qzCheckOne'); await pg.waitForSelector('.r8-fb', { timeout: 5000 });
      const bm = await pg.$$eval('.r8-bm', (a) => a.map((x) => x.classList.contains('ok') ? 'ok' : 'no'));
      log(bm.join() === 'ok,no', '填空逐空打 ✓ / ✗', bm.join());
      await pg.click('#qzFinishCheck'); await pg.waitForSelector('.r8-rep', { timeout: 8000 });
      const rep = await pg.evaluate(() => ({ nos: document.querySelectorAll('.r8-rep-nos .r8-no').length, ring: !!document.querySelector('.r8-ring'), txt: document.querySelector('.r8-rep').innerText }));
      log(rep.nos === 2 && rep.ring && /错题本/.test(rep.txt) && /薄弱知识点/.test(rep.txt) && /用时/.test(rep.txt), '做题报告：得分环、用时、题号方块数量正确（2）、薄弱知识点、错题已进错题本', `${rep.nos} 个方块`);
      await pg.close();

      // 手机 390：顶栏不换行、AI 浮层为底部抽屉
      const mp = await open(390, 844);
      const mobileGroup = mp.locator('.round-course-group').filter({ has: mp.locator('.round-group-title', { hasText: TAG + '小分组A' }) });
      await mobileGroup.locator('.round-group-title').click();
      await mobileGroup.getByRole('button', { name: '练习' + TAG + '视频一', exact: true }).click(); await mp.waitForSelector('.r8-qz', { timeout: 8000 }); await mp.waitForTimeout(500);
      const head = await mp.evaluate(() => { const h = document.querySelector('.r8-qz-h'); const t = h.querySelector('.quiz-h-t b'); return { h: h.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(t).lineHeight) || 24, th: t.getBoundingClientRect().height }; });
      log(head.h <= 64 && head.th <= head.lh * 1.3, '手机：做题弹窗顶栏一行不换行（标题省略号）', JSON.stringify(head));
      await mp.click('.qz-opt >> nth=1'); await mp.click('#qzCheckOne'); await mp.waitForSelector('.r8-fb', { timeout: 5000 });
      const btnH = await mp.$$eval('.quiz-f .btn', (a) => a.map((b) => Math.round(b.getBoundingClientRect().height)));
      log(btnH.every((x) => x <= 52), '手机：底部按钮文字不竖排（按钮高度正常）', btnH.join(','));
      await mp.click('#qzAiFab'); await mp.waitForSelector('.r8-ai.show', { timeout: 4000 }); await mp.waitForTimeout(400);
      const dr = await mp.evaluate(() => { const r = document.querySelector('.r8-ai').getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), b: Math.round(innerHeight - r.bottom), h: Math.round(r.height), vh: innerHeight, quizBottom: document.querySelector('.quiz-box').getBoundingClientRect().bottom, aiTop:r.top }; });
      log(dr.l === 0 && dr.w === 390 && dr.b === 0 && Math.abs(dr.h - dr.vh * 0.48) < 4 && dr.quizBottom <= dr.aiTop + 1, '手机：AI 抽屉整宽贴底，与题卡上下分区且不遮挡题卡', JSON.stringify(dr));
      await mp.close();
      log(errs.length === 0, '全程无页面脚本报错', errs.slice(0, 3).join(' | '));
    } catch (e) {
      log(false, '浏览器部分异常', e.message);
    }
    await browser.close();
  }

  cleanup();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { cleanup(); } catch (er) { /* ignore */ } process.exit(1); });
