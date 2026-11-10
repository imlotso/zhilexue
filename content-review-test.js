'use strict';
const assert = require('assert');
const review = require('./src/content-review');
const run = { subject:'数学', stage:'junior', grade:'七年级' };
const original = { content_review_required:true, stem:'对照原页的题干', material:'共同材料', questionType:'单选', options:[{label:'A',content:'甲'},{label:'B',content:'乙'}], figures:[{url:'/题图1'}], page:2, source_pages:[1,2], group_ref:'g1', group_position:1 };
assert(review.pending(original, run), '未经老师确认应待核对');
const current = {...original, content_review_signature:review.signature(original,run)};
assert(!review.pending(current,run), '当前题目经老师确认后应解除待核对');
for(const [field,value] of Object.entries({stem:'改题干',material:'改材料',questionType:'多选',options:[{label:'A',content:'改选项'}],figures:[{url:'/新题图'}],source_pages:[1,3],group_ref:'其他组',group_position:2})) {
 assert(review.pending({...current,[field]:value},run),`${field}变化后确认应失效`);
}
assert(review.pending(current,{...run,stage:'primary'}),'批次学段变化后确认应失效');
const packed={content_review_required:true, material:'原材料', _q:{stem:'技能包',material:'原材料',type:'single',options:[{label:'A',text:'甲'}]}};
packed.content_review_signature=review.signature(packed,run);
assert(review.pending({...packed,material:''},run),'显式清空共同材料必须使确认失效');
assert(review.pending({...packed,_q:{...packed._q,type:'multi'}},run),'技能包实际题型变更必须使确认失效');
assert(!review.pending({stem:'人工题'},run),'不需要识别核对的人工题保持兼容');
const pendingUI = require('fs').readFileSync('public/admin/pendingui.js', 'utf8');
assert(pendingUI.includes('AI 提示（可能包含推断，请对照原页核对）'), '识别风险提示须明确标为可能含推断的 AI 内容');
console.log('识别内容确认与编辑、来源页及范围变更失效验证通过');
