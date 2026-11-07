'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'public/admin/bankui.js'), 'utf8');
async function fixture(extraAssignees = []) {
  const paper = { id: 7, title: '合成已下发卷', status: 'published', assign_count: 2, q_count: 1, due_at: '2026-11-08T12:00:00Z' };
  const posts = [], nodes = new Map(), buttons = new Map(), confirms = [];
  let dialog, accept = false;
  const element = id => { if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', style: {}, addEventListener() {}, querySelectorAll: () => [] }); return nodes.get(id); };
  const box = { ADM: { page: {} }, SUBJECTS: ['数学'], window: {}, setTimeout() {}, clearTimeout() {},
    esc: x => String(x ?? ''), ic: () => '', toast() {}, render() {}, modal: c => { dialog = c; },
    elConfirm: async c => { confirms.push(c); return accept; },
    document: { getElementById: element, querySelectorAll: selector => buttons.get(selector) || [] },
    api: async (url, opts = {}) => {
      if (opts.method === 'POST') { posts.push({ url, body: opts.body }); return {}; }
      if (url.endsWith('/papers')) return [paper];
      if (url.endsWith('/points')) return [];
      if (url.endsWith('/students-options')) return [{ id: 1, name: '合成学生1' }, { id: 2, name: '合成学生2' }, { id: 3, name: '合成学生3' }];
      if (url.endsWith('/assignees')) return [{ user_id: 1 }, { user_id: 2 }, ...extraAssignees];
      if (url.endsWith('/papers/7')) return paper;
      throw Error('Unexpected: ' + url);
    } };
  vm.runInNewContext(source, box); const view = await box.viewPaper();
  for (const match of view.html.matchAll(/<button[^>]*\bdata-(prev|pub|unpub|edit|del)="(\d+)"[^>]*>([^<]*)<\/button>/g)) {
    const [, key, id, text] = match, selector = '[data-' + key + ']'; const a = buttons.get(selector) || []; a.push({ dataset: { [key]: id }, textContent: text }); buttons.set(selector, a);
  }
  view.after(); await Promise.resolve();
  return { view, posts, buttons, confirms, get dialog() { return dialog; }, setAccept(v) { accept = v; }, async open() { const b = buttons.get('[data-pub]')?.[0]; assert.ok(b, 'published paper needs a direct reassignment button'); b.onclick(); await new Promise(r => setImmediate(r)); } };
}
test('published paper directly opens the existing assignment dialog without withdrawing', async () => {
  const f = await fixture(); await f.open(); assert.match(f.dialog.body, /asDue/); assert.equal(f.posts.length, 0);
  await f.dialog.onOk({ querySelector: () => ({ value: '2026-11-09T10:30:00' }) });
  assert.equal(f.posts.length, 1); assert.match(f.posts[0].url, /\/assign$/); assert.deepEqual(Array.from(f.posts[0].body.user_ids), [1, 2]);
});
test('reassignment preserves existing recipients when select-all is unchecked', async () => {
  const f = await fixture(); await f.open();
  const nodes = new Map(); const boxes = [1, 2, 3].map(id => ({ value: String(id), checked: id < 3, disabled: id < 3 }));
  const el = s => { if (!nodes.has(s)) nodes.set(s, { innerHTML: '', value: '', textContent: '' }); return nodes.get(s); };
  const w = { querySelector: el, querySelectorAll: () => boxes }; f.dialog.onMount(w);
  assert.match(el('#asList').innerHTML, /value="1"[^>]*disabled/); assert.match(f.dialog.body, /保留|不会取消/);
  el('#asAll').onchange({ target: { checked: false } }); await f.dialog.onOk({ querySelector: () => ({ value: '' }) });
  assert.deepEqual(Array.from(f.posts[0].body.user_ids), [1, 2]);
});
test('withdrawal warns it clears recipients and cancel has no write', async () => {
  const f = await fixture(); await f.buttons.get('[data-unpub]')[0].onclick(); assert.equal(f.posts.length, 0);
  assert.match(f.confirms[0].message, /名单/); assert.match(f.confirms[0].message, /作答.*保留|保留.*作答/);
  f.setAccept(true); await f.buttons.get('[data-unpub]')[0].onclick(); assert.equal(f.posts.length, 1); assert.equal(f.posts[0].body.publish, 0);
});

test('inactive prior recipients stay in history but are not resubmitted as new active recipients', async () => {
  const f = await fixture([{ user_id: 99 }]); await f.open(); await f.dialog.onOk({ querySelector: () => ({ value: '2026-11-09T10:30:00' }) });
  assert.deepEqual(Array.from(f.posts[0].body.user_ids), [1, 2]); assert.match(f.dialog.body, /历史|不可选/);
});
