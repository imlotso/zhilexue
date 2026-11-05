'use strict';
/**
 * Word 规则解析自测： node wordq-test.js （不需要数据库和服务）
 * 覆盖：客户《word (1).docx》规则文档和《洋葱题库-样例.docx》两份样例的题数；各类不合规格式要给出明确的段号和原因。
 */
const fs = require('fs');
const path = require('path');
const { parseDocx, parseDocxQuestions } = require('./src/docxtext');
const { parseWordQuestions, splitOptions } = require('./src/wordq');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { console.log(`  ${c ? 'OK ' : 'FAIL'} ${name}${extra ? '  →  ' + extra : ''}`); c ? pass++ : fail++; };
const P = (t) => t.split('\n');   // 用多行文本当"段落"

(async () => {
  // ---------- 客户给的两份样例（只读，docs/原始需求 下） ----------
  const dir = path.join(__dirname, 'docs', '原始需求');
  const load = async (f) => parseDocx(fs.readFileSync(path.join(dir, f)), { saveImage: async () => '' });
  const rules = parseWordQuestions((await load('word (1).docx')).paras);
  const by = (r) => r.list.reduce((a, q) => { a[q.type] = (a[q.type] || 0) + 1; return a; }, {});
  ok(rules.bigCount === 6 && rules.list.length === 7 && rules.errors.length === 0,
    '《word (1).docx》规则文档：6 道大题（单选/多选/判断/填空/问答/多小问问答）→ 7 题，0 报错', `大题=${rules.bigCount} 题=${rules.list.length} 报错=${rules.errors.length}`);
  ok(JSON.stringify(by(rules)) === JSON.stringify({ single: 1, multi: 1, judge: 1, fill: 1, answer: 3 }), '题型分布正确', JSON.stringify(by(rules)));
  const q = (t, n) => rules.list.find((x) => x.type === t && (n == null || x.no === n));
  ok(q('multi').answer === 'C,D' && q('multi').options.length === 4, '多选题答案 CD → C,D，4 个选项');
  ok(q('judge').answer === '正确', '判断题「对」→ 正确');
  ok(q('fill').answer === 'Does|often|fishing', '填空题答案用「；」隔开 → 按 | 存（3 个空）', q('fill').answer);
  const sub = rules.list.filter((x) => x.no === 2);
  ok(sub.length === 2 && sub.every((x) => x.material.indexOf('空气对我们很重要') >= 0 && x.material.indexOf('仔细阅读') === 0) && sub[0].sub === 1 && sub[1].sub === 2,
    '[问答题]…[问答题结束] 多小问：每个小问一题，共用原文', sub.map((x) => `（${x.sub}）`).join(''));
  ok(rules.list.every((x) => x.analysis === ''), '「解析：无（若无解析本行可不填）」按空解析处理');

  const onion = parseWordQuestions((await load('洋葱题库-样例.docx')).paras);
  ok(onion.bigCount === 10 && onion.list.length === 10 && onion.errors.length === 0,
    '《洋葱题库-样例.docx》：10 题全部识别，0 报错', `题=${onion.list.length} 报错=${onion.errors.length}`);
  ok(JSON.stringify(by(onion)) === JSON.stringify({ single: 6, fill: 2, judge: 2 }), '洋葱样例题型分布：6 单选 / 2 填空 / 2 判断', JSON.stringify(by(onion)));
  ok(onion.list.filter((x) => x.type === 'judge').every((x) => x.answer === '错误' && x.options.length === 0), '洋葱的判断题（A. ✓ / B. ×，答案 ×）→ 判断题「错误」');
  ok(onion.list.every((x) => x.analysis.length > 0), '洋葱样例每题都带解析');

  // ---------- 格式细节 ----------
  const o1 = splitOptions('A. 5    B. 6   C. 7  D. 8');
  ok(o1 && o1.length === 4 && o1[3].content === '8', '四个选项放同一行（中间隔开）能拆开', JSON.stringify(o1.map((o) => o.label + o.content)));
  ok(splitOptions('A、苹果 B、香蕉').length === 2, 'A、 顿号写法');
  ok(splitOptions('A. the U.S.A. B. China').length === 2, '选项里的 "U.S.A." 不会被误拆', splitOptions('A. the U.S.A. B. China').map((o) => o.content).join(' / '));

  const r1 = parseWordQuestions(P('单选题\n1.题甲\nA. 一\nB. 二\n答案：B\n解析：因为……\n1. 第一步先算\n2. 第二步再算\n2.题乙\nA. 三\nB. 四\n答案：A'));
  ok(r1.list.length === 2 && r1.list[0].analysis.indexOf('第二步再算') > 0 && r1.list[1].stem === '题乙' && r1.list[1].answer === 'A', '解析里的 "1. xxx" "2. xxx" 不会被当成新题（向后看：后面没有选项/答案）', `题=${r1.list.length}`);
  ok(r1.warnings.length === 1 && /可能是新题/.test(r1.warnings[0].msg) && /题号后注明题型/.test(r1.warnings[0].msg), '被并入解析的题号会给出歧义及消除方法，不静默吞掉', r1.warnings[0] && r1.warnings[0].msg.slice(0, 40));
  const r2 = parseWordQuestions(P('单选题\n1.甲\nA. a\nB. b\n答案：A\n多选题\n1.乙\nA. a\nB. b\nC. c\n答案：AB\n判断题\n1、丙\n答案：错'));
  ok(r2.list.length === 3 && r2.list.map((x) => x.type).join() === 'single,multi,judge', '每个小节题号从 1 重新开始', r2.list.map((x) => x.type).join());
  const r3 = parseWordQuestions(P('一、单选题\n5.甲\nA. a\nB. b\n答案：A\n6.乙\nA. a\nB. b\nC. c\n答案：C'));
  ok(r3.list.length === 2, '小节第一题不是 1 号也能识别（不会被静默丢掉）', `题=${r3.list.length}`);
  const r4 = parseWordQuestions(P('1.（多选题）甲\nA. a\nB. b\nC. c\n答案：AC'));
  ok(r4.list.length === 1 && r4.list[0].type === 'multi' && r4.list[0].stem === '甲', '题号后的（多选题）标注：识别题型并从题干去掉');
  const r5 = parseWordQuestions(P('1.没有小节标题的选择题\nA. a\nB. b\nC. c\nD. d\n答案：B\n2.没标题的判断题\n答案：正确\n3.没标题的填空 ____ 和 ____\n答案：甲；乙\n4.没标题的问答\n答案：见解'));
  ok(r5.list.map((x) => x.type).join() === 'single,judge,fill,answer', '没有小节标题时按内容推断题型', r5.list.map((x) => x.type).join());

  // ---------- 不合规格式：给明确的段号和原因，其它题不受影响 ----------
  const bad = parseWordQuestions(P('单选题\n1.好题\nA. a\nB. b\n答案：A\n2.选项写法不对\n（A）甲\n（B）乙\n答案：A\n3.又一道好题\nA. a\nB. b\n答案：B'));
  ok(bad.list.length === 2 && bad.errors.length === 1 && bad.errors[0].no === 2 && bad.errors[0].para === 6 && /选项格式不对/.test(bad.errors[0].msg) && /Ctrl\+F/.test(bad.errors[0].msg),
    '选项写成（A）：报「选项格式不对」+ 段号 + 替换提示，其它题照常识别', bad.errors[0] && `第${bad.errors[0].para}段 题${bad.errors[0].no}`);
  const noSingle = parseWordQuestions(P('单选题\n1.甲\nA. a\nB. b'));
  ok(noSingle.errors.length === 0 && noSingle.list.length === 1 && noSingle.list[0].answer === '' && !noSingle.list[0].type_unconfirmed && noSingle.warnings.some(w => /未提供答案/.test(w.msg)), '单选无答案：保留空答案并提示，不改变明确题型');
  const e3 = parseWordQuestions(P('单选题\n1.甲\nA. a\nB. b\nC. c\n答案：AB'));
  ok(/单选题答案只能有 1 个字母/.test(e3.errors[0].msg), '单选题给了两个答案：明确报错', e3.errors[0].msg);
  const e4 = parseWordQuestions(P('多选题\n1.甲\nA. a\nB. b\nC. c\n答案：A'));
  ok(/多选题答案必须有 2 个及以上/.test(e4.errors[0].msg), '多选题只给一个答案：明确报错', e4.errors[0].msg);
  const e5 = parseWordQuestions(P('单选题\n1.甲\nA. a\nB. b\n答案：D'));
  ok(/不在选项里/.test(e5.errors[0].msg), '答案字母不在选项里：明确报错', e5.errors[0].msg);
  const e6 = parseWordQuestions(P('判断题\n1.甲\n答案：也许'));
  ok(/判断题答案应为/.test(e6.errors[0].msg), '判断题答案不认识：明确报错', e6.errors[0].msg);
  const e7 = parseWordQuestions(P('填空题\n1.空 ____ 和 ____ 和 ____\n答案：甲；乙'));
  ok(/有 3 个空.*2 个答案/.test(e7.errors[0].msg), '填空题空数和答案数不一致：明确报错', e7.errors[0].msg);
  const e8 = parseWordQuestions(P('问答题\n2.[问答题]读文章\n材料\n（1）第一问\n答案：甲\n（2）第二问\n[问答题结束]'));
  ok(e8.errors.length === 0 && e8.list.length === 2 && e8.list[0].answer === '甲' && e8.list[1].answer === '' && e8.list.every(q => /读文章/.test(q.material)) && e8.warnings.some(w => /小问（2）未提供答案/.test(w.msg)), '多小问缺答案：保留全部小问、共同材料和已有答案，缺项提示');
  const noAnswers = parseWordQuestions(P('多选题\n1.多选\nA.甲\nB.乙\n填空题\n2.结果 ____\n问答题\n3.为什么？\n判断题\n4.地球是圆的\n5.第一项\nA. √\nB. ×'));
  ok(noAnswers.errors.length === 0 && noAnswers.list.length === 5 && noAnswers.list.every(q => q.answer === '') && noAnswers.list[0].type === 'multi' && noAnswers.list[1].type === 'fill' && noAnswers.list[2].type === 'answer' && noAnswers.list[3].type === 'judge', '多选、填空、问答与判断缺答案均留空并保留题型');
  const unknownChoice = parseWordQuestions(P('1.没有注明题型\nA.甲\nB.乙\n2.（单选题）明确单选\nA.甲\nB.乙'));
  ok(unknownChoice.list.length === 2 && unknownChoice.list[0].type_unconfirmed === true && !unknownChoice.list[1].type_unconfirmed, '无答案且未注明单双选时题型待确认，显式单选无需推测');
  const genericChoice = parseWordQuestions(P('选择题\n1.没有注明单双选\nA.甲\nB.乙'));
  ok(genericChoice.list.length === 1 && genericChoice.list[0].type_unconfirmed, '通用“选择题”标题不能推断为明确单选');
  const boundary = parseWordQuestions(P('填空题\n1.先回答 ____\n答案：甲\n2.新题 ____\n3.末题 ____'));
  ok(boundary.list.length === 3 && boundary.list[0].answer === '甲' && boundary.list.slice(1).every(q => !q.answer), '有答案后连续无答案填空仍分为独立题');
  const questionBoundary = parseWordQuestions(P('问答题\n1.原因？\n答案：因为如此\n2.接下来如何处理？\n3.还有什么？'));
  ok(questionBoundary.list.length === 3 && questionBoundary.list.slice(1).every(q => !q.answer), '有答案后以问号明确标识的无答案问答不被吞入前题');
  const blankBad = parseWordQuestions(P('单选题\n1.选项错误\nA.甲'));
  ok(blankBad.errors.length === 1 && /至少需要 2 个选项/.test(blankBad.errors[0].msg), '缺答案时选项结构仍须合法');
  const blankInvalid = parseWordQuestions(P('填空题\n1.没有标空\n答案：；'));
  ok(blankInvalid.errors.length === 1 && /答案为空/.test(blankInvalid.errors[0].msg), '已填写但不含有效内容的填空答案仍报错');
  ok(parseWordQuestions(P('随便一段没有题号的文字\n另一段')).list.length === 0, '没有题号的文档：识别 0 题、不报错（调用方提示"没认出题目"）');

  const eng = parseWordQuestions(P('听力选择题\n1. 听音选答\nA. a\nB. b\n答案：A\n2.（单词拼写题）I have a ____\n答案：book'));
  ok(eng.errors.length === 0 && eng.list.length === 2 && eng.list[0].question_subtype === 'listen_choice' && eng.list[1].question_subtype === 'word_spelling', '英语细分题型可由章节标题或题号括号识别');
  const match = parseWordQuestions(P('听力匹配题\n1. 听音匹配\n匹配项：甲\n匹配项：乙\nA. 苹果\nB. 香蕉\n答案：B,A'));
  ok(match.errors.length === 0 && match.list.length === 1 && match.list[0].type === 'sort' && match.list[0].question_subtype === 'listen_match' && match.list[0].match_prompts.join() === '甲,乙' && match.list[0].answer === '2,1', 'Word 听力匹配：显式匹配项及字母答案被正确解析');
  const matchBlank = parseWordQuestions(P('1.（听力匹配题）听音匹配\n匹配项：甲\n匹配项：乙\nA. 苹果\nB. 香蕉'));
  ok(matchBlank.errors.length === 0 && matchBlank.list.length === 1 && matchBlank.list[0].answer === '', 'Word 听力匹配：无答案时留空进入审核');
  const matchBad = parseWordQuestions(P('听力匹配题\n1. 听音匹配\n匹配项：甲\n匹配项：乙\nA. 苹果\nB. 香蕉\n答案：A,A'));
  ok(matchBad.errors.length === 1 && /每个右侧选项使用一次/.test(matchBad.errors[0].msg), 'Word 听力匹配：重复答案明确报错');
  const matchBadOptions = parseWordQuestions(P('听力匹配题\n1. 听音匹配\n匹配项：甲\n匹配项：乙\nB. 苹果\nC. 香蕉\n答案：B,C'));
  ok(matchBadOptions.errors.length === 1 && /从 A 开始/.test(matchBadOptions.errors[0].msg), 'Word 听力匹配：非连续选项明确报错');
  const math = parseWordQuestions(P('连线题\n1. 将数字与名称连线\n匹配项：1\n匹配项：2\nA. 二\nB. 一\n答案：2,1\n作图题\n1. 作线段 AB 的垂直平分线'));
  ok(math.errors.length === 0 && math.list.length === 2 && math.list[0].question_subtype === 'math_match' && math.list[0].answer === '2,1' && math.list[1].question_subtype === 'drawing' && math.list[1].answer === '', 'Word 数学连线和无参考答案作图可解析');
  const ten = parseWordQuestions(P('单选题\n1. 甲\n难度（1–10）：7\nA. 一\nB. 二\n答案：A\n2. 乙\nA. 一\nB. 二\n答案：B'));
  ok(ten.errors.length === 0 && ten.list[0].difficulty_score_10 === 7 && ten.list[1].difficulty_score_10 == null && ten.list[0].stem === '甲', '明确十级难度被提取，旧题不猜测难度且元数据不进入题干');
  const tenBad = parseWordQuestions(P('判断题\n1. 甲\n十级难度：11\n答案：对'));
  ok(!tenBad.list.length && /1 至 10/.test(tenBad.errors[0].msg), '无效十级难度拒绝导入并说明原因');
  const tenBlock = parseWordQuestions(P('问答题\n1.[问答题]材料\n难度（1-10）：6\n（1）第一问\n答案：甲\n（2）第二问\n十级难度：9\n答案：乙\n[问答题结束]'));
  ok(tenBlock.list.length === 2 && tenBlock.list[0].difficulty_score_10 === 6 && tenBlock.list[1].difficulty_score_10 === 9, '多小问继承大题十级难度，小问可单独标注');
  const lesson = parseDocxQuestions(P('1.（填空题）结果是____\n难度（1-10）：10\n答案：1'));
  ok(lesson.list.length === 1 && lesson.list[0].difficulty_score_10 === 10 && !lesson.list[0].stem.includes('难度'), '课文习题 Word 同样提取明确十级难度');
  let badLesson = false; try { parseDocxQuestions(P('1.（填空题）结果是____\n十级难度：12\n答案：1')); } catch (e) { badLesson = /1 至 10/.test(e.message); }
  ok(badLesson, '课文习题 Word 的无效难度明确报错');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
