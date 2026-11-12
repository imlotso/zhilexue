'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {ZipReader}=require('./src/mfzip');

test('skill download works when customer data is separate from application files',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zlx-skill-release-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const src=path.join(dir,'src'), data=path.join(dir,'customer-data');fs.mkdirSync(src);fs.mkdirSync(data);fs.symlinkSync(data,path.join(dir,'data'));
  const asset=path.join(__dirname,'src','assets');if(fs.existsSync(asset))fs.cpSync(asset,path.join(src,'assets'),{recursive:true});
  const source=fs.readFileSync(path.join(__dirname,'src','mfbank.js'),'utf8');
  const begin=source.indexOf('const SKILL_ZIP ='),end=source.indexOf('const MF_TYPE_MAP =',begin);assert.ok(begin>=0&&end>begin);
  let handler;const context={__dirname:src,path,require,admin:{get:(route,fn)=>{assert.equal(route,'/import-skill');handler=fn}},fail:(res,msg)=>{res.error=msg}};
  vm.runInNewContext(source.slice(begin,end),context);
  const res={headers:{},setHeader(k,v){this.headers[k]=v},send(value){this.body=value}};handler({},res);
  assert.ifError(res.error);assert.equal(res.headers['Content-Type'],'application/zip');assert.ok(Buffer.isBuffer(res.body));
  const zip=new ZipReader(res.body);assert.ok(zip.list().includes('mofang-question-transcribe/SKILL.md'));assert.ok(zip.list().includes('mofang-question-transcribe/references/zhilexue.md'));
  assert.deepEqual(fs.readdirSync(data),[],'no customer data writes');
});
test('skill build creates the packaged archive without writing customer data',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zlx-skill-build-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'data'));fs.mkdirSync(path.join(dir,'src','assets'),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'scripts/build-zhilexue-skill.py'),path.join(dir,'scripts/build-zhilexue-skill.py'));
  fs.copyFileSync(path.join(__dirname,'data/mofang-question-transcribe.zip'),path.join(dir,'data/mofang-question-transcribe.zip'));
  fs.cpSync(path.join(__dirname,'data/zhilexue-transcribe'),path.join(dir,'data/zhilexue-transcribe'),{recursive:true});
  require('node:child_process').execFileSync('python3',[path.join(dir,'scripts/build-zhilexue-skill.py')]);
  const generated=new ZipReader(fs.readFileSync(path.join(dir,'src/assets/zhilexue-question-transcribe.zip')));
  const committed=new ZipReader(fs.readFileSync(path.join(__dirname,'src/assets/zhilexue-question-transcribe.zip')));
  assert.deepEqual(generated.list().slice().sort(),committed.list().slice().sort());
  for(const name of generated.list())assert.deepEqual(generated.read(name),committed.read(name),name);
  assert.equal(fs.existsSync(path.join(dir,'data/zhilexue-question-transcribe.zip')),false);
});
