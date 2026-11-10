# Ubuntu 审核代码交付与隔离验收

本次应用代码对应 Ubuntu 运行版本 `5c2abe1ae5beb784872b821df26c3334383f2e86`。此前项目历史已存在私密配置和原始资料，不要打包完整历史或将完整旧检出目录复制到验收机。

当前交付以旧版 `main` 为基底整理为一个代码快照：历史账号标识已从本次新增或修改的测试和文档中移除，测试截图和生成的结果文件未收录；后台分校账号输入框的一处手机号示例改为合成号码，其余应用源码与上述 Ubuntu 运行版本一致。较早的共享 Git 历史及其已存在的私密配置不因这次快照而清除，请勿将完整历史或配置文件用于跨机传递。CI 使用隔离数据库内的专用合成测试管理员，不影响正式账号。

已知限制：普通不等式在部分入库路径中可能被误删；采集题清空中间选项后可能发生选项和答案错位。这两个问题尚未修复，审计及修复应在独立分支进行。此前交付分支的 GitHub Actions API 作业中 `r0-test.js` 失败；本快照包含该测试的独立账号与断言修正，新的 CI 结果仍须单独核实。

## 安全边界

- 只使用新建的本机隔离 MySQL 库和合成题；不要连接已有用户库、上传目录或云存储。
- Git 历史增量包以 `d25d9db2a2c02caa7a956fb94dc89d24ebe5b331` 为前置对象，包本身不含前置历史的配置、数据库、上传文件或依赖目录。接收方必须已有该前置对象；不应为了获取它复制包含私密文件的旧工作目录。
- 旧仓库历史中的配置和资料仍可能存在；不要把完整历史当作无敏感内容的公开制品。独立代码快照应另行过滤敏感文件和依赖，并使用本机新配置。
- 如需建立持久账号或凭据，先取得用户对具体操作的确认。不要把密钥写入代码、日志或提交。

## 独立测试环境

1. 安装 Node.js 20 或以上、MySQL 8.4、Chromium；在隔离代码目录执行 `npm ci`。浏览器依赖可用 `npx playwright install chromium`，或将 `CHROMIUM_PATH` 指向已安装的 Chromium。
2. 创建只供测试使用的本机 MySQL 数据库和临时账号；明确设置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。使用名称中包含 `_test` 的独立库。
3. 设置 `STORAGE_DRIVER=local`、`AI_MOCK=1`、`TTS_MOCK=1`、`ZLX_ISOLATED_TEST=1`，关闭 `RESTORED_DB_MODE`。这些设置仅用于合成数据的确定性回归，不能代表真实模型验证。
4. 运行 `node pending-ai-bulk-review-test.js`，再运行 `node review-flow-browser-test.js` 和 `node pending-expanded-layout-browser-test.js`。截图写入系统临时目录，可用 `ZLX_TEST_ARTIFACT_DIR` 指定其他隔离目录。
5. 若要验证真实模型，使用用户明确授权的测试配置和合成题，确认 `AI_MOCK` 未启用；不要传输真实题目或个人数据。模型配置和密钥由验收环境自行提供，不随代码传递。

`pending-test.js` 和 `ai-answer-review-test.js` 会写测试库。它们只允许显式隔离模式，并在运行期间生成临时测试账号；切勿对真实数据库运行。前者还需要单独准备不含真实个人数据的 Word/Excel 样本。旧版 `npm run seed` 会修改数据库账号，不应指向任何现有用户库。
