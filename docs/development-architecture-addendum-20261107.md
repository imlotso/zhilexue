# 本轮架构增补（2026-11-07）

本文件补充[原架构说明](architecture.md)，列出本轮连接、权限、界面和存储变化。原文保留；同一功能有差异时，以本轮代码及此增补为准。

## 数据库连接与只读预检

- 连接信息由 `src/db-connection.js` 读取：环境变量 `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` → `src/config.local.js` 的 `mysql` 字段；库名默认 `xuexi`。正常启动保留原配置回退行为。
- 树导入和旧知识点迁移的 `--dry-run`（导入也支持 `-n`）使用独立只读连接，不加载初始化型 `src/db.js`。只连接已有数据库，每次初始化或重连均设置 `SET SESSION TRANSACTION READ ONLY`；缺库、只读设置失败或本地配置损坏时停止。程序层仅接受当前预检所需的简单 SELECT，不执行建库、改库、schema 更新或旧 SQLite 导入。此过滤不是任意 SQL 的通用安全隔离层。

## 模块职责

| 模块 | 本轮职责 |
|---|---|
| `db.js` / `db-connection.js` / `mysql-sync.js` / `mysql-worker.js` / `import-sqlite.js` | 建表、连接配置、显式只读预检与 SQLite→MySQL 转换 |
| `auth.js` / `delpwd.js` | JWT 鉴权并逐请求复核账号存在、角色、状态及学生/分校到期日期；删除确认密码 |
| `qmeta.js` | 题目关联信息与共用扫码题可见范围：校长可管理全部待审题；分校不能访问外校或无有效所属学生的待审题；学生取题与公共发布排除全部 pending/reviewed 扫码题。以 paper_uploads 状态和关联关系为准，不更改历史数据 |

## 请求与权限

- `/api/admin/*` 管理端，角色 admin（校长）或 branch（分校）；共享教学资源沿用原权限，学生记录及其待审核扫码题按当前所属分校隔离。`/api/stu/*` 学生端。鉴权用 JWT，由 `Authorization: Bearer` 传递，每次请求复核真实账号。详见 `access-isolation-20261107.md`。
- 扫码上传（`/api/up`、`/api/report-scan`）使用独立的短期 token，不走普通登录态。本轮修改的 `/api/up` 教师票据与 `/api/mfcap` 采集票据绑定签发账号和角色，使用时复核当前账号；未更改 `/api/report-scan`。旧未绑定账号角色的教师/采集票据需要重新生成，学生扫码票据保持兼容。

## 测试范围


`npm run test:takeover` 包含 `t13-font-fit-test.js`、`astra-readonly-tree-cli-test.js`、`astra-tree-cli-offline-e2e-test.js` 和 `astra-paper-library-search-test.js`，覆盖生产字号适配、受控 mysql2 边界、真实 CLI 子进程与树处理函数，以及生产试卷页面与列表查询，均不连接真实数据库。待审题隔离和树 CLI 回归使用锁定的 `better-sqlite3` 内存库，兼容项目既有 Node 20 和 Node 24；不依赖 Node 20 缺少的 `node:sqlite`。CI 另外显式执行单词/后台响应式组件的 `--browser` 几何检查，不能将默认源码契约检查当成浏览器结果。2026-11-07 的本轮验证范围与缺项见 `cloud-continuation-20261107.md`。

`npm run test:access` 执行 10 组账号、分校及待审题隔离回归，已加入 `test:takeover`。使用合成内存 SQLite 和实际处理函数，替换 JWT、路由、存储/AI 等外部边界；不需要真实库或网络，也不能替代真实 Express、MySQL 或浏览器验收。

## 预览、打印与学生自组卷

2026-11-07 续作：管理端 `bankui.js` 的课文习题、组卷预览和试卷编辑共用 `bkQRich` 富内容与 `bkBindRich` 公式/图片绑定；独立打印窗口复用 `mathlib.js` 导出的 `mtxPrepareFormulaBreaks`，不复制第二份公式预处理算法。学生自组卷 `scanFlow` 使用 `scan-tree` 返回的本人可用树列表按精确树ID切换，计数/提交仍沿用原节点范围校验。接口增量及验收边界见 `development-consolidation-20261107.md`。


## 班主任工作台


### care 数据层恢复（ISSUE-002）

`public/apps/care/assets/js/store.js` 从受控基线恢复并去除未核实示例。`app.js` 等待既有 `/api/me` 与 `/api/admin/grades-roster` 成功后启用工作台；浏览器记录/设置按服务器确认的 role:id 分区，旧未归属v1键不自动迁移。依赖或账号失败显示明确状态。此模块仍为本机存储，不是服务端共享记录；具体边界与验收见 `issue-002-care-recovery-20261107.md`。

### 私有录音（ISSUE-003）

`src/care-audio.js` 管理服务器核定owner/branch的元数据及 `data/private-care-audio` 私有字节，前端认证fetch→blob播放。所有静态挂载和通用文件读取均保护录音目录及默认index别名，旧URL仅在人工审核映射后鉴权读取。原文件保留但未知归属不自动恢复；拒绝歧义请求路径。部署与不可退回匿名读取的回滚要求见 `care-audio-security-20261107.md`。
