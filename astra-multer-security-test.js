'use strict';
// Loopback-only synthetic multipart fixtures. Never load src/app.js/src/db.js,
// contact remote services, or use real identities, storage or credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const multer = require('multer');
const source = name => fs.readFileSync(path.join(__dirname, 'src', name), 'utf8');
const files = ['app.js', 'bank.js', 'care-audio.js', 'mfbank.js', 'mfpending.js', 'phonics.js', 'report.js', 'word.js', 'wrong.js'];
function memoryConfigurations() {
  return files.flatMap(file => Array.from(source(file).matchAll(/multer\(\{ storage: multer\.memoryStorage\(\), limits: (\{[^\n]+?\}) \}\)/g), (m, index) => ({ file, index, limits: vm.runInNewContext('(' + m[1] + ')', { MAX_SIZE: 50 * 1024 * 1024, UP_IMG_MB: Number(source('bank.js').match(/const UP_IMG_MB = (\d+);/)[1]) }) })));
}
function diskUpload(dir) {
  const text = source('app.js'), start = text.indexOf('const videoUpload = multer({'), end = text.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(text.slice(start, end + 4) + '\nvideoUpload;', { multer, TMP_DIR: dir, Date, Math });
}
async function serverFixture(t, upload, kind, maxCount = 2) {
  const app = express(); let completed = 0, failed = 0;
  app.post('/', upload[kind](kind === 'single' ? 'file' : 'files', maxCount), (req, res) => {
    completed++;
    const list = kind === 'single' ? [req.file].filter(Boolean) : req.files;
    res.json({ files: list.map(f => ({ name: f.originalname, size: f.size, text: f.buffer ? f.buffer.toString() : fs.readFileSync(f.path, 'utf8') })), fields: req.body });
  });
  app.use((err, req, res, next) => { failed++; res.status(400).json({ code: err.code || 'MULTIPART_ERROR' }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return { origin: 'http://127.0.0.1:' + server.address().port, stats: () => ({ completed, failed }) };
}
function multipart(parts) {
  const boundary = 'zhilexue-synthetic-boundary';
  const body = Buffer.concat(parts.map(p => Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + p.name + '"' + (p.filename ? '; filename="' + p.filename + '"\r\nContent-Type: application/octet-stream' : '') + '\r\n\r\n' + p.value + '\r\n')).concat(Buffer.from('--' + boundary + '--\r\n')));
  return { body, headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } };
}
async function post(origin, parts) { const r = await fetch(origin, { method: 'POST', ...multipart(parts), signal: AbortSignal.timeout(4000) }); return { status: r.status, body: await r.json() }; }
async function until(predicate) { const deadline = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < deadline, 'cleanup completes within bounded time'); await new Promise(r => setTimeout(r, 10)); } }

test('installed and locked Multer use the reviewed 2.5.0 security release', () => {
  assert.equal(require('multer/package.json').version, '2.5.0');
  assert.equal(require('./package.json').dependencies.multer, '2.5.0');
  assert.equal(require('./package-lock.json').packages['node_modules/multer'].version, '2.5.0');
});
test('all 14 production upload configurations bound field nesting and numeric indexes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-config-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configs = memoryConfigurations(); configs.push({ file: 'app.js disk', limits: diskUpload(dir).limits });
  assert.equal(configs.length, 14);
  for (const c of configs) { assert.equal(c.limits.fieldNestingDepth, 4, c.file); assert.equal(c.limits.fieldArrayIndexLimit, 100, c.file); }
});
test('each production memory parser rejects excessive nesting and array indexes before handling', async t => {
  for (const c of memoryConfigurations()) {
    await t.test(c.file + ':' + c.index, async t => {
      const f = await serverFixture(t, multer({ storage: multer.memoryStorage(), limits: c.limits }), 'single');
      for (const [name, code] of [['a[b][c][d][e][f]', 'LIMIT_FIELD_NESTING'], ['a[101]', 'LIMIT_FIELD_ARRAY_INDEX']]) {
        const r = await post(f.origin, [{ name, value: 'bounded fixture' }]);
        assert.equal(r.status, 400); assert.equal(r.body.code, code);
      }
      assert.equal(f.stats().completed, 0);
    });
  }
});
for (const storage of ['memory', 'disk']) for (const kind of ['single', 'array']) {
  test(storage + ' ' + kind + ' keeps valid uploads and rejects malformed, unexpected, oversized and interrupted bodies', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-http-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const upload = storage === 'disk' ? diskUpload(dir) : multer({ storage: multer.memoryStorage(), limits: memoryConfigurations()[0].limits });
    // Keep bounded local fixtures while preserving the production storage and field limits.
    upload.limits = { ...upload.limits, fileSize: 16 };
    const f = await serverFixture(t, upload, kind), field = kind === 'single' ? 'file' : 'files';
    const valid = await post(f.origin, [{ name: 'title', value: 'synthetic' }, { name: 'meta[subject]', value: 'math' }, { name: field, filename: 'plain.txt', value: 'ok' }]);
    assert.equal(valid.status, 200); assert.equal(valid.body.files[0].text, 'ok'); assert.equal(valid.body.fields.meta.subject, 'math');
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    const tooMany = Array.from({ length: kind === 'single' ? 2 : 3 }, () => ({ name: field, filename: 'extra.txt', value: 'ok' }));
    for (const parts of [tooMany, [{ name: 'wrong', filename: 'bad.txt', value: 'ok' }]]) {
      const r = await post(f.origin, parts); assert.equal(r.status, 400); assert.equal(r.body.code, 'LIMIT_UNEXPECTED_FILE'); assert.deepEqual(fs.readdirSync(dir), []);
    }
    const large = await post(f.origin, [{ name: field, filename: 'large.txt', value: 'x'.repeat(17) }]); assert.equal(large.body.code, 'LIMIT_FILE_SIZE'); assert.deepEqual(fs.readdirSync(dir), []);
    for (const name of ['a[b][c][d][e][f]', 'a[101]']) { const r = await post(f.origin, [{ name, value: 'bounded' }]); assert.equal(r.status, 400); assert.deepEqual(fs.readdirSync(dir), []); }
    const missingBoundary = await fetch(f.origin, { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'bounded', signal: AbortSignal.timeout(4000) }); assert.equal(missingBoundary.status, 400);
    const truncated = multipart([{ name: field, filename: 'truncated.txt', value: 'partial' }]); truncated.body = truncated.body.subarray(0, truncated.body.lastIndexOf('--zhilexue-synthetic-boundary--'));
    const broken = await fetch(f.origin, { method: 'POST', ...truncated, signal: AbortSignal.timeout(4000) }); assert.equal(broken.status, 400); assert.deepEqual(fs.readdirSync(dir), []);
    const before = f.stats().failed;
    await new Promise((resolve, reject) => {
      const req = http.request(f.origin, { method: 'POST', headers: { ...truncated.headers, 'content-length': truncated.body.length + 200 } });
      req.on('error', err => err.code === 'ECONNRESET' ? resolve() : reject(err));
      req.write(truncated.body); setTimeout(() => { req.destroy(); resolve(); }, 50);
    });
    await until(() => f.stats().failed > before); assert.deepEqual(fs.readdirSync(dir), []); assert.equal(f.stats().completed, 1);
    const after = await post(f.origin, [{ name: field, filename: 'after.txt', value: 'alive' }]); assert.equal(after.body.files[0].text, 'alive');
  });
}
async function reportFixture(t) {
  let parsed = 0, saves = 0, writes = 0, clockOffset = 0, expireDuringParse = false;
  class Clock extends Date { static now() { return Date.now() + clockOffset; } }
  const db = { prepare(sql) { return { run() { if (/INSERT INTO ai_reports/.test(sql)) writes++; return { lastInsertRowid: 1 }; }, get() { return undefined; }, all() { return []; } }; } };
  const wrappedMulter = options => { const real = multer(options); return { array(...args) { const middleware = real.array(...args); return (req, res, next) => { parsed++; middleware(req, res, err => { if (expireDuringParse) clockOffset += 31 * 60 * 1000; next(err); }); }; } }; }; wrappedMulter.memoryStorage = multer.memoryStorage;
  const mod = { exports: {} };
  vm.runInNewContext(source('report.js'), { module: mod, exports: mod.exports, Buffer, Date: Clock, Map, Set, console, process: { env: {} }, require(name) {
    if (name === './school-scope') return require('./src/school-scope'); if (name === './db') return { db }; if (name === './storage') return { saveFile: async () => { saves++; return { key: 'synthetic' }; } }; if (name === './ai' || name === './pdfimg') return {};
    if (name === 'multer') return wrappedMulter; if (name === 'express' || name === 'crypto') return require(name); throw new Error('Unexpected fixture dependency ' + name);
  } }, { filename: 'src/report.js' });
  const app = express(); app.use('/admin', (req, res, next) => { req.user = { id: 7 }; next(); }, mod.exports); app.use('/scan', mod.exports.scan); app.use((err, req, res, next) => res.status(400).json({ code: 1, msg: 'parser error' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return { origin: 'http://127.0.0.1:' + server.address().port, stats: () => ({ parsed, saves, writes }), expire: () => { clockOffset += 31 * 60 * 1000; }, expireDuringParse: () => { expireDuringParse = true; } };
}
test('report-scan rejects missing/invalid token before multipart parsing and keeps valid-token uploads', async t => {
  const f = await reportFixture(t);
  for (const query of ['', '?token=invalid-synthetic']) {
    const r = await fetch(f.origin + '/scan' + query, { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'bounded malformed fixture' });
    assert.equal(r.status, 200); const body = await r.json(); assert.equal(body.code, 1); assert.match(body.msg, /二维码已过期/);
  }
  assert.deepEqual(f.stats(), { parsed: 0, saves: 0, writes: 0 });
  const signed = await fetch(f.origin + '/admin/scan-token', { method: 'POST' }); const { data } = await signed.json();
  const valid = await post(f.origin + '/scan?token=' + data.token, [{ name: 'images', filename: 'synthetic.png', value: 'synthetic' }, { name: 'student', value: 'synthetic student' }]);
  assert.equal(valid.body.code, 0); assert.deepEqual(f.stats(), { parsed: 1, saves: 1, writes: 1 });
});

test('report-scan rejects expired tokens before parsing and rechecks expiry after a long upload', async t => {
  const f = await reportFixture(t);
  const issue = async () => (await (await fetch(f.origin + '/admin/scan-token', { method: 'POST' })).json()).data.token;
  const token = await issue(); f.expire();
  const expired = await post(f.origin + '/scan?token=' + token, [{ name: 'images', filename: 'synthetic.png', value: 'synthetic' }]);
  assert.equal(expired.body.code, 1); assert.match(expired.body.msg, /二维码已过期/); assert.equal(f.stats().parsed, 0);
  const fresh = await issue(); f.expireDuringParse();
  const later = await post(f.origin + '/scan?token=' + fresh, [{ name: 'images', filename: 'synthetic.png', value: 'synthetic' }]);
  assert.equal(later.body.code, 1); assert.match(later.body.msg, /二维码已过期/); assert.deepEqual(f.stats(), { parsed: 1, saves: 0, writes: 0 });
});
test('production error handlers preserve JSON errors for Multer limits and malformed multipart', async t => {
  const app = express(), configuration = memoryConfigurations()[0];
  const upload = multer({ storage: multer.memoryStorage(), limits: { ...configuration.limits, fileSize: 16 } });
  app.post('/api/test', upload.single('file'), (req, res) => res.json({ code: 0 }));
  const text = source('app.js'), start = text.indexOf('// 上传相关错误统一返回 JSON'), end = text.indexOf('// ------------------------------------------------------------------ 静态站点', start);
  assert.ok(start >= 0 && end > start); vm.runInNewContext(text.slice(start, end), { app, console: { error() {} } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const origin = 'http://127.0.0.1:' + server.address().port + '/api/test';
  for (const parts of [[{ name: 'file', filename: 'large.txt', value: 'x'.repeat(17) }], [{ name: 'wrong', filename: 'wrong.txt', value: 'x' }], [{ name: 'a[101]', value: 'x' }]]) {
    const result = await post(origin, parts); assert.equal(result.status, 200); assert.equal(result.body.code, 1); assert.equal(typeof result.body.msg, 'string');
  }
  const bad = await fetch(origin, { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'bounded' }); assert.equal(bad.status, 500); const body = await bad.json(); assert.equal(body.code, 500); assert.ok(!JSON.stringify(body).includes('node_modules'));
});

test('existing video and image batch sizes still accept their declared maxima', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-batch-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const batches = [{ file: 'app.js', pattern: /videoUpload\.array\('files', (\d+)\)/, upload: diskUpload(dir), expected: 30 }, { file: 'wrong.js', pattern: /upload\.array\('images', (\d+)\)/, expected: 60 }, { file: 'mfbank.js', pattern: /upload\.array\('pages', (\d+)\)/, expected: 30 }];
  for (const b of batches) {
    const count = Number(source(b.file).match(b.pattern)[1]); assert.equal(count, b.expected);
    const upload = b.upload || multer({ storage: multer.memoryStorage(), limits: memoryConfigurations().find(c => c.file === b.file).limits });
    const f = await serverFixture(t, upload, 'array', count);
    const parts = Array.from({ length: count }, (_, i) => ({ name: 'files', filename: i + '.txt', value: 'synthetic' }));
    const valid = await post(f.origin, parts); assert.equal(valid.status, 200); assert.equal(valid.body.files.length, count);
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    const over = await post(f.origin, parts.concat(parts[0])); assert.equal(over.body.code, 'LIMIT_UNEXPECTED_FILE'); assert.deepEqual(fs.readdirSync(dir), []);
  }
});
