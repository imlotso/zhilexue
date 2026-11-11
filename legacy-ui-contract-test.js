'use strict';
/** Shared DOM readers for the legacy acceptance suites, plus offline tests of
 * the real current renderers. No database, server, browser or AI is started. */
function readCourseMetrics(doc = document) {
  const text = (selector) => {
    const el = doc.querySelector(selector);
    if (!el) throw new Error('Missing course metric: ' + selector);
    return el.textContent.replace(/\s+/g, ' ').trim();
  };
  return {
    learned: text('.round-course-summary > div > span'),
    accuracy: text('.round-course-summary .r8-hs > span'),
    answered: text('.round-course-summary .r8-hs > em'),
    nextTitle: text('.round-video-stage h2'),
    lessonStats: [...doc.querySelectorAll('.round-lesson-stats > div')].map(el => el.textContent.replace(/\s+/g, ' ').trim()),
  };
}

function readReportSections(doc = document) {
  const headings = [...doc.querySelectorAll('.r1-sec > h4')];
  const section = (title) => {
    const heading = headings.find(h => h.textContent.replace(/^\s*\d+/, '').trim().startsWith(title));
    if (!heading || !heading.nextElementSibling) throw new Error('Missing report section: ' + title);
    return heading.nextElementSibling;
  };
  return {
    headings: headings.map(h => h.textContent.replace(/\s+/g, ' ').trim()),
    paperText: section('试卷成绩').textContent.replace(/\s+/g, ' ').trim(),
    recordCount: section('最近作答').querySelectorAll('tbody tr').length,
    subjectiveText: section('主观题作答').textContent.replace(/\s+/g, ' ').trim(),
    gradeIds: [...section('主观题作答').querySelectorAll('[data-subjective-grade]')].map(b => b.dataset.subjectiveGrade),
  };
}

module.exports = { readCourseMetrics, readReportSections };

if (require.main === module) {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { JSDOM } = require('jsdom');
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  function dom(t, url = 'https://synthetic.test/admin/#/pending') {
    const f = new JSDOM('<main id="app"></main>', { url, runScripts: 'outside-only' });
    t.after(() => f.window.close());
    f.window.fetch = () => { throw new Error('Offline fixture must not fetch'); };
    Object.assign(f.window, { esc, ic: () => '', toast: () => {}, Auth: { token: 'synthetic-only', user: { id: 1, role: 'admin', grade: '七年级' } } });
    return f.window;
  }
  function loadModal(w) {
    const source = read('public/admin/admin.js');
    const start = source.indexOf('function modal(');
    w.eval(source.slice(start, source.indexOf('\n/**', start)));
  }
  async function courseFixture(t) {
    const w = dom(t, 'https://synthetic.test/#/course/9');
    let app;
    Object.assign(w, { canPreview: () => false, fileKind: () => ({}), fmtSize: () => '', Vue: { createApp(value) { app = value; return { mount() {} }; } } });
    w.eval(read('public/js/vue-app.js'));
    w.eval(read('public/vendor/vue.global.prod.js'));
    const lessons = [
      { video_id: 21, title: '已学视频', done: true, qcount: 2, acc: { total: 2, answered: 2, correct: 1, rate: 50 }, nodes: [{ id: 41, name: '有理数' }, { id: 42, name: '数与式' }] },
      { video_id: 22, title: '继续学习视频', done: false, qcount: 1, acc: { total: 1, answered: 1, correct: 1, rate: 100 }, nodes: [] },
    ];
    const course = { id: 9, name: '合成课程', subject: '数学', category: '同步基础', grouped: true, kp_done: 1, kp_total: 3, percent: 33, next: { video_id: 22, title: '继续学习视频', group_id: 11 }, acc: { total: 7, answered: 5, correct: 3, rate: 60 }, groups: [
      { id: 11, name: '小分组甲', practice_count: 5, kp_done: 1, kp_total: 2, acc: { total: 5, answered: 5, correct: 3, rate: 60 }, lessons },
      { id: 12, name: '小分组乙', practice_count: 2, kp_done: 0, kp_total: 1, acc: { total: 2, answered: 0, correct: 0, rate: null }, lessons: [{ video_id: 23, title: '另一视频', done: false, qcount: 1, nodes: [] }] },
    ] };
    const calls = [], quizzes = [];
    w.BankQuiz = { open: value => quizzes.push(value) };
    w.api = async url => {
      calls.push(url);
      if (url === '/api/stu/bank/section-questions?section_id=11') return { list: [1, 2, 3, 4, 5].map(id => ({ id, type: 'single', stem: '合成题' + id })) };
      if (url === '/api/stu/bank/lesson-questions?video_id=21') return { list: [{ id: 1, type: 'single', stem: '视频题' }] };
      throw new Error('Unexpected offline course API: ' + url);
    };
    // Disable only page boot/navigation lifecycle. Render the complete production
    // template with its real computed properties, selection and quiz handlers.
    const options = { ...app, mounted: undefined, beforeUnmount: undefined, watch: {}, data: () => ({ ...app.data(), page: 'course', course, courseId: 9, activeGroupId: 11, subject: '数学', category: '同步基础' }) };
    const vue = w.Vue.createApp(options), state = vue.mount('#app');
    t.after(() => vue.unmount());
    await w.Vue.nextTick();
    return { w, d: w.document, state, calls, quizzes };
  }
  test('course metrics, current lesson selection and group practice use real rounded controls', async t => {
    const f = await courseFixture(t);
    assert.deepEqual(readCourseMetrics(f.d), { learned: '已学 1 / 3 课', accuracy: '课程正确率 60%', answered: '已做 5 / 7 题', nextTitle: '继续学习视频', lessonStats: ['学习进度未开始', '配套习题1 题', '习题正确率100%'] });
    assert.equal(f.d.querySelector('.round-course-group.on .round-group-actions span').textContent, '正确率 60%');
    f.d.querySelector('.round-course-group.on .round-lesson-select').click();
    await f.w.Vue.nextTick();
    assert.deepEqual(readCourseMetrics(f.d).lessonStats, ['学习进度已学完', '配套习题2 题', '习题正确率50%']);
    assert.deepEqual([...f.d.querySelectorAll('.r8-ktag')].map(el => el.textContent), ['有理数', '数与式']);
    const groupButton = [...f.d.querySelectorAll('.round-course-group.on .round-group-actions button')].find(b => b.textContent === '分组练习');
    groupButton.click(); await tick();
    assert.deepEqual(f.calls, ['/api/stu/bank/section-questions?section_id=11']);
    assert.equal(f.quizzes[0].title, '小分组甲 · 小分组练习');
    assert.equal(f.quizzes[0].questions.length, 5);
    f.d.querySelector('.round-practice-banner button').click(); await tick();
    assert.equal(f.calls.at(-1), '/api/stu/bank/lesson-questions?video_id=21');
    assert.equal(f.quizzes[1].title, '已学视频 · 做练习');
    assert.equal(f.quizzes[1].questions[0].id, 1);
    f.state.page = 'courses'; f.state.courses = [f.state.course]; await f.w.Vue.nextTick();
    assert.equal(f.d.querySelector('.st-card .fb-top b').textContent, '1 / 3');
    assert.equal(f.d.querySelector('.st-card .pbar i').style.width, '33%');
    assert.equal(f.d.querySelector('.st-card .r8-sc-acc b').textContent, '60%');
  });

  for (const desktop of [true, false]) test((desktop ? 'desktop dock' : 'mobile launcher') + ' gates real quiz AI until checking and preserves reopen/navigation', async t => {
    const w = dom(t, 'https://synthetic.test/'), requests = [];
    Object.assign(w, { TextDecoder, matchMedia: () => ({ matches: desktop }), requestAnimationFrame: fn => { fn(); return 0; }, cancelAnimationFrame: () => {} });
    w.HTMLElement.prototype.scrollTo = () => {};
    w.eval(read('public/js/api.js'));
    w.api = async (url, options) => {
      assert.equal(url, '/api/stu/bank/check');
      return { list: options.body.items.map(item => ({ question_id: item.question_id, is_correct: false, answer: 'A', analysis: '合成解析' })) };
    };
    w.fetch = async (url, options) => {
      assert.equal(url, '/api/stu/bank/ai-explain/stream');
      requests.push(JSON.parse(options.body));
      let sent = false;
      return { headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode('data: {"t":"delta","text":"合成讲解"}\n\ndata: {"t":"done"}\n\n') }) }) } };
    };
    w.eval(read('public/js/bank.js'));
    const handle = w.BankQuiz.open({ mode: 'step', title: '合成练习', questions: [{ id: 1, type: 'single', stem: '第一题', options: ['甲', '乙'], quiz_ticket: 'synthetic-1' }, { id: 2, type: 'single', stem: '第二题', options: ['甲', '乙'], quiz_ticket: 'synthetic-2' }] });
    const d = w.document;
    assert.equal(d.querySelector('#qzAiFab').hidden, true);
    assert.equal(requests.length, 0);
    if (desktop) {
      assert.ok(d.querySelector('#qzAiDock .r8-ai.rounded-awaiting-answer'));
      assert.equal(d.querySelector('.r8-ai-in textarea').disabled, true);
      assert.equal(d.querySelector('[data-start]'), null);
    } else assert.equal(d.querySelector('.r8-ai'), null);
    d.querySelectorAll('.qz-opt')[1].click(); await d.querySelector('#qzCheckOne').onclick();
    assert.ok(d.querySelector('.qz-opt.r8-wrong'));
    if (desktop) {
      assert.equal(d.querySelector('.r8-ai-in textarea').disabled, false);
      assert.equal(requests.length, 0);
      d.querySelector('#qzAiDock [data-start]').click();
    } else {
      assert.equal(d.querySelector('#qzAiFab').hidden, false);
      assert.equal(d.querySelector('#qzAiFab').classList.contains('hot'), true);
      d.querySelector('#qzAiFab').click();
    }
    await tick();
    assert.equal(requests.length, 1); assert.equal(requests[0].question_id, 1); assert.equal(requests[0].quiz_ticket, 'synthetic-1');
    assert.match(d.querySelector('.r8-msg.bot').textContent, /合成讲解/);
    d.querySelector('.r8-ai [data-act="min"]').click();
    assert.equal(d.querySelector('.r8-ai-pill').hidden, false);
    d.querySelector('.r8-ai-pill').click();
    d.querySelector('#qzGoNext').click();
    assert.match(d.querySelector('#r8AiQ').textContent, /第 2 题/);
    assert.equal(d.querySelector('.r8-ai-in textarea').disabled, true); assert.equal(requests.length, 1);
    handle.close(); assert.equal(d.querySelector('.quiz-mask'), null);
  });

  async function reportFixture(t) {
    const w = dom(t, 'https://synthetic.test/admin/#/xreport'), calls = [];
    const det = { student: { id: 5, name: '合成学生', username: 'fixture' }, subjects: [{ subject: '数学', n: 4, correct: 3 }], papers: [{ title: '单元测验', score: 75, total_score: 100, correct: 3, total: 4 }], rows: [{ type: 'single', subject: '数学', stem: '客观作答', is_correct: 1 }, { type: 'fill', subject: '数学', stem: '另一作答', is_correct: 0 }], subjective: [{ id: 71, type: 'answer', stem: '人工评分题', my_answer: '解答过程', max_score: 20, score: null }] };
    Object.assign(w, { SUBJECTS: ['数学'], expTag: () => '', api: async (url, options) => {
      if (url === '/api/admin/xreport/exercises/5/detail') return det;
      if (url === '/api/admin/bank/accuracy?user_id=5') return { courses: [], acc: { total: 4, answered: 4, correct: 3, rate: 75 } };
      calls.push({ url, options: JSON.parse(JSON.stringify(options)) }); return {};
    } });
    loadModal(w); w.eval(read('public/admin/reportui.js')); await w.r1OpenDrawer(5);
    return { w, d: w.document, calls };
  }
  test('report table readers survive the rounded grid and distinguish recent records from grading rows', async t => {
    const f = await reportFixture(t), actual = readReportSections(f.d);
    assert.equal(actual.headings.length, 5);
    assert.match(actual.headings[1], /知识点与小分组/);
    assert.match(actual.paperText, /单元测验.*75 \/ 100.*3 \/ 4 题/);
    assert.equal(actual.recordCount, 2);
    assert.deepEqual(actual.gradeIds, ['71']);
    assert.match(actual.subjectiveText, /人工评分题.*未评分/);
    f.d.querySelector('[data-subjective-grade="71"]').click();
    f.d.querySelector('#r1SubjScore').value = '21'; await f.d.querySelector('#mOk').onclick();
    assert.equal(f.calls.length, 0); assert.match(f.d.querySelector('#mErr').textContent, /0 至 20/);
    f.d.querySelector('#r1SubjScore').value = '16'; f.d.querySelector('#r1SubjComment').value = '计算完整';
    await f.d.querySelector('#mOk').onclick();
    assert.deepEqual(f.calls, [{ url: '/api/admin/xreport/subjective/71/grade', options: { method: 'POST', body: { score: 16, comment: '计算完整' } } }]);
  });

  async function pendingFixture(t, flags = {}) {
    const w = dom(t), calls = [], messages = [];
    const row = { id: 'run:1:0:12345678', edit_signature: 'synthetic-snapshot', kind: 'run', index: 0, batch_id: 1, source: 'word', source_label: 'Word导入', type: 'answer', type_name: '解答题', subject: '', stage: '', grade: '', point: '', stem: '合成规则解析题', answer: '1', analysis: '', images: [], options: [], tags: [], ...flags };
    Object.assign(w, { ADM: { page: { pd: { source: 'all', sel: {} } }, chapters: [] }, mtxTypeset: () => {}, bindPager: () => {}, pagerHTML: () => '', tpTrees: async () => [], optText: o => typeof o === 'string' ? o : o.text || o.content || '', optDisplay: o => String(o), toast: message => messages.push(message), render: () => {}, api: async (url, options) => {
      if (url.startsWith('/api/admin/bank/mf/ext/pending?')) return { page: 1, size: 20, total: 1, list: [row] };
      calls.push({ url, options: JSON.parse(JSON.stringify(options)) });
      return { committed: 1, failed: [] };
    } });
    loadModal(w); w.eval(read('public/admin/pendingui.js'));
    const view = await w.viewPending(); w.document.querySelector('#app').innerHTML = view.html; view.after();
    return { w, d: w.document, calls, messages };
  }
  test('current pending action opens real classification validation before committing the selected card', async t => {
    const f = await pendingFixture(t), button = f.d.querySelector('#pd-current-commit');
    assert.equal(button.disabled, false); button.click(); await tick();
    assert.equal(f.d.querySelector('.el-dialog__title').textContent, '确认所选题入库');
    assert.equal(f.d.querySelectorAll('#pdB-sub,#pdB-stage,#pdB-grade,#pdB-ktree,#pdB-ctree').length, 5);
    await f.d.querySelector('#mOk').onclick(); assert.equal(f.calls.length, 0); assert.match(f.messages.at(-1), /请先选择学科/);
    f.d.querySelector('#pdB-sub').value = '数学'; await f.d.querySelector('#mOk').onclick();
    assert.equal(f.calls.length, 0); assert.match(f.messages.at(-1), /请先选择学段/);
    f.d.querySelector('#pdB-stage').value = 'junior'; await f.d.querySelector('#mOk').onclick();
    assert.deepEqual(f.calls, [{ url: '/api/admin/bank/mf/ext/pending/commit', options: { method: 'POST', body: { ids: ['run:1:0:12345678'], items: [{ id: 'run:1:0:12345678', expected: 'synthetic-snapshot' }], detailed: true, subject: '数学', stage: 'junior', grade: '', node_ids: [], tags: [] } } }]);
    assert.equal(f.d.querySelector('#pdB-sub'), null);
  });
  for (const [name, flags, hint] of [
    ['content', { content_review_required: true, content_review_pending: true }, /对照原页/],
    ['type', { type_unconfirmed: true }, /对照原页/],
    ['missing figures', { figure_missing: ['图1'] }, /补齐/],
    ['figure ownership', { figure_review_required: true, figure_review_issue: '待确认' }, /图文归属/],
    ['AI answer', { ai_review_pending_fields: ['answer'] }, /AI/],
  ]) test('current pending action cannot bypass ' + name + ' review', async t => {
    const f = await pendingFixture(t, flags), button = f.d.querySelector('#pd-current-commit');
    assert.equal(button.disabled, true); assert.match(f.d.querySelector('#pd-commit-hint').textContent, hint);
    button.click(); button.onclick(); await tick();
    assert.equal(f.d.querySelector('#pdB-sub'), null); assert.deepEqual(f.calls, []);
  });
}
