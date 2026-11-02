'use strict';
/**
 * AI 客户端（T2）：全站唯一一个"发请求给大模型"的地方。
 *
 *   chat({ role, messages | (system, user), images, json, maxTokens, temperature, timeoutMs })
 *     → { text, model, via, format }
 *
 * 配置来源：后台「设置 → AI 配置中心」里的模型档案（表 mf_model_profiles，一条档案 = 一个接口）。
 * 档案有 `format` 字段决定协议，支持三种：
 *   openai     OpenAI 兼容  POST {base}/chat/completions   （OpenAI、通义、DeepSeek、智谱、Moonshot、各类中转…）
 *   anthropic  Anthropic    POST {base}/v1/messages
 *   gemini     Google Gemini POST {base}/v1beta/models/{model}:generateContent
 * 选档案：同角色已启用的 → 没有就按角色回落到别的已启用档案 → 都没有才回落 builtin-config.js 里写死的那份（OpenAI 兼容）。
 * 密钥明文存库（与现状一致）；图片一律以 base64 内联，各协议用各自的图片内容块格式。
 */
const http = require('http');
const https = require('https');
const { db } = require('./db');
const BUILTIN = require('./builtin-config');

const FORMATS = ['openai', 'anthropic', 'gemini'];
const FORMAT_NAMES = { openai: 'OpenAI 兼容', anthropic: 'Anthropic Messages', gemini: 'Google Gemini' };
/** 接口地址的填写提示（后台表单按格式显示；不绑定任何厂商，只是各协议官方文档里的标准写法） */
const FORMAT_HINTS = {
  openai: { base_url: 'https://你的服务商/v1', note: '填到 /v1 为止，系统会自动补 /chat/completions。通义、DeepSeek、智谱、Moonshot、OpenAI 等都属于这一类。' },
  anthropic: { base_url: 'https://api.anthropic.com', note: '填到域名为止，系统会自动补 /v1/messages（填了 /v1 也行）。' },
  gemini: { base_url: 'https://generativelanguage.googleapis.com', note: '填到域名为止，系统会自动补 /v1beta/models/{模型名}:generateContent。' },
};
const ANTHROPIC_VERSION = '2023-06-01';

/** 角色回落顺序：本角色没有启用的档案时，按这个顺序找别的已启用档案（让"只配一个模型"也能全站通用） */
const ROLE_FALLBACK = {
  vision: ['vision', 'reasoning', 'light'],
  reasoning: ['reasoning', 'light', 'vision'],
  light: ['light', 'reasoning', 'vision'],
};

const normFormat = (f) => (FORMATS.includes(String(f || '').trim()) ? String(f).trim() : 'openai');
const trimBase = (u) => String(u || '').trim().replace(/\/+$/, '');

/** 最小 http/https 客户端：返回 { status, text } ；超时抛 name='AbortError' */
function httpRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('接口地址无效：' + url)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('接口地址要以 http:// 或 https:// 开头'));
    const lib = u.protocol === 'http:' ? http : https;
    const h = Object.assign({}, headers);
    if (body != null && h['Content-Length'] === undefined) h['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(u, { method, headers: h, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, text: buf.toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/** 取档案：role 对应已启用的；没有按 ROLE_FALLBACK 找；再没有返回 null（调用方回落内置配置） */
function pickProfile(role) {
  let rows;
  try { rows = db.prepare('SELECT * FROM mf_model_profiles WHERE is_enabled=1 ORDER BY id').all(); } catch (e) { return null; }
  if (!rows.length) return null;
  const order = ROLE_FALLBACK[role] || ROLE_FALLBACK.reasoning;
  for (const r of order) {
    const p = rows.find((x) => x.role === r);
    if (p) return p;
  }
  return null;   // 只启用了向量 / 专用档案：不适合对话，回落内置
}

/** 统一成一份"可调用的配置"：{ format, base, model, key, via, profileId } */
function resolve(role) {
  const p = pickProfile(role);
  if (p) {
    return { format: normFormat(p.format), base: trimBase(p.base_url), model: String(p.model || ''), key: String(p.api_key || ''), via: p.name, profileId: p.id, role: p.role, builtin: false };
  }
  const b = BUILTIN.ai || {};
  return { format: 'openai', base: trimBase(b.baseUrl), model: String(b.model || ''), key: String(b.apiKey || '').trim(), via: 'builtin', profileId: 0, role: '', builtin: true };
}

// ---------------------------------------------------------------- 入参整理
/** images 里每一项可以是 {buf, mime}、data:URL 字符串或纯 base64 字符串 → { mime, b64 } */
function normImage(im) {
  if (!im) return null;
  if (typeof im === 'string') {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(im);
    if (m) return { mime: m[1], b64: m[2] };
    return { mime: 'image/jpeg', b64: im };
  }
  if (im.b64) return { mime: im.mime || 'image/jpeg', b64: String(im.b64) };
  if (im.buf) return { mime: im.mime || 'image/jpeg', b64: Buffer.from(im.buf).toString('base64') };
  return null;
}

/** 整理成 { system, turns:[{role:'user'|'assistant', text}], images:[{mime,b64}] }；图片挂在最后一条 user 消息上 */
function prepare({ messages, system, user, images }) {
  let sys = system ? String(system) : '';
  const turns = [];
  if (Array.isArray(messages) && messages.length) {
    messages.forEach((m) => {
      const text = Array.isArray(m.content) ? m.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n') : String(m.content == null ? '' : m.content);
      if (m.role === 'system') sys = sys ? sys + '\n' + text : text;
      else turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text });
    });
  } else {
    turns.push({ role: 'user', text: String(user == null ? '' : user) });
  }
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', text: '请按要求输出。' });
  const imgs = (Array.isArray(images) ? images : []).map(normImage).filter(Boolean);
  return { system: sys, turns, images: imgs };
}

// ---------------------------------------------------------------- 三种协议：构造请求 / 解析响应
const BUILDERS = {
  openai(cfg, p, o) {
    const messages = [];
    if (p.system) messages.push({ role: 'system', content: p.system });
    p.turns.forEach((t, i) => {
      const last = i === p.turns.length - 1;
      if (last && p.images.length && t.role === 'user') {
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: t.text || '请按要求输出。' }]
            .concat(p.images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.b64}` } }))),
        });
      } else messages.push({ role: t.role, content: t.text });
    });
    const body = { model: cfg.model, messages, temperature: o.temperature };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    if (o.json) body.response_format = { type: 'json_object' };
    return {
      url: cfg.base + '/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body,
    };
  },
  anthropic(cfg, p, o) {
    const base = cfg.base.replace(/\/v1$/, '');
    const messages = p.turns.map((t, i) => {
      const last = i === p.turns.length - 1;
      if (last && p.images.length && t.role === 'user') {
        return {
          role: 'user',
          content: p.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }))
            .concat([{ type: 'text', text: t.text || '请按要求输出。' }]),
        };
      }
      return { role: t.role, content: t.text };
    });
    const sys = o.json ? ((p.system ? p.system + '\n' : '') + '只输出一个合法的 JSON 对象，不要任何其它文字。') : p.system;
    const body = { model: cfg.model, max_tokens: o.maxTokens || 4096, messages, temperature: o.temperature };
    if (sys) body.system = sys;
    return {
      url: base + '/v1/messages',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': ANTHROPIC_VERSION },
      body,
    };
  },
  gemini(cfg, p, o) {
    const base = cfg.base.replace(/\/v1(beta)?$/, '');
    const contents = p.turns.map((t, i) => {
      const last = i === p.turns.length - 1;
      const parts = [{ text: t.text || '请按要求输出。' }];
      if (last && p.images.length && t.role === 'user') p.images.forEach((im) => parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } }));
      return { role: t.role === 'assistant' ? 'model' : 'user', parts };
    });
    const generationConfig = { temperature: o.temperature };
    if (o.maxTokens) generationConfig.maxOutputTokens = o.maxTokens;
    if (o.json) generationConfig.responseMimeType = 'application/json';
    const body = { contents, generationConfig };
    if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
    return {
      url: `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body,
    };
  },
};

const PARSERS = {
  openai(j) {
    const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.text || '')).join('');
    return String(c || '');
  },
  anthropic(j) {
    return (Array.isArray(j && j.content) ? j.content : []).filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  },
  gemini(j) {
    const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    return (Array.isArray(parts) ? parts : []).map((x) => x.text || '').join('');
  },
};

/** 把各种失败翻译成学校老师看得懂的话 */
function httpError(status, bodyText, cfg) {
  const snippet = String(bodyText || '').replace(/\s+/g, ' ').slice(0, 200);
  let why = '';
  if (status === 401 || status === 403) why = '密钥无效或没有权限，请检查 API Key';
  else if (status === 404) why = '接口地址或模型名不对（404），请检查「接口地址」和「模型名」，以及格式是否选对';
  else if (status === 429) why = '请求太频繁或额度用完（429）';
  else if (status >= 500) why = '服务商那边出错了（' + status + '），稍后再试';
  else if (status === 400) why = '请求被服务商拒绝（400），常见原因：模型名写错、该模型不支持图片输入';
  return new Error(`AI 接口返回 ${status}${why ? '：' + why : ''}${snippet ? '（' + snippet + '）' : ''}`);
}

function netError(e, cfg, timeoutMs) {
  if (e && e.name === 'AbortError') return new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
  const m = String((e && e.message) || e);
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return new Error(`无法连接 AI 接口：找不到服务器（${cfg.base}），请检查接口地址是否写对`);
  if (/ECONNREFUSED/.test(m)) return new Error(`无法连接 AI 接口：${cfg.base} 拒绝连接，请检查地址和端口`);
  if (/certificate|SSL|TLS/i.test(m)) return new Error('无法连接 AI 接口：证书校验失败 —— ' + m);
  return new Error('无法连接 AI 接口：' + m);
}

/** 对一份已解析的配置发一次请求（chat / testProfile 共用） */
async function callWith(cfg, input, { timeoutMs = 180000 } = {}) {
  if (!cfg.base) throw new Error('还没有填写接口地址');
  if (!cfg.model) throw new Error('还没有填写模型名');
  if (!cfg.key) throw new Error('还没有写上 AI 密钥');
  const o = {
    json: !!input.json,
    maxTokens: Number(input.maxTokens) || 0,
    temperature: input.temperature === undefined ? 0.3 : input.temperature,
  };
  const req = BUILDERS[cfg.format](cfg, prepare(input), o);
  let res;
  try {
    res = await httpRequest(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), timeoutMs });
  } catch (e) { throw netError(e, cfg, timeoutMs); }
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.text, cfg);
  let j;
  try { j = JSON.parse(res.text); } catch (e) { throw new Error('AI 接口返回的不是 JSON —— 检查接口地址是否填对（' + String(res.text).slice(0, 80).replace(/\s+/g, ' ') + '）'); }
  const text = PARSERS[cfg.format](j);
  if (!text) throw new Error('AI 返回内容为空');
  return { text: String(text), model: cfg.model, via: cfg.via, format: cfg.format };
}

/** 对外：按角色选档案并调用。入参见文件头；images 支持 {buf,mime} / data:URL / 纯 base64 */
async function chat(input = {}) {
  const cfg = resolve(input.role || 'reasoning');
  return callWith(cfg, input, { timeoutMs: input.timeoutMs || 180000 });
}

/** 测试连接：用给定的（可以是还没保存的）档案内容发一条最小请求，错误地址会给出明确原因 */
async function testProfile(prof) {
  const role = String(prof.role || 'reasoning');
  const cfg = { format: normFormat(prof.format), base: trimBase(prof.base_url), model: String(prof.model || '').trim(), key: String(prof.api_key || '').trim(), via: String(prof.name || '') };
  const t0 = Date.now();
  if (role === 'embedding') {
    if (cfg.format !== 'openai') throw new Error('向量角色目前只支持 OpenAI 兼容格式');
    if (!cfg.base || !cfg.model || !cfg.key) throw new Error('接口地址 / 模型名 / 密钥都要填');
    let res;
    try {
      res = await httpRequest(cfg.base + '/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ model: cfg.model, input: '连通性测试' }), timeoutMs: 45000 });
    } catch (e) { throw netError(e, cfg, 45000); }
    if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.text, cfg);
    return { ms: Date.now() - t0, snippet: '向量返回正常' };
  }
  const r = await callWith(cfg, { user: '只回复两个字：可用', maxTokens: 20, temperature: 0 }, { timeoutMs: 45000 });
  return { ms: Date.now() - t0, snippet: String(r.text).slice(0, 40) };
}

/** 拉取模型列表（三种格式各自的列表接口） */
async function listModels({ format, base_url, api_key }) {
  const f = normFormat(format);
  const base = trimBase(base_url);
  if (!/^https?:\/\//i.test(base)) throw new Error('接口地址不合法（要以 http(s):// 开头）');
  const key = String(api_key || '').trim();
  let url; let headers;
  if (f === 'anthropic') { url = base.replace(/\/v1$/, '') + '/v1/models?limit=100'; headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }; }
  else if (f === 'gemini') { url = base.replace(/\/v1(beta)?$/, '') + '/v1beta/models?pageSize=100'; headers = { 'x-goog-api-key': key }; }
  else { url = base + '/models'; headers = { Authorization: `Bearer ${key}` }; }
  let res;
  try { res = await httpRequest(url, { method: 'GET', headers, timeoutMs: 20000 }); } catch (e) { throw netError(e, { base }, 20000); }
  if (res.status !== 200) throw httpError(res.status, res.text, { base });
  let j;
  try { j = JSON.parse(res.text); } catch (e) { throw new Error('返回的不是 JSON —— 检查接口地址是否填对'); }
  const arr = Array.isArray(j.data) ? j.data : (Array.isArray(j.models) ? j.models : []);
  return arr.map((m) => (typeof m === 'string' ? m : String(m.id || m.name || '').replace(/^models\//, ''))).filter(Boolean).sort();
}

module.exports = { chat, testProfile, listModels, resolve, pickProfile, FORMATS, FORMAT_NAMES, FORMAT_HINTS, normFormat, httpRequest, ROLE_FALLBACK };
