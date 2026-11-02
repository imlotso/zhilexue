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
  if (j.code !== 0) throw new Error(j.msg || '上传失败');
  return j.data.url;
}

function t8Enhance(root, opt) {
  opt = opt || {};
  const els = (opt.fields || []).map((f) => (typeof f === 'string' ? root.querySelector(f) : f)).filter(Boolean);
  els.forEach((el) => {
    if (el.dataset.t8) return;
    el.dataset.t8 = '1';
    const bar = document.createElement('div');
    bar.className = 't8-bar';
    bar.innerHTML = `<button type="button" class="btn ghost xs t8-fx" title="用公式键盘输入分数、根号、上下标……">∑ 插入公式</button>${opt.images ? '<span class="hint">图片可直接粘贴 / 拖进下面的输入框</span>' : ''}`;
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
      const put = async (file) => {
        try {
          const url = await t8Upload(file);
          opt.images.push(url);
          MLive.insertAt(el, `\n[图${opt.images.length}]`);
          if (opt.onImage) opt.onImage(url, opt.images.length - 1);
          toast('图片已上传并插入到光标处', 'ok');
        } catch (err) { toast(err.message || '图片上传失败', 'err'); }
      };
      el.addEventListener('paste', (e) => {
        const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((x) => /^image\//.test(x.type));
        if (!f) return;
        e.preventDefault(); put(f);
      });
      el.addEventListener('dragover', (e) => { if ([...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files')) e.preventDefault(); });
      el.addEventListener('drop', (e) => {
        const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].find((x) => /^image\//.test(x.type));
        if (!f) return;
        e.preventDefault(); put(f);
      });
    }
  });
}
