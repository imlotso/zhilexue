/* 候选规则，尚待真实页面逐字段验证；可分别维护不同页面类型。 */
(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  else (root.MFCaptureSiteRules = root.MFCaptureSiteRules || {}).zujuan = config;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const base = {
    container: '.quest-basket .mini-quest-item,.quest-basket .tk-mini-quest,.exam-item',
    stem: '.exam-item__cnt', options: '.option,.selectoption',
    strip: '.option,.selectoption,.exam-item__answer,.exam-item__analysis',
    answer: '.exam-item__answer', analysis: '.exam-item__analysis',
    type: '.ques-type', difficulty: '.ques-hard', knowledge: '.knowledge-name'
  };
  return { chapter: { ...base }, knowledge: { ...base }, paper: { ...base } };
});
