'use strict';

// AI 请求的代理选择局部生效，不改变全局 HTTP Agent 或其他业务流量。
const net = require('net');
const { getProxyForUrl } = require('proxy-from-env');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

function isLoopback(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (net.isIP(host) === 4) return host.split('.')[0] === '127';
  // URL 会将 IPv4 映射地址规范化为十六进制形式，如 ::ffff:7f00:1。
  return net.isIP(host) === 6 && /^::ffff:7f[0-9a-f]{2}:/.test(host);
}

function agentForAiRequest(target) {
  const url = target instanceof URL ? target : new URL(target);
  if (isLoopback(url.hostname)) return undefined;
  const proxy = getProxyForUrl(url.href);
  if (!proxy) return undefined; // 包含 NO_PROXY、未配置代理等情形
  let parsed;
  try { parsed = new URL(proxy); } catch (e) { throw new Error('AI 代理地址无效，请检查 HTTP_PROXY / HTTPS_PROXY 配置'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('AI 代理地址须使用 http:// 或 https://');
  // 默认 TLS 校验保持开启；Node 的系统信任链和 NODE_EXTRA_CA_CERTS 正常生效。
  return url.protocol === 'https:' ? new HttpsProxyAgent(parsed) : new HttpProxyAgent(parsed);
}

module.exports = { agentForAiRequest, isLoopback };
