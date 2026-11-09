'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(f,'utf8'),source=read('public/admin/admin.js');
test('dashboard keeps real task links while removing the retired subtitle from rendered content',async()=>{
 const ctx={Auth:{user:{role:'branch'}},ADM:{page:{}},api:async()=>({today:{active:0,answers:0,correct:0,completed:0},week:{},trend:[]}),ic:n=>'<i>'+n+'</i>',esc:String};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function viewDash()'),source.indexOf('// ------------------------------------------------------------ 学生管理')),ctx);const out=await ctx.viewDash(),d=new JSDOM(out.html).window.document;
 assert.equal(d.querySelector('h1').textContent,'教学工作台');assert.ok(!d.body.textContent.includes('把题目录入、课堂练习和学习反馈连起来。'));for(const name of ['pending','intake','paper','videos','xreport','ktree'])assert.ok(d.querySelector('[data-go="'+name+'"]'));assert.ok(d.body.textContent.includes('—'));
});
test('embedded navigation preserves hash routing without forcing legacy blue into independent documents',()=>{
 const dom=new JSDOM('<body><div id="host"></div></body>',{url:'http://localhost/admin/'}),d=dom.window.document;const ctx={document:d};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function r10EmbeddedApp('),source.indexOf('function viewGrades()')),ctx);const out=ctx.r10EmbeddedApp('grades','dashboard');d.getElementById('host').innerHTML=out.html;out.after();const f=d.getElementById('r10Embedded');f.contentDocument.open();f.contentDocument.write('<!doctype html><html><head></head><body></body></html>');f.contentDocument.close();f.dispatchEvent(new dom.window.Event('load'));assert.ok(!f.contentDocument.head.textContent.includes('#f6f8fc'));d.querySelector('[data-r10-tab="records"]').click();assert.equal(f.contentWindow.location.hash,'#/records');assert.equal(d.querySelector('[data-r10-tab="records"]').getAttribute('aria-current'),'page');dom.window.close();
});
test('actual entry documents expose the shared theme and load it after existing styles',()=>{
 for(const path of ['public/index.html','public/admin/index.html']){const d=new JSDOM(read(path)).window.document;assert.equal(d.documentElement.dataset.uiTheme,'senyu');assert.ok(d.body.classList.contains('sy-core'));const css=[...d.querySelectorAll('link[rel=stylesheet]')].map(e=>e.getAttribute('href'));const layer=css.findIndex(href=>href.includes('senyu-workspaces.css'));assert.ok(layer>css.findIndex(href=>href.includes('senyu-components.css')));if(path==='public/admin/index.html')assert.equal(layer,css.length-1);else assert.ok(css.at(-1).includes('senyu-student-navigation.css'));assert.ok(d.querySelector('script[src*="senyu-controls.js"]'));}
});
test('real admin save dialog exposes pending state, blocks duplicate save, and restores a failed draft',async()=>{
 const dom=new JSDOM('<body class="t11 sy-theme sy-core"><button id="trigger">编辑</button></body>',{url:'http://localhost/admin/'}),d=dom.window.document;
 const ctx={document:d,esc:String};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function modal('),source.indexOf('/**\n * 删除密码确认弹窗')),ctx);
 let reject,calls=0;const pending=new Promise((_,r)=>reject=r);const box=ctx.modal({title:'编辑',body:'<input id="draft" value="未保存内容">',onOk:()=>{calls++;return pending;}}).el;
 const save=box.querySelector('#mOk');save.click();save.click();assert.equal(calls,1);assert.equal(save.disabled,true);assert.equal(save.getAttribute('aria-busy'),'true');assert.match(save.textContent,/保存中/);
 reject(new Error('测试网络失败'));await new Promise(r=>setTimeout(r,0));assert.equal(box.isConnected,true);assert.equal(box.querySelector('#draft').value,'未保存内容');assert.match(box.querySelector('[role=alert]').textContent,/测试网络失败/);assert.equal(save.disabled,false);assert.equal(save.textContent,'保存');assert.equal(save.hasAttribute('aria-busy'),false);dom.window.close();
});
test('standalone photo/report uploads consume shared theme and retain accessible zoom',()=>{
 for(const path of ['public/upload.html','public/scan-report.html']){const d=new JSDOM(read(path)).window.document;assert.equal(d.documentElement.dataset.uiTheme,'senyu');assert.ok(d.body.classList.contains('sy-upload'));assert.ok(d.querySelector('link[href*="senyu-uploads.css"]'));assert.ok(!/user-scalable=no|maximum-scale=1/.test(d.querySelector('meta[name=viewport]').content));}
});
