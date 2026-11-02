/* ==========================================================
   知识点诊断面板（成绩列表 → 知识点诊断 Tab）
   - 考试级：各知识点得分率排序，优势(>80%) / 薄弱(<60%)
   - 个人级：知识点掌握雷达 + 薄弱清单 + 提升建议
   ========================================================== */
const ViewKnowledge = (() => {
  let S = { examId: '', subject: '', student: '' };

  function ensureCtx() {
    const cid = Store.currentId();
    const exams = Store.exams(cid);
    if (!exams.length) { S.examId = ''; S.subject = ''; return; }
    if (!S.examId || !exams.find(e => e.id === S.examId)) {
      const withPaper = exams.slice().reverse().find(e => Store.papers(cid, e.id).length);
      S.examId = (withPaper || exams[exams.length - 1]).id;
    }
    const subs = subjectsOf(S.examId);
    if (!S.subject || subs.indexOf(S.subject) < 0) {
      const p = Store.papers(cid, S.examId)[0];
      S.subject = p ? p.subject : (subs[0] || '');
    } else if (!Store.paper(S.examId, S.subject)) {
      // 当前学科还没有打点数据时，自动切到已有试卷的学科
      const p = Store.papers(cid, S.examId)[0];
      if (p) S.subject = p.subject;
    }
  }

  function subjectsOf(examId) {
    return Array.from(new Set(Store.records({ examId }).map(r => r.subject).filter(s => !Analytics.isTotalSubject(s))));
  }

  function render(el) {
    ensureCtx();
    const cid = Store.currentId();
    const exams = Store.exams(cid);
    if (!exams.length) {
      el.innerHTML = `<div class="card"><div class="empty-state"><div class="es-ico">◫</div>
        <div class="es-main">暂无考试数据</div><div class="es-sub">请先在「成绩明细」中上传成绩</div></div></div>`;
      return;
    }
    const subs = subjectsOf(S.examId);
    const paper = Store.paper(S.examId, S.subject);
    const report = paper ? Knowledge.analyzePaper(paper) : null;
    const exam = Store.exam(S.examId);

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title"><span class="dot"></span>知识点诊断
            <span class="ai-badge">考试级报告</span></div>
          <div class="toolbar">
            <div class="field"><label>考试</label>
              <select id="knExam">${exams.map(e => `<option value="${e.id}" ${e.id === S.examId ? 'selected' : ''}>${U.esc(e.name)}（${e.date}）</option>`).join('')}</select></div>
            <div class="field xs"><label>学科</label>
              <select id="knSubject">${subs.map(s => `<option ${s === S.subject ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select></div>
            <button class="btn btn-sm btn-primary" id="knUpload">📷 上传试卷 / 打点</button>
          </div>
        </div>
        <div class="card-body">
          ${paper ? renderPaper(paper, report) : renderEmptyPaper(exam)}
        </div>
      </div>
    `;
    bind(el, paper);
  }

  function renderEmptyPaper(exam) {
    return `<div class="empty-state" style="padding:38px 20px">
      <div class="es-ico">📷</div>
      <div class="es-main">「${U.esc(exam ? exam.name : '')}」暂无试卷快照</div>
      <div class="es-sub">上传本次试卷图片，并为每道题标注知识点，即可生成知识点掌握度报告与个人雷达图</div>
      <div style="margin-top:14px"><button class="btn btn-primary" id="knUpload2">上传试卷快照</button></div>
    </div>`;
  }

  function renderPaper(paper, report) {
    const kn = report.items.length;
    const strong = report.strong, weak = report.weak;
    return `
      ${paper.images && paper.images.length ? `<div class="paper-thumbs" style="margin-bottom:14px">
        ${paper.images.map(im => `<div class="paper-thumb"><img src="${im.dataUrl}" alt="" /></div>`).join('')}
      </div>` : `<div class="small muted" style="margin-bottom:10px">未上传试卷图片，仅使用题目打点数据（不影响报告计算）</div>`}

      <div class="kn-grid">
        <div>
          <div class="mini-title">知识点掌握度（考试级）
            <span class="small muted" style="font-weight:400">共 ${kn} 个知识点 · 整体得分率 ${U.pct(report.overall, 1)}</span>
            ${paper.auto ? '<span class="ai-badge" style="font-weight:400">由试卷快照自动生成</span>' : ''}
          </div>
          <div style="max-height:340px;overflow:auto" class="scroll-sm">
            ${report.items.map(i => `
              <div class="kn-item">
                <div class="kn-name" title="${U.esc(i.knowledge)}">${U.esc(i.knowledge)}</div>
                <div class="kn-bar"><div class="bar ${i.level === 'strong' ? 'ok' : i.level === 'weak' ? 'bad' : 'warn'}"><i style="width:${Math.round((i.rate || 0) * 100)}%"></i></div></div>
                <div class="kn-val">${U.pct(i.rate, 0)}</div>
                <div class="kn-tag ${i.level === 'strong' ? 'kn-strong' : i.level === 'weak' ? 'kn-weak' : 'kn-mid'}">${i.level === 'strong' ? '优势' : i.level === 'weak' ? '薄弱' : '待提'}</div>
              </div>`).join('')}
          </div>
          <div class="danger-tip" style="margin-top:10px">
            优势知识点 ${strong.length} 个（≥80%）　薄弱知识点 ${weak.length} 个（&lt;60%）
            ${weak.length ? `　薄弱：${weak.slice(0, 4).map(w => U.esc(w.knowledge)).join('、')}` : ''}
          </div>
        </div>

        <div>
          <div class="mini-title">题目打点明细
            <span class="small muted" style="font-weight:400">${(paper.questions || []).length} 题</span>
            <button class="btn btn-sm" id="knEdit" style="margin-left:auto">校正打点</button>
          </div>
          <div style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:9px" class="scroll-sm">
            <table class="grid">
              <thead><tr><th style="width:46px">题号</th><th>知识点</th><th class="num">满分</th><th class="num">班均</th><th class="num">得分率</th></tr></thead>
              <tbody>${(paper.questions || []).map(q => {
                const r = q.full ? (Number(q.avgScore) || 0) / q.full : null;
                return `<tr>
                  <td class="mono">${q.no}</td>
                  <td class="small">${U.esc(q.knowledge)}</td>
                  <td class="num mono">${q.full}</td>
                  <td class="num mono">${q.avgScore ?? '—'}</td>
                  <td class="num mono ${r != null && r < 0.6 ? 'down' : ''}">${U.pct(r, 0)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="adj-note" style="margin-top:14px">
        个人知识点雷达与专项建议请到「学生档案」查看：档案页按该生真实得分率换算掌握度，并自动生成 AI 提升建议。
      </div>
    `;
  }

  /** 录入某学生逐题得分 */
  function openScoreEntry(paper, name, after) {
    const qs = (paper.questions || []);
    U.modal({
      title: `录入逐题得分 · ${name}`,
      body: `
        <div class="small muted" style="margin-bottom:8px">共 ${qs.length} 题，留空则按全班平均分估算</div>
        <div style="max-height:380px;overflow:auto;border:1px solid var(--line);border-radius:9px" class="scroll-sm">
          <table class="grid">
            <thead><tr><th style="width:50px">题号</th><th>知识点</th><th class="num" style="width:70px">满分</th><th class="num" style="width:90px">该生得分</th></tr></thead>
            <tbody>${qs.map((q, i) => `<tr>
              <td class="mono">${q.no}</td>
              <td class="small">${U.esc(q.knowledge)}</td>
              <td class="num mono">${q.full}</td>
              <td class="num"><input type="number" data-si="${i}" value="${(q.scores && q.scores[name] != null) ? q.scores[name] : ''}" style="height:28px;padding:0 6px" /></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      `,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="seOk">保存</button>`,
      onMount(box) {
        box.querySelector('#seOk').onclick = () => {
          box.querySelectorAll('[data-si]').forEach(inp => {
            const i = Number(inp.dataset.si);
            const v = U.num(inp.value);
            qs[i].scores = qs[i].scores || {};
            if (v == null) delete qs[i].scores[name];
            else qs[i].scores[name] = v;
          });
          Store.savePaper({
            examId: paper.examId, campusId: paper.campusId, subject: paper.subject,
            images: paper.images || [], questions: qs
          });
          U.closeModal(); U.toast('已保存逐题得分', 'ok');
          if (after) after();
        };
      }
    });
  }

  function bind(el, paper) {
    const ex = el.querySelector('#knExam');
    if (ex) ex.onchange = () => { S.examId = ex.value; S.subject = ''; S.student = ''; App.refresh(); };
    const sub = el.querySelector('#knSubject');
    if (sub) sub.onchange = () => { S.subject = sub.value; S.student = ''; App.refresh(); };

    const up = el.querySelector('#knUpload') || el.querySelector('#knUpload2');
    if (up) up.onclick = () => ViewImport.openPaperModal(S.examId, S.subject, () => App.refresh());
    const edit = el.querySelector('#knEdit');
    if (edit) edit.onclick = () => ViewImport.openPaperModal(S.examId, S.subject, () => App.refresh());

  }

  /** 从成绩明细跳转时定位到指定学生 / 考试 / 学科 */
  function focus(studentName, examId, subject) {
    if (examId) S.examId = examId;
    if (subject !== undefined && subject !== null) S.subject = subject;
    S.student = studentName || '';
  }

  return { render, focus, openScoreEntry, reset: () => { S = { examId: '', subject: '', student: '' }; }, get state() { return S; } };
})();
