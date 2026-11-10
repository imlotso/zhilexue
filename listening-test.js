'use strict';
/**
 * 听力题（T7）自测： node listening-test.js
 * 需先启动服务（默认 http://localhost:3000，建议 TTS_MOCK=1 STORAGE_DRIVER=local）并 npm run seed；直连同一个 MySQL 造学生 / 题目，结束后清理。
 * 覆盖：后台上传音频 / 生成朗读 → 题目带音频（存 key，目录 bank/audio/）→ 编辑不丢音频 / 可去掉 / 乱填的 key 被拒 →
 *       待审核页逐题补音频 → 入库 → 学生端题目带播放地址、能真的取到音频字节（含 Range）→ 作答判分、错题本里也带音频。
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./src/db');
const { hash } = require('./src/auth');

const BASE = process.env.BASE || 'http://localhost:3000';
const MF = '/api/admin/bank/mf';
let pass = 0, fail = 0;
const log = (c, name, extra = '') => { console.log(`  ${c ? '✅' : '❌'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
async function req(p, { method = 'GET', body, token, form, raw, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; else if (body) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  if (raw) return res;
  const j = await res.json(); j._status = res.status; return j;
}
/** 生成一段有效的 wav（0.5 秒 440Hz） */
function wav() {
  const rate = 8000, n = 4000; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
  return b;
}
const uniq = Date.now().toString().slice(-8);
const TAG = 'T7听力测试';
const WAV = wav();
const made = { users: [], keys: [] };
const audioForm = (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); return fd; };

function cleanup() {
  db.prepare(`SELECT id FROM questions WHERE stem LIKE '${TAG}%'`).all().forEach((q) => {
    ['mistakes', 'records', 'question_tags', 'question_nodes', 'mf_paper_questions'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE question_id=?`).run(q.id); } catch (e) { /* ignore */ } });
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
  });
  db.prepare("SELECT id FROM mf_papers WHERE title LIKE 'T7听力测试%'").all().forEach((p) => { db.prepare('DELETE FROM mf_paper_questions WHERE paper_id=?').run(p.id); db.prepare('DELETE FROM mf_paper_tries WHERE paper_id=?').run(p.id); db.prepare('DELETE FROM mf_papers WHERE id=?').run(p.id); });
  db.prepare("SELECT id FROM mf_recog_runs WHERE title LIKE 'Word导入 T7%'").all().forEach((r) => db.prepare('DELETE FROM mf_recog_runs WHERE id=?').run(r.id));
  made.users.forEach((id) => { ['mistakes', 'records', 'practices', 'mf_paper_tries'].forEach((t) => { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch (e) { /* ignore */ } }); db.prepare('DELETE FROM users WHERE id=?').run(id); });
  made.keys.forEach((k) => { try { fs.unlinkSync(require('./src/storage').localPath(k)); } catch (e) { /* ignore */ } });
}

(async () => {
  console.log('\n=== 听力题（T7）· 自测 ===\n');
  cleanup();
  const login = async (u, role) => (await req('/api/login', { method: 'POST', body: { username: u, password: '123456', role } })).data.token;
  const AT = await login('zlx-ci-admin', 'admin');
  const sid = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,'T7学生','七年级','上册',1,1,'2099-12-31',1,'2026-11-02')").run('t7s' + uniq, hash('123456')).lastInsertRowid; made.users.push(sid);
  const ST = await login('t7s' + uniq, 'student');
  log(!!AT && !!ST, '管理员和测试学生登录');

  // ---------- 1) 后台：上传音频 / 生成朗读 ----------
  const up = await req(MF + '/audio/upload', { method: 'POST', token: AT, form: audioForm(WAV, '听力材料1.wav') });
  if (up.data) made.keys.push(up.data.key);
  log(up.code === 0 && /^bank\/audio\//.test(up.data.key) && /\.wav$/.test(up.data.key) && up.data.name === '听力材料1.wav', '上传音频：存到题库音频目录 bank/audio/（T12 的目录前缀），返回 key 和播放地址', up.data && up.data.key);
  const bad = await req(MF + '/audio/upload', { method: 'POST', token: AT, form: audioForm(Buffer.from('x'), '恶意.exe') });
  log(bad.code !== 0 && /仅支持/.test(bad.msg), '不是音频文件：拒绝', bad.msg);
  const noF = await req(MF + '/audio/upload', { method: 'POST', token: AT, form: new FormData() });
  log(noF.code !== 0 && /请选择/.test(noF.msg), '没选文件：提示');
  const tts = await req(MF + '/audio/tts', { method: 'POST', token: AT, body: { text: 'Listen and choose the right answer.', lang: 'en' } });
  if (tts.data) made.keys.push(tts.data.key);
  log(tts.code === 0 && /^bank\/audio\//.test(tts.data.key) && tts.data.size > 100, '文字生成朗读（TTS）：生成并存到 bank/audio/', tts.msg);
  const ttsEmpty = await req(MF + '/audio/tts', { method: 'POST', token: AT, body: { text: '   ' } });
  log(ttsEmpty.code !== 0 && /请先填写/.test(ttsEmpty.msg), 'TTS 没填文字：提示');
  const sUp = await req(MF + '/audio/upload', { method: 'POST', token: ST, form: audioForm(WAV, 'a.wav') });
  const sTts = await req(MF + '/audio/tts', { method: 'POST', token: ST, body: { text: 'hi' } });
  log((sUp._status === 403 || sUp.code !== 0) && (sTts._status === 403 || sTts.code !== 0), '学生 token 不能上传音频 / 生成朗读');

  // ---------- 2) 创建带音频的听力选择题 ----------
  const mkQ = await req(MF + '/questions', { method: 'POST', token: AT, body: {
    type: 'single', subject: '英语', stage: 'junior', grade: '七年级', stem: TAG + ' 听对话，选择正确答案：What does the boy want?',
    options: [{ label: 'A', text: 'A pen' }, { label: 'B', text: 'A book' }, { label: 'C', text: 'A cup' }], answer: 'B', analysis: '男孩说他想要一本书。', audio_key: up.data.key, audio_play_limit: 2,
  } });
  const qid = mkQ.data && mkQ.data.id;
  log(mkQ.code === 0 && qid, '后台创建一道带音频的听力选择题', mkQ.msg);
  const g1 = await req(MF + '/questions/' + qid, { token: AT });
  log(g1.code === 0 && g1.data.question.audio_key === up.data.key && /\/api\/file\?key=/.test(g1.data.question.audio_url), '读回来：audio_key 是存储 key，audio_url 是播放地址', g1.data.question.audio_url);
  log(g1.data.question.audio_play_limit === 2, '新增时保存听力播放次数');
  const dbq = db.prepare('SELECT audio_key, type FROM questions WHERE id=?').get(qid);
  log(dbq.audio_key === up.data.key && dbq.type === 'single', '题型没有新增：仍是 single，音频只是附加的听力材料（questions.audio_key）');

  // 编辑不丢音频 / 可换 / 可去掉 / 乱填被拒
  const put1 = await req(MF + '/questions/' + qid, { method: 'PUT', token: AT, body: { type: 'single', stem: TAG + ' 听对话（改）', options: ['A pen', 'A book'], answer: 'B', subject: '英语' } });
  log(put1.code === 0 && db.prepare('SELECT audio_key FROM questions WHERE id=?').get(qid).audio_key === up.data.key, '编辑题目时不传 audio_key：音频保留（老的编辑入口不会把音频弄丢）');
  log(db.prepare('SELECT audio_play_limit FROM questions WHERE id=?').get(qid).audio_play_limit === 2, '旧编辑入口不传播放次数时保留原设置');
  const put2 = await req(MF + '/questions/' + qid, { method: 'PUT', token: AT, body: { type: 'single', stem: TAG + ' 听对话（改）', options: ['A pen', 'A book'], answer: 'B', subject: '英语', audio_key: tts.data.key } });
  log(put2.code === 0 && db.prepare('SELECT audio_key FROM questions WHERE id=?').get(qid).audio_key === tts.data.key, '换一段音频（改成 TTS 生成的）');
  const put3 = await req(MF + '/questions/' + qid, { method: 'PUT', token: AT, body: { type: 'single', stem: TAG + ' 听对话（改）', options: ['A pen', 'A book'], answer: 'B', subject: '英语', audio_key: 'videos/202611/abc.mp4' } });
  log(put3.code === 0 && db.prepare('SELECT audio_key FROM questions WHERE id=?').get(qid).audio_key === '', '音频 key 指到别的目录（如 videos/）：不认，当作没有音频（题目不能被指到视频文件上）');
  const put4 = await req(MF + '/questions/' + qid, { method: 'PUT', token: AT, body: { type: 'single', stem: TAG + ' 听对话（改）', options: ['A pen', 'A book'], answer: 'B', subject: '英语', audio_key: 'bank/audio/../../etc/passwd' } });
  log(put4.code === 0 && db.prepare('SELECT audio_key FROM questions WHERE id=?').get(qid).audio_key === '', '带 .. 的 key：不认');
  await req(MF + '/questions/' + qid, { method: 'PUT', token: AT, body: { type: 'single', stem: TAG + ' 听对话 What does the boy want?', options: ['A pen', 'A book', 'A cup'], answer: 'B', analysis: '男孩说他想要一本书。', subject: '英语', audio_key: up.data.key } });
  log(db.prepare('SELECT audio_key FROM questions WHERE id=?').get(qid).audio_key === up.data.key, '改回原来的音频');

  // ---------- 3) 待审核页逐题补音频（Excel / Word 模板不改） ----------
  const docx = fs.readFileSync(path.join(__dirname, 'docs', '原始需求', '洋葱题库-样例.docx'));
  const fd = new FormData(); fd.append('file', new Blob([docx]), 'T7听力样例.docx'); fd.append('subject', '英语');
  const imp = await req(MF + '/ext/import-word', { method: 'POST', token: AT, form: fd });
  log(imp.code === 0 && imp.data.run_id, 'Word 导入（模板没改）→ 进待审核', imp.msg);
  const pend = await req(MF + '/ext/pending?size=100', { token: AT });
  const it = (pend.data.list || []).find((x) => x.batch_id === imp.data.run_id && x.index === 0);
  log(!!it && it.audio_key === '' && it.audio_url === '', '待审核项带 audio_key / audio_url 字段（导入时没有音频）');
  const patch = await req(MF + '/ext/pending/item', { method: 'PUT', token: AT, body: { id: it.id, patch: { audio_key: up.data.key, audio_play_limit: 3 } } });
  log(patch.code === 0 && patch.data.audio_key === up.data.key && /\/api\/file\?key=/.test(patch.data.audio_url), '在待审核页给这道题补上音频', patch.msg);
  log(patch.data.audio_play_limit === 3, '待审核编辑可设置播放次数');
  const patchBad = await req(MF + '/ext/pending/item', { method: 'PUT', token: AT, body: { id: it.id, patch: { audio_key: 'videos/x.mp4' } } });
  log(patchBad.code === 0 && patchBad.data.audio_key === '', '待审核里乱填别的目录的 key：不认');
  await req(MF + '/ext/pending/item', { method: 'PUT', token: AT, body: { id: it.id, patch: { audio_key: up.data.key } } });
  const pend2 = await req(MF + '/ext/pending?size=100', { token: AT });
  const it2 = (pend2.data.list || []).find((x) => x.batch_id === imp.data.run_id && x.index === 0);
  const cm = await req(MF + '/ext/pending/commit', { method: 'POST', token: AT, body: { ids: [it2.id], subject: '英语', stage: 'junior', grade: '七年级' } });
  const committedQ = db.prepare("SELECT id, audio_key, audio_play_limit FROM questions WHERE audio_key=? AND id<>? ORDER BY id DESC LIMIT 1").get(up.data.key, qid);
  log(cm.code === 0 && committedQ && committedQ.audio_key === up.data.key, '逐题入库后，题库里的这道题带着音频', cm.msg);
  log(committedQ && committedQ.audio_play_limit === 3, '审核入库后保留播放次数');
  // 把入库的那些题（样例里其它题没入库，仍在待审核批次里）清掉
  if (committedQ) { db.prepare('DELETE FROM question_tags WHERE question_id=?').run(committedQ.id); db.prepare('DELETE FROM questions WHERE id=?').run(committedQ.id); }

  // ---------- 4) 学生端：题目带音频，能真的取到音频，作答判分 ----------
  const pap = await req(MF + '/papers', { method: 'POST', token: AT, body: { title: 'T7听力测试卷 ' + uniq, subject: '英语', stage: 'junior', grade: '七年级' } });
  const pid = pap.data.id;
  await req(MF + `/papers/${pid}/questions`, { method: 'POST', token: AT, body: { question_ids: [qid] } });
  await req(MF + '/papers/' + pid, { method: 'PUT', token: AT, body: { status: 'done', published: 1 } });
  const open = await req('/api/stu/bank/mfpapers/' + pid, { token: ST });
  const sq = open.data && open.data.questions[0];
  log(open.code === 0 && sq && sq.audio_url && sq.answer === undefined, '学生端打开试卷：题目带 audio_url，且不泄露答案', sq && sq.audio_url);
  const play = await req(sq.audio_url + (sq.audio_url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(ST), { raw: true });
  const bytes = Buffer.from(await play.arrayBuffer());
  log(play.status === 200 && /audio\/(wav|x-wav|wave)/.test(play.headers.get('content-type') || '') && bytes.equals(WAV), '学生端用播放地址（<audio> 的做法：登录票据放在 URL 上）能取到音频字节，Content-Type 是 audio/wav', play.headers.get('content-type'));
  const part = await req(sq.audio_url + '&token=' + encodeURIComponent(ST), { raw: true, headers: { Range: 'bytes=0-99' } });
  log(part.status === 206 && (await part.arrayBuffer()).byteLength === 100, '支持 Range（拖动进度条 / 手机边下边播要用）', 'HTTP ' + part.status);
  const noTok = await req(sq.audio_url, { raw: true });
  log(noTok.status === 401 || noTok.status === 403, '没有登录票据不能取音频', 'HTTP ' + noTok.status);
  const wrong = await req('/api/stu/bank/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: [{ question_id: qid, my_answer: 'A' }] } });
  log(wrong.code === 0 && wrong.data.correct === 0 && wrong.data.wrong === 1, '听力选择题作答判分（答错）');
  const mis = await req('/api/stu/bank/mistakes', { token: ST });
  const mq = (mis.data.list || []).find((x) => x.question_id === qid);
  log(!!mq && mq.audio_url && /\/api\/file\?key=/.test(mq.audio_url), '答错进错题本，错题本里的这道题也带着音频（可以重听）');
  const right = await req('/api/stu/bank/submit', { method: 'POST', token: ST, body: { kind: 'mfpaper', paper_id: pid, answers: [{ question_id: qid, my_answer: 'B' }] } });
  log(right.code === 0 && right.data.correct === 1 && right.data.wrong === 0, '听力选择题作答判分（答对）', right.msg);

  // ---------- 5) 前端：播放条 ----------
  const js = fs.readFileSync(path.join(__dirname, 'public/js/bank.js'), 'utf8');
  log(/<audio controls playsinline preload="none"/.test(js) && /t7-audio-err/.test(js) && /quizAudioHTML\(q\)/.test(js), '学生端题目上方有 <audio controls playsinline preload="none"> 播放条和加载失败提示');
  const adm = fs.readFileSync(path.join(__dirname, 'public/admin/audioui.js'), 'utf8');
  log(/上传音频/.test(adm) && /用文字生成朗读/.test(adm) && /mfui2/.test(fs.readFileSync(path.join(__dirname, 'public/admin/index.html'), 'utf8')) && /audioui\.js/.test(fs.readFileSync(path.join(__dirname, 'public/admin/index.html'), 'utf8')), '后台录题表单有「上传音频」「用文字生成朗读」，脚本已加载');

  cleanup();
  const left = db.prepare(`SELECT COUNT(*) n FROM questions WHERE stem LIKE '${TAG}%'`).get().n + db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 't7s%'").get().n;
  log(Number(left) === 0, '测试数据已清理');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); try { cleanup(); } catch (x) { /* ignore */ } process.exit(1); });
