'use strict';
/**
 * 组卷（T5）自测： node compose-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；同时直连 MySQL 造专用学科/树/题目/学生，结束后清理。
 * 覆盖：
 *   1) 管理端：按章节树节点（含后代）组卷 / 范围题量 / 题库不足提示
 *   2) 老师组卷 → 保存 → 下发给 2 名学生：两人「我的任务」都能看到并交卷，未被选中的学生看不到也不能交
 *   3) 学生端知识点组卷（每个最小知识点 1 题）→ 自测交卷，成绩和错题进入记录
 *   4) 权限：学生 token 不能调管理端接口
 */
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
const ADM = '/api/admin/bank';
const STU = '/api/stu/bank';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };

async function req(p, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const j = ct.includes('json') ? await res.json() : {};
  j._status = res.status;
  return j;
}

const SUBJECT = 'T5测试学科';
const GRADE = '七年级';
const now = '2026-11-02 00:00:00';
const uniq = Date.now().toString().slice(-8);
const made = { trees: [], users: [], papers: [] };

function addQ(type, stem, answer, nodeIds, opts) {
  const options = type === 'single' || type === 'multi' ? JSON.stringify([{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }, { label: 'C', content: '丙' }]) : '[]';
  const id = db.prepare(`INSERT INTO questions (subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(SUBJECT, GRADE, 'junior', type, stem, options, answer, '解析', 3, (opts && opts.point) || '', now).lastInsertRowid;
  nodeIds.forEach((n) => db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)').run(id, n));
  return id;
}
function addTree(kind, name) {
  const t = db.prepare('INSERT INTO bank_trees (kind,subject,stage,name,source,sort,created_at) VALUES (?,?,?,?,?,?,?)').run(kind, SUBJECT, 'junior', name, 't5-test', 0, now).lastInsertRowid;
  made.trees.push(t); return t;
}
function addNode(tree, parent, name) {
  return db.prepare('INSERT INTO bank_tree_nodes (tree_id,parent_id,name,sort,created_at) VALUES (?,?,?,?,?)').run(tree, parent, name, 0, now).lastInsertRowid;
}
function addStudent(i, grade) {
  const username = `t5s${uniq}${i}`;
  const id = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,?,1,1,'2099-12-31',1,?)")
    .run(username, hash('123456'), 'T5学生' + i, grade, '上册', now).lastInsertRowid;
  made.users.push(id); return { id, username };
}
function cleanup() {
  const qs = db.prepare('SELECT id FROM questions WHERE subject=?').all(SUBJECT).map((r) => r.id);
  qs.forEach((id) => {
    db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(id);
    db.prepare('DELETE FROM records WHERE question_id=?').run(id);
    db.prepare('DELETE FROM mistakes WHERE question_id=?').run(id);
    db.prepare('DELETE FROM subjective_responses WHERE question_id=?').run(id);
    db.prepare('DELETE FROM questions WHERE id=?').run(id);
  });
  db.prepare("SELECT id FROM bank_trees WHERE subject=?").all(SUBJECT).forEach((t) => {
    db.prepare('DELETE FROM bank_tree_nodes WHERE tree_id=?').run(t.id);
    db.prepare('DELETE FROM bank_trees WHERE id=?').run(t.id);
  });
  db.prepare("SELECT id FROM papers WHERE title LIKE 'T5测试卷%'").all().forEach((p) => {
    db.prepare('DELETE FROM paper_assignments WHERE paper_id=?').run(p.id);
    db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(p.id);
    db.prepare('DELETE FROM papers WHERE id=?').run(p.id);
  });
  db.prepare("SELECT id FROM users WHERE username LIKE 't5s%'").all().forEach((u) => {
    ['records', 'mistakes', 'practices', 'paper_tries', 'paper_assignments'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(u.id); } catch (e) { /* 表不存在则略过 */ } });
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
}

(async () => {
  console.log('\n=== 组卷（T5）· 自测 ===\n');
  cleanup();

  // ---------- 造数据：章节树 第一章(1.1 / 1.2)、第二章；知识点树 代数(整式 / 方程) ----------
  const ch = addTree('textbook', 'T5章节树');
  const c1 = addNode(ch, null, '第一章');
  const c11 = addNode(ch, c1, '1.1 小节');
  const c12 = addNode(ch, c1, '1.2 小节');
  const c2 = addNode(ch, null, '第二章');
  const kn = addTree('knowledge', 'T5知识点树');
  const k1 = addNode(kn, null, '代数');
  const k11 = addNode(kn, k1, '整式');
  const k12 = addNode(kn, k1, '方程');

  const q = {};
  q.s1 = addQ('single', 'T5单选一', 'A', [c11, k11]);
  q.s2 = addQ('single', 'T5单选二', 'B', [c11, k11]);
  q.s3 = addQ('single', 'T5单选三', 'A', [c12, k12]);
  q.s4 = addQ('single', 'T5单选四', 'C', [c12, k12]);
  q.m1 = addQ('multi', 'T5多选一', 'A,B', [c11, k11]);
  q.j1 = addQ('judge', 'T5判断一', '正确', [c12, k12]);
  q.f1 = addQ('fill', 'T5填空一 ____', '答案', [c2]);       // 第二章：不在第一章范围内
  const qAll = Object.values(q);
  log(qAll.length === 7, '造数：2 棵树、7 道题', `树=${made.trees.length}`);

  const adm = await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } });
  const AT = adm.data && adm.data.token;
  log(!!AT, '管理员登录');
  const s1 = addStudent(1, GRADE), s2 = addStudent(2, GRADE), s3 = addStudent(3, GRADE);
  const tok = {};
  for (const s of [s1, s2, s3]) {
    const r = await req('/api/login', { method: 'POST', body: { username: s.username, password: '123456', role: 'student' } });
    tok[s.id] = r.data && r.data.token;
  }
  log(Object.values(tok).every(Boolean), '3 名测试学生登录');

  // ---------- 1) 管理端：按章节树节点（含后代）组卷 ----------
  const pool = await req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1] } });
  log(pool.code === 0 && pool.data.total === 6 && pool.data.single === 4 && pool.data.multi === 1 && pool.data.judge === 1 && pool.data.fill === 0,
    '选「第一章」= 包含 1.1 和 1.2 的全部后代：范围内 4 单选 + 1 多选 + 1 判断（第二章的填空不算）', JSON.stringify(pool.data));
  const pool2 = await req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c11] } });
  log(pool2.data.total === 3 && pool2.data.single === 2, '只选 1.1 小节：2 单选 + 1 多选', JSON.stringify(pool2.data));
  const poolAll = await req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: SUBJECT } });
  log(poolAll.data.total === 7, '不选节点 = 整个学科范围 7 题', JSON.stringify(poolAll.data));
  const poolNone = await req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [999999999] } });
  log(poolNone.data.total === 0, '选了不存在的节点：范围为 0，不会退化成全库', JSON.stringify(poolNone.data));

  const auto = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], counts: { single: 3, multi: 1, judge: 1 } } });
  const autoIds = (auto.data && auto.data.list || []).map((x) => x.id);
  log(auto.code === 0 && autoIds.length === 5 && autoIds.every((id) => id !== q.f1) && auto.data.missing.length === 0,
    '一键组卷（章节树「第一章」）：3 单选 + 1 多选 + 1 判断，全部来自范围内', `共 ${autoIds.length} 题`);
  const short = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], counts: { single: 6, fill: 2 } } });
  log(short.code === 0 && short.data.list.length === 4 && short.data.missing.length === 2 && /单选.*差 2 题/.test(short.data.missing.join()) && /填空.*差 2 题/.test(short.data.missing.join()),
    '题库不够：照样返回能抽的，并列出缺口（单选差 2、填空差 2）', short.data && short.data.missing.join('；'));
  const none = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, counts: {} } });
  log(none.code !== 0, '没填任何题型数量：提示');
  db.prepare('UPDATE questions SET difficulty=1 WHERE id IN (?,?)').run(q.s1, q.s2);
  db.prepare('UPDATE questions SET difficulty=5 WHERE id IN (?,?)').run(q.s3, q.s4);
  const ratio = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], counts: { single: 2, multi: 1, judge: 1 }, difficulty_ratios: { easy: 50, medium: 50, hard: 0 } } });
  const ratioList = ratio.data && ratio.data.list || [];
  log(ratio.code === 0 && ratioList.length === 4 && ratioList.filter(x=>x.difficulty<=2).length === 2 && ratioList.filter(x=>x.difficulty===3).length === 2 && new Set(ratioList.map(x=>x.id)).size === 4, '按难度比例抽题并保留题型配额、题目不重复');
  const hardShort = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], counts: { single: 4 }, difficulty_ratios: { easy: 0, medium: 0, hard: 100 } } });
  log(hardShort.code === 0 && hardShort.data.list.length === 2 && /困难.*差 2 题/.test(hardShort.data.missing.join()), '某难度不足时不冒用其他难度，明确列出缺口');
  const invalidRatio = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, counts: { single: 1 }, difficulty_ratios: { easy: 50, medium: 50, hard: 5 } } });
  log(invalidRatio.code !== 0, '难度比例总和不为 100% 时拒绝');
  const replace = await req(`${ADM}/papers/replace`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], question_id: q.s1, exclude_ids: [q.s1] } });
  log(replace.code === 0 && replace.data.question.id === q.s2, '换题保留范围、题型、难度并排除原题');
  const noReplace = await req(`${ADM}/papers/replace`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], question_id: q.s1, exclude_ids: [q.s1, q.s2] } });
  log(noReplace.code !== 0 && /没有其他/.test(noReplace.msg), '没有其他同类题目时明确提示，避免重复');
  const perNode = await req(`${ADM}/papers/auto-by-node`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [k1, k11], per_node_count: 3 } });
  const perList = perNode.data && perNode.data.list || [];
  log(perNode.code === 0 && perList.length === 6 && new Set(perList.map(x=>x.id)).size === 6 && perList.filter(x=>x._source_node_id===k1).length === 3 && perList.filter(x=>x._source_node_id===k11).length === 3, '知识点包含后代，重叠范围各抽指定数量且不重复');
  const perShort = await req(`${ADM}/papers/auto-by-node`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [k11, k12], per_node_count: 4 } });
  log(perShort.code === 0 && perShort.data.list.length === 6 && perShort.data.missing.length === 2 && perShort.data.missing.every(m=>/差 1 题/.test(m)), '知识点题量不足时逐项显示缺口');
  db.prepare('INSERT INTO question_nodes (question_id,node_id) VALUES (?,?)').run(q.s3,k11);
  const overlap = await req(`${ADM}/papers/auto-by-node`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [k11,k12], per_node_count: 3 } });
  log(overlap.code === 0 && overlap.data.list.length === 6 && overlap.data.missing.length === 0 && new Set(overlap.data.list.map(x=>x.id)).size === 6, '共享题目按实际库存合理分配，不误报缺题');
  db.prepare('DELETE FROM question_nodes WHERE question_id=? AND node_id=?').run(q.s3,k11);
  const wrongTree = await req(`${ADM}/papers/auto-by-node`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [c1], per_node_count: 1 } });
  log(wrongTree.code !== 0, '按知识点抽题拒绝章节树节点');
  const replaceNode = await req(`${ADM}/papers/replace`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [k11,k12], node_id:k11, question_id:q.s1, exclude_ids:[q.s1] } });
  log(replaceNode.code === 0 && replaceNode.data.question.id === q.s2 && replaceNode.data.question._source_node_id === k11, '按知识点组卷后换题仍留在原知识点范围');
  const answerQ = addQ('answer', 'T5解答题', '过程', [k11]);
  const answerAuto = await req(`${ADM}/papers/auto`, { method: 'POST', token: AT, body: { subject: SUBJECT, counts: { answer: 1 } } });
  const answerByNode = await req(`${ADM}/papers/auto-by-node`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [k11], per_node_count: 4 } });
  log(answerAuto.code === 0 && answerAuto.data.list.some(x=>x.id===answerQ) && answerByNode.code===0 && answerByNode.data.list.some(x=>x.id===answerQ), '按题型和按知识点两种组卷均可抽解答题');
  db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(answerQ);
  db.prepare('DELETE FROM questions WHERE id=?').run(answerQ);

  // ---------- 2) 老师组卷 → 保存为草稿 → 下发给 s1、s2 ----------
  const saved = await req(`${ADM}/papers`, { method: 'POST', token: AT, body: { title: 'T5测试卷A', subject: SUBJECT, stage: 'junior', grade: GRADE, q_ids: autoIds, status: 'draft' } });
  const pid = saved.data && saved.data.id; if (pid) made.papers.push(pid);
  log(saved.code === 0 && pid, '保存为草稿', 'paper#' + pid);
  const draftTasks = await req(`${STU}/tasks`, { token: tok[s1.id] });
  log(draftTasks.code === 0 && !draftTasks.data.some((t) => t.id === pid), '草稿阶段学生看不到');
  const asg = await req(`${ADM}/papers/${pid}/assign`, { method: 'POST', token: AT, body: { user_ids: [s1.id, s2.id] } });
  log(asg.code === 0 && asg.data.added === 2, '下发给 2 名学生', asg.msg);
  const an = await req(`${ADM}/papers/${pid}/assignees`, { token: AT });
  log(an.code === 0 && an.data.length === 2, '下发名单 2 人');

  for (const s of [s1, s2]) {
    const t = await req(`${STU}/tasks`, { token: tok[s.id] });
    log(t.code === 0 && t.data.some((x) => x.id === pid && x.assigned && !x.tried), `${s.username}：「我的任务」看得到，且标为定向下发、未做`);
  }
  const t3 = await req(`${STU}/tasks`, { token: tok[s3.id] });
  log(t3.code === 0 && !t3.data.some((x) => x.id === pid), '同年级但没被选中的学生：「我的任务」看不到（定向下发即专属）');
  const l3 = await req(`${STU}/papers`, { token: tok[s3.id] });
  log(l3.code === 0 && !l3.data.some((x) => x.id === pid), '没被选中的学生：试卷列表也看不到');
  const g3 = await req(`${STU}/papers/${pid}`, { token: tok[s3.id] });
  log(g3.code !== 0 && /定向下发给其他同学/.test(g3.msg || ''), '没被选中的学生：直接打开试卷被拒', g3.msg);
  const sub3 = await req(`${STU}/submit`, { method: 'POST', token: tok[s3.id], body: { kind: 'paper', paper_id: pid, answers: [{ question_id: autoIds[0], my_answer: 'A' }] } });
  log(sub3.code !== 0 && /定向下发给其他同学/.test(sub3.msg || ''), '没被选中的学生：直接交卷被拒', sub3.msg);

  // 题目票据由合法取题签发，不能跨学生使用，旧客户端和伪造票据不得读取答案。
  const issued = (await req(`${STU}/papers/${pid}`, { token: tok[s1.id] })).data.questions[0];
  const checkTicket = (token, ticket) => req(`${STU}/check`, { method: 'POST', token, body: { items: [{ question_id: issued.id, quiz_ticket: ticket, my_answer: 'A' }] } });
  const allowedCheck = await checkTicket(tok[s1.id], issued.quiz_ticket);
  const deniedChecks = await Promise.all([checkTicket(tok[s3.id], issued.quiz_ticket), checkTicket(tok[s3.id], ''), checkTicket(tok[s1.id], issued.quiz_ticket + 'x')]);
  const deniedSelf = await req(`${STU}/submit`, { method: 'POST', token: tok[s3.id], body: { kind: 'self', answers: [{ question_id: issued.id, my_answer: 'A' }] } });
  const deniedAi = await req(`${STU}/ai-explain`, { method: 'POST', token: tok[s3.id], body: { question_id: issued.id, quiz_ticket: issued.quiz_ticket } });
  const deniedStream = await req(`${STU}/ai-explain/stream`, { method: 'POST', token: tok[s3.id], body: { question_id: issued.id, quiz_ticket: issued.quiz_ticket } });
  log(allowedCheck.code === 0 && deniedChecks.every((x) => x.code === 403 && !x.data && /重新打开/.test(x.msg)) && deniedSelf.code === 403 && deniedAi.code === 403 && deniedStream.code === 403, '题目票据：合法核对可用；跨学生、旧客户端、伪造及 AI 和自组卷越权被拒且不泄露答案');
  const bounded = await req(`${STU}/check`, { method: 'POST', token: tok[s1.id], body: { items: Array.from({length: 51}, () => ({ question_id: issued.id, quiz_ticket: issued.quiz_ticket, my_answer: 'A' })) } });
  log(bounded.code === 0 && bounded.data.list.length === 50, '逐题核对单次最多处理 50 题');

  // 两位被选中的学生打开并交卷（全部答 A：单选 A 对的算对）
  for (const s of [s1, s2]) {
    const g = await req(`${STU}/papers/${pid}`, { token: tok[s.id] });
    const okOpen = g.code === 0 && g.data.questions.length === 5 && g.data.questions.every((x) => x.answer === undefined);
    log(okOpen, `${s.username}：打开试卷，5 题且不泄露答案`);
    // 按库里的标准答案作答：s1 全对，s2 故意全错，用来确认判分和 paper_tries 都是各自的
    const answers = (g.data.questions || []).map((x) => ({ question_id: x.id, my_answer: s === s1 ? db.prepare('SELECT answer FROM questions WHERE id=?').get(x.id).answer : (x.type === 'judge' ? '错误' : 'Z') }));
    const sub = await req(`${STU}/submit`, { method: 'POST', token: tok[s.id], body: { kind: 'paper', paper_id: pid, answers } });
    log(sub.code === 0 && (s === s1 ? /答对 5 \/ 5/.test(sub.msg) : /答对 0 \/ 5/.test(sub.msg)), `${s.username}：交卷成功并正确判分（${s === s1 ? '全对' : '全错'}）`, sub.msg);
    const done = await req(`${STU}/tasks`, { token: tok[s.id] });
    log(done.data.some((x) => x.id === pid && x.tried), `${s.username}：「我的任务」变为已做`);
  }
  const tries = db.prepare('SELECT COUNT(*) n FROM paper_tries WHERE paper_id=?').get(pid).n;
  log(tries === 2, '成绩记录 paper_tries 有 2 条（s1、s2）', String(tries));

  // 旧客户端或直接请求可能遗漏题目；漏答不能被排除在整卷评分之外。
  const oneCorrect = { question_id: autoIds[0], my_answer: db.prepare('SELECT answer FROM questions WHERE id=?').get(autoIds[0]).answer };
  const partial = await req(`${STU}/submit`, { method: 'POST', token: tok[s1.id], body: { kind: 'paper', paper_id: pid, answers: [null, oneCorrect, oneCorrect] } });
  log(partial.code === 0 && partial.data.total === 5 && partial.data.correct === 1 && partial.data.score === 20,
    '旧卷只提交一道正确答案：漏答按错题处理，不会得到满分，重复项不计入', JSON.stringify(partial.data && { total: partial.data.total, correct: partial.data.correct, score: partial.data.score }));
  const weighted = Object.fromEntries(autoIds.map((id, i) => [id, [10, 20, 20, 20, 30][i]]));
  db.prepare('UPDATE papers SET question_scores=? WHERE id=?').run(JSON.stringify(weighted), pid);
  const partialWeighted = await req(`${STU}/submit`, { method: 'POST', token: tok[s1.id], body: { kind: 'paper', paper_id: pid, answers: [oneCorrect] } });
  log(partialWeighted.code === 0 && partialWeighted.data.total === 5 && partialWeighted.data.score === 10,
    '指定题目分值的卷子漏答时只得已答正确题的分数');
  const essayId = addQ('answer', 'T5漏答主观题', '参考过程', [k11]);
  db.prepare('UPDATE papers SET q_ids=?, question_scores=?, total_score=? WHERE id=?').run(JSON.stringify([...autoIds, essayId]), '', 60, pid);
  const partialMixed = await req(`${STU}/submit`, { method: 'POST', token: tok[s1.id], body: { kind: 'paper', paper_id: pid, answers: [oneCorrect] } });
  log(partialMixed.code === 0 && partialMixed.data.total === 5 && partialMixed.data.ungraded_count === 1 && partialMixed.data.score === null && partialMixed.data.objective_score === 10 && partialMixed.data.objective_score_total === 50,
    '漏答主观题仍待评分，客观题分数按完整题单计算');
  db.prepare('DELETE FROM subjective_responses WHERE question_id=?').run(essayId);
  db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(essayId);
  db.prepare('DELETE FROM questions WHERE id=?').run(essayId);

  // 撤回后名单清空，恢复为广播规则
  const unpub = await req(`${ADM}/papers/${pid}/publish`, { method: 'POST', token: AT, body: { publish: 0 } });
  log(unpub.code === 0 && db.prepare('SELECT COUNT(*) n FROM paper_assignments WHERE paper_id=?').get(pid).n === 0, '撤回试卷同时清空下发名单');

  // 权限
  const forbid = await req(`${ADM}/papers/${pid}/assign`, { method: 'POST', token: tok[s1.id], body: { user_ids: [s3.id] } });
  log(forbid._status === 403 || forbid.code !== 0, '学生 token 不能调管理端下发接口', `HTTP ${forbid._status}`);
  const forbid2 = await req(`${ADM}/papers/auto`, { method: 'POST', token: tok[s1.id], body: { subject: SUBJECT, counts: { single: 1 } } });
  log(forbid2._status === 403 || forbid2.code !== 0, '学生 token 不能调管理端组卷接口', `HTTP ${forbid2._status}`);

  // ---------- 3) 学生端知识点组卷（每个最小知识点 1 题）→ 自测交卷 ----------
  const tree = await req(`${STU}/scan-tree?kind=knowledge&subject=${encodeURIComponent(SUBJECT)}`, { token: tok[s3.id] });
  log(tree.code === 0 && tree.data.nodes.length === 3, '学生端知识点树可读', `节点 ${tree.data && tree.data.nodes.length}`);
  const sc = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [k1] } });
  const items = sc.data && sc.data.items || [];
  log(sc.code === 0 && items.length === 2 && items.map((x) => x.node_name).sort().join() === ['整式', '方程'].sort().join(),
    '选「代数」→ 最小知识点「整式」「方程」各 1 题，共 2 题', items.map((x) => `${x.node_name}(题目${x.question?.id})`).join('、'));
  log(items.every((x) => x.question && x.question.id && x.question.quiz_ticket && x.question.answer === undefined && x.question.point_node_id === x.node_id),
    '组卷结果带合法题目票据和目标知识点，但不泄露答案');
  // 题库库存仍为每点 3 题；学生扫描返回的是覆盖数，不再把库存数误作练习题量。
  const pointPools = await Promise.all([k11, k12].map(node => req(`${ADM}/papers/pool`, { method: 'POST', token: AT, body: { subject: SUBJECT, node_ids: [node] } })));
  log(pointPools.every(x => x.code === 0 && x.data.total === 3) && sc.data.total === 2 && sc.data.target_total === 2 && sc.data.missing.length === 0,
    '各知识点库存 3 / 3，扫描每点只选 1 题并完整覆盖 2 点', pointPools.map(x => x.data && x.data.total).join('/'));
  const sc2 = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [k12] } });
  log(sc2.code === 0 && sc2.data.items.length === 1 && sc2.data.items[0].node_name === '方程', '只选「方程」→ 1 题');
  const count = await req(`${STU}/scan-count`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [k1, k12] } });
  log(count.code === 0 && count.data.total === 2 && count.data.target_total === 2 && count.data.missing.length === 0 && count.data.fallback_count === 0,
    '题量查询按最小知识点计数，包含后代且重叠范围不重复', JSON.stringify(count.data));
  for (const legacyCount of [5, 10, 20]) {
    const fixed = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [k1, k12], count: legacyCount } });
    const list = fixed.data && fixed.data.items || [];
    log(fixed.code === 0 && list.length === 2 && fixed.data.total === 2 && fixed.data.target_total === 2 && fixed.data.missing.length === 0
      && new Set(list.map(x => x.question.id)).size === 2 && list.map(x => x.node_id).sort((a,b) => a-b).join() === [k11,k12].sort((a,b) => a-b).join(),
    `旧 count=${legacyCount} 不凑数：仍为整式、方程各 1 道不同题目`);
  }
  const emptyPoint = addNode(kn, k1, '暂无题的最小知识点');
  const shortageBody = { kind: 'knowledge', subject: SUBJECT, node_ids: [k1], count: 10 };
  const shortage = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: shortageBody });
  const shortageCount = await req(`${STU}/scan-count`, { method: 'POST', token: tok[s3.id], body: shortageBody });
  const hasExactGap = data => data && data.total === 2 && data.target_total === 3 && data.missing.length === 1
    && data.missing[0].node_id === emptyPoint && data.missing[0].node_name === '暂无题的最小知识点'
    && data.missing[0].need === 1 && data.missing[0].reason === 'empty' && data.missing[0].fallback === false;
  log(shortage.code === 0 && shortageCount.code === 0 && hasExactGap(shortage.data) && hasExactGap(shortageCount.data)
    && shortage.data.items.length === 2 && new Set(shortage.data.items.map(x => x.question.id)).size === 2,
    '缺题知识点不消失、不拿别的点凑数：计数和组卷均明确 3 点目标、2 题、1 个具体缺口');
  db.prepare('DELETE FROM bank_tree_nodes WHERE id=?').run(emptyPoint);

  const manyRoot = addNode(kn, null, '超过二十点的合成范围');
  const manyNodes = Array.from({ length: 21 }, (_, i) => addNode(kn, manyRoot, '覆盖点' + (i + 1)));
  manyNodes.forEach((node, i) => addQ('single', 'T5完整覆盖题' + (i + 1), 'A', [node]));
  for (const legacyCount of [5, 10, 20]) {
    const fullScan = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [manyRoot], count: legacyCount } });
    const list = fullScan.data && fullScan.data.items || [];
    log(fullScan.code === 0 && fullScan.data.total === 21 && fullScan.data.target_total === 21 && fullScan.data.missing.length === 0 && list.length === 21
      && new Set(list.map(x => x.question.id)).size === 21 && new Set(list.map(x => x.node_id)).size === 21 && list.every(x => manyNodes.includes(x.node_id)),
      `21 个最小知识点全部覆盖，旧 count=${legacyCount} 不截断且题目不重复`);
  }
  for (const node_ids of [[k1, 999999999], [c1]]) {
    const invalid = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids } });
    const invalidCount = await req(`${STU}/scan-count`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids } });
    log(invalid.code !== 0 && invalidCount.code !== 0, '未知或错误树类型的节点不能扩大扫描范围', node_ids.join(','));
  }
  const scEmpty = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'knowledge', subject: SUBJECT, node_ids: [] } });
  log(scEmpty.code !== 0, '没选范围：提示');
  const scCh = await req(`${STU}/scan-compose`, { method: 'POST', token: tok[s3.id], body: { kind: 'textbook', subject: SUBJECT, node_ids: [c2] } });
  log(scCh.code === 0 && scCh.data.items.length === 1 && scCh.data.items[0].node_name === '第二章', '章节组卷：选「第二章」→ 1 题（章节树）');

  // 做完自测：第一题答错、第二题答对 → 记录 2 条、错题 1 条
  const wrongQ = items[0].question, rightQ = items[1].question;
  const full = (id) => db.prepare('SELECT answer, type FROM questions WHERE id=?').get(id);
  const ans = [
    { question_id: wrongQ.id, quiz_ticket: wrongQ.quiz_ticket, my_answer: full(wrongQ.id).type === 'judge' ? '错误' : 'Z' },
    { question_id: rightQ.id, quiz_ticket: rightQ.quiz_ticket, my_answer: full(rightQ.id).answer },
  ];
  const selfSub = await req(`${STU}/submit`, { method: 'POST', token: tok[s3.id], body: { kind: 'self', answers: ans } });
  log(selfSub.code === 0, '知识点组卷做完交卷', selfSub.msg);
  const rec = db.prepare('SELECT COUNT(*) n, SUM(is_correct) c FROM records WHERE user_id=?').get(s3.id);
  log(Number(rec.n) === 2 && Number(rec.c) === 1, '成绩记录：2 题 1 对', `n=${rec.n} 对=${rec.c}`);
  const mis = db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND question_id=?').get(s3.id, wrongQ.id).n;
  log(Number(mis) === 1, '答错的题进入错题本', String(mis));
  db.prepare("UPDATE mistakes SET next_review='' WHERE user_id=? AND question_id=?").run(s3.id, wrongQ.id);
  const mistakeList = await req(`${STU}/mistakes`, { token: tok[s3.id] });
  const mistake = mistakeList.data.list.find((m) => m.question_id === wrongQ.id);
  const review = await req(`${STU}/review-queue`, { token: tok[s3.id] });
  const reviewQ = review.data.list.find((q) => q.id === wrongQ.id);
  const similar = await req(`${STU}/mistakes/${wrongQ.id}/similar`, { token: tok[s3.id] });
  const similarQ = similar.data && similar.data.list && similar.data.list[0];
  const checkedSources = await Promise.all([mistake && { id: mistake.question_id, quiz_ticket: mistake.quiz_ticket }, reviewQ, similarQ].filter(Boolean).map((q) => req(`${STU}/check`, { method: 'POST', token: tok[s3.id], body: { items: [{ question_id: q.id, quiz_ticket: q.quiz_ticket, my_answer: 'Z' }] } })));
  log(checkedSources.length === 3 && checkedSources.every((x) => x.code === 0), '错题重练、复习队列和同类题的票据可用于核对', JSON.stringify({mistake: !!mistake, review: !!reviewQ, similar: similar.msg, n: checkedSources.length, codes: checkedSources.map((x) => x.code)}));

  cleanup();
  const left = db.prepare('SELECT COUNT(*) n FROM questions WHERE subject=?').get(SUBJECT).n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 't5s%'").get().n;
  log(left === 0, '测试数据已清理');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
