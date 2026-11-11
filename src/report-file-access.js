'use strict';

// Only server-recorded report uploads establish ownership. Legacy paper_keys do
// not prove who uploaded a file and must never be used to claim or delete it.
const REPORT_KEY_RE = /^report\/\d{6}\/[a-f0-9]{16}\.(?:png|jpe?g|webp|pdf)$/i;
function reportKeys(value) {
  try { const keys = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(keys) ? keys : []; }
  catch (_) { return []; }
}
function ownedReportKey(db, key, owner) {
  if (typeof key !== 'string' || !REPORT_KEY_RE.test(key) || !Number.isSafeInteger(Number(owner)) || Number(owner) <= 0) return false;
  return !!db.prepare('SELECT file_key FROM report_uploads WHERE file_key=? AND created_by=?').get(key, Number(owner));
}
function assertReportKeysOwned(db, keys, owner) {
  if (!Array.isArray(keys) || !keys.length || keys.length > 6 || keys.some((key) => !ownedReportKey(db, key, owner))) {
    const error = new Error('试卷附件未验证或不属于本账号，请重新上传试卷照片');
    error.code = 'REPORT_ATTACHMENT_FORBIDDEN';
    throw error;
  }
}
function recordReportUpload(db, key, owner, createdAt) {
  if (!REPORT_KEY_RE.test(key) || !Number.isSafeInteger(Number(owner)) || Number(owner) <= 0) throw new Error('试卷附件格式或上传账号无效');
  db.prepare('INSERT INTO report_uploads (file_key, created_by, created_at) VALUES (?,?,?)').run(key, Number(owner), createdAt);
}
function reportUploadName(name, mime) {
  if (/\.(png|jpe?g|webp|pdf)$/i.test(name)) return name;
  const ext = { 'image/png':'png', 'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/webp':'webp', 'application/pdf':'pdf' }[String(mime || '').toLowerCase()];
  return ext ? 'paper.' + ext : name;
}
module.exports = { reportKeys, ownedReportKey, assertReportKeysOwned, recordReportUpload, reportUploadName };
