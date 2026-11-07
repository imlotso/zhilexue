'use strict';
/**
 * 题库 Excel 模板生成 + 导入解析
 * 运行 `npm run make-template` 生成模板文件。
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const HEADERS = [
  '题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H', '选项I', '选项J',
  '答案', '解析', '难度', '章节编码', '学科', '年级',
];

const SAMPLE = [
  {
    题型: '单选题', 题干: '下列各数中，是负数的是（ ）',
    选项A: '0', 选项B: '-3', 选项C: '2', 选项D: '1/2',
    答案: 'B', 解析: '小于 0 的数是负数，-3 < 0，故选 B。',
    难度: 1, 章节编码: 'S7-1-1', 学科: '数学', 年级: '七年级',
  },
  {
    题型: '多选题', 题干: '下列说法正确的有（ ）',
    选项A: '0 既不是正数也不是负数', 选项B: '最小的正整数是 0',
    选项C: '整数包括正整数、0 和负整数', 选项D: '有理数都可以写成分数',
    答案: 'A,C', 解析: 'B 错，最小的正整数是 1。',
    难度: 3, 章节编码: 'S7-1-1', 学科: '数学', 年级: '七年级',
  },
  {
    题型: '填空题', 题干: '-5 的绝对值是____，相反数是____。',
    答案: '5|-5', 解析: '绝对值是到原点的距离；相反数符号相反。',
    难度: 2, 章节编码: 'S7-1-1', 学科: '数学', 年级: '七年级',
  },
];

/** 生成模板文件到指定路径 */
function makeTemplate(outPath) {
  const ws = XLSX.utils.json_to_sheet(SAMPLE, { header: HEADERS });
  ws['!cols'] = HEADERS.map((h) => ({ wch: h === '题干' || h === '解析' ? 40 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '题库');

  // 说明页
  const help = [
    ['字段', '填写说明'],
    ['题型', '单选题 / 多选题 / 填空题（也支持 single/multi/fill）'],
    ['题干', '必填。选择题必须包含 A/B 两个以上选项'],
    ['选项A~J', '选择题从 A 开始连续填写；填空题留空'],
    ['答案', '单选：填 A；多选：填 A,C 或 AC；填空：多个空用竖线 | 分隔，如 5|-5'],
    ['解析', '选填，学生答题后可查看'],
    ['难度', '1~5 的整数，1 最简单，5 最难'],
    ['章节编码', '必填，需与管理端"章节"里设置的编码一致，用于归类'],
    ['学科 / 年级', '选填，留空则自动取章节的学科年级'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(help);
  ws2['!cols'] = [{ wch: 14 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, ws2, '填写说明');

  XLSX.writeFile(wb, outPath);
  return outPath;
}

const TYPES = { '单选题': 'single', '多选题': 'multi', '填空题': 'fill', single: 'single', multi: 'multi', fill: 'fill' };
const LETTERS = 'ABCDEFGHIJ';

/** 解析上传的 Excel → { items, errors } */
function parseWorkbook(buffer, chapters) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const byCode = {};
  chapters.forEach((c) => { if (c.code) byCode[String(c.code).trim()] = c; });
  const byName = {};
  chapters.forEach((c) => { byName[c.name.trim()] = c; });

  const items = [];
  const errors = [];

  rows.forEach((r, i) => {
    const line = i + 2; // 表头占 1 行
    const rawType = String(r['题型'] || '').trim();
    const type = TYPES[rawType];
    const stem = String(r['题干'] || '').trim();
    const answerRaw = String(r['答案'] == null ? '' : r['答案']).trim();
    const code = String(r['章节编码'] || '').trim();

    if (!stem && !rawType && !answerRaw) return; // 空行跳过

    if (!type) { errors.push(`第 ${line} 行：题型"${rawType}"无法识别（应为 单选题/多选题/填空题）`); return; }
    if (!stem) { errors.push(`第 ${line} 行：题干为空`); return; }
    if (!answerRaw) { errors.push(`第 ${line} 行：答案为空`); return; }

    const options = [];
    let gap = false;
    for (const L of LETTERS) {
      const v = String(r['选项' + L] == null ? '' : r['选项' + L]).trim();
      if (!v) { gap = true; continue; }
      if (gap && (type === 'single' || type === 'multi')) { errors.push(`第 ${line} 行：选项须从 A 开始连续填写`); return; }
      options.push(v.replace(/^[A-Ja-j][.、．)）]\s*/, ''));
    }

    let answer = answerRaw;
    if (type === 'single' || type === 'multi') {
      if (options.length < 2) { errors.push(`第 ${line} 行：选择题至少需要 2 个选项`); return; }
      if (!/^[A-J\s,，、;；]+$/i.test(answerRaw)) { errors.push(`第 ${line} 行：选择题答案应为 A–J 选项字母`); return; }
      const letters = (answerRaw.toUpperCase().match(/[A-J]/g) || []);
      if (!letters.length) { errors.push(`第 ${line} 行：选择题答案应为选项字母，如 A 或 A,C`); return; }
      const bad = letters.find((L) => LETTERS.indexOf(L) >= options.length);
      if (bad) { errors.push(`第 ${line} 行：答案包含不存在的选项 ${bad}`); return; }
      if (type === 'single' && letters.length > 1) { errors.push(`第 ${line} 行：单选题答案只能有一个字母`); return; }
      answer = [...new Set(letters)].sort().join(',');
    }

    let chapter = null;
    if (code) {
      chapter = byCode[code] || byName[code] || null;
      if (!chapter) { errors.push(`第 ${line} 行：章节编码"${code}"不存在，请先在"章节管理"中添加`); return; }
    }

    const diff = parseInt(r['难度'], 10);
    items.push({
      chapter_id: chapter ? chapter.id : null,
      subject: String(r['学科'] || '').trim() || (chapter ? chapter.subject : ''),
      grade: String(r['年级'] || '').trim() || (chapter ? chapter.grade : ''),
      type, stem, options,
      answer,
      analysis: String(r['解析'] || '').trim(),
      difficulty: Number.isFinite(diff) ? Math.min(5, Math.max(1, diff)) : 3,
    });
  });

  return { items, errors };
}

module.exports = { makeTemplate, parseWorkbook, HEADERS };

if (require.main === module) {
  const out = path.join(__dirname, '..', '..', 'docs', '题库导入模板.xlsx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  makeTemplate(out);
  console.log('模板已生成：' + out);
}
