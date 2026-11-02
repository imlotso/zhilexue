/* ============================================================
 * xlsx.js —— 零依赖 XLSX 生成器
 * 直接构造 OOXML 包（STORE 方式打包 ZIP），输出 .xlsx Blob
 * 用途：在无网络 / 无 CDN 环境下导出 Excel，避免引入第三方库
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) { return new TextEncoder().encode(str); }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /* ---------- ZIP 打包（无压缩，STORE） ---------- */
  function zip(files) {
    var locals = [], central = [], offset = 0, dt = dosDateTime(new Date());

    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, crc = crc32(data);

      var lh = new Uint8Array(30 + name.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);   // local file header signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0x0800, true);        // general purpose: UTF-8 文件名
      lv.setUint16(8, 0, true);             // method: store
      lv.setUint16(10, dt.time, true);
      lv.setUint16(12, dt.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);  // compressed size
      lv.setUint32(22, data.length, true);  // uncompressed size
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);            // extra len
      lh.set(name, 30);

      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);    // central directory signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dt.time, true);
      cv.setUint16(14, dt.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);            // extra
      cv.setUint16(32, 0, true);            // comment
      cv.setUint16(34, 0, true);            // disk number start
      cv.setUint16(36, 0, true);            // internal attrs
      cv.setUint32(38, 0, true);            // external attrs
      cv.setUint32(42, offset, true);       // relative offset of local header
      ch.set(name, 46);

      locals.push(lh, data);
      central.push(ch);
      offset += lh.length + data.length;
    });

    var centralSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(locals.concat(central, [eocd]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ---------- XML ---------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colName(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

  var CT = XML_HEAD +
    '<Types xmlns="' + NS_CT + '">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  var ROOT_RELS = XML_HEAD +
    '<Relationships xmlns="' + NS_PKG_REL + '">' +
    '<Relationship Id="rId1" Type="' + NS_DOC_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WORKBOOK = XML_HEAD +
    '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_DOC_REL + '">' +
    '<sheets><sheet name="__NAME__" sheetId="1" r:id="rId1"/></sheets></workbook>';

  var WB_RELS = XML_HEAD +
    '<Relationships xmlns="' + NS_PKG_REL + '">' +
    '<Relationship Id="rId1" Type="' + NS_DOC_REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="' + NS_DOC_REL + '/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var STYLES = XML_HEAD +
    '<styleSheet xmlns="' + NS_MAIN + '">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFB"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildSheet(rows, widths) {
    var out = [XML_HEAD, '<worksheet xmlns="' + NS_MAIN + '">'];

    if (widths && widths.length) {
      out.push('<cols>');
      widths.forEach(function (w, i) {
        out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>');
      });
      out.push('</cols>');
    }

    out.push('<sheetData>');
    rows.forEach(function (row, ri) {
      out.push('<row r="' + (ri + 1) + '">');
      row.forEach(function (cell, ci) {
        var ref = colName(ci) + (ri + 1);
        var style = ri === 0 ? ' s="1"' : '';
        if (typeof cell === 'number' && isFinite(cell)) {
          out.push('<c r="' + ref + '"' + style + '><v>' + cell + '</v></c>');
        } else {
          out.push('<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
            esc(cell) + '</t></is></c>');
        }
      });
      out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    return utf8(out.join(''));
  }

  /**
   * 生成 XLSX 文件 Blob
   * @param {string} sheetName 工作表名称
   * @param {Array<Array>} rows 二维数组，第一行作为表头
   * @param {number[]} widths 列宽（字符数）
   */
  function build(sheetName, rows, widths) {
    var safeName = String(sheetName || 'Sheet1').replace(/[\\\/:\[\]?*]/g, '_').slice(0, 28);
    return zip([
      { name: '[Content_Types].xml', data: utf8(CT) },
      { name: '_rels/.rels', data: utf8(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: utf8(WORKBOOK.replace('__NAME__', esc(safeName))) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(WB_RELS) },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: buildSheet(rows, widths) }
    ]);
  }

  global.XlsxWriter = { build: build };
})(window);
