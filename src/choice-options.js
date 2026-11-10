'use strict';

// 按实际内容而不是数组长度统计，避免空格或空对象被当作有效选项。
function choiceOptionsError(type, options) {
  if (type !== 'single' && type !== 'multi') return '';
  const list = Array.isArray(options) ? options : [];
  const count = list.filter((option) => {
    const value = option && typeof option === 'object' ? (option.text != null ? option.text : option.content) : option;
    return String(value == null ? '' : value).trim().length > 0;
  }).length;
  if (count < 2) return '选择题至少需要两个非空选项，请对照原卷补齐';
  if (list.length > 10) return '选择题最多支持 10 个选项，请先核对';
  return '';
}
module.exports = { choiceOptionsError };
