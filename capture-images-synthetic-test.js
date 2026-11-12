'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {storeImages}=require('./src/capture-images');
test('image transfer failures remain visible for review while valid images use stable keys',async()=>{
 const store={async saveFile(buf,name,folder){assert.equal(folder,'bank/img');assert.equal(buf.toString(),'synthetic');return {key:'bank/img/261112/0123456789abcdef.png'}}};
 const fetcher=async url=>{if(url.endsWith('/missing.png'))throw Error('合成下载失败');return {buf:Buffer.from('synthetic'),ext:'png'}};
 const result=await storeImages([{images:['https://example.invalid/ok.png','https://example.invalid/missing.png']}],store,'bank',fetcher);
 assert.equal(result.failed,1);assert.equal(result.questions[0].images[0],'/api/file?key=bank%2Fimg%2F261112%2F0123456789abcdef.png');
 assert.equal(result.questions[0].images[1],'https://example.invalid/missing.png');
 assert.deepEqual(result.questions[0]._image_errors,[{index:1,message:'合成下载失败'}]);
});
