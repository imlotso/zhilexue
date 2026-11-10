'use strict';
// Full pending module + actual legacy bank handlers + fresh synthetic SQLite.
// Router/multipart/AI boundaries are controlled; no HTTP server, OCR, production
// DB, real students, credentials, or network are used by this regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const AI = require('./src/ai-answer-review');
const source = name => fs.readFileSync(path.join(__dirname, 'src', name), 'utf8');
function part(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'production boundary: ' + start);
  return text.slice(a, b + end.length);
}
const branch = { id: 10, role: 'branch' }, principal = { id: 1, role: 'admin' };
function fixture(t) {
  const raw = openMemory(); t.after(() => raw.close());
  raw.exec(`
    CREATE TABLE papers(id INTEGER PRIMARY KEY, q_ids TEXT);
    CREATE TABLE mf_papers(id INTEGER PRIMARY KEY, published INTEGER);
    CREATE TABLE mf_paper_questions(paper_id INTEGER, question_id INTEGER, kind TEXT);
    CREATE TABLE mf_paper_tries(paper_id INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, status INTEGER, created_by INTEGER, name TEXT, username TEXT, grade TEXT, stage TEXT);
    INSERT INTO users VALUES (1,'admin',1,NULL,'校长','principal','',''),(10,'branch',1,1,'A分校','a','',''),(20,'branch',1,1,'B分校','b','',''),
      (101,'student',1,10,'A学生','student-a','四年级','primary'),(201,'student',1,20,'B学生','student-b','四年级','primary'),(301,'student',1,1,'总校学生','main-student','四年级','primary');
    CREATE TABLE questions(id INTEGER PRIMARY KEY, chapter_id INTEGER, subject TEXT, grade TEXT, type TEXT, stem TEXT, options TEXT, answer TEXT, analysis TEXT, difficulty INTEGER, sort INTEGER, stage TEXT, point TEXT, material TEXT, source TEXT, year TEXT, video_id INTEGER, images TEXT, created_at TEXT, difficulty_score_10 INTEGER, audio_key TEXT, audio_play_limit INTEGER, question_subtype TEXT, match_prompts TEXT, ai_review_metadata TEXT);
    CREATE TABLE paper_uploads(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, question_id INTEGER, subject TEXT, stage TEXT, grade TEXT, point TEXT, images TEXT, draft_json TEXT, created_at TEXT, stem_text TEXT, note TEXT, answer TEXT, review_note TEXT, reviewed_by INTEGER, reviewed_at TEXT);
    CREATE TABLE mistakes(id INTEGER PRIMARY KEY, user_id INTEGER, question_id INTEGER, wrong_count INTEGER, last_answer TEXT, resolved INTEGER, updated_at TEXT, review_stage INTEGER, next_review TEXT);
    CREATE TABLE records(id INTEGER PRIMARY KEY, user_id INTEGER, question_id INTEGER);
    CREATE TABLE question_nodes(question_id INTEGER, node_id INTEGER, UNIQUE(question_id,node_id));
    CREATE TABLE question_tags(question_id INTEGER, tag TEXT, UNIQUE(question_id,tag));
    CREATE TABLE bank_trees(id INTEGER PRIMARY KEY, name TEXT, kind TEXT, subject TEXT, stage TEXT, edition TEXT, sort INTEGER);
    CREATE TABLE bank_tree_nodes(id INTEGER PRIMARY KEY, tree_id INTEGER, name TEXT, parent_id INTEGER, sort INTEGER);
    CREATE TABLE mf_recog_runs(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,source_kind TEXT,status TEXT,error TEXT,drafts TEXT,pages TEXT,created_at TEXT);
    CREATE TABLE mf_capture_batches(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,status TEXT,payload TEXT,created_at TEXT);
    CREATE TABLE bank_feedback(id INTEGER PRIMARY KEY,user_id INTEGER,question_id INTEGER,reason TEXT,note TEXT,my_answer TEXT,status TEXT,admin_note TEXT,created_at TEXT);
  `);
  const draft = JSON.stringify({ type: 'answer', stem: '合成题干', answer: '合成答案', analysis: '', options: [] });
  for (const [id, uid, status, qid] of [[1, 101, 'pending', 0], [2, 201, 'pending', 0], [3, 101, 'reviewed', 13], [4, 201, 'reviewed', 14], [5, 999, 'pending', 15], [6, 301, 'pending', 16]]) {
    raw.prepare("INSERT INTO paper_uploads VALUES(?,?,?,?, '数学','primary','四年级','知识点','[]',?,'2026-11-07','合成题干','合成备注','合成答案','',NULL,NULL)").run(id, uid, status, qid, draft);
    if (qid) {
      raw.prepare("INSERT INTO questions(id,subject,stage,grade,type,stem,options,answer,analysis,difficulty,images,material,point) VALUES(?,'数学','primary','四年级','answer','合成题干','[]','合成答案','',3,'[]','','知识点')").run(qid);
      raw.prepare('INSERT INTO mistakes(user_id,question_id) VALUES(?,?)').run(uid, qid);
      raw.prepare('INSERT INTO records(user_id,question_id) VALUES(?,?)').run(uid, qid);
    }
  }
  raw.exec("INSERT INTO bank_feedback VALUES(1,101,13,'题目有误','A反馈','A','pending','','2026-11-07'),(2,201,14,'题目有误','B反馈','B','pending','','2026-11-07')");
  // Only SQLite's missing row-lock syntax is adapted; production SQL and writes
  // execute directly, and transaction rollback uses the in-memory engine.
  const db = { exec: sql => raw.exec(sql), prepare: sql => raw.prepare(sql.replace(/ FOR UPDATE\b/g, '')), transaction: fn => (...args) => {
    raw.exec('BEGIN'); try { const r = fn(...args); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
  } };
  const handlers = new Map();
  const admin = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (url, ...fns) => handlers.set(method.toUpperCase() + ' ' + url, fns)]));
  let aiCalls = 0, aiHook = null;
  const fakeMulter = () => ({ single: () => (req, res, next) => next() }); fakeMulter.memoryStorage = () => ({});
  const module = { exports: {} };
  const context = { module, exports: module.exports, Buffer, process: { env: {} },
    require(name) {
      if (name === 'multer') return fakeMulter;
      if (name === './mfcollect') return { mfAiInvoke: async () => { aiCalls++; if (aiHook) await aiHook(); return { text: '{"items":[{"i":0,"analysis":"合成解析","node_ids":[]}]}' }; } };
      if (name.startsWith('./') || name.startsWith('../')) return require(path.resolve(__dirname, 'src', name));
      if (name === 'crypto') return require('node:crypto');
      throw new Error('Unapproved dependency: ' + name);
    } };
  vm.runInNewContext(source('mfpending.js'), context, { filename: 'src/mfpending.js' });
  const ok = (res, data, msg) => res.json({ code: 0, data, msg });
  const fail = (res, msg, code = 1) => res.json({ code, msg });
  const parseArr = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const parseObj = s => { try { return JSON.parse(s || '{}') || {}; } catch (_) { return {}; } };
  const pendingApi = module.exports({ admin, db, ok, fail, now: () => '2026-11-07 12:00:00', int: (v, def = 0) => parseInt(v, 10) || def, parseArr, parseObj, jstr: JSON.stringify,
    TYPE_MAP: {}, TYPES: ['single', 'multi', 'judge', 'fill', 'sort', 'answer'], store: { getUrlSync: () => 'synthetic-url' }, bankFolder: () => 'bank',
    commitRunCards: () => { throw new Error('unexpected run commit'); }, commitCaptureItems: () => { throw new Error('unexpected capture commit'); } });
  const bank = source('bank.js'), mfbank = source('mfbank.js');
  const env = { require: context.require, db, admin, ok, fail, now: () => '2026-11-07 12:00:00', parseQ: q => q, pendingApi };
  const bankPieces = [part(bank, 'const UP_STATUS =', '/** 把一条上传记录入库').replace('/** 把一条上传记录入库', ''), part(bank, 'function removeUploadQuestion(', '\n}'),
    ...['/uploads', '/feedback'].map(p => part(bank, "admin.get('" + p + "',", '\n});')),
    ...['/uploads/:id/review', '/uploads/import-all'].map(p => part(bank, "admin.post('" + p + "',", '\n});')),
    part(bank, "admin.delete('/uploads/:id',", '\n});'), part(bank, "admin.put('/feedback/:id',", '\n});')];
  vm.runInNewContext(bankPieces.join('\n'), env, { filename: 'src/bank.js affected handlers' });
  vm.runInNewContext(['/ext/badge-counts', '/ext/review-list'].map(p => part(mfbank, "admin.get('" + p + "',", '\n});')).join('\n'), env, { filename: 'src/mfbank.js affected handlers' });
  const snapshot = () => JSON.stringify(['paper_uploads', 'questions', 'mistakes', 'records', 'bank_feedback'].map(table => raw.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()));
  const call = async (route, user = branch, opts = {}) => {
    const req = { user, query: {}, params: {}, body: {}, ...opts };
    const res = { status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    const fns = handlers.get(route); assert.ok(fns, route);
    for (const fn of fns) { await fn(req, res, () => {}); if (res.body) break; }
    return res;
  };
  return { raw, call, snapshot, pendingApi, aiCalls: () => aiCalls, setAiHook: hook => { aiHook = hook; } };
}
function denied(r) { assert.equal(r.body.code, 403, r.body.msg || 'must reject with explicit permission error'); }
test('legacy upload list and counts use the same campus scope even with a forged campus filter', async t => {
  const f = fixture(t), r = await f.call('GET /uploads', branch, { query: { campus: 20 } });
  assert.deepEqual(Array.from(r.body.data.list, x => x.id).sort(), [1, 3]);
  assert.deepEqual({ ...r.body.data.counts }, { pending: 1, reviewed: 1, approved: 0, rejected: 0 });
});
for (const action of ['review', 'reject', 'delete']) test('branch cannot ' + action + ' another campus upload or its existing mistake', async t => {
  const f = fixture(t), before = f.snapshot();
  const r = await f.call(action === 'delete' ? 'DELETE /uploads/:id' : 'POST /uploads/:id/review', branch, { params: { id: 4 }, body: { status: action === 'reject' ? 'rejected' : 'reviewed', point: 'changed' } });
  denied(r); assert.equal(f.snapshot(), before);
});
test('legacy bulk approval only includes the caller campus', async t => {
  const f = fixture(t), r = await f.call('POST /uploads/import-all');
  assert.equal(r.body.code, 0); assert.equal(r.body.data.count, 1);
  assert.equal(f.raw.prepare('SELECT status FROM paper_uploads WHERE id=3').get().status, 'approved');
  assert.equal(f.raw.prepare('SELECT status FROM paper_uploads WHERE id=4').get().status, 'reviewed');
});
test('branch retains own upload edit and principal retains cross-campus review', async t => {
  const f = fixture(t);
  for (const [user, id] of [[branch, 3], [principal, 4]]) assert.equal((await f.call('POST /uploads/:id/review', user, { params: { id }, body: { status: 'reviewed', point: 'corrected' } })).body.code, 0);
  assert.equal(f.raw.prepare('SELECT point FROM paper_uploads WHERE id=4').get().point, 'corrected');
});
test('unified pending list, batches and badge counts exclude other-campus student scans', async t => {
  const f = fixture(t), r = await f.call('GET /ext/pending', branch, { query: { source: 'scan' } });
  assert.deepEqual(Array.from(r.body.data.list, x => x.id).sort(), ['up:1', 'up:3']); assert.equal(r.body.data.counts.scan, 2);
  const batches = await f.call('GET /ext/pending/batches', branch, { query: { source: 'scan' } });
  assert.deepEqual(Array.from(batches.body.data.list, x => x.id).sort(), [1, 3]);
  const badge = await f.call('GET /ext/badge-counts'); assert.equal(badge.body.data.review, 1); assert.equal(badge.body.data.pending_by.scan, 2);
  assert.equal(f.pendingApi.counts({ user: branch }).scan, 2);
});
test('legacy unified review-list also enforces student campus scope', async t => {
  const f = fixture(t), r = await f.call('GET /ext/review-list');
  assert.equal(r.body.data.total, 1); assert.deepEqual(Array.from(r.body.data.list, x => x.up_id), [3]);
});
for (const id of ['up:2', 'up:5', 'up:6']) test('unified editor rejects foreign, orphan, and main-campus upload ' + id, async t => {
  const f = fixture(t), before = f.snapshot(); const r = await f.call('PUT /ext/pending/item', branch, { body: { id, patch: { stem: 'changed' } } });
  denied(r); assert.equal(f.snapshot(), before);
});
for (const action of ['commit', 'delete']) test('mixed-campus unified ' + action + ' is rejected before any partial change', async t => {
  const f = fixture(t), before = f.snapshot(); const r = await f.call('POST /ext/pending/' + action, branch, { body: { ids: ['up:1', 'up:2'] } });
  denied(r); assert.equal(f.snapshot(), before);
});
test('own pending edit, commit and student mistake creation remain a working loop', async t => {
  const f = fixture(t);
  assert.equal((await f.call('PUT /ext/pending/item', branch, { body: { id: 'up:1', patch: { stem: '本校核对题干' } } })).body.code, 0);
  const r = await f.call('POST /ext/pending/commit', branch, { body: { ids: ['up:1'] } });
  assert.equal(r.body.code, 0, r.body.msg); assert.equal(r.body.data.committed, 1);
  const up = f.raw.prepare('SELECT * FROM paper_uploads WHERE id=1').get(); assert.equal(up.status, 'approved');
  assert.equal(f.raw.prepare('SELECT stem FROM questions WHERE id=?').get(up.question_id).stem, '本校核对题干');
  assert.equal(f.raw.prepare('SELECT user_id FROM mistakes WHERE question_id=?').get(up.question_id).user_id, 101);
  assert.equal(f.raw.prepare('SELECT status FROM paper_uploads WHERE id=2').get().status, 'pending');
});
test('principal can edit and commit another-campus student scan', async t => {
  const f = fixture(t);
  assert.equal((await f.call('PUT /ext/pending/item', principal, { body: { id: 'up:2', patch: { stem: '校长核对' } } })).body.code, 0);
  assert.equal((await f.call('POST /ext/pending/commit', principal, { body: { ids: ['up:2'] } })).body.code, 0);
});
for (const action of ['ai-answer', 'ai-classify']) test('foreign pending ' + action + ' cannot read student content or invoke AI', async t => {
  const f = fixture(t), before = f.snapshot(); const r = await f.call('POST /ext/pending/' + action, branch, { body: { ids: ['up:2'] } });
  denied(r); assert.equal(f.aiCalls(), 0); assert.equal(f.snapshot(), before);
});
for (const action of ['discard', 'confirm']) test('foreign pending AI suggestion ' + action + ' cannot mutate student content', async t => {
  const f = fixture(t);
  const item = (await f.call('GET /ext/pending', principal, { query: { source: 'scan' } })).body.data.list.find(x => x.id === 'up:2');
  const draft = JSON.parse(f.raw.prepare('SELECT draft_json FROM paper_uploads WHERE id=2').get().draft_json);
  draft.ai_answer_suggestion = { token: 'synthetic-review-token', basis: AI.signature(item), analysis: '合成建议' };
  f.raw.prepare('UPDATE paper_uploads SET draft_json=? WHERE id=2').run(JSON.stringify(draft));
  const current = (await f.call('GET /ext/pending', principal, { query: { source: 'scan' } })).body.data.list.find(x => x.id === 'up:2');
  const before = f.snapshot(); const r = await f.call('POST /ext/pending/ai-answer/' + action, branch, { body: { id: 'up:2', token: draft.ai_answer_suggestion.token, expected: AI.discardSignature(current), fields: ['analysis'] } });
  denied(r); assert.equal(f.snapshot(), before);
});
test('AI completion rechecks campus ownership after its asynchronous call', async t => {
  const f = fixture(t); let afterTransfer;
  f.setAiHook(() => { f.raw.exec('UPDATE users SET created_by=20 WHERE id=101'); afterTransfer = f.snapshot(); });
  const r = await f.call('POST /ext/pending/ai-answer', branch, { body: { ids: ['up:1'] } });
  assert.equal(f.aiCalls(), 1); assert.equal(r.body.data.suggested, 0); assert.equal(f.snapshot(), afterTransfer);
});
test('feedback list and counts do not disclose other-campus student answers or phone', async t => {
  const f = fixture(t), r = await f.call('GET /feedback');
  assert.deepEqual(Array.from(r.body.data.list, x => x.id), [1]); assert.equal(r.body.data.total, 1); assert.equal(r.body.data.stat.pending, 1);
});
test('feedback mutation refuses another campus and keeps own/principal edits', async t => {
  const f = fixture(t), before = f.snapshot(); denied(await f.call('PUT /feedback/:id', branch, { params: { id: 2 }, body: { status: 'done' } }));
  assert.equal(f.snapshot(), before);
  for (const [user, id] of [[branch, 1], [principal, 2]]) assert.equal((await f.call('PUT /feedback/:id', user, { params: { id }, body: { status: 'done' } })).body.code, 0);
});
