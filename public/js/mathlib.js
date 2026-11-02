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

  function flush() {
    const my = ++seq;
    const list = pending.splice(0, pending.length);
    if (!list.length || typeof MathJax === 'undefined' || !MathJax.typesetPromise) return;
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
