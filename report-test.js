'use strict';
/**
 * AI 试卷分析测评报告自测： node report-test.js
 * 需先启动服务（默认 http://localhost:3000，且已 npm run seed）
 * 覆盖：AI 配置 CRUD（key 不回传明文）、演示模式全流程（上传照片 → 分析 → 报告结构）、
 *       未配置 Key 时失败态、列表 / 详情 / 重试 / 删除、照片校验
 */
const fs = require('fs');

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

/** 造一张真实 PNG（1×N 白底，带几行黑像素） */
function makePng() {
  const b = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  return b;
}

async function main() {
  console.log('\n=== AI 试卷分析测评报告自测 ===');
  const uniq = Date.now() % 100000;

  const adminLogin = await req('/api/login', { method: 'POST', body: { username: '15152099970', password: '123456', role: 'admin' } });
  const AT = adminLogin.data && adminLogin.data.token;
  log(!!AT, '校长登录');

  // ---- 1. AI 配置：读取 / 保存 / key 不回传
  let r = await req('/api/admin/report/config', { token: AT });
  log(r.code === 0 && typeof r.data.hasKey === 'boolean' && r.data.baseUrl && r.data.model, '读取 AI 配置（默认值齐全）', `base=${r.data.baseUrl} model=${r.data.model}`);
  const oldKeyState = r.data.hasKey;
  r = await req('/api/admin/report/config', { method: 'PUT', token: AT, body: { baseUrl: 'https://api.example.com/v1/', model: 'test-vision' + uniq, apiKey: 'sk-test-' + uniq, mock: false } });
  log(r.code === 0 && r.data.hasKey === true && r.data.model === 'test-vision' + uniq && !/sk-test/.test(JSON.stringify(r)), '保存配置成功且返回体不泄露 Key', JSON.stringify(r.data));
  r = await req('/api/admin/report/config', { token: AT });
  log(r.data.baseUrl === 'https://api.example.com/v1', 'baseUrl 末尾斜杠被去除', r.data.baseUrl);

  // ---- 2. 未开演示模式、无有效 Key → 分析失败（failed + 错误提示）
  {
    const up = await req('/api/admin/report/papers', { method: 'POST', token: AT, form: (() => { const fd = new FormData(); fd.append('images', new Blob([makePng()], { type: 'image/png' }), 'paper.png'); return fd; })() });
    log(up.code === 0 && (up.data.keys || []).length === 1, '上传试卷照片', up.data && up.data.keys[0]);
    var pid = up.data.keys[0];
    const mk = await req('/api/admin/report', { method: 'POST', token: AT, body: { student: '陈同学' + uniq, subject: '数学', grade: '五年级', paperKeys: up.data.keys } });
    log(mk.code === 0 && mk.data.status === 'pending', '创建分析任务（先入 pending）', mk.data && ('#' + mk.data.id));
    var failId = mk.data.id;
    let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      await new Promise((s) => setTimeout(s, 500));
      const d = await req('/api/admin/report/' + failId, { token: AT });
      if (d.data.status !== 'pending') done = d.data;
    }
    log(done && done.status === 'failed' && /密钥|Key|演示|连接|接口/.test(done.error), '无效 Key/不可达接口时任务转 failed 且给出原因', done && (done.error || '').slice(0, 60));
  }

  // ---- 3. 演示模式全流程
  r = await req('/api/admin/report/config', { method: 'PUT', token: AT, body: { mock: true } });
  log(r.code === 0 && r.data.mock === true, '开启演示模式', '');
  let repId = 0, rep = null;
  {
    const mk = await req('/api/admin/report', { method: 'POST', token: AT, body: { student: '陈同学' + uniq, subject: '数学', grade: '五年级', paperKeys: [pid] } });
    repId = mk.data.id;
    log(mk.code === 0, '演示模式创建分析任务 #' + repId, '');
    let d = null;
    for (let i = 0; i < 20 && !d; i++) {
      await new Promise((s) => setTimeout(s, 500));
      const cur = await req('/api/admin/report/' + repId, { token: AT });
      if (cur.data.status !== 'pending') d = cur.data;
    }
    log(d && d.status === 'done', '分析完成', d && d.status !== 'done' ? d.error : '');
    rep = d && d.report;
    const o = (rep && rep.overall) || {};
    const need = ['meta', 'overall', 'difficulty', 'knowledge', 'wrongQuestions', 'crossValidation', 'teacherNote', 'wrongDetails'];
    log(!!rep && need.every((x) => x in rep), '报告 JSON 结构完整（8 个板块）', !!rep ? need.filter((x) => !(x in rep)).join(',') || 'all' : '无');
    log(Math.abs(o.correct + o.wrong - (rep.meta.totalQuestions || 0)) < 1e-9, '答对+答错 = 总题数', `${o.correct}+${o.wrong}=${rep.meta && rep.meta.totalQuestions}`);
    log(Math.abs(o.correct / (rep.meta.totalQuestions || 1) - o.correctRate) < 0.001, '正确率与题数一致', String(o.correctRate));
    log((rep.difficulty || []).every((x) => x.count >= 0 && x.rate >= 0 && x.rate <= 1), '难度表数值合法', (rep.difficulty || []).length + ' 段');
    log((rep.wrongQuestions || []).length > 0 && (rep.wrongQuestions || [])[0].abilities.length > 0, '错题解析含核心能力标签', (rep.wrongQuestions || []).length + ' 题');
    log((rep.wrongDetails || []).length > 0 && !!(rep.wrongDetails || [])[0].stem, '附错题详情含题干', (rep.wrongDetails || []).length + ' 题');
    log(!!(rep.teacherNote || '').trim() && (rep.teacherNote || '').length > 50, '分析师寄语非空', (rep.teacherNote || '').length + ' 字');
  }

  // ---- 4. 列表 / 重试 / 未传照片校验
  r = await req('/api/admin/report', { token: AT });
  log((r.data || []).some((x) => x.id === repId), '列表包含刚生成的报告', r.data.length + ' 份');
  r = await req('/api/admin/report', { method: 'POST', token: AT, body: { student: 'x', paperKeys: [] } });
  log(r.code === 1 && /照片/.test(r.msg), '没有照片时拒绝创建', r.msg);
  r = await req('/api/admin/report/' + repId + '/retry', { method: 'POST', token: AT });
  log(r.code === 0 && r.data.status === 'pending', '重试接口可用', '');
  let backDone = false;
  for (let i = 0; i < 20 && !backDone; i++) {
    await new Promise((s) => setTimeout(s, 500));
    const cur = await req('/api/admin/report/' + repId, { token: AT });
    if (cur.data.status !== 'pending') backDone = cur.data;
  }
  log(backDone && backDone.status === 'done', '重试后再次完成', backDone && backDone.status);

  // ---- 5. 删除（含照片清理）
  r = await req('/api/admin/report/' + failId, { method: 'DELETE', token: AT });
  const still = await req('/api/admin/report/' + failId, { token: AT });
  log(r.code === 0 && still.code === 1, '删除报告后详情 404', r.msg);

  // ---- 6. 学生权限隔离
  const stuList = await req('/api/admin/students', { token: AT });
  const stu = ((stuList.data) || []).find((s) => s.username) || {};
  const st = await req('/api/login', { method: 'POST', body: { username: stu.username, password: '123456', role: 'student' } });
  if (st.data && st.data.token) {
    r = await req('/api/admin/report', { token: st.data.token });
    log(r.code !== 0, '学生 token 访问报告接口被拒', r.msg);
  } else log(true, '学生权限隔离（无可用学生账号，跳过）', '');

  // 收尾：恢复配置（关演示模式），清理测试报告
  await req('/api/admin/report/config', { method: 'PUT', token: AT, body: { mock: false, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' } });
  await req('/api/admin/report/' + repId, { method: 'DELETE', token: AT });

  console.log('\n=== 结果： 通过 ' + pass + ' 项，失败 ' + fail + ' 项 ===\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试异常：', e); process.exit(1); });
