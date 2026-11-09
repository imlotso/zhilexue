/* 魔方助教复刻 UI 第二期（2026-10-29）
 * 覆盖 mfbankui.js 里的 viewMfBank / viewMfCapture，并新增 viewMfSet（设置）。
 *  - 题库管理（R3 重做）：左栏 treePanel（学段/学科/版本级联 + 章节|知识点 + 多层折叠树）；右栏胶囊筛选 + 批量条（批量挂分类/试题篮/标签/AI/删除）+ 题卡（qcard.js）。
 *  - 网络采集：浏览器 / 试题采集 / 整卷下载 三个标签；代理内嵌浏览器（组卷网 / 菁优网 / 二一组卷网快捷入口）。
 *  - 设置：AI 配置管理（学生端+管理后台全部 AI 能力按可共用模型分组配置）/ 字典树映射。
 * 依赖：mfbankui.js 的 mfState / mfCommitForm / MF_API / MF_TYPES 常量；admin.js 的 api/esc/toast/modal/ic/elConfirm/render。
 */
'use strict';
const MFX = '/api/admin/bank/mf/ext';
const MF_SITES = [
  { k: 'zujuan', t: '组卷网', url: 'https://zujuan.xkw.com/', host: 'zujuan.xkw.com' },
  { k: 'jyeoo', t: '菁优网', url: 'https://www.jyeoo.com/', host: 'jyeoo.com' },
  { k: '21cnjy', t: '二一组卷网', url: 'https://www.21cnjy.com/', host: '21cnjy.com' },
];
const MF_STAGE_NAMES = { primary: '小学', junior: '初中', senior: '高中' };
const MF_DIFF_NAMES = { 1: '很容易', 2: '较易', 3: '中等', 4: '较难', 5: '很难' };

/* ================================================================ 题库管理（R3：洋葱式左栏 + 标签式筛选 + 题卡）
 * 左栏：treePanel（public/admin/treepanel.js）——「学段 / 学科 / 版本」级联 + 章节 | 知识点 + 多层可折叠树（含子孙题数、搜索、多选）
 * 右栏：胶囊筛选（题型 / 难度 / 来源 / 年份 / 完整度，可多选）+ 关键字 + 已选节点标签条 + 排序；题卡见 qcard.js；批量挂分类用树形选择器
 * 只局部刷新右栏（r3Main），左树不重绘，展开状态和滚动位置都保留。 */
const R3_SRC = [['capture', '网络采集'], ['local', '本地录入'], ['recog', '录题识别']];
const R3_COMP = [['full', '答案解析齐全'], ['noans', '缺答案'], ['noana', '缺解析'], ['nocat', '缺分类']];
async function viewMfBank() {
  const st = mfState('mfq');
  if (!st.tp) st.tp = { stage: st.stage || 'primary', subject: st.subject || '数学', edition: st.edition || '', kind: st.pmode === 'knowledge' ? 'knowledge' : 'textbook', sel: [], open: {}, multi: false, q: '' };
  if (!st.f) st.f = { type: [], diff: [], src: [], year: [], comp: [] };
  if (!st.f.subtype) st.f.subtype = [];
  if (st.kw == null) st.kw = '';
  if (!st.sort) st.sort = 'new';
  if (!st.pg) st.pg = 1;
  if (!st.sel) st.sel = {};
  if (st.special === 'uncat') { st.special = ''; st.f.comp = ['nocat']; }   // 旧入口「未分类题目」= 完整度里的「缺分类」
  const badges = await api(`${MFX}/badge-counts`, { silent: true }).catch(() => ({ uncat: 0, review: 0 }));

  const html = `
  <div class="r3-bank">
    <aside class="card r3-side" aria-label="章节 / 知识点目录"><div id="r3Tree"><div class="r3-tp-loading">目录加载中…</div></div></aside>
    <section class="card r3-main">
      <div class="card-h r3-mainh">
        <h3>${ic('doc')} <span id="r3Title">${st.special === 'review' ? '待审核题目' : '题库管理'}</span></h3>
        <div class="card-h-r r3-hbtns">
          <button class="btn ghost sm ${badges.review ? 'mf-revhot' : ''}" id="mfReviewBtn">${st.special === 'review' ? '返回题库' : '待审核题目'}<b class="rev-n">${badges.review || 0}</b></button>
          <button class="btn primary sm" id="mfIntakeBtn">${ic('upload')} 录题中心</button>
        </div>
      </div>
      <div id="r3Main"><div class="r3-loading">题目加载中…</div></div>
    </section>
  </div>`;

  return {
    html,
    after: () => {
      const main = document.getElementById('r3Main');
      let tp = null;
      let data = { list: [], total: 0, page: 1 };
      let facetKey = ''; let years = [];
      const size = 20;
      let seq = 0;

      const reloadAll = async () => { if (tp) await tp.reload(); await loadMain(); };
      document.getElementById('mfIntakeBtn').onclick = () => { location.hash = '#/intake'; };
      document.getElementById('mfReviewBtn').onclick = () => { st.special = st.special === 'review' ? '' : 'review'; st.pg = 1; render(); };

      qbFab({ pages: ['mfq'] });

      const selIds = () => Object.keys(st.sel).filter((k) => st.sel[k]).map(Number);

      /* —— 右栏 —— */
      const chipRow = (key, label, opts) => {
        const cur = st.f[key] || [];
        return `<div class="r3-frow"><span class="r3-fk">${label}</span><div class="r3-chips" role="group" aria-label="${label}">
          <button type="button" class="r3-chip ${cur.length ? '' : 'on'}" data-fk="${key}" data-fv="" aria-pressed="${!cur.length}">全部</button>
          ${opts.map(([v, t]) => `<button type="button" class="r3-chip ${cur.includes(String(v)) ? 'on' : ''}" data-fk="${key}" data-fv="${esc(v)}" aria-pressed="${cur.includes(String(v))}">${esc(t)}</button>`).join('')}
        </div></div>`;
      };

      async function loadFacets(ctx) {
        const k = ctx.stage + '|' + ctx.subject;
        if (k === facetKey) return;
        facetKey = k;
        const f = await api(`${MF_API}/questions-facets?stage=${encodeURIComponent(ctx.stage)}&subject=${encodeURIComponent(ctx.subject)}`, { silent: true }).catch(() => ({ years: [] }));
        years = (f.years || []).map((y) => y.v);
        st.f.year = (st.f.year || []).filter((y) => years.includes(y));
      }

      function query(ctx) {
        const p = {
          page: st.pg, size, stage: ctx.stage, subject: ctx.subject,
          nodes: ctx.sel.join(','), type: st.f.type.join(','), question_subtype: st.f.subtype.filter((code) => QSubtype.matchesSubject(QSubtype.find(code), ctx.subject)).join(','), difficulty: st.f.diff.join(','), source_type: st.f.src.join(','),
          year: st.f.year.join(','), complete: st.f.comp.join(','), kw: st.kw, sort: st.sort === 'used' ? 'used' : '',
        };
        return Object.entries(p).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      }

      async function loadMain() {
        const my = ++seq;
        if (!tp) return;
        const ctx = tp.ctx();
        if (st.special === 'review') {
          const d = await api(`${MFX}/review-list?page=${st.pg}&size=${size}`).catch(() => ({ list: [], total: 0, page: 1 }));
          if (my !== seq) return;
          renderReview(d);
          return;
        }
        await loadFacets(ctx);
        const d = await api(`${MF_API}/questions?${query(ctx)}`).catch(() => null);
        if (my !== seq || !d) return;
        data = d; st.pg = d.page;
        renderMain(ctx);
      }

      function renderMain(ctx) {
        const selCount = selIds().length;
        const pageIds = data.list.map((q) => q.id);
        const allOn = pageIds.length && pageIds.every((id) => st.sel[id]);
        const anyF = Object.values(st.f).some((a) => a.length) || st.kw;
        const selChips = ctx.sel.map((id) => {
          const path = ctx.pathOf(id);
          return `<span class="r3-selchip" title="${esc(path.join(' / '))}">${esc(path.slice(-2).join(' › '))}<button type="button" data-unsel="${id}" aria-label="移除">${TPN_SVG.close}</button></span>`;
        }).join('');
        const acts = (q) => {
          const inB = QB.has(q.id);
          return `<button type="button" class="r3-abtn" data-qedit="${q.id}">编辑</button>
            <button type="button" class="r3-abtn" data-qhang="${q.id}">挂分类</button>
            <button type="button" class="r3-abtn danger" data-qdel="${q.id}">删除</button>
            <button type="button" class="r3-bbtn ${inB ? 'in' : ''}" data-qbask="${q.id}">${inB ? '已加入试题篮' : '+ 加入试题篮'}</button>${qbGroupKey(q) ? ` <button type="button" class="r3-bbtn" data-qgroup="${q.id}">整组加入</button>` : ''}`;
        };
        main.innerHTML = `
          <div class="r3-filter">
            ${chipRow('type', '题型', (typeof MF_TYPES !== 'undefined' ? MF_TYPES : Object.entries(QC_TYPE_FALLBACK)))}
            ${QSubtype.list.some((x) => QSubtype.matchesSubject(x, ctx.subject)) ? chipRow('subtype', '细分题型', QSubtype.list.filter((x) => QSubtype.matchesSubject(x, ctx.subject)).map((x) => [x.code, x.label])) : ''}
            ${chipRow('diff', '难度', Object.entries(QC_DIFF))}
            ${chipRow('src', '来源', R3_SRC)}
            ${years.length ? chipRow('year', '年份', years.map((y) => [y, y])) : ''}
            ${chipRow('comp', '完整度', R3_COMP)}
            <div class="r3-frow r3-kwrow"><span class="r3-fk">关键字</span>
              <label class="r3-kw-inp">${TPN_SVG.search}<input type="search" id="r3Kw" placeholder="搜题干 / 答案 / 解析 / 来源 / 题号" value="${esc(st.kw)}"></label>
              ${anyF ? '<button type="button" class="r3-link" id="r3Reset">清空筛选</button>' : ''}
            </div>
          </div>
          ${ctx.sel.length ? `<div class="r3-selbar"><span class="r3-fk">已选${ctx.kind === 'textbook' ? '章节' : '知识点'}</span><div class="r3-selchips">${selChips}</div><button type="button" class="r3-link" id="r3SelClear">清空</button><span class="r3-hintx">含下级节点的题</span></div>` : ''}
          <div class="r3-resbar">
            <label class="r3-allck"><input type="checkbox" id="r3All" ${allOn ? 'checked' : ''} ${pageIds.length ? '' : 'disabled'}>全选本页</label>
            <span class="r3-total">筛选到题目 <b id="r3Total">${data.total}</b> 道</span>
            <div class="r3-sort" role="group" aria-label="排序">
              <button type="button" class="${st.sort !== 'used' ? 'on' : ''}" data-sort="new">最新录入</button>
              <button type="button" class="${st.sort === 'used' ? 'on' : ''}" data-sort="used">组卷最多</button>
            </div>
          </div>
          <div class="r3-batch ${selCount ? 'on' : ''}">
            <span class="r3-batch-n">已选 <b>${selCount}</b> 题</span>
            <button class="btn sm" data-batch="hang" ${selCount ? '' : 'disabled'}>批量挂分类</button>
            <button class="btn ghost sm" data-batch="qb" ${selCount ? '' : 'disabled'}>加入试题篮</button>
            <button class="btn ghost sm" data-batch="tag" ${selCount ? '' : 'disabled'}>打标签</button>
            <button class="btn ghost sm" data-batch="aiclean" ${selCount ? '' : 'disabled'}>AI 整理</button>
            <button class="btn ghost sm" data-batch="aisug" ${selCount ? '' : 'disabled'}>AI 建议</button>
            <button class="btn ghost sm" data-batch="wrong" ${selCount ? '' : 'disabled'}>标记错题</button>
            <button class="btn danger sm" data-batch="del" ${selCount ? '' : 'disabled'}>删除</button>
            ${selCount ? '<button type="button" class="r3-link" data-batch="clear">取消选择</button>' : ''}
          </div>
          <div class="r3-list" id="r3List">
            ${data.list.length ? data.list.map((q, i) => qcCard(q, { no: (data.page - 1) * size + i + 1, checked: !!st.sel[q.id], acts: acts(q), hangBtn: true })).join('')
              : `<div class="r3-empty"><b>没有符合条件的题目</b><span>${ctx.sel.length || anyF ? '换个节点或放宽筛选条件试试' : '到 <a href="#/intake">录题中心</a> 导入或手动创建题目'}</span></div>`}
          </div>
          ${data.total > size ? pagerHTML(data.page, size, data.total, 'r3pg') : ''}`;
        bindMain(ctx);
      }

      function bindMain(ctx) {
        const reload = () => { st.pg = 1; loadMain(); };
        main.querySelectorAll('[data-fk]').forEach((b) => {
          b.onclick = () => {
            const k = b.dataset.fk; const v = b.dataset.fv;
            if (!v) st.f[k] = [];
            else st.f[k] = st.f[k].includes(v) ? st.f[k].filter((x) => x !== v) : [...st.f[k], v];
            reload();
          };
        });
        const kw = main.querySelector('#r3Kw');
        let tm = null;
        kw.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { st.kw = kw.value.trim(); reload(); }, 400); };
        kw.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(tm); st.kw = kw.value.trim(); reload(); } };
        const rs = main.querySelector('#r3Reset');
        if (rs) rs.onclick = () => { st.f = { type: [], subtype: [], diff: [], src: [], year: [], comp: [] }; st.kw = ''; reload(); };
        main.querySelectorAll('[data-unsel]').forEach((b) => { b.onclick = () => tp.remove(b.dataset.unsel); });
        const sc = main.querySelector('#r3SelClear');
        if (sc) sc.onclick = () => tp.clear();
        main.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { if (st.sort !== b.dataset.sort) { st.sort = b.dataset.sort; reload(); } }; });
        const all = main.querySelector('#r3All');
        all.onchange = () => { data.list.forEach((q) => { if (all.checked) st.sel[q.id] = true; else delete st.sel[q.id]; }); renderMain(ctx); };
        main.querySelectorAll('[data-qck]').forEach((ck) => {
          ck.onchange = () => {
            if (ck.checked) st.sel[ck.dataset.qck] = true; else delete st.sel[ck.dataset.qck];
            renderBatch(); const card = ck.closest('.r3-qcard'); if (card) card.classList.toggle('sel', ck.checked);
            const ids = data.list.map((q) => q.id); all.checked = ids.length && ids.every((id) => st.sel[id]);
          };
        });
        main.querySelectorAll('[data-qedit]').forEach((b) => { b.onclick = () => mfQEdit(b.dataset.qedit, reloadAll); });
        main.querySelectorAll('[data-qhang]').forEach((b) => {
          b.onclick = () => { const q = data.list.find((x) => String(x.id) === b.dataset.qhang); r3HangDialog([Number(b.dataset.qhang)], { q, ctx: tp.ctx(), done: reloadAll }); };
        });
        main.querySelectorAll('[data-qdel]').forEach((b) => {
          b.onclick = async () => {
            if (!(await elConfirm({ title: '删除题目', message: '删除后不可恢复（试卷里引用它的行会一并移除）。确定？', okText: '删除', danger: true }))) return;
            await api(`${MF_API}/questions/${b.dataset.qdel}`, { method: 'DELETE' }); QB.remove(b.dataset.qdel); delete st.sel[b.dataset.qdel]; toast('已删除', 'ok'); reloadAll();
          };
        });
        main.querySelectorAll('[data-qbask]').forEach((b) => {
          b.onclick = () => {
            const q = data.list.find((x) => String(x.id) === b.dataset.qbask);
            const on = QB.toggle(q);
            b.classList.toggle('in', on); b.textContent = on ? '已加入试题篮' : '+ 加入试题篮';
            toast(on ? '已加入试题篮（去「智能组卷」生成试卷）' : '已移出试题篮', 'ok');
          };
        });
        main.querySelectorAll('[data-qgroup]').forEach(b => b.onclick = async () => { if (await qbAddWholeGroup(b.dataset.qgroup)) renderMain(ctx); });
        main.querySelectorAll('[data-page="r3pg"]').forEach((b) => {
          b.onclick = () => { if (b.disabled) return; const to = Number(b.dataset.to); if (!to) return; st.pg = to; loadMain().then(() => { const top = document.querySelector('.r3-main'); if (top) top.scrollIntoView({ block: 'start', behavior: 'smooth' }); }); };
        });
        const ps = main.querySelector('[data-psize="r3pg"]');
        if (ps) ps.style.display = 'none';
        bindBatch();
        qcBind(main.querySelector('#r3List'));
      }

      function renderBatch() {
        const n = selIds().length;
        const bar = main.querySelector('.r3-batch');
        if (!bar) return;
        bar.classList.toggle('on', n > 0);
        bar.querySelector('.r3-batch-n b').textContent = n;
        bar.querySelectorAll('button[data-batch]').forEach((b) => { if (b.dataset.batch !== 'clear') b.disabled = !n; });
        let clr = bar.querySelector('[data-batch="clear"]');
        if (n && !clr) { clr = document.createElement('button'); clr.type = 'button'; clr.className = 'r3-link'; clr.dataset.batch = 'clear'; clr.textContent = '取消选择'; bar.appendChild(clr); bindBatch(); }
        if (!n && clr) clr.remove();
      }
      function bindBatch() {
        main.querySelectorAll('[data-batch]').forEach((b) => {
          b.onclick = async () => {
            const ids = selIds();
            const op = b.dataset.batch;
            if (op === 'clear') { st.sel = {}; renderMain(tp.ctx()); return; }
            if (!ids.length) return toast('先勾选题目', 'err');
            if (op === 'hang') return r3HangDialog(ids, { ctx: tp.ctx(), done: async () => { st.sel = {}; await reloadAll(); } });
            if (op === 'qb') {
              const qs = ids.map((id) => data.list.find((q) => q.id === id) || { id, type: 'single' });
              const n = QB.addMany(qs);
              toast(n ? `已把 ${n} 题加入试题篮` : '这些题已经都在试题篮里了', 'ok');
              renderMain(tp.ctx());
              return;
            }
            return mfBatch(op, ids, st, reloadAll);
          };
        });
      }

      function renderReview(d) {
        const card = (it, i) => {
          const meta = [it.subject || it.pu_subject, MF_STAGE_NAMES[it.stage || it.pu_stage] || '', it.grade || it.pu_grade, it.point || it.pu_point, it.up_status === 'reviewed' ? '已核对' : '待审核']
            .filter(Boolean).map((t) => `<span class="r3-badge">${esc(t)}</span>`).join('');
          const imgs = it.up_images || [];
          return `<article class="r3-qcard"><header class="r3-qhead"><b class="r3-qno">${(d.page - 1) * size + i + 1}</b><div class="r3-badges">${meta}</div></header>
            <div class="r3-qbody"><div class="r3-hintx">学生：${esc(it.student_name || '')}${it.student_grade ? ' · ' + esc(it.student_grade) : ''} · ${(it.up_created || '').slice(0, 16).replace('T', ' ')}</div>
              <div class="r3-stem">${esc(it.stem || it.up_stem_text || '（无题干，看图核对）').replace(/\n/g, '<br>')}</div>
              ${imgs.length ? `<div class="r3-qfigs">${imgs.map((u, k) => qcFig(u, k)).join('')}</div>` : ''}</div>
            <footer class="r3-qfoot"><div class="r3-qmeta"></div><div class="r3-qacts"><button type="button" class="r3-bbtn" data-rev="${it.up_id}">核对</button></div></footer></article>`;
        };
        main.innerHTML = `<div class="r3-resbar"><span class="r3-total">学生上传待核对 <b>${d.total || 0}</b> 道</span></div>
          <div class="r3-list" id="r3List">${(d.list || []).length ? d.list.map(card).join('') : '<div class="r3-empty"><b>没有待核对的学生上传题目</b><span>学生在错题本里上传的题会出现在这里</span></div>'}</div>
          ${(d.total || 0) > size ? pagerHTML(d.page, size, d.total, 'r3pg') : ''}`;
        main.querySelectorAll('[data-rev]').forEach((a) => { a.onclick = () => mfReviewDialog(d.list.find((x) => x.up_id === Number(a.dataset.rev)), reloadAll); });
        main.querySelectorAll('[data-page="r3pg"]').forEach((b) => { b.onclick = () => { if (b.disabled) return; st.pg = Number(b.dataset.to) || 1; loadMain(); }; });
        qcBind(main.querySelector('#r3List'));
      }

      tp = treePanel(document.getElementById('r3Tree'), {
        state: st.tp,
        onScope: () => { st.pg = 1; },
        onChange: () => { st.pg = 1; loadMain(); },
      });
    },
  };
}

/** 批量挂分类（R3）：左右两个树形选择器（章节 / 知识点），选好节点一次挂上；单题「挂分类」也用它（默认替换原分类）
 *  ids：题目 id；opt.q：单题时传入题目（预先勾上它已挂的节点）；opt.ctx：当前左栏的 学段 / 学科 / 版本 */
function r3HangDialog(ids, opt = {}) {
  const q = opt.q || null;
  const c = opt.ctx || {};
  const base = { stage: (q && q.stage) || c.stage, subject: (q && q.subject) || c.subject, edition: (q && q.edition) || c.edition || '' };
  const preC = q ? (q.chapters || []).map((x) => String(x.id)) : [];
  const preK = q ? (q.knows || []).map((x) => String(x.id)) : [];
  const stC = { ...base, kind: 'textbook', sel: preC, open: {}, q: '' };
  const stK = { ...base, kind: 'knowledge', sel: preK, open: {}, q: '' };
  let tc = null; let tk = null;
  const chips = (t, box) => {
    const cx = t.ctx();
    box.innerHTML = cx.sel.length ? cx.sel.map((id) => `<span class="r3-selchip" title="${esc(cx.pathOf(id).join(' / '))}">${esc(cx.pathOf(id).slice(-2).join(' › '))}<button type="button" data-x="${id}" aria-label="移除">${TPN_SVG.close}</button></span>`).join('')
      : '<span class="r3-hintx">还没有选择</span>';
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => t.remove(b.dataset.x); });
  };
  modal({
    title: ids.length > 1 ? `批量挂分类 · 已选 ${ids.length} 题` : `挂分类 · 题目 #${ids[0]}`,
    wide: true, okText: '挂上分类',
    body: `<div class="r3-hang">
      <div class="r3-hang-col"><div class="r3-hang-h"><b>章节分类</b><span>教材目录 · 年级 › 册别 › 章 › 节</span></div><div id="r3HgC"></div><div class="r3-hang-sel" id="r3HgCs"></div></div>
      <div class="r3-hang-col"><div class="r3-hang-h"><b>知识点分类</b><span>知识点树</span></div><div id="r3HgK"></div><div class="r3-hang-sel" id="r3HgKs"></div></div>
    </div>
    <div class="r3-hang-mode" role="radiogroup" aria-label="挂法">
      <label><input type="radio" name="r3hgm" value="1" ${q ? 'checked' : ''}> 替换原有分类<em>先清掉这些题原来挂的章节 / 知识点，再挂上面选的</em></label>
      <label><input type="radio" name="r3hgm" value="0" ${q ? '' : 'checked'}> 追加到原有分类<em>保留原来的挂载，再多挂上面选的</em></label>
    </div>`,
    onMount: (w) => {
      tc = treePanel(w.querySelector('#r3HgC'), { state: stC, kinds: ['textbook'], pick: true, maxHeight: '300px', onChange: () => chips(tc, w.querySelector('#r3HgCs')) });
      tk = treePanel(w.querySelector('#r3HgK'), { state: stK, kinds: ['knowledge'], pick: true, maxHeight: '300px', onChange: () => chips(tk, w.querySelector('#r3HgKs')) });
    },
    onOk: async (w, showErr) => {
      const cs = tc ? tc.ctx().sel : []; const ks = tk ? tk.ctx().sel : [];
      if (!cs.length && !ks.length) return showErr('请至少勾选一个章节或知识点节点');
      const replace = (w.querySelector('input[name="r3hgm"]:checked') || {}).value === '1';
      const r = await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'node', nodes: [...cs, ...ks], replace: replace ? 1 : 0 } });
      toast(`已给 ${ids.length} 题挂上 ${cs.length ? cs.length + ' 个章节' : ''}${cs.length && ks.length ? ' + ' : ''}${ks.length ? ks.length + ' 个知识点' : ''}`, 'ok');
      if (typeof opt.done === 'function') opt.done(r);
    },
  });
}

/** 图片查看大图 */
function mfImgView(src) {
  modal({
    title: '查看图片', okText: '关闭',
    body: `<div style="text-align:center"><img src="${esc(src)}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`,
  });
}

/** 挂分类（章节分类 + 知识点分类，两种都必须挂）：未分类题目快捷操作，保存后离开未分类列表 */
async function mfHangDialog(qid, done) {
  const d = await api(`${MF_API}/questions/${qid}`);
  const q = d.question;
  const cur = (q.nodes || []).slice();
  const trees = await tpTrees();
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  if (!chapTrees.length || !knowTrees.length) return toast('缺少章节树或知识点树（学段+科目的种子树启动时会自动创建）', 'err');
  // 学生上传的占位题：single/multi 无选项过不了校验，自动降级为解答题
  let type = q.type;
  if ((type === 'single' || type === 'multi') && (q.options || []).length < 2) type = 'answer';
  const treeSel = (id, label, list) => {
    const ordered = tpOrder(list, q.subject, q.stage);   // 同学科学段的排前面、默认版本第一（R2）
    return `<div class="field"><label>${label}</label><select id="${id}" class="inp">${ordered.map((t, i) => `<option value="${t.id}" ${i === 0 ? 'selected' : ''}>${esc(treeLabel(t))}</option>`).join('')}</select></div>`;
  };
  modal({
    title: `挂分类 · 题目 #${qid}`, wide: true, okText: '保存',
    body: `<div class="mf-grid2">
      <div>${treeSel('hgCTree', '章节分类（教材目录）', chapTrees)}<div id="hgCNodes" class="mf-pick" style="max-height:240px"></div></div>
      <div>${treeSel('hgKTree', '知识点分类', knowTrees)}<div id="hgKNodes" class="mf-pick" style="max-height:240px"></div></div>
    </div>
    <div class="hint" style="margin-top:6px">两边的分类都至少勾一项；保存后这道题就从「未分类」进入对应章节 / 知识点的筛选范围</div>`,
    onOk: async (w, showErr) => {
      const chapIds = [...w.querySelectorAll('.hg-cnd:checked')].map((x) => Number(x.value));
      const knowIds = [...w.querySelectorAll('.hg-knd:checked')].map((x) => Number(x.value));
      if (!chapIds.length) return showErr('章节分类至少勾一项');
      if (!knowIds.length) return showErr('知识点分类至少勾一项');
      await api(`${MF_API}/questions/${qid}`, { method: 'PUT', body: {
        stem: q.stem, stem_html: q.stem_html, options: q.options, answer: q.answer, analysis: q.analysis,
        subject: q.subject, stage: q.stage, grade: q.grade, type, difficulty: q.difficulty, point: q.point,
        material: q.material, source: q.source, year: q.year, images: q.images,
        source_type: q.source_type, source_detail: q.source_detail, tags: q.tags,
        nodes: [...new Set([...chapIds, ...knowIds])],
      } });
      toast('已挂章节 + 知识点分类', 'ok'); if (typeof done === 'function') done();
    },
    onMount: (w) => {
      const load = async (treeSelId, boxId, cls) => {
        const tid = w.querySelector('#' + treeSelId).value;
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${cur.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bind = (treeSelId, boxId, cls) => {
        w.querySelector('#' + treeSelId).onchange = () => load(treeSelId, boxId, cls);
        load(treeSelId, boxId, cls);
      };
      bind('hgCTree', 'hgCNodes', 'hg-cnd');
      bind('hgKTree', 'hgKNodes', 'hg-knd');
    },
  });
}

/** 逐条核对学生上传的错题：看图 → 改字段/挂知识点 → 通过 / 仅保存 / 拒绝 */
async function mfReviewDialog(it, done) {
  if (!it) return;
  const qid = it.qid;
  const trees = await tpTrees();
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const curSub = it.subject || it.pu_subject || '';
  const curStage = it.stage || it.pu_stage || '';
  const knowOrd = tpOrder(knowTrees, curSub, curStage), chapOrd = tpOrder(chapTrees, curSub, curStage);   // R2：同学科学段的排前面、默认版本第一
  const def = knowOrd[0], defC = chapOrd[0];
  let curNodes = [];
  try { curNodes = ((await api(`${MF_API}/questions/${qid}`)).question.nodes || []).slice(); } catch (e) { /* 忽略 */ }
  const imgs = it.up_images || [];
  let qImgs = [];
  try { qImgs = typeof it.q_images === 'string' ? (JSON.parse(it.q_images || '[]') || []) : (it.q_images || []); } catch (e) { qImgs = []; }
  const reviewSave = async (w, status, showErr) => {
    const chapIds = [...w.querySelectorAll('.rv-cnd:checked')].map((x) => Number(x.value));
    const knowIds = [...w.querySelectorAll('.rv-nd:checked')].map((x) => Number(x.value));
    if (status === 'approved') {
      if (!chapTrees.length || !knowTrees.length) { toast('缺少章节树或知识点树，请先建树再审核', 'err'); return; }
      if (!chapIds.length) return showErr('审核通过前请先勾选「章节分类」——每道题必须同时归属章节和知识点');
      if (!knowIds.length) return showErr('审核通过前请先勾选「知识点分类」——每道题必须同时归属章节和知识点');
    }
    const sub = w.querySelector('#rvSub').value, stage = w.querySelector('#rvStage').value;
    const grade = w.querySelector('#rvGrade').value.trim(), point = w.querySelector('#rvPoint').value.trim();
    await api(`${MF_API}/questions/${qid}`, { method: 'PUT', body: {
      stem: w.querySelector('#rvStem').value.trim() || '（纸质错题，看图作答）',
      answer: w.querySelector('#rvAns').value.trim(),
      subject: sub, stage, grade, point,
      nodes: [...new Set([...chapIds, ...knowIds])], options: [], tags: [], images: qImgs,
      type: 'answer', difficulty: it.difficulty || 3,
      analysis: it.analysis || '', material: it.material || '', source: it.source || '学生上传',
      source_type: it.source_type || 'local', source_detail: it.source_detail || {},
    } });
    await api(`/api/admin/bank/uploads/${it.up_id}/review`, { method: 'POST', body: { status, subject: sub, stage, grade, point } });
    toast(status === 'approved' ? '审核通过，已归类入库' : '已保存核对结果', 'ok');
    w.remove(); if (typeof done === 'function') done();
  };
  modal({
    title: `核对学生错题（学生：${it.student_name || ''}）`, wide: true, okText: ' 审核通过',
    body: `
      ${imgs.length ? `<div class="mf-rvimgs" style="margin-bottom:10px">${imgs.map((u) => `<img src="${esc(u)}" data-rvimg="${esc(u)}" title="点击看大图">`).join('')}</div>` : ''}
      <div class="mf-form">
        <div class="field"><label>学科</label><select id="rvSub">${MF_SUBJECTS.map((sp) => `<option ${curSub === sp ? 'selected' : ''}>${sp}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="rvStage"><option value="">未分组</option>${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${curStage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>年级</label><input id="rvGrade" class="inp" value="${esc(it.grade || it.pu_grade || '')}"></div>
        <div class="field"><label>知识点标签</label><input id="rvPoint" class="inp" value="${esc(it.point || it.pu_point || '')}"></div>
      </div>
      <div class="field wide"><label>题干（AI 识别结果，可修正）</label><textarea id="rvStem" class="inp" rows="4">${esc(it.stem || it.up_stem_text || '')}</textarea></div>
      <div class="field wide"><label>答案（可空）</label><textarea id="rvAns" class="inp" rows="2">${esc(it.answer || '')}</textarea></div>
      <div class="field wide"><label>挂载分类（章节 + 知识点，审核通过前两边都要勾）</label>
        <div class="mf-grid2">
          <div><select id="rvCTree" class="inp">${chapOrd.length ? chapOrd.map((t) => `<option value="${t.id}" ${defC && t.id === defC.id ? 'selected' : ''}>${esc(treeLabel(t))}</option>`).join('') : '<option value="">（暂无章节树）</option>'}</select>
            <div id="rvCNodes" class="mf-pick" style="margin-top:6px;max-height:180px"></div></div>
          <div><select id="rvTree" class="inp">${knowOrd.length ? knowOrd.map((t) => `<option value="${t.id}" ${def && t.id === def.id ? 'selected' : ''}>${esc(treeLabel(t))}</option>`).join('') : '<option value="">（暂无知识点树）</option>'}</select>
            <div id="rvNodes" class="mf-pick" style="margin-top:6px;max-height:180px"></div></div>
        </div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn ghost xs" id="rvSave"> 仅保存核对</button>
        <button class="btn ghost xs" id="rvReject" style="color:#dc2626"> 拒绝并删除</button>
      </div>`,
    onOk: async (w, showErr) => { await reviewSave(w, 'approved', showErr); },
    onMount: (w) => {
      const loadNodes = async (selId, boxId, cls) => {
        const tid = w.querySelector('#' + selId).value;
        if (!tid) { w.querySelector('#' + boxId).innerHTML = '<span class="hint">暂无可用分类树</span>'; return; }
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${curNodes.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bindTree = (selId, boxId, cls) => {
        w.querySelector('#' + selId).onchange = () => loadNodes(selId, boxId, cls);
        loadNodes(selId, boxId, cls);
      };
      bindTree('rvCTree', 'rvCNodes', 'rv-cnd');
      bindTree('rvTree', 'rvNodes', 'rv-nd');
      w.querySelectorAll('[data-rvimg]').forEach((im) => { im.onclick = () => mfImgView(im.dataset.rvimg); });
      w.querySelector('#rvSave').onclick = async () => { await reviewSave(w, 'reviewed'); };
      w.querySelector('#rvReject').onclick = async () => {
        if (!(await elConfirm({ title: '拒绝', message: '拒绝后这道题会从题库和该学生的错题本中一起删除。确定？', okText: '拒绝', danger: true }))) return;
        await api(`/api/admin/bank/uploads/${it.up_id}/review`, { method: 'POST', body: { status: 'rejected' } });
        toast('已拒绝并删除', 'ok'); w.remove(); if (typeof done === 'function') done();
      };
    },
  });
}

/** 题目编辑弹层（题干/选项/答案/解析/章节+知识点双归属；PUT 全字段回传避免重置丢数据） */
async function mfQEdit(id, done, opts) {
  const d = await api(`${MF_API}/questions/${id}`);
  const q = d.question;
  // R8：从课文习题打开时，题目还没挂知识点就默认勾上视频关联的知识点（题目继承视频的知识点）
  if ((!q.nodes || !q.nodes.length) && opts && Array.isArray(opts.defaultNodes) && opts.defaultNodes.length) q.nodes = opts.defaultNodes.slice();
  const trees = await tpTrees();
  const chapTrees = trees.filter((t) => t.kind === 'textbook');
  const knowTrees = trees.filter((t) => t.kind === 'knowledge');
  const curNodes = q.nodes || [];
  const chapOrd = tpOrder(chapTrees, q.subject, q.stage), knowOrd = tpOrder(knowTrees, q.subject, q.stage);   // R2：同学科学段的排前面、默认版本第一
  const defC = chapOrd[0] || null; const defK = knowOrd[0] || null;
  let imageEditor = null;
  let aud = null;   // 听力音频字段（T7）
  modal({
    title: `编辑题目 #${q.id}`, wide: true, okText: '保存',
    body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
      <div class="mf-form">
        <div class="field"><label>题型</label><select id="qeType">${Object.entries(MF_TYPE_NAME).map(([k, t]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label>细分题型（选填）</label><select id="qeSubtype"><option value="">不细分</option></select></div>
        <div class="field"><label>学科</label><select id="qeSub">${MF_SUBJECTS.map((s) => `<option ${q.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="qeStage">${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${q.stage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="qeDiff">难度（五星）</label><input id="qeDiff" class="inp" type="number" min="1" max="5" value="${q.difficulty || 3}"></div>
        <div class="field"><label for="qeDiff10">难度（1–10，可空）</label><input id="qeDiff10" class="inp" type="number" min="1" max="10" step="1" placeholder="未细分" value="${q.difficulty_score_10 == null ? '' : Number(q.difficulty_score_10)}"></div>
      </div>
      <div class="field wide"><label>题干（支持 $...$ LaTeX，换行分段）</label><textarea id="qeStem" class="inp" rows="5">${esc(q.stem || '')}</textarea></div>
      <div class="field wide" id="qeMatchWrap" style="display:none"><label>匹配左侧项目（每行一项）</label><textarea id="qeMatch" class="inp" rows="3">${esc((q.match_prompts || []).join('\n'))}</textarea><small>下方选项填写右侧候选项；答案按左侧顺序填写右侧序号，如 2,1,3。</small></div>
      <div class="field wide"><label>选项（一行一个，可空）</label><textarea id="qeOpts" class="inp" rows="3">${esc((q.options || []).map(optText).join('\n'))}</textarea></div>
      <div class="mf-form">
        <div class="field wide"><label>答案</label><textarea id="qeAns" class="inp" rows="2">${esc(q.answer || '')}</textarea></div>
        <div class="field wide"><label>解析</label><textarea id="qeAna" class="inp" rows="2">${esc(q.analysis || '')}</textarea></div>
      </div>
      <div id="qeAudio"></div>
      <div class="field wide"><label>挂载分类 *（章节分类 + 知识点分类，两边都至少勾一项）</label>
        <div class="mf-grid2">
          <div><select id="qeCTree" class="inp">${chapOrd.length ? chapOrd.map((t) => `<option value="${t.id}" ${defC && t.id === defC.id ? 'selected' : ''}>${esc(treeLabel(t))}</option>`).join('') : '<option value="">（暂无章节树）</option>'}</select>
            <div id="qeCNodes" class="mf-pick" style="margin-top:6px;max-height:160px"></div></div>
          <div><select id="qeKTree" class="inp">${knowOrd.length ? knowOrd.map((t) => `<option value="${t.id}" ${defK && t.id === defK.id ? 'selected' : ''}>${esc(treeLabel(t))}</option>`).join('') : '<option value="">（暂无知识点树）</option>'}</select>
            <div id="qeKNodes" class="mf-pick" style="margin-top:6px;max-height:160px"></div></div>
        </div></div>
    </div>`,
    onMount: (w) => {
      aud = t7AudioWidget(w.querySelector('#qeAudio'), { key: q.audio_key, url: q.audio_url, limit: q.audio_play_limit });
      qcBindDifficultyInputs(w.querySelector('#qeDiff'), w.querySelector('#qeDiff10'));
      const showMatch = () => { w.querySelector('#qeMatchWrap').style.display = QSubtype.isMatch(w.querySelector('#qeSubtype').value) ? '' : 'none'; };
      const subtypeUpdate = (current) => { QSubtype.fillSelect(w.querySelector('#qeSubtype'), w.querySelector('#qeSub').value, w.querySelector('#qeType').value, current); showMatch(); };
      subtypeUpdate(q.question_subtype);
      w.querySelector('#qeSub').addEventListener('change', () => subtypeUpdate());
      w.querySelector('#qeType').addEventListener('change', () => subtypeUpdate());
      w.querySelector('#qeSubtype').addEventListener('change', showMatch);
      if (!Array.isArray(q.images)) q.images = [];
      imageEditor = t8Enhance(w, { uploadFields: ['#qeStem'], fields: ['#qeStem', '#qeOpts', '#qeAns', '#qeAna'], images: q.images });   // 公式输入 + 粘贴 / 拖拽图片（T8）
      const loadNodes = async (selId, boxId, cls) => {
        const tid = w.querySelector('#' + selId).value;
        if (!tid) { w.querySelector('#' + boxId).innerHTML = '<span class="hint">暂无可用分类树</span>'; return; }
        const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
        const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
        const dep = (n) => { let dd = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); dd++; if (dd > 9) break; } return dd; };
        w.querySelector('#' + boxId).innerHTML = ns.map((n) => `<label class="mf-pickitem" style="padding-left:${dep(n) * 14}px"><input type="checkbox" class="${cls}" value="${n.id}" ${curNodes.includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<span class="hint">这棵树还没有节点</span>';
      };
      const bindTree = (selId, boxId, cls) => {
        w.querySelector('#' + selId).onchange = () => loadNodes(selId, boxId, cls);
        loadNodes(selId, boxId, cls);
      };
      bindTree('qeCTree', 'qeCNodes', 'qe-cnd');
      bindTree('qeKTree', 'qeKNodes', 'qe-knd');
    },
    onOk: async (w, showErr) => {
      if (imageEditor) {
        await imageEditor.whenIdle();
        if (imageEditor.hasFailures()) return showErr('有图片上传失败，请重试或点击“忽略失败图片”后再保存。');
      }
      const score10 = w.querySelector('#qeDiff10').value;
      if (score10 !== '' && (!Number.isInteger(Number(score10)) || Number(score10) < 1 || Number(score10) > 10)) return showErr('十级难度须为 1 至 10 的整数');
      const chapIds = [...w.querySelectorAll('.qe-cnd:checked')].map((c) => Number(c.value));
      const knowIds = [...w.querySelectorAll('.qe-knd:checked')].map((c) => Number(c.value));
      if (!chapTrees.length || !knowTrees.length) return showErr('缺少章节树或知识点树，请先建树');
      if (!chapIds.length) return showErr('章节分类至少勾一项');
      if (!knowIds.length) return showErr('知识点分类至少勾一项');
      const body = {
        type: w.querySelector('#qeType').value, subject: w.querySelector('#qeSub').value, stage: w.querySelector('#qeStage').value,
        question_subtype: w.querySelector('#qeSubtype').value,
        match_prompts: w.querySelector('#qeMatch').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        difficulty: Number(w.querySelector('#qeDiff').value) || 3, difficulty_score_10: score10 === '' ? null : Number(score10),
        stem: w.querySelector('#qeStem').value,
        stem_html: w.querySelector('#qeStem').value === (q.stem || '') ? (q.stem_html || '') : '',
        options: w.querySelector('#qeOpts').value.split('\n').map((s) => s.trim()).filter(Boolean),
        answer: w.querySelector('#qeAns').value, analysis: w.querySelector('#qeAna').value,
        grade: q.grade || '', point: q.point || '', material: q.material || '', source: q.source || '',
        year: q.year || '', images: q.images || [], tags: q.tags || [],
        audio_key: aud ? aud.get() : (q.audio_key || ''),
        audio_play_limit: aud ? aud.getLimit() : (q.audio_play_limit || 0),
        source_type: q.source_type || 'local', source_detail: q.source_detail || {},
        nodes: [...new Set([...chapIds, ...knowIds])],
      };
      await api(`${MF_API}/questions/${id}`, { method: 'PUT', body });
      toast('已保存', 'ok'); done && done();
    },
  });
}

/** 批量操作分发 */
async function mfBatch(op, ids, st, done) {
  if (op === 'clear') { st.sel = {}; return done(); }
  if (!ids.length) return toast('先勾选题目', 'err');
  if (op === 'del') {
    if (!(await elConfirm({ title: '批量删除', message: `确定删除选中的 ${ids.length} 题？不可恢复。`, okText: '删除', danger: true }))) return;
    await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'delete' } });
    st.sel = {}; toast(`已删除 ${ids.length} 题`, 'ok'); return done();
  }
  if (op === 'tag' || op === 'wrong') {
    const tags = op === 'wrong' ? ['错题'] : null;
    if (!tags) {
      await new Promise((resolve) => {
        modal({ title: '批量添加标签', body: `<div class="field"><label>标签（逗号分隔）</label><input id="btTags" class="inp" placeholder="如：期中,高频考点"></div>`,
          onOk: async (w) => {
            const t = w.querySelector('#btTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            if (!t.length) return false;
            await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'tag', tags: t } });
            toast('已打标', 'ok'); resolve(); done();
          } });
      });
      return;
    }
    await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids, op: 'tag', tags } });
    toast(`已给 ${ids.length} 题标记「${tags[0]}」`, 'ok'); return done();
  }
  if (op === 'aiclean') return mfBatchAiClean(ids, done);
  if (op === 'aisug') return mfBatchAiSuggest(ids, st, done);
  if (op === 'basket') {
    const papers = (await api(`${MF_API}/papers?status=basket`, { silent: true }).catch(() => ({ list: [] }))).list || [];
    modal({ title: '批量加入试题篮', body: `<div class="field"><label>加入哪个试题篮（试卷）</label>
      <select id="bbPaper">${papers.map((p) => `<option value="${p.id}">${esc(p.title)}（${p.qcount}题）</option>`).join('')}</select>
      <div class="hint" style="margin-top:6px">没有合适的？先去「试卷管理」新建一个（篮状态），或直接选「新建」</div>
      <div class="field" style="margin-top:8px"><label>或新建试题篮</label><input id="bbNew" class="inp" placeholder="填了就按这个名称新建"></div></div>`,
      onOk: async (w) => {
        let pid = w.querySelector('#bbPaper').value;
        const newName = w.querySelector('#bbNew').value.trim();
        if (newName) {
          const d = await api(MF_API + '/papers', { method: 'POST', body: { title: newName, status: 'basket' } });
          pid = d.id;
        }
        if (!pid) return false;
        await api(`${MF_API}/papers/${pid}/questions`, { method: 'POST', body: { question_ids: ids } });
        toast(`已把 ${ids.length} 题加入试题篮，去「试卷管理」排版`, 'ok'); done();
      } });
    return;
  }
}

/** AI 整理（逐题 AI 清洗 + 对照确认，对齐魔方 AiCleanDialog） */
async function mfBatchAiClean(ids, done) {
  const results = [];
  const tip = toast(`AI 整理中：0/${ids.length}`, '');
  for (let i = 0; i < ids.length; i++) {
    try {
      const d = await api(`${MF_API}/ai-clean`, { method: 'POST', body: { id: ids[i], field: 'stem' } });
      const q = await api(`${MF_API}/questions/${ids[i]}`, { silent: true });
      results.push({ id: ids[i], before: (q.question.stem || '').slice(0, 500), after: d.text });
    } catch (e) { /* 单题失败跳过 */ }
    if (tip) tip.querySelector('.el-message__content').textContent = `AI 整理中：${i + 1}/${ids.length}`;
  }
  setTimeout(() => tip && tip.remove(), 300);
  if (!results.length) return toast('没有题目整理成功', 'err');
  let idx = 0;
  const showOne = () => {
    const r = results[idx];
    modal({
      title: `AI 整理对照（${idx + 1}/${results.length}）`, wide: true, okText: idx === results.length - 1 ? '应用并完成' : '应用，下一题',
      body: `<div class="mf-grid2">
        <div class="mf-box"><h4>整理前</h4><div class="mf-qtext" style="max-height:220px;overflow:auto">${esc(r.before)}</div></div>
        <div class="mf-box" style="border-color:#a5b4fc"><h4 style="color:#4f46e5">整理后</h4><div class="mf-qtext" style="max-height:220px;overflow:auto">${esc(r.after)}</div></div>
      </div>`,
      onOk: async () => {
        await api(`${MF_API}/questions/${r.id}`, { method: 'PUT', body: { stem: r.after, stem_html: esc(r.after).replace(/\n/g, '<br>') } });
        idx++;
        if (idx < results.length) showOne();
        else { toast('AI 整理完成', 'ok'); done(); }
      },
    });
  };
  showOne();
}

/** AI 建议（打标 + 挂树建议，人确认后写入） */
async function mfBatchAiSuggest(ids, st, done) {
  toast('AI 正在分析，请稍候…', '');
  const d = await api(MFX + '/ai-suggest', { method: 'POST', body: { ids } });
  const list = d.list || [];
  modal({
    title: 'AI 建议（勾选后应用）', wide: true, okText: '应用所选',
    body: `<div style="max-height:400px;overflow:auto">${list.map((r) => `<div class="mf-qcard" data-id="${r.id}">
      <b>#${r.id}</b>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
        ${(r.tags || []).map((t) => `<label class="tag" style="cursor:pointer"><input type="checkbox" class="as-tag" data-id="${r.id}" value="${esc(t)}" checked> ${esc(t)}</label>`).join('') || '<span class="hint">无标签建议</span>'}
      </div>
      <div class="row" style="gap:6px;margin-top:4px">
        ${r.tree_name ? `<label class="hint" style="cursor:pointer"><input type="checkbox" class="as-node" data-id="${r.id}" data-tree="${r.tree_id}" value="${(r.node_ids || [])[0] || ''}" ${(r.node_ids || []).length ? 'checked' : ''}> 挂到「${esc(r.tree_name)}」建议节点</label>` : '<span class="hint">无挂树建议（该学科还没有树）</span>'}
      </div></div>`).join('')}</div>`,
    onOk: async (w) => {
      let nTag = 0, nNode = 0;
      const byId = {};
      w.querySelectorAll('.as-tag:checked').forEach((c) => { (byId[c.dataset.id] = byId[c.dataset.id] || { tags: [], nodes: {} }); byId[c.dataset.id].tags.push(c.value); });
      w.querySelectorAll('.as-node:checked').forEach((c) => { const v = Number(c.value); if (v) { (byId[c.dataset.id] = byId[c.dataset.id] || { tags: [], nodes: {} }); byId[c.dataset.id].nodes[v] = c.dataset.tree; } });
      for (const [qid, v] of Object.entries(byId)) {
        if (v.tags.length) { await api(`${MF_API}/questions/batch`, { method: 'POST', body: { ids: [Number(qid)], op: 'tag', tags: v.tags } }); nTag++; }
        const nodes = Object.keys(v.nodes).map(Number);
        if (nodes.length) { await api(`${MF_API}/questions/${qid}/nodes`, { method: 'POST', body: { node_ids: nodes } }); nNode++; }
      }
      toast(`已应用：${nTag} 题打标、${nNode} 题挂树`, 'ok'); done();
    },
  });
}

/* ================================================================ 网络采集（内嵌浏览器） */
async function viewMfCapture() {
  const st = mfState('mfc');
  st.tab = st.tab || 'capture';
  st.hist = st.hist || [];
  st.hi = st.hi || 0;
  if (!st.url) st.url = MF_SITES[0].url;
  let batchLoadError = false;
  const batches = (await api(MF_API + '/capture/batches?questions=1', { silent: true }).catch(() => { batchLoadError = true; return { list: [] }; })).list || [];
  const stName = { zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一组卷网', generic: '通用' };
  const remaining = (b) => b.status === 'pending' && Array.isArray(b.questions) ? b.questions.filter(q => q && !q._done && String(q.stem || q.stemHtml || '').trim()).length : 0;
  const batchesTable = (list) => batchLoadError ? '<div class="r4-empty">采集批次加载失败，请刷新页面重试。</div>' : list.length ? `<div class="r4-capture-history-list">${list.map((b) => {
    const left = remaining(b), status = b.status === 'done' ? '已处理' : left ? `待核对 ${left} 题` : '无待核对题';
    return `<div class="r4-history-row"><span><strong>${esc(b.title)}</strong><small>${esc(stName[b.site] || b.site || '网络采集')} · 共 ${Number(b.count) || 0} 题 · ${esc(String(b.created_at || '').slice(0,16))}</small></span><span class="r4-status">${esc(status)}</span><div class="r4-capture-history-actions"><button type="button" class="btn ghost xs" data-view="${Number(b.id)}">查看</button>${left ? `<button type="button" class="btn primary xs" data-review-cap="${Number(b.id)}">去核对</button>` : ''}<button type="button" class="btn ghost xs" data-delb="${Number(b.id)}">删除</button></div></div>`;
  }).join('')}</div>` : '<div class="r4-empty">还没有采集批次，完成采集后会显示在这里。</div>';
  const paperBatches = batches.filter((b) => Number(b.paper_mode));


  const html = `<div class="r4-intake r4-capture">
    <a class="r4-back" href="#/intake">‹ 返回录题中心</a>
    <div class="r4-intake-head"><div><span class="r4-kicker">录题中心</span><h2>网络采集</h2><p>使用 AI 转写或浏览器书签采集，题目送入待审核后再分类入库。</p></div><button type="button" class="btn primary" id="capReviewAll">查看采集待审核</button></div>
    <div class="r4-steps" aria-label="网络采集步骤"><div><b>1</b><span><strong>准备资料</strong><small>选择网页、试卷或题目截图</small></span></div><div><b>2</b><span><strong>采集或导入</strong><small>使用书签或 AI 题目包</small></span></div><div><b>3</b><span><strong>核对入库</strong><small>检查内容和分类</small></span></div></div>
    <div class="card">
      <div class="card-h"><h3>${ic('link')} 选择采集方式</h3>
        <div class="card-h-r row" style="gap:8px">
          <div class="mf-segs">
            <button class="btn sm ${st.tab === 'capture' ? 'primary' : 'ghost'}" data-tab="capture">采集题目</button>
            <button class="btn sm ${st.tab === 'browser' ? 'primary' : 'ghost'}" data-tab="browser">辅助浏览</button>
            <button class="btn sm ${st.tab === 'paper' ? 'primary' : 'ghost'}" data-tab="paper">整卷解析</button>
          </div>
        </div></div>
    <div class="card-b">
      ${st.tab === 'browser' ? `
        <div class="mf-nav">
          <button class="btn ghost sm" id="mfBack" title="后退">←</button>
          <button class="btn ghost sm" id="mfFwd" title="前进">→</button>
          <button class="btn ghost sm" id="mfReload" title="刷新">⟳</button>
          <input id="mfUrlBar" class="inp" style="flex:1;height:34px" placeholder="输入网址，回车打开" value="${esc(st.url)}">
          <span class="mf-dot" id="mfSiteDot">● ${esc((MF_SITES.find((s) => st.url.includes(s.host)) || {}).t || '网页')}</span>
          ${MF_SITES.map((s) => `<button class="btn sm ${st.url.includes(s.host) ? 'primary' : 'ghost'}" data-site="${s.url}">${s.t}</button>`).join('')}
          <button class="btn ghost sm" data-tab="capture" id="mfExport">返回采集</button>
          <button class="btn ghost sm" data-tab="paper" id="mfWhole">整卷解析</button>
          <button class="btn ghost sm" id="mfClose">关闭浏览器</button>
        </div>
        <div id="mfFrameStatus" class="r4-capture-notice" role="status">辅助浏览依赖服务器代理。网站拒绝访问或代理关闭时，请使用浏览器书签采集。</div>
        <div class="mf-browser">
          <iframe id="mfFrame" src="about:blank" sandbox="allow-scripts allow-forms allow-downloads allow-modals" style="width:100%;height:calc(100vh - 250px);min-height:520px;border:0;border-radius:8px;background:#fff"></iframe>
        </div>
        <div class="hint" style="margin-top:8px">代理页面可用时可尝试采集；采集结果会进入待审核。如页面为空，请回到「采集题目」使用老师本人浏览器中的书签。</div>
      ` : ''}
      ${st.tab === 'capture' ? `
        <div class="r4-capture-choices">
          <div class="r4-capture-choice"><span class="r4-capture-choice-icon">${ic('code')}</span><div><h4>AI 转写导入</h4><p>把网页、试卷或截图交给 AI 助手，导入返回的 JSON / ZIP 题目包。</p><button type="button" class="btn primary sm" id="mfOpenImport">打开技能包导入</button></div></div>
          <div class="r4-capture-choice"><span class="r4-capture-choice-icon">${ic('link')}</span><div><h4>浏览器书签采集</h4><p>在自己的浏览器登录题目网站，打开题目页面后使用采集书签。</p><button type="button" class="btn ghost sm" id="mfOpenBookmark">查看书签使用方法</button></div></div>
          <div class="r4-capture-choice"><span class="r4-capture-choice-icon">${ic('list')}</span><div><h4>导入采集的知识树</h4><p>选择学段、学科和教材版本，预览后合并采集到的节点。</p><button type="button" class="btn ghost sm" id="mfOpenTreeImport">导入知识树 JSON</button></div></div>
        </div>
        <details style="margin-bottom:16px"><summary style="cursor:pointer;color:#46566d;font-weight:600">辅助方式：服务器直链解析</summary>
        <div class="mf-box" style="margin-top:10px">
          <h4 style="margin:0 0 8px">直链解析</h4>
          <div class="row" style="gap:10px">
            <input id="mfAutoUrl" class="inp" style="flex:1;height:36px" placeholder="粘贴试卷网址，如 https://zujuan.xkw.com/xxxxx">
            <button class="btn primary" id="mfAutoGo" style="height:36px;padding:0 20px">解析试卷</button>
            <button class="btn ghost" id="mfLogin" style="height:36px;padding:0 14px" title="需要登录的网站先在这里登录一次">登录 / 扫码</button>
          </div>
          <div class="hint" style="margin-top:6px">解析后保存至待审核。网站可能拒绝服务器访问，此时请使用技能包或浏览器书签采集。</div>
          <div class="r4-capture-message" id="mfAutoStatus" aria-live="polite"></div>
        </div></details>
        <div class="r4-capture-scope"><div><strong>直链或粘贴解析的题目</strong><p>先选择默认学段和学科，解析后勾选要送审的题目。书签采集可在待审核时补充。</p></div>
          <label for="bkStage">学段
          <select id="bkStage" class="inp">
            <option value="">请选择</option>
            ${Object.entries(MF_STAGE_NAMES).map(([k, t]) => `<option value="${k}" ${st.bStage === k ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
          <label for="bkSub">学科
          <select id="bkSub" class="inp">
            <option value="">请选择</option>
            ${MF_SUBJECTS.map((s) => `<option ${st.bSub === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>
        </div>
        <div id="mfParsed" aria-live="polite"></div>
        <details id="mfBookmarkHelp" style="margin:14px 0 0"><summary style="cursor:pointer;color:#46566d;font-weight:600">浏览器书签采集 / 粘贴网页源码或题目文本</summary>
        <div class="mf-grid2" style="margin-top:10px">
          <div class="mf-box"><h4>书签小工具</h4>
            <p class="hint">先生成票据和书签脚本，创建浏览器书签并将脚本粘贴到网址栏。然后在自己的浏览器登录题目网站，打开题目页，点击书签并按提示粘贴票据。回传后在待审核核对题目。</p>
            <label for="mfBmPage">目标页面类型</label>
            <select id="mfBmPage" class="inp"><option value="chapter">章节选题</option><option value="knowledge">知识点选题</option><option value="paper">试卷详情</option></select>
            <button class="btn sm" id="mfBmToken">生成采集票据</button>
            <button class="btn ghost sm" id="mfBmJs">复制书签脚本</button>
            <textarea id="mfBmBox" class="inp" rows="3" placeholder="点上面按钮后出现内容"></textarea><div class="r4-capture-message" id="mfBmStatus" aria-live="polite"></div></div>
          <div class="mf-box"><h4>粘贴网页源码 / 题目文本</h4>
            <textarea id="mfRaw" class="inp" rows="4" placeholder="网页源代码 HTML 或纯文字题"></textarea>
            <div class="row"><input id="mfUrl" class="inp" placeholder="来源网址（选填）"><button class="btn sm" id="mfParse">解析</button></div><div class="r4-capture-message" id="mfParseStatus" aria-live="polite"></div></div>
        </div></details>
        <details style="margin:14px 0 0"><summary style="cursor:pointer;color:#46566d;font-weight:600">站点规则自检</summary>
          <div class="mf-box" style="margin-top:10px">
            <p class="hint">粘贴已保存的页面源码，对照书签使用的同一套规则检查题干、选项、答案、解析和图片链接。源码只在当前浏览器解析，不会发送或执行。</p>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <label for="mfRuleSite">站点</label><select id="mfRuleSite" class="inp"><option value="zujuan">组卷网</option><option value="jyeoo">菁优网</option><option value="21cnjy">二一教育</option></select>
              <label for="mfRulePage">页面类型</label><select id="mfRulePage" class="inp"><option value="chapter">章节选题</option><option value="knowledge">知识点选题</option><option value="paper">试卷详情</option></select>
              <label for="mfRuleUrl">来源网址</label><input id="mfRuleUrl" class="inp" placeholder="用于还原相对图片地址">
            </div>
            <label for="mfRuleHtml" style="display:block;margin-top:10px">网页源码</label>
            <textarea id="mfRuleHtml" class="inp" rows="5" placeholder="粘贴网页 HTML 源码"></textarea>
            <button type="button" class="btn sm" id="mfRuleTest" style="margin-top:8px">检查规则</button>
            <div id="mfRuleOut" aria-live="polite" style="margin-top:10px"></div>
          </div>
        </details>
        <div class="r4-capture-history"><div class="r4-history-head"><div><h3>最近采集批次</h3><p>显示最近 100 个采集批次中的前 8 个，可继续核对未完成的题目。</p></div><button type="button" class="btn ghost sm" id="bkCommit">查看采集待审核</button></div>${batchesTable(batches.slice(0,8))}</div>
      ` : ''}
      ${st.tab === 'paper' ? `
        <div class="mf-box" style="max-width:780px">
          <h4 style="margin:0 0 10px">整卷链接解析（辅助方式）</h4>
          <div class="row" style="gap:10px">
            <input id="wpUrl" class="inp" style="flex:1;height:36px" placeholder="https://zujuan.xkw.com/4p2338916.html">
            <button class="btn primary" id="wpGo" style="height:36px;padding:0 18px">解析试卷</button>
          </div>
          <div class="hint" style="margin-top:6px">粘贴组卷网整卷详情页网址。网站可能拒绝服务器访问，失败时可使用书签或技能包采集。</div>
          <div id="wpOut" style="margin-top:10px"></div>
        </div>
        <h4 style="margin:14px 0 8px">整卷批次</h4>
        ${batchesTable(paperBatches)}
      ` : ''}
    </div></div></div>`;

  return {
    html,
    after: () => {
      const captureRoot = document.getElementById('capReviewAll'); if (captureRoot) R4Flow.bind(captureRoot.closest('.card') || captureRoot.parentElement, 'capture');
      R4Flow.prepare(document.getElementById('view'), 'capture', ['mfRaw','mfUrl','bkSub','mfRuleHtml','mfRulePage','mfRuleSite']);
      const captureScopeHost = document.querySelector('.r4-capture-scope');
      const captureScope = captureScopeHost ? R4Flow.scope(document.getElementById('view'), 'capture', captureScopeHost, {subject:'bkSub',stage:'bkStage'}) : () => ({});
      const openReview = (batchId = 0) => { pdSelectBatch('capture', batchId); location.hash = '#/pending'; };
      document.getElementById('capReviewAll').onclick = () => openReview();
      document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { st.tab = b.dataset.tab; render(); }; });
      const rerender = () => render();

      /* —— 浏览器标签 —— */
      if (st.tab === 'browser') {
        const frame = document.getElementById('mfFrame');
        const bar = document.getElementById('mfUrlBar');
        const dot = document.getElementById('mfSiteDot');
        const nav = async (url, push = true) => {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          const t = await api(MFX + '/proxy-ticket', { method: 'POST', silent: false }).catch(() => null);
          if (!t) { document.getElementById('mfFrameStatus').textContent = '辅助代理当前不可用。请返回「采集题目」，使用浏览器书签或技能包。'; return; }
          document.getElementById('mfFrameStatus').textContent = '正在尝试加载网页；如果网页空白或拒绝访问，请使用浏览器书签或技能包。';
          st.k = t.k; st.cap = t.capture;
          st.url = url;
          if (push) { st.hist = st.hist.slice(0, st.hi + 1); st.hist.push(url); st.hi = st.hist.length - 1; }
          frame.src = `/api/mfproxy/r?k=${encodeURIComponent(t.k)}&u=${encodeURIComponent(url)}`;
          dot.textContent = '● ' + ((MF_SITES.find((s) => url.includes(s.host)) || {}).t || '网页');
          bar.value = url;
        };
        if (window.__mfAutoNav) delete window.__mfAutoNav;
        // 进入页面自动打开上次网址（首次带票据）
        nav(st.url, false);
        // R0-B5：iframe 已去掉 allow-same-origin，外层读不到它的 location；注入脚本用 postMessage 告知当前真实网址
        if (window.__mfFrameMsg) window.removeEventListener('message', window.__mfFrameMsg);
        window.__mfFrameMsg = (e) => {
          if (e.source !== frame.contentWindow) return;
          const d = e.data;
          if (!d || d.mfp !== 1 || d.type !== 'page' || typeof d.url !== 'string' || !/^https?:\/\//i.test(d.url)) return;
          bar.value = d.url; st.url = d.url;
          dot.textContent = '● ' + ((MF_SITES.find((s) => d.url.includes(s.host)) || {}).t || '网页');
        };
        window.addEventListener('message', window.__mfFrameMsg);
        document.getElementById('mfBack').onclick = () => { if (st.hi > 0) { st.hi--; nav(st.hist[st.hi], false); } };
        document.getElementById('mfFwd').onclick = () => { if (st.hi < st.hist.length - 1) { st.hi++; nav(st.hist[st.hi], false); } };
        document.getElementById('mfReload').onclick = () => { nav(st.url, false); };
        document.getElementById('mfClose').onclick = () => { frame.src = 'about:blank'; };
        bar.onkeydown = (e) => { if (e.key === 'Enter') nav(bar.value.trim()); };
        document.querySelectorAll('[data-site]').forEach((b) => { b.onclick = () => nav(b.dataset.site); });
      }

      /* —— 试题采集标签 —— */
      if (st.tab === 'capture') {
        document.getElementById('mfOpenTreeImport').onclick = () => mfTreeImportDialog();
        document.getElementById('mfOpenImport').onclick = () => { location.hash = '#/intake-skill'; };
        document.getElementById('mfOpenBookmark').onclick = () => { const d = document.getElementById('mfBookmarkHelp'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        document.getElementById('bkCommit').onclick = () => openReview();
        document.getElementById('bkStage').onchange = (e) => { st.bStage = e.target.value; };
        document.getElementById('bkSub').onchange = (e) => { st.bSub = e.target.value; };

        const showParsed = (d, url) => {
          const parsed = d.questions || [];
          if (!parsed.length) { document.getElementById('mfParsed').innerHTML = '<div class="r4-capture-notice">没有识别到题目，请检查内容，或改用浏览器书签、AI 转写后再试。</div>'; return; }
          document.getElementById('mfParsed').innerHTML = `<div class="mf-parsed">
            <div class="row" style="justify-content:space-between">
              <b>解析出 ${parsed.length} 题（${esc(stName[d.site] || d.site || '未知来源')}${d.via === 'ai' ? ' · AI 识别' : ''}）</b>
              <span>
                <button class="btn primary sm" id="mfDirectCommit">送入待审核</button></span></div>
            ${d.unassigned_images ? `<p class="hint" style="color:#9a6700">发现 ${Number(d.unassigned_images)} 张图片，无法可靠判断所属题目；请在审核时对照原页补图。</p>` : ''}
            ${parsed.map((q, i) => `<div class="mf-qcard">
              <label><input type="checkbox" class="mfpck" value="${i}" checked> 第 ${i + 1} 题（${({ single: '单选', multi: '多选', judge: '判断', fill: '填空', answer: '解答' })[q.type] || '解答'}）</label>
              ${q.material ? `<div class="hint">材料：${esc(q.material)}</div>` : ''}
              <div class="mf-qtext">${esc(q.stem || q.stemHtml || '')}</div>
              ${(q.options || []).length ? `<div class="hint">选项：${esc((q.options || []).map(optText).join(' / '))}</div>` : ''}
              <div class="hint">答案：${esc(q.answer || '待补充')} · 解析：${esc(q.analysis || '待补充')}</div></div>`).join('')}
            <div class="hint" style="margin-top:6px">选择题目并保存到待审核，在审核页确认分类后入库。</div></div>`;
          const selIdx = () => [...document.querySelectorAll('.mfpck:checked')].map((c) => Number(c.value));
          document.getElementById('mfDirectCommit').onclick = async (ev) => {
            const btn = ev.currentTarget;
            const sel = selIdx();
            if (!sel.length) return toast('至少勾一题', 'err');
            const stage = (document.getElementById('bkStage') || {}).value || st.bStage || '';
            const subject = (document.getElementById('bkSub') || {}).value || st.bSub || '';
            if (!stage || !subject) return toast('先在上面的「学段 / 学科」里选好', 'err');
            st.bStage = stage; st.bSub = subject;
            btn.disabled = true; btn.textContent = '保存中…';
            try {
              const saved = await R4Flow.post(MF_API + '/capture/batches', 'capture', { ...captureScope(), title: `采集 ${stName[d.site] || d.site} ${sel.length} 题`, site: d.site, url, subject, stage, questions: sel.map((i) => parsed[i]) });
              toast(saved.image_errors ? `已保存到待审核，${saved.image_errors} 张图片需要补充` : '已保存到待审核', saved.image_errors ? 'err' : 'ok'); openReview(saved.id);
            } catch (e) { btn.disabled = false; btn.textContent = '送入待审核'; }
          };
        };
        const autoBtn = document.getElementById('mfAutoGo');
        autoBtn.onclick = async () => {
          const url = document.getElementById('mfAutoUrl').value.trim();
          if (!url) { document.getElementById('mfAutoUrl').focus(); return toast('先粘贴网址', 'err'); }
          const status = document.getElementById('mfAutoStatus');
          status.textContent = '正在解析，请稍候…';
          autoBtn.disabled = true; autoBtn.textContent = '解析中…';
          try {
            const d = await api(MF_API + '/capture/auto', { method: 'POST', body: { url } });
            showParsed(d, url);
            status.textContent = (d.questions || []).length ? `已解析 ${(d.questions || []).length} 题，请核对下方结果。` : '没有识别到题目，可以改用浏览器书签或 AI 转写。';
          } catch (e) { status.textContent = `解析失败：${e.message || '请检查网址或稍后重试'}。也可使用浏览器书签或 AI 转写。`; }
          autoBtn.disabled = false; autoBtn.textContent = '解析试卷';
        };
        document.getElementById('mfAutoUrl').onkeydown = (e) => { if (e.key === 'Enter') autoBtn.click(); };
        document.getElementById('mfLogin').onclick = () => {
          const raw = document.getElementById('mfAutoUrl').value.trim();
          if (raw) { try { st.url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; } catch (e) { /* 保持原网址 */ } }
          st.tab = 'browser';
          toast('已切换到辅助浏览；若代理不可用，请改用本人浏览器中的书签', 'ok');
          render();
        };
        document.getElementById('mfBmToken').onclick = async () => {
          const status = document.getElementById('mfBmStatus');
          status.textContent = '正在生成票据…';
          try { const d = await api(MF_API + '/capture/token'); document.getElementById('mfBmBox').value = d.token; status.textContent = '票据已生成（90 天有效），请复制后在书签首次运行时粘贴。'; }
          catch (e) { status.textContent = `票据生成失败：${e.message || '请稍后重试'}`; }
        };
        document.getElementById('mfBmJs').onclick = async () => {
          const page = document.getElementById('mfBmPage').value;
          const status = document.getElementById('mfBmStatus'); status.textContent = '正在生成书签脚本…';
          try {
            const d = await api(`${MF_API}/capture/bookmarklet?base=${encodeURIComponent(location.origin)}&page=${encodeURIComponent(page)}`);
            const box = document.getElementById('mfBmBox'); box.value = d.js; box.select();
            let copied = false; try { copied = document.execCommand('copy'); } catch (e) { /* 手动复制 */ }
            status.textContent = copied ? '脚本已复制，请新建书签并粘贴到网址栏。' : '脚本已生成并选中，请手动复制后粘贴到书签网址栏。';
          } catch (e) { status.textContent = `书签生成失败：${e.message || '请稍后重试'}`; }
        };
        document.getElementById('mfRuleTest').onclick = () => {
          const raw = document.getElementById('mfRuleHtml').value.trim();
          const out = document.getElementById('mfRuleOut');
          if (!raw) { out.textContent = '请先粘贴网页源码'; return; }
          if (raw.length > 5 * 1024 * 1024) { out.textContent = '源码超过 5 MB，请缩小范围后重试'; return; }
          const fragment = document.createElement('template');
          fragment.innerHTML = raw;
          const site = document.getElementById('mfRuleSite').value;
          const page = document.getElementById('mfRulePage').value;
          const url = document.getElementById('mfRuleUrl').value.trim();
          const result = MFCaptureRules.extract(fragment.content, site, page, url, MFCaptureRules.configs);
          if (!result.questions.length) { out.textContent = result.message; return; }
          out.innerHTML = `<p>匹配到 ${result.questions.length} 题；结果需与原网页逐项核对。${esc(result.message || '')}</p>${result.questions.map((q, i) => `<div class="mf-qcard"><b>第 ${i + 1} 题</b><div>${esc(q.stem)}</div><div class="hint">选项：${esc(q.options.join(' / ') || '未匹配')}</div><div class="hint">答案：${esc(q.answer || '未匹配')} · 解析：${esc(q.analysis || '未匹配')}</div><div class="hint">图片：${esc(q.images.join(' / ') || '未匹配')}</div></div>`).join('')}`;
        };
        document.getElementById('mfParse').onclick = async (event) => {
          const raw = document.getElementById('mfRaw').value;
          if (!raw.trim()) return toast('先粘贴内容', 'err');
          const url = document.getElementById('mfUrl').value.trim();
          const isHtml = /<[a-z][\s\S]*>/i.test(raw);
          const btn = event.currentTarget, status = document.getElementById('mfParseStatus'); btn.disabled = true; status.textContent = '正在解析，请稍候…';
          try { const d = await api(MF_API + '/capture/parse', { method: 'POST', body: { [isHtml ? 'html' : 'text']: raw, url } }); showParsed(d, url); status.textContent = (d.questions || []).length ? `已解析 ${(d.questions || []).length} 题，请核对下方结果。` : '没有识别到题目，请检查内容后重试。'; }
          catch (e) { status.textContent = `解析失败：${e.message || '请稍后重试'}`; }
          finally { btn.disabled = false; }
        };
      }

      /* —— 整卷下载标签 —— */
      if (st.tab === 'paper') {
        const go = document.getElementById('wpGo');
        go.onclick = async () => {
          const url = document.getElementById('wpUrl').value.trim();
          if (!/^https?:\/\//i.test(url)) { document.getElementById('wpUrl').focus(); return toast('先粘贴整卷详情页网址', 'err'); }
          go.disabled = true; go.textContent = '解析中…';
          try {
            const d = await api(MF_API + '/capture/auto', { method: 'POST', body: { url } });
            const qs = d.questions || [];
            if (!qs.length) {
              toast('抓到了页面，但没认出题目：可能要登录（去「浏览器」登录后再试）或页面是图片卷', 'err');
            } else {
              await R4Flow.post(MF_API + '/capture/batches', 'capture', { ...captureScope(), paper_mode: 1, site: d.site, url, title: `整卷 ${d.site_name || d.site || ''} ${qs.length} 题`, questions: qs });
              document.getElementById('wpOut').innerHTML = `<div class="mf-tip">解析出 <b>${qs.length}</b> 题${d.via === 'ai' ? '（AI 识别）' : ''}，已送入待审核。审核通过后，题目进入题库；需要在组卷中另外创建试卷。</div>`;
              toast(`已解析 ${qs.length} 题并送入待审核`, 'ok');
              setTimeout(rerender, 800);
            }
          } catch (e) { document.getElementById('wpOut').textContent = `解析失败：${e.message || '请检查网址或稍后重试'}。也可使用浏览器书签或 AI 转写。`; }
          go.disabled = false; go.textContent = '解析试卷';
        };
        document.getElementById('wpUrl').onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
      }

      /* —— 批次操作（两个标签共用） —— */
      document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = async () => {
        const d = await api(`${MF_API}/capture/batches/${b.dataset.view}`);
        modal({ title: d.batch.title, wide: true, okText: '关闭', body: d.batch.questions.map((q, i) =>
          `<div class="mf-qcard"><b>${i + 1}.</b> ${esc((q.stem || q.stemHtml || '').slice(0, 300))}
          ${(q.options || []).length ? `<div class="hint">${esc((q.options || []).map(optText).join(' / ').slice(0, 200))}</div>` : ''}
          ${q.answer ? `<div class="hint">答案：${esc(q.answer)}</div>` : ''}</div>`).join('') });
      }; });
      document.querySelectorAll('[data-review-cap]').forEach((b) => { b.onclick = () => openReview(b.dataset.reviewCap); });
      document.querySelectorAll('[data-delb]').forEach((b) => { b.onclick = async () => {
        if (!(await elConfirm({ title: '删除批次', message: '只删暂存，不影响已入库的题目。确定？', okText: '删除', danger: true }))) return;
        await api(`${MF_API}/capture/batches/${b.dataset.delb}`, { method: 'DELETE' }); toast('已删除', 'ok'); rerender();
      }; });
    },
  };
}

/* ================================================================ 设置（AI 配置管理 / 字典映射） */
async function viewMfSet() {
  const prof = await api(MFX + '/profiles', { silent: true }).catch(() => ({ list: [], roles: [], presets: [], total: 0, enabled_count: 0 }));
  const cur = await api('/api/admin/ai/config', { silent: true }).catch(() => null);   // 现在实际生效的配置（T2）

  // AI 能力清单：学生端 + 管理后台所有用到 AI 大模型的接口，按「可共用一个模型」分组
  const AI_GROUPS = [
    {
      role: 'reasoning', icon: 'chat', name: '文本生成（共用一个对话模型）',
      desc: '所有文字类 AI 能力共用这一个模型，配置一次全部生效。',
      feats: [
        ['AI 学情诊断 / 学习报告分析', '管理后台 · AI学情诊断，学生端 · 学习报告'],
        ['词汇速记 AI（例句结构 / 记忆提示）', '学生端 · 单词速记 / 语境记忆 / 连词成句'],
        ['智能组卷 AI 解析', '管理后台 · 智能组卷'],
        ['题库 AI（AI 整理 / AI 归属建议 / 采集清洗）', '管理后台 · 题库管理 / 网络采集 / 录题上传'],
      ],
    },
    {
      role: 'vision', icon: 'video', name: '图像识别（共用一个视觉模型）',
      desc: '所有拍照识图类 AI 能力共用这一个模型（需勾选「支持图片输入」）。',
      feats: [
        ['录题上传整页识别', '管理后台 · 录题上传（整页试卷图 → 题卡）'],
        ['习题拍照识别入库', '管理后台 · 智能组卷 / 课程习题拍照录题'],
      ],
    },
    {
      role: '', icon: 'volume', name: '语音 / 图像生成（内置，无需配置）',
      desc: '走服务器内置的阿里云百炼通道，已配好 Key，不占用上面的对话 / 视觉模型。',
      feats: [
        ['发音合成 TTS（音标 / 单词 / 例句朗读）', '学生端 · 音标训练 / 词书跟读 / 听写'],
        ['课程封面 AI 生成', '管理后台 · 音标训练课程封面'],
      ],
    },
  ];
  const roleStatus = (role) => {
    if (!role) return '<span class="tag ok">内置已配置</span>';
    const ps = prof.list.filter((p) => p.role === role);
    const on = ps.find((p) => p.is_enabled);
    if (on) return `<span class="tag ok">已启用：${esc(on.name)} · ${esc(on.model)}</span>`;
    if (ps.length) return `<span class="tag warn">已建 ${ps.length} 个档案 · 未启用</span>`;
    return '<span class="tag err">未配置（用其它已启用的档案；都没有就用内置配置）</span>';
  };

  const html = `<div class="card" style="max-width:980px;margin:0 auto">
    <div class="card-h"><h3>${ic('setting')} AI 配置中心</h3></div>
    <div class="card-b">

      <div class="mf-setcard">
        <div class="mf-sett"><b>AI 配置（全站唯一入口）</b></div>
        <div class="hint">学生端 + 管理后台<b>所有用到 AI 大模型的能力</b>都读这里启用的档案，按「能不能共用一个模型」分组 —— 配置一次全部生效，切换档案后立即全站切换。一个档案 = 一个接口：选<b>格式</b>（OpenAI 兼容 / Anthropic / Gemini）→ 填接口地址、密钥、模型 → 测试连接 → 启用。密钥保存在服务器数据库里，界面只写不回显。</div>
        <div class="mf-prole" style="margin-top:10px"><div class="mf-prole-t"><b>${ic('flash')} 当前生效</b>　${cur ? (cur.mock ? '<span class="tag warn">演示模式（AI_MOCK=1，不调外部接口）</span>' : (cur.hasKey ? `<span class="tag ok">${esc(cur.via === 'builtin' ? '内置配置（没有启用任何档案）' : cur.via)} · ${esc(cur.model)} · ${esc({ openai: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini' }[cur.format] || cur.format)}</span>` : '<span class="tag err">没有可用配置</span>')) : '<span class="tag">读取失败</span>'}
          <button class="btn ghost xs" id="mfTestCur" style="margin-left:8px">测试当前配置</button> <button class="btn ghost xs" id="mfTestAll">一键测试全部档案</button><span id="mfTestAllMsg" class="hint" aria-live="polite"></span><span id="mfTestCurMsg" class="hint" style="margin-left:8px"></span></div></div>
        ${AI_GROUPS.map((g) => `
          <div class="mf-prole" style="margin-top:10px">
            <div class="mf-prole-t"><b>${ic(g.icon)} ${g.name}</b>　${roleStatus(g.role)}</div>
            <div class="hint" style="margin:2px 0 6px">${g.desc}</div>
            <div class="r10-ai-features">
              ${g.feats.map(([t, w]) => `<div class="r10-ai-feature"><span>· ${esc(t)}</span><span>${esc(w)}</span></div>`).join('')}
            </div>
            ${g.role ? `<div style="margin-top:8px"><button class="btn primary sm" data-aigroup="${g.role}">配置${g.role === 'vision' ? '视觉' : '对话'}模型</button>
              <span class="hint">　新建档案 / 快捷设置 / 测试 / 启用</span></div>` : ''}
          </div>`).join('')}
        <div class="hint" style="margin-top:12px;border-top:1px dashed #e5e7eb;padding-top:10px">
          某个角色没有启用的档案时，会自动用别的已启用档案（所以只配一个模型也能全站通用）；一个档案都没启用时才用服务器内置配置。
          <a href="javascript:;" id="mfAiHelp" style="color:#6366f1;margin-left:8px">${ic('book')} 配置教程（去哪个网站、怎么拿 Key）</a></div>
      </div>



    </div></div>`;

  return {
    html,
    after: () => {
      document.querySelectorAll('[data-aigroup]').forEach((b) => { b.onclick = () => mfProfileDialog(b.dataset.aigroup); });
      document.getElementById('mfTestCur').onclick = async () => {
        const box = document.getElementById('mfTestCurMsg'); box.style.color = ''; box.textContent = '测试中…';
        try { const r = await api('/api/admin/ai/test', { method: 'POST', silent: true }); box.style.color = '#0e9f5f'; box.textContent = ' ' + ((r && r.message) || '连接正常'); }
        catch (e) { box.style.color = '#e0343f'; box.textContent = ' ' + (e.message || '连接失败'); }
      };
      document.getElementById('mfTestAll').onclick = async (event) => {
        const button = event.currentTarget, box = document.getElementById('mfTestAllMsg');
        if (!prof.list.length) { box.textContent = '没有已保存的档案'; return; }
        button.disabled = true; const results = [];
        try {
          for (const p of prof.list) {
            box.textContent = `正在测试 ${results.length + 1}/${prof.list.length}：${p.name}`;
            try { await api(`${MFX}/profiles/${p.id}/test`, { method: 'POST', silent: true }); results.push(`${p.name}：通过`); }
            catch (e) { results.push(`${p.name}：失败（${e.message || '连接失败'}）`); }
          }
          box.textContent = results.join('；');
        } finally { button.disabled = false; }
      };
      document.getElementById('mfAiHelp').onclick = () => mfHelpDialog();
    },
  };
}

/** 模型配置弹层（R1-R5 五角色档案列表 + 新建 + 快捷设置 + 测试 + 启用；onlyRole 只看某一个角色） */
async function mfProfileDialog(onlyRole) {
  const d = await api(MFX + '/profiles');
  const roles = onlyRole ? d.roles.filter((r) => r[0] === onlyRole) : d.roles;
  if (onlyRole && !roles.length) return toast('没有这个角色的档案定义', 'err');
  const roleRow = ([rk, rt, rd]) => {
    const ps = d.list.filter((p) => p.role === rk);
    const on = ps.find((p) => p.is_enabled);
    return `<div class="mf-prole" data-role="${rk}">
      <div class="mf-prole-t"><b>${esc(MF_ROLE_NAME[rk] || rt)}</b></div>
      <div class="mf-prole-b">
        ${on ? `<span class="tag ok">已启用：${esc(on.name)} · ${esc(on.model)}</span>` : `<span class="tag">${ps.length ? '未启用（测通后启用）' : '未配置'}</span>`}
        <button class="btn ghost xs" data-new="${rk}">新建档案</button>
        <button class="btn ghost xs" data-quick="${rk}">快捷设置</button>
        ${ps.map((p) => `<span class="mf-pitem">${esc(p.name)}（${esc(p.model)}）<span class="tag">${esc(p.format_name || 'OpenAI 兼容')}</span>${p.last_test_ok ? '<span class="tag ok">测通</span>' : (p.last_test_ok === false ? '<span class="tag err">未测通</span>' : '<span class="tag">未测</span>')}
          <a href="javascript:;" data-test="${p.id}">测试</a><a href="javascript:;" data-edit="${p.id}">编辑</a>${p.is_enabled ? '' : `<a href="javascript:;" data-en="${p.id}">启用</a>`}<a href="javascript:;" data-rm="${p.id}">删</a></span>`).join('')}
      </div></div>`;
  };
  modal({
    title: onlyRole ? `AI 配置 · ${MF_ROLE_NAME[onlyRole] || onlyRole}` : '模型配置', wide: true, okText: '关闭',
    body: `<div class="mf-tip" style="margin-bottom:10px">按用途维护模型档案，新档案须先测试连通才能启用。编辑时密钥留空即不更换。</div>
      ${roles.map(roleRow).join('')}
      <div style="text-align:right;margin-top:14px"><a href="javascript:;" id="mfHelp" style="color:#6366f1;font-size:13px"> 配置教程（去哪个网站、怎么拿 Key）</a></div>`,
    onMount: (w) => {
      const hp = w.querySelector('#mfHelp'); if (hp) hp.onclick = () => mfHelpDialog();
      w.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => mfProfileForm(b.dataset.new, null, onlyRole); });
      w.querySelectorAll('[data-edit]').forEach((a) => { a.onclick = () => {
        const p = d.list.find((x) => x.id === Number(a.dataset.edit));
        if (p) mfProfileForm(p.role, p, onlyRole);
      }; });
      w.querySelectorAll('[data-quick]').forEach((b) => { b.onclick = () => {
        const role = b.dataset.quick;
        const presets = d.presets.filter((p) => p.role === role);
        modal({ title: `快捷设置（${MF_ROLE_NAME[role] || role}）——填入 API Key 一键接入`,
          body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
            <div class="field"><label>推荐项</label><select id="qsPre">${presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select></div>
            <div class="field"><label>API Key</label><input id="qsKey" class="inp" type="password" placeholder="粘贴 Key"></div>
            <div class="hint">点确定后自动建档 + 测连通 + 启用；失败会保留档案供修改重试。</div></div>`,
          onOk: async (wq) => {
            const p = presets[Number(wq.querySelector('#qsPre').value)];
            if (!p) return false;
            const key = wq.querySelector('#qsKey').value.trim();
            if (!key) return false;
            const r = await api(MFX + '/profiles/quick', { method: 'POST', body: { role, base_url: p.base_url, model: p.model, api_key: key } });
            toast(r && r.id ? '已配置并启用' : '已配置', 'ok'); mfProfileDialog(onlyRole);
          } });
      }; });
      w.querySelectorAll('[data-test]').forEach((a) => { a.onclick = async () => {
        a.textContent = '测试中…';
        await api(`${MFX}/profiles/${a.dataset.test}/test`, { method: 'POST' });
        toast('测通成功', 'ok'); mfProfileDialog(onlyRole);
      }; });
      w.querySelectorAll('[data-en]').forEach((a) => { a.onclick = async () => {
        await api(`${MFX}/profiles/${a.dataset.en}/enable`, { method: 'POST' });
        toast('已启用', 'ok'); mfProfileDialog(onlyRole);
      }; });
      w.querySelectorAll('[data-rm]').forEach((a) => { a.onclick = async () => {
        if (!(await elConfirm({ title: '删除档案', message: '确定删除这个模型档案？', okText: '删除', danger: true }))) return;
        await api(`${MFX}/profiles/${a.dataset.rm}`, { method: 'DELETE' }); mfProfileDialog(onlyRole);
      }; });
    },
  });
}

/** AI 配置帮助 */
function mfHelpDialog() {
  modal({ title: 'AI 配置教程', wide: true, okText: '我知道了',
    body: `<div class="mf-tip">向所选服务商获取 API Key，并确认模型支持需要的文本或图片输入。回到对应用途新建档案，填写接口格式、地址和模型，测试成功后启用。编辑档案时留空密钥可保留原值。各档案的连接测试会调用对应服务。</div>` });
}

/** 技能包和题卡导入：文件、拖放或粘贴 JSON 均进入待审核。 */
function mfImportDialog(done) {
  const prompts = {
    paper: '请把我提供的整卷逐题转写成 JSON 题目包。保留题号、题干、选项、答案、解析、图片位置和公式；原文没有答案或解析时留空，不要编造。输出 questions 数组，每题包含 problem_text、options、answer、analysis、knowledge_points、difficulty_score_10。',
    image: '请转写我提供的单题截图，输出 JSON 题目包。保留原题干、选项、答案、解析、图片位置和公式；无法辨认的内容说明缺失，原文没有的答案和解析留空，不要编造。输出 questions 数组，每题包含 problem_text、options、answer、analysis、knowledge_points、difficulty_score_10。',
    web: '请根据我提供的网页内容逐题转写成 JSON 题目包。保留来源、题干、选项、答案、解析、图片位置和公式；网页没有答案或解析时留空，不要编造。输出 questions 数组，每题包含 problem_text、options、answer、analysis、knowledge_points、difficulty_score_10。',
  };
  const groupGuide = ' 英语题目请在 question_type 中保留原题型名称；对于共用材料和多个小题，请用一个对象包含 material（原文）和 children（小题数组），每个小题单独保留 problem_text、options、answer、analysis 和 question_type。音频由老师在待审核时上传，未提供的内容不要编造。';
  modal({
    title: 'AI 转写题目包', wide: true,
    body: `<p class="hint">选择适合材料的提示词，或下载技能包交给 AI 助手。转写结果导入后进入待审核，核对分类和内容后入库。</p>
      <div class="mf-box" style="margin:12px 0"><b>1. 准备转写</b>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn ghost sm" id="mfImpSkill">下载转写技能包</button>
          <button type="button" class="btn ghost sm" data-prompt="paper">复制整卷提示词</button>
          <button type="button" class="btn ghost sm" data-prompt="image">复制单题截图提示词</button>
          <button type="button" class="btn ghost sm" data-prompt="web">复制网页提示词</button>
        </div></div>
      <div class="mf-box" style="margin:12px 0"><b>2. 导入转写结果</b>
        <div id="mfDrop" style="border:1px dashed #9aaac0;border-radius:10px;padding:18px;text-align:center;margin-top:10px">
          <div>拖放 JSON / ZIP 文件到这里，或选择文件</div>
          <input type="file" id="mfImpFile" accept=".json,.zip" style="display:none">
          <button type="button" class="btn ghost sm" id="mfImpPick" style="margin-top:10px">选择文件</button>
        </div>
        <label for="mfImpJson" style="display:block;margin:12px 0 5px">也可粘贴 JSON 内容</label>
        <textarea id="mfImpJson" class="inp" rows="4" placeholder='例如 {"questions":[{"problem_text":"题干"}]}'></textarea>
        <button type="button" class="btn primary sm" id="mfImpPaste" style="margin-top:8px">导入粘贴内容</button>
        <div id="mfImpResult" aria-live="polite" style="font-size:13px;line-height:1.8;margin-top:10px"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn ghost sm" id="mfImpClose">关闭</button><button type="button" class="btn primary sm" id="mfImpReview">查看待审核</button></div>`,
    onMount: (w) => {
      const out = w.querySelector('#mfImpResult');
      let busy = false;
      w.querySelector('#mfImpClose').onclick = () => w.remove();
      w.querySelector('#mfImpReview').onclick = () => { w.remove(); location.hash = '#/pending'; };
      w.querySelector('#mfImpSkill').onclick = async () => {
        try {
          const r = await fetch(MF_API + '/import-skill', { headers: { Authorization: 'Bearer ' + Auth.token } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const b = await r.blob();
          const u = URL.createObjectURL(b);
          const a = document.createElement('a'); a.href = u; a.download = 'zhilexue-question-transcribe.zip'; a.click();
          setTimeout(() => URL.revokeObjectURL(u), 4000);
          toast('技能包已开始下载', 'ok');
        } catch (e) { toast('下载失败：' + e.message, 'err'); }
      };
      w.querySelectorAll('[data-prompt]').forEach((b) => { b.onclick = async () => {
        const value = prompts[b.dataset.prompt] + groupGuide;
        try { await navigator.clipboard.writeText(value); toast('提示词已复制', 'ok'); }
        catch (e) { w.querySelector('#mfImpJson').value = value; toast('请手动复制下方提示词，再清空输入框', 'err'); }
      }; });
      const upload = async (file) => {
        if (!file || busy) return;
        if (!/\.(json|zip)$/i.test(file.name)) { out.textContent = '请选择 JSON 或 ZIP 文件'; return; }
        busy = true; out.textContent = '正在导入，请稍候…';
        try {
          const fd = new FormData(); fd.append('file', file);
          const r = await fetch(MF_API + '/import-pack', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.msg || '导入失败');
          const d = j.data || {};
          let html = `<b style="color:#15803d">${esc(j.msg || '导入完成')}</b>（共 ${Number(d.total) || 0} 题）`;
          if (d.warnings && d.warnings.length) html += `<div style="color:#9a6700">${d.warnings.map(esc).join('<br>')}</div>`;
          if (d.errors && d.errors.length) html += `<div style="color:#b91c1c;margin-top:4px">失败明细：<br>${d.errors.map((x) => esc((x.recordKey || '') + '：' + x.msg)).join('<br>')}</div>`;
          out.innerHTML = html;
          if (typeof done === 'function') done();
        } catch (er) { out.textContent = '导入失败：' + er.message; }
        finally { busy = false; }
      };
      const fileInput = w.querySelector('#mfImpFile');
      w.querySelector('#mfImpPick').onclick = () => fileInput.click();
      fileInput.onchange = async () => { await upload(fileInput.files[0]); fileInput.value = ''; };
      const drop = w.querySelector('#mfDrop');
      drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = '#4169e1'; };
      drop.ondragleave = () => { drop.style.borderColor = '#9aaac0'; };
      drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = '#9aaac0'; upload(e.dataTransfer.files[0]); };
      w.querySelector('#mfImpPaste').onclick = () => {
        const raw = w.querySelector('#mfImpJson').value.trim();
        if (!raw) { out.textContent = '请先粘贴 JSON 内容'; return; }
        try { JSON.parse(raw); } catch (e) { out.textContent = 'JSON 格式不正确：' + e.message; return; }
        upload(new File([raw], 'questions.json', { type: 'application/json' }));
      };
    },
  });
}

/** 新建题目（章节分类 + 知识点分类 + AI 归属建议 + 公式计算器） */
async function mfNewQDialog(done) {
  let nqAud = null;   // 听力音频字段（T7）
  const imgs = []; const tags = []; const katChips = []; // 知识点归属 chips {id,name}
  const secSel = []; // 章节小知识点选中 ids
  let dStage = 'primary'; let dSub = '数学'; let dEdition = '';   // dEdition：章节树的教材版本，空 = 默认版本（R2）
  let allTrees = [];
  let chapNodes = [], knowNodes = [];
  let gradeName = ''; let volName = '上册'; let unitId = '';
  let katExp = '';
  const GRADES = { primary: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'], junior: ['七年级', '八年级', '九年级'] };
  const SUBJECTS4 = ['英语', '数学', '物理', '化学'];

  const loadTrees = async () => {
    const trees = await tpTrees();
    allTrees = trees;
    const ct = pickTree(trees, { kind: 'textbook', subject: dSub, stage: dStage, edition: dEdition });
    const kt = pickTree(trees, { kind: 'knowledge', subject: dSub, stage: dStage });
    dEdition = ct ? String(ct.edition || '') : '';
    chapNodes = ct ? (await api(`${MF_API}/trees/${ct.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [] : [];
    knowNodes = kt ? (await api(`${MF_API}/trees/${kt.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [] : [];
  };
  const kidsOf = (list) => { const k = {}; list.forEach((n) => { const p = n.parent_id || 0; (k[p] = k[p] || []).push(n); }); return k; };

  modal({
    title: '新建题目', wide: true,
    body: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px">
        <div class="field"><label>学段</label><select id="nqStage" class="inp"><option value="primary">小学</option><option value="junior">初中</option></select></div>
        <div class="field"><label>学科</label><select id="nqSub" class="inp">${SUBJECTS4.map((x) => `<option ${x === '数学' ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label>题型（可空）</label><select id="nqType" class="inp"><option value="">未设置</option>${Object.entries(MF_TYPE_NAME).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
        <div class="field"><label>难度（五星，可空）</label><select id="nqDiff" class="inp"><option value="">未设置</option>${Object.entries(MF_DIFF_NAMES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><label for="nqDiff10">十级难度（可空）</label><input id="nqDiff10" class="inp" type="number" min="1" max="10" step="1" placeholder="未细分"></div>
      </div>
      <div class="field"><label>章节分类 *（年级 → 册别 → 单元 → 小知识点）</label>
        <div style="display:flex;gap:8px">
          <select id="nqEd" class="inp" style="flex:1" title="教材版本" aria-label="教材版本"></select>
          <select id="nqGrade" class="inp" style="flex:1"></select>
          <select id="nqVol" class="inp" style="flex:1"></select>
          <select id="nqUnit" class="inp" style="flex:2"></select>
        </div>
        <div id="nqSecs" style="display:flex;gap:8px 14px;flex-wrap:wrap;margin-top:6px;font-size:12.5px"></div>
      </div>
      <div class="field"><label>知识点分类 *（按学段，不含年级）</label>
        <select id="nqKat" class="inp"></select>
        <div id="nqKatKids" style="display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:6px;font-size:12.5px;align-items:center"></div>
      </div>
      <div class="field"><label>题面（必填）</label>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button class="btn ghost xs" id="nqFx" title="插入公式（计算器）">∑ fx</button>
          <button class="btn ghost xs" id="nqImg" title="插入图片"></button>
          <button class="btn ghost xs" id="nqTbl" title="插入表格">▦</button>
          <button class="btn ghost xs" id="nqLst" title="插入列表">≡</button>
          <input type="file" id="nqImgFile" accept="image/*" style="display:none">
        </div>
        <div id="nqFpad" style="display:none;margin-bottom:6px"></div>
        <textarea id="nqStem" class="inp" rows="5" style="width:100%" placeholder="题干，公式点 ∑ fx 用公式计算器插入，图片点  上传"></textarea>
        <div id="nqImgs" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin:2px 0 8px">
        <div style="display:flex;gap:8px">
          <button class="btn ghost xs" id="nqAnsBtn">• 答案（空·点击补充）</button>
          <button class="btn ghost xs" id="nqAnaBtn">• 解析（空·点击补充）</button>
        </div>
        <span style="display:flex;gap:10px;align-items:center">
          <span class="hint" style="line-height:1.5">点 AI 归属建议：<br>AI 自动判断学段 / 年级 / 知识点 / 难度</span>
          <button class="btn ghost xs" id="nqAI" style="white-space:nowrap"> AI 归属建议</button>
        </span>
      </div>
      <div id="nqAnsWrap" style="display:none;margin-bottom:8px"><textarea id="nqAns" class="inp" rows="3" style="width:100%" placeholder="答案，支持公式；留空则入库为「缺答案」"></textarea></div>
      <div id="nqAnaWrap" style="display:none;margin-bottom:8px"><textarea id="nqAna" class="inp" rows="3" style="width:100%" placeholder="解析"></textarea></div>
      <div id="nqAudio"></div>
      <div class="field"><label>普通标签（与知识点分开）</label>
        <div style="display:flex;gap:8px"><input id="nqTagInp" class="inp" style="flex:1" placeholder="输入标签后回车或添加">
        <button class="btn ghost xs" id="nqTagAdd">添加标签</button></div>
        <div id="nqTags" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div></div>`,
    okText: '保存',
    onOk: async (w, showErr) => {
      const stem = w.querySelector('#nqStem').value.trim();
      if (!stem) return showErr('题面（题干）必填');
      const score10 = w.querySelector('#nqDiff10').value;
      if (score10 !== '' && (!Number.isInteger(Number(score10)) || Number(score10) < 1 || Number(score10) > 10)) return showErr('十级难度须为 1 至 10 的整数');
      const secIds = [...w.querySelectorAll('[data-sec]')].filter((x) => x.checked).map((x) => Number(x.dataset.sec)).filter(Boolean);
      const chapIds = secIds.length ? secIds : (unitId ? [Number(unitId)] : []);
      if (!chapIds.length) return showErr('请选择章节分类（年级 / 册别 / 单元）——每道题都必须归属章节');
      if (!katChips.length) return showErr('请在「知识点分类」至少勾选一个知识点——每道题都必须归属知识点');
      const nodeIds = [...new Set([...chapIds, ...katChips.map((c) => c.id)])];
      const gradeSel = w.querySelector('#nqGrade');
      await api(MF_API + '/questions', { method: 'POST', body: {
        stem,
        type: w.querySelector('#nqType').value || 'answer',
        stage: dStage,
        subject: dSub,
        grade: gradeSel.value || '',
        difficulty: w.querySelector('#nqDiff').value || 3, difficulty_score_10: score10 === '' ? null : Number(score10),
        answer: w.querySelector('#nqAns').value.trim(),
        analysis: w.querySelector('#nqAna').value.trim(),
        options: [],
        images: imgs,
        audio_key: nqAud ? nqAud.get() : '',
        audio_play_limit: nqAud ? nqAud.getLimit() : 0,
        tags,
        nodes: nodeIds,
      } });
      toast('题目已入库', 'ok'); if (typeof done === 'function') done();
    },
    onMount: (w) => {
      nqAud = t7AudioWidget(w.querySelector('#nqAudio'), {});
      qcBindDifficultyInputs(w.querySelector('#nqDiff'), w.querySelector('#nqDiff10'));
      t8Enhance(w, { fields: ['#nqStem', '#nqAns', '#nqAna'], images: imgs, onImage: () => renderImgs() });   // 公式输入 + 粘贴 / 拖拽图片（T8）
      const ta = w.querySelector('#nqStem');
      const renderTags = () => { w.querySelector('#nqTags').innerHTML = tags.map((t, i) => `<span class="mf-pitem">${esc(t)}<a href="javascript:;" data-ti="${i}">✕</a></span>`).join(''); };
      const renderImgs = () => { w.querySelector('#nqImgs').innerHTML = imgs.map((u, i) => `<span style="position:relative;display:inline-block"><img src="${esc(u)}" style="height:44px;border-radius:6px;border:1px solid #e5e7eb"><a href="javascript:;" data-ii="${i}" style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border-radius:50%;width:16px;height:16px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none">✕</a></span>`).join(''); };

      /* —— 章节分类级联 —— */
      const renderChapter = () => {
        const ck = kidsOf(chapNodes);
        const gradeSel = w.querySelector('#nqGrade');
        const grades = GRADES[dStage] || [];
        gradeSel.innerHTML = grades.map((g) => `<option ${g === gradeName ? 'selected' : ''}>${g}</option>`).join('') || '<option value="">（无年级数据）</option>';
        gradeName = gradeSel.value;
        const gNode = chapNodes.find((n) => n.name === gradeName);
        const vols = gNode ? (ck[gNode.id] || []) : [];
        const volSel = w.querySelector('#nqVol');
        volSel.innerHTML = vols.length ? vols.map((v) => `<option value="${v.id}" ${v.name === volName ? 'selected' : ''}>${esc(v.name)}</option>`).join('') : '<option value="">（无册别）</option>';
        volName = (volSel.selectedOptions[0] && volSel.selectedOptions[0].textContent) || '';
        const vNode = vols.find((v) => String(v.id) === String(volSel.value));
        const units = vNode ? (ck[vNode.id] || []) : [];
        const unitSel = w.querySelector('#nqUnit');
        unitSel.innerHTML = units.length ? units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('') : '<option value="">（无单元数据）</option>';
        unitId = unitSel.value;
        const uNode = units.find((u) => String(u.id) === String(unitId));
        const secs = uNode ? (ck[uNode.id] || []) : [];
        [...secSel].forEach((id) => { if (!secs.some((x) => String(x.id) === String(id))) secSel.splice(secSel.indexOf(id), 1); });
        w.querySelector('#nqSecs').innerHTML = secs.length
          ? secs.map((sc) => `<label style="display:inline-flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-sec="${sc.id}" ${secSel.includes(Number(sc.id)) || secSel.includes(String(sc.id)) ? 'checked' : ''}> ${esc(sc.name)}</label>`).join('')
          : '<span class="hint">该单元下没有更细的小知识点，保存时归属整个单元</span>';
      };
      /* —— 知识点分类级联 —— */
      const renderKnowledge = () => {
        const kk = kidsOf(knowNodes);
        const roots = kk[0] || [];
        const katSel1 = w.querySelector('#nqKat');
        katSel1.innerHTML = roots.length ? roots.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') : '<option value="">（该学段科目暂无知识点树）</option>';
        const rNode = roots.find((r) => String(r.id) === String(katSel1.value));
        const children = rNode ? (kk[rNode.id] || []) : [];
        const box = w.querySelector('#nqKatKids');
        const chip = (n) => `<span class="mf-chipck ${katChips.some((x) => String(x.id) === String(n.id)) ? 'on' : ''}"><a href="javascript:;" data-kat="${n.id}">${katChips.some((x) => String(x.id) === String(n.id)) ? '☑' : '☐'} ${esc(n.name)}</a></span>`;
        box.innerHTML = children.length ? children.map((c) => {
          const gc = kk[c.id] || [];
          const exp = String(katExp) === String(c.id) && gc.length;
          return `<span style="display:inline-flex;gap:4px;align-items:center">${chip(c)}${gc.length ? `<a href="javascript:;" class="mf-kx" data-kexp="${c.id}">${exp ? '▴' : '▾'}</a>` : ''}</span>${exp ? gc.map(chip).join('') : ''}`;
        }).join('') : (rNode ? chip(rNode) : '<span class="hint">暂无知识点数据</span>');
      };
      const renderEdition = () => {
        const eds = tpEditions(allTrees, { kind: 'textbook', subject: dSub, stage: dStage });
        const sel = w.querySelector('#nqEd');
        sel.innerHTML = eds.map((e) => `<option value="${esc(e)}" ${e === dEdition ? 'selected' : ''}>${esc(e || '通用')}</option>`).join('') || '<option value="">无版本</option>';
        sel.disabled = !eds.length;
      };
      const reloadTrees = async () => {
        gradeName = ''; volName = '上册'; unitId = ''; katExp = ''; secSel.length = 0;
        await loadTrees();
        renderEdition(); renderChapter(); renderKnowledge();
      };
      w.querySelector('#nqEd').onchange = async (e) => { dEdition = e.target.value; gradeName = ''; volName = '上册'; unitId = ''; secSel.length = 0; await loadTrees(); renderEdition(); renderChapter(); };

      /* —— 学段 / 学科切换 —— */
      w.querySelector('#nqStage').onchange = async (e) => {
        dStage = e.target.value; dEdition = '';
        if (dStage === 'primary' && (dSub === '物理' || dSub === '化学')) { dSub = '数学'; w.querySelector('#nqSub').value = '数学'; }
        await reloadTrees();
      };
      w.querySelector('#nqSub').onchange = async (e) => { dSub = e.target.value; dEdition = ''; await reloadTrees(); };
      w.querySelector('#nqGrade').onchange = (e) => { gradeName = e.target.value; volName = '上册'; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqVol').onchange = (e) => { volName = (e.target.selectedOptions[0] && e.target.selectedOptions[0].textContent) || ''; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqUnit').onchange = (e) => { unitId = e.target.value; secSel.length = 0; renderChapter(); };
      w.querySelector('#nqSecs').addEventListener('change', (e) => {
        const ck = e.target.closest('[data-sec]'); if (!ck) return;
        const id = Number(ck.dataset.sec);
        if (ck.checked) { if (!secSel.includes(id)) secSel.push(id); }
        else { const i = secSel.indexOf(id); if (i >= 0) secSel.splice(i, 1); }
      });
      w.querySelector('#nqKat').onchange = () => { katExp = ''; renderKnowledge(); };
      w.querySelector('#nqKatKids').onclick = (e) => {
        const kx = e.target.closest('[data-kexp]');
        if (kx) { katExp = String(katExp) === kx.dataset.kexp ? '' : kx.dataset.kexp; renderKnowledge(); return; }
        const a = e.target.closest('[data-kat]'); if (!a) return;
        const id = Number(a.dataset.kat);
        const all = knowNodes.find((n) => Number(n.id) === id);
        const i = katChips.findIndex((x) => String(x.id) === String(id));
        if (i >= 0) katChips.splice(i, 1);
        else katChips.push({ id, name: all ? all.name : a.textContent.replace(/^[☐☑]\s*/, '') });
        renderKnowledge();
      };

      /* —— 题面工具 + 公式计算器 —— */
      const insAt = (txt) => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(txt, s, e, 'end'); ta.focus(); };
      const fpad = w.querySelector('#nqFpad');
      w.querySelector('#nqFx').onclick = () => {
        if (fpad.style.display === 'none') { mfFormulaPad(ta, fpad); fpad.style.display = ''; }
        else fpad.style.display = 'none';
      };
      w.querySelector('#nqTbl').onclick = () => insAt('\n| 表头1 | 表头2 |\n| --- | --- |\n| 内容 | 内容 |\n');
      w.querySelector('#nqLst').onclick = () => insAt('\n1. \n2. \n');
      w.querySelector('#nqImg').onclick = () => w.querySelector('#nqImgFile').click();
      w.querySelector('#nqImgFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const fd = new FormData(); fd.append('file', f);
          const r = await fetch(MF_API + '/asset', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
          const j = await r.json();
          if (j.code !== 0) throw new Error(j.msg || '上传失败');
          imgs.push(j.data.url); insAt(`\n[图${imgs.length}]`); renderImgs(); toast('图片已上传', 'ok');
        } catch (er) { toast(er.message, 'err'); }
        e.target.value = '';
      };

      /* —— AI 归属建议 —— */
      const aiBtn = w.querySelector('#nqAI');
      aiBtn.onclick = async () => {
        const stem = ta.value.trim();
        if (!stem) return toast('先填题干再点 AI 归属建议', 'err');
        aiBtn.disabled = true; const oldTxt = aiBtn.textContent; aiBtn.textContent = ' AI 判断中…';
        try {
          const r = await api(MFX + '/ai-attrib', { method: 'POST', body: { stem, subject: dSub } });
          let filled = [];
          if (r.stage && ['primary', 'junior'].includes(r.stage)) { dStage = r.stage; w.querySelector('#nqStage').value = r.stage; filled.push('学段'); }
          if (r.subject && SUBJECTS4.includes(r.subject)) { dSub = r.subject; w.querySelector('#nqSub').value = r.subject; filled.push('学科'); }
          dEdition = ''; await loadTrees(); renderEdition();
          if (r.grade) {
            const g = (GRADES[dStage] || []).find((x) => String(r.grade).includes(x) || x.includes(String(r.grade)));
            if (g) { gradeName = g; filled.push('年级'); }
          }
          // 教材章节回填：找到返回的 textbook 节点 → 定位单元 + 勾选小知识点
          const tbNode = (r.nodes || []).find((n) => n.tree === 'textbook');
          if (tbNode) {
            const n = chapNodes.find((x) => Number(x.id) === Number(tbNode.id));
            if (n) {
              const ck = kidsOf(chapNodes);
              let unit = n;
              while (unit) { // 上溯到「单元层」：父是册别、祖父是年级
                const par = chapNodes.find((x) => x.id === unit.parent_id);
                if (!par) { unit = null; break; } // n 本身是年级层
                const gp = chapNodes.find((x) => x.id === par.parent_id);
                if (!gp || !gp.parent_id) break; // par 是册别层 → unit 已是单元
                unit = par;
              }
              unitId = String(unit.id);
              secSel.length = 0;
              (r.nodes || []).forEach((nn) => { if (nn.tree === 'textbook' && Number(nn.id) !== Number(unit.id)) secSel.push(Number(nn.id)); });
              filled.push('章节');
            }
          }
          renderChapter();
          // 知识点回填
          (r.nodes || []).forEach((nn) => {
            if (nn.tree === 'knowledge' && !katChips.some((x) => String(x.id) === String(nn.id))) katChips.push({ id: Number(nn.id), name: nn.name });
          });
          if (katChips.length) filled.push('知识点');
          if (r.difficulty && !w.querySelector('#nqDiff10').value) { w.querySelector('#nqDiff').value = String(r.difficulty); filled.push('难度'); }
          renderKnowledge();
          toast(filled.length ? `AI 建议已回填：${filled.join(' / ')}，检查后保存` : 'AI 没能判断出归属，请手动选择', filled.length ? 'ok' : 'err');
        } catch (er) { toast(er.message, 'err'); }
        aiBtn.disabled = false; aiBtn.textContent = oldTxt;
      };

      /* —— 答案 / 解析 / 标签 —— */
      const upd = () => {
        w.querySelector('#nqAnsBtn').textContent = '• 答案' + (w.querySelector('#nqAns').value.trim() ? '（已填）' : '（空·点击补充）');
        w.querySelector('#nqAnaBtn').textContent = '• 解析' + (w.querySelector('#nqAna').value.trim() ? '（已填）' : '（空·点击补充）');
      };
      w.querySelector('#nqAnsBtn').onclick = () => { const x = w.querySelector('#nqAnsWrap'); x.style.display = x.style.display === 'none' ? '' : 'none'; };
      w.querySelector('#nqAnaBtn').onclick = () => { const x = w.querySelector('#nqAnaWrap'); x.style.display = x.style.display === 'none' ? '' : 'none'; };
      w.querySelector('#nqAns').oninput = upd; w.querySelector('#nqAna').oninput = upd;
      w.querySelector('#nqTagAdd').onclick = () => { const v = w.querySelector('#nqTagInp').value.trim(); if (v && !tags.includes(v)) tags.push(v); w.querySelector('#nqTagInp').value = ''; renderTags(); };
      w.querySelector('#nqTagInp').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); w.querySelector('#nqTagAdd').onclick(); } };
      w.querySelector('#nqTags').onclick = (e) => { const a = e.target.closest('[data-ti]'); if (a) { tags.splice(Number(a.dataset.ti), 1); renderTags(); } };
      w.querySelector('#nqImgs').onclick = (e) => { const a = e.target.closest('[data-ii]'); if (a) { imgs.splice(Number(a.dataset.ii), 1); renderImgs(); } };

      reloadTrees();
    },
  });
}

/** 公式计算器（魔方式：常用/运算符号/希腊/函数/上下标 + 输入框 + 行内/独立成行） */
function mfFormulaPad(ta, mount) {
  const PADS = {
    '常用': ['×', '÷', '±', '≠', '≤', '≥', '√', 'π', '°', '²', '³', '℃', '%', '′', '″', '∶'],
    '运算符号': ['+', '−', '×', '÷', '±', '=', '≠', '≈', '<', '>', '≤', '≥', '∵', '∴', '∈', '∪', '∩', '∑', '∏', '∫', '∞', '⊥', '∥', '△', '∠'],
    '希腊': ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Θ', 'Λ', 'Π', 'Σ', 'Φ', 'Ω'],
    '函数': ['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lg', 'lim', 'f(x)', '\\frac{}{}', '\\sqrt{}', '\\sqrt[3]{}'],
    '上下标': ['^{2}', '_{1}', '^{n}', 'a^{2}+b^{2}=c^{2}', '\\frac{a}{b}', '\\sqrt{a}', 'x_{1}+x_{2}', '\\tfrac{1}{2}'],
  };
  let tab = '常用'; let mode = 'inline';
  const draw = () => {
    mount.innerHTML = `<div class="mf-fpad">
      <div class="mf-fpad-h"><b>∑ 插入公式</b><span class="hint">点符号即输</span><span style="flex:1"></span><a href="javascript:;" class="mf-fpad-x" data-fpx>✕</a></div>
      <input class="inp mf-fpad-in" placeholder="输入或点下方符号，完成后点「插入」">
      <div class="mf-fpad-tabs">${Object.keys(PADS).map((t) => `<a href="javascript:;" data-fpt="${t}" class="${t === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
      <div class="mf-fpad-grid">${PADS[tab].map((x) => `<button class="mf-fpad-k" data-fpk="${esc(x)}">${esc(x.replace(/\\/g, ''))}</button>`).join('')}</div>
      <div class="mf-fpad-b">
        <span>排版：<a href="javascript:;" data-fpm="inline" class="${mode === 'inline' ? 'on' : ''}">行内</a> · <a href="javascript:;" data-fpm="block" class="${mode === 'block' ? 'on' : ''}">独立成行</a></span>
        <span style="flex:1"></span>
        <button class="btn ghost xs" data-fpc>取消</button>
        <button class="btn xs" data-fpi>插入</button>
      </div></div>`;
    const inp = mount.querySelector('.mf-fpad-in');
    mount.querySelector('[data-fpx]').onclick = () => { mount.style.display = 'none'; };
    mount.querySelector('[data-fpc]').onclick = () => { mount.style.display = 'none'; };
    mount.querySelectorAll('[data-fpt]').forEach((a) => { a.onclick = () => { tab = a.dataset.fpt; draw(); }; });
    mount.querySelectorAll('[data-fpm]').forEach((a) => { a.onclick = () => { mode = a.dataset.fpm; draw(); }; });
    mount.querySelectorAll('[data-fpk]').forEach((b) => { b.onclick = () => {
      const v = b.dataset.fpk;
      const s = inp.selectionStart, e = inp.selectionEnd;
      inp.setRangeText(v, s, e, 'end'); inp.focus();
    }; });
    mount.querySelector('[data-fpi]').onclick = () => {
      const v = inp.value.trim();
      if (!v) return toast('先点符号或输入公式内容', 'err');
      const txt = mode === 'inline' ? `$${v}$` : `\n$$\n${v}\n$$\n`;
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.setRangeText(txt, s, e, 'end'); ta.focus();
      mount.style.display = 'none';
    };
  };
  draw();
}

/** 知识节点多选器（跨树选择，勾选回填） */
function mfNodePickMulti(nodes, onDone) {
  (async () => {
    const trees = await tpTrees();
    if (!trees.length) return toast('先在左侧建一棵知识树再选节点', 'err');
    modal({
      title: '选择知识节点（可多选）',
      body: `<div class="field"><label>知识树</label><select id="npTree" class="inp">${trees.map((t) => `<option value="${t.id}">${esc(treeLabel(t))}（${t.node_count}节点）</option>`).join('')}</select></div>
        <div id="npList" class="mf-treebox" style="max-height:360px;margin-top:6px"></div>`,
      okText: '确定',
      onOk: () => { if (typeof onDone === 'function') onDone(); },
      onMount: (w) => {
        const cur = new Set(nodes.map((n) => n.id));
        const load = async () => {
          const tid = w.querySelector('#npTree').value;
          const ns = (await api(`${MF_API}/trees/${tid}/nodes`, { silent: true }).catch(() => ({ list: [] }))).list || [];
          const byP = {}; ns.forEach((n) => { (byP[n.parent_id || 0] = byP[n.parent_id || 0] || []).push(n); });
          const dep = (n) => { let d = 0, p = n; while (p && p.parent_id) { p = ns.find((x) => x.id === p.parent_id); d++; if (d > 9) break; } return d; };
          w.querySelector('#npList').innerHTML = ns.map((n) => `<div data-npid="${n.id}" style="padding-left:${dep(n) * 18}px;cursor:pointer;line-height:2;font-size:13px">${cur.has(n.id) ? '☑' : '☐'} ${esc(n.name)}</div>`).join('') || '<div class="hint">这棵树还没有节点</div>';
          w.querySelector('#npList').onclick = (e) => {
            const row = e.target.closest('[data-npid]'); if (!row) return;
            const id = Number(row.dataset.npid);
            const name = row.textContent.replace(/^[☐☑]\s*/, '');
            if (cur.has(id)) { cur.delete(id); row.textContent = row.textContent.replace('☑', '☐'); }
            else { cur.add(id); row.textContent = row.textContent.replace('☐', '☑'); }
            nodes.length = 0;
            [...cur].forEach((nid) => {
              const old = nodes.find((x) => x.id === nid) || (ns.find((x) => x.id === nid) ? { id: nid, name: ns.find((x) => x.id === nid).name } : null);
              if (old) nodes.push(old); else nodes.push({ id: nid, name });
            });
          };
        };
        w.querySelector('#npTree').onchange = load;
        load();
      },
    });
  })();
}

/** 新建 / 编辑模型档案（魔方式：可拉取平台模型列表自由接入任何 OpenAI 兼容模型） */
const MF_ROLE_NAME = { reasoning: '文本生成', vision: '图像识别', light: '分类整理', embedding: '相似度检索', specialty: '其他用途' };
/** 档案格式（与 src/ai-client.js 的 FORMATS / FORMAT_HINTS 对应）：不绑定厂商，只给各协议标准的地址写法做提示 */
const MF_FORMATS = [
  ['openai', 'OpenAI 兼容', 'https://你的服务商/v1', '填到 /v1 为止，系统自动补 /chat/completions。通义、DeepSeek、智谱、Moonshot、OpenAI 等都选这一类。'],
  ['anthropic', 'Anthropic Messages', 'https://api.anthropic.com', '填到域名为止，系统自动补 /v1/messages（填了 /v1 也行）。'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com', '填到域名为止，系统自动补 /v1beta/models/{模型名}:generateContent。'],
];
function mfProfileForm(role, prof, fromRole) {
  const isEdit = !!prof;
  const curFmt = (isEdit && prof.format) || 'openai';
  modal({
    title: `${isEdit ? '编辑档案' : '新建档案'} · ${MF_ROLE_NAME[role] || role}`,
    body: `<div class="mf-form" style="flex-direction:column;align-items:stretch">
      <div class="field"><label>名称</label><input id="pfName" class="inp" placeholder="如：DeepSeek 官方" value="${isEdit ? esc(prof.name) : ''}"></div>
      <div class="field"><label>供应商</label><input id="pfProv" class="inp" placeholder="如：deepseek" value="${isEdit ? esc(prof.provider || '') : ''}"></div>
      <div class="field"><label>格式</label><select id="pfFormat" class="inp">${MF_FORMATS.map(([k, t]) => `<option value="${k}" ${k === curFmt ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>接口地址</label><input id="pfBase" class="inp" placeholder="${esc((MF_FORMATS.find((f) => f[0] === curFmt) || MF_FORMATS[0])[2])}" value="${isEdit ? esc(prof.base_url) : ''}">
        <div class="hint" id="pfFmtHint">${esc((MF_FORMATS.find((f) => f[0] === curFmt) || MF_FORMATS[0])[3])}</div></div>
      <div class="field"><label>API Key</label><input id="pfKey" class="inp" type="password" placeholder="${isEdit ? '留空 = 不修改原 Key' : '粘贴 API Key（sk-…，加密托管于本机）'}"></div>
      <div class="field"><label>模型</label><div style="display:flex;gap:8px;align-items:center">
        <input id="pfModel" class="inp" list="pfModelList" placeholder="如：deepseek-chat（可直接输入 id）" style="flex:1" value="${isEdit ? esc(prof.model) : ''}">
        <button type="button" class="btn ghost xs" id="pfFetch" style="flex:0 0 auto">获取模型列表</button></div>
        <datalist id="pfModelList"></datalist>
        <div class="hint">点「获取模型列表」从平台拉取该 Key 可用的全部模型，也可直接手输模型 id。</div></div>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:2px"><input type="checkbox" id="pfVision" ${((isEdit ? (prof.capability || '') : '') || (role === 'vision' ? 'vision' : '')) ? 'checked' : ''}> 该模型支持图片输入（图像识别需要）</label>
    </div>`,
    onOk: async (w, showErr) => {
      const name = w.querySelector('#pfName').value.trim();
      const base = w.querySelector('#pfBase').value.trim();
      const model = w.querySelector('#pfModel').value.trim();
      const key = w.querySelector('#pfKey').value.trim();
      const body = {
        name, base_url: base, model,
        format: w.querySelector('#pfFormat').value,
        provider: w.querySelector('#pfProv').value.trim(),
        capability: w.querySelector('#pfVision').checked ? 'vision' : '',
      };
      if (!name || !base || !model) return showErr('名称 / Base URL / 模型名都要填');
      if (isEdit) {
        if (key) body.api_key = key; // 留空 = 不改原 Key
        await api(`${MFX}/profiles/${prof.id}`, { method: 'PUT', body });
      } else {
        if (!key) return showErr('API Key 要填（平台控制台创建后粘贴进来）');
        body.role = role; body.api_key = key;
        await api(MFX + '/profiles', { method: 'POST', body });
      }
      toast(isEdit ? '已保存，请重新测试连通' : '档案已建，先测连通再启用', 'ok'); mfProfileDialog(fromRole);
    },
    onMount: (w) => {
      // 换格式：更新地址提示（只换提示，不改用户已经填的地址）
      w.querySelector('#pfFormat').onchange = () => {
        const f = MF_FORMATS.find((x) => x[0] === w.querySelector('#pfFormat').value) || MF_FORMATS[0];
        w.querySelector('#pfBase').placeholder = f[2];
        w.querySelector('#pfFmtHint').textContent = f[3];
      };
      // 测试连接：不用先保存，填完直接测
      const testRow = document.createElement('div');
      testRow.style.cssText = 'margin:2px 0 0;display:flex;gap:10px;align-items:center';
      testRow.innerHTML = '<button type="button" class="btn ghost xs" id="pfTest">测试连接</button><span id="pfTestMsg" class="hint"></span>';
      w.querySelector('#pfModel').closest('.field').appendChild(testRow);
      w.querySelector('#pfTest').onclick = async () => {
        const msgEl = w.querySelector('#pfTestMsg');
        const body = { role, id: isEdit ? prof.id : undefined, name: w.querySelector('#pfName').value.trim(), format: w.querySelector('#pfFormat').value,
          base_url: w.querySelector('#pfBase').value.trim(), model: w.querySelector('#pfModel').value.trim(), api_key: w.querySelector('#pfKey').value.trim() };
        msgEl.style.color = ''; msgEl.textContent = '测试中…';
        try { const r = await api(MFX + '/profiles/test-draft', { method: 'POST', body, silent: true }); msgEl.style.color = '#0e9f5f'; msgEl.textContent = ' ' + (r && r.ms != null ? `连接成功（${r.ms} ms）` : '连接成功'); }
        catch (e) { msgEl.style.color = '#e0343f'; msgEl.textContent = ' ' + (e.message || '连接失败'); }
      };
      w.querySelector('#pfFetch').onclick = async () => {
        const base = w.querySelector('#pfBase').value.trim();
        const key = w.querySelector('#pfKey').value.trim();
        if (!base) return toast('先填 Base URL（一般到 /v1 为止）', 'err');
        if (!key) return toast(isEdit ? '编辑模式拉列表需在 Key 框粘贴 Key（留空保存时不影响原 Key）' : '先粘贴 API Key 再拉列表', 'err');
        const btn = w.querySelector('#pfFetch');
        btn.textContent = '拉取中…'; btn.disabled = true;
        try {
          const r = await api(MFX + '/profiles/models', { method: 'POST', body: { format: w.querySelector('#pfFormat').value, base_url: base, api_key: key } });
          w.querySelector('#pfModelList').innerHTML = (r.models || []).map((m) => `<option value="${esc(m)}">`).join('');
          toast(`拉到 ${(r.models || []).length} 个模型——点模型输入框即可从下拉选择`, 'ok');
        } catch (e) { toast(e.message || '拉取失败', 'err'); }
        btn.textContent = '获取模型列表'; btn.disabled = false;
      };
    },
  });
}

/** 字典/树映射弹层 */
async function mfDictDialog() {
  const d = await api(MFX + '/dict');
  const rows = d.list || [];
  modal({
    title: `字典 / 树映射（${d.counts.total} 行 · 未知值 ${d.counts.unknown} · 树 ${d.counts.trees} 棵）`, wide: true, okText: '关闭',
    body: `<div class="mf-tip" style="margin-bottom:8px">采集来源同义值 → 标准码映射；未识别的值可在此指认归位（映射加一行即可）。</div>
      ${(d.counts.unknown_values || []).length ? `<div class="mf-box" style="border-color:#fca5a5;margin-bottom:8px"><h4 style="color:#dc2626">未识别的取值</h4>
        ${(d.counts.unknown_values || []).map((v) => `<span class="tag err" style="margin:2px">${esc(v)}</span>`).join('')}</div>` : ''}
      <div style="max-height:340px;overflow:auto"><table class="tb"><thead><tr><th>类型</th><th>站点</th><th>原文</th><th>标准码</th><th>归一名</th><th style="width:150px">操作</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.kind === 'subject' ? '学科' : r.kind}</td>
        <td>${r.site ? ({ zujuan: '组卷网', jyeoo: '菁优网', '21cnjy': '二一' })[r.site] || r.site : '—'}</td>
        <td>${esc(r.site ? r.source_label || r.label : r.label)}</td>
        <td>${esc(r.code)}</td>
        <td>${esc(r.resolved_label || '')}</td>
        <td>${r.site ? `<a href="javascript:;" data-dm="${r.id}">删</a>` : '<span class="hint">归一行</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="mf-box" style="margin-top:10px"><h4>添加映射</h4>
        <div class="row">
          <select id="dmSite" class="mf-fsel" style="width:110px"><option value="">（归一行）</option><option value="zujuan">组卷网</option><option value="jyeoo">菁优网</option><option value="21cnjy">二一</option></select>
          <input id="dmSrc" class="inp" style="width:140px" placeholder="原文，如 道法">
          <input id="dmCode" class="inp" style="width:140px" placeholder="标准码，如 morality-law">
          <button class="btn sm" id="dmAdd">添加</button></div></div>`,
    onMount: (w) => {
      w.querySelector('#dmAdd').onclick = async () => {
        await api(MFX + '/dict', { method: 'POST', body: { kind: 'subject', site: w.querySelector('#dmSite').value, source_label: w.querySelector('#dmSrc').value.trim(), code: w.querySelector('#dmCode').value.trim() } });
        toast('已添加', 'ok'); mfDictDialog();
      };
      w.querySelectorAll('[data-dm]').forEach((a) => { a.onclick = async () => {
        await api(`${MFX}/dict/${a.dataset.dm}`, { method: 'DELETE' }); mfDictDialog();
      }; });
    },
  });
}
