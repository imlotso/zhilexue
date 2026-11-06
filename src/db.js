'use strict';
/**
 * 数据库层：MySQL
 * 连接信息读取顺序：环境变量（MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD /
 * MYSQL_DATABASE）→ 本机私密文件 config.local.js（参见 config.local.example.js）。
 * 不再内置任何明文连接信息。
 * 业务代码仍使用 db.prepare().get/all/run（同步接口）。
 * 第一次启动且 MySQL 里还没有用户时，会自动导入 data/xuexi.db。
 */
const path = require('path');
const fs = require('fs');
let _localMysql = {};
try { _localMysql = (require('./config.local').mysql) || {}; } catch (e) { /* 未找到 config.local.js */ }
const { openMysql, splitSql } = require('./mysql-sync');
const { importIfEmpty } = require('./import-sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_INFO = {
  host: process.env.MYSQL_HOST || _localMysql.host || '',
  port: Number(process.env.MYSQL_PORT || _localMysql.port || 3306),
  user: process.env.MYSQL_USER || _localMysql.user || '',
  password: process.env.MYSQL_PASSWORD || _localMysql.password || '',
  database: process.env.MYSQL_DATABASE || _localMysql.database || 'xuexi',
};

const db = openMysql(DB_INFO);

/** 建表语句从原来的 SQLite 写法转成 MySQL */
function toMysqlDdl(sql) {
  let s = String(sql);
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY');
  s = s.replace(/\bINTEGER\b/gi, 'INT');
  s = s.replace(/\bstem TEXT NOT NULL\b/gi, 'stem MEDIUMTEXT NOT NULL');
  s = s.replace(/\boptions TEXT\b/gi, 'options MEDIUMTEXT');
  s = s.replace(/\banswer TEXT NOT NULL\b/gi, 'answer MEDIUMTEXT NOT NULL');
  s = s.replace(/\banalysis TEXT\b/gi, 'analysis MEDIUMTEXT');
  s = s.replace(/\bmy_answer TEXT\b/gi, 'my_answer MEDIUMTEXT');
  s = s.replace(/\blast_answer TEXT\b/gi, 'last_answer MEDIUMTEXT');
  s = s.replace(/\bpaper_keys TEXT\b/gi, 'paper_keys MEDIUMTEXT');
  s = s.replace(/\breport TEXT\b/gi, 'report MEDIUMTEXT');
  s = s.replace(/\berror TEXT\b/gi, 'error MEDIUMTEXT');
  s = s.replace(/\bmeaning TEXT\b/gi, 'meaning MEDIUMTEXT');
  s = s.replace(/\bexample TEXT\b/gi, 'example MEDIUMTEXT');
  s = s.replace(/\btext TEXT NOT NULL\b/gi, 'text MEDIUMTEXT NOT NULL');
  s = s.replace(/\btranslation TEXT\b/gi, 'translation MEDIUMTEXT');
  s = s.replace(/\bitem_ids TEXT\b/gi, 'item_ids MEDIUMTEXT');
  s = s.replace(/\bq_ids TEXT\b/gi, 'q_ids MEDIUMTEXT');
  s = s.replace(/\bdetail TEXT\b/gi, 'detail MEDIUMTEXT');
  s = s.replace(/\bmaterial TEXT\b/gi, 'material MEDIUMTEXT');
  s = s.replace(/\bv TEXT\b/gi, 'v MEDIUMTEXT');
  s = s.replace(/\bfp TEXT\b/gi, 'fp MEDIUMTEXT');
  s = s.replace(/\bsamples TEXT\b/gi, 'samples MEDIUMTEXT');
  s = s.replace(/\bfiles TEXT\b/gi, 'files MEDIUMTEXT');
  s = s.replace(/\burl TEXT\b/gi, 'url VARCHAR(1024)');
  s = s.replace(/\bTEXT\b/g, 'VARCHAR(255)');
  // MySQL 里 TEXT / MEDIUMTEXT 的默认值必须写成表达式：DEFAULT ('')
  s = s.replace(/\b(MEDIUMTEXT(?:\s+NOT\s+NULL)?)\s+DEFAULT\s+'([^']*)'/gi, "$1 DEFAULT ('$2')");
  s = s.replace(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE UNIQUE INDEX');
  s = s.replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE INDEX');
  return s;
}

const rawExec = db.exec.bind(db);
db.exec = (sql) => rawExec(toMysqlDdl(sql));

function isDupIndex(stmt, err) {
  if (!err || (err.code !== 'ER_DUP_KEYNAME' && err.errno !== 1061)) return false;
  return /^\s*(?:--[^\n]*\n\s*)*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(stmt);
}

function runSchema(sql) {
  for (const stmt of splitSql(sql)) {
    try { db.exec(stmt); }
    catch (e) {
      if (isDupIndex(stmt, e)) continue;
      e.message = (e.message || '建表失败') + ' ← ' + stmt.replace(/\s+/g, ' ').slice(0, 180);
      throw e;
    }
  }
}


runSchema(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT 'student',
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  stage TEXT DEFAULT '',                     -- 学段：primary 小学 / junior 初中（决定专项提升、中考冲刺能看到哪些课）
  term TEXT DEFAULT '',                      -- 册别：上册 / 下册 / '' = 不限（上下册都能看）
  subject TEXT DEFAULT '',
  class_id INTEGER DEFAULT NULL,
  level TEXT DEFAULT 'basic',
  status INTEGER NOT NULL DEFAULT 1,
  allow_speed INTEGER NOT NULL DEFAULT 1,
  allow_seek INTEGER NOT NULL DEFAULT 1,
  avatar TEXT DEFAULT '',
  expire_at TEXT DEFAULT NULL,
  last_login TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL DEFAULT '数学',
  grade TEXT NOT NULL DEFAULT '',
  term TEXT DEFAULT '',                    -- 册别：上册 / 下册 / '' = 通用（上下册都能看）
  book TEXT DEFAULT '',
  name TEXT NOT NULL,
  code TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  category TEXT DEFAULT '',                -- 课程分类：同步基础 / 同步培优 / 专项提升 / 中考冲刺
  stage TEXT DEFAULT '',                   -- 学段：primary 小学 / junior 初中 / '' 不限
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER DEFAULT NULL,
  subject TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'single',
  stem TEXT NOT NULL,
  options TEXT DEFAULT '[]',
  answer TEXT NOT NULL DEFAULT '',
  analysis TEXT DEFAULT '',
  difficulty INTEGER DEFAULT 3,
  difficulty_score_10 INTEGER DEFAULT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 分级目录：章节（课程目录）下可选的第四级分组，用来把知识点与资料分小节
-- 例如「第一章 有理数」→「1.1 正数与负数」「1.2 数轴与相反数」
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 资料表：kind = handout 讲义（一个知识点配一份）/ exercise 习题（挂在章节上的习题库）
--          video_id = 该讲义对应的知识点（视频），实现「一个视频对应一个讲义」
--          section_id = 归属的分级目录（可为空 = 不分组）
CREATE TABLE IF NOT EXISTS handouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER DEFAULT NULL,
  video_id INTEGER DEFAULT NULL,
  section_id INTEGER DEFAULT NULL,
  kind TEXT NOT NULL DEFAULT 'handout',
  subject TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  level TEXT DEFAULT 'basic',
  download_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER DEFAULT NULL,
  section_id INTEGER DEFAULT NULL,
  subject TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  title TEXT NOT NULL,
  file_path TEXT DEFAULT '',
  url TEXT DEFAULT '',
  duration INTEGER DEFAULT 0,
  level TEXT DEFAULT 'basic',
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  chapter_id INTEGER DEFAULT NULL,
  my_answer TEXT DEFAULT '',
  is_correct INTEGER NOT NULL DEFAULT 0,
  match_correct INTEGER DEFAULT NULL,
  match_total INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chapter_id INTEGER DEFAULT NULL,
  total INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  wrong_count INTEGER DEFAULT 1,
  last_answer TEXT DEFAULT '',
  resolved INTEGER DEFAULT 0,
  review_stage INTEGER DEFAULT 0,          -- 错题复习：连续答对次数（3 = 已掌握）
  next_review TEXT DEFAULT '',             -- 下次应复习日期（YYYY-MM-DD，空 = 立即可复习）
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, question_id)
);

-- 学习进度：一条记录 = 一个学生的某个「知识点」（视频）学到什么程度
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL,
  subject TEXT DEFAULT '',
  category TEXT DEFAULT '',
  video_done INTEGER NOT NULL DEFAULT 0,
  handout_done INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, video_id)
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- 错题重组：一次扫描 = 一个批次（wrong_batches），批次下是切出来的题目图（wrong_items），
-- 勾选任意题目可生成错题集 PDF（wrong_sets）。
CREATE TABLE IF NOT EXISTS wrong_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  subject TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wrong_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  w INTEGER DEFAULT 0,
  h INTEGER DEFAULT 0,
  size INTEGER DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wrong_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  column_count INTEGER NOT NULL DEFAULT 2,
  show_index INTEGER NOT NULL DEFAULT 1,
  item_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  item_ids TEXT DEFAULT '[]',
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wi_batch ON wrong_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_wi_sel ON wrong_items(selected);

CREATE TABLE IF NOT EXISTS guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'video',      -- video 使用说明视频 / doc 使用说明文档
  file_key TEXT NOT NULL,                  -- 存储层 key（视频走 guides/，文档走 guidedocs/）
  file_name TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 0,              -- 视频时长（秒，前端探测后回填，可为 0）
  sort INTEGER NOT NULL DEFAULT 0,         -- 越小越靠前
  visible INTEGER NOT NULL DEFAULT 1,      -- 1 学生端可见 / 0 隐藏
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                     -- 报告标题（默认「某某同学 学情诊断报告」）
  student TEXT DEFAULT '',                 -- 学生姓名（打印在封面）
  subject TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  paper_keys TEXT DEFAULT '[]',            -- 试卷照片 key 数组（JSON）
  status TEXT NOT NULL DEFAULT 'pending',  -- pending 排队/分析中 | done 完成 | failed 失败
  model TEXT DEFAULT '',                   -- 用的模型名（便于追溯）
  report TEXT DEFAULT '',                  -- 分析结果 JSON（结构见 src/ai.js 顶部）
  error TEXT DEFAULT '',                   -- 失败原因
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                     -- 词书名（如：人教八下英语单词）
  grade TEXT DEFAULT '',                   -- 年级（便于筛选，可空）
  kind TEXT DEFAULT 'word',                -- 词书类型：word 单词书 / pos 词形转换书 / sent 句子书（各模块只用自己的书）
  sort INTEGER DEFAULT 0,                  -- 显示顺序，越小越靠前；0 表示未设置，排在已编号的后面
  remark TEXT DEFAULT '',                  -- 备注
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  unit TEXT DEFAULT '',                    -- 单元（如 Unit 1 / 1单元，可空）
  word TEXT NOT NULL,                      -- 单词
  phonetic TEXT DEFAULT '',                -- 音标
  pos TEXT DEFAULT '',                     -- 词性（n. / v. / adj. / adv. …）
  meaning TEXT DEFAULT '',                 -- 中文释义
  example TEXT DEFAULT '',                 -- 例句（可空）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  unit TEXT DEFAULT '',
  text TEXT NOT NULL,                      -- 英文句子（连词成句 / 课文朗读都用它）
  translation TEXT DEFAULT '',             -- 中文翻译（课文朗读里做提示）
  grp TEXT DEFAULT '',                     -- 课文分组（选填：如 大课文 / 小课文，单元下再细分方便学生选择）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_phrases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  unit TEXT DEFAULT '',
  phrase TEXT NOT NULL,                    -- 英文短语（如 look after），短语速记模块专用
  meaning TEXT DEFAULT '',                 -- 中文释义（连连看配对 / 默写提示）
  created_at TEXT NOT NULL
);

-- 语境填空的 AI 例句缓存（短语 → 同年级课本风格例句 + 中文翻译，AI 生成一次全校复用）
CREATE TABLE IF NOT EXISTS phrase_sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,                      -- 短语（小写归一，作为缓存键）
  book_id INTEGER DEFAULT NULL,            -- 生成时所用词书（记录年级语境）
  grade TEXT DEFAULT '',                   -- 生成时的年级文本（如 五年级上册）
  sentence TEXT NOT NULL,                  -- 英文例句（短语原样出现）
  cn TEXT DEFAULT '',                      -- 例句中文翻译
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_pos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  unit TEXT DEFAULT '',
  base_word TEXT NOT NULL,                 -- 基础词（如 repeat）
  target_word TEXT NOT NULL,               -- 派生词（如 repetition）
  target_pos TEXT NOT NULL,                -- 目标词性（名词/动词/形容词/副词，也支持 比较级/最高级/复数/过去式/同义词/反义词 等关系）
  base_pos TEXT DEFAULT '',                -- 原词词性（如 v. / adj.，背诵卡展示用）
  base_meaning TEXT DEFAULT '',            -- 原词译（如 care → 关心；在意）
  meaning TEXT DEFAULT '',                 -- 目标词中文释义（如 小心的）
  affix TEXT DEFAULT '',                   -- 词缀说明（如 repeat + -tion）
  created_at TEXT NOT NULL
);

-- 学生在四个训练里每一次作答（module: quick 单词速记 / pos 词性训练 / context 语境记忆 / build 连词成句）
CREATE TABLE IF NOT EXISTS word_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  book_id INTEGER DEFAULT NULL,
  word_id INTEGER DEFAULT NULL,            -- 词性训练/连词成句按句算时可为空
  module TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,      -- 1 对 / 0 错
  created_at TEXT NOT NULL
);

-- 分组完成同步表：学生端四个练习全做完（分组变绿）时上报，
-- 后台「学生学习进度」靠它显示每个学生 每本词书/每个模块 哪些分组已完成。
-- module: quick 单词/短语速记四步流 / syllabus 考纲单词；fp = 组内单词 id 指纹（考纲重新筛选后分组会重排）
CREATE TABLE IF NOT EXISTS word_group_done (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  module TEXT NOT NULL DEFAULT 'quick',
  unit TEXT DEFAULT '',
  gi INTEGER DEFAULT 0,                    -- 分组序号（从 0 开始）
  size INTEGER DEFAULT 0,                  -- 每组词数（5 / 10）
  n INTEGER DEFAULT 0,                     -- 该组实际词数
  fp TEXT DEFAULT '',                      -- 组内单词 id 指纹（考纲模块用）
  done_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_w_grp_uniq ON word_group_done(student_id, book_id, module, unit, gi);

CREATE INDEX IF NOT EXISTS idx_q_chapter ON questions(chapter_id);

-- 语音基础（字母乐园 / 音标训练）：条目内容由管理端「训练管理 → 词书管理」里维护
CREATE TABLE IF NOT EXISTS phonics_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'letters',    -- letters 字母乐园 / phonetic 音标训练
  code TEXT DEFAULT '',                    -- 字母 a~z；音标 key（i: / ae …）
  title TEXT DEFAULT '',                   -- 显示符号：Aa / /iː/
  type TEXT DEFAULT '',                    -- letter / vowel / consonant
  grp TEXT DEFAULT '',                     -- 音标分区（front / mid / back …）
  group_name TEXT DEFAULT '',              -- 分区中文名（前元音 …）
  sub TEXT DEFAULT '',                     -- 单元音 / 双元音 …
  len TEXT DEFAULT '',                     -- 长元音 / 短元音
  cue TEXT DEFAULT '',                     -- 拟音（咦—）
  mnemonic TEXT DEFAULT '',                -- 记忆口诀
  emoji TEXT DEFAULT '',
  tip TEXT DEFAULT '',                     -- 发音要领
  spell TEXT DEFAULT '',                   -- 常见拼写（ee · ea …）
  audio TEXT DEFAULT '',                   -- 发音音频 key / url
  stroke TEXT DEFAULT '',                  -- 字母笔顺 gif key / url
  video_mouth TEXT DEFAULT '',             -- 口型视频 key
  video_teach TEXT DEFAULT '',             -- 教学视频 key
  samples TEXT DEFAULT '[]',               -- JSON：[{w,ipa,zh,hl}] 示范词
  files TEXT DEFAULT '[]',                 -- JSON：[{title,key}] 讲义资料
  sort INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT ''
);

-- 语音基础 · 模块级资源：字母歌视频(k=song，单条) / 配套资料(k=material，多条)
CREATE TABLE IF NOT EXISTS phonics_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL DEFAULT 'letters',  -- 所属模块（预留音标训练扩展）
  k TEXT NOT NULL,                         -- song / material
  title TEXT DEFAULT '',                   -- 名称（资料名 / ABC字母歌）
  file TEXT DEFAULT '',                    -- 文件 key / url
  size INTEGER DEFAULT 0,                  -- 字节数
  mime TEXT DEFAULT '',                    -- 文件类型
  created_at TEXT DEFAULT ''
);

-- 智能组卷：试卷（q_ids = 题目 id JSON 数组；status = draft 草稿 / published 已下发）
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  term TEXT DEFAULT '',
  duration INTEGER DEFAULT 90,
  total_score INTEGER DEFAULT 100,
  q_ids TEXT DEFAULT '[]',
  question_scores TEXT DEFAULT '',
  question_partial_scores TEXT DEFAULT '',
  due_at TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT DEFAULT NULL
);

-- 试卷作答记录（每个学生每次交卷一条，detail = 每题作答明细 JSON）
CREATE TABLE IF NOT EXISTS paper_tries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  paper_id INTEGER NOT NULL,
  total INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  score DECIMAL(10,2) DEFAULT 0,
  detail TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pt_user ON paper_tries(user_id, paper_id);
CREATE INDEX IF NOT EXISTS idx_pp_status ON papers(status);

-- 试卷下发：老师组卷后单选/多选指定学生下发，学生端「我的任务」按此展示
CREATE TABLE IF NOT EXISTS paper_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  assigned_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passign_user ON paper_assignments(user_id, paper_id);
CREATE INDEX IF NOT EXISTS idx_passign_paper ON paper_assignments(paper_id);

-- 试卷库（mf 试卷管理发布的卷子）作答记录
CREATE TABLE IF NOT EXISTS mf_paper_tries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  paper_id INTEGER NOT NULL,
  total INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  score DECIMAL(10,2) DEFAULT 0,
  detail TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfpt_user ON mf_paper_tries(user_id, paper_id);

-- 题目反馈记录（学生端做完题反馈题目问题 → 管理端「错题反馈记录」核对处理）
CREATE TABLE IF NOT EXISTS bank_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  my_answer TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf_user ON bank_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_bf_question ON bank_feedback(question_id);
CREATE INDEX IF NOT EXISTS idx_bf_status ON bank_feedback(status);

-- 教材知识点树：单元（教材版本 + 学段 + 学科 + 年级 → 单元）
CREATE TABLE IF NOT EXISTS kb_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  edition TEXT DEFAULT '',
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kbu_combo ON kb_units(subject, stage, grade);

-- 教材知识点树：单元下的知识点
CREATE TABLE IF NOT EXISTS kb_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kbp_unit ON kb_points(unit_id);

-- ===== 魔方题库（2026-10-29 并入）：目录树 / 标签 / 采集批次 / 试卷 / 录题批次 =====
-- 目录树：kind = textbook 教材目录 / knowledge 知识点树。一份树下面无限层级节点。
CREATE TABLE IF NOT EXISTS bank_trees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'textbook',      -- textbook 教材目录 / knowledge 知识点树
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  name TEXT NOT NULL,
  source TEXT DEFAULT '',            -- 来源标注：manual / capture:zujuan / capture:jyeoo
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_btree_sub ON bank_trees(subject, stage, kind);

CREATE TABLE IF NOT EXISTS bank_tree_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree_id INTEGER NOT NULL,
  parent_id INTEGER DEFAULT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bnode_tree ON bank_tree_nodes(tree_id, parent_id, sort);
CREATE INDEX IF NOT EXISTS idx_bnode_parent ON bank_tree_nodes(parent_id);

-- 章节节点与知识点节点映射；删除节点时清除相关映射，不影响题目。
CREATE TABLE IF NOT EXISTS bank_tree_node_mappings (
  chapter_node_id INTEGER NOT NULL,
  knowledge_node_id INTEGER NOT NULL,
  PRIMARY KEY (chapter_node_id, knowledge_node_id),
  FOREIGN KEY (chapter_node_id) REFERENCES bank_tree_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_node_id) REFERENCES bank_tree_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tree_mapping_knowledge ON bank_tree_node_mappings(knowledge_node_id);

-- 题目 ↔ 树节点（多挂：一题可同时属于「教材 4.2 等差数列」和「知识点 数列求和」）
CREATE TABLE IF NOT EXISTS question_nodes (
  question_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY (question_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_qnode_node ON question_nodes(node_id);

-- 题目标签（AI 建议 / 批量打标 / 手动）
CREATE TABLE IF NOT EXISTS question_tags (
  question_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (question_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_qtag_tag ON question_tags(tag);

-- 试卷文件夹（只有一层父子关系即可，按 sort 排序）
CREATE TABLE IF NOT EXISTS mf_paper_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 试卷 / 试题篮：status = basket 篮(草稿) / composing 排版中 / done 定稿 / archived 归档 / trashed 回收站
CREATE TABLE IF NOT EXISTS mf_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  status TEXT DEFAULT 'basket',
  paper_type TEXT DEFAULT 'uniform',   -- uniform 统一卷 / custom-mistake 一人一卷
  layout_json MEDIUMTEXT,              -- 排版配置（纸张/分栏/字号/页边距/卷头/显隐/选项版式/作答区）
  folder_id INTEGER DEFAULT NULL,
  trashed_from TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfp_status ON mf_papers(status);
CREATE INDEX IF NOT EXISTS idx_mfp_folder ON mf_papers(folder_id);

-- 卷内行：kind = question 题目 / text 文本块（大标题，如「一、选择题」，不占题号）
CREATE TABLE IF NOT EXISTS mf_paper_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL,
  question_id INTEGER DEFAULT NULL,
  position INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  partial_score REAL DEFAULT NULL,        -- 多选少选且全对时的固定分；NULL 表示未配置
  frozen INTEGER DEFAULT 0,
  layout_json TEXT,                    -- 题级排版覆盖（不写 DEFAULT ''，否则适配层会降成 varchar 截断）
  kind TEXT DEFAULT 'question',
  text_body TEXT,
  style TEXT DEFAULT '',
  text_align TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfpq_paper ON mf_paper_questions(paper_id, position);

-- 采集批次（网络采集的暂存区，等价于「本地试题篮」）：payload 存解析出来的题目 JSON
CREATE TABLE IF NOT EXISTS mf_capture_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  site TEXT DEFAULT '',
  url TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  payload MEDIUMTEXT,                  -- JSON 数组：解析出的题目
  status TEXT DEFAULT 'pending',      -- pending 待入库 / done 已入库
  created_at TEXT NOT NULL
);

-- 录题批次：一次拍照/传 PDF = 一个 run，drafts 存 AI 识别出的题卡 JSON
CREATE TABLE IF NOT EXISTS mf_recog_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  source_kind TEXT DEFAULT 'image',    -- image 图片 / pdf PDF
  source_name TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',         -- draft 待识别 / done 已识别入库 / error
  pages MEDIUMTEXT,                    -- JSON 数组：页图 {key,url,w,h}
  drafts MEDIUMTEXT,                  -- JSON 数组：题卡
  ocr_texts MEDIUMTEXT,                -- JSON 数组：半自动 OCR 按页转写全文
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

-- 纸质错题上传池：学生微信扫码拍照上传 → 老师在题库管理里核对 → 入库进 questions 并同步进学生错题本
-- status: pending 待审核 / reviewed 已核对（待一键导入）/ approved 已入库 / rejected 已拒绝
CREATE TABLE IF NOT EXISTS paper_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  point TEXT DEFAULT '',
  note TEXT DEFAULT '',
  images MEDIUMTEXT DEFAULT '[]',          -- JSON 数组，存 /pu/xxx.jpg 相对路径
  draft_json MEDIUMTEXT,                  -- 审核前的题干、选项和解析
  status TEXT DEFAULT 'pending',
  review_note TEXT DEFAULT '',
  question_id INTEGER DEFAULT 0,
  reviewed_by INTEGER DEFAULT 0,
  reviewed_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pu_user ON paper_uploads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pu_status ON paper_uploads(status);

-- 操作日志：所有角色的登录（成功/失败）+ 后台增删改操作；仅总后台可查
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT NULL,
  username TEXT DEFAULT '',
  name TEXT DEFAULT '',
  role TEXT DEFAULT '',
  action TEXT DEFAULT '',
  module TEXT DEFAULT '',
  method TEXT DEFAULT '',
  path TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  ok INTEGER DEFAULT 1,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_user ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_q ON records(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_ho_chapter ON handouts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_vi_chapter ON videos(chapter_id);
CREATE INDEX IF NOT EXISTS idx_pg_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_pg_chapter ON progress(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_sec_chapter ON sections(chapter_id);
CREATE INDEX IF NOT EXISTS idx_w_words_book ON words(book_id);
CREATE INDEX IF NOT EXISTS idx_w_sent_book ON word_sentences(book_id);
CREATE INDEX IF NOT EXISTS idx_w_pos_book ON word_pos(book_id);
CREATE INDEX IF NOT EXISTS idx_w_rec_user ON word_records(student_id);
CREATE INDEX IF NOT EXISTS idx_w_rec_book ON word_records(student_id, book_id);
`);

// ---- 智能题库（2026-10）：题目表扩展，支持 完形填空/阅读理解原文、知识点、来源、年份、绑定知识点视频 ----
// 注意：这批加列必须放在建表（runSchema）之后；空库初始化时表是刚建出来的，靠它补齐列，并且依赖这些列的索引要在它之后再建
try { db.exec("ALTER TABLE questions ADD COLUMN stage TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE papers ADD COLUMN question_scores MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE papers ADD COLUMN question_partial_scores MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE mf_paper_questions ADD COLUMN partial_score REAL DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE records ADD COLUMN match_correct INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE records ADD COLUMN match_total INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
for (const table of ['paper_tries', 'mf_paper_tries']) {
  const column = db.prepare('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?').get(DB_INFO.database, table, 'score');
  if (column && String(column.DATA_TYPE || column.data_type).toLowerCase() !== 'decimal') db.exec(`ALTER TABLE ${table} MODIFY COLUMN score DECIMAL(10,2) DEFAULT 0`);
}
try { db.exec("ALTER TABLE papers ADD COLUMN due_at VARCHAR(30) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE paper_uploads ADD COLUMN draft_json MEDIUMTEXT'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN point TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN material MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN source TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN year TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN video_id INTEGER DEFAULT NULL"); } catch (e) { /* 列已存在 */ }
// 十级难度仅保存明确提供的精确值；历史五星题保留 NULL。
try { db.exec('ALTER TABLE questions ADD COLUMN difficulty_score_10 INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN images MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
// 录题批次：半自动 OCR 转写全文（按页存 JSON 数组）
try { db.exec('ALTER TABLE mf_recog_runs ADD COLUMN ocr_texts MEDIUMTEXT'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mf_recog_runs ADD COLUMN edition VARCHAR(80) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mf_recog_runs ADD COLUMN term VARCHAR(24) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mf_recog_runs ADD COLUMN material_type VARCHAR(24) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 错题复习（艾宾浩斯简化版）字段
try { db.exec("ALTER TABLE mistakes ADD COLUMN review_stage INTEGER DEFAULT 0"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mistakes ADD COLUMN next_review TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 薄弱知识点：AI 自动识别的错题知识点（题目本身 point 为空时由 AI 归类，存在错题维度）
try { db.exec("ALTER TABLE mistakes ADD COLUMN ai_point TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 纸质上传扩展字段：题干文字描述 / 学生写的答案 / 错误类型 / 所属章节
try { db.exec("ALTER TABLE paper_uploads ADD COLUMN stem_text TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE paper_uploads ADD COLUMN answer TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE paper_uploads ADD COLUMN error_type TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE paper_uploads ADD COLUMN chapter TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库列宽修复：这几列内容可能超过 VARCHAR(255)，扩成 MEDIUMTEXT（SQLite 无此语法，失败即忽略）
try { db.exec("ALTER TABLE word_group_done MODIFY fp MEDIUMTEXT"); } catch (e) { /* 忽略 */ }
try { db.exec("ALTER TABLE phonics_items MODIFY samples MEDIUMTEXT"); } catch (e) { /* 忽略 */ }
try { db.exec("ALTER TABLE phonics_items MODIFY files MEDIUMTEXT"); } catch (e) { /* 忽略 */ }

// 目录树的教材版本（R2）：同一 学段+学科+种类 下每个版本一棵树；知识点树可为空 = 通用。节点的 code（外部编号）/ note（备注）供树导入导出带上
try { db.exec("ALTER TABLE bank_trees ADD COLUMN edition VARCHAR(40) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE bank_tree_nodes ADD COLUMN code VARCHAR(100) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE bank_tree_nodes ADD COLUMN note MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }

// 依赖上面 ALTER 才存在的列的索引：必须在加列之后建（空库初始化时 questions 表刚建出来，还没有 video_id / stage 列）
runSchema(`
CREATE INDEX IF NOT EXISTS idx_q_video ON questions(video_id);
CREATE INDEX IF NOT EXISTS idx_q_bank ON questions(subject, stage, grade);
-- (subject, stage, kind) 三列已经占满 MySQL 3072 字节的键长，加上 edition 放不下，所以版本索引不含 kind
CREATE INDEX IF NOT EXISTS idx_btree_ed ON bank_trees(subject, stage, edition);
`);

// 老库升级：记录学生账号由哪个校长/分校开通（已存在则跳过）
try { db.exec('ALTER TABLE users ADD COLUMN created_by INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
// 老库升级：课程分类（同步基础/同步培优/专项提升/中考冲刺 等 4 大类）
try { db.exec("ALTER TABLE chapters ADD COLUMN category TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：单个学生是否允许视频倍速播放（1 允许 / 0 禁止）
try { db.exec('ALTER TABLE users ADD COLUMN allow_speed INTEGER NOT NULL DEFAULT 1'); } catch (e) { /* 列已存在 */ }
// 老库升级：单个学生是否允许视频快进（拖动进度条 / 向前跳转，1 允许 / 0 禁止）
try { db.exec('ALTER TABLE users ADD COLUMN allow_seek INTEGER NOT NULL DEFAULT 1'); } catch (e) { /* 列已存在 */ }
// 老库升级：学生头像图片路径（创建学生时随机分配，如 /img/av/p1.jpg）
try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：分校账号可开通的学生人数上限（0 = 不限制；expire_at 复用学生到期时间列做分校到期）
try { db.exec('ALTER TABLE users ADD COLUMN max_students INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }
// 老库升级：分校固定编号（开通后永不变；改名称 / 换登录手机号都不影响编号与已绑定学生）
try { db.exec("ALTER TABLE users ADD COLUMN code TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try {
  const brs = db.prepare("SELECT id, code FROM users WHERE role='branch'").all();
  let next = brs.reduce((m, r) => Math.max(m, /^\d+$/.test(r.code || '') ? Number(r.code) : 0), 0);
  for (const r of brs.sort((a, b) => a.id - b.id)) {
    if (!r.code) { next += 1; db.prepare('UPDATE users SET code=? WHERE id=?').run(String(next).padStart(3, '0'), r.id); }
  }
} catch (e) { /* 表还没建好时跳过 */ }
// 老库升级：讲义挂到具体知识点（视频）上
try { db.exec('ALTER TABLE handouts ADD COLUMN video_id INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
// 老库升级：资料类型 handout 讲义 / exercise 习题
try { db.exec("ALTER TABLE handouts ADD COLUMN kind TEXT NOT NULL DEFAULT 'handout'"); } catch (e) { /* 列已存在 */ }
// 老库升级：视频归属的分级目录（章节下的第四级，可为空）
try { db.exec('ALTER TABLE videos ADD COLUMN section_id INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
// 老库升级：讲义 / 习题归属的分级目录
try { db.exec('ALTER TABLE handouts ADD COLUMN section_id INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE word_sentences ADD COLUMN grp TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：学生账号的册别（上册 / 下册 / 空 = 不限）
try { db.exec("ALTER TABLE users ADD COLUMN term TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：课程目录（章节）的册别（上册 / 下册 / 空 = 通用）
try { db.exec("ALTER TABLE chapters ADD COLUMN term TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：学段（primary 小学 / junior 初中 / 空 = 不限）。决定「专项提升 / 中考冲刺」能看到哪些课
try { db.exec("ALTER TABLE chapters ADD COLUMN stage TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN stage TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老库升级：词性库补「原词词性 / 目标词释义」两列（词形转换链：care (v.) → careful (adj.) 小心的）
try { db.exec("ALTER TABLE word_pos ADD COLUMN base_pos TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE word_pos ADD COLUMN meaning TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE word_pos ADD COLUMN base_meaning TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 老数据没填原词译时，按原词补一份教材释义（只填空的，不覆盖老师已经写过的）
try {
  const baseMean = require('./pos-base-mean');
  const fillBaseMean = db.prepare("UPDATE word_pos SET base_meaning=? WHERE lower(base_word)=? AND IFNULL(base_meaning,'')=''");
  for (const [word, mean] of Object.entries(baseMean)) fillBaseMean.run(mean, word);
} catch (e) { /* 表还没建好时跳过 */ }
// 老库升级：魔方题库并入（2026-10-29）——题干富文本（含公式 <span class="math" data-tex> 与图 <figure class="diagram">）、
// 来源类型（local 本地 / capture 网络采集 / recog 录题）、来源明细 JSON（site/url/questionId/bankid 等，用于去重与回溯）
for (const ddl of [
  'ALTER TABLE questions ADD COLUMN stem_html MEDIUMTEXT',
  "ALTER TABLE questions ADD COLUMN source_type TEXT DEFAULT 'local'",
  'ALTER TABLE questions ADD COLUMN source_detail MEDIUMTEXT',
  "ALTER TABLE questions ADD COLUMN subject_tag TEXT DEFAULT ''",
]) { try { db.exec(ddl); } catch (e) { /* 列已存在 */ } }

// 老库升级：词书加「类型」列（word 单词书 / pos 词形转换书 / sent 句子书），学生端各模块只看自己类型的书
try { db.exec("ALTER TABLE word_books ADD COLUMN kind TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE word_books ADD COLUMN sort INTEGER DEFAULT 0"); } catch (e) { /* 列已存在 */ }
// 老词书按已有数据自动归类：只有词性题 → 词形转换书；只有句子 → 句子书；其余 → 单词书
db.exec(`UPDATE word_books SET kind='pos'  WHERE IFNULL(kind,'')='' AND NOT EXISTS(SELECT 1 FROM words w WHERE w.book_id=word_books.id) AND EXISTS(SELECT 1 FROM word_pos p WHERE p.book_id=word_books.id)`);
db.exec(`UPDATE word_books SET kind='sent' WHERE IFNULL(kind,'')='' AND NOT EXISTS(SELECT 1 FROM words w WHERE w.book_id=word_books.id) AND NOT EXISTS(SELECT 1 FROM word_pos p WHERE p.book_id=word_books.id) AND EXISTS(SELECT 1 FROM word_sentences s WHERE s.book_id=word_books.id)`);
db.exec(`UPDATE word_books SET kind='word' WHERE IFNULL(kind,'')=''`);
// 老库升级：语境填空例句缓存加「句子成分拆解」列（JSON 数组 [{"role":"主语","text":"We"},...]，学生端画成分结构图用）。
// 注：不能用 TEXT DEFAULT ''（MySQL 适配层会降成 varchar(255)，长句子 JSON 会被截断），用无默认值的 MEDIUMTEXT。
try { db.exec("ALTER TABLE phrase_sentences ADD COLUMN structure MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE phrase_sentences MODIFY COLUMN structure MEDIUMTEXT"); } catch (e) { /* 忽略 */ }
// 老库升级：短语库加「例句」三列（2026-10-29）——老师可以人工/AI 在后台为每条短语指定译林版教材
// 对应单元的课文原句，语境填空优先用它，不再依赖每次现问 AI。
//   example     英文例句（教材原句，短语可能按人称/时态自然变形，如 be good at → am good at）
//   example_cn  例句中文翻译
//   example_stx 句子成分拆解 JSON（[{"role":"主语","text":"We"},...]，长 JSON 故用 MEDIUMTEXT）
for (const ddl of [
  "ALTER TABLE word_phrases ADD COLUMN example MEDIUMTEXT",
  "ALTER TABLE word_phrases ADD COLUMN example_cn TEXT DEFAULT ''",
  "ALTER TABLE word_phrases ADD COLUMN example_stx MEDIUMTEXT",
]) { try { db.exec(ddl); } catch (e) { /* 列已存在 */ } }
// 老库升级：词书加「学段」列（primary 小学 / junior 初中 / 空 = 未归纳）。
// 存量词书按年级字段 / 书名自动归纳：3-6 年级 → 小学，7-9 年级 → 初中；之后可在管理端编辑里手动调整。
try { db.exec("ALTER TABLE word_books ADD COLUMN stage TEXT DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try {
  const pLike = ['三年级', '四年级', '五年级', '六年级', '3年级', '4年级', '5年级', '6年级']
    .map((g) => `(IFNULL(grade,'') LIKE '%${g}%' OR title LIKE '%${g}%')`).join(' OR ');
  const jLike = ['七年级', '八年级', '九年级', '7年级', '8年级', '9年级']
    .map((g) => `(IFNULL(grade,'') LIKE '%${g}%' OR title LIKE '%${g}%')`).join(' OR ');
  db.exec(`UPDATE word_books SET stage='primary' WHERE IFNULL(stage,'')='' AND (${pLike})`);
  db.exec(`UPDATE word_books SET stage='junior'  WHERE IFNULL(stage,'')='' AND (${jLike})`);
} catch (e) { /* 忽略 */ }
// 老库升级：课程分类统一成 4 大类（同步基础 / 同步培优 / 专项提升 / 中考冲刺）。
// 「专项提升·小学」并入「专项提升」并打上学段=小学；「专项提升·初中」已废弃（由一次性脚本清理）。
try { db.exec("UPDATE chapters SET category='专项提升', stage='primary' WHERE category='专项提升·小学'"); } catch (e) { /* 忽略 */ }
try { db.exec("UPDATE chapters SET category='专项提升' WHERE category IN ('专项提升')"); } catch (e) { /* 忽略 */ }
try { db.exec("UPDATE chapters SET stage='junior' WHERE category='中考冲刺' AND IFNULL(stage,'')=''"); } catch (e) { /* 忽略 */ }
// 按年级补全学段（专项提升章节 / 学生账号）
try {
  db.exec("UPDATE chapters SET stage='primary' WHERE category='专项提升' AND IFNULL(stage,'')='' AND grade IN ('三年级','四年级','五年级','六年级')");
  db.exec("UPDATE chapters SET stage='junior'  WHERE category='专项提升' AND IFNULL(stage,'')='' AND grade IN ('七年级','八年级','九年级','中考冲刺')");
  db.exec("UPDATE users SET stage='primary' WHERE role='student' AND IFNULL(stage,'')='' AND grade IN ('三年级','四年级','五年级','六年级')");
  db.exec("UPDATE users SET stage='junior'  WHERE role='student' AND IFNULL(stage,'')='' AND grade IN ('七年级','八年级','九年级','中考冲刺')");
} catch (e) { /* 忽略 */ }

// 采集批次加「整卷」标记：整卷下载的批次不进试题篮，单独在整卷下载列表里管理
try { db.exec('ALTER TABLE mf_capture_batches ADD COLUMN paper_mode INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }

// 试卷库发布标记：mf 试卷管理里的卷子勾了 published 才进学生端「试卷库」
try { db.exec('ALTER TABLE mf_papers ADD COLUMN published INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }
// T7：听力题——题目挂一段音频（存储 key，目录前缀 bank/audio/；题型不新增，在现有题型上附加听力材料）
try { db.exec("ALTER TABLE questions ADD COLUMN audio_key VARCHAR(255) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 0 表示不限制；正数为一道听力题每次练习允许开始播放的次数。
try { db.exec('ALTER TABLE questions ADD COLUMN audio_play_limit INTEGER DEFAULT 0'); } catch (e) { /* 列已存在 */ }
// 录题结果回执：旧批次保持 NULL；只对新客户端提供的恢复凭据去重。
try { db.exec('ALTER TABLE mf_recog_runs ADD COLUMN intake_request_key VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE mf_recog_runs ADD COLUMN intake_input_hash VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE mf_recog_runs ADD COLUMN intake_result MEDIUMTEXT'); } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX idx_intake_request ON mf_recog_runs(intake_request_key)'); } catch (e) {}
try { db.exec('ALTER TABLE paper_uploads ADD COLUMN intake_request_key VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE paper_uploads ADD COLUMN intake_input_hash VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE paper_uploads ADD COLUMN intake_result MEDIUMTEXT'); } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX idx_upload_request ON paper_uploads(intake_request_key)'); } catch (e) {}
try { db.exec('ALTER TABLE mf_capture_batches ADD COLUMN intake_request_key VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE mf_capture_batches ADD COLUMN intake_input_hash VARCHAR(64) DEFAULT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE mf_capture_batches ADD COLUMN intake_result MEDIUMTEXT'); } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX idx_capture_request ON mf_capture_batches(intake_request_key)'); } catch (e) {}
// 记录经老师逐项确认的 AI 答案/解析来源；原有题目保持空值。
try { db.exec('ALTER TABLE questions ADD COLUMN ai_review_metadata MEDIUMTEXT'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN question_subtype VARCHAR(50) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE questions ADD COLUMN match_prompts MEDIUMTEXT"); } catch (e) { /* 列已存在 */ }
runSchema(`
CREATE TABLE IF NOT EXISTS subjective_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT '',
  paper_id INTEGER DEFAULT NULL,
  my_answer MEDIUMTEXT,
  created_at VARCHAR(32) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subjective_user ON subjective_responses(user_id, id);
`);
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN try_id INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN max_score REAL DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN score REAL DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN review_comment MEDIUMTEXT'); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN reviewed_by INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE subjective_responses ADD COLUMN reviewed_at VARCHAR(32) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE subjective_responses ADD COLUMN drawing_data MEDIUMTEXT'); } catch (e) { /* 列已存在 */ }
// T10：真题试卷的年份（学生端试卷库按名称 / 学科 / 年级 / 年份搜索）
try { db.exec("ALTER TABLE mf_papers ADD COLUMN year VARCHAR(8) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// 卷型与 paper_type（统一卷 / 一人一卷）不同，旧数据不臆测分类。
try { db.exec("ALTER TABLE mf_papers ADD COLUMN exam_category VARCHAR(16) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mf_papers ADD COLUMN edition VARCHAR(80) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
try { db.exec("ALTER TABLE mf_papers ADD COLUMN term VARCHAR(16) DEFAULT ''"); } catch (e) { /* 列已存在 */ }
// R8：题目也能直接挂到课程的「小分组」（sections）上（与 video_id 二选一：绑小分组时清掉 video_id，反之亦然）
try { db.exec('ALTER TABLE questions ADD COLUMN section_id INTEGER DEFAULT NULL'); } catch (e) { /* 列已存在 */ }
// R8：视频 ↔ 知识点树节点（多选）。学生端视频卡显示知识点标签；视频的题在统计该知识点掌握情况时自动算进来（不写 question_nodes）
runSchema(`
CREATE INDEX IF NOT EXISTS idx_q_section ON questions(section_id);
CREATE TABLE IF NOT EXISTS video_nodes (
  video_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  PRIMARY KEY (video_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_vnode_node ON video_nodes(node_id);
`);

// 采集入口与其余录题入口共用可选资料范围。
for (const col of ['edition','term','material_type']) { try { db.exec(`ALTER TABLE mf_capture_batches ADD COLUMN ${col} VARCHAR(80) DEFAULT ''`); } catch (e) {} }

// 老库是空的时，把原来的 SQLite 文件导入 MySQL（只导入一次）
importIfEmpty(db, DATA_DIR);

module.exports = { db, DATA_DIR, UPLOAD_DIR, DB_INFO };
