'use strict';
// 学生作答前只返回题面明确引用或老师确认的题图。保持数组下标不变。
const crypto=require('crypto');
function arr(value) { if (Array.isArray(value)) return value; try { const a=JSON.parse(value || '[]'); return Array.isArray(a)?a:[]; } catch (_) { return []; } }
function obj(value) { if (value && typeof value === 'object' && !Array.isArray(value)) return value; try { const o=JSON.parse(value || '{}'); return o && typeof o==='object'&&!Array.isArray(o)?o:{}; } catch (_) { return {}; } }
function refs(values) { const set=new Set(); for(const v of values) for(const m of String(v || '').matchAll(/\[图(\d+)\]/g)) { const n=Number(m[1]); if(n>0 && n<=100) set.add(n); } return set; }
function textOf(v) { return v && typeof v==='object' ? (v.text != null ? v.text : v.content || '') : v; }
function groups(q) {
 const options=arr(q.options).map(textOf), prompts=arr(q.match_prompts), question=refs([q.stem,q.stem_html,q.material,...options,...prompts]);
 const solution=refs([q.answer,q.analysis]); return {question,solution};
}
function publicBasis(q) { return crypto.createHash('sha256').update(JSON.stringify([q.stem||'',q.stem_html||'',q.material||'',arr(q.options),arr(q.match_prompts),arr(q.images)])).digest('hex'); }
function studentImages(q) {
 const images=arr(q.images), g=groups(q), detail=obj(q.source_detail);
 const approved=new Set(detail.question_image_public_basis===publicBasis(q)?arr(detail.question_image_public).map(Number):[]);
 // 老题没有任何图号时无法判断各张图片用途，保持历史题图可见；禁止猜测其归属。
 const hasReview = Array.isArray(detail.question_image_public);
 if(!g.question.size && !g.solution.size && !hasReview) return images;
 return images.map((url,i)=>g.question.has(i+1)||(!g.solution.has(i+1)&&approved.has(i+1))?url:'');
}
function solutionImages(q) { const images=arr(q.images), g=groups(q); return images.map((url,i)=>g.solution.has(i+1)?url:''); }
// 审核人员确认图文时，未被答案/解析引用的附加图由其确认属于题面。
function confirmedQuestionImages(q) {
 const images=arr(q.images), g=groups(q); return images.map((u,i)=>u && (!g.solution.has(i+1)||g.question.has(i+1)) ? i+1 : 0).filter(Boolean);
}
module.exports={studentImages,solutionImages,confirmedQuestionImages,publicBasis};
