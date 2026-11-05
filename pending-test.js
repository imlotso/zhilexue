'use strict';
/**
 * 待审核题目（T3）自测： node pending-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；同时直连 MySQL 造"拍照识别 / 采集 / 手机扫码"三类夹具。
 * 覆盖：Excel（客户 9 个 sheet 的模板，不改表头）/ Word（客户规则文档 + 洋葱样例 + 不合规格式）/ 技能包 三个导入入口都先进待审核，
 *       统一列表与来源标注、编辑、逐题入库、批量入库、删除、旧的整批入库接口没被重构弄坏。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const XLSX = require('xlsx');
const { db } = require('./src/db');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const uniq = Date.now().toString().slice(-8);
const R = path.join(__dirname, 'docs', '原始需求');

async function req(p, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : { code: 0, _status: res.status };
}
const fileForm = (name, buf, fields = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
};

// ---- 最小 zip（不压缩）：用来现场造 .docx，测不合规格式 ----
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const locals = []; const centrals = []; let off = 0;
  files.forEach(({ name, data }) => {
    const nm = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, nm);
    off += 30 + nm.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildDocx(paras) {
  const body = paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`) },
  ]);
}

(async () => {
  console.log('\n=== 待审核题目 · 自测 ===\n');
  const adm = await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } });
  const AT = adm.data && adm.data.token;
  const stuLogin = await req('/api/login', { method: 'POST', body: { username: '13800000001', password: '123456', role: 'student' } });
  const ST = stuLogin.data && stuLogin.data.token;
  const made = { questions: [], runs: [], batches: [], ups: [] };
  const pend = async (q = '') => (await req(`${MF}/ext/pending?size=100${q}`, { token: AT })).data;
  const findRun = (data, runId) => data.list.filter((x) => x.kind === 'run' && x.batch_id === runId);
  const baseCounts = (await pend()).counts;

  console.log('【权限】');
  log((await req(`${MF}/ext/pending`, { token: ST })).code === 403, '学生不能访问待审核接口');

  // ================= Excel：以客户模板为底，不改表头 =================
  console.log('【Excel 导入（客户 9 个 sheet 模板）】');
  const tplBuf = fs.readFileSync(path.join(R, '习题导入模板_math_questions.xlsx'));
  const onlyEx = await req(`${MF}/ext/import-excel`, { method: 'POST', token: AT, form: fileForm('模板.xlsx', tplBuf) });
  log(onlyEx.code !== 0 && /示例行/.test(onlyEx.msg), '模板原样上传（只有【例题】示例行）：不导入示例，给出提示', onlyEx.msg);
  const tplRes = await fetch(BASE + MF + '/ext/import-template', { headers: { Authorization: 'Bearer ' + AT } });
  const tplServed = Buffer.from(await tplRes.arrayBuffer());
  log(tplRes.status === 200 && Buffer.compare(tplServed, tplBuf) === 0, '下载模板接口返回的文件与客户给的《习题导入模板》逐字节一致（不改表头和列顺序）', `${tplServed.length} 字节`);
  log((await fetch(BASE + MF + '/ext/import-template')).status === 401 || (await (await fetch(BASE + MF + '/ext/import-template')).json()).code === 401, '未登录不能下载模板');
  const wb = XLSX.read(tplBuf, { type: 'buffer' });
  const addRows = (sheet, rows) => { const ws = wb.Sheets[sheet]; const cur = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }); XLSX.utils.sheet_add_aoa(ws, rows, { origin: cur.length }); };
  addRows('单选题', [['T3单选' + uniq + '：1+1=?', '1', '2', '3', '', '', '', '', 'B', '1+1=2', 'T3标签'], ['T3单选二' + uniq, '甲', '乙', '', '', '', '', '', 'A', '', '']]);
  addRows('多选题', [['T3多选' + uniq, '甲', '乙', '丙', '', '', '', '', 'AC', '', '']]);
  addRows('判断题', [['T3判断' + uniq, '正确', '', '']]);
  addRows('填空题', [['T3填空' + uniq + ' ____ 和 ____', '甲', '乙', '', '否', '', '']]);
  const mathEdition = (db.prepare("SELECT edition FROM bank_trees WHERE subject='数学' AND stage='junior' AND IFNULL(edition,'')<>'' LIMIT 1").get() || {}).edition || '';
  const xl = await req(`${MF}/ext/import-excel`, { method: 'POST', token: AT, form: fileForm('T3.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { subject: '数学', stage: 'junior', grade: '七年级', edition: mathEdition, term: '上册', material_type: 'exercise' }) });
  log(xl.code === 0 && xl.data.total === 5 && xl.data.examples_skipped === 9, '追加真题后导入：5 题进入待审核，9 行示例被忽略', xl.msg);
  made.runs.push(xl.data && xl.data.run_id);
  const xlMeta = db.prepare('SELECT edition,term,material_type FROM mf_recog_runs WHERE id=?').get(xl.data.run_id);
  log(xlMeta && xlMeta.edition === mathEdition && xlMeta.term === '上册' && xlMeta.material_type === 'exercise', '导入批次保留教材版本、册别和资料类型');
  let d = await pend();
  let xr = findRun(d, xl.data.run_id);
  log(xr.length === 5 && xr.every((x) => x.source === 'excel' && x.source_label === 'Excel导入'), '待审核列表里这 5 题的来源标注为「Excel导入」', xr[0] && xr[0].source_label);
  const batchOnly = await pend(`&source=excel&batch_id=${xl.data.run_id}`);
  log(batchOnly.total === 5 && batchOnly.list.every((item) => item.batch_id === xl.data.run_id), '按批次定位只显示本批 Excel 题目');
  log(xr.map((x) => x.type).join() === 'single,single,multi,judge,fill', '题型识别：单选/单选/多选/判断/填空', xr.map((x) => x.type).join());
  log(xr[0].answer === 'B' && xr[0].options.length === 3 && xr[0].subject === '数学' && xr[2].answer === 'A,C' && xr[3].answer === '正确' && xr[4].answer === '甲|乙', '答案按系统约定存放（B / A,C / 正确 / 甲|乙）', [xr[0].answer, xr[2].answer, xr[3].answer, xr[4].answer].join(' '));
  log((await req(`${MF}/questions?kw=T3单选${uniq}&size=5`, { token: AT })).data.total === 0, '导入后题库里还没有这些题（先在待审核，没直接入库）');

  // ================= Word：客户规则文档 / 洋葱样例 / 不合规格式 =================
  console.log('【Word 导入（规则版，不调 AI）】');
  const w1 = await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('word (1).docx', fs.readFileSync(path.join(R, 'word (1).docx')), { subject: '英语' }) });
  log(w1.code === 0 && w1.data.big_count === 6 && w1.data.total === 7 && w1.data.error_count === 0, '《word (1).docx》规则文档：6 道大题（含多小问共 7 题）全部进入待审核', w1.msg);
  made.runs.push(w1.data && w1.data.run_id);
  const w2 = await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('洋葱题库-样例.docx', fs.readFileSync(path.join(R, '洋葱题库-样例.docx')), { subject: '数学' }) });
  log(w2.code === 0 && w2.data.total === 10 && w2.data.error_count === 0, '《洋葱题库-样例.docx》：10 题全部进入待审核', w2.msg);
  made.runs.push(w2.data && w2.data.run_id);
  const badDoc = buildDocx(['单选题', '1.好题T3' + uniq, 'A. 甲', 'B. 乙', '答案：A', '2.选项写法不对', '（A）甲', '（B）乙', '答案：A', '3.缺答案的题', 'A. 甲', 'B. 乙']);
  const w3 = await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('坏格式.docx', badDoc) });
  log(w3.code === 0 && w3.data.total === 1 && w3.data.error_count === 2, '不合规格式：合规的那 1 题进入待审核，另外 2 题给出错误', w3.msg);
  made.runs.push(w3.data && w3.data.run_id);
  const e0 = (w3.data.errors || []);
  log(e0.length === 2 && e0[0].para === 6 && /选项格式不对/.test(e0[0].msg) && e0[1].para === 10 && /缺少「答案：」/.test(e0[1].msg), '错误带明确的段号和原因（第 6 段选项格式；第 10 段缺答案）', e0.map((e) => `第${e.para}段 ${e.msg.slice(0, 12)}`).join(' / '));
  const w4 = await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('空.docx', buildDocx(['这是一段没有题号的文字']), {}) });
  log(w4.code !== 0 && /没认出题目/.test(w4.msg), '没有题目的文档：提示"没认出题目"和格式要求', w4.msg.slice(0, 30));
  log((await req(`${MF}/ext/import-word`, { method: 'POST', token: AT, form: fileForm('a.doc', Buffer.from('x')) })).code !== 0, '老 .doc 格式被拒绝，提示另存为 .docx');
  d = await pend();
  const wr = findRun(d, w2.data.run_id);
  log(wr.length === 10 && wr.every((x) => x.source === 'word' && x.source_label === 'Word导入'), '洋葱样例的 10 题来源标注为「Word导入」');

  // ================= 技能包 =================
  console.log('【技能包导入】');
  const pack = {
    format: 'mofang-question-pack', schemaVersion: 1, packageId: 'T3PACK' + uniq, sources: [{ id: 's1', name: 'T3测试来源' }], assets: [],
    questions: [
      { recordKey: 'k1' + uniq, source: { sourceId: 's1' }, content: { stem: 'T3技能包题一' + uniq, options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }], answer: 'A', analysis: '解析一' }, metadata: { subject: { label: '数学' }, stage: { label: '初中' }, questionType: { label: '单选题' }, knowledgePoints: ['T3知识点'] } },
      { recordKey: 'k2' + uniq, source: { sourceId: 's1' }, content: { stem: 'T3技能包题二' + uniq, answer: '42' }, metadata: { subject: { label: '数学' }, stage: { label: '初中' } } },
    ],
  };
  const pk = await req(`${MF}/import-pack`, { method: 'POST', token: AT, body: { pack } });
  log(pk.code === 0 && pk.data.staged === 2 && pk.data.run_id > 0 && /待审核/.test(pk.msg), '技能包：2 题放入待审核（不直接入库）', pk.msg);
  made.runs.push(pk.data && pk.data.run_id);
  d = await pend();
  const pr = findRun(d, pk.data.run_id);
  log(pr.length === 2 && pr.every((x) => x.source === 'skill' && x.source_label === '技能包') && pr[0].tags.includes('T3知识点'), '来源标注为「技能包」，知识点作为建议标签带上', pr[0] && pr[0].source_label);
  log((await req(`${MF}/questions?kw=T3技能包题一${uniq}&size=5`, { token: AT })).data.total === 0, '导入后题库里没有技能包的题（先在待审核）');

  // ================= 夹具：拍照识别 / 采集 / 手机扫码（直接写库） =================
  const stuId = db.prepare("SELECT id FROM users WHERE username='13800000001'").get().id;
  const runPhoto = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('T3拍照' + uniq, '数学', 'junior', '七年级', 'image', 'T3.jpg', 'recognized', JSON.stringify([{ key: 'bank/recog/t3-source.png' }]),
    JSON.stringify([{ page: 1, questionType: '单选', stem: 'T3拍照一' + uniq, options: [{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }], answer: 'B', analysis: '', checked: true, figures: [] },
      { questionType: '解答', stem: 'T3拍照二' + uniq, options: [], answer: '见图', analysis: '', checked: true, figures: [] },
      { questionType: '解答', stem: 'T3拍照三' + uniq, options: [], answer: '见图', analysis: '', checked: true, figures: [] }]), '[]', '', '2026-11-02 10:00:00').lastInsertRowid;
  made.runs.push(runPhoto);
  const batchCap = db.prepare(`INSERT INTO mf_capture_batches (title, site, url, subject, stage, grade, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('T3采集' + uniq, 'zujuan', 'http://example.com', '数学', 'junior', '七年级',
      JSON.stringify([{ site: 'zujuan', questionId: 'T3Q1' + uniq, stem: 'T3采集一' + uniq, material: '共享材料' + uniq, group_ref: '组' + uniq, group_position: 2, year: '2024', source_text: '2024 期中', options: ['甲', '乙'], answer: 'A', analysis: '解析', type: 'single', type_unconfirmed: true },
        { site: 'zujuan', questionId: 'T3Q2' + uniq, stem: 'T3采集二' + uniq, options: [], answer: '3', analysis: '', type: 'fill' },
        { site: 'zujuan', questionId: 'temp-1', stem: 'T3采集临时' + uniq, options: [], answer: '', analysis: '', type: 'answer' }]), 'pending', '2026-11-02 10:00:00').lastInsertRowid;
  made.batches.push(batchCap);
  const qScan = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (NULL,'数学','七年级','single',?,'[]','','',3,0,'junior','','', '学生上传','',NULL,'[]','2026-11-02 10:00:00')`).run('T3扫码题' + uniq).lastInsertRowid;
  made.questions.push(qScan);
  const upId = db.prepare(`INSERT INTO paper_uploads (user_id, subject, stage, grade, point, note, images, status, question_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(stuId, '数学', 'junior', '七年级', '', '', '["/pu/t3.jpg"]', 'pending', qScan, '2026-11-02 10:00:00').lastInsertRowid;
  made.ups.push(upId);

  // ================= 统一列表 =================
  console.log('【统一列表与来源标注】');
  d = await pend();
  const cnt = d.counts;
  const photoItem = d.list.find((item) => item.batch_id === runPhoto && item.index === 0 && item.source === 'photo');
  const original = await req(`${MF}/ext/pending/original?id=${encodeURIComponent(photoItem.id)}`, { token: AT });
  const noOriginal = await req(`${MF}/ext/pending/original?id=${encodeURIComponent(`run:${runPhoto}:1`)}`, { token: AT });
  log(photoItem.original_page === 1 && original.code === 0 && original.data.page === 1 && /t3-source/.test(original.data.url) && noOriginal.code !== 0, '仅记录了页码及页图的题目可查对应原页');
  const batches = await req(`${MF}/ext/pending/batches?source=photo&kw=${encodeURIComponent('T3拍照' + uniq)}`, { token: AT });
  log(batches.code === 0 && batches.data.list.some((b) => b.id === runPhoto && b.total === 3 && b.pending === 3 && b.status === '待核对'), '批次视图返回来源、题数和真实待核对状态');
  log(cnt.excel - baseCounts.excel === 5 && cnt.word - baseCounts.word === 7 + 10 + 1 && cnt.skill - baseCounts.skill === 2 && cnt.photo - baseCounts.photo === 3 && cnt.capture - baseCounts.capture === 3 && cnt.scan - baseCounts.scan === 1,
    '各来源计数：Excel 5 / Word 18 / 技能包 2 / 拍照识别 3 / 采集 3 / 手机扫码 1', JSON.stringify(cnt));
  log(cnt.all === ['photo', 'word', 'excel', 'skill', 'capture', 'scan', 'teacher_scan', 'manual', 'paper', 'lesson'].reduce((sum, key) => sum + (cnt[key] || 0), 0), '「全部」= 各来源之和');
  const labels = new Set(d.list.map((x) => x.source_label));
  log(['拍照识别', 'Word导入', 'Excel导入', '技能包', '网络采集', '手机扫码（错题）'].every((l) => labels.has(l)), '同一个列表里同时出现 6 种来源标签', [...labels].join('/'));
  const onlyScan = await pend('&source=scan');
  const sc = onlyScan.list.find((x) => x.qid === qScan);
  log(!!sc && sc.source_label === '手机扫码（错题）' && sc.images[0] === '/pu/t3.jpg' && onlyScan.list.every((x) => x.source === 'scan'), '按来源筛选「手机扫码」，带学生上传的图片', sc && sc.batch_title);
  const kw = await pend('&kw=' + encodeURIComponent('T3拍照二' + uniq));
  log(kw.total === 1 && kw.list[0].source === 'photo', '关键词搜索题干', 'total=' + kw.total);
  const pg = await req(`${MF}/ext/pending?size=5&page=2`, { token: AT });
  log(pg.data.list.length <= 5 && pg.data.page === 2 && pg.data.total >= 20, '分页', `第 ${pg.data.page} 页 ${pg.data.list.length} 条，共 ${pg.data.total}`);
  const bc = await req(`${MF}/ext/badge-counts`, { token: AT });
  log(bc.data.pending === cnt.all && bc.data.pending_by.excel === cnt.excel, '角标接口 badge-counts 带上待审核总数与各来源计数', 'pending=' + bc.data.pending);

  // ================= 编辑 =================
  console.log('【编辑】');
  const photo1 = `run:${runPhoto}:0`;
  const ed = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: photo1, patch: { stem: 'T3拍照一改' + uniq, answer: 'A', analysis: '改后的解析', point: 'T3点', difficulty: 4, type: 'multi', options: [{ label: 'A', text: '甲甲' }, { label: 'B', text: '乙乙' }, { label: 'C', text: '丙' }] } } });
  log(ed.code === 0 && ed.data.stem === 'T3拍照一改' + uniq && ed.data.type === 'multi' && ed.data.options.length === 3 && ed.data.difficulty === 4 && ed.data.analysis === '改后的解析', '编辑拍照识别的题卡：题干/答案/解析/题型/选项/难度', ed.msg);
  // 夹具模拟的是未记录识别来源的历史题，修改后需先由老师核对当前答案和解析。
  const reviewed = ed.data && await req(`${MF}/intake/runs/${runPhoto}/aifill/confirm`, { method: 'POST', token: AT, body: { index: 0, legacy: true, expected: ed.data.ai_legacy_signature } });
  log(!!(ed.data && ed.data.ai_legacy_pending && reviewed && reviewed.code === 0), '历史拍照识别答案来源不确定，老师核对后才能入库', reviewed && reviewed.msg);
  const capEd = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: `cap:${batchCap}:1`, patch: { stem: 'T3采集二改' + uniq, point: '甲、乙' } } });
  log(capEd.code === 0 && capEd.data.stem === 'T3采集二改' + uniq && capEd.data.point === '甲、乙', '编辑采集的题', capEd.msg);
  const scEd = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: `up:${upId}`, patch: { stem: 'T3扫码题改' + uniq, answer: 'C', point: '扫码点' } } });
  const scRow = db.prepare('SELECT stem, answer, point FROM questions WHERE id=?').get(qScan);
  log(scEd.code === 0 && scRow.stem === 'T3扫码题改' + uniq && scRow.answer === 'C' && scRow.point === '扫码点', '编辑手机扫码的题：直接改库里的题目', scEd.msg);
  log((await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: 'bad', patch: {} } })).code !== 0 && (await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: 'run:99999999:0', patch: {} } })).code !== 0, '题目标识不对 / 批次不存在被拒绝');

  // ================= 逐题入库 =================
  console.log('【逐题入库】');
  const kTree = ((await req(`${MF}/trees?kind=knowledge`, { token: AT })).data.list || []).find((t) => t.subject === '数学' && t.stage === 'junior');
  const kNode = ((await req(`${MF}/trees/${kTree.id}/nodes`, { token: AT })).data.list || [])[0];
  const c1 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [photo1], node_ids: [kNode.id], tags: ['T3批标签'] } });
  const q1 = c1.data && c1.data.question_ids[0];
  made.questions.push(q1);
  const q1d = q1 ? (await req(`${MF}/questions/${q1}`, { token: AT })).data.question : {};
  log(c1.code === 0 && c1.data.committed === 1 && q1d.stem === 'T3拍照一改' + uniq && q1d.type === 'multi' && q1d.answer === 'A' && q1d.difficulty === 4 && q1d.source_type === 'recog', '拍照识别：入库一题，编辑后的内容进了题库', c1.msg);
  log((q1d.nodes || []).includes(kNode.id) && (q1d.tags || []).includes('T3批标签'), '入库时挂上知识点树节点和标签', 'nodes=' + (q1d.nodes || []).join(','));
  d = await pend();
  log(!d.list.some((x) => x.batch_id === runPhoto && x.index === 0) && d.list.some((x) => x.batch_id === runPhoto && x.index === 1), '入库的题离开待审核，同批次其它题还在');
  const again = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [photo1] } });
  log(again.code !== 0, '同一道题不能入库两次（不会重复入库）', again.msg);

  const excelQ = xr[0].id;
  const c2 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [excelQ] } });
  const q2 = c2.data && c2.data.question_ids[0]; made.questions.push(q2);
  const q2d = (await req(`${MF}/questions/${q2}`, { token: AT })).data.question;
  log(c2.code === 0 && q2d.stem.indexOf('T3单选' + uniq) === 0 && q2d.subject === '数学' && q2d.stage === 'junior' && q2d.grade === '七年级' && q2d.answer === 'B', 'Excel：入库后学科/学段/年级沿用导入时选的', `${q2d.subject}/${q2d.stage}/${q2d.grade}`);

  const compound = findRun(d, w1.data.run_id).find((x) => x.stem.indexOf('请写出空气污染') === 0);
  const c3 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [compound.id], subject: '化学', stage: 'junior' } });   // R0-B8：这份 Word 导入时没选学科学段，入库必须补上
  const q3 = c3.data && c3.data.question_ids[0]; made.questions.push(q3);
  const q3d = (await req(`${MF}/questions/${q3}`, { token: AT })).data.question;
  log(c3.code === 0 && (q3d.material || '').indexOf('空气对我们很重要') >= 0, 'Word 多小问：小问入库时带上共用的原文（material）', (q3d.material || '').slice(0, 14));

  const skillQ = pr[0].id;
  const c4 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [skillQ] } });
  const q4 = c4.data && c4.data.question_ids[0]; made.questions.push(q4);
  const q4d = (await req(`${MF}/questions/${q4}`, { token: AT })).data.question;
  log(c4.code === 0 && q4d.source_type === 'capture' && q4d.stem === 'T3技能包题一' + uniq && (q4d.tags || []).includes('T3知识点'), '技能包：入库后按转写包规则存（来源类型 capture，知识点作标签）');
  const pk2 = await req(`${MF}/import-pack`, { method: 'POST', token: AT, body: { pack } });
  log(pk2.code === 0 && pk2.data.skipped === 1 && pk2.data.staged === 1, '同一转写包再次导入：已入库的那题被跳过，未入库的那题再次进待审核（不会重复入库）', pk2.msg);
  made.runs.push(pk2.data && pk2.data.run_id);

  const beforeConfirm = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${batchCap}:0`] } });
  log(!beforeConfirm.data || !beforeConfirm.data.question_ids || !beforeConfirm.data.question_ids.length, '采集题型未经老师确认时不能入库');
  const typeConfirm = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: `cap:${batchCap}:0`, patch: { type: 'single', type_confirmed: true } } });
  log(typeConfirm.code === 0 && typeConfirm.data.type_unconfirmed === false, '老师确认题型后解除待确认状态');
  const c5 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${batchCap}:0`] } });
  const q5 = c5.data && c5.data.question_ids[0]; made.questions.push(q5);
  const q5d = (await req(`${MF}/questions/${q5}`, { token: AT })).data.question;
  log(c5.code === 0 && q5d.source_type === 'capture' && q5d.stem === 'T3采集一' + uniq, '网络采集：逐题入库');
  log(q5d.material === '共享材料' + uniq && q5d.year === '2024' && q5d.source.includes('2024 期中') && q5d.source_detail.question_group.batch_id === batchCap && q5d.source_detail.question_group.ref === '组' + uniq && q5d.source_detail.question_group.position === 2, '采集组合小题：共享材料、分组顺序和来源完整保留');
  const c6 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${batchCap}:2`] } });
  if (c6.code === 0) made.questions.push(...c6.data.question_ids);
  log(c6.code === 0 && c6.data.question_ids.length === 1, '采集临时题可审核入库，系统分配稳定标识', c6.msg);

  const c7 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`up:${upId}`], tags: ['扫码标签'] } });
  const upRow = db.prepare('SELECT status FROM paper_uploads WHERE id=?').get(upId);
  log(c7.code === 0 && upRow.status === 'approved' && db.prepare('SELECT COUNT(*) n FROM questions WHERE id=?').get(qScan).n === 1, '手机扫码：入库 = 审核通过（题目保留，上传记录标为已通过）');
  d = await pend();
  log(!d.list.some((x) => x.id === `up:${upId}`), '通过的扫码题离开待审核');

  // ================= 批量入库 + 批次收尾 =================
  console.log('【批量入库与批次收尾】');
  const left = findRun(d, runPhoto).map((x) => x.id);
  const cb = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: left, difficulty: 2 } });
  (cb.data.question_ids || []).forEach((q) => made.questions.push(q));
  log(cb.code === 0 && cb.data.committed === 2 && left.length === 2, '批量入库同批次剩下的 2 题', cb.msg);
  log(db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(runPhoto).status === 'done', '批次里的题全部处理完：批次状态变为 done');
  const mixed = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${batchCap}:1`, 'run:99999999:0'] } });
  made.questions.push(...((mixed.data && mixed.data.question_ids) || []));
  log(mixed.code === 0 && mixed.data.committed === 1 && mixed.data.failed.length === 1, '批量入库混有失败项：成功的入库，失败的单独列出', mixed.msg);

  // ================= R0-B8：入库必须有学科 + 学段（前端弹分类框，后端兜底校验） =================
  console.log('【入库必须有学科和学段（R0-B8）】');
  {
    const mkRun = (subject, stage, stems) => {
      const id = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('R0缺学科学段' + uniq, subject, stage, '', 'image', 'r0.jpg', 'recognized', '[]',
        JSON.stringify(stems.map((t) => ({ questionType: '解答', stem: t + uniq, options: [], answer: '1', analysis: '', checked: true, figures: [] }))), '[]', '', '2026-11-03 10:00:00').lastInsertRowid;
      made.runs.push(id); return id;
    };
    const aiRun = mkRun('数学', 'junior', [`${kNode.name} 分类建议测试`]);
    const aiCards = JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(aiRun).drafts);
    aiCards[0].answer = ''; aiCards[0].analysis = '';
    db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(JSON.stringify(aiCards), aiRun);
    const aiItem = findRun(await pend('&kw=' + encodeURIComponent('分类建议测试')), aiRun)[0];
    const proposal = await req(`${MF}/ext/pending/ai-classify`, { method: 'POST', token: AT, body: { ids: [aiItem.id] } });
    const aiNodes = proposal.data && proposal.data.list[0].nodes || [];
    const unchanged = JSON.parse(db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(aiRun).drafts)[0];
    const aiResult = proposal.data && proposal.data.list[0] || {};
    log(proposal.code === 0 && proposal.data.mock && aiNodes.some((n) => n.id === kNode.id) && aiResult.type === 'answer' && aiResult.difficulty_score_10 === 6 && !unchanged.answer && !unchanged.analysis && !unchanged.committed, 'AI 演示建议含题型、十级难度和树节点，生成时不写答案、解析或入库');
    const expected = Object.fromEntries(['stem', 'type', 'question_subtype', 'subject', 'stage', 'difficulty', 'difficulty_score_10'].map((k) => [k, aiItem[k] == null ? '' : aiItem[k]]));
    const accepted = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: aiItem.id, expected, patch: { type: aiResult.type, difficulty_score_10: aiResult.difficulty_score_10 } } });
    const rejectedOld = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: aiItem.id, expected, patch: { difficulty_score_10: 7 } } });
    const invalidTen = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: aiItem.id, patch: { difficulty_score_10: 11 } } });
    log(accepted.code === 0 && accepted.data.difficulty === 3 && accepted.data.difficulty_score_10 === 6 && rejectedOld.code !== 0 && invalidTen.code !== 0, '确认建议后保存十级并同步五星，过期快照和无效十级被拒');
    const expectedScope = Object.fromEntries(['stem', 'subject', 'stage', 'grade', 'edition', 'term'].map((k) => [k, aiItem[k] == null ? '' : aiItem[k]]));
    const wrongScope = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [aiItem.id], node_ids: [kNode.id], expected_scope: { ...expectedScope, edition: '已更改版本' } } });
    log(wrongScope.code !== 0 && /范围已更新/.test(wrongScope.msg), '教材范围变化后拒绝使用旧 AI 节点建议');
    const confirmAi = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [aiItem.id], node_ids: [kNode.id], expected_scope: expectedScope } });
    const aiQid = confirmAi.data && confirmAi.data.question_ids[0];
    if (aiQid) made.questions.push(aiQid);
    const aiQ = aiQid && db.prepare('SELECT answer,analysis,difficulty,difficulty_score_10 FROM questions WHERE id=?').get(aiQid);
    log(confirmAi.code === 0 && aiQ && !aiQ.answer && !aiQ.analysis && aiQ.difficulty === 3 && aiQ.difficulty_score_10 === 6 && !!db.prepare('SELECT node_id FROM question_nodes WHERE question_id=? AND node_id=?').get(aiQid, kNode.id), '老师确认后入库保留十级难度和节点，缺失答案及解析仍为空');
    const runMath = mkRun('数学', 'junior', ['R4分类数学']);
    const runEnglish = mkRun('英语', 'junior', ['R4分类英语']);
    const badNode = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runMath}:0`], node_ids: [999999999] } });
    log(badNode.code !== 0 && /节点/.test(badNode.msg), '不存在的分类节点不能入库');
    const mismatchedStage = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runMath}:0`], stage: 'primary', node_ids: [kNode.id] } });
    log(mismatchedStage.code !== 0 && /学段/.test(mismatchedStage.msg), '分类节点学段不一致不能入库');
    const differentSubjects = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runMath}:0`, `run:${runEnglish}:0`], node_ids: [kNode.id] } });
    made.questions.push(...((differentSubjects.data && differentSubjects.data.question_ids) || []));
    const pendingEnglish = db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(runEnglish);
    log(differentSubjects.code === 0 && differentSubjects.data.committed === 1 && differentSubjects.data.failed.length === 1 && /学科/.test(differentSubjects.data.failed[0].msg) && !JSON.parse(pendingEnglish.drafts)[0].committed, '混合学科批量入库只处理分类匹配的题，其余仍待审核');
    const runNo = mkRun('', '', ['R0无学科无学段A', 'R0无学科无学段B', 'R0无学科无学段C']);
    const runOk = mkRun('数学', 'junior', ['R0自带学科学段']);
    const r1 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runNo}:0`] } });
    log(r1.code !== 0 && /学科/.test(r1.msg), '缺学科学段的题直接入库被拒，提示「没有学科」', r1.msg);
    const r2 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runNo}:0`], subject: '数学' } });
    log(r2.code !== 0 && /学段/.test(r2.msg), '有学科没学段：被拒，提示「没有学段」', r2.msg);
    log(db.prepare('SELECT COUNT(*) n FROM questions WHERE stem=?').get('R0无学科无学段A' + uniq).n === 0, '被拒的题没有进题库');
    d = await pend();
    log(d.list.some((x) => x.batch_id === runNo && x.index === 0), '被拒的题仍然留在待审核里');
    const r3 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runNo}:0`], subject: '数学', stage: 'junior', grade: '八年级' } });
    const r3q = r3.data && r3.data.question_ids[0]; made.questions.push(r3q);
    const r3d = r3q ? (await req(`${MF}/questions/${r3q}`, { token: AT })).data.question : {};
    log(r3.code === 0 && r3d.subject === '数学' && r3d.stage === 'junior' && r3d.grade === '八年级', '在弹窗里补上学科学段年级后可以入库', r3.msg);
    const mix = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`run:${runNo}:1`, `run:${runOk}:0`] } });
    made.questions.push(...((mix.data && mix.data.question_ids) || []));
    log(mix.code === 0 && mix.data.committed === 1 && mix.data.failed.length === 1 && /学科/.test(mix.data.failed[0].msg), '批量里自带学科学段的照常入库，缺的单独列出失败原因', mix.msg);
    const capB = db.prepare(`INSERT INTO mf_capture_batches (title, site, url, subject, stage, grade, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('R0采集缺学科' + uniq, 'zujuan', 'http://example.com', '', '', '', JSON.stringify([{ site: 'zujuan', questionId: 'R0CAP' + uniq, stem: 'R0采集无学科' + uniq, options: ['甲', '乙'], answer: 'A', type: 'single' }]), 'pending', '2026-11-03 10:00:00').lastInsertRowid;
    made.batches.push(capB);
    const r4 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${capB}:0`] } });
    log(r4.code !== 0 && /学科/.test(r4.msg), '网络采集的题缺学科：同样被拒', r4.msg);
    const r5 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`cap:${capB}:0`], subject: '物理', stage: 'junior' } });
    made.questions.push(...((r5.data && r5.data.question_ids) || []));
    log(r5.code === 0 && r5.data.committed === 1, '网络采集的题补上学科学段后入库', r5.msg);
    const qS2 = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
      VALUES (NULL,'数学','','single',?,'[]','','',3,0,'','','', '学生上传','',NULL,'[]','2026-11-03 10:00:00')`).run('R0扫码缺学段' + uniq).lastInsertRowid;
    made.questions.push(qS2);
    const upId2 = db.prepare(`INSERT INTO paper_uploads (user_id, subject, stage, grade, point, note, images, status, question_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(stuId, '数学', '', '', '', '', '["/pu/r0.jpg"]', 'pending', qS2, '2026-11-03 10:00:00').lastInsertRowid;
    made.ups.push(upId2);
    const r6 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`up:${upId2}`] } });
    log(r6.code !== 0 && /学段/.test(r6.msg) && db.prepare('SELECT status FROM paper_uploads WHERE id=?').get(upId2).status === 'pending', '手机扫码的题缺学段：被拒，仍在待审核', r6.msg);
    const r7 = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`up:${upId2}`], stage: 'primary', grade: '五年级' } });
    const q7 = db.prepare('SELECT stage, grade, subject FROM questions WHERE id=?').get(qS2);
    log(r7.code === 0 && q7.stage === 'primary' && q7.grade === '五年级' && q7.subject === '数学', '手机扫码的题补上学段年级后入库，题目的学段年级同步写入', r7.msg);
    const scanDraft = { type: 'answer', stem: 'T3扫码十级难度' + uniq, answer: '', analysis: '', options: [] };
    const upTen = db.prepare(`INSERT INTO paper_uploads (user_id,subject,stage,grade,images,status,draft_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(stuId, '数学', 'junior', '七年级', '[]', 'pending', JSON.stringify(scanDraft), '2026-11-03 10:00:00').lastInsertRowid;
    made.ups.push(upTen);
    const scanEdit = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: `up:${upTen}`, patch: { difficulty_score_10: 7 } } });
    const scanCommit = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [`up:${upTen}`] } });
    const scanQid = scanCommit.data && scanCommit.data.question_ids[0]; if (scanQid) made.questions.push(scanQid);
    const scanSaved = scanQid && db.prepare('SELECT difficulty,difficulty_score_10,answer,analysis FROM questions WHERE id=?').get(scanQid);
    log(scanEdit.code === 0 && scanSaved && scanSaved.difficulty === 4 && scanSaved.difficulty_score_10 === 7 && !scanSaved.answer && !scanSaved.analysis, '新扫码题十级难度确认后保持 7/10 和 4 星，答案解析仍为空');
  }

  // ================= 删除 =================
  console.log('【删除】');
  d = await pend();
  const exAll = findRun(d, xl.data.run_id);            // 第 1 题已入库，剩 4 题：单选二 / 多选 / 判断 / 填空
  log(exAll.length === 4 && /^run:\d+:\d+:[0-9a-f]{8}$/.test(exAll[0].id), '待审核项 id 带题干指纹（run:批次:序号:指纹）', exAll[0].id);
  const staleOld = exAll[1].id;                         // 记下"多选"在旧页面上的 id
  const delRes = await req(`${MF}/ext/pending/delete`, { method: 'POST', token: AT, body: { ids: [exAll[0].id, exAll[2].id] } });   // 删 单选二 和 判断（不连续）
  d = await pend();
  const exAfter = findRun(d, xl.data.run_id);
  const stems = exAfter.map((x) => x.stem);
  log(delRes.code === 0 && delRes.data.deleted === 2 && exAfter.length === 2 && stems.some((t) => t.indexOf('T3多选' + uniq) === 0) && stems.some((t) => t.indexOf('T3填空' + uniq) === 0)
    && !stems.some((t) => t.indexOf('T3单选二' + uniq) === 0) && !stems.some((t) => t.indexOf('T3判断' + uniq) === 0), '批量删除同一批次里不连续的两题：删对了，剩下的内容没变', stems.map((t) => t.slice(0, 8)).join(' / '));
  log(exAfter[0].id !== staleOld && exAfter.find((x) => x.stem.indexOf('T3多选' + uniq) === 0).index !== exAll[1].index, '删除后后面的题序号前移了（所以必须靠指纹防错位）');
  const stale = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [staleOld] } });
  log(stale.code !== 0 && /列表已过期/.test(stale.msg), '用删除前的旧 id 去入库：被拒绝，提示刷新（不会把别的题入库）', stale.msg);
  const staleDel = await req(`${MF}/ext/pending/delete`, { method: 'POST', token: AT, body: { ids: [staleOld] } });
  log(staleDel.code !== 0 && findRun(await pend(), xl.data.run_id).length === 2, '用旧 id 删除：被拒绝，题目没被误删', staleDel.msg);
  const staleEdit = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: staleOld, patch: { stem: '不该写进去' } } });
  log(staleEdit.code !== 0 && !findRun(await pend(), xl.data.run_id).some((x) => x.stem === '不该写进去'), '用旧 id 编辑：被拒绝，没改错题');
  const fresh = exAfter.find((x) => x.stem.indexOf('T3多选' + uniq) === 0).id;
  const editNew = await req(`${MF}/ext/pending/item`, { method: 'PUT', token: AT, body: { id: fresh, patch: { stem: 'T3多选改' + uniq } } });
  log(editNew.code === 0 && editNew.data.id !== fresh && /^run:\d+:\d+:[0-9a-f]{8}$/.test(editNew.data.id), '用刷新后的 id 编辑成功，返回新 id（题干变了指纹也变）', editNew.data && editNew.data.id);
  const oldAfterEdit = await req(`${MF}/ext/pending/commit`, { method: 'POST', token: AT, body: { ids: [fresh] } });
  log(oldAfterEdit.code !== 0 && /列表已过期/.test(oldAfterEdit.msg), '编辑后再用编辑前的 id：同样要刷新');
  const qScan2 = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (NULL,'数学','七年级','single',?,'[]','','',3,0,'junior','','', '学生上传','',NULL,'[]','2026-11-02 10:00:00')`).run('T3扫码二' + uniq).lastInsertRowid;
  const up2 = db.prepare(`INSERT INTO paper_uploads (user_id, subject, stage, grade, point, note, images, status, question_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(stuId, '数学', 'junior', '七年级', '', '', '[]', 'pending', qScan2, '2026-11-02 10:00:00').lastInsertRowid;
  made.ups.push(up2);
  db.prepare('INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review) VALUES (?,?,1,\'\',0,\'2026-11-02\',0,\'\')').run(stuId, qScan2);
  const delUp = await req(`${MF}/ext/pending/delete`, { method: 'POST', token: AT, body: { ids: [`up:${up2}`] } });
  log(delUp.code === 0 && db.prepare('SELECT COUNT(*) n FROM questions WHERE id=?').get(qScan2).n === 0 && db.prepare('SELECT COUNT(*) n FROM mistakes WHERE question_id=?').get(qScan2).n === 0 && db.prepare('SELECT status FROM paper_uploads WHERE id=?').get(up2).status === 'rejected',
    '删除手机扫码的题 = 拒绝：连学生错题本里的这道题一起删，记录标为已拒绝');

  // 所有批量来源必须先审核，旧接口不得绕过审核。
  console.log('【旧接口不能绕过审核】');
  const run2 = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('T3整批' + uniq, '数学', 'junior', '七年级', 'image', 'x', 'recognized', '[]', JSON.stringify([{ questionType: '填空', stem: 'T3整批一' + uniq + ' ____', options: [], answer: '5', analysis: '', checked: true }, { questionType: '解答', stem: 'T3整批二' + uniq, options: [], answer: 'x', analysis: '', checked: false }]), '[]', '', '2026-11-02 10:00:00').lastInsertRowid;
  made.runs.push(run2);
  const whole = await req(`${MF}/intake/runs/${run2}/commit`, { method: 'POST', token: AT, body: { node_id: kNode.id } });
  log(whole.code !== 0 && db.prepare('SELECT status FROM mf_recog_runs WHERE id=?').get(run2).status === 'recognized', '录题工作台旧整批入口不能绕过审核', whole.msg);
  const batch2 = db.prepare(`INSERT INTO mf_capture_batches (title, site, url, subject, stage, grade, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('T3整批采集' + uniq, 'zujuan', '', '数学', 'junior', '', JSON.stringify([{ site: 'zujuan', questionId: 'T3W' + uniq, stem: 'T3整批采集题' + uniq, options: [], answer: '1', type: 'fill' }]), 'pending', '2026-11-02 10:00:00').lastInsertRowid;
  made.batches.push(batch2);
  const wholeCap = await req(`${MF}/capture/batches/${batch2}/commit`, { method: 'POST', token: AT, body: {} });
  log(wholeCap.code !== 0 && db.prepare('SELECT status FROM mf_capture_batches WHERE id=?').get(batch2).status === 'pending', '网络采集旧整批入口不能绕过审核', wholeCap.msg);

  // ================= 清理 =================
  [...new Set(made.questions.filter(Boolean))].forEach((id) => {
    ['question_nodes', 'question_tags', 'mistakes'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(id); } catch (e) { /* 忽略 */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(id);
  });
  made.runs.filter(Boolean).forEach((id) => db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(id));
  made.batches.forEach((id) => db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(id));
  made.ups.forEach((id) => db.prepare('DELETE FROM paper_uploads WHERE id=?').run(id));
  db.prepare("DELETE FROM questions WHERE stem LIKE ? OR stem LIKE ?").run('%T3%' + uniq + '%', '%' + uniq + '%T3%');
  const finalCounts = (await pend()).counts;
  log(finalCounts.all === baseCounts.all, '测试数据已清理（待审核数回到测试前）', `${baseCounts.all} → ${finalCounts.all}`);

  console.log(`\n=== 结果： 通过 ${pass} 项，失败 ${fail} 项 ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
