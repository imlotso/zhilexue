'use strict';
const assert = require('assert');
const JSZip = require('jszip');
const { buildPaperDocx } = require('./src/paper-docx');
const { buildMistakeDocx } = require('./src/mistake-docx');

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=', 'base64');
// 尾部差异仅用于在 Word 包中辨认各图片；原 PNG 内容保留。
const images = [1, 2, 3, 4, 5].map(n => Buffer.concat([pixel, Buffer.from(`test-image-${n}`)]));
const sources = images.map(buf => `data:image/png;base64,${buf.toString('base64')}`);

async function inspect(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const idToImage = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]+)\/>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]);
    const target = /\bTarget="([^"]+)"/.exec(m[1]);
    if (!id || !target || !target[1].includes('media/')) continue;
    const entry = zip.file(`word/${target[1].replace(/^\//, '')}`);
    if (!entry) continue;
    const data = await entry.async('nodebuffer');
    idToImage.set(id[1], images.findIndex(img => img.equals(data)) + 1);
  }
  const parts = [];
  const re = /题干前|题干后|答前|答中|答后|解析前|解析后|参考答案|错题解析|<a:blip\b[^>]*r:embed="([^"]+)"/g;
  for (const m of xml.matchAll(re)) parts.push(m[1] ? `图${idToImage.get(m[1]) || '?'}` : m[0]);
  return parts;
}

(async () => {
  const paper = { title: '图像安全', subject: '数学', grade: '七年级', total_score: 10, duration: 20 };
  const q = { id: 1, type: 'answer', stem: '题干前[图1]题干后', options: '[]', images: JSON.stringify(sources),
    answer: '答前[图2]答中[图2]答后', analysis: '解析前[图3]解析后[图1]' };
  const student = await inspect(await buildPaperDocx(paper, [q], 'student'));
  assert.deepStrictEqual(student, ['题干前', '图1', '题干后', '图4', '图5'], '学生题面不得包含答案或解析专用图；旧题未引用图仍保留');
  const teacher = await inspect(await buildPaperDocx(paper, [q], 'teacher'));
  assert.deepStrictEqual(teacher, ['题干前', '图1', '题干后', '图4', '图5', '答前', '图2', '答中', '图2', '答后', '解析前', '图3', '解析后', '图1'], '教师版按原位置显示答案和解析图片，并支持重复和共用图');
  const answers = await inspect(await buildPaperDocx(paper, [q], 'answers'));
  assert.deepStrictEqual(answers, ['题干前', '图1', '题干后', '图4', '图5', '参考答案', '答前', '图2', '答中', '图2', '答后'], '附答案版不得提前泄露答案图，答案部分按原位置显示');
  const mistake = { ...q, options: [], images: sources, records: [] };
  const without = await inspect(await buildMistakeDocx({ student: {}, items: [mistake], includeAnswers: false }));
  assert.deepStrictEqual(without, ['题干前', '图1', '题干后', '图4', '图5'], '错题练习不泄露答案或解析图，图号不因第 4 张限制而移位');
  const withAnswers = await inspect(await buildMistakeDocx({ student: {}, items: [mistake], includeAnswers: true }));
  assert.deepStrictEqual(withAnswers, ['题干前', '图1', '题干后', '图4', '图5', '答前', '图2', '答中', '图2', '答后', '解析前', '图3', '解析后', '图1'], '错题解析中答案和解析图片应出现在原文位置');
  const sparse = { ...q, stem: '题干前题干后', answer: '答前[图5]答后', analysis: '', images: JSON.stringify([null, null, null, null, sources[4]]) };
  assert.deepStrictEqual(await inspect(await buildPaperDocx(paper, [sparse], 'student')), ['题干前', '题干后'], '稀疏图片列表不得在题面泄漏第 5 张答案图');
  assert.deepStrictEqual(await inspect(await buildPaperDocx(paper, [sparse], 'teacher')), ['题干前', '题干后', '答前', '图5', '答后'], '稀疏图号按原索引解析');
  console.log('试卷和错题 Word 图像分区、原位置、重复引用及旧题兼容测试通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
