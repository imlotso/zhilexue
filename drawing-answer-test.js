'use strict';
const assert = require('assert');
const zlib = require('zlib');
const { decodeDrawing, MAX_BYTES } = require('./src/drawing-answer');
function crc32(buf) { let n = 0xffffffff; for (const byte of buf) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)); } return (n ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([header, data, crc]); }
function sample(width = 2, height = 2) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(height * (1 + 4 * width));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const encode = (b) => 'data:image/png;base64,' + b.toString('base64');
assert(decodeDrawing(encode(sample())).equals(sample()));
assert.throws(() => decodeDrawing('https://example.com/picture.png'), /仅支持/);
assert.throws(() => decodeDrawing('data:image/svg+xml;base64,PHN2Zz4='), /仅支持/);
assert.throws(() => decodeDrawing(encode(sample(1601, 1))), /尺寸/);
assert.throws(() => decodeDrawing(encode(Buffer.concat([sample(), Buffer.from('tail')]))), /不正确/);
const corrupted = sample(); corrupted[corrupted.length - 1] ^= 1;
assert.throws(() => decodeDrawing(encode(corrupted)), /校验/);
assert.throws(() => decodeDrawing('data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_BYTES / 3) * 4 + 4)), /大小/);
console.log('作图 PNG 类型、尺寸、内容和大小边界验证通过');
