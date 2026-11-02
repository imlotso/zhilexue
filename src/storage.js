'use strict';
/**
 * 存储抽象层
 * STORAGE_DRIVER = local（默认，文件存服务器磁盘） | oss（阿里云对象存储） | qiniu（七牛云对象存储）
 *
 * 本地 ：文件落在 data/uploads/<folder>/<年月>/<随机名>.<ext>，key 为相对路径
 * OSS  ：文件上传到 bucket，key 为 OSS 对象名；下载时生成带签名的临时 URL
 * 七牛 ：同 OSS；私有空间签名下载 URL（attname 指定下载文件名），QINIU_DOMAIN 为外链域名
 *        支持分流：QINIU_FOLDERS（默认 videos）指定哪些目录上七牛，其余仍存服务器本地磁盘
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('./db');
const BUILTIN = require('./builtin-config');

const DRIVER = process.env.STORAGE_DRIVER || 'oss';

// 可选：CDN 加速域名（如 cdn.example.com）。配置后，在线播放/预览返回固定的 CDN 直链，
// 这样才能被 CDN 缓存（签名 URL 每次都不同，缓存命中率恒为 0）。
// 注意：启用 CDN 域名时，OSS Bucket 需设为「公共读」，防盗链改由 CDN 的 Referer 白名单承担。
const CDN_DOMAIN = String(process.env.CDN_DOMAIN || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\/+$/, '');

// ---------------- 阿里云 OSS ----------------
let ossClient = null;
if (DRIVER === 'oss') {
  try {
    const OSS = require('ali-oss');
    ossClient = new OSS({
      region: process.env.OSS_REGION || BUILTIN.oss.region,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || BUILTIN.oss.accessKeyId,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || BUILTIN.oss.accessKeySecret,
      bucket: process.env.OSS_BUCKET || BUILTIN.oss.bucket,
      endpoint: process.env.OSS_ENDPOINT || undefined,
      secure: true,
      // 默认 60 秒。视频传到 OSS 超过这个时间会报 Response timeout for 60000ms
      timeout: 600000,
    });
  } catch (e) {
    console.error('[storage] 阿里云 OSS 初始化失败，回退为本地存储：', e.message);
  }
}

// ---------------- 七牛云 Kodo ----------------
// 需要环境变量：QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET
// QINIU_DOMAIN：七牛空间绑定的外链域名（测试域名 30 天会回收，正式使用必须绑已备案域名）
// QINIU_PRIVATE：1 = 私有空间（播放地址带签名，默认）；0 = 公开空间（直接拼接外链）
// QINIU_UPLOAD_HOST：可选，上传入口域名（默认自动按区域）
// QINIU_FOLDERS：分流开关（逗号分隔目录名，默认 videos,guides）——只有列出的目录上七牛，
//   其余文件（如讲义 handouts、使用说明文档 guidedocs）仍存服务器本地磁盘；设为 * 表示全部上云。
let qiniuDomain = '';
let qiniuCtx = null;
const QINIU_FOLDERS = String(process.env.QINIU_FOLDERS === undefined ? 'videos,guides' : process.env.QINIU_FOLDERS)
  .split(',').map((s) => s.trim()).filter(Boolean);
if (DRIVER === 'qiniu') {
  try {
    const qiniu = require('qiniu');
    const ak = process.env.QINIU_ACCESS_KEY;
    const sk = process.env.QINIU_SECRET_KEY;
    const bucket = process.env.QINIU_BUCKET;
    const domain = String(process.env.QINIU_DOMAIN || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    if (!ak || !sk || !bucket || !domain) {
      throw new Error('缺少 QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET / QINIU_DOMAIN 配置');
    }
    qiniuDomain = domain;
    const mac = new qiniu.auth.digest.Mac(ak, sk);
    const config = new qiniu.conf.Config();
    if (process.env.QINIU_ZONE) config.zone = qiniu.zone[process.env.QINIU_ZONE]; // 如 Zone_z0/z1/z2/Zone_na0
    qiniuCtx = {
      qiniu,
      mac,
      config,
      bucket,
      domain,
      private: process.env.QINIU_PRIVATE !== '0', // 默认私有
      uploader: new qiniu.form_up.FormUploader(config),
      bucketMgr: new qiniu.rs.BucketManager(mac, config),
      uploadHost: process.env.QINIU_UPLOAD_HOST || undefined,
    };
  } catch (e) {
    console.error('[storage] 七牛云初始化失败，回退为本地存储：', e.message);
  }
}

function extOf(name) {
  const raw = path.extname(name || '').toLowerCase().replace('.', '');
  // 只接受纯 ASCII 字母数字扩展名（1-8 位）。中文 / 特殊字符扩展名一律丢弃：
  // 否则生成的存储键会带上奇怪字符，既影响下载接口的白名单校验，也可能被用来构造畸形路径。
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : '';
}

/** key 的首段目录名，如 videos/202610/x.mp4 -> videos */
function folderOf(key) {
  return String(key || '').split('/')[0];
}

// 始终留在服务器本地的目录：错题图片与错题集 PDF（生成 PDF 要读原始字节，且属于管理端内部产物）、
// 使用说明的文档（小文件，直接本地读取）、wrong 错题快照。
// ⚠️ phonics 讲义 PDF 已上云（2026-10-25）：大 PDF 走服务器小带宽下载极慢，改走 OSS/CDN；
//    历史文件已用迁移脚本传到 OSS 同 key。需要改可配置 LOCAL_FOLDERS，逗号分隔；设为空字符串则关闭该规则。
// 需要改可配置 LOCAL_FOLDERS，逗号分隔；设为空字符串则关闭该规则。
const LOCAL_FOLDERS = String(process.env.LOCAL_FOLDERS === undefined ? 'wrong,guidedocs' : process.env.LOCAL_FOLDERS)
  .split(',').map((s) => s.trim()).filter(Boolean);

// ---------------- 题库资源的独立存储口子（T12） ----------------
// 题目的图片 / 音频 / 导入附件统一放在 bank/ 目录（bankFolder()，见 mfbank.js），视频放 videos/，两类资源只靠 key 前缀区分。
// BANK_BUCKET：可选，将来想把题库资源迁到另一个 Bucket 时填它的名字；缺省为空 = 与视频同一个 Bucket（现状）。
// 本次只留口子、不做多 Bucket 切换：bucketFor(key) 告诉调用方"这个 key 该去哪个桶"（空串 = 默认桶），
// 真要拆桶时只需要在 saveFile / getUrlSync / deleteFile 里按它选 client（见 README「题库资源独立存储」）。
const BANK_BUCKET = String(process.env.BANK_BUCKET || '').trim();
const BANK_PREFIX = String(process.env.BANK_FOLDER || 'bank').trim().replace(/^\/+|\/+$/g, '') || 'bank';
/** key 是否属于题库资源（bank/ 目录；目录名可由 settings.bank_folder 改，改了之后调用方传入 prefix） */
function isBankKey(key, prefix) {
  const p = String(prefix || BANK_PREFIX);
  return typeof key === 'string' && key.startsWith(p + '/') && !key.includes('..');
}
/** 该 key 应该放进哪个 Bucket：题库资源且配了 BANK_BUCKET → 它；否则空串（默认桶） */
function bucketFor(key, prefix) {
  return BANK_BUCKET && isBankKey(key, prefix) ? BANK_BUCKET : '';
}

/** 该 key 是否存到七牛（未启用七牛恒为 false；启用后按 QINIU_FOLDERS 分流） */
function qiniuCovers(key) {
  if (!qiniuCtx) return false;
  const f = folderOf(key);
  if (LOCAL_FOLDERS.includes(f)) return false;
  return QINIU_FOLDERS.includes('*') || QINIU_FOLDERS.includes(f);
}

// 常见文件的 MIME 类型（七牛按此设置响应 Content-Type，浏览器才能在线播放/预览）
const MIME = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  zip: 'application/zip',
};

function putPolicy(key) {
  const qn = qiniuCtx.qiniu;
  // insertOnly=1：只允许新建，防止覆盖已有文件；mimeLimit 放宽（会讲义/视频多类型）
  const policy = new qn.rs.PutPolicy({
    scope: `${qiniuCtx.bucket}:${key}`, // 指定 key 上传
    insertOnly: 1,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    returnBody: '{"key":"$(key)","size":$(fsize)}',
  });
  return policy.uploadToken();
}

const VIDEO_KEY_RE = /^videos\/\d{6}\/[a-f0-9]{16}\.[a-z0-9]{1,8}$/;
const VIDEO_MAX = 4 * 1024 * 1024 * 1024;
/** 分片签名有效期。3G 要传很久，签太短会传到一半过期。每个分片临上传前再签一次。 */
const VIDEO_PART_EXPIRES = 6 * 60 * 60;
let corsReady = null;
function ensureOssCors() {
  if (!ossClient) return Promise.resolve();
  if (!corsReady) {
    corsReady = ossClient.putBucketCORS(ossClient.options.bucket, [{
      allowedOrigin: ['https://zhilexue.top', 'https://www.zhilexue.top', 'http://zhilexue.top', 'http://www.zhilexue.top', 'http://localhost:3000', 'http://127.0.0.1:3000'],
      allowedMethod: ['GET', 'POST', 'PUT', 'HEAD', 'DELETE'],
      allowedHeader: '*',
      exposeHeader: ['ETag', 'x-oss-request-id'],
      maxAgeSeconds: '600',
    }]).catch((e) => {
      corsReady = null;
      console.error('[storage] 设置 OSS 跨域失败：', (e && e.message) || e);
    });
  }
  return corsReady;
}
function isVideoKey(key) {
  return VIDEO_KEY_RE.test(String(key || ''));
}
async function initVideoUpload(originalName, size) {
  if (!ossClient) throw new Error('未启用阿里云存储');
  await ensureOssCors();
  const n = Number(size) || 0;
  if (n <= 0) throw new Error('文件是空的');
  if (n > VIDEO_MAX) throw new Error('单个视频不能超过 4GB');
  const key = buildKey('videos', originalName || 'video.mp4');
  const mime = MIME[extOf(originalName)] || 'application/octet-stream';
  const r = await ossClient.initMultipartUpload(key, { mime, timeout: 120000 });
  return { key, uploadId: r.uploadId, partExpires: VIDEO_PART_EXPIRES };
}
function signVideoPart(key, uploadId, partNumber) {
  if (!ossClient) throw new Error('未启用阿里云存储');
  if (!isVideoKey(key)) throw new Error('视频文件无效');
  const n = Number(partNumber);
  if (!uploadId || !Number.isInteger(n) || n < 1 || n > 10000) throw new Error('分片参数无效');
  const url = ossClient.signatureUrl(key, {
    method: 'PUT',
    expires: VIDEO_PART_EXPIRES,
    'Content-Type': 'application/octet-stream',
    subResource: { partNumber: String(n), uploadId: String(uploadId) },
  });
  return { url, expires: VIDEO_PART_EXPIRES };
}
async function completeVideoUpload(key, uploadId, parts) {
  if (!ossClient) throw new Error('未启用阿里云存储');
  if (!isVideoKey(key) || !uploadId) throw new Error('视频文件无效');
  const list = (Array.isArray(parts) ? parts : []).map((p) => ({
    number: Number(p.number),
    etag: String(p.etag || ''),
  })).filter((p) => p.number > 0 && p.etag);
  if (!list.length) throw new Error('没有上传分片');
  await ossClient.completeMultipartUpload(key, String(uploadId), list, { timeout: 120000 });
}
async function abortVideoUpload(key, uploadId) {
  if (!ossClient || !isVideoKey(key) || !uploadId) return;
  try { await ossClient.abortMultipartUpload(key, String(uploadId)); } catch (e) { /* 已取消或不存在 */ }
}
async function videoExists(key) {
  if (!ossClient || !isVideoKey(key)) return false;
  try { await ossClient.head(key); return true; } catch (e) { return false; }
}

function buildKey(folder, originalName) {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rand = crypto.randomBytes(8).toString('hex');
  const ext = extOf(originalName);
  return `${folder}/${ym}/${rand}${ext ? '.' + ext : ''}`;
}

/** 保存文件，返回 { key, size } */
/**
 * 保存文件。
 * @param {Buffer|string} source 文件内容 Buffer，或本地临时文件的绝对路径。
 *        大文件（视频）请传路径：本地驱动走 rename、云端驱动走流式上传，
 *        不会把整个文件读进内存（否则 2G 内存的服务器传 1G 视频会直接崩）。
 * @param {string} originalName 原始文件名（决定扩展名与下载名）
 * @param {string} folder 存储目录（videos / handouts / guides / wrong …）
 */
async function saveFile(source, originalName, folder = 'misc') {
  const key = buildKey(folder, originalName);
  const fromPath = typeof source === 'string';
  const size = fromPath ? fs.statSync(source).size : source.length;
  if (qiniuCtx && qiniuCovers(key)) {
    const token = putPolicy(key);
    const putExtra = new qiniuCtx.qiniu.form_up.PutExtra();
    putExtra.mimeType = MIME[extOf(originalName)] || 'application/octet-stream';
    const body = fromPath ? fs.createReadStream(source) : require('stream').Readable.from(source);
    const ret = await new Promise((resolve, reject) => {
      qiniuCtx.uploader.put(token, key, body, putExtra, (err, respBody, info) => {
        if (err) return reject(err);
        if (info.statusCode !== 200) return reject(new Error(`七牛上传失败 HTTP ${info.statusCode}: ${JSON.stringify(respBody)}`));
        resolve(respBody);
      });
    });
    return { key: ret.key || key, size: ret.size || size };
  }
  if (ossClient && !LOCAL_FOLDERS.includes(folderOf(key))) {
    const mime = MIME[extOf(originalName)] || 'application/octet-stream';
    const opts = { mime, timeout: 600000 };
    // 大文件分片上传，避免整段一次传完卡在 60 秒限制上
    if (fromPath && size > 8 * 1024 * 1024) await ossClient.multipartUpload(key, source, opts);
    else await ossClient.put(key, fromPath ? fs.createReadStream(source) : source, opts);
    return { key, size };
  }
  const abs = path.join(UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fromPath) {
    try { fs.renameSync(source, abs); }                 // 同一磁盘：直接改路径，大文件也不用复制
    catch (e) { fs.copyFileSync(source, abs); try { fs.unlinkSync(source); } catch (e2) { /* 临时文件清不掉不影响结果 */ } }
  } else fs.writeFileSync(abs, source);
  return { key, size };
}

/** 本地磁盘绝对路径（仅 local 驱动有效） */
function localPath(key) {
  return path.join(UPLOAD_DIR, key);
}

/**
 * 删除本地文件：带重试兜底。
 * Windows 上新建的文件可能被杀软/索引程序短暂占用（EPERM/EBUSY），
 * 直接 unlink 会失败——原实现把异常吞掉，导致「接口返回已删除、磁盘还留着」。
 * 这里改为重试 + 改名兜底，并把最终失败打到 stderr，便于排查。
 */
function unlinkLocal(abs, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      if (!fs.existsSync(abs)) return true;
      fs.unlinkSync(abs);
      if (!fs.existsSync(abs)) return true;
    } catch (e) {
      if (i === tries - 1) {
        // 最后再试一次「先改名、再删除」：改名不受占用影响，能保证文件不再被业务读到
        try {
          const bak = abs + '.deleted-' + Date.now();
          fs.renameSync(abs, bak);
          try { fs.unlinkSync(bak); } catch (e2) { /* 残留 .deleted-* 文件不影响业务 */ }
          return true;
        } catch (e2) {
          console.error('[storage] 删除本地文件失败：' + abs + ' -> ' + (e.code || e.message) + ' / ' + (e2.code || e2.message));
          return false;
        }
      }
      // 忙等一会儿再重试（同步 sleep，仅在极短的删除路径里使用）
      const until = Date.now() + 40 * (i + 1);
      while (Date.now() < until) { /* busy wait */ }
    }
  }
  return true;
}

/** 读出文件内容。云端没有时再看本地（旧文件可能还在磁盘上）。 */
async function readBuffer(key) {
  if (!key) return null;
  if (ossClient) {
    try {
      const r = await ossClient.get(key);
      if (r && r.content) return r.content;
    } catch (e) { /* 对象不在桶里 */ }
  }
  const abs = localPath(key);
  if (fs.existsSync(abs)) return fs.readFileSync(abs);
  return null;
}

/** 删除文件 */
async function deleteFile(key) {
  if (!key) return;
  if (qiniuCovers(key)) {
    try {
      await new Promise((resolve) => qiniuCtx.bucketMgr.delete(qiniuCtx.bucket, key, () => resolve()));
    } catch (e) { /* ignore */ }
    return;
  }
  if (ossClient && !LOCAL_FOLDERS.includes(folderOf(key))) {
    try { await ossClient.delete(key); } catch (e) { /* ignore */ }
    return;
  }
  unlinkLocal(localPath(key));
}

/** 生成可直接下载/播放的 URL（本地为后端代理地址，OSS/七牛为签名 URL，配了 CDN 则为 CDN 直链） */
/** 同步版：getUrl 里其实没有任何异步操作（签名 / 拼地址都是同步的），列表接口要给每道题带音频地址时用它 */
function getUrlSync(key, downloadName) {
  if (!key) return '';
  if (qiniuCovers(key)) {
    let base = `https://${qiniuCtx.domain}/${encodeURI(key)}`;
    if (downloadName) {
      // attname：七牛的强制下载文件名参数（需在签名前附加）
      base += `?attname=${encodeURIComponent(String(downloadName))}`;
    }
    if (qiniuCtx.private) {
      // 私有空间签名：与官方 privateDownloadUrl 算法一致，
      // 但支持带 attname 等查询参数的完整 URL（SDK 原生方法只接受 domain+fileName）
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 小时有效
      const url = base + (base.indexOf('?') >= 0 ? '&e=' : '?e=') + deadline;
      const sign = crypto.createHmac('sha1', qiniuCtx.mac.secretKey).update(url).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_');
      return `${url}&token=${qiniuCtx.mac.accessKey}:${sign}`;
    }
    return base;
  }
  if (ossClient) {
    // ① 配了 CDN 且是「在线播放/预览」→ 返回固定直链，交给 CDN 缓存和加速
    //    下载（要指定保存文件名）仍走签名 URL，因为 CDN 直链无法动态设置响应头
    if (CDN_DOMAIN && !downloadName) {
      return `https://${CDN_DOMAIN}/${encodeURI(key)}`;
    }
    let response;
    if (downloadName) {
      const name = String(downloadName);
      const ascii = name.replace(/[^\x20-\x7e]/g, '_');
      response = { 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}` };
    }
    return ossClient.signatureUrl(key, { expires: 3600, response });
  }
  const q = new URLSearchParams({ key });
  if (downloadName) q.set('name', downloadName);
  return `/api/file?${q.toString()}`;
}
async function getUrl(key, downloadName) { return getUrlSync(key, downloadName); }

function isOss() { return !!ossClient; }
function isQiniu() { return !!qiniuCtx; }

/** 当前是否走 CDN 分发（供启动日志/自检使用） */
function usingCdn() { return !!ossClient && !!CDN_DOMAIN; }

/** 七牛外链域名（未启用七牛时为空） */
function getQiniuDomain() { return qiniuDomain; }

/** 当前存储驱动的中文名（启动日志用） */
function driverName() {
  if (qiniuCtx) {
    return QINIU_FOLDERS.includes('*')
      ? '七牛云 Kodo'
      : '七牛云 Kodo（仅 ' + QINIU_FOLDERS.join('、') + ' 上云，其余存服务器本地）';
  }
  if (ossClient) return '阿里云 OSS';
  return '本地磁盘';
}

/** 该 key 是否存在云端（/api/file 据此决定重定向还是直接回本地文件） */
function isCloudKey(key) {
  if (LOCAL_FOLDERS.includes(folderOf(key))) return false;   // 本地目录（如 phonics 讲义）即使在云驱动下也走服务器磁盘
  if (ossClient) return true;
  return qiniuCovers(key);
}

module.exports = {
  saveFile, deleteFile, getUrl, getUrlSync, localPath, readBuffer,
  isOss, isQiniu, isCloudKey, usingCdn, driverName, getQiniuDomain,
  isVideoKey, initVideoUpload, signVideoPart, completeVideoUpload, abortVideoUpload, videoExists,
  DRIVER, CDN_DOMAIN, QINIU_FOLDERS, LOCAL_FOLDERS,
  BANK_BUCKET, isBankKey, bucketFor,
};
