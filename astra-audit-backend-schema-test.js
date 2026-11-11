'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {splitSql}=require('./src/mysql-sync');
let Database;try{Database=require('better-sqlite3');new Database(':memory:').close();}catch(_){Database=require('node:sqlite').DatabaseSync;}
test('actual schema survives the production statement splitter and can initialize an empty synthetic database',t=>{
 const source=fs.readFileSync(path.join(__dirname,'src/db.js'),'utf8');const start=source.indexOf('runSchema(`')+'runSchema(`'.length,end=source.indexOf('\n`);',start);assert.ok(start>0&&end>start);
 const statements=splitSql(source.slice(start,end));const db=new Database(':memory:');t.after(()=>db.close());
 for(const sql of statements){const bare=sql.replace(/--[^\n]*(?:\n|$)/g,'').trim();assert.match(bare,/^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b/i,'comment text must never turn into executable SQL: '+bare.slice(0,120));db.exec(sql);}
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='report_uploads'").get());
});
