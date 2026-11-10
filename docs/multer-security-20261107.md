# Multer 安全升级增补（2026-11-07）

## 范围与结论

此增量以 Ubuntu 完整本地提交 `3f84058e842aa813e1c056885c18091fae3bf7c3` 为部署基线；云端对照为冻结的 448 文件源码集合。未修改五份既有完整历史文档，未推送远端 Git，未访问真实数据库或向真实站点发送异常请求。

项目原要求 `^1.4.5-lts.1`，锁定安装 `1.4.5-lts.2`，落入多项官方安全公告的受影响范围。此次精确锁定 **2.5.0**，并启用默认未开启的字段深度和数组索引防护。结论是依赖版本受影响、项目存在可触达解析入口，不能据此声称真实部署已被利用、遭到攻击或所有风险已消除。

2026-11-07 读取[官方 registry](https://registry.npmjs.org/multer)与[官方 v2.5.0 release](https://github.com/expressjs/multer/releases/tag/v2.5.0)：稳定 latest 为 2.5.0，发布于 2026-10-22；next 为 3.0.0-alpha.2，本次不采用预发布。包要求 Node >=10.16.0；这是兼容下限，不是使用停止维护的 Node 版本的建议。部署目标继续使用既有 Node 22。

## 官方依据与适用边界

下表“修复版本”是该公告的最早修复版本，不是本项目的建议安装版本。链接均为 Express/Multer 官方仓库公告。

| 公告 | 受影响版本 | 主要问题 | 最早修复 |
|---|---|---|---|
| [44fp-w29j-9vj5](https://github.com/expressjs/multer/security/advisories/GHSA-44fp-w29j-9vj5) | <2.0.0 | 请求流错误后资源未清理 | 2.0.0 |
| [4pg4-qvpc-4q3h](https://github.com/expressjs/multer/security/advisories/GHSA-4pg4-qvpc-4q3h) | >=1.4.4-lts.1,<2.0.0 | 畸形 multipart 未捕获异常 | 2.0.0 |
| [g5hg-p3ph-g8qg](https://github.com/expressjs/multer/security/advisories/GHSA-g5hg-p3ph-g8qg) | >=1.4.4-lts.1,<2.0.1 | 空字段名引起异常 | 2.0.1 |
| [fjgf-rc76-4x9p](https://github.com/expressjs/multer/security/advisories/GHSA-fjgf-rc76-4x9p) | >=1.4.4-lts.1,<2.0.2 | 畸形请求引起异常 | 2.0.2 |
| [v52c-386h-88mc](https://github.com/expressjs/multer/security/advisories/GHSA-v52c-386h-88mc) | <2.1.0 | 中断连接资源耗尽 | 2.1.0 |
| [xf7r-hgr6-v32p](https://github.com/expressjs/multer/security/advisories/GHSA-xf7r-hgr6-v32p) | <2.1.0 | 错误请求清理不完整 | 2.1.0 |
| [5528-5vmv-3xc2](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2) | <2.1.1 | 无控制递归 DoS | 2.1.1 |
| [72gw-mp4g-v24j](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j) | >=1.0.0,<2.2.0；另含3.x早期alpha | 深字段名 CPU/内存消耗 | 2.2.0，需配置 fieldNestingDepth |
| [wc9g-mqfw-jrwm](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm) | <2.3.0 | 文本字段名未捕获 RangeError | 2.3.0 |
| [535w-7cp7-47q4](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4) | <2.3.0 | 过大数组索引 CPU 耗尽 | 2.3.0，需配置 fieldArrayIndexLimit |

选择当前稳定版本而非早期2.x还避免中间版本的磁盘清理缺陷：[3p4h-7m6x-2hcm](https://github.com/expressjs/multer/security/advisories/GHSA-3p4h-7m6x-2hcm)在2.2.0修复初始问题；[qfvm-cv95-jqjf](https://github.com/expressjs/multer/security/advisories/GHSA-qfvm-cv95-jqjf)仅影响2.2.0、2.3.0修复；[3pph-fpjx-jg34](https://github.com/expressjs/multer/security/advisories/GHSA-3pph-fpjx-jg34)影响>=2.2.0,<2.4.0，2.4.0修复。

[2.5.0异步fileFilter清理竞态](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m)影响>=2.0.0,<2.5.0；[异步filter超限漏报](https://github.com/expressjs/multer/security/advisories/GHSA-qvfw-j98x-7q72)影响<2.3.0。当前项目未设置自定义fileFilter，不把这两种要求异步filter的路径描述为已在本项目证实可利用。

## 实际入口和最小改动

- `src/app.js` 普通管理端/学生端上传在既有auth之后；`src/bank.js`的`/api/up/submit`在upAuth之后。认证降低匿名触达面，但不等于解析器不需要修复。
- `src/report.js`原`/api/report-scan`先执行`upload.array('images',6)`，在业务处理器内才校验query.token。因此没有有效token也能进入解析器。本次把同一票据检查加到解析器之前；失败消息和JSON结构不变，保留处理器内原校验，长上传跨过有效期仍拒绝。没有重构票据、角色、有效期或授权策略。
- 9个模块共14个Multer实例全部增加`fieldNestingDepth:4`、`fieldArrayIndexLimit:100`，memoryStorage及视频diskStorage都覆盖。[官方2.5.0 README](https://github.com/expressjs/multer/blob/v2.5.0/README.md#limits)与安装包源码确认两者默认Infinity，单换版本不会启用。
- 受控扫描现有前端FormData、动态scope键及HTML字段名，未见上传业务依赖深层嵌套或大索引。选择有限的4层/100索引保留浅层兼容，不禁止普通字段、重复文件键或JSON字符串字段。
- 现有每文件大小、single/array字段名与数量不变：如视频30文件、错题图片60文件、录题页图30文件。此次没有统一降低业务批量大小。
- care仍保留`MAX_SIZE+1`解析余量；2.5.0内部已把busboy阈值转换为包含式上限，因此超出50MiB的一字节可进入原业务mediaType校验，但仍被`bytes.length>MAX_SIZE`拒绝，不会落元数据或私有文件。精确50MiB仍成功。
- 业务源码没有存储引擎替换、上传路径调整、真实数据改写或其他依赖版本升级。

## package-lock 精确变化

- 根依赖与`node_modules/multer`改为精确2.5.0。新包tarball是`https://registry.npmjs.org/multer/-/multer-2.5.0.tgz`。
- SHA-512 integrity：`sha512-BsqOzYGVq49JcW2IzoSAxeKYRevb+dGGPPWleOR8Lrlk4igwxu1/9pwSXlByhCb7MVZDrNJFC0IBP5/O5nLYRw==`。
- 不再需要的`concat-stream@1.6.2`、`buffer-from@1.1.2`、`typedarray@0.0.6`移除。
- `mkdirp@0.5.6`、`object-assign@4.1.1`、`xtend@4.0.2`仍被其他可选依赖使用，仅恢复`optional:true`分类，版本/下载URL/integrity不变。
- 其余依赖版本完全不变；未运行npm audit fix。

## 验证与复现

新增`npm run test:multer`并接入`test:takeover`。所有异常样本都在127.0.0.1、临时目录和合成数据内运行；没有外部攻击测试。

1. 红测先运行旧锁版本与旧生产配置：版本门禁、14个实例的有限值、低强度超界字段拒绝、无效report-scan票据的预解析拒绝均失败。样本只有5层/索引101，不使用资源耗尽载荷。
2. focused：`node --test astra-multer-security-test.js astra-care-audio-security-test.js`，40/40通过。其中新增Multer24项、care既有16项。
3. 覆盖真实Express/Multer memory/disk×single/array：合法字段/文件、浅嵌套、超数量、错字段、超尺寸、缺boundary、截断、中断连接、失败后后续正常请求；失败磁盘上传无临时文件残留。
4. 14处配置均有门禁，13个memory实例逐一实际检查深度/索引拒绝，disk实例通过HTTP矩阵检查。真实生产错误处理器仍为Multer限制返回JSON业务错误，畸形multipart返回无堆栈的通用500。
5. report-scan使用真实路由与Multer、替换数据库/存储/AI边界，验证缺失/无效/过期票据零解析、有效票据成功、上传中票据过期零保存。
6. 视频30、错题图片60、录题页图30的声明最大批量接受，+1拒绝；care精确50MiB接受，+1拒绝，数据库仅保留合法记录且私有目录无多余文件。
7. 完整`npm run test:takeover`：退出0，node:test合计749通过、0失败、0跳过；额外既有源码/内存脚本通过。既有脚本明确标记浏览器几何NOT RUN，本轮没有重复浏览器/真实服务验收。
8. 所有改动JS通过`node --check`。云机验证使用Node24.22.1/npm11.9.0；Ubuntu部署仍需Node22实际验证并本地提交。

### 安装来源说明

交付lock保留未升级依赖的原npmmirror下载地址，以避免无关锁文件改动。仅设置npm registry不会覆盖这些显式resolved地址。早期隔离测试曾沿用原lock，不能称全依赖为官方来源。

最终测试改为独立安装用目录：复制package/lock，将202条`https://registry.npmmirror.com/`下载前缀映射为`https://registry.npmjs.org/`，保持所有包的版本与integrity不变；使用全新cache执行`npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`，再在该隔离目录从源编译better-sqlite3。映射后的lock不覆盖交付lock。安装HTTP日志、映射校验证据与可复现脚本随增量交付。此前因ignore-scripts缺少native binding的全聚合失败是环境准备失败，未作为通过记录。

## 剩余边界

本次没有运行真实MySQL、生产启动、真实OSS/AI/TTS或浏览器几何，也没有做持续压力/内存泄漏定量测试。小型畸形/中断夹具验证清理和存活，不宣称覆盖全部CVE利用变体。仍应使用既有网关请求体/超时/并发等运维控制；有限嵌套和索引不构成任意大规模上传的完整资源配额方案。

应用时必须先核对增量manifest的每个before SHA，保留用户配置和真实数据，在独立部署候选安装锁定依赖并执行上述测试后本地提交。不要直接将含已知风险的1.x恢复到对外上传入口作为常规回滚；需要暂停服务时先停用新候选并按既有发布流程处理，不放开匿名上传或私有音频访问。
