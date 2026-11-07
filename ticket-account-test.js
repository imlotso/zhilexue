'use strict';
// Offline production-function tests: no service, real database, credentials or network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
let Database;
try { Database = require('better-sqlite3'); } catch { Database = require('node:sqlite').DatabaseSync; }
const source = name => fs.readFileSync(__dirname + '/src/' + name + '.js', 'utf8');
function harness(name) {
  let account = {id:7,role:'admin',status:1,expire_at:null};
  const routes = {}, middleware = [];
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, status INTEGER, expire_at TEXT)');
  function set(user) { account=user; db.exec('DELETE FROM users'); if(user) db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(user.id,user.role,user.status,user.expire_at); }
  set(account);
  const ctx = { Date: class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-11-07T12:00:00'])); } static now() { return new Date('2026-11-07T12:00:00').getTime(); } },
    db,
    jwt:{verify: t=>JSON.parse(t),sign:p=>JSON.stringify(p)},
    require: n=> n==='fs' ? {readFileSync:()=> 'synthetic-secret'} : n==='path' ? require('node:path') : n==='./intake-scope' ? ()=>({}) : {DATA_DIR:'/synthetic'},
    DATA_DIR:'/synthetic',crypto:require('node:crypto'),proxyEnabled:()=>true,
    ok:(res,data)=>res.json({code:0,data}),fail:(res,msg,code=1)=>res.json({code,msg}),upSecret:()=> 'synthetic-secret',
    cap:{use:fn=>middleware.push(fn)},admin:{post:(p,fn)=>routes[p]=fn,get:(p,fn)=>routes[p]=fn},
  };
  vm.createContext(ctx);
  const s=source(name);
  if (name==='bank') {
    vm.runInContext(s.slice(s.indexOf("admin.post('/teacher-upload-token'"),s.indexOf('const okUp ='))+'\nthis.auth=upAuth;',ctx);
  } else {
    const helperStart=s.indexOf('function captureAccount(');
    if(helperStart>=0) vm.runInContext(s.slice(helperStart,s.indexOf('\n/**',helperStart)),ctx);
    const start=s.indexOf("cap.use((req, res, next) => {\n  const h =");
    const end=s.indexOf('\n});',start)+4;
    vm.runInContext(s.slice(start,end),ctx);ctx.auth=middleware[0];
    if(name==='mfcollect') vm.runInContext(s.slice(s.indexOf('const TICKETS ='),s.indexOf('// ==================================================================== 代理内嵌浏览器'))+'\nthis.issue=issueCaptureToken;this.ticket=issueTicket;this.check=checkTicket;',ctx);
    else vm.runInContext(s.slice(s.indexOf("admin.get('/capture/token'"),s.indexOf('/** 书签小工具脚本')),ctx);
  }
  if(name==='mfcollect') {
    ctx.UA='synthetic';ctx.fetchPageAuto=()=>({then:fn=>{ctx.fetched=fn;return {catch:()=>{}};}});
    ctx.decodeBuf=()=>'';ctx.rewriteHTML=(html,url,k,token)=>{ctx.injected=token;return html;};
    vm.runInContext(s.slice(s.indexOf('function handleProxy('),s.indexOf("proxy.get('/r', handleProxy)")),ctx);
  }
  function call(fn,payload,extra={}) {const req={headers:{authorization:'Bearer '+JSON.stringify(payload)},query:{token:JSON.stringify(payload)},user:account,...extra};const res={status(code){this.statusCode=code;return this},json(value){this.value=value;return this}};let passed=false;fn(req,res,()=>passed=true);return {passed,value:res.value,req,statusCode:res.statusCode};}
  return {ctx,routes,call,set,base:()=>({id:7,role:'admin',status:1,expire_at:null})};
}
for(const name of ['mfbank','mfcollect']) {
 test(name+' capture revalidates issuer lifecycle and role',()=>{
  const h=harness(name), p={id:7,role:'mfcapture',account_role:'admin'};
  assert.equal(h.call(h.ctx.auth,p).passed,true);
  for(const user of [null,{...h.base(),status:0},{...h.base(),role:'student'},{...h.base(),role:'branch'}]) {h.set(user);assert.equal(h.call(h.ctx.auth,p).passed,false);}
  h.set({...h.base(),role:'branch',expire_at:'2026-11-06'});assert.equal(h.call(h.ctx.auth,{...p,account_role:'branch'}).passed,false);
  h.set({...h.base(),role:'branch',expire_at:'2026-11-07'});assert.equal(h.call(h.ctx.auth,{...p,account_role:'branch'}).passed,true);
 });
 test(name+' rejects legacy unbound capture with regeneration message',()=>{const h=harness(name);const r=h.call(h.ctx.auth,{role:'mfcapture'});assert.equal(r.passed,false);assert.match(r.value.msg,/重新生成/);assert.equal(r.statusCode,401,'bookmarklet uses HTTP 401 to offer clearing its cached legacy ticket');});
 test(name+' capture issuance binds actual account and role',()=>{const h=harness(name);const result=name==='mfbank'?h.call(h.routes['/capture/token'],{}).value.data.token:h.ctx.issue(7);const p=JSON.parse(result);assert.equal(p.id,7);assert.equal(p.account_role,'admin');});
}
test('scan tickets enforce expiry boundary, deletion, status and signed teacher role',()=>{
 const h=harness('bank');
 for(const role of ['student','branch','admin']) {const p={uid:7,role:role==='student'?'up':'upteacher',account_role:role};
  h.set({...h.base(),role,expire_at:'2026-11-07'});assert.equal(h.call(h.ctx.auth,p).passed,true);
  if(role!=='admin'){h.set({...h.base(),role,expire_at:'2026-11-06'});assert.equal(h.call(h.ctx.auth,p).passed,false);}
  h.set({...h.base(),role,status:0});assert.equal(h.call(h.ctx.auth,p).passed,false);
  h.set(null);assert.equal(h.call(h.ctx.auth,p).passed,false);
 }
 h.set(h.base());assert.equal(h.call(h.ctx.auth,{uid:7,role:'upteacher',account_role:'branch'}).passed,false);
 assert.equal(h.call(h.ctx.auth,{uid:7,role:'upteacher'}).passed,false);
 const signed=JSON.parse(h.call(h.routes['/teacher-upload-token'],{}, {body:{}}).value.data.token);assert.equal(signed.account_role,'admin');
});
test('proxy issuance and cached tickets revalidate actual issuer',()=>{
 const h=harness('mfcollect');const r=h.call(h.routes['/proxy-ticket'],{}).value.data;assert.equal(JSON.parse(r.capture).id,7);
 const req={query:{k:r.k},headers:{}};assert.ok(h.ctx.check(req));h.set({...h.base(),status:0});assert.equal(h.ctx.check(req),null);
 h.set(h.base());const k=h.ctx.ticket(7);h.set({...h.base(),role:'branch'});assert.equal(h.ctx.check({query:{k},headers:{}}),null);
});

test('proxy handler injects an account-bound capture token without external requests',()=>{
 const h=harness('mfcollect'), k=h.ctx.ticket(7);
 const res={setHeader(){},removeHeader(){},send(){}};
 h.ctx.handleProxy({query:{k,u:'https://synthetic.invalid/'},headers:{},method:'GET'},res);
 h.ctx.fetched({headers:{'content-type':'text/html'},buf:Buffer.from(''),finalUrl:'https://synthetic.invalid/'});
 assert.equal(JSON.parse(h.ctx.injected).id,7);assert.equal(JSON.parse(h.ctx.injected).account_role,'admin');
});
