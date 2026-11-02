'use strict';
/**
 * Word 题目解析（规则版，不调 AI）：按客户《word (1).docx》的格式规则把段落文本解析成题目。
 *
 * 规则（客户原文）：
 *  · 试题必须有序号（1.  2.  3、）；选项用 A. 或 A、（不能用 (A) 【A】 A)）；四个选项可以放一行，但之间要隔开一段距离
 *  · 答案必须另起一行；解析另起一行，无解析可不填
 *  · 多选题答案 2 个及以上选项字母；判断题答案 对/错、正确/错误、正/误
 *  · 填空题用 _______ 或括号（），一个答案一个括号，答案另起一行、答案之间用「；」隔开
 *  · 计算题/简答题/论述题一概按问答题；多小问的问答题，小题号用（1）（2），内容放在 [问答题] 和 [问答题结束] 之间
 *
 * 题型来源（优先级）：所在小节标题（单选题 / 多选题 / …）> 题号后的括号标注（1.（单选题）…）> 按内容推断
 * 编号：每个小节可以从 1 重新编号（客户文档就是这样）；解析里的"1. xxx"不会被当成新题。
 *
 * 输出：{ list, errors, warnings, bigCount }
 *   list   题目数组（多小问的问答题拆成多题，共用 material）：
 *          { no, sub, type, stem, material, options:[{label,content}], answer, analysis, imgRefs, para }
 *   errors 不合规的题：{ para, no, text, msg }（para = 文档里的第几段，Word 没有行号；该题不会进 list）
 *   warnings 值得提醒但不拦截的：{ para, msg }（例如某个题号被当作上一题解析的一部分）
 */
const LETTERS = 'ABCDEFGHIJ';
const SECTION_NAMES = {
  单选题: 'single', 单项选择题: 'single', 选择题: 'single',
  多选题: 'multi', 多项选择题: 'multi',
  判断题: 'judge',
  填空题: 'fill',
  问答题: 'answer', 解答题: 'answer', 简答题: 'answer', 计算题: 'answer', 论述题: 'answer', 应用题: 'answer',
};
const TYPE_HINT = { 单选: 'single', 多选: 'multi', 判断: 'judge', 填空: 'fill', 问答: 'answer', 解答: 'answer', 简答: 'answer', 计算: 'answer' };
const SEC_ALT = Object.keys(SECTION_NAMES).sort((a, b) => b.length - a.length).join('|');
// 小节标题：「一、单选题」「单选题」「单选题要求：」「问答题（多个小问）」「【多选题】」
const RE_SECTION = new RegExp(`^(?:[一二三四五六七八九十]+\\s*[、.．]\\s*)?[（(【\\[]?\\s*(${SEC_ALT})\\s*[)）】\\]]?\\s*(?:[（(][^）)]{0,12}[)）])?\\s*(?:的)?(?:要求)?\\s*[:：]?\\s*$`);
const RE_QSTART = /^\s*(\d{1,3})\s*[.、．]\s*(.*)$/;
const RE_OPT_AT = /^([A-J])\s*[.、．]\s*(.*)$/;
const RE_OPT_BAD = /^(?:[（(【\[]\s*([A-J])\s*[)）】\]]|([A-J])\s*[)）])/;      // （A） 【A】 A)
const RE_ANS = /^(?:答案|正确答案|参考答案)\s*[:：]\s*(.*)$/;
const RE_ANA = /^(?:解析|点拨|【解析】|分析)\s*[:：]?\s*(.*)$/;
const RE_SUB = /^[（(]\s*(\d{1,2})\s*[)）]\s*(.*)$/;                           // （1）…
const RE_BLOCK_START = /^\[问答题\]\s*/;
const RE_BLOCK_END = /\[问答题结束\]\s*$/;
const hintFromHead = (s) => {
  const m = String(s || '').match(/^[（(]\s*([^）)]{1,8}?)\s*[)）]\s*/);
  if (!m) return null;
  const key = Object.keys(TYPE_HINT).find((k) => m[1].indexOf(k) === 0);
  return key ? { type: TYPE_HINT[key], rest: String(s).slice(m[0].length) } : null;
};
const normJudge = (v) => {
  const s = String(v || '').trim().toUpperCase().replace(/[。.．\s]/g, '');
  if (['正确', '对', '正', '√', '✓', '✔', '\\CHECKMARK', 'T', 'TRUE', '是', 'Y', 'YES'].includes(s)) return '正确';
  if (['错误', '错', '误', '×', '✗', '✘', 'X', 'F', 'FALSE', '否', 'N', 'NO'].includes(s)) return '错误';
  return '';
};
const cleanAna = (s) => {
  const t = String(s || '').replace(/[（(]\s*若无解析本行可不填\s*[)）]/g, '').trim();
  return /^(?:无|没有|略)?$/.test(t) ? '' : t;
};
const JUDGE_OPT = /^(?:\\checkmark|✓|✔|√|×|✗|✘|x|X|对|错|正确|错误)$/;
const figRefs = (s) => [...String(s || '').matchAll(/\[图(\d+)\]/g)].map((m) => Number(m[1]));

/** 把"A. xx   B. yy   C. zz"这种同一行的多个选项拆开；字母必须按顺序出现，避免把 "B. Brown" 之类误拆 */
function splitOptions(line) {
  const first = line.match(RE_OPT_AT);
  if (!first) return null;
  const out = [];
  let idx = LETTERS.indexOf(first[1]);
  const re = /(?:^|\s+)([A-J])\s*[.、．]\s*/g;
  let m; const marks = [];
  while ((m = re.exec(line))) {
    if (LETTERS.indexOf(m[1]) === idx + marks.length || (!marks.length && m[1] === first[1])) marks.push({ at: m.index + m[0].length, start: m.index, letter: m[1] });
  }
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : line.length;
    out.push({ label: mk.letter, content: line.slice(mk.at, end).trim() });
  });
  return out.length ? out : null;
}

function parseWordQuestions(paras) {
  const list = [];
  const errors = [];
  const warnings = [];
  let bigCount = 0;
  let section = '';        // 当前小节题型
  let sectionFresh = true; // 刚遇到小节标题：允许题号从 1 重新开始
  let lastNo = 0;
  let cur = null;          // 正在读的大题
  let mode = 'stem';       // stem | opt | ans | ana

  // 题号候选是不是真的新题：后面（到下一个题号 / 小节标题之前）出现选项行或「答案：」，或者自己带 [问答题] 标记
  const looksLikeQuestion = (i, head) => {
    if (RE_BLOCK_START.test(head)) return true;
    for (let j = i + 1; j < paras.length; j++) {
      const t = String(paras[j] || '').trim();
      if (!t) continue;
      if (RE_SECTION.test(t) || RE_QSTART.test(t)) return false;
      if (RE_ANS.test(t) || splitOptions(t)) return true;
    }
    return false;
  };
  const newSub = (no, text) => ({ no, stem: text, answer: '', analysis: '', mode: 'stem' });

  const fail = (c, msg) => errors.push({ para: c.para, no: c.no, text: String(c.rawHead || '').slice(0, 40), msg });

  /** 一道大题结束：校验并生成题目 */
  const finish = () => {
    if (!cur) return;
    const c = cur; cur = null;
    bigCount++;
    // ---- [问答题] 多小问：每个小问一题，共用 material ----
    if (c.block) {
      const b = c.block;
      const intro = b.intro.join('\n').trim();
      if (!b.subs.length) {
        const stem = intro;
        if (!stem) return fail(c, '[问答题] 里没有内容');
        if (!String(c.answer || '').trim()) return fail(c, '问答题缺少「答案：」行');
        list.push({ no: c.no, sub: 0, type: 'answer', stem, material: '', options: [], answer: String(c.answer).trim(), analysis: cleanAna(c.analysis), imgRefs: figRefs(stem), para: c.para });
        return;
      }
      b.subs.forEach((s) => {
        const stem = s.stem.trim();
        if (!stem) return fail(c, `小问（${s.no}）题干为空`);
        if (!s.answer.trim()) return fail(c, `小问（${s.no}）缺少「答案：」行`);
        list.push({ no: c.no, sub: Number(s.no), type: 'answer', stem, material: intro, options: [], answer: s.answer.trim(), analysis: cleanAna(s.analysis), imgRefs: [...new Set([...figRefs(intro), ...figRefs(stem), ...figRefs(s.analysis)])], para: c.para });
      });
      return;
    }
    const stem = c.stem.trim();
    if (!stem) return fail(c, '题干为空');
    const ans = c.answer.trim();
    let type = c.type || '';
    const opts = c.options;
    if (c.badOpt) return fail(c, `选项格式不对：「${c.badOpt}」——选项必须用 A. 或 A、（不能用（A）、【A】、A)），可在 Word 里用 Ctrl+F 批量替换`);
    if (!type) {   // 没有小节标题也没有括号标注：按内容推断
      if (opts.length >= 2) type = /^[A-J]{2,}$/.test(ans.replace(/[\s,，、;；]/g, '').toUpperCase()) ? 'multi' : 'single';
      else if (normJudge(ans)) type = 'judge';
      else if (/_{2,}|＿{2,}|[（(]\s*[)）]|□{2,}/.test(stem)) type = 'fill';
      else type = 'answer';
    }
    if (!ans) return fail(c, '缺少「答案：」行（答案必须另起一行）');
    // 两个选项都是 对/错 符号（洋葱题库的判断题写成 A. ✓ / B. ×）：按判断题处理，答案可以是符号也可以是选项字母
    if ((!c.type || c.type === 'single') && opts.length === 2 && opts.every((o) => JUDGE_OPT.test(o.content.trim()))) {
      const byLetter = opts.find((o) => o.label === ans.toUpperCase());
      const j = normJudge(byLetter ? byLetter.content : ans);
      if (!j) return fail(c, `判断题答案应为 对/错、正确/错误、正/误，现在是「${ans.slice(0, 20)}」`);
      list.push({ no: c.no, sub: 0, type: 'judge', stem, material: '', options: [], answer: j, analysis: cleanAna(c.analysis), imgRefs: [...new Set([...figRefs(stem), ...figRefs(c.analysis)])], para: c.para });
      return;
    }
    if (type === 'single' || type === 'multi') {
      if (opts.length < 2) return fail(c, '选择题至少需要 2 个选项（A. xx / B. xx）');
      const letters = [...new Set((ans.toUpperCase().match(/[A-J]/g) || []))].sort();
      if (!letters.length) return fail(c, `选择题答案应为选项字母，现在是「${ans.slice(0, 20)}」`);
      const bad = letters.find((L) => !opts.some((o) => o.label === L));
      if (bad) return fail(c, `答案「${bad}」不在选项里（现有选项 ${opts.map((o) => o.label).join('')}）`);
      if (type === 'single' && letters.length > 1) {
        if (c.type === 'single') return fail(c, `单选题答案只能有 1 个字母，现在是「${letters.join('')}」`);
        type = 'multi';
      }
      if (type === 'multi' && letters.length < 2) {
        if (c.type === 'multi') return fail(c, `多选题答案必须有 2 个及以上的选项，现在是「${letters.join('')}」`);
        type = 'single';
      }
      list.push({ no: c.no, sub: 0, type, stem, material: '', options: opts, answer: letters.join(','), analysis: cleanAna(c.analysis), imgRefs: [...new Set([...figRefs(stem), ...opts.map((o) => figRefs(o.content)).flat(), ...figRefs(c.analysis)])], para: c.para });
      return;
    }
    if (type === 'judge') {
      const j = normJudge(ans);
      if (!j) return fail(c, `判断题答案应为 对/错、正确/错误、正/误，现在是「${ans.slice(0, 20)}」`);
      list.push({ no: c.no, sub: 0, type, stem, material: '', options: [], answer: j, analysis: cleanAna(c.analysis), imgRefs: [...new Set([...figRefs(stem), ...figRefs(c.analysis)])], para: c.para });
      return;
    }
    if (type === 'fill') {
      const blanks = ans.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
      if (!blanks.length) return fail(c, '填空题答案为空');
      const nBlank = (stem.match(/_{2,}|＿{2,}|[（(]\s*[)）]|□{2,}/g) || []).length;
      if (nBlank && nBlank !== blanks.length) return fail(c, `填空题有 ${nBlank} 个空，但「答案：」里有 ${blanks.length} 个答案（答案之间用「；」隔开，一个空一个答案）`);
      list.push({ no: c.no, sub: 0, type, stem, material: '', options: [], answer: blanks.join('|'), analysis: cleanAna(c.analysis), imgRefs: [...new Set([...figRefs(stem), ...figRefs(c.analysis)])], para: c.para });
      return;
    }
    list.push({ no: c.no, sub: 0, type: 'answer', stem, material: '', options: [], answer: ans, analysis: cleanAna(c.analysis), imgRefs: [...new Set([...figRefs(stem), ...figRefs(c.analysis)])], para: c.para });
  };

  const addLine = (text) => {
    // 续行：按当前所处的部分接到题干 / 选项 / 答案 / 解析后面
    if (cur.block && cur.block.curSub) {
      const s = cur.block.curSub;
      if (s.mode === 'ans') s.answer += '\n' + text; else if (s.mode === 'ana') s.analysis += '\n' + text; else s.stem += '\n' + text;
    } else if (cur.block) {
      cur.block.intro.push(text);
    } else if (mode === 'opt' && cur.options.length) {
      cur.options[cur.options.length - 1].content += '\n' + text;
    } else if (mode === 'ans') cur.answer += '\n' + text;
    else if (mode === 'ana') cur.analysis += '\n' + text;
    else cur.stem += '\n' + text;
  };

  paras.forEach((raw, i) => {
    const para = i + 1;
    let line = String(raw || '').trim();
    if (!line) return;

    // 小节标题：结束当前题，记下题型，题号可从 1 重来
    const sec = line.match(RE_SECTION);
    if (sec) {
      finish(); cur = null;
      section = SECTION_NAMES[sec[1]] || '';
      sectionFresh = true;
      return;
    }

    // [问答题结束]
    if (cur && cur.block && RE_BLOCK_END.test(line)) {
      line = line.replace(RE_BLOCK_END, '').trim();
      if (line) addLine(line);
      finish(); cur = null;
      return;
    }

    // 新题
    const mq = line.match(RE_QSTART);
    if (mq && !(cur && cur.block)) {
      const no = Number(mq[1]);
      // 题号接着上一题，或者是小节标题后的第一题（可以从任意号开始）；解析里的 "1. xxx" 不满足这两条，不会被当成新题
      let sequential = no === lastNo + 1;
      // 上一题已经有答案、正在写解析时遇到「上一题号+1」：可能是解析里的列表项（"2. 第二步……"），要向后看才能确定
      if (sequential && !sectionFresh && cur && !cur.block && cur.answer.trim() && (mode === 'ana' || mode === 'ans') && !looksLikeQuestion(i, mq[2].trim())) {
        sequential = false;
        warnings.push({ para, msg: `「${line.slice(0, 24)}」后面没有选项也没有「答案：」，当作第 ${lastNo} 题${mode === 'ana' ? '解析' : '答案'}的一部分；如果它是新题，请补上答案行` });
      }
      if (sequential || sectionFresh) {
        finish();
        let head = mq[2].trim();
        let type = section;
        const hint = hintFromHead(head);
        if (hint) { type = hint.type; head = hint.rest.trim(); }
        else head = head.replace(/^[（(]\s*[^）)]{1,8}题\s*[)）]\s*/, '');   // （综合题）之类认不出题型的标签，只去掉不使用
        let isBlock = false;
        if (RE_BLOCK_START.test(head)) { isBlock = true; head = head.replace(RE_BLOCK_START, '').trim(); type = 'answer'; }
        cur = { no, para, type, rawHead: head || mq[2], stem: isBlock ? '' : head, options: [], answer: '', analysis: '', badOpt: '', block: isBlock ? { intro: head ? [head] : [], subs: [], curSub: null } : null };
        mode = 'stem'; lastNo = no; sectionFresh = false;
        return;
      }
    }
    if (!cur) return;   // 小节标题之间的说明文字

    // [问答题] 块里：小问 / 答案 / 解析
    if (cur.block) {
      const b = cur.block;
      const ms = line.match(RE_SUB);
      if (ms) { b.curSub = newSub(ms[1], ms[2].trim()); b.subs.push(b.curSub); return; }
      const ma = line.match(RE_ANS);
      if (ma) { if (b.curSub) { b.curSub.answer = ma[1] || ''; b.curSub.mode = 'ans'; } else { cur.answer = ma[1] || ''; mode = 'ans'; } return; }
      const mn = line.match(RE_ANA);
      if (mn) { if (b.curSub) { b.curSub.analysis = mn[1] || ''; b.curSub.mode = 'ana'; } else { cur.analysis = mn[1] || ''; mode = 'ana'; } return; }
      addLine(line);
      return;
    }

    // 选项（解析模式里不认选项）
    if (mode === 'stem' || mode === 'opt') {
      const opts = splitOptions(line);
      if (opts) { opts.forEach((o) => cur.options.push(o)); mode = 'opt'; return; }
      if (RE_OPT_BAD.test(line)) { cur.badOpt = cur.badOpt || line.slice(0, 20); mode = 'opt'; return; }
    }
    const ma = line.match(RE_ANS);
    if (ma) { cur.answer = ma[1] || ''; mode = 'ans'; return; }
    const mn = line.match(RE_ANA);
    if (mn) { cur.analysis = mn[1] || ''; mode = 'ana'; return; }
    addLine(line);
  });
  finish();
  return { list, errors, warnings, bigCount };
}

module.exports = { parseWordQuestions, splitOptions, normJudge };
