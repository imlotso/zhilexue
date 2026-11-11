'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {JSDOM}=require('jsdom');
const fs=require('fs');
const code=fs.readFileSync('public/admin/pending-figure.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<5;i++)await tick();}
function fixture(handler,item={}){
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://synthetic.invalid'}),w=dom.window;
 const draws=[],posts=[],requests=[];let config,root;
 w.HTMLCanvasElement.prototype.getContext=function(){return {clearRect(){},drawImage(...a){draws.push(a)},strokeRect(){}}};
 w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob(['synthetic'],{type:'image/png'}));};
 w.HTMLCanvasElement.prototype.setPointerCapture=function(){};w.HTMLCanvasElement.prototype.hasPointerCapture=()=>false;
 w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};
 w.Image=class{constructor(){this.naturalWidth=1000;this.naturalHeight=2000;}set src(v){queueMicrotask(()=>this.onload());}};
 w.PD_API='/api/admin/bank/mf';w.Auth={token:'synthetic'};w.toast=()=>{};w.render=()=>{};w.elConfirm=async()=>true;
 w.fetch=async(url,opts={})=>{requests.push({url,opts});if(opts.method==='POST'){posts.push({url,opts});return {json:async()=>({code:0})};}const special=handler&&handler(url,opts);if(special)return special;if(url.includes('original-image'))return {ok:true,headers:{get:()=> 'image/png'},blob:async()=>new w.Blob(['image'])};return {ok:true,json:async()=>({code:0,data:{figure_candidates:[]}})};};
 w.modal=cfg=>{config=cfg;root=w.document.createElement('section');root.innerHTML=cfg.body;w.document.body.append(root);cfg.onMount(root);return root;};
 w.eval(code);w.pdCropFigure({id:'run:1:0',original_pages:2,original_page:1,figure_missing:[1],images:[],...item});
 return {w,root,draws,posts,requests,config,close:()=>w.close()};
}
const response=regions=>({ok:true,json:async()=>({code:0,data:{figure_candidates:regions}})});
test('native candidate requires explicit selection and save, uses pixel bounds',async()=>{
 const f=fixture(url=>url.includes('/original?')?response([{x:.1,y:.2,w:.3,h:.4}]):null);await settle();
 const select=f.root.querySelector('#pdFigCandidate');assert(select,'candidate selector exists');assert.equal(select.options.length,2);assert.equal(select.value,'');assert.equal(f.posts.length,0);
 select.value='0';select.onchange();assert.equal(f.posts.length,0,'preselection never binds or saves');
 let error;await f.config.onOk(f.root,e=>error=e);assert.equal(error,undefined);assert.equal(f.posts.length,1);
 const crop=f.draws.find(a=>a.length===9);assert.deepEqual(crop.slice(1,5),[100,400,300,800]);assert(f.requests.filter(r=>!r.opts.method).every(r=>r.opts.headers.Authorization==='Bearer synthetic'));f.close();
});
test('invalid or unavailable metadata leaves manual crop available',async()=>{
 const f=fixture(url=>url.includes('/original?')?response([{x:-1,y:0,w:.3,h:.3},{x:0,y:0,w:1.5,h:.5},{x:'0',y:0,w:.3,h:.3}]):null);await settle();
 const select=f.root.querySelector('#pdFigCandidate');assert(select.disabled);const c=f.root.querySelector('canvas');c.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});
 const ev=(x,y)=>({clientX:x,clientY:y,pointerId:1,preventDefault(){}});c.onpointerdown(ev(10,20));c.onpointermove(ev(110,220));c.onpointerup(ev(110,220));await f.config.onOk(f.root,()=>{});assert.equal(f.posts.length,1);f.close();
});
test('late previous-page metadata cannot replace current candidates',async()=>{
 let release;const old=new Promise(r=>release=r);const f=fixture(url=>url.includes('/original?')?(url.endsWith('page=1')?old:response([{x:.6,y:.2,w:.2,h:.2}])):null);await settle();
 const page=f.root.querySelector('#pdFigPage');page.value='2';page.onchange();await settle();release(response([{x:.1,y:.1,w:.2,h:.2},{x:.2,y:.2,w:.2,h:.2}]));await settle();
 const select=f.root.querySelector('#pdFigCandidate');assert.equal(select.options.length,2);select.value='0';select.onchange();await f.config.onOk(f.root,()=>{});assert.equal(f.draws.find(a=>a.length===9)[1],600);f.close();
});
test('image failure after page change clears old crop and candidates',async()=>{
 const f=fixture(url=>url.includes('original-image')&&url.endsWith('page=2')?{ok:false,headers:{get:()=> 'application/json'},json:async()=>({msg:'synthetic unavailable'})}:url.includes('/original?')?response([{x:.1,y:.2,w:.3,h:.4}]):null);await settle();
 const select=f.root.querySelector('#pdFigCandidate');select.value='0';select.onchange();const page=f.root.querySelector('#pdFigPage');page.value='2';page.onchange();await settle();let error;await f.config.onOk(f.root,e=>error=e);assert(error);assert.equal(f.posts.length,0);assert(select.disabled);f.close();
});

test('metadata failure does not block image or manual crop',async()=>{
 const f=fixture(url=>url.includes('/original?')?Promise.reject(new Error('synthetic metadata unavailable')):null);await settle();
 const select=f.root.querySelector('#pdFigCandidate');assert(select.disabled);assert(f.root.querySelector('#pdFigStatus').textContent.includes('仍可手动'));
 const c=f.root.querySelector('canvas');c.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});
 const ev=(x,y)=>({clientX:x,clientY:y,pointerId:1,preventDefault(){}});c.onpointerdown(ev(10,20));c.onpointermove(ev(110,220));c.onpointerup(ev(110,220));await f.config.onOk(f.root,()=>{});assert.equal(f.posts.length,1);f.close();
});
test('page change while replacement confirmation is open cannot save another selection',async()=>{
 const f=fixture(url=>url.includes('/original?')?response([{x:.1,y:.2,w:.3,h:.4}]):null,{images:['existing.png']});await settle();
 let confirm;f.w.elConfirm=()=>new Promise(r=>confirm=r);const select=f.root.querySelector('#pdFigCandidate');select.value='0';select.onchange();let error;const save=f.config.onOk(f.root,e=>error=e);
 const page=f.root.querySelector('#pdFigPage');page.value='2';page.onchange();await settle();select.value='0';select.onchange();confirm(true);await save;assert(error);assert.equal(f.posts.length,0);f.close();
});

test('valid candidate or manual crop clears only stale missing-selection error',async()=>{
 const f=fixture(url=>url.includes('/original?')?response([{x:.1,y:.2,w:.3,h:.4}]):null);await settle();
 const error=f.w.document.createElement('div');error.id='mErr';error.className='hide';error.innerHTML='<span class="el-alert__title"></span>';f.root.append(error);
 const title=error.querySelector('span'),show=msg=>{title.textContent=msg;error.classList.remove('hide');return false;};
 await f.config.onOk(f.root,show);assert.equal(title.textContent,'请先在原页框选图片');
 const select=f.root.querySelector('#pdFigCandidate');select.value='0';select.onchange();
 assert(error.classList.contains('hide'));assert.equal(title.textContent,'');assert.equal(f.posts.length,0);
 for(const msg of ['服务器保存失败','图号应为 1 到 30']){
  show(msg);select.onchange();assert.equal(title.textContent,msg);assert(!error.classList.contains('hide'));
 }
 show('请先在原页框选图片');select.value='';select.onchange();assert(!error.classList.contains('hide'));
 const c=f.root.querySelector('canvas');c.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:2000});
 const ev=(x,y)=>({clientX:x,clientY:y,pointerId:1,preventDefault(){}});
 c.onpointerdown(ev(10,20));c.onpointermove(ev(12,22));c.onpointerup(ev(12,22));assert(!error.classList.contains('hide'));
 c.onpointerdown(ev(10,20));c.onpointermove(ev(110,220));c.onpointerup(ev(110,220));
 assert(error.classList.contains('hide'));assert.equal(title.textContent,'');assert.equal(f.posts.length,0);f.close();
});
