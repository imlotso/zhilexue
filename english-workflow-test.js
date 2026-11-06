'use strict';
// 合成样本：覆盖全部英语细分题型的 Word / Excel 导入与既有判分器。
const assert = require('assert');
const XLSX = require('xlsx');
const Q = require('./public/js/question-subtypes');
const {parseWordQuestions} = require('./src/wordq');
const {parseBankWorkbook} = require('./src/bank-excel');
const {normalizePack} = require('./src/mfpack-adapter');
const {judgeQ} = require('./src/bank-judge');
const wb = XLSX.utils.book_new(), sheets = {};
let count = 0;
for (const sub of Q.list.filter(x => Q.matchesSubject(x, '英语'))) {
  const type = sub.type, match = Q.isMatch(sub.code);
  const answer = type === 'single' ? 'A' : type === 'judge' ? '正确' : type === 'sort' ? 'B,A' : type === 'fill' ? 'Hello|||Hi' : '';
  const lines = [sub.label.replace(/（单题）/, '') + '题', `1. ${sub.code === 'single_choice' ? '（单项选择）' : ''}${type === 'fill' ? '填写 ____' : '合成英语题'}`];
  if (match) lines.push('匹配项：Tom', '匹配项：Ann');
  if (['single','sort'].includes(type)) lines.push('A. first', 'B. second');
  if (answer) lines.push('答案：' + answer);
  const r = parseWordQuestions(lines);
  assert.equal(r.errors.length,0,sub.code + ': ' + JSON.stringify(r.errors));
  assert.equal(r.list.length,1,sub.code); const q = r.list[0];
  assert.equal(q.type,type,sub.code); assert.equal(q.question_subtype,sub.code,sub.code);
  if (type === 'answer') assert.throws(() => judgeQ(q,'writing'),/不支持自动判分/);
  else { const my = type === 'fill' ? 'hi' : type === 'sort' ? '2,1' : answer; assert(judgeQ(q,my),sub.code); assert(!judgeQ(q,'wrong'),sub.code); }
  const sheet = {single:'单选题',judge:'判断题',fill:'填空题',sort:'排序题',answer:'书面表达题'}[type];
  (sheets[sheet] ||= []).push({'题目':'合成 '+sub.label,'选项A':'first','选项B':'second','答案':answer,'正确选项':answer,'第1空答案':type==='fill'?answer:'','英语细分题型':sub.code,'匹配左侧项目':match?'Tom\nAnn':''});
  count++;
}
for (const [name,rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);
const excel=parseBankWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
assert.deepEqual(excel.errors,[]); assert.equal(excel.items.length,count);
for (const q of excel.items) { if (q.type === 'answer') continue; assert(judgeQ(q,q.type === 'fill' ? 'hi' : q.type === 'sort' ? '2,1' : q.answer), q.question_subtype + ' Excel 判分'); }
assert.deepEqual(new Set(excel.items.map(x=>x.question_subtype)),new Set(Q.list.filter(x=>Q.matchesSubject(x,'英语')).map(x=>x.code)));
const grouped=parseWordQuestions(['阅读理解题','[材料]','Passage [图1]','[材料结束]','1. Read and choose.','A. yes','B. no','答案：A','2. Read again.','A. yes','B. no','答案：B','[材料清空]','填空题','1. Independent ____','答案：hi']);
assert.equal(grouped.errors.length,0); assert.equal(grouped.list.length,3);
assert.equal(grouped.list[0].material,'Passage [图1]');assert.equal(grouped.list[1].group_ref,grouped.list[0].group_ref);assert(grouped.list[1].imgRefs.includes(1));assert.equal(grouped.list[2].material,'');
for(const ans of ['A,A','C,A','1,1','21','1,2,3']) assert.equal(parseWordQuestions(['听力排序题','1. Sort','A. first','B. second','答案：'+ans]).list.length,0,ans);
const missing=parseWordQuestions(['听力排序题','1. Sort','A. first','B. second']);assert.equal(missing.list[0].answer,'');
assert(parseWordQuestions(['[材料]','missing end']).errors.length);
const audio=normalizePack({questions:[{material:'听力材料',audio_key:'bank/audio/synthetic.wav',audio_play_limit:2,children:[{stem:'Q1',type:'listen_choice',options:['yes','no']},{stem:'Q2',type:'listen_fill',audio_play_limit:0}]}]});
assert.equal(audio.questions[0].content.audio_key,'bank/audio/synthetic.wav');assert.equal(audio.questions[0].content.audio_play_limit,2);assert.equal(audio.questions[1].content.audio_play_limit,0);
for(const code of ['task_reading','dialogue','reading']) assert.equal(Q.compatible(code,'英语','answer'),code);
console.log(`全部 ${count} 种英语细分题型 Word/Excel 导入与判分、共同材料和 JSON 共用音频通过`);
