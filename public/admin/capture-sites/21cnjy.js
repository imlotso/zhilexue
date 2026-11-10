/* 按 21 组卷公开的章节 / 知识点选题页面 DOM 配置；试卷详情未启用。 */
(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  else (root.MFCaptureSiteRules = root.MFCaptureSiteRules || {})['21cnjy'] = config;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const listing = {
    adapter: '21cnjy-list',
    container: '.JV_list > .items > ul > li > .question-block',
    stem: ':scope > .q-mc > .q-tit',
    children: ':scope > .q-mc > .q-bd-list > li > .question-block',
    options: ':scope > .q-mc > .exam-s > .op-item > .op-item-meat',
    detail: ':scope > .paper-fun-list a[href*="/question/detail/"]',
    source: ':scope > .q-mc > .q-tit > .alnk-jump',
  };
  return { chapter: { ...listing }, knowledge: { ...listing }, paper: null };
});
