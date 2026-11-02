# 数据库说明

数据库为 MySQL（库名 `xuexi`）。建表语句在 `src/db.js`，约 48 张表；本文按用途分组，字段细节以 `db.js` 为准，改表时补充。

## 表分组

| 分组 | 表 | 用途 |
|---|---|---|
| 账号与组织 | `users`、`classes` | 校长/分校/学生账号；班级（年级） |
| 课程内容 | `chapters`、`sections`、`handouts`、`videos`、`guides`（表保留，接口与前端已不存在，不要再依赖） | 课程目录、分级小节、讲义与习题（`kind`=handout/exercise，`video_id` 关联知识点）、视频、使用说明 |
| 学习记录 | `records`、`practices`、`mistakes`、`progress` | 学习/练习记录、错题、知识点学习进度 |
| 旧版题库 | `questions` | 题目主表（新旧题库共用） |
| 智能题库 | `papers`、`paper_tries`、`paper_assignments`、`bank_feedback`、`kb_units`、`kb_points`、`paper_uploads` | 组卷（`status`=draft/published）、作答记录、下发、题目反馈、教材知识点树（kb；**T4 起冻结，只读不写**，内容复制进 `bank_trees` 的知识点树，见下）、纸质错题上传池（`status`=pending/reviewed/approved/rejected） |
| 魔方题库（2026-10-29 并入） | `bank_trees`、`bank_tree_nodes`、`question_nodes`、`question_tags`、`mf_paper_folders`、`mf_papers`、`mf_paper_questions`、`mf_paper_tries`、`mf_capture_batches`、`mf_recog_runs` | 目录树（`bank_trees.kind`=textbook 教材目录 / knowledge 知识点树）、题目与树节点多挂、标签、试卷文件夹、试卷（`status`=basket/composing/done/archived/trashed）、卷内行（`kind`=question/text）、采集批次、录题批次 |
| 错题重组 | `wrong_batches`、`wrong_items`、`wrong_sets` | 一次扫描=一个批次；切出的题目图；勾选生成的错题集 PDF |
| 单词训练 | `word_books`、`words`、`word_sentences`、`word_phrases`、`phrase_sentences`、`word_pos`、`word_records`、`word_group_done` | 词书、词、例句、短语、AI 例句缓存、词性、作答记录、分组完成同步 |
| 语音基础 | `phonics_items`、`phonics_extras` | 字母乐园/音标条目；模块级资源（字母歌、配套资料） |
| AI 与系统 | `settings`、`ai_reports`、`audit_logs` | key-value 配置；AI 学情报告；操作日志 |

## 改表方式

- 只在 `src/db.js` 里用幂等方式加表、加列，SQL 写 SQLite 方言，由 `db.js` 和 `mysql-sync.js` 转换成 MySQL（已支持 `INSERT OR REPLACE/IGNORE`、`ON CONFLICT ... DO UPDATE`、`RANDOM()`、`INTEGER PRIMARY KEY AUTOINCREMENT`）。
- 只加不删：不删表、不删列、不改列类型。
- 需要迁移数据时写幂等脚本放 `scripts/`，先在测试库预演。
- 加表或加列后，在本文件对应分组补一行。

## 知识树约定（T4，没有加表/加列）

- 知识树只在 `bank_trees` / `bank_tree_nodes` 里编辑（`kind`=textbook 章节树 / knowledge 知识点树，**每个 学段+学科 每种 kind 一棵**，题库管理页按这个假设取第一棵）。题目与节点多对多：`question_nodes`。
- `kb_units` / `kb_points`（旧教材知识点树）保留表，不再写入。`src/kbtree.js` 把它们**复制**进该 学科+学段 已有的知识点树，作为一个一级分支：`教材单元知识点` → 年级（空则"不分年级"）→ 单元 → 知识点；该 学科+学段 没有知识点树时新建一棵（`source` 形如 `kbtree:物理:primary`）。同父同名不重复建，只增不删。
- 旧表 `questions.point` 仍是知识点**名称文本**，和树节点是两套关联；按节点关联用 `question_nodes`。
- 迁移：`node scripts/migrate-kb-to-trees.js [--dry-run]`（先测试库预演）；旧接口 `/kbtree*` 首次用到、旧表有数据且尚未复制时会自动复制该 学科+学段。

## T6 习题正确率：没有加表

正确率从现有表聚合：`records`（user_id, question_id, is_correct, created_at，每次作答一行）× `questions.video_id`（题目绑定的视频）× `videos.section_id`（视频所属小分组）。口径：每题取该学生**最近一次**作答（`records.id` 最大的那行），小分组 / 课程是把下面所有视频的题合并后再算。`practices`、`paper_tries` 只存整次交卷的汇总，不含每题明细，所以没用它们。没有新增 `question_attempts`（任务书允许"必须时才加"）：`records` 已经是每次作答的明细。

## T2 AI 配置中心：`mf_model_profiles` 加一列

`mf_model_profiles.format VARCHAR(16) DEFAULT 'openai'`（`openai` / `anthropic` / `gemini`），在 `mfcollect.js` 的 `ensureSchema` 里幂等 `ALTER TABLE … ADD COLUMN`（已存在则忽略），旧档案自动按 OpenAI 兼容处理，不受影响。密钥 `api_key` 仍明文存储（与现状一致）。`settings` 表里的 `aiBaseUrl / aiModel / aiApiKey / aiMock` 不再被读取，没有删除。

## T10 试卷管理：`mf_papers` 加一列

`mf_papers.year VARCHAR(8) DEFAULT ''`（4 位年份，如 `2024`；真题试卷用，学生端试卷库按年份搜索），在 `src/db.js` 里幂等 `ALTER TABLE … ADD COLUMN`。题目的 `questions.year` 本来就有，上传真题试卷时也一并写入。
