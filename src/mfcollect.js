'use strict';
/**
 * 魔方助教复刻扩展（2026-10-29），挂在 mfbank 旁边：
 *   1. 五角色模型档案（R1 推理 / R2 OCR / R3 轻 / R4 向量 / R5 专用）+ AI 网关 mfAiInvoke
 *   2. 代理内嵌浏览器：/api/mfproxy（去 XFO/CSP、URL 重写、cookie 会话、注入采集脚本）
 *   3. 字典/树映射（采集来源同义值 → 标准码，可指认归位）
 *   4. 知识树采集导入（组卷网知识树页解析回传）
 *
 * 挂载（app.js）：
 *   admin.use('/bank/mf/ext', require('./mfcollect').admin);   // 常规管理端鉴权
 *   app.use('/api/mfproxy',   require('./mfcollect').proxy);   // 代理自鉴权（票据 k）
 *   app.use('/api/mfcap',     require('./mfcollect').cap);     // 采集票据回传（树导入）
 */
const express = require('express');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('./db');

const admin = express.Router();
const proxy = express.Router();
const cap = express.Router();

/** R0-B5：代理 iframe 去掉了 allow-same-origin，页面成了「不透明源」，它发给 /api/mfproxy 的 XHR/fetch 变成跨域请求，
 *  所以代理要放行 CORS。代理靠 URL 里的短票据 k 鉴权、不读 Cookie，因此只放 * 且不开 Allow-Credentials
 *  （注入脚本也会把站点请求的 credentials 强制改成 omit）。 */
proxy.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || 'Content-Type, X-MF-Ticket, X-MF-Referer, X-MF-CT'));
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 外站代理是可选辅助功能；默认使用老师本人浏览器和采集票据。
// 仅管理员明确设置环境变量后才启用代理，预检仍可正常返回。
function proxyEnabled() { return process.env.MF_PROXY_ENABLED === '1'; }
proxy.use((req, res, next) => {
  if (!proxyEnabled()) return res.status(403).json({ code: 403, msg: '辅助代理默认关闭，请使用浏览器书签采集；需要代理时由管理员设置 MF_PROXY_ENABLED=1。' });
  next();
});

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败', code = 1) => res.json({ code, msg });
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const aiClient = require('./ai-client');
const { pickTree } = require('./treepick');   // R2：按默认版本取树
const jstr = (v) => { try { return JSON.stringify(v == null ? [] : v); } catch (e) { return '[]'; } };

// ==================================================================== 建表（幂等）
function ensureSchema() {
  // 注意：MySQL 下 TEXT 列不能建索引/唯一约束，凡是要进索引/UNIQUE 的列一律 VARCHAR
  const stmts = [
    `CREATE TABLE IF NOT EXISTS mf_model_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role VARCHAR(32) NOT NULL,
      name VARCHAR(128) NOT NULL,
      provider VARCHAR(64) DEFAULT '',
      base_url VARCHAR(255) NOT NULL,
      model VARCHAR(128) NOT NULL,
      api_key VARCHAR(255) DEFAULT '',
      capability TEXT,
      is_enabled INTEGER DEFAULT 0,
      last_test_at VARCHAR(32),
      last_test_ok INTEGER,
      created_at VARCHAR(32),
      updated_at VARCHAR(32)
    )`,
    `CREATE TABLE IF NOT EXISTS mf_dict_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind VARCHAR(32) NOT NULL,
      code VARCHAR(64) NOT NULL,
      label VARCHAR(128) NOT NULL,
      site VARCHAR(32),
      source_label VARCHAR(128),
      active INTEGER DEFAULT 1,
      UNIQUE(kind, site, source_label)
    )`,
    `CREATE TABLE IF NOT EXISTS mf_tree_source_map (
      node_id INTEGER PRIMARY KEY,
      site VARCHAR(32),
      site_node_id VARCHAR(128),
      site_node_name VARCHAR(128)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_mfprof_role ON mf_model_profiles(role)',
    'CREATE INDEX IF NOT EXISTS idx_mfdict_kind ON mf_dict_entries(kind, code)',
  ];
  // T2：档案增加 format 列（openai / anthropic / gemini），旧数据默认 openai；幂等加列，只加不删
  stmts.push("ALTER TABLE mf_model_profiles ADD COLUMN format VARCHAR(16) DEFAULT 'openai'");
  stmts.forEach((s) => {
    try { db.exec(s); } catch (e) {
      if (e && (e.code === 'ER_DUP_KEYNAME' || e.errno === 1061)) return; // 索引已存在
      if (e && (e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060 || /duplicate column/i.test(String(e.message)))) return; // 列已存在
      console.error('[mfcollect] 建表失败:', s.slice(0, 60).replace(/\s+/g, ' '), '→', e.message);
    }
  });
  try { seedDict(); } catch (e) { console.error('[mfcollect] 字典预置失败:', e.message); }
}

// ==================================================================== 字典/树映射
/** 学科归一码 + 站点同义值预置（采集来源同义值 → 标准码） */
const DICT_SUBJECT_SEED = [
  // 归一行（site=NULL）：code + label
  null, ['math', '数学'], ['physics', '物理'], ['chemistry', '化学'], ['biology', '生物'],
  ['chinese', '语文'], ['english', '英语'], ['history', '历史'], ['geography', '地理'],
  ['politics', '政治'], ['morality-law', '道德与法治'], ['science', '科学'],
  ['info-tech', '信息技术'], ['general-tech', '通用技术'], ['japanese', '日语'],
  // 组卷网（zujuan）同义原文
  ['zujuan', '数学', '数学'], ['zujuan', '物理', '物理'], ['zujuan', '化学', '化学'],
  ['zujuan', '语文', '语文'], ['zujuan', '英语', '英语'], ['zujuan', '生物', '生物'],
  ['zujuan', '历史', '历史'], ['zujuan', '地理', '地理'], ['zujuan', '政治', '政治'],
  ['zujuan', '道德与法治', 'morality-law'], ['zujuan', '信息技术', 'info-tech'],
  ['zujuan', '通用技术', 'general-tech'], ['zujuan', '日语', 'japanese'],
  // 菁优网（jyeoo）同义原文（含 url segment 形态）
  ['jyeoo', '数学', 'math'], ['jyeoo', '物理', 'physics'], ['jyeoo', '化学', 'chemistry'],
  ['jyeoo', '生物', 'biology'], ['jyeoo', '语文', 'chinese'], ['jyeoo', '英语', 'english'],
  ['jyeoo', '历史', 'history'], ['jyeoo', '地理', 'geography'], ['jyeoo', '政治', 'politics'],
  ['jyeoo', '科学', 'science'], ['jyeoo', 'math7', 'math'], ['jyeoo', 'physics2', 'physics'],
  ['jyeoo', 'chemistry3', 'chemistry'], ['jyeoo', 'biology4', 'biology'],
  ['jyeoo', 'chinese5', 'chinese'], ['jyeoo', 'english6', 'english'],
  // 二一教育（21cnjy）同义原文
  ['21cnjy', '数学', 'math'], ['21cnjy', '物理', 'physics'], ['21cnjy', '化学', 'chemistry'],
  ['21cnjy', '语文', 'chinese'], ['21cnjy', '英语', 'english'], ['21cnjy', '科学', 'science'],
];

function seedDict() {
  const has = db.prepare('SELECT COUNT(*) n FROM mf_dict_entries').get().n;
  if (has > 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO mf_dict_entries (kind, code, label, site, source_label, active) VALUES (?,?,?,?,?,1)');
  DICT_SUBJECT_SEED.forEach((row) => {
    if (!row) return;
    const [a, b, c] = row;
    if (!c) ins.run('subject', a, b, null, null);
    else ins.run('subject', c, b, a, b);
  });
}

/** 解析：站点原文 → 归一 code（站点行优先 → 归一 code → 归一 label） */
function resolveSubject(raw, site) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (site) {
    const r = db.prepare("SELECT code FROM mf_dict_entries WHERE kind='subject' AND site=? AND source_label=? AND active=1").get(site, v);
    if (r) return r.code;
  }
  let r = db.prepare("SELECT code FROM mf_dict_entries WHERE kind='subject' AND site IS NULL AND code=? AND active=1").get(v);
  if (r) return r.code;
  r = db.prepare("SELECT code FROM mf_dict_entries WHERE kind='subject' AND site IS NULL AND label=? AND active=1").get(v);
  return r ? r.code : null;
}

admin.get('/dict', (req, res) => {
  const rows = db.prepare('SELECT * FROM mf_dict_entries ORDER BY kind, site IS NULL DESC, code, id').all();
  // 未知值：采集题里 subject 原文无法归一的个数（按原文去重）
  const raws = db.prepare("SELECT DISTINCT IFNULL(source_detail,'') s FROM questions WHERE IFNULL(source_type,'')='capture'").all()
    .map((r) => { try { return (JSON.parse(r.s) || {}).subject || ''; } catch (e) { return ''; } })
    .filter((v) => v && !resolveSubject(v, 'zujuan') && !resolveSubject(v, 'jyeoo') && !resolveSubject(v, '21cnjy') && !resolveSubject(v, null));
  const trees = db.prepare('SELECT COUNT(*) n FROM bank_trees').get().n;
  return ok(res, {
    list: rows.map((r) => ({ ...r, resolved_label: (db.prepare("SELECT label FROM mf_dict_entries WHERE kind=? AND site IS NULL AND code=?").get(r.kind, r.code) || {}).label || r.code })),
    counts: { total: rows.length, unknown: raws.length, unknown_values: raws, trees },
  });
});

admin.post('/dict', (req, res) => {
  const b = req.body || {};
  const kind = ['subject', 'qtype', 'difficulty'].includes(b.kind) ? b.kind : 'subject';
  const site = String(b.site || '').trim() || null;
  const source = String(b.source_label || '').trim();
  const code = String(b.code || '').trim();
  if (!source || !code) return fail(res, '同义原文和标准码都要填');
  try {
    db.prepare('INSERT INTO mf_dict_entries (kind, code, label, site, source_label, active) VALUES (?,?,?,?,?,1)')
      .run(kind, code, source, site, source);
  } catch (e) { return fail(res, '这条映射已存在'); }
  return ok(res, null, '映射已添加');
});

/** 指认归位：把一条站点映射/未识别值指到某个归一码 */
admin.post('/dict/assign', (req, res) => {
  const b = req.body || {};
  const id = int(b.id);
  const code = String(b.code || '').trim();
  const row = db.prepare('SELECT * FROM mf_dict_entries WHERE id=?').get(id);
  if (!row) return fail(res, '映射不存在');
  const norm = db.prepare('SELECT label FROM mf_dict_entries WHERE kind=? AND site IS NULL AND code=?').get(row.kind, code);
  if (!norm) return fail(res, `归一码 ${code} 还没有归一行，先在「归一行管理」里建`);
  db.prepare('UPDATE mf_dict_entries SET code=? WHERE id=?').run(code, id);
  return ok(res, null, `已归位到「${norm.label}」`);
});

admin.delete('/dict/:id', (req, res) => {
  db.prepare('DELETE FROM mf_dict_entries WHERE id=?').run(int(req.params.id));
  return ok(res, null, '已删除');
});

// ==================================================================== 五角色模型档案
const MODEL_ROLES = [
  ['reasoning', 'R1 推理', '主力分析与生成（讲义、解析、批改）同样需要支持图片输入的模型（识别水分主力通道）'],
  ['vision', 'R2 OCR', 'OCR 识别与看图理解：题目识别切分、试卷分析、图题理解 需要支持图片输入的模型'],
  ['light', 'R3 轻', '高频轻任务（打标、分类、短文本生成）'],
  ['embedding', 'R4 向量', '相似题检索与去重的向量化'],
  ['specialty', 'R5 专用', '第三方专用接口预留位（可建档；非 openai-chat 协议调用将提示未实装）'],
];
const ROLE_NAME = Object.fromEntries(MODEL_ROLES);
const QUICK_PRESETS = [
  { role: 'reasoning', label: 'DeepSeek 推理（deepseek-reasoner）', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner' },
  { role: 'reasoning', label: 'DeepSeek 对话（deepseek-chat）', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { role: 'vision', label: '硅基流动 OCR（DeepSeek-VL2·有免费档）', base_url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/deepseek-vl2' },
  { role: 'vision', label: '阿里百炼视觉（qwen-vl-max）', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
  { role: 'light', label: 'DeepSeek 轻（deepseek-chat 低温小任务）', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
];

function rowToProfile(r) {
  return {
    id: r.id, role: r.role, role_name: ROLE_NAME[r.role] || r.role, name: r.name, provider: r.provider,
    format: aiClient.normFormat(r.format), format_name: aiClient.FORMAT_NAMES[aiClient.normFormat(r.format)],
    base_url: r.base_url, model: r.model, capability: r.capability || '',
    is_enabled: !!r.is_enabled, has_key: !!r.api_key,
    last_test_at: r.last_test_at, last_test_ok: r.last_test_ok == null ? null : !!r.last_test_ok,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

admin.get('/profiles', (req, res) => {
  const list = db.prepare('SELECT * FROM mf_model_profiles ORDER BY role, id').all().map(rowToProfile);
  const enabled = new Set(list.filter((p) => p.is_enabled).map((p) => p.role));
  return ok(res, {
    list,
    roles: MODEL_ROLES,
    presets: QUICK_PRESETS,
    formats: aiClient.FORMATS.map((f) => ({ key: f, name: aiClient.FORMAT_NAMES[f], hint: aiClient.FORMAT_HINTS[f] })),
    enabled_count: enabled.size,
    total: list.length,
  });
});

function validateProfile(b) {
  if (!MODEL_ROLES.some(([r]) => r === b.role)) return '角色不合法';
  if (!String(b.name || '').trim()) return '档案名称不能为空';
  if (!String(b.base_url || '').trim()) return '接口地址不能为空';
  if (!String(b.model || '').trim()) return '模型名不能为空';
  if (b.format !== undefined && !aiClient.FORMATS.includes(String(b.format))) return '格式不合法（只支持 openai / anthropic / gemini）';
  if (!/^https?:\/\//i.test(String(b.base_url).trim())) return '接口地址要以 http:// 或 https:// 开头';
  return null;
}

admin.post('/profiles', (req, res) => {
  const b = req.body || {};
  const err = validateProfile(b);
  if (err) return fail(res, err);
  const info = db.prepare(`INSERT INTO mf_model_profiles
    (role, name, provider, base_url, model, api_key, capability, format, is_enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,0,?,?)`)
    .run(b.role, String(b.name).trim(), String(b.provider || '').trim(), String(b.base_url).trim().replace(/\/+$/, ''),
      String(b.model).trim(), String(b.api_key || '').trim(), String(b.capability || ''), aiClient.normFormat(b.format), now(), now());
  return ok(res, { id: info.lastInsertRowid }, '档案已创建（先测连通再启用）');
});

admin.put('/profiles/:id', (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_model_profiles WHERE id=?').get(id);
  if (!p) return fail(res, '档案不存在');
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : p.name;
  const base = b.base_url !== undefined ? String(b.base_url).trim().replace(/\/+$/, '') : p.base_url;
  const model = b.model !== undefined ? String(b.model).trim() : p.model;
  const provider = b.provider !== undefined ? String(b.provider).trim() : p.provider;
  const key = b.api_key !== undefined ? String(b.api_key).trim() : p.api_key; // 传空串=不改？显式 null 清除
  const keyVal = b.api_key === null ? '' : key;
  if (!name || !base || !model) return fail(res, '名称 / 接口地址 / 模型名不能为空');
  if (b.format !== undefined && !aiClient.FORMATS.includes(String(b.format))) return fail(res, '格式不合法（只支持 openai / anthropic / gemini）');
  const format = b.format !== undefined ? aiClient.normFormat(b.format) : aiClient.normFormat(p.format);
  const cap = b.capability !== undefined ? String(b.capability).trim() : (p.capability || '');
  db.prepare('UPDATE mf_model_profiles SET name=?, base_url=?, model=?, provider=?, api_key=?, capability=?, format=?, updated_at=? WHERE id=?')
    .run(name, base, model, provider, keyVal, cap, format, now(), id);
  // 改了地址/模型/密钥/格式后测通状态失效，需重测再启用；只改名称/供应商/图片标记则保留
  if (base !== p.base_url || model !== p.model || keyVal !== p.api_key || format !== aiClient.normFormat(p.format)) {
    db.prepare('UPDATE mf_model_profiles SET last_test_ok=0 WHERE id=?').run(id);
  }
  return ok(res, null, '已保存');
});

/** 拉取平台模型列表（按格式走各自的列表接口） */
admin.post('/profiles/models', async (req, res) => {
  const b = req.body || {};
  try {
    const ids = await aiClient.listModels({ format: b.format, base_url: b.base_url, api_key: b.api_key });
    return ok(res, { models: ids }, `拉到 ${ids.length} 个模型`);
  } catch (e) {
    return fail(res, '获取模型列表失败：' + e.message);
  }
});

/** 测试一份还没保存的配置（"新增配置 → 填完 → 测试连接"，不落库） */
admin.post('/profiles/test-draft', async (req, res) => {
  const b = req.body || {};
  if (b.format !== undefined && !aiClient.FORMATS.includes(String(b.format))) return fail(res, '格式不合法（只支持 openai / anthropic / gemini）');
  if (!/^https?:\/\//i.test(String(b.base_url || '').trim())) return fail(res, '接口地址要以 http:// 或 https:// 开头');
  // 编辑已有档案时密钥留空 = 沿用库里的密钥
  let key = String(b.api_key || '').trim();
  if (!key && b.id) { const p = db.prepare('SELECT api_key FROM mf_model_profiles WHERE id=?').get(int(b.id)); key = p ? String(p.api_key || '') : ''; }
  try {
    const r = await aiClient.testProfile({ role: b.role, format: b.format, base_url: b.base_url, model: b.model, api_key: key, name: b.name });
    return ok(res, { ms: r.ms }, `连接成功：${r.snippet || 'OK'}`);
  } catch (e) {
    return fail(res, '测试失败：' + e.message);
  }
});

admin.delete('/profiles/:id', (req, res) => {
  db.prepare('DELETE FROM mf_model_profiles WHERE id=?').run(int(req.params.id));
  return ok(res, null, '档案已删除');
});

admin.post('/profiles/:id/test', async (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_model_profiles WHERE id=?').get(id);
  if (!p) return fail(res, '档案不存在');
  try {
    const r = await aiClient.testProfile(p);
    db.prepare('UPDATE mf_model_profiles SET last_test_at=?, last_test_ok=1 WHERE id=?').run(now(), id);
    return ok(res, { ms: r.ms }, `连接成功：${r.snippet || 'OK'}`);
  } catch (e) {
    db.prepare('UPDATE mf_model_profiles SET last_test_at=?, last_test_ok=0 WHERE id=?').run(now(), id);
    return fail(res, '测试失败：' + e.message);
  }
});

/** 启用（同角色排他，未测通禁启用） */
admin.post('/profiles/:id/enable', (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_model_profiles WHERE id=?').get(id);
  if (!p) return fail(res, '档案不存在');
  if (!p.last_test_ok) return fail(res, '先测连通，测通了才能启用');
  db.prepare('UPDATE mf_model_profiles SET is_enabled=0 WHERE role=?').run(p.role);
  db.prepare('UPDATE mf_model_profiles SET is_enabled=1 WHERE id=?').run(id);
  return ok(res, null, `已启用为 ${ROLE_NAME[p.role] || p.role}`);
});

/** 快捷设置：一步建档 + 测连通 + 启用 */
admin.post('/profiles/quick', async (req, res) => {
  const b = req.body || {};
  const role = String(b.role || '');
  if (!MODEL_ROLES.some(([r]) => r === role)) return fail(res, '角色不合法');
  const base = String(b.base_url || '').trim().replace(/\/+$/, '');
  const model = String(b.model || '').trim();
  const key = String(b.api_key || '').trim();
  const format = aiClient.normFormat(b.format);
  if (!base || !model || !key) return fail(res, '接口地址 / 模型名 / API Key 都要填');
  const info = db.prepare(`INSERT INTO mf_model_profiles
    (role, name, provider, base_url, model, api_key, format, is_enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,0,?,?)`)
    .run(role, `${ROLE_NAME[role]}·快捷`, 'quick', base, model, key, format, now(), now());
  const id = info.lastInsertRowid;
  try {
    await aiClient.testProfile({ role, format, base_url: base, model, api_key: key });
    db.prepare('UPDATE mf_model_profiles SET last_test_at=?, last_test_ok=1 WHERE id=?').run(now(), id);
    db.prepare('UPDATE mf_model_profiles SET is_enabled=0 WHERE role=?').run(role);
    db.prepare('UPDATE mf_model_profiles SET is_enabled=1 WHERE id=?').run(id);
    return ok(res, { id }, `${ROLE_NAME[role]} 已配置并启用`);
  } catch (e) {
    db.prepare('UPDATE mf_model_profiles SET last_test_at=?, last_test_ok=0 WHERE id=?').run(now(), id);
    return fail(res, `档案已建但测连通失败（${e.message}）：Key 或地址有误，可修改后重试`);
  }
});

// ==================================================================== AI 网关

/**
 * 按角色调用模型（所有走"档案"的 AI 能力的统一入口，转给 ai-client.js）。
 * 优先用该角色启用的档案；没有就按回落顺序用别的已启用档案；都没有才用内置配置（ai-client 内部处理）。
 * 入参：{ role, system, user, images:[base64 | dataURL | {buf,mime}], maxTokens, temperature, json }
 */
async function mfAiInvoke({ role, system, user, images = [], maxTokens = 1200, temperature = 0.3, json = false }) {
  const aiLib = require('./ai');
  if (images && images.length) {
    const r = await aiLib.visionChat({ role: role || 'vision', system, user: String(user || ''), images, maxTokens, temperature, timeoutMs: 180000 });
    return { text: r.text, model: r.model, via: r.via };
  }
  const r = await aiLib.chat({ role: role || 'reasoning', system, user, maxTokens, temperature, json, timeoutMs: 180000 });
  return { text: r.text, model: r.model, via: r.via };
}

// ==================================================================== AI 建议（批量打标 / 挂树建议，AI 只建议、人来确认）
admin.post('/ai-suggest', async (req, res) => {
  try {
    const b = req.body || {};
    const ids = (b.ids || []).map(int).filter(Boolean).slice(0, 20);
    if (!ids.length) return fail(res, '请先勾选题目');
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, stem, stem_html, answer, subject, stage FROM questions WHERE id IN (${ph})`).all(...ids);
    // 候选：归一学科名 + 当前学科知识树的节点名（给 AI 一个封闭清单）
    const out = [];
    for (const q of rows) {
      // R2：同学科同学段有多个教材版本时，按默认版本取知识点树（没有再取章节树 / 不限学科的树）
      const tree = pickTree(db, { kind: 'knowledge', subject: q.subject, stage: q.stage })
        || pickTree(db, { kind: 'textbook', subject: q.subject, stage: q.stage })
        || db.prepare("SELECT * FROM bank_trees WHERE subject=? ORDER BY sort, id").get(q.subject)
        || db.prepare("SELECT * FROM bank_trees WHERE IFNULL(subject,'')='' ORDER BY sort, id").get() || null;
      let nodeNames = [];
      if (tree) {
        const all = db.prepare('SELECT name FROM bank_tree_nodes WHERE tree_id=? LIMIT 300').all(tree.id);
        nodeNames = all.map((n) => n.name);
      }
      const sys = '你是题库打标助手。根据题干给出标签和知识点归属建议。只输出 JSON：{"tags":["最多3个短标签"],"points":["从候选知识点里选，最多2个，必须逐字来自候选列表"]}。不要解释。';
      const userMsg = `学科：${q.subject || '未知'}\n候选知识点：${nodeNames.slice(0, 200).join('、') || '（无）'}\n题干：${String(q.stem_html || q.stem || '').replace(/<[^>]+>/g, '').slice(0, 800)}`;
      let sug = { tags: [], points: [] };
      try {
        const { text } = await mfAiInvoke({ role: 'light', system: sys, user: userMsg, maxTokens: 400, temperature: 0.1 });
        const m = /\{[\s\S]*\}/.exec(String(text || ''));
        if (m) sug = JSON.parse(m[0]);
      } catch (e) {
        return fail(res, 'AI 建议失败：' + e.message);
      }
      const pointIds = [];
      if (tree && Array.isArray(sug.points)) {
        for (const name of sug.points.slice(0, 2)) {
          const n = db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND name=?').get(tree.id, String(name).trim());
          if (n) pointIds.push(n.id);
        }
      }
      out.push({
        id: q.id,
        tags: (Array.isArray(sug.tags) ? sug.tags : []).slice(0, 3).map((t) => String(t).trim()).filter(Boolean),
        tree_id: tree ? tree.id : null,
        tree_name: tree ? tree.name : '',
        node_ids: pointIds,
      });
    }
    return ok(res, { list: out });
  } catch (e) {
    return fail(res, 'AI 建议失败：' + e.message);
  }
});

// ==================================================================== 知识树采集导入（注入脚本在组卷网树页解析后回传）
admin.post('/collect-tree', (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.nodes) || !b.nodes.length) return fail(res, '没有节点数据');
  const r = importTreeCore(b);
  if (r.code) return fail(res, r.msg);
  return ok(res, { tree_id: r.tree_id, created: r.created, merged: r.merged, total: r.total, new_tree: r.new_tree, edition: r.edition, tree_name: r.tree_name, dry: r.dry }, r.msg);
});

// ==================================================================== 默认学段学科（偏好）
admin.get('/prefs', (req, res) => {
  const get = (k) => { try { const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k); return r ? r.v : ''; } catch (e) { return ''; } };
  return ok(res, { default_stage: get('mf_default_stage'), default_subject: get('mf_default_subject') });
});

admin.put('/prefs', (req, res) => {
  const b = req.body || {};
  const set = (k, v) => db.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v || ''));
  set('mf_default_stage', b.default_stage || '');
  set('mf_default_subject', b.default_subject || '');
  return ok(res, null, '已保存');
});

// ==================================================================== 代理票据（iframe 没法带 Authorization，用短票据）
const TICKETS = new Map(); // k -> { uid, exp }
function issueTicket(uid) {
  const k = crypto.randomBytes(18).toString('base64url');
  TICKETS.set(k, { uid, exp: Date.now() + 12 * 3600 * 1000 });
  // 顺手清过期
  for (const [key, v] of TICKETS) if (v.exp < Date.now()) TICKETS.delete(key);
  return k;
}
admin.post('/proxy-ticket', (req, res) => {
  if (!proxyEnabled()) return res.status(403).json({ code: 403, msg: '辅助代理默认关闭，请使用浏览器书签采集。' });
  const uid = req.user ? req.user.id : 0;
  return ok(res, { k: issueTicket(uid), capture: issueCaptureToken() });
});

function issueCaptureToken() {
  const secret = require('fs').readFileSync(require('path').join(DATA_DIR, '.secret'), 'utf8').trim();
  return jwt.sign({ role: 'mfcapture' }, secret, { expiresIn: '7d' });
}

function checkTicket(req) {
  const k = String(req.query.k || req.headers['x-mf-ticket'] || '');
  const t = TICKETS.get(k);
  if (!t || t.exp < Date.now()) return null;
  return t;
}

// ==================================================================== 代理内嵌浏览器
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const JARS = new Map(); // jarKey(host|uid) -> Map(name -> value)
const jarKey = (host, uid) => `${uid}|${host}`;

function jarGet(host, uid) {
  const k = jarKey(host, uid);
  if (!JARS.has(k)) JARS.set(k, new Map());
  return JARS.get(k);
}
function jarHeader(host, uid) {
  const jar = jarGet(host, uid);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
}
function jarStore(host, uid, setCookies) {
  if (!setCookies) return;
  const jar = jarGet(host, uid);
  (Array.isArray(setCookies) ? setCookies : [setCookies]).forEach((sc) => {
    const pair = String(sc).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const n = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (v === '' || /expires=Thu,\s*01\s+Jan\s+1970/i.test(sc)) jar.delete(n);
      else jar.set(n, v);
    }
  });
}

const PROXY_PATH = '/api/mfproxy/r';
function proxyURL(absUrl, k) { return `${PROXY_PATH}?k=${encodeURIComponent(k)}&u=${encodeURIComponent(absUrl)}`; }

/* ---------- 阿里云 WAF 挑战页服务端求解 ----------
 * 挑战页是 <body onload="check()">，check() 从 parm_0/parm_1 取值，
 * 用混淆 JS 算出 hash 写入 alicfw/alicfw_gfver 两个 cookie 后 reload。
 * 用 vm 沙箱模拟最小 DOM 环境直接跑原始 JS，把算出的 cookie 存回 jar。
 */
function isChallengePage(html) {
  return typeof html === 'string' && html.length < 60000 && /parm_0/.test(html) && /alicfw/.test(html) && /check\s*\(/.test(html);
}

function solveWafCookie(html, host) {
  const m0 = /id="parm_0"[^>]*value=\s*(\d+)/i.exec(html) || /name="parm_0"[^>]*value=\s*(\d+)/i.exec(html) || /value=\s*(\d+)\s*id="parm_0"/i.exec(html);
  const m1 = /id="parm_1"[^>]*value=\s*(\d+)/i.exec(html) || /name="parm_1"[^>]*value=\s*(\d+)/i.exec(html) || /value=\s*(\d+)\s*id="parm_1"/i.exec(html);
  if (!m0 || !m1) return null;
  const scriptMatch = /<script[^>]*>([\s\S]*?<\/script>)/gi;
  let code = '';
  let sm;
  while ((sm = scriptMatch.exec(html))) {
    const body = sm[1].replace(/<\/script>$/i, '');
    if (body.includes('function') && body.length > 500) code += body + '\n';
  }
  if (!code) return null;
  const cookies = {};
  const sandbox = {
    console: { log: () => {} },
    escape: (s) => encodeURIComponent(String(s == null ? '' : s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())),
    unescape: (s) => decodeURIComponent(String(s == null ? '' : s).replace(/%(?![0-9a-fA-F]{2})/g, '%25')),
    parseInt, parseFloat, isNaN, String, Number, Array, Object, Math, Date,
    document: {
      protocol: 'https:',
      location: { protocol: 'https:', host },
      _ck: '',
      getElementById: (id) => ({ value: id === 'parm_0' ? m0[1] : m1[1] }),
      documentElement: { clientHeight: 800, clientWidth: 1280 },
    },
    window: { location: { host, protocol: 'https:', reload: () => {} } },
    setTimeout: (fn) => fn(),
  };
  Object.defineProperty(sandbox.document, 'cookie', {
    get() { return sandbox.document._ck; },
    set(v) { sandbox.document._ck += (sandbox.document._ck ? '; ' : '') + String(v); },
  });
  try {
    vm.createContext(sandbox);
    vm.runInContext(code + '\n;check();', sandbox, { timeout: 3000 });
  } catch (e) {
    return null;
  }
  (sandbox.document._ck || '').split(/;\s*/).forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  });
  return cookies.alicfw ? cookies : null;
}

/** 智能 HTML 抓取：带 jar 抓取；命中 WAF 挑战页就在服务端算 cookie 重试 */
async function fetchPageAuto(url, { method = 'GET', headers = {}, body = null, uid = 0, retries = 2 } = {}) {
  let r = await fetchRemote(url, { method, headers, body, uid });
  try {
    const u = new URL(url);
    for (let i = 0; i < retries; i++) {
      if (r.status !== 200 || !/text\/html/i.test(String(r.headers['content-type'] || ''))) break;
      const html = decodeBuf(r.buf, r.headers['content-type']);
      if (!isChallengePage(html)) break;
      const solved = solveWafCookie(html, u.hostname);
      if (!solved) break;
      // setCookie 的字符串会被拆出 expires/path 等伪键，只存真实 cookie（alicfw 系列）
      Object.entries(solved)
        .filter(([n]) => !/^(expires|path|domain|samesite|secure|httponly)$/i.test(n))
        .forEach(([n, v]) => jarGet(u.hostname, uid).set(n, v));
      r = await fetchRemote(url, { method, headers, body, uid });
    }
  } catch (e) { /* 挑战处理失败就按原响应返回 */ }
  return r;
}

function resolveURL(u, base) {
  try { return new URL(u, base).href; } catch (e) { return null; }
}
const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

/** HTML 重写：相对/绝对 URL → 代理 URL；去 CSP/SRI；注入引导脚本 */
function rewriteHTML(html, pageUrl, k, captureToken) {
  let s = String(html);
  s = s.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  s = s.replace(/\sintegrity=["'][^"']*["']/gi, '');
  s = s.replace(/\scrossorigin(=["'][^"']*["'])?/gi, '');
  // 链接/表单一律留在代理 iframe 内：去掉 target=_blank/_top/_parent（注入脚本另有兜底）
  s = s.replace(/(<(?:a|form|area|base)\b[^>]*?)\starget=(["'])(?:_blank|_top|_parent|[^"']*)\2/gi, '$1');
  const sub = (u) => {
    const abs = resolveURL(u, pageUrl);
    if (!abs || SKIP_SCHEME.test(u.trim())) return u;
    return proxyURL(abs, k);
  };
  s = s.replace(/\s(src|href|action|poster|data-src|data-original)=(["'])([^"']*)\2/gi, (m, attr, q, u) => {
    if (SKIP_SCHEME.test(u.trim())) return m;
    return ` ${attr}=${q}${sub(u)}${q}`;
  });
  s = s.replace(/\ssrcset=(["'])([^"']*)\1/gi, (m, q, val) => {
    const parts = val.split(',').map((p) => {
      const t = p.trim().split(/\s+/);
      if (t[0]) t[0] = sub(t[0]);
      return t.join(' ');
    });
    return ` srcset=${q}${parts.join(', ')}${q}`;
  });
  // <style> 块里的 url()
  s = s.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => `<style${a}>${rewriteCSS(css, pageUrl, k)}</style>`);
  // 注入引导（放 head 最前面，抢在站点脚本前打补丁）
  const boot = `<script>window.__MFPROXY__={page:${JSON.stringify(pageUrl)},k:${JSON.stringify(k)},api:${JSON.stringify(PROXY_PATH)},capture:${JSON.stringify(captureToken)}};</script>\n<script src="/api/mfproxy/inject.js"></script>\n`;
  if (/<head[^>]*>/i.test(s)) s = s.replace(/<head[^>]*>/i, (m) => m + boot);
  else s = boot + s;
  return s;
}

function rewriteCSS(css, pageUrl, k) {
  return String(css).replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, u) => {
    if (SKIP_SCHEME.test(u.trim())) return m;
    const abs = resolveURL(u, pageUrl);
    if (!abs) return m;
    return `url(${q}${proxyURL(abs, k)}${q})`;
  }).replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
    const abs = resolveURL(u, pageUrl);
    if (!abs) return m;
    return `@import ${q}${proxyURL(abs, k)}${q}`;
  });
}

/** 取远程页面（跟随重定向、存 cookie、解压） */
function fetchRemote(url, { method = 'GET', headers = {}, body = null, uid = 0, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('URL 无效')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('只支持 http/https'));
    const lib = u.protocol === 'http:' ? http : https;
    const h = { ...headers, host: u.host };
    const ck = jarHeader(u.hostname, uid);
    if (ck) h['cookie'] = ck;
    const req = lib.request(u, { method, headers: h, timeout: 30000 }, (r) => {
      jarStore(u.hostname, uid, r.headers['set-cookie']);
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
        r.resume();
        const next = resolveURL(r.headers.location, u.href);
        const m = [303, 302].includes(r.statusCode) ? 'GET' : method;
        fetchRemote(next, { method: m, headers: { ...headers, host: undefined }, body: m === 'GET' ? null : body, uid, redirects: redirects - 1 })
          .then(resolve, reject);
        return;
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(r.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br' && zlib.brotliDecompressSync) buf = zlib.brotliDecompressSync(buf);
        } catch (e) { /* 解压失败按原文 */ }
        resolve({ status: r.statusCode, headers: r.headers, buf, finalUrl: u.href });
      });
    });
    req.on('timeout', () => req.destroy(new Error('远程站点响应超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const ICONV = (() => { try { return require('iconv-lite'); } catch (e) { return null; } })();

function decodeBuf(buf, contentType) {
  const m = /charset=([\w-]+)/i.exec(String(contentType || ''));
  const cs = m && m[1] ? m[1].toLowerCase() : 'utf-8';
  if (/^utf-?8$/.test(cs)) return buf.toString('utf8');
  if (ICONV && ICONV.encodingExists(cs)) return ICONV.decode(buf, cs);
  return buf.toString('utf8');
}

proxy.get('/inject.js', (req, res) => {
  const p = require('path').join(__dirname, '..', 'public', 'admin', 'collect-inject.js');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try { res.send(require('fs').readFileSync(p, 'utf8')); } catch (e) { res.send('/* inject 脚本缺失 */'); }
});

/** 注入脚本回传页面 cookie（反爬挑战页算出的 cookie 要进服务器 jar 才能过验证） */
proxy.get('/ck', (req, res) => {
  const t = checkTicket(req);
  if (!t) return fail(res, '会话过期', 401);
  try {
    const page = String(req.query.u || '');
    const host = (() => { try { return new URL(page).hostname; } catch (e) { return ''; } })();
    const c = String(req.query.c || '');
    if (host && c) {
      const jar = jarGet(host, t.uid);
      c.split(';').forEach((pair) => {
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      });
    }
  } catch (e) { /* 忽略 */ }
  res.json({ code: 0 });
});

/** 代理主通道：GET/POST 都走这里 */
function handleProxy(req, res) {
  const t = checkTicket(req);
  if (!t) return fail(res, '代理会话已过期，刷新后台页面重试', 401);
  const uid = t.uid;
  const target = String(req.query.u || '');
  if (!target || !/^https?:\/\//i.test(target)) return fail(res, '缺少有效的目标网址');
  // 请求头
  const headers = {
    'user-agent': UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9',
    'accept-encoding': 'gzip, deflate',
    'referer': String(req.headers['x-mf-referer'] || target),
  };
  let body = null;
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] || req.headers['x-mf-ct'] || 'application/x-www-form-urlencoded');
    headers['content-type'] = ct;
    if (req.body && typeof req.body === 'object') {
      body = /json/i.test(ct) ? JSON.stringify(req.body) : new URLSearchParams(req.body).toString();
    }
  }
  const captureToken = t.capture || issueCaptureToken();
  fetchPageAuto(target, { method: req.method === 'POST' ? 'POST' : 'GET', headers, body, uid })
    .then((r) => {
      const ct = String(r.headers['content-type'] || 'application/octet-stream');
      // 透传不需要重写的类型
      if (/text\/html/i.test(ct)) {
        const html = decodeBuf(r.buf, ct);
        const out = rewriteHTML(html, r.finalUrl, String(req.query.k || req.headers['x-mf-ticket'] || ''), captureToken);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Frame-Options');
        return res.send(out);
      }
      if (/text\/css/i.test(ct)) {
        const css = rewriteCSS(decodeBuf(r.buf, ct), r.finalUrl, String(req.query.k || ''));
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        return res.send(css);
      }
      if (/javascript|ecmascript/i.test(ct)) {
        // 站点 JS 原样透传（URL 已由 XHR/fetch 补丁兜底）
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.send(r.buf);
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.send(r.buf);
    })
    .catch((e) => {
      res.status(502).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#334155">
        <h3>这个页面加载失败</h3><p>${String(e.message || e).replace(/</g, '&lt;')}</p>
        <p style="color:#64748b">目标：${String(target).replace(/</g, '&lt;')}</p>
        <p style="color:#64748b">有些站点要登录才能看，登录不走代理时请用「书签小工具」方式采集。</p></body>`);
    });
}

proxy.get('/r', handleProxy);
proxy.post('/r', handleProxy);

proxy.use((req, res) => fail(res, '未知代理路径', 404));

// ==================================================================== 采集票据回传（树导入等，与 mfbank 的 /api/mfcap 共用票据体系）
cap.use((req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || '');
  if (!token) return fail(res, '缺少采集票据', 401);
  try {
    const secret = require('fs').readFileSync(require('path').join(DATA_DIR, '.secret'), 'utf8').trim();
    const u = jwt.verify(token, secret);
    if (!u || u.role !== 'mfcapture') return fail(res, '采集票据无效', 401);
    next();
  } catch (e) { return fail(res, '采集票据无效或已过期', 401); }
});

/** 注入脚本采集知识树后回传（幂等导入，与管理端 /collect-tree 同一核心实现） */
cap.post('/tree-push', (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.nodes) || !b.nodes.length) return fail(res, '没有节点数据');
  const r = importTreeCore(b);
  return res.json(r);
});

/** 学段归一：接受 小学/初中/高中 或 primary/junior/senior，返回库里用的英文码；认不出返回 '' */
function normStage(raw) {
  const v = String(raw || '').trim();
  if (['primary', 'junior', 'senior'].includes(v)) return v;
  return ({ 小学: 'primary', 初中: 'junior', 高中: 'senior' })[v] || '';
}
/** 学科归一：库里的树用中文学科名；传进来是归一码（math）就换成中文名 */
function normSubjectLabel(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const r = db.prepare("SELECT label FROM mf_dict_entries WHERE kind='subject' AND site IS NULL AND code=? AND active=1").get(v);
  return r && r.label ? r.label : v;
}

/** 导入采集树。明确学段、学科、版本，先按路径预览，再原子合并。 */
function importTreeCore(input) {
  const { site, root_id, root_name, stage, subject, nodes, kind, edition, edition_selected, tree_id, dry } = input || {};
  try {
    const arr = Array.isArray(nodes) ? nodes : [];
    if (!arr.length) throw new Error('没有节点数据');
    if (arr.length > 60000) throw new Error('节点过多，请分批导入');
    if (dry !== undefined && typeof dry !== 'boolean') throw new Error('预览标识必须为布尔值');
    const stageCode = normStage(stage), subjectName = normSubjectLabel(subject);
    if (!stageCode || !subjectName) throw new Error('请先选择学段和学科');
    if (!['knowledge', 'textbook'].includes(kind)) throw new Error('请先选择章节树或知识点树');
    const version = String(edition || '').trim();
    if (!version && !(kind === 'knowledge' && edition_selected === true)) throw new Error('请先明确选择教材版本（知识点树可选择不区分版本）');
    const selectedId = tree_id ? Number(tree_id) : 0;
    if (tree_id && (!Number.isSafeInteger(selectedId) || selectedId <= 0)) throw new Error('目标树无效');
    const nodesById = new Map();
    arr.forEach((n, i) => {
      const sid = String(n && n.site_node_id || '').trim();
      const name = String(n && n.name || '').trim();
      if (!sid || !name) throw new Error(`第 ${i + 1} 个节点缺少来源编号或名称`);
      if (sid.length > 100 || name.length > 120) throw new Error(`第 ${i + 1} 个节点编号或名称过长`);
      if (nodesById.has(sid)) throw new Error(`来源编号 ${sid} 重复，请先整理数据`);
      const order = Number(n.sort);
      nodesById.set(sid, { node: { name, code: sid, children: [], _order: Number.isFinite(order) ? order : i, _seq: i }, parent: String(n.parent_site_node_id || '').trim() });
    });
    nodesById.forEach((entry, sid) => {
      let current = entry, depth = 0;
      const visited = new Set([sid]);
      while (current.parent) {
        if (visited.has(current.parent)) throw new Error('节点存在循环引用，请先整理数据');
        visited.add(current.parent);
        current = nodesById.get(current.parent);
        if (!current) throw new Error('节点的上级不存在，请先整理数据');
        if (++depth >= 12) throw new Error('节点层级超过 12 层');
      }
    });
    const roots = [];
    nodesById.forEach((entry) => { if (entry.parent) nodesById.get(entry.parent).node.children.push(entry.node); else roots.push(entry.node); });
    const sortNodes = (list) => { list.sort((a, b) => a._order - b._order || a._seq - b._seq); list.forEach((n) => sortNodes(n.children)); };
    sortNodes(roots);
    const treeio = require('./treeio');
    const [doc] = treeio.normalizeInput({ format: 'zhilexue-tree', version: 1, kind, subject: subjectName, stage: stageCode, edition: version,
      name: String(root_name || `${version}${subjectName}·采集树`), source: `collect:${String(site || 'unknown')}:${String(root_id || '')}`, nodes: roots });
    const work = () => {
      // 站点 ID 只是采集来源，不是目录节点身份；同路径仍合并并保留首次 code / 来源映射。
      const result = treeio.importDoc(db, doc, { dry: dry === true, treeId: selectedId, preserveSourceCode: true });
      if (dry !== true && result.tree_id) {
        const insertMap = db.prepare('INSERT OR IGNORE INTO mf_tree_source_map (node_id, site, site_node_id, site_node_name) VALUES (?,?,?,?)');
        db.prepare('SELECT id, code, name FROM bank_tree_nodes WHERE tree_id=?').all(result.tree_id).forEach((n) => {
          if (n.code && nodesById.has(String(n.code))) insertMap.run(n.id, String(site || 'unknown').slice(0, 32), String(n.code), n.name);
        });
      }
      return result;
    };
    const r = dry === true ? work() : db.transaction(work)();
    return { code: 0, tree_id: r.tree_id, created: r.added, merged: r.existing, total: r.total, new_tree: r.created_tree, edition: r.edition, tree_name: r.name, dry: dry === true,
      msg: `${dry === true ? '预览' : '导入完成'}：${r.created_tree ? '将新建树' : '合并到已有树'}，新增 ${r.added} 节点，合并同名 ${r.existing} 个` };
  } catch (e) { return { code: 1, msg: e.message || '导入失败' }; }
}

// admin /collect-tree 也走核心实现
admin._importTreeCore = importTreeCore;

ensureSchema();

module.exports = { admin, proxy, cap, mfAiInvoke, resolveSubject, importTreeCore, fetchRemote, decodeBuf, fetchPageAuto, solveWafCookie, isChallengePage };
