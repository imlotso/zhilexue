'use strict';
/**
 * 单词页固定布局（T13）自测： node words-layout-test.js
 * 需先启动服务（默认 http://localhost:3000）。用真实浏览器（Playwright）量布局，所以 CI 里没有浏览器时会提示并跳过（退出码 0）。
 * 做法：造一本"极端长短单词"的词书（a / extraordinarily / I / telecommunications / be responsible for … 释义从 1 个字到 40 个字），
 *       进入学习舞台，走完「单词学习 / 记忆学习 / 听音拼选 / 默写练习」四步，每一帧都量：
 *       学习卡片的高度、卡片里各区域（标签 / 单词 / 音标 / 释义 / 提示 / 选项 / 格子）相对卡片顶部的位置，
 *       以及卡片下面按钮的位置。验收：同一步同一阶段里，这些数值都只有一个取值；卡片内容不溢出（没有内部滚动条）。
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('本机没有 Playwright，跳过单词页布局测试（需要真实浏览器量布局）'); process.exit(0); }
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const now = '2026-11-02 00:00:00';
const uniq = Date.now().toString().slice(-8);
const BOOK = 'T13测试词书' + uniq, USER = 't13s' + uniq;
const WORDS = [
  ['a', '/eɪ/', 'art.', '一个'],
  ['extraordinarily', '/ɪkˈstrɔːdnrəli/', 'adv.', '非凡地；特别地；格外地；极端地；异乎寻常地；令人惊异地；出奇地；不可思议地'],
  ['I', '/aɪ/', 'pron.', '我'],
  ['telecommunications', '/ˌtelɪkəˌmjuːnɪˈkeɪʃnz/', 'n.', '电信；远程通信；电信学；电讯业'],
  ['up', '/ʌp/', 'adv.', '向上'],
  ['responsibilities', '/rɪˌspɒnsəˈbɪlətiz/', 'n.', '责任；职责；义务；负担；责任感；应尽的本分；担当'],
  ['go', '/ɡəʊ/', 'v.', '去；走'],
  ['be responsible for', '', '', '对……负责；是……的原因；负担……的责任'],
];
let bookId = 0, userId = 0;
function setup() {
  bookId = db.prepare("INSERT INTO word_books (title,grade,kind,sort,remark,created_at) VALUES (?, '七年级','word',1,'',?)").run(BOOK, now).lastInsertRowid;
  WORDS.forEach(([w, p, pos, m]) => db.prepare('INSERT INTO words (book_id,unit,word,phonetic,pos,meaning,example,created_at) VALUES (?,?,?,?,?,?,?,?)').run(bookId, 'Unit 1', w, p, pos, m, '', now));
  userId = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'T13学生','七年级','上册',1,1,'2099-12-31',1,?)").run(USER, hash('123456'), now).lastInsertRowid;
}
function cleanup() {
  if (bookId) { ['words', 'word_sentences', 'word_phrases'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE book_id=?`).run(bookId); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM word_books WHERE id=?').run(bookId); }
  if (userId) { ['word_records', 'word_group_done'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE student_id=?`).run(userId); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM users WHERE id=?').run(userId); }
}

const KEYS = ['.wt-tag', '.wq-word', '.wq-phon', '.wq-mean', '.wq-title', '.wt-options', '.wq-ls-slots', '.wq-ls-tiles', '.wt-input'];
async function walk(page, step, frames, tierBtn) {
  await page.evaluate((k) => { WT.quick.maxStep = 3; wtGoto(k); }, step);
  await page.waitForTimeout(500);
  const rows = [];
  for (let it = 0; it < frames; it++) {
    const info = await page.evaluate((KEYS) => {
      const c = document.querySelector('.wt-card'); if (!c) return null;
      const cr = c.getBoundingClientRect();
      const o = { cardH: Math.round(cr.height), ovf: c.scrollHeight - c.clientHeight, phase: [document.querySelector('#wqNo') ? 'ask' : '', document.querySelector('.wt-opt') ? 'quiz' : '', document.querySelector('#wqNext') ? 'learn' : ''].join('') };
      const btn = document.querySelector('.wt-card + .wt-acts .btn, .wt-card ~ .wt-acts .btn'); if (btn) o.btn = Math.round(btn.getBoundingClientRect().top - cr.top);
      KEYS.forEach((k) => { const e = document.querySelector('.wt-card ' + k); if (e && getComputedStyle(e).display !== 'none') o[k] = Math.round(e.getBoundingClientRect().top - cr.top); });
      o.word = ((document.querySelector('.wq-word') || document.querySelector('.wq-mean') || {}).textContent || '').trim().slice(0, 20);
      return o;
    }, KEYS);
    if (info) rows.push(info);
    const acted = await page.evaluate(() => {
      const c = (s) => { const e = document.querySelector(s); if (e && !e.disabled && e.offsetParent !== null) { e.click(); return s; } return ''; };
      let r = c('#wqYes') || c('#wtNext') || c('#wtNextGrp'); if (r) return r;
      const inp = document.querySelector('#wsInput'); if (inp) { inp.value = 'zzz'; inp.dispatchEvent(new Event('input', { bubbles: true })); const ok = document.querySelector('#wsOk'); if (ok) { ok.click(); return 'spell'; } }
      const tl = [...document.querySelectorAll('.wq-ls-tile:not(.used):not([disabled])')]; if (tl.length) { tl[0].click(); return 'tile'; }
      const opt = document.querySelector('.wt-opt:not([disabled])'); if (opt) { opt.click(); return 'opt'; }
      r = c('#wqNext') || c('#wsNext'); if (r) return r;
      const b = [...document.querySelectorAll('.wt-acts .btn')].find((x) => x.offsetParent !== null && !x.disabled); if (b) { b.click(); return 'acts'; }
      return '';
    });
    await page.waitForTimeout(acted === 'spell' ? 450 : 230);
  }
  return rows;
}
const distinct = (rows, f) => [...new Set(rows.map(f).filter((v) => v !== undefined))];

(async () => {
  console.log('\n=== 单词页固定布局（T13）· 自测 ===\n');
  setup();
  let browser;
  try {
    try { browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] }); } catch (e) { console.log('本机没有可用的浏览器，跳过：' + e.message.split('\n')[0]); cleanup(); process.exit(0); }
    for (const tier of ['大', '小']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(BASE + '/'); await page.waitForTimeout(600);
      await page.fill('input[type=text],input[type=tel],input:not([type])', USER); await page.fill('input[type=password]', '123456'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
      await page.goto(BASE + '/#/words/quick'); await page.waitForTimeout(2500);
      await page.selectOption('#wtBook', String(bookId)).catch(() => {}); await page.waitForTimeout(800);
      await page.click('.wt-uchip[data-wu="Unit 1"]'); await page.waitForTimeout(900); await page.click('.wt-grp'); await page.waitForTimeout(1400);
      await page.click(`.wt-stage-fs button:has-text("${tier}")`); await page.waitForTimeout(400);
      const labels = { read: '① 单词学习', memorize: '② 记忆学习', match: '③ 听音拼选', spell: '④ 默写练习' };
      for (const step of ['read', 'memorize', 'match', 'spell']) {
        const rows = await walk(page, step, step === 'read' ? 8 : 26, tier);
        const words = distinct(rows, (r) => r.word);
        const sampled = rows.length >= 6;
        log(sampled, `字号「${tier}」${labels[step]}：采集到 ${rows.length} 帧，覆盖 ${words.length} 个不同的词（含 1 字母和 18 字符的短语）`);
        log(distinct(rows, (r) => r.cardH).length === 1, `字号「${tier}」${labels[step]}：学习卡片高度始终不变`, distinct(rows, (r) => r.cardH).join('/'));
        const phases = distinct(rows, (r) => r.phase);
        let ok = true; const bad = [];
        phases.forEach((ph) => {
          const rs = rows.filter((r) => r.phase === ph);
          KEYS.concat(['btn']).forEach((k) => { const d = distinct(rs, (r) => r[k]); if (d.length > 1) { ok = false; bad.push(`${ph || '-'}:${k}=${d.join('/')}`); } });
        });
        log(ok, `字号「${tier}」${labels[step]}：同一阶段里标签 / 单词 / 音标 / 释义 / 提示 / 选项 / 格子 / 按钮的位置都不动（长短单词、有无音标、释义长短）`, bad.join(' '));
        log(Math.max(...rows.map((r) => r.ovf)) <= 1, `字号「${tier}」${labels[step]}：内容都放得进卡片（没有内部滚动条）`, 'overflow=' + Math.max(...rows.map((r) => r.ovf)));
      }
      log(errs.length === 0, `字号「${tier}」：页面没有脚本错误`, errs.join('；'));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
