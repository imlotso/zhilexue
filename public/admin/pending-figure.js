/* 从本批次原页由老师框选图片；不推断图形归属。 */
function pdCropFigure(it) {
  const total = Number(it.original_pages) || Number(it.original_page) || 1;
  const preferred = [...new Set([...(it.source_pages || []), it.original_page].map(Number).filter(n => n > 0 && n <= total))];
  const page = preferred[0] || 1;
  const missing = Array.isArray(it.figure_missing) ? it.figure_missing.filter(n => n > 0 && n <= 30) : [];
  const initial = missing[0] || Math.min(30, (it.images || []).length + 1);
  let image = null, selected = null, start = null, sequence = 0, candidates = [];
  const dialog = modal({ title: '从原页裁剪题图', wide: true, okText: '保存题图',
    body: `<p class="pd-tip">选择本批次原页并拖动画框，按题干、选项或小问中的图号保存。若原题没有图号，可新增图号并在编辑题目时将它写入对应位置。保存后请再次确认图文归属。</p>
      <div style="display:flex;gap:16px;flex-wrap:wrap"><label>原页 <select class="input" id="pdFigPage">${Array.from({length:total}, (_,i) => `<option value="${i+1}" ${i+1===page?'selected':''}>第 ${i+1} 页${preferred.includes(i+1)?'（来源页）':''}</option>`).join('')}</select></label>
      <label>保存为图号 <input class="input" id="pdFigIndex" type="number" min="1" max="30" value="${initial}"></label></div>
      <label style="display:block;margin-top:12px">PDF 原生图块候选 <select class="input" id="pdFigCandidate" disabled aria-describedby="pdFigCandidateHelp"><option value="">手动框选</option></select></label>
      <p class="hint" id="pdFigCandidateHelp">候选仅来自本页 PDF 嵌入图块，不代表属于当前题，可能遗漏矢量图或图外文字。请对照原页核实、必要时重新框选；选择候选不会保存或确认归属。</p>
      <p class="hint" id="pdFigStatus" aria-live="polite">正在加载原页…</p><canvas id="pdFigCanvas" style="display:block;max-width:100%;height:auto;touch-action:none;cursor:crosshair;border:1px solid #cbd5e1;background:#fff" aria-label="在原页上拖动选择题图区域"></canvas>`,
    onMount: (w) => {
      const canvas = w.querySelector('#pdFigCanvas'), ctx = canvas.getContext('2d'), status = w.querySelector('#pdFigStatus'), candidateSelect = w.querySelector('#pdFigCandidate');
      const resetCandidates = () => { candidates=[]; candidateSelect.replaceChildren(new Option('手动框选','')); candidateSelect.disabled=true; };
      candidateSelect.onchange = () => {
        const c = candidateSelect.value === '' ? null : candidates[Number(candidateSelect.value)];
        if (!image || !c) { selected=null; paint(); return; }
        start=null; selected={x:c.x*canvas.width,y:c.y*canvas.height,w:c.w*canvas.width,h:c.h*canvas.height}; paint();
        status.textContent='已预选原生图块，尚未保存。请核实本题归属和图外文字，必要时拖动重新框选，再确认图号保存。';
      };
      const paint = () => { if (!image) return; ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0); if (selected) { ctx.strokeStyle='#dc2626'; ctx.lineWidth=Math.max(3,canvas.width/350); ctx.strokeRect(selected.x,selected.y,selected.w,selected.h); } };
      const load = async () => {
        const current = ++sequence, pageNo = w.querySelector('#pdFigPage').value; image = null; selected = null; start=null; resetCandidates(); ctx.clearRect(0,0,canvas.width,canvas.height); status.textContent = '正在加载原页…';
        const metadata = fetch(`${PD_API}/ext/pending/original?id=${encodeURIComponent(it.id)}&page=${encodeURIComponent(pageNo)}`, {headers:{Authorization:'Bearer '+Auth.token}})
          .then(r => r.ok ? r.json() : null).then(j => j && j.code===0 && j.data && Array.isArray(j.data.figure_candidates) ? j.data.figure_candidates : []).catch(()=>[]);
        try {
          const response = await fetch(`${PD_API}/ext/pending/original-image?id=${encodeURIComponent(it.id)}&page=${encodeURIComponent(pageNo)}`, {headers:{Authorization:'Bearer '+Auth.token}});
          if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) { const j = await response.json().catch(()=>({})); throw new Error(j.msg || '原页读取失败'); }
          const blob = await response.blob(), url = URL.createObjectURL(blob), img = new Image();
          try { await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('原页无法显示'));img.src=url;}); } finally { URL.revokeObjectURL(url); }
          if (current !== sequence || !w.isConnected) return;
          image=img; canvas.width=img.naturalWidth; canvas.height=img.naturalHeight; paint(); status.textContent='请在原页上拖动框选需要保存的图片。';
          const regions = await metadata;
          if (current !== sequence || !w.isConnected || image !== img) return;
          candidates=regions.filter(c => c && ['x','y','w','h'].every(k=>typeof c[k]==='number' && Number.isFinite(c[k])) && c.x>=0 && c.y>=0 && c.w>0 && c.h>0 && c.x+c.w<=1.000001 && c.y+c.h<=1.000001 && c.w*canvas.width>=5 && c.h*canvas.height>=5).slice(0,100);
          candidates.forEach((c,i)=>candidateSelect.add(new Option(`候选图块 ${i+1}（未确认归属）`,String(i)))); candidateSelect.disabled=!candidates.length;
          if (!selected) status.textContent=candidates.length ? `发现 ${candidates.length} 个本页原生图块，可手动选择候选或拖动框选。` : '本页没有可用的原生图块候选（旧批次、扫描页或矢量图也可能无候选），仍可手动拖动框选。';
        } catch (e) { if (current===sequence && w.isConnected) { image=null; selected=null; start=null; resetCandidates(); status.textContent=e.message || '原页读取失败'; } }
      };
      const point = (e) => { const r=canvas.getBoundingClientRect(); return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)), y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))}; };
      canvas.onpointerdown = (e) => { if (!image) return; e.preventDefault(); candidateSelect.value=''; start=point(e); selected={x:start.x,y:start.y,w:0,h:0}; canvas.setPointerCapture(e.pointerId); };
      canvas.onpointermove = (e) => { if (!start) return; e.preventDefault(); const p=point(e); selected={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)}; paint(); };
      canvas.onpointerup = (e) => { if (!start) return; start=null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); status.textContent = selected && selected.w >= 5 && selected.h >= 5 ? '已框选，确认图号后保存。' : '框选范围太小，请重新选择。'; };
      canvas.onpointercancel = () => { start=null; };
      w.querySelector('#pdFigPage').onchange=load; load();
    },
    onOk: async (w, showErr) => {
      const n=Number(w.querySelector('#pdFigIndex').value);
      if (!Number.isInteger(n) || n<1 || n>30) return showErr('图号应为 1 到 30');
      if (!image || !selected || selected.w<5 || selected.h<5) return showErr('请先在原页框选图片');
      const saveSequence=sequence, saveImage=image, saveSelection=selected;
      const stale = () => !w.isConnected || saveSequence!==sequence || saveImage!==image || saveSelection!==selected || Number(w.querySelector('#pdFigIndex').value)!==n;
      if ((it.images || [])[n-1] && !(await elConfirm({title:`替换图${n}`,message:'该图号已有图片，保存后会替换当前题图。请确认与原题对应。',okText:'确认替换'}))) return false;
      if (stale()) return showErr('原页或选区已变化，请重新核对后保存');
      const out=document.createElement('canvas'); out.width=Math.ceil(selected.w); out.height=Math.ceil(selected.h);
      out.getContext('2d').drawImage(image,selected.x,selected.y,selected.w,selected.h,0,0,out.width,out.height);
      const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
      if (stale()) return showErr('原页或选区已变化，请重新核对后保存');
      if (!blob || blob.size>5*1024*1024) return showErr('图片生成失败或超过 5 MB，请缩小选择范围');
      const fd=new FormData(); fd.append('id',it.id); fd.append('index',String(n-1)); fd.append('file',blob,'figure.png');
      const response=await fetch(`${PD_API}/ext/pending/figure`,{method:'POST',headers:{Authorization:'Bearer '+Auth.token},body:fd});
      const data=await response.json(); if (data.code!==0) return showErr(data.msg || '题图保存失败');
      toast(`图${n} 已保存，请核对位置`, 'ok'); render();
    }
  });
  return dialog;
}
