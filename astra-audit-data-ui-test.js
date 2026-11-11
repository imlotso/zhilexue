'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function fixture(t,answer='A,C'){
 const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());let modal,root;const messages=[],calls=[];
 const context={document:dom.window.document,window:dom.window,location:dom.window.location,console,esc:x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),optText:o=>o.text||'',toast:x=>messages.push(x),render:()=>{},t8Enhance:()=>{},t7AudioWidget:()=>null,QSubtype:require('./public/js/question-subtypes'),api:async(url,request)=>{calls.push({url,request})},modal:opts=>{modal=opts;root=dom.window.document.createElement('div');root.innerHTML=opts.body;dom.window.document.body.appendChild(root);opts.onMount(root)}};
 context.Option=dom.window.Option;vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/public/js/question-subtypes.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/public/admin/pendingui.js','utf8'),context);
 context.pdEdit({id:'cap:1:0:12345678',edit_signature:'snapshot',source_label:'synthetic',type:'multi',subject:'数学',stage:'primary',options:['one','two','three'].map((text,i)=>({label:'ABC'[i],text})),answer,stem:'synthetic',images:[]});
 return {root,messages,calls,save:()=>modal.onOk(root)};
}
test('I2 deleting an option marked correct requires first explicitly changing the answer',t=>{
 const f=fixture(t);f.root.querySelector('[data-delopt]').click();
 assert.equal(f.root.querySelectorAll('.pd-optrow').length,3);assert.equal(f.root.querySelector('#pdE-ans').value,'A,C');assert.ok(f.messages.some(m=>/答案/.test(m)));
});
test('I2 deleting a non-answer option renumbers surviving answers consistently',async t=>{
 const f=fixture(t);f.root.querySelectorAll('[data-delopt]')[1].click();
 assert.equal(f.root.querySelector('#pdE-ans').value,'A,B');await f.save();
 const patch=f.calls[0].request.body.items[0].patch;assert.equal(patch.answer,'A,B');assert.deepEqual(Array.from(patch.options,o=>o.label),['A','B']);
});
test('I2 clearing an option sends original row identity and blank to server for validation',async t=>{
 const f=fixture(t,'C');f.root.querySelectorAll('.pd-opt')[1].value='';await f.save();
 const patch=f.calls[0].request.body.items[0].patch;assert.equal(patch.options.length,3);assert.equal(patch.options[1].label,'B');assert.equal(patch.options[1].text,'');
});
test('I1 saved rich text continues through existing HTML sanitizer, not raw DOM injection',t=>{
 const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());const context={DOMParser:dom.window.DOMParser,window:dom.window};vm.createContext(context);
 vm.runInContext(fs.readFileSync(__dirname+'/public/admin/qcard.js','utf8'),context);
 const {questionStemFields}=require('./src/question-content');const stored=questionStemFields('<p onclick="bad()">x &lt; 3 <b>safe</b><img src="/synthetic.png" onerror="bad()"></p><script>bad()</script>');
 const safe=context.qcSafeHtml(stored.stem_html);assert(!/onclick|onerror|script|bad\(/.test(safe));assert(safe.includes('<b>safe</b>'));assert(safe.includes('x &lt; 3'));
});
