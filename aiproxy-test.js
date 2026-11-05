'use strict';
// 必要回归：本地 HTTP/CONNECT 代理、NO_PROXY、TLS 校验及流式取消。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

if (process.argv[2] !== 'worker') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhilexue-aiproxy-'));
  try {
    for (const host of ['model.test', 'untrusted.test']) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=' + host, '-addext', 'subjectAltName=DNS:' + host, '-keyout', path.join(dir, host + '.key'), '-out', path.join(dir, host + '.crt')], { stdio: 'ignore' });
    }
    const child = spawnSync(process.execPath, [__filename, 'worker', dir], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, 'model.test.crt') }, stdio: 'inherit',
    });
    if (child.error) throw child.error;
    if (child.signal) throw new Error('代理测试进程被信号中断：' + child.signal);
    process.exitCode = child.status == null ? 1 : child.status;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
} else {
  const http = require('http'); const https = require('https'); const net = require('net'); const dns = require('dns');
  const dir = process.argv[3];
  const environment = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'npm_config_http_proxy', 'npm_config_https_proxy', 'npm_config_no_proxy', 'npm_config_proxy'];
  environment.forEach((k) => { delete process.env[k]; });
  let modelPort = 0; let untrustedPort = 0; let proxyRequests = 0; let proxyConnects = 0; let cfg;
  const dbPath = require.resolve('./src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: { prepare: () => ({ all: () => [cfg] }) } } };
  const { httpRequest, chatStream } = require('./src/ai-client');
  const { agentForAiRequest, isLoopback } = require('./src/ai-proxy');
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  function model(req, res) {
    let body = ''; req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const data = body ? JSON.parse(body) : {};
      if (data.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n');
        const cancel = JSON.stringify(data).includes('取消测试');
        const t = setTimeout(() => { if (!res.destroyed) { res.write('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n'); res.end('data: [DONE]\n\n'); } }, cancel ? 1000 : 25);
        res.on('close', () => clearTimeout(t));
      } else json(res, { choices: [{ message: { content: '代理请求成功' } }] });
    });
  }
  const good = https.createServer({ key: fs.readFileSync(path.join(dir, 'model.test.key')), cert: fs.readFileSync(path.join(dir, 'model.test.crt')) }, model);
  const bad = https.createServer({ key: fs.readFileSync(path.join(dir, 'untrusted.test.key')), cert: fs.readFileSync(path.join(dir, 'untrusted.test.crt')) }, model);
  const direct = http.createServer(model);
  const proxy = http.createServer((req, res) => { proxyRequests++; model(req, res); });
  proxy.on('connect', (req, client, head) => {
    proxyConnects++;
    if (req.url.startsWith('stall.test:')) { setTimeout(() => client.destroy(), 250); return; }
    const port = req.url.startsWith('untrusted.test:') ? untrustedPort : modelPort;
    const upstream = net.connect(port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  (async () => {
    try {
      modelPort = await listen(good); untrustedPort = await listen(bad);
      const directPort = await listen(direct), proxyPort = await listen(proxy);
      const proxyUrl = `http://127.0.0.1:${proxyPort}`;
      cfg = { id: 1, is_enabled: 1, role: 'reasoning', name: 'local-test', format: 'openai', base_url: 'http://model.test:8080/v1', model: 'test', api_key: 'test-key' };
      process.env.HTTP_PROXY = proxyUrl; process.env.HTTPS_PROXY = proxyUrl;
      const httpResult = await httpRequest('http://model.test:8080/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.strictEqual(httpResult.status, 200); assert.strictEqual(proxyRequests, 1);
      const deltas = [];
      const streamed = await chatStream({ user: '测试' }, (x) => deltas.push(x));
      assert.strictEqual(streamed.streamed, true); assert.deepStrictEqual(deltas, ['第一段', '第二段']); assert.strictEqual(proxyRequests, 2);
      const controller = new AbortController();
      await assert.rejects(chatStream({ user: '取消测试' }, () => controller.abort(), { signal: controller.signal }), (e) => e.canceled === true);
      const httpsResult = await httpRequest(`https://model.test:${modelPort}/v1/chat/completions`, { method: 'POST', body: '{}' });
      assert.strictEqual(httpsResult.status, 200); assert.ok(proxyConnects > 0);
      await assert.rejects(httpRequest(`https://untrusted.test:${untrustedPort}/`, { method: 'POST', body: '{}' }), (e) => /certificate|self.signed/i.test(e.message));
      await assert.rejects(httpRequest('https://stall.test:443/', { method: 'POST', body: '{}', timeoutMs: 60 }), (e) => e.name === 'AbortError');
      cfg.base_url = 'https://stall.test/v1';
      const pendingController = new AbortController();
      setTimeout(() => pendingController.abort(), 30);
      await assert.rejects(chatStream({ user: '等待代理' }, () => {}, { signal: pendingController.signal }), (e) => e.canceled === true);
      const before = proxyRequests;
      await httpRequest(`http://127.0.0.1:${directPort}/`, { method: 'POST', body: '{}' });
      assert.strictEqual(proxyRequests, before, '回环地址必须直连');
      assert.ok(isLoopback('localhost') && isLoopback('[::1]') && isLoopback('::ffff:7f00:1'));
      const originalLookup = dns.lookup;
      dns.lookup = function (hostname, options, callback) {
        if (hostname === 'bypass.test') {
          if (typeof options === 'function') { callback = options; options = {}; }
          return process.nextTick(() => options && options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
        }
        return originalLookup.call(this, hostname, options, callback);
      };
      try {
        process.env.NO_PROXY = 'bypass.test,.allowed.test';
        await httpRequest(`http://bypass.test:${directPort}/`, { method: 'POST', body: '{}' });
        assert.strictEqual(proxyRequests, before, 'NO_PROXY 必须直连');
        assert.strictEqual(agentForAiRequest('https://child.allowed.test/'), undefined);
        assert.ok(agentForAiRequest('https://unrelated.test/'));
      } finally { dns.lookup = originalLookup; }
      process.env.NO_PROXY = '*'; assert.strictEqual(agentForAiRequest('https://model.test/'), undefined);
      environment.forEach((k) => { delete process.env[k]; });
      assert.strictEqual(agentForAiRequest('https://model.test/'), undefined);
      console.log('AI 普通与流式代理、取消、NO_PROXY、回环直连及 TLS 证书校验通过');
    } catch (e) { console.error('代理验证失败：' + e.stack); process.exitCode = 1; }
    finally { [good, bad, direct, proxy].forEach((server) => server.close()); }
  })().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
