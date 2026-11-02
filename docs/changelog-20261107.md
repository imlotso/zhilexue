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

## T4 知识树统一（2026-11-02）

### 调用方清单（任务书步骤 2）
改动前，"知识点树"有两套：旧 `kb_units`/`kb_points`（教材知识点树：学科+学段+年级 → 单元 → 知识点）和新 `bank_trees`/`bank_tree_nodes`（章节树 + 知识点树，题目靠 `question_nodes` 挂节点）。

| 位置 | 用什么 | T4 后 |
|---|---|---|
| `bank.js` `GET /kbtree`、`POST/DELETE /kbtree/unit`、`POST/DELETE /kbtree/point` | 旧表 | 读写知识点树（`src/kbtree.js`），返回结构不变，`id` 变为树节点 id |
| `bank.js` `POST /kbtree/generate`（AI 拆解） | 旧表，**覆盖**该年级 | 写知识点树，**合并**（只新增，不删） |
| `bank.js` `GET /points`（知识点下拉） | `questions.point` 文本，**不读 kb 表** | 文本 ∪ 知识点树叶子名，仍是字符串数组 |
| `bank.js` `POST /ai-attri`（AI 归属建议）第 360 行 | 旧表单元名 | 知识点树的单元（`unitLines`），树里没有则回退旧表 |
| `mfbank.js` 录题 `aifill`（AI 补答案/分类）1574 行 | 旧表知识点名 | 知识点树叶子名（`pointNames`），回退旧表 |
| `public/admin/bankui.js` 旧「教材知识点树」弹窗（451–490 行） | `/kbtree*` | **删除弹窗**，按钮改为跳转「知识树管理」页 |
| `public/admin/bankui.js` 114/311/607 行（知识点下拉） | `/points` | 不变（接口保持兼容） |
| `public/admin/mfbankui.js` 541 行（录题工作台分类清单） | `/kbtree` 的 `list` | 优先用 `/kbtree` 新增的 `points`（树里全部知识点名） |
| `public/admin/mfui2.js`（题库管理、挂题、组卷）、`bank.js` 学生端 `scan-tree`/`scan-compose` | 已经读 `bank_trees` | 不变 |

学生端没有直接读 `kb_*`。

### 改了什么
- **并入已有树，而不是新建一棵**：`mfui2.js` 按"学段+学科 唯一一棵知识点树"取树（`trees.find`），所以旧单元不能放进新建的第二棵树（会在题库管理里看不到）。`src/kbtree.js` 把旧内容复制进该 学科+学段 已有的知识点树，作为一级分支「教材单元知识点」→ 年级 → 单元 → 知识点；没有树时（如物理/化学，种子只建了数学/英语）才新建。幂等、只增不删、不改 `kb_*`。
- **复制时机**：`scripts/migrate-kb-to-trees.js [--dry-run]` 批量；旧 `/kbtree*` 接口首次用到、旧表有数据且尚未复制时自动复制该 学科+学段（读取类的 AI 补全/下拉只读，树里没有时回退读旧表，不写库）。
- **统一管理页**「知识树管理」（`public/admin/ktreeui.js`，菜单 智能题库 → 知识树管理）：选 类型（章节树/知识点树）+ 学段 + 学科；节点增删改名、同级上移/下移、全部展开/收起；树的创建/改名/删除；知识点树可「AI 拆解教材知识点」。删除节点时确认框写明子节点数和受影响的题数。此前后台**没有**任何编辑 `bank_trees` 节点的界面。
- 新接口 `POST /nodes/:id/move`（同级上移/下移）。种子数据里同级 `sort` 常是同一个值，直接对调 `sort` 不起作用，所以服务端先把同级顺序规范成 0..n-1 再对调。
- 没有加表、加列。

### 验证
- `kbtree-test.js`（新，33 项，进了 CI）：dry-run 不写库且数字与真迁移一致（测试抓到并修掉一个 dry-run 重复计数的 bug）、并入已有树不新建第二棵、重复执行新增 0、旧接口返回结构不变、删除级联清题目关联、合并不删已有节点、未迁移时回退读旧表且不写库、种子树叶子也在清单里。
- `smoke.js`（+10 项）：上移/下移（含同级 sort 相同、已在最前、非法方向/不存在节点）；旧 `/kbtree` 接口写入的内容出现在新树的「教材单元知识点」分支里；`/points` 含树里的知识点；删单元级联。
- 无头 Chromium 验证「知识树管理」页（16 项）：种子树显示、创建树、增/改名/上移/删除、删除确认框含子节点数、AI 按钮只在有教材版本的学科+学段出现、无脚本错误；旧题库页按钮跳转到新页。
- 回归：smoke 140/0、word-test 60/0、wrong-test 44/0、kbtree-test 33/0、bank-test 29/0、storage-test 34/0。
- `/kbtree/generate` 只验证了接口逻辑与错误路径（AI 返回非 JSON、缺年级、无教材版本），**没有调用真实 AI**，也没有在库里生成数据。

### 没做 / 遗留
- **步骤 6 初始数据**：需要真实 AI 调用，且首批范围（学科、年级、版本）要 BOBO 与客户确认（见 pending）。管理页里已有「AI 拆解教材知识点」按钮，确认后点一下即可；本次没有生成演示数据，也没有往任何库里灌数据。
- 迁移脚本**没有在真实库执行**（没有真实库连接）；真实库里 `kb_units` 有多少数据未知。
- "组卷、课文习题里选知识点用同一棵树"：组卷（T5）和课文习题（T6）还没改，那两处会在各自任务里接到这棵树；学生端 `scan-tree` 本来就读 `bank_trees`。
- 旧 `/kbtree/unit` 等写接口保留但已无前端调用方。
- 旧 `kb_*` 表冻结（不再写入），未删除。

## T3 「待审核题目」统一入口 + 来源标注（2026-11-02）

### 题目从各入口到入库：改动前 / 改动后（任务书步骤 1）
| 入口 | 路由 | 改动前 | 改动后 |
|---|---|---|---|
| Excel | 老的隐藏页 `bankui.js` → `bank.js POST /questions/import`（菜单里**没有**这个入口） | 解析后**直接入库** | 新增 `POST /ext/import-excel` → 批次 `excel` → **待审核**；老的隐藏页未动 |
| Word（录题台） | `intake/runs/:id/word` | 抽文字 → **走 AI 结构化** → 题卡 → 整批 commit | 保留；题卡同样出现在待审核（来源 Word导入） |
| Word（新） | — | 无 | 新增 `POST /ext/import-word`：**规则解析不调 AI** → 批次 `word` → 待审核 |
| 课文习题里的 Word | `bank.js videos/:id/import-docx` | 直接入库并绑视频 | **未改**（T6 范围） |
| 拍照 / PDF 识别 | `intake/runs/*`（页图 → ocr → structure → aifill → drafts → commit） | 有暂存（批次题卡），整批 commit，**只在"录题上传"页里能看到** | 题卡出现在待审核，可逐题入库（来源 拍照识别） |
| 技能包 | `POST /import-pack` | 解析后**直接入库** | 新题放进 `skill` 批次 → **待审核**；去重/补图照旧 |
| 浏览器采集 | `capture/batches/*` | 有暂存（批次 payload），整批 commit，**只在"网络采集"页里能看到** | 出现在待审核，可逐题入库（来源 网络采集） |
| 手机扫码 | `/api/up` → `bank.js autoImportUpload` | **先入库**（来源"学生上传"，并立刻进该学生错题本），审核状态只在 `paper_uploads`；"待审核"只在题库管理左栏一个小入口 | 保持先入库后审核；出现在统一列表（来源 手机扫码），"入库"= 通过，"删除"= 拒绝 |
| 题库管理页手动新增 | `POST /questions` | 直接入库 | **未改**（手动录入本来就是老师自己确认的） |

结论：改动前只有拍照识别和采集有"入库前暂存"，且散在两个页面；Excel、技能包直接入库；手机扫码先入库。客户说的"很乱"就是这个。

### 做了什么
- **`src/mfpending.js`（新）**：把三处数据源聚合成一个待审核列表，每条带来源标签；逐题编辑、逐题/批量入库（可统一改学科学段年级、挂知识点树/章节树节点、加标签）、删除；`badge-counts` 带上待审核总数。**不新建表，不加列**（理由和备选方案见 D15）。
- **`mfbank.js`**：把整批 commit 的核心抽成 `commitRunCards` / `commitCaptureItems`（老端点行为不变，另外支持 `material` 和多个节点）；技能包导入改为先进待审核。
- **`src/wordq.js`（新）**：Word 规则解析（见 D16）。用客户两份样例实测：
  - 《word (1).docx》规则文档：**6 道大题 → 7 题**全部识别（单选 / 多选 / 判断 / 填空 / 单小问问答 / 多小问问答拆成 2 题）；旧解析器只认出 **1 道**（它要求题号全文递增，客户文档每个题型从 1 重新编号）。
  - 《洋葱题库-样例.docx》：**10 题**全部识别（6 单选 / 2 填空 / 2 判断），与旧解析器一致。
  - 不合规格式给出"第 N 段 + 原因"：选项写成（A）/【A】/A)、缺「答案：」、单选给两个答案、多选只给一个答案、答案字母不在选项里、判断答案不认识、填空空数与答案数不一致、多小问缺某一问答案；其余题照常导入。
- **Excel（`bank-excel.js`）**：忽略模板的【例题】示例行；`选择填空题` 干扰项留空时用同一题干下的答案做共用选项。**模板 `习题导入模板.xlsx` 逐字节复制到 `data/`，由 `GET /ext/import-template` 提供，不改表头和列顺序。**
- **前端「待审核题目」页**（`pendingui.js`，菜单 智能题库 → 待审核题目）：按来源分页签并带数量、搜索、全选/批量入库/批量删除、逐题编辑（题型、材料、题干、选项、答案、解析、知识点、学科学段年级、难度）、LaTeX 渲染、图片预览；两个导入弹窗，导入后列出没导入的行/段和原因；"AI 补全答案/分类"按钮复用录题台的 `aifill`。

### 验证
- `wordq-test.js`（新，29 项，进 CI unit）：两份客户样例的题数与题型、各种不合规格式的段号和原因、选项同行/顿号/`U.S.A.` 不误拆、解析里的"1. xxx"不被当成新题（**测试抓到并修掉**：解析列表项恰好等于"上一题号+1"时会吞掉下一道真题，改为向后看是否有选项/答案）。
- `excel-test.js`（新，10 项，进 CI unit）：客户 9 个 sheet 模板原样 → 0 题 0 报错忽略 9 组示例；把示例当真实数据 → 18 题 0 报错（**测试抓到**：`选择填空题` 示例原来会整题报错，已修）。
- `pending-test.js`（新，57 项，进 CI api）：三个入口（Excel / Word / 手机扫码）加技能包、拍照、采集，全部出现在同一个列表且来源标注正确；编辑；逐题/批量入库（内容、节点、标签、批次收尾）；不能重复入库；删除（含手机扫码拒绝时连错题本一起删）；老的整批入库接口回归；**过期 id 防错位**（**测试抓到的真实风险**：删除后序号前移，旧页面上的 id 会指向另一道题，现在 id 带题干指纹，对不上就拒绝）。
- 无头 Chromium 把新页面走一遍（17 项）：页签与计数、六种来源标签、筛选/搜索、编辑、逐题入库后在题库管理能查到、批量入库挂知识点节点和标签、删除确认、Excel/Word 导入弹窗与错误提示、模板下载与客户原文件逐字节一致、无脚本错误。
- 回归：smoke 140/0、word-test 60/0、wrong-test 44/0、kbtree-test 33/0、bank-test 29/0、storage-test 34/0。

### 没做 / 遗留
- 客户的 Word 要求里"导入成功后可使用【自动修正格式】功能"没做（那是对方系统的功能）。
- "AI 补全答案/分类"只对批次型来源（拍照识别 / Word / Excel / 技能包）有效；采集和手机扫码的题请在编辑里手动补。该按钮调用真实 AI，**我没有调用**（测试环境用 `AI_MOCK`），未做真实联调。
- 编辑弹窗里没有单题的"AI 归属建议"按钮（`/ext/ai-attrib` 接口还在）。
- 侧栏菜单上没有待审核数角标（页签上有数量；`badge-counts` 已带 `pending`，前端未接）。
- 手机扫码的上传页和流程没改；题库管理左栏原有的"待审核"小入口保留（与新页的"手机扫码"重叠）。
- 数学公式编辑器、图片友好度（T8）、英语听力题（T7）不在本任务。
- 老的隐藏页 Excel 导入（`bankui.js` → `bank.js`）、课文习题 Word 批量上传（T6）仍直接入库。
- 客户模板里 `选择填空题` 示例的 5 个小题答案是 `A hospital.`、`A reporter.`×4（去重后 2 个选项），照示例导入后需要老师在待审核里补选项。
