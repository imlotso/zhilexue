/* 章节和知识点选题；一键组卷与历史试卷沿用现有工作台。 */
function r6FilterRow(st, field, title, options) {
  return `<div class="r6-filter-row"><b>${title}</b><div class="r6-filter-options">${options.map(([value,name])=>`<button type="button" data-r6-filter="${field}" data-value="${esc(value)}" class="${String(st[field]||'')===String(value)?'on':''}" aria-pressed="${String(st[field]||'')===String(value)}">${esc(name)}</button>`).join('')}</div></div>`;
}
function r6Filters(st) {
  const row = (field, title, options) => r6FilterRow(st, field, title, options);
  return `<div class="r6-filters">
    <details class="r6-filter-detail"><summary>题型、来源、难度与更多筛选</summary>${row('type','题型',[['','全部'],...MF_TYPES])}
    <div id="r6-subtypes"></div>
    ${row('source','来源',[['','全部'],['sync','同步'],['monthly','月考'],['midterm','期中'],['final','期末'],['mock','中考模拟'],['zhongkao','中考真题'],['contest','竞赛']])}
    ${row('difficulty','难度',[['','全部'],['1,2','容易'],['3','普通'],['4,5','困难']])}
    ${row('mode','方式',[['','关联出题'],['exact','精准出题']])}
    </details><div class="r6-more"><label>年份 <input id="r6-year" inputmode="numeric" maxlength="4" placeholder="如 2025" value="${esc(st.year||'')}"></label><label>地区 <input id="r6-region" maxlength="40" placeholder="按来源文字匹配" value="${esc(st.region||'')}"></label><label><input type="checkbox" id="r6-unused" ${st.unused?'checked':''}> 过滤已组卷</label><label class="r6-keyword">关键词 <input id="r6-kw" value="${esc(st.kw||'')}" placeholder="搜索题目"></label><button class="btn sm" id="r6-search">搜索</button><button class="btn ghost sm" id="r6-clear">清除筛选</button></div>
  </div>`;
}
/* Presentation-only basket summary: saved question IDs/scores remain owned by QB. */
function r6BasketPreviewHTML() {
  const rows = QB.list();
  return '<div class="r6-basket-summary"><strong>' + rows.length + ' 题</strong><span>共 ' + rows.reduce((sum, row) => sum + (Number(row.score) || 0), 0) + ' 分</span></div>'
    + (rows.length ? '<ol class="r6-basket-preview-list">' + rows.map((row, index) => '<li><span class="r6-basket-number">' + String(index + 1).padStart(2, '0') + '</span><span><b>' + esc((MF_TYPES.find(([type]) => type === row.type) || ['', row.type || '题目'])[1]) + '</b><small>题目 #' + Number(row.id) + ' · ' + (Number(row.score) || 0) + ' 分</small></span></li>').join('') + '</ol>' : '<div class="r6-basket-empty">' + ic('doc') + '<strong>试题篮还是空的</strong><p>从题目列表添加习题，逐步组成一份试卷。</p></div>');
}
function r6PaintBasket() {
  const panel = document.getElementById('r6-basket-preview');
  if (panel) panel.innerHTML = r6BasketPreviewHTML();
  document.querySelectorAll('[data-r6add]').forEach(button => {
    const selected = QB.has(button.dataset.r6add);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? '移出试题篮' : '+ 加入试题篮';
  });
}
const r6RoundedHeading = () => '<header class="r6-page-heading"><h2>智能组卷</h2><p>先选范围，再挑题目，最后预览与下发。</p></header><ol class="r6-process" aria-label="组卷步骤"><li><b>1</b>选择范围</li><li class="on" aria-current="step"><b>2</b>筛选题目</li><li><b>3</b>预览与下发</li></ol>';
async function viewPaperR6() {
  const st = ADM.page.r6 = ADM.page.r6 || { tab: 'textbook', tp: { stage:'primary', subject:'数学', kind:'textbook', sel:[], open:{}, multi:true }, type:'', difficulty:'', kw:'', page:1 };
  if (st.tab === 'classic' || st.tab === 'existing') {
    const old = await viewPaper();
    const after = old.after;
    return { html: `<section class="r6-rounded-page">${r6RoundedHeading()}<div class="r6-tabs"><button data-r6tab="textbook">章节选题</button><button data-r6tab="knowledge">知识点选题</button><button class="${st.tab==='classic'?'on':''}" data-r6tab="classic">一键组卷</button><button class="${st.tab==='existing'?'on':''}" data-r6tab="existing">已有试卷</button></div><div class="r6-mode-${st.tab}">${old.html}</div></section>`, after: () => { if (after) after(); document.querySelectorAll('[data-r6tab]').forEach(b=>b.onclick=()=>{st.tab=b.dataset.r6tab;render();}); } };
  }
  st.tp.kind = st.tab;
  return { html: `<section class="r6-rounded-page">${r6RoundedHeading()}<div class="r6-tabs"><button data-r6tab="textbook" class="${st.tab==='textbook'?'on':''}">章节选题</button><button data-r6tab="knowledge" class="${st.tab==='knowledge'?'on':''}">知识点选题</button><button data-r6tab="classic">一键组卷</button><button data-r6tab="existing">已有试卷</button><button class="r6-basket" id="r6-basket">试题篮 <b>${QB.count()}</b></button></div>${r6Filters(st)}<div class="r3-bank r6-rounded-grid"><aside class="card r3-side"><h3 class="r6-panel-title">${ic('book')} 筛选范围</h3><div id="r6-tree"></div></aside><section class="card r3-main"><div class="card-h"><h3>${ic('book')} 题目列表</h3><span class="hint">按目录和条件筛选后，逐题加入试题篮</span></div><div id="r6-knows" class="r6-knows"></div><div id="r6-results" aria-live="polite">正在加载题目…</div></section><aside class="r6-basket-panel" aria-label="常驻试卷篮"><h3>${ic('doc')} 试卷篮</h3><div id="r6-basket-preview" aria-live="polite">${r6BasketPreviewHTML()}</div><div class="r6-basket-settings"><h4>${ic('setting')} 试卷设置</h4><p>在预览中填写标题、设置时长，调整题目顺序与分值。</p><button type="button" class="btn" data-basket-open>${ic('eye')} 预览与保存试卷</button><button type="button" class="btn ghost" data-basket-existing>${ic('arrow-right')} 已有试卷与下发</button><small>保存为草稿后，可选择学生下发。下发后显示在学生端「我的任务」。</small></div></aside></div></section>`,
    after: () => {
      document.querySelectorAll('[data-r6tab]').forEach(b=>b.onclick=()=>{st.tab=b.dataset.r6tab;st.tp.kind=st.tab;st.tp.sel=[];st.page=1;render();});
      document.getElementById('r6-basket').onclick=()=>r6BasketDialog(st);
      document.querySelectorAll('[data-basket-open]').forEach(b=>b.onclick=()=>r6BasketDialog(st));
      document.querySelectorAll('[data-basket-existing]').forEach(b=>b.onclick=()=>{st.tab='existing';render();});
      const paintFilters=()=>document.querySelectorAll('[data-r6-filter]').forEach(b=>{const on=String(st[b.dataset.r6Filter]||'')===b.dataset.value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
      const bindFilterButtons=(root)=>root.querySelectorAll('[data-r6-filter]').forEach(b=>b.onclick=()=>{st[b.dataset.r6Filter]=b.dataset.value;st.page=1;if(b.dataset.r6Filter==='type')renderSubtypes(tp && tp.ctx());paintFilters();load();});
      const renderSubtypes=(ctx)=>{const panel=document.getElementById('r6-subtypes');if(!panel)return;if(!ctx){st.subtype='';panel.innerHTML='';return;}const list=QSubtype.list.filter(x=>QSubtype.matchesSubject(x,ctx.subject)&&(!st.type||QSubtype.matchesType(x,st.type)));if(st.subtype&&!list.some(x=>x.code===st.subtype))st.subtype='';panel.innerHTML=list.length?r6FilterRow(st,'subtype','细分',[['','全部'],...list.map(x=>[x.code,x.label])]):'';bindFilterButtons(panel);};
      bindFilterButtons(document.querySelector('.r6-filters'));
      document.getElementById('r6-unused').onchange=e=>{st.unused=e.target.checked;st.page=1;load();};
      const search=()=>{const year=document.getElementById('r6-year').value.trim();if(year&&!/^\d{4}$/.test(year))return toast('年份请输入四位数字','err');st.year=year;st.region=document.getElementById('r6-region').value.trim();st.kw=document.getElementById('r6-kw').value.trim();st.page=1;load();};
      document.getElementById('r6-search').onclick=search;
      ['r6-kw','r6-year','r6-region'].forEach(id=>{document.getElementById(id).onkeydown=e=>{if(e.key==='Enter')search();};});
      document.getElementById('r6-clear').onclick=()=>{st.type=st.subtype=st.source=st.difficulty=st.mode=st.year=st.region=st.kw='';st.unused=false;st.knows=[];st.page=1;['r6-year','r6-region','r6-kw'].forEach(id=>{document.getElementById(id).value='';});document.getElementById('r6-unused').checked=false;document.querySelectorAll('[data-r6know]').forEach(x=>{x.checked=false;});renderSubtypes(tp && tp.ctx());paintFilters();load();};
      let tp; let requestSeq=0; let scopeSeq=0;
      async function load(ctx) {
        ctx=ctx || (tp && tp.ctx()); if(!ctx) return;
        const result=document.getElementById('r6-results'); if(!result) return; const request=++requestSeq;
        const params=new URLSearchParams({page:String(st.page),size:'20',stage:ctx.stage,subject:ctx.subject});
        if(ctx.sel.length) params.set('nodes',ctx.sel.join(',')); if(st.type)params.set('type',st.type);if(st.subtype)params.set('question_subtype',st.subtype);if(st.difficulty)params.set('difficulty',st.difficulty);if(st.kw)params.set('kw',st.kw);if(st.source)params.set('src_kind',st.source);if(st.mode)params.set('node_mode',st.mode);if(st.year)params.set('year',st.year);if(st.region)params.set('region',st.region);if(st.unused)params.set('unused','1');if(st.knows && st.knows.length)params.set('knows',st.knows.join(','));
        try {const d=await api(`${MF_API}/questions?${params}`); if(request!==requestSeq || !document.getElementById('r6-results'))return;
          result.innerHTML=`<div class="r6-result-count">共 ${d.total} 道题</div><div class="r3-list">${d.list.length?d.list.map((q,i)=>qcCard(q,{no:(d.page-1)*20+i+1,selectable:false,acts:`<button type="button" class="r3-bbtn" data-r6add="${q.id}" aria-pressed="${QB.has(q.id)}">${QB.has(q.id)?'移出试题篮':'+ 加入试题篮'}</button>${qbGroupKey(q)?` <button type="button" class="r3-bbtn" data-r6group="${q.id}">整组加入</button>`:''}`})).join(''):'<div class="r3-empty">没有符合条件的题目，试试更换筛选条件。</div>'}</div><div class="r6-pagination"><button type="button" data-r6page="prev" ${d.page<=1?'disabled':''}>上一页</button><span>${d.page} / ${Math.max(1,Math.ceil(d.total/20))}</span><button type="button" data-r6page="next" ${d.page*20>=d.total?'disabled':''}>下一页</button></div>`;
          result.querySelectorAll('[data-r6add]').forEach(b=>b.onclick=()=>{const q=d.list.find(x=>Number(x.id)===Number(b.dataset.r6add));QB.toggle(q);r6PaintBasket();b.setAttribute('aria-pressed',String(QB.has(q.id)));b.textContent=QB.has(q.id)?'移出试题篮':'+ 加入试题篮';document.getElementById('r6-basket').innerHTML=`试题篮 <b>${QB.count()}</b>`;});
          result.querySelectorAll('[data-r6group]').forEach(b=>b.onclick=async()=>{if(await qbAddWholeGroup(b.dataset.r6group)){r6PaintBasket();document.getElementById('r6-basket').innerHTML=`试题篮 <b>${QB.count()}</b>`;result.querySelectorAll('[data-r6add]').forEach(x=>{x.setAttribute('aria-pressed',String(QB.has(x.dataset.r6add)));x.textContent=QB.has(x.dataset.r6add)?'移出试题篮':'+ 加入试题篮';});}});
          result.querySelectorAll('[data-r6page]').forEach(b=>b.onclick=()=>{st.page+=b.dataset.r6page==='next'?1:-1;load();});qcBind(result);mtxTypeset(result);
        }catch(e){result.textContent='题目加载失败，请稍后重试。';}
      }
      let mappingSeq=0;
      async function mappedKnowledge(ctx) {
        const panel=document.getElementById('r6-knows'); if(!panel)return;
        const seq=++mappingSeq;
        if(ctx.kind!=='textbook' || !ctx.tree || !ctx.sel.length) {st.knows=[];panel.innerHTML='';return;}
        try {
          const trees=await tpTrees();const tree=pickTree(trees,{kind:'knowledge',subject:ctx.subject,stage:ctx.stage,edition:ctx.edition});
          if(!tree){st.knows=[];panel.textContent='该学科暂没有知识点树。';return;}
          const [mapped,nodeData]=await Promise.all([api(`/api/admin/bank/tree-mapping?chapter_tree_id=${ctx.tree.id}&knowledge_tree_id=${tree.id}`,{silent:true}),api(`${MF_API}/trees/${tree.id}/nodes`,{silent:true})]);
          if(seq!==mappingSeq || !document.getElementById('r6-knows'))return;
          const chosen=new Set(ctx.sel.map(Number));let grew=true;
          while(grew){grew=false;ctx.nodes.forEach(n=>{if(chosen.has(Number(n.parent_id))&&!chosen.has(Number(n.id))){chosen.add(Number(n.id));grew=true;}});}
          const ids=new Set((mapped.links||[]).filter(x=>chosen.has(Number(x.chapter_node_id))).map(x=>Number(x.knowledge_node_id)));
          const options=(nodeData.list||[]).filter(n=>ids.has(Number(n.id)));
          st.knows=(st.knows||[]).filter(id=>ids.has(Number(id)));
          panel.innerHTML=options.length?`<span>关联知识点</span>${options.map(n=>`<label><input type="checkbox" data-r6know="${n.id}" ${st.knows.includes(Number(n.id))?'checked':''}> ${esc(n.name)}</label>`).join('')}`:'<span class="hint">所选章节暂无关联知识点，可在知识树管理中维护映射。</span>';
          panel.querySelectorAll('[data-r6know]').forEach(box=>box.onchange=()=>{const id=Number(box.dataset.r6know);st.knows=box.checked?[...new Set([...st.knows,id])]:st.knows.filter(x=>x!==id);st.page=1;load();});
        } catch(e) {if(seq===mappingSeq)panel.textContent='关联知识点加载失败，请重试。';}
      }
      tp=treePanel(document.getElementById('r6-tree'),{state:st.tp,kinds:[st.tab],onChange:(ctx)=>{st.page=1;renderSubtypes(ctx);const scope=++scopeSeq;mappedKnowledge(ctx).then(()=>{if(scope===scopeSeq)load(ctx);});}});
      qbFab({pages:['paper'],onOpen:()=>r6BasketDialog(st)});
    } };
}
async function r6BasketDialog(st) {
  const entries=QB.list(); if(!entries.length)return toast('试题篮还是空的，请先添加题目','err');
  const results=await Promise.all(entries.map(x=>api(`${MF_API}/questions/${x.id}`,{silent:true}).then(r=>r.question).catch(()=>null)));
  if(results.some(q=>!q))return toast('试题篮中有题目已不存在，请先移除后重试','err');
  // 整组加入的混合题型必须保持相邻及原始顺序；未分组题目按相邻题型分段。
  const initial=entries.map((x,i)=>({...x,type:results[i].type||x.type,q:results[i],group_key:x.group_key===qbGroupKey(results[i])?x.group_key:null}));
  let rows=initial.some(x=>x.group_key)?initial:[...new Set(initial.map(x=>x.type))].flatMap(type=>initial.filter(x=>x.type===type));
  const label=type=>(MF_TYPES.find(([k])=>k===type)||[type,type||'其他题型'])[1];
  const blocks=()=>{const out=[];rows.forEach(x=>{const prev=out[out.length-1];if(prev && ((x.group_key && prev.key===x.group_key) || (!x.group_key && !prev.key && prev.type===x.type)))prev.rows.push(x);else out.push({key:x.group_key,type:x.type,rows:[x]});});return out;};
  const persist=()=>{QB.set(rows.map(({id,type,score,group_key,partial_score})=>({id,type,score,...(group_key?{group_key}:{}),...(partial_score==null?{}:{partial_score})})));r6PaintBasket();const button=document.getElementById('r6-basket');if(button)button.innerHTML=`试题篮 <b>${QB.count()}</b>`;};
  const paint=w=>{
    const groups=blocks();
    const groupLabel=g=>g.key?'组合题':label(g.type);
    w.querySelector('#r6-outline').innerHTML=groups.length?groups.map((g,i)=>`<li><a href="#" data-r6outline="${i}">${esc(groupLabel(g))}<span>${g.rows.length} 题</span></a></li>`).join(''):'<li class="hint">尚未选择题目</li>';
    let n=0;
    w.querySelector('#r6-rows').innerHTML=groups.map((g,gi)=>{
      const group=g.rows, name=groupLabel(g);
      return `<section class="r6-basket-group" data-group="${gi}"><div class="r6-group-head"><div><b>${esc(name)}</b><span>${group.length} 题 · ${group.reduce((s,x)=>s+(Number(x.score)||0),0)} 分${g.key?' · 按原顺序排列':''}</span></div><div><button type="button" data-block-up="${gi}" ${gi===0?'disabled':''} aria-label="上移${esc(name)}分组">上移分组</button><button type="button" data-block-down="${gi}" ${gi===groups.length-1?'disabled':''} aria-label="下移${esc(name)}分组">下移分组</button></div></div>${group.map((x,i)=>`<div class="r6-basket-row" data-row="${x.id}"><span>${++n}. ${g.key?esc(label(x.type))+' · ':''}${esc((x.q.stem||'').slice(0,80))}</span><label>分值 <input type="number" min="1" max="1000" value="${x.score}" data-score="${x.id}"></label>${x.type==='multi'?`<label title="只选对部分正确选项且没有错选时的分数；留空不启用"><span>少选分</span> <input type="number" min="0" max="${x.score}" step="0.01" placeholder="未设置" value="${x.partial_score == null ? '' : x.partial_score}" data-partial="${x.id}"></label>`:''}${g.key?'':`<button type="button" data-up="${x.id}" ${i===0?'disabled':''}>上移</button><button type="button" data-down="${x.id}" ${i===group.length-1?'disabled':''}>下移</button>`}<button type="button" data-remove="${x.id}">移除</button></div>`).join('')}</section>`;
    }).join('')||'<div class="empty">试题篮为空</div>';
    w.querySelector('#r6-summary').textContent=`共 ${rows.length} 题 · ${rows.reduce((s,x)=>s+(Number(x.score)||0),0)} 分`;
  };
  modal({title:`组卷工作台 · ${rows.length} 题`,wide:true,okText:'保存试卷草稿',body:`<div class="r6-workbench"><aside class="r6-outline"><b>试卷大纲</b><p id="r6-summary" class="hint"></p><ul id="r6-outline"></ul></aside><div class="r6-work-main"><div class="r6-paper-fields"><div class="field"><label for="r6-title">试卷标题</label><input class="input" id="r6-title" placeholder="输入试卷名称"></div><div class="field"><label for="r6-duration">作答时长（分钟）</label><input class="input" id="r6-duration" type="number" value="90" min="1"></div></div><p class="hint">按分组调整顺序和分值；组合题按原顺序排列。多选“少选分”留空时只对全选正确给分；设置后只选对部分且没有错选时给填写的分值。保存后可在已有试卷中下发。</p><div id="r6-rows"></div></div></div>`,onMount:w=>{
    paint(w);
    w.querySelector('#r6-outline').onclick=e=>{const a=e.target.closest('[data-r6outline]');if(!a)return;e.preventDefault();const section=[...w.querySelectorAll('[data-group]')].find(x=>x.dataset.group===a.dataset.r6outline);if(section)section.scrollIntoView({block:'nearest'});};
    w.querySelector('#r6-rows').onchange=e=>{const isPartial=e.target.dataset.partial!==undefined;const id=Number(isPartial?e.target.dataset.partial:e.target.dataset.score);const row=rows.find(x=>x.id===id);if(row){if(isPartial)row.partial_score=e.target.value.trim()===''?null:Number(e.target.value);else row.score=Number(e.target.value);persist();paint(w);}};
    w.querySelector('#r6-rows').onclick=e=>{
      const b=e.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.blockUp!==undefined||b.dataset.blockDown!==undefined){const groups=blocks();const i=Number(b.dataset.blockUp ?? b.dataset.blockDown);const j=i+(b.dataset.blockUp!==undefined?-1:1);if(j>=0&&j<groups.length){[groups[i],groups[j]]=[groups[j],groups[i]];rows=groups.flatMap(g=>g.rows);}}
      else {const id=Number(b.dataset.up||b.dataset.down||b.dataset.remove);const i=rows.findIndex(x=>x.id===id);if(i<0)return;if(b.dataset.remove)rows.splice(i,1);else{const j=i+(b.dataset.up?-1:1);if(j>=0&&j<rows.length&&!rows[i].group_key&&!rows[j].group_key&&rows[j].type===rows[i].type)[rows[i],rows[j]]=[rows[j],rows[i]];}}
      persist();paint(w);
    };
  },onOk:async(w,showErr)=>{const title=w.querySelector('#r6-title').value.trim();if(!title)return showErr('请输入试卷标题');if(!rows.length)return showErr('试题篮为空');if(rows.some(x=>!Number.isInteger(x.score)||x.score<1||x.score>1000))return showErr('每题分值须为 1 至 1000 的整数');if(rows.some(x=>x.partial_score!=null&&(!Number.isFinite(x.partial_score)||x.partial_score<0||x.partial_score>=x.score||Math.abs(x.partial_score*100-Math.round(x.partial_score*100))>1e-7)))return showErr('多选少选分须小于本题满分，最多两位小数；留空为未设置');const duration=Number(w.querySelector('#r6-duration').value);if(!Number.isInteger(duration)||duration<1)return showErr('作答时长须为正整数');const subject=rows[0].q.subject,stage=rows[0].q.stage;if(rows.some(x=>x.q.subject!==subject||x.q.stage!==stage))return showErr('同一张试卷请使用同学科、同学段的题目');const scores=Object.fromEntries(rows.map(x=>[x.id,x.score]));const partial=Object.fromEntries(rows.filter(x=>x.type==='multi'&&x.partial_score!=null).map(x=>[x.id,x.partial_score]));await api('/api/admin/bank/papers',{method:'POST',body:{title,subject,stage,duration,q_ids:rows.map(x=>x.id),question_scores:scores,question_partial_scores:partial,status:'draft'}});QB.clear();toast('试卷草稿已保存，可在已有试卷中下发','ok');st.tab='existing';render();}});
}
