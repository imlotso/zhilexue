'use strict';
/**
 * AI 单词记忆模块
 *
 * 管理端（/api/admin/word）：
 *   - 词书 CRUD；单词库 / 句子库 / 词性训练库的列表与删除
 *   - 上传表格式单词表（.xlsx / .csv，列自动识别），一次导入一本词书的三类数据
 *
 * 学生端（/api/stu/word）：
 *   - 词书列表（含各库数量）、取词 / 取句 / 取词性题（按单元筛选）
 *   - 训练作答记录（module: quick 速记 / pos 词性 / context 语境 / build 连词成句）与统计
 *
 * 表格解析在 tableparse.js（零依赖，支持 xlsx/csv）。
 */
const express = require('express');
const multer = require('multer');

const { db } = require('./db');
const tp = require('./tableparse');
const { delPwdOk } = require('./delpwd');

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg = '操作失败') => res.json({ code: 1, msg });

/* ============================================================ 管理端 */
const admin = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: 12 * 1024 * 1024 } });

const bookCols = `b.id, b.title, b.grade, b.kind, b.stage, b.sort, b.remark, b.created_at,
  (SELECT COUNT(*) FROM words w WHERE w.book_id = b.id) AS word_count,
  (SELECT COUNT(*) FROM word_sentences s WHERE s.book_id = b.id) AS sentence_count,
  (SELECT COUNT(*) FROM word_pos p WHERE p.book_id = b.id) AS pos_count,
  (SELECT COUNT(*) FROM word_phrases ph WHERE ph.book_id = b.id) AS phrase_count,
  (SELECT COUNT(DISTINCT r.student_id) FROM word_records r WHERE r.book_id = b.id) AS used_count,
  (SELECT COUNT(*) FROM word_records r WHERE r.book_id = b.id) AS record_count,
  (SELECT MAX(r.created_at) FROM word_records r WHERE r.book_id = b.id) AS last_used`;
/** 已填 1、2、3 的按数字从小到大；没填（0）的排在后面 */
const bookOrder = 'ORDER BY CASE WHEN IFNULL(b.sort,0)=0 THEN 1 ELSE 0 END, b.sort ASC, b.id ASC';
function bookSortNum(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(9999, n);
}

admin.get('/books', (req, res) => {
  ok(res, db.prepare(`SELECT ${bookCols} FROM word_books b ${bookOrder}`).all());
});

const BOOK_KINDS = ['word', 'pos', 'sent', 'phrase', 'syllabus'];
const BOOK_KIND_LABEL = { word: '单词书', pos: '词形转换书', sent: '句子书', phrase: '短语书', syllabus: '考纲单词书' };

/* ---- 词书学段：primary 小学 / junior 初中 / '' 未归纳（学生端两种学段都能看） ----
 * 归纳规则：书名或年级含 3-6 年级 → 小学；含 7-9 年级 → 初中。管理端可手动指定（手动优先于自动判断）。 */
const BOOK_STAGES = ['primary', 'junior'];
function stageFromText(...texts) {
  const s = texts.join(' ');
  if (/[三四五六]年级|[3-6]\s*年级/.test(s)) return 'primary';
  if (/[七八九]年级|[7-9]\s*年级/.test(s)) return 'junior';
  return '';
}
function bookStageIn(v, title, grade) {
  const s = String(v || '').trim().toLowerCase();
  if (BOOK_STAGES.includes(s)) return s;          // 手动指定优先
  return stageFromText(grade, title);             // 没指定 → 按年级 / 书名自动归纳
}

admin.post('/books', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return fail(res, '请填写词书名称');
  const kind = BOOK_KINDS.includes(b.kind) ? b.kind : 'word';
  const r = db.prepare('INSERT INTO word_books (title, grade, kind, stage, sort, remark, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(title, String(b.grade || '').trim(), kind, bookStageIn(b.stage, title, b.grade), bookSortNum(b.sort), String(b.remark || '').trim(), req.user ? req.user.id : null, now());
  ok(res, db.prepare(`SELECT ${bookCols} FROM word_books b WHERE b.id=?`).get(r.lastInsertRowid), '已创建');
});

/** 修改词书类型（学生端各模块按类型取书） */
admin.put('/books/:id/kind', (req, res) => {
  const id = Number(req.params.id) || 0;
  const kind = String((req.body || {}).kind || '');
  if (!BOOK_KINDS.includes(kind)) return fail(res, '未知的词书类型');
  if (!db.prepare('SELECT id FROM word_books WHERE id=?').get(id)) return fail(res, '词书不存在');
  db.prepare('UPDATE word_books SET kind=? WHERE id=?').run(kind, id);
  ok(res, { id, kind }, `已改为「${BOOK_KIND_LABEL[kind]}」`);
});

/** 编辑词书基本信息（名称 / 类型 / 年级 / 备注）：类型改动会联动学生端模块归属 */
admin.put('/books/:id', (req, res) => {
  const id = Number(req.params.id) || 0;
  const row = db.prepare('SELECT id FROM word_books WHERE id=?').get(id);
  if (!row) return fail(res, '词书不存在');
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return fail(res, '请填写词书名称');
  const kind = BOOK_KINDS.includes(b.kind) ? b.kind : 'word';
  db.prepare('UPDATE word_books SET title=?, grade=?, remark=?, kind=?, stage=?, sort=? WHERE id=?')
    .run(title, String(b.grade || '').trim(), String(b.remark || '').trim(), kind, bookStageIn(b.stage, title, b.grade), bookSortNum(b.sort), id);
  ok(res, db.prepare(`SELECT ${bookCols} FROM word_books b WHERE b.id=?`).get(id), '已保存');
});

/** 删除词书：级联删除三库数据（作答记录保留，不算学生的错）
 *  必须带删除密码——否则前端那个密码框形同虚设，
 *  任何人拿到后台账号（含分校）都能绕过界面直接把整本词书删掉。 */
admin.delete('/books/:id', (req, res) => {
  if (!delPwdOk(req)) return fail(res, '删除密码错误');
  const id = Number(req.params.id) || 0;
  if (!db.prepare('SELECT id FROM word_books WHERE id=?').get(id)) return fail(res, '词书不存在');
  const del = db.transaction(() => {
    db.prepare('DELETE FROM words WHERE book_id=?').run(id);
    db.prepare('DELETE FROM word_sentences WHERE book_id=?').run(id);
    db.prepare('DELETE FROM word_pos WHERE book_id=?').run(id);
    db.prepare('DELETE FROM word_phrases WHERE book_id=?').run(id);
    db.prepare('DELETE FROM word_books WHERE id=?').run(id);
  });
  del();
  ok(res, null, '已删除');
});

/* ---------------- 三类库的列表 / 删除 ---------------- */
function listRoute(table, where) {
  return (req, res) => {
    const bookId = Number(req.query.book_id) || 0;
    if (!bookId) return fail(res, '缺少 book_id');
    const limit = Math.min(2000, Number(req.query.limit) || 1000);
    const rows = db.prepare(`SELECT * FROM ${table} WHERE book_id=? ${where} ORDER BY id LIMIT ?`)
      .all(bookId, limit);
    ok(res, rows);
  };
}

admin.get('/words', listRoute('words', ''));
admin.get('/sentences', listRoute('word_sentences', ''));
admin.get('/pos', listRoute('word_pos', ''));
admin.get('/phrases', listRoute('word_phrases', ''));

admin.delete('/words/:id', (req, res) => delRow(res, 'words', req.params.id));
admin.delete('/sentences/:id', (req, res) => delRow(res, 'word_sentences', req.params.id));
admin.delete('/pos/:id', (req, res) => delRow(res, 'word_pos', req.params.id));
admin.delete('/phrases/:id', (req, res) => delRow(res, 'word_phrases', req.params.id));

function delRow(res, table, id) {
  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(Number(id) || 0);
  ok(res, null, '已删除');
}

/** 手工新增 / 修改一条。表名写死在这里，不接受外部传入。 */
const ROW_KIND = {
  words: {
    table: 'words',
    cols: ['unit', 'word', 'phonetic', 'pos', 'meaning', 'example'],
    required: { word: '请填写单词' },
    tidy(o) { o.word = o.word.replace(/\s+/g, ' '); },
    dup(bookId, o, id) {
      return db.prepare('SELECT id FROM words WHERE book_id=? AND lower(word)=lower(?) AND ifnull(unit,\'\')=? AND id<>?')
        .get(bookId, o.word, o.unit || '', id);
    },
    dupMsg: '这本词书里已经有同样的单词和单元',
  },
  phrases: {
    table: 'word_phrases',
    cols: ['unit', 'phrase', 'meaning', 'example', 'example_cn'],
    required: { phrase: '请填写短语' },
    tidy(o) { o.phrase = o.phrase.replace(/\s+/g, ' '); },
    dup(bookId, o, id) {
      return db.prepare('SELECT id FROM word_phrases WHERE book_id=? AND lower(phrase)=lower(?) AND ifnull(unit,\'\')=? AND id<>?')
        .get(bookId, o.phrase, o.unit || '', id);
    },
    dupMsg: '这本词书里已经有同样的短语和单元',
  },
  sentences: {
    table: 'word_sentences',
    cols: ['unit', 'text', 'translation', 'grp'],
    required: { text: '请填写句子' },
    dup(bookId, o, id) {
      return db.prepare('SELECT id FROM word_sentences WHERE book_id=? AND lower(text)=lower(?) AND id<>?')
        .get(bookId, o.text, id);
    },
    dupMsg: '这本词书里已经有同样的句子',
  },
  pos: {
    table: 'word_pos',
    cols: ['unit', 'base_word', 'base_pos', 'base_meaning', 'target_word', 'target_pos', 'meaning', 'affix'],
    required: { base_word: '请填写原词', target_word: '请填写目标词', target_pos: '请填写词性' },
    tidy(o) { o.target_pos = normPos(o.target_pos); },
    dup(bookId, o, id) {
      return db.prepare('SELECT id FROM word_pos WHERE book_id=? AND lower(base_word)=lower(?) AND lower(target_word)=lower(?) AND id<>?')
        .get(bookId, o.base_word, o.target_word, id);
    },
    dupMsg: '这本词书里已经有同样的原词和目标词',
  },
};

function readRow(spec, body) {
  const o = {};
  for (const c of spec.cols) o[c] = String((body || {})[c] == null ? '' : body[c]).trim();
  if (spec.tidy) spec.tidy(o);
  for (const [k, msg] of Object.entries(spec.required)) if (!o[k]) return { error: msg };
  return { row: o };
}

function writeRow(key, id, body) {
  const spec = ROW_KIND[key];
  const parsed = readRow(spec, body);
  if (parsed.error) return parsed;
  const o = parsed.row;
  if (id) {
    const old = db.prepare(`SELECT id, book_id FROM ${spec.table} WHERE id=?`).get(id);
    if (!old) return { error: '记录不存在' };
    if (spec.dup && spec.dup(old.book_id, o, id)) return { error: spec.dupMsg };
    db.prepare(`UPDATE ${spec.table} SET ${spec.cols.map((c) => c + '=?').join(',')} WHERE id=?`)
      .run(...spec.cols.map((c) => o[c]), id);
    return { id };
  }
  const bookId = Number((body || {}).book_id) || 0;
  if (!db.prepare('SELECT id FROM word_books WHERE id=?').get(bookId)) return { error: '词书不存在' };
  if (spec.dup && spec.dup(bookId, o, 0)) return { error: spec.dupMsg };
  const r = db.prepare(`INSERT INTO ${spec.table} (book_id, ${spec.cols.join(',')}, created_at) VALUES (?${',?'.repeat(spec.cols.length)},?)`)
    .run(bookId, ...spec.cols.map((c) => o[c]), now());
  return { id: r.lastInsertRowid };
}

for (const key of Object.keys(ROW_KIND)) {
  admin.post('/' + key, (req, res) => {
    const r = writeRow(key, 0, req.body);
    if (r.error) return fail(res, r.error);
    ok(res, { id: r.id }, '已添加');
  });
  admin.put('/' + key + '/:id', (req, res) => {
    const r = writeRow(key, Number(req.params.id) || 0, req.body);
    if (r.error) return fail(res, r.error);
    ok(res, { id: r.id }, '已保存');
  });
}

/* ---------------- 上传解析 ---------------- */
// 各类库的「列名别名表」：上传表格的表头命中哪个别名，就映射到哪个字段。
// 全都匹配不上时按默认列序兜底（单词表最常见的就是 单词/音标/释义/例句/单元；老表带「词性」列也能识别）。
const KINDS = {
  word: {
    table: 'words',
    fields: ['word', 'phonetic', 'pos', 'meaning', 'example', 'unit'],
    alias: {
      word: ['单词', 'word', '英文', '英语', 'words', '单词（英文）'],
      phonetic: ['音标', 'phonetic', 'phonetics', '音标（美式）'],
      pos: ['词性', 'pos', '词性缩写', 'part of speech'],
      meaning: ['释义', '意思', '中文', '词义', '含义', 'meaning', '中文释义', '翻译'],
      example: ['例句', 'example', '例句（英文）', 'sentence'],
      unit: ['单元', 'unit', 'list', '课', '章节'],
    },
    required: ['word'],
    defaults: ['word', 'phonetic', 'meaning', 'example', 'unit'],
  },
  sentence: {
    table: 'word_sentences',
    fields: ['text', 'translation', 'unit', 'grp'],
    alias: {
      text: ['句子', 'sentence', '英文', '英文句子', 'text'],
      translation: ['翻译', '中文', '译文', '中文翻译', 'translation'],
      unit: ['单元', 'unit', 'list', '课', '章节'],
      grp: ['分组', 'group', '课文分组', '课文'],
    },
    required: ['text'],
    defaults: ['text', 'translation', 'unit', 'grp'],
  },
  pos: {
    table: 'word_pos',
    fields: ['base_word', 'base_pos', 'base_meaning', 'target_word', 'target_pos', 'meaning', 'affix', 'unit'],
    alias: {
      base_word: ['原词', '基础词', 'base', 'base word', '原形', '基础单词'],
      base_pos: ['原词词性', 'base pos', '原词的词性', '原词性'],
      base_meaning: ['原词译', '原词释义', '原词翻译', '原词意思', 'base meaning'],
      target_word: ['目标词', '派生词', 'target', 'target word', '变形', '答案'],
      target_pos: ['词性', '目标词性', 'pos', 'target pos', '变成'],
      meaning: ['释义', '目标词释义', '中文', '意思', '词义', 'meaning', '中文释义'],
      affix: ['词缀', '词缀说明', 'affix', '说明', '后缀', '前缀'],
      unit: ['单元', 'unit', 'list'],
    },
    required: ['base_word', 'target_word', 'target_pos'],
    defaults: ['base_word', 'base_pos', 'base_meaning', 'target_word', 'target_pos', 'meaning', 'affix', 'unit'],
  },
  phrase: {
    table: 'word_phrases',
    // 例句 / 例句中文：语境填空直接用它做原题（译林版课文原句最佳），留空则由 AI 现生成
    fields: ['phrase', 'meaning', 'example', 'example_cn', 'unit'],
    alias: {
      phrase: ['短语', 'phrase', '词组', '英文短语', '短语（英文）', 'phrases'],
      meaning: ['释义', '意思', '中文', '词义', '含义', 'meaning', '中文释义', '翻译'],
      example: ['例句', 'example', '英文例句', '例句（英文）', '例句（译林版课文原句）'],
      example_cn: ['例句中文', '例句翻译', '例句中文翻译', '例句中文（选填）'],
      unit: ['单元', 'unit', 'list', '课', '章节'],
    },
    required: ['phrase'],
    defaults: ['phrase', 'meaning', 'example', 'example_cn', 'unit'],
  },
};

/** 规范化词性：表格里常见 n./v./adj./adv./名词/动词… 统一成中文名词等（匹配选项按钮） */
const POS_MAP = {
  'n': '名词', 'n.': '名词', 'noun': '名词', '名词': '名词',
  'v': '动词', 'v.': '动词', 'verb': '动词', '动词': '动词', 'vt': '动词', 'vi': '动词',
  'adj': '形容词', 'adj.': '形容词', 'a.': '形容词', 'adjective': '形容词', '形容词': '形容词',
  'adv': '副词', 'adv.': '副词', 'ad.': '副词', 'adverb': '副词', '副词': '副词',
};
function normPos(s) {
  const k = String(s || '').trim().toLowerCase().replace(/\s/g, '');
  if (POS_MAP[k]) return POS_MAP[k];
  // 处理 "n.名词" 之类混合写法
  const m = /^(n|v|adj|adv|a)\b/i.exec(k.replace(/\./g, ''));
  return m ? (POS_MAP[m[1]] || String(s).trim()) : String(s || '').trim();
}

/**
 * 多工作表合并 + 表头行自动定位：
 *  - 真实表格首行常常是「七年级上册单词表」这类标题行，表头在第 2 行 → 自动往后找
 *  - 「一个单元一张工作表」的 xlsx：表头一致的工作表会合并成一本词书导入
 */
function mergeSheets(sheets, conf) {
  const clean = (v) => String(v == null ? '' : v).trim();
  const low = (v) => clean(v).toLowerCase();
  // 表头允许带「（选填）/（必填）/（建议填）」等标注：匹配前先剥掉括号说明
  const stripNote = (v) => low(v).replace(/[（(][^（）()]*[）)]/g, '').replace(/\s/g, '');
  const hitOf = (row) => {
    if (!row) return -1;
    const cells = row.map(stripNote).filter(Boolean);
    let n = 0;
    for (const f of conf.fields) if (cells.some((c) => conf.alias[f].some((a) => c === stripNote(a)))) n++;
    return n;
  };
  const info = sheets.map((rows) => {
    if (!rows || !rows.length) return null;
    let hi = 0, hit = -1;
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const h = hitOf(rows[i]);
      if (h > hit) { hit = h; hi = i; }
    }
    const header = (rows[hi] || []).map(clean);
    const body = rows.slice(hi + 1).filter((r) => r && r.some((c) => clean(c) !== ''));
    return { header, body, hit: Math.max(hit, 0) };
  }).filter(Boolean);
  if (!info.length) return { header: [], rows: [] };
  info.sort((a, b) => (b.hit - a.hit) || (b.body.length - a.body.length));
  const main = info[0];
  const sig = (h) => h.slice(0, 3).map(low).filter(Boolean).join('|');
  const rows = main.body.slice();
  for (const s of info.slice(1)) {
    if (sig(s.header) && sig(s.header) === sig(main.header)) rows.push(...s.body);
  }
  return { header: main.header, rows };
}

admin.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, '请选择 xlsx 或 csv 文件');
    const kind = String(req.body.kind || 'word');
    const conf = KINDS[kind];
    if (!conf) return fail(res, '未知的数据类型');

    // 先解析、先校验，都通过了再建词书（避免解析失败留下一个空词书）
    const merged = mergeSheets(tp.parseTableSheets(req.file.buffer), conf);
    const header = merged.header;
    const allRows = merged.rows;
    if (!header.length || !allRows.length) {
      return fail(res, '表格里没有读到数据行：请确认第一行（或前几行）是表头，例如「单词 | 音标 | 词性 | 释义 | 例句 | 单元」；如果是老版 .xls 请另存为 .xlsx 或 CSV 再上传');
    }
    const objs = allRows.map((r) => {
      const o = {};
      header.forEach((h, i) => { if (h) o[h] = String(r[i] == null ? '' : r[i]).trim(); });
      return o;
    });

    // 列映射：表头命中别名（剥掉「（选填）」等标注后比对）；一个都没命中就按默认列序
    const map = {};
    for (const f of conf.fields) {
      map[f] = header.findIndex((h) => conf.alias[f].some((a) => String(h).toLowerCase().replace(/[（(][^（）()]*[）)]/g, '').replace(/\s/g, '') === String(a).toLowerCase().replace(/[（(][^（）()]*[）)]/g, '').replace(/\s/g, '')));
    }
    const hitCount = conf.fields.filter((f) => map[f] >= 0).length;
    if (!hitCount) {
      conf.defaults.forEach((f, i) => { map[f] = header.length ? i : -1; });
    }
    const miss = conf.required.filter((f) => map[f] < 0);
    if (miss.length) {
      return fail(res, '表头缺少必需列：' + miss.join('、') + '（当前表头：' + header.filter(Boolean).join(' | ')
        + '；可用列名：' + conf.alias[miss[0]].join(' / ') + '）');
    }

    // 目标词书：传 book_id 用现有书；否则按 title 新建（类型跟随上传的数据类型）
    let bookId = Number(req.body.book_id) || 0;
    let newBook = false;
    if (!bookId) {
      const title = String(req.body.title || '').trim();
      if (!title) return fail(res, '请选择已有词书或填写新词书名称');
      const bookKind = kind === 'pos' ? 'pos' : kind === 'sentence' ? 'sent' : kind === 'phrase' ? 'phrase' : 'word';
      bookId = db.prepare('INSERT INTO word_books (title, grade, kind, stage, created_by, created_at) VALUES (?,?,?,?,?,?)')
        .run(title, String(req.body.grade || '').trim(), bookKind, stageFromText(req.body.grade, title), req.user ? req.user.id : null, now()).lastInsertRowid;
      newBook = true;
    } else {
      const b = db.prepare('SELECT id FROM word_books WHERE id=?').get(bookId);
      if (!b) return fail(res, '词书不存在');
    }

    const get = (o, f) => (map[f] >= 0 ? String(o[header[map[f]]] || '').trim() : '');
    const insert = db.prepare(`INSERT INTO ${conf.table} (book_id, ${conf.fields.filter((f) => f !== 'book_id').join(',')}, created_at)
      VALUES (${['book_id'].concat(conf.fields.filter((f) => f !== 'book_id')).map(() => '?').join(',')}, ?)`);
    // 注意：fields 里没有 book_id，上面 SQL 拼出来的就是 (book_id, word, phonetic, ..., created_at)

    let inserted = 0, skipped = 0, grpMiss = 0;
    const grpRequired = kind === 'sentence' && map.grp >= 0;   // 表里带了「分组」列 → 必填
    const seen = new Set();
    // 先装入该词书里已有的记录，保证「同一份表重复上传」不会产生重复题库
    if (kind === 'word') {
      db.prepare('SELECT word, unit FROM words WHERE book_id=?').all(bookId)
        .forEach((r) => seen.add(String(r.word).toLowerCase() + '|' + (r.unit || '')));
    } else if (kind === 'sentence') {
      db.prepare('SELECT text FROM word_sentences WHERE book_id=?').all(bookId)
        .forEach((r) => seen.add(String(r.text).toLowerCase()));
    } else if (kind === 'phrase') {
      db.prepare('SELECT phrase, unit FROM word_phrases WHERE book_id=?').all(bookId)
        .forEach((r) => seen.add(String(r.phrase).toLowerCase() + '|' + (r.unit || '')));
    } else {
      db.prepare('SELECT base_word, target_word FROM word_pos WHERE book_id=?').all(bookId)
        .forEach((r) => seen.add(String(r.base_word).toLowerCase() + '|' + String(r.target_word).toLowerCase()));
    }
    const tx = db.transaction(() => {
      for (const o of objs) {
        const rec = {};
        for (const f of conf.fields) rec[f] = get(o, f);
        if (kind === 'word') {
          rec.word = rec.word.replace(/\s+/g, ' ');
          if (!rec.word) { skipped++; continue; }
          const key = rec.word.toLowerCase() + '|' + (rec.unit || '');
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          insert.run(bookId, rec.word, rec.phonetic, rec.pos, rec.meaning, rec.example, rec.unit, now());
        } else if (kind === 'sentence') {
          if (!rec.text) { skipped++; continue; }
          if (grpRequired && !rec.grp) { grpMiss++; skipped++; continue; }   // 分组必填
          const key = rec.text.toLowerCase();
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          insert.run(bookId, rec.text, rec.translation, rec.unit, rec.grp || '', now());
        } else if (kind === 'phrase') {
          rec.phrase = String(rec.phrase || '').replace(/\s+/g, ' ').trim();
          if (!rec.phrase) { skipped++; continue; }
          const key = rec.phrase.toLowerCase() + '|' + (rec.unit || '');
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          insert.run(bookId, rec.phrase, rec.meaning, rec.example, rec.example_cn, rec.unit, now());
        } else {
          rec.target_pos = normPos(rec.target_pos);
          rec.affix = rec.affix || suggestAffix(rec.base_word, rec.target_word);
          if (!rec.base_word || !rec.target_word || !rec.target_pos) { skipped++; continue; }
          const key = rec.base_word.toLowerCase() + '|' + rec.target_word.toLowerCase();
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          insert.run(bookId, rec.base_word, rec.base_pos, rec.base_meaning, rec.target_word, rec.target_pos, rec.meaning, rec.affix, rec.unit, now());
        }
        inserted++;
      }
    });
    tx();

    // 词形数据：原词词性 / 目标词释义 没填时，从本书单词库兜底补上（背诵卡上才有意思和词性）
    if (kind === 'pos') {
      db.prepare(`UPDATE word_pos SET base_pos=(SELECT w.pos FROM words w WHERE w.book_id=word_pos.book_id AND lower(w.word)=lower(word_pos.base_word) AND IFNULL(w.pos,'')<>'')
        WHERE book_id=? AND IFNULL(base_pos,'')=''`).run(bookId);
      db.prepare(`UPDATE word_pos SET meaning=(SELECT w.meaning FROM words w WHERE w.book_id=word_pos.book_id AND lower(w.word)=lower(word_pos.target_word) AND IFNULL(w.meaning,'')<>'')
        WHERE book_id=? AND IFNULL(meaning,'')=''`).run(bookId);
      db.prepare(`UPDATE word_pos SET base_meaning=(SELECT w.meaning FROM words w WHERE w.book_id=word_pos.book_id AND lower(w.word)=lower(word_pos.base_word) AND IFNULL(w.meaning,'')<>'')
        WHERE book_id=? AND IFNULL(base_meaning,'')=''`).run(bookId);
      const baseMean = require('./pos-base-mean');
      const fillBase = db.prepare("UPDATE word_pos SET base_meaning=? WHERE book_id=? AND lower(base_word)=? AND IFNULL(base_meaning,'')=''");
      for (const [word, mean] of Object.entries(baseMean)) fillBase.run(mean, bookId, word);
    }

    const sample = objs.slice(0, 3);
    // 一条都没导进去：如果是刚新建的词书，回滚掉，避免留下空词书让学生端一片空白
    if (!inserted && newBook) {
      db.prepare('DELETE FROM word_books WHERE id=?').run(bookId);
      return fail(res, `没有导入任何数据（共 ${objs.length} 行，全部被跳过）。请检查：①表头是否是「${conf.alias[conf.required[0]][0]} | …」这类列名；`
        + `②必需列是否填了内容${kind === 'sentence' && map.grp >= 0 ? '（注意「分组」必填，如 大课文 / 小课文）' : ''}；③是否重复上传过同一份表。当前识别到的表头：${header.filter(Boolean).join(' | ')}`);
    }
    ok(res, { bookId, inserted, skipped, header, sample },
      `导入成功：新增 ${inserted} 条`
      + (grpMiss ? `，跳过 ${grpMiss} 条（「分组」必填，没填分组的不导入）` : skipped ? `，跳过 ${skipped} 条（空行/重复）` : ''));
  } catch (e) {
    fail(res, '解析失败：' + (e.message || e));
  }
});

/** 没填词缀时，猜一个常见后缀（仅用于展示，答对答错不依赖它） */
function suggestAffix(base, target) {
  const suffixes = ['tion', 'sion', 'ment', 'ness', 'ity', 'ance', 'ence', 'er', 'or', 'ist', 'ive', 'ful', 'less', 'ous', 'ly', 'al'];
  const b = String(base || '').toLowerCase();
  const t = String(target || '').toLowerCase();
  if (t.startsWith(b)) {
    const rest = t.slice(b.length);
    if (rest && suffixes.includes(rest)) return base + ' + -' + rest;
    if (rest) return base + ' + ' + rest;
    return '';
  }
  for (const s of suffixes) if (t.endsWith(s)) return '… + -' + s;
  return '';
}

/* ---------------- 表格模板下载 ----------------
 * 三类库各给一个 .xlsx 模板：第一行是表头（与上传识别的列名完全一致）、下面 3 行示例数据，
 * 第二个工作表是「填写说明」。老师下载后照着填，再上传即可，不用自己猜表头怎么写。
 */
const XLSX = require('xlsx');

const TEMPLATES = {
  word: {
    file: '单词表模板.xlsx',
    sheet: '单词库',
    cols: ['单词', '音标（选填）', '释义', '例句（选填）', '单元（选填）'],
    rows: [
      ['repeat', '[rɪˈpiːt]', '重复', 'Please repeat after me.', 'Unit 1'],
      ['talent', '[ˈtælənt]', '天赋；才能', 'She has a talent for music.', 'Unit 1'],
      ['different', '[ˈdɪfrənt]', '不同的', 'We are in different classes.', 'Unit 2'],
    ],
    tips: [
      ['单词', '必填。只写英文单词本身，如 repeat'],
      ['音标', '选填，如 [rɪˈpiːt]，学生端会显示在单词下方'],
      ['释义', '建议填，中文释义，多个意思用「；」隔开；连连看配对、默写提示都靠它'],
      ['例句', '选填，英文例句。填了以后「课文朗读 / 连词成句 / 听音拼句」里练得更自然'],
      ['单元', '选填，如 Unit 1 / 第一单元。学生端可以按单元筛选练习；整列删掉也行'],
      ['说明', '词性不用在这里填——词性相关练习（词性判断 / 词形转换）用「词性训练（词根词缀）表」单独上传'],
    ],
  },
  /* 考纲单词书专用：没有单元列——学生端学前检测自动按每 60 个单词为一个大组 */
  syllabus: {
    file: '考纲单词表模板.xlsx',
    sheet: '单词库',
    cols: ['单词', '音标（选填）', '释义（建议填）', '例句（选填）'],
    rows: [
      ['repeat', '[rɪˈpiːt]', '重复', 'Please repeat after me.'],
      ['talent', '[ˈtælənt]', '天赋；才能', 'She has a talent for music.'],
      ['different', '[ˈdɪfrənt]', '不同的', 'We are in different classes.'],
    ],
    tips: [
      ['单词', '必填。只写英文单词本身，如 repeat'],
      ['音标', '选填，如 [rɪˈpiːt]，学生端会显示在单词下方'],
      ['释义', '建议填，中文释义，多个意思用「；」隔开；学前检测的「点击核对」、识记与检测都靠它'],
      ['例句', '选填，英文例句，识记词卡上会展示'],
      ['说明', '不需要单元列：学生端学前检测会自动按每 60 个单词为一个大组过筛，无需手动分组'],
    ],
  },
  sentence: {
    file: '句子表模板.xlsx',
    sheet: '句子库',
    cols: ['句子', '翻译（选填）', '单元（选填）', '分组（必填）'],
    rows: [
      ['She is a very talented artist.', '她是一位非常有才华的艺术家。', 'Unit 1', '大课文'],
      ['How often do you exercise?', '你多久锻炼一次？', 'Unit 2', '小课文'],
      ['I want to be a scientist when I grow up.', '我长大后想成为一名科学家。', 'Unit 3', '大课文'],
    ],
    tips: [
      ['句子', '必填。英文句子，「连词成句」「课文朗读」都从这里取题'],
      ['翻译', '选填（建议填），中文翻译，课文朗读会用它做提示'],
      ['单元', '选填，如 Unit 1；句子太短（少于 3 个单词）会被跳过；整列删掉也行'],
      ['分组', '必填，如 大课文 / 小课文；学生端单元下按分组筛选朗读和练习'],
    ],
  },
  pos: {
    file: '词性训练（词根词缀）表模板.xlsx',
    sheet: '词性训练',
    cols: ['原词', '原词词性', '原词译', '目标词', '词性', '目标词释义', '词缀说明（选填）', '单元（选填）'],
    rows: [
      ['care', 'v.', '关心；在意', 'careful', '形容词', '小心的', 'care + -ful', 'Unit 1'],
      ['care', 'v.', '关心；在意', 'carefully', '副词', '小心地', 'careful + -ly', 'Unit 1'],
      ['good', 'adj.', '好的', 'better', '比较级', '', 'good → 比较级', 'Unit 1'],
      ['hero', 'n.', '英雄', 'heroes', '复数', '', 'hero + es', 'Unit 2'],
    ],
    tips: [
      ['原词', '必填。基础词，如 care；同一个原词的多行变形会自动连成一条「转换链」'],
      ['原词词性', '建议必填，如 v. / adj. / n.；背诵卡上会显示成 care (v.)，不填学生背诵时看不到词性'],
      ['原词译', '建议必填，原词的中文翻译，如 关心；在意。同一个原词的每一行都填同一句。学生背诵时显示在原词后面；变形没单独释义时也用它'],
      ['目标词', '必填。变形后的词，如 careful'],
      ['词性', '必填。目标词的词性：名词 / 动词 / 形容词 / 副词（也认 n./v./adj./adv.），也支持 比较级 / 最高级 / 复数 / 过去式 / 现在分词 / 同义词 / 反义词'],
      ['目标词释义', '建议必填，目标词的中文意思，如 小心的；背诵展示、默写提示都靠它，不填学生背诵时看不到中文'],
      ['词缀说明', '选填，如 care + -ful；留空会按常见后缀自动补一个；整列删掉也行'],
      ['单元', '选填，如 Unit 1；整列删掉也行'],
    ],
  },
  phrase: {
    file: '短语表模板.xlsx',
    sheet: '短语库',
    cols: ['短语', '释义', '例句（选填：译林版课文原句）', '例句中文（选填）', '单元（选填）'],
    rows: [
      ['look after', '照顾；照料', 'I can look after my little sister.', '我可以照顾我的小妹妹。', 'Unit 1'],
      ['say hello', '打招呼；问好', 'We say hello to our teacher every morning.', '我们每天早上跟老师问好。', 'Unit 5'],
      ['take pictures', '拍照', 'We take pictures in the park every Sunday.', '我们每个星期天在公园里拍照。', 'Unit 8'],
    ],
    tips: [
      ['短语', '必填。英文短语 / 词组，如 look after；学生端「短语速记」四步：短语学习 → 记忆学习 → 听音选词 → 语境填空'],
      ['释义', '建议填，中文释义，如 照顾；照料；听音选词的释义贴纸、默写提示都靠它'],
      ['例句', '选填（强烈建议填）：写译林版（牛津译林）2024 新版教材本册本单元课文里的真实原句，句子里要含有这条短语。填了以后学生端「语境填空」直接拿它挖空练习；留空则由 AI 生成或学生练到时现生成。'],
      ['例句中文', '选填，例句的中文翻译，孩子做完自己对答案'],
      ['单元', '选填，如 Unit 1。学生端按单元开练；AI 生成例句时也会按这个单元去对应课文'],
      ['说明', '例句里的短语可以按人称 / 时态自然变形（be good at 写成 am good at），带「…」的模板短语（it’s time to …）也能正常识别'],
    ],
  },
};

admin.get('/template', (req, res) => {
  const kind = String(req.query.kind || 'word');
  const t = TEMPLATES[kind];
  if (!t) return fail(res, '未知的模板类型（应为 word / syllabus / sentence / pos / phrase）');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([t.cols].concat(t.rows));
  ws['!cols'] = t.cols.map((h) => ({
    wch: ['例句', '句子', '释义'].includes(String(h).replace(/[（(].*$/, '')) ? 32 : (String(h).replace(/[（(].*$/, '') === '翻译' ? 26 : (String(h).replace(/[（(].*$/, '') === '音标' || String(h).replace(/[（(].*$/, '') === '词缀说明' ? 18 : 12)),
  }));
  XLSX.utils.book_append_sheet(wb, ws, t.sheet);
  const ws2 = XLSX.utils.aoa_to_sheet([['列名', '填写说明']].concat(t.tips));
  ws2['!cols'] = [{ wch: 14 }, { wch: 62 }];
  XLSX.utils.book_append_sheet(wb, ws2, '填写说明');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const ascii = t.file.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(t.file)}`);
  res.send(buf);
});

/* ============================================================ AI 单词训练：AI 补全 / AI 生成 */
const aiLib = require('./ai');

/** AI 文本 → 数据行（补全/生成共用）；演示模式直接返回示例，流程可先跑通 */
async function aiRows({ system, user, sample }) {
  const cfg = aiLib.getConfig();
  if (cfg.mock) return { rows: sample, model: 'mock（演示模式）' };
  const { text, model } = await aiLib.chat({ system, user, maxTokens: 4000, temperature: 0.3 });
  const parsed = aiLib.extractJson(text);
  const rows = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.words || parsed.sentences || parsed.list || []);
  if (!Array.isArray(rows) || !rows.length) throw new Error('AI 没有返回可用的数据行，请重试或换个说法');
  return { rows, model };
}

/* ---- 短语「例句」AI 补齐（2026-10-29 加）--------------------------------------------------
 * 老师可以在短语库里给每条短语指定例句——译林版（牛津译林）2024 新版教材该册该单元课文里的真实原句，
 * 手动填或点 AI 补齐都行。语境填空优先用这里的例句（source='book'），没有才回退 AI 缓存 / 现问 AI。
 * 批量补齐是后台异步跑的（AI 一次一条，约 3~6 秒），前端用 /phrase-examples/status 轮询进度。 */
const exRunning = new Map();   // bookId -> {total, done, fail}
/** 给一条短语生成例句并写回短语行（example / example_cn / example_stx），失败返回 null */
async function genPhraseExampleRow(row) {
  const word = String(row.phrase || '').trim().toLowerCase();
  const made = await genPhraseSentence(row.book_id, word, row.meaning || '', row.unit || '', true);
  if (!made) return null;
  const stx = cleanStructure(made.structure) || (Array.isArray(made.structure) ? JSON.stringify(made.structure) : '');
  db.prepare('UPDATE word_phrases SET example=?, example_cn=?, example_stx=? WHERE id=?')
    .run(made.sentence, made.cn, stx, row.id);
  return { id: row.id, phrase: row.phrase, sentence: made.sentence, cn: made.cn, structure: made.structure, blank: made.blank };
}
/** 批量 AI 补齐：默认只补「还没例句」的短语；scope='all' 则全部重生成（老师想换一批原句时用） */
admin.post('/phrase-examples', async (req, res) => {
  try {
    const b = req.body || {};
    const bookId = Number(b.book_id) || 0;
    if (!db.prepare('SELECT id FROM word_books WHERE id=?').get(bookId)) return fail(res, '词书不存在');
    if (exRunning.has(bookId)) return ok(res, { started: false, reason: 'running' });
    const aiLib = require('./ai');
    const cfg = aiLib.getConfig();
    if (cfg.mock || !cfg.hasKey) return ok(res, { started: false, reason: 'no-ai' });
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => n > 0).slice(0, 200) : [];
    const where = String(b.scope || '') === 'all' ? "IFNULL(phrase,'')<>''" : "IFNULL(phrase,'')<>'' AND IFNULL(example,'')=''";
    const rows = ids.length
      ? db.prepare(`SELECT id, book_id, phrase, meaning, unit FROM word_phrases WHERE book_id=? AND ${where} AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(bookId, ...ids)
      : db.prepare(`SELECT id, book_id, phrase, meaning, unit FROM word_phrases WHERE book_id=? AND ${where} ORDER BY id LIMIT 200`).all(bookId);
    if (!rows.length) return ok(res, { started: false, reason: 'done' });
    const st = { total: rows.length, done: 0, fail: 0, failed: [] };
    exRunning.set(bookId, st);
    ok(res, { started: true, pending: rows.length });
    (async () => {
      await runExampleJobs(rows, st, 3);
      exRunning.delete(bookId);
    })();
  } catch (e) { fail(res, '启动失败：' + e.message); }
});
/** 并发跑一批例句生成（默认 3 条同时进行，避免串行太慢又不会打爆 AI 配额）；每条生成完立刻写回 */
async function runExampleJobs(rows, st, concurrency = 3) {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= rows.length) return;
      try {
        const made = await genPhraseExampleRow(rows[i]);
        if (made) st.done++; else { st.fail++; st.failed.push(String(rows[i].phrase || '')); }
      } catch (e) { st.fail++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
}
admin.get('/phrase-examples/status', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  const st = exRunning.get(bookId);
  let left = 0;
  try {
    left = (db.prepare("SELECT COUNT(*) AS c FROM word_phrases WHERE book_id=? AND IFNULL(example,'')=''").get(bookId) || {}).c || 0;
  } catch (e) { /* 忽略 */ }
  ok(res, { running: !!st, pending: left, total: st ? st.total : 0, done: st ? st.done : 0, fail: st ? st.fail : 0 });
});
/* ---- 一键给「所有短语书」补齐例句 --------------------------------------------------
 * 老师不可能一本一本点过去：这里把所有短语书（kind='phrase'）里还没例句的短语一次性排队，
 * 同一个后台任务串起来跑（并发 3），每条一生成就写回，学生端随时刷新就能用到新的。 */
let exAllJob = null;   // {running, total, done, fail, failed, books, startedAt}
admin.post('/phrase-examples-all', async (req, res) => {
  try {
    if (exAllJob && exAllJob.running) return ok(res, { started: false, reason: 'running' });
    const aiLib = require('./ai');
    const cfg = aiLib.getConfig();
    if (cfg.mock || !cfg.hasKey) return ok(res, { started: false, reason: 'no-ai' });
    const b = req.body || {};
    const redoAll = String(b.scope || '') === 'all';
    const books = db.prepare("SELECT id, title FROM word_books WHERE kind='phrase' ORDER BY id").all();
    const rows = [];
    const bk = [];
    for (const bkRow of books) {
      const r = db.prepare(`SELECT id, book_id, phrase, meaning, unit FROM word_phrases
        WHERE book_id=? AND IFNULL(phrase,'')<>'' ${redoAll ? '' : "AND IFNULL(example,'')=''"} ORDER BY id`).all(bkRow.id);
      if (r.length) { rows.push(...r); bk.push({ id: bkRow.id, title: bkRow.title, pending: r.length }); }
    }
    if (!rows.length) return ok(res, { started: false, reason: 'done' });
    const job = { running: true, total: rows.length, done: 0, fail: 0, failed: [], books: bk, startedAt: now() };
    exAllJob = job;
    ok(res, { started: true, pending: rows.length, books: bk.length });
    (async () => {
      await runExampleJobs(rows, job, 3);
      job.running = false;
    })();
  } catch (e) { fail(res, '启动失败：' + e.message); }
});
admin.get('/phrase-examples-all/status', (req, res) => {
  const j = exAllJob;
  let left = 0;
  try {
    left = (db.prepare(`SELECT COUNT(*) AS c FROM word_phrases p JOIN word_books b ON b.id=p.book_id
      WHERE b.kind='phrase' AND IFNULL(p.example,'')=''`).get() || {}).c || 0;
  } catch (e) { /* 忽略 */ }
  ok(res, {
    running: !!(j && j.running), total: j ? j.total : 0, done: j ? j.done : 0, fail: j ? j.fail : 0,
    failed: j ? j.failed.slice(0, 20) : [], pending: left, books: j ? j.books : [],
  });
});
/** 单条 AI 生成例句（列表每行「例句」按钮）：同步返回结果，老师可先看一眼再用 */
admin.post('/phrase-example', async (req, res) => {
  try {
    const id = Number((req.body || {}).id) || 0;
    const row = db.prepare('SELECT id, book_id, phrase, meaning, unit FROM word_phrases WHERE id=?').get(id);
    if (!row) return fail(res, '这条短语不存在');
    const made = await genPhraseExampleRow(row);
    if (!made) return fail(res, 'AI 没能生成出例句，可以直接手动填写');
    ok(res, made, '已生成例句');
  } catch (e) { fail(res, 'AI 生成失败：' + e.message); }
});

/** AI 补全当前词书里缺失的 音标/词性/释义/例句/翻译/词缀 */
admin.post('/ai/fill', async (req, res) => {
  try {
    const bookId = Number(req.body.bookId) || 0;
    const kind = req.body.kind === 'pos' ? 'pos' : req.body.kind === 'sentence' ? 'sentence' : req.body.kind === 'phrase' ? 'phrase' : 'word';
    const book = db.prepare('SELECT id, title, grade FROM word_books WHERE id=?').get(bookId);
    if (!book) return fail(res, '词书不存在');
    let filled = 0, model = '';
    if (kind === 'word') {
      const rows = db.prepare("SELECT id, word, phonetic, pos, meaning, example, unit FROM words WHERE book_id=? AND (phonetic='' OR pos='' OR meaning='' OR example='') ORDER BY id").all(bookId);
      if (!rows.length) return ok(res, { filled: 0 }, '这本词书的单词表很完整，没有需要补全的内容');
      const { rows: out, model: m } = await aiRows({
        system: '你是资深中小学英语老师。给单词补齐：音标（国际音标，如 /hʌv/）、词性（n./v./adj./adv./prep.）、简短中文释义、简单易懂的英文例句。只输出 JSON，不要 markdown、不要解释文字。',
        user: `词书《${book.title}》${book.grade ? '（' + book.grade + '）' : ''}。请为下面每个单词补全字段，输出 {"rows":[{"word":"原词","phonetic":"音标","pos":"词性","meaning":"中文释义","example":"英文例句"}]}：\n`
          + rows.map((r) => r.word + (r.unit ? `（${r.unit}）` : '')).join('、'),
        sample: rows.map((r) => ({ word: r.word, phonetic: '/…/', pos: 'n.', meaning: `（演示）${r.word} 的中文释义`, example: `This is a demo sentence with "${r.word}".` })),
      });
      model = m;
      const by = new Map(out.map((r) => [String(r.word || '').toLowerCase().trim(), r]));
      const up = db.prepare('UPDATE words SET phonetic=?, pos=?, meaning=?, example=? WHERE id=?');
      for (const r of rows) {
        const m2 = by.get(String(r.word).toLowerCase());
        if (!m2) continue;
        const phonetic = r.phonetic || String(m2.phonetic || '').trim();
        const pos = r.pos || String(m2.pos || '').trim();
        const meaning = r.meaning || String(m2.meaning || '').trim();
        const example = r.example || String(m2.example || '').trim();
        if (phonetic !== r.phonetic || pos !== r.pos || meaning !== r.meaning || example !== r.example) {
          up.run(phonetic, pos, meaning, example, r.id);
          filled++;
        }
      }
    } else if (kind === 'phrase') {
      const rows = db.prepare("SELECT id, phrase, meaning FROM word_phrases WHERE book_id=? AND meaning='' ORDER BY id").all(bookId);
      if (!rows.length) return ok(res, { filled: 0 }, '短语库的释义都是全的，没有需要补全的内容');
      const { rows: out, model: m } = await aiRows({
        system: '你是资深中小学英语老师。给英文短语 / 词组配准确、简短的中文释义。只输出 JSON，不要 markdown。',
        user: '请给下面每个英文短语配中文释义，输出 {"rows":[{"phrase":"原短语","meaning":"中文释义"}]}：\n' + rows.map((r) => r.phrase).join('、'),
        sample: rows.map((r) => ({ phrase: r.phrase, meaning: `（演示）${r.phrase} 的中文释义` })),
      });
      model = m;
      const by = new Map(out.map((r) => [String(r.phrase || '').toLowerCase().trim(), r]));
      const up = db.prepare('UPDATE word_phrases SET meaning=? WHERE id=?');
      for (const r of rows) {
        const m2 = by.get(String(r.phrase).toLowerCase());
        if (!m2 || !String(m2.meaning || '').trim()) continue;
        up.run(String(m2.meaning).trim(), r.id);
        filled++;
      }
    } else if (kind === 'sentence') {
      const rows = db.prepare("SELECT id, text, translation FROM word_sentences WHERE book_id=? AND translation='' ORDER BY id").all(bookId);
      if (!rows.length) return ok(res, { filled: 0 }, '句子库的翻译都是全的，没有需要补全的内容');
      const { rows: out, model: m } = await aiRows({
        system: '你是资深中小学英语老师。给英文句子配准确、通顺的简体中文翻译。只输出 JSON，不要 markdown。',
        user: '请给下面每个英文句子配中文翻译，输出 {"rows":[{"text":"原句","translation":"中文翻译"}]}：\n' + rows.map((r) => r.text).join('\n'),
        sample: rows.map((r) => ({ text: r.text, translation: `（演示）${r.text} 的中文翻译` })),
      });
      model = m;
      const by = new Map(out.map((r) => [String(r.text || '').toLowerCase().trim(), r]));
      const up = db.prepare('UPDATE word_sentences SET translation=? WHERE id=?');
      for (const r of rows) {
        const m2 = by.get(String(r.text).toLowerCase());
        if (!m2 || !String(m2.translation || '').trim()) continue;
        up.run(String(m2.translation).trim(), r.id);
        filled++;
      }
    } else {
      const rows = db.prepare("SELECT id, base_word, base_pos, base_meaning, target_word, target_pos, meaning, affix FROM word_pos WHERE book_id=? AND (base_pos='' OR IFNULL(base_meaning,'')='' OR meaning='' OR affix='') ORDER BY id").all(bookId);
      if (!rows.length) return ok(res, { filled: 0 }, '词性库很完整，没有需要补全的内容');
      const { rows: out, model: m } = await aiRows({
        system: '你是资深中小学英语老师，擅长词形转换（派生词）教学。base_pos / target_pos 用 n./v./adj./adv. 或 比较级/最高级/复数/过去式；base_meaning 是原词的简短中文翻译；meaning 是目标词的简短中文释义；affix 是词缀说明（如 care + -ful）。只输出 JSON，不要 markdown。',
        user: '请为下面每条词形转换补齐缺失的 原词词性 / 原词译 / 目标词释义 / 词缀说明，输出 {"rows":[{"base_word":"","target_word":"","base_pos":"","base_meaning":"","meaning":"","affix":""}]}：\n'
          + rows.map((r) => `${r.base_word} → ${r.target_word}（${r.target_pos}）`).join('\n'),
        sample: rows.map((r) => ({ base_word: r.base_word, target_word: r.target_word, base_pos: 'v.', base_meaning: `（演示）${r.base_word} 的中文`, meaning: `（演示）${r.target_word} 的中文释义`, affix: `${r.base_word} + 后缀` })),
      });
      model = m;
      const by = new Map(out.map((r) => [String(r.base_word || '').toLowerCase().trim() + '|' + String(r.target_word || '').toLowerCase().trim(), r]));
      const up = db.prepare('UPDATE word_pos SET base_pos=?, base_meaning=?, meaning=?, affix=? WHERE id=?');
      for (const r of rows) {
        const m2 = by.get(String(r.base_word).toLowerCase() + '|' + String(r.target_word).toLowerCase());
        if (!m2) continue;
        const basePos = r.base_pos || String(m2.base_pos || '').trim();
        const baseMeaning = r.base_meaning || String(m2.base_meaning || '').trim();
        const meaning = r.meaning || String(m2.meaning || '').trim();
        const affix = r.affix || String(m2.affix || '').trim();
        if (basePos !== r.base_pos || baseMeaning !== r.base_meaning || meaning !== r.meaning || affix !== r.affix) {
          up.run(basePos, baseMeaning, meaning, affix, r.id);
          filled++;
        }
      }
    }
    ok(res, { filled, model }, `AI 补全完成：更新 ${filled} 条${model ? '（' + model + '）' : ''}`);
  } catch (e) { fail(res, 'AI 补全失败：' + (e.message || e)); }
});

/** AI 生成词库数据（先预览，确认后走 /ai/save 入库） */
admin.post('/ai/generate', async (req, res) => {
  try {
    const kind = req.body.kind === 'pos' ? 'pos' : req.body.kind === 'sentence' ? 'sentence' : req.body.kind === 'phrase' ? 'phrase' : 'word';
    const grade = String(req.body.grade || '').trim();
    const unit = String(req.body.unit || '').trim();
    const topic = String(req.body.topic || '').trim();
    const count = Math.min(50, Math.max(3, Number(req.body.count) || 10));
    const unitLine = unit ? `单元：${unit}（每行 unit 都填 "${unit}"）` : 'unit 留空字符串';
    let system, user, sample;
    if (kind === 'phrase') {
      system = '你是资深中小学英语老师，擅长整理教材里的短语和词组（动词短语、介词短语、固定搭配）。meaning 是简短中文释义。只输出 JSON，不要 markdown。';
      user = `请整理${grade || '中小学'}英语常用短语 ${count} 条${unitLine}${topic ? '，教材/主题：' + topic : ''}（不重复，按常用程度排序）。输出 {"rows":[{"phrase":"","meaning":"","unit":""}]}`;
      sample = [
        { phrase: 'look after', meaning: '（演示）照顾；照料', unit },
        { phrase: 'give up', meaning: '（演示）放弃', unit },
        { phrase: 'take part in', meaning: '（演示）参加', unit },
      ];
    } else if (kind === 'word') {
      system = '你是资深中小学英语老师，擅长按教材和年级整理单词表。只输出 JSON，不要 markdown。音标用国际音标，词性用 n./v./adj./adv./prep.，中文释义简短，例句用适合该年级的简单句。';
      user = `请整理${grade || '中小学'}英语单词表，${unitLine}${topic ? '，教材/主题：' + topic : ''}，共 ${count} 个单词（不重复，按常用程度排序）。输出 {"rows":[{"word":"","phonetic":"","pos":"","meaning":"","example":"","unit":""}]}`;
      sample = [
        { word: 'apple', phonetic: '/ˈæpl/', pos: 'n.', meaning: '（演示）苹果', example: 'I eat an apple every day.', unit },
        { word: 'borrow', phonetic: '/ˈbɒrəʊ/', pos: 'v.', meaning: '（演示）借入', example: 'May I borrow your pen?', unit },
        { word: 'bright', phonetic: '/braɪt/', pos: 'adj.', meaning: '（演示）明亮的', example: 'The moon is bright tonight.', unit },
      ];
    } else if (kind === 'sentence') {
      system = '你是资深中小学英语老师。生成适合课堂朗读与「连词成句 / 听音拼句」练习的英文句子：8~14 个词、语法正确、难度匹配年级，并配中文翻译。只输出 JSON，不要 markdown。';
      user = `请生成 ${count} 个英文句子${grade ? '（' + grade + ' 水平）' : ''}，${unitLine}${topic ? '，主题：' + topic : ''}。输出 {"rows":[{"text":"","translation":"","unit":""}]}`;
      sample = [{ text: 'I have already finished my homework.', translation: '（演示）我已经完成作业了。', unit }];
    } else {
      system = '你是资深中小学英语老师，擅长词形转换（派生词）教学。target_pos 用 名词/动词/形容词/副词/比较级/最高级/复数/过去式/同义词/反义词；base_meaning 是原词简短中文翻译；meaning 是目标词简短中文释义；affix 是词缀说明。只输出 JSON，不要 markdown。';
      user = `请出 ${count} 条词形转换${grade ? '（' + grade + ' 水平）' : ''}，${unitLine}${topic ? '，教材/主题：' + topic : ''}。输出 {"rows":[{"base_word":"原词","base_pos":"原词词性","base_meaning":"原词译","target_word":"目标词","target_pos":"词性","meaning":"目标词释义","affix":"词缀说明"}]}`;
      sample = [{ base_word: 'care', base_pos: 'v.', base_meaning: '（演示）关心；在意', target_word: 'careful', target_pos: '形容词', meaning: '（演示）小心的', affix: 'care + -ful' }];
    }
    const { rows, model } = await aiRows({ system, user, sample });
    ok(res, { rows, model, kind }, `AI 生成 ${rows.length} 行${model ? '（' + model + '）' : ''}，请检查后导入`);
  } catch (e) { fail(res, 'AI 生成失败：' + (e.message || e)); }
});

/** 把预览确认后的 AI 生成数据写入词书（按各库既有去重规则跳过重复） */
admin.post('/ai/save', (req, res) => {
  try {
    const bookId = Number(req.body.bookId) || 0;
    const kind = req.body.kind === 'pos' ? 'pos' : req.body.kind === 'sentence' ? 'sentence' : req.body.kind === 'phrase' ? 'phrase' : 'word';
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!bookId || !db.prepare('SELECT id FROM word_books WHERE id=?').get(bookId)) return fail(res, '词书不存在');
    if (!rows.length) return fail(res, '没有可导入的数据');
    let inserted = 0, skipped = 0;
    const tx = db.transaction(() => {
      if (kind === 'phrase') {
        const seen = new Set(db.prepare('SELECT phrase, unit FROM word_phrases WHERE book_id=?').all(bookId).map((r) => String(r.phrase).toLowerCase() + '|' + (r.unit || '')));
        const ins = db.prepare('INSERT INTO word_phrases (book_id, unit, phrase, meaning, created_at) VALUES (?,?,?,?,?)');
        for (const r of rows) {
          const phrase = String(r.phrase || '').trim().replace(/\s+/g, ' ');
          const unit = String(r.unit || '').trim();
          if (!phrase) { skipped++; continue; }
          const key = phrase.toLowerCase() + '|' + unit;
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          ins.run(bookId, unit, phrase, String(r.meaning || '').trim(), now());
          inserted++;
        }
      } else if (kind === 'word') {
        const seen = new Set(db.prepare('SELECT word, unit FROM words WHERE book_id=?').all(bookId).map((r) => String(r.word).toLowerCase() + '|' + (r.unit || '')));
        const ins = db.prepare('INSERT INTO words (book_id, unit, word, phonetic, pos, meaning, example, created_at) VALUES (?,?,?,?,?,?,?,?)');
        for (const r of rows) {
          const word = String(r.word || '').trim().replace(/\s+/g, ' ');
          const unit = String(r.unit || '').trim();
          if (!word) { skipped++; continue; }
          const key = word.toLowerCase() + '|' + unit;
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          ins.run(bookId, unit, word, String(r.phonetic || '').trim(), String(r.pos || '').trim(), String(r.meaning || '').trim(), String(r.example || '').trim(), now());
          inserted++;
        }
      } else if (kind === 'sentence') {
        const seen = new Set(db.prepare('SELECT text FROM word_sentences WHERE book_id=?').all(bookId).map((r) => String(r.text).toLowerCase()));
        const ins = db.prepare('INSERT INTO word_sentences (book_id, unit, text, translation, grp, created_at) VALUES (?,?,?,?,?,?)');
        for (const r of rows) {
          const text = String(r.text || '').trim();
          const unit = String(r.unit || '').trim();
          if (!text) { skipped++; continue; }
          const key = text.toLowerCase();
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          ins.run(bookId, unit, text, String(r.translation || '').trim(), String(r.grp || '').trim(), now());
          inserted++;
        }
      } else {
        const seen = new Set(db.prepare('SELECT base_word, target_word FROM word_pos WHERE book_id=?').all(bookId).map((r) => String(r.base_word).toLowerCase() + '|' + String(r.target_word).toLowerCase()));
        const ins = db.prepare('INSERT INTO word_pos (book_id, unit, base_word, base_pos, base_meaning, target_word, target_pos, meaning, affix, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const r of rows) {
          const base = String(r.base_word || '').trim();
          const target = String(r.target_word || '').trim();
          const targetPos = normPos(r.target_pos);
          if (!base || !target || !targetPos) { skipped++; continue; }
          const key = base.toLowerCase() + '|' + target.toLowerCase();
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          ins.run(bookId, String(r.unit || '').trim(), base, String(r.base_pos || '').trim(), String(r.base_meaning || '').trim(), target, targetPos, String(r.meaning || '').trim(), String(r.affix || '').trim() || suggestAffix(base, target), now());
          inserted++;
        }
      }
    });
    tx();
    ok(res, { inserted, skipped }, `已导入 ${inserted} 条` + (skipped ? `，跳过 ${skipped} 条（重复/缺字段）` : ''));
  } catch (e) { fail(res, '导入失败：' + (e.message || e)); }
});

/* ============================================================ 学生端 */
const stu = express.Router();

stu.get('/books', (req, res) => {
  // 按学生学段过滤：小学 → 小学 + 未归纳的书；初中 → 初中 + 未归纳的书；考纲单词书不做学段区分
  const u = db.prepare('SELECT stage, grade FROM users WHERE id=?').get(req.user.id) || {};
  const s = String(u.stage || '').trim().toLowerCase();
  const st = BOOK_STAGES.includes(s) ? s : stageFromText(u.grade);
  if (!st) return ok(res, db.prepare(`SELECT ${bookCols} FROM word_books b ${bookOrder}`).all());
  ok(res, db.prepare(`SELECT ${bookCols} FROM word_books b WHERE b.kind='syllabus' OR IFNULL(b.stage,'')='' OR b.stage=? ${bookOrder}`).all(st));
});

/** 词书里的单元列表（给前端做单元筛选） */
stu.get('/units', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  const units = new Set();
  db.prepare("SELECT DISTINCT unit FROM words WHERE book_id=? AND unit<>''").all(bookId).forEach((r) => units.add(r.unit));
  db.prepare("SELECT DISTINCT unit FROM word_sentences WHERE book_id=? AND unit<>''").all(bookId).forEach((r) => units.add(r.unit));
  db.prepare("SELECT DISTINCT unit FROM word_pos WHERE book_id=? AND unit<>''").all(bookId).forEach((r) => units.add(r.unit));
  db.prepare("SELECT DISTINCT unit FROM word_phrases WHERE book_id=? AND unit<>''").all(bookId).forEach((r) => units.add(r.unit));
  ok(res, [...units]);
});

stu.get('/words', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  const unit = String(req.query.unit || '').trim();
  const rows = unit
    ? db.prepare('SELECT id, unit, word, phonetic, pos, meaning, example FROM words WHERE book_id=? AND unit=? ORDER BY id').all(bookId, unit)
    : db.prepare('SELECT id, unit, word, phonetic, pos, meaning, example FROM words WHERE book_id=? ORDER BY id').all(bookId);
  ok(res, rows);
});

stu.get('/sentences', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  const unit = String(req.query.unit || '').trim();
  const rows = unit
    ? db.prepare('SELECT id, unit, text, translation, grp FROM word_sentences WHERE book_id=? AND unit=? ORDER BY id').all(bookId, unit)
    : db.prepare('SELECT id, unit, text, translation, grp FROM word_sentences WHERE book_id=? ORDER BY id').all(bookId);
  ok(res, rows);
});

/** 短语库（短语速记模块，流程同单词速记） */
stu.get('/phrases', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  const unit = String(req.query.unit || '').trim();
  const rows = unit
    ? db.prepare('SELECT id, unit, phrase, meaning FROM word_phrases WHERE book_id=? AND unit=? ORDER BY id').all(bookId, unit)
    : db.prepare('SELECT id, unit, phrase, meaning FROM word_phrases WHERE book_id=? ORDER BY id').all(bookId);
  ok(res, rows);
});

/** 词性训练题库：返回全部条目，选项干扰项由前端在同一词书内随机取（离线可算） */
stu.get('/pos', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  ok(res, db.prepare('SELECT id, base_word, base_pos, base_meaning, target_word, target_pos, meaning, affix, unit FROM word_pos WHERE book_id=? ORDER BY id').all(bookId));
});

/** 语境填空（短语速记第④步）：AI 按短语生成同年级课本风格的例句（短语原样出现，前端挖空）+ 句子成分拆解结构。
 *  结果按短语（小写）缓存进 phrase_sentences 表，AI 只对每条短语生成一次，全校学生复用；
 *  另有 /phrase-prefill 后台预生成整本词书，学生到这一步时全部命中缓存、零等待。
 *  AI 未配置 / 生成失败 / 例句里没出现短语（防幻觉）→ 返回 null，前端降级为按释义默写。 */
const STX_ROLES = ['主语', '谓语', '系动词', '表语', '宾语', '定语', '状语', '补语', '其他'];

/* ---- 短语在例句里的「柔性匹配」（2026-10-29 加）----------------------------------
 * 之前要求「短语必须原样完整出现在句中」，导致一大批常用短语生成失败、语境填空退化成中文默写：
 *   be good at      → 句中自然变成 am good at / is good at（be 要随人称变）
 *   it's time to ... → 短语本身带占位符，句中当然是 It's time to go home
 *   like ... best   → I like apples best（占位符处会插入单词）
 * 现在改成：把短语和句子都拆词干后做柔性对齐，允许①人称/时态变形②... / sth / sb 占位，
 * 命中后返回句子里真正要挖空的那段原文（blank），前端用它定位，不再自己硬套短语原文。 */
/* 注意：do / doing 不能放进来 —— do homework、do morning exercises 里的 do 是真动词，
 * 当成通配会把主语 She / We 一起吞进挖空。do 后面多出来的词交给下面的 GAP 容错处理。 */
const WILD_TOKENS = new Set(['sb', 'sth', 'smb', 'sw', 'adj', 'adv', 'pron', 'num']);
/* 词典体例里的「词性/动作占位」：doing 在句中会换成具体动词-ing，按 1~2 个通配处理 */
const DOING_TOKENS = new Set(['doing', 'done', 'oneself', 'oneselves']);
/* 不规则动词 / 常见变形 → 统一词干。
 * 中小学教材高频的那批必须齐，否则 tell a lie vs told a lie、fall down vs fell down 会判成「AI 幻觉」被丢掉。 */
const IRREG = {
  go: 'go', goes: 'go', went: 'go', gone: 'go',
  do: 'do', does: 'do', did: 'do', done: 'do',
  have: 'have', has: 'have', had: 'have',
  be: 'be', am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be',
  tell: 'tell', told: 'tell', say: 'say', said: 'say',
  fall: 'fall', fell: 'fall', fallen: 'fall', feel: 'feel', felt: 'feel',
  take: 'take', took: 'take', taken: 'take', shake: 'shake', shook: 'shake',
  come: 'come', came: 'come', run: 'run', ran: 'run',
  see: 'see', saw: 'see', seen: 'see', 'saw': 'see',
  make: 'make', made: 'make', get: 'get', got: 'get', gotten: 'get',
  give: 'give', gave: 'give', given: 'give', forgive: 'forgive', forgave: 'forgive',
  eat: 'eat', ate: 'eat', drink: 'drink', drank: 'drink', drunk: 'drink',
  sing: 'sing', sang: 'sing', sung: 'sing', ring: 'ring', rang: 'ring', rung: 'ring',
  begin: 'begin', began: 'begin', begun: 'begin', swim: 'swim', swam: 'swim', swum: 'swim',
  write: 'write', wrote: 'write', written: 'write', ride: 'ride', rode: 'ride', ridden: 'ride',
  drive: 'drive', drove: 'drive', driven: 'drive', rise: 'rise', rose: 'rise',
  speak: 'speak', spoke: 'speak', spoken: 'speak', break: 'break', broke: 'break', broken: 'break',
  choose: 'choose', chose: 'choose', chosen: 'choose', fly: 'fly', flew: 'fly', flown: 'fly',
  know: 'know', knew: 'know', known: 'know', grow: 'grow', grew: 'grow', grown: 'grow',
  throw: 'throw', threw: 'throw', thrown: 'throw', draw: 'draw', drew: 'draw', drawn: 'draw',
  wear: 'wear', wore: 'wear', worn: 'wear', bear: 'bear', bore: 'bear',
  hide: 'hide', hid: 'hide', hidden: 'hide', bite: 'bite', bit: 'bite', bitten: 'bite',
  forget: 'forget', forgot: 'forget', forgotten: 'forget', wake: 'wake', woke: 'wake', woken: 'wake',
  stand: 'stand', stood: 'stand', understand: 'understand', understood: 'understand',
  sit: 'sit', sat: 'sit', sleep: 'sleep', slept: 'sleep', keep: 'keep', kept: 'keep',
  teach: 'teach', taught: 'teach', catch: 'catch', caught: 'catch', buy: 'buy', bought: 'buy',
  bring: 'bring', brought: 'bring', mistake: 'mistake', mistook: 'mistake', mistaken: 'mistake',
  bring: 'bring', brought: 'bring', think: 'think', thought: 'think', fight: 'fight', fought: 'fight',
  read: 'read', put: 'put', cut: 'cut', let: 'let', cost: 'cost', hurt: 'hurt', set: 'set', shut: 'shut',
  build: 'build', built: 'build', send: 'send', sent: 'sent', spend: 'spend', spent: 'spend',
  lend: 'lend', lent: 'lend', lose: 'lose', lost: 'lose', find: 'find', found: 'found',
  hold: 'hold', held: 'hold', hear: 'hear', heard: 'hear', sell: 'sell', sold: 'sell',
  meet: 'meet', met: 'meet', feed: 'feed', fed: 'feed', lead: 'lead', led: 'lead',
  mean: 'mean', meant: 'mean', pay: 'pay', paid: 'pay',
  win: 'win', won: 'win', shine: 'shine', shone: 'shine', shoot: 'shoot', shot: 'shoot',
  blow: 'blow', blew: 'blow', blown: 'blow', freeze: 'freeze', froze: 'freeze',
  steal: 'steal', stole: 'steal', stick: 'stick', stuck: 'stick', strike: 'strike', struck: 'strike',
  deal: 'deal', dealt: 'deal', dig: 'dig', dug: 'dig', hang: 'hang', hung: 'hang',
  leave: 'leave', left: 'leave', smell: 'smell', smelt: 'smell', spell: 'spell', spelt: 'spell',
  learn: 'learn', learnt: 'learn', burn: 'burn', burnt: 'burn', dream: 'dream', dreamt: 'dream',
  spread: 'spread', beat: 'beat', split: 'split', quit: 'quit', upset: 'upset',
  agree: 'agree', agreed: 'agree', agrees: 'agree', proceeding: 'proceed', proceed: 'proceed', preceded: 'precede', precede: 'precede',
  // tie / die / lie 是 -ied / -ying 的特例，走通用规则会错位
  tie: 'tie', tied: 'tie', tying: 'tie', ties: 'tie', die: 'die', died: 'die', dying: 'die', dies: 'die',
  lie: 'lie', lied: 'lie', lying: 'lie', lies: 'lie', lain: 'lie',
  lay: 'lie', laid: 'lie',                            // lie 的过去式 lay 也归一（老的 lay/laid 条目删掉避免打架）
  // 单复数同形 / 以 s 结尾但不是复数的词，别被去 s 规则砍尾
  his: 'his', its: 'its', this: 'this', us: 'us', bus: 'bus', gas: 'gas', yes: 'yes',
  plus: 'plus', minus: 'minus', campus: 'campus', focus: 'focus', virus: 'virus',
  maths: 'maths', physics: 'physics', news: 'news', always: 'always', sometimes: 'sometimes',
  across: 'across', perhaps: 'perhaps', chinese: 'chinese', japanese: 'japanese', else: 'else',
};
/* 以 e 结尾但不是该类规则的词（多以虚词/数词为主），词干里保留 e 避免互相撞成一团 */
const KEEP_E = new Set(['one', 'none', 'some', 'same', 'the', 'she', 'he', 'we', 'me', 'be',
  'here', 'there', 'where', 'more', 'before', 'whose', 'mine', 'nine', 'fine', 'eye', 'bye']);
/** 去哑音 e：manage / managed → manag，like / liked → lik（两边同一套规则，动词变形就能对齐） */
function finishStem(x, raw) {
  let s = x;
  // 双写尾辅音收敛：stopped / stopping → stopp → stop，才能和原形 stop 对齐（同理 tell 与 told）
  s = s.replace(/([b-df-hj-np-tv-z])\1$/, '$1');
  if (!KEEP_E.has(s) && /e$/.test(s) && s.length >= 3 && !/(ee|oe|ye)$/.test(s)) s = s.slice(0, -1);
  return s.length >= 2 ? s : (raw || x);
}
/** 单词 → 粗略词干（只要「短语词干」和「句子词干」两边算法一致即可，不需严格语言学） */
function wordStem(t) {
  if (IRREG[t]) return finishStem(IRREG[t], IRREG[t]);
  let x = t.replace(/ies$/, 'y');                                  // studies → study
  if (x !== t) return finishStem(x, x);
  if (/[^aeiou]ied$/.test(t)) return finishStem(t.replace(/ied$/, 'y'), t);  // tried → try
  x = t.replace(/(ss|sh|ch|x|o)es$/, '$1').replace(/([^s])s$/, '$1');       // boxes → box, books → book
  // eed 结尾不剥 ed/ing：succeed / need / bleed 这些词本身就以 -eed 结尾，剥了就跟它们的过去式错开
  x = x.replace(/(ing|ed)$/, (m) => (x.length - m.length >= 2 && !/eed$/.test(x) ? '' : m));
  return finishStem(x, t);
}
/* 代词/助动词缩写 → 双词干：he's → [he, be]；don't → [do, not]（Tom's 这类所有格会退化成 [tom, be]，够用） */
const CONTRACT = {
  "it's": ['it', 'be'], "i'm": ['i', 'be'], "let's": ['let', 'us'], "that's": ['that', 'be'],
  "he's": ['he', 'be'], "she's": ['she', 'be'], "there's": ['there', 'be'], "what's": ['what', 'be'],
  "who's": ['who', 'be'], "where's": ['where', 'be'], "how's": ['how', 'be'], "here's": ['here', 'be'],
  "don't": ['do', 'not'], "doesn't": ['do', 'not'], "didn't": ['do', 'not'], "can't": ['can', 'not'],
  "isn't": ['be', 'not'], "aren't": ['be', 'not'], "wasn't": ['be', 'not'], "won't": ['will', 'not'],
  "i've": ['i', 'have'], "you're": ['you', 'be'], "we're": ['we', 'be'], "they're": ['they', 'be'],
  "i'll": ['i', 'will'], "he'll": ['he', 'will'], "she'll": ['she', 'will'], "we'll": ['we', 'will'],
  "you'll": ['you', 'will'], "they'll": ['they', 'will'], "it'll": ['it', 'will'],
};
/** 一个 token（小写） → 若干词干 */
function tokenStems(low) {
  const t = String(low || '').toLowerCase().replace(/[^a-z']/g, '');
  if (!t) return [];
  if (CONTRACT[t]) return CONTRACT[t].slice();
  const map = { s: 'be', ll: 'will', t: 'not', ve: 'have', d: 'would', re: 'be', m: 'be' };
  const parts = t.split("'").filter(Boolean);
  if (parts.length > 1) {
    const out = parts.slice(0, 1).map(wordStem);
    parts.slice(1).forEach((p) => { if (map[p]) out.push(map[p]); });
    return out;
  }
  return [wordStem(t)];
}
/** 短语 → 匹配模式：[{t:'good'} | {wild:true, max:n}]，占位符 ... / sth / sb 视作通配 */
function phrasePattern(phrase) {
  return String(phrase || '').toLowerCase()
    .replace(/\.{2,}|…/g, ' \u0001 ')            // 先把 "..." / "…" 保护起来（否则会被当成标点清掉）
    .replace(/[.!?,;:"()]/g, ' ').split(/\s+/)
    .map((s) => s.trim()).filter(Boolean)
    .flatMap((raw) => {
      const t = raw.replace(/[^a-z'.]/g, '');
      if (!t) return raw.includes('\u0001') ? [{ wild: true, max: 4 }] : [];
      if (t.includes('\u0001') || /^\.+$/.test(t)) return [{ wild: true, max: 4 }];
      // one's / sb's / someone's / oneself 这类占位：句中换成 my/your/himself...，按 1 个通配处理
      if (/^(one|sb|sth|someone|somebody|anyone|everyone|nobody|oneself|oneselves)('s|s)?$/.test(t)) return [{ wild: true, max: 1 }];
      if (DOING_TOKENS.has(t)) return [{ wild: true, max: 2 }];   // doing 在句里会换成具体动词-ing
      if (WILD_TOKENS.has(t)) return [{ wild: true, max: 2 }];
      return tokenStems(t).map((w) => ({ t: w }));
    })
    // "to do sth" 里的 do 是动作占位（manage to finish / too young to go），不是真动词
    .map((it, i, arr) => (it.t === 'do' && i > 0 && arr[i - 1].t === 'to' ? { wild: true, max: 2 } : it));
}
/**
 * 在例句里找出「这条短语」对应的原文片段。
 * @returns {string} 要挖空的原文片段（如 "am good at" / "It's time to"），找不到返回 ''
 */
function matchPhraseInSent(sentence, phrase) {
  const sent = String(sentence || '');
  const pat = phrasePattern(phrase);
  const real = pat.filter((p) => !p.wild);
  if (!real.length) return '';
  // 1) 先试最省事的原样包含（绝大多数短语命中这条路）
  const lowSent = sent.toLowerCase(), lowPhr = String(phrase || '').trim().toLowerCase();
  if (lowPhr && lowSent.includes(lowPhr) && !/[.]{2,}|…/.test(String(phrase))) {
    return sent.slice(lowSent.indexOf(lowPhr), lowSent.indexOf(lowPhr) + lowPhr.length);
  }
  // 2) 柔性对齐：把句子 token 展开成词干流，每段记住它属于第几个原 token
  const re = /[A-Za-z][A-Za-z']*/g;
  const toks = [];
  let m;
  while ((m = re.exec(sent))) toks.push({ start: m.index, end: m.index + m[0].length, low: m[0].toLowerCase() });
  const flat = [];                                  // [{stem, ti}] ti = 原 token 下标
  toks.forEach((tk, i) => tokenStems(tk.low).forEach((s) => flat.push({ s, ti: i })));
  const GAP_MAX = 2;                                // 相邻实词之间最多容忍插几个词（her homework / them down）
  // 打分：挖空的词数越接近「短语本身的词数」越好（并列时取更短的），避免出现过宽或过窄的挖空
  const want = String(phrase || '').trim().split(/\s+/).filter(Boolean).length || 1;
  let best = null, bestScore = 1e9, bestSpan = 1e9;
  const take = (startTi, endTi) => {
    const blank = sent.slice(toks[startTi].start, toks[endTi].end);
    if (!blank) return;
    const span = endTi - startTi + 1;
    const score = Math.abs(span - want);
    if (score < bestScore || (score === bestScore && span < bestSpan)) { best = blank; bestScore = score; bestSpan = span; }
  };
  for (let i = 0; i < flat.length; i++) {
    const memo = new Set();
    let budget = 4000;                              // 防指数爆炸兜底
    // 首个实词必须与起点严格对齐，否则会把主语 She / We 也吞进挖空里
    (function dfs(p, j, startTi, endTi) {
      if (budget-- < 0) return;
      if (p >= pat.length) { take(startTi, endTi); return; }
      const key = p + ':' + j + ':' + endTi;
      if (memo.has(key)) return;
      memo.add(key);
      const it = pat[p];
      if (it.wild) {
        const lim = it.max || 4;
        for (let skip = 0; skip <= lim; skip++) {
          if (j + skip > flat.length) break;
          // 只吃 1 个词的占位（one's / oneself / sb）本身就是短语的一部分，要把这个词算进挖空；
          // max≥2 的通配（... / doing sth）不扩展，否则会把宾语整串吃掉
          let eT = endTi;
          // 只吃 1 个词、且这个词紧贴当前尾部的占位（one's / oneself / sb）才算进挖空
          if (skip === 1 && it.max === 1 && j < flat.length && flat[j].ti === endTi + 1) eT = flat[j].ti;
          dfs(p + 1, j + skip, startTi, eT);
        }
        return;
      }
      // 实词：本位置命中，或跳过 1~GAP_MAX 个 token 后命中（p===0 时不允许跳，保证起点对齐）
      for (let g = 0; g <= (p === 0 ? 0 : GAP_MAX); g++) {
        const k = j + g;
        if (k >= flat.length) break;
        if (flat[k].s === it.t) dfs(p + 1, k + 1, startTi, Math.max(endTi, flat[k].ti));
      }
    })(0, i, flat[i].ti, flat[i].ti);
  }
  return best || '';
}

function cleanStructure(raw) {
  if (!Array.isArray(raw)) return '';
  const items = raw
    .map((it) => ({ role: STX_ROLES.includes(String(it && it.role || '').trim()) ? String(it.role).trim() : '其他', text: String(it && it.text || '').trim().slice(0, 40) }))
    .filter((it) => it.text)
    .slice(0, 8);
  return items.length >= 2 ? JSON.stringify(items) : '';
}
/** 解析 structure 列为对象数组（坏数据返回 []） */
function parseStructure(s) {
  try { const stx = String(s || '') ? JSON.parse(s) : null; return Array.isArray(stx) ? stx : []; } catch (e) { return []; }
}
/** 为一条短语生成例句+结构拆解并写缓存（prefill 与单条查询共用）。
 *  2026-10-29：例句改为优先「译林版（牛津译林）2024 新版教材该册该单元课文里的真实原句」；
 *  短语在句中允许按人称/时态自然变形（如 be good at → am good at），带 ... / sth 的模板短语也照常处理，
 *  用 matchPhraseInSent 定位句中真正要挖空的片段（blank）。
 *  @returns {{sentence,cn,structure,blank}|null} */
async function genPhraseSentence(bookId, word, meaning, unit, saveCache = true) {
  const aiLib = require('./ai');
  const cfg = aiLib.getConfig();
  if (cfg.mock || !cfg.hasKey) return null;
  const book = db.prepare('SELECT grade, stage, title FROM word_books WHERE id=?').get(bookId) || {};
  const stageTxt = book.stage === 'junior' ? '初中' : '小学';
  const gradeTxt = String(book.grade || '').trim() || (String(book.title || '').match(/[三四五六七八九]年级[上下]册/) || [''])[0];
  const unitTxt = String(unit || '').trim();
  const sys = `你是资深的 K12 英语教研员，熟悉译林版（牛津译林）2024 新版小学/初中英语教材的课文内容，擅长句子成分分析。只输出 JSON 本身，不要 markdown 代码块、不要任何解释。`;
  const user = `我要为短语「${word}」${meaning ? `（中文释义：${meaning}）` : ''}配一句例句，用于${gradeTxt || stageTxt}${unitTxt ? ` ${unitTxt}` : ''}的短语默写练习。
要求：
1. 优先给出译林版（牛津译林）2024 新版《英语》${gradeTxt || stageTxt}（${stageTxt}）${unitTxt ? `${unitTxt} ` : ''}课文原文里真实出现过的、含有这个短语的句子（Story time / Cartoon time / Sound time 等板块的原句）；
   回忆不起教材原句时，再自创一句同难度、同单元话题的句子，不要留空、不要解释想不起来。
2. 句子不超过 15 个单词；短语在句里可以按人称、时态自然变形（如 be good at 写成 am good at / is good at），短语核心词必须齐全。
3. 再做句子成分拆解：把整个句子按顺序切成 2~6 个成分段，每段标注语法角色，role 只能取：主语、谓语、系动词、表语、宾语、定语、状语、补语；text 必须是句子里的连续原文片段，所有片段按顺序拼起来恰好等于整句（不含结尾句号也可以）。
输出 JSON：{"sentence":"例句原文","cn":"整句的中文翻译","structure":[{"role":"主语","text":"We"},{"role":"谓语","text":"play"}]}`;
  const askOnce = async (extra) => {
    const { text } = await aiLib.chat({ system: sys, user: user + (extra || ''), maxTokens: 500, temperature: 0.3 });
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
    const body = fence ? fence[1] : String(text || '');
    const a = body.indexOf('{'), b2 = body.lastIndexOf('}');
    if (a < 0 || b2 <= a) return null;
    try { return JSON.parse(body.slice(a, b2 + 1)) || null; } catch (e) { return null; }
  };
  let j = await askOnce('');
  let sentence = String((j && j.sentence) || '').trim().slice(0, 300);
  let cn = String((j && j.cn) || '').trim().slice(0, 300);
  // 柔性校验：短语（或其自然变形）必须真的在句里，否则丢弃防幻觉
  let blank = matchPhraseInSent(sentence, word);
  if (!blank) {
    // 再要一次，并把「短语核心词必须出现在句里」这条说得更硬，模板型短语给出具体写法示范
    const again = await askOnce(`\n\n注意：上一句里没有完整出现短语「${word}」的核心词，判定不通过。
请重新输出一句，严格要求：
- 短语「${word}」的每个实词都必须出现在句子里，只允许人称、时态变形（如 am/is/are/was、take→took、fall→fell）；
- 短语里的 ... 、sb、sth、one's 等占位部分换成具体内容（如 my / his / apples / to go home）；
- 短语不要拆开，不要用别的近义短语替换（例如 "succeed at" 不能写成 "succeed in"，"have an influence on" 不能写成 "influence"）。`);
    if (again) {
      const s2 = String(again.sentence || '').trim().slice(0, 300);
      const bl2 = matchPhraseInSent(s2, word);
      if (bl2) { j = again; sentence = s2; cn = String(again.cn || '').trim().slice(0, 300); blank = bl2; }
    }
  }
  if (!sentence || !blank) return null;
  const structure = cleanStructure(j.structure);
  if (saveCache) {
    try {
      db.prepare('INSERT INTO phrase_sentences (word, book_id, grade, sentence, cn, structure, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(word, bookId, gradeTxt, sentence, cn, structure, now());
    } catch (e) { /* 缓存写失败不影响返回 */ }
  }
  return { sentence, cn, structure: parseStructure(structure), blank };
}
/** 例句（可能已有缓存/后台例句）的句子结构缺失时，只向 AI 要一次成分拆解（返回 JSON 字符串，失败 ''） */
async function aiStructureOf(sentence, gradeTxt, unitTxt) {
  const aiLib = require('./ai');
  const cfg = aiLib.getConfig();
  if (cfg.mock || !cfg.hasKey) return '';
  return aiStructure(aiLib, sentence);
}

stu.get('/phrase-sentence', async (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  const word = String(req.query.word || '').trim().toLowerCase().slice(0, 100);
  const meaning = String(req.query.meaning || '').trim().slice(0, 200);
  if (!word) return fail(res, '缺少 word');
  try {
    const aiLib = require('./ai');
    const cfg = aiLib.getConfig();
    const aiOn = !cfg.mock && cfg.hasKey;
    // ① 优先用老师在后台短语库里指定（或 AI 补齐）的例句——教材原句，最可控
    if (bookId) {
      const pr = db.prepare('SELECT example, example_cn, example_stx FROM word_phrases WHERE book_id=? AND lower(phrase)=? LIMIT 1').get(bookId, word);
      if (pr && String(pr.example || '').trim()) {
        let stx = parseStructure(pr.example_stx);
        if (!stx.length && aiOn) {
          try {
            const s = await aiStructure(aiLib, String(pr.example).trim());
            if (s) { db.prepare('UPDATE word_phrases SET example_stx=? WHERE book_id=? AND lower(phrase)=?').run(s, bookId, word); stx = parseStructure(s); }
          } catch (e) { /* 补齐失败不影响返回 */ }
        }
        const example = String(pr.example).trim();
        return ok(res, {
          sentence: example, cn: String(pr.example_cn || ''), structure: stx,
          blank: matchPhraseInSent(example, word), source: 'book',
        });
      }
    }
    // ② 其次用 AI 例句缓存（同短语全校复用）
    const hit = db.prepare('SELECT sentence, cn, structure FROM phrase_sentences WHERE word=? ORDER BY id DESC LIMIT 1').get(word);
    if (hit) {
      // 老缓存没有结构拆解 → 补一次 AI 拆解并回写，下次起全校复用
      if (!String(hit.structure || '') && aiOn) {
        try {
          const s = await aiStructure(aiLib, hit.sentence);
          if (s) { db.prepare('UPDATE phrase_sentences SET structure=? WHERE word=?').run(s, word); hit.structure = s; }
        } catch (e) { /* 补齐失败不影响返回 */ }
      }
      return ok(res, {
        sentence: hit.sentence, cn: hit.cn, structure: parseStructure(hit.structure),
        blank: matchPhraseInSent(hit.sentence, word), source: 'cache',
      });
    }
    // ③ 都没有 → 现问 AI（按本书/本单元生成译林版课文风格的例句）
    const row = bookId ? db.prepare('SELECT unit FROM word_phrases WHERE book_id=? AND lower(phrase)=? LIMIT 1').get(bookId, word) : null;
    const made = await genPhraseSentence(bookId, word, meaning, row ? row.unit : '');
    ok(res, made ? Object.assign(made, { source: 'ai' }) : null);
  } catch (e) { ok(res, null); }
});

/** 后台预生成：把一本短语词书里还没缓存例句的短语全部提前生成好（顺序慢速跑，避免打爆 AI 配额）。
 *  学生端进入短语速记时调用一次即可，之后语境填空全程命中缓存零等待。同一本书同时只跑一个任务。 */
const prefillRunning = new Set();
stu.get('/phrase-prefill', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  if (!bookId) return fail(res, '缺少 book_id');
  if (prefillRunning.has(bookId)) return ok(res, { started: false, reason: 'running' });
  const aiLib = require('./ai');
  const cfg = aiLib.getConfig();
  if (cfg.mock || !cfg.hasKey) return ok(res, { started: false, reason: 'no-ai' });
  // 后台例句已指定（IFNULL(example,'')<>''）的短语不用再生成；连同每条短语的单元一起传给 AI
  const rows = db.prepare(`SELECT lower(p.phrase) AS w, MIN(IFNULL(p.unit,'')) AS unit FROM word_phrases p
    WHERE p.book_id=? AND IFNULL(p.phrase,'')<>'' AND IFNULL(p.example,'')=''
    AND NOT EXISTS (SELECT 1 FROM phrase_sentences ps WHERE ps.word=lower(p.phrase))
    GROUP BY lower(p.phrase) LIMIT 80`).all(bookId);
  if (!rows.length) return ok(res, { started: false, reason: 'done' });
  prefillRunning.add(bookId);
  ok(res, { started: true, pending: rows.length });
  // 响应已发出，后台慢慢生成
  (async () => {
    const meanMap = {};
    db.prepare('SELECT lower(phrase) w, meaning FROM word_phrases WHERE book_id=?').all(bookId)
      .forEach((r) => { if (!meanMap[r.w] && r.meaning) meanMap[r.w] = r.meaning; });
    for (const r of rows) {
      try { await genPhraseSentence(bookId, r.w, meanMap[r.w] || '', r.unit || ''); } catch (e) { /* 单条失败跳过 */ }
    }
    prefillRunning.delete(bookId);
  })();
});

/** 只做句子成分拆解（给没有 structure 的老缓存补齐用）：返回规范化后的 JSON 字符串，失败返回 '' */
async function aiStructure(aiLib, sentence) {
  const sys = '你是资深的 K12 英语教研员，擅长句子成分分析。只输出 JSON 本身，不要 markdown 代码块、不要任何解释。';
  const user = `对下面这个英语句子做成分拆解：把整句按顺序切成 2~6 个成分段，每段标注语法角色，role 只能取：主语、谓语、系动词、表语、宾语、定语、状语、补语；text 必须是句子里的连续原文片段，所有片段按顺序拼起来恰好等于整句。
句子：「${sentence}」
输出 JSON：{"structure":[{"role":"主语","text":"We"},{"role":"谓语","text":"play"}]}`;
  const { text } = await aiLib.chat({ system: sys, user, maxTokens: 300, temperature: 0.2 });
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text || ''));
  const body = fence ? fence[1] : String(text || '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return '';
  let j = {};
  try { j = JSON.parse(body.slice(a, b + 1)) || {}; } catch (e) { return ''; }
  return cleanStructure(j.structure);
}

/** 学生自己的训练统计（按词书 + 模块） */
stu.get('/stats', (req, res) => {
  const bookId = Number(req.query.book_id) || 0;
  const sid = req.user.id;
  const rows = bookId
    ? db.prepare('SELECT module, correct, COUNT(*) AS n FROM word_records WHERE student_id=? AND book_id=? GROUP BY module, correct').all(sid, bookId)
    : db.prepare('SELECT module, correct, COUNT(*) AS n FROM word_records WHERE student_id=? GROUP BY module, correct').all(sid);
  const stats = {};
  for (const m of ['quick', 'phrase', 'pos', 'context', 'build', 'listen', 'syllabus']) stats[m] = { correct: 0, wrong: 0 };
  rows.forEach((r) => { if (stats[r.module]) stats[r.module][r.correct ? 'correct' : 'wrong'] += r.n; });
  ok(res, stats);
});

/** 记录一次作答：{ module, bookId, wordId?, correct } */
stu.post('/record', (req, res) => {
  const b = req.body || {};
  const module = String(b.module || '');
  if (!['quick', 'phrase', 'pos', 'context', 'build', 'listen', 'syllabus'].includes(module)) return fail(res, '未知模块');
  db.prepare('INSERT INTO word_records (student_id, book_id, word_id, module, correct, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, Number(b.bookId) || null, Number(b.wordId) || null, module, b.correct ? 1 : 0, now());
  ok(res, null);
});

/** 分组完成上报：速记四步流全部做完（分组变绿）时调用，供后台「学生学习进度」展示 */
stu.post('/group-done', (req, res) => {
  const b = req.body || {};
  const module = b.module === 'syllabus' ? 'syllabus' : 'quick';
  if (!Number(b.bookId)) return fail(res, '缺少 bookId');
  db.prepare(`INSERT OR REPLACE INTO word_group_done (student_id, book_id, module, unit, gi, size, n, fp, done_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, Number(b.bookId), module, String(b.unit || ''), Number(b.gi) || 0,
      Number(b.size) || 0, Number(b.n) || 0, String(b.fp || ''), now());
  ok(res, null);
});

/* ============================================================ 后台：学生学习进度 */
/**
 * GET /api/admin/word/progress?branch=all|none|<分校用户id>
 * 校长可看全部学生并按校区筛选；分校账号只能看自己开通的学生。
 * 返回每个学生：学生管理里的基础字段 + 各模块作答统计 + 每本词书的训练情况 + 分组完成明细。
 */
const WT_MODULES = ['quick', 'phrase', 'pos', 'context', 'build', 'listen', 'syllabus'];
const WT_MODULE_LABEL = { quick: '单词速记', phrase: '短语速记', pos: '词性训练', context: '课文朗读', build: '连词成句', listen: '听音拼句', syllabus: '考纲单词' };

admin.get('/progress', (req, res) => {
  const isPrincipal = req.user.role === 'admin';
  const branchSel = String(req.query.branch || 'all');

  // 学生 + 开通人（分校）信息
  let rows = db.prepare(`
    SELECT s.id, s.username, s.name, s.grade, s.stage, s.term, s.status, s.allow_speed, s.expire_at, s.last_login, s.created_at,
      c.id AS creator_id, c.name AS creator_name, c.role AS creator_role
    FROM users s LEFT JOIN users c ON s.created_by = c.id
    WHERE s.role = 'student' ORDER BY s.id DESC`).all();
  if (!isPrincipal) {
    rows = rows.filter((r) => r.creator_id === req.user.id);           // 分校：只看自己开通的学生
  } else if (branchSel === 'none') {
    rows = rows.filter((r) => !r.creator_id || r.creator_role === 'admin');  // 总校：校长/系统开通
  } else if (branchSel !== 'all') {
    rows = rows.filter((r) => r.creator_id === Number(branchSel));     // 指定分校
  }

  const books = db.prepare('SELECT id, title, kind FROM word_books').all();
  const bookName = new Map(books.map((b) => [b.id, b]));

  // 作答统计：学生 × 词书 × 模块
  const recs = db.prepare('SELECT student_id, book_id, module, correct, created_at FROM word_records').all();
  const byStudent = new Map();
  const touch = (sid) => {
    if (!byStudent.has(sid)) byStudent.set(sid, { modules: {}, books: new Map(), last_at: '' });
    return byStudent.get(sid);
  };
  for (const r of recs) {
    const st = touch(r.student_id);
    const m = st.modules[r.module] || (st.modules[r.module] = { n: 0, correct: 0 });
    m.n++; if (r.correct) m.correct++;
    if (r.created_at > st.last_at) st.last_at = r.created_at;
    if (r.book_id) {
      const bk = st.books.get(r.book_id) || (st.books.set(r.book_id, { book_id: r.book_id, title: (bookName.get(r.book_id) || {}).title || '已删除词书', kind: (bookName.get(r.book_id) || {}).kind || '', modules: {}, last_at: '' }), st.books.get(r.book_id));
      const bm = bk.modules[r.module] || (bk.modules[r.module] = { n: 0, correct: 0 });
      bm.n++; if (r.correct) bm.correct++;
      if (r.created_at > bk.last_at) bk.last_at = r.created_at;
    }
  }

  // 分组完成明细
  const groupRows = db.prepare(`SELECT g.student_id, g.book_id, g.module, g.unit, g.gi, g.size, g.n, g.done_at
    FROM word_group_done g ORDER BY g.book_id, g.module, g.gi`).all();
  const groupsBy = new Map();
  for (const g of groupRows) {
    if (!groupsBy.has(g.student_id)) groupsBy.set(g.student_id, []);
    groupsBy.get(g.student_id).push(g);
  }

  const list = rows.map((s) => {
    const agg = byStudent.get(s.id);
    const modules = {};
    for (const m of WT_MODULES) modules[m] = (agg && agg.modules[m]) || { n: 0, correct: 0 };
    const bookList = agg ? [...agg.books.values()].sort((a, b) => (b.last_at || '').localeCompare(a.last_at || '')) : [];
    const groups = (groupsBy.get(s.id) || []).map((g) => ({ ...g, book_title: (bookName.get(g.book_id) || {}).title || '已删除词书' }));
    return {
      ...s,
      creator: s.creator_name || (s.creator_id ? '管理员' : '总校'),
      branch: s.creator_role === 'branch' ? (s.creator_name || '分校') : '总校',
      modules, books: bookList, groups,
      group_done: groups.length,
      last_at: (agg && agg.last_at) || '',
    };
  });
  ok(res, { list, modules: WT_MODULES, moduleLabels: WT_MODULE_LABEL });
});

module.exports = { admin, stu };
