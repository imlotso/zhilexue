'use strict';
/**
 * 智能题库（2026-10 新增）
 *  - 管理端 /api/admin/bank/*：题库管理 / 智能组卷 / 课文习题（绑定知识点视频）/ 错题记录
 *  - 学生端 /api/stu/bank/*  ：知识点做练习 / 我的试卷 / 交卷判分 / 错题本
 *
 * 题目直接存 questions 表（老题库共表），新增列：stage 学段 / point 知识点 /
 * material 复合题原文 / source 来源 / year 年份 / video_id 绑定的知识点视频。
 * 题型：single 单选 / multi 多选 / judge 判断 / fill 填空 / sort 排序·连词成句。
 * 错题本复用 mistakes 表，作答记录复用 records 表。
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('./db');
const { parseBankWorkbook, makeBankTemplate } = require('./bank-excel');
const { judgeQ } = require('./bank-judge');
const kbtree = require('./kbtree');
const compose = require('./compose');
const { pickTree } = require('./treepick');   // R2：按 学段+学科+默认版本 取树
const accuracy = require('./accuracy');   // T5：管理端一键组卷 / 学生端自组卷共用的抽题核心   // T4：知识树统一，旧 kb_* 并入 bank_trees

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败', code = 1) => res.json({ code, msg });

const TYPES = ['single', 'multi', 'judge', 'fill', 'sort'];
const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题' };
const LETTERS = 'ABCDEFG';
const STAGES = [['primary', '小学'], ['junior', '初中']];
const GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '中考冲刺'];
const SUBJECTS = ['数学', '英语', '物理', '化学'];

/** 选项归一化：兼容 {label,text} 对象数组（Word 批量上传 / 转写包）与字符串数组 */
const normOpts = (arr) => (Array.isArray(arr) ? arr : []).map((o) => {
  if (typeof o === 'string') return o.trim();
  if (o && typeof o === 'object') return String(o.text || o.content || '').trim();
  return String(o || '').trim();
}).filter((s) => s !== '');

const parseQ = (row) => {
  if (!row) return row;
  let options = [];
  try { options = JSON.parse(row.options || '[]'); } catch (e) { options = []; }
  options = normOpts(options);
  let images = [];
  try { images = JSON.parse(row.images || '[]'); } catch (e) { images = []; }
  if (!Array.isArray(images)) images = [];
  return { ...row, options, images };
};
const parseIds = (s) => {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch (e) { return []; }
};
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// ------------------------------------------------------------------ 判分
// judgeQ 在 src/bank-judge.js（独立模块，便于本地单测）

// ------------------------------------------------------------------ 入库校验
/** 新增/编辑题目：校验并归一化，返回 { q, err } */
function normalizeBankQ(b) {
  const type = TYPES.includes(b.type) ? b.type : '';
  const stem = String(b.stem || '').trim();
  if (!type) return { err: '请选择题型' };
  if (!stem) return { err: '题干必填' };
  let options = Array.isArray(b.options) ? b.options.map((s) => String(s || '').trim()).filter((s) => s !== '') : [];
  let answer = String(b.answer || '').trim();
  if (type === 'single' || type === 'multi') {
    if (options.length < 2) return { err: '选择题至少需要 2 个选项' };
    const letters = [...new Set((answer.toUpperCase().match(/[A-G]/g) || []))].sort();
    if (!letters.length) return { err: '答案应为选项字母，如 B 或 A,B' };
    const bad = letters.find((L) => LETTERS.indexOf(L) >= options.length);
    if (bad) return { err: `答案包含不存在的选项 ${bad}` };
    if (type === 'single' && letters.length > 1) return { err: '单选题答案只能有一个字母' };
    answer = letters.join(',');
  } else if (type === 'judge') {
    const a = answer.toUpperCase();
    if (['正确', '对', '√', 'T', 'TRUE', 'A', 'Y', 'YES', '是'].includes(a)) answer = '正确';
    else if (['错误', '错', '×', 'X', 'F', 'FALSE', 'B', 'N', 'NO', '否'].includes(a)) answer = '错误';
    else return { err: '判断题答案应为 正确 / 错误' };
    options = ['正确', '错误'];
  } else if (type === 'fill') {
    if (!answer) return { err: '请填写每空的答案（多空用 | 分隔）' };
    options = [];
  } else if (type === 'sort') {
    if (options.length < 2) return { err: '排序题至少需要 2 个选项' };
    // 答案支持字母序列（CABDE）或序号序列（3,1,2,4,5）
    const up = answer.toUpperCase().replace(/[^A-G1-9]/g, '');
    let seq;
    if (/[A-G]/.test(up) && !/[1-9]/.test(up)) seq = up.split('').map((L) => LETTERS.indexOf(L) + 1);
    else seq = (up.match(/\d/g) || []).map(Number);
    if (seq.length !== options.length) return { err: `排序答案需要包含全部 ${options.length} 个选项` };
    if (new Set(seq).size !== options.length || seq.some((n) => n < 1 || n > options.length)) return { err: '排序答案格式不正确' };
    answer = seq.join(',');
  }
  let video = null;
  if (b.video_id) video = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(b.video_id));
  const imgs = (Array.isArray(b.images) ? b.images : []).map((s) => String(s || '').trim()).filter((s) => /^\/pu\/[A-Za-z0-9_.-]+$/.test(s)).slice(0, 6);
  return {
    q: {
      stage: String(b.stage || '').trim(),
      subject: String(b.subject || '').trim() || (video && video.subject) || '',
      grade: String(b.grade || '').trim() || (video && video.grade) || '',
      point: String(b.point || '').trim(),
      type, stem,
      material: String(b.material || '').trim(),
      options,
      answer,
      analysis: String(b.analysis || '').trim(),
      difficulty: Math.min(5, Math.max(1, Number(b.difficulty) || 3)),
      source: String(b.source || '').trim(),
      year: String(b.year || '').trim(),
      images: imgs,
      chapter_id: video ? video.chapter_id : (b.chapter_id ? Number(b.chapter_id) : null),
      video_id: video ? video.id : null,
    },
    err: '',
  };
}

/** 给学生返回的题目（不含答案与解析） */
function serveQ(q) {
  const imgs = (() => { try { const a = JSON.parse(q.images || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
  return {
    id: q.id, type: q.type, subject: q.subject || '', stem: q.stem, material: q.material || '',
    options: parseQ(q).options, difficulty: q.difficulty, point: q.point || '', images: imgs,
    audio_url: q.audio_key ? store.getUrlSync(q.audio_key) : '',   // 听力题的音频（T7）；本地存储时是 /api/file?key=…，前端播放时补登录票据
    blanks: q.type === 'fill' ? String(q.answer || '').replace(/\|\|\|/g, '\u0001').split('|').length : 0,
  };
}

// ================================================================== 管理端
const admin = express.Router();
admin.use((req, res, next) => {   // 由 app.js 挂载前已完成鉴权；这里再兜一道
  if (!req.user || !['admin', 'branch'].includes(req.user.role)) return res.status(403).json({ code: 403, msg: '无权限' });
  next();
});

// ---------- 题库管理 ----------
admin.get('/questions', (req, res) => {
  const { stage = '', subject = '', grade = '', point = '', type = '', difficulty = '', source = '', video = '', kw = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
  let where = ' WHERE 1=1'; const args = [];
  if (stage) { where += " AND IFNULL(q.stage,'')=?"; args.push(stage); }
  if (subject) { where += ' AND q.subject=?'; args.push(subject); }
  if (grade) { where += ' AND q.grade=?'; args.push(grade); }
  if (point) { where += " AND IFNULL(q.point,'') LIKE ?"; args.push(`%${point}%`); }
  if (type) { where += ' AND q.type=?'; args.push(type); }
  if (difficulty) { where += ' AND q.difficulty=?'; args.push(Number(difficulty)); }
  if (source) { where += ' AND q.source=?'; args.push(source); }
  if (video === 'bound') where += ' AND q.video_id IS NOT NULL';
  if (video === 'none') where += ' AND q.video_id IS NULL';
  if (video === 'free') where += ' AND q.video_id IS NULL AND q.section_id IS NULL';   // R8：既没绑视频也没挂小分组（课文习题「从题库选择」用）
  if (kw) { where += ' AND (q.stem LIKE ? OR q.point LIKE ? OR q.material LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const total = Number((db.prepare('SELECT COUNT(*) n FROM questions q' + where).get(...args) || {}).n || 0);
  const rows = db.prepare(`SELECT q.*, v.title AS video_title, c.name AS chapter_name
    FROM questions q LEFT JOIN videos v ON v.id=q.video_id LEFT JOIN chapters c ON c.id=q.chapter_id
    ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size).map(parseQ);
  ok(res, { total, page, size, list: rows });
});

admin.post('/questions', (req, res) => {
  const { q, err } = normalizeBankQ(req.body || {});
  if (err) return fail(res, err);
  const info = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`)
    .run(q.chapter_id, q.subject, q.grade, q.type, q.stem, JSON.stringify(q.options), q.answer, q.analysis, q.difficulty,
      q.stage, q.point, q.material, q.source, q.year, q.video_id, JSON.stringify(q.images || []), now());
  // R8：课文习题里给「小分组」添加的题，直接挂到该小分组（与 video_id 二选一）
  const sec = !q.video_id && req.body && req.body.section_id ? db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.body.section_id)) : null;
  if (sec) db.prepare('UPDATE questions SET section_id=?, chapter_id=? WHERE id=?').run(sec.id, sec.chapter_id, info.lastInsertRowid);
  ok(res, { id: info.lastInsertRowid }, '题目已添加');
});

admin.put('/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!cur) return fail(res, '题目不存在');
  const { q, err } = normalizeBankQ(req.body || {});
  if (err) return fail(res, err);
  db.prepare(`UPDATE questions SET chapter_id=?,subject=?,grade=?,type=?,stem=?,options=?,answer=?,analysis=?,difficulty=?,stage=?,point=?,material=?,source=?,year=?,video_id=?,images=? WHERE id=?`)
    .run(q.chapter_id, q.subject, q.grade, q.type, q.stem, JSON.stringify(q.options), q.answer, q.analysis, q.difficulty,
      q.stage, q.point, q.material, q.source, q.year, q.video_id, JSON.stringify(q.images || []), id);
  ok(res, null, '已保存');
});

admin.delete('/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM questions WHERE id=?').run(id);
  db.prepare('DELETE FROM mistakes WHERE question_id=?').run(id);
  ok(res, null, '已删除');
});

// 批量删除
admin.post('/questions/batch-delete', (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请选择要删除的题目');
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM questions WHERE id IN (${ph})`).run(...ids);
  db.prepare(`DELETE FROM mistakes WHERE question_id IN (${ph})`).run(...ids);
  ok(res, { count: ids.length }, `已删除 ${ids.length} 道题`);
});

// Excel 导入（多 sheet 模板）
admin.post('/questions/import', upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  const b = req.body || {};
  let parsed;
  try { parsed = parseBankWorkbook(req.file.buffer); }
  catch (e) { return fail(res, '文件解析失败：' + e.message); }
  const defStage = String(b.stage || '').trim();
  const defSubject = String(b.subject || '').trim();
  const defGrade = String(b.grade || '').trim();
  const defPoint = String(b.point || '').trim();
  const ins = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,'',?,NULL,?)`);
  const made = [];
  const tx = db.transaction(() => {
    for (const q of parsed.items) {
      const info = ins.run(null, q.subject || defSubject, q.grade || defGrade, q.type, q.stem,
        JSON.stringify(q.options || []), q.answer, q.analysis || '', 3, q.stage || defStage,
        q.point || defPoint, q.material || '', q.year || '', now());
      made.push(info.lastInsertRowid);
    }
  });
  tx();
  ok(res, { imported: parsed.items.length, errors: parsed.errors },
    `成功导入 ${parsed.items.length} 道题` + (parsed.errors.length ? `，${parsed.errors.length} 条未通过` : ''));
});

admin.get('/questions/template', (req, res) => {
  const tmp = path.join(os.tmpdir(), `智能题库导入模板-${Date.now()}.xlsx`);
  makeBankTemplate(tmp, String(req.query.subject || ''));
  res.download(tmp, '智能题库导入模板.xlsx');
});

// 知识点下拉：题库里出现过的知识点文本 ∪ 知识点树（bank_trees）里的叶子节点名。返回值结构不变（字符串数组）。
// 题库里已有的自由文本不能丢（旧题的 point 字段是文本），所以是并集而不是只读树。
admin.get('/points', (req, res) => {
  const { subject = '' } = req.query;
  const rows = subject
    ? db.prepare("SELECT DISTINCT point FROM questions WHERE IFNULL(point,'')<>'' AND subject=? ORDER BY point").all(subject)
    : db.prepare("SELECT DISTINCT point FROM questions WHERE IFNULL(point,'')<>'' ORDER BY point").all();
  const set = new Set();
  rows.forEach((r) => String(r.point).split(/&&|,|，/).forEach((p) => { const t = p.trim(); if (t) set.add(t); }));
  const subjects = subject ? [subject] : SUBJECTS;
  subjects.forEach((sub) => kbtree.pointNames(db, { subject: sub }).forEach((n) => set.add(n)));
  ok(res, [...set]);
});

// ---------- 教材知识点树（数/英/物/化 · 小学/初中 · 江苏教材版本，AI 生成 + 手动维护） ----------
const KB_EDITIONS = {
  '数学': { primary: '苏教版', junior: '苏科版' },
  '英语': { primary: '译林版', junior: '译林版' },
  '物理': { primary: '', junior: '苏科版' },
  '化学': { primary: '', junior: '沪教版' },
};

/** 旧接口返回结构：[{id, name, points:[{id,name}]}]。T4 起数据来自 bank_trees（id 为树节点 id），points 为该学科+学段知识点树的全部叶子名 */
function kbTree(subject, stage, grade) {
  return kbtree.readUnits(db, subject, stage, grade);
}

// 看树：list = 该年级的 单元 → 知识点；points = 知识点树里全部知识点名（录题 AI 补全等用）
admin.get('/kbtree', (req, res) => {
  const { subject = '数学', stage = 'primary', grade = '' } = req.query;
  if (!SUBJECTS.includes(subject)) return fail(res, '学科不正确');
  ok(res, {
    edition: (KB_EDITIONS[subject] || {})[stage] || '',
    list: kbTree(subject, stage, grade),
    points: kbtree.pointNames(db, { subject, stage, grade }),
  });
});

// 手动加单元（写入知识点树的"教材单元知识点"分支）
admin.post('/kbtree/unit', (req, res) => {
  const b = req.body || {};
  if (!SUBJECTS.includes(b.subject) || !String(b.name || '').trim()) return fail(res, '参数不完整');
  const id = kbtree.addUnit(db, b.subject, b.stage || '', b.grade || '', String(b.name).trim(), Number(b.sort) || 0);
  ok(res, { id });
});

// 删单元（连带知识点；id 为知识点树的节点 id）
admin.delete('/kbtree/unit/:id', (req, res) => {
  kbtree.deleteNode(db, Number(req.params.id));
  ok(res);
});

// 手动加知识点（unit_id 为单元节点 id）
admin.post('/kbtree/point', (req, res) => {
  const b = req.body || {};
  const uid = Number(b.unit_id);
  if (!uid || !String(b.name || '').trim()) return fail(res, '参数不完整');
  const id = kbtree.addPoint(db, uid, String(b.name).trim(), Number(b.sort) || 0);
  if (!id) return fail(res, '单元不存在');
  ok(res, { id });
});

// 删知识点
admin.delete('/kbtree/point/:id', (req, res) => {
  kbtree.deleteNode(db, Number(req.params.id));
  ok(res);
});

// AI 生成：按 学科+学段+年级 拆解教材单元与知识点，合并进知识点树（只新增、不删除已有节点——树上挂着题目关联，覆盖会丢）
admin.post('/kbtree/generate', async (req, res) => {
  const b = req.body || {};
  const subject = String(b.subject || ''), stage = String(b.stage || ''), grade = String(b.grade || '');
  if (!SUBJECTS.includes(subject) || !['primary', 'junior'].includes(stage) || !grade) return fail(res, '请选择学科、学段和年级');
  const edition = (KB_EDITIONS[subject] || {})[stage];
  if (!edition) return fail(res, `${subject} ${stage === 'primary' ? '小学' : '初中'}阶段没有对应教材，请核对`);
  const stgName = stage === 'primary' ? '小学' : '初中';
  const sys = '你是资深的江苏地区 K12 教研员，熟悉义务教育课程标准（2022 年版）和江苏教材。只输出 JSON 本身，不要 markdown 代码块、不要任何解释。';
  const user = `请给出江苏地区${stgName}${grade}「${subject}」学科（${edition}教材）一学年的知识体系拆解：
按教材单元顺序列出单元，每个单元下给出 3~8 个具体知识点（知识点是可出题、可检测的最小教学单位，如「两位数乘两位数的笔算」「一般将来时 will 的用法」）。
输出 JSON：{"units":[{"name":"单元名（与教材目录一致，如「第1单元 有理数」或教材章节名）","points":["知识点1","知识点2"]}]}
要求：单元 6~12 个；知识点表述与${edition}教材用语一致；禁止编造教材里没有的单元。`;
  try {
    const { chat } = require('./ai');
    const { text } = await chat({ system: sys, user, maxTokens: 3000, temperature: 0.2 });
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
    const body = fence ? fence[1] : String(text || '');
    const a = body.indexOf('{'), bb = body.lastIndexOf('}');
    if (a < 0 || bb <= a) throw new Error('模型没有返回 JSON');
    const j = JSON.parse(body.slice(a, bb + 1));
    const units = (Array.isArray(j.units) ? j.units : []).filter((u) => u && String(u.name || '').trim());
    if (!units.length) throw new Error('模型返回的单元为空，请重试');
    const r = kbtree.mergeGenerated(db, subject, stage, grade, units.map((u) => ({ name: String(u.name).trim().slice(0, 120), points: (Array.isArray(u.points) ? u.points : []).map((p) => String(p || '').trim().slice(0, 120)).filter(Boolean) })));
    ok(res, { edition, list: kbTree(subject, stage, grade), model: 'AI 已合并', created: r.created }, r.created ? `已合并 AI 拆解结果：新增 ${r.created} 个节点（已有的保留）` : 'AI 拆解的内容树里都已存在，没有新增');
  } catch (e) {
    fail(res, 'AI 拆解失败：' + (e.message || e));
  }
});

// AI 归属建议：一道题 → 学段/年级/单元/知识点/难度
admin.post('/ai-attri', async (req, res) => {
  const b = req.body || {};
  const stem = String(b.stem || '').trim();
  if (!stem) return fail(res, '请先填写题干');
  const subject = String(b.subject || '数学');
  if (!SUBJECTS.includes(subject)) return fail(res, '学科不正确');
  const opts = Array.isArray(b.options) ? b.options.filter(Boolean).join('；') : '';
  // 给模型该学科的树做参照（选最贴近的学段由模型判断，取全部年级的单元名拼接）
  const units = kbtree.unitLines(db, subject);
  const treeText = units.map((u) => `${u.stage === 'primary' ? '小学' : '初中'}·${u.grade || ''}·${u.name}`).join('\n');
  const sys = '你是资深的 K12 题库标注员，负责把题目归入教材知识体系。只输出 JSON 本身，不要 markdown 代码块、不要任何解释。';
  const user = `请判断下面这道「${subject}」题的归属。可以的话从知识体系清单里选最贴近的单元；清单里没有就按课标写最合理的。
题干：${stem.slice(0, 800)}
${opts ? `选项：${opts.slice(0, 400)}` : ''}
${b.material ? `原文材料：${String(b.material).slice(0, 500)}` : ''}

知识体系清单（供参照）：
${treeText.slice(0, 4000) || '（暂无，请按课标判断）'}

输出 JSON：{"stage":"primary 或 junior","grade":"三年级~九年级 或 中考冲刺 之一","unit":"最贴近的单元名","point":"知识点（10字内，具体）","difficulty":1到5的整数,"reason":"一句话判断依据"}`;
  try {
    const { chat } = require('./ai');
    const { text } = await chat({ system: sys, user, maxTokens: 400, temperature: 0.1 });
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
    const body = fence ? fence[1] : String(text || '');
    const a = body.indexOf('{'), bb = body.lastIndexOf('}');
    if (a < 0 || bb <= a) throw new Error('模型没有返回 JSON');
    const j = JSON.parse(body.slice(a, bb + 1));
    ok(res, {
      stage: j.stage === 'primary' ? 'primary' : 'junior',
      grade: String(j.grade || ''),
      unit: String(j.unit || ''),
      point: String(j.point || ''),
      difficulty: Math.min(5, Math.max(1, Number(j.difficulty) || 3)),
      reason: String(j.reason || ''),
    });
  } catch (e) {
    fail(res, 'AI 归属失败：' + (e.message || e));
  }
});

// ---------- 智能组卷 ----------
// 纸张列表
admin.get('/papers', (req, res) => {
  const { subject = '', status = '' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (subject) { where += ' AND p.subject=?'; args.push(subject); }
  if (status) { where += ' AND p.status=?'; args.push(status); }
  const rows = db.prepare(`SELECT p.* FROM papers p${where} ORDER BY p.id DESC`).all(...args);
  ok(res, rows.map((p) => {
    const ids = parseIds(p.q_ids);
    return { ...p, q_ids: undefined, q_count: ids.length, done_count: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM paper_tries WHERE paper_id=?').get(p.id).n,
      assign_count: db.prepare('SELECT COUNT(*) n FROM paper_assignments WHERE paper_id=?').get(p.id).n };
  }));
});

// 新建 / 保存试卷
admin.post('/papers', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return fail(res, '试卷标题必填');
  const ids = parseIds(JSON.stringify(b.q_ids || []));
  if (!ids.length) return fail(res, '请先组好卷面题目');
  // 校验题目都存在
  const ph = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id FROM questions WHERE id IN (${ph})`).all(...ids).length;
  if (found !== ids.length) return fail(res, '有题目已不存在，请重新组卷');
  const info = db.prepare(`INSERT INTO papers (title,subject,stage,grade,term,duration,total_score,q_ids,status,created_by,created_at,published_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(title, String(b.subject || ''), String(b.stage || ''), String(b.grade || ''), String(b.term || ''),
      Number(b.duration) || 90, Number(b.total_score) || 100, JSON.stringify(ids),
      b.status === 'published' ? 'published' : 'draft', req.user.id, now(), b.status === 'published' ? now() : null);
  ok(res, { id: info.lastInsertRowid }, b.status === 'published' ? '试卷已保存并下发' : '试卷已保存');
});

admin.put('/papers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM papers WHERE id=?').get(Number(req.params.id));
  if (!p) return fail(res, '试卷不存在');
  const b = req.body || {};
  const title = b.title === undefined ? p.title : String(b.title).trim();
  if (!title) return fail(res, '试卷标题不能为空');
  let ids = p.q_ids;
  if (b.q_ids !== undefined) {
    ids = JSON.stringify(parseIds(JSON.stringify(b.q_ids || [])));
    const arr = parseIds(ids);
    if (!arr.length) return fail(res, '卷面题目不能为空');
    const ph = arr.map(() => '?').join(',');
    const found = db.prepare(`SELECT id FROM questions WHERE id IN (${ph})`).all(...arr).length;
    if (found !== arr.length) return fail(res, '有题目已不存在，请重新组卷');
  }
  db.prepare('UPDATE papers SET title=?,subject=?,stage=?,grade=?,term=?,duration=?,total_score=?,q_ids=? WHERE id=?')
    .run(title,
      b.subject === undefined ? p.subject : String(b.subject || ''),
      b.stage === undefined ? p.stage : String(b.stage || ''),
      b.grade === undefined ? p.grade : String(b.grade || ''),
      b.term === undefined ? p.term : String(b.term || ''),
      b.duration === undefined ? p.duration : (Number(b.duration) || 90),
      b.total_score === undefined ? p.total_score : (Number(b.total_score) || 100),
      ids, p.id);
  ok(res, null, '已保存');
});

// 下发 / 撤回
admin.post('/papers/:id/publish', (req, res) => {
  const p = db.prepare('SELECT * FROM papers WHERE id=?').get(Number(req.params.id));
  if (!p) return fail(res, '试卷不存在');
  const pub = Number((req.body || {}).publish) === 1;
  if (pub && !parseIds(p.q_ids).length) return fail(res, '卷面还没有题目，不能下发');
  db.prepare('UPDATE papers SET status=?, published_at=? WHERE id=?').run(pub ? 'published' : 'draft', pub ? now() : null, p.id);
  if (!pub) db.prepare('DELETE FROM paper_assignments WHERE paper_id=?').run(p.id);   // 撤回同时清掉定向下发名单
  ok(res, { status: pub ? 'published' : 'draft' }, pub ? '已下发到学生端' : '已撤回');
});

// 这份试卷有没有定向下发名单：有名单 = 只对名单里的学生可见
const paperHasAssignees = (pid) => !!db.prepare('SELECT 1 FROM paper_assignments WHERE paper_id=? LIMIT 1').get(pid);

// ---------- 试卷定向下发：老师单选 / 多选学生，学生端「我的任务」展示 ----------
admin.get('/papers/:id/assignees', (req, res) => {
  const pid = Number(req.params.id);
  const rows = db.prepare(`SELECT a.user_id, u.name, u.grade FROM paper_assignments a JOIN users u ON u.id=a.user_id WHERE a.paper_id=?`).all(pid);
  ok(res, rows);
});

admin.post('/papers/:id/assign', (req, res) => {
  const pid = Number(req.params.id);
  const p = db.prepare('SELECT * FROM papers WHERE id=?').get(pid);
  if (!p) return fail(res, '试卷不存在');
  if (!parseIds(p.q_ids).length) return fail(res, '卷面还没有题目，不能下发');
  const ids = [...new Set((Array.isArray((req.body || {}).user_ids) ? req.body.user_ids : []).map(Number).filter(Boolean))];
  if (!ids.length) return fail(res, '请至少选择一名学生');
  const ins = db.prepare('INSERT OR IGNORE INTO paper_assignments (paper_id, user_id, assigned_by, created_at) VALUES (?,?,?,?)');
  let added = 0;
  const tx = db.transaction(() => {
    ids.forEach((uid) => { const r = ins.run(pid, uid, req.user.id, now()); if (r.changes) added++; });
  });
  tx();
  db.prepare('UPDATE papers SET status=?, published_at=CASE WHEN published_at IS NULL THEN ? ELSE published_at END WHERE id=?').run('published', now(), pid);
  ok(res, { added, total: ids.length }, `已下发给 ${ids.length} 名学生（新增 ${added}）`);
});

admin.delete('/papers/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM papers WHERE id=?').run(id);
  db.prepare('DELETE FROM paper_tries WHERE paper_id=?').run(id);
  ok(res, null, '已删除');
});

// 组卷范围：学科/学段/年级/难度/知识点文本 + 章节树或知识点树里选中的节点（node_ids，含全部后代）
const composeScope = (b) => ({
  subject: b.subject, stage: b.stage, grade: b.grade, difficulty: b.difficulty, point: b.point,
  nodeIds: Array.isArray(b.node_ids) ? b.node_ids : [],
});

// 范围内各题型有多少题：老师选好章节/知识点后看一眼，知道能抽多少
admin.post('/papers/pool', (req, res) => {
  ok(res, compose.poolCounts(db, composeScope(req.body || {})));
});

// 一键组卷：按条件从题库抽题（题库不足时返回 missing 提示）。与学生端「章节组卷 / 知识点组卷」共用 compose.js
admin.post('/papers/auto', (req, res) => {
  const b = req.body || {};
  const counts = b.counts || {};
  if (!TYPES.some((t) => Number(counts[t]) > 0)) return fail(res, '请至少填写一种题型的数量');
  const r = compose.pickByCounts(db, composeScope(b), counts);
  const missing = r.missing.map((m) => `${TYPE_NAMES[m.type]} 差 ${m.need} 题`);
  // 按题型归组返回（预览按题型分大题）
  ok(res, {
    list: r.rows.map(parseQ).map((q) => ({
      id: q.id, type: q.type, stem: q.stem, material: q.material || '', options: q.options,
      difficulty: q.difficulty, subject: q.subject, grade: q.grade, stage: q.stage, point: q.point || '',
    })),
    missing,
  }, missing.length ? `已抽出 ${r.rows.length} 题（${missing.join('、')}）` : `已抽出 ${r.rows.length} 题`);
});

// 试卷详情（组卷编辑时回显，含答案）
admin.get('/papers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM papers WHERE id=?').get(Number(req.params.id));
  if (!p) return fail(res, '试卷不存在');
  const ids = parseIds(p.q_ids);
  const qs = ids.map((id) => db.prepare('SELECT * FROM questions WHERE id=?').get(id)).filter(Boolean).map(parseQ);
  ok(res, { ...p, q_ids: undefined, questions: qs });
});

// ---------- 课文习题（选课本 → 分组 → 视频 → 绑题） ----------
// 课程目录（课本）列表：带视频数与绑题数
admin.get('/chapters', (req, res) => {
  const { subject = '' } = req.query;
  let where = ' WHERE 1=1'; const args = [];
  if (subject) { where += ' AND c.subject=?'; args.push(subject); }
  const rows = db.prepare(`SELECT c.id, c.name, c.subject, c.grade, c.stage, c.term, c.category, c.book,
      (SELECT COUNT(*) FROM videos v WHERE v.chapter_id=c.id) AS video_count,
      (SELECT COUNT(*) FROM questions q WHERE q.chapter_id=c.id AND (q.video_id IS NOT NULL OR q.section_id IS NOT NULL)) AS question_count
    FROM chapters c${where}
    ORDER BY FIELD(c.subject,'数学','英语','物理','化学'), c.sort, c.id`).all(...args);
  ok(res, rows);
});
// 某课本的分组 + 视频（每个视频带绑题数）
admin.get('/chapters/:id/lessons', (req, res) => {
  const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(req.params.id));
  if (!c) return fail(res, '课程目录不存在');
  const secs = db.prepare(`SELECT s.id, s.name, s.sort,
      (SELECT COUNT(*) FROM questions q WHERE q.section_id=s.id) AS question_count
    FROM sections s WHERE s.chapter_id=? ORDER BY s.sort, s.id`).all(c.id);
  const videos = db.prepare(`SELECT v.id, v.title, v.section_id,
      (SELECT COUNT(*) FROM questions q WHERE q.video_id=v.id) AS question_count
    FROM videos v WHERE v.chapter_id=? ORDER BY v.sort, v.id`).all(c.id);
  // R8：每个视频关联的知识点（名字），列表上直接显示
  const vn = new Map();
  if (videos.length) {
    db.prepare(`SELECT vn.video_id AS vid, n.id, n.name FROM video_nodes vn JOIN bank_tree_nodes n ON n.id=vn.node_id
      WHERE vn.video_id IN (${videos.map(() => '?').join(',')}) ORDER BY n.sort, n.id`).all(...videos.map((v) => v.id))
      .forEach((r) => { if (!vn.has(r.vid)) vn.set(r.vid, []); vn.get(r.vid).push({ id: r.id, name: r.name }); });
  }
  videos.forEach((v) => { v.nodes = vn.get(v.id) || []; });
  ok(res, { chapter: c, grouped: secs.length > 0, sections: secs, videos });
});
// 学情：某个学生按「课程 → 小分组 → 视频」的习题正确率（口径见 src/accuracy.js）
admin.get('/accuracy', (req, res) => {
  const uid = Number(req.query.user_id) || 0;
  const u = db.prepare("SELECT id, name, username, grade, term, created_by FROM users WHERE id=? AND role='student'").get(uid);
  if (!u) return fail(res, '学生不存在');
  if (req.user.role === 'branch' && Number(u.created_by) !== Number(req.user.id)) return fail(res, '无权查看该学生', 403);
  const videos = db.prepare(`SELECT v.id, v.title, v.chapter_id, v.sort, ${accuracy.SEC_EXPR} AS sid
    FROM videos v WHERE v.chapter_id IS NOT NULL AND EXISTS (SELECT 1 FROM questions q WHERE q.video_id=v.id AND q.type<>'answer')
    ORDER BY v.chapter_id, v.sort, v.id`).all();
  const stats = accuracy.videoStats(db, uid, videos.map((v) => v.id));
  const chapters = new Map(db.prepare('SELECT id, name, subject, grade, term FROM chapters').all().map((c) => [c.id, c]));
  const secName = new Map(db.prepare('SELECT id, name, sort FROM sections').all().map((x) => [x.id, x]));
  const byCh = new Map();
  videos.forEach((v) => {
    const c = chapters.get(v.chapter_id); if (!c) return;
    if (!byCh.has(c.id)) byCh.set(c.id, { chapter: c, groups: new Map() });
    const g = byCh.get(c.id).groups;
    const sid = secName.has(Number(v.sid)) ? Number(v.sid) : 0;
    if (!g.has(sid)) g.set(sid, []);
    g.get(sid).push({ id: v.id, title: v.title, acc: accuracy.ofVideo(stats, v.id) });
  });
  const courses = [...byCh.values()].map(({ chapter, groups }) => {
    const gl = [...groups.entries()].map(([sid, vs]) => ({
      id: sid, name: sid ? secName.get(sid).name : '未分组', sort: sid ? secName.get(sid).sort : 9999,
      videos: vs, acc: accuracy.sum(vs.map((x) => x.acc)),
    })).sort((a, b) => (a.sort - b.sort) || (a.id - b.id));
    return { id: chapter.id, name: chapter.name, subject: chapter.subject || '', grade: chapter.grade || '', term: chapter.term || '',
      groups: gl, acc: accuracy.sum(gl.map((x) => x.acc)) };
  });
  ok(res, { student: { id: u.id, name: u.name, username: u.username, grade: u.grade || '', term: u.term || '' }, courses, acc: accuracy.sum(courses.map((c) => c.acc)) });
});

// 后台：导出某个学生的错题 Word（T9）。分校只能导出自己校区的学生
admin.get('/mistakes/export-docx', async (req, res) => {
  try {
    const uid = Number(req.query.user_id) || 0;
    const u = db.prepare("SELECT id, name, username, created_by FROM users WHERE id=? AND role='student'").get(uid);
    if (!u) return fail(res, '学生不存在');
    if (req.user.role === 'branch' && Number(u.created_by) !== Number(req.user.id)) return fail(res, '无权导出该学生的错题', 403);
    await require('./mistake-docx').sendMistakeDocx(db, res, u, req.query);
  } catch (e) {
    console.error('[admin mistakes/export-docx]', (e && e.message) || e);
    if (!res.headersSent) fail(res, '导出失败：' + ((e && e.message) || e));
  }
});

// 某视频绑定的题目（含答案，管理端用）
admin.get('/videos/:id/questions', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '视频不存在');
  const rows = db.prepare('SELECT * FROM questions WHERE video_id=? ORDER BY id').all(v.id).map(parseQ);
  // R8：顺带返回视频关联的知识点（编辑题目时默认继承）
  const nodes = db.prepare('SELECT n.id, n.name FROM video_nodes vn JOIN bank_tree_nodes n ON n.id=vn.node_id WHERE vn.video_id=? ORDER BY n.sort, n.id').all(v.id);
  ok(res, { video: v, list: rows, nodes });
});
// 绑定 / 解绑题目到视频（解绑走 /videos/0/bind + unbind=1，不要求视频存在）
admin.post('/videos/:id/bind', (req, res) => {
  const b = req.body || {};
  const unbind = Number(b.unbind) === 1;
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请选择题目');
  const ph = ids.map(() => '?').join(',');
  if (unbind) {
    db.prepare(`UPDATE questions SET video_id=NULL, chapter_id=NULL WHERE id IN (${ph})`).run(...ids);
    return ok(res, null, '已解绑');
  }
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '视频不存在');
  // R8：一道题在课程里只挂一个位置——绑到视频时从小分组上取下来
  db.prepare(`UPDATE questions SET video_id=?, chapter_id=?, section_id=NULL WHERE id IN (${ph})`).run(v.id, v.chapter_id, ...ids);
  ok(res, null, '已绑定到该知识点');
});

// ---------- R8：小分组习题（题目直接挂到课程目录下的小分组 sections 上） ----------
admin.get('/sections/:id/questions', (req, res) => {
  const sec = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  if (!sec) return fail(res, '小分组不存在');
  const ch = db.prepare('SELECT id, name, subject, grade, stage, term, category FROM chapters WHERE id=?').get(sec.chapter_id) || null;
  const rows = db.prepare('SELECT * FROM questions WHERE section_id=? ORDER BY id').all(sec.id).map(parseQ);
  const videoQ = Number((db.prepare(`SELECT COUNT(*) n FROM questions q JOIN videos v ON v.id=q.video_id
    WHERE v.chapter_id=? AND ${accuracy.SEC_EXPR}=?`).get(sec.chapter_id, sec.id) || {}).n || 0);
  ok(res, { section: sec, chapter: ch, list: rows, video_question_count: videoQ });
});
// 绑定 / 解绑题目到小分组（与视频绑定二选一：挂到小分组时清掉 video_id）
admin.post('/sections/:id/bind', (req, res) => {
  const b = req.body || {};
  const unbind = Number(b.unbind) === 1;
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, '请选择题目');
  const ph = ids.map(() => '?').join(',');
  const sec = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.params.id));
  if (unbind) {
    // 只解绑确实挂在这个小分组上的题（防止误把别处的题解掉）；没有绑视频的题顺带清掉 chapter_id
    if (!sec) return fail(res, '小分组不存在');
    const r = db.prepare(`UPDATE questions SET section_id=NULL, chapter_id=CASE WHEN video_id IS NULL THEN NULL ELSE chapter_id END
      WHERE section_id=? AND id IN (${ph})`).run(sec.id, ...ids);
    return ok(res, { count: r.changes || 0 }, '已解绑');
  }
  if (!sec) return fail(res, '小分组不存在');
  db.prepare(`UPDATE questions SET section_id=?, chapter_id=?, video_id=NULL WHERE id IN (${ph})`).run(sec.id, sec.chapter_id, ...ids);
  ok(res, { count: ids.length }, '已挂到该小分组');
});

// ---------- R8：视频关联知识点树节点（video_nodes，多选，整体替换） ----------
/** 课程目录 → 学段（同步类课程大多只填了年级） */
const chapterStage = (c) => {
  const s = String((c && c.stage) || '').trim();
  if (s === 'primary' || s === 'junior') return s;
  const g = String((c && c.grade) || '');
  if (['三年级', '四年级', '五年级', '六年级'].includes(g)) return 'primary';
  if (['七年级', '八年级', '九年级', '中考冲刺'].includes(g)) return 'junior';
  return '';
};
admin.get('/videos/:id/nodes', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '视频不存在');
  const ch = v.chapter_id ? db.prepare('SELECT * FROM chapters WHERE id=?').get(v.chapter_id) : null;
  const nodes = db.prepare(`SELECT n.id, n.name, n.tree_id FROM video_nodes vn JOIN bank_tree_nodes n ON n.id=vn.node_id
    WHERE vn.video_id=? ORDER BY n.sort, n.id`).all(v.id);
  const subject = (ch && ch.subject) || '';
  const stage = chapterStage(ch);
  // 候选树：知识点树里学科 + 学段对应的那棵排第一（前端默认选它）
  const trees = db.prepare("SELECT id, name, subject, stage FROM bank_trees WHERE kind='knowledge' ORDER BY sort, id").all()
    .sort((a, b) => ((b.subject === subject) * 2 + (b.stage === stage)) - ((a.subject === subject) * 2 + (a.stage === stage)));
  ok(res, { video: { id: v.id, title: v.title, chapter_id: v.chapter_id }, subject, stage, nodes, trees, tree_id: trees.length ? trees[0].id : 0 });
});
admin.post('/videos/:id/nodes', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '视频不存在');
  const want = [...new Set((Array.isArray((req.body || {}).node_ids) ? req.body.node_ids : []).map(Number).filter(Boolean))].slice(0, 30);
  const valid = want.length
    ? db.prepare(`SELECT id FROM bank_tree_nodes WHERE id IN (${want.map(() => '?').join(',')})`).all(...want).map((r) => r.id)
    : [];
  db.transaction(() => {
    db.prepare('DELETE FROM video_nodes WHERE video_id=?').run(v.id);
    const ins = db.prepare('INSERT INTO video_nodes (video_id, node_id) VALUES (?,?)');
    valid.forEach((nid) => ins.run(v.id, nid));
  })();
  ok(res, { count: valid.length }, valid.length ? `已关联 ${valid.length} 个知识点` : '已清空关联的知识点');
});

// ---------- 课文习题：Word 批量上传（题号.（题型）题干→选项→答案：→解析： 一键解析入库，插图自动提取） ----------
const upDocx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const store = require('./storage');
const bankImgFolder = () => {
  try {
    const r = db.prepare("SELECT v FROM settings WHERE k='bank_folder'").get();
    const v = String((r && r.v) || '').trim().replace(/^\/+|\/+$/g, '');
    if (v) return v;
  } catch (e) { /* settings 表还没建好 */ }
  return 'bank';
};
admin.post('/videos/:id/import-docx', upDocx.single('file'), async (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.params.id));
  if (!v) return fail(res, '知识点视频不存在');
  const ch = v.chapter_id ? db.prepare('SELECT * FROM chapters WHERE id=?').get(v.chapter_id) : null;
  const f = req.file;
  if (!f) return fail(res, '请选择 .docx 文件');
  if (!/\.docx$/i.test(f.originalname || '')) return fail(res, '只支持 .docx（老 .doc 请先用 Word 另存为 .docx）');
  let parsed, figs;
  try {
    const { parseDocx, parseDocxQuestions } = require('./docxtext');
    const d = await parseDocx(f.buffer, {
      saveImage: async (buf, name) => {
        try {
          const saved = await store.saveFile(buf, name, `${bankImgFolder()}/img`);
          return await store.getUrl(saved.key);
        } catch (e) { return ''; }   // 单图上传失败不影响整卷
      },
    });
    figs = d.figs || [];
    parsed = parseDocxQuestions(d.paras);
  } catch (e) {
    return fail(res, '文档解析失败：' + e.message);
  }
  if (!parsed.list.length) {
    return fail(res, '没认出题目。请确认文档格式：1.（单选题）题干 → A. 选项 → 答案：X → 解析：……（洋葱题库样例格式）');
  }
  const subject = (ch && ch.subject) || String((req.body || {}).subject || '').trim();
  const stage = (ch && ch.stage) || String((req.body || {}).stage || '').trim();
  const grade = (ch && ch.grade) || String((req.body || {}).grade || '').trim();
  const point = (ch && ch.name) || '';
  const source = 'Word批量上传';
  const ins = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (?,?,?,?,?,?,?,?,3,0,?,?, '', ?, '', ?, ?, ?)`);
  const ids = [];
  try {
    parsed.list.forEach((q) => {
      const imgs = q.imgRefs.map((n) => (figs[n - 1] || {}).url).filter(Boolean);
      const info = ins.run(
        v.chapter_id || null, subject, grade, q.type,
        String(q.stem).replace(/\s+/g, ' ').trim(),
        JSON.stringify(q.options.map((o) => ({ label: o.label, text: String(o.content).replace(/\s+/g, ' ').trim() }))),
        q.answer, q.analysis, stage, point, source, v.id, JSON.stringify(imgs), now());
      ids.push(info.lastInsertRowid);
    });
  } catch (e) { return fail(res, '入库失败：' + e.message); }
  ok(res, { added: ids.length, ids, images: figs.length, skipped: parsed.skipped },
    `已导入 ${ids.length} 题（插图 ${figs.length} 张）并绑定到本知识点`);
});

// ---------- 错题记录 ----------
// 校区下拉（总校用；分校账号返回空，前端不显示该筛选）
// ---------- 错题反馈记录：学生反馈的题目问题，逐条核对处理 ----------
admin.get('/feedback', (req, res) => {
  const q = req.query || {};
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(50, Math.max(1, Number(q.size) || 20));
  const where = []; const args = [];
  if (q.status) { where.push('f.status=?'); args.push(String(q.status)); } else { where.push("f.status<>'hidden'"); }
  if (q.subject) { where.push('q.subject=?'); args.push(String(q.subject)); }
  if (q.kw) {
    where.push('(q.stem LIKE ? OR u.name LIKE ? OR CAST(q.id AS CHAR) LIKE ? OR f.note LIKE ?)');
    const kw = `%${String(q.kw).trim()}%`;
    args.push(kw, kw, kw, kw);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number(db.prepare(`SELECT COUNT(*) n FROM bank_feedback f JOIN questions q ON q.id=f.question_id JOIN users u ON u.id=f.user_id ${w}`).get(...args).n) || 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, pages);
  const rows = db.prepare(`SELECT f.id, f.question_id, f.reason, f.note, f.my_answer, f.status, f.admin_note, f.created_at,
      q.stem, q.type, q.options, q.answer, q.analysis, q.subject, q.images, q.difficulty, q.point, q.material, q.stage, q.grade, q.source, q.year,
      u.name AS student_name, u.grade AS student_grade, u.username AS student_phone
    FROM bank_feedback f JOIN questions q ON q.id=f.question_id JOIN users u ON u.id=f.user_id
    ${w} ORDER BY f.id DESC LIMIT ? OFFSET ?`).all(...args, size, (p - 1) * size).map(parseQ);
  const stat = { pending: 0, done: 0, ignored: 0 };
  db.prepare("SELECT status, COUNT(*) n FROM bank_feedback GROUP BY status").all().forEach((r) => { stat[r.status] = Number(r.n) || 0; });
  return ok(res, { page: p, size, total, pages, stat, list: rows });
});

admin.put('/feedback/:id', (req, res) => {
  const id = Number(req.params.id) || 0;
  const b = req.body || {};
  const status = ['pending', 'done', 'ignored', 'hidden'].includes(b.status) ? b.status : '';
  if (!id || !status) return fail(res, '参数不正确');
  const note = String(b.admin_note || '').trim().slice(0, 300);
  db.prepare('UPDATE bank_feedback SET status=?, admin_note=? WHERE id=?').run(status, note, id);
  return ok(res, null, '已更新');
});

admin.get('/branches-options', (req, res) => {
  if (req.user.role !== 'admin') return ok(res, []);
  ok(res, db.prepare("SELECT id, name FROM users WHERE role='branch' ORDER BY id").all());
});

// 学生下拉（分校只见本校区学生；总校可按校区筛选）
admin.get('/students-options', (req, res) => {
  const { campus = '' } = req.query;
  let where = " WHERE role='student' AND status=1";
  const args = [];
  if (req.user.role === 'branch') { where += ' AND created_by=?'; args.push(req.user.id); }
  else if (campus) { where += ' AND created_by=?'; args.push(Number(campus)); }
  const rows = db.prepare(`SELECT id, name, username, grade, stage FROM users${where} ORDER BY id DESC`).all(...args);
  ok(res, rows);
});

// 错题记录列表（总校可按校区筛选，分校强制本校；按学生 / 学科 / 状态筛选）
admin.get('/mistakes', (req, res) => {
  const { student_id = '', subject = '', resolved = '', campus = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Math.max(1, Number(req.query.size) || 20));
  let where = ' WHERE 1=1'; const args = [];
  if (req.user.role === 'branch') { where += ' AND u.created_by=?'; args.push(req.user.id); }
  else if (campus) { where += ' AND u.created_by=?'; args.push(Number(campus)); }
  if (student_id) { where += ' AND m.user_id=?'; args.push(Number(student_id)); }
  if (subject) { where += ' AND q.subject=?'; args.push(subject); }
  if (resolved === '0') where += ' AND m.resolved=0';
  if (resolved === '1') where += ' AND m.resolved=1';
  const total = Number((db.prepare(`SELECT COUNT(*) n FROM mistakes m JOIN users u ON u.id=m.user_id JOIN questions q ON q.id=m.question_id${where}`).get(...args) || {}).n || 0);
  const rows = db.prepare(`SELECT m.id, m.user_id, m.question_id, m.wrong_count, m.last_answer, m.resolved, m.review_stage, m.next_review, m.updated_at,
      u.name AS student_name, u.username, u.grade,
      q.type, q.stem, q.options, q.answer, q.analysis, q.material, q.subject, q.point, q.difficulty, q.images
    FROM mistakes m JOIN users u ON u.id=m.user_id JOIN questions q ON q.id=m.question_id
    ${where} ORDER BY m.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size).map(parseQ);
  ok(res, { total, page, size, list: rows, is_admin: req.user.role === 'admin' });
});

// ---------- 纸质错题上传审核（学生扫码上传 → 老师核对 → 入库进题库 + 学生错题本） ----------
const UP_STATUS = ['pending', 'reviewed', 'approved', 'rejected'];
const parseUp = (row) => {
  if (!row) return row;
  let images = [];
  try { images = JSON.parse(row.images || '[]'); } catch (e) { images = []; }
  return { ...row, images: Array.isArray(images) ? images : [] };
};
/** 把一条上传记录入库成题目，并塞进该学生的错题本 */
function importUpload(row, reviewerId) {
  const stage = row.stage || stageOfGrade(row.student_stage, row.student_grade);
  const grade = row.grade || row.student_grade || '';
  let imgs = row.images;
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
  if (!Array.isArray(imgs)) imgs = [];
  const info = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (NULL,?,?, 'single', '（纸质错题，看图作答）', '[]', '', ?, 3, 0, ?, ?, '', '纸质上传', '', NULL, ?, ?)`)
    .run(row.subject, grade, String(row.review_note || ''), stage, row.point || '', JSON.stringify(imgs), now());
  const qid = info.lastInsertRowid;
  db.prepare(`INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review)
    SELECT ?,?,1,'',0,?,0,'' WHERE NOT EXISTS (SELECT 1 FROM mistakes WHERE user_id=? AND question_id=?)`)
    .run(row.user_id, qid, now(), row.user_id, qid);
  db.prepare(`UPDATE paper_uploads SET status='approved', question_id=?, reviewed_by=?, reviewed_at=? WHERE id=?`)
    .run(qid, reviewerId, now(), row.id);
  return qid;
}

/** 学生上传后自动建题：立即进题库（来源=学生上传，待老师审核）+ 立即进该学生错题本（免审核）；老师拒绝时再删除题目 */
function autoImportUpload(row) {
  const stage = stageOfGrade(row.stage, row.grade || row.student_grade);
  const grade = row.grade || row.student_grade || '';
  let imgs = row.images;
  if (typeof imgs === 'string') { try { imgs = JSON.parse(imgs); } catch (e) { imgs = []; } }
  if (!Array.isArray(imgs)) imgs = [];
  const stem = String(row.stem_text || '').trim() || '（纸质错题，看图作答）';
  const info = db.prepare(`INSERT INTO questions (chapter_id,subject,grade,type,stem,options,answer,analysis,difficulty,sort,stage,point,material,source,year,video_id,images,created_at)
    VALUES (NULL,?,?,'single',?,'[]',?,'',3,0,?,?,'','学生上传','',NULL,?,?)`)
    .run(row.subject, grade, stem, String(row.answer || '').trim(), stage, row.point || '', JSON.stringify(imgs), now());
  const qid = info.lastInsertRowid;
  db.prepare(`INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review)
    SELECT ?,?,1,'',0,?,0,'' WHERE NOT EXISTS (SELECT 1 FROM mistakes WHERE user_id=? AND question_id=?)`)
    .run(row.user_id, qid, now(), row.user_id, qid);
  return qid;
}

/** 老师拒绝上传：删除自动入库的题目 + 该学生错题本里的这道题（含做题记录） */
function removeUploadQuestion(questionId) {
  if (!questionId) return;
  db.prepare('DELETE FROM mistakes WHERE question_id=?').run(questionId);
  try { db.prepare('DELETE FROM records WHERE question_id=?').run(questionId); } catch (e) { /* 无记录忽略 */ }
  db.prepare('DELETE FROM questions WHERE id=?').run(questionId);
}

/** AI 识别手机扫码上传的错题（T9）：复用错题重组的 `analyzeWrongQuestion`（wrong.js 的 analyze 同款），
 * 识别学科 / 年级 / 知识点 / 题型 / 题干，自动分类后写回题目和上传记录；异步调用，失败静默。
 * 上传时没选学科（所以还没建题）的，识别出学科后补建题目并放进该学生错题本，同样进「待审核题目」。 */
const UP_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif' };
const UP_SUBJECTS = ['数学', '英语', '物理', '化学'];
async function aiRecognizeUpload(id) {
  const row = parseUp(db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(id));
  if (!row || !Array.isArray(row.images) || !row.images.length) return;
  const imgPath = path.join(__dirname, '..', 'public', String(row.images[0]).replace(/^\//, ''));
  if (!fs.existsSync(imgPath)) return;
  const aiLib = require('./ai');
  const cfg = aiLib.getConfig('vision');
  if (cfg.mock || !cfg.hasKey) return;
  const buf = fs.readFileSync(imgPath);
  const mime = UP_MIME[path.extname(imgPath).toLowerCase()] || 'image/jpeg';
  const hint = row.stem_text ? `学生补充说明：${row.stem_text}。请识别这道题。` : undefined;
  const { info } = await aiLib.analyzeWrongQuestion({ buf, mime, hint });
  const subj = UP_SUBJECTS.includes(String(info.subject || '')) ? info.subject : '';
  const grade = String(info.grade || '').trim().slice(0, 20);
  let point = String(info.knowledge || '').trim().slice(0, 50);
  if (/^(无|暂无|没|未|未知|无法|不能|不是)/.test(point)) point = '';   // AI 对非题目图片会硬凑，过滤垃圾值
  const stem = String(info.stem || '').trim().slice(0, 300);
  const qtype = String(info.type || '').trim().slice(0, 20);
  if (!subj && !point && !stem) return;
  const detail = qtype ? `AI识别题型：${qtype}` : '';
  if (row.question_id) {
    // 更新题目：补学科/年级/知识点；题干为占位文字时换成 AI 转录的题干
    const q = db.prepare('SELECT subject, grade, stem FROM questions WHERE id=?').get(row.question_id);
    if (q) {
      const newSubject = (q.subject && UP_SUBJECTS.includes(q.subject)) ? q.subject : (subj || '');
      const newGrade = q.grade || grade;
      const newStem = (String(q.stem || '').includes('看图作答') || !String(q.stem || '').trim()) ? (stem || q.stem) : q.stem;
      db.prepare('UPDATE questions SET subject=?, grade=?, point=?, stem=? WHERE id=?')
        .run(newSubject, newGrade, point || String(row.point || ''), newStem, row.question_id);
      if (detail) { try { db.prepare("UPDATE questions SET source_detail=? WHERE id=? AND IFNULL(source_detail,'')=''").run(detail, row.question_id); } catch (e) { /* 老库没有这一列 */ } }
    }
  }
  db.prepare("UPDATE paper_uploads SET subject=IF(?='',subject,?), grade=NULLIF(?,''), point=IF(?='',point,?) WHERE id=?")
    .run(subj, subj, grade, point, point, id);
  // 上传时没选学科 → 当时没建题；现在识别出学科了，补建题目 + 进错题本（于是也会出现在「待审核题目」里）
  if (!row.question_id && subj) {
    const fresh = parseUp(db.prepare(`SELECT p.*, u.grade AS student_grade, u.stage AS student_stage
      FROM paper_uploads p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(id));
    if (fresh && !fresh.question_id) {
      if (!String(fresh.stem_text || '').trim() && stem) fresh.stem_text = stem;
      const qid = autoImportUpload(fresh);
      db.prepare('UPDATE paper_uploads SET question_id=? WHERE id=?').run(qid, id);
      if (detail) { try { db.prepare('UPDATE questions SET source_detail=? WHERE id=?').run(detail, qid); } catch (e) { /* 老库没有这一列 */ } }
    }
  }
}

admin.get('/uploads', (req, res) => {
  const { status = '', subject = '', campus = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 30));
  let where = ' WHERE 1=1'; const args = [];
  if (req.user.role === 'branch') { where += ' AND u.created_by=?'; args.push(req.user.id); }
  else if (campus) { where += ' AND u.created_by=?'; args.push(Number(campus)); }
  if (status && UP_STATUS.includes(status)) { where += ' AND p.status=?'; args.push(status); }
  else if (!status) { where += ` AND p.status IN ('pending','reviewed')`; }   // 默认看待处理
  if (subject) { where += ' AND p.subject=?'; args.push(subject); }
  const total = Number((db.prepare(`SELECT COUNT(*) n FROM paper_uploads p JOIN users u ON u.id=p.user_id${where}`).get(...args) || {}).n || 0);
  const rows = db.prepare(`SELECT p.*, u.name AS student_name, u.grade AS student_grade, u.stage AS student_stage
    FROM paper_uploads p JOIN users u ON u.id=p.user_id${where}
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size).map(parseUp);
  const counts = { pending: 0, reviewed: 0, approved: 0, rejected: 0 };
  db.prepare(`SELECT status, COUNT(*) n FROM paper_uploads GROUP BY status`).all()
    .forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] = Number(r.n); });
  ok(res, { total, page, size, list: rows, counts });
});

/** 审核学生上传：approved=通过（归类同步到题目，学生端不受影响）；rejected=拒绝并删除学生端题目；reviewed=仅保存核对 */
admin.post('/uploads/:id/review', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(id);
  if (!row) return fail(res, '记录不存在');
  if (row.status === 'approved') return fail(res, '该题已审核通过，不能再修改');
  const b = req.body || {};
  const status = ['approved', 'rejected', 'reviewed'].includes(b.status) ? b.status : 'reviewed';
  if (status === 'rejected') {
    removeUploadQuestion(row.question_id);
    db.prepare("UPDATE paper_uploads SET status='rejected', review_note=?, reviewed_by=?, reviewed_at=?, question_id=0 WHERE id=?")
      .run(String(b.review_note || '').trim().slice(0, 500) || '题目质量不符合要求', req.user.id, now(), id);
    return ok(res, null, '已拒绝，并从该学生的错题本中删除这道题');
  }
  const subj = ['数学', '英语', '物理', '化学'].includes(String(b.subject || '')) ? b.subject : row.subject;
  const stage = ['primary', 'junior'].includes(String(b.stage || '')) ? b.stage : row.stage;
  const grade = String(b.grade || '').trim().slice(0, 20) || row.grade;
  const point = String(b.point || '').trim().slice(0, 100) || row.point;
  const note = String(b.review_note || '').trim().slice(0, 500);
  if (row.question_id) {
    db.prepare('UPDATE questions SET subject=?, stage=?, grade=?, point=? WHERE id=?')
      .run(subj, stage, grade, point, row.question_id);
    if (note) db.prepare('UPDATE questions SET analysis=? WHERE id=?').run(note, row.question_id);
  }
  db.prepare('UPDATE paper_uploads SET subject=?, stage=?, grade=?, point=?, review_note=?, status=?, reviewed_by=?, reviewed_at=? WHERE id=?')
    .run(subj, stage, grade, point, note, status, req.user.id, now(), id);
  ok(res, null, status === 'approved' ? '审核通过，归类已同步到题目' : '已保存核对结果');
});

/** 批量通过：全部待审核（题目已自动入库）的记录确认为审核通过 */
admin.post('/uploads/import-all', (req, res) => {
  const rows = db.prepare("SELECT id, subject FROM paper_uploads WHERE status IN ('pending','reviewed') AND question_id>0").all();
  let n = 0;
  for (const row of rows) {
    if (!['数学', '英语', '物理', '化学'].includes(String(row.subject || ''))) continue;
    db.prepare("UPDATE paper_uploads SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=?").run(req.user.id, now(), row.id);
    n++;
  }
  if (!n) return fail(res, '没有可批量通过的记录（学科未识别的需要先逐条核对）');
  ok(res, { count: n }, `已批量通过 ${n} 条（题目此前已进入对应学生的错题本）`);
});

admin.delete('/uploads/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM paper_uploads WHERE id=?').get(id);
  if (!row) return fail(res, '记录不存在');
  if (row.status === 'approved') return fail(res, '已入库的记录不能删除，请到题库管理里操作');
  removeUploadQuestion(row.question_id);   // 待审核的题已自动入库，删记录时一并删除题目和学生错题本里的这道题
  db.prepare('DELETE FROM paper_uploads WHERE id=?').run(id);
  ok(res, null, '已删除');
});

// ================================================================== 学生端
const stu = express.Router();
stu.use((req, res, next) => {
  if (!req.user || req.user.role !== 'student') return res.status(403).json({ code: 403, msg: '无权限' });
  // 账号已被删除的旧登录态：直接判失效，避免后续接口读 undefined 崩 500
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(req.user.id)) {
    return res.status(401).json({ code: 401, msg: '登录已失效，请重新登录' });
  }
  next();
});

const stageOfGrade = (stage, grade) => {
  const s = String(stage || '').trim().toLowerCase();
  if (s === 'primary' || s === 'junior') return s;
  const g = String(grade || '').trim();
  if (['三年级', '四年级', '五年级', '六年级'].includes(g)) return 'primary';
  if (['七年级', '八年级', '九年级', '中考冲刺'].includes(g)) return 'junior';
  return '';
};

// ---- 错题复习（艾宾浩斯简化版）：复习答对 1 次 → 2 天后再复习；连续 2 次 → 4 天后；连续 3 次 → 移出错题本（已掌握）。答错 → 回到第 1 轮，明天再来 ----
const REVIEW_STEPS = [2, 4];
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const addDays = (base, n) => {
  const d = new Date(String(base || todayStr()).replace(/-/g, '/') + 'T00:00:00');
  d.setDate(d.getDate() + Number(n) || 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/** 知识点（视频）的练习题（不含答案） */
stu.get('/lesson-questions', (req, res) => {
  const uid = req.user.id;
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(Number(req.query.video_id || 0));
  if (!v) return fail(res, '知识点不存在');
  // 越权校验：视频所属课程必须对该学生可见
  if (v.chapter_id) {
    const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(v.chapter_id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    if (!c) return fail(res, '课程不存在');
    const grade = String(u.grade || '').trim(); const term = String(u.term || '').trim();
    const stage = stageOfGrade(u.stage, grade);
    const cat = String(c.category || '');
    let visible;
    if (cat === '专项提升') visible = !!stage && String(c.stage || '') === stage;
    else if (cat === '中考冲刺') visible = stage === 'junior';
    else {
      visible = true;
      if (grade && String(c.grade || '') && String(c.grade) !== grade) visible = false;
      if (term && String(c.term || '') && String(c.term) !== term) visible = false;
    }
    if (!visible) return fail(res, '这门课不属于你的年级 / 学段');
  }
  const rows = db.prepare('SELECT * FROM questions WHERE video_id=? ORDER BY id LIMIT 50').all(v.id);
  ok(res, { title: v.title, list: rows.map(serveQ) });
});

/** R8：某课程目录对这个学生可见吗（同 lesson-questions 的口径） */
function stuSeesChapter(uid, chapterId) {
  if (!chapterId) return true;
  const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(Number(chapterId));
  if (!c) return false;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid) || {};
  const grade = String(u.grade || '').trim(); const term = String(u.term || '').trim();
  const stage = stageOfGrade(u.stage, grade);
  const cat = String(c.category || '');
  if (cat === '专项提升') return !!stage && String(c.stage || '') === stage;
  if (cat === '中考冲刺') return stage === 'junior';
  if (grade && String(c.grade || '') && String(c.grade) !== grade) return false;
  if (term && String(c.term || '') && String(c.term) !== term) return false;
  return true;
}
/** R8：小分组练习的题 = 小分组自己的题 + 组内视频的题（视频顺序在前，小分组自己的题在后） */
function sectionPracticeQs(sec) {
  return db.prepare(`SELECT q.* FROM questions q LEFT JOIN videos v ON v.id=q.video_id
    WHERE q.section_id=? OR (q.video_id IS NOT NULL AND v.chapter_id=? AND ${accuracy.SEC_EXPR}=?)
    ORDER BY CASE WHEN q.section_id=? THEN 1 ELSE 0 END, v.sort, v.id, q.id LIMIT 60`).all(sec.id, sec.chapter_id, sec.id, sec.id);
}
/** R8：小分组练习取题（不含答案） */
stu.get('/section-questions', (req, res) => {
  const sec = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(req.query.section_id || 0));
  if (!sec) return fail(res, '小分组不存在');
  if (!stuSeesChapter(req.user.id, sec.chapter_id)) return fail(res, '这门课不属于你的年级 / 学段');
  const rows = sectionPracticeQs(sec);
  ok(res, { title: sec.name, section_id: sec.id, list: rows.map(serveQ) });
});

/** R8：某个知识点（知识点树节点，含子孙节点）的掌握情况：
 *  题目范围 = 挂在该节点上的题（question_nodes）∪ 绑在「关联了该节点的视频」上的题（video_nodes，题目自动继承视频的知识点）
 *  只列出本人做过的题（最近一次对错）；course_id 给了就顺带返回本课程里讲这个知识点的视频 */
stu.get('/node-mastery', (req, res) => {
  const uid = req.user.id;
  const node = db.prepare('SELECT id, tree_id, parent_id, name FROM bank_tree_nodes WHERE id=?').get(Number(req.query.node_id || 0));
  if (!node) return fail(res, '知识点不存在');
  const all = db.prepare('SELECT id, parent_id FROM bank_tree_nodes WHERE tree_id=?').all(node.tree_id);
  const kids = {}; all.forEach((n) => { if (n.parent_id) (kids[n.parent_id] = kids[n.parent_id] || []).push(n.id); });
  const ids = []; const stack = [node.id]; const seen = new Set();
  while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); ids.push(x); (kids[x] || []).forEach((k) => stack.push(k)); }
  const ph = ids.map(() => '?').join(',');
  const qids = db.prepare(`SELECT DISTINCT q.id FROM questions q WHERE q.type<>'answer' AND (
      q.id IN (SELECT question_id FROM question_nodes WHERE node_id IN (${ph}))
      OR q.video_id IN (SELECT video_id FROM video_nodes WHERE node_id IN (${ph})))`).all(...ids, ...ids).map((r) => r.id);
  const last = accuracy.lastAnswers(db, uid, qids);
  const done = qids.filter((id) => last.has(id));
  const correct = done.filter((id) => last.get(id).is_correct).length;
  const list = done.length ? db.prepare(`SELECT id, type, stem FROM questions WHERE id IN (${done.map(() => '?').join(',')})`).all(...done)
    .map((q) => ({ id: q.id, type: q.type, stem: String(q.stem || '').replace(/\[图\d+\]/g, '').replace(/\s+/g, ' ').slice(0, 80), ...last.get(q.id) }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30) : [];
  let videos = [];
  const cid = Number(req.query.course_id || 0);
  if (cid && stuSeesChapter(uid, cid)) {
    videos = db.prepare(`SELECT DISTINCT v.id AS video_id, v.title, v.sort FROM videos v JOIN video_nodes vn ON vn.video_id=v.id
      WHERE v.chapter_id=? AND vn.node_id IN (${ph}) ORDER BY v.sort, v.id`).all(cid, ...ids).map((v) => ({ video_id: v.video_id, title: v.title }));
  }
  ok(res, { node: { id: node.id, name: node.name }, total: qids.length, answered: done.length, correct,
    rate: done.length ? Math.round(correct / done.length * 100) : null, list, videos });
});

// ---------- 我的试卷 ----------
// ---------- 我的任务：老师定向下发 + 全员下发的试卷 ----------
stu.get('/tasks', (req, res) => {
  const uid = req.user.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const grade = String(u.grade || '').trim();
  const term = String(u.term || '').trim();
  const stage = stageOfGrade(u.stage, grade);
  // 有下发名单的试卷只对名单里的学生可见（老师定向下发给谁，就只有谁能看到）；没有名单的才按年级/学段/册别广播
  const rows = db.prepare(`SELECT DISTINCT p.* FROM papers p
    WHERE p.status='published' AND (
      EXISTS (SELECT 1 FROM paper_assignments a WHERE a.paper_id=p.id AND a.user_id=?)
      OR (NOT EXISTS (SELECT 1 FROM paper_assignments a2 WHERE a2.paper_id=p.id)
        AND (IFNULL(p.grade,'')='' OR ?='' OR p.grade=?)
        AND (IFNULL(p.stage,'')='' OR ?='' OR p.stage=?)
        AND (IFNULL(p.term,'')='' OR ?='' OR p.term=?))
    ) ORDER BY p.published_at DESC, p.id DESC`)
    .all(uid, grade, grade, stage, stage, term, term);
  const qTries = db.prepare('SELECT total, correct, score, created_at FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1');
  ok(res, rows.map((p) => {
    const t = qTries.get(uid, p.id);
    return {
      id: p.id, title: p.title, subject: p.subject, stage: p.stage, grade: p.grade,
      duration: p.duration, total_score: p.total_score,
      q_count: parseIds(p.q_ids).length,
      published_at: p.published_at,
      assigned: !!db.prepare('SELECT 1 FROM paper_assignments WHERE paper_id=? AND user_id=?').get(p.id, uid),
      tried: !!t, last: t || null,
    };
  }));
});

stu.get('/papers', (req, res) => {
  const uid = req.user.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const grade = String(u.grade || '').trim();
  const term = String(u.term || '').trim();
  const stage = stageOfGrade(u.stage, grade);
  const rows = db.prepare(`SELECT p.* FROM papers p
    WHERE p.status='published'
      AND (EXISTS (SELECT 1 FROM paper_assignments a WHERE a.paper_id=p.id AND a.user_id=?)
        OR (NOT EXISTS (SELECT 1 FROM paper_assignments a2 WHERE a2.paper_id=p.id)
          AND (IFNULL(p.grade,'')='' OR ?='' OR p.grade=?)
          AND (IFNULL(p.stage,'')='' OR ?='' OR p.stage=?)
          AND (IFNULL(p.term,'')='' OR ?='' OR p.term=?)))
    ORDER BY p.published_at DESC, p.id DESC`)
    .all(uid, grade, grade, stage, stage, term, term);
  const qTries = db.prepare('SELECT total, correct, score, created_at FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1');
  ok(res, rows.map((p) => {
    const t = qTries.get(uid, p.id);
    return {
      id: p.id, title: p.title, subject: p.subject, grade: p.grade, stage: p.stage, term: p.term,
      duration: p.duration, total_score: p.total_score,
      q_count: parseIds(p.q_ids).length,
      published_at: p.published_at,
      tried: !!t, last: t || null,
    };
  }));
});

stu.get('/papers/:id', (req, res) => {
  const uid = req.user.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const p = db.prepare('SELECT * FROM papers WHERE id=?').get(Number(req.params.id));
  if (!p || p.status !== 'published') return fail(res, '试卷不存在或未下发');
  const assigned = !!db.prepare('SELECT 1 FROM paper_assignments WHERE paper_id=? AND user_id=?').get(p.id, uid);
  const grade = String(u.grade || '').trim(); const term = String(u.term || '').trim();
  const stage = stageOfGrade(u.stage, grade);
  if (!assigned && paperHasAssignees(p.id)) return fail(res, '这份试卷是老师定向下发给其他同学的');
  if (!assigned && ((p.grade && grade && p.grade !== grade) || (p.stage && stage && p.stage !== stage) || (p.term && term && p.term !== term))) {
    return fail(res, '这份试卷不属于你的年级 / 学段');
  }
  const ids = parseIds(p.q_ids);
  const questions = ids.map((id) => db.prepare('SELECT * FROM questions WHERE id=?').get(id)).filter(Boolean).map(serveQ);
  const last = db.prepare('SELECT total, correct, score, created_at FROM paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1').get(uid, p.id) || null;
  ok(res, {
    id: p.id, title: p.title, subject: p.subject, duration: p.duration, total_score: p.total_score,
    published_at: p.published_at, questions, last,
  });
});

// ---------- 交卷判分（kind = practice 知识点练习 / paper 试卷） ----------
stu.post('/submit', (req, res) => {
  const uid = req.user.id;
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const b = req.body || {};
  const kind = ['practice', 'section', 'paper', 'redo', 'review', 'mfpaper', 'self'].includes(b.kind) ? b.kind : 'practice';
  const answers = Array.isArray(b.answers) ? b.answers : [];
  if (!answers.length) return fail(res, '没有作答内容');
  const videoId = b.video_id ? Number(b.video_id) : 0;
  const paperId = b.paper_id ? Number(b.paper_id) : 0;
  if (kind === 'practice' && !videoId) return fail(res, '缺少知识点');
  if ((kind === 'paper' || kind === 'mfpaper') && !paperId) return fail(res, '缺少试卷');

  // 试卷校验：已下发且属于该学生（定向下发给本人的卷子不受年级过滤限制）
  let paper = null;
  let allowedIds = null;
  if (kind === 'paper') {
    paper = db.prepare('SELECT * FROM papers WHERE id=?').get(paperId);
    if (!paper || paper.status !== 'published') return fail(res, '试卷不存在或未下发');
    const assigned = !!db.prepare('SELECT 1 FROM paper_assignments WHERE paper_id=? AND user_id=?').get(paperId, uid);
    const grade = String(me.grade || '').trim(); const term = String(me.term || '').trim();
    const stage = stageOfGrade(me.stage, grade);
    if (!assigned && paperHasAssignees(paperId)) return fail(res, '这份试卷是老师定向下发给其他同学的');
    if (!assigned && ((paper.grade && grade && paper.grade !== grade) || (paper.stage && stage && paper.stage !== stage) || (paper.term && term && paper.term !== term))) {
      return fail(res, '这份试卷不属于你的年级 / 学段');
    }
    allowedIds = new Set(parseIds(paper.q_ids));
  }
  if (kind === 'mfpaper') {
    paper = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(paperId);
    if (!paper || !Number(paper.published)) return fail(res, '试卷不存在或未发布');
    allowedIds = new Set(db.prepare("SELECT question_id FROM mf_paper_questions WHERE paper_id=? AND kind='question'").all(paperId).map((r) => r.question_id));
  }

  // R8：小分组练习——题目必须是这个小分组自己的题或组内视频的题
  let section = null;
  if (kind === 'section') {
    section = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(b.section_id) || 0);
    if (!section) return fail(res, '缺少小分组');
    if (!stuSeesChapter(uid, section.chapter_id)) return fail(res, '这门课不属于你的年级 / 学段');
    allowedIds = new Set(sectionPracticeQs(section).map((q) => q.id));
  }
  // 知识点校验：视频所属课程对该学生可见
  let video = null;
  if (kind === 'practice') {
    video = db.prepare('SELECT * FROM videos WHERE id=?').get(videoId);
    if (!video) return fail(res, '知识点不存在');
    if (video.chapter_id) {
      const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(video.chapter_id);
      if (!c) return fail(res, '课程不存在');
      const grade = String(me.grade || '').trim(); const term = String(me.term || '').trim();
      const stage = stageOfGrade(me.stage, grade);
      const cat = String(c.category || '');
      let visible;
      if (cat === '专项提升') visible = !!stage && String(c.stage || '') === stage;
      else if (cat === '中考冲刺') visible = stage === 'junior';
      else {
        visible = true;
        if (grade && String(c.grade || '') && String(c.grade) !== grade) visible = false;
        if (term && String(c.term || '') && String(c.term) !== term) visible = false;
      }
      if (!visible) return fail(res, '这门课不属于你的年级 / 学段');
    }
  }

  const results = [];
  let correct = 0;
  const insRec = db.prepare('INSERT INTO records (user_id,question_id,chapter_id,my_answer,is_correct,created_at) VALUES (?,?,?,?,?,?)');
  const upMis = db.prepare(`INSERT INTO mistakes (user_id,question_id,wrong_count,last_answer,resolved,updated_at,review_stage,next_review) VALUES (?,?,1,?,0,?,0,?)
    ON CONFLICT(user_id,question_id) DO UPDATE SET wrong_count=wrong_count+1, last_answer=excluded.last_answer, resolved=0, review_stage=0, next_review=excluded.next_review, updated_at=excluded.updated_at`);
  const getQ = db.prepare('SELECT * FROM questions WHERE id=?');
  const misStage = new Map();   // question_id -> 当前复习轮次（review / redo 用）
  const detail = [];
  let paperScore = null, paperTotal = null;   // 试卷类交卷：得分 / 满分（回传给学生端显示）
  const tx = db.transaction(() => {
    for (const a of answers) {
      const q = getQ.get(Number(a.question_id));
      if (!q) continue;
      // 越权校验：练习题必须绑在指定知识点上；试卷题必须在卷面的题单里；错题重做 / 复习只能做错题本里有的题；自组卷（章节测评 / 学段冲刺）题目存在即可
      if (kind === 'practice') { if (Number(q.video_id) !== videoId) continue; }
      else if (kind === 'paper' || kind === 'mfpaper' || kind === 'section') { if (!allowedIds.has(q.id)) continue; }
      else if (kind === 'redo' || kind === 'review') {
        const m = db.prepare('SELECT id, review_stage FROM mistakes WHERE user_id=? AND question_id=?').get(uid, q.id);
        if (!m) continue;
        misStage.set(q.id, Number(m.review_stage) || 0);
      }
      if (q.type === 'answer') {
        // 问答题没法自动判分：不记对错、不进错题本、不进正确率，只回传参考答案让学生自己对照
        results.push({
          question_id: q.id, type: q.type, stem: q.stem, material: q.material || '',
          options: [], my_answer: String(a.my_answer || ''), answer: q.answer,
          analysis: q.analysis || '', difficulty: q.difficulty, is_correct: false, ungraded: true,
        });
        continue;
      }
      const isOk = judgeQ(q, a.my_answer);
      if (isOk) correct++;
      insRec.run(uid, q.id, q.chapter_id || 0, String(a.my_answer || ''), isOk ? 1 : 0, now());
      if (isOk) {
        if (kind === 'review') {
          // 复习：答对推进轮次，连续 3 次答对 = 已掌握（移出错题本）；答对间隔 2 / 4 天
          const stage = Math.min(3, (misStage.get(q.id) || 0) + 1);
          if (stage >= 3) {
            db.prepare('UPDATE mistakes SET resolved=1, review_stage=3, next_review=?, updated_at=? WHERE user_id=? AND question_id=?')
              .run(todayStr(), now(), uid, q.id);
          } else {
            db.prepare('UPDATE mistakes SET resolved=0, review_stage=?, next_review=?, updated_at=? WHERE user_id=? AND question_id=?')
              .run(stage, addDays(todayStr(), REVIEW_STEPS[stage - 1] || 2), now(), uid, q.id);
          }
        } else {
          // 练习 / 试卷 / 重做答对：直接掌握，移出错题本
          db.prepare('UPDATE mistakes SET resolved=1, review_stage=0, next_review=?, updated_at=? WHERE user_id=? AND question_id=? AND resolved=0')
            .run(todayStr(), now(), uid, q.id);
        }
      } else {
        // 答错：回到第 1 轮，明天再复习
        upMis.run(uid, q.id, String(a.my_answer || ''), now(), addDays(todayStr(), 1));
      }
      const o = parseQ(q);
      results.push({
        question_id: q.id, type: q.type, stem: q.stem, material: q.material || '',
        options: o.options, my_answer: String(a.my_answer || ''), answer: q.answer,
        analysis: q.analysis || '', difficulty: q.difficulty, is_correct: isOk, point: String(q.point || '').trim(),
      });
      detail.push({ question_id: q.id, my_answer: String(a.my_answer || ''), is_correct: isOk ? 1 : 0 });
    }
    if (kind === 'paper') {
      const total = detail.length;
      const score = paper.total_score && total ? Math.round(correct / total * paper.total_score) : 0;
      paperScore = score; paperTotal = Number(paper.total_score) || null;
      db.prepare('INSERT INTO paper_tries (user_id,paper_id,total,correct,score,detail,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uid, paperId, total, correct, score, JSON.stringify(detail), now());
    } else if (kind === 'mfpaper') {
      const scoreMap = {};
      db.prepare("SELECT question_id, score FROM mf_paper_questions WHERE paper_id=? AND kind='question'").all(paperId)
        .forEach((r) => { scoreMap[r.question_id] = num(r.score, 0); });
      const score = Math.round(detail.reduce((s, d) => s + (d.is_correct ? (scoreMap[d.question_id] || 0) : 0), 0));
      paperScore = score; paperTotal = Math.round(Object.values(scoreMap).reduce((s, v) => s + v, 0)) || null;
      db.prepare('INSERT INTO mf_paper_tries (user_id,paper_id,total,correct,score,detail,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uid, paperId, detail.length, correct, score, JSON.stringify(detail), now());
    } else {
      db.prepare('INSERT INTO practices (user_id,chapter_id,total,correct,duration,created_at) VALUES (?,?,?,?,?,?)')
        .run(uid, (video && video.chapter_id) || (section && section.chapter_id) || 0, detail.length, correct, Number(b.duration) || 0, now());
    }
  });
  tx();
  const wrong = detail.length - correct;
  // 本次各知识点的对错（学习报告用）：按题目的"知识点"文字归组，没标注的归"未标注知识点"
  const byPoint = new Map();
  results.filter((r) => !r.ungraded).forEach((r) => {
    const pt = String((db.prepare('SELECT point FROM questions WHERE id=?').get(r.question_id) || {}).point || '').trim() || '未标注知识点';
    const x = byPoint.get(pt) || { point: pt, total: 0, correct: 0 };
    x.total++; if (r.is_correct) x.correct++;
    byPoint.set(pt, x);
  });
  // 做的是某个视频的练习：回传该视频和所属小分组"现在"的正确率（学生端立即刷新）
  let mastery = null;
  if (kind === 'section' && section) {
    // R8：小分组练习交卷后回传该小分组现在的正确率（组内视频的题 + 小分组自己的题）
    const vids = accuracy.sectionVideoIds(db, section.chapter_id, section.id);
    const vs = accuracy.videoStats(db, uid, vids);
    const own = accuracy.ofVideo(accuracy.sectionOwnStats(db, uid, [section.id]), section.id);
    mastery = { video: null, section: { id: section.id, name: section.name, ...accuracy.sum(vids.map((id) => accuracy.ofVideo(vs, id)).concat([own])) } };
  }
  if (kind === 'practice' && video) {
    const sid = accuracy.sectionOfVideo(db, video.id);
    const secVids = sid ? accuracy.sectionVideoIds(db, video.chapter_id, sid) : [];
    const stats = accuracy.videoStats(db, uid, [video.id, ...secVids]);
    const sec = sid ? db.prepare('SELECT id, name FROM sections WHERE id=?').get(sid) : null;
    mastery = {
      video: { id: video.id, title: video.title, ...accuracy.ofVideo(stats, video.id) },
      section: sec ? { id: sec.id, name: sec.name, ...accuracy.sum(secVids.map((id) => accuracy.ofVideo(stats, id))
        .concat([accuracy.ofVideo(accuracy.sectionOwnStats(db, uid, [sec.id]), sec.id)])) } : null,   // R8：含小分组自己的题
    };
  }
  ok(res, { total: detail.length, correct, wrong, list: results, by_point: [...byPoint.values()], mastery, score: paperScore, score_total: paperTotal },
    kind === 'paper' ? `交卷成功：答对 ${correct} / ${detail.length}` : `本次共 ${detail.length} 题，答对 ${correct} 题`);
});

// ---------- 试卷库：试卷管理里「发布」的 mf 试卷 ----------
// 搜索（T10）：q = 名称关键字（同时匹配年份）；subject / grade / year 精确筛选；都不传 = 全部。
const MFP_OPEN = "p.published=1 AND p.status NOT IN ('basket','trashed')";
stu.get('/mfpapers', (req, res) => {
  const uid = req.user.id;
  const qy = req.query || {};
  let where = ` WHERE ${MFP_OPEN}`; const args = [];
  const kw = String(qy.q || '').trim().slice(0, 60);
  if (kw) { where += " AND (p.title LIKE ? OR IFNULL(p.year,'')=? OR p.subject LIKE ? OR p.grade LIKE ?)"; args.push(`%${kw}%`, kw, `%${kw}%`, `%${kw}%`); }
  if (qy.subject) { where += ' AND p.subject=?'; args.push(String(qy.subject)); }
  if (qy.grade) { where += ' AND p.grade=?'; args.push(String(qy.grade)); }
  if (qy.year) { where += " AND IFNULL(p.year,'')=?"; args.push(String(qy.year)); }
  const size = Math.min(200, Math.max(1, Number(qy.size) || 200));
  const rows = db.prepare(`SELECT p.id, p.title, p.subject, p.stage, p.grade, p.year, p.created_at,
    (SELECT COUNT(*) FROM mf_paper_questions r WHERE r.paper_id=p.id AND r.kind='question') AS q_count
    FROM mf_papers p${where} ORDER BY IFNULL(p.year,'') DESC, p.id DESC LIMIT ${size}`).all(...args);
  const qT = db.prepare('SELECT total, correct, score, created_at FROM mf_paper_tries WHERE user_id=? AND paper_id=? ORDER BY id DESC LIMIT 1');
  ok(res, rows.map((p) => { const t = qT.get(uid, p.id); return { ...p, tried: !!t, last: t || null }; }));
});

// 搜索下拉选项：试卷库里实际有的学科 / 年级 / 年份
stu.get('/mfpapers/filters', (req, res) => {
  const col = (c) => db.prepare(`SELECT DISTINCT p.${c} AS v FROM mf_papers p WHERE ${MFP_OPEN} AND IFNULL(p.${c},'')<>'' ORDER BY p.${c} DESC`).all().map((r) => r.v);
  ok(res, { subjects: col('subject'), grades: col('grade'), years: col('year') });
});

stu.get('/mfpapers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM mf_papers WHERE id=?').get(Number(req.params.id));
  if (!p || !Number(p.published)) return fail(res, '试卷不存在或未发布');
  const qs = db.prepare(`SELECT q.* FROM mf_paper_questions r JOIN questions q ON q.id=r.question_id
    WHERE r.paper_id=? AND r.kind='question' ORDER BY r.position, r.id`).all(p.id);
  const total = db.prepare("SELECT COALESCE(SUM(score),0) AS s FROM mf_paper_questions WHERE paper_id=? AND kind='question'").get(p.id).s;
  ok(res, { id: p.id, title: p.title, subject: p.subject, stage: p.stage, grade: p.grade, year: p.year || '', total_score: Math.round(Number(total) || 0), questions: qs.map(serveQ) });
});

// ---------- 章节组卷 / 知识点组卷（学生自己组卷，不能下发）：取同学段的章节树 / 知识点树 ----------
stu.get('/scan-tree', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const stage = stageOfGrade(me.stage, String(me.grade || ''));
  const kind = req.query.kind === 'knowledge' ? 'knowledge' : 'textbook';
  const subject = String(req.query.subject || '').trim();
  if (!subject) return fail(res, '请选择学科');
  // R2：同 学段+学科 可能有多个教材版本——按学生学段 + 默认版本表选一棵（可选 ?edition= 指定）；本学段没有时退回不分学段的树
  const tree = pickTree(db, { kind, subject, stage, edition: String(req.query.edition || '').trim() })
    || pickTree(db, { kind, subject, stage: '', edition: String(req.query.edition || '').trim() });
  if (!tree) return ok(res, { nodes: [], tree_id: 0, tree_name: '', edition: '' });
  const nodes = db.prepare('SELECT id, tree_id, parent_id, name, sort FROM bank_tree_nodes WHERE tree_id=? ORDER BY sort, id').all(tree.id);
  ok(res, { nodes, tree_id: tree.id, tree_name: tree.name, edition: tree.edition || '' });
});

// 雷达扫描组卷：选中单元 / 知识点 → 每个最小「小知识点」1 题 + 可用题数
stu.post('/scan-compose', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const stage = stageOfGrade(me.stage, String(me.grade || ''));
  const b = req.body || {};
  const kind = b.kind === 'knowledge' ? 'knowledge' : 'textbook';
  const subject = String(b.subject || '').trim();
  const ids = [...new Set((Array.isArray(b.node_ids) ? b.node_ids : []).map(Number).filter(Boolean))];
  if (!subject) return fail(res, '请选择学科');
  if (!ids.length) return fail(res, '请先选择单元或知识点');
  // R2：节点属于哪棵树就在哪棵树里找（学生选的就是 scan-tree 给的那棵），再校验这棵树是同学科、同种类、本学段（或不分学段）的
  const ph0 = ids.map(() => '?').join(',');
  const treeIds = db.prepare(`SELECT DISTINCT n.tree_id AS id FROM bank_tree_nodes n JOIN bank_trees t ON t.id=n.tree_id
    WHERE n.id IN (${ph0}) AND t.kind=? AND t.subject=? AND (t.stage=? OR IFNULL(t.stage,'')='')`).all(...ids, kind, subject, stage).map((r) => r.id);
  if (!treeIds.length) {
    const any = pickTree(db, { kind, subject, stage }) || pickTree(db, { kind, subject, stage: '' });
    return fail(res, any ? '选中的节点不属于该学科的树，请重新选择' : (kind === 'knowledge' ? '该学科还没有知识点分类树' : '该学科还没有章节树'));
  }
  const ph = treeIds.map(() => '?').join(',');
  const allNodes = db.prepare(`SELECT id, tree_id, parent_id, name FROM bank_tree_nodes WHERE tree_id IN (${ph})`).all(...treeIds);
  // 每个"最小的有题节点"抽 1 题（共用 compose.js）
  const items = compose.pickPerNode(db, allNodes, ids).map((it) => ({ node_id: it.node_id, node_name: it.node_name, count: it.count, question: { ...serveQ(it.row), point: it.node_name } }));
  if (!items.length) return fail(res, '选中的范围里还没有题目，先去题库管理补题或换个范围');
  ok(res, { items, total: items.length });
});

// ---------- 错题本（学生端，按学科） ----------
stu.get('/mistakes', (req, res) => {
  const uid = req.user.id;
  const { subject = '', resolved = '' } = req.query;
  let where = ' WHERE m.user_id=?'; const args = [uid];
  if (subject) { where += ' AND q.subject=?'; args.push(subject); }
  if (resolved === '0') where += ' AND m.resolved=0';
  if (resolved === '1') where += ' AND m.resolved=1';
  const rows = db.prepare(`SELECT m.id, m.question_id, m.wrong_count, m.last_answer, m.resolved, m.review_stage, m.next_review, m.updated_at, m.ai_point,
      q.type, q.stem, q.options, q.answer, q.analysis, q.material, q.subject, q.point, q.difficulty, q.images, q.audio_key
    FROM mistakes m JOIN questions q ON q.id=m.question_id${where}
    ORDER BY m.resolved, m.updated_at DESC LIMIT 300`).all(...args).map(parseQ)
    .map((r) => Object.assign(r, { audio_url: r.audio_key ? store.getUrlSync(r.audio_key) : '' }));
  const counts = {};
  db.prepare(`SELECT q.subject AS s, COUNT(*) n FROM mistakes m JOIN questions q ON q.id=m.question_id
    WHERE m.user_id=? GROUP BY q.subject`).all(uid).forEach((r) => { counts[r.s || '其他'] = r.n; });
  const one = (sql, ...a) => Number((db.prepare(sql).get(...a) || {}).n || 0);
  const review = {
    due: one(`SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=0 AND (IFNULL(next_review,'')='' OR next_review<=?)`, uid, todayStr()),
    total: one('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=0', uid),
    mastered: one('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=1', uid),
  };
  ok(res, { list: rows, counts, review });
});

// 顶栏角标：未掌握错题数（轻量）
stu.get('/mistake-count', (req, res) => {
  const n = Number((db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id=? AND resolved=0').get(req.user.id) || {}).n || 0);
  ok(res, { pending: n });
});

// ---------- 薄弱知识点：AI 自动识别每道错题的知识点，并按知识点归类 ----------
// 识别结果存在 mistakes.ai_point（错题维度），只识别一次，之后直接复用
stu.get('/mistake-points', async (req, res) => {
  const uid = req.user.id;
  const subject = String(req.query.subject || '数学');
  const loadRows = () => db.prepare(`SELECT m.question_id, m.ai_point, q.point, q.stem, q.type, q.options
    FROM mistakes m JOIN questions q ON q.id=m.question_id
    WHERE m.user_id=? AND m.resolved=0 AND q.subject=?
    ORDER BY m.updated_at DESC LIMIT 80`).all(uid, subject);
  let rows = loadRows();
  let aiUsed = false, aiFail = false;
  const need = rows.filter((r) => !String(r.point || '').trim() && !String(r.ai_point || '').trim());
  if (need.length) {
    try {
      const { chat } = require('./ai');
      const sys = '你是资深的 K12 教研标注员，擅长把错题归入它考查的知识点。只输出 JSON 本身，不要 markdown 代码块、不要任何解释。';
      // 每批 12 题，最多处理 48 题，避免单次请求过慢
      for (let i = 0; i < Math.min(need.length, 48); i += 12) {
        const batch = need.slice(i, i + 12);
        const listText = batch.map((r, idx) => {
          const opts = Array.isArray(r.options) ? r.options.filter(Boolean).join('；') : '';
          return `${idx + 1}. 【${TYPE_NAMES[r.type] || '题目'}】${String(r.stem || '').replace(/\s+/g, ' ').slice(0, 160)}${opts ? '（选项：' + opts.slice(0, 80) + '）' : ''}`;
        }).join('\n');
        const user = `下面是 ${batch.length} 道「${subject}」错题（含学生的错误作答背景）。请给每道题标注它考查的核心知识点：用 4~12 个字的通用知识点名（如「一元一次方程」「分数乘法」「现在完成时」「欧姆定律」），同类的题用同一个名称，便于归类。按题号输出 JSON，格式：{"1":"知识点","2":"知识点",...}\n\n${listText}`;
        const { text } = await chat({ system: sys, user, maxTokens: 900, temperature: 0.1 });
        const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
        const body = fence ? fence[1] : String(text || '');
        const a = body.indexOf('{'), bb = body.lastIndexOf('}');
        let j = {};
        if (a >= 0 && bb > a) { try { j = JSON.parse(body.slice(a, bb + 1)) || {}; } catch (e) { j = {}; } }
        const upd = db.prepare('UPDATE mistakes SET ai_point=? WHERE user_id=? AND question_id=?');
        batch.forEach((r, idx) => {
          const p = String(j[String(idx + 1)] || j[idx + 1] || '').trim().slice(0, 30);
          if (p) upd.run(p, uid, r.question_id);
        });
      }
      aiUsed = true;
      rows = loadRows();
    } catch (e) { aiFail = true; }
  }
  // 分组：题库知识点优先，其次 AI 识别
  const groups = {};
  let ungrouped = 0;
  rows.forEach((r) => {
    const p = String(r.point || '').split(/&&|,|，/)[0].trim() || String(r.ai_point || '').trim();
    if (!p) { ungrouped++; return; }
    (groups[p] = groups[p] || []).push(r.question_id);
  });
  const list = Object.keys(groups).map((p) => ({ point: p, count: groups[p].length, ids: groups[p] }))
    .sort((x, y) => y.count - x.count);
  ok(res, { groups: list, ungrouped, ai_used: aiUsed, ai_fail: aiFail });
});

// ---------- 错题复习：今日到期队列 ----------
stu.get('/review-queue', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`SELECT m.review_stage, q.*
    FROM mistakes m JOIN questions q ON q.id=m.question_id
    WHERE m.user_id=? AND m.resolved=0 AND (IFNULL(m.next_review,'')='' OR m.next_review<=?)
    ORDER BY m.next_review, m.updated_at DESC LIMIT 50`).all(uid, todayStr());
  ok(res, { list: rows.map((r) => Object.assign(serveQ(r), { review_stage: Number(r.review_stage) || 0 })) });
});

// ---------- 逐题核对（做练习模式：做一题核对一题，不落库；最后统一 submit 入库/错题本） ----------
stu.post('/check', (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 50) : [];
  if (!items.length) return fail(res, '没有要核对的内容');
  const out = items.map((a) => {
    const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(a.question_id) || 0);
    if (!q) return { question_id: a.question_id, is_correct: false, answer: '', analysis: '', missing: true };
    if (q.type === 'answer') return { question_id: q.id, is_correct: false, ungraded: true, answer: q.answer, analysis: q.analysis || '' };
    const isOk = judgeQ(q, a.my_answer);
    const out1 = { question_id: q.id, is_correct: isOk, answer: q.answer, analysis: q.analysis || '' };
    if (q.type === 'fill') {
      // R8：填空逐空对错（学生端逐空打 ✓ / ✗）：把每一空单独当成一道单空题判
      const PH = '\u0001';
      const ans = String(q.answer || '').replace(/\|\|\|/g, PH).split('|');
      const mine = String(a.my_answer || '').split('|');
      out1.blanks = ans.map((x, i) => judgeQ({ type: 'fill', answer: x.split(PH).join('|||') }, mine[i] || ''));
    }
    return out1;
  });
  ok(res, { list: out });
});

// ---------- 题目反馈：学生做完题觉得题有问题，反馈给管理端「错题反馈记录」 ----------
stu.post('/feedback', (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  const qid = Number(b.question_id) || 0;
  const reason = String(b.reason || '').trim().slice(0, 40);
  const note = String(b.note || '').trim().slice(0, 500);
  if (!qid) return fail(res, '缺少题目');
  const q = db.prepare('SELECT id FROM questions WHERE id=?').get(qid);
  if (!q) return fail(res, '题目不存在');
  db.prepare(`INSERT INTO bank_feedback (user_id, question_id, reason, note, my_answer, status, created_at)
    VALUES (?,?,?,?,?, 'pending', ?)`).run(uid, qid, reason || '其他', note, String(b.my_answer || '').slice(0, 2000), now());
  return ok(res, null, '反馈已提交，老师会尽快核对');
});

// ---------- AI 讲解：苏格拉底式分步引导（不直接给答案） ----------
stu.post('/ai-explain', async (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  const qid = Number(b.question_id) || 0;
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(qid);
  if (!q) return fail(res, '题目不存在');
  const o = parseQ(q);
  const myAns = String(b.my_answer || '').slice(0, 500);
  const optText = o.options.length ? o.options.map((t, i) => `${LETTERS[i]}. ${t}`).join('\n') : '';
  const sys = '你是一位耐心的中小学辅导老师，用苏格拉底式启发法讲解题目：不直接告诉学生最终答案，而是把解题过程拆成 3~5 个引导步骤，每一步先提一个让学生思考的问题，再给出该步骤的提示或过渡讲解。语言简洁、口语化、适合小学生/初中生。只输出 JSON，不要 markdown 代码块。';
  const user = `题目（${TYPE_NAMES[q.type] || '题目'}）：
${q.stem}${optText ? '\n选项：\n' + optText : ''}
学生的答案：${myAns || '（未作答）'}
正确答案：${q.answer}
${q.analysis ? '参考解析：' + q.analysis : ''}

请按上述要求输出 JSON：{"steps":[{"ask":"引导提问（一句话）","hint":"该步骤的提示讲解（2~3 句）"}],"conclusion":"最后总结这道题的关键思路（此时可以点明正确答案的道理）"}
步骤 3~5 个，第一步从学生已知的条件出发，逐步推进到答案，不要一步跳到结论。`;
  try {
    const { chat } = require('./ai');
    const { text } = await chat({ system: sys, user, maxTokens: 1600, temperature: 0.4 });
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
    const body = fence ? fence[1] : String(text || '');
    const a = body.indexOf('{'), z = body.lastIndexOf('}');
    let j = null;
    if (a >= 0 && z > a) { try { j = JSON.parse(body.slice(a, z + 1)); } catch (e) { j = null; } }
    if (!j || !Array.isArray(j.steps) || !j.steps.length) throw new Error('AI 返回格式异常');
    return ok(res, {
      steps: j.steps.slice(0, 6).map((s, i) => ({ ask: String(s.ask || '').slice(0, 300), hint: String(s.hint || '').slice(0, 800), no: i + 1 })),
      conclusion: String(j.conclusion || '').slice(0, 800),
    });
  } catch (e) {
    return fail(res, 'AI 讲解暂时不可用：' + (e.message || '请稍后再试'));
  }
});

// ---------- R8：AI 老师浮层（流式讲解，SSE） ----------
/* POST /api/stu/bank/ai-explain/stream  body: { question_id, my_answer, mode: 'explain' | 'guide', history: [{role,content}], ask }
 * 返回 text/event-stream：data: {"t":"delta","text":"…"} … data: {"t":"done","model":"…"}；出错 data: {"t":"error","msg":"…"}
 * explain：按「知识点 / 思路 / 步骤 / 易错点」分段的完整讲解；guide：苏格拉底式一步步引导（一次只问一个问题，学生可在输入框回答）
 * 多轮：history 是前端保存的之前的对话，题目信息每次都放在 system 里，所以追问不会丢上下文。
 * AI_MOCK=1：不调外部接口，按题目内容拼一段示例讲解，逐字分块推送（CI / 截图用）。 */
const AI_EXPLAIN_SYS = '你是一位耐心、讲解清楚的中小学老师。学生刚做完下面这道题，请针对这道题讲解。\n'
  + '严格用 Markdown 按以下四个三级标题输出，标题文字不要改：\n### 知识点\n（这道题考的知识点，1~2 句）\n### 思路\n（怎么想到解法，2~3 句）\n### 步骤\n（用 1. 2. 3. 有序列表写出完整解题步骤）\n### 易错点\n（结合学生的答案指出容易错在哪里，1~3 条无序列表）\n'
  + '数学公式一律用 \\( … \\) 包住的 LaTeX。语言口语化、适合中小学生，总字数 600 字以内。不要输出 JSON 或代码块，不要用表情符号。\n'
  + '学生之后的追问（例如“再讲细一点”“出一道同类题”或自己提的问题）：直接针对问题回答，不必再套上面四个标题，300 字以内。';
const AI_GUIDE_SYS = '你是一位耐心的中小学老师，用苏格拉底式启发法一步步引导学生自己做出这道题：\n'
  + '1. 每次回复只推进一步：先用一两句肯定或纠正学生上一条回答，再提出一个具体的小问题让学生思考，然后停下来等学生回答；\n'
  + '2. 不要一次讲完，也不要直接说出最终答案，除非学生已经答对、或者连续两次说不会；\n'
  + '3. 学生答对最后一步后，用 3 句以内总结关键思路；\n'
  + '4. 每次回复 150 字以内，数学公式用 \\( … \\) 包住的 LaTeX，不要输出代码块，不要用表情符号。';
function aiQuestionBrief(q, myAns) {
  const o = parseQ(q);
  const opts = o.options.length ? o.options.map((t, i) => `${LETTERS[i]}. ${t}`).join('\n') : '';
  return `【题目】（${TYPE_NAMES[q.type] || '题目'}${q.point ? '，知识点：' + q.point : ''}）\n${String(q.stem || '').replace(/\[图\d+\]/g, '（见图）')}`
    + (q.material ? `\n【材料】${String(q.material).slice(0, 1500)}` : '')
    + (opts ? `\n【选项】\n${opts}` : '')
    + `\n【学生的答案】${myAns || '（未作答）'}\n【正确答案】${q.answer || '（无）'}`
    + (q.analysis ? `\n【参考解析】${q.analysis}` : '');
}
/** AI_MOCK 下的示例回复（不调外部接口） */
function aiMockReply(q, mode, ask, turn, myAns) {
  const pt = String(q.point || '').trim() || '本题知识点';
  const ana = String(q.analysis || '').trim() || '先读懂题意，找出已知条件和要求的量，再一步步推出结果。';
  const ansTxt = String(q.answer || '').replace(/\|\|\|/g, ' 或 ').replace(/\|/g, '，');
  if (mode === 'guide') {
    if (!turn) return `我们一起来想一想，不着急看答案。\n\n**第 1 步：** 这道题考的是「${pt}」。先读题，题目里告诉了我们哪些条件？要求的又是什么？\n\n把你的想法写在下面的输入框里告诉我。`;
    if (/不会|不知道|不懂/.test(ask)) return `没关系，给你一个提示：${ana.slice(0, 60)}\n\n**第 ${turn + 1} 步：** 顺着这个提示，下一步你会怎么算？`;
    return `嗯，你的想法有道理！\n\n**第 ${turn + 1} 步：** 现在请你把条件代进去算一算，结果是多少？算完和选项（或空格）对照一下。`;
  }
  if (/同类|考考|举一反三/.test(ask)) {
    return `### 同类题\n\n这道题和刚才一样考「${pt}」：\n\n> 数轴上点 M 表示 \\(-4\\)，点 N 表示 \\(2\\)，那么 M、N 两点之间的距离是多少？\n\n先自己算一算，写在下面的输入框里，我来帮你批改。\n\n**提示：** 两点间距离 = 右边的数 \\(-\\) 左边的数。`;
  }
  if (/细|详细/.test(ask)) {
    return `### 再讲细一点\n\n我们把关键的那一步拆开看：\n\n1. 先确定题目问的是什么：${String(q.stem || '').replace(/\[图\d+\]/g, '').slice(0, 40)}……\n2. 回忆「${pt}」的定义，把题目条件对应上；\n3. ${ana}\n4. 最后检查：结果是否符合常识（比如距离不能是负数）。\n\n所以正确答案是 **${ansTxt}**。`;
  }
  if (turn) return `你问的是：「${String(ask).slice(0, 40)}」。\n\n结合这道题来说：${ana}\n\n记住「${pt}」的关键点，下次遇到类似的题就不容易错了。`;
  return `### 知识点\n\n这道题考的是 **${pt}**。\n\n### 思路\n\n先弄清题目给了什么、要求什么，再用「${pt}」的方法把条件联系起来。\n\n### 步骤\n\n1. 读题，圈出关键条件；\n2. ${ana}\n3. 得出答案：**${ansTxt}**。\n\n### 易错点\n\n- 你的答案是「${myAns || '未作答'}」，和正确答案不一样的地方要特别注意；\n- 符号（正负号）最容易看错，算完要再检查一遍；\n- 公式示例：\\(|a| \\ge 0\\)，任何数的绝对值都不是负数。`;
}
stu.post('/ai-explain/stream', async (req, res) => {
  const b = req.body || {};
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(b.question_id) || 0);
  if (!q) return fail(res, '题目不存在');
  const mode = b.mode === 'guide' ? 'guide' : 'explain';
  const myAns = String(b.my_answer || '').slice(0, 500);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-12)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '').slice(0, 3000) }))
    .filter((m) => m.content);
  const ask = String(b.ask || '').trim().slice(0, 500) || (mode === 'guide' ? '请一步步引导我做这道题。' : '请讲解这道题。');
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // nginx 反代时不要缓冲，否则看不到逐字输出
  if (res.flushHeaders) res.flushHeaders();
  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  const ac = new AbortController();
  let closed = false;
  res.on('close', () => { closed = true; ac.abort(); });
  const t0 = Date.now();
  send({ t: 'start', mode });
  try {
    const { getConfig } = require('./ai');
    if (getConfig().mock) {
      const text = aiMockReply(q, mode, ask, history.filter((m) => m.role === 'assistant').length, myAns);
      for (let i = 0; i < text.length && !closed; i += 2) {
        send({ t: 'delta', text: text.slice(i, i + 2) });
        await new Promise((r) => setTimeout(r, 28));
      }
      send({ t: 'done', model: 'mock（演示模式）', ms: Date.now() - t0 });
      return res.end();
    }
    const system = (mode === 'guide' ? AI_GUIDE_SYS : AI_EXPLAIN_SYS) + '\n\n' + aiQuestionBrief(q, myAns);
    let first = 0;
    const r = await require('./ai-client').chatStream({ role: 'reasoning', system, messages: history.concat([{ role: 'user', content: ask }]), maxTokens: 1600, temperature: 0.4 },
      (piece) => { if (!first) first = Date.now() - t0; send({ t: 'delta', text: piece }); }, { signal: ac.signal });
    send({ t: 'done', model: r.model, first_ms: first, ms: Date.now() - t0, streamed: r.streamed });
    console.log(`[ai-stream] q=${q.id} mode=${mode} model=${r.model} streamed=${r.streamed} first=${first}ms total=${Date.now() - t0}ms len=${r.text.length}`);
  } catch (e) {
    if (!closed) send({ t: 'error', msg: 'AI 老师暂时没有回应：' + ((e && e.message) || '请稍后再试') });
    console.log('[ai-stream] error', (e && e.message) || e);
  }
  res.end();
});

// ---------- 纸质错题上传（学生端） ----------
// 活码：签发 10 年长期 token，二维码打印/保存后长期有效（绑定学生，泄了可在管理端重置密钥使其失效）
stu.post('/upload-token', (req, res) => {
  ok(res, { token: upSign({ uid: req.user.id }, '3650d'), url: '/upload.html', longlived: true });
});
stu.get('/uploads', (req, res) => {
  const rows = db.prepare('SELECT * FROM paper_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id).map(parseUp);
  ok(res, { list: rows });
});

// ================================================================== 微信扫码上传（开放接口，短时 token 鉴权）
const up = express.Router();
const UP_IMG_MB = 10;
const upUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UP_IMG_MB * 1024 * 1024, files: 4 } });
const UP_DIR = path.join(__dirname, '..', 'public', 'pu');
if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });
let UP_SECRET_CACHE = '';
const upSecret = () => {
  if (!UP_SECRET_CACHE) UP_SECRET_CACHE = fs.readFileSync(path.join(DATA_DIR, '.secret'), 'utf8').trim();
  return UP_SECRET_CACHE;
};
const upSign = (payload, expires) => jwt.sign({ role: 'up', ...payload }, upSecret(), { expiresIn: expires || '4h' });
const upAuth = (req, res, next) => {
  try {
    const p = jwt.verify(String(req.query.token || req.query.t || ''), upSecret());
    if (p.role !== 'up' || !p.uid) throw new Error('bad token');
    req.upUid = Number(p.uid);
    next();
  } catch (e) { res.status(401).json({ code: 401, msg: '二维码已过期，请回到错题本重新获取' }); }
};
const okUp = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });

up.get('/info', upAuth, (req, res) => {
  const u = db.prepare('SELECT name, grade, stage FROM users WHERE id=?').get(req.upUid);
  if (!u) return res.status(404).json({ code: 404, msg: '学生不存在' });
  okUp(res, { name: u.name || u.username || '同学', grade: u.grade || '' });
});

up.post('/submit', upAuth, upUpload.array('images', 4), (req, res) => {
  const files = (req.files || []).filter((f) => /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(f.mimetype));
  if (!files.length) return fail(res, '请先拍照或选择图片（JPG/PNG，单张不超过 10MB）');
  const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' };
  const saved = [];
  for (const f of files) {
    const name = crypto.randomBytes(10).toString('hex') + EXT[f.mimetype];
    fs.writeFileSync(path.join(UP_DIR, name), f.buffer);
    saved.push('/pu/' + name);
  }
  const b = req.body || {};
  const ERR_TYPES = ['题型生疏', '审题错误', '看错抄错', '未按要求', '概念不清', '步骤不全', '计算失误', '其他'];
  const errorType = ERR_TYPES.includes(b.error_type) ? b.error_type : '';
  const subject = ['数学', '英语', '物理', '化学'].includes(String(b.subject || '')) ? b.subject : '';
  const stu = db.prepare('SELECT grade, stage FROM users WHERE id=?').get(req.upUid) || {};
  // 1) 上传记录入池（待老师审核）
  const ins = db.prepare(`INSERT INTO paper_uploads (user_id, subject, grade, stem_text, answer, chapter, point, error_type, note, images, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)`)
    .run(req.upUid, subject,
      String(b.grade || '').trim().slice(0, 20) || String(stu.grade || ''),
      String(b.stem_text || '').trim().slice(0, 500),
      String(b.answer || '').trim().slice(0, 500),
      String(b.chapter || '').trim().slice(0, 200),
      String(b.point || '').trim().slice(0, 100),
      errorType,
      String(b.note || '').trim().slice(0, 200),
      JSON.stringify(saved), now());
  const upId = ins.lastInsertRowid;
  // 2) 免审核：自动建题（来源=学生上传）并立即进该学生错题本
  let qid = 0;
  if (subject) {
    const row = parseUp(db.prepare(`SELECT p.*, u.grade AS student_grade, u.stage AS student_stage
      FROM paper_uploads p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(upId));
    qid = autoImportUpload(row);
    db.prepare('UPDATE paper_uploads SET question_id=? WHERE id=?').run(qid, upId);
  }
  // 3) AI 视觉识别（后台异步，不阻塞上传响应）：识别学科/年级/知识点并转录题干，识别完自动补齐归类
  aiRecognizeUpload(upId).catch((e) => { console.error('[upload-ai] 识别失败:', e.message || e); });
  okUp(res, { count: saved.length, question_id: qid }, '上传成功！题目已进入你的错题本，老师会尽快审核');
});

up.get('/mine', upAuth, (req, res) => {
  const rows = db.prepare('SELECT id, subject, stem_text, answer, grade, chapter, point, error_type, status, images, created_at FROM paper_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT 30')
    .all(req.upUid).map(parseUp);
  okUp(res, { list: rows });
});

module.exports = { admin, stu, up, judgeQ, aiRecognizeUpload };
