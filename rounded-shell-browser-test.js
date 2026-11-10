'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
const ROOT=__dirname,PUBLIC=path.join(ROOT,'public'),OUT=path.join(ROOT,'evidence/rounded-shell');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
function part(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i);return s.slice(i,j);}
function asset(file){const ext=path.extname(file),mime={'.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'}[ext];assert(mime,file);return 'data:'+mime+';base64,'+fs.readFileSync(file).toString('base64');}
function style(file){return fs.readFileSync(file,'utf8').replace(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g,(all,a,b,c)=>{const u=a||b||c;if(u.startsWith('data:'))return all;return 'url("'+asset((u.startsWith('/')?path.join(PUBLIC,u):path.resolve(path.dirname(file),u)).split('?')[0].split('#')[0])+'")';});}
function fixture(){
 const admin=read('public/admin/admin.js'),apiSource=read('public/js/api.js');
 const setup=`const Auth={user:{role:'admin',name:'合成教师'}};const store=new Map();const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))};window.fixtureCalls=[];const deny=()=>{throw Error('No external network in fixture');};window.fetch=window.XMLHttpRequest=window.WebSocket=deny;
 async function api(url){fixtureCalls.push(url);if(url.includes('badge-counts'))return {pending:7};if(url==='/api/admin/dashboard')return {today:{active:0,answers:0,correct:0,completed:0},week:{active:3,answers:6,correct:4,completed:2},due:0,feedback:0,expiring:0,trend:Array.from({length:14},(_,i)=>({date:'2026-11-'+String(i+1).padStart(2,'0'),answers:0}))};throw Error(url);}
 `;
 const code=[setup,part(apiSource,'function toast(','function fmtSize('),part(admin,'/* 管理端 SPA','/** Element 上传'),part(admin,'function shell(','// ------------------------------------------------------------ 学生管理'),`async function render(){const key=location.hash.slice(2);if(key&&key!=='dash'){window.fixtureNav=key;return;}const out=await viewDash();$app.innerHTML=shell(out.html);bindShell();out.after();window.fixtureReady=true;}window.addEventListener('hashchange',render);render();`].join('\n');
 new vm.Script(code);
 const hrefs=[...read('public/admin/index.html').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
 const styles=[...hrefs.map(h=>path.resolve(PUBLIC,'admin',h)),path.join(PUBLIC,'admin/r10.css')].map(f=>'<style>'+style(f)+'</style>').join('');
 const converted=code.replaceAll('/img/ui-brand-20261108.png',asset(path.join(PUBLIC,'img/ui-brand-20261108.png'))).replaceAll('/img/ui-rounded-admin-hero-20261108.png',asset(path.join(PUBLIC,'img/ui-rounded-admin-hero-20261108.png')));
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<body class="t11"><div id="app"></div><script>'+converted.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
}
module.exports={fixture};
for(const width of [1487,1024,390])test('rounded dashboard renders and preserves navigation '+width,async()=>{
 fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width,height:width===390?844:1058}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent(fixture());await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,hero:getComputedStyle(document.querySelector('.rounded-dash-hero')).backgroundColor,art:document.querySelector('.rounded-admin-art').naturalWidth,side:document.querySelector('.side').getBoundingClientRect().toJSON()}));
  assert.equal(metrics.overflow,false);assert.equal(metrics.hero,'rgb(16, 78, 67)');assert.ok(metrics.art>500);
  await page.screenshot({path:path.join(OUT,'dashboard-'+width+'.png'),fullPage:false});
  if(width===390){assert.ok(metrics.side.right<=1);await page.locator('#btnFold').click();await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().left>=-1);await page.locator('#t11Scrim').click({position:{x:380,y:400}});await page.waitForFunction(()=>document.querySelector('.side').getBoundingClientRect().right<=1);await page.locator('#btnFold').click();await page.locator('.nav-leaf[data-go="dash"]').click();await page.waitForFunction(()=>!document.querySelector('.t11-drawer'));}
  else{await page.locator('#btnFold').click();assert.ok(await page.locator('.admin-app').evaluate(e=>e.classList.contains('side-fold')));await page.locator('#btnFold').click();}
  await page.locator('[data-period="week"]').click();await page.waitForFunction(()=>document.querySelector('.r10-metric strong').textContent==='3');assert.match(await page.locator('.rounded-learning-summary').innerText(),/67%/);
  await page.locator('.rounded-amber').click();await page.waitForFunction(()=>window.fixtureNav==='pending');assert.equal(await page.evaluate(()=>location.hash),'#/pending');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(OUT,'metrics-'+width+'.json'),JSON.stringify({metrics,errors},null,2));
 }finally{await browser.close();}
});
