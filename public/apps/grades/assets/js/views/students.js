/* ==========================================================
   学生档案 v2：档案列表 + 个人档案页（趋势 / 名次 / 知识点雷达 / 评语）
   ========================================================== */
const ViewStudents = (() => {
  let f = { q: '', status: '', stage: '' };

  function render(el) {
    const cid = Store.currentId();
    const list = Analytics.campusTrends(cid).filter(s => {
      if (f.q && !s.name.includes(f.q)) return false;
      if (f.status && s.status !== f.status) return false;
      if (f.stage && !(s.stage === f.stage || s.grade === f.stage)) return false;
      return true;
    });
    const facets = Store.facets(cid);

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h2 class="page-title">学生档案</h2>
          <div class="page-desc">${U.esc(Store.campusName())} · 共 ${list.length} 位学生，点击进入独立成绩档案页</div>
        </div>
        <div class="toolbar">
          <div class="field xs"><label>姓名检索</label><input type="text" id="sq" placeholder="输入姓名" value="${U.esc(f.q)}" /></div>
          <div class="field xs"><label>年级/学段</label>
            <select id="sStage"><option value="">全部</option>${facets.stages.map(s => `<option ${f.stage === s ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select></div>
          <div class="field xs"><label>进退步状态</label>
            <select id="sStatus">
              <option value="">全部</option>
              <option value="up" ${f.status === 'up' ? 'selected' : ''}>进步</option>
              <option value="down" ${f.status === 'down' ? 'selected' : ''}>退步</option>
              <option value="wave" ${f.status === 'wave' ? 'selected' : ''}>波动</option>
              <option value="flat" ${f.status === 'flat' ? 'selected' : ''}>稳定</option>
            </select></div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:0">
          <div class="table-wrap"><table class="grid">
            <thead><tr>
              <th>姓名</th><th>年级/学段</th><th class="num">最近总分</th>
              <th class="num">班级名次</th><th class="num">较上次</th><th>趋势判定</th><th>评语</th><th></th>
            </tr></thead>
            <tbody>${list.length ? list.map(s => {
              const tl = s.timeline;
              const covN = tl.filter(t => t.hasComment).length;
              return `<tr class="clickable" data-go="${U.esc(s.name)}">
                <td><a class="name-cell student-profile-link" href="#/student/${encodeURIComponent(s.name)}"><span class="avatar">${U.esc(U.avatarText(s.name))}</span>${U.esc(s.name)}</a></td>
                <td>${U.esc(s.grade || s.stage || '—')}</td>
                <td class="num mono"><b>${s.lastTotal != null ? Math.round(s.lastTotal) : '—'}</b>
                  <span class="small muted">${s.lastRate != null ? U.pct(s.lastRate, 0) : ''}</span></td>
                <td class="num mono">${s.lastRank ?? '—'}<span class="small muted"> / ${s.count}次</span></td>
                <td class="num mono ${s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : 'flat'}">${s.delta == null ? '—' : U.signNum(s.delta, 0)}</td>
                <td><span class="tag ${Analytics.STATUS_TAG[s.status]}">${Analytics.STATUS_ICON[s.status]} ${s.label}</span></td>
                <td style="min-width:96px">
                  <div class="bar ${covN === tl.length ? 'ok' : covN ? 'warn' : 'bad'}"><i style="width:${tl.length ? (covN / tl.length * 100).toFixed(0) : 0}%"></i></div>
                  <div class="small muted">${covN}/${tl.length} 次已写</div>
                </td>
                <td><button class="btn btn-sm" data-pdf="${U.esc(s.name)}">导出PDF</button></td>
              </tr>`;
            }).join('') : `<tr><td colspan="8"><div class="empty-state"><div class="es-ico">☺</div><div class="es-main">暂无学生档案</div><div class="es-sub">先导入成绩数据</div></div></td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>
    `;

    const cs = el.querySelector('#sCampus');
    if (cs) cs.onchange = () => { if (!Store.attempt(() => Store.setCurrent(cs.value))) { cs.value = Store.currentId(); return; } f = { q: '', status: '', stage: '' }; App.refresh(); };
    const q = el.querySelector('#sq');
    if (q) q.oninput = U.debounce(() => { f.q = q.value.trim(); App.refresh(); const n = document.getElementById('sq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 320);
    const st = el.querySelector('#sStatus'); if (st) st.onchange = () => { f.status = st.value; App.refresh(); };
    const sg = el.querySelector('#sStage'); if (sg) sg.onchange = () => { f.stage = sg.value; App.refresh(); };
    el.querySelectorAll('[data-go]').forEach(tr => tr.onclick = (e) => {
      if (e.target.closest('[data-pdf]')) { exportOne(e.target.closest('[data-pdf]').dataset.pdf); return; }
      location.hash = '#/student/' + encodeURIComponent(tr.dataset.go);
    });
  }

  function exportOne(name) {
    U.toast('正在生成档案…');
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;background:#fff';
    document.body.appendChild(holder);
    ViewProfile.renderInto(holder, name, true);
    setTimeout(() => {
      Exporters.exportPDF(holder.firstElementChild || holder, `${Store.campusName()}_${name}_成绩档案`, `${Store.campusName()} ${name} 成绩档案`)
        .then(() => holder.remove()).catch(() => holder.remove());
    }, 260);
  }

  return { render, reset: () => { f = { q: '', status: '', stage: '' }; } };
})();


/* ---------------------------------------------------------- */
const ViewProfile = (() => {

  function render(el, name) { renderInto(el, name, false); }

  /** 找到该生最近一次有试卷打点的考试 */
  function latestPaper(tl, name) {
    const papers = Store.papers(Store.currentId()).filter(p => (p.questions || []).length);
    if (!papers.length) return null;
    const withDate = papers.map(p => ({ p, date: (Store.exam(p.examId) || {}).date || '' }))
      .sort((a, b) => b.date.localeCompare(a.date));
    return (withDate.find(x => tl.some(t => t.examId === x.p.examId)) || withDate[0]).p;
  }

  function renderInto(el, name, forExport) {
    const cid = Store.currentId();
    const tl = Analytics.studentTimeline(cid, name);
    if (!tl.length) {
      el.innerHTML = `<div class="card"><div class="empty-state"><div class="es-ico">☺</div>
        <div class="es-main">未找到「${U.esc(name)}」的成绩档案</div>
        <div class="es-sub">该学生在${U.esc(Store.campusName())}暂无成绩记录</div>
        <div style="margin-top:12px"><a class="btn btn-primary" href="#/students">返回学生档案</a></div></div></div>`;
      return;
    }
    const stu = Store.students(cid).find(s => s.name === name) || { name, stage: tl[0].stage, grade: tl[0].grade, className: tl[0].className };
    const st = Analytics.trendStatus(tl);
    const last = tl[tl.length - 1];
    const prev = tl.length > 1 ? tl[tl.length - 2] : null;
    const sd = Analytics.subjectDeltas(tl);
    const text = Analytics.analysisText(tl);
    const covN = tl.filter(t => t.hasComment).length;
    const paper = latestPaper(tl, name);
    const paperExam = paper ? Store.exam(paper.examId) : null;
    const knRep = paper ? Knowledge.analyzeStudent(paper, name) : null;

    const headHtml = forExport ? '' : `
      <div class="page-head no-print" style="margin-bottom:12px">
        <div><a class="btn btn-sm" href="#/students">← 返回学生档案</a></div>
        <div class="filters">
          <button class="btn btn-primary btn-sm" id="pPdf">导出 PDF</button>
          <button class="btn btn-sm" id="pImg">导出图片</button>
          <button class="btn btn-sm" id="pXlsx">导出 Excel</button>
          <button class="btn btn-sm" id="pPrn">打印</button>
        </div>
      </div>`;

    el.innerHTML = `${headHtml}
      <div class="card" id="profileCard">
        <div class="profile-head">
          <div class="big-avatar">${U.esc(U.avatarText(name))}</div>
          <div class="profile-meta">
            <div class="profile-name">${U.esc(name)}
              <span class="tag ${Analytics.STATUS_TAG[st.key]}">${Analytics.STATUS_ICON[st.key]} ${st.label}</span>
              <span class="tag tag-primary">${U.esc(Store.campusName())}</span>
            </div>
            <div class="profile-sub">${U.esc(stu.grade || stu.stage || '')} ${U.esc(stu.className || '')} · 共 ${tl.length} 次考试 · 评语完整度 ${covN}/${tl.length}</div>
            <div class="kv-row">
              <div class="kv"><span class="k">最近总分</span><span class="v">${Math.round(last.total)}${last.full ? `<span class="muted" style="font-size:12px"> / ${Math.round(last.full)}</span>` : ''}</span></div>
              <div class="kv"><span class="k">得分率</span><span class="v">${U.pct(last.rate)}</span></div>
              <div class="kv"><span class="k">较上次</span><span class="v ${last.delta > 0 ? 'up' : last.delta < 0 ? 'down' : 'flat'}">${last.delta == null ? '—' : U.signNum(last.delta, 0)}</span></div>
              <div class="kv"><span class="k">班级名次</span><span class="v">${last.classRank ?? '—'}${prev && prev.classRank != null && last.classRank != null ? `<span class="small ${prev.classRank - last.classRank > 0 ? 'up' : prev.classRank - last.classRank < 0 ? 'down' : 'flat'}">（${prev.classRank} → ${last.classRank}）</span>` : ''}</span></div>
              <div class="kv"><span class="k">年级名次</span><span class="v">${last.gradeRank ?? '—'}</span></div>
              <div class="kv"><span class="k">本次考试</span><span class="v" style="font-size:13px">${U.esc(last.examName)}</span></div>
            </div>
          </div>
        </div>

        <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
          <div class="two-col">
            <div>
              <div class="mini-title">历次总分变化趋势</div>
              <div class="chart-box"><canvas id="chScore"></canvas></div>
            </div>
            <div>
              <div class="mini-title">名次变化趋势（越靠上越好）</div>
              <div class="chart-box"><canvas id="chRank"></canvas></div>
            </div>
          </div>

          <div>
            <div class="mini-title">进退步分析（自动生成）</div>
            <div class="analysis-box">${U.esc(text)}</div>
          </div>

          <div>
            <div class="mini-title">最近一次科目进退分</div>
            <div class="chip-list">${sd.length ? sd.map(s => `<span class="chip">${U.esc(s.subject)} ${s.before ?? '—'} → ${s.after ?? '—'}
              ${s.delta != null ? `<b class="${s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : 'flat'}">${U.signNum(s.delta, 0)}</b>` : ''}${s.bRank ? ` <span class="muted">#${s.bRank}</span>` : ''}</span>`).join('')
              : '<span class="muted small">暂无科目明细</span>'}</div>
          </div>

          <div>
            <div class="mini-title">知识点掌握度${paper ? `　<span class="small muted" style="font-weight:400">${U.esc(paper.subject)} · ${U.esc(paperExam ? paperExam.name : '')}（${U.fmtMonth(paperExam ? paperExam.date : '')}）</span>` : ''}
              ${paper && (!knRep || !knRep.items.length) ? '<span class="ai-badge" style="font-weight:400">逐题数据待录入 / 待确认</span>' : ''}
              ${paper ? '<button class="btn btn-sm no-print" id="pKnEdit" style="margin-left:auto">录入逐题得分</button>' : ''}</div>
            ${paper && paper.images && paper.images.length ? `<div class="paper-thumbs" style="margin-bottom:10px">
              ${paper.images.slice(0, 4).map(im => `<div class="paper-thumb" style="width:66px;height:86px"><img src="${im.dataUrl}" alt="" /></div>`).join('')}
              ${paper.images.length > 4 ? `<div class="small muted" style="align-self:center">共 ${paper.images.length} 张</div>` : ''}
            </div>` : ''}
            ${knRep && knRep.items.length ? `
              <div class="kn-grid">
                <div class="chart-box" style="height:280px"><canvas id="pKnRadar"></canvas></div>
                <div>
                  ${knRep.weak.length ? `<div class="chip-list" style="margin-bottom:10px">
                    ${knRep.weak.map(w => `<span class="chip" style="border-color:#f3c9ca;background:var(--down-soft);color:var(--down)">${U.esc(w.knowledge)} ${U.pct(w.rate, 0)}</span>`).join('')}
                  </div>` : '<div class="small muted" style="margin-bottom:10px">本次无低于 60% 的知识点</div>'}
                  <div class="advice-box"><b style="font-size:12px">逐题数据建议（规则生成）</b>
                    <ol>${knRep.advice.map(a => `<li>${U.esc(a)}</li>`).join('')}</ol>
                  </div>
                  ${knRep.missing ? '<div class="small muted" style="margin-top:6px">仅统计已确认且有该生得分的题目，未录入/未确认部分不参与计算。</div>' : ''}
                </div>
              </div>` : `<div class="small muted">该生逐题数据待录入 / 待确认。请先录入知识点、满分与该生逐题得分；照片、总分或班均不能生成个人雷达图。</div>`}
          </div>

          <div>
            <div class="mini-title">历次考试成绩</div>
            <div class="table-wrap"><table class="grid">
              <thead><tr><th>考试名称</th><th>日期</th><th>类型</th><th class="num">总分</th><th class="num">满分</th><th class="num">得分率</th><th class="num">班级名次</th><th class="num">年级名次</th><th class="num">判定</th></tr></thead>
              <tbody>${tl.map(t => `<tr>
                <td>${U.esc(t.examName)}</td><td class="mono">${U.fmtMonth(t.date)}</td>
                <td><span class="chip">${U.esc(t.type || '—')}</span></td>
                <td class="num mono"><b>${Math.round(t.total)}</b></td>
                <td class="num mono muted">${t.full ? Math.round(t.full) : '—'}</td>
                <td class="num mono">${U.pct(t.rate)}</td>
                <td class="num mono">${t.classRank ?? '—'}</td>
                <td class="num mono">${t.gradeRank ?? '—'}</td>
                <td class="num mono ${t.judge === 'up' ? 'up' : t.judge === 'down' ? 'down' : 'flat'}">${t.judge === 'up' ? '进步' : t.judge === 'down' ? '退步' : t.judge === 'flat' ? '持平' : '首次'}</td>
              </tr>`).join('')}</tbody></table></div>
          </div>

          <div>
            <div class="mini-title">老师评语汇总（${covN}/${tl.length}）</div>
            <div class="comment-list" style="max-height:none">
              ${tl.map(t => t.comments.length ? `
                <div class="comment-item">
                  <div class="cm-head"><span><b>${U.esc(t.examName)}</b> · ${U.fmtMonth(t.date)} · ${U.esc(t.type || '')}</span><span>${t.comments.length} 科</span></div>
                  <div class="cm-body" style="display:flex;flex-direction:column;gap:5px">
                    ${t.comments.map(c => `<div><span class="tag tag-primary" style="margin-right:6px">${U.esc(c.subject || '')}</span>${U.esc(c.text)}</div>`).join('')}
                  </div>
                </div>` : `
                <div class="comment-item empty">
                  <div class="cm-head"><span><b>${U.esc(t.examName)}</b> · ${U.fmtMonth(t.date)}</span></div>
                  <div class="cm-body">本次考试老师未写评语，建议补填学情总结。</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    drawCharts(tl, knRep);
    if (forExport) return;
    const card = el.querySelector('#profileCard');
    el.querySelector('#pPdf').onclick = () => Exporters.exportPDF(card, `${Store.campusName()}_${name}_成绩档案`, `${Store.campusName()} ${name} 成绩档案`);
    el.querySelector('#pImg').onclick = () => Exporters.exportImage(card, `${Store.campusName()}_${name}_成绩档案`);
    el.querySelector('#pXlsx').onclick = () => Excel.exportStudentProfile(name, tl, `${Store.campusName()}_${name}_成绩档案.xlsx`);
    const pkn = el.querySelector('#pKnEdit');
    if (pkn && paper) pkn.onclick = () => ViewKnowledge.openScoreEntry(paper, name, () => App.refresh());
    el.querySelector('#pPrn').onclick = () => Exporters.printElement(card, `${name} 成绩档案`, `${U.esc(Store.campusName())}　${U.esc(stu.grade || stu.stage || '')}　${U.esc(stu.className || '')}　打印时间：${U.fmtDate(new Date())}`);
  }

  function drawCharts(tl, knRep) {
    const labels = tl.map(t => t.examName + '\n' + t.date);
    const c1 = document.getElementById('chScore');
    if (c1) App.chart(c1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '总分', data: tl.map(t => Number(t.total.toFixed(1))),
          borderColor: '#0c5947', backgroundColor: 'rgba(12,89,71,.10)',
          tension: .3, fill: true, pointRadius: 4, pointBackgroundColor: '#0c5947'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { afterLabel: (c) => { const t = tl[c.dataIndex]; return (t.delta == null ? '首次记录' : '较上次 ' + U.signNum(t.delta, 0) + ' 分') + (t.classRank != null ? ` · 班级第 ${t.classRank} 名` : ''); } } }
        },
        scales: { y: { ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: false, callback: (v) => String(labels[v] || '').split('\n') } } }
      }
    });

    const c2 = document.getElementById('chRank');
    if (c2) App.chart(c2, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '班级名次', data: tl.map(t => t.classRank), borderColor: '#e08a00', backgroundColor: 'rgba(224,138,0,.10)', tension: .3, pointRadius: 4, spanGaps: true },
          { label: '年级名次', data: tl.map(t => t.gradeRank), borderColor: '#8a5cff', backgroundColor: 'rgba(138,92,255,.08)', tension: .3, pointRadius: 4, borderDash: [5, 4], spanGaps: true }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y: { reverse: true, title: { display: true, text: '名次（数值越小越好）', font: { size: 10 } }, ticks: { font: { size: 11 } } },
          x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: false, callback: (v) => String(labels[v] || '').split('\n') } }
        }
      }
    });

    const c3 = document.getElementById('pKnRadar');
    if (c3 && knRep && knRep.radar.labels.length) App.chart(c3, {
      type: 'radar',
      data: {
        labels: knRep.radar.labels.map(l => l.length > 10 ? l.slice(0, 10) + '…' : l),
        datasets: [{
          label: '掌握度(%)', data: knRep.radar.values,
          borderColor: '#0c5947', backgroundColor: 'rgba(12,89,71,.16)',
          pointBackgroundColor: '#0c5947', pointRadius: 3, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0, max: 100, beginAtZero: true,
            angleLines: { color: '#e6eaf2' }, grid: { color: '#eef1f7' },
            pointLabels: { font: { size: 10 }, color: '#5a6478' },
            ticks: { display: false, stepSize: 20 }
          }
        }
      }
    });
  }

  return { render, renderInto };
})();
