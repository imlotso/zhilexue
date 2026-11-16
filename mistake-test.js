'use strict';
/**
 * 错题本改版 + Word 导出（T9）自测： node mistake-test.js
 * 无服务 / 无数据库：node mistake-test.js --ui-only（真实 bank.js DOM、样式和导出入口）。
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；直连同一个 MySQL 造专用学生 / 题目 / 错题，结束后清理。
 * 覆盖：
 *   1) 用客户《马英惠-数学…错题集.pdf》对应的 10 道题生成 Word：封面、错题练习、错题解析、答案 / 解析 / 答题记录、"多次答错"、页码、公式原样、图片内嵌
 *   2) 文件有效：zip 结构、XML 合法；本机有 python-docx / LibreOffice 时再用它们真正打开并转 PDF（CI 上没有就跳过）
 *   3) 筛选（科目 / 已掌握 / 日期 / 指定题）、只导出本人的错题、没有错题时给提示
 *   4) 后台导出接口：权限、分校越权
 *   5) 手机扫码上传 → AI 识别（复用错题重组的 analyze，用本机模拟 AI 服务）→ 自动分类 → 进「待审核题目」，来源标"手机扫码（错题）"
 *   6) 前端页面里不再有"收藏"入口
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const UI_ONLY = process.argv.includes('--ui-only');
let JSZip, db, hash;

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };

async function checkMistakeUi() {
  const { JSDOM } = require('jsdom');
  const vm = require('vm');
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const dom = new JSDOM(read('public/index.html'), { url: 'http://ui.invalid/#/mistakes', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document, host = d.getElementById('app');
  const unexpected = [], errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  host.className = 'rounded-student';
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 12:00:00`;
  const question = { type: 'single', stem: '合成错题', options: ['甲', '乙'], answer: 'A', last_answer: 'B', analysis: '合成解析', images: [], point: '因式分解', source: '练习错题', wrong_count: 1, review_stage: 0, updated_at: today };
  const data = { list: [{ ...question, question_id: 1, subject: '数学', resolved: 0 },
    { ...question, question_id: 2, subject: '数学', resolved: 1 },
    { ...question, question_id: 3, subject: '英语', resolved: 0 }], counts: { '数学': 1, '英语': 1 }, review: { due: 0 } };
  // Load the actual linked styles and execute the complete scripts. Only HTTP is synthetic.
  w.fetch = async url => {
    if (url !== '/api/stu/bank/mistakes') { unexpected.push(url); throw new Error('Unexpected UI request: ' + url); }
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  };
  try {
    for (const link of d.querySelectorAll('link[rel="stylesheet"]')) {
      const style = d.createElement('style');
      style.textContent = read('public/' + link.getAttribute('href').split('?')[0]);
      link.replaceWith(style);
    }
    for (const file of ['public/js/api.js', 'public/js/bank.js']) vm.runInContext(read(file), dom.getInternalVMContext(), { filename: file });
    await w.BankPages.mistakes(host);
    const tabs = [...host.querySelectorAll('#roundMistTabs [data-s]')];
    log(tabs.map(el => el.dataset.s).join('/') === '英语/数学/物理/化学' && host.querySelector('.bk2-tabs .on').dataset.s === '英语', '真实错题页：四科学科入口保留，优先显示有未掌握题目的英语');
    host.querySelector('[data-s="数学"]').click();
    const root = host.querySelector('.t9-root.round-mist-root');
    log(!!root && root.querySelector('h1').textContent === '错题本' && root.querySelectorAll('.bk-mist').length === 2 && host.querySelector('.bk2-tabs .on').dataset.s === '数学', '真实错题页：切换数学后显示圆角 T9 页面和该科两道题');
    const rootStyle = w.getComputedStyle(root), layoutStyle = w.getComputedStyle(root.querySelector('.round-mist-layout'));
    const buckets = [...root.querySelectorAll('.t9-bucket')];
    const bucketStyle = w.getComputedStyle(buckets[0]);
    log(rootStyle.display === 'flex' && layoutStyle.display === 'grid' && w.getComputedStyle(root.querySelector('.t9-buckets')).display === 'grid'
      && bucketStyle.borderRadius === '18px' && bucketStyle.minHeight === '87px', '真实错题页：T9 基础布局与圆角时间强化样式生效');
    log(buckets.length === 3 && buckets.map(el => el.querySelector('em').textContent).join('/') === '1/0/0'
      && !buckets[0].disabled && buckets[1].disabled && buckets[2].disabled, '时间强化只计算未掌握题目，空时间段按钮禁用');
    log(!root.querySelector('#bkFav,[data-go="favorites"],[href="#/favorites"]') && !/收藏/.test(root.textContent), '真实错题页没有收藏入口');
    root.querySelector('#bkDocx').click();
    const dialog = d.querySelector('.t9-dlg');
    log(!!dialog && w.getComputedStyle(dialog).borderRadius === '20px' && dialog.querySelector('input[name=t9r]:checked').value === 'unresolved'
      && dialog.querySelector('#t9xGo').textContent === '下载 Word（1 题）', '导出入口打开有样式的 T9 弹窗，默认只导出 1 道未掌握题');
    const all = dialog.querySelector('input[name=t9r][value=all]');
    all.checked = true; all.dispatchEvent(new w.Event('change', { bubbles: true }));
    log(dialog.querySelector('#t9xGo').textContent === '下载 Word（2 题）'
      && [...dialog.querySelectorAll('input[name="r9-print"]')].map(el => el.value).join('/') === '0/1'
      && dialog.querySelector('input[name="r9-print"]:checked').value === '1', '导出范围切换包含已掌握题，保留仅题目 / 题目与解析选项');
    dialog.querySelector('#t9xCancel').click();
    log(!d.querySelector('.t9-dlg'), '取消导出关闭弹窗');
    host.querySelector('[data-s="物理"]').click();
    log(!!host.querySelector('.round-mist-empty') && !host.querySelector('.bk-mist') && [...host.querySelectorAll('.t9-bucket')].every(el => el.disabled), '无错题学科显示空状态，不能误用上一学科的题目');
    log(errors.length === 0 && unexpected.length === 0, '真实错题页没有脚本错误或未约定的接口请求', errors.concat(unexpected).join(' | '));
  } finally { w.close(); }
}
async function req(p, { method = 'GET', body, token, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  return res.json();
}
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCrRRRXMe2FFFFABRRRQAUUUUAFFFFABRRRQB//2Q==', 'base64');
const TAG = 'T9测试';
const uniq = Date.now().toString().slice(-8);
const now = '2026-11-02 00:00:00';
const o = (a) => JSON.stringify(a.map((t, i) => ({ label: 'ABCD'[i], text: t })));
const made = { users: [], files: [], profiles: [] };

// 客户样本里的 10 道题（题干 / 选项 / 知识点 / 答案 / 解析 / 答题记录取自 PDF，公式用 LaTeX 文本）
const SAMPLE = [
  { type: 'single', stem: '多项式 $-ab(a-b)^2+a(b-a)^2-ac(a-b)^2$ 分解因式时，所提取的公因式应是 ____ .', opts: ['$-a(a-b)^2$', '$ab(a-b)^2$', '$-(a-b)^2$', '$(a-b)^2$'], point: '公因式', ans: 'A', ana: '$-ab(a-b)^2+a(b-a)^2-ac(a-b)^2=-a(a-b)^2(b-1+c)$，\n故公因式为：$-a(a-b)^2$.\n故选A.', wc: 1, recs: [['C', 0, '2026-10-28 11:24']] },
  { type: 'single', stem: '下列从左边到右边的变形,是因式分解的是 ____ .', opts: ['$12a^2b = 3a \\cdot 4ab$', '$(x+3)(x-3)=x^2-9$', '$4x^2+8x-1=4x(x+2)-1$', '$x^2+3x-4=(x-1)(x+4)$'], point: '因式分解的概念', ans: 'D', ana: 'A.左边是单项式,不是因式分解,故选项A错误;\nB.是整式乘法,故选项B错误;\nC.右边不是整式积的形式,故选项C错误;\nD.是因式分解,故选项D正确.', wc: 5, recs: [['C', 0, '2026-10-28 11:26'], ['C', 0, '2026-10-26 11:50'], ['C', 0, '2026-10-24 10:45'], ['B', 0, '2026-10-21 15:34'], ['C', 0, '2026-10-21 14:08']] },
  { type: 'fill', stem: '把下列各多项式因式分解:\n(1)$4a^2+12ab+9b^2$ = ________ ;\n(2)$9(p-q)^2-6(p-q)+1$ = ________ .', point: '因式分解-完全平方公式法', ans: '$(2a+3b)^2$|$(3p-3q-1)^2$', ana: '(1)$4a^2+12ab+9b^2=(2a)^2+2\\cdot 2a\\cdot 3b+(3b)^2=(2a+3b)^2$.\n(2)$9(p-q)^2-6(p-q)+1=[3(p-q)-1]^2=(3p-3q-1)^2$.', wc: 2, recs: [['8|2', 0, '2026-10-28 11:24'], ['88|1', 0, '2026-10-22 11:31']] },
  { type: 'fill', stem: '分解因式:$-(a^2+2)^2+6(a^2+2)-9$ = ________ .(因式按字母在前填写)', point: '因式分解-方法选择', ans: '$-(a+1)^2(a-1)^2$', ana: '$-(a^2+2)^2+6(a^2+2)-9=-[(a^2+2)-3]^2=-(a+1)^2(a-1)^2$.', wc: 1, recs: [['88', 0, '2026-10-28 11:30']] },
  { type: 'fill', stem: '下列各式从等号左边到右边的变形中,不是因式分解的有 ________ 个.\n(1)$(a+b)(a-b)=a^2-b^2$;\n(2)$3x^3-6x^2-3x=3x(x^2-2x-1)$;\n(3)$m^3-m^2+m=m(m^2-m)$;\n(4)$x^2+2x-3=x(x+2)-3$.', point: '因式分解的概念', ans: '3', ana: '(1)是整式乘法运算;\n(2)符合因式分解的概念;\n(3)经计算式子不成立;\n(4)等式右边不是整式的积的形式.', wc: 5, recs: [['8', 0, '2026-10-28 11:24'], ['99', 0, '2026-10-25 17:09']] },
  { type: 'fill', stem: '因式分解 :\n(1)$(a^2+9b^2)^2-36a^2b^2$ = ________ ;\n(2)$(c^2-b^2+d^2-a^2)^2-4(ab-cd)^2$ = ________ .', point: '因式分解-方法选择', ans: '$(a+3b)^2(a-3b)^2$|$(a+b+c+d)(a+b-c-d)(a-b+c-d)(a-b-c+d)$', ana: '(1)$(a^2+9b^2)^2-36a^2b^2=(a+3b)^2(a-3b)^2$\n(2)$\\because a>b>c>d>0,\\therefore$ 原式 $=(a+b+c+d)(a+b-c-d)(a-b+c-d)(a-b-c+d)$.', wc: 1, recs: [['99', 0, '2026-10-28 11:30']] },
  { type: 'single', stem: '$a^2b-4ab+4b$ 因式分解为 ____.', opts: ['$b(a-2)^2$', '$b(2a-2)^2$', '$b(2a-1)^2$', '$b(a+2)^2$'], point: '因式分解-方法选择', ans: 'A', ana: '$a^2b-4ab+4b=b(a^2-4a+4)=b(a-2)^2$.\n故选：A.', wc: 1, recs: [['C', 0, '2026-10-28 11:30']] },
  { type: 'single', stem: '若多项式 $x^2-mxy+9y^2$ 能运用完全平方公式因式分解,则 m 的值是 ____.', opts: ['3', '6', '± 3', '± 6'], point: '完全平方式', ans: 'D', ana: '∵ $x^2-mxy+9y^2$ 能运用完全平方公式因式分解,\n∴ m = ± 6.', wc: 1, recs: [['C', 0, '2026-10-28 11:24']] },
  { type: 'fill', stem: '观察下列从左到右的变形:\n(1)$x^2+2x+1=(x+1)(x+1)$\n(2)$x^3+3x^2-9x+5=(x+5)(1-2x+x^2)$\n(3)$a^2b+2ab+4b=b[(a+1)^2+3]$\n(4)$a^3+b^3+c^3-3abc=(a+b+c)(a^2+b^2+c^2-ab-bc-ca)$\n(5)$x^3-x^2=x(x^2-x)$\n其中是正确的因式分解的有 ________ 个.', point: '因式分解的概念', ans: '1', ana: '正确的因式分解有:(4).\n(1)没有把相同的因式写成幂的形式.\n(2)因式没有降幂排列.\n(3)结果中还有中括号.\n(5)提取公因式不彻底.', wc: 2, recs: [['88', 0, '2026-10-28 11:27']] },
  { type: 'single', stem: '下列各式从等号左边到右边的变形是因式分解的是 ____ .', opts: ['$(3-x)(3+x)=9-x^2$', '$(y+1)(y-3)=-(3-y)(y+1)$', '$4yz-2y^2z+z=2y(2z-yz)+z$', '$-8x^2+8x-2=-2(2x-1)^2$'], point: '因式分解的概念', ans: 'D', ana: 'D.是因式分解,故选项D正确.', wc: 2, recs: [['A', 0, '2026-10-28 11:20']] },
];

function addStudent(tag, grade) {
  const id = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,'上册',1,1,'2099-12-31',1,?)")
    .run('t9s' + uniq + tag, hash('123456'), tag === 'a' ? '马英惠' : 'T9别的学生', grade, now).lastInsertRowid;
  made.users.push(id); return { id, username: 't9s' + uniq + tag };
}
function addQuestion(uid, q, subject, point, resolved, updated) {
  const qid = db.prepare("INSERT INTO questions (subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,images,created_at) VALUES (?,'八年级','junior',?,?,?,?,?,3,?,?,?)")
    .run(subject || '数学', q.type, TAG + q.stem, q.opts ? o(q.opts) : '[]', q.ans, q.ana, point || q.point, q.images ? JSON.stringify(q.images) : '[]', now).lastInsertRowid;
  db.prepare("INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review) VALUES (?,?,?,?,?,?,0,'')")
    .run(uid, qid, q.wc || 1, (q.recs && q.recs[0] && q.recs[0][0]) || '', resolved ? 1 : 0, updated || (q.recs && q.recs[0] && q.recs[0][2] + ':00') || now);
  (q.recs || []).forEach((r, i) => db.prepare('INSERT INTO records (user_id,question_id,chapter_id,my_answer,is_correct,created_at) VALUES (?,?,0,?,?,?)').run(uid, qid, r[0], r[1], r[2] + ':00'));
  return qid;
}
function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%' OR source='学生上传' AND stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['mistakes', 'records'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id));
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  made.users.forEach((id) => {
    db.prepare('SELECT question_id FROM paper_uploads WHERE user_id=? AND question_id>0').all(id).forEach((r) => {
      ['mistakes', 'records'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(r.question_id));
      db.prepare('DELETE FROM questions WHERE id=?').run(r.question_id);
    });
    ['paper_uploads', 'mistakes', 'records'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  });
  made.profiles.forEach((id) => db.prepare('DELETE FROM mf_model_profiles WHERE id=?').run(id));
  made.files.forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } });
}
const xmlText = (xml) => xml.replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

(async () => {
  console.log('\n=== 错题本改版 + Word 导出（T9）· 自测 ===\n');
  if (UI_ONLY) {
    await checkMistakeUi();
    console.log('  ⏭  --ui-only 不验证数据库、AI 识别、下载接口或浏览器布局');
    console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
    return;
  }
  JSZip = require('jszip');
  delete process.env.AI_MOCK;   // 第 5 项要让 AI 调用真的发到本机模拟服务
  ({ db } = require('./src/db'));
  ({ hash } = require('./src/auth'));
  const A = addStudent('a', '八年级'), B = addStudent('b', '八年级');
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('zlx-ci-admin', 'admin'), TA = await login(A.username, 'student'), TB = await login(B.username, 'student');

  // 图片：手机扫码上传的纸质错题——JPEG 文件放在 public/pu 下（和真实上传一致）
  const puDir = path.join(__dirname, 'public', 'pu'); fs.mkdirSync(puDir, { recursive: true });
  const jpgName = 't9test' + uniq + '.jpg'; fs.writeFileSync(path.join(puDir, jpgName), JPG); made.files.push(path.join(puDir, jpgName));
  SAMPLE[1].images = ['/pu/' + jpgName];
  const qids = SAMPLE.map((q) => addQuestion(A.id, q));
  addQuestion(A.id, { type: 'single', stem: '已掌握的题', opts: ['甲', '乙'], ans: 'A', ana: '略', wc: 1, recs: [['A', 1, '2026-10-20 10:00']] }, '数学', '已掌握点', true, '2026-10-20 10:00:00');
  addQuestion(A.id, { type: 'single', stem: '英语题 English', opts: ['yes', 'no'], ans: 'A', ana: '略', wc: 1, recs: [['B', 0, '2026-10-27 09:00']] }, '英语', '时态');
  addQuestion(B.id, { type: 'single', stem: '别的学生的错题-不该出现', opts: ['甲', '乙'], ans: 'A', ana: '略', wc: 1, recs: [['B', 0, '2026-10-28 09:00']] }, '数学', '别人');
  log(qids.length === 10, '造数：客户样本的 10 道数学错题 + 1 道已掌握 + 1 道英语 + 另一个学生的 1 道');

  // ---------- 1) 用客户样本的 10 题生成 Word ----------
  const res = await req('/api/stu/mistakes/export-docx?subject=' + encodeURIComponent('数学'), { token: TA, raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  log(res.status === 200 && /wordprocessingml\.document/.test(res.headers.get('content-type') || ''), '下载接口返回 .docx（Content-Type 为 wordprocessingml.document）', res.headers.get('content-type'));
  log(/filename\*=UTF-8''/.test(res.headers.get('content-disposition') || '') && decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition')) || [])[1] || '') === '马英惠-数学-错题集.docx', '文件名：姓名-科目-错题集.docx', decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') || '') || [])[1] || ''));
  log(res.headers.get('x-mistake-count') === '10', '导出 10 道（已掌握的、英语的、别人的都不在里面）', res.headers.get('x-mistake-count'));
  if (process.env.T9_OUT) fs.writeFileSync(process.env.T9_OUT, buf);   // 想亲眼看版式：T9_OUT=/tmp/x.docx node mistake-test.js
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  log(buf.slice(0, 2).toString() === 'PK' && names.includes('word/document.xml') && names.includes('[Content_Types].xml'), '是合法的 zip / OOXML 包', names.length + ' 个部件');
  const docXml = await zip.file('word/document.xml').async('string');
  const text = xmlText(docXml);
  log(/错题集/.test(text) && /共10道错题/.test(text) && /2026年10月28日 - 2026年10月28日/.test(text), '封面：错题集 / 共10道错题 / 日期范围', (text.match(/共\d+道错题/) || [''])[0]);
  log(/姓名：马英惠/.test(text) && /科目：数学/.test(text) && /日期：\d{4}年/.test(text), '封面：姓名 / 科目 / 日期');
  const iEx = text.indexOf('错题练习');
  const exPart = text.slice(iEx), anPart = exPart;
  log(iEx > 0 && /1\. T9测试多项式[\s\S]*?答案：[\s\S]*?解析：[\s\S]*?答题记录：[\s\S]*?2\. T9测试下列从左边/.test(exPart), '每题后紧跟答案、解析和答题记录');
  log(['1. T9测试多项式', '2. T9测试下列从左边', '3. T9测试把下列各多项式', '10. T9测试下列各式从等号左边'].map((x) => exPart.indexOf(x)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])), '同一天的错题按录入先后排列（样本里的第 1、2、3 … 10 题顺序）');
  log([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => new RegExp('(^|\\n)' + n + '\\. ').test(exPart)), '错题练习里有 1~10 题的题号');
  log(/知识点： 公因式/.test(exPart) && /知识点： 完全平方式/.test(exPart) && /知识点： 因式分解-完全平方公式法/.test(exPart), '每题带「知识点」');
  log(/A\. -a\(a-b\)2/.test(exPart) && /D\. x2\+3x-4=\(x-1\)\(x\+4\)/.test(exPart) && /<m:oMath>/.test(docXml) && /<m:sSup>/.test(docXml), '选择题选项完整，公式以上标等可编辑 Word 公式保存');
  log((exPart.match(/⚑ 多次答错/g) || []).length === 5, '答错 2 次及以上的题（样本里的第 2、3、5、9、10 题）标「多次答错」，每题显示一次', String((exPart.match(/多次答错/g) || []).length));
  log(/答案：D/.test(anPart) && /答案：\(2a\+3b\)2；\(3p-3q-1\)2/.test(anPart) && /答案：3/.test(anPart), '错题解析：答案（选择题字母 / 填空多个空用「；」隔开）');
  log(/解析：A\.左边是单项式,不是因式分解,故选项A错误;/.test(anPart) && /D\.是因式分解,故选项D正确\./.test(anPart), '错题解析：解析原文多行保留');
  log(/答题记录：/.test(anPart) && /✗ C\s+2026-10-26 11:50/.test(anPart) && /✗ B\s+2026-10-21 15:34/.test(anPart), '错题解析：答题记录（对错 + 当时的答案 + 时间，按时间倒序）');
  log(/<w:fldChar|<w:instrText/.test(await zip.file(names.find((n) => /word\/footer\d*\.xml/.test(n))).async('string')) && /PAGE/.test(await zip.file(names.find((n) => /word\/footer\d*\.xml/.test(n))).async('string')) && /NUMPAGES/.test(await zip.file(names.find((n) => /word\/footer\d*\.xml/.test(n))).async('string')), '页脚：第 X 页 / 共 Y 页（PAGE / NUMPAGES 域）');
  // 图片
  const media = names.filter((n) => /^word\/media\//.test(n) && !/\/$/.test(n));
  log(media.length === 1 && (await zip.file(media[0]).async('nodebuffer')).equals(JPG), '图片题：JPEG 字节原样内嵌（从 public/pu 读取）', media.join());
  log(/<w:drawing>/.test(docXml) && /<a:blip /.test(docXml), '图片以 drawing 内嵌在题干后面');
  log(media.length === 1 && /\.jpe?g$/i.test(media[0]), 'JPEG 的内嵌文件扩展名是 .jpg（不是 .png）——Word / WPS 更稳', media[0]);

  // 只验证公式的两种导出路径：能编辑的分数仍为 OMML，其他可识别公式变为 PNG；无效公式保留原文。
  const { buildMistakeDocx } = require('./src/mistake-docx');
  const formulaDoc = await buildMistakeDocx({ student: { name: '测试' }, subject: '数学', includeAnswers: false, items: [{
    type: 'answer', stem: String.raw`分数 \(\frac{1}{2}\)，线段 \(\overline{AB}\)，未知 \(\badcommand{x}\)`,
    updated_at: '2026-11-05', images: [], options: [], records: [],
  }] });
  const formulaZip = await JSZip.loadAsync(formulaDoc);
  const formulaXml = await formulaZip.file('word/document.xml').async('string');
  const formulaMedia = Object.keys(formulaZip.files).filter((n) => /^word\/media\/.*\.png$/.test(n));
  const png = formulaMedia.length === 1 ? await formulaZip.file(formulaMedia[0]).async('nodebuffer') : Buffer.alloc(0);
  log(/<m:f>/.test(formulaXml) && png.slice(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && /\\badcommand\{x\}/.test(formulaXml), '常见公式可编辑，其他可识别公式嵌入 PNG，未知语法保留原文');

  // 2) 本机有 python-docx / LibreOffice 就真正打开
  const tmp = path.join(require('os').tmpdir(), 't9-' + uniq + '.docx'); fs.writeFileSync(tmp, buf); made.files.push(tmp);
  const py = spawnSync('python3', ['-c', 'import docx,sys; d=docx.Document(sys.argv[1]); print(len(d.paragraphs), len(d.tables), len(d.inline_shapes))', tmp], { encoding: 'utf8' });
  if (py.status === 0) {
    const [np, nt, ni] = py.stdout.trim().split(/\s+/).map(Number);
    log(np > 60 && nt >= 1 && ni === 1, 'python-docx 能打开并读出段落 / 表格 / 图片（说明结构合法、可编辑）', py.stdout.trim());
  } else console.log('  ⏭  本机没有 python-docx，跳过"真正打开"检查');
  const so = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', path.dirname(tmp), tmp], { encoding: 'utf8', timeout: 120000 });
  const pdfPath = tmp.replace(/\.docx$/, '.pdf');
  if (so.status === 0 && fs.existsSync(pdfPath)) {
    made.files.push(pdfPath);
    const pt = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
    const pages = (pt.stdout || '').split('\f').filter((x) => x.trim()).length;
    log(pages >= 4 && /错题练习/.test(pt.stdout) && /答题记录/.test(pt.stdout), 'LibreOffice 能打开并排版成 PDF（多页，含题目和答题记录）', pages + ' 页');
    log(/第 1 页 \/ 共 \d+ 页/.test(pt.stdout) || /第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页/.test(pt.stdout), '排版后页脚显示 "第 X 页 / 共 Y 页"');
  } else console.log('  ⏭  本机没有 LibreOffice，跳过"转 PDF 排版"检查');

  // ---------- 3) 筛选 ----------
  const ex = async (qs, tok = TA) => req('/api/stu/mistakes/export-docx?' + qs, { token: tok, raw: true });
  const cnt = async (qs, tok) => { const r = await ex(qs, tok); return r.headers.get('x-mistake-count'); };
  log(await cnt('subject=' + encodeURIComponent('数学') + '&bucket=resolved') === '1', 'bucket=resolved：只导出已掌握的');
  log(await cnt('subject=' + encodeURIComponent('数学') + '&bucket=all') === '11', 'bucket=all：未掌握 + 已掌握共 11 道');
  log(await cnt('') === '11', '不指定科目：数学 10 + 英语 1（已掌握的不含）= 11', await cnt(''));
  log(await cnt('subject=' + encodeURIComponent('英语')) === '1', '按科目筛：英语 1 道');
  log(await cnt('subject=' + encodeURIComponent('数学') + '&from=2026-10-28&to=2026-10-28') === '10', '按日期筛：10-28 当天更新的 10 道数学错题');
  log(await cnt('subject=' + encodeURIComponent('数学') + '&bucket=all&to=2026-10-27') === '1', '按日期筛：10-27 及以前 = 10-20 那道已掌握的题');
  const later = await (await ex('subject=' + encodeURIComponent('数学') + '&from=2026-10-29')).json();
  log(later.code !== 0 && /没有符合条件/.test(later.msg), '按日期筛：10-29 起没有错题 → 提示');
  log(await cnt('ids=' + qids[0] + ',' + qids[1]) === '2', '指定题目 id：只导出这 2 道');
  log(await cnt('', TB) === '1', '另一个学生只导出他自己的 1 道（不会拿到别人的错题）');
  const none = await ex('subject=' + encodeURIComponent('物理'));
  const nj = await none.json();
  log(nj.code !== 0 && /没有符合条件/.test(nj.msg), '没有符合条件的错题：返回提示而不是空文件', nj.msg);
  const anon = await fetch(BASE + '/api/stu/mistakes/export-docx');
  log(anon.status === 401 || (await anon.json()).code !== 0, '没登录不能导出');
  const asAdmin = await req('/api/stu/mistakes/export-docx', { token: AT, raw: true });
  log(asAdmin.status === 403 || (asAdmin.headers.get('content-type') || '').includes('json'), '管理员账号走学生接口会被拒');

  // ---------- 4) 后台导出 ----------
  const ad = await req('/api/admin/bank/mistakes/export-docx?user_id=' + A.id + '&subject=' + encodeURIComponent('数学'), { token: AT, raw: true });
  const adBuf = Buffer.from(await ad.arrayBuffer());
  log(ad.status === 200 && ad.headers.get('x-mistake-count') === '10' && adBuf.slice(0, 2).toString() === 'PK', '后台：按学生导出同样的 Word（10 道）');
  const adNo = await req('/api/admin/bank/mistakes/export-docx?user_id=999999999', { token: AT });
  log(adNo.code !== 0 && /学生不存在/.test(adNo.msg), '后台：学生不存在 → 提示');
  const stuToAdmin = await req('/api/admin/bank/mistakes/export-docx?user_id=' + A.id, { token: TA });
  log(stuToAdmin.code === 403 || stuToAdmin.code !== 0, '学生 token 不能调后台导出接口');
  const brId = db.prepare("INSERT INTO users (role,username,password,name,status,created_at) VALUES ('branch',?,?,?,1,?)").run('t9s' + uniq + 'br', hash('123456'), 'T9分校', now).lastInsertRowid; made.users.push(brId);
  const BT = await login('t9s' + uniq + 'br', 'branch');
  const brNo = await req('/api/admin/bank/mistakes/export-docx?user_id=' + A.id, { token: BT });
  db.prepare('UPDATE users SET created_by=? WHERE id=?').run(brId, A.id);
  const brOk = await req('/api/admin/bank/mistakes/export-docx?user_id=' + A.id + '&subject=' + encodeURIComponent('数学'), { token: BT, raw: true });
  log(brNo.code !== 0 && /无权/.test(brNo.msg || '') && brOk.status === 200 && brOk.headers.get('x-mistake-count') === '10', '分校账号：看不了别的校区的学生，能导出自己校区的学生');

  // ---------- 5) 手机扫码上传 → AI 识别（复用错题重组 analyze）→ 自动分类 → 待审核 ----------
  const bank = require('./src/bank');
  const AI_REPLY = JSON.stringify({ subject: '数学', grade: '八年级', knowledge: '因式分解-提公因式', type: '填空题', stem: TAG + '扫码识别出的题干：分解因式 $x^2-4$ = ____', variants: [{ stem: '变式一', answer: '1', analysis: '略' }] });
  const mock = http.createServer((rq, rs) => { rq.on('data', () => {}); rq.on('end', () => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ choices: [{ message: { content: AI_REPLY } }] })); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const pid = db.prepare("INSERT INTO mf_model_profiles (role,name,provider,base_url,model,api_key,capability,format,is_enabled,last_test_ok,created_at,updated_at) VALUES ('vision','T9测试视觉','t9',?,'m','k','vision','openai',1,1,?,?)")
    .run('http://127.0.0.1:' + mock.address().port + '/v1', now, now).lastInsertRowid; made.profiles.push(pid);
  const wasEnabled = db.prepare("SELECT id FROM mf_model_profiles WHERE role='vision' AND is_enabled=1 AND id<>?").all(pid).map((r) => r.id);
  wasEnabled.forEach((id) => db.prepare('UPDATE mf_model_profiles SET is_enabled=0 WHERE id=?').run(id));
  try {
    // AI 识别填充待审核草稿；审核前不建题、不写错题本。
    const upId = db.prepare("INSERT INTO paper_uploads (user_id, subject, grade, stem_text, answer, chapter, point, error_type, note, images, status, created_at) VALUES (?,'', '', '', '', '', '', '', '', ?, 'pending', ?)")
      .run(A.id, JSON.stringify(['/pu/' + jpgName]), now).lastInsertRowid;
    await bank.aiRecognizeUpload(upId);
    const up = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(upId);
    const draft = JSON.parse(up.draft_json || '{}');
    log(up.subject === '数学' && up.point === '因式分解-提公因式' && !up.question_id, 'AI 识别学科和知识点，审核前不建题', JSON.stringify({ subject: up.subject, point: up.point }));
    log(/扫码识别出的题干/.test(draft.stem) && /填空题/.test(draft.ai_type_suggestion || ''), '审核草稿带有识别题干和题型建议');
    log(!up.question_id, '审核前没有进入学生错题本');
    const pend = await req('/api/admin/bank/mf/ext/pending?source=scan', { token: AT });
    const hit = (pend.data && pend.data.list || []).find((x) => x.id === 'up:' + upId);
    log(!!hit && hit.source_label === '手机扫码（错题）' && hit.point === '因式分解-提公因式', '进「待审核题目」，来源标「手机扫码（错题）」，已自动分类', hit && hit.source_label);
    const approved = await req('/api/admin/bank/mf/ext/pending/commit', { method:'POST', token:AT, body:{ ids:['up:' + upId], subject:'数学', stage:'junior' } });
    const qid = approved.data && approved.data.question_ids[0];
    log(approved.code === 0 && qid && db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND question_id=?').get(A.id, qid).n === 1, '审核通过后才加入该学生错题本');
    // 已选学科的上传：识别结果补齐知识点，不重复建题
    const q2 = db.prepare("INSERT INTO questions (subject,grade,stage,type,stem,options,answer,analysis,difficulty,point,source,created_at) VALUES ('数学','八年级','junior','single','（纸质错题，看图作答）','[]','','',3,'','学生上传',?)").run(now).lastInsertRowid;
    const up2 = db.prepare("INSERT INTO paper_uploads (user_id, subject, grade, stem_text, answer, chapter, point, error_type, note, images, status, question_id, created_at) VALUES (?,'数学','八年级','', '', '', '', '', '', ?, 'pending', ?, ?)")
      .run(A.id, JSON.stringify(['/pu/' + jpgName]), q2, now).lastInsertRowid;
    await bank.aiRecognizeUpload(up2);
    const q2r = db.prepare('SELECT * FROM questions WHERE id=?').get(q2);
    log(/扫码识别出的题干/.test(q2r.stem) && q2r.point === '因式分解-提公因式' && db.prepare('SELECT question_id FROM paper_uploads WHERE id=?').get(up2).question_id === q2, '已选学科的上传：占位题干被识别出的题干替换，不重复建题');
    db.prepare('DELETE FROM questions WHERE id=?').run(q2);
  } finally {
    wasEnabled.forEach((id) => db.prepare('UPDATE mf_model_profiles SET is_enabled=1 WHERE id=?').run(id));
    mock.close();
  }

  // ---------- 6) 前端：没有收藏入口 ----------
  const js = fs.readFileSync(path.join(__dirname, 'public/js/bank.js'), 'utf8');
  log(!/收藏夹|bkFav/.test(js), '学生端错题本前端里没有「收藏夹」入口（bkFav / 收藏夹 都没有了）');
  await checkMistakeUi();
  const home = await (await fetch(BASE + '/js/bank.js')).text();
  log(!/收藏夹/.test(home), '线上服务的 bank.js 同样没有「收藏夹」');
  const hist = db.prepare("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='mistakes'").get().n;
  log(Number(hist) === 1, '后端 mistakes 表与「标记掌握」接口保留（只去掉前端收藏入口）');

  cleanup();
  const left = db.prepare("SELECT COUNT(*) n FROM questions WHERE stem LIKE '" + TAG + "%'").get().n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 't9s%'").get().n;
  log(Number(left) === 0, '测试数据已清理');
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
