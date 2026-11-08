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
- 历史记录：当时“AI 补全答案/分类”只支持批次型来源；现已改为答案/解析建议需老师逐项确认，并扩展到采集和手机扫码，见文末更新。真实试卷和设备仍待验收。
- 编辑弹窗里没有单题的"AI 归属建议"按钮（`/ext/ai-attrib` 接口还在）。
- 侧栏菜单上没有待审核数角标（页签上有数量；`badge-counts` 已带 `pending`，前端未接）。
- 手机扫码的上传页和流程没改；题库管理左栏原有的"待审核"小入口保留（与新页的"手机扫码"重叠）。
- 数学公式编辑器、图片友好度（T8）、英语听力题（T7）不在本任务。
- 老的隐藏页 Excel 导入（`bankui.js` → `bank.js`）、课文习题 Word 批量上传（T6）仍直接入库。
- 客户模板里 `选择填空题` 示例的 5 个小题答案是 `A hospital.`、`A reporter.`×4（去重后 2 个选项），照示例导入后需要老师在待审核里补选项。

## T5 组卷（2026-11-02）

### 改了什么
- **共用组卷核心** `src/compose.js`：管理端「一键组卷」、范围题量 `POST /papers/pool`、学生端 `POST /scan-compose` 都走它。
- **管理端智能组卷页**：新增"组卷范围"——按章节树 / 知识点树勾选节点（选中节点含全部子节点），下方实时显示"范围内共 N 题（单选 x · 多选 y …）"；原来的学科/学段/年级/难度/知识点文字照旧，同时生效。题库不够时提示缺口，仍可手动移除/调整。
- **下发流程**：预览区三个按钮——保存草稿 / **保存并下发给指定学生…**（先存草稿再弹出选学生窗口）/ 保存并下发给全部符合年级的学生。
- **定向下发即专属**：有下发名单的试卷只对名单里的学生可见（任务、试卷列表、打开、交卷四处一致）。见 D18。
- **学生端改名**：章节测评 → 章节组卷、学段冲刺 → 知识点组卷（按钮改"开始组卷"）。
- 修了 `GET /papers/:id`、`POST /submit` 里查下发名单参数顺序写反的老 bug。

### 怎么验证
- `node compose-test.js`：41 项。章节树「第一章」含 1.1/1.2 后代；不存在的节点 → 0 题；题库不足提示缺口；老师组卷→存草稿→下发 2 人，两人"我的任务"可见、可打开（不泄露答案）、可交卷（判分正确、`paper_tries` 各记一条），同年级第三人看不到/打不开/交不了；撤回清空名单；学生 token 调管理端接口 403；学生用知识点树组卷（每个最小知识点 1 题）→ 自测交卷 → 成绩与错题进记录。
- 浏览器（Playwright）走了一遍管理端：选学科 → 按章节选题 → 选树 → 勾节点 → 题量提示 → 一键组卷 → 保存并下发给指定学生 → 弹出选学生窗口；无页面报错。
- 回归：smoke 140、word 60、wrong 44、kbtree 33、pending 57、bank 29、storage 34、wordq 29、excel 10 全部通过。CI api job 加入 `compose-test.js`。

### 遗留 / 没做
- 学生端界面只改了文案，没有真机走查（见待人工确认）。
- 一棵学科下有多棵树时，管理端用下拉选树；学生端仍取"本学段优先的树"。
- 学生自组卷 `kind=self` 的题目 id 校验没收紧（D18）。

## T6 课文习题：固定输入框 + 正确率（2026-11-02）

### 改了什么
- **固定输入框**：学生端做题的填空改为固定宽高的 `textarea`（单空 96px、多空每空 56px，`resize:none`，内容多时框内滚动）；新增问答题解答框（176px）；反馈弹窗的说明框同样固定。只新增 `.t6-*` 样式。
- **正确率**（不加表，从 `records` 聚合，口径见 D19）：
  - 学生端课程页：每个视频、每个小分组、整门课都显示正确率（`正确率 67% · 2/3`；没做过显示"习题未做"）。
  - 做完题后的学习报告：结果页多了"掌握情况"（该视频和所属小分组现在的正确率）和"本次各知识点"（按题目知识点的对错 + 进度条）；交卷成功即刷新课程页数据，关掉弹层看到的已是新数字。
  - 后台：学情管理 → **知识点正确率**（新页面）。搜索学生 → 课程 → 小分组 → 视频逐级显示正确率。分校账号只能看自己校区的学生。
- **问答题**：以前学生端没有输入框，答不了；现在可以写，但不自动判分（不进记录 / 错题本 / 正确率），交卷后给参考答案对照（见 D19）。
- 绑定与题库管理：视频挂小分组、题目绑定沿用原有接口（`videos/:id/bind`）；测试确认绑定的题在「题库管理」里能查到，无需改动。

### 怎么验证
- `node lessonq-test.js`：26 项。手算对照：视频一做 q1 对 / q2 错 → 50%；重做 q2 对、q3 错 → 每题取最近一次 = 3 题 2 对 67%；视频二 2/2 → 小分组合并 4/5 = **80%**（不是平均的 84%）；问答题不进 records / 错题；另一学生不受影响；后台数值与学生端一致；学生 token 403；分校越权被拒、本校区可看；绑定的题在题库管理能查到。
- 浏览器（Playwright）：同一个单空填空框输入 0 / 1 / 200 字，宽高都是 756×96；双空 756×56 不变；问答框 300 字仍 756×176 且框内出现滚动；回车换行被转为空格；做完 3 题后报告显示 67%（2/3），回到课程页视频和小分组标签变为 67%，后台页同值。
- `smoke.js` 末尾新增 3 条（course-detail 带 `acc`、后台 `/accuracy`、学生 403）；`lessonq-test.js` 加入 CI。

### 遗留 / 没做
- 问答题不判分（D19）。
- 公式输入（T8）、听力（T7）尚未做；固定输入框已经给 T8 的公式键盘留好位置（问答框不弹数字键盘）。
- 学生端手机真机上输入框观感未走查（见待人工确认）。

## T2 AI 配置中心统一（2026-11-02）

### 改动前：AI 调用点清单（任务书步骤 1，grep `aiFetch` / `/chat/completions` / `getConfig` / `mfAiInvoke` 得到）
| 文件 | 调用点（接口 / 函数） | 改动前怎么取配置、怎么发请求 | 改动后 |
|---|---|---|---|
| `ai.js` | `analyzePaper`（学情报告，`report.js` 调用）、`segmentPage` / `analyzeWrongQuestion`（错题重组，`wrong.js` 调用）、通用 `chat`、`testConnection` | `getConfig()` 实际只读 `builtin-config.js`（后台表单存的 `settings` 早已不被读取）；`aiFetch` 只支持 https 的 `${base}/chat/completions` | 配置读启用的档案；请求走 `ai-client.js` |
| `report.js` | `GET/PUT /config`；学情报告生成 `ai.analyzePaper` | 同上 | `GET` 只读，`PUT` 停用 |
| `wrong.js` | `analyze`（`ai.analyzeWrongQuestion`）、`segment`（`ai.segmentPage`） | 同上 | 同上 |
| `bank.js` | `POST /ai-attri`（题目知识点归属）、`POST /kbtree/generate`（AI 拆解教材知识点）、学生端 `POST /ai-explain`（AI 老师分步讲解）、`GET /mistake-points`（错题知识点归纳）、`aiRecognizeUpload`（手机扫码上传的视觉识别） | `ai.chat` / `ai.visionChat`，同上 | 同上（`aiRecognizeUpload` 的有无配置判断改读视觉角色） |
| `mfbank.js` | `POST /ai-clean`、`/intake/runs/:id/structure`、`/word`、`/aifill`、`visionCall`（整页识别 / OCR）、`POST /ext/ai-attrib`、`aiExtractQuestions` | 先找 `mfAiInvoke`（五角色档案，仅 OpenAI 兼容），找不到回落 `ai.chat` / `ai.visionChat`（内置配置） | 全部走 `ai-client.js`，档案优先、回落规则见 D20 |
| `mfcollect.js` | `mfAiInvoke`（AI 网关）、`POST /ai-suggest`（批量打标 / 挂树建议）、档案的 `test` / `quick` / `models` | 自己一份 `httpReq` 发 `${base}/chat/completions` | 转 `ai-client.js`；`httpReq` 删除 |
| `word.js` | 例句 / 短语 AI（`aiRows`、`/phrase-examples`、`/phrase-examples-all`、`genPhraseSentence`、`/phrase-sentence`、`aiStructure`） | `ai.getConfig()` 判断有无密钥 + `ai.chat` | 同上（有无配置按档案判断） |
| `app.js` | 学生端 `sentStructsHandler`（`/sent-structs`，句子结构 AI） | `ai.chat` | 同上 |

### 改了什么
- **`src/ai-client.js`（新）**：`chat({ role, messages | system+user, images, json, maxTokens, temperature })` → `{ text, model, via, format }`。三种格式：**OpenAI 兼容**（`/chat/completions`，Bearer）、**Anthropic Messages**（`/v1/messages`，`x-api-key` + `anthropic-version`，`max_tokens` 必填自动补，图片用 `image` 内容块）、**Gemini**（`/v1beta/models/{模型}:generateContent`，`x-goog-api-key`，图片用 `inline_data`，密钥不拼进 URL）。同时支持 http / https（以前只有 https，本机模拟服务也能测）。错误翻译成中文：密钥错 / 地址或模型错 / 连不上 / 域名不存在 / 返回的不是 JSON / 内容为空。
- **档案加 `format` 列**（默认 `openai`，旧数据不受影响）；后台档案表单新增"格式"下拉（换格式时地址提示跟着变）、表单内"测试连接"（不用先保存）、"获取模型列表"按格式走各自的列表接口。
- **配置统一**：`ai.js` 的 `getConfig()` 读"当前启用的档案"；后台「设置」页改名「AI 配置中心」，新增"当前生效"和"测试当前配置"；旧的顶栏 AI 配置弹窗改为跳转到这里（`openAiConfig()`）；`PUT /api/admin/ai/config`、`PUT /api/admin/report/config` 停用。
- 补全 `docs/api.md` 里 `/api/admin/ai` 的路由说明。

### 怎么验证
- `node aiclient-test.js`：55 项，全程只访问本机起的三个模拟服务，不调真实 AI。
  - A. 三种格式的请求逐项核对：路径、鉴权头、系统提示位置、图片内容块、`max_tokens` / `temperature`、JSON 模式、多轮 `messages`。
  - B. 错误提示：401 / 404 / 返回网页 / 空内容 / 端口拒绝连接 / 域名不存在 / 地址不是 http(s) / 没填密钥 / 没填模型名；模型列表（OpenAI 与 Gemini）。
  - C. 后台接口：新增（选格式）、非法格式被拒、没测通不能启用、**测试连接对错误地址给出带地址的明确报错**（已保存的档案和未保存的表单两条路径）、学生 token 不能访问。
  - D. 配一个模拟接口并启用后，**学情报告 / AI 补全 / 拍照识别整页识别三处都走到它**；切换到 Anthropic 档案后三处同时切过去（旧档案收到 0 次请求）；视觉角色另配 Gemini 后看图的两处走 Gemini、文字补全仍走 Anthropic；全部停用回落内置；`AI_MOCK=1` 仍优先。
- 浏览器：AI 配置中心页（当前生效、分组）、新建档案表单换格式时提示变化、错误地址测试报"拒绝连接"、模拟地址测试连通、保存后库里 `format=anthropic`，无页面报错。
- 回归：smoke 146、word 60、wrong 44（均在 `AI_MOCK=1` 下），其余测试不受影响；`aiclient-test.js` 加入 CI。

### 遗留 / 没做
- 没有真实密钥，三种格式只用模拟服务验证（见待人工确认）。
- 没做流式输出；向量角色只支持 OpenAI 兼容格式。
- `builtin-config.js` 仍作为没有档案时的最后回落（D20）。

## T9 错题本改版 + Word 导出（2026-11-02）

### 改了什么
- **学生端错题本重新设计**（`t9-*`）：顶部概览卡（待攻克题数、已掌握进度条、今日待复习）+ 按时间强化的三张卡 + 功能入口卡；按学科换主题色。**删除「收藏夹」入口**（原来只是个禁用的"敬请期待"占位；后端不动）。
- **手机扫码上传**：「拍照上传错题」改成「手机扫码上传」（二维码 → `upload.html` → `/api/up`），二维码说明里写明 AI 会自动识别；提交后进「待审核题目」，来源标「手机扫码（错题）」。
- **AI 识别**：上传的照片走 `analyzeWrongQuestion`（错题重组 analyze 同款）识别学科 / 年级 / 知识点 / 题型 / 题干并自动分类；**修了缺口**：上传时没选学科的以前不建题，现在识别出学科后补建并进错题本（于是也进待审核）。
- **错题 Word 导出**：`GET /api/stu/mistakes/export-docx`（学生）、`GET /api/admin/bank/mistakes/export-docx?user_id=`（后台，入口在学情管理 → 知识点正确率）。可按学科 / 已掌握 / 日期 / 指定题筛选。版式照客户样本：封面 → 错题练习 → 错题解析（答案、解析、答题记录）→ 页脚页码；公式 LaTeX 原样；图片内嵌。新增依赖 `docx@8.5.0`。

### 怎么验证
- `node mistake-test.js`：49 项。用客户《马英惠-数学…错题集.pdf》的 10 道题造数据生成 Word：封面（共10道错题 / 2026年10月28日 - 2026年10月28日 / 姓名·科目）、练习与解析的顺序、1~10 题号、选项与知识点、公式原样、第 2/3/5/9/10 题标「多次答错」、答案（多空用「；」）、解析多行保留、答题记录、页脚 PAGE / NUMPAGES 域、JPEG 原样内嵌且扩展名为 `.jpg`。**文件有效性**：zip/OOXML 结构、`python-docx` 能打开并读出 135 段 / 3 表 / 1 图（可编辑）、LibreOffice 能打开并排成 6 页 PDF（本机有这两样时才跑，CI 上自动跳过）。另测：筛选、只导出本人的错题、没有错题时给提示、未登录 / 管理员走学生接口被拒、后台接口权限与分校越权、扫码 → AI 识别（本机模拟 AI）→ 自动分类 → 待审核「手机扫码（错题）」、前端无「收藏夹」。
- 浏览器：错题本新版页面无报错；导出对话框选范围后真实下载到 `.docx`；二维码弹窗文案；后台页下载成功。
- 回归：smoke、word、wrong、kbtree、pending（标签更新为「手机扫码（错题）」）等全部通过。`mistake-test.js` 加入 CI。

### 遗留 / 没做
- **没有在真实的 Microsoft Word / WPS 里打开**（云环境没有），用 python-docx 和 LibreOffice 验证；见待人工确认。
- 公式是 LaTeX 文本（任务书要求），在 Word 里不是公式对象。
- 图片只支持 JPEG / PNG；其它格式原位置留提示。

## T10 试卷管理（2026-11-02）

### 先验证（任务书要求）
- 学生端 `stu/mfpapers` **不支持搜索**：只有"已发布且不在试题篮 / 回收站"的全量列表（LIMIT 200），按学科的筛选是前端本地过滤。所以按任务书加了 `q` 参数（SQL `LIKE`）及 `subject / grade / year`。
- `mf_papers` 没有年份字段 → 加 `year` 列（幂等）。
- 现有 `intake/runs/:id/commit` 和 `capture/batches/:id/commit` 本来就支持 `paper_id`（提交时把题挂进试卷），图片 / PDF 版真题继续走这条路。

### 改了什么
- **上传真题试卷**：试卷管理页新增「上传真题试卷」→ 选 Word → 识别预览 → 生成试卷；题目同时入题库；按题型分大题；默认分值合计 100；可选立即发布。见 D22。
- **学生端试卷库搜索**：搜索框（卷名 / 年份）+ 年级 / 年份下拉（只列试卷库里实际有的）+ 清除；卡片显示 学科 · 年级 · 年份 · 题数；点击直接做题。
- **成绩**：试卷库试卷交卷后显示"得分 x / 满分"（以前只显示答对几题）。
- 后台试卷列表加 学科 / 年份 筛选；新建试卷表单加年份。

### 怎么验证
- `node paper-test.js`：43 项。用客户洋葱样例 Word：预览不写库（0 新卷 0 新题）→ 生成：10 题入题库（来源=真题试卷、年份 2024、学科 / 年级随卷）、3 个大题标题 + 10 题顺序正确、分值合计 100；学生端搜名称 / 年份 / 学科 / 年级 / 组合都搜得到，搜不存在的没有，SQL 符号不破坏查询，未发布的搜不到、后台发布后立即搜到、取消发布又搜不到；下拉选项只含已发布试卷里有的；学生**完整做完**：打开试卷（不泄露答案、满分 100）→ 全对 100 / 100 → 再做答对一半 50 分，两次成绩都落库，试卷库显示"上次 50 分"，错题进错题本；后台筛选、年份校验、学生 token 不能上传、非 docx / 没选文件有明确提示、删试卷不删题库里的题。
- 浏览器：后台选文件 → 识别预览显示"识别出 10 题：一、单选题 6 题，二、填空题 2 题，三、判断题 2 题" → 生成 → 列表出现；学生端搜"南京"搜到、选年份筛选、点击打开做题；无页面报错。
- 回归：smoke 与其余全部测试通过；`paper-test.js` 加入 CI。

### 遗留 / 没做
- 真题试卷的题目没有走"待审核"（用识别预览代替，见 D22），客户若要逐题审核需要再改。
- 大题标题按题型分组；Word 里原有的小节标题位置不保留。
- PDF / 图片版真题仍走「录题上传」。

## T13 学生端单词页固定布局（2026-11-02）

### 先量（改前，字号「大」、1280×900，一本含极端长短单词的测试词书）
| 步骤 | 改前 | 改后 |
|---|---|---|
| ① 单词学习 | 卡片高度 433 / 516 / 566 / 599 px；下一步按钮位置 759 / 842 / 892 / 925 px；释义区高度 83 / 166 / 250 | 卡片高度恒为 567；按钮位置不变；各区域位置不变 |
| ② 记忆学习 | 卡片高度 20 种取值；选项区高度 7 种；释义在"先问认不认识"阶段是 `display:none`，出现时把下面顶下去 | 卡片高度恒为 838；同一阶段各区域位置不变 |
| ③ 听音拼选 | 没有音标的词比有音标的词整体上移 46 px | 卡片高度恒为 741；位置不变 |
| ④ 默写练习 | 输入框 / 反馈位置随释义长短变化 | 卡片高度恒为 567；位置不变 |

### 改了什么
- 14 处学习卡片加类名 `t13-card`；`app.css` 新增 `.t13-*` 样式（固定高度卡片 + 固定高度区域 + `:has()` 空位保险 + 手机竖屏字号）；新增 `public/js/t13-fit.js`（放不下时缩字号，只改显示）。`words.js` 只改了类名，逻辑没动。设计取舍见 D23。

### 怎么验证
- `node words-layout-test.js`（需要 Playwright；没有浏览器时自动跳过，CI 里就是跳过）：34 项。造一本词书（`a` / `extraordinarily` / `I` / `telecommunications` / `be responsible for` …，释义 1 个字到 40 个字，有的没有音标），在字号「大」「小」两档下走完 ①单词学习 ②记忆学习 ③听音拼选 ④默写练习 四步（共 4×26 帧，覆盖不同长度的词），每帧量卡片高度和各区域相对卡片顶部的位置：同一步同一阶段所有数值只有一个取值，内容放得进卡片（无内部滚动条），页面无脚本错误。「中」档和手机竖屏（390×844）用同样的脚本手动量过（桌面三档都是 0 溢出；手机见遗留）。
- 肉眼对照：`extraordinarily`（带 40 字释义）与 `a`（1 字释义）两张截图里，标签 / 单词 / 音标 / 释义 / 提示 / 按钮完全对齐。

### 遗留 / 没做
- 手机竖屏下「听音拼选」的格子和音节块仍会随单词长度换行，已给最小高度，仍有一行以内的高度差。
- 短语速记、词性训练、考纲单词、连词成句用同一套类名和区域，但没有各造一本书逐个量（需要真机走查）。
- 大字号档在 900px 高的屏幕上卡片 + 按钮超出一屏（以前遇到长单词也是），可以切「中」档。

## T7 听力题（2026-11-02）

### 改了什么
- **题目加音频**：`questions.audio_key`（`bank/audio/…`），题型不新增，在现有题型上附加听力材料（见 D24）。
- **后台录题**：题目编辑、新建、**待审核逐题编辑**三处都有「听力音频」区：「上传音频」（mp3 / m4a / wav / ogg / aac / webm，≤25MB）、「用文字生成朗读」（TTS，可选英文 / 中文）、试听、「去掉音频」。Excel / Word 导入模板没改，音频在待审核页逐题补；入库时写进题目。
- **学生端**：题目上方出现音频播放条（`<audio controls playsinline preload="none">`），做题、交卷结果、错题本卡片、错题重做里都有；加载失败显示"音频没能加载，请检查网络后点这里重试"。
- 后端：`POST /audio/upload`、`POST /audio/tts`、`PUT /ext/pending/item` 支持 `audio_key`；学生端所有出题接口带 `audio_url`。

### 怎么验证
- `node listening-test.js`：30 项（已加入 CI，CI 的服务器带 `TTS_MOCK=1`）。后台上传音频（存 `bank/audio/`）、非音频文件被拒、TTS 生成、学生 token 不能调；创建带音频的听力选择题（题型仍是 single）；编辑不传 `audio_key` 保留音频、换音频、去掉、乱填别的目录或带 `..` 的 key 被拒；Word 导入 → 待审核 → 补音频 → 入库后题库里的题带音频；学生端打开试卷题目带 `audio_url` 且不泄露答案，用播放地址（登录票据在 URL 上）真能取到音频字节、Content-Type 为 audio/wav、**支持 Range（206）**、没票据 401；作答判分（答错 / 答对）；答错的题进错题本，错题本里也带音频。
- 浏览器（Chromium）：学生端打开试卷，播放条在题干上方，`<audio>` 的 `preload=none`、`controls`、`playsinline` 都在，加载后时长 0.8 秒、没有错误；把地址改成不存在的文件，错误提示出现；后台题目编辑弹窗里能看到已有音频和试听器，点「用文字生成朗读」→ 生成 → 名称变为"朗读音频"，页面无报错。
- 回归：smoke 与其余测试通过。

### 遗留 / 没做
- **没有在 iOS Safari / 微信内置浏览器 / Android Chrome 真机上播放**（见待人工确认）。
- TTS 依赖服务器的 Windows 语音；Linux 服务器上会提示改用上传音频。
- 没做时长限制 / 转码、"只能听 N 遍"规则、一段音频对应多个小题的听力大题（见 D24）。

## T8 公式输入（2026-11-02）

### 改了什么
- **MathLive 本地化**：`public/vendor/mathlive/`（0.109.2，MIT；脚本 + 字体 + 许可证），`public/js/mlive.js` 第一次点按钮时才加载（见 D25）。
- **录题端**：题目新建、编辑、待审核逐题编辑里，题干 / 选项 / 答案 / 解析 / 材料旁有「∑ 插入公式」，弹出 MathLive 公式框和虚拟键盘，插入后写成 `\( … \)`；选中一段 `\( … \)` 再点按钮可以改它。题目输入框支持**粘贴 / 拖拽图片**（走已有的 `/asset`，存 `bank/`），在光标处插入 `[图N]`。
- **学生端**：数学 / 物理 / 化学的填空、问答题，答案框旁有「∑ 公式」，输入后插入裸 LaTeX，可以正常提交；其它学科、其它题型不显示。
- **判分**：`fill` 比较前抹平 `\( \)`、`\left \right`、`\dfrac` 等写法差异（不做数学等价）。
- 后端：`serveQ` 和错题本题目多带 `subject`；没有新接口。

### 怎么验证
- `node formula-test.js`：28 项（已加入 CI）。本地 MathLive 脚本 / 字体 / 许可证；含分数、根号的题存库不丢反斜杠；学生端取题带 `subject`；`\(\sqrt{2}\)` 与学生输入的 `\sqrt{2}` 判对，`\sqrt{3}` 判错，`1/2` 与 `0.5` 不互判；`/asset` 上传存 `bank/`；Chromium 里真的点一遍：学生端弹出键盘、输入后答案框里是 `\frac{1}{2}`，后台点「插入公式」得到 `\(x^{2}+1\)`；公式键盘加载过程无外网请求、无脚本报错（没有浏览器时这部分自动跳过）。
- `smoke.js` 新增 3 项（本地文件可访问、`mlive.js` 无外网地址、`/asset` 无文件时拒绝）。
- 回归：smoke 与其余测试通过。

### 遗留 / 没做
- **没有在手机 / 平板真机上用虚拟键盘**（见待人工确认）：键盘占屏幕下半部分，小屏幕上弹出框在上方，要确认不被挡住。
- 不做公式等价判定（`1/2` 与 `0.5`、`\frac{2}{4}` 与 `\frac{1}{2}` 判不同），建议老师在"答案"里用 `|||` 写多个可接受写法。
- 后台"插入公式"只在文本框里放 LaTeX，没有实时预览；预览看保存后的学生端。

## T12 题库与视频存储解耦（2026-11-02）

### 改了什么
- **核对结果**：题目的图片 / 音频 / 录题页图 / 导出试卷本来就统一存在 `bank/` 下（`bankFolder()`），视频在 `videos/`，题目与视频只靠 `video_id` 绑定——所以没有搬文件、没有改 key（见 D26）。
- `src/storage.js`：新增可选环境变量 `BANK_BUCKET`（缺省空 = 与视频同桶）和 `isBankKey` / `bucketFor`，为将来把题库资源放到独立 Bucket 留口子；**本次不实现多桶切换**，`README.md` 新增「题库资源独立存储」写明做法。
- `src/app.js`：单个删除视频时，存储里的文件已经不在了不再让删除失败，题目照常解绑（与批量删除一致）。
- 没有新接口、没有改表。

### 怎么验证
- `node bankstore-test.js`：17 项（已加入 CI）。题目图片上传 `bank/img/`、音频上传和文字生成朗读 `bank/audio/`、新录入的题带 `bank/` 前缀的图片 / 音频、视频 `videos/`；`isBankKey` 不认带 `..` 的；`BANK_BUCKET` 缺省空、配了只影响 `bank/` 的 key；把题目绑到视频 → 删除视频（单个、批量各一次）→ 题目仍在、`video_id` 变空、图片 / 音频文件还在。
- 回归：smoke 与其余测试通过。

### 遗留 / 没做
- **题目图片地址的有效期**：题目里存的是录入时生成的完整地址，OSS 且没配 CDN 时是 1 小时的签名链接，会过期（音频已存 key，不受影响）。已记入待人工确认；先确认线上是否配了 `CDN_DOMAIN`。
- 没做多 Bucket 切换（按任务书只留口子）。

## T11 后台 UI 统一（2026-11-02）

### 改了什么
- **`public/admin/theme.css`（新）**：在 `admin/index.html` 里放在所有样式之后，`<body class="t11">`，全部规则挂在 `body.t11` 下（见 D27）。用 `--t11-*` 变量统一主色、圆角、控件高度、间距、字号；统一按钮（主 / 次 / 危险 / 小）、输入框与下拉、表格、标签、弹窗（含 Element 弹窗里的表单）、卡片、数据卡片。题库管理左栏原来的靛蓝分段按钮改成主色。
- **菜单**（`admin.js`）：分成 首页 / 学生与账号 / 教学资源 / 智能题库 / 学情与报告 / 系统设置；「AI 配置中心」在系统设置下；「待审核题目」在智能题库下，带红色数字角标。菜单项、路由、权限没变。
- **首页**：数据卡片可点；快捷操作 6 个图标按钮；有待审核题目时显示提醒条。学习报告页、学情管理页接入同一套样式（表格最小列宽、一格里多个小标签时给够宽度、宽表格在卡片里横向滚动）。
- **手机宽度**：侧栏改成抽屉（原来是 64px 纯图标栏）；顶栏右侧按钮变成图标；题库管理等两栏页面上下堆叠；弹窗铺满屏幕宽度；所有主要页面不再横向撑破页面（改之前 390px 宽下测过的 7 个页面都有 116–214px 的横向溢出）。
- **没动**：业务 JS 逻辑、接口、数据库、学生端。

### 怎么验证
- `node theme-test.js`：28 项（已加入 CI）。静态：theme.css 在所有样式表之后加载、`<body class="t11">`、其 232 个选择器全部以 `body.t11` 开头、新类名都是 `t11-`；菜单五组顺序、AI 配置中心在系统设置、待审核在智能题库且带角标、每个菜单项都归了组。浏览器（Chromium）：桌面 1300px 和手机 390px 下 10 个主要页面都不横向溢出；首页 5 张卡片 + 快捷操作；主按钮 / 次按钮 / 输入框都是 6px 圆角、34px 高；手机侧栏默认收起、点三道杠滑出、点遮罩收起、点菜单换页后自动收起；页面无脚本报错。
- `smoke.js` 新增 1 项（theme.css 随后台页面加载）。
- 人工看图：改前改后各 15 个页面桌面截图、7 个页面手机截图，逐页对过（首页、学生管理、学习报告、题库管理、待审核题目、AI 配置中心、词书管理、知识点正确率、开通学生弹窗等）。
- 回归：smoke 与其余测试通过。

### 遗留 / 没做
- **没有在真实手机 / 平板上用后台**（见待人工确认）：这里只用 Chromium 模拟了 390px 宽度。
- 各页面里零散的行内 `style="…"`（压过 theme.css）没有改，所以少数页面仍有自己的小差异（例如词书管理里橙色的「纸质化生成」按钮、错题重组页）。
- 学生端、夜间主题没动。

## T14 回归、文档、发布（2026-11-02）

### 做了什么
- **全流程走查** `flow-test.js`（33 项，已加入 CI）：一条线走完任务书的验收流程——Excel / Word / 技能包三个入口录题 → 待审核（来源标注各不相同、逐题修改）→ 入库（挂章节节点、知识点节点、标签）→ 组卷（知识点范围 / 章节范围）→ 保存草稿 → 下发给学生 → 学生在「我的任务」做题交卷（对 4 错 2）→ 课文习题按视频出正确率（3/4 = 75%，后台与学生端一致）→ 错题进错题本 → 导出 `.docx`（`PK` 包、`word/document.xml`、响应头题数一致）。重复运行两次结果一致（测试数据按 id 清理干净）。
- **全量回归**：本地 19 个脚本共 806 项通过、0 失败（明细在 `docs/self-check-20261107.md`）；CI 的 `unit` / `api` 全绿。
- **文档收尾**：`README.md` 重写（SQLite → MySQL、本地运行 / 环境变量 / 测试、2026-11 改版新增能力、`BANK_BUCKET`；旧版里指向仓库中不存在的 `deploy/`、`.bat`、`docs/上架*.md` 等的内容删除或注明"未随本仓库提供"）；核对 `docs/api.md`（代码里所有路由都有记载，`init|sign|complete|abort` 之类合并写法）、`docs/database.md`（`db.js` 的 45 张表都在）、`docs/architecture.md`。
- **新增** `docs/release-steps.md`（发布与回滚，给 BOBO）、`docs/self-check-20261107.md`（验收勾选 + 关键截图说明）、`docs/screenshots/20261107/`（12 张关键截图）。
- 没有创建标签，没有碰生产服务器和生产库。

### 怎么验证
- `node flow-test.js` ×2；其余脚本见上；`release-steps.md` 里的命令是按本仓库的实际结构（`scripts/migrate-kb-to-trees.js` 的参数、`pm2` 进程名 `xuexi`、`ecosystem.config.js`、服务启动横幅）写的，**没有在真实服务器上执行过**。

### 遗留
- 已知失败且不在 CI 的旧脚本：`ui-test.js`、`wrong-ui-test.js`、`report-test.js`、`guide-test.js`（T0 起就是失败状态，没有变差）。
- 真机、真实 Word / WPS、真实 AI Key、真实库的核对都在 `docs/pending-human-actions.md`。

## 转二期（本次不做）

按任务书第 3 节，以下内容本次**没有做**，进二期：

- 爬取洋葱、组卷网、21 教育网的知识树和题目。
- 视频服务器端转码；拆分独立题库数据库；多桶存储切换（只留了 `BANK_BUCKET` 口子，做法见 README）。
- 手写公式识别、公式等价判定（学生端公式只做输入，判分仍是字符串比较，见 D25）。
- 重写后台前端（本次只做主题统一，页面里零散的行内样式没动，见 D27）。
- 微信小程序。

另外，开发过程中发现、**还没有处理**、建议二期（或 BOBO 确认后单独排期）的事：

- **题目图片地址改存 key**：题目 `images` 里存的是录入时生成的完整地址，OSS 无 CDN 时 1 小时过期（D26）。涉及题库、待审核、错题导出等十几处读图的地方，需要单独一个任务。
- 问答题自动批改（目前不判分，D19）；听力大题（一段音频对应多个小题）与"只能听 N 遍"（D24）；学生自组卷（`kind=self`）的题目校验是否收紧（T5）。
- 真题试卷是否走"逐题审核再入库"（D22）；Word / Excel / PDF 之外的真题格式。
- 旧脚本 `ui-test.js` 等的断言按新界面重写后再放进 CI。

## R0 二轮整改：bug 修复（2026-11-04）

对应 `docs/taskbook-20261104-rework.md` 第 2 节 R0 表（分支 `feat/r0-bugfix`）。B2（学习报告「详情」404）不在本次，由 R1 处理。每个 bug 的改前 / 改后截图在 `docs/screenshots/rework/r0/`（1440 宽，改前是在 `origin/main` 的代码上截的）。

### 改了什么

| # | 改动 | 文件 |
|---|---|---|
| B1 | 书签脚本回传地址从后台接口 `/api/admin/bank/mf/capture/push`（采集票据调用 403）改为 `/api/mfcap/push`；`/api/mfcap/*` 加 CORS（只放行 POST / OPTIONS，允许 `Authorization`、`Content-Type` 头，预检在鉴权前应答）；回传失败**不再自动清除本地票据**，弹出原因，只有服务器明确说票据无效（401）且老师点了确认才清 | `src/mfbank.js` |
| B3 | 新增公共函数 `optText / optDisplay / optLabel`（`public/js/api.js`，学生端和后台共用，原来 `bank.js` 里的 `optText` 移到这里），兼容三种选项格式：字符串、`{label,text}`、`{label,content}`。题库列表 `qCard`、编辑弹窗的选项框、批次预览、待审核列表 / 编辑、组卷预览 / 打印、错题打印、Word 校对卡都改用它；后端 `normalizeQ` 也认 `content` | `public/js/api.js`、`mfui2.js`、`bankui.js`、`mfbankui.js`、`pendingui.js`、`bank.js` |
| B4 | 题图单独成块（`.r0-qfig`，`display:block`）：宽度最多 题干区 70%、不小于 280px（小图按原尺寸、不放大）、高度最多 360px；`[图N]` 占位和未被引用的图都用它。点击打开灯箱（`.r0-lightbox`，全屏遮罩显示原图，点遮罩 / × / Esc 关闭，用原生 `<img>`，手机可双指缩放；层级 3000，高于做题弹层 1200——原来的放大层是 200，被盖在做题弹窗下面）。旧的 `.qz-img-inline` 没改，用更具体的新类覆盖 | `public/css/app.css`、`public/js/bank.js` |
| B5 | 代理 iframe 的 `sandbox` 去掉 `allow-same-origin`。因此：注入脚本最先补内存版 `localStorage / sessionStorage / document.cookie`（cookie 仍同步进服务器 jar）、站点请求强制不带凭据；`/api/mfproxy` 放行 CORS；外层的地址栏改用 `postMessage` 同步真实网址。悬浮球注入、采集、回传都实测可用 | `public/admin/mfui2.js`、`public/admin/collect-inject.js`、`src/mfcollect.js` |
| B6 | `.mf-node a{flex:1}` 把折叠箭头也撑满 → 新增 `.mf-node a.mf-tw{flex:0 0 16px}`；`theme.css` 里选中切换键悬停时蓝底蓝字 → `.mf-segit.on:hover b` 保持白字 | `public/css/app.css`、`public/admin/theme.css` |
| B7 | `importTreeCore`：缺学段 / 学科直接拒绝（中文提示）；并入该 学段+学科 已有的同类树，没有才新建；同父同名节点不重复建（重复导入 `created=0`）。悬浮球里加了「学段 / 学科」下拉（页面面包屑推断的当默认值），没选不回传 | `src/mfcollect.js`、`public/admin/collect-inject.js` |
| B8 | 待审核单题「入库」弹出和批量入库同一个分类框（学科、学段、年级、知识点树节点、章节树节点、标签）；缺学科 / 学段的题必须在框里选，否则不能入库。后端 `/ext/pending/commit` 也校验（拍照 / Word / Excel / 技能包、网络采集、手机扫码三类都查），缺的进 `failed` 并提示「没有学科 / 没有学段，请先选好…」；手机扫码的题入库时学段、年级也写进题目和上传记录 | `public/admin/pendingui.js`、`src/mfpending.js` |
| B9 | 本地存储时题图 `<img>` 401：服务端在 `/api/admin`、`/api/stu` 的 JSON 响应里给 `bank/` 下的图片地址补只读短票据 `&ft=`（绑定单个 key、6 小时、只认 bank/ 图片、不是登录令牌），`/api/file` 见有效 `ft` 放行。理由见 `docs/decisions.md` D30 | `src/auth.js`、`src/app.js`、`src/mfbank.js`（导出 `bankFolder`） |
| B10 | `/trees/:id/nodes` 的 `qcount` = 本节点及所有子孙节点上的题目去重数，另给 `qcount_own`；知识树管理、智能组卷里原来自己累加子节点的两处改成直接用它 | `src/mfbank.js`、`public/admin/ktreeui.js`、`bankui.js` |

页面路径：B3 / B6 / B9（后台）`/admin/#/mfq` 题库管理；B4 / B9（学生）学生端「试卷」里打开任意带图的题（`/#/papers`）；B5 / B1 `/admin/#/mfc` 网络采集 → 浏览器标签；B7 悬浮球（组卷网知识树页）；B8 `/admin/#/pending`；B10 `/admin/#/mfq`、`/admin/#/ktree`。

### 怎么验证

- `smoke.js` 新增「R0 bug 修复」一节（27 项）：B1（书签脚本内容、预检 OPTIONS、用采集票据 POST `/api/mfcap/push` 成功且响应带 CORS、题进待审核来源「网络采集」、无效票据被拒）、B5 代理预检、B7（缺学段 / 学科被拒、并入已有树、同名不重复、无孤儿树、层级正确）、B10（去重计数、`qcount_own`、与列表筛选数一致）、B9（题图带 `ft`、匿名凭 `ft` 取图 200、去掉 `ft` 401、换 key / 过期 / 非 bank 目录 / 当登录令牌用都被拒）。
- `pending-test.js` 新增「入库必须有学科和学段（R0-B8）」一节（10 项）：三类来源缺学科 / 缺学段被拒且仍留在待审核、补上后入库、批量里自带的照常入库缺的单独报错；原有的 Word 复合题入库用例改成在入库时补学科学段（行为变化）。
- 新增 `r0-test.js`（Playwright，32 项，已加入 CI api job 末尾）：B3（选项归一函数 + 题库列表三种格式无 `[object Object]` + 编辑弹窗）、B4（700×500 的图显示 503×360、单独成块、小图 120 宽不放大、灯箱出现 / Esc 关闭 / 点遮罩关闭、层级高于做题弹窗）、B9（学生端题图请求不带登录头全部 200、后台图片地址直接可取）、B6（箭头宽 16px、悬停白字）、B8（弹窗字段、缺学科 / 学段提示且不关弹窗、选好后入库）、B5（sandbox 无 `allow-same-origin`；iframe 里读 `localStorage.xuexi_admin_token` 得到 null、`parent.document` / `parent.localStorage` / `top.location` 抛 SecurityError、`window.origin === "null"`；后台读不到 iframe；悬浮球注入、采集、回传成功）。没有 Playwright 时整体跳过。
- **全量回归**（`xuexi_r0` 库、本分支代码，服务 `STORAGE_DRIVER=local AI_MOCK=1 TTS_MOCK=1`）：smoke 187、word-test 60、wrong-test 44、kbtree-test 33、pending-test 67、compose-test 41、lessonq-test 26、aiclient-test 55、mistake-test 49、paper-test 43、listening-test 30、formula-test 28、bankstore-test 17、theme-test 28、flow-test 33、storage-test 34、r0-test 32、bank-test 29、wordq-test 29、excel-test 10，全部通过、0 失败。（`word-test.js` 里端口写死 3000，本地用临时副本把端口改成 3101 跑的，脚本本身没改。）

- **截图**（`docs/screenshots/rework/r0/`，改前 = 在 `origin/main` 的代码上截、改后 = 本分支）：`b4-quiz-before/after.png`（做题弹窗里的题图：改前是 41×42 的破图占位，改后 503×360；`b4-lightbox-after.png` 是灯箱）、`b6-tree-before/after.png`（树行箭头不再撑满；鼠标停在选中的「知识点」键上，改前文字消失、改后白字）、`b8-pending-list-before/after.png` 与 `b8-pending-commit-before/after.png`（单题入库：改前点了就入库，改后弹出分类框）、`b3-options-before/after.png`（题库列表选项：改前 `[object Object]`）。

### 遗留

- 真机：用真实组卷网页面点一次书签（https 页面回传 http 后台可能被混合内容拦，脚本会自动走「打开后台接收」通道）；代理 iframe 里真实站点（组卷网 / 菁优网）在去掉 `allow-same-origin` 后是否都能正常渲染——云环境访问不到这些站点，只用本机页面验证了注入 / 采集 / 回传。记在 `pending-human-actions.md`。
- 旧的「学段学科为空」孤儿树没有自动清理；`/api/mfproxy` 仍可访问任意 http(s) 地址（含内网），都记在 `pending-human-actions.md`。
- 题图的 `ft` 6 小时过期：页面开着不刷新超过 6 小时再看图会 401，刷新即可。


## R1 二轮整改：菜单调整 + 习题学习报告合并（2026-11-04）

分支 `feat/r1-menu-report`，对应《二轮整改任务书》R1 + bug B2。

### 改了什么
- **左侧菜单**（`public/admin/admin.js` 的 `NAV_GROUPS`，BOBO 11-04 已确认）：「学习报告」移到「学生与账号」下，排在「学生管理」后面；「学情与报告」现在是 成绩管理 / 谈心谈话 / 家校沟通 / AI 学情诊断（诊断排在家校沟通后面）；「知识点正确率」从菜单移除。其余分组不变。
- **旧路由 `#/acc`**：不再是页面，进入后跳转到 `#/xreport?tab=e`（习题学习报告页签），带 `?user_id=N` 时直接打开该学生的详情；旧书签不报错。`#/xreport` 也认 `?tab=w|v|e|m`。
- **习题学习报告合并「知识点正确率」**（`public/admin/reportui.js`）：
  - 学生列表保留原有全部列；每行操作变成「详情」「导出错题 Word」（操作列在窄屏吸在右侧，不用横向滚到最后才看到）。
  - 「详情」改成右侧抽屉（手机满屏），三块：① 学科总览（四个学科的做题数、正确率、进度条，加上总做题 / 整体正确率 / 待复习错题 / 已掌握）；② **课程 → 小分组 → 视频 四级正确率**（来自 `/api/admin/bank/accuracy`，每级可折叠，有「全部展开 / 全部收起」和「只看未掌握（< 80%）」）；③ 试卷成绩 + 最近 100 条作答（原有内容）。
  - 抽屉顶部是「导出错题 Word」：学科 / 范围（未掌握·全部·已掌握）/ 时间（全部·近 7·30·90 天），与原 accui.js 一致并多了时间范围。
  - 分校账号只能看本校区学生：列表本来就过滤；**详情接口原来没有校验**，这次补上（别校学生 → `无权查看该学生`）。
  - `accui.js` 不再加载（文件留档，头部注明）；后端接口一个没删。新增样式全部是 `r1-` 前缀，写在 `theme.css` 末尾（`body.t11` 开头）。
- **B2**：视频 / 习题学习报告每行的「详情」请求补上 `/detail`（改前弹出「接口不存在」）。
- **顺手修的两个原有 bug**（测试时撞到）：
  1. `GET /api/admin/xreport/exercises`：只要有学生交过卷，整个列表就 **500**（`src/reports.js` 里试卷汇总的 Map 赋值写漏了变量）。改前在有试卷成绩的库里习题学习报告根本打不开。
  2. 详情里的「试卷成绩」把分数除以**题数**（75 分 / 4 题显示成 1875%）。接口现在多带试卷满分 `total_score`，页面显示「75 / 100」「答对 3 / 4 题」「75%」。

### 怎么验证
- `node r1-test.js`（42 项，已加进 CI api job 末尾）：两个 `/detail` 接口 200、不带 `/detail` 的旧路径 404；分校账号看本校学生可以、看别校学生的详情 / 正确率 / 错题导出都被拒；菜单分组与顺序（学习报告在学生与账号下、AI 学情诊断在家校沟通后、没有「知识点正确率」）；`#/acc` 与 `#/acc?user_id=` 跳转；详情抽屉里四级正确率与 `/api/admin/bank/accuracy` **逐行一致**，「只看未掌握」「折叠」可用；行内与详情内「导出错题 Word」都下载到 `.docx`（`PK` 头、含 `word/document.xml`）；视频学习报告详情能打开；无脚本报错；390 宽列表 / 抽屉无横向溢出。
- `theme-test.js` 按新分组更新断言（`#/acc` 仍在不撑破页面的检查清单里，现在检查的是跳转后的页面）。
- 截图：`docs/screenshots/rework/r1/`，`before-*` 是改前、`after-*` 是改后，`pc` = 1440 宽、`m` = 390 宽；每组有 菜单 / 习题学习报告列表 / 详情（改前详情是「接口不存在」，另附改前的知识点正确率页 `before-*-acc-page.png`）。改前截图是在临时删掉库里的试卷成绩后拍的（否则列表 500，见上）。

### 改动页面路径清单
| 页面 | 路径 | 改动 |
|---|---|---|
| 习题学习报告（页签） | `/admin/#/xreport`（点「习题学习报告」） | 行操作新增「导出错题 Word」；「详情」改为右侧抽屉，含四级正确率 + 导出 |
| 视频学习报告（页签） | `/admin/#/xreport`（点「视频学习报告」） | 「详情」修复（B2） |
| 知识点正确率（旧页面） | `/admin/#/acc` | 改为跳转到 `/admin/#/xreport` 的习题学习报告页签；`#/acc?user_id=N` 直接打开该学生详情 |
| 左侧菜单 | 所有后台页面 | 学习报告挪到「学生与账号」；AI 学情诊断挪到家校沟通后；去掉知识点正确率 |

### 遗留 / 需要 BOBO 看的
- 「只看未掌握」我定为「做过且正确率 < 80%」（见 `decisions.md` D28）；若想改成别的口径（比如 < 60% 或含未做的）只改 `R1_WEAK` 一个常量。
- 习题学习报告列表本身没有按「课程 / 小分组」加列（四级正确率放在详情里）；如果希望列表上也直接看到每人每课正确率，需要再定列。

## R2 二轮整改：知识树教材版本维度（2026-11-04）

**改了什么**：目录树有了「教材版本」维度——同一 学段+学科 下每个版本一棵树；默认版本表可配；所有"取第一棵树"的地方换成统一的 `pickTree`；知识树管理页加版本 / 搜索 / 悬停按钮 / JSON 导入导出；新增树导入命令行脚本；物理、化学放了待核对的草稿初版。结构与取舍见 D29，导入格式见 `docs/tree-import-format.md`。

**改动页面路径**
- `/admin/#/ktree`（知识树管理）：顶部「类型 / 学段 / 学科 / 版本」四个带文字标签的下拉；创建树时按所选版本创建；节点行内按钮鼠标悬停才显示（触屏和手机宽度常显）；「按名称搜索」（命中高亮、自动展开祖先）；「导出 JSON」「导入 JSON」（导入先预检再确认）。
- `/admin/#/mfq`（题库管理）左栏：学段 / 学科旁新增「版本」下拉（只列该 学段+学科 下存在的版本，默认选默认版本），左侧章节树按所选版本取。
- `/admin/#/mfq` 的「挂分类」、「新建题」、「编辑题」弹窗，以及待审核核对弹窗、录题入库弹窗、智能组卷（`#/paper` 的目录树范围）里的「目录树」下拉：显示为「版本 · 学段 · 名称」，与题目同 学科+学段 的排前面、默认版本第一；「新建题」里章节分类多了「版本」下拉。
- 学生端 `/#/papers`（自组卷：章节组卷 / 知识点组卷）：服务端按学生学段 + 默认版本取树，弹窗标题带版本；物理、化学有树后能选到。

**后端**：`src/treepick.js`（默认版本表、`pickTree`）、`src/treeio.js`（导入 / 导出）；`kbtree.js`、`bank.js`（`scan-tree` / `scan-compose`）、`mfcollect.js`（AI 打标候选）改走 `pickTree`；`scan-compose` 改为按所选节点所在的树找节点；接口 `GET/PUT /mf/editions`、`POST /mf/trees/import`、`GET /mf/trees/:id/export`，`POST /mf/trees` 要求章节树带 `edition` 且同 学段+学科+版本 不能重复（见 `docs/api.md`）。

**怎么验证**：`tree-edition-test.js`（74 项，已加入 CI api job 末尾）：加列与迁移（含旧库状态修正、用户改名不覆盖）、默认版本接口读写、`pickTree` 前后端逐用例一致、导入（新建 / 按路径合并 / 重复导入新增 0 / 导出再导入一致 / 数组 / 文件上传 / 格式错误 / dry-run 不写库）、脚本（打印库名、dry-run、幂等）、学生端 `scan-tree` 按默认版本返回树。全量回归 20 个脚本全部通过（`word-test.js` 里写死了 `127.0.0.1:3000`，本地用另一端口时需临时改地址）。截图在 `docs/screenshots/rework/r2/`。

**遗留 / 需要人处理**
- `data/trees/draft/` 里的物理（苏科版，18 章 75 节）、化学（沪教版，9 章 28 节）是凭印象写的草稿，必须由本地电脑 agent 对照组卷网 / 洋葱核对后换成正式版；种子不会自动导入它们。
- 洋葱小学 / 初中数学（苏教版 / 苏科版）的多层树、英语译林版的补齐，等本地 agent 采回来后用 `scripts/import-trees.js` 导入；本次只做了结构和导入通道。
- 课程目录里写的「人教版」还没有改（任务书 R2 提到要一起核对）；`#/ktree` 的拖拽排序、Excel 导入导出、两棵树并排映射留给 R3。
- `bank_trees` 版本索引不含 `kind`（MySQL 键长限制，见 `docs/database.md`）。

## R8 二轮整改：课程页 + 做题弹窗 + AI 浮层（2026-11-04）

分支 `feat/r8-course-quiz`（基于 R0，已合并 main）。任务书第 1.5 节、第 3 节 R8、第 6.2 节。

### 改动页面路径清单

| 页面 | 路径 | 改了什么 |
|---|---|---|
| 后台 · 课文习题 | `/admin/#/lessonq` | 左侧每个小分组显示「小分组习题 N」+「管理习题」；右侧顶部一条小分组习题栏；视频行显示关联的知识点；「管理习题」弹窗分页签：视频习题 / 小分组习题 / 关联知识点；题目列表渲染公式和题图（点图放大），可直接「编辑」（复用题库的编辑弹窗）、解绑；「从题库选择」只列没绑任何位置的题 |
| 学生端 · 课程页 | `/#/course/:id` | 右上角同时显示「进度」和「正确率」；新增顶部卡片：知识点掌握 X / Y 环形 + 习题正确率（已做 a / b 题）+ 学习进度 + 「继续学习」大按钮（写明即将学习的视频）；左侧小分组卡「已学 a/b · 正确率」+「小分组练习（N 题）」；视频卡显示关联的知识点标签，点开看这个知识点的掌握情况（做过的题、正确率、讲它的视频） |
| 学生端 · 课程卡片 | `/#/courses`（各学科课程列表） | 卡片底部加「习题正确率 NN%（已做 a / b 题）」 |
| 做题弹窗 | 课程页 →「练习」/「小分组练习」；试卷库、我的任务、错题重做 / 复习、章节 / 知识点组卷共用 | 桌面端定高 `min(86vh,760px)`，头部 / 底部固定、内容区内部滚动，判分前后位置和尺寸不变；右侧计时 + 题号四色方格（未做 / 已做 / 答对 / 答错，可点击跳题）；逐题反馈：大标签「答对了 / 答错了」，选错的选项整条标红、正确项标绿，填空逐空 ✓ / ✗，再显示答案和解析；手机端顶栏一行、题号横向滚动、底部整行按钮 |
| AI 老师浮层 | 做题弹窗里判分后右下角「AI 老师」 | 在当前窗口右下方展开（400 × 60vh），做题弹窗向左让位，不挡题干和「下一题」；流式输出，按 知识点 / 思路 / 步骤 / 易错点 分段，Markdown + 公式；预设追问「再讲细一点」「出一道同类题考考我」+ 自由输入（多轮）；失败显示原因和「重试」；可最小化 / 关闭；切题时跟着当前题；「直接讲解 / 一步步引导」模式切换（原来居中遮罩的分步小窗去掉）；窗口窄于 1000px 改为底部抽屉（70vh） |
| 做题报告 | 做题弹窗全部核对完 →「查看报告」 | 正确率环、答对 / 答错 / 用时（试卷另有得分）、题号红绿方块（点了跳到该题解析）、各知识点掌握条形、薄弱知识点及对应题号、「答错的题已进错题本」、本视频 / 小分组现在的正确率；底部「再练一次 / 再看一遍视频（去看视频）/ 完成」；每道题解析旁可再叫 AI 老师 |

### 改了哪些文件

| 层 | 文件 | 内容 |
|---|---|---|
| 表 | `src/db.js` | `questions.section_id`（+索引）、新表 `video_nodes`（幂等，只加不删） |
| 后端 | `src/bank.js` | 后台：`/sections/:id/questions`、`/sections/:id/bind`、`/videos/:id/nodes`（读 / 整体替换）、lessons / chapters 带小分组题数和视频知识点、`video=free`、新增题目可带 `section_id`、视频绑题清 `section_id`；学生：`/section-questions`、`submit kind=section`、`/node-mastery`、`/check` 填空逐空 `blanks`、SSE `/ai-explain/stream`（含 AI_MOCK 模拟流式） |
| 后端 | `src/ai-client.js` | `chatStream`：OpenAI 兼容 `stream:true` 逐段转发；Anthropic / Gemini 退化为一次性返回后分块推送 |
| 后端 | `src/accuracy.js`、`src/app.js` | `sectionOwnStats`、`lastAnswers`；course-detail 带 `own_qcount / own_acc / practice_count / nodes / next`，小分组和课程正确率含小分组自己的题；`/courses` 带 `acc`；删视频 / 小分组 / 章节时清理新关联 |
| 学生端 | `public/js/bank.js`、`public/js/vue-app.js`、`public/css/app.css`（末尾 `r8-` 段）、`public/index.html`（版本号） | 做题弹窗、AI 浮层、报告；课程页、课程卡片 |
| 后台 | `public/admin/bankui.js`、`public/admin/mfui2.js`（`mfQEdit` 可带默认知识点）、`public/admin/theme.css`（末尾 `body.t11 .r8-` 段）、`public/admin/index.html`（版本号） | 课文习题页和弹窗 |
| 测试 | `r8-test.js`（新增，CI api job 末尾） | 接口 35 项 + 浏览器 24 项 |

### 怎么验证

- 新增 `r8-test.js`：接口层（小分组挂题 / 二选一 / 解绑范围、`video=free`、`video_nodes` 读写与整体替换、候选树排序、学生 token 调后台接口 403、后台 token 调 SSE 403、course-detail 的小分组题数 / 练习题数 / 正确率 / 视频知识点 / 继续学习、课程卡片正确率、小分组练习取题与交卷（夹带别组题不计）、知识点掌握（含子孙、视频题继承）、填空逐空、SSE：`text/event-stream` + 多块 + 四段标题 + 追问 + 引导模式 + 错误走 JSON）；浏览器（课程页顶部数字与接口一致、右上角正确率、小分组卡、知识点标签弹窗、700×500 题图显示 503px、判分前后 boundingBox 完全相同、答错标红标绿、AI 按钮、浮层右 / 下各 16px 贴边 400×540 且不与「下一题」和题干相交、流式文字逐步变长、四段渲染、自由追问第二条回复、引导模式不再弹遮罩、最小化、切题跟随、填空 ✓ / ✗、报告题号方块数、手机顶栏不换行 / 按钮不竖排 / AI 为底部抽屉 70vh、无页面脚本报错）。**59 项全过**。
- **全量回归**（`xuexi_r8` 库、端口 3108、`STORAGE_DRIVER=local AI_MOCK=1 TTS_MOCK=1`）：smoke 187、word-test 60、wrong-test 44、kbtree-test 33、pending-test 67、compose-test 41、lessonq-test 26、aiclient-test 55、mistake-test 49、paper-test 43、listening-test 30、formula-test 28、bankstore-test 17、theme-test 28、flow-test 33、storage-test 34、r0-test 32、bank-test 29、wordq-test 29、excel-test 10、r8-test 59，**全部 0 失败**。
- **真实 AI 联调**（不带 AI_MOCK，内置配置：阿里云百炼 OpenAI 兼容 `qwen3-vl-plus`，共 3 次）：① 首次讲解：流式成功，首字 1.9s、总 6.3s、347 段 515 字，四段标题齐全、公式用 `\( \)`；② 带上下文追问：首字 1.5s、总 5.2s；③ 调整提示词（追问不再套四段、不要表情符号）后再追问：首字 1.5s、总 3.8s，回答针对问题、引用了上一轮内容。三次都 `streamed:true`（真流式，不是退化）。
- 截图（`docs/screenshots/rework/r8/`；`before-*` = `origin/main` 代码另起 3118 端口截，`after-*` = 本分支）：
  - 后台：`before-admin-lessonq.png` / `after-admin-lessonq.png`（小分组习题数 + 管理习题 + 视频知识点）、`before-admin-lessonq-dialog.png` / `after-admin-lessonq-video.png`（公式、题图渲染，编辑 / 解绑）、`after-admin-lessonq-section.png`（小分组习题页签）、`after-admin-lessonq-nodes.png`（关联知识点树）
  - 课程页：`before-student-course(-m).png` / `after-student-course(-m).png`、`after-student-node-mastery(-m).png`、课程卡片 `before-student-courses(-m).png` / `after-student-courses(-m).png`
  - 做题弹窗：`before-quiz-answer.png` / `before-quiz-judged.png`（改前 553→767 高、上移 107px）对比 `after-quiz-answer.png` / `after-quiz-judged.png`（都是 1040×760、位置不变）；手机 `before-quiz-judged-m.png`（顶栏挤成竖排）/ `after-quiz-judged-m.png`；`after-quiz-fill.png`（逐空 ✓ / ✗）、`after-quiz-formula.png`（公式选项）
  - AI 浮层：`before-quiz-ai.png`（居中遮罩小窗、AI_MOCK 下直接报错）/ `after-quiz-ai-streaming(-m).png`（流式进行中）、`after-quiz-ai-followup(-m).png`（自由追问后）
  - 报告：`after-quiz-report(-m).png`、`after-quiz-report-2.png`

### 遗留

- 课文习题的「批量上传（Word）」仍只对视频；小分组习题目前是「添加习题 / 从题库选择」两种方式。
- 平板宽度（640–999px）的 AI 浮层用底部抽屉（会盖住「下一题」，可最小化），见 D31。
- 真实 AI 联调只在云环境用测试题跑了 3 次；生产环境如有 nginx 反代，要确认没有对 `/api/stu/bank/ai-explain/stream` 开缓冲（响应已带 `X-Accel-Buffering: no`，见 pending-human-actions）。


## 二轮整改继续推进（进行中，未验收）

- R2/R3：在教材版本树基础上补充节点搜索、同级拖拽、Excel 导入导出、章节与知识点映射；题库接入多层树、筛选、题卡和试题篮。正式教材目录数据仍待逐册核对。
- R4/R5：新增录题中心和逐题审核布局、缺失项筛选、手动录题及教师扫码；学生扫码改为审核后入库；录题工作台、旧采集整批入口和 Excel 导入统一先审核。外站辅助代理默认关闭；支持常见题卡结构转换，真实 qcards 及各站点仍需样本核验。
- R4 待审核支持方向键切换本页题目（输入焦点和弹窗内不触发）、按批次查看及进入核对；仅题卡保留页码且批次保存对应页图时显示原页对照。
- R4 AI 建议增加基础题型和十级难度：默认不勾选，老师确认后保存到审核草稿；仅勾选了节点的题目才进入入库流程。十级与原五星字段同步，旧题的未知十级值不反推；生成过程不补写答案或解析。已用一道合成题检查真实模型请求，推荐准确率尚未验收。
- R4 录题中心：Excel、拍照／截图、PDF、Word 规则导入、JSON / 技能包、教师扫码、手动创建和网络采集均接入分步入口；同名文件按批次 ID 定位，图片逐张上传并可重试。PDF 逐页转换后进入原识别工作台，Word 规则导入保留格式限制且提供原 AI 工作台入口。各入口的进度、断点恢复和教程仍未完全统一；真实图片及 PDF AI 识别质量尚未验证。
- R4 审核编辑：选择题可点击选项字母设置答案，删除选项时同步调整字母；听力音频可保存每次练习的播放次数。英语已有基础作答类型支持单题细分分类，可录入、筛选并通过 JSON、Excel 扩展模板或符合规则的 Word 标题导入。组合题可手工录入材料和小题，或由部分 Excel、Word 与单层 JSON 小题导入；小题各自保存材料快照、独立审核作答，材料修改不会联动。听力匹配支持 2–7 项一对一匹配；数学连线支持左右数量不同以及多个左项连接同一个右项。两类连线按正确连线数等比例给分，单题得分四舍五入保留两位小数。单个左项连多个右项及多对多规则尚未明确。
- R4 Word 听力匹配支持显式「匹配项：」标记和字母或数字答案；无答案保留为空，审核时可补答案和音频。文档中的原有 Word 导入格式继续支持。
- R4 手动录题新增独立三步页面，支持单题、组合小题与一对一听力匹配，材料和可选音频随题进入待审核；独立页面接线完成情况以当前路由为准。
- R4 英语翻译支持参考译文及备选译文的精确比对；书面表达通过主观题流程保存作答，始终不自动判分、不进入错题本。混合试卷显示客观题分数与未评分数量，全部主观题评分前不显示最终总分；支持手动、JSON、Word 和扩展 Excel 表格录入。翻译暂不支持语义等价判断。
- R4 数学计算题沿用主观题作答模式，支持老师对每次作答评分和填写评语，学生在试卷页查看反馈；新试卷的全部主观题评分完成后生成该次总分。旧版未关联交卷的主观题记录可单独评分，不回写旧卷。
- R4 数学连线支持学生点击左右项目形成可见连线，左右各 2–7 项，右侧选项可被多个左项连接，并按正确连线数量计部分分。作图支持鼠标/触屏画布、撤销和人工评分，PNG 单次大小及尺寸受限，通过学生本人和分校归属鉴权的独立接口查看；题目响应及试卷明细不含图像。Word 和数学扩展 Excel 支持导入这两类题并进入审核，默认 Excel 模板保持原样。单个左项连多个右项及作图附件上传尚不支持。
- R6/R7：章节/知识点选题可加入试题篮、调整顺序和分值并保存草稿；真题 Word 及图片/PDF 已识别题卡可生成未发布试卷草稿，审核后回挂；课文 Word 审核后回挂视频。真实 PDF/图片识别质量尚未核验。
- R6 学生端：默认使用当前学习学科，所选章节或知识点范围显示去重后的实际题量，并可选择 5、10 或 20 题；题量不足会提示，旧组卷接口仍兼容。
- R4/R7：听力音频可设置每次练习的播放次数（刷新或重新进入练习会重置）；试卷库可按类型筛选，卡片展示满分，作答前可预览前五题。英语完整题型尚未完成。
- R4/R6/R8：待审核时按学科、学段过滤并校验树节点；AI 树节点建议须由老师勾选确认，已用模拟 AI 和一道合成题验证真实请求，推荐准确率尚未验收。小分组 Word 习题经审核后自动回挂；一键组卷支持难度比例及保持范围和难度的单题替换。
- R6：已保存的教师试卷支持导出学生版、附答案版和教师版 Word；按题序及设置的分值输出，常见公式可编辑，其余可识别公式支持图片兜底。
- R6 一键组卷可按每个选中知识点指定题量，并对重叠范围去重；题型数量和难度比例是另一种互斥模式。R4 已支持部分英语单题细分及 JSON、Excel、部分 Word 导入；组合题可拆为保留组标识与材料快照的独立小题；题库与章节/知识点组卷支持整组加入当前已入库小题，并保持混合题型的小题顺序和已有分值。复杂嵌套仍未完成。
- R9/R10：错题导出可选择是否带解析，常见公式转 Word 可编辑结构；其他可识别公式在本地转为图片，未知语法、需要系统字体或超出资源限制时保留 LaTeX 原文。学生扫码页增加单题、跨页和框选。后台首页增加统计与快捷入口，嵌入学情页增加统一导航。真实手机和全页面视觉验收未完成。
- R5/R9：网络采集提供技能包引导、粘贴导入和站点规则自检；外链题图经公网地址、跳转、大小和格式校验后转存题库，失败时保留审核并支持补图。真实站点规则和外链图片尚未联调；跨页扫码按顺序向视觉接口传入全部图片，审核页展示上传备注（识别链路已使用模拟 AI 验证）。
- 老师扫码录题的视觉识别未配置或失败时，批次会显示原因并保留图片供人工核对；通过云代理用一张合成算术图片验证了真实模型识别链路且未补写答案，真实手机访问和客户材料识别质量仍需验证。
- AI 客户端支持标准代理环境变量；用合成题在当前云环境验证了真实分类、视觉识别及流式讲解，流式讲解收到多个片段并正常结束。这些检查不代表客户材料的识别或推荐准确率已验收。
- R9：错题卡增加“举一反三”，按相同知识点节点或精确匹配的知识点文字寻找同学科、同学段且学生未做过的题。
- R4/R6/R7：Word 题目可选填明确的十级难度，待审核和入库会保留；课文 Word 也可使用。教师版试卷导出显示十级或原五星数值，不从旧题反推十级值。Word 真题入口复用同一解析器，尚未单独做界面验收。
- R7：试卷可记录教材版本与册别，管理端使用草稿、已发布、已归档状态；归档会取消学生端可见性。版本和册别目前仅保存为试卷元数据，不会自动确认每题的分类。
- R4：题目增加可空十级难度，导入、审核、题库编辑与 JSON 导出可保留精度；旧五星题不反推具体分数。Excel 原模板字节不变，另提供十级与英语扩展模板；冲突或越界行会报错。旧的单题 AI 归属接口仍返回五星，真实十级建议准确率尚未验收。
- 本段记录中功能均为本地工作区进行中的实现，不代表 R2–R11 全部完成、真实 AI/站点已验证或应用已发布。

### 交卷漏答计分修复

- 学生试卷交卷时，服务端按完整题单补齐遗漏题目：未答客观题按未作答计入，未答主观题保持待评分，重复的同题作答只计算一次。旧等分卷不再因只提交少数答对的题而得到满分；逐题分值卷与真题卷也按完整题单报告。
- 在隔离测试库验证：`compose-test.js` 58 项、`paper-test.js` 53 项通过，覆盖旧卷、逐题分值卷、主客观混合卷、定向学生权限和真题卷漏答。

### 题库图片与存储

- 题库和视频继续按目录分类存放，不启用独立桶或迁移历史资源。新题图使用稳定代理地址，当前存储域名下的旧签名图片在响应时恢复为短票据；未知旧域名仍需真实数据核对。
- 七牛题图导出读取限定配置域名、签名及 HTTPS，限制大小和超时且不跟随跳转。隔离测试验证图片地址转换、模拟七牛读取、目录隔离和存储驱动，真实云桶和历史资源仍待验收。

- 学生取题响应附学生和题目绑定的两小时票据，逐题核对、AI 讲解及自组卷交卷校验票据，防止猜题号读取其他题的答案；过期或旧客户端缺少票据时提示重新打开。已签发票据的撤销生效最长延迟两小时，卷面取题和交卷仍即时按原权限校验。

- AI 答案/解析：录题、网络采集和手机扫码均可生成单独标记的建议，须老师逐项采纳；题目变化后建议失效。旧版 `ai_filled` 题卡须核对后才能入库。历史扫码如已入库，老师确认后才补写；缺少可识别来源的历史正式题无法追溯。纯图片需先转写题干。隔离库测试使用模拟模型，真实材料和模型质量仍待验收。
- 后续核查：拍照识别、文字整理、工作台 Word 的模型答案及解析保留为待核对建议；自动采集 AI 兜底保守留空无法证实来源的答案、解析及要求确认题型。历史识别内容保留原值并提示来源不确定，题图、音频和匹配项目变化会使旧建议失效。隔离库的模拟模型回归通过；真实材料仍待验收。
- 本次真实卷复核后的 AI 审核保护：旧补全入口、采集和扫码的建议确认接口每次仅接受一个字段；历史来源不明的答案、解析以及旧 AI 补全的分类也须分别对照原文确认；已采纳的 AI 内容在题干、材料、选项、题图或分类变化后须逐项重新核对，保留原值且不准直接入库；历史已正式入库的扫码题须先由老师主动清空相关字段才可改变题面，避免旧答案继续对外可见。生成建议只基于文字且未附图，界面增加明确提示并提醒答案与解析可能不一致；未确认项仍不写正式字段。

## 真实试卷整改：多选计分与未确认答案

- 普通卷和真题卷支持老师逐题设置多选少选固定分：仅选中部分正确答案且无错选时给已设置分，错选、空答 0 分；未设置沿用旧版全对得分，明确设置 0 与未设置区分。部分正确仍列入错题。分值来自老师或试卷配置，不根据样卷推断。
- 没有正式答案的客观题在逐题核对、交卷和报告中保持未评分，不进入错题和客观正确率；老师可对本次作答评分。物理和化学作图题可使用已有画布与人工评分流程。
- 必要回归：`multi-partial-test.js` 校验真子集与错选，`multi-partial-flow-test.js` 覆盖两种试卷设置、范围、未设置与显式零分、无答案及人工重算；`match-partial-flow-test.js` 回归既有连线部分分。

### 真实试卷复测：跨页识别与组合题

- 逐页视觉识别加入上一页图和既有材料上下文，模型输出共同材料、原顺序组标识以及明确续题；工作台复用原逐页接口。材料可与各小题一起保留，顺序以实际识别结果为准，跨页关联及内容均须老师核对。
- 续题只在相邻页唯一、原题卡未经修改或审核且无答案建议时合并。疑似重复题号、已有建议或老师改动、两页均有图号等情况保留独立题卡并提示人工核验，避免覆盖或混图。模型答案和解析继续只写待确认建议。
- 支持仅共同材料页，解析失败或结果为空明确提示；每页独立保存，重复页不重复追加，禁止旧的整批接口覆盖已有草稿。自动识别和半自动整理提示要求逐字符保留原文，不按惯例补公式、反应条件或选项。
- `recognition-pages-test.js` 覆盖共享材料、题组顺序、续题合并、人工修改保护和图片编号冲突；`recognition-pages-flow-test.js` 使用合成模型覆盖实际逐页接口、跨页续接、答案建议隔离、重复页及异常保留。真实试卷实际效果以逐题复测记录为准。

- 真实试卷复核：学生端和后台统一修正块公式定界符，并保留块公式内部换行，普通文本换行不变；学生端共同材料改为可排版公式的容器。模型识别题增加内容待核对标记及来源页查看，老师须对照原页确认题型、题干、选项、公式、材料和小问后才能入库；题目内容、题图、来源页或批次范围变化后确认自动失效，答案与解析的 AI 建议仍需分别确认。新增合成单测、隔离审核 API 测试与双端 Chromium 公式检查。

## 真实试卷题图核对与补录（2026-11-05）

- PDF/拍照题的待审核页面支持查看所属批次原页、选择跨页来源并手动框选题图；支持题干、共同材料、选项、连线项目的 `[图N]` 引用及单图上传，图文归属不自动推断。题图缺失或未逐题确认时，后端拒绝入库；编辑题面或图片后须重新核对。历史有源页号的照片/PDF 草稿也适用。
- 图片引用在入库时随稀疏编号同步整理；学生端和组卷/错题 Word 按材料、普通选择题选项和匹配题中的占位位置显示题图。真实页图自动裁剪与图片归属准确率仍需要实卷及老师验收。

- 学生题目响应按 `[图N]` 区分题面图和仅答案/解析引用的图，题面索引不变；作答前隐藏解析专用图，逐题核对或交卷后返回供解析使用。老师确认的无占位附图绑定题面快照，内容或图片变化后不再沿用。完全没有图号的历史题因无法判断用途继续兼容原图展示，需人工复核。
- AI 建议可由老师在待审核中明确舍弃：不更改已填写的答案或解析，原建议、来源、操作人和时间保留并随合并及入库留档。需要匹配建议票据和当前题目快照；重新生成不会静默覆盖未处理建议。
- 逐页识别兼容明确的题干、材料、题型、选项和题号字段别名；只接受可解释的字符串或结构，冲突字段提示核对，不凭对象或数值猜造题文。隔离调试可显式设置 `RECOGNITION_DIAGNOSTICS=1`，仅记录白名单字段名、类型和长度，默认关闭，不记录题面。自动关联不以模型自行标注的续题为充分证据；人工合并保留源片段并强制重新审核。
- 真实卷复测后补强：录题批次、技能包、采集及扫码的单选/多选入库须有至少两个非空选项，已核对题目也不能绕过；可缺答案，保持空白等待老师审核。旧题库新建/编辑及表单允许客观题不填写答案，判断题不再默认填“正确”；非空答案沿用格式校验。

### Excel 无答案原卷与词块题审核

- 题干和必要选项完整时，单选、多选、判断、填空、排序、完形及阅读小题均可不带答案进入待审核；非空答案仍检查合法性，填空缺少前面空位时不再把后续答案静默前移。没有答案的选择填空须显式提供完整选项，不能由干扰项或其他小题的答案猜测；十选项扩展模板为该工作表追加 A–J 列，原始客户模板保持不变。
- 客户 Excel 原「组合题」表实际为分号分隔的连词成句词块，不是共享材料的小题组。该表未显式填写标准答案时，不再将词块原序自动写成正式答案；保持词块原序并提示老师审核补充。这是为避免把题目排列猜为答案而作的兼容行为变化。

- 旧真题卷若含同题多行，交卷按行聚合该题满分及各行显式配置的少选分，兼容已存卷面、不重写历史成绩；手动加题按题目 ID 去重。学生端待人工评分的题目不再显示“不计分”。

### Word 真题题型待核对与原序

- 导入真题 Word 时按原文的连续题型分段，避免题型交错时重排原题；没有明确单选或多选且无答案的选择题使用中性的「待核对选择题」标题，待老师核对题型。试卷编辑支持原位修改文本块标题，并拒绝空标题，保留原有位置、样式和对齐。

- 连线与听力匹配题若原卷无标准答案，允许保留空答案进入题库；左右项目及选项仍须完整，已有答案仍严格校验。未设置标准答案时逐题核对和交卷标为未评分、不进入错题或客观正确率，老师可对本次作答评分。手工、Excel、Word 的合成回归验证入库及作答，原有连线部分分回归通过。

### 答题布局与跨分页合并（2026-11-05）

- 选择题按可用宽度优先显示两列，长选项在格内换行，窄屏或题卡过窄时降为单列。移动端展开 AI 老师时，题卡与 AI 窗口上下分区并各自滚动；桌面沿用并排布局。未评分判断题不再将任何选项标成对错，也不显示空的参考答案。
- 待审核列表可将同批次两段暂存为合并片段，翻页后仍可继续选取；确认前展示原顺序，合并请求携带两段的内容审核快照。保留本页勾选合并方式；合并后仍须重新核对内容与图片。
- 浏览器测试使用合成数据及模拟接口，覆盖 320、390、768、1100、1440 像素视口、长选项、AI 面板避让、无答案判断题和跨分页合并；另运行跨页识别、题图、连线及多选计分的纯逻辑回归。测试不请求真实 AI 或操作正式题库。自动测试环境缺少 Playwright 时，这两项浏览器脚本会明确提示跳过。
- 本次未重复调用或发送另行测试的真实试卷；真实识别准确率、图片自动归属、教师逐题验收以及真机/WPS 验收仍以对应独立任务的结果为准。教材目录和外站采集资料缺口仍见 `docs/pending-human-actions.md` 的 R2 / R5 表。

### 英语题型与录题恢复跟进（2026-11-06）

- 从干净的 `099e7ec` 继续，补齐阅读/完形/还原/选词/对话/改错标签及适用基础题型，开放题保持人工评分；Word 支持听力排序、连词成句和显式共同材料，Excel 英语扩展模板增加问答与题型说明，JSON 保留明确基础题型及共用已上传音频。修复学生排序候选词块为空和 NaN 序号的问题；错题重做保留英语细分标签。
- 各录题入口接入共用教程与恢复说明，文件上传加入超时、离页回调保护及结果未确认提醒，避免中断后在当前页直接重复上传；手工文字和粘贴 JSON 支持本标签页草稿恢复。识别工作台保留错误原因、暂停和已保存页面，保存失败不丢当前题卡。移动端手工操作栏按钮不竖排。
- Node 20：23 种英语细分的 Word/Excel 解析与判分通过；隔离库合成流程（JSON 25、Word 3、Excel 2 题）贯通审核入库、学生取题核对、交卷和主观评分回写，共用音频、空答案及非法配置拒绝通过。Chromium 1440/390 的草稿恢复、超时/重试、离页保护、保存失败保留输入、完成页跳过及英语实际作答通过；五种视口的原答题布局回归通过。原有 Excel 20 项、Word 47 项、外部包、匹配、翻译写作和 AI 建议逐项确认保护回归通过。
- 不请求真实试卷或更换模型，不写正式库、不合并或部署。恢复不包括文件字节续传、关闭浏览器后的后台任务；Safari/微信真机、WPS、教材目录及外站样本仍待外部条件。完整范围、剩余边界和截图见 `docs/followup-20261106.md`。浏览器脚本在没有 Playwright 的环境明确提示跳过，未据此宣称 CI 已覆盖浏览器验收。

### 全任务核对、七入口持久恢复与后台交互收尾（2026-11-06）

- 从已推送且干净的 `d106fbb` 继续，逐项对照原始文件、T0–T14 与 R0–R11；最新状态矩阵与真实阻塞见 `docs/taskbook-audit-20261106.md`。原始文件保持不动，不合并、不部署、不写正式库。
- 本机草稿改为按稳定账号跨标签页恢复，保留旧会话数据兼容；准备信息与扫码页也可恢复，浏览器存储禁用/写满明确提示并保留当前内存输入。文件二进制不保存。七入口补齐资料范围，JSON 默认值不改原分类，教师二维码签名版本范围。
- 新增请求回执及同事务结果保存：响应丢失后同凭据重发恢复原批次，输入变化拒绝；页图防重复且保留 PDF 逻辑页序，采集书签直连与后台接收共用凭据。旧工作台逐项进度、只重试未完成页，格式/超页数明确报错。
- 当前识别任务互斥、相同请求共享结果；重开工作台可看到在途页并等待保存，教师扫码共用状态。半自动 OCR/整理/旧 Word 保存加入并发内容比较；单页整理锁定编辑、保留原文和持续失败原因，处理期间显示骨架占位，已有题卡继续保留。未发出后续页不会在关页后自动排队。
- 全后台公共弹窗支持键盘/焦点及正确取消收尾，保存防重复且失败保留输入；表格操作列固定、表单标签关联、页面加载失败可重试，清除检查页面中的装饰 emoji。录题历史/教材版本读取失败不再冒充空数据。
- 本地累计 **71 个脚本最终均退出 0**（CI 当前 70 个，加单词固定布局检查），其中全后台 35 路由 × 1440/768/390 共 **105 次加载/截图**，无脚本错误或整页横向溢出。新增回执、关闭标签页、令牌更新/账号隔离、存储失败、扫码响应丢失/重发、在途任务/并发修改保护、范围冲突、单页失败原文保留等实际浏览器/API检查通过。完整逐脚本结果 `docs/test-results-20261106.json`，截图 `docs/screenshots/rework/full-20261106/`。初次运行发现单词测试写死端口，以及旧菜单/报告/首页/AI 抽屉断言过期；修正测试地址和已确认的新界面断言后重跑通过。
- 主链路 `flow-test` 33/0，组卷 61/0，试卷 54/0，R0 28/0，R1 42/0，R8 60/0，主题 31/0，单词固定布局 34/0；23 种英语细分、AI 答案逐项确认、连线部分分、多选少选分、主观作图/评分、共同材料/原序整组、题图/跨页与 DOCX 图片/公式结构均完成现有回归。两条旧模板可选路径和 28 项部署包检查仍按原脚本跳过，现有客户模板由 Excel 20/0、Word 47/0 实际读取，不把跳过算成模板或部署包验收。
- 固定 Playwright 开发依赖，CI 安装 Chromium、执行浏览器检查并上传页面截图；本轮本地通过不代表推送后远程 Actions 已通过。没有重新发送四份试卷或调用真实模型；真实识别、38 册目录、外站真实样本、真机视频/扫码/音频及 WPS/历史云存储保留待验收。

## 2026-11-06 浏览器验收报告跟进修复

- 从 `5eeb542` 开发基线续接，修复管理预览和学生只读答案公式排版、主观反馈主题色、交卷各退出路径的任务刷新、各录题入口的新批次筛选状态；修正手动页脚全宽按钮、登录断字/中文校验、词汇选中样式、MathLive 中文键盘宿主与窄窗布局、成绩页头继承固定 flex 基准的问题。
- 题库补物理/化学可选空范围；真实教材和数学细目录仍待确认，没有编造节点。固定初始口令策略、固定大面板首屏操作建议未擅自扩大实施范围。
- 独立审查补出的纯上下标公式、报告 × 退出、采集导航和窄屏键盘挤压均新增失败用例后修复。新增 `browser-audit-test.js` 和 `npm run test:audit`，接入 CI 的本地隔离库任务。
- 逐报告项处理、执行边界与本地测试证据见 [浏览器验收修复记录](browser-audit-fixes-20261106.md) 和 `test-results-browser-audit-20261106.json`。远程 Actions 另行核查，不以本地结果冒充远程通过。未合并 main、未部署；视频按用户人工验收收口，真实识别/换模型继续暂停。

## 2026-11-06 Astra 复测后第二轮修复

- 续接 `09140cb`：补齐 MathLive 中文 Insert/子菜单/提示词条，修复缓存 SVG/按钮名称仍英文；挂载和重开均同步，公式模板、答案与判分不变。
- 新增真实本地 HTTP + Chromium 的合成主观提交和错答交卷 × 返回测试；两条路径在基线即通过，本轮补完成证据而未臆改提交逻辑。
- CI 的 local/mock 设置提升到全局，覆盖直接导入存储/AI模块的测试进程；新增隔离断言。旧 CI api 的具体日志返回403未取得，不冒充确认全部失败原因。
- 本轮73个CI脚本全部退出0，新增真实浏览器3/3、原浏览器验收18/18；独立只读审查无Important问题。逐源码根因、处理、测试和未验边界见 `astra-followup-20261106.md` 与 `test-results-astra-followup-20261106.json`。下一轮独立Astra仍由父会话在隔离电脑执行。

## T14 修复采集树来源 ID 别名与通用导入冲突检查（2026-11-07）

- 修复 CI smoke B7：采集树重复导入时，同路径节点的外站 `site_node_id` 不同，被通用树导入的非空 `code` 冲突检查错误拦截。
- 只在采集器内部显式启用 `preserveSourceCode`。同路径保留已有非空 code 和首次来源映射，空 code 可补填；新路径新增。通用 JSON / CLI 和默认 `importDoc` 仍严格拒绝 code / note 冲突，不根据可伪造的 source 标签放宽检查。未改表结构、现有来源映射主键或生产配置。
- 新增 5 项内存库回归：B7 跨批次来源别名、批内同路径别名、JSON source 标签不能绕过冲突、note 仍冲突、来源映射写入失败时原子回滚；覆盖预览只读、正式结果一致、节点 ID / 层级 / 顺序 / 题目关联及幂等。smoke B7 增加 HTTP 预览和重复采集断言。
- 先在未修复代码上看到 2 项回归按 CI 相同原因失败；修复后 `node --test astra-takeover-treeio-test.js` 27/27 通过，独立复核未发现阻断问题。
- 本轮 Node 24 离线检查累计 150 项通过，变更 JavaScript 语法、`node ci-isolation-test.js` 和 `git diff --check` 通过。`npm run test:takeover` 退出 1，因缺失 `docx` 在排序导入测试停止，其余无此依赖的组已分别运行通过。
- 验证边界：使用 `node:sqlite` 内存库，未运行真实 MySQL / 完整 HTTP smoke / 浏览器 / 完整 CI。当前本地依赖及隔离测试服务不全，不使用真实数据库替代。待手动推送后检查该新提交的 CI；本轮不推送、合并或部署。


## T8 公式空输入后屏幕键盘焦点恢复（2026-11-08）

- 真实 Chrome 组件验收发现：空公式点击“插入”后虽然提示“还没有输入公式”，焦点却留在按钮，屏幕键盘继续可见但不再输入。只在 `public/js/mlive.js` 的空输入分支恢复 `math-field` 焦点，不改公式格式、判分或数据库行为。
- 新增明确命名的浏览器回归 `mlive-keyboard-browser-test.js`，通过 `npm run test:formula:browser` 执行。使用真实本地 MathLive、页面样式及独立 DialogUX，后台带实际 `body.t11`，学生端不加主题类；只启动本地静态资源服务器，外部请求全部阻断，不加载应用、Auth 或数据库模块。
- 先保存原代码后台/学生 × 390×844、1440×900 四组合红测，再验证修复后四组合“空插入 → 点击屏幕分数键 → 正确回填”全部通过。MathLive 的焦点连接有自身异步时序，测试等真实 DOM 获焦，不用脚本注入公式替代键点击。
- 同时完成四组合分数/根号/上下标、分隔符/裸 LaTeX、光标插入及单次 input 事件、取消/X/Escape/遮罩关闭、重开、五轮重复调用、预填值、Tab 焦点约束及加载中取消再开，组件矩阵 9/9 通过。390 宽底行键帽下缘约 3px 轻微裁切，但点击中心全部可达；本次未扩修该视觉项。
- 接入现有 CI unit 的浏览器安装后步骤，复用 `CHROMIUM_PATH`，并上传合成截图与 JSON 结果。未执行远程 CI，不将本地通过写成 Actions 通过；此项仅验收组件 UI，未涵盖录题保存、刷新落库、学生提交判分或真机 Safari/微信。
