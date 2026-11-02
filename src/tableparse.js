/* 表格解析（零依赖）：上传的单词表支持 .csv / .xlsx
 *
 * - CSV：自动识别分隔符（逗号 / 制表符 / 分号），带引号转义；编码 UTF-8 优先，
 *   检测到乱码特征时回退 GBK（Node 自带 full-icu）。
 * - XLSX：本质是 ZIP。这里手写了一个最小 ZIP 读取器（只支持 deflate/stored，
 *   覆盖 Excel/WPS 另存的普通文件），再解析 sharedStrings + 第一个工作表。
 *
 * 统一输出：string[][]（二维表，第一行通常是表头）。
 */
const zlib = require('zlib');

const MAX_ROWS = 5000;   // 单次上传上限（防止误传超大文件拖库）
const MAX_CELLS = 40;    // 每行最多读取列数（单词表用不了多少列）

/** 二维表 → 对象数组（首行作表头，空表头列丢弃） */
function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return { header: (rows && rows[0]) || [], rows: [] };
  const header = rows[0].map((h) => String(h == null ? '' : h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => String(c == null ? '' : c).trim())) continue; // 整行为空跳过
    const o = {};
    header.forEach((h, idx) => { if (h) o[h] = String(r[idx] == null ? '' : r[idx]).trim(); });
    out.push(o);
  }
  return { header, rows: out };
}

/* ------------------------------------------------------------------ CSV */
function parseCsv(text) {
  // 分隔符：取第一行中 出现次数最多且在允许集合里 的符号
  const firstLine = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
  let delim = ',';
  let best = 0;
  for (const d of [',', '\t', ';', '|']) {
    const n = firstLine.split(d).length - 1;
    if (n > best) { best = n; delim = d; }
  }
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); if (row.some((c) => c !== '')) rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
    if (rows.length > MAX_ROWS) break;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ XLSX：最小 ZIP 读取 */
/** 从 ZIP buffer 中按文件名解出内容（仅 deflate/stored，不支持加密/分卷/Zip64）
 *  wantNames 传 Set 只取指定项，传 null 取全部（工作表名需先读 workbook.xml 才能确定） */
function zipRead(buf, wantNames) {
  // End of Central Directory：签名 0x06054b50，从尾部往前找
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（找不到 ZIP 目录）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory 偏移
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + cmtLen;
    if (wantNames && !wantNames.has(name)) continue;
    if (csize > 6 * 1024 * 1024) continue; // 忽略体积异常项（图片等）
    // local file header
    if (buf.readUInt32LE(lho) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + csize);
    files[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
  }
  return files;
}

function xmlUnescape(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** 解析工作表 XML → 二维表（按 r="A1" 坐标补齐空单元格） */
function parseSheetXml(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    let lastCol = -1;
    while ((c = cellRe.exec(m[1]))) {
      const attrs = c[1];
      const rm = /r="([A-Z]+)(\d+)"/.exec(attrs);
      const col = rm ? colIndex(rm[1]) : lastCol + 1;
      lastCol = col;
      let v = '';
      const vm = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
      const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]);
      const type = /t="([^"]*)"/.exec(attrs);
      if ((type && type[1] === 's') && vm) v = shared[Number(vm[1])] || '';       // 共享字符串
      else if (tm) v = xmlUnescape(tm[1].replace(/<[^>]+>/g, ''));                // 内联字符串
      else if (vm) v = xmlUnescape(vm[1]);                                        // 数字/其它
      cells[col] = v;
    }
    rows.push(cells);
    if (rows.length > MAX_ROWS + 1) break;
  }
  return rows;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXlsx(buf) {
  // 兼容旧接口：返回「内容最多」的那张工作表
  const all = parseXlsxAll(buf);
  let best = null, bestScore = -1;
  for (const rows of all) {
    const score = rows.reduce((n, r) => n + (r || []).filter((c) => String(c == null ? '' : c).trim()).length, 0);
    if (score > bestScore) { bestScore = score; best = rows; }
  }
  if (!best || bestScore <= 0) throw new Error('工作表里没有读到任何内容（表格可能是空的）');
  return best;
}

/** 读 xlsx 里的全部工作表（每个元素是一个二维表），供「一个单元一张工作表」的表格合并导入 */
function parseXlsxAll(buf) {
  const files = zipRead(buf, null);
  const wb = files['xl/workbook.xml'] ? files['xl/workbook.xml'].toString('utf8') : '';
  const shared = parseShared(files);
  const targets = sheetTargets(files, wb);
  if (!targets.length) throw new Error('xlsx 里找不到工作表数据');
  return targets.map((t) => parseSheetXml(files[t].toString('utf8'), shared));
}

/** 共享字符串表：<si> 里可能有多段 <t> */
function parseShared(files) {
  const shared = [];
  if (!files['xl/sharedStrings.xml']) return shared;
  const ss = files['xl/sharedStrings.xml'].toString('utf8');
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let s;
  while ((s = siRe.exec(ss))) {
    const ts = s[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    shared.push(xmlUnescape(ts.map((x) => x.replace(/<[^>]+>/g, '')).join('')));
  }
  return shared;
}

/** 按 workbook.xml + rels 列出全部工作表路径（顺序与 Excel 里一致），最后兜底扫描目录 */
function sheetTargets(files, wb) {
  const rels = files['xl/_rels/workbook.xml.rels'] ? files['xl/_rels/workbook.xml.rels'].toString('utf8') : '';
  const relMap = {};
  let rm;
  const relRe = /<Relationship\b[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*\/?>/g;
  while ((rm = relRe.exec(rels))) relMap[rm[1]] = rm[2];
  const norm = (t) => {
    const s = String(t || '').replace(/^\//, '').replace(/^xl\//, '');
    return s.startsWith('worksheets/') ? 'xl/' + s : (s.includes('/') ? s : 'xl/' + s);
  };
  const out = [];
  const sheetRe = /<sheet\b[^>]*r:id="([^"]*)"[^>]*\/?>/g;
  let sm;
  while ((sm = sheetRe.exec(wb))) {
    const key = norm(relMap[sm[1]]);
    if (files[key] && !out.includes(key)) out.push(key);
  }
  Object.keys(files).forEach((k) => {
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(k) && !out.includes(k)) out.push(k);
  });
  return out;
}

/* ------------------------------------------------------------------ 入口 */
/** buffer → string[][]；kindHint 仅用于报错文案 */
function parseTable(buffer) {
  return parseTableSheets(buffer)[0];
}

/** buffer → string[][][]（xlsx 的多张工作表；csv/txt 只有一张）
 *  同时识别老版 .xls（OLE2）并给出可操作的提示 */
function parseTableSheets(buffer) {
  if (!buffer || !buffer.length) throw new Error('文件为空');
  if (buffer.length > 12 * 1024 * 1024) throw new Error('文件超过 12MB，请拆分后上传');
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return parseXlsxAll(buffer);      // PK：xlsx(zip)
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {                                 // OLE2：老版 .xls
    throw new Error('这是老版 Excel（.xls）格式，请在 Excel / WPS 里「另存为」→ 选「.xlsx」或「CSV」后再上传');
  }
  // 文本：优先 utf8，乱码多则回退 gbk
  let text = buffer.toString('utf8');
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 4) {
    try { text = new TextDecoder('gbk').decode(buffer); } catch (e) { /* 保持 utf8 */ }
  }
  // 去掉 Excel 导出 CSV 常见的 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return [parseCsv(text)];
}

module.exports = { parseTable, parseTableSheets, rowsToObjects, parseCsv, parseXlsx, parseXlsxAll, MAX_ROWS };
