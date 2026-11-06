'use strict';
// 同一账号、入口和请求凭据只生成一个审核批次；结果与批次在同一事务保存。
const crypto = require('crypto');
module.exports = function intakeReceipts(db, ok, fail) {
  const kinds = ['excel', 'word', 'skill', 'manual', 'manual-group', 'image', 'pdf', 'teacher_scan', 'student_scan', 'capture'];
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const scope = (uid, kind, key) => digest(`${uid}:${kind}:${key}`);
  const tableOf = kind => kind === 'student_scan' ? 'paper_uploads' : kind === 'capture' ? 'mf_capture_batches' : 'mf_recog_runs';
  const lookup = (key, table = 'mf_recog_runs') => db.prepare(`SELECT id,intake_input_hash,intake_result FROM ${table} WHERE intake_request_key=?`).get(key);
  const unpack = (row, table = 'mf_recog_runs') => { const identity = table === 'paper_uploads' ? {upload_id:row.id} : table === 'mf_capture_batches' ? {batch_id:row.id,id:row.id} : {run_id:row.id}; try { return {...JSON.parse(row.intake_result),...identity,recovered:true}; } catch (_) {return {...identity,recovered:true};} };
  function middleware(kind) {
    return (req, res, next) => {
      const key = String(req.get('X-Intake-Key') || '').trim();
      if (!key) return next(); // 兼容旧客户端；没有凭据的请求不猜测重复。
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return fail(res, '录题恢复凭据无效，请重新选择文件');
      const hash = crypto.createHash('sha256');
      if (req.file) hash.update(req.file.buffer);
      if (Array.isArray(req.files)) req.files.forEach(f=>{hash.update(String(f.buffer.length)+':');hash.update(f.buffer);});
      hash.update(JSON.stringify(Object.fromEntries(Object.entries(req.body || {}).sort(([a],[b])=>a.localeCompare(b)))));
      req.intakeReceipt = { key: scope(req.user.id, kind, key), hash: hash.digest('hex'), table:tableOf(kind) };
      const row = lookup(req.intakeReceipt.key,req.intakeReceipt.table);
      if (row) {
        if (row.intake_input_hash !== req.intakeReceipt.hash) return fail(res, '这次录入内容已变化，请重新开始一批，避免覆盖已有题目');
        return ok(res, unpack(row,req.intakeReceipt.table), '已恢复上次保存结果，未重复生成批次');
      }
      next();
    };
  }
  function commit(req, create) {
    const receipt = req.intakeReceipt;
    if (!receipt) return create();
    return db.transaction(() => {
      const row = lookup(receipt.key,receipt.table);
      if (row) { if (row.intake_input_hash !== receipt.hash) throw new Error('录入内容已变化，请重新开始一批'); return unpack(row,receipt.table); }
      const result = create();
      const id = Number(result.run_id || result.id || result.upload_id || result.batch_id);
      if (id) db.prepare(`UPDATE ${receipt.table} SET intake_request_key=?,intake_input_hash=?,intake_result=? WHERE id=?`).run(receipt.key, receipt.hash, JSON.stringify(result), id);
      return result;
    })();
  }
  function status(req, res) {
    const kind = String(req.query.kind || ''), key = String(req.params.key || '');
    if (!kinds.includes(kind) || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return fail(res, '录题恢复凭据无效');
    const row = lookup(scope(req.user.id, kind, key),tableOf(kind));
    return ok(res, row ? { found: true, ...unpack(row,tableOf(kind)) } : { found: false }, row ? '已找到保存结果' : '暂未找到已保存结果，请核对最近批次后决定是否重试');
  }
  const guard = handler => (req, res, next) => { try { const p = handler(req, res, next); if (p && p.catch) p.catch(e => { if (!res.headersSent) fail(res, e.message || '保存失败，请重试'); }); } catch (e) { if (!res.headersSent) fail(res, e.message || '保存失败，请重试'); } };
  return { middleware, commit, status, guard };
};
