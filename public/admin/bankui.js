/* 管理端 · 智能题库（2026-10 新增）
 *  四个视图（由 admin.js 的 VIEWS 调用）：
 *    viewBank()      题库管理：筛选 / 新增编辑 / Excel 导入 / 删除
 *    viewPaper()     智能组卷：按题型数量一键抽题 → 预览调整 → 保存 / 下发
 *    viewLessonQ()   课文习题：选课本 → 左侧分组 → 右侧视频 → 给视频添加 / 绑定习题
 *    viewMistakeLog() 错题记录：按学生 / 学科查看，支持打印纸质版
 *  依赖 admin.js 的 modal / esc / api / toast / ic / pagerHTML / bindPager / loadMeta / ADM，api.js 的 elConfirm。 */
'use strict';

const BK_TYPES = [
  ['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'],
  ['fill', '填空题'], ['sort', '排序·连词成句'],
];
const BK_TYPE_NAME = Object.fromEntries(BK_TYPES);
const BK_LETTERS = 'ABCDEFG';
const BK_STAGES = [['', '全部学段'], ['primary', '小学'], ['junior', '初中']];
const BK_GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const BK_QTNAME = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题' };

const bkStageName = (s) => (s === 'primary' ? '小学' : s === 'junior' ? '初中' : '');
const bkDiffName = (n) => ['☆', '★', '★★', '★★★', '★★★★', '★★★★★'][Number(n) || 3] || '★★★';
function bkTrunc(s, n = 42) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
/** 题目答案的展示文本 */
function bkAnswerText(q) {
  const s = String(q.answer || '');
  if (q.type === 'fill') {
    const PH = '\u0001';
    return String(s || '').replace(/\|\|\|/g, PH).split('|')
      .map((x) => x.split(PH).filter((y) => y !== '').join(' / '))
      .join(' | ');
  }
  if (q.type === 'sort') return s.split(',').map((n) => { const i = Number(n) - 1; return (q.options || [])[i] || n; }).join(' → ');
  return s;
}
/** 学生作答的展示文本（错题记录用） */
function bkMineText(q, mine) {
  const s = String(mine || '');
  if (q.type === 'fill') return s.split('|').join(' | ');
  if (q.type === 'sort') return s.split(',').map((n) => { const i = Number(n) - 1; return (q.options || [])[i] || n; }).join(' → ');
  return s;
}
function bkChapterLabel(c) {
  return [c.grade || bkStageName(c.stage), c.book, c.name].filter(Boolean).join(' · ');
}

/* ================================================================
   题目表单公共块（题库管理 / 课文习题 添加习题 共用）
   ================================================================ */
function bkFormBody(cur, opts = {}) {
  const bind = opts.bind !== false;    // 课文习题里添加时视频已定，不显示绑定行
  return `<div class="bk-form">
    <div class="bk-form-row">
      <div class="field"><label>学段</label><select id="qf-stage">
        <option value="">不限</option><option value="primary" ${cur.stage === 'primary' ? 'selected' : ''}>小学</option>
        <option value="junior" ${cur.stage === 'junior' ? 'selected' : ''}>初中</option></select></div>
      <div class="field"><label>学科</label><select id="qf-subject">${SUBJECTS.map((s) => `<option ${cur.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>年级</label><select id="qf-grade"><option value="">不限</option>${BK_GRADES.map((g) => `<option ${cur.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="field"><label>难度</label><select id="qf-difficulty">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${Number(cur.difficulty || 3) === d ? 'selected' : ''}>${'★'.repeat(d)}</option>`).join('')}</select></div>
      <div class="field" style="flex:1"><label>知识点（标签，可用于组卷筛选）</label><input id="qf-point" value="${esc(cur.point || '')}" placeholder="如：一元二次方程" list="qfPointList"><datalist id="qfPointList"></datalist></div>
    </div>
    <div class="field"><label>题干（填空题用 ____ 表示空；支持 LaTeX 公式，如 \(x^2+1\) 或 $x^2+1$）</label>
      <textarea id="qf-stem" class="input" rows="2" style="height:auto" placeholder="输入题目">${esc(cur.stem || '')}</textarea></div>
    <div class="bk-form-row" style="align-items:center">
      <button type="button" class="btn ghost sm" id="qfAiAttri">${ic('flash')} AI 归属建议</button>
      <span id="qfAiAttriTip" style="color:#8a94a6;font-size:12px">填好题干后点一下，AI 自动判断学段 / 年级 / 知识点 / 难度</span>
    </div>
    <div class="field"><label>题型</label><select id="qf-type">${BK_TYPES.map(([k, t]) => `<option value="${k}" ${(cur.type || 'single') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div id="qfTypeBody"></div>
    <div class="field"><label>原文材料（完形 / 阅读原文，选填）</label><textarea id="qf-material" class="input" rows="2" style="height:auto">${esc(cur.material || '')}</textarea></div>
    <div class="field"><label>解析（学生答错后展示，可空）</label><textarea id="qf-analysis" class="input" rows="3" style="height:auto">${esc(cur.analysis || '')}</textarea></div>
    <div class="bk-form-row">
      <div class="field" style="flex:1"><label>来源（如：本校卷 / 中考真题，可空）</label><input id="qf-source" value="${esc(cur.source || '')}"></div>
      <div class="field" style="width:120px"><label>年份（可空）</label><input id="qf-year" value="${esc(cur.year || '')}"></div>
    </div>
    ${bind ? `
    <div class="bk-form-row">
      <div class="field" style="flex:1"><label>绑定课本（可选，绑定后进学生端「做练习」）</label><select id="qf-chapter"><option value="">不绑定</option></select></div>
      <div class="field" style="flex:1"><label>绑定知识点视频</label><select id="qf-video" disabled><option value="">请先选课本</option></select></div>
    </div>` : '<input type="hidden" id="qf-video" value="">'}
  </div>`;
}

function bkFormMount(w, cur) {
  // AI 归属建议：按当前题干/选项问模型，自动回填 学段/年级/知识点/难度
  const aiBtn = w.querySelector('#qfAiAttri');
  if (aiBtn) aiBtn.onclick = async () => {
    const stem = w.querySelector('#qf-stem').value.trim();
    if (!stem) { toast('请先填写题干', 'err'); return; }
    aiBtn.disabled = true;
    const tip = w.querySelector('#qfAiAttriTip');
    if (tip) tip.textContent = 'AI 判断中，几秒钟…';
    try {
      const r = await api('/api/admin/bank/ai-attri', { method: 'POST', silent: true, body: {
        stem,
        subject: w.querySelector('#qf-subject').value,
        material: w.querySelector('#qf-material') ? w.querySelector('#qf-material').value.trim() : '',
        options: [...w.querySelectorAll('.bk-opt-in')].map((x) => x.value.trim()).filter(Boolean),
      } });
      if (r.stage) w.querySelector('#qf-stage').value = r.stage;
      if (r.grade) w.querySelector('#qf-grade').value = r.grade;
      if (r.point) w.querySelector('#qf-point').value = r.point;
      if (r.difficulty) w.querySelector('#qf-difficulty').value = String(r.difficulty);
      if (tip) tip.textContent = `AI 建议：${r.stage === 'primary' ? '小学' : '初中'}${r.grade || ''} · ${r.unit || ''} · ${r.point || ''} · 难度 ${'★'.repeat(r.difficulty || 3)}（${r.reason || ''}），已回填，请核对`;
      toast('AI 归属已回填，请核对后保存', 'ok');
    } catch (e) {
      if (tip) tip.textContent = 'AI 归属失败：' + (e.message || e);
    }
    aiBtn.disabled = false;
  };
  // 知识点候选
  api('/api/admin/bank/points', { silent: true }).then((pts) => {
    const dl = w.querySelector('#qfPointList');
    if (dl) dl.innerHTML = (pts || []).map((p) => `<option value="${esc(p)}">`).join('');
  }).catch(() => {});
  // 题型相关区域动态渲染
  const typeBody = w.querySelector('#qfTypeBody');
  let options = (cur.options || []).filter((s) => String(s || '') !== '');
  if (!options.length && (cur.type || 'single') !== 'fill') options = ['', '', '', ''];
  const renderType = () => {
    const t = w.querySelector('#qf-type').value;
    if (t === 'single' || t === 'multi') {
      const ans = String(cur.answer || '');
      typeBody.innerHTML = `
        <div class="field"><label>${t === 'multi' ? '选项（勾选 = 正确答案，可多选）' : '选项（点选正确答案）'}</label>
          <div class="bk-opts-edit">${options.map((o, i) => `
            <div class="bk-opt-row">
              <input type="${t === 'multi' ? 'checkbox' : 'radio'}" name="qfAns" value="${BK_LETTERS[i]}" ${ans.split(',').includes(BK_LETTERS[i]) ? 'checked' : ''} title="设为正确答案">
              <span class="bk-opt-l">${BK_LETTERS[i]}</span>
              <input class="input bk-opt-in" data-i="${i}" value="${esc(o)}" placeholder="选项 ${BK_LETTERS[i]}">
              <button type="button" class="link-btn danger" data-rm="${i}" ${options.length <= 2 ? 'disabled' : ''}>×</button>
            </div>`).join('')}
            ${options.length < 7 ? '<button type="button" class="btn ghost sm" id="qfAddOpt">+ 加一个选项</button>' : ''}
          </div></div>`;
      const add = w.querySelector('#qfAddOpt');
      if (add) add.onclick = () => { options.push(''); renderType(); };
      typeBody.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { options.splice(Number(b.dataset.rm), 1); renderType(); });
    } else if (t === 'judge') {
      typeBody.innerHTML = `<div class="field"><label>答案</label>
        <select id="qf-ans"><option value="正确" ${cur.answer === '错误' ? '' : 'selected'}>正确</option><option value="错误" ${cur.answer === '错误' ? 'selected' : ''}>错误</option></select></div>`;
    } else if (t === 'fill') {
      typeBody.innerHTML = `
        <div class="field"><label>答案（多个空用 | 分隔；一个空多个可接受答案用 ||| 分隔，如 is|||s）</label>
          <input id="qf-ans" value="${esc(cur.answer || '')}" placeholder="第1空|第2空|第3空"></div>
        <div class="w-tip">学生端会按 | 的数量生成对应的输入框；填空题不需要填选项。</div>`;
    } else if (t === 'sort') {
      typeBody.innerHTML = `
        <div class="field"><label>待排序的项（学生按正确顺序点选）</label>
          <div class="bk-opts-edit">${options.map((o, i) => `
            <div class="bk-opt-row"><span class="bk-opt-l">${i + 1}</span>
              <input class="input bk-opt-in" data-i="${i}" value="${esc(o)}" placeholder="第 ${i + 1} 项">
              <button type="button" class="link-btn danger" data-rm="${i}" ${options.length <= 2 ? 'disabled' : ''}>×</button></div>`).join('')}
            ${options.length < 7 ? '<button type="button" class="btn ghost sm" id="qfAddOpt">+ 加一项</button>' : ''}</div></div>
        <div class="field"><label>正确顺序（填位置序号，如 3,1,2,4；留空 = 按上面填写顺序）</label>
          <input id="qf-ans" value="${esc(cur.answer || '')}" placeholder="如 3,1,2,4"></div>`;
      const add = w.querySelector('#qfAddOpt');
      if (add) add.onclick = () => { options.push(''); renderType(); };
      typeBody.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { options.splice(Number(b.dataset.rm), 1); renderType(); });
    }
    typeBody.querySelectorAll('.bk-opt-in').forEach((inp) => inp.oninput = () => { options[Number(inp.dataset.i)] = inp.value; });
  };
  renderType();
  w.querySelector('#qf-type').onchange = () => { cur.answer = ''; options = options.length ? options : ['', '', '', '']; renderType(); };
  // 绑定课本 / 视频
  const chSel = w.querySelector('#qf-chapter'), vSel = w.querySelector('#qf-video');
  if (chSel && vSel) {
    const fillChapters = async () => {
      const subject = w.querySelector('#qf-subject').value;
      const rows = await api('/api/admin/bank/chapters?subject=' + encodeURIComponent(subject), { silent: true }).catch(() => []);
      chSel.innerHTML = '<option value="">不绑定</option>' + rows.map((c) => `<option value="${c.id}">${esc(bkChapterLabel(c))}</option>`).join('');
      if (cur.chapter_id) { chSel.value = String(cur.chapter_id); fillVideos(); }
    };
    const fillVideos = async () => {
      const cid = chSel.value;
      if (!cid) { vSel.disabled = true; vSel.innerHTML = '<option value="">不绑定</option>'; return; }
      vSel.disabled = false;
      vSel.innerHTML = '<option value="">加载中…</option>';
      const d = await api('/api/admin/bank/chapters/' + cid + '/lessons', { silent: true }).catch(() => null);
      const vs = (d && d.videos) || [];
      vSel.innerHTML = '<option value="">不绑定（仅放入题库）</option>' + vs.map((v) => `<option value="${v.id}">${esc(v.title)}（${v.question_count} 题）</option>`).join('');
      if (cur.video_id) vSel.value = String(cur.video_id);
    };
    w.querySelector('#qf-subject').onchange = fillChapters;
    chSel.onchange = fillVideos;
    fillChapters();
  }
}

/** 从表单读出题目 body；校验失败时调 err() 并返回 null */
function bkFormRead(w, err) {
  const t = w.querySelector('#qf-type').value;
  const options = [];
  w.querySelectorAll('.bk-opt-in').forEach((inp) => { options[Number(inp.dataset.i)] = inp.value; });
  const optClean = options.map((s) => String(s || '').trim()).filter((s) => s !== '');
  const stem = w.querySelector('#qf-stem').value.trim();
  let answer = '';
  if (t === 'single' || t === 'multi') {
    const checked = [...w.querySelectorAll('input[name="qfAns"]:checked')].map((c) => c.value);
    if (!stem) return err('请填写题干'), null;
    if (optClean.length < 2) return err('请至少填写 2 个选项'), null;
    if (!checked.length) return err('请勾选正确答案'), null;
    if (t === 'single' && checked.length > 1) return err('单选题只能有一个正确答案'), null;
    answer = checked.join(',');
  } else if (t === 'judge') {
    answer = w.querySelector('#qf-ans').value;
  } else if (t === 'fill') {
    answer = w.querySelector('#qf-ans').value.trim();
    if (!stem) return err('请填写题干'), null;
    if (!answer) return err('请填写每空的答案（多空用 | 分隔）'), null;
  } else if (t === 'sort') {
    if (!stem) return err('请填写题干'), null;
    if (optClean.length < 2) return err('请至少填写 2 个待排序项'), null;
    answer = w.querySelector('#qf-ans').value.trim();
  }
  return {
    type: t,
    stage: w.querySelector('#qf-stage').value,
    subject: w.querySelector('#qf-subject').value,
    grade: w.querySelector('#qf-grade').value,
    difficulty: Number(w.querySelector('#qf-difficulty').value) || 3,
    point: w.querySelector('#qf-point').value.trim(),
    stem,
    material: w.querySelector('#qf-material') ? w.querySelector('#qf-material').value.trim() : '',
    options: optClean,
    answer,
    analysis: w.querySelector('#qf-analysis').value.trim(),
    source: w.querySelector('#qf-source').value.trim(),
    year: w.querySelector('#qf-year').value.trim(),
    /* 课本绑定：不随编辑丢失（服务端选了视频时以视频所属课本为准） */
    chapter_id: ((w.querySelector('#qf-chapter') || {}).value || '') || null,
    video_id: w.querySelector('#qf-video').value || null,
  };
}

/* ================================================================
   ① 题库管理
   ================================================================ */
async function viewBank() {
  await loadMeta();
  const st = ADM.page.bk = ADM.page.bk || { stage: '', subject: '', grade: '', point: '', type: '', difficulty: '', video: '', kw: '' };
  const page = Math.max(1, Number(ADM.page.bkPage) || 1);
  const size = Math.max(1, Number(ADM.page.bkPageSize) || 10);
  const qs = Object.entries(st).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = await api(`/api/admin/bank/questions?page=${page}&size=${size}${qs ? '&' + qs : ''}`);
  ADM.page.bkPage = data.page; ADM.page.bkPageSize = data.size;
  /* 删题后停在超出的空页时自动回退到最后一页 */
  const bkPages = Math.max(1, Math.ceil((data.total || 0) / (data.size || size)));
  if (data.total > 0 && page > bkPages) { ADM.page.bkPage = bkPages; return viewBank(); }

  const html = `
  <div class="card">
    <div class="bk-mods">
      <button class="bk-mod" data-mod="mfc"><span class="bm-ico">${ic('link')}</span><span class="bm-tt">网络采集<em>组卷网等题库一键采集</em></span></button>
      <button class="bk-mod" data-mod="mfi"><span class="bm-ico">${ic('upload')}</span><span class="bm-tt">录题上传<em>Word / 图片批量录题</em></span></button>
      <button class="bk-mod" data-mod="bkfb"><span class="bm-ico">${ic('chat')}</span><span class="bm-tt">错题反馈<em>学生反馈的题目核对</em><i class="bm-badge" id="bkFbBadge" style="display:none"></i></span></button>
    </div>
    <div class="card-h"><h3>${ic('doc')} 智能题库 · 题库管理</h3>
      <div class="card-h-r">
        <button class="btn ghost" id="bkKTree">${ic('list')} 知识点树</button>
        <button class="btn ghost" id="bkTpl">${ic('download')} 下载导入模板</button>
        <button class="btn ghost" id="bkImport">${ic('upload')} 导入 Excel</button>
        <button class="btn primary" id="bkAdd">${ic('plus')} 新增题目</button>
      </div>
    </div>
    <div class="bk-filters">
      <select id="bkf-stage"><option value="">全部学段</option><option value="primary" ${st.stage === 'primary' ? 'selected' : ''}>小学</option><option value="junior" ${st.stage === 'junior' ? 'selected' : ''}>初中</option></select>
      <select id="bkf-subject"><option value="">全部学科</option>${SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="bkf-grade"><option value="">全部年级</option>${BK_GRADES.map((g) => `<option ${st.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <input id="bkf-point" value="${esc(st.point)}" placeholder="按知识点筛选" style="width:130px" list="bkPointList">
      <datalist id="bkPointList"></datalist>
      <select id="bkf-type"><option value="">全部题型</option>${BK_TYPES.map(([k, t]) => `<option value="${k}" ${st.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="bkf-difficulty"><option value="">全部难度</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${String(st.difficulty) === String(d) ? 'selected' : ''}>${'★'.repeat(d)}</option>`).join('')}</select>
      <select id="bkf-video"><option value="">全部题目</option><option value="bound" ${st.video === 'bound' ? 'selected' : ''}>已绑定课文视频</option><option value="none" ${st.video === 'none' ? 'selected' : ''}>未绑定（纯题库）</option></select>
      <input id="bkf-kw" value="${esc(st.kw)}" placeholder="搜索题干 / 知识点" style="width:180px">
      <button class="btn ghost" id="bkfGo">${ic('search')} 筛选</button>
    </div>
    <div class="bk-count">共 <b>${data.total}</b> 道题</div>
    ${data.list.length ? `<table><thead><tr>
      <th style="width:34%">题目</th><th>编号</th><th>题型</th><th>难度</th><th>定位</th><th>知识点</th><th>绑定视频</th><th style="width:150px">操作</th></tr></thead><tbody>
      ${data.list.map((q) => `<tr data-id="${q.id}">
        <td class="bk-stem" title="${esc(q.stem)}">${q.material ? `<span class="tag gray">复合</span> ` : ''}${esc(bkTrunc(q.stem, 46))}</td>
        <td><span class="bk-qno">#${String(q.id).padStart(5, '0')}</span></td>
        <td><span class="tag">${BK_QTNAME[q.type] || q.type}</span></td>
        <td class="bk-diff">${bkDiffName(q.difficulty)}</td>
        <td class="bk-pos">${esc([bkStageName(q.stage), q.grade].filter(Boolean).join('·') || q.subject || '—')}</td>
        <td>${q.point ? `<span class="tag blue">${esc(q.point)}</span>` : '<span style="color:#c0c9d8">—</span>'}</td>
        <td>${q.video_title ? `<span class="tag ok" title="${esc(q.video_title)}">${esc(bkTrunc(q.video_title, 12))}</span>` : '<span style="color:#c0c9d8">未绑定</span>'}</td>
        <td class="bk-ops">
          <button class="link-btn" data-edit="${q.id}">编辑</button>
          <button class="link-btn" data-bind="${q.id}">${q.video_id ? '换绑' : '绑视频'}</button>
          <button class="link-btn danger" data-del="${q.id}">删除</button>
        </td>
      </tr>`).join('')}</tbody></table>
    ${pagerHTML(data.page, data.size, data.total, 'bkPage')}` : '<div class="empty">题库还是空的，点右上角「新增题目」或「导入 Excel」开始建库</div>'}
  </div>`;

  return {
    html,
    after: () => {
      bindPager('bkPage');
      /* 顶部模块入口：网络采集 / 录题上传 / 错题反馈（集合进题库管理） */
      document.querySelectorAll('.bk-mod[data-mod]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.mod; });
      api('/api/admin/bank/feedback?status=pending&size=1', { silent: true })
        .then((d) => {
          const n = (d && d.total) || 0;
          const el = document.getElementById('bkFbBadge');
          if (el && n > 0) { el.textContent = n > 99 ? '99+' : n; el.style.display = ''; }
        }).catch(() => {});
      api(`/api/admin/bank/points${st.subject ? '?subject=' + encodeURIComponent(st.subject) : ''}`, { silent: true })
        .then((pts) => { document.getElementById('bkPointList').innerHTML = (pts || []).map((p) => `<option value="${esc(p)}">`).join(''); })
        .catch(() => {});
      const readSt = () => {
        st.stage = document.getElementById('bkf-stage').value;
        st.subject = document.getElementById('bkf-subject').value;
        st.grade = document.getElementById('bkf-grade').value;
        st.point = document.getElementById('bkf-point').value.trim();
        st.type = document.getElementById('bkf-type').value;
        st.difficulty = document.getElementById('bkf-difficulty').value;
        st.video = document.getElementById('bkf-video').value;
        st.kw = document.getElementById('bkf-kw').value.trim();
      };
      const go = () => { readSt(); ADM.page.bkPage = 1; render(); };
      document.getElementById('bkfGo').onclick = go;
      ['bkf-stage', 'bkf-subject', 'bkf-grade', 'bkf-type', 'bkf-difficulty', 'bkf-video'].forEach((id) => {
        document.getElementById(id).onchange = go;
      });
      document.getElementById('bkf-kw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      document.getElementById('bkAdd').onclick = () => bkQuestionForm(null);
      document.getElementById('bkKTree').onclick = () => { location.hash = '#/ktree'; };   // T4：旧弹窗已并入「知识树管理」页
      document.getElementById('bkTpl').onclick = async () => {
        /* 该接口需要登录票据，window.open 带不上 Authorization，改用 fetch 取流下载 */
        try {
          const r = await fetch('/api/admin/bank/questions/template' + (st.subject ? '?subject=' + encodeURIComponent(st.subject) : ''),
            { headers: { Authorization: 'Bearer ' + Auth.token } });
          if (!r.ok) throw new Error('下载失败（' + r.status + '），请重新登录后重试');
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '智能题库导入模板.xlsx';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        } catch (e) { toast(e.message || '模板下载失败', 'err'); }
      };
      document.getElementById('bkImport').onclick = () => bkImportForm();
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
        const q = data.list.find((x) => String(x.id) === b.dataset.edit);
        if (q) bkQuestionForm(q);
      });
      document.querySelectorAll('[data-bind]').forEach((b) => b.onclick = () => {
        bkBindForm([Number(b.dataset.bind)]);
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await elConfirm({ title: '删除题目', message: '删除后学生的练习与错题记录里也会移除这道题。确定删除？', okText: '删除', danger: true }))) return;
        try { await api('/api/admin/bank/questions/' + b.dataset.del, { method: 'DELETE' }); toast('已删除', 'ok'); render(); }
        catch (e) { /* api 已提示 */ }
      });
    },
  };
}

/** 新增 / 编辑题目弹窗 */
function bkQuestionForm(q) {
  const isEdit = !!q;
  const cur = q || { type: 'single', difficulty: 3 };
  modal({
    title: isEdit ? `编辑题目 #${q.id}` : '新增题目',
    wide: true,
    okText: isEdit ? '保存' : '添加',
    body: bkFormBody(cur),
    onMount: (w, err) => bkFormMount(w, cur),
    onOk: async (w, err) => {
      const body = bkFormRead(w, err);
      if (!body) return false;
      if (isEdit) await api('/api/admin/bank/questions/' + q.id, { method: 'PUT', body, silent: true });
      else await api('/api/admin/bank/questions', { method: 'POST', body, silent: true });
      toast(isEdit ? '已保存' : '题目已加入题库', 'ok');
      render();
    },
  });
}

/** 绑定 / 解绑题目到知识点视频 */
function bkBindForm(questionIds) {
  modal({
    title: `绑定到知识点视频（${questionIds.length} 道题）`,
    okText: '确定',
    body: `
      <div class="field"><label>学科</label><select id="bf-subject">${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>课本（课程目录）</label><select id="bf-chapter"><option value="">请先选学科</option></select></div>
      <div class="field"><label>知识点视频</label><select id="bf-video" disabled><option value="">请先选课本</option></select></div>
      <label class="w-chk"><input type="checkbox" id="bf-unbind"> 解绑（把题目从知识点上取下来，保留在题库）</label>`,
    onMount: (w) => {
      const sSel = w.querySelector('#bf-subject'), cSel = w.querySelector('#bf-chapter'), vSel = w.querySelector('#bf-video');
      const fillChapters = async () => {
        const rows = await api('/api/admin/bank/chapters?subject=' + encodeURIComponent(sSel.value), { silent: true }).catch(() => []);
        cSel.innerHTML = '<option value="">请选择课本</option>' + rows.map((c) => `<option value="${c.id}">${esc(bkChapterLabel(c))}</option>`).join('');
      };
      sSel.onchange = fillChapters;
      cSel.onchange = async () => {
        if (!cSel.value) { vSel.disabled = true; vSel.innerHTML = '<option value="">请先选课本</option>'; return; }
        vSel.disabled = false;
        const d = await api('/api/admin/bank/chapters/' + cSel.value + '/lessons', { silent: true }).catch(() => null);
        vSel.innerHTML = '<option value="">请选择知识点</option>' + ((d && d.videos) || []).map((v) => `<option value="${v.id}">${esc(v.title)}（${v.question_count} 题）</option>`).join('');
      };
      fillChapters();
    },
    onOk: async (w, err) => {
      const unbind = w.querySelector('#bf-unbind').checked;
      if (!unbind && !w.querySelector('#bf-video').value) return err('请选择知识点视频，或勾选「解绑」');
      if (unbind) {
        await api('/api/admin/bank/videos/0/bind', { method: 'POST', silent: true, body: { ids: questionIds, unbind: 1 } });
      } else {
        await api('/api/admin/bank/videos/' + w.querySelector('#bf-video').value + '/bind', { method: 'POST', silent: true, body: { ids: questionIds } });
      }
      toast(unbind ? '已解绑' : '已绑定到知识点', 'ok');
      render();
    },
  });
}

/** Excel 导入弹窗 */
function bkImportForm() {
  modal({
    title: '批量导入题目',
    okText: '开始导入',
    body: `
      <div class="w-tip" style="margin-bottom:12px">
        <b>三种用法，越填越省事：</b><br>
        ① <b>整卷导入</b>——按模板填好 9 个 Sheet（单选 / 多选 / 判断 / 组合 / 填空 / 排序 / 完形填空 / 选择填空 / 阅读理解），一键盘录入百来道题；<br>
        ② <b>省事填法</b>——表里的学段 / 学科 / 年级 / 知识点列可以留空，下面选好「默认值」自动补上；<br>
        ③ <b>先试后导</b>——第一次用建议先在模板里填 3~5 道题试导，确认格式没问题再整表导入。<br>
        没有模板？先点列表上方的「下载导入模板」。
      </div>
      <div class="bk-form-row">
        <div class="field"><label>默认学段（表里没填的用这个）</label>
          <select id="im-stage"><option value="">不限</option><option value="primary">小学</option><option value="junior">初中</option></select></div>
        <div class="field"><label>默认学科</label>
          <select id="im-subject"><option value="">不限</option>${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>默认年级</label>
          <select id="im-grade"><option value="">不限</option>${BK_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>默认知识点（可选）</label>
          <input id="im-point" placeholder="如：一次函数，整批题共用"></div>
      </div>
      <div class="field"><label>Excel 文件（.xlsx）</label><input type="file" id="im-file" accept=".xlsx,.xls" class="input" style="padding:8px"></div>
      <div id="imResult" class="hide" style="margin-top:10px"></div>`,
    onOk: async (w, err) => {
      const file = w.querySelector('#im-file').files[0];
      if (!file) return err('请选择 Excel 文件');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('stage', w.querySelector('#im-stage').value);
      fd.append('subject', w.querySelector('#im-subject').value);
      fd.append('grade', w.querySelector('#im-grade').value);
      fd.append('point', w.querySelector('#im-point').value.trim());
      const headers = { Authorization: 'Bearer ' + Auth.token };
      const res = await fetch('/api/admin/bank/questions/import', { method: 'POST', headers, body: fd });
      const json = await res.json().catch(() => ({ code: 500, msg: '服务器返回异常' }));
      if (json.code !== 0) return err(json.msg || '导入失败');
      const box = w.querySelector('#imResult');
      const errs = json.data.errors || [];
      box.classList.remove('hide');
      box.innerHTML = `
        <div class="im-ok">✅ 成功导入 <b>${json.data.imported}</b> 道题${errs.length ? `，<b style="color:#e5484d">${errs.length}</b> 条未通过` : '，全部通过'}</div>
        ${errs.length ? `<div class="im-errs"><b>未通过的原因（改好后可只把这些行重新导一次）：</b>
          <ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}`;
      toast(`成功导入 ${json.data.imported} 道题`, 'ok');
      setTimeout(() => { render(); }, 800);
      return false;   // 不关弹窗，让老师看到导入结果
    },
  });
}

/* ================================================================
   ② 智能组卷
   ================================================================ */
/** 下发试卷给学生：单选 / 多选，确认后出现在这些学生的「试卷 → 我的任务」，只有被选中的学生能看到 */
async function ppAssignDialog(pid, title) {
  const students = await api('/api/admin/bank/students-options', { silent: true }).catch(() => []);
  if (!students.length) return toast('还没有学生账号，先去组织管理 → 学生管理开通', 'err');
  let assigned = [];
  try { assigned = (await api(`/api/admin/bank/papers/${pid}/assignees`, { silent: true })).map((r) => r.user_id); } catch (e) { assigned = []; }
  let kw = '';
  const paint = (w) => {
    const shown = students.filter((s) => !kw || (s.name || '').includes(kw) || (s.username || '').includes(kw) || (s.grade || '').includes(kw));
    w.querySelector('#asList').innerHTML = shown.map((s) => `<label class="mf-pickitem"><input type="checkbox" class="as-uid" value="${s.id}" ${assigned.includes(s.id) ? 'checked' : ''}><span>${esc(s.name || s.username)} <i class="hint">${esc([s.grade, s.stage === 'primary' ? '小学' : s.stage === 'junior' ? '初中' : ''].filter(Boolean).join('·'))}</i></span></label>`).join('') || '<span class="hint">没有符合的学生</span>';
  };
  const countSel = (w) => { w.querySelector('#asCount').textContent = w.querySelectorAll('.as-uid:checked').length; };
  modal({
    title: `下发试卷 · ${title || ''}`, wide: true, okText: '确认下发',
    body: `<div class="row" style="gap:8px;margin-bottom:8px">
        <input id="asKw" class="inp" placeholder="搜姓名 / 年级" style="flex:1">
        <span>已选 <b id="asCount">0</b> 人</span>
        <label class="hint" style="cursor:pointer"><input type="checkbox" id="asAll"> 全选</label></div>
      <div id="asList" class="mf-pick" style="max-height:340px"></div>
      <div class="hint" style="margin-top:6px">下发的试卷出现在学生端「试卷 → 我的任务」，<b>只有勾选的学生能看到</b>（可单选 / 多选）。</div>`,
    onMount: (w) => {
      paint(w); countSel(w);
      w.querySelector('#asKw').oninput = (e) => { kw = e.target.value.trim(); paint(w); };
      w.addEventListener('change', () => countSel(w));
      w.querySelector('#asAll').onchange = (e) => { w.querySelectorAll('.as-uid').forEach((c) => { c.checked = e.target.checked; }); countSel(w); };
    },
    onOk: async (w) => {
      const ids = [...w.querySelectorAll('.as-uid:checked')].map((c) => Number(c.value));
      if (!ids.length) { toast('请至少选择一名学生', 'err'); return false; }
      await api(`/api/admin/bank/papers/${pid}/assign`, { method: 'POST', body: { user_ids: ids } });
      toast(`已下发给 ${ids.length} 名学生，他们的「我的任务」里可见`, 'ok'); render();
    },
  });
}

async function viewPaper() {
  const st = ADM.page.pp = ADM.page.pp || { subject: '' };
  const papers = await api('/api/admin/bank/papers' + (st.subject ? '?subject=' + encodeURIComponent(st.subject) : ''));

  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('doc')} 智能组卷 · 新建试卷</h3></div>
    <div class="pp-form">
      <div class="pp-row">
        <div class="field" style="flex:2"><label>试卷标题</label><input id="pp-title" placeholder="如：八年级上学期期中数学卷"></div>
        <div class="field"><label>学科</label><select id="pp-subject">${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="pp-stage"><option value="">不限</option><option value="primary">小学</option><option value="junior">初中</option></select></div>
        <div class="field"><label>年级</label><select id="pp-grade"><option value="">不限</option>${BK_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
        <div class="field"><label>册别</label><select id="pp-term"><option value="">不限</option><option>上册</option><option>下册</option></select></div>
      </div>
      <div class="pp-row t5-scope">
        <div class="field"><label>组卷范围</label>
          <select id="pp-scope"><option value="">不限（可用下面的知识点文字筛选）</option><option value="textbook">按章节选题</option><option value="knowledge">按知识点选题</option></select></div>
        <div class="field" id="pp-treewrap" style="flex:3;display:none">
          <label>选择节点<span class="hint" style="font-weight:400;margin-left:6px">选中的节点包含它下面所有子节点；可多选</span></label>
          <div class="t5-treebar"><select id="pp-tree"></select><span class="hint" id="pp-selinfo"></span><button type="button" class="link-btn" id="pp-clearsel">清空选择</button></div>
          <div class="t5-tree" id="pp-treebox"></div>
        </div>
      </div>
      <div class="pp-row">
        <div class="field" style="flex:1.4"><label>知识点文字（可空 = 全部，可用 && 连接多个；和上面的范围同时生效）</label><input id="pp-point" placeholder="如：一次函数" list="ppPointList"><datalist id="ppPointList"></datalist></div>
        <div class="field"><label>难度</label><select id="pp-difficulty"><option value="">不限</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}">${'★'.repeat(d)}</option>`).join('')}</select></div>
        <div class="field" style="width:90px"><label>建议时长</label><input id="pp-duration" type="number" value="90" min="10" max="180"></div>
        <div class="field" style="width:90px"><label>满分</label><input id="pp-score" type="number" value="100" min="10" max="1000"></div>
      </div>
      <div class="pp-row">
        ${BK_TYPES.map(([k, t]) => `<div class="field pp-n"><label>${t}</label><input id="pp-n-${k}" type="number" min="0" max="50" value="0"></div>`).join('')}
        <div class="field pp-n" style="align-self:flex-end"><button class="btn primary" id="ppGo" style="white-space:nowrap">${ic('flash')} 一键组卷</button></div>
      </div>
      <div class="t5-pool" id="ppPool"></div>
      <div class="w-tip">组卷说明：按上面的条件从题库随机抽题；题库某题型数量不够时会在预览里提示。抽完可以在预览里移除题目，再保存或下发。学生的「试卷」页面会按年级 / 学段自动匹配能看到哪些卷子。</div>
    </div>
    <div id="ppPreview"></div>
  </div>
  <div class="card">
    <div class="card-h"><h3>${ic('list')} 已有试卷</h3>
      <select id="pp-filter-subject" style="min-width:110px"><option value="">全部学科</option>${SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    ${papers.length ? `<table><thead><tr><th style="width:34%">试卷</th><th>学科</th><th>定位</th><th>题数</th><th>状态</th><th>已做人数</th><th style="width:250px">操作</th></tr></thead><tbody>
      ${papers.map((p) => `<tr>
        <td><b>${esc(p.title)}</b><div class="bk-pos">${esc(String(p.created_at || '').slice(0, 16))}</div></td>
        <td>${esc(p.subject || '—')}</td>
        <td class="bk-pos">${esc([bkStageName(p.stage), p.grade, p.term].filter(Boolean).join('·') || '不限')}</td>
        <td>${p.q_count}</td>
        <td>${p.status === 'published' ? `<span class="tag ok">已下发</span>${p.assign_count ? `<span class="tag gray">定向 ${p.assign_count} 人</span>` : ''}` : '<span class="tag gray">草稿</span>'}</td>
        <td>${p.done_count || 0}</td>
        <td class="bk-ops">
          <button class="link-btn" data-prev="${p.id}">预览</button>
          ${p.status === 'published'
            ? `<button class="link-btn" data-unpub="${p.id}">撤回</button>`
            : `<button class="link-btn" data-pub="${p.id}">下发</button>`}
          <button class="link-btn" data-edit="${p.id}">编辑</button>
          <button class="link-btn danger" data-del="${p.id}">删除</button>
        </td></tr>`).join('')}</tbody></table>` : '<div class="empty">还没有试卷，用上面的「一键组卷」创建第一份</div>'}
  </div>`;

  return {
    html,
    after: () => {
      let picked = [];   // 组卷方案里的题目
      const sc = { kind: '', tree: null, nodes: [], sel: new Set(), open: new Set() };   // 树范围：章节树 / 知识点树
      api('/api/admin/bank/points', { silent: true }).then((pts) => {
        document.getElementById('ppPointList').innerHTML = (pts || []).map((p) => `<option value="${esc(p)}">`).join('');
      }).catch(() => {});
      const previewEl = document.getElementById('ppPreview');
      const readForm = () => ({
        title: document.getElementById('pp-title').value.trim(),
        subject: document.getElementById('pp-subject').value,
        stage: document.getElementById('pp-stage').value,
        grade: document.getElementById('pp-grade').value,
        term: document.getElementById('pp-term').value,
        point: document.getElementById('pp-point').value.trim(),
        difficulty: document.getElementById('pp-difficulty').value,
        duration: Number(document.getElementById('pp-duration').value) || 90,
        total_score: Number(document.getElementById('pp-score').value) || 100,
        node_ids: [...sc.sel],
      });
      // ---- 组卷范围：章节树 / 知识点树里勾选节点（含全部子节点）；下方实时显示范围内各题型有多少题 ----
      const treeBox = document.getElementById('pp-treebox');
      const selInfo = document.getElementById('pp-selinfo');
      const subCnt = {};
      const paintTree = () => {
        const kids = {};
        sc.nodes.forEach((n) => { (kids[n.parent_id || 0] = kids[n.parent_id || 0] || []).push(n); });
        Object.values(kids).forEach((a) => a.sort((x, y) => (x.sort - y.sort) || (x.id - y.id)));
        const cnt = (n) => { let c = n.qcount || 0; (kids[n.id] || []).forEach((k) => { c += cnt(k); }); subCnt[n.id] = c; return c; };
        (kids[0] || []).forEach(cnt);
        const row = (n, d) => {
          const ks = kids[n.id] || []; const open = sc.open.has(n.id);
          return `<div class="t5-node"><div class="t5-row" style="padding-left:${6 + d * 18}px">
            <span class="t5-tog ${ks.length ? '' : 'leaf'}" data-tog="${n.id}">${ks.length ? (open ? '▾' : '▸') : '·'}</span>
            <label><input type="checkbox" data-nid="${n.id}" ${sc.sel.has(n.id) ? 'checked' : ''}> ${esc(n.name)}</label>
            ${subCnt[n.id] ? `<span class="t5-cnt" title="这个节点（含子节点）上挂的题目数">${subCnt[n.id]} 题</span>` : ''}</div>
            ${ks.length && open ? ks.map((k) => row(k, d + 1)).join('') : ''}</div>`;
        };
        treeBox.innerHTML = (kids[0] || []).map((r) => row(r, 0)).join('') || '<div class="hint" style="padding:10px">没有可选的树节点</div>';
        selInfo.textContent = sc.sel.size ? `已选 ${sc.sel.size} 个节点` : '未选择（= 不限制节点）';
      };
      let poolSeq = 0, poolTimer = 0;
      const refreshPool = () => {
        clearTimeout(poolTimer);
        poolTimer = setTimeout(async () => {
          const my = ++poolSeq; const el = document.getElementById('ppPool'); if (!el) return;
          try {
            const r = await api('/api/admin/bank/papers/pool', { method: 'POST', silent: true, body: readForm() });
            if (my !== poolSeq) return;
            el.innerHTML = r.total ? `题库里符合上面条件的题：<b>${r.total}</b> 道（${BK_TYPES.map(([k, t]) => `${t.replace('题', '')} ${r[k] || 0}`).join(' · ')}）` : '题库里没有符合上面条件的题，请调整范围，或先去题库管理 / 待审核题目录入';
          } catch (e) { el.textContent = ''; }
        }, 250);
      };
      const loadNodes = async () => {
        sc.sel.clear(); sc.open.clear(); sc.nodes = [];
        if (sc.tree) {
          sc.nodes = ((await api(`/api/admin/bank/mf/trees/${sc.tree.id}/nodes`, { silent: true }).catch(() => ({ list: [] }))) || {}).list || [];
          sc.nodes.filter((n) => !n.parent_id).forEach((n) => sc.open.add(n.id));
        }
        paintTree(); refreshPool();
      };
      const loadScope = async () => {
        sc.kind = document.getElementById('pp-scope').value;
        const wrap = document.getElementById('pp-treewrap');
        if (!sc.kind) { wrap.style.display = 'none'; sc.sel.clear(); sc.tree = null; sc.nodes = []; refreshPool(); return; }
        wrap.style.display = '';
        const f = readForm();
        const all = (((await api('/api/admin/bank/mf/trees?kind=' + sc.kind, { silent: true }).catch(() => ({ list: [] }))) || {}).list || []);
        sc.trees = all.filter((t) => t.subject === f.subject && (!f.stage || t.stage === f.stage));
        document.getElementById('pp-tree').innerHTML = sc.trees.map((t) => `<option value="${t.id}">${esc(t.name)}${t.stage ? '（' + esc(bkStageName(t.stage)) + '）' : ''}</option>`).join('') || '<option value="">没有符合学科 / 学段的树</option>';
        sc.tree = sc.trees[0] || null;
        await loadNodes();
      };
      document.getElementById('pp-scope').onchange = loadScope;
      ['pp-subject', 'pp-stage'].forEach((id) => { document.getElementById(id).addEventListener('change', loadScope); });
      ['pp-grade', 'pp-difficulty'].forEach((id) => { document.getElementById(id).addEventListener('change', refreshPool); });
      document.getElementById('pp-point').addEventListener('input', refreshPool);
      document.getElementById('pp-tree').onchange = (e) => { sc.tree = (sc.trees || []).find((t) => String(t.id) === e.target.value) || null; loadNodes(); };
      document.getElementById('pp-clearsel').onclick = () => { sc.sel.clear(); paintTree(); refreshPool(); };
      treeBox.onclick = (e) => { const tg = e.target.closest('[data-tog]'); if (!tg) return; const id = Number(tg.dataset.tog); if (sc.open.has(id)) sc.open.delete(id); else sc.open.add(id); paintTree(); };
      treeBox.onchange = (e) => {
        const cb = e.target.closest('[data-nid]'); if (!cb) return;
        const id = Number(cb.dataset.nid); if (cb.checked) sc.sel.add(id); else sc.sel.delete(id);
        selInfo.textContent = sc.sel.size ? `已选 ${sc.sel.size} 个节点` : '未选择（= 不限制节点）';
        refreshPool();
      };
      refreshPool();
      const paintPreview = (missing) => {
        if (!picked.length) { previewEl.innerHTML = ''; return; }
        const f = readForm();
        const groups = BK_TYPES.map(([k, t]) => [k, t, picked.filter((q) => q.type === k)]);
        const per = Math.max(1, Math.round(f.total_score / picked.length));
        previewEl.innerHTML = `
          <div class="pp-prev-h"><b>组卷方案预览</b><span>共 ${picked.length} 题，每题约 ${per} 分${missing && missing.length ? ` · <em style="color:#e5484d">${esc(missing.join('、'))}</em>` : ''}</span>
            <div class="pp-prev-acts">
              <button class="btn ghost" id="ppSaveDraft" style="white-space:nowrap">保存草稿</button>
              <button class="btn primary" id="ppSaveAssign">保存并下发给指定学生…</button>
              <button class="btn ghost" id="ppSavePub" style="white-space:nowrap" title="不指定学生：按试卷的年级 / 学段 / 册别，所有符合的学生都能在「我的任务」看到">保存并下发给全部符合年级的学生</button>
            </div></div>
          ${groups.filter(([, , arr]) => arr.length).map(([k, t, arr], gi) => `
            <div class="pp-group"><div class="pp-gt">${['一', '二', '三', '四', '五'][gi] || gi + 1}、${t}</div>
            ${arr.map((q, qi) => `<div class="pp-q">
              <div class="pp-q-main">${q.material ? `<div class="pp-mat">【原文】${esc(bkTrunc(q.material, 80))}</div>` : ''}<b>${qi + 1}.</b> ${esc(bkTrunc(q.stem, 100))}
                ${q.point ? `<span class="tag gray" style="margin-left:6px">${esc(q.point)}</span>` : ''}</div>
              <button class="link-btn danger" data-rm="${q.id}">移除</button></div>`).join('')}</div>`).join('')}`;
        previewEl.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
          picked = picked.filter((q) => String(q.id) !== b.dataset.rm);
          paintPreview([]);
        });
        if (window.mtxTypeset) mtxTypeset(previewEl);
        const save = async (publish) => {
          const ff = readForm();
          if (!ff.title) { toast('请先填写试卷标题', 'err'); return null; }
          const body = { ...ff, q_ids: picked.map((q) => q.id), status: publish ? 'published' : 'draft' };
          delete body.node_ids;   // 范围只用来抽题，不存进试卷
          const r = await api('/api/admin/bank/papers', { method: 'POST', silent: true, body });
          return r;
        };
        previewEl.querySelector('#ppSaveDraft').onclick = async () => { if (await save(false)) { toast('草稿已保存', 'ok'); picked = []; render(); } };
        previewEl.querySelector('#ppSavePub').onclick = async () => { if (await save(true)) { toast('试卷已下发到学生端（所有符合年级的学生）', 'ok'); picked = []; render(); } };
        // 先存成草稿，再选学生下发；取消选学生时试卷留在草稿里
        previewEl.querySelector('#ppSaveAssign').onclick = async () => {
          const r = await save(false);
          if (!r) return;
          const title = readForm().title;
          picked = [];
          ppAssignDialog(r.id, title);
        };
      };
      document.getElementById('ppGo').onclick = async () => {
        const f = readForm();
        const counts = {};
        BK_TYPES.forEach(([k]) => { counts[k] = Number(document.getElementById('pp-n-' + k).value) || 0; });
        if (!Object.values(counts).some((n) => n > 0)) { toast('请至少填写一种题型的数量', 'err'); return; }
        const btn = document.getElementById('ppGo');
        btn.disabled = true; btn.textContent = '抽题中…';
        try {
          const r = await api('/api/admin/bank/papers/auto', { method: 'POST', silent: true, body: { ...f, counts } });
          picked = r.list || [];
          paintPreview(r.missing || []);
          if (!picked.length) toast('题库里没有符合条件的题目，请调整条件或先去题库管理录题', 'err');
        } catch (e) { /* api 已提示 */ }
        btn.disabled = false; btn.innerHTML = ic('flash') + ' 一键组卷';
      };
      document.getElementById('pp-filter-subject').onchange = (e) => { st.subject = e.target.value; render(); };
      document.querySelectorAll('[data-prev]').forEach((b) => b.onclick = async () => {
        const p = await api('/api/admin/bank/papers/' + b.dataset.prev);
        bkPaperPreview(p);
      });
      document.querySelectorAll('[data-pub]').forEach((b) => b.onclick = () => {
        const pid = Number(b.dataset.pub);
        ppAssignDialog(pid, (papers.find((x) => x.id === pid) || {}).title || '');
      });
      document.querySelectorAll('[data-unpub]').forEach((b) => b.onclick = async () => {
        await api(`/api/admin/bank/papers/${b.dataset.unpub}/publish`, { method: 'POST', body: { publish: 0 } });
        toast('已撤回', 'ok'); render();
      });
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
        const p = await api('/api/admin/bank/papers/' + b.dataset.edit);
        bkPaperEdit(p);
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await elConfirm({ title: '删除试卷', message: '删除后学生的作答记录也会一并删除。确定？', okText: '删除', danger: true }))) return;
        await api('/api/admin/bank/papers/' + b.dataset.del, { method: 'DELETE' });
        toast('已删除', 'ok'); render();
      });
    },
  };
}

/** 试卷预览弹窗（含答案解析切换 + 打印） */
function bkPaperPreview(p) {
  const paint = (showAns) => {
    const groups = BK_TYPES.map(([k, t]) => [k, t, p.questions.filter((q) => q.type === k)]);
    return `
      <div class="pp-print">
        <h2 style="text-align:center;margin-bottom:4px">${esc(p.title)}</h2>
        <p style="text-align:center;color:#667;margin-bottom:14px;font-size:12px">
          ${[p.subject, bkStageName(p.stage), p.grade, p.term].filter(Boolean).join(' · ')} ｜ 共 ${p.questions.length} 题 ｜ 满分 ${p.total_score} 分 ｜ 建议 ${p.duration} 分钟</p>
        ${groups.filter(([, , arr]) => arr.length).map(([k, t, arr], gi) => `
          <div style="font-weight:700;margin:12px 0 6px">${['一', '二', '三', '四', '五'][gi] || gi + 1}、${t}</div>
          ${arr.map((q, qi) => `<div style="margin:10px 0;line-height:1.8">
            ${q.material ? `<div style="background:#f6f9ff;border:1px solid #e3ecff;border-radius:8px;padding:8px 12px;margin-bottom:6px;white-space:pre-wrap;font-size:12.5px;color:#445">${esc(q.material)}</div>` : ''}
            <b>${qi + 1}.</b> ${esc(q.stem)}
            ${(q.options || []).length && q.type !== 'sort' ? `<div style="padding-left:22px;color:#333">${q.options.map((o, i) => `<div>${BK_LETTERS[i]}. ${esc(o)}</div>`).join('')}</div>` : ''}
            ${q.type === 'fill' || q.type === 'sort' ? '<div style="height:44px;border-bottom:1px dashed #ccc"></div>' : ''}
            ${showAns ? `<div style="padding-left:22px;font-size:12.5px"><b style="color:#12b76a">答案：</b>${esc(bkAnswerText(q))}${q.analysis ? ` <b style="color:#2f6bff">解析：</b>${esc(q.analysis)}` : ''}</div>` : ''}
          </div>`).join('')}`).join('')}
      </div>`;
  };
  modal({
    title: '预览 · ' + p.title,
    wide: true,
    body: `<div id="ppPrevBar" style="display:flex;gap:10px;margin-bottom:10px">
        <button class="btn ghost sm" id="ppAnsToggle">显示答案解析</button>
        <button class="btn ghost sm" id="ppPrint">打印 / 导出 PDF</button></div>
      <div id="ppPrevBody">${paint(false)}</div>`,
    onMount: (w) => {
      let show = false;
      w.querySelector('#ppAnsToggle').onclick = (e) => {
        show = !show;
        e.target.textContent = show ? '隐藏答案解析' : '显示答案解析';
        w.querySelector('#ppPrevBody').innerHTML = paint(show);
      };
      w.querySelector('#ppPrint').onclick = () => bkPrintWindow(p.title, paint(true));
    },
  });
}

/** 编辑试卷（改标题 / 定位 / 增删题目） */
function bkPaperEdit(p) {
  const picked = p.questions.slice();
  modal({
    title: '编辑试卷',
    wide: true,
    okText: '保存',
    body: `
      <div class="field"><label>试卷标题</label><input id="pe-title" value="${esc(p.title)}"></div>
      <div class="pp-row">
        <div class="field"><label>学科</label><select id="pe-subject">${SUBJECTS.map((s) => `<option ${p.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="pe-stage"><option value="">不限</option><option value="primary" ${p.stage === 'primary' ? 'selected' : ''}>小学</option><option value="junior" ${p.stage === 'junior' ? 'selected' : ''}>初中</option></select></div>
        <div class="field"><label>年级</label><select id="pe-grade"><option value="">不限</option>${BK_GRADES.map((g) => `<option ${p.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field"><label>册别</label><select id="pe-term"><option value="">不限</option><option ${p.term === '上册' ? 'selected' : ''}>上册</option><option ${p.term === '下册' ? 'selected' : ''}>下册</option></select></div>
      </div>
      <div class="pp-row">
        <div class="field" style="width:110px"><label>建议时长</label><input id="pe-duration" type="number" value="${p.duration}" min="10"></div>
        <div class="field" style="width:110px"><label>满分</label><input id="pe-score" type="number" value="${p.total_score}" min="10"></div>
      </div>
      <div class="field"><label>卷面题目（${picked.length} 题，点 × 移除）</label><div id="peList" class="pe-list"></div></div>`,
    onMount: (w) => {
      const paint = () => {
        w.querySelector('#peList').innerHTML = picked.map((q, i) => `
          <div class="pp-q"><div class="pp-q-main"><b>${i + 1}.</b> [${BK_QTNAME[q.type]}] ${esc(bkTrunc(q.stem, 60))}</div>
          <button class="link-btn danger" data-rm="${q.id}">×</button></div>`).join('') || '<div class="empty">卷面已空</div>';
        w.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
          const at = picked.findIndex((q) => String(q.id) === b.dataset.rm);
          if (at >= 0) picked.splice(at, 1);
          paint();
        });
      };
      paint();
    },
    onOk: async (w, err) => {
      if (!picked.length) return err('卷面至少要有 1 道题');
      await api('/api/admin/bank/papers/' + p.id, {
        method: 'PUT', silent: true,
        body: {
          title: w.querySelector('#pe-title').value.trim(),
          subject: w.querySelector('#pe-subject').value,
          stage: w.querySelector('#pe-stage').value,
          grade: w.querySelector('#pe-grade').value,
          term: w.querySelector('#pe-term').value,
          duration: Number(w.querySelector('#pe-duration').value) || 90,
          total_score: Number(w.querySelector('#pe-score').value) || 100,
          q_ids: picked.map((q) => q.id),
        },
      });
      toast('试卷已保存', 'ok');
      render();
    },
  });
}

/* ================================================================
   ③ 课文习题（课本 → 分组 → 视频 → 绑题）
   ================================================================ */
async function viewLessonQ() {
  const st = ADM.page.lq = ADM.page.lq || { subject: '数学', category: '', grade: '', chapter: '', group: '' };
  const chapters = await api('/api/admin/bank/chapters?subject=' + encodeURIComponent(st.subject));
  const cats = [...new Set(chapters.map((c) => c.category || ''))].filter(Boolean);
  // 年级随学科+分类联动；按 BK_GRADES 顺序排，不在表里的排后面
  const grades = [...new Set(chapters
    .filter((c) => !st.category || (c.category || '') === st.category)
    .map((c) => c.grade || ''))].filter(Boolean)
    .sort((a, b) => (BK_GRADES.indexOf(a) + 1 || 99) - (BK_GRADES.indexOf(b) + 1 || 99));
  const shownChapters = chapters.filter((c) => (!st.category || (c.category || '') === st.category)
    && (!st.grade || (c.grade || '') === st.grade));
  // 当前选中的课本若被年级/分类筛掉，自动清空选择
  if (st.chapter && !shownChapters.some((c) => String(c.id) === String(st.chapter))) st.chapter = '';
  let detail = null;
  if (st.chapter) {
    detail = await api('/api/admin/bank/chapters/' + st.chapter + '/lessons').catch(() => null);
  }

  const groups = detail ? (detail.grouped
    ? detail.sections.map((s) => ({ id: s.id, name: s.name })).concat(
        detail.videos.some((v) => !v.section_id) ? [{ id: 0, name: '未分组' }] : [])
    : []) : [];
  const curGroup = st.group === '' ? (groups.length ? groups[0].id : '') : st.group;
  const videos = detail ? detail.videos.filter((v) => !detail.grouped || String(v.section_id || 0) === String(curGroup)) : [];

  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('list')} 课文习题 · 给知识点视频配练习题</h3></div>
    <div class="bk-filters lq-filters">
      <select id="lq-subject">${SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="lq-category"><option value="">全部分类</option>${cats.map((c) => `<option ${st.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="lq-grade"><option value="">全部年级</option>${grades.map((g) => `<option ${st.grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <select id="lq-chapter" style="min-width:240px">
        <option value="">全部课本（课程目录）</option>
        ${shownChapters.map((c) => `<option value="${c.id}" ${String(st.chapter) === String(c.id) ? 'selected' : ''}>${esc(bkChapterLabel(c))}（${c.video_count} 个知识点 / ${c.question_count} 题）</option>`).join('')}
      </select>
    </div>
    ${!detail ? '<div class="empty">先在上面的下拉里选择一门课本（课程目录）</div>' : `
    <div class="lq-layout ${detail.grouped ? 'grouped' : ''}">
      ${detail.grouped ? `<aside class="lq-side">
        ${groups.map((g) => `<a class="lq-side-item ${String(curGroup) === String(g.id) ? 'on' : ''}" data-g="${g.id}">
          <span class="gs-name">${esc(g.name)}</span></a>`).join('')}
      </aside>` : ''}
      <div class="lq-main">
        ${videos.length ? videos.map((v) => `
          <div class="lq-video">
            <div class="lq-v-info"><b>${esc(v.title)}</b><span class="tag ${v.question_count ? 'ok' : 'gray'}">${v.question_count ? v.question_count + ' 道习题' : '暂无习题'}</span></div>
            <button class="btn ghost sm" data-vq="${v.id}">${ic('doc')} 管理习题</button>
          </div>`).join('') : '<div class="empty">这个分组下还没有视频，先到「视频管理」上传</div>'}
      </div>
    </div>`}
  </div>`;

  return {
    html,
    after: () => {
      document.getElementById('lq-subject').onchange = (e) => { st.subject = e.target.value; st.category = ''; st.chapter = ''; st.group = ''; render(); };
      document.getElementById('lq-category').onchange = (e) => { st.category = e.target.value; st.grade = ''; st.chapter = ''; st.group = ''; render(); };
      document.getElementById('lq-grade').onchange = (e) => { st.grade = e.target.value; st.chapter = ''; st.group = ''; render(); };
      document.getElementById('lq-chapter').onchange = (e) => { st.chapter = e.target.value; st.group = ''; render(); };
      document.querySelectorAll('.lq-side-item').forEach((a) => a.onclick = () => { st.group = a.dataset.g; render(); });
      document.querySelectorAll('[data-vq]').forEach((b) => b.onclick = () => bkVideoQuestions(Number(b.dataset.vq)));
    },
  };
}

/** 某个视频的习题管理弹窗：查看已绑题 + 添加新题 + 从题库选绑 */
async function bkVideoQuestions(videoId) {
  let d;
  try { d = await api('/api/admin/bank/videos/' + videoId + '/questions'); }
  catch (e) { return; }
  const paint = () => `
    <div class="vq-head"><b>${esc(d.video.title)}</b><span class="tag ok">${d.list.length} 道题</span></div>
    ${d.list.length ? `<div class="vq-list">${d.list.map((q) => `
      <div class="vq-item"><div class="pp-q-main">
        <b>[${BK_QTNAME[q.type]}]</b> ${esc(bkTrunc(q.stem, 60))}
        <div class="vq-ans">答案：${esc(bkAnswerText(q))}</div></div>
        <button class="link-btn danger" data-un="${q.id}">解绑</button></div>`).join('')}</div>`
      : '<div class="empty" style="padding:20px 0">这个视频还没有习题，点下方按钮添加</div>'}`;
  modal({
    title: '知识点习题 · ' + d.video.title,
    wide: true,
    body: `<div id="vqBody">${paint()}</div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn primary" id="vqAdd">${ic('plus')} 添加习题</button>
        <button class="btn ghost" id="vqPick">${ic('search')} 从题库选择绑定</button>
        <button class="btn ghost" id="vqUpload">${ic('upload')} 批量上传</button>
      </div>`,
    onMount: (w) => {
      const refresh = async () => {
        d = await api('/api/admin/bank/videos/' + videoId + '/questions');
        w.querySelector('#vqBody').innerHTML = paint();
        bindList();
      };
      const bindList = () => {
        w.querySelectorAll('[data-un]').forEach((b) => b.onclick = async () => {
          await api(`/api/admin/bank/videos/${videoId}/bind`, { method: 'POST', silent: true, body: { ids: [Number(b.dataset.un)], unbind: 1 } });
          toast('已解绑', 'ok');
          refresh();
        });
      };
      bindList();
      w.querySelector('#vqAdd').onclick = () => {
        modal({
          title: '添加习题（自动绑定到该知识点，同时存入题库）', wide: true, okText: '添加',
          body: bkFormBody({}, { bind: false }),
          onMount: (w3) => bkFormMount(w3, {}),
          onOk: async (w3, err) => {
            const body = bkFormRead(w3, err);
            if (!body) return false;
            body.video_id = videoId;
            await api('/api/admin/bank/questions', { method: 'POST', silent: true, body });
            toast('习题已添加并绑定', 'ok');
            refresh();
            return false;   // 保留外层弹窗，方便连续加题
          },
        });
      };
      w.querySelector('#vqPick').onclick = () => bkPickFromBank(videoId, () => refresh());
      w.querySelector('#vqUpload').onclick = () => {
        modal({
          title: '批量上传习题（Word 一键解析）', wide: true,
          body: `
            <div class="mf-tip" style="margin-bottom:12px">支持「洋葱题库」样式的 Word 文档（.docx）：<br>
              <b>1.（单选题）题干</b> → <b>A./B./C./D. 选项</b> → <b>答案：X</b> → <b>解析：……</b><br>
              题干和解析里的<b>插图自动提取</b>并挂到对应题目；解析出的题直接入库并绑定到本知识点（学科/年级随课本自动带出）。</div>
            <label class="btn primary" style="display:inline-block;cursor:pointer">${ic('upload')} 选择 .docx 文件
              <input type="file" id="vqFile" accept=".docx" style="display:none"></label>
            <span class="hint" style="margin-left:10px">选择文件后自动解析上传，多题一次入库</span>
            <div id="vqUpOut" style="margin-top:14px"></div>`,
          onMount: (w3) => {
            w3.querySelector('#vqFile').onchange = async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const out = w3.querySelector('#vqUpOut');
              out.innerHTML = '<span class="spinner"></span> 正在解析上传，题目多时需要几秒…';
              const fd = new FormData();
              fd.append('file', file);
              try {
                const res = await fetch(`/api/admin/bank/videos/${videoId}/import-docx`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
                const json = await res.json();
                if (json.code !== 0) throw new Error(json.msg || '上传失败');
                const d = json.data || {};
                out.innerHTML = `<div class="tag ok" style="font-size:14px;padding:8px 14px">✅ ${esc(json.msg)}${d.skipped ? `，跳过 ${d.skipped} 段无法识别的内容` : ''}</div>`;
                toast(json.msg, 'ok');
                refresh();
              } catch (err) {
                out.innerHTML = `<div style="color:#dc2626;font-size:13px">${esc(err.message)}</div>`;
              }
            };
          },
        });
      };
    },
  });
}

/** 从题库挑题绑到视频 */
function bkPickFromBank(videoId, onDone) {
  const st = { kw: '', page: 1 };
  modal({
    title: '从题库选择题目绑定',
    wide: true,
    okText: '绑定所选',
    body: `
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input class="input" id="pkKw" placeholder="搜索题干 / 知识点" style="flex:1">
        <button class="btn ghost" id="pkGo">搜索</button>
      </div>
      <div id="pkList" style="max-height:44vh;overflow:auto"></div>
      <div id="pkPager" style="margin-top:8px"></div>`,
    onMount: (w) => {
      const chosen = new Set();
      const wrap = w.closest('.el-dialog__wrapper');
      const load = async () => {
        const r = await api(`/api/admin/bank/questions?page=${st.page}&size=8&video=none${st.kw ? '&kw=' + encodeURIComponent(st.kw) : ''}`, { silent: true });
        w.querySelector('#pkList').innerHTML = (r.list || []).map((q) => `
          <label class="pk-row"><input type="checkbox" data-id="${q.id}" ${chosen.has(q.id) ? 'checked' : ''}>
            <b>[${BK_QTNAME[q.type]}]</b> ${esc(bkTrunc(q.stem, 66))}</label>`).join('') || '<div class="empty">没有符合条件的未绑定题目</div>';
        w.querySelectorAll('[data-id]').forEach((c) => c.onchange = () => {
          if (c.checked) chosen.add(Number(c.dataset.id)); else chosen.delete(Number(c.dataset.id));
        });
        const pages = Math.max(1, Math.ceil(r.total / 8));
        w.querySelector('#pkPager').innerHTML = pages > 1
          ? `<button class="btn ghost sm" id="pkPrev" ${st.page <= 1 ? 'disabled' : ''}>上一页</button>
             <span style="margin:0 8px">第 ${st.page} / ${pages} 页，共 ${r.total} 题</span>
             <button class="btn ghost sm" id="pkNext" ${st.page >= pages ? 'disabled' : ''}>下一页</button>`
          : `共 ${r.total} 题`;
        const prev = w.querySelector('#pkPrev'), next = w.querySelector('#pkNext');
        if (prev) prev.onclick = () => { st.page--; load(); };
        if (next) next.onclick = () => { st.page++; load(); };
      };
      const doSearch = () => { st.kw = w.querySelector('#pkKw').value.trim(); st.page = 1; load(); };
      w.querySelector('#pkGo').onclick = doSearch;
      w.querySelector('#pkKw').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
      load();
      wrap.querySelector('#mOk').onclick = async () => {
        if (!chosen.size) { toast('请先勾选题目', 'err'); return; }
        await api(`/api/admin/bank/videos/${videoId}/bind`, { method: 'POST', silent: true, body: { ids: [...chosen] } });
        toast(`已绑定 ${chosen.size} 道题`, 'ok');
        wrap.remove();
        if (onDone) onDone();
      };
    },
  });
}

/* ================================================================
   ④ 错题记录
   ================================================================ */
async function viewMistakeLog() {
  const st = ADM.page.ml = ADM.page.ml || { campus: '', student: '', subject: '', resolved: '' };
  const page = Math.max(1, Number(ADM.page.mlPage) || 1);
  const size = Math.max(1, Number(ADM.page.mlPageSize) || 20);
  const _d = new Date();
  const todayStr = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
  const branches = await api('/api/admin/bank/branches-options', { silent: true }).catch(() => []);
  const students = await api('/api/admin/bank/students-options' + (st.campus ? '?campus=' + encodeURIComponent(st.campus) : ''));
  const qs = `student_id=${encodeURIComponent(st.student)}&subject=${encodeURIComponent(st.subject)}&resolved=${encodeURIComponent(st.resolved)}&campus=${encodeURIComponent(st.campus)}`;
  const data = await api(`/api/admin/bank/mistakes?page=${page}&size=${size}&${qs}`);
  ADM.page.mlPage = data.page; ADM.page.mlPageSize = data.size;
  /* 恢复/删除错题后停在超出的空页时自动回退到最后一页 */
  const mlPages = Math.max(1, Math.ceil((data.total || 0) / (data.size || size)));
  if (data.total > 0 && page > mlPages) { ADM.page.mlPage = mlPages; return viewMistakeLog(); }

  /** 复习进度：三圈（连续答对 3 次 = 已掌握） */
  const stageDots = (m) => {
    const n = Math.min(3, Number(m.review_stage) || 0);
    return `<span class="ml-dots" title="复习连续答对 ${n}/3 次">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>`;
  };

  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('puzzle')} 智能题库 · 错题记录</h3>
      <div class="card-h-r">
        <button class="btn ghost" id="mlPrint">${ic('print')} 打印纸质版</button>
      </div>
    </div>
    <div class="bk-filters">
      ${branches.length ? `<select id="mlf-campus" style="min-width:130px">
        <option value="">全部校区</option>
        ${branches.map((b) => `<option value="${b.id}" ${String(st.campus) === String(b.id) ? 'selected' : ''}>${esc(b.name || '分校 #' + b.id)}</option>`).join('')}
      </select>` : ''}
      <select id="mlf-student" style="min-width:170px">
        <option value="">全部学生（${students.length} 人）</option>
        ${students.map((s) => `<option value="${s.id}" ${String(st.student) === String(s.id) ? 'selected' : ''}>${esc(s.name)}（${esc(s.grade || '')}）</option>`).join('')}
      </select>
      <select id="mlf-subject"><option value="">全部学科</option>${SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="mlf-resolved"><option value="">全部状态</option><option value="0" ${st.resolved === '0' ? 'selected' : ''}>未掌握</option><option value="1" ${st.resolved === '1' ? 'selected' : ''}>已掌握</option></select>
    </div>
    ${data.list.length ? `<table><thead><tr>
      <th>学生</th><th>学科</th><th style="width:30%">题目</th><th>我的答案</th><th>正确答案</th><th>错次</th><th>复习进度</th><th>状态</th><th>时间</th></tr></thead><tbody>
      ${data.list.map((m) => `<tr>
        <td><b>${esc(m.student_name)}</b><div class="bk-pos">${esc(m.grade || '')}</div></td>
        <td><span class="tag">${esc(m.subject || '—')}</span></td>
        <td title="${esc(m.stem)}">${m.material ? '<span class="tag gray">复合</span> ' : ''}${esc(bkTrunc(m.stem, 40))}</td>
        <td style="color:#e5484d;max-width:150px">${esc(bkTrunc(bkMineText(m, m.last_answer), 18)) || '—'}</td>
        <td style="color:#12b76a;max-width:150px">${esc(bkTrunc(bkAnswerText(m), 18))}</td>
        <td>${m.wrong_count}</td>
        <td>${m.resolved ? '<span style="color:#c0c9d8">—</span>' : `${stageDots(m)}<div class="bk-pos">${m.next_review && m.next_review > todayStr ? esc(m.next_review) + ' 复习' : '今日待复习'}</div>`}</td>
        <td>${m.resolved ? '<span class="tag ok">已掌握</span>' : '<span class="tag no">未掌握</span>'}</td>
        <td class="bk-pos">${esc(String(m.updated_at || '').slice(0, 16))}</td>
      </tr>`).join('')}</tbody></table>
      ${pagerHTML(data.page, data.size, data.total, 'mlPage')}` : '<div class="empty">还没有错题记录（学生做错练习 / 试卷后会自动出现在这里）</div>'}
  </div>`;

  return {
    html,
    after: () => {
      bindPager('mlPage');
      const go = () => {
        st.campus = (document.getElementById('mlf-campus') || {}).value || '';
        st.student = document.getElementById('mlf-student').value;
        st.subject = document.getElementById('mlf-subject').value;
        st.resolved = document.getElementById('mlf-resolved').value;
        ADM.page.mlPage = 1;
        render();
      };
      /* 切校区后学生列表会重新拉取，原选中的学生可能不属于新校区，先清空 */
      const campusEl = document.getElementById('mlf-campus');
      if (campusEl) campusEl.onchange = () => { st.campus = campusEl.value; st.student = ''; ADM.page.mlPage = 1; render(); };
      ['mlf-student', 'mlf-subject', 'mlf-resolved'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.onchange = go;
      });
      document.getElementById('mlPrint').onclick = async () => {
        if (!st.student) { toast('请先在筛选里选择一个学生', 'err'); return; }
        const all = await api(`/api/admin/bank/mistakes?student_id=${st.student}&subject=${encodeURIComponent(st.subject)}&size=200`);
        if (!all.list.length) { toast('这个筛选条件下没有错题', 'err'); return; }
        bkPrintMistakes(all.list);
      };
    },
  };
}

/** 错题纸质版打印（A4：题目在前、答案解析在最后） */
function bkPrintMistakes(list) {
  const student = list[0] ? list[0].student_name : '';
  const seen = new Set();
  list.forEach((x) => seen.add(x.subject || '其他'));
  const subject = [...seen].join('/');
  const today = new Date().toISOString().slice(0, 10);
  const qHtml = list.map((m, i) => `
    <div class="q">
      <div class="qt"><b>${i + 1}.</b> [${BK_QTNAME[m.type] || ''}] ${esc(m.stem)}</div>
      ${(m.options || []).length && m.type !== 'sort' ? `<div class="qo">${m.options.map((o, j) => `<span>${BK_LETTERS[j]}. ${esc(o)}</span>`).join('')}</div>` : ''}
      ${m.type === 'fill' || m.type === 'sort' ? '<div class="qblank"></div>' : ''}
    </div>`).join('');
  const aHtml = list.map((m, i) => `
    <div class="a"><b>${i + 1}.</b> 答案：${esc(bkAnswerText(m))}　
      ${m.analysis ? `<span class="aa">解析：${esc(m.analysis)}</span>` : ''}</div>`).join('');
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>错题本 · ${esc(student)}</title>
  <script>window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)'],['$','$']],displayMath:[['\\\\[','\\\\]'],['$$','$$']]},svg:{fontCache:'global'}};<\/script>
  <script src="/vendor/mathjax-tex-svg.js"><\/script>
  <style>
    @page{size:A4;margin:16mm}
    body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#222;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto;padding:20px}
    h1{text-align:center;font-size:20px;margin-bottom:2px}
    .meta{text-align:center;color:#666;font-size:12px;margin-bottom:18px}
    .q{margin:12px 0;break-inside:avoid}
    .qt{line-height:1.8}
    .qo{padding-left:24px;display:grid;grid-template-columns:1fr 1fr;gap:2px 18px}
    .qblank{height:56px;border-bottom:1px dashed #bbb;margin-top:8px}
    h2{font-size:16px;border-top:2px solid #333;padding-top:12px;margin-top:28px}
    .a{margin:8px 0;font-size:12.5px;break-inside:avoid}
    .aa{color:#555}
  </style></head><body>
  <h1>错题本</h1>
  <div class="meta">${esc(student)} ｜ ${esc(subject)} ｜ 共 ${list.length} 题 ｜ 打印日期 ${today}</div>
  ${qHtml}
  <h2>参考答案与解析</h2>
  ${aHtml}
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>
  </body></html>`);
  w.document.close();
}

/** 试卷打印窗口 */
function bkPrintWindow(title, innerHtml) {
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>@page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#111;font-size:13.5px;line-height:1.9;max-width:800px;margin:0 auto;padding:24px}</style>
  </head><body>${innerHtml}
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

/* ================================================================
   上传审核：学生扫码上传的纸质错题 → 老师核对归类 → 入库题库中心
   （入库的同时自动加入对应学生的错题本）
   ================================================================ */
const UP_STATUS_NAME = { pending: '待审核', reviewed: '已核对', approved: '已入库', rejected: '已拒绝' };

function upZoom(src) {
  const m = document.createElement('div');
  m.className = 'mask';
  m.innerHTML = `<div style="text-align:center"><img src="${esc(src)}" style="max-width:92vw;max-height:80vh;border-radius:10px;background:#fff"><p style="color:#fff;font-size:13px;margin-top:8px;opacity:.85">点空白处关闭</p></div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}

function upCard(u) {
  const canReview = u.status === 'pending' || u.status === 'reviewed';
  const stTag = u.status === 'pending' ? 'no' : u.status === 'reviewed' ? '' : 'ok';
  return `<div class="up-it">
    <div class="up-it-h">
      <span class="tag ${stTag}">${UP_STATUS_NAME[u.status] || esc(u.status)}</span>
      <b>${esc(u.student_name || '学生')}</b>
      <span class="up-sub">${esc([u.student_grade, String(u.created_at || '').slice(0, 16)].filter(Boolean).join(' · '))}</span>
      <span class="up-acts">
        ${canReview ? `<button class="btn primary sm" data-up-review="${u.id}">${ic('edit')} ${u.status === 'reviewed' ? '重新核对' : '核对入库'}</button>
        <button class="btn ghost sm" data-up-del="${u.id}">${ic('delete')} 删除</button>` : ''}
      </span>
    </div>
    <div class="up-imgs">${(u.images || []).map((s) => `<img class="up-img" data-up-img src="${esc(s)}" loading="lazy" alt="错题照片">`).join('')}</div>
    ${u.stem_text ? `<div class="up-note">题干描述：${esc(u.stem_text)}</div>` : ''}
    ${u.answer ? `<div class="up-note">学生的答案：${esc(u.answer)}</div>` : ''}
    ${u.status === 'pending' ? `<div class="up-note">AI 识别归类：${esc([u.subject, u.grade, u.point].filter(Boolean).join(' · ')) || 'AI 识别中…'}</div>` : ''}
    ${(u.grade || u.chapter) && u.status !== 'pending' ? `<div class="up-note">归属（学生填）：${esc([u.grade, u.chapter].filter(Boolean).join(' · '))}</div>` : ''}
    ${(u.point) && u.status !== 'pending' ? `<div class="up-note">知识点（学生填）：${esc(u.point)}</div>` : ''}
    ${u.error_type ? `<div class="up-note">错误类型：${esc(u.error_type)}</div>` : ''}
    ${u.note ? `<div class="up-note">学生留言：${esc(u.note)}</div>` : ''}
    ${u.status === 'pending' ? `<div class="up-note">题目已自动进入该学生的错题本（免审核），等待审核：通过则保留，拒绝将从学生端删除</div>` : ''}
    ${u.status === 'reviewed' ? `<div class="up-note ok">已核对：${esc([u.subject, bkStageName(u.stage), u.grade, u.point].filter(Boolean).join(' · '))}，等待审核通过</div>` : ''}
    ${u.status === 'approved' ? `<div class="up-note ok">审核通过，题目在题库中心（题目 #${u.question_id}），并保留在该学生的错题本</div>` : ''}
    ${u.status === 'rejected' ? `<div class="up-note">已拒绝：${esc(u.review_note || '题目质量不符合要求')}，学生端这道题已删除</div>` : ''}
  </div>`;
}

/** 审核弹窗：通过（可修正学科/学段/年级/知识点，同步到题目）或拒绝（删除学生端题目） */
function upReviewForm(id, u) {
  u = u || {};
  modal({
    title: '审核学生上传 #' + id,
    okText: '✓ 审核通过',
    body: `<div class="bk-form">
      <div class="up-rv-imgs">${(u.images || []).map((s) => `<img class="up-img" data-rv-img src="${esc(s)}">`).join('')}</div>
      ${u.stem_text ? `<div class="up-note">题干描述：${esc(u.stem_text)}</div>` : ''}
      ${u.answer ? `<div class="up-note">学生的答案：${esc(u.answer)}</div>` : ''}
      ${u.error_type ? `<div class="up-note">错误类型：${esc(u.error_type)}${u.chapter ? ' · ' + esc(u.chapter) : ''}</div>` : ''}
      ${u.note ? `<div class="up-note">学生留言：${esc(u.note)}</div>` : ''}
      <div class="bk-form-row">
        <div class="field"><label>学科 *</label><select id="upSubject">${SUBJECTS.map((s) => `<option ${u.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>学段</label><select id="upStage">
          <option value="">自动</option><option value="primary" ${u.stage === 'primary' ? 'selected' : ''}>小学</option>
          <option value="junior" ${u.stage === 'junior' ? 'selected' : ''}>初中</option></select></div>
        <div class="field"><label>年级</label><select id="upGrade"><option value="">自动（按学生年级）</option>
          ${BK_GRADES.map((g) => `<option ${u.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>知识点（AI 已自动识别，可直接修正）</label>
        <input id="upPoint" class="input" value="${esc(u.point || '')}" placeholder="如：有理数混合运算"></div>
      <div class="field"><label>参考答案 / 老师备注（显示在题目的解析里，可留空）</label>
        <textarea id="upNote" class="input" rows="2" style="height:auto" placeholder="选填，方便学生自查">${esc(u.review_note || '')}</textarea></div>
      <button class="btn danger" id="upReject" style="margin-top:6px;width:100%;background:#fff;color:#d5323a;border:1.5px solid #fbc4c4">✕ 拒绝并删除学生端这道题</button>
    </div>`,
    onOk: async (w, err) => {
      const body = {
        subject: w.querySelector('#upSubject').value,
        stage: w.querySelector('#upStage').value,
        grade: w.querySelector('#upGrade').value,
        point: w.querySelector('#upPoint').value.trim(),
        review_note: w.querySelector('#upNote').value.trim(),
        status: 'approved',
      };
      try {
        const r = await api(`/api/admin/bank/uploads/${id}/review`, { method: 'POST', body });
        toast(r.msg || '审核通过', 'ok');
      } catch (e) { return err(e.message || '操作失败'); }
      viewUploads();
    },
    onMount: (w) => {
      w.querySelectorAll('[data-rv-img]').forEach((im) => im.onclick = () => upZoom(im.src));
      const rj = w.querySelector('#upReject');
      if (rj) rj.onclick = async () => {
        if (!await elConfirm({ title: '拒绝并删除', message: '拒绝后这道题会从该学生的错题本中删除（题库中同步删除）。确定拒绝吗？', okText: '拒绝并删除' })) return;
        try {
          const r = await api(`/api/admin/bank/uploads/${id}/review`, { method: 'POST', body: { status: 'rejected', review_note: (w.querySelector('#upNote') || {}).value || '' } });
          toast(r.msg || '已拒绝', 'ok');
        } catch (e) { toast(e.message || '操作失败', 'err'); }
        const mask = rj.closest('.mask');
        if (mask) mask.remove();
        viewUploads();
      };
    },
  });
}

async function viewUploads() {
  const st = ADM.page.bkup = ADM.page.bkup || { status: '' };
  const page = Math.max(1, Number(ADM.page.bkupPage) || 1);
  const size = 30;
  let data;
  try { data = await api(`/api/admin/bank/uploads?page=${page}&size=${size}${st.status ? '&status=' + st.status : ''}`); }
  catch (e) { return { html: `<div class="card"><div class="empty">${esc(e.message || '加载失败')}</div></div>`, after() {} }; }
  ADM.page.bkupPage = data.page;
  const counts = data.counts || {};
  const tabs = [['', `待处理 ${(counts.pending || 0) + (counts.reviewed || 0)}`], ['pending', `待审核 ${counts.pending || 0}`], ['reviewed', `已核对 ${counts.reviewed || 0}`], ['approved', `已入库 ${counts.approved || 0}`], ['rejected', `已拒绝 ${counts.rejected || 0}`]];
  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('upload')} 智能题库 · 上传审核</h3>
      <div class="card-h-r">
        ${((counts.pending || 0) + (counts.reviewed || 0)) ? `<button class="btn primary" id="upAll">${ic('check')} 批量通过全部待审核（${(counts.pending || 0) + (counts.reviewed || 0)}）</button>` : ''}
        <button class="btn ghost" id="upRefresh">${ic('refresh')} 刷新</button>
      </div>
    </div>
    <div class="bk-tabs" style="padding-top:2px">${tabs.map(([k, t]) => `<a class="${st.status === k ? 'on' : ''}" data-k="${k}">${t}</a>`).join('')}</div>
    ${data.list.length ? `<div class="up-list">${data.list.map(upCard).join('')}
      ${pagerHTML(data.page, data.size, data.total, 'bkupPage')}</div>`
      : '<div class="empty">暂无待处理的上传记录。学生在错题本点「拍照上传错题」扫码提交后会出现在这里</div>'}
  </div>`;
  return {
    html,
    after: () => {
      bindPager('bkupPage');
      document.querySelectorAll('.bk-tabs a[data-k]').forEach((a) => a.onclick = () => { st.status = a.dataset.k; ADM.page.bkupPage = 1; viewUploads(); });
      const rf = document.getElementById('upRefresh');
      if (rf) rf.onclick = () => viewUploads();
      const all = document.getElementById('upAll');
      if (all) all.onclick = async () => {
        if (!await elConfirm({ title: '批量通过', message: `把全部待审核/已核对的 ${counts.pending + counts.reviewed} 条记录确认为审核通过？（题目此前已自动进入对应学生的错题本，此操作仅确认保留）`, okText: '批量通过' })) return;
        try {
          const r = await api('/api/admin/bank/uploads/import-all', { method: 'POST' });
          toast(r.msg || '已批量通过', 'ok');
          viewUploads();
        } catch (e) { toast(e.message || '操作失败', 'err'); }
      };
      document.querySelectorAll('[data-up-review]').forEach((b) => b.onclick = () => {
        upReviewForm(Number(b.dataset.upReview), data.list.find((x) => x.id === Number(b.dataset.upReview)));
      });
      document.querySelectorAll('[data-up-del]').forEach((b) => b.onclick = async () => {
        if (!await elConfirm({ title: '删除记录', message: '确定删除这条上传记录？（不影响题库和学生错题本）', okText: '删除' })) return;
        try { await api(`/api/admin/bank/uploads/${b.dataset.upDel}`, { method: 'DELETE' }); toast('已删除', 'ok'); viewUploads(); }
        catch (e) { toast(e.message || '删除失败', 'err'); }
      });
      document.querySelectorAll('[data-up-img]').forEach((im) => im.onclick = () => upZoom(im.src));
    },
  };
}

/* ================================================================
   ⑦ 错题反馈记录（学生端反馈的题目问题，逐条核对处理）
   ================================================================ */
const FB_STATUS = { pending: ['待处理', 'warn'], done: ['已处理', 'ok'], ignored: ['已忽略', 'gray'], hidden: ['已隐藏', 'gray'] };

async function viewBankFeedback() {
  const st = ADM.page.bkfb = ADM.page.bkfb || { status: 'pending', subject: '', kw: '' };
  const page = Math.max(1, Number(ADM.page.bkfbPage) || 1);
  const qs = Object.entries(st).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = await api(`/api/admin/bank/feedback?page=${page}&size=20${qs ? '&' + qs : ''}`);
  ADM.page.bkfbPage = data.page;

  const stat = data.stat || {};
  const tab = (k, label, n) => `<a class="${st.status === k ? 'on' : ''}" data-st="${k}">${label}<i>${n}</i></a>`;

  const row = (f) => `<tr>
    <td><span class="bk-qno">#${String(f.question_id).padStart(5, '0')}</span></td>
    <td class="bk-stem" title="${esc(f.stem)}">${esc(bkTrunc(f.stem, 40))}</td>
    <td><span class="tag">${esc(f.reason || '其他')}</span></td>
    <td class="bk-pos">${esc(f.note || '—')}</td>
    <td>${esc(f.student_name || '')}<span class="hint" style="display:block">${esc(f.student_grade || '')}</span></td>
    <td class="bk-pos">${esc(String(f.created_at || '').slice(0, 16))}</td>
    <td><span class="tag ${(FB_STATUS[f.status] || [])[1] || 'gray'}">${(FB_STATUS[f.status] || [f.status])[0]}</span></td>
    <td class="bk-ops">
      <button class="link-btn" data-fb-view="${f.id}">看题目</button>
      ${f.status !== 'done' ? `<button class="link-btn" data-fb-done="${f.id}">标记已处理</button>` : ''}
      ${f.status !== 'ignored' ? `<button class="link-btn danger" data-fb-ign="${f.id}">忽略</button>` : ''}
    </td>
  </tr>`;

  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('chat')} 智能题库 · 错题反馈记录</h3>
      <div class="card-h-r"><span class="hint">学生做完题后对题目的反馈，逐条核对处理</span></div>
    </div>
    <div class="bk-tabs2">
      ${tab('pending', '待处理', stat.pending || 0)}
      ${tab('done', '已处理', stat.done || 0)}
      ${tab('ignored', '已忽略', stat.ignored || 0)}
      ${tab('', '全部', (stat.pending || 0) + (stat.done || 0) + (stat.ignored || 0))}
    </div>
    <div class="bk-filters">
      <select id="fbf-subject"><option value="">全部学科</option>${SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input id="fbf-kw" value="${esc(st.kw)}" placeholder="搜编号 / 题干 / 学生 / 说明" style="width:220px">
      <button class="btn ghost" id="fbfGo">${ic('search')} 筛选</button>
    </div>
    <div class="bk-count">共 <b>${data.total}</b> 条反馈</div>
    ${data.list.length ? `<table><thead><tr>
      <th>题目编号</th><th style="width:32%">题目</th><th>反馈原因</th><th>学生说明</th><th>学生</th><th>时间</th><th>状态</th><th style="width:190px">操作</th>
      </tr></thead><tbody>${data.list.map(row).join('')}</tbody></table>
    ${pagerHTML(data.page, data.size, data.total, 'bkfbPage')}` : '<div class="empty">暂无反馈记录。学生端做完题点「对题目有反馈？」提交后会出现在这里</div>'}
  </div>`;

  return {
    html,
    after: () => {
      bindPager('bkfbPage');
      document.querySelectorAll('.bk-tabs2 a').forEach((a) => a.onclick = () => {
        st.status = a.dataset.st || ''; ADM.page.bkfbPage = 1; render();
      });
      const go = () => {
        st.subject = document.getElementById('fbf-subject').value;
        st.kw = document.getElementById('fbf-kw').value.trim();
        ADM.page.bkfbPage = 1; render();
      };
      document.getElementById('fbfGo').onclick = go;
      document.getElementById('fbf-kw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      const setStatus = async (id, status) => {
        try { await api(`/api/admin/bank/feedback/${id}`, { method: 'PUT', body: { status } }); toast('已更新', 'ok'); render(); }
        catch (e) { /* api 已提示 */ }
      };
      document.querySelectorAll('[data-fb-done]').forEach((b) => b.onclick = () => setStatus(Number(b.dataset.fbDone), 'done'));
      document.querySelectorAll('[data-fb-ign]').forEach((b) => b.onclick = () => setStatus(Number(b.dataset.fbIgn), 'ignored'));
      document.querySelectorAll('[data-fb-view]').forEach((b) => b.onclick = () => {
        const f = data.list.find((x) => x.id === Number(b.dataset.fbView));
        if (f) bkQuestionForm(Object.assign({}, f, { id: f.question_id }));
      });
    },
  };
}
