'use strict';
// Offline regression: real storage/file-route/auth code, synthetic media and mock OSS only.
// Never loads db.js, builtin-config.js or app startup; HTTP is loopback-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const { createCareAudio } = require('./src/care-audio');
const source = name => fs.readFileSync(path.join(__dirname, 'src', name + '.js'), 'utf8');

function fixture(t, options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-media-'));
  const root = path.join(base, 'uploads'); fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const gets = [], signs = [], writes = [], cloud = new Map();
  const fileSystem = options.fs || fs;
  const uploadDir = options.linkRoot ? path.join(base, 'uploads-link') : root;
  if (options.linkRoot) fs.symlinkSync(root, uploadDir, 'dir');
  const env = { STORAGE_DRIVER: 'oss', CDN_DOMAIN: '', ...options.env };
  const fakeOss = class {
    constructor() { if (options.initError) throw options.initError; this.options = { bucket: 'synthetic' }; }
    async putBucketCORS() { writes.push('oss.cors'); }
    async initMultipartUpload() { writes.push('oss.init'); return { uploadId: 'synthetic-upload' }; }
    async completeMultipartUpload() { writes.push('oss.complete'); }
    async abortMultipartUpload() { writes.push('oss.abort'); }
    async multipartUpload() { writes.push('oss.multipart'); }
    async put(key, bytes) { writes.push('oss.put'); cloud.set(key, bytes); }
    async delete(key) { writes.push('oss.delete'); cloud.delete(key); }
    async head(key) { if (!cloud.has(key)) throw new Error('NoSuchKey'); return { status: 200 }; }
    signatureUrl(key, opts) {
      signs.push({ key, opts });
      if (opts.method === 'PUT') writes.push('oss.signPut');
      const u = new URL('https://synthetic.invalid/' + key);
      u.searchParams.set('expires', opts.expires);
      if (opts.response) u.searchParams.set('disposition', opts.response['content-disposition']);
      return u.href;
    }
    async get(key) {
      gets.push(key);
      if (options.cloudError) throw options.cloudError;
      if (!cloud.has(key)) throw Object.assign(new Error('NoSuchKey'), { status: 404, code: 'NoSuchKey' });
      return { content: cloud.get(key), res: { status: 200 } };
    }
  };
  const fakeQiniu = {
    auth: { digest: { Mac: class { constructor(accessKey, secretKey) { Object.assign(this, { accessKey, secretKey }); } } } },
    conf: { Config: class {} },
    form_up: {
      PutExtra: class {},
      FormUploader: class { put(token, key, body, extra, cb) { writes.push('qiniu.put'); cb(null, { key, size: 7 }, { statusCode: 200 }); } },
    },
    rs: {
      PutPolicy: class { constructor() { writes.push('qiniu.policy'); } uploadToken() { writes.push('qiniu.token'); return 'synthetic-token'; } },
      BucketManager: class { delete(bucket, key, cb) { writes.push('qiniu.delete'); cb(null, {}, { statusCode: 200 }); } },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source('storage'), {
    module, exports: module.exports, Buffer, URL, URLSearchParams, console: options.console || console,
    process: { env }, setTimeout, clearTimeout,
    require(name) {
      if (name === './db') return { UPLOAD_DIR: uploadDir };
      if (name === './builtin-config') return { oss: { region: 'synthetic', bucket: 'synthetic', accessKeyId: 'fake', accessKeySecret: 'fake' } };
      if (name === 'ali-oss') return fakeOss;
      if (name === 'qiniu') return fakeQiniu;
      if (name === 'fs') return fileSystem;
      if (name === 'https') return { request() { throw new Error('External network forbidden'); } };
      if (['path', 'crypto', 'stream'].includes(name)) return require(name);
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename: 'src/storage.js' });
  function local(key, bytes) {
    const target = path.join(root, key); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); return target;
  }
  return { store: module.exports, root, base, gets, signs, writes, cloud, local };
}

function fileApp(f) {
  let account = { id: 7, role: 'student', status: 1, expire_at: null };
  const db = { prepare() { return { get() { return account; } }; } };
  const authModule = { exports: {} };
  vm.runInNewContext(source('auth'), {
    module: authModule, exports: authModule.exports, Buffer, Date,
    process: { env: { JWT_SECRET: 'synthetic-file-auth-secret' } },
    require: name => name === './db' ? { db, DATA_DIR: f.base } : (name === './ticket-epoch' ? require('./src/ticket-epoch').createPolicy('') : require(name)),
  }, { filename: 'src/auth.js' });
  const auth = authModule.exports;
  const app = express();
  const careAudio = createCareAudio({ db, dataDir: f.base, publicDir: path.join(f.base, 'public'), auth: auth.auth });
  const appSource = source('app');
  const start = appSource.indexOf('const FILE_KEY_RE =');
  const end = appSource.indexOf('// ================================================================== 管理端', start);
  assert.ok(start >= 0 && end > start, 'the complete production /api/file block must be exercised');
  vm.runInNewContext(appSource.slice(start, end), {
    app, store: f.store, fs, path, careAudio, auth: auth.auth, verifyFileTicket: auth.verifyFileTicket,
    require(name) { if (name === './mfbank') return { bankFolder: () => 'bank' }; throw new Error('Unexpected route dependency'); },
  }, { filename: 'src/app.js:file-route' });
  const helperStart = appSource.indexOf('function withFileTicket(');
  const helperEnd = appSource.indexOf('\n}\n', helperStart) + 2;
  const helper = {};
  vm.runInNewContext(appSource.slice(helperStart, helperEnd) + '\nthis.withFileTicket = withFileTicket;', helper);
  return { app, auth, withFileTicket: helper.withFileTicket, disable() { account.status = 0; } };
}
async function serve(t, fixture) {
  const h = fileApp(fixture);
  const server = h.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const token = h.auth.sign({ id: 7, role: 'student' });
  async function get(url, { authenticated = true, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: url,
        headers: { ...(authenticated ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
    });
  }
  return { ...h, get, token };
}
const proxy = key => '/api/file?key=' + encodeURIComponent(key);

test('OSS mixed reads prefer existing local bytes and proxy URLs, even when both copies exist', async t => {
  const f = fixture(t, { linkRoot: true });
  for (const [key, bytes] of [['guides/202611/local.mp4', 'local-video'], ['handouts/202611/both.pdf', '%PDF-local']]) {
    f.local(key, bytes);
    if (key.includes('both')) f.cloud.set(key, Buffer.from('%PDF-cloud'));
    assert.equal(f.store.getUrlSync(key), proxy(key));
    assert.equal(await f.store.getUrl(key), proxy(key));
    assert.equal(f.store.isCloudKey(key), false);
    assert.equal((await f.store.readBuffer(key)).toString(), bytes);
  }
  assert.equal(f.gets.length, 0, 'local copies do not require any cloud GET');
  assert.equal(f.signs.length, 0, 'local URLs must not be signed cloud URLs');
});

test('cloud-only keeps the original key, one-hour signature, CDN and download options', async t => {
  const f = fixture(t); const key = 'videos/202611/cloud.mp4'; f.cloud.set(key, Buffer.from('cloud-video'));
  assert.equal(f.store.isCloudKey(key), true);
  assert.equal(await f.store.getUrl(key), 'https://synthetic.invalid/videos/202611/cloud.mp4?expires=3600');
  assert.equal((await f.store.readBuffer(key)).toString(), 'cloud-video');
  const url = await f.store.getUrl(key, '课程.mp4');
  assert.match(new URL(url).searchParams.get('disposition'), /filename\*=UTF-8''%E8%AF%BE%E7%A8%8B.mp4/);
  assert.equal(f.signs.at(-1).key, key);
  assert.equal(f.signs.at(-1).opts.expires, 3600);
  const cdn = fixture(t, { env: { CDN_DOMAIN: 'cdn.synthetic.invalid' } });
  assert.equal(cdn.store.getUrlSync(key), 'https://cdn.synthetic.invalid/videos/202611/cloud.mp4');
  cdn.local(key, 'local'); assert.equal(cdn.store.getUrlSync(key), proxy(key));
});

test('missing cloud objects and cloud errors stay missing rather than fabricating local success', async t => {
  for (const cloudError of [undefined, Object.assign(new Error('AccessDenied'), { status: 403 })]) {
    const f = fixture(t, { cloudError }); const key = 'videos/202611/missing.mp4';
    assert.equal(await f.store.readBuffer(key), null);
    assert.match(await f.store.getUrl(key), /^https:\/\/synthetic.invalid\/videos\/202611\/missing.mp4\?/);
  }
});

test('LOCAL_FOLDERS remains an upload policy: existing copies are local, missing copies may be in original OSS', async t => {
  const f = fixture(t); const key = 'guidedocs/202611/local.pdf'; f.local(key, '%PDF-guide');
  assert.equal(f.store.isCloudKey(key), false);
  assert.equal(f.store.getUrlSync(key, 'Guide.pdf'), proxy(key) + '&name=Guide.pdf');
  const missing = 'guidedocs/202611/missing.pdf';
  assert.equal(f.store.isCloudKey(missing), true);
  assert.match(f.store.getUrlSync(missing), /^https:\/\/synthetic.invalid\/guidedocs\//);
});

test('dangerous keys never enter local resolution or return outside bytes', async t => {
  let inspected = 0;
  const guardedFs = Object.create(fs);
  for (const method of ['realpathSync', 'statSync', 'existsSync', 'readFileSync']) guardedFs[method] = (...args) => { inspected++; return fs[method](...args); };
  const f = fixture(t, { fs: guardedFs });
  fs.writeFileSync(path.join(f.base, 'outside.pdf'), 'outside-secret');
  const keys = ['../outside.pdf', 'bank/../../outside.pdf', '/outside.pdf', 'https://user:pass@synthetic.invalid/outside.pdf', '//user@host/outside.pdf', 'file:outside.pdf', 'bank\\outside.pdf', 'bank/%2e%2e/outside.pdf', 'bank/./outside.pdf', 'bank//outside.pdf', 'bank/x.pdf?x=1', 'bank/x.pdf\0'];
  for (const key of keys) {
    const before = inspected;
    f.store.getUrlSync(key);
    assert.equal(await f.store.readBuffer(key), null);
    assert.equal(inspected, before, 'unsafe key must not be inspected on local disk');
  }
});

test('symlinks and directories never become readable local media', async t => {
  const f = fixture(t); const target = path.join(f.base, 'outside.pdf'); fs.writeFileSync(target, 'outside-secret');
  fs.mkdirSync(path.join(f.root, 'handouts'));
  fs.symlinkSync(target, path.join(f.root, 'handouts', 'escape.pdf'));
  fs.symlinkSync(f.base, path.join(f.root, 'linked'));
  fs.mkdirSync(path.join(f.root, 'handouts', 'directory.pdf'));
  for (const key of ['handouts/escape.pdf', 'linked/outside.pdf', 'handouts/directory.pdf']) {
    assert.equal(await f.store.readBuffer(key), null);
    assert.match(f.store.getUrlSync(key), /^https:\/\/synthetic.invalid\//);
  }
});

test('unexpected local permission errors fail visibly instead of switching to a cloud copy', async t => {
  const error = Object.assign(new Error('Synthetic permission failure'), { code: 'EACCES' });
  const deniedFs = Object.create(fs); deniedFs.realpathSync = () => { throw error; };
  const f = fixture(t, { fs: deniedFs }); const key = 'handouts/202611/blocked.pdf';
  f.local(key, 'local'); f.cloud.set(key, Buffer.from('cloud'));
  assert.throws(() => f.store.getUrlSync(key), e => e.code === 'EACCES');
  await assert.rejects(f.store.readBuffer(key), e => e.code === 'EACCES');
});

test('real /api/file serves local video bytes and Range, PDFs inline and download names without redirect loops', async t => {
  const f = fixture(t, { linkRoot: true });
  const video = 'guides/202611/local.mp4', pdf = 'handouts/202611/both.pdf';
  f.local(video, '0123456789'); f.local(pdf, '%PDF-local'); f.cloud.set(pdf, Buffer.from('%PDF-cloud'));
  const h = await serve(t, f);
  const pageUrl = h.withFileTicket(await f.store.getUrl(video), { headers: { authorization: 'Bearer ' + h.token }, query: {} });
  assert.ok(pageUrl.startsWith('/api/file?'), 'page playback URL must point at the local file route');
  let r = await h.get(pageUrl, { authenticated: false, headers: { Range: 'bytes=2-5' } });
  assert.equal(r.status, 206); assert.equal(r.body.toString(), '2345');
  assert.equal(r.headers['content-range'], 'bytes 2-5/10'); assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.match(r.headers['content-type'], /^video\/mp4/); assert.equal(r.headers.location, undefined);
  r = await h.get(proxy(pdf) + '&inline=1');
  assert.equal(r.status, 200); assert.equal(r.body.toString(), '%PDF-local');
  assert.equal(r.headers['content-type'], 'application/pdf'); assert.equal(r.headers['content-disposition'], 'inline');
  r = await h.get(proxy(pdf) + '&name=Lesson');
  assert.equal(r.status, 200); assert.equal(r.body.toString(), '%PDF-local');
  assert.match(r.headers['content-disposition'], /attachment; filename="Lesson.pdf"/);
});

test('real /api/file preserves auth, key-bound expiring image tickets and disabled-account denial', async t => {
  const f = fixture(t); const key = 'bank/img/local.png'; f.local(key, 'png-fixture');
  const h = await serve(t, f);
  assert.equal((await h.get(proxy(key), { authenticated: false })).status, 401);
  const ticket = h.auth.signFileTicket(key);
  assert.equal((await h.get(proxy(key) + '&ft=' + ticket, { authenticated: false })).status, 200);
  assert.equal((await h.get(proxy('bank/img/other.png') + '&ft=' + ticket, { authenticated: false })).status, 401);
  assert.equal((await h.get(proxy(key) + '&ft=' + h.auth.signFileTicket(key, -1), { authenticated: false })).status, 401);
  assert.equal((await h.get(proxy('guides/local.mp4') + '&ft=' + h.auth.signFileTicket('guides/local.mp4'), { authenticated: false })).status, 401);
  h.disable(); assert.equal((await h.get(proxy(key))).status, 403);
});

test('real /api/file retains cloud redirect/404 behavior and denies invalid or escaped local requests', async t => {
  const f = fixture(t); const h = await serve(t, f);
  const cloudKey = 'videos/202611/cloud.mp4';
  let r = await h.get(proxy(cloudKey)); assert.equal(r.status, 302);
  assert.equal(r.headers.location, 'https://synthetic.invalid/videos/202611/cloud.mp4?expires=3600');
  r = await h.get(proxy('handouts/202611/missing.pdf') + '&inline=1'); assert.equal(r.status, 404);
  const local = fixture(t, { env: { STORAGE_DRIVER: 'local' } });
  const localApp = await serve(t, local);
  fs.writeFileSync(path.join(local.base, 'outside.mp4'), 'outside-secret');
  fs.mkdirSync(path.join(local.root, 'guides')); fs.symlinkSync(path.join(local.base, 'outside.mp4'), path.join(local.root, 'guides', 'escape.mp4'));
  r = await localApp.get(proxy('guides/escape.mp4')); assert.equal(r.status, 404); assert.notEqual(r.body.toString(), 'outside-secret');
  for (const key of ['../outside.mp4', 'https://user@host/a.mp4', 'guides/./a.mp4']) assert.equal((await h.get(proxy(key))).status, 400);
  const privateDir = path.join(f.base, 'private-care-audio'); fs.mkdirSync(privateDir); fs.writeFileSync(path.join(privateDir, 'private.mp3'), 'private');
  fs.mkdirSync(path.join(f.root, 'audio')); fs.symlinkSync(path.join(privateDir, 'private.mp3'), path.join(f.root, 'audio', 'private.mp3'));
  assert.equal((await h.get(proxy('audio/private.mp3'))).status, 404);
});


test('real /api/file reports local I/O failure as 500 without a cloud redirect or unhandled rejection', async t => {
  const deniedFs = Object.create(fs);
  deniedFs.realpathSync = () => { throw Object.assign(new Error('Synthetic I/O failure'), { code: 'EIO' }); };
  const f = fixture(t, { fs: deniedFs }); const h = await serve(t, f);
  for (const url of [proxy('guides/202611/local.mp4'), proxy('handouts/202611/local.pdf') + '&inline=1']) {
    const r = await h.get(url);
    assert.equal(r.status, 500); assert.equal(r.headers.location, undefined);
    assert.equal(r.body.toString(), '文件读取失败');
  }
});


const qiniuEnv = { STORAGE_DRIVER: 'qiniu', QINIU_ACCESS_KEY: 'fake', QINIU_SECRET_KEY: 'fake', QINIU_BUCKET: 'synthetic', QINIU_DOMAIN: 'qiniu.synthetic.invalid' };
const videoKey = 'videos/202611/0123456789abcdef.mp4';
const readOnlyError = error => error.code === 'STORAGE_CLOUD_READ_ONLY' && /只读/.test(error.message);

test('cloud read-only blocks every OSS write entry and PUT signature before SDK effects', async t => {
  const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } });
  const large = path.join(f.base, 'large.mp4'); fs.writeFileSync(large, ''); fs.truncateSync(large, 9 * 1024 * 1024);
  const operations = [
    () => f.store.saveFile(Buffer.from('content'), 'a.mp4', 'videos'),
    () => f.store.saveFile(large, 'large.mp4', 'videos'),
    () => f.store.deleteFile(videoKey),
    () => f.store.initVideoUpload('a.mp4', 7),
    () => f.store.signVideoPart(videoKey, 'synthetic-upload', 1),
    () => f.store.completeVideoUpload(videoKey, 'synthetic-upload', [{ number: 1, etag: 'synthetic' }]),
    () => f.store.abortVideoUpload(videoKey, 'synthetic-upload'),
  ];
  for (const run of operations) await assert.rejects(Promise.resolve().then(run), readOnlyError);
  assert.deepEqual(f.writes, []); assert.equal(f.signs.length, 0);
  assert.equal(fs.statSync(large).size, 9 * 1024 * 1024, 'blocked upload leaves source unchanged');
  f.cloud.set(videoKey, Buffer.from('cloud-video'));
  assert.equal((await f.store.readBuffer(videoKey)).toString(), 'cloud-video');
  assert.equal(await f.store.videoExists(videoKey), true);
  assert.match(await f.store.getUrl(videoKey), /^https:\/\/synthetic.invalid\//);
});

test('cloud read-only blocks Qiniu uploads, upload tokens and deletion without blocking GET signing', async t => {
  const f = fixture(t, { env: { ...qiniuEnv, STORAGE_CLOUD_READ_ONLY: '1' } });
  await assert.rejects(f.store.saveFile(Buffer.from('content'), 'a.mp4', 'videos'), readOnlyError);
  await assert.rejects(f.store.deleteFile(videoKey), readOnlyError);
  assert.deepEqual(f.writes, []);
  assert.match(f.store.getUrlSync(videoKey), /^https:\/\/qiniu.synthetic.invalid\/videos\//);
  assert.match(f.store.getUrlSync(videoKey), /[?&]token=/);
});

test('cloud read-only still allows existing local save/delete behavior in OSS, Qiniu and local drivers', async t => {
  for (const env of [{}, qiniuEnv, { STORAGE_DRIVER: 'local' }]) {
    const f = fixture(t, { env: { ...env, STORAGE_CLOUD_READ_ONLY: '1' } });
    const saved = await f.store.saveFile(Buffer.from('local-content'), 'a.pdf', 'guidedocs');
    assert.equal(fs.readFileSync(f.store.localPath(saved.key), 'utf8'), 'local-content');
    await f.store.deleteFile(saved.key);
    assert.equal(fs.existsSync(f.store.localPath(saved.key)), false);
    assert.deepEqual(f.writes, []);
  }
});

test('cloud write behavior is unchanged with the flag unset or explicitly disabled', async t => {
  for (const flag of [undefined, '0']) {
    const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: flag } });
    const saved = await f.store.saveFile(Buffer.from('content'), 'a.mp4', 'videos');
    assert.equal((await f.store.readBuffer(saved.key)).toString(), 'content');
    await f.store.deleteFile(saved.key); assert.equal(await f.store.readBuffer(saved.key), null);
    const large = path.join(f.base, 'large.mp4'); fs.writeFileSync(large, ''); fs.truncateSync(large, 9 * 1024 * 1024);
    await f.store.saveFile(large, 'large.mp4', 'videos');
    assert.equal((await f.store.initVideoUpload('a.mp4', 7)).uploadId, 'synthetic-upload');
    assert.ok(f.store.signVideoPart(videoKey, 'synthetic-upload', 1).url);
    await f.store.completeVideoUpload(videoKey, 'synthetic-upload', [{ number: 1, etag: 'synthetic' }]);
    await f.store.abortVideoUpload(videoKey, 'synthetic-upload');
    assert.deepEqual(f.writes, ['oss.put', 'oss.delete', 'oss.multipart', 'oss.cors', 'oss.init', 'oss.signPut', 'oss.complete', 'oss.abort']);
    const q = fixture(t, { env: { ...qiniuEnv, STORAGE_CLOUD_READ_ONLY: flag } });
    const qSaved = await q.store.saveFile(Buffer.from('content'), 'a.mp4', 'videos');
    await q.store.deleteFile(qSaved.key);
    assert.deepEqual(q.writes, ['qiniu.policy', 'qiniu.token', 'qiniu.put', 'qiniu.delete']);
  }
});

function mediaWriteRoutes(f) {
  const routes = {}, changes = [];
  const rows = {
    handouts: { id: 1, title: 'Lesson', file_path: 'handouts/202611/local.pdf', file_name: 'Lesson.pdf', ext: 'pdf', size: 7 },
    videos: { id: 1, title: 'Video', file_path: videoKey, url: '' },
  };
  const admin = {};
  for (const method of ['get', 'post', 'put', 'delete']) admin[method] = (name, ...handlers) => { routes[method + ' ' + name] = handlers.at(-1); };
  const db = { prepare(sql) { return {
    get(id) { const type = /handouts/.test(sql) ? 'handouts' : 'videos'; return { ...rows[type], id: Number(id) || 1 }; },
    run(...args) { changes.push({ sql, args }); return { lastInsertRowid: 1 }; },
  }; } };
  const ctx = { admin, db, store: f.store, path, fs, Buffer,
    upload: { single() {} }, videoUpload: { single() {}, array() {} },
    delPwdOk: () => true, normSection: () => null, fixFileName: name => name, dropTmp() {},
    now: () => '2026-11-08 12:00:00',
    ok: (res, data = null, msg = 'ok') => res.json({ code: 0, data, msg }),
    fail: (res, msg) => res.json({ code: 1, msg }),
  };
  vm.createContext(ctx);
  const app = source('app');
  const dropStart = app.indexOf('function dropTmp('), dropEnd = app.indexOf('\n}\n', dropStart) + 2;
  vm.runInContext(app.slice(dropStart, dropEnd), ctx);
  const sections = [
    ["admin.post('/handouts',", "admin.get('/handouts/:id/download'"],
    ["admin.post('/videos/direct/init'", '// ---------- 统计 ----------'],
  ];
  for (const [startText, endText] of sections) {
    const start = app.indexOf(startText), end = app.indexOf(endText, start);
    assert.ok(start >= 0 && end > start); vm.runInContext(app.slice(start, end), ctx);
  }
  const report = source('report');
  const start = report.indexOf("admin.delete('/:id'");
  const end = report.indexOf('// ------------------------------------------------------------------ 手机扫码', start);
  ctx.reportGet = () => ({ id: 1, paper_keys: JSON.stringify(['report/202611/photo.png']) });
  vm.runInContext(report.slice(start, end), ctx);
  async function call(method, route, body = {}, extra = {}) {
    const res = { json(value) { this.value = value; return value; } };
    await routes[method + ' ' + route]({ body, params: { id: '1' }, user: { id: 1, role: 'admin' }, ...extra }, res);
    // The report route uses a promise completion callback in the original implementation.
    await new Promise(resolve => setImmediate(resolve));
    return res.value;
  }
  return { call, changes, rows, ctx };
}

test('read-only media deletion routes reject before database or retained local media changes', async t => {
  for (const [method, route, body] of [
    ['delete', '/handouts/:id', {}], ['delete', '/handouts/batch', { ids: [1, 2] }],
    ['delete', '/videos/:id', {}], ['delete', '/videos/batch', { ids: [1, 2] }],
    ['put', '/handouts/:id', { clear_file: '1' }], ['put', '/videos/:id', { clear_file: '1' }],
    ['put', '/videos/:id', { file_key: 'videos/202611/abcdef0123456789.mp4' }],
    ['delete', '/:id', {}],
  ]) {
    const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } });
    const localVideo = f.local(videoKey, 'retained-video');
    const localPdf = f.local('handouts/202611/local.pdf', 'retained-pdf');
    const h = mediaWriteRoutes(f);
    const result = await h.call(method, route, body);
    assert.equal(result.code, 1, method + ' ' + route); assert.match(result.msg, /只读/);
    assert.deepEqual(h.changes, []); assert.deepEqual(f.writes, []);
    assert.equal(fs.readFileSync(localVideo, 'utf8'), 'retained-video');
    assert.equal(fs.readFileSync(localPdf, 'utf8'), 'retained-pdf');
  }
});

test('read-only abort and previously unhandled uploads return an explicit controlled error', async t => {
  const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } }); const h = mediaWriteRoutes(f);
  const sample = { buffer: Buffer.from('content'), originalname: 'Lesson.pdf', path: f.local('tmp/video.mp4', 'video') };
  for (const [route, body, extra] of [
    ['/videos/direct/abort', { key: videoKey, uploadId: 'synthetic' }, {}],
    ['/handouts', { title: 'Lesson' }, { file: sample }],
    ['/videos/batch', {}, { files: [sample] }],
  ]) {
    const result = await h.call('post', route, body, extra);
    assert.equal(result.code, 1); assert.match(result.msg, /只读/);
    assert.deepEqual(h.changes, []); assert.deepEqual(f.writes, []);
  }
});

test('read-only batch preflight prevents partial local-only record deletion before a later cloud key', async t => {
  const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } }); const h = mediaWriteRoutes(f);
  const kept = f.local('guidedocs/202611/local.pdf', 'retained');
  h.ctx.db.prepare = sql => ({
    get(id) { return { id, file_path: id === 1 ? 'guidedocs/202611/local.pdf' : 'handouts/202611/cloud.pdf' }; },
    run() { h.changes.push(sql); },
  });
  const result = await h.call('delete', '/handouts/batch', { ids: [1, 2] });
  assert.equal(result.code, 1); assert.match(result.msg, /只读/);
  assert.deepEqual(h.changes, []); assert.equal(fs.readFileSync(kept, 'utf8'), 'retained');
});

test('default media deletion routes keep the original successful behavior', async t => {
  for (const [method, route, body] of [
    ['delete', '/handouts/:id', {}], ['delete', '/handouts/batch', { ids: [1] }],
    ['delete', '/videos/:id', {}], ['delete', '/videos/batch', { ids: [1] }],
    ['put', '/handouts/:id', { clear_file: '1' }], ['put', '/videos/:id', { clear_file: '1' }],
    ['delete', '/:id', {}],
  ]) {
    const f = fixture(t); const h = mediaWriteRoutes(f);
    const result = await h.call(method, route, body);
    assert.equal(result.code, 0, method + ' ' + route); assert.ok(h.changes.length > 0);
  }
});


test('cloud read-only does not block metadata-only media edits', async t => {
  for (const route of ['/handouts/:id', '/videos/:id']) {
    const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } }); const h = mediaWriteRoutes(f);
    const result = await h.call('put', route, { title: 'Edited title' });
    assert.equal(result.code, 0); assert.equal(h.changes.length, 1); assert.deepEqual(f.writes, []);
  }
});


test('read-only batch rejection removes all three received temporary files but preserves original media', async t => {
  const f = fixture(t, { env: { STORAGE_CLOUD_READ_ONLY: '1' } }); const h = mediaWriteRoutes(f);
  const original = f.local(videoKey, 'retained-original-media');
  const files = [1, 2, 3].map(n => {
    const temp = path.join(f.base, 'received-' + n + '.mp4'); fs.writeFileSync(temp, 'temporary-video-' + n);
    return { path: temp, originalname: 'received-' + n + '.mp4' };
  });
  const result = await h.call('post', '/videos/batch', {}, { files });
  assert.equal(result.code, 1); assert.match(result.msg, /只读/);
  for (const file of files) assert.equal(fs.existsSync(file.path), false, 'every received temporary file must be removed');
  assert.equal(fs.readFileSync(original, 'utf8'), 'retained-original-media');
  assert.deepEqual(h.changes, []); assert.deepEqual(f.writes, []);
});

test('explicit cloud read-only fails closed on OSS initialization or missing Qiniu configuration without leaking SDK errors', t => {
  const logged = [], syntheticSecret = 'SYNTHETIC-INIT-SECRET-DO-NOT-LOG';
  const captureConsole = { error: (...parts) => logged.push(parts.join(' ')) };
  for (const options of [
    { env: { STORAGE_CLOUD_READ_ONLY: '1' }, initError: new Error('SDK rejected ' + syntheticSecret) },
    { env: { STORAGE_DRIVER: 'qiniu', STORAGE_CLOUD_READ_ONLY: '1' } },
  ]) {
    assert.throws(() => fixture(t, { ...options, console: captureConsole }), error => {
      assert.equal(error.code, 'STORAGE_CLOUD_READ_ONLY_INIT_FAILED');
      assert.equal(error.message, '云存储只读模式初始化失败，已停止存储服务');
      assert.equal(String(error.stack).includes(syntheticSecret), false);
      return true;
    });
  }
  assert.deepEqual(logged, [], 'initialization must not print raw SDK/config errors in explicit read-only mode');
});

test('cloud initialization fallback remains compatible when read-only is unset or zero', async t => {
  const captureConsole = { error() {} };
  for (const flag of [undefined, '0']) {
    for (const options of [
      { env: { STORAGE_CLOUD_READ_ONLY: flag }, initError: new Error('Synthetic SDK initialization failure') },
      { env: { STORAGE_DRIVER: 'qiniu', STORAGE_CLOUD_READ_ONLY: flag } },
    ]) {
      const f = fixture(t, { ...options, console: captureConsole });
      assert.equal(f.store.isOss(), false); assert.equal(f.store.isQiniu(), false);
      const saved = await f.store.saveFile(Buffer.from('fallback-local'), 'video.mp4', 'videos');
      assert.equal(fs.readFileSync(f.store.localPath(saved.key), 'utf8'), 'fallback-local');
      assert.deepEqual(f.writes, []);
    }
  }
});
