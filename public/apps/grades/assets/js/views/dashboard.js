/* ==========================================================
   总览看板 v2
   - 校区选择前置；进步/退步榜各显示 5 条 + 显示更多；两卡等高
   - 本校区提分率（可按学科切换，支持"全部"）
   - 危险预警：连续两次及以上综合退步
   ========================================================== */
const ViewDashboard = (() => {
  let state = { a: null, b: null, subject: '', moreUp: false, moreDown: false, moreDanger: false };

  function pickDefaultExams() {
    const ex = Store.exams();
    if (!ex.length) { state.a = state.b = null; return; }
    if (ex.length === 1) { state.a = state.b = ex[0].id; return; }
    state.b = ex[ex.length - 1].id;
    state.a = ex[ex.length - 2].id;
  }

  function render(el) {
    const cid = Store.currentId();
    const ex = Store.exams(cid);
    if (!ex.length) { el.innerHTML = emptyPage(); bindEmpty(el); return; }
    if (!state.a || !state.b || !ex.find(e => e.id === state.a) || !ex.find(e => e.id === state.b)) pickDefaultExams();

    const subject = state.subject || '';
    const rows = Analytics.compareExams(state.a, state.b, subject);
    const up = rows.filter(r => r.judge === 'up').sort((x, y) => (y.rankDelta ?? 0) - (x.rankDelta ?? 0) || y.delta - x.delta);
    const down = rows.filter(r => r.judge === 'down').sort((x, y) => (x.rankDelta ?? 0) - (y.rankDelta ?? 0) || x.delta - y.delta);
    const flat = rows.filter(r => r.judge === 'flat');
    const lift = Analytics.campusLiftRate(state.a, state.b, subject);
    const diff = Analytics.paperDifficulty(state.a, state.b, subject);
    const danger = Analytics.dangerList(cid, subject);
    const examA = Store.exam(state.a), examB = Store.exam(state.b);
    const facets = Store.facets(cid);

    el.innerHTML = `
      ${pageHead(ex, facets, subject)}
      ${statCards(up.length, down.length, flat.length, lift, diff)}
      <div class="two-col" style="margin-bottom:16px;align-items:stretch">
        ${rankCard('进步榜', 'up', up, examA, examB)}
        ${rankCard('退步榜', 'down', down, examA, examB)}
      </div>
      ${dangerCard(danger, subject)}
    `;
    bind(el, examA, examB, rows);
  }

  function pageHead(ex, facets, subject) {
    const opts = ex.map(e => `<option value="${e.id}">${U.esc(e.name)}（${e.date}）</option>`).join('');
    return `
      <div class="page-head">
        <div>
          <h2 class="page-title">总览看板</h2>
          <div class="page-desc">按名次校正判定进退步：分数下降但名次前进时，视为试卷偏难，不计为退步</div>
        </div>
        <div class="toolbar">
          <div class="field"><label>上次考试</label><select id="selA">${opts}</select></div>
          <div class="field"><label>本次考试</label><select id="selB">${opts}</select></div>
          <button class="btn btn-primary btn-sm" id="btnExportCmp">导出对比清单</button>
        </div>
      </div>`;
  }

  function statCards(upN, downN, flatN, lift, diff) {
    const subjOpts = ['', ...Store.facets().subjects];
    const sel = `<select id="liftSubject">${subjOpts.map(s => `<option value="${s}" ${state.subject === s ? 'selected' : ''}>${s || '全部'}</option>`).join('')}</select>`;
    const diffTxt = diff ? `本次试卷平均得分率 ${U.pct(diff.rateB, 1)}（较上次 ${diff.diff >= 0 ? '+' : ''}${(diff.diff * 100).toFixed(1)}%）` : '';
    return `<div class="stat-grid s4">
      <div class="stat s-up">
        <div class="stat-label">进步人数</div>
        <div class="stat-value" style="color:var(--up)">${upN}</div>
        <div class="stat-sub">占 ${pct(upN, upN + downN + flatN)}</div>
      </div>
      <div class="stat s-down">
        <div class="stat-label">退步人数</div>
        <div class="stat-value" style="color:var(--down)">${downN}</div>
        <div class="stat-sub">占 ${pct(downN, upN + downN + flatN)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">持平人数</div>
        <div class="stat-value">${flatN}</div>
        <div class="stat-sub">分数与名次基本不变</div>
      </div>
      <div class="stat wide ${lift.rate >= 0.5 ? 's-up' : 's-down'}">
        <div class="lift-head">
          <div>
            <div class="stat-label">本校区提分率</div>
            <div class="stat-value" style="color:${lift.rate >= 0.5 ? 'var(--up)' : 'var(--down)'}">${U.pct(lift.rate, 1)}</div>
          </div>
          <div style="text-align:right">
            <div class="stat-label" style="margin-bottom:4px">学科</div>
            ${sel}
          </div>
        </div>
        <div class="lift-foot">
          <span>提分 ${lift.up} / 对比 ${lift.total} 人</span>
          <span>平均 ${U.signNum(lift.avgDelta, 1)} 分</span>
          <span>名次提升 ${lift.rankUp} 人（${U.pct(lift.rankRate, 0)}）</span>
        </div>
        ${diffTxt ? `<div class="small muted" style="margin-top:4px">${diffTxt}</div>` : ''}
      </div>
    </div>`;
  }
  const pct = (n, total) => total ? (n / total * 100).toFixed(0) + '%' : '0%';

  const RANK_LIMIT = 5;

  function rankCard(title, kind, list, examA, examB) {
    const isUp = kind === 'up';
    const color = isUp ? 'var(--up)' : 'var(--down)';
    const expanded = isUp ? state.moreUp : state.moreDown;
    const shown = expanded ? list : list.slice(0, RANK_LIMIT);
    const rest = list.length - shown.length;

    const body = shown.length ? `<div class="rank-list scroll-sm ${expanded ? 'expanded' : ''}">${shown.map((r, i) => `
      <div class="rank-item ${isUp ? 'top' : 'bot'}">
        <div class="rank-no">${i + 1}</div>
        <div class="rank-name">${U.esc(r.studentName)}
          <div class="rank-sub">${U.esc(r.grade || r.stage || '')} · ${Math.round(r.scoreA)} → ${Math.round(r.scoreB)} 分
            ${r.rankDelta != null ? ` · 名次${r.rankDelta > 0 ? '↑' + r.rankDelta : r.rankDelta < 0 ? '↓' + (-r.rankDelta) : '持平'}` : ''}
            ${r.judgeReason === 'score_down_rank_up' ? ' · <span style="color:var(--primary)">试卷偏难</span>' : ''}
            ${r.judgeReason === 'score_up_rank_down' ? ' · <span style="color:var(--warn)">试卷偏易</span>' : ''}
          </div>
        </div>
        <div class="rank-delta" style="color:${color}">${U.signNum(r.delta, 0)}</div>
      </div>`).join('')}</div>`
      : `<div class="rank-list collapsed"><div class="rank-empty">本次没有${title.replace('榜', '')}的学生</div></div>`;

    return `<div class="card balance-card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:${color}"></span>${title}
          <span class="tag ${isUp ? 'tag-up' : 'tag-down'}">${list.length} 人</span></div>
        <span class="small muted">${isUp ? '按名次提升幅度排序' : '按名次下滑幅度排序'}</span>
      </div>
      <div class="card-body" style="padding:12px">
        ${body}
        ${list.length > RANK_LIMIT ? `<button class="rank-more" data-more="${kind}">${expanded ? '收起' : `显示更多（还有 ${rest} 人）`}</button>` : ''}
      </div>
      <div class="card-foot">
        <button class="btn btn-sm" data-export="${kind}">导出${title}</button>
        <span class="small muted">对比：${U.esc(examA ? examA.name : '')} → ${U.esc(examB ? examB.name : '')}${isUp ? '' : '　·　连续退步见下方预警'}</span>
      </div>
    </div>`;
  }

  function dangerCard(list, subject) {
    const expanded = state.moreDanger;
    const shown = expanded ? list : list.slice(0, RANK_LIMIT);
    const rest = list.length - shown.length;
    return `<div class="card">
      <div class="card-head">
        <div class="card-title"><span class="dot" style="background:var(--down)"></span>危险预警
          <span class="tag tag-down">${list.length} 人</span>
          <span class="small muted" style="font-weight:400">连续两次及以上综合退步</span></div>
        <span class="small muted">名次与分数同时下滑，需优先干预</span>
      </div>
      <div class="card-body" style="padding:12px">
        ${list.length ? `
          <div class="danger-list scroll-sm ${expanded ? '' : 'collapsed'}">
            ${shown.map((d, i) => `
              <div class="danger-row">
                <div class="dg-badge">${i + 1}</div>
                <div class="dg-main">
                  <div class="dg-name">${U.esc(d.name)}
                    <span class="tag tag-down" style="margin-left:6px">连续 ${d.streak} 次退步</span></div>
                  <div class="dg-sub">${U.esc(d.grade || d.stage || '')} · 累计 ${U.signNum(d.cumDelta, 0)} 分
                    ${d.cumRankDelta ? ` · 名次累计${d.cumRankDelta > 0 ? '前进' : '后退'} ${Math.abs(d.cumRankDelta)} 名` : ''}
                    · 最近：${U.esc(d.lastExam)}（${d.lastDate}，第 ${d.lastRank ?? '—'} 名）</div>
                </div>
                <button class="btn btn-sm" data-profile="${U.esc(d.name)}">档案</button>
              </div>`).join('')}
          </div>
          ${list.length > RANK_LIMIT ? `<button class="rank-more" data-more="danger">${expanded ? '收起' : `显示更多（还有 ${rest} 人）`}</button>` : ''}
          <div class="danger-tip" style="margin-top:10px">
            判定口径：以班级名次为主、分数为辅${subject ? `（当前按「${U.esc(subject)}」单科）` : '（当前按总分）'}。若出现"分数下降但名次前进"，说明试卷整体偏难，不计入预警。
          </div>`
          : `<div class="rank-empty" style="padding:34px 0">当前没有连续两次退步的学生${subject ? `（${U.esc(subject)}）` : ''}</div>`}
      </div>
    </div>`;
  }

  function bind(el, examA, examB, rows) {
    const selA = el.querySelector('#selA'), selB = el.querySelector('#selB');
    if (selA) { selA.value = state.a; selA.onchange = () => { state.a = selA.value; App.refresh(); }; }
    if (selB) { selB.value = state.b; selB.onchange = () => { state.b = selB.value; App.refresh(); }; }

    const cs = el.querySelector('#dashCampus');
    if (cs) cs.onchange = () => {
      Store.setCurrent(cs.value);
      state.a = state.b = null; state.moreUp = state.moreDown = state.moreDanger = false; state.subject = '';
      App.refresh();
    };

    const ls = el.querySelector('#liftSubject');
    if (ls) ls.onchange = () => { state.subject = ls.value; state.moreUp = state.moreDown = state.moreDanger = false; App.refresh(); };

    el.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
      const k = b.dataset.more;
      if (k === 'up') state.moreUp = !state.moreUp;
      else if (k === 'down') state.moreDown = !state.moreDown;
      else state.moreDanger = !state.moreDanger;
      App.refresh();
    });

    el.querySelectorAll('[data-profile]').forEach(b => b.onclick = () =>
      location.hash = '#/student/' + encodeURIComponent(b.dataset.profile));

    el.querySelectorAll('[data-export]').forEach(b => b.onclick = () => {
      const kind = b.dataset.export;
      const list = kind === 'up' ? rows.filter(r => r.judge === 'up') : rows.filter(r => r.judge === 'down');
      Excel.exportComparison(list, {
        a: examA ? examA.name : '', b: examB ? examB.name : '', campus: Store.campusName()
      }, `${Store.campusName()}_${kind === 'up' ? '进步榜' : '退步榜'}.xlsx`);
    });

    const be = el.querySelector('#btnExportCmp');
    if (be) be.onclick = () => Excel.exportComparison(rows, {
      a: examA ? examA.name : '', b: examB ? examB.name : '', campus: Store.campusName()
    }, `${Store.campusName()}_进退步对比.xlsx`);
  }

  function bindEmpty(el) {
    const b = el.querySelector('#goImport');
    if (b) b.onclick = () => location.hash = '#/records';
    const s = el.querySelector('#loadSample');
    if (s) s.onclick = () => App.seedSample();
  }

  function emptyPage() {
    return `<div class="card"><div class="empty-state">
      <div class="es-ico">◪</div>
      <div class="es-main">${U.esc(Store.campusName())} 暂无成绩数据</div>
      <div class="es-sub">到「成绩列表」批量上传 Excel 成绩表，或先载入示例数据查看效果</div>
      <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
        <button class="btn btn-primary" id="goImport">去录入成绩</button>
        <button class="btn" id="loadSample">载入示例数据</button>
      </div>
    </div></div>`;
  }

  return {
    render,
    reset: () => { state = { a: null, b: null, subject: '', moreUp: false, moreDown: false, moreDanger: false }; }
  };
})();
