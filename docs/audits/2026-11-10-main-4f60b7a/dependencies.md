# 依赖公告与性能说明

基于实际main的package-lock，本轮已获明确授权，将依赖清单发送给registry.npmjs.org并完成npm audit --omit=dev --json。共4项：3高、1中、0严重。npm因命中漏洞退出1，不是扫描失败。没有执行利用、自动修复或升级。

## npm生产依赖公告匹配（2026-11-10）

来源为本轮已授权、对实际main的package-lock运行 npm audit --omit=dev --json 的结果。共4个依赖项，3 high、1 moderate、0 critical；未执行利用，不推断所有公告在本项目都可达。

- body-parser 1.20.8：高，压缩请求尾部数据可能导致未捕获异常/拒绝服务，修复范围1.20.9及以后。公告 https://github.com/advisories/GHSA-27r3-jxmh-p828 。src/app.js:28 在鉴权前启用 express.json（5MB限制），应优先确认升级和压缩解码边界；5MB限制不自动证明公告已被挡住。
- ws 8.17.1：高（另含中等公告），碎片/数据块导致内存耗尽，及未初始化内存披露。公告 https://github.com/advisories/GHSA-96hv-2xvq-fx4p 和 https://github.com/advisories/GHSA-58qx-3vcg-4xpx 。本项目src/win-speak.js:310–318是TTS的出站WebSocket客户端，不能直接描述成公网WebSocket服务器漏洞；仍应升级受支持修复版本并回归TTS。
- xlsx 0.18.5：高，原型污染与正则拒绝服务。公告 https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 和 https://github.com/advisories/GHSA-5pgg-2g8v-p4x9 。存在实际Excel导入业务。npm audit显示无自动修复，不应盲跑audit fix --force；应确认SheetJS官方受支持发行方式、许可证与解析兼容，再升级或替换。
- qs 6.16.0：中，特定comma stringify与自有toString输入可抛异常。公告 https://github.com/advisories/GHSA-6pq8-jhm2-2vcw 。尚未证明该特定stringify路径接收本项目外部输入，应保持公告匹配标签，不夸大成已证业务漏洞。

没有执行依赖升级或audit fix。


性能：待审allItems全历史JSON聚合与mysql-sync同步Atomics.wait应先测量再优化。未运行压测，未测线上并发能力。
