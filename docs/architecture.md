# 架构说明

## 技术栈

- 后端：Node.js + Express，入口 `src/app.js`，端口 3000（`PORT` 可改），生产用 pm2（`ecosystem.config.js`，单实例 fork）。
- 数据库：MySQL（`src/config.local.js` 指向 `127.0.0.1:3306`，库名 `xuexi`）。`src/mysql-sync.js` 提供与 better-sqlite3 同接口的同步封装（查询在 `mysql-worker.js` 的独立线程里执行），业务代码不用 async。库为空时 `import-sqlite.js` 会从 `data/xuexi.db`（SQLite）导入旧数据。
- 存储：`src/storage.js`，阿里云 OSS / 七牛 / 本地磁盘三选一（环境变量 `STORAGE_DRIVER`）。视频走前端分片直传 OSS（单个上限 4GB），可配 `CDN_DOMAIN`。`LOCAL_FOLDERS` 默认 `wrong,guidedocs` 留在本地。题库资源（题目图 / 听力音频 / 录题页图 / 导出试卷）统一在 `bank/` 目录，视频在 `videos/`，二者只靠 key 前缀和 `video_id` 绑定关系关联；可选 `BANK_BUCKET` 是将来拆桶的预留口子（T12，README 有做法）。
- 前端：原生 JS，无构建。

## 数据库如何选择（MySQL / SQLite）

**没有"选择"：运行时永远是 MySQL。** README 里写的 SQLite 已过时。

- 连接信息读取顺序（`src/db.js`）：环境变量 `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` → `src/config.local.js` 的 `mysql` 字段；库名默认 `xuexi`。
- `better-sqlite3` 只用于一件事：启动时（`db.js` 末尾 `importIfEmpty`）若 MySQL 里还没有用户，且 `data/xuexi.db`（旧 SQLite 文件）存在，则一次性导入到 MySQL；没有该文件或没装 `better-sqlite3` 则直接以空库启动。当前仓库没有 `data/xuexi.db`。
- SQL 一律写 SQLite 方言，由 `db.js`（建表 `toMysqlDdl`）和 `mysql-sync.js`（查询）转换成 MySQL；改表结构只能走 `db.js` 的幂等建表/加列，只加不删。
- **连不上 MySQL 时（实测）：没有回退也没有重试。** 密码错误报 `Access denied`，端口不通报 `ECONNREFUSED`，都在 `require('./src/db')` 阶段抛出未捕获异常，进程直接退出。所以服务启动前 MySQL 必须可用；`npm run seed`、各测试脚本同理。
- 空库初始化：`runSchema` 先建表，再执行加列 `ALTER`，最后建依赖这些列的索引（全新空库已在 CI 验证通过）。

## 目录结构

```
zhilexue/
├── AGENTS.md  README.md  package.json  ecosystem.config.js
├── src/        后端（见下表）
├── public/     静态前端
│   ├── index.html + js/vue-app.js   学生端入口（Vue 3）
│   │   admin/audioui.js         后台题目的听力音频字段（上传 / 文字生成朗读 / 试听），题目编辑、新建、待审核编辑共用（T7）
│   │   js/t13-fit.js            单词学习卡片里的单词 / 释义 / 选项放不下时缩字号（T13，只改显示，在 words.js 之后加载）
│   │   js/mlive.js              公式输入（T8）：懒加载本地 MathLive，`MLive.dialog` 弹公式编辑框 + 虚拟键盘，学生端和后台共用
│   │   admin/formulaui.js       后台「插入公式」按钮 + 题目输入框粘贴 / 拖拽图片（T8）
│   │   vendor/mathlive/         MathLive 0.109.2（MIT）本地文件和字体，不走 CDN；点公式按钮时才加载
│   ├── admin/      后台（Vue 2 + element-ui，多个独立脚本依次加载；`vcodec.js` 是视频上传前的编码检测，先于 admin.js 加载；`ktreeui.js` 是「知识树管理」页，`pendingui.js` 是「待审核题目」页，`accui.js` 是「学情管理 → 知识点正确率」页）
│   ├── upload.html 手机扫码上传页；scan-report.html 扫码上传学情试卷
│   ├── apps/       care / grades / keyboard-school / timer，独立小应用，由主站以 iframe 引用
│   └── css/ js/ vendor/ img/ fonts/ audio/
├── scripts/    运维小脚本（`check-video.sh`：检查视频是否 H.264 + AAC、MP4 是否 faststart；`migrate-kb-to-trees.js`：旧知识点树复制进新树）
├── data/       仅种子与模板（knowledge-seed.json、题库导入模板.xlsx、习题导入模板.xlsx（客户给的 9 个 sheet 模板的逐字节副本，不得改动）、mofang-question-transcribe.zip）
├── docs/       文档，用途见 AGENTS.md
├── .github/workflows/ci.yml
└── *-test.js  smoke.js  seed-words.js   测试与种子脚本（依赖根目录相对路径，不要移动）
```

## src 模块

| 文件 | 作用 |
|---|---|
| `app.js` | 主服务：登录、文件代理、管理端基础接口（分校/学生/目录/视频/讲义）、学生端基础接口、路由挂载 |
| `kbtree.js` | 知识树统一（T4）：旧 `kb_*` 复制进 `bank_trees` 知识点树、旧 `/kbtree*` 接口的读写、知识点名清单（供 AI 补全/下拉用）；被 `bank.js`、`mfbank.js` 调用 |
| `mfpending.js` | 待审核题目（T3）：把拍照识别 / Word / Excel / 技能包（都是 `mf_recog_runs` 批次）、网络采集批次、手机扫码上传统一成一个列表，逐题编辑/入库/删除，以及 Excel、Word 导入入口；由 `mfbank.js` 末尾挂载，复用它抽出的 `commitRunCards` / `commitCaptureItems`；T10 的「上传真题试卷」`POST /papers/import-word`（Word → 试卷 + 入题库）也在这里 |
| `wordq.js` | Word 题目规则解析（T3）：按客户《word (1).docx》的格式规则解析，不调 AI，不合规的题给出段号和原因 |
| `db.js` / `mysql-sync.js` / `mysql-worker.js` / `import-sqlite.js` | 建表、数据库连接与 SQLite→MySQL 转换 |
| `auth.js` / `delpwd.js` | JWT 鉴权；删除确认密码 |
| `storage.js` | 文件存储抽象（本地 / OSS / 七牛） |
| `accuracy.js` | 习题正确率（T6）：按视频 / 小分组 / 课程聚合某学生的作答（`records` + `questions.video_id`，每题取最近一次），不新增表；被 `app.js` 的 `course-detail`、`bank.js` 的 `submit` 返回和后台 `/accuracy` 共用 |
| `compose.js` | 组卷核心（T5）：范围（学科/学段/年级/难度/知识点文字 + 章节树/知识点树节点含后代）→ 候选题；`pickByCounts`（管理端按题型数量）、`pickPerNode`（学生端每个最小知识点 1 题）、`poolCounts`（范围内题量）；被 `bank.js` 的 `/papers/auto`、`/papers/pool`、学生端 `/scan-compose` 共用 |
| `mistake-docx.js` | 错题 Word 导出（T9）：取错题 + 答题记录 → 按客户《错题集》样本版式生成 `.docx`（封面 / 错题练习 / 错题解析 / 页脚页码，图片内嵌）；学生端 `app.js` 的 `/mistakes/export-docx` 和后台 `bank.js` 的 `/mistakes/export-docx` 共用 |
| `bank.js` | 智能题库：题目、知识点树（kb）、组卷下发、课文习题绑定、学生错题、扫码上传池 |
| `mfbank.js` / `mfcollect.js`（含 AI 配置中心档案接口）/ `mfseed.js` / `mfzip.js` | 「魔方题库」（与 2026-10-29 并入）：目录树、标签、采集批次、录题 intake、试卷管理、AI 配置 profiles、技能包导入 |
| `bank-excel.js` / `excel.js` / `bank-judge.js` / `docxtext.js` / `tableparse.js` | Excel/Word 导入解析与判分 |
| `wrong.js` / `scanify.js` / `pdfimg.js` | 错题重组：拍照切题、生成错题集 PDF |
| `ai-client.js` | AI 客户端（T2）：全站唯一发请求给大模型的地方；按档案的 `format` 走 OpenAI 兼容 / Anthropic Messages / Gemini 三种协议，选档案（角色 → 回落 → 内置配置），图片按各协议的内容块格式送，错误翻译成中文原因；被 `ai.js`、`mfcollect.js` 调用 |
| `ai.js` / `report.js` / `reports.js` | AI 业务封装（学情报告、整页识别、错题变式、通用对话，都转给 `ai-client.js`）与 AI 学情报告；学情统计 |
| `word.js` / `phonics.js` / `win-speak.js` / `pos-*.js` | 单词训练、语音基础、TTS 发音、词性词库 |
| `seed.js` / `config.local.js` / `builtin-config.js` | 初始化数据；MySQL 连接信息；内置配置 |

## 请求与权限

- `/api/admin/*` 管理端，角色 admin（校长）或 branch（分校），权限一致；`/api/stu/*` 学生端。鉴权用 JWT，由 `Authorization: Bearer` 传递。
- `<video>` / `<iframe>` / `<img>` 由浏览器直连，不能带 Authorization 头，所以本地文件代理地址 `/api/file?key=...` 把 token 拼在 URL 上（`withFileTicket` / `withTicket`）。OSS/七牛的签名外链原样返回。
- 扫码上传（`/api/up`、`/api/report-scan`）用独立的一次性 token，不走登录态。

## 测试与 CI

根目录测试：`smoke.js`（后端端到端，需服务已启动）、`bank-test.js`、`word-test.js`、`wrong-test.js`、`storage-test.js`、`ui-test.js`（需 jsdom）、`report-test.js`、`wrong-ui-test.js`。CI 见 `.github/workflows/ci.yml`。
