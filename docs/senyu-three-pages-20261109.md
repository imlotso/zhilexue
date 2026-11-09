# 智乐学三页森屿 UI 交接

## 范围与基线

- 原业务基线：`2c4adba46e0fe4d0ca85a2a406c3b32d313c66fc`。
- 范围：成绩管理的总览、成绩列表、历次追踪、学生档案，以及谈心谈话、家校沟通和相关表单/详情。
- 两个子应用自行加载共享 tokens、components、controls，局部样式分别为 `public/apps/grades/assets/css/senyu-grades.css`、`public/apps/care/assets/css/senyu-care.css`。不依赖父 iframe 注入主题。
- 依赖共享组件提交 `6222085` 与共享日期生命周期修复 `784ddea`。本工作树对应 cherry-pick 为 `9cf031a`、`40c3e74`，集成时不要重复合入。
- 没有更改后端接口、权限、数据库、计分、存储格式、导出字段或业务路由。没有部署。

## 本批实现

- 暖白画布、森林绿主状态、琥珀新增动作、薄荷表头，统一字级、卡片圆角、44px 主控件与响应式筛选。表格宽度由内部滚动容器承接，长表单内部滚动。
- 谈话与沟通将已有新增按钮移到页标题行；原 ID、监听和原脚本顺序保持。区分真正无记录与筛选无结果。
- 两页学生搜索和联系人选择支持上下键、Enter、Escape、Tab 与可访问标签，原学生/联系人联动继续使用现有值。
- 新增表单的必填错误与字段关联；上传提供等待、失败可重试及成功状态。上传未结束时暂缓保存，避免丢失附件；失败后仍按原规则允许不带录音保存，填写内容保留。
- care 通用弹窗支持标题关联、焦点约束及返回，异步保存期间禁止重复提交，失败保留草稿。现行同步保存、取消和录音播放清理逻辑保留。
- 成绩页保留筛选、10/20/30 分页、排序、行详情/编辑、全部四子路由和学生档案。补齐可见标签关联、分页当前项、可键盘点击的排序/展开按钮、页签方向键与焦点恢复。
- 成绩图表仅修改颜色与字号，不改数据计算、曲线、坐标或对比范围。
- 共享日历在两个实际弹窗内完成集成回归，处理 Tab、Escape 以及父弹窗关闭后的清理。

care 现有业务仅有新增、查看、删除和记录内跟进字段，不存在独立的编辑或跟进工作流；本批未虚构这些功能。

## 已执行验证

Node `v24.22.1`，隔离测试依赖 `jsdom@26.1.0`。项目 package/lock 未改变。

```sh
NODE_PATH=/workspace/shared/zhilexue-senyu-test-deps/node_modules \
node --test senyu-three-pages-dom-test.js senyu-controls-test.js \
  astra-care-store-test.js astra-care-audio-ui-test.js ui-rounded-admin-pages-test.js
```

结果：定向 50 项与旧后台 UI 契约 6 项，共 56 项通过、0 失败，包括：

- 原 care 存储、账号隔离、受保护录音和保存失败保留草稿回归 27 项。
- 共享日期控件 8 项。
- 三页真实 HTML/脚本 DOM 回归 15 项。使用合成账号/花名册与隔离 localStorage，覆盖新增记录、学生/联系人联动、必填校验、筛选/重置、导出数据处理、持久化快照、详情/编辑入口、异步失败重试、分页、路由、焦点及日期集成。未捕获未处理的 DOM 事件异常。另含中文输入法 Escape 保留草稿、禁用首字段焦点和窄屏保留打印入口的回归。
- 旧后台 UI 契约 6 项。

另已通过：修改 JS 的 `node --check`；局部 CSS 的 CSSOM 语法解析与共享 token 引用检查；两个 HTML 的原业务 ID 和原 script 顺序核对；`git -c core.whitespace=cr-at-eol diff --check`。CRLF 文件保持原行尾。

独立代码审查已复核两处 P2 修正（输入法 Escape 与窄屏打印入口）及初次焦点边界，未发现阻止本批提交的 P0/P1/P2。

`astra-care-audio-ui-test.js` 仅给最后一项手写 DOM 夹具补齐新可访问逻辑所需的方法，原断言未减少；这些交互另有真实 DOM 测试。

## 未完成的验证

- `senyu-three-pages-browser-test.js` 已准备真实静态前端、合成 API、导出下载和截图流程，外部网络全部拦截。不启动生产后端，不连接真实数据库。
- 本环境 Chromium 在创建进程 socket 时失败，浏览器未启动，因此本批没有真实运行截图，不能声称视觉验收、浏览器全流程或 1440/1024/390px 几何布局已通过。
- DOM 测试不渲染 Chart.js canvas，不证明图表视觉、打印/图片/PDF 文件的最终排版，也不代替完整 CI 或后端端到端测试。
- 原生下拉的统一展开面板依赖浏览器支持 `appearance: base-select`。不支持时保留系统原生菜单，跨浏览器菜单外观仍待验收。
- 待允许浏览器运行的环境补跑：两个 iframe 与后台导航集成、返回/前进、校区切换、真实文件导入导出、上传失败后重试、200% 缩放、默认/展开/焦点/禁用/空态/错误态截图。

浏览器验收命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium SENYU_EVIDENCE_DIR=/tmp/senyu-ui-evidence \
node --test senyu-three-pages-browser-test.js
```
