'use strict';
// Real commitCaptureItems and complete JSON import handler; fresh SQLite only.
// Multipart, receipt orchestration and image transfer are controlled boundaries.
// No application bootstrap, server, real database, network or AI is invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
let open;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  open = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  open = () => new DatabaseSync(':memory:');
}
const source = fs.readFileSync(path.join(__dirname, 'src/mfbank.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'production source boundary: ' + start);
  return source.slice(a, b);
}
const packDetail = { via: 'mf-pack', packageId: 'synthetic-pack', datasetId: '', recordKey: 'record-1', sourceName: '' };
function fixture(t, status, kind) {
  const db = open(); t.after(() => db.close());
  db.exec(`
    CREATE TABLE users(id INTEGER,role TEXT,created_by INTEGER);
    INSERT INTO users VALUES(101,'student',10);
    CREATE TABLE paper_uploads(user_id INTEGER,status TEXT,question_id INTEGER);
    CREATE TABLE questions(id INTEGER PRIMARY KEY, subject TEXT,stage TEXT,grade TEXT,type TEXT,stem TEXT,stem_html TEXT,options TEXT,
      answer TEXT,analysis TEXT,difficulty INTEGER,difficulty_score_10 INTEGER,point TEXT,material TEXT,source TEXT,year TEXT,images TEXT,
      audio_key TEXT,source_type TEXT,source_detail TEXT,sort INTEGER,created_at TEXT,ai_review_metadata TEXT,audio_play_limit INTEGER,
      question_subtype TEXT,match_prompts TEXT);
    CREATE TABLE question_tags(question_id INTEGER,tag TEXT,UNIQUE(question_id,tag));
    CREATE TABLE question_nodes(question_id INTEGER,node_id INTEGER,UNIQUE(question_id,node_id));
    CREATE TABLE mf_recog_runs(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,source_kind TEXT,source_name TEXT,
      status TEXT,pages TEXT,drafts TEXT,ocr_texts TEXT,error TEXT,created_at TEXT);
  `);
  const detail = kind === 'capture' ? { site: 'jyeoo', questionId: 'source-1' } : packDetail;
  db.prepare("INSERT INTO questions(id,stem,answer,analysis,point,images,source_type,source_detail,ai_review_metadata) VALUES(1,'private old content','','','','[]',?,?,?)")
    .run(kind, JSON.stringify(detail), '{"preserve":"private metadata"}');
  if (status) db.prepare('INSERT INTO paper_uploads VALUES(101,?,1)').run(status);
  let importHandler;
  const load = name => require(path.resolve(__dirname, 'src', name));
  const context = {
    db, Buffer, require(name) {
      if (name === './capture-images') return { storeImages: async cards => ({ questions: cards.map(c => ({ ...c, _image_errors: [] })) }) };
      return load(name);
    },
    int: (v, d = 0) => parseInt(v, 10) || d,
    parseObj: s => JSON.parse(s || '{}'), jstr: JSON.stringify,
    now: () => '2026-11-07 12:00:00', bankFolder: () => 'bank', store: {},
    TYPES: ['single', 'multi', 'judge', 'fill', 'sort', 'answer'], TYPE_MAP: {}, SITES: { jyeoo: 'synthetic source' },
    QSubtype: load('../public/js/question-subtypes'), MatchQ: load('./match-question'),
    AiAnswerReview: load('./ai-answer-review'), ...load('./difficulty'), ...load('./choice-options'),
    upBig: { single: () => () => {} },
    intakeReceipts: { middleware: () => () => {}, commit: (req, fn) => fn() },
    admin: { post: (route, ...handlers) => { assert.equal(route, '/import-pack'); importHandler = handlers.at(-1); } },
    ok: (res, data) => { res.body = { code: 0, data }; }, fail: (res, msg) => { res.body = { code: 1, msg }; },
  };
  vm.runInNewContext([
    section('function audioKeyOf(', '/** 新增/编辑'),
    section('function commitCaptureItems(', "admin.post('/capture/batches/:id/commit'"),
    section('const MF_TYPE_MAP =', '// ==================================================================== 存储与配置'),
  ].join('\n'), context);
  const original = () => ({ ...db.prepare('SELECT * FROM questions WHERE id=1').get() });
  return {
    db, original,
    capture() {
      return context.commitCaptureItems({ id: 7, site: 'jyeoo', subject: '数学', stage: 'primary' }, [{
        site: 'jyeoo', questionId: 'source-1', type: 'answer', stem: 'new incoming content',
        answer: 'new answer', analysis: 'new analysis', meta: { knowledgePoints: ['new point'] },
      }], { tags: ['new tag'] });
    },
    async importPack() {
      const res = {};
      await importHandler({ user: { id: 10, role: 'branch' }, body: { pack: {
        format: 'mofang-question-pack', schemaVersion: 1, packageId: 'synthetic-pack',
        assets: [{ id: 'image-1', _url: '/api/file?key=bank/img/synthetic.png' }],
        questions: [{ recordKey: 'record-1', content: { stem: 'new incoming content', answer: 'new answer', figures: [{ assetId: 'image-1' }] }, metadata: {} }],
      } } }, res);
      assert.equal(res.body.code, 0, res.body.msg);
      assert.equal(res.body.data.failed, 0, JSON.stringify(res.body.data.errors));
      return res.body.data;
    },
  };
}
for (const status of ['pending', 'reviewed']) {
  test('capture creates independent reviewed question instead of modifying ' + status + ' scan', t => {
    const f = fixture(t, status, 'capture'), before = f.original();
    const result = f.capture();
    assert.deepEqual(f.original(), before);
    assert.equal(result.created, 1); assert.equal(result.updated, 0);
    assert.notEqual(Number(result.ids[0]), 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM question_tags WHERE question_id=1').get().n, 0);
    assert.equal(f.db.prepare('SELECT stem FROM questions WHERE id=?').get(result.ids[0]).stem, 'new incoming content');
  });
  test('import-pack stages independent card instead of adding image to ' + status + ' scan', async t => {
    const f = fixture(t, status, 'skill'), before = f.original();
    const result = await f.importPack();
    assert.deepEqual(f.original(), before);
    assert.equal(result.updated, 0); assert.equal(result.staged, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM questions').get().n, 1);
    const cards = JSON.parse(f.db.prepare('SELECT drafts FROM mf_recog_runs WHERE id=?').get(result.run_id).drafts);
    assert.equal(cards.length, 1); assert.equal(cards[0].stem, 'new incoming content');
    assert.ok(!JSON.stringify(cards).includes('private old content'));
  });
}
for (const status of ['approved', null]) {
  test('capture preserves shared duplicate enrichment: ' + status, t => {
    const f = fixture(t, status, 'capture'), result = f.capture();
    assert.equal(result.created, 0); assert.equal(result.updated, 1);
    assert.deepEqual(Array.from(result.ids), [1]);
    assert.equal(f.original().answer, 'new answer');
  });
  test('import-pack preserves shared duplicate image enrichment: ' + status, async t => {
    const f = fixture(t, status, 'skill'), result = await f.importPack();
    assert.equal(result.staged, 0); assert.equal(result.updated, 1);
    assert.deepEqual(JSON.parse(f.original().images), ['/api/file?key=bank/img/synthetic.png']);
  });
}
for (const kind of ['capture', 'skill']) {
  test(kind + ' skips private duplicate but still finds a shared same-source duplicate', async t => {
    const f = fixture(t, 'pending', kind), before = f.original();
    f.db.prepare("INSERT INTO questions(id,stem,answer,analysis,point,images,source_type,source_detail) VALUES(2,'shared old content','','','','[]',?,?)")
      .run(kind, before.source_detail);
    const result = kind === 'capture' ? f.capture() : await f.importPack();
    assert.deepEqual(f.original(), before);
    assert.equal(result.updated, 1);
    if (kind === 'capture') assert.deepEqual(Array.from(result.ids), [2]);
    else assert.equal(result.staged, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM questions').get().n, 2);
  });
  test(kind + ' ownerless private duplicate is not reused', async t => {
    const f = fixture(t, 'reviewed', kind), before = f.original();
    f.db.exec('DELETE FROM users');
    const result = kind === 'capture' ? f.capture() : await f.importPack();
    assert.deepEqual(f.original(), before);
    assert.equal(kind === 'capture' ? result.created : result.staged, 1);
    assert.equal(result.updated, 0);
  });
}
test('import-pack private criterion remains upload association even when source_type is local', async t => {
  const f = fixture(t, 'pending', 'skill');
  f.db.exec("UPDATE questions SET source_type='local' WHERE id=1");
  const before = f.original(), result = await f.importPack();
  assert.deepEqual(f.original(), before);
  assert.equal(result.staged, 1); assert.equal(result.updated, 0);
});
