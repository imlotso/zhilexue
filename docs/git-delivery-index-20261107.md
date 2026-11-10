# 智乐学本地 Git 交付索引（2026-11-07，安全修订）

## 当前安全修订

本次在已验收的开发成果上升级 Multer 至 2.5.0，并加入 multipart 深度、数组索引与票据边界回归。当前安全源码清单为 450 个文件，完整 Git 树为 755 个文件；两者范围不同。安全源码清单没有替代原完整仓库，未列原路径、凭据配置、客户原资料和五份完整原文档继续保留。

- [Multer 安全修订、验证范围与安装说明](multer-security-20261107.md)
- 冻结安全增量包 SHA256：`8dc2972055c5bae685cc262afb7b2bc306ef33d967ce526657e6c638dbc7dcab`。
- 450 文件安全源码清单 SHA256：`8ddd38afc66d8d65bcfc709d191997e2a7094c4609ad165c5c15e2223b54635f`。
- 业务源码、测试、依赖清单与新安全文档共 14 个冻结路径，本交付索引是额外的第 15 个纯文档变更。

官方 npm 源独立安装后的云端 Node 24 重点检查为 40/40，聚合 node:test 为 749/749；这些是安全修订候选的结果，不等于 Ubuntu Node 22、完整部署或新远端提交的 CI 结果。相应环境验证按后续实际验收记录为准。

## 两条本地应用路线

- A：在真实本地提交 `3f84058e842aa813e1c056885c18091fae3bf7c3`、完整树 `2784c402a033f13d24ad65fd1f5cc1128ee5c700` 上应用 15 路径安全修订。
- B：在原始 `0358baa7eb7cf093dd3d38f512eca44af623bc67`、完整树 `fe6892abbff45c7b6f28f5615bd665d83f604ee2` 上一次应用累计成果。
- 两条路线的最终完整树必须一致，最终为 755 文件，0 删除。每条路线以随包清单的精确 HEAD、before/after blob、模式和完整树 SHA 为门禁。
- 不能把 B 累计包再次应用到已提交 3f84058 的仓库，也不能把 A 增量用于 0358baa。工具不放松基线，不重写 main，不创建 tag，不自动推送。

## 上一阶段的历史记录

448 文件候选对应的完整树是 753 文件，已在 Ubuntu 独立候选中生成本地提交 `3f84058e842aa813e1c056885c18091fae3bf7c3`，父提交为 0358baa。该阶段源码包 SHA256 为 `9589436d231d6b657c476e1b9e79b1f50987722c03648e97b83b758beae15f30`。448/753 的统计仅指上一阶段，不代表本安全修订的最新范围。

## 既有开发文档

- [架构增补](development-architecture-addendum-20261107.md)
- [开发记录增补](development-changelog-addendum-20261107.md)
- [私有录音 API 增补](care-audio-api-addendum-20261107.md)
- [私有录音数据库增补](care-audio-database-addendum-20261107.md)
- [私有录音关键取舍增补](care-audio-decisions-addendum-20261107.md)
- [私有录音部署和回滚边界](care-audio-security-20261107.md)
- [50 MiB 上传边界修复](issue-005-audio-size-boundary-20261107.md)

原 `docs/api.md`、`database.md`、`decisions.md`、`architecture.md` 和 `changelog-20261107.md` 完整保留。上述增补和本次安全文档记录后来变化，不覆盖原全文。

## 提交与部署边界

此流程只形成经校验的本地提交，没有新远端 commit 或远端 CI 通过结论。曾创建的未引用 blob 不是提交，也没有移动远端分支。后续远端提交由用户自行执行。

依赖安装使用包外层提供的官方安装 helper，在独立空安装目录映射下载地址并保留锁定版本及 integrity；不得改写源码仓库的 package/lock 来迎合安装，也不能把云端 Node 24 原生模块直接用于 Ubuntu Node 22。应用工具不启动服务、不迁移业务数据；私有录音历史归属仍须独立审核。
