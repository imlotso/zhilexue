'use strict';
// Run the complete production browser module in a VM, with a small DOM boundary.
// The list API executes the production route and SQL on synthetic in-memory SQLite.
// No browser, network, app bootstrap, credentials, MySQL or persistent data.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let openMemory;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:'); probe.close();
  openMemory = () => new Database(':memory:');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  openMemory = () => new DatabaseSync(':memory:');
}
const source = fs.readFileSync(path.join(__dirname, 'public/js/bank.js'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, 'src/bank.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function hostFixture() {
  let html = '', nodes = {}, tabs = [], categories = [];
  const document = { activeElement: null };
  return {
    ownerDocument: document,
    isConnected: true,
    get innerHTML() { return html; },
    set innerHTML(value) {
      document.activeElement = null;
      html = value; nodes = {};
      for (const match of html.matchAll(/<(input|select|button|div)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const tag = match[0];
        nodes['#' + match[2]] = {
          value: /\bvalue="([^"]*)"/.exec(tag)?.[1] || '',
          selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
          focus() { document.activeElement = this; },
          setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
        };
      }
      for (const id of ['pkGrade', 'pkYear']) {
        const body = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(html)?.[1] || '';
        const selected = /<option\b([^>]*\bselected[^>]*)>([^<]*)</.exec(body);
        if (selected) nodes['#' + id].value = /value="([^"]*)"/.exec(selected[1])?.[1] || selected[2];
      }
      tabs = [...html.matchAll(/data-s="([^"]*)"/g)].map(m => ({ dataset: { s: m[1] } }));
      categories = [...html.matchAll(/data-pk-category="([^"]*)"/g)].map(m => ({ dataset: { pkCategory: m[1] } }));
    },
    querySelector(selector) { return selector === '.bk-ai-loading' ? (html.includes('class="bk-ai-loading"') ? {} : null) : nodes[selector] || null; },
    querySelectorAll(selector) { return selector === '.bk-tabs a' ? tabs : selector === '[data-pk-category]' ? categories : []; },
  };
}
function fixture(t, subject = '数学') {
  const db = openMemory(); t.after(() => db.close());
  db.exec(`CREATE TABLE mf_papers(id INTEGER PRIMARY KEY,title TEXT,subject TEXT,stage TEXT,grade TEXT,year TEXT,exam_category TEXT,edition TEXT,term TEXT,created_at TEXT,published INTEGER,status TEXT);
    CREATE TABLE mf_paper_questions(paper_id INTEGER,kind TEXT,score REAL);
    CREATE TABLE mf_paper_tries(id INTEGER,user_id INTEGER,paper_id INTEGER,total INTEGER,correct INTEGER,score REAL,detail TEXT,created_at TEXT);`);
  const insert = db.prepare("INSERT INTO mf_papers VALUES(?,?,?,'primary','六年级',?,'final','','','',1,'published')");
  insert.run(1, 'Older math paper', '数学', '2024');
  for (let id = 2; id <= 201; id++) insert.run(id, 'English paper ' + id, '英语', '2026');
  let handler;
  const start = backend.indexOf('const MFP_OPEN =');
  const end = backend.indexOf("\n});", start) + '\n});'.length;
  assert.ok(start >= 0 && end > start, 'production list route must exist');
  vm.runInNewContext(backend.slice(start, end), {
    db, stu: { get(route, fn) { assert.equal(route, '/mfpapers'); handler = fn; } },
    ok(res, data) { res.data = data; }, presentAttempt: () => null,
  });
  const calls = [], errors = [], queued = [], queuedMistakes = [], queuedUploads = [], queuedPoints = [], queuedFilters = [], queuedSubjective = [];
  const host = hostFixture();
  let mistakeTabs = [];
  const tabsMount = {
    set innerHTML(html) { mistakeTabs = [...html.matchAll(/data-s="([^"]*)"/g)].map(m => ({ dataset: { s: m[1] } })); },
    querySelectorAll(selector) { assert.equal(selector, '.bk2-tabs a'); return mistakeTabs; },
  };
  const box = { window: {}, location: { hash: '#/papers', origin: 'https://test.invalid' }, URLSearchParams, document: { getElementById: id => id === 'bkTabsMount' ? tabsMount : null }, bindImageZoom: () => {},
    esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    toast: (message, kind) => errors.push({ message, kind }),
    api: async url => {
      if (url === '/api/stu/bank/tasks') return [];
      if (url === '/api/stu/bank/subjective-responses') return queuedSubjective.length ? queuedSubjective.shift().promise : { list: [] };
      if (url === '/api/stu/bank/mfpapers/filters') return queuedFilters.length ? queuedFilters.shift().promise : { grades: ['六年级'], years: ['2024', '2026'] };
      if (url === '/api/stu/bank/mistakes') return queuedMistakes.length ? queuedMistakes.shift().promise : { list: [], counts: {}, review: { due: 0 } };
      if (url === '/api/stu/bank/uploads') return queuedUploads.length ? queuedUploads.shift().promise : { list: [] };
      if (url.startsWith('/api/stu/bank/mistake-points?')) return queuedPoints.length ? queuedPoints.shift().promise : { groups: [] };
      const parsed = new URL(url, 'https://test.invalid');
      assert.equal(parsed.pathname, '/api/stu/bank/mfpapers');
      calls.push(parsed.searchParams);
      if (queued.length) return queued.shift().promise;
      const res = {};
      handler({ user: { id: 1 }, query: Object.fromEntries(parsed.searchParams) }, res);
      return res.data;
    },
  };
  vm.runInNewContext(source, box, { filename: 'public/js/bank.js' });
  let quiz;
  box.window.BankQuiz.open = options => { quiz = options; };
  return { host, calls, errors, queued, queuedMistakes, queuedUploads, queuedPoints, queuedFilters, queuedSubjective, quiz: () => quiz,
    start: (selectedSubject = subject) => box.window.BankPages.papers(host, selectedSubject),
    mistakes: () => box.window.BankPages.mistakes(host),
    mistakeTab(s) { mistakeTabs.find(tab => tab.dataset.s === s).onclick(); },
    search(q) { host.querySelector('#pkQ').value = q; host.querySelector('#pkSearch').onclick(); },
    tab(s) { host.querySelectorAll('.bk-tabs a').find(a => a.dataset.s === s).onclick(); },
  };
}
const paper = title => [{ id: 900, title, subject: '数学', q_count: 1, total_score: 10, tried: false, last: null }];

test('initial selected subject finds an older paper beyond 200 newer other-subject papers', async t => {
  const f = fixture(t); await f.start();
  assert.match(f.host.innerHTML, /Older math paper/);
  assert.equal(f.calls[0].get('subject'), '数学');
});
test('switching subjects fetches server-filtered results; all removes subject filter', async t => {
  const f = fixture(t, '英语'); await f.start();
  f.tab('数学'); await flush();
  assert.match(f.host.innerHTML, /Older math paper/);
  assert.equal(f.calls.at(-1).get('subject'), '数学');
  f.tab(''); await flush();
  assert.equal(f.calls.at(-1).has('subject'), false);
  assert.match(f.host.innerHTML, /English paper 201/);
});
test('search and clear retain selected subject and transmit all active filters', async t => {
  const f = fixture(t); await f.start();
  f.host.querySelector('#pkGrade').value = '六年级';
  f.host.querySelector('#pkYear').value = '2024';
  f.search(' Older '); await flush();
  assert.deepEqual(Object.fromEntries(f.calls.at(-1)), { subject: '数学', q: 'Older', grade: '六年级', year: '2024' });
  assert.match(f.host.innerHTML, /Older math paper/);
  f.host.querySelectorAll('[data-pk-category]').find(a => a.dataset.pkCategory === 'final').onclick(); await flush();
  assert.equal(f.calls.at(-1).get('exam_category'), 'final');
  f.host.querySelector('#pkClear').onclick(); await flush();
  assert.deepEqual(Object.fromEntries(f.calls.at(-1)), { subject: '数学' });
  assert.match(f.host.innerHTML, /Older math paper/);
});
test('older success cannot overwrite a newer completed search', async t => {
  const f = fixture(t); await f.start();
  const old = deferred(), next = deferred(); f.queued.push(old, next);
  f.search('old'); f.search('new');
  next.resolve(paper('New result')); await flush();
  old.resolve(paper('Old result')); await flush();
  assert.match(f.host.innerHTML, /New result/);
  assert.doesNotMatch(f.host.innerHTML, /Old result/);
  assert.equal(f.host.querySelector('#pkQ').value, 'new');
});
test('older rejection cannot show an error after a newer successful search', async t => {
  const f = fixture(t); await f.start();
  const old = deferred(), next = deferred(); f.queued.push(old, next);
  f.search('old'); f.search('new');
  next.resolve(paper('New result')); await flush();
  old.reject(new Error('stale error')); await flush();
  assert.deepEqual(f.errors, []);
  assert.match(f.host.innerHTML, /New result/);
});
test('latest failure is reported and does not permit an older success to overwrite results', async t => {
  const f = fixture(t); await f.start();
  const old = deferred(), next = deferred(); f.queued.push(old, next);
  f.search('old'); f.search('new');
  next.reject(new Error('current error')); await flush();
  assert.match(f.host.innerHTML, /current error/);
  assert.doesNotMatch(f.host.innerHTML, /Older math paper/);
  const afterFailure = f.host.innerHTML;
  old.resolve(paper('Old result')); await flush();
  assert.equal(f.host.innerHTML, afterFailure);
  assert.deepEqual(f.errors, [{ message: 'current error', kind: 'err' }]);
  f.search('Older'); await flush();
  assert.match(f.host.innerHTML, /Older math paper/);
});
test('switching subject invalidates an in-flight search', async t => {
  const f = fixture(t); await f.start();
  const old = deferred(); f.queued.push(old); f.search('old');
  f.tab('英语'); await flush();
  const latest = f.host.innerHTML;
  old.resolve(paper('Old result')); await flush();
  assert.equal(f.calls.at(-1).get('subject'), '英语');
  assert.equal(f.host.innerHTML, latest);
});
test('clear invalidates an in-flight search and restores the selected subject results', async t => {
  const f = fixture(t); await f.start();
  f.search('Older'); await flush();
  const old = deferred(); f.queued.push(old); f.search('old');
  f.host.querySelector('#pkClear').onclick(); await flush();
  old.resolve(paper('Old result')); await flush();
  assert.match(f.host.innerHTML, /Older math paper/);
  assert.doesNotMatch(f.host.innerHTML, /Old result/);
  assert.equal(f.host.querySelector('#pkQ').value, '');
});
test('initial failure stays visible and does not initialize search controls', async t => {
  const f = fixture(t); const initial = deferred(); f.queued.push(initial);
  const started = f.start(); initial.reject(new Error('initial failure')); await started;
  assert.match(f.host.innerHTML, /initial failure/);
  assert.equal(f.host.querySelector('#pkSearch'), null);
});

test('subject badges never report unqueried subjects as zero and hide pending counts', async t => {
  const f = fixture(t); await f.start();
  const tabHtml = s => new RegExp('data-s="' + s + '">([^<]*)([\\s\\S]*?)</a>').exec(f.host.innerHTML)?.[0];
  assert.doesNotMatch(tabHtml('英语'), /<i>/);
  assert.doesNotMatch(tabHtml(''), /<i>/);
  assert.match(tabHtml('数学'), /<i>1<\/i>/);
  const next = deferred(); f.queued.push(next); f.search('pending');
  assert.doesNotMatch(tabHtml('数学'), /<i>/);
  assert.match(f.host.innerHTML, /加载中/);
  next.resolve([]); await flush();
  assert.match(tabHtml('数学'), /<i>0<\/i>/);
});

test('subject response preserves unsubmitted query draft, focus and selection without applying it', async t => {
  const f = fixture(t); await f.start();
  const next = deferred(); f.queued.push(next); f.tab('英语');
  const input = f.host.querySelector('#pkQ');
  input.value = '  new draft  '; input.focus(); input.setSelectionRange(3, 7, 'backward');
  next.resolve([]); await flush();
  const after = f.host.querySelector('#pkQ');
  assert.equal(after.value, '  new draft  ');
  assert.equal(f.host.ownerDocument.activeElement, after);
  assert.deepEqual([after.selectionStart, after.selectionEnd, after.selectionDirection], [3, 7, 'backward']);
  assert.equal(f.calls.at(-1).has('q'), false);
  after.onkeydown({ key: 'Enter' }); await flush();
  assert.equal(f.calls.at(-1).get('q'), 'new draft');
});
test('draft survives switching subject and category without being submitted or stealing focus', async t => {
  const f = fixture(t); await f.start();
  f.host.querySelector('#pkQ').value = 'unfinished';
  f.tab('英语'); await flush();
  assert.equal(f.host.querySelector('#pkQ').value, 'unfinished');
  assert.equal(f.calls.at(-1).has('q'), false);
  f.host.querySelectorAll('[data-pk-category]').find(a => a.dataset.pkCategory === 'final').onclick(); await flush();
  assert.equal(f.host.querySelector('#pkQ').value, 'unfinished');
  assert.equal(f.calls.at(-1).has('q'), false);
  assert.equal(f.host.ownerDocument.activeElement, null);
});
test('failed response preserves newer draft and clear explicitly discards it', async t => {
  const f = fixture(t); await f.start();
  const next = deferred(); f.queued.push(next); f.search('Older');
  const input = f.host.querySelector('#pkQ'); input.value = 'unsubmitted'; input.focus(); input.setSelectionRange(4, 4, 'none');
  next.reject(new Error('current error')); await flush();
  assert.equal(f.host.querySelector('#pkQ').value, 'unsubmitted');
  assert.equal(f.host.ownerDocument.activeElement, f.host.querySelector('#pkQ'));
  f.host.querySelector('#pkClear').onclick(); await flush();
  assert.equal(f.host.querySelector('#pkQ').value, '');
  assert.equal(f.calls.at(-1).has('q'), false);
});
test('library heading distinguishes loading and failure from a completed empty result', async t => {
  const f = fixture(t); await f.start();
  const heading = () => /试卷库<span class="pk-sub">([^<]*)<\/span>/.exec(f.host.innerHTML)?.[1];
  assert.equal(heading(), '1 份试卷');
  const next = deferred(); f.queued.push(next); f.search('absent');
  assert.equal(heading(), '加载中…');
  next.reject(new Error('search unavailable')); await flush();
  assert.equal(heading(), '加载失败');
  f.search('absent'); await flush();
  assert.equal(heading(), '0 份试卷');
});

for (const outcome of ['resolve', 'reject']) {
  test(`superseded paper page initial ${outcome} cannot replace a newer subject page`, async t => {
    const f = fixture(t), old = deferred(); f.queued.push(old);
    const started = f.start();
    await f.start('英语');
    const current = f.host.innerHTML;
    if (outcome === 'resolve') old.resolve(paper('Obsolete initial paper'));
    else old.reject(new Error('obsolete initial failure'));
    await started;
    assert.equal(f.host.innerHTML, current);
    assert.deepEqual(f.errors, []);
  });
  test(`paper initial ${outcome} cannot overwrite the mistakes page on the reused host`, async t => {
    const f = fixture(t), old = deferred(); f.queued.push(old);
    const started = f.start();
    await f.mistakes();
    assert.match(f.host.innerHTML, /t9-root/);
    const current = f.host.innerHTML;
    if (outcome === 'resolve') old.resolve(paper('Obsolete initial paper'));
    else old.reject(new Error('obsolete initial failure'));
    await started;
    assert.equal(f.host.innerHTML, current);
  });
  test(`paper search ${outcome} cannot repaint or show an error after opening mistakes`, async t => {
    const f = fixture(t); await f.start();
    const old = deferred(); f.queued.push(old); f.search('pending');
    await f.mistakes();
    const current = f.host.innerHTML;
    if (outcome === 'resolve') old.resolve(paper('Obsolete search result'));
    else old.reject(new Error('obsolete search failure'));
    await flush();
    assert.equal(f.host.innerHTML, current);
    assert.deepEqual(f.errors, []);
  });
  test(`mistakes initial ${outcome} cannot overwrite a newer papers page`, async t => {
    const f = fixture(t), old = deferred(); f.queuedMistakes.push(old);
    const started = f.mistakes();
    await f.start();
    const current = f.host.innerHTML;
    if (outcome === 'resolve') old.resolve({ list: [], counts: {}, review: { due: 0 } });
    else old.reject(new Error('obsolete mistakes failure'));
    await started;
    assert.equal(f.host.innerHTML, current);
  });
  test(`detached paper initial ${outcome} does not paint its abandoned host`, async t => {
    const f = fixture(t), old = deferred(); f.queued.push(old);
    const started = f.start();
    const current = f.host.innerHTML; f.host.isConnected = false;
    if (outcome === 'resolve') old.resolve(paper('Detached initial result'));
    else old.reject(new Error('detached initial failure'));
    await started;
    assert.equal(f.host.innerHTML, current);
  });
  test(`detached paper search ${outcome} neither paints nor reports an obsolete error`, async t => {
    const f = fixture(t); await f.start();
    const old = deferred(); f.queued.push(old); f.search('pending');
    const current = f.host.innerHTML; f.host.isConnected = false;
    if (outcome === 'resolve') old.resolve(paper('Detached search result'));
    else old.reject(new Error('detached search failure'));
    await flush();
    assert.equal(f.host.innerHTML, current);
    assert.deepEqual(f.errors, []);
  });
  test(`detached mistakes initial ${outcome} does not paint its abandoned host`, async t => {
    const f = fixture(t), old = deferred(); f.queuedMistakes.push(old);
    const started = f.mistakes();
    const current = f.host.innerHTML; f.host.isConnected = false;
    if (outcome === 'resolve') old.resolve({ list: [], counts: {}, review: { due: 0 } });
    else old.reject(new Error('detached mistakes failure'));
    await started;
    assert.equal(f.host.innerHTML, current);
  });
}

for (const page of ['uploads', 'points']) {
  for (const outcome of ['resolve', 'reject']) {
    for (const destination of ['papers', 'history', 'detached']) {
      test(`late mistakes ${page} ${outcome} cannot replace ${destination}`, async t => {
        const f = fixture(t); await f.mistakes();
        const old = deferred(); (page === 'uploads' ? f.queuedUploads : f.queuedPoints).push(old);
        f.host.querySelector(page === 'uploads' ? '#bkUps' : '#bkPts').onclick();
        if (destination === 'papers') await f.start();
        else if (destination === 'history') {
          f.mistakeTab('数学');
          f.host.querySelector('#bkHis').onclick();
        } else f.host.isConnected = false;
        const current = f.host.innerHTML;
        if (outcome === 'resolve') old.resolve(page === 'uploads' ? { list: [] } : { groups: [] });
        else old.reject(new Error('obsolete ' + page + ' failure'));
        await flush();
        assert.equal(f.host.innerHTML, current);
      });
    }
  }
}

test('switching mistakes subjects invalidates an earlier points request even while the new one is loading', async t => {
  const f = fixture(t); await f.mistakes();
  const old = deferred(), current = deferred(); f.queuedPoints.push(old, current);
  f.host.querySelector('#bkPts').onclick();
  f.mistakeTab('数学'); f.host.querySelector('#bkPts').onclick();
  const loading = f.host.innerHTML;
  old.resolve({ groups: [{ point: 'Old English point', count: 1, ids: [] }] }); await flush();
  assert.equal(f.host.innerHTML, loading);
  current.resolve({ groups: [{ point: 'Current math point', count: 1, ids: [] }] }); await flush();
  assert.match(f.host.innerHTML, /Current math point/);
  assert.doesNotMatch(f.host.innerHTML, /Old English point/);
});

test('finishing an old mistakes quiz does not reclaim a newer papers page', async t => {
  const f = fixture(t);
  f.queuedMistakes.push({ promise: Promise.resolve({
    list: [{ question_id: 1, subject: '数学', type: 'choice', stem: 'Synthetic question', answer: 'A', options: ['one'], updated_at: new Date().toISOString(), resolved: 0 }],
    counts: { 数学: 1 }, review: { due: 0 },
  }) });
  await f.mistakes();
  f.host.querySelector('#bkD2').onclick();
  assert.equal(typeof f.quiz()?.onDone, 'function');
  await f.start();
  const current = f.host.innerHTML;
  await f.quiz().onDone();
  assert.equal(f.host.innerHTML, current);
});

for (const page of ['uploads', 'points']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`mistakes ${page} Back works while loading and ignores the late ${outcome}`, async t => {
      const f = fixture(t); await f.mistakes();
      const old = deferred(); (page === 'uploads' ? f.queuedUploads : f.queuedPoints).push(old);
      f.host.querySelector(page === 'uploads' ? '#bkUps' : '#bkPts').onclick();
      const back = f.host.querySelector('#bkBack');
      assert.equal(typeof back?.onclick, 'function', 'visible Back button must work before the request settles');
      back.onclick();
      assert.match(f.host.innerHTML, /t9-root/);
      const current = f.host.innerHTML;
      if (outcome === 'resolve') old.resolve(page === 'uploads' ? { list: [] } : { groups: [] });
      else old.reject(new Error('obsolete failure'));
      await flush();
      assert.equal(f.host.innerHTML, current);
    });
    test(`current mistakes ${page} ${outcome} is shown and Back remains usable`, async t => {
      const f = fixture(t); await f.mistakes();
      const current = deferred(); (page === 'uploads' ? f.queuedUploads : f.queuedPoints).push(current);
      f.host.querySelector(page === 'uploads' ? '#bkUps' : '#bkPts').onclick();
      if (outcome === 'resolve') current.resolve(page === 'uploads' ? { list: [] } : { groups: [] });
      else current.reject(new Error('current request failure'));
      await flush();
      assert.match(f.host.innerHTML, outcome === 'reject' ? /current request failure/ : page === 'uploads' ? /还没有上传过错题/ : /暂时没有薄弱知识点/);
      assert.equal(typeof f.host.querySelector('#bkBack')?.onclick, 'function');
      f.host.querySelector('#bkBack').onclick();
      assert.match(f.host.innerHTML, /t9-root/);
    });
  }
}
