/* ==========================================================
   Excel 处理：模板下载 / 智能表头识别 / 导入解析 / 导出
   ========================================================== */
const Excel = (() => {

  /* ---------- 固定模板列 ---------- */
  const TEMPLATE_HEAD = ['姓名', '学段', '科目', '考试类型', '满分', '得分', '班级名次（选填）', '年级名次（选填）', '老师评语'];
  const TEMPLATE_SAMPLE = [
    ['张小明', '初中·七年级', '语文', '期中考试', 120, 102, 3, 12, '基础扎实，作文需加强素材积累。'],
    ['张小明', '初中·七年级', '数学', '期中考试', 120, 96, 3, 12, '计算失误较多，需强化草稿规范。'],
    ['李思思', '初中·七年级', '语文', '期中考试', 120, 110, 1, 4, '发挥稳定，继续保持阅读量。']
  ];

  /* ---------- 表头别名（不限列顺序、支持常见写法） ---------- */
  const ALIASES = {
    name: ['姓名', '学生姓名', '学员姓名', '学生', '姓名（必填）', '名字', '学生名字', '学员'],
    stage: ['学段', '年段', '学级', '学段年级', '年级段'],
    grade: ['年级', '就读年级', '年级名称'],
    className: ['班级', '班级名称', '所在班级', '班级（选填）'],
    subject: ['科目', '学科', '课程', '科目名称', '学科名称'],
    type: ['考试类型', '测试项目', '测试类型', '考试项目', '考试类别', '类型', '考试形式'],
    fullScore: ['满分', '满分多少', '试卷满分', '总分值', '满分分', '满分分值', '卷面满分'],
    score: ['得分', '成绩', '分数', '得分多少', '实得分', '卷面分', '考试成绩'],
    classRank: ['班级名次', '班名次', '班排', '班级排名', '班内名次', '班级名次（选填）', '班名（选填）'],
    gradeRank: ['年级名次', '年排', '年级排名', '校名次', '年级名次（选填）', '年名（选填）'],
    comment: ['老师评语', '教师评语', '评语', '点评', '老师总结', '教师总结', '学情总结', '总结', '备注'],
    date: ['考试日期', '日期', '考试时间', '考试日期（选填）']
  };

  const norm = (s) => String(s == null ? '' : s)
    .replace(/[\s\u3000]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[:：*＊]/g, '')
    .toLowerCase();

  /** 单个表头 → 字段名（先精确匹配，再包含匹配；长别名优先） */
  function matchField(header) {
    const h = norm(header);
    if (!h) return null;
    let best = null, bestLen = 0;
    for (const f in ALIASES) {
      for (const a of ALIASES[f]) {
        const na = norm(a);
        if (na === h) return f;                       // 精确匹配，立即返回
        if (h.includes(na) || na.includes(h)) {
          if (na.length > bestLen) { best = f; bestLen = na.length; }
        }
      }
    }
    return best;
  }

  /** 在二维数组中找到表头行 */
  function detectHeaderRow(matrix) {
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < Math.min(matrix.length, 12); i++) {
      const cells = matrix[i] || [];
      let score = 0; const used = new Set();
      cells.forEach(c => {
        const f = matchField(c);
        if (f && !used.has(f)) { used.add(f); score += (f === 'name' || f === 'score' || f === 'fullScore') ? 3 : 1; }
      });
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestScore >= 4 ? bestIdx : -1;
  }

  /** 解析为结构化行 */
  function parseMatrix(matrix) {
    const hi = detectHeaderRow(matrix);
    if (hi < 0) return { error: '未能识别表头，请确认表格首行包含「姓名 / 科目 / 满分 / 得分」等列名。', rows: [] };
    const head = matrix[hi] || [];
    const colMap = {};
    head.forEach((c, i) => {
      const f = matchField(c);
      if (f && colMap[f] == null) colMap[f] = i;
    });
    if (colMap.name == null) return { error: '未识别到「姓名」列，请检查表头。', rows: [] };
    if (colMap.score == null) return { error: '未识别到「得分 / 成绩」列，请检查表头。', rows: [] };

    const rows = [], errors = [];
    for (let i = hi + 1; i < matrix.length; i++) {
      const r = matrix[i];
      if (!r || !r.length) continue;
      const get = (f) => colMap[f] != null ? r[colMap[f]] : undefined;
      const name = String(get('name') ?? '').trim();
      const score = U.num(get('score'));
      if (!name && score == null) continue;       // 空行
      const full = U.num(get('fullScore'));
      const o = {
        studentName: name,
        stage: String(get('stage') ?? '').trim(),
        grade: String(get('grade') ?? '').trim(),
        className: String(get('className') ?? '').trim(),
        subject: String(get('subject') ?? '').trim() || '总分',
        type: String(get('type') ?? '').trim(),
        fullScore: full,
        score,
        classRank: U.num(get('classRank')),
        gradeRank: U.num(get('gradeRank')),
        comment: String(get('comment') ?? '').trim(),
        _row: i + 1
      };
      o._err = [];
      if (!o.studentName) o._err.push('缺少姓名');
      if (o.score == null) o._err.push('缺少/非法得分');
      if (o.fullScore == null) o._err.push('缺少/非法满分');
      else if (o.score != null && o.score > o.fullScore) o._err.push('得分大于满分');
      if (o.score != null && o.score < 0) o._err.push('得分为负');
      if (o._err.length) errors.push(o);
      rows.push(o);
    }
    return { rows, errors, colMap, headerRow: hi + 1 };
  }

  /** 读取 File → 结构化行 */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('文件读取失败'));
      fr.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
          resolve({ fileName: file.name, ...parseMatrix(matrix) });
        } catch (err) { reject(err); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- 导出 ---------- */
  function exportAOA(aoa, sheetName, fileName) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map((_, i) => ({
      wch: Math.min(38, Math.max(8, ...aoa.map(r => String(r[i] ?? '').length)) + 2)
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
    XLSX.writeFile(wb, fileName);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEAD, ...TEMPLATE_SAMPLE]);
    ws['!cols'] = TEMPLATE_HEAD.map((h, i) => ({ wch: Math.min(38, Math.max(10, ...([h].concat(TEMPLATE_SAMPLE.map(r => String(r[i] ?? '')))).map(s => String(s).length)) + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '成绩导入模板');

    const guide = [
      ['使用说明'],
      [''],
      ['一、必填列', '姓名、学段、科目、考试类型、满分、得分'],
      ['二、选填列', '班级名次、年级名次、老师评语（留空不影响导入）'],
      ['三、列顺序', '任意顺序均可，系统按表头名称自动识别（支持"学生姓名/测试项目/考试成绩/班排/教师评语"等写法）'],
      ['四、每次上传', '上传时需填写「考试名称 + 考试年月」，用于历次追踪与进退步对比'],
      ['五、一人多科', '同一学生同一考试按科目分行填写（语文一行、数学一行…）'],
      ['六、试卷快照（选填）', '在「批量上传」弹窗内可保存本次试卷照片（最多 6 张），照片仅本机留档；知识点诊断需人工录入并确认逐题数据'],
      ['七、家长上报', '「家长本机演示」仅体验填写流程，数据保存在填写者浏览器，不会发送给老师或跨设备同步'],
      [''],
      ['说明：进退步判定以班级名次为主、分数为辅。分数下降但名次前进，视为试卷偏难，不计为退步。']
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(guide);
    ws2['!cols'] = [{ wch: 16 }, { wch: 96 }];
    XLSX.utils.book_append_sheet(wb, ws2, '使用说明');
    XLSX.writeFile(wb, '成绩导入模板.xlsx');
    U.toast('模板已下载（含使用说明页）', 'ok');
  }

  /** 导出成绩明细（记录级） */
  function exportRecords(list, fileName) {
    const head = ['校区', '考试名称', '考试年月', '考试类型', '姓名', '学段', '年级', '班级', '科目', '满分', '得分', '得分率', '班级名次', '年级名次', '老师评语'];
    const aoa = [head];
    list.forEach(r => {
      aoa.push([
        Store.campusName(r.campusId), Store.exam(r.examId) ? Store.exam(r.examId).name : '', r.date, r.type || '',
        r.studentName, r.stage || '', r.grade || '', r.className || '', r.subject,
        r.fullScore, r.score, r.fullScore ? (r.score / r.fullScore * 100).toFixed(1) + '%' : '',
        r.classRank ?? '', r.gradeRank ?? '', r.comment || ''
      ]);
    });
    exportAOA(aoa, '成绩明细', fileName || ('成绩明细_' + U.today() + '.xlsx'));
    U.toast('已导出 ' + list.length + ' 条记录', 'ok');
  }

  /** 导出进退步对比清单 */
  function exportComparison(rows, meta, fileName) {
    const head = ['姓名', '学段/年级', '班级', '上次得分', '本次得分', '分数变化', '变化幅度', '上次班级名次', '本次班级名次', '班级名次变化', '上次年级名次', '本次年级名次', '判定', '判定依据', '本次老师评语'];
    const aoa = [
      [`进退步对比：${meta.a}  →  ${meta.b}`, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      [`校区：${meta.campus}`, `统计人数：${rows.length}`, `判定口径：以班级名次为主、分数为辅`, '', '', '', '', '', '', '', '', '', '', '', ''],
      head
    ];
    rows.forEach(r => {
      aoa.push([
        r.studentName, r.grade || r.stage || '', r.className || '',
        r.scoreA, r.scoreB, r.delta, r.deltaRate != null ? (r.deltaRate * 100).toFixed(1) + '%' : '',
        r.rankA ?? '', r.rankB ?? '', r.rankDelta != null ? (r.rankDelta > 0 ? '+' + r.rankDelta : r.rankDelta) : '',
        r.gradeRankA ?? '', r.gradeRankB ?? '',
        r.judge === 'up' ? '进步' : r.judge === 'down' ? '退步' : r.judge === 'flat' ? '持平' : '—',
        r.judgeText || '', r.commentB || '（未填写）'
      ]);
    });
    exportAOA(aoa, '进退步对比', fileName || ('进退步对比_' + U.today() + '.xlsx'));
    U.toast('对比清单已导出', 'ok');
  }

  /** 导出学生个人档案（Excel） */
  function exportStudentProfile(name, timeline, fileName) {
    const aoa = [[`${name} 成绩档案`], [`校区：${Store.campusName()}`], [],
      ['考试名称', '日期', '类型', '总分', '满分', '得分率', '班级名次', '年级名次', '较上次进退', '老师评语']];
    timeline.forEach(t => {
      aoa.push([t.examName, t.date, t.type, t.total, t.full ?? '', t.rate != null ? (t.rate * 100).toFixed(1) + '%' : '',
        t.classRank ?? '', t.gradeRank ?? '', t.delta != null ? U.signNum(t.delta, 0) : '', t.comments.map(c => c.text).join(' ') || '（未填写）']);
    });
    exportAOA(aoa, '成绩档案', fileName || (`${name}_成绩档案.xlsx`));
    U.toast('个人档案已导出', 'ok');
  }

  return { TEMPLATE_HEAD, ALIASES, matchField, parseMatrix, readFile, downloadTemplate, exportRecords, exportComparison, exportStudentProfile, exportAOA };
})();
