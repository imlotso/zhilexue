'use strict';
// 题图地址稳定化与七牛读取的隔离验证；使用假密钥和模拟响应，不访问实际对象存储。
const assert = require('assert');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const https = require('https');
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
main().catch((e) => { console.error(e); process.exitCode = 1; });
