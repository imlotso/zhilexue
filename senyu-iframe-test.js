'use strict';
// Actual parent bridge and actual iframe documents. No child scripts/API/network run.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const {JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync('public/admin/admin.js','utf8');const bridge=source.slice(source.indexOf('function r10EmbeddedApp('),source.indexOf('function viewGrades()'));
const settle=()=>new Promise(r=>setTimeout(r,10));
for(const kind of ['grades','care'])test('integrated '+kind+' iframe owns its theme and preserves parent/child navigation',async()=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM('<div id="host"></div>',{url:'http://synthetic.test/admin/',virtualConsole:vc});
 try{const d=dom.window.document,ctx={document:d};vm.createContext(ctx);vm.runInContext(bridge,ctx);const initial=kind==='grades'?'dashboard':'talks',out=ctx.r10EmbeddedApp(kind,initial);d.getElementById('host').innerHTML=out.html;out.after();const frame=d.getElementById('r10Embedded'),child=frame.contentDocument;child.open();child.write(fs.readFileSync('public/apps/'+kind+'/index.html','utf8'));child.close();frame.dispatchEvent(new dom.window.Event('load'));
 assert.equal(child.documentElement.dataset.uiTheme,'senyu');assert.ok(child.body.classList.contains('sy-'+kind));assert.ok(child.querySelector('link[href*="senyu-tokens.css"]'));assert.ok(child.querySelector('link[href*="senyu-'+kind+'.css"]'));assert.ok(![...child.querySelectorAll('style')].some(s=>/body\s*\{\s*background:#f6f8fc/.test(s.textContent)));
 const next=kind==='grades'?'records':'contacts';d.querySelector('[data-r10-tab="'+next+'"]').click();await settle();assert.equal(frame.contentWindow.location.hash,'#/'+next);assert.equal(d.querySelector('[data-r10-tab="'+next+'"]').getAttribute('aria-current'),'page');
 frame.contentWindow.location.hash='#/students';await settle();assert.equal(d.querySelector('[data-r10-tab="students"]').getAttribute('aria-current'),'page');assert.equal(d.querySelector('[data-r10-tab="'+next+'"]').getAttribute('aria-current'),'false');
 for(const [direction,expected] of [['back',next],['forward','students']]){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('iframe history '+direction+' did not dispatch hashchange')),500);frame.contentWindow.addEventListener('hashchange',()=>{clearTimeout(timer);resolve();},{once:true});frame.contentWindow.history[direction]();});assert.equal(frame.contentWindow.location.hash,'#/'+expected);assert.equal(d.querySelector('[data-r10-tab="'+expected+'"]').getAttribute('aria-current'),'page');}
 if(kind==='grades'){for(const id of ['btnCampusManage','btnPrintPage']){let clicks=0;const target=child.getElementById(id);assert.ok(target);target.addEventListener('click',()=>clicks++);d.querySelector('[data-r10-action="'+id+'"]').click();assert.equal(clicks,1);}}
 const replacement=ctx.r10EmbeddedApp(kind,initial);d.getElementById('host').innerHTML=replacement.html;replacement.after();assert.notEqual(d.getElementById('r10Embedded'),frame);assert.equal(d.querySelector('[data-r10-tab="'+initial+'"]').getAttribute('aria-current'),'page');assert.equal(d.querySelectorAll('[data-r10-tab][aria-current=page]').length,1);
 assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
