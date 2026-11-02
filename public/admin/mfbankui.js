/* 魔方题库（并入智能题库，2026-10-29）
 * 四个子页面：题库管理（目录树）/ 网络采集 / 试卷管理 / 录题上传
 * 由 admin.js 的 VIEWS 调用；依赖 admin.js 的 modal / esc / toast / ic / pagerHTML / bindPager / ADM，api.js 的 elConfirm。
 */
const MF_API = '/api/admin/bank/mf';
const MF_TYPES = [['single', '单选题'], ['multi', '多选题'], ['judge', '判断题'], ['fill', '填空题'], ['sort', '排序题'], ['answer', '解答题']];
const MF_TYPE_NAME = Object.fromEntries(MF_TYPES);
const MF_STAGES = [['', '全部学段'], ['primary', '小学'], ['junior', '初中'], ['senior', '高中']];
const MF_GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const MF_SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];
const MF_SRC_NAME = { local: '本地', capture: '采集', recog: '录题' };

const mfEsc = (s) => String(s == null ? '' : s);
const mfState = (k) => (ADM.page[k] = ADM.page[k] || {});

async function mfCommitForm(batchId) {
  const d = await api(`${MF_API}/capture/batches/${batchId}`);
  const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const papers = (await api(MF_API + '/papers?status=basket', { silent: true }).catch(() => ({ list: [] }))).list || [];
  let nodes = [];
  modal({
    title: `入库：${d.batch.title}`, wide: true, okText: '开始入库',
    body: `<div class="mf-form">
      <div class="field"><label>学科</label><select id="mcSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>学段</label><select id="mcStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="field"><label>年级</label><select id="mcGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
      <div class="field"><label>目录树</label><select id="mcTree"><option value="">不挂树</option>${trees.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>节点</label><select id="mcNode"><option value="">（先选树）</option></select></div>
      <div class="field"><label>加入试卷</label><select id="mcPaper"><option value="">不加入</option>${papers.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></div>
      <div class="field"><label>统一分值</label><input id="mcScore" class="inp" type="number" value="0"></div>
      <div class="field wide"><label>额外标签（逗号分隔）</label><input id="mcTags" class="inp" placeholder="如：采集自菁优网"></div>
      <div class="field wide"><label>选择要入库的题（共 ${d.batch.questions.length} 题）</label>
        <div class="mf-pick">${d.batch.questions.map((q, i) => `<label class="mf-pickitem">
          <input type="checkbox" class="mcck" value="${i}" checked>
          <span>${esc((q.stem || q.stemHtml || '').slice(0, 160))}</span></label>`).join('')}</div></div>
    </div>`,
    onMount: (w) => {
      w.querySelector('#mcTree').onchange = async (e) => {
        nodes = e.target.value ? ((await api(`${MF_API}/trees/${e.target.value}/nodes`).catch(() => ({ list: [] }))).list || []) : [];
        w.querySelector('#mcNode').innerHTML = `<option value="">不挂</option>${nodes.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}`;
      };
    },
    onOk: async (w) => {
      const sel = [...w.querySelectorAll('.mcck:checked')].map((c) => Number(c.value));
      if (!sel.length) return false;
      const r = await api(`${MF_API}/capture/batches/${batchId}/commit`, {
        method: 'POST',
        body: {
          selected: sel, subject: w.querySelector('#mcSub').value, stage: w.querySelector('#mcStage').value,
          grade: w.querySelector('#mcGrade').value, node_id: w.querySelector('#mcNode').value || null,
          paper_id: w.querySelector('#mcPaper').value || null, score: Number(w.querySelector('#mcScore').value) || 0,
          tags: w.querySelector('#mcTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        },
      });
      toast(`入库完成：新增 ${r.created}、补缺 ${r.updated}、跳过 ${r.skipped}`, 'ok');
      render();
    },
  });
}

/* ================================================================= 试卷管理
 * 文件夹 + 试卷（试题篮 → 排版中 → 定稿 → 归档 / 回收站）+ 排版参数 + 预览打印导出。 */
async function viewMfPapers() {
  const st = mfState('mfp');
  st.status = st.status || '';
  st.folder = st.folder || '';
  st.kw = st.kw || '';
  const folders = (await api(MF_API + '/paper-folders', { silent: true }).catch(() => ({ list: [] }))).list || [];
  const qs = Object.entries(st).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const data = await api(`${MF_API}/papers${qs ? '?' + qs : ''}`);
  const STATUS = data.statusNames || {};
  const groups = ['basket', 'composing', 'done', 'archived', 'trashed'];
  const seg = (s) => (data.list || []).filter((p) => p.status === s);

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
          <select id="mpStatus"><option value="">全部状态</option>${groups.map((s) => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${STATUS[s] || s}</option>`).join('')}</select>
          <button class="btn primary sm" id="mpNew">${ic('plus')} 新建试卷</button>
        </div></div>
      <div class="card-b">
        ${groups.map((s) => {
          const list = st.status ? (s === st.status ? seg(s) : []) : seg(s);
          if (!list.length) return '';
          return `<h4 class="mf-seg">${STATUS[s] || s}（${list.length}）</h4>
          <div class="mf-papers">${list.map((p) => `<div class="mf-paper">
            <div class="mf-pt">${esc(p.title)} ${Number(p.published) ? '<span class="tag ok">已发布到试卷库</span>' : ''}</div>
            <div class="hint">${esc(p.subject || '通用')} · ${p.qcount || 0} 题 · ${esc(p.created_at || '')}</div>
            <div class="mf-pbtns">
              <button class="btn ghost xs" data-open="${p.id}">打开</button>
              <button class="btn ghost xs" data-prev="${p.id}">预览打印</button>
              <button class="btn ghost xs" data-status="${p.id}">状态</button>
              <button class="btn ghost xs" data-libpub="${p.id}">${Number(p.published) ? '取消发布' : '发布'}</button>
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
            <div class="field"><label>学科</label><select id="npSub">${MF_SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select></div>
            <div class="field"><label>学段</label><select id="npStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
            <div class="field"><label>年级</label><select id="npGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
            <div class="field"><label>文件夹</label><select id="npFolder"><option value="">未分类</option>${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div></div>`,
          onOk: async (w) => {
            await api(MF_API + '/papers', { method: 'POST', body: { title: w.querySelector('#npTitle').value.trim(), subject: w.querySelector('#npSub').value, stage: w.querySelector('#npStage').value, grade: w.querySelector('#npGrade').value, folder_id: w.querySelector('#npFolder').value || null } });
            toast('已创建', 'ok'); render();
          },
        });
      };
      document.getElementById('mpKw').onkeydown = (e) => { if (e.key === 'Enter') { st.kw = e.target.value.trim(); render(); } };
      document.getElementById('mpStatus').onchange = (e) => { st.status = e.target.value; render(); };
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
        modal({ title: '修改状态', body: `<div class="field"><label>状态</label><select id="nsStatus">${groups.map((s) => `<option value="${s}">${STATUS[s] || s}</option>`).join('')}</select></div>`,
          onOk: async (w) => { await api(MF_API + '/papers/' + id, { method: 'PUT', body: { status: w.querySelector('#nsStatus').value } }); toast('已更新', 'ok'); render(); } });
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

/** 试卷详情：题序 / 分值 / 文本块 / 排版 / 预览导出 */
async function mfPaperDetail(id) {
  const load = async () => (await api(`${MF_API}/papers/${id}`));
  let d = await load();
  const L = d.paper.layout || {};
  const fields = L.fieldVisibility || {};
  const render = () => {
    const rows = d.rows.map((r, i) => r.kind === 'text'
      ? `<tr><td>${i + 1}</td><td colspan="4"><b>【文本块】</b>${esc(r.text_body)}</td>
          <td><button class="btn ghost xs" data-up="${r.id}">↑</button><button class="btn ghost xs" data-down="${r.id}">↓</button>
          <button class="btn ghost xs" data-rm="${r.id}">删</button></td></tr>`
      : `<tr><td>${i + 1}</td><td>${esc((r.question && r.question.stem || '（题目已删除）').slice(0, 90))}</td>
          <td>${MF_TYPE_NAME[r.question && r.question.type] || ''}</td>
          <td><input class="inp xs" style="width:70px" type="number" value="${r.score || 0}" data-score="${r.id}"></td>
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
    <table class="tb"><thead><tr><th style="width:40px">序</th><th>题干</th><th style="width:70px">题型</th><th style="width:90px">分值</th><th style="width:80px">学科</th><th style="width:140px">操作</th></tr></thead>
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
        w.querySelectorAll('[data-score]').forEach((inp) => {
          inp.onchange = async () => { await api(`${MF_API}/papers/${id}/rows/${inp.dataset.score}`, { method: 'PUT', body: { score: Number(inp.value) || 0 } }); };
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
        <b>✨全自动</b>逐页一步出卡，<b>◐半自动</b>先转写全文再整理成卡。勾选校对后一键入库（图片存在对象存储 bank/recog 下）。</div>
      ${runs.length ? `<table class="tb"><thead><tr><th>批次</th><th style="width:90px">来源</th><th style="width:70px">页数</th><th style="width:70px">题卡</th><th style="width:90px">状态</th><th style="width:180px">操作</th></tr></thead>
        <tbody>${runs.map((r) => `<tr><td>${esc(r.title)}</td><td>${kindName[r.source_kind] || r.source_kind}</td><td>${r.page_count}</td><td>${r.draft_count}</td>
          <td><span class="tag ${r.status === 'error' ? 'err' : ''}">${statusMap[r.status] || r.status}</span></td>
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
  const types = MF_CARD_TYPES.includes(c.questionType) ? MF_CARD_TYPES : [c.questionType || '解答'].concat(MF_CARD_TYPES);
  const figs = (c.figures || []).filter(Boolean).map((f) => (typeof f === 'string' ? { url: f } : f)).filter((f) => f.url);
  cats = cats || { chapters: [], points: [] };
  const cid = Number(c.chapter_id) || 0;
  const chInList = cats.chapters.some((ch) => Number(ch.id) === cid);
  const pt = String(c.point || '').trim();
  const ptInList = !pt || cats.points.includes(pt);
  const df = Math.min(5, Math.max(1, Number(c.difficulty) || 3));
  return `<div class="mf-card2 mf-wk-card" data-ci="${i}">
    <div class="mf-wk-chead"><label><input type="checkbox" class="wkck" value="${i}" ${c.checked === false ? '' : 'checked'}> 第 ${i + 1} 张</label>
      <span class="mf-wk-cmeta">${[c.page ? `第${c.page}页` : '', c.qno ? `题号 ${esc(String(c.qno))}` : '', c.via === 'semi' ? '◐ 半自动' : (c.via === 'word' ? 'Word' : ''), c.ai_filled ? '✨AI已补' : ''].filter(Boolean).join(' · ')}</span>
      <span class="sp"></span><button class="btn ghost xs" data-aifill="${i}" title="AI 补全这一题的答案/解析和分类建议">AI补</button><button class="btn ghost xs" data-delcard="${i}">删</button></div>
    <div class="mf-wk-cgrid">
      <div class="field"><label>题型</label><select class="inp" data-f="questionType" data-i="${i}">${types.map((t) => `<option ${c.questionType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field wide"><label>分类（题库）：课本章节 · 知识点 · 难度</label><div class="mf-wk-cls">
        <select class="inp cls-ch" data-f="chapter_id" data-i="${i}"><option value="">章节不设</option>${cats.chapters.map((ch) => `<option value="${ch.id}" ${Number(ch.id) === cid ? 'selected' : ''}>${esc(ch.name)}${ch.grade ? '·' + esc(ch.grade) : ''}${ch.term ? esc(ch.term) : ''}</option>`).join('')}${cid && !chInList ? `<option value="${cid}" selected>章节 #${cid}</option>` : ''}</select>
        <select class="inp cls-pt" data-f="point" data-i="${i}"><option value="">知识点不设</option>${cats.points.map((p) => `<option ${p === pt ? 'selected' : ''}>${esc(p)}</option>`).join('')}${!ptInList ? `<option selected>${esc(pt)}</option>` : ''}</select>
        <select class="inp cls-df" data-f="difficulty" data-i="${i}" title="难度">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === df ? 'selected' : ''}>难度${n}</option>`).join('')}</select>
      </div></div>
      <div class="field wide"><label>题干</label><textarea class="inp" rows="3" data-f="stem" data-i="${i}">${esc(c.stem || '')}</textarea></div>
      ${figs.length ? `<div class="field wide"><label>插图（${figs.length}，题干中对应 [图N]）</label><div class="mf-wk-figs">${figs.map((f, k) => `<img class="mf-wk-fig" src="${f.url}" loading="lazy" data-cfig="${i}" data-fidx="${k}" alt="插图${f.n || k + 1}">`).join('')}</div></div>` : ''}
      <div class="field wide"><label>选项（一行一个，如 A. xxx）</label><textarea class="inp" rows="2" data-f="options" data-i="${i}">${esc((c.options || []).map((o) => `${o.label ? o.label + '. ' : ''}${o.content || ''}`).join('\n'))}</textarea></div>
      <div class="field wide"><label>答案</label><textarea class="inp" rows="1" data-f="answer" data-i="${i}">${esc(c.answer || '')}</textarea></div>
      <div class="field wide"><label>解析</label><textarea class="inp" rows="2" data-f="analysis" data-i="${i}">${esc(c.analysis || '')}</textarea></div>
    </div></div>`;
}

/** 从右栏 DOM 收集题卡（编辑内容 + 勾选）；非输入型字段（页码/来源/插图）从快照回填 */
let mfCardSnap = [];
function mfCollectCards(root) {
  const out = [];
  root.querySelectorAll('.mf-wk-card').forEach((el) => {
    const i = Number(el.dataset.ci);
    const snap = mfCardSnap[i] || {};
    const c = { options: [], suggestedTags: [], figures: snap.figures || [], page: snap.page || 0, qno: snap.qno || '', via: snap.via || '' };
    el.querySelectorAll('[data-f]').forEach((f) => {
      const v = f.value;
      if (f.dataset.f === 'options') {
        c.options = v.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
          const m = /^([A-Ea-e])\s*[.、．]\s*(.*)$/.exec(s);
          return m ? { label: m[1].toUpperCase(), content: m[2] } : { label: '', content: s };
        });
      } else c[f.dataset.f] = v;
    });
    c.checked = !!el.querySelector('.wkck')?.checked;
    out.push(c);
  });
  return out;
}

/** 页图大图查看：在线翻页 + 滚轮缩放 */
function mfLightbox(urls, idx) {
  let cur = idx || 0;
  let scale = 1;
  const ov = document.createElement('div');
  ov.className = 'mf-lb';
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
async function mfIntakeFiles(runId, files, after) {
  const imgs = [];
  const docx = files.filter((f) => /\.docx$/i.test(f.name || ''));
  const rest = files.filter((f) => !/\.docx$/i.test(f.name || ''));
  if (!rest.length && !docx.length) { toast('没有可上传的文件（支持图片 / PDF / .docx）', 'err'); return; }
  const pgs = [];
  if (rest.length) {
    if (!window.PdfPages) { toast('上传组件没加载成功，请刷新页面（Ctrl+F5）后重试', 'err'); return; }
    await window.PdfPages.upload(rest, {
      maxPages: 30, maxWidth: 1600,
      progressTitle: '📄 正在逐页转图',
      onImage: async (f) => imgs.push(f),
      onPage: async (canvas, page) => {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        if (blob) pgs.push(new File([blob], `page-${String(page).padStart(3, '0')}.png`, { type: 'image/png' }));
      },
      onError: (m) => toast(m, 'err'),
    });
  }
  // 页图分批上传（每批 10 张）
  for (let i = 0; i < pgs.length; i += 10) {
    const batch = pgs.slice(i, i + 10);
    if (!batch.length) continue;
    const fd = new FormData();
    batch.forEach((f) => fd.append('pages', f));
    const res = await fetch(`${MF_API}/intake/runs/${runId}/pages`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
    const j = await res.json();
    if (j.code !== 0) { toast(j.msg || '页图上传失败', 'err'); return; }
  }
  for (const f of imgs) {
    const fd = new FormData();
    fd.append('pages', f, f.name || 'image.png');
    const res = await fetch(`${MF_API}/intake/runs/${runId}/pages`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
    const j = await res.json();
    if (j.code !== 0) { toast(j.msg || '图片上传失败', 'err'); return; }
  }
  // Word 导入
  for (const f of docx) {
    toast(`正在导入 Word「${f.name}」并交给 AI 整理…`, '');
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`${MF_API}/intake/runs/${runId}/word`, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
    const j = await res.json();
    if (j.code !== 0) toast(j.msg || 'Word 导入失败', 'err');
    else toast(j.msg || 'Word 导入完成', 'ok');
  }
  if (pgs.length || imgs.length) toast(`已上传 ${pgs.length + imgs.length} 页`, 'ok');
  if (after) await after();
}

async function mfIntakeWork(runId) {
  let run = (await api(`${MF_API}/intake/runs/${runId}`)).run;
  const view = document.getElementById('view');
  let busy = false;
  let abortFlag = false;
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
      points: ((kb.list || []).flatMap((u) => (u.points || []).map((p) => p.name))),
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
        <button class="btn primary sm" id="wkAuto">✨ 全自动识别</button>
        <button class="btn sm" id="wkSemi">◐ 半自动转写</button>
        <button class="btn ghost sm" id="wkAllStruct">全部整理成题卡</button>
        <button class="btn sm" id="wkAiFill" title="为答案/解析为空的题卡自动补全，并按题库分类给出章节/知识点/难度建议">✨ AI 补答案/分类</button>
        <button class="btn danger sm ghost" id="wkDel">删除批次</button>
      </div>
      <div class="mf-wk-hint">把图片 / PDF / Word 拖到左栏，或 <b>Ctrl+V</b> 粘贴截图 · ✨全自动逐页识别出卡 · ◐半自动先转写全文，点每页「整理成题卡」或「全部整理成题卡」</div>
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
            <button class="btn primary sm" id="wkCommit">入库勾选的题</button></div></div>
        <div class="card-b mf-wk-cards" id="wkCards">
          ${cards.length ? cards.map((c, i) => mfCardHtml(c, i, cats)).join('') : '<div class="empty">还没有题卡——✨全自动识别、◐半自动整理，或「+ 空白题卡」手动录</div>'}
        </div></div>
    </div>`;

    /* ---- 顶栏 ---- */
    view.querySelector('#wkBack').onclick = () => render();
    view.querySelector('#wkUpload').onclick = () => mfPickFiles();
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

    /* ---- ✨ AI 补答案/分类（indexes=null 批量，否则单卡） ---- */
    async function aiFill(indexes) {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      busy = true;
      setProg(indexes ? '✨ 正在为该题补全答案与分类建议…' : '✨ 正在批量补答案/解析 + 分类建议…', 0.4);
      try {
        await saveCards();
        const r = await api(`${MF_API}/intake/runs/${runId}/aifill`, { method: 'POST', body: { indexes: indexes || null } });
        run.drafts = r.drafts || run.drafts;
        toast(r.msg || 'AI 补全完成', 'ok');
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
    async function uploadDropped(fs) {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      busy = true; setProg('正在上传…', 0.5);
      await mfIntakeFiles(runId, fs, async () => {
        run = (await api(`${MF_API}/intake/runs/${runId}`)).run; setProg(null); draw();
      }).catch(() => setProg(null));
      busy = false; setProg(null);
    }
    if (!window.__mfWkPaste) {
      window.__mfWkPaste = (e) => {
        const fs = [...((e.clipboardData || {}).files || [])].filter((f) => /image|pdf/.test(f.type) || /\.docx$/i.test(f.name || ''));
        if (!fs.length) return;
        const wb = document.getElementById('wkPages');
        if (!wb) return;
        e.preventDefault();
        uploadDropped(fs);
      };
      document.addEventListener('paste', window.__mfWkPaste);
    }

    /* ---- 进度条 ---- */
    function setProg(txt, ratio) {
      const box = view.querySelector('#wkProg');
      if (!box) return;
      if (txt == null) { box.style.display = 'none'; return; }
      box.style.display = 'flex';
      box.querySelector('.mf-wk-prog-t>i').style.width = `${Math.round((ratio || 0.05) * 100)}%`;
      view.querySelector('#wkProgTxt').textContent = txt;
    }
    mfIntakeWork._setProg = setProg;

    /* ---- ✨ 全自动：逐页识别（可中断，继续跑会跳过已出的页） ---- */
    async function autoRecognize() {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      if (!pages.length) return toast('先上传页图', 'err');
      busy = true; abortFlag = false;
      view.querySelector('#wkAuto').textContent = '■ 停止';
      view.querySelector('#wkAuto').onclick = () => { abortFlag = true; };
      await saveCards();
      for (let i = 0; i < pages.length; i++) {
        if (abortFlag) break;
        setProg(`✨ 正在识别第 ${i + 1} / ${pages.length} 页…`, (i) / pages.length);
        try {
          const r = await api(`${MF_API}/intake/runs/${runId}/recognize`, { method: 'POST', body: { page: i + 1 } });
          run.drafts = r.drafts || [];
          draw();
          setProg(`✨ 第 ${i + 1} 页完成：累计 ${run.drafts.length} 张题卡`, (i + 1) / pages.length);
        } catch (e) { toast(`第 ${i + 1} 页识别失败：${e.message || e}`, 'err'); break; }
      }
      busy = false; setProg(null); draw();
    }

    /* ---- ◐ 半自动：逐页 OCR 转写 ---- */
    async function semiOcr() {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      if (!pages.length) return toast('先上传页图', 'err');
      busy = true; abortFlag = false;
      view.querySelector('#wkSemi').textContent = '■ 停止';
      view.querySelector('#wkSemi').onclick = () => { abortFlag = true; };
      if (!run.ocr_texts) run.ocr_texts = [];
      for (let i = 0; i < pages.length; i++) {
        if (abortFlag) break;
        setProg(`◐ 正在转写第 ${i + 1} / ${pages.length} 页…`, i / pages.length);
        try {
          const r = await api(`${MF_API}/intake/runs/${runId}/ocr`, { method: 'POST', body: { page: i + 1 } });
          run.ocr_texts[i] = r.text || '';
          const ta = view.querySelector(`#wkOcr${i + 1}`);
          if (ta) { ta.value = run.ocr_texts[i]; ta.closest('details').open = true; }
        } catch (e) { toast(`第 ${i + 1} 页转写失败：${e.message || e}`, 'err'); break; }
      }
      busy = false; setProg(null);
      view.querySelector('#wkSemi').textContent = '◐ 半自动转写';
      view.querySelector('#wkSemi').onclick = semiOcr;
    }

    async function ocrOne(no, btn) {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      busy = true;
      const old = btn.textContent; btn.textContent = '转写中…';
      try {
        const r = await api(`${MF_API}/intake/runs/${runId}/ocr`, { method: 'POST', body: { page: no } });
        run.ocr_texts = run.ocr_texts || [];
        run.ocr_texts[no - 1] = r.text || '';
        const ta = view.querySelector(`#wkOcr${no}`);
        if (ta) { ta.value = r.text || ''; ta.closest('details').open = true; }
      } catch (e) { /* api 已提示 */ }
      btn.textContent = old; busy = false;
    }

    /* ---- 半自动腿2：文本整理成题卡 ---- */
    async function structureOne(no) {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      const ta = view.querySelector(`#wkOcr${no}`);
      const text = ta ? ta.value.trim() : '';
      if (!text) return toast('这一页还没有转写文本，先「转写」或手动粘贴', 'err');
      busy = true; setProg(`◐ 正在整理第 ${no} 页文字…`, 0.5);
      try {
        await saveCards();
        const r = await api(`${MF_API}/intake/runs/${runId}/structure`, { method: 'POST', body: { page: no, text } });
        run.drafts = r.drafts || [];
        toast(`整理出 ${r.added} 张题卡`, 'ok');
        draw();
        view.querySelector('#wkCards').scrollTop = view.querySelector('#wkCards').scrollHeight;
      } catch (e) { /* api 已提示 */ }
      setProg(null); busy = false;
    }
    async function structureAll() {
      if (busy) return toast('有任务在跑，稍等一下', 'err');
      const withText = [];
      new Set([...view.querySelectorAll('.mf-wk-ocr textarea'), view.querySelector('#wkOcr1')].filter(Boolean)).forEach((ta) => { if (ta.value.trim()) withText.push(Number(ta.id.replace('wkOcr', ''))); });
      if (!withText.length) return toast('先做「◐ 半自动转写」，再整理成题卡', 'err');
      busy = true; abortFlag = false;
      await saveCards();
      for (let k = 0; k < withText.length; k++) {
        if (abortFlag) break;
        const no = withText[k];
        setProg(`◐ 正在整理第 ${no} 页（${k + 1} / ${withText.length}）…`, k / withText.length);
        try {
          const r = await api(`${MF_API}/intake/runs/${runId}/structure`, { method: 'POST', body: { page: no, text: view.querySelector(`#wkOcr${no}`).value } });
          run.drafts = r.drafts || [];
        } catch (e) { break; }
      }
      busy = false; setProg(null); draw();
      view.querySelector('#wkCards').scrollTop = view.querySelector('#wkCards').scrollHeight;
    }

    /* ---- 校对保存 ---- */
    async function saveCards() {
      const cardsBox = view.querySelector('#wkCards');
      if (!cardsBox) return;
      const next = mfCollectCards(cardsBox);
      await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: next } });
      run.drafts = next;
    }

    /* ---- 入库 ---- */
    async function mfIntakeCommit() {
      const cardsBox = view.querySelector('#wkCards');
      const cards = mfCollectCards(cardsBox);
      const sel = cards.map((c, i) => (c.checked === false ? -1 : i)).filter((i) => i >= 0);
      if (!sel.length) return toast('先勾选要入库的题卡', 'err');
      const trees = (await api(MF_API + '/trees', { silent: true }).catch(() => ({ list: [] }))).list || [];
      const papers = (await api(MF_API + '/papers?status=basket', { silent: true }).catch(() => ({ list: [] }))).list || [];
      let nodes = [];
      modal({
        title: `入库：勾选了 ${sel.length} 张题卡`, okText: '确认入库',
        body: `<div class="mf-form">
          <div class="field"><label>学科</label><select id="ikSub">${MF_SUBJECTS.map((s) => `<option ${view.querySelector('#wkSub').value === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>学段</label><select id="ikStage">${MF_STAGES.slice(1).map(([k, t]) => `<option value="${k}" ${view.querySelector('#wkStage').value === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>年级</label><select id="ikGrade"><option value="">不限</option>${MF_GRADES.map((g) => `<option>${g}</option>`).join('')}</select></div>
          <div class="field"><label>目录树</label><select id="ikTree"><option value="">不挂树</option>${trees.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <div class="field"><label>节点</label><select id="ikNode"><option value="">（先选树）</option></select></div>
          <div class="field"><label>加入试卷</label><select id="ikPaper"><option value="">不加入</option>${papers.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></div>
          <div class="field"><label>统一分值</label><input id="ikScore" class="inp" type="number" value="0"></div>
          <div class="field wide"><label>额外标签</label><input id="ikTags" class="inp" placeholder="逗号分隔"></div>
        </div>`,
        onMount: (w) => {
          w.querySelector('#ikTree').onchange = async (e) => {
            nodes = e.target.value ? ((await api(`${MF_API}/trees/${e.target.value}/nodes`).catch(() => ({ list: [] }))).list || []) : [];
            w.querySelector('#ikNode').innerHTML = `<option value="">不挂</option>${nodes.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}`;
          };
        },
        onOk: async (w) => {
          await api(`${MF_API}/intake/runs/${runId}/drafts`, { method: 'PUT', body: { drafts: cards } });
          const r = await api(`${MF_API}/intake/runs/${runId}/commit`, {
            method: 'POST',
            body: {
              selected: sel, subject: w.querySelector('#ikSub').value, stage: w.querySelector('#ikStage').value,
              grade: w.querySelector('#ikGrade').value, node_id: w.querySelector('#ikNode').value || null,
              paper_id: w.querySelector('#ikPaper').value || null, score: Number(w.querySelector('#ikScore').value) || 0,
              tags: w.querySelector('#ikTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            },
          });
          toast(`已入库 ${r.ids.length} 题`, 'ok');
          run = (await api(`${MF_API}/intake/runs/${runId}`)).run;
          draw();
        },
      });
    }
  };

  draw();
}

