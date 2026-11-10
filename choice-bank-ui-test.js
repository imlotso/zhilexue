'use strict';
// 合成后台表单：无答案可留空，同时保留有效选项和有答案时的校验。
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const sandbox={console,api:async()=>[],qcBindDifficultyInputs:()=>{},optText:x=>typeof x==='string'?x:(x&&x.text)||'',esc:x=>String(x==null?'':x),toast:()=>{}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'public/admin/bankui.js'),'utf8'),sandbox);
function form(type,answer='',checked=[],options=['甲','乙']){
 const values={'#qf-type':type,'#qf-stem':'合成题干','#qf-difficulty10':'','#qf-difficulty':'3','#qf-ans':answer,'#qf-stage':'junior','#qf-subject':'数学','#qf-grade':'七年级','#qf-point':'','#qf-material':'','#qf-analysis':'','#qf-source':'','#qf-year':'','#qf-video':''};
 return {querySelector:key=>Object.prototype.hasOwnProperty.call(values,key)?{value:values[key]}:null,querySelectorAll:key=>key==='.bk-opt-in'?options.map((value,i)=>({value,dataset:{i:String(i)}})):key==='input[name="qfAns"]:checked'?checked.map(value=>({value})):[]};
}
for(const type of ['single','multi','judge','fill','sort']){let error='';const result=sandbox.bkFormRead(form(type),s=>{error=s});assert(result,`${type} 空答案应允许：${error}`);assert.strictEqual(result.answer,'');}
let error='';assert.strictEqual(sandbox.bkFormRead(form('single','',[],['甲','  ']),s=>{error=s}),null);assert.match(error,/至少.*2/);
error='';assert.strictEqual(sandbox.bkFormRead(form('single','',['A','B']),s=>{error=s}),null);assert.match(error,/只能有一个/);
const correct=sandbox.bkFormRead(form('multi','',['A','B']),()=>{});assert.strictEqual(correct.answer,'A,B');
function mount(type,cur){
 const radio=[{checked:true}], typeBody={innerHTML:'',querySelectorAll:key=>key==='input[name="qfAns"]'?radio:[]},clear={};
 const controls={'#qfTypeBody':typeBody,'#qf-type':{value:type},'#qfClearAnswer':clear,'#qf-difficulty':{},'#qf-difficulty10':{value:''}};
 const w={querySelector:key=>controls[key]||null};sandbox.bkFormMount(w,cur);return {typeBody,radio,clear};
}
const judge=mount('judge',{type:'judge',answer:''});assert.match(judge.typeBody.innerHTML,/<option value="" selected>未填写/,'判断题必须默认无答案');
const legacyJudge=mount('judge',{type:'judge',answer:'对'});assert.match(legacyJudge.typeBody.innerHTML,/<option value="正确" selected>/,'旧判断答案仍需保留');
const unknownJudge=mount('judge',{type:'judge',answer:'待核实'});assert.match(unknownJudge.typeBody.innerHTML,/<option value="待核实" selected>/,'未知历史答案不能因编辑而静默清空');
const single=mount('single',{type:'single',answer:'A',options:['甲','乙']});assert.match(single.typeBody.innerHTML,/清除答案/);single.clear.onclick();assert.strictEqual(single.radio[0].checked,false,'应可清除已选答案');
const sort=mount('sort',{type:'sort',answer:'',options:['甲','乙']});assert.match(sort.typeBody.innerHTML,/无答案可留空/);
console.log('旧题库表单允许空答案、判断默认未填、清除答案及有答案时的校验通过');
