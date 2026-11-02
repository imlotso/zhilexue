'use strict';
/**
 * 使用说明模块自测： node guide-test.js
 * 需先启动服务（默认 http://localhost:3000，且已 npm run seed）
 * 覆盖：上传（视频/文档）、中文文件名、列表排序、改标题/排序/显隐、学生端只看可见项、
 *       文件真实落盘（guidedocs 本地代理可读）、删除（含文件删除）、类型校验
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = (ok, name, extra = '') => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

async function req(p, { method = 'GET', body, token, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  if (raw) return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return { code: 0, _buffer: Buffer.from(await res.arrayBuffer()), _ct: ct };
}

function fdAdd(fd, name, value, file) {
  if (file) fd.append(name, file.blob, file.name);
  else if (value && value.blob) fd.append(name, value.blob, value.name); // 支持 fdAdd(fd, name, {blob, name}) 简写
  else fd.append(name, value);
}

async function main() {
  console.log('\n=== 使用说明模块自测 ===');
  const uniq = Date.now() % 100000;

  const adminLogin = await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } });
  const AT = adminLogin.data && adminLogin.data.token;
  log(!!AT, '校长登录');

  const stuLogin = await req('/api/login', { method: 'POST', body: { username: 'S' + uniq, password: 'x', role: 'student' } }).catch(() => null);
  const stuList = stuLogin && stuLogin.code === 0 ? null : await req('/api/admin/students', { token: AT });
  // 找一个已存在的学生（seed 数据），或临时建一个
  let stuName = '';
  const existing = (((stuList && stuList.data) || {}).list || []).find((s) => s.username);
  if (existing) stuName = existing.username;
  if (!stuName) {
    const c = await req('/api/admin/students', { method: 'POST', token: AT, body: { name: '说明测试学生' + uniq, username: 'G' + uniq, password: '123456', grade: '七年级' } });
    stuName = 'G' + uniq;
  }
  const st = await req('/api/login', { method: 'POST', body: { username: stuName, password: existing ? '123456' : '123456', role: 'student' } });
  const ST = st.data && st.data.token;
  log(!!ST, '学生登录（用于学生端接口）', stuName);

  // ---- 1. 初始列表可达
  let r = await req('/api/admin/guides', { token: AT });
  log(r.code === 0 && Array.isArray(r.data), '管理端列表接口可达', '现有 ' + r.data.length + ' 条');
  const before = r.data.length;

  // ---- 2. 未登录被拒
  r = await req('/api/admin/guides');
  log(r.code === 401, '未登录访问管理端接口被拒', r.msg);

  // ---- 3. 上传文档（中文文件名）
  {
    const fd = new FormData();
    fdAdd(fd, 'type', 'doc');
    fdAdd(fd, 'title', '平台使用图文指南' + uniq);
    fdAdd(fd, 'sort', '2');
    fdAdd(fd, 'file', { blob: new Blob([Buffer.from('# 使用说明\n先看视频再看本文。')], { type: 'text/markdown' }), name: '使用指南' + uniq + '.md' });
    r = await req('/api/admin/guides', { method: 'POST', token: AT, form: fd });
    log(r.code === 0 && r.data && r.data.type === 'doc', '上传文档成功', r.code === 0 ? `${r.data.title} / key=${r.data.file_key}` : r.msg);
    var docId = r.data.id;
    log(r.data.file_name === '使用指南' + uniq + '.md', '中文文件名不乱码', r.data.file_name);
    log(String(r.data.file_key).startsWith('guidedocs/'), '文档 key 落在 guidedocs/（本地目录）', r.data.file_key);
  }

  // ---- 4. 上传视频
  {
    const fd = new FormData();
    fdAdd(fd, 'type', 'video');
    fdAdd(fd, 'title', '如何观看课程视频' + uniq);
    fdAdd(fd, 'sort', '1');
    fdAdd(fd, 'duration', '95');
    fdAdd(fd, 'file', { blob: new Blob([Buffer.alloc(2048, 7)], { type: 'video/mp4' }), name: 'demo' + uniq + '.mp4' });
    r = await req('/api/admin/guides', { method: 'POST', token: AT, form: fd });
    log(r.code === 0 && r.data.type === 'video' && r.data.duration === 95, '上传视频成功（含时长回填）', r.code === 0 ? `${r.data.file_key} / ${r.data.duration}s` : r.msg);
    var vidId = r.data.id;
    log(String(r.data.file_key).startsWith('guides/'), '视频 key 落在 guides/（默认上七牛的目录）', r.data.file_key);
  }

  // ---- 5. 类型不匹配被拒（txt 冒充视频）
  {
    const fd = new FormData();
    fdAdd(fd, 'type', 'video');
    fdAdd(fd, 'file', { blob: new Blob([Buffer.from('不是视频')]), name: 'note.txt' });
    r = await req('/api/admin/guides', { method: 'POST', token: AT, form: fd });
    log(r.code === 1 && /不支持的文件类型/.test(r.msg), '类型校验：txt 冒充视频被拒', r.msg);
  }

  // ---- 6. 管理端列表：排序生效（sort=1 的视频在前）
  r = await req('/api/admin/guides', { token: AT });
  const video = (r.data || []).find((g) => g.id === vidId);
  const doc = (r.data || []).find((g) => g.id === docId);
  log(r.data.length === before + 2, '列表数量 +2', r.data.length + ' 条');
  log(video && doc && video.sort === 1 && doc.sort === 2, 'sort 字段保存正确', `video=${video && video.sort} doc=${doc && doc.sort}`);
  log(r.data.indexOf(video) < r.data.indexOf(doc), '列表按 sort 升序排列', '');

  // ---- 7. 文档内容真实可读（本地代理）
  {
    // 安全性：/api/file 必须登录才能访问（否则拿到 key 就能匿名下载全部付费资料）
    const anon = await req('/api/file?key=' + encodeURIComponent(doc.file_key), { raw: true });
    log(!anon.buf.toString('utf8').includes('先看视频再看本文'), '未登录访问 /api/file 拿不到文件内容', `${anon.buf.length} bytes`);
    const got = await req('/api/file?key=' + encodeURIComponent(doc.file_key), { raw: true, token: AT });
    log(got.buf.toString('utf8').includes('先看视频再看本文'), '文档内容可通过 /api/file 读取', `${got.buf.length} bytes`);
    // 路径穿越防护（用编码形式，避免 HTTP 客户端先把 .. 归一化掉）
    for (const bad of ['..%2F..%2Fdata%2Fxuexi.db', '%2e%2e%2f%2e%2e%2fdata%2f.secret', 'guidedocs%2F..%2F..%2Fdata%2F.secret', 'C%3A%5CWindows%5Cwin.ini']) {
      const r2 = await fetch(BASE + '/api/file?key=' + bad + '&token=' + encodeURIComponent(AT));
      log(r2.status === 400, '路径穿越被拒绝：' + bad, 'HTTP ' + r2.status);
    }
  }

  // ---- 8. 学生端：默认两条都可见
  r = await req('/api/stu/guides', { token: ST });
  const stuVideo = (r.data || []).find((g) => g.id === vidId);
  const stuDoc = (r.data || []).find((g) => g.id === docId);
  log(!!stuVideo && !!stuDoc, '学生端能看到刚上传的 2 条可见说明', '学生端共 ' + (r.data || []).length + ' 条');
  const stuField = stuDoc || (r.data || [])[0] || {};
  log(stuField.created_by === undefined, '学生端不泄露 created_by', '');

  // ---- 9. 隐藏视频 → 学生端只剩文档
  r = await req('/api/admin/guides/' + vidId, { method: 'PUT', token: AT, body: { visible: false } });
  log(r.code === 0 && r.data.visible === false, '管理端可设置「学生不可见」', '');
  r = await req('/api/stu/guides', { token: ST });
  log(!(r.data || []).some((g) => g.id === vidId) && !!((r.data || []).find((g) => g.id === docId)), '隐藏后学生端看不到该视频', '剩余 ' + (r.data || []).length + ' 条');

  // ---- 10. 改标题 / 排序 / 时长
  r = await req('/api/admin/guides/' + vidId, { method: 'PUT', token: AT, body: { title: '改名后的视频' + uniq, sort: 0, duration: 120 } });
  log(r.code === 0 && r.data.title === '改名后的视频' + uniq && r.data.sort === 0 && r.data.duration === 120, '标题/排序/时长可更新', r.data.title);

  // ---- 11. 学生不可访问管理端接口
  r = await req('/api/admin/guides', { token: ST });
  log(r.code !== 0, '学生 token 访问管理端接口被拒', r.msg);

  // ---- 12. 删除（含文件删除）
  const docKey = doc.file_key;
  r = await req('/api/admin/guides/' + docId, { method: 'DELETE', token: AT });
  log(r.code === 0, '删除文档条目', r.msg);
  r = await req('/api/admin/guides', { token: AT });
  log(!(r.data || []).some((g) => g.id === docId), '删除后列表不含该条目', '');
  const gone = await req('/api/file?key=' + encodeURIComponent(docKey), { raw: true, token: AT });
  log(!(gone.buf && gone.buf.length && String(gone.buf).includes('先看视频再看本文')), '删除后本地文件一并被删', '');

  // 收尾：清掉视频测试数据
  await req('/api/admin/guides/' + vidId, { method: 'DELETE', token: AT });

  console.log('\n=== 结果： 通过 ' + pass + ' 项，失败 ' + fail + ' 项 ===\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试异常：', e); process.exit(1); });
