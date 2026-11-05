/* 题卡渲染（R3 题库管理 / R6 智能组卷共用）
 *   qcCard(q, { no, checked, acts, foot, selectable })  → 一道题的卡片 HTML（顶栏徽标 / 题干 / 选项 / 题图 / 章节路径 / 知识点 / 答案解析折叠区 / 操作区）
 *   qcBind(root, { onAns })  → 绑定题图灯箱、「答案与解析」展开（展开时排版公式）
 * q 来自 GET /api/admin/bank/mf/questions：带 chapters / knows / edition / use / mount（R3 起）。
 * 依赖：api.js 的 esc / optText / optLabel；mathlib.js 的 mtxTypeset；mfbankui.js 的 mfLightbox、MF_TYPE_NAME（可缺）。
 */
'use strict';
const QC_TYPE_FALLBACK = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', sort: '排序题', answer: '解答题' };
const QC_DIFF = { 1: '很容易', 2: '较易', 3: '中等', 4: '较难', 5: '很难' };
const QC_STAGE = { primary: '小学', junior: '初中', senior: '高中' };
const QC_SRC = { local: '本地录入', capture: '网络采集', recog: '录题识别' };
const qcType = (t) => ((typeof MF_TYPE_NAME !== 'undefined' && MF_TYPE_NAME[t]) || QC_TYPE_FALLBACK[t] || t || '题目');

// 题干可能来自外部网页。只保留常见排版标签，禁止脚本、事件和不安全链接。
function qcSafeHtml(value) {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  const allowed = new Set(['P', 'DIV', 'SPAN', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'SUP', 'SUB', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG']);
  const walk = (parent) => [...parent.children].forEach((el) => {
    if (!allowed.has(el.tagName)) {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(el.tagName)) el.remove();
      else { walk(el); el.replaceWith(...el.childNodes); }
      return;
    }
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const safeImage = el.tagName === 'IMG' && name === 'src' && /^(?:https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(attr.value.trim());
      if (!safeImage && !['alt', 'title', 'colspan', 'rowspan'].includes(name)) el.removeAttribute(attr.name);
    });
    walk(el);
  });
  walk(doc.body);
  return doc.body.innerHTML;
}

function qcFig(src, i) {
  return `<span class="r0-qfig"><img class="r0-qimg" data-qfig="${i}" src="${esc(src)}" alt="题图 ${i + 1}" loading="lazy"></span>`;
}
function qcMatchText(q, value) {
  const imgs = Array.isArray(q.images) ? q.images : [];
  return esc(String(value || '')).replace(/\[图(\d+)\]/g, (m, n) => imgs[Number(n) - 1] ? qcFig(imgs[Number(n) - 1], Number(n) - 1) : m).replace(/\n/g, '<br>');
}

/** 题干：富文本优先；纯文本时转义、[图N] 换成题图、换行转 <br>；没被引用的题图接在后面 */
function qcStem(q) {
  const imgs = Array.isArray(q.images) ? q.images : [];
  const used = new Set();
  const textWithImages = (value) => esc(String(value || '')).replace(/\n?\[图(\d+)\]\n?/g, (m, n) => {
    const i = Number(n) - 1;
    if (!imgs[i]) return m;
    used.add(i);
    return qcFig(imgs[i], i);
  }).replace(/\n/g, '<br>');
  const material = String(q.material || '').trim() ? `<div class="r3-material"><span>材料</span><div>${textWithImages(q.material)}</div></div>` : '';
  let html;
  if (q.stem_html && String(q.stem_html).trim()) html = qcSafeHtml(q.stem_html);
  else html = textWithImages(q.stem);
  if (QSubtype.isMatch(q.question_subtype)) [...(q.match_prompts || []), ...(q.options || []).map(optText)].forEach((v) => String(v || '').replace(/\[图(\d+)\]/g, (m, n) => { if (imgs[Number(n) - 1]) used.add(Number(n) - 1); return m; }));
  const rest = imgs.map((s, i) => (used.has(i) || (q.stem_html && String(q.stem_html).includes(s)) ? '' : qcFig(s, i))).join('');
  return material + html + (rest ? `<div class="r3-qfigs">${rest}</div>` : '');
}

/** 选项：按最长选项的长度自动排成 4 / 2 / 1 列；判断题不重复列出「对 / 错」 */
function qcOpts(q) {
  const opts = Array.isArray(q.options) ? q.options : [];
  if (!opts.length || q.type === 'judge') return '';
  if (q.stem_html && /class=["'][^"']*options/.test(q.stem_html)) return '';
  const items = opts.map((o, i) => {
    const lb = optLabel(o, i);
    const t = optText(o).replace(new RegExp('^\\s*' + lb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[.、．:：]\\s*'), '');
    return { lb, t };
  });
  const len = Math.max(...items.map((x) => x.t.replace(/\$[^$]*\$/g, 'xx').replace(/\\[a-z]+/gi, '').length));
  const cols = len <= 10 ? 4 : len <= 24 ? 2 : 1;
  return `<div class="r3-opts c${cols}">${items.map((x) => `<div class="r3-opt"><b>${esc(x.lb)}</b><span>${QSubtype.isMatch(q.question_subtype) ? qcMatchText(q, x.t) : esc(x.t)}</span></div>`).join('')}</div>`;
}

/** 答案显示：填空题「|」分隔各空、「|||」分隔可接受的多个答案 */
function qcAnswer(q) {
  const a = String(q.answer || '').trim();
  if (!a) return '';
  if (q.type === 'fill') {
    const blanks = a.replace(/\|\|\|/g, '\u0001').split('|').map((x) => x.split('\u0001').join(' / '));
    return blanks.length > 1 ? blanks.map((b, i) => `<span class="r3-blank"><i>${i + 1}</i>${esc(b)}</span>`).join('') : esc(blanks[0]);
  }
  return esc(a).replace(/\n/g, '<br>');
}

function qcDiffTag(d, score10) {
  const v = Number(d) || 0;
  const s = score10 == null || score10 === '' ? 0 : Number(score10);
  return v ? `<span class="r3-badge d${v}" title="${s ? `对应 ${v} 星` : '旧题仅记录五星难度，尚未细分为十级'}">${s ? `难度 ${s}/10` : `${QC_DIFF[v] || v} · ${v}星（未细分）`}</span>` : '';
}

/** 用户改动十级值时同步五星；手动改变五星且跨档时清除不再准确的十级值。 */
function qcBindDifficultyInputs(stars, score) {
  if (!stars || !score) return;
  score.addEventListener('input', () => { const n = Number(score.value); if (score.value !== '' && Number.isInteger(n) && n >= 1 && n <= 10) stars.value = String(Math.ceil(n / 2)); });
  stars.addEventListener('change', () => { const n = Number(score.value); if (score.value !== '' && Number.isInteger(n) && Math.ceil(n / 2) !== Number(stars.value)) score.value = ''; });
}

/** 一道题的卡片 */
function qcCard(q, o = {}) {
  const chapters = q.chapters || [];
  const knows = q.knows || [];
  const mount = q.mount || { chapter: chapters.length > 0, knowledge: knows.length > 0 };
  const miss = [!mount.chapter ? '章节' : '', !mount.knowledge ? '知识点' : ''].filter(Boolean);
  const gradeTxt = [QC_STAGE[q.stage] || '', q.grade || ''].filter(Boolean).join(' · ');
  const head = [
    `<span class="r3-badge type">${esc(qcType(q.type))}</span>`,
    q.question_subtype && QSubtype.find(q.question_subtype) ? `<span class="r3-badge">${esc(QSubtype.find(q.question_subtype).label)}</span>` : '',
    q.source_detail && q.source_detail.question_group ? `<span class="r3-badge">组合题 · 小题 ${Number(q.source_detail.question_group.position) || ''}</span>` : '',
    q.ai_review_metadata && Object.keys(q.ai_review_metadata.fields || {}).length ? '<span class="r3-badge" title="该题曾由老师确认 AI 建议，后续仍可能被编辑">曾采纳 AI 建议</span>' : (q.ai_review_metadata && q.ai_review_metadata.legacy_confirmed ? '<span class="r3-badge" title="旧版 AI 补全标记已由老师核对，具体来源无法区分">旧版 AI 标记已核对</span>' : ''),
    qcDiffTag(q.difficulty, q.difficulty_score_10),
    gradeTxt ? `<span class="r3-badge">${esc(gradeTxt)}</span>` : '',
    q.edition ? `<span class="r3-badge ed">${esc(q.edition)}</span>` : '',
    q.audio_url ? '<span class="r3-badge">听力</span>' : '',
  ].filter(Boolean).join('');
  const chapHtml = chapters.length
    ? chapters.slice(0, 3).map((c) => `<span class="r3-path" title="${esc(c.names.join(' / '))}">${TPN_SVG.book}${c.names.map((n) => `<em>${esc(n)}</em>`).join('<i>›</i>')}</span>`).join('')
    : '';
  const knowHtml = knows.length ? `<span class="r3-kws">${TPN_SVG.tag}${knows.slice(0, 6).map((k) => `<span class="r3-kw" title="${esc(k.names.join(' / '))}">${esc(k.name)}</span>`).join('')}</span>` : '';
  const missHtml = miss.length ? `<div class="r3-miss" role="note"><span class="r3-miss-dot"></span>未挂${miss.join('、')}分类${o.hangBtn ? `，<a href="javascript:;" data-qhang="${q.id}">现在挂上</a>` : ''}</div>` : '';
  const meta = [
    `组卷 <b>${Number(q.use) || 0}</b> 次`,
    q.reference_count != null ? `<span title="现存试卷（含草稿、归档和回收站）及绑定的视频、小分组的数量；不含分类和学生作答">本平台引用 <b>${Number(q.reference_count) || 0}</b> 处</span>` : '',
    q.source ? esc(q.source) : '',
    q.year && !String(q.source || '').includes(q.year) ? esc(q.year) + ' 年' : '',
    QC_SRC[q.source_type || 'local'] || '',
    `#${q.id}`,
  ].filter(Boolean).map((t) => `<span>${t}</span>`).join('<i class="r3-sep"></i>');
  const ans = qcAnswer(q);
  const ana = String(q.analysis || '').trim();
  return `<article class="r3-qcard ${miss.length ? 'miss' : ''} ${o.checked ? 'sel' : ''}" data-qid="${q.id}">
    <header class="r3-qhead">
      ${o.selectable === false ? '' : `<label class="r3-qck" title="勾选"><input type="checkbox" data-qck="${q.id}" ${o.checked ? 'checked' : ''} aria-label="勾选第 ${o.no || ''} 题"></label>`}
      ${o.no ? `<b class="r3-qno">${o.no}</b>` : ''}
      <div class="r3-badges">${head}</div>
      ${o.headRight || ''}
    </header>
    <div class="r3-qbody">
      <div class="r3-stem">${qcStem(q)}</div>
      ${QSubtype.isMatch(q.question_subtype) && Array.isArray(q.match_prompts) ? `<div class="r3-match"><b>匹配项目</b>${q.match_prompts.map((v, i) => `<div>${i + 1}. ${qcMatchText(q, v)}</div>`).join('')}</div>` : ''}
      ${qcOpts(q)}
      ${q.audio_url ? `<audio class="r3-audio" controls preload="none" src="${esc(withTicket(q.audio_url))}"></audio>` : ''}
    </div>
    ${chapHtml || knowHtml ? `<div class="r3-qtags">${chapHtml}${knowHtml}</div>` : ''}
    ${missHtml}
    <div class="r3-ans" hidden>
      <div class="r3-ans-row"><span class="r3-ans-k">答案</span><div class="r3-ans-v">${ans || '<span class="r3-dim">暂无答案</span>'}</div></div>
      <div class="r3-ans-row"><span class="r3-ans-k">解析</span><div class="r3-ans-v">${ana ? esc(ana).replace(/\n/g, '<br>') : '<span class="r3-dim">暂无解析</span>'}</div></div>
    </div>
    <footer class="r3-qfoot">
      <div class="r3-qmeta">${meta}</div>
      <div class="r3-qacts">
        <button type="button" class="r3-abtn" data-qans="${q.id}" aria-expanded="false">${o.ansLabel || '答案与解析'}<i>${TPN_SVG.down}</i></button>
        ${o.acts || ''}
      </div>
    </footer>
  </article>`;
}

/** 题卡交互：题图灯箱、答案解析原位展开 */
function qcBind(root) {
  if (!root) return;
  root.querySelectorAll('.r3-qcard').forEach((card) => {
    const figs = [...card.querySelectorAll('.r3-stem img, .r3-qfigs img')];
    figs.forEach((im, i) => { im.style.cursor = 'zoom-in'; im.onclick = () => { if (typeof mfLightbox === 'function') mfLightbox(figs.map((x) => x.src), i); }; });
    const b = card.querySelector('[data-qans]');
    if (b) b.onclick = () => {
      const box = card.querySelector('.r3-ans');
      const open = box.hasAttribute('hidden');
      if (open) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
      b.setAttribute('aria-expanded', String(open));
      b.classList.toggle('open', open);
      if (open && window.mtxTypeset) mtxTypeset(box);
    };
  });
  if (window.mtxTypeset) mtxTypeset(root);
}
window.qcCard = qcCard; window.qcBind = qcBind;
