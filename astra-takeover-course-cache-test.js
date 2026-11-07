'use strict';
// Execute the complete, unmodified public/js/vue-app.js in a VM, capturing App.
// Only api and BankQuiz UI boundaries are synthetic in-memory substitutes.
// No Vue mount, browser, login, token, network, DB, app/auth module or service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceFile = path.resolve(__dirname, 'public/js/vue-app.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const rate = (answered, correct) => ({total: 2, answered, correct, rate: answered ? Math.round(correct / answered * 100) : null});
let pass = 0, fail = 0;
const observations = [];

function fixture({ rejectSubmit = false } = {}) {
  let captured, quiz = null;
  let serverAcc = rate(0, 0);
  const calls = [];
  const sandbox = {
    canPreview() { throw new Error('unused canPreview must not execute'); },
    fileKind() { throw new Error('unused fileKind must not execute'); },
    fmtSize() { throw new Error('unused fmtSize must not execute'); },
    Vue: { createApp(app) { captured = app; return { mount(selector) { assert.equal(selector, '#app'); } }; } },
    BankQuiz: { open(options) { quiz = options; } },
    api: async (url, options) => {
      calls.push({ url, method: options?.method || 'GET', kind: options?.body?.kind || null });
      if (url.startsWith('/api/stu/courses?subject=')) {
        return [{id: 100, name: 'Synthetic course', subject: decodeURIComponent(url.split('subject=')[1]), category:'同步基础', acc: copy(serverAcc)}];
      }
      if (url === '/api/stu/course-detail?id=100') return { id:100, subject:'数学', grouped:false, groups:[], acc:copy(serverAcc) };
      if (url.startsWith('/api/stu/bank/section-questions?section_id=10')) return { title:'Synthetic group', list:[{id:1001},{id:1002}] };
      if (url.startsWith('/api/stu/bank/lesson-questions?video_id=1000')) return { title:'Synthetic video', list:[{id:1001},{id:1002}] };
      if (url === '/api/stu/bank/submit') {
        if (rejectSubmit) throw new Error('synthetic submit rejected');
        serverAcc = rate(2, 1);
        return { total:2, correct:1, wrong:1, mastery:{section:copy(serverAcc)} };
      }
      throw new Error('Unexpected boundary call: ' + url);
    },
    toast(message) { throw new Error('Unexpected toast: ' + message); },
  };
  vm.runInNewContext(source, sandbox, {filename:sourceFile, timeout:1000});
  assert.ok(captured?.methods, 'must capture real App object from full source');
  const state = { subject:'数学', cachedSubject:'', courses:null, course:null, courseId:'100', category:'同步基础', activeGroupId:0, cats:['同步基础'] };
  Object.assign(state, captured.methods);
  return { state, calls, template:captured.template, quiz:()=>quiz, server:()=>copy(serverAcc) };
}
async function test(name, run) {
  try { await run(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.message); }
}
const listCalls = f => f.calls.filter(c=>c.url.startsWith('/api/stu/courses?')).length;
async function prime(f) { await f.state.loadCourses(); await f.state.loadCourse(); assert.equal(f.state.courses[0].acc.rate,null); }
async function open(f, mode) {
  if (mode === 'section') await f.state.doSectionPractice({id:10,name:'Synthetic group',lessons:[]});
  else await f.state.doPractice({video_id:1000,title:'Synthetic video'});
  assert.equal(typeof f.quiz()?.submit, 'function', 'real action must create quiz submit callback');
}
async function submit(f) {
  const result = await f.quiz().submit([{question_id:1001,my_answer:'A'},{question_id:1002,my_answer:'6'}], 10);
  // Let the actual unawaited loadCourse continuation finish; no arbitrary timer.
  await Promise.resolve(); await Promise.resolve();
  if (f.quiz().onDone) await f.quiz().onDone(result);
  return result;
}
(async()=>{
  console.log('Scope: pure execution of actual Vue source with in-memory API/quiz boundaries; NOT a browser or service test.');
  console.log('Source SHA256: ' + crypto.createHash('sha256').update(source).digest('hex'));
  // Real hero template interpolation: changing its zero-accuracy wording back
  // to “本课程暂无习题” must fail the subjective-only cases below.
  for (const [name, course, expected] of [
    ['subjective group', {acc:{total:0},groups:[{practice_count:1}],lessons:[]}, '暂无可自动判分的习题'],
    ['subjective video', {acc:{total:0},groups:[],lessons:[{qcount:1}]}, '暂无可自动判分的习题'],
    ['empty course', {acc:{total:0},groups:[],lessons:[]}, '暂无可自动判分的习题'],
    ['objective course', {acc:{total:2,answered:1}}, '已做 1 / 2 题'],
  ]) {
    await test('hero copy: ' + name, async()=>{
      const f=fixture();
      const hero=f.template.match(/<div class="r8-hs" :class="accCls\(course.acc\)">([\s\S]*?)<\/div>/);
      assert.ok(hero, 'actual accuracy hero must be present');
      const expression=hero[1].match(/<em>\{\{ ([\s\S]*?) \}\}<\/em>/);
      assert.ok(expression, 'actual accuracy hero description expression');
      const text=vm.runInNewContext(expression[1], {course}, {timeout:1000});
      assert.equal(text,expected);
    });
  }
  await test('control: unchanged same-subject navigation legitimately uses existing list cache', async()=>{
    const f=fixture(); await prime(f); await f.state.loadCourses(); assert.equal(listCalls(f),1);
  });
  for (const mode of ['practice','section']) {
    await test(mode + ': successful real submit callback must refresh same-subject course list after detail refresh', async()=>{
      const f=fixture(); await prime(f); await open(f,mode); await submit(f);
      assert.equal(f.calls.find(c=>c.url==='/api/stu/bank/submit').kind,mode);
      assert.equal(f.state.course.acc.rate,50,'precondition: real loadCourse must already contain new detail rate');
      const beforeReturn = f.state.courses && f.state.courses[0].acc.rate;
      await f.state.loadCourses();
      const observed={mode, serverRate:f.server().rate, detailRate:f.state.course.acc.rate, listRateBeforeReturn:beforeReturn, listRateAfterReturn:f.state.courses[0].acc.rate, listRequests:listCalls(f), calls:f.calls};
      observations.push(observed); console.log('OBSERVATION ' + JSON.stringify(observed));
      assert.equal(f.state.courses[0].acc.rate,50,'same-subject list retains old unattempted value even after loadCourse updated detail');
      assert.equal(listCalls(f),2,'return should refetch invalidated list once');
      await f.state.loadCourses();
      assert.equal(listCalls(f),2,'repeated return should reuse the refreshed list');
    });
  }
  for (const mode of ['practice','section']) {
    await test(mode + ': rejected submit preserves both caches', async()=>{
      const f=fixture({rejectSubmit:true}); await prime(f); await open(f,mode);
      const cachedCourses = f.state.courses;
      await assert.rejects(()=>submit(f), /synthetic submit rejected/);
      assert.strictEqual(f.state.courses,cachedCourses);
      assert.equal(f.state.cachedSubject,'数学');
      assert.equal(f.state.course.acc.rate,null);
      await f.state.loadCourses(); assert.equal(listCalls(f),1);
    });
    await test(mode + ': opening quiz without submitting preserves original cache', async()=>{
      const f=fixture(); await prime(f); await open(f,mode); await f.state.loadCourses();
      assert.equal(f.state.courses[0].acc.rate,null); assert.equal(listCalls(f),1);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
    });
  }
  await test('control: switching subject causes real loadCourses to fetch again',async()=>{
    const f=fixture(); await prime(f); await open(f,'section'); await submit(f);
    f.state.subject='英语'; await f.state.loadCourses(); assert.equal(listCalls(f),2);
    f.state.subject='数学'; await f.state.loadCourses(); assert.equal(listCalls(f),3); assert.equal(f.state.courses[0].acc.rate,50);
  });
  console.log(`Course-list cache regression: ${pass} passed, ${fail} failed`);
  console.log('OBSERVATIONS_SUMMARY ' + JSON.stringify(observations));
  if (fail) process.exitCode=1;
})();
