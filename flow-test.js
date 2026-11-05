'use strict';
/**
 * 全流程走查（T14）： node flow-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local AI_MOCK=1 TTS_MOCK=1）并 npm run seed；直连同一个 MySQL 造学生，结束后清理。
 * 一条线走完任务书的验收流程：
 *   录题（Excel / Word / 技能包 三种入口）→ 待审核（来源标注）→ 入库（挂知识点树节点）→ 组卷（章节 / 知识点范围）→ 保存并下发给学生 →
 *   学生在「我的任务」里做题交卷 → 课文习题按视频出正确率（学生端 / 后台一致）→ 错题进错题本 → 导出可编辑的 Word（.docx）。
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
const ADM = '/api/admin/bank';
const STU = '/api/stu/bank';
const R = path.join(__dirname, 'docs', '原始需求');
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  if (raw) return res;
  const j = await res.json(); j._status = res.status; return j;
}
const fileForm = (name, buf, fields = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
};
const uniq = Date.now().toString().slice(-8);
const made = { questions: [], runs: [], users: [], papers: [], videos: [], chapters: [] };

function cleanup() {
  const qs = [...made.questions];
  db.prepare(`SELECT id FROM questions WHERE stem LIKE 'FLOW%${uniq}%'`).all().forEach((q) => qs.push(q.id));
  qs.forEach((id) => {
    ['mistakes', 'records', 'question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(id);
  });
  made.papers.forEach((id) => { ['paper_assignments', 'paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE paper_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM papers WHERE id=?').run(id); });
  made.runs.filter(Boolean).forEach((id) => { try { db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id); } catch (e) { /* ignore */ } });
  made.videos.forEach((id) => db.prepare('DELETE FROM videos WHERE id=?').run(id));
  made.chapters.forEach((id) => db.prepare('DELETE FROM chapters WHERE id=?').run(id));
  made.users.forEach((id) => { ['mistakes', 'records', 'practices', 'paper_tries', 'paper_assignments'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM users WHERE id=?').run(id); });
}

(async () => {
  console.log('\n=== 全流程走查（T14）· 录题 → 待审核 → 入库 → 组卷 → 下发 → 做题 → 正确率 → 错题 → Word 导出 ===\n');
  cleanup();
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const sid = db.prepare("INSERT INTO users (role,username,password,name,grade,term,stage,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'FLOW学生','七年级','上册','junior',1,1,'2099-12-31',1,'2026-11-02')").run('flow' + uniq, hash('123456')).lastInsertRowid; made.users.push(sid);
  const ST = await login('flow' + uniq, 'student');
  log(!!AT && !!ST, '管理员和测试学生登录');
  const pend = async () => (await req(`${MF}/ext/pending?size=100`, { token: AT })).data;
  const runItems = (d, runId) => d.list.filter((x) => x.kind === 'run' && x.batch_id === runId);

  // ---------- 1) 录题：三种入口都先进「待审核」 ----------
  console.log('【1 录题：Excel / Word / 技能包】');
  const tpl = await fetch(BASE + MF + '/ext/import-template', { headers: { Authorization: 'Bearer ' + AT } });
  const wb = XLSX.read(Buffer.from(await tpl.arrayBuffer()), { type: 'buffer' });
  const ws = wb.Sheets['单选题'];
  XLSX.utils.sheet_add_aoa(ws, [
    ['FLOW单选一' + uniq + '：1+1=?', '1', '2', '3', '', '', '', '', 'B', '1+1=2', ''],
    ['FLOW单选二' + uniq + '：2+2=?', '3', '4', '5', '', '', '', '', 'B', '2+2=4', ''],
    ['FLOW单选三' + uniq + '：3+3=?', '5', '6', '7', '', '', '', '', 'B', '3+3=6', ''],
  ], { origin: XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).length });
  const xl = await req(`${MF}/ext/import-excel`, { method: 'POST', token: AT, form: fileForm('FLOW.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { subject: '数学', stage: 'junior', grade: '七年级' }) });
  made.runs.push(xl.data && xl.data.run_id);
  log(xl.code === 0 && xl.data.total === 3, 'Excel 入口：3 题进入待审核', xl.msg);
  const wd = await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('洋葱题库-样例.docx', fs.readFileSync(path.join(R, '洋葱题库-样例.docx')), { subject: '数学', stage: 'junior', grade: '七年级' }) });
  made.runs.push(wd.data && wd.data.run_id);
  log(wd.code === 0 && wd.data.total === 10 && wd.data.error_count === 0, 'Word 入口：客户样例 10 题进入待审核', wd.msg);
  const pack = {
    format: 'mofang-question-pack', schemaVersion: 1, packageId: 'FLOW' + uniq, sources: [{ id: 's1', name: 'FLOW来源' }], assets: [],
    questions: [
      { recordKey: 'f1' + uniq, source: { sourceId: 's1' }, content: { stem: 'FLOW技能包单选' + uniq, options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }], answer: 'A', analysis: '解析' }, metadata: { subject: { label: '数学' }, stage: { label: '初中' }, questionType: { label: '单选题' }, knowledgePoints: ['FLOW知识点'] } },
      { recordKey: 'f2' + uniq, source: { sourceId: 's1' }, content: { stem: 'FLOW技能包填空' + uniq, answer: '42' }, metadata: { subject: { label: '数学' }, stage: { label: '初中' } } },
    ],
  };
  const pk = await req(`${MF}/import-pack`, { method: 'POST', token: AT, body: { pack } });
  made.runs.push(pk.data && pk.data.run_id);
  log(pk.code === 0 && pk.data.staged === 2, '技能包入口：2 题进入待审核', pk.msg);

  // ---------- 2) 待审核：来源标注，题库里还没有 ----------
  console.log('【2 待审核】');
  let d = await pend();
  const exI = runItems(d, xl.data.run_id), wdI = runItems(d, wd.data.run_id), pkI = runItems(d, pk.data.run_id);
  log(exI.length === 3 && wdI.length === 10 && pkI.length === 2, '待审核列表里三个入口的题都在', `${exI.length}/${wdI.length}/${pkI.length}`);
  const labels = [exI[0], wdI[0], pkI[0]].map((x) => x && x.source_label);
  log(new Set(labels).size === 3 && labels.every(Boolean), '每个入口的题都标了不同的来源', labels.join(' / '));
  log((await req(`${MF}/questions?kw=FLOW单选一${uniq}&size=5`, { token: AT })).data.total === 0, '入库之前，题库里还没有这些题');
  const edit = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: exI[0].id, patch: { analysis: '审核时补的解析' } } });
  log(edit.code === 0, '审核：逐题修改（补解析）', edit.msg);

  // ---------- 3) 入库：挂知识点树 + 章节树节点 ----------
  console.log('【3 入库】');
  const kTree = ((await req(`${MF}/trees?kind=knowledge`, { token: AT })).data.list || []).find((t) => t.subject === '数学' && t.stage === 'junior');
  const cTree = ((await req(`${MF}/trees?kind=textbook`, { token: AT })).data.list || []).find((t) => t.subject === '数学' && t.stage === 'junior');
  const kNode = ((await req(`${MF}/trees/${kTree.id}/nodes`, { token: AT })).data.list || [])[0];
  const cNode = ((await req(`${MF}/trees/${cTree.id}/nodes`, { token: AT })).data.list || [])[0];
  log(!!kNode && !!cNode, '数学（初中）的章节树和知识点树都有节点可挂');
  const ids = [...exI, ...wdI, ...pkI].map((x) => x.id);
  const cm = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids, node_ids: [kNode.id, cNode.id], tags: ['FLOW批标签'] } });
  made.questions.push(...((cm.data && cm.data.question_ids) || []));
  log(cm.code === 0 && cm.data.committed === 15, '15 题一次入库', cm.msg);
  d = await pend();
  log(!d.list.some((x) => ids.includes(x.id)), '入库后离开待审核');
  const qd = {};
  for (const id of made.questions) qd[id] = (await req(`${MF}/questions/${id}`, { token: AT })).data.question;
  log(made.questions.every((id) => (qd[id].nodes || []).includes(kNode.id) && (qd[id].nodes || []).includes(cNode.id) && (qd[id].tags || []).includes('FLOW批标签')), '入库的题都挂了章节节点、知识点节点和标签');
  const srcs = new Set(made.questions.map((id) => qd[id].source_type));
  log(srcs.size >= 2, '题目带来源类型', [...srcs].join(','));
  const singles = made.questions.filter((id) => qd[id].type === 'single' && String(qd[id].answer || '').trim()).slice(0, 6);
  log(singles.length >= 5, '入库的题里有 5 道以上有标准答案的单选题，可以用来组卷', String(singles.length));

  // ---------- 4) 组卷 ----------
  console.log('【4 组卷】');
  const pool = await req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: '数学', stage: 'junior', node_ids: [kNode.id] } });
  log(pool.code === 0 && pool.data.total >= 14 && pool.data.single >= singles.length, '知识点范围的题池里有刚入库的题', JSON.stringify(pool.data));
  const auto = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: '数学', stage: 'junior', node_ids: [kNode.id], counts: { single: 3 } } });
  log(auto.code === 0 && (auto.data.list || []).length === 3, '一键组卷：按知识点范围抽 3 道单选', auto.msg);
  const chap = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: '数学', stage: 'junior', node_ids: [cNode.id], counts: { single: 2 } } });
  log(chap.code === 0 && (chap.data.list || []).length === 2, '章节范围同样能组卷', chap.msg);
  const saved = await req(`${ADM}/papers`, { method: 'POST', token: AT, body: { title: 'FLOW走查卷' + uniq, subject: '数学', stage: 'junior', grade: '七年级', q_ids: singles, status: 'draft' } });
  const pid = saved.data && saved.data.id; if (pid) made.papers.push(pid);
  log(saved.code === 0 && !!pid, '保存为草稿', 'paper#' + pid);

  // ---------- 5) 下发 ----------
  console.log('【5 下发】');
  log(!((await req(`${STU}/tasks`, { token: ST })).data || []).some((t) => t.id === pid), '草稿阶段学生看不到');
  const asg = await req(`${ADM}/papers/${pid}/assign`, { method: 'POST', token: AT, body: { user_ids: [sid] } });
  log(asg.code === 0 && asg.data.added === 1, '下发给这名学生', asg.msg);
  const tk = await req(`${STU}/tasks`, { token: ST });
  log((tk.data || []).some((t) => t.id === pid && t.assigned && !t.tried), '学生「我的任务」里出现这份卷子，未做', tk.msg);

  // ---------- 6) 学生做题 ----------
  console.log('【6 学生做题】');
  const wrongOf = (a) => (String(a).toUpperCase().includes('A') ? 'B' : 'A');
  const answers = singles.map((id, i) => ({ question_id: id, my_answer: i < singles.length - 2 ? String(qd[id].answer).trim().toUpperCase() : wrongOf(qd[id].answer) }));
  const sub = await req(`${STU}/submit`, { method: 'POST', token: ST, body: { kind: 'paper', paper_id: pid, answers } });
  log(sub.code === 0 && sub.data.correct === singles.length - 2 && sub.data.wrong === 2, `交卷：${singles.length} 题答对 ${singles.length - 2}、答错 2`, sub.msg + ' ' + JSON.stringify(sub.data && { c: sub.data.correct, w: sub.data.wrong }));
  const done = await req(`${STU}/tasks`, { token: ST });
  log((done.data || []).some((t) => t.id === pid && t.tried), '交卷后「我的任务」标为已做');

  // ---------- 7) 正确率：课文习题按视频 / 小分组 ----------
  console.log('【7 正确率】');
  const ch = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '七年级', name: 'FLOW目录' + uniq } });
  const chId = ch.data && ch.data.id; if (chId) made.chapters.push(chId);
  const vid = db.prepare("INSERT INTO videos (chapter_id,title,level,created_at) VALUES (?,?,?,?)").run(chId, 'FLOW知识点' + uniq, 'basic', '2026-11-02 10:00:00').lastInsertRowid; made.videos.push(vid);
  const lessonQs = singles.slice(0, 4);
  const bind = await req(`${ADM}/videos/${vid}/bind`, { method: 'POST', token: AT, body: { ids: lessonQs } });
  log(bind.code === 0, '课文习题：把 4 道题绑到视频', bind.msg);
  const pr = await req(`${STU}/submit`, { method: 'POST', token: ST, body: { kind: 'practice', video_id: vid, answers: lessonQs.map((id, i) => ({ question_id: id, my_answer: i < 3 ? String(qd[id].answer).trim().toUpperCase() : wrongOf(qd[id].answer) })) } });
  log(pr.code === 0 && pr.data.correct === 3 && pr.data.wrong === 1, '学生做课文习题：4 题对 3 错 1', pr.msg);
  const acc = await req(`${ADM}/accuracy?user_id=${sid}`, { token: AT });
  const course = acc.data && acc.data.courses.find((x) => x.id === chId);
  const video = course && course.groups.flatMap((g) => g.videos).find((v) => v.id === vid);
  log(!!video && video.acc.answered === 4 && video.acc.correct === 3 && video.acc.rate === 75, '后台「知识点正确率」：这个视频 3/4 = 75%', JSON.stringify(video && video.acc));

  // ---------- 8) 错题 ----------
  console.log('【8 错题】');
  const wrongRows = db.prepare('SELECT question_id FROM mistakes WHERE user_id=? AND resolved=0').all(sid).map((r) => r.question_id);
  log(wrongRows.length >= 2 && answers.slice(-2).every((a) => wrongRows.includes(a.question_id)), '试卷里答错的 2 题进了错题本', String(wrongRows.length));
  const ml = await req(`${STU}/mistakes?resolved=0`, { token: ST });
  const mlIds = ((ml.data && ml.data.list) || []).map((m) => m.question_id);
  log(ml.code === 0 && answers.slice(-2).every((a) => mlIds.includes(a.question_id)), '学生端错题本接口能取到这些错题', ml.msg + ' ' + mlIds.length);

  // ---------- 9) Word 导出 ----------
  console.log('【9 Word 导出】');
  const dx = await req('/api/stu/mistakes/export-docx', { token: ST, raw: true });
  const buf = Buffer.from(await dx.arrayBuffer());
  const ct = dx.headers.get('content-type') || '';
  log(dx.status === 200 && ct.includes('wordprocessingml') && buf.slice(0, 2).toString() === 'PK', '错题导出：返回 .docx（PK 压缩包）', ct);
  log(Number(dx.headers.get('x-mistake-count')) === wrongRows.length, '响应头里的题数 = 错题本里的题数', dx.headers.get('x-mistake-count'));
  log(buf.toString('latin1').includes('word/document.xml'), '包里有 word/document.xml（可用 Word / WPS 打开编辑）');
  const dxA = await req(`${ADM}/mistakes/export-docx?user_id=${sid}`, { token: AT, raw: true });
  log(dxA.status === 200, '后台也能导出这名学生的错题 Word');

  cleanup();
  const left = Number(db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE 'FLOW%${uniq}%'`).get().n) + Number(db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 'flow%'").get().n);
  log(left === 0, '测试数据已清理（洋葱样例题没有统一前缀，按 id 清理）');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
