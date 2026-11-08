'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/admin/admin.js','utf8');
function dashboard(role='admin',answers=0){
 const calls=[];const data={active:3,answers,correct:2,completed:4};
 const ctx={Auth:{user:{role}},ADM:{page:{}},api:async(url)=>{calls.push(url);return url.includes('badge-counts')?{pending:7}:{today:data,week:data,due:2,feedback:1,expiring:0,trend:[{date:'2026-11-01',answers:0}]};},ic:n=>`<i class="ai ai-${n}"></i>`,esc:v=>String(v)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function viewDash()'),source.indexOf('// ------------------------------------------------------------ 学生管理')),ctx);return {ctx,calls};
}
test('dashboard uses approved rounded hero and preserves real task navigation',async()=>{const {ctx}=dashboard();const out=await ctx.viewDash();assert.match(out.html,/rounded-dash-hero/);assert.match(out.html,/教学工作台/);for(const route of ['pending','intake','paper','videos','xreport','ktree'])assert.match(out.html,new RegExp('data-go="'+route+'"'));assert.match(out.html,/待审核题目/);assert.match(out.html,/7/);assert.doesNotMatch(out.html,/设计示意|示例成绩|七年级/);});
test('dashboard does not turn missing grades into zero accuracy or fetch global counts for branches',async()=>{const {ctx,calls}=dashboard('branch');const out=await ctx.viewDash();assert.match(out.html,/答题正确率/);assert.match(out.html,/—/);assert.equal(calls.length,1);assert.doesNotMatch(out.html,/待审核题目<\/span><b>7/);});
test('all admin routes use common rounded theme and original account controls',()=>{assert.match(source,/ui-rounded-shell/);for(const id of ['btnPwd','btnStu','btnOut','btnFold'])assert.match(source,new RegExp('id="'+id+'"'));const html=fs.readFileSync('public/admin/index.html','utf8');assert.match(html,/ui-rounded-shell-20261108.css/);});
