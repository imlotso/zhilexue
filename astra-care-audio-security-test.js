'use strict';
// Synthetic files and an in-memory database only; never bootstrap src/app.js or src/db.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
let open;
try { const D = require('better-sqlite3'); const p = new D(':memory:'); p.close(); open = () => new D(':memory:'); }
catch (_) { const { DatabaseSync } = require('node:sqlite'); open = () => new DatabaseSync(':memory:'); }
const audio = require('./src/care-audio');
const wav = Buffer.alloc(44); wav.write('RIFF'); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'care-audio-test-'));
  const raw = open(); raw.exec(audio.SCHEMA);
  raw.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status INTEGER,expire_at TEXT,username TEXT,name TEXT); INSERT INTO users VALUES (1,'admin',1,NULL,'admin','A'),(10,'branch',1,'2099-12-31','branch-a','B'),(20,'branch',1,'2099-12-31','branch-b','C'),(30,'student',1,'2099-12-31','student','D');");
  const box = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src/auth.js'), 'utf8'), {
    module: box, process: { env: { JWT_SECRET: 'synthetic-test-secret-never-production' } }, Buffer, Date,
    require(n) { return n === './db' ? { db: raw, DATA_DIR: root } : require(n); }
  });
  const auth = box.exports;
  const dataDir = path.join(root, 'data'), publicDir = path.join(root, 'public');
  fs.mkdirSync(path.join(publicDir, 'uploads/audio'), { recursive: true });
  const legacyName = 'au_synthetic_legacy.wav';
  fs.writeFileSync(path.join(publicDir, 'uploads/audio', legacyName), wav);
  fs.writeFileSync(path.join(publicDir, 'ordinary.txt'), 'ordinary public content');
  const service = audio.createCareAudio({ db: raw, dataDir, publicDir, auth: auth.auth });
  const app = express(); app.use(service.legacyBoundary);
  const admin = express.Router(); admin.use(auth.auth());
  admin.post('/upload-audio', service.requireHeader, service.uploadMiddleware, service.upload);
  admin.get('/care-audio/:id', service.requireHeader, service.read);
  app.use('/api/admin', admin);
  app.get('/api/file', auth.auth(), (req, res, next) => service.protectFile(path.join(dataDir, 'uploads', req.query.key || ''), res) ? undefined : next(), (req,res) => res.send('not protected'));
  app.use('/admin', service.protectStatic(path.join(publicDir, 'admin')), express.static(path.join(publicDir, 'admin')));
  app.use(service.protectStatic(publicDir), express.static(publicDir));
  app.use((err, req, res, next) => { res.status(500).json({ code: 500, msg: 'test server error' }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); raw.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const token = id => auth.sign({ id, role: id === 1 ? 'admin' : id === 30 ? 'student' : 'branch' });
  async function req(url, id, options = {}) { return fetch(origin + url, { ...options, headers: { ...(id ? { Authorization: 'Bearer ' + token(id) } : {}), ...options.headers } }); }
  async function upload(id = 10, name = 'synthetic.wav', bytes = wav, fields = {}) { const form = new FormData(); form.append('file', new Blob([bytes]), name); for (const [k,v] of Object.entries(fields)) form.append(k,v); const r = await req('/api/admin/upload-audio', id, { method: 'POST', body: form }); return { r, body: await r.json() }; }
  function rawReq(url, id, method = 'GET') { return new Promise((resolve, reject) => { const r = http.request(origin + '/', { path: url, method, headers: id ? { Authorization: 'Bearer ' + token(id) } : {} }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); }); r.on('error', reject); r.end(); }); }
  return { root, dataDir, publicDir, raw, service, req, rawReq, upload, token, legacyName };
}
test('new upload is private, recorded server-side, owner readable and cross-account/student/anonymous denied', async t => {
  const f = await fixture(t), u = await f.upload(10, 'synthetic.wav', wav, { owner_id: '20', branch_id: '20' });
  assert.equal(u.body.code, 0); assert.match(u.body.data.url, /^\/api\/admin\/care-audio\/[a-f0-9]{32}$/);
  const row = f.raw.prepare('SELECT * FROM care_audio').get(); assert.equal(row.owner_id, 10); assert.equal(row.branch_id, 10);
  assert.equal(fs.existsSync(path.join(f.publicDir, 'uploads/audio', row.storage_name)), false);
  assert.deepEqual(fs.readFileSync(path.join(f.dataDir, 'private-care-audio', row.storage_name)), wav);
  const own = await f.req(u.body.data.url, 10); assert.equal(own.status, 200); assert.equal(own.headers.get('content-type'), 'audio/wav'); assert.equal(own.headers.get('cache-control'), 'private, no-store'); assert.equal(own.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await own.arrayBuffer()), wav);
  for (const id of [undefined, 20, 1, 30]) { const r = await f.req(u.body.data.url, id); assert.ok([401,403,404].includes(r.status)); assert.notDeepEqual(Buffer.from(await r.arrayBuffer()), wav); }
  assert.equal((await f.req(u.body.data.url + '?token=' + f.token(10))).status, 401);
});
test('owner read is revoked for disabled, expired, deleted, or role-changed accounts', async t => {
  const f = await fixture(t), u = await f.upload();
  f.raw.exec('UPDATE users SET status=0 WHERE id=10'); assert.equal((await f.req(u.body.data.url,10)).status,403);
  f.raw.exec("UPDATE users SET status=1,expire_at='2000-01-01' WHERE id=10"); assert.equal((await f.req(u.body.data.url,10)).status,403);
  f.raw.exec("UPDATE users SET expire_at='2099-12-31',role='student' WHERE id=10"); assert.equal((await f.req(u.body.data.url,10)).status,401);
  f.raw.exec('DELETE FROM users WHERE id=10'); assert.equal((await f.req(u.body.data.url,10)).status,401);
});
test('HEAD and byte Range require the same authorization and safe response headers', async t => {
  const f = await fixture(t), u = await f.upload();
  const partial = await f.req(u.body.data.url,10,{headers:{Range:'bytes=0-3'}}); assert.equal(partial.status,206); assert.equal(await partial.text(),'RIFF'); assert.equal(partial.headers.get('content-range'),'bytes 0-3/44');
  const head = await f.req(u.body.data.url,10,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),''); assert.equal(head.headers.get('content-length'),'44');
  for(const range of ['bytes=44-','bytes=0-1,4-5','bytes=4-2','nonsense']) assert.equal((await f.req(u.body.data.url,10,{headers:{Range:range}})).status,416);
  for(const method of ['GET','HEAD']) assert.notEqual((await f.req(u.body.data.url,20,{method,headers:{Range:'bytes=0-3'}})).status,206);
});
test('historical unmapped links are blocked before static serving without reading or deleting bytes', async t => {
  const f = await fixture(t);
  for(const url of ['/uploads/audio/'+f.legacyName, '/uploads/%61udio/'+f.legacyName, '/%75ploads/audio/'+f.legacyName, '//uploads//audio/'+f.legacyName, '/uploads/x/../audio/'+f.legacyName, '/uploads%2faudio%2f'+f.legacyName, '/uploads/%2561udio/'+f.legacyName, '/UPLOADS/AUDIO/'+f.legacyName, '/admin/../uploads/audio/'+f.legacyName, '/uploads\\audio\\'+f.legacyName]) {
    assert.ok([400,401,403,404].includes((await f.rawReq(url)).status),url);
    const auth = await f.rawReq(url,10); assert.ok([400,404,409].includes(auth.status),url); assert.ok(!auth.body.includes('RIFF'));
  }
  const pending = await f.req('/uploads/audio/'+f.legacyName,10); assert.equal(pending.status,409); assert.match((await pending.json()).msg,/归属待核对/);
  assert.deepEqual(fs.readFileSync(path.join(f.publicDir,'uploads/audio',f.legacyName)),wav);
  assert.equal((await f.req('/ordinary.txt')).status,200);
});
test('reviewed migration verifies content and owner, copies without deletion, preserves legacy URL authorization', async t => {
  const f = await fixture(t), item = { legacy_name:f.legacyName, owner_id:10, branch_id:10, sha256:crypto.createHash('sha256').update(wav).digest('hex'), review_ref:'synthetic-approved-review' };
  assert.throws(()=> f.service.importReviewed({...item,sha256:'0'.repeat(64)}), /校验/);
  assert.throws(()=> f.service.importReviewed({...item,owner_id:30}), /账号/);
  assert.throws(()=> f.service.importReviewed({...item,branch_id:20}), /校区/);
  assert.throws(()=> f.service.importReviewed({...item,review_ref:''}), /审核/);
  const first=f.service.importReviewed(item), again=f.service.importReviewed(item); assert.equal(first.id,again.id);
  assert.deepEqual(fs.readFileSync(path.join(f.publicDir,'uploads/audio',f.legacyName)),wav);
  assert.deepEqual(Buffer.from(await (await f.req('/uploads/audio/'+f.legacyName,10)).arrayBuffer()),wav);
  for(const id of [undefined,20,1,30]) assert.notEqual((await f.req('/uploads/audio/'+f.legacyName,id)).status,200);
  assert.throws(()=>f.service.importReviewed({...item,owner_id:20,branch_id:20}),/已存在/);
});
test('symlink aliases under either public mount and general file API cannot bypass private audio authorization', async t => {
  const f=await fixture(t),u=await f.upload(); const row=f.raw.prepare('SELECT * FROM care_audio').get();
  fs.symlinkSync(path.join(f.publicDir,'uploads/audio'),path.join(f.publicDir,'legacy-alias'));
  fs.mkdirSync(path.join(f.publicDir,'admin'),{recursive:true}); fs.symlinkSync(path.join(f.dataDir,'private-care-audio'),path.join(f.publicDir,'admin/private-alias'));
  fs.mkdirSync(path.join(f.dataDir,'uploads'),{recursive:true}); fs.symlinkSync(path.join(f.dataDir,'private-care-audio'),path.join(f.dataDir,'uploads/private-alias'));
  for(const url of ['/legacy-alias/'+f.legacyName,'/admin/private-alias/'+row.storage_name,'/api/file?key=private-alias/'+row.storage_name]) { const r=await f.req(url,20); assert.equal(r.status,404,url); }
  fs.unlinkSync(path.join(f.dataDir,'private-care-audio',row.storage_name)); fs.symlinkSync(path.join(f.publicDir,'ordinary.txt'),path.join(f.dataDir,'private-care-audio',row.storage_name)); assert.equal((await f.req(u.body.data.url,10)).status,404);
});
test('unsupported/spoofed media, empty uploads and student upload are rejected', async t => {
  const f=await fixture(t);
  for(const [name,bytes] of [['evil.html',wav],['evil.wav',Buffer.from('<html>not audio</html>')],['empty.wav',Buffer.alloc(0)]]) assert.notEqual((await f.upload(10,name,bytes)).body.code,0);
  assert.equal((await f.upload(30)).r.status,403); assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM care_audio').get().n,0);
});
test('application mounts audio boundary before all routers/static and adds an idempotent schema', () => {
  const source=fs.readFileSync(path.join(__dirname,'src/app.js'),'utf8'); const db=fs.readFileSync(path.join(__dirname,'src/db.js'),'utf8');
  assert.ok(source.indexOf('app.use(careAudio.legacyBoundary)') < source.indexOf("app.get('/api/file'"));
  assert.match(source,/careAudio\.protectStatic\(PUBLIC\)/); assert.match(source,/careAudio\.protectStatic\(path\.join\(PUBLIC, 'admin'\)\)/); assert.match(source,/careAudio\.protectFile\(store\.localPath\(key\), res\)/); assert.match(db,/runSchema\(require\('\.\/care-audio'\)\.SCHEMA\)/);
});
test('idempotent migration never silently reports success for a missing or corrupt private copy',async t=>{
  const f=await fixture(t),item={legacy_name:f.legacyName,owner_id:10,branch_id:10,sha256:crypto.createHash('sha256').update(wav).digest('hex'),review_ref:'approved-synthetic'};
  const row=f.service.importReviewed(item);fs.writeFileSync(path.join(f.dataDir,'private-care-audio',row.storage_name),'corrupted');assert.throws(()=>f.service.importReviewed(item),/私有副本/);
});
test('upload preserves a Chinese display filename without using it as a storage key',async t=>{
  const f=await fixture(t),u=await f.upload(10,'合成测试.wav');assert.equal(u.body.data.name,'合成测试.wav');assert.match(f.raw.prepare('SELECT storage_name FROM care_audio').get().storage_name,/^[a-f0-9]{32}\.wav$/);
});
test('raw absolute/authority/non-origin request targets cannot bypass legacy or either private static alias', async t => {
  const f = await fixture(t), uploaded = await f.upload();
  assert.equal(uploaded.body.code, 0);
  const row = f.raw.prepare('SELECT storage_name FROM care_audio').get();
  fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(f.publicDir, 'private-alias'));
  fs.mkdirSync(path.join(f.publicDir, 'admin'), { recursive: true });
  fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(f.publicDir, 'admin/private-alias'));
  const targets = [
    'http://school.example/uploads/audio/' + f.legacyName,
    'http://school.example/%75ploads/audio/' + f.legacyName,
    'https://school.example/uploads/audio/' + f.legacyName,
    'HTTP://school.example/uploads/audio/' + f.legacyName,
    'http://school.example/private-alias/' + row.storage_name,
    'https://school.example/admin/private-alias/' + row.storage_name,
    'http://school.example/%70rivate-alias/' + row.storage_name,
    'http://school.example/admin/%70rivate-alias/' + row.storage_name,
    'school.example:443', '*', 'uploads/audio/' + f.legacyName,
    'http:/school.example/uploads/audio/' + f.legacyName,
    'http:////school.example/uploads/audio/' + f.legacyName,
    'http:\\school.example\\uploads\\audio\\' + f.legacyName,
    'https://school.example/uploads/audio/' + f.legacyName + '?ignored=1',
  ];
  for (const target of targets) for (const id of [undefined, 10]) {
    const result = await f.rawReq(target, id);
    assert.equal(result.status, 400, target + ' must fail closed before auth/static');
    assert.ok(!result.body.includes('RIFF'), target);
  }
  // A leading // is still origin-form to Node/Express, not an absolute URL.
  // Its normalized protected path must be denied, and a host-like first segment must never leak.
  for (const target of ['//uploads/audio/' + f.legacyName, '//school.example/uploads/audio/' + f.legacyName]) {
    const result = await f.rawReq(target);
    assert.ok([400,401,403,404].includes(result.status), target);
    assert.ok(!result.body.includes('RIFF'), target);
  }
});
test('raw fragments cannot change the file chosen by static serving', async t => {
  const f = await fixture(t); await f.upload();
  const name = f.raw.prepare('SELECT storage_name FROM care_audio').get().storage_name;
  fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(f.publicDir, 'private-alias'));
  fs.mkdirSync(path.join(f.publicDir, 'admin'), { recursive: true });
  fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(f.publicDir, 'admin/private-alias'));
  for (const target of ['/private-alias/' + name + '#ignored', '/admin/private-alias/' + name + '#ignored', '/uploads/audio/' + f.legacyName + '#ignored']) {
    const result = await f.rawReq(target); assert.equal(result.status, 400, target); assert.ok(!result.body.includes('RIFF'));
  }
});
test('percent-bearing and backslash-bearing static aliases fail closed instead of decoding into a different path', async t => {
  const f = await fixture(t); await f.upload();
  const name = f.raw.prepare('SELECT storage_name FROM care_audio').get().storage_name;
  fs.mkdirSync(path.join(f.publicDir, 'admin'), { recursive: true });
  for (const root of [f.publicDir, path.join(f.publicDir, 'admin')]) {
    fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(root, '%61lias'));
    fs.symlinkSync(path.join(f.dataDir, 'private-care-audio'), path.join(root, 'private\\alias'));
  }
  for (const prefix of ['', '/admin']) for (const target of [prefix + '/%2561lias/' + name, prefix + '/private\\alias/' + name, prefix + '/private%5Calias/' + name]) {
    const result = await f.rawReq(target); assert.equal(result.status, 400, target); assert.ok(!result.body.includes('RIFF'));
  }
});
test('implicit index.html symlinks in either static mount cannot serve private audio', async t => {
  const f = await fixture(t); await f.upload();
  const name = f.raw.prepare('SELECT storage_name FROM care_audio').get().storage_name;
  for (const relative of ['aliasdir', 'admin/aliasdir']) {
    fs.mkdirSync(path.join(f.publicDir, relative), { recursive: true });
    fs.symlinkSync(path.join(f.dataDir, 'private-care-audio', name), path.join(f.publicDir, relative, 'index.html'));
    for (const suffix of ['/', '', '/index.html', '/?view=1']) {
      const result = await f.rawReq('/' + relative + suffix); assert.equal(result.status, 404, relative + suffix); assert.ok(!result.body.includes('RIFF'));
    }
  }
});
test('normal Unicode documents and ordinary directory index remain accessible', async t => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.publicDir, '普通文档'), { recursive: true });
  fs.writeFileSync(path.join(f.publicDir, '普通文档', '说明.txt'), 'synthetic public document');
  fs.writeFileSync(path.join(f.publicDir, '普通文档', 'index.html'), '<p>synthetic public index</p>');
  const document = await f.req('/' + encodeURIComponent('普通文档') + '/' + encodeURIComponent('说明.txt') + '?v=1');
  assert.equal(document.status, 200); assert.equal(await document.text(), 'synthetic public document');
  const index = await f.req('/' + encodeURIComponent('普通文档') + '/');
  assert.equal(index.status, 200); assert.equal(await index.text(), '<p>synthetic public index</p>');
});

// Regression: frontend permits <=50 MiB; busboy emits its limit event at the
// parser's exact threshold, so the parser needs one sentinel byte of headroom.
test('exactly 50 MiB audio is accepted while one byte over remains rejected', async t => {
  const f = await fixture(t), max = 50 * 1024 * 1024;
  const bytes = Buffer.alloc(max); wav.copy(bytes); bytes.writeUInt32LE(max - 8, 4); bytes.writeUInt32LE(max - 44, 40);
  const exact = await f.upload(10, 'synthetic-boundary.wav', bytes);
  assert.equal(exact.body.code, 0, 'exactly 50 MiB matches the UI contract');
  const row = f.raw.prepare('SELECT * FROM care_audio').get(); assert.equal(row.size, max);
  const head = await f.req(exact.body.data.url, 10, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), max);
  const over = Buffer.alloc(max + 1); bytes.copy(over); over.writeUInt32LE(max - 7, 4); over.writeUInt32LE(max - 43, 40);
  assert.notEqual((await f.upload(10, 'synthetic-over-boundary.wav', over)).body.code, 0);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM care_audio').get().n, 1, 'oversized upload never writes metadata');
});
