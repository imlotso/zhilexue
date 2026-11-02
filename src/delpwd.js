'use strict';
/**
 * 危险操作确认密码（讲义 / 视频 / 词书 的删除）
 *
 * 为什么单独抽一个模块：
 *   早期版本把词书的删除密码写死在前端 public/admin/words.js 里，
 *   而后端删除接口根本没校验——前端那个密码只是「看着像保护」，
 *   任何人 F12 就能拿到密码，或者干脆绕过前端直接调接口，一本本删光词书。
 *   现在密码只在服务端比对，前端永远拿不到它（前端只负责把用户输入传上来）。
 *
 * 密码可用环境变量 DEL_PWD 覆盖（正式部署务必改掉），默认值仅为兼容老数据。
 * 改法：服务器上编辑 server/ecosystem.config.js 的 env 段，加 "DEL_PWD": "你的新密码"，然后 pm2 restart xuexi
 */
const DEL_PWD = String(process.env.DEL_PWD || '199856');

/** 当前请求是否带了正确的删除密码（支持 body.pwd 与 ?pwd= 两种传法） */
const delPwdOk = (req) => String((req.body && req.body.pwd) || req.query.pwd || '') === DEL_PWD;

module.exports = { DEL_PWD, delPwdOk };
