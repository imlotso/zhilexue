'use strict';
// Real complete frontend sources in VM/jsdom, synthetic API/storage/timers only.
// No browser geometry, real account, AI service, database or network is exercised.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(require('node:path').join(__dirname, file), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((r,j) => { resolve=r; reject=j; }); return {promise,resolve,reject}; };
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function fixture(t, html='') {
  const dom = new JSDOM('<body>'+html+'</body>', {url:'http://localhost/'});
  t.after(() => dom.window.close());
  const timers = [], calls = [];
  const box = vm.createContext({ window:dom.window, document:dom.window.document, localStorage:dom.window.localStorage,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window), Auth:{user:{id:'A'},token:'token-A',clear(){this.user=null;this.token='';}},
    setTimeout:fn=>(timers.push(fn),timers.length), clearTimeout(){}, setInterval:fn=>(timers.push(fn),timers.length),clearInterval(){},
    console, esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    api:async url=>{ calls.push(url); throw Error('Unexpected API: '+url); },
  });
  vm.runInContext(read('public/js/words.js'),box);
  const run = text => vm.runInContext(text,box);
  run("WT.books=[{id:1,title:'Words',kind:'word',word_count:1},{id:2,title:'Phrases',kind:'phrase',phrase_count:1}];WT.bookId='1';WT.pf=true;");
  return {box,run,dom,timers,calls};
}
function vueFixture(extra={}) {
  let app;
  const box=vm.createContext({canPreview(){},fileKind(){},fmtSize(){}, Vue:{createApp:a=>(app=a,{mount(){}})},Auth:{user:{id:'A'},token:'A'},...extra});
  vm.runInContext(read('public/js/vue-app.js'),box);
  const state={page:'course',courseId:'1',course:null,subject:'英语',cats:['同步基础'],category:'同步基础',...app.methods};
  return {box,state,app};
}
function resolveWordJobs(pending, book=1, word='apple') {
  pending.get('/api/stu/word/words?book_id='+book).resolve([{id:book,word,unit:'U1'}]);
  for(const ep of ['sentences','pos']) pending.get('/api/stu/word/'+ep+'?book_id='+book).resolve([]);
}
function delayedApi(f) {
  const pending=new Map(); f.box.api=url=>{ const d=deferred();pending.set(url,d);return d.promise; }; return pending;
}
test('F1: word history survives removal and never overwrites sentence history', t=>{
  const f=fixture(t); f.run("WT.curSub='quick';wtWrongWordAdd({id:7,word:'apple'},'默写');wtWrongWordAdd({id:7,word:'apple'},'默写');wtWrongWordRemove(7);");
  const key='xuexi_wtwdh:A:1';
  assert.equal(JSON.parse(f.box.localStorage.getItem(key))?.['7']?.cnt,2);
  f.run("WT.curSub='build';wtWrongAdd({id:7,text:'I like apples.'});");
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwsh:A:1:build'))['7'].text,'I like apples.');
  f.run("WT.curSub='quick';wtWrongWordOpen();");
  assert.match(f.dom.window.document.body.textContent,/历史共 1 词/);
  f.dom.window.document.querySelector('.close-x').click();
  f.run("WT.curSub='listen';wtWrongAdd({id:7,text:'Listen carefully.'},'listen');");
  assert.equal(JSON.parse(f.box.localStorage.getItem(key))['7'].word,'apple');
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwsh:A:1:listen'))['7'].cnt,1);
});
test('F1: legacy current wrong words migrate into word history without touching sentence history', t=>{
  const f=fixture(t); f.box.localStorage.setItem('xuexi_wtwd:A:1',JSON.stringify([{id:9,word:'old',cnt:3,t:1}]));
  f.box.localStorage.setItem('xuexi_wtwsh:A:1:build',JSON.stringify({9:{id:9,text:'Old sentence',cnt:4}}));
  f.run("WT.curSub='quick';wtWrongWordOpen();");
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwdh:A:1'))?.['9']?.cnt,3);
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwsh:A:1:build'))['9'].cnt,4);
});
test('F2: later course navigation wins regardless of completion order',async()=>{
  const pending=new Map(); const f=vueFixture({api:url=>{const d=deferred();pending.set(url,d);return d.promise;}});
  const old=f.state.loadCourse(); f.state.courseId='2'; const current=f.state.loadCourse();
  pending.get('/api/stu/course-detail?id=2').resolve({id:2,subject:'英语',grouped:true,groups:[{id:20}]});await current;
  pending.get('/api/stu/course-detail?id=1').resolve({id:1,subject:'数学',grouped:true,groups:[{id:10}]});await old;
  assert.equal(f.state.course.id,2);assert.equal(f.state.subject,'英语');assert.equal(f.state.activeGroupId,20);
});
for(const change of ['leave','account','token','same-course-repeat']) test('F2: course response cannot revive after '+change,async()=>{
  const requests=[];const f=vueFixture({api:()=>{const d=deferred();requests.push(d);return d.promise;}});
  const old=f.state.loadCourse();
  if(change==='leave') f.state.page='home';
  if(change==='account') f.box.Auth.user={id:'B'};
  if(change==='token') f.box.Auth.token='new-session';
  if(change==='same-course-repeat'){const latest=f.state.loadCourse();requests[1].resolve({id:1,title:'latest'});await latest;}
  const expected=f.state.course;requests[0].resolve({id:1,title:'old'});await old;
  assert.strictEqual(f.state.course,expected);
});
test('F3: late word response never replaces the current phrase dataset',async t=>{
  const f=fixture(t),pending=delayedApi(f); const old=f.run("wtEnsureData('quick')");
  f.run("WT.bookId='2'");const latest=f.run("wtEnsureData('phrase')");
  pending.get('/api/stu/word/phrases?book_id=2').resolve([{id:2,phrase:'take care'}]);await latest;
  resolveWordJobs(pending);await old;
  assert.equal(f.run('WT.data.words[0]?.word'),'take care');assert.equal(f.run('WT.curSub'),'phrase');
});
test('F3: late book-list response cannot select a book for an obsolete module',async t=>{
  const f=fixture(t),book1=deferred(),book2=deferred();let count=0;
  f.run('WT.books=null'); f.box.api=url=>url.endsWith('/books')?(++count===1?book1:book2).promise:Promise.resolve(url.includes('phrases')?[{id:2,phrase:'new phrase'}]:[]);
  const old=f.run("wtEnsureData('quick')");const latest=f.run("wtEnsureData('phrase')");
  const books=[{id:1,kind:'word',word_count:1},{id:2,kind:'phrase',phrase_count:1}];book2.resolve(books);await latest;book1.resolve(books);await old;
  assert.equal(f.run('WT.curSub'),'phrase');assert.equal(f.run('WT.bookId'),'2');assert.equal(f.run('WT.data.words[0]?.word'),'new phrase');
});
test('F3: moving to a book-free module cancels pending word data',async t=>{
  const f=fixture(t),pending=delayedApi(f);const old=f.run("wtEnsureData('quick')");
  await f.run("viewWords('typing')");const current=f.run('WT.data');resolveWordJobs(pending);await old;
  assert.strictEqual(f.run('WT.data'),current);
});
test('F3: leaving the Vue word pane prevents late DOM hooks and WT writes',async t=>{
  const f=fixture(t),pending=delayedApi(f);const v=vueFixture();let after=0; const result=deferred();
  v.box.viewWords=()=>result.promise;const pane={seq:0,sub:'quick',$el:f.dom.window.document.body,...v.app.components.WordsPane.methods};
  const painting=pane.paint();const old=f.run("wtEnsureData('quick')");v.box.wtCancelDataLoad=f.box.wtCancelDataLoad;
  v.app.components.WordsPane.beforeUnmount?.call(pane);
  const html=pane.$el.innerHTML;result.resolve({html:'obsolete',after(){after++;}});await painting;
  const data=f.run('WT.data');resolveWordJobs(pending);await old;
  assert.equal(pane.$el.innerHTML,html);assert.equal(after,0);assert.strictEqual(f.run('WT.data'),data);
});
test('F3: quick repeated loads ignore earlier data for the same book',async t=>{
  const f=fixture(t),requests=[];f.box.api=url=>{const d=deferred();requests.push({url,...d});return d.promise;};
  const old=f.run("wtEnsureData('quick')"),latest=f.run("wtEnsureData('quick')");
  for(const r of requests.slice(3))r.resolve(r.url.includes('/words?')?[{id:2,word:'latest'}]:[]);await latest;
  for(const r of requests.slice(0,3))r.resolve(r.url.includes('/words?')?[{id:1,word:'obsolete'}]:[]);await old;
  assert.equal(f.run('WT.data.words[0].word'),'latest');
  await f.run("wtEnsureData('quick')");assert.equal(f.run('WT.data.words[0].word'),'latest');
});
test('F4: switching accounts refetches stats and clears old in-memory selections and practice',async t=>{
  const f=fixture(t);let stats=0;f.box.api=async url=>{if(url.includes('/stats?'))return ++stats===1?{quick:{correct:17,wrong:3}}:{quick:{correct:1,wrong:1}};if(url.endsWith('/books'))return [{id:1,title:'Words',kind:'word',word_count:1}];return [];};
  await f.run("wtShell('quick','')");f.run("WT.quick.right=17;WT.groupDefs=[{old:true}]");f.box.Auth.user={id:'B'};f.box.Auth.token='B';
  f.run('wtSubStateSync()');const out=await f.run("wtShell('quick','')");
  assert.equal(stats,2);assert.equal(f.run('WT.quick.right'),0);assert.equal(f.run('WT.groupDefs'),null);assert.match(out.html,/已练 <b>2<\/b> 题/);assert.doesNotMatch(out.html,/已练 <b>20<\/b>/);
});
test('F4: late stats from account A cannot populate B cache',async t=>{
  const f=fixture(t),oldStats=deferred();let count=0;
  f.box.api=async url=>{if(url.includes('/stats?'))return ++count===1?oldStats.promise:{quick:{correct:2,wrong:0}};if(url.endsWith('/books'))return [{id:1,kind:'word',word_count:1}];return [];};
  const old=f.run("wtShell('quick','')");await flush();f.box.Auth.user={id:'B'};f.box.Auth.token='B';
  await f.run("wtShell('quick','')");oldStats.resolve({quick:{correct:99,wrong:0}});await old;
  await f.run("wtShell('quick','')");assert.equal(f.run("Object.values(WT.statsCache)[0].quick.correct"),2);assert.equal(count,2);
});
test('F4: confirmed logout clears word caches; cancelled logout preserves them',async t=>{
  const f=fixture(t);let confirmed=false;const v=vueFixture({Auth:f.box.Auth,location:{hash:'#/words/quick'},elConfirm:async()=>confirmed,wtResetAccount:f.box.wtResetAccount,wtStopSpeech:f.box.wtStopSpeech,wtStageOff:f.box.wtStageOff});
  f.run('WT.statsCache={1:{quick:{correct:9,wrong:1}}}');await v.state.logout();assert.equal(f.run('Object.keys(WT.statsCache).length'),1);
  confirmed=true;await v.state.logout();assert.equal(f.run('Object.keys(WT.statsCache).length'),0);assert.equal(f.run('WT.books'),null);
});
function enter(f,target,opts={}){const event=new f.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...opts});target.dispatchEvent(event);return event;}
for(const overlay of ['<div role="dialog"><input id="other"></div>','<div class="mask"><button id="other">取消</button></div>'])test('F5: foreground dialog owns Enter, including stale background focus '+overlay, t=>{
  const f=fixture(t,'<input id="wsInput" value="apple"><button id="wsOk">提交</button>'+overlay);let count=0;f.box.wtSpellSubmit=()=>count++;f.run('wtBindSpellKeys()');
  const d=f.dom.window.document;assert.equal(enter(f,d.getElementById('other')).defaultPrevented,false);enter(f,d.getElementById('wsInput'));enter(f,d.body);assert.equal(count,0);
});
for(const element of ['input','textarea','select','button','a href="#"','div contenteditable="true"'])test('F5: unrelated focused control keeps its own Enter '+element,t=>{
  const f=fixture(t,'<input id="wsInput" value="apple"><button id="wsOk">提交</button><'+element+' id="other"></'+element.split(' ')[0]+'>');let count=0;f.box.wtSpellSubmit=()=>count++;f.run('wtBindSpellKeys()');
  assert.equal(enter(f,f.dom.window.document.getElementById('other')).defaultPrevented,false);assert.equal(count,0);
});
test('F5: regular practice Enter works once, but IME, held keys and disabled submit do not',t=>{
  const f=fixture(t,'<input id="wsInput" value="apple"><button id="wsOk">提交</button><div role="dialog" hidden>hidden</div>');let count=0;f.box.wtSpellSubmit=()=>count++;f.run('wtBindSpellKeys();wtBindSpellKeys()');
  const d=f.dom.window.document;enter(f,d.getElementById('wsInput'),{isComposing:true});enter(f,d.body,{repeat:true});assert.equal(count,0);
  assert.equal(enter(f,d.getElementById('wsInput')).defaultPrevented,true);assert.equal(count,1);enter(f,d.body);assert.equal(count,2);
  d.getElementById('wsOk').disabled=true;enter(f,d.body);assert.equal(count,2);
});
function adminFixture(){const timers=new Map(),calls=[],notices=[];let id=0;const box=vm.createContext({setInterval:fn=>(timers.set(++id,fn),id),clearInterval:n=>timers.delete(n),toast:(text,type)=>notices.push({text,type}),api:async(url,opts)=>{calls.push({url,opts});return opts?.method==='POST'?{started:true,pending:9}:{running:false,done:9,total:9};}});vm.runInContext(read('public/admin/words.js'),box);const realLoadList=box.loadList;let loads=0;box.loadList=async()=>loads++;const run=text=>vm.runInContext(text,box);run("WB.bookId=1;WB.books=[{id:1,title:'Original book'}]");return {box,run,timers,calls,notices,realLoadList,loads:()=>loads};}
test('F6: polling remains bound to original book and never refreshes another book',async()=>{
  const f=adminFixture();f.box.btn={innerHTML:'AI',disabled:false};await f.run('aiFillExamples(btn)');f.run('WB.bookId=2');await [...f.timers.values()][0]();
  assert.match(f.calls[1].url,/book_id=1$/);assert.equal(f.loads(),0);assert.match(f.notices.at(-1).text,/Original book/);assert.match(f.notices.at(-1).text,/成功 9 条/);assert.equal(f.box.btn.disabled,false);assert.equal(f.timers.size,0);
});
test('F6: rapid duplicate start is ignored before POST resolves',async()=>{
  const f=adminFixture(),start=deferred();let calls=0;f.box.api=()=>{calls++;return start.promise;};f.box.btn={innerHTML:'AI',disabled:false};
  const one=f.run('aiFillExamples(btn)'),two=f.run('aiFillExamples(btn)');assert.equal(calls,1);assert.equal(f.box.btn.disabled,true);start.resolve({started:false,reason:'done'});await Promise.all([one,two]);assert.equal(f.box.btn.disabled,false);assert.equal(f.timers.size,0);
});
test('F6: overlapping polling ticks do not issue duplicate status or completion',async()=>{
  const f=adminFixture();f.box.btn={innerHTML:'AI',disabled:false};await f.run('aiFillExamples(btn)');const status=deferred();let calls=0;f.box.api=()=>{calls++;return status.promise;};const tick=[...f.timers.values()][0];const a=tick(),b=tick();assert.equal(calls,1);status.resolve({running:false,done:9,total:9});await Promise.all([a,b]);assert.equal(f.loads(),1);assert.equal(f.notices.filter(n=>n.text.includes('完成')).length,1);
});
test('F6: poll failure reports uncertain progress instead of claiming completion',async()=>{
  const f=adminFixture();f.box.btn={innerHTML:'AI',disabled:false};await f.run('aiFillExamples(btn)');f.box.api=async()=>{throw Error('offline');};await [...f.timers.values()][0]();
  assert.match(f.notices.at(-1).text,/进度.*失败|无法.*进度/);assert.equal(f.notices.at(-1).type,'err');assert.equal(f.box.btn.disabled,false);assert.equal(f.timers.size,0);
});

test('F2 control: current course error is rejected but an obsolete error is silent',async()=>{
  const ds=[];const f=vueFixture({api:()=>{const d=deferred();ds.push(d);return d.promise;}});
  const first=f.state.loadCourse();f.state.courseId='2';const second=f.state.loadCourse();
  ds[0].reject(Error('obsolete'));await first;ds[1].reject(Error('current'));await assert.rejects(second,/current/);
});
test('F3 control: fresh data is cached and filtered by selected unit',async t=>{
  const f=fixture(t);let calls=0;f.box.api=async url=>{calls++;return url.includes('/words?')?[{id:1,word:'one',unit:'U1'},{id:2,word:'two',unit:'U2'}]:[];};
  f.run("WT.unit='U1'");await f.run("wtEnsureData('quick')");assert.equal(f.run('WT.data.words[0].word'),'one');
  f.run("WT.unit='U2'");await f.run("wtEnsureData('quick')");assert.equal(f.run('WT.data.words[0].word'),'two');assert.equal(calls,3);
});
test('F3: obsolete POS automatic book fallback does not update the next page',async t=>{
  const f=fixture(t,'<div id="wtPosBox">new page</div>'),pending=delayedApi(f);
  f.run("WT.curSub='pos';WT.books=[{id:1,kind:'pos'},{id:3,kind:'pos',pos_count:1}]");
  const old=f.run('wtPosStart()');await f.run("viewWords('typing')");resolveWordJobs(pending,3);await old;
  assert.equal(f.dom.window.document.getElementById('wtPosBox').textContent,'new page');
});
test('F4 control: same account reuses stats until record invalidates the original book',async t=>{
  const f=fixture(t),record=deferred();let stats=0;
  f.box.api=async url=>{if(url.endsWith('/record'))return record.promise;if(url.includes('/stats?')){stats++;return {quick:{correct:3,wrong:1}};}return [];};
  await f.run("wtShell('quick','')");await f.run("wtShell('quick','')");assert.equal(stats,1);
  const saved=f.run("wtRecord('quick',true,1)");f.run("WT.bookId='2';WT.statsCache['A:2']={quick:{correct:8,wrong:1}}");record.resolve({});await saved;
  assert.equal(f.run("WT.statsCache['A:1']"),undefined);assert.equal(f.run("WT.statsCache['A:2'].quick.correct"),8);
});
test('F4: 401/account clearing cancels pending data even before route watcher runs',async t=>{
  const f=fixture(t),pending=delayedApi(f),old=f.run("wtEnsureData('quick')");f.box.Auth.clear();resolveWordJobs(pending);await old;
  assert.equal(f.run('WT.data.words.length'),0);assert.equal(f.run("WT.dataCache['1'].words"),undefined);
});
test('F4: scheduled prefetch from the old session cannot start under a new account',async t=>{
  const f=fixture(t);let calls=0;f.box.api=async()=>{calls++;return [];};f.run('WT.pf=false;wtPrefetchOthers()');f.box.Auth.user={id:'B'};f.box.Auth.token='B';f.run('wtSubStateSync()');
  for(const fn of f.timers)fn();assert.equal(calls,0);
});
test('F5: actual exit confirmation keeps Enter and Cancel away from spelling',async t=>{
  const f=fixture(t,'<input id="wsInput" value="apple"><button id="wsOk">提交</button>');
  f.box.MutationObserver=f.dom.window.MutationObserver;f.box.requestAnimationFrame=fn=>fn();
  f.box.location=f.dom.window.location;vm.runInContext(read('public/js/api.js'),f.box);
  let submits=0;f.box.wtSpellSubmit=()=>submits++;f.run('wtBindSpellKeys()');
  const closing=f.run("elConfirm({title:'退出登录',message:'确定退出登录？',okText:'退出'})");
  const dialog=f.dom.window.document.querySelector('[role="dialog"]');assert.ok(dialog);enter(f,dialog.querySelector('button'));assert.equal(submits,0);
  const cancel=[...dialog.querySelectorAll('button')].find(b=>b.textContent.includes('取消'));assert.ok(cancel);cancel.click();assert.equal(await closing,false);assert.equal(submits,0);
  enter(f,f.dom.window.document.getElementById('wsInput'));assert.equal(submits,1);
});
test('F6: closing the originating drawer keeps the book result but never reloads it',async()=>{
  const f=adminFixture();f.box.btn={innerHTML:'AI',disabled:false,isConnected:true};await f.run('aiFillExamples(btn)');f.box.btn.isConnected=false;await [...f.timers.values()][0]();
  assert.equal(f.loads(),0);assert.match(f.notices.at(-1).text,/Original book.*成功 9 条/);
});
test('F6: account change stops polling without publishing previous account results',async()=>{
  const f=adminFixture();f.box.Auth={user:{id:'A'},token:'A'};f.box.btn={innerHTML:'AI',disabled:false};await f.run('aiFillExamples(btn)');
  f.box.Auth.user={id:'B'};f.box.Auth.token='B';await [...f.timers.values()][0]();assert.equal(f.calls.length,1);assert.equal(f.notices.length,1);assert.equal(f.timers.size,0);
});

for(const action of ['book','tab','close'])test('F6: completion-triggered list reload cannot repaint after '+action+' changes',async()=>{
  const f=adminFixture(),data=deferred(),host={innerHTML:'current',isConnected:true};let paints=0;
  f.box.document={getElementById:()=>host.isConnected?host:null};f.box.api=()=>data.promise;f.box.paintRows=()=>paints++;
  f.run("WB.tab='phrase'");const loading=f.realLoadList();
  if(action==='book')f.run('WB.bookId=2');if(action==='tab')f.run("WB.tab='word'");if(action==='close')host.isConnected=false;
  data.resolve([{id:1,phrase:'old book'}]);await loading;assert.equal(paints,0);assert.equal(f.run('WB.lists.phrase.length'),0);
});
test('F1: recover legacy word-only history accidentally stored in the sentence namespace',t=>{
  const f=fixture(t);const mixed={7:{id:7,word:'legacy',cnt:4,first:1,last:2},8:{id:8,text:'Keep sentence',cnt:3}};
  f.box.localStorage.setItem('xuexi_wtwsh:A:1:build',JSON.stringify(mixed));f.run("WT.curSub='quick';wtWrongWordOpen()");
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwdh:A:1'))?.['7']?.cnt,4);
  assert.equal(JSON.parse(f.box.localStorage.getItem('xuexi_wtwdh:A:1'))?.['8'],undefined);
  assert.deepEqual(JSON.parse(f.box.localStorage.getItem('xuexi_wtwsh:A:1:build')),mixed);
});
