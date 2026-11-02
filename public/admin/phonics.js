/* 语音基础 · 管理端（训练管理 → 字母乐园 / 音标训练）
 * 26 个字母：笔顺动图、字母发音、拼读视频、教学视频、讲义资料
 * 48 个音标：拟音 / 发音要领 / 发音音频 / 口型视频 / 教学视频 / 示范词 / 讲义资料
 * 上传方式与「教学资源 → 视频管理 / 讲义资料」一致：文件存成 key，学生端用 /api/file?key= 取。 */
const PH = { kind: 'letters', items: [], kw: '', seed: null, courseId: 0, quizMode: '' };
const PH_KINDS = { letters: '字母乐园', phonetic: '音标训练' };
const PH_TIP = {
  letters: '每个字母可以配：笔顺动图（gif/图片）、字母发音音频、拼读视频、教学视频、讲义资料。留空则学生端自动用系统发音。',
  phonetic: '每个音标可以配：真人发音音频、口型视频、教学视频、三个示范词、讲义资料。留空的发音会用系统语音兜底。',
};

async function phLoad() {
  PH.items = await api('/api/admin/phonics/list?kind=' + PH.kind);
}
async function phSeed() {
  if (!PH.seed) {
    try {
      const r = await fetch('../js/phonics-seed.json');
      PH.seed = await r.json();
    } catch (e) { toast('默认数据加载失败'); return; }
  }
  const items = PH.kind === 'letters' ? PH.seed.letters : PH.seed.phonemes;
  modal({
    title: '初始化' + PH_KINDS[PH.kind],
    body: `<p class="w-tip">将写入 ${items.length} 条默认内容（字母 / 音标的基础信息、示范词${PH.kind === 'phonetic' ? '、内置发音' : '、笔顺动图'}）。</p>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="phForce"> 覆盖重建（清空现有条目后重新写入）</label>`,
    okText: '开始初始化',
    onOk: async (w, err) => {
      const btn = w.querySelector('#mOk');
      btn.innerHTML = '<span class="spinner"></span> 写入中';
      const r = await api('/api/admin/phonics/seed', {
        method: 'POST',
        body: { kind: PH.kind, items, force: w.querySelector('#phForce').checked ? 1 : 0 },
      });
      await phLoad(); render();
      toast(r && r.msg ? r.msg : '已初始化', 'ok');
      return true;
    },
  });
}
/** 上传一个文件 → key（视频走分片直传，其他走 phonics/upload，和教学资源同一套存储） */
async function phUpload(file, kind, onProg) {
  if (!file) return '';
  if (kind === 'video') {
    await phCheckVideoCodec(file);   // H.265 会黑屏只有声音，直接拦下
    return await uploadVideoDirect(file, onProg || (() => {}));
  }
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  const r = await fetch('/api/admin/phonics/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 0) throw new Error(j.msg || '上传失败');
  return j.data.key;
}
function phKeyName(key) {
  const s = String(key || '');
  return s ? s.split('/').pop() : '';
}
/** 视频编码检测：H.265/HEVC 在网页播放器里黑屏只有声音，上传前拦下（读头尾 2MB 搜 hev1/hvc1 标记） */
async function phCheckVideoCodec(file) {
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
/** 讲义资料：一行一个，可加可删、可下载（老师端也能下载，存服务器本地） */
function phFilesHTML(files) {
  const list = (files || []).length ? files : [];
  const dlUrl = (f) => `/api/file?key=${encodeURIComponent(f.key)}&token=${encodeURIComponent(Auth.token || '')}&name=${encodeURIComponent(f.title || phKeyName(f.key))}`;
  return `<div class="ph-files">${list.map((f, i) => `
    <div class="ph-file-row" data-fi="${i}" data-key="${esc(f.key || '')}">
      <input class="input" placeholder="资料名称" value="${esc(f.title || '')}" data-ftitle="${i}">
      <span class="ph-key" title="${esc(f.key || '')}" data-key="${esc(f.key || '')}">${esc(phKeyName(f.key) || '未上传')}</span>
      ${f.key ? `<a class="link-btn" href="${dlUrl(f)}" target="_blank">下载</a>` : ''}
      <button class="link-btn" data-fup="${i}">${f.key ? '更换' : '上传'}</button>
      <button class="link-btn danger" data-fdel="${i}">删除</button>
    </div>`).join('')}
    <button class="btn ghost" id="phFileAdd" style="margin-top:8px">${ic('plus')} 添加一份资料</button></div>`;
}
/** 课时配套讲义：一行一份，可加可删、可下载（存服务器本地，学生端老师端都能下载） */
function phCiDocsHTML(docs) {
  const list = docs || [];
  const dlUrl = (f) => `/api/file?key=${encodeURIComponent(f.key)}&token=${encodeURIComponent(Auth.token || '')}&name=${encodeURIComponent(f.title || phKeyName(f.key))}`;
  return `<div class="ph-files">${list.map((f, i) => `
    <div class="ph-file-row" data-cdi="${i}">
      <input class="input" placeholder="讲义名称" value="${esc(f.title || '')}" data-cdtitle="${i}">
      <span class="ph-key" title="${esc(f.key || '')}">${esc(phKeyName(f.key) || '未上传')}</span>
      ${f.key ? `<a class="link-btn" href="${dlUrl(f)}" target="_blank">下载</a>` : ''}
      <button class="link-btn" data-cdup="${i}">${f.key ? '更换' : '上传'}</button>
      <button class="link-btn danger" data-cddel="${i}">删除</button>
    </div>`).join('')}
    <button class="btn ghost" id="phCiDocAdd" style="margin-top:8px">${ic('plus')} 添加一份讲义</button></div>`;
}
/** 讲义行交互绑定（课程/课时弹窗共用）：添加/上传/更换/删除/改名。
 *  ⚠️ 文件框必须先挂进 DOM 再 click()：游离 input 在部分浏览器（尤其 Edge）点开不弹文件选择框。 */
function phBindDocRows(box, docs) {
  const rerender = () => { box.innerHTML = phCiDocsHTML(docs); phBindDocRows(box, docs); };
  box.querySelectorAll('[data-cdtitle]').forEach((t) => t.oninput = () => {
    const d = docs[Number(t.dataset.cdtitle)]; if (d) d.title = t.value;
  });
  const add = box.querySelector('#phCiDocAdd');
  if (add) add.onclick = () => {
    docs.push({ title: '', key: '', size: 0, mime: '' });
    rerender();
  };
  box.querySelectorAll('[data-cdup]').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.cdup);
    const row = box.querySelector('[data-cdi="' + i + '"]');
    if (!row) return;
    const pick = row.querySelector('input[type=file]') || document.createElement('input');
    if (!pick.parentNode) {
      pick.type = 'file';
      pick.hidden = true;
      pick.accept = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*';
      row.appendChild(pick);
    }
    pick.onchange = async () => {
      const f = pick.files[0];
      if (!f) { pick.remove(); return; }
      const keyEl = row.querySelector('.ph-key');
      b.disabled = true;
      if (keyEl) keyEl.textContent = '上传中：' + f.name;
      try {
        const key = await phUpload(f, 'file', (done, total) => {
          if (keyEl && total) keyEl.textContent = '上传中：' + f.name + '（' + Math.round(done / total * 100) + '%）';
        });
        docs[i] = { title: docs[i].title || f.name.replace(/\.[^.]+$/, ''), key, size: f.size || 0, mime: f.type || '' };
        rerender();
        toast('讲义已上传，点「保存」完成', 'ok');
      } catch (e) {
        if (keyEl) keyEl.textContent = '上传失败';
        toast(e.message || '上传失败', 'warn');
      } finally { b.disabled = false; pick.remove(); }
    };
    pick.click();
  });
  box.querySelectorAll('[data-cddel]').forEach((b) => b.onclick = () => {
    docs.splice(Number(b.dataset.cddel), 1);
    rerender();
  });
}
function phSamplesHTML(samples) {  return (samples || []).map((s, i) => `
    <div class="ph-smp" data-si="${i}">
      <input class="input" placeholder="单词" value="${esc(s.w || '')}" data-sw="${i}">
      <input class="input" placeholder="音标" value="${esc(s.ipa || '')}" data-sipa="${i}">
      <input class="input" placeholder="中文" value="${esc(s.zh || '')}" data-szh="${i}">
      <input class="input" placeholder="标红字母" value="${esc(s.hl || '')}" data-shl="${i}">
      <button class="link-btn danger" data-sdel="${i}">删除</button>
    </div>`).join('') || '<p class="w-tip">还没有示范词</p>';
}
function phEditForm(item) {
  const isNew = !item;
  const it = item || { title: '', code: '', type: PH.kind === 'letters' ? 'letter' : 'vowel', cue: '', tip: '', spell: '', samples: [], files: [], audio: '', stroke: '', video_mouth: '', video_teach: '' };
  const isLetter = PH.kind === 'letters';
  modal({
    title: (isNew ? '新增' : '编辑') + (isLetter ? '字母' : '音标'),
    wide: true,
    body: `
      <div class="ph-grid">
        <div class="field"><label>显示${isLetter ? '字母（如 Aa）' : '音标（如 /iː/）'} *</label><input class="input" id="phTitle" value="${esc(it.title)}"></div>
        <div class="field"><label>标识（${isLetter ? 'a~z' : '音标内部 key，如 sh / ei / ae'}${isNew ? '' : '，已固定不可改'}）</label><input class="input" id="phCode" value="${esc(it.code)}" ${isNew ? '' : 'readonly style="background:var(--t-soft,#f4f7fb);color:var(--text3)"'} title="${isNew ? '音标内部标识，与发音表布局对应' : '内部标识已固定，修改会导致音标表显示异常'}"></div>
        ${isLetter ? '' : `
        <div class="field"><label>类型</label><select class="input" id="phType">
          <option value="vowel" ${it.type === 'vowel' ? 'selected' : ''}>元音</option>
          <option value="consonant" ${it.type === 'consonant' ? 'selected' : ''}>辅音</option></select></div>
        <div class="field"><label>分区</label><input class="input" id="phGroup" placeholder="前元音 / 爆破音…" value="${esc(it.group_name || '')}"></div>
        <div class="field"><label>拟音</label><input class="input" id="phCue" value="${esc(it.cue)}"></div>
        <div class="field"><label>常见拼写</label><input class="input" id="phSpell" value="${esc(it.spell)}"></div>`}
        <div class="field"><label>${isLetter ? '字母名称音' : '发音提示'}</label><input class="input" id="phMnemonic" value="${esc(it.mnemonic || '')}"></div>
      </div>
      <div class="field"><label>发音要领 / 说明</label><textarea class="input" id="phTip" rows="3">${esc(it.tip)}</textarea></div>
      <div class="field"><label>发音音频（mp3，留空则用系统发音）</label>
        <div class="ph-up"><span class="ph-key">${esc(phKeyName(it.audio) || '未上传')}</span>
          <button class="btn ghost" id="phAudioBtn">选取音频</button><input type="file" id="phAudio" accept="audio/*" hidden></div></div>
      ${isLetter ? `<div class="field"><label>笔顺动图（gif / 图片）</label>
        <div class="ph-up"><span class="ph-key">${esc(phKeyName(it.stroke) || '未上传')}</span>
          <button class="btn ghost" id="phStrokeBtn">选取动图</button><input type="file" id="phStroke" accept="image/*" hidden></div></div>` : ''}
      <div class="field"><label>${isLetter ? '拼读视频' : '口型视频'}</label>
        <div class="ph-up"><span class="ph-key">${esc(phKeyName(isLetter ? it.video_teach : it.video_mouth) || '未上传')}</span>
          <button class="btn ghost" id="phV1Btn">选取视频</button><input type="file" id="phV1" accept="video/*" hidden></div></div>
      ${isLetter ? '' : `<div class="field"><label>教学视频</label>
        <div class="ph-up"><span class="ph-key">${esc(phKeyName(it.video_teach) || '未上传')}</span>
          <button class="btn ghost" id="phV2Btn">选取视频</button><input type="file" id="phV2" accept="video/*" hidden></div></div>`}
      ${isLetter ? '' : `<div class="field"><label>示范词（点「添加示范词」可加）</label><div id="phSamples">${phSamplesHTML(it.samples)}</div>
        <button class="btn ghost" id="phSmpAdd" style="margin-top:8px">${ic('plus')} 添加示范词</button></div>`}
      <div class="field"><label>讲义资料（PDF / 图片等，学生端、老师端均可下载，存服务器）</label>
        <div id="phFiles">${phFilesHTML(it.files)}</div></div>`,
    okText: '保存',
    onMount: (w) => {
      const bind = (btnId, inputId) => {
        const b = w.querySelector('#' + btnId), inp = w.querySelector('#' + inputId);
        if (b && inp) b.onclick = () => inp.click();
      };
      bind('phAudioBtn', 'phAudio'); bind('phStrokeBtn', 'phStroke'); bind('phV1Btn', 'phV1'); bind('phV2Btn', 'phV2');
      /* 选完文件立即上传（视频直传阿里云，音频/动图/讲义存服务器本地），进度与结果实时显示 */
      const imm = (inpId, kind, btnId) => {
        const inp = w.querySelector('#' + inpId);
        if (!inp) return;
        inp.onchange = async () => {
          const f = inp.files[0];
          if (!f) return;
          const btn = w.querySelector('#' + btnId);
          const keyEl = inp.closest('.field') && inp.closest('.field').querySelector('.ph-key');
          const oldBtn = btn ? btn.innerHTML : '';
          if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 上传中'; }
          if (keyEl) keyEl.textContent = '上传中：' + f.name;
          try {
            const key = await phUpload(f, kind, (done, total) => {
              if (keyEl && total) keyEl.textContent = '上传中：' + f.name + '（' + Math.round(done / total * 100) + '%）';
            });
            inp.dataset.key = key;
            if (keyEl) { keyEl.textContent = f.name; keyEl.title = key; }
            toast('上传完成，点「保存」生效', 'ok');
          } catch (e) {
            if (keyEl) keyEl.textContent = '上传失败';
            toast(e.message || '上传失败', 'warn');
          } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = oldBtn; }
            inp.value = '';
          }
        };
      };
      imm('phAudio', 'audio', 'phAudioBtn');
      imm('phStroke', 'image', 'phStrokeBtn');
      imm('phV1', 'video', 'phV1Btn');
      imm('phV2', 'video', 'phV2Btn');
      w.querySelector('#phSmpAdd') && (w.querySelector('#phSmpAdd').onclick = () => {
        const box = w.querySelector('#phSamples');
        const d = document.createElement('div');
        d.className = 'ph-smp';
        d.innerHTML = '<input class="input" placeholder="单词" data-sw=""><input class="input" placeholder="音标" data-sipa=""><input class="input" placeholder="中文" data-szh=""><input class="input" placeholder="标红字母" data-shl=""><button class="link-btn danger" data-sdel="">删除</button>';
        box.appendChild(d);
      });
      w.querySelector('#phFileAdd') && (w.querySelector('#phFileAdd').onclick = () => {
        const box = w.querySelector('#phFiles').querySelector('.ph-files') || w.querySelector('#phFiles');
        const d = document.createElement('div');
        d.className = 'ph-file-row';
        d.innerHTML = '<input class="input" placeholder="资料名称"><span class="ph-key" data-key="">未上传</span><button class="link-btn" data-fup="">上传</button><button class="link-btn danger" data-fdel="">删除</button>';
        box.insertBefore(d, w.querySelector('#phFileAdd'));
      });
      w.addEventListener('click', (e) => {
        const t = e.target;
        if (t.dataset && t.dataset.sdel !== undefined) { t.closest('.ph-smp').remove(); }
        if (t.dataset && t.dataset.fdel !== undefined) { t.closest('.ph-file-row').remove(); }
        /* 讲义上传：动态建文件框（视频存云、讲义文件存服务器本地），传完把 key 记到行上 */
        if (t.dataset && t.dataset.fup !== undefined) {
          const row = t.closest('.ph-file-row');
          if (!row || row.querySelector('input[type=file]')) return;
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.hidden = true;
          inp.accept = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.mp3,.mp4,.wav';
          row.appendChild(inp);
          inp.onchange = async () => {
            const f = inp.files[0];
            if (!f) return;
            const keyEl = row.querySelector('.ph-key');
            t.disabled = true;
            if (keyEl) keyEl.textContent = '上传中：' + f.name;
            try {
              const key = await phUpload(f, 'file');
              row.dataset.key = key;
              if (keyEl) { keyEl.textContent = f.name; keyEl.title = key; keyEl.dataset.key = key; }
              t.textContent = '更换';
              toast('资料已上传，点「保存」生效', 'ok');
            } catch (e2) {
              if (keyEl) keyEl.textContent = row.dataset.key ? phKeyName(row.dataset.key) : '未上传';
              toast(e2.message || '上传失败', 'warn');
            } finally {
              t.disabled = false;
              inp.remove();
            }
          };
          inp.click();
        }
      });
    },
    onOk: async (w, err) => {
      const title = w.querySelector('#phTitle').value.trim();
      if (!title) return err('请填写显示内容');
      const btn = w.querySelector('#mOk');
      /* 音频/动图/视频已改为「选完即传」，这里优先取已传好的 key，没有则沿用旧值 */
      const keyOf = (id, old) => {
        const el = w.querySelector('#' + id);
        return (el && el.dataset.key) || old || '';
      };
      try {
        const audio = keyOf('phAudio', it.audio);
        const stroke = keyOf('phStroke', it.stroke);
        const v1 = keyOf('phV1', isLetter ? it.video_teach : it.video_mouth);
        const v2 = keyOf('phV2', isLetter ? '' : it.video_teach);
        // 讲义资料：逐行收集（key 来自行上传结果）
        const files = [];
        for (const row of w.querySelectorAll('.ph-file-row')) {
          const t = row.querySelector('input.input') ? row.querySelector('input.input').value.trim() : '';
          const keyEl = row.querySelector('.ph-key');
          const key = row.dataset.key || (keyEl && keyEl.dataset.key) || '';
          if (!t && !key) continue;
          files.push({ title: t || '资料', key });
        }
        // 示范词
        const samples = [];
        w.querySelectorAll('.ph-smp').forEach((row) => {
          const g = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ''; };
          const wd = g('[data-sw], input:nth-child(1)');
          if (!wd) return;
          samples.push({ w: wd, ipa: g('[data-sipa]') || '', zh: g('[data-szh]') || '', hl: g('[data-shl]') || '' });
        });
        btn.innerHTML = '<span class="spinner"></span> 保存中';
        await api('/api/admin/phonics/save', {
          method: 'POST',
          body: {
            id: it.id || 0, kind: PH.kind, title, code: w.querySelector('#phCode').value.trim(),
            type: isLetter ? 'letter' : (w.querySelector('#phType') ? w.querySelector('#phType').value : 'vowel'),
            group_name: isLetter ? '' : (w.querySelector('#phGroup') ? w.querySelector('#phGroup').value.trim() : ''),
            cue: isLetter ? '' : (w.querySelector('#phCue') ? w.querySelector('#phCue').value.trim() : ''),
            spell: isLetter ? '' : (w.querySelector('#phSpell') ? w.querySelector('#phSpell').value.trim() : ''),
            mnemonic: w.querySelector('#phMnemonic').value.trim(),
            tip: w.querySelector('#phTip').value.trim(),
            audio, stroke,
            video_mouth: isLetter ? '' : v1,
            video_teach: isLetter ? v1 : v2,
            samples, files,
            sort: it.sort || 0,
          },
        });
        await phLoad(); render();
        toast('已保存', 'ok');
        return true;
      } catch (e) {
        return err(e.message || '保存失败');
      }
    },
  });
}

/* ---- 字母乐园 · 模块级资源：字母歌视频 + 配套资料（学生端底部「字母歌 / 配套资料」入口） ---- */
async function phExtrasLoad() {
  if (PH.extras && PH.extrasKind === PH.kind) return PH.extras;
  PH.extras = await api('/api/admin/phonics/extras?mod=' + PH.kind);
  PH.extrasKind = PH.kind;
  return PH.extras;
}
function phSongHTML(ex, isLetter) {
  const songs = ex.songs && ex.songs.length ? ex.songs : (ex.song ? [ex.song] : []);
  const fmtSize = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const name = isLetter ? '字母歌视频' : '音标系统课';
  return `
  <div class="card">
    <div class="card-h"><h3>${ic('play')} ${name}</h3>
      <button class="btn primary-sm" id="phSongNew">${ic('plus')} 上传视频</button></div>
    <p class="w-tip" style="margin:0 0 10px">视频存阿里云 OSS；学生端「${isLetter ? '字母乐园 → 字母歌' : '音标训练 → 系统课'}」按排序依次播放。支持多条，上传后可编辑标题 / 排序或删除。</p>
    ${songs.length ? `<table><thead><tr><th>排序</th><th>视频标题</th><th>大小</th><th>上传时间</th><th style="width:130px">操作</th></tr></thead><tbody>${songs.map((s) => `
      <tr>
        <td>${Number(s.sort) || 0}</td>
        <td><b>${esc(s.title || name)}</b></td>
        <td>${fmtSize(s.size)}</td>
        <td>${esc(String(s.created_at || '').slice(0, 16))}</td>
        <td><div class="acts">
          <button class="link-btn" data-phsongedit="${s.id}">编辑</button>
          <button class="link-btn danger" data-phsongdel="${s.id}">删除</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`
      : `<div class="empty">还没有${isLetter ? '字母歌视频' : '系统课视频'}，点右上角「上传视频」添加</div>`}
  </div>`;
}
/** 从视频文件截取一帧作封面（返回 dataURL，失败返回空串） */
function phVideoCover(file) {
  return new Promise((resolve) => {
    let done0 = false;
    const done = (v) => { if (!done0) { done0 = true; resolve(v || ''); } };
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(1.2, (v.duration || 2) / 3); } catch (e) { done(''); } };
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          const w = 640;
          const h = Math.max(1, Math.round(w * (v.videoHeight || 360) / (v.videoWidth || 640)));
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(v, 0, 0, w, h);
          URL.revokeObjectURL(url);
          done(c.toDataURL('image/jpeg', 0.72));
        } catch (e) { done(''); }
      };
      v.onerror = () => done('');
      setTimeout(() => done(''), 10000);
    } catch (e) { done(''); }
  });
}
/** 字母歌上传 / 编辑弹窗：视频标题 + 视频排序 + 视频文件（选完即传阿里云，并自动截帧封面） */
function phSongForm(item) {
  const isNew = !item;
  const it = item || { title: '', sort: 0, file: '', size: 0, mime: '' };
  const SONG = PH.kind === 'letters' ? '字母歌' : '系统课视频';
  const title = (isNew ? '上传' : '编辑') + SONG;
  modal({
    title,
    body: `
      <div class="field"><label>视频标题 *</label>
        <input class="input" id="phSongTitle" value="${esc(it.title)}" placeholder="${PH.kind === 'letters' ? '如 ABC 字母歌' : '如 认识音标与发音器官'}"></div>
      <div class="field"><label>视频排序（数字越小越靠前）</label>
        <input class="input" id="phSongSort" type="number" value="${Number(it.sort) || 0}"></div>
      <div class="field"><label>视频文件${isNew ? ' *' : '（不重新选择则保留原视频）'}</label>
        <div class="ph-up"><span class="ph-key" id="phSongKeyEl">${isNew ? '未选择文件' : '保留原视频'}</span>
          <button class="btn ghost" id="phSongFileBtn">选择视频</button>
          <input type="file" id="phSongFile" accept="video/*" hidden></div></div>`,
    okText: '保存',
    onMount: (w) => {
      const btn = w.querySelector('#phSongFileBtn'), inp = w.querySelector('#phSongFile');
      if (btn && inp) btn.onclick = () => inp.click();
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        const keyEl = w.querySelector('#phSongKeyEl');
        btn.disabled = true;
        if (keyEl) keyEl.textContent = '上传中：' + f.name;
        try {
          const key = await phUpload(f, 'video', (done, total) => {
            if (keyEl && total) keyEl.textContent = '上传中：' + f.name + '（' + Math.round(done / total * 100) + '%）';
          });
          inp.dataset.key = key;
          inp.dataset.size = String(f.size || 0);
          inp.dataset.mime = f.type || 'video/mp4';
          inp.dataset.fname = f.name;
          if (keyEl) keyEl.textContent = f.name + '（生成封面中…）';
          /* 截取视频帧作封面，存服务器（学生端卡片封面用） */
          try {
            const shot = await phVideoCover(f);
            if (shot) {
              const bin = atob(shot.split(',')[1] || '');
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              const cf = new File([arr], 'cover.jpg', { type: 'image/jpeg' });
              inp.dataset.cover = await phUpload(cf, 'image');
            }
          } catch (e2) { /* 封面失败不影响视频 */ }
          if (keyEl) keyEl.textContent = f.name;
          toast('视频已上传，点「保存」完成', 'ok');
        } catch (e) {
          if (keyEl) keyEl.textContent = '上传失败';
          toast(e.message || '上传失败', 'warn');
        } finally {
          btn.disabled = false;
          inp.value = '';
        }
      };
    },
    onOk: async (w, err) => {
      const title = w.querySelector('#phSongTitle').value.trim();
      if (!title) return err('请填写视频标题');
      const inp = w.querySelector('#phSongFile');
      const key = inp.dataset.key || (isNew ? '' : it.file || '');
      if (!key) return err(isNew ? '请选择并上传视频文件' : '该条目还没有视频文件，请选择视频');
      const btn = w.querySelector('#mOk');
      btn.innerHTML = '<span class="spinner"></span> 保存中';
      try {
        await api('/api/admin/phonics/extras/save', {
          method: 'POST',
          body: {
            id: it.id || 0, mod: PH.kind, k: 'song', title,
            sort: Number(w.querySelector('#phSongSort').value) || 0,
            file: key,
            size: Number(inp.dataset.size) || it.size || 0,
            mime: inp.dataset.mime || it.mime || 'video/mp4',
            cover: inp.dataset.cover || '',
          },
        });
        PH.extras = null; await phExtrasLoad(); render();
        toast(isNew ? (SONG + '已上传') : '已保存', 'ok');
        return true;
      } catch (e) {
        return err(e.message || '保存失败');
      }
    },
  });
}
function phMatHTML(ex) {
  const mats = ex.materials || [];
  const fmtSize = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  return `
  <div class="card" style="margin-bottom:14px">
    <div class="card-h"><h3>${ic('doc')} 配套资料</h3></div>
    <p class="w-tip" style="margin:0 0 10px">支持 PDF / Word / PPT / 图片等纸质资料的电子版；学生端「配套资料」页可在线查看、下载打印。</p>
    <div class="toolbar">
      <input class="input" id="phMatTitle" placeholder="资料名称（留空则使用文件名）" style="min-width:220px">
      <button class="btn ghost" id="phMatBtn">${ic('plus')} 选择并上传</button>
      <input type="file" id="phMatFile" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.gif" hidden>
    </div>
    ${mats.length ? `<table><thead><tr><th>名称</th><th>大小</th><th>上传时间</th><th style="width:120px">操作</th></tr></thead><tbody>${mats.map((m) => `
      <tr><td><b>${esc(m.title || '资料')}</b></td><td>${fmtSize(m.size)}</td><td>${esc(String(m.created_at || '').slice(0, 16))}</td>
      <td><span style="display:inline-flex;align-items:center;gap:10px;white-space:nowrap">${m.file ? `<a class="link-btn" href="/api/file?key=${encodeURIComponent(m.file)}&token=${encodeURIComponent(Auth.token || '')}&name=${encodeURIComponent(m.title || phKeyName(m.file))}" target="_blank">下载</a>` : ''}<button class="link-btn danger" data-phmatdel="${m.id}">删除</button></span></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">还没有配套资料</div>'}
  </div>`;
}
function phExtrasBind() {
  /* 字母歌：上传（弹窗：标题/排序/文件）+ 编辑 + 删除 */
  const songNew = document.getElementById('phSongNew');
  if (songNew) songNew.onclick = () => phSongForm(null);
  const ex = PH.extras || {};
  const songs = ex.songs && ex.songs.length ? ex.songs : (ex.song ? [ex.song] : []);
  document.querySelectorAll('[data-phsongedit]').forEach((b) => b.onclick = () => {
    const it = songs.find((s) => String(s.id) === b.dataset.phsongedit);
    if (it) phSongForm(it);
  });
  document.querySelectorAll('[data-phsongdel]').forEach((b) => b.onclick = () => {
    const it = songs.find((s) => String(s.id) === b.dataset.phsongdel);
    modal({
      title: '删除' + (PH.kind === 'letters' ? '字母歌' : '系统课视频'),
      body: `<p class="w-tip">将删除「${it ? esc(it.title || '字母歌') : ''}」，删除后不可恢复。</p>`,
      okText: '删除',
      onOk: async () => {
        await api('/api/admin/phonics/extras/del', { method: 'POST', body: { id: Number(b.dataset.phsongdel) } });
        PH.extras = null; await phExtrasLoad(); render();
        toast('已删除', 'ok');
        return true;
      },
    });
  });
  const matBtn = document.getElementById('phMatBtn');
  if (matBtn) matBtn.onclick = () => {
    const inp = document.getElementById('phMatFile');
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const title = (document.getElementById('phMatTitle').value || '').trim() || f.name;
      matBtn.disabled = true;
      try {
        const key = await phUpload(f, 'file', () => {});
        await api('/api/admin/phonics/extras/save', { method: 'POST', body: { mod: PH.kind, k: 'material', title, file: key, size: f.size, mime: f.type } });
        PH.extras = null; await phExtrasLoad(); render();
        toast('资料已上传', 'ok');
      } catch (e) { toast(e.message || '上传失败', 'warn'); matBtn.disabled = false; }
    };
    inp.click();
  };
  document.querySelectorAll('[data-phmatdel]').forEach((b) => b.onclick = () => {
    modal({
      title: '删除资料',
      body: '<p class="w-tip">将删除这份配套资料，删除后不可恢复。</p>',
      okText: '删除',
      onOk: async () => {
        await api('/api/admin/phonics/extras/del', { method: 'POST', body: { id: Number(b.dataset.phmatdel) } });
        PH.extras = null; await phExtrasLoad(); render();
        toast('已删除', 'ok');
        return true;
      },
    });
  });
}

/* ---- 音标训练 · 系统课课程管理（课程 → 课时，两级；视频选完即传阿里云） ---- */
async function phCoursesLoad() {
  PH.courses = await api('/api/admin/phonics/courses?mod=phonetic');
  return PH.courses;
}
function phCourseForm(item) {
  const isNew = !item;
  const it = item || { title: '', sub: '', sort: 0, cover: '', docs: [] };
  let cover = it.cover || '';
  const docs = (it.docs || []).map((d) => ({ ...d }));
  const phKeyUrl = (k) => k ? `/api/file?key=${encodeURIComponent(k)}&token=${encodeURIComponent(Auth.token || '')}` : '';
  const coverPreview = () => cover
    ? `<img src="${esc(phKeyUrl(cover))}" style="width:100%;max-width:320px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;border:1px solid var(--line)">`
    : '<div style="width:320px;height:110px;border:1.5px dashed var(--line);border-radius:10px;display:grid;place-items:center;color:var(--text3);font-size:13px">暂无封面（学生端显示默认渐变卡）</div>';
  modal({
    title: isNew ? '新建课程' : '编辑课程',
    body: `
      <div class="field"><label>课程标题 *（如：第 1 讲 认识音标）</label>
        <input class="input" id="phCTitle" value="${esc(it.title)}"></div>
      <div class="field"><label>课程说明（选填，学生端卡片副标题）</label>
        <input class="input" id="phCSub" value="${esc(it.sub || '')}" placeholder="如：系统学习 48 个音标"></div>
      <div class="field"><label>排序（数字越小越靠前）</label>
        <input class="input" id="phCSort" type="number" value="${Number(it.sort) || 0}"></div>
      <div class="field"><label>课程封面（可上传图片，或根据课程标题 AI 生成；16:9 效果最佳）</label>
        <div id="phCoverBox">${coverPreview()}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn ghost" id="phCoverUpBtn">${ic('plus')} 上传封面</button>
          <button class="btn ghost" id="phCoverAiBtn">✨ AI 生成封面</button>
          <input type="file" id="phCoverFile" accept="image/*" hidden>
        </div></div>
      <div class="field"><label>课程配套讲义（PDF / 图片 / 文档，选完自动上传存服务器；整个课程共用，学生端课程页「资料下载」处可下载）</label>
        <div id="phCourseDocsBox">${phCiDocsHTML(docs)}</div></div>`,
    okText: '保存',
    onMount: (w) => {
      const titleInput = w.querySelector('#phCTitle');
      const box = w.querySelector('#phCoverBox');
      const refresh = () => { box.innerHTML = coverPreview(); };
      /* 上传封面 */
      const upBtn = w.querySelector('#phCoverUpBtn'), file = w.querySelector('#phCoverFile');
      upBtn.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files[0];
        if (!f) return;
        upBtn.disabled = true;
        upBtn.textContent = '上传中…';
        try {
          cover = await phUpload(f, 'image');
          refresh();
          toast('封面已上传', 'ok');
        } catch (e) { toast(e.message || '上传失败', 'warn'); }
        finally { upBtn.disabled = false; upBtn.innerHTML = `${ic('plus')} 上传封面`; file.value = ''; }
      };
      /* AI 生成封面（根据当前课程标题） */
      const aiBtn = w.querySelector('#phCoverAiBtn');
      aiBtn.onclick = async () => {
        const title = titleInput.value.trim();
        if (!title) return toast('请先填写课程标题，AI 会根据标题画封面', 'warn');
        aiBtn.disabled = true;
        aiBtn.textContent = '✨ AI 绘制中…（约 10 秒）';
        try {
          const r = await api('/api/admin/phonics/course-cover-ai', { method: 'POST', body: { title } });
          cover = r.key;
          refresh();
          toast(r.fallback ? 'AI 忙，已用模板封面生成' : '封面已生成', 'ok');
        } catch (e) { toast(e.message || '生成失败', 'warn'); }
        finally { aiBtn.disabled = false; aiBtn.textContent = '✨ AI 生成封面'; }
      };
      /* 课程讲义行（与课时讲义同一套绑定） */
      const docBox = w.querySelector('#phCourseDocsBox');
      if (docBox) phBindDocRows(docBox, docs);
    },
    onOk: async (w, err) => {
      const title = w.querySelector('#phCTitle').value.trim();
      if (!title) return err('请填写课程标题');
      await api('/api/admin/phonics/courses/save', {
        method: 'POST',
        body: { id: it.id || 0, mod: 'phonetic', title, sub: w.querySelector('#phCSub').value.trim(), sort: Number(w.querySelector('#phCSort').value) || 0, cover, docs: docs.filter((d) => d.key) },
      });
      await phCoursesLoad(); render();
      toast(isNew ? '课程已创建' : '已保存', 'ok');
      return true;
    },
  });
}
async function phCourseItemsLoad() {
  PH.courseItems = await api('/api/admin/phonics/course-items?courseId=' + PH.courseId);
  return PH.courseItems;
}
/** 课程资料快捷管理（课程列表「资料」按钮）：上传/改名/删除/下载课程配套讲义，保存只更新 docs（其余字段原样带回） */
function phCourseDocsForm(c) {
  if (!c) return;
  const docs = (c.docs || []).map((d) => ({ ...d }));
  modal({
    title: '课程资料：' + (c.title || ''),
    body: `
      <p class="w-tip" style="margin:0 0 10px">整个课程共用的配套讲义（PDF / 图片 / 文档），选完自动上传存服务器；学生端课程页「📄 资料下载」处可下载，此处每行也可直接下载。</p>
      <div id="phCourseDocsBox">${phCiDocsHTML(docs)}</div>`,
    okText: '保存',
    onMount: (w) => {
      const box = w.querySelector('#phCourseDocsBox');
      if (box) phBindDocRows(box, docs);
    },
    onOk: async (w, err) => {
      await api('/api/admin/phonics/courses/save', {
        method: 'POST',
        body: { id: c.id, mod: 'phonetic', title: c.title || '', sub: c.sub || '', sort: Number(c.sort) || 0, cover: c.cover || '', docs: docs.filter((d) => d.key) },
      });
      await phCoursesLoad(); render();
      toast('资料已保存', 'ok');
      return true;
    },
  });
}
function phCourseItemForm(item) {
  const isNew = !item;
  const it = item || { courseId: PH.courseId, cate: '', title: '', video: '', size: 0, sort: 0, docs: [] };
  const docs = (it.docs || []).map((d) => ({ ...d }));
  /* 批量模式：一次选多个视频 → 每个视频各建一个课时（标题用文件名） */
  const batch = [];
  modal({
    title: isNew ? '添加课时' : '编辑课时',
    body: `
      <div class="field"><label>所属分类（选填，学生端左侧导航分组，如：课文精讲 / 巧记单词）</label>
        <input class="input" id="phICate" value="${esc(it.cate || '')}" placeholder="留空则归入「课时」"></div>
      <div class="field"><label>课时标题 *（批量上传时不用填，自动用文件名）</label>
        <input class="input" id="phITitle" value="${esc(it.title)}" placeholder="如：1.单元导学"></div>
      <div class="field"><label>排序（数字越小越靠前；批量时从该数字起依次递增）</label>
        <input class="input" id="phISort" type="number" value="${Number(it.sort) || 0}"></div>
      <div class="field"><label>课时视频${isNew ? ' *（可按住 Ctrl / Shift 一次选多个，批量上传）' : '（不重新选择则保留原视频）'}</label>
        <div class="ph-up"><span class="ph-key" id="phIKeyEl">${isNew ? '未选择文件' : '保留原视频'}</span>
          <button class="btn ghost" id="phIFileBtn">${isNew ? '选择视频（可多选）' : '选择视频'}</button>
          <input type="file" id="phIFile" accept="video/*" ${isNew ? 'multiple' : ''} hidden></div>
        <div id="phIBatchList" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div></div>
      <div class="field"><label>配套讲义（PDF / 图片 / 文档，选完自动上传，存服务器；学生端、老师端均可下载）</label>
        <div id="phCiDocsBox">${phCiDocsHTML(docs)}</div></div>`,
    okText: '保存',
    onMount: (w) => {
      const btn = w.querySelector('#phIFileBtn'), inp = w.querySelector('#phIFile');
      const keyEl = w.querySelector('#phIKeyEl');
      const listEl = w.querySelector('#phIBatchList');
      const titleInput = w.querySelector('#phITitle');
      const fname = (n) => String(n || '').replace(/\.[^.]+$/, '');
      const renderBatch = () => {
        listEl.innerHTML = batch.map((b, i) => `<div style="font-size:12.5px;color:var(--text2)">📄 ${esc(i + 1 + '. ' + fname(b.name))} — ${b.key ? '<span style="color:var(--ok,#0e9f5f)">已上传</span>' : esc(b.status || '')}</div>`).join('');
        if (batch.length > 1) { titleInput.value = ''; titleInput.disabled = true; titleInput.placeholder = '批量模式：每个课时标题自动用文件名'; }
        else if (!batch.length) { titleInput.disabled = false; }
      };
      if (btn && inp) btn.onclick = () => inp.click();
      inp.onchange = async () => {
        const files = [...inp.files];
        if (!files.length) return;
        btn.disabled = true;
        try {
          if (files.length === 1) {
            /* 单文件：沿用原单课时逻辑 */
            const f = files[0];
            if (keyEl) keyEl.textContent = '上传中：' + f.name;
            const key = await phUpload(f, 'video', (done, total) => {
              if (keyEl && total) keyEl.textContent = '上传中：' + f.name + '（' + Math.round(done / total * 100) + '%）';
            });
            inp.dataset.key = key;
            inp.dataset.size = String(f.size || 0);
            if (keyEl) keyEl.textContent = f.name;
            toast('视频已上传，点「保存」完成', 'ok');
          } else {
            /* 批量：逐个分片直传 OSS */
            batch.length = 0;
            files.forEach((f) => batch.push({ name: f.name, size: f.size, key: '', status: '排队中' }));
            renderBatch();
            for (let i = 0; i < batch.length; i++) {
              const f = files[i];
              batch[i].status = '上传中…';
              renderBatch();
              if (keyEl) keyEl.textContent = `批量上传 ${i + 1} / ${batch.length}：${f.name}`;
              batch[i].key = await phUpload(f, 'video', (done, total) => {
                batch[i].status = '上传中 ' + (total ? Math.round(done / total * 100) : 0) + '%';
                renderBatch();
              });
              batch[i].status = '已上传';
              renderBatch();
            }
            if (keyEl) keyEl.textContent = `已上传 ${batch.length} 个视频，点「保存」完成`;
            toast(`已上传 ${batch.length} 个视频，点「保存」批量创建课时`, 'ok');
          }
        } catch (e) {
          if (keyEl) keyEl.textContent = '上传失败';
          toast(e.message || '上传失败', 'warn');
        } finally {
          btn.disabled = false;
          inp.value = '';
        }
      };
      /* 讲义行：增 / 删 / 更换 / 上传（选完即传，存服务器本地 phonics/file） */
      const docBox = w.querySelector('#phCiDocsBox');
      if (docBox) phBindDocRows(docBox, docs);
    },
    onOk: async (w, err) => {
      const inp = w.querySelector('#phIFile');
      const baseSort = Number(w.querySelector('#phISort').value) || 0;
      const cate = w.querySelector('#phICate').value.trim();
      const btn = w.querySelector('#mOk');
      try {
        if (batch.length > 1) {
          /* 批量：每个视频各建一个课时，标题用文件名，排序递增 */
          if (!batch.every((b) => b.key)) return err('还有视频未上传完成');
          btn.innerHTML = '<span class="spinner"></span> 创建中';
          for (let i = 0; i < batch.length; i++) {
            await api('/api/admin/phonics/course-items/save', {
              method: 'POST',
              body: { id: 0, courseId: PH.courseId, cate, title: batch[i].name.replace(/\.[^.]+$/, ''), sort: baseSort + i, video: batch[i].key, size: batch[i].size || 0, docs: [] },
            });
          }
          await phCourseItemsLoad(); await phCoursesLoad(); render();
          toast(`已批量添加 ${batch.length} 个课时`, 'ok');
          return true;
        }
        const title = w.querySelector('#phITitle').value.trim();
        if (!title) return err('请填写课时标题');
        const video = inp.dataset.key || (isNew ? '' : it.video || '');
        if (!video) return err(isNew ? '请选择并上传视频文件' : '该课时还没有视频，请选择视频');
        btn.innerHTML = '<span class="spinner"></span> 保存中';
        await api('/api/admin/phonics/course-items/save', {
          method: 'POST',
          body: {
            id: it.id || 0, courseId: PH.courseId,
            cate,
            title,
            sort: baseSort,
            video, size: Number(inp.dataset.size) || it.size || 0,
            docs: docs.filter((d) => d.key),
          },
        });
        await phCourseItemsLoad(); await phCoursesLoad(); render();
        toast(isNew ? '课时已添加' : '已保存', 'ok');
        return true;
      } catch (e) { return err(e.message || '保存失败'); }
    },
  });
}
function phCourseHTML() {
  const courses = PH.courses || [];
  /* 二级：管理某个课程下的课时 */
  if (PH.courseId) {
    const c = courses.find((x) => Number(x.id) === Number(PH.courseId)) || { title: '' };
    const items = PH.courseItems || [];
    const fmtSize = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    return `
    <div class="card">
      <div class="card-h"><h3>${ic('play')} 管理课时：${esc(c.title)}</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" id="phCBack">← 返回课程列表</button>
          <button class="btn primary-sm" id="phINew">${ic('plus')} 添加课时</button>
        </div></div>
      <p class="w-tip" style="margin:0 0 10px">课时按「分类 → 排序」展示在学生端课程详情里；视频存阿里云 OSS，配套讲义存服务器（学生端可下载）。分类留空则归入「课时」。可用 ↑ / ↓ 自由调整顺序。</p>
      ${items.length ? `<table><thead><tr><th>分类</th><th>课时标题</th><th>视频</th><th>配套讲义</th><th>排序</th><th style="width:170px">操作</th></tr></thead><tbody>${items.map((it, ix) => {
        const dl = (f) => `/api/file?key=${encodeURIComponent(f.key)}&token=${encodeURIComponent(Auth.token || '')}&name=${encodeURIComponent(f.title || phKeyName(f.key))}`;
        return `
        <tr>
          <td>${esc(it.cate || '课时')}</td>
          <td><b>${esc(it.title)}</b></td>
          <td>${it.video ? '<span class="tag">已上传</span> <span style="color:var(--text3);font-size:12px">' + fmtSize(it.size) + '</span>' : '<span style="color:var(--danger)">未上传</span>'}</td>
          <td>${(it.docs || []).length ? it.docs.map((f) => `<a class="link-btn" style="display:inline-flex;align-items:center;white-space:nowrap" href="${dl(f)}" target="_blank" title="${esc(f.title || phKeyName(f.key))}">⬇ ${esc(f.title || phKeyName(f.key))}</a>`).join('<span style="color:var(--text3)"> / </span>') : '<span style="color:var(--text3)">—</span>'}</td>
          <td>${Number(it.sort) || 0}</td>
          <td><div class="acts">
            <button class="link-btn" data-phmv="up" data-ix="${ix}" ${ix === 0 ? 'disabled' : ''} title="上移">↑</button>
            <button class="link-btn" data-phmv="down" data-ix="${ix}" ${ix === items.length - 1 ? 'disabled' : ''} title="下移">↓</button>
            <button class="link-btn" data-phiedit="${it.id}">编辑</button>
            <button class="link-btn danger" data-phidel="${it.id}">删除</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody></table>`
        : '<div class="empty">还没有课时，点右上角「添加课时」上传视频</div>'}
    </div>`;
  }
  /* 一级：课程列表 */
  return `
  <div class="card">
    <div class="card-h"><h3>${ic('play')} 系统课课程</h3>
      <button class="btn primary-sm" id="phCNew">${ic('plus')} 新建课程</button></div>
    <p class="w-tip" style="margin:0 0 10px">学生端「音标训练 → 系统课」按排序显示课程卡片；点「管理课时」给课程上传多个视频（按分类分组展示）。编辑课程里可上传或 AI 生成封面；点「资料」上传/下载课程配套讲义（学生端课程页「📄 资料下载」可下载）。</p>
    ${courses.length ? `<table><thead><tr><th>封面</th><th>排序</th><th>课程标题</th><th>说明</th><th>课时数</th><th style="width:220px">操作</th></tr></thead><tbody>${courses.map((c) => {
      const thumb = c.cover ? `/api/file?key=${encodeURIComponent(c.cover)}&token=${encodeURIComponent(Auth.token || '')}` : '';
      return `
      <tr>
        <td>${thumb ? `<img src="${esc(thumb)}" style="width:72px;height:41px;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block">` : '<span style="color:var(--text3)">—</span>'}</td>
        <td>${Number(c.sort) || 0}</td>
        <td><b>${esc(c.title)}</b></td>
        <td>${esc(c.sub || '')}</td>
        <td>${c.itemCount || 0}</td>
        <td><div class="acts">
          <button class="link-btn" data-phcitems="${c.id}">管理课时</button>
          <button class="link-btn" data-phcedit="${c.id}">编辑</button>
          <button class="link-btn" data-phcdocs="${c.id}">资料${(c.docs || []).length ? '(' + c.docs.length + ')' : ''}</button>
          <button class="link-btn danger" data-phcdel="${c.id}">删除</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`
      : '<div class="empty">还没有课程，点右上角「新建课程」创建</div>'}
  </div>`;
}
async function phCourseBind() {
  const nb = document.getElementById('phCNew');
  if (nb) nb.onclick = () => phCourseForm(null);
  const back = document.getElementById('phCBack');
  if (back) back.onclick = () => { PH.courseId = 0; render(); };
  const inew = document.getElementById('phINew');
  if (inew) inew.onclick = () => phCourseItemForm(null);
  document.querySelectorAll('[data-phcitems]').forEach((b) => b.onclick = async () => {
    PH.courseId = Number(b.dataset.phcitems);
    await phCourseItemsLoad(); render();
  });
  document.querySelectorAll('[data-phcedit]').forEach((b) => b.onclick = () => {
    phCourseForm((PH.courses || []).find((x) => String(x.id) === b.dataset.phcedit));
  });
  document.querySelectorAll('[data-phcdocs]').forEach((b) => b.onclick = () => {
    phCourseDocsForm((PH.courses || []).find((x) => String(x.id) === b.dataset.phcdocs));
  });
  document.querySelectorAll('[data-phcdel]').forEach((b) => b.onclick = () => {
    const c = (PH.courses || []).find((x) => String(x.id) === b.dataset.phcdel);
    modal({
      title: '删除课程',
      body: `<p class="w-tip">将删除课程「${c ? esc(c.title) : ''}」及其全部课时，删除后不可恢复。</p>`,
      okText: '删除',
      onOk: async () => {
        await api('/api/admin/phonics/courses/del', { method: 'POST', body: { id: Number(b.dataset.phcdel) } });
        if (PH.courseId === Number(b.dataset.phcdel)) PH.courseId = 0;
        await phCoursesLoad(); render();
        toast('已删除', 'ok');
        return true;
      },
    });
  });
  document.querySelectorAll('[data-phiedit]').forEach((b) => b.onclick = () => {
    phCourseItemForm((PH.courseItems || []).find((x) => String(x.id) === b.dataset.phiedit));
  });
  document.querySelectorAll('[data-phidel]').forEach((b) => b.onclick = () => {
    modal({
      title: '删除课时',
      body: '<p class="w-tip">将删除该课时视频，删除后不可恢复。</p>',
      okText: '删除',
      onOk: async () => {
        await api('/api/admin/phonics/course-items/del', { method: 'POST', body: { id: Number(b.dataset.phidel) } });
        await phCourseItemsLoad(); await phCoursesLoad(); render();
        toast('已删除', 'ok');
        return true;
      },
    });
  });
  /* 课时自由排序：↑ / ↓ 与相邻项交换位置，全量按新顺序落库 */
  document.querySelectorAll('[data-phmv]').forEach((b) => b.onclick = async () => {
    const items = PH.courseItems || [];
    const ix = Number(b.dataset.ix);
    const j = b.dataset.phmv === 'up' ? ix - 1 : ix + 1;
    if (ix < 0 || j < 0 || j >= items.length) return;
    const arr = items.map((x, i) => ({ id: x.id, sort: i }));
    const t = arr[ix]; arr[ix] = arr[j]; arr[j] = t;
    arr.forEach((x, i) => { x.sort = i; });
    try {
      await api('/api/admin/phonics/course-items/reorder', { method: 'POST', body: { items: arr } });
      await phCourseItemsLoad(); render();
    } catch (e) { toast(e.message || '排序失败', 'warn'); }
  });
}

/* ---- 音标训练 · 训练场题库管理（每个题型单独题库） ---- */
const PH_QUIZ_MODES = {
  find: '音标侦探（看音标 → 选含这个音的单词）',
  listen: '听力挑战（听单词 → 选音标）',
  sort: '分类高手（判断元音 / 辅音）',
};
async function phQuizLoad() {
  PH.quiz = await api('/api/admin/phonics/quiz-list' + (PH.quizMode ? '?mode=' + PH.quizMode : ''));
  return PH.quiz;
}
function phQuizForm(item) {
  const isNew = !item;
  const it = item || { mode: PH.quizMode || 'find', sayText: '', say: '', options: ['', '', '', ''], ans: '' };
  const modes = Object.entries(PH_QUIZ_MODES);
  const modeFields = (m) => {
    if (m === 'find') return `
      <div class="field"><label>音标 *（从下拉选择，自动带真人发音）</label>
        <select class="input" id="phQSay">${PH.items.filter((x) => x.type !== 'letter').map((x) =>
          `<option value="${esc(x.title)}" data-audio="${esc(x.audio || '')}" ${x.title === it.sayText ? 'selected' : ''}>${esc(x.title)} ${esc(x.mnemonic || '')}</option>`).join('')}</select></div>
      <div class="field"><label>选项（单词，2~4 个）</label><div id="phQOpts">
        ${[0, 1, 2, 3].map((i) => `<input class="input" data-qopt="${i}" value="${esc((it.options || [])[i] || '')}" placeholder="选项 ${i + 1}" style="margin-bottom:6px">`).join('')}</div></div>
      <div class="field"><label>正确答案 *</label><select class="input" id="phQAns"></select></div>`;
    if (m === 'listen') return `
      <div class="field"><label>单词 *（学生端自动朗读这个单词）</label>
        <input class="input" id="phQWord" value="${esc(it.sayText)}" placeholder="如 fish"></div>
      <div class="field"><label>选项（音标，2~4 个）</label><div id="phQOpts">
        ${[0, 1, 2, 3].map((i) => `<input class="input" data-qopt="${i}" value="${esc((it.options || [])[i] || '')}" placeholder="如 /iː/" style="margin-bottom:6px">`).join('')}</div></div>
      <div class="field"><label>正确答案 *</label><select class="input" id="phQAns"></select></div>`;
    return `
      <div class="field"><label>音标 *（从下拉选择，自动带真人发音）</label>
        <select class="input" id="phQSay">${PH.items.filter((x) => x.type !== 'letter').map((x) =>
          `<option value="${esc(x.title)}" data-audio="${esc(x.audio || '')}" data-type="${esc(x.type || '')}" ${x.title === it.sayText ? 'selected' : ''}>${esc(x.title)}（${x.type === 'vowel' ? '元音' : '辅音'}）</option>`).join('')}</select></div>
      <div class="field"><label>正确答案 *</label>
        <select class="input" id="phQSortAns">
          <option value="元音" ${it.ans === '元音' ? 'selected' : ''}>元音</option>
          <option value="辅音" ${it.ans === '辅音' ? 'selected' : ''}>辅音</option></select></div>`;
  };
  const cur = it.mode || 'find';
  modal({
    title: isNew ? '新增题目' : '编辑题目',
    wide: true,
    body: `
      <div class="field"><label>题型 *</label>
        <select class="input" id="phQMode" ${isNew ? '' : 'disabled'}>${modes.map(([k, t]) =>
          `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div id="phQModeFields">${modeFields(cur)}</div>
      <p class="w-tip">音标侦探 / 听力挑战 至少 2 个选项（建议 4 个）；正确答案必须与某个选项完全一致。</p>`,
    okText: '保存',
    onMount: (w) => {
      /* 选项 → 答案下拉联动 */
      const syncAns = () => {
        const m = w.querySelector('#phQMode').value;
        if (m === 'sort') return;
        const sel = w.querySelector('#phQAns');
        if (!sel) return;
        const vals = [...w.querySelectorAll('[data-qopt]')].map((i) => i.value.trim()).filter(Boolean);
        const keep = sel.value;
        sel.innerHTML = vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        if (vals.includes(keep)) sel.value = keep;
      };
      w.addEventListener('input', (e) => { if (e.target && e.target.dataset && e.target.dataset.qopt !== undefined) syncAns(); });
      w.querySelector('#phQMode').onchange = () => {
        /* 切题型时重画对应字段（仅新增时允许切换） */
        const wrap = w.querySelector('#phQModeFields');
        wrap.innerHTML = modeFields(w.querySelector('#phQMode').value);
        const sel = w.querySelector('#phQAns');
        if (sel) syncAns();
      };
      syncAns();
      /* 编辑已有题目时，syncAns 首次执行时下拉还没有值可"保留"，这里显式回填原答案 */
      if (!isNew && it.ans) {
        const sel0 = w.querySelector('#phQAns');
        if (sel0 && [...sel0.options].some((o) => o.value === it.ans)) sel0.value = it.ans;
      }
    },
    onOk: async (w, err) => {
      const mSel = w.querySelector('#phQMode');
      const mode = isNew ? mSel.value : cur;
      let sayText = '', say = '', options = [], ans = '';
      if (mode === 'sort') {
        const sel = w.querySelector('#phQSay');
        sayText = sel.value;
        say = sel.selectedOptions[0] ? (sel.selectedOptions[0].dataset.audio || '') : '';
        ans = w.querySelector('#phQSortAns').value;
        options = ['元音', '辅音'];
      } else if (mode === 'find') {
        const sel = w.querySelector('#phQSay');
        sayText = sel.value;
        say = sel.selectedOptions[0] ? (sel.selectedOptions[0].dataset.audio || '') : '';
        options = [...w.querySelectorAll('[data-qopt]')].map((i) => i.value.trim()).filter(Boolean);
        ans = w.querySelector('#phQAns').value;
      } else {
        sayText = w.querySelector('#phQWord').value.trim();
        options = [...w.querySelectorAll('[data-qopt]')].map((i) => i.value.trim()).filter(Boolean);
        ans = w.querySelector('#phQAns').value;
      }
      const btn = w.querySelector('#mOk');
      btn.innerHTML = '<span class="spinner"></span> 保存中';
      try {
        await api('/api/admin/phonics/quiz/save', {
          method: 'POST',
          body: { id: it.id || 0, mode, sayText, say, options, ans },
        });
        await phQuizLoad(); render();
        toast(isNew ? '题目已添加' : '已保存', 'ok');
        return true;
      } catch (e) { return err(e.message || '保存失败'); }
    },
  });
}
function phQuizHTML() {
  const qs = PH.quiz || [];
  const modes = [['', '全部'], ...Object.entries(PH_QUIZ_MODES).map(([k, v]) => [k, k === 'find' ? '音标侦探' : k === 'listen' ? '听力挑战' : '分类高手'])];
  return `
  <div class="card">
    <div class="card-h"><h3>${ic('book')} 训练场题库</h3>
      <div style="display:flex;gap:8px">
        <button class="btn ghost" id="phQTemplate">⬇ 下载导入模板</button>
        <button class="btn ghost" id="phQImport">📥 批量导入</button>
        <input type="file" id="phQImportFile" accept=".xlsx,.xls" hidden>
        <button class="btn primary-sm" id="phQNew">${ic('plus')} 新增题目</button>
      </div></div>
    <p class="w-tip" style="margin:0 0 10px">训练场三个题型各自独立题库；某个题型题库不足时，学生端自动回退到内置出题（用音标示范词生成）。</p>
    <div class="toolbar" style="margin-bottom:12px">
      ${modes.map(([k, t]) => `<button class="btn ${PH.quizMode === k ? 'primary-sm' : 'ghost'}" data-phqmode="${k}">${t}</button>`).join('')}
    </div>
    ${qs.length ? `<table><thead><tr><th>#</th><th>题型</th><th>题目</th><th>选项</th><th>答案</th><th style="width:110px">操作</th></tr></thead><tbody>${qs.map((x, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${x.mode === 'find' ? '音标侦探' : x.mode === 'listen' ? '听力挑战' : '分类高手'}</td>
        <td><b>${esc(x.q)}</b></td>
        <td>${esc((x.options || []).join(' / '))}</td>
        <td><span class="tag">${esc(x.ans)}</span></td>
        <td><div class="acts">
          <button class="link-btn" data-phqedit="${x.id}">编辑</button>
          <button class="link-btn danger" data-phqdel="${x.id}">删除</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`
      : '<div class="empty">该题型还没有题目，点右上角「新增题目」添加</div>'}
  </div>`;
}
function phQuizBind() {
  const nb = document.getElementById('phQNew');
  if (nb) nb.onclick = () => phQuizForm(null);
  /* 下载导入模板（带鉴权头，fetch blob 另存） */
  const tb = document.getElementById('phQTemplate');
  if (tb) tb.onclick = async () => {
    tb.disabled = true;
    try {
      const r = await fetch('/api/admin/phonics/quiz/template', { headers: { Authorization: 'Bearer ' + Auth.token } });
      if (!r.ok) throw new Error('下载失败（' + r.status + '）');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '训练题库导入模板.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast(e.message || '下载失败', 'warn'); }
    finally { tb.disabled = false; }
  };
  /* 批量导入 xlsx */
  const ib = document.getElementById('phQImport'), ifile = document.getElementById('phQImportFile');
  if (ib && ifile) {
    ib.onclick = () => ifile.click();
    ifile.onchange = async () => {
      const f = ifile.files[0];
      if (!f) return;
      ib.disabled = true;
      ib.textContent = '导入中…';
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await fetch('/api/admin/phonics/quiz/import', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.token }, body: fd });
        const j = await r.json();
        if (j.code !== 0) throw new Error(j.msg || '导入失败');
        PH.quiz = await phQuizLoad(); render();
        const errs = (j.data.errors || []);
        toast('已导入 ' + j.data.added + ' 题' + (j.data.failed ? '，' + j.data.failed + ' 条格式错误被跳过' + (errs.length ? '：' + errs[0] : '') : ''), errs.length ? 'warn' : 'ok');
      } catch (e) { toast(e.message || '导入失败', 'warn'); }
      finally { ib.disabled = false; ib.textContent = '📥 批量导入'; ifile.value = ''; }
    };
  }
  document.querySelectorAll('[data-phqmode]').forEach((b) => b.onclick = () => { PH.quizMode = b.dataset.phqmode; render(); });
  document.querySelectorAll('[data-phqedit]').forEach((b) => b.onclick = () => {
    phQuizForm((PH.quiz || []).find((x) => String(x.id) === b.dataset.phqedit));
  });
  document.querySelectorAll('[data-phqdel]').forEach((b) => b.onclick = () => {
    modal({
      title: '删除题目',
      body: '<p class="w-tip">将删除该题目，删除后不可恢复。</p>',
      okText: '删除',
      onOk: async () => {
        await api('/api/admin/phonics/quiz/del', { method: 'POST', body: { id: Number(b.dataset.phqdel) } });
        await phQuizLoad(); render();
        toast('已删除', 'ok');
        return true;
      },
    });
  });
}

async function viewPhonics() {
  await phLoad();
  const isLetter = PH.kind === 'letters';
  const ex = await phExtrasLoad();
  if (isLetter) {
    if (PH.tab !== 'song' && PH.tab !== 'material') PH.tab = 'list';
  } else {
    if (PH.tab !== 'song' && PH.tab !== 'material' && PH.tab !== 'course' && PH.tab !== 'quiz') PH.tab = 'list';
  }
  /* 页内子版块导航按钮：点一个进入一个（字母乐园 / 音标训练） */
  const TABS = isLetter
    ? [['list', '📋 字母列表'], ['song', '🎵 字母歌视频'], ['material', '📄 配套资料']]
    : [['list', '🔊 音标列表'], ['course', '🎬 系统课课程'], ['quiz', '📝 训练题库'], ['material', '📄 配套资料']];
  const tabBar = `
    <div class="card" style="margin-bottom:14px">
      <div class="toolbar" style="margin:0">
        ${TABS.map(([k, t]) =>
          `<button class="btn ${PH.tab === k ? 'primary-sm' : 'ghost'}" data-phtab="${k}">${t}</button>`).join('')}
      </div>
    </div>`;
  let body = '';
  if (PH.tab === 'song') {
    body = phSongHTML(ex, isLetter);
  } else if (PH.tab === 'material') {
    body = phMatHTML(ex);
  } else if (!isLetter && PH.tab === 'course') {
    await phCoursesLoad();
    if (PH.courseId) await phCourseItemsLoad().catch(() => { PH.courseId = 0; });
    body = phCourseHTML();
  } else if (!isLetter && PH.tab === 'quiz') {
    await phQuizLoad();
    body = phQuizHTML();
  } else {
    const q = String(PH.kw || '').trim();
    const list = q ? PH.items.filter((x) => (x.title + ' ' + x.cue + ' ' + x.code).toLowerCase().includes(q.toLowerCase())) : PH.items;
    const pg = pageOf(list, 'phPage', 10);   // 每页最多 10 条，下一页翻页
    body = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><h3>${ic('book')} ${PH_KINDS[PH.kind]}</h3>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" id="phSeedBtn">${ic('refresh')} 初始化默认数据</button>
          <button class="btn primary-sm" id="phNew">${ic('plus')} 新增${isLetter ? '字母' : '音标'}</button>
        </div></div>
      <p class="w-tip" style="margin:0">${PH_TIP[PH.kind]}　共 <b>${PH.items.length}</b> 条，与学生端「训练 → 语音基础 → ${PH_KINDS[PH.kind]}」一一对应。</p>
      <div class="toolbar" style="margin-top:12px">
        <input class="input" id="phKw" placeholder="搜索" value="${esc(PH.kw)}">
        <button class="btn ghost" id="phSearch">查询</button>
      </div>
    </div>
    <div class="card">
      ${pg.list.length ? `<table><thead><tr>
        <th>#</th><th>${isLetter ? '字母' : '音标'}</th>${isLetter ? '' : '<th>类型</th><th>拟音</th>'}
        <th>发音</th><th>${isLetter ? '笔顺' : '口型视频'}</th><th>${isLetter ? '拼读视频' : '教学视频'}</th><th>资料</th><th>操作</th>
      </tr></thead><tbody>${pg.list.map((x, i) => `
        <tr>
          <td>${(pg.page - 1) * pg.size + i + 1}</td>
          <td><b>${esc(x.title)}</b>${x.mnemonic ? `<div style="font-size:12px;color:var(--text3)">${esc(x.mnemonic)}</div>` : ''}</td>
          ${isLetter ? '' : `<td>${x.type === 'vowel' ? '元音' : '辅音'}</td><td>${esc(x.cue || '')}</td>`}
          <td>${x.audio ? '<span class="tag">已配</span>' : '<span style="color:var(--text3)">系统发音</span>'}</td>
          <td>${(isLetter ? x.stroke : x.video_mouth) ? '<span class="tag">已配</span>' : '<span style="color:var(--text3)">—</span>'}</td>
          <td>${x.video_teach ? '<span class="tag">已配</span>' : '<span style="color:var(--text3)">—</span>'}</td>
          <td>${(x.files || []).length || '<span style="color:var(--text3)">—</span>'}</td>
          <td><div class="acts">
            <button class="link-btn" data-phedit="${x.id}">编辑</button>
            <button class="link-btn danger" data-phdel="${x.id}">删除</button>
          </div></td>
        </tr>`).join('')}</tbody></table>
        ${pg.total > pg.size ? pagerHTML(pg.page, pg.size, pg.total, 'phPage') : ''}`
        : `<div class="empty">还没有内容，点右上角「初始化默认数据」一键生成${isLetter ? ' 26 个字母' : ' 48 个音标'}</div>`}
    </div>`;
  }
  return {
    html: tabBar + body,
    after: () => {
      document.querySelectorAll('[data-phtab]').forEach((b) => b.onclick = () => { PH.tab = b.dataset.phtab; if (PH.tab !== 'course') PH.courseId = 0; render(); });
      bindPager('phPage');
      if (PH.tab === 'song' || PH.tab === 'material') phExtrasBind();
      if (PH.tab === 'course') phCourseBind();
      if (PH.tab === 'quiz') phQuizBind();
      const seedBtn = document.getElementById('phSeedBtn');
      if (seedBtn) seedBtn.onclick = phSeed;
      const nb = document.getElementById('phNew');
      if (nb) nb.onclick = () => phEditForm(null);
      const sk = document.getElementById('phSearch');
      if (sk) sk.onclick = () => { PH.kw = document.getElementById('phKw').value; render(); };
      document.querySelectorAll('[data-phedit]').forEach((b) => b.onclick = () => {
        phEditForm(PH.items.find((x) => String(x.id) === b.dataset.phedit));
      });
      document.querySelectorAll('[data-phdel]').forEach((b) => b.onclick = () => {
        const it = PH.items.find((x) => String(x.id) === b.dataset.phdel);
        askPwd('删除' + (isLetter ? '字母' : '音标'), `将删除「${it ? it.title : ''}」，删除后不可恢复。`, async (pwd, err) => {
          const r = await api('/api/admin/phonics/del', { method: 'POST', body: { id: Number(b.dataset.phdel), pwd } });
          if (r && r.code !== 0) return err(r.msg || '删除失败');
          await phLoad(); render(); toast('已删除', 'ok'); return true;
        });
      });
    },
  };
}
/* 训练管理下的两个独立子模块入口（左侧导航：字母乐园 / 音标训练） */
async function viewPhonicsLetters() { PH.kind = 'letters'; PH.kw = ''; return viewPhonics(); }
async function viewPhonicsPhonetic() { PH.kind = 'phonetic'; PH.kw = ''; return viewPhonics(); }
window.viewPhonicsLetters = viewPhonicsLetters;
window.viewPhonicsPhonetic = viewPhonicsPhonetic;
window.viewPhonics = viewPhonics;
