/* 录题端的公式输入 + 粘贴 / 拖拽图片（T8）。
 * t8Enhance(根元素, { fields: ['#qeStem', …] 或元素数组, images: 数组|null, onImage: fn })：
 *   · 每个输入框上方加「∑ 插入公式」：弹出 MathLive 公式框（本地文件，见 public/js/mlive.js），结果以 \( … \) 插入光标处，
 *     学生端的 MathJax 按 \( \) 渲染；选中一段已有的 \( … \) 再点按钮 = 改这个公式。
 *   · 给了 images 数组的输入框，支持直接粘贴 / 拖进图片：走 /api/admin/bank/mf/asset 上传（存储 bank/img），
 *     把地址 push 进 images，并在光标处插入 [图N]（和"新建题目"里的 🖼 按钮同一套约定）。
 * 依赖 admin.js 的 esc，api.js 的 toast / Auth，js/mlive.js 的 MLive。 */
const T8_ASSET = '/api/admin/bank/mf/asset';

async function t8Upload(file) {
  const fd = new FormData(); fd.append('file', file, file.name || 'paste.png');
  const r = await fetch(T8_ASSET, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
  const j = await r.json();
  if (!r.ok || j.code !== 0 || !j.data || typeof j.data.url !== 'string' || !j.data.url.trim()) throw new Error(j.msg || '上传失败');
  return j.data.url;
}

function t8Enhance(root, opt) {
  opt = opt || {};
  let queue = Promise.resolve();
  const states = [];
  const uploadEls = (opt.uploadFields || []).map(f => typeof f === 'string' ? root.querySelector(f) : f);
  const controller = {
    async whenIdle() { let current; do { current = queue; await current; } while (current !== queue); },
    hasFailures: () => states.some(state => state.failed.length > 0),
  };
  const els = (opt.fields || []).map((f) => (typeof f === 'string' ? root.querySelector(f) : f)).filter(Boolean);
  els.forEach((el) => {
    if (el.dataset.t8) return;
    el.dataset.t8 = '1';
    const bar = document.createElement('div');
    bar.className = 't8-bar';
    const picker = !!opt.images && uploadEls.includes(el);
    bar.innerHTML = `<button type="button" class="btn ghost xs t8-fx" title="用公式键盘输入分数、根号、上下标……">∑ 插入公式</button>${picker ? '<button type="button" class="btn ghost xs t8-image-upload">上传图片（可多选）</button><input type="file" class="t8-image-input" accept="image/*" multiple hidden aria-label="选择题干图片（支持多选）">' : ''}${opt.images ? '<span class="hint">图片可直接粘贴 / 拖进下面的输入框</span>' : ''}`;
    el.parentNode.insertBefore(bar, el);
    bar.querySelector('.t8-fx').onclick = () => {
      // 选中了一段 \( … \) → 带进公式框修改；否则插入新公式
      const sel = typeof el.selectionStart === 'number' ? (el.value || '').slice(el.selectionStart, el.selectionEnd) : '';
      const m = /^\\\(([\s\S]*)\\\)$/.exec(sel.trim());
      const keepStart = el.selectionStart, keepEnd = el.selectionEnd;
      MLive.dialog({
        title: '插入公式', delimit: true, latex: m ? m[1] : '',
        hint: '点下面的公式框，用屏幕键盘输入分数、根号、上下标等；点「插入」后会写成 \\( … \\)，学生端自动显示成标准公式。',
        onOk: (text) => { try { el.setSelectionRange(keepStart, keepEnd); } catch (e) { /* 忽略 */ } MLive.insertAt(el, text); },
      });
    };
    if (opt.images) {
      const state = { failed: [], active: 0, uploaded: 0 };
      states.push(state);
      const status = document.createElement('div');
      status.className = 't8-upload-status';
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const text = document.createElement('span');
      const retry = document.createElement('button'), discard = document.createElement('button');
      retry.type = discard.type = 'button';
      retry.className = 'btn ghost xs t8-upload-retry'; retry.textContent = '重试失败图片';
      discard.className = 'btn ghost xs t8-upload-discard'; discard.textContent = '忽略失败图片';
      status.append(text, retry, discard); el.after(status);
      const uploadButton = bar.querySelector('.t8-image-upload');
      function show() {
        status.hidden = !state.active && !state.uploaded && !state.failed.length;
        text.textContent = state.active ? '正在上传图片，请等待…' :
          (state.uploaded ? `已上传 ${state.uploaded} 张图片。` : '') +
          (state.failed.length ? ` ${state.failed.length} 张失败：${state.failed.map(x => x.file.name).join('、')}。请重试或忽略失败图片。` : '');
        retry.hidden = discard.hidden = !state.failed.length;
        retry.disabled = discard.disabled = !!state.active;
        if (uploadButton) uploadButton.disabled = !!state.active;
      }
      const put = files => {
        const images = Array.from(files || []).filter(file => /^image\//.test(file.type));
        if (!images.length) return;
        let position = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
        state.active += images.length; show();
        queue = queue.then(async () => {
          for (const file of images) {
            try {
              if (!root.isConnected || !el.isConnected) break;
              const url = await t8Upload(file);
              if (!root.isConnected || !el.isConnected) break;
              opt.images.push(url);
              // Preserve the selected insertion point unless the user has edited the text meanwhile.
              if (el.value === position.value) el.setSelectionRange(position.start, position.end);
              MLive.insertAt(el, `\n[图${opt.images.length}]`);
              position = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
              el.dispatchEvent(new Event('input', { bubbles: true }));
              state.uploaded++;
              if (opt.onImage) {
                try { opt.onImage(url, opt.images.length - 1); }
                catch (err) { toast('图片已上传，但预览刷新失败，请重新查看题目', 'err'); }
              }
            } catch (err) {
              state.failed.push({ file });
              toast(file.name + '：' + (err.message || '图片上传失败'), 'err');
            } finally { state.active--; }
          }
          // A dismissed form never receives late state or success messages.
          if (!root.isConnected || !el.isConnected) { state.active = 0; return; }
          show();
        });
      };
      retry.onclick = () => { const files = state.failed.map(x => x.file); state.failed = []; put(files); };
      discard.onclick = () => { state.failed = []; show(); };
      if (uploadButton) {
        const input = bar.querySelector('.t8-image-input');
        uploadButton.onclick = () => input.click();
        input.onchange = () => { const files = Array.from(input.files || []); input.value = ''; put(files); };
      }
      show();
      el.addEventListener('paste', e => {
        const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
        if (!files.length) return;
        e.preventDefault(); put(files);
      });
      el.addEventListener('dragover', e => { if (Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files')) e.preventDefault(); });
      el.addEventListener('drop', e => {
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /^image\//.test(f.type));
        if (!files.length) return;
        e.preventDefault(); put(files);
      });
    }
  });
  return controller;
}
