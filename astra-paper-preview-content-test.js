'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'public/js/bank.js'),'utf8');
async function preview(questions){
  const nodes={}; let mask, opened, typeset=0, zoom=0;
  const box={window:{mtxTypeset:true},esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    api:async()=>({id:7,title:'试卷',questions,total_score:100}),toast:()=>{},
    document:{createElement:()=>({querySelectorAll:()=>{zoom++;return [];},querySelector:s=>nodes[s]||(nodes[s]={}),remove(){this.removed=true;}}),body:{appendChild:m=>{mask=m;}}},
    bindImageZoom:()=>zoom++,mtxTypeset:()=>typeset++};
  const apiSource=fs.readFileSync(path.join(__dirname,'public/js/api.js'),'utf8');
  vm.runInNewContext(apiSource.slice(apiSource.indexOf('function optText('),apiSource.indexOf('/** 展示用文本')),box);
  vm.runInNewContext(source,box); box.window.BankQuiz.open=o=>{opened=o;};
  await box.window.BankPages.openLibPaper(7);
  return {html:mask?.innerHTML||'',nodes,mask,opened:()=>opened,typeset,zoom};
}
const q=(extra={})=>({id:1,type:'single',stem:'题干',options:['甲','乙'],images:[],...extra});
test('preview displays reading material and preserves line breaks',async()=>{assert.match((await preview([q({material:'原文第一行\n第二行'})])).html,/原文第一行<br>第二行/);});
test('preview displays string options with letters',async()=>{const {html}=await preview([q()]);assert.match(html,/A/);assert.match(html,/甲/);assert.match(html,/乙/);});
test('preview displays object options',async()=>{assert.match((await preview([q({options:[{text:'对象选项'}]})])).html,/对象选项/);});
test('preview displays matching prompts',async()=>{assert.match((await preview([q({type:'match',match_prompts:['左侧提示']})])).html,/左侧提示/);});
test('preview renders option image that stem renderer excludes',async()=>{assert.match((await preview([q({options:['[图1]'],images:['/bank/option.png']})])).html,/<img[^>]+src="\/bank\/option.png"/);});
test('preview renders material and prompt images',async()=>{const {html}=await preview([q({material:'[图1]',match_prompts:['[图2]'],images:['/bank/material.png','/bank/prompt.png']})]);assert.match(html,/src="\/bank\/material.png"/);assert.match(html,/src="\/bank\/prompt.png"/);});
test('preview escapes imported text while keeping latex',async()=>{const {html}=await preview([q({material:'<script>bad</script> \\(x^2\\)',options:['<img onerror=bad>']})]);assert.match(html,/&lt;script&gt;/);assert.match(html,/\\\(x\^2\\\)/);assert.doesNotMatch(html,/<script>|<img onerror/);});
test('preview never renders answers or analysis',async()=>{assert.doesNotMatch((await preview([q({answer:'SECRET_ANSWER',analysis:'SECRET_ANALYSIS',solution_images:['/SECRET.png']})])).html,/SECRET/);});
test('preview retains five question limit and starts complete original paper',async()=>{const qs=Array.from({length:6},(_,i)=>q({id:i+1,stem:'题目'+i}));const p=await preview(qs);assert.doesNotMatch(p.html,/题目5/);p.nodes['#pkPreviewStart'].onclick();assert.equal(p.opened().questions,qs);assert.equal(p.mask.removed,true);assert.equal(p.typeset,1);assert.equal(p.zoom,1);});
test('preview empty options and missing optional fields remain usable',async()=>{const p=await preview([{id:1,stem:'简答',type:'answer'}]);assert.match(p.html,/简答/);p.nodes['#pkPreviewClose'].onclick();assert.equal(p.mask.removed,true);});
