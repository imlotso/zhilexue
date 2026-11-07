/* 魔方题库（并入智能题库，2026-10-29）
 * 四个子页面：题库管理（目录树）/ 网络采集 / 试卷管理 / 录题上传
 * 由 admin.js 的 VIEWS 调用；依赖 admin.js 的 modal / esc / toast / ic / pagerHTML / bindPager / ADM，api.js 的 elConfirm。
 */
const MF_API = '/api/admin/bank/mf';
const MF_TYPES = [['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'], ['fill', '填空题'], ['sort', '排序题'], ['answer', '解答题']];
const MF_TYPE_NAME = Object.fromEntries(MF_TYPES);
const MF_STAGES = [['', '全部学段'], ['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const MF_GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const MF_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const MF_EXAM_CATEGORIES = [['', '未分类'], ['unit', '单元'], ['midterm', '期中'], ['final', '期末'], ['entrance', '真题']];
const mfExamOptions = (selected = '') => MF_EXAM_CATEGORIES.map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join('');
const mfTermOptions = (selected = '') => [['','未指定'], ['上册','上册'], ['下册','下册'], ['全一册','全一册']].map(([v,t]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${t}</option>`).join('');
async function mfEditionFields(w, subId, stageId, editionId, selected = '') {
  const trees = await tpTrees('textbook');
  const sub = w.querySelector(subId), stage = w.querySelector(stageId), edition = w.querySelector(editionId);
  if (!sub || !stage || !edition) return;
  const refresh = (keep) => {
    const list = tpEditions(trees, { kind:'textbook', subject:sub.value, stage:stage.value }).filter(Boolean);
    edition.innerHTML = '<option value="">未指定</option>' + list.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    if (keep && list.includes(keep)) edition.value = keep;
  };
  sub.addEventListener('change', () => refresh('')); stage.addEventListener('change', () => refresh('')); refresh(selected);
}
const MF_SRC_NAME = { local: '本地', capture: '采集', recog: '录题' };

const mfEsc = (s) => String(s == null ? '' : s);
const mfState = (k) => (ADM.page[k] = ADM.page[k] || {});

async function mfCommitForm(batchId) {
  // 采集批次创建时已进入待审核；分类和入库统一在那里完成。
  toast('采集题目已进入待审核，请核对后入库', 'ok');
  location.hash = '#/pending';
}

async function viewMfPapers() {
  const st = mfState('mfp');
  st.view_status = st.view_status || '';
  delete st.status;
  st.folder = st.folder || '';
  st.kw = st.kw || '';
  const folders = (await api(MF_API + '/paper-folders', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const qs = Object.entries(st).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = await api(`${MF_API}/papers${qs ? '?' + qs : ''}`);
  const STATUS = { draft: '草稿', published: '已发布', archived: '已归档' };
  const groups = ['draft', 'published', 'archived'];
  const displayStatus = (p) => p.status === 'archived' ? 'archived' : Number(p.published) && !['basket','trashed'].includes(p.status) ? 'published' : 'draft';
  const seg = (s) => (data.list || []).filter((p) => displayStatus(p) === s);

  const html = `<div class="mf-wrap">
    <div class="card mf-card">
      <div class="card-h"><h3>${ic('folder')} 试卷文件夹</h3>
        <div class="card-h-r"><button class="btn ghost sm" id="mpFolderNew">${ic('plus')} 新建</button></div></div>
      <div class="card-b">
        <div class="mf-node"><a href="javascript:;" class="${st.folder === '' ? 'on' : ''}" data-folder="">全部试卷</a></div>
        <div class="mf-node"><a href="javascript:;" class="${st.folder === 'none' ? 'on' : ''}" data-folder="none">未分类</a></div>
        ${folders.map((f) => `<div class="mf-node"><a href="javascript:;" class="${String(st.folder) === String(f.id) ? 'on' : ''}" data-folder="${f.id}">${esc(f.name)}（${f.count || 0}）</a></div>`).join('')}
      </div>
    </div>
    <div class="card mf-card grow">
      <div class="card-h"><h3>${ic('doc')} 试卷管理</h3>
        <div class="card-h-r">
          <input id="mpKw" class="inp" placeholder="搜卷名" value="${esc(st.kw)}">
          <select id="mpSub"><option value="">全部学科</option>${MF_SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <input id="mpYear" class="inp" style="width:84px" placeholder="年份" maxlength="4" value="${esc(st.year || '')}">
          <select id="mpStatus"><option value="">全部状态</option>${groups.map((s) => `<option value="${s}" ${st.view_status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>
          <button class="btn primary sm" id="mpImport">${ic('upload')} 上传 Word 真题</button><button class="btn ghost sm" id="mpImagePaper">上传 PDF / 图片真题</button>
          <button class="btn ghost sm" id="mpNew">${ic('plus')} 新建试卷</button>
        </div></div>
      <div class="card-b">
        ${groups.map((s) => {
          const list = st.view_status ? (s === st.view_status ? seg(s) : []) : seg(s);
          if (!list.length) return '';
          return `<h4 class="mf-seg">${STATUS[s] || s}（${list.length}）</h4>
          <div class="mf-papers">${list.map((p) => `<div class="mf-paper">
            <div class="mf-pt">${esc(p.title)} ${displayStatus(p) === 'published' ? '<span class="tag ok">已发布到试卷库</span>' : ''}</div>
            <div class="hint">${esc(p.subject || '通用')}${p.grade ? ' · ' + esc(p.grade) : ''}${p.edition ? ' · ' + esc(p.edition) : ''}${p.term ? ' · ' + esc(p.term) : ''}${p.year ? ' · ' + esc(p.year) + '年' : ''} · ${esc((MF_EXAM_CATEGORIES.find(([v]) => v === (p.exam_category || '')) || MF_EXAM_CATEGORIES[0])[1])} · ${p.qcount || 0} 题 · ${esc(p.created_at || '')}</div>
            <div class="mf-pbtns">
              <button class="btn ghost xs" data-open="${p.id}">打开</button>
              <button class="btn ghost xs" data-prev="${p.id}">预览打印</button>
              <button class="btn ghost xs" data-status="${p.id}">状态</button>
              <button class="btn ghost xs" data-category="${p.id}">试卷类型</button>
              <button class="btn ghost xs" data-edition="${p.id}">教材信息</button>
              <button class="btn ghost xs" data-libpub="${p.id}">${displayStatus(p) === 'published' ? '取消发布' : '发布'}</button>
              <button class="btn ghost xs" data-delp="${p.id}">删</button>
            </div></div>`).join('')}</div>`;
        }).join('') || '<div class="empty">还没有试卷，点右上角新建一张</div>'}
      </div>
    </div></div>`;

  return {
    html,
    after: () => {
      document.getElementById('mpNew').onclick = () => {
        modal({
          title: '新建试卷', body: `<div class="mf-form">
            <div class="field"><label>卷名</label><input id="npTitle" class="inp" placeholder="如：七年级上册期中卷"></div>
            <div class="field"><label>年份</label><input id="npYear" class="inp" placeholder="如 2024（选填）" maxlength="4"></div>
            <div class="field"><label>试卷类型</label><select id="npCategory">${mfExamOptions()}</select></div>
            <div class="field"><label>学科</label><select id="npSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
            <div class="field"><label>学段</label><select id="npStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
            <div class="field"><label>年级</label><select id="npGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
            <div class="field"><label>教材版本</label><select id="npEdition"><option value="">未指定</option></select></div>
            <div class="field"><label>册别</label><select id="npTerm">${mfTermOptions()}</select></div>
            <div class="field"><label>文件夹</label><select id="npFolder"><option value="">未分类</option>${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div></div>`,
          onMount: (w) => mfEditionFields(w, '#npSub', '#npStage', '#npEdition'),
          onOk: async (w) => {
            await api(MF_API + '/papers', { method: 'POST', body: { year: w.querySelector('#npYear').value.trim(), exam_category: w.querySelector('#npCategory').value, title: w.querySelector('#npTitle').value.trim(), subject: w.querySelector('#npSub').value, stage: w.querySelector('#npStage').value, grade: w.querySelector('#npGrade').value, edition: w.querySelector('#npEdition').value, term: w.querySelector('#npTerm').value, folder_id: w.querySelector('#npFolder').value || null } });
            toast('已创建', 'ok'); render();
          },
        });
      };
      document.getElementById('mpKw').onkeydown = (e) => { if (e.key === 'Enter') { st.kw = e.target.value.trim(); render(); } };
      document.getElementById('mpSub').onchange = (e) => { st.subject = e.target.value; render(); };
      document.getElementById('mpYear').onkeydown = (e) => { if (e.key === 'Enter') { st.year = e.target.value.trim(); render(); } };
      document.getElementById('mpImport').onclick = () => mfImportPaperDialog(folders);
      document.getElementById('mpImagePaper').onclick = () => { toast('请新建录题批次，上传并识别后选择「保存为试卷草稿」', 'ok'); location.hash = '#/mfi'; };
      document.getElementById('mpStatus').onchange = (e) => { st.view_status = e.target.value; delete st.status; render(); };
      document.querySelectorAll('[data-folder]').forEach((a) => { a.onclick = () => { st.folder = a.dataset.folder; render(); }; });
      document.getElementById('mpFolderNew').onclick = () => {
        modal({ title: '新建文件夹', body: `<div class="field"><label>名称</label><input id="nfName" class="inp"></div>`,
          onOk: async (w) => { await api(MF_API + '/paper-folders', { method: 'POST', body: { name: w.querySelector('#nfName').value.trim() } }); toast('已创建', 'ok'); render(); } });
      };
      document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => mfPaperDetail(Number(b.dataset.open)); });
      document.querySelectorAll('[data-prev]').forEach((b) => { b.onclick = async () => {
        const d = await api(`${MF_API}/papers/${b.dataset.prev}/preview?mode=teacher`);
        const w = window.open('', '_blank');
        w.document.write(d.html); w.document.close();
      }; });
      document.querySelectorAll('[data-status]').forEach((b) => { b.onclick = () => {
        const id = Number(b.dataset.status);
        const paper = (data.list || []).find((item) => Number(item.id) === id);
        modal({ title: '修改状态', body: `<div class="field"><label>状态</label><select id="nsStatus"><option value="done" ${paper && paper.status !== 'archived' ? 'selected' : ''}>草稿</option><option value="archived" ${paper && paper.status === 'archived' ? 'selected' : ''}>已归档</option></select></div><p class="hint">设为草稿或归档时，学生端将不再显示这份试卷。</p>`,
          onOk: async (w) => { await api(MF_API + '/papers/' + id, { method: 'PUT', body: { status: w.querySelector('#nsStatus').value, published: 0 } }); toast('已更新', 'ok'); render(); } });
      }; });
      document.querySelectorAll('[data-category]').forEach((button) => { button.onclick = () => {
        const paper = (data.list || []).find((item) => Number(item.id) === Number(button.dataset.category));
        if (!paper) return;
        modal({ title: '修改试卷类型', body: `<div class="field"><label>试卷类型</label><select id="editExamCategory">${mfExamOptions(paper.exam_category || '')}</select></div>`,
          onOk: async (w) => { await api(MF_API + '/papers/' + paper.id, { method: 'PUT', body: { exam_category: w.querySelector('#editExamCategory').value } }); toast('已更新', 'ok'); render(); } });
      }; });
      document.querySelectorAll('[data-edition]').forEach((button) => { button.onclick = () => {
        const paper = (data.list || []).find((item) => Number(item.id) === Number(button.dataset.edition)); if (!paper) return;
        modal({ title: '教材信息', body: `<p class="hint">按已有知识树选择版本；实际章节和知识点仍需在待审核中核对。</p><div class="field"><label>教材版本</label><select id="editEdition"><option value="">未指定</option></select></div><div class="field"><label>册别</label><select id="editTerm">${mfTermOptions(paper.term || '')}</select></div>`,
          onMount: async (w) => { const trees = await tpTrees('textbook'); const list = tpEditions(trees,{kind:'textbook',subject:paper.subject,stage:paper.stage}).filter(Boolean); if (paper.edition && !list.includes(paper.edition)) list.unshift(paper.edition); w.querySelector('#editEdition').innerHTML = '<option value="">未指定</option>' + list.map(e=>`<option value="${esc(e)}" ${e===paper.edition?'selected':''}>${esc(e)}</option>`).join(''); },
          onOk: async (w) => { await api(MF_API + '/papers/' + paper.id, { method:'PUT', body:{edition:w.querySelector('#editEdition').value,term:w.querySelector('#editTerm').value} }); toast('已更新','ok'); render(); } });
      }; });
      document.querySelectorAll('[data-libpub]').forEach((b) => { b.onclick = async () => {
        const id = Number(b.dataset.libpub);
        const turnOn = b.textContent.trim() === '发布';
        await api(`${MF_API}/papers/${id}`, { method: 'PUT', body: { published: turnOn ? 1 : 0 } });
        toast(turnOn ? '已发布，学生端「试卷 → 试卷库」可见' : '已取消发布', 'ok'); render();
      }; });
      document.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = async () => {
        if (!(await elConfirm({ title: '删除试卷', message: '彻底删除这张卷（题不会从题库删掉），确定？', okText: '删除', danger: true }))) return;
        await api(`${MF_API}/papers/${b.dataset.delp}`, { method: 'DELETE' }); toast('已删除', 'ok'); render();
      }; });
    },
  };
}

/** 上传真题试卷（T10）：选 Word → 先识别预览 → 确认后生成试卷，题目同时入题库 */
function mfImportPaperDialog(folders) {
  const yr = new Date().getFullYear();
  let previewed = false;
  modal({
    title: '上传真题试卷', wide: true, okText: '识别预览',
    body: `<div class="mf-form">
      <div class="field wide"><label>试卷文件（.docx，格式同「Word 导入」：题号、选项 A.、答案另起一行）</label><input id="ipFile" type="file" accept=".docx"></div>
      <div class="field wide"><label>卷名（留空用文件名）</label><input id="ipTitle" class="inp" placeholder="如：2024年南京市中考数学真题"></div>
      <div class="field"><label>学科</label><select id="ipSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>学段</label><select id="ipStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="field"><label>年级</label><select id="ipGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
      <div class="field"><label>教材版本</label><select id="ipEdition"><option value="">未指定</option></select></div>
      <div class="field"><label>册别</label><select id="ipTerm">${mfTermOptions()}</select></div>
      <div class="field"><label>年份</label><input id="ipYear" class="inp" maxlength="4" placeholder="${yr - 1}"></div>
      <div class="field"><label>试卷类型</label><select id="ipCategory">${mfExamOptions()}</select></div>
      <div class="field"><label>文件夹</label><select id="ipFolder"><option value="">未分类</option>${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div>
      <div class="field wide"><span class="hint">试卷先保存为草稿，题目进入待审核；全部入库后可发布。</span></div>
      <div class="field wide" id="ipSum"><span class="hint">选好文件后点「识别预览」：先看识别出多少题、哪些格式不对，确认没问题再生成。题目会同时进入题库（来源：真题试卷）。</span></div>
    </div>`,
    onMount: (w) => {
      mfEditionFields(w, '#ipSub', '#ipStage', '#ipEdition');
      w.querySelector('#ipFile').onchange = () => { previewed = false; w.querySelector('#mOk').textContent = '识别预览'; };
    },
    onOk: async (w, showErr) => {
      const f = w.querySelector('#ipFile').files[0];
      if (!f) return showErr('请先选择 .docx 试卷文件');
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', w.querySelector('#ipTitle').value.trim());
      fd.append('subject', w.querySelector('#ipSub').value);
      fd.append('stage', w.querySelector('#ipStage').value);
      fd.append('grade', w.querySelector('#ipGrade').value);
      fd.append('edition', w.querySelector('#ipEdition').value);
      fd.append('term', w.querySelector('#ipTerm').value);
      fd.append('year', w.querySelector('#ipYear').value.trim());
      fd.append('exam_category', w.querySelector('#ipCategory').value);
      fd.append('folder_id', w.querySelector('#ipFolder').value);
      fd.append('dry_run', previewed ? '0' : '1');
      let r;
      try { r = await api(MF_API + '/papers/import-word', { method: 'POST', body: fd, raw: true, silent: true }); }
      catch (e) { return showErr(e.message || '识别失败'); }
      if (!previewed) {
        const errs = (r.errors || []).slice(0, 8).map((e) => `<li>第 ${e.para} 段（第 ${e.no} 题）：${esc(e.msg)}</li>`).join('');
        w.querySelector('#ipSum').innerHTML = `<div class="mf-tip"><b>识别出 ${r.total} 题</b>（${r.big_count} 道大题）：${(r.sections || []).map((x) => `${esc(x.name)} ${x.count} 题`).join('，')}。
          ${r.error_count ? `<br><span style="color:#d93025">另有 ${r.error_count} 题格式不对，不会导入：</span><ul style="margin:4px 0 0 18px">${errs}</ul>` : '<br>格式全部通过。'}
          <br>确认无误后生成草稿。题目会进入待审核，全部入库后可发布。</div>${(r.sample || []).length ? `<div class="mf-tip"><b>识别结果预览（前 ${r.sample.length} 题）</b>${r.sample.map((q,i) => `<div style="padding:8px 0;border-top:1px solid #e4e9f2;white-space:pre-wrap"><b>${i+1}. ${esc(q.type)}</b> ${esc(q.stem)}${(q.options||[]).map(o=>`<div>${esc(o.label)}. ${esc(o.content)}</div>`).join('')}</div>`).join('')}</div>` : ''}`;
        previewed = true; w.querySelector('#mOk').textContent = '生成试卷';
        return false;
      }
      toast(`已生成草稿，${r.total} 题已进入待审核`, 'ok');
      location.hash = '#/pending';
    },
  });
}

/** 试卷详情：题序 / 分值 / 文本块 / 排版 / 预览导出 */
async function mfPaperDetail(id) {
  const load = async () => (await api(`${MF_API}/papers/${id}`));
  let d = await load();
  const L = d.paper.layout || {};
  const fields = L.fieldVisibility || {};
  const render = () => {
    const rows = d.rows.map((r, i) => r.kind === 'text'
      ? `<tr><td>${i + 1}</td><td colspan="4"><b>【文本块】</b>${esc(r.text_body)}</td>
          <td><button class="btn ghost xs" data-edit-text="${r.id}">编辑</button><button class="btn ghost xs" data-up="${r.id}">↑</button><button class="btn ghost xs" data-down="${r.id}">↓</button>
          <button class="btn ghost xs" data-rm="${r.id}">删</button></td></tr>`
      : `<tr><td>${i + 1}</td><td>${esc((r.question && r.question.stem || '（题目已删除）').slice(0, 90))}</td>
          <td>${MF_TYPE_NAME[r.question && r.question.type] || ''}</td>
          <td><input aria-label="题目满分" class="inp xs" style="width:70px" type="number" min="0" step="0.01" value="${r.score || 0}" data-score="${r.id}">${r.question && r.question.type === 'multi' ? `<label style="display:block;font-size:12px">少选分 <input aria-label="少选且所选均正确时的分值" class="inp xs" style="width:70px" type="number" min="0" step="0.01" placeholder="未设置" value="${r.partial_score == null ? '' : Number(r.partial_score)}" data-partial-score="${r.id}"></label>` : ''}</td>
          <td>${r.question ? (r.question.subject || '-') : ''}</td>
          <td><button class="btn ghost xs" data-up="${r.id}">↑</button><button class="btn ghost xs" data-down="${r.id}">↓</button>
          <button class="btn ghost xs" data-rm="${r.id}">删</button></td></tr>`).join('');
    return rows;
  };
  const body = `<div class="mf-paperedit">
    <div class="row" style="justify-content:space-between">
      <b>${esc(d.paper.title)}</b>
      <span><button class="btn ghost sm" id="peAddQ">从题库加题</button>
        <button class="btn ghost sm" id="peText">插入文本块</button>
        <button class="btn ghost sm" id="peLayout">排版设置</button>
        <button class="btn sm" id="pePrev">预览 / 打印</button></span>
    </div>
    <p class="hint">多选题少选分留空时只对全选正确给分；设置后只选对部分且没有错选时给填写的分值。</p>
    <table class="tb"><thead><tr><th style="width:40px">序</th><th>题干</th><th style="width:70px">题型</th><th style="width:110px">分值</th><th style="width:80px">学科</th><th style="width:140px">操作</th></tr></thead>
      <tbody id="peRows">${render()}</tbody></table>
    <div class="row"><button class="btn ghost sm" id="peExport">导出 HTML（教师版）</button>
      <button class="btn ghost sm" id="peDoc">导出 Word(.doc)</button>
      <button class="btn ghost sm" id="peArchive">归档到对象存储</button></div>
  </div>`;
  modal({
    title: '试卷编辑', wide: true, okText: '完成', body,
    onMount: (w) => {
      const refresh = async () => { d = await load(); w.querySelector('#peRows').innerHTML = render(); bind(); };
      const bind = () => {
        w.querySelectorAll('[data-edit-text]').forEach((b) => {
          b.onclick = () => {
            const row = d.rows.find((r) => Number(r.id) === Number(b.dataset.editText) && r.kind === 'text');
            if (!row) return;
            modal({ title: '编辑文本块', body: `<div class="field"><label>内容</label><textarea id="ptEditBody" class="inp" rows="4">${esc(row.text_body || '')}</textarea></div>`,
              onOk: async (ww, showErr) => {
                const value = ww.querySelector('#ptEditBody').value;
                if (!value.trim()) return showErr('文本块内容不能为空');
                await api(`${MF_API}/papers/${id}/rows/${row.id}`, { method: 'PUT', body: { text_body: value } });
                await refresh();
              } });
          };
        });
        w.querySelectorAll('[data-score]').forEach((inp) => {
          inp.onchange = async () => { try { await api(`${MF_API}/papers/${id}/rows/${inp.dataset.score}`, { method: 'PUT', body: { score: inp.value === '' ? '' : Number(inp.value) } }); await refresh(); } catch (_) { await refresh(); } };
        });
        w.querySelectorAll('[data-partial-score]').forEach((inp) => {
          inp.onchange = async () => { try { await api(`${MF_API}/papers/${id}/rows/${inp.dataset.partialScore}`, { method: 'PUT', body: { partial_score: inp.value === '' ? null : Number(inp.value) } }); await refresh(); } catch (_) { await refresh(); } };
        });
        w.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { await api(`${MF_API}/papers/${id}/rows/${b.dataset.rm}`, { method: 'DELETE' }); refresh(); }; });
        w.querySelectorAll('[data-up],[data-down]').forEach((b) => {
          b.onclick = async () => {
            const rid = Number(b.dataset.up || b.dataset.down);
            const idx = d.rows.findIndex((r) => r.id === rid);
            const to = b.dataset.up ? idx - 1 : idx + 1;
            if (idx < 0 || to < 0 || to >= d.rows.length) return;
            const ids = d.rows.map((r) => r.id);
            [ids[idx], ids[to]] = [ids[to], ids[idx]];
            await api(`${MF_API}/papers/${id}/reorder`, { method: 'PUT', body: { ids } });
            refresh();
          };
        });
      };
      bind();
      w.querySelector('#peAddQ').onclick = () => mfPickQuestions(async (qids) => {
        await api(`${MF_API}/papers/${id}/questions`, { method: 'POST', body: { question_ids: qids } });
        toast(`已加入 ${qids.length} 题`, 'ok'); refresh();
      });
      w.querySelector('#peText').onclick = () => {
        modal({ title: '插入文本块', body: `<div class="field"><label>内容（如：一、选择题）</label><input id="ptBody" class="inp"></div>
          <div class="field"><label>对齐</label><select id="ptAlign"><option value="left">左</option><option value="center">居中</option></select></div>`,
          onOk: async (ww) => { await api(`${MF_API}/papers/${id}/text`, { method: 'POST', body: { text_body: ww.querySelector('#ptBody').value.trim(), text_align: ww.querySelector('#ptAlign').value } }); refresh(); } });
      };
      w.querySelector('#peLayout').onclick = () => mfLayoutForm(id, d.paper.layout || {}, async () => { d = await load(); });
      w.querySelector('#pePrev').onclick = async () => {
        const r = await api(`${MF_API}/papers/${id}/preview?mode=teacher`);
        const win = window.open('', '_blank'); win.document.write(r.html); win.document.close();
      };
      const download = async (ext, mime) => {
        const r = await api(`${MF_API}/papers/${id}/export?mode=teacher`);
        const blob = new Blob([r.html], { type: mime });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${d.paper.title}.${ext}`; a.click();
      };
      w.querySelector('#peExport').onclick = () => download('html', 'text/html;charset=utf-8');
      w.querySelector('#peDoc').onclick = () => download('doc', 'application/msword');
      w.querySelector('#peArchive').onclick = async () => {
        const r = await api(`${MF_API}/papers/${id}/archive`, { method: 'POST' });
        toast('已归档：' + r.key, 'ok');
      };
    },
  });
}

/** 从题库挑题（供试卷加题用） */
async function mfPickQuestions(onPick) {
  const st = mfState('mfpick');
  const data = await api(`${MF_API}/questions?page=1&size=20&kw=${encodeURIComponent(st.kw || '')}&subject=${encodeURIComponent(st.subject || '')}&type=${encodeURIComponent(st.type || '')}`);
  modal({
    title: '从题库挑题', wide: true, okText: '加入',
    body: `<div class="bk-filters">
      <input id="pkKw" class="inp" placeholder="关键词" value="${esc(st.kw || '')}">
      <select id="pkSub"><option value="">全部学科</option>${MF_SUBJECTS.map((s) => `<option ${st.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="pkType"><option value="">全部题型</option>${MF_TYPES.map(([k, t]) => `<option value="${k}" ${st.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn sm" id="pkGo">搜</button></div>
      <div class="mf-pick">${data.list.map((q) => `<label class="mf-pickitem">
        <input type="checkbox" class="pkck" value="${q.id}">
        <span><b>${MF_TYPE_NAME[q.type] || q.type}</b> ${esc((q.stem || '').slice(0, 120))}</span></label>`).join('') || '<div class="empty">没有匹配的题</div>'}</div>`,
    onMount: (w) => {
      w.querySelector('#pkGo').onclick = async () => {
        st.kw = w.querySelector('#pkKw').value.trim();
        st.subject = w.querySelector('#pkSub').value;
        st.type = w.querySelector('#pkType').value;
        const nd = await api(`${MF_API}/questions?page=1&size=20&kw=${encodeURIComponent(st.kw)}&subject=${encodeURIComponent(st.subject)}&type=${encodeURIComponent(st.type)}`);
        w.querySelector('.mf-pick').innerHTML = nd.list.map((q) => `<label class="mf-pickitem">
          <input type="checkbox" class="pkck" value="${q.id}">
          <span><b>${MF_TYPE_NAME[q.type] || q.type}</b> ${esc((q.stem || '').slice(0, 120))}</span></label>`).join('') || '<div class="empty">没有匹配的题</div>';
      };
    },
    onOk: async (w) => {
      const ids = [...w.querySelectorAll('.pkck:checked')].map((c) => Number(c.value));
      if (!ids.length) return false;
      await onPick(ids);
    },
  });
}

/** 试卷排版参数 */
async function mfLayoutForm(id, L, done) {
  const m = L.pageMarginMm || {};
  const f = L.fieldVisibility || {};
  modal({
    title: '排版设置', wide: true,
    body: `<div class="mf-form">
      <div class="field"><label>纸张</label><select id="lySize"><option value="A4" ${L.pageSize === 'A4' ? 'selected' : ''}>A4</option><option value="A3" ${L.pageSize === 'A3' ? 'selected' : ''}>A3</option></select></div>
      <div class="field"><label>方向</label><select id="lyOri"><option value="portrait" ${L.orientation !== 'landscape' ? 'selected' : ''}>纵向</option><option value="landscape" ${L.orientation === 'landscape' ? 'selected' : ''}>横向</option></select></div>
      <div class="field"><label>分栏</label><select id="lyCol"><option value="1" ${Number(L.columns) === 1 ? 'selected' : ''}>1 栏</option><option value="2" ${Number(L.columns) === 2 ? 'selected' : ''}>2 栏</option></select></div>
      <div class="field"><label>字号(pt)</label><input id="lyFont" class="inp" type="number" value="${L.fontSize || 12}"></div>
      <div class="field"><label>行距</label><input id="lyLh" class="inp" type="number" step="0.1" value="${L.lineHeight || 1.6}"></div>
      <div class="field"><label>上边距(mm)</label><input id="lyMt" class="inp" type="number" value="${m.top || 20}"></div>
      <div class="field"><label>下边距(mm)</label><input id="lyMb" class="inp" type="number" value="${m.bottom || 20}"></div>
      <div class="field"><label>左/右(mm)</label><input id="lyMl" class="inp" type="number" value="${m.left || 15}"><input id="lyMr" class="inp" type="number" value="${m.right || 15}"></div>
      <div class="field wide"><label>卷头标题</label><input id="lyTitle" class="inp" value="${esc(L.header && L.header.title || '')}" placeholder="留空用卷名"></div>
      <div class="field"><label>显示题号</label><select id="lyNo"><option value="1" ${f.questionNo !== false ? 'selected' : ''}>是</option><option value="0" ${f.questionNo === false ? 'selected' : ''}>否</option></select></div>
      <div class="field"><label>显示分值</label><select id="lyScore"><option value="1" ${f.score ? 'selected' : ''}>是</option><option value="0" ${!f.score ? 'selected' : ''}>否</option></select></div>
      <div class="field"><label>显示答案</label><select id="lyAns"><option value="1" ${f.answer ? 'selected' : ''}>是</option><option value="0" ${!f.answer ? 'selected' : ''}>否</option></select></div>
      <div class="field"><label>显示解析</label><select id="lyAna"><option value="1" ${f.analysis ? 'selected' : ''}>是</option><option value="0" ${!f.analysis ? 'selected' : ''}>否</option></select></div>
      <div class="field"><label>选项版式</label><select id="lyOpt"><option value="auto" ${(L.optionsLayout || 'auto') === 'auto' ? 'selected' : ''}>自动</option><option value="single-line" ${L.optionsLayout === 'single-line' ? 'selected' : ''}>一行一个</option><option value="two-lines" ${L.optionsLayout === 'two-lines' ? 'selected' : ''}>两列</option></select></div>
      <div class="field"><label>作答区</label><select id="lySpace"><option value="0" ${!(L.answerSpace || {}).enabled ? 'selected' : ''}>不留</option><option value="1" ${(L.answerSpace || {}).enabled ? 'selected' : ''}>留白</option></select></div>
      <div class="field"><label>留白高度(mm)</label><input id="lySpaceH" class="inp" type="number" value="${(L.answerSpace || {}).lineHeightMm || 10}"></div>
    </div>`,
    onOk: async (w) => {
      const layout = {
        ...L,
        pageSize: w.querySelector('#lySize').value,
        orientation: w.querySelector('#lyOri').value,
        columns: Number(w.querySelector('#lyCol').value),
        fontSize: Number(w.querySelector('#lyFont').value) || 12,
        lineHeight: Number(w.querySelector('#lyLh').value) || 1.6,
        pageMarginMm: {
          top: Number(w.querySelector('#lyMt').value) || 20, bottom: Number(w.querySelector('#lyMb').value) || 20,
          left: Number(w.querySelector('#lyMl').value) || 15, right: Number(w.querySelector('#lyMr').value) || 15,
        },
        header: { style: 'exam', title: w.querySelector('#lyTitle').value.trim(), lines: (L.header || {}).lines || [] },
        fieldVisibility: {
          questionNo: w.querySelector('#lyNo').value === '1',
          score: w.querySelector('#lyScore').value === '1',
          answer: w.querySelector('#lyAns').value === '1',
          analysis: w.querySelector('#lyAna').value === '1',
        },
        optionsLayout: w.querySelector('#lyOpt').value,
        answerSpace: { enabled: w.querySelector('#lySpace').value === '1', lineHeightMm: Number(w.querySelector('#lySpaceH').value) || 10 },
      };
      await api(MF_API + '/papers/' + id, { method: 'PUT', body: { layout } });
      toast('排版已保存', 'ok');
      if (done) await done();
    },
  });
}

/* ================================================================= 录题上传（一比一复刻魔方助手「录题工作台」）
 * 拖拽 / 点选 / Ctrl+V 粘贴上传（图片 · PDF · Word）→ 批次 → 工作台：
 * 左栏页图在线查看（缩略图 + 大图翻页缩放 + 按页 OCR 转写），右栏题卡流。
 * ✨全自动：逐页整页视觉识别直接出结构化题卡；◐半自动：OCR 转写全文 → 文本整理成题卡（可逐处微调）；
 * ✂ 手动：「+ 空白题卡」兜底。校对勾选后一键入库（挂知识树 / 进试卷）。 */

const MF_CARD_TYPES = ['单选', '多选', '填空', '判断', '解答'];

async function viewMfIntake() {
  const runs = (await api(MF_API + '/intake/runs', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const kindName = { pdf: 'PDF', image: '图片', word: 'Word' };
  const statusMap = { draft: '待识别', recognized: '待校对', done: '已入库', error: '识别失败' };
  const html = `<div class="card"><div class="card-h"><h3>${ic('upload')} 录题上传</h3>
      <div class="card-h-r"><button class="btn primary sm" id="miNew">${ic('plus')} 新建录题批次</button></div></div>
    <div class="card-b">
      <div class="mf-tip">拍照 / 截图 / PDF / Word 都行：PDF 自动逐页转成图片，AI 识别成结构化题卡——
        <b>全自动</b>逐页一步出卡，<b>◐半自动</b>先转写全文再整理成卡。识别结果先保存为草稿，再到待审核核对内容和分类；AI 答案与解析须分别确认。</div>
      ${runs.length ? `<table class="tb"><thead><tr><th>批次</th><th style="width:90px">来源</th><th style="width:70px">页数</th><th style="width:70px">题卡</th><th style="width:90px">状态</th><th style="width:180px">操作</th></tr></thead>
        <tbody>${runs.map((r) => `<tr><td>${esc(r.title)}</td><td>${kindName[r.source_kind] || r.source_kind}</td><td>${r.page_count}</td><td>${r.draft_count}</td>
          <td><span class="tag ${r.status === 'error' ? 'err' : ''}">${r.processing ? '正在处理' : statusMap[r.status] || r.status}</span></td>
          <td><button class="btn ghost xs" data-open="${r.id}">打开工作台</button>
              <button class="btn ghost xs" data-delr="${r.id}">删</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">还没有批次，点右上角新建一个</div>'}
    </div></div>`;

  return {
    html,
    after: () => {
      document.getElementById('miNew').onclick = () => {
        modal({
          title: '新建录题批次', body: `<div class="mf-form">
            <div class="field"><label>批次名</label><input id="irName" class="inp" placeholder="如：八上数学第三单元测试卷"></div>
            <div class="field"><label>学科</label><select id="irSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
            <div class="field"><label>学段</label><select id="irStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
            <div class="field"><label>年级</label><select id="irGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
          </div>`,
          okText: '创建并进入工作台',
          onOk: async (w) => {
            const r = await api(MF_API + '/intake/runs', {
              method: 'POST',
              body: { title: w.querySelector('#irName').value.trim(), subject: w.querySelector('#irSub').value, stage: w.querySelector('#irStage').value, grade: w.querySelector('#irGrade').value },
            });
            toast('已创建，接着上传页图 / Word', 'ok');
            mfIntakeWork(r.id);
          },
        });
      };
      document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => mfIntakeWork(Number(b.dataset.open)); });
      document.querySelectorAll('[data-delr]').forEach((b) => { b.onclick = async () => {
        if (!(await elConfirm({ title: '删除批次', message: '确定删除这个录题批次？', okText: '删除', danger: true }))) return;
        await api(`${MF_API}/intake/runs/${b.dataset.delr}`, { method: 'DELETE' }); toast('已删除', 'ok'); render();
      }; });
    },
  };
}

/* ---------------- 工作台 ---------------- */

/** 题卡 HTML（右栏一卡）；cats = { chapters:[{id,name,grade,term}], points:[名] } 题库分类清单 */
function mfCardHtml(c, i, cats) {
  if (c._merged_into) {
    const target = mfCardSnap.findIndex(x => x && x._ai_card_id && x._ai_card_id === c._merged_into.card_id);
    return `<div class="mf-card2 mf-wk-card" data-ci="${i}"><div class="mf-wk-chead"><b>第 ${i + 1} 张：${target >= 0 ? `已合并到第 ${target + 1} 张` : '已合并'}</b><span class="mf-wk-cmeta">原片段已保留，只读归档</span></div></div>`;
  }
  if (c.committed) return `<div class="mf-card2 mf-wk-card" data-ci="${i}"><div class="mf-wk-chead"><b>第 ${i + 1} 张：已入库</b><span class="mf-wk-cmeta">原片段已保留，只读归档</span></div></div>`;
  const types = MF_CARD_TYPES.includes(c.questionType) ? MF_CARD_TYPES : [c.questionType || '解答'].concat(MF_CARD_TYPES);
  const figs = (c.figures || []).filter(Boolean).map((f) => (typeof f === 'string' ? { url: f } : f)).filter((f) => f.url);
  cats = cats || { chapters: [], points: [] };
  const cid = Number(c.chapter_id) || 0;
  const chInList = cats.chapters.some((ch) => Number(ch.id) === cid);
  const pt = String(c.point || '').trim();
  const ptInList = !pt || cats.points.includes(pt);
  const df = Math.min(5, Math.max(1, Number(c.difficulty) || 3));
  const suggestion = c.ai_answer_suggestion || null;
  const legacyPending = !c.ai_legacy_reviewed && (c.ai_filled || (!c._ai_review_schema && (Number(c.page) > 0 || ['semi', 'word'].includes(c.via)) && (String(c.answer || '').trim() || String(c.analysis || '').trim())));
  return `<div class="mf-card2 mf-wk-card" data-ci="${i}">
    <div class="mf-wk-chead"><label><input type="checkbox" class="wkck" value="${i}" ${c.checked === false ? '' : 'checked'}> 第 ${i + 1} 张</label>
      <span class="mf-wk-cmeta">${[c.page ? `第${c.page}页` : '', c.qno ? `题号 ${esc(String(c.qno))}` : '', c.via === 'semi' ? '◐ 半自动' : (c.via === 'word' ? 'Word' : ''), legacyPending ? '历史来源待核对' : ''].filter(Boolean).join(' · ')}</span>
      <span class="sp"></span><button class="btn ghost xs" data-aifill="${i}" title="生成需老师确认的答案或解析建议">AI 建议</button><button class="btn ghost xs" data-delcard="${i}">删</button></div>
    <div class="mf-wk-cgrid">
      <div class="field"><label>题型</label><select class="inp" data-f="questionType" data-i="${i}">${types.map((t) => `<option ${c.questionType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field wide"><label>分类（题库）：课本章节 · 知识点 · 难度</label><div class="mf-wk-cls">
        <select class="inp cls-ch" data-f="chapter_id" data-i="${i}"><option value="">章节不设</option>${cats.chapters.map((ch) => `<option value="${ch.id}" ${Number(ch.id) === cid ? 'selected' : ''}>${esc(ch.name)}${ch.grade ? '·' + esc(ch.grade) : ''}${ch.term ? esc(ch.term) : ''}</option>`).join('')}${cid && !chInList ? `<option value="${cid}" selected>章节 #${cid}</option>` : ''}</select>
        <select class="inp cls-pt" data-f="point" data-i="${i}"><option value="">知识点不设</option>${cats.points.map((p) => `<option ${p === pt ? 'selected' : ''}>${esc(p)}</option>`).join('')}${!ptInList ? `<option selected>${esc(pt)}</option>` : ''}</select>
        <select class="inp cls-df" data-f="difficulty" data-i="${i}" title="难度">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === df ? 'selected' : ''}>难度${n}</option>`).join('')}</select>
      </div></div>
      <div class="field wide"><label>题干</label><textarea class="inp" rows="3" data-f="stem" data-i="${i}">${esc(c.stem || '')}</textarea></div>
      ${figs.length ? `<div class="field wide"><label>插图（${figs.length}，题干中对应 [图N]）</label><div class="mf-wk-figs">${figs.map((f, k) => `<img class="mf-wk-fig" src="${f.url}" loading="lazy" data-cfig="${i}" data-fidx="${k}" alt="插图${f.n || k + 1}">`).join('')}</div></div>` : ''}
      <div class="field wide"><label>选项（一行一个，如 A. xxx）</label><textarea class="inp" rows="2" data-f="options" data-i="${i}">${esc((c.options || []).map(optDisplay).join('\n'))}</textarea></div>
      <div class="field wide"><label>答案</label><textarea class="inp" rows="1" data-f="answer" data-i="${i}">${esc(c.answer || '')}</textarea></div>
      <div class="field wide"><label>解析</label><textarea class="inp" rows="2" data-f="analysis" data-i="${i}">${esc(c.analysis || '')}</textarea></div>
    </div>${legacyPending ? '<div class="mf-tip">历史题目答案或解析的来源无法确认，请到待审核对照原文并确认后再入库。</div>' : ''}
    ${suggestion ? `<div class="mf-tip"><b>${suggestion.source === 'recognition' ? 'AI 转写内容（请对照原文核对，未经确认不会入库）' : 'AI 建议（未经确认，不会入库）'}</b>${suggestion.source !== 'recognition' ? '<p>建议仅依据题目文字生成，未读取题图；答案和解析可能不一致，请分别核对。</p>' : ''}${suggestion.answer ? `<div><b>答案建议：</b>${esc(suggestion.answer)} ${!String(c.answer || '').trim() ? `<button type="button" class="btn ghost xs" data-ai-accept="answer" data-ai-index="${i}">采纳答案</button>` : ''}</div>` : ''}${suggestion.analysis ? `<div><b>解析建议：</b>${esc(suggestion.analysis)} ${!String(c.analysis || '').trim() ? `<button type="button" class="btn ghost xs" data-ai-accept="analysis" data-ai-index="${i}">采纳解析</button>` : ''}</div>` : ''}</div>` : ''}</div>`;
}

/** 从右栏 DOM 收集题卡（编辑内容 + 勾选）；非输入型字段（页码/来源/插图）从快照回填 */
let mfCardSnap = [];
function mfCollectCards(root) {
  const out = [];
  root.querySelectorAll('.mf-wk-card').forEach((el) => {
    const i = Number(el.dataset.ci);
    const snap = mfCardSnap[i] || {};
    if (snap._merged_into || snap.committed) { out.push(snap); return; }
    const c = { ...snap, options: [], suggestedTags: snap.suggestedTags || [], figures: snap.figures || [], page: snap.page || 0, qno: snap.qno || '', via: snap.via || '' };
    el.querySelectorAll('[data-f]').forEach((f) => {
      const v = f.value;
      if (f.dataset.f === 'options') {
        c.options = v.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
          const m = /^([A-Ja-j])\s*[.、．]\s*(.*)$/.exec(s);
          return m ? { label: m[1].toUpperCase(), content: m[2] } : { label: '', content: s };
        });
      } else c[f.dataset.f] = v;
    });
    c.checked = !!el.querySelector('.wkck')?.checked;
    if (c._q) {
      c._q = { ...c._q, stem: c.stem, answer: c.answer, analysis: c.analysis, material: c.material || '',
        options: c.options.map((o) => ({ label: o.label, text: o.content })) };
      if (c._q.stem !== snap._q.stem) c._q.stem_html = '';
    }
    out.push(c);
  });
  return out;
}

/** 页图大图查看：在线翻页 + 滚轮缩放 */
function mfLightbox(urls, idx) {
  let cur = idx || 0;
  let scale = 1;
  const ov = document.createElement('div');
  ov.className = 'mf-lb'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true'); ov.setAttribute('aria-label','查看题图');
  const draw = () => {
    ov.querySelector('img').src = urls[cur];
    ov.querySelector('img').style.transform = `scale(${scale})`;
    ov.querySelector('.mf-lb-n').textContent = `${cur + 1} / ${urls.length}`;
  };
  ov.innerHTML = `<img src="" alt="">
    <div class="mf-lb-bar">
      <button class="btn ghost sm" data-a="prev">‹</button><span class="mf-lb-n"></span><button class="btn ghost sm" data-a="next">›</button>
      <span class="mf-lb-hint">滚轮缩放 · Esc 关闭</span>
      <button class="btn ghost sm" data-a="close">✕</button></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    const a = e.target.dataset.a || (e.target.closest('[data-a]') || {}).dataset?.a;
    if (a === 'prev' && cur > 0) { cur--; scale = 1; draw(); }
    else if (a === 'next' && cur < urls.length - 1) { cur++; scale = 1; draw(); }
    else if (a === 'close' || e.target === ov) ov.remove();
  });
  ov.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(5, Math.max(0.3, scale + (e.deltaY < 0 ? 0.15 : -0.15)));
    ov.querySelector('img').style.transform = `scale(${scale})`;
  }, { passive: false });
  const key = (e) => {
    if (!document.body.contains(ov)) return document.removeEventListener('keydown', key);
    if (e.key === 'Escape') ov.remove();
    else if (e.key === 'ArrowLeft' && cur > 0) { cur--; scale = 1; draw(); }
    else if (e.key === 'ArrowRight' && cur < urls.length - 1) { cur++; scale = 1; draw(); }
  };
  document.addEventListener('keydown', key);
  draw();
}

/** 文件上传：图片/PDF → 逐页转图上传；.docx → Word 导入；完成回调刷新 */
async function mfIntakeFiles(runId, files, after, options = {}) {
  const job = options.job || { entries: [], prepared: false };
  const notify = () => { if (options.onProgress) options.onProgress(job); };
  if (!job.prepared) {
    const entries = [];
    for (const f of files) {
      if (/\.docx$/i.test(f.name || '')) entries.push({ file: f, word: true, state: 'pending' });
      else if (/\.pdf$/i.test(f.name || '')) {
        if (!window.PdfPages) throw new Error('PDF 组件未加载，请刷新后重试');
        const result = await PdfPages.toCanvases(f, {maxPages:30,maxWidth:1600,onProgress:(done,total)=>{if(options.onConvert)options.onConvert(`${f.name}：${done}/${total} 页`);}});
        if (result.truncated) throw new Error(`${f.name} 超过 30 页，请拆分后上传`);
        const sourceDocumentKey = await R4Flow.filesKey([f]);
        for (const page of result.pages) {
          const blob = await new Promise(resolve => page.canvas.toBlob(resolve,'image/png'));
          if (!blob) throw new Error(`${f.name} 第 ${page.page} 页转换失败`);
          entries.push({file:new File([blob],`${f.name}-page-${page.page}.png`,{type:'image/png'}),state:'pending',source_document_key:sourceDocumentKey,source_page:page.page});page.canvas.width=page.canvas.height=0;
        }
      } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/i.test(f.name || '')) entries.push({file:f,state:'pending'});
      else throw new Error(`不支持的文件：${f.name || '未命名文件'}，请选择图片、PDF 或 .docx`);
    }
    if (!entries.length) throw new Error('没有可上传的页面');
    job.entries = entries; job.prepared = true;
  }
  for (const entry of job.entries) {
    if (entry.state === 'success') continue;
    if (entry.state === 'uncertain' && entry.word) throw new Error('Word 保存结果未确认，请先查看批次中的题卡，避免重复整理');
    entry.state = 'uploading'; entry.progress = 0; notify();
    try {
      await new Promise((resolve,reject)=>{
        const xhr = new XMLHttpRequest(); xhr.open('POST',`${MF_API}/intake/runs/${runId}/${entry.word?'word':'pages'}`);xhr.setRequestHeader('Authorization','Bearer '+Auth.token);xhr.responseType='json';
        xhr.upload.onprogress=e=>{if(e.lengthComputable){entry.progress=Math.round(e.loaded/e.total*100);notify();}};
        xhr.onload=()=>{const r=xhr.response || {};if(xhr.status>=200&&xhr.status<300&&r.code===0)resolve(r.data);else reject(new Error(r.msg || `上传失败（HTTP ${xhr.status}）`));};
        xhr.addEventListener('loadend',()=>{if(options.root && !options.root.isConnected)resolve(null);});
        xhr.onerror=()=>{const e=new Error('连接中断，保存结果未确认；已完成的页图不会重复上传');e.uncertain=true;reject(e);};
        const fd=new FormData();fd.append(entry.word?'file':'pages',entry.file,entry.file.name);if(entry.source_document_key){fd.append('source_document_key',entry.source_document_key);fd.append('source_page',String(entry.source_page));}
        R4Flow.send(xhr, options.root || document.getElementById('view'), entry.word?'word':'image',entry.file.name,runId,fd);
      });
      entry.state='success';entry.error='';notify();if(options.root && !options.root.isConnected)throw new Error('页面已关闭，已上传页面保留，未完成文件可重新选择');
    } catch(e) {entry.state=e.uncertain?'uncertain':'error';entry.error=e.message;notify();throw e;}
  }
  if (after) await after();
  return job;
}

async function mfIntakeWork(runId) {
  let run = (await api(`${MF_API}/intake/runs/${runId}`)).run;
  const view = document.getElementById('view');
  if (!Array.isArray(run.ocr_texts)) run.ocr_texts = [];
  let busy = false;
  let abortFlag = false, jobMessage = run.processing ? `服务器正在${({recognize:'识别',ocr:'转写',structure:'整理',word:'整理 Word',aifill:'生成建议'})[run.processing.action] || '处理'}${run.processing.page ? '第 ' + run.processing.page + ' 页' : ''}，当前页保存后可继续。` : run.error || '', workRoot = null, uploadJob = null;
  // 题库分类清单（课本章节 + 知识点）：工作台打开时拉一次
  let cats = { chapters: [], points: [] };
  try {
    const qs = `subject=${encodeURIComponent(run.subject || '')}&stage=${encodeURIComponent(run.stage || '')}&grade=${encodeURIComponent(run.grade || '')}`;
    const [chs, kb] = await Promise.all([
      api(`/api/admin/bank/chapters?subject=${encodeURIComponent(run.subject || '')}`, { silent: true }).catch(() => ({})),
      api(`/api/admin/bank/kbtree?${qs}`, { silent: true }).catch(() => ({})),
    ]);
    cats = {
      chapters: (chs.list || chs || []),
      points: (kb.points && kb.points.length) ? kb.points : ((kb.list || []).flatMap((u) => (u.points || []).map((p) => p.name))),   // T4：来自知识点树
    };
  } catch (e) { /* 分类清单拉不到也不影响录题 */ }

  const draw = () => {
    const pages = run.pages || [];
    const cards = run.drafts || [];
    const ocrs = run.ocr_texts || [];
    mfCardSnap = cards;
    const isWord = !pages.length && run.source_kind === 'word';
    const leftTitle = pages.length ? `页图（${pages.length}）` : (isWord ? 'Word 原文' : '页图（0）');
    view.innerHTML = `
    <div class="card mf-wk-top"><div class="card-b">
      <div class="mf-wk-bar" style="display:flex;flex-wrap:wrap;row-gap:8px">
        <button class="btn ghost sm" id="wkBack">← 返回列表</button>
        <b class="mf-wk-title">${esc(run.title)}</b>
        <select class="inp" id="wkSub">${MF_SUBJECTS.map((s) => `<option ${run.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select class="inp" id="wkStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}" ${run.stage === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <span class="sp"></span>
        <button class="btn ghost sm" id="wkUpload">${ic('upload')} 上传页图 / PDF</button>
        <button class="btn ghost sm" id="wkWord">W 导入 Word</button>
        <button class="btn primary sm" id="wkAuto"> 全自动识别</button>
        <button class="btn sm" id="wkSemi">◐ 半自动转写</button>
        <button class="btn ghost sm" id="wkAllStruct">全部整理成题卡</button>
        <button class="btn sm" id="wkAiFill" title="生成需要老师确认的答案或解析建议">AI 生成答案/解析建议</button>
        <button class="btn danger sm ghost" id="wkDel">删除批次</button>
      </div>
      <div class="mf-wk-hint">把图片 / PDF / Word 拖到左栏，或 <b>Ctrl+V</b> 粘贴截图 · 全自动逐页识别出卡 · ◐半自动先转写全文，点每页「整理成题卡」或「全部整理成题卡」</div>
      <p class="r4-excel-note" role="status">${esc(jobMessage)}</p>
      <div id="wkTransfer" class="r4-transfer-list" aria-live="polite">${uploadJob ? uploadJob.entries.map(e=>`<div><strong>${esc(e.file.name)}</strong><span>${e.state==='success'?'已保存':e.state==='pending'?'等待上传':esc(e.error || '等待重试')}</span></div>`).join('') : ''}</div>
      ${uploadJob && uploadJob.entries.some(e=>['error','uncertain'].includes(e.state)) ? '<button type="button" class="btn ghost sm" id="wkUploadRetry">重试未完成上传</button>' : ''}
      <div class="mf-wk-prog" id="wkProg" style="display:none"><div class="mf-wk-prog-t"><i></i></div><span id="wkProgTxt"></span></div>
    </div></div>
    <div class="mf-wk-body">
      <div class="card mf-wk-left"><div class="card-h"><h3>${leftTitle}</h3></div>
        <div class="card-b mf-wk-pages" id="wkPages">
          ${pages.length ? pages.map((p, i) => `<div class="mf-wk-page">
            <div class="mf-wk-phead"><b>第 ${i + 1} 页</b><span class="sp"></span>
              <button class="btn ghost xs" data-ocr="${i + 1}">${ocrs[i] ? '重新转写' : '转写'}</button></div>
            <img src="${p.url}" loading="lazy" data-big="${i}" alt="第${i + 1}页">
            <details class="mf-wk-ocr" ${ocrs[i] ? 'open' : ''}><summary>转写文本</summary>
              <textarea class="inp" id="wkOcr${i + 1}" rows="5" placeholder="点「转写」把这一页全文转成文字，可手动修正后整理成题卡">${esc(ocrs[i] || '')}</textarea>
              <div class="mf-wk-ocrbtn"><button class="btn ghost xs" data-struct="${i + 1}">整理成题卡</button></div></details>
          </div>`).join('') : (isWord && ocrs.length ? `<div class="mf-wk-page">
            <div class="mf-wk-phead"><b>${esc(run.source_name || 'Word 文档')}</b><span class="sp"></span>
              <button class="btn ghost xs" data-struct="1">重新整理成题卡</button></div>
            <textarea class="inp" id="wkOcr1" rows="26" placeholder="Word 原文会显示在这里，可手动修正后整理成题卡">${esc(ocrs[0] || '')}</textarea>
          </div>` : (isWord ? '<div class="empty">Word 导入不走页图——文字已直接解析成右侧题卡。<br>本批次未保留 Word 原文（较早导入），如需查看原文请新建批次重新导入。</div>' : '<div class="empty">还没有页图——把 PDF / 图片 / Word 拖到这里，或点上方「上传页图 / PDF」「导入 Word」</div>'))}
        </div></div>
      <div class="mf-wk-split" id="wkSplit" tabindex="0" title="拖动调整左右宽度；也可点击选中后按 ←/→ 微调"></div>
      <div class="card mf-wk-right"><div class="card-h"><h3>题卡（${cards.length}）</h3>
          <div class="card-h-r"><button class="btn ghost sm" id="wkAddCard">+ 空白题卡</button>
            <button class="btn ghost sm" id="wkAsPaper">保存为试卷草稿</button><button class="btn primary sm" id="wkCommit">保存并前往待审核</button></div></div>
        <div id="wkSkeleton" class="r4-recognition-skeleton" aria-hidden="true" ${run.processing ? '' : 'hidden'}><i></i><i></i><i></i></div><div class="card-b mf-wk-cards" id="wkCards">
          ${cards.length ? cards.map((c, i) => mfCardHtml(c, i, cats)).join('') : '<div class="empty">还没有题卡——全自动识别、◐半自动整理，或「+ 空白题卡」手动录</div>'}
        </div></div>
    </div>`;

    /* ---- 顶栏 ---- */
    view.querySelector('#wkBack').onclick = () => render();
    view.querySelector('#wkUpload').onclick = () => mfPickFiles();
    if (view.querySelector('#wkUploadRetry')) view.querySelector('#wkUploadRetry').onclick = () => uploadDropped([], true);
    view.querySelector('#wkWord').onclick = () => mfPickFiles(true);
    view.querySelector('#wkAuto').onclick = autoRecognize;
    view.querySelector('#wkSemi').onclick = semiOcr;
    view.querySelector('#wkAllStruct').onclick = structureAll;
    view.querySelector('#wkDel').onclick = async () => {
      if (!(await elConfirm({ title: '删除批次', message: '确定删除整个录题批次（含页图记录与题卡）？', okText: '删除', danger: true }))) return;
      await api(`${MF_API}/intake/runs/${runId}`, { method: 'DELETE' });
      toast('已删除', 'ok'); render();
    };

    /* ---- 左栏：拖拽 / 点击大图 / 转写 / 整理 ---- */
    workRoot = view.firstElementChild;
    if(run.processing){
      view.querySelectorAll('#wkAuto,#wkSemi,#wkAllStruct,#wkUpload,#wkWord,#wkAiFill,#wkCards input,#wkCards textarea,#wkCards select,#wkCards button').forEach(el=>{el.disabled=true;});
      const processingRoot=workRoot;
      setTimeout(async()=>{if(!processingRoot.isConnected)return;try{const latest=(await api(`${MF_API}/intake/runs/${runId}`,{silent:true})).run;if(!processingRoot.isConnected)return;run=latest;jobMessage=run.processing?'服务器仍在处理当前页，已保存页面保留。':'当前页已处理完，请核对结果或继续剩余页面。';draw();}catch(e){if(processingRoot.isConnected){jobMessage='任务状态读取失败，请重新打开批次核对；不必重复上传。';run.processing=null;draw();}}},2000);
    }

    const pagesBox = view.querySelector('#wkPages');
    ['dragover', 'drop'].forEach((ev) => pagesBox.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop' && !busy) { const fs = [...(e.dataTransfer.files || [])]; if (fs.length) uploadDropped(fs); }
    }));
    pagesBox.querySelectorAll('[data-big]').forEach((el) => { el.onclick = () => mfLightbox(pages.map((p) => p.url), Number(el.dataset.big)); });
    pagesBox.querySelectorAll('[data-ocr]').forEach((b) => { b.onclick = () => ocrOne(Number(b.dataset.ocr), b); });
    pagesBox.querySelectorAll('[data-struct]').forEach((b) => { b.onclick = () => structureOne(Number(b.dataset.struct)); });

    /* ---- 右栏：编辑 / 删卡 / 加卡 / 入库 ---- */
    const cardsBox = view.querySelector('#wkCards');
    cardsBox.addEventListener('click', async (e) => {
      const accept = e.target.closest('[data-ai-accept]');
      if (accept) {
        if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
        const index = Number(accept.dataset.aiIndex), field = accept.dataset.aiAccept;
        const card = mfCardSnap[index];
        if (!card || !card.ai_answer_suggestion) return toast('建议已变化，请重新生成', 'err');
        busy = true;
        try {
          await saveCards();
          const r = await api(`${MF_API}/intake/runs/${runId}/aifill/confirm`, { method: 'POST', body: { index, token: card.ai_answer_suggestion.token, fields: [field] } });
          run.drafts[index] = r.card; toast('已采纳，题目仍需审核入库', 'ok'); draw();
        } catch (err) { /* api 已提示 */ }
        busy = false; return;
      }
      const fig = e.target.closest('[data-cfig]');
      if (fig) {
        const card = mfCardSnap[Number(fig.dataset.cfig)] || {};
        const urls = (card.figures || []).filter(Boolean).map((f) => (typeof f === 'string' ? f : f.url)).filter(Boolean);
        if (urls.length) mfLightbox(urls, Math.min(Number(fig.dataset.fidx) || 0, urls.length - 1));
        return;
      }
      const af = e.target.closest('[data-aifill]');
      if (af) { aiFill([Number(af.dataset.aifill)]); return; }
      const del = e.target.closest('[data-delcard]');
      if (del) {
        const i = Number(del.dataset.delcard);
        const next = mfCollectCards(cardsBox).filter((_, k) => k !== i);
        await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: next } });
        run.drafts = next; draw();
      }
    });
    view.querySelector('#wkAddCard').onclick = async () => {
      const next = mfCollectCards(cardsBox).concat([{ page: 0, qno: '', questionType: '解答', stem: '', options: [], answer: '', analysis: '', checked: true, via: 'manual' }]);
      await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: next } });
      run.drafts = next; draw();
      view.querySelector('#wkCards').scrollTop = view.querySelector('#wkCards').scrollHeight;
    };
    view.querySelector('#wkCommit').onclick = () => mfIntakeCommit();
    view.querySelector('#wkAsPaper').onclick = async () => {
      const cards = mfCollectCards(view.querySelector('#wkCards'));
      const active = cards.filter(c => !c._merged_into);
      if (!active.length || active.some(c => !String(c.stem || '').trim())) return toast('请先识别并检查每道题的题干', 'err');
      await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: cards } });
      modal({ title: '生成试卷草稿', okText: '保存并审核', body: `<div class="field"><label>试卷名称</label><input class="inp" id="wkPaperTitle" value="${esc(run.title)}"></div><div class="field"><label>年份（选填）</label><input class="inp" id="wkPaperYear" inputmode="numeric" maxlength="4"></div><div class="field"><label>试卷类型</label><select id="wkPaperCategory">${mfExamOptions()}</select></div><div class="field"><label>教材版本</label><select id="wkPaperEdition"><option value="">未指定</option></select></div><div class="field"><label>册别</label><select id="wkPaperTerm">${mfTermOptions()}</select></div><p class="hint">${active.length} 道题会进入待审核，审核通过后自动加入试卷；章节和知识点需在审核时核对。</p>`,
        onMount: async (w) => { const trees=await tpTrees('textbook'); const editions=tpEditions(trees,{kind:'textbook',subject:view.querySelector('#wkSub').value,stage:view.querySelector('#wkStage').value}).filter(Boolean); w.querySelector('#wkPaperEdition').innerHTML='<option value="">未指定</option>'+editions.map(e=>`<option value="${esc(e)}">${esc(e)}</option>`).join(''); },
        onOk: async (w, showErr) => {
          const title = w.querySelector('#wkPaperTitle').value.trim();
          if (!title) return showErr('请输入试卷名称');
          await api(`${MF_API}/papers/from-run`, { method:'POST', body:{ run_id:runId, title, year:w.querySelector('#wkPaperYear').value.trim(), exam_category:w.querySelector('#wkPaperCategory').value, edition:w.querySelector('#wkPaperEdition').value, term:w.querySelector('#wkPaperTerm').value, subject:view.querySelector('#wkSub').value, stage:view.querySelector('#wkStage').value } });
          toast('试卷草稿已创建，题目已进入待审核', 'ok'); location.hash = '#/pending';
        } });
    };
    view.querySelector('#wkAiFill').onclick = () => aiFill(null);

    /* ---- 拖拽分隔条：调整左右栏宽度（记忆到 localStorage） ---- */
    (function initSplit() {
      const body = view.querySelector('.mf-wk-body');
      const split = view.querySelector('#wkSplit');
      const saved = Number(localStorage.getItem('mfwkL')) || 480;
      body.style.setProperty('--mfwk-l', saved + 'px');
      const start = (e) => {
        e.preventDefault();
        try { split.focus(); } catch (err) { /* 忽略 */ }
        split.classList.add('on');
        document.body.style.cursor = 'col-resize';
        const move = (ev) => {
          const t = (ev.touches && ev.touches[0]) || ev;
          const rect = body.getBoundingClientRect();
          const w = Math.round(Math.min(rect.width * 0.7, Math.max(280, t.clientX - rect.left - 4)));
          body.style.setProperty('--mfwk-l', w + 'px');
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          split.classList.remove('on');
          document.body.style.cursor = '';
          const cur = parseInt(body.style.getPropertyValue('--mfwk-l'), 10);
          if (cur) localStorage.setItem('mfwkL', cur);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      };
      split.addEventListener('mousedown', start);
      split.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') start(e); });
      // 键盘步进：聚焦后 ←/→ 每次 ±30px
      split.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const cur = parseInt(body.style.getPropertyValue('--mfwk-l'), 10) || 480;
        const w = Math.min(body.getBoundingClientRect().width * 0.7, Math.max(280, cur + (e.key === 'ArrowRight' ? 30 : -30)));
        body.style.setProperty('--mfwk-l', Math.round(w) + 'px');
        localStorage.setItem('mfwkL', Math.round(w));
      });
    })();

    /* ---- AI 答案/解析建议：老师逐项确认后才写入题卡 ---- */
    async function aiFill(indexes) {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      busy = true;
      setProg(indexes ? '正在为该题生成建议…' : '正在批量生成答案/解析建议…', 0.4);
      try {
        await saveCards();
        const r = await api(`${MF_API}/intake/runs/${runId}/aifill`, { method: 'POST', body: { indexes: indexes || null } });
        run.drafts = r.drafts || run.drafts;
        toast(r.msg || 'AI 建议已生成，请逐项核对', 'ok');
      } catch (e) { /* api 已提示 */ }
      setProg(null); busy = false; draw();
    }

    /* ---- 文件选择 / 粘贴 ---- */
    function mfPickFiles(wordOnly) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = !wordOnly;
      input.accept = wordOnly ? '.docx' : 'image/*,application/pdf,.docx';
      input.onchange = () => { const fs = [...(input.files || [])]; if (fs.length) uploadDropped(fs); };
      input.click();
    }
    async function uploadDropped(fs, retry = false) {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      if (!retry) uploadJob = {entries:[],prepared:false};
      busy = true; let prepared = false;
      const locked = [...view.querySelectorAll('#wkCards input,#wkCards textarea,#wkCards select,#wkCards button')].map(el=>[el,el.disabled]);locked.forEach(([el])=>{el.disabled=true;});
      try {
        await saveCards(); prepared = true;
        await mfIntakeFiles(runId,fs,null,{job:uploadJob,root:workRoot,onConvert:t=>setProg(t,0),onProgress:job=>{
          if (!workRoot.isConnected) return;
          view.querySelector('#wkTransfer').innerHTML=job.entries.map(e=>`<div><strong>${esc(e.file.name)}</strong><span>${e.state==='success'?'已保存':e.state==='uploading'?`上传 ${e.progress}%`:e.state==='pending'?'等待上传':esc(e.error || '上传失败')}</span></div>`).join('');
        }});
        jobMessage='文件已保存，可继续识别或到待审核核对；上传成功不代表内容已核对。';
      } catch(e) {jobMessage=e.message || '上传失败，可重试未完成部分';}
      finally {
        busy=false;
        if(workRoot && workRoot.isConnected){
          if(prepared){try{run=(await api(`${MF_API}/intake/runs/${runId}`)).run;}catch(e){jobMessage+='；批次刷新失败，请重新打开核对';}if(workRoot.isConnected){setProg(null);draw();}}
          else {locked.forEach(([el,disabled])=>{el.disabled=disabled;});setProg(jobMessage,0);}
        }
      }
    }

    window.__mfWkUploadPaste = uploadDropped;
    if (!window.__mfWkPaste) {
      window.__mfWkPaste = (e) => {
        const fs = [...((e.clipboardData || {}).files || [])].filter((f) => /image|pdf/.test(f.type) || /\.docx$/i.test(f.name || ''));
        if (!fs.length) return;
        const wb = document.getElementById('wkPages');
        if (!wb) return;
        e.preventDefault();
        if (window.__mfWkUploadPaste) window.__mfWkUploadPaste(fs);
      };
      document.addEventListener('paste', window.__mfWkPaste);
    }

    /* ---- 进度条 ---- */
    function setProg(txt, ratio) {
      const box = view.querySelector('#wkProg');
      const skeleton=view.querySelector('#wkSkeleton');if(skeleton)skeleton.hidden=!(busy && txt && /识别|整理/.test(txt));
      if (!box) return;
      if (txt == null) { box.style.display = 'none'; return; }
      box.style.display = 'flex';
      box.querySelector('.mf-wk-prog-t>i').style.width = `${Math.round((ratio || 0.05) * 100)}%`;
      view.querySelector('#wkProgTxt').textContent = txt;
    }
    mfIntakeWork._setProg = setProg;

    /* ----  全自动：逐页识别（可中断，继续跑会跳过已出的页） ---- */
    async function autoRecognize() {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      if (!pages.length) return toast('先上传页图', 'err');
      busy = true; abortFlag = false;
      let prepared = false, activePage = 0;
      const locked = [...view.querySelectorAll('#wkCards input, #wkCards textarea, #wkCards button, #wkCards select')].map((el) => [el, el.disabled]);
      locked.forEach(([el]) => { el.disabled = true; });
      try {
        await saveCards(); prepared = true;
        if (!workRoot.isConnected) return;
        for (let i = 0; i < pages.length; i++) {
          if (abortFlag || !workRoot.isConnected) break;
          if (pages[i].recognition_complete) continue;
          view.querySelector('#wkAuto').textContent = '停止（当前页保存后暂停）';
          view.querySelector('#wkAuto').onclick = () => { abortFlag = true; };
          activePage = i + 1;
          setProg(`正在识别第 ${i + 1} / ${pages.length} 页…`, i / pages.length);
          const r = await api(`${MF_API}/intake/runs/${runId}/recognize`, { method: 'POST', body: { page: i + 1 } });
          if (!workRoot.isConnected) return;
          run.drafts = r.drafts || []; pages[i].recognition_complete = true;
          jobMessage = `第 ${i + 1} 页已保存，累计 ${run.drafts.length} 张题卡；内容仍须核对。`;
          // 不在任务执行中重新绘制编辑区，避免停止按钮和老师未保存的输入被替换。
        }
        if (abortFlag) jobMessage = '已暂停，已保存页面保留；继续识别将跳过完成页。';
        else if (pages.every((p) => p.recognition_complete)) jobMessage = '逐页处理完成；请到待审核核对内容，接口成功不代表识别正确。';
      } catch (e) { jobMessage = `${activePage ? '第 ' + activePage + ' 页处理' : '保存题卡'}失败：${e.message || e}。已保存的页面和当前题卡保留，可重试。`; }
      finally { busy = false; if (workRoot && workRoot.isConnected) { if (prepared) { setProg(null); draw(); } else { locked.forEach(([el, disabled]) => { el.disabled = disabled; }); setProg(jobMessage, 0); } } }
    }

    /* ---- ◐ 半自动：逐页 OCR 转写 ---- */
    async function semiOcr() {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      if (!pages.length) return toast('先上传页图', 'err');
      busy = true; abortFlag = false;
      try {
        for (let i = 0; i < pages.length; i++) {
          if (abortFlag || !workRoot.isConnected) break;
          if (String(run.ocr_texts[i] || '').trim()) continue;
          view.querySelector('#wkSemi').textContent = '停止（当前页保存后暂停）';
          view.querySelector('#wkSemi').onclick = () => { abortFlag = true; };
          setProg(`正在转写第 ${i + 1} / ${pages.length} 页…`, i / pages.length);
          const r = await api(`${MF_API}/intake/runs/${runId}/ocr`, { method: 'POST', body: { page: i + 1 } });
          run.ocr_texts[i] = r.text || '';
          if (!workRoot.isConnected) return;
          const ta = view.querySelector(`#wkOcr${i + 1}`);
          if (ta) { ta.value = run.ocr_texts[i]; ta.closest('details').open = true; }
        }
        jobMessage = abortFlag ? '转写已暂停，已保存的页文保留，可继续。' : '转写完成，可核对页文并整理成题卡。';
      } catch (e) { jobMessage = `转写失败：${e.message || e}。已保存的页文保留，可重试。`; }
      finally {
        busy = false;
        if (workRoot && workRoot.isConnected) {
          // 只更新状态和按钮，不重绘，以保留老师正在编辑的题卡和页文。
          setProg(jobMessage, 0); view.querySelector('#wkSemi').textContent = '◐ 半自动转写'; view.querySelector('#wkSemi').onclick = semiOcr;
        }
      }
    }

    async function ocrOne(no, btn) {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      busy = true;
      const old = btn.textContent,ta=view.querySelector(`#wkOcr${no}`),wasDisabled=ta && ta.disabled; btn.textContent = '转写中…';btn.disabled=true;if(ta)ta.disabled=true;
      try {
        const r = await api(`${MF_API}/intake/runs/${runId}/ocr`, { method: 'POST', body: { page: no } });
        run.ocr_texts = run.ocr_texts || [];
        run.ocr_texts[no - 1] = r.text || '';
        if (ta && ta.isConnected) { ta.value = r.text || ''; ta.closest('details').open = true; }
        jobMessage=`第 ${no} 页转写已保存，请核对后整理成题卡。`;
      } catch (e) { jobMessage=`第 ${no} 页转写失败：${e.message || e}。原文字保留，可重试。`; }
      finally {btn.textContent = old;btn.disabled=false;if(ta)ta.disabled=wasDisabled;busy = false;if(workRoot.isConnected)setProg(jobMessage,0);}
    }

    /* ---- 半自动腿2：文本整理成题卡 ---- */
    async function structureOne(no) {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      const ta = view.querySelector(`#wkOcr${no}`);
      const text = ta ? ta.value.trim() : '';
      if (!text) return toast('这一页还没有转写文本，先「转写」或手动粘贴', 'err');
      busy = true; setProg(`正在整理第 ${no} 页文字…`, 0.5);
      const locked=[...view.querySelectorAll('#wkCards input,#wkCards textarea,#wkCards select,#wkCards button,.mf-wk-pages textarea')].map(el=>[el,el.disabled]);locked.forEach(([el])=>{el.disabled=true;});
      try {
        await saveCards();
        const r = await api(`${MF_API}/intake/runs/${runId}/structure`, { method: 'POST', body: { page: no, text } });
        run.drafts = r.drafts || [];jobMessage=`第 ${no} 页整理出 ${r.added} 张题卡，请逐题核对。`;
        if(!workRoot.isConnected)return;
        busy=false;draw();view.querySelector('#wkCards').scrollTop=view.querySelector('#wkCards').scrollHeight;
      } catch (e) {jobMessage=`第 ${no} 页整理失败：${e.message || e}。原文和题卡保留，可重试。`;}
      finally {busy=false;locked.forEach(([el,disabled])=>{el.disabled=disabled;});if(workRoot.isConnected)setProg(jobMessage,0);}
    }
    async function structureAll() {
      if (busy || run.processing) return toast('有任务在跑，请等待当前页完成', 'err');
      const withText = [...view.querySelectorAll('.mf-wk-ocr textarea')].filter((ta) => ta.value.trim()).map((ta) => ({ no: Number(ta.id.replace('wkOcr', '')), text: ta.value }));
      if (!withText.length) return toast('先做「◐ 半自动转写」，再整理成题卡', 'err');
      busy = true; abortFlag = false; let prepared = false;
      const locked = [...view.querySelectorAll('#wkCards input, #wkCards textarea, #wkCards button, #wkCards select, .mf-wk-ocr textarea')].map((el) => [el, el.disabled]);
      locked.forEach(([el]) => { el.disabled = true; });
      withText.forEach(({ no, text }) => { run.ocr_texts[no - 1] = text; });
      try {
        await saveCards(); prepared = true;
        for (let k = 0; k < withText.length; k++) {
          if (abortFlag || !workRoot.isConnected) break;
          const { no, text } = withText[k]; run.ocr_texts[no - 1] = text;
          view.querySelector('#wkAllStruct').textContent = '停止（当前页保存后暂停）'; view.querySelector('#wkAllStruct').onclick = () => { abortFlag = true; };
          setProg(`正在整理第 ${no} 页（${k + 1} / ${withText.length}）…`, k / withText.length);
          const r = await api(`${MF_API}/intake/runs/${runId}/structure`, { method: 'POST', body: { page: no, text } });
          run.drafts = r.drafts || [];
        }
        jobMessage = abortFlag ? '整理已暂停，已保存题卡保留。' : '整理完成，题卡需要逐题核对。';
      } catch (e) { jobMessage = `整理失败：${e.message || e}。已保存题卡保留，可核对后重试。`; }
      finally { busy = false; if (workRoot && workRoot.isConnected) { if (prepared) { setProg(null); draw(); } else { locked.forEach(([el, disabled]) => { el.disabled = disabled; }); setProg(jobMessage, 0); } } }
    }

    /* ---- 校对保存 ---- */
    async function saveCards() {
      const cardsBox = view.querySelector('#wkCards');
      if (!cardsBox) return;
      view.querySelectorAll('.mf-wk-pages textarea[id^="wkOcr"]').forEach(ta=>{const no=Number(ta.id.replace('wkOcr',''));if(no>0)run.ocr_texts[no-1]=ta.value;});
      const next = mfCollectCards(cardsBox);
      await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: next } });
      run.drafts = next;
    }

    /* ---- 入库 ---- */
    async function mfIntakeCommit() {
      const cards = mfCollectCards(view.querySelector('#wkCards'));
      if (!cards.some((c) => String(c.stem || '').trim())) return toast('请先识别或录入题目', 'err');
      await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: cards } });
      toast('已保存，请到待审核核对题目和分类', 'ok');
      const source = ({ image: 'photo', pdf: 'photo', word: 'word', excel: 'excel', skill: 'skill', teacher_scan: 'teacher_scan', manual: 'manual', paper: 'paper', lesson: 'lesson' })[run.source_kind] || 'photo';
      pdSelectBatch(source, run.id);
      location.hash = '#/pending';
    }

  };

  draw();
}

