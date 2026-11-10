'use strict';
/**
 * 课文习题（T6）自测： node lessonq-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；同时直连 MySQL 造专用课程/视频/题目/学生，结束后清理。
 * 覆盖：视频 / 小分组 / 课程正确率（每题取最近一次作答；小分组是合并计算不是百分比平均）、
 *       做完题后的学习报告（本次各知识点 + 视频/小分组现在的正确率）、问答题不判分不进错题、
 *       后台按学生查看正确率（含分校越权）、绑定的题在题库管理里查得到。
 */
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const j = ct.includes('json') ? await res.json() : {};
  j._status = res.status; return j;
}
const now = '2026-11-02 00:00:00';
const uniq = Date.now().toString().slice(-8);
const TAG = 'T6测试';
const opts = JSON.stringify([{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }]);

function addQ(videoId, chapterId, type, stem, answer, point) {
  return db.prepare(`INSERT INTO questions (chapter_id,subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,video_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,3,?,?,?)`)
    .run(chapterId, '数学', '七年级', 'junior', type, `${TAG}${stem}`, type === 'single' ? opts : '[]', answer, '解析', point, videoId, now).lastInsertRowid;
}
function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    db.prepare('DELETE FROM records WHERE question_id=?').run(q.id);
    db.prepare('DELETE FROM mistakes WHERE question_id=?').run(q.id);
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`SELECT id FROM chapters WHERE name LIKE '${TAG}%'`).all().forEach((c) => {
    db.prepare('DELETE FROM videos WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM sections WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM progress WHERE chapter_id=?').run(c.id);
    db.prepare('DELETE FROM chapters WHERE id=?').run(c.id);
  });
  db.prepare("SELECT id FROM users WHERE username LIKE 't6s%'").all().forEach((u) => {
    ['records', 'mistakes', 'practices', 'paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(u.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
}

(async () => {
  console.log('\n=== 课文习题（T6）· 自测 ===\n');
  cleanup();
  // 课程：1 个分组 A（V1、V2），V3 不分组
  const ch = db.prepare("INSERT INTO chapters (subject,grade,term,book,name,code,sort,category,stage,created_at) VALUES ('数学','七年级','上册','',?,'',99,'同步基础','junior',?)").run(TAG + '课程', now).lastInsertRowid;
  const secA = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,0,?)').run(ch, TAG + '小分组A', now).lastInsertRowid;
  const mkV = (title, sec) => db.prepare("INSERT INTO videos (chapter_id,section_id,subject,grade,title,file_path,url,duration,level,sort,created_at) VALUES (?,?,'数学','七年级',?,'x.mp4','',60,1,0,?)").run(ch, sec, TAG + title, now).lastInsertRowid;
  const v1 = mkV('视频一', secA), v2 = mkV('视频二', secA), v3 = mkV('视频三', null);
  const q1 = addQ(v1, ch, 'single', '题1', 'A', '知识点甲'), q2 = addQ(v1, ch, 'single', '题2', 'A', '知识点甲'), q3 = addQ(v1, ch, 'single', '题3', 'B', '知识点乙');
  const q4 = addQ(v1, ch, 'answer', '问答题4', '参考答案四', '知识点乙');
  const q5 = addQ(v2, ch, 'single', '题5', 'A', '知识点丙'), q6 = addQ(v2, ch, 'single', '题6', 'B', '知识点丙');
  const q7 = addQ(v3, ch, 'judge', '题7', '正确', '知识点丁');
  const uA = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,?,1,1,'2099-12-31',1,?)")
    .run('t6s' + uniq + 'a', hash('123456'), 'T6学生甲', '七年级', '上册', now).lastInsertRowid;
  const uB = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,?,1,1,'2099-12-31',1,?)")
    .run('t6s' + uniq + 'b', hash('123456'), 'T6学生乙', '七年级', '上册', now).lastInsertRowid;
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('zlx-ci-admin', 'admin');
  const TA = await login('t6s' + uniq + 'a', 'student');
  const TB = await login('t6s' + uniq + 'b', 'student');
  log(AT && TA && TB, '造数 + 登录：1 门课、1 个小分组（2 个视频）、1 个不分组视频、7 道题（含 1 道问答）');

  const course = async (tok) => (await req(`/api/stu/course-detail?id=${ch}`, { token: tok })).data;
  const L = (c, vid) => c.lessons.find((l) => l.video_id === vid);
  const G = (c) => c.groups.find((g) => g.id === secA);

  // ---------- 1) 没做过：未做，总数不含问答题 ----------
  let c = await course(TA);
  log(L(c, v1).acc.total === 3 && L(c, v1).acc.rate === null && L(c, v1).acc.answered === 0, '没做过：视频一 3 题（问答题不计入）、正确率未做（null）', JSON.stringify(L(c, v1).acc));
  log(G(c).acc.total === 5 && G(c).acc.rate === null, '小分组 A 共 5 题', JSON.stringify(G(c).acc));

  // ---------- 2) 做视频一：q1 对、q2 错、q4（问答）---------
  const sub = (tok, vid, ans) => req('/api/stu/bank/submit', { method: 'POST', token: tok, body: { kind: 'practice', video_id: vid, answers: ans.map(([id, a]) => ({ question_id: id, my_answer: a })) } });
  let r = await sub(TA, v1, [[q1, 'A'], [q2, 'B'], [q4, '我的解答']]);
  log(r.code === 0 && r.data.total === 2 && r.data.correct === 1 && r.data.wrong === 1, '交卷：问答题不计分，总数 2、答对 1', r.msg);
  const ung = (r.data.list || []).find((x) => x.question_id === q4);
  log(ung && ung.ungraded === true && ung.answer === '参考答案四', '问答题返回参考答案并标记 ungraded');
  log(db.prepare('SELECT COUNT(*) n FROM records WHERE user_id=? AND question_id=?').get(uA, q4).n === 0 && db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND question_id=?').get(uA, q4).n === 0, '问答题不进作答记录、不进错题本');
  const m = r.data.mastery;
  log(m && m.video.answered === 2 && m.video.correct === 1 && m.video.rate === 50 && m.video.total === 3, '学习报告：视频一 已做 2 / 3，答对 1 → 50%', JSON.stringify(m && m.video));
  log(m && m.section && m.section.name === TAG + '小分组A' && m.section.answered === 2 && m.section.correct === 1 && m.section.rate === 50 && m.section.total === 5, '学习报告：小分组 A 已做 2 / 5，答对 1 → 50%', JSON.stringify(m && m.section));
  const bp = Object.fromEntries((r.data.by_point || []).map((x) => [x.point, x]));
  log(bp['知识点甲'] && bp['知识点甲'].total === 2 && bp['知识点甲'].correct === 1 && !bp['知识点乙'], '学习报告：本次各知识点（甲 1/2；问答题所在的乙没有计分题，不出现）', JSON.stringify(r.data.by_point));
  c = await course(TA);
  log(L(c, v1).acc.rate === 50 && L(c, v2).acc.rate === null && G(c).acc.rate === 50 && c.acc.rate === 50, '课程页立即变化：视频一 50%、视频二 未做、小分组 50%、整门课 50%');

  // ---------- 3) 再做一次：q2 改对、q3 答错 → 每题取最近一次 ----------
  r = await sub(TA, v1, [[q2, 'A'], [q3, 'A']]);
  c = await course(TA);
  log(L(c, v1).acc.answered === 3 && L(c, v1).acc.correct === 2 && L(c, v1).acc.rate === 67, '重做 q2 答对、q3 答错：每题取最近一次 → 3 题做过、2 对、67%（不是按 4 次作答算）', JSON.stringify(L(c, v1).acc));

  // ---------- 4) 视频二满分 → 小分组 = 合并计算（4/5 = 80%），不是 (67+100)/2 ----------
  r = await sub(TA, v2, [[q5, 'A'], [q6, 'B']]);
  c = await course(TA);
  log(L(c, v2).acc.rate === 100 && G(c).acc.answered === 5 && G(c).acc.correct === 4 && G(c).acc.rate === 80, '视频二 2/2 → 100%；小分组合并 4/5 = 80%（不是平均 84%）', JSON.stringify(G(c).acc));
  log(r.data.mastery.section.rate === 80, '交卷返回的小分组正确率与课程页一致');
  log(L(c, v3).acc.rate === null && c.groups.find((g) => g.id === 0), '不分组视频三：未做，归在「未分组」');

  // ---------- 5) 学生之间互不影响 ----------
  const cb = await course(TB);
  log(L(cb, v1).acc.rate === null && G(cb).acc.answered === 0, '另一个学生的正确率不受影响（仍未做）');
  const mine = db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=0').get(uA).n;
  log(Number(mine) === 1, '错题本只有现在仍答错的 q3（q2 重做答对已掌握）', String(mine));

  // ---------- 6) 后台：按学生看视频 / 小分组正确率 ----------
  const ad = await req(`/api/admin/bank/accuracy?user_id=${uA}`, { token: AT });
  const ac = ad.data && ad.data.courses.find((x) => x.id === ch);
  const ag = ac && ac.groups.find((g) => g.id === secA);
  log(ad.code === 0 && ac && ac.acc.answered === 5 && ac.acc.correct === 4 && ag && ag.acc.rate === 80 && ag.videos.length === 2 && ag.videos.find((v) => v.id === v1).acc.rate === 67,
    '后台：课程 / 小分组 / 视频正确率与学生端一致（小分组 80%、视频一 67%）', ad.msg);
  log(ac && ac.groups.some((g) => g.id === 0 && g.videos.length === 1), '后台：未分组视频单独成组');
  const adB = await req(`/api/admin/bank/accuracy?user_id=${uB}`, { token: AT });
  log(adB.code === 0 && adB.data.courses.find((x) => x.id === ch).acc.rate === null, '后台：没做过的学生显示未做');
  const nf = await req('/api/admin/bank/accuracy?user_id=999999999', { token: AT });
  log(nf.code !== 0, '后台：学生不存在 → 提示');
  const st = await req(`/api/admin/bank/accuracy?user_id=${uA}`, { token: TA });
  log(st._status === 403 || st.code !== 0, '学生 token 不能看后台正确率接口', `HTTP ${st._status}`);
  // 分校只能看自己校区（created_by = 分校账号）的学生
  const brId = db.prepare("INSERT INTO users (role,username,password,name,status,created_at) VALUES ('branch',?,?,?,1,?)").run('t6s' + uniq + 'br', hash('123456'), 'T6分校', now).lastInsertRowid;
  db.prepare('UPDATE users SET created_by=? WHERE id=?').run(brId, uB);
  const BT = (await req('/api/login', { method: 'POST', body: { username: 't6s' + uniq + 'br', password: '123456', role: 'branch' } })).data;
  if (BT && BT.token) {
    const bx = await req(`/api/admin/bank/accuracy?user_id=${uA}`, { token: BT.token });
    log(bx.code !== 0 && /无权/.test(bx.msg || ''), '分校账号看不了别的校区的学生', bx.msg);
    const by = await req(`/api/admin/bank/accuracy?user_id=${uB}`, { token: BT.token });
    log(by.code === 0 && by.data.student.id === uB, '分校账号能看自己校区的学生');
  } else log(false, '分校登录失败（无法验证越权）', JSON.stringify(BT));

  // ---------- 7) 绑定的题在题库管理里查得到 ----------
  const lst = await req(`/api/admin/bank/mf/questions?kw=${encodeURIComponent(TAG + '题1')}`, { token: AT });
  const rows = (lst.data && (lst.data.list || lst.data)) || [];
  log(lst.code === 0 && rows.some((x) => x.id === q1), '绑定到视频的题在「题库管理」里能查到', `命中 ${rows.length} 条`);
  const lst2 = await req(`/api/admin/bank/mf/questions?kw=${encodeURIComponent(TAG + '问答题4')}`, { token: AT });
  log(((lst2.data && (lst2.data.list || lst2.data)) || []).some((x) => x.id === q4), '问答题同样能查到');

  cleanup();
  log(db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE '${TAG}%'`).get().n === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
