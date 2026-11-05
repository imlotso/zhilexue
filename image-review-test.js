'use strict';
const assert = require('assert');
const I = require('./src/image-review');
// 图号可能出现在材料、选项和连线左项；仅有其他图片不能冒充缺图。
const card = { stem:'题干 [图3]', material:'材料 [图1]', options:[{label:'A',content:'选项 [图2]'}], match_prompts:['左项 [图4]'], figures:[{url:'/a'},null,{url:'/c'}], figure_review_required:true, page:1, source_pages:[1,2] };
assert.deepStrictEqual(I.missing(card), [2,4]);
assert.match(I.issue(card), /图2/);
card.figures[1]={url:'/b'}; card.figures[3]={url:'/d'};
assert.deepStrictEqual(I.missing(card), []);
assert.match(I.issue(card), /尚未核对/);
card.figure_review_signature=I.signature(card); assert.strictEqual(I.issue(card),'');
card.options[0].content='更新后的选项 [图2]'; assert.match(I.issue(card), /尚未核对/);
card.figure_review_signature=I.signature(card); card.figures[0].url='/changed'; assert.match(I.issue(card), /尚未核对/);
// 稀疏图号压紧时占位符、材料、选项和匹配项同时重映射。
const sparse={stem:'[图3]',material:'[图3]',options:[{content:'[图3]'}],match_prompts:['[图3]'],figures:[null,null,{url:'/c'}]};
I.compact(sparse); assert.deepStrictEqual(sparse.figures,[{url:'/c'}]);
assert.strictEqual(sparse.stem,'[图1]'); assert.strictEqual(sparse.material,'[图1]');
assert.strictEqual(sparse.options[0].content,'[图1]'); assert.strictEqual(sparse.match_prompts[0],'[图1]');
assert.deepStrictEqual(I.missing({stem:'ok',options:[{text:'[图2]'}],images:['/one']}),[2]);
assert.deepStrictEqual(I.missing({stem:'[图0] [图31]',figures:[]}),[0,31]);
// 正式答案和 HTML 题干的图也必须补齐；未采纳的 AI 建议不属于正式内容。
assert.deepStrictEqual(I.missing({stem:'题',answer:'答案 [图2]',figures:[{url:'/one'}]}),[2]);
assert.deepStrictEqual(I.missing({stem:'题',stem_html:'<p>[图2]</p>',figures:[{url:'/one'}]}),[2]);
assert.deepStrictEqual(I.missing({stem:'题',stemHtml:'<p>[图2]</p>',figures:[{url:'/one'}]}),[2]);
assert.deepStrictEqual(I.missing({stem:'题',ai_answer_suggestion:{answer:'[图2]',analysis:'[表N]'},figures:[]}),[]);
const answerCard={stem:'[图3]',stem_html:'<p>[图3]</p>',answer:'答案 [图3]',analysis:'解析 [图3]',figures:[null,null,{url:'/c'}],figure_review_required:true};
answerCard.figure_review_signature=I.signature(answerCard);
answerCard.answer='变更答案 [图3]'; assert.match(I.issue(answerCard),/尚未核对/);
answerCard.figure_review_signature=I.signature(answerCard);
answerCard.stem_html='<div>[图3]</div>'; assert.match(I.issue(answerCard),/尚未核对/);
I.compact(answerCard);
assert.strictEqual(answerCard.stem,'[图1]'); assert.strictEqual(answerCard.stem_html,'<div>[图1]</div>');
assert.strictEqual(answerCard.answer,'变更答案 [图1]'); assert.strictEqual(answerCard.analysis,'解析 [图1]');
const nested={_q:{stem:'题',stemHtml:'[图3]',answer:'[图3]',match_prompts:['[图3]'],images:[null,null,'/c']}};
I.compact(nested); assert.strictEqual(nested._q.stemHtml,'[图1]'); assert.strictEqual(nested._q.answer,'[图1]'); assert.deepStrictEqual(nested._q.match_prompts,['[图1]']);
for (const marker of ['[图]', '[图N]', '[图n]', '[图 1]', '[图 A]', '[图A]', '[图片]', '[图片2]', '[表]', '[表N]', '[表1]', '[表：描述]', '【表3】', '[表格]', '【表：' + '甲'.repeat(2001) + '】', '[图表A]', '[示意图：装置]', '【图】', '【图3】', '[图：数轴，标有 A(-4), M, O(0), N, B(3)]', '【图：'+ '甲'.repeat(2001) +'】']) {
  const c={stem:`原卷插图 ${marker}`,figures:[{url:'/wrong.png'}]};
  assert.deepStrictEqual(I.missing(c),['未编号'], `${marker} 不能凭其他图片通过校验`);
  assert.match(I.issue(c),/未编号/);
}
assert.deepStrictEqual(I.missing({stem:'题干', material:'[表1]', options:[{content:'[表N]'}], figures:[{url:'/x'}]}), ['未编号']);
assert.deepStrictEqual(I.missing({stem:'图书、画图及【图书】均是普通文字，[表达式] 与【表面现象】也是普通文字\n[图\n这是另一行]',figures:[]}), []);
// 普通选择题和共同材料中的图片不得被重复堆到题干末尾。
const vm = require('vm'), fs = require('fs');
const ctx={window:{},esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),optText:o=>typeof o==='string'?o:o.text};
vm.runInNewContext(fs.readFileSync(require.resolve('./public/js/bank.js'),'utf8')+'\n;globalThis.renderImageText=quizMatchContent;globalThis.stemImages=stemImagesHTML;globalThis.solutionText=quizSolutionContent;',ctx);
const displayed={type:'single',stem:'题干',material:'阅读 [图1]',options:[{text:'选项 [图2]'}],images:['/a.png','/b.png']};
assert.strictEqual(ctx.stemImages(displayed).rest,'');
assert.match(ctx.renderImageText(displayed,displayed.options[0].text),/src="\/b\.png"/);
assert.match(ctx.renderImageText(displayed,displayed.material),/src="\/a\.png"/);
const hidden={stem:'题面 [图2]',images:['','/question.png']};
assert(!ctx.stemImages(hidden).rest.includes('src=""'));
assert.match(ctx.solutionText(hidden,'答案 [图1]',['/solution.png','']),/src="\/solution\.png"/);
console.log('题图缺失检查、签名失效、跨字段图号压紧通过');
