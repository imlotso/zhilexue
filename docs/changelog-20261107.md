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
- 已补：`docs/architecture.md` 新增"数据库如何选择"一节（运行时只有 MySQL；连不上直接崩溃）。

## T1 手机端视频无法播放（2026-11-02）

### 排查结果（D1–D7）
云环境没有真实视频、生产 OSS/CDN 和手机，下表区分"已实测"和"待 BOBO"。实测环境：无头 Chromium（带 H.264，不带 H.265 解码）+ 手机视口/触屏/iPhone UA，样本视频用 ffmpeg 生成（H.264+AAC 带/不带 faststart、H.265、VP9、竖屏 9:16），上传到本地存储的测试课程。

| 步骤 | 结论 | 依据 |
|---|---|---|
| D1 编码 | **能复现客户症状**；真实库视频未核对 | H.265 样本：声音正常、画面全黑、时间在走，`readyState=4`、`error=null`、`videoWidth=0`，**浏览器不触发 error 事件**。H.264、VP9 正常。真实库视频编码分布待 BOBO 提供只读连接（见 pending） |
| D2 moov 位置 | 检测手段已就绪；真实视频待核对 | `scripts/check-video.sh` 对样本正确区分 faststart（moov 在前）与非 faststart（mdat 在前），并识别 H.265/VP9 |
| D3 响应头 | 本地存储模式**正常**；OSS/CDN 待 BOBO | 本地 `/api/file`：`206 Partial Content`、`Accept-Ranges: bytes`、`Content-Type: video/mp4`、无 attachment |
| D4 CDN 防盗链 | 待 BOBO | 云环境访问不到生产 CDN |
| D5 手机内置浏览器 | 待 BOBO 真机 | 待测清单已写入 pending |
| D6 弹窗布局 | **未命中**；但发现一个次要问题 | 375×667、414×896、360×560、横屏 667×375：弹窗无溢出；`.mask` z-index 140 高于底部导航 40，导航中心点最上层元素是遮罩，控制条不被遮挡。次要问题：没有画面（出错/H.265）时播放区塌成默认 150px |
| D7 签名过期 | 记录 | OSS 签名 1 小时过期；"重新加载"会重新请求 `/play` 取新链接，已兼容 |

**结论**：客户说的"放不了"，在能复现的范围内最符合 **D1（H.265 等浏览器解不了的画面编码）**：声音正常、画面黑屏、没有任何提示。是否是线上真实原因，取决于 BOBO 核对真实库视频编码和真机结果。

### 改了什么
- `public/js/vue-app.js`（`playVideo`）：
  - `<video>` 去掉 `autoplay`，加 `webkit-playsinline x5-playsinline x5-video-player-type="h5-page" x5-video-player-fullscreen="false"`；由脚本发起 `play()`，被浏览器拒绝时显示"▶ 点击视频开始播放"（不会盖掉真实错误：`NotSupportedError` / `AbortError` 不触发该提示）。
  - 监听 `error`（按 `video.error.code` 区分网络/解码/格式或链接失效）、`stalled` / `waiting` / `abort`（10 秒仍未缓冲好显示"加载很慢"软提示，恢复播放后自动消失）。
  - **`videoWidth === 0` 检测**：识别"只有声音没有画面"（见 D13）。
  - 提示层带"重新加载"（重新请求 `/play` 取新链接）和"用浏览器打开"（`target="_blank"`）。
  - 竖屏视频（高>宽）加 `t1-portrait`，保持按视频比例显示。
- `public/css/app.css`：新增 `t1-` 前缀类；`max-width:640px` 下播放区固定 16:9，视频铺满并按比例留黑边。不改桌面样式、不改旧选择器。
- `public/admin/vcodec.js`（新）：把 `phonics.js` 里的 H.265 检测抽成 `checkVideoCodec(file)`；`phonics.js` 改用它；`admin.js` 的 `uploadVideoDirect()`（后台通用视频上传唯一入口，新增/编辑视频两处都走它）在 `direct/init` 之前调用，H.265 被拦截。
- `scripts/check-video.sh`（新）：输出视频/音频编码、是否 faststart，并打印 ffmpeg 修复命令。
- 静态资源版本号：`index.html`、`admin/index.html` 里 `vue-app.js`、`app.css`、`admin.js`、`phonics.js` 的 `?v=` 已更新，避免手机浏览器吃旧缓存。

### 验证
都在云环境用无头 Chromium（手机视口 + 触屏）实测，**不能代替真机**：
- 播放：H.264、VP9 正常播放；H.265 显示"只有声音、没有可显示的画面…"+ 两个按钮，不再黑屏无提示。
- 错误路径（9 项）：`play()` 被拒显示点按提示并可恢复；视频地址 404 显示"不支持该格式或链接已失效"；点"重新加载"重新请求 `/play` 并恢复；"用浏览器打开"是新窗口链接；卡住 10 秒出软提示并在恢复后自动消失；关闭弹窗后无残留提示层。
- 布局：手机横屏视频 375×211（16:9），竖屏视频 195×347（与改前一致），桌面 1000×496 不变。
- 后台：H.265 被 `checkVideoCodec` 与 `uploadVideoDirect` 拦截，且**没有**发出 `direct/init` 请求；H.264 放行；后台页面无脚本错误。
- 回归：smoke 130/0、word-test 60/0、wrong-test 44/0、bank-test 29/0、storage-test 34/0（与 T0 基线一致）。
- 验证用的 Playwright 脚本没有提交到仓库（依赖 Playwright 且需要测试库里的样本视频）。

### 遗留 / 需要 BOBO
- 真机（iOS Safari、Android Chrome、微信）验证、真实库视频编码与 faststart 核对、生产 OSS/CDN 响应头检查：见 `docs/pending-human-actions.md`。
- 若真实库里确有 H.265/非 faststart 视频，需 BOBO 决定是否让客户重传；本次**没有做服务器端转码**（任务书明确不做）。
- 前端编码检测只拦 H.265（读文件头尾 2MB 找 `hev1/hvc1`）；VP9/AV1、非 AAC 音频不拦。
- 后台视频预览弹窗（`admin.js` 里的 `<video ... autoplay>`）未改。
