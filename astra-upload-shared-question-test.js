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
  const db = { prepare: sql => raw.prepare(sql.replace(/ FOR UPDATE\b/g, '')), transaction: fn => (...args) => {
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
  const ok = (res, data, msg) => { res.body = { code: 0, data, msg }; };
  const fail = (res, msg, code = 1) => { res.body = { code, msg }; };
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
function mixed(f) { f.raw.exec('UPDATE paper_uploads SET question_id=13 WHERE id=4'); }
const mutations = [
 ['review', 'POST /uploads/:id/review', {params:{id:3},body:{status:'reviewed',point:'changed'}}],
 ['reject', 'POST /uploads/:id/review', {params:{id:3},body:{status:'rejected'}}],
 ['delete', 'DELETE /uploads/:id', {params:{id:3}}],
 ['import-all','POST /uploads/import-all',{}],
 ['edit','PUT /ext/pending/item',{body:{id:'up:3',patch:{stem:'changed'}}}],
 ...['commit','delete','ai-answer','ai-classify'].map(action=>[action,'POST /ext/pending/'+action,{body:{ids:['up:1','up:3']}}]),
 ...['discard','confirm'].map(action=>[action,'POST /ext/pending/ai-answer/'+action,{body:{id:'up:3',token:'synthetic',expected:'synthetic',fields:['analysis']}}])
];
for(const [name,route,opts] of mutations) test('shared foreign question rejects '+name+' before any writes',async t=>{
 const f=fixture(t); mixed(f); const before=f.snapshot(); denied(await f.call(route,branch,opts)); assert.equal(f.snapshot(),before); assert.equal(f.aiCalls(),0);
});
test('import-all checks every question before approving an earlier allowed upload',async t=>{
 const f=fixture(t);mixed(f);f.raw.exec("UPDATE paper_uploads SET question_id=16 WHERE id=1; UPDATE paper_uploads SET user_id=101 WHERE id=6");const before=f.snapshot();denied(await f.call('POST /uploads/import-all'));assert.equal(f.snapshot(),before);
});
for(const action of ['review','reject','delete'])test('qid zero remains manageable: '+action,async t=>{
 const f=fixture(t);const r=await f.call(action==='delete'?'DELETE /uploads/:id':'POST /uploads/:id/review',branch,{params:{id:1},body:{status:action==='reject'?'rejected':'reviewed'}});assert.equal(r.body.code,0,r.body.msg);
});
test('qid zero retains unified edit and commit',async t=>{const f=fixture(t);assert.equal((await f.call('PUT /ext/pending/item',branch,{body:{id:'up:1',patch:{stem:'updated'}}})).body.code,0);assert.equal((await f.call('POST /ext/pending/commit',branch,{body:{ids:['up:1']}})).body.code,0);});
test('principal retains shared question edit and branch retains own-only question edit',async t=>{const f=fixture(t);assert.equal((await f.call('PUT /ext/pending/item',branch,{body:{id:'up:3',patch:{stem:'own'}}})).body.code,0);mixed(f);for(const route of ['PUT /ext/pending/item','POST /uploads/:id/review'])assert.equal((await f.call(route,principal,{params:{id:3},body:{id:'up:3',patch:{stem:'principal'},status:'reviewed'}})).body.code,0);});
test('AI completion rechecks new cross-campus question linkage',async t=>{const f=fixture(t);let after;f.setAiHook(()=>{mixed(f);after=f.snapshot();});const r=await f.call('POST /ext/pending/ai-answer',branch,{body:{ids:['up:3']}});assert.equal(f.aiCalls(),1);assert.equal(r.body.data.suggested,0);assert.equal(f.snapshot(),after);});

test('scan readers hide cross-campus linked content while retaining qid-zero drafts and admin access',async t=>{
 const f=fixture(t);mixed(f);f.raw.exec("UPDATE questions SET stem='foreign-secret-stem',images='[\"foreign-secret-image\"]' WHERE id=13");
 for(const route of ['GET /ext/pending','GET /ext/pending/batches']){
  const r=await f.call(route,branch,{query:{source:'scan'}});assert.equal(r.body.code,0);// Batch summaries contain only the caller's upload metadata, not question content.
  assert.equal(r.body.data.list.length,route==='GET /ext/pending'?1:2);assert.equal(JSON.stringify(r.body).includes('foreign-secret'),false);
 }
 const list=await f.call('GET /ext/pending',branch,{query:{source:'scan'}});assert.equal(list.body.data.list[0].id,'up:1');assert.equal(list.body.data.counts.scan,1);assert.equal(f.pendingApi.counts({user:branch}).scan,1);
 const admin=await f.call('GET /ext/pending',principal,{query:{source:'scan'}});assert.ok(admin.body.data.list.some(x=>x.id==='up:3'&&x.stem==='foreign-secret-stem'));
 const legacy=await f.call('GET /uploads');assert.deepEqual(Array.from(legacy.body.data.list,x=>x.id).sort(),[1,3]);assert.equal(JSON.stringify(legacy.body).includes('foreign-secret'),false);
});
test('legacy review reader filters shared foreign questions before totals and pagination',async t=>{const f=fixture(t);mixed(f);const r=await f.call('GET /ext/review-list');assert.equal(r.body.data.total,0);assert.equal(r.body.data.list.length,0);const admin=await f.call('GET /ext/review-list',principal);assert.ok(admin.body.data.list.some(x=>x.up_id===3));});
test('feedback reader hides shared foreign content and counts but retains approved and admin access',async t=>{
 const f=fixture(t);mixed(f);let r=await f.call('GET /feedback');assert.equal(r.body.data.total,0);assert.equal(r.body.data.list.length,0);assert.equal(r.body.data.stat.pending,0);
 r=await f.call('GET /feedback',principal);assert.equal(r.body.data.total,2);assert.equal(r.body.data.stat.pending,2);
 f.raw.exec("UPDATE paper_uploads SET status='approved' WHERE question_id=13");r=await f.call('GET /feedback');assert.equal(r.body.data.total,1);assert.equal(r.body.data.list[0].id,1);assert.equal(r.body.data.stat.pending,1);
});
