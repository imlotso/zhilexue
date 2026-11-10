'use strict';
const { test }=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), vm=require('node:vm');
function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'audit-storage-')); t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'uploads'); fs.mkdirSync(root); const outside=path.join(base,'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside,'keep.txt'),'synthetic target'); fs.mkdirSync(path.join(root,'report'));
  fs.writeFileSync(path.join(root,'report','own.jpg'),'synthetic image'); fs.symlinkSync(outside,path.join(root,'linked'),'dir');
  const module={exports:{}}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'src/storage.js'),'utf8'),{module,process:{env:{STORAGE_DRIVER:'local'}},console,Buffer,URL,URLSearchParams,
    require:n=>n==='./db'?{UPLOAD_DIR:root}:n==='./builtin-config'?{}:require(n)});
  return {root,outside,store:module.exports};
}
for (const key of ['../outside/keep.txt','report/../../outside/keep.txt','/outside/keep.txt','report//own.jpg','report/./own.jpg','report\\own.jpg','report/%2e%2e/keep.txt','report/x.jpg?x=1']) test('rejects noncanonical deletion key '+key,async t=>{
  const f=fixture(t); await assert.rejects(f.store.deleteFile(key),e=>e.code==='INVALID_STORAGE_KEY');
  assert.equal(fs.readFileSync(path.join(f.outside,'keep.txt'),'utf8'),'synthetic target');
});
test('rejects descendant symlink without deleting target',async t=>{
  const f=fixture(t); await assert.rejects(f.store.deleteFile('linked/keep.txt'),e=>e.code==='UNSAFE_STORAGE_PATH');
  assert.equal(fs.readFileSync(path.join(f.outside,'keep.txt'),'utf8'),'synthetic target');
});
test('preflight rejects malformed and symlink keys before caller removes metadata',t=>{
  const f=fixture(t); assert.throws(()=>f.store.assertDeleteAllowed('../outside/keep.txt')); assert.throws(()=>f.store.assertDeleteAllowed('linked/keep.txt'));
});
test('normal local deletion and already-missing deletion remain supported',async t=>{
  const f=fixture(t); await f.store.deleteFile('report/own.jpg'); assert.equal(fs.existsSync(path.join(f.root,'report','own.jpg')),false);
  await f.store.deleteFile('report/missing.jpg');
});
