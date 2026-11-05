/* 书签采集和源码自检共用规则。规则来自现有站点选择器，尚待真实页面验证。 */
(function (root, factory) {
  const configs = typeof module === 'object' && module.exports ? { zujuan: require('./capture-sites/zujuan'), jyeoo: require('./capture-sites/jyeoo'), '21cnjy': require('./capture-sites/21cnjy') } : root.MFCaptureSiteRules;
  const api = factory(configs);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MFCaptureRules = api;
})(typeof window !== 'undefined' ? window : globalThis, function (configs) {
  // 不依赖闭包，可嵌入书签脚本；自检与书签运行同一提取逻辑。
  function extract(doc, site, pageType, pageUrl, allRules) {
    const rules = allRules && allRules[site] && allRules[site][pageType];
    if (!rules) return { supported: false, questions: [], message: '该站点页面类型暂无可用规则，请提供真实页面样本以完善。' };
    const txt = (el) => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const one = (el, selector) => selector ? el.querySelector(selector) : null;
    const all = (el, selector) => selector ? Array.from(el.querySelectorAll(selector)) : [];
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
    // 21 组卷把公式作为 URL 中携带 MathML 的 SVG 输出。只转换明确支持的数学节点；
    // 不认识的公式保留原图链接，由待审核流程提示补图，不凭文字猜公式。
    const mathmlLatex = (value) => {
      try {
        if (!value || value.length > 20000 || /<!DOCTYPE|<!ENTITY/i.test(value)) return '';
        const xml = new DOMParser().parseFromString(value, 'application/xml');
        if (xml.querySelector('parsererror') || !xml.documentElement || xml.documentElement.localName !== 'math') return '';
        let count = 0;
        const walk = (node) => {
          if (++count > 500) throw Error('formula too large');
          const name = node.localName, children = Array.from(node.children || []), joined = () => children.map(walk).join('');
          if (['math','mrow','semantics','mstyle'].includes(name)) return joined();
          if (['mi','mn','mo'].includes(name)) {
            const text = String(node.textContent || '').trim();
            if (!text || /[{}\\^_$%#~]/.test(text)) throw Error('unsupported math token');
            return text.replace(/</g, '\\lt ').replace(/>/g, '\\gt ').replace(/&/g, '\\& ');
          }
          if (name === 'mtext') { const text=String(node.textContent || ''); if (/[{}\\$%#~^_&]/.test(text)) throw Error('unsupported math text'); return '\\text{' + text + '}'; }
          if (name === 'mfrac' && children.length === 2) return '\\frac{' + walk(children[0]) + '}{' + walk(children[1]) + '}';
          if (name === 'msup' && children.length === 2) return '{' + walk(children[0]) + '}^{' + walk(children[1]) + '}';
          if (name === 'msub' && children.length === 2) return '{' + walk(children[0]) + '}_{' + walk(children[1]) + '}';
          if (name === 'msubsup' && children.length === 3) return '{' + walk(children[0]) + '}_{' + walk(children[1]) + '}^{' + walk(children[2]) + '}';
          if (name === 'msqrt' && children.length) return '\\sqrt{' + joined() + '}';
          if (name === 'mroot' && children.length === 2) return '\\sqrt[' + walk(children[1]) + ']{' + walk(children[0]) + '}';
          if (name === 'annotation' || name === 'annotation-xml') return '';
          throw Error('unsupported math element');
        };
        const latex = walk(xml.documentElement);
        return latex ? '\\( ' + latex + ' \\)' : '';
      } catch (_) { return ''; }
    };
    if (rules.adapter === '21cnjy-list') {
      const out = []; let skippedGroups = 0;
      all(doc, rules.container).forEach((el) => {
        const head = one(el, rules.stem); if (!head) return;
        const sourceNode = one(el, rules.source), sourceText = txt(sourceNode);
        const matchYear = sourceText.match(/(?:19|20)\d{2}/), year = matchYear ? matchYear[0] : '';
        const link = one(el, rules.detail), href = link && link.getAttribute('href') || '';
        const matchId = href.match(/\/question\/detail\/(\d+)/);
        const ref = matchId ? matchId[1] : hash(txt(head));
        const subs = all(el, rules.children);
        // 未识别的组合题不能只采集公共材料，避免静默漏掉全部小题。
        if (one(el, ':scope > .q-mc > .q-bd-list') && (!subs.length || subs.some((part) => !txt(one(part, ':scope > .q-mc > .q-tit'))))) { skippedGroups++; return; }
        const parts = subs.length ? subs : [el];
        parts.forEach((part, index) => {
          const images = [];
          const render = (element, stripSource) => {
            if (!element) return '';
            const copy = element.cloneNode(true);
            if (stripSource) all(copy, '.alnk-jump').forEach((n) => n.remove());
            all(copy, '.filling').forEach((n) => n.replaceWith('____'));
            all(copy, 'img').forEach((img) => {
              const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
              try {
                const url = new URL(src, pageUrl);
                if (!src || !/^https?:$/.test(url.protocol)) throw Error('unsupported image');
                if (img.classList.contains('mathml') && url.searchParams.has('mml')) {
                  const math = mathmlLatex(url.searchParams.get('mml'));
                  if (math) { img.replaceWith(math); return; }
                }
                images.push(url.href); img.replaceWith('[图' + images.length + ']'); return;
              } catch (_) { images.push(src); img.replaceWith('[图' + images.length + ']'); }
            });
            all(copy, 'table').forEach((table) => {
              const rows = all(table, 'tr').map((tr) => all(tr, 'th,td').map((cell) => txt(cell)).join(' | ')).filter(Boolean);
              if (rows.length) table.replaceWith(' ' + rows.join(' / ') + ' ');
            });
            return txt(copy);
          };
          const material = subs.length ? render(head, true).replace(/^\s*\d+\s*[.．、]\s*/, '') : '';
          const target = subs.length ? one(part, ':scope > .q-mc > .q-tit') : head;
          const stem = render(target, !subs.length).replace(/^\s*\d+\s*[.．、]\s*/, '');
          if (!stem) return;
          const options = all(part, rules.options).map((option) => render(option, false)).filter(Boolean);
          out.push({ questionId: subs.length ? `${ref}-sub-${index + 1}` : String(ref), site, sourceUrl: pageUrl,
            material, stem, options, answer: '', analysis: '', type: options.length >= 2 ? 'single' : (target && target.querySelector('.filling') ? 'fill' : 'answer'), type_unconfirmed: options.length >= 2,
            year, source_text: sourceText, images, group_ref: subs.length ? String(ref) : '', group_position: subs.length ? index + 1 : 0,
            meta: { knowledgePoints: [] } });
        });
      });
      const warning = skippedGroups ? `有 ${skippedGroups} 道组合题结构未识别，已跳过，请手动补录。` : '';
      return { supported: true, questions: out, message: out.length ? warning : (warning || '规则未匹配到题目，请核对页面类型和源码。') };
    }
    const questions = [];
    all(doc, rules.container).forEach((el) => {
      const source = one(el, rules.stem);
      if (!source) return;
      const stemEl = source.cloneNode(true);
      all(stemEl, rules.strip).forEach((n) => n.remove());
      const images = [];
      const render = (element) => {
        if (!element) return '';
        const copy = element.cloneNode(true);
        all(copy, 'img').forEach((img) => {
          const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          try {
            const u = new URL(src, pageUrl);
            if (src && /^https?:$/.test(u.protocol)) { images.push(u.href); img.replaceWith('[图' + images.length + ']'); return; }
          } catch (_) { /* 图片来源不合法，保留待核标记 */ }
          img.replaceWith('[待补图]');
        });
        return txt(copy);
      };
      const stem = render(stemEl); if (!stem) return;
      const options = all(el, rules.options).map((o) => render(o).replace(/^[A-H][.、．]\s*/, '')).filter(Boolean);
      const answer = render(one(el, rules.answer)).replace(/^(?:【答案】|答案\s*[:：])\s*/, '');
      const analysis = render(one(el, rules.analysis)).replace(/^(?:【解析】|解析\s*[:：])\s*/, '');
      const rawId = el.getAttribute('data-questionid') || el.getAttribute('questionid') || '';
      questions.push({
        questionId: String(rawId || site + '-' + hash(stem + '|' + options.join('|'))), site, sourceUrl: pageUrl,
        stem, options, answer, analysis, type: txt(one(el, rules.type)),
        difficulty: txt(one(el, rules.difficulty)), images,
        meta: { knowledgePoints: all(el, rules.knowledge).map(txt).filter(Boolean) }
      });
    });
    return { supported: true, questions, message: questions.length ? '' : '规则未匹配到题目，请核对页面类型和源码。' };
  }
  return { configs, extract };
});
