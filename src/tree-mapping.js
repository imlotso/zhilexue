'use strict';
// 挂载到经过后台鉴权的 /api/admin/bank/tree-mapping；每条映射只连接同学段、同学科的两棵树。
const express = require('express');
const { db } = require('./db');
const router = express.Router();
const ok = (res, data) => res.json({code: 0, msg: 'ok', data});
const fail = (res, msg) => res.json({code: 1, msg});
const number = (v) => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0;
const tree = (id) => db.prepare('SELECT id, kind, subject, stage FROM bank_trees WHERE id=?').get(id);
const compatible = (a, b) => a && b && a.kind === 'textbook' && b.kind === 'knowledge' && a.subject && a.stage && a.subject === b.subject && a.stage === b.stage;
router.get('/', (req, res) => {
  const chapterId = number(req.query.chapter_tree_id), knowledgeId = number(req.query.knowledge_tree_id);
  if (!compatible(tree(chapterId), tree(knowledgeId))) return fail(res, '请选择同学段、同学科的章节树和知识点树');
  const links = db.prepare(`SELECT m.chapter_node_id, m.knowledge_node_id FROM bank_tree_node_mappings m
    JOIN bank_tree_nodes c ON c.id=m.chapter_node_id JOIN bank_tree_nodes k ON k.id=m.knowledge_node_id
    WHERE c.tree_id=? AND k.tree_id=? ORDER BY m.chapter_node_id,m.knowledge_node_id`).all(chapterId, knowledgeId);
  return ok(res, {links});
});
router.put('/:chapterNodeId', (req, res) => {
  const id = number(req.params.chapterNodeId), knowledgeTreeId = number(req.body && req.body.knowledge_tree_id);
  const ids = req.body && req.body.knowledge_node_ids;
  if (!id || !knowledgeTreeId || !Array.isArray(ids) || ids.length > 5000 || ids.some(v => !number(v))) return fail(res, '节点列表无效');
  const unique = [...new Set(ids.map(number))];
  const node = db.prepare('SELECT id, tree_id FROM bank_tree_nodes WHERE id=?').get(id);
  if (!node || !compatible(tree(node.tree_id), tree(knowledgeTreeId))) return fail(res, '请选择同学段、同学科的章节树和知识点树');
  if (unique.length) {
    const found = db.prepare(`SELECT id FROM bank_tree_nodes WHERE tree_id=? AND id IN (${unique.map(() => '?').join(',')})`).all(knowledgeTreeId, ...unique);
    if (found.length !== unique.length) return fail(res, '知识点不属于所选树');
  }
  db.transaction(() => {
    db.prepare('DELETE FROM bank_tree_node_mappings WHERE chapter_node_id=? AND knowledge_node_id IN (SELECT id FROM bank_tree_nodes WHERE tree_id=?)').run(id, knowledgeTreeId);
    const insert = db.prepare('INSERT INTO bank_tree_node_mappings (chapter_node_id,knowledge_node_id) VALUES (?,?)');
    unique.forEach(k => insert.run(id, k));
  })();
  return ok(res, {chapter_node_id:id, knowledge_node_ids:unique});
});
module.exports = router;
