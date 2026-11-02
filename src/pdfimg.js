'use strict';
/**
 * 极简 PDF 生成器：把位图（PNG / JPEG）按给定坐标贴到页面上。
 *
 * 为什么不用第三方库：本项目要能离线部署、`npm install` 越少越好，而且不许装原生依赖。
 * 为什么不需要字体：错题集的内容全是图片，页面上的文字只有纯 ASCII 的页码，
 * 用 PDF 内置的 Helvetica 即可（中文标题由前端渲染成一张图片一起贴上去）。
 *
 * PNG 走 FlateDecode（自己解 PNG → 原始 RGB → 再 deflate，体积和清晰度都可控）；
 * JPEG 走 DCTDecode（原样嵌入，不解码）。
 */
const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isPng = (b) => b && b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
const isJpeg = (b) => b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/** 解析 PNG 尺寸/通道（不解码像素） */
function pngHeader(buf) {
  if (!isPng(buf)) throw new Error('不是 PNG 图片');
  let off = 8, ihdr = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      const d = buf.subarray(off + 8, off + 8 + len);
      ihdr = { width: d.readUInt32BE(0), height: d.readUInt32BE(4), depth: d[8], color: d[9], interlace: d[12] };
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG 缺少 IHDR');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.color];
  if (!ch) throw new Error('不支持的 PNG 颜色类型：' + ihdr.color);
  return { ...ihdr, channels: ch };
}

/** 解析 JPEG 尺寸与通道数（不解码像素） */
function jpegHeader(buf) {
  if (!isJpeg(buf)) throw new Error('不是 JPEG 图片');
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5), components: buf[off + 9] };
    }
    off += 2 + len;
  }
  throw new Error('JPEG 尺寸解析失败');
}

/** 图片基础信息：{ type:'png'|'jpg', width, height } */
function imageInfo(buf) {
  if (isPng(buf)) { const h = pngHeader(buf); return { type: 'png', width: h.width, height: h.height }; }
  if (isJpeg(buf)) { const h = jpegHeader(buf); return { type: 'jpg', width: h.width, height: h.height }; }
  throw new Error('只支持 PNG / JPEG 图片');
}

/**
 * 解码 PNG（8 位、非隔行、灰度/RGB/带 Alpha）→ 白底合成的 RGB 像素
 * @returns {{width:number,height:number,rgb:Buffer}}
 */
function decodePng(buf) {
  const hd = pngHeader(buf);
  if (hd.depth !== 8) throw new Error('仅支持 8 位 PNG（位深 ' + hd.depth + '）');
  if (hd.interlace) throw new Error('不支持隔行 PNG');
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!idat.length) throw new Error('PNG 缺少 IDAT 数据');
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const { width: w, height: h, channels: ch } = hd;
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    if (ft === 1 || ft === 2 || ft === 3 || ft === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0;
        const b = prev[i];
        const c = i >= ch ? prev[i - ch] : 0;
        let v = line[i];
        if (ft === 1) v = (v + a) & 0xff;
        else if (ft === 2) v = (v + b) & 0xff;
        else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        line[i] = v;
      }
    } else if (ft !== 0) {
      throw new Error('PNG 行过滤器类型异常：' + ft);
    }
    for (let x = 0; x < w; x++) {
      let r, g, b;
      if (ch === 1) {
        r = g = b = line[x];
      } else if (ch === 2) {
        const a0 = line[x * 2 + 1];
        r = g = b = line[x * 2];
        if (a0 < 255) { const f = a0 / 255; r = g = b = Math.round(r * f + 255 * (1 - f)); }
      } else if (ch === 3) {
        r = line[x * 3]; g = line[x * 3 + 1]; b = line[x * 3 + 2];
      } else {
        const a0 = line[x * 4 + 3], f = a0 / 255;
        r = Math.round(line[x * 4] * f + 255 * (1 - f));
        g = Math.round(line[x * 4 + 1] * f + 255 * (1 - f));
        b = Math.round(line[x * 4 + 2] * f + 255 * (1 - f));
      }
      const o = (y * w + x) * 3;
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
    prev = line;
  }
  return { width: w, height: h, rgb: out };
}

const num = (n) => (Math.round(Number(n) * 100) / 100).toString();
const escapeText = (s) => String(s == null ? '' : s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');

/**
 * 生成 PDF
 * @param {{size?:number[], pages:Array<{w?:number,h?:number,images?:Array<{buf:Buffer,x:number,y:number,w:number,h:number}>,texts?:Array<{x:number,y:number,text:string,size?:number,color?:string,align?:'left'|'right'}>}>}} opts
 * @returns {Buffer}
 */
function build({ size = [595.28, 841.89], pages = [] } = {}) {
  if (!pages.length) throw new Error('没有可输出的页面');
  const objects = [];
  const alloc = (o) => { objects.push(o || { dict: '' }); return objects.length; };

  const catalogNum = alloc();
  const pagesNum = alloc();
  const fontNum = alloc({ dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });

  // 图片对象按 buffer 去重（页眉横幅会在每页重复使用同一张图）
  const cache = new Map();
  const imgNum = (buf) => {
    if (cache.has(buf)) return cache.get(buf);
    let dict, stream;
    if (isPng(buf)) {
      const { width, height, rgb } = decodePng(buf);
      stream = zlib.deflateSync(rgb, { level: 6 });
      dict = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${stream.length} >>`;
    } else if (isJpeg(buf)) {
      const { width, height, components } = jpegHeader(buf);
      stream = buf;
      dict = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${stream.length} >>`;
    } else {
      throw new Error('只支持 PNG / JPEG 图片');
    }
    const n = alloc({ dict, stream });
    cache.set(buf, n);
    return n;
  };

  const pageNums = [];
  const pageW = num(size[0]);
  const pageH = num(size[1]);
  for (const p of pages) {
    const xobjs = [];
    let cs = '';
    (p.images || []).forEach((im, i) => {
      const n = imgNum(im.buf);
      const name = 'Im' + i;
      xobjs.push(`/${name} ${n} 0 R`);
      cs += `q\n${num(im.w)} 0 0 ${num(im.h)} ${num(im.x)} ${num(im.y)} cm\n/${name} Do\nQ\n`;
    });
    let hasText = false;
    (p.texts || []).forEach((t) => {
      const sz = t.size || 9;
      const wid = String(t.text).length * sz * 0.5;
      const x = t.align === 'right' ? t.x - wid : t.x;
      hasText = true;
      cs += `BT /F1 ${num(sz)} Tf ${t.color || '0.45 0.45 0.45'} rg ${num(x)} ${num(t.y)} Td (${escapeText(t.text)}) Tj ET\n`;
    });
    const csBuf = Buffer.from(cs, 'latin1');
    const contentNum = alloc({ dict: `<< /Length ${csBuf.length} >>`, stream: csBuf });
    const pw = num(p.w || size[0]);
    const ph = num(p.h || size[1]);
    const pageNum = alloc({
      dict: `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pw} ${ph}]`
        + ` /Resources << /XObject << ${xobjs.join(' ')} >>${hasText ? ` /Font << /F1 ${fontNum} 0 R >>` : ''} >>`
        + ` /Contents ${contentNum} 0 R >>`,
    });
    pageNums.push(pageNum);
  }

  objects[catalogNum - 1] = { dict: `<< /Type /Catalog /Pages ${pagesNum} 0 R >>` };
  objects[pagesNum - 1] = { dict: `<< /Type /Pages /Kids [${pageNums.map((n) => n + ' 0 R').join(' ')}] /Count ${pageNums.length} >>` };

  const parts = [];
  let offset = 0;
  const push = (b) => { parts.push(b); offset += b.length; };
  push(Buffer.from(`%PDF-1.4\n%${String.fromCharCode(0xe2, 0xe3, 0xcf, 0xd3)}\n`, 'latin1'));
  const offsets = [];
  objects.forEach((o, i) => {
    offsets[i] = offset;
    push(Buffer.from(`${i + 1} 0 obj\n${o.dict}\n`, 'latin1'));
    if (o.stream) {
      push(Buffer.from('stream\n', 'latin1'));
      push(o.stream);
      push(Buffer.from('\nendstream\n', 'latin1'));
    }
    push(Buffer.from('endobj\n', 'latin1'));
  });
  const xrefOff = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;
  push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
}

module.exports = { build, decodePng, pngHeader, jpegHeader, imageInfo, isPng, isJpeg };
