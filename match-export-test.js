'use strict';
const assert = require('assert');
const JSZip = require('jszip');
const { buildPaperDocx } = require('./src/paper-docx');
const { buildMistakeDocx } = require('./src/mistake-docx');

async function textOf(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  return xml.replace(/<\/w:(?:p|tc)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

(async () => {
  const question = { id: 1, type: 'sort', question_subtype: 'math_match', stem: '将算式与结果连线',
    match_prompts: JSON.stringify(['2+3', '3+4']), options: JSON.stringify([{ text: '7' }, { text: '5' }]),
    answer: '2,1', analysis: '分别计算', images: '[]' };
  const paper = { title: '连线练习', subject: '数学', grade: '三年级', duration: 20, total_score: 10, question_scores: '{"1":10}' };
  const student = await textOf(await buildPaperDocx(paper, [question], 'student'));
  assert(student.includes('连线题') && student.includes('2+3') && student.includes('3+4') && student.includes('A. 7') && student.includes('B. 5'), '学生版必须包含左右两列');
  assert(!student.includes('2+3：B. 5') && !student.includes('分别计算'), '学生版不得泄露答案和解析');
  for (const mode of ['answers', 'teacher']) {
    const text = await textOf(await buildPaperDocx(paper, [question], mode));
    assert(text.includes('2+3：B. 5') && text.includes('3+4：A. 7'), `${mode} 应显示逐项正确配对`);
  }
  const mistake = { ...question, match_prompts: ['2+3', '3+4'], options: [{ text: '7' }, { text: '5' }], images: [], wrong_count: 1,
    question_id: 1, updated_at: '2026-11-05 12:00:00', records: [{ my_answer: '1,2', is_correct: 0, created_at: '2026-11-05 12:00:00' }] };
  const text = await textOf(await buildMistakeDocx({ student: { name: '学生' }, subject: '数学', items: [mistake], includeAnswers: true }));
  assert(text.includes('2+3') && text.includes('3+4') && text.includes('A. 7') && text.includes('B. 5'), '错题练习必须包含左右两列');
  assert(text.includes('2+3：B. 5') && text.includes('3+4：A. 7'), '错题解析应显示正确配对');
  assert(text.includes('2+3：A. 7') && text.includes('3+4：B. 5'), '错题记录应显示学生实际配对');
  const listening = { ...question, question_subtype: 'listen_match', stem: '听音匹配', match_prompts: '["Alice","Bob"]' };
  const listeningText = await textOf(await buildPaperDocx({ ...paper, subject: '英语' }, [listening], 'teacher'));
  assert(listeningText.includes('听力匹配题') && listeningText.includes('Alice：B. 5') && listeningText.includes('Bob：A. 7'), '听力匹配也应输出项目与正确配对');
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=';
  const pictorial = { ...question, match_prompts: JSON.stringify(['算式一', '算式二', '算式三', '算式四']), options: JSON.stringify([{ text: '[图1]' }, { text: '[图2]' }]), images: JSON.stringify([pixel, pixel]), answer: '1,2,1,2' };
  for (const mode of ['student', 'answers', 'teacher']) {
    const zip = await JSZip.loadAsync(await buildPaperDocx(paper, [pictorial], mode));
    const xml = await zip.file('word/document.xml').async('string');
    assert(xml.includes('算式四') && (xml.match(/<w:drawing>/g) || []).length === (mode === 'student' ? 2 : 6), `${mode} 的选项及答案中引用的图片应各按位置显示`);
  }
  const pictorialMistake = { ...pictorial, match_prompts: JSON.parse(pictorial.match_prompts), options: JSON.parse(pictorial.options), images: JSON.parse(pictorial.images), records: [] };
  const mistakeZip = await JSZip.loadAsync(await buildMistakeDocx({ student: {}, items: [pictorialMistake] }));
  const mistakeXml = await mistakeZip.file('word/document.xml').async('string');
  assert((mistakeXml.match(/<w:drawing>/g) || []).length === 6, '错题集应将图形放到匹配选项及相应答案');
  const choiceImage = { ...question, type:'single', question_subtype:'', stem:'请选择', material:'材料图 [图1]', options:JSON.stringify([{text:'甲 [图2]'}, {text:'乙'}]), images:JSON.stringify([pixel,pixel]), answer:'A' };
  const choiceZip = await JSZip.loadAsync(await buildPaperDocx(paper, [choiceImage], 'student'));
  const choiceXml = await choiceZip.file('word/document.xml').async('string');
  assert.strictEqual((choiceXml.match(/<w:drawing>/g) || []).length, 2, '普通选择题的材料图和选项图应导出');
  assert(!choiceXml.includes('[图1]') && !choiceXml.includes('[图2]'), '实际图像应替换相应占位符');
  const choiceMistake = { ...choiceImage, options: JSON.parse(choiceImage.options), images: JSON.parse(choiceImage.images), records: [] };
  const choiceMistakeZip = await JSZip.loadAsync(await buildMistakeDocx({ student:{}, items:[choiceMistake], includeAnswers:false }));
  const choiceMistakeXml = await choiceMistakeZip.file('word/document.xml').async('string');
  assert.strictEqual((choiceMistakeXml.match(/<w:drawing>/g) || []).length, 2, '错题集材料与普通选项的图片应按位置输出');
  assert(!choiceMistakeXml.includes('[图1]') && !choiceMistakeXml.includes('[图2]'), '错题集不应遗留已补充图片占位符');
  console.log('连线和听力匹配的学生版、教师版、附答案版及错题 Word 导出通过');
})().catch((e) => { console.error(e); process.exitCode = 1; });
