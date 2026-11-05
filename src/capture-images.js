'use strict';
const { createDownloader } = require('./remote-image');
const download = createDownloader();
const MAX_UNIQUE = 20;
const CONCURRENCY = 4;
// 仅复用本系统生成的题图库图片 key，并去掉旧票据；不将任意本地路径作为题图。
function existingBankImage(value, folder) {
  if (typeof value !== 'string' || !value.startsWith('/api/file?') || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(String(folder || ''))) return '';
  const params = new URLSearchParams(value.slice('/api/file?'.length));
  if (params.getAll('key').length !== 1 || [...params.keys()].some((key) => key !== 'key' && key !== 'ft')) return '';
  const key = params.get('key');
  const prefix = folder + '/img/';
  if (!key.startsWith(prefix) || !/^\d{6}\/[a-f0-9]{16}\.(?:png|jpe?g|gif|webp)$/i.test(key.slice(prefix.length))) return '';
  return '/api/file?key=' + encodeURIComponent(key);
}
/** 下载来源图片，失败保留原链接并记录逐图原因，由老师在待审核中替换。 */
async function storeImages(questions, store, folder, fetcher = download) {
  const list = questions.map((q) => ({ ...q, images: Array.isArray(q.images) ? q.images.slice() : [], _image_errors: [] }));
  const unique = new Map();
  list.forEach((q) => q.images.forEach((u) => { const url = typeof u === 'string' ? u : ''; if (!unique.has(url)) unique.set(url, { url, result: existingBankImage(url, folder) }); }));
  const jobs = [...unique.values()].filter((job) => !job.result);
  jobs.slice(MAX_UNIQUE).forEach((j) => { j.error = '本批次图片过多，请分批采集或手动补图'; });
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length, MAX_UNIQUE) }, async () => {
    while (cursor < Math.min(jobs.length, MAX_UNIQUE)) {
      const j = jobs[cursor++];
      try {
        const { buf, ext } = await fetcher(j.url);
        const saved = await store.saveFile(buf, `capture.${ext}`, `${folder}/img`);
        j.result = '/api/file?key=' + encodeURIComponent(saved.key);
      } catch (e) { j.error = e.message || '图片转存失败'; }
    }
  }));
  let failed = 0;
  list.forEach((q) => q.images.forEach((url, index) => {
    const job = unique.get(typeof url === 'string' ? url : '');
    if (job && job.result) q.images[index] = job.result;
    else { failed++; q._image_errors.push({ index, message: job && job.error || '图片转存失败' }); }
  }));
  return { questions: list, failed };
}
module.exports = { storeImages, existingBankImage };
