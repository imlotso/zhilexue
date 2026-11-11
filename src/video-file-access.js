'use strict';

function proxyKey(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, 'http://local.invalid');
    return parsed.pathname === '/api/file' ? parsed.searchParams.get('key') || '' : '';
  } catch (_) { return ''; }
}
// Check the actual video relationship even when a historical video lives outside
// videos/. Unattached videos/ objects are manager previews, not student content.
function canReadVideoFile(db, user, key, canSeeChapter) {
  if (user && ['admin', 'branch'].includes(user.role)) return true;
  const videos = db.prepare("SELECT chapter_id, file_path, url FROM videos WHERE file_path=? OR IFNULL(url,'')<>''").all(key)
    .filter((row) => row.file_path === key || proxyKey(row.url) === key);
  if (!videos.length) return !key.startsWith('videos/');
  if (!user || user.role !== 'student') return false;
  return videos.some((row) => !row.chapter_id || canSeeChapter(user, db.prepare('SELECT * FROM chapters WHERE id=?').get(row.chapter_id)));
}
module.exports = { canReadVideoFile, proxyKey };
