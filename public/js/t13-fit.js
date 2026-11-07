/* T13：学习卡片里的单词 / 释义 / 选项放不下时缩小字号，让它们始终待在固定高度的区域里（只改显示，不碰 words.js 的逻辑）。
 * 只处理 .t13-card 里的 .wq-word / .wq-mean / .wt-opt；检测到 DOM 变化（换词、换题）、窗口尺寸变化、字号档位切换时重新量一遍。 */
(function () {
  'use strict';
  var SEL = '.t13-card .wq-word, .t13-card .wq-mean, .t13-card .wt-opt';
  var MIN = 0.42;                       // 最小缩到原字号的 42%
  var raf = 0;
  // scrollHeight/clientHeight 都会取整，1px 差值仍可能裁掉 Windows 字体的 y/g 下沿。
  // 横向保留原有舍入容差；纵向有溢出就继续缩字，不改变卡片或区域高度。
  function over(el) { return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight; }
  function fit(el) {
    el.style.fontSize = '';
    if (!el.clientWidth || !el.clientHeight) return;            // 没显示（display:none）不量
    if (!over(el)) return;
    var base = parseFloat(getComputedStyle(el).fontSize) || 16;
    var size = base;
    for (var i = 0; i < 14 && over(el) && size > base * MIN; i++) {
      size = Math.max(base * MIN, size * 0.92);
      el.style.fontSize = size + 'px';
    }
  }
  function run() {
    raf = 0;
    var list = document.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) fit(list[i]);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(run); }
  function start() {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList' || m.type === 'characterData') { schedule(); return; }
        if (m.type === 'attributes' && m.target === document.body) { schedule(); return; }   // 字号档位 / 舞台开关
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
