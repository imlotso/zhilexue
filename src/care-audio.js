'use strict';
// Care recordings never use storage.js, its public CDN, or data/uploads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const MAX_SIZE = 50 * 1024 * 1024;
const ID_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^[A-Za-z0-9_-]+\.(webm|mp3|m4a|wav|ogg|aac|amr)$/i;
const MIME = { webm: 'audio/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', amr: 'audio/amr' };
const SCHEMA = `CREATE TABLE IF NOT EXISTS care_audio (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  owner_role TEXT NOT NULL,
  branch_id INTEGER DEFAULT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  legacy_name TEXT DEFAULT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  review_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);`;
function normalizedPath(url) {
  const target = String(url || '');
  // This origin server does not accept proxy/authority/asterisk request targets.
  // Reject raw fragments too: parseurl would discard them before choosing a file.
  if (!target.startsWith('/') || target.includes('#')) return null;
  let value;
  try { value = decodeURIComponent(target.split('?')[0]); }
  catch (_) { return null; }
  // serve-static/send decode once. Reject ambiguous percent-bearing or backslash
  // paths rather than checking a different filesystem target after re-decoding.
  if (value.includes('%') || value.includes('\\') || /[\x00-\x1f]/.test(value)) return null;
  return path.posix.normalize('/' + value.replace(/^\/+/, ''));
}

function inside(file, dir) { return file === dir || file.startsWith(dir + path.sep); }
function real(file) { try { return fs.realpathSync(file); } catch (_) { return path.resolve(file); } }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function mediaType(name, bytes) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!MIME[ext] || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SIZE) return null;
  const ascii = (s, at = 0) => bytes.subarray(at, at + s.length).toString('ascii') === s;
  const match = ext === 'wav' ? bytes.length >= 12 && ascii('RIFF') && ascii('WAVE', 8)
    : ext === 'webm' ? bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3
    : ext === 'ogg' ? ascii('OggS')
    : ext === 'm4a' ? bytes.length >= 12 && ascii('ftyp', 4)
    : ext === 'amr' ? ascii('#!AMR\n') || ascii('#!AMR-WB\n')
    : ext === 'mp3' ? ascii('ID3') || bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
    : ext === 'aac' ? bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0 : false;
  return match ? MIME[ext] : null;
}
function createCareAudio({ db, dataDir, publicDir, auth }) {
  const privateDir = path.join(dataDir, 'private-care-audio');
  const legacyDir = path.join(publicDir, 'uploads', 'audio');
  function safeHeaders(res) {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Authorization' });
  }
  function fail(res, status, msg) { safeHeaders(res); return res.status(status).json({ code: status, msg }); }
  function requireHeader(req, res, next) {
    safeHeaders(res);
    if (!/^Bearer [^\s]+$/.test(String(req.headers.authorization || ''))) return fail(res, 401, '请先登录后收听录音');
    next();
  }
  function isStaff(user) { return user && ['admin', 'branch'].includes(user.role); }
  function allowed(row, user) {
    return isStaff(user) && row.status === 'active' &&
      ((Number(row.owner_id) === Number(user.id) && row.owner_role === user.role) ||
       (user.role === 'branch' && Number(row.branch_id) === Number(user.id)));
  }
  function ensurePrivateDir() {
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    // Misconfigured symlinks must not put new recordings under either public or the general file API.
    const actual = fs.realpathSync(privateDir);
    if (inside(actual, real(publicDir)) || inside(actual, real(path.join(dataDir, 'uploads')))) throw new Error('录音私有目录配置不安全');
  }
  function insert(bytes, { owner_id, owner_role, branch_id = null, legacy_name = null, review_ref = '' }, ext, mime) {
    ensurePrivateDir();
    const id = crypto.randomBytes(16).toString('hex');
    const storage_name = id + '.' + ext;
    const row = { id, owner_id, owner_role, branch_id, storage_name, mime_type: mime, size: bytes.length, sha256: digest(bytes), legacy_name, status: 'active', review_ref, created_at: new Date().toISOString() };
    fs.writeFileSync(path.join(privateDir, storage_name), bytes, { flag: 'wx', mode: 0o600 });
    // A DB failure leaves an inaccessible private orphan, never a public fallback or deleted historic file.
    db.prepare('INSERT INTO care_audio (id,owner_id,owner_role,branch_id,storage_name,mime_type,size,sha256,legacy_name,status,review_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(...['id','owner_id','owner_role','branch_id','storage_name','mime_type','size','sha256','legacy_name','status','review_ref','created_at'].map(k => row[k]));
    return row;
  }
  function upload(req, res) {
    if (!isStaff(req.user)) return fail(res, 403, '无权限上传录音');
    if (!req.file) return fail(res, 400, '请选择录音文件');
    let name = String(req.file.originalname || 'rec.webm');
    if (/[\u0080-\u00ff]/.test(name)) {
      const fixed = Buffer.from(name, 'latin1').toString('utf8');
      if (!fixed.includes('\uFFFD')) name = fixed;
    }
    const mime = mediaType(name, req.file.buffer);
    if (!mime) return fail(res, 400, '录音格式无效或超过 50MB，请选择 webm / mp3 / m4a / wav / ogg / aac / amr 文件');
    const row = insert(req.file.buffer, { owner_id: req.user.id, owner_role: req.user.role, branch_id: req.user.role === 'branch' ? req.user.id : null }, path.extname(name).slice(1).toLowerCase(), mime);
    safeHeaders(res);
    res.json({ code: 0, data: { id: row.id, url: '/api/admin/care-audio/' + row.id, name, size: row.size } });
  }
  function serve(row, req, res, legacy = false) {
    if (!isStaff(req.user)) return fail(res, 403, '无权限收听录音');
    if (!row || row.status !== 'active') return fail(res, legacy ? 409 : 404, legacy ? '历史录音归属待核对，请联系管理员；原文件仍保留' : '录音不存在或无权访问');
    if (!allowed(row, req.user)) return fail(res, 404, '录音不存在或无权访问');
    if (!NAME_RE.test(row.storage_name) || !MIME[path.extname(row.storage_name).slice(1)] || row.mime_type !== MIME[path.extname(row.storage_name).slice(1)]) return fail(res, 404, '录音暂不可用');
    const file = path.join(privateDir, row.storage_name);
    if (!inside(real(file), real(privateDir)) || real(file) !== path.join(real(privateDir), row.storage_name)) return fail(res, 404, '录音暂不可用');
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size !== Number(row.size) || stat.size < 1 || stat.size > MAX_SIZE) throw new Error('invalid file');
    } catch (_) { if (fd !== undefined) fs.closeSync(fd); return fail(res, 404, '录音暂不可用'); }
    let start = 0, end = Number(row.size) - 1;
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (m && (m[1] || m[2])) {
        if (!m[1]) start = Math.max(0, Number(row.size) - Number(m[2]));
        else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      }
      if (!m || !(m[1] || m[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0) {
        fs.closeSync(fd); res.set('Content-Range', 'bytes */' + row.size); return fail(res, 416, '无效的录音范围');
      }
      res.status(206); res.set('Content-Range', `bytes ${start}-${end}/${row.size}`);
    }
    safeHeaders(res);
    res.set({ 'Content-Type': row.mime_type, 'Content-Disposition': 'inline', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') { fs.closeSync(fd); return res.end(); }
    const stream = fs.createReadStream(file, { fd, autoClose: true, start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  function read(req, res) {
    const id = String(req.params.id || '');
    if (!ID_RE.test(id)) return fail(res, 404, '录音不存在或无权访问');
    return serve(db.prepare('SELECT * FROM care_audio WHERE id=?').get(id), req, res);
  }
  function legacyBoundary(req, res, next) {
    const normalized = normalizedPath(req.originalUrl || req.url);
    if (normalized === null) return fail(res, 400, '请求路径无效');
    if (!/^\/uploads\/audio(?:\/|$)/i.test(normalized)) return next();
    requireHeader(req, res, () => auth()(req, res, () => {
      if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, '不支持此请求');
      const name = normalized.slice('/uploads/audio/'.length);
      if (!NAME_RE.test(name)) return fail(res, 404, '录音不存在或无权访问');
      serve(db.prepare('SELECT * FROM care_audio WHERE legacy_name=?').get(name), req, res, true);
    }));
  }
  function protectFile(file, res) {
    const actual = real(file);
    if ([legacyDir, privateDir].some(dir => inside(actual, real(dir)))) { fail(res, 404, '文件不存在'); return true; }
    return false;
  }
  function protectStatic(root) {
    return (req, res, next) => {
      const normalized = normalizedPath(req.url);
      if (normalized === null) return fail(res, 400, '请求路径无效');
      const file = path.join(root, normalized);
      if (protectFile(file, res)) return;
      // Both app mounts use express.static's default index.html. Check the actual
      // implicit index target as well, including an index that is a symlink.
      if (protectFile(path.join(file, 'index.html'), res)) return;
      next();
    };
  }
  // Offline-only: the manifest is reviewed by an authorized operator, never accepted from browser/localStorage.
  // Reads exactly one explicitly named historical file, checks its approved hash, and never deletes its source.
  function importReviewed(item) {
    if (!item || !NAME_RE.test(String(item.legacy_name || ''))) throw new Error('旧录音文件名无效');
    if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))) throw new Error('必须提供已审核的 SHA-256 校验值');
    if (!String(item.review_ref || '').trim() || String(item.review_ref).length > 255) throw new Error('必须提供审核依据编号');
    const owner = db.prepare('SELECT id,role,status FROM users WHERE id=?').get(Number(item.owner_id));
    if (!isStaff(owner) || Number(owner.status) !== 1) throw new Error('所属账号无效');
    const branch = item.branch_id == null ? null : db.prepare('SELECT id,role,status FROM users WHERE id=?').get(Number(item.branch_id));
    if (item.branch_id != null && (!branch || branch.role !== 'branch' || Number(branch.status) !== 1)) throw new Error('所属校区无效');
    if (owner.role === 'branch' && (!branch || Number(branch.id) !== Number(owner.id))) throw new Error('分校账号与所属校区不一致');
    const old = db.prepare('SELECT * FROM care_audio WHERE legacy_name=?').get(item.legacy_name);
    if (old) {
      if (Number(old.owner_id) !== Number(owner.id) || old.owner_role !== owner.role || (old.branch_id == null ? null : Number(old.branch_id)) !== (branch ? Number(branch.id) : null) || old.sha256 !== item.sha256 || old.status !== 'active') throw new Error('已有映射已存在且不一致，请人工核对，不会覆盖');
      try {
        if (!NAME_RE.test(old.storage_name)) throw new Error('invalid name');
        const file = path.join(privateDir, old.storage_name);
        if (real(file) !== path.join(real(privateDir), old.storage_name)) throw new Error('invalid path');
        const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.size !== Number(old.size) || stat.size > MAX_SIZE || digest(fs.readFileSync(fd)) !== item.sha256) throw new Error('invalid copy');
        } finally { fs.closeSync(fd); }
      } catch (_) { throw new Error('私有副本缺失或校验失败，保留原文件与现有映射，请人工核对'); }
      return old;
    }
    const source = path.join(legacyDir, item.legacy_name);
    if (real(source) !== path.join(real(legacyDir), item.legacy_name)) throw new Error('旧录音路径无效');
    const fd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let bytes;
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > MAX_SIZE) throw new Error('旧录音文件无效'); bytes = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
    if (digest(bytes) !== item.sha256) throw new Error('旧录音 SHA-256 校验失败，不创建映射');
    const mime = mediaType(item.legacy_name, bytes); if (!mime) throw new Error('旧录音格式无效，保留原文件待核对');
    return insert(bytes, { owner_id: owner.id, owner_role: owner.role, branch_id: branch ? branch.id : null, legacy_name: item.legacy_name, review_ref: String(item.review_ref).trim() }, path.extname(item.legacy_name).slice(1).toLowerCase(), mime);
  }
  // Retain the historical parser sentinel byte. Multer 2.5 makes its limit
  // inclusive; mediaType still rejects every file larger than MAX_SIZE before writes.
  return { requireHeader, uploadMiddleware: multer({ storage: multer.memoryStorage(), limits: { fieldNestingDepth: 4, fieldArrayIndexLimit: 100, fileSize: MAX_SIZE + 1, files: 1 } }).single('file'), upload, read, legacyBoundary, protectStatic, protectFile, importReviewed };
}
module.exports = { SCHEMA, createCareAudio, normalizedPath, mediaType };
