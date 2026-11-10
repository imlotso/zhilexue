'use strict';
// Recognize paired, known markup and HTML void elements. Unpaired <b>, unknown
// <x> and other mathematical brackets stay literal, including inside rich text.
// Retained markup is still passed through the existing client HTML sanitizer.
const PAIRED = new Set('p div span b strong i em u s sub sup table thead tbody tr td th ul ol li h1 h2 h3 h4 h5 h6 a pre code blockquote math svg'.split(' '));
const VOID = new Set(['br', 'hr', 'img']);
function questionStemFields(value, explicitHtml = '') {
  const plain = String(value == null ? '' : value).trim();
  const source = String(explicitHtml || '').trim() || plain;
  const cleaned = source.replace(/<script\b[^<>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^<>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [...cleaned.matchAll(/<\/?([a-z][a-z0-9:-]*)(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/gi)];
  const marked = new Set(), stacks = new Map();
  tokens.forEach((token, i) => {
    const name = token[1].toLowerCase(), closing = /^<\//.test(token[0]);
    if (VOID.has(name) && !closing) { marked.add(i); return; }
    if (!PAIRED.has(name)) return;
    const stack = stacks.get(name) || [];
    if (closing && stack.length) { marked.add(stack.pop()); marked.add(i); }
    else if (!closing) stack.push(i);
    stacks.set(name, stack);
  });
  if (!explicitHtml && !marked.size && cleaned === source) return { stem: plain, stem_html: '' };
  const escapeAngles = text => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let text = '', html = '', cursor = 0;
  tokens.forEach((token, i) => {
    const before = cleaned.slice(cursor, token.index);text += before;html += escapeAngles(before);
    if (marked.has(i)) {
      html += token[0];
      if (token[1].toLowerCase() === 'img') text += '[图]';
      else if (/^<br\b|^<\/(?:p|div|li|tr|h[1-6])\s*>/i.test(token[0])) text += ' ';
    } else { text += token[0];html += escapeAngles(token[0]); }
    cursor = token.index + token[0].length;
  });
  text += cleaned.slice(cursor);html += escapeAngles(cleaned.slice(cursor));
  text = text.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return m; } })
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch (_) { return m; } }).replace(/&amp;/gi, '&');
  return { stem: text.replace(/\s+/g, ' ').trim(), stem_html: html };
}
module.exports = { questionStemFields };
