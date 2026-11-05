/* 数学公式渲染辅助（2026-10-28 新增）
 *  - 题干/选项/解析里写 LaTeX（\( ... \)、\[ ... \]、$...$、$$...$$），
 *    页面渲染后调用 mtxTypeset(el) 把公式排版成标准数学符号（MathJax 3 SVG 输出，清晰可缩放）。
 *  - MathJax 未加载完 / 加载失败时静默跳过，不影响题目显示（原文照常显示）。
 */
'use strict';

(function () {
  let seq = 0;        // 排队序号，旧请求过期
  let running = false;
  const pending = []; // 待排版元素

  // 题目展示通常将换行转为 <br>。MathJax 无法跨 DOM 节点匹配一组公式定界符；
  // 仅在完整的块公式或 \(…\) 内将 <br> 还原为文本换行，普通文本换行不变。
  // 不跨图片、链接等其他元素合并，也不改编辑区、代码或尚未闭合的公式。
  function restoreFormulaBreaks(root) {
    const pairs = [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)']];
    const escaped = (s, i) => { let n = 0; while (i > 0 && s[--i] === '\\') n++; return n % 2 === 1; };
    const ranges = (s) => {
      const out = [];
      for (let i = 0; i < s.length;) {
        const pair = pairs.find((p) => s.startsWith(p[0], i) && !escaped(s, i));
        if (!pair) { i++; continue; }
        let j = i + pair[0].length;
        while (j < s.length && (!s.startsWith(pair[1], j) || escaped(s, j))) j++;
        if (j === s.length) { i += pair[0].length; continue; }
        out.push([i, j + pair[1].length]); i = j + pair[1].length;
      }
      return out;
    };
    const parents = [root, ...root.querySelectorAll('*')];
    parents.forEach((parent) => {
      if (parent.closest && parent.closest('pre,code,textarea,script,style,input,[contenteditable],mjx-container')) return;
      let group = [];
      const finish = () => {
        if (!group.some((node) => node.nodeType === 1)) { group = []; return; }
        let text = '';
        const breaks = [];
        group.forEach((node) => {
          if (node.nodeType === 3) text += node.nodeValue;
          else { breaks.push([node, text.length]); text += '\n'; }
        });
        const spans = ranges(text);
        let changed = false;
        breaks.forEach(([node, at]) => {
          if (spans.some(([start, end]) => at >= start && at < end)) {
            parent.replaceChild(parent.ownerDocument.createTextNode('\n'), node); changed = true;
          }
        });
        if (changed) parent.normalize();
        group = [];
      };
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType === 3 || (node.nodeType === 1 && node.tagName === 'BR')) group.push(node);
        else finish();
      });
      finish();
    });
  }

  function flush() {
    const my = ++seq;
    const list = pending.splice(0, pending.length);
    if (!list.length || typeof MathJax === 'undefined' || !MathJax.typesetPromise) return;
    list.forEach(restoreFormulaBreaks);
    running = true;
    MathJax.typesetPromise(list).catch(() => { /* 公式语法错误时保留原文，不抛出 */ }).finally(() => {
      running = false;
      if (my === seq && pending.length) flush();
    });
  }

  /** 对指定容器（或元素数组）做公式排版；esc() 转义过的文本不受影响（分隔符仍在） */
  window.mtxTypeset = function (els) {
    const arr = els ? (els.length !== undefined && typeof els !== 'string' ? Array.from(els) : [els]) : [];
    const valid = arr.filter((e) => e && e.querySelectorAll && e.textContent && (/\\\(|\\\[|\$\$?[^$]/).test(e.textContent));
    if (!valid.length) return;
    pending.push(...valid);
    if (typeof MathJax === 'undefined' || !MathJax.typesetPromise) {
      // MathJax 还没就绪：等它起来再排版（最多等 8 秒）
      let tries = 0;
      const t = setInterval(() => {
        if ((typeof MathJax !== 'undefined' && MathJax.typesetPromise) || ++tries > 40) {
          clearInterval(t);
          if (typeof MathJax !== 'undefined') flush();
        }
      }, 200);
      return;
    }
    if (running) return; // flush 完会带上 pending
    flush();
  };
})();
