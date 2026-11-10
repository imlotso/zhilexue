'use strict';
/**
 * 题库与视频存储解耦（T12）自测： node bankstore-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 STORAGE_DRIVER=local TTS_MOCK=1）并 npm run seed；直连同一个 MySQL 查库，结束后清理。
 * 覆盖：题目图片 / 音频 / TTS 的 key 都以 bank/ 开头，视频以 videos/ 开头 → 题库资源与视频只靠 key 前缀区分 →
 *       BANK_BUCKET 口子（缺省空 = 与视频同桶；配了只影响 bank/ 的 key，且不做多桶切换）→
 *       视频与题目只靠绑定关系关联：删除已绑题的视频后题目（图片 / 音频）仍在，只是被解绑。
 */
const fs = require('fs');
const { db } = require('./src/db');
const store = require('./src/storage');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, form } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const j = await res.json(); j._status = res.status; return j;
}
const uniq = Date.now().toString().slice(-8);
const TAG = 'T12存储测试';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const keys = [];
const form = (buf, name, type) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); return fd; };

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['mistakes', 'records', 'question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare(`SELECT id FROM videos WHERE title LIKE '${TAG}%'`).all().forEach((v) => db.prepare('DELETE FROM videos WHERE id=?').run(v.id));
  db.prepare(`SELECT id FROM chapters WHERE name LIKE '${TAG}%'`).all().forEach((c) => db.prepare('DELETE FROM chapters WHERE id=?').run(c.id));
  keys.forEach((k) => { try { fs.unlinkSync(store.localPath(k)); } catch (e) { /* ignore */ } });
}

(async () => {
  console.log('\n=== 题库与视频存储解耦（T12）· 自测 ===\n');
  cleanup();
  const AT = (await req('/api/login', { method: 'POST', body: { username: 'zlx-ci-admin', password: '123456', role: 'admin' } })).data.token;
  log(!!AT, '管理员登录');

  // ---------- 1) 题库资源的 key 前缀 ----------
  const img = await req(MF + '/asset', { method: 'POST', token: AT, form: form(PNG, '图.png', 'image/png') });
  if (img.data) keys.push(img.data.key);
  log(img.code === 0 && /^bank\/img\//.test(img.data.key), '题目图片：key 以 bank/img/ 开头', img.data && img.data.key);
  const wav = Buffer.alloc(44 + 200); wav.write('RIFF', 0); wav.write('WAVEfmt ', 8); wav.write('data', 36);
  const aud = await req(MF + '/audio/upload', { method: 'POST', token: AT, form: form(wav, '听力.wav', 'audio/wav') });
  if (aud.data) keys.push(aud.data.key);
  log(aud.code === 0 && /^bank\/audio\//.test(aud.data.key), '题目音频（上传）：key 以 bank/audio/ 开头', aud.data && aud.data.key);
  const tts = await req(MF + '/audio/tts', { method: 'POST', token: AT, body: { text: 'Hello.', lang: 'en' } });
  if (tts.data) keys.push(tts.data.key);
  if (tts.code === 0) log(/^bank\/audio\//.test(tts.data.key), '题目音频（文字生成朗读）：key 以 bank/audio/ 开头', tts.data.key);
  else console.log('  ⏭  这台服务器没有语音合成（需 TTS_MOCK=1），跳过 TTS 前缀检查：' + tts.msg);
  const cfg = await req(MF + '/config', { token: AT });
  log(cfg.code === 0 && cfg.data.folder === 'bank', '题库文件根目录默认就是 bank', cfg.data && cfg.data.folder);

  // 题目里存的图片、音频：新录入的题带 bank/ 前缀
  const q = await req(MF + '/questions', { method: 'POST', token: AT, body: { type: 'single', subject: '英语', stage: 'junior', grade: '七年级', stem: TAG + ' 听力题', options: [{ label: 'A', text: 'x' }, { label: 'B', text: 'y' }], answer: 'A', images: [img.data.url], audio_key: aud.data.key } });
  const qid = q.data && q.data.id;
  const row = qid ? db.prepare('SELECT images, audio_key FROM questions WHERE id=?').get(qid) : null;
  log(!!row && row.audio_key.startsWith('bank/') && decodeURIComponent(row.images).includes('bank/img/'), '新录入的题：音频 key、图片地址里的 key 都以 bank/ 开头', row && row.audio_key);

  // ---------- 2) 视频与题库只靠 key 前缀区分 ----------
  const ch = await req('/api/admin/chapters', { method: 'POST', token: AT, body: { subject: '数学', category: '同步基础', grade: '七年级', name: TAG + '目录' + uniq } });
  const vup = await req('/api/admin/videos', { method: 'POST', token: AT, form: (() => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('fake-mp4-bytes')], { type: 'video/mp4' }), 'v.mp4'); fd.append('title', TAG + '视频' + uniq); fd.append('chapter_id', String(ch.data.id)); fd.append('level', 'basic'); fd.append('url', ''); return fd; })() });
  const vid = vup.data && vup.data.id;
  const vrow = vid ? db.prepare('SELECT file_path FROM videos WHERE id=?').get(vid) : null;
  if (vrow && vrow.file_path) keys.push(vrow.file_path);
  log(!!vrow && /^videos\//.test(vrow.file_path) && !store.isBankKey(vrow.file_path), '视频：key 以 videos/ 开头，不属于题库资源', vrow && vrow.file_path);
  log(store.isBankKey(img.data.key) && store.isBankKey(aud.data.key) && !store.isBankKey('videos/202611/a.mp4') && !store.isBankKey('bank/../videos/a.mp4'), 'isBankKey 只认 bank/ 下的 key（带 .. 的不算）');

  // ---------- 3) BANK_BUCKET 口子 ----------
  log(store.BANK_BUCKET === '' && store.bucketFor(img.data.key) === '', 'BANK_BUCKET 缺省为空：题库资源与视频同桶（现状）');
  const out = require('child_process').execFileSync(process.execPath, ['-e', "const s=require('./src/storage');console.log(JSON.stringify([s.bucketFor('bank/img/a.png'),s.bucketFor('videos/a.mp4'),s.bucketFor('wrong/a.png')]))"], { env: { ...process.env, BANK_BUCKET: 'my-bank', STORAGE_DRIVER: 'local' }, cwd: __dirname }).toString().trim().split('\n').pop();
  log(out === '["my-bank","",""]', '配了 BANK_BUCKET：只有 bank/ 的 key 指向它，视频等其它 key 仍是默认桶', out);

  // ---------- 4) 删除已绑题的视频：题目仍在 ----------
  const bind = await req(`/api/admin/bank/videos/${vid}/bind`, { method: 'POST', token: AT, body: { ids: [qid] } });
  log(bind.code === 0 && db.prepare('SELECT video_id FROM questions WHERE id=?').get(qid).video_id === vid, '把题目绑定到视频', bind.msg);
  const del = await req('/api/admin/videos/' + vid, { method: 'DELETE', token: AT, body: { pwd: '199856' } });
  const after = db.prepare('SELECT id, video_id, images, audio_key FROM questions WHERE id=?').get(qid);
  log(del.code === 0 && !db.prepare('SELECT id FROM videos WHERE id=?').get(vid), '删除视频成功（带删除密码）', del.msg);
  log(!!after && after.video_id === null && after.audio_key.startsWith('bank/') && after.images.length > 5, '删除后题目仍在，只是被解绑；它的图片 / 音频不受影响', JSON.stringify(after && { video_id: after.video_id }));
  const still = await req(MF + '/questions/' + qid, { token: AT });
  log(still.code === 0 && still.data.question && still.data.question.id === qid, '题库管理里仍能取到这道题');
  log(fs.existsSync(store.localPath(img.data.key)) && fs.existsSync(store.localPath(aud.data.key)), '题目图片 / 音频文件也还在存储里');
  // 批量删除同样只解绑
  const vup2 = await req('/api/admin/videos', { method: 'POST', token: AT, form: (() => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('fake-mp4-2')], { type: 'video/mp4' }), 'v2.mp4'); fd.append('title', TAG + '视频B' + uniq); fd.append('chapter_id', String(ch.data.id)); fd.append('level', 'basic'); fd.append('url', ''); return fd; })() });
  const vid2 = vup2.data && vup2.data.id;
  await req(`/api/admin/bank/videos/${vid2}/bind`, { method: 'POST', token: AT, body: { ids: [qid] } });
  const del2 = await req('/api/admin/videos/batch', { method: 'DELETE', token: AT, body: { ids: [vid2], pwd: '199856' } });
  const after2 = db.prepare('SELECT video_id FROM questions WHERE id=?').get(qid);
  log(del2.code === 0 && !!after2 && after2.video_id === null, '批量删除视频：题目同样保留并解绑', del2.msg);

  cleanup();
  const left = db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE '${TAG}%'`).get().n;
  log(Number(left) === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
