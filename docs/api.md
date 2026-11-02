# 接口文档

本文档由 2026-11-02 对 `src/` 路由定义的实际阅读生成，列出挂载前缀和路径。用途一栏只写读代码能确认的；标「待补」的需要开发时补充。新增、修改、删除接口请同步更新（见 AGENTS.md）。

约定：`GET /x` 表示方法和路径；`/:id` 为路径参数。除特别说明外，`/api/admin/*` 需要管理端登录（admin 或 branch），`/api/stu/*` 需要学生登录。

## 挂载总表

| 前缀 | 来源 | 说明 |
|---|---|---|
| `/api` | `app.js` | 登录、当前用户、改密码、文件代理、TTS |
| `/api/admin` | `app.js` | 管理端基础接口（分校、学生、目录、视频、讲义、统计、日志） |
| `/api/stu` | `app.js` | 学生端基础接口 |
| `/api/admin/ai` | `ai.js` router | AI 配置与调用（待补） |
| `/api/admin/wrong` | `wrong.js` | 错题重组 |
| `/api/admin/xreport` | `reports.js` | 学情统计（视频、习题） |
| `/api/admin/report` | `report.js` | AI 学情报告 |
| `/api/report-scan` | `report.js` scan | 扫码上传学情试卷 |
| `/api/admin/word`、`/api/stu/word` | `word.js` | 单词训练 |
| `/api/admin/phonics`、`/api/stu/phonics` | `phonics.js` | 语音基础 |
| `/api/admin/bank`、`/api/stu/bank` | `bank.js` | 智能题库 |
| `/api/up` | `bank.js` up | 手机扫码上传（错题/纸质题） |
| `/api/admin/bank/mf` | `mfbank.js` | 魔方题库 |
| `/api/mfcap` | `mfbank.js` / `mfcollect.js` cap | 采集推送 |
| `/api/admin/bank/mf/ext` | `mfcollect.js` | 采集字典、AI 配置 profiles、浏览器代理 |
| `/api/mfproxy` | `mfcollect.js` proxy | 采集代理 |

## 公共（`app.js`）

- `POST /api/login` 登录；`GET /api/me` 当前用户；`POST /api/change-password` 改密码
- `GET /api/file` 文件代理（参数 key、name、inline、token；云存储时 302 到签名链接）
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
| 组卷 | `GET/POST /papers`；`GET/PUT/DELETE /papers/:id`；`POST /papers/:id/publish`；`POST /papers/:id/assign`；`GET /papers/:id/assignees`；`POST /papers/auto` |
| 课文习题 | `GET /chapters`；`GET /chapters/:id/lessons`；`GET /videos/:id/questions`；`POST /videos/:id/bind`；`POST /videos/:id/import-docx` |
| 反馈 | `GET /feedback`；`PUT /feedback/:id` |
| 选项 | `GET /branches-options`；`GET /students-options` |
| 学生错题 | `GET /mistakes` |
| 扫码上传池 | `GET /uploads`；`POST /uploads/:id/review`；`POST /uploads/import-all`；`DELETE /uploads/:id` |

学生端 `/api/stu/bank`：`GET /lesson-questions`、`/tasks`、`/papers`、`/papers/:id`、`/mfpapers`、`/mfpapers/:id`、`/scan-tree`、`/mistakes`、`/mistake-count`、`/mistake-points`、`/review-queue`、`/uploads`；`POST /submit`、`/scan-compose`、`/check`、`/feedback`、`/ai-explain`、`/upload-token`

扫码上传 `/api/up`：`GET /info`、`POST /submit`、`GET /mine`

## 魔方题库（`mfbank.js`，前缀 `/api/admin/bank/mf`）

| 资源 | 接口 |
|---|---|
| 目录树 | `GET/POST /trees`；`PUT/DELETE /trees/:id`；`GET/POST /trees/:id/nodes`；`PUT/DELETE /nodes/:id`；`POST /nodes/:id/move`（body `{dir:'up'|'down'}`，同级内上移/下移一位，服务端先把同级顺序规范成 0..n-1 再对调；T4 新增）；`GET/POST /questions/:id/nodes` |
| 题目 | `GET/POST /questions`；`GET/PUT/DELETE /questions/:id`；`POST /questions/batch`；`GET /tags`；`GET /questions-export`；`POST /ai-clean` |
| 采集 | `POST /capture/parse`；`GET /capture/token`；`GET /capture/bookmarklet`；`POST /capture/fetch`；`POST /capture/auto`；`POST/GET /capture/batches`；`GET/DELETE /capture/batches/:id`；`DELETE /capture/batches/:id/q/:idx`；`POST /capture/batches/:id/commit`；`POST /api/mfcap/push` |
| 试卷文件夹 | `GET/POST /paper-folders`；`PUT/DELETE /paper-folders/:id` |
| 试卷管理 | `GET/POST /papers`；`GET/PUT/DELETE /papers/:id`；`POST /papers/:id/questions`；`POST /papers/:id/text`；`PUT /papers/:id/reorder`；`PUT/DELETE /papers/:id/rows/:rowId`；`GET /papers/:id/preview`；`GET /papers/:id/export`；`POST /papers/:id/archive` |
| 录题 intake | `GET/POST /intake/runs`；`GET/DELETE /intake/runs/:id`；`POST /intake/runs/:id/pages|recognize|ocr|structure|word|aifill|commit`；`PUT /intake/runs/:id/drafts` |
| 导入 | `GET /import-skill`；`POST /import-pack`；`POST /asset` |
| 配置与扩展 | `GET/PUT /config`；`GET /ext/badge-counts`；`GET /ext/review-list`；`POST /ext/ai-attrib` |

## 采集与 AI 配置（`mfcollect.js`，前缀 `/api/admin/bank/mf/ext`）

- 字典：`GET/POST /dict`；`POST /dict/assign`；`DELETE /dict/:id`
- AI 配置 profiles：`GET/POST /profiles`；`PUT/DELETE /profiles/:id`；`POST /profiles/models`；`POST /profiles/:id/test`；`POST /profiles/:id/enable`；`POST /profiles/quick`
- 其他：`POST /ai-suggest`；`POST /collect-tree`；`GET/PUT /prefs`；`POST /proxy-ticket`；`/api/mfproxy`：`GET /inject.js`、`GET /ck`、`GET|POST /r`；`POST /api/mfcap/tree-push`

## 错题重组（`wrong.js`，前缀 `/api/admin/wrong`）

`GET/POST /batches`；`PUT/DELETE /batches/:id`；`POST/GET /items`；`PATCH/DELETE /items/:id`；`POST /items/select`；`POST/GET /sets`；`DELETE /sets/:id`；`GET /stats`；`POST /segment`；`POST /analyze`；`POST /rebuild`

## 学情与报告

- `/api/admin/xreport`（`reports.js`）：`GET /videos`、`/videos/:id/detail`、`/exercises`、`/exercises/:id/detail`
- `/api/admin/report`（`report.js`）：`GET/PUT /config`；`POST /papers`；`POST /`（生成）；`POST /export-pdf`；`GET /`；`GET/DELETE /:id`；`POST /:id/retry`；`POST /scan-token`；`POST /api/report-scan`（扫码上传）

## 单词训练（`word.js`）

管理端 `/api/admin/word`：`GET/POST/PUT/DELETE /books`、`PUT /books/:id/kind`；`/words`、`/sentences`、`/pos`、`/phrases` 的列表/新增/修改/删除；`POST /upload`；`GET /template`；`POST /phrase-examples`、`/phrase-examples-all`、`/phrase-example`（及 `/status`）；`POST /ai/fill`、`/ai/generate`、`/ai/save`；`GET /progress`

学生端 `/api/stu/word`：`GET /books`、`/units`、`/words`、`/sentences`、`/phrases`、`/pos`、`/phrase-sentence`、`/phrase-prefill`、`/stats`；`POST /record`、`/group-done`

## 语音基础（`phonics.js`）

管理端 `/api/admin/phonics`：`/list`、`/save`、`/del`、`/seed`、`/upload`；`/extras`（`/save`、`/del`）；`/courses`（`/save`、`/del`）；`/course-items`（`/save`、`/del`、`/reorder`、`/video-key`）；`/course-cover-ai`；`/quiz-list`、`/quiz/template`、`/quiz/import`、`/quiz/save`、`/quiz/del`

学生端 `/api/stu/phonics`：`GET /extras`、`/courses`、`/quiz-list`、`/list`；`POST /record`

## AI 配置（`ai.js`）

`/api/admin/ai` 下的具体路由待补。配置存于 `settings` 表（`aiBaseUrl`、`aiModel`、`aiApiKey`），目前只支持 `${baseUrl}/chat/completions`。
