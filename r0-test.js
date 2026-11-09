'use strict';
/**
 * R0 二轮整改（bug 修复）浏览器自测： node r0-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local）并 npm run seed；直连同一个 MySQL 造学生 / 题目，结束后清理。
 * 覆盖（接口层的部分在 smoke.js / pending-test.js 里）：
 *   B3 题库列表 / 编辑弹窗里三种格式的选项都能正常显示（不再出现 [object Object]）
 *   B4 学生端做题弹窗里的题图：700×500 的图显示宽度 ≥ 320px、单独成块，小图不放大；点击出灯箱，Esc / 点遮罩关闭
 *   B5 代理 iframe：没有 allow-same-origin，iframe 里读不到后台令牌、访问不到 parent.document；悬浮球仍能注入、回传仍然可用
 *   B6 树行折叠箭头不被撑满；选中的切换键悬停时保持白字
 *   B8 待审核单题「入库」弹分类框，缺学科 / 学段不能入库
 *   B9 本地存储时题图（后台 + 学生端）都能显示
 * 没有 Playwright 时整体跳过。
 */
const fs = require('fs');
const path = require('path');
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
  const j = await res.json(); j._status = res.status; return j;
}
const uniq = Date.now().toString().slice(-8);
const TAG = 'R0浏览器测试';
const made = { users: [], runs: [], papers: [] };

/** 现成的 PNG 编码（不依赖任何库）：渐变底 + 斜线，w×h */
function makePng(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const diag = Math.abs(x * h - y * w) < w * 1.2;
      raw[o] = diag ? 20 : 120 + Math.floor(100 * x / w); raw[o + 1] = diag ? 60 : 180; raw[o + 2] = diag ? 160 : 235 - Math.floor(80 * y / h);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['mistakes', 'records', 'question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`SELECT id FROM mf_papers WHERE title LIKE '${TAG}%'`).all().forEach((p) => { db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(p.id); try { db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(p.id); } catch (e) { /* ignore */ } db.prepare('DELETE FROM mf_papers WHERE id=?').run(p.id); });
  db.prepare(`DELETE FROM mf_recog_runs WHERE title LIKE '${TAG}%'`).run();
  db.prepare(`DELETE FROM mf_capture_batches WHERE title LIKE '${TAG}%' OR url LIKE '%/upload.html'`).run();
  made.users.forEach((id) => { ['mistakes', 'records', 'practices', 'mf_paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM users WHERE id=?').run(id); });
}

(async () => {
  console.log('\n=== R0 bug 修复 · 浏览器自测 ===\n');
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { /* 没装 */ }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] }); } catch (e) { browser = null; } }
  if (!browser) { console.log('  ⏭  没有可用的浏览器（Playwright），整体跳过'); process.exit(0); }

  cleanup();
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('15152099970', 'admin');
  const sid = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'R0学生','九年级','上册',1,1,'2099-12-31',1,'2026-11-04')").run('r0s' + uniq, hash('123456')).lastInsertRowid;
  made.users.push(sid);

  // ---------- 夹具：题图（700×500 大图 + 120×90 小图）、三种格式的选项、待审核里缺学科学段的题 ----------
  const upImg = async (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/png' }), name); return (await req(MF + '/asset', { method: 'POST', token: AT, form: fd })).data; };
  const big = await upImg(makePng(700, 500), 'r0big.png');
  const small = await upImg(makePng(120, 90), 'r0small.png');
  const strip = (u) => u.replace(/&ft=[^&]+/, '');
  const mk = async (b) => (await req(MF + '/questions', { method: 'POST', token: AT, body: b })).data.id;
  const qImg = await mk({ type: 'single', subject: '数学', stage: 'junior', grade: '九年级', stem: `${TAG} 看图作答：[图1] 中间的文字 [图2] 结尾`, options: ['甲', '乙'], answer: 'A', images: [strip(big.url), strip(small.url)] });
  // 三种选项格式：字符串 / {label,text} / {label,content}（后两种是历史数据里真实存在的，直接写库）
  const insQ = (stem, opts) => db.prepare(`INSERT INTO questions (subject, stage, grade, type, stem, options, answer, analysis, difficulty, sort, images, created_at) VALUES ('数学','primary','三年级','single',?,?, 'A','',3,0,'[]','2026-11-04 10:00:00')`).run(stem, JSON.stringify(opts)).lastInsertRowid;
  insQ(TAG + ' 选项字符串 ' + uniq, ['字符串甲', '字符串乙']);
  insQ(TAG + ' 选项labeltext ' + uniq, [{ label: 'A', text: '文本甲' }, { label: 'B', text: '文本乙' }]);
  insQ(TAG + ' 选项labelcontent ' + uniq, [{ label: 'A', content: '内容甲' }, { label: 'B', content: '内容乙' }]);
  const p = await req(MF + '/papers', { method: 'POST', token: AT, body: { title: TAG + '卷', subject: '数学', stage: 'junior', grade: '九年级' } });
  await req(`${MF}/papers/${p.data.id}/questions`, { method: 'POST', token: AT, body: { question_ids: [qImg] } });
  await req(`${MF}/papers/${p.data.id}`, { method: 'PUT', token: AT, body: { status: 'done', published: 1 } });
  const runId = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(TAG + '待审核', '', '', '', 'image', 'r0.jpg', 'recognized', '[]',
    JSON.stringify([{ questionType: '解答', stem: TAG + '待审核甲' + uniq, options: [], answer: '1', analysis: '', checked: true, figures: [] }]), '[]', '', '2026-11-04 10:00:00').lastInsertRowid;
  log(!!big && !!small && !!qImg && !!p.data.id, '夹具就绪：700×500 与 120×90 的题图、三种格式选项的题、缺学科学段的待审核题');

  const errs = [];
  const watch = (pg, tag) => { pg.on('pageerror', (e) => errs.push(tag + ':' + e.message)); };
  try {
    // ================= 学生端：B4 题图 + 灯箱，B9 题图能加载 =================
    const sp = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(sp, 'stu');
    const imgResp = [];
    sp.on('response', (r) => { if (/\/api\/file\?key=bank/.test(r.url())) imgResp.push({ status: r.status(), auth: r.request().headers().authorization || '' }); });
    await sp.goto(BASE + '/'); await sp.waitForTimeout(700);
    await sp.fill('input[type=text],input[type=tel],input:not([type])', 'r0s' + uniq); await sp.fill('input[type=password]', '123456'); await sp.keyboard.press('Enter'); await sp.waitForTimeout(1500);
    await sp.goto(BASE + '/#/papers'); await sp.waitForSelector('.bk-tabs [data-s="数学"]'); await sp.click('.bk-tabs [data-s="数学"]'); await sp.waitForSelector('.pk-libcard', { timeout: 8000 });
    await sp.fill('#pkQ', TAG); await sp.keyboard.press('Enter'); await sp.waitForTimeout(800);
    await sp.click('.pk-libcard [data-lib]'); await sp.waitForSelector('#pkPreviewStart'); await sp.click('#pkPreviewStart'); await sp.waitForSelector('.r0-qimg', { timeout: 8000 });
    await sp.waitForFunction(() => { const a = [...document.querySelectorAll('.r0-qimg')]; return a.length === 2 && a.every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 8000 });
    const dims = await sp.$$eval('.r0-qimg', (a) => a.map((i) => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, nw: i.naturalWidth, disp: getComputedStyle(i).display, par: getComputedStyle(i.parentElement).display })));
    log(dims[0].nw === 700 && dims[0].w >= 320 && dims[0].h <= 360.5, 'B4 700×500 的题图在做题弹窗里显示宽度 ≥ 320px、高度 ≤ 360px', `${dims[0].w.toFixed(0)}×${dims[0].h.toFixed(0)}`);
    log(dims[0].disp === 'block' && dims[0].par === 'block', 'B4 题图单独成块（不再嵌在文字行里）');
    log(dims[1].nw === 120 && dims[1].w <= 123, 'B4 小图按原尺寸显示，不放大糊掉', `${dims[1].w.toFixed(0)}×${dims[1].h.toFixed(0)}`);
    const stemW = await sp.$eval('.qz-stem', (e) => e.getBoundingClientRect().width);
    log(dims[0].w <= stemW * 0.7 + 1 || dims[0].w <= 360 / 500 * 700 + 1, 'B4 大图宽度不超过题干区 70%（或受 360px 高度限制）', `题干区 ${stemW.toFixed(0)}px`);
    log(imgResp.length >= 2 && imgResp.every((r) => r.status === 200 && !r.auth), 'B9 学生端题图请求（<img> 不带登录头）全部 200', JSON.stringify(imgResp.map((r) => r.status)));
    await sp.click('.r0-qimg >> nth=0'); await sp.waitForSelector('.r0-lightbox', { timeout: 3000 });
    const lb = await sp.evaluate(() => { const m = document.querySelector('.r0-lightbox'), i = m.querySelector('img'); const r = i.getBoundingClientRect(); return { z: Number(getComputedStyle(m).zIndex), nw: i.naturalWidth, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, quizZ: Number(getComputedStyle(document.querySelector('.quiz-mask')).zIndex) }; });
    log(lb.nw === 700 && lb.inView && lb.z > lb.quizZ, 'B4 点击题图出现灯箱：显示原图（700 宽），完整落在视口内，层级高于做题弹层', JSON.stringify(lb));
    await sp.keyboard.press('Escape'); await sp.waitForTimeout(200);
    log(await sp.$('.r0-lightbox') === null && await sp.$('.quiz-mask') !== null, 'B4 按 Esc 关闭灯箱（做题弹窗还在）');
    await sp.click('.r0-qimg >> nth=1'); await sp.waitForSelector('.r0-lightbox', { timeout: 3000 });
    await sp.mouse.click(8, 300); await sp.waitForTimeout(200);
    log(await sp.$('.r0-lightbox') === null, 'B4 点遮罩关闭灯箱');
    await sp.close();

    // ================= 后台 =================
    const ap = await browser.newPage({ viewport: { width: 1440, height: 950 } }); watch(ap, 'admin');
    await ap.goto(BASE + '/admin/'); await ap.fill('input[type=text],input:not([type])', '15152099970'); await ap.fill('input[type=password]', '123456'); await ap.keyboard.press('Enter'); await ap.waitForTimeout(1500);

    // ---- B3：选项 ----
    const opt = await ap.evaluate(() => [optText('甲'), optText({ label: 'A', text: 'T' }), optText({ label: 'B', content: 'C' }), optText(null), optDisplay({ label: 'B', content: 'C' }), optDisplay({ label: 'A', text: 'A. 已带' }), optLabel({ label: 'C' }, 0), optLabel('x', 2)]);
    log(JSON.stringify(opt) === JSON.stringify(['甲', 'T', 'C', '', 'B. C', 'A. 已带', 'C', 'C']), 'B3 公共选项归一函数 optText / optDisplay / optLabel：字符串、{label,text}、{label,content} 都正确', JSON.stringify(opt));
    await ap.evaluate(() => { ADM.page.mfq = { kw: 'R0浏览器测试 选项', stage: 'primary', subject: '数学', pmode: 'knowledge' }; ADM.page.mfqPage = 1; location.hash = '#/mfq'; if (typeof render === 'function') render(); });
    await ap.waitForSelector('.r3-qcard', { timeout: 8000 }); await ap.waitForTimeout(600);
    const listTxt = await ap.$eval('.r3-bank', (e) => e.innerText);
    log(!listTxt.includes('[object Object]') && ['字符串甲', '文本乙', '内容甲', '内容乙'].every((t) => listTxt.includes(t)), 'B3 题库管理列表：三种格式的选项都显示成文字，没有 [object Object]', (listTxt.match(/\[object Object\]/g) || []).length + ' 处 [object Object]');
    const idC = db.prepare("SELECT id FROM questions WHERE stem=?").get(TAG + ' 选项labelcontent ' + uniq).id;
    await ap.evaluate((i) => mfQEdit(i, () => {}), idC); await ap.waitForSelector('#qeOpts', { timeout: 5000 });
    const eo = await ap.inputValue('#qeOpts');
    log(!eo.includes('[object Object]') && eo.includes('内容甲') && eo.includes('内容乙'), 'B3 编辑弹窗里的选项框同样正常', eo.replace(/\n/g, ' / '));
    await ap.evaluate(() => { const w = document.querySelector('.el-dialog__wrapper, .modal-mask, .el-dialog'); const x = document.querySelector('#mCancel, .el-dialog__headerbtn'); if (x) x.click(); });
    await ap.waitForTimeout(300);

    // ---- B9：后台题库管理里题图也能显示 ----
    await ap.evaluate(() => { ADM.page.mfq = { kw: 'R0浏览器测试 看图', stage: 'junior', subject: '数学', pmode: 'knowledge' }; ADM.page.mfqPage = 1; render(); });
    await ap.waitForTimeout(1200);
    const adminImgs = await ap.$$eval('.r3-qcard img', (a) => a.map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') })));
    // 题干是纯文本 + [图N] 时后台列表不渲染图；用编辑弹窗里的图片预览确认地址可取
    const urlsForAdmin = await ap.evaluate(async (id) => { const r = await api(`/api/admin/bank/mf/questions/${id}`); return (r.question || r).images; }, qImg);
    const fetched = await Promise.all(urlsForAdmin.map(async (u) => (await fetch(BASE + u)).status));
    log(urlsForAdmin.length === 2 && fetched.every((s) => s === 200), 'B9 后台取到的题图地址（带只读票据）直接可取，不需要登录头', JSON.stringify(fetched) + (adminImgs.length ? ` 列表内 ${adminImgs.length} 张图` : ''));

    // ---- B6：树行 / 选中键悬停 ----
    await ap.evaluate(() => { ADM.page.mfq = { stage: 'primary', subject: '数学', pmode: 'knowledge' }; ADM.page.mfqPage = 1; render(); });
    await ap.waitForSelector('.r3-tn', { timeout: 8000 });
    await ap.evaluate(() => { document.querySelector('.r3-tn button.r3-tn-car:not(.leaf)') && document.querySelector('.r3-tn button.r3-tn-car:not(.leaf)').click(); });
    await ap.waitForTimeout(500);
    const tw = await ap.$$eval('.r3-tn button.r3-tn-car', (a) => a.slice(0, 5).map((x) => ({ w: x.getBoundingClientRect().width, grow: getComputedStyle(x).flexGrow })));
    log(tw.length > 0 && tw.every((x) => x.grow === '0' && x.w >= 16 && x.w <= 32), 'B6 树行的折叠箭头不再被 flex:1 撑满（固定点击区域，flex-grow 0）', JSON.stringify(tw[0]));
    const nameW = await ap.$eval('.r3-tn .r3-tn-name', (a) => ({ grow: getComputedStyle(a).flexGrow }));
    log(nameW.grow === '1', 'B6 节点名称仍然占满剩余宽度');
    await ap.hover('[data-kind="knowledge"].on'); await ap.waitForTimeout(250);
    const hv = await ap.$eval('[data-kind="knowledge"].on', (b) => ({ c: getComputedStyle(b).color, bg: getComputedStyle(b.parentElement).backgroundColor }));
    log(hv.c !== hv.bg && hv.bg !== 'rgba(0, 0, 0, 0)', 'B6 选中的「知识点」切换键悬停时保持可辨认的前景和背景', JSON.stringify(hv));

    // ---- B8：待审核单题入库弹分类框 ----
    const pending = (await req(MF + '/ext/pending?kw=' + encodeURIComponent(TAG + '待审核'), { token: AT })).data.list.find(it => it.kind === 'run' && Number(it.batch_id) === Number(runId));
    log(!!pending && !pending.content_review_pending && !pending.type_unconfirmed && !pending.figure_review_issue && !pending.ai_legacy_pending && !(pending.ai_review_pending_fields || []).length,
      'B8 规则夹具没有待核对 AI / 题面 / 图片内容，入库仍须人工确认分类');
    if (!pending) throw new Error('未找到 B8 专属待审核夹具');
    await ap.evaluate(id => { ADM.page.pd = { source: 'all', kw: 'R0浏览器测试待审核', sel: {}, active: id }; ADM.page.pdPage = 1; location.hash = '#/pending'; render(); }, pending.id);
    await ap.waitForSelector('#pd-current-commit', { timeout: 8000 });
    log(await ap.locator('#pd-current-commit').isEnabled(), 'B8 当前题目通过审核门控后才启用「核对并入库」');
    await ap.click('#pd-current-commit');
    await ap.waitForSelector('#pdB-sub', { timeout: 4000 });
    const dlgTxt = await ap.$eval('.el-dialog', (e) => e.innerText);
    const hasTree = await ap.$$eval('#pdB-stage, #pdB-grade, #pdB-ktree, #pdB-ctree', (a) => a.length);
    log(hasTree === 4 && /入库这道题/.test(dlgTxt), 'B8 点单题「入库」弹出分类框：学科 / 学段 / 年级 / 知识点树节点 / 章节树节点');
    await ap.click('#mOk'); await ap.waitForTimeout(500);
    log(await ap.$('#pdB-sub') !== null && /请先选择学科/.test(await ap.evaluate(() => document.body.innerText)), 'B8 学科没选：提示并留在弹窗里，不能入库');
    await ap.selectOption('#pdB-sub', '数学'); await ap.click('#mOk'); await ap.waitForTimeout(500);
    log(await ap.$('#pdB-sub') !== null && /请先选择学段/.test(await ap.evaluate(() => document.body.innerText)), 'B8 学段没选：同样不能入库');
    await ap.selectOption('#pdB-stage', 'junior'); await ap.click('#mOk'); await ap.waitForTimeout(1200);
    const inLib = db.prepare('SELECT subject, stage FROM questions WHERE stem=?').get(TAG + '待审核甲' + uniq);
    log(inLib && inLib.subject === '数学' && inLib.stage === 'junior' && await ap.$('#pdB-sub') === null, 'B8 选好学科学段后入库成功', JSON.stringify(inLib));

    // ---- B5：代理 iframe 去掉 allow-same-origin ----
    await ap.evaluate((u) => { ADM.page.mfc = { tab: 'browser', url: u, hist: [], hi: 0 }; location.hash = '#/mfc'; render(); }, BASE + '/upload.html');
    await ap.waitForSelector('#mfFrame', { timeout: 8000 });
    const sb = await ap.$eval('#mfFrame', (f) => f.getAttribute('sandbox'));
    log(/allow-scripts/.test(sb) && !/allow-same-origin/.test(sb), 'B5 代理 iframe 的 sandbox 不含 allow-same-origin', sb);
    await ap.evaluate(()=>{document.querySelector('#mfFrame').src='about:blank';document.querySelector('#mfFrame').srcdoc='<html><body><p id="sandbox-test">合成题目页</p></body></html>';});
    const frameHandle=await ap.$('#mfFrame');const fr=await frameHandle.contentFrame();await fr.waitForSelector('#sandbox-test');
    const probe=await fr.evaluate(()=>{const r={};for(const [key,fn] of Object.entries({ls:()=>localStorage.getItem('xuexi_admin_token'),pd:()=>parent.document.title,pls:()=>parent.localStorage.getItem('xuexi_admin_token'),top:()=>top.location.href})){try{r[key]=fn()}catch(e){r[key]='ERR:'+e.name}}r.origin=window.origin;return r;});
    log(['ls','pd','pls','top'].every(k=>!probe[k] || /^ERR:SecurityError/.test(probe[k])), 'B5 真实 sandbox 中无法读取本页及后台令牌、父页面或顶层地址',JSON.stringify(probe));
    log(probe.origin==='null','B5 iframe 为不透明源');
    const capture=(await req(MF+'/capture/token',{token:AT})).data.token;
    const receiptKey=require('crypto').randomUUID();const captureBody={site:'generic',title:TAG,url:BASE+'/upload.html',questions:[{stem:TAG+'合成回传',type:'fill',answer:''}]};
    const results=await fr.evaluate(async({base,token,body,key})=>{const send=()=>fetch(base+'/api/mfcap/push',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Intake-Key':key},body:JSON.stringify(body)}).then(r=>r.json());return [await send(),await send()]},{base:BASE,token:capture,body:captureBody,key:receiptKey});const pushed=results[0];
    log(pushed.code===0 && results[1].data?.id===pushed.data.id && results[1].data.recovered,'书签 CORS 响应丢失后原凭据重发不重复');
    const fallback=await fetch(BASE+MF+'/capture/batches',{method:'POST',headers:{Authorization:'Bearer '+AT,'Content-Type':'application/json','X-Intake-Key':receiptKey},body:JSON.stringify(captureBody)}).then(r=>r.json());
    log(fallback.code===0 && fallback.data.id===pushed.data.id && fallback.data.recovered,'书签转后台接收沿用同一凭据，不生成第二批');
    log(pushed.code===0 && pushed.data.count===1,'B1/B5 Origin:null 的真实 CORS 回传使用独立票据成功，题目进入待审核',pushed.msg);
    log(errs.length === 0, '页面没有脚本报错', errs.join(' ; '));
    await ap.close();
  } catch (e) { log(false, '浏览器检查异常', e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message); }
  await browser.close();

  // 回传测试留下的采集批次也清掉
  db.prepare('DELETE FROM mf_capture_batches WHERE title=? AND url=?').run(TAG,BASE+'/upload.html');
  cleanup();
  const left = db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE '${TAG}%'`).get().n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 'r0s%'").get().n;
  log(Number(left) === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
