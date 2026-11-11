# 依赖修复

基线为 main 4f60b7a。所有改动只在独立审查分支；未在生产安装或升级。

| 依赖 | 基线 | 本次锁定 | 来源 |
| --- | --- | --- | --- |
| body-parser | 1.20.8 | 1.20.9 | npm 官方仓库 |
| qs | 6.16.0 | 6.16.2 | npm 官方仓库，兼容 Express 4 的约束 |
| ws | 8.17.1 | 8.22.2 | npm 官方仓库；直接依赖最低版本也提升 |
| xlsx | 0.18.5 | 0.20.3 | SheetJS 官方 CDN 固定版本和 lockfile integrity |
| 后台 SheetJS 浏览器包 | 0.18.5 | 0.20.3 | 与官方 npm tarball 内发行物相同，也与已有成绩页0.20.3字节相同 |

SheetJS npm registry 的公开 xlsx 版本停在0.18.5。根据其[官方 Node.js 安装说明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)改用[官方0.20.3发行包](https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz)，未采用不明镜像或非官方替代包。lockfile 保留完整性摘要，现有 npm 镜像地址规范为官方 registry.npmjs.org，其他依赖版本没有主动批量升级。

本次用户已明确批准将依赖清单发往 npm 官方进行漏洞匹配。更新后 `npm audit --omit=dev --json --registry=https://registry.npmjs.org` 返回0项公告命中，随后不排除开发依赖的完整 `npm audit --json --registry=https://registry.npmjs.org` 也返回0项。该结果只表示当前公告匹配，不是“无漏洞”保证；外部发行的 SheetJS 另依据官方版本、来源与兼容回归验证，不把 npm 未报当作单独安全证明。

新增 `astra-audit-dependency-regression-test.js`：基线5项安全版本断言失败、2项正常XLSX往返通过；修复后7项全过。服务端和真实浏览器发行代码（VM执行）均验证中文、不等式、选项与公式单元格往返。未使用真实用户表格或攻击生产。
