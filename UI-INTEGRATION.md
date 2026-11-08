# 智乐学新 UI 开发交付与集成

## 源码身份

- 权威 Ubuntu 候选提交：`17840bc012d52016508207717db2e4e01f5e5574`
- 权威完整树：`03fedc3b5660ccfbf6fce8de8fcd91f7810450c4`
- 本地开发基线：`464bb93`，由 450 个已核验安全文件建立；445 个与完整树一致，其余 5 个为历史文档处理差异。
- 分支：`feat/ui-concepts-20261108`。这是隔离开发分支，不是运行站分支。

## 使用增量，不覆盖完整源码

交付包含增量补丁、测试源码、截图和 QA 报告。先在权威完整仓库的另一个开发分支核对已修改生产文件的基线哈希，再运行 `git apply --check`，最后应用补丁。不要将安全快照整个目录复制到运行站；不要删除完整树中未出现在快照里的配置、文件或历史文档。

生产改动限于学生页面 HTML/JS、后台页面 HTML/JS、三个新增样式文件和两个图形资源。没有服务端、数据库、锁文件或依赖版本变更。package.json 仅添加开发预览和测试命令。

## 本地验证

使用项目既有依赖和官方 Chromium：

1. `npm run test:takeover`
2. `npm run test:ui-concepts:unit`
3. `npm run test:ui-concepts:browser`
4. `node --check public/js/vue-app.js`、`node --check public/js/bank.js`、`node --check public/admin/pendingui.js`、`node --check public/admin/admin.js`
5. `git diff --check`

浏览器测试启动临时静态服务和合成 API，不启动应用服务或连接数据库。Chromium 路径可通过各测试支持的环境变量调整。受限 shell 若不支持浏览器套接字，需要在允许浏览器测试的本机开发终端运行，不可把启动失败当作测试通过。

## 下一阶段

在完整权威仓库中应用并验证增量后，用隔离测试库进行真实登录、任务、课程、组卷、后台审核及所有题型的集成验收。用户确认之后再走现有部署流程。本次没有进行部署、在线 AI 调用、线上数据变更、远程推送或自动合并。
