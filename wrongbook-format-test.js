'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {buildMistakeDocx}=require('./src/mistake-docx');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lP1sAAAAASUVORK5CYII=';
const item={type:'answer',updated_at:'2026-10-30',stem:'正方形池塘边长24米，绕5圈。',answer:'480',analysis:'求周长：24+24+24+24=96（米）\n跑5圈：96×5=480（米）\n所以是480米。',images:[],options:[],records:[]};
const build=async(q=item,includeAnswers=true)=>JSZip.loadAsync(await buildMistakeDocx({student:{name:'虚构格式测试'},subject:'数学',items:[q],includeAnswers,generatedAt:'2026-11-16'}));
test('multiline Chinese explanation has explicit left alignment independent of Word/WPS defaults',async()=>{
 const z=await build(),xml=await z.file('word/document.xml').async('string');
 const p=xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g).find(p=>p.includes('求周长'));
 assert.ok(p.includes('<w:jc w:val="left"/>'),'explanation must not inherit justified/distributed alignment');
 assert.ok(p.includes('<w:br/>'),'intentional line breaks must remain');
 assert.ok(xml.includes('96×5=480'),'arithmetic must be unchanged');
});
test('soft-return lines are not expanded by Word compatibility layout',async()=>{
 const z=await build(),xml=await z.file('word/settings.xml').async('string');
 assert.match(xml,/<w:doNotExpandShiftReturn\b/);
});
test('seventh analysis image remains embedded in analysis and formulas remain editable',async()=>{
 const q={...item,analysis:'如下图[图7]结果为\\(\\frac{1}{2}\\)。',images:[null,null,null,null,null,null,pixel]};
 const z=await build(q),xml=await z.file('word/document.xml').async('string');
 assert.ok(!xml.includes('[图7]'));
 assert.ok(xml.indexOf('<w:drawing>')>xml.indexOf('错题解析'));
 assert.match(xml,/<m:f>/);
 const student=await build(q,false),sx=await student.file('word/document.xml').async('string');
 assert.ok(!sx.includes('<w:drawing>'),'solution image must not leak into exercise-only export');
});