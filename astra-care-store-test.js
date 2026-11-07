'use strict';
// Production store execution; synthetic HTTP/storage boundaries, no real data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, 'public');
const STORE = path.join(ROOT, 'apps/care/assets/js/store.js');
const response = data => ({ ok: true, json: async () => ({ code: 0, data }) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  assert.ok(fs.existsSync(STORE), 'care/index.html requires the production store.js');
  const data = options.storage || new Map(); data.set('xuexi_admin_token', options.token || 'synthetic-A');
  const reads = [], writes = [], calls = [], events = {}; let id = options.id || 10, role = options.role || 'branch';
  const box = { console: { warn() {}, info() {} },
    localStorage: { getItem(k) { reads.push(k); return data.get(k) || null; }, setItem(k, v) { if (options.writeError) throw Error('synthetic quota'); writes.push(k); data.set(k, String(v)); } },
    addEventListener(k, fn) { events[k] = fn; },
    fetch: async (url, init) => { calls.push({ url, init }); if (options.fetch) return options.fetch(url, init);
      return response(url === '/api/me' ? { id, role } : { role, branches: [], students: [{ id: id + 100, name: '合成学生' + id, grade: '七年级', branch_name: '合成分校' + id }] }); } };
  box.window = box; vm.runInNewContext(fs.readFileSync(STORE, 'utf8'), box, { filename: 'store.js' });
  return { store: box.App.store, data, reads, writes, calls, events, switchTo(newId, token) { id = newId; data.set('xuexi_admin_token', token); events.storage?.({ key: 'xuexi_admin_token' }); } };
}
test('every HTML local script and stylesheet exists in the delivered source', () => {
  const missing = []; let checked = 0;
  function walk(dir) { for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name); if (ent.isDirectory()) walk(p);
    else if (p.endsWith('.html')) for (const match of fs.readFileSync(p, 'utf8').matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)/gi)) {
      const u = match[1]; if (/^(?:https?:|\/\/|data:|#)/.test(u)) continue;
      const target = u.startsWith('/') ? path.join(ROOT, u) : path.resolve(path.dirname(p), u);
      checked++; if (!fs.existsSync(target.split(/[?#]/)[0])) missing.push(path.relative(ROOT, p) + ': ' + u);
    }
  } }
  walk(ROOT); assert.ok(checked >= 114); assert.deepEqual(missing, []);
});
test('verified boot loads the real roster and persists CRUD per account', async () => {
  const f = fixture(); await f.store.load();
  assert.deepEqual(f.calls.map(c => c.url), ['/api/me', '/api/admin/grades-roster']);
  assert.ok(f.calls.every(c => c.init.headers.Authorization === 'Bearer synthetic-A'));
  assert.equal(f.store.students.all()[0].id, 'acct110');
  const t = f.store.talks.add({ studentId: 'acct110', content: '合成谈话' }); f.store.talks.update(t.id, { content: '更新合成谈话' });
  f.store.communications.add({ studentId: 'acct110', content: '合成沟通' }); f.store.settings({ aiModel: 'synthetic-model' });
  const again = fixture({ storage: f.data }); await again.store.load();
  assert.equal(again.store.talks.get(t.id).content, '更新合成谈话'); assert.equal(again.store.communications.all().length, 1);
  assert.equal(again.store.settings().aiModel, 'synthetic-model'); assert.ok(f.writes.every(k => k.includes(':branch:10')));
  assert.equal(again.store.talks.remove(t.id), true); assert.equal(again.store.stat().talks, 0);
});
test('unattributed legacy records/settings remain untouched and never auto-load', async () => {
  const original = JSON.stringify({ students: [{ id: 'old', name: '合成旧档案' }], talks: [{ id: 'secret', content: '合成旧谈话' }], communications: [] });
  const data = new Map([['bzw.data.v1', original], ['bzw.settings.v1', '{"aiModel":"legacy-model"}']]); const f = fixture({ storage: data }); await f.store.load();
  assert.equal(f.store.stat().talks, 0); assert.equal(f.store.talks.get('secret'), null); assert.notEqual(f.store.settings().aiModel, 'legacy-model');
  assert.equal(f.store.hasLegacyData(), true); assert.equal(data.get('bzw.data.v1'), original); assert.equal(data.get('bzw.settings.v1'), '{"aiModel":"legacy-model"}');
  assert.equal(f.writes.some(k => k.endsWith('.v1')), false);
});
test('account switch cannot read or overwrite another account records/settings', async () => {
  const a = fixture(); await a.store.load(); a.store.talks.add({ id: 'talk-a', content: '合成A' }); a.store.settings({ aiModel: 'model-a' });
  const before = new Map(a.data); a.switchTo(20, 'synthetic-B'); assert.throws(() => a.store.backup(), /登录|账号/); assert.throws(() => a.store.talks.add({ content: 'stale' }), /登录|账号/);
  const b = fixture({ storage: a.data, id: 20, token: 'synthetic-B' }); await b.store.load();
  assert.equal(b.store.talks.get('talk-a'), null); assert.notEqual(b.store.settings().aiModel, 'model-a'); b.store.communications.add({ content: '合成B' });
  for (const [k, v] of before) if (k.includes(':branch:10')) assert.equal(b.data.get(k), v);
});
for (const kind of ['unauthorized', 'student', 'rosterFailure']) test(kind + ' cannot load local records or start an editable workbench', async () => {
  const f = fixture({ fetch: async url => {
    if (kind === 'unauthorized' || (kind === 'rosterFailure' && url !== '/api/me')) return { ok: false, json: async () => ({ code: 1 }) };
    return response({ id: 10, role: kind === 'student' ? 'student' : 'branch' });
  } }); await assert.rejects(f.store.load());
  assert.equal(f.reads.some(k => /^bzw\.(?:data|settings)\.v2/.test(k)), false); assert.equal(f.writes.length, 0); assert.throws(() => f.store.backup());
});
test('late previous-account roster cannot persist or activate data after token replacement', async () => {
  const d = deferred(); const f = fixture({ fetch: url => url === '/api/me' ? Promise.resolve(response({ id: 10, role: 'branch' })) : d.promise });
  const pending = f.store.load(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.switchTo(20, 'synthetic-B');
  d.resolve(response({ role: 'branch', branches: [], students: [{ id: 110, name: '合成旧学生' }] }));
  await assert.rejects(pending); assert.equal(f.writes.length, 0); assert.throws(() => f.store.students.all());
});
test('malformed account data is not overwritten with empty data', async () => {
  const data = new Map([['bzw.data.v2:branch:10', '{invalid-json']]); const f = fixture({ storage: data }); await assert.rejects(f.store.load(), /损坏|格式/);
  assert.equal(data.get('bzw.data.v2:branch:10'), '{invalid-json'); assert.equal(f.writes.length, 0);
});
test('storage failures are visible errors instead of a false save success', async () => {
  const f = fixture({ writeError: true }); await assert.rejects(f.store.load(), /存储|保存/);
});
test('disabled unverified demo cannot replace saved business data', async () => {
  const f = fixture(); await f.store.load(); f.store.talks.add({ content: '合成记录' }); const before = f.store.backup();
  assert.throws(() => f.store.loadDemo(), /示例/); assert.equal(f.store.backup(), before);
});
function appFixture(store) {
  const elements = new Map(), messages = []; let called = 0;
  function el(id) { if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: '', textContent: '', value: '', classList: { toggle() {} }, events: {}, addEventListener(k, fn) { this.events[k] = fn; } }); return elements.get(id); }
  const doc = { readyState: 'complete', getElementById: el, querySelector: s => el(s), querySelectorAll: () => [] };
  const ui = { toast: (msg, kind) => messages.push({ msg, kind }), $: s => el(s.replace(/^#/, '')), esc: String, today: () => '2026-11-07', fmtCN: String, weekday: () => '' };
  const box = { document: doc, console: { warn() {}, error() {}, info() {} }, location: { hash: '#/talks' }, addEventListener() {}, scrollTo() {}, App: { ui, store, pages: { talks: { init() { called++; }, render() { called++; } } }, ai: { speechSupported: () => false } } };
  box.window = box; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'apps/care/assets/js/app.js'), 'utf8'), box);
  return { el, messages, called: () => called };
}
test('missing store shows visible startup failure instead of a blank iframe', async () => {
  const f = appFixture(undefined); await new Promise(r => setImmediate(r));
  assert.match(f.el('careStartup').textContent, /加载|依赖|刷新/); assert.equal(f.el('careStartup').hidden, false);
  assert.equal(f.called(), 0); assert.equal(f.el('careWorkbench').hidden, true);
});
test('initialization waits for verified storage and renders failed startup visibly', async () => {
  const d = deferred(); const f = appFixture({ load: () => d.promise }); assert.equal(f.called(), 0); assert.equal(f.el('careWorkbench').hidden, true);
  d.resolve(Promise.reject(Error('合成登录失败'))); await new Promise(r => setImmediate(r));
  assert.match(f.el('careStartup').textContent, /合成登录失败/); assert.equal(f.called(), 0);
});

test('same id with a different verified role has a separate data partition, and switching back restores A', async () => {
  const a = fixture({ id: 10, role: 'admin' }); await a.store.load(); a.store.talks.add({ id: 'admin-only', content: '合成管理记录' });
  const b = fixture({ storage: a.data, id: 10, role: 'branch', token: 'synthetic-branch' }); await b.store.load(); assert.equal(b.store.stat().talks, 0);
  const back = fixture({ storage: a.data, id: 10, role: 'admin', token: 'synthetic-admin-again' }); await back.store.load(); assert.equal(back.store.talks.get('admin-only').content, '合成管理记录');
});
test('every data operation rejects stale same-document token state, not only storage events', async () => {
  const f = fixture(); await f.store.load(); f.data.set('xuexi_admin_token', 'synthetic-other');
  const calls = [() => f.store.students.all(), () => f.store.talks.get('x'), () => f.store.stat(), () => f.store.backup(), () => f.store.settings(),
    () => f.store.talks.add({}), () => f.store.talks.update('x', {}), () => f.store.talks.remove('x'), () => f.store.students.setAll([]),
    () => f.store.clearAll(), () => f.store.restore('{"students":[],"talks":[],"communications":[]}')];
  const before = f.writes.length; calls.forEach(fn => assert.throws(fn, /账号|登录/)); assert.equal(f.writes.length, before);
});
test('corrupt settings cannot be replaced silently by default settings', async () => {
  const data = new Map([['bzw.settings.v2:branch:10', '{invalid']]); const f = fixture({ storage: data }); await f.store.load();
  assert.throws(() => f.store.settings({ aiModel: 'replacement' }), /设置|损坏/); assert.equal(data.get('bzw.settings.v2:branch:10'), '{invalid');
});
test('locked workbench clears its entire DOM and author CSS cannot override hidden', async () => {
  const f = appFixture(undefined); f.el('careWorkbench').innerHTML = '合成敏感页面'; await new Promise(r => setImmediate(r));
  // Trigger an asynchronous failure so the DOM is populated before locking.
  const d = deferred(); const waiting = appFixture({ load: () => d.promise }); waiting.el('careWorkbench').innerHTML = '合成敏感页面';
  d.resolve(Promise.reject(Error('locked'))); await new Promise(r => setImmediate(r)); assert.equal(waiting.el('careWorkbench').innerHTML, '');
  const html = fs.readFileSync(path.join(ROOT, 'apps/care/index.html'), 'utf8'); assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('empty or malformed record imports never replace existing records', async () => {
  const f = fixture(); await f.store.load(); f.store.talks.add({ content: '合成有效记录' }); const before = f.store.backup();
  for (const payload of ['', 'null', '{"students":[],"talks":[],"communications":[null]}', '{"students":[{"name":"无ID"}],"talks":[],"communications":[]}']) {
    assert.throws(() => f.store.restore(payload), /格式|记录/); assert.equal(f.store.backup(), before);
  }
});
test('stale same-account tab cannot silently overwrite a more recent saved snapshot', async () => {
  const a = fixture(); await a.store.load(); const b = fixture({ storage: a.data }); await b.store.load();
  a.store.talks.add({ content: '合成A新增' }); const saved = a.data.get('bzw.data.v2:branch:10');
  assert.throws(() => b.store.talks.add({ content: '过期B新增' }), /更新|刷新|其他/);
  assert.equal(a.data.get('bzw.data.v2:branch:10'), saved);
});

test('quota failure after boot keeps the last saved state and does not lock away the user draft', async () => {
  const flags = {}; const f = fixture(flags); await f.store.load(); f.store.talks.add({ content: '合成已存记录' }); const saved = f.store.backup();
  let locked = 0; f.store.onLock(() => locked++); flags.writeError = true;
  assert.throws(() => f.store.talks.add({ content: '合成未保存长草稿' }), /保存|存储/);
  assert.equal(f.store.backup(), saved); assert.equal(locked, 0);
});
test('verified app startup opens the workbench and settings save failures show an error while retaining inputs', async () => {
  const flags = {}; const f = fixture(flags); const app = appFixture(f.store); await new Promise(r => setImmediate(r));
  assert.equal(app.el('careWorkbench').hidden, false); assert.ok(app.called() > 0);
  flags.writeError = true; app.el('setAiModel').value = '合成未保存配置'; app.el('setAsrModel').value = '合成未保存识别配置';
  assert.doesNotThrow(() => app.el('setAiSave').events.click()); assert.doesNotThrow(() => app.el('setAsrSave').events.click());
  assert.equal(app.el('setAiModel').value, '合成未保存配置'); assert.equal(app.el('setAsrModel').value, '合成未保存识别配置');
  assert.equal(app.messages.filter(m => m.kind === 'err').length, 2); assert.equal(app.messages.some(m => m.kind === 'ok'), false);
});

test('import rejects malformed text/reference fields before overwriting valid records', async () => {
  const f = fixture(); await f.store.load(); f.store.talks.add({ content: '合成旧记录需保留' }); const before = f.store.backup();
  for (const [key, field, value] of [['students', 'name', null], ['students', 'name', undefined], ['students', 'name', {}], ['students', 'sno', []], ['talks', 'date', 123], ['talks', 'studentId', {}], ['communications', 'way', true]]) {
    const data = { students: [], talks: [], communications: [] }; data[key].push({ id: 'valid-id', [field]: value });
    assert.throws(() => f.store.restore(JSON.stringify(data)), /格式|字段/); assert.equal(f.store.backup(), before);
  }
});
