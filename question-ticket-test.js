'use strict';
// 仅验证签名和期限；不连接数据库，也不读取真实环境的密钥。
const assert = require('assert');
process.env.JWT_SECRET = 'question-ticket-test-only';
const dbPath = require.resolve('./src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { DATA_DIR: '/tmp' } };
const { signQuestionTicket, verifyQuestionTicket } = require('./src/auth');
const good = signQuestionTicket(1, 2);
assert(verifyQuestionTicket(1, 2, good));
assert(!verifyQuestionTicket(2, 2, good));
assert(!verifyQuestionTicket(1, 3, good));
assert(!verifyQuestionTicket(1, 2, signQuestionTicket(1, 2, -1)));
assert(!verifyQuestionTicket(1, 2, good + 'x'));
assert(!verifyQuestionTicket(1, 2, ''));
console.log('题目票据：有效、学生和题号绑定、过期、篡改、缺失验证通过');
