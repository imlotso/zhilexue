/* ==========================================================
   成绩列表 v5
   - 只呈现「单次考试」数据（历史对比放在学生档案）
   - 展开可查看 / 编辑本次记录；有试卷的显示 AI 知识点诊断摘要
   - 顶部：校区 / 学科 / 年度 / 月份 / 年级 / 类型 / 评语 / 姓名
   - Tab：成绩明细 / 知识点诊断；分页 10/20/30
   ========================================================== */
const ViewRecords = (() => {
  const f = { q: '', subject: '', year: '', month: '', stage: '', type: '', comment: '' };
  let sort = { key: 'date', dir: 'desc' };
  let open = new Set();
  let page = 1, pageSize = 10;
  let tab = 'list';

  /* ---------- 数据 ---------- */
  function buildData() {
    const cid = Store.currentId();
    const subject = f.subject || '';
    const exams = Store.exams(cid).filter(e => {
      if (f.year && String(e.date).slice(0, 4) !== f.year) return false;
      if (f.month && String(e.date).slice(0, 7) !== f.month) return false;
      if (f.type && e.type !== f.type) return false;
      return true;
    });

    const rows = [];
    exams.forEach(e => {
      const agg = subject ? Analytics.aggExamBy(e.id, subject) : Analytics.aggExam(e.id);
      agg.forEach(a => {
        if (f.q && !String(a.studentName).includes(f.q)) return;
        if (f.stage && !(a.stage === f.stage || a.grade === f.stage)) return;
        if (f.comment === 'yes' && !a.hasComment) return;
        if (f.comment === 'no' && a.hasComment) return;
        rows.push(Object.assign({}, a, { subject }));
      });
    });

    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((x, y) => {
      const k = sort.key;
      let a = x[k], b = y[k];
      if (a == null) a = (k === 'total' || k === 'rate') ? -Infinity : '';
      if (b == null) b = (k === 'total' || k === 'rate') ? -Infinity : '';
      if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b), 'zh') * dir;
      return (a - b) * dir;
    });

    return { rows, facets: Store.facets(cid) };
  }

  /* ---------- 渲染 ---------- */
  function render(el) {
    const cid = Store.currentId();
    const { rows, facets } = buildData();
    const totalPage = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > totalPage) page = totalPage;
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h2 class="page-title">成绩列表</h2>
          <div class="page-desc">${U.esc(Store.campusName())} · 共 ${rows.length} 条记录${f.subject ? `（${U.esc(f.subject)} 单科）` : '（总分）'} · 点击任意一行查看本次考试明细，可直接编辑</div>
        </div>
        <div class="toolbar">
          <div class="field">
            <label>学科</label>
            <select id="rSubject"><option value="">全部（总分）</option>${facets.subjects.map(s => `<option ${f.subject === s ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select>
          </div>
          <div class="field xs"><label>年度</label>
            <select id="fYear"><option value="">全部</option>${facets.years.map(y => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
          <div class="field xs"><label>月份</label>
            <select id="fMonth"><option value="">全部</option>${facets.months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${m.slice(5)} 月</option>`).join('')}</select></div>
          <div class="field xs"><label>年级/学段</label>
            <select id="fStage"><option value="">全部</option>${facets.stages.map(s => `<option ${f.stage === s ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select></div>
          <div class="field xs"><label>测试类型</label>
            <select id="fType"><option value="">全部</option>${facets.types.map(t => `<option ${f.type === t ? 'selected' : ''}>${U.esc(t)}</option>`).join('')}</select></div>
          <div class="field xs"><label>评语</label>
            <select id="fComment">
              <option value="">不限</option>
              <option value="yes" ${f.comment === 'yes' ? 'selected' : ''}>已写</option>
              <option value="no" ${f.comment === 'no' ? 'selected' : ''}>未写</option>
            </select></div>
          <div class="field xs"><label>学生姓名</label><input type="text" id="fq" placeholder="输入姓名" value="${U.esc(f.q)}" /></div>
          <button class="btn btn-sm" id="btnReset">重置</button>
        </div>
      </div>

      ${ViewImport.barHtml()}

      <div class="tabs" role="tablist" aria-label="成绩视图">
        <button class="tab-btn ${tab === 'list' ? 'active' : ''}" data-tab="list" id="grades-tab-list" role="tab" aria-selected="${tab === 'list'}" aria-controls="tabBody" tabindex="${tab === 'list' ? '0' : '-1'}">成绩明细</button>
        <button class="tab-btn ${tab === 'kn' ? 'active' : ''}" data-tab="kn" id="grades-tab-kn" role="tab" aria-selected="${tab === 'kn'}" aria-controls="tabBody" tabindex="${tab === 'kn' ? '0' : '-1'}">知识点诊断</button>
      </div>

      <div id="tabBody" role="tabpanel" aria-labelledby="grades-tab-${tab}"></div>
    `;

    const body = el.querySelector('#tabBody');
    if (tab === 'kn') {
      ViewKnowledge.render(body);
    } else {
      body.innerHTML = listCard(rows, pageRows, totalPage);
      bindList(body, rows);
    }
    bindHead(el);
    ViewImport.bindBar(el);
  }

  function listCard(rows, pageRows, totalPage) {
    const th = (key, label, cls = '') => `<th class="sortable ${cls}" data-sort="${key}" aria-sort="${sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort-button">${label}<span aria-hidden="true">${sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></button></th>`;
    const subjMode = !!f.subject;
    return `<div class="card" id="listCard">
      <div class="card-head">
        <div class="card-title"><span class="dot"></span>成绩明细
          <span class="tag tag-primary">${rows.length} 条</span></div>
        <span class="small muted">${subjMode ? `按「${U.esc(f.subject)}」单科展示分数与单科名次` : '总分模式：各科得分合计'} · 历史对比请到学生档案</span>
      </div>
      <div class="card-body" style="padding:0">
        ${rows.length ? `<div class="table-wrap"><table class="grid">
          <thead><tr>
            <th style="width:26px"></th>
            ${th('studentName', '姓名')}
            ${th('stage', '年级/学段')}
            ${th('examName', '考试名称')}
            ${th('date', '考试年月')}
            ${th('type', '测试类型')}
            ${th('total', subjMode ? '单科得分' : '总分', 'num')}
            ${th('rate', '得分率', 'num')}
            ${th('classRank', '班级名次', 'num')}
            ${th('gradeRank', '年级名次', 'num')}
            <th>老师评语</th>
          </tr></thead>
          <tbody>
          ${pageRows.map(r => {
            const key = r.examId + '|' + r.studentName;
            const isOpen = open.has(key);
            return `<tr class="clickable ${isOpen ? 'row-open' : ''}" data-key="${U.esc(key)}">
                <td><button type="button" class="row-toggle" aria-label="${isOpen ? '收起' : '展开'} ${U.esc(r.studentName)} 的本次成绩" aria-expanded="${isOpen}"><span class="expand-icon" aria-hidden="true">▶</span></button></td>
                <td><div class="name-cell"><span class="avatar">${U.esc(U.avatarText(r.studentName))}</span>${U.esc(r.studentName)}</div></td>
                <td>${U.esc(r.grade || r.stage || '—')}</td>
                <td>${U.esc(r.examName)}</td>
                <td class="mono">${U.fmtMonth(r.date)}</td>
                <td><span class="chip">${U.esc(r.type || '—')}</span></td>
                <td class="num mono"><strong>${Math.round(r.total)}</strong><span class="muted small"> / ${r.full ? Math.round(r.full) : '—'}</span></td>
                <td class="num mono">${U.pct(r.rate)}</td>
                <td class="num mono">${r.classRank ?? '—'}</td>
                <td class="num mono">${r.gradeRank ?? '—'}</td>
                <td>${commentCell(r)}</td>
              </tr>
              ${isOpen ? detailRow(r) : ''}`;
          }).join('')}
          </tbody>
        </table></div>` : `<div class="empty-state"><div class="es-ico">☰</div><div class="es-main">没有符合条件的成绩记录</div><div class="es-sub">调整筛选条件，或用上方「手动添加成绩」录入</div></div>`}
      </div>
      ${rows.length ? pagerHtml(rows.length, totalPage) : ''}
      <div class="card-foot">
        <button class="btn btn-primary btn-sm" id="btnExportXlsx">导出 Excel</button>
        <button class="btn btn-sm" id="btnExportImg">导出图片</button>
        <button class="btn btn-sm" id="btnExportPdf">导出 PDF</button>
        <button class="btn btn-sm" id="btnPrint">打印</button>
        <span class="small muted">导出/打印均为当前筛选结果（含全部页）</span>
      </div>
    </div>`;
  }

  /** 评语列：总分模式显示已写科目数，单科模式显示是否已写 */
  function commentCell(r) {
    if (f.subject) {
      return r.hasComment
        ? '<span class="tag tag-up">已写</span>'
        : '<span class="tag tag-flat" style="color:var(--warn);background:var(--warn-soft)">未写</span>';
    }
    const total = (r.subjects || []).length || 1;
    const done = (r.comments || []).length;
    if (!done) return '<span class="tag tag-flat" style="color:var(--warn);background:var(--warn-soft)">未写</span>';
    return `<span class="tag ${done >= total ? 'tag-up' : 'tag-wave'}">已写 ${done}/${total} 科</span>`;
  }

  function pagerHtml(total, totalPage) {
    const nums = [];
    if (totalPage <= 7) for (let i = 1; i <= totalPage; i++) nums.push(i);
    else {
      nums.push(1);
      if (page > 3) nums.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPage - 1, page + 1); i++) nums.push(i);
      if (page < totalPage - 2) nums.push('...');
      nums.push(totalPage);
    }
    return `<div class="pager">
      <div class="pg-left">
        <span>共 ${total} 条</span>
        <span>每页</span>
        <select id="pgSize" aria-label="每页记录数">${[10, 20, 30].map(n => `<option value="${n}" ${pageSize === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span>条</span>
      </div>
      <div class="pg-btns">
        <button class="pg-btn" data-pg="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        ${nums.map(n => n === '...' ? '<span class="pg-dots">…</span>' : `<button class="pg-btn ${n === page ? 'active' : ''}" data-pg="${n}" ${n === page ? 'aria-current="page"' : ''} aria-label="第 ${n} 页">${n}</button>`).join('')}
        <button class="pg-btn" data-pg="next" ${page >= totalPage ? 'disabled' : ''}>下一页</button>
      </div>
    </div>`;
  }

  /* ---------- 展开：本次考试明细 ---------- */
  function detailRow(r) {
    const exam = Store.exam(r.examId) || {};
    const papers = Store.papers(Store.currentId(), r.examId)
      .filter(p => !f.subject || p.subject === f.subject);
    const allRecs = Store.allRecords().filter(x => x.examId === r.examId && x.studentName === r.studentName);
    const recs = f.subject ? allRecs.filter(x => x.subject === f.subject) : allRecs;

    return `<tr class="detail-row" data-exam="${U.esc(r.examId)}" data-student="${U.esc(r.studentName)}"><td colspan="12"><div class="detail-box">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <div style="font-weight:700;font-size:14px">${U.esc(r.studentName)} · ${U.esc(exam.name || '')}
          <span class="tag tag-primary">${U.fmtMonth(exam.date)}</span>
          <span class="tag tag-flat">${U.esc(exam.type || '')}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" data-edit="1">✎ 编辑本次记录</button>
          ${papers.length ? '<button class="btn btn-sm" data-kn="1">知识点诊断 →</button>' : ''}
          <button class="btn btn-sm" data-profile="${U.esc(r.studentName)}">个人档案 →</button>
        </div>
      </div>

      <div class="detail-grid">
        <div>
          <div class="mini-title">${f.subject ? `本次「${U.esc(f.subject)}」成绩` : '本次各科成绩'}
            <span class="small muted" style="font-weight:400">共 ${recs.length} 条记录</span></div>
          <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px">
            <table class="grid">
              <thead><tr><th>科目</th><th class="num">得分</th><th class="num">满分</th><th class="num">得分率</th><th class="num">班名</th><th class="num">年名</th><th>评语</th></tr></thead>
              <tbody>${recs.length ? recs.map(x => {
                const rate = x.fullScore ? x.score / x.fullScore : null;
                return `<tr>
                  <td><b>${U.esc(x.subject)}</b></td>
                  <td class="num mono">${x.score}</td>
                  <td class="num mono muted">${x.fullScore ?? '—'}</td>
                  <td class="num mono">${U.pct(rate)}</td>
                  <td class="num mono">${x.classRank ?? '—'}</td>
                  <td class="num mono">${x.gradeRank ?? '—'}</td>
                  <td>${x.comment ? '<span class="tag tag-up">已写</span>' : '<span class="tag tag-flat" style="color:var(--warn);background:var(--warn-soft)">未写</span>'}</td>
                </tr>`;
              }).join('') : `<tr><td colspan="7"><div class="small muted" style="padding:12px">无记录</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <div class="mini-title">本次老师评语</div>
            <div class="comment-list">
              ${recs.filter(x => x.comment).length
                ? recs.filter(x => x.comment).map(x => `
                  <div class="comment-item">
                    <div class="cm-head"><span><b>${U.esc(x.subject)}</b></span><span>${U.esc(x.stage || '')}</span></div>
                    <div class="cm-body">${U.esc(x.comment)}</div>
                  </div>`).join('')
                : `<div class="comment-item empty">本次考试暂无老师评语，可点右上「编辑本次记录」补写。</div>`}
            </div>
          </div>

          <div>
            <div class="mini-title">知识点诊断
              <span class="small muted" style="font-weight:400">${papers.length ? '已按试卷自动生成' : '未上传本次试卷'}</span></div>
            ${papers.length ? papers.map(p => {
              const rep = Knowledge.analyzePaper(p);
              const weak = rep.weak.slice(0, 3), strong = rep.strong.slice(0, 3);
              return `<div class="analysis-box" style="font-size:12px;line-height:1.8;margin-bottom:8px">
                <b>${U.esc(p.subject)}</b> · 平均得分率 ${U.pct(rep.overall, 1)} · ${rep.items.length} 个知识点
                ${p.auto ? '<span class="ai-badge">AI 自动生成</span>' : ''}
                <div style="margin-top:4px">${weak.length ? `薄弱：${weak.map(w => `${U.esc(w.knowledge)} ${U.pct(w.rate, 0)}`).join('、')}` : '无明显薄弱点'}</div>
                <div class="muted">${strong.length ? `优势：${strong.map(w => `${U.esc(w.knowledge)} ${U.pct(w.rate, 0)}`).join('、')}` : ''}</div>
              </div>`;
            }).join('') : `<div class="small muted">在「知识点诊断」Tab 可上传本次试卷照片，系统将自动生成知识点掌握度与 AI 提升建议（个人版见学生档案）。</div>`}
          </div>
        </div>
      </div>
    </div></td></tr>`;
  }

  /* ---------- 交互 ---------- */
  function bindHead(el) {
    const cs = el.querySelector('#rCampus');
    if (cs) cs.onchange = () => {
      Store.setCurrent(cs.value);
      Object.assign(f, { q: '', subject: '', year: '', month: '', stage: '', type: '', comment: '' });
      page = 1; open.clear(); ViewKnowledge.reset(); App.refresh();
    };
    const rs = el.querySelector('#rSubject');
    if (rs) rs.onchange = () => { f.subject = rs.value; page = 1; open.clear(); App.refresh(); };

    const q = el.querySelector('#fq');
    if (q) q.oninput = U.debounce(() => {
      f.q = q.value.trim(); page = 1; App.refresh();
      const n = document.getElementById('fq');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 320);

    const bindSel = (id, key) => { const s = el.querySelector(id); if (s) s.onchange = () => { f[key] = s.value; page = 1; App.refresh(); }; };
    bindSel('#fYear', 'year'); bindSel('#fMonth', 'month'); bindSel('#fStage', 'stage');
    bindSel('#fType', 'type'); bindSel('#fComment', 'comment');

    const reset = el.querySelector('#btnReset');
    if (reset) reset.onclick = () => {
      Object.assign(f, { q: '', subject: '', year: '', month: '', stage: '', type: '', comment: '' });
      page = 1; open.clear(); App.refresh();
    };

    el.querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => { tab = b.dataset.tab; App.refresh(); document.getElementById('grades-tab-' + tab).focus(); };
      b.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 'list' : e.key === 'End' ? 'kn' : (tab === 'list' ? 'kn' : 'list');
        document.getElementById('grades-tab-' + next).click();
      };
    });
  }

  function bindList(body, rows) {
    body.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
      const k = th.dataset.sort;
      if (sort.key === k) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else { sort.key = k; sort.dir = ['studentName', 'examName', 'stage', 'type'].includes(k) ? 'asc' : 'desc'; }
      App.refresh();
      document.querySelector(`th[data-sort="${k}"] button`)?.focus();
    });

    // 行点击：展开 / 收起
    body.querySelectorAll('tr.clickable').forEach(tr => tr.onclick = () => {
      const k = tr.dataset.key;
      if (open.has(k)) open.delete(k); else open.add(k);
      App.refresh();
      Array.from(document.querySelectorAll('tr[data-key]')).find(row => row.dataset.key === k)?.querySelector('.row-toggle')?.focus();
    });

    // 展开区内的操作按钮（detail-row 是独立 tr，需单独绑定）
    body.querySelectorAll('.detail-row').forEach(dr => {
      const examId = dr.dataset.exam, name = dr.dataset.student;
      const ed = dr.querySelector('[data-edit]');
      if (ed) ed.onclick = (e) => {
        e.stopPropagation();
        ViewImport.openEditRecord(examId, name, () => App.refresh());
      };
      const kn = dr.querySelector('[data-kn]');
      if (kn) kn.onclick = (e) => {
        e.stopPropagation();
        ViewKnowledge.focus(null, examId, f.subject);
        tab = 'kn';
        if (location.hash !== '#/records') location.hash = '#/records';
        App.refresh();
      };
      const pf = dr.querySelector('[data-profile]');
      if (pf) pf.onclick = (e) => {
        e.stopPropagation();
        location.hash = '#/student/' + encodeURIComponent(name);
      };
    });

    const pgSize = body.querySelector('#pgSize');
    if (pgSize) pgSize.onchange = () => { pageSize = Number(pgSize.value); page = 1; App.refresh(); };
    body.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => {
      const v = b.dataset.pg;
      const totalPage = Math.max(1, Math.ceil(rows.length / pageSize));
      if (v === 'prev') page = Math.max(1, page - 1);
      else if (v === 'next') page = Math.min(totalPage, page + 1);
      else page = Number(v);
      open.clear(); App.refresh();
    });

    const ex = body.querySelector('#btnExportXlsx');
    if (ex) ex.onclick = () => exportXlsx(rows);
    const img = body.querySelector('#btnExportImg');
    if (img) img.onclick = () => Exporters.exportImage(body.querySelector('#listCard'), `${Store.campusName()}_成绩列表`);
    const pdf = body.querySelector('#btnExportPdf');
    if (pdf) pdf.onclick = () => Exporters.exportPDF(body.querySelector('#listCard'), `${Store.campusName()}_成绩列表`, `${Store.campusName()} 成绩列表`);
    const prn = body.querySelector('#btnPrint');
    if (prn) prn.onclick = () => Exporters.printElement(body.querySelector('#listCard'), `${Store.campusName()} 成绩列表`,
      `${U.esc(Store.campusName())}　筛选：${filterDesc()}　打印时间：${U.fmtDate(new Date())}`);
  }

  function filterDesc() {
    const p = [];
    if (f.subject) p.push(f.subject + '（单科）');
    if (f.year) p.push(f.year + ' 年度');
    if (f.month) p.push(f.month.replace('-', ' 年 ') + ' 月');
    if (f.stage) p.push(f.stage);
    if (f.type) p.push(f.type);
    if (f.comment) p.push(f.comment === 'yes' ? '已写评语' : '未写评语');
    if (f.q) p.push('姓名含「' + f.q + '」');
    return p.join(' / ') || '全部';
  }

  function exportXlsx(rows) {
    const subjMode = !!f.subject;
    const head = ['姓名', '年级/学段', '班级', '考试名称', '考试年月', '测试类型',
      subjMode ? '单科得分' : '总分', '满分', '得分率', '班级名次', '年级名次', '老师评语'];
    const aoa = [head];
    rows.forEach(r => aoa.push([
      r.studentName, r.grade || r.stage || '', r.className || '', r.examName, U.fmtMonth(r.date), r.type || '',
      Math.round(r.total), r.full ? Math.round(r.full) : '', r.rate != null ? (r.rate * 100).toFixed(1) + '%' : '',
      r.classRank ?? '', r.gradeRank ?? '',
      r.comments.map(c => `[${c.subject}] ${c.text}`).join('；') || '（未填写）'
    ]));
    Excel.exportAOA(aoa, '成绩列表', `${Store.campusName()}_成绩列表_${U.today()}.xlsx`);
    U.toast('已导出 ' + rows.length + ' 条', 'ok');
  }

  return {
    render,
    reset: () => {
      open.clear(); page = 1; tab = 'list';
      Object.assign(f, { q: '', subject: '', year: '', month: '', stage: '', type: '', comment: '' });
    }
  };
})();
