'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const text = (value) => ({ nodeType:3, nodeValue:value });
const br = () => ({ nodeType:1, tagName:'BR' });
function root(nodes, blocked=false) {
 return { childNodes:nodes, ownerDocument:{createTextNode:text}, closest:() => blocked ? {} : null,
   get textContent() { return this.childNodes.map(n => n.nodeType===3 ? n.nodeValue : '').join(''); },
   querySelectorAll() { return []; },
   replaceChild(next,old) { this.childNodes[this.childNodes.indexOf(old)] = next; },
   normalize() { this.childNodes=this.childNodes.reduce((a,n)=>{ if(n.nodeType===3 && a.length && a[a.length-1].nodeType===3) a[a.length-1].nodeValue+=n.nodeValue; else a.push(n); return a; },[]); },
 };
}
const context = { window:{}, MathJax:{typesetPromise:() => Promise.resolve()}, setInterval, clearInterval };
vm.runInNewContext(fs.readFileSync('public/js/mathlib.js','utf8'),context);
const candidate=root([text('普通'),br(),text('$$a=\\begin{cases}1,&x>0\\\\'),br(),text('2,&x<0\\end{cases}$$'),br(),text('结尾')]);
context.window.mtxTypeset(candidate);
assert.equal(candidate.childNodes.filter(n=>n.nodeType===1).length,2,'公式内换行合并，普通换行应保留');
assert(candidate.textContent.includes('\\\\\n2'), '块公式应保留公式内部换行');
const unmatched=root([text('普通'),br(),text('$$未闭合'),br(),text('后文')]);
context.window.mtxTypeset(unmatched);
assert.equal(unmatched.childNodes.filter(n=>n.nodeType===1).length,2,'不完整公式不改变原有换行');
const excluded=root([text('$$a'),br(),text('b$$')],true);
context.window.mtxTypeset(excluded);
assert.equal(excluded.childNodes.filter(n=>n.nodeType===1).length,1,'代码或编辑区不得改变');
for (const path of ['public/index.html','public/admin/index.html']) {
 const html=fs.readFileSync(path,'utf8');
 assert(html.includes("['$$', '$$']") && !html.includes("['$$', '$$$']"), path + ' 块公式定界符必须配对');
}
assert(!fs.readFileSync('public/js/bank.js','utf8').includes('<pre class="qz-mat-b">'), '共同材料不应放在 MathJax 跳过的 pre 中');
console.log('块公式换行、普通换行和共同材料渲染配置验证通过');
