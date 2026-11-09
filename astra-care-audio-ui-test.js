'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'public/apps/care/assets/js/common.js'),'utf8');
function fixture(fetchImpl) {
  let token='synthetic-token'; const calls=[]; const window={location:{href:'https://school.example/apps/care/',origin:'https://school.example'},App:{}};
  const localStorage={getItem:()=>token};
  vm.runInNewContext(source,{window,localStorage,URL,FormData,Blob,AbortController,Promise,fetch:async(url,options)=>{calls.push({url,options});return fetchImpl ? fetchImpl(url,options,()=>{token='changed-token'}) : {ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['synthetic audio'],{type:'audio/wav'})}}});
  return {ui:window.App.ui,calls};
}
test('care playback uses same-origin authenticated blob requests without URL token or redirect',async()=>{
  const f=fixture(); const blob=await f.ui.loadAudio('/uploads/audio/au_old.wav'); assert.equal(await blob.text(),'synthetic audio');
  assert.equal(f.calls[0].url,'/uploads/audio/au_old.wav'); assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic-token'); assert.equal(f.calls[0].options.redirect,'error'); assert.equal(f.calls[0].options.cache,'no-store');
  await f.ui.loadAudio('/api/admin/care-audio/'+'a'.repeat(32)); assert.equal(f.calls.length,2);
});
test('external URL, blob URL, unrelated APIs and query tokens never receive login token or fetch',async()=>{
  const f=fixture(); for(const url of ['https://attacker.example/uploads/audio/au_old.wav','//attacker.example/a.wav','blob:local','data:audio/wav;base64,AA==','/api/file?key=audio/a.wav','/uploads/audio/old.wav?token=anything','/api/admin/care-audio/no-id']) await assert.rejects(()=>f.ui.loadAudio(url),/归属待核对|受保护/);
  assert.equal(f.calls.length,0);
});
test('legacy pending and expired session errors stay readable, and account switch discards pending audio',async()=>{
  const f=fixture(async()=>({ok:false,json:async()=>({msg:'历史录音归属待核对，请联系管理员；原文件仍保留'})})); await assert.rejects(()=>f.ui.loadAudio('/uploads/audio/old.wav'),/归属待核对/);
  const switched=fixture(async(u,o,change)=>{change();return {ok:true,headers:{get:()=> 'audio/wav'},blob:async()=>new Blob(['private audio'])}}); await assert.rejects(()=>switched.ui.loadAudio('/uploads/audio/old.wav'),/登录状态已变化/);
});
test('detail views and audio modal never directly embed stored audio URLs; modal cleans up and keeps draft on throw',()=>{
  for(const file of ['talks','contacts']) {const s=fs.readFileSync(path.join(__dirname,'public/apps/care/assets/js/'+file+'.js'),'utf8'); assert.doesNotMatch(s,/<audio[^\n]*src=/);assert.match(s,/detailAudio/); assert.match(s,/ui\.playAudio\(/);}
  assert.doesNotMatch(source,/<audio[^\n]*src=/); assert.match(source,/URL\.revokeObjectURL\(objectUrl\)/); assert.match(source,/controller\.abort\(\)/); assert.match(source,/opts\.onClose/); assert.match(source,/catch \(e\) \{[\s\S]*?toast\(e\.message/);
});
test('modal save failure keeps the draft open; retry succeeds and replacement cleans up once',()=>{
  function element() { return {children:[],events:{},setAttribute(){},removeAttribute(){},querySelectorAll(){return []},focus(){},appendChild(child){child.parent=this;this.children.push(child)},remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)},addEventListener(type,fn){this.events[type]=fn},querySelector(){return this.closeButton||(this.closeButton=element())}}; }
  const root=element(), events={}, messages=[];
  const document={getElementById:()=>root,createElement:element,addEventListener:(k,v)=>{events[k]=v},removeEventListener:(k)=>{delete events[k]}};
  const box={document,esc:String,toast:(msg)=>messages.push(msg)};
  vm.runInNewContext(source.slice(source.indexOf('  function openModal(opts)'),source.indexOf('\n  function confirm(opts)'))+'\nthis.openModal=openModal;',box);
  let fail=true,closed=0;const ctx=box.openModal({buttons:[{text:'Save',onClick(){if(fail)throw new Error('空间不足，草稿仍保留')}}],onClose(){closed++}});
  const save=ctx.el.children[0].children[0]; save.events.click();assert.equal(root.children.length,1);assert.equal(closed,0);assert.equal(messages[0],'空间不足，草稿仍保留');
  fail=false;save.events.click();assert.equal(root.children.length,0);assert.equal(closed,1);
  box.openModal({onClose(){closed++}});box.openModal({});assert.equal(root.children.length,1);assert.equal(closed,2);
});
