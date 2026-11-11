'use strict';
// Disposable CI-only MySQL. Never change the runner's existing MySQL service,
// root account or databases. Passwords travel via environment, never argv.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const LABEL = 'org.zhilexue.ci.mysql';
const LOCAL_DOCKER = 'unix:///var/run/docker.sock';
function assertIsolated(env) {
  if (env.CI !== 'true' || env.ZLX_ISOLATED_TEST !== '1' || env.STORAGE_DRIVER !== 'local' || env.AI_MOCK !== '1' || env.TTS_MOCK !== '1' || (env.MYSQL_HOST && env.MYSQL_HOST !== '127.0.0.1')) {
    throw new Error('CI MySQL requires explicit isolated local test settings.');
  }
}
function environmentFile(env) {
  const file = env.GITHUB_ENV, root = env.RUNNER_TEMP;
  if (!file || !root || !path.isAbsolute(file) || !path.isAbsolute(root)) throw new Error('CI environment file is unavailable.');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(path.dirname(file)));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('CI environment file is outside the runner temporary directory.');
  return file;
}
function appendEnvironment(env, values) {
  const lines = Object.entries(values).map(([key,value]) => {
    if (!/^[A-Z_]+$/.test(key) || /[\r\n\0]/.test(String(value))) throw new Error('Invalid CI environment value.');
    return `${key}=${value}\n`;
  }).join('');
  const fd = fs.openSync(environmentFile(env), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  try { fs.writeFileSync(fd, lines, 'utf8'); } finally { fs.closeSync(fd); }
}
function generateCredentials(env, { randomBytes = crypto.randomBytes, mask = value => process.stdout.write(`::add-mask::${value}\n`) } = {}) {
  assertIsolated(env); environmentFile(env);
  const password = randomBytes(32).toString('hex'), rootPassword = randomBytes(32).toString('hex'), nonce = randomBytes(8).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{64}$/.test(rootPassword) || password === rootPassword || !/^[a-f0-9]{16}$/.test(nonce)) throw new Error('CI credential generation failed.');
  // Mask before exporting, before docker, and before any database connection.
  mask(password); mask(rootPassword);
  appendEnvironment(env, { MYSQL_HOST:'127.0.0.1', MYSQL_PORT:'0', MYSQL_USER:'zlx_ci_'+nonce,
    MYSQL_PASSWORD:password, MYSQL_ROOT_PASSWORD:rootPassword, MYSQL_DATABASE:'zhilexue_ci_test_'+nonce,
    MYSQL_CI_CONTAINER:'zlx-ci-mysql-'+nonce, MYSQL_CI_READY:'0' });
}
function containerIdentity(env) {
  const match = /^zlx-ci-mysql-([a-f0-9]{16})$/.exec(env.MYSQL_CI_CONTAINER || '');
  if (!match) throw new Error('Invalid isolated CI container identity.');
  return { name:match[0], nonce:match[1] };
}
function docker(args, env) {
  const result = spawnSync('docker', ['--host', LOCAL_DOCKER, ...args], {
    env:{...env, DOCKER_HOST:LOCAL_DOCKER, DOCKER_CONTEXT:'', DOCKER_TLS_VERIFY:'', DOCKER_CERT_PATH:''},
    encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:args[0] === 'run' ? 600000 : 30000, maxBuffer:1024*1024,
  });
  // Do not expose arbitrary subprocess output: it may contain environment values.
  if (result.error || result.status !== 0) throw new Error('Isolated CI Docker operation failed.');
  return result.stdout.trim();
}
function stopMysql(env, {run = docker} = {}) {
  assertIsolated(env);
  if (!env.MYSQL_CI_CONTAINER) return;
  const {name,nonce} = containerIdentity(env);
  const id = run(['ps','-aq','--filter',`name=^/${name}$`,'--filter',`label=${LABEL}=${nonce}`], env).trim();
  if (!id) return;
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Ambiguous CI container cleanup target.');
  run(['rm','--force','--volumes',id], env);
}
async function startMysql(env, { run = docker, connect = config => require('mysql2/promise').createConnection(config), sleep = ms => new Promise(resolve => setTimeout(resolve,ms)) } = {}) {
  assertIsolated(env); environmentFile(env);
  const {name,nonce} = containerIdentity(env);
  if (env.MYSQL_USER !== 'zlx_ci_'+nonce || env.MYSQL_DATABASE !== 'zhilexue_ci_test_'+nonce || env.MYSQL_HOST !== '127.0.0.1' || env.MYSQL_PORT !== '0' || !/^[a-f0-9]{64}$/.test(env.MYSQL_PASSWORD || '') || !/^[a-f0-9]{64}$/.test(env.MYSQL_ROOT_PASSWORD || '')) throw new Error('CI generated database credentials are missing or invalid.');
  let created = false;
  try {
    const id = run(['run','--detach','--rm','--name',name,'--label',`${LABEL}=${nonce}`,
      '--publish','127.0.0.1::3306','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_DATABASE','--env','MYSQL_USER','--env','MYSQL_PASSWORD','mysql:8.4'], env);
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid CI container response.');
    created = true;
    const binding = /^127\.0\.0\.1:(\d+)$/.exec(run(['port',name,'3306/tcp'], env));
    const port = binding && Number(binding[1]);
    if (!port || port > 65535) throw new Error('CI MySQL must bind only to loopback.');
    appendEnvironment(env, {MYSQL_PORT:String(port)});
    for (let attempt=0; attempt<60; attempt++) {
      let connection;
      try {
        connection = await connect({host:'127.0.0.1',port,user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE,connectTimeout:1000});
        await connection.query('SELECT 1');
        await connection.end(); connection = null;
        appendEnvironment(env, {MYSQL_CI_READY:'1', MYSQL_ROOT_PASSWORD:''});
        return;
      } catch (_) {
        if (connection) { try { await connection.end(); } catch (_) {} }
        if (attempt<59) await sleep(1000);
      }
    }
    throw new Error('CI MySQL did not become ready before the timeout.');
  } catch (_) {
    if (created) { try { stopMysql(env,{run}); } catch (_) {} }
    try { appendEnvironment(env, {MYSQL_CI_READY:'0', MYSQL_ROOT_PASSWORD:''}); } catch (_) {}
    throw new Error('Isolated CI MySQL startup failed; no existing database was changed.');
  }
}
module.exports = { generateCredentials, startMysql, stopMysql };
if (require.main === module) {
  (async () => {
    const action=process.argv[2];
    if (action==='credentials') generateCredentials(process.env);
    else if (action==='start') await startMysql(process.env);
    else if (action==='stop') stopMysql(process.env);
    else throw new Error('Unknown CI setup action.');
    console.log('Isolated CI MySQL '+action+' completed.');
  })().catch(() => { console.error('CI MySQL setup failed; check the isolated runner configuration.'); process.exitCode=1; });
}
