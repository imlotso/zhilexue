'use strict';
/**
 * 试卷管理（T10）自测： node paper-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；直连同一个 MySQL 造学生，结束后清理。
 * 覆盖：
 *   1) 后台上传真题试卷（Word）：先识别预览（不写库）→ 确认生成试卷；先进入待审核，按文档原顺序分段、默认分值合计 100
 *   2) 学生端试卷库搜索：名称 / 年份 / 学科 / 年级，未发布的搜不到；下拉选项
 *   3) 学生搜到后完整做完：打开试卷（不泄露答案）、交卷判分、成绩落库、试卷库显示"上次 N 分"
 *   4) 后台列表筛选、年份校验、权限、错误文件
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
const SB = '/api/stu/bank';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const j = await res.json(); j._status = res.status; return j;
}
const SAMPLE = fs.readFileSync(path.join(__dirname, 'docs', '原始需求', '洋葱题库-样例.docx'));
const uniq = Date.now().toString().slice(-8);
const TITLE = 'T10测试 2024南京中考数学真题 ' + uniq;
const made = { users: [], papers: [], qids: [], runs: [] };
const importForm = (o) => {
  const fd = new FormData();
  fd.append('file', new Blob([o.file || SAMPLE]), o.name || '洋葱题库-样例.docx');
  Object.entries(o.fields || {}).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
};
function cleanup() {
  made.runs.forEach((id) => db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id));
  const ps = db.prepare("SELECT id FROM mf_papers WHERE title LIKE 'T10测试%'").all().map((r) => r.id);
  ps.forEach((id) => { db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(id); });
  made.qids.forEach((id) => { ['question_tags', 'question_nodes', 'mistakes', 'records'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM questions WHERE id=?').run(id); });
  made.users.forEach((id) => {
    ['mistakes', 'records', 'practices', 'mf_paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  });
}

(async () => {
  console.log('\n=== 试卷管理（T10）· 自测 ===\n');
  cleanup();
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const sid = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'T10学生','九年级','上册',1,1,'2099-12-31',1,'2026-11-02')")
    .run('t10s' + uniq, hash('123456')).lastInsertRowid; made.users.push(sid);
  const ST = await login('t10s' + uniq, 'student');
  log(!!AT && !!ST, '管理员和测试学生登录');

  const nQ0 = db.prepare("SELECT COUNT(*) n FROM questions WHERE source='真题试卷'").get().n;
  const nP0 = db.prepare("SELECT COUNT(*) n FROM mf_papers WHERE title LIKE 'T10测试%'").get().n;

  // ---------- 1) 后台上传真题试卷 ----------
  const meta = { title: TITLE, subject: '数学', stage: 'junior', grade: '九年级', year: '2024', edition:'苏科版', term:'上册', exam_category: 'entrance', publish: 1 };
  const dry = await req(MF + '/papers/import-word', { method: 'POST', token: AT, form: importForm({ fields: { ...meta, dry_run: 1 } }) });
  log(dry.code === 0 && dry.data.total === 10 && dry.data.error_count === 0, '识别预览（dry_run）：客户洋葱样例 10 题、0 个不合规', dry.msg);
  log(dry.data.sample.length === 3 && dry.data.sample.every(q => q.stem), '导入预览展示实际题干样例');
  const expectedSections = [{ name: '一、单选题', count: 3 }, { name: '二、填空题', count: 1 }, { name: '三、单选题', count: 1 }, { name: '四、判断题', count: 1 }, { name: '五、填空题', count: 1 }, { name: '六、判断题', count: 1 }, { name: '七、单选题', count: 2 }];
  log(JSON.stringify(dry.data.sections) === JSON.stringify(expectedSections), '预览按文档题目原顺序分段，不将交错题型重新排序', JSON.stringify(dry.data.sections));
  log(Number(db.prepare("SELECT COUNT(*) n FROM mf_papers WHERE title LIKE 'T10测试%'").get().n) === Number(nP0) && Number(db.prepare("SELECT COUNT(*) n FROM questions WHERE source='真题试卷'").get().n) === Number(nQ0), '预览不写库：没有新试卷、没有新题目');

  const imp = await req(MF + '/papers/import-word', { method: 'POST', token: AT, form: importForm({ fields: meta }) });
  const pid = imp.data && imp.data.paper_id; if (pid) made.papers.push(pid); if (imp.data && imp.data.run_id) made.runs.push(imp.data.run_id);
  log(imp.code === 0 && pid && imp.data.total === 10 && imp.data.published === 0, '确认后生成试卷草稿：10 题进入待审核', imp.msg);
  const blocked = await req(MF + '/papers/' + pid, { method:'PUT', token:AT, body:{published:1} });
  log(blocked.code !== 0, '题目尚未审核时不能发布');
  const reviewPaper = async (result) => {
    const list = await req(MF + '/ext/pending?source=paper&size=100', { token: AT });
    const ids = list.data.list.filter(x => x.batch_id === result.data.run_id).map(x => x.id);
    const reviewed = await req(MF + '/ext/pending/commit', { method:'POST', token:AT, body:{ids,subject:'数学',stage:'junior'} });
    if (reviewed.code !== 0 || reviewed.data.failed.length) throw new Error('试卷审核失败：' + reviewed.msg);
    result.data.question_ids = reviewed.data.question_ids;
    made.qids.push(...reviewed.data.question_ids);
    return reviewed;
  };
  await reviewPaper(imp);
  await req(MF + '/papers/' + pid, { method:'PUT', token:AT, body:{status:'done',published:1} });
  const paper = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(pid);
  log(paper && paper.title === TITLE && paper.year === '2024' && paper.subject === '数学' && paper.grade === '九年级' && paper.status === 'done' && Number(paper.published) === 1, '试卷：卷名 / 年份 / 学科 / 年级 / 状态=已定稿 / 已发布', paper && `${paper.year} ${paper.grade} ${paper.status}`);
  log(paper.edition === '苏科版' && paper.term === '上册', '试卷保留导入时选择的教材版本和册别');
  const rows = db.prepare('SELECT * FROM mf_paper_questions WHERE paper_id=? ORDER BY position, id').all(pid);
  const texts = rows.filter((r) => r.kind === 'text').map((r) => r.text_body);
  log(rows.length === 17 && texts.join() === expectedSections.map((s) => s.name).join(), '试卷行：连续题型各自有标题，共 7 个标题和 10 道题', texts.join());
  const originalNos = rows.filter((r) => r.kind === 'question').map((r) => JSON.parse(db.prepare('SELECT source_detail FROM questions WHERE id=?').get(r.question_id).source_detail).qno);
  log(rows[0].kind === 'text' && rows[4].kind === 'text' && rows[5].kind === 'question' && originalNos.join() === '1,2,3,4,5,6,7,8,9,10', '标题在各自题目前且题目保持 Word 原序', originalNos.join());
  const scoreSum = rows.filter((r) => r.kind === 'question').reduce((s, r) => s + Number(r.score), 0);
  log(Math.abs(scoreSum - 100) < 0.01, '每题默认分值 = 100 ÷ 题数，合计 100 分', String(scoreSum));
  const bankQ = db.prepare("SELECT * FROM questions WHERE source='真题试卷' AND year='2024'").all().filter((q) => made.qids.includes(q.id));
  log(bankQ.length === 10 && bankQ.every((q) => q.subject === '数学' && q.grade === '九年级' && q.stage === 'junior'), '10 道题同时入了题库：来源=真题试卷，学科 / 年级 / 年份随卷', String(bankQ.length));
  const lst = await req(MF + '/questions?size=100&source_type=recog&kw=' + encodeURIComponent((bankQ[0].stem || '').slice(0, 6)), { token: AT });
  log(lst.code === 0 && (lst.data.list || []).some((q) => q.id === bankQ[0].id), '题库管理里能查到这些题');
  const d1 = await req(MF + '/papers/' + pid, { token: AT });
  log(d1.code === 0 && d1.data.paper.year === '2024' && d1.data.rows.filter((r) => r.question).length === 10, '试卷详情接口：带年份、10 道题完整');

  // 未发布的：生成但不发布
  const imp2 = await req(MF + '/papers/import-word', { method: 'POST', token: AT, form: importForm({ fields: { ...meta, title: 'T10测试 未发布 ' + uniq, year: '2023', publish: 0 } }) });
  const pid2 = imp2.data && imp2.data.paper_id; if (pid2) made.papers.push(pid2); if (imp2.data && imp2.data.run_id) made.runs.push(imp2.data.run_id);
  await reviewPaper(imp2);
  log(imp2.code === 0 && imp2.data.published === 0, '另一份选「先不发布」：生成但不发布');

  // ---------- 2) 学生端搜索 ----------
  const find = async (qs) => (await req(SB + '/mfpapers' + (qs ? '?' + qs : ''), { token: ST })).data || [];
  const has = (list, id) => list.some((x) => x.id === id);
  log(has(await find(''), pid) && !has(await find(''), pid2), '不带条件：能看到已发布的，看不到未发布的');
  log(has(await find('q=' + encodeURIComponent('南京')), pid), '按名称搜「南京」：搜到');
  log(has(await find('q=' + encodeURIComponent('中考数学')), pid), '按名称搜「中考数学」：搜到');
  log(has(await find('q=2024'), pid), '搜年份「2024」：搜到（即使名称里没有，年份也匹配）');
  log(!has(await find('q=' + encodeURIComponent('不存在的关键字xyz')), pid), '搜不存在的关键字：没有');
  log(has(await find('subject=' + encodeURIComponent('数学')), pid) && !has(await find('subject=' + encodeURIComponent('英语')), pid), '按学科筛：数学有、英语没有');
  log(has(await find('grade=' + encodeURIComponent('九年级')), pid) && !has(await find('grade=' + encodeURIComponent('八年级')), pid), '按年级筛：九年级有、八年级没有');
  log(has(await find('year=2024'), pid) && !has(await find('year=2023'), pid), '按年份筛：2024 有、2023 没有');
  log(has(await find('exam_category=entrance'), pid) && !has(await find('exam_category=unit'), pid), '按试卷类型筛选');
  const card = (await find('exam_category=entrance')).find((x) => x.id === pid);
  log(card && card.exam_category === 'entrance' && Number(card.total_score) === 100 && card.q_count === 10, '试卷卡片返回分类、题量和满分');
  const combo = await find('q=' + encodeURIComponent('南京') + '&grade=' + encodeURIComponent('九年级') + '&year=2024&subject=' + encodeURIComponent('数学'));
  log(has(combo, pid), '多个条件组合：搜到');
  const inj = await req(SB + '/mfpapers?q=' + encodeURIComponent("' OR 1=1 -- "), { token: ST });
  log(inj.code === 0 && !has(inj.data, pid), '关键字里带 SQL 符号不会被当成条件（参数化查询）');
  const fl = await req(SB + '/mfpapers/filters', { token: ST });
  log(fl.code === 0 && fl.data.years.includes('2024') && !fl.data.years.includes('2023') && fl.data.grades.includes('九年级') && fl.data.subjects.includes('数学'), '搜索下拉选项：只含已发布试卷里有的年份 / 年级 / 学科', JSON.stringify(fl.data).slice(0, 80));
  log(fl.data.exam_categories.includes('entrance'), '试卷库筛选项包含已发布的试卷类型');
  // 后台发布第二份 → 学生马上搜得到
  const pub = await req(MF + '/papers/' + pid2, { method: 'PUT', token: AT, body: { published: 1 } });
  log(pub.code === 0 && has(await find('year=2023'), pid2), '后台「发布」后学生端立即搜得到');
  await req(MF + '/papers/' + pid2, { method: 'PUT', token: AT, body: { published: 0 } });
  log(!has(await find('year=2023'), pid2), '取消发布后搜不到了');

  // ---------- 3) 学生完整做完 ----------
  const open = await req(SB + '/mfpapers/' + pid, { token: ST });
  const qs = open.data && open.data.questions || [];
  log(open.code === 0 && qs.length === 10 && qs.every((q) => q.answer === undefined && q.analysis === undefined) && open.data.total_score === 100 && open.data.year === '2024', '打开试卷：10 题完整、不泄露答案、满分 100、带年份');
  const ticketCheck = await req(SB + '/check', { method: 'POST', token: ST, body: { items: [{ question_id: qs[0].id, quiz_ticket: qs[0].quiz_ticket, my_answer: 'A' }] } });
  log(ticketCheck.code === 0, '真题卷返回的票据可用于核对');
  const ans = (qid) => db.prepare('SELECT answer FROM questions WHERE id=?').get(qid).answer;
  const allRight = qs.map((q) => ({ question_id: q.id, my_answer: ans(q.id) }));
  const sub1 = await req(SB + '/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: allRight } });
  log(sub1.code === 0 && sub1.data.total === 10 && sub1.data.correct === 10 && sub1.data.score === 100 && sub1.data.score_total === 100, '全部答对：10 / 10，得分 100 / 100', sub1.msg);
  const half = qs.map((q, i) => ({ question_id: q.id, my_answer: i < 5 ? ans(q.id) : (q.type === 'judge' ? '对错不是' : 'Z') }));
  const sub2 = await req(SB + '/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: half } });
  log(sub2.code === 0 && sub2.data.correct === 5 && sub2.data.score === 50, '再做一遍答对一半：5 / 10，得分 50', `correct=${sub2.data.correct} score=${sub2.data.score}`);
  const tries = db.prepare('SELECT correct, score FROM mf_paper_tries WHERE user_id=? AND paper_id=? ORDER BY id').all(sid, pid);
  log(tries.length === 2 && Number(tries[0].score) === 100 && Number(tries[1].score) === 50, '两次成绩都落库（mf_paper_tries）', JSON.stringify(tries));
  const after = await find('q=2024');
  const me = after.find((x) => x.id === pid);
  log(me && me.tried && me.last.score === 50, '试卷库里这份试卷显示做过、上次 50 分');
  log(Number(db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=?').get(sid).n) === 5, '答错的 5 道题进了错题本');
  const omitted = await req(SB + '/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: [allRight[0]] } });
  log(omitted.code === 0 && omitted.data.total === 10 && omitted.data.correct === 1 && omitted.data.score === 10,
    '真题卷只提交一题时，其余题按未作答计入，不会缩小总题数');
  const notPub = await req(SB + '/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid2, answers: allRight } });
  log(notPub.code !== 0 && /未发布/.test(notPub.msg || ''), '未发布的试卷不能交卷', notPub.msg);
  const archived = await req(MF + '/papers/' + pid, { method:'PUT', token:AT, body:{status:'archived'} });
  log(archived.code === 0 && Number(db.prepare('SELECT published FROM mf_papers WHERE id=?').get(pid).published) === 0 && !has(await find(''), pid), '归档后自动取消发布并从学生列表移除');
  db.prepare("UPDATE mf_papers SET published=1 WHERE id=?").run(pid); // 旧数据可能留下已归档但仍有发布标记
  const arOpen = await req(SB + '/mfpapers/' + pid, { token: ST });
  const arSubmit = await req(SB + '/submit', { method:'POST', token:ST, body:{kind:'mfpaper',paper_id:pid,answers:allRight} });
  log(!has(await find(''), pid) && arOpen.code !== 0 && arSubmit.code !== 0, '旧归档数据即使保留发布标记，也不能查看或交卷');
  await req(MF + '/papers/' + pid, { method:'PUT', token:AT, body:{published:1} });
  log(has(await find(''), pid), '重新发布归档试卷会恢复到已发布状态');

  // ---------- 4) 后台筛选 / 校验 / 权限 ----------
  const al = async (qs2) => ((await req(MF + '/papers' + (qs2 ? '?' + qs2 : ''), { token: AT })).data || {}).list || [];
  log(has(await al('year=2024'), pid) && !has(await al('year=2024'), pid2), '后台列表按年份筛');
  log(has(await al('subject=' + encodeURIComponent('数学') + '&grade=' + encodeURIComponent('九年级')), pid), '后台列表按学科 + 年级筛');
  log(has(await al('published=1'), pid) && !has(await al('published=1'), pid2) && has(await al('published=0'), pid2), '后台列表按发布状态筛');
  const mkP = await req(MF + '/papers', { method: 'POST', token: AT, body: { title: 'T10测试 手工 ' + uniq, subject: '数学', year: '20xx' } });
  if (mkP.data && mkP.data.id) made.papers.push(mkP.data.id);
  log(mkP.code === 0 && db.prepare('SELECT year FROM mf_papers WHERE id=?').get(mkP.data.id).year === '', '手工新建试卷：年份不是 4 位数字会被忽略');
  const upY = await req(MF + '/papers/' + mkP.data.id, { method: 'PUT', token: AT, body: { year: '2022' } });
  log(upY.code === 0 && db.prepare('SELECT year FROM mf_papers WHERE id=?').get(mkP.data.id).year === '2022', '编辑试卷：改年份');
  const stuImp = await req(MF + '/papers/import-word', { method: 'POST', token: ST, form: importForm({ fields: meta }) });
  log(stuImp._status === 403 || stuImp.code !== 0, '学生 token 不能上传试卷');
  const txt = await req(MF + '/papers/import-word', { method: 'POST', token: AT, form: importForm({ file: Buffer.from('随便一段文字'), name: '试卷.txt', fields: meta }) });
  log(txt.code !== 0 && /只支持 \.docx/.test(txt.msg), '不是 .docx：明确提示', txt.msg);
  const noFile = await req(MF + '/papers/import-word', { method: 'POST', token: AT, form: new FormData() });
  log(noFile.code !== 0 && /请选择/.test(noFile.msg), '没选文件：提示', noFile.msg);
  const delP = await req(MF + '/papers/' + pid2, { method: 'DELETE', token: AT });
  log(delP.code === 0 && db.prepare("SELECT COUNT(*) n FROM questions WHERE id IN (" + (imp2.data.question_ids || [0]).join(',') + ")").get().n === 10, '删除试卷不会删掉题库里的题');

  cleanup();
  const left = db.prepare("SELECT COUNT(*) n FROM mf_papers WHERE title LIKE 'T10测试%'").get().n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 't10s%'").get().n;
  log(Number(left) === 0 && Number(db.prepare("SELECT COUNT(*) n FROM questions WHERE source='真题试卷'").get().n) === Number(nQ0), '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
