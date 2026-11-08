'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
function context(extra={}) {
  const ctx={esc,ic:n=>'<i data-icon="'+n+'"></i>',URLSearchParams,location:{hash:'#/xreport?tab=e'},
    Auth:{user:{role:'branch'}},ADM:{page:{},chapters:[]},window:{},document:{removeEventListener(){}},history:{replaceState(){}},
    viewMistakeLog:()=>({html:""}),expTag:()=>"",api:async()=>({list:[]}),MF_TYPES:[['single','单选题']],QB:{count:()=>0,list:()=>[]},...extra};
  vm.createContext(ctx);return ctx;
}
test('rounded composition presents real tree, results, and a persistent basket workspace', async()=>{
  const c=context();vm.runInContext(read('public/admin/r6-compose.js'),c);
  const view=await c.viewPaperR6();
  assert.match(view.html,/r6-rounded-page/);
  assert.match(view.html,/r6-basket-panel/);
  for(const id of ['r6-tree','r6-results','r6-basket','r6-year','r6-region','r6-unused','r6-kw','r6-search','r6-clear']) assert.match(view.html,new RegExp('id="'+id+'"'));
  for(const tab of ['textbook','knowledge','classic','existing']) assert.match(view.html,new RegExp('data-r6tab="'+tab+'"'));
});
test('basket preview shows actual quantity and score without creating a saved paper',()=>{
  const c=context({QB:{list:()=>[{id:14,type:'single',score:3},{id:19,type:'single',score:5}],count:()=>2}});
  vm.runInContext(read('public/admin/r6-compose.js'),c);
  assert.equal(typeof c.r6BasketPreviewHTML,'function');
  const html=c.r6BasketPreviewHTML();
  assert.match(html,/2 题/);assert.match(html,/8 分/);assert.match(html,/14/);assert.match(html,/19/);
  assert.doesNotMatch(html,/已保存|已下发|示例|设计示意/);
});
test('intake center preserves every import method alongside prominent Word entry',async()=>{
  const c=context();vm.runInContext(read('public/admin/intake-center.js'),c);
  const view=await c.viewIntakeCenter();
  assert.match(view.html,/r4-intake-feature/);
  for(const method of ['recognize','document','excel','skill','capture','phone','manual','word'])assert.match(view.html,new RegExp('data-intake="'+method+'"'));
  assert.match(view.html,/暂无导入记录/);
  assert.doesNotMatch(view.html,/设计示意|非真实学情|示例学生/);
});
test('report keeps real query controls and separates absent data from zero accuracy',async()=>{
  const c=context();vm.runInContext(read('public/admin/reportui.js'),c);
  const view=await c.viewXReport();
  assert.match(view.html,/r1-rounded-report/);
  assert.match(view.html,/暂未产生可统计的练习记录/);
  assert.doesNotMatch(view.html,/>0%</);
  for(const id of ['erKw','erSearch','erReset'])assert.match(view.html,new RegExp('id="'+id+'"'));
  for(const key of ['w','v','e','m'])assert.match(view.html,new RegExp('data-xrep="'+key+'"'));
});
test('report student cards retain server accuracy, including zero and ungraded differences',async()=>{
  const c=context({api:async()=>({list:[{id:1,name:'尚未练习',rate:null,answered:0,paper_avg:null,paper_best:null},{id:2,name:'零正确率',rate:0,answered:3,paper_avg:0,paper_best:0}]})});
  vm.runInContext(read('public/admin/reportui.js'),c);
  const view=await c.viewEReport();
  assert.match(view.html,/r1-student-cards/);
  assert.match(view.html,/暂无可统计的客观题或试卷记录/);
  assert.doesNotMatch(view.html,/尚无练习记录/);
  assert.match(view.html,/暂无可统计作答/);
  assert.match(view.html,/>0%</);
  assert.match(view.html,/data-edetail="1"/);assert.match(view.html,/data-edocx="2"/);
});
test('review queue retains source badges, pending validation, and distinct save/commit actions',async()=>{
  const c=context({api:async()=>({list:[{id:'r1',stem:'测试',type_name:'单选题',source:'word',source_label:'Word导入',options:[],tags:[],content_review_pending:true}],counts:{all:1},status_counts:{all:1},total:1,page:1,size:20}),pagerHTML:()=>'',optText:s=>s,optLabel:()=>'A'});
  vm.runInContext(read('public/admin/pendingui.js'),c);
  const view=await c.viewPending();
  assert.match(view.html,/pd-row-source/);
  assert.match(view.html,/data-act="save-classification"/);assert.match(view.html,/id="pd-current-commit"/);
  assert.equal(c.pdReviewBlocker({content_review_pending:true}),'请先对照原页核对内容');
});
