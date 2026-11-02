# 决策记录

每条：日期、决定、理由。新决策追加在最后。

## D1 知识树统一（2026-11-02）

- 决定：以 `bank_trees` / `bank_tree_nodes`（`mfbank.js`）为唯一编辑源。`kind=textbook` 对应客户说的「章节树」，`kind=knowledge` 对应「知识点树」，不需要新增 kind 列。`kb_units` / `kb_points` 保留表和旧接口，只一次性复制，之后 UI 指向 `bank_trees`。
- 理由：`bank_trees` 已支持无限层级和增删改，且题目可同时挂教材节点和知识点；两套并存是客户觉得乱的原因之一。

## D2 AI 配置中心（2026-11-02）

- 决定：以 `mfcollect.js` 的 profiles 为准，`ai.js` 读取当前启用的 profile；新增 `src/ai-client.js` 适配 OpenAI 兼容、Anthropic Messages、Google Gemini 三种格式；不绑定具体厂商，密钥明文存储与现状一致。
- 理由：现有两套配置并存，profiles 已有多配置、测试连接、启用；客户只要求能配置密钥和接口。

## D3 题库与视频只做逻辑解耦（2026-11-02）

- 决定：题目的图片、音频使用存储前缀 `bank/`，视频仍用 `videos/`；题目与视频只通过绑定关系关联；不拆独立数据库，多桶切换留到二期。
- 理由：视频本来就在对象存储；7 天内拆库会带来跨库查询、迁移和事务风险。

## D4 待审核题目不新建表（2026-11-02）

- 决定：以 `paper_uploads`（pending/reviewed/approved/rejected）、`mf_capture_batches`、`mf_recog_runs` 草稿为数据源，用 `ext/review-list`、`ext/badge-counts` 聚合成统一入口，给每条加来源标签。
- 理由：各入口已有暂存和提交流程，缺的是统一入口和来源标注。

## D5 不爬取第三方知识树（2026-11-02）

- 决定：初始知识树用现有 `/kbtree/generate` AI 生成，客户可编辑；不爬取洋葱、组卷网、21 教育网。
- 理由：版权与合规风险，且 7 天内做不完。

## D6 私有仓库保留凭据（2026-11-02）

- 决定：`config.local.js`、`builtin-config.js` 和文档中的账号密码按现状保留并提交。
- 理由：仓库私有，BOBO 明确要求保留。

## D7 开发在云环境，真实库只读（2026-11-02）

- 决定：开发与验证在云开发环境完成；真实库只读核对，写入类验证在测试库做。
- 理由：不依赖本地电脑；避免误改线上数据。

## D8 后台 UI 只加主题层（2026-11-02）

- 决定：新增 `public/admin/theme.css` 统一变量与组件样式，调整菜单分组，不重写业务脚本。
- 理由：后台由多个独立脚本拼成，7 天内重写不现实；客户要的是视觉统一。

## D9 测试文件留在根目录（2026-11-02）

- 决定：`*-test.js`、`smoke.js`、`seed-words.js` 不移动。
- 理由：它们依赖根目录相对路径，移动要改多个文件，收益很小。

## D10 CI 里服务进程固定用本地存储（2026-11-02）

- 决定：`.github/workflows/ci.yml` 的 "Start server" 步骤设 `STORAGE_DRIVER=local`。
- 理由：`src/storage.js` 默认驱动是 `oss`，且 `builtin-config.js` 内置线上桶密钥，不设置的话 CI 里 smoke / word-test 的上传用例会写生产 OSS；同时 smoke 中"播放地址自带登录票据""在线预览走 inline 头"等用例本来就按本地存储的 `/api/file?token=…` 编写。
- 影响：CI 不再覆盖 OSS 驱动的真实上传；OSS / 七牛逻辑仍由 `storage-test.js`（用假密钥、不联网）覆盖。

## D11 smoke 的部署包检查在仓库缺文件时跳过（2026-11-02）

- 决定：`smoke.js` 部署物料自检中，依赖 `../deploy/`、`*.bat`、收尾清单的 28 项在 `../deploy/` 不存在时汇总成一行"跳过"；仓库自身可检查的 6 项改读仓库根并照常断言。
- 理由：这些文件只在服务器部署包里，不在本仓库（`docs/cleanup-list.md`）；按任务书要求"不存在则跳过"，但不删除任何用例，原布局下行为不变。

## D12 AI 演示模式用环境变量 AI_MOCK=1 开启（2026-11-02）

- 决定：`src/ai.js` 的 `getConfig().mock` 读取 `process.env.AI_MOCK === '1'`，默认 false；CI 的服务进程设 `AI_MOCK=1`。
- 理由：`ai.js` 把 mock 写死 false 后，`word-test` 的"演示模式"用例实际调真实 AI（内置 Key），CI 连不上、本地产生费用。用环境变量而不是恢复后台设置项，是为了不与"AI 配置只读 builtin-config.js"的现状冲突，T2 统一 AI 配置时可再调整。
- 影响：线上不设该变量，行为不变。
