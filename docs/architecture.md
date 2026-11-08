# 架构说明

## 技术栈

- 后端：Node.js + Express，入口 `src/app.js`，端口 3000（`PORT` 可改），生产用 pm2（`ecosystem.config.js`，单实例 fork）。
- 数据库：MySQL（`src/config.local.js` 指向 `127.0.0.1:3306`，库名 `xuexi`）。`src/mysql-sync.js` 提供与 better-sqlite3 同接口的同步封装（查询在 `mysql-worker.js` 的独立线程里执行），业务代码不用 async。库为空时 `import-sqlite.js` 会从 `data/xuexi.db`（SQLite）导入旧数据。
- 存储：`src/storage.js`，写入驱动由 `STORAGE_DRIVER` 选择阿里云 OSS / 七牛 / 本地磁盘。OSS 读取先用上传根目录下已有的普通本地文件，否则按原 key 读取原桶，不下载全桶或改数据库 key；上传根目录可为部署链接，根目录以下的符号链接不作为本地媒体。`STORAGE_CLOUD_READ_ONLY=1` 显式禁止云端写入、删除和上传授权，默认关闭，不影响读取或原有本地写入策略。视频走前端分片直传 OSS（单个上限 4GB），可配 `CDN_DOMAIN`。`LOCAL_FOLDERS` 默认 `wrong,guidedocs` 留在本地。题库资源（题目图 / 听力音频 / 录题页图 / 导出试卷）统一在 `bank/` 目录，视频在 `videos/`，二者通过 key 前缀和 `video_id` 绑定关系隔离，不要求独立存储桶。题图使用稳定的 `/api/file?key=…` 地址；读取时短票据和云存储 URL 重新签发，兼容当前存储域名下可识别的历史签名图。
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
│   │   admin/theme.css          后台统一主题（T11）：所有规则挂在 body.t11 下，用 --t11-* 变量统一主色 / 圆角 / 控件高度 / 间距，在 admin/index.html 里最后加载
│   │   js/mlive.js              公式输入（T8）：懒加载本地 MathLive，`MLive.dialog` 弹公式编辑框 + 虚拟键盘，学生端和后台共用
│   │   admin/formulaui.js       后台「插入公式」按钮 + 题目输入框粘贴 / 拖拽图片（T8）
│   │   vendor/mathlive/         MathLive 0.109.2（MIT）本地文件和字体，不走 CDN；点公式按钮时才加载
│   │   admin/treepick.js        目录树选择小工具（R2）：前端 `pickTree`（与后端 `treepick.js` 同逻辑）、版本列表、下拉显示名「版本 · 学段 · 名称」；在 admin.js 之后、各页面脚本之前加载
│   ├── admin/      后台（Vue 2 + element-ui，多个独立脚本依次加载；`vcodec.js` 是视频上传前的编码检测，先于 admin.js 加载；`ktreeui.js` 是「知识树管理」页，`pendingui.js` 是「待审核题目」页，`accui.js` 是旧「知识点正确率」页，R1 起已停用并不再加载——该页并入 `reportui.js` 的习题学习报告详情抽屉，旧路由 `#/acc` 跳转到 `#/xreport`）
│   ├── upload.html 手机扫码上传页；scan-report.html 扫码上传学情试卷
│   ├── apps/       care / grades / keyboard-school / timer，独立小应用，由主站以 iframe 引用
│   └── css/ js/ vendor/ img/ fonts/ audio/
├── scripts/    运维小脚本（`import-trees.js`：批量导入目录树 JSON（R2，幂等、`--dry-run`）；`check-video.sh`：检查视频是否 H.264 + AAC、MP4 是否 faststart；`migrate-kb-to-trees.js`：旧知识点树复制进新树）
├── data/       仅种子与模板（trees/draft/：物理 / 化学教材章节树的待核对草稿，不会自动导入，R2；knowledge-seed.json、题库导入模板.xlsx、习题导入模板.xlsx（客户给的 9 个 sheet 模板的逐字节副本，不得改动）、mofang-question-transcribe.zip）
├── docs/       文档，用途见 AGENTS.md
├── .github/workflows/ci.yml
└── *-test.js  smoke.js  seed-words.js   测试与种子脚本（依赖根目录相对路径，不要移动）
```

## src 模块

| 文件 | 作用 |
|---|---|
| `app.js` | 主服务：登录、文件代理、管理端基础接口（分校/学生/目录/视频/讲义）、学生端基础接口、路由挂载 |
| `kbtree.js` | 知识树统一（T4）：旧 `kb_*` 复制进 `bank_trees` 知识点树、旧 `/kbtree*` 接口的读写、知识点名清单（供 AI 补全/下拉用）；被 `bank.js`、`mfbank.js` 调用 |
| `treepick.js` / `treeio.js` | 目录树的教材版本（R2）：`treepick.js` = 默认版本表（`settings.default_editions`）+ 统一取树 `pickTree`（所有"按 学段+学科 取一棵树"的地方都走它：`kbtree.js`、`bank.js` 学生端 `scan-tree`、`mfcollect.js`）；`treeio.js` = 树导入 / 导出（格式见 `docs/tree-import-format.md`，被 `mfbank.js` 的 `/trees/import`、`/trees/:id/export` 和 `scripts/import-trees.js` 共用） |
| `mfpending.js` | 待审核题目（T3）：把拍照识别 / Word / Excel / 技能包（都是 `mf_recog_runs` 批次）、网络采集批次、手机扫码上传统一成一个列表，逐题编辑/入库/删除，以及 Excel、Word 导入入口；由 `mfbank.js` 末尾挂载，复用它抽出的 `commitRunCards` / `commitCaptureItems`；真题和课文习题题卡先进入审核，审核后回挂试卷或视频 |
| `recognition-pages.js` / `pending-merge.js` | 跨页识别材料及题卡的保守关联、来源与并发快照；老师显式合并片段时保留原片段、重映射图片并要求重新审核 |
| `content-review.js` / `image-review.js` / `ai-answer-review.js` | 分别绑定题面、图文和 AI 答案/解析的审核快照；图表缺失、内容变化或未经确认时不能绕过待审核入库 |
| `question-images.js` / `choice-options.js` | 学生取题时区分题面图与明确标识的答案解析图；共享选择题选项完整性校验 |
| `wordq.js` | Word 题目规则解析（T3）：按客户《word (1).docx》的格式规则解析，不调 AI，不合规的题给出段号和原因 |
| `db.js` / `mysql-sync.js` / `mysql-worker.js` / `import-sqlite.js` | 建表、数据库连接与 SQLite→MySQL 转换 |
| `auth.js` / `delpwd.js` | JWT 鉴权；删除确认密码 |
| `storage.js` | 文件存储抽象（本地 / OSS / 七牛） |
| `accuracy.js` | 习题正确率（T6）：按视频 / 小分组 / 课程聚合某学生的作答（`records` + `questions.video_id`，每题取最近一次），不新增表；R8 起小分组还要算上直接挂在小分组上的题（`questions.section_id`，`sectionOwnStats`），`lastAnswers` 给「知识点掌握情况」用；被 `app.js` 的 `course-detail` / `courses`、`bank.js` 的 `submit` / `node-mastery` 和后台 `/accuracy` 共用 |
| `compose.js` | 组卷核心（T5）：范围（学科/学段/年级/难度/知识点文字 + 章节树/知识点树节点含后代）→ 候选题；`pickByCounts`（管理端按题型数量）、`pickPerNode`（学生端每个最小知识点 1 题）、`poolCounts`（范围内题量）；被 `bank.js` 的 `/papers/auto`、`/papers/pool`、学生端 `/scan-compose` 共用 |
| `mistake-docx.js` | 错题 Word 导出（T9）：取错题 + 答题记录 → 按客户《错题集》样本版式生成 `.docx`（封面 / 错题练习 / 错题解析 / 页脚页码，图片内嵌）；学生端 `app.js` 的 `/mistakes/export-docx` 和后台 `bank.js` 的 `/mistakes/export-docx` 共用 |
| `bank.js` | 智能题库：题目、知识点树（kb）、组卷下发、课文习题绑定（R8：视频 / 小分组挂题、视频关联知识点 `video_nodes`）、学生错题、扫码上传池、AI 老师流式讲解（R8：`/ai-explain/stream` SSE） |
| `mfbank.js` / `mfcollect.js`（含 AI 配置中心档案接口）/ `mfseed.js` / `mfzip.js` | 「魔方题库」（与 2026-10-29 并入）：目录树、标签、采集批次、录题 intake、试卷管理、AI 配置 profiles、技能包导入 |
| `bank-excel.js` / `excel.js` / `bank-judge.js` / `docxtext.js` / `tableparse.js` | Excel/Word 导入解析与判分 |
| `wrong.js` / `scanify.js` / `pdfimg.js` | 错题重组：拍照切题、生成错题集 PDF |
| `ai-client.js` | AI 客户端（T2）：全站唯一发请求给大模型的地方；按档案的 `format` 走 OpenAI 兼容 / Anthropic Messages / Gemini 三种协议，选档案（角色 → 回落 → 内置配置），图片按各协议的内容块格式送，错误翻译成中文原因；R8 加 `chatStream`（OpenAI 兼容走 `stream:true`，另两种退化为分块推送）；被 `ai.js`、`mfcollect.js`、`bank.js`（AI 老师浮层）调用 |
| `ai.js` / `report.js` / `reports.js` | AI 业务封装（学情报告、整页识别、错题变式、通用对话，都转给 `ai-client.js`）与 AI 学情报告；学情统计 |
| `word.js` / `phonics.js` / `win-speak.js` / `pos-*.js` | 单词训练、语音基础、TTS 发音、词性词库 |
| `seed.js` / `config.local.js` / `builtin-config.js` | 初始化数据；MySQL 连接信息；内置配置 |

## 请求与权限

- `/api/admin/*` 管理端，角色 admin（校长）或 branch（分校），权限一致；`/api/stu/*` 学生端。鉴权用 JWT，由 `Authorization: Bearer` 传递。
- `<video>` / `<iframe>` / `<img>` 由浏览器直连，不能带 Authorization 头，所以本地文件代理地址 `/api/file?key=...` 把 token 拼在 URL 上（`withFileTicket` / `withTicket`）。OSS/七牛的签名外链原样返回。
- 扫码上传（`/api/up`、`/api/report-scan`）用独立的一次性 token，不走登录态。

## 测试与 CI

根目录测试：`smoke.js`（后端端到端，需服务已启动）、`bank-test.js`、`word-test.js`、`wrong-test.js`、`storage-test.js`、`ui-test.js`（需 jsdom）、`report-test.js`、`wrong-ui-test.js`。CI 见 `.github/workflows/ci.yml`。

## 学生端做题弹窗与课程页（R8）

- 做题弹窗 `BankQuiz.open()`（`public/js/bank.js`）是课文习题、小分组练习、试卷、错题重做 / 复习、自组卷共用的一个 DOM 组件：桌面端定高（`min(86vh,760px)`），右侧栏 = 计时 + 题号四色方格（未做 / 已做 / 答对 / 答错，可点击跳题），左侧 = 题卡（内部滚动）+ 底部按钮；所有模式都是「提交本题 → 立即核对（`/check`，不落库）→ 全部核对完交卷（`/submit`）→ 报告」。手机端（≤760px）全屏，题号改成顶栏下的横向滚动条。
- AI 老师浮层也在 `bank.js` 里（每个做题弹窗各自一份状态）：对话按「题目 × 模式（直接讲解 / 一步步引导）」分别保存；用 `fetch` + `ReadableStream` 读 `/api/stu/bank/ai-explain/stream` 的 SSE（`EventSource` 不支持 POST 和登录头）；Markdown 用 `r8Md()` 轻量渲染，流结束后 `mtxTypeset` 排公式。
- 课程页（`public/js/vue-app.js` 的 `course` 页）：右上角进度 + 正确率、顶部「知识点掌握」卡（环形 + 两个指标 + 继续学习）、左侧小分组卡（已学 / 正确率 / 小分组练习）、视频卡知识点标签（点开是 `showNodeMastery` 弹窗）。样式都在 `public/css/app.css` 末尾的 `r8-` 段。

二轮进行中：`tree-mapping.js` 负责章节与知识点映射；`mfpack-adapter.js` 负责常见外部题卡转换；`r6-compose.js` 复用题库的目录、题卡和本地试题篮。

`difficulty.js` 统一处理十级精度与原有五星字段的校验和同步；无十级来源时保留空值，既有按五星的筛选和组卷不变。

`ai-proxy.js` 仅为 `ai-client.js` 的 AI 请求选择 HTTP(S) 代理，按标准代理环境变量与 `NO_PROXY` 判断，回环地址直连；不更改全局 Agent 和 TLS 校验。

`public/admin/intake-flow.js` 为录题入口共用的传输超时、离页回调保护、sessionStorage 草稿及批次恢复提示和教程；在录题页面脚本前加载。文件本体不保存在浏览器草稿中，恢复不等于字节级续传或后台任务。英语细分兼容关系统一由 `public/js/question-subtypes.js` 提供，学生端与后台均加载；Word、Excel 和 JSON 导入复用它。

## 七入口的恢复与公共交互（2026-11-06）

- `public/admin/intake-flow.js` 统一教程、按账号的本机草稿、准备范围、请求指纹和结果查询。草稿从旧 sessionStorage 兼容迁移至 localStorage；文件二进制不持久保存。`upload.html` 使用上传通道提供的稳定账号/角色范围，短票据更新后仍可找回本机文字及提交线索。共享电脑由用户在完成后清除草稿；不同设备不自动同步。
- `src/intake-receipts.js` 在三个现有暂存表保存请求回执；入口路由在创建批次的同一事务中记录输入摘要及结果。相同恢复凭据不会重复建立批次；相同凭据不同输入报错。页图单独在原有 pages JSON 中记录上传凭据。`src/intake-scope.js` 共用范围校验，仅使用真实存在的教材版本。
- `src/intake-jobs.js` 是现有单进程服务共用的在途 Map：`mfbank.js` 的识别/转写/整理/旧 Word/建议请求互斥，`bank.js` 的教师扫码异步识别也登记状态。重新进入工作台轮询当前页；关闭页面后已发请求继续保存，尚未发出的后续页不自动排队。进程重启不恢复内存中的调用，持久页图/草稿仍在；未引入队列/多进程分布式锁。
- `public/js/api.js` 的 `DialogUX` 为原公共弹窗提供焦点、Tab、Escape、嵌套窗口与取消 Promise 收尾；`admin.js` 提供整页错误重试、保存期间防重复、表单标签及表格操作列增强，保留原业务提交校验。`theme.css` 仍限定后台作用域。
- CI 安装固定 Playwright/Chromium，实际执行浏览器恢复/页面检查并上传 35 页面三种视口的截图。没有安装浏览器时旧脚本仍会明确报告跳过；本轮本地验证使用明确 `CHROMIUM_PATH`，不以跳过冒充浏览器通过。

## 圆润版视觉覆盖层（2026-11-08，十张确认稿）

- 学生 `ui-rounded-student-20261108.css` 在旧学习空间样式后加载，承载顶部导航、手机底部导航、深绿首页、课程双栏与错题卡。`vue-app.js` 和 `bank.js` 复用已有 API、权限、状态、课程播放器和错题导出范围，不新增服务端能力。
- 管理端 `ui-rounded-shell-20261108.css` 与 `ui-rounded-pages-20261108.css` 最后加载。前者统一薄荷侧栏、圆角卡片和首页；后者覆盖审核、组卷、录题、学情。审核保留分类保存与入库分离；低高度桌面保留三项关键操作可达。样式仅作用于已有页面类。
- 答题继续使用共享 `BankQuiz.open()`、原判分/提交及 AI 门控。`ui-quiz-20261108.css` 改为森林绿/暖白/琥珀黄；未核对 AI 面板收敛但保留关闭与恢复。原数字键盘和 MathLive 公式弹窗不变。
- 增加 `test:ui-rounded:unit`、`test:ui-rounded:browser` 以复现合成前端验收。无构建步骤、依赖升级、后端路由或数据库迁移。完整说明及接受的交互差异见 `docs/rounded-ui-implementation-20261108.md` 与 `design-qa.md`。
