'use strict';
/**
 * 魔方题库（并入智能题库，2026-10-29）
 * 挂载：/api/admin/bank/mf/*（自动归入「智能题库」操作日志）
 *
 * 四个子模块：
 *   1. 题库管理  —— 目录树（教材/知识点）+ 题目全字段 + 标签 + 来源追溯 + 批量操作 + 导入导出
 *   2. 网络采集  —— 书签小工具 / 粘贴网页源码 / 抓取 URL → 暂存批次 → 去重入库
 *   3. 试卷管理  —— 试卷文件夹 + 试卷（篮/排版/定稿/归档/回收站）+ 排版参数 + 预览 + 导出
 *   4. 录题工作台 —— 图片/PDF 页图上传 → AI 视觉识别 → 题卡校对 → 入库
 *
 * 存储：题目图片等统一走 storage.saveFile(..., bankFolder()+'/img')，
 *       即 OSS 上的 bank/ 目录（子目录 img / recog / paper），换存储或迁移只改 bank_folder 配置。
 */
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const store = require('./storage');
const aiLib = require('./ai');
const treePick = require('./treepick');   // R2：默认版本表 + 统一取树
const treeIo = require('./treeio');       // R2：树导入 / 导出

const admin = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败', code = 1) => res.json({ code, msg });

/** multer 按 latin1 解 multipart 文件名，中文会变乱码（如 æ´è±…）；能无损转回 UTF-8 时转回 */
function fixFileName(name) {
  const s = String(name || '');
  if (!/[\u0080-\u00FF]/.test(s)) return s;
  try {
    const u = Buffer.from(s, 'latin1').toString('utf8');
    return u.includes('\uFFFD') ? s : u;
  } catch (e) { return s; }
}

// 题型沿用本系统原有的 5 类（学生端判分链路共用），另给魔方采集到的其它题型一个兜底展示名
const TYPES = ['single', 'multi', 'judge', 'fill', 'sort', 'answer'];
const TYPE_NAMES = {
  single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题',
  sort: '排序题', answer: '解答题',
};
const STAGES = ['primary', 'junior', 'senior'];
const STAGE_NAMES = { primary: '小学', junior: '初中', senior: '高中' };
const SUBJECTS = ['数学', '英语', '物理', '化学', '语文'];

/** 题库文件在对象存储上的根目录（settings.bank_folder，默认 bank）。
 *  题目图 → bank/img，录题页图 → bank/recog，导出试卷 → bank/paper。 */
function bankFolder() {
  try {
    const r = db.prepare("SELECT v FROM settings WHERE k='bank_folder'").get();
    const v = String((r && r.v) || '').trim().replace(/^\/+|\/+$/g, '');
    if (v) return v;
  } catch (e) { /* settings 表还没建好 */ }
  return String(process.env.BANK_FOLDER || 'bank').trim().replace(/^\/+|\/+$/g, '') || 'bank';
}

const parseArr = (s, d = []) => { try { const a = JSON.parse(s || ''); return Array.isArray(a) ? a : d; } catch (e) { return d; } };
const parseObj = (s, d = {}) => { try { const a = JSON.parse(s || ''); return a && typeof a === 'object' ? a : d; } catch (e) { return d; } };
const jstr = (v) => { try { return JSON.stringify(v == null ? [] : v); } catch (e) { return '[]'; } };
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/** 题目行 → 前端对象（options/images/tags/nodes 都展开） */
function decorate(row, opt = {}) {
  if (!row) return row;
  const out = {
    ...row,
    options: parseArr(row.options),
    images: parseArr(row.images),
    source_detail: parseObj(row.source_detail),
    audio_url: row.audio_key ? store.getUrlSync(row.audio_key) : '',
  };
  if (opt.tags) {
    out.tags = db.prepare('SELECT tag FROM question_tags WHERE question_id=? ORDER BY tag').all(row.id).map((r) => r.tag);
  }
  if (opt.nodes) {
    out.nodes = db.prepare('SELECT node_id FROM question_nodes WHERE question_id=?').all(row.id).map((r) => r.node_id);
  }
  return out;
}

// ==================================================================== 目录树
admin.get('/trees', (req, res) => {
  const kind = String(req.query.kind || '').trim();
  const where = kind ? "WHERE kind=?" : '';
  const args = kind ? [kind] : [];
  const list = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM bank_tree_nodes n WHERE n.tree_id=t.id) AS node_count
    FROM bank_trees t ${where} ORDER BY t.sort, t.id`).all(...args);
  // defaults：默认版本表，前端 pickTree 按它选默认版本（R2）
  return ok(res, { list, defaults: treePick.getDefaultEditions(db) });
});

admin.post('/trees', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, '请填写目录树名称');
  const kind = b.kind === 'knowledge' ? 'knowledge' : 'textbook';
  const subject = String(b.subject || '').trim(), stage = String(b.stage || '').trim(), edition = String(b.edition || '').trim();
  if (edition.length > 40) return fail(res, '版本名太长（最多 40 字）');
  if (kind === 'textbook' && !edition) return fail(res, '请选择教材版本（如 苏教版、苏科版）');
  const dup = db.prepare("SELECT id FROM bank_trees WHERE kind=? AND subject=? AND IFNULL(stage,'')=? AND IFNULL(edition,'')=?").get(kind, subject, stage, edition);
  if (dup) return fail(res, '这个 学段 + 学科 + 版本 已经有一棵树了，直接用它（或换个版本）');
  const info = db.prepare('INSERT INTO bank_trees (kind, subject, stage, name, source, edition, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(kind, subject, stage, name, String(b.source || 'manual').trim(), edition, int(b.sort), now());
  return ok(res, { id: info.lastInsertRowid }, '目录树已创建');
});

admin.put('/trees/:id', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM bank_trees WHERE id=?').get(id);
  if (!t) return fail(res, '目录树不存在');
  const edition = String(b.edition ?? t.edition ?? '').trim();
  if (edition.length > 40) return fail(res, '版本名太长（最多 40 字）');
  db.prepare('UPDATE bank_trees SET name=?, subject=?, stage=?, kind=?, sort=?, edition=? WHERE id=?')
    .run(String(b.name || t.name).trim(), String(b.subject ?? t.subject).trim(), String(b.stage ?? t.stage).trim(),
      b.kind === 'knowledge' ? 'knowledge' : (b.kind === 'textbook' ? 'textbook' : t.kind), int(b.sort, t.sort), edition, id);
  return ok(res, null, '已保存');
});

// ---- 教材版本（R2）：默认版本表 + 每个 学段/学科 下已有的版本 ----
admin.get('/editions', (req, res) => ok(res, treePick.editionsOverview(db)));

admin.put('/editions', (req, res) => {
  const b = req.body || {};
  try {
    treePick.setDefaultEditions(db, b.defaults !== undefined ? b.defaults : b);
  } catch (e) { return fail(res, e.message); }
  return ok(res, treePick.editionsOverview(db), '默认版本已保存');
});

// ---- 树导入 / 导出（R2）：格式见 docs/tree-import-format.md ----
// POST /trees/import  JSON body（单棵树对象或树数组），或 multipart 上传 .json（字段 file）；?dry=1 只统计不写库
admin.post('/trees/import', upload.single('file'), (req, res) => {
  let input = req.body;
  if (req.file) {
    try { input = JSON.parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')); }
    catch (e) { return fail(res, 'JSON 解析失败：' + e.message); }
  }
  if (input && input.trees && !input.format && Array.isArray(input.trees)) input = input.trees;   // 兼容 { trees: [...] } 包一层
  const dry = String(req.query.dry || (req.body && req.body.dry) || '') === '1' || (req.body && req.body.dry === true);
  if (!input || (typeof input === 'object' && !Array.isArray(input) && !Object.keys(input).length)) return fail(res, '没有收到树数据');
  try {
    const results = treeIo.importAll(db, input, { dry });
    const added = results.reduce((a, r) => a + r.added, 0);
    return ok(res, { dry, results, added, existing: results.reduce((a, r) => a + r.existing, 0) },
      dry ? `预检完成：将新增 ${added} 个节点（未写库）` : `导入完成：新增 ${added} 个节点`);
  } catch (e) { return fail(res, e.message); }
});

admin.get('/trees/:id/export', (req, res) => {
  const doc = treeIo.exportTree(db, int(req.params.id));
  if (!doc) return fail(res, '目录树不存在');
  if (String(req.query.download || '') === '1') {
    const fname = `${doc.name || 'tree'}.json`;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  }
  return ok(res, doc);
});

admin.delete('/trees/:id', (req, res) => {
  const id = int(req.params.id);
  const ids = db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=?').all(id).map((r) => r.id);
  const delLinks = db.prepare('DELETE FROM question_nodes WHERE node_id=?');
  const delNode = db.prepare('DELETE FROM bank_tree_nodes WHERE id=?');
  ids.forEach((nid) => { delLinks.run(nid); delNode.run(nid); });
  db.prepare('DELETE FROM bank_trees WHERE id=?').run(id);
  return ok(res, null, `目录树已删除（含 ${ids.length} 个节点）`);
});

/** 返回扁平节点数组，前端自己构树 */
admin.get('/trees/:id/nodes', (req, res) => {
  const id = int(req.params.id);
  const list = db.prepare('SELECT id, parent_id, name, sort FROM bank_tree_nodes WHERE tree_id=? ORDER BY sort, id').all(id);
  // qcount = 本节点及所有子孙节点上挂的题目去重数（同一道题挂在父、子两处只算一次）；qcount_own = 只算本节点自己
  const links = db.prepare('SELECT qn.node_id AS nid, qn.question_id AS qid FROM question_nodes qn JOIN bank_tree_nodes b ON b.id=qn.node_id WHERE b.tree_id=?').all(id);
  const own = {};
  links.forEach((r) => { (own[r.nid] = own[r.nid] || new Set()).add(r.qid); });
  const kidsOf = {};
  list.forEach((n) => { if (n.parent_id) (kidsOf[n.parent_id] = kidsOf[n.parent_id] || []).push(n.id); });
  const sub = {};
  const seen = new Set();
  const collect = (nid) => {
    if (sub[nid]) return sub[nid];
    if (seen.has(nid)) return new Set();   // 防环
    seen.add(nid);
    const set = new Set(own[nid] || []);
    (kidsOf[nid] || []).forEach((k) => collect(k).forEach((q) => set.add(q)));
    sub[nid] = set;
    return set;
  };
  list.forEach((n) => collect(n.id));
  return ok(res, { list: list.map((n) => ({ ...n, qcount: (sub[n.id] || new Set()).size, qcount_own: (own[n.id] || new Set()).size })) });
});

admin.post('/trees/:id/nodes', (req, res) => {
  const treeId = int(req.params.id);
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, '请填写节点名称');
  const parentId = b.parent_id ? int(b.parent_id) : null;
  const info = db.prepare('INSERT INTO bank_tree_nodes (tree_id, parent_id, name, sort, created_at) VALUES (?,?,?,?,?)')
    .run(treeId, parentId, name, int(b.sort), now());
  return ok(res, { id: info.lastInsertRowid }, '节点已添加');
});

admin.put('/nodes/:id', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const n = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=?').get(id);
  if (!n) return fail(res, '节点不存在');
  if (b.name !== undefined) db.prepare('UPDATE bank_tree_nodes SET name=? WHERE id=?').run(String(b.name).trim() || n.name, id);
  if (b.parent_id !== undefined) {
    const pid = b.parent_id ? int(b.parent_id) : null;
    if (pid === id) return fail(res, '不能挂到自己下面');
    // 防环：新父节点不能是自己的子孙
    const walk = db.prepare('SELECT id, parent_id FROM bank_tree_nodes WHERE tree_id=?');
    const all = walk.all(n.tree_id);
    const kids = {};
    all.forEach((x) => { if (x.parent_id) (kids[x.parent_id] = kids[x.parent_id] || []).push(x.id); });
    const stack = [id]; const ban = new Set([id]);
    while (stack.length) {
      const cur = stack.pop();
      (kids[cur] || []).forEach((k) => { if (!ban.has(k)) { ban.add(k); stack.push(k); } });
    }
    if (pid && ban.has(pid)) return fail(res, '不能挂到自己的子节点下（会形成环）');
    db.prepare('UPDATE bank_tree_nodes SET parent_id=? WHERE id=?').run(pid, id);
  }
  if (b.sort !== undefined) db.prepare('UPDATE bank_tree_nodes SET sort=? WHERE id=?').run(int(b.sort), id);
  return ok(res, null, '已保存');
});

/** 同级内上移 / 下移一位。种子数据里同级 sort 常是同一个值，所以先把同级顺序规范成 0..n-1 再对调 */
admin.post('/nodes/:id/move', (req, res) => {
  const id = int(req.params.id);
  const dir = String((req.body || {}).dir || '');
  if (dir !== 'up' && dir !== 'down') return fail(res, 'dir 应为 up 或 down');
  const n = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=?').get(id);
  if (!n) return fail(res, '节点不存在');
  const sibs = (n.parent_id == null
    ? db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id IS NULL ORDER BY sort, id').all(n.tree_id)
    : db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id=? ORDER BY sort, id').all(n.tree_id, n.parent_id)).map((r) => r.id);
  const i = sibs.indexOf(id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= sibs.length) return ok(res, null, dir === 'up' ? '已经在最前面了' : '已经在最后面了');
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  const up = db.prepare('UPDATE bank_tree_nodes SET sort=? WHERE id=?');
  sibs.forEach((nid, k) => up.run(k, nid));
  return ok(res, null, '已移动');
});

admin.delete('/nodes/:id', (req, res) => {
  const id = int(req.params.id);
  const n = db.prepare('SELECT * FROM bank_tree_nodes WHERE id=?').get(id);
  if (!n) return fail(res, '节点不存在');
  const all = db.prepare('SELECT id, parent_id FROM bank_tree_nodes WHERE tree_id=?').all(n.tree_id);
  const kids = {};
  all.forEach((x) => { if (x.parent_id) (kids[x.parent_id] = kids[x.parent_id] || []).push(x.id); });
  const del = new Set([id]); const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    (kids[cur] || []).forEach((k) => { if (!del.has(k)) { del.add(k); stack.push(k); } });
  }
  const delLink = db.prepare('DELETE FROM question_nodes WHERE node_id=?');
  const delNode = db.prepare('DELETE FROM bank_tree_nodes WHERE id=?');
  del.forEach((nid) => { delLink.run(nid); delNode.run(nid); });
  return ok(res, null, `已删除 ${del.size} 个节点`);
});

admin.get('/questions/:id/nodes', (req, res) => {
  const qid = int(req.params.id);
  return ok(res, { nodes: db.prepare('SELECT node_id FROM question_nodes WHERE question_id=?').all(qid).map((r) => r.node_id) });
});

/** 覆盖式设置某题的树节点 */
admin.post('/questions/:id/nodes', (req, res) => {
  const qid = int(req.params.id);
  const ids = (req.body || {}).node_ids || [];
  db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(qid);
  const ins = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
  ids.map(int).filter(Boolean).forEach((nid) => ins.run(qid, nid));
  return ok(res, null, '归属已更新');
});

// ==================================================================== 题目
/** 列表：学科/学段/年级/题型/难度/关键词/标签/来源/目录节点（含子树） */
admin.get('/questions', (req, res) => {
  const q = req.query || {};
  const page = Math.max(1, int(q.page, 1));
  const size = Math.min(100, Math.max(1, int(q.size, 10)));
  const where = []; const args = [];
  const like = (col, val) => { where.push(`${col} LIKE ?`); args.push(`%${val}%`); };
  if (q.subject) { where.push('q.subject=?'); args.push(String(q.subject)); }
  if (q.stage) { where.push('q.stage=?'); args.push(String(q.stage)); }
  if (q.grade) { where.push('q.grade=?'); args.push(String(q.grade)); }
  if (q.type) { where.push('q.type=?'); args.push(String(q.type)); }
  if (q.difficulty) { where.push('q.difficulty=?'); args.push(int(q.difficulty)); }
  if (q.source_type) { where.push("IFNULL(q.source_type,'local')=?"); args.push(String(q.source_type)); }
  // 齐全度：full=答案解析都有 / noans=缺答案 / noana=缺解析
  if (q.complete === 'full') { where.push("IFNULL(q.answer,'')<>'' AND IFNULL(q.analysis,'')<>''"); }
  else if (q.complete === 'noans') { where.push("IFNULL(q.answer,'')=''"); }
  else if (q.complete === 'noana') { where.push("IFNULL(q.analysis,'')=''"); }
  // 未分类：缺章节挂载或缺知识点挂载（两种分类都要挂），且不是待审核的学生上传题（那些在「待审核」里核对）
  if (String(q.uncat) === '1') {
    where.push("NOT EXISTS (SELECT 1 FROM question_nodes qnx JOIN bank_tree_nodes bnx ON bnx.id=qnx.node_id JOIN bank_trees btx ON btx.id=bnx.tree_id WHERE qnx.question_id=q.id AND btx.kind='textbook')");
    where.push("NOT EXISTS (SELECT 1 FROM question_nodes qny JOIN bank_tree_nodes bny ON bny.id=qny.node_id JOIN bank_trees bty ON bty.id=bny.tree_id WHERE qny.question_id=q.id AND bty.kind='knowledge')");
    where.push("NOT EXISTS (SELECT 1 FROM paper_uploads pux WHERE pux.question_id=q.id AND pux.status IN ('pending','reviewed'))");
  }
  if (q.kw) {
    const kw = String(q.kw).trim();
    where.push('(q.stem LIKE ? OR q.stem_html LIKE ? OR q.answer LIKE ? OR q.analysis LIKE ? OR q.point LIKE ? OR CAST(q.id AS CHAR) LIKE ?)');
    args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, kw.replace(/^#0*/, ''));
  }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM question_tags t WHERE t.question_id=q.id AND t.tag=?)'); args.push(String(q.tag)); }
  let join = ''; const joinArgs = [];
  // 章节树/知识点筛选：node=单节点 或 nodes=逗号分隔多节点，都按子树（含下级挂题）匹配
  const nodeReq = [];
  if (q.node) nodeReq.push(int(q.node));
  if (q.nodes) String(q.nodes).split(',').map((x) => int(x)).filter(Boolean).forEach((x) => nodeReq.push(x));
  if (nodeReq.length) {
    const allNodes = db.prepare('SELECT id, parent_id FROM bank_tree_nodes').all();
    const kids = {}; allNodes.forEach((n) => { if (n.parent_id) (kids[n.parent_id] = kids[n.parent_id] || []).push(n.id); });
    const set = new Set();
    for (const nid of nodeReq) {
      if (set.has(nid)) continue;
      set.add(nid); const stack = [nid];
      while (stack.length) { // 完整子树递归（年级→册别→单元→小节共四层）
        const cur = stack.pop();
        (kids[cur] || []).forEach((k) => { if (!set.has(k)) { set.add(k); stack.push(k); } });
      }
    }
    if (set.size) {
      const ids = [...set];
      join = ` INNER JOIN question_nodes qn ON qn.question_id=q.id AND qn.node_id IN (${ids.map(() => '?').join(',')})`;
      joinArgs.push(...ids);
    }
  }
  const all = [...joinArgs, ...args];
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(DISTINCT q.id) AS c FROM questions q${join} ${w}`).get(...all).c;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, pages);
  const list = db.prepare(`SELECT q.* FROM questions q${join} ${w}
    GROUP BY q.id ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...all, size, (p - 1) * size);
  const tagRows = db.prepare(`SELECT question_id, tag FROM question_tags WHERE question_id IN (${list.map(() => '?').join(',') || '0'})`)
    .all(...(list.map((r) => r.id).length ? list.map((r) => r.id) : [0]));
  const tagMap = {};
  tagRows.forEach((r) => { (tagMap[r.question_id] = tagMap[r.question_id] || []).push(r.tag); });
  // 挂载状态：每题是否已挂 章节分类 / 知识点分类（两种都要挂）
  const ids = list.map((r) => r.id);
  const mountMap = {};
  if (ids.length) {
    db.prepare(`SELECT qn.question_id AS qid, bt.kind AS kind FROM question_nodes qn
      JOIN bank_tree_nodes bn ON bn.id=qn.node_id JOIN bank_trees bt ON bt.id=bn.tree_id
      WHERE qn.question_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      .forEach((r) => { mountMap[r.qid] = mountMap[r.qid] || {}; mountMap[r.qid][r.kind] = true; });
  }
  return ok(res, {
    page: p, size, total, pages,
    list: list.map((r) => ({ ...decorate(r), tags: tagMap[r.id] || [], mount: { chapter: !!(mountMap[r.id] && mountMap[r.id].textbook), knowledge: !!(mountMap[r.id] && mountMap[r.id].knowledge) } })),
  });
});

admin.get('/questions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM questions WHERE id=?').get(int(req.params.id));
  if (!row) return fail(res, '题目不存在');
  return ok(res, { question: decorate(row, { tags: true, nodes: true }) });
});

/** 听力题的音频 key（T7）：只认题库音频目录（bank/audio/…）下的 key，防止题目指到视频 / 别的目录的文件上去 */
function audioKeyOf(v) {
  const k = String(v == null ? '' : v).trim();
  if (!k) return '';
  return k.startsWith(bankFolder() + '/audio/') && !k.includes('..') ? k.slice(0, 255) : '';
}

/** 新增/编辑：字段与老题库一致（学生端判分链路共用 questions 表），另外支持富文本题干与来源 */
function normalizeQ(b) {
  const stem = String(b.stem || '').trim();
  const stemHtml = String(b.stem_html || '').trim();
  if (!stem && !stemHtml) return { err: '请填写题干' };
  const type = TYPES.includes(b.type) ? b.type : 'single';
  let options = Array.isArray(b.options) ? b.options : parseArr(b.options);
  options = options.map((o) => (typeof o === 'string' ? { label: '', text: o } : { label: String(o.label || ''), text: String(o.text || o.html || o.content || '') }))
    .filter((o) => String(o.text).trim());
  if ((type === 'single' || type === 'multi') && options.length < 2) return { err: '选择题至少要有两个选项' };
  const answer = String(b.answer || '').trim(); // 允许为空：入库后算「缺答案」，走齐全度筛选处理
  return {
    q: {
      subject: String(b.subject || '').trim(),
      stage: String(b.stage || '').trim(),
      grade: String(b.grade || '').trim(),
      type,
      stem: stem || stemHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      stem_html: stemHtml,
      options: jstr(options),
      answer,
      analysis: String(b.analysis || '').trim(),
      difficulty: Math.min(5, Math.max(1, int(b.difficulty, 3))),
      point: String(b.point || '').trim(),
      material: String(b.material || '').trim(),
      source: String(b.source || '').trim(),
      year: String(b.year || '').trim(),
      images: jstr(Array.isArray(b.images) ? b.images : parseArr(b.images)),
      audio_key: audioKeyOf(b.audio_key),
      source_type: ['local', 'capture', 'recog'].includes(b.source_type) ? b.source_type : 'local',
      source_detail: jstr(b.source_detail && typeof b.source_detail === 'object' ? b.source_detail : {}),
      created_at: now(),
    },
  };
}

admin.post('/questions', (req, res) => {
  const { q, err } = normalizeQ(req.body || {});
  if (err) return fail(res, err);
  const info = db.prepare(`INSERT INTO questions (subject, stage, grade, type, stem, stem_html, options, answer, analysis,
    difficulty, point, material, source, year, images, audio_key, source_type, source_detail, sort, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
    .run(q.subject, q.stage, q.grade, q.type, q.stem, q.stem_html, q.options, q.answer, q.analysis,
      q.difficulty, q.point, q.material, q.source, q.year, q.images, q.audio_key, q.source_type, q.source_detail, q.created_at);
  const id = info.lastInsertRowid;
  const tags = (req.body || {}).tags || [];
  const ins = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
  (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean).forEach((t) => ins.run(id, t));
  const nodes = (req.body || {}).nodes || [];
  const ins2 = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
  (Array.isArray(nodes) ? nodes : []).map(int).filter(Boolean).forEach((n) => ins2.run(id, n));
  return ok(res, { id }, '题目已入库');
});

admin.put('/questions/:id', (req, res) => {
  const id = int(req.params.id);
  const old = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!old) return fail(res, '题目不存在');
  const body = { ...req.body };
  if (body.subject === undefined) body.subject = old.subject;
  if (body.audio_key === undefined) body.audio_key = old.audio_key;   // 没传 = 不动音频；传空串 = 去掉音频
  const { q, err } = normalizeQ(body);
  if (err) return fail(res, err);
  db.prepare(`UPDATE questions SET subject=?, stage=?, grade=?, type=?, stem=?, stem_html=?, options=?, answer=?,
    analysis=?, difficulty=?, point=?, material=?, source=?, year=?, images=?, audio_key=?, source_type=?, source_detail=? WHERE id=?`)
    .run(q.subject, q.stage, q.grade, q.type, q.stem, q.stem_html, q.options, q.answer, q.analysis,
      q.difficulty, q.point, q.material, q.source, q.year, q.images, q.audio_key, q.source_type, q.source_detail, id);
  if (Array.isArray(req.body.tags)) {
    db.prepare('DELETE FROM question_tags WHERE question_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
    req.body.tags.map((t) => String(t).trim()).filter(Boolean).forEach((t) => ins.run(id, t));
  }
  if (Array.isArray(req.body.nodes)) {
    db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
    req.body.nodes.map(int).filter(Boolean).forEach((n) => ins.run(id, n));
  }
  return ok(res, null, '已保存');
});

admin.delete('/questions/:id', (req, res) => {
  const id = int(req.params.id);
  db.prepare('DELETE FROM question_tags WHERE question_id=?').run(id);
  db.prepare('DELETE FROM question_nodes WHERE question_id=?').run(id);
  db.prepare('DELETE FROM mf_paper_questions WHERE question_id=?').run(id);
  db.prepare('DELETE FROM questions WHERE id=?').run(id);
  return ok(res, null, '已删除');
});

/** 批量操作：delete 删除 / tag 打标 / untag 去标 / node 挂树 / field 改学科年级难度 */
admin.post('/questions/batch', (req, res) => {
  const b = req.body || {};
  const ids = (b.ids || []).map(int).filter(Boolean);
  if (!ids.length) return fail(res, '请先勾选题目');
  const ph = ids.map(() => '?').join(',');
  const op = String(b.op || '');
  if (op === 'delete') {
    db.prepare(`DELETE FROM question_tags WHERE question_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM question_nodes WHERE question_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM mf_paper_questions WHERE question_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM questions WHERE id IN (${ph})`).run(...ids);
    return ok(res, null, `已删除 ${ids.length} 题`);
  }
  if (op === 'tag' || op === 'untag') {
    const tags = (b.tags || []).map((t) => String(t).trim()).filter(Boolean);
    if (!tags.length) return fail(res, '请填写标签');
    if (op === 'tag') {
      const ins = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
      ids.forEach((id) => tags.forEach((t) => ins.run(id, t)));
    } else {
      const del = db.prepare('DELETE FROM question_tags WHERE question_id=? AND tag=?');
      ids.forEach((id) => tags.forEach((t) => del.run(id, t)));
    }
    return ok(res, null, `已${op === 'tag' ? '打标' : '去掉标签'}：${tags.join('、')}`);
  }
  if (op === 'node') {
    const nodes = (b.nodes || []).map(int).filter(Boolean);
    if (!nodes.length) return fail(res, '请选择要挂到的节点');
    const ins = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
    ids.forEach((id) => nodes.forEach((n) => ins.run(id, n)));
    return ok(res, null, `已挂到 ${nodes.length} 个节点`);
  }
  if (op === 'field') {
    const sets = []; const args = [];
    for (const k of ['subject', 'stage', 'grade', 'difficulty', 'type']) {
      if (b[k] !== undefined && b[k] !== '') { sets.push(`${k}=?`); args.push(k === 'difficulty' ? int(b[k]) : String(b[k])); }
    }
    if (!sets.length) return fail(res, '没有要修改的字段');
    args.push(...ids);
    db.prepare(`UPDATE questions SET ${sets.join(',')} WHERE id IN (${ph})`).run(...args);
    return ok(res, null, `已更新 ${ids.length} 题`);
  }
  return fail(res, '未知操作');
});

admin.get('/tags', (req, res) => {
  const rows = db.prepare('SELECT tag, COUNT(*) AS c FROM question_tags GROUP BY tag ORDER BY c DESC, tag').all();
  return ok(res, { list: rows });
});

/** 导出：JSON（含选项/答案/解析/标签/树节点），可带与列表相同的筛选条件 */
admin.get('/questions-export', (req, res) => {
  const q = req.query || {};
  const where = []; const args = [];
  if (q.subject) { where.push('subject=?'); args.push(q.subject); }
  if (q.stage) { where.push('stage=?'); args.push(q.stage); }
  if (q.type) { where.push('type=?'); args.push(q.type); }
  if (q.node) {
    where.push('EXISTS (SELECT 1 FROM question_nodes n WHERE n.question_id=questions.id AND n.node_id=?)');
    args.push(int(q.node));
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM questions ${w} ORDER BY id DESC LIMIT 5000`).all(...args);
  const list = rows.map((r) => {
    const d = decorate(r, { tags: true, nodes: true });
    return {
      id: d.id, subject: d.subject, stage: d.stage, grade: d.grade, type: d.type,
      stem: d.stem, stem_html: d.stem_html, options: d.options, answer: d.answer,
      analysis: d.analysis, difficulty: d.difficulty, point: d.point, images: d.images,
      tags: d.tags, nodes: d.nodes, source_type: d.source_type, source_detail: d.source_detail,
    };
  });
  return ok(res, { list, exported_at: now() });
});

/** AI 清洗：把采集来的脏 HTML 题干/答案/解析洗成干净文本（公式用 LaTeX 包起来），只处理一题 */
admin.post('/ai-clean', async (req, res) => {
  try {
    const b = req.body || {};
    const id = int(b.id);
    const row = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
    if (!row) return fail(res, '题目不存在');
    const field = ['stem', 'answer', 'analysis'].includes(b.field) ? b.field : 'stem';
    const raw = String(b.html || row.stem_html || row[field] || '').trim();
    if (!raw) return fail(res, '没有可清洗的内容');
    const sys = '你是题库清洗助手。把带噪的 HTML 试题内容整理成规范内容，只输出 JSON：{"text":"纯文本题干（公式用 $...$ 包裹的 LaTeX，图片写成 [图1]）","latex":"若整段就是单个公式则给 LaTeX，否则空字符串"}。不要解释。';
    // 优先走五角色模型档案（R1 推理），未配置时回落内置 AI 配置
    let text;
    try {
      const mf = require('./mfcollect');
      ({ text } = await mf.mfAiInvoke({ role: 'reasoning', system: sys, user: raw.slice(0, 6000), maxTokens: 1200, temperature: 0.1 }));
    } catch (e) {
      ({ text } = await aiLib.chat({ system: sys, user: raw.slice(0, 6000), maxTokens: 1200, temperature: 0.1 }));
    }
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
    const body = fence ? fence[1] : String(text || '');
    const a = body.indexOf('{'), b2 = body.lastIndexOf('}');
    if (a < 0 || b2 <= a) return fail(res, 'AI 返回格式异常，请重试');
    const j = JSON.parse(body.slice(a, b2 + 1));
    return ok(res, { text: String(j.text || '').trim(), latex: String(j.latex || '').trim() }, 'AI 已清洗');
  } catch (e) {
    return fail(res, 'AI 清洗失败：' + e.message);
  }
});

// ==================================================================== 网络采集
/**
 * Web 环境没有 Electron 的 webview，无法直接注入脚本读第三方站点 DOM，
 * 因此改成三条可行链路，功能等价：
 *  ① 书签小工具：老师在浏览器收藏夹里点一下，脚本在组卷网/菁优网当前页 DOM 里抽题并 POST 回服务器
 *  ② 粘贴网页源码：把网页「另存为/查看源代码」的 HTML 或复制的纯文本粘进来，服务端解析
 *  ③ 抓取 URL（best effort）：服务端直接拉页面，遇到登录墙会明确提示走 ①②
 */
const SITES = { zujuan: '组卷网', jyeoo: '菁优网', generic: '通用网页' };

/** 极简 HTML → 文本（不引第三方解析库；保留公式/图片的占位） */
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<img[^>]*>/gi, '[图]');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch (e) { return m; } });
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** 规则切题（移植魔方 recog/segmentation/rule.ts 的核心）：题号起始 + 选项 + 答案/解析 */
const Q_START = /^\s*(\d{1,3})\s*[.、．](?!\d)\s*/;
const Q_START_HYPHEN = /^\s*(\d{1,3})\s*[-–−－]\s*(\d{1,3})\s*/;
const OPT_RE = /^\s*[A-E]\s*[.、．]\s*/;
const ANSWER_RE = /^(【答案】|答案\s*[:：]|参考答案\s*[:：])/;
const ANALYSIS_RE = /^(【解析】|解析\s*[:：]|详解\s*[:：])/;

function splitQuestions(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  let seenNum = false;                       // 是否已见过带题号的行（之前的散行视为卷头，不入库）
  const push = () => {
    if (cur && (cur.no || cur.options.length || seenNum) && (cur.stem || cur.options.length)) out.push(cur);
    cur = null;
  };
  for (const line of lines) {
    if (Q_START.test(line) || Q_START_HYPHEN.test(line)) {
      push();
      seenNum = true;
      cur = { no: line.match(Q_START)?.[1] || line.match(Q_START_HYPHEN)?.[2] || '', stem: line.replace(Q_START, '').replace(Q_START_HYPHEN, '').trim(), options: [], answer: '', analysis: '' };
      continue;
    }
    if (!cur) { cur = { no: '', stem: line, options: [], answer: '', analysis: '' }; continue; }
    if (OPT_RE.test(line) && line.length < 200) {
      // 选项可能挤在一行：「A. xx　B. xx　C. xx」→ 按后续 B/C/D/E 标记拆开
      const parts = line.replace(OPT_RE, '').split(/\s+(?=[B-E]\s*[.、．])/).map((s) => s.trim()).filter(Boolean);
      cur.options.push(...parts);
      continue;
    }
    if (ANSWER_RE.test(line)) { cur.answer = line.replace(ANSWER_RE, '').trim(); continue; }
    if (ANALYSIS_RE.test(line)) { cur.analysis = line.replace(ANALYSIS_RE, '').trim(); continue; }
    if (cur.analysis) cur.analysis += ' ' + line;
    else if (cur.answer && !cur.stem.endsWith('?') && /^[A-E]{1,4}$/.test(line)) cur.answer = line;
    else cur.stem += (cur.stem ? ' ' : '') + line;
  }
  push();
  // 题型猜测
  return out.map((q) => {
    let type = 'answer';
    if (q.options.length >= 2) type = /^[A-E]{2,}$/.test(String(q.answer || '').toUpperCase()) ? 'multi' : 'single';
    else if (/^[对错是否TF]+$/.test(String(q.answer || ''))) type = 'judge';
    else if (/_+|＿+|____/.test(q.stem)) type = 'fill';
    return { ...q, type };
  });
}

/** 从 HTML 里抽图片地址（绝对化） */
function extractImages(html, baseUrl) {
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 30) {
    let src = m[1];
    if (/^data:/i.test(src)) continue;
    try { src = new URL(src, baseUrl || undefined).href; } catch (e) { /* 保持原样 */ }
    out.push(src);
  }
  return out;
}

/** 站点识别（移植魔方 state.ts 的 detectSite 思路） */
function detectSite(url, html) {
  const u = String(url || '').toLowerCase();
  if (u.includes('xkw.com')) return 'zujuan';
  if (u.includes('jyeoo.com')) return 'jyeoo';
  const h = String(html || '').toLowerCase();
  if (h.includes('zujuan') || h.includes('xkw.com')) return 'zujuan';
  if (h.includes('jyeoo')) return 'jyeoo';
  return 'generic';
}

admin.post('/capture/parse', (req, res) => {
  const b = req.body || {};
  const html = String(b.html || '');
  const text = String(b.text || '');
  if (!html && !text) return fail(res, '请粘贴网页源码或题目文本');
  const site = detectSite(b.url, html) === 'generic' && b.site ? String(b.site) : detectSite(b.url, html);
  const plain = text || htmlToText(html);
  const qs = splitQuestions(plain);
  if (!qs.length) return fail(res, '没能从这段内容里认出题目（试试粘贴纯文本，或确认内容带题号）');
  const imgs = html ? extractImages(html, b.url) : [];
  return ok(res, {
    site, site_name: SITES[site] || site,
    questions: qs.map((q, i) => ({
      key: `${site}-${Date.now()}-${i}`,
      questionId: `${site}-${require('crypto').createHash('md5').update((q.stem || '') + '|' + (q.no || '')).digest('hex').slice(0, 16)}`,
      site,
      sourceUrl: String(b.url || ''),
      stemHtml: '',
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      analysis: q.analysis,
      type: q.type,
      images: imgs.length ? imgs.slice(0, 3) : [],
      meta: { questionType: q.type, source: '' },
    })),
  }, `解析出 ${qs.length} 题`);
});

/** 书签小工具用的上传票据（90 天），脚本在浏览器里带着它回传题目 */
admin.get('/capture/token', (req, res) => {
  try {
    const secret = require('fs').readFileSync(require('path').join(require('./db').DATA_DIR, '.secret'), 'utf8').trim();
    const token = jwt.sign({ id: req.user && req.user.id, role: 'mfcapture', name: '采集小工具' }, secret, { expiresIn: '90d' });
    return ok(res, { token });
  } catch (e) {
    return fail(res, '票据生成失败：' + e.message);
  }
});

/** 书签小工具脚本：老师把下面生成的 JS 存成收藏夹，点一下就把当前页的题收进采集篮 */
admin.get('/capture/bookmarklet', (req, res) => {
  const base = String(req.query.base || '').replace(/\/+$/, '');
  return ok(res, { js: buildBookmarklet(base) });
});

function buildBookmarklet(base) {
  return `javascript:(function(){
var API='${base}/api/mfcap/push';
var TOKEN=null;
try{TOKEN=localStorage.getItem('mfcap_token')}catch(e){}
if(!TOKEN){TOKEN=prompt('第一次使用：请粘贴采集票据（后台「网络采集 → 书签小工具 → 生成采集票据」里复制，只需填这一次，之后自动记住）');}
if(!TOKEN)return;
TOKEN=String(TOKEN).replace(/^bearer\\s+/i,'').replace(/^Bearer\\s+/,'').replace(/[^!-~]/g,'');
if(!TOKEN){alert('票据格式不对：请到后台「网络采集 → 书签小工具 → 生成采集票据」重新复制，注意整串复制、不要带上中文或多余文字');return}
try{localStorage.setItem('mfcap_token',TOKEN)}catch(e){}
var host=location.hostname||'';
var site=host.indexOf('xkw.com')>=0?'zujuan':(host.indexOf('jyeoo.com')>=0?'jyeoo':'generic');
var qs=[];
function txt(el){return el?el.innerText.replace(/\\s+/g,' ').trim():''}
function md5(s){var h=0;for(var i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i);h|=0}return (h>>>0).toString(16)}
try{
 if(site==='zujuan'){
  document.querySelectorAll('.quest-basket .mini-quest-item,.quest-basket .tk-mini-quest,.exam-item').forEach(function(el,i){
   var qid=el.getAttribute('data-questionid')||el.getAttribute('questionid')||('zj-'+i);
   var stem=txt(el.querySelector('.exam-item__cnt'))||txt(el);
   if(!stem)return;
   var opts=[];el.querySelectorAll('.option,.selectoption,td').forEach(function(o){var t=txt(o);if(t)opts.push(t.replace(/^[A-E][.、．]\\s*/,''))});
   qs.push({questionId:String(qid),stem:stem,options:opts.slice(0,6),
     type:(el.querySelector('.ques-type')?txt(el.querySelector('.ques-type')):''),
     difficulty:(el.querySelector('.ques-hard')?txt(el.querySelector('.ques-hard')):''),
     knowledge:[].slice.call(el.querySelectorAll('.knowledge-name')).map(txt).filter(Boolean),
     answer:'',analysis:''});
  });
 }else if(site==='jyeoo'){
  document.querySelectorAll('fieldset.quesborder,.ques-basket .basket-list fieldset').forEach(function(el,i){
   var p1=el.querySelector('.pt1');if(!p1)return;
   var clone=p1.cloneNode(true);clone.querySelectorAll('.qseq,.ques-source,.sanwser').forEach(function(n){n.remove()});
   var stem=txt(clone);if(!stem)return;
   var opts=[];el.querySelectorAll('.pt2 td.selectoption label,.pt2 label').forEach(function(o){var t=txt(o);if(t)opts.push(t.replace(/^[A-E][.、．]\\s*/,''))});
   qs.push({questionId:'jyeoo-'+md5(stem+opts.join('')),stem:stem,options:opts.slice(0,6),type:'',difficulty:'',knowledge:[],answer:'',analysis:''});
  });
 }else{
  var sel=window.getSelection?String(window.getSelection()):'';
  if(sel)qs.push({questionId:'sel-'+md5(sel).slice(0,12),stem:sel,options:[],type:'',difficulty:'',knowledge:[],answer:'',analysis:''});
 }
}catch(e){alert('采集出错：'+e.message);return}
if(!qs.length){
  var sel=window.getSelection?String(window.getSelection()):'';
  if(sel&&sel.length>10)qs.push({questionId:'sel-'+md5(sel).slice(0,12),stem:sel,options:[],type:'',difficulty:'',knowledge:[],answer:'',analysis:''});
}
if(!qs.length){alert('这一页没找到题目。请先在组卷网/菁优网把题加进试题篮再点书签；或用鼠标选中题目文字后保持选中，再点一次书签。');return}
function goHash(){
  var payload=JSON.stringify({site:site,url:location.href,title:document.title,questions:qs});
  if(payload.length>150000){alert('这次采的题太多（数据太大），请少选一些题、分几批采集');return}
  var w=window.open('${base}/admin/#/mfcap?d='+encodeURIComponent(payload),'_blank');
  alert(w?'浏览器直连被拦（组卷网是 https、后台是 http），已改走「打开后台接收」通道：请在刚打开的智学课堂标签页里查看入库结果':'浏览器拦截了新窗口，请在地址栏右侧允许弹窗后重试');
}
var tokenBad=false;
fetch(API,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+TOKEN},
 body:JSON.stringify({site:site,url:location.href,title:document.title,questions:qs})})
 .then(function(r){tokenBad=(r.status===401);return r.json()}).then(function(j){
  if(j&&j.code===0){alert('已收到 '+qs.length+' 题，批次《'+j.data.title+'》已存进采集篮，去后台核对入库吧');}
  else{
   alert('回传失败：'+(j&&j.msg||'未知错误')+'（本地票据没有被清除）');
   if(tokenBad&&confirm('服务器说采集票据无效或已过期。要现在清除本地票据、下次点书签时重新粘贴吗？')){try{localStorage.removeItem('mfcap_token')}catch(e){}}
  }
 }).catch(function(e){goHash();});
})();`;
}

/** 小工具/外部回传入口：单独一个路由（票据 role=mfcapture，不给后台权限），由 app.js 挂到 /api/mfcap */
const cap = express.Router();
/** CORS：书签脚本在第三方页面（组卷网等）里跨域回传。只放行 POST/OPTIONS 和 Authorization/Content-Type 头；
 *  票据放在 Authorization 头里、不依赖 Cookie，所以允许任意来源不会带出后台登录态。预检在鉴权之前直接应答。 */
cap.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
cap.use((req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || '');
  if (!token) return fail(res, '缺少采集票据', 401);
  try {
    const secret = require('fs').readFileSync(require('path').join(require('./db').DATA_DIR, '.secret'), 'utf8').trim();
    const u = jwt.verify(token, secret);
    if (!u || u.role !== 'mfcapture') return fail(res, '采集票据无效', 401);
    req.user = u;
    next();
  } catch (e) {
    return fail(res, '采集票据无效或已过期', 401);
  }
});
cap.post('/push', (req, res) => {
  const b = req.body || {};
  const qs = b.questions || [];
  if (!Array.isArray(qs) || !qs.length) return fail(res, '没有题目数据');
  const site = String(b.site || 'generic');
  const title = String(b.title || `${SITES[site] || site}采集 ${qs.length} 题`).slice(0, 100);
  // 若最新有一个「空试题篮」（新建试题篮建出的待填篮），题目直接填进去，不再另开新批次
  const emptyB = db.prepare("SELECT id FROM mf_capture_batches WHERE status='pending' AND IFNULL(paper_mode,0)=0 AND (payload IS NULL OR payload='' OR payload='[]') ORDER BY id DESC LIMIT 1").get();
  if (emptyB) {
    db.prepare('UPDATE mf_capture_batches SET title=?, site=?, url=?, payload=? WHERE id=?')
      .run(title, site, String(b.url || '').slice(0, 500), jstr(qs), emptyB.id);
    return ok(res, { id: emptyB.id, title, count: qs.length }, `已收进试题篮（${qs.length} 题）`);
  }
  const info = db.prepare('INSERT INTO mf_capture_batches (title, site, url, subject, stage, grade, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(title, site, String(b.url || '').slice(0, 500), String(b.subject || '').trim(), String(b.stage || '').trim(), String(b.grade || '').trim(), jstr(qs), 'pending', now());
  return ok(res, { id: info.lastInsertRowid, title, count: qs.length }, `已收到 ${qs.length} 题`);
});

/** 后台自己粘贴/解析出的题目 → 存成批次（与小工具回传共用一张表）
 *  - paper_mode=1：整卷下载批次，不占试题篮；basket=1：建一个空试题篮（悬浮球/一键采集的题会填进最新的空篮） */
admin.post('/capture/batches', (req, res) => {
  const b = req.body || {};
  const qs = Array.isArray(b.questions) ? b.questions : [];
  const basket = b.basket === 1 || b.basket === true;
  if (!qs.length && !basket) return fail(res, '没有题目数据');
  const site = String(b.site || 'generic');
  const title = String(b.title || (basket ? '试题篮' : `${SITES[site] || site}采集 ${qs.length} 题`)).slice(0, 100);
  const info = db.prepare('INSERT INTO mf_capture_batches (title, site, url, subject, stage, grade, payload, status, paper_mode, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(title, site, String(b.url || '').slice(0, 500), String(b.subject || '').trim(), String(b.stage || '').trim(), String(b.grade || '').trim(), jstr(qs), 'pending', b.paper_mode ? 1 : 0, now());
  return ok(res, { id: info.lastInsertRowid, title, count: qs.length }, basket ? '新试题篮已建好' : `已存为采集批次（${qs.length} 题）`);
});

admin.get('/capture/batches', (req, res) => {
  const rows = db.prepare('SELECT * FROM mf_capture_batches ORDER BY id DESC LIMIT 100').all();
  const incQ = String((req.query || {}).questions || '') === '1';
  return ok(res, { list: rows.map((r) => ({ ...r, count: parseArr(r.payload).length, questions: incQ && r.status === 'pending' ? parseArr(r.payload) : undefined })) });
});

admin.get('/capture/batches/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(int(req.params.id));
  if (!r) return fail(res, '批次不存在');
  return ok(res, { batch: { ...r, questions: parseArr(r.payload) } });
});

admin.delete('/capture/batches/:id', (req, res) => {
  db.prepare('DELETE FROM mf_capture_batches WHERE id=?').run(int(req.params.id));
  return ok(res, null, '批次已删除');
});

/** 从试题篮批次里移除单题（按下标） */
admin.delete('/capture/batches/:id/q/:idx', (req, res) => {
  const r = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(int(req.params.id));
  if (!r) return fail(res, '批次不存在');
  const all = parseArr(r.payload);
  const idx = int(req.params.idx, -1);
  if (idx < 0 || idx >= all.length) return fail(res, '题目下标不存在');
  all.splice(idx, 1);
  db.prepare('UPDATE mf_capture_batches SET payload=? WHERE id=?').run(jstr(all), r.id);
  return ok(res, { count: all.length }, '已从试题篮移除');
});

/** 采集入库：按 site+questionId 去重；已有则只补缺（答案/解析/知识点），不覆盖老师改过的题干 */
/** 把采集到的题入库（整批提交与待审核页逐题入库共用）。picked 为 payload 里选中的题；已存在的题只补缺（答案/解析/知识点）。
 *  返回 { created, updated, skipped, ids } */
function commitCaptureItems(batch, picked, b) {
  b = b || {};
  const nodeIds = [].concat(b.node_id ? [b.node_id] : [], Array.isArray(b.node_ids) ? b.node_ids : []).map((x) => int(x)).filter(Boolean);
  const existRows = db.prepare("SELECT id, source_detail, source_type FROM questions WHERE source_type='capture'").all();
  const map = new Map();
  existRows.forEach((r) => {
    const d = parseObj(r.source_detail);
    if (d && d.site && d.questionId) map.set(`${d.site}:${d.questionId}`, r);
  });
  const ins = db.prepare(`INSERT INTO questions (subject, stage, grade, type, stem, stem_html, options, answer, analysis,
    difficulty, point, material, source, year, images, audio_key, source_type, source_detail, sort, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'capture', ?,0,?)`);
  const upd = db.prepare('UPDATE questions SET answer=?, analysis=?, point=? WHERE id=?');
  const insTag = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
  const insNode = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
  let created = 0, updated = 0, skipped = 0;
  const ids = [];
  picked.forEach((q) => {
    const key = `${q.site || batch.site}:${q.questionId || ''}`;
    if (!q.questionId || /^temp-/.test(String(q.questionId))) { skipped++; return; }
    const hit = map.get(key);
    const stem = String(q.stemHtml || q.stem || '').trim();
    if (!stem) { skipped++; return; }
    const options = (q.options || []).map((o) => ({ label: '', text: String(o || '').trim() })).filter((o) => o.text);
    let type = TYPES.includes(q.type) ? q.type : (options.length >= 2 ? (/^[A-E]{2,}$/.test(String(q.answer || '').toUpperCase()) ? 'multi' : 'single') : 'answer');
    if (hit) {
      let need = false;
      const old = db.prepare('SELECT answer, analysis, point FROM questions WHERE id=?').get(hit.id);
      const answer = String(q.answer || '').trim();
      const analysis = String(q.analysis || '').trim();
      const point = (q.meta && q.meta.knowledgePoints || []).join('、') || String(q.point || '').trim();
      if ((!old.answer && answer) || (!old.analysis && analysis) || (!old.point && point)) need = true;
      if (need) { upd.run(answer || old.answer, analysis || old.analysis, point || old.point, hit.id); updated++; } else { skipped++; }
      ids.push(hit.id);
    } else {
      const detail = jstr({
        site: q.site || batch.site, url: q.sourceUrl || batch.url,
        questionId: q.questionId, collectedAt: now(), bankid: (q.meta && q.meta.bankid) || '',
      });
      const info = ins.run(
        String(b.subject || batch.subject || '').trim(),
        String(b.stage || batch.stage || '').trim(),
        String(b.grade || batch.grade || '').trim(),
        type,
        stem.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        /<[a-z][\s\S]*>/i.test(stem) ? stem : '',
        jstr(options), String(q.answer || '').trim(), String(q.analysis || '').trim(),
        int(q.difficulty, 3), (q.meta && q.meta.knowledgePoints || []).join('、'),
        '', SITES[q.site || batch.site] || (q.site || batch.site), '', jstr([]), audioKeyOf(q.audio_key), detail, now());
      const newId = info.lastInsertRowid;
      created++;
      ids.push(newId);
      (q.meta && q.meta.knowledgePoints || []).forEach((t) => t && insTag.run(newId, String(t).trim()));
      nodeIds.forEach((n) => insNode.run(newId, n));
    }
    (b.tags || []).forEach((t) => t && insTag.run(ids[ids.length - 1], String(t).trim()));
  });
  return { created, updated, skipped, ids };
}

admin.post('/capture/batches/:id/commit', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const batch = db.prepare('SELECT * FROM mf_capture_batches WHERE id=?').get(id);
  if (!batch) return fail(res, '批次不存在');
  const all = parseArr(batch.payload);
  const picked = Array.isArray(b.selected) && b.selected.length
    ? all.filter((_, i) => b.selected.includes(i))
    : all;
  const { created, updated, skipped, ids } = commitCaptureItems(batch, picked, b);
  db.prepare('UPDATE mf_capture_batches SET status=? WHERE id=?').run('done', id);
  // 需要的话顺手挂进某张试卷
  if (b.paper_id) {
    const pid = int(b.paper_id);
    const pos = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM mf_paper_questions WHERE paper_id=?').get(pid).m;
    const insP = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, score, kind, created_at) VALUES (?,?,?,?, 'question',?)");
    ids.forEach((qid, i) => insP.run(pid, qid, pos + i + 1, num(b.score, 0), now()));
  }
  return ok(res, { created, updated, skipped, ids }, `入库完成：新增 ${created}、补缺 ${updated}、跳过 ${skipped}`);
});

/** 服务端抓取（best effort，Node 16 无全局 fetch，故直接用 http/https 模块） */
function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let mod;
    try { mod = require(url.startsWith('https') ? 'https' : 'http'); } catch (e) { return reject(e); }
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,*/*',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGet(new URL(res.headers.location, url).href, timeoutMs).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); if (chunks.length > 4000) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('超时')));
  });
}

admin.post('/capture/fetch', async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!/^https?:\/\//i.test(url)) return fail(res, '请填写正确的网址');
  try {
    const r = await httpGet(url);
    if (r.status >= 400) return fail(res, `对方返回 ${r.status}（多为登录墙/风控）。请用书签小工具或粘贴网页源码。`);
    return ok(res, { html: (r.body || '').slice(0, 2000000), status: r.status }, '已抓取，请点「解析」');
  } catch (e) {
    return fail(res, `没能直接抓取（${e.message}）。组卷网/菁优网需要登录态，请用书签小工具或粘贴网页源码。`);
  }
});

/** 把切好的题目映射成采集篮统一结构 */
function toCaptured(site, url, qs) {
  return qs.map((q, i) => ({
    key: `${site}-${Date.now()}-${i}`,
    questionId: `${site}-${require('crypto').createHash('md5').update((q.stem || '') + '|' + (q.no || '')).digest('hex').slice(0, 16)}`,
    site,
    sourceUrl: String(url || ''),
    stemHtml: '',
    stem: q.stem,
    options: q.options || [],
    answer: q.answer || '',
    analysis: q.analysis || '',
    type: q.type || 'answer',
    images: [],
    meta: { questionType: q.type || 'answer', source: '' },
  }));
}

/** AI 兜底识别：规则切题认不出时，把网页文本交给大模型抽成结构化题目 */
async function aiExtractQuestions(plain) {
  const aiLib = require('./ai');
  const text = String(plain || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 9000);
  if (text.length < 30) return [];
  const user = `从下面的网页文本中提取所有完整题目，严格输出 JSON 数组（不要输出其他文字），每个元素形如：
{"type":"single或multi或judge或fill或answer","stem":"题干","options":["选项A内容","选项B内容"],"answer":"答案","analysis":"解析"}
要求：选项只要内容、不带"A."前缀；没有的字段用空字符串或空数组；题干残缺或需要付费才可见的题不要收。
网页文本：
"""
${text}
"""`;
  const { text: out } = await aiLib.chat({
    system: '你是题库数据助手，从网页文本里提取题目并输出严格的 JSON。',
    user, maxTokens: 3000, temperature: 0.1,
  });
  const a = String(out || '').indexOf('['), b2 = String(out || '').lastIndexOf(']');
  if (a < 0 || b2 <= a) return [];
  let arr;
  try { arr = JSON.parse(out.slice(a, b2 + 1)); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  // 防幻觉：题干的核心片段必须真的在原文里（去空白标点后比对首/中/尾三段）
  const norm = (s) => String(s || '').replace(/[\s　，。：:；;、（）()【】\[\]「」""'.,!？?]/g, '');
  const src = norm(text);
  const inSrc = (v) => {
    const n = norm(v);
    if (n.length < 6) return false;
    for (const seg of [n.slice(0, 12), n.slice(Math.floor(n.length / 2) - 5, Math.floor(n.length / 2) + 7), n.slice(-12)]) {
      if (seg.length >= 6 && src.includes(seg)) return true;
    }
    return false;
  };
  return arr.map((q) => {
    const t = String((q || {}).type || '').trim();
    let type = ({ 单选: 'single', 单项选择题: 'single', 选择题: 'single', 多选: 'multi', 多项选择题: 'multi', 判断题: 'judge', 填空题: 'fill', 解答题: 'answer', 简答题: 'answer', 计算题: 'answer', 综合题: 'answer' })[t] || '';
    if (!['single', 'multi', 'judge', 'fill', 'answer'].includes(type)) {
      type = ['single', 'multi', 'judge', 'fill', 'answer'].includes(t.toLowerCase()) ? t.toLowerCase() : 'answer';
    }
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o).replace(/^\s*[A-Ea-e]\s*[.、．]\s*/, '').trim()).filter(Boolean) : [];
    const stem = String(q.stem || '').trim();
    if (!stem || stem.length < 6 || !inSrc(stem)) return null;   // 原文里找不到的题干 = AI 编的，丢弃
    return { no: '', stem, options: opts, answer: String(q.answer || '').trim(), analysis: String(q.analysis || '').trim(), type };
  }).filter(Boolean);
}

/** 一键采集：输入网址 → 服务端抓取 → 规则切题 → AI 兜底 → 直接返回题目 */
admin.post('/capture/auto', async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!/^https?:\/\//i.test(url)) return fail(res, '请填写正确的网址');
  let html = '';
  try {
    // 走代理通道（mfcollect.fetchPageAuto）：带站点 cookie jar + 服务端 WAF 挑战求解。
    // uid 用当前管理员——浏览器标签里攒下的 WAF/登录 cookie 都在同一 uid 的 jar 里。
    const mf = require('./mfcollect');
    const r = await mf.fetchPageAuto(url, {
      uid: Number(req.user && req.user.id) || 0,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', Accept: 'text/html,*/*' },
    });
    if (r.status >= 400) return fail(res, `对方返回 ${r.status}，多半是登录墙。组卷网/菁优网的试卷要先在浏览器登录后用「书签小工具」采集。`);
    html = mf.decodeBuf(r.buf, r.headers['content-type']) || '';
  } catch (e) {
    try {
      const r = await httpGet(url);
      if (r.status >= 400) return fail(res, `对方返回 ${r.status}，多半是登录墙。组卷网/菁优网的试卷要先在浏览器登录后用「书签小工具」采集。`);
      html = r.body || '';
    } catch (e2) {
      return fail(res, `抓取失败（${e2.message}）。该网站可能拒绝程序访问，请改用「书签小工具」或「粘贴网页源码」。`);
    }
  }
  const site = detectSite(url, html);
  const plain = htmlToText(html);
  let qs = splitQuestions(plain);
  let via = 'rule';
  if (qs.length < 2) {
    try {
      const aiQs = await aiExtractQuestions(plain);
      if (aiQs.length) { qs = aiQs; via = 'ai'; }
    } catch (e) { /* AI 不可用就按规则结果走 */ }
  }
  if (!qs.length) {
    return fail(res, '抓到了页面，但没认出题目。常见原因：①组卷网/菁优网未登录，页面只有登录墙——请在浏览器登录后用「书签小工具」；②页面是纯图片试卷——请用「录题工作台」拍照识别。');
  }
  return ok(res, {
    site, site_name: SITES[site] || site, via,
    questions: toCaptured(site, url, qs),
  }, `解析出 ${qs.length} 题${via === 'ai' ? '（AI 识别）' : ''}`);
});

// ==================================================================== 试卷管理
admin.get('/paper-folders', (req, res) => {
  const list = db.prepare('SELECT * FROM mf_paper_folders ORDER BY sort, id').all();
  const cnt = db.prepare('SELECT folder_id, COUNT(*) AS c FROM mf_papers WHERE status<>? GROUP BY folder_id').all('trashed');
  const map = {}; cnt.forEach((r) => { map[r.folder_id || 0] = r.c; });
  return ok(res, { list: list.map((f) => ({ ...f, count: map[f.id] || 0 })) });
});

admin.post('/paper-folders', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, '请填写文件夹名称');
  const info = db.prepare('INSERT INTO mf_paper_folders (name, parent_id, sort, created_at) VALUES (?,?,?,?)')
    .run(name, b.parent_id ? int(b.parent_id) : null, int(b.sort), now());
  return ok(res, { id: info.lastInsertRowid }, '文件夹已创建');
});

admin.put('/paper-folders/:id', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE mf_paper_folders SET name=? WHERE id=?').run(String(b.name).trim(), id);
  if (b.parent_id !== undefined) db.prepare('UPDATE mf_paper_folders SET parent_id=? WHERE id=?').run(b.parent_id ? int(b.parent_id) : null, id);
  return ok(res, null, '已保存');
});

admin.delete('/paper-folders/:id', (req, res) => {
  const id = int(req.params.id);
  db.prepare('UPDATE mf_papers SET folder_id=NULL WHERE folder_id=?').run(id);
  db.prepare('UPDATE mf_paper_folders SET parent_id=NULL WHERE parent_id=?').run(id);
  db.prepare('DELETE FROM mf_paper_folders WHERE id=?').run(id);
  return ok(res, null, '文件夹已删除（里面的试卷已移到未分类）');
});

const PAPER_STATUS = { basket: '试题篮', composing: '排版中', done: '已定稿', archived: '已归档', trashed: '回收站' };

admin.get('/papers', (req, res) => {
  const q = req.query || {};
  const where = []; const args = [];
  if (q.status) { where.push('status=?'); args.push(String(q.status)); }
  else { where.push("status<>'trashed'"); }
  if (q.folder) { where.push(q.folder === 'none' ? 'IFNULL(folder_id,0)=0' : 'folder_id=?'); if (q.folder !== 'none') args.push(int(q.folder)); }
  if (q.kw) { where.push('title LIKE ?'); args.push(`%${String(q.kw)}%`); }
  if (q.subject) { where.push('subject=?'); args.push(String(q.subject)); }
  if (q.grade) { where.push('grade=?'); args.push(String(q.grade)); }
  if (q.year) { where.push("IFNULL(year,'')=?"); args.push(String(q.year)); }
  if (q.published === '1' || q.published === '0') { where.push('IFNULL(published,0)=?'); args.push(int(q.published)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM mf_paper_questions r WHERE r.paper_id=p.id AND r.kind='question') AS qcount
    FROM mf_papers p ${w} ORDER BY p.id DESC LIMIT 300`).all(...args);
  return ok(res, { list: rows, statusNames: PAPER_STATUS });
});

admin.post('/papers', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim() || `未命名试卷 ${new Date().toLocaleDateString('zh-CN')}`;
  const year = /^\d{4}$/.test(String(b.year || '').trim()) ? String(b.year).trim() : '';
  const info = db.prepare('INSERT INTO mf_papers (title, subject, stage, grade, year, status, paper_type, layout_json, folder_id, trashed_from, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(title, String(b.subject || '').trim(), String(b.stage || '').trim(), String(b.grade || '').trim(), year,
      b.status === 'composing' ? 'composing' : 'basket', b.paper_type === 'custom-mistake' ? 'custom-mistake' : 'uniform',
      jstr(b.layout || defaultLayout()), b.folder_id ? int(b.folder_id) : null, '', now());
  return ok(res, { id: info.lastInsertRowid }, '已创建');
});

function defaultLayout() {
  return {
    pageSize: 'A4', orientation: 'portrait', columns: 1, columnGapMm: 8,
    fontSize: 12, lineHeight: 1.6, fontFamily: '宋体',
    pageMarginMm: { top: 20, right: 15, bottom: 20, left: 15 },
    header: { style: 'exam', title: '', lines: [] },
    fieldVisibility: { questionNo: true, score: false, answer: false, analysis: false },
    optionsLayout: 'auto', figureLayout: { mode: 'inline', align: 'center', widthPercent: 60 },
    answerSpace: { enabled: false, lineHeightMm: 10 }, logos: [],
  };
}

admin.get('/papers/:id', (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(id);
  if (!p) return fail(res, '试卷不存在');
  const rows = db.prepare('SELECT * FROM mf_paper_questions WHERE paper_id=? ORDER BY position, id').all(id);
  const qIds = rows.filter((r) => r.question_id).map((r) => r.question_id);
  const qMap = {};
  if (qIds.length) {
    db.prepare(`SELECT * FROM questions WHERE id IN (${qIds.map(() => '?').join(',')})`).all(...qIds)
      .forEach((r) => { qMap[r.id] = decorate(r); });
  }
  return ok(res, {
    paper: { ...p, layout: parseObj(p.layout_json, defaultLayout()) },
    rows: rows.map((r) => ({ ...r, question: r.question_id ? (qMap[r.question_id] || null) : null })),
  });
});

admin.put('/papers/:id', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(id);
  if (!p) return fail(res, '试卷不存在');
  if (b.title !== undefined) db.prepare('UPDATE mf_papers SET title=? WHERE id=?').run(String(b.title).trim() || p.title, id);
  if (b.subject !== undefined) db.prepare('UPDATE mf_papers SET subject=? WHERE id=?').run(String(b.subject).trim(), id);
  if (b.stage !== undefined) db.prepare('UPDATE mf_papers SET stage=? WHERE id=?').run(String(b.stage).trim(), id);
  if (b.grade !== undefined) db.prepare('UPDATE mf_papers SET grade=? WHERE id=?').run(String(b.grade).trim(), id);
  if (b.year !== undefined) db.prepare('UPDATE mf_papers SET year=? WHERE id=?').run(/^\d{4}$/.test(String(b.year).trim()) ? String(b.year).trim() : '', id);
  if (b.folder_id !== undefined) db.prepare('UPDATE mf_papers SET folder_id=? WHERE id=?').run(b.folder_id ? int(b.folder_id) : null, id);
  if (b.layout !== undefined) db.prepare('UPDATE mf_papers SET layout_json=? WHERE id=?').run(jstr(b.layout), id);
  if (b.published !== undefined) db.prepare('UPDATE mf_papers SET published=? WHERE id=?').run(b.published ? 1 : 0, id);
  if (b.status && PAPER_STATUS[b.status]) {
    const from = p.status === 'trashed' ? (p.trashed_from || 'basket') : p.status;
    db.prepare('UPDATE mf_papers SET status=?, trashed_from=? WHERE id=?')
      .run(b.status, b.status === 'trashed' ? from : '', id);
  }
  return ok(res, null, '已保存');
});

admin.delete('/papers/:id', (req, res) => {
  db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(int(req.params.id));
  db.prepare('DELETE FROM mf_papers WHERE id=?').run(int(req.params.id));
  return ok(res, null, '试卷已彻底删除');
});

/** 加题（可一次多题，追加到末尾） */
admin.post('/papers/:id/questions', (req, res) => {
  const pid = int(req.params.id);
  const ids = ((req.body || {}).question_ids || []).map(int).filter(Boolean);
  if (!ids.length) return fail(res, '请先勾选题目');
  const pos = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM mf_paper_questions WHERE paper_id=?').get(pid).m;
  const ins = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, score, kind, created_at) VALUES (?,?,?,?, 'question',?)");
  ids.forEach((qid, i) => ins.run(pid, qid, pos + i + 1, num((req.body || {}).score, 0), now()));
  return ok(res, null, `已加入 ${ids.length} 题`);
});

/** 插入文本块（大题标题，不占题号） */
admin.post('/papers/:id/text', (req, res) => {
  const pid = int(req.params.id);
  const b = req.body || {};
  const body = String(b.text_body || '').trim();
  if (!body) return fail(res, '请填写文本块内容');
  const pos = int(b.position) || (db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM mf_paper_questions WHERE paper_id=?').get(pid).m + 1);
  db.prepare("UPDATE mf_paper_questions SET position=position+1 WHERE paper_id=? AND position>=?").run(pid, pos);
  db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, kind, text_body, style, text_align, created_at) VALUES (?,NULL,?, 'text',?,?,?,?)")
    .run(pid, pos, body, String(b.style || 'title').trim(), String(b.text_align || 'left').trim(), now());
  return ok(res, null, '文本块已插入');
});

/** 拖动排序：按传入的行 id 顺序重写 position */
admin.put('/papers/:id/reorder', (req, res) => {
  const pid = int(req.params.id);
  const ids = ((req.body || {}).ids || []).map(int).filter(Boolean);
  if (!ids.length) return fail(res, '没有要排序的行');
  const up = db.prepare('UPDATE mf_paper_questions SET position=? WHERE id=? AND paper_id=?');
  ids.forEach((rid, i) => up.run(i + 1, rid, pid));
  return ok(res, null, '顺序已保存');
});

admin.put('/papers/:id/rows/:rowId', (req, res) => {
  const b = req.body || {};
  const sets = []; const args = [];
  if (b.score !== undefined) { sets.push('score=?'); args.push(num(b.score)); }
  if (b.text_body !== undefined) { sets.push('text_body=?'); args.push(String(b.text_body)); }
  if (b.style !== undefined) { sets.push('style=?'); args.push(String(b.style)); }
  if (b.text_align !== undefined) { sets.push('text_align=?'); args.push(String(b.text_align)); }
  if (!sets.length) return fail(res, '没有要改的字段');
  args.push(int(req.params.rowId), int(req.params.id));
  db.prepare(`UPDATE mf_paper_questions SET ${sets.join(',')} WHERE id=? AND paper_id=?`).run(...args);
  return ok(res, null, '已保存');
});

admin.delete('/papers/:id/rows/:rowId', (req, res) => {
  db.prepare('DELETE FROM mf_paper_questions WHERE id=? AND paper_id=?').run(int(req.params.rowId), int(req.params.id));
  return ok(res, null, '已移除');
});

/** 试卷排版 → 完整 HTML（服务端渲染，前端直接塞 iframe 或新窗打印） */
admin.get('/papers/:id/preview', (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(id);
  if (!p) return fail(res, '试卷不存在');
  const mode = String(req.query.mode || '') === 'teacher' ? 'teacher' : 'student';
  const html = renderPaperHtml(p, mode);
  return ok(res, { html, title: p.title, mode });
});

/** 导出：html 打印页 / doc（Word 可直接打开的 HTML） / 归档到对象存储 */
admin.get('/papers/:id/export', (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(id);
  if (!p) return fail(res, '试卷不存在');
  const mode = String(req.query.mode || '') === 'student' ? 'student' : 'teacher';
  return ok(res, { html: renderPaperHtml(p, mode), title: p.title, mode }, 'ok');
});

admin.post('/papers/:id/archive', async (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(id);
  if (!p) return fail(res, '试卷不存在');
  try {
    const html = renderPaperHtml(p, 'teacher');
    const saved = await store.saveFile(Buffer.from(html, 'utf8'), `${p.title}.html`, `${bankFolder()}/paper`);
    const url = await store.getUrl(saved.key, `${p.title}.html`);
    return ok(res, { key: saved.key, url }, '已归档到对象存储');
  } catch (e) {
    return fail(res, '归档失败：' + e.message);
  }
});

/** 试卷 HTML 渲染：纸张/分栏/字号/页边距/卷头/显隐/选项版式/作答区 */
function renderPaperHtml(p, mode) {
  const L = { ...defaultLayout(), ...parseObj(p.layout_json) };
  const V = { ...L.fieldVisibility };
  if (mode === 'student') { V.answer = false; V.analysis = false; }
  const rows = db.prepare('SELECT * FROM mf_paper_questions WHERE paper_id=? ORDER BY position, id').all(p.id);
  const qIds = rows.filter((r) => r.question_id).map((r) => r.question_id);
  const qMap = {};
  if (qIds.length) {
    db.prepare(`SELECT * FROM questions WHERE id IN (${qIds.map(() => '?').join(',')})`).all(...qIds)
      .forEach((r) => { qMap[r.id] = decorate(r); });
  }
  const m = L.pageMarginMm || {};
  const pageW = L.pageSize === 'A3' ? 297 : 210;
  const pageH = L.pageSize === 'A3' ? 420 : 297;
  const wide = L.orientation === 'landscape' ? pageH : pageW;
  const high = L.orientation === 'landscape' ? pageW : pageH;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mathHtml = (s) => esc(s).replace(/\$([^$]{1,200})\$/g, '<span class="mf-math">$1</span>');
  let no = 0;
  const body = rows.map((r) => {
    if (r.kind === 'text') {
      const align = r.text_align || 'left';
      return `<div class="mf-block" style="text-align:${align}">${mathHtml(r.text_body)}</div>`;
    }
    const q = qMap[r.question_id];
    if (!q) return '';
    no++;
    const opts = (q.options || []).map((o) => `<span class="mf-opt">${o.label ? o.label + '. ' : ''}${mathHtml(o.text || '')}</span>`).join('');
    const optCls = L.optionsLayout === 'single-line' ? 'mf-opts one' : (L.optionsLayout === 'two-lines' ? 'mf-opts two' : 'mf-opts');
    return `<div class="mf-q">
      <div class="mf-stem">${V.questionNo ? `<b>${no}.</b> ` : ''}${V.score && r.score ? `<span class="mf-score">（${r.score}分）</span> ` : ''}${mathHtml(q.stem)}</div>
      ${opts ? `<div class="${optCls}">${opts}</div>` : ''}
      ${V.answer && q.answer ? `<div class="mf-ans">答案：${mathHtml(q.answer)}</div>` : ''}
      ${V.analysis && q.analysis ? `<div class="mf-ana">解析：${mathHtml(q.analysis)}</div>` : ''}
      ${L.answerSpace && L.answerSpace.enabled ? `<div class="mf-space" style="height:${num(L.answerSpace.lineHeightMm, 10)}mm"></div>` : ''}
    </div>`;
  }).join('');
  const head = L.header && L.header.style !== 'none'
    ? `<div class="mf-header ${L.header.style}">
        <div class="mf-title">${esc(L.header.title || p.title)}</div>
        ${(L.header.lines || []).map((l) => `<div class="mf-hline" style="text-align:${l.align || 'center'};font-size:${num(l.sizePt, 12)}pt;${l.bold ? 'font-weight:700' : ''}">${esc(l.text)}</div>`).join('')}
      </div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
  @page { size: ${wide}mm ${high}mm; margin: ${num(m.top, 20)}mm ${num(m.right, 15)}mm ${num(m.bottom, 20)}mm ${num(m.left, 15)}mm; }
  html,body{margin:0;padding:0}
  body{font-family:${L.fontFamily || '宋体'},SimSun,serif;font-size:${num(L.fontSize, 12)}pt;line-height:${num(L.lineHeight, 1.6)};color:#111}
  .mf-paper{padding:${num(m.top, 20)}mm ${num(m.right, 15)}mm}
  .mf-header{margin-bottom:8mm;text-align:center}
  .mf-title{font-size:${num(L.fontSize, 12) + 4}pt;font-weight:700}
  .mf-hline{color:#333}
  .mf-cols{column-count:${Math.max(1, int(L.columns, 1))};column-gap:${num(L.columnGapMm, 8)}mm}
  .mf-q{break-inside:avoid;margin:0 0 4mm}
  .mf-stem{text-align:justify}
  .mf-opts{display:flex;flex-wrap:wrap;gap:0 12px;margin:2mm 0}
  .mf-opts.one{display:block}.mf-opts.one .mf-opt{display:block}
  .mf-opts.two{display:grid;grid-template-columns:1fr 1fr}
  .mf-ans,.mf-ana{color:#444;font-size:${Math.max(9, num(L.fontSize, 12) - 1)}pt}
  .mf-space{border-bottom:1px dashed #bbb}
  .mf-math{font-family:"Times New Roman",serif;font-style:italic}
  .mf-block{font-weight:700;margin:4mm 0 2mm}
</style></head><body><div class="mf-paper">${head}<div class="${int(L.columns, 1) > 1 ? 'mf-cols' : ''}">${body}</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`;
}

// ==================================================================== 录题工作台
admin.get('/intake/runs', (req, res) => {
  const rows = db.prepare('SELECT id, title, subject, stage, grade, source_kind, source_name, status, error, pages, drafts, created_at FROM mf_recog_runs ORDER BY id DESC LIMIT 100').all();
  return ok(res, { list: rows.map((r) => ({ ...r, page_count: parseArr(r.pages).length, draft_count: parseArr(r.drafts).length })) });
});

admin.get('/intake/runs/:id', async (req, res) => {
  const r = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(int(req.params.id));
  if (!r) return fail(res, '批次不存在');
  const run = { ...r, pages: parseArr(r.pages), drafts: parseArr(r.drafts), ocr_texts: parseArr(r.ocr_texts) };
  // 页图 URL 重新签发：旧数据存的可能带 attachment 下载头，<img> 内联预览必须用不带 disposition 的直链
  for (const p of run.pages) {
    if (p && p.key) { try { p.url = await store.getUrl(p.key); } catch (e) { /* 保留旧 url */ } }
  }
  return ok(res, { run });
});

admin.post('/intake/runs', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim() || `录题 ${new Date().toLocaleString('zh-CN')}`;
  const info = db.prepare('INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(title, String(b.subject || '').trim(), String(b.stage || '').trim(), String(b.grade || '').trim(),
      b.source_kind === 'pdf' ? 'pdf' : 'image', String(b.source_name || '').trim(), 'draft', jstr([]), jstr([]), '', now());
  return ok(res, { id: info.lastInsertRowid }, '批次已创建');
});

/** 上传页图（前端把 PDF 逐页 canvas 出图后一并上传；服务端只负责存 + 记） */
admin.post('/intake/runs/:id/pages', upload.array('pages', 30), async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const files = req.files || [];
  if (!files.length) return fail(res, '请先选择图片');
  const pages = parseArr(run.pages);
  try {
    for (const f of files) {
      const pname = fixFileName(f.originalname) || 'page.png';
      const saved = await store.saveFile(f.buffer, pname, `${bankFolder()}/recog`);
      // 不带文件名 → 内联预览直链（带名字会生成 attachment 下载头，<img> 无法渲染）
      const purl = await store.getUrl(saved.key);
      pages.push({ key: saved.key, url: purl, name: pname });
    }
  } catch (e) {
    return fail(res, '图片上传失败：' + e.message);
  }
  db.prepare('UPDATE mf_recog_runs SET pages=? WHERE id=?').run(jstr(pages), id);
  return ok(res, { pages }, `已上传 ${files.length} 页`);
});

// —— 识别提示词（移植魔方助手 onestep_extract / transcribe_only / twostage_structure 三个提示词资产）——
const RECOG_SYS = `你是教辅题库的试题结构化引擎。输入是一张试题截图或整页试卷图片。请把图中全部试题一次性转成结构化 JSON。

【输出格式】只输出一个 JSON 对象，禁止输出任何解释文字或 Markdown 代码围栏。结构如下：
{"questions":[{"qno":"17 或 2-17 或 null","questionType":"单选|多选|填空|解答|判断 之一","stemMarkdown":"题干","options":[{"label":"A","content":"选项内容"}],"answerMarkdown":"图中给出的答案","analysisMarkdown":"图中给出的解析","suggestedTags":["知识点标签"]}]}

【字段规则】
1. qno：卷内题号原文的数字形态，如 "17"、"2-17"（章-题号）；图内确无题号则 null。
2. questionType 只能取：单选 / 多选 / 填空 / 解答 / 判断。
3. stemMarkdown：题干用 Markdown；行内公式写 $...$，独立公式行写 $$...$$；题干里的插图、表格在原位置写占位符 [图N]（N=1,2,… 按本题内出现顺序编号）。小题 (1)(2)① 属于同一大题时并入该题 stemMarkdown，不拆成多题。
4. options：有选项的题必须给 [{"label":"A","content":"…"},…]（label 不带冒号点号），content 内公式同样走 LaTeX；无选项为 null。选择/判断题的选项文字一律进 options 数组，题干里不得保留 "A．… B．…" 这类选项行（不要用换行把它们和题干连在一起）。
5. answerMarkdown / analysisMarkdown：只抄录图中实际印出的答案/解析文字；图中没有就是 null，绝不自行作答或补写。
6. suggestedTags：3~8 个知识点标签（自由词、中文、简短，如 "抛体运动" "电磁感应"），按题面实际涉及的知识点给。
7. 整页多题时 questions 按卷面顺序输出全部题目，一条不漏。`;

/** 半自动腿1：OCR 转写（只转写不结构化，魔方 transcribe_only 口径） */
const TRANSCRIBE_PROMPT = '请把图片中的全部内容逐字转写为 Markdown：文字照抄、公式用 LaTeX、保留原有换行与分段。\n\n要求：只做转写，不做任何结构化、不判断题目边界、不总结、不解释、不要 JSON、不要标题层级之外的任何加工。';

/** 半自动腿2：文本结构化（魔方 twostage_structure 口径，文本推理模型） */
const STRUCTURE_SYS = `你是教辅题库的试题结构化引擎。输入是一道或一道大题的文字记录（来自 OCR 或文档，可能有识别噪声、公式可能不完整）。请把它整理成结构化 JSON。

【输出格式】只输出一个 JSON 对象，禁止输出任何解释文字或 Markdown 代码围栏。结构如下：
{"questions":[{"qno":"17 或 2-17 或 null","questionType":"单选|多选|填空|解答|判断 之一","stemMarkdown":"题干","options":[{"label":"A","content":"选项内容"}],"answerMarkdown":"文字中给出的答案","analysisMarkdown":"文字中给出的解析","suggestedTags":["知识点标签"]}]}

【字段规则】
1. qno：题号数字形态（含 "2-17" 章-题号形态）；文字中确无题号则 null。
2. questionType 只能取：单选 / 多选 / 填空 / 解答 / 判断。
3. stemMarkdown：整理为通顺 Markdown；行内公式 $...$，独立公式 $$...$$。OCR 噪声在不改变题意的前提下修复，公式残缺处按学科惯例补全；原文中的插图描述（如"如图所示"）保留文字；原文的 [图N] 占位符原样保留。多道小题同属一道大题时并入同一题，不拆。
4. options：有选项的题必须给 [{"label":"A","content":"…"},…]，选项文字一律进该数组，题干里不保留 "A．… B．…" 选项行；无选项为 null。
5. answerMarkdown / analysisMarkdown：只整理文字中实际存在的答案/解析；没有就是 null，绝不自行作答。
6. suggestedTags：3~8 个知识点标签（自由词、中文、简短）。
7. 输入含多题时 questions 按原顺序全部输出。`;

/** 模型返回 → {questions:[...]}（容错：剥代码围栏 / 取最外层 JSON） */
function parseModelQuestions(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(body.slice(a, b + 1));
    return Array.isArray(j.questions) ? j : null;
  } catch (e) { return null; }
}

/** 模型 questions → 录题题卡（字段与魔方 OnestepDraft 对齐） */
function normCards(j, pageNo) {
  return (j.questions || []).map((q) => ({
    page: pageNo,
    qno: q.qno == null ? '' : String(q.qno),
    questionType: String(q.questionType || '解答'),
    stem: String(q.stemMarkdown || '').trim(),
    options: Array.isArray(q.options) ? q.options.map((o) => ({ label: String((o || {}).label || ''), content: String((o || {}).content || '') })) : [],
    answer: q.answerMarkdown == null ? '' : String(q.answerMarkdown),
    analysis: q.analysisMarkdown == null ? '' : String(q.analysisMarkdown),
    suggestedTags: Array.isArray(q.suggestedTags) ? q.suggestedTags.map(String) : [],
    figures: Array.isArray(q.figures) ? q.figures : [],
    checked: true,
  }));
}

/** 单页视觉调用：优先五角色档案（R2 OCR），未配置回落内置视觉模型 */
async function visionCall(pg, system, user) {
  const buf = await store.readBuffer(pg.key);
  try {
    const { text } = await require('./mfcollect').mfAiInvoke({
      role: 'vision', system, user, images: [buf.toString('base64')], maxTokens: 6000, temperature: 0,
    });
    return String(text || '');
  } catch (e) {
    const r = await aiLib.visionChat({
      system, userText: user,
      images: [{ buf, mime: /\.png$/i.test(pg.key) ? 'image/png' : 'image/jpeg' }],
      timeoutMs: 180000,
    });
    return String(r.text || '');
  }
}

/** AI 识别：body.page=页号 → 只识别该页并**追加**题卡（全自动逐页识别）；不传 → 兼容整批（前 8 页，替换式） */
admin.post('/intake/runs/:id/recognize', async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const pages = parseArr(run.pages);
  if (!pages.length) return fail(res, '还没有上传页图');
  const one = int((req.body || {}).page, 0);
  const before = parseArr(run.drafts);
  const drafts = one > 0 ? before.slice() : [];
  const jobs = one > 0 ? [one] : pages.map((_, i) => i + 1).slice(0, 8);
  try {
    for (const no of jobs) {
      if (!pages[no - 1]) continue;
      const text = await visionCall(pages[no - 1], RECOG_SYS, `这是第 ${no} 页整页试卷图。请把图中全部试题一次性转成结构化 JSON，按卷面顺序一条不漏。`);
      const j = parseModelQuestions(text);
      if (j) drafts.push(...normCards(j, no));
    }
  } catch (e) {
    db.prepare('UPDATE mf_recog_runs SET status=?, error=? WHERE id=?').run('error', String(e.message).slice(0, 300), id);
    return fail(res, 'AI 识别失败：' + e.message);
  }
  if (!drafts.length) {
    db.prepare('UPDATE mf_recog_runs SET status=?, error=? WHERE id=?').run('error', 'AI 没有识别出题目', id);
    return fail(res, 'AI 没有识别出题目，可以检查图片是否清晰，或改用半自动 OCR 转写');
  }
  db.prepare('UPDATE mf_recog_runs SET drafts=?, status=?, error=? WHERE id=?').run(jstr(drafts), 'recognized', '', id);
  const added = one > 0 ? drafts.length - before.length : drafts.length;
  return ok(res, { drafts, added }, one > 0 ? `第 ${one} 页识别出 ${added} 题` : `识别出 ${drafts.length} 题`);
});

/** 半自动腿1：单页 OCR 转写全文（存 ocr_texts，按页下标） */
admin.post('/intake/runs/:id/ocr', async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const pages = parseArr(run.pages);
  const no = int((req.body || {}).page, 0);
  if (!pages[no - 1]) return fail(res, '页码不存在');
  try {
    const text = await visionCall(pages[no - 1], '', TRANSCRIBE_PROMPT);
    if (!text.trim()) return fail(res, `第 ${no} 页转写结果为空，请检查页图清晰度`);
    const ocr = parseArr(run.ocr_texts);
    while (ocr.length < pages.length) ocr.push('');
    ocr[no - 1] = text;
    db.prepare('UPDATE mf_recog_runs SET ocr_texts=? WHERE id=?').run(jstr(ocr), id);
    return ok(res, { page: no, text }, `第 ${no} 页转写完成`);
  } catch (e) {
    return fail(res, 'OCR 转写失败：' + e.message);
  }
});

/** 半自动腿2：把一段文字（OCR 全文 / 手动粘贴）整理成结构化题卡并追加 */
admin.post('/intake/runs/:id/structure', async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const b = req.body || {};
  const no = int(b.page, 0);
  let text = String(b.text || '');
  if (!text.trim() && no > 0) text = String(parseArr(run.ocr_texts)[no - 1] || '');
  if (!text.trim()) return fail(res, '没有可整理的文字：先做 OCR 转写，或直接粘贴文本');
  try {
    const { text: out } = await require('./mfcollect').mfAiInvoke({
      role: 'reasoning', system: STRUCTURE_SYS, user: '文字记录：\n' + text.slice(0, 60000), maxTokens: 8000, temperature: 0.1,
    });
    const j = parseModelQuestions(out);
    if (!j || !j.questions.length) return fail(res, 'AI 没有从这段文字里整理出题目，可手动点「+ 空白题卡」录入');
    const drafts = parseArr(run.drafts);
    const cards = normCards(j, no).map((c) => ({ ...c, via: 'semi' }));
    drafts.push(...cards);
    db.prepare('UPDATE mf_recog_runs SET drafts=?, status=?, error=? WHERE id=?').run(jstr(drafts), 'recognized', '', id);
    return ok(res, { drafts, added: cards.length }, `整理出 ${cards.length} 张题卡`);
  } catch (e) {
    return fail(res, '文本整理失败：' + e.message);
  }
});

const upWord = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

/** Word 导入（.docx）：解出正文文本 + 内嵌插图 → 走半自动文本结构化同一条 AI 链路出题卡 */
admin.post('/intake/runs/:id/word', upWord.single('file'), async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const f = req.file;
  const fname = fixFileName(f && f.originalname);
  if (!f) return fail(res, '请选择 .docx 文件');
  if (!/\.docx$/i.test(fname || '')) return fail(res, '只支持 .docx（老 .doc 请先用 Word 另存为 .docx）');
  try {
    const { ZipReader } = require('./mfzip');
    const zr = new ZipReader(f.buffer);
    const docXml = zr.read('word/document.xml');
    if (!docXml) return fail(res, '这不是有效的 .docx 文件（缺 word/document.xml）');
    // rId → 媒体路径
    const rels = {};
    const relXml = zr.read('word/_rels/document.xml.rels');
    if (relXml) {
      String(relXml.toString('utf8')).replace(/<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?\/?>/g, (m, rid, tgt) => {
        rels[rid] = 'word/' + String(tgt).replace(/^\//, '');
        return m;
      });
    }
    // 逐段落抽取文本；段内 <a:blip r:embed> 的插图存对象存储并以 [图N] 占位
    const xml = docXml.toString('utf8');
    const figUrls = [];
    const paras = [];
    const pRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    let pm;
    while ((pm = pRe.exec(xml))) {
      const p = pm[0];
      let line = '';
      const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/?>|<w:br\s*\/?>|<a:blip[^>]*?r:embed="([^"]+)"[^>]*?\/?>/g;
      let tm;
      while ((tm = tRe.exec(p))) {
        if (tm[0].indexOf('<w:tab') === 0) line += '\t';
        else if (tm[0].indexOf('<w:br') === 0) line += '\n';
        else if (tm[0].indexOf('<a:blip') === 0) {
          const target = rels[tm[2]] || '';
          const buf = target ? zr.read(target) : null;
          if (buf) {
            const fname = String(target).split('/').pop() || `fig${figUrls.length + 1}.png`;
            const saved = await store.saveFile(buf, fname, `${bankFolder()}/img`);
            const url = await store.getUrl(saved.key);
            figUrls.push({ n: figUrls.length + 1, url });
            line += `[图${figUrls.length}]`;
          }
        } else if (tm[1] != null) {
          line += tm[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        }
      }
      // AI 生成的 docx 有时把 XML 标记原样嵌进 w:t 文本里；滤掉带命名空间的标签（w:xx / a:xx），避免污染原文
      line = line.replace(/<\/?[a-zA-Z]+:[a-zA-Z]+(?:\s[^>]*)?\/*>/g, '');
      if (line.trim()) paras.push(line.trim());
    }
    const full = paras.join('\n');
    if (!full.trim()) return fail(res, 'Word 里没有可读的文字（纯图片 Word 请截图后走页图识别）');
    const { text: out } = await require('./mfcollect').mfAiInvoke({
      role: 'reasoning', system: STRUCTURE_SYS, user: '文字记录：\n' + full.slice(0, 60000), maxTokens: 8000, temperature: 0.1,
    });
    const j = parseModelQuestions(out);
    if (!j || !j.questions.length) {
      const ocr = parseArr(run.ocr_texts);
      ocr.push(full);
      db.prepare('UPDATE mf_recog_runs SET ocr_texts=? WHERE id=?').run(jstr(ocr), id);
      return fail(res, 'AI 没有整理出题卡；Word 全文已保留在转写文本里，可手动复制到「文本整理成题卡」重试');
    }
    // 原文保留在转写文本里（左栏「Word 原文」可查看、可重新整理成题卡）
    const ocrSaved = parseArr(run.ocr_texts);
    if (!ocrSaved.includes(full)) ocrSaved.push(full);
    const drafts = parseArr(run.drafts);
    const cards = normCards(j, 0).map((c) => ({
      ...c,
      via: 'word',
      figures: figUrls.filter((fu) => new RegExp('\\[图' + fu.n + '\\]').test(c.stem) || new RegExp('\\[图' + fu.n + '\\]').test(c.analysis || '')),
    }));
    drafts.push(...cards);
    db.prepare('UPDATE mf_recog_runs SET drafts=?, ocr_texts=?, status=?, error=?, source_kind=?, source_name=? WHERE id=?')
      .run(jstr(drafts), jstr(ocrSaved), 'recognized', '', 'word', fname || 'Word 导入', id);
    return ok(res, { added: cards.length, drafts, figures: figUrls.length }, `Word 导入完成：整理出 ${cards.length} 张题卡${figUrls.length ? `（含 ${figUrls.length} 张插图）` : ''}`);
  } catch (e) {
    return fail(res, 'Word 导入失败：' + e.message);
  }
});

/** 保存人工校对结果（改题干/选项/答案或取消勾选） */
admin.put('/intake/runs/:id/drafts', (req, res) => {
  const drafts = (req.body || {}).drafts;
  if (!Array.isArray(drafts)) return fail(res, '数据格式不对');
  db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(jstr(drafts), int(req.params.id));
  return ok(res, null, '校对结果已保存');
});

const TYPE_MAP = {
  '单选': 'single', '多选': 'multi', '判断': 'judge', '填空': 'fill',
  '排序': 'sort', '解答': 'answer', '计算': 'answer', '简答': 'answer', '实验': 'answer', '作图': 'answer', '综合': 'answer',
};

/** AI 补全：答案/解析为空的题卡自动补；并按题库管理的分类体系（课本章节/知识点/难度）给出建议填入卡片 */
admin.post('/intake/runs/:id/aifill', async (req, res) => {
  const id = int(req.params.id);
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const drafts = parseArr(run.drafts);
  if (!drafts.length) return fail(res, '批次里还没有题卡');
  const sel = Array.isArray((req.body || {}).indexes) ? (req.body || {}).indexes.map(Number) : null;
  const targets = drafts.map((c, i) => ({ c, i }))
    .filter((x) => (!sel || sel.includes(x.i)) && String(x.c.stem || '').trim());
  if (!targets.length) return fail(res, '没有可处理的题卡（题干为空）');

  // 分类清单：课本章节（按学科+学段匹配）+ 教材知识点树
  const subject = String(run.subject || '');
  const stage = String(run.stage || '');
  const grade = String(run.grade || '');
  const chapters = db.prepare("SELECT id,name,grade,term,category FROM chapters WHERE subject=? AND (IFNULL(stage,'')='' OR stage=?) ORDER BY sort,id").all(subject, stage);
  // 知识点清单：知识点树（bank_trees）里的全部知识点名（T4：与题库管理、组卷共用同一棵树）
  const pointList = require('./kbtree').pointNames(db, { subject, stage, grade }).slice(0, 200);

  const sys = '你是中小学录题助手。对给定的每道题输出 JSON，要求：\n' +
    '1) answer/analysis：仅当题目标注 needAnswer=true / needAnalysis=true 时才作答——answer 给正确答案（填空多空用 ||| 分隔），analysis 给简洁解析；不缺的给空字符串，绝不改写已有内容。\n' +
    '2) chapter：从「章节清单」里选最匹配的章节 id（纯数字），没有合适的给 0。\n' +
    (pointList.length ? '3) point：从「知识点清单」里选 1-2 个最匹配的，多个用 && 连接；必须原样取自清单，没有合适的给空字符串。\n' : '3) point：给空字符串。\n') +
    '4) difficulty：难度 1-5（1 最容易，5 最难）。\n' +
    '只输出 JSON，不要任何其它文字：{"items":[{"i":0,"answer":"","analysis":"","chapter":0,"point":"","difficulty":3}]}，i 与题目编号一致，每道题都必须输出。';
  const user = '章节清单：\n' + (chapters.map((ch) => `${ch.id}. ${ch.name}${ch.grade ? '（' + ch.grade + (ch.term || '') + '）' : ''}`).join('\n') || '（暂无）') + '\n' +
    (pointList.length ? '知识点清单：\n' + pointList.join('、') + '\n' : '') +
    '题目列表：\n' + targets.map(({ c, i }) => `[i=${i}] 题型:${c.questionType || ''}\n题干:${String(c.stem).slice(0, 800)}\n选项:${(c.options || []).map((o) => (o.label ? o.label + '.' : '') + (o.content || '')).join(' ')}\n现有答案:${c.answer || '（空）'} 现有解析:${c.analysis || '（空）'} needAnswer=${!String(c.answer || '').trim()} needAnalysis=${!String(c.analysis || '').trim()}`).join('\n---\n');
  const { text: out } = await require('./mfcollect').mfAiInvoke({ role: 'reasoning', system: sys, user: user.slice(0, 50000), maxTokens: 8000, temperature: 0.1 });
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return fail(res, 'AI 没有返回有效结果，请重试');
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { return fail(res, 'AI 返回解析失败，请重试'); }
  const byIdx = {};
  (Array.isArray(j.items) ? j.items : []).forEach((it) => { if (it && Number.isFinite(Number(it.i))) byIdx[Number(it.i)] = it; });
  let nAns = 0, nCls = 0;
  targets.forEach(({ c, i }) => {
    const it = byIdx[i];
    if (!it) return;
    if (!String(c.answer || '').trim() && String(it.answer || '').trim()) { c.answer = String(it.answer).trim(); nAns++; }
    if (!String(c.analysis || '').trim() && String(it.analysis || '').trim()) c.analysis = String(it.analysis).trim();
    if (!c.chapter_id && Number(it.chapter) > 0 && chapters.some((ch) => ch.id === Number(it.chapter))) { c.chapter_id = Number(it.chapter); nCls++; }
    if (!String(c.point || '').trim() && String(it.point || '').trim()) c.point = String(it.point).trim();
    if (!c.difficulty && Number(it.difficulty) >= 1 && Number(it.difficulty) <= 5) c.difficulty = Number(it.difficulty);
    c.ai_filled = true;
  });
  db.prepare('UPDATE mf_recog_runs SET drafts=? WHERE id=?').run(jstr(drafts), id);
  return ok(res, { drafts, answers: nAns, classified: nCls },
    nAns + nCls > 0 ? `AI 已为 ${nAns} 题补充答案/解析，为 ${nCls} 题填入分类建议（可在题卡上修改）` : '没有需要补充的内容（答案都已存在，也没有更合适的分类建议）');
});

/** 题卡入库：勾选的题写入 questions（source_type=recog），可顺手打标、挂树、进试卷 */
/** 把题卡入库：整批提交（intake/runs/:id/commit）与待审核页逐题入库共用。
 *  b: { subject, stage, grade, difficulty, tags, node_id, node_ids }；题卡带 _q（技能包转写）时按转写包规则入库并按 source_detail 去重。
 *  返回新题 id 数组（技能包里已存在的题返回库里原有的 id）。 */
function commitRunCards(run, cards, b) {
  b = b || {};
  const ins = db.prepare(`INSERT INTO questions (chapter_id, subject, stage, grade, type, stem, stem_html, options, answer, analysis,
    difficulty, point, material, source, year, images, audio_key, source_type, source_detail, sort, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'recog', ?,0,?)`);
  const insPack = db.prepare(`INSERT INTO questions (subject, stage, grade, type, stem, stem_html, options, answer, analysis,
    difficulty, point, material, source, year, images, source_type, source_detail, sort, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`);
  const insTag = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?,?)');
  const insNode = db.prepare('INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?,?)');
  const nodeIds = [].concat(b.node_id ? [b.node_id] : [], Array.isArray(b.node_ids) ? b.node_ids : []).map((x) => int(x)).filter(Boolean);
  const ids = [];
  cards.forEach((d) => {
    let qid;
    if (d._q) {   // 技能包转写：字段已在导入时算好
      const q = d._q;
      const dupRow = q.detail ? db.prepare('SELECT id FROM questions WHERE source_detail = ? LIMIT 1').get(jstr(q.detail)) : null;
      if (dupRow) { ids.push(dupRow.id); return; }
      const info = insPack.run(String(b.subject || q.subject || run.subject || '').trim(), String(b.stage || q.stage || run.stage || '').trim(), String(b.grade || q.grade || run.grade || '').trim(),
        q.type, q.stem, q.stem_html || '', jstr(q.options || []), String(q.answer || ''), String(q.analysis || ''),
        Math.min(5, Math.max(1, int(q.difficulty, 3))), String(d.point || q.point || ''), '', '', '', jstr(q.images || []), 'capture', jstr(q.detail || {}), now());
      qid = info.lastInsertRowid;
      if (d.audio_key) db.prepare('UPDATE questions SET audio_key=? WHERE id=?').run(audioKeyOf(d.audio_key), qid);
    } else {
      const type = TYPE_MAP[String(d.questionType || '')] || (d.options && d.options.length >= 2 ? 'single' : 'answer');
      const stem = String(d.stem || '').trim();
      const options = (d.options || []).map((o) => ({ label: String(o.label || ''), text: String(o.content || '') })).filter((o) => o.text);
      const info = ins.run(
        int(d.chapter_id, 0) || null,
        String(b.subject || d.subject || run.subject || '').trim(), String(b.stage || d.stage || run.stage || '').trim(), String(b.grade || d.grade || run.grade || '').trim(),
        type, stem.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        /<[a-z][\s\S]*>/i.test(stem) ? stem : '',
        jstr(options), String(d.answer || '').trim(), String(d.analysis || '').trim(),
        Math.min(5, Math.max(1, int(d.difficulty, int(b.difficulty, 3)))), String(d.point || '').trim(), String(d.material || '').trim(), String(run.source_name || '录题工作台'), '',
        jstr((d.figures || []).map((x) => (x && x.url) || x).filter(Boolean)), audioKeyOf(d.audio_key),
        jstr({ runId: run.id, kind: run.source_kind, page: d.page, qno: d.qno, collectedAt: now() }), now());
      qid = info.lastInsertRowid;
    }
    ids.push(qid);
    (d.suggestedTags || []).concat(b.tags || []).map((t) => String(t).trim()).filter(Boolean).forEach((t) => insTag.run(qid, t));
    nodeIds.forEach((n) => insNode.run(qid, n));
  });
  return ids;
}

admin.post('/intake/runs/:id/commit', (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const run = db.prepare('SELECT * FROM mf_recog_runs WHERE id=?').get(id);
  if (!run) return fail(res, '批次不存在');
  const drafts = parseArr(run.drafts);
  const picked = drafts.filter((_, i) => (Array.isArray(b.selected) ? b.selected.includes(i) : true))
    .filter((d) => d.checked !== false && String(d.stem || '').trim() && !d.committed);
  if (!picked.length) return fail(res, '没有勾选任何题卡');
  const ids = commitRunCards(run, picked, b);
  if (b.paper_id) {
    const pid = int(b.paper_id);
    const pos = db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM mf_paper_questions WHERE paper_id=?').get(pid).m;
    const insP = db.prepare("INSERT INTO mf_paper_questions (paper_id, question_id, position, score, kind, created_at) VALUES (?,?,?,?, 'question',?)");
    ids.forEach((qid, i) => insP.run(pid, qid, pos + i + 1, num(b.score, 0), now()));
  }
  db.prepare('UPDATE mf_recog_runs SET status=? WHERE id=?').run('done', id);
  return ok(res, { ids }, `已入库 ${ids.length} 题`);
});

admin.delete('/intake/runs/:id', (req, res) => {
  db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(int(req.params.id));
  return ok(res, null, '批次已删除');
});

// ==================================================================== 转写包导入（魔方录题转写 skill 产物：mofang-question-pack v1）
const path = require('path');
const { ZipReader } = require('./mfzip');
const upBig = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
const SKILL_ZIP = path.join(__dirname, '..', 'data', 'mofang-question-transcribe.zip');

/** 技能包下载（导入弹窗里的「获取转写skill」） */
admin.get('/import-skill', (req, res) => {
  try {
    const buf = require('fs').readFileSync(SKILL_ZIP);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="mofang-question-transcribe.zip"');
    return res.send(buf);
  } catch (e) { return fail(res, '技能包文件缺失，请联系管理员上传到 data/mofang-question-transcribe.zip'); }
});

const MF_TYPE_MAP = [['判断', 'judge'], ['多选', 'multi'], ['单选', 'single'], ['选择', 'single'], ['填空', 'fill'], ['排序', 'sort'], ['解答', 'answer'], ['计算', 'answer'], ['证明', 'answer'], ['简答', 'answer'], ['问答', 'answer'], ['应用', 'answer']];
const MF_STAGE_MAP = [['小学', 'primary'], ['初中', 'junior'], ['高中', 'senior']];
function mfMapType(label, optCount) {
  const t = String(label || '');
  for (const [k, v] of MF_TYPE_MAP) if (t.includes(k)) return v;
  return optCount >= 2 ? 'single' : 'answer';
}
/** 学段映射：支持 小学/初中/高中 及 三年级上 / 七年级 等年级写法 */
function mfMapStage(label) {
  const t = String(label || '');
  for (const [k, v] of MF_STAGE_MAP) if (t.includes(k)) return v;
  if (/[三四五六]/.test(t) && t.includes('年级')) return 'primary';
  if (/[七八九]/.test(t) && t.includes('年级')) return 'junior';
  if (t.includes('高一') || t.includes('高二') || t.includes('高三')) return 'senior';
  return '';
}
/** 年级提取：三年级上 → 三年级；七年级 → 七年级 */
function mfMapGrade(label) {
  const m = /([一二三四五六七八九]+)年级/.exec(String(label || ''));
  return m ? `${m[1]}年级` : '';
}
function mfMapDiff(raw) {
  const t = String(raw || '').trim();
  if (/^[1-5]$/.test(t)) return Number(t);
  if (/极难|很难/.test(t)) return 5;
  if (/很容易/.test(t)) return 1;
  if (/较难/.test(t)) return 4;
  if (/较易|简单/.test(t)) return 2;
  if (/容易/.test(t)) return 1;
  if (/难/.test(t)) return 5;
  if (/中等|一般|中档/.test(t)) return 3;
  return 3;
}

admin.post('/import-pack', upBig.single('file'), async (req, res) => {
  let pack = null; const warnings = [];
  try {
    if (req.file) {
      const name = String(req.file.originalname || '').toLowerCase();
      if (name.endsWith('.json')) {
        pack = JSON.parse(req.file.buffer.toString('utf8'));
      } else if (name.endsWith('.zip')) {
        const zr = new ZipReader(req.file.buffer);
        const jsonEntry = zr.list().find((n) => n === 'questions.json' || n.endsWith('/questions.json'));
        if (!jsonEntry) return fail(res, 'ZIP 里没有 questions.json（转写包固定在根目录）');
        pack = JSON.parse(zr.read(jsonEntry).toString('utf8'));
        // 图片资产 → 对象存储 bank/img
        if (Array.isArray(pack.assets) && pack.assets.length) {
          for (const a of pack.assets) {
            try {
              const buf = zr.read(a.path);
              const fname = String(a.path).split('/').pop() || (a.id + '.png');
              const saved = await store.saveFile(buf, fname, `${bankFolder()}/img`);
              a._url = await store.getUrl(saved.key, fname);
            } catch (e) { warnings.push(`资产 ${a.id || a.path} 上传失败：${e.message}`); a._url = null; }
          }
        }
      } else {
        return fail(res, '只支持 .json 或 .zip 转写包');
      }
    } else if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      pack = req.body.pack || req.body;
    }
    if (!pack || typeof pack !== 'object') return fail(res, '没有可导入的内容');
    if (pack.format !== 'mofang-question-pack') return fail(res, '格式不对：这是「魔方录题转写」技能包的产物（format 应为 mofang-question-pack）');
    if (Number(pack.schemaVersion) !== 1) return fail(res, `schemaVersion ${pack.schemaVersion} 不支持（仅支持 1）`);
    const qs = Array.isArray(pack.questions) ? pack.questions : [];
    if (!qs.length) return fail(res, '包里没有题目');

    const assetById = {};
    (pack.assets || []).forEach((a) => { assetById[a.id] = a; });
    // T3：转写包里的题不再直接入库，先放进"待审核题目"（一个 skill 批次），老师逐题看过再入库；重复题（同一转写包 + recordKey）仍然跳过/补图
    const cards = [];
    let imported = 0, skipped = 0, updated = 0; const errors = [];
    for (const it of qs) {
      const rk = String(it.recordKey || '').slice(0, 160);
      try {
        const c = it.content || {};
        const stem = String(c.stem || '').trim();
        if (!stem) throw new Error('题干为空');
        const meta = it.metadata || {};
        const src = it.source || {};
        const srcMeta = (pack.sources || []).find((sp) => sp.id === src.sourceId) || {};
        const detail = {
          via: 'mf-pack',
          packageId: String(pack.packageId || '').slice(0, 160),
          datasetId: String(pack.datasetId || '').slice(0, 160),
          recordKey: rk,
          sourceName: String(srcMeta.name || '').slice(0, 160),
        };
        // 图片：figures ref 顺序 → images URL 数组（需在去重前算好，重复题补图要用）
        const figs = (Array.isArray(c.figures) ? c.figures : []).slice().sort((x, y) => (x.ref || 0) - (y.ref || 0));
        const urls = figs.map((f) => { const a = assetById[f.assetId]; return (a && a._url) || null; }).filter(Boolean);
        // 去重：同一转写包 + 同一 recordKey 已导入过则跳过（source_detail 精确匹配）；
        // 但若本次带来图片（ZIP 资产）而库里题目没图，则给旧题补图后计为「补图」
        const dup = rk ? db.prepare('SELECT id, images FROM questions WHERE source_detail = ? LIMIT 1').get(jstr(detail)) : null;
        if (dup) {
          const exImgs = (() => { try { return JSON.parse(dup.images || '[]'); } catch (_) { return []; } })();
          if (urls.length && !exImgs.length) {
            db.prepare('UPDATE questions SET images = ? WHERE id = ?').run(jstr(urls), dup.id);
            updated++;
          } else { skipped++; }
          continue;
        }
        const opts = (Array.isArray(c.options) ? c.options : [])
          .map((o) => ({ label: String((o && o.label) || '').slice(0, 16), text: String((o && o.text) || '') }))
          .filter((o) => o.text.trim());
        let answer = '';
        if (typeof c.answer === 'string') answer = c.answer.trim();
        else if (c.answer != null) answer = String(c.answer);
        let analysis = '';
        if (Array.isArray(c.analysis)) analysis = c.analysis.map((a) => `【${(a && a.label) || '解析'}】${(a && a.text) || ''}`).join('\n');
        else if (typeof c.analysis === 'string') analysis = c.analysis;
        // 学科/学段/题型/难度
        const subject = String((meta.subject && meta.subject.label) || '').trim().slice(0, 20);
        const stage = mfMapStage(meta.stage && meta.stage.label);
        const grade = mfMapGrade(meta.stage && meta.stage.label);
        const type = mfMapType(meta.questionType && meta.questionType.label, opts.length);
        const diff = mfMapDiff(meta.difficulty && meta.difficulty.raw);
        const tags = [].concat(Array.isArray(meta.knowledgePoints) ? meta.knowledgePoints : [],
          Array.isArray(meta.suggestedTags) ? meta.suggestedTags : []);
        cards.push({
          qno: rk, questionType: ({ single: '单选', multi: '多选', judge: '判断', fill: '填空', sort: '排序', answer: '解答' })[type] || '解答',
          stem, options: opts.map((o) => ({ label: o.label, content: o.text })), answer: answer.slice(0, 10000), analysis: analysis.slice(0, 10000),
          suggestedTags: [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20),
          figures: urls.map((u) => ({ url: u })), difficulty: diff, subject, stage, grade, checked: true,
          _q: { subject, stage, grade, type, stem, stem_html: '', options: opts, answer: answer.slice(0, 10000), analysis: analysis.slice(0, 10000), difficulty: diff, images: urls, detail },
        });
        imported++;
      } catch (e) {
        errors.push({ recordKey: rk || `#${imported + skipped + errors.length + 1}`, msg: e.message });
      }
    }
    let runId = 0;
    if (cards.length) {
      runId = db.prepare(`INSERT INTO mf_recog_runs (title, subject, stage, grade, source_kind, source_name, status, pages, drafts, ocr_texts, error, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(`技能包导入 ${String(pack.packageId || (req.file && req.file.originalname) || '').slice(0, 60)}`, '', '', '', 'skill',
        String((req.file && req.file.originalname) || pack.packageId || '转写包'), 'recognized', '[]', jstr(cards), '[]', '', now()).lastInsertRowid;
    }
    let msg = `已放入待审核：${imported} 题，跳过 ${skipped}，失败 ${errors.length}`;
    if (updated) msg += `，补图 ${updated}`;
    return ok(res, { total: qs.length, imported, staged: imported, run_id: runId, skipped, updated, failed: errors.length, errors: errors.slice(0, 20), warnings }, msg);
  } catch (e) {
    return fail(res, '导入失败：' + e.message);
  }
});

// ==================================================================== 存储与配置
/** 题目图片/公式图上传（走对象存储 bank/img） */
admin.post('/asset', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, '没有文件');
  try {
    const saved = await store.saveFile(req.file.buffer, req.file.originalname || 'img.png', `${bankFolder()}/img`);
    const url = await store.getUrl(saved.key, req.file.originalname || 'img.png');
    return ok(res, { key: saved.key, url, size: saved.size }, '已上传');
  } catch (e) {
    return fail(res, '上传失败：' + e.message);
  }
});

// ---------- 听力题音频（T7）：上传一段音频 / 用文字合成语音，存到题库音频目录 bank/audio/，题目里只记 key ----------
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|aac|webm)$/i;
const AUDIO_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', webm: 'audio/webm' };
function fixName(n) {   // multer 把中文文件名当 latin1 解码，还原一下
  const s = String(n || '');
  if (!/[\u0080-\u00ff]/.test(s)) return s;
  try { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('\ufffd') ? s : u; } catch (e) { return s; }
}
admin.post('/audio/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, '请选择音频文件');
  const name = fixName(req.file.originalname) || 'audio.mp3';
  if (!AUDIO_EXT_RE.test(name)) return fail(res, '仅支持 mp3 / m4a / wav / ogg / aac / webm 音频文件');
  try {
    const saved = await store.saveFile(req.file.buffer, name, `${bankFolder()}/audio`);
    return ok(res, { key: saved.key, url: store.getUrlSync(saved.key), name, size: saved.size }, '音频已上传');
  } catch (e) {
    return fail(res, '上传失败：' + e.message);
  }
});

/** 演示模式（TTS_MOCK=1）：不调系统语音，生成一小段提示音，自动化测试用 */
function mockWav(seconds = 0.8) {
  const rate = 8000, n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 6000 * Math.min(1, (n - i) / 800)), 44 + i * 2);
  return buf;
}
admin.post('/audio/tts', async (req, res) => {
  const text = String((req.body || {}).text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return fail(res, '请先填写要朗读的文字');
  const lang = /^zh/i.test(String((req.body || {}).lang || '')) ? 'zh-CN' : 'en-US';
  let r = Number((req.body || {}).rate); if (!Number.isFinite(r)) r = 1;
  const rate = Math.max(-6, Math.min(6, Math.round((r - 1) * 8)));
  let buf;
  try {
    buf = process.env.TTS_MOCK === '1' ? mockWav() : await require('./win-speak').speakToBuffer(text, lang, rate);
  } catch (e) {
    return fail(res, '语音合成失败：' + (process.platform === 'win32' ? (e.message || e) : '这台服务器没有可用的语音合成（用的是 Windows 自带语音），请改用「上传音频」') );
  }
  const mp3 = buf.length > 2 && ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0));
  try {
    const saved = await store.saveFile(buf, `tts.${mp3 ? 'mp3' : 'wav'}`, `${bankFolder()}/audio`);
    return ok(res, { key: saved.key, url: store.getUrlSync(saved.key), name: `朗读.${mp3 ? 'mp3' : 'wav'}`, size: saved.size }, '已生成朗读音频');
  } catch (e) {
    return fail(res, '保存失败：' + e.message);
  }
});

admin.get('/config', (req, res) => {
  return ok(res, {
    folder: bankFolder(),
    driver: store.driverName ? store.driverName() : store.DRIVER,
    cdn: store.CDN_DOMAIN || '',
    subfolders: ['img', 'recog', 'paper'],
  });
});

admin.put('/config', (req, res) => {
  const folder = String((req.body || {}).folder || '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(folder)) return fail(res, '目录名只能用字母、数字、下划线和中划线');
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('bank_folder', folder);
  return ok(res, { folder }, `题库文件目录已改为 ${folder}/（img 题目图、recog 录题页图、paper 导出试卷）`);
});

// ==================================================================== 未分类 / 待审核（题库管理左栏两个入口）
let pendingApi = null;   // 待审核题目（T3）聚合模块，文件末尾挂载
admin.get('/ext/badge-counts', (req, res) => {
  const uncat = Number(db.prepare(`SELECT COUNT(*) n FROM questions q
    WHERE NOT EXISTS (SELECT 1 FROM question_nodes qn JOIN bank_tree_nodes bn ON bn.id=qn.node_id JOIN bank_trees bt ON bt.id=bn.tree_id WHERE qn.question_id=q.id AND bt.kind='textbook')
    AND NOT EXISTS (SELECT 1 FROM question_nodes qn2 JOIN bank_tree_nodes bn2 ON bn2.id=qn2.node_id JOIN bank_trees bt2 ON bt2.id=bn2.tree_id WHERE qn2.question_id=q.id AND bt2.kind='knowledge')
    AND NOT EXISTS (SELECT 1 FROM paper_uploads pu WHERE pu.question_id=q.id AND pu.status IN ('pending','reviewed'))`).get().n) || 0;
  const review = Number(db.prepare("SELECT COUNT(*) n FROM paper_uploads WHERE status IN ('pending','reviewed') AND question_id>0").get().n) || 0;
  const pending = pendingApi ? pendingApi.counts() : { all: 0 };   // 各入口入库前的题目总数（待审核题目页角标）
  return ok(res, { uncat, review, pending: pending.all, pending_by: pending });
});

/** 待审核列表：学生上传的错题（paper_uploads pending/reviewed）带题目详情，逐条核对 */
admin.get('/ext/review-list', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Math.max(1, Number(req.query.size) || 20));
  const kw = String(req.query.kw || '').trim();
  let where = " WHERE pu.status IN ('pending','reviewed') AND pu.question_id>0"; const args = [];
  if (kw) { where += ' AND (q.stem LIKE ? OR u.name LIKE ? OR pu.point LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM paper_uploads pu JOIN questions q ON q.id=pu.question_id JOIN users u ON u.id=pu.user_id${where}`).get(...args).n) || 0;
  const rows = db.prepare(`SELECT pu.id AS up_id, pu.status AS up_status, pu.images AS up_images, pu.point AS pu_point,
      pu.subject AS pu_subject, pu.grade AS pu_grade, pu.stage AS pu_stage, pu.created_at AS up_created, pu.stem_text AS up_stem_text, pu.note AS up_note,
      q.id AS qid, q.stem, q.answer, q.analysis, q.subject, q.stage, q.grade, q.type, q.difficulty, q.point, q.images AS q_images, q.source, q.material,
      u.name AS student_name, u.grade AS student_grade
    FROM paper_uploads pu JOIN questions q ON q.id=pu.question_id JOIN users u ON u.id=pu.user_id${where}
    ORDER BY pu.created_at DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size)
    .map((r) => {
      let imgs = [];
      try { imgs = JSON.parse(r.up_images || '[]'); } catch (e) { imgs = []; }
      if (!Array.isArray(imgs)) imgs = [];
      return { ...r, up_images: imgs };
    });
  const pages = Math.max(1, Math.ceil(total / size));
  return ok(res, { total, page: Math.min(page, pages), size, list: rows });
});

// ==================================================================== AI 归属建议（按知识树自动判断学段/年级/科目/知识点/难度）
admin.post('/ext/ai-attrib', async (req, res) => {
  const stem = String((req.body || {}).stem || '').trim();
  if (!stem) return fail(res, '请先填写题干');
  const hintSubject = String((req.body || {}).subject || '').trim();
  const sys = '你是K12题库分类助手。判断题目的学段/年级/科目/难度，并给出教材章节与知识点。只输出JSON：'
    + '{"stage":"primary|junior","grade":"如七年级（小学给三~六年级）","subject":"数学|英语|物理|化学","difficulty":1到5的整数,'
    + '"unit":"教材单元关键词（如 有理数、Module 1、Unit 2；拿不准给空字符串）","knowledge":["知识点1","知识点2"]}'
    + '。不要输出其他内容。';
  let text = '';
  try {
    try {
      ({ text } = await require('./mfcollect').mfAiInvoke({ role: 'light', system: sys, user: stem.slice(0, 3000), maxTokens: 500, temperature: 0.1 }));
    } catch (e) {
      ({ text } = await aiLib.chat({ system: sys, user: stem.slice(0, 3000), maxTokens: 500, temperature: 0.1 }));
    }
  } catch (e) { return fail(res, 'AI 调用失败：' + e.message); }
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return fail(res, 'AI 返回格式异常：' + text.slice(0, 120));
  let ai; try { ai = JSON.parse(m[0]); } catch (e) { return fail(res, 'AI 返回解析失败'); }

  // 学科/学段校正：优先用户提示
  const subject = SUBJECTS.includes(hintSubject) ? hintSubject : (SUBJECTS.includes(ai.subject) ? ai.subject : '');
  const stage = ['primary', 'junior'].includes(ai.stage) ? ai.stage : '';
  const out = {
    stage, subject,
    grade: String(ai.grade || '').trim(),
    difficulty: Math.min(5, Math.max(1, int(ai.difficulty, 3))),
    nodes: [], ai_raw: ai,
  };
  // 按知识树匹配节点：教材章节（单元/小节） + 知识点（叶节点名包含 AI 词或 AI 词包含节点名）
  const matchNodes = (words, kind) => {
    if (!words.length || !subject || !stage) return [];
    const tree = db.prepare('SELECT * FROM bank_trees WHERE source LIKE ?').get(`seed:v1:${kind}:${subject}:${stage}`);
    if (!tree) return [];
    const nodes = db.prepare('SELECT id, name, parent_id FROM bank_tree_nodes WHERE tree_id=?').all(tree.id);
    const matched = [];
    const has = (a, b) => a && b && (a.includes(b) || b.includes(a));
    for (const n of nodes) {
      for (const w of words) {
        const kw = String(w || '').trim().replace(/^(Unit|Module|第.{1,3}章)\s*/i, '').trim();
        if (!kw || kw.length < 2) continue;
        if (has(n.name, kw) || has(kw, n.name)) { matched.push(n); break; }
      }
    }
    return matched.slice(0, 8);
  };
  const words = [].concat(ai.knowledge || [], ai.unit ? [ai.unit] : []);
  out.nodes = matchNodes(words, 'knowledge').map((n) => ({ id: n.id, name: n.name, tree: 'knowledge' }))
    .concat(matchNodes([ai.unit].filter(Boolean), 'textbook').map((n) => ({ id: n.id, name: n.name, tree: 'textbook' })));
  return ok(res, out);
});

// ==================================================================== 知识树种子（幂等，启动时自动补齐）
try { require('./mfseed').ensureSeed(db); } catch (e) { console.error('[mfbank] 种子导入异常:', e.message); }

// ==================================================================== 待审核题目（T3）：各入口入库前的题目统一列表（src/mfpending.js）
pendingApi = require('./mfpending')({ admin, db, ok, fail, now, int, parseArr, parseObj, jstr, TYPE_MAP, TYPES, commitRunCards, commitCaptureItems, store, bankFolder });

module.exports = { admin, cap, defaultLayout, bankFolder };
