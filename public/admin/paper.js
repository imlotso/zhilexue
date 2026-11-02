/* 管理端·纸质化生成（词书管理页）：单词/短语/句子三合一入口。
   渲染引擎与学生端 words.js 同源拷贝（wpMeasureHeights/wpPackPages/wtPaperPages/WP_SHEET_CSS），
   数据走 /api/admin/word/*，AI 拆解与 PDF 导出走 /api/admin/paper/*。
   由 _test_local/build_paper.js 从 words.js 自动拼装，改学生端引擎后重跑构建即可同步。 */
(function(){
'use strict';
const WP_QUOTES = [
  '每天进步一点点，成功离你近一点！',
  '单词是英语的砖瓦，积累成就高度。',
  '今天多背一个词，明天考试少丢一分。',
  '坚持的记忆，才最深刻。',
  '你现在学的每一样本领，都会在未来发光。',
  '不怕慢，就怕站；背词路上不停步。',
  '一笔一划写单词，一心一意赢未来。',
  '少年辛苦终身事，莫向光阴惰寸功。',
  '今天的汗水，是明天的光芒。',
  '每背会一个词，就推开一扇小小的门。',
];
const WP_SHEET_CSS = `
.wt-paper-sheet{width:794px;max-width:100%;height:1123px;margin:0 auto;background:#fff;color:#1e3a5f;font-family:"Microsoft YaHei","PingFang SC",sans-serif;padding:32px 36px 24px;box-sizing:border-box;border:1px solid #dbe7f5;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;line-height:1.6}
.wp-quote{flex:none;font-size:13px;color:#4a7ec9;font-style:italic;letter-spacing:.5px;line-height:1.8;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wp-head{text-align:center;margin:-8px 0 4px}
.wp-title{font-size:30px;font-weight:800;color:#1d4ed8;letter-spacing:8px;line-height:1.5}
.wp-title .pen{font-size:24px;letter-spacing:0}
.wp-range{color:#64748b;font-size:14px;margin-top:8px;letter-spacing:1px;line-height:1.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wp-info{display:flex;gap:26px;font-size:15px;color:#33445c;margin:18px 0 14px;flex-wrap:wrap;line-height:1.8}
.wp-info b{color:#1d4ed8}
.wp-tables{display:flex;gap:14px}
.wp-half{flex:1;min-width:0}
.wp-tbl{border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed}
.wp-tbl th{background:#2f6bff;color:#fff;padding:8px 6px;border:1px solid #2f6bff;font-weight:600;text-align:center}
.wp-tbl td{border:1px solid #c9d9f2;padding:6px 8px;height:30px;line-height:30px;color:#1e3a5f;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wp-tbl td.num{width:28px;text-align:center;color:#64748b;background:#f4f8ff;padding:6px 2px}
.wp-tbl td.ans{background:#fbfdff}
.wp-tbl td.fill{white-space:normal;word-break:break-word;height:auto;line-height:1.5;padding:7px 9px}
.wp-tbl td.fill .tr0{color:#1e3a5f;font-weight:600;font-size:12.5px;margin-bottom:6px}
.wp-tbl td.fill .bxrow{display:flex;align-items:flex-end;gap:5px}
.wp-tbl td.fill .bx{flex:1;min-width:0}
.wp-tbl td.fill .bx i{display:block;font-style:normal;font-size:10.5px;color:#8899aa;margin-bottom:2px;white-space:nowrap}
.wp-tbl td.fill .bx .wbox,.wp-tbl td.fill .bx .sbox{display:block;border:1.5px solid #9dbcf0;border-radius:6px;background:#fbfdff;height:30px}
.wp-tbl td.fill .bx .sbox .hint{display:block;text-align:center;line-height:27px;font-weight:400;font-size:12px;color:#b3c4dc;letter-spacing:1px}
.wp-tbl td .sk{color:#b3c4dc;font-size:11.5px;letter-spacing:2px;margin-top:2px}
.wp-tbl td.fill .bx.sb{flex:0 0 112px}
.wp-tbl td.fill .lead{flex:0 0 14px;border-top:2px dashed #b7cdf0;margin-bottom:15px}
.wp-legend{margin:-6px 0 10px;font-size:12.5px;color:#64748b;background:#f4f8ff;border-radius:6px;padding:5px 10px}
.wp-fix{flex:none;height:165px;margin-top:14px;border:1.5px dashed #9dbcf0;border-radius:8px;background:#fbfdff;position:relative}
.wp-fix span{position:absolute;top:8px;left:12px;font-size:13px;color:#64748b;letter-spacing:1px}
/* 句子单栏版式（参照句子成分图） */
.wp-body{flex:1;min-height:0}
.sq{padding:6px 2px 9px;border-bottom:1px dashed #dbe7f5}
.sq-no{color:#1d4ed8;font-size:16px;flex:none}
.sq-l1{display:flex;align-items:center;gap:10px}
/* 成分图：片段框 + 成分名标注框上方 + 短线连接 */
.sq-in{display:flex;align-items:center;gap:10px}
.sq-d{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:flex-end;column-gap:8px;row-gap:8px}
.sq-col{display:flex;flex-direction:column;align-items:center}
.sq-lab{height:18px;line-height:18px;font-size:13px;font-weight:700;white-space:nowrap}
.sq-labb{width:102px;height:21px;border:1.5px dashed #9dbcf0;border-radius:5px;background:#fbfdff;box-sizing:border-box}
.sq-tick{width:2px;height:10px;background:#c9d9f2}
.sq-box{min-height:32px;border:1.5px solid #9dbcf0;border-radius:7px;background:#fbfdff;padding:3px 11px;font-size:15px;font-weight:600;color:#1e3a5f;display:flex;align-items:center;white-space:nowrap;box-sizing:border-box}
.sq-box.b{min-width:122px;background:#f6faff}
.sq-side{flex:none;width:150px;font-size:13px;color:#475569;line-height:1.5}
.sq-tr{margin-top:4px;color:#4a7ec9;font-style:italic}
.sq-blank{display:inline-block;width:110px;height:30px;border:1.5px solid #9dbcf0;border-radius:6px;background:#fbfdff;vertical-align:middle;margin:0 6px}
.sq-stx{flex:none;font-size:13px;color:#8899aa;white-space:nowrap}
.sq-stx b{color:#4a7ec9;font-weight:600}
.sq-l2{display:flex;align-items:center;gap:10px;margin-top:7px;font-size:13px;color:#475569}
.sq-sb{display:inline-block;width:170px;height:28px;border:1.5px dashed #9dbcf0;border-radius:6px;background:#fbfdff}
.sq-l3{margin-top:7px;font-size:13px;color:#4a7ec9;font-style:italic}
.sq.qw{padding-bottom:14px}
.sq-cn{flex:1;min-width:0;font-size:15px;color:#1e3a5f;font-weight:600}
.sq-wl{height:36px;border-bottom:1.5px solid #9dbcf0;margin-top:8px}
@media print{
  @page{size:A4;margin:0}
  body{margin:0;background:#fff}
  .wt-paper-sheet{width:793px;height:1121px;border:none;border-radius:0;page-break-after:always}
  .wt-paper-sheet:last-child{page-break-after:auto}
}`;
function wtStructNorm(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() ? { whole: v.trim(), parts: null } : null;
  const parts = (Array.isArray(v.parts) ? v.parts : [])
    .map((p) => ({ t: String((p && p.t) || '').trim(), s: String((p && p.s) || '').trim() }))
    .filter((p) => p.t);
  const whole = String(v.whole || '').trim();
  if (!whole && !parts.length) return null;
  return { whole, parts: parts.length ? parts : null };
}

/* 逃逸 + 逐题测高 + 贪心装箱（与学生端一致） */
function wpEsc(s) { return esc(String(s == null ? '' : s)); }
function wpMeasureHeights(htmls) {
  if (typeof document === 'undefined') return htmls.map(() => 92);
  let st = document.getElementById('wpSheetMeasureStyle');
  if (!st) {
    st = document.createElement('style');
    st.id = 'wpSheetMeasureStyle';
    st.textContent = WP_SHEET_CSS;
    document.head.appendChild(st);
  }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:722px;background:#fff';
  holder.innerHTML = htmls.map((h) => `<div>${h}</div>`).join('');
  document.body.appendChild(holder);
  const hs = [...holder.children].map((el) => el.getBoundingClientRect().height);
  holder.remove();
  return hs;
}
function wpPackPages(heights, budget, fixH) {
  const groups = [];
  let cur = [], sum = 0;
  heights.forEach((h, i) => {
    if (cur.length && sum + h > budget) { groups.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += h;
  });
  if (cur.length) groups.push(cur);
  const sumOf = (idxs) => idxs.reduce((a, i) => a + (heights[i] || 0), 0);
  let overflow = [];
  while (groups.length) {
    const last = groups[groups.length - 1];
    if (sumOf(last) <= budget - fixH + 30) break;   // +30px 容差：订正区贴底留少量空隙即可
    if (last.length > 1) overflow.unshift(last.pop());
    else if (groups.length > 1) { overflow.unshift(last.pop()); groups.pop(); }
    else break;   // 单页单题仍超：极端长句，随它（订正区贴底压缩题区）
  }
  if (overflow.length) groups.push(overflow);
  return groups;
}
function wtPaperPages(cfg) {
  const isSent = cfg.kind === 'sent';
  const isPhrase = cfg.kind === 'phrase';
  const kindName = isSent ? '句子' : isPhrase ? '短语' : '单词';
  const modeTxt = isSent
    ? ({ fill: '补充单词组合', whole: '默写整句' }[cfg.mode] || '')
    : { e2c: '英译中 · 看英文写中文', c2e: '中译英 · 看中文写英文', pm: '提示默写 · 首字母提示', ph: '看音标写单词' }[cfg.mode] || '';
  /* ---- 句子版式（单栏，参照句子成分图）：每个成分片段一个框、成分名标注在框上方用短线连接；
      挖空片段=单词框和成分名框都留空待填；整句翻译放右侧；默写整句=中文意思+两条默写横线 ---- */
  if (isSent) {
    /** 成分名配色（循环取色，仿成分图多色标注） */
    const LAB_COLORS = ['#d83931', '#2f9e44', '#3b7ad9', '#d97a16', '#9333ea', '#0e9aa7', '#c2418f'];
    /** 词级挖空：逐词成框（成分名留空），优先挖相邻两词词组；用于无 AI 拆解或整句单片段的句子 */
    const wordLevelHtml = (text) => {
      const words = String(text).trim().split(/\s+/);
      const idxs = words.map((w, i) => i).filter((i) => /[A-Za-z]{2,}/.test(words[i] || ''));
      let hi = -1;
      if (words.length >= 6) {
        const pairs = idxs.filter((i) => idxs.includes(i + 1));
        if (pairs.length) hi = pairs[Math.floor(Math.random() * pairs.length)];
      }
      if (hi < 0) hi = idxs.length ? idxs[Math.floor(Math.random() * idxs.length)] : -1;
      const two = hi >= 0 && words.length >= 6 && idxs.includes(hi + 1);
      return words.map((w, i) => {
        const color = LAB_COLORS[i % LAB_COLORS.length];
        if (i === hi) return `<div class="sq-col"><div class="sq-labb"></div><div class="sq-tick"></div><div class="sq-box b"></div></div>`;
        if (two && i === hi + 1) return '';
        return `<div class="sq-col"><div class="sq-lab" style="color:${color}"></div><div class="sq-tick" style="background:${color}"></div><div class="sq-box">${wpEsc(w)}</div></div>`;
      }).join('');
    };
    /** 生成一题的「成分图」：优先用 AI parts 拆解（挖空其中一个片段），单片段/无拆解退回词级挖空 */
    const diagramHtml = (x) => {
      const st = wtStructNorm(cfg.structs && cfg.structs[x.text]);
      let parts = st && st.parts ? st.parts.filter((p) => p.t) : null;
      if (parts) {   // 拆解合理性校验：片段拼接须覆盖原句大部分字符，否则视为不可信
        const cover = parts.map((p) => p.t).join(' ').replace(/\s+/g, '').length;
        const orig = String(x.text).replace(/\s+/g, '').length;
        if (cover < orig * 0.6) parts = null;
      }
      if (parts && parts.length > 1) {
        // 挖空目标：优先≥2词的片段（词组），否则任意含字母的片段
        const cand = parts.map((p, i) => ({ p, i })).filter((o) => /[A-Za-z]/.test(o.p.t));
        const pref = cand.filter((o) => o.p.t.trim().split(/\s+/).length >= 2);
        const pool = pref.length ? pref : cand;
        const bi = pool.length ? pool[Math.floor(Math.random() * pool.length)].i : -1;
        if (bi >= 0) return { html: parts.map((p, i) => {
          const color = LAB_COLORS[i % LAB_COLORS.length];
          if (i === bi) return `<div class="sq-col"><div class="sq-labb"></div><div class="sq-tick"></div><div class="sq-box b"></div></div>`;
          return `<div class="sq-col"><div class="sq-lab" style="color:${color}">${wpEsc(p.s || '')}</div><div class="sq-tick" style="background:${color}"></div><div class="sq-box">${wpEsc(p.t)}</div></div>`;
        }).join(''), st };
      }
      return { html: wordLevelHtml(x.text), st };
    };
    const itemHtml = (x, no) => {
      if (cfg.mode === 'fill') {
        const d = diagramHtml(x);
        return `<div class="sq">
      <div class="sq-in"><b class="sq-no">${no}.</b>
      <div class="sq-d">${d.html}</div>
      <div class="sq-side"><div class="sq-stx">句子结构：<b>${d.st && d.st.whole ? wpEsc(d.st.whole) : '____________'}</b></div>${cfg.trans ? `<div class="sq-tr">${wpEsc(x.translation || '—')}</div>` : ''}</div>
      </div>
    </div>`;
      }
      const stw = wtStructNorm(cfg.structs && cfg.structs[x.text]);
      return `<div class="sq qw">
      <div class="sq-l1"><b class="sq-no">${no}.</b><span class="sq-cn">${wpEsc(x.translation || '—')}</span><span class="sq-stx">句子结构：<b>${stw && stw.whole ? wpEsc(stw.whole) : '____________'}</b></span></div>
      <div class="sq-wl"></div><div class="sq-wl"></div>
    </div>`;
    };
    const range = [cfg.bookTitle, cfg.unit || '全部单元', cfg.grp || '全部课文'].filter(Boolean).join(' · ');
    /* 动态装箱：逐题量高后贪心塞满每页（不固定题数），订正区只上最后一页 */
    const htmls = cfg.items.map((x, i) => itemHtml(x, i + 1));
    const hs = wpMeasureHeights(htmls);
    const BUDGET = 858;                       // 每页题区可用高度（版面 1067 - 语录/标题/信息行/说明 ≈ 200）
    const FIX_H = 180;                        // 末页订正区（165 + 边距）
    const groups = wpPackPages(hs, BUDGET, FIX_H);
    const pages = groups.map((idxs, pi) => {
      const isLast = pi === groups.length - 1;
      const quote = WP_QUOTES[(pi + Math.floor(Math.random() * WP_QUOTES.length)) % WP_QUOTES.length];
      return `<div class="wt-paper-sheet">
    <div class="wp-quote">✧ ${wpEsc(quote)}</div>
    <div class="wp-head">
      <div class="wp-title">${kindName}默写表 <span class="pen">✏️</span></div>
      <div class="wp-range">${wpEsc(range)}${modeTxt ? ` · ${modeTxt}` : ''}</div>
    </div>
    <div class="wp-info"><span>姓名：______________</span><span>日期：______________</span><span>正确率：<b>________</b> / ${cfg.items.length}（________%）</span></div>
    ${cfg.mode === 'fill' ? '<div class="wp-legend">✎ 空白框填入挖掉的单词或词组，其上方的虚线小框写出对应的句子成分名称（如：主语 / 谓语 / 宾语 / 定语 / 状语 等）；右侧为整句结构参考与翻译，写完可对照检查</div>' : ''}
    <div class="wp-body">${idxs.map((i) => htmls[i]).join('')}</div>
    ${isLast ? '<div class="wp-fix"><span>订正区：</span></div>' : ''}
  </div>`;
    });
    return { pages, total: cfg.items.length };
  }
  /* ---- 单词 / 短语版式 ---- */
  const cols = cfg.mode === 'e2c' ? ['序号', isPhrase ? '短语' : '单词', '词性', '默写中文']
    : cfg.mode === 'c2e' ? ['序号', '中文意思', '词性', isPhrase ? '默写短语' : '默写单词']
    : cfg.mode === 'pm' ? ['序号', '中文意思（附首字母提示）', '默写短语']
    : ['序号', '音标', '词性', '默写单词'];
  /** 首字母骨架提示：get up → g__ up（保留词间空格与标点） */
  const wpSkeleton = (p) => String(p || '').trim().split(/\s+/)
    .map((w) => w.replace(/[A-Za-z]/g, (ch, i) => (i === 0 ? ch : '_'))).join(' ');
  const hasPos = cfg.items.some((x) => (x.pos || x.attr || '').trim());
  if (!hasPos && cfg.mode !== 'pm') cols.splice(2, 1);   // 整本没有词性数据 → 隐藏词性列（提示默写本就无词性列），留白给内容列
  const FULL_ROWS = 19;             // 非末页每栏行数（无订正区，排满 38 词/页）
  const LAST_ROWS = 15;             // 末页每栏行数（底部留订正区）
  const rowCell = (x) => {
    const posTd = hasPos ? `<td>${wpEsc(x.pos || x.attr || '')}</td>` : '';
    if (cfg.mode === 'e2c') return `<td>${wpEsc(x.word)}</td>${posTd}<td class="ans"></td>`;
    if (cfg.mode === 'c2e') return `<td>${wpEsc(x.meaning)}</td>${posTd}<td class="ans"></td>`;
    if (cfg.mode === 'pm') return `<td>${wpEsc(x.meaning)}<div class="sk">${wpEsc(wpSkeleton(x.word || x.phrase))}</div></td><td class="ans"></td>`;
    return `<td>${wpEsc(x.phonetic || '—')}</td>${posTd}<td class="ans"></td>`;
  };
  const tableHtml = (list, startNo) => `
    <div class="wp-half"><table class="wp-tbl">
      <thead><tr>${cols.map((c, i) => `<th${i === 0 ? ' style="width:28px"' : ''}>${c}</th>`).join('')}</tr></thead>
      <tbody>${list.map((x, i) => `<tr><td class="num">${startNo + i}</td>${rowCell(x)}</tr>`).join('')}</tbody>
    </table></div>`;
  const range = [cfg.bookTitle, cfg.unit || '全部单元'].filter(Boolean).join(' · ');
  /* 满页按 FULL_ROWS 分页；末页只留 LAST_ROWS 行（底部订正区），超出的顺延成新末页 */
  const chunks = [];
  for (let s = 0; s < cfg.items.length; s += FULL_ROWS * 2) chunks.push(cfg.items.slice(s, s + FULL_ROWS * 2));
  if (!chunks.length) chunks.push([]);
  while (chunks.length > 1 && chunks[chunks.length - 1].length > LAST_ROWS * 2) {
    const last = chunks[chunks.length - 1];
    const excess = last.splice(LAST_ROWS * 2);
    chunks.push(excess);
  }
  let no = 0;
  const pages = chunks.map((chunk, pi) => {
    const isLast = pi === chunks.length - 1;
    const nL = Math.ceil(chunk.length / 2);
    const left = chunk.slice(0, nL), right = chunk.slice(nL);
    const quote = WP_QUOTES[(pi + Math.floor(Math.random() * WP_QUOTES.length)) % WP_QUOTES.length];
    const startL = no + 1; no += left.length;
    const startR = no + 1; no += right.length;
    return `<div class="wt-paper-sheet">
    <div class="wp-quote">✧ ${wpEsc(quote)}</div>
    <div class="wp-head">
      <div class="wp-title">${kindName}默写表 <span class="pen">✏️</span></div>
      <div class="wp-range">${wpEsc(range)}${cfg.mode === 'ph' ? '' : ` · ${modeTxt}`}</div>
    </div>
    <div class="wp-info"><span>姓名：______________</span><span>日期：______________</span><span>正确率：<b>________</b> / ${cfg.items.length}（________%）</span></div>
    <div class="wp-tables">${tableHtml(left, startL)}${right.length ? tableHtml(right, startR) : ''}</div>
    ${isLast ? '<div class="wp-fix"><span>订正区：</span></div>' : ''}
  </div>`;
  });
  return { pages, total: cfg.items.length };
}
/* ---- 管理端弹窗与业务逻辑（数据走 /api/admin/word/*，AI 拆解与 PDF 导出走 /api/admin/paper/*）---- */
const AP_STRUCT_KEY = 'xuexi_sentstruct';   // 与学生端共用同一份缓存（同源 localStorage），互为补充
const AP = { kind: 'word', bookId: '', unit: '', grp: '', order: 'asc', mode: 'e2c', trans: true, pages: null, title: '', books: [] };
function apStructCacheGet() {
  try { return JSON.parse(localStorage.getItem(AP_STRUCT_KEY) || '{}') || {}; } catch (e) { return {}; }
}
async function apEnsureStructs(items) {
  const cache = apStructCacheGet();
  const miss = items.filter((x) => x && x.text && !(wtStructNorm(cache[x.text]) || {}).parts);
  if (!miss.length) return cache;
  const BATCH = 10;
  const batches = [];
  for (let i = 0; i < miss.length; i += BATCH) batches.push(miss.slice(i, i + BATCH));
  toast(`AI 正在分析 ${miss.length} 个句子的语法结构…`);
  await Promise.all(batches.map(async (b) => {
    try {
      const r = await api('/api/admin/paper/sent-structs', { method: 'POST', body: { texts: b.map((x) => x.text) } });
      (Array.isArray(r) ? r : []).forEach((v, k) => {
        const nv = wtStructNorm(v);
        if (nv && nv.parts && b[k]) cache[b[k].text] = nv;
      });
    } catch (e) { /* 单批失败静默跳过，下次生成自动重试 */ }
  }));
  try { localStorage.setItem(AP_STRUCT_KEY, JSON.stringify(cache)); } catch (e) { /* 超限忽略 */ }
  return cache;
}
async function apItems(bookId, kind) {
  const ep = kind === 'sent' ? 'sentences' : kind === 'phrase' ? 'phrases' : 'words';
  return await api(`/api/admin/word/${ep}?book_id=${Number(bookId) || 0}&limit=2000`).catch(() => []);
}
const AP_MODES = {
  word: [['e2c', '英译中'], ['c2e', '中译英'], ['ph', '看音标写单词']],
  phrase: [['e2c', '英译中'], ['c2e', '中译英'], ['pm', '提示默写']],
  sent: [['fill', '补充单词组合'], ['whole', '默写整句']],
};
const AP_KIND_NAME = { word: '单词', phrase: '短语', sent: '句子' };
const AP_CNT_KEY = { word: 'word_count', phrase: 'phrase_count', sent: 'sentence_count' };
async function adminPaperOpen(books) {
  AP.books = (books && books.length ? books : await api('/api/admin/word/books').catch(() => [])) || [];
  AP.kind = 'word'; AP.mode = 'e2c'; AP.unit = ''; AP.grp = ''; AP.order = 'asc'; AP.pages = null;
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="ap-modal">
    <div class="ap-mh"><h3>🖨️ 纸质化生成<span class="ap-hint">选好类型、词书和模式，点「生成默写表」即时预览</span></h3>
      <button class="ap-x">&times;</button></div>
    <div class="ap-mb">
      <div class="ap-row"><span class="ap-lb">类型</span>
        ${['word', 'phrase', 'sent'].map((k) => `<button class="ap-chip ${AP.kind === k ? 'on' : ''}" data-apkind="${k}">${AP_KIND_NAME[k]}</button>`).join('')}
        <span class="ap-lb" style="margin-left:16px">词书</span>
        <select id="apBook" class="ap-sel"></select>
        <span class="ap-lb" style="margin-left:12px">单元</span>
        <select id="apUnit" class="ap-sel"><option value="">加载中…</option></select>
        <select id="apGrp" class="ap-sel" style="display:none"><option value="">全部课文</option></select>
      </div>
      <div class="ap-row" id="apModeRow"></div>
      <div id="apPrev" class="ap-prev"><div class="ap-empty">选择好类型、词书和模式后，点下方「生成默写表」</div></div>
    </div>
    <div class="ap-mf">
      <button class="btn primary-sm" id="apPrint" style="display:none;width:auto;padding:0 22px">🖨️ 打印</button>
      <button class="btn primary-sm" id="apExport" style="display:none;width:auto;padding:0 22px;background:#f0a93c;border-color:#f0a93c">⬇ 导出 PDF</button>
      <button class="btn primary-sm" id="apGo" style="width:auto;padding:0 26px">生成默写表</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const $ = (s) => mask.querySelector(s);
  const close = () => mask.remove();
  mask.querySelector('.ap-x').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const bookSel = $('#apBook'), unitSel = $('#apUnit'), grpSel = $('#apGrp'), modeRow = $('#apModeRow');
  const bookOpts = () => {
    const cntKey = AP_CNT_KEY[AP.kind];
    let list = AP.books.filter((b) => (b[cntKey] || 0) > 0);
    if (!list.length) list = AP.books;
    bookSel.innerHTML = list.map((b) => `<option value="${b.id}">${esc(b.title)}（${b[cntKey] || 0}）</option>`).join('');
    const keep = list.find((b) => String(b.id) === AP.bookId);
    AP.bookId = String((keep || list[0] || {}).id || '');
    if (AP.bookId) bookSel.value = AP.bookId;
  };
  const renderModes = () => {
    modeRow.innerHTML = `<span class="ap-lb">顺序</span>
      <button class="ap-chip ${AP.order === 'asc' ? 'on' : ''}" data-aporder="asc">正序</button>
      <button class="ap-chip ${AP.order === 'rand' ? 'on' : ''}" data-aporder="rand">乱序</button>
      <span class="ap-lb" style="margin-left:16px">模式</span>
      ${AP_MODES[AP.kind].map(([k, t]) => `<button class="ap-chip ${AP.mode === k ? 'on' : ''}" data-apmode="${k}">${t}</button>`).join('')}
      ${AP.kind === 'sent' ? `<label id="apTransRow" style="margin-left:14px;font-size:13px;color:#475569;cursor:pointer;user-select:none"><input type="checkbox" id="apTrans" ${AP.trans ? 'checked' : ''} style="vertical-align:-2px;margin-right:5px">附整句翻译</label>` : ''}`;
    modeRow.querySelectorAll('[data-aporder]').forEach((b) => b.onclick = () => {
      AP.order = b.dataset.aporder;
      modeRow.querySelectorAll('[data-aporder]').forEach((x) => x.classList.toggle('on', x === b));
    });
    modeRow.querySelectorAll('[data-apmode]').forEach((b) => b.onclick = () => {
      AP.mode = b.dataset.apmode;
      modeRow.querySelectorAll('[data-apmode]').forEach((x) => x.classList.toggle('on', x === b));
      const tr = modeRow.querySelector('#apTransRow');
      if (tr) tr.style.display = AP.mode === 'fill' ? '' : 'none';
    });
  };
  const loadUnits = async () => {
    unitSel.innerHTML = '<option value="">加载中…</option>';
    grpSel.style.display = AP.kind === 'sent' ? '' : 'none';
    const items = await apItems(AP.bookId, AP.kind);
    if (String(bookSel.value) !== AP.bookId) return;
    const units = [...new Set(items.map((x) => String(x.unit || '').trim()).filter(Boolean))];
    unitSel.innerHTML = `<option value="">全部单元（共 ${items.length}）</option>` +
      units.map((u) => `<option value="${esc(u)}">${esc(u)}（${items.filter((x) => String(x.unit || '').trim() === u).length}）</option>`).join('');
    unitSel.value = units.includes(AP.unit) ? AP.unit : '';
    AP.unit = unitSel.value;
    const grps = [...new Set(items.map((x) => String(x.grp || '').trim()).filter(Boolean))];
    grpSel.innerHTML = `<option value="">全部课文</option>` + grps.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    grpSel.value = grps.includes(AP.grp) ? AP.grp : '';
    AP.grp = grpSel.value;
  };
  mask.querySelectorAll('[data-apkind]').forEach((b) => b.onclick = () => {
    AP.kind = b.dataset.apkind;
    AP.mode = AP_MODES[AP.kind][0][0];
    mask.querySelectorAll('[data-apkind]').forEach((x) => x.classList.toggle('on', x === b));
    renderModes();
    bookOpts();
    loadUnits();
  });
  bookSel.onchange = () => { AP.bookId = String(bookSel.value); loadUnits(); };
  unitSel.onchange = () => { AP.unit = unitSel.value; };
  grpSel.onchange = () => { AP.grp = grpSel.value; };
  renderModes();
  bookOpts();
  loadUnits();
  // 生成：拉数据 → 筛单元/分组 → 排序 → AI 拆解（fill）→ 渲染预览（与学生端 wtPaperPages 同一引擎）
  $('#apGo').onclick = async () => {
    const go = $('#apGo');
    go.disabled = true; go.textContent = '生成中…';
    try {
      const all = await apItems(AP.bookId, AP.kind);
      let items = AP.kind === 'sent' ? all.filter((x) => x && x.text) : all.filter((x) => x && (x.word || x.phrase));
      if (AP.unit) items = items.filter((x) => String(x.unit || '').trim() === AP.unit);
      if (AP.kind === 'sent' && AP.grp) items = items.filter((x) => String(x.grp || '').trim() === AP.grp);
      if (!items.length) { toast('这本词书/单元还没有对应内容', 'err'); return; }
      if (AP.order === 'rand') {
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
      }
      const book = AP.books.find((b) => String(b.id) === AP.bookId);
      let structs = null;
      if (AP.kind === 'sent' && AP.mode === 'fill') structs = await apEnsureStructs(items);
      const transChk = modeRow.querySelector('#apTrans');
      AP.trans = !!(transChk && transChk.checked);
      const made = wtPaperPages({ items, mode: AP.mode, kind: AP.kind, bookTitle: book ? book.title : '', unit: AP.unit, grp: AP.grp, structs, trans: AP.trans });
      AP.pages = made.pages;
      AP.title = (book ? book.title : '') + ' ' + AP_KIND_NAME[AP.kind] + '默写表';
      const prev = $('#apPrev');
      prev.innerHTML = `<style>${WP_SHEET_CSS}</style><style>.ap-prev .wt-paper-sheet + .wt-paper-sheet{margin-top:16px}</style>` + AP.pages.join('');
      prev.scrollTop = 0;
      $('#apPrint').style.display = '';
      $('#apExport').style.display = '';
      go.textContent = `重新生成（共 ${items.length} ${AP.kind === 'sent' ? '句' : '词'}${made.pages.length > 1 ? ` · ${made.pages.length} 页` : ''}）`;
    } catch (e) {
      toast('生成失败：' + (e.message || e), 'err');
    } finally {
      go.disabled = false;
      if (go.textContent === '生成中…') go.textContent = '生成默写表';
    }
  };
  // 打印：新窗口同版式 → 调起打印
  $('#apPrint').onclick = () => {
    if (!(AP.pages && AP.pages.length)) return toast('请先生成默写表', 'err');
    const w = window.open('', '_blank');
    if (!w) return toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(AP.title || '默写表')}</title><style>${WP_SHEET_CSS}body{padding:0;margin:0;background:#fff}</style></head><body>${AP.pages.join('')}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* 用户手动 Ctrl+P 也可 */ } }, 500);
  };
  // 导出：逐页离屏 794px 截图 → /api/admin/paper/pdf 拼 A4 → 直接下载
  $('#apExport').onclick = async () => {
    if (!(AP.pages && AP.pages.length)) return toast('请先生成默写表', 'err');
    if (typeof html2canvas !== 'function') return toast('导出组件没加载，请 Ctrl+F5 刷新后重试', 'err');
    const nodes = [...mask.querySelectorAll('.ap-prev .wt-paper-sheet')];
    if (!nodes.length) return toast('请先生成默写表', 'err');
    const btn = $('#apExport');
    btn.disabled = true;
    const oldTxt = btn.textContent;
    btn.textContent = '正在导出…';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px';
    document.body.appendChild(holder);
    try {
      const fd = new FormData();
      for (const el of nodes) {
        holder.appendChild(el);
        const c = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        mask.querySelector('.ap-prev').appendChild(el);
        const blob = await new Promise((rs, rj) => c.toBlob((b) => (b ? rs(b) : rj(new Error('页面转换失败'))), 'image/jpeg', 0.92));
        fd.append('pages', blob, 'p.jpg');
      }
      const name = AP.title || '默写表';
      const r = await fetch('/api/admin/paper/pdf?title=' + encodeURIComponent(name), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ((typeof Auth !== 'undefined' && Auth && Auth.token) || '') },
        body: fd,
      });
      if (!r.ok) {
        let msg = '服务端导出失败（' + r.status + '）';
        try { msg = (await r.json()).msg || msg; } catch (e) { /* 保留默认 */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast(`已导出 ${AP.pages.length > 1 ? AP.pages.length + ' 页 · ' : ''}${name}.pdf`);
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'err');
    } finally {
      [...nodes].forEach((el) => { if (el.parentElement !== mask.querySelector('.ap-prev')) mask.querySelector('.ap-prev').appendChild(el); });
      holder.remove();
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  };
}

window.adminPaperOpen = adminPaperOpen;
})();
/* 弹窗样式（自包含） */
(function(){
'use strict';
const st = document.createElement('style');
st.textContent = "/* 管理端纸质化生成弹窗（自包含样式，不依赖学生端 css） */\n.ap-modal{width:min(1000px,94vw);max-height:92vh;background:var(--bg,#fff);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(15,40,90,.25)}\n.ap-mh{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #e8eef7}\n.ap-mh h3{margin:0;font-size:17px;color:#1e3a5f;display:flex;align-items:center;gap:10px}\n.ap-hint{font-size:12.5px;color:#8aa2c4;font-weight:400;margin-left:8px}\n.ap-x{border:none;background:none;font-size:24px;color:#8aa2c4;cursor:pointer;line-height:1}\n.ap-mb{padding:14px 22px 0;overflow:hidden;display:flex;flex-direction:column;min-height:0;flex:1}\n.ap-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}\n.ap-lb{font-size:13px;color:#64748b}\n.ap-chip{border:1.5px solid #c9d9f2;background:#fff;color:#33445c;border-radius:999px;padding:4px 14px;font-size:13px;cursor:pointer}\n.ap-chip.on{background:#2f6bff;border-color:#2f6bff;color:#fff;font-weight:600}\n.ap-sel{min-width:150px;padding:6px 10px;border:1px solid #c9d9f2;border-radius:8px;font-size:13px;background:#fff;color:#1e3a5f}\n.ap-prev{flex:1;min-height:0;overflow:auto;border:1px solid #e8eef7;border-radius:10px;background:#f6f9ff;padding:16px}\n.ap-empty{color:#8aa2c4;font-size:13.5px;text-align:center;padding:60px 0}\n.ap-mf{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid #e8eef7}";
document.head.appendChild(st);
})();