'use strict';

// Never run the legacy seed against an existing database. GitHub Actions gets a
// disposable local database and a synthetic administrator for its test suite.
if (process.env.CI !== 'true') throw new Error('CI-only fixture; refusing to run outside CI.');
const { DB_INFO } = require('../src/db-connection');
if (!/(^|_)test(_|$)/i.test(DB_INFO.database)) throw new Error('The CI fixture requires a test-named database.');
require('./isolated-accounts').assertIsolated();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const seedPath = path.join(__dirname, '..', 'src', 'seed.js');
const seed = fs.readFileSync(seedPath, 'utf8');
const accountMatch = seed.match(/admin\.username\s*!==\s*(['"])(\d{11})\1/);
if (!accountMatch || seed.split(accountMatch[2]).length < 3) throw new Error('Could not safely identify the legacy seed account.');
const syntheticSeed = seed.split(accountMatch[2]).join('zlx-ci-admin');
const runner = `const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
const file=process.argv[1],m=new Module(file,module);m.filename=file;
m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fs.readFileSync(0,'utf8'),file);`;
const result = spawnSync(process.execPath, ['-e', runner, seedPath], {
  input: syntheticSeed, env: process.env, timeout: 120000,
  stdio: ['pipe', 'ignore', 'ignore'],
});
if (result.error || result.status !== 0) throw new Error('Isolated synthetic CI seed failed.');
console.log('Isolated synthetic CI seed completed.');
