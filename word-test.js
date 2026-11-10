'use strict';
/* AI 单词记忆模块测试：表格解析（CSV/XLSX）+ 管理端上传 + 学生端数据与统计
 * 运行：node word-test.js（需要服务已在 3000 端口启动） */
const zlib = require('zlib');
const { log, done } = (() => {
  let pass = 0, failN = 0;
  const log = (ok, name, detail) => {
    if (ok) pass++; else failN++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  →  ' + detail : ''}`);
  };
  const done = () => { if(failN)process.exitCode=1;console.log(`\n=== 结果： 通过 ${pass} 项，失败 ${failN} 项 ===` + (failN ? '（有失败项）' : '')); };
  return { log, done };
})();

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const fs = require('fs');
const path = require('path');
const tp = require('./src/tableparse');

async function req(p, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) { payload = form; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers, body: payload });
  return r.json();
}
// 危险操作确认密码（词书删除必须带；可用环境变量 DEL_PWD 覆盖）
const DELP = { pwd: process.env.DEL_PWD || '199856' };
const fdNew = () => new FormData();

(async () => {
  /* ---------------- 1. 表格解析：CSV ---------------- */
  const csv = '单词,音标,词性,释义,例句,单元\nrepeat,"[rɪˈpiːt]",v.,重复,"Please, repeat after me.",Unit 1\n\nconclusion,,n.,结论,,Unit 1\n';
  const csvRows = tp.parseCsv(csv);
  log(csvRows.length === 3 && csvRows[0][0] === '单词', 'CSV：行数与表头正确', csvRows.length + ' 行');
  log(csvRows[1][4] === 'Please, repeat after me.', 'CSV：引号内的逗号不被拆分', '');
  const csvObjs = tp.rowsToObjects(csvRows);
  log(csvObjs.rows.length === 2, 'CSV：空行被跳过', `${csvObjs.rows.length} 条数据`);
  log(csvObjs.rows[0].word === undefined && csvObjs.rows[0]['单词'] === 'repeat', 'CSV：首行作表头映射', '');

  const tsv = '句子\t翻译\nShe is talented.\t她很有才华。';
  const tsvRows = tp.parseCsv(tsv);
  log(tsvRows[0].length === 2 && tsvRows[1][1] === '她很有才华。', 'CSV：自动识别制表符分隔', '');

  /* ---------------- 2. 表格解析：XLSX（自建最小 ZIP） ---------------- */
  // 手写 zip 打包器（deflate），构造一个最小 xlsx
  function zipBuf(files) {
    const locals = [], centrals = [];
    let off = 0;
    for (const [name, content] of files) {
      const data = zlib.deflateRawSync(content);
      const nameBuf = Buffer.from(name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
      lh.writeUInt32LE(0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(content.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      locals.push(Buffer.concat([lh, nameBuf, data]));
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); // flags=0, method=deflate
      ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(content.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(off, 42);
      centrals.push(Buffer.concat([ch, nameBuf]));
      off += lh.length + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, eocd]);
  }
  const xml = (s) => Buffer.from('<?xml version="1.0"?>' + s);
  const xlsx = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="词表" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')],
    ['xl/sharedStrings.xml', xml('<sst><si><t>单词</t></si><si><t>释义</t></si><si><t>单元</t></si><si><t>repeat</t></si><si><t>重复</t></si><si><t>Unit 1</t></si><si><t>conclusion</t></si><si><t>结论</t></si></sst>')],
    ['xl/worksheets/sheet1.xml', xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>5</v></c></row>'
      + '</sheetData></worksheet>')],
  ]);
  let xr;
  try { xr = tp.rowsToObjects(tp.parseXlsx(xlsx)); } catch (e) { xr = { err: e }; }
  log(!xr.err, 'XLSX：最小 ZIP + deflate 解包成功', xr.err ? xr.err.message : '');
  if (!xr.err) {
    log(xr.header.join(',') === '单词,释义,单元', 'XLSX：共享字符串表头正确', xr.header.join(','));
    log(xr.rows[0]['单词'] === 'repeat' && xr.rows[0]['释义'] === '重复', 'XLSX：单元格取值正确', JSON.stringify(xr.rows[0]));
  }
  let bad = null;
  try { tp.parseXlsx(Buffer.from('not a zip')); } catch (e) { bad = e; }
  log(!!bad, 'XLSX：非 zip 输入给出可读报错', bad && bad.message);

  /* ---------------- 2b. 真实表格的常见形态（用户实际会用到的那些） ---------------- */
  // ① 内联字符串（WPS 另存的 xlsx 很常见）+ 工作表用绝对路径 Target
  const inlineXlsx = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>')],
    ['xl/worksheets/sheet1.xml', xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>单词</t></is></c><c r="B1" t="inlineStr"><is><t>释义</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>beautiful</t></is></c><c r="B2" t="inlineStr"><is><t>美丽的</t></is></c></row>'
      + '</sheetData></worksheet>')],
  ]);
  let inl = null;
  try { inl = tp.parseXlsx(inlineXlsx); } catch (e) { inl = null; }
  log(!!inl && inl[0] && inl[0][0] === '单词' && inl[1] && inl[1][0] === 'beautiful',
    'XLSX：内联字符串（WPS 常见）+ 绝对路径工作表',
    inl ? JSON.stringify(inl[0]) : '解析失败');

  // ② 多工作表：应全部读出（后面按表头合并导入）
  const sheetRows = (a) => xml('<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>' + a + '</v></c><c r="B2" t="s"><v>' + (a + 1) + '</v></c></row>'
    + '</sheetData></worksheet>');
  const multiXlsx = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="U1" sheetId="1" r:id="rId1"/><sheet name="U2" sheetId="2" r:id="rId2"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')],
    ['xl/sharedStrings.xml', xml('<sst><si><t>单词</t></si><si><t>释义</t></si><si><t>apple</t></si><si><t>苹果</t></si><si><t>banana</t></si><si><t>香蕉</t></si></sst>')],
    ['xl/worksheets/sheet1.xml', sheetRows(2)],
    ['xl/worksheets/sheet2.xml', sheetRows(4)],
  ]);
  let allSheets = [];
  try { allSheets = tp.parseXlsxAll(multiXlsx); } catch (e) { allSheets = []; }
  log(allSheets.length === 2, 'XLSX：多工作表全部读出（不再只看第一张）', allSheets.length + ' 张');

  // ③ 老版 .xls（OLE2）→ 给出「另存为 xlsx / CSV」的可操作提示
  let xlsErr = null;
  try { tp.parseTable(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(80)])); } catch (e) { xlsErr = e; }
  log(!!xlsErr && /xls/i.test(xlsErr.message), '老版 .xls 提示另存为 xlsx / CSV', xlsErr && xlsErr.message);

  // ④ 空工作表 → 明确报错（而不是静默导入 0 条）
  const emptyXlsx = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')],
    ['xl/worksheets/sheet1.xml', xml('<worksheet><sheetData></sheetData></worksheet>')],
  ]);
  let emptyErr = null;
  try { tp.parseXlsx(emptyXlsx); } catch (e) { emptyErr = e; }
  log(!!emptyErr, '空工作表给出可读报错', emptyErr && emptyErr.message);

  /* ---------------- 3. 登录 + 管理端上传流程 ---------------- */
  const aLogin = await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } });
  const AT = aLogin.data.token;
  // 学生账号：优先用 seed 里的固定测试学生（13800000001），被删了就自建临时学生（跑完清理）
  let sLogin = await req('/api/login', { method: 'POST', body: { username: '13800000001', password: '123456', role: 'student' } });
  let tempStuUser = null;
  if (!sLogin.data) {
    tempStuUser = 'WSTU' + Date.now().toString().slice(-6);
    await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '单词自测学生', username: tempStuUser, password: '123456', grade: '七年级', expire_at: '2027-12-31' } });
    sLogin = await req('/api/login', { method: 'POST', body: { username: tempStuUser, password: '123456', role: 'student' } });
  }
  const ST = sLogin.data && sLogin.data.token;
  if (!ST) { console.log('  ❌ 学生账号登录失败（请先 npm run seed），后续用例跳过'); done(); process.exit(1); }
  log(!!AT && !!ST, '管理员 / 学生登录', '');

  // 学生 token 不能进管理端
  const noPerm = await req('/api/admin/word/books', { token: ST });
  log(noPerm.code !== 0, '学生 token 访问管理端被拒', noPerm.msg);

  // 新建词书
  const bk = await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '测试词书 ' + Date.now(), grade: '八年级' } });
  const bid = bk.data.id;
  log(bk.code === 0 && !!bid, '新建词书', bk.data.title);

  // 上传 xlsx 单词表
  let up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([xlsx], { type: 'application/octet-stream' }), '词表.xlsx'); fd.append('kind', 'word'); fd.append('book_id', bid); return fd; })() });
  log(up.code === 0 && up.data.inserted === 2, '上传 xlsx 单词表（中文表头自动识别）', up.code === 0 ? `插入 ${up.data.inserted} 条` : up.msg);

  // 同表再传一遍 → 全部去重跳过
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([xlsx]), 'again.xlsx'); fd.append('kind', 'word'); fd.append('book_id', bid); return fd; })() });
  log(up.code === 0 && up.data.inserted === 0 && up.data.skipped === 2, '重复上传自动去重', `插入 ${up.data.inserted}，跳过 ${up.data.skipped}`);

  // CSV 句子库
  const csvSent2 = '句子,翻译,单元\n"She is a very talented artist.","她是一位非常有才华的艺术家。",Unit 1\n"Repeat after me, please.","请跟我读。",Unit 2\n';
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([Buffer.from(csvSent2, 'utf8')]), 'sent.csv'); fd.append('kind', 'sentence'); fd.append('book_id', bid); return fd; })() });
  log(up.code === 0 && up.data.inserted === 2, '上传 CSV 句子库', up.code === 0 ? `插入 ${up.data.inserted} 条` : up.msg);

  // CSV 词性训练库（词性中英混写规范化）
  const csvPos = '原词,目标词,目标词性,词缀说明\nhappy,happiness,名词,happy + -ness\nrepeat,repetition,n.,repeat + -tion\nact,active,形容词,\n';
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([Buffer.from(csvPos, 'utf8')]), 'pos.csv'); fd.append('kind', 'pos'); fd.append('book_id', bid); return fd; })() });
  log(up.code === 0 && up.data.inserted === 3, '上传 CSV 词性训练库', up.code === 0 ? `插入 ${up.data.inserted} 条` : up.msg);
  const posList = await req('/api/admin/word/pos?book_id=' + bid, { token: AT });
  log(posList.data.every((p) => ['名词', '动词', '形容词', '副词'].includes(p.target_pos)), '词性统一规范化为中文', posList.data.map((p) => p.target_pos).join('/'));
  log(posList.data[2].affix === 'act + -ive', '没填词缀时自动猜后缀', posList.data[2].affix);

  // 表头完全对不上 → 按默认列序兜底
  const csvRaw = 'a,b,c\napple,苹果,n.\n';
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([Buffer.from(csvRaw, 'utf8')]), 'raw.csv'); fd.append('kind', 'word'); fd.append('book_id', bid); return fd; })() });
  log(up.code === 0 && up.data.inserted === 1, '表头识别不出时按默认列序（单词/音标/词性…）', up.code === 0 ? up.msg : up.msg);

  // 坏文件
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => { const fd = fdNew(); fd.append('file', new Blob([Buffer.from('')]), 'empty.csv'); fd.append('kind', 'word'); fd.append('book_id', bid); return fd; })() });
  log(up.code !== 0, '空文件被拒绝', up.msg);

  // 标题行在上方 + 一个单元一张工作表 → 应合并成一本词书一次导入
  const titleXlsx = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="Unit1" sheetId="1" r:id="rId1"/><sheet name="Unit2" sheetId="2" r:id="rId2"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')],
    ['xl/sharedStrings.xml', xml('<sst>'
      + '<si><t>七年级上册单词表</t></si><si><t>单词</t></si><si><t>释义</t></si><si><t>单元</t></si>'
      + '<si><t>apple</t></si><si><t>苹果</t></si><si><t>Unit 1</t></si><si><t>banana</t></si><si><t>香蕉</t></si><si><t>Unit 2</t></si>'
      + '</sst>')],
    ['xl/worksheets/sheet1.xml', xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c><c r="C3" t="s"><v>6</v></c></row>'
      + '</sheetData></worksheet>')],
    ['xl/worksheets/sheet2.xml', xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>7</v></c><c r="B3" t="s"><v>8</v></c><c r="C3" t="s"><v>9</v></c></row>'
      + '</sheetData></worksheet>')],
  ]);
  const nb = await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '合并导入测试 ' + Date.now(), grade: '七年级' } });
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew(); fd.append('file', new Blob([titleXlsx]), '译林版七年级上册.xlsx'); fd.append('kind', 'word'); fd.append('title', nb.data.title); fd.append('grade', '七年级'); return fd;
  })() });
  log(up.code === 0 && up.data.inserted === 2, '标题行在上方 + 两个工作表被合并导入',
    up.code === 0 ? `插入 ${up.data.inserted} 条，表头：${(up.data.header || []).filter(Boolean).join('|')}` : up.msg);
  if (up.code === 0 && up.data.bookId) await req('/api/admin/word/books/' + up.data.bookId, { method: 'DELETE', token: AT, body: DELP });
  await req('/api/admin/word/books/' + nb.data.id, { method: 'DELETE', token: AT, body: DELP });

  // 一张都没有的表（只有标题）→ 拒绝，而且不能留下空词书
  const titleOnly = zipBuf([
    ['xl/workbook.xml', xml('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')],
    ['xl/sharedStrings.xml', xml('<sst><si><t>七年级上册单词表</t></si><si><t>单词</t></si><si><t>释义</t></si></sst>')],
    ['xl/worksheets/sheet1.xml', xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>'
      + '</sheetData></worksheet>')],
  ]);
  const booksBefore = (await req('/api/admin/word/books', { token: AT })).data.length;
  up = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew(); fd.append('file', new Blob([titleOnly]), 'only-title.xlsx'); fd.append('kind', 'word'); fd.append('title', '应当被回滚的空词书 ' + Date.now()); return fd;
  })() });
  const booksAfter = (await req('/api/admin/word/books', { token: AT })).data.length;
  log(up.code !== 0, '只有表头没有数据行时明确报错', up.msg && up.msg.slice(0, 60));
  log(booksAfter === booksBefore, '导入失败不会留下空词书（自动回滚）', `${booksBefore} → ${booksAfter}`);

  /* ---------------- 3b. 三库表格模板一键下载 ---------------- */
  const tplRaw = async (kind) => {
    const r = await fetch(BASE + '/api/admin/word/template?kind=' + kind, { headers: { Authorization: 'Bearer ' + AT } });
    return { ok: r.ok, ct: r.headers.get('content-type') || '', cd: r.headers.get('content-disposition') || '', buf: Buffer.from(await r.arrayBuffer()) };
  };
  const tplW = await tplRaw('word');
  log(tplW.ok && tplW.buf.slice(0, 2).toString() === 'PK', '单词表模板可下载（xlsx 文件头正确）', `${tplW.buf.length} 字节`);
  log(/attachment/.test(tplW.cd) && /filename\*=UTF-8''/.test(tplW.cd), '模板按「下载」返回且中文文件名用 UTF-8 编码', tplW.cd.slice(0, 60));
  const tplS = await tplRaw('sentence');
  const tplP = await tplRaw('pos');
  log(tplS.ok && tplS.buf.slice(0, 2).toString() === 'PK', '句子表模板可下载', `${tplS.buf.length} 字节`);
  log(tplP.ok && tplP.buf.slice(0, 2).toString() === 'PK', '词性训练（词根词缀）表模板可下载', `${tplP.buf.length} 字节`);
  const tplBad = await req('/api/admin/word/template?kind=xxx', { token: AT });
  log(tplBad.code !== 0, '未知模板类型被拒绝', tplBad.msg);

  const aiCfg2 = await req('/api/admin/ai/config', { token: AT });
  log(aiCfg2.code === 0 && 'baseUrl' in (aiCfg2.data || {}) && 'model' in (aiCfg2.data || {}), 'AI 配置可读取（接口地址 / 模型）',
    aiCfg2.data ? `${aiCfg2.data.model}` : aiCfg2.msg);

  /* ---------------- 3d. 短语库：独立于单词库，学生端「短语速记」数据源 ---------------- */
  const csvPhrase = '短语,释义,单元\nlook after,照顾,Unit 1\ngive up,放弃,Unit 1\nlook after,照顾,Unit 1\n';
  const phBook = (await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '短语测试词书 ' + Date.now(), kind: 'phrase' } })).data;
  log(phBook && phBook.kind === 'phrase', '可创建「短语书」类型词书', phBook ? String(phBook.kind) : String(phBook));
  const upPh = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew();
    fd.append('file', new Blob([Buffer.from(csvPhrase, 'utf8')]), 'phrase.csv');
    fd.append('kind', 'phrase'); fd.append('book_id', String(phBook.id));
    return fd;
  })() });
  log(upPh.code === 0 && upPh.data.inserted === 2, '短语 CSV 上传导入（重复短语自动跳过）', upPh.msg);
  const phStu = await req('/api/stu/word/phrases?book_id=' + phBook.id, { token: ST });
  log(phStu.code === 0 && phStu.data.length === 2 && phStu.data[0].phrase === 'look after', '学生端短语接口返回短语库数据', `${phStu.data ? phStu.data.length : 0} 条`);
  const recPh = await req('/api/stu/word/record', { method: 'POST', token: ST, body: { module: 'phrase', bookId: phBook.id, wordId: phStu.data[0].id, correct: true } });
  log(recPh.code === 0, '作答统计支持 phrase 模块', recPh.msg);
  const stPh = await req('/api/stu/word/stats?book_id=' + phBook.id, { token: ST });
  log(stPh.code === 0 && stPh.data.phrase && stPh.data.phrase.correct === 1, '统计按 phrase 模块单独计数', JSON.stringify(stPh.data && stPh.data.phrase));
  const tplPh = await tplRaw('phrase');
  log(tplPh.ok && tplPh.buf.slice(0, 2).toString() === 'PK', '短语表模板可下载（xlsx 文件头正确）', `${tplPh.buf.length} 字节`);

  // 模板回环：下载下来的模板原样上传，应当能直接导入（表头与解析规则一致）
  const tplBook = (await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '模板回环词书 ' + Date.now() } })).data;
  const upTpl = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew();
    fd.append('file', new Blob([tplW.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '单词表模板.xlsx');
    fd.append('kind', 'word'); fd.append('book_id', String(tplBook.id));
    return fd;
  })() });
  log(upTpl.code === 0 && upTpl.data.inserted === 3, '下载的模板原样上传即可导入（表头 / 列名一致）', upTpl.msg);
  const upTplPos = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew();
    fd.append('file', new Blob([tplP.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '词性训练表模板.xlsx');
    fd.append('kind', 'pos'); fd.append('book_id', String(tplBook.id));
    return fd;
  })() });
  log(upTplPos.code === 0 && upTplPos.data.inserted === 4, '词形转换模板原样上传即可导入（含原词词性/释义新列）', upTplPos.msg);

  /* ---------------- 3b+. 考纲单词模板：无单元列（学生端自动按 60 词分组），带（选填）标注的表头也能识别 ---------------- */
  const tplSyl = await tplRaw('syllabus');
  log(tplSyl.ok && tplSyl.buf.slice(0, 2).toString() === 'PK', '考纲单词表模板可下载（xlsx 文件头正确）', `${tplSyl.buf.length} 字节`);
  const sylBook = (await req('/api/admin/word/books', { method: 'POST', token: AT, body: { title: '考纲模板回环词书 ' + Date.now(), kind: 'syllabus' } })).data;
  const upTplSyl = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew();
    fd.append('file', new Blob([tplSyl.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '考纲单词表模板.xlsx');
    fd.append('kind', 'word'); fd.append('book_id', String(sylBook.id));
    return fd;
  })() });
  log(upTplSyl.code === 0 && upTplSyl.data.inserted === 3, '考纲模板（无单元列 + 选填标注表头）原样上传即可导入', upTplSyl.msg);
  // 带标注表头的 CSV 也能识别（「音标（选填）」剥掉括号后命中别名）
  const csvNote = '单词,音标（选填）,释义,例句（选填）,单元（选填）\nmarker,/[ˈmɑːkə]/,标记,Mark it down.,Unit 1\n';
  const upNote = await req('/api/admin/word/upload', { method: 'POST', token: AT, form: (() => {
    const fd = fdNew();
    fd.append('file', new Blob([Buffer.from(csvNote, 'utf8')]), 'note.csv');
    fd.append('kind', 'word'); fd.append('book_id', String(tplBook.id));
    return fd;
  })() });
  log(upNote.code === 0 && upNote.data.inserted === 1, '带「（选填）」标注的表头也能正常识别导入', upNote.msg);
  const tplPosList = await req('/api/admin/word/pos?book_id=' + tplBook.id, { token: AT });
  const tplPosCare = tplPosList.data.find((p) => p.base_word === 'care');
  log(tplPosCare && tplPosCare.base_pos === 'v.' && tplPosCare.meaning === '小心的', '模板里的原词词性 / 目标词释义正确入库', tplPosCare && `care ${tplPosCare.base_pos} → ${tplPosCare.target_word} ${tplPosCare.meaning}`);

  // AI 助手（演示模式）：生成 → 预览 → 入库 → 补全
  await req('/api/admin/ai/config', { method: 'PUT', token: AT, body: { mock: true } });
  const aiGen = await req('/api/admin/word/ai/generate', { method: 'POST', token: AT, body: { kind: 'word', grade: '八年级', unit: 'Unit T', count: 5 } });
  log(aiGen.code === 0 && Array.isArray(aiGen.data.rows) && aiGen.data.rows.length >= 3, 'AI 生成（演示模式）返回单词表数据', aiGen.msg);
  const aiSave = await req('/api/admin/word/ai/save', { method: 'POST', token: AT, body: { bookId: tplBook.id, kind: 'word', rows: aiGen.data.rows } });
  log(aiSave.code === 0 && aiSave.data.inserted === aiGen.data.rows.length, 'AI 生成数据一键入库（去重生效）', aiSave.msg);
  const aiSave2 = await req('/api/admin/word/ai/save', { method: 'POST', token: AT, body: { bookId: tplBook.id, kind: 'word', rows: aiGen.data.rows } });
  log(aiSave2.code === 0 && aiSave2.data.inserted === 0 && aiSave2.data.skipped > 0, '同一批 AI 数据重复导入全部去重', aiSave2.msg);
  const aiFill = await req('/api/admin/word/ai/fill', { method: 'POST', token: AT, body: { bookId: tplBook.id, kind: 'word' } });
  log(aiFill.code === 0, 'AI 补全接口（演示模式）可用', aiFill.msg);
  const aiGenPos = await req('/api/admin/word/ai/generate', { method: 'POST', token: AT, body: { kind: 'pos', grade: '八年级', unit: 'Unit T', count: 5 } });
  log(aiGenPos.code === 0 && aiGenPos.data.rows.every((r) => r.base_word && r.target_word), 'AI 生成词形转换（演示模式）', aiGenPos.msg);
  await req('/api/admin/ai/config', { method: 'PUT', token: AT, body: { mock: false } });
  await req('/api/admin/word/books/' + tplBook.id, { method: 'DELETE', token: AT, body: DELP });

  /* ---------------- 4. 学生端 ---------------- */
  const books = await req('/api/stu/word/books', { token: ST });
  log(books.code === 0 && books.data.some((b) => b.id === bid && b.word_count === 3), '学生端能看到词书与数量', books.data.find((b) => b.id === bid) && `词${books.data.find((b) => b.id === bid).word_count}/句${books.data.find((b) => b.id === bid).sentence_count}/词性${books.data.find((b) => b.id === bid).pos_count}`);

  const units = await req('/api/stu/word/units?book_id=' + bid, { token: ST });
  log(units.code === 0 && units.data.includes('Unit 1') && units.data.includes('Unit 2'), '单元列表合并三个库', (units.data || []).join('/'));

  const wU1 = await req('/api/stu/word/words?book_id=' + bid + '&unit=Unit%201', { token: ST });
  log(wU1.data.length === 2 && wU1.data[0].word === 'repeat', '按单元取单词', wU1.data.map((w) => w.word).join('/'));
  const wAll = await req('/api/stu/word/words?book_id=' + bid, { token: ST });
  log(wAll.data.length === 3, '不筛单元取全部单词', wAll.data.length + ' 个');

  const sents = await req('/api/stu/word/sentences?book_id=' + bid, { token: ST });
  log(sents.data.length === 2 && sents.data[0].translation.includes('才华'), '学生端取句子', sents.data.length + ' 句');

  const pos = await req('/api/stu/word/pos?book_id=' + bid, { token: ST });
  log(pos.data.length === 3, '学生端取词性题', pos.data.length + ' 条');

  // 记录作答 + 统计
  await req('/api/stu/word/record', { method: 'POST', token: ST, body: { module: 'quick', bookId: bid, wordId: wAll.data[0].id, correct: true } });
  await req('/api/stu/word/record', { method: 'POST', token: ST, body: { module: 'quick', bookId: bid, wordId: wAll.data[1].id, correct: false } });
  await req('/api/stu/word/record', { method: 'POST', token: ST, body: { module: 'build', bookId: bid, correct: true } });
  const badMod = await req('/api/stu/word/record', { method: 'POST', token: ST, body: { module: 'hack', bookId: bid, correct: true } });
  log(badMod.code !== 0, '未知模块被拒绝', badMod.msg);
  const stats = await req('/api/stu/word/stats?book_id=' + bid, { token: ST });
  log(stats.data.quick.correct === 1 && stats.data.quick.wrong === 1 && stats.data.build.correct === 1, '按模块统计正确/错误', JSON.stringify(stats.data.quick));

  // 删除一条 + 删除词书级联
  const wid = wAll.data[0].id;
  const del = await req('/api/admin/word/words/' + wid, { method: 'DELETE', token: AT });
  log(del.code === 0, '删除单个单词', '');
  const delBook = await req('/api/admin/word/books/' + bid, { method: 'DELETE', token: AT, body: DELP });
  const after = await req('/api/stu/word/words?book_id=' + bid, { token: ST });
  log(delBook.code === 0 && after.data.length === 0, '删除词书级联清空三库', '');

  // 清理测试过程中建的临时词书（否则管理端「词书管理」里会越堆越多）
  for (const tb of [phBook, tplBook, sylBook]) {
    if (tb && tb.id) await req('/api/admin/word/books/' + tb.id, { method: 'DELETE', token: AT, body: DELP });
  }

  // 清理临时学生
  if (tempStuUser) {
    const tl = await req('/api/admin/students?kw=' + tempStuUser, { token: AT });
    const tr = ((tl.data || {}).list || [])[0];
    if (tr) await req('/api/admin/students/' + tr.id, { method: 'DELETE', token: AT });
  }
})().then(() => done());

process.on('unhandledRejection', (e) => { console.error('未捕获异常：', e && e.message); process.exit(1); });
