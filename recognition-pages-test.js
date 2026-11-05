'use strict';
const assert = require('assert');
const R = require('./src/recognition-pages');
const alias=R.normalizeQuestion({number:7,questionText:'原题',material_text:'共同材料',choices:[{letter:'A',text:'甲'},'B. 乙'],type:'multi',answer:'A'});
assert.equal(alias.qno,'7');assert.equal(alias.stemMarkdown,'原题');assert.equal(alias.materialMarkdown,'共同材料');assert.equal(alias.questionType,'多选');
assert.deepStrictEqual(alias.options,[{label:'A',content:'甲'},{label:'B',content:'乙'}]);assert.equal(alias.answerMarkdown,'A');
const aliasMap=R.normalizeQuestion({stem:'题目',options:{A:'甲',B:'乙'}});assert.deepStrictEqual(aliasMap.options,[{label:'A',content:'甲'},{label:'B',content:'乙'}]);
const badAliases=R.normalizeQuestion({stemMarkdown:'第一题面',stem:'第二题面',material:{unsafe:'不应转字符串'},options:[{label:'A',content:'甲'}],choices:[{label:'A',text:'乙'}]});
assert.equal(badAliases.stemMarkdown,'第一题面');assert.equal(badAliases.materialMarkdown,'');assert(badAliases.uncertainties.some(x=>x.includes('题干字段')));assert(badAliases.uncertainties.some(x=>x.includes('选项字段')));
const diagnostic=R.modelDiagnostics([{stem:'敏感题文',choices:[{text:'敏感选项'}],['敏感字段名称']:'敏感内容'}]);
assert.deepStrictEqual(diagnostic,[{fields:{stem:{type:'string',length:4},choices:{type:'array',length:1}},other_field_count:1}]);
assert(!JSON.stringify(diagnostic).includes('敏感'),'诊断中不得出现题文、选项或未知字段名');
const mk = (qno, page, fields={}) => ({ page, qno, questionType:'单选', stem:'题干'+qno, options:[], answer:'', analysis:'', ...fields });
const m1 = R.materialsFrom({materials:[{ref:'reading-A',materialMarkdown:'共同文章第一部分',sourcePages:[1]}]},1);
assert.deepStrictEqual(m1,[{ref:'reading-A',text:'共同文章第一部分',source_pages:[1],continues_previous:false}]);
const m2 = R.materialsFrom({materials:[{ref:'reading-A',materialMarkdown:'共同文章第二部分',sourcePages:[2],continuesPrevious:true}]},2);
for (const content of ['另一篇文章','共同文章第一部分']) {
  const ambiguous = R.resolveCurrentMaterials(m1,R.materialsFrom({materials:[{ref:'reading-A',materialMarkdown:content}]},2),2);
  assert.notEqual(ambiguous.current[0].ref,'reading-A', '相同标签不能证明不同页属于同组');
  assert(ambiguous.ambiguous.has(ambiguous.current[0].ref));
  const warned = R.enrichCard(mk('4',2),{materialRef:ambiguous.current[0].ref,groupRef:'A',groupPosition:1},2,ambiguous.current,'英语');
  assert(warned.recognition_notes.some(note=>note.includes('冲突')));
}
assert.equal(R.resolveCurrentMaterials(m1,m2,2).current[0].ref,'reading-A');
assert.throws(() => R.resolveCurrentMaterials([], [m1[0], m1[0]], 1), /标识重复/);
const combined = R.combineMaterials(m1,m2);
assert.equal(combined[0].text,'共同文章第一部分\n共同文章第二部分');
assert.deepStrictEqual(combined[0].source_pages,[1,2]);
const cards = [1,2].map((n) => R.enrichCard(mk(String(n),2),{materialRef:'reading-A',groupRef:'reading-A',groupPosition:n,sourcePages:[1,2]},2,combined,'英语'));
assert(cards.every(c=>c.material===combined[0].text && c._material_ref==='reading-A' && c.figure_review_required && c.content_review_required));
assert.equal(cards[0].group_ref,cards[1].group_ref);
assert.deepStrictEqual(cards.map(c=>c.group_position),[1,2]);
assert.deepStrictEqual(cards[0].source_pages,[1,2]);
const base=R.enrichCard(mk('13',1,{stem:'题干',options:[]}),{},1,[],'化学');
base._recognition_snapshot=R.snapshot(base);
const fragment=R.enrichCard(mk('13',2,{stem:'',options:[{label:'A',content:'甲'},{label:'B',content:'乙'}]}),{continuationOf:'13',sourcePages:[1,2]},2,[],'化学');
let result=R.finish([base],[fragment],2);
assert.equal(result.merged,0); assert.equal(result.added,1);
assert(result.drafts[1].recognition_notes.some(s=>s.includes('未能安全确认')));
const edited=R.enrichCard(mk('13',1),{},1,[],'化学');
edited._recognition_snapshot=R.snapshot(edited); edited.stem='老师已编辑';
const fragment2=R.enrichCard(mk('13',2,{stem:'续文'}),{continuationOf:'13'},2,[],'化学');
result=R.finish([edited],[fragment2],2);
assert.equal(result.merged,0); assert.equal(result.added,1); assert.equal(edited.stem,'老师已编辑');
assert(result.drafts[1].recognition_notes.some(s=>s.includes('未能安全确认')));
const reviewed=R.enrichCard(mk('7',1),{},1,[],'数学');
reviewed._recognition_snapshot=R.snapshot(reviewed); reviewed.ai_answer_review={answer:'teacher'};
const frag3=R.enrichCard(mk('7',2,{stem:'续文'}),{continuationOf:'7'},2,[],'数学');
assert.equal(R.finish([reviewed],[frag3],2).merged,0);
const firstImage=R.enrichCard(mk('9',1,{stem:'看[图1]'}),{},1,[],'数学');
firstImage._recognition_snapshot=R.snapshot(firstImage);
const secondImage=R.enrichCard(mk('9',2,{stem:'再看[图1]'}),{continuationOf:'9'},2,[],'数学');
const imagesResult=R.finish([firstImage],[secondImage],2);
assert.equal(imagesResult.merged,0); assert.equal(imagesResult.drafts.length,2);
assert(imagesResult.drafts[1].recognition_notes.some(s=>s.includes('图片编号')));
const shared=[{ref:'passage',text:'共享文章 第四空后仍有全文',source_pages:[1]}];
const question=R.enrichCard(mk('4',1,{stem:'第四空',questionType:'填空'}),{materialRef:'passage',groupRef:'section',groupPosition:4},1,shared,'英语');
question._recognition_snapshot=R.snapshot(question);
const proposed=R.enrichCard(mk('4',2,{stem:'第四空',questionType:'填空',options:[{label:'A',content:'甲'},{label:'B',content:'乙'}]}),{materialRef:'passage',groupRef:question.group_ref,groupPosition:4,sourcePages:[1,2]},2,shared,'英语');
assert.equal(proposed.group_ref,question.group_ref,'模型复述命名空间不得双重加前缀');
assert.equal(proposed._raw_group_ref,question.group_ref,'保留模型返回的原组标识');
const inferred=R.finish([question],[proposed],2);
assert.equal(inferred.merged,1); assert.equal(inferred.drafts[0].stem,'第四空');
assert.equal(inferred.drafts[0].questionType,'填空','不得自动猜测单选或多选');
assert(inferred.drafts[0].type_unconfirmed && inferred.drafts[0].recognition_notes.some(s=>s.includes('题型与选项')));
const explicitOld=R.enrichCard(mk('4',1,{stem:'第四空',questionType:'填空'}),{materialRef:'passage',groupRef:'section',groupPosition:4},1,shared,'英语');
explicitOld._recognition_snapshot=R.snapshot(explicitOld);
const explicitNext=R.enrichCard(mk('4',2,{stem:'第四空',questionType:'填空',options:[{label:'A',content:'甲'},{label:'B',content:'乙'}]}),{continuationOf:'4',materialRef:'passage',groupRef:explicitOld.group_ref,groupPosition:4,sourcePages:[1,2]},2,shared,'英语');
assert.equal(R.finish([explicitOld],[explicitNext],2).merged,1,'明确续题仍须满足材料、来源及选项等证据');
const echoOld=R.enrichCard(mk('8',1,{stem:'一道完整题，包括全部小问'}),{},1,[],'数学');
echoOld._recognition_snapshot=R.snapshot(echoOld);
const echoNext=R.enrichCard(mk('8',2,{stem:'一道完整题，包括 全部小问'}),{continuationOf:'8'},2,[],'数学');
const echo=R.finish([echoOld],[echoNext],2);
assert.equal(echo.merged,0,'模型将上一页整题回显并标续题时不可合并');
assert.equal(echo.drafts[0].stem,'一道完整题，包括全部小问');
function newPair(changeOld,changeNew){
  const old=R.enrichCard(mk('4',1,{stem:'第四空'}),{materialRef:'passage',groupRef:'section',groupPosition:4},1,shared,'英语');
  if(changeOld)changeOld(old);old._recognition_snapshot=R.snapshot(old);
  const next=R.enrichCard(mk('4',2,{stem:'第四空',options:[{label:'A',content:'甲'},{label:'B',content:'乙'}]}),{materialRef:'passage',groupRef:old.group_ref,groupPosition:4,sourcePages:[1,2]},2,shared,'英语');
  if(changeNew)changeNew(next);return [old,next];
}
for (const [a,b] of [
  newPair(null,c=>{c.material='不同材料';}),
  newPair(c=>{c.options=[{label:'A',content:'原有选项'}];},null),
  newPair(null,c=>{c.source_pages=[2];}),
  newPair(null,c=>{c.ai_answer_suggestion={answer:'不可推测'};}),
  newPair(null,c=>{c.stem='与共同原文无关的新题';}),
  newPair(c=>{c.figure_review_signature='已审核';},null),
]) assert.equal(R.finish([a],[b],2).merged,0,'条件不足时必须保留独立题卡');
const [ambiguousOld,ambiguousNext]=newPair();
assert.equal(R.finish([ambiguousOld,{...ambiguousOld}],[ambiguousNext],2).merged,0,'同题号不唯一时不能合并');
const duplicate=R.enrichCard(mk('7',2),{},2,[],'数学');
result=R.finish([reviewed],[duplicate],2);
assert(result.drafts[1].recognition_notes.some(s=>s.includes('同题号')));
const keep=R.enrichCard(mk('3',1),{materialRef:'R',groupRef:'R',groupPosition:1},1,[{ref:'R',text:'前半',source_pages:[1]}],'英语');
keep._recognition_snapshot=R.snapshot(keep);
R.extendMaterials([keep],[{ref:'R',text:'前半',source_pages:[1]}],[{ref:'R',text:'前半\n后半',source_pages:[1,2]}],2);
assert.equal(keep.material,'前半\n后半'); assert(keep.cross_page_review_required);
const malformed=R.enrichCard(mk('4',0),{sourcePages:'1,2'},0,[],'英语');
assert.deepStrictEqual(malformed.source_pages,[]);
const files=[1,2,3,4].map(n=>({n,url:`/图${n}.png`}));
const word={stem:'无图题干',material:'原文[图2]',options:[{label:'A',content:'选项[图4]'}],match_prompts:[],analysis:''};
word.figures=R.wordFigures(files,word);
assert.deepStrictEqual(word.figures,[null,files[1],null,files[3]],'共同材料及选项引用须保留 Word 稀疏图号');
assert.deepStrictEqual(require('./src/image-review').missing(word),[]);
require('./src/image-review').compact(word);
assert.equal(word.material,'原文[图1]'); assert.equal(word.options[0].content,'选项[图2]');
assert.deepStrictEqual(word.figures.map(x=>x.url),['/图2.png','/图4.png']);
const auxiliary=R.wordFigures(files,{match_prompts:['左侧[图3]'],_ai_recognized_answer:'[图1]'});
assert.deepStrictEqual(auxiliary,[files[0],null,files[2],null],'连线项和答案转写中的图像不得遗漏');
console.log('跨页共享材料、题组顺序、续题合并、老师编辑保护和不确定提示通过');
