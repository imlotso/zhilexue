'use strict';
// Executes the unmodified production worker in a VM with an in-memory fake MySQL.
// No network/database tools or application mutation. Fake disconnect rolls back
// pending rows, matching the transaction lifetime of a lost MySQL connection.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sourcePath = path.resolve(process.argv[2] || process.cwd(), 'src/mysql-worker.js');
const bytes = fs.readFileSync(sourcePath);
const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
assert.equal(blob, '5b797bf7104393fd96b8bed269a1b2edba589f7f', 'Must test the verified main source blob');
const source = bytes.toString('utf8');
async function scenario(mode) {
  let listener; let id = 0;
  const committed = [], connections = [], replies = [], events = [];
  const mysql = {
    async createConnection() {
      const c = { id: connections.length + 1, alive: true, tx: false, pending: [], onError: null,
        on(name, cb) { assert.equal(name, 'error'); this.onError = cb; },
        async end() { this.alive = false; this.pending = []; events.push(`end connection ${this.id}`); },
        disconnect(notify) {
          this.alive = false; this.pending = []; this.tx = false;
          events.push(`disconnect connection ${this.id}; uncommitted rows rolled back; notify=${notify}`);
          if (notify) this.onError(Object.assign(new Error('connection lost'), {fatal: true, code: 'PROTOCOL_CONNECTION_LOST'}));
        },
        async query(sql, params) {
          const upper = String(sql).trim().toUpperCase();
          events.push(`connection ${this.id}: ${sql}`);
          if (!this.alive) throw Object.assign(new Error("Can't add new command when connection is in closed state"), {fatal: true});
          if (upper.startsWith('SELECT VERSION()')) return [[{version:'FAKE-IN-MEMORY',db:'test_only'}]];
          if (upper.startsWith('CREATE DATABASE') || upper.startsWith('ALTER DATABASE') || upper.startsWith('USE ') || upper.startsWith('SET SESSION')) return [{affectedRows:0}];
          if (upper === 'START TRANSACTION') { this.tx = true; return [{affectedRows:0}]; }
          if (upper.startsWith('INSERT INTO REPRO')) { assert(this.tx); this.pending.push(params[0]); return [{affectedRows:1,insertId:1}]; }
          if (upper === 'COMMIT') { committed.push(...this.pending); this.pending = []; this.tx = false; return [{affectedRows:0}]; }
          if (upper === 'ROLLBACK') { this.pending = []; this.tx = false; return [{affectedRows:0}]; }
          throw Error('Unexpected fake SQL: ' + sql);
        }
      };
      connections.push(c); events.push(`create connection ${c.id}`); return c;
    }
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'worker_threads') return {parentPort:{on(event, fn){assert.equal(event,'message');listener=fn;}},workerData:{sab:new SharedArrayBuffer(4)}};
      if (name === 'mysql2/promise') return mysql;
      throw Error('Forbidden require: ' + name);
    },
    process:{env:{},exit(){throw Error('Unexpected worker exit');}},
    console:{error(...parts){events.push('worker: '+parts.join(' '));}},
    setInterval(){return {unref(){}};},
  });
  new vm.Script(source, {filename:sourcePath}).runInContext(context);
  async function send(payload) {
    const next = ++id; await listener({...payload,id:next});
    const reply = replies.find(r=>r.id===next); assert(reply,'worker reply exists'); return reply;
  }
  assert.equal((await send({type:'init',config:{host:'fake',port:0,user:'fake',database:'test_only'},reply:{postMessage:r=>replies.push(r)}})).ok,true);
  assert.equal((await send({type:'query',sql:'START TRANSACTION'})).ok,true);
  const inserted = await send({type:'query',sql:'INSERT INTO repro (value) VALUES (?)',params:['saved-value']});
  assert.equal(inserted.ok,true); assert.equal(inserted.data.changes,1);
  if (mode !== 'healthy') connections[0].disconnect(mode === 'fatal-event-before-commit');
  if (mode === 'disconnect-before-next-insert') {
    const nextWrite = await send({type:'query',sql:'INSERT INTO repro (value) VALUES (?)',params:['second']});
    assert.equal(nextWrite.ok,false); assert.equal(connections.length,1); assert.deepEqual(committed,[]);
    return {mode,expected:'in-transaction operation fails instead of reconnecting',nextWriteOk:nextWrite.ok,connections:connections.length,committedRows:committed.length,events};
  }
  const commit = await send({type:'query',sql:'COMMIT'});
  assert.equal(commit.ok,true);
  assert.equal(connections.length,mode === 'healthy'?1:2);
  assert.equal(committed.length,mode === 'healthy'?1:0);
  return {mode,commitReply:commit,connections:connections.length,committedRows:committed.length,
    outcome:mode === 'healthy'?'control: row persisted':'BUG CONFIRMED IN VM: success reply despite rolled-back original transaction',events};
}
(async()=>{
  const results=[];
  for(const mode of ['healthy','fatal-event-before-commit','closed-state-before-commit','disconnect-before-next-insert']) results.push(await scenario(mode));
  console.log(JSON.stringify({sourceCommit:'4f60b7a9bdc5015323308a21a30dfa76e408c0c8',sourceBlob:blob,sourceUnmodified:true,noNetwork:true,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
