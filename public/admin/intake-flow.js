/* 录题共用的传输状态、恢复提示和教程。只保存本标签页的草稿与批次线索，不保存文件内容。 */
'use strict';
window.R4Flow = (() => {
  const key = (kind) => {
    let h = 2166136261;
    for (const c of String(Auth.token || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return `r4-intake:${h >>> 0}:${kind}`;
  };
  const read = (kind) => { try { return JSON.parse(sessionStorage.getItem(key(kind)) || 'null'); } catch (_) { return null; } };
  const save = (kind, value) => { try { sessionStorage.setItem(key(kind), JSON.stringify({ ...value, at: Date.now() })); } catch (_) { /* 禁用存储或空间不足时仍允许录题 */ } };
  const clear = (kind) => { try { sessionStorage.removeItem(key(kind)); } catch (_) {} };
  const help = () => modal({ title: '录题教程与中断恢复', body: `<ol><li>准备：选择学科、学段、教材资料；模板保留原表头，原文没有的答案、解析留空。</li><li>上传或录入：上传进度仅表示传输，不代表解析完成。格式错误可修正后重试；部分成功时只补传失败内容。</li><li>核对入库：从最近批次继续。核对题型、材料、小问、选项、公式、图片和分类；AI 答案与解析均为建议，须老师分别确认。</li></ol><p>网络中断、中止等待或超时后，服务器可能仍在保存。先查看最近批次，确认是否已接收，再决定补传，避免重复题目。已上传的页图和已保存题卡可在批次中继续；未上传的本地文件需要重新选择，不支持文件字节级续传。</p><p>手动录题文字草稿保存在当前账号的本标签页；JSON 输入也会暂存。关闭标签页、清除浏览器数据或退出登录后可能无法恢复，请及时送审。</p><p>英语排序题在 Word 中使用“听力排序题”或“连词成句题”，选项 A.、B. 逐行填写，答案如 B,A。共同材料使用独立行 [材料]、原文、[材料结束]，之后逐题填写；独立题之前加 [材料清空]。开放问答选问答基础题型，由老师评分；填空按老师提供的答案逐空比对，备选用 |||。</p>` });
  const bind = (root, kind) => {
    if (!root) return;
    const box = document.createElement('div'); box.className = 'r4-flow-notice'; box.setAttribute('aria-live', 'polite');
    const state = read(kind);
    const text = state ? state.phase === 'saved' ? `上次已保存${state.name ? '：' + state.name : ''}。可从最近批次继续核对。` : state.phase === 'error' ? `上次处理失败：${state.message || '请检查文件后重试'}。` : '上次处理已中断或结果未确认。请先检查最近批次；未上传的本地文件需要重新选择。' : '上传、解析和核对分别显示状态；中断后先检查最近批次再补传。';
    const label = document.createElement('span'); label.textContent = text; box.appendChild(label);
    const tutorial = document.createElement('button'); tutorial.type = 'button'; tutorial.className = 'btn ghost sm'; tutorial.textContent = '教程与恢复说明'; tutorial.onclick = help; box.appendChild(tutorial);
    if (state) { const check = document.createElement('button'); check.type = 'button'; check.className = 'btn ghost sm'; check.textContent = '检查已有批次'; check.onclick = () => { if (state.runId && ['image', 'pdf'].includes(kind)) mfIntakeWork(state.runId); else location.hash = '#/intake'; }; box.appendChild(check); }
    const heading = root.querySelector('.r4-intake-head, .r4m-heading'); if (heading) heading.after(box); else root.prepend(box);
  };
  const watch = (xhr, root, kind, name, runId) => {
    save(kind, { phase: 'sending', name, runId });
    xhr.timeout = 120000;
    const load = xhr.onload, error = xhr.onerror, abort = xhr.onabort, progress = xhr.upload.onprogress;
    xhr.upload.onprogress = (event) => { if (root.isConnected && progress) progress(event); };
    xhr.onload = (event) => {
      const r = xhr.response || {}, ok = xhr.status >= 200 && xhr.status < 300 && r.code === 0;
      save(kind, { phase: ok ? 'saved' : 'error', name, runId: r.data && r.data.run_id || runId, message: r.msg || `HTTP ${xhr.status}` });
      if (root.isConnected && load) load(event);
    };
    const uncertain = (event, fn) => {
      save(kind, { phase: 'uncertain', name, runId });
      if (root.isConnected && fn) fn(event);
    };
    xhr.onerror = (event) => uncertain(event, error);
    xhr.ontimeout = (event) => uncertain(event, error);
    xhr.onabort = (event) => uncertain(event, abort || error);
  };
  return { read, save, clear, bind, watch, help };
})();
