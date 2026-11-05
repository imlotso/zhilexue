# 发布与回滚步骤（给 BOBO）

> 本文件给 BOBO 手工执行。**agent 不直接操作生产服务器和生产库，也不创建 Git 标签**——标签、发布都由 BOBO 来做。
> 本次改版范围见 `docs/taskbook-20261107.md`，每个任务的改动见 `docs/changelog-20261107.md`，验收结果见 `docs/self-check-20261107.md`。
> 命令里的路径（`/www/xuexi-system`、`/backup`）和数据库名 `xuexi` 是示例，按服务器实际情况替换。

---

## 0. 发布前确认（5 分钟）

1. GitHub 上 `main` 最新提交的 CI 全绿（`unit` + `api`）。
2. 看 `docs/pending-human-actions.md`，确认没有"必须发布前处理"的阻塞项。尤其注意：
   - **T12 题库图片与存储**：题库和视频按目录分类，不需拆桶。新题图通过稳定 key 代理访问；已识别的当前存储域名历史题图会重新签发。先在测试环境核对历史题图是否属于当前桶/域名；换过桶、域名或自定义题库目录的记录不能自动推断，需要对应原始配置与文件。此检查不会迁移文件。
   - **T1** 的真实库视频编码核对（H.265 / 非 faststart 的视频）。
3. 在 `main` 上打好要发布的标签（BOBO 手动，例如 `v20261107`）。**记下"上一个标签或提交"**——回滚时要用（第 7 步）。
4. 选一个学生不在线的时间窗口。整个过程大约 20～30 分钟；服务重启的几秒钟内页面会打不开。

## 1. 备份（必做，先于任何改动）

在**服务器**上执行，备份文件放在项目目录**之外**，不提交到 Git：

```bash
mkdir -p /backup/$(date +%Y%m%d)
cd /backup/$(date +%Y%m%d)

# ① 生产库完整备份（库名按实际；--single-transaction 不锁表）
mysqldump -uroot -p --single-transaction --routines --default-character-set=utf8mb4 xuexi > xuexi-before.sql
ls -lh xuexi-before.sql          # 文件大小应该不是 0

# ② 备份上传文件（本地存储的部分：讲义、错题重组图片、老师录音等；云存储里的视频不在服务器上）
tar czf uploads-before.tgz -C /www/xuexi-system data/uploads public/uploads

# ③ 备份当前的 pm2 配置和线上私有配置（里面有 JWT_SECRET、DEL_PWD 等）
cp /www/xuexi-system/ecosystem.config.js .
cp /www/xuexi-system/src/config.local.js .
cp /www/xuexi-system/data/.secret . 2>/dev/null

# ④ 记下线上当前版本，回滚用
cd /www/xuexi-system && (git rev-parse HEAD 2>/dev/null || echo "（不是 git 目录：记下当前目录的打包时间）") | tee /backup/$(date +%Y%m%d)/version-before.txt
```

> 如果线上目录不是 `git clone` 出来的，先把整个目录打个包作为"上一个版本"：`tar czf /backup/$(date +%Y%m%d)/code-before.tgz --exclude=node_modules --exclude=data/uploads -C /www xuexi-system`。

## 2. 同步代码到服务器

**排除**：`node_modules`（在服务器上重新装）、`data/uploads`（学生和老师上传的文件，千万不能被覆盖或删除）、TTS 缓存、`data/tmp`、`data/logs`、`.git`、`public/uploads`。

在**能访问仓库的电脑**上（先 `git checkout <要发布的标签或 main>`），先 `--dry-run` 看会改哪些文件，确认无误再去掉 `--dry-run`：

```bash
rsync -avz --dry-run --delete \
  --exclude='node_modules' --exclude='.git' \
  --exclude='data/uploads' --exclude='data/tmp' --exclude='data/logs' --exclude='data/.secret' \
  --exclude='public/uploads' --exclude='tts-cache' \
  --exclude='ecosystem.config.js' --exclude='src/config.local.js' \
  ./ user@服务器:/www/xuexi-system/
```

说明：

- `--exclude='ecosystem.config.js'`、`--exclude='src/config.local.js'`：线上这两个文件里有生产环境自己的 `JWT_SECRET` / `DEL_PWD` / MySQL 账号，**不要用仓库里的覆盖**。同步后用 `diff` 对一下，看仓库版本有没有新增的配置项需要手工并入。
- TTS 缓存在服务器上是 `/opt/xuexi/tts-cache`（不在项目目录里），rsync 不会碰它；如果你的服务器把它放在项目里，也已在上面排除。
- `--delete` 会删除服务器上"仓库里已经没有"的文件（例如清理掉的旧脚本）。**第一次务必先看 `--dry-run` 输出里有没有被删的 `data/`、`public/uploads/` 下的东西**——有就先加 `--exclude`。不放心可以去掉 `--delete`。

## 3. 安装依赖

在服务器上：

```bash
cd /www/xuexi-system
npm ci --omit=dev
```

错题本和教师试卷 Word 导出使用 `docx`；复杂公式图片使用锁定版本的 `mathjax-full` 和 `@resvg/resvg-js`。`resvg` 的平台二进制通过 optional 依赖安装，**不要使用 `--omit=optional`、`--no-optional` 或设置 npm 的 omit=optional**。部署机器须安装适合其系统架构的包；可运行下面的检查（正常输出 `PNG 渲染可用`）：

```bash
node -e 'const {Resvg}=require("@resvg/resvg-js"); const s="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><path d=\"M0 0h8v8H0z\"/></svg>"; if(!new Resvg(s).render().asPng().length) process.exit(1); console.log("PNG 渲染可用")'
```

图片渲染不依赖系统 TeX、浏览器或外部网络。无法安全渲染的公式（包括未知语法、需系统字体的文本或超出限制的表达式）保留 LaTeX 原文。`ali-oss` / `qiniu` 仍属于可选依赖。

**不要**在生产环境设置 `AI_MOCK=1`、`TTS_MOCK=1`（那是开发 / CI 用的演示开关，设了之后 AI 和朗读都返回假数据）。生产保持 `STORAGE_DRIVER` 为原来的值（默认 `oss`）。

## 4. 数据库：结构变更 + 知识点迁移

### 4.1 结构变更是自动的（只加不删）

服务启动时 `src/db.js` 会幂等地建表 / 加列，本次新增的有：`mf_papers.year`、`questions.audio_key`、`mf_model_profiles.format` 等（见 `docs/database.md`）。**不需要手工执行 SQL**，也不会删除或修改已有列。

### 4.2 知识点迁移 `scripts/migrate-kb-to-trees.js`（先预演，再执行）

作用：把旧的"教材知识点树"（`kb_units` / `kb_points`）**复制**进新的知识点树。只增不删，可以重复执行（同父同名节点不重复建），不改旧表。

**先在测试库预演**——用刚才的备份还原一个测试库，让脚本连它：

```bash
mysql -uroot -p -e "CREATE DATABASE xuexi_rehearsal DEFAULT CHARACTER SET utf8mb4"
mysql -uroot -p xuexi_rehearsal < /backup/$(date +%Y%m%d)/xuexi-before.sql

cd /www/xuexi-system
MYSQL_DATABASE=xuexi_rehearsal node scripts/migrate-kb-to-trees.js --dry-run   # 只统计会新增多少节点，不写库
MYSQL_DATABASE=xuexi_rehearsal node scripts/migrate-kb-to-trees.js             # 真的执行一次
MYSQL_DATABASE=xuexi_rehearsal node scripts/migrate-kb-to-trees.js             # 再执行一次：新增节点数应为 0（重复执行不产生重复节点）
```

预演通过（第二次新增 0 个）后，**对生产库**执行（先确认第 1 步的备份已完成）：

```bash
node scripts/migrate-kb-to-trees.js --dry-run     # 看一眼目标库名和会新增的节点数
node scripts/migrate-kb-to-trees.js               # 执行
```

脚本第一行会打印"目标库：用户@主机:端口/库名"，**执行前核对库名是 `xuexi`（生产）还是 `xuexi_rehearsal`（预演）**。预演完把测试库删掉：`mysql -uroot -p -e "DROP DATABASE xuexi_rehearsal"`。

> 旧接口 `/kbtree*` 首次用到时，也会自动把对应 学科+学段 的旧数据复制进树，所以这一步漏了不会出错，只是首次打开会稍慢。

## 5. 重启服务

```bash
pm2 restart xuexi        # 如果 pm2 里还没有这个进程：pm2 start ecosystem.config.js
pm2 save
pm2 status               # xuexi 应该是 online
```

## 6. 检查日志并抽查

```bash
pm2 logs xuexi --lines 100      # 应该看到"学习系统已启动"启动横幅（含学生端 / 管理端地址、数据库、存储驱动），没有 Error / ECONNREFUSED / Cannot find module
```

浏览器里依次抽查（桌面一遍，手机再看前两项）：

| # | 抽查项 | 看什么 |
|---|---|---|
| 1 | 登录后台 `/admin/` | 能登录；左侧菜单是「首页 / 学生与账号 / 教学资源 / 智能题库 / 学情与报告 / 系统设置」；首页数据正常 |
| 2 | 登录学生端 `/` | 能登录；点一个视频能播放；单词速记页卡片布局不跳 |
| 3 | 后台 → 智能题库 → 知识树管理 | 章节树、知识点树能打开（迁移后能看到「教材单元知识点」分支） |
| 4 | 后台 → 智能题库 → 待审核题目 | 页面能打开，菜单角标数字与页面一致 |
| 5 | 后台 → 系统设置 → AI 配置中心 | 能看到当前生效的档案；点「测试当前配置」有明确结果（需要真实 Key） |
| 6 | 智能组卷 → 下发 → 学生端「我的任务」 | 用一个测试学生走一遍：能看到卷子、能交卷 |
| 7 | 学生端错题本 → 导出 Word | 能下载 .docx，用 Word / WPS 能打开 |
| 8 | 题目里的图片 | 任选一道带图的题，图能显示（对应 T12 的图片地址有效期问题，过一小时后再看一次） |

有任何一项不对，**先别慌**，看日志；确实修不了就走第 7 步回滚。

## 7. 回滚

触发条件：服务起不来、关键功能不可用、数据明显不对。

### 7.1 回滚代码（最常用，约 5 分钟）

```bash
cd /www/xuexi-system
# 方式一：线上目录是 git 目录
git fetch --tags && git checkout <BOBO 指定的上一个标签或提交>
# 方式二：线上目录不是 git 目录，用第 1 步打的包还原
# tar xzf /backup/<日期>/code-before.tgz -C /www

npm install --omit=dev
pm2 restart xuexi
pm2 logs xuexi --lines 50
```

> **数据库一般不用还原**：本次所有表结构变更都是"只加不删"（新增表 / 新增列），旧版本代码跑在新结构上不受影响；迁移脚本也只往知识点树里新增节点，不删旧数据。

### 7.2 还原数据库（只有数据被改坏时才做）

会**丢失备份之后新产生的所有数据**（学生的作答、新开的账号等），做之前先确认真的需要：

```bash
pm2 stop xuexi
mysql -uroot -p -e "DROP DATABASE xuexi; CREATE DATABASE xuexi DEFAULT CHARACTER SET utf8mb4"
mysql -uroot -p xuexi < /backup/<日期>/xuexi-before.sql
pm2 start xuexi
```

### 7.3 还原上传文件（几乎用不到）

只在上传目录被误删 / 误覆盖时：`tar xzf /backup/<日期>/uploads-before.tgz -C /www/xuexi-system`。

## 8. 发布之后

1. 把线上版本、发布时间、备份路径记下来（回滚要用）。
2. 回头看 `docs/pending-human-actions.md`，把已处理的改状态；其中 **真机测试**（T1 视频、T6 / T7 / T8 / T11 / T13 手机端）建议发布后尽快做。
3. 本次**没有做**的内容见 `docs/changelog-20261107.md` 末尾的「转二期」。
