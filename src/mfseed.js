/**
 * 知识树种子数据导入（幂等）
 * 数据：data/knowledge-seed.json（章节树=苏科版数学/译林英语教材目录；知识点树=组卷网分类体系）
 * 结构：章节树 年级→册别→单元→小节；知识点树 大分类→子分类→孙分类
 * 身份：bank_trees.source = 'seed:v1:<kind>:<subject>:<stage>'，同名同父节点不重复建。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TREE_NAME = { 数学: '苏科版数学·教材章节', 英语: '译林版英语·教材章节' };
const SEED_VER = 'seed:v1';
// 章节树的教材版本（R2）：种子里小学数学那棵其实是苏教版的单元（原来误写成苏科版），初中数学才是苏科版
const SEED_EDITION = { 数学: { primary: '苏教版', junior: '苏科版' }, 英语: { primary: '译林版', junior: '译林版' } };
const WRONG_NAME = { '数学:primary': '苏科版数学·教材章节' };   // 旧的错误树名 → 改成「<版本><学科>·教材章节」

function ensureSeed(db) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'knowledge-seed.json'), 'utf8'));
  } catch (e) {
    console.error('[mfseed] 种子数据读取失败:', e.message);
    return;
  }
  const insNode = db.prepare('INSERT INTO bank_tree_nodes (tree_id, parent_id, name, sort, created_at) VALUES (?,?,?,?,?)');

  const ensureTree = (kind, subject, stage, name) => {
    const source = `${SEED_VER}:${kind}:${subject}:${stage}`;
    const edition = kind === 'textbook' ? ((SEED_EDITION[subject] || {})[stage] || '') : '';
    let t = db.prepare('SELECT * FROM bank_trees WHERE source=?').get(source);
    if (!t) {
      const info = db.prepare('INSERT INTO bank_trees (kind, subject, stage, name, source, edition, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(kind, subject, stage, edition && kind === 'textbook' ? `${edition}${subject}·教材章节` : name, source, edition, 0, new Date().toISOString());
      t = { id: info.lastInsertRowid };
    } else if (edition) {
      // 迁移已有库（幂等）：版本为空才补；树名只在还是旧的错误名字时才改，用户自己改过的名字不动
      if (!String(t.edition || '').trim()) db.prepare('UPDATE bank_trees SET edition=? WHERE id=?').run(edition, t.id);
      if (WRONG_NAME[`${subject}:${stage}`] === t.name) db.prepare('UPDATE bank_trees SET name=? WHERE id=?').run(`${edition}${subject}·教材章节`, t.id);
    }
    return t.id;
  };
  const ensureNode = (treeId, parentId, name, sort) => {
    const row = (parentId == null)
      ? db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id IS NULL AND name=?').get(treeId, name)
      : db.prepare('SELECT id FROM bank_tree_nodes WHERE tree_id=? AND parent_id=? AND name=?').get(treeId, parentId, name);
    if (row) return row.id;
    const info = insNode.run(treeId, parentId, name, sort, new Date().toISOString());
    return info.lastInsertRowid;
  };

  const fill = (treeId, list, parentId) => {
    (list || []).forEach((item, i) => {
      const obj = (typeof item === 'string') ? { n: item } : item; // 小节名直接给字符串
      const nid = ensureNode(treeId, parentId, String(obj.n), i);
      if (obj.c && obj.c.length) fill(treeId, obj.c, nid);
    });
  };

  try { require('./treepick').ensureDefaults(db); } catch (e) { console.error('[mfseed] 默认版本表失败:', e.message); }
  let treeCount = 0, touched = 0;
  try {
    for (const [subject, stages] of Object.entries(data.textbook || {})) {
      for (const [stage, grades] of Object.entries(stages)) {
        const treeId = ensureTree('textbook', subject, stage, TREE_NAME[subject] || `${subject}·教材章节`);
        treeCount++;
        for (const [grade, volumes] of Object.entries(grades)) {
          const gid = ensureNode(treeId, null, grade, 0);
          for (const [volume, units] of Object.entries(volumes)) {
            const vid = ensureNode(treeId, gid, volume, 0);
            fill(treeId, units, vid);
            touched += units.length;
          }
        }
      }
    }
    for (const [subject, stages] of Object.entries(data.knowledge || {})) {
      for (const [stage, cats] of Object.entries(stages)) {
        const treeId = ensureTree('knowledge', subject, stage, `${subject}·知识点（${stage === 'primary' ? '小学' : '初中'}）`);
        treeCount++;
        fill(treeId, cats, null);
        touched += cats.length;
      }
    }
    console.log(`[mfseed] 知识树种子就绪：${treeCount} 棵树，单元/分类条目 ${touched}`);
  } catch (e) {
    console.error('[mfseed] 种子导入失败:', e.message);
  }
}

/** 启动入口：知识树种子 + 默认版本表（settings.default_editions，没有才写） */
module.exports = { ensureSeed };
