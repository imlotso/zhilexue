'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'public/admin/bankui.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, 'public/js/api.js'), 'utf8');
function open(questions, edit = false) {
  const nodes = {}, calls = {typeset: 0, zoom: 0}, image={dataset:{zoom:'/zoom.png'}}; let config, printed;
  const box = {SUBJECTS:['数学'], window:{mtxTypeset:true},
    esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    modal:c=>{config=c;}, mtxTypeset:()=>calls.typeset++, mfImgView:()=>calls.zoom++};
  vm.runInNewContext(api.slice(api.indexOf('function optText('),api.indexOf('/** 展示用文本')),box);
  vm.runInNewContext(source,box);
  box.bkPrintWindow=(title, html)=>{printed=html;};
  const paper={id:7,title:'试卷',subject:'数学',questions,total_score:100,duration:45};
  box[edit ? 'bkPaperEdit' : 'bkPaperPreview'](paper);
  const node=()=>({innerHTML:'',value:'',querySelectorAll:s=>s==='[data-zoom]'?[image]:[]});
  const w={querySelector:s=>nodes[s]||(nodes[s]=node()),querySelectorAll:()=>[]};
  nodes['#ppPrevBody']={...node(),innerHTML:config.body.split('<div id="ppPrevBody">')[1]?.slice(0,-6)||''};
  config.onMount(w);
  return {nodes,calls,image,html:()=>edit ? nodes['#peList'].innerHTML : nodes['#ppPrevBody'].innerHTML,
    toggle:()=>nodes['#ppAnsToggle'].onclick({target:{}}), print:()=>{nodes['#ppPrint'].onclick();return printed;}};
}
const q=(extra={})=>({id:1,type:'single',stem:'题干',options:['甲','乙'],answer:'秘密答案',analysis:'秘密解析',images:[],...extra});
test('paper preview renders material, stem and option images at their positions',()=>{
  const h=open([q({material:'材料[图1]',stem:'题干[图2]',options:[{text:'选项[图3]'}],images:['/m.png','/q.png','/o.png']})]).html();
  for(const [label,file] of [['材料','m'],['题干','q'],['选项','o']]) assert.match(h,new RegExp(label+'<img[^>]+src="/'+file+'\\.png"'));
});
test('paper preview includes sort candidates and matching prompts',()=>{
  const h=open([q({type:'sort',options:['词块一','词块二'],match_prompts:['提示[图1]'],images:['/prompt.png']})]).html();
  assert.match(h,/词块一/);assert.match(h,/词块二/);assert.match(h,/提示<img/);
});
test('hidden-answer preview never shows solution-only figures',()=>{
  const h=open([q({stem:'[图1]',answer:'秘密[图2]',analysis:'秘密[图3]',images:['/question.png','/answer.png','/analysis.png']})]).html();
  assert.match(h,/question\.png/);assert.doesNotMatch(h,/秘密|answer\.png|analysis\.png/);
});
test('answer toggle reveals and then hides answer and analysis figures',()=>{
  const p=open([q({answer:'答案[图1]',analysis:'过程\n[图2]',images:['/answer.png','/analysis.png']})]);
  p.toggle();assert.match(p.html(),/答案<img/);assert.match(p.html(),/过程<br><img/);
  p.toggle();assert.doesNotMatch(p.html(),/answer\.png|analysis\.png|过程/);
});
test('print follows the current answer-visibility selection',()=>{
  const p=open([q()]);assert.doesNotMatch(p.print(),/秘密/);
  p.toggle();assert.match(p.print(),/秘密答案/);p.toggle();assert.doesNotMatch(p.print(),/秘密/);
});
test('paper editor includes full question content instead of truncated stem',()=>{
  const h=open([q({material:'编辑材料',stem:'长'.repeat(70)+'末尾[图1]',images:['/edit.png']})],true).html();
  assert.match(h,/编辑材料/);assert.match(h,/末尾<img/);assert.match(h,/秘密解析/);
});
test('rich paper content escapes HTML and retains formula delimiters and newlines',()=>{
  const h=open([q({material:'<script>x</script> \\(x^2\\)\n下一行'})]).html();
  assert.match(h,/&lt;script&gt;/);assert.match(h,/\\\(x\^2\\\)/);assert.match(h,/<br>下一行/);assert.doesNotMatch(h,/<script>/);
});
test('unreferenced legacy question images remain visible, missing placeholders remain readable',()=>{
  assert.match(open([q({images:['/legacy.png']})]).html(),/src="\/legacy.png"/);
  const h=open([q({stem:'缺图[图9]',images:[]})]).html();assert.match(h,/\[图9\]/);assert.doesNotMatch(h,/src="undefined"/);
});
test('shared question-and-answer image remains visible with answers hidden',()=>{
  const h=open([q({stem:'[图1]',answer:'答案[图1]',images:['/shared.png']})]).html();
  assert.match(h,/shared\.png/);assert.doesNotMatch(h,/答案/);
});
test('preview and editor image buttons open the existing image viewer',()=>{
  for(const edit of [false,true]) { const p=open([q({images:['/zoom.png']})],edit);assert.equal(typeof p.image.onclick,'function');p.image.onclick();assert.equal(p.calls.zoom,1); }
});
test('print waits for formula rendering and reports image failures instead of silently printing',async()=>{
  let written='';const box={URL,document:{baseURI:'https://example.test/admin/'},esc:v=>String(v??'')};
  box.window={open:()=>({document:{write:s=>{written=s;},close(){}}})};
  vm.runInNewContext(source,box);box.bkPrintWindow('试卷','<div>\\(x^2\\)</div><img src="/q.png" loading="lazy">');
  assert.match(written,/mathjax-tex-svg\.js/);assert.doesNotMatch(written,/loading="lazy"/);
  const scripts=[...written.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  let release,prints=0;const notice={textContent:''};
  const popup={window:{print:()=>prints++,mtxPrepareFormulaBreaks:()=>{}},document:{body:{},images:[{decode:()=>Promise.reject(new Error('bad image'))}],getElementById:()=>notice},MathJax:{startup:{promise:new Promise(r=>release=r)},typesetPromise:async()=>{}}};
  popup.window.MathJax=popup.MathJax;vm.runInNewContext(scripts[scripts.length-1],popup);
  const ready=popup.window.onload();await Promise.resolve();assert.equal(prints,0);assert.equal(notice.textContent,'');release();await ready;
  assert.equal(prints,0);assert.match(notice.textContent,/图片|公式/);
});
test('printing prepares multiline formulas before typesetting and only then prints',async()=>{
  let written='';const box={URL,document:{baseURI:'https://example.test/admin/'},esc:v=>String(v??'')};
  box.window={open:()=>({document:{write:s=>{written=s;},close(){}}})};
  vm.runInNewContext(source,box);box.bkPrintWindow('试卷','\\[x<br>+1\\]');
  const scripts=[...written.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const body={childNodes:[{nodeType:3,nodeValue:'\\[x'},{nodeType:1,tagName:'BR'},{nodeType:3,nodeValue:'+1\\]'}],querySelectorAll:()=>[],ownerDocument:{createTextNode:value=>({nodeType:3,nodeValue:value})},replaceChild(next,old){this.childNodes[this.childNodes.indexOf(old)]=next;},normalize(){}};
  const sequence=[];const popup={window:{print:()=>sequence.push('print')},document:{body,images:[],getElementById:()=>({})},MathJax:{startup:{promise:Promise.resolve()},typesetPromise:async()=>{assert.equal(body.childNodes.filter(n=>n.nodeType===1).length,0);assert.equal(body.childNodes.map(n=>n.nodeValue).join(''),'\\[x\n+1\\]');sequence.push('typeset');}}};
  popup.window.MathJax=popup.MathJax;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/js/mathlib.js'),'utf8'),popup);
  vm.runInNewContext(scripts[scripts.length-1],popup);await popup.window.onload();
  assert.deepEqual(sequence,['typeset','print']);
});
