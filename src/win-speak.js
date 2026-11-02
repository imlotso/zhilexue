'use strict';
/**
 * 用 Windows 自带语音合成 wav（英文 Microsoft Zira，中文 Microsoft Huihui）。
 * 浏览器里的 speechSynthesis 在这台电脑上没有英文音色，点喇叭不会出声。
 */
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCRIPT = path.join(__dirname, 'win-speak.ps1');
const cache = new Map();
const CACHE_MAX = 300;

let proc = null;
let ready = false;
let busy = false;
const queue = [];

function dropProc() {
  ready = false;
  busy = false;
  const job = proc && proc._job;
  proc = null;
  if (job) job.done('ERR 语音进程已退出');
  while (queue.length) queue.shift().done('ERR 语音进程已退出');
}

function ensure() {
  if (proc) return;
  proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  proc.stderr.on('data', (buf) => {
    const s = String(buf || '').trim();
    if (s) console.error('[speak]', s);
  });
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '').trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      if (line === 'READY') { ready = true; pump(); continue; }
      if (line.startsWith('OK') || line.startsWith('ERR')) {
        const job = proc && proc._job;
        if (proc) proc._job = null;
        busy = false;
        if (job) job.done(line);
        pump();
      }
    }
  });
  proc.on('exit', dropProc);
}

function pump() {
  if (!proc || !ready || busy || !queue.length) return;
  const job = queue.shift();
  busy = true;
  proc._job = job;
  proc.stdin.write(JSON.stringify(job.payload) + '\n', 'utf8');
}

function remember(key, data) {
  cache.set(key, data);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return data;
}

function edgeDate() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + pad(d.getUTCDate()) + ' ' + d.getUTCFullYear()
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
    + ' GMT+0000 (Coordinated Universal Time)';
}
function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** 微软在线女声。英文 Jenny，中文晓晓。服务器时间和微软不一致时，按响应里的 Date 校正后再试。 */
let clockSkew = 0;
/* ---- Sec-MS-GEC v2 令牌算法（微软 2026-10-12 DRM 轮换后新版，移植自 edge-tts 7.3.1，已与官方实现交叉验证）----
 * 旧 v1 算法（普通 SHA256）自 2026-10-12 起被微软拒绝，导致全部回落 espeak 机械音。 */
const GEC_MASK = 0xFFFFFFFFn;
const GEC_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const GEC_SHA256_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19].map(BigInt);
const GEC_SHA256_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2].map(BigInt);
const GEC_SHA256_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564].map(BigInt);
const GEC_SHA256_ROUND = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
].map(BigInt);
const GEC_SHA256_ADJUSTMENT = 0xC9DC06A7n;
const GEC_SHA256_BLOCK = GEC_SHA256_ROUND.slice(0, 14).concat([GEC_SHA256_ADJUSTMENT], GEC_SHA256_ROUND.slice(15));
const GEC_SIGMA0_ADJ = 0x059C0B80n;
const GEC_SIGMA1_ADJ = 0x000B92C0n;
const GEC_CS64_COEFFICIENTS = [
  [0xE82E91B1n, 0xB32700D0n], [0x44DE24C6n, 0x88DFF51Dn], [0x3BEB65BCn, 0x29514038n], [0xC89C5933n, 0xB328CBDFn],
  [0x8D1EC211n, 0xD405B4D5n], [0x314EF5D5n, 0x26E55F3Cn], [0xE92491B1n, 0x607801C6n], [0xF0A5B9D5n, 0x82B2C1FBn],
  [0x06064CF3n, 0xFA51A3DAn], [0xDA79FA60n, 0x207CC464n], [0xBED20560n, 0x3C3C74F3n], [0x89F9C9F8n, 0xD2D14B61n],
  [0x35FA38C6n, 0xBB04A2C1n], [0xCB49E3C6n, 0xC5626167n],
];
const GEC_CS64_FACTOR = 0x82893933n;
const GEC_CS64_ADJ0 = 0xF2F90B1An;
const GEC_CS64_ADJ1 = 0x0B1A0000n;

function gecRol16(v) { v &= GEC_MASK; return ((v << 16n) | (v >> 16n)) & GEC_MASK; }
function gecSigma0(v) { return ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & GEC_MASK; }
function gecSigma1(v) { return ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & GEC_MASK; }
function gecWordsLe4Even(data) {
  const pad = (-data.length % 4 + 4) % 4;
  const padded = pad ? Buffer.concat([data, Buffer.alloc(pad)]) : data;
  if (!padded.length) return [];
  const words = [];
  for (let i = 0; i < padded.length; i += 4) words.push(BigInt(padded.readUInt32LE(i)));
  if (words.length % 2) words.push(0n);
  return words;
}
function gecSha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? GEC_SHA256_BLOCK : GEC_SHA256_ROUND;
  const aligned = Math.min(64, Math.floor((firstRound + 7) / 8) * 8);
  for (let index = firstRound; index < aligned; index++) {
    const rotE = e * 0x100000001n;
    const rotA = a * 0x100000001n;
    const t1 = h + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (g ^ (e & (f ^ g))) + constants[index] + words[index];
    const t2 = ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)));
    [a, b, c, d, e, f, g, h] = [(t1 + t2) & GEC_MASK, a, b, c, (d + t1) & GEC_MASK, e, f, g];
  }
  for (let index = aligned; index < 64; index += 8) {
    let rotE = e * 0x100000001n;
    let rotA = a * 0x100000001n;
    let t1 = h + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (g ^ (e & (f ^ g))) + constants[index] + words[index];
    let t2 = ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((a & b) | (c & (a | b)));
    d = (d + t1) & GEC_MASK;
    h = (t1 + t2) & GEC_MASK;

    rotE = d * 0x100000001n;
    rotA = h * 0x100000001n;
    t1 = g + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (f ^ (d & (e ^ f))) + constants[index + 1] + words[index + 1];
    c = (c + t1) & GEC_MASK;
    g = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((h & a) | (b & (h | a)))) & GEC_MASK;

    rotE = c * 0x100000001n;
    rotA = g * 0x100000001n;
    t1 = f + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (e ^ (c & (d ^ e))) + constants[index + 2] + words[index + 2];
    b = (b + t1) & GEC_MASK;
    f = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((g & h) | (a & (g | h)))) & GEC_MASK;

    rotE = b * 0x100000001n;
    rotA = f * 0x100000001n;
    t1 = e + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (d ^ (b & (c ^ d))) + constants[index + 3] + words[index + 3];
    a = (a + t1) & GEC_MASK;
    e = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((f & g) | (h & (f | g)))) & GEC_MASK;

    rotE = a * 0x100000001n;
    rotA = e * 0x100000001n;
    t1 = d + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (c ^ (a & (b ^ c))) + constants[index + 4] + words[index + 4];
    h = (h + t1) & GEC_MASK;
    d = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((e & f) | (g & (e | f)))) & GEC_MASK;

    rotE = h * 0x100000001n;
    rotA = d * 0x100000001n;
    t1 = c + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (b ^ (h & (a ^ b))) + constants[index + 5] + words[index + 5];
    g = (g + t1) & GEC_MASK;
    c = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((d & e) | (f & (d | e)))) & GEC_MASK;

    rotE = g * 0x100000001n;
    rotA = c * 0x100000001n;
    t1 = b + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (a ^ (g & (h ^ a))) + constants[index + 6] + words[index + 6];
    f = (f + t1) & GEC_MASK;
    b = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((c & d) | (e & (c | d)))) & GEC_MASK;

    rotE = f * 0x100000001n;
    rotA = b * 0x100000001n;
    t1 = a + ((rotE >> 6n) ^ (rotE >> 11n) ^ (rotE >> 25n)) + (h ^ (f & (g ^ h))) + constants[index + 7] + words[index + 7];
    e = (e + t1) & GEC_MASK;
    a = (t1 + ((rotA >> 2n) ^ (rotA >> 13n) ^ (rotA >> 22n)) + ((b & c) | (d & (b | c)))) & GEC_MASK;
  }
  return [a, b, c, d, e, f, g, h];
}
function gecExpandSchedule(words, firstWord = 16) {
  for (let index = firstWord; index < 64; index++) {
    const x = words[index - 2], y = words[index - 15];
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push((s1 + words[index - 7] + s0 + words[index - 16]) & GEC_MASK);
  }
}
function gecSha256Init(data) { /* data: 前 7 字节 */
  const words = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, BigInt(data.readUIntBE(0, 3))];
  words.push(BigInt(data.readUIntBE(3, 4)));
  for (let index = 16; index < 30; index++) {
    let value = GEC_SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      value += (index === 16)
        ? (gecSigma1(words[index - 2]) ^ GEC_SIGMA1_ADJ)
        : gecSigma1(words[index - 2]);
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) {
      value += (index === 29)
        ? (gecSigma0(words[index - 15]) ^ GEC_SIGMA0_ADJ)
        : gecSigma0(words[index - 15]);
    }
    words.push(value & GEC_MASK);
  }
  words.push(
    (gecSigma1(words[28]) + words[23] + gecSigma0(words[15]) + words[14]
      + GEC_SHA256_ADJUSTMENT - GEC_SHA256_ROUND[14]) & GEC_MASK
  );
  gecExpandSchedule(words, 31);
  const working = gecSha256Rounds(GEC_SHA256_STATE, words, 14);
  return GEC_SHA256_INITIAL.map((x, i) => (x + working[i]) & GEC_MASK);
}
function gecSha256Digest(data) {
  if (data.length < 7) return null;
  const length = 57 + data.length;
  const padLen = ((55 - length) % 64 + 64) % 64;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([data.slice(7), Buffer.from([0x80]), Buffer.alloc(padLen), lenBuf]);
  let state = gecSha256Init(data.slice(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) words.push(BigInt(padded.readUInt32BE(offset + i * 4)));
    gecExpandSchedule(words);
    const working = gecSha256Rounds(state, words);
    state = state.map((x, i) => (x + working[i]) & GEC_MASK);
  }
  const out = Buffer.alloc(32);
  state.forEach((w, i) => out.writeUInt32BE(Number(w), i * 4));
  return out;
}
function gecCs64Digest(data, digest) {
  let keyA = BigInt(digest.readUInt32LE(0)) | 1n;
  let keyB = BigInt(digest.readUInt32LE(4)) | 1n;
  const factors = [(keyA * GEC_CS64_FACTOR) & GEC_MASK, (keyB * GEC_CS64_FACTOR) & GEC_MASK];
  const terms = [], offsets = [];
  for (let i = 0; i < 14; i++) {
    terms.push((GEC_CS64_COEFFICIENTS[i][0] * factors[i % 2]) & GEC_MASK);
    offsets.push(GEC_CS64_COEFFICIENTS[i][1]);
  }
  const words = gecWordsLe4Even(Buffer.concat([Buffer.from([0]), data]));
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    let term = word * (index % 2 === 0 ? keyA : keyB);
    let offset = gecRol16(word) * (index % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (index === 0) {
      term += GEC_CS64_ADJ0 * factors[0];
      offset += GEC_CS64_ADJ1;
    }
    terms.push(term & GEC_MASK);
    offsets.push(offset & GEC_MASK);
  }
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index], y = terms[index + 1];
    let t = gecRol16((offsets[index] + x) & GEC_MASK);
    let q = (t * 0x76F50F34n) & GEC_MASK;
    swapAcc += (gecRol16(q) * 0xC3EFEA97n + q) & GEC_MASK;
    t = gecRol16((offsets[index + 1] + y) & GEC_MASK);
    q = (t * 0x1881CE3Cn) & GEC_MASK;
    swapLast = (gecRol16(q) * 0x35BD1EC9n + q) & GEC_MASK;
    swapAcc = (swapAcc + swapLast) & GEC_MASK;
    state = (state * keyA + x) & GEC_MASK;
    state = (gecRol16(state) * 0xCF98B111n) & GEC_MASK;
    state = (gecRol16(state) * 0x87085B9Fn) & GEC_MASK;
    state = (gecRol16(state) * 0x12CEB96Dn) & GEC_MASK;
    state = (gecRol16(state) * 0x257E1D83n) & GEC_MASK;
    acc += state;
    t = (state * keyB + y) & GEC_MASK;
    t = (gecRol16(t) * 0xA27416F5n) & GEC_MASK;
    t = (gecRol16(t) * 0xD38396FFn) & GEC_MASK;
    state = (gecRol16((gecRol16(t) * 0x7C932B89n) & GEC_MASK) * 0xBFA49F69n) & GEC_MASK;
    acc = (acc + state) & GEC_MASK;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}
function secMsGec() {
  let ticks = Date.now() / 1000 + clockSkew;
  ticks += 11644473600;
  ticks -= ticks % 300;
  ticks = ticks * 1e7;
  const str = Math.round(ticks) + GEC_TOKEN;
  const buf = Buffer.from(str, 'ascii');
  const digest = gecSha256Digest(buf);
  if (!digest) return '';
  const cs = gecCs64Digest(buf, digest);
  const cs64Hex = Buffer.alloc(8);
  cs64Hex.writeUInt32LE(Number(cs[0]), 0);
  cs64Hex.writeUInt32LE(Number(cs[1]), 4);
  return cs64Hex.toString('hex').toUpperCase() + '-' + digest.toString('hex').toUpperCase();
}
function edgeSpeak(text, voice, xmlLang, rate, skewTry) {
  let WebSocket;
  try { WebSocket = require('ws'); } catch (e) { return Promise.reject(new Error('缺少 ws')); }
  const pct = Math.max(-40, Math.min(40, Math.round(Number(rate || 0) * 8)));
  const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
  const id = crypto.randomBytes(16).toString('hex');
  const gec = secMsGec();
  const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'
    + '&Sec-MS-GEC=' + gec + '&Sec-MS-GEC-Version=2-143.0.3650.75&ConnectionId=' + id;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';',
      },
    });
    const chunks = [];
    let skewAdjusted = false;
    const timer = setTimeout(() => { try { ws.close(); } catch (e) { /* 忽略 */ } reject(new Error('朗读超时')); }, 20000);
    const fail = (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); };
    ws.on('unexpected-response', (_req, res) => {
      const server = Date.parse(res.headers && res.headers.date);
      if (!skewTry && Number.isFinite(server)) {
        clockSkew += (server - Date.now()) / 1000;
        skewAdjusted = true;
      }
      console.error('[speak] edge 握手被拒绝 HTTP', res.statusCode);
      if (res.statusCode === 429) edgeCooldownUntil = Date.now() + 5000;  // 限流：全局冷却 5 秒
      res.resume();
      try { _req.destroy(); } catch (e) { /* 忽略 */ }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      if (skewAdjusted) {
        edgeSpeak(text, voice, xmlLang, rate, true).then(resolve, reject);
        return;
      }
      fail(e);
    });
    ws.on('open', () => {
      const now = edgeDate();
      ws.send('X-Timestamp:' + now + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + xmlLang + "'><voice name='"
        + voice + "'><prosody pitch='+0Hz' rate='"
        + rateStr + "' volume='+0%'>" + xmlEsc(text) + '</prosody></voice></speak>';
      ws.send('X-RequestId:' + id + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + now + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
    });
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const head = buf.slice(0, 12).toString('utf8');
      if (buf.length > 2 && head.indexOf('Path:') !== 0 && head.indexOf('X-') !== 0) {
        const headLen = buf.readUInt16BE(0);
        if (headLen > 0 && headLen < buf.length - 2) {
          const headers = buf.slice(2, 2 + headLen).toString('utf8');
          if (headers.indexOf('Path:audio') >= 0) chunks.push(buf.slice(2 + headLen));
        }
        return;
      }
      const s = buf.toString('utf8');
      if (s.indexOf('Path:turn.end') >= 0) {
        clearTimeout(timer);
        try { ws.close(); } catch (e) { /* 忽略 */ }
        const audio = Buffer.concat(chunks);
        if (audio.length < 44) fail(new Error('空音频'));
        else resolve(audio);
      }
    });
  });
}

/* ---------------- 句子语音磁盘缓存 + 限流退避（方案A 2026-10-23） ----------------
 * 合成成功的 mp3 按文本 md5 落盘 /opt/xuexi/tts-cache，服务重启不丢；
 * 命中缓存直接回文件、不再请求微软，从根本上避免 HTTP 429 限流与 espeak 机器人音。
 * 缓存总大小封顶 2GB，超限后台按最旧优先淘汰（LRU）。 */
const DISK_DIR = '/opt/xuexi/tts-cache';
const DISK_CAP = 2 * 1024 * 1024 * 1024;   // 2GB 封顶
const diskStat = { files: new Map(), bytes: 0 };   // name -> {size, mtime}
let diskReady = false;

function diskInit() {
  if (diskReady) return;
  diskReady = true;
  try {
    fs.mkdirSync(DISK_DIR, { recursive: true });
    for (const f of fs.readdirSync(DISK_DIR)) {
      if (!f.endsWith('.mp3')) continue;
      try {
        const st = fs.statSync(path.join(DISK_DIR, f));
        diskStat.files.set(f, { size: st.size, mtime: st.mtimeMs });
        diskStat.bytes += st.size;
      } catch (e) { /* 文件刚好被删 */ }
    }
    console.log('[speak] 磁盘缓存就绪', diskStat.files.size, '个文件', Math.round(diskStat.bytes / 1048576), 'MB');
  } catch (e) {
    console.error('[speak] 磁盘缓存目录不可用', (e && e.message) || e);
  }
}

function diskName(key) { return crypto.createHash('md5').update(key).digest('hex') + '.mp3'; }

function diskGet(key) {
  diskInit();
  if (!diskReady) return null;
  const name = diskName(key);
  if (!diskStat.files.has(name)) return null;
  try {
    const data = fs.readFileSync(path.join(DISK_DIR, name));
    if (data.length > 2 && (data[0] === 0x49 || (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0))) {
      diskStat.files.get(name).mtime = Date.now();   // 触碰时间供 LRU
      return data;
    }
    diskRemove(name);   // 内容坏了当没有
  } catch (e) {
    diskStat.files.delete(name);
  }
  return null;
}

function diskPut(key, data) {
  diskInit();
  if (!diskReady || !data || data.length < 44 || data.length > 5 * 1048576) return;
  const name = diskName(key);
  if (diskStat.files.has(name)) return;
  const tmp = path.join(DISK_DIR, '.' + name + '.' + crypto.randomBytes(4).toString('hex'));
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, path.join(DISK_DIR, name));   // 原子落盘，避免半截文件
    diskStat.files.set(name, { size: data.length, mtime: Date.now() });
    diskStat.bytes += data.length;
    if (diskStat.bytes > DISK_CAP) setImmediate(diskEvict);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
  }
}

function diskRemove(name) {
  try { fs.unlinkSync(path.join(DISK_DIR, name)); } catch (e) { /* 忽略 */ }
  const info = diskStat.files.get(name);
  if (info) { diskStat.bytes -= info.size; diskStat.files.delete(name); }
}

function diskEvict() {
  const names = [...diskStat.files.entries()].sort((a, b) => a[1].mtime - b[1].mtime);
  for (const [name] of names) {
    if (diskStat.bytes <= DISK_CAP * 0.9) break;
    diskRemove(name);
  }
}

/** 微软在线女声。英文 Jenny，中文晓晓。失败再试；429 限流全局冷却 5 秒，错峰重试。 */
let edgeCooldownUntil = 0;   // 最近一次 429 后的全局冷却截止
const inflight = new Map();  // 同文本并发去重：一句话只发一个合成请求

function linuxSpeak(text, lang, rate) {
  const key = lang + '\n' + rate + '\n' + text;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const hit = diskGet(key);
  if (hit) { cache.set(key, hit); return Promise.resolve(hit); }
  const waiting = inflight.get(key);
  if (waiting) return waiting;
  const zh = /^zh/i.test(lang);
  const voice = zh ? 'zh-CN-XiaoxiaoNeural' : 'en-US-JennyNeural';
  const xmlLang = zh ? 'zh-CN' : 'en-US';
  const tryEdge = (left) => {
    const wait = Math.max(0, edgeCooldownUntil - Date.now());
    const go = () => edgeSpeak(text, voice, xmlLang, rate).then((data) => {
      remember(key, data);
      diskPut(key, data);          // 落盘：重启后依然命中，不再请求微软
      return data;
    }).catch((e) => {
      if (left > 1) return tryEdge(left - 1);   // 立刻重试（冷却由 wait 承担）
      console.error('[speak] 微软女声失败', (e && e.message) || e);
      return espeak(text, lang, rate);          // 机械音不进缓存，下次还会再要女声
    });
    if (wait > 0) return new Promise((res) => setTimeout(res, wait)).then(go);
    return go();
  };
  const job = tryEdge(3).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
function espeak(text, lang, rate) {
  const bin = fs.existsSync('/usr/bin/espeak-ng') ? 'espeak-ng' : 'espeak';
  const speed = Math.max(80, Math.min(280, Math.round(160 + Number(rate || 0) * 15)));
  const voices = /^zh/i.test(lang) ? ['zh+f3', 'cmn+f3'] : ['en-us+f3', 'en+f3'];
  const out = path.join(os.tmpdir(), 'zx-spk-' + crypto.randomBytes(8).toString('hex') + '.wav');
  const tryVoice = (i) => new Promise((resolve, reject) => {
    execFile(bin, ['-v', voices[i], '-s', String(speed), '-w', out, text], { timeout: 20000 }, (err) => {
      if (err) {
        if (i + 1 < voices.length) return resolve(tryVoice(i + 1));
        return reject(err);
      }
      try {
        const data = fs.readFileSync(out);
        try { fs.unlinkSync(out); } catch (e) { /* 忽略 */ }
        if (!data || data.length < 44) return reject(new Error('空音频'));
        resolve(data);
      } catch (e) {
        reject(e);
      }
    });
  });
  return tryVoice(0);
}

function speakToBuffer(text, lang, rate) {
  if (process.platform !== 'win32') return linuxSpeak(text, lang, rate);
  const key = lang + '\n' + rate + '\n' + text;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  ensure();
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), 'zx-spk-' + crypto.randomBytes(8).toString('hex') + '.wav');
    const timer = setTimeout(() => {
      try { fs.unlinkSync(out); } catch (e) { /* 还没生成 */ }
      reject(new Error('朗读超时'));
    }, 20000);
    queue.push({
      payload: { text, lang, rate, out },
      done(line) {
        clearTimeout(timer);
        if (!String(line).startsWith('OK')) {
          try { fs.unlinkSync(out); } catch (e) { /* 忽略 */ }
          reject(new Error(String(line).replace(/^ERR\s*/, '') || '朗读失败'));
          return;
        }
        try {
          const data = fs.readFileSync(out);
          try { fs.unlinkSync(out); } catch (e) { /* 忽略 */ }
          if (!data || data.length < 44) throw new Error('空音频');
          cache.set(key, data);
          while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      },
    });
    pump();
  });
}

module.exports = { speakToBuffer };
