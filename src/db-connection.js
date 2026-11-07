'use strict';
// Connection configuration only: no schema, data directories or legacy import.
let localMysql = {};
let configError = false;
try { localMysql = require('./config.local').mysql || {}; }
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
