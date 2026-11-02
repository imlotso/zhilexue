'use strict';
/** 实拍图 → 扫描图：去阴影、拉成白底黑字，只用于发给视觉模型，不改已保存的原图。 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PS1 = path.join(__dirname, 'scanify.ps1');

function toScanJpeg(buf) {
  const srcBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (srcBuf.length >= 5 && srcBuf.slice(0, 5).toString() === '%PDF') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
    const src = path.join(dir, 'in.bin');
    const dst = path.join(dir, 'out.jpg');
    fs.writeFileSync(src, srcBuf);
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', PS1, '-Src', src, '-Dst', dst,
    ], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('error', (e) => {
      fs.rmSync(dir, { recursive: true, force: true });
      reject(e);
    });
    ps.on('close', (code) => {
      try {
        if (code !== 0 || !fs.existsSync(dst)) {
          reject(new Error((err || '扫描图处理失败').slice(0, 300)));
          return;
        }
        resolve(fs.readFileSync(dst));
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { toScanJpeg };
