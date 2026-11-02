# 数据库说明

数据库为 MySQL（库名 `xuexi`）。建表语句在 `src/db.js`，约 48 张表；本文按用途分组，字段细节以 `db.js` 为准，改表时补充。

## 表分组

| 分组 | 表 | 用途 |
|---|---|---|
| 账号与组织 | `users`、`classes` | 校长/分校/学生账号；班级（年级） |
| 课程内容 | `chapters`、`sections`、`handouts`、`videos`、`guides` | 课程目录、分级小节、讲义与习题（`kind`=handout/exercise，`video_id` 关联知识点）、视频、使用说明 |
| 学习记录 | `records`、`practices`、`mistakes`、`progress` | 学习/练习记录、错题、知识点学习进度 |
| 旧版题库 | `questions` | 题目主表（新旧题库共用） |
| 智能题库 | `papers`、`paper_tries`、`paper_assignments`、`bank_feedback`、`kb_units`、`kb_points`、`paper_uploads` | 组卷（`status`=draft/published）、作答记录、下发、题目反馈、教材知识点树（kb）、纸质错题上传池（`status`=pending/reviewed/approved/rejected） |
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
