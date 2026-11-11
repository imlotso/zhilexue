'use strict';
// Synthetic, valid stored DOCX packages + the production parsers/import functions.
// No server, account, real database, storage, network, OCR or third-party package.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseDocx, parseDocxQuestions } = require('./src/docxtext');
const { parseWordQuestions } = require('./src/wordq');
const MatchQ = require('./src/match-question');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const key = Buffer.from(name), data = Buffer.from(value), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(key.length, 26);
    const item = Buffer.concat([local, key, data]); locals.push(item);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(key.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, key); offset += item.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const xmlText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = text => `<w:p><w:r><w:t>${xmlText(text)}</w:t></w:r></w:p>`;
const picture = id => `<w:r><w:drawing><a:blip r:embed="${id}"/></w:drawing></w:r>`;
function docx(body, relations = '', media = {}) {
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ...media,
  };
  if (relations !== null) entries['word/_rels/document.xml.rels'] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`;
  return zip(entries);
}
const imageType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const relation = (id, target) => `<Relationship Id="${id}" Type="${imageType}" Target="${target}"/>`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=', 'base64');

function loadFunction(filename, start, end, globals) {
  const source = fs.readFileSync(path.join(__dirname, 'src', filename), 'utf8');
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'production import function is available');
  const box = { ...globals };
  vm.runInNewContext(source.slice(from, to), box, { filename });
  return box;
}
function wordImporter(failed = false) {
  const box = loadFunction('mfpending.js', '  async function parseWordUpload(file) {', "\n  stagedPost('/ext/import-word'", {
    require: name => { assert.ok(['./docxtext', './wordq'].includes(name)); return require('./src/' + name.slice(2)); },
    fileNameOf: file => file.originalname, str: value => value == null ? '' : String(value), MatchQ,
    TYPE_FROM_CODE: code => ({ answer: '解答', fill: '填空', single: '单选', multi: '多选', judge: '判断', sort: '排序' })[code],
    bankFolder: () => 'bank', store: {
      async saveFile(bytes, filename, folder) { assert.equal(folder, 'bank/img'); assert.ok(bytes.equals(pixel)); return { key: failed ? '' : `bank/img/${filename}` }; },
      bankImageKey: key => key, bankImageProxyUrl: key => `/api/file?key=${key}`, async getUrl() { return ''; },
    },
  });
  return buffer => box.parseWordUpload({ originalname: '合成导入.docx', buffer });
}
function lessonImporter(failed = false) {
  const writes = [];
  const scopeDb = new (require('better-sqlite3'))(':memory:');
  require('./school-scope-test-fixture')(scopeDb);
  scopeDb.prepare('INSERT INTO videos(id) VALUES(?)').run(11);
  const box = loadFunction('bank.js', 'async function importLessonDocx(req, res, kind) {', "\nadmin.post('/videos/:id/import-docx'", {
    require: name => { assert.ok(['./docxtext', './compose', './school-scope'].includes(name)); return require('./src/' + name.slice(2)); },
    db: { prepare(sql) {
      if (sql === 'SELECT * FROM videos WHERE id=?') return { get(id) { assert.equal(id, 11); return { id: 11, title: '合成视频', chapter_id: null }; } };
      if (/^SELECT\b/.test(sql)) return scopeDb.prepare(sql);
      assert.match(sql, /^INSERT INTO mf_recog_runs /);
      return { run(...args) { writes.push(args); return { lastInsertRowid: 7 }; } };
    } },
    fail: (res, error) => { res.error = error; }, ok: (res, data) => { res.data = data; },
    stageOfGrade: () => 'primary', now: () => '2026-11-07', bankImgFolder: () => 'bank',
    store: {
      async saveFile(bytes, filename, folder) { assert.equal(folder, 'bank/img'); assert.ok(bytes.equals(pixel)); return { key: failed ? '' : `bank/img/${filename}` }; },
      bankImageKey: key => key, bankImageProxyUrl: key => `/api/file?key=${key}`, async getUrl() { return ''; },
    },
  });
  return async buffer => {
    const res = {};
    try {
      await box.importLessonDocx({ params: { id: 11 }, body: { subject: '数学' }, file: { originalname: '合成课文.docx', buffer } }, res, 'video');
      return { ...res, cards: writes.length ? JSON.parse(writes[0][8]) : [], writes };
    } finally { scopeDb.close(); }
  };
}

// Each regression catches a concrete text/image loss or a wrong local image mapping.
test('plain text DOCX without a document relationships part still imports', async () => {
  const result = await parseDocx(docx(p('1.（问答题）为什么？') + p('答案：因为如此'), null));
  assert.deepEqual(result, { paras: ['1.（问答题）为什么？', '答案：因为如此'], figs: [] });
});
test('tab stops and inline tabs do not swallow text or leak XML into the question', async () => {
  const body = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A. 甲</w:t><w:tab/><w:t>B. 乙</w:t></w:r></w:p>';
  const result = await parseDocx(docx(body));
  assert.deepEqual(result.paras, ['A. 甲\tB. 乙']);
  const parsed = parseWordQuestions(['单选题', '1.选择', ...result.paras, '答案：B']);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.list[0].options, [{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }]);
});
for (const rel of [
  `<Relationship Target="media/one.png" Type="${imageType}" Id="rId2"/>`,
  relation('rId2', '/word/media/one.png'),
  relation('rId2', './media/one.png'),
]) test('embedded image resolves a valid relationship independent of attribute order or package path: ' + rel, async () => {
  const result = await parseDocx(docx('<w:p>' + picture('rId2') + '</w:p>', rel, { 'word/media/one.png': pixel }), { saveImage: async () => 'saved:one' });
  assert.deepEqual(result, { paras: ['[图1]'], figs: [{ n: 1, url: 'saved:one' }] });
});
test('decimal and hexadecimal XML character references preserve mathematical text', async () => {
  const result = await parseDocx(docx('<w:p><w:r><w:t>1. &#x4E09;&#32;&#8804; 3 &amp; &#x1F34E;</w:t></w:r></w:p>'));
  assert.deepEqual(result.paras, ['1. 三 ≤ 3 & 🍎']);
});
test('failed embedded-image save retains a missing slot instead of deleting content and renumbering later figures', async () => {
  const result = await parseDocx(docx('<w:p>' + picture('a') + picture('b') + '</w:p>', relation('a', 'media/a.png') + relation('b', 'media/b.png'), { 'word/media/a.png': pixel, 'word/media/b.png': pixel }), { saveImage: async (_, name) => name === 'a.png' ? '' : 'saved:b' });
  assert.deepEqual(result, { paras: ['[图1][图2]'], figs: [{ n: 1, url: '' }, { n: 2, url: 'saved:b' }] });
});
for (const [name, paras, refs] of [
  ['free answer', ['问答题', '1.请作图[图1]', '答案：[图2]', '解析：说明[图3]'], [1, 3, 2]],
  ['fill answer', ['填空题', '1.填图 ____', '答案：[图4]'], [4]],
  ['block without subquestions', ['问答题', '1.[问答题]根据图形回答', '答案：[图2]', '解析：[图3]', '[问答题结束]'], [2, 3]],
  ['block subquestion', ['问答题', '1.[问答题]材料[图1]', '（1）作图', '答案：[图2]', '解析：[图3]', '[问答题结束]'], [1, 3, 2]],
]) test('Word question retains answer-only images: ' + name, () => {
  const result = parseWordQuestions(paras);
  assert.deepEqual(result.errors, []);
  assert.equal(result.list.length, 1);
  assert.deepEqual(result.list[0].imgRefs, refs);
});
test('lesson question parser retains answer-only image references', () => {
  const result = parseDocxQuestions(['1.（问答题）作图[图1]', '答案：[图2]', '解析：[图3]']);
  assert.deepEqual(result.list[0].imgRefs, [1, 3, 2]);
});

function twoQuestions() {
  const body = p('1.（问答题）第一题') + '<w:p>' + picture('a') + '</w:p>' + p('答案：甲')
    + p('2.（问答题）第二题') + '<w:p>' + picture('b') + '</w:p>'
    + '<w:p><w:r><w:t>答案：</w:t></w:r>' + picture('c') + '</w:p>';
  return docx(body, ['a', 'b', 'c'].map(id => relation(id, `media/${id}.png`)).join(''), Object.fromEntries(['a', 'b', 'c'].map(id => [`word/media/${id}.png`, pixel])));
}
test('pending Word import remaps both stem and answer to the same per-question image list', async () => {
  const result = await wordImporter()(twoQuestions());
  assert.equal(result.err, undefined);
  assert.equal(result.cards.length, 2);
  const q = result.cards[1];
  assert.equal(q.stem, '第二题\n[图1]');
  assert.equal(q.answer, '[图2]');
  assert.deepEqual(Array.from(q.figures, image => image.url), ['/api/file?key=bank/img/b.png', '/api/file?key=bank/img/c.png']);
});
test('pending Word import refuses an image-save failure rather than admitting incomplete questions', async () => {
  const result = await wordImporter(true)(twoQuestions());
  assert.match(result.err || '', /题图未能保存/);
  assert.equal(result.cards, undefined);
});
test('lesson Word import remaps stem and answer before staging', async () => {
  const result = await lessonImporter()(twoQuestions());
  assert.equal(result.error, undefined);
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[1].stem, '第二题\n[图1]');
  assert.equal(result.cards[1].answer, '[图2]');
  assert.deepEqual(result.cards[1].figures, [{ url: '/api/file?key=bank/img/b.png' }, { url: '/api/file?key=bank/img/c.png' }]);
});
test('lesson Word import reports failed figures without writing an incomplete pending batch', async () => {
  const result = await lessonImporter(true)(twoQuestions());
  assert.match(result.error || '', /题图未能保存/);
  assert.equal(result.writes.length, 0);
});
test('lesson Word importer preserves an untyped numbered question stem', () => {
  const result = parseDocxQuestions(['1.计算 1 + 1', '答案：2', '2.结果 ____', '答案：3']);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer]), [['计算 1 + 1', '2'], ['结果 ____', '3']]);
});
test('lesson import also remaps figures that appear inside an option and analysis', async () => {
  const body = p('1.（问答题）第一题') + '<w:p>' + picture('a') + '</w:p>' + p('答案：甲')
    + p('2.（单选题）第二题') + '<w:p>' + picture('b') + '</w:p>'
    + '<w:p><w:r><w:t>A. </w:t></w:r>' + picture('c') + '</w:p>' + p('B. 乙') + p('答案：A')
    + '<w:p><w:r><w:t>解析：</w:t></w:r>' + picture('d') + '</w:p>';
  const input = docx(body, ['a', 'b', 'c', 'd'].map(id => relation(id, `media/${id}.png`)).join(''), Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [`word/media/${id}.png`, pixel])));
  const result = await lessonImporter()(input);
  assert.equal(result.error, undefined);
  assert.equal(result.cards[1].stem, '第二题\n[图1]');
  assert.deepEqual(result.cards[1].options, [{ label: 'A', content: '[图2]' }, { label: 'B', content: '乙' }]);
  assert.equal(result.cards[1].answer, 'A');
  assert.equal(result.cards[1].analysis, '[图3]');
  assert.deepEqual(result.cards[1].figures.map(image => image.url), ['b', 'c', 'd'].map(id => `/api/file?key=bank/img/${id}.png`));
});
test('missing media bytes are represented as a missing figure and rejected before a pending batch', async () => {
  const input = docx(p('1.（问答题）参考图片回答') + '<w:p>' + picture('absent') + '</w:p>', relation('absent', 'media/missing.png'));
  const result = await wordImporter()(input);
  assert.match(result.err || '', /题图未能保存/);
  assert.equal(result.cards, undefined);
});
test('XML text decoding is one pass and preserves escaped entity-looking text', async () => {
  const result = await parseDocx(docx('<w:p><w:r><w:t>&amp;#65; &lt;x&gt; &quot;a&quot; &apos;b&apos;</w:t></w:r></w:p>'));
  assert.deepEqual(result.paras, ['&#65; <x> "a" \'b\'']);
});
test('shared material images and answer images remain available on each subquestion', () => {
  const result = parseWordQuestions(['[材料]', '阅读[图1]', '[材料结束]', '1.（问答题）问题甲', '答案：[图2]', '2.（问答题）问题乙', '答案：[图3]']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.list.map(q => [...q.imgRefs].sort()), [[1, 2], [1, 3]]);
  assert.equal(result.list[0].group_ref, result.list[1].group_ref);
});
test('paired Word line-break and tab elements preserve whitespace just like their self-closing forms', async () => {
  const result = await parseDocx(docx('<w:p><w:r><w:t>甲</w:t><w:br></w:br><w:t>乙</w:t><w:tab></w:tab><w:t>丙</w:t></w:r></w:p>'));
  assert.deepEqual(result.paras, ['甲\n乙\t丙']);
});
test('single-quoted embedded picture attributes are retained by Word import', async () => {
  const input = docx(p('1.（问答题）根据图片回答') + '<w:p><w:r><w:drawing><a:blip r:embed=\'a\'/></w:drawing></w:r></w:p>', relation('a', 'media/a.png'), { 'word/media/a.png': pixel });
  const result = await wordImporter()(input);
  assert.equal(result.err, undefined);
  assert.equal(result.cards[0].stem, '根据图片回答\n[图1]');
  assert.deepEqual(Array.from(result.cards[0].figures, image => image.url), ['/api/file?key=bank/img/a.png']);
});
test('external linked pictures are reported as unavailable without fetching or dropping them', async () => {
  const input = docx(p('1.（问答题）根据图片回答') + '<w:p><w:r><w:drawing><a:blip r:link="a"/></w:drawing></w:r></w:p>', `<Relationship Id="a" Type="${imageType}" TargetMode="External" Target="https://invalid.example/picture.png"/>`);
  const result = await wordImporter()(input);
  assert.match(result.err || '', /题图未能保存/);
  assert.equal(result.cards, undefined);
});
test('mixed typed and untyped lesson questions keep separate stems and answers', () => {
  const result = parseDocxQuestions(['1.（问答题）第一题', '答案：甲', '2.第二题', '答案：乙']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer]), [['第一题', '甲'], ['第二题', '乙']]);
});
test('an untyped first lesson question is not dropped when a later question has a type hint', () => {
  const result = parseDocxQuestions(['1.第一题', '答案：甲', '2.（问答题）第二题', '答案：乙']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer]), [['第一题', '甲'], ['第二题', '乙']]);
});
test('an untyped next lesson question with complete options stays separate even without an answer', () => {
  const result = parseDocxQuestions(['1.（问答题）第一题', '答案：甲', '2.第二题', 'A. 一', 'B. 二']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer, q.type]), [['第一题', '甲', 'answer'], ['第二题', '', 'single']]);
});
test('explicitly typed unanswered questions in mixed lesson documents are retained', () => {
  const result = parseDocxQuestions(['1.（问答题）第一题', '答案：甲', '2.（问答题）为什么？', '3.（填空题）填入 ____']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer, q.type]), [['第一题', '甲', 'answer'], ['为什么？', '', 'answer'], ['填入 ____', '', 'fill']]);
});
test('numbered explanation steps without new-question evidence stay in the preceding analysis', () => {
  const result = parseDocxQuestions(['1.（问答题）第一题', '答案：甲', '解析：计算过程', '1. 第一步计算', '2. 第二步计算', '2.（问答题）第二题', '答案：乙']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer]), [['第一题', '甲'], ['第二题', '乙']]);
  assert.equal(result.list[0].analysis, '计算过程\n1. 第一步计算\n2. 第二步计算');
});
test('legacy VML Word picture is retained in the pending question', async () => {
  const input = docx(p('1.（问答题）根据图片回答') + '<w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:imagedata r:id="a"/></v:shape></w:pict></w:r></w:p>', relation('a', 'media/a.png'), { 'word/media/a.png': pixel });
  const result = await wordImporter()(input);
  assert.equal(result.err, undefined);
  assert.equal(result.cards[0].stem, '根据图片回答\n[图1]');
  assert.deepEqual(Array.from(result.cards[0].figures, image => image.url), ['/api/file?key=bank/img/a.png']);
});
const vml = id => `<w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:imagedata r:id="${id}"/></v:shape></w:pict></w:r>`;
const alternate = (choice, fallback) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w14">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
test('Word alternate representations use one supported image rather than duplicating DrawingML and VML', async () => {
  const input = docx('<w:p>' + alternate(picture('a'), vml('b')) + '</w:p>', relation('a', 'media/a.png') + relation('b', 'media/b.png'), { 'word/media/a.png': pixel, 'word/media/b.png': pixel });
  const saved = [];
  const result = await parseDocx(input, { saveImage: async (_, name) => { saved.push(name); return name; } });
  assert.deepEqual(result, { paras: ['[图1]'], figs: [{ n: 1, url: 'a.png' }] });
  assert.deepEqual(saved, ['a.png']);
});
test('VML fallback is used when the alternate primary is an unsupported drawing shape', async () => {
  const input = docx('<w:p>' + alternate('<w:r><w:drawing><unsupported:shape xmlns:unsupported="urn:unsupported"/></w:drawing></w:r>', vml('b')) + '</w:p>', relation('b', 'media/b.png'), { 'word/media/b.png': pixel });
  const result = await parseDocx(input, { saveImage: async (_, name) => name });
  assert.deepEqual(result, { paras: ['[图1]'], figs: [{ n: 1, url: 'b.png' }] });
});
test('independent DrawingML and VML images in the same paragraph are both preserved', async () => {
  const input = docx('<w:p>' + picture('a') + vml('b') + '</w:p>', relation('a', 'media/a.png') + relation('b', 'media/b.png'), { 'word/media/a.png': pixel, 'word/media/b.png': pixel });
  const result = await parseDocx(input, { saveImage: async (_, name) => name });
  assert.deepEqual(result, { paras: ['[图1][图2]'], figs: [{ n: 1, url: 'a.png' }, { n: 2, url: 'b.png' }] });
});
for (const step of ['为什么这个量不变？', '填入 ____ 后继续']) test('an explicit next question takes priority over a question-like explanation step: ' + step, () => {
  const result = parseDocxQuestions(['1.（问答题）第一题', '答案：甲', '解析：按两个步骤分析', '1. 先列出已知量', '2. ' + step, '2.（问答题）第二题', '答案：乙']);
  assert.deepEqual(result.list.map(q => [q.stem, q.answer]), [['第一题', '甲'], ['第二题', '乙']]);
  assert.equal(result.list[0].analysis, '按两个步骤分析\n1. 先列出已知量\n2. ' + step);
});
test('embedded cached image is preferred when an external link attribute appears first', async () => {
  const input = docx('<w:p><w:r><w:drawing><a:blip r:link="external" r:embed="cached"/></w:drawing></w:r></w:p>',
    `<Relationship Id="external" Type="${imageType}" TargetMode="External" Target="https://invalid.example/image.png"/>` + relation('cached', 'media/a.png'), { 'word/media/a.png': pixel });
  const saved = [];
  const result = await parseDocx(input, { saveImage: async (_, name) => { saved.push(name); return name; } });
  assert.deepEqual(result, { paras: ['[图1]'], figs: [{ n: 1, url: 'a.png' }] });
  assert.deepEqual(saved, ['a.png']);
});
for (const field of ['答案', '解析']) for (const step of ['为什么这个量不变？', '填入 ____ 后继续']) test('a final numbered ' + field + ' step is not invented as an unanswered question: ' + step, () => {
  const paras = ['1.（问答题）说明水的质量是否变化'];
  if (field === '解析') paras.push('答案：不变');
  paras.push(field + '：分两步说明', '1. 先记录实验前的质量', '2. ' + step, '因为封闭体系的总质量守恒');
  const result = parseDocxQuestions(paras);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0][field === '答案' ? 'answer' : 'analysis'], '分两步说明\n1. 先记录实验前的质量\n2. ' + step + '\n因为封闭体系的总质量守恒');
});
