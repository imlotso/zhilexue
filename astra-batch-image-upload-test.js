'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = f => fs.readFileSync(f, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(extra = {}) {
  const dom = new JSDOM('<main><textarea id="stem">前文后文</textarea><textarea id="answer"></textarea></main>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window, root = w.document.querySelector('main'), calls = [], notices = [], uploads = [];
  w.Auth = { token: 'synthetic' }; w.toast = (...args) => notices.push(args);
  w.fetch = async (url, opt) => { const file = opt.body.get('file'); calls.push({ url, file }); return uploads.length ? await uploads.shift()(file) : { ok: true, json: async () => ({ code: 0, data: { url: '/api/file?key=bank/img/' + file.name } }) }; };
  w.eval(read('public/js/mlive.js'));
  w.eval(read('public/admin/formulaui.js'));
  const images = ['/api/file?key=bank/img/existing.png'];
  const controller = w.t8Enhance(root, { fields: ['#stem', '#answer'], images, uploadFields: ['#stem'], ...extra });
  const choose = files => { const input = root.querySelector('.t8-image-input'); assert.ok(input, 'image picker must be available'); Object.defineProperty(input, 'files', { configurable: true, value: files }); input.dispatchEvent(new w.Event('change')); };
  return { dom, w, root, calls, notices, uploads, images, controller, choose, file: (name, type='image/png') => new w.File(['synthetic'], name, { type }) };
}
test('stem picker is next to formula, selects several images, and preserves ordered image references', async () => {
  const f = fixture(); try {
    const bar = f.root.querySelector('#stem').previousElementSibling;
    assert.equal(bar.querySelector('.t8-fx').nextElementSibling?.classList.contains('t8-image-upload'), true);
    assert.equal(f.root.querySelectorAll('.t8-image-upload').length, 1);
    assert.equal(f.root.querySelector('.t8-image-input').multiple, true);
    const stem = f.root.querySelector('#stem'); stem.setSelectionRange(2, 2);
    f.choose([f.file('one.png'), f.file('two.png')]);
    await f.controller.whenIdle();
    assert.deepEqual(f.calls.map(x => x.file.name), ['one.png', 'two.png']);
    assert.equal(stem.value, '前文\n[图2]\n[图3]后文');
    assert.deepEqual(f.images, ['/api/file?key=bank/img/existing.png', '/api/file?key=bank/img/one.png', '/api/file?key=bank/img/two.png']);
  } finally { f.dom.window.close(); }
});
test('partly failed upload keeps successful images and retries only failed files', async () => {
  const f = fixture(); try {
    f.uploads.push(async file => ({ ok: true, json: async () => ({ code: 0, data: { url: '/ok/' + file.name } }) }), async () => { throw new Error('网络中断'); });
    f.choose([f.file('one.png'), f.file('two.png')]); await f.controller.whenIdle();
    assert.equal(f.controller.hasFailures(), true); assert.equal(f.images.length, 2);
    f.root.querySelector('.t8-upload-retry').click(); await f.controller.whenIdle();
    assert.equal(f.controller.hasFailures(), false);
    assert.deepEqual(f.calls.map(x => x.file.name), ['one.png', 'two.png', 'two.png']);
    assert.equal((f.root.querySelector('#stem').value.match(/\[图2\]/g) || []).length, 1);
    assert.match(f.root.textContent, /已上传/);
  } finally { f.dom.window.close(); }
});
test('paste and drop preserve all images, reject nonimages, and do not append after modal closes', async () => {
  const f = fixture(); try {
    const event = new f.w.Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [f.file('one.png'), f.file('two.png'), f.file('bad.txt','text/plain')] } });
    f.root.querySelector('#stem').dispatchEvent(event); await f.controller.whenIdle();
    assert.equal(event.defaultPrevented, true); assert.equal(f.calls.length, 2);
    const wait = deferred(); f.uploads.push(() => wait.promise);
    f.choose([f.file('late.png')]); await tick(); f.root.remove();
    wait.resolve({ ok: true, json: async () => ({ code: 0, data: { url: '/late.png' } }) }); await f.controller.whenIdle();
    assert.equal(f.images.length, 3, 'closed form cannot receive a late image');
  } finally { f.dom.window.close(); }
});
test('upload failures require retry or explicit discard, and the same file can be selected again', async () => {
  const f = fixture(); try {
    f.uploads.push(async () => ({ ok: false, json: async () => ({ code: 500, msg: '上传失败' }) }));
    f.choose([f.file('one.png')]); await f.controller.whenIdle();
    f.root.querySelector('.t8-upload-discard').click(); assert.equal(f.controller.hasFailures(), false);
    assert.equal(f.root.querySelector('.t8-image-input').value, '');
    f.choose([f.file('one.png')]); await f.controller.whenIdle(); assert.equal(f.images.length, 2);
  } finally { f.dom.window.close(); }
});
test('real question edit waits for pending image uploads before saving the entire payload', async () => {
  const f = fixture(); try {
    f.root.innerHTML = ''; let cfg, saved; const wait = deferred();
    const q = { id: 7, type: 'answer', subject: '数学', stage: 'primary', stem: '原题', stem_html: '<p>原富文本</p>', answer: '参考答案', analysis: '原解析', nodes: [10,20], images: ['/old.png'], options: [], tags: ['保留'], source_detail: {} };
    Object.assign(f.w, { MF_API:'/api/admin/bank/mf', MF_TYPE_NAME:{ answer:'解答题' }, MF_SUBJECTS:['数学'], esc: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'), optText:v=>v, treeLabel:t=>t.kind, tpTrees: async()=>[{id:1,kind:'textbook'},{id:2,kind:'knowledge'}], tpOrder:arr=>arr, qcBindDifficultyInputs(){}, t7AudioWidget:()=>({get:()=>'',getLimit:()=>0}), QSubtype:{isMatch:()=>false,fillSelect(){}}, modal(c){cfg=c;f.root.innerHTML=c.body;c.onMount(f.root);}, api:async (url,opt)=>{if(opt?.method==='PUT'){saved=opt.body;return {};} if(url.endsWith('/nodes'))return {list:[{id:url.includes('/1/')?10:20,name:'节点'}]};return {question:q};} });
    f.w.eval(read('public/admin/mfbankui.js') + '\n' + read('public/admin/mfui2.js') + '\nwindow.mfQEdit = mfQEdit;'); await f.w.mfQEdit(7); await tick();
    f.uploads.push(() => wait.promise); f.choose([f.file('new.png')]);
    const saving=cfg.onOk(f.root, message=>{throw new Error(message);}); await tick();
    assert.equal(saved,undefined,'save must wait for upload');
    wait.resolve({ok:true,json:async()=>({code:0,data:{url:'/new.png'}})}); await saving;
    assert.deepEqual(Array.from(saved.images),['/old.png','/new.png']); assert.match(saved.stem,/\[图2\]/);
    assert.equal(saved.stem_html,'', 'edited stem must not be hidden behind stale rich HTML'); assert.equal(saved.analysis,'原解析'); assert.deepEqual(Array.from(saved.tags),['保留']);
  } finally { f.dom.window.close(); }
});

test('a preview callback error cannot cause a successfully uploaded image to be retried or duplicated', async () => {
  const f = fixture({onImage(){throw new Error('preview failed');}}); try {
    f.choose([f.file('one.png'),f.file('two.png')]); await f.controller.whenIdle();
    assert.equal(f.controller.hasFailures(),false); assert.equal(f.images.length,3);
    assert.equal(f.calls.length,2); assert.match(f.root.querySelector('#stem').value,/\[图2\][\s\S]*\[图3\]/);
  } finally { f.dom.window.close(); }
});
test('an empty uploaded asset URL is a failure, not a usable image', async () => {
  const f = fixture(); try {
    f.uploads.push(async()=>({ok:true,json:async()=>({code:0,data:{url:'  '}})}));
    f.choose([f.file('bad.png')]); await f.controller.whenIdle();
    assert.equal(f.controller.hasFailures(),true); assert.equal(f.images.length,1);
    assert.doesNotMatch(f.root.querySelector('#stem').value,/\[图2\]/);
  } finally { f.dom.window.close(); }
});
