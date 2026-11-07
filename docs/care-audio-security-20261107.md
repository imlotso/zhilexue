# 班主任录音访问隔离修复 v2（2026-11-07）

## 已核实问题与边界

旧 `POST /api/admin/upload-audio` 将录音写入 `public/uploads/audio`，普通静态服务可匿名返回原字节。已用临时目录中的合成 WAV 验证该行为；这不是历史文件已经外泄的证据。本次没有连接真实数据库、读取或枚举真实录音，也没有移动或删除历史文件。

修复不修改 001 的下发幂等逻辑，不改变题库听力/视频存储，也不使用生产 OSS/CDN。只运行录音与相关弹窗专项、语法检查；全量 MySQL/HTTP/真浏览器验收留给最终整合后统一进行。

## 服务端授权与私有文件

- `src/care-audio.js` 统一上传、读取、路径封堵、审核后迁移。
- 新字节仅写 `data/private-care-audio/<128-bit-random-id>.<ext>`。目录创建权限 0700、文件 0600；拒绝私有目录实际解析到 public 或通用 data/uploads。绝不调用 `storage.js` 或公开 CDN。
- `src/db.js` 幂等新增 `care_audio` 表，只加不删。记录随机 id、owner_id、owner_role、branch_id、storage_name、mime_type、size、sha256、legacy_name、status、review_ref、created_at。
- 上传者从服务端已复核的登录账户取值。branch 上传者的 branch_id 固定为自己的账号 id，admin 上传者 branch_id 为空。客户端的 owner_id/branch_id、学生姓名、localStorage、文件名一律不能授予读取权限。
- 读取规则：有效 admin/branch 账号，且是角色仍匹配的 owner；或是明确 branch_id 对应的分校账号。校长没有“全部历史录音”读取豁免；学生禁止读取。账号停用、删除、改角色、到期由现有 auth 每个请求复核。
- 每次读取必须在 Authorization 头提供 Bearer token；查询串 token、公开读和短链兜底均不支持。此补丁不签发音频票据。
- 常见音频扩展名需匹配容器头，最大 50MB。固定 audio MIME、nosniff、private/no-store、no-referrer、Vary: Authorization。支持单段 Range/HEAD，权限检查先于任何字节；非法、多段范围返回 416。
- 写文件后 DB 插入失败时，仅留下无外部读取入口的私有孤立文件，不删除历史记录，不退回公开存储。人工排查时先保全，不自动清理。

## 接口增补

| 接口 | 行为 |
| --- | --- |
| POST /api/admin/upload-audio | multipart file；返回 `{id,url,name,size}`，url 改为 `/api/admin/care-audio/:id`；必须 staff 的认证头 |
| GET/HEAD /api/admin/care-audio/:id | 当前账户对具体录音的授权读取，未授权统一 404（未登录 401/不支持角色 403） |
| GET/HEAD /uploads/audio/:legacy_name | 老 URL 兼容入口，必须认证头；只读已审核映射对应的私有副本；未核对返回 409 和可读提示 |

旧路径防护挂在所有路由和静态挂载前。只接受以 `/` 起始的 origin-form request-target；absolute-form、authority-form、asterisk-form 和 raw `#fragment` 一律 400。路径只解码一次，与 serve-static/send 的文件选取一致；解码后仍含百分号、反斜杠或控制字符的歧义路径失败关闭。编码斜杠、点段与重复斜杠规范化。public 根和 /admin 两个静态挂载都检查实际文件及默认隐式 `index.html` 的真实路径，通用 `/api/file` 也禁止经符号链接指向历史/私有录音目录。未映射旧 URL 不查询实际文件存在与否，统一提示待核对。普通 Unicode 目录、文件与正常目录 index 保持可用。

## 前端与草稿

`common.js` 播放只能请求同源的这两类受保护 URL，拒绝外链、非录音接口及 URL 中的令牌。使用认证 fetch → Blob → audio；令牌不写进 src/查询串。谈话和家校沟通详情不再直接插入历史 URL。

关闭、替换弹窗或离开页面时中止请求、暂停播放器并撤销 Blob URL。请求期间登录 token 改变会丢弃结果。已下载到浏览器的字节不能追溯撤回，服务端失效的是之后的请求。一次播放最多下载整个 50MB 文件，后端 Range 支持供受控客户端使用。

按 002 合并要求，通用 modal 同步保存抛错时显示错误 toast 并保持弹窗/草稿，不因 localStorage 配额失败关闭弹窗。关闭回调只执行一次。

## 无损历史迁移与已审定映射恢复

启动不扫描录音，不推断旧归属，不移动文件，不把旧链接持有人视为所有者。旧文件原位保留，但不能经过公开静态服务返回。

1. 操作前由有权限的部署人员备份历史目录、现有私有目录、数据库和相关账号资料，记录校验值；不要把这些数据带入测试或交付包。
2. 在网关先禁止匿名静态直出 `/uploads/audio/`，含同目录别名，并确保旧缓存失效。部署应用修复后，该路径须转给 Node 才能实现认证旧链接兼容，不能交给 nginx/CDN 的静态文件匹配。
3. 仅对已有独立可信证据的记录形成审核清单：`legacy_name`（旧生成文件名）、`owner_id`（审核确定的有效账户）、`branch_id`（明确校区或 null）、`sha256`（审核对应文件的准确校验值）、`review_ref`（可追溯批准记录编号）。证据至少能独立证明录音与账户/校区对应关系。不能仅凭文件名、路径、浏览器历史、上传者自称或 localStorage 中的学生姓名认定。
4. `createCareAudio({db,dataDir,publicDir,auth}).importReviewed(item)` 是供受控离线维护调用的入口，**没有 HTTP 导入/认领接口，也不会自动运行**。操作员审核完目标数据库及路径、取得执行授权后，逐条把明确批准的清单项传入现有数据库适配器。先在隔离库执行相同清单结构的合成测试。未提供一键生产迁移脚本，以免隐式加载 db.js 的常规初始化或误连默认数据库。
5. helper 逐条验证 owner 角色/状态和校区一致性，只打开清单明确指名的旧文件，不枚举；拒绝符号链接；先核对 SHA-256 与音频格式，再写随机私有副本，最后新增唯一 legacy_name 映射。旧字节不删除、不移动、不覆盖。失败留下的私有孤立副本不公开；修复原因后可重试。
6. 同一已审核映射重复运行会核对私有副本校验值并返回已有 id。归属不同、校验值不同、映射被停用，或私有副本缺失/损坏时停止，绝不静默覆盖或认领。并发重复遇到唯一约束时停止并人工核对，先保留双方文件。
7. 审核恢复后，原 localStorage 里的 `/uploads/audio/旧名` 无需改写，新前端会用认证头调用旧 URL，由服务端映射到私有副本。合法 owner/branch 可读，其他账户和匿名仍拒绝。
8. 无可信归属的文件继续保留隔离，UI 显示“历史录音归属待核对，请联系管理员；原文件仍保留”。不得为了可播放默认分配给当前登录人或校长，不得开放匿名下载。若需撤销错误映射，由授权操作员将该行 status 改为非 active，保留文件和审计依据；此补丁不提供用户自助更改归属。

## 部署与回滚必须保留的安全边界

- 先确认反向代理/CDN 没有在 Node 前直接提供 public/uploads/audio、data/private-care-audio、data/uploads 的文件别名。应用代码不能防止绕过 Node 的服务器规则。现有浏览器/CDN 缓存不会因新 no-store 自动消失，需按运行平台执行精确缓存失效。
- 发布源码时不能用覆盖/清理命令删除 data、public/uploads 或用户数据。新私有目录须加入备份，但不加入源码包。
- 先部署可兼容的加表与后端，再发布播放器脚本；旧前端短暂无法播放也不能恢复匿名访问。刷新静态脚本版本，检查合成上传、两校隔离、停用账号、旧链接映射与待核对提示。
- 回滚功能代码时也必须保留旧录音封堵和新表/私有目录，或由反向代理先完全拒绝录音路径并暂停录音功能。**不可直接回滚到原匿名 express.static 行为。** 不 DROP care_audio，不移动私有文件回 public，不删除旧文件。
- 应用回滚后若功能暂不可用，提示维护中；恢复时重新核对已有映射与私有副本。涉及真实库、文件及网关的动作由最终部署阶段单独核实执行，本次未执行。

## 验证与接入

`node --test astra-care-audio-security-test.js astra-care-audio-ui-test.js`：v2 为 20/20（合成 WAV、临时目录、内存 SQLite，HTTP 仅 loopback fixture；auth 使用真实模块、合成账号）。包括权限/账号失效、Range/HEAD、静态及通用文件别名、旧URL、校验失败保全、幂等损坏拒绝、中文文件名，以及前端认证/令牌目标限制、切账号、详情入口、modal 保存失败重试和关闭回调。

原候选 15 项通过后，审阅发现 request-target 解析与隐式 index 路径选取绕过，因此原候选及其清单/补丁已拒绝并原样保留，不作为当前交付。v2 新增 raw HTTP 反例覆盖 absolute/authority/畸形目标、raw fragment、残余百分号/反斜杠目录别名、两处静态挂载的隐式 index 符号链接，并回归普通 Unicode 静态文件。v2 本地 20 项通过不等于完成独立复核或最终部署验收。

基线红灯 `evidence/care-audio-red.log`：真实原静态中间件在合成目录匿名返回 200 与 WAV 测试内容。v2 红灯见 `evidence/care-audio-absolute-form-red.log`、`evidence/care-audio-static-parity-red.log`；当前绿灯及语法见 `evidence/care-audio-v2-green.log`、`evidence/care-audio-v2-syntax.log`。`care-audio-contract-red.log` 仅记录模块尚不存在阶段，不把它当漏洞复现证据。

建议整合者在 package.json 的 test:access 追加 `astra-care-audio-security-test.js astra-care-audio-ui-test.js`，本补丁不改 package.json。最终统一 MySQL schema、HTTP 和真实浏览器验收后再宣告部署完成。
