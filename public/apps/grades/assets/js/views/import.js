/* ==========================================================
   导入工具集（已并入「成绩列表」页）
   - 紧凑导入条
   - 批量上传 Excel / 手动添加 / 试卷快照 + 知识点打点
   - 家长本机演示（二维码）
   - 数据管理（示例数据 / 清空 / 考试批次）
   ========================================================== */
const ViewImport = (() => {

  function saveSnapshot(examId, campusId, subject, images) {
    const existing = Store.paper(examId, subject);
    Store.savePaper({ examId, campusId, subject, images,
      questions: existing ? existing.questions || [] : [], auto: existing ? existing.auto : false });
  }

  /* ---------------- 紧凑导入条 ---------------- */
  function barHtml() {
    const cid = Store.currentId();
    const exN = Store.exams(cid).length;
    const recN = Store.records({ campusId: cid }).length;
    const pending = Store.pendingUploads(cid).length;
    return `<div class="import-bar">
      <div class="ib-label">⤓ 成绩录入</div>
      <button class="btn btn-primary btn-sm" id="ibManual">＋ 手动添加成绩</button>
      <div class="ib-sep"></div>
      <button class="btn btn-sm" id="ibQR">📱 家长本机演示${pending ? ` <span class="tag tag-down" style="margin-left:4px">${pending} 待审</span>` : ''}</button>
      <div class="ib-sep"></div>
      <button class="btn btn-sm" id="ibData">数据管理</button>
      <span class="ib-note">已有 ${exN} 次考试 · ${recN} 条成绩记录 · 试卷照片仅供留档，知识点诊断需人工录入逐题数据</span>
    </div>`;
  }

  function bindBar(root, onChange) {
    const cb = onChange || (() => App.refresh());
    const on = (id, fn) => { const b = root.querySelector('#' + id); if (b) b.onclick = fn; };
    on('ibManual', () => openManualModal(null, cb));
    on('ibQR', () => openQRModal());
    on('ibData', () => openDataModal(cb));
  }

  /* ================= 批量上传 ================= */
  function openUploadModal(after) {
    const campuses = Store.campuses();
    const types = ['单元测', '月考', '期中', '期末', '模拟考', '其他'];
    U.modal({
      title: '批量上传成绩（Excel）',
      body: `
        <div class="form-grid">
          <div class="field"><label>所属校区 <span class="hint">*</span></label>
            <select id="upCampus">${campuses.map(c => `<option value="${c.id}" ${c.id === Store.currentId() ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>考试名称 <span class="hint">*</span></label>
            <input type="text" id="upName" placeholder="如：期中考试 / 第三次单元测" /></div>
          <div class="field"><label>考试年月 <span class="hint">*</span></label>
            ${U.monthField('upDate', U.curMonth())}</div>
          <div class="field"><label>测试类型</label>
            <select id="upType">${types.map(t => `<option>${t}</option>`).join('')}</select></div>
        </div>
        <div class="field">
          <label>选择成绩表</label>
          <div class="dropzone" id="upDz" style="padding:18px">
            <div class="dz-ico">📄</div>
            <div class="dz-main">点击选择文件</div>
            <div class="dz-sub" id="upFileTip">.xlsx / .xls / .csv　·　表头含：姓名、学段、科目、考试类型、满分、得分、班级名次（选填）、年级名次（选填）、老师评语</div>
          </div>
        </div>
        <div id="upPreview"></div>
        <div class="field" id="upPaperWrap">
          <label>试卷快照（选填）
            <span class="hint">仅保存试卷照片；诊断需人工录入并确认知识点与逐题得分</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="upPaperSubject" style="width:auto;min-width:130px"></select>
            <button class="btn btn-sm" type="button" id="upPaperAdd">📷 上传试卷照片</button>
            <span class="small muted">最多 6 张 · 自动压缩 · 不上传不影响成绩导入</span>
          </div>
          <div class="paper-thumbs" id="upPaperThumbs" style="margin-top:8px"></div>
        </div>
      `,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="upOk" disabled>确认导入</button>`,
      onMount(box) {
        let parsed = null, fileSequence = 0;
        let paperImages = [];
        const imgInput = document.getElementById('imageInput');
        const fileInput = document.getElementById('fileInput');
        const dz = box.querySelector('#upDz');
        const thumbs = box.querySelector('#upPaperThumbs');
        const subjSel = box.querySelector('#upPaperSubject');

        const renderThumbs = () => {
          thumbs.innerHTML = paperImages.length ? paperImages.map((im, i) => `
            <div class="paper-thumb" title="${U.esc(im.name || '')}">
              <img src="${im.dataUrl}" alt="" />
              <button class="pt-del" type="button" data-di="${i}">✕</button>
            </div>`).join('') : '<div class="small muted" style="align-self:center">未选择试卷照片</div>';
          thumbs.querySelectorAll('[data-di]').forEach(b => b.onclick = () => {
            paperImages.splice(Number(b.dataset.di), 1); renderThumbs();
          });
        };
        renderThumbs();

        box.querySelector('#upPaperAdd').onclick = () => {
          if (paperImages.length >= 6) return U.toast('最多上传 6 张', 'err');
          imgInput.value = ''; imgInput.click();
        };
        imgInput.onchange = async () => {
          const files = Array.from(imgInput.files || []);
          if (!files.length) return;
          U.toast('正在压缩图片…');
          for (const f of files.slice(0, 6 - paperImages.length)) {
            try { paperImages.push({ name: f.name, dataUrl: await compressImage(f) }); }
            catch (e) { U.toast('图片处理失败：' + f.name, 'err'); }
          }
          renderThumbs();
        };

        dz.onclick = () => { fileInput.value = ''; fileInput.click(); };
        fileInput.onchange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); };

        function handleFile(file) {
          const sequence = ++fileSequence;
          parsed = null;
          box.querySelector('#upOk').disabled = true;
          box.querySelector('#upFileTip').textContent = file.name;
          Excel.readFile(file).then(res => {
            if (!dz.isConnected || sequence !== fileSequence) return;
            parsed = res.error ? null : res;
            renderPreview(res);
          }).catch(err => {
            if (!dz.isConnected || sequence !== fileSequence) return;
            parsed = null; renderPreview({ error: err.message || '解析失败' });
          });
        }

        function renderPreview(res) {
          const pv = box.querySelector('#upPreview');
          const okBtn = box.querySelector('#upOk');
          if (res.error) {
            pv.innerHTML = `<div class="analysis-box" style="border-color:var(--down);color:var(--down)">✕ ${U.esc(res.error)}</div>`;
            okBtn.disabled = true; return;
          }
          const rows = res.rows, errs = res.errors;
          const subs = Array.from(new Set(rows.map(x => x.subject).filter(x => x && !Analytics.isTotalSubject(x))));
          subjSel.innerHTML = subs.length ? subs.map(x => `<option>${U.esc(x)}</option>`).join('') : '<option value="">（无科目）</option>';
          const label = { name: '姓名', stage: '学段', grade: '年级', className: '班级', subject: '科目', type: '考试类型', fullScore: '满分', score: '得分', classRank: '班级名次', gradeRank: '年级名次', comment: '老师评语', date: '考试日期' };
          pv.innerHTML = `
            <div class="analysis-box" style="margin-bottom:10px">
              <div>✓ 表头识别成功（第 ${res.headerRow} 行），共读取 <b>${rows.length}</b> 条，异常 <b style="color:${errs.length ? 'var(--down)' : 'inherit'}">${errs.length}</b> 条。</div>
              <div class="small muted" style="margin-top:6px">已识别列：${Object.keys(res.colMap).map(c => `${label[c] || c}←第${res.colMap[c] + 1}列`).join('　')}</div>
              ${errs.length ? `<div class="small" style="color:var(--warn);margin-top:6px">异常行（导入时自动跳过）：第 ${errs.slice(0, 8).map(e => e._row).join('、')} 行${errs.length > 8 ? ' …' : ''}。${errs.slice(0, 8).map(e => `第 ${e._row} 行：${U.esc(e._err.join('；'))}`).join('；')}</div>` : ''}
            </div>
            <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:9px">
              <table class="grid"><thead><tr><th>行</th><th>姓名</th><th>学段/年级</th><th>科目</th><th>类型</th><th class="num">满分</th><th class="num">得分</th><th>班名</th><th>年名</th><th>评语</th></tr></thead>
              <tbody>${rows.slice(0, 50).map(r => `<tr>
                <td class="mono small">${r._row}</td>
                <td>${U.esc(r.studentName) || '<span style="color:var(--down)">缺失</span>'}</td>
                <td>${U.esc(r.stage || r.grade || '—')}</td>
                <td>${U.esc(r.subject)}</td>
                <td>${U.esc(r.type || '—')}</td>
                <td class="num mono">${r.fullScore ?? '—'}</td>
                <td class="num mono">${r.score ?? '—'}</td>
                <td class="num mono">${r.classRank ?? '—'}</td>
                <td class="num mono">${r.gradeRank ?? '—'}</td>
                <td class="small">${U.esc(U.clip(r.comment, 16)) || '<span class="muted">—</span>'}</td>
              </tr>`).join('')}</tbody></table>
            </div>
            ${rows.length > 50 ? `<div class="small muted" style="margin-top:6px">仅预览前 50 条，导入包含全部 ${rows.length} 条</div>` : ''}
          `;
          okBtn.disabled = !rows.some(r => !r._err || !r._err.length);
        }

        box.querySelector('#upOk').onclick = () => {
          if (!parsed) return;
          const campusId = box.querySelector('#upCampus').value;
          const name = box.querySelector('#upName').value.trim();
          const date = U.monthVal('upDate');
          const type = box.querySelector('#upType').value;
          if (!name) { U.toast('请填写考试名称', 'err'); box.querySelector('#upName').focus(); return; }
          if (!date) { U.toast('请选择考试年月', 'err'); return; }
          doImport(parsed, { campusId, name, date, type }, after, {
            subject: subjSel.value, images: paperImages
          });
        };
      }
    });
  }

  function doImport(parsed, meta, after, paperOpt) {
    // Resolve inherited classifications and replacement targets before any storage write.
    const existingExam = Store.exams(meta.campusId).find(e => e.name === meta.name && e.date === meta.date);
    const existed = existingExam ? Store.allRecords().filter(r => r.examId === existingExam.id) : [];
    const problems = [], candidates = [];
    parsed.rows.forEach(v => {
      const old = Store.allRecords().find(r => r.campusId === meta.campusId && r.studentName === v.studentName && !v.stage);
      const hit = existed.find(r => r.studentName === v.studentName && (r.subject || '总分') === (v.subject || '总分'));
      const record = {
        campusId: meta.campusId, date: v.date || meta.date,
        studentName: v.studentName,
        stage: v.stage || (old ? old.stage : ''),
        grade: v.grade || (old ? old.grade : ''),
        className: v.className || (old ? old.className : ''),
        subject: v.subject || '总分',
        type: v.type || meta.type,
        fullScore: v.fullScore, score: v.score,
        classRank: v.classRank, gradeRank: v.gradeRank,
        comment: v.comment || ''
      };
      const errors = (v._err || []).slice();
      const scopeError = Store.scopeError(record);
      if (scopeError && !errors.includes(scopeError)) errors.push(scopeError);
      if (hit && Store.scopeError(hit)) errors.push('历史高中成绩仅保留查看，不能修改或覆盖');
      if (errors.length) problems.push(`第 ${v._row} 行：${errors.join('；')}`);
      else candidates.push({ record, hit });
    });
    const detail = problems.slice(0, 3).join('；');
    if (!candidates.length) { U.toast('没有可导入的有效数据' + (detail ? '。' + detail : ''), 'err'); return; }

    let list, autoTip;
    const drop = new Set(candidates.filter(c => c.hit).map(c => c.hit.id));
    const replaced = drop.size, skipped = problems.length;
    const saved = Store.attempt(() => {
      const exam = Store.addExam({ campusId: meta.campusId, name: meta.name, date: meta.date, type: meta.type });
      list = candidates.map(({ record }) => ({ ...record, examId: exam.id }));
      Store.addRecords(list);
      drop.forEach(id => Store.deleteRecord(id));

      autoTip = '';
      if (paperOpt && paperOpt.images && paperOpt.images.length && paperOpt.subject) {
        saveSnapshot(exam.id, meta.campusId, paperOpt.subject, paperOpt.images);
        autoTip = '；试卷照片已留档，知识点与逐题得分待录入';
      }
    });
    if (!saved) return;

    U.closeModal();
    U.toast(`导入成功：新增 ${list.length - replaced} 条，覆盖 ${replaced} 条${skipped ? `，跳过异常 ${skipped} 条（${detail}）` : ''}${autoTip}`, 'ok');
    (after || App.refresh)();
  }

  /* ================= 手动添加 ================= */
  function openManualModal(examId, after) {
    const campuses = Store.campuses();
    const exams = Store.exams();
    const types = ['单元测', '月考', '期中', '期末', '模拟考', '其他'];
    U.modal({
      title: '手动添加成绩',
      body: `
        <div class="form-grid">
          <div class="field"><label>校区</label>
            <select id="mCampus">${campuses.map(c => `<option value="${c.id}" ${c.id === Store.currentId() ? 'selected' : ''}>${U.esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>考试</label>
            <select id="mExam"><option value="__new">＋ 新建考试…</option>${exams.map(e => `<option value="${e.id}" ${e.id === examId ? 'selected' : ''}>${U.esc(e.name)}（${e.date}）</option>`).join('')}</select></div>
          <div class="field"><label>考试名称</label><input type="text" id="mExamName" placeholder="新建时填写" /></div>
          <div class="field"><label>考试年月</label>${U.monthField('mDate', U.curMonth())}</div>
          <div class="field"><label>测试类型</label><select id="mType">${types.map(t => `<option>${t}</option>`).join('')}</select></div>
          <div class="field"><label>姓名 <span class="hint">*</span></label><input type="text" id="mName" /></div>
          <div class="field"><label>学段 <span class="hint">*</span></label><input type="text" id="mStage" value="初中·七年级" /></div>
          <div class="field"><label>年级</label><input type="text" id="mGrade" value="七年级" /></div>
          <div class="field"><label>班级</label><input type="text" id="mClass" placeholder="如：七(1)班" /></div>
          <div class="field"><label>科目 <span class="hint">*</span></label><input type="text" id="mSubject" placeholder="数学 / 英语 / 物理 / 化学" /></div>
          <div class="field"><label>满分 <span class="hint">*</span></label><input type="number" id="mFull" value="100" /></div>
          <div class="field"><label>得分 <span class="hint">*</span></label><input type="number" id="mScore" /></div>
          <div class="field"><label>班级名次（选填）</label><input type="number" id="mCR" /></div>
          <div class="field"><label>年级名次（选填）</label><input type="number" id="mGR" /></div>
        </div>
        <div class="field">
          <label>试卷快照（选填）
            <span class="hint">照片仅供留档，不会自动识别或生成知识点分数</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-sm" type="button" id="mmAddImg">📷 上传试卷照片</button>
            <span class="small muted">最多 6 张 · 自动压缩 · 学科取上方「科目」字段</span>
          </div>
          <div class="paper-thumbs" id="mmThumbs" style="margin-top:8px"></div>
        </div>
        <div class="field"><label>老师评语</label><textarea id="mComment" rows="3" placeholder="本次考试学情总结…"></textarea></div>
      `,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="mOk">保存</button>`,
      onMount(box) {
        const sel = box.querySelector('#mExam');
        const setMonth = (d) => {
          const v = U.monthOf(d) || U.curMonth();
          box.querySelector('#mDateY').value = v.slice(0, 4);
          box.querySelector('#mDateM').value = v.slice(5, 7);
        };
        const sync = () => {
          const isNew = sel.value === '__new';
          ['mExamName', 'mType'].forEach(id => { box.querySelector('#' + id).disabled = !isNew; });
          ['mDateY', 'mDateM'].forEach(id => { box.querySelector('#' + id).disabled = !isNew; });
          if (!isNew) {
            const e = Store.exam(sel.value);
            if (e) {
              box.querySelector('#mExamName').value = e.name;
              box.querySelector('#mType').value = e.type;
              setMonth(e.date);
            }
          }
        };
        sel.onchange = sync; sync();

        // 试卷快照
        let mmImages = [];
        const mmThumbs = box.querySelector('#mmThumbs');
        const mmImg = document.getElementById('imageInput');
        const renderMm = () => {
          mmThumbs.innerHTML = mmImages.length ? mmImages.map((im, i) => `
            <div class="paper-thumb" title="${U.esc(im.name || '')}">
              <img src="${im.dataUrl}" alt="" />
              <button class="pt-del" type="button" data-di="${i}">✕</button>
            </div>`).join('') : '<div class="small muted" style="align-self:center">未选择试卷照片</div>';
          mmThumbs.querySelectorAll('[data-di]').forEach(b => b.onclick = () => {
            mmImages.splice(Number(b.dataset.di), 1); renderMm();
          });
        };
        renderMm();
        box.querySelector('#mmAddImg').onclick = () => {
          if (mmImages.length >= 6) return U.toast('最多上传 6 张', 'err');
          mmImg.value = ''; mmImg.click();
        };
        mmImg.onchange = async () => {
          const files = Array.from(mmImg.files || []);
          if (!files.length) return;
          U.toast('正在压缩图片…');
          for (const f of files.slice(0, 6 - mmImages.length)) {
            try { mmImages.push({ name: f.name, dataUrl: await compressImage(f) }); }
            catch (e) { U.toast('图片处理失败：' + f.name, 'err'); }
          }
          renderMm();
        };

        let submitted = false;
        box.querySelector('#mOk').onclick = () => {
          if (submitted) return;
          const g = (id) => box.querySelector('#' + id).value.trim();
          const name = g('mName'), stage = g('mStage'), subject = g('mSubject');
          const full = U.num(box.querySelector('#mFull').value);
          const score = U.num(box.querySelector('#mScore').value);
          if (!name) return U.toast('请填写姓名', 'err');
          if (!stage) return U.toast('请填写学段', 'err');
          const scopeError = Store.scopeError({ stage, grade: g('mGrade'), className: g('mClass') });
          if (scopeError) return U.toast(scopeError, 'err');
          if (!subject) return U.toast('请填写科目', 'err');
          if (full == null) return U.toast('请填写满分', 'err');
          if (score == null) return U.toast('请填写得分', 'err');

          let mtip = '';
          if (sel.value === '__new' && !g('mExamName')) return U.toast('请填写考试名称', 'err');
          const saved = Store.attempt(() => {
            const campusId = box.querySelector('#mCampus').value;
            let id = sel.value, date, type;
            if (id === '__new') {
              const ename = g('mExamName');
              if (!ename) return U.toast('请填写考试名称', 'err');
              const e = Store.addExam({ campusId, name: ename, date: U.monthVal('mDate'), type: box.querySelector('#mType').value });
              id = e.id;
            }
            const e = Store.exam(id);
            date = e.date; type = e.type;
            Store.addRecords([{
              examId: id, campusId, date, studentName: name,
              stage, grade: g('mGrade'), className: g('mClass'),
              subject, type, fullScore: full, score,
              classRank: U.num(box.querySelector('#mCR').value),
              gradeRank: U.num(box.querySelector('#mGR').value),
              comment: g('mComment')
            }]);

            if (mmImages.length && subject) {
              saveSnapshot(id, campusId, subject, mmImages);
              mtip = '，试卷照片已留档，逐题数据待录入';
            }
          });
          if (!saved) return;
          submitted = true;
          U.closeModal(); U.toast('已添加' + mtip, 'ok'); (after || App.refresh)();
        };
      }
    });
  }

  /* ================= 试卷快照 + 知识点打点 ================= */
  function compressImage(file, maxW = 1100, quality = 0.62) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('图片读取失败'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败'));
        img.onload = () => {
          const scale = Math.min(1, maxW / img.width);
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function openPaperModal(examId, subject, after) {
    const exams = Store.exams();
    if (!exams.length) { U.toast('请先上传成绩，再上传试卷快照', 'err'); return; }
    const cur = examId || exams[exams.length - 1].id;
    const subjectsOfExam = Array.from(new Set(Store.records({ examId: cur }).map(r => r.subject).filter(s => !Analytics.isTotalSubject(s))));
    const subj = subject || subjectsOfExam[0] || '数学';

    U.modal({
      title: '试卷快照 · 知识点打点',
      body: `
        <div class="form-grid">
          <div class="field"><label>考试</label>
            <select id="ppExam">${exams.map(e => `<option value="${e.id}" ${e.id === cur ? 'selected' : ''}>${U.esc(e.name)}（${e.date}）</option>`).join('')}</select></div>
          <div class="field"><label>学科</label>
            <select id="ppSubject">${subjectsOfExam.map(s => `<option ${s === subj ? 'selected' : ''}>${U.esc(s)}</option>`).join('') || '<option>数学</option>'}</select></div>
        </div>
        <div class="field">
          <label>试卷快照 <span class="hint">可选上传，仅供本机留档，不进行自动识别</span></label>
          <div class="paper-thumbs" id="ppThumbs"></div>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn btn-sm" id="ppAddImg">＋ 上传试卷图片</button>
            <span class="small muted" style="align-self:center">建议单张 &lt; 1.5MB；图片仅保存在本机浏览器</span>
          </div>
        </div>
        <div class="analysis-box" style="font-size:12px;line-height:1.8">
          <b>知识点诊断引擎</b>：请依据试卷人工选择知识点、录入满分与全班逐题平均分，并确认数据。
          图片和总分不能生成知识点掌握度；没有有效逐题证据时显示待录入。
        </div>
        <div class="field">
          <label>题目与知识点打点
            <span class="hint">知识点可下拉选择，也可直接输入</span></label>
          <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <button class="btn btn-sm" id="ppDraft">添加 10 行空白草稿</button>
            <button class="btn btn-sm" id="ppAddQ">＋ 添加一行</button>
          </div>
          <div style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:9px">
            <table class="grid" id="ppTable">
              <thead><tr><th style="width:52px">题号</th><th>知识点（苏教/苏科）</th><th style="width:80px">满分</th><th style="width:100px">全班平均分</th><th style="width:56px">已确认</th><th style="width:44px"></th></tr></thead>
              <tbody id="ppBody"></tbody>
            </table>
          </div>
          <datalist id="knList"></datalist>
        </div>
      `,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="ppSave">保存打点</button>`,
      onMount(box) {
        let images = [];
        let questions = [];
        const body = box.querySelector('#ppBody');
        const thumbs = box.querySelector('#ppThumbs');
        const imgInput = document.getElementById('imageInput');

        const curPaper = () => {
          const eid = box.querySelector('#ppExam').value;
          const s = box.querySelector('#ppSubject').value;
          return Store.paper(eid, s);
        };
        const refreshKn = () => {
          const list = Knowledge.flat(box.querySelector('#ppSubject').value);
          box.querySelector('#knList').innerHTML = list.map(k => `<option value="${U.esc(k)}">`).join('');
        };
        const loadPaper = () => {
          const p = curPaper();
          images = p ? (p.images || []).slice() : [];
          questions = p ? JSON.parse(JSON.stringify(p.questions || [])).map(q => {
            if ((q.auto || p.auto) && q.confirmed !== true) return { ...q, avgScore: null, scores: {}, auto: false, confirmed: false };
            return q;
          }) : [];
          renderThumbs(); renderRows(); refreshKn();
        };
        const renderThumbs = () => {
          thumbs.innerHTML = images.length ? images.map((im, i) => `
            <div class="paper-thumb" title="${U.esc(im.name || '')}">
              <img src="${im.dataUrl}" alt="" />
              <button class="pt-del" data-di="${i}">✕</button>
            </div>`).join('') : '<div class="small muted" style="align-self:center">尚未上传试卷图片</div>';
          thumbs.querySelectorAll('[data-di]').forEach(b => b.onclick = () => {
            images.splice(Number(b.dataset.di), 1); renderThumbs();
          });
        };
        const renderRows = () => {
          body.innerHTML = questions.map((q, i) => `
            <tr>
              <td><input type="number" value="${q.no ?? i + 1}" data-q="no" data-i="${i}" style="height:28px;padding:0 6px" /></td>
              <td><input type="text" list="knList" value="${U.esc(q.knowledge || '')}" data-q="knowledge" data-i="${i}" placeholder="选择或输入知识点" style="height:28px" /></td>
              <td><input type="number" value="${q.full ?? ''}" data-q="full" data-i="${i}" style="height:28px;padding:0 6px" /></td>
              <td><input type="number" value="${q.avgScore ?? ''}" data-q="avgScore" data-i="${i}" style="height:28px;padding:0 6px" /></td>
              <td><input type="checkbox" data-q="confirmed" data-i="${i}" aria-label="第 ${i + 1} 题数据已确认" ${q.confirmed !== false ? 'checked' : ''} /></td>
              <td><button class="btn btn-sm btn-danger" data-del="${i}" style="height:26px;padding:0 6px">✕</button></td>
            </tr>`).join('') || `<tr><td colspan="6"><div class="small muted" style="padding:12px;text-align:center">逐题数据待录入，点击「添加 10 行空白草稿」或「添加一行」</div></td></tr>`;
          body.querySelectorAll('[data-q]').forEach(inp => inp.onchange = () => {
            const i = Number(inp.dataset.i), k = inp.dataset.q;
            questions[i][k] = k === 'confirmed' ? inp.checked : (k === 'no' || k === 'full' || k === 'avgScore') ? U.num(inp.value) : inp.value.trim();
          });
          body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
            questions.splice(Number(b.dataset.del), 1); renderRows();
          });
        };

        box.querySelector('#ppExam').onchange = () => {
          const eid = box.querySelector('#ppExam').value;
          const subs = Array.from(new Set(Store.records({ examId: eid }).map(r => r.subject).filter(s => !Analytics.isTotalSubject(s))));
          box.querySelector('#ppSubject').innerHTML = subs.map(s => `<option>${U.esc(s)}</option>`).join('') || '<option>数学</option>';
          loadPaper();
        };
        box.querySelector('#ppSubject').onchange = loadPaper;
        box.querySelector('#ppAddImg').onclick = () => {
          imgInput.value = ''; imgInput.click();
        };
        imgInput.onchange = async () => {
          const files = Array.from(imgInput.files || []);
          if (!files.length) return;
          U.toast('正在压缩图片…');
          for (const f of files) {
            try {
              const dataUrl = await compressImage(f);
              images.push({ name: f.name, dataUrl });
            } catch (e) { U.toast('图片处理失败：' + f.name, 'err'); }
          }
          renderThumbs();
        };
        box.querySelector('#ppDraft').onclick = () => {
          const s = box.querySelector('#ppSubject').value;
          questions = Knowledge.draftQuestions(s, 10, null);
          renderRows();
          U.toast('已添加 10 行空白草稿，请填写并逐题确认');
        };
        box.querySelector('#ppAddQ').onclick = () => {
          questions.push({ no: questions.length + 1, knowledge: '', full: 10, avgScore: null, scores: {} });
          renderRows();
        };
        box.querySelector('#ppSave').onclick = () => {
          const eid = box.querySelector('#ppExam').value;
          const subj = box.querySelector('#ppSubject').value;
          const valid = questions.filter(q => q.knowledge && Number(q.full) > 0);
          if (!valid.length && !images.length) return U.toast('请录入题目数据或选择试卷照片留档', 'err');
          if (valid.some(q => q.avgScore != null && (!Number.isFinite(Number(q.avgScore)) || Number(q.avgScore) < 0 || Number(q.avgScore) > Number(q.full)))) return U.toast('逐题平均分应在 0 到该题满分之间', 'err');
          if (!Store.attempt(() => Store.savePaper({
            examId: eid, campusId: Store.currentId(), subject: subj,
            images, questions: valid, auto: false
          }))) return;
          U.closeModal();
          U.toast(`已保存：${images.length} 张试卷图、${valid.length} 道题目；未确认或缺少得分的题目不参与诊断`, 'ok');
          (after || App.refresh)();
        };

        loadPaper();
      }
    });
  }

  /* ================= 家长本机演示 ================= */
  function openQRModal() {
    const cid = Store.currentId();
    const base = location.origin && location.origin !== 'null'
      ? location.origin + location.pathname.replace(/[^/]*$/, '')
      : location.href.replace(/[^/]*$/, '');
    const url = `${base}parent-upload.html?c=${encodeURIComponent(cid)}&n=${encodeURIComponent(Store.campusName())}`;

    U.modal({
      title: '家长本机演示成绩',
      body: `
        <div class="qr-wrap">
          <div class="qr-box" id="qrBox"></div>
          <div class="qr-info">
            <div style="font-weight:700;color:var(--text);font-size:13.5px;margin-bottom:6px">本机演示：填写后仅保存到填写者的浏览器</div>
            <div>二维码仅供体验填写流程，数据不会发送给老师，也不会进入老师电脑的待审核列表。请勿用作正式收集学生成绩。</div>
            <div class="qr-link" style="margin-top:8px">${U.esc(url)}</div>
            <div class="small muted" style="margin-top:8px">
              当前没有服务器收件或跨设备同步。部署到服务器也不会自动获得收件能力；正式成绩请通过已约定的方式交给老师。
            </div>
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="btn btn-sm" id="qrOpen">预览本机演示</button>
              <button class="btn btn-sm" id="qrList">查看当前账号旧待审记录（${Store.pendingUploads(cid).length}）</button>
            </div>
          </div>
        </div>
      `,
      onMount(box) {
        const holder = box.querySelector('#qrBox');
        try {
          new QRCode(holder, { text: url, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
        } catch (e) {
          holder.innerHTML = '<div class="small muted" style="padding:16px;text-align:center">二维码生成失败<br>请直接复制下方链接</div>';
        }
        box.querySelector('#qrOpen').onclick = () => window.open(url, '_blank');
        box.querySelector('#qrList').onclick = () => { U.closeModal(); showPendingUploads(); };
      }
    });
  }

  function showPendingUploads() {
    const cid = Store.currentId();
    const list = Store.parentUploads(cid);
    U.modal({
      title: `家长上传记录（${list.length}）`,
      body: list.length ? `
        <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px">
          <table class="grid">
            <thead><tr><th>提交时间</th><th>姓名</th><th>考试</th><th>科目</th><th class="num">得分</th><th class="num">满分</th><th class="num">班名</th><th class="num">年名</th><th class="num">试卷</th><th>状态</th><th></th></tr></thead>
            <tbody>${list.slice().reverse().map(u => `
              <tr>
                <td class="mono small">${U.fmtDate(new Date(u.createdAt))}</td>
                <td>${U.esc(u.studentName)}</td>
                <td>${U.esc(u.examName || '—')}</td>
                <td>${U.esc(u.subject || '—')}</td>
                <td class="num mono">${u.score ?? '—'}</td>
                <td class="num mono">${u.fullScore ?? '—'}</td>
                <td class="num mono">${u.classRank ?? '—'}</td>
                <td class="num mono">${u.gradeRank ?? '—'}</td>
                <td class="num mono">${u.images && u.images.length ? u.images.length + ' 张' : '—'}</td>
                <td>${u.status === 'pending' ? '<span class="tag tag-wave">待审核</span>' : u.status === 'approved' ? '<span class="tag tag-up">已通过</span>' : '<span class="tag tag-flat">已驳回</span>'}</td>
                <td style="white-space:nowrap">
                  ${u.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-ok="${u.id}">通过</button>
                  <button class="btn btn-sm" data-no="${u.id}">驳回</button>` : ''}
                  <button class="btn btn-sm btn-danger" data-rm="${u.id}">删</button>
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="small muted">通过后会自动写入该生该次考试的成绩记录（若同科目已存在则覆盖）。</div>`
        : `<div class="empty-state"><div class="es-ico">📱</div><div class="es-main">暂无家长上传</div>
           <div class="es-sub">当前无待审记录。本机演示不会向老师发送成绩。</div></div>`,
      onMount(box) {
        box.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => {
          const u = Store.parentUploads(cid).find(x => x.id === b.dataset.ok);
          if (u && !approveUpload(u)) return;
          U.closeModal(); showPendingUploads(); App.refresh();
        });
        box.querySelectorAll('[data-no]').forEach(b => b.onclick = () => {
          if (!Store.attempt(() => Store.setUploadStatus(b.dataset.no, 'rejected'))) return;
          U.closeModal(); showPendingUploads();
        });
        box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
          if (!Store.attempt(() => Store.removeUpload(b.dataset.rm))) return;
          U.closeModal(); showPendingUploads();
        });
      }
    });
  }

  function approveUpload(u) {
    if (u.status !== 'pending') return true;
    const error = Store.scopeError(u);
    if (error) { U.toast(error, 'err'); return false; }
    const existingExam = u.examId ? Store.exam(u.examId) : Store.exams(u.campusId).find(e =>
      e.name === (u.examName || '家长上传考试') && e.date === (u.date || U.today()));
    const dup = existingExam && Store.allRecords().find(r => r.examId === existingExam.id && r.studentName === u.studentName && r.subject === u.subject);
    if (dup && Store.scopeError(dup)) { U.toast('历史高中成绩仅保留查看，不能修改或覆盖', 'err'); return false; }
    let tip = '';
    if (!Store.attempt(() => {
      let examId = u.examId;
      if (!examId) {
        const e = Store.addExam({ campusId: u.campusId, name: u.examName || '家长上传考试', date: u.date || U.today(), type: u.type || '其他' });
        examId = e.id;
      }
      Store.addRecords([{
        examId, campusId: u.campusId, date: u.date || U.today(),
        studentName: u.studentName, stage: u.stage || '', grade: u.grade || '', className: u.className || '',
        subject: u.subject || '总分', type: u.type || '其他',
        fullScore: u.fullScore, score: u.score,
        classRank: u.classRank ?? null, gradeRank: u.gradeRank ?? null, comment: ''
      }]);
      if (dup) Store.deleteRecord(dup.id);
      if (u.images && u.images.length && u.subject) {
        saveSnapshot(examId, u.campusId, u.subject, u.images);
        tip = '，试卷照片已留档，逐题数据待录入';
      }
      Store.setUploadStatus(u.id, 'approved');
    })) return false;
    U.toast('已通过并写入成绩' + tip, 'ok');
    return true;
  }

  /* ================= 编辑本次记录 ================= */
  function openEditRecord(examId, studentName, after) {
    const exam = Store.exam(examId) || {};
    const recs = Store.allRecords().filter(r => r.examId === examId && r.studentName === studentName);
    if (!recs.length) { U.toast('未找到该记录', 'err'); return; }
    if (recs.some(r => Store.scopeError(r))) { U.toast('历史高中成绩仅保留查看，不能修改或覆盖', 'err'); return; }
    const removed = new Set();

    U.modal({
      title: `编辑成绩 · ${studentName}`,
      body: `
        <div class="small muted" style="margin-bottom:8px">
          ${U.esc(exam.name || '')}（${U.fmtMonth(exam.date)}）· 共 ${recs.length} 科 · 修改后立即生效
        </div>
        <div style="max-height:400px;overflow:auto;border:1px solid var(--line);border-radius:9px" class="scroll-sm">
          <table class="grid">
            <thead><tr>
              <th style="width:62px">科目</th><th style="width:74px">满分</th><th style="width:74px">得分</th>
              <th style="width:64px">班名</th><th style="width:64px">年名</th><th>老师评语</th><th style="width:34px"></th>
            </tr></thead>
            <tbody>${recs.map((r, i) => `<tr data-i="${i}">
              <td><b>${U.esc(r.subject)}</b></td>
              <td><input type="number" data-f="fullScore" value="${r.fullScore ?? ''}" style="height:28px;padding:0 6px" /></td>
              <td><input type="number" data-f="score" value="${r.score ?? ''}" style="height:28px;padding:0 6px" /></td>
              <td><input type="number" data-f="classRank" value="${r.classRank ?? ''}" style="height:28px;padding:0 6px" /></td>
              <td><input type="number" data-f="gradeRank" value="${r.gradeRank ?? ''}" style="height:28px;padding:0 6px" /></td>
              <td><input type="text" data-f="comment" value="${U.esc(r.comment || '')}" style="height:28px" placeholder="本次学情总结…" /></td>
              <td><button class="btn btn-sm btn-danger" type="button" data-del="${i}" style="height:26px;padding:0 6px">✕</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="small muted">点 ✕ 可删除该科成绩（不可撤销）；保存后名单、看板、档案会同步刷新。</div>
      `,
      foot: `<button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="erOk">保存修改</button>`,
      onMount(box) {
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
          const i = Number(b.dataset.del);
          removed.add(recs[i].id);
          b.closest('tr').style.opacity = '.35';
          b.disabled = true;
        });
        box.querySelector('#erOk').onclick = () => {
          if (!Store.attempt(() => {
            box.querySelectorAll('tbody tr').forEach(tr => {
              const i = Number(tr.dataset.i);
              if (removed.has(recs[i].id)) return;
              const val = (f) => { const el = tr.querySelector(`[data-f="${f}"]`); return el ? el.value : ''; };
              Store.updateRecord(recs[i].id, {
                fullScore: U.num(val('fullScore')),
                score: U.num(val('score')),
                classRank: U.num(val('classRank')),
                gradeRank: U.num(val('gradeRank')),
                comment: String(val('comment') || '').trim()
              });
            });
            removed.forEach(id => Store.deleteRecord(id));
          })) return;
          U.closeModal();
          U.toast('已保存修改', 'ok');
          (after || App.refresh)();
        };
      }
    });
  }

  /* ================= 数据管理 ================= */
  function openDataModal(after) {
    const cid = Store.currentId();
    const exams = Store.exams(cid);
    U.modal({
      title: '数据管理',
      body: `
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-sm" id="dmSample">载入示例数据</button>
          <button class="btn btn-sm btn-danger" id="dmClearCampus">清空「${U.esc(Store.campusName())}」</button>
          <button class="btn btn-sm btn-danger" id="dmClearAll">清空全部数据</button>
          <span class="small muted" style="align-self:center">数据保存在本机浏览器（localStorage），清空不可恢复</span>
        </div>
        <div>
          <div class="mini-title">已上传考试批次（${exams.length}）</div>
          ${exams.length ? `<div class="table-wrap" style="border:1px solid var(--line);border-radius:9px;max-height:300px">
            <table class="grid"><thead><tr><th>考试名称</th><th>日期</th><th>类型</th><th class="num">人数</th><th>评语覆盖</th><th></th></tr></thead>
              <tbody>${exams.map(e => {
                const c = Analytics.commentCoverage(e.id);
                const n = (Store.paper(e.id, '') ? 0 : 0);
                return `<tr>
                  <td><b>${U.esc(e.name)}</b></td><td class="mono">${e.date}</td>
                  <td><span class="chip">${U.esc(e.type)}</span></td>
                  <td class="num mono">${c.total}</td>
                  <td class="small">${c.withComment}/${c.total}（${U.pct(c.rate, 0)}）</td>
                  <td><button class="btn btn-sm btn-danger" data-delexam="${e.id}">删除</button></td>
                </tr>`;
              }).join('')}</tbody></table></div>`
            : '<div class="small muted">暂无考试记录</div>'}
        </div>
      `,
      onMount(box) {
        box.querySelector('#dmSample').onclick = () => U.confirmBox('将清空现有数据并载入示例成绩（两个校区），是否继续？', () => {
          if (!Store.attempt(() => Store.seed(true))) return false; U.toast('示例数据已载入', 'ok'); U.closeModal(); (after || App.refresh)();
        }, '载入示例数据');
        box.querySelector('#dmClearCampus').onclick = () => U.confirmBox(`确定清空「<b>${U.esc(Store.campusName())}</b>」的全部考试与成绩？`, () => {
          if (!Store.attempt(() => Store.clearCampus())) return false; U.closeModal(); U.toast('已清空该校区数据', 'ok'); (after || App.refresh)();
        }, '清空校区数据');
        box.querySelector('#dmClearAll').onclick = () => U.confirmBox('确定清空所有校区的全部数据？', () => {
          if (!Store.attempt(() => Store.reset())) return false; U.closeModal(); U.toast('已清空', 'ok'); (after || App.refresh)();
        }, '清空全部');
        box.querySelectorAll('[data-delexam]').forEach(b => b.onclick = () => {
          const e = Store.exam(b.dataset.delexam);
          U.confirmBox(`删除考试「<b>${U.esc(e ? e.name : '')}</b>」及其全部成绩与试卷打点？`, () => {
            if (!Store.attempt(() => Store.deleteExam(b.dataset.delexam))) return false; U.closeModal(); U.toast('已删除', 'ok'); (after || App.refresh)();
          }, '删除考试');
        });
      }
    });
  }

  return { barHtml, bindBar, openUploadModal, openManualModal, openPaperModal, openEditRecord, openQRModal, openDataModal, showPendingUploads, compressImage };
})();
