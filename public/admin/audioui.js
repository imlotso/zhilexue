/* 听力题的音频字段（T7）：题目编辑 / 新建 / 待审核编辑共用。
 * 两种方式给题目加音频：① 上传一段音频文件（mp3 / m4a / wav / ogg / aac / webm）；② 填一段文字，点「生成朗读」用服务器的语音合成生成。
 * 音频存在题库音频目录（bank/audio/…），题目里只记 key（questions.audio_key）。
 * 用法：const aud = t7AudioWidget(容器元素, { key, url }); …保存时 body.audio_key = aud.get();
 * 依赖 admin.js 的 esc，api.js 的 api / toast / Auth。 */
const T7_API = '/api/admin/bank/mf/audio';

/** 后台预览用的地址：本地存储的 /api/file 地址需要带登录票据（<audio> 带不了请求头） */
function t7Src(u) {
  const s = String(u || '');
  if (s.startsWith('/api/file?') && !/[?&]token=/.test(s) && typeof Auth !== 'undefined' && Auth.token) return s + '&token=' + encodeURIComponent(Auth.token);
  return s;
}

function t7AudioWidget(root, init) {
  let key = (init && init.key) || '';
  let url = (init && init.url) || '';
  let label = key ? '已有音频' : '';
  root.innerHTML = `<div class="t7-adm">
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">🎧 听力音频（选填：听力题上传音频，学生端题目上方会出现播放条）</div>
    <div class="t7-adm-row">
      <input type="file" class="t7-file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.webm" style="display:none">
      <button type="button" class="btn ghost xs t7-up">上传音频</button>
      <button type="button" class="btn ghost xs t7-ttsbtn">用文字生成朗读</button>
      <button type="button" class="btn ghost xs t7-del" style="display:none">去掉音频</button>
      <span class="t7-name"></span>
    </div>
    <div class="t7-tts" style="display:none;margin-top:8px">
      <textarea class="inp t7-text" rows="3" style="width:100%" placeholder="要朗读的文字（英文听力材料，最多 500 字）"></textarea>
      <div class="t7-adm-row" style="margin-top:6px">
        <select class="inp t7-lang" style="width:96px"><option value="en">英文</option><option value="zh">中文</option></select>
        <button type="button" class="btn primary xs t7-gen">生成朗读</button>
        <span class="hint">生成后可以先试听，满意再保存题目</span>
      </div>
    </div>
    <div class="t7-player"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const paint = () => {
    $('.t7-name').textContent = key ? '✓ ' + label : '还没有音频';
    $('.t7-del').style.display = key ? '' : 'none';
    $('.t7-player').innerHTML = key ? `<audio controls preload="none" playsinline src="${esc(t7Src(url))}"></audio>` : '';
  };
  const set = (r, name) => { key = r.key; url = r.url; label = name || r.name || '音频'; paint(); };
  $('.t7-up').onclick = () => $('.t7-file').click();
  $('.t7-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast('音频不能超过 25MB', 'err'); e.target.value = ''; return; }
    const btn = $('.t7-up'); btn.disabled = true; btn.textContent = '上传中…';
    try { const fd = new FormData(); fd.append('file', f); set(await api(T7_API + '/upload', { method: 'POST', body: fd, raw: true }), f.name); toast('音频已上传', 'ok'); }
    catch (err) { /* api 已提示 */ }
    btn.disabled = false; btn.textContent = '上传音频'; e.target.value = '';
  };
  $('.t7-ttsbtn').onclick = () => { const b = $('.t7-tts'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
  $('.t7-gen').onclick = async () => {
    const text = $('.t7-text').value.trim();
    if (!text) return toast('先填要朗读的文字', 'err');
    const btn = $('.t7-gen'); btn.disabled = true; btn.textContent = '生成中…';
    try { set(await api(T7_API + '/tts', { method: 'POST', body: { text, lang: $('.t7-lang').value } }), '朗读音频'); toast('已生成，可以试听', 'ok'); }
    catch (err) { /* api 已提示 */ }
    btn.disabled = false; btn.textContent = '生成朗读';
  };
  $('.t7-del').onclick = () => { key = ''; url = ''; label = ''; paint(); };
  paint();
  return { get: () => key, url: () => url };
}
