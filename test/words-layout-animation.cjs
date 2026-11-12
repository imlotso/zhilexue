'use strict';
// The learning phase intentionally scales English, then Chinese. Measure only
// after the second animation completes; do not suppress either animation.
async function waitForMemoryAnimation(page, timeout = 6000) {
  await page.waitForFunction(() => {
    const en = document.querySelector('#wqEn');
    return en && en.classList.contains('wq-big') && new DOMMatrix(getComputedStyle(en).transform).a > 1.01;
  }, null, { timeout });
  await page.waitForFunction(() => {
    const cn = document.querySelector('#wqCn');
    return cn && cn.classList.contains('wq-big') && new DOMMatrix(getComputedStyle(cn).transform).a > 1.01;
  }, null, { timeout });
  await page.waitForFunction(() => {
    const en = document.querySelector('#wqEn'), cn = document.querySelector('#wqCn');
    return !!en && !!cn && [en, cn].every(el => !el.classList.contains('wq-big') &&
      getComputedStyle(el).transform === 'none' &&
      el.getAnimations().every(animation => animation.playState !== 'running'));
  }, null, { timeout });
}
module.exports = { waitForMemoryAnimation };
