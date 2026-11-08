'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),jwt=require('jsonwebtoken');
const source=fs.readFileSync(path.join(__dirname,'src/auth.js'),'utf8');
function fixture(epoch){
 const mod={exports:{}}, secret='synthetic-secret',row={id:42,role:'student',status:1,username:'student-synthetic',name:'Synthetic'};
 const env={JWT_SECRET:secret};if(epoch)env.TICKET_EPOCH=epoch;
 const policy=require('./src/ticket-epoch').createPolicy(epoch||'');
 vm.runInNewContext(source,{module:mod,exports:mod.exports,process:{env},Buffer,Date,require(n){if(n==='./db')return {DATA_DIR:'/not-real',db:{prepare(){return {get(){return row}}}}};if(n==='./ticket-epoch')return policy;return require(n)}},{filename:'src/auth.js'});
 return {auth:mod.exports,secret};
}
function invoke(f,t){const req={headers:{authorization:'Bearer '+t},query:{}},res={status(n){this.code=n;return this},json(x){this.body=x;return this}};let next=false;f.auth.auth()(req,res,()=>next=true);return {next,res};}
test('old JWT cannot access restored account, newly issued JWT can using unchanged secret',()=>{
 const old=fixture(''),fresh=fixture('1700000000'),token=old.auth.sign({id:42,role:'student'});
 assert.equal(invoke(fresh,token).next,false);assert.equal(invoke(fresh,token).res.code,401);
 assert.equal(invoke(fresh,fresh.auth.sign({id:42,role:'student'})).next,true);
 assert.equal(jwt.verify(fresh.auth.sign({id:42,role:'student'}),fresh.secret).session_epoch,'1700000000');
});
test('old file and question tickets fail while new tickets work under unchanged key',()=>{
 const old=fixture(''),fresh=fixture('1700000000'),key='bank/img/example.png';
 assert.equal(fresh.auth.verifyFileTicket(key,old.auth.signFileTicket(key)),false);
 assert.equal(fresh.auth.verifyFileTicket(key,fresh.auth.signFileTicket(key)),true);
 assert.equal(fresh.auth.verifyQuestionTicket(42,5,old.auth.signQuestionTicket(42,5)),false);
 assert.equal(fresh.auth.verifyQuestionTicket(42,5,fresh.auth.signQuestionTicket(42,5)),true);
});
function uploadFixture(epoch){
 const text=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8'),start=text.indexOf('const upSign ='),end=text.indexOf('const okUp =',start);assert.ok(start>=0&&end>start);
 const ticketEpoch=require('./src/ticket-epoch').createPolicy(epoch||'');let adminFn;
 const ctx={jwt,ticketEpoch,upSecret:()=> 'synthetic-secret',admin:{post(_p,fn){adminFn=fn}},ok(){},intakeScope(){},require(){return ()=>({})},db:{prepare(){return {get(){return {role:'student',status:1}}}}},Date,console};
 vm.runInNewContext(text.slice(start,end)+';this.result={upSign,upAuth};',ctx);return ctx.result;
}
test('restored upload rejects pre-cutover QR token and accepts newly signed token',()=>{
 const old=uploadFixture(''),fresh=uploadFixture('1700000000');
 function call(token){const req={query:{token}},res={status(n){this.code=n;return this},json(){return this}};let next=false;fresh.upAuth(req,res,()=>next=true);return {next,res}}
 assert.equal(call(old.upSign({uid:42})).next,false);
 assert.equal(call(fresh.upSign({uid:42})).next,true);
});
function captureFixture(file,epoch){
 const text=fs.readFileSync(path.join(__dirname,'src',file),'utf8');
 const start=text.indexOf("cap.use((req, res, next) => {\n  const h = req.headers.authorization");const end=text.indexOf('\n});',start);assert.ok(start>=0&&end>start);
 let handler;const policy=require('./src/ticket-epoch').createPolicy(epoch||'');
 const box={cap:{use(fn){handler=fn}},ticketEpoch:policy,jwt,DATA_DIR:'/synthetic',captureAccount(id){return {id,role:'admin'}},
 fail(res,msg,code){res.statusCode=code;res.body=msg;return res},require(n){if(n==='fs')return {readFileSync:()=> 'synthetic-secret'};if(n==='path')return path;if(n==='./db')return {DATA_DIR:'/synthetic'};throw Error(n)}};
 vm.runInNewContext(text.slice(start,end+4),box);return {handler,policy};
}
for(const file of ['mfbank.js','mfcollect.js'])test(file+' capture rejects old token and accepts new epoch',()=>{
 const f=captureFixture(file,'1700000000'),claims={id:42,account_role:'admin',role:'mfcapture'};
 const old=jwt.sign(claims,'synthetic-secret'),fresh=jwt.sign(f.policy.issueClaims(claims),'synthetic-secret');
 function call(token){const req={headers:{authorization:'Bearer '+token},query:{}},res={status(n){this.statusCode=n;return this}};let next=false;f.handler(req,res,()=>next=true);return next}
 assert.equal(call(old),false);assert.equal(call(fresh),true);
});
test('teacher upload route issues an epoch-bound token accepted by upload middleware',()=>{
 const text=fs.readFileSync(path.join(__dirname,'src/bank.js'),'utf8'),start=text.indexOf('const upSign ='),end=text.indexOf('const okUp =',start);let issue;
 const policy=require('./src/ticket-epoch').createPolicy('1700000000');const box={jwt,ticketEpoch:policy,upSecret:()=> 'synthetic-secret',admin:{post(_p,fn){issue=fn}},ok(res,data){res.data=data},fail(){throw Error('unexpected')},require(){return ()=>({})},db:{prepare(){return {get(){return {role:'admin',status:1}}}}},Date};
 vm.runInNewContext(text.slice(start,end)+';this.upAuth=upAuth',box);
 const res={};issue({user:{id:42,role:'admin'},body:{}},res);let next=false;box.upAuth({query:{token:res.data.token}},{status(){return this},json(){}},()=>next=true);assert.equal(next,true);
});
test('both capture issuers add the epoch to newly issued JWTs',()=>{
 const policy=require('./src/ticket-epoch').createPolicy('1700000000');
 for (const file of ['mfbank.js','mfcollect.js']) {
  const text=fs.readFileSync(path.join(__dirname,'src',file),'utf8');let source;
  if(file==='mfbank.js'){const start=text.indexOf("admin.get('/capture/token'");const end=text.indexOf('\n});',start);source=text.slice(start,end+4)}
  else {const start=text.indexOf('function issueCaptureToken(uid)');const end=text.indexOf('\n}\n',start);source=text.slice(start,end+2)+';this.call=issueCaptureToken;'}
  let handler;const box={ticketEpoch:policy,jwt,DATA_DIR:'/synthetic',captureAccount:()=>({id:42,role:'admin'}),ok(res,data){res.data=data},fail(){throw Error('unexpected')},admin:{get(_p,fn){handler=fn}},require(n){if(n==='fs')return {readFileSync:()=> 'synthetic-secret'};if(n==='path')return path;if(n==='./db')return {DATA_DIR:'/synthetic'};throw Error(n)}};
  vm.runInNewContext(source,box);let token;if(handler){const res={};handler({user:{id:42,role:'admin'}},res);token=res.data.token}else token=box.call(42);
  assert.equal(jwt.verify(token,'synthetic-secret').session_epoch,'1700000000');
 }
});
