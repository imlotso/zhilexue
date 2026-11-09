# 森屿教学台全站实施记录（2026-11-09）

## 状态与基线

**代码已实施并完成三页、学生导航整合；浏览器视觉验收未完成。** 仅交付独立审查分支，不合并 main、不部署线上。

基于 `2c4adba46e0fe4d0ca85a2a406c3b32d313c66fc`。用户亲自放在本机的归档树与该提交的 Git tree 一致。没有重新传输旧受阻会话的源码，没有启动带原配置的后端，生产配置、后端、数据、权限和接口均未修改。

覆盖后台/学生主入口、共享组件、后台嵌入桥接、独立拍照上传/扫码报告，以及现有录题、审核、树、答题、报告、导出和组卷组件的样式适配。成绩、谈心与家校三页已整合，详见 `senyu-three-pages-20261109.md`。学生抽屉导航修复详见 `senyu-student-navigation-20261109.md`。独立键盘练习游戏、计时器及其帮助/打印页本批未重构。

## 已实现

- tokens、显式基础组件、旧组件适配分层。所有新主题限定于 `data-ui-theme="senyu"` / `.sy-theme`；主应用再限定 `.sy-core`，上传限定 `.sy-upload`，独立 iframe 自行加载。
- 森林绿、暖白、薄荷、琥珀和墨绿采用批准设计的五个核心色。琥珀使用深色字，焦点采用绿色轮廓，保留现有品牌图。后台 14–16px、学生 16–18px 为正文基础，不套用展示稿的超大正文。
- 后台宽/紧凑侧栏 240/68px；首页指定副标题从真实渲染中删除。父级 iframe 不再强制注入旧蓝灰 body 背景，保留父子 hash 同步及校区/打印按钮代理。
- 适配实际 Element UI 选择/日期门户、目录级联与双树、录题面板、审核分类/入库不同动作、报告内部、组卷预览行与操作、学生答题和真实数字键盘。MathLive 只使用当前库公开的主题变量，不改供应商脚本或公式序列化。
- 共享日期仍以原生字段作为 value、name、min/max/step 与校验的唯一来源，提供范围/步进、键盘、取消、单实例、父弹窗生命周期和 ARIA 恢复。原生 select 在支持的浏览器使用可定制菜单，其他浏览器保留系统菜单。
- 树增加 roving tabindex、方向键、展开/折叠、Enter/Space、Home/End；级联提供选项语义、分列标签、方向键、Escape 和焦点收尾。保留原节点、选择范围、叶节点保护和接口。
- 通用保存弹窗显示真实等待反馈和 spinner，保留原重复提交保护、失败后草稿及按钮恢复。四类共享按钮有 enabled-only 按下反馈及各自悬停样式；禁用不产生按下位移。上传页保持原票据/上传链路并允许用户缩放。
- 学生侧栏两组入口统一 18px 字号、至少 48px 高度、24px 图标和相同对齐、色重及交互状态，保留“学习工具”分组。新作用域的重要性和优先级明确覆盖旧 23/20px、61px 与工具 15px、37px 规则，不把旧 bug 带入新主题。统一关闭方法处理同页/新页、关闭按钮、遮罩、Escape 和路由加载，归还仍属于抽屉的焦点且不抢外部焦点；关闭后 inert/aria-hidden/visibility 移除隐藏导航的键盘可达性。

## 定向验证

本轮使用真实生产组件函数、真实 Vue 抽屉模板/方法和真实入口 CSS；账号、API 返回和节点仅为合成输入，不访问生产资源。

- 当前整合 `npm run test:senyu:unit`：**60/60 通过**，包括共享日期、实际弹窗/树/答题行为、三页、父子 iframe 桥接、学生导航和主题检查。
- 联合定向矩阵：**240/240 通过**，无跳过；包含上述 60 项，不能把两个数字相加。覆盖旧圆润/概念契约、页面生命周期、错题动作、复习日期、教师/手动录题草稿及审核筛选等保留行为。
- 全部七份森屿 CSS 能被 CSSOM 解析，所有共享令牌引用均有定义；批准色与主要文字色对的对比度检查通过。
- iframe 回归执行生产父级桥接、读取真实两页 HTML，覆盖独立主题入口、父→子 hash、子→父高亮、子窗口 history back/forward、重新进入和校区/打印按钮点击代理。**不执行子应用脚本，不证明路由页面内容、打印结果或真实 iframe 布局。**
- 修改 JS 的语法检查与 CRLF-aware 差异空白检查通过。六个入口 129 个本地资源引用均存在。后台及三页 11 个本轮已改脚本更新缓存 URL；学生脚本随导航补丁更新，未改脚本的版本不动。后端/配置/数据目录差异为空。
- jsdom 固定为 26.1.0 开发依赖。250 项既有生产 lock 记录完全未变，已有包锁定版本变化为 0；新 ws 仅位于 jsdom 开发子树，根生产 ws 仍为 8.17.1。`npm ci --dry-run --ignore-scripts` 已通过，没有执行安装脚本。

完整定向矩阵复现命令（正常 npm ci 后无需外部 NODE_PATH）：

```sh
node --test senyu-controls-test.js senyu-workspaces-test.js senyu-behavior-test.js \
  senyu-theme-test.js senyu-three-pages-dom-test.js senyu-iframe-test.js \
  senyu-student-navigation-test.js astra-care-store-test.js astra-care-audio-ui-test.js \
  astra-ui-rounded-student-test.js rounded-shell-test.js rounded-quiz-test.js \
  ui-rounded-admin-pages-test.js astra-ui-learning-space-test.js ui-review-concept-test.js \
  astra-page-api-lifecycle-test.js astra-mistake-action-lifecycle-test.js \
  astra-review-calendar-test.js astra-teacher-intake-lifecycle-test.js \
  astra-manual-intake-draft-test.js astra-pending-review-filter-test.js \
  astra-readonly-tree-cli-test.js
```

## 审查与回归修正

独立审查后增加真实失败回归并修复：

- 长报告在 88vh 后被裁切：恢复 overflow:auto，保留原有 sticky 标题/底栏。
- 日期月末换月、步进键盘和打开期间动态限制：按目标月末钳制，以原生步进校验寻找合法日期，刷新禁用状态但不自动写回值。
- 级联鼠标重绘后焦点丢失、外部焦点被抢回：保留逻辑焦点，使用显式且去重的 focusout 监听，覆盖外部 focus 与 hover 的连续事件。
- 树叶节点展开保护遗漏：恢复旧保护，不向叶节点写展开状态。
- 学生真实确认/输入弹窗仍受旧蓝色和小圆角覆盖：补齐 --ry-* 映射及限定的重要性覆盖，保留正确的禁用/危险状态。
- 学生绿色/护眼侧栏悬停与底色相同：统一两组 hover，并区分白色与薄荷背景。
- 同页关闭抽屉后焦点留在屏外：统一有归属判断的焦点恢复，保护关闭到渲染之间的外部焦点变化及重新打开，不向 CSS 隐藏/禁用的菜单按钮回焦点。新增七项真实 Vue 回归覆盖这些边界。

全站初次实施时的 21/158 和初审后的 209 是中间阶段计数，以上采用最新整合结果。导航焦点增量已整合为 `c6b94f9`。最终独立代码复核已通过，当前审查范围没有剩余 P0/P1/P2；独立重跑共享套件 60/60 与既有路由/学生 21/21。该结论只覆盖代码与定向回归，不替代下述浏览器验收。

## 验证边界与未完成项

**真实浏览器视觉验收仍阻塞。** 此电脑的 Playwright/Chromium 在应用载入前创建 socket 失败（Operation not permitted）。没有本轮真实运行截图，不声称宽窄屏、200% 缩放、实际菜单或 MathLive 虚拟键盘已通过，也未更改或绕过安全限制。

- `npm run test:senyu:browser` 已纳入共享控件、三页、真实后台外壳、实际 BankQuiz、学生导航和 MathLive 的合成前端测试。既有浏览器夹具已加载本次主题，不是继续检查旧颜色。
- 仍需在独立获准环境逐项截图检查：1440/1024/390px、200% 缩放、默认/展开/激活/禁用/等待/空/错误、长题干/长表单、公式分类键与手机底行、选择/日期菜单、双树、报告/导出/组卷、三页 iframe 和导航焦点。
- DOM/CSS 测试不证明真实几何、默认 Tab 顺序、字体、Shadow DOM 键盘、音视频播放或下载文档排版。原生可定制 select 的跨浏览器兼容性仍待实测。
- 未执行完整 CI、真实 MySQL/API 端到端或远端 Actions。已按交付要求整合仅含测试修正的 `51ca3b` 为 `aefd427`，不改变生产逻辑；这不代表其余完整 CI 已通过。不能把定向通过写作全站验收完成。

## CI 接入与交付

现有 CI 测试桩补齐隔离的 `process.env={}` 后，原14项只读CLI断言全部通过。错题样式契约改为真实 `round-mist-heading` 与已加载的圆角样式，第6节无网络/数据库静态代码块2/2通过，未运行会建数据的完整 `mistake-test.js`。两处测试修改经独立复核，原业务断言保留。

CI unit job现在在 `npm ci` 后、浏览器安装前执行 `npm run test:senyu:unit`。新UI60项独立通过，工作流YAML/顺序与安全隔离检查通过；锁定jsdom26.1.0支持Node>=18，兼容CI既有Node20要求，锁文件script-free dry-run通过。本机实际定向运行使用Node24；远端Node20运行结果以对应CI记录为准。

仓库交付使用已有GitHub连接，在 `imlotso/zhilexue` 的独立分支提交完整内容快照。该接口不能保留本地作者时间和提交SHA，因此远端为新的整合提交，本地逐步历史保留；发布前后核对完整Git tree相等，不传输未修改的配置/凭据文件。该交付不代表浏览器已验收或允许合并main。
