/* 采集树 JSON：选择目标，预览路径合并，再确认导入。 */
async function mfTreeImportDialog() {
  let trees;
  try { trees = await tpTrees(); } catch (e) { toast(e.message || '知识树加载失败', 'err'); return; }
  modal({ title: '导入采集的知识树', wide: true,
    body: `<p class="hint">先确认目标，再粘贴或选择已采集的 JSON。预览只统计，不写入知识树；正式导入按完整路径合并同名节点。</p>
      <div class="pd-grid">
        <div class="field"><label for="ctStage">学段</label><select class="input" id="ctStage"><option value="">请选择</option><option value="primary">小学</option><option value="junior">初中</option></select></div>
        <div class="field"><label for="ctSubject">学科</label><select class="input" id="ctSubject"><option value="">请选择</option>${['数学','英语','物理','化学','语文','生物','历史','地理','政治','科学'].map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label for="ctKind">树类型</label><select class="input" id="ctKind"><option value="">请选择</option><option value="textbook">章节树</option><option value="knowledge">知识点树</option></select></div>
        <div class="field"><label for="ctEdition">教材版本</label><select class="input" id="ctEdition"><option value="">请先选择学段、学科和树类型</option></select><input class="input" id="ctCustom" placeholder="填写教材版本" style="display:none;margin-top:7px" maxlength="40"></div>
      </div>
      <div class="field"><label for="ctTarget">目标知识树</label><select class="input" id="ctTarget" disabled><option value="">请先选择目标条件</option></select></div>
      <div class="field"><label for="ctSite">采集来源</label><select class="input" id="ctSite"><option value="generic">其他 / 自行整理</option><option value="zujuan">组卷网</option><option value="21cnjy">二一教育</option><option value="jyeoo">菁优网</option></select></div>
      <div class="field"><label for="ctJson">采集结果 JSON</label><textarea class="input" id="ctJson" rows="8" placeholder='粘贴含 nodes 的 JSON；支持采集节点列表或智学课堂树导出格式'></textarea><input type="file" id="ctFile" accept=".json,application/json" hidden><button type="button" class="btn ghost sm" id="ctChoose" style="margin-top:8px">选择 JSON 文件</button> <span class="hint" id="ctFilename"></span></div>
      <div id="ctStatus" role="status" aria-live="polite" style="margin:10px 0;line-height:1.6"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost sm" id="ctClose">关闭</button><button type="button" class="btn ghost sm" id="ctPreview">预览合并</button><button type="button" class="btn primary sm" id="ctImport" disabled>确认导入</button></div>`,
    onMount: (w) => {
      const $ = (id) => w.querySelector(id);
      let snapshot = null, busy = false, revision = 0;
      const status = (text, error) => { $('#ctStatus').textContent = text || ''; $('#ctStatus').style.color = error ? '#b42318' : '#17684a'; };
      const invalidate = () => { revision++; snapshot = null; $('#ctImport').disabled = true; status(''); };
      const editionValue = () => $('#ctEdition').value === '__other__' ? $('#ctCustom').value.trim() : $('#ctEdition').value === '__general__' ? '' : $('#ctEdition').value;
      const targetRefresh = () => {
        invalidate();
        const stage = $('#ctStage').value, subject = $('#ctSubject').value, kind = $('#ctKind').value, selected = $('#ctEdition').value;
        $('#ctCustom').style.display = selected === '__other__' ? 'block' : 'none';
        const edition = editionValue();
        if (!stage || !subject || !kind || !selected || (selected === '__other__' && !edition)) { $('#ctTarget').innerHTML = '<option value="">请先选择目标条件</option>'; $('#ctTarget').disabled = true; return; }
        const hits = trees.filter((t) => t.kind === kind && t.stage === stage && t.subject === subject && String(t.edition || '') === edition);
        $('#ctTarget').disabled = false;
        $('#ctTarget').innerHTML = hits.length ? hits.map((t) => `<option value="${Number(t.id)}">合并到：${esc(t.name)}（ID ${Number(t.id)}）</option>`).join('') : '<option value="0">没有同条件的树，将新建</option>';
      };
      const editionsRefresh = () => {
        invalidate();
        const stage = $('#ctStage').value, subject = $('#ctSubject').value, kind = $('#ctKind').value;
        if (!stage || !subject || !kind) { $('#ctEdition').innerHTML = '<option value="">请先选择学段、学科和树类型</option>'; targetRefresh(); return; }
        const versions = [...new Set(trees.filter((t) => t.stage === stage && t.subject === subject && t.kind === kind).map((t) => String(t.edition || '')).filter(Boolean).concat(['苏教版','苏科版','译林版','沪教版']))];
        $('#ctEdition').innerHTML = '<option value="">请选择</option>' + versions.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + (kind === 'knowledge' ? '<option value="__general__">不区分版本</option>' : '') + '<option value="__other__">其他版本</option>';
        targetRefresh();
      };
      ['#ctStage','#ctSubject','#ctKind'].forEach((id) => { $(id).onchange = editionsRefresh; });
      $('#ctEdition').onchange = targetRefresh; $('#ctCustom').oninput = targetRefresh;
      $('#ctTarget').onchange = invalidate; $('#ctSite').onchange = invalidate; $('#ctJson').oninput = invalidate;
      $('#ctChoose').onclick = () => $('#ctFile').click();
      $('#ctFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!/\.json$/i.test(f.name) || f.size > 5 * 1024 * 1024) { status('请选择不超过 5 MB 的 JSON 文件', true); e.target.value = ''; return; }
        try { $('#ctJson').value = await f.text(); $('#ctFilename').textContent = f.name; invalidate(); }
        catch (_) { status('读取文件失败，请重试', true); }
        e.target.value = '';
      };
      $('#ctClose').onclick = () => w.remove();
      const hasSeniorScope = (value) => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(hasSeniorScope);
        const senior = (label) => {
          if (label && typeof label === 'object') return [label.label, label.code, label.value].some(senior);
          return /senior|高中|高[一二三123]|(?:10|11|12|十|十一|十二)年级/i.test(String(label == null ? '' : label).normalize('NFKC').replace(/[\s\u3000]/g, ''));
        };
        // Check classification keys before flatten discards source metadata. Names and text are not classifications.
        return senior(value.stage) || senior(value.grade) || Object.values(value).some(hasSeniorScope);
      };
      const flatten = (value) => {
        const root = Array.isArray(value) ? value : value && value.nodes;
        if (!Array.isArray(root) || !root.length) throw new Error('JSON 须包含非空 nodes 数组');
        if (root.some((x) => x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, 'site_node_id'))) {
          return root.map((n) => ({ site_node_id: n && n.site_node_id, parent_site_node_id: n && n.parent_site_node_id, name: n && n.name, sort: n && n.sort }));
        }
        const out = [];
        const walk = (list, parent, path, depth) => {
          if (depth > 12) throw new Error('节点层级超过 12 层');
          if (!Array.isArray(list)) throw new Error('children 应为数组');
          list.forEach((n, i) => {
            const entry = typeof n === 'string' ? { name: n } : n;
            if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !String(entry.name || '').trim()) throw new Error('节点缺少名称');
            const id = String(entry.code || '').trim() || 'path:' + path.concat(i + 1).join('.');
            out.push({ site_node_id: id, parent_site_node_id: parent, name: entry.name, sort: i });
            if (out.length > 60000) throw new Error('节点过多，请分批导入');
            if (entry.children != null) walk(entry.children, id, path.concat(i + 1), depth + 1);
          });
        };
        walk(root, '', [], 1); return out;
      };
      $('#ctPreview').onclick = async () => {
        if (busy) return;
        const stage = $('#ctStage').value, subject = $('#ctSubject').value, kind = $('#ctKind').value, chosen = $('#ctEdition').value, edition = editionValue();
        if (!['primary', 'junior'].includes(stage) || !subject || !kind || !chosen || (chosen !== '__general__' && !edition)) { status('请选择小学或初中学段、学科、树类型和教材版本', true); return; }
        if ($('#ctTarget').disabled) { status('请选择目标树', true); return; }
        let parsed, nodes;
        try {
          parsed = JSON.parse($('#ctJson').value);
          if (hasSeniorScope(parsed)) { status('仅支持小学和初中，不能将高中来源改作其他学段导入', true); return; }
          nodes = flatten(parsed);
        }
        catch (e) { status('JSON 或节点格式错误：' + e.message, true); return; }
        const body = { stage, subject, kind, edition, edition_selected: chosen === '__general__', tree_id: Number($('#ctTarget').value) || undefined,
          site: $('#ctSite').value, root_name: !Array.isArray(parsed) && parsed && parsed.name || '', root_id: !Array.isArray(parsed) && parsed && parsed.root_id || '', nodes };
        if (new Blob([JSON.stringify(body)]).size > 4.8 * 1024 * 1024) { status('节点数据过大，请拆分后导入', true); return; }
        const requestRevision = revision;
        busy = true; $('#ctPreview').disabled = true; $('#ctImport').disabled = true; status('正在预览…');
        try {
          const pre = await api('/api/admin/bank/mf/ext/collect-tree', { method: 'POST', body: { ...body, dry: true }, silent: true });
          if (!document.contains(w) || requestRevision !== revision) return;
          snapshot = body; status(`预览：${pre.new_tree ? '将新建' : '合并到'}「${pre.tree_name}」，${stage === 'primary' ? '小学' : '初中'} · ${subject} · ${edition || '不区分版本'}；新增 ${pre.created} 个节点，合并已有节点 ${pre.merged} 个。节点示例：${nodes.slice(0, 8).map((n) => n.name).join('、')}。`);
          $('#ctImport').disabled = false;
        } catch (e) { if (document.contains(w) && requestRevision === revision) status(e.message || '预览失败', true); }
        finally { busy = false; if (document.contains(w)) $('#ctPreview').disabled = false; }
      };
      $('#ctImport').onclick = async () => {
        if (!snapshot || busy) return;
        busy = true; $('#ctPreview').disabled = true; $('#ctImport').disabled = true; status('正在导入…');
        try {
          const result = await api('/api/admin/bank/mf/ext/collect-tree', { method: 'POST', body: { ...snapshot, dry: false }, silent: true });
          if (!document.contains(w)) return;
          status(`导入完成：${result.new_tree ? '已新建' : '已合并到'}「${result.tree_name}」，新增 ${result.created} 个节点，合并已有节点 ${result.merged} 个。可到知识树管理查看。`);
          snapshot = null;
        } catch (e) { if (document.contains(w)) { status(e.message || '导入失败，请重试', true); $('#ctImport').disabled = false; } }
        finally { busy = false; if (document.contains(w)) $('#ctPreview').disabled = false; }
      };
    },
  });
}
