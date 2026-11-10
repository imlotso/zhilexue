'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const sourceRoot = process.env.GRADES_SOURCE_ROOT || __dirname;
const base = path.join(sourceRoot, 'public/apps/grades');
const legacyKey = 'campus_grade_db_v1';
const key = (id = 101, role = 'admin') => `campus_grade_db_v2:${role}:${id}`;
const data = (name = 'Synthetic A', score = 77) => ({
  campuses: [{ id: 'br1', name: 'Synthetic campus' }], currentCampusId: 'br1',
  exams: [{ id: 'ex1', campusId: 'br1', name: 'Synthetic exam', date: '2026-11', type: '月考' }],
  records: [{ id: 'r1', campusId: 'br1', examId: 'ex1', studentName: name, score, fullScore: 100, subject: '数学', stage: '初中', date: '2026-11' }],
  students: [], papers: [], parentUploads: []
});
const response = (d, status = 200) => ({ ok: status < 400, status, json: async () => ({ code: status === 200 ? 0 : status, data: d }) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture({ token = 'A', saved = {}, boot = false, fetch: fetcher } = {}) {
  const errors = [], notices = [], calls = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(base, 'index.html'), 'utf8'), { url: 'https://synthetic.test/apps/grades/index.html#/records', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document, ctx = dom.getInternalVMContext();
  await new Promise(resolve => d.readyState === 'loading' ? d.addEventListener('DOMContentLoaded', resolve, { once: true }) : resolve());
  if (token) w.localStorage.setItem('xuexi_admin_token', token);
  for (const [k, v] of Object.entries(saved)) w.localStorage.setItem(k, JSON.stringify(v));
  let quota = false;
  const setItem = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) { if (quota && k.startsWith('campus_grade')) throw new w.DOMException('Quota exceeded', 'QuotaExceededError'); return setItem.call(this, k, v); };
  w.fetch = async (url, options) => {
    calls.push(url);
    if (fetcher) return fetcher(url, options);
    const id = (options.headers.Authorization === 'Bearer B') ? 202 : 101;
    return response(url === '/api/me' ? { id, role: 'admin' } : { role: 'admin', branches: [{ id: 1, name: 'Synthetic campus' }], students: [] });
  };
  const evaluate = code => vm.runInContext(code, ctx);
  for (const s of d.querySelectorAll('script[src]')) {
    if (s.src.includes('/vendor/') || (!boot && s.src.endsWith('/app.js'))) continue;
    const filename = path.join(sourceRoot, 'public', new URL(s.src).pathname);
    if (fs.existsSync(filename)) vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  }
  evaluate('U.toast = (...args) => window.__notices.push(args)'); w.__notices = notices;
  if (boot) { d.dispatchEvent(new w.Event('DOMContentLoaded')); await new Promise(r => setTimeout(r, 10)); }
  else evaluate('globalThis.App = { refresh() {}, chart() {} }');
  return { w, d, evaluate, calls, notices, errors, quota: v => { quota = v; }, close() { dom.window.close(); } };
}
const state = f => JSON.parse(f.evaluate('JSON.stringify(Store.state)'));
async function ready(f) { f.evaluate('Store.load()'); assert.equal(await f.evaluate('Store.syncRoster()'), true); }

test('F7: unauthenticated load never reads or adopts unowned v1 data', async () => {
  const f = await fixture({ token: '', saved: { [legacyKey]: data() } });
  try { f.evaluate('Store.load()'); assert.equal(state(f).records.length, 0); assert.equal(await f.evaluate('Store.syncRoster()'), false); assert.equal(state(f).records.length, 0); assert.equal(f.calls.length, 0); assert.equal(JSON.parse(f.w.localStorage.getItem(legacyKey)).records[0].score, 77); } finally { f.close(); }
});
test('F7: verify identity and roster before opening only that account storage', async () => {
  const f = await fixture({ saved: { [legacyKey]: data('Unowned'), [key()]: data(), [key(202)]: data('Synthetic B', 42) } });
  try { f.evaluate('Store.load()'); assert.equal(state(f).records.length, 0); await ready(f); assert.deepEqual(f.calls, ['/api/me', '/api/admin/grades-roster']); assert.equal(state(f).records[0].score, 77); f.w.localStorage.setItem('xuexi_admin_token', 'B'); await ready(f); assert.equal(state(f).records[0].studentName, 'Synthetic B'); assert.equal(JSON.parse(f.w.localStorage.getItem(key())).records[0].score, 77); } finally { f.close(); }
});
test('F7: identity 401 and roster 403 fail closed even with cached account data', async () => {
  for (const denied of ['/api/me', '/api/admin/grades-roster']) {
    const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() }, fetch: async url => response(url === '/api/me' ? { id: 101, role: 'admin' } : {}, url === denied ? (denied === '/api/me' ? 401 : 403) : 200), boot: true });
    try { assert.equal(state(f).records.length, 0); assert.match(f.d.querySelector('#mainView').textContent, /登录|验证/); assert.doesNotMatch(f.d.querySelector('#mainView').textContent, /Synthetic A/); f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange')); assert.equal(state(f).records.length, 0); } finally { f.close(); }
  }
});
test('F7: late account A response cannot replace B or revive signed-out state', async () => {
  const slow = deferred();
  const f = await fixture({ saved: { [key()]: data(), [key(202)]: data('Synthetic B', 42) }, fetch: (url, opts) => opts.headers.Authorization === 'Bearer A' ? slow.promise : Promise.resolve(response(url === '/api/me' ? { id: 202, role: 'admin' } : { branches: [{ id: 1, name: 'B' }], students: [] })) });
  try { const old = f.evaluate('Store.syncRoster()'); f.w.localStorage.setItem('xuexi_admin_token', 'B'); await ready(f); slow.resolve(response({ id: 101, role: 'admin' })); assert.equal(await old, false); assert.equal(state(f).records[0].score, 42); f.w.localStorage.removeItem('xuexi_admin_token'); assert.equal(f.evaluate('Store.records().length'), 0); } finally { f.close(); }
});
test('F7: cross-tab logout immediately closes old data and edit modal', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() }, boot: true });
  try { assert.equal(state(f).records.length, 1); f.evaluate("ViewImport.openEditRecord('ex1','Synthetic A')"); assert.equal(f.d.querySelector('#modalRoot').hidden, false); f.w.localStorage.removeItem('xuexi_admin_token'); f.w.dispatchEvent(new f.w.StorageEvent('storage', { key: 'xuexi_admin_token', oldValue: 'A', newValue: null })); assert.equal(state(f).records.length, 0); assert.equal(f.d.querySelector('#modalRoot').hidden, true); assert.doesNotMatch(f.d.querySelector('#mainView').textContent, /Synthetic A/); } finally { f.close(); }
});
test('F8: quota failure throws, rolls back memory, preserves disk, and reports an error', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() } });
  try { await ready(f); const before = f.w.localStorage.getItem(key()); f.quota(true); assert.throws(() => f.evaluate("Store.updateRecord('r1',{score:88})"), /存储|保存|Quota/); assert.equal(state(f).records[0].score, 77); assert.equal(f.w.localStorage.getItem(key()), before); assert.ok(f.notices.some(n => n[1] === 'err')); assert.ok(!f.notices.some(n => n[1] === 'ok')); } finally { f.close(); }
});
test('F8: failed edit keeps user input; retry writes once and cancel changes nothing', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() } });
  try { await ready(f); f.evaluate("ViewImport.openEditRecord('ex1','Synthetic A')"); f.d.querySelector('[data-f=score]').value = '88'; f.quota(true); f.d.querySelector('#erOk').click(); assert.equal(state(f).records[0].score, 77); assert.equal(f.d.querySelector('#modalRoot').hidden, false); assert.equal(f.d.querySelector('[data-f=score]').value, '88'); assert.ok(!f.notices.some(n => n[1] === 'ok')); assert.deepEqual(f.errors, []); f.quota(false); f.d.querySelector('#erOk').click(); assert.equal(state(f).records.length, 1); assert.equal(state(f).records[0].score, 88); assert.equal(JSON.parse(f.w.localStorage.getItem(key())).records[0].score, 88); f.evaluate("ViewImport.openEditRecord('ex1','Synthetic A')"); f.d.querySelector('[data-f=score]').value = '99'; f.d.querySelector('[data-close]').click(); assert.equal(state(f).records[0].score, 88); } finally { f.close(); }
});
test('F8: compound new exam and score save is atomic on failure, retry is not duplicated', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() } });
  try { await ready(f); f.evaluate('ViewImport.openManualModal()'); for (const [id, value] of Object.entries({ mName: 'Synthetic New', mStage: '初中', mSubject: '数学', mFull: '100', mScore: '80', mExamName: 'New exam' })) f.d.getElementById(id).value = value;
    f.quota(true); f.d.querySelector('#mOk').click(); assert.equal(state(f).exams.length, 1); assert.equal(state(f).records.length, 1); assert.equal(f.d.querySelector('#mName').value, 'Synthetic New'); assert.deepEqual(f.errors, []); f.quota(false); const button = f.d.querySelector('#mOk'); button.click(); button.click(); assert.equal(state(f).exams.length, 2); assert.equal(state(f).records.length, 2);
  } finally { f.close(); }
});
test('F8: failed student question save never mutates the live paper object or input', async () => {
  const d = data(); d.papers.push({ id: 'p1', campusId: 'br1', examId: 'ex1', subject: '数学', questions: [{ no: 1, knowledge: '方程', full: 10, avgScore: 7, scores: { 'Synthetic A': 6 } }] });
  const f = await fixture({ saved: { [legacyKey]: d, [key()]: d } });
  try { await ready(f); f.evaluate("ViewKnowledge.openScoreEntry(Store.paper('ex1','数学'),'Synthetic A')"); f.d.querySelector('[data-si]').value = '9'; f.quota(true); f.d.querySelector('#seOk').click(); assert.equal(state(f).papers[0].questions[0].scores['Synthetic A'], 6); assert.equal(f.d.querySelector('[data-si]').value, '9'); assert.deepEqual(f.errors, []); f.quota(false); f.d.querySelector('#seOk').click(); assert.equal(state(f).papers[0].questions[0].scores['Synthetic A'], 9); } finally { f.close(); }
});
async function parent() { const dom = new JSDOM(fs.readFileSync(path.join(base, 'parent-upload.html'), 'utf8'), { url: 'https://synthetic.test/apps/grades/parent-upload.html?c=br1', runScripts: 'outside-only' }); const w = dom.window; let calls = 0; w.fetch = () => { calls++; throw Error('unexpected upload'); }; w.eval(w.document.querySelector('script').textContent); const d = w.document; for (const [id, value] of Object.entries({ pName: '<img src=x onerror=alert(1)>', pExam: 'Audit exam', pSubject: '数学', pFull: '100', pScore: '80' })) d.getElementById(id).value = value; return { dom, w, d, calls: () => calls }; }
test('F9: parent entry, CTA and success all say local demo, never imply teacher delivery', async () => {
  const f = await parent(); try { assert.match(f.d.querySelector('#pSubmit').textContent, /本机/); assert.match(f.d.querySelector('#puCampusLine').textContent, /演示|本机/); const button = f.d.querySelector('#pSubmit'); button.click(); button.click(); assert.match(f.d.querySelector('#puCard').textContent, /未发送给老师/); assert.equal(f.calls(), 0); assert.equal(f.w.localStorage.getItem(legacyKey), null); assert.equal(f.d.querySelector('#puCard img'), null); const payloads = Object.keys(f.w.localStorage).map(k => JSON.parse(f.w.localStorage.getItem(k))); assert.equal(payloads.reduce((n, p) => n + (p.parentUploads || []).length, 0), 1); } finally { f.dom.window.close(); }
});
test('F9: parent quota failure keeps filled draft, no success; retry remains one item', async () => {
  const f = await parent(); try { const original = f.w.Storage.prototype.setItem; f.w.Storage.prototype.setItem = () => { throw Error('Quota'); }; f.d.querySelector('#pSubmit').click(); assert.match(f.d.querySelector('#pErr').textContent, /失败/); assert.equal(f.d.querySelector('#pScore').value, '80'); assert.equal(f.d.querySelector('#puForm') !== null, true); f.w.Storage.prototype.setItem = original; f.d.querySelector('#pSubmit').click(); assert.match(f.d.querySelector('#puCard').textContent, /未发送给老师/); } finally { f.dom.window.close(); }
});
test('F9: teacher QR modal explains cross-device non-delivery, not server review', async () => {
  const f = await fixture(); try { await ready(f); f.evaluate('ViewImport.openQRModal()'); assert.match(f.d.querySelector('#modalBox').textContent, /本机演示/); assert.match(f.d.querySelector('#modalBox').textContent, /不会.*老师|未发送给老师/); assert.doesNotMatch(f.d.querySelector('#modalBox').textContent, /提交后进入「待审核」|后端写入数据库/); } finally { f.close(); }
});
test('F10: aggregate score cannot generate differing question scores or diagnoses', async () => {
  const f = await fixture(); try { const q = JSON.parse(f.evaluate("JSON.stringify(Knowledge.autoQuestions('数学',0.72,12))")); assert.ok(q.every(x => x.avgScore == null && Object.keys(x.scores).length === 0)); const result = JSON.parse(f.evaluate("JSON.stringify(Knowledge.analyzePaper({questions: Knowledge.autoQuestions('数学',0.72,12)}))")); assert.equal(result.items.length, 0); assert.equal(result.overall, null); } finally { f.close(); }
});
test('F10: old automatic, unconfirmed, missing and invalid data cannot become zero or weak points', async () => {
  const f = await fixture(); try { const r = JSON.parse(f.evaluate(`JSON.stringify(Knowledge.analyzePaper({questions:[{no:1,knowledge:'旧自动',full:10,avgScore:3,auto:true},{no:2,knowledge:'缺失',full:10,avgScore:null},{no:3,knowledge:'未确认',full:10,avgScore:4,confirmed:false},{no:4,knowledge:'超满分',full:10,avgScore:11},{no:5,knowledge:'空白',full:10,avgScore:'   '},{no:6,knowledge:'非数值',full:10,avgScore:false}]}))`)); assert.equal(r.items.length, 0); assert.equal(r.overall, null); } finally { f.close(); }
});
test('F10: valid manual class data retained, individual diagnosis uses only actual personal scores', async () => {
  const f = await fixture(); try { const paper = JSON.stringify({ subject: '数学', questions: [{ no: 1, knowledge: '方程', full: 10, avgScore: 8, scores: { A: 6 } }, { no: 2, knowledge: '几何', full: 10, avgScore: 2, scores: {} }] }); assert.equal(f.evaluate(`Knowledge.analyzePaper(${paper}).items.length`), 2); const individual = JSON.parse(f.evaluate(`JSON.stringify(Knowledge.analyzeStudent(${paper},'A',0.9))`)); assert.equal(individual.items.length, 1); assert.equal(individual.items[0].rate, 0.6); assert.equal(f.evaluate(`Knowledge.analyzeStudent(${paper},'B',0.9).items.length`), 0); } finally { f.close(); }
});
test('F10: empty / old automatic paper shows pending state without radar and false paper provenance', async () => {
  const d = data(); d.papers.push({ id: 'p1', examId: 'ex1', campusId: 'br1', subject: '数学', auto: true, questions: [{ no: 1, knowledge: '旧自动', full: 10, avgScore: 2, auto: true, scores: {} }] });
  const f = await fixture({ saved: { [key()]: d, [legacyKey]: d } });
  try { await ready(f); f.evaluate("ViewKnowledge.render(document.getElementById('mainView'))"); assert.match(f.d.querySelector('#mainView').textContent, /待录入|待确认/); assert.doesNotMatch(f.d.querySelector('#mainView').textContent, /由试卷快照自动生成|20%|薄弱点/); f.evaluate("ViewProfile.render(document.getElementById('mainView'),'Synthetic A')"); assert.equal(f.d.querySelector('#pKnRadar'), null); assert.match(f.d.querySelector('#mainView').textContent, /待录入|待确认/); } finally { f.close(); }
});

function imageBoundary(f) {
  f.w.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,AA=='; this.onload(); } };
  f.w.Image = class { constructor() { this.width = this.height = 1; } set src(value) { this.onload(); } };
  f.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  f.w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA==';
}
test('F10: attaching a photo to manual grades retains manually entered question evidence', async () => {
  const d = data(); const questions = [{ no: 1, knowledge: '方程', full: 10, avgScore: 8, scores: { 'Synthetic A': 7 } }];
  d.papers = [{ id: 'p1', examId: 'ex1', campusId: 'br1', subject: '数学', questions }];
  const f = await fixture({ saved: { [legacyKey]: d, [key()]: d } });
  try { await ready(f); imageBoundary(f); f.evaluate("ViewImport.openManualModal('ex1')"); for (const [id, value] of Object.entries({mName:'Synthetic New',mStage:'初中',mSubject:'数学',mFull:'100',mScore:'80'})) f.d.getElementById(id).value=value;
    const input=f.d.querySelector('#imageInput'); Object.defineProperty(input,'files',{ configurable:true, value:[{ name:'synthetic.png' }] }); await input.onchange(); f.d.querySelector('#mOk').click(); assert.equal(state(f).papers[0].images.length,1); assert.deepEqual(state(f).papers[0].questions,questions); assert.ok(!f.notices.some(n=>/生成知识点诊断/.test(n[0])));
  } finally { f.close(); }
});
test('F10: photo-only paper saves a pending snapshot, not generated questions', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() } });
  try { await ready(f); imageBoundary(f); f.evaluate("ViewImport.openPaperModal('ex1','数学')"); const input=f.d.querySelector('#imageInput'); Object.defineProperty(input,'files',{ configurable:true, value:[{ name:'synthetic.png' }] }); await input.onchange(); f.d.querySelector('#ppSave').click(); assert.equal(state(f).papers.length,1); assert.equal(state(f).papers[0].images.length,1); assert.equal(state(f).papers[0].questions.length,0); assert.equal(f.evaluate("Knowledge.analyzePaper(Store.paper('ex1','数学')).items.length"),0);
  } finally { f.close(); }
});
test('F8: deleting after confirmation keeps confirmation open on quota failure and cancellation is safe', async () => {
  const f = await fixture({ saved: { [legacyKey]: data(), [key()]: data() } });
  try { await ready(f); f.evaluate('ViewImport.openDataModal()'); f.d.querySelector('[data-delexam]').click(); f.quota(true); f.d.querySelector('#__ok').click(); assert.equal(state(f).exams.length,1); assert.equal(f.d.querySelector('#modalRoot').hidden,false); assert.ok(f.d.querySelector('#__ok')); assert.deepEqual(f.errors,[]); f.d.querySelector('[data-close]').click(); assert.equal(state(f).records.length,1); f.quota(false); f.evaluate('ViewImport.openDataModal()'); f.d.querySelector('[data-delexam]').click(); f.d.querySelector('#__ok').click(); assert.equal(state(f).records.length,0); assert.equal(state(f).exams.length,0);
  } finally { f.close(); }
});
test('F8: approving a pending record and photo is atomic, and retry preserves question data', async () => {
  const d=data(); d.papers=[{ id:'p1',campusId:'br1',examId:'ex1',subject:'数学',questions:[{ no:1,knowledge:'方程',full:10,avgScore:7,scores:{} }] }]; d.parentUploads=[{ id:'u1',campusId:'br1',examId:'ex1',studentName:'Synthetic A',subject:'数学',fullScore:100,score:88,status:'pending',images:[{name:'synthetic.png',dataUrl:'data:image/png;base64,AA=='}] }];
  const f=await fixture({saved:{[legacyKey]:d,[key()]:d}});
  try { await ready(f); f.evaluate('ViewImport.showPendingUploads()'); f.quota(true); f.d.querySelector('[data-ok]').click(); assert.equal(state(f).records[0].score,77); assert.equal(state(f).parentUploads[0].status,'pending'); assert.ok(f.d.querySelector('[data-ok]')); f.quota(false); f.d.querySelector('[data-ok]').click(); assert.equal(state(f).records.length,1); assert.equal(state(f).records[0].score,88); assert.equal(state(f).parentUploads[0].status,'approved'); assert.deepEqual(state(f).papers[0].questions,d.papers[0].questions); assert.equal(f.d.querySelector('[data-ok]'),null); assert.deepEqual(f.errors,[]);
  } finally { f.close(); }
});
test('F8: cancelled asynchronous Excel parsing cannot write or disturb the next modal', async () => {
  const f=await fixture({saved:{[legacyKey]:data(),[key()]:data()}}); const slow=deferred();
  try { await ready(f); f.w.pendingFile=slow.promise; f.evaluate('Excel.readFile = () => window.pendingFile; ViewImport.openUploadModal()'); const file=f.d.querySelector('#fileInput'); Object.defineProperty(file,'files',{configurable:true,value:[{name:'synthetic.xlsx'}]}); file.onchange(); f.d.querySelector('[data-close]').click(); f.evaluate("ViewImport.openEditRecord('ex1','Synthetic A')"); slow.resolve({rows:[{studentName:'Synthetic New',subject:'数学',score:80,fullScore:100}],headerRow:1,columns:[],errors:[]}); await new Promise(r=>setTimeout(r,0)); assert.ok(f.d.querySelector('#erOk')); assert.equal(state(f).records.length,1); assert.deepEqual(f.errors,[]);
  } finally { f.close(); }
});
test('F10: expanded record has truthful pending text without automatic photo provenance', async () => {
  const d=data(); d.papers=[{id:'p1',campusId:'br1',examId:'ex1',subject:'数学',auto:true,questions:[{no:1,knowledge:'旧自动',full:10,avgScore:2,auto:true,scores:{}}]}];
  const f=await fixture({saved:{[key()]:d,[legacyKey]:d},boot:true});
  try { f.d.querySelector('.row-toggle').click(); assert.doesNotMatch(f.d.querySelector('.detail-box').textContent,/已按试卷自动生成|AI 自动生成|无明显薄弱点/); assert.match(f.d.querySelector('.detail-box').textContent,/待录入|待确认/); } finally { f.close(); }
});
test('F8: newer Excel selection wins over a late old file, and failed import retries atomically', async () => {
  const f=await fixture({saved:{[legacyKey]:data(),[key()]:data()}}); const old=deferred(), latest=deferred();
  const parsed=name=>({rows:[{studentName:name,subject:'数学',score:80,fullScore:100,stage:'初中',_row:2}],headerRow:1,colMap:{name:0,subject:1},errors:[]});
  try { await ready(f); f.w.fileReads=[old.promise,latest.promise]; f.evaluate('Excel.readFile = () => window.fileReads.shift(); ViewImport.openUploadModal()'); const file=f.d.querySelector('#fileInput'); Object.defineProperty(file,'files',{configurable:true,value:[{name:'old.xlsx'}]}); file.onchange(); Object.defineProperty(file,'files',{configurable:true,value:[{name:'latest.xlsx'}]}); file.onchange(); latest.resolve(parsed('Synthetic Latest')); await new Promise(r=>setTimeout(r,0)); old.resolve(parsed('Synthetic Old')); await new Promise(r=>setTimeout(r,0)); assert.match(f.d.querySelector('#upPreview').textContent,/Synthetic Latest/); assert.doesNotMatch(f.d.querySelector('#upPreview').textContent,/Synthetic Old/);
    f.d.querySelector('#upName').value='Import exam'; f.quota(true); f.d.querySelector('#upOk').click(); assert.equal(state(f).records.length,1); assert.equal(state(f).exams.length,1); assert.ok(f.d.querySelector('#upOk')); f.quota(false); f.d.querySelector('#upOk').click(); assert.equal(state(f).records.length,2); assert.equal(state(f).exams.length,2); assert.equal(state(f).records[1].studentName,'Synthetic Latest'); assert.deepEqual(f.errors,[]);
  } finally { f.close(); }
});
test('F9/F10: exported template instructions match local-only and manual diagnosis capability', async () => {
  const f=await fixture(); let workbook; const XLSX=require('xlsx');
  try { f.w.XLSX={...XLSX,writeFile:wb=>{workbook=wb;}}; f.evaluate('Excel.downloadTemplate()'); const guide=XLSX.utils.sheet_to_csv(workbook.Sheets['使用说明']); assert.match(guide,/本机演示/); assert.match(guide,/不会发送给老师/); assert.match(guide,/逐题/); assert.doesNotMatch(guide,/将自动生成|无需逐题录入|提交后进入待审核/); } finally { f.close(); }
});
test('F7: safe reads during pending verification do not cancel the matching identity request', async () => {
  const gate=deferred(); const f=await fixture({saved:{[key()]:data()},fetch:url=>url==='/api/me'?gate.promise:Promise.resolve(response({branches:[{id:1,name:'Synthetic campus'}],students:[]}))});
  try { const pending=f.evaluate('Store.syncRoster()'); assert.equal(state(f).records.length,0); assert.equal(f.evaluate('Store.records().length'),0); gate.resolve(response({id:101,role:'admin'})); assert.equal(await pending,true); assert.equal(state(f).records[0].score,77); } finally { f.close(); }
});
test('F8: unreadable existing account storage fails closed rather than creating a writable empty account', async () => {
  const f=await fixture({saved:{[key()]:data()}}); const get=f.w.Storage.prototype.getItem;
  try { f.w.Storage.prototype.getItem=function(k){if(k===key())throw Error('Storage read denied');return get.call(this,k);}; assert.equal(await f.evaluate('Store.syncRoster()'),false); assert.equal(state(f).records.length,0); assert.throws(()=>f.evaluate("Store.addExam({name:'Do not replace',date:'2026-11'})"),/登录|验证/); f.w.Storage.prototype.getItem=get; assert.equal(JSON.parse(f.w.localStorage.getItem(key())).records[0].score,77); } finally { f.close(); }
});
