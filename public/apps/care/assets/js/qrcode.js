/* ============================================================
 * qrcode.js —— 零依赖二维码生成器（QR Model 2 / byte 模式）
 *   支持版本 1~6、纠错级别 M，可覆盖 http://192.168.x.x:5173/record?sid=xxx 长度的 URL
 *   输出 0/1 矩阵，由调用方渲染为 canvas / SVG / 图片
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- GF(256) ---------------- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) { return (a && b) ? EXP[LOG[a] + LOG[b]] : 0; }

  /* ---------------- 版本参数表（纠错级别 M） ----------------
   * [总码字数, 纠错码字/块, 块数, 对齐图案坐标]
   */
  var SPEC = {
    1: { total: 26, ecPerBlock: 10, blocks: 1, align: [] },
    2: { total: 44, ecPerBlock: 16, blocks: 1, align: [6, 18] },
    3: { total: 70, ecPerBlock: 26, blocks: 1, align: [6, 22] },
    4: { total: 100, ecPerBlock: 18, blocks: 2, align: [6, 26] },
    5: { total: 134, ecPerBlock: 24, blocks: 2, align: [6, 30] },
    6: { total: 172, ecPerBlock: 16, blocks: 4, align: [6, 34] }
  };
  var ECL_M = 0x00; // 纠错级别 M 的 2bit 编码

  /* ---------------- Reed-Solomon ---------------- */
  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) ng[k] = 0;
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    var gen = genPoly(ecLen);
    var buf = new Array(data.length + ecLen);
    var i, j;
    for (i = 0; i < data.length; i++) buf[i] = data[i];
    for (i = ecLen - 1; i >= 0; i--) buf[data.length + i] = 0;
    for (i = 0; i < data.length; i++) {
      var coef = buf[i];
      if (coef === 0) continue;
      for (j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], coef);
    }
    return buf.slice(data.length);
  }

  /* ---------------- 数据编码 ---------------- */
  function toBytes(str) {
    var utf = unescape(encodeURIComponent(str)); // 兼容 UTF-8 多字节
    var out = [];
    for (var i = 0; i < utf.length; i++) out.push(utf.charCodeAt(i) & 0xFF);
    return out;
  }

  function pickVersion(byteLen) {
    // 版本 1~9：字符计数占 8 bit；数据容量 = total - ecPerBlock*blocks
    for (var v = 1; v <= 6; v++) {
      var s = SPEC[v];
      var cap = s.total - s.ecPerBlock * s.blocks;
      if (byteLen + 2 <= cap) return v; // 模式指示符 4bit + 长度 8bit + 终止符
    }
    return 6;
  }

  function buildCodewords(bytes, version) {
    var s = SPEC[version];
    var capBits = (s.total - s.ecPerBlock * s.blocks) * 8;
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    push(0x4, 4);              // byte mode
    push(bytes.length, 8);     // 版本 1~9 的字符计数长度
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    // 终止符 + 补齐到字节边界
    var term = Math.min(4, capBits - bits.length);
    push(0, term);
    while (bits.length % 8 !== 0) bits.push(0);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      data.push(v);
    }
    // 填充字节 EC / 11
    var pads = [0xEC, 0x11], p = 0;
    while (data.length < s.total - s.ecPerBlock * s.blocks) data.push(pads[p++ % 2]);

    /* --- 分块 --- */
    var numBlocks = s.blocks;
    var dataTotal = s.total - s.ecPerBlock * numBlocks;
    var shortLen = Math.floor(dataTotal / numBlocks);
    var longCount = dataTotal % numBlocks;

    var dBlocks = [], eBlocks = [], pos = 0, bi;
    for (bi = 0; bi < numBlocks; bi++) {
      var len = shortLen + (bi >= numBlocks - longCount ? 1 : 0);
      var blk = data.slice(pos, pos + len);
      pos += len;
      dBlocks.push(blk);
      eBlocks.push(rsEncode(blk, s.ecPerBlock));
    }

    /* --- 交织 --- */
    var out = [], maxData = Math.max.apply(null, dBlocks.map(function (b) { return b.length; }));
    for (var i2 = 0; i2 < maxData; i2++) {
      for (bi = 0; bi < numBlocks; bi++) if (i2 < dBlocks[bi].length) out.push(dBlocks[bi][i2]);
    }
    for (var i3 = 0; i3 < s.ecPerBlock; i3++) {
      for (bi = 0; bi < numBlocks; bi++) out.push(eBlocks[bi][i3]);
    }
    return out;
  }

  /* ---------------- 矩阵构建 ---------------- */
  function buildMatrix(bytes, version, opt) {
    var s = SPEC[version];
    var size = version * 4 + 17;
    var mods = [], fn = [], r, c;
    for (r = 0; r < size; r++) {
      mods.push(new Array(size).fill(0));
      fn.push(new Array(size).fill(false));
    }

    function setFn(row, col, val) {
      modules(row, col, val);
      fn[row][col] = true;
    }
    function modules(row, col, val) { mods[row][col] = val ? 1 : 0; }

    /* 定时图案（先绘制，随后由定位图案覆盖重叠部分） */
    for (var i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    /* 定位图案 + 分隔符：中心 3x3 与外环（距离 3）为深色 */
    function finder(row, col) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var y = row + dy, x = col + dx;
          if (y < 0 || y >= size || x < 0 || x >= size) continue;
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(y, x, d <= 1 || d === 3);
        }
      }
    }
    finder(3, 3);
    finder(3, size - 4);
    finder(size - 4, 3);

    /* 对齐图案 */
    if (s.align.length) {
      var coords = s.align;
      for (var a = 0; a < coords.length; a++) {
        for (var b = 0; b < coords.length; b++) {
          var ay = coords[a], ax = coords[b];
          if ((ay === 6 && ax === 6) || (ay === 6 && ax === coords[coords.length - 1]) ||
            (ay === coords[coords.length - 1] && ax === 6)) continue;
          for (var dy2 = -2; dy2 <= 2; dy2++) {
            for (var dx2 = -2; dx2 <= 2; dx2++) {
              var dd = Math.max(Math.abs(dx2), Math.abs(dy2));
              setFn(ay + dy2, ax + dx2, dd !== 1);
            }
          }
        }
      }
    }

    /* 预留格式信息区域（索引 6 是定时图案，必须跳过） */
    for (var f = 0; f <= 8; f++) {
      if (f === 6) continue;
      setFn(8, f, false);
      setFn(f, 8, false);
    }
    for (var g = 0; g < 8; g++) {
      setFn(8, size - 1 - g, false);
      setFn(size - 1 - g, 8, false);
    }

    /* 数据放置 */
    var codewords = buildCodewords(bytes, version);
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    function nextBit() {
      if (bitIdx >= totalBits) return 0;
      var v = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return v;
    }
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j2 = 0; j2 < 2; j2++) {
          var x2 = right - j2;
          var upward = ((right + 1) & 2) === 0;
          var y2 = upward ? size - 1 - vert : vert;
          if (!fn[y2][x2] && bitIdx < totalBits) modules(y2, x2, nextBit());
        }
      }
    }

    /* 掩码：指定 mask 时直接返回，否则按惩罚分择优 */
    var force = (opt && typeof opt.mask === 'number') ? opt.mask : -1;
    if (force >= 0) {
      var fixed = applyMask(mods, fn, size, force);
      drawFormat(fixed, fn, size, force);
      return fixed;
    }
    var best = null, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      var masked = applyMask(mods, fn, size, m);
      drawFormat(masked, fn, size, m);
      var score = penalty(masked, size);
      if (score < bestScore) { bestScore = score; best = masked; }
    }
    return best;
  }

  function maskBit(m, y, x) { // y=row, x=col
    switch (m) {
      case 0: return (y + x) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (y + x) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return (y * x) % 2 + (y * x) % 3 === 0;
      case 6: return ((y * x) % 2 + (y * x) % 3) % 2 === 0;
      default: return ((y + x) % 2 + (y * x) % 3) % 2 === 0;
    }
  }

  function applyMask(mods, fn, size, m) {
    var out = [];
    for (var y = 0; y < size; y++) {
      out.push(mods[y].slice());
      for (var x = 0; x < size; x++) {
        if (!fn[y][x] && maskBit(m, y, x)) out[y][x] ^= 1;
      }
    }
    return out;
  }

  function formatBits(mask) {
    var data = (ECL_M << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (((data << 10) | rem) ^ 0x5412) & 0x7FFF;
  }

  function drawFormat(mat, fn, size, mask) {
    var bits = formatBits(mask);
    function bit(i) { return (bits >>> i) & 1; }
    var i2;
    // 第一份
    for (i2 = 0; i2 <= 5; i2++) mat[i2][8] = bit(i2);
    mat[7][8] = bit(6);
    mat[8][8] = bit(7);
    mat[8][7] = bit(8);
    for (i2 = 9; i2 < 15; i2++) mat[8][14 - i2] = bit(i2);
    // 第二份
    for (i2 = 0; i2 < 8; i2++) mat[8][size - 1 - i2] = bit(i2);
    for (i2 = 8; i2 < 15; i2++) mat[size - 15 + i2][8] = bit(i2);
    // 恒黑模块
    mat[size - 8][8] = 1;
  }

  function penalty(mat, size) {
    var score = 0, y, x, run, i;

    // 规则 1：连续同色 >= 5
    for (y = 0; y < size; y++) {
      run = 1;
      for (x = 1; x < size; x++) {
        if (mat[y][x] === mat[y][x - 1]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (x = 0; x < size; x++) {
      run = 1;
      for (y = 1; y < size; y++) {
        if (mat[y][x] === mat[y - 1][x]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // 规则 2：2x2 同色块
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var v = mat[y][x];
        if (v === mat[y][x + 1] && v === mat[y + 1][x] && v === mat[y + 1][x + 1]) score += 3;
      }
    }

    // 规则 3：近似 1:1:3:1:1 模式
    for (y = 0; y < size; y++) {
      for (x = 0; x < size - 6; x++) {
        var p = mat[y][x] + mat[y][x + 1] * 2 + mat[y][x + 2] * 4 + mat[y][x + 3] * 8 +
          mat[y][x + 4] * 4 + mat[y][x + 5] * 2 + mat[y][x + 6];
        if (mat[y][x] === 1 && (p === 0x1D || p === 0x5B || p === 0x5D)) score += 40;
      }
    }

    // 规则 4：深色比例偏离 50%
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += mat[y][x];
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ---------------- 对外接口 ---------------- */
  /**
   * @param {string} text 待编码内容
   * @param {object=} opt  { mask: 0~7 } 指定掩码，用于与标准实现做一致性比对（生产环境无需传）
   */
  function matrix(text, opt) {
    var bytes = toBytes(String(text));
    var version = pickVersion(bytes.length);
    return buildMatrix(bytes, version, opt || {});
  }

  function toSvg(text, opt) {
    opt = opt || {};
    var m = matrix(text);
    var n = m.length;
    var scale = opt.scale || 6;
    var quiet = opt.quiet == null ? 4 : opt.quiet;
    var dim = (n + quiet * 2) * scale;
    var rects = '';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (m[y][x]) {
          rects += '<rect x="' + ((x + quiet) * scale) + '" y="' + ((y + quiet) * scale) +
            '" width="' + scale + '" height="' + scale + '"/>';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<g fill="' + (opt.dark || '#111827') + '">' + rects + '</g></svg>';
  }

  /** 渲染到 canvas（若调用方提供 canvas，否则返回离屏 canvas） */
  function toCanvas(text, canvas, opt) {
    opt = opt || {};
    var m = matrix(text);
    var n = m.length;
    var scale = opt.scale || 6;
    var quiet = opt.quiet == null ? 4 : opt.quiet;
    var dim = (n + quiet * 2) * scale;
    var cv = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!cv) return null;
    cv.width = dim;
    cv.height = dim;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opt.dark || '#111827';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (m[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return cv;
  }

  return { matrix: matrix, toSvg: toSvg, toCanvas: toCanvas };
});
