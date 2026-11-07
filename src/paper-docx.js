'use strict';
/** 教师智能组卷：按已保存的试卷顺序生成 Word。 */
const { Document, Packer, Paragraph, TextRun, PageBreak, AlignmentType, Footer, PageNumber } = require('docx');
const { lines, imageParagraph, imageTextBlocks, imageRefs, answerText, matchQuestionBlocks } = require('./mistake-docx');
const QSubtype = require('../public/js/question-subtypes');
const labels = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题', answer: '解答题' };
const modes = { student: '学生版', answers: '附答案', teacher: '教师版' };
const txt = (text, props = {}) => new TextRun({ text: String(text), font: { ascii: 'Times New Roman', eastAsia: '宋体' }, size: 22, ...props });
const para = (children, opts = {}) => new Paragraph({ children, spacing: { after: 100, line: 340 }, ...opts });
const list = (value) => { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } };
const object = (value) => { try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (_) { return {}; } };
const optionText = (opt) => typeof opt === 'string' ? opt : String((opt && (opt.text || opt.content)) || '');

async function buildPaperDocx(paper, questions, mode) {
  if (!modes[mode]) throw new Error('请选择有效的导出版本');
  const children = [
    para([txt(paper.title, { bold: true, size: 36 })], { alignment: AlignmentType.CENTER, spacing: { after: 180 } }),
    para([txt([paper.subject, paper.grade, paper.term, `共 ${questions.length} 题`, `满分 ${paper.total_score} 分`, `建议 ${paper.duration} 分钟`].filter(Boolean).join('  ·  '), { size: 19, color: '666666' })], { alignment: AlignmentType.CENTER, spacing: { after: 160 } }),
    para([txt('姓名：________________　班级：________________　日期：________________')], { spacing: { after: 220 } }),
  ];
  const scores = object(paper.question_scores);
  let lastType = null, sectionNo = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const groupType = QSubtype.isMatch(q.question_subtype) ? q.question_subtype : q.type;
    if (groupType !== lastType) {
      lastType = groupType; sectionNo++;
      const groupName = ({ math_match: '连线题', listen_match: '听力匹配题' })[groupType] || labels[q.type] || '其他题型';
      children.push(para([txt(`${sectionNo}、${groupName}`, { bold: true, size: 26 })], { keepNext: true, spacing: { before: 160, after: 100 } }));
    }
    const images = list(q.images), used = new Set();
    const appendText = async (text, prefix = [], opts = {}) => {
      let current = prefix.slice();
      for (const part of String(text || '').split(/(\[图\d+\])/g)) {
        const m = /^\[图(\d+)\]$/.exec(part), index = m ? Number(m[1]) - 1 : -1;
        if (m && images[index]) {
          used.add(index);
          if (current.length) children.push(para(current, { ...opts, keepNext: true }));
          current = []; children.push(await imageParagraph(images[index]));
        } else current.push(...lines(part));
      }
      if (current.length) children.push(para(current, opts));
    };
    if (q.material) await appendText(q.material, [], { indent: { left: 240 }, keepNext: true });
    const stem = String(q.stem || ''), parts = stem.split(/(\[图\d+\])/g);
    let current = [txt(`${i + 1}. `, { bold: true })];
    if (Object.prototype.hasOwnProperty.call(scores, q.id)) current.push(txt(`（${scores[q.id]} 分）`));
    for (const part of parts) {
      const m = /^\[图(\d+)\]$/.exec(part);
      if (m && images[Number(m[1]) - 1]) {
        const index = Number(m[1]) - 1; used.add(index);
        children.push(para(current, { keepNext: true })); current = [];
        children.push(await imageParagraph(images[index]));
      } else current.push(...lines(part));
    }
    if (current.length) children.push(para(current, { keepNext: true }));
    const options = list(q.options);
    if (QSubtype.isMatch(q.question_subtype)) {
      const matchText = [...list(q.match_prompts), ...options.map(optionText)].join(' ');
      for (const m of matchText.matchAll(/\[图(\d+)\]/g)) used.add(Number(m[1]) - 1);
    }
    const match = await matchQuestionBlocks({ ...q, options, images });
    if (match.length) children.push(...match);
    else for (const [index, option] of options.entries()) await appendText(optionText(option), [txt(`${String.fromCharCode(65 + index)}. `)], { indent: { left: 360 }, keepLines: true });
    const answerRefs = imageRefs(q.answer, q.analysis);
    for (let j = 0; j < images.length; j++) if (images[j] && !used.has(j) && !answerRefs.has(j)) children.push(await imageParagraph(images[j]));
    if (q.audio_key) children.push(para([txt('听力音频请在线查看。', { color: '666666', size: 18 })]));
    if (mode === 'teacher') {
      children.push(...await imageTextBlocks(answerText({ ...q, options }, q.answer) || '（暂无）', images, [txt('答案：', { bold: true })]));
      children.push(...await imageTextBlocks(q.analysis || '（暂无解析）', images, [txt('解析：', { bold: true })]));
      const score10 = q.difficulty_score_10 == null || q.difficulty_score_10 === '' ? null : Number(q.difficulty_score_10);
      const difficulty = Number.isInteger(score10) && score10 >= 1 && score10 <= 10 ? `${score10}/10` : (q.difficulty ? `${q.difficulty}/5` : '');
      const meta = [q.point ? `知识点：${q.point}` : '', difficulty ? `难度：${difficulty}` : '', q.source ? `来源：${q.source}` : ''].filter(Boolean).join('　');
      if (meta) children.push(para(lines(meta, { color: '666666', size: 18 })));
    } else if (['fill', 'sort', 'answer'].includes(q.type)) {
      children.push(para([txt('________________________________________________________________')], { spacing: { after: 160 } }));
    }
  }
  if (mode === 'answers') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(para([txt('参考答案', { bold: true, size: 30 })], { alignment: AlignmentType.CENTER }));
    for (const [i, q] of questions.entries()) children.push(...await imageTextBlocks(answerText({ ...q, options: list(q.options) }, q.answer) || '（暂无）', list(q.images), [txt(`${i + 1}. `, { bold: true })]));
  }
  const doc = new Document({
    creator: '智学课堂', title: paper.title,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [para([new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页'], size: 18, color: '777777' })], { alignment: AlignmentType.CENTER })] }) }, children }],
  });
  return Packer.toBuffer(doc);
}

function registerPaperDocx(admin, db) {
  admin.get('/papers/:id/export-docx', async (req, res) => {
    const mode = String(req.query.mode || 'student');
    if (!modes[mode]) return res.status(400).json({ code: 1, msg: '请选择有效的导出版本' });
    const paper = db.prepare('SELECT * FROM papers WHERE id=?').get(Number(req.params.id));
    if (!paper) return res.status(404).json({ code: 1, msg: '试卷不存在' });
    const ids = list(paper.q_ids).map(Number).filter(id => Number.isInteger(id) && id > 0);
    if (!ids.length) return res.status(400).json({ code: 1, msg: '试卷没有可导出的题目' });
    if (!require('./qmeta').questionsAllowed(db, req.user, ids)) return res.status(403).json({ code: 403, msg: '无权访问试卷中的题目' });
    const find = db.prepare('SELECT * FROM questions WHERE id=?');
    const questions = ids.map(id => find.get(id));
    if (questions.some(q => !q)) return res.status(400).json({ code: 1, msg: '试卷中的题目已被删除，请先调整试卷' });
    try {
      const buffer = await buildPaperDocx(paper, questions, mode);
      if (!require('./qmeta').questionsAllowed(db, req.user, ids)) return res.status(403).json({ code: 403, msg: '无权访问试卷中的题目' });
      const filename = `${paper.title}-${modes[mode]}.docx`.replace(/[\\/:*?"<>|]/g, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="paper.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (e) {
      console.error('[paper/export-docx]', e.message);
      res.status(500).json({ code: 1, msg: '试卷导出失败，请稍后重试' });
    }
  });
}
module.exports = { buildPaperDocx, registerPaperDocx };
