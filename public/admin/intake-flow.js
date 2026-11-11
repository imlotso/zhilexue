/* 录题共用的传输状态、恢复提示和教程。按账号保存本机草稿与批次线索，不保存文件内容。 */
'use strict';
window.R4Flow = (() => {
  const memory = new Map();
  const hash = value => { let a = 2166136261, b = 5381; for (const c of String(value)) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); } return (a >>> 0).toString(16) + (b >>> 0).toString(16); };
  const owner = () => { try { const user=Auth.user;return user && user.id ? `user-${user.id}` : `token-${hash(Auth.token || '')}`; } catch (_) {storageUnavailable=true;return 'storage-disabled';} };
  const key = kind => `r4-intake-v2:${owner()}:${kind}`;
  const legacyKey = kind => { let h = 2166136261; for (const c of String(Auth.token || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return `r4-intake:${h >>> 0}:${kind}`; };
  let storageUnavailable = false;
  const read = kind => {
    try {
      const raw = localStorage.getItem(key(kind));
      if (raw) return JSON.parse(raw);
      const old = sessionStorage.getItem(legacyKey(kind));
      if (old) { localStorage.setItem(key(kind), old); sessionStorage.removeItem(legacyKey(kind)); return JSON.parse(old); }
    } catch (_) { storageUnavailable = true; }
    return memory.get(key(kind)) || null;
  };
  const save = (kind, value) => {
    const data = { ...value, at: Date.now() }; memory.set(key(kind), data);
    try { localStorage.setItem(key(kind), JSON.stringify(data)); return true; }
    catch (_) { storageUnavailable = true; return false; }
  };
  const clear = kind => { memory.delete(key(kind)); try { localStorage.removeItem(key(kind)); sessionStorage.removeItem(legacyKey(kind)); } catch (_) {} };
  const requestKey = (kind, signature) => {
    const stored = read(kind + '-requests') || { keys: {} }; if (!stored.keys || typeof stored.keys !== 'object') stored.keys = {}; const signatureKey = hash(signature);
    if (!stored.keys[signatureKey]) { stored.keys[signatureKey] = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2)); save(kind + '-requests', stored); }
    return stored.keys[signatureKey];
  };
  async function fingerprint(fd) {
    const values = [];
    for (const [name, value] of fd.entries()) {
      if (typeof value === 'string') values.push([name, value]);
      else {
        const bytes = await value.arrayBuffer(); let digest;
        if (globalThis.crypto && crypto.subtle) digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        else { let a = 2166136261; for (const n of new Uint8Array(bytes)) a = Math.imul(a ^ n, 16777619); digest = value.size + ':' + (a >>> 0); }
        values.push([name, name === 'pages' && fd.has('source_document_key') ? 'pdf-page-' + fd.get('source_page') : value.name, digest]);
      }
    }
    return JSON.stringify(values.sort(([a],[b])=>a.localeCompare(b)));
  }
  const help = () => modal({ title: '录题教程与中断恢复', body: `<ol><li>准备：选择学科、学段、教材资料；模板保留原表头，原文没有的答案、解析留空。</li><li>上传或录入：上传进度仅表示传输，不代表解析完成。格式错误可修正后重试；部分成功时只补传失败内容。</li><li>核对入库：从最近批次继续。核对题型、材料、小问、选项、公式、图片和分类；AI 答案与解析均为建议，须老师分别确认。</li></ol><p>网络中断、中止等待或超时后，服务器可能仍在保存。先查看最近批次，确认是否已接收，再决定补传，避免重复题目。已上传的页图和已保存题卡可在批次中继续；未上传的本地文件需要重新选择，不支持文件字节级续传。</p><p>手动录题文字、JSON 输入和恢复线索按账号保存在本机浏览器，关闭标签页后可以继续；不会同步到其他设备。清理浏览器数据会删除本机草稿，共用电脑请在完成后清除草稿。浏览器不允许存储时会提示，不能保证关闭后的恢复。</p><p>英语排序题在 Word 中使用“听力排序题”或“连词成句题”，选项 A.、B. 逐行填写，答案如 B,A。共同材料使用独立行 [材料]、原文、[材料结束]，之后逐题填写；独立题之前加 [材料清空]。开放问答选问答基础题型，由老师评分；填空按老师提供的答案逐空比对，备选用 |||。</p>` });
  const bind = (root, kind) => {
    if (!root) return;
    const old = root.querySelector('.r4-flow-notice'); if (old) old.remove();
    const box = document.createElement('div'); box.className = 'r4-flow-notice'; box.setAttribute('aria-live', 'polite');
    const state = read(kind);
    const text = state ? state.phase === 'saved' ? `上次已保存${state.name ? '：' + state.name : ''}。可从最近批次继续核对。` : state.phase === 'error' ? `上次处理失败：${state.message || '请检查文件后重试'}。` : '上次处理已中断或结果未确认。请先检查最近批次；未上传的本地文件需要重新选择。' : '上传、解析和核对分别显示状态；中断后先检查最近批次再补传。';
    const draft = read(kind === 'manual' ? 'manual-draft' : kind === 'skill' ? 'skill-text' : kind + '-prepare');
    const label = document.createElement('span'); label.textContent = storageUnavailable ? '浏览器未允许保存本机草稿，关闭页面后可能无法恢复，请及时送审。' : state && ['sending','uncertain','error'].includes(state.phase) ? text : draft ? '已找到本账号的本机草稿，可继续录入；关闭标签页后仍保留。' : text; box.appendChild(label);
    const tutorial = document.createElement('button'); tutorial.type = 'button'; tutorial.className = 'btn ghost sm'; tutorial.textContent = '教程与恢复说明'; tutorial.onclick = help; box.appendChild(tutorial);
    if (state) { const check = document.createElement('button'); check.type = 'button'; check.className = 'btn ghost sm'; check.textContent = '检查已有批次'; check.onclick = async () => {
      check.disabled = true;
      try {
        let id = state.runId;
        if (!id && state.request_key && state.receipt_kind) { const result = await api(`/api/admin/bank/mf/ext/import-status/${encodeURIComponent(state.request_key)}?kind=${encodeURIComponent(state.receipt_kind)}`); if (result.found) id = result.run_id || result.id || result.batch_id; else { label.textContent = '暂未找到保存结果。可重新选择原文件重试，同一恢复凭据不会生成重复批次。'; return; } }
        if (id && ['image','pdf'].includes(kind)) return mfIntakeWork(Number(id));
        if (id) { pdSelectBatch(kind === 'capture' ? 'capture' : 'all', id); location.hash='#/pending'; }
        else location.hash = '#/intake';
      } catch (e) { label.textContent = e.message || '查询失败，请重试'; }
      finally { if (check.isConnected) check.disabled = false; }
    }; box.appendChild(check); }
    if (draft) { const discard = document.createElement('button'); discard.type='button'; discard.className='btn ghost sm'; discard.textContent='清除本机草稿'; discard.onclick=async()=>{ if (!(await elConfirm({title:'清除本机草稿',message:'仅清除本浏览器中的未送审草稿，已经保存的批次不会删除。',okText:'清除草稿'}))) return; clear(kind === 'manual' ? 'manual-draft' : kind === 'skill' ? 'skill-text' : kind + '-prepare'); location.reload(); }; box.appendChild(discard); }
    const heading = root.querySelector('.r4-intake-head, .r4m-heading'); if (heading) heading.after(box); else root.prepend(box);
  };
  const watch = (xhr, root, kind, name, runId, request = {}) => {
    save(kind, { phase: 'sending', name, runId, ...request });
    xhr.timeout = 120000;
    const load = xhr.onload, error = xhr.onerror, abort = xhr.onabort, progress = xhr.upload.onprogress;
    xhr.upload.onprogress = (event) => { if (root.isConnected && progress) progress(event); };
    xhr.onload = (event) => {
      const r = xhr.response || {}, ok = xhr.status >= 200 && xhr.status < 300 && r.code === 0;
      save(kind, { ...request, phase: ok ? 'saved' : 'error', name, runId: r.data && (r.data.run_id || r.data.id) || runId, message: r.msg || `HTTP ${xhr.status}` });
      if (root.isConnected && load) load(event);
    };
    const uncertain = (event, fn) => {
      save(kind, { ...request, phase: 'uncertain', name, runId });
      if (root.isConnected && fn) { fn(event); bind(root, kind); }
    };
    xhr.onerror = (event) => uncertain(event, error);
    xhr.ontimeout = (event) => uncertain(event, error);
    xhr.onabort = (event) => uncertain(event, abort || error);
  };
  async function send(xhr, root, kind, name, runId, fd) {
    try { const signature = await fingerprint(fd); const token = requestKey(kind + (runId ? ':' + runId : ''), signature); xhr.setRequestHeader('X-Intake-Key', token); watch(xhr, root, kind, name, runId, { request_key: token, receipt_kind: runId ? '' : kind }); xhr.send(fd); }
    catch (e) { if (root.isConnected && xhr.onerror) xhr.onerror(e); }
  }
  async function post(url, kind, body, existingKey, { silent = false } = {}) {
    const token = existingKey || requestKey(kind, JSON.stringify(body)); save(kind === 'manual-group' ? 'manual' : kind, {phase:'sending',request_key:token,receipt_kind:kind});
    try { const result = await api(url, {method:'POST',body,silent,headers:{'X-Intake-Key':token}}); save(kind === 'manual-group' ? 'manual' : kind,{phase:'saved',runId:result.run_id || result.id || result.batch_id,request_key:token,receipt_kind:kind}); return result; }
    catch(e) { save(kind === 'manual-group' ? 'manual' : kind,{phase:'uncertain',request_key:token,receipt_kind:kind}); throw e; }
  }
  // 移除可选项后仍保留本机草稿的原值，避免恢复时静默变为不限学段。
  function restoreField(el, value) {
    if (!el || value == null) return;
    if (el.tagName === 'SELECT' && value && !Array.from(el.options).some(option => option.value === String(value))) {
      const old = new Option((value === 'senior' ? '高中' : value) + '（历史草稿，已停用）', value);
      old.disabled = true; el.add(old);
    }
    el.value = value;
  }
  function prepare(root, kind, ids, refresh) {
    const saved = read(kind + '-prepare');
    if (saved && saved.fields) { for (const id of ids) restoreField(root.querySelector('#' + id), saved.fields[id]); if (refresh) refresh(); for (const id of ids) restoreField(root.querySelector('#' + id), saved.fields[id]); }
    const store = () => { const fields = {}; ids.forEach(id => { const el = root.querySelector('#' + id); if (el) fields[id] = el.value; }); if (!save(kind + '-prepare', {fields})) bind(root, kind); };
    root.addEventListener('input', store); root.addEventListener('change', store);
  }
  async function filesKey(files) { const fd = new FormData(); files.forEach(f => fd.append('file',f,f.name)); return hash(await fingerprint(fd)); }
  function scope(root, kind, host, existing = {}) {
    const box = document.createElement('div'); box.className = 'r4m-grid r4-scope-fields';
    const choices = { subject: ['', '数学', '英语', '物理', '化学', '语文'], stage: [['','未指定'],['primary','小学'],['junior','初中']], edition: [''], term: ['', '上册', '下册', '全一册'], material_type: [['','未指定'],['textbook','教材'],['exercise','练习'],['paper','试卷'],['other','其他']] };
    const labels = {subject:'学科',stage:'学段',edition:'教材版本',term:'册别',material_type:'资料类型'};
    const fields = {};
    for (const [key, list] of Object.entries(choices)) {
      fields[key] = existing[key] ? root.querySelector('#' + existing[key]) : null;
      if (fields[key]) continue;
      const label = document.createElement('label'); label.className = 'field'; label.textContent = labels[key] + '（选填）';
      const select = document.createElement('select'); select.id = kind + '-scope-' + key; select.className = 'input';
      list.forEach(item => { const [value, text] = Array.isArray(item) ? item : [item,item || '未指定']; select.add(new Option(text,value)); });
      label.appendChild(select); box.appendChild(label); fields[key] = select;
    }
    const before=host.querySelector('.rt-guide');if(before)before.before(box);else host.appendChild(box);
    const saved = read(kind + '-scope');
    if (saved) Object.entries(fields).forEach(([key,el])=>{
      if (key === 'edition' || saved[key] == null) return;
      restoreField(el, saved[key]);
    });
    let trees = [];
    const values = () => Object.fromEntries(Object.entries(fields).map(([key,el])=>[key,el.value]));
    const editions = (wanted) => { const el=fields.edition, current=wanted == null ? el.value : wanted; el.innerHTML='';el.add(new Option('未指定','')); [...new Set(trees.filter(t=>t.subject===fields.subject.value&&t.stage===fields.stage.value).map(t=>t.edition).filter(Boolean))].forEach(v=>el.add(new Option(v,v)));el.value=current;if(el.selectedIndex<0)el.value=''; };
    Object.entries(fields).forEach(([key,el])=>el.addEventListener('change',()=>{if(['subject','stage'].includes(key)) editions();save(kind+'-scope',values());}));
    api('/api/admin/bank/mf/trees',{silent:true}).then(data=>{trees=data.list||[];editions(saved&&saved.edition);}).catch(e=>{const note=document.createElement('p');note.className='r4-error';note.setAttribute('role','alert');note.textContent='教材版本加载失败：'+(e.message||'请重新加载本页');box.appendChild(note);});
    return values;
  }
  return { read, save, clear, bind, watch, help, send, post, requestKey, prepare, filesKey, scope, restoreField };
})();
