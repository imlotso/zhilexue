// 后台视频上传共用：上传前检测视频编码（原在 phonics.js，T1 抽出来给后台所有视频上传用）。
// 先于 admin.js / phonics.js 加载。检测失败（老浏览器等）不阻塞上传，只有确认是 H.265 才抛错。
/** 视频编码检测：H.265/HEVC 在网页播放器里黑屏只有声音，上传前拦下（读头尾 2MB 搜 hev1/hvc1 标记） */
async function checkVideoCodec(file) {
  try {
    const read = async (start, end) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result || []));
      fr.onerror = () => res(new Uint8Array(0));
      fr.readAsArrayBuffer(file.slice(start, end));
    });
    const size = file.size || 0;
    const head = await read(0, Math.min(size, 2097152));
    const tail = size > 2097152 ? await read(Math.max(0, size - 2097152), size) : new Uint8Array(0);
    const has = (tag) => {
      const t = [...tag].map((c) => c.charCodeAt(0));
      for (const buf of [head, tail]) {
        outer: for (let i = 0; i <= buf.length - t.length; i++) {
          for (let j = 0; j < t.length; j++) if (buf[i + j] !== t[j]) continue outer;
          return true;
        }
      }
      return false;
    };
    if (has('hev1') || has('hvc1')) {
      throw new Error('该视频是 H.265/HEVC 编码，网页播放器不支持（会黑屏只有声音）。请用剪映 / 格式工厂导出为「H.264 编码的 MP4」后再上传');
    }
  } catch (e) {
    if (e && e.message && e.message.indexOf('H.265') >= 0) throw e;
    /* 检测失败不阻塞上传（老浏览器无 FileReader 等） */
  }
}
