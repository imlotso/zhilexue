'use strict';
/**
 * 错题重组模块自测： node wrong-test.js
 * 需先启动服务（默认 http://localhost:3000，且已 npm run seed）
 * 覆盖：批次创建、题目入库（PNG 真实解码）、勾选切换、双栏/单栏排版、PDF 真实生成与下载、
 *       版式（页数随着栏数变化）、异常输入拦截
 */
const zlib = require('zlib');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

async function req(p, { method = 'GET', body, token, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  if (raw) return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return { code: 0, _buffer: Buffer.from(await res.arrayBuffer()), _ct: ct };
}

// ---------------- 造一张真实的 PNG（用于上传测试） ----------------
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makePng(w, h, inkRows) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 位 / RGB
  const raw = Buffer.alloc(h * (1 + w * 3), 255);
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0; // filter=None
    if ((inkRows || []).includes(y)) {
      for (let x = 10; x < w - 10; x++) {
        raw[off + 1 + x * 3] = 0; raw[off + 2 + x * 3] = 0; raw[off + 3 + x * 3] = 0;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  console.log('\n=== 错题重组 · 自测 ===\n');
  const seen = { batches: [], sets: [], items: [] };
  try {
    const login = await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } });
    log(login.code === 0, '校长登录', login.msg);
    const AT = login.data && login.data.token;
    if (!AT) return done();

    // ---------- 1. 批次 ----------
    const nb = await req('/api/admin/wrong/batches', { method: 'POST', token: AT, body: { title: '自测扫描批次', subject: '数学', grade: '七年级' } });
    log(nb.code === 0 && nb.data.id, '创建扫描批次', nb.msg);
    const batchId = nb.data.id; seen.batches.push(batchId);

    const bl = await req('/api/admin/wrong/batches', { token: AT });
    const blRow = (bl.data || []).find((b) => b.id === batchId);
    log(!!blRow && blRow.items === 0, '批次列表带题目数量统计', blRow ? `items=${blRow.items}` : '');

    // ---------- 2. 上传切好的题目图（真实 PNG） ----------
    const png1 = makePng(600, 200, [20, 40, 60, 80, 170, 180]);
    const png2 = makePng(600, 240, [30, 60, 90, 200, 210]);
    const png3 = makePng(500, 160, [20, 40, 120, 130]);
    const fd = new FormData();
    fd.append('batch_id', String(batchId));
    fd.append('images', new Blob([png1], { type: 'image/png' }), 'q1.png');
    fd.append('images', new Blob([png2], { type: 'image/png' }), 'q2.png');
    fd.append('images', new Blob([png3], { type: 'image/png' }), 'q3.png');
    const up = await req('/api/admin/wrong/items', { method: 'POST', token: AT, form: fd });
    log(up.code === 0 && up.data.items.length === 3, '上传 3 道题入库', up.msg);
    const ids = (up.data.items || []).map((i) => i.id);
    seen.items.push(...ids);
    log((up.data.items || []).every((i) => i.w > 0 && i.h > 0), '服务端解析出题目图片尺寸', JSON.stringify((up.data.items || []).map((i) => i.w + 'x' + i.h)));

    // 二进制垃圾文件应被拦截
    const bad = new FormData();
    bad.append('batch_id', String(batchId));
    bad.append('images', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'bad.png');
    const badRes = await req('/api/admin/wrong/items', { method: 'POST', token: AT, form: bad });
    log(badRes.code !== 0, '非图片文件被拦截', badRes.msg);

    // ---------- 3. 列表与勾选 ----------
    const list = await req(`/api/admin/wrong/items?batch_id=${batchId}`, { token: AT });
    log(list.code === 0 && list.data.rows.length === 3 && list.data.total === 3, '题目列表按批次查询', 'total=' + (list.data && list.data.total));

    const off = await req(`/api/admin/wrong/items/${ids[0]}`, { method: 'PATCH', token: AT, body: { selected: 0 } });
    log(off.code === 0 && off.data.selected === 0, '取消勾选单道题', 'selected=' + off.data.selected);
    const selOnly = await req(`/api/admin/wrong/items?batch_id=${batchId}&selected=1`, { token: AT });
    log(selOnly.data.total === 2, '按勾选状态过滤', 'selected 共 ' + selOnly.data.total);

    const all = await req('/api/admin/wrong/items/select', { method: 'POST', token: AT, body: { batch_id: batchId, selected: 1 } });
    log(all.code === 0 && all.data.count === 3, '按批次一键全选', all.msg);

    const stats = await req('/api/admin/wrong/stats', { token: AT });
    log(stats.code === 0 && stats.data.items >= 3 && stats.data.selected >= 3, '汇总统计正确', JSON.stringify(stats.data));

    // ---------- 4. 生成错题集 PDF（双栏 + 中文页眉图片） ----------
    const bannerPng = makePng(1200, 96, [30, 31, 32, 33, 34, 60, 61, 62, 63, 64]);
    const banner = 'data:image/png;base64,' + bannerPng.toString('base64');
    const mk = await req('/api/admin/wrong/sets', {
      method: 'POST', token: AT,
      body: { title: '自测错题集', itemIds: ids, columns: 2, showIndex: 1, lineGap: 12, banner },
    });
    log(mk.code === 0 && mk.data.pages >= 1, '生成双栏错题集 PDF', mk.msg + `（${mk.data && mk.data.pages} 页）`);
    const setId = mk.data.id; seen.sets.push(setId);

    const pdf = await req('/api/file?key=' + encodeURIComponent(mk.data.key) + '&token=' + AT, { raw: true });
    log(pdf.buf.subarray(0, 8).toString() === '%PDF-1.4', '下载到的确实是 PDF 文件', '头 8 字节：' + pdf.buf.subarray(0, 8).toString());
    log(pdf.type.includes('pdf'), '响应头 Content-Type 为 PDF', pdf.type);
    const pdfStr = pdf.buf.toString('latin1');
    log(pdf.buf.length > 2000, 'PDF 内含真实图片数据（体积合理）', pdf.buf.length + ' 字节');
    const imgCount = (pdfStr.match(/\/Subtype \/Image/g) || []).length;
    log(imgCount === 4, '4 张图（3 道题 + 页眉横幅）都嵌入 PDF', 'Image 数=' + imgCount);
    log(pdfStr.trimEnd().endsWith('%%EOF'), 'PDF 结构完整（以 %%EOF 结尾）');
    log(/\/Type \/Page \/Parent/.test(pdfStr), 'PDF 含页面对象');
    log(/\(1 \/ 1\)/.test(pdfStr), '页脚有页码（1 / N）', '');
    log(pdfStr.includes('/BaseFont /Helvetica'), '页码使用内置字体，无需外部字体文件');
    log(/startxref\s+\d+\s+%%EOF/.test(pdfStr), 'xref 表与偏移量完整（阅读器可正常打开）');

    // xref 偏移量必须真的指向对象开头，否则 PDF 打不开
    const m = /startxref\s+(\d+)/.exec(pdfStr);
    const at = Number(m[1]);
    log(pdfStr.slice(at, at + 4) === 'xref', 'startxref 偏移量指向 xref 表', '偏移 ' + at);

    // ---------- 5. 单栏 vs 双栏：页数应随栏数变化 ----------
    const tall = [];
    const tallFd = new FormData();
    tallFd.append('batch_id', String(batchId));
    for (let i = 0; i < 6; i++) {
      const p = makePng(600, 700, [40, 80, 120, 160, 200, 600, 620, 640]);
      tall.push(p);
      tallFd.append('images', new Blob([p], { type: 'image/png' }), 't' + i + '.png');
    }
    const tup = await req('/api/admin/wrong/items', { method: 'POST', token: AT, form: tallFd });
    seen.items.push(...(tup.data.items || []).map((i) => i.id));
    const tIds = (tup.data.items || []).map((i) => i.id);
    const two = await req('/api/admin/wrong/sets', { method: 'POST', token: AT, body: { title: '自测-双栏', itemIds: tIds, columns: 2 } });
    const one = await req('/api/admin/wrong/sets', { method: 'POST', token: AT, body: { title: '自测-单栏', itemIds: tIds, columns: 1 } });
    seen.sets.push(two.data.id, one.data.id);
    log(two.data.pages >= 1 && one.data.pages > two.data.pages, '单栏页数多于双栏（排版生效）', `双栏 ${two.data.pages} 页 / 单栏 ${one.data.pages} 页`);

    // ---------- 5b. 版面几何校验（按页解析 PDF 内容流，逐页验证摆放位置） ----------
    const twoPdf = (await req('/api/file?key=' + encodeURIComponent(two.data.key) + '&token=' + AT, { raw: true })).buf.toString('latin1');
    const streamRe = /<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g;
    const pageStreams = [];
    let sm;
    while ((sm = streamRe.exec(twoPdf))) pageStreams.push(sm[1]);
    const pagesOfPdf = pageStreams.map((s) => {
      const out = [];
      const re = /([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/Im\d+ Do/g;
      let m3;
      while ((m3 = re.exec(s))) out.push({ w: +m3[1], h: +m3[2], x: +m3[3], y: +m3[4] });
      return out;
    });
    log(pagesOfPdf.length === two.data.pages, 'PDF 页数与接口返回一致', `解析出 ${pagesOfPdf.length} 页 / 接口 ${two.data.pages} 页`);
    const place = pagesOfPdf.flat();
    log(place.length === 6, 'PDF 内 6 道题各有一处摆放', '摆放数=' + place.length);
    log(pagesOfPdf[0].length === 4 && pagesOfPdf[1].length === 2, '先填满第 1 页（2 栏共 4 题）再排第 2 页', pagesOfPdf.map((p) => p.length + ' 题').join(' / '));

    const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 34, GUTTER = 18;
    const colW = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
    const xs = [...new Set(place.map((p) => Math.round(p.x * 10) / 10))].sort((a, b) => a - b);
    log(xs.length === 2 && Math.abs(xs[0] - MARGIN) < 0.6 && Math.abs(xs[1] - (MARGIN + colW + GUTTER)) < 0.6,
      '双栏两列分别对齐左右栏位', 'x=' + JSON.stringify(xs) + ` 期望 [${MARGIN}, ${(MARGIN + colW + GUTTER).toFixed(1)}]`);
    log(pagesOfPdf[0].slice(0, 2).every((p) => Math.abs(p.x - MARGIN) < 0.6) && pagesOfPdf[0].slice(2).every((p) => p.x > MARGIN + colW),
      '题目按「先填满左栏、再填右栏」的顺序流动');
    log(pagesOfPdf[0][0].y > pagesOfPdf[0][1].y, '同栏内自上而下排列（上题在下方题之上）', `y1=${pagesOfPdf[0][0].y} y2=${pagesOfPdf[0][1].y}`);
    log(place.every((p) => p.x >= MARGIN - 0.6 && p.x + p.w <= PAGE_W - MARGIN + 0.6), '所有题目都在左右页边距之内，不会被裁掉');
    log(place.every((p) => p.y >= 30 && p.y + p.h <= PAGE_H - MARGIN + 0.6), '所有题目都在上下页边距之内');
    log(place.every((p) => Math.abs(p.w - colW) < 0.6), '题目图统一缩放到栏宽（版面整齐）', '宽度=' + place.map((p) => p.w.toFixed(1)).slice(0, 3).join(',') + '…');
    const noOverlap = pagesOfPdf.every((pg) => {
      const cols = [...new Set(pg.map((p) => Math.round(p.x)))];
      return cols.every((cx) => {
        const arr = pg.filter((p) => Math.round(p.x) === cx).sort((a, b) => b.y - a.y);
        return arr.slice(1).every((p, i) => arr[i].y - (p.y + p.h) >= -0.5);
      });
    });
    log(noOverlap, '同页同栏的题目之间不重叠');

    // ---------- 6. 参数校验 ----------
    const empty = await req('/api/admin/wrong/sets', { method: 'POST', token: AT, body: { title: '空', itemIds: [] } });
    log(empty.code !== 0, '没有勾选题目时拒绝生成', empty.msg);
    const tooMany = await req('/api/admin/wrong/sets', { method: 'POST', token: AT, body: { title: '超量', itemIds: new Array(401).fill(1) } });
    log(tooMany.code !== 0, '超过 400 道题时拒绝生成', tooMany.msg);

    const sets = await req('/api/admin/wrong/sets', { token: AT });
    log(sets.code === 0 && sets.data.length >= 3, '错题集列表可查询', (sets.data || []).length + ' 份');

    // ---------- 7. 一键重组（AI 识别 + 举一反三 + 两栏 PDF） ----------
    console.log('\n【一键重组】');
    const analyzeFd = new FormData();
    analyzeFd.append('image', new Blob([makePng(600, 500, [40, 41, 200, 201])], { type: 'image/png' }), 'q.png');
    const an = await req('/api/admin/wrong/analyze', { method: 'POST', token: AT, form: analyzeFd });
    log(an.code === 0 && !!an.data.key && an.data.w === 600 && an.data.h === 500, '单题识别：图片入库并返回尺寸', an.code === 0 ? an.data.key : an.msg);
    const anBadFd = new FormData();
    anBadFd.append('image', new Blob([Buffer.from('notpng')]), 'x.png');
    const anBad = await req('/api/admin/wrong/analyze', { method: 'POST', token: AT, form: anBadFd });
    log(anBad.code !== 0, '非图片文件被拒绝', anBad.msg);
    const anNoImg = await req('/api/admin/wrong/analyze', { method: 'POST', token: AT, form: new FormData() });
    log(anNoImg.code !== 0, '缺少图片被拒绝', anNoImg.msg);

    // 重组：AI 可能失败（未配 Key），接口要照常出卷（右栏为空）→ 两种结果都算通过
    const items = [0, 1].map(() => ({ key: an.data.key }));
    const rb = await req('/api/admin/wrong/rebuild', { method: 'POST', token: AT, body: { title: '自测-重组', items } });
    log(rb.code === 0 && rb.data.count === 2 && rb.data.pages >= 1, '一键重组生成 PDF（左原题 / 右举一反三）',
      rb.code === 0 ? `${rb.data.count} 题 / ${rb.data.pages} 页` : rb.msg);
    if (rb.code === 0) {
      const dl = await req('/api/file?key=' + encodeURIComponent(rb.data.key) + '&token=' + AT, { raw: true });
      log(dl.buf.subarray(0, 5).toString() === '%PDF-', '重组结果可下载且为有效 PDF', dl.buf.length + ' 字节');
    }
    const rbEmpty = await req('/api/admin/wrong/rebuild', { method: 'POST', token: AT, body: { items: [] } });
    log(rbEmpty.code !== 0, '没有题目时拒绝重组', rbEmpty.msg);
    const layoutPairs = require('./src/wrong').layoutPairs;
    const lp = layoutPairs(
      [{ buf: makePng(200, 100, []), w: 200, h: 100 }, { buf: makePng(100, 400, []), w: 100, h: 400 }],
      [null, null],
      {}
    );
    log(lp.pages.length >= 1 && lp.pages.every((p) => p.images.length >= 1), 'layoutPairs：无右栏时只排原题', lp.pages.length + ' 页');
    const tallPair = layoutPairs([{ buf: makePng(50, 2000, []), w: 50, h: 2000 }], [{ buf: makePng(900, 3000, []), w: 900, h: 3000 }], {});
    const onePair = tallPair.pages[0].images;
    log(onePair.every((im) => im.y >= 0 && im.y + im.h <= 841.89), '超高一题自动缩放不越界（仍在一页内）', onePair.map((i) => Math.round(i.h)).join('/'));
  } catch (e) {
    log(false, '测试过程异常', e.message);
  } finally {
    await cleanup();
  }

  async function cleanup() {
    const login = await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } }).catch(() => null);
    const AT = login && login.data && login.data.token;
    if (!AT) return;
    for (const id of seen.sets) await req('/api/admin/wrong/sets/' + id, { method: 'DELETE', token: AT }).catch(() => {});
    for (const b of seen.batches) await req('/api/admin/wrong/batches/' + b, { method: 'DELETE', token: AT }).catch(() => {});
    console.log('\n（自测数据已清理）');
  }

  function done() {
    console.log('\n=== 结果： 通过 ' + pass + ' 项，失败 ' + fail + ' 项 ===\n');
    process.exit(fail ? 1 : 0);
  }
  done();
})();
