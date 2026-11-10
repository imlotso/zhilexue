'use strict';
// 题图抓取：仅连接 DNS 解析出的公网 IPv4，固定目标地址；每次跳转重新校验。
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 6000;
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168) return false;
  if (a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return false;
  return true;
}
function imageType(buf) {
  if (!Buffer.isBuffer(buf)) return '';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && ['GIF87a','GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return '';
}
function validUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch (_) { throw new Error('图片网址无效'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname || u.hostname.includes('%')) throw new Error('只支持公网 HTTP(S) 图片网址');
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) throw new Error('图片网址端口不受支持');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) === 6) throw new Error('暂不支持 IPv6 图片网址');
  return u;
}
function createDownloader(deps = {}) {
  const lookup = deps.lookup || ((host) => dns.lookup(host, { all: true, verbatim: true }));
  const request = deps.request || ((url, ip, callback) => {
    const transport = url.protocol === 'https:' ? https : http;
    return transport.request({ protocol: url.protocol, hostname: ip, port: url.port || undefined, method: 'GET',
      path: url.pathname + url.search, headers: { Host: url.host, Accept: 'image/png,image/jpeg,image/gif,image/webp' },
      servername: url.hostname, rejectUnauthorized: true, agent: false }, callback);
  });
  async function fetchOne(value, redirects, previousProtocol) {
    const u = validUrl(value);
    if (previousProtocol === 'https:' && u.protocol !== 'https:') throw new Error('不允许图片链接从 HTTPS 跳转到 HTTP');
    const host = u.hostname;
    let addresses;
    try {
      if (net.isIP(host) === 4) addresses = [{ address: host, family: 4 }];
      else {
        let timer;
        try { addresses = await Promise.race([lookup(host), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 3000); })]); }
        finally { clearTimeout(timer); }
      }
    }
    catch (_) { throw new Error('图片域名解析失败'); }
    if (!Array.isArray(addresses) || !addresses.length) throw new Error('图片域名没有可用地址');
    const ipv4 = addresses.filter((x) => net.isIP(x.address) === 4);
    if (!ipv4.length) throw new Error('暂不支持仅 IPv6 的图片主机');
    if (ipv4.some((x) => !publicIPv4(x.address))) throw new Error('图片地址不是公网地址');
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); if (err) reject(err); else resolve(result); };
      let req;
      try {
        req = request(u, ipv4[0].address, (res) => {
          const status = Number(res.statusCode) || 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.resume();
            if (!res.headers.location) return finish(new Error('图片跳转缺少目标地址'));
            return finish(null, { redirect: res.headers.location });
          }
          if (status !== 200) { res.resume(); return finish(new Error('图片服务器返回状态 ' + status)); }
          const mime = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
          if (!allowed[mime]) { res.resume(); return finish(new Error('图片格式不受支持')); }
          const size = Number(res.headers['content-length']);
          if (Number.isFinite(size) && size > MAX_BYTES) { res.resume(); return finish(new Error('图片超过 5 MB')); }
          const chunks = []; let total = 0;
          res.on('data', (chunk) => { total += chunk.length; if (total > MAX_BYTES) { res.destroy(); finish(new Error('图片超过 5 MB')); } else chunks.push(chunk); });
          res.on('error', () => finish(new Error('图片读取失败')));
          res.on('end', () => { const buf = Buffer.concat(chunks); const ext = imageType(buf); if (!ext || ext !== allowed[mime]) return finish(new Error('图片内容与类型不符')); finish(null, { buf, ext }); });
        });
        req.on('error', () => finish(new Error('图片连接失败')));
        timer = setTimeout(() => { req.destroy(); finish(new Error('图片下载超时')); }, TIMEOUT_MS);
        req.end();
      } catch (_) { finish(new Error('图片连接失败')); }
    });
    if (result.redirect) {
      if (redirects >= MAX_REDIRECTS) throw new Error('图片跳转次数过多');
      let next; try { next = new URL(result.redirect, u).href; } catch (_) { throw new Error('图片跳转地址无效'); }
      return fetchOne(next, redirects + 1, u.protocol);
    }
    return result;
  }
  return (url) => fetchOne(url, 0, '');
}
module.exports = { createDownloader, publicIPv4, imageType, validUrl, MAX_BYTES };
