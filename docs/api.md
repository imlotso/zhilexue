# 接口文档

本文档由 2026-11-02 对 `src/` 路由定义的实际阅读生成，列出挂载前缀和路径。用途一栏只写读代码能确认的；标「待补」的需要开发时补充。新增、修改、删除接口请同步更新（见 AGENTS.md）。

约定：`GET /x` 表示方法和路径；`/:id` 为路径参数。除特别说明外，`/api/admin/*` 需要管理端登录（admin 或 branch），`/api/stu/*` 需要学生登录。

## 挂载总表

| 前缀 | 来源 | 说明 |
|---|---|---|
| `/api` | `app.js` | 登录、当前用户、改密码、文件代理、TTS |
| `/api/admin` | `app.js` | 管理端基础接口（分校、学生、目录、视频、讲义、统计、日志） |
| `/api/stu` | `app.js` | 学生端基础接口 |
| `/api/admin/ai` | `ai.js` router | 只读查询当前生效的 AI 配置、测试当前配置（配置本身在 `/api/admin/bank/mf/ext/profiles`，见下） |
| `/api/admin/wrong` | `wrong.js` | 错题重组 |
| `/api/admin/xreport` | `reports.js` | 学情统计（视频、习题） |
| `/api/admin/report` | `report.js` | AI 学情报告 |
| `/api/report-scan` | `report.js` scan | 扫码上传学情试卷 |
| `/api/admin/word`、`/api/stu/word` | `word.js` | 单词训练 |
| `/api/admin/phonics`、`/api/stu/phonics` | `phonics.js` | 语音基础 |
| `/api/admin/bank`、`/api/stu/bank` | `bank.js` | 智能题库 |
| `/api/up` | `bank.js` up | 手机扫码上传（错题/纸质题） |
| `/api/admin/bank/mf` | `mfbank.js` | 魔方题库 |
| `/api/mfcap` | `mfbank.js` / `mfcollect.js` cap | 采集推送（采集票据鉴权；**带 CORS**：只放行 POST/OPTIONS + `Authorization`/`Content-Type` 头，预检在鉴权前应答，R0-B1） |
| `/api/admin/bank/mf/ext` | `mfcollect.js` | 采集字典、AI 配置 profiles、浏览器代理 |
| `/api/mfproxy` | `mfcollect.js` proxy | 采集代理 |

## 公共（`app.js`）

- `POST /api/login` 登录；`GET /api/me` 当前用户；`POST /api/change-password` 改密码
- `GET /api/file` 文件代理（参数 key、name、inline、token；云存储时 302 到签名链接）。**题图只读票据 `ft`（R0-B9）**：本地存储时 `<img>` 带不了登录头，所以 `/api/admin`、`/api/stu` 的 JSON 响应里凡是 `/api/file?key=bank/…` 的图片地址（png/jpg/jpeg/gif/webp），服务端会补上 `&ft=<过期秒>.<签名>`；`ft` 只对这一个 key 有效、6 小时过期、只对 `bank/` 目录的图片放行，不是登录令牌；没有有效 `ft` 时仍然要登录。题目库里存的地址即使带着旧的 `ft`，读出来时也会换成新的
- `GET /api/speak` TTS 发音（`app.js`，调用 `win-speak.js`）

## 管理端基础（`/api/admin`，`app.js`）

| 资源 | 接口 |
|---|---|
| 分校 | `GET/POST /branches`；`PUT /branches/:id`；`PUT /branches/:id/phone`；`POST /branches/:id/reset-password`；`DELETE /branches/:id` |
| 学生 | `GET/POST /students`；`PUT/DELETE /students/:id`；`POST /students/:id/speed`（倍速）；`POST /students/:id/reset-password`；`POST /students/batch`；`GET /students/recent`；`GET /grades-roster` |
| 站点 | `GET/POST /sites`；`PUT/DELETE /sites/:i`（工具入口配置） |
| 目录 | `/classes`、`/chapters`、`/sections` 各自 `GET/POST`，`PUT/DELETE /:id` |
| 旧题库 | `GET/POST /questions`；`PUT/DELETE /questions/:id`；`POST /questions/import`；`GET /questions/template` |
| 讲义与习题 | `GET/POST /handouts`；`PUT/DELETE /handouts/:id`；`DELETE /handouts/batch`；`GET /handouts/:id/download` |
| 视频 | `GET/POST /videos`；`PUT/DELETE /videos/:id`；`POST /videos/batch`；`DELETE /videos/batch`；`POST /video-order`；分片直传 `POST /videos/direct/init|sign|complete|abort` |
| 上传/试卷 | `POST /upload-audio`；`POST /paper/sent-structs`；`POST /paper/pdf` |
| 统计与日志 | `GET /stats`；`GET /reports/students`；`GET /reports/student/:id`；`GET /logs` |

## 学生端基础（`/api/stu`，`app.js`）

`GET /home`、`/chapters`、`/courses`、`/course-detail`、`/handouts`、`/handouts/:id/download`、`/videos`、`/videos/:id/play`（返回播放地址）、`/practice`、`/mistakes`、`/report`；`POST /progress`、`/practice/submit`、`/mistakes/:qid/resolve`、`/sent-structs`、`/paper-pdf`

## 智能题库（`bank.js`）

管理端 `/api/admin/bank`：

| 资源 | 接口 |
|---|---|
| 题目 | `GET/POST /questions`；`PUT/DELETE /questions/:id`；`POST /questions/batch-delete`；`POST /questions/import`；`GET /questions/template`；`POST /ai-attri`（AI 打标） |
| 知识点树（旧接口，T4 起读写 `bank_trees` 的知识点树，见 `src/kbtree.js`） | `GET /kbtree`（返回 `{edition, list:[{id,name,points:[{id,name}]}], points:[知识点名]}`，`id` 为树节点 id；旧表有数据且尚未复制时先复制）；`POST /kbtree/unit`；`DELETE /kbtree/unit/:id`；`POST /kbtree/point`（`unit_id` 为单元节点 id）；`DELETE /kbtree/point/:id`；`POST /kbtree/generate`（AI 拆解，**合并**进树：只新增、不删除已有节点；响应带 `created`）；`GET /points`（题库里出现过的知识点文本 ∪ 知识点树叶子节点名，仍是字符串数组） |
| 组卷 | `GET/POST /papers`；`GET/PUT/DELETE /papers/:id`；`POST /papers/:id/publish`；`POST /papers/:id/assign`；`GET /papers/:id/assignees`；`POST /papers/pool`；`POST /papers/auto` |

组卷接口补充（T5）：
- `POST /papers/pool`：`{subject, stage, grade, difficulty, point, node_ids}` → `{total, single, multi, judge, fill, sort}`，范围内各题型有多少题（老师选好范围后看一眼）。
- `POST /papers/auto`：条件同上 + `counts:{single:10,…}`；`node_ids` 是章节树 / 知识点树里选中的节点，**含全部后代**，且和学科/学段/年级/难度/知识点文字同时生效；选了节点但节点不存在 → 范围为 0 题（不会退化成全库）。题库不够时照样返回能抽的并在 `missing` 里列缺口。
- `POST /papers/:id/assign`：下发给指定学生并置为已下发。**有下发名单的试卷只对名单里的学生可见**（`GET /tasks`、`GET /papers`、`GET /papers/:id`、`POST /submit kind=paper` 都按此判断）；没有名单的才按年级/学段/册别广播。`POST /papers/:id/publish {publish:0}` 撤回时清空名单。
- 学生端 `POST /scan-compose`（章节组卷 / 知识点组卷）：`{kind, subject, node_ids}` → 选中节点及后代里每个"最小的有题节点"抽 1 题。与 `papers/auto` 共用 `src/compose.js`。
| 课文习题 | `GET /chapters`；`GET /chapters/:id/lessons`；`GET /videos/:id/questions`；`POST /videos/:id/bind`；`POST /videos/:id/import-docx` |
| 反馈 | `GET /feedback`；`PUT /feedback/:id` |
| 选项 | `GET /branches-options`；`GET /students-options` |
| 学生错题 | `GET /mistakes` |
| 扫码上传池 | `GET /uploads`；`POST /uploads/:id/review`；`POST /uploads/import-all`；`DELETE /uploads/:id` |

课文习题正确率（T6）：
- `GET /api/admin/bank/accuracy?user_id=`（后台，分校只能看自己校区的学生）：`{student, courses:[{id,name,groups:[{id,name,videos:[{id,title,acc}],acc}],acc}], acc}`；`acc = {total, answered, correct, rate}`，`rate` 为百分整数，没做过为 `null`。
- 学生端 `GET /api/stu/course-detail`：每个 `lessons[]`、`groups[]` 和整门课都带 `acc`（同上结构）。
- 学生端 `POST /api/stu/bank/submit` 的返回多了 `by_point:[{point,total,correct}]`（本次各知识点）和 `mastery:{video:{…,rate}, section:{…,rate}|null}`（仅 `kind=practice`：该视频和所属小分组**现在**的正确率）。
- 问答题（`type=answer`）不能自动判分：`submit` / `check` 返回里 `ungraded:true` + 参考答案，不记 `records`、不进错题本、不计入 `total`/正确率。

错题 Word 导出（T9，`src/mistake-docx.js`，使用 npm 包 `docx@8.5.0`）：
- 学生端 `GET /api/stu/mistakes/export-docx`：导出自己的错题为可编辑的 `.docx`（附件下载，响应头 `X-Mistake-Count` = 导出题数）。查询参数：`subject`（学科）、`bucket`（`unresolved` 默认 / `resolved` / `all`）、`days`（最近 N 天）、`from` / `to`（`YYYY-MM-DD`，按错题更新时间）、`ids`（逗号分隔的题目 id）。没有符合条件的错题时返回 `{code:1,msg:'没有符合条件的错题可以导出'}`（JSON，不是空文件）。仅学生账号。
- 后台 `GET /api/admin/bank/mistakes/export-docx?user_id=`：同样的参数 + `user_id`；分校只能导出自己校区的学生（否则 403 / `无权导出该学生的错题`）。后台入口（R1 起）：学习报告 → 习题学习报告 → 每行「导出错题 Word」或「详情」顶部的导出区（可选学科 / 范围 / 近 7·30·90 天）。
- 版式（沿用客户《错题集》样本）：封面（错题集 / 共 N 道错题 / 日期范围 / 姓名·科目·日期）→「错题练习」（日期、多次答错标记、题号、题干、图片、选项、知识点）→「错题解析」（答案、解析、答题记录）；页脚「第 X 页 / 共 Y 页」。公式按 LaTeX 文本原样写入；图片只支持 JPEG / PNG。

上传真题试卷（T10）：
- 公式输入（T8）没有新接口：后台粘贴 / 拖拽图片走已有的 `POST /api/admin/bank/mf/asset`；学生端所有出题接口（`serveQ`）与错题本题目的返回里多了 `subject`（前端据此决定要不要显示「公式」按钮）。填空题判分前会抹平 `\( \)`、`\left \right`、`\dfrac` 等写法差异（见 D25）。
- 后台 `POST /api/admin/bank/mf/papers/import-word`（multipart：`file`=.docx，`title`、`subject`、`stage`、`grade`、`year`（4 位数字）、`folder_id`、`publish`=1/0、`dry_run`=1）。格式同 Word 导入（题号、选项 A.、答案另起一行，见 `src/wordq.js`）。
  - `dry_run=1`：只解析，返回 `{total, big_count, error_count, errors, warnings, sections:[{name,count}], title, year}`，**不写库**（老师确认用）。
  - 否则：① 题目写入题库（`source='真题试卷'`，学科 / 年级 / 学段 / 年份随卷）② 新建试卷（`status=done`，`published` 按 `publish`），按题型分「一、单选题 …」文本块（大题先后 = 各题型第一次出现的先后）③ 每题默认分值 = 100 ÷ 题数 ④ 返回 `{paper_id, question_ids, published, score_each, …}`。
- 学生端试卷库搜索：`GET /api/stu/bank/mfpapers?q=&subject=&grade=&year=&size=`（`q` 匹配卷名 / 学科 / 年级 / 年份；都不传 = 全部；只含已发布且不在试题篮 / 回收站的）；`GET /api/stu/bank/mfpapers/filters` → `{subjects, grades, years}`（下拉选项）。`GET /mfpapers/:id` 另返回 `year`、`total_score`（各题分值之和）；`POST /submit kind=mfpaper` / `kind=paper` 的返回多了 `score`、`score_total`。

听力题（T7，题型不新增，在现有题型上附加音频）：
- 题目新增字段 `audio_key`（存储 key，只认 `bank/audio/…` 目录；乱填别的目录或带 `..` 的 key 会被当作没有音频）。后台题目接口（`GET/POST/PUT /questions`、`/questions/:id`）的返回带 `audio_key` 和 `audio_url`（播放地址）；`POST/PUT` 传 `audio_key`（`PUT` 不传 = 保留原音频，传空串 = 去掉音频）。
- 后台 `POST /api/admin/bank/mf/audio/upload`（multipart `file`，mp3 / m4a / wav / ogg / aac / webm，≤25MB）→ `{key, url, name, size}`；`POST /api/admin/bank/mf/audio/tts` `{text(≤500字), lang:'en'|'zh', rate?}` → 同上（用服务器的语音合成：Windows 自带语音；`TTS_MOCK=1` 环境变量下生成一小段提示音，供自动化测试）。音频存在 `bank/audio/YYYYMM/…`。
- 待审核页逐题补音频：`PUT /ext/pending/item` 的 `patch.audio_key`（拍照识别 / Word / Excel / 技能包 / 网络采集 / 手机扫码六类来源都支持）；待审核项带 `audio_key`、`audio_url`；入库时写进题目。Excel / Word 导入模板没有改。
- 学生端所有出题接口（`lesson-questions`、`papers/:id`、`mfpapers/:id`、`scan-compose`、`review-queue`、`mistakes` 等）返回的题目带 `audio_url`（没有音频为空串）。本地存储时是 `/api/file?key=…`，`<audio>` 带不了请求头，前端把登录票据拼成 `&token=` 再播放；云存储是签名外链，原样播放。

学生端 `/api/stu/bank`：`GET /lesson-questions`、`/tasks`、`/papers`、`/papers/:id`、`/mfpapers`、`/mfpapers/:id`、`/scan-tree`、`/mistakes`、`/mistake-count`、`/mistake-points`、`/review-queue`、`/uploads`；`POST /submit`、`/scan-compose`、`/check`、`/feedback`、`/ai-explain`、`/upload-token`

扫码上传 `/api/up`：`GET /info`、`POST /submit`、`GET /mine`

## 魔方题库（`mfbank.js`，前缀 `/api/admin/bank/mf`）

| 资源 | 接口 |
|---|---|
| 目录树 | `GET/POST /trees`；`PUT/DELETE /trees/:id`；`GET/POST /trees/:id/nodes`（GET 返回扁平节点，每个带 `qcount` = 本节点及所有子孙节点上题目的**去重**数、`qcount_own` = 只算节点自己；R0-B10）；`PUT/DELETE /nodes/:id`；`POST /nodes/:id/move`（body `{dir:'up'|'down'}`，同级内上移/下移一位，服务端先把同级顺序规范成 0..n-1 再对调；T4 新增）；`GET/POST /questions/:id/nodes` |
| 题目 | `GET/POST /questions`；`GET/PUT/DELETE /questions/:id`；`POST /questions/batch`；`GET /tags`；`GET /questions-export`；`POST /ai-clean` |
| 采集 | `POST /capture/parse`；`GET /capture/token`；`GET /capture/bookmarklet`；`POST /capture/fetch`；`POST /capture/auto`；`POST/GET /capture/batches`；`GET/DELETE /capture/batches/:id`；`DELETE /capture/batches/:id/q/:idx`；`POST /capture/batches/:id/commit`；`POST /api/mfcap/push` |
| 试卷文件夹 | `GET/POST /paper-folders`；`PUT/DELETE /paper-folders/:id` |
| 试卷管理 | `GET/POST /papers`（`GET` 支持 `kw`、`subject`、`grade`、`year`、`published=0/1`、`status`、`folder` 筛选；`POST/PUT` 带 `year`，不是 4 位数字会被忽略）；**`POST /papers/import-word`（T10，上传真题试卷）**；`GET/PUT/DELETE /papers/:id`；`POST /papers/:id/questions`；`POST /papers/:id/text`；`PUT /papers/:id/reorder`；`PUT/DELETE /papers/:id/rows/:rowId`；`GET /papers/:id/preview`；`GET /papers/:id/export`；`POST /papers/:id/archive` |
| 录题 intake | `GET/POST /intake/runs`；`GET/DELETE /intake/runs/:id`；`POST /intake/runs/:id/pages|recognize|ocr|structure|word|aifill|commit`；`PUT /intake/runs/:id/drafts` |
| 导入 | `GET /import-skill`；`POST /import-pack`（**T3 起不再直接入库**：解析 + 去重/补图照旧，新题放进一个 `skill` 批次进待审核；响应带 `staged`、`run_id`）；`POST /asset` |
| 待审核题目（T3，`mfpending.js`） | `GET /ext/pending`（`source`=all/photo/word/excel/skill/capture/scan、`kw`、`page`、`size`；响应 `{total,page,size,list,counts}`，每项带 `id`、`source`、`source_label`、题目内容）；`PUT /ext/pending/item`（`{id, patch}` 编辑单题）；`POST /ext/pending/commit`（`{ids, subject, stage, grade, node_ids, tags}` 逐题/批量入库，响应 `{committed, question_ids, failed:[{id,msg}]}`；**学科、学段必须有**：题目自己没有、请求里也没传的，进 `failed`（全部失败时整个请求报错），提示「没有学科 / 没有学段，请先选好…」；R0-B8）；`POST /ext/pending/delete`（`{ids}`）；`POST /ext/import-excel`（multipart `file` + 默认 `subject/stage/grade`，按客户 9 个 sheet 模板，忽略【例题】行）；`POST /ext/import-word`（multipart `file` .docx，规则解析不调 AI，响应带 `errors:[{para,no,msg}]` 段号）；`GET /ext/import-template`（客户《习题导入模板》逐字节原文件）。id 形如 `run:批次:序号:指纹` / `cap:批次:序号:指纹` / `up:上传记录`，**指纹**是题干的 md5 前 8 位：别人删改过之后序号会前移，旧 id 对不上指纹会被拒绝（提示刷新），避免入库/删掉另一道题 |
| 配置与扩展 | `GET/PUT /config`；`GET /ext/badge-counts`（T3 起另带 `pending`、`pending_by`）；`GET /ext/review-list`；`POST /ext/ai-attrib` |

## 采集与 AI 配置（`mfcollect.js`，前缀 `/api/admin/bank/mf/ext`）

- 字典：`GET/POST /dict`；`POST /dict/assign`；`DELETE /dict/:id`
- AI 配置中心 profiles（T2，全站唯一的 AI 配置入口）：`GET/POST /profiles`；`PUT/DELETE /profiles/:id`；`POST /profiles/models`；`POST /profiles/test-draft`；`POST /profiles/:id/test`；`POST /profiles/:id/enable`；`POST /profiles/quick`
  - 档案字段 `format`：`openai`（OpenAI 兼容，默认）/ `anthropic` / `gemini`；`GET /profiles` 另返回 `formats:[{key,name,hint}]`（每种格式的接口地址写法提示）。非法格式、接口地址不是 http(s) 开头会被拒。
  - `POST /profiles/models` `{format, base_url, api_key}`：按格式走各自的模型列表接口。
  - `POST /profiles/test-draft` `{role, format, base_url, model, api_key, id?}`：测试一份**还没保存**的配置（新增表单里的"测试连接"），不落库；编辑已有档案时 `api_key` 留空 = 用库里的密钥。错误地址 / 密钥 / 模型会给出明确原因。
  - `POST /profiles/:id/test`：测已保存档案并记录 `last_test_ok`；`/enable` 要求测通，同角色排他。
- 其他：`POST /ai-suggest`；`POST /collect-tree`（和 `POST /api/mfcap/tree-push` 同一个核心：body `{site, root_id, root_name, stage, subject, nodes[], kind?}`，**`stage`（小学/初中/高中 或 primary/junior/senior）和 `subject` 必填**，缺了拒绝并给中文提示；并入该 学段+学科 已有的同类（`kind`，默认 knowledge）树，没有才新建；同父同名节点不重复建；响应 `{tree_id, created, merged, total, new_tree}`；R0-B7）；`GET/PUT /prefs`；`POST /proxy-ticket`；`/api/mfproxy`：`GET /inject.js`、`GET /ck`、`GET|POST /r`（整个路由**放行 CORS**：`Allow-Origin: *`、不开 Allow-Credentials——代理 iframe 去掉了 allow-same-origin，页面成了不透明源，请求变跨域；R0-B5）；`POST /api/mfcap/tree-push`

## 错题重组（`wrong.js`，前缀 `/api/admin/wrong`）

`GET/POST /batches`；`PUT/DELETE /batches/:id`；`POST/GET /items`；`PATCH/DELETE /items/:id`；`POST /items/select`；`POST/GET /sets`；`DELETE /sets/:id`；`GET /stats`；`POST /segment`；`POST /analyze`；`POST /rebuild`

## 学情与报告

- `/api/admin/xreport`（`reports.js`）：`GET /videos`、`/videos/:id/detail`、`/exercises`、`/exercises/:id/detail`（R1：两个 `/detail` 对分校账号加了校区校验，别校学生返回 `无权查看该学生`；`/exercises/:id/detail` 的 `papers` 多带 `total_score` 满分）
- `/api/admin/report`（`report.js`）：`GET/PUT /config`；`POST /papers`；`POST /`（生成）；`POST /export-pdf`；`GET /`；`GET/DELETE /:id`；`POST /:id/retry`；`POST /scan-token`；`POST /api/report-scan`（扫码上传）

## 单词训练（`word.js`）

管理端 `/api/admin/word`：`GET/POST/PUT/DELETE /books`、`PUT /books/:id/kind`；`/words`、`/sentences`、`/pos`、`/phrases` 的列表/新增/修改/删除；`POST /upload`；`GET /template`；`POST /phrase-examples`、`/phrase-examples-all`、`/phrase-example`（及 `/status`）；`POST /ai/fill`、`/ai/generate`、`/ai/save`；`GET /progress`

学生端 `/api/stu/word`：`GET /books`、`/units`、`/words`、`/sentences`、`/phrases`、`/pos`、`/phrase-sentence`、`/phrase-prefill`、`/stats`；`POST /record`、`/group-done`

## 语音基础（`phonics.js`）

管理端 `/api/admin/phonics`：`/list`、`/save`、`/del`、`/seed`、`/upload`；`/extras`（`/save`、`/del`）；`/courses`（`/save`、`/del`）；`/course-items`（`/save`、`/del`、`/reorder`、`/video-key`）；`/course-cover-ai`；`/quiz-list`、`/quiz/template`、`/quiz/import`、`/quiz/save`、`/quiz/del`

学生端 `/api/stu/phonics`：`GET /extras`、`/courses`、`/quiz-list`、`/list`；`POST /record`

## AI 配置（`ai.js`）

`/api/admin/ai`（`ai.js`）：`GET /config`（当前生效的配置：`baseUrl, model, format, via, profileId, hasKey, mock`，不含密钥）；`POST /test`（测试当前生效的配置）；`PUT /config` **已停用**（返回提示去「设置 → AI 配置中心」）。`/api/admin/report/config` 同理，`GET` 只读、`PUT` 停用。

AI 配置统一后的读取顺序（T2，`src/ai-client.js`）：该角色（`vision` / `reasoning` / `light`）启用的档案 → 按回落顺序用别的已启用档案 → 都没有才用 `builtin-config.js`。`AI_MOCK=1` 环境变量仍优先（演示模式，自动化测试用）。旧的 `settings` 表里的 `aiBaseUrl / aiModel / aiApiKey` 不再被读取（此前就已被 `builtin-config.js` 覆盖，没有行为变化）。
