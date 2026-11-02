'use strict';
/**
 * Word 规则解析自测： node wordq-test.js （不需要数据库和服务）
 * 覆盖：客户《word (1).docx》规则文档和《洋葱题库-样例.docx》两份样例的题数；各类不合规格式要给出明确的段号和原因。
 */
const fs = require('fs');
const path = require('path');
const { parseDocx } = require('./src/docxtext');
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
ok(r1.warnings.length === 1 && /当作第 1 题解析的一部分/.test(r1.warnings[0].msg), '被并入解析的题号会给出一条提示，不静默吞掉', r1.warnings[0] && r1.warnings[0].msg.slice(0, 40));
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
  ok(parseWordQuestions(P('单选题\n1.甲\nA. a\nB. b')).errors[0].msg.indexOf('缺少「答案：」') >= 0, '缺答案：报「缺少答案行」');
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
  ok(/小问（2）缺少「答案：」/.test(e8.errors[0].msg) && e8.list.length === 1, '多小问里某一问缺答案：只报那一问，其它小问保留', e8.errors[0].msg);
  ok(parseWordQuestions(P('随便一段没有题号的文字\n另一段')).list.length === 0, '没有题号的文档：识别 0 题、不报错（调用方提示"没认出题目"）');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
