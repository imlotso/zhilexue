'use strict';
// 题图地址稳定化与七牛读取的隔离验证；使用假密钥和模拟响应，不访问实际对象存储。
const assert = require('assert');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Module = require('module');
const storagePath = require.resolve('./src/storage');
const imagesPath = require.resolve('./src/bank-images');

function load(env) {
  for (const key of ['CDN_DOMAIN', 'QINIU_PRIVATE', 'QINIU_FOLDERS', 'LOCAL_FOLDERS']) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[storagePath]; delete require.cache[imagesPath];
  const store = require(storagePath);
  return { store, normalize: require(imagesPath).normalizeBankImages };
}

async function main() {
  const key = 'bank/img/202611/abc123.png';
  let { store, normalize } = load({ STORAGE_DRIVER: 'oss', CDN_DOMAIN: '', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'test-bucket', OSS_ACCESS_KEY_ID: 'fake-id', OSS_ACCESS_KEY_SECRET: 'fake-secret' });
  assert.strictEqual(store.isOss(), true, '假 OSS 客户端必须初始化，不能静默回退本地后假通过');
  const expiredUrl = store.getUrlSync(key).replace(/Expires=\d+/, 'Expires=1');
  const stable = store.bankImageProxyUrl(key);
  assert.strictEqual(store.bankImageKey(expiredUrl), key, '旧签名能恢复同桶 key');
  assert.strictEqual(store.bankImageKey('https://other.example/bank/img/202611/abc123.png?Expires=1'), '', '外部来源不当作本桶');
  assert.strictEqual(store.bankImageKey('/api/file?key=videos%2F202611%2Fx.png'), '', '视频目录不能当作题图');
  assert.strictEqual(store.bankImageKey('/api/file?key=bank%2F..%2Fvideos%2Fx.png'), '', '路径穿越被拒绝');
  assert.strictEqual(store.bankImageKey('/api/file?key=bank%2Fimg%2Fa.png&key=bank%2Fimg%2Fb.png'), '', '重复 key 被拒绝');
  const oldProxy = stable + '&ft=old-ticket';
  assert.strictEqual(store.bankImageKey(oldProxy), key, '旧本地题图票据可重新签发');
  const payload = { key, images: [expiredUrl, 'https://other.example/x.png'], drafts: JSON.stringify([{ figures: [{ url: expiredUrl }] }]), html: `<img src="${expiredUrl}">` };
  const out = normalize(payload, 'bank');
  assert.strictEqual(out.key, key, '上传响应的原始 key 不被改写');
  assert.strictEqual(out.images[0], stable);
  assert.strictEqual(out.images[1], payload.images[1]);
  assert.strictEqual(JSON.parse(out.drafts)[0].figures[0].url, stable);
  assert(out.html.includes(stable));
  assert.strictEqual(payload.images[0], expiredUrl, '响应转换不改写原始数据');

  ({ store } = load({ STORAGE_DRIVER: 'qiniu', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'fake-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com', QINIU_FOLDERS: '*', LOCAL_FOLDERS: '' }));
  assert.strictEqual(store.isQiniu(), true, '假七牛客户端必须初始化');
  const original = https.request, requests = [];
  let mode = 'ok';
  https.request = (url, opts, callback) => {
    requests.push(String(url));
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => process.nextTick(() => {
      const res = Readable.from(mode === 'ok' ? [Buffer.from('bank-image-test')] : []);
      res.statusCode = mode === 'redirect' ? 302 : 200;
      res.headers = mode === 'oversize' ? { 'content-length': String(101 * 1024 * 1024) } : {};
      if (mode === 'redirect') res.headers.location = 'https://other.example/private';
      callback(res);
    });
    return req;
  };
  try {
    assert.strictEqual((await store.readBuffer(key)).toString(), 'bank-image-test', '七牛题图通过当前存储域名读取');
    assert.strictEqual(new URL(requests[0]).hostname, 'cdn-qiniu.example.com');
    assert(new URL(requests[0]).searchParams.has('token'), '私有空间使用签名');
    const before = requests.length;
    assert.strictEqual(await store.readBuffer('bank/../videos/a.png'), null);
    assert.strictEqual(await store.readBuffer('https://other.example/a.png'), null);
    assert.strictEqual(requests.length, before, '穿越和外部 URL 不发送请求');
    mode = 'redirect'; assert.strictEqual(await store.readBuffer(key), null, '不跟随外部跳转');
    mode = 'oversize'; assert.strictEqual(await store.readBuffer(key), null, '超大响应被拒绝');
  } finally { https.request = original; }
  console.log('题图稳定地址、历史签名兼容和七牛受控读取通过');
}
async function isolatedMain() {
  // storage 只需要 UPLOAD_DIR；纯图片单测不应因此连接数据库或读取真实云配置。
  // 不关闭 CI 或放松 db-connection 的保护，所有替身仅存在于本测试进程。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-bank-image-test-'));
  const dbPath = require.resolve('./src/db');
  const builtinPath = require.resolve('./src/builtin-config');
  const savedCache = new Map([dbPath, builtinPath, storagePath, imagesPath].map(p => [p, require.cache[p]]));
  const savedEnv = { ...process.env };
  const originalConnect = net.Socket.prototype.connect;
  let networkAttempts = 0;
  try {
    for (const [filename, exports] of [[dbPath, { UPLOAD_DIR: dir }], [builtinPath, { oss: {} }]]) {
      const fixture = new Module(filename);
      fixture.filename = filename; fixture.loaded = true; fixture.exports = exports;
      require.cache[filename] = fixture;
    }
    // 清除继承的可选真实配置；测试只使用上面显式指定的假参数。
    for (const key of ['OSS_ENDPOINT', 'QINIU_ZONE', 'QINIU_UPLOAD_HOST', 'BANK_FOLDER', 'BANK_BUCKET']) delete process.env[key];
    net.Socket.prototype.connect = function () {
      networkAttempts++;
      throw new Error('图片单测禁止真实网络连接');
    };
    await main();
    assert.strictEqual(networkAttempts, 0, '所有存储读取必须由内存响应提供');
  } finally {
    net.Socket.prototype.connect = originalConnect;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    for (const [filename, cached] of savedCache) {
      if (cached) require.cache[filename] = cached; else delete require.cache[filename];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
isolatedMain().catch((e) => { console.error(e); process.exitCode = 1; });

