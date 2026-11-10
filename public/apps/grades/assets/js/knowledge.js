/* ==========================================================
   知识点诊断引擎
   - 知识点库：江苏地区 苏教版（数学/英语）、苏科版（物理）、沪教版/人教版（化学）
   - 试卷快照 + 题目打点 → 知识点掌握度报告
   - 个人知识点雷达 + 弱项清单 + 提升建议
   说明：照片仅供留档。知识点和逐题得分须人工录入/确认，不从总分推断。
   ========================================================== */
const Knowledge = (() => {

  /* ---------------- 知识点库 ---------------- */
  const LIB = {
    '数学': {
      '小学': [
        '万以内数的认识与加减法', '两位数乘两位数', '三位数乘两位数', '除数是两位数的除法',
        '四则混合运算与运算律', '小数的意义与加减', '小数乘法', '小数除法', '分数的意义与性质',
        '分数加减法', '分数乘除法', '因数与倍数', '负数初步认识', '式与方程', '比与比例', '百分数',
        '长方形与正方形的面积', '平行四边形与梯形面积', '圆的周长与面积', '长方体与正方体的表面积与体积',
        '圆柱与圆锥', '图形的平移旋转与对称', '统计图（条形/折线/扇形）', '可能性与统计',
        '解决问题的策略', '行程问题', '工程问题'
      ],
      '初中': [
        '有理数与数轴', '绝对值与相反数', '有理数混合运算', '代数式与整式加减', '一元一次方程',
        '二元一次方程组', '一元一次不等式（组）', '幂的运算', '整式乘法', '乘法公式与因式分解',
        '分式与分式方程', '二次根式', '一元二次方程', '平面图形的认识（角与平行线）', '全等三角形',
        '轴对称图形', '勾股定理', '实数', '平面直角坐标系', '一次函数', '反比例函数', '二次函数',
        '平行四边形的性质与判定', '相似三角形', '锐角三角函数', '圆的性质与证明', '统计与概率'
      ]
    },
    '英语': {
      '小学': [
        '字母与语音辨析', '词汇拼写', '名词单复数', '冠词', '代词', '介词', '形容词与副词',
        '一般现在时', '现在进行时', '一般过去时', '一般将来时', '情态动词', '祈使句与感叹句',
        'There be 句型', '疑问句与否定句', '听力理解', '阅读理解', '情景交际', '书面表达'
      ],
      '初中': [
        '语音与重读', '词汇与短语搭配', '名词与冠词', '代词', '数词', '介词与介词短语',
        '形容词与副词比较级最高级', '一般现在时', '现在进行时', '一般过去时', '过去进行时',
        '一般将来时', '现在完成时', '过去完成时', '情态动词', '被动语态', '宾语从句',
        '定语从句', '状语从句', '非谓语动词', '主谓一致', '倒装与强调', '句型转换',
        '完形填空', '阅读理解', '任务型阅读', '首字母填空', '书面表达'
      ]
    },
    '物理': {
      '初中': [
        '声现象', '光的直线传播与反射', '光的折射与透镜成像', '物态变化', '热传递与内能',
        '机械运动与速度', '质量与密度', '力与运动（牛顿第一定律）', '二力平衡与摩擦力',
        '压强', '液体压强与浮力', '简单机械（杠杆与滑轮）', '功、功率与机械效率', '机械能',
        '电路连接与电流测量', '电压与电阻', '欧姆定律', '电功与电功率', '电与磁', '能源与能量守恒',
        '实验探究与数据处理'
      ]
    },
    '化学': {
      '初中': [
        '物质的变化与性质', '化学实验基本操作', '空气与氧气', '水的组成与净化', '化学式与化合价',
        '化学方程式与质量守恒', '碳和碳的氧化物', '燃烧与灭火', '金属与金属材料', '溶液与溶解度',
        '常见的酸和碱', '盐与复分解反应', '物质的检验与鉴别', '化学计算', '实验探究与方案设计'
      ]
    }
  };

  /** 学科 → 知识点（按学段分组） */
  function optionsFor(subject) {
    const key = pickSubject(subject);
    if (!key) return [];
    const g = LIB[key];
    return Object.keys(g).map(stage => ({ stage, items: g[stage] }));
  }
  function flat(subject) {
    return optionsFor(subject).reduce((a, g) => a.concat(g.items), []);
  }
  function pickSubject(subject) {
    const s = String(subject || '');
    if (LIB[s]) return s;
    if (/数学/.test(s)) return '数学';
    if (/英语|英文/.test(s)) return '英语';
    if (/物理/.test(s)) return '物理';
    if (/化学/.test(s)) return '化学';
    return null;
  }
  const supported = () => Object.keys(LIB);

  const numeric = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const validScore = (score, full) => numeric(score) && numeric(full) &&
    Number.isFinite(Number(score)) && Number.isFinite(Number(full)) && Number(full) > 0 && Number(score) >= 0 && Number(score) <= Number(full);
  function confirmedQuestion(paper, q) {
    return !!q.knowledge && q.confirmed !== false &&
      (!(q.auto || (paper && paper.auto)) || q.confirmed === true);
  }

  /* ---------------- 试卷分析（考试级） ---------------- */
  /**
   * paper.questions: [{no, knowledge, full, avgScore, scores:{姓名:得分}}]
   */
  function analyzePaper(paper) {
    const qs = (paper && paper.questions || []).filter(q => confirmedQuestion(paper, q) && validScore(q.avgScore, q.full));
    const map = new Map();
    qs.forEach(q => {
      const k = q.knowledge;
      if (!map.has(k)) map.set(k, { knowledge: k, full: 0, avg: 0, nos: [], count: 0 });
      const o = map.get(k);
      o.full += Number(q.full) || 0;
      o.avg += Number(q.avgScore) || 0;
      o.nos.push(q.no);
      o.count++;
    });
    const items = Array.from(map.values()).map(o => {
      const rate = o.full ? o.avg / o.full : null;
      return {
        ...o, rate,
        level: rate == null ? 'mid' : rate >= 0.8 ? 'strong' : rate < 0.6 ? 'weak' : 'mid'
      };
    }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
    return {
      items,
      strong: items.filter(i => i.level === 'strong'),
      weak: items.filter(i => i.level === 'weak'),
      overall: (() => {
        const f = items.reduce((s, i) => s + i.full, 0);
        const a = items.reduce((s, i) => s + i.avg, 0);
        return f ? a / f : null;
      })()
    };
  }

  /* ---------------- 个人分析 ---------------- */
  /** 个人分析只使用该生有效的逐题得分，不以班均/总分代填。 */
  function analyzeStudent(paper, name) {
    const all = paper && paper.questions || [];
    const qs = all.filter(q => confirmedQuestion(paper, q) && q.scores && validScore(q.scores[name], q.full));
    const map = new Map();
    const estimated = false;
    qs.forEach(q => {
      const k = q.knowledge;
      if (!map.has(k)) map.set(k, { knowledge: k, full: 0, score: 0, nos: [] });
      const o = map.get(k);
      o.full += Number(q.full);
      o.score += Number(q.scores[name]);
      o.nos.push(q.no);
    });

    const items = Array.from(map.values()).map(o => {
      const rate = o.full ? o.score / o.full : null;
      return {
        knowledge: o.knowledge, full: o.full, score: Math.round(o.score * 10) / 10, nos: o.nos,
        rate,
        level: rate == null ? 'mid' : rate >= 0.8 ? 'strong' : rate < 0.6 ? 'weak' : 'mid'
      };
    }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
    return {
      items,
      strong: items.filter(i => i.level === 'strong'),
      weak: items.filter(i => i.level === 'weak'),
      estimated,
      missing: all.length - qs.length,
      radar: {
        labels: items.map(i => i.knowledge),
        values: items.map(i => Math.round((i.rate ?? 0) * 100))
      },
      advice: buildAdvice(items, paper ? paper.subject : '')
    };
  }

  /** 兼容旧调用：总分与照片都不是逐题证据，不能自动生成掌握度。 */
  function autoQuestions() { return []; }

  /* ---------------- 建议生成（规则引擎） ---------------- */
  const TIPS = [
    [/计算|运算|方程|不等式|根式|分式/, '每天 10 分钟限时计算训练，强调草稿书写与检验习惯，先把会做的题做对'],
    [/应用|行程|工程|解决问题|情景/, '按"读题圈条件—画图/列表—列式—检验"四步走，积累 5 类典型模型题'],
    [/几何|三角形|四边形|圆|相似|全等|图形|面积|体积/, '先背牢判定定理与性质，再练基本图形拆解，重点补辅助线常见作法'],
    [/函数|坐标|图像/, '强化"数形结合"：先描点画图再分析增减性，配套练 3 套图像识别题'],
    [/统计|概率|可能性|数据/, '梳理概念定义与公式，重点练读图取数与规范作答'],
    [/词汇|拼写|短语|名词|代词|介词|冠词|数词|形容词/, '按单元做词汇闭环：听写 → 造句 → 短文填空，每天 15 个高频词'],
    [/时态|语态|从句|非谓语|主谓一致|句型|倒装/, '用"时间轴 + 例句卡"梳理语法，每类语法配 20 道单句改错'],
    [/阅读|完形|任务型|首字母/, '每天 1 篇限时阅读，做完必须回文定位错题出处，积累 10 个长难句'],
    [/写作|书面表达/, '背诵 3 篇范文框架，每周 1 篇限时写作并做批改复盘'],
    [/听力|语音|重读/, '每日 10 分钟精听跟读，重点练数字、时间、地点等细节信息'],
    [/力|压强|浮力|机械|功|功率|运动|密度/, '先理清受力分析步骤，再练"公式—单位—代入"规范解题，配套实验题'],
    [/电|电路|欧姆|电阻|电压|电流|磁/, '画电路图 + 串并联规律默写，重点练动态电路与故障判断'],
    [/光|声|热|物态|内能/, '结合生活现象记忆概念，配套图像类题目（如熔化曲线、成像作图）'],
    [/化学式|化合价|方程式|质量守恒|计算/, '每天默写 10 个化学方程式并配平，规范标注条件与↑↓'],
    [/实验|操作|检验|鉴别|探究/, '熟记 8 个基础实验的操作要点与现象描述，练规范表达（操作—现象—结论）'],
    [/溶液|溶解度|酸碱|盐|金属/, '建立物质性质网络图，重点练推断题与除杂顺序']
  ];
  function tipFor(kn) {
    for (const [re, tip] of TIPS) if (re.test(kn)) return tip;
    return '回归教材对应章节，先做基础题巩固概念，再做 2 道变式题检验';
  }

  function buildAdvice(items, subject) {
    const weak = items.filter(i => i.level === 'weak');
    const mid = items.filter(i => i.level === 'mid');
    const strong = items.filter(i => i.level === 'strong');
    const out = [];
    if (!items.length) return ['暂无题目级数据，请先在「知识点诊断」中录入试卷题目与得分。'];
    if (strong.length) {
      out.push(`优势知识点：${strong.slice(0, 3).map(i => i.knowledge).join('、')}，得分率均在 80% 以上，可作为提分基本盘，保持每周 1 次巩固练习。`);
    }
    weak.slice(0, 3).forEach(i => {
      out.push(`薄弱点「${i.knowledge}」得分率仅 ${U.pct(i.rate, 0)}（第 ${i.nos.join('、')} 题失分较多）：${tipFor(i.knowledge)}。`);
    });
    if (!weak.length && mid.length) {
      out.push(`暂无明显薄弱知识点，但 ${mid.slice(0, 2).map(i => i.knowledge).join('、')} 处于 60%~80% 区间，建议用中档题突破到 85% 以上。`);
    }
    if (weak.length >= 3) {
      out.push(`薄弱点较分散（共 ${weak.length} 个），建议未来两周只主攻其中 2 个，避免全面铺开导致颗粒无收。`);
    }
    out.push(`阶段目标：下一次${subject ? '「' + subject + '」' : ''}考试把最薄弱的 1~2 个知识点得分率提升到 70% 以上，并在同一知识点上保持 3 次连续达标。`);
    return out;
  }

  /* ---------------- 人工录入草稿 ---------------- */
  function draftQuestions(subject, count) {
    const n = Math.max(1, Math.min(60, count || 10));
    return Array.from({ length: n }, (_, i) => ({
      no: i + 1, knowledge: '', full: null, avgScore: null, scores: {}, confirmed: false
    }));
  }
  function remoteRecognize() {
    return Promise.reject(new Error('尚未接入试卷识别，请人工录入并确认逐题数据。'));
  }

  return {
    LIB, optionsFor, flat, pickSubject, supported,
    analyzePaper, analyzeStudent, validScore, tipFor, buildAdvice,
    draftQuestions, autoQuestions, remoteRecognize
  };
})();
