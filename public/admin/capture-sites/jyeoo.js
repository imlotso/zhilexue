/* 候选规则，尚待真实页面逐字段验证；可分别维护不同页面类型。 */
(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  else (root.MFCaptureSiteRules = root.MFCaptureSiteRules || {}).jyeoo = config;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const base = {
    container: 'fieldset.quesborder,.ques-basket .basket-list fieldset',
    stem: '.pt1', options: '.pt2 td.selectoption label,.pt2 label',
    strip: '.qseq,.ques-source,.sanwser', answer: '.sanwser', analysis: '.analysis',
    type: '', difficulty: '', knowledge: ''
  };
  return { chapter: { ...base }, knowledge: { ...base }, paper: { ...base } };
});
