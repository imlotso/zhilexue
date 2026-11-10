'use strict';
// Execute the real form and batch handler with an in-memory boundary only.
// Never imports app/auth/db modules or reads account/configuration files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let Database;
try { Database = require('node:sqlite').DatabaseSync; }
catch (_) { Database = require('better-sqlite3'); }
const adminSource = fs.readFileSync(path.join(__dirname, 'public/admin/admin.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');
let pass = 0, fail = 0;
async function test(name, run) {
  try { await run(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}
function formFixture(student) {
  const start = adminSource.indexOf('function studentForm(s) {');
  const end = adminSource.indexOf('\nfunction batchForm()', start);
  assert.ok(start >= 0 && end > start);
  let opts; const nodes = {}; const requests = [];
  const c = vm.createContext({
    modal(o) { opts = o; }, STAGE_OPTS: [], gradePick: () => '',
    esc: value => String(value), mountElDate() {}, toast() {}, render() {},
    api: async (url, options) => { requests.push({ url, options }); },
  });
  vm.runInContext(adminSource.slice(start, end), c); c.studentForm(student || null);
  for (const tag of opts.body.matchAll(/<(?:input|button|select)\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    if (!attrs.id) continue;
    nodes[attrs.id] = {
      attrs, value: attrs.value || '', type: attrs.type || 'text', textContent: (opts.body.match(new RegExp('<button[^>]*id="' + attrs.id + '"[^>]*>([^<]*)')) || [])[1] || '',
      classList: { toggle() {} },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] || null; },
    };
  }
  const wrap = { querySelector: s => nodes[s.slice(1)] || null };
  opts.onMount(wrap);
  return { opts, nodes, requests, wrap };
}
function batchFixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, username TEXT UNIQUE, password TEXT,
    name TEXT, grade TEXT, stage TEXT, term TEXT, allow_seek INTEGER, avatar TEXT, expire_at TEXT,
    level TEXT, created_by INTEGER, created_at TEXT)`);
  let handler; const hashedInputs = [];
  const start = appSource.indexOf("admin.post('/students/batch',");
  const end = appSource.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const c = vm.createContext({ db, admin: { post(route, fn) { assert.equal(route, '/students/batch'); handler = fn; } },
    checkStudentFields: () => '', studentStage: () => ({ value: 'primary' }),
    branchStudentLimit: () => null, termText: v => v || '', randAvatar: () => 'qa-avatar',
    now: () => '2030-01-01', hash: value => { hashedInputs.push(value); return 'in-memory-test-hash'; },
    ok(res, data) { res.data = data; },
  });
  vm.runInContext(appSource.slice(start, end), c);
  return { db, hashedInputs, run(list) { const res = {}; handler({ body: { list }, user: { id: 1, role: 'admin' } }, res); return res.data; } };
}
(async () => {
  await test('new student password is masked by default and has a named native toggle', () => {
    const f = formFixture();
    assert.equal(f.nodes.fPwd.type, 'password', 'new password field must start masked');
    const t = f.nodes.fPwdToggle;
    assert.ok(t, 'new password field needs an explicit visibility toggle');
    assert.equal(t.type, 'button', 'visibility control must not submit');
    assert.equal(t.getAttribute('aria-controls'), 'fPwd');
    assert.equal(t.getAttribute('aria-pressed'), 'false');
    assert.ok(Boolean(t.getAttribute('aria-label')), 'toggle needs an accessible name');
  });
  await test('show/hide changes visibility and state without changing the value', () => {
    const f = formFixture(); const t = f.nodes.fPwdToggle;
    assert.ok(t && typeof t.onclick === 'function', 'visibility toggle must be bound');
    const before = f.nodes.fPwd.value; const label = t.getAttribute('aria-label');
    t.onclick();
    assert.equal(f.nodes.fPwd.type, 'text'); assert.equal(t.getAttribute('aria-pressed'), 'true');
    assert.ok(f.nodes.fPwd.value === before, 'toggle must preserve the credential without logging it');
    assert.ok(t.getAttribute('aria-label') === label, 'pressed toggle keeps a stable accessible name');
    t.onclick();
    assert.equal(f.nodes.fPwd.type, 'password'); assert.equal(t.getAttribute('aria-pressed'), 'false');
    assert.ok(f.nodes.fPwd.value === before);
    const reopened = formFixture();
    assert.equal(reopened.nodes.fPwd.type, 'password');
    assert.equal(reopened.nodes.fPwdToggle.getAttribute('aria-pressed'), 'false');
  });
  await test('default credential is not printed in labels, helper text or accessible names', () => {
    const f = formFixture(); const initial = f.nodes.fPwd.value;
    const outsideValues = f.opts.body.replace(/value="[^"]*"/g, 'value=""');
    assert.ok(Boolean(initial) && !outsideValues.includes(initial), 'default masking must cover explanatory text as well as the input');
  });
  await test('visibility toggle keeps its visible label within its accessible name in both states', () => {
    const f = formFixture(); const t = f.nodes.fPwdToggle;
    assert.ok(t && typeof t.onclick === 'function');
    assert.ok(t.getAttribute('aria-label').includes(t.textContent.trim()));
    t.onclick();
    assert.ok(t.getAttribute('aria-label').includes(t.textContent.trim()), 'visible and accessible labels must agree after revealing');
    t.onclick();
    assert.ok(t.getAttribute('aria-label').includes(t.textContent.trim()));
  });
  await test('editing existing students neither adds nor submits a password', async () => {
    const f = formFixture({ id: 19, name: 'QA', username: 'qa-existing', grade: '四年级', stage: 'primary', status: 1 });
    assert.ok(!f.nodes.fPwd && !f.nodes.fPwdToggle);
    Object.assign(f.nodes.fGrade, { value: '四年级' }); Object.assign(f.nodes.fStage, { value: 'primary' });
    Object.assign(f.nodes.fExpire, { value: '2030-12-31' });
    await f.opts.onOk(f.wrap, () => false);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.method, 'PUT');
    assert.ok(!Object.prototype.hasOwnProperty.call(f.requests[0].options.body, 'password'));
  });
  await test('new student submission preserves explicit values and the existing empty-value fallback', async () => {
    for (const value of ['', 'SYNTHETIC-FORM-ONLY']) {
      const f = formFixture(); const initial = f.nodes.fPwd.value;
      assert.ok(Boolean(initial), 'existing initial value must not silently become empty');
      for (const [id, v] of Object.entries({ fName: 'QA memory only', fUser: 'qa-new', fGrade: '四年级', fStage: 'primary', fExpire: '2030-12-31', fPwd: value })) f.nodes[id].value = v;
      await f.opts.onOk(f.wrap, () => false);
      assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.method, 'POST');
      assert.ok(f.requests[0].options.body.password === (value || initial), 'submission policy must remain unchanged');
    }
  });
  await test('invalid batch rows disclose neither credential nor extra row contents', () => {
    const f = batchFixture();
    try {
      const sentinel = 'SYNTHETIC-DO-NOT-ECHO';
      const result = f.run([
        { name: '', username: 'qa-invalid', password: sentinel, extra: 'PRIVATE-ROW-MARKER' },
        { name: 'QA invalid', username: '', password: sentinel },
      ]);
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(sentinel), 'batch errors must not echo the submitted credential');
      assert.ok(!serialized.includes('PRIVATE-ROW-MARKER'), 'batch errors must not serialize the row');
      assert.equal(result.count, 0); assert.equal(result.errs.length, 2);
      assert.ok(result.errs[0].includes('1') && result.errs[1].includes('2'), 'errors must identify their input row');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    } finally { f.db.close(); }
  });
  await test('batch keeps partial success and omitted-password fallback behavior', () => {
    const f = batchFixture();
    try {
      const result = f.run([
        { name: '', username: 'qa-invalid', password: 'SYNTHETIC-DO-NOT-ECHO' },
        { name: 'QA memory only', username: 'qa-valid', grade: '四年级', expire_at: '2030-12-31' },
      ]);
      assert.equal(result.count, 1); assert.equal(result.errs.length, 1);
      const row = f.db.prepare('SELECT username,password FROM users').get();
      assert.ok(row.username === 'qa-valid' && row.password === 'in-memory-test-hash');
      assert.ok(f.hashedInputs.length === 1 && f.hashedInputs[0] === formFixture().nodes.fPwd.value, 'omitted password must retain the existing form/server fallback contract');
    } finally { f.db.close(); }
  });
  console.log(`${pass} passed, ${fail} failed; in-memory behavior only, no live accounts used`);
  if (fail) process.exitCode = 1;
})();
