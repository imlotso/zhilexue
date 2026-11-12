'use strict';
// This legacy browser test writes synthetic users and word books. Refuse the
// default application/database targets before loading the database module.
function assertIsolatedWordsLayout(env) {
  let base;
  try { base = new URL(env.BASE); } catch (_) { throw new Error('Word layout test requires an explicit isolated BASE URL.'); }
  const port = Number(env.MYSQL_PORT);
  if (env.CI !== 'true' || env.ZLX_ISOLATED_TEST !== '1' || env.STORAGE_DRIVER !== 'local' ||
      env.MYSQL_HOST !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535 ||
      port === 3306 || port === 13307 || !env.MYSQL_USER || !env.MYSQL_PASSWORD ||
      !/(^|_)test(_|$)/i.test(env.MYSQL_DATABASE || '') || env.RESTORED_DB_MODE === '1' ||
      base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) ||
      !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Word layout test requires an isolated local test database and explicit loopback BASE.');
  }
}
module.exports = { assertIsolatedWordsLayout };
