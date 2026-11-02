'use strict';
/**
 * AI 配置中心（T2）自测： node aiclient-test.js
 * 需先启动服务（默认 http://localhost:3000）并 npm run seed；直连同一个 MySQL。全程只访问本机起的模拟 AI 服务，不会调用任何真实 AI 接口。
 *
 *   A. 三种格式（OpenAI 兼容 / Anthropic Messages / Google Gemini）各起一个模拟服务，核对请求路径、鉴权头、系统提示、图片内容块、JSON 模式、响应解析
 *   B. 错误提示：密钥错 / 地址错 / 连不上 / 返回不是 JSON / 空内容，各给出明确原因
 *   C. 后台档案接口：新增（选格式）→ 测试连接（对错误地址明确报错）→ 启用（未测通不能启用）→ 同角色排他
 *   D. 配一个模拟接口并启用后，学情报告 / AI 补全 / 拍照识别三处都能用；切换档案后三处同时生效；没配对应角色时回落到别的已启用档案
 */
const http = require('http');
// 本测试自己控制走不走"演示模式"：必须关掉，否则不会发请求
delete process.env.AI_MOCK;
const { db } = require('./src/db');
const ai = require('./src/ai');
const aiClient = require('./src/ai-client');
const mf = require('./src/mfcollect');

const BASE = process.env.BASE || 'http://localhost:3000';
const MFX = '/api/admin/bank/mf/ext';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

/** 模拟 AI 服务：按路径判断是哪种格式，记下最近一次请求，按 mode 回复 */
function startMock(name) {
  const m = { name, calls: [], mode: 'ok', reply: { text: '可用' }, server: null, url: '' };
  m.server = http.createServer((rq, rs) => {
    const chunks = [];
    rq.on('data', (c) => chunks.push(c));
    rq.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { /* GET */ }
      const call = { method: rq.method, path: rq.url.split('?')[0], headers: rq.headers, body };
      m.calls.push(call);
      const send = (code, obj) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (m.mode === 'auth') return send(401, { error: { message: 'invalid api key' } });
      if (m.mode === 'notfound') return send(404, { error: 'no such model' });
      if (m.mode === 'html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end('<html>hello</html>'); }
      if (m.mode === 'empty') return send(200, { choices: [{ message: { content: '' } }], content: [], candidates: [] });
      const text = typeof m.reply === 'function' ? m.reply(call) : m.reply.text;
      if (call.method === 'GET') {
        if (call.path.endsWith('/models')) return send(200, call.path.startsWith('/v1beta') ? { models: [{ name: 'models/gem-a' }, { name: 'models/gem-b' }] } : { data: [{ id: name + '-m2' }, { id: name + '-m1' }] });
      }
      if (call.path.endsWith('/chat/completions')) return send(200, { choices: [{ message: { content: text } }] });
      if (call.path.endsWith('/v1/messages')) return send(200, { content: [{ type: 'text', text }] });
      if (/:generateContent$/.test(call.path)) return send(200, { candidates: [{ content: { parts: [{ text }] } }] });
      return send(404, { error: 'unknown path ' + call.path });
    });
  });
  return new Promise((resolve) => m.server.listen(0, '127.0.0.1', () => { m.port = m.server.address().port; m.root = `http://127.0.0.1:${m.port}`; resolve(m); }));
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const created = [];
const snapshot = db.prepare('SELECT id, is_enabled FROM mf_model_profiles').all();
function cleanup() {
  created.forEach((id) => { try { db.prepare('DELETE FROM mf_model_profiles WHERE id=?').run(id); } catch (e) { /* ignore */ } });
  snapshot.forEach((r) => { try { db.prepare('UPDATE mf_model_profiles SET is_enabled=? WHERE id=?').run(r.is_enabled, r.id); } catch (e) { /* ignore */ } });
}

(async () => {
  console.log('\n=== AI 配置中心（T2）· 自测 ===\n');
  db.prepare('UPDATE mf_model_profiles SET is_enabled=0').run();   // 测试期间先停用已有档案，结束后恢复
  const oa = await startMock('oa'), an = await startMock('an'), ge = await startMock('ge');
  const servers = [oa, an, ge];
  try {
    // ---------- A. 三种格式的请求 ----------
    console.log('A. 三种格式');
    const b64 = png.toString('base64');
    oa.reply = { text: '{"ok":true}' };
    let r = await aiClient.testProfile({ role: 'reasoning', format: 'openai', base_url: oa.root + '/v1', model: 'oa-model', api_key: 'KEY-OA' });
    log(oa.calls.length === 1 && oa.calls[0].path === '/v1/chat/completions' && oa.calls[0].headers.authorization === 'Bearer KEY-OA', 'OpenAI 兼容：POST {base}/chat/completions + Bearer 密钥', oa.calls[0] && oa.calls[0].path);
    // chat() 通过 DB 里启用的档案取配置，所以先建档案再调用
    const mk = (role, fmt, m, base, model = 'm-' + fmt, key = 'K-' + fmt) => {
      const id = db.prepare(`INSERT INTO mf_model_profiles (role,name,provider,base_url,model,api_key,capability,format,is_enabled,last_test_ok,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,1,'2026-11-02','2026-11-02')`)
        .run(role, `T2测试·${role}·${fmt}`, 't2', base, model, key, role === 'vision' ? 'vision' : '', fmt).lastInsertRowid;
      created.push(id); return id;
    };
    const enable = (id) => { const p = db.prepare('SELECT role FROM mf_model_profiles WHERE id=?').get(id); db.prepare('UPDATE mf_model_profiles SET is_enabled=0 WHERE role=?').run(p.role); db.prepare('UPDATE mf_model_profiles SET is_enabled=1 WHERE id=?').run(id); };
    const pOa = mk('reasoning', 'openai', oa, oa.root + '/v1', 'oa-model', 'KEY-OA');
    enable(pOa);
    const o1 = await aiClient.chat({ role: 'reasoning', system: 'SYS', user: '你好', images: [{ buf: png, mime: 'image/png' }], json: true, maxTokens: 123, temperature: 0.1 });
    const c1 = oa.calls[oa.calls.length - 1];
    const msgs = c1.body.messages;
    log(o1.text === '{"ok":true}' && o1.format === 'openai' && c1.body.model === 'oa-model' && c1.body.max_tokens === 123 && c1.body.temperature === 0.1, 'OpenAI：模型名 / max_tokens / temperature 原样传', JSON.stringify({ m: c1.body.model, t: c1.body.max_tokens }));
    log(msgs[0].role === 'system' && msgs[0].content === 'SYS' && Array.isArray(msgs[1].content), 'OpenAI：system 消息 + user 内容块数组');
    log(msgs[1].content.some((x) => x.type === 'image_url' && x.image_url.url === `data:image/png;base64,${b64}`) && msgs[1].content.some((x) => x.type === 'text' && x.text === '你好'), 'OpenAI：图片用 image_url 的 data URL 内容块');
    log(c1.body.response_format && c1.body.response_format.type === 'json_object', 'OpenAI：json=true → response_format json_object');
    await aiClient.chat({ role: 'reasoning', user: '纯文字' });
    const c1b = oa.calls[oa.calls.length - 1];
    log(typeof c1b.body.messages[0].content === 'string' && !c1b.body.response_format && c1b.body.max_tokens === undefined, 'OpenAI：纯文字时 content 是字符串，不带 json / max_tokens 参数');

    // Anthropic（base 填域名；另一个档案 base 带 /v1 也要对）
    an.reply = { text: 'anthropic 回复' };
    const pAn = mk('reasoning', 'anthropic', an, an.root, 'an-model', 'KEY-AN');
    enable(pAn);
    const a1 = await aiClient.chat({ role: 'reasoning', system: 'SYS-AN', user: '你好', images: [{ buf: png, mime: 'image/png' }], maxTokens: 77, temperature: 0.2 });
    const ca = an.calls[an.calls.length - 1];
    log(a1.text === 'anthropic 回复' && a1.format === 'anthropic' && ca.path === '/v1/messages' && ca.headers['x-api-key'] === 'KEY-AN' && ca.headers['anthropic-version'] === '2023-06-01' && !ca.headers.authorization, 'Anthropic：POST /v1/messages + x-api-key + anthropic-version（不发 Bearer）', ca.path);
    log(ca.body.system === 'SYS-AN' && ca.body.max_tokens === 77 && ca.body.model === 'an-model' && ca.body.messages.every((m) => m.role !== 'system'), 'Anthropic：system 是顶层字段，max_tokens 必填并传入');
    const ac = ca.body.messages[0].content;
    log(ac[0].type === 'image' && ac[0].source.type === 'base64' && ac[0].source.media_type === 'image/png' && ac[0].source.data === b64 && ac[1].type === 'text' && ac[1].text === '你好', 'Anthropic：图片用 image 内容块（source.type=base64 + media_type + data），文字在后');
    await aiClient.chat({ role: 'reasoning', user: '无 max_tokens' });
    log(an.calls[an.calls.length - 1].body.max_tokens > 0, 'Anthropic：没指定 max_tokens 时自动补默认值（接口要求必填）');
    db.prepare('UPDATE mf_model_profiles SET base_url=? WHERE id=?').run(an.root + '/v1', pAn);
    await aiClient.chat({ role: 'reasoning', user: 'x' });
    log(an.calls[an.calls.length - 1].path === '/v1/messages', 'Anthropic：接口地址填了 /v1 也不会变成 /v1/v1/messages');
    await aiClient.chat({ role: 'reasoning', user: 'x', json: true });
    log(/JSON/.test(an.calls[an.calls.length - 1].body.system), 'Anthropic：json=true → 在 system 里要求只输出 JSON（该协议没有 JSON 模式开关）');

    // Gemini
    ge.reply = { text: 'gemini 回复' };
    const pGe = mk('reasoning', 'gemini', ge, ge.root, 'gem-model', 'KEY-GE');
    enable(pGe);
    const g1 = await aiClient.chat({ role: 'reasoning', system: 'SYS-GE', user: '你好', images: [{ buf: png, mime: 'image/png' }], json: true, maxTokens: 55, temperature: 0.4 });
    const cg = ge.calls[ge.calls.length - 1];
    log(g1.text === 'gemini 回复' && g1.format === 'gemini' && cg.path === '/v1beta/models/gem-model:generateContent' && cg.headers['x-goog-api-key'] === 'KEY-GE', 'Gemini：POST /v1beta/models/{模型}:generateContent + x-goog-api-key', cg.path);
    log(cg.body.systemInstruction.parts[0].text === 'SYS-GE' && cg.body.generationConfig.maxOutputTokens === 55 && cg.body.generationConfig.temperature === 0.4 && cg.body.generationConfig.responseMimeType === 'application/json', 'Gemini：systemInstruction / generationConfig（maxOutputTokens、temperature、JSON MIME）');
    const gp = cg.body.contents[0].parts;
    log(cg.body.contents[0].role === 'user' && gp[0].text === '你好' && gp[1].inline_data.mime_type === 'image/png' && gp[1].inline_data.data === b64, 'Gemini：图片用 inline_data（mime_type + base64）part');
    log(!/key=/.test(cg.path), 'Gemini：密钥放请求头，不拼进 URL（避免进日志）');

    // 多轮 messages 入参
    await aiClient.chat({ role: 'reasoning', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }] });
    const cm = ge.calls[ge.calls.length - 1].body;
    log(cm.contents.length === 3 && cm.contents[1].role === 'model' && cm.systemInstruction.parts[0].text === 'S', 'messages 入参：system 抽成系统提示，assistant 在 Gemini 里转成 model 角色');

    // ---------- B. 错误提示 ----------
    console.log('B. 错误提示');
    const t = (extra, mode, fmt = 'openai', base) => { oa.mode = mode || 'ok'; return aiClient.testProfile(Object.assign({ role: 'reasoning', format: fmt, base_url: base || oa.root + '/v1', model: 'x', api_key: 'k' }, extra)).then(() => null, (e) => e.message); };
    let msg = await t({}, 'auth');
    log(/401/.test(msg) && /密钥/.test(msg), '密钥错（401）：提示检查 API Key', msg);
    msg = await t({}, 'notfound');
    log(/404/.test(msg) && /接口地址或模型名/.test(msg), '地址 / 模型错（404）：提示检查接口地址、模型名、格式', msg);
    msg = await t({}, 'html');
    log(/不是 JSON/.test(msg), '返回网页而不是 JSON：提示接口地址可能不对', msg);
    msg = await t({}, 'empty');
    log(/内容为空/.test(msg), '返回空内容：明确报"AI 返回内容为空"', msg);
    msg = await t({ base_url: 'http://127.0.0.1:1/v1' });
    log(/拒绝连接/.test(msg), '连不上（端口没服务）：明确报"拒绝连接"并带地址', msg);
    msg = await t({ base_url: 'http://这个域名不存在.invalid/v1' });
    log(/找不到服务器|无法连接/.test(msg), '域名不存在：明确报"找不到服务器"', msg);
    msg = await t({ base_url: 'ftp://x/v1' });
    log(/http/.test(msg), '地址不是 http(s)：提示', msg);
    msg = await t({ api_key: '' });
    log(/密钥/.test(msg), '没填密钥：提示', msg);
    msg = await t({ model: '' });
    log(/模型名/.test(msg), '没填模型名：提示', msg);
    oa.mode = 'ok';
    const models = await aiClient.listModels({ format: 'openai', base_url: oa.root + '/v1', api_key: 'k' });
    const gmodels = await aiClient.listModels({ format: 'gemini', base_url: ge.root, api_key: 'k' });
    log(models.join() === 'oa-m1,oa-m2' && gmodels.join() === 'gem-a,gem-b', '拉取模型列表：OpenAI 走 /models，Gemini 走 /v1beta/models（去掉 models/ 前缀）', models.join() + ' | ' + gmodels.join());

    // ---------- C. 后台档案接口 ----------
    console.log('C. 后台档案接口');
    db.prepare('DELETE FROM mf_model_profiles WHERE id IN (' + created.map(() => '?').join(',') + ')').run(...created); created.length = 0;
    const AT = (await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } })).data.token;
    const list0 = await req(MFX + '/profiles', { token: AT });
    log(list0.code === 0 && list0.data.formats.map((f) => f.key).join() === 'openai,anthropic,gemini' && list0.data.formats.every((f) => f.hint && f.hint.base_url), '档案列表带格式清单和每种格式的接口地址提示', list0.data.formats.map((f) => f.hint.base_url).join(' | '));
    const bad = await req(MFX + '/profiles', { method: 'POST', token: AT, body: { role: 'reasoning', name: 'x', format: 'foo', base_url: oa.root + '/v1', model: 'm', api_key: 'k' } });
    log(bad.code !== 0 && /格式/.test(bad.msg), '格式不合法（foo）被拒', bad.msg);
    const badUrl = await req(MFX + '/profiles', { method: 'POST', token: AT, body: { role: 'reasoning', name: 'x', format: 'openai', base_url: 'abc', model: 'm', api_key: 'k' } });
    log(badUrl.code !== 0 && /http/.test(badUrl.msg), '接口地址不是 http(s) 开头被拒', badUrl.msg);
    const mkApi = async (role, format, mock, model, key) => {
      const r = await req(MFX + '/profiles', { method: 'POST', token: AT, body: { role, name: `T2测试·${role}·${format}`, provider: 't2', format, base_url: format === 'openai' ? mock.root + '/v1' : mock.root, model, api_key: key } });
      if (r.data && r.data.id) created.push(r.data.id);
      return r;
    };
    const cOa = await mkApi('reasoning', 'openai', oa, 'oa-model', 'KEY-OA');
    const old = await req(MFX + '/profiles', { method: 'POST', token: AT, body: { role: 'light', name: 'T2测试·默认格式', base_url: oa.root + '/v1', model: 'm', api_key: 'k' } });
    if (old.data && old.data.id) created.push(old.data.id);
    const got = (await req(MFX + '/profiles', { token: AT })).data.list;
    log(cOa.code === 0 && got.find((p) => p.id === cOa.data.id).format === 'openai', '新增档案（选格式 openai）');
    log(old.code === 0 && got.find((p) => p.id === old.data.id).format === 'openai', '不传 format 的旧式请求 → 默认 openai（旧数据不受影响）');
    const noEn = await req(`${MFX}/profiles/${cOa.data.id}/enable`, { method: 'POST', token: AT });
    log(noEn.code !== 0 && /测连通|测通/.test(noEn.msg), '没测通不能启用', noEn.msg);
    const tOk = await req(`${MFX}/profiles/${cOa.data.id}/test`, { method: 'POST', token: AT });
    log(tOk.code === 0 && /连接成功/.test(tOk.msg), '测试连接（模拟 OpenAI 服务）成功', tOk.msg);
    // 先把档案的地址改成错的，再测：必须明确报错，且测通状态被清掉
    const put = await req(`${MFX}/profiles/${cOa.data.id}`, { method: 'PUT', token: AT, body: { base_url: 'http://127.0.0.1:1/v1' } });
    const tBad = await req(`${MFX}/profiles/${cOa.data.id}/test`, { method: 'POST', token: AT });
    log(put.code === 0 && tBad.code !== 0 && /拒绝连接|测试失败/.test(tBad.msg) && /127\.0\.0\.1:1/.test(tBad.msg), '测试连接对错误地址给出明确报错（带地址）', tBad.msg);
    await req(`${MFX}/profiles/${cOa.data.id}`, { method: 'PUT', token: AT, body: { base_url: oa.root + '/v1' } });
    const d1 = await req(MFX + '/profiles/test-draft', { method: 'POST', token: AT, body: { role: 'reasoning', format: 'openai', base_url: 'http://127.0.0.1:1/v1', model: 'm', api_key: 'k' } });
    log(d1.code !== 0 && /拒绝连接/.test(d1.msg), '新增表单里的"测试连接"（还没保存）：错误地址 → 明确报错', d1.msg);
    const d2 = await req(MFX + '/profiles/test-draft', { method: 'POST', token: AT, body: { role: 'reasoning', format: 'anthropic', base_url: an.root, model: 'm', api_key: 'k' } });
    log(d2.code === 0 && /连接成功/.test(d2.msg), '新增表单里的"测试连接"：Anthropic 格式（模拟服务）连通');
    const d3 = await req(MFX + '/profiles/test-draft', { method: 'POST', token: AT, body: { role: 'reasoning', format: 'gemini', base_url: ge.root, model: 'gem-model', api_key: 'k' } });
    log(d3.code === 0 && /连接成功/.test(d3.msg), '新增表单里的"测试连接"：Gemini 格式（模拟服务）连通');
    const d4 = await req(MFX + '/profiles/test-draft', { method: 'POST', token: AT, body: { role: 'reasoning', format: 'openai', base_url: oa.root + '/v1', model: 'm', api_key: 'k' } });
    oa.mode = 'auth';
    const d5 = await req(MFX + '/profiles/test-draft', { method: 'POST', token: AT, body: { role: 'reasoning', format: 'openai', base_url: oa.root + '/v1', model: 'm', api_key: 'bad' } });
    oa.mode = 'ok';
    log(d4.code === 0 && d5.code !== 0 && /密钥/.test(d5.msg), '测试连接：密钥错 → 提示检查 API Key', d5.msg);
    const mdl = await req(MFX + '/profiles/models', { method: 'POST', token: AT, body: { format: 'gemini', base_url: ge.root, api_key: 'k' } });
    log(mdl.code === 0 && mdl.data.models.join() === 'gem-a,gem-b', '拉取模型列表（Gemini 格式）');
    const stuTok = db.prepare("SELECT username FROM users WHERE role='student' LIMIT 1").get();
    const sl = await req('/api/login', { method: 'POST', body: { username: stuTok.username, password: '123456', role: 'student' } });
    if (sl.data) { const f = await req(MFX + '/profiles', { token: sl.data.token }); log(f.code !== 0, '学生 token 不能读 / 改 AI 档案'); }

    // ---------- D. 三处功能 + 切换 ----------
    console.log('D. 学情报告 / AI 补全 / 拍照识别 + 切换档案');
    created.forEach((id) => db.prepare('DELETE FROM mf_model_profiles WHERE id=?').run(id)); created.length = 0;
    const REPORT = { meta: { grade: '五年级', subject: '数学', date: '2026.11.2', paperTitle: 'T2模拟试卷', totalQuestions: 2, totalKnowledge: 1 }, overall: { correctRate: 0.5, correct: 1, wrong: 1, summary: '模拟', difficultyComment: '' } };
    const SEG = { questions: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.2, no: 1, stem: '模拟第一题' }] };
    const reply = (tag) => (call) => {
      const sys = JSON.stringify(call.body || '');
      if (/学情诊断报告/.test(sys)) return JSON.stringify(REPORT).replace('T2模拟试卷', 'T2模拟试卷@' + tag);
      if (/切分成一道道独立的题/.test(sys)) return JSON.stringify(SEG).replace('模拟第一题', '模拟第一题@' + tag);
      return '补全结果@' + tag;
    };
    oa.reply = reply('oa'); an.reply = reply('an'); ge.reply = reply('ge');
    oa.calls.length = 0; an.calls.length = 0; ge.calls.length = 0;
    const apiMk = async (role, fmt, m, model) => { const r = await mkApi(role, fmt, m, model, 'K-' + fmt); await req(`${MFX}/profiles/${r.data.id}/test`, { method: 'POST', token: AT }); return r.data.id; };
    const en = async (id) => { const r = await req(`${MFX}/profiles/${id}/enable`, { method: 'POST', token: AT }); return r; };

    const three = async () => {
      const rep = await ai.analyzePaper({ images: [{ buf: png, mime: 'image/png' }] });
      const fill = await mf.mfAiInvoke({ role: 'light', system: 'S', user: '补全这道题', maxTokens: 100 });
      const seg = await ai.segmentPage({ buf: png, mime: 'image/png' });
      return { rep, fill, seg };
    };
    // 先全部没启用 → 内置配置（不实际调用，只看 getConfig）
    log(ai.getConfig().via === 'builtin', '一个档案都没启用：回落内置配置（与改版前一致）', ai.getConfig().via);

    // 只配一个 openai 档案（角色 reasoning）→ 三处都能用（vision / light 回落到它）
    const idOa = await apiMk('reasoning', 'openai', oa, 'oa-model');
    log((await en(idOa)).code === 0, '启用 OpenAI 兼容档案（模拟服务）');
    let x = await three();
    log(x.rep.report.meta.paperTitle === 'T2模拟试卷@oa' && x.seg.questions[0].stem === '模拟第一题@oa' && x.fill.text === '补全结果@oa', '三处都走到这个档案：学情报告 / AI 补全 / 拍照识别整页识别', `${x.rep.report.meta.paperTitle} | ${x.fill.text} | ${x.seg.questions[0].stem}`);
    const vcall = oa.calls.find((c) => /学情诊断报告/.test(JSON.stringify(c.body)));
    log(vcall && vcall.body.messages[1].content.some((p) => p.type === 'image_url'), '学情报告的试卷图片按 OpenAI 格式（image_url）送出');
    log(ai.getConfig().via.includes('openai') && ai.getConfig('vision').format === 'openai', 'ai.getConfig() 读的是"当前启用的档案"', JSON.stringify(ai.getConfig()));

    // 再配一个 anthropic 档案作为 reasoning 的新选择并启用 → 三处同时切过去
    const idAn = await apiMk('reasoning', 'anthropic', an, 'an-model');
    await en(idAn);
    oa.calls.length = 0; an.calls.length = 0;
    x = await three();
    log(x.rep.report.meta.paperTitle === 'T2模拟试卷@an' && x.seg.questions[0].stem === '模拟第一题@an' && x.fill.text === '补全结果@an', '切换到 Anthropic 档案后三处同时生效', `${x.rep.report.meta.paperTitle} | ${x.fill.text} | ${x.seg.questions[0].stem}`);
    log(oa.calls.length === 0 && an.calls.length === 3 && an.calls.every((c) => c.path === '/v1/messages'), '旧档案不再收到请求，新档案收到 3 次 /v1/messages', `oa=${oa.calls.length} an=${an.calls.length}`);
    const ac2 = an.calls.find((c) => /学情诊断报告/.test(JSON.stringify(c.body)));
    log(ac2 && ac2.body.messages[0].content.some((p) => p.type === 'image'), '学情报告的试卷图片按 Anthropic 格式（image 内容块）送出');

    // 视觉角色单独配一个 gemini 档案 → 视觉类（学情报告 / 拍照识别）走它，文字类仍走 reasoning
    const idGe = await apiMk('vision', 'gemini', ge, 'gem-model');
    await en(idGe);
    oa.calls.length = 0; an.calls.length = 0; ge.calls.length = 0;
    x = await three();
    log(x.rep.report.meta.paperTitle === 'T2模拟试卷@ge' && x.seg.questions[0].stem === '模拟第一题@ge' && x.fill.text === '补全结果@an', '视觉角色配了 Gemini：看图的两处走 Gemini，文字补全仍走 Anthropic', `${x.rep.report.meta.paperTitle} | ${x.fill.text}`);
    log(ge.calls.length === 2 && ge.calls.every((c) => /:generateContent$/.test(c.path) && c.body.contents[0].parts.some((p) => p.inline_data)), 'Gemini 档案收到 2 次 generateContent，且都带 inline_data 图片');

    // 停用 → 回落
    db.prepare('UPDATE mf_model_profiles SET is_enabled=0').run();
    log(ai.getConfig().via === 'builtin' && ai.getConfig().hasKey === true, '全部停用后回落内置配置');
    // 同角色排他
    await en(idOa); await en(idAn);
    const enabledReasoning = db.prepare("SELECT COUNT(*) n FROM mf_model_profiles WHERE role='reasoning' AND is_enabled=1").get().n;
    log(Number(enabledReasoning) === 1, '同一角色同时只有一个档案处于启用状态');
    // 演示模式优先
    process.env.AI_MOCK = '1';
    const mockRep = await ai.analyzePaper({ images: [{ buf: png, mime: 'image/png' }] });
    const calls0 = an.calls.length;
    log(/mock/.test(mockRep.model) && an.calls.length === calls0, 'AI_MOCK=1（演示模式）仍优先：不发请求，返回示例报告');
    delete process.env.AI_MOCK;
  } finally {
    servers.forEach((m) => m.server.close());
    cleanup();
  }
  const left = db.prepare("SELECT COUNT(*) n FROM mf_model_profiles WHERE name LIKE 'T2测试%'").get().n;
  log(Number(left) === 0, '测试档案已清理，原有档案启用状态已恢复');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
