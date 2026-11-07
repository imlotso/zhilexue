'use strict';
// Offline regression for Word sorting imports. No app, DB, network, model or storage.
// Removing either generic sort marker must fail these tests; answers are literal,
// hand-checked permutations, never derived from the parser's normalization code.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseWordQuestions } = require('./src/wordq');
const { parseDocx } = require('./src/docxtext');
const { judgeQ } = require('./src/bank-judge');
const { Document, Packer, Paragraph } = require('docx');

const stem = '把下列数从小到大排列。';
const options = ['A. 20', 'B. 30', 'C. 10', 'D. 40', 'E. 50'];
function paragraphs({ heading = '排序题', hint = '', answer = 'CABDE', opts = options } = {}) {
  return [heading, `1. ${hint}${stem}`, ...opts, ...(answer === null ? [] : [`答案：${answer}`])].filter(Boolean);
}
function one(paras) {
  const result = parseWordQuestions(paras);
  assert.deepEqual(result.errors, []);
  assert.equal(result.bigCount, 1);
  assert.equal(result.list.length, 1);
  return { result, question: result.list[0] };
}
function expectSort(paras, answer = '3,1,2,4,5', subtype = '') {
  const { result, question } = one(paras);
  assert.equal(question.type, 'sort');
  assert.equal(question.answer, answer);
  assert.equal(question.question_subtype, subtype);
  assert.equal(question.stem, stem);
  assert.deepEqual(question.options.map(o => o.content), ['20', '30', '10', '40', '50']);
  assert.ok(!question.type_unconfirmed);
  if (answer) assert.deepEqual(result.warnings, []);
  return { result, question };
}

test('bare sorting heading preserves CABDE rather than turning it into a multi-choice set', () => {
  expectSort(paragraphs());
});

test('imported sorting answer grades CABDE correct and ABCDE wrong', () => {
  const { question } = one(paragraphs());
  assert.equal(judgeQ(question, 'CABDE'), true);
  assert.equal(judgeQ(question, '3,1,2,4,5'), true);
  assert.equal(judgeQ(question, 'ABCDE'), false);
  assert.equal(judgeQ(question, '1,2,3,4,5'), false);
});

for (const heading of ['一、排序题', '【排序题】', '排序题要求：', '排序题（按大小）']) {
  test(`sorting section wrapper is recognized: ${heading}`, () => expectSort(paragraphs({ heading })));
}

for (const hint of ['（排序题）', '(排序题)', '（排序）', '( 排序题 )']) {
  test(`question-level sorting hint is recognized without a section: ${hint}`, () => {
    expectSort(paragraphs({ heading: '', hint }));
  });
}

for (const answer of ['cabde', 'C,A,B,D,E', 'C，A、B；D;E', 'C A B D E', '3,1,2,4,5', '3，1、2；4;5']) {
  test(`valid sorting sequence keeps its order: ${answer}`, () => expectSort(paragraphs({ answer })));
}

for (const answer of ['CABD', 'CAABE', 'CABDF', 'CABDEG', 'CABDH', 'C1BDE', 'CABDE!', '3,1,2,4', '3,1,2,4,4', '3,1,2,4,6', '0,1,2,4,5']) {
  test(`invalid or incomplete sort answer is rejected, not converted to multi: ${answer}`, () => {
    for (const mode of [{}, { heading: '', hint: '（排序题）' }]) {
      const result = parseWordQuestions(paragraphs({ ...mode, answer }));
      assert.equal(result.list.length, 0);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].msg, /排序题答案/);
      assert.equal(result.errors[0].no, 1);
    }
  });
}

for (const answer of [null, '']) {
  test(`unanswered sort stays sort with a teacher-review warning (${answer === null ? 'omitted' : 'blank'} answer)`, () => {
    for (const mode of [{}, { heading: '', hint: '（排序题）' }]) {
      const { result } = expectSort(paragraphs({ ...mode, answer }), '');
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0].msg, /未提供答案/);
    }
  });
}

test('sorting accepts the existing two and seven option bounds', () => {
  for (const sample of [
    { opts: ['A. 20', 'B. 10'], answer: 'BA', expected: '2,1' },
    { opts: ['A. 2', 'B. 3', 'C. 1', 'D. 4', 'E. 5', 'F. 7', 'G. 6'], answer: 'CABDEGF', expected: '3,1,2,4,5,7,6' },
  ]) {
    const { question } = one(paragraphs(sample));
    assert.equal(question.type, 'sort');
    assert.equal(question.answer, sample.expected);
  }
});

test('sorting rejects too few, too many, gapped and repeated option labels', () => {
  for (const opts of [
    ['A. 1'],
    ['A. 1', 'B. 2', 'C. 3', 'D. 4', 'E. 5', 'F. 6', 'G. 7', 'H. 8'],
    ['A. 1', 'C. 2'],
    ['A. 1', 'A. 2'],
  ]) {
    const result = parseWordQuestions(paragraphs({ opts, answer: null }));
    assert.equal(result.list.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].msg, /排序题.*选项/);
  }
});

test('ordinary explicit and inferred multi-choice still canonicalize an unordered set', () => {
  for (const mode of [{ heading: '多选题' }, { heading: '', hint: '（多选题）' }, { heading: '' }]) {
    const { result, question } = one(paragraphs({ ...mode, answer: 'CABA' }));
    assert.equal(question.type, 'multi');
    assert.equal(question.answer, 'A,B,C');
    assert.equal(question.question_subtype, '');
    assert.equal(judgeQ(question, 'ABC'), true);
    assert.equal(judgeQ(question, 'CBA'), true);
    assert.deepEqual(result.warnings, []);
  }
});

test('explicit English sorting subtypes remain intact in headings and hints', () => {
  for (const [label, subtype] of [['连词成句', 'sentence_sort'], ['听力排序', 'listen_sort']]) {
    for (const mode of [{ heading: label }, { heading: `${label}题` }, { heading: '', hint: `（${label}）` }]) {
      expectSort(paragraphs(mode), '3,1,2,4,5', subtype);
    }
  }
});

test('a generic sorting section resets English subtype and permits numbering restart', () => {
  const result = parseWordQuestions([
    ...paragraphs({ heading: '连词成句' }),
    ...paragraphs(),
    ...paragraphs({ heading: '多选题', answer: 'CAB' }),
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.bigCount, 3);
  assert.deepEqual(result.list.map(q => [q.no, q.type, q.question_subtype, q.answer]), [
    [1, 'sort', 'sentence_sort', '3,1,2,4,5'],
    [1, 'sort', '', '3,1,2,4,5'],
    [1, 'multi', '', 'A,B,C'],
  ]);
});

test('question hint keeps its existing override behavior and does not leak into the next question', () => {
  const result = parseWordQuestions([
    ...paragraphs({ heading: '多选题', hint: '（排序题）' }),
    '2. 选择所有正确的数。', ...options, '答案：CAB',
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.list.map(q => [q.type, q.question_subtype, q.answer]), [
    ['sort', '', '3,1,2,4,5'], ['multi', '', 'A,B,C'],
  ]);
});

test('real DOCX paragraph extraction reaches the generic sorting parser without losing order', async () => {
  for (const mode of [{}, { heading: '', hint: '（排序题）' }]) {
    const input = paragraphs(mode);
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: input.map(text => new Paragraph(text)) }] }));
    const doc = await parseDocx(buffer);
    assert.deepEqual(doc.paras, input);
    assert.deepEqual(doc.figs, []);
    expectSort(doc.paras);
  }
});
