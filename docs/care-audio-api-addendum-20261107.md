# API 增补：私有班主任录音

本文件补充[完整 API 清单](api.md)，仅列本轮私有录音新增或变化的接口。

- `POST /api/admin/upload-audio`：admin/branch 的 Bearer 认证头；multipart `file`，最大 50MB；返回 `{id,url,name,size}`，url 为受保护 `/api/admin/care-audio/:id`，不再返回公开文件路径。
- `GET/HEAD /api/admin/care-audio/:id`：只允许服务器记录的 owner（角色匹配）或明确所属 branch；学生、其他账户无权读取；支持单段 Range。
- `GET/HEAD /uploads/audio/:legacy_name`：需要认证头，仅兼容已有审核映射的私有副本。无映射返回 409 和“历史录音归属待核对”，原字节保留；匿名不返回字节。

前端使用认证 fetch→Blob，不接受查询 token，也不回退公开读。没有浏览器可调用的迁移或认领接口。实现位于 `src/care-audio.js`，挂载在 `src/app.js`。部署、迁移与响应头细节见 `care-audio-security-20261107.md`。
