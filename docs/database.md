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

- 知识树只在 `bank_trees` / `bank_tree_nodes` 里编辑（`kind`=textbook 章节树 / knowledge 知识点树，**每个 学段+学科 每种 kind 一棵**，题库管理页按这个假设取第一棵；R2 起改为每个版本一棵，见文末「R2」一节）。题目与节点多对多：`question_nodes`。
- `kb_units` / `kb_points`（旧教材知识点树）保留表，不再写入。`src/kbtree.js` 把它们**复制**进该 学科+学段 已有的知识点树，作为一个一级分支：`教材单元知识点` → 年级（空则"不分年级"）→ 单元 → 知识点；该 学科+学段 没有知识点树时新建一棵（`source` 形如 `kbtree:物理:primary`）。同父同名不重复建，只增不删。
- 旧表 `questions.point` 仍是知识点**名称文本**，和树节点是两套关联；按节点关联用 `question_nodes`。
- 迁移：`node scripts/migrate-kb-to-trees.js [--dry-run]`（先测试库预演）；旧接口 `/kbtree*` 首次用到、旧表有数据且尚未复制时会自动复制该 学科+学段。

## T6 习题正确率：没有加表

正确率从现有表聚合：`records`（user_id, question_id, is_correct, created_at，每次作答一行）× `questions.video_id`（题目绑定的视频）× `videos.section_id`（视频所属小分组）。口径：每题取该学生**最近一次**作答（`records.id` 最大的那行），小分组 / 课程是把下面所有视频的题合并后再算。`practices`、`paper_tries` 只存整次交卷的汇总，不含每题明细，所以没用它们。没有新增 `question_attempts`（任务书允许"必须时才加"）：`records` 已经是每次作答的明细。

## T2 AI 配置中心：`mf_model_profiles` 加一列

`mf_model_profiles.format VARCHAR(16) DEFAULT 'openai'`（`openai` / `anthropic` / `gemini`），在 `mfcollect.js` 的 `ensureSchema` 里幂等 `ALTER TABLE … ADD COLUMN`（已存在则忽略），旧档案自动按 OpenAI 兼容处理，不受影响。密钥 `api_key` 仍明文存储（与现状一致）。`settings` 表里的 `aiBaseUrl / aiModel / aiApiKey / aiMock` 不再被读取，没有删除。

## T10 试卷管理：`mf_papers` 加一列

`mf_papers.year VARCHAR(8) DEFAULT ''`（4 位年份，如 `2024`；真题试卷用，学生端试卷库按年份搜索），在 `src/db.js` 里幂等 `ALTER TABLE … ADD COLUMN`。题目的 `questions.year` 本来就有，上传真题试卷时也一并写入。

`mf_papers.exam_category VARCHAR(16) DEFAULT ''` 保存单元 / 期中 / 期末 / 真题类型，用于学生端筛选；与 `paper_type` 的统一卷 / 一人一卷区分。旧卷保持未分类，由老师补充。

`mf_recog_runs.edition`、`term` 和 `material_type` 保存 Excel、Word 规则导入及拍照／PDF 录题时选择的版本、册别及资料类型，旧批次留空。导入题目节点仍需人工审核确认。
`mf_papers.edition VARCHAR(80)` 和 `mf_papers.term VARCHAR(16)` 保存试卷教材版本、册别，旧卷默认为空；这两个字段本身不会自动给试题挂分类。

## T7 听力题：`questions` 加一列

`questions.audio_key VARCHAR(255) DEFAULT ''`（听力音频的存储 key，目录前缀 `bank/audio/`，空串 = 没有音频），在 `src/db.js` 里幂等 `ALTER TABLE … ADD COLUMN`。题型不新增：音频是现有题型（单选 / 多选 / 判断 / 填空…）上附加的"听力材料"。

`questions.audio_play_limit INTEGER DEFAULT 0` 记录每次练习的音频播放次数，0 为不限制，1–5 为限定次数。后台编辑及待审核入库保留这个设置；学生端在当前练习内执行，刷新或重新开始练习会重置。

`questions.question_subtype VARCHAR(50) DEFAULT ''` 是英语单题细分分类编码，和用于学生作答判分的 `type` 分开存储；分类仅允许与基础题型匹配的英语题。组合小题等未实现的题型不能靠分类字段替代。

`questions.match_prompts MEDIUMTEXT` 保存听力匹配题和数学连线题左侧项目的 JSON 数组；右侧候选项使用 `options`，正确答案按左侧顺序保存右侧序号。`listen_match` 支持 2–7 项一对一匹配；`math_match` 支持左右各 2–7 项、数量不同，右侧选项可被多个左项使用。基础题型仍为 `sort`；一个左项连接多个右项以及多对多尚不支持。

`records.match_correct`、`records.match_total` 记录当次连线正确项数与总项数，历史记录和非连线题为空。`paper_tries.score`、`mf_paper_tries.score` 为 `DECIMAL(10,2)`，连线题的每题部分得分及逐项结果保存在对应作答的 `detail`；待人工评分试卷在评分完成后据原明细重新汇总。

`subjective_responses` 单独保存计算题、问答题及书面表达的学生作答和提交上下文，不写入客观题对错记录。新增 `try_id`、`max_score`、`score`、`review_comment`、`reviewed_by`、`reviewed_at` 保存单次交卷关联与人工评分；旧记录没有 `try_id` 时保留为未关联历史。含未评分题的 `paper_tries` / `mf_paper_tries` 以 `score=NULL` 表示无最终成绩，`detail` 保存各客观题分值和主观题单次作答；全部主观题评分后写入该次卷面总分，原有非空成绩记录维持原语义。

`subjective_responses.drawing_data MEDIUMTEXT` 专门保存有界 PNG 作图，不放入试卷 `detail` 或题目响应。服务端限定单张解码后文件不超过 384 KiB、宽高不超过 1600×1200、总像素不超过 160 万，并校验 PNG 结构、校验和及解压长度；学生本人和有权查看该学生的老师通过专用接口读取。

## R2 目录树的教材版本：`bank_trees` / `bank_tree_nodes` 加列、`settings` 加一个 key

- `bank_trees.edition VARCHAR(40) DEFAULT ''`：教材版本（苏教版 / 苏科版 / 译林版 / 沪教版 …）。**同一 学段+学科+种类 下每个版本一棵树**（取代 T4 的"每个 学段+学科 每种 kind 一棵"）；知识点树可为空 = 通用。索引 `idx_btree_ed (subject, stage, edition)`（不含 kind：`subject/stage/kind` 三个 VARCHAR(255) 已占满 MySQL 3072 字节的键长，放不下第四列）。
- `bank_tree_nodes.code VARCHAR(100) DEFAULT ''`（外部编号，如洋葱 / 组卷网节点 id）、`bank_tree_nodes.note MEDIUMTEXT`（备注）：树导入导出（`docs/tree-import-format.md`）带上，页面暂不显示。
- 都在 `src/db.js` 幂等 `ALTER TABLE … ADD COLUMN`。种子章节树启动时按学段补版本并改正树名（`src/mfseed.js`，幂等；`source` 标识不变）：数学小学=苏教版（树名原来误写成「苏科版数学·教材章节」）、数学初中=苏科版、英语=译林版。
- `settings.default_editions`（JSON）：默认版本表 `{ 学科: { 学段: 版本 } }`，默认 数学 小学苏教版 / 初中苏科版，英语 译林版，物理 初中苏科版，化学 初中沪教版；启动时没有才写，后台可改（`PUT /mf/editions`）。取树时没指定版本就按它选，见 `src/treepick.js`。

## R8 小分组挂题、视频关联知识点：`questions` 加一列 + 新表 `video_nodes`（2026-11-04）

- `questions.section_id INTEGER DEFAULT NULL`（索引 `idx_q_section`）：题目直接挂到课程目录下的「小分组」（`sections.id`）。和 `video_id` **二选一**：绑到视频时清掉 `section_id`，挂到小分组时清掉 `video_id`；挂小分组时 `chapter_id` 同时写成小分组所属课程。删小分组 / 删课程时把挂在上面的题 `section_id` 置空（题目保留在题库）。
- `video_nodes(video_id INTEGER, node_id INTEGER, PRIMARY KEY(video_id,node_id))`（索引 `idx_vnode_node`）：视频关联的知识点树节点（`bank_tree_nodes.id`，多选）。学生端视频卡显示成知识点标签；统计某个知识点的掌握情况时，绑在「关联了该知识点的视频」上的题自动算进来（**不写 `question_nodes`**，见 D31）。删视频时一并删掉它的 `video_nodes`。
- 两者都在 `src/db.js` 里幂等建：`ALTER TABLE … ADD COLUMN` + `CREATE TABLE IF NOT EXISTS`，只加不删。
- 正确率口径（`src/accuracy.js`）：小分组 = 组内视频的题 + 小分组自己的题合并后再算；课程 = 全部视频的题 + 全部小分组自己的题。新增 `sectionOwnStats`（按 `section_id` 聚合）、`lastAnswers`（一组题各自最近一次作答），仍然只读 `records`，不新增作答表。

## 二轮整改进行中的数据结构

- `bank_tree_node_mappings` 保存章节节点与知识点节点的多对多映射，删除节点时级联清除映射。
- `papers.question_scores` 保存逐题分值 JSON；`papers.due_at` 保存截止时间。旧试卷保留原有平均分计算。
- `questions.difficulty_score_10` 为可空整数，仅保存明确提供或经老师确认的 1–10 难度；原 `difficulty` 仍为 1–5 星，十级值存在时对应 `ceil(difficulty_score_10 / 2)`。旧题不回填十级值；旧接口改动星级时会清除不再可靠的十级值。
- `paper_uploads.draft_json` 保存手机上传题目的审核草稿，新上传在审核通过前不创建正式题目；历史已入库记录仍兼容。
- 试卷识别批次的题卡保存回挂试卷和顺序信息，课文习题批次保存回挂视频信息；待审核通过时才写入正式题库。
- `questions.ai_review_metadata` 为可空 JSON 文本，记录题目入库前老师采纳 AI 答案、解析的字段、确认人和时间，或旧版 AI 补全题卡的核对确认；旧题不回填。AI 未采纳建议仅保存在待审核批次题卡中，不写入正式题目。
- 网络采集批次的题项和学生扫码 `draft_json` 同样保存 `ai_answer_suggestion` 与老师逐项确认记录；题目入库时保留确认记录。历史已入库扫码题在老师确认后写入题目及其确认元数据。
