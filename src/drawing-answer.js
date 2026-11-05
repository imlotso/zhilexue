'use strict';

// 接受画布生成的有界 PNG；不接受 URL、SVG、额外尾部数据或无限尺寸图片。
const MAX_BYTES = 384 * 1024;
const zlib = require('zlib');
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function decodeDrawing(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) throw new Error('作图仅支持 PNG 图片');
  const encoded = value.slice('data:image/png;base64,'.length);
  if (!encoded || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('作图图片格式或大小不正确');
  const buf = Buffer.from(encoded, 'base64');
  if (!buf.length || buf.length > MAX_BYTES || buf.toString('base64') !== encoded) throw new Error('作图图片格式或大小不正确');
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  if (buf.length < 45 || !buf.subarray(0, 8).equals(sig)) throw new Error('作图图片不是有效的 PNG');
  let pos = 8, count = 0, gotHeader = false, gotData = false, gotEnd = false, expected = 0;
  const data = [];
  while (pos + 12 <= buf.length && count++ < 1024) {
    const len = buf.readUInt32BE(pos), end = pos + 12 + len;
    if (end > buf.length) throw new Error('作图 PNG 数据不完整');
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('作图 PNG 数据不正确');
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw new Error('作图 PNG 校验失败');
    if (!gotHeader) {
      if (type !== 'IHDR' || len !== 13) throw new Error('作图 PNG 缺少图像信息');
      const width = buf.readUInt32BE(pos + 8), height = buf.readUInt32BE(pos + 12);
      if (!width || !height || width > 1600 || height > 1200 || width * height > 1600000) throw new Error('作图图片尺寸过大');
      const depth = buf[pos + 16], color = buf[pos + 17], compression = buf[pos + 18], filter = buf[pos + 19], interlace = buf[pos + 20];
      if (depth !== 8 || ![2, 6].includes(color) || compression || filter || interlace) throw new Error('请使用画布生成的 PNG 图片');
      expected = height * (1 + width * (color === 6 ? 4 : 3));
      gotHeader = true;
    } else if (type === 'IHDR') throw new Error('作图 PNG 数据不正确');
    if (type === 'IDAT' && len) { gotData = true; data.push(buf.subarray(pos + 8, pos + 8 + len)); }
    if (type === 'IEND') { if (len !== 0 || end !== buf.length) throw new Error('作图 PNG 数据不正确'); gotEnd = true; break; }
    pos = end;
  }
  if (!gotHeader || !gotData || !gotEnd) throw new Error('作图 PNG 数据不完整');
  try { if (zlib.inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }).length !== expected) throw new Error(); }
  catch (_) { throw new Error('作图 PNG 图像数据不正确'); }
  return buf;
}
module.exports = { MAX_BYTES, decodeDrawing };
