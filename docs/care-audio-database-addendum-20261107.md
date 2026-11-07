# 数据库增补：care_audio

本文件补充[完整数据库清单](database.md)，仅列本轮私有录音新增结构。运行时仍使用 MySQL，经既有 SQLite 方言转换层建表。

`src/db.js` 调用 `runSchema(require('./care-audio').SCHEMA)` 幂等新增 `care_audio`，不修改或删除旧表/旧记录：

- `id`：随机 128-bit 十六进制主键，不是原文件名。
- `owner_id`、`owner_role`：服务端已验证的所属账号与角色。
- `branch_id`：明确所属分校账号 id，可为 NULL。新 branch 上传固定为自身；新 admin 上传为空。
- `storage_name`：唯一私有存储文件名；`mime_type`、`size`、`sha256`：文件类型、大小与校验值。
- `legacy_name`：唯一历史生成文件名，未迁移的新上传为 NULL；仅作已审定映射索引，不作为归属证据。
- `status`：仅 active 允许读取；其他状态保留字节但禁止读取。
- `review_ref`：历史映射审核记录编号，新上传为空；`created_at`：创建时间。

私有字节位于 `data/private-care-audio`，不能通过通用 data/uploads、静态服务或 CDN 返回。无自动历史扫描、自动认领和迁移。经批准的恢复调用受控 helper `importReviewed(item)`，见 `care-audio-security-20261107.md`。回滚也必须保留新表/文件和匿名读取封堵。
