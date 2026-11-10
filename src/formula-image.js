'use strict';

// 不调用系统浏览器、TeX 或网络：MathJax 生成自包含 SVG，resvg 在本地转为 PNG。
// 每个公式单独创建 TeX 解析器，避免一份试卷中的宏定义影响其他题目。
let engine;
function getEngine() {
  if (engine) return engine;
  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  require('mathjax-full/js/input/tex/ams/AmsConfiguration.js');
  require('mathjax-full/js/input/tex/cancel/CancelConfiguration.js');
  require('mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js');
  const { Resvg } = require('@resvg/resvg-js');
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  engine = { mathjax, TeX, SVG, adaptor, Resvg };
  return engine;
}

/** 不支持、无效或超出资源限制的公式返回 null，由调用方保留原文。 */
function formulaImage(latex) {
  const source = String(latex || '');
  if (!source || source.length > 1200) return null;
  try {
    const { mathjax, TeX, SVG, adaptor, Resvg } = getEngine();
    const input = new TeX({ packages: ['base', 'ams', 'cancel', 'mhchem'], maxMacros: 500, maxBuffer: 2048 });
    const doc = mathjax.document('', { InputJax: input, OutputJax: new SVG({ fontCache: 'local' }) });
    const svg = adaptor.innerHTML(doc.convert(source, { display: false }));
    // 不渲染错误提示、外部引用或需要系统字体的文本，避免产生错误或缺字的图片。
    if (svg.length > 500000 || /data-mml-node="merror"|<text[\s>]|(?:href|src)\s*=\s*["'](?!#)/i.test(svg)) return null;
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'zoom', value: 2 } });
    if (renderer.imagesToResolve().length || renderer.width > 960 || renderer.height > 480 || renderer.width < 1 || renderer.height < 1) return null;
    const rendered = renderer.render();
    return { png: rendered.asPng(), width: Math.max(1, Math.round(rendered.width / 2)), height: Math.max(1, Math.round(rendered.height / 2)) };
  } catch (_) {
    return null;
  }
}

module.exports = { formulaImage };
