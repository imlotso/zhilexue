'use strict';
// Execute the complete production api.js with synthetic fetch responses and localStorage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function fixture(t){
 const dom=new JSDOM('<body></body>',{url:'http://localhost/#/words/quick'});t.after(()=>dom.window.close());
 const requests=[];
 const box=vm.createContext({window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver,localStorage:dom.window.localStorage,location:dom.window.location,requestAnimationFrame:fn=>fn(),getComputedStyle:dom.window.getComputedStyle.bind(dom.window),setTimeout(){},clearTimeout(){},fetch:(url,opts)=>new Promise(resolve=>requests.push({url,opts,resolve}))});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'public/js/api.js'),'utf8'),box);
 const run=code=>vm.runInContext(code,box);
 const account=(token,id)=>{box.nextToken=token;box.nextId=id;run('Auth.token=nextToken;Auth.user=nextId?{id:nextId}:null');};
 const reject=index=>requests[index].resolve({ok:false,status:401,json:async()=>({code:401,msg:'Synthetic expired session'})});
 return {box,run,requests,account,reject,dom};
}
for(const initial of ['A',''])test('F4 real API: late '+(initial||'anonymous')+' 401 must not clear a newer signed-in account',async t=>{
 const f=fixture(t);f.account(initial,initial||null);const response=f.box.api('/api/stu/word/stats?book_id=1',{silent:true});f.account('B','B');f.reject(0);
 await assert.rejects(response,/Synthetic expired/);assert.equal(f.run('Auth.token'),'B');assert.equal(f.run('Auth.user.id'),'B');assert.equal(f.dom.window.location.hash,'#/words/quick');
 if(initial)assert.equal(f.requests[0].opts.headers.Authorization,'Bearer A');else assert.equal(f.requests[0].opts.headers.Authorization,undefined);
});
for(const initial of ['A',''])test('F4 real API control: current '+(initial||'anonymous')+' 401 clears session and redirects',async t=>{
 const f=fixture(t);f.account(initial,initial||null);const response=f.box.api('/api/me',{silent:true});f.reject(0);
 await assert.rejects(response,/Synthetic expired/);assert.equal(f.run('Auth.token'),'');assert.equal(f.run('Auth.user'),null);assert.equal(f.dom.window.location.hash,'#/login');
});
test('F4 real API: refreshed token of the same account survives old 401; new 401 still expires it',async t=>{
 const f=fixture(t);f.account('A-old','A');const old=f.box.api('/api/stu/word/stats?book_id=1',{silent:true});f.account('A-new','A');const current=f.box.api('/api/me',{silent:true});
 f.reject(0);await assert.rejects(old,/Synthetic expired/);assert.equal(f.run('Auth.token'),'A-new');f.reject(1);await assert.rejects(current,/Synthetic expired/);assert.equal(f.run('Auth.token'),'');
});
