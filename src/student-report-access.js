'use strict';

// Shared by legacy and current learning reports; content sharing is separate.
function studentScope(user, alias = 's', branch = 'all') {
  let sql = `${alias}.role='student'`; const args = [];
  if (!user || !['admin', 'branch'].includes(user.role)) return { sql: sql + ' AND 0=1', args };
  if (user.role === 'branch') { sql += ` AND ${alias}.created_by=?`; args.push(Number(user.id)); }
  else if (String(branch) === 'none') {
    sql += ` AND (NOT EXISTS (SELECT 1 FROM users owner WHERE owner.id=${alias}.created_by) OR EXISTS (SELECT 1 FROM users owner WHERE owner.id=${alias}.created_by AND owner.role='admin'))`;
  } else if (String(branch) !== 'all') { sql += ` AND ${alias}.created_by=?`; args.push(Number(branch) || 0); }
  return { sql, args };
}
function canReadStudent(user, student) {
  return !!user && !!student && student.role === 'student' &&
    (user.role === 'admin' || (user.role === 'branch' && Number(student.created_by) === Number(user.id)));
}
module.exports = { studentScope, canReadStudent };
