# AGENTS.md — zhilexue 项目约定

本文件是 agent 开工前先读的入口，保持简短。这是约定，不是审批流程；拿不准时问 BOBO。

## 项目是什么

智学课堂（zhilexue.top）：中小学学习系统，包含学生端、校长/分校后台。Node.js + Express + MySQL，原生前端（学生端 Vue 3 全局构建，后台 Vue 2 + element-ui），没有构建步骤，改完刷新即生效。

## 读取顺序

1. 本文件。
2. `docs/taskbook-20261107.md`：当前改版任务书，只读与当前任务相关的章节。
3. `docs/architecture.md`：不熟悉代码结构时看。
4. 改接口或表之前，看 `docs/api.md`、`docs/database.md` 里对应的部分。

## docs 文件地图

| 文件 | 用途 | 什么时候看 / 更新 |
|---|---|---|
| `docs/taskbook-20261107.md` | 2026-11-01 到 11-07 改版任务书（T0–T14） | 开工前读；范围变化由 BOBO 修改 |
| `docs/architecture.md` | 技术栈、目录结构、前后端对应关系、存储与数据库如何选择 | 结构性改动后更新 |
| `docs/api.md` | 全部 HTTP 接口按模块的清单（挂载前缀、路径、用途、所在文件） | 新增/修改/删除接口时同步 |
| `docs/database.md` | 表的分组与用途、改表方式 | 加表/加列时同步 |
| `docs/tree-import-format.md` | 目录树 JSON 导入 / 导出格式（R2）：给本地 agent 采集回来的树用，后台、接口、`scripts/import-trees.js` 共用 | 改树导入导出时更新 |
| `docs/decisions.md` | 关键取舍及理由（为什么这样做） | 做了重要取舍时追加 |
| `docs/pending-human-actions.md` | 只有 BOBO 能处理的事（真机测试、素材、真实库连接、打标签、发布） | 遇到需要人处理的事时追加 |
| `docs/cleanup-list.md` | 2026-11-02 源码清理记录：哪些保留、哪些排除、依据 | 一般只读 |
| `docs/原始需求/` | 客户给的原始需求文件（改动需求、客户额外要求、题库样例、导入模板、教辅资料、错题集样例、word (1).docx），保持原文件名 | 理解需求原意、任务书有歧义时查阅；只读，不得修改、重命名或删除；与任务书冲突时问 BOBO |
| `docs/changelog-20261107.md` | 改版记录：每个任务改了什么、怎么验证、遗留问题 | 每个任务结束后写 |
| `docs/self-check-20261107.md` | 自测清单：验收项勾选结果 | 收尾时写 |
| `docs/release-steps.md` | 发布与回滚步骤（给 BOBO 用） | T14 生成 |
| `docs/screenshots/20261107/` | 自测清单引用的关键截图 | 一般只读 |

## 文档同步约定

代码改了，相关文档随同一次提交一起更新，不单独开任务：

- 新增、修改、删除接口 → 更新 `docs/api.md`。
- 加表、加列 → 更新 `docs/database.md`。
- 功能或行为有变化 → 在 `docs/changelog-20261107.md` 写一段。
- 代码目录或模块关系有变化 → 更新 `docs/architecture.md`。
- 做了重要取舍 → 追加到 `docs/decisions.md`。
- 遇到只有人能处理的事 → 追加到 `docs/pending-human-actions.md`。

小改动可以只在提交说明里写一句，不必每次都改文档。

## 项目事实（避免踩坑，不是限制）

- 私有仓库。`src/config.local.js`、`src/builtin-config.js` 和文档里的账号密码按现状保留并提交，不要改成环境变量，也不要脱敏。
- 数据库是 MySQL（README 里写的 SQLite 已过时）。改表结构走 `src/db.js` 的幂等建表/加列，SQL 写 SQLite 方言（由 `db.js` / `mysql-sync.js` 转换），只加不删。
- 真实库只读核对，写入类验证用测试库。连真实库前先备份。
- 学生端入口是 `public/js/vue-app.js`；后台入口是 `public/admin/index.html` 加载的各脚本。根目录的测试文件依赖相对路径，不要移动。
- 改完跑相关测试（如 `npm run smoke`），CI 见 `.github/workflows/ci.yml`。
- 分支用 `feat/tN-简短名`，提交前缀 `tN:` / `fix:` / `docs:`。标签由 BOBO 手动打，agent 不创建标签。
