'use strict';
const { test }=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Database=require('better-sqlite3');
test('self assessment column is additive, nullable and idempotent without changing teacher scores',()=>{
 const source=fs.readFileSync('src/db.js','utf8'),start=source.lastIndexOf('runSchema(`',source.indexOf('CREATE TABLE IF NOT EXISTS subjective_responses')),end=source.indexOf('// T10：',start),schema=source.slice(start,end),db=new Database(':memory:');
 try{vm.runInNewContext(schema,{db,runSchema:s=>db.exec(s)});db.prepare("INSERT INTO subjective_responses(user_id,question_id,kind,created_at,score) VALUES (1,2,'paper','test',7)").run();vm.runInNewContext(schema,{db,runSchema:s=>db.exec(s)});const row=db.prepare('SELECT score,self_correct FROM subjective_responses').get();assert.deepEqual(row,{score:7,self_correct:null});db.prepare('UPDATE subjective_responses SET self_correct=?').run(0);assert.deepEqual(db.prepare('SELECT score,self_correct FROM subjective_responses').get(),{score:7,self_correct:0});}finally{db.close();}
});

test('personal record provenance is additive and does not rewrite historical records',()=>{
 const source=fs.readFileSync('src/db.js','utf8'),start=source.lastIndexOf('runSchema(`',source.indexOf('CREATE TABLE IF NOT EXISTS subjective_responses')),end=source.indexOf('// T10：',start),schema=source.slice(start,end),db=new Database(':memory:');
 try{db.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, user_id INTEGER, question_id INTEGER, is_correct INTEGER)');db.exec('INSERT INTO records VALUES (1,2,3,1)');vm.runInNewContext(schema,{db,runSchema:s=>db.exec(s)});vm.runInNewContext(schema,{db,runSchema:s=>db.exec(s)});assert.deepEqual(db.prepare('SELECT * FROM records').get(),{id:1,user_id:2,question_id:3,is_correct:1,self_response_id:null});}finally{db.close();}
});
