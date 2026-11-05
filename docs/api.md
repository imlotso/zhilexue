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
- `POST /papers/auto` 还可设置 `difficulty_ratios:{easy,medium,hard}`（整数百分比，总和 100）；`POST /papers/auto-by-node` 使用 `node_ids` 和 `per_node_count` 按知识点分别抽题，重叠范围跨节点去重，并返回不足的知识点；`POST /papers/replace` 在原范围内换同题型、同难度档的题。
- `POST /papers/:id/assign`：下发给指定学生并置为已下发。**有下发名单的试卷只对名单里的学生可见**（`GET /tasks`、`GET /papers`、`GET /papers/:id`、`POST /submit kind=paper` 都按此判断）；没有名单的才按年级/学段/册别广播。`POST /papers/:id/publish {publish:0}` 撤回时清空名单。
- `GET /papers/:id/export-docx?mode=student|answers|teacher`：按试卷题序和分值导出学生版、附答案版或教师版 Word；常见公式转为可编辑公式，暂不支持的公式保留原文。
- 学生端 `POST /scan-count`：`{kind, subject, node_ids}` 返回所选节点及后代的去重题量；`POST /scan-compose` 增加 `count:5|10|20` 时抽取指定数量的不同题目，题量不足返回提示。旧客户端不传 `count` 时仍按最小有题节点抽题。
| 课文习题 | `GET /chapters`；`GET /chapters/:id/lessons`；`GET /videos/:id/questions`；`POST /videos/:id/bind`；`POST /videos/:id/import-docx`；`GET /sections/:id/questions`；`POST /sections/:id/bind`；`POST /sections/:id/import-docx`；`GET/POST /videos/:id/nodes`。视频和小分组 Word 导入均先进入待审核，审核入库后自动回挂。 |
| 反馈 | `GET /feedback`；`PUT /feedback/:id` |
| 选项 | `GET /branches-options`；`GET /students-options` |
| 学生错题 | `GET /mistakes` |
| 扫码上传池 | `GET /uploads`；`POST /uploads/:id/review`；`POST /uploads/import-all`；`DELETE /uploads/:id` |

课文习题正确率（T6）：
- `GET /api/admin/bank/accuracy?user_id=`（后台，分校只能看自己校区的学生）：`{student, courses:[{id,name,groups:[{id,name,videos:[{id,title,acc}],acc}],acc}], acc}`；`acc = {total, answered, correct, rate}`，`rate` 为百分整数，没做过为 `null`。
- 学生端 `GET /api/stu/course-detail`：每个 `lessons[]`、`groups[]` 和整门课都带 `acc`（同上结构）。
- 学生端 `POST /api/stu/bank/submit` 的返回多了 `by_point:[{point,total,correct}]`（本次各知识点）和 `mastery:{video:{…,rate}, section:{…,rate}|null}`（仅 `kind=practice`：该视频和所属小分组**现在**的正确率）。
- 试卷交卷（`kind=paper` / `kind=mfpaper`）按完整试卷题单计分：客户端未提交的题视为未作答；客观题按错题处理，主观题保留待评分。重复提交同一题只计一次。
- 数学计算题、问答题与书面表达不自动判分：`submit` / `check` 返回 `ungraded:true` 和可选参考答案，不记对错、不进错题本、不计入 `total`/正确率。老师可在习题学习报告对某次作答评分：`POST /api/admin/xreport/subjective/:id/grade {score, comment}`，分校仅可评分本校学生，分数不得超过该题满分。学生通过 `GET /api/stu/bank/subjective-responses` 查看本人反馈。新试卷作答在全部主观题评分后更新该次试卷总分（沿用整数总分四舍五入）；旧版未关联具体交卷的主观作答仅保存单次评分，不回写旧卷。试卷仍有未评分题时最终 `score` 为 `null`，返回 `ungraded_count`、`objective_score`、`objective_score_total`。翻译按老师录入的参考译文比对，备选译文可用 `|||` 分隔，不支持语义等价判定；缺参考答案的翻译不自动判分。

错题 Word 导出（T9，`src/mistake-docx.js`，使用 npm 包 `docx@8.5.0`）：
- 学生端 `GET /api/stu/mistakes/export-docx`：导出自己的错题为可编辑的 `.docx`（附件下载，响应头 `X-Mistake-Count` = 导出题数）。查询参数：`subject`（学科）、`bucket`（`unresolved` 默认 / `resolved` / `all`）、`days`（最近 N 天）、`from` / `to`（`YYYY-MM-DD`，按错题更新时间）、`ids`（逗号分隔的题目 id）。没有符合条件的错题时返回 `{code:1,msg:'没有符合条件的错题可以导出'}`（JSON，不是空文件）。仅学生账号。
- 学生端 `GET /api/stu/bank/mistakes/:id/similar`（`id` 为题目 ID）：根据本人错题的知识点节点或相同知识点文本，返回同学科、同学段、尚未做过的题目，最多 3 题，不返回答案。
- 后台 `GET /api/admin/bank/mistakes/export-docx?user_id=`：同样的参数 + `user_id`；分校只能导出自己校区的学生（否则 403 / `无权导出该学生的错题`）。后台入口（R1 起）：学习报告 → 习题学习报告 → 每行「导出错题 Word」或「详情」顶部的导出区（可选学科 / 范围 / 近 7·30·90 天）。
- 版式（沿用客户《错题集》样本）：封面（错题集 / 共 N 道错题 / 日期范围 / 姓名·科目·日期）→「错题练习」（日期、多次答错标记、题号、题干、图片、选项、知识点）→「错题解析」（答案、解析、答题记录）；页脚「第 X 页 / 共 Y 页」。常见分式、根式和上下标会转成可编辑 Word 公式；暂不支持的 LaTeX 保留原文。图片只支持 JPEG / PNG。

上传真题试卷（T10）：
- 公式输入（T8）没有新接口：后台粘贴 / 拖拽图片走已有的 `POST /api/admin/bank/mf/asset`；学生端所有出题接口（`serveQ`）与错题本题目的返回里多了 `subject`（前端据此决定要不要显示「公式」按钮）。填空题判分前会抹平 `\( \)`、`\left \right`、`\dfrac` 等写法差异（见 D25）。
- 后台 `POST /api/admin/bank/mf/papers/import-word`（multipart：`file`=.docx，`title`、`subject`、`stage`、`grade`、`year`（4 位数字）、`folder_id`、`publish`=1/0、`dry_run`=1）。格式同 Word 导入（题号、选项 A.、答案另起一行，见 `src/wordq.js`）。
  - `dry_run=1`：只解析，返回 `{total, big_count, error_count, errors, warnings, sections:[{name,count}], title, year}`，**不写库**（老师确认用）。
  - 正式导入：创建未发布的试卷草稿与待审核批次，返回 `{paper_id, run_id, total, published:0}`。审核逐题入库后按原顺序自动挂回试卷；存在待审核题时不能发布。
- 学生端试卷库搜索：`GET /api/stu/bank/mfpapers?q=&subject=&grade=&year=&exam_category=&size=`（`q` 匹配卷名 / 学科 / 年级 / 年份；都不传 = 全部；只含已发布且不在试题篮 / 回收站的）；列表含试卷类型、题量、满分和本人作答情况。`GET /api/stu/bank/mfpapers/filters` → `{subjects, grades, years, exam_categories}`。试卷类型为 `unit` 单元、`midterm` 期中、`final` 期末、`entrance` 真题；空值代表未分类。`GET /mfpapers/:id` 返回 `year`、`exam_category`、`total_score`（各题分值之和）；`POST /submit kind=mfpaper` / `kind=paper` 的返回多了 `score`、`score_total`。

听力题（T7，题型不新增，在现有题型上附加音频）：
- 题目新增字段 `audio_key`（存储 key，只认 `bank/audio/…` 目录；乱填别的目录或带 `..` 的 key 会被当作没有音频）。后台题目接口（`GET/POST/PUT /questions`、`/questions/:id`）的返回带 `audio_key` 和 `audio_url`（播放地址）；`POST/PUT` 传 `audio_key`（`PUT` 不传 = 保留原音频，传空串 = 去掉音频）。
- 后台 `POST /api/admin/bank/mf/audio/upload`（multipart `file`，mp3 / m4a / wav / ogg / aac / webm，≤25MB）→ `{key, url, name, size}`；`POST /api/admin/bank/mf/audio/tts` `{text(≤500字), lang:'en'|'zh', rate?}` → 同上（用服务器的语音合成：Windows 自带语音；`TTS_MOCK=1` 环境变量下生成一小段提示音，供自动化测试）。音频存在 `bank/audio/YYYYMM/…`。
- 学生端 `GET /api/stu/bank/scan-tree`（R2）：按学生学段 + 默认版本表取一棵树（可选 `?edition=` 指定），返回 `{nodes, tree_id, tree_name, edition}`；`POST /scan-compose` 按所选节点所在的树组卷，节点不属于该学科 / 种类 / 学段的树会被拒绝。
- 待审核页逐题补音频：`PUT /ext/pending/item` 的 `patch.audio_key`（拍照识别 / Word / Excel / 技能包 / 网络采集 / 手机扫码六类来源都支持）；待审核项带 `audio_key`、`audio_url`；入库时写进题目。Excel / Word 导入模板没有改。
- 后台题目新增、编辑及待审核项支持 `audio_play_limit`：0 表示不限制，1–5 表示每次练习的播放次数；旧编辑接口不传此字段时保留原值。学生答题界面在本次练习中记录播放次数，刷新或重新开始练习会重置，不能作为防作弊措施。
- 后台题目和待审核项支持 `question_subtype`（英语单题细分分类，基础 `type` 继续决定作答和判分），题库列表可按该字段筛选。JSON/技能包支持 `question_subtype` 或 `subtype`；Excel 英语扩展模板通过 `GET /ext/import-template?english_subtypes=1` 下载，默认模板仍为客户原文件；Word 可在小节标题或题号括号中使用支持的英语单题名称。翻译和不自动判分的书面表达分别以 `translation` / `writing` 分类保存；英语扩展 Excel 模板含书面表达表。当前支持名称见 `public/js/question-subtypes.js`。
- 听力匹配使用 `question_subtype=listen_match`、`type=sort`、`match_prompts` 左侧数组及 `options` 右侧数组；答案按左侧次序填写右侧序号，例如 `2,1,3`。支持 2–7 项一对一匹配、音频及播放次数；待审核须核对完整结构和答案后入库。学生端单题、试卷和错题重做按相同规则判分。JSON、英语扩展 Excel 模板和 Word 均支持匹配项目导入；Word 使用「听力匹配题」标题，每行「匹配项：内容」表示一个左侧项目，再依次填写 A./B. 等右侧选项和答案，未给答案可留空进入待审核。音频须在审核时添加；复用选项的一对多匹配尚不支持。
- 数学连线使用 `question_subtype=math_match` 与匹配结构；左右各支持 2–7 项，数量可不同，每个左项选择一个右项，右项可重复连接。选项支持题图占位符，学生通过点击左右项目连线；英语听力匹配保持等数量一对一。两类连线均按正确连线数等比例给分，未连计零；每题得分和卷面总分保留两位小数。部分正确仍作为未全对计入错题本，题目正确率只统计全对。单个左项连接多个右项及多对多暂不支持。Word 使用「连线题」标题、逐行「匹配项：内容」、A./B. 等右侧选项和按左侧顺序填写的答案（例如 `A,B,A,B` 或 `1,2,1,2`）；数学扩展 Excel 的「排序题」表填写「数学细分题型」为「连线」、「匹配左侧项目」每行一项，选项及答案格式相同。答案缺失时可先进入待审核，入库前须补齐并核对。
- 数学作图使用 `question_subtype=drawing`、`type=answer`，学生通过画布提交 PNG，老师对单次作答人工评分。Word 使用「作图题」标题，数学扩展 Excel 使用「作图题」表，参考答案可留空。`GET /api/stu/bank/subjective-responses/:id/drawing` 仅本人可读，`GET /api/admin/xreport/subjective/:id/drawing` 限总校或所属分校；常规列表与试卷明细不返回图像数据。单张文件最多 384 KiB，尺寸最多 1600×1200 且不超过 160 万像素；不接受外部 URL、SVG 或非 PNG 数据。当前支持鼠标和触屏画布，暂不支持图片附件上传。
- `POST /ext/pending/manual-group` 可提交学科、学段、共用 `material` 和 2–30 道 `questions`，可附共用 `audio_key` / `audio_play_limit`；每道小题独立待审核、入库与作答，并各存一份材料快照。同组标识保存于题目 `source_detail.question_group`；编辑单题材料不会修改其他小题。`GET /api/admin/bank/mf/questions/:id/group` 按来源类型、批次或包 ID 和组标识查找已入库小题，返回 `group_key`、按原始位置排列的 `list` 及位置有缺口的 `gaps`。若位置缺失或冲突则拒绝整组加入，仍可单独选题；未审核或已删除的小题不会出现在结果中。部分 Excel、Word 多小问及带材料的一层 JSON `children` 也保留组标识；不支持任意嵌套。
- 学生端所有出题接口（`lesson-questions`、`papers/:id`、`mfpapers/:id`、`scan-compose`、`review-queue`、`mistakes` 等）返回的题目带 `audio_url`（没有音频为空串）。本地存储时是 `/api/file?key=…`，`<audio>` 带不了请求头，前端把登录票据拼成 `&token=` 再播放；云存储是签名外链，原样播放。

课文习题 · 小分组挂题 / 视频关联知识点（R8，`bank.js`）：
- 后台 `GET /api/admin/bank/sections/:id/questions` → `{section, chapter, list:[题目，含答案], video_question_count}`（`video_question_count` = 组内视频绑的题数）。
- 后台 `POST /api/admin/bank/sections/:id/bind {ids, unbind}`：挂到小分组（同时清掉这些题的 `video_id`，`chapter_id` 写成小分组所属课程）；`unbind:1` 只解绑**确实挂在这个小分组上**的题（没绑视频的顺带清 `chapter_id`），返回 `{count}`。`POST /videos/:id/bind` 绑定时也会清掉 `section_id`（一道题在课程里只挂一个位置）。
- 后台 `POST /api/admin/bank/questions` 可带 `section_id`：新题直接挂到该小分组（课文习题弹窗里「添加习题」用）。`GET /questions?video=free`：只列既没绑视频也没挂小分组的题（「从题库选择」用）。
- 后台 `GET /api/admin/bank/videos/:id/nodes` → `{video, subject, stage, nodes:[{id,name,tree_id}], trees:[知识点树，学科 + 学段对应的排第一], tree_id}`；`POST /videos/:id/nodes {node_ids}`：**整体替换**（最多 30 个，不存在的节点 id 忽略，传空数组 = 清空），返回 `{count}`。
- `GET /chapters/:id/lessons`：`sections[]` 多了 `question_count`（小分组自己的题数），`videos[]` 多了 `nodes:[{id,name}]`；`GET /videos/:id/questions` 多了 `nodes`；`GET /chapters` 的 `question_count` 含小分组的题。
- 学生端 `GET /api/stu/course-detail`：`groups[]` 多了 `own_qcount`、`own_acc`（小分组自己的题）、`practice_count`（小分组练习题数 = 组内视频题 + 自己的题），`acc` 改为两者合并；`lessons[]` 多了 `nodes:[{id,name}]`；整门课的 `acc` 含小分组的题；新增 `next:{video_id,title,group_id,group_name}|null`（「继续学习」）。`GET /api/stu/courses` 每门课多了 `acc`（课程卡片底部的正确率）。
- 学生端 `GET /api/stu/bank/section-questions?section_id=` → `{title, section_id, list}`（小分组练习：组内视频的题在前、小分组自己的题在后，最多 60 题，不含答案；按年级 / 学段做可见性校验）。
- 学生端 `POST /api/stu/bank/submit` 新增 `kind=section` + `section_id`：只计这个小分组练习范围内的题，返回的 `mastery.section` 是该小分组现在的正确率；所有 `submit` 结果的 `list[]` 每题多了 `point`。
- 学生端 `GET /api/stu/bank/node-mastery?node_id=&course_id=` → `{node, total, answered, correct, rate, list:[做过的题 {id,type,stem,is_correct,at,my_answer}], videos:[本课程里关联了该知识点的视频]}`；题目范围 = 挂在该节点及其子孙上的题（`question_nodes`）∪ 绑在「关联了这些节点的视频」上的题（`video_nodes`）。
- 学生端 `POST /api/stu/bank/check` 的填空题结果多了 `blanks:[true,false,…]`（逐空对错）。

AI 老师浮层 · 流式讲解（R8，`bank.js` + `ai-client.js`）：
- 学生端 `POST /api/stu/bank/ai-explain/stream`，body `{question_id, my_answer, mode:'explain'|'guide', history:[{role:'user'|'assistant', content}], ask}`；返回 `Content-Type: text/event-stream`（`Cache-Control: no-cache`、`X-Accel-Buffering: no`），每个事件一行 `data: {json}`：`{"t":"start","mode"}` → 若干 `{"t":"delta","text"}` → `{"t":"done","model","first_ms","ms"}`；出错 `{"t":"error","msg"}`。题目不存在等参数错误直接返回普通 JSON（`code:1`）。
  - `explain`：按 `### 知识点 / ### 思路 / ### 步骤 / ### 易错点` 输出的 Markdown，公式 `\( … \)`；`guide`：苏格拉底式一步步引导（一次只问一个问题，学生在输入框回答）。题目、选项、学生答案、正确答案、参考解析每次都放进 system 提示，`history` 是前端保存的之前对话（最多 12 条），所以追问不丢上下文。
  - `AI_MOCK=1`：不调外部接口，按题目内容拼一段示例回复，每 28ms 推 2 个字（CI / 截图用）。
  - 客户端断开（关面板）时中止上游请求。
- `src/ai-client.js` 新增 `chatStream(input, onDelta, {signal})`：OpenAI 兼容格式发 `stream:true` 并解析 SSE（只取 `delta.content`，不推 `reasoning_content`）；Anthropic / Gemini 先退化为一次性返回再按 24 字一段推送；服务商不认 `stream` 直接回整段 JSON 时也按一次性结果处理。
- 旧的 `POST /api/stu/bank/ai-explain`（分步引导 JSON）保留不动，学生端已不再调用。

学生端 `/api/stu/bank`：`GET /lesson-questions`、`/tasks`、`/papers`、`/papers/:id`、`/mfpapers`、`/mfpapers/:id`、`/scan-tree`、`/mistakes`、`/mistake-count`、`/mistake-points`、`/review-queue`、`/uploads`、`/section-questions`、`/node-mastery`；`POST /submit`、`/scan-compose`、`/check`、`/feedback`、`/ai-explain`、`/ai-explain/stream`（SSE）、`/upload-token`

扫码上传 `/api/up`：`GET /info`、`POST /submit`、`GET /mine`

## 魔方题库（`mfbank.js`，前缀 `/api/admin/bank/mf`）

| 资源 | 接口 |
|---|---|
| 目录树 | `GET/POST /trees`；`PUT/DELETE /trees/:id`；`GET/POST /trees/:id/nodes`（GET 返回扁平节点，每个带 `qcount` = 本节点及所有子孙节点上题目的**去重**数、`qcount_own` = 只算节点自己；R0-B10）；`PUT/DELETE /nodes/:id`；`POST /nodes/:id/move`（body `{dir:'up'|'down'}`，同级内上移/下移一位，服务端先把同级顺序规范成 0..n-1 再对调；T4 新增）；`GET/POST /questions/:id/nodes` |
| 目录树 | `GET/POST /trees`；`PUT/DELETE /trees/:id`；`GET/POST /trees/:id/nodes`；`PUT/DELETE /nodes/:id`；`POST /nodes/:id/move`（body `{dir:'up'|'down'}`，同级内上移/下移一位，服务端先把同级顺序规范成 0..n-1 再对调；T4 新增）；`GET/POST /questions/:id/nodes`；**R2**：`GET /trees` 返回里多 `defaults`（默认版本表），`POST /trees` / `PUT /trees/:id` 带 `edition`（章节树创建时必填，同 学段+学科+种类+版本 不能重复）；`GET /editions` → `{defaults, existing:[{tree_id,kind,subject,stage,edition,name,source,node_count}], grouped}`（默认版本表 + 每个 学段/学科 下已存在的树和版本）；`PUT /editions` `{defaults:{学科:{学段:版本}}}`（校验后存进 `settings.default_editions`，返回同 GET）；`POST /trees/import`（JSON body 或 multipart `file`=.json，`?dry=1` 只统计；格式见 `docs/tree-import-format.md`；按 kind+subject+stage+edition 找 / 建树，按路径合并只增不删；返回 `{results:[…], added, existing}`）；`GET /trees/:id/export`（同格式 JSON）；以上在 `mfbank.js`，逻辑在 `treepick.js` / `treeio.js` |
| 题目 | `GET/POST /questions`；`GET/PUT/DELETE /questions/:id`；`POST /questions/batch`；`GET /tags`；`GET /questions-export`；`POST /ai-clean` |
| 采集 | `POST /capture/parse`；`GET /capture/token`；`GET /capture/bookmarklet`；`POST /capture/fetch`；`POST /capture/auto`；`POST/GET /capture/batches`；`GET/DELETE /capture/batches/:id`；`DELETE /capture/batches/:id/q/:idx`；`POST /capture/batches/:id/commit`；`POST /api/mfcap/push` |
| 试卷文件夹 | `GET/POST /paper-folders`；`PUT/DELETE /paper-folders/:id` |
| 试卷管理 | `GET/POST /papers`（`GET` 支持 `kw`、`subject`、`grade`、`year`、`published=0/1`、`status`、`folder` 筛选；`POST/PUT` 带 `year`，不是 4 位数字会被忽略）；**`POST /papers/import-word`（T10，上传真题试卷）**；`GET/PUT/DELETE /papers/:id`；`POST /papers/:id/questions`；`POST /papers/:id/text`；`PUT /papers/:id/reorder`；`PUT/DELETE /papers/:id/rows/:rowId`；`GET /papers/:id/preview`；`GET /papers/:id/export`；`POST /papers/:id/archive` |
| 录题 intake | `GET/POST /intake/runs`；`GET/DELETE /intake/runs/:id`；`POST /intake/runs/:id/pages|recognize|ocr|structure|word|aifill|commit`；`PUT /intake/runs/:id/drafts` |
| 导入 | `GET /import-skill`；`POST /import-pack`（**T3 起不再直接入库**：解析 + 去重/补图照旧，新题放进一个 `skill` 批次进待审核；响应带 `staged`、`run_id`）；`POST /asset` |
| 待审核题目（T3，`mfpending.js`） | `GET /ext/pending`（`source`=all/photo/word/excel/skill/capture/scan、`kw`、`page`、`size`；响应 `{total,page,size,list,counts}`，每项带 `id`、`source`、`source_label`、题目内容）；`PUT /ext/pending/item`（`{id, patch}` 编辑单题）；`POST /ext/pending/commit`（`{ids, subject, stage, grade, node_ids, tags}` 逐题/批量入库，响应 `{committed, question_ids, failed:[{id,msg}]}`；**学科、学段必须有**：题目自己没有、请求里也没传的，进 `failed`（全部失败时整个请求报错），提示「没有学科 / 没有学段，请先选好…」；R0-B8）；`POST /ext/pending/delete`（`{ids}`）；`POST /ext/import-excel`（multipart `file` + 默认 `subject/stage/grade`，按客户 9 个 sheet 模板，忽略【例题】行）；`POST /ext/import-word`（multipart `file` .docx，规则解析不调 AI，响应带 `errors:[{para,no,msg}]` 段号）；`GET /ext/import-template`（客户《习题导入模板》逐字节原文件）。id 形如 `run:批次:序号:指纹` / `cap:批次:序号:指纹` / `up:上传记录`，**指纹**是题干的 md5 前 8 位：别人删改过之后序号会前移，旧 id 对不上指纹会被拒绝（提示刷新），避免入库/删掉另一道题 |
| 配置与扩展 | `GET/PUT /config`；`GET /ext/badge-counts`（T3 起另带 `pending`、`pending_by`）；`GET /ext/review-list`；`POST /ext/ai-attrib` |

`GET /questions` 的 `use` 表示本平台现存试卷中包含该题的份数；`reference_count` 表示这些试卷份数加上该题绑定的实际视频、小分组数量。试卷计数包含草稿、归档和回收站，不包含知识树分类和学生作答；这些不是外部站点的历史统计。

题目接口返回五星 `difficulty` 及可空十级 `difficulty_score_10`。写入十级值须是 1–10 的整数，服务器同步为 `ceil(十级值 / 2)` 星；同时提交两者但不匹配时拒绝。旧客户端仅修改五星且星级不变时保留已有十级值，改变星级时清空十级值。题库 JSON 导出包含这两个字段；技能包可以使用明确的 `difficulty_score_10` 字段，原生魔方包也可以使用 `metadata.extra.zhilexue.difficulty_score_10`。

`GET /ext/import-template` 无参数时仍按原字节提供客户 Excel 模板；`?difficulty_10=1` 返回末尾追加「十级难度（1–10，选填）」的通用模板，`?english_subtypes=1` 返回英语扩展模板，`?math_subtypes=1` 返回数学扩展模板；英语及数学扩展模板均包含十级难度。原有未标明十级的「难度」列按五星理解；两个字段冲突或越界时对应行不导入并返回错误。

## 采集与 AI 配置（`mfcollect.js`，前缀 `/api/admin/bank/mf/ext`）

- 字典：`GET/POST /dict`；`POST /dict/assign`；`DELETE /dict/:id`
- AI 配置中心 profiles（T2，全站唯一的 AI 配置入口）：`GET/POST /profiles`；`PUT/DELETE /profiles/:id`；`POST /profiles/models`；`POST /profiles/test-draft`；`POST /profiles/:id/test`；`POST /profiles/:id/enable`；`POST /profiles/quick`
  - 档案字段 `format`：`openai`（OpenAI 兼容，默认）/ `anthropic` / `gemini`；`GET /profiles` 另返回 `formats:[{key,name,hint}]`（每种格式的接口地址写法提示）。非法格式、接口地址不是 http(s) 开头会被拒。
  - `POST /profiles/models` `{format, base_url, api_key}`：按格式走各自的模型列表接口。
  - `POST /profiles/test-draft` `{role, format, base_url, model, api_key, id?}`：测试一份**还没保存**的配置（新增表单里的"测试连接"），不落库；编辑已有档案时 `api_key` 留空 = 用库里的密钥。错误地址 / 密钥 / 模型会给出明确原因。
  - `POST /profiles/:id/test`：测已保存档案并记录 `last_test_ok`；`/enable` 要求测通，同角色排他。
- 其他：`POST /ai-suggest`；`POST /collect-tree` 与 `POST /api/mfcap/tree-push` 共用导入逻辑，须指定 `stage`、`subject`、`kind` 和 `edition`；知识点通用树通过 `edition_selected=true` 显式选择。可用 `tree_id` 指定相同学科、学段、类型和版本的目标树，`dry:true` 只预览；正式导入按节点路径合并，拒绝循环、重复 ID 和缺失父节点。`GET/PUT /prefs`；`POST /proxy-ticket`；`/api/mfproxy`：`GET /inject.js`、`GET /ck`、`GET|POST /r`（辅助代理默认关闭；开启时跨域响应不带凭据）。

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

## 二轮整改进行中：录题和试卷审核

- `GET /api/admin/bank/mf/ext/import-template?options_10=1`：下载十选项扩展模板；单选、多选、完形填空和阅读理解工作表在客户原表列尾追加缺失的 A–J 选项列。无参数仍返回字节不变的客户原模板；英语、数学、十级难度扩展模板同样支持 A–J。选择题选项须从 A 连续填写，最多 10 项。
- `POST /api/admin/bank/mf/ext/pending/manual`：手动题保存为待审核批次，支持 `material`、`audio_key`、`audio_play_limit` 和听力匹配 `match_prompts`；未填答案、解析保持空白。`GET /ext/pending` 支持 `review_status=no_answer|no_analysis|no_image|no_class` 和对应计数。
- `POST /api/admin/bank/mf/ext/pending/manual-group`：接收共同材料、可选共用音频和 2–30 道小题，拆成独立待审核题卡并保留同组标识；材料以小题快照保存，后续修改不会联动。部分 Excel、Word 和单层 JSON 组合题也保留组信息；整组组卷支持加入当前已入库小题并保留原顺序，复杂嵌套及 JSON 共用音频仍未完成。
- `POST /api/admin/bank/mf/ext/pending/image`：使用 multipart `id`、`index`、`file` 替换待审核题中转存失败的图片。外链图只允许经过公网地址及跳转检查的 HTTP(S) 图片，限制 5 MB 并验证图片签名；未补齐的题目不能入库。
- `POST /api/admin/bank/mf/ext/pending/ai-classify`：返回题型、十级难度和限定题目学科、学段、教材版本等范围的现有树节点建议；生成过程不改写题目、答案或解析。建议须由老师逐项勾选确认。已用一道合成题通过真实模型检查请求和原答案保护，推荐准确率尚未验收。
- `POST /api/admin/bank/mf/papers/from-run`：将图片/PDF 识别批次转换为未发布试卷草稿，审核入库后自动回挂。`POST /api/admin/bank/videos/:id/import-docx` 与旧 `POST /api/admin/bank/questions/import` 也先创建待审核批次。
- `POST /api/admin/bank/teacher-upload-token` 创建 30 分钟教师扫码票据；`/api/up/info`、`/api/up/submit` 支持该票据，教师上传先进入审核。学生扫码同样先审核，批准后才创建题目并进入学生错题本；兼容历史已入库上传。
- 章节-知识点映射：`GET /api/admin/bank/tree-mapping?chapter_tree_id=&knowledge_tree_id=`、`PUT /api/admin/bank/tree-mapping/:chapterNodeId`；仅允许同学科、同学段的节点。
- `GET /api/admin/dashboard` 返回当日/本周聚合及 14 日趋势，学生统计按分校隔离。试卷可保存 `question_scores`（题目 ID 到整数分值的对象）和 `due_at`（ISO 时间）；下发时可设置截止时间。
- 旧的 `/intake/runs/:id/commit`、`/capture/batches/:id/commit` 不再直接入库，统一使用 `/ext/pending/commit`。外站辅助代理默认关闭，书签采集仍可使用。
- 待审核入库的 `node_ids` 必须为现存分类节点，且节点所属树的学科、学段须与题目一致（树上留空表示不限）。批量中不匹配的题目留在待审核并返回失败原因；复用既有题目时也会检查既有题的分类。
- `POST /api/admin/bank/mf/ext/pending/ai-classify` 接收 `{ids}`（1–20 条待审核项），返回 `{list:[{id,type,difficulty_score_10,nodes,error?}],mock}`；无法判断的题型或十级难度为 `null`。生成仅返回建议，不修改待审核题目、答案、解析或入库状态。老师确认题型或难度后先保存审核草稿；勾选节点才入库，并校验题目和教材范围未变化。演示模式明确标注，真实模型仍需实测。
- Excel 导入 `POST /api/admin/bank/mf/ext/import-excel` 可选传入 `edition`、`term`、`material_type`，批次保存这些资料信息；教材版本需属于所选学科和学段，册别支持上册、下册和全一册，资料类型支持 `textbook`、`exercise`、`paper`、`other`。题目仍进入待审核，版本不会自动挂分类节点。
- 待审核列表在指定具体 `source` 时可传 `batch_id`，仅显示该批次的待审核题目。
- `GET /api/admin/bank/mf/ext/pending/batches?source=&kw=` 返回录题、采集及扫码批次的题数、待核对数和状态，各来源读取最近 300 条，最多返回 200 条；`GET /ext/pending/original?id=` 仅对确有页码和页图的识别题返回原页地址。
- 拍照录题新建批次 `POST /api/admin/bank/mf/intake/runs` 可选传入 `edition`、`term`、`material_type`，校验规则与 Excel 批次一致。图片逐张上传至既有 `/intake/runs/:id/pages`；上传后仍由现有识别工作台处理并进入待审核。
- Word 规则导入 `POST /api/admin/bank/mf/ext/import-word` 同样支持可选 `edition`、`term`、`material_type`，按原规则解析并保存待审核批次。PDF 导入在浏览器逐页转为图像后使用现有录题批次和识别工作台，不改变识别接口。
- 待审核、真题和课文习题 Word 的每题可选写独立一行 `难度（1–10）：7` 或 `十级难度：7`；只接受 1–10 的整数，不填时不会从旧五星难度推算。多小问可继承大题难度，也可单独覆盖。教师版试卷 Word 对十级值显示 `N/10`，没有十级值的旧题显示原有 `N/5`。

### 录题 AI 答案和解析建议

- `POST /api/admin/bank/mf/intake/runs/:id/aifill` 保留旧路径，改为仅对原题缺失的答案或解析生成独立的 AI 建议，不自动改写正式字段或分类。可传 `{indexes:[...]}` 选择题卡；建议需老师审核后逐项采纳。
- `POST /api/admin/bank/mf/intake/runs/:id/aifill/confirm` 接收 `{index,token,fields:["answer","analysis"]}`（可只确认其中一项）；建议的题目内容或批次学科、学段、年级改变后需重新生成。采纳后题卡仍需经过待审核入库。
- 历史 `ai_filled` 题卡必须由老师核对当前答案和解析，提交 `{index,legacy:true,expected}` 明确确认后才能入库。保存工作台题卡不能直接修改审核状态；已入库的旧记录如果缺少来源标识，无法可靠判断是否曾由 AI 补全。

### 学生题目短期授权

课文和小分组练习、试卷、扫码自组卷、错题重练、同类题及复习队列返回的每道题包含 `quiz_ticket`，不包含答案和解析。`POST /api/stu/bank/check` 的每个 `items[]`、`POST /api/stu/bank/ai-explain` 和 `/ai-explain/stream` 的请求体，以及 `kind=self` 交卷的每个 `answers[]` 必须携带对应题目的 `quiz_ticket`。票据绑定学生与题号，有效期为签发后 2 小时；缺失、过期或不匹配返回 403，并提示重新打开练习，旧客户端应更新后重新取题。普通卷、真题卷、课文和错题等其他交卷路径仍执行原有服务端范围校验。

票据在有效期内有效；老师撤销下发或试卷改为未发布后，之前签发的票据最多仍可用于原题核对或 AI 讲解 2 小时，不能重新取回撤销后的试卷，也不能绕过原有试卷交卷校验。核对接口单次最多处理 50 题；此上限不是调用频率限流。
- 网络采集和学生扫码题使用 `POST /api/admin/bank/mf/ext/pending/ai-answer`（`{ids}`，最多 20 题）生成独立建议；`POST /ext/pending/ai-answer/confirm`（`{id,token,fields}`）逐项确认。生成与确认时检查题干、选项、答案及学科范围，确认时锁定来源记录；纯图片且尚无题干文字的扫码题需先补录或识别题干。历史扫码题如已提前入库，确认后才补写所选字段，保留审核标记。
- 拍照识别、文字整理和工作台 Word 的模型识别答案/解析保存为标记 `source=recognition` 的待确认内容，老师对照原文逐项确认后方可作为正式答案/解析；模型推荐的知识点标签不会自动入库。历史带原页或旧模型整理标记且已有答案或解析的题卡因无法区分来源，保留原值并要求老师核对后入库；纯人工题无需此步骤。
- 自动采集 AI 兜底无法核实模型返回的答案和解析来自原文，保守留空，模型推断题型需老师确认。建议签名包括题图、音频、匹配题左项和细分题型，内容变化须重新核对。
