'use strict';
// Independent review regression: retain the existing synthetic SQL/DOM fixture,
// but execute production Auth/api with a fake fetch boundary. No network or app bootstrap.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const fixtureFile = path.join(__dirname, 'astra-paper-library-search-test.js');
let fixtureSource = fs.readFileSync(fixtureFile, 'utf8').split('const paper = title =>')[0];
const marker = "  vm.runInNewContext(source, box, { filename: 'public/js/bank.js' });";
if (!fixtureSource.includes(marker)) throw new Error('Fixture insertion point changed');
fixtureSource = fixtureSource.replace(marker, `
  const boundaryApi = box.api;
  const apiSource = fs.readFileSync(path.join(__dirname, 'public/js/api.js'), 'utf8').split('\\nfunction toast(')[0];
  box.api = vm.runInNewContext(apiSource + '; api', {
    window: {}, localStorage: { getItem: () => '', removeItem: () => {} },
    location: { hash: '#/papers' }, toast: box.toast,
    fetch: async url => {
      try {
        const data = await boundaryApi(url);
        return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
      } catch (error) {
        return { ok: false, status: 500, json: async () => ({ code: 500, msg: error.message }) };
      }
    },
  });
` + marker);
const cases = `
for (const request of ['initial', 'search', 'mistakes', 'uploads', 'points']) {
  test('production api: obsolete ' + request + ' error stays silent', async t => {
    const f = fixture(t), old = deferred();
    let started;
    if (request === 'initial') { f.queued.push(old); started = f.start(); }
    else if (request === 'search') { await f.start(); f.queued.push(old); f.search('old'); }
    else if (request === 'mistakes') { f.queuedMistakes.push(old); started = f.mistakes(); }
    else {
      await f.mistakes();
      (request === 'uploads' ? f.queuedUploads : f.queuedPoints).push(old);
      f.host.querySelector(request === 'uploads' ? '#bkUps' : '#bkPts').onclick();
    }
    if (request === 'initial' || request === 'search') await f.mistakes();
    else await f.start();
    const current = f.host.innerHTML;
    old.reject(new Error('obsolete API failure'));
    if (started) await started;
    await flush();
    assert.equal(f.host.innerHTML, current);
    assert.deepEqual(f.errors, []);
  });
}
test('production api: current search error is shown once', async t => {
  const f = fixture(t); await f.start();
  const current = deferred(); f.queued.push(current); f.search('current');
  current.reject(new Error('current API failure')); await flush();
  assert.match(f.host.innerHTML, /current API failure/);
  assert.deepEqual(f.errors, [{ message: 'current API failure', kind: 'err' }]);
});
for (const request of ['filters', 'subjective']) {
  test('production api: current optional ' + request + ' error is visible while the library remains usable', async t => {
    const f = fixture(t), failed = deferred();
    (request === 'filters' ? f.queuedFilters : f.queuedSubjective).push(failed);
    const started = f.start();
    failed.reject(new Error('optional API failure')); await started;
    assert.match(f.host.innerHTML, /Older math paper/);
    const label = request === 'filters' ? '筛选条件加载失败：' : '主观题反馈加载失败：';
    assert.deepEqual(f.errors, [{ message: label + 'optional API failure', kind: 'err' }]);
  });
  test('production api: obsolete optional ' + request + ' error remains silent', async t => {
    const f = fixture(t), failed = deferred();
    (request === 'filters' ? f.queuedFilters : f.queuedSubjective).push(failed);
    const started = f.start(); await f.mistakes();
    const current = f.host.innerHTML;
    failed.reject(new Error('obsolete optional API failure')); await started;
    assert.equal(f.host.innerHTML, current);
    assert.deepEqual(f.errors, []);
  });
}
test('current quiz completion still reloads its valid mistakes host', async t => {
  const f = fixture(t);
  f.queuedMistakes.push({ promise: Promise.resolve({
    list: [{ question_id: 1, subject: '数学', type: 'choice', stem: 'Synthetic', answer: 'A', options: ['one'], updated_at: new Date().toISOString(), resolved: 0 }],
    counts: { 数学: 1 }, review: { due: 0 },
  }) });
  await f.mistakes(); f.host.querySelector('#bkD2').onclick();
  assert.ok(f.quiz());
  assert.match(f.host.innerHTML, /待攻克 1 题 · 已掌握 0 题/);
  await f.quiz().onDone();
  assert.ok(f.host.innerHTML.includes('<div class="round-mist-count">共 0 题<span>待攻克 0 题 · 已掌握 0 题</span>'));
  assert.ok(f.host.innerHTML.includes('<h2>这里还没有错题</h2>'));
  assert.doesNotMatch(f.host.innerHTML, /Synthetic/);
});
`;
const compiled = new Module(__filename, module);
compiled.filename = __filename;
compiled.paths = module.paths;
compiled._compile(fixtureSource + cases, __filename);
