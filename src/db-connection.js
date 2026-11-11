'use strict';
// Connection configuration only: no schema, data directories or legacy import.
const isolatedCI = process.env.CI === 'true';
if (isolatedCI) {
  const e = process.env;
  const port = Number(e.MYSQL_PORT);
  if (e.ZLX_ISOLATED_TEST !== '1' || e.STORAGE_DRIVER !== 'local' ||
      !['127.0.0.1', 'localhost', '::1'].includes(e.MYSQL_HOST) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !e.MYSQL_USER || !e.MYSQL_PASSWORD ||
      !/(^|_)test(_|$)/i.test(e.MYSQL_DATABASE || '') ||
      (e.MYSQL_CI_CONTAINER && e.MYSQL_CI_READY !== '1')) {
    throw new Error('CI requires explicit credentials for an isolated local test database; local configuration fallback is disabled.');
  }
}
let localMysql = {};
let configError = false;
try { if (!isolatedCI) localMysql = require('./config.local').mysql || {}; }
catch (e) {
  // Preserve the ordinary startup fallback. Explicit previews fail closed.
  if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes("Cannot find module './config.local'")) configError = true;
}
const DB_INFO = {
  host: process.env.MYSQL_HOST || localMysql.host || '',
  port: Number(process.env.MYSQL_PORT || localMysql.port || 3306),
  user: process.env.MYSQL_USER || localMysql.user || '',
  password: process.env.MYSQL_PASSWORD || localMysql.password || '',
  database: process.env.MYSQL_DATABASE || localMysql.database || 'xuexi',
};
function openReadOnly() {
  // Do not echo arbitrary config exceptions, which could contain credentials.
  if (configError) throw new Error('无法读取 config.local；只读预检已停止，请检查本地配置');
  const { openMysql } = require('./mysql-sync');
  return { db: openMysql({ ...DB_INFO, readOnly: true }), DB_INFO };
}
module.exports = { DB_INFO, openReadOnly };
