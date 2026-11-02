# 改版记录（2026-11-01 ～ 11-07）

每个任务结束后写一段：改了什么、怎么验证、遗留问题。

## T0 环境搭建与测试基线（2026-11-02）

### 环境
- Node 20（CI 与任务书一致；云开发环境本地用 Node 22 也能跑）。
- 测试库：云环境装 MariaDB 10.11（MySQL 兼容），root 密码取自 `src/config.local.js`（未改该文件），库名 `xuexi`（utf8mb4）。CI 用 GitHub 自带的 MySQL。
- 启动服务时加 `STORAGE_DRIVER=local`，原因见下"CI 与生产 OSS"。

### 做了什么（对应 PR 顺序）
| 内容 | 文件 | 说明 |
|---|---|---|
| 空库初始化修复 | `src/db.js`、`src/mysql-sync.js` | 已先行合入 `main`（`npm run seed`、`storage-test.js` 在空库通过） |
| smoke 部署物料检查对缺失文件不再崩溃 | `smoke.js` | 6 项仓库自身检查改读仓库根（现在真正在跑）；28 项部署包检查在 `../deploy/` 不存在时汇总为一行"跳过"，不计通过也不计失败 |
| "学生册别已保存"等 4 条用例 | `smoke.js`、`word-test.js`、`guide-test.js` | **根因**：`GET /api/admin/students` 返回分页对象 `{list,total,page,size}`，用例按数组读 `data[0]`。业务正常，只改测试 |
| 分校 6 条用例 | `smoke.js` | 后端要求登录账号为 11 位手机号（`^1\d{10}$`），用例用的 `BR+uniq` 被拒。只改测试 |
| 短语 CSV 导入 | `src/word.js` | **业务 bug**：INSERT 7 个占位符只传 5 个值，导入整体失败。补传 `example`、`example_cn`。保持 CRLF |
| CI：word-test / wrong-test 不再被跳过；服务用本地存储 | `.github/workflows/ci.yml` | `if: !cancelled()`；"Start server" 设 `STORAGE_DRIVER=local`、`AI_MOCK=1` |
| AI 演示模式可用环境变量开启 | `src/ai.js` | `getConfig()` 原把 `mock` 写死为 `false`，`word-test` 的 5 条"AI（演示模式）"用例实际在调真实 AI 接口，CI 连不上而失败并崩溃。改为 `mock: process.env.AI_MOCK === '1'`，未设置时行为不变 |
| 去掉 `api` 任务的 `continue-on-error` | `.github/workflows/ci.yml` | 在上述修复全部到位、CI 全绿之后 |

### CI 与生产 OSS（需要 BOBO 知悉）
`src/storage.js` 默认驱动是 `oss`，`src/builtin-config.js` 内置线上桶 `xuexiku` 的密钥。因此此前 CI 每次跑 `smoke.js`，"上传视频/批量上传/上传讲义"用例都在**写生产 OSS 桶**（`videos/YYYYMM/…`）。现在 CI 的服务进程固定用本地存储。桶里可能残留测试对象，已记入 `pending-human-actions.md`。

### 外部调用说明
云环境本地验证期间，`word-test.js`（AI 补全/生成用例，在加 `AI_MOCK` 之前）和 `report-test.js` 向 `builtin-config.js` 里配置的真实 AI 接口发出过少量真实请求，属于测试的既有行为；加 `AI_MOCK=1` 后 `word-test` 不再调用。`report-test.js` 仍会调用（见基线表）。

### 测试基线（本地，空库 seed 后，`STORAGE_DRIVER=local`）
| 脚本 | 在 CI | 结果 | 说明 |
|---|---|---|---|
| `bank-test.js` | unit | 29 / 0 | |
| `storage-test.js` | api | 34 / 0 | |
| `smoke.js` | api | 130 / 0（28 项部署包检查跳过） | 修复前：114 通过 / 18 失败并在部署检查处崩溃 |
| `word-test.js` | api | 60 / 0 | 修复前：34 通过 / 2 失败并崩溃（短语导入 bug） |
| `wrong-test.js` | api | 44 / 0 | |
| `report-test.js` | 否 | 6 / 5 | **基线已失败**：`builtin-config.js` 内置了真实 AI 地址和 Key，用例假设"未配置 Key"，改为向真实接口发请求（1×1 测试图被对方 400 拒绝）。T2 统一 AI 配置时再处理 |
| `guide-test.js` | 否 | 崩溃 | **基线已失败**：`/api/admin/guides` 路由在仓库中不存在（404；`guides` 表还在，路由和前端都没有）。待 BOBO 确认是否清理时有意移除 |
| `wrong-ui-test.js` | 否 | 15 / 13 | **基线已失败**：断言文案与 11-01 界面不一致（页面能渲染，断言过时） |
| `ui-test.js` | 否 | 7 / 10 | **基线已失败**：同上（如期望左侧第一目录为"速记"，实际为"训练"）；另有与本次同类的过时写法（学生列表按数组读、分校账号非手机号），未动 |

### 遗留
- `ui-test.js`、`wrong-ui-test.js`、`report-test.js`、`guide-test.js` 不在 CI 中，保持"基线已失败"，后续任务不得让它们比现在更差。
- 任务书 T0-2 要求的"MySQL / SQLite 选择条件、连不上时的行为"尚未补进 `docs/architecture.md`。
