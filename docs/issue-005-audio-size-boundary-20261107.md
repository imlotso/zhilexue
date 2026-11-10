# ISSUE-005：录音恰好50MiB的边界

隔离部署针对性检查确认：原nginx `client_max_body_size 20m` 小于应用录音50MiB限制。部署员已只在智乐学隔离vhost改为51m，留multipart开销；配置备份、nginx -t/reload及食觅服务/防火墙保全检查通过。更大请求仍由网关拒绝。此为隔离配置更改，未修改应用冻结447源码。

随后实际上传发现：50MiB−1成功，恰好50MiB被Multer拒绝，50MiB+1也拒绝。前端只拒绝 `size > 50*1024*1024`，文案是“不能超过50MB”，因此exact50被拒属于真正边界缺陷，不是网关限制。

最小修复：仅将multipart解析器阈值改为 `MAX_SIZE + 1`。Busboy在达到阈值时触发limit事件，因此留一字节判界空间；实际业务校验 `mediaType` 的MAX_SIZE仍为50MiB。恰好50MiB允许，大于50MiB仍拒绝，不扩大业务上限，也不改变归属授权、私有路径或历史文件。

新增真实loopback multipart回归使用纯合成无个人信息的PCM WAV：exact50先红，修后成功，元数据/HEAD字节数吻合；多1字节拒绝且不新增元数据。相关录音后端与UI专项21/21通过；2份改动JS语法通过。无需重复无关全量回归，部署后只复测exact50及超界，并确认447既有代码/数据保持。

文件变更：src/care-audio.js、astra-care-audio-security-test.js、本说明、changelog追加。447→448源码增量，447冻结不改。真实历史录音迁移仍没有可信归属清单，不能用合成通过声称已迁移。
