#!/usr/bin/env node
'use strict';
/**
 * 一次性把旧「教材知识点树」（kb_units / kb_points）复制进知识点树（bank_trees，kind=knowledge）。
 * 用法：node scripts/migrate-kb-to-trees.js [--dry-run]
 *   --dry-run  只统计"会新增多少节点"，不写库
 * 特点：可重复执行（同父同名节点不重复建）；只增不删；不修改 kb_* 表。
 * 注意：连的是 src/config.local.js / 环境变量 MYSQL_* 指向的库。先在测试库预演；真实库执行前先 mysqldump 备份。
 *       重复执行会把"已被手动删掉"的节点再复制回来（它是按旧表补齐，不记录删除）。
 * 复制到哪：该 学科+学段 已有的知识点树下新建一级分支「教材单元知识点」→ 年级 → 单元 → 知识点；没有知识点树时新建一棵。
 */
const dry = process.argv.includes('--dry-run');
const { db, DB_INFO } = require('../src/db');
const { migrateAll, BRANCH } = require('../src/kbtree');

console.log(`目标库：${DB_INFO.user}@${DB_INFO.host}:${DB_INFO.port}/${DB_INFO.database}${dry ? '（dry-run：不写库）' : ''}`);
const before = db.prepare('SELECT (SELECT COUNT(*) FROM kb_units) AS u, (SELECT COUNT(*) FROM kb_points) AS p, (SELECT COUNT(*) FROM bank_tree_nodes) AS n').get();
console.log(`迁移前：kb_units ${before.u} 行，kb_points ${before.p} 行，bank_tree_nodes ${before.n} 行`);
const r = migrateAll(db, { dry });
if (!r.list.length) console.log('旧表里没有数据，无需迁移。');
r.list.forEach((x) => console.log(`  ${x.subject} · ${x.stage === 'primary' ? '小学' : '初中'}：${x.units} 个单元、${x.points} 个知识点 → ${dry ? '将新增' : '新增'} ${x.created} 个节点（含「${BRANCH}」分支与年级节点）`));
console.log(`合计：${r.units} 个单元、${r.points} 个知识点，${dry ? '将新增' : '新增'} ${r.created} 个节点`);
if (!dry) {
  const after = db.prepare('SELECT COUNT(*) AS n FROM bank_tree_nodes').get();
  console.log(`迁移后：bank_tree_nodes ${after.n} 行`);
}
process.exit(0);
