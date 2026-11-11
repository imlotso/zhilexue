# 逐项发现与证据

基线4f60b7a9bdc5015323308a21a30dfa76e408c0c8。P1应在继续扩大使用前处理；P2安排近期修复；P3为低风险正确性/体验改进。严重性与证据等级分开，不把静态风险写成生产事故。

## I1 / P1：普通不等式入库被误当HTML删除
- 位置：[mfbank.js:2235–2236](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mfbank.js#L2235-L2236)，采集类似逻辑在1155–1156。
- 合成步骤：后台手动录入数学解答题“若 1 < x < 3 且 y > 0，求 x+y。”→保存待审→按最新快照入库→再次读取正式题。
- 实际HTTP+SQL结果：stored_stem为“若 1 0，求 x+y。”，stored_html为空。没有真实题目或真实AI。
- 原因：对普通文本使用/<[^>]+>/g去标签，吞掉不等式片段。建议区分纯文本和HTML，从结构化内容保留数学符号；导入、手录、采集均加回归。

## I2 / P1：清空中间选项后答案与显示字母错位
- 位置：[pendingui.js:1067](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/admin/pendingui.js#L1067)，[mfpending.js:747–748、807](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mfpending.js#L747-L807)。
- 合成步骤：采集题A错误、B将清空、C正确且答案C→编辑B文本为空并保存→后台过滤空项→采集存储丢失原标签→列表重新编号A/B→快照入库→学生用题目票据选择显示的正确B。
- 实际HTTP+SQL结果：保存成功，选项为A错误/B正确，答案仍C，学生B判false。选项数量校验未拒绝这一错配。
- 专门“删除选项”按钮已有映射，本项仅指编辑文本为空后保存的路径。建议保持选项稳定ID或在过滤/重编号时同步答案，并校验答案属于现存选项。

## I3 / P2：旧兼容入库API仍有重复入库窗口
- [mfpending.js:1053–1071、1181–1201](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mfpending.js#L1053-L1201)。
- 仅发ids、不发items的兼容入口逐题事务结束后再写批次标记。内存DB注入最后标记失败：题库1条，待审未标记；重试后2条。
- 当前新批量UI在pendingui.js:677发送items；外层事务+快照/行锁路径已修复并通过回滚测试。pdCommit旧助手未找到调用点。不能继续声称新UI主流程非原子。
- 建议统一兼容入口到事务和幂等凭据，或明确弃用旧API。

## B1 / P1 / 仍存在：报告附件删除缺少统一文件边界
- 接收端：[report.js:78–98](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/report.js#L78-L98)，paperKeys仅校验数组非空及项数上限，直接持久化。
- 删除端：[report.js:170–180](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/report.js#L170-L180)，确认报告属于当前后台账号后，将存储的每个附件key送入deleteFile，没有验证附件所属目录、上传记录或key格式。
- 根因：[storage.js:338–350](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/storage.js#L338-L350)，localPath直接path.join，虽localFilePath有真实路径边界检查，删除却不调用它；[storage.js:448–462](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/storage.js#L448-L462)直接unlinkLocal(localPath(key))。
- 前提：后台账号；附件key进入本地删除分支；目标为服务账户可写文件。默认本地目录名单见storage.js:125。分析失败不会撤销已写的报告。
- 影响：删除范围可能越出上传目录，造成服务文件/数据丢失。不能因读路径安全或云存储只读就认为本地删除安全。尚未验证部署文件权限，因此不声称所有系统文件都可删除。
- 修复：删除公共入口严格校验规范key及解析后路径边界；报告仅引用当前用户上传的report附件记录；历史key也应校验。

## B2 / P1 / 仍存在：旧学习报告没有分校归属限制
- [app.js:1372–1386](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L1372-L1386)：旧列表返回全部学生姓名、账号、年级与进度；详情仅按用户id加载，没有created_by或student角色约束。
- 公共鉴权[app.js:417–422](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L417-L422)仅要求admin/branch，不替代学生归属。
- 对照：新报告[reports.js:21–39](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/reports.js#L21-L39)以及[reports.js:157–161](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/reports.js#L157-L161)明确限定分校只能查本校学生。
- 影响：仍挂载的旧接口与新权限规则不一致，可跨校暴露学生身份和学习活动。此结论针对学生数据，不把共享题库/课程当作越权。
- 修复：旧新路由共享学生授权助手，列表SQL过滤归属、详情要求student角色及所属分校。

## B3 / P1 / 仍存在：视频列表与文件读取未统一课程可见范围
- [app.js:1802–1814](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L1802-L1814)：只在提供chapter_id时校验课程可见；不提供时返回全部视频的file_path/url。
- 对照[app.js:1817–1823](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L1817-L1823)正常播放按课程校验。
- [app.js:366–414](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L366-L414)：通用文件入口在登录和格式检查后读文件/签发云URL，缺少视频关联课程的授权。careAudio保护独立录音，不解决普通视频范围。
- 前提：登录学生，存在其不可见年级/学段课程。影响：不属于当前可见范围的视频位置被下发，通用文件路径可能绕过正常播放接口。
- 修复：无chapter_id列表也套课程可见条件；文件读取基于资源归属校验或经授权后签发绑定资源的短票据。

## B4 / P2 / 仍存在：后台试卷统计漏掉mfpaper
- 写入：[bank.js:1677–1681](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/bank.js#L1677-L1681)，mfpaper写mf_paper_tries。
- 读取：[reports.js:129–150](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/reports.js#L129-L150)、[reports.js:163–167](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/reports.js#L163-L167)仅读paper_tries。
- 影响：完成试卷库真题后后台试卷次数、均分、最高分与详情缺失；仅做mfpaper的学生可显示0次。records里的逐题记录仍可能存在，不能表述为整次数据被删除。
- 修复：汇总两类尝试并保留来源类型，分别关联对应试卷表，包含人工评分更新后的结果。

## B6 / P2 / 仍存在：删除题目破坏已发布普通试卷引用和可得满分
- 删除入口：[app.js:932–935](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/app.js#L932-L935)、[bank.js:283–299](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/bank.js#L283-L299)均直接删题，未同步papers.q_ids；[mfbank.js:624–631](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mfbank.js#L624-L631)只清理魔方卷引用，不处理普通卷。
- 取题：[bank.js:1448–1454](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/bank.js#L1448-L1454)用filter(Boolean)丢弃不存在题，仍返回原total_score。
- 判分：[bank.js:1641–1656](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/bank.js#L1641-L1656)按原完整q_ids均摊最高分，仅对实际题生成明细。qmeta.questionsAllowed只查询现存题的审核权限，不保证全部题号存在。
- 前提：后台删除普通已发布卷引用的题。例：原两题100分删掉一题，剩余题全对仍按50分计，卷面总分仍100。此例是静态算法推导，未执行删除测试。
- 修复：引用中题阻止删除、软删除或保存试卷题快照；统一各删除入口的数据一致性策略，不静默删失题。

## B7 / P3 / 仍存在：Word试卷默认100分舍入不守恒
- 最新行号：[mfpending.js:1543–1554](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mfpending.js#L1543-L1554)，each=Math.round(100/cards.length*10)/10；每题复制同一分数。相比旧快照行号1438/1449已变化。
- 学生总分按真实SUM(score)返回：[bank.js:1755–1758](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/bank.js#L1755-L1758)。
- 影响：3题默认99.9分，6题默认100.2分，老师需额外人工调整。是静态算术推导，未创建试卷。
- 修复：用整数分/十分并分配余数，让默认总分严格等于100。



## B8 / P2：COMMIT前连接失效会跨连接重试，可能丢事务却回报成功
- [mysql-worker.js:143–158、181–186](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mysql-worker.js#L143-L186)在COMMIT之前清inTx，query因此允许ensureConn重连；[mysql-sync.js:123–132](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/src/mysql-sync.js#L123-L132)把空COMMIT成功当成原事务成功。
- 实际main源码、VM纯内存假MySQL复现：健康对照保存1行；最后INSERT成功后COMMIT前fatal/closed-state两种断线分支均重建连接并回复成功，但已提交0行。事务内普通INSERT的断线负对照正确失败且不重连。
- 触发窗口较窄；未进行真实数据库断线试验，未声称生产已发生或估计发生频率。证据为控制流复现，不是纯静态猜测。
- 建议COMMIT完成前保留事务身份；事务连接失效必须报错/结果不确定，不跨连接重试提交，由业务幂等凭据恢复。

## 结果摘要

F1–F10均用正式main源码重新复现。所有执行均为VM/jsdom+合成API边界，不是产品浏览器全流程；成功退出码代表缺陷成功重现，不代表功能通过验收。

优先处理数据安全与误导性结果：

1. **F7 / P1：成绩页身份验证失败仍显示旧账号本机成绩。** [store.js:5–12](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/store.js#L5-L12)、26–43、149–162；[app.js:126–130](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/app.js#L126-L130)。全局存储先读，401返回false被启动流程忽略，页面仍渲染。无token+401夹具仍取得Synthetic A的77分。范围为共享浏览器的本机数据暴露/串用，不声称API越权。应隔离账号并在验证失败时关闭数据视图。
2. **F8 / P2：存储满后静默丢成绩修改。** [store.js:9–12](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/store.js#L9-L12)、45–48、208–210。LS.set吞Quota异常，外层save无法感知，调用者继续成功提示。实测内存88、持久化77、零错误提示。应失败可见、保留输入、回滚内存。
3. **F9 / P2：家长扫码提交只在手机保存，却说老师会收到。** [import.js:549–568](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/views/import.js#L549-L568)；[parent-upload.html:174–219](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/parent-upload.html#L174-L219)。records.js:89,107→import.js:31为可达入口。实测显示提交成功、网络请求0、家长本地1条、老师本地0条。底部已有测试版本机存储说明，故不把本地设计本身当bug；问题是主CTA、二维码说明、成功反馈承诺后台待审，而没有服务器传输实现。应取消发送成功承诺或真正接通收件。
4. **F10 / P2（教学可信度优先）：无试卷证据生成知识点差异，却标注来自试卷。** [knowledge.js:178–201](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/knowledge.js#L178-L201)、[import.js:524–538](https://github.com/imlotso/zhilexue/blob/4f60b7a9bdc5015323308a21a30dfa76e408c0c8/public/apps/grades/assets/js/views/import.js#L524-L538)、kndiag.js:88。仅传学科+总得分率，用sin/cos波动生成12个不同知识点分数，不读取图片或逐题成绩。实测无图片就生成差异。部分界面说明预填/个人估算，但“由试卷快照自动生成”和据此弱项诊断仍会误导。应把无证据掌握度留空，确认逐题数据后出诊断。

其余复核保留：

- **F1 / P2** 历史错词被后定义的错句函数覆盖。`public/js/words.js:829,834–853,868–881,1723–1741`。错词当前表1条、历史0条，key实际走错句空间。
- **F2 / P2** 课程A慢响应覆盖当前B。`public/js/vue-app.js:333–380,455–463`。route/courseId=2而course.id=1，学科也被旧结果改回。
- **F3 / P2** quick→phrase旧数据请求污染新模块。`public/js/words.js:383–435`。短语新结果1条被迟到quick改成0条；外层Vue seq不保护全局WT。
- **F4 / P2** 学生账号更换复用旧人统计。`public/js/words.js:355–357,469–478`，`public/js/vue-app.js:658–669`。A→B同书，B没有stats请求，仍显示A的20次作答。
- **F5 / P2** 前台弹窗Enter触发背后默写。`public/js/words.js:2820–2831`。真实全局捕获监听在jsdom合成前台dialog中触发后台submit。实际退出确认弹窗尚无浏览器实测，不能夸大为所有弹窗都有真实复现。
- **F6 / P2** 后台AI例句换书轮询错任务。`public/admin/words.js:628–657`。book1启动、切book2后轮询book2并报0条完成；应绑定原book/task。

以上行号在新目标均复核未变。上述问题已按本次main重新核验，复现脚本随本分支提供。

## 500px公式键盘：独立检查与限制

- `public/css/app.css:4038–4049`：mask固定铺满、左右padding 14px；dialog width=min(560px,100%)。在标准border-box及500 CSS像素视口假设下，mask内容宽472px，dialog最大472px。其padding18px使内部可用宽进一步缩小。静态规则并未发现明确500px横向溢出的必然条件，但不能由算式断言实际MathLive键盘无溢出。
- `public/js/mlive.js:76–83,89–98,128–144`：接入DialogUX，独立keyboardHost放mask内部，空插入返还公式焦点，关闭隐藏键盘并将container复原。源代码逻辑有清理保护。
- 独立 `formula-500-dom-audit.cjs` 用目标源码、500px window元数据和**替代MathLive/键盘边界**执行。modal ARIA、host归属、空插入焦点、非空回调、关闭/取消清理通过。不是500px布局测试，不证明真实展开/收起动画或命中区域。
- 目标自带 `mlive-keyboard-browser-test.js:81–83,141–143` 仅390×844与1440×900两尺寸，各admin/student四案例；它核验空插入后真指针输入，但无500px案例、无专门展开收起/遮挡几何断言。它加载的是独立对话框壳，不是全部学生/后台真实页面上下文。
- 已知执行器Chromium Unix socket EPERM限制已确认；本轮不重复相同失败、不绕过限制。**未执行真实浏览器、未取得500px截图；真实键盘展开/收起、软键盘与视口变化、模态footer是否被挡仍未验证。** 不将DOM夹具通过当作视觉通过，也未修改测试制造500px绿灯。

