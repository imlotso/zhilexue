"use strict";
/**
 * 零依赖 ZIP 读取（Node 标准库 zlib）。
 * 支持 method 0 (stored) 与 8 (deflate)；读取中央目录，按需解压单个条目。
 * 仅用于「读取素材包」——写包一律交给 question-import-tool.cjs 的 pack。
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * @param {Buffer} buf 完整 zip 字节
 * @returns {{entries: Array<{name:string, method:number, compSize:number, uncompSize:number, localOffset:number, flags:number}>}}
 */
function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("不是有效的 ZIP：未找到 EOCD 记录");
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdCount = buf.readUInt16LE(eocd + 10);

  // ZIP64：EOCD 字段为哨兵值时，到 ZIP64 EOCD 定位器取真值
  if (cdOffset === 0xffffffff || cdCount === 0xffff) {
    for (let i = eocd - 20; i >= 0; i -= 1) {
      if (buf.readUInt32LE(i) === SIG_EOCD64) {
        cdCount = Number(buf.readBigUInt64LE(i + 32));
        cdOffset = Number(buf.readBigUInt64LE(i + 48));
        break;
      }
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount && p + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(p) !== SIG_CEN) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    // UTF-8 标志位（bit 11）优先；否则按 UTF-8 解（中文包绝大多数如此），失败退回 latin1
    let name;
    if (flags & 0x800) {
      name = nameBytes.toString("utf8");
    } else {
      name = nameBytes.toString("utf8");
      if (name.includes("\uFFFD")) name = nameBytes.toString("latin1");
    }

    // ZIP64 扩展字段：补全 0xFFFFFFFF 的尺寸/偏移
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const hid = buf.readUInt16LE(e);
        const hsz = buf.readUInt16LE(e + 2);
        if (hid === 0x0001) {
          let q = e + 4;
          if (uncompSize === 0xffffffff) { uncompSize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
          break;
        }
        e += 4 + hsz;
      }
    }

    entries.push({ name, method, compSize, uncompSize, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries };
}

function readEntryData(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== SIG_LOC) throw new Error(`条目本地头签名异常：${entry.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

class ZipReader {
  constructor(buf) {
    this.buf = buf;
    const { entries } = readCentralDirectory(buf);
    this.entries = entries;
    this.index = new Map(entries.map((e) => [e.name, e]));
  }
  static fromFile(file) {
    return new ZipReader(fs.readFileSync(file));
  }
  has(name) {
    return this.index.has(name);
  }
  list(prefix) {
    return this.entries
      .map((e) => e.name)
      .filter((n) => !n.endsWith("/") && (!prefix || n.startsWith(prefix)));
  }
  read(name) {
    const e = this.index.get(name);
    if (!e) throw new Error(`ZIP 内不存在：${name}`);
    return readEntryData(this.buf, e);
  }
  readOptional(name) {
    return this.has(name) ? this.read(name) : null;
  }
}

module.exports = { ZipReader, readCentralDirectory, readEntryData };
