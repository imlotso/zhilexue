'use strict';

// 数据库保留原内容；仅在响应时把属于当前存储的历史短期题图地址换成稳定的文件代理地址。
const store = require('./storage');

function normalizeBankImages(value, prefix, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (typeof value === 'string') {
    const key = store.bankImageKey(value, prefix);
    // 有些 API 还会返回原始 key（如上传结果的 key / 录题页图的 key）；调用方需要原值。
    if (key && value.trim() !== key) return store.bankImageProxyUrl(key);

    // 批次 pages / drafts 等旧接口会把 JSON 存成字符串；只在确实转换了图片时重写该字符串。
    const trimmed = value.trim();
    if (value.length <= 5 * 1024 * 1024 && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          const changed = normalizeBankImages(parsed, prefix, depth + 1);
          const before = JSON.stringify(parsed), after = JSON.stringify(changed);
          if (before !== after) return after;
        }
      } catch (_) { /* 是普通文本，不修改 */ }
    }
    // 历史 HTML 题干可能直接内嵌题图；仅替换 img 的 src，不改普通文本与外站图片。
    if (/<img\b/i.test(value)) {
      return value.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (all, lead, quote, src) => {
        const imgKey = store.bankImageKey(src.replace(/&amp;/g, '&'), prefix);
        return imgKey ? lead + quote + store.bankImageProxyUrl(imgKey) + quote : all;
      });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeBankImages(item, prefix, depth + 1));
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const out = Object.create(null);
    Object.keys(value).forEach((key) => { out[key] = normalizeBankImages(value[key], prefix, depth + 1); });
    return out;
  }
  return value;
}

module.exports = { normalizeBankImages };
