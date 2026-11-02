'use strict';
/**
 * AI 能力层：OpenAI 兼容的「视觉理解」调用封装（用于 AI 试卷分析测评报告）
 *
 * 配置存在 settings 表（key-value），管理端可在「AI 学情报告」页里直接改：
 *   aiBaseUrl  接口地址，填到 /v1 为止（默认阿里百炼 compatible-mode/v1）
 *              例：https://dashscope.aliyuncs.com/compatible-mode/v1
 *                  https://open.bigmodel.cn/api/paas/v4        （智谱 GLM-4V）
 *                  https://ark.cn-beijing.volces.com/api/v3    （火山方舟 doubao-vision）
 *   aiApiKey   API Key（返回给前端时只给「已配置/未配置」状态，不回传明文）
 *   aiModel    视觉模型名（默认 qwen-vl-max；需支持图片输入）
 *   aiMock     1 = 演示模式：不调用外部接口，返回一份固定结构的示例报告（无 Key 也能跑通流程）
 *
 * 报告 JSON 结构（渲染端 aireport.js 按此绘制）：
 * {
 *   meta:     { grade, subject, date, paperTitle, totalQuestions, totalKnowledge },
 *   overall:  { correctRate, correct, wrong, summary, difficultyComment },
 *   difficulty: [{ level, count, correct, rate, comment }],
 *   knowledge:{ mastered[], partial[], weak[], masteredComment, partialComment, weakComment },
 *   wrongQuestions: [{ no, knowledge, cause, abilities[] }],
 *   crossValidation: [ "…", … ],
 *   teacherNote: "…",
 *   wrongDetails: [{ no, subject, stem }]
 * }
 */
const crypto = require('crypto');
const https = require('https');
const { db } = require('./db');
const express = require('express');
const BUILTIN = require('./builtin-config');
const { toScanJpeg } = require('./scanify');

/** Node16 没有全局 fetch（18+ 才有，2026-10-26 事故：报告全部「无法连接 AI 接口： fetch is not defined」）。
 * 用 https 模块实现一个最小兼容版：返回 { ok, status, text(), json() }，用法与 fetch 对齐；
 * 超时时 reject 一个 name='AbortError' 的错误，保持上层超时文案不变。 */
function aiFetch(url, { method = 'GET', headers = {}, body = null, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('AI 接口地址无效')); }
    const req = https.request(u, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => buf.toString('utf8'),
          json: async () => JSON.parse(buf.toString('utf8')),
        });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const DEFAULTS = {
  aiBaseUrl: BUILTIN.ai.baseUrl,
  aiModel: BUILTIN.ai.model,
};

function getSetting(k) {
  const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k);
  return r ? r.v : undefined;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v == null ? '' : String(v));
}

/** 读 AI 配置。地址、模型和密钥写在 builtin-config.js，不读后台表单。 */
function getConfig() {
  return {
    baseUrl: DEFAULTS.aiBaseUrl,
    model: DEFAULTS.aiModel,
    hasKey: !!String(BUILTIN.ai.apiKey || '').trim(),
    // 演示模式：仅由环境变量 AI_MOCK=1 开启（自动化测试用，不调外部接口）；默认关闭，线上行为不变
    mock: process.env.AI_MOCK === '1',
  };
}
function aiKey() {
  return String(BUILTIN.ai.apiKey || '').trim();
}

/** 保存 AI 配置（apiKey 传空串 / undefined 表示不修改） */
function saveConfig({ baseUrl, model, apiKey, mock }) {
  if (baseUrl !== undefined && String(baseUrl).trim()) setSetting('aiBaseUrl', String(baseUrl).trim().replace(/\/+$/, ''));
  if (model !== undefined && String(model).trim()) setSetting('aiModel', String(model).trim());
  if (mock !== undefined) setSetting('aiMock', mock ? '1' : '0');
  if (apiKey !== undefined && String(apiKey).trim()) setSetting('aiApiKey', String(apiKey).trim());
}

const SYSTEM_PROMPT = `你是一名资深的江苏地区 K12 试卷分析老师，熟悉江苏省教材与考试体系（数学按苏教版、语文按部编版、英语按译林版、物理化学按苏科版/人教版），了解江苏中高考导向与当地校内教学的难度梯度，为家长出具「学情诊断报告」。
分析时结合江苏地区学情：知识点表述与当地教材章节用语保持一致；评价难度时参照江苏校内测验/期中期末的实际梯度；建议部分兼顾江苏升学路径（本地课时安排、难度要求偏高、重视计算规范与过程分）。
你会收到一张或多张试卷照片。请仔细识别：试卷标题/学科/年级、每道题的题干、学生作答、老师批改痕迹（对勾/叉/分数）。
然后严格按下面的 JSON 结构输出，只输出 JSON 本身，不要 markdown 代码块、不要任何解释文字。
识别不清的内容宁可不写，禁止编造。所有文字用简体中文。

{
  "meta": { "grade": "年级", "subject": "学科", "date": "考试日期 YYYY.M.D，看不出就填今天", "paperTitle": "试卷标题", "totalQuestions": 0, "totalKnowledge": 0 },
  "overall": { "correctRate": 0.0, "correct": 0, "wrong": 0, "summary": "三句话以内的总体诊断摘要", "difficultyComment": "一两句试卷整体难度评价" },
  "difficulty": [ { "level": "1星", "count": 0, "correct": 0, "rate": 0.0, "comment": "该难度段的学情表现，一句话" } ],
  "knowledge": {
    "mastered": [ "已掌握知识点" ], "partial": [ "部分掌握知识点" ], "weak": [ "薄弱知识点" ],
    "masteredComment": "已掌握知识点分析，两三句", "partialComment": "部分掌握知识点分析", "weakComment": "需关注知识点分析"
  },
  "wrongQuestions": [ { "no": 0, "knowledge": "涉及知识点", "cause": "错误原因溯源，一句话", "abilities": ["核心能力1", "核心能力2"] } ],
  "crossValidation": [ "交叉对比不同知识点/不同难度题目的表现得出的学情特征，每条两三句" ],
  "teacherNote": "写给家长的话，口吻亲切专业，先肯定优点再讲改进方向，200 字左右，落款「——  AI 学情分析团队」之外不要写别的落款",
  "wrongDetails": [ { "no": 0, "subject": "学科", "stem": "错题题干原文（含选项），一题一条，按题号排序" } ]
}

规则：
- correctRate = correct / totalQuestions，保留 4 位小数；correct + wrong = totalQuestions
- difficulty 的 level 用「1星/2星/3星/4星」，rate 为该段正确率（0~1）；四段 count 之和 = totalQuestions
- wrongQuestions.no 是错题题号；wrongDetails 只收录错题
- 若整卷没批改痕迹，按学生作答内容判断对错；完全看不出对错时，overall.correctRate 给 0 并在 summary 里说明`;

/** 从模型回复里提取 JSON（兼容 ```json 围栏 / 前后杂文字） */
function extractJson(text) {
  const s = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('模型没有返回 JSON');
  return JSON.parse(body.slice(a, b + 1));
}

/** 底层：一次视觉对话，返回模型输出的文本（analyzePaper / analyzeWrongQuestion 共用） */
async function visionChat({ system, userText, images = [], timeoutMs = 300000, temperature = 0.2 }) {
  const cfg = getConfig();
  if (!cfg.hasKey) throw new Error('还没有写上 AI 密钥');

  const content = [{ type: 'text', text: userText || '请按要求输出。' }];
  for (const im of images) {
    let buf = Buffer.isBuffer(im.buf) ? im.buf : Buffer.from(im.buf);
    let mime = im.mime || 'image/jpeg';
    if (!/pdf/i.test(mime)) {
      try {
        const scanned = await toScanJpeg(buf);
        if (scanned && scanned.length) { buf = scanned; mime = 'image/jpeg'; }
      } catch (e) { /* 扫描化失败就用原图，不挡住分析 */ }
    }
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } });
  }

  let res;
  try {
    res = await aiFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey()}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          ...(system ? [{ role: 'system', content: String(system) }] : []),
          { role: 'user', content },
        ],
        temperature,
      }),
      timeoutMs,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? `AI 分析超时（${Math.round(timeoutMs / 1000)} 秒），请减少题目数量后重试`
      : '无法连接 AI 接口：' + e.message);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 接口返回 ${res.status}${t ? '：' + t.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('AI 返回内容为空');
  return { text: String(text), model: cfg.model };
}

/** OpenAI 兼容的视觉对话。images: [{buf, mime}]；返回解析后的 JSON 对象 */
async function analyzePaper({ images, userHint }) {
  const cfg = getConfig();
  if (cfg.mock) return { report: mockReport(), model: 'mock（演示模式）' };
  const { text, model } = await visionChat({
    system: SYSTEM_PROMPT,
    userText: userHint || '请分析这张试卷并输出学情诊断报告 JSON。',
    images,
    timeoutMs: 300000, // 5 分钟：多图视觉分析较慢
    temperature: 0.2,
  });
  return { report: extractJson(text), model };
}

/** 校验/补齐报告结构（模型漏字段时给默认值，渲染端不用判空） */
function normalizeReport(r) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const arr = (v) => (Array.isArray(v) ? v : []);
  r.meta = Object.assign({ grade: '', subject: '', date: '', paperTitle: '', totalQuestions: 0, totalKnowledge: 0 }, r.meta || {});
  r.overall = Object.assign({ correctRate: 0, correct: 0, wrong: 0, summary: '', difficultyComment: '' }, r.overall || {});
  r.overall.correctRate = num(r.overall.correctRate);
  r.difficulty = arr(r.difficulty).map((d) => Object.assign({ level: '', count: 0, correct: 0, rate: 0, comment: '' }, d || {}));
  const k = r.knowledge || {};
  r.knowledge = {
    mastered: arr(k.mastered), partial: arr(k.partial), weak: arr(k.weak),
    masteredComment: k.masteredComment || '', partialComment: k.partialComment || '', weakComment: k.weakComment || '',
  };
  r.wrongQuestions = arr(r.wrongQuestions).map((w) => Object.assign({ no: 0, knowledge: '', cause: '', abilities: [] }, w || {}));
  r.crossValidation = arr(r.crossValidation);
  r.teacherNote = r.teacherNote || '';
  r.wrongDetails = arr(r.wrongDetails).map((w) => Object.assign({ no: 0, subject: '', stem: '' }, w || {}));
  return r;
}

/** 演示模式：不调外部接口，返回结构完整的一份示例报告（数值与展示样式均接近真实） */function mockReport() {
  return normalizeReport({
    meta: { grade: '五年级', subject: '数学', date: '2026.10.5', paperTitle: '五年级数学期中测试卷', totalQuestions: 24, totalKnowledge: 18 },
    overall: {
      correctRate: 0.5833, correct: 14, wrong: 10,
      summary: '试卷整体难度呈梯度分布偏难（含 4 星题），学生基础计算扎实但高阶思维与几何应用能力薄弱，目前处于中等偏下层级，亟需专项突破。',
      difficultyComment: '本卷难度系数较高，3 星以上难题占比超过 58%，重点考察知识迁移与综合解决问题的能力，区分度明显。',
    },
    difficulty: [
      { level: '1星', count: 5, correct: 5, rate: 1, comment: '基础扎实，简单题失分少，概念清晰。' },
      { level: '2星', count: 5, correct: 4, rate: 0.8, comment: '表现良好，仅位置与层次上出现极多正常。' },
      { level: '3星', count: 13, correct: 5, rate: 0.3846, comment: '严重薄弱：立体几何与理由过程的关系分析失常。' },
      { level: '4星', count: 1, correct: 0, rate: 0, comment: '超纲类能力暂不足，逻辑推理与数的综合运算未掌握。' },
    ],
    knowledge: {
      mastered: ['单位换算', '分数大小比较', '分数四则运算', '分数与小数混合运算', '三角形分类', '图形折叠与展开', '植组问题', '分数应用题', '工程问题', '铺店工程问题'],
      partial: ['比的性质', '立体图形体积与表面积'],
      weak: ['派松分解和与earth中分解', '巧算 24 点', '圆柱与圆锥体积', '数的整除特征', '几何图形拼按', '分数方程应用题', '最小公倍数应用', '比例行程问题'],
      masteredComment: '学生在基础计算领域表现优异，包括单位换算、分数四则运算及小数混合运算，正确率 100%。常规应用题如工程问题、植组问题及平面图形分类也能准确解答，说明基础运算能力和常规模型掌握牢固。',
      partialComment: '虽然常规工程问题掌握较好，但在涉及多重成分或分数方程（如 Q20 水量转移）上存在波动，显示对复杂数量关系的分析能力尚不稳定，处于部分掌握状态。',
      weakComment: '立体几何（圆柱圆锥体积、正方体切割）全面薄弱，表明空间想象力与公式综合运用能力严重不足；数论与逻辑推理（辗转相除、最小公倍数、24 点）完全失分，比例性质及行程问题概念混乱，是后续拉分重大短板。',
    },
    wrongQuestions: [
      { no: 5, knowledge: '比的性质', cause: '对比的前项后项变化对比的影响理解错误，计算失误。', abilities: ['逻辑推理', '比的运算'] },
      { no: 8, knowledge: '立体图形体积与表面积', cause: '无法建立方与内切圆柱间的同关系，公式混用失控。', abilities: ['空间想象', '几何姓'] },
      { no: 9, knowledge: '乘法分配律与错中求解', cause: '未能通过数变化分析因数变化对积的影响，属机理错误。', abilities: ['数感', '运算能力'] },
      { no: 10, knowledge: '巧算 24 点', cause: '缺乏数学敏感，未能求出有效算式。', abilities: ['数感', '发散思维'] },
      { no: 14, knowledge: '圆柱与圆锥体积', cause: '半径与高理解不到位，圆柱体积公式套用 1/3 或漏算计算错误。', abilities: ['空间观念', '公式应用'] },
      { no: 18, knowledge: '数的整除特征', cause: '无法利用整除规律筛选或组合自然数，枚举效率低且易出错。', abilities: ['数感', '推理能力'] },
      { no: 19, knowledge: '几何图形拼按', cause: '缺乏图形分析与组合的空间想象，无法建立面积方程。', abilities: ['几何直观', '方程思想'] },
      { no: 20, knowledge: '分数方程应用题', cause: '水量转移过程中的恒等关系寻找错误，方程式失效。', abilities: ['建模能力', '方程求解'] },
      { no: 21, knowledge: '最小公倍数应用', cause: '无法将距离间隔转化为周期问题，找不到相遇点。', abilities: ['抽象表征', '公倍应用'] },
      { no: 23, knowledge: '比例行程问题', cause: '步长与步频的比例关系未理清，比例关系未理清。', abilities: ['比例分析', '行程模型'] },
    ],
    crossValidation: [
      '几何能力分化明显：平面几何（Q11 三角形、Q12 折叠）正确，而立体几何（Q8 正方体圆柱、Q14 圆锥体积）全错，验证了学生空间想象力局限于二维，三维转换能力存在显著薄弱。',
      '计算稳定性与数感不匹配：四则基础题全对，但需要构造和枚举的巧算题（Q10、Q18）失分，反映应试训练到位而数学思维灵活性欠缺。',
    ],
    teacherNote: '家长您好，本次诊断显示孩子拥有非常扎实的计算基础，这是数学学习的宝贵财富。目前的关键主要集中在空间几何与复杂逻辑应用上，这于时期推进过程中仍常见现象。建议家长多多鼓励孩子画图分析几何题，减少对公式的死记硬背，只要针对性地突破立体几何与逻辑难点，孩子的成绩将有大幅跃升空间。我们共同期待孩子的进步！',
    wrongDetails: [
      { no: 5, subject: '数学', stem: '5. 两数相除比是 1.2，如果比的前项扩大 2 倍，后项缩小 3 倍，比值是（　）。' },
      { no: 8, subject: '数学', stem: '8. 把一个棱长 a 米的正方体削成一个最大的圆柱体，这个圆柱体与正方体体积比______，表面积的比______。（计算及圆周率一律用 π 表示）' },
      { no: 9, subject: '数学', stem: '9. 小明在计算乘法时，不小心将一个因数 24 错写成 42，那么计算结果比正确答案多另一个因数 × 18。' },
      { no: 10, subject: '数学', stem: '10. 有 24 点是提议特别的扑克游戏，这里有 4 张扑克牌，红桃 3，方片 5 黑桃 5 和梅花 9。用它们凑成"24 点"的算式是______。' },
      { no: 14, subject: '数学', stem: '14. 一个底面半径是 10 厘米的圆柱形容器中装有水，将一个底面直径为 10 厘米的圆锥形铁锤浸没在水中（水未溢出）水面升高了 3 厘米和铁锤的高是（　）厘米。A. 32 B. 8 C. 36 D. 40' },
    ],
  });
}

/* ---------------- 错题重组：AI 整页识别（每题边界框） ----------------
 * 前端把整页试卷照发上来，模型返回每道题的边界框（相对坐标 0~1，x/y=左上角、w/h=宽高），
 * 前端在页图上渲染识别框，老师点每题的「➕」加入错题栏。识别不准可手动拖框兜底。
 */
const SEGMENT_SYSTEM_PROMPT = `你是一名资深 K12 老师，擅长把试卷照片切分成一道道独立的题。
你会收到一张整页试卷 / 作业 / 练习册的照片。请找出页面上的每一道题（含小题组成的整道大题：
一道大题内的多个小问算一道题，不要拆开），并给出每道题在图中的位置。

只输出 JSON，不要 markdown 代码块，不要任何解释文字。所有文字用简体中文。

{
  "questions": [
    {
      "x": 0.05, "y": 0.10, "w": 0.90, "h": 0.06,
      "no": 1,
      "stem": "题干预览（截取题干开头 30 字以内）"
    }
  ]
}

坐标规则（非常重要）：
- x、y 是题目区域左上角的相对坐标，w、h 是区域宽高，全部相对整张图，取值 0 ~ 1；
- 框要贴住题目本身：从题号行开始，到这道题最后一行作答/批改痕迹为止，上下不要把相邻题包进来；
- 顶部试卷标题、页眉、姓名等信息不是题，不要框；整页只有一道解答题时就只输出一个框。

规则：
- no 按阅读顺序从 1 递增；stem 识别不清就写「（模糊）」，不要编造；
- 题目数量以图上实际内容为准，宁可漏一两道模糊的，也不要把两道题框成一道。`;

/** 补齐/校验整页识别结果：坐标夹到 0~1，尺寸保证为正 */
function normalizeSegments(r) {
  const o = r && typeof r === 'object' ? r : {};
  const arr = Array.isArray(o.questions) ? o.questions : [];
  const cl = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
  return arr.map((q, i) => {
    const t = q && typeof q === 'object' ? q : {};
    return {
      x: cl(t.x), y: cl(t.y),
      w: Math.max(0.01, cl(t.w)), h: Math.max(0.008, cl(t.h)),
      no: Number(t.no) || i + 1,
      stem: String(t.stem || '').slice(0, 60),
    };
  }).filter((q) => q.w > 0 && q.h > 0);
}

/** 演示模式：给 6 个均匀分布的示例框（配合前端「载入示例试卷」走通流程） */
function mockSegments() {
  return normalizeSegments({
    questions: Array.from({ length: 6 }, (_, i) => ({
      x: 0.03, y: 0.11 + i * 0.15, w: 0.94, h: 0.07, no: i + 1,
      stem: `第 ${i + 1} 题（演示模式示例框，可拖动 / 缩放 / 点 ➕ 加入错题栏）`,
    })),
  });
}

/** 从图片 Buffer 里读像素尺寸（JPEG SOF 段 / PNG IHDR），读不出返回 null */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {                                                            // JPEG
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
    }
  } catch (e) { /* 结构异常走兜底 */ }
  return null;
}


/**
 * 整页识别：返回每道题的边界框与题干预览。演示模式用示例框，否则走视觉大模型。
 * @param {{buf:Buffer, mime?:string}} p
 */
async function segmentPage({ buf, mime }) {
  const cfg = getConfig();
  if (cfg.mock) return { questions: mockSegments(), model: 'mock（演示模式）' };
  const { text, model } = await visionChat({
    system: SEGMENT_SYSTEM_PROMPT,
    userText: '请识别这张试卷上每一道题的位置，按约定 JSON 输出边界框。',
    images: [{ buf, mime }],
    timeoutMs: 180000,
    temperature: 0.1,
  });
  return { questions: normalizeSegments(extractJson(text)), model };
}

/* ---------------- 错题重组：AI 识别题目 + 生成「举一反三」变式题 ---------------- */

const WRONG_SYSTEM_PROMPT = `你是一名资深 K12 学科老师，擅长用「举一反三」的方式讲题。
你会收到一张题目截图（来自试卷 / 作业 / 练习册，可能带学生作答和老师批改痕迹）。
请完成两件事：
① 识别这道题：学科、年级、核心知识点、题型、题干原文；
② 针对同一知识点出 2 道「举一反三」的变式题，要求与原题考查同一个知识点、难度相当，但数字 / 情境 / 问法有变化，并给出答案与简明解析。

只输出 JSON，不要 markdown 代码块，不要任何解释文字。所有文字用简体中文。

{
  "subject": "学科（数学/英语/物理/化学/语文…）",
  "grade": "年级（看不出就留空字符串）",
  "knowledge": "本题涉及的核心知识点",
  "type": "题型（选择题/填空题/计算题/解答题/实验探究题…）",
  "stem": "题干原文（含选项，尽量完整）",
  "variants": [
    { "stem": "变式题题干（含选项）", "answer": "答案", "analysis": "简明解析，1~3 句，讲清思路与易错点" }
  ]
}

规则：
- variants 固定 2 条；
- 解析要短，能印在一栏里；
- 数学符号可用 Unicode（×、÷、π、²、∠、≈）或普通字符；
- 识别不清的地方不要编造，宁可在 stem 里写「（题干模糊）」。`;

/** 补齐/校验错题识别结果（模型漏字段时给默认值，前端不用判空） */
function normalizeWrongAnalysis(r) {
  const o = r && typeof r === 'object' ? r : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    subject: String(o.subject || ''),
    grade: String(o.grade || ''),
    knowledge: String(o.knowledge || ''),
    type: String(o.type || ''),
    stem: String(o.stem || ''),
    variants: arr(o.variants).slice(0, 3).map((v) => ({
      stem: String((v && v.stem) || ''),
      answer: String((v && v.answer) || ''),
      analysis: String((v && v.analysis) || ''),
    })).filter((v) => v.stem),
  };
}

/** 演示模式：给出结构完整的示例识别结果，无 Key 也能走通「一键重组」 */
function mockWrongAnalysis() {
  return normalizeWrongAnalysis({
    subject: '数学', grade: '五年级', knowledge: '分数四则运算与工程问题', type: '解答题',
    stem: '一项工程，甲队单独做 12 天完成，乙队单独做 18 天完成。两队合作，多少天可以完成这项工程？',
    variants: [
      { stem: '一项工程，甲队单独做 10 天完成，乙队单独做 15 天完成。两队合作 3 天后，剩下的由乙队单独做，还需要多少天完成？', answer: '还需要 7.5 天', analysis: '先求合作 3 天完成的量，再用剩余工作量除以乙队的工作效率。易错点：剩余量要除以乙队效率，不是合作效率。' },
      { stem: '一水池装有甲、乙两个水管。甲管单独注水 8 小时注满，乙管单独注水 12 小时注满，两管同时打开，多少小时能注满水池？', answer: '4.8 小时', analysis: '把水池容量看作单位「1」，进水效率相加：1÷(1/8+1/12)=4.8（小时）。易错点：不要直接取两个时间的平均数。' },
    ],
  });
}

/**
 * 识别单道错题并生成举一反三变式题
 * @param {{buf:Buffer, mime?:string, hint?:string}} p
 */
async function analyzeWrongQuestion({ buf, mime, hint }) {
  const cfg = getConfig();
  if (cfg.mock) return { info: mockWrongAnalysis(), model: 'mock（演示模式）' };
  const { text, model } = await visionChat({
    system: WRONG_SYSTEM_PROMPT,
    userText: hint || '请识别这道题，并按约定 JSON 输出 2 道举一反三的变式题。',
    images: [{ buf, mime }],
    timeoutMs: 180000,
    temperature: 0.3,
  });
  return { info: normalizeWrongAnalysis(extractJson(text)), model };
}

/** 通用文本对话（非视觉）：给其他 AI 能力复用（AI 配置一次，全站共用） */
async function chat({ system, user, maxTokens = 800, temperature = 0.3 }) {
  const cfg = getConfig();
  if (cfg.mock) return { text: '（演示模式）这是一段示例回复，配置 API Key 后即调用真实模型。', model: 'mock（演示模式）' };
  if (!cfg.hasKey) throw new Error('还没有写上 AI 密钥');
  let res;
  try {
    res = await aiFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey()}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          ...(system ? [{ role: 'system', content: String(system) }] : []),
          { role: 'user', content: String(user || '') },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      timeoutMs: 120000,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'AI 请求超时' : '无法连接 AI 接口：' + e.message);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 接口返回 ${res.status}${t ? '：' + t.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return { text: String(text || ''), model: cfg.model };
}

/** 连通性自检：改动配置后点一下「测试」，不用等真的跑一份报告 */
async function testConnection() {
  const cfg = getConfig();
  if (cfg.mock) return { ok: true, mode: 'mock', message: '演示模式已开启：不会调用外部接口，流程可正常走通。' };
  if (!cfg.hasKey) throw new Error('还没有填写 API Key');
  const t0 = Date.now();
  const { text, model } = await chat({ user: '只回复两个字：可用', maxTokens: 20, temperature: 0 });
  return { ok: true, mode: 'live', model, ms: Date.now() - t0, message: `连接成功（${model}）${text ? '：' + text.slice(0, 40) : ''}` };
}

/* ---------------- 后台统一 AI 配置接口（挂在 /api/admin/ai） ---------------- */
const router = express.Router();
const okJson = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
router.get('/config', (req, res) => okJson(res, getConfig()));
router.put('/config', (req, res) => { saveConfig(req.body || {}); okJson(res, getConfig(), '已保存'); });
router.post('/test', async (req, res) => {
  try { okJson(res, await testConnection(), '连接正常'); }
  catch (e) { res.json({ code: 1, msg: String(e.message || e) }); }
});

module.exports = {
  getConfig, saveConfig, analyzePaper, normalizeReport, extractJson, mockReport, SYSTEM_PROMPT,
  chat, testConnection, router,
  // 错题重组
  analyzeWrongQuestion, normalizeWrongAnalysis, mockWrongAnalysis, WRONG_SYSTEM_PROMPT, visionChat,
  segmentPage, normalizeSegments, mockSegments, SEGMENT_SYSTEM_PROMPT, imageSize,
};
