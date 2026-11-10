'use strict';
const assert=require('assert');
const I=require('./src/question-images');
const q={stem:'题目 [图3]', material:'材料 [图2]', options:JSON.stringify([{text:'选项 [图4]'}]), match_prompts:'[]', answer:'A', analysis:'解析 [图1]', images:JSON.stringify(['/solution.png','/material.png','/stem.png','/option.png','/unknown.png'])};
assert.deepStrictEqual(I.studentImages(q),['','/material.png','/stem.png','/option.png','']);
assert.deepStrictEqual(I.solutionImages(q),['/solution.png','','','','']);
// 无任何图号的历史题无法推断用途，保留原有图片，不能声称它们都安全。
const legacy={stem:'老题',analysis:'解析',images:JSON.stringify(['/a','/b'])};
assert.deepStrictEqual(I.studentImages(legacy),['/a','/b']);
// 审核人员确认过的未编号题图可以展示，题面变化后此确认失效。
const approved={...q};
approved.source_detail=JSON.stringify({question_image_public:I.confirmedQuestionImages(q),question_image_public_basis:I.publicBasis(q)});
assert.deepStrictEqual(I.studentImages(approved),['','/material.png','/stem.png','/option.png','/unknown.png']);
approved.stem='题目已变 [图3]';
assert.deepStrictEqual(I.studentImages(approved),['','/material.png','/stem.png','/option.png','']);
// 即使历史审核过的正文图片被改成解析专用，也不能由旧确认公开。
const changed={stem:'题目 [图1]',analysis:'解析',images:JSON.stringify(['/same'])};
changed.source_detail=JSON.stringify({question_image_public:[1],question_image_public_basis:I.publicBasis(changed)});
changed.stem='题目'; changed.analysis='解析 [图1]'; assert.deepStrictEqual(I.studentImages(changed),['']);
// 同一图明确同时出现在题面和解析时仍是题图。
const shared={stem:'题面 [图1]',analysis:'解析 [图1]',images:'["/same"]'};
assert.deepStrictEqual(I.studentImages(shared),['/same']); assert.deepStrictEqual(I.solutionImages(shared),['/same']);
console.log('题图/解析图隔离、历史兼容、审核失效和图号稳定通过');
