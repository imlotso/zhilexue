# 待人工事项

只有 BOBO 能处理的事。agent 遇到后追加在表格末尾，BOBO 处理后改状态。

| 事项 | 原因 | 状态 |
|---|---|---|
| 手机真机测试视频：iOS Safari、Android Chrome、微信内置浏览器各点一次，把现象告诉 agent | T1 的 D5 步骤云环境无法模拟 | 待处理 |
| 提供真实库只读连接信息（或确认只用测试数据） | 核对视频格式分布、数据迁移预演 | 待处理 |
| 与客户确认知识树首批范围（学科、年级、版本） | T4 初始数据；未确认前只生成数学一个年级作演示 | 待处理 |
| 提供听力音频、真题试卷等素材 | T7、T10 验证 | 待处理 |
| 提供可用的 AI 接口地址与密钥（可选） | T2 真实联调；没有则用 mock 验证请求格式 | 待处理 |
| 手动打标签 | agent 不创建标签 | 待处理 |
| 按 `docs/release-steps.md` 发布到服务器 | agent 不直接操作生产服务器和生产库 | 待处理 |
| 与客户约定 11/03、11/05 阶段演示和 11/07 终验 | 对客户的开发期间约定 | 待处理 |
| 检查生产 OSS 桶 `xuexiku` 的 `videos/` 下是否残留 CI 测试对象（标题含"自测"、文件名随机）并按需清理；评估是否轮换 `builtin-config.js` 里的 OSS / AI 密钥 | 在本次修复前，CI 每次跑 smoke 都会往生产桶写测试文件；report-test 也会用内置 AI Key 发真实请求。仓库私有、密钥按约定保留，是否轮换由你决定 | 待处理 |
| 确认"使用说明"（`guides`）模块是否清理时有意移除 | 仓库里 `guides` 表还在、前端有 `/guides` 路由标题，但 `/api/admin/guides` 等接口不存在，`guide-test.js` 无法通过；若线上仍在用，需要补回源码 | 待处理 |
| 确认生产库短语书导入是否已不能用（可只读核对 `word_phrases` 近期写入） | 短语 CSV 导入 INSERT 参数个数不一致，已在 `src/word.js` 修复；想知道线上受影响时间 | 待处理 |
| **T1 真机验证视频播放**：在 iOS Safari、Android Chrome、微信内置浏览器各点一次播放，把现象（能否播放、是否出现"点击视频开始播放"、倍速/全屏是否正常）和系统/浏览器版本告诉 agent。用例：① 一个 H.264+AAC+faststart 的 MP4 应能播放；② 一个 H.265 的 MP4 应出现"只有声音、没有可显示的画面…"提示而不是黑屏转圈。样本可用 `ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=25:duration=6 -f lavfi -i sine=duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart ok.mp4`（H.265 把 `-c:v libx264` 换成 `-c:v libx265 -tag:v hvc1`）；测试账号用测试库种子 `13800000001 / 123456`，测线上请用一个测试学生 | T1 的 D5：云环境没有真机。注意 iOS Safari 原生支持 H.265，所以 H.265 样本在 iPhone 上可能能正常播放，这是预期；重点看 Android Chrome 和微信 | 待处理 |
| **T1 核对真实库视频编码与 faststart**：提供真实库只读连接（或导出 `SELECT id,title,file_path,url FROM videos;`），agent 取 5～10 个代表视频跑 `scripts/check-video.sh`，把命中清单写进 changelog，由你决定是否让客户重传 | T1 的 D1/D2：云环境没有真实视频文件 | 待处理 |
| **T1 检查生产 OSS / CDN 响应头**：取一个学生的播放链接（`/api/stu/videos/:id/play` 返回的 `src`），执行 `curl -sI -H "Range: bytes=0-1" "<src>"`，应为 `206`、`Accept-Ranges: bytes`、`Content-Type: video/mp4`、无 `Content-Disposition: attachment`；若生产配了 `CDN_DOMAIN`，再对比 `curl -sI -H "Referer: " "<cdn 链接>"` 与带站点 Referer 的状态码（无 Referer 返回 403 即命中防盗链问题） | T1 的 D3/D4：云环境访问不到生产 OSS / CDN。本地存储模式已验证：206 + Accept-Ranges + video/mp4 | 待处理 |
