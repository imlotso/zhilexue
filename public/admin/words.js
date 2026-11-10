/* AI单词训练（管理端）
 * 主页面只放词书表（查询、分页）。点「词表」从右侧抽屉管单词、上传和 AI。考纲单词同样。
 */

/** AI单词训练板块的两个子模块：词书管理 / 考纲单词（学习报告已独立到「组织管理 > 词书学习报告」） */
const WVIEW_TABS = [
  { k: 'books', t: '词书管理', i: 'book' },
  { k: 'sylbook', t: '考纲单词', i: 'list' },
];
const wviewTabs = () => `<div class="toolbar" style="gap:6px;margin-bottom:14px">
  ${WVIEW_TABS.map((t) => `<button class="btn ${WB.view === t.k ? 'primary-sm' : 'ghost'}" data-wview="${t.k}">${ic(t.i)} ${t.t}</button>`).join('')}</div>`;

const TABS = [
  { k: 'word', t: '单词库', i: 'book' },
  { k: 'phrase', t: '短语库', i: 'doc' },
  { k: 'sentence', t: '句子库', i: 'list' },
  { k: 'pos', t: '词性训练库', i: 'link' },
];

const TEMPLATES = {
  word: { cols: '单词 | 音标（选填） | 释义 | 例句（选填） | 单元（选填）', sample: 'repeat | [rɪˈpiːt] | 重复 | Please repeat after me. | Unit 1' },
  phrase: { cols: '短语 | 释义 | 例句（选填：译林版课文原句） | 例句中文（选填） | 单元（选填）', sample: 'look after | 照顾；照料 | I can look after my little sister. | 我可以照顾我的妹妹。 | Unit 1' },
  sentence: { cols: '句子 | 翻译（选填） | 单元（选填） | 分组（必填）', sample: 'She is a very talented artist. | 她是一位非常有才华的艺术家。 | Unit 1 | 大课文' },
  pos: { cols: '原词 | 原词词性 | 原词译 | 目标词 | 词性 | 目标词释义 | 词缀说明（选填） | 单元（选填）', sample: 'care | v. | 关心；在意 | careful | 形容词 | 小心的 | care + -ful | Unit 1' },
  /* 考纲单词：没有单元列——学生端学前检测自动按每 60 个单词为一个大组 */
  syllabus: { cols: '单词 | 音标（选填） | 释义（建议填） | 例句（选填）', sample: 'repeat | [rɪˈpiːt] | 重复 | Please repeat after me.' },
};

const TPL_FILE = { word: '单词表模板.xlsx', phrase: '短语表模板.xlsx', sentence: '句子表模板.xlsx', pos: '词性训练（词根词缀）表模板.xlsx', syllabus: '考纲单词表模板.xlsx' };

/** 词书类型（学生端各模块只看自己类型的书，互不串） */
const BOOK_KIND_ICON = { word: 'book', phrase: 'doc', pos: 'link', sent: 'list', syllabus: 'folder', letters: 'star', phonetic: 'sound' };
const BOOK_KINDS = { word: '单词书', phrase: '短语书', pos: '词形转换书', sent: '句子书', syllabus: '考纲单词书' };
const bookKindLabel = (k) => `${ic(BOOK_KIND_ICON[k] || 'book')} ${BOOK_KINDS[k] || k}`;
/** 每种词书类型能管理哪个库（短语书只能看到短语库、单词书只能看到单词库，互不混）。
 *  单词书额外允许带句子 / 词性数据（学生端「课文朗读 / 连词成句 / 词性训练」读的也是单词书），
 *  但这两种标签只在<b>这本书真的有数据</b>时才出现 —— 纯单词书就只看到「单词库」。 */
const KIND_TABS = { word: ['word', 'sentence', 'pos'], phrase: ['phrase'], sent: ['sentence'], pos: ['pos'], syllabus: ['word'] };
/** 当前词书实际要显示的库标签：首个（本类型的主库）恒显示，附加库有数据才显示 */
function bookTabs(book) {
  const base = KIND_TABS[(book && book.kind) || WB.kind] || ['word'];
  if (!book) return base.slice(0, 1);
  const cnt = { phrase: book.phrase_count || 0, sentence: book.sentence_count || 0, pos: book.pos_count || 0 };
  return base.filter((k, i) => i === 0 || (cnt[k] || 0) > 0);
}
/** 「词书管理」里的类型分区（考纲单词书有独立窗口，不在这里出现） */
const KIND_BAR = ['word', 'phrase', 'pos', 'sent'];
const WB = { books: [], bookId: '', tab: 'word', view: 'books', kind: 'word', bookKw: '', sylKw: '', rowKw: '', pick: new Set(), lists: { word: [], phrase: [], sentence: [], pos: [] } };

/** 一键下载当前标签页的表格模板（后端按 kind 现生成 xlsx：表头 + 示例行 + 填写说明） */
function downloadTemplate(kind) {
  const a = document.createElement('a');
  a.href = '/api/admin/word/template?kind=' + encodeURIComponent(kind) + '&token=' + encodeURIComponent(Auth.token);
  a.download = TPL_FILE[kind] || '模板.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('模板已开始下载，照着表头填好再上传', 'ok');
}

async function viewWords() {
  WB.books = await api('/api/admin/word/books');
  if (WB.view === 'sylbook') return viewSylBook();
  const kindBooks = WB.books.filter((b) => (b.kind || 'word') === WB.kind);
  const q = String(WB.bookKw || '').trim();
  const stgF = WB.stageF || '';
  let filtered = stgF ? kindBooks.filter((b) => (stgF === 'none' ? !b.stage : (b.stage || '') === stgF)) : kindBooks;
  if (q) filtered = filtered.filter((b) => String(b.title || '').includes(q));
  const pg = pageOf(filtered, 'wbPage', 10);
  const kindName = BOOK_KINDS[WB.kind];

  return {
    html: `
    ${wviewTabs()}
    <div class="card">
      <div class="card-h">
        <h3>${ic('book')} 词书 <span class="tag gray">${pg.total}</span></h3>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" id="wdBatchDel">批量删除</button>
          <button class="btn primary-sm" id="wdNew">${ic('plus')} 新建${kindName}</button>
        </div>
      </div>
      <div class="toolbar" style="flex-wrap:nowrap;align-items:center;margin-bottom:8px">
        <select id="wdKind" style="min-width:160px">
          ${KIND_BAR.map((k) => {
            const n = WB.books.filter((b) => (b.kind || 'word') === k).length;
            return `<option value="${k}" ${WB.kind === k ? 'selected' : ''}>${BOOK_KINDS[k]}（${n}）</option>`;
          }).join('')}
        </select>
        ${WB.kind === 'phrase' ? `<button class="btn primary-sm" id="wdFillAllEx" style="font-size:15px;height:42px;padding:0 20px;border-radius:9px;font-weight:600">${ic('robot')} 一键给全部短语书补齐例句</button>` : ''}
        <button class="btn ghost" id="wdPaper" style="margin-left:auto;background:#f0a93c;border-color:#f0a93c;color:#fff;font-size:15px;height:42px;padding:0 24px;border-radius:9px;font-weight:600;box-shadow:0 2px 8px rgba(240,169,60,.35)"> 纸质化生成</button>
      </div>
      <div class="toolbar">
        <select id="wdStageF" style="min-width:130px">
          <option value="">学段：全部</option>
          <option value="primary" ${WB.stageF === 'primary' ? 'selected' : ''}>小学</option>
          <option value="junior" ${WB.stageF === 'junior' ? 'selected' : ''}>初中</option>
          <option value="none" ${WB.stageF === 'none' ? 'selected' : ''}>未归纳</option>
        </select>
        <input class="input" id="wdKw" placeholder="搜索词书名称" value="${esc(WB.bookKw)}">
        <button class="btn ghost" id="wdSearch">查询</button>
        <button class="btn ghost" id="wdReset">重置</button>
      </div>
      ${pg.list.length ? `<table><thead><tr>
          <th style="width:34px"><input type="checkbox" id="wdChkAll"></th>
          <th>名称</th><th>类型</th><th>学段</th><th>单词</th><th>短语</th><th>句子</th><th>词性</th><th>使用人数</th><th style="width:72px">排序</th><th>操作</th>
        </tr></thead><tbody>${pg.list.map((b) => {
          const k = b.kind || 'word';
          const stg = { primary: '小学', junior: '初中' }[b.stage || ''] || '<span class="tag gray">未归纳</span>';
          return `<tr>
            <td><input type="checkbox" class="w-bk-chk" value="${b.id}"></td>
            <td><b>${esc(b.title)}</b></td>
            <td>${esc(BOOK_KINDS[k] || k)}</td>
            <td>${stg}</td>
            <td>${b.word_count || 0}</td>
            <td>${b.phrase_count || 0}</td>
            <td>${b.sentence_count || 0}</td>
            <td>${b.pos_count || 0}</td>
            <td>${b.used_count || 0}</td>
            <td>${Number(b.sort) || '—'}</td>
            <td><div class="acts">
              <button class="link-btn" data-open="${b.id}">词表</button>
              <button class="link-btn" data-bkedit="${b.id}">编辑</button>
              <button class="link-btn danger" data-bkdel="${b.id}">删除</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody></table>
        ${pagerHTML(pg.page, pg.size, pg.total, 'wbPage')}` : `<div class="empty">暂无${kindName}</div>`}
    </div>`,
    after: () => {
      document.querySelectorAll('[data-wview]').forEach((b) => b.onclick = () => { closeWordDrawer(); WB.view = b.dataset.wview; render(); });
      bindPager('wbPage');
      document.getElementById('wdKind').onchange = () => {
        WB.kind = document.getElementById('wdKind').value;
        WB.tab = (KIND_TABS[WB.kind] || ['word'])[0];
        ADM.page.wbPage = 1;
        render();
      };
      document.getElementById('wdSearch').onclick = () => { WB.bookKw = document.getElementById('wdKw').value.trim(); ADM.page.wbPage = 1; render(); };
      document.getElementById('wdStageF').onchange = () => { WB.stageF = document.getElementById('wdStageF').value; ADM.page.wbPage = 1; render(); };
      document.getElementById('wdKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('wdSearch').click(); };
      document.getElementById('wdReset').onclick = () => { WB.bookKw = ''; ADM.page.wbPage = 1; render(); };
      const allChk = document.getElementById('wdChkAll');
      if (allChk) allChk.onchange = () => {
        document.querySelectorAll('.w-bk-chk').forEach((c) => { c.checked = allChk.checked; });
      };
      document.querySelectorAll('[data-open]').forEach((btn) => btn.onclick = () => {
        const b = WB.books.find((x) => String(x.id) === btn.dataset.open);
        if (b) openWordDrawer(b);
      });
      document.querySelectorAll('[data-bkedit]').forEach((btn) => btn.onclick = () => editBook(btn.dataset.bkedit));
      document.querySelectorAll('[data-bkdel]').forEach((btn) => btn.onclick = () => delBook(btn.dataset.bkdel));
      document.getElementById('wdNew').onclick = () => newBook(WB.kind);
      document.getElementById('wdBatchDel').onclick = batchDelBooks;
      const allExBtn = document.getElementById('wdFillAllEx');
      if (allExBtn) allExBtn.onclick = () => aiFillExamplesAllBooks(allExBtn);
      const paperBtn = document.getElementById('wdPaper');
      if (paperBtn) paperBtn.onclick = () => { if (typeof adminPaperOpen === 'function') adminPaperOpen(WB.books); };
    },
  };
}

/** 抽屉还开着就只刷新抽屉里的词表，否则只重画当前页内容，不整页闪一下 */
async function refreshWords() {
  if (document.querySelector('.wd-drawer-in')) {
    WB.books = await api('/api/admin/word/books');
    const book = WB.books.find((b) => String(b.id) === String(WB.bookId));
    if (book) { fillWordDrawer(book); return; }
  }
  await refreshWordPage();
}
async function refreshWordPage() {
  const key = (location.hash.replace('#/', '').split('?')[0]) || 'dash';
  const view = document.getElementById('view');
  if (key !== 'words' || !view) { render(); return; }
  const out = await viewWords();
  view.innerHTML = out.html;
  if (out.after) out.after();
}

let wordDrawerVm = null;
let wordDrawerGen = 0;
function openWordDrawer(book) {
  WB.bookId = String(book.id);
  if (KIND_BAR.includes(book.kind || 'word')) WB.kind = book.kind || 'word';
  const tabs = bookTabs(book);
  if (!tabs.includes(WB.tab)) WB.tab = tabs[0];
  ADM.page.wlPage = 1;
  WB.rowKw = '';
  WB.pick.clear();
  closeWordDrawer();
  const gen = ++wordDrawerGen;
  const host = document.createElement('div');
  host.id = 'wdDrawerRoot';
  const mount = document.createElement('div');
  host.appendChild(mount);
  document.body.appendChild(host);
  wordDrawerVm = new Vue({
    el: mount,
    data: { show: false, title: book.title },
    mounted() { this.$nextTick(() => { this.show = true; this.$nextTick(() => fillWordDrawer(book)); }); },
    watch: {
      show(v) {
        if (v) return;
        const self = this;
        setTimeout(() => {
          if (gen !== wordDrawerGen) return;
          self.$destroy();
          const n = document.getElementById('wdDrawerRoot');
          if (n) n.remove();
          if (wordDrawerVm === self) wordDrawerVm = null;
          document.body.classList.remove('el-popup-parent--hidden');
          document.body.style.paddingRight = '';
          refreshWordPage();
        }, 280);
      },
    },
    template: '<el-drawer :visible.sync="show" :title="title" size="78%" direction="rtl" :append-to-body="false" custom-class="wd-drawer" :wrapper-closable="true"><div class="wd-drawer-in admin-app"></div></el-drawer>',
  });
}
/** 立刻拆掉抽屉，不触发关闭后的整页刷新（换书、删书、离开页面时用） */
function closeWordDrawer() {
  wordDrawerGen++;
  const vm = wordDrawerVm;
  wordDrawerVm = null;
  if (!vm) return;
  try { vm.$destroy(); } catch (e) { /* 已销毁 */ }
  const n = document.getElementById('wdDrawerRoot');
  if (n) n.remove();
  document.body.classList.remove('el-popup-parent--hidden');
  document.body.style.paddingRight = '';
}
function fillWordDrawer(book) {
  const box = document.querySelector('.wd-drawer .wd-drawer-in');
  if (!box) return;
  const allowTabs = bookTabs(book);
  if (!allowTabs.includes(WB.tab)) WB.tab = allowTabs[0];
  const syllabus = (book.kind || '') === 'syllabus';
  box.innerHTML = `
    <div class="toolbar">
      ${allowTabs.length > 1 ? TABS.filter((t) => allowTabs.includes(t.k)).map((t) => `<button class="btn ${WB.tab === t.k ? 'primary-sm' : 'ghost'}" data-tab="${t.k}">${t.t}</button>`).join('') : `<span class="tag">${(TABS.find((t) => t.k === WB.tab) || { t: '词表' }).t}</span>`}
      <button class="btn primary-sm" id="wdAdd">${ic('plus')} 新增</button>
      <label class="el-button el-button--primary el-button--small">选择文件<input type="file" id="wdFile" accept=".xlsx,.csv,.xls" style="display:none"></label>
      <span id="wdUpTip" style="font-size:12px;color:#909399">xlsx / csv</span>
      <span style="flex:1"></span>
      ${syllabus ? '' : `<button class="btn ghost" id="wdAiFill">${ic('robot')} AI补全</button><button class="btn ghost" id="wdAiGen">${ic('plus')} AI生成</button>`}
      <button class="btn ghost" id="wdTpl">${ic('download')} 下载模板</button>
    </div>
    <div id="wdList"></div>`;
  box.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => {
    WB.tab = b.dataset.tab;
    WB.rowKw = '';
    WB.pick.clear();
    ADM.page.wlPage = 1;
    fillWordDrawer(book);
  });
  box.querySelector('#wdFile').onchange = doUpload;
  box.querySelector('#wdAdd').onclick = () => editRow(null);
  box.querySelector('#wdTpl').onclick = () => downloadTemplate(syllabus ? 'syllabus' : WB.tab);
  const aiFill = box.querySelector('#wdAiFill');
  if (aiFill) aiFill.onclick = () => aiFillBook(aiFill);
  const aiGen = box.querySelector('#wdAiGen');
  if (aiGen) aiGen.onclick = aiGenerate;
  loadList();
}

const ROW_FIELDS = {
  word: [['word', '单词', true], ['phonetic', '音标'], ['pos', '词性'], ['meaning', '释义'], ['example', '例句'], ['unit', '单元']],
  phrase: [['phrase', '短语', true], ['meaning', '释义'], ['unit', '单元'], ['example', '例句（教材原句，留空则由 AI 生成）'], ['example_cn', '例句中文']],
  sentence: [['text', '句子', true], ['translation', '翻译'], ['unit', '单元'], ['grp', '分组']],
  pos: [['base_word', '原词', true], ['base_pos', '原词词性'], ['base_meaning', '原词译'], ['target_word', '目标词', true], ['target_pos', '词性', true], ['meaning', '释义'], ['affix', '词缀'], ['unit', '单元']],
};
const ROW_NAME = { word: '单词', phrase: '短语', sentence: '句子', pos: '词性题' };

function editRow(row) {
  const kind = WB.tab;
  const fields = ROW_FIELDS[kind] || ROW_FIELDS.word;
  const long = { example: 1, text: 1, translation: 1, meaning: 1, affix: 1 };
  modal({
    title: (row ? '修改' : '新增') + (ROW_NAME[kind] || ''),
    body: fields.map(([k, lab, req]) => {
      const val = esc(row ? (row[k] || '') : '');
      return `<div class="field"><label>${lab}${req ? ' *' : ''}</label>${long[k]
        ? `<textarea class="input" id="wr_${k}" rows="2">${val}</textarea>`
        : `<input class="input" id="wr_${k}" value="${val}">`}</div>`;
    }).join(''),
    onOk: async (w, err) => {
      const body = { book_id: Number(WB.bookId) };
      for (const [k] of fields) {
        const el = w.querySelector('#wr_' + k);
        body[k] = el ? el.value.trim() : '';
      }
      const miss = fields.find(([k, lab, req]) => req && !body[k]);
      if (miss) return err('请填写' + miss[1]);
      const apiKind = kind === 'word' ? 'words' : kind === 'phrase' ? 'phrases' : kind === 'sentence' ? 'sentences' : 'pos';
      if (row) await api('/api/admin/word/' + apiKind + '/' + row.id, { method: 'PUT', body });
      else await api('/api/admin/word/' + apiKind, { method: 'POST', body });
      toast(row ? '已保存' : '已添加', 'ok');
      await refreshWords();
    },
  });
}

let WB_LIST_REQUEST = 0;
async function loadList() {
  const request = ++WB_LIST_REQUEST;
  const box = document.getElementById('wdList');
  if (!box) return;
  const bookId = Number(WB.bookId) || 0;
  if (!bookId) { box.innerHTML = '<div class="empty">先新建或选择一本词书</div>'; return; }
  const kind = WB.tab;
  const auth = typeof Auth !== 'undefined' ? Auth : {};
  const token = auth.token;
  const apiKind = kind === 'word' ? 'words' : kind === 'phrase' ? 'phrases' : kind === 'sentence' ? 'sentences' : 'pos';
  const data = await api(`/api/admin/word/${apiKind}?book_id=${bookId}&limit=2000`);
  if (request !== WB_LIST_REQUEST || bookId !== Number(WB.bookId) || kind !== WB.tab
    || auth.token !== token || document.getElementById('wdList') !== box || box.isConnected === false) return;
  WB.lists[kind] = data || [];
  paintRows();
}

function rowBlob(kind, r) {
  return (ROW_FIELDS[kind] || []).map(([k]) => r[k] || '').join('\n').toLowerCase();
}

function paintRows() {
  const box = document.getElementById('wdList');
  if (!box) return;
  const kind = WB.tab;
  const apiKind = kind === 'word' ? 'words' : kind === 'phrase' ? 'phrases' : kind === 'sentence' ? 'sentences' : 'pos';
  const q = String(WB.rowKw || '').trim().toLowerCase();
  const all = WB.lists[kind] || [];
  const list = q ? all.filter((r) => rowBlob(kind, r).includes(q)) : all;
  const pg = pageOf(list, 'wlPage', 10);
  const ids = list.map((r) => String(r.id));
  const allOn = ids.length > 0 && ids.every((id) => WB.pick.has(id));
  const hint = { word: '搜索单词、释义或单元', phrase: '搜索短语、释义或单元', sentence: '搜索句子、翻译或单元', pos: '搜索原词、原词译或目标词' }[kind] || '搜索';

  const head = {
    word: '<th style="width:34px"><input type="checkbox" id="wlChkAll"></th><th>单词</th><th>音标</th><th>词性</th><th>释义</th><th>例句</th><th>单元</th><th style="width:108px">操作</th>',
    phrase: '<th style="width:34px"><input type="checkbox" id="wlChkAll"></th><th>短语</th><th>释义</th><th>例句（语境填空用）</th><th>单元</th><th style="width:150px">操作</th>',
    sentence: '<th style="width:34px"><input type="checkbox" id="wlChkAll"></th><th>句子</th><th>翻译</th><th>单元</th><th>分组</th><th style="width:108px">操作</th>',
    pos: '<th style="width:34px"><input type="checkbox" id="wlChkAll"></th><th>原词</th><th>原词词性</th><th>原词译</th><th>目标词</th><th>词性</th><th>释义</th><th>词缀</th><th>单元</th><th style="width:108px">操作</th>',
  }[kind];
  const cells = (r) => kind === 'word'
    ? `<td><b>${esc(r.word)}</b></td><td style="color:var(--text3)">${esc(r.phonetic)}</td><td>${esc(r.pos)}</td><td>${esc(r.meaning)}</td><td style="color:var(--text3)">${esc((r.example || '').slice(0, 40))}</td><td>${esc(r.unit)}</td>`
    : kind === 'phrase'
      // 例句列：有例句显示原文（截断 + hover 全文），没有则显示「AI 生成」按钮
      ? `<td><b>${esc(r.phrase)}</b></td><td style="color:var(--text3)">${esc(r.meaning)}</td>
          <td style="max-width:340px">${String(r.example || '').trim()
            ? `<div style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.example)}">${esc(r.example)}</div>${String(r.example_cn || '').trim() ? `<div style="color:var(--text3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.example_cn)}">${esc(r.example_cn)}</div>` : ''}`
            : `<button class="link-btn" data-aiex="${r.id}" title="让 AI 按译林版教材本单元课文生成例句">＋ AI 生成例句</button>`}</td>
          <td>${esc(r.unit)}</td>`
      : kind === 'sentence'
      ? `<td><b>${esc(r.text)}</b></td><td style="color:var(--text3)">${esc(r.translation)}</td><td>${esc(r.unit)}</td><td>${r.grp ? `<span class="tag gray">${esc(r.grp)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>`
      : `<td><b>${esc(r.base_word)}</b></td><td style="color:var(--text3)">${esc(r.base_pos)}</td><td>${esc(r.base_meaning)}</td><td>${esc(r.target_word)}</td><td><span class="tag gray">${esc(r.target_pos)}</span></td><td style="color:var(--text3)">${esc(r.meaning)}</td><td style="color:var(--text3)">${esc(r.affix)}</td><td>${esc(r.unit)}</td>`;

  box.innerHTML = `
    <div class="toolbar">
      <input class="input" id="wlKw" placeholder="${hint}" value="${esc(WB.rowKw)}">
      <button class="btn ghost" id="wlSearch">查询</button>
      <button class="btn ghost" id="wlReset">重置</button>
      <span style="flex:1"></span>
      ${kind === 'phrase' ? `<button class="btn primary-sm" id="wlExAll">${ic('robot')} AI 补全例句</button>` : ''}
      <button class="btn ghost" id="wlBatch">批量删除</button>
    </div>
    ${list.length ? `<div style="overflow-x:auto"><table>
      <thead><tr>${head}</tr></thead>
      <tbody>${pg.list.map((r) => `<tr>
        <td><input type="checkbox" class="wl-chk" value="${r.id}" ${WB.pick.has(String(r.id)) ? 'checked' : ''}></td>
        ${cells(r)}<td><div class="acts">
        <button class="link-btn" data-edit="${r.id}">编辑</button>
        <button class="link-btn danger" data-del="${r.id}">删除</button>
      </div></td></tr>`).join('')}</tbody></table></div>
      ${pagerHTML(pg.page, pg.size, pg.total, 'wlPage')}` : `<div class="empty">${q ? '没有匹配的内容' : '暂无数据'}</div>`}`;
  const allChk = box.querySelector('#wlChkAll');
  if (allChk) {
    allChk.checked = allOn;
    allChk.onchange = () => {
      ids.forEach((id) => { if (allChk.checked) WB.pick.add(id); else WB.pick.delete(id); });
      box.querySelectorAll('.wl-chk').forEach((c) => { c.checked = allChk.checked; });
    };
  }
  box.querySelectorAll('.wl-chk').forEach((c) => c.onchange = () => {
    if (c.checked) WB.pick.add(c.value); else WB.pick.delete(c.value);
    if (allChk) allChk.checked = ids.every((id) => WB.pick.has(id));
  });
  const applyKw = () => { WB.rowKw = box.querySelector('#wlKw').value.trim(); WB.pick.clear(); ADM.page.wlPage = 1; paintRows(); };
  box.querySelector('#wlSearch').onclick = applyKw;
  box.querySelector('#wlKw').onkeydown = (e) => { if (e.key === 'Enter') applyKw(); };
  box.querySelector('#wlReset').onclick = () => { WB.rowKw = ''; WB.pick.clear(); ADM.page.wlPage = 1; paintRows(); };
  box.querySelector('#wlBatch').onclick = () => batchDelRows(apiKind, ids);
  const exBtn = box.querySelector('#wlExAll');
  if (exBtn) exBtn.onclick = () => aiFillExamples(exBtn, WB.pick.size ? [...WB.pick] : null);
  box.querySelectorAll('[data-page="wlPage"]').forEach((b) => {
    b.onclick = () => {
      if (b.disabled) return;
      const to = Number(b.dataset.to);
      if (!to || to < 1) return;
      ADM.page.wlPage = to;
      paintRows();
    };
  });
  box.querySelectorAll('[data-psize="wlPage"]').forEach((sel) => {
    sel.onchange = () => {
      ADM.page.wlPageSize = Number(sel.value) || 10;
      ADM.page.wlPage = 1;
      paintRows();
    };
  });
  box.querySelectorAll('[data-aiex]').forEach((b) => b.onclick = () => aiOneExample(b, () => { loadList(); }));
  box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
    const row = all.find((x) => String(x.id) === b.dataset.edit);
    if (row) editRow(row);
  });
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await elConfirm({ title: '删除', message: '删除这条记录？学生端将不再出现它。', okText: '删除', danger: true })) return;
    await api('/api/admin/word/' + apiKind + '/' + b.dataset.del, { method: 'DELETE' });
    WB.pick.delete(String(b.dataset.del));
    toast('已删除', 'ok');
    refreshWords();
  });
}

async function batchDelRows(apiKind, visibleIds) {
  const ids = visibleIds.filter((id) => WB.pick.has(id));
  if (!ids.length) return toast('先勾选要删除的内容', 'err');
  if (!await elConfirm({ title: '批量删除', message: `删除选中的 ${ids.length} 条？学生端将不再出现这些内容。`, okText: '删除', danger: true })) return;
  let ok = 0;
  let firstErr = '';
  for (const id of ids) {
    try {
      await api('/api/admin/word/' + apiKind + '/' + id, { method: 'DELETE', silent: true });
      ok++;
      WB.pick.delete(id);
    } catch (e) { if (!firstErr) firstErr = e.message || '删除失败'; }
  }
  if (!ok) return toast(firstErr || '删除失败', 'err');
  toast(`已删除 ${ok} 条`, ok === ids.length ? 'ok' : 'err');
  refreshWords();
}

/* ----------------  考纲单词（独立窗口）：只管「考纲单词书」 ----------------
 * 考纲词书与单词速记的词书互不混用。选择词书后，学生端「考纲单词」的学前检测
 * 自动按每 60 个单词为一个大组过筛（纸条遮挡 → 点击核对 → ➕ 筛出生词），
 * 筛完的生词再按学生自选的 5 / 10 个一组识记、学后检测。 */
async function viewSylBook() {
  WB.tab = 'word';
  WB.books = await api('/api/admin/word/books');
  const sylBooks = WB.books.filter((b) => (b.kind || 'word') === 'syllabus');
  const q = String(WB.sylKw || '').trim();
  const filtered = q ? sylBooks.filter((b) => String(b.title || '').includes(q)) : sylBooks;
  const pg = pageOf(filtered, 'wsPage', 10);

  return {
    html: `
    ${wviewTabs()}
    <div class="card">
      <div class="card-h">
        <h3>${ic('list')} 考纲词书 <span class="tag gray">${pg.total}</span></h3>
        <button class="btn primary-sm" id="wdNew">${ic('plus')} 新建</button>
      </div>
      <div class="toolbar">
        <input class="input" id="wsKw" placeholder="搜索词书名称" value="${esc(WB.sylKw)}">
        <button class="btn ghost" id="wsSearch">查询</button>
        <button class="btn ghost" id="wsReset">重置</button>
      </div>
      ${pg.list.length ? `<table><thead><tr>
          <th>名称</th><th>单词</th><th>使用人数</th><th style="width:72px">排序</th><th>操作</th>
        </tr></thead><tbody>${pg.list.map((b) => `<tr>
            <td><b>${esc(b.title)}</b></td>
            <td>${b.word_count || 0}</td>
            <td>${b.used_count || 0}</td>
            <td>${Number(b.sort) || '—'}</td>
            <td><div class="acts">
              <button class="link-btn" data-open="${b.id}">词表</button>
              <button class="link-btn" data-bkedit="${b.id}">编辑</button>
              <button class="link-btn danger" data-bkdel="${b.id}">删除</button>
            </div></td>
          </tr>`).join('')}</tbody></table>
        ${pagerHTML(pg.page, pg.size, pg.total, 'wsPage')}` : '<div class="empty">暂无考纲词书</div>'}
    </div>`,
    after: () => {
      document.querySelectorAll('[data-wview]').forEach((b) => b.onclick = () => { closeWordDrawer(); WB.view = b.dataset.wview; render(); });
      bindPager('wsPage');
      document.getElementById('wsSearch').onclick = () => { WB.sylKw = document.getElementById('wsKw').value.trim(); ADM.page.wsPage = 1; render(); };
      document.getElementById('wsKw').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('wsSearch').click(); };
      document.getElementById('wsReset').onclick = () => { WB.sylKw = ''; ADM.page.wsPage = 1; render(); };
      document.querySelectorAll('[data-open]').forEach((btn) => btn.onclick = () => {
        const b = WB.books.find((x) => String(x.id) === btn.dataset.open);
        if (b) openWordDrawer(b);
      });
      document.querySelectorAll('[data-bkedit]').forEach((btn) => btn.onclick = () => editBook(btn.dataset.bkedit));
      document.querySelectorAll('[data-bkdel]').forEach((btn) => btn.onclick = () => delBook(btn.dataset.bkdel));
      document.getElementById('wdNew').onclick = () => newBook('syllabus');
    },
  };
}

function newBook(fixedKind) {
  // 类型锁定 = 当前分区：单词书分区只能建单词书、句子书分区只能建句子书（考纲在独立窗口）
  const kind = BOOK_KINDS[fixedKind] ? fixedKind : 'word';
  const kindName = BOOK_KINDS[kind];
  modal({
    title: `新建${kindName}`,
    body: `
      <div class="field"><label>词书名称 *</label><input class="input" id="nbTitle" placeholder="${kind === 'syllabus' ? '如：初中考纲单词 1600' : kind === 'phrase' ? '如：人教版八下英语短语' : kind === 'sent' ? '如：人教版八下重点句子' : kind === 'pos' ? '如：八年级词形转换' : '如：人教版八下英语单词'}"></div>
      <div class="field"><label>词书类型</label><input class="input" value="${kindName}" disabled></div>
      <div class="field"><label>排序</label><input class="input" type="number" min="0" id="nbSort" placeholder="1、2、3… 越小越靠前，学生端按这个顺序"></div>
      <div class="field"><label>年级</label><input class="input" id="nbGrade" placeholder="如：八年级（可空）"></div>
      <div class="field"><label>学段</label><select class="input" id="nbStage">
        <option value="">自动（按书名 / 年级归纳）</option>
        <option value="primary">小学</option>
        <option value="junior">初中</option>
      </select></div>
      <div class="field"><label>备注</label><input class="input" id="nbRemark" placeholder="可空"></div>`,
    onOk: async (w, err) => {
      const title = w.querySelector('#nbTitle').value.trim();
      if (!title) return err('请填写词书名称');   // 必须用 err()：toast() 返回 undefined，弹窗不会被拦住
      const r = await api('/api/admin/word/books', { method: 'POST', body: { title, kind, grade: w.querySelector('#nbGrade').value, stage: w.querySelector('#nbStage').value, remark: w.querySelector('#nbRemark').value, sort: w.querySelector('#nbSort').value } });
      WB.bookId = String(r.id);
      if (kind !== 'syllabus') WB.kind = kind;    // 跳到刚建的那一类分区，方便直接上传
      toast('已创建，可以上传词表了', 'ok');
      await render();
      const created = WB.books.find((x) => String(x.id) === String(r.id));
      if (created) openWordDrawer(created);
    },
  });
}

/** ✏ 编辑词书：改名 / 年级 / 备注（类型固定，改类型请在对应分区重建；保证各分区互不混） */
function editBook(id) {
  const b = WB.books.find((x) => String(x.id) === String(id));
  if (!b) return;
  const kindName = BOOK_KINDS[b.kind || 'word'];
  modal({
    title: '编辑词书',
    body: `
      <div class="field"><label>词书名称 *</label><input class="input" id="ebTitle" value="${esc(b.title)}"></div>
      <div class="field"><label>词书类型</label><input class="input" value="${kindName}" disabled></div>
      <div class="field"><label>排序</label><input class="input" type="number" min="0" id="ebSort" value="${Number(b.sort) || ''}" placeholder="1、2、3… 越小越靠前，学生端按这个顺序"></div>
      <div class="field"><label>年级</label><input class="input" id="ebGrade" value="${esc(b.grade || '')}" placeholder="可空"></div>
      <div class="field"><label>学段</label><select class="input" id="ebStage">
        <option value="" ${!b.stage ? 'selected' : ''}>自动（按书名 / 年级归纳）</option>
        <option value="primary" ${b.stage === 'primary' ? 'selected' : ''}>小学</option>
        <option value="junior" ${b.stage === 'junior' ? 'selected' : ''}>初中</option>
      </select></div>
      <div class="field"><label>备注</label><input class="input" id="ebRemark" value="${esc(b.remark || '')}" placeholder="可空"></div>`,
    onOk: async (w, err) => {
      const title = w.querySelector('#ebTitle').value.trim();
      if (!title) return err('请填写词书名称');
      const r = await api(`/api/admin/word/books/${b.id}`, { method: 'PUT', body: { title, kind: b.kind || 'word', grade: w.querySelector('#ebGrade').value, stage: w.querySelector('#ebStage').value, remark: w.querySelector('#ebRemark').value, sort: w.querySelector('#ebSort').value } });
      WB.bookId = String(b.id);
      toast(r.msg || '已保存', 'ok');
      if (wordDrawerVm && String(WB.bookId) === String(b.id)) wordDrawerVm.title = title;
      render();
    },
  });
}

/**  删除单本词书：需输入删除密码（密码由服务端校验，前端不保存密码） */
async function delBook(id) {
  const b = WB.books.find((x) => String(x.id) === String(id || WB.bookId));
  if (!b) return;
  if (!await elConfirm({ title: '删除词书', message: `删除词书「${b.title}」？\n里面的单词 ${b.word_count}、句子 ${b.sentence_count}、词性题 ${b.pos_count} 会一并删除，学生的作答记录保留。`, okText: '删除', danger: true })) return;
  const pwd = await elPrompt({ title: '删除密码', message: '删除词书是高危操作，请输入删除密码', placeholder: '请输入删除密码' });
  if (pwd === null || !pwd.trim()) return;
  try {
    await api('/api/admin/word/books/' + b.id, { method: 'DELETE', body: { pwd: pwd.trim() } });
  } catch (e) { return toast(e.message || '删除失败', 'err'); }
  if (String(b.id) === String(WB.bookId)) { WB.bookId = ''; closeWordDrawer(); }
  toast('已删除', 'ok'); render();
}

/**  批量删除词书：勾选 → 输入删除密码（交给服务端校验）→ 确认 → 逐个删 */
async function batchDelBooks() {
  const ids = [...document.querySelectorAll('.w-bk-chk:checked')].map((c) => c.value);
  if (!ids.length) return toast('先勾选要删除的词书（列表最前面的小方框）', 'err');
  const books = WB.books.filter((b) => ids.includes(String(b.id)));
  const names = books.map((b) => b.title);
  if (!await elConfirm({ title: '批量删除词书', message: `确定删除选中的 ${ids.length} 本词书？\n${names.slice(0, 10).join('、')}${names.length > 10 ? ` 等 ${ids.length} 本` : ''}\n书里的单词 / 短语 / 句子 / 词性题会一并删除，学生的作答记录保留，且不可恢复。`, okText: '删除', danger: true })) return;
  const pwd = await elPrompt({ title: '删除密码', message: `删除 ${ids.length} 本词书是高危操作，请输入删除密码`, placeholder: '请输入删除密码' });
  if (pwd === null || !pwd.trim()) return;
  let ok = 0, firstErr = '';
  for (const id of ids) {
    try {
      await api('/api/admin/word/books/' + id, { method: 'DELETE', body: { pwd: pwd.trim() }, silent: true });
      ok++;
      if (String(id) === String(WB.bookId)) { WB.bookId = ''; closeWordDrawer(); }
    } catch (e) { if (!firstErr) firstErr = e.message || '删除失败'; }
  }
  if (!ok) return toast('一本都没删掉：' + (firstErr || '删除失败'), 'err');
  toast(`已删除 ${ok} / ${ids.length} 本词书`, ok === ids.length ? 'ok' : 'err');
  render();
}

/* ---------------- AI 助手：补全 / 生成 ---------------- */
function curBook() { return WB.books.find((b) => String(b.id) === String(WB.bookId)); }

/**  AI 补全当前词书缺失内容（按当前标签页对应的库） */
async function aiFillBook(btn) {
  const book = curBook();
  if (!book) return toast('请先新建或选择一本词书', 'err');
  if (!book.word_count && !book.phrase_count && !book.sentence_count && !book.pos_count) return toast('当前词书还是空的，请先生成或上传', 'err');
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '补全中…';
  try {
    const r = await api('/api/admin/word/ai/fill', { method: 'POST', body: { bookId: Number(WB.bookId), kind: WB.tab } });
    toast(r.msg || 'AI 补全完成', 'ok');
    refreshWords();
  } catch (e) {
    toast('AI 补全失败：' + e.message, 'err');
    btn.disabled = false; btn.innerHTML = old;
  }
}

/** ✍ 单条短语的 AI 例句（列表里「＋ AI 生成例句」按钮）
 *  例句优先取自译林版（牛津译林）2024 新版教材本书本单元课文里的真实原句，写进短语行，
 *  学生端语境填空直接用它；生成后老师可在「编辑」里改。 */
async function aiOneExample(btn, done) {
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '生成中…'; }
  try {
    const r = await api('/api/admin/word/phrase-example', { method: 'POST', body: { id: Number(btn.dataset.aiex) } });
    toast('已生成例句：' + String(r.sentence || '').slice(0, 40) + (String(r.sentence || '').length > 40 ? '…' : ''), 'ok');
    if (done) done();
  } catch (e) {
    toast('例句生成失败：' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
}
/**  批量 AI 补全例句：勾选了短语就只补选中的，没勾选则补整本书里还没有例句的。
 *  AI 一次一条（约 3~6 秒），后台慢慢跑，这里轮询进度，完成后自动刷新列表。 */
const WB_EXAMPLE_JOBS = new Set();
async function aiFillExamples(btn, ids) {
  const bookId = Number(WB.bookId);
  const auth = typeof Auth !== 'undefined' ? Auth : {};
  const token = auth.token, account = (auth.user || {}).id;
  const sameAccount = () => auth.token === token && (auth.user || {}).id === account;
  if (WB_EXAMPLE_JOBS.has(bookId) || (btn && btn.disabled)) return;
  const book = curBook(), label = book && book.title ? book.title : '词书 ' + bookId;
  const old = btn ? btn.innerHTML : '';
  let timer = null, polling = false, stopped = false;
  WB_EXAMPLE_JOBS.add(bookId);
  if (btn) { btn.disabled = true; btn.innerHTML = '启动中…'; }
  const finish = () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    WB_EXAMPLE_JOBS.delete(bookId);
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  };
  const refresh = () => String(WB.bookId) === String(bookId) && (!btn || btn.isConnected !== false);
  try {
    const r = await api('/api/admin/word/phrase-examples', {
      method: 'POST', body: { book_id: bookId, ids: ids || [], scope: 'missing' },
    });
    if (!sameAccount()) { finish(); return; }
    if (!r.started) {
      toast({ done: '这些短语都已经有例句了', running: '正在生成中，请稍候刷新', 'no-ai': 'AI 密钥还没配好，可在「编辑」里手填例句' }[r.reason] || '无需生成', r.reason === 'done' ? 'ok' : 'err');
      finish();
      return;
    }
    toast(label + '：开始生成 ' + r.pending + ' 条短语的例句（AI 在后台跑，可先做别的）', 'ok');
    if (!btn) { finish(); return; }
    btn.innerHTML = 'AI 生成中…';
    timer = setInterval(async () => {
      if (polling || stopped) return;
      if (!sameAccount()) { finish(); return; }
      polling = true;
      try {
        const s = await api('/api/admin/word/phrase-examples/status?book_id=' + encodeURIComponent(bookId), { silent: true });
        if (!sameAccount()) { finish(); return; }
        btn.innerHTML = `AI 生成中 ${s.done}/${s.total}`;
        if (!s.running) {
          finish();
          if (refresh()) await loadList().catch(() => {});
          if (!sameAccount()) return;
          toast(`${label}：例句补齐完成：成功 ${s.done} 条${s.fail ? `，失败 ${s.fail} 条（可单行重试或直接手填）` : ''}`, s.fail ? 'err' : 'ok');
        }
      } catch (e) {
        finish();
        if (!sameAccount()) return;
        toast(`${label}：获取生成进度失败，后台任务可能仍在运行，请稍后回到这本书刷新查看。`, 'err');
      } finally {
        polling = false;
      }
    }, 2000);
  } catch (e) {
    finish();
    if (!sameAccount()) return;
    toast('启动失败：' + e.message, 'err');
  }
}

/**  一键给「所有短语书」补齐例句（词书列表页的按钮）
 *  不用一本一本点：把所有短语书里还没例句的短语排成一队，AI 在后台并发 3 条慢慢生成，
 *  每条一生成就写回，学生端刷新就能用；页面在这里轮询总进度。 */
async function aiFillExamplesAllBooks(btn) {
  const old = btn ? btn.innerHTML : '';
  try {
    const r = await api('/api/admin/word/phrase-examples-all', { method: 'POST', body: { scope: 'missing' } });
    if (!r.started) {
      toast({ done: '所有短语书都已经有例句了', running: '正在生成中，请稍候', 'no-ai': 'AI 还没配好密钥' }[r.reason] || '无需生成', r.reason === 'done' ? 'ok' : 'err');
      return;
    }
    toast(`开始给 ${r.books} 本短语书补齐例句，共 ${r.pending} 条短语（AI 在后台跑）`, 'ok');
    if (!btn) return;
    btn.disabled = true;
    const t = setInterval(async () => {
      try {
        const s = await api('/api/admin/word/phrase-examples-all/status');
        btn.innerHTML = `AI 生成中 ${s.done}/${s.total}`;
        if (!s.running) {
          clearInterval(t);
          btn.disabled = false; btn.innerHTML = old;
          render();
          toast(`全部短语书例句补齐完成：成功 ${s.done} 条${s.fail ? `，失败 ${s.fail} 条。（没成功的多是 AI 生成不出含该短语的句子，可在书里点单行「＋ AI 生成例句」重试或手动填写）` : ''}`, s.fail ? 'err' : 'ok');
        }
      } catch (e) {
        clearInterval(t); btn.disabled = false; btn.innerHTML = old;
      }
    }, 2000);
  } catch (e) {
    toast('启动失败：' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
}

/**  AI 生成词库 → 预览 → 确认导入当前词书 */
function aiGenerate() {
  const book = curBook();
  if (!book) return toast('请先新建或选择一本词书', 'err');
  const kindLabel = WB.tab === 'pos' ? '词形转换' : WB.tab === 'sentence' ? '英文句子' : WB.tab === 'phrase' ? '短语' : '单词表';
  modal({
    title: `AI 生成${kindLabel}`,
    body: `
      <div class="field"><label>年级 / 教材</label><input class="input" id="agGrade" value="${esc(book.grade || '')}" placeholder="如：八年级 / 人教版八上"></div>
      <div class="field"><label>单元</label><input class="input" id="agUnit" placeholder="如：Unit 3（可空）"></div>
      <div class="field"><label>数量</label><input class="input" id="agCount" type="number" min="3" max="50" value="10"></div>
      <div class="field"><label>主题 / 要求</label><input class="input" id="agTopic" placeholder="选填"></div>`,
    okText: '开始生成',
    onOk: async (w) => {
      const body = {
        kind: WB.tab,
        grade: w.querySelector('#agGrade').value,
        unit: w.querySelector('#agUnit').value,
        count: Number(w.querySelector('#agCount').value) || 10,
        topic: w.querySelector('#agTopic').value,
      };
      const r = await api('/api/admin/word/ai/generate', { method: 'POST', body });
      aiPreview(Array.isArray(r.rows) ? r.rows : [], kindLabel);
      return true;
    },
  });
}

const AI_COLS = {
  word: [['word', '单词'], ['phonetic', '音标'], ['pos', '词性'], ['meaning', '释义'], ['example', '例句'], ['unit', '单元']],
  phrase: [['phrase', '短语'], ['meaning', '释义'], ['unit', '单元']],
  sentence: [['text', '句子'], ['translation', '翻译'], ['unit', '单元']],
  pos: [['base_word', '原词'], ['base_pos', '原词词性'], ['base_meaning', '原词译'], ['target_word', '目标词'], ['target_pos', '词性'], ['meaning', '释义'], ['affix', '词缀'], ['unit', '单元']],
};

/** 生成结果预览表 + 一键导入 */
function aiPreview(rows, kindLabel) {
  const cols = AI_COLS[WB.tab];
  const body = `
    <p class="w-tip" style="margin:0 0 10px">AI 生成了 <b>${rows.length}</b> 行${esc(kindLabel)}，请检查（也可以不导入，重新生成）。导入到：<b>${esc((curBook() || {}).title || '')}</b></p>
    <div style="max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px">
      <table class="tbl" style="width:100%"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(String(r[c[0]] == null ? '' : r[c[0]]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </div>`;
  modal({
    title: '预览生成结果',
    wide: true,
    body,
    okText: ' 导入当前词书',
    onOk: async () => {
      const r = await api('/api/admin/word/ai/save', { method: 'POST', body: { bookId: Number(WB.bookId), kind: WB.tab, rows } });
      toast(r.msg || '已导入', 'ok');
      refreshWords();
      return true;
    },
  });
}

async function doUpload(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const bookId = Number(WB.bookId) || 0;
  const tip = document.getElementById('wdUpTip');
  if (!bookId) return toast('请先新建或选择一本词书', 'err');
  const fd = new FormData();
  fd.append('file', f, f.name);
  fd.append('kind', WB.tab);
  fd.append('book_id', bookId);
  if (tip) tip.textContent = '解析中…';
  try {
    const r = await api('/api/admin/word/upload', { method: 'POST', body: fd, raw: true });
    toast(r.msg || '导入完成', 'ok');
    await refreshWords();
    const tip2 = document.getElementById('wdUpTip');
    if (tip2) tip2.textContent = `上次导入：${r.msg}`;
  } catch (err) {
    toast('上传失败：' + err.message, 'err');
    if (tip) tip.textContent = '上传失败：' + err.message;
  }
}

