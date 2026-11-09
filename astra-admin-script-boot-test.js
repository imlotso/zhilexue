'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/admin/admin.js','utf8');
const boot=source.slice(source.indexOf('(async function boot()'));
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(readyState='loading',token='synthetic'){
 const events=[],calls=[],box={document:{readyState,addEventListener(type,fn,opt){events.push({type,fn,opt});}},Auth:{token},location:{hash:'#/xreport?tab=e'},mfcapConsume:async()=>calls.push('capture'),api:async()=>{calls.push('me');return{id:7};},render(){calls.push(box.viewReady?'report':'missing script');},renderLogin(){calls.push('login');}};
 const promise=vm.runInNewContext(boot,box);return {events,calls,box,promise};
}
test('deep-link boot waits for later page scripts even when account API resolves immediately',async()=>{
 const f=fixture();await flush();assert.deepEqual(f.calls,[]);assert.equal(f.events.length,1);assert.equal(f.events[0].type,'DOMContentLoaded');assert.equal(f.events[0].opt.once,true);
 f.box.viewReady=true;f.box.document.readyState='interactive';f.events[0].fn();await f.promise;
 assert.deepEqual(f.calls,['capture','me','report']);assert.equal(f.box.Auth.user.id,7);
});
test('an already parsed page starts normally without waiting for an event that already fired',async()=>{
 const f=fixture('complete');f.box.viewReady=true;await f.promise;assert.equal(f.events.length,0);assert.deepEqual(f.calls,['capture','me','report']);
});
test('unauthenticated boot waits for scripts then opens login without reading an account',async()=>{
 const f=fixture('loading','');await flush();assert.deepEqual(f.calls,[]);f.events[0].fn();await f.promise;assert.equal(f.box.location.hash,'#/login');assert.deepEqual(f.calls,['capture','login']);
});
