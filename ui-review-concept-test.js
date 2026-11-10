'use strict';
// Isolated browser fixture. Real production rendering/handlers, synthetic in-memory
// API only. No authentication, database, remote requests or production writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');
const ROOT = __dirname, PUBLIC = path.join(ROOT, 'public');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function section(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, from); return source.slice(a, b);
}
function embeddedAsset(file) {
  assert(path.resolve(file).startsWith(PUBLIC + path.sep));
  const mime = { '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)];
  assert(mime, file); return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
function stylesheet(file) {
  return fs.readFileSync(file, 'utf8').replace(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g, (all, a, b, c) => {
    const url = a || b || c; if (url.startsWith('data:')) return all;
    assert(!/^(https?:)?\/\//.test(url));
    return `url("${embeddedAsset((url.startsWith('/') ? path.join(PUBLIC, url) : path.resolve(path.dirname(file), url)).split('?')[0].split('#')[0])}")`;
  });
}
const fixtureSource = String.raw`
const Auth = Object.freeze({user: Object.freeze({name:'合成教师', role:'admin'})});
const fixtureStorage = new Map();
const localStorage = { getItem: k => fixtureStorage.get(k) || null, setItem: (k,v) => fixtureStorage.set(k,String(v)) };
const denyNetwork = () => { throw Error('合成组件禁止网络请求'); };
window.fetch = async () => denyNetwork(); window.open = denyNetwork;
window.XMLHttpRequest = window.WebSocket = window.EventSource = denyNetwork;
navigator.sendBeacon = denyNetwork;
window.fixtureCalls = []; window.fixtureSaveFailure = false; window.fixtureCommitFailure = false;
const fixtureRows = Array.from({length:12}, (_,i) => ({
  id: 'fixture-' + (i + 1), edit_signature:'fixture-signature-'+i, kind:'run', batch_id:88, index:i, source:'word', source_label:'Word 导入', batch_title:'三年级数学练习',
  qno: String(i + 1), type:'single', type_name:'单选题', subject:'数学', stage:'primary', grade:'三年级', edition:'苏教版',
  point:'两步混合运算', chapter_id:1, stem:i===0?'计算 36 + 12 × 3 时，正确的计算顺序是（    ）。': ['混合运算的应用','脱式计算','看图列式','有余数的除法','解决问题'][i%5],
  options:['先算加法，再算乘法','从左到右依次计算','先算乘法，再算加法','先把三个数相加'], answer:i===1?'':'C', analysis:'没有括号时，先乘除，后加减。\n先算 12 × 3，再与 36 相加。',
  images:[], original_page:1, original_pages:2, source_pages:[1,2], content_review_required:true, content_review_pending:true,
  content_review_signature:'synthetic-content-'+i, figure_review_signature:'synthetic-figure-'+i,
  figure_missing:i===2?[1]:[], image_errors:[], ai_point_suggestion:i===0?'两步混合运算':'', recognition_notes:[], tags:[]
}));
async function api(url, options={}) {
  window.fixtureCalls.push({url, method:options.method || 'GET', body:options.body});
  if (url.includes('/badge-counts')) return {pending:fixtureRows.length};
  if (url.includes('/ext/pending?')) {
    const q = new URLSearchParams(url.split('?')[1]); let rows=fixtureRows.slice();
    if(q.get('source') !== 'all') rows=rows.filter(x=>x.source===q.get('source'));
    if(q.get('kw')) rows=rows.filter(x=>(x.stem+x.batch_title+x.point).includes(q.get('kw')));
    const match = {needs_review:x=>x.content_review_pending, no_answer:x=>!x.answer, no_analysis:x=>!x.analysis, no_image:x=>x.figure_missing.length, no_class:x=>!x.subject||!x.stage||!x.point};
    const status_counts={all:rows.length}; Object.entries(match).forEach(([k,f])=>status_counts[k]=rows.filter(f).length);
    if(match[q.get('review_status')])rows=rows.filter(match[q.get('review_status')]);
    const size=+(q.get('size')||20), page=Math.min(+(q.get('page')||1),Math.max(1,Math.ceil(rows.length/size)));
    return {list:JSON.parse(JSON.stringify(rows.slice((page-1)*size,page*size))),counts:{all:fixtureRows.length,word:fixtureRows.length},status_counts,total:rows.length,page,size};
  }
  if (url.endsWith('/ext/pending/item') && options.method === 'PUT') {
    if(window.fixtureSaveFailure) throw Error('合成保存失败');
    if(window.fixtureHoldSave) await new Promise(resolve=>{window.fixtureResumeSave=resolve;});
    const item=fixtureRows.find(x=>x.id===options.body.id); Object.assign(item,options.body.patch); return JSON.parse(JSON.stringify(item));
  }
  if (url.endsWith('/ext/pending/items') && options.method === 'PUT') {
    if(window.fixtureSaveFailure) throw Error('合成保存失败');
    if(window.fixtureHoldSave) await new Promise(resolve=>{window.fixtureResumeSave=resolve;});
    const entry=options.body.items[0],item=fixtureRows.find(x=>x.id===entry.id);
    assertFixture(item && item.edit_signature===entry.expected,'snapshot');Object.assign(item,entry.patch);if(entry.patch.type_confirmed)item.type_unconfirmed=false;item.edit_signature+='-saved';
    return {saved:1,list:[JSON.parse(JSON.stringify(item))]};
  }
  if (url.endsWith('/ext/pending/content/confirm')) {
    const item=fixtureRows.find(x=>x.id===options.body.id); assertFixture(item.content_review_signature===options.body.expected,'content signature');
    item.content_review_pending=false; return {};
  }
  if (url.endsWith('/aifill/confirm') && options.body.legacy) {
    const item=fixtureRows.find(x=>x.index===options.body.index);
    assertFixture(item && item.ai_legacy_signature===options.body.expected,'legacy snapshot');
    item.ai_legacy_pending=false;item.ai_legacy_pending_fields=[];item.edit_signature+='-reviewed';return {};
  }
  if (url.endsWith('/aifill/confirm') && options.body.recheck) {
    const item=fixtureRows.find(x=>x.index===options.body.index);
    assertFixture(item && item.ai_review_signature===options.body.expected,'recheck snapshot');
    item.ai_review_pending_fields=[];item.edit_signature+='-rechecked';return {};
  }
  if (url.endsWith('/ext/pending/legacy-confirm')) {
    for(const entry of options.body.items){const item=fixtureRows.find(x=>x.id===entry.id);assertFixture(item && item.edit_signature===entry.expected && item.ai_legacy_signature===entry.legacy_expected,'batch snapshot');}
    for(const entry of options.body.items){const item=fixtureRows.find(x=>x.id===entry.id);item.ai_legacy_pending=false;item.ai_legacy_pending_fields=[];item.edit_signature+='-reviewed';}
    return {confirmed:options.body.items.length};
  }
  if (url.includes('/ext/pending/original?')) return {url:fixtureImage,page:1,total:2};
  if (url.endsWith('/ext/pending/batches')) return {list:[],counts:{},total:0};
  if (url.includes('/trees/') && url.endsWith('/nodes')) return {list:[]};
  if (url.endsWith('/ext/pending/commit')) {
    const rows=options.body.ids.map(id=>fixtureRows.find(x=>x.id===id));
    for(const entry of options.body.items || []) {const item=fixtureRows.find(x=>x.id===entry.id);assertFixture(item && item.edit_signature===entry.expected,'commit snapshot');}
    if(window.fixtureCommitFailure) return {committed:0,failed:rows.map(x=>({id:x.id,msg:'合成：题图缺失，请先补图'}))};
    return rows.some(x=>x.content_review_pending) ? {committed:0,failed:[{id:rows[0].id,msg:'请先核对内容'}]} : {committed:rows.length,failed:[]};
  }
  throw Error('未定义的合成接口：'+url);
}
function assertFixture(value,message){if(!value)throw Error(message);}
const tpTrees=async()=>[];
const treeLabel=t=>t.name;
const mtxTypeset=()=>{};
const withTicket=x=>x;
const t8Enhance=()=>{};
const t7AudioWidget=()=>null;
`;
const bootstrap = String.raw`
ADM.chapters=[{id:1,name:'混合运算与数量关系'}];
let fixtureSeq=0;
async function render() {
  const seq=++fixtureSeq; const out=await viewPending(); if(seq!==fixtureSeq)return;
  $app.innerHTML=shell(out.html); bindShell(); out.after(); r10Enhance(document.getElementById('view'));
  window.fixtureReady=true;
}
const fixtureInitialRows=JSON.parse(JSON.stringify(fixtureRows));
window.fixture={ reset:()=>{fixtureRows.splice(0,fixtureRows.length,...JSON.parse(JSON.stringify(fixtureInitialRows)));window.fixtureCalls=[];window.fixtureSaveFailure=false;window.fixtureCommitFailure=false;window.fixtureHoldSave=false;ADM.page={};return render();}, rows:fixtureRows, state:()=>ADM.page.pd, refresh:render, selectBatch:pdSelectBatch, navigate:(page)=>{ADM.page.pdPage=page;return render();} };
location.hash='#/pending'; render();
`;
const regressionSource = String.raw`
window.fixtureErrors=[]; window.addEventListener('error', e=>fixtureErrors.push(String(e.message))); window.addEventListener('unhandledrejection', e=>fixtureErrors.push(String(e.reason)));
window.fixture.runRegression = async function() {
  const checks=[]; const $=s=>document.querySelector(s);
  const paint=()=>new Promise(r=>setTimeout(r,30));
  const wait=async(f)=>{const end=performance.now()+3000;while(!f()){if(performance.now()>end)throw Error('等待界面超时');await new Promise(r=>setTimeout(r,20));}await paint();};
  const check=(name,yes)=>{checks.push({name,passed:!!yes});if(!yes)throw Error(name);};
  const click=async(s)=>{const el=$(s);check('控件存在 '+s,!!el);el.click();await paint();};
  const input=async(s,value)=>{const el=$(s);el.value=value;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await paint();};
  try {
    await fixture.reset(); await paint();
    check('入口提示可展开',getComputedStyle($('.pd-tools-open')).display!=='none' && getComputedStyle($('.pd-tools-close')).display==='none');
    await click('details.pd-advanced summary'); check('展开后提示可收起',$('.pd-advanced').open && getComputedStyle($('.pd-tools-close')).display!=='none' && getComputedStyle($('.pd-tools-open')).display==='none');
    await click('details.pd-advanced summary'); check('收起后工具隐藏',!$('.pd-advanced').open);
    check('三个审核区域',!!$('.pd-classification') && !!$('.pd-main') && !!$('.r4-review-list'));
    check('没有横向溢出',document.documentElement.scrollWidth-innerWidth<=1);
    check('待核对时禁止直接入库',$('#pd-current-commit').disabled);
    if(innerWidth>820){
      const edit=$('[data-act="edit"]').getBoundingClientRect(), main=$('.pd-main').getBoundingClientRect(), footer=$('.pd-review-footer').getBoundingClientRect();
      check('核心编辑入口无需滚动即可见',edit.top>=main.top && edit.bottom<=Math.min(main.bottom,footer.top));
      const confirm=$('[data-act="content-review"]').getBoundingClientRect(), body=$('.pd-question-body').getBoundingClientRect();check('内容核对操作完整可见',confirm.top>=main.top&&confirm.bottom<=Math.min(main.bottom,footer.top)&&(!$('.pd-question-body').contains($('[data-act="content-review"]'))||confirm.bottom<=body.bottom));
      check('品牌透明图没有白底',getComputedStyle($('.brand .zx-mark')).backgroundColor==='rgba(0, 0, 0, 0)');
      const label=$('.nav a[data-go="pending"] .txt');check('待审核导航保持单行',label.getBoundingClientRect().height<30);
    }
    await click('#pd-next'); check('下一题切换',$('.pd-item').dataset.id==='fixture-2');
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); await paint();
    check('键盘上一题',$('.pd-item').dataset.id==='fixture-1');
    $('[data-class-field="point"]').focus(); $('[data-class-field="point"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    check('输入分类不会切题',$('.pd-item').dataset.id==='fixture-1');
    await input('[data-class-field="point"]','核对后的知识点');
    await click('[data-select-item="fixture-1"]');check('重复点当前题保留未保存分类',$('[data-class-field="point"]').value==='核对后的知识点');
    await click('#pd-next');check('切题前保护未保存分类',$('.pd-item').dataset.id==='fixture-1');
    await click('details.pd-advanced summary');$('[data-sel="fixture-1"]').checked=true;$('[data-sel="fixture-1"]').dispatchEvent(new Event('change',{bubbles:true}));
    await click('#pd-bcommit');check('批量入库不能绕过未保存分类',!$('#pdB-sub'));
    await click('[data-review="no_answer"]');check('筛选不丢失未保存分类',$('.pd-item').dataset.id==='fixture-1'&&$('[data-class-field="point"]').value==='核对后的知识点');
    await input('#pd-source','photo');check('来源切换不丢失分类',$('#pd-source').value==='all'&&$('.pd-item').dataset.id==='fixture-1');
    await click('[data-act="discard-classification"]');check('撤销分类恢复持久值',$('[data-class-field="point"]').value===fixture.rows[0].point);
    await input('[data-class-field="point"]','核对后的知识点');
    const save=$('[data-act="save-classification"]');save.click();save.click();await wait(()=>fixture.rows[0].point==='核对后的知识点');
    check('分类保存使用现有接口',fixtureCalls.filter(c=>c.method==='PUT').length===1);
    check('保存分类不伪造内容确认',$('#pd-current-commit').disabled);
    window.fixtureSaveFailure=true; await input('[data-class-field="point"]','失败不保存');await click('[data-act="save-classification"]'); await wait(()=>!$('[data-act="save-classification"]').disabled);
    check('保存失败保留原值',fixture.rows[0].point==='核对后的知识点');window.fixtureSaveFailure=false; await fixture.refresh();
    await click('[data-act="content-review"]'); await click('#elcNo');check('取消确认不改变题目',fixture.rows[0].content_review_pending);
    await click('[data-act="content-review"]');await click('#elcOk');await wait(()=>!fixture.rows[0].content_review_pending);
    check('内容确认携带签名',fixtureCalls.some(c=>c.url.endsWith('/content/confirm') && c.body.expected==='synthetic-content-0'));
    await input('[data-class-field="point"]','未保存的分类');check('未保存分类阻止入库',$('#pd-current-commit').disabled);await input('[data-class-field="point"]',fixture.rows[0].point);check('恢复分类可继续',!$('#pd-current-commit').disabled);
    window.fixtureHoldSave=true;await click('[data-act="save-classification"]');check('保存中禁止入库',$('#pd-current-commit').disabled);check('保存中禁止继续改分类',$('[data-class-field="point"]').disabled);
    await click('#pd-next');check('保存中禁止切题',$('.pd-item').dataset.id==='fixture-1');
    await click('details.pd-advanced summary');$('[data-sel="fixture-1"]').checked=true;$('[data-sel="fixture-1"]').dispatchEvent(new Event('change',{bubbles:true}));
    await click('#pd-bcommit');check('保存中禁止批量入库',!$('#pdB-sub'));
    await click('[data-review="no_answer"]');check('保存中禁止状态筛选',$('.pd-item').dataset.id==='fixture-1');
    await input('#pd-source','photo');check('保存中禁止来源筛选',$('#pd-source').value==='all');
    await click('.nav [data-go="dash"]');check('保存中禁止导航离开',location.hash==='#/pending');
    window.fixtureHoldSave=false;window.fixtureResumeSave();await wait(()=>!$('[data-act="save-classification"]').disabled);
    await click('#pd-current-commit');await wait(()=>$('#pdB-sub'));
    check('入库仍经原有分类弹窗',!!$('#pdB-stage') && !!$('#pdB-knode') && !!$('#pdB-cnode'));
    check('打开弹窗不提交',!fixtureCalls.some(c=>c.url.endsWith('/commit')));await click('#mCancel');
    await click('[data-act="edit"]');await wait(()=>$('#pdE-stem'));await input('#pdE-stem','合成编辑后的题目');await click('#mOk');await wait(()=>fixture.rows[0].stem==='合成编辑后的题目');
    check('编辑走安全快照保存接口',fixtureCalls.some(c=>c.method==='PUT' && c.body.items && c.body.items[0].patch.stem==='合成编辑后的题目'));
    await click('details.pd-advanced summary'); check('全部批量工具可达',['pd-bcommit','pd-bmerge','pd-bclassify','pd-bai','pd-bdel','pd-excel','pd-word'].every(id=>!!document.getElementById(id)));
    $('[data-sel="fixture-1"]').checked=true;$('[data-sel="fixture-1"]').dispatchEvent(new Event('change',{bubbles:true}));
    await click('[data-review="no_answer"]');await wait(()=>document.querySelectorAll('[data-review-row]').length===1);
    check('筛选清除旧勾选',Object.values(fixture.state().sel).filter(Boolean).length===0);
    await click('[data-review="all"]');await wait(()=>document.querySelectorAll('[data-review-row]').length===12);
    await input('#pd-source','photo');await wait(()=>$('.pd-list .empty'));
    check('空来源不保留旧题',$('.pd-item')===null);await input('#pd-source','word');await wait(()=>$('.pd-item'));
    if(innerWidth<=820){await click('#btnFold');check('手机抽屉开启',!!$('.t11-drawer'));await click('#t11Scrim');check('手机抽屉关闭',!$('.t11-drawer'));}
    else {const boxes=['.r4-review-list','.pd-main','.pd-classification'].map(s=>$(s).getBoundingClientRect());check('三栏不重叠',boxes[0].right<=boxes[1].left+1&&boxes[1].right<=boxes[2].left+1);}
    await fixture.reset();Object.assign(fixture.rows[0],{subject:'生物',stage:'senior',grade:'高一',point:'细胞'});await fixture.refresh();await paint();
    const readClass=()=>Object.fromEntries([...document.querySelectorAll('[data-class-field]')].map(el=>[el.dataset.classField,el.value]));
    check('高中与非预置学科原值保留',readClass().stage==='senior'&&readClass().grade==='高一'&&readClass().subject==='生物');
    check('未编辑分类不被误判为脏',!pdClassificationChanged(fixture.rows[0],readClass()));
    await click('#pd-next');check('已有未知分类仍可导航',$('.pd-item').dataset.id==='fixture-2');await click('#pd-prev');
    await click('[data-act="save-classification"]');await wait(()=>!$('[data-act="save-classification"]').disabled);check('保存保留高中原始分类',fixture.rows[0].stage==='senior'&&fixture.rows[0].grade==='高一'&&fixture.rows[0].subject==='生物');
    Object.assign(fixture.rows[0],{subject:'艺术<课>',stage:'custom<stage>',grade:'高四"特'});await fixture.refresh();await paint();
    check('未知枚举转义后仍保持原值',readClass().subject==='艺术<课>'&&readClass().stage==='custom<stage>'&&readClass().grade==='高四"特'&&!document.querySelector('stage'));
    check('未知枚举不会触发未保存保护',!pdClassificationChanged(fixture.rows[0],readClass()));
    await click('[data-act="save-classification"]');await wait(()=>!$('[data-act="save-classification"]').disabled);check('未知枚举保存不清空原值',fixture.rows[0].subject==='艺术<课>'&&fixture.rows[0].stage==='custom<stage>'&&fixture.rows[0].grade==='高四"特');
    check('无脚本错误',fixtureErrors.length===0);
    await fixture.reset(); await paint();
    return {passed:true,width:innerWidth,checks,errors:fixtureErrors};
  } catch(e) { return {passed:false,width:innerWidth,error:e.message,checks,errors:fixtureErrors}; }
};
`;

function buildFixture() {
  const admin=read('public/admin/admin.js'), apiSource=read('public/js/api.js');
  const components=[
    section(apiSource,'function toast(', 'function fmtSize('),
    section(admin,'/* 管理端 SPA','/** Element 上传'),
    section(admin,'function bindPager(', '/**\n * 删除密码确认弹窗'),
    section(admin,'function shell(', '// ------------------------------------------------------------ 数据概览'),
    section(admin,'let r10ControlId =','let RENDER_SEQ ='),
    read('public/js/question-subtypes.js'), read('public/admin/pendingui.js')
  ].join('\n');
  const logo=embeddedAsset(path.join(PUBLIC,'img/logo.jpg'));
  const scripts=`const fixtureImage=${JSON.stringify(logo)};\n`+fixtureSource+'\n'+components+'\n'+bootstrap+'\n'+regressionSource;
  new vm.Script(scripts);
  const hrefs=[...read('public/admin/index.html').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
  const styles=[...hrefs.map(href=>path.resolve(PUBLIC,'admin',href)),path.join(PUBLIC,'admin/r10.css')];
  const vendor=['vue2.min.js','element-ui.js'].map(name=>'<script>'+read('public/vendor/'+name).replace(/<\/script/gi,'<\\/script')+'</script>').join('');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'"><title>合成数据 · 待审核工作台</title>'+styles.map(file=>'<style>'+stylesheet(file)+'</style>').join('')+vendor+'</head><body class="t11"><div id="app"></div><script>'+scripts.replaceAll('/img/logo.jpg',logo).replaceAll('/img/ui-brand-20261108.png',embeddedAsset(path.join(PUBLIC,'img/ui-brand-20261108.png'))).replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
}
module.exports={buildFixture};

if(require.main===module && process.argv.includes('--browser')) {
  test('review workspace: real Chromium 1487/1440/390 layout, guarded actions and screenshots', async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    const evidence=path.join(ROOT,'docs/ui-evidence-20261108/review'); fs.mkdirSync(evidence,{recursive:true});
    const results=[];
    try {
      for(const width of [1487,1440,390]) {
        const height=width===390?844:1058;
        const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
        const errors=[],requests=[];
        page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
        await page.setContent(buildFixture()); await page.waitForFunction(()=>window.fixtureReady); await page.evaluate(()=>document.fonts.ready);
        const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,regions:['.r4-review-list','.pd-main','.pd-classification','.pd-review-footer'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {selector:s,x:r.x,y:r.y,width:r.width,height:r.height};})}));
        if(width===390){
          const panels=await page.evaluate(()=>['.pd-main','.pd-classification','.pd-preview-heading'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {selector:s,left:r.left,right:r.right,overflow:e.scrollWidth-e.clientWidth};}));
          assert(panels.every(p=>p.left>=-1 && p.right<=width+1 && p.overflow<=1),JSON.stringify(panels));
          const checkbox=page.locator('[data-sel="fixture-1"]').first();await checkbox.check({timeout:3000});
          await page.waitForFunction(()=>['pd-bapply-stem','pd-bapply-answer'].every(id=>getComputedStyle(document.getElementById(id)).color==='rgb(7, 91, 70)'));
          const controls=await page.evaluate(()=>['pd-bapply-stem','pd-bapply-answer'].map(id=>{const b=document.getElementById(id);return {disabled:b.disabled,title:b.title,color:getComputedStyle(b).color,opacity:getComputedStyle(b).opacity};}));
          assert(controls.every(b=>!b.disabled&&!b.title&&b.color==='rgb(7, 91, 70)'&&b.opacity==='1'),JSON.stringify(controls));
          await checkbox.uncheck({timeout:3000});
        }
        await page.screenshot({path:path.join(evidence,`admin-review-${width}.png`)});
        if(width===390) await page.screenshot({path:path.join(evidence,'admin-review-390-full.png'),fullPage:true});
        const regression=await page.evaluate(()=>fixture.runRegression());
        results.push({width,height,deviceScaleFactor:1,geometry,...regression,consoleErrors:errors,networkRequests:requests});
        fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify(results,null,2));
        assert.equal(regression.passed,true,JSON.stringify(regression,null,2));
        assert.deepEqual(errors,[],'no browser console/page errors'); assert.deepEqual(requests,[],'no external network requests');
        await page.close();
      }
    } finally {await browser.close();}
  });
}

if(require.main===module && process.argv.includes('--browser')) {
 test('ten toolbar actions collapse together and remain usable across screen widths',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const groups=[['pd-bedit','pd-bcommit','pd-bmerge','pd-bclassify','pd-bdel'],['pd-breview','pd-bapply-stem','pd-bapply-answer','pd-bai','pd-bfill-review']];
  try{for(const width of [1440,390,320]){
   const page=await browser.newPage({viewport:{width,height:width===1440?1058:844}});
   try{
    const requests=[];await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
    for(const id of groups.flat())assert.equal(await page.locator('#'+id).isVisible(),false,id+' starts collapsed');
    await page.locator('.pd-advanced>summary').click();assert.equal(await page.locator('.pd-advanced').evaluate(e=>e.open),true);
    for(const [i,ids] of groups.entries())for(const id of ids){const button=page.locator('#'+id);assert.equal(await button.isVisible(),true,id);assert.equal(await button.evaluate((e,group)=>e.closest('[data-pd-tool-group]').dataset.pdToolGroup===group,i?'ai':'batch'),true);}
    const geometry=await page.evaluate(()=>{const details=document.querySelector('.pd-advanced').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,items:[...document.querySelectorAll('[data-pd-tool-group] button')].map(e=>{const b=e.getBoundingClientRect(),p=e.closest('[data-pd-tool-group]').getBoundingClientRect();return {id:e.id,left:b.left,right:b.right,top:b.top,bottom:b.bottom,groupLeft:p.left,groupRight:p.right,detailsBottom:details.bottom}})}});
    assert(geometry.overflow<=1,JSON.stringify(geometry));assert(geometry.items.every(b=>b.left>=b.groupLeft-1&&b.right<=b.groupRight+1&&b.bottom<=b.detailsBottom+1),JSON.stringify(geometry));
    await page.locator('#pd-all').check();assert.match(await page.locator('#pd-selcnt').innerText(),/已选 12 题/);assert.match(await page.locator('#pd-tool-selection').innerText(),/已选 12 题/);
    for(const id of groups.flat())assert.equal(await page.locator('#'+id).isEnabled(),true,id+' retains selected state');
    if(width===1440){await page.locator('.pd-advanced>summary').scrollIntoViewIfNeeded();await page.screenshot({path:'/home/bobo/Documents/Codex/2026-11-10/task-2/toolbar-expanded-desktop.png'});}
    if(width===390)await page.locator('.pd-filter-area').screenshot({path:'/home/bobo/Documents/Codex/2026-11-10/task-2/toolbar-expanded-mobile.png'});
    await page.locator('.pd-advanced>summary').click();for(const id of groups.flat())assert.equal(await page.locator('#'+id).isVisible(),false);
    assert.equal(await page.locator('[data-review-row] input:checked').count(),12);assert.match(await page.locator('#pd-tool-selection').innerText(),/已选 12 题/);
    await page.locator('.pd-advanced>summary').click();assert.equal(await page.locator('#pd-all').isChecked(),true);assert.deepEqual(requests,[]);
   }finally{await page.close()}
  }}finally{await browser.close()}
 });
}

if(require.main===module && process.argv.includes('--browser')) {
 test('no-change review and blocker guidance work in desktop and mobile browser',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:width===390?844:1058}});
   try{
    const requests=[];await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
    await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
    await page.evaluate(async()=>{const x=fixture.rows[0];x.options=x.options.map((text,i)=>({label:String.fromCharCode(65+i),text}));x.edit_signature='synthetic-snapshot';x.ai_answer_suggestion={source:'review',token:'same',stem:x.stem,answer:x.answer,analysis:x.analysis};await fixture.refresh();window.fixtureCalls=[];});
    assert.equal(await page.locator('#pd-current-commit').isEnabled(),false);
    assert.match(await page.locator('#pd-commit-hint').innerText(),/原页.*无需修改/);
    await page.locator('#pd-review-next').click();assert.equal(await page.locator('[data-act="content-review"]').evaluate(e=>document.activeElement===e),true);
    await page.locator('[data-act="bulk-edit"]').click();await page.locator('#mOk').click();await page.locator('.mask').waitFor({state:'detached'});
    assert.equal(await page.locator('#pd-current-commit').isEnabled(),false);
    assert.deepEqual(await page.evaluate(()=>fixtureCalls.filter(c=>c.method!=='GET')),[]);
    await page.locator('[data-act="content-review"]').click();await page.locator('#elcOk').click();await page.waitForFunction(()=>!document.getElementById('pd-current-commit').disabled);
    assert.match(await page.locator('#pd-commit-hint').innerText(),/无需修改/);
    assert.deepEqual(await page.evaluate(()=>fixtureCalls.filter(c=>c.method!=='GET').map(c=>c.url.split('/').slice(-2).join('/'))),['content/confirm']);
    await page.evaluate(async()=>{const x=fixture.rows[0];x.figure_missing=[1];x.figure_review_required=true;x.figure_review_issue='待核对';x.ai_legacy_pending=true;x.ai_legacy_pending_fields=['answer','analysis','classification'];await fixture.refresh();window.fixtureCalls=[];});
    const hint=await page.locator('#pd-commit-hint').innerText();assert.match(hint,/题图/);assert.match(hint,/图文/);assert.match(hint,/答案.*解析.*分类/);
    await page.locator('#pd-review-next').click();assert.equal(await page.locator('.pd-image-missing').first().evaluate(e=>document.activeElement===e),true);
    await page.evaluate(async()=>{fixture.rows[0].figure_missing=[];await fixture.refresh();});await page.locator('#pd-review-next').click();
    assert.equal(await page.locator('[data-act="confirm-figure"]').evaluate(e=>e.closest('details').open&&document.activeElement===e),true);
    assert.deepEqual(await page.evaluate(()=>fixtureCalls.filter(c=>c.method!=='GET')),[]);assert.deepEqual(requests,[]);
   }finally{await page.close()}
  }}finally{await browser.close()}
 });
}

if(require.main===module && process.argv.includes('--browser')) {
 test('review navigation settles closed on fresh mobile and desktop-to-mobile resize',async()=>{
  fs.mkdirSync(path.join(ROOT,'docs/ui-evidence-20261108/review'),{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{
   for(const width of [390,1487,1440]){
    const page=await browser.newPage({viewport:{width,height:1058}});
    try{
     await page.route('**/*',route=>route.abort());
     await page.setContent(buildFixture());await page.waitForFunction(()=>window.fixtureReady);
     if(width!==390)await page.setViewportSize({width:390,height:844});
     await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().right<=1);
     assert.equal(await page.locator('.t11-drawer').count(),0,'desktop sidebar does not persist as an open mobile drawer');
     await page.locator('#btnFold').click({timeout:1500});
     await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().left>=-1);
     await page.locator('#t11Scrim').click({position:{x:380,y:400},timeout:1500});
     await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().right<=1);
     await page.screenshot({path:path.join(ROOT,'docs/ui-evidence-20261108/review','review-stable-'+width+'-390.png')});
     await page.locator('#pd-next').click({timeout:1500});
     assert.equal(await page.locator('.pd-item').getAttribute('data-id'),'fixture-2');
     await page.setViewportSize({width:1487,height:1058});
     await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().left>=-1);
     await page.setViewportSize({width:390,height:844});
     await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().right<=1);
     await page.locator('#pd-prev').click({timeout:1500});
     assert.equal(await page.locator('.pd-item').getAttribute('data-id'),'fixture-1');
    }finally{await page.close();}
   }
  }finally{await browser.close();}
 });
}

if(require.main===module && !process.argv.includes('--browser') && !process.argv.includes('--write-fixture')) {
  test('review renderer exposes independent classification panel and bottom guarded controls', async()=>{
    const context={ADM:{page:{},chapters:[]},window:{},document:{removeEventListener(){}},api:async()=>({list:[{id:'safe-fixture',stem:'真实函数的合成测试',type_name:'单选题',source:'word',source_label:'Word',options:[],tags:[],content_review_required:true,content_review_pending:true}],counts:{all:1},status_counts:{all:1},page:1,size:20,total:1}),esc:s=>String(s??''),ic:()=>'',pagerHTML:()=>'',optText:s=>s,optLabel:(o,i)=>'A'};
    const html=await vm.runInNewContext(read('public/admin/pendingui.js')+'\nviewPending().then(v=>v.html)',context);
    assert(html.includes('pd-classification'),'right classification panel is missing');
    assert(html.includes('pd-current-commit'),'guarded bottom commit is missing');
    assert(html.includes('data-act="save-classification"'),'classification must have a persistent save action');
    assert(html.includes('pd-advanced'),'advanced batch tools remain available');
    assert(html.includes('展开工具') && html.includes('收起工具'), 'disclosure must communicate both states');
    assert(html.includes('data-act="content-review"'),'existing content confirmation retained');
    assert.match(html,/<li class="done"><span>.*?<\/span>上传资料<\/li><li class="current" aria-current="step"><span>2<\/span>AI核对<\/li><li><span>3<\/span>确认入库<\/li>/);
  });
}

function buildViewer() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>后台审核 · 合成回归与截图</title><style>body{margin:0;background:#e6ebf2;font:14px sans-serif}header{padding:12px;display:flex;gap:10px;align-items:center}button{padding:8px 12px}pre{margin:0 12px 12px;white-space:pre-wrap;max-height:180px;overflow:auto}iframe{border:0;display:block;background:white}#stage{width:100%;overflow:auto}</style><header>合成数据，真实组件，无后端 <button data-width="1487">1487px</button><button data-width="1440">1440px</button><button data-width="390">390px</button><button id="regress">运行三尺寸回归</button><button id="reset">重置画面</button></header><pre id="out">尚未运行</pre><div id="stage"><iframe id="frame" title="审核工作台合成预览" width="1487" height="1058" src="review.html"></iframe></div><script>
  const frame=document.getElementById('frame'), out=document.getElementById('out');
  document.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>{frame.width=b.dataset.width;frame.height=b.dataset.width==='390'?'844':'1058';});
  document.getElementById('reset').onclick=()=>frame.contentWindow.fixture.reset();
  document.getElementById('regress').onclick=async()=>{out.textContent='正在运行真实组件回归…';const results=[];for(const width of [1487,1440,390]){frame.width=width;frame.height=width===390?844:1058;await new Promise(r=>setTimeout(r,100));results.push(await frame.contentWindow.fixture.runRegression());}frame.width=1487;frame.height=1058;out.textContent=JSON.stringify(results,null,2);window.reviewResults=results;};
  </script></html>`;
}
if(require.main===module && process.argv.includes('--write-fixture')) {
  const folder=path.join(ROOT,'evidence/fixtures');fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'review.html'),buildFixture());
  fs.writeFileSync(path.join(folder,'review-viewer.html'),buildViewer());
  console.log('Wrote isolated real-component fixtures to '+folder);
}
if(require.main===module && !process.argv.includes('--browser') && !process.argv.includes('--write-fixture')) {
  test('review hints track server content/image/AI flags without introducing fake classification confirmation',()=>{
    const context={};vm.runInNewContext(read('public/admin/pendingui.js'),context);
    const blocker=vm.runInNewContext('pdReviewBlocker',context);
    for(const item of [{content_review_pending:true},{type_unconfirmed:true},{figure_missing:[1]},{image_errors:[{}]},{figure_review_required:true,figure_review_issue:'wrong'},{ai_legacy_pending:true},{ai_review_pending_fields:['answer']}]) assert.notEqual(blocker(item),'');
    assert.equal(blocker({subject:'数学',stage:'primary',point:'知识点'}),'');
    assert.equal(blocker({ai_point_suggestion:'尚未采纳的建议'}),'','an unused suggestion is not a persisted classification');
  });
  test('classification renderer escapes data and displays unknown provenance truthfully',()=>{
    const context={ADM:{chapters:[]},esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),ic:()=>''};
    vm.runInNewContext(read('public/admin/pendingui.js'),context);
    const render=vm.runInNewContext('pdClassificationHTML',context);const html=render({point:'<script>alert(1)</script>',ai_point_suggestion:'<img>'});
    assert(html.includes('未记录'));assert(html.includes('未关联章节'));assert(!html.includes('<script>'));assert(!html.includes('<img>'));
    assert(!/<button[^>]*>确认分类<\/button>/.test(html),'no fake confirm affordance');
  });
}
if(require.main===module && !process.argv.includes('--browser') && !process.argv.includes('--write-fixture')) {
  test('unsaved classification values are distinguished from persisted fields',()=>{
    const context={};vm.runInNewContext(read('public/admin/pendingui.js'),context);
    const changed=vm.runInNewContext('typeof pdClassificationChanged === "function" ? pdClassificationChanged : null',context);
    assert.equal(typeof changed,'function','dirty classification must gate commit');
    const item={subject:'数学',stage:'primary',grade:'三年级',point:'混合运算'};
    assert.equal(changed(item,{...item}),false);
    assert.equal(changed(item,{...item,point:'新知识点'}),true);
    assert.equal(changed({}, {subject:'',stage:'',grade:'',point:''}),false);
  });
}
// Capture wrappers retain the iframe's real CSS viewport. Four overlapping
// viewport screenshots can be stitched losslessly when cloud full-page capture
// is unavailable; only the outer fixture moves, not the application content.
if(require.main===module && process.argv.includes('--write-fixture')) {
  for(const width of [1487,1440,390]) {
    const height=width===390?844:1058, tileWidth=Math.min(width,800), tileHeight=600;
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>审核截图 ${width}</title><style>body{margin:0;background:#e6ebf2;font:14px sans-serif}header{height:52px;display:flex;align-items:center;gap:8px;padding:0 12px}button{padding:7px 12px}#capture{position:relative;width:${tileWidth}px;height:${tileHeight}px;overflow:hidden;background:white}iframe{position:absolute;left:0;top:0;border:0;width:${width}px;height:${height}px}</style><header>合成审核 ${width} × ${height}<button id="tl">左上</button><button id="tr">右上</button><button id="bl">左下</button><button id="br">右下</button></header><div id="capture"><iframe id="frame" title="审核工作台截图" src="review.html"></iframe></div><script>const f=document.getElementById('frame');const move=(x,y)=>{f.style.left=-x+'px';f.style.top=-y+'px';};document.getElementById('tl').onclick=()=>move(0,0);document.getElementById('tr').onclick=()=>move(${width-tileWidth},0);document.getElementById('bl').onclick=()=>move(0,${height-tileHeight});document.getElementById('br').onclick=()=>move(${width-tileWidth},${height-tileHeight});</script></html>`;
    fs.writeFileSync(path.join(ROOT,'evidence/fixtures',`review-capture-${width}.html`),html);
  }
}
