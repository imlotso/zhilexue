'use strict';
// 所有入口共用可选的资料范围；只接受已经存在的教材版本，不生成目录数据。
module.exports = function intakeScope(db, input = {}) {
  const scope = {};
  for (const key of ['subject', 'stage', 'grade', 'edition', 'term', 'material_type']) scope[key] = String(input[key] || '').trim();
  if (scope.subject && !['数学', '英语', '物理', '化学', '语文'].includes(scope.subject)) throw new Error('请选择有效的学科');
  if (scope.stage && !['primary', 'junior', 'senior'].includes(scope.stage)) throw new Error('请选择有效的学段');
  if (scope.edition && !db.prepare('SELECT id FROM bank_trees WHERE subject=? AND stage=? AND edition=? LIMIT 1').get(scope.subject, scope.stage, scope.edition)) throw new Error('教材版本与学科或学段不一致，请重新选择');
  if (!['', '上册', '下册', '全一册'].includes(scope.term)) throw new Error('请选择有效的册别');
  if (!['', 'textbook', 'exercise', 'paper', 'other'].includes(scope.material_type)) throw new Error('请选择有效的资料类型');
  return scope;
};
