#!/usr/bin/env node
'use strict';
/**
 * 批量导入目录树（R2）。格式见 docs/tree-import-format.md。
 *
 *   node scripts/import-trees.js <文件或目录> [更多文件或目录…] [--dry-run]
 *
 * - 目录：递归读取里面所有 .json（按文件名排序）；文件可以是单棵树对象，也可以是树数组。
 * - 幂等：按 kind+subject+stage+edition 找树（没有就建），节点按路径合并，只增不删；同一批文件再跑一遍新增 0。
 * - --dry-run：只统计"将新增多少节点"，不写库。
 * - 目标库按环境变量 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE，否则读 src/config.local.js；
 *   开头会打印目标库名。写真实库前先备份。
 * - 某个文件格式不对：打印原因、跳过这个文件、其它文件照常导入，最后退出码为 1。
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run') || args.includes('-n');
const targets = args.filter((a) => !a.startsWith('-'));
if (!targets.length || args.includes('--help') || args.includes('-h')) {
  console.log('用法：node scripts/import-trees.js <文件或目录> [更多…] [--dry-run]\n格式说明：docs/tree-import-format.md');
  process.exit(targets.length ? 0 : 2);
}

const { db, DB_INFO } = require('../src/db');
const treeIo = require('../src/treeio');

function collect(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    fs.readdirSync(p).sort().forEach((n) => collect(path.join(p, n), out));
  } else if (/\.json$/i.test(p)) out.push(p);
  return out;
}

const files = [];
for (const t of targets) {
  if (!fs.existsSync(t)) { console.error(`找不到：${t}`); process.exit(2); }
  collect(t, files);
}
if (!files.length) { console.error('没有找到 .json 文件'); process.exit(2); }

console.log(`目标库：MySQL ${DB_INFO.database} @ ${DB_INFO.host}:${DB_INFO.port}${dry ? '   （dry-run：只统计，不写库）' : ''}`);
let totalAdded = 0, bad = 0;
// 同一次 CLI 的有效文件共享虚拟节点，坏文件不提交其预检状态。
const previewContext = dry ? {} : undefined;
const STAGE = { primary: '小学', junior: '初中', senior: '高中' };
for (const f of files) {
  let results;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    results = treeIo.importAll(db, raw, { dry, previewContext });
  } catch (e) {
    bad++;
    console.error(`  [跳过] ${f}\n         ${e.message}`);
    continue;
  }
  results.forEach((r) => {
    totalAdded += r.added;
    console.log(`  ${path.relative(process.cwd(), f)}\n    ${r.kind === 'textbook' ? '章节树' : '知识点树'} ${STAGE[r.stage] || r.stage}${r.subject} ${r.edition || '（通用）'} 「${r.name}」`
      + `${r.created_tree ? '  [新建树]' : ''}  新增 ${r.added} / 已存在 ${r.existing} / 文件共 ${r.total} 个节点${r.tree_id ? '  树ID ' + r.tree_id : ''}`);
  });
}
console.log(`${dry ? '预检' : '导入'}完成：${files.length - bad} 个文件成功${bad ? `，${bad} 个文件有问题` : ''}，共新增 ${totalAdded} 个节点`);
process.exit(bad ? 1 : 0);
