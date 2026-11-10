/* 英语单题细分分类。判分由基础题型负责，书面表达不自动判分。 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.QSubtype = value;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const list = [
    { code: 'listen_choice', label: '听力选择', type: 'single' },
    { code: 'listen_fill', label: '听力填空', type: 'fill' },
    { code: 'listen_judge', label: '听力判断', type: 'judge' },
    { code: 'listen_match', label: '听力匹配', type: 'sort' },
    { code: 'listen_sort', label: '听力排序', type: 'sort' },
    { code: 'single_choice', label: '单项选择', type: 'single' },
    { code: 'grammar_choice', label: '语法选择', type: 'single' },
    { code: 'cloze', label: '完形填空', type: 'single' },
    { code: 'reading', label: '阅读理解', type: 'single', types: ['single', 'fill', 'answer'] },
    { code: 'task_reading', label: '任务型阅读', type: 'fill', types: ['single', 'fill', 'answer'] },
    { code: 'reading_restore', label: '阅读还原', type: 'single' },
    { code: 'word_choice', label: '选词填空', type: 'single', types: ['single', 'fill'] },
    { code: 'dialogue', label: '补全对话', type: 'single', types: ['single', 'fill', 'answer'] },
    { code: 'correction', label: '改错', type: 'fill', types: ['fill', 'answer'], aliases: ['短文改错'] },
    { code: 'grammar_fill', label: '语法填空', type: 'fill' },
    { code: 'short_text_fill', label: '短文填空（单题）', type: 'fill', aliases: ['短文填空'] },
    { code: 'word_spelling', label: '单词拼写', type: 'fill' },
    { code: 'word_form', label: '所给词正确形式填空', type: 'fill', aliases: ['用所给词的正确形式填空'] },
    { code: 'sentence_transform', label: '句型转换', type: 'fill' },
    { code: 'sentence_completion', label: '完成句子', type: 'fill' },
    { code: 'sentence_sort', label: '连词成句', type: 'sort' },
    { code: 'translation', label: '翻译', type: 'fill', aliases: ['句子翻译'] },
    { code: 'writing', label: '书面表达', type: 'answer', aliases: ['作文', '英语作文'] },
    { code: 'calculation', label: '计算', type: 'answer', subject: '数学' },
    { code: 'math_match', label: '连线', type: 'sort', subject: '数学' },
    { code: 'drawing', label: '作图', type: 'answer', subject: '数学', subjects: ['数学', '物理', '化学'] },
  ];
  function find(value) {
    const v = String(value || '').trim().replace(/题$/, '');
    return list.find((x) => x.code === v || x.label === v || (x.aliases || []).includes(v)) || null;
  }
  function matchesSubject(item, subject) {
    return !!item && (Array.isArray(item.subjects) ? item.subjects.includes(subject) : subject === (item.subject || '英语'));
  }
  function matchesType(item, type) {
    return !!item && (item.types || [item.type]).includes(type);
  }
  function compatible(value, subject, type) {
    const found = find(value);
    return found && matchesSubject(found, subject) && matchesType(found, type) ? found.code : '';
  }
  function fillSelect(select, subject, type, current) {
    if (!select) return;
    const previous = current === undefined ? select.value : current;
    select.replaceChildren(new Option('不细分', ''));
    list.filter((x) => matchesSubject(x, subject) && matchesType(x, type)).forEach((x) => select.add(new Option(x.label, x.code)));
    select.value = compatible(previous, subject, type);
  }
  function isMatch(value) { return value === 'listen_match' || value === 'math_match'; }
  return { list, find, compatible, matchesSubject, matchesType, fillSelect, isMatch };
});
