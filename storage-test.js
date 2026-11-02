// 验证 storage.js 的 CDN 分支（不联网，只验证 URL 生成规则）
const path = require('path').join(__dirname, 'src/storage.js');

function load(env) {
  // 先清掉上一轮可能残留的可选开关，避免测试间互相污染
  for (const k of ['QINIU_PRIVATE', 'QINIU_FOLDERS', 'QINIU_ZONE', 'QINIU_UPLOAD_HOST']) delete process.env[k];
  for (const k of Object.keys(env)) process.env[k] = env[k];
  delete require.cache[require.resolve(path)];
  return require(path);
}

const KEY = 'videos/202610/demo.mp4';
let pass = 0, fail = 0;
const t = (cond, name, extra) => { cond ? (pass++, console.log('  OK  ' + name)) : (fail++, console.log('  XX  ' + name + '  ->  ' + extra)); };

async function main() {
  // ---- 1. 本地磁盘：行为不变 ----
  let s = load({ STORAGE_DRIVER: 'local', CDN_DOMAIN: '' });
  let u = await s.getUrl(KEY);
  t(s.DRIVER === 'local' && u === '/api/file?key=videos%2F202610%2Fdemo.mp4', '本地模式返回后端代理地址', u);
  t(s.usingCdn() === false, '本地模式不使用 CDN', String(s.usingCdn()));

  // ---- 2. OSS 无 CDN：仍是签名直链 ----
  s = load({ STORAGE_DRIVER: 'oss', CDN_DOMAIN: '', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'demo-bucket', OSS_ACCESS_KEY_ID: 'fake-id', OSS_ACCESS_KEY_SECRET: 'fake-secret' });
  t(s.isOss() === true, 'OSS 客户端初始化成功', 'isOss=' + s.isOss());
  u = await s.getUrl(KEY);
  t(/^https:\/\/demo-bucket\.oss-cn-hangzhou\.aliyuncs\.com\//.test(u) && u.includes('Signature='), '未配 CDN 时仍返回 OSS 签名直链', u.slice(0, 90));
  t(s.usingCdn() === false, '未配 CDN 时 usingCdn 为 false', String(s.usingCdn()));

  // ---- 3. OSS + CDN：返回固定直链 ----
  s = load({ STORAGE_DRIVER: 'oss', CDN_DOMAIN: 'cdn.example.com', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'demo-bucket', OSS_ACCESS_KEY_ID: 'fake-id', OSS_ACCESS_KEY_SECRET: 'fake-secret' });
  t(s.usingCdn() === true, '配置 CDN 后 usingCdn 为 true', String(s.usingCdn()));
  u = await s.getUrl(KEY);
  t(u === 'https://cdn.example.com/videos/202610/demo.mp4', '配置 CDN 后返回固定 CDN 直链', u);
  const u2 = await s.getUrl(KEY);
  t(u === u2, 'CDN 直链稳定不变（可被缓存）', u + ' vs ' + u2);
  u = await s.getUrl(KEY, '第01讲讲义.pdf');
  t(u.includes('aliyuncs.com') && u.includes('Signature='), '下载（带文件名）仍走签名 URL 以设置附件头', u.slice(0, 80));

  // ---- 4. CDN_DOMAIN 容错：带协议头/尾斜杠也能识别 ----
  s = load({ STORAGE_DRIVER: 'oss', CDN_DOMAIN: 'https://cdn.example.com/', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'demo-bucket', OSS_ACCESS_KEY_ID: 'fake-id', OSS_ACCESS_KEY_SECRET: 'fake-secret' });
  u = await s.getUrl(KEY);
  t(u === 'https://cdn.example.com/videos/202610/demo.mp4', 'CDN 域名带 https:// 和尾斜杠也能正确拼接', u);

  // ---- 5. 七牛：初始化与配置容错 ----
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: '', QINIU_SECRET_KEY: '', QINIU_BUCKET: '', QINIU_DOMAIN: '' });
  t(s.isQiniu() === false && s.DRIVER === 'qiniu', '七牛缺少配置时回退本地存储且启动不崩溃', 'isQiniu=' + s.isQiniu());

  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'http://cdn-qiniu.example.com/' });
  t(s.isQiniu() === true, '七牛客户端初始化成功', 'isQiniu=' + s.isQiniu());
  t(s.getQiniuDomain() === 'cdn-qiniu.example.com', '外链域名自动去掉协议头和尾斜杠', s.getQiniuDomain());

  // ---- 6. 七牛：私有空间签名 URL ----
  u = await s.getUrl(KEY);
  t(u.startsWith('https://cdn-qiniu.example.com/videos/202610/demo.mp4?e=') && u.includes('&token=fake-ak:'), '私有空间返回带 token 的签名播放 URL', u.slice(0, 80));
  const t1 = Number((u.match(/[?&]e=(\d+)/) || [])[1]);
  t(t1 > Math.floor(Date.now() / 1000) + 3500, '签名有效期约 1 小时', 'deadline=' + t1);
  const signPart = (u.split('token=fake-ak:')[1] || '');
  t(/^[A-Za-z0-9_-]+=*$/.test(signPart.trim()), '签名为 URL 安全 Base64（官方算法一致，含 = 补位）', signPart);
  const u2q = await s.getUrl(KEY, '测试.pdf');
  t(u2q.includes('attname=') && u2q.includes('&token=fake-ak:'), '带 attname 的 URL 也能正确签名', u2q.slice(0, 100));

  // ---- 7. 七牛：下载带中文名（attname 需在签名之前附加） ----
  u = await s.getUrl(KEY, '第01讲讲义.pdf');
  t(/attname=%E7%AC%AC01%E8%AE%B2%E8%AE%B2%E4%B9%89\.pdf/.test(u), '下载 URL 带 attname 参数（URL 编码的中文名）', decodeURIComponent(u).slice(0, 100));
  t(u.includes('token='), 'attname 附加后再签名（签名覆盖 attname）', u.slice(-40));

  // ---- 8. 七牛：公开空间模式 ----
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com', QINIU_PRIVATE: '0' });
  u = await s.getUrl(KEY);
  t(u === 'https://cdn-qiniu.example.com/videos/202610/demo.mp4', '公开空间返回无签名直链（可被 CDN 缓存）', u);

  // ---- 9. 七牛分流（默认 QINIU_FOLDERS=videos）：视频上云、讲义留本地 ----
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com' });
  t(s.isQiniu() === true, '七牛分流模式客户端初始化成功', 'isQiniu=' + s.isQiniu());
  t(s.QINIU_FOLDERS.join(',') === 'videos,guides', 'QINIU_FOLDERS 默认为 videos,guides', s.QINIU_FOLDERS.join(','));
  t(s.isCloudKey('guides/202610/demo.mp4') === true && s.isCloudKey('guidedocs/202610/a.pdf') === false, '使用说明视频上云、文档留本地', '');
  t(s.isCloudKey('videos/202610/demo.mp4') === true, '视频 key 判定为云端', String(s.isCloudKey('videos/202610/demo.mp4')));
  t(s.isCloudKey('handouts/202610/a.pdf') === false, '讲义 key 判定为本地', String(s.isCloudKey('handouts/202610/a.pdf')));
  u = await s.getUrl('videos/202610/demo.mp4');
  t(u.startsWith('https://cdn-qiniu.example.com/videos/') && u.includes('token='), '视频 URL 仍走七牛签名外链', u.slice(0, 80));
  u = await s.getUrl('handouts/202610/a.pdf');
  t(u.startsWith('/api/file?key=handouts%2F'), '讲义 URL 走本地代理地址', u);
  {
    const saved = await s.saveFile(Buffer.from('讲义内容'), '第一章.pdf', 'handouts');
    t(saved.key.startsWith('handouts/') && require('fs').existsSync(s.localPath(saved.key)), '分流模式下讲义保存到服务器本地磁盘', saved.key);
    await s.deleteFile(saved.key);
    t(!require('fs').existsSync(s.localPath(saved.key)), '分流模式下删除讲义删的是本地文件', saved.key);
  }

  // ---- 10. 七牛分流：多目录与全量上云 ----
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com', QINIU_FOLDERS: 'videos,audios' });
  t(s.isCloudKey('audios/202610/x.mp3') === true && s.isCloudKey('handouts/a.pdf') === false, 'QINIU_FOLDERS 支持逗号分隔多目录', s.QINIU_FOLDERS.join(','));
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com', QINIU_FOLDERS: '*' });
  t(s.isCloudKey('handouts/a.pdf') === true, 'QINIU_FOLDERS=* 时全部上云', String(s.isCloudKey('handouts/a.pdf')));
  u = await s.getUrl('handouts/a.pdf');
  t(u.startsWith('https://cdn-qiniu.example.com/handouts/'), '全量上云时讲义 URL 也走七牛', u.slice(0, 80));
  t(s.driverName() === '七牛云 Kodo', '全量上云时驱动名不带分流说明', s.driverName());
  s = load({ STORAGE_DRIVER: 'qiniu', CDN_DOMAIN: '', QINIU_ACCESS_KEY: 'fake-ak', QINIU_SECRET_KEY: 'fake-sk', QINIU_BUCKET: 'demo-bucket', QINIU_DOMAIN: 'cdn-qiniu.example.com' });
  t(s.driverName().includes('仅 videos、guides 上云'), '分流模式驱动名带说明', s.driverName());

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main();
