'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'public/admin/bankui.js'),'utf8');
function fixture(due_at='',fail=''){
 let dialog;const requests=[],errors=[];const paper={due_at};
 const box={Date,esc:v=>String(v??'').replace(/</g,'&lt;').replace(/"/g,'&quot;'),modal:o=>{dialog=o;},toast:m=>errors.push(m),render(){},
 api:async(url,options)=>{if(options?.method==='POST'){requests.push({url,body:options.body});return{};}if(fail&&url.endsWith(fail))throw new Error('读取失败');if(url.endsWith('students-options'))return[{id:1,name:'测试学生'}];if(url.endsWith('assignees'))return[{user_id:1}];if(url.endsWith('/7'))return paper;throw Error('unexpected '+url);}};
 vm.runInNewContext(source,box);
 return {requests,errors,get dialog(){return dialog;},open:()=>box.ppAssignDialog(7,'测试'),submit:async(value)=>{const initial=/id="asDue"[^>]*value="([^"]*)"/.exec(dialog.body)?.[1]||'';const w={querySelector:()=>({value:value===undefined?initial:value})};return dialog.onOk(w);}};
}
test('reassignment prefills existing deadline in local datetime input',async()=>{const f=fixture('2026-11-08T12:34:56.123Z');await f.open();assert.match(f.dialog.body,/id="asDue"[^>]*value="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d"/);});
test('clearing existing deadline sends explicit empty string',async()=>{const f=fixture('2026-11-08T12:00:00Z');await f.open();await f.submit('');assert.equal(f.requests[0].body.due_at,'');});
test('unchanged deadline is omitted to preserve exact stored timestamp',async()=>{const f=fixture('2026-11-08T12:34:56.123Z');await f.open();await f.submit();assert.equal(Object.hasOwn(f.requests[0].body,'due_at'),false);});
test('browser normalization of zero seconds does not overwrite untouched milliseconds',async()=>{const f=fixture('2026-11-08T12:34:00.123Z');await f.open();const initial=/id="asDue"[^>]*value="([^"]*)"/.exec(f.dialog.body)[1];await f.submit(initial.replace(/(T\d\d:\d\d):00$/,'$1'));assert.equal(Object.hasOwn(f.requests[0].body,'due_at'),false);});
test('edited deadline becomes valid ISO with existing selected students',async()=>{const f=fixture();await f.open();await f.submit('2026-11-09T10:30:00');assert.equal(f.requests[0].body.due_at,new Date('2026-11-09T10:30:00').toISOString());assert.deepEqual(Array.from(f.requests[0].body.user_ids),[1]);});
test('invalid edited deadline reports error without request',async()=>{const f=fixture();await f.open();assert.equal(await f.submit('bad-date'),false);assert.equal(f.requests.length,0);assert.match(f.errors.join(''),/截止/);});
for(const endpoint of ['assignees','students-options','/7'])test('failed read '+endpoint+' cannot open an overwrite dialog',async()=>{const f=fixture('',endpoint);await f.open();assert.equal(f.dialog,undefined);assert.equal(f.requests.length,0);assert.match(f.errors.join(''),/读取|加载/);});
test('no existing deadline and unchanged empty input does not invent change',async()=>{const f=fixture();await f.open();await f.submit('');assert.equal(Object.hasOwn(f.requests[0].body,'due_at'),false);});
test('invalid stored deadline does not masquerade as no deadline',async()=>{const f=fixture('broken');await f.open();assert.equal(f.dialog,undefined);assert.match(f.errors.join(''),/截止/);});
