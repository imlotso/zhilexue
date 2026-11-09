/* ==========================================================
   历次追踪 v2：任意两次考试对比（名次校正判定）
   ========================================================== */
const ViewTracking = (() => {
  let state = { a: null, b: null, sort: 'up', only: 'all', subject: '' };

  function pick(ex) {
    if (!ex.length) { state.a = state.b = null; return; }
    if (ex.length === 1) { state.a = state.b = ex[0].id; return; }
    state.b = ex[ex.length - 1].id; state.a = ex[ex.length - 2].id;
  }

  function render(el) {
    const cid = Store.currentId();
    const ex = Store.exams(cid);
    if (!ex.length) {
      el.innerHTML = `<div class="card"><div class="empty-state">
        <div class="es-ico">◫</div><div class="es-main">暂无考试记录</div>
        <div class="es-sub">上传两次以上考试成绩后，即可生成历次趋势与进退步对比</div></div></div>`;
      return;
    }
    if (!state.a || !state.b || !ex.find(e => e.id === state.a) || !ex.find(e => e.id === state.b)) pick(ex);

    const subject = state.subject || '';
    const rowsAll = Analytics.compareExams(state.a, state.b, subject);
    let rows = rowsAll.slice();
    if (state.only === 'up') rows = rows.filter(r => r.judge === 'up');
    if (state.only === 'down') rows = rows.filter(r => r.judge === 'down');
    if (state.sort === 'up') rows.sort((x, y) => (y.rankDelta ?? 0) - (x.rankDelta ?? 0) || y.delta - x.delta);
    else if (state.sort === 'down') rows.sort((x, y) => (x.rankDelta ?? 0) - (y.rankDelta ?? 0) || x.delta - y.delta);
    else rows.sort((x, y) => y.delta - x.delta);

    const upN = rowsAll.filter(r => r.judge === 'up').length;
    const downN = rowsAll.filter(r => r.judge === 'down').length;
    const flatN = rowsAll.filter(r => r.judge === 'flat').length;
    const examA = Store.exam(state.a), examB = Store.exam(state.b);
    const trends = Analytics.campusTrends(cid, subject);
    const tCount = { up: 0, down: 0, wave: 0, flat: 0, none: 0 };
    trends.forEach(t => tCount[t.status]++);
    const facets = Store.facets(cid);
    const opts = ex.map(e => `<option value="${e.id}">${U.esc(e.name)}（${e.date}）</option>`).join('');

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h2 class="page-title">考试对比</h2>
          <div class="page-desc">共 ${ex.length} 次考试 · 任选两次生成全班进退步清单（看板看结论，本页做对比与导出）</div>
        </div>
        <div class="toolbar">
          <div class="field"><label>学科</label>
            <select id="tSubject"><option value="">全部（总分）</option>${facets.subjects.map(s => `<option ${subject === s ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select></div>
          <div class="field"><label>基准考试（上次）</label><select id="tA">${opts}</select></div>
          <div class="field"><label>对比考试（本次）</label><select id="tB">${opts}</select></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-body" style="padding:12px 16px;display:flex;gap:22px;flex-wrap:wrap;align-items:center">
          <div style="font-size:12.5px;color:var(--text-2)">
            参比 <b style="font-size:15px">${rowsAll.length}</b> 人
            <span class="tag tag-up" style="margin-left:8px">进步 ${upN}</span>
            <span class="tag tag-down" style="margin-left:4px">退步 ${downN}</span>
            <span class="tag tag-flat" style="margin-left:4px">持平 ${flatN}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-2)">
            历次趋势：
            持续进步 <b class="up">${tCount.up}</b> ·
            持续退步 <b class="down">${tCount.down}</b> ·
            波动 <b style="color:var(--warn)">${tCount.wave}</b> ·
            稳定 <b>${tCount.flat}</b>
          </div>
          <div style="font-size:12.5px;color:var(--text-3);margin-left:auto">
            本次未写评语 ${rowsAll.filter(r => !r.hasCommentB).length} 人 · 判定以班级名次为主
          </div>
        </div>
      </div>

      <div class="card" id="cmpCard">
        <div class="card-head">
          <div class="card-title"><span class="dot"></span>进退步清单
            <span class="tag tag-primary">${rows.length} 人</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm ${state.sort === 'up' ? 'btn-primary' : ''}" data-sort="up">按名次提升↓</button>
            <button class="btn btn-sm ${state.sort === 'down' ? 'btn-primary' : ''}" data-sort="down">按名次下滑↓</button>
            <button class="btn btn-sm ${state.sort === 'delta' ? 'btn-primary' : ''}" data-sort="delta">按进退分↓</button>
            <select id="tOnly" style="width:110px;height:29px">
              <option value="all" ${state.only === 'all' ? 'selected' : ''}>全部学生</option>
              <option value="up" ${state.only === 'up' ? 'selected' : ''}>仅进步</option>
              <option value="down" ${state.only === 'down' ? 'selected' : ''}>仅退步</option>
            </select>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="grid">
            <thead><tr>
              <th>#</th><th>姓名</th><th>年级/学段</th>
              <th class="num">${U.esc(examA ? examA.name : '')}<div class="small muted" style="font-weight:400">${examA ? examA.date : ''}</div></th>
              <th class="num">${U.esc(examB ? examB.name : '')}<div class="small muted" style="font-weight:400">${examB ? examB.date : ''}</div></th>
              <th class="num">分数变化</th>
              <th class="num">班级名次变化</th>
              <th class="num">年级名次变化</th>
              <th>判定</th>
              <th>依据</th>
              <th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map((r, i) => `
              <tr>
                <td class="mono muted">${i + 1}</td>
                <td><div class="name-cell"><span class="avatar">${U.esc(U.avatarText(r.studentName))}</span>${U.esc(r.studentName)}</div></td>
                <td>${U.esc(r.grade || r.stage || '—')}</td>
                <td class="num mono">${Math.round(r.scoreA)}</td>
                <td class="num mono">${Math.round(r.scoreB)}</td>
                <td class="num mono ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat'}"><b>${U.signNum(r.delta, 0)}</b><span class="small muted"> ${r.deltaRate != null ? U.pct(r.deltaRate) : ''}</span></td>
                <td class="num mono">${rankCell(r.rankA, r.rankB, r.rankDelta)}</td>
                <td class="num mono">${rankCell(r.gradeRankA, r.gradeRankB, r.gradeRankDelta)}</td>
                <td>${r.judge === 'up' ? '<span class="tag tag-up">▲ 进步</span>' : r.judge === 'down' ? '<span class="tag tag-down">▼ 退步</span>' : '<span class="tag tag-flat">— 持平</span>'}</td>
                <td class="small ${r.judgeReason === 'score_down_rank_up' ? '' : ''}" style="max-width:190px">${U.esc(r.judgeText)}</td>
                <td><button class="btn btn-sm" data-profile="${U.esc(r.studentName)}">档案</button></td>
              </tr>`).join('') : `<tr><td colspan="11"><div class="empty-state"><div class="es-main">两次考试无共同学生，无法对比</div></div></td></tr>`}
            </tbody>
          </table></div>
        </div>
        <div class="card-foot">
          <button class="btn btn-primary btn-sm" id="btnExpX">导出对比 Excel</button>
          <button class="btn btn-sm" id="btnExpImg">导出图片</button>
          <button class="btn btn-sm" id="btnExpPdf">导出 PDF</button>
          <button class="btn btn-sm" id="btnPrn">打印</button>
          <span class="small muted">对比：${U.esc(examA ? examA.name : '')} → ${U.esc(examB ? examB.name : '')}</span>
        </div>
      </div>
    `;

    bind(el, rows, rowsAll, examA, examB, cid);
  }

  function rankCell(a, b, d) {
    if (a == null || b == null) return '—';
    const txt = `${a} → ${b}`;
    if (d == null || d === 0) return `<span class="flat">${txt}</span>`;
    return `${txt} <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '↑' + d : '↓' + (-d)}</span>`;
  }

  function drawBar(rowsAll) {
    const c = document.getElementById('chBar');
    if (!c) return;
    const rs = rowsAll.slice().sort((x, y) => (y.rankDelta ?? -999) - (x.rankDelta ?? -999));
    App.chart(c, {
      type: 'bar',
      data: {
        labels: rs.map(r => r.studentName),
        datasets: [{
          label: '名次提升',
          data: rs.map(r => r.rankDelta == null ? 0 : r.rankDelta),
          backgroundColor: rs.map(r => r.rankDelta > 0 ? 'rgba(12,89,75,.85)' : r.rankDelta < 0 ? 'rgba(180,35,24,.85)' : 'rgba(91,112,106,.6)'),
          borderRadius: 4, barPercentage: .78
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => '名次' + (c.parsed.y > 0 ? '前进 ' + c.parsed.y : c.parsed.y < 0 ? '后退 ' + (-c.parsed.y) : '持平') } } },
        scales: { y: { ticks: { font: { size: 12 } } }, x: { ticks: { font: { size: 12 }, maxRotation: 45 } } }
      }
    });
  }

  function bind(el, rows, rowsAll, examA, examB, cid) {
    const cs = el.querySelector('#tCampus');
    if (cs) cs.onchange = () => {
      Store.setCurrent(cs.value);
      state.a = state.b = null; state.subject = ''; state.only = 'all';
      App.refresh();
    };
    const sj = el.querySelector('#tSubject');
    if (sj) sj.onchange = () => { state.subject = sj.value; App.refresh(); };

    const sa = el.querySelector('#tA'), sb = el.querySelector('#tB');
    sa.value = state.a; sb.value = state.b;
    sa.onchange = () => { state.a = sa.value; App.refresh(); };
    sb.onchange = () => { state.b = sb.value; App.refresh(); };

    el.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { state.sort = b.dataset.sort; App.refresh(); });
    const only = el.querySelector('#tOnly');
    only.onchange = () => { state.only = only.value; App.refresh(); };

    el.querySelectorAll('[data-profile]').forEach(b => b.onclick = () => location.hash = '#/student/' + encodeURIComponent(b.dataset.profile));

    el.querySelector('#btnExpX').onclick = () => Excel.exportComparison(rows, {
      a: examA ? examA.name : '', b: examB ? examB.name : '', campus: Store.campusName()
    }, `${Store.campusName()}_进退步对比_${U.today()}.xlsx`);
    el.querySelector('#btnExpImg').onclick = () => Exporters.exportImage(el.querySelector('#cmpCard'), `${Store.campusName()}_进退步对比`);
    el.querySelector('#btnExpPdf').onclick = () => Exporters.exportPDF(el.querySelector('#cmpCard'), `${Store.campusName()}_进退步对比`, `${Store.campusName()} 进退步对比`);
    el.querySelector('#btnPrn').onclick = () => Exporters.printElement(el.querySelector('#cmpCard'), `${Store.campusName()} 进退步对比`,
      `${examA ? examA.name + '（' + examA.date + '）' : ''} → ${examB ? examB.name + '（' + examB.date + '）' : ''}`);
  }

  return {
    render,
    reset: () => { state = { a: null, b: null, sort: 'up', only: 'all', subject: '' }; }
  };
})();
