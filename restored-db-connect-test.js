'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(require('node:path').join(__dirname,'src/mysql-worker.js'),'utf8');
function fixture(mode, identity){
 const start=text.indexOf('function assertDbName('),end=text.indexOf('\nfunction plain(',start);assert.ok(start>=0&&end>start);let options,queries=[],closed=false;
 const conn={async query(sql){queries.push(sql);if(sql.startsWith('SELECT DATABASE() AS db, CURRENT_USER()'))return [[identity]];return [[]]},on(){},async end(){closed=true}};
 const box={process:{env:{RESTORED_DB_MODE:mode}},mysql:{async createConnection(o){options=o;return conn}},cfg:null,conn:null,readOnly:false,dead:false};vm.runInNewContext(text.slice(start,end)+'\nthis.run=connect;',box);
 return {run:box.run, get options(){return options},queries,get closed(){return closed}};
}
const target={host:'127.0.0.1',port:13307,database:'zhilexue_original_restore_20261108',user:'zx_restore_20261108',password:'synthetic'};
const id={db:target.database,account:'zx_restore_20261108@172.17.0.1',server_uuid:'c2460962-da9c-11f1-a7bd-0afb9d5ba49c'};
test('restore mode selects only the existing isolated database without CREATE, USE, ALTER DATABASE',async()=>{const f=fixture('1',id);await f.run(target);assert.equal(f.options.database,target.database);assert.ok(f.queries.some(q=>q.startsWith('SELECT DATABASE() AS db, CURRENT_USER()')));assert.equal(f.queries.some(q=>/^(CREATE DATABASE|ALTER DATABASE|USE )/.test(q)),false)});
test('restore mode rejects any wrong target or server identity',async()=>{
 for(const override of [{host:'other'},{port:3306},{database:'xuexi'},{user:'root'}]){const f=fixture('1',id);await assert.rejects(()=>f.run({...target,...override}));assert.equal(f.queries.length,0)}
 for(const override of [{db:'xuexi'},{account:'root@%'},{server_uuid:'other'}]){const f=fixture('1',{...id,...override});await assert.rejects(()=>f.run(target));assert.equal(f.closed,true)}
});
test('normal mode keeps existing database bootstrap',async()=>{const f=fixture('',id);await f.run(target);assert.equal(f.queries.some(q=>q.startsWith('CREATE DATABASE')),true);assert.equal(f.queries.some(q=>q.startsWith('ALTER DATABASE')),true)});
test('optional isolated relay socket must be exact, not arbitrary',async()=>{
 let f=fixture('1',id);await f.run({...target,socketPath:'/run/db/mysql.sock'});assert.equal(f.options.socketPath,'/run/db/mysql.sock');
 f=fixture('1',id);await assert.rejects(()=>f.run({...target,socketPath:'/tmp/other.sock'}));assert.equal(f.queries.length,0);
});
