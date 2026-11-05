/* 【R1 起已停用：admin/index.html 不再加载本文件，菜单与 VIEWS 里也没有入口。】
 * 「知识点正确率」已并入「学习报告 → 习题学习报告」的详情抽屉（public/admin/reportui.js 的 r1OpenDrawer），旧路由 #/acc 会跳转过去。
 * 文件保留只为留档；后端 /api/admin/bank/accuracy 与 /mistakes/export-docx 仍在使用。
 *
 * 习题正确率（T6）：学情管理 → 知识点正确率。
 * 选一个学生，按「课程 → 小分组 → 视频」看他做课文习题的正确率（口径见 src/accuracy.js：每题取最近一次作答）。
 * 由 admin.js 的 VIEWS.acc 调用；依赖 admin.js 的 ADM / esc / ic，api.js 的 api / toast。
 */
function accRateHTML(a) {
  if (!a || !a.total) return '<span class="t6-acc">暂无习题</span>';
  if (a.rate === null || a.rate === undefined) return `<span class="t6-acc">未做 · 共 ${a.total} 题</span>`;
  const cls = a.rate >= 80 ? 'good' : a.rate >= 60 ? 'mid' : 'low';
  return `<span class="t6-acc ${cls}">${a.rate}%</span><span class="t6-acc-n">已做 ${a.answered} / ${a.total} 题 · 答对 ${a.correct}</span>`;
}

/** 导出某个学生的错题 Word（T9）：带登录票据下载，再触发浏览器保存 */
async function accDownloadMistakes(stu, subject, bucket, btn) {
  const qs = new URLSearchParams({ user_id: stu.id, bucket: bucket || 'unresolved' });
  if (subject) qs.set('subject', subject);
  const old = btn.textContent; btn.disabled = true; btn.textContent = '生成中…';
  try {
    const res = await fetch('/api/admin/bank/mistakes/export-docx?' + qs.toString(), { headers: { Authorization: 'Bearer ' + Auth.token } });
    if ((res.headers.get('content-type') || '').includes('json')) { const j = await res.json(); throw new Error(j.msg || '导出失败'); }
    if (!res.ok) throw new Error('导出失败（' + res.status + '）');
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${stu.name || stu.username}-${subject || '全部科目'}-错题集.docx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 ' + (res.headers.get('X-Mistake-Count') || '') + ' 道错题', 'ok');
  } catch (e) { toast(e.message || '导出失败', 'err'); }
  btn.disabled = false; btn.textContent = old;
}

async function viewAcc() {
  const st = ADM.page.acc = ADM.page.acc || { uid: 0, kw: '', open: {} };
  const html = `
  <div class="card">
    <div class="card-h"><h3>${ic('chart')} 知识点正确率</h3></div>
    <p class="t4-tip">选一个学生，看他在每个视频、每个小分组里课文习题的正确率。每道题取他<b>最近一次</b>作答的对错（重做答对了正确率就会上升），小分组 = 组内所有视频的题合在一起算。问答题不自动判分，不计入。</p>
    <div class="bk-filters">
      <input id="acc-kw" class="input" style="max-width:260px" placeholder="输入学生姓名 / 账号搜索" value="${esc(st.kw)}">
      <button class="btn primary" id="acc-search" style="width:auto;max-width:120px">搜索</button>
    </div>
    <div id="acc-pick" class="t6-acc-pick"></div>
  </div>
  <div class="card" id="acc-out" style="margin-top:14px"><div class="empty">先搜索并选择一个学生</div></div>`;
  return {
    html,
    after: () => {
      const pick = document.getElementById('acc-pick');
      const out = document.getElementById('acc-out');
      const showStudent = async (uid) => {
        st.uid = uid;
        out.innerHTML = '<div class="loading-page">加载中…</div>';
        let d;
        try { d = await api('/api/admin/bank/accuracy?user_id=' + uid); } catch (e) { out.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`; return; }
        const s = d.student;
        const head = `<div class="card-h"><h3>${esc(s.name || s.username)} <small style="font-weight:400;color:#6b7280">${esc([s.grade, s.term].filter(Boolean).join(' '))} · ${esc(s.username)}</small></h3>
          <div style="display:flex;align-items:center;gap:8px">${accRateHTML(d.acc)}
            <select id="acc-msubj" class="input" style="width:96px"><option value="">全部科目</option>${['数学', '英语', '物理', '化学'].map((x) => `<option>${x}</option>`).join('')}</select>
            <select id="acc-mbucket" class="input" style="width:120px"><option value="unresolved">未掌握</option><option value="all">全部（含已掌握）</option><option value="resolved">已掌握</option></select>
            <button class="btn ghost sm" id="acc-mdocx" style="width:auto">📄 导出错题 Word</button></div></div>`;
        const bindDocx = () => {
          const btn = document.getElementById('acc-mdocx'); if (!btn) return;
          btn.onclick = () => accDownloadMistakes(s, document.getElementById('acc-msubj').value, document.getElementById('acc-mbucket').value, btn);
        };
        if (!d.courses.length) { out.innerHTML = head + '<div class="empty">还没有给任何视频绑定习题（课文习题里绑定后这里才有数据）</div>'; bindDocx(); return; }
        out.innerHTML = head + d.courses.map((c) => `
          <div class="t6-acc-course">
            <div class="t6-acc-ch"><b>${esc(c.name)}</b><span>${esc([c.subject, c.grade, c.term].filter(Boolean).join(' · '))}</span>${accRateHTML(c.acc)}</div>
            ${c.groups.map((g) => `
              <div class="t6-acc-group">
                <div class="t6-acc-gh"><span class="t6-acc-gn">${esc(g.name)}</span>${accRateHTML(g.acc)}</div>
                ${g.videos.map((v) => `<div class="t6-acc-v"><span class="t6-acc-vn">${esc(v.title)}</span>${accRateHTML(v.acc)}</div>`).join('')}
              </div>`).join('')}
          </div>`).join('');
        bindDocx();
      };
      const search = async () => {
        st.kw = document.getElementById('acc-kw').value.trim();
        pick.innerHTML = '<span class="hint">搜索中…</span>';
        let d;
        try { d = await api('/api/admin/students?size=30&kw=' + encodeURIComponent(st.kw)); } catch (e) { pick.innerHTML = ''; return; }
        const list = (d && d.list) || [];
        pick.innerHTML = list.length
          ? list.map((u) => `<button type="button" class="t6-acc-chip ${u.id === st.uid ? 'on' : ''}" data-uid="${u.id}">${esc(u.name || u.username)}<small>${esc(u.grade || '')}</small></button>`).join('')
          : '<span class="hint">没有找到学生</span>';
        pick.querySelectorAll('[data-uid]').forEach((b) => b.onclick = () => {
          pick.querySelectorAll('.t6-acc-chip').forEach((x) => x.classList.toggle('on', x === b));
          showStudent(Number(b.dataset.uid));
        });
      };
      document.getElementById('acc-search').onclick = search;
      document.getElementById('acc-kw').onkeydown = (e) => { if (e.key === 'Enter') search(); };
      search().then(() => { if (st.uid) showStudent(st.uid); });
    },
  };
}
