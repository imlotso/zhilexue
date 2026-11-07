/* AI 单词记忆（学生端）——侧边栏第一目录，七个二级模块
 *
 *   #/words/quick    单词速记：按年级分组（小学 5 词/组、初中 10 词/组），每组走四步学习流
 *                    ① 单词学习（必为起点）→ ② 记忆学习 → ③ 听音拼写（单词速记）/ 听音选词（短语速记） → ④ 默写练习（单词速记）/ 语境填空（短语速记），
 *                    四步全部完成该分组由灰变绿（localStorage 记住）
 *   #/words/pos      词性训练：背诵学习（词形转换链） / 词形默写（挖空填词） / 词性判断（给词选词性）
 *   #/words/context  课文朗读：句子卡片列表（英 + 中），点喇叭听句、可调倍速、全文连读
 *   #/words/build    连词成句：点词块组句，可听句子、重置（无跳过，拼错自动进错句本）
 * 词书由管理端上传表格（xlsx/csv）后自动分发，所有词书对全体学生可见。
 * 每次作答都记录到 word_records，顶部显示本词书的训练统计。
 */
const WT = {
  books: null, bookId: '', unit: '',            // 当前词书 / 单元
  data: { words: [], sentences: [], pos: [] },  // 当前词书的数据缓存
  groupDefs: null, groupIdx: null,              // 单词分组（按年级 5 词/组 或 10 词/组）
  // 训练会话状态
  quick: { i: 0, order: [], mode: 'card', input: '', done: false, right: 0, wrong: 0 },
  pos: { i: 0, list: [], mode: 'match', q: null, picked: '', done: false, right: 0, wrong: 0 },
  read: { list: [], playing: false, idx: -1 },   // 课文朗读：当前列表与全文连读状态
  readGrp: '',                                    // 课文分组筛选（'' = 全部）
  build: { i: 0, list: [], picked: [], done: false, right: 0, wrong: 0 },
  listen: { i: 0, list: [], picked: [], done: false, right: 0, wrong: 0, timer: null, left: 0, limit: 15, phase: '' },
  // 考纲单词（三步流程）：mark = 标为「已会」的词；seen = 学前检测里点过「➕/移出」的词；
  //   fdone = 学前检测已完成（解锁「单词识记」），fg = 学前检测当前的大组（每 60 词一组），
  //   sort 正序/乱序/倒序，rand 乱序时的顺序缓存，stat 学前检测计数，
  //   learn = 单词识记（open 记录已展开释义的词卡），quiz = 学后检测 / 错词重练的答题会话
  syl: {
    mark: {}, seen: {}, fdone: false, fg: 0, size: 0, idx: 0, phase: 'filter', reveal: false, q: '',
    sort: 'order', rand: [], stat: { correct: 0, wrong: 0 }, learn: { gi: 0, open: {} },
    quiz: null, pendingDrill: null,
  },
};

const WT_SUBS = [
  { k: 'quick', t: '单词速记', i: 'flash', img: '/img/wt/quick.png' },
  { k: 'phrase', t: '短语速记', i: 'book', img: '/img/wt/phrase.png' },
  { k: 'pos', t: '词性训练', i: 'edit', img: '/img/wt/pos.png' },
  { k: 'context', t: '课文朗读', i: 'doc', img: '/img/wt/context.png' },
  { k: 'build', t: '连词成句', i: 'puzzle', img: '/img/wt/build.png' },
  { k: 'listen', t: '听音拼句', i: 'sound', img: '/img/wt/listen.png' },
  { k: 'syllabus', t: '考纲单词', i: 'list', img: '/img/wt/syllabus.png' },
  { k: 'typing', t: '键盘学堂', i: 'edit' },
  { k: 'letters', t: '字母乐园', i: 'star', img: '/img/wt/g_letters.png' },
  { k: 'phonetic', t: '音标训练', i: 'sound', img: '/img/wt/g_phonetic.png' },
];
/* 顶部模块分组：词汇训练 / 语感训练（模块内用内容区左侧导航切换小模块），指法练习独立模块。
 * 路由仍是 #/words/<sub>，分组只是导航层：点分组进入其第一个小模块。 */
const WT_GROUPS = [
  { k: 'vocab', t: '词汇训练', i: 'book', img: '/img/wt/g_vocab.png', subs: ['quick', 'phrase', 'pos', 'syllabus'] },
  { k: 'sense', t: '语感训练', i: 'doc', img: '/img/wt/g_sense.png', subs: ['context', 'build', 'listen'] },
  { k: 'phonics', t: '语音基础', i: 'sound', img: '/img/wt/g_phonics.png', subs: ['letters', 'phonetic'] },
  { k: 'typing', t: '键盘学堂', i: 'edit', img: '/img/wt/g_typing.png', subs: ['typing'] },
];
const wtIc = (name) => `<i class="ai ai-${name}" aria-hidden="true"></i>`;

/* 独立小模块（跟词书无关，整个页面就是一个自包含的小游戏，用 iframe 原样嵌入） */
const WT_APPS = {
  typing: { title: '键盘学堂', file: '/apps/keyboard-school/index.html', desc: '键盘学堂（认识键盘·学指法·练英文，从第一下按键开始）' },
};
/** 独立模块页：顶部说明 + 全高 iframe 嵌入 */
function wtAppFrame(key) {
  const app = WT_APPS[key];
  return {
    html: `
    <div class="wt-wrap">
      <iframe class="wt-frame" src="${app.file}" title="${esc(app.title)}"></iframe>
    </div>`,
  };
}

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);

/* ---------------- TTS / 定时器管理 ----------------
 * 治「点走了还在读、读得慢」：所有延迟朗读和自动跳转的定时器都挂到代次（tag）上，
 * 每次切页面 / 切步骤 / 切分组 wtStopSpeech() 会立刻停掉没读完的发音并作废旧定时器。 */
let WT_TTS_TIMERS = [];
let WT_TTS_TAG = 0;
let WT_SPEAK_TIMER = 0;
let WT_AUDIO = null;
/** 页面内的延迟任务 wtLater(fn, ms)（朗读 / 自动进入下一步）。切页作废，不再执行 */
function wtLater(fn, ms) {
  const tag = WT_TTS_TAG;
  WT_TTS_TIMERS.push(setTimeout(() => { if (tag === WT_TTS_TAG) fn(); }, ms));
}
/** 立刻停下：清空未触发的定时器 + 停掉正在排队/朗读中的语音 */
function wtStopSpeech() {
  WT_TTS_TAG++;
  WT_TTS_TIMERS.forEach(clearTimeout);
  WT_TTS_TIMERS = [];
  clearTimeout(WT_SPEAK_TIMER);
  try {
    if (WT_AUDIO) { WT_AUDIO.onended = null; WT_AUDIO.onerror = null; WT_AUDIO.pause(); WT_AUDIO.src = ''; WT_AUDIO = null; }
  } catch (e) { /* 忽略 */ }
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* 无声环境忽略 */ }
}
/* ---------------- 发音：有道词典真人音库（短英文） + 微软神经语音（整句/中文） ----------------
 * 短英文（单词/短语/音节，无标点 ≤40 字符）走有道 dictvoice：预生成真人音库 mp3，
 * 0.3 秒内返回，快而准；美音=1（女声）、英音=2（男声），口音跟随学生设置（顶栏 美/英 切换）。
 * 整句、中文、带标点的文本走原服务端微软神经语音合成（有道不支持句子）。
 * 有道加载失败（个别网络封禁）自动回退服务端合成，保证一定有声音。 */
/** 全局播放倍速（课文朗读页的「播放倍速」控制它，其它模块默认 1） */
let WT_TTS_RATE = 1;
/** 发音口音：'us' 美音（女声）/ 'uk' 英音（男声），localStorage 记忆 */
let WT_ACCENT = null;
function wtAccentGet() {
  if (WT_ACCENT === null) {
    try { WT_ACCENT = localStorage.getItem('xuexi_wtaccent') === 'uk' ? 'uk' : 'us'; } catch (e) { WT_ACCENT = 'us'; }
  }
  return WT_ACCENT;
}
function wtAccentSet(v) {
  WT_ACCENT = v === 'uk' ? 'uk' : 'us';
  try { localStorage.setItem('xuexi_wtaccent', WT_ACCENT); } catch (e) { /* 忽略 */ }
}
/** 短英文判定：单词 / 短语 / 音节碎片（无标点、无数字、≤40 字符） */
function wtIsShortEn(t) {
  return /^[A-Za-z][A-Za-z'\- ]{0,39}$/.test(String(t || '').trim());
}
/** 原服务端合成地址（微软神经语音，有道不支持的内容走这里） */
function wtSpeakUrlSrv(text, lang, rate) {
  const token = (typeof Auth !== 'undefined' && Auth && Auth.token) ? Auth.token : '';
  return '/api/speak?v=4&lang=' + encodeURIComponent(lang || 'en-US')
    + '&r=' + encodeURIComponent(String(rate == null ? (WT_TTS_RATE || 1) : rate))
    + '&text=' + encodeURIComponent(String(text).slice(0, 500))
    + (token ? '&token=' + encodeURIComponent(token) : '');
}
function wtSpeakUrl(text, lang, rate) {
  const L = String(lang || 'en-US');
  if (!/^zh/i.test(L) && wtIsShortEn(text)) {
    return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(text).trim())
      + '&type=' + (wtAccentGet() === 'uk' ? '2' : '1');
  }
  return wtSpeakUrlSrv(text, lang, rate);
}
/** 播放一句。onend 在播完或失败时调用，并带上原因（'ended' 正常播完 / 'blocked' 被浏览器拦截 / 'error' 加载失败）；
 * 点喇叭时必须在点击回调里同步调用，浏览器才允许出声。
 * 有道音频加载失败时自动回退服务端合成（同一句只回退一次，防止死循环）。 */
function wtPlayAudio(text, lang, onend, rate, noDict) {
  const t = String(text || '').trim();
  const tag = WT_TTS_TAG;
  if (!t) { if (onend) onend('ended'); return; }
  try { if (WT_AUDIO) { WT_AUDIO.onended = null; WT_AUDIO.onerror = null; WT_AUDIO.pause(); } } catch (e) { /* 忽略 */ }
  const useDict = !noDict;
  const src = wtSpeakUrl(t, lang, useDict ? rate : rate);
  const fromDict = useDict && src.indexOf('dict.youdao.com') >= 0;
  const audio = new Audio(src);
  WT_AUDIO = audio;
  const done = (how) => {
    if (audio !== WT_AUDIO || tag !== WT_TTS_TAG) return;
    if (onend) onend(how);
  };
  const failed = (how) => {
    if (audio !== WT_AUDIO || tag !== WT_TTS_TAG) return;
    if (fromDict) { wtPlayAudioSrv(t, lang, onend, rate); return; }
    done(how);
  };
  audio.onended = () => done('ended');
  audio.onerror = () => failed('error');
  const p = audio.play();
  if (p && p.catch) p.catch(() => failed('blocked'));
}
/** 服务端合成播放（有道失败时的兜底链路） */
function wtPlayAudioSrv(text, lang, onend, rate) {
  try { if (WT_AUDIO) { WT_AUDIO.onended = null; WT_AUDIO.onerror = null; WT_AUDIO.pause(); } } catch (e) { /* 忽略 */ }
  const audio = new Audio(wtSpeakUrlSrv(String(text || '').trim(), lang || 'en-US', rate));
  WT_AUDIO = audio;
  const tag = WT_TTS_TAG;
  const done = (how) => {
    if (audio !== WT_AUDIO || tag !== WT_TTS_TAG) return;
    if (onend) onend(how);
  };
  audio.onended = () => done('ended');
  audio.onerror = () => done('error');
  const p = audio.play();
  if (p && p.catch) p.catch(() => { if (audio === WT_AUDIO && tag === WT_TTS_TAG && onend) onend('blocked'); });
}
function speak(text, lang) {
  const t = String(text || '');
  // 含中文就用中文女声。词性判断的答案是「名词 / 动词」，用英文声读会变成一串怪音
  const use = lang || (/[\u4e00-\u9fff]/.test(t) ? 'zh-CN' : 'en-US');
  wtPlayAudio(t, use);
}
/** 浏览器 TTS：挑一个对应语言的真人音色；没有任何英文音色时用系统默认，别硬指定成中文腔 */
let WT_VOICES = [];
let WT_VOICE_RETRY = 0;
function wtLoadVoices() {
  try {
    if (!window.speechSynthesis) return;
    WT_VOICES = speechSynthesis.getVoices() || [];
    // Chrome/Edge 首次调用常返回空数组：挂 voiceschanged + 定时重试双保险
    if (!WT_VOICES.length && WT_VOICE_RETRY < 6) {
      WT_VOICE_RETRY++;
      speechSynthesis.onvoiceschanged = () => { WT_VOICE_RETRY = 99; wtLoadVoices(); };
      setTimeout(wtLoadVoices, 300);
      return;
    }
    speechSynthesis.onvoiceschanged = null;
  } catch (e) { /* 无声环境忽略 */ }
}
wtLoadVoices();
/** 给音色打分：本机音色优先。在线 Natural / Google 音色在国内经常加载失败，点了没声音 */
function wtVoiceScore(v, L, want) {
  const lang = String(v.lang || '').toLowerCase().replace('_', '-');
  const name = String(v.name || '');
  if (!lang.startsWith(want)) return -1;
  let s = lang === L ? 40 : 10;
  if (v.localService) s += 200;
  if (/online/i.test(name)) s -= 80;
  else if (/natural/i.test(name) && !v.localService) s -= 40;
  if (/desktop/i.test(name)) s += 30;
  else if (/microsoft/i.test(name)) s += 10;
  return s;
}
function wtPickVoice(lang) {
  const L = String(lang || 'en-US').toLowerCase().replace('_', '-');
  if (!WT_VOICES.length) wtLoadVoices();
  const want = L.slice(0, 2);
  let best = null, bestS = -1;
  for (const v of WT_VOICES) { const s = wtVoiceScore(v, L, want); if (s > bestS) { best = v; bestS = s; } }
  if (best) return best;
  // Chrome 在这台电脑上只暴露中文音色。不指定音色、只设 en-US 时，朗读会一直挂着且没有声音
  const local = WT_VOICES.filter((v) => v.localService);
  const pool = local.length ? local : WT_VOICES.slice();
  pool.sort((a, b) => (/huihui/i.test(a.name) ? -1 : 0) - (/huihui/i.test(b.name) ? -1 : 0));
  return pool[0] || null;
}
let WT_UTT = null;
let WT_UTT_KEEP = [];
/** 造一句朗读。必须绑上 getVoices() 里实际有的音色，否则 Chrome 会静音 */
function wtMakeUtterance(text, lang, rate) {
  const L = lang || 'en-US';
  const voice = wtPickVoice(L);
  const u = new SpeechSynthesisUtterance(text);
  // 英文单词仍标 en-US，音色用本机现有的（这里通常是微软慧慧）。只标 en-US、不设音色时没有声音
  u.lang = L;
  if (voice) u.voice = voice;
  u.rate = rate;
  u.pitch = 1;
  u.volume = 1;
  WT_UTT = u;
  WT_UTT_KEEP.push(u);
  if (WT_UTT_KEEP.length > 12) WT_UTT_KEEP.shift();
  return u;
}
/** 等上一次 cancel 真正结束再读。同一轮里 cancel 完立刻 speak，Chrome 会把这句丢掉 */
function wtQueueSpeak(u, tag) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const go = () => {
    if (tag !== WT_TTS_TAG) return;
    try {
      synth.resume();
      synth.speak(u);
      let n = 0;
      const kick = setInterval(() => {
        n += 1;
        if (n > 8 || !synth.speaking) { clearInterval(kick); return; }
        try { if (synth.paused) synth.resume(); } catch (e) { /* 忽略 */ }
      }, 120);
    } catch (e) { /* 无声环境忽略 */ }
  };
  clearTimeout(WT_SPEAK_TIMER);
  if (synth.speaking || synth.pending) {
    try { synth.cancel(); } catch (e) { /* 忽略 */ }
    const started = Date.now();
    const tick = () => {
      if (tag !== WT_TTS_TAG) return;
      if (!synth.speaking && !synth.pending) { go(); return; }
      if (Date.now() - started > 350) {
        try { synth.cancel(); } catch (e) { /* 忽略 */ }
        WT_SPEAK_TIMER = setTimeout(go, 80);
        return;
      }
      WT_SPEAK_TIMER = setTimeout(tick, 40);
    };
    WT_SPEAK_TIMER = setTimeout(tick, 40);
  } else {
    go();
  }
}
function browserSpeak(text, lang) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const t = String(text || '').trim();
    if (!t) return;
    const voices = synth.getVoices() || [];
    if (voices.length) WT_VOICES = voices;
    if (!WT_VOICES.length) {
      const tag = WT_TTS_TAG;
      const again = () => { if (tag === WT_TTS_TAG) browserSpeak(t, lang); };
      synth.onvoiceschanged = () => {
        WT_VOICES = synth.getVoices() || [];
        if (WT_VOICES.length) again();
      };
      if (WT_VOICE_RETRY < 8) { WT_VOICE_RETRY++; setTimeout(again, 200); }
      return;
    }
    const u = wtMakeUtterance(t, lang || 'en-US', (t.length <= 14 ? 0.9 : 1) * (WT_TTS_RATE || 1));
    u.onerror = (ev) => {
      const err = ev && ev.error;
      if (err === 'interrupted' || err === 'canceled' || err === 'cancelled' || u._retried) return;
      const want = String(u.lang || 'en').slice(0, 2).toLowerCase();
      const alt = WT_VOICES.find((v) => v !== u.voice && v.localService && String(v.lang || '').toLowerCase().startsWith(want));
      if (!alt) return;
      const u2 = new SpeechSynthesisUtterance(t);
      u2.lang = alt.lang; u2.voice = alt; u2.rate = u.rate; u2.volume = 1; u2._retried = true;
      WT_UTT = u2; WT_UTT_KEEP.push(u2);
      try { synth.resume(); synth.speak(u2); } catch (e) { /* 无声环境忽略 */ }
    };
    wtQueueSpeak(u, WT_TTS_TAG);
  } catch (e) { /* 无声环境忽略 */ }
}
async function wtRecord(module, correct, wordId) {
  // 作答反馈音：所有模块（单词/短语/词性/连词）的每道题都在这里统一出声，
  // 静音开关在顶栏，FX 不可用时自动无声（不影响功能）。
  if (typeof FX !== 'undefined') { if (correct) FX.correct(); else FX.wrong(); }
  // 速记流程被「短语速记 / 考纲单词」复用，作答按当前模块单独统计
  if (module === 'quick' && (WT.curSub === 'phrase' || WT.curSub === 'syllabus')) module = WT.curSub;
  try {
    await api('/api/stu/word/record', { method: 'POST', body: { module, bookId: Number(WT.bookId) || 0, wordId: wordId || null, correct: !!correct }, silent: true });
    if (WT.statsCache) delete WT.statsCache[WT.bookId];   // 有新作答 → 下次渲染重新拉统计
  } catch (e) { /* 统计失败不影响做题 */ }
}

/* ------------------------------------------------------------ 数据加载 */
/* ---------------- 模块与词书：各模块只用自己的词书，互不串 ----------------
 * 词书类型（管理端设置）：word 单词书 / pos 词形转换书 / sent 句子书 / phrase 短语书 / syllabus 考纲单词书。
 * 单词速记只看单词书；短语速记只看短语书；词性训练看词形书 + 带词性题的书；
 * 课文朗读 / 连词成句只看带句子的书。考纲单词只看「考纲单词书」（管理端「📋 考纲单词」窗口上传），与单词速记互不混用。 */
function wtModBooks(sub) {
  return (WT.books || []).filter((b) => {
    const k = b.kind || 'word';
    if (sub === 'quick') return k === 'word' && (b.word_count || 0) > 0;
    if (sub === 'syllabus') return k === 'syllabus' && (b.word_count || 0) > 0;
    if (sub === 'phrase') return k === 'phrase' && (b.phrase_count || 0) > 0;
    if (sub === 'pos') return k === 'pos' || (b.pos_count || 0) > 0;
    if (sub === 'context' || sub === 'build' || sub === 'listen') return k !== 'pos' && k !== 'phrase' && k !== 'syllabus' && (b.sentence_count || 0) > 0;
    return false;  // typing 不需要词书
  });
}
let WT_SUB_UID = '';
function wtSubStateUid() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return String(u.id || u.username || 'me');
}
function wtSubStateLoad() {
  WT_SUB_UID = wtSubStateUid();
  try { return JSON.parse(localStorage.getItem('xuexi_wtsub:' + WT_SUB_UID) || '{}'); } catch (e) { return {}; }
}
function wtSubStateSave() {
  try { localStorage.setItem('xuexi_wtsub:' + wtSubStateUid(), JSON.stringify(WT.subState || {})); } catch (e) { /* 隐私模式忽略 */ }
}
/** SPA 登录后用户身份才就绪：进入训练模块前核对一遍，身份变了就重读该账号的选择 */
function wtSubStateSync() {
  if (wtSubStateUid() !== WT_SUB_UID) WT.subState = wtSubStateLoad();
}
WT.subState = wtSubStateLoad();

/** 后台预取：首次进训练模块后悄悄把短语书 / 考纲词书的数据拉进缓存，之后点对应模块秒开 */
function wtPrefetchOthers() {
  try {
    if (WT.pf) return;
    WT.pf = true;
    setTimeout(() => {
      ['phrase', 'syllabus'].forEach((s) => {
        const mods = wtModBooks(s);
        if (!mods.length) return;
        const kk = s === 'phrase' ? 'phrase_count' : 'word_count';
        const b = mods.find((x) => (x[kk] || 0) > 0) || mods[0];
        const id = String(b.id);
        if (!WT.dataCache) WT.dataCache = {};
        if (!WT.dataCache[id] || Date.now() - (WT.dataCache[id].t || 0) > 600000) WT.dataCache[id] = { t: Date.now() };
        const c = WT.dataCache[id];
        const ep = s === 'phrase' ? 'phrases' : 'words';
        if (!c[ep]) api('/api/stu/word/' + ep + '?book_id=' + id).then((d) => { c[ep] = d || []; }).catch(() => {});
      });
    }, 2500);
  } catch (e) { /* 忽略 */ }
}

async function wtEnsureData(sub) {
  if (!WT.books) WT.books = await api('/api/stu/word/books');
  if (!WT.books || !WT.books.length) return false;   // 接口异常返回 null 时不至于抛错
  if (sub) {
    WT.curSub = sub;  // 当前模块（quick / phrase / pos / context / build），统计与文案都要区分
    // 只在当前模块可用的词书里选；没选过 / 选的不在列表里 → 自动挑一本有内容的
    const mods = wtModBooks(sub);
    if (!mods.length) return false;
    if (!WT.bookId || !mods.some((b) => String(b.id) === String(WT.bookId))) {
      const key = sub === 'pos' ? 'pos_count' : sub === 'phrase' ? 'phrase_count' : (sub === 'context' || sub === 'build' || sub === 'listen') ? 'sentence_count' : 'word_count';
      const usable = mods.find((b) => (b[key] || 0) > 0);
      WT.bookId = String((usable || mods[0]).id);
    }
  }
  const bid = Number(WT.bookId);
  /* 一次拉整本书 + 内存缓存（按词书）：切单元 / 切模块 / 答题重渲染不再重复请求，
   * 同一本书 10 分钟内只拉一次；老师后台改了词书数据，刷新页面即可看到最新 */
  if (!WT.dataCache) WT.dataCache = {};
  const key = String(bid);
  if (!WT.dataCache[key] || Date.now() - (WT.dataCache[key].t || 0) > 600000) WT.dataCache[key] = { t: Date.now() };
  const c = WT.dataCache[key];
  const jobs = [];
  if (WT.curSub === 'phrase') {
    if (!c.phrases) jobs.push(api('/api/stu/word/phrases?book_id=' + bid).then((d) => { c.phrases = d || []; }));
  } else if (WT.curSub === 'syllabus') {
    if (!c.words) jobs.push(api('/api/stu/word/words?book_id=' + bid).then((d) => { c.words = d || []; }));
  } else {
    if (!c.words) jobs.push(api('/api/stu/word/words?book_id=' + bid).then((d) => { c.words = d || []; }));
    if (!c.sentences) jobs.push(api('/api/stu/word/sentences?book_id=' + bid).then((d) => { c.sentences = d || []; }));
    if (!c.pos) jobs.push(api('/api/stu/word/pos?book_id=' + bid).then((d) => { c.pos = d || []; }));
  }
  if (jobs.length) await Promise.all(jobs);
  if (WT.curSub === 'phrase') {
    // 短语速记：拉短语库，别名为 words，整个速记流程（分组/学习/记忆/连连看/默写）原样复用
    const pAll = (c.phrases || []).map((p) => ({ ...p, word: p.phrase }));
    WT.data = { words: WT.unit ? pAll.filter((p) => (p.unit || '') === WT.unit) : pAll, wordsAll: pAll, sentences: [], sentencesAll: [], pos: [], posAll: [] };
  } else if (WT.curSub === 'syllabus') {
    // 考纲单词：不按单元划分，一次拉整本书的单词，剩下的交给「会/不会」筛选
    const words = c.words || [];
    WT.data = { words: words, wordsAll: words, sentences: [], sentencesAll: [], pos: [], posAll: [] };
  } else {
    const wAll = c.words || [], sAll = c.sentences || [], pAll = c.pos || [];
    WT.data = {
      words: WT.unit ? wAll.filter((w) => (w.unit || '') === WT.unit) : wAll,
      wordsAll: wAll,
      sentences: WT.unit ? sAll.filter((s) => (s.unit || '') === WT.unit) : sAll,
      sentencesAll: sAll,
      pos: pAll,
      posAll: pAll,
    };
    // 词性训练按单元过滤（前端筛）
    if (WT.curSub === 'pos' && WT.unit) WT.data.pos = pAll.filter((p) => (p.unit || '') === WT.unit);
  }
  wtPrefetchOthers();
  return true;
}

/** 训练页公共外壳：词书/单元选择 + 模块切换 + 统计条 */
async function wtShell(sub, inner) {
  wtStageOff();  // 从全屏练习退回模块页（切模块 / 退出练习都会经过这里）
  const has = await wtEnsureData(sub);
  if (!has) {
    const tip = sub === 'pos' ? '还没有词形转换词书：让老师在管理后台「词书管理」新建一本「词形转换书」，上传或 AI 生成词形数据'
      : (sub === 'context' || sub === 'build' || sub === 'listen') ? '还没有句子词书：让老师在管理后台「词书管理」新建一本「句子书」，上传句子表（可带「分组」列区分大课文 / 小课文）'
      : sub === 'phrase' ? '还没有短语书：让老师在管理后台「词书管理」新建一本「短语书」，上传短语表或 AI 生成'
      : sub === 'syllabus' ? '还没有考纲词书：让老师在管理后台「词书管理 → 📋 考纲单词」新建一本考纲词书并上传单词表'
      : '老师还没有上传单词表：让老师在管理后台「词书管理」上传一份 Excel / CSV 单词表就能开练';
    return {
      html: `<div class="card"><div class="empty"><div class="e-ic">🔤</div>${tip}</div></div>`,
    };
  }
  const modBooks = wtModBooks(sub);
  wtSubStateSync();
  // 记住「全部单元」的选择（unitAll）：下次进来不再强制重选单元
  const subSt = WT.subState[sub] || {};
  WT.subState[sub] = { book: WT.bookId, unit: WT.unit, unitAll: !!(subSt.book === WT.bookId && subSt.unitAll) };
  wtSubStateSave();
  const book = WT.books.find((b) => String(b.id) === String(WT.bookId));
  // ---- 学习概况面板数据：按当前词书整本统计（不按单元），单元胶囊角标 = 该单元词/句数 ----
  const isSent = sub === 'context' || sub === 'build' || sub === 'listen';
  const poolAll = isSent ? (WT.data.sentencesAll || WT.data.sentences || [])
    : sub === 'pos' ? (WT.data.posAll || WT.data.pos || [])
    : (WT.data.wordsAll || WT.data.words || []);
  // 单元名直接从缓存数据推导（不再请求 /units）：每个模块只显示自己有内容的单元
  const units = sub === 'syllabus' ? [] : [...new Set(poolAll.map((x) => String(x.unit || '').trim()).filter(Boolean))];
  // 统计：内存缓存 2 分钟，答题（wtRecord）后失效 → 切单元/切模块不再重复请求
  if (!WT.statsCache) WT.statsCache = {};
  let stats = WT.statsCache[WT.bookId];
  if (!stats || Date.now() - (stats._t || 0) > 120000) {
    stats = await api('/api/stu/word/stats?book_id=' + WT.bookId).catch(() => ({}));
    stats._t = Date.now();
    WT.statsCache[WT.bookId] = stats;
  }
  const st = stats[sub] || { correct: 0, wrong: 0 };
  const total = st.correct + st.wrong;
  const rate = total ? Math.round((st.correct / total) * 100) : null;
  const showWrong = sub === 'build' || sub === 'listen';              // 错句本：连词成句 / 听音拼句各自一本（分开记录、分开重练）
  const showWordWrong = sub === 'quick' || sub === 'phrase' || sub === 'syllabus';  // 错词本：单词/短语速记 + 考纲单词
  const showReview = showWordWrong;                             // 复习中心与错词本同排，在错词本前面
  const showPaper = sub === 'quick' || sub === 'phrase' || sub === 'context';  // 纸质化生成：单词/短语速记 + 课文朗读
  // 单元必选：词书里有单元、且上次没选过「全部单元」时，才要求先选单元
  const needUnit = (units || []).length > 0 && !WT.unit && !subSt.unitAll;
  const noun = sub === 'phrase' ? '短语' : '单词';
  const innerHtml = needUnit
    ? `<div class="card"><div class="empty">请先选择单元</div></div>`
    : (typeof inner === 'string' ? inner : (inner && inner.html) || '');

  // 课文分组（课文朗读 / 连词成句 / 听音拼句共用句子库）：当前单元下有分组数据才显示筛选条
  const sentGrps = (sub === 'context' || sub === 'build' || sub === 'listen') && !needUnit
    ? [...new Set((WT.data.sentences || []).map((x) => String(x.grp || '').trim()).filter(Boolean))] : [];
  const grpBar = sentGrps.length ? `
      <div class="rd-grps"><span class="rd-grps-t">课文分组</span>
        <button class="rd-chip ${WT.readGrp === '' ? 'on' : ''}" data-rdgrp="">全部</button>
        ${sentGrps.map((g) => `<button class="rd-chip ${WT.readGrp === g ? 'on' : ''} ${sub !== 'context' && wtRdGrpDone(g, sub) ? 'done' : ''}" data-rdgrp="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>` : '';

  // ---- 学习概况面板：单元胶囊角标 = 该单元词/句数（poolAll/units/isSent 已在上方算好） ----
  const unitCnt = (u) => poolAll.filter((x) => (x.unit || '') === u).length;
  // 单元完成联动：该单元下所有分组都学完（分组条变绿）→ 单元框也变绿（单词速记 / 短语速记 / 连词成句 / 听音拼句）
  const uidKey = (typeof Auth !== 'undefined' && Auth && Auth.user) ? (Auth.user.id || Auth.user.username || 'me') : 'me';
  const lsGet1 = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
  const unitAllDone = (u) => {
    try {
      if (sub === 'quick' || sub === 'phrase') {
        const ws = poolAll.filter((x) => String(x.unit || '').trim() === u);
        if (!ws.length) return false;
        const gn = Math.ceil(ws.length / wtGroupSize());
        for (let gi = 0; gi < gn; gi++) if (!lsGet1('xuexi_wtg:' + uidKey + ':' + WT.bookId + ':' + u + ':' + gi)) return false;
        return true;
      }
      if (sub === 'build' || sub === 'listen') {
        const gs = [...new Set(poolAll.filter((x) => String(x.unit || '').trim() === u).map((x) => String(x.grp || '').trim()).filter(Boolean))];
        if (!gs.length) return false;
        return gs.every((g) => lsGet1('xuexi_rdg:' + uidKey + ':' + WT.bookId + ':' + u + ':' + sub + ':' + g));
      }
    } catch (e) { /* 忽略 */ }
    return false;
  };
  const unitChipCls = (u) => ((sub === 'quick' || sub === 'phrase' || sub === 'build' || sub === 'listen') && unitAllDone(u) ? 'utdone' : '');
  const bookCnt = isSent ? (book ? (book.sentence_count || 0) : 0)
    : sub === 'phrase' ? (book ? (book.phrase_count || 0) : 0)
    : sub === 'pos' ? (book ? (book.pos_count || 0) : 0)
    : (book ? (book.word_count || 0) : 0);
  const cntName = isSent ? '句' : sub === 'phrase' ? '条短语' : sub === 'pos' ? '条词形' : '个单词';
  const rateHtml = rate !== null ? ` · 正确率 <b class="${rate >= 80 ? 'g' : rate >= 50 ? 'o' : 'r'}">${rate}%</b>` : '';
  const statsRow = `共 <b>${bookCnt}</b> ${cntName} · 已练 <b>${total}</b> 题${rateHtml}`;
  // 学习流程提示条（有复习中心/错词本的模块才显示）
  const flowLine = showWordWrong ? `
    <div class="wt-flow">${wtIc('dashboard')}学习流程：先做<b>复习中心</b>，再新学<b>${noun}</b>，最后清<b>错词本</b></div>` : '';

  return {
    html: `
    <div class="wt-wrap">
      <div class="card wt-head wt-panel">
        <div class="wt-panel-top">
          <div class="wt-panel-book">
            <span class="wt-panel-lb">词书选择</span>
            <select id="wtBook" class="wt-sel">${modBooks.map((b) => `<option value="${b.id}" ${String(b.id) === String(WT.bookId) ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
          </div>
          <div class="wt-panel-btns">
            ${showWrong ? `<button class="btn ghost wt-wrong-btn" id="wtWrongBtn" title="错句本">${wtIc('book')} 错句本<i class="wt-wrong-n" style="display:none"></i></button>` : ''}
            ${showPaper ? `<button class="btn ghost wt-paper-btn" id="wtPaperBtn" title="生成纸质默写表">🖨️ 纸质化生成</button>` : ''}
            ${showReview ? `<button class="btn ghost wt-wrong-btn" id="wtReviewBtn" title="复习中心（SM-2 记忆排程）">${wtIc('clock')} 复习中心<i class="wt-review-n" style="display:none"></i></button>` : ''}
            ${showWordWrong ? `<button class="btn ghost wt-wrong-btn" id="wtWrongWordBtn" title="错词本">${wtIc('book')} 错词本<i class="wt-wwrong-n" style="display:none"></i></button>` : ''}
          </div>
        </div>
        ${(units || []).length ? `
        <div class="wt-panel-units">
          <span class="wt-panel-lb wt-panel-lb-u">单元选择</span>
          <button class="wt-uchip wt-uchip-all ${!WT.unit && subSt.unitAll ? 'on' : ''}" data-wu="">全部单元<i>共 ${poolAll.length}</i></button>
          <div class="wt-uchips">
            ${units.map((u) => `<button class="wt-uchip ${WT.unit === u ? 'on' : ''} ${unitChipCls(u)}" data-wu="${esc(u)}"><span class="wt-uchip-t">${esc(u)}</span><i>${unitCnt(u)}</i></button>`).join('')}
          </div>
        </div>` : ''}
        <div class="wt-panel-stats">${statsRow}</div>
      </div>
      ${flowLine}
      ${grpBar}
      ${innerHtml}
    </div>`,
    after: () => {
      const b = document.getElementById('wtBook');
      if (b) b.onchange = () => { WT.bookId = b.value; WT.unit = ''; WT.subState[sub] = { book: WT.bookId, unit: '', unitAll: false }; wtSubStateSave(); wtReset(sub); render(); };
      document.querySelectorAll('[data-wu]').forEach((c) => c.onclick = () => {
        const v = c.dataset.wu || '';
        const already = v ? WT.unit === v : (!WT.unit && subSt.unitAll);  // 点当前已选中的单元不重置
        if (already) return;
        wtStopSpeech();
        WT.unit = v;
        WT.subState[sub] = { book: WT.bookId, unit: WT.unit, unitAll: !v };
        wtSubStateSave();
        wtReset(sub);
        render();
      });
      document.querySelectorAll('[data-rdgrp]').forEach((c) => c.onclick = () => { wtStopSpeech(); WT.readGrp = c.dataset.rdgrp; render(); });
      if (showWrong) {
        wtWrongBadge();
        const wb = document.getElementById('wtWrongBtn');
        if (wb) wb.onclick = wtWrongOpen;
      }
      if (showPaper) {
        const pb = document.getElementById('wtPaperBtn');
        if (pb) pb.onclick = () => wtPaperOpen(sub);
      }
      if (showWordWrong) {
        wtWrongWordBadge();
        const wwb = document.getElementById('wtWrongWordBtn');
        if (wwb) wwb.onclick = wtWrongWordOpen;
      }
      if (showReview) {
        wtReviewBadge();
        const rb = document.getElementById('wtReviewBtn');
        if (rb) rb.onclick = wtReviewOpen;
      }
      if (!needUnit && inner && inner.after) inner.after();
    },
  };
}

function wtReset(sub) {
  wtStopSpeech();  // 换词书 / 换单元：停掉旧页面还在排队的朗读
  WT_DRILL_REVIEW = false;
  WT.readGrp = '';  // 换词书 / 换单元后分组回到「全部」
  if (sub === 'listen' && WT.listen && WT.listen.timer) clearInterval(WT.listen.timer);  // 听音拼句的倒计时必须显式清掉
  WT[sub] = { i: 0, order: [], mode: sub === 'pos' ? 'learn' : '', input: '', done: false, right: 0, wrong: 0, list: [], q: null, picked: '', build: [], step: '' };
  if (sub === 'build') WT.build.picked = [];
  WT.groupDefs = null; WT.groupIdx = null;  // 换词书 / 换单元后分组重新算
  // 退出全屏学习 / 换书换单元后回到「勾选分组」页：必须自己点分组才会再进全屏（否则点退出会被立刻弹回去）
  WT.needPick = true;
  // 考纲单词：换词书 → 回到「学前检测」页（标记与检测统计按词书分别保存，换回来还在）
  if (sub === 'syllabus') {
    WT.syl.phase = 'filter'; WT.syl.idx = 0; WT.syl.reveal = false;
    WT.syl.quiz = null; WT.syl.pendingDrill = null;
  }
}

/* ------------------------------------------------------------ 1. 单词速记（四步学习流）
 *   ① 单词学习   整词读一遍 → 分音节读一遍 → 跟读 3 遍 + 分音节抄写英文 3 遍 + 中文 1 遍
 *   ② 记忆学习   给英文 → 点「认识」出四个中文选项，选对进入下一个；点「不认识」亮出中文释义，
 *                 先读英文放大英文、再读中文放大中文
 *   ③ 听音拼写   （单词速记）分音节（拼读式发音）+ 整词只读一遍，音节块打乱 + 1 个干扰块，按序点块拼词，10 秒倒计时；
 *                 （短语速记）听音选词：系统读一遍短语，中文释义盖住（点一下显示），短语单词打乱 + 1 个干扰词，按序点词拼短语
 *   ④ 默写练习   给中文敲英文，拼错的词排到队尾反复出现，直到拼对为止
 *                 （短语速记）语境填空：AI 生成同年级课本风格例句挖空短语，默写出这条短语，附整句中文
 */
const WT_STEPS = [
  { k: 'read', ic: 'edit', t: '单词学习' },
  { k: 'memorize', ic: 'eye', t: '记忆学习' },
  { k: 'match', ic: 'link', t: '消消乐' },
  { k: 'spell', ic: 'doc', t: '默写练习' },
];
const wtStepLabel = (s, noun) => {
  const isQuick = (WT.curSub || 'quick') === 'quick';
  let t = noun === '短语' ? s.t.replace('单词', '短语') : s.t;
  const isListen = s.k === 'match';   // 第③步都是「听」：单词=听音拼选；短语=听音选词
  if (isListen) t = isQuick ? '听音拼选' : '听音选词';
  if (s.k === 'spell' && !isQuick) t = '语境填空';
  return `${wtIc(isListen ? 'sound' : s.ic)} ${t}`;
};
const wtChunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const wtNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

/* ---------------- 全屏学习舞台 ----------------
 * 勾选分组开始练习后，整个练习区变成固定在屏幕上的「大弹窗」（类似放视频的全屏感）：
 * 浅绿背景、超大字体，右上角可切 字号 大 / 中 / 小（localStorage 记住），点「退出」回到模块页。 */
let WT_STAGE_BAR = null;
function wtFsKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtfs:' + (u.id || u.username || 'me');
}
function wtFsGet() { try { return localStorage.getItem(wtFsKey()) || 'big'; } catch (e) { return 'big'; } }
function wtFsSet(v) { try { localStorage.setItem(wtFsKey(), v); } catch (e) { /* 忽略 */ } }
function wtStageOn() {
  document.body.classList.add('wt-stage');
  document.body.classList.remove('wt-fs-big', 'wt-fs-mid', 'wt-fs-small');
  document.body.classList.add('wt-fs-' + wtFsGet());
  if (!WT_STAGE_BAR) {
    WT_STAGE_BAR = document.createElement('div');
    WT_STAGE_BAR.className = 'wt-stage-bar';
    WT_STAGE_BAR.innerHTML = `
      <span class="wt-stage-cap">学习中</span>
      <span class="wt-stage-grp"></span>
      <span class="wt-stage-fs">
        <button data-fs="big" title="大字号">大</button>
        <button data-fs="mid" title="中字号">中</button>
        <button data-fs="small" title="小字号">小</button>
      </span>
      <button class="wt-stage-exit" title="退出学习">退出</button>`;
    WT_STAGE_BAR.querySelectorAll('[data-fs]').forEach((b) => b.onclick = () => {
      wtFsSet(b.dataset.fs);
      document.body.classList.remove('wt-fs-big', 'wt-fs-mid', 'wt-fs-small');
      document.body.classList.add('wt-fs-' + b.dataset.fs);
      wtQuickRevealCurrent();
    });
    WT_STAGE_BAR.querySelector('.wt-stage-exit').onclick = () => {
      wtStageOff();
      // 考纲单词退出学习 → 回到「单词识记」的分组选择页（方便接着练下一组）
      if (WT.curSub === 'syllabus') {
        WT.syl.quiz = null;
        WT.syl.phase = 'learn';
        WT.needPick = true;
        render();
        return;
      }
      wtReset(WT.curSub || 'quick'); render();
    };
  }
  const g = WT_STAGE_BAR.querySelector('.wt-stage-grp');
  if (g) {
    const q = WT.quick || {};
    const total = (WT.groupDefs || []).length;
    if (WT.curSub === 'syllabus' && WT.syl) {
      const gi = WT.groupIdx >= 0 ? WT.groupIdx + 1 : 0;
      const st = WT.syl.phase;
      const qz = WT.syl.quiz;
      g.textContent = qz && qz.drill ? '📕 错词重练'
        : st === 'test' ? `学后检测 · 第 ${gi} 组`
          : st === 'learn' && !WT.needPick ? `单词识记 · 第 ${gi} 组` : '';
    } else {
      g.textContent = q.drill ? (WT_DRILL_REVIEW ? '🎯 SM-2 复习' : '📕 错词重练')
        : (total && WT.groupIdx >= 0 ? `分组 ${WT.groupIdx + 1} / ${total}` : '');
    }
  }
  document.body.appendChild(WT_STAGE_BAR);
  window.addEventListener('resize', wtQuickRevealCurrent);
}
function wtStageOff() {
  window.removeEventListener('resize', wtQuickRevealCurrent);
  document.body.classList.remove('wt-stage', 'wt-fs-big', 'wt-fs-mid', 'wt-fs-small');
  if (WT_STAGE_BAR && WT_STAGE_BAR.parentNode) WT_STAGE_BAR.parentNode.removeChild(WT_STAGE_BAR);
  // 兜底：万一有重复创建的浮条残留（快速连点退出/进入时），一并清掉
  document.querySelectorAll('.wt-stage-bar').forEach((n) => { if (n !== WT_STAGE_BAR) n.remove(); });
}
/** 当前模块的名词（短语速记里把「单词」文案换成「短语」） */
function wtNoun() { return WT.curSub === 'phrase' ? '短语' : '单词'; }

/* ---------------- 单词分组 ----------------
 * 小学 3-6 年级每 5 个单词一组，初中 7-9 年级每 10 个一组（年级先看词书、再看学生账号）。
 * 每组都要从「单词学习」开始练完四个步骤，全部完成后该分组由灰变绿（localStorage 记住）。 */
const WT_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function wtGroupSize() {
  const book = (WT.books || []).find((b) => String(b.id) === String(WT.bookId)) || {};
  const grade = String(book.grade || '') || String((typeof Auth !== 'undefined' && Auth && Auth.user && Auth.user.grade) || '');
  const m = grade.match(/[一二三四五六七八九]/);
  const n = m ? WT_NUM[m[0]] : (/中考/.test(grade) ? 9 : 0);
  return (n >= 3 && n <= 6) ? 5 : 10;
}
function wtCalcGroups() {
  WT.groupDefs = wtChunk(WT.data.words, wtGroupSize());
  const first = WT.groupDefs.findIndex((_, i) => !wtGroupDone(i));
  WT.groupIdx = first >= 0 ? first : 0;
}
function wtGroupKey(gi) {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  const uid = u.id || u.username || 'me';
  // 考纲单词的分组是按「筛出来的待学词」现场切的，重新筛选后分组会重排，
  // 所以用「组内单词 id」当指纹，而不是序号 —— 否则变绿的组会串到别的组上
  if (WT.curSub === 'syllabus') {
    const g = (WT.groupDefs || [])[gi] || [];
    return 'xuexi_wtg:' + uid + ':syl:' + WT.bookId + ':' + sylSize() + ':' + g.map((w) => w.id).join('-');
  }
  return 'xuexi_wtg:' + uid + ':' + WT.bookId + ':' + (WT.unit || '*') + ':' + gi;
}
function wtGroupDone(gi) { try { return localStorage.getItem(wtGroupKey(gi)) === '1'; } catch (e) { return false; } }
function wtGroupMark(gi) {
  try { localStorage.setItem(wtGroupKey(gi), '1'); } catch (e) { /* 隐私模式忽略 */ }
  // 分组完成（变绿）→ 整组单词进入复习中心排程
  try { wtSrsSeedWords((WT.groupDefs || [])[gi] || []); } catch (e) { /* 忽略 */ }
  // 同步到服务端：后台「学生学习进度」要展示每个学生每本词书哪些分组已完成（失败静默，不影响学生端）
  try {
    const g = (WT.groupDefs || [])[gi] || [];
    api('/api/stu/word/group-done', { method: 'POST', silent: true, body: {
      bookId: Number(WT.bookId) || 0,
      module: WT.curSub === 'syllabus' ? 'syllabus' : 'quick',
      unit: WT.unit || '',
      gi,
      size: WT.curSub === 'syllabus' ? sylSize() : wtGroupSize(),
      n: g.length,
      fp: WT.curSub === 'syllabus' ? g.map((w) => w.id).join('-') : '',
    } }).catch(() => {});
  } catch (e) { /* 忽略 */ }
}
/* 课文分组完成标记（连词成句 / 听音拼句）：把某个分组的句子练完一轮，该分组就变绿（localStorage 记住）。
 * 连词成句与听音拼句分开记录；课文朗读只是筛选，不参与变绿。 */
function wtRdGrpKey(grp, mode) {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_rdg:' + (u.id || u.username || 'me') + ':' + WT.bookId + ':' + (WT.unit || '*') + ':' + (mode || WT.curSub || '') + ':' + grp;
}
function wtRdGrpDone(grp, mode) { try { return localStorage.getItem(wtRdGrpKey(grp, mode)) === '1'; } catch (e) { return false; } }
function wtRdGrpMark(list, mode) {
  [...new Set((list || []).map((x) => String(x.grp || '').trim()).filter(Boolean))]
    .forEach((g) => { try { localStorage.setItem(wtRdGrpKey(g, mode), '1'); } catch (e) { /* 隐私模式忽略 */ } });
}
/** 分组选择条：灰色=还没练完，绿色=四个练习全部完成，蓝框=当前正在练 */
function wtBindGroups() {
  const bar = document.getElementById('wtGroups');
  if (!bar) return;
  bar.innerHTML = (WT.groupDefs && WT.groupDefs.length)
    ? `<div class="wt-groups">${WT.groupDefs.map((g, i) => `
        <button class="wt-grp ${wtGroupDone(i) ? 'done' : ''} ${i === WT.groupIdx && !WT.needPick ? 'on' : ''}" data-g="${i}" title="分组${i + 1}">
          <span>分组${i + 1}</span><em>${g.length} 个</em>
        </button>`).join('')}</div>`
    : '';
  bar.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => wtStartGroup(Number(b.dataset.g), false));
}
/* ---------------- 错词本 ----------------
 * 单词速记里答错的单词（记忆学习点「不认识」/ 选错、连连看连错、默写拼错）自动进本，
 * 按 学生+词书 存 localStorage；头部右侧「📕 错词本」打开，可听发音、移出、一键重练默写，
 * 重练时拼对 / 平时默写拼对都会自动移出错词本。 */
let WT_WORD_DRILL = null;  // 待重练的错词（错词本「开始重练」写入，wtQuickStart 消费后清空）
let WT_DRILL_REVIEW = false;  // 本轮重练是否来自「复习中心」（SM-2 复习轮，标题与完成页文案不同）
function wtWrongWordKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtwd:' + (u.id || u.username || 'me') + ':' + WT.bookId;
}
function wtWrongWordAll() { try { return JSON.parse(localStorage.getItem(wtWrongWordKey()) || '[]'); } catch (e) { return []; } }
function wtWrongWordSave(list) { try { localStorage.setItem(wtWrongWordKey(), JSON.stringify(list.slice(-300))); } catch (e) { /* 隐私模式忽略 */ } }
/** 当前词书整本的在册错词（错词本按词书显示，不再按单元过滤） */
function wtWrongWordList() {
  return wtWrongWordAll();
}
/** 今天 0 点以来出错 / 又错的词（「本日错词」页数据源，角标也用它） */
function wtWrongWordToday() {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  return wtWrongWordAll().filter((x) => (x.t || 0) >= dayStart.getTime());
}
function wtWrongWordAdd(w, src, extra) {
  if (!w || !w.word) return;
  const list = wtWrongWordAll();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const ex = list.find((x) => String(x.id) === String(w.id) || String(x.word).toLowerCase() === String(w.word).toLowerCase());
  if (ex) {
    // 跨天再错 → 次数重新从 1 起算（「本日错词」显示的是今天错了几次）
    ex.cnt = (ex.t || 0) < dayStart.getTime() ? 1 : (ex.cnt || 1) + 1;
    ex.t = Date.now();
    ex.src = src || ex.src || '记忆学习';
    if (extra && extra.ty) ex.ty = extra.ty;   // 出错环节的题型（考纲单词重练按环节出题用）
    ex.unit = w.unit || ex.unit || WT.unit || '';
    ex.phonetic = w.phonetic || ex.phonetic || '';
    ex.meaning = w.meaning || ex.meaning || '';
    const nl = list.filter((x) => x !== ex); nl.push(ex);
    wtWrongWordSave(nl);
  } else {
    list.push({ id: w.id, word: w.word, phonetic: w.phonetic || '', meaning: w.meaning || '', unit: w.unit || WT.unit || '', src: src || '记忆学习', ty: (extra && extra.ty) || '', t: Date.now(), cnt: 1 });
    wtWrongWordSave(list);
  }
  wtWrongHistAdd(w, src);   // 历史错词累计（只增不减）
  wtWrongWordBadge();
}
function wtWrongWordRemove(id) { wtWrongWordSave(wtWrongWordAll().filter((x) => String(x.id) !== String(id))); }
/* ---- 历史错词：纯记录（累计出错次数，拼对移出在册本也不删历史），按 学生+词书 存 localStorage ---- */
function wtWrongHistKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtwdh:' + (u.id || u.username || 'me') + ':' + WT.bookId;
}
function wtWrongHistAll() { try { return JSON.parse(localStorage.getItem(wtWrongHistKey()) || '{}'); } catch (e) { return {}; } }
function wtWrongHistSave(map) { try { localStorage.setItem(wtWrongHistKey(), JSON.stringify(map)); } catch (e) { /* 隐私模式忽略 */ } }
function wtWrongHistList() { return Object.values(wtWrongHistAll()).filter((x) => x && x.word); }
function wtWrongHistAdd(w, src) {
  if (!w || !w.word) return;
  const map = wtWrongHistAll();
  const k = String(w.id);
  const e = map[k] || { id: w.id, word: w.word, phonetic: w.phonetic || '', meaning: w.meaning || '', unit: w.unit || WT.unit || '', cnt: 0, first: Date.now(), last: 0 };
  e.word = w.word;
  e.meaning = w.meaning || e.meaning || '';
  e.phonetic = w.phonetic || e.phonetic || '';
  e.unit = e.unit || w.unit || WT.unit || '';
  e.cnt = (e.cnt || 0) + 1;
  e.last = Date.now();
  map[k] = e;
  wtWrongHistSave(map);
}
function wtWrongWordBadge() {
  const n = wtWrongWordToday().length;
  document.querySelectorAll('.wt-wwrong-n').forEach((el) => {
    el.textContent = n > 99 ? '99+' : n;
    el.style.display = n ? '' : 'none';
  });
}
/** 打开错词本弹窗：本日错词（今天出错的词 + 开始重练）/ 历史错词（按单元汇总的累计出错记录） */
function wtWrongWordOpen() {
  wtStopSpeech();
  const book = (WT.books || []).find((b) => String(b.id) === String(WT.bookId));
  const isSyl = WT.curSub === 'syllabus';
  // 兜底迁移：老数据没有历史记录 → 把在册错词补进历史（只补缺失的，不动已有的次数）
  const hist = wtWrongHistAll();
  let histDirty = false;
  wtWrongWordAll().forEach((x) => {
    if (x && x.word && !hist[String(x.id)]) {
      hist[String(x.id)] = { id: x.id, word: x.word, phonetic: x.phonetic || '', meaning: x.meaning || '', unit: x.unit || '', cnt: x.cnt || 1, first: x.t || Date.now(), last: x.t || Date.now() };
      histDirty = true;
    }
  });
  if (histDirty) wtWrongHistSave(hist);
  const all = wtWrongWordAll();                                  // 在册（未清）错词
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = all.filter((x) => (x.t || 0) >= dayStart.getTime());
  const older = all.filter((x) => (x.t || 0) < dayStart.getTime());  // 更早还没清掉的错词
  const histList = wtWrongHistList();
  const PAGE = 10;                                               // 每页最多 10 条
  const pages = Math.max(1, Math.ceil(today.length / PAGE));
  let page = 0;
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="modal wide">
    <div class="modal-h"><h3>📕 错词本${book ? ` · ${esc(book.title)}` : ''}<span class="wt-ws-cnt">今日 ${today.length} 词 · 历史共 ${histList.length} 词</span></h3><button class="close-x">&times;</button></div>
    <div class="modal-b">
      <div class="wt-tabs">
        <button class="wt-tab on" data-tab="today">本日错词<i>${today.length}</i></button>
        <button class="wt-tab" data-tab="hist">历史错词<i>${histList.length}</i></button>
      </div>
      <div id="wtWwToday">
        ${today.length ? `<div class="wt-ws-tip">${isSyl
          ? '今天没认出来的词都在这里。点「开始重练」会按各自<b>出错的环节</b>（看英选义 / 看义选英 / 听音辨义）重新识记，<b>认对一个自动移出一个</b>。'
          : '今天答错或没写对的词都在这里。点「开始重练」逐词默写，<b>写对一个自动移出一个</b>。'}</div>
        <div class="wt-ws-list" id="wtWwList"></div>` : ''}
        ${!today.length ? `<div class="empty"><div class="e-ic">🎉</div>今天还没有错词，继续保持！${older.length ? `<p class="wt-ww-old-tip">另有 ${older.length} 个更早的错词还没清掉，可点右下角按钮重练</p>` : ''}</div>` : ''}
      </div>
      <div id="wtWwHist" style="display:none">
        ${histList.length ? `<div class="wt-ws-tip">本词书的历史错词记录（只统计、不参与重练）：按单元汇总每个词的累计出错次数。</div>
        <div class="wt-ws-list" id="wtWwHistList"></div>` : `<div class="empty"><div class="e-ic">🗒️</div>这本词书还没有历史错词记录</div>`}
      </div>
    </div>
    ${today.length || older.length ? `<div class="modal-f">
      ${pages > 1 ? `<div class="wt-pager"><button class="btn ghost wt-pg-btn" id="wtWwPrev">上一页</button><span class="wt-pg-info" id="wtWwPgInfo"></span><button class="btn ghost wt-pg-btn" id="wtWwNext">下一页</button></div>` : ''}
      ${older.length ? `<button class="btn ghost wt-pg-btn" id="wtWwOldGo" title="重练更早未清的错词">${wtIc('play')} 重练更早未清（${older.length} 词）</button>` : ''}
      ${today.length ? `<button class="btn primary-sm" id="wtWwGo" style="width:auto;padding:0 22px">${wtIc('play')} 开始重练（今日 ${today.length} 词）</button>` : ''}
    </div>` : ''}
  </div>`;
  document.body.appendChild(mask);
  const close = () => { wtStopSpeech(); mask.remove(); };
  mask.querySelector('.close-x').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  // 页签切换（历史错词页隐藏底部重练栏）
  mask.querySelectorAll('[data-tab]').forEach((t) => t.onclick = () => {
    const v = t.dataset.tab;
    mask.querySelectorAll('.wt-tab').forEach((x) => x.classList.toggle('on', x === t));
    const tp = mask.querySelector('#wtWwToday'); if (tp) tp.style.display = v === 'today' ? '' : 'none';
    const hp = mask.querySelector('#wtWwHist'); if (hp) hp.style.display = v === 'hist' ? '' : 'none';
    const f = mask.querySelector('.modal-f'); if (f) f.style.display = v === 'today' ? '' : 'none';
  });
  const listBox = mask.querySelector('#wtWwList');
  const renderPage = () => {
    if (!listBox) return;
    const slice = today.slice(page * PAGE, page * PAGE + PAGE);
    listBox.innerHTML = slice.map((x) => `
      <div class="wt-ws-item" data-id="${x.id}">
        <div class="wt-ws-main">
          <p class="wt-ws-en">${esc(x.word)} <button class="wq-spk" data-spk title="听发音">${wtIc('volume')}</button>${x.phonetic ? `<span class="wt-wl-phon">${esc(x.phonetic)}</span>` : ''}</p>
          ${x.meaning ? `<p class="wt-ws-cn">${esc(x.meaning)}</p>` : ''}
        </div>
        <div class="wt-ws-acts">
          ${x.unit ? `<span class="wt-ws-unit">${esc(x.unit)}</span>` : ''}
          ${x.src ? `<span class="wt-ws-src" title="出错环节">${esc(x.src)}${isSyl && x.ty && SYL_TYPE_NAME[x.ty] ? ' · ' + SYL_TYPE_NAME[x.ty] : ''}</span>` : ''}
          <span class="wt-err-n" title="今天错了几次">错 ${(x.cnt || 1)} 次</span>
        </div>
      </div>`).join('');
    listBox.scrollTop = 0;
    listBox.querySelectorAll('[data-spk]').forEach((b) => b.onclick = () => {
      const item = b.closest('.wt-ws-item');
      const x = today.find((y) => String(y.id) === item.dataset.id);
      if (x) speak(x.word);
    });
    const info = mask.querySelector('#wtWwPgInfo');
    if (info) info.textContent = `第 ${page + 1} / ${pages} 页`;
    const prev = mask.querySelector('#wtWwPrev');
    const next = mask.querySelector('#wtWwNext');
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page >= pages - 1;
  };
  if (listBox) renderPage();
  const prev = mask.querySelector('#wtWwPrev');
  const next = mask.querySelector('#wtWwNext');
  if (prev) prev.onclick = () => { if (page > 0) { page--; renderPage(); } };
  if (next) next.onclick = () => { if (page < pages - 1) { page++; renderPage(); } };
  // 历史错词：按单元分组（自然排序），单元内按累计次数降序
  const histBox = mask.querySelector('#wtWwHistList');
  if (histBox) {
    const groups = {};
    histList.forEach((x) => { const u = x.unit || ''; (groups[u] = groups[u] || []).push(x); });
    const names = Object.keys(groups).filter((u) => u).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
    if (groups['']) names.push('');   // 没有单元信息的排最后
    const dstr = (ts) => { const d = new Date(ts || 0); return d.getTime() ? `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}` : ''; };
    histBox.innerHTML = names.map((u) => `
      <div class="wt-hist-g">
        <div class="wt-hist-h">${esc(u || '未分单元')}<span>${groups[u].length} 词</span></div>
        ${groups[u].slice().sort((a, b) => (b.cnt || 0) - (a.cnt || 0)).map((x) => `
          <div class="wt-hist-row">
            <span class="wt-hist-w">${esc(x.word)}</span>
            <span class="wt-hist-m">${esc(x.meaning || '')}</span>
            <span class="wt-err-n">错 ${x.cnt || 1} 次</span>
            ${x.last ? `<span class="wt-hist-d">最近 ${dstr(x.last)}</span>` : ''}
          </div>`).join('')}
      </div>`).join('');
  }
  // 开始重练（复用原有重练链路：quick → 默写轮，syllabus → 识记轮）
  const drill = (words) => {
    close();
    WT_DRILL_REVIEW = false;  // 错词本重练不是复习轮
    const ws = words.map((x) => ({ id: x.id, word: x.word, phonetic: x.phonetic, meaning: x.meaning, unit: x.unit, _ty: x.ty || '' }));
    // 在哪个模块打开就回哪个模块重练（短语/考纲/单词速记都有各自错词本，phrase 也走 wtQuickStart 消费）
    const target = '/words/' + (WT.curSub === 'syllabus' ? 'syllabus' : WT.curSub === 'phrase' ? 'phrase' : 'quick');
    if (WT.curSub === 'syllabus') {
      // 考纲单词：错词重练（识记题，考纲不做默写），按各自出错的环节（题型）出题，认对一个移出一个
      WT.syl.pendingDrill = ws;
      WT.syl.phase = 'review';
      WT.syl.quiz = null;
      WT.syl.learn.gi = 0;
    } else {
      WT_WORD_DRILL = ws;
    }
    if ((location.hash || '').replace('#', '') !== target) location.hash = '#' + target;  // hashchange → render → 消费
    else render();
  };
  const go = mask.querySelector('#wtWwGo');
  if (go) go.onclick = () => drill(today);
  const oldGo = mask.querySelector('#wtWwOldGo');
  if (oldGo) oldGo.onclick = () => drill(older);
}

/* ---------------- 复习中心（SM-2 记忆排程） ----------------
 * 默写练习里写对的词按 SM-2 排程排复习（第 1 次隔 1 天、第 2 次隔 6 天，之后间隔 × EF；
 * 写错退回重来并降低 EF），头部「🎯 复习中心」打开：
 *   顶部「开始复习（到期 N 词）」→ 只考默写的一轮；下面是到期统计卡片、
 *   本词书遗忘热力图、到期词列表。按 学生+词书 存 localStorage。 */
const WT_SRS_DAY = 86400000;
function wtSrsKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtsrs:' + (u.id || u.username || 'me') + ':' + WT.bookId;
}
function wtSrsAll() { try { return JSON.parse(localStorage.getItem(wtSrsKey()) || '{}'); } catch (e) { return {}; } }
function wtSrsSave(map) { try { localStorage.setItem(wtSrsKey(), JSON.stringify(map)); } catch (e) { /* 隐私模式忽略 */ } }
function wtSrsList() {
  const map = wtSrsAll();
  return Object.keys(map).map((k) => map[k]).filter((x) => x && x.word);
}
/** 复习中心按词书整本排程（不再按单元过滤，与「学习概况」面板的数据口径一致） */
function wtSrsUnitList() {
  return wtSrsList();
}
/** 到期词（含已到期；未来 1 分钟内也算到期，避免临界闪烁） */
function wtSrsDueList() {
  const now = Date.now();
  return wtSrsUnitList().filter((x) => (x.due || 0) <= now + 60000).sort((a, b) => (a.due || 0) - (b.due || 0));
}
/** SM-2 更新：right=true → 间隔拉长；false → 退回重来、EF 下降 */
function wtSrsReview(w, right) {
  if (!w || !w.id || !w.word) return;
  const map = wtSrsAll();
  const k = String(w.id);
  const e = map[k] || { id: w.id, word: w.word, phonetic: w.phonetic || '', meaning: w.meaning || '', unit: w.unit || WT.unit || '', ef: 2.5, reps: 0, interval: 0, due: 0, lapses: 0 };
  e.word = w.word; e.meaning = w.meaning || e.meaning || ''; e.phonetic = w.phonetic || e.phonetic || '';
  e.unit = e.unit || w.unit || WT.unit || '';
  if (right) {
    e.reps = (e.reps || 0) + 1;
    e.interval = e.reps === 1 ? 1 : e.reps === 2 ? 6 : Math.round((e.interval || 1) * e.ef * 10) / 10;
    e.due = Date.now() + Math.max(1, e.interval) * WT_SRS_DAY;
  } else {
    e.reps = 0; e.interval = 0;
    e.lapses = (e.lapses || 0) + 1;
    e.ef = Math.max(1.3, Math.round(((e.ef || 2.5) - 0.2) * 100) / 100);
    e.due = Date.now() + 10 * 60000;   // 写错：10 分钟后再来
  }
  map[k] = e;
  wtSrsSave(map);
  wtReviewBadge();
}
/** 分组学完（变绿）→ 整组单词进入复习排程：已在排程的词保留原有节奏，没有的立即到期可复习 */
function wtSrsSeedWords(words) {
  if (!words || !words.length) return;
  const map = wtSrsAll();
  let changed = false;
  words.forEach((w) => {
    if (!w || !w.id || !w.word) return;
    const k = String(w.id);
    if (map[k]) return;
    map[k] = { id: w.id, word: w.word, phonetic: w.phonetic || '', meaning: w.meaning || '', unit: w.unit || WT.unit || '', ef: 2.5, reps: 1, interval: 1, due: Date.now(), lapses: 0 };
    changed = true;
  });
  if (changed) { wtSrsSave(map); wtReviewBadge(); }
}
/** 头部按钮上的到期角标 */
function wtReviewBadge() {
  const n = wtSrsDueList().length;
  document.querySelectorAll('.wt-review-n').forEach((el) => {
    el.textContent = n > 99 ? '99+' : n;
    el.style.display = n ? '' : 'none';
  });
}
function wtDueText(ts) {
  const d = Math.ceil((ts - Date.now()) / WT_SRS_DAY);
  if (d <= 0) return '今天';
  if (d === 1) return '明天';
  return `${d} 天后`;
}
/** 开始复习：单词/短语速记 → 只考默写的一轮（复用错词重练机制）；考纲单词 → 学后检测流程识记复习 */
function wtReviewStart(words) {
  if (!words || !words.length) return;
  if (WT.curSub === 'syllabus') {
    WT_DRILL_REVIEW = true;   // 考纲复习中心轮：走「学后检测」流程，标题按复习中心显示
    WT.syl.pendingDrill = words.map((x) => ({ id: x.id, word: x.word, phonetic: x.phonetic, meaning: x.meaning, unit: x.unit }));
    WT.syl.phase = 'review';
    WT.syl.quiz = null;
    WT.syl.learn.gi = 0;
    const target = '/words/syllabus';
    if ((location.hash || '').replace('#', '') !== target) location.hash = '#' + target;
    else render();
  } else {
    WT_DRILL_REVIEW = true;
    WT_WORD_DRILL = words.map((x) => ({ id: x.id, word: x.word, phonetic: x.phonetic, meaning: x.meaning, unit: x.unit }));
    const target = '/words/' + WT.curSub;
    if ((location.hash || '').replace('#', '') !== target) location.hash = '#' + target;
    else render();
  }
}
/** 打开复习中心弹窗 */
function wtReviewOpen() {
  wtStopSpeech();
  // 兜底：改动前已完成的分组（已变绿）打开弹窗时也整组补进排程
  try {
    if (WT.groupDefs && WT.groupDefs.length && !WT.needPick) {
      WT.groupDefs.forEach((g, i) => { if (wtGroupDone(i)) wtSrsSeedWords(g); });
    }
  } catch (e) { /* 忽略 */ }
  const due = wtSrsDueList();
  const all = wtSrsUnitList();
  const now = Date.now();
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const dueToday = all.filter((x) => (x.due || 0) <= dayEnd.getTime() + 60000).length;
  const due3 = all.filter((x) => (x.due || 0) <= now + 3 * WT_SRS_DAY).length;
  const due7 = all.filter((x) => (x.due || 0) <= now + 7 * WT_SRS_DAY).length;
  const mastered = all.filter((x) => (x.reps || 0) >= 1).length;
  const lapses = all.filter((x) => (x.lapses || 0) > 0).sort((a, b) => (b.lapses || 0) - (a.lapses || 0));
  const maxLapse = lapses.length ? lapses[0].lapses : 0;
  const book = (WT.books || []).find((b) => String(b.id) === String(WT.bookId));
  const isSyl = WT.curSub === 'syllabus';
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="modal wide">
    <div class="modal-h"><h3>🎯 复习中心${book ? ` · ${esc(book.title)}` : ''}<span class="wt-ws-cnt">${mastered ? `已会 ${mastered} 词` : ''}</span></h3><button class="close-x">&times;</button></div>
    <div class="modal-b">
      ${all.length ? `
      <div class="wt-rv-hero">
        <button class="btn primary-lg wt-rv-go" id="wtRvGo" ${due.length ? '' : 'disabled'}>
          ${wtIc('play')} ${due.length ? `开始复习（到期 ${due.length} 词）` : '暂无到期词'}
        </button>
        <div class="wt-rv-hero-tip">${isSyl ? '按 SM-2 排程复习已会的单词（学后检测流程：看英选义 / 看义选英 / 听音辨义）' : '按 SM-2 排程复习已会的单词，只考默写'}</div>
      </div>
      <div class="wt-rv-cards">
        <div class="wt-rv-card ${dueToday ? 'hot' : ''}"><b>${dueToday}</b><span>今日到期</span></div>
        <div class="wt-rv-card"><b>${due3}</b><span>未来 3 天</span></div>
        <div class="wt-rv-card"><b>${due7}</b><span>未来 7 天</span></div>
        <div class="wt-rv-card ok"><b>${mastered}</b><span>已会总量</span></div>
      </div>
      ${lapses.length ? `
      <div class="wt-rv-sec">
        <div class="wt-rv-sec-t">🔥 遗忘热力图 <em>本词书 · 颜色越深忘得越多</em></div>
        <div class="wt-rv-heat">${lapses.map((x) => {
          const lv = Math.min(4, Math.ceil((x.lapses || 1) / Math.max(1, maxLapse) * 4));
          return `<i class="wt-rv-cell lv${lv}" title="${esc(x.word)} · 忘了 ${(x.lapses || 0)} 次${x.meaning ? ' · ' + esc(x.meaning) : ''}"></i>`;
        }).join('')}</div>
      </div>` : ''}
      ${due.length ? `
      <div class="wt-rv-sec">
        <div class="wt-rv-sec-t">📋 到期词列表 <em>${due.length} 词</em></div>
        <div class="wt-rv-due">${due.map((x) => `
          <div class="wt-rv-due-item">
            <span class="wt-rv-word">${esc(x.word)}</span>
            <span class="wt-rv-mean">${esc(x.meaning || '')}</span>
            <span class="wt-rv-when">${x.due <= now ? '已到期' : wtDueText(x.due)}</span>
          </div>`).join('')}</div>
      </div>` : `<div class="wt-rv-none">✅ 当前筛选下暂无到期词，${due7 ? `${due7} 个词将在 7 天内陆续到期` : '继续保持！'}</div>`}`
      : `<div class="empty"><div class="e-ic">🌱</div>${isSyl ? '完成一个分组后，分组里的单词会自动进入复习排程（学后检测流程识记复习）' : '完成一个分组后，分组里的单词会自动进入复习排程，复习只考默写'}</div>`}
    </div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => { wtStopSpeech(); mask.remove(); };
  mask.querySelector('.close-x').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const go = mask.querySelector('#wtRvGo');
  if (go && due.length) go.onclick = () => { close(); wtReviewStart(due); };
}

/* ---------------- 纸质化生成 ----------------
 * 单词速记 / 短语速记 / 课文朗读头部「🖨️ 纸质化生成」打开大弹窗：
 * 单词/短语：选词书 + 单元 + 正序/乱序 + 英译中/中译英/看音标写单词；
 * 课文朗读：选词书 + 单元 + 课文分组 + 补充单词组合（挖空+结构名称行，可勾选附整句翻译）/ 默写整句，
 * 按蓝色调模板分页生成（行数=条目数、底部订正区），每页固定 794×1123 A4 比例；
 * 「🖨️ 打印」= 新窗口调起打印；「⬇ 导出 PDF」= html2canvas 截图 → /api/stu/paper-pdf 拼 A4 PDF 直接下载。 */
const WP_QUOTES = [
  '每天进步一点点，成功离你近一点！',
  '单词是英语的砖瓦，积累成就高度。',
  '今天多背一个词，明天考试少丢一分。',
  '坚持的记忆，才最深刻。',
  '你现在学的每一样本领，都会在未来发光。',
  '不怕慢，就怕站；背词路上不停步。',
  '一笔一划写单词，一心一意赢未来。',
  '少年辛苦终身事，莫向光阴惰寸功。',
  '今天的汗水，是明天的光芒。',
  '每背会一个词，就推开一扇小小的门。',
];
/** 纸质化生成弹窗状态（跨多次生成保留选择） */
const WP = { sub: 'quick', bookId: '', unit: '', order: 'asc', mode: 'e2c', pages: null, title: '' };
/** 句子结构标注：AI 补齐 + 双层缓存（前端 localStorage 永久 + 服务端内存），生成过一次的句子不再二次调 AI
 *  新格式 {whole:整句结构, parts:[{t:片段原文,s:成分名}]}；老缓存是整句结构字符串（无 parts）——视为缺失自动重新分析升级 */
function wtStructNorm(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.trim() ? { whole: v.trim(), parts: null } : null;
  const parts = (Array.isArray(v.parts) ? v.parts : [])
    .map((p) => ({ t: String((p && p.t) || '').trim(), s: String((p && p.s) || '').trim() }))
    .filter((p) => p.t);
  const whole = String(v.whole || '').trim();
  if (!whole && !parts.length) return null;
  return { whole, parts: parts.length ? parts : null };
}
function wtStructCacheGet() {
  try { return JSON.parse(localStorage.getItem('xuexi_sentstruct') || '{}') || {}; } catch (e) { return {}; }
}
async function wtEnsureStructs(items) {
  const cache = wtStructCacheGet();
  // 缺失=无缓存 或 老格式缓存（只有整句结构、没有逐成分 parts）→ 重新调 AI 升级覆盖
  const miss = items.filter((x) => x && x.text && !(wtStructNorm(cache[x.text]) || {}).parts);
  if (!miss.length) return cache;
  const BATCH = 10;   // parts 拆解输出较长，缩小批次防截断
  const batches = [];
  for (let i = 0; i < miss.length; i += BATCH) batches.push(miss.slice(i, i + BATCH));
  toast(`AI 正在分析 ${miss.length} 个句子的语法结构…`);
  await Promise.all(batches.map(async (b) => {
    try {
      const r = await api('/api/stu/sent-structs', { method: 'POST', body: { texts: b.map((x) => x.text) } });
      (Array.isArray(r) ? r : []).forEach((v, k) => {
        const nv = wtStructNorm(v);
        if (nv && nv.parts && b[k]) cache[b[k].text] = nv;   // 只接受带 parts 的新结果，老格式下次重试
      });
    } catch (e) { /* 单批失败静默跳过，下次生成自动重试 */ }
  }));
  try { localStorage.setItem('xuexi_sentstruct', JSON.stringify(cache)); } catch (e) { /* 超限忽略 */ }
  return cache;
}
/** 拉某本词书的数据（复用全局 10 分钟缓存） */
async function wtPaperItems(bookId, kind) {
  const bid = Number(bookId);
  if (!WT.dataCache) WT.dataCache = {};
  const key = String(bid);
  if (!WT.dataCache[key] || Date.now() - (WT.dataCache[key].t || 0) > 600000) WT.dataCache[key] = { t: Date.now() };
  const c = WT.dataCache[key];
  if (kind === 'phrase') {
    if (!c.phrases) c.phrases = await api('/api/stu/word/phrases?book_id=' + bid).catch(() => []);
    return (c.phrases || []).map((p) => ({ ...p, word: p.phrase }));
  }
  if (kind === 'sent') {
    if (!c.sentences) c.sentences = await api('/api/stu/word/sentences?book_id=' + bid).catch(() => []);
    return c.sentences || [];
  }
  if (!c.words) c.words = await api('/api/stu/word/words?book_id=' + bid).catch(() => []);
  return c.words || [];
}
/** 默写表样式（预览与打印窗口共用） */
const WP_SHEET_CSS = `
.wt-paper-sheet{width:794px;max-width:100%;height:1123px;margin:0 auto;background:#fff;color:#1e3a5f;font-family:"Microsoft YaHei","PingFang SC",sans-serif;padding:32px 36px 24px;box-sizing:border-box;border:1px solid #dbe7f5;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;line-height:1.6}
.wp-quote{flex:none;font-size:13px;color:#4a7ec9;font-style:italic;letter-spacing:.5px;line-height:1.8;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wp-head{text-align:center;margin:-8px 0 4px}
.wp-title{font-size:30px;font-weight:800;color:#1d4ed8;letter-spacing:8px;line-height:1.5}
.wp-title .pen{font-size:24px;letter-spacing:0}
.wp-range{color:#64748b;font-size:14px;margin-top:8px;letter-spacing:1px;line-height:1.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wp-info{display:flex;gap:26px;font-size:15px;color:#33445c;margin:18px 0 14px;flex-wrap:wrap;line-height:1.8}
.wp-info b{color:#1d4ed8}
.wp-tables{display:flex;gap:14px}
.wp-half{flex:1;min-width:0}
.wp-tbl{border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed}
.wp-tbl th{background:#2f6bff;color:#fff;padding:8px 6px;border:1px solid #2f6bff;font-weight:600;text-align:center}
.wp-tbl td{border:1px solid #c9d9f2;padding:6px 8px;height:30px;line-height:30px;color:#1e3a5f;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wp-tbl td.num{width:28px;text-align:center;color:#64748b;background:#f4f8ff;padding:6px 2px}
.wp-tbl td.ans{background:#fbfdff}
.wp-tbl td.fill{white-space:normal;word-break:break-word;height:auto;line-height:1.5;padding:7px 9px}
.wp-tbl td.fill .tr0{color:#1e3a5f;font-weight:600;font-size:12.5px;margin-bottom:6px}
.wp-tbl td.fill .bxrow{display:flex;align-items:flex-end;gap:5px}
.wp-tbl td.fill .bx{flex:1;min-width:0}
.wp-tbl td.fill .bx i{display:block;font-style:normal;font-size:10.5px;color:#8899aa;margin-bottom:2px;white-space:nowrap}
.wp-tbl td.fill .bx .wbox,.wp-tbl td.fill .bx .sbox{display:block;border:1.5px solid #9dbcf0;border-radius:6px;background:#fbfdff;height:30px}
.wp-tbl td.fill .bx .sbox .hint{display:block;text-align:center;line-height:27px;font-weight:400;font-size:12px;color:#b3c4dc;letter-spacing:1px}
.wp-tbl td .sk{color:#b3c4dc;font-size:11.5px;letter-spacing:2px;margin-top:2px}
.wp-tbl td.fill .bx.sb{flex:0 0 112px}
.wp-tbl td.fill .lead{flex:0 0 14px;border-top:2px dashed #b7cdf0;margin-bottom:15px}
.wp-legend{margin:-6px 0 10px;font-size:12.5px;color:#64748b;background:#f4f8ff;border-radius:6px;padding:5px 10px}
.wp-fix{flex:none;height:165px;margin-top:14px;border:1.5px dashed #9dbcf0;border-radius:8px;background:#fbfdff;position:relative}
.wp-fix span{position:absolute;top:8px;left:12px;font-size:13px;color:#64748b;letter-spacing:1px}
/* 句子单栏版式（参照句子成分图） */
.wp-body{flex:1;min-height:0}
.sq{padding:6px 2px 9px;border-bottom:1px dashed #dbe7f5}
.sq-no{color:#1d4ed8;font-size:16px;flex:none}
.sq-l1{display:flex;align-items:center;gap:10px}
/* 成分图：片段框 + 成分名标注框上方 + 短线连接 */
.sq-in{display:flex;align-items:center;gap:10px}
.sq-d{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:flex-end;column-gap:8px;row-gap:8px}
.sq-col{display:flex;flex-direction:column;align-items:center}
.sq-lab{height:18px;line-height:18px;font-size:13px;font-weight:700;white-space:nowrap}
.sq-labb{width:102px;height:21px;border:1.5px dashed #9dbcf0;border-radius:5px;background:#fbfdff;box-sizing:border-box}
.sq-tick{width:2px;height:10px;background:#c9d9f2}
.sq-box{min-height:32px;border:1.5px solid #9dbcf0;border-radius:7px;background:#fbfdff;padding:3px 11px;font-size:15px;font-weight:600;color:#1e3a5f;display:flex;align-items:center;white-space:nowrap;box-sizing:border-box}
.sq-box.b{min-width:122px;background:#f6faff}
.sq-side{flex:none;width:150px;font-size:13px;color:#475569;line-height:1.5}
.sq-tr{margin-top:4px;color:#4a7ec9;font-style:italic}
.sq-blank{display:inline-block;width:110px;height:30px;border:1.5px solid #9dbcf0;border-radius:6px;background:#fbfdff;vertical-align:middle;margin:0 6px}
.sq-stx{flex:none;font-size:13px;color:#8899aa;white-space:nowrap}
.sq-stx b{color:#4a7ec9;font-weight:600}
.sq-l2{display:flex;align-items:center;gap:10px;margin-top:7px;font-size:13px;color:#475569}
.sq-sb{display:inline-block;width:170px;height:28px;border:1.5px dashed #9dbcf0;border-radius:6px;background:#fbfdff}
.sq-l3{margin-top:7px;font-size:13px;color:#4a7ec9;font-style:italic}
.sq.qw{padding-bottom:14px}
.sq-cn{flex:1;min-width:0;font-size:15px;color:#1e3a5f;font-weight:600}
.sq-wl{height:36px;border-bottom:1.5px solid #9dbcf0;margin-top:8px}
@media print{
  @page{size:A4;margin:0}
  body{margin:0;background:#fff}
  .wt-paper-sheet{width:793px;height:1121px;border:none;border-radius:0;page-break-after:always}
  .wt-paper-sheet:last-child{page-break-after:auto}
}`;
function wpEsc(s) { return esc(String(s == null ? '' : s)); }
/** 逐题真实高度测量（动态装箱用）：在 794px 版面内容宽（722px）下渲染量高；无 DOM 环境回退估值 */
function wpMeasureHeights(htmls) {
  if (typeof document === 'undefined') return htmls.map(() => 92);
  let st = document.getElementById('wpSheetMeasureStyle');
  if (!st) {
    st = document.createElement('style');
    st.id = 'wpSheetMeasureStyle';
    st.textContent = WP_SHEET_CSS;
    document.head.appendChild(st);
  }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:722px;background:#fff';
  holder.innerHTML = htmls.map((h) => `<div>${h}</div>`).join('');
  document.body.appendChild(holder);
  const hs = [...holder.children].map((el) => el.getBoundingClientRect().height);
  holder.remove();
  return hs;
}
/** 贪心装箱：题目按测得高度塞进每页（预算 budget），末页需再容纳订正区（fixH），装不下就顺延到新末页 */
function wpPackPages(heights, budget, fixH) {
  const groups = [];
  let cur = [], sum = 0;
  heights.forEach((h, i) => {
    if (cur.length && sum + h > budget) { groups.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += h;
  });
  if (cur.length) groups.push(cur);
  const sumOf = (idxs) => idxs.reduce((a, i) => a + (heights[i] || 0), 0);
  let overflow = [];
  while (groups.length) {
    const last = groups[groups.length - 1];
    if (sumOf(last) <= budget - fixH + 30) break;   // +30px 容差：订正区贴底留少量空隙即可
    if (last.length > 1) overflow.unshift(last.pop());
    else if (groups.length > 1) { overflow.unshift(last.pop()); groups.pop(); }
    else break;   // 单页单题仍超：极端长句，随它（订正区贴底压缩题区）
  }
  if (overflow.length) groups.push(overflow);
  return groups;
}
/** 生成默写表分页（cfg: {items, mode, kind, bookTitle, unit}）→ { pages: [每页HTML…], total }
 *  每页固定 794×1123（A4 比例）；有多少单词生成多少行（两栏均分、不补空行），
 *  底部留「订正区」空白框；超过 32 词自动分页（每页两栏各 16 行）。 */
function wtPaperPages(cfg) {
  const isSent = cfg.kind === 'sent';
  const isPhrase = cfg.kind === 'phrase';
  const kindName = isSent ? '句子' : isPhrase ? '短语' : '单词';
  const modeTxt = isSent
    ? ({ fill: '补充单词组合', whole: '默写整句' }[cfg.mode] || '')
    : { e2c: '英译中 · 看英文写中文', c2e: '中译英 · 看中文写英文', pm: '提示默写 · 首字母提示', ph: '看音标写单词' }[cfg.mode] || '';
  /* ---- 句子版式（单栏，参照句子成分图）：每个成分片段一个框、成分名标注在框上方用短线连接；
      挖空片段=单词框和成分名框都留空待填；整句翻译放右侧；默写整句=中文意思+两条默写横线 ---- */
  if (isSent) {
    /** 成分名配色（循环取色，仿成分图多色标注） */
    const LAB_COLORS = ['#d83931', '#2f9e44', '#3b7ad9', '#d97a16', '#9333ea', '#0e9aa7', '#c2418f'];
    /** 词级挖空：逐词成框（成分名留空），优先挖相邻两词词组；用于无 AI 拆解或整句单片段的句子 */
    const wordLevelHtml = (text) => {
      const words = String(text).trim().split(/\s+/);
      const idxs = words.map((w, i) => i).filter((i) => /[A-Za-z]{2,}/.test(words[i] || ''));
      let hi = -1;
      if (words.length >= 6) {
        const pairs = idxs.filter((i) => idxs.includes(i + 1));
        if (pairs.length) hi = pairs[Math.floor(Math.random() * pairs.length)];
      }
      if (hi < 0) hi = idxs.length ? idxs[Math.floor(Math.random() * idxs.length)] : -1;
      const two = hi >= 0 && words.length >= 6 && idxs.includes(hi + 1);
      return words.map((w, i) => {
        const color = LAB_COLORS[i % LAB_COLORS.length];
        if (i === hi) return `<div class="sq-col"><div class="sq-labb"></div><div class="sq-tick"></div><div class="sq-box b"></div></div>`;
        if (two && i === hi + 1) return '';
        return `<div class="sq-col"><div class="sq-lab" style="color:${color}"></div><div class="sq-tick" style="background:${color}"></div><div class="sq-box">${wpEsc(w)}</div></div>`;
      }).join('');
    };
    /** 生成一题的「成分图」：优先用 AI parts 拆解（挖空其中一个片段），单片段/无拆解退回词级挖空 */
    const diagramHtml = (x) => {
      const st = wtStructNorm(cfg.structs && cfg.structs[x.text]);
      let parts = st && st.parts ? st.parts.filter((p) => p.t) : null;
      if (parts) {   // 拆解合理性校验：片段拼接须覆盖原句大部分字符，否则视为不可信
        const cover = parts.map((p) => p.t).join(' ').replace(/\s+/g, '').length;
        const orig = String(x.text).replace(/\s+/g, '').length;
        if (cover < orig * 0.6) parts = null;
      }
      if (parts && parts.length > 1) {
        // 挖空目标：优先≥2词的片段（词组），否则任意含字母的片段
        const cand = parts.map((p, i) => ({ p, i })).filter((o) => /[A-Za-z]/.test(o.p.t));
        const pref = cand.filter((o) => o.p.t.trim().split(/\s+/).length >= 2);
        const pool = pref.length ? pref : cand;
        const bi = pool.length ? pool[Math.floor(Math.random() * pool.length)].i : -1;
        if (bi >= 0) return { html: parts.map((p, i) => {
          const color = LAB_COLORS[i % LAB_COLORS.length];
          if (i === bi) return `<div class="sq-col"><div class="sq-labb"></div><div class="sq-tick"></div><div class="sq-box b"></div></div>`;
          return `<div class="sq-col"><div class="sq-lab" style="color:${color}">${wpEsc(p.s || '')}</div><div class="sq-tick" style="background:${color}"></div><div class="sq-box">${wpEsc(p.t)}</div></div>`;
        }).join(''), st };
      }
      return { html: wordLevelHtml(x.text), st };
    };
    const itemHtml = (x, no) => {
      if (cfg.mode === 'fill') {
        const d = diagramHtml(x);
        return `<div class="sq">
      <div class="sq-in"><b class="sq-no">${no}.</b>
      <div class="sq-d">${d.html}</div>
      <div class="sq-side"><div class="sq-stx">句子结构：<b>${d.st && d.st.whole ? wpEsc(d.st.whole) : '____________'}</b></div>${cfg.trans ? `<div class="sq-tr">${wpEsc(x.translation || '—')}</div>` : ''}</div>
      </div>
    </div>`;
      }
      const stw = wtStructNorm(cfg.structs && cfg.structs[x.text]);
      return `<div class="sq qw">
      <div class="sq-l1"><b class="sq-no">${no}.</b><span class="sq-cn">${wpEsc(x.translation || '—')}</span><span class="sq-stx">句子结构：<b>${stw && stw.whole ? wpEsc(stw.whole) : '____________'}</b></span></div>
      <div class="sq-wl"></div><div class="sq-wl"></div>
    </div>`;
    };
    const range = [cfg.bookTitle, cfg.unit || '全部单元', cfg.grp || '全部课文'].filter(Boolean).join(' · ');
    /* 动态装箱：逐题量高后贪心塞满每页（不固定题数），订正区只上最后一页 */
    const htmls = cfg.items.map((x, i) => itemHtml(x, i + 1));
    const hs = wpMeasureHeights(htmls);
    const BUDGET = 858;                       // 每页题区可用高度（版面 1067 - 语录/标题/信息行/说明 ≈ 200）
    const FIX_H = 180;                        // 末页订正区（165 + 边距）
    const groups = wpPackPages(hs, BUDGET, FIX_H);
    const pages = groups.map((idxs, pi) => {
      const isLast = pi === groups.length - 1;
      const quote = WP_QUOTES[(pi + Math.floor(Math.random() * WP_QUOTES.length)) % WP_QUOTES.length];
      return `<div class="wt-paper-sheet">
    <div class="wp-quote">✧ ${wpEsc(quote)}</div>
    <div class="wp-head">
      <div class="wp-title">${kindName}默写表 <span class="pen">✏️</span></div>
      <div class="wp-range">${wpEsc(range)}${modeTxt ? ` · ${modeTxt}` : ''}</div>
    </div>
    <div class="wp-info"><span>姓名：______________</span><span>日期：______________</span><span>正确率：<b>________</b> / ${cfg.items.length}（________%）</span></div>
    ${cfg.mode === 'fill' ? '<div class="wp-legend">✎ 空白框填入挖掉的单词或词组，其上方的虚线小框写出对应的句子成分名称（如：主语 / 谓语 / 宾语 / 定语 / 状语 等）；右侧为整句结构参考与翻译，写完可对照检查</div>' : ''}
    <div class="wp-body">${idxs.map((i) => htmls[i]).join('')}</div>
    ${isLast ? '<div class="wp-fix"><span>订正区：</span></div>' : ''}
  </div>`;
    });
    return { pages, total: cfg.items.length };
  }
  /* ---- 单词 / 短语版式 ---- */
  const cols = cfg.mode === 'e2c' ? ['序号', isPhrase ? '短语' : '单词', '词性', '默写中文']
    : cfg.mode === 'c2e' ? ['序号', '中文意思', '词性', isPhrase ? '默写短语' : '默写单词']
    : cfg.mode === 'pm' ? ['序号', '中文意思（附首字母提示）', '默写短语']
    : ['序号', '音标', '词性', '默写单词'];
  /** 首字母骨架提示：get up → g__ up（保留词间空格与标点） */
  const wpSkeleton = (p) => String(p || '').trim().split(/\s+/)
    .map((w) => w.replace(/[A-Za-z]/g, (ch, i) => (i === 0 ? ch : '_'))).join(' ');
  const hasPos = cfg.items.some((x) => (x.pos || x.attr || '').trim());
  if (!hasPos && cfg.mode !== 'pm') cols.splice(2, 1);   // 整本没有词性数据 → 隐藏词性列（提示默写本就无词性列），留白给内容列
  const FULL_ROWS = 19;             // 非末页每栏行数（无订正区，排满 38 词/页）
  const LAST_ROWS = 15;             // 末页每栏行数（底部留订正区）
  const rowCell = (x) => {
    const posTd = hasPos ? `<td>${wpEsc(x.pos || x.attr || '')}</td>` : '';
    if (cfg.mode === 'e2c') return `<td>${wpEsc(x.word)}</td>${posTd}<td class="ans"></td>`;
    if (cfg.mode === 'c2e') return `<td>${wpEsc(x.meaning)}</td>${posTd}<td class="ans"></td>`;
    if (cfg.mode === 'pm') return `<td>${wpEsc(x.meaning)}<div class="sk">${wpEsc(wpSkeleton(x.word || x.phrase))}</div></td><td class="ans"></td>`;
    return `<td>${wpEsc(x.phonetic || '—')}</td>${posTd}<td class="ans"></td>`;
  };
  const tableHtml = (list, startNo) => `
    <div class="wp-half"><table class="wp-tbl">
      <thead><tr>${cols.map((c, i) => `<th${i === 0 ? ' style="width:28px"' : ''}>${c}</th>`).join('')}</tr></thead>
      <tbody>${list.map((x, i) => `<tr><td class="num">${startNo + i}</td>${rowCell(x)}</tr>`).join('')}</tbody>
    </table></div>`;
  const range = [cfg.bookTitle, cfg.unit || '全部单元'].filter(Boolean).join(' · ');
  /* 满页按 FULL_ROWS 分页；末页只留 LAST_ROWS 行（底部订正区），超出的顺延成新末页 */
  const chunks = [];
  for (let s = 0; s < cfg.items.length; s += FULL_ROWS * 2) chunks.push(cfg.items.slice(s, s + FULL_ROWS * 2));
  if (!chunks.length) chunks.push([]);
  while (chunks.length > 1 && chunks[chunks.length - 1].length > LAST_ROWS * 2) {
    const last = chunks[chunks.length - 1];
    const excess = last.splice(LAST_ROWS * 2);
    chunks.push(excess);
  }
  let no = 0;
  const pages = chunks.map((chunk, pi) => {
    const isLast = pi === chunks.length - 1;
    const nL = Math.ceil(chunk.length / 2);
    const left = chunk.slice(0, nL), right = chunk.slice(nL);
    const quote = WP_QUOTES[(pi + Math.floor(Math.random() * WP_QUOTES.length)) % WP_QUOTES.length];
    const startL = no + 1; no += left.length;
    const startR = no + 1; no += right.length;
    return `<div class="wt-paper-sheet">
    <div class="wp-quote">✧ ${wpEsc(quote)}</div>
    <div class="wp-head">
      <div class="wp-title">${kindName}默写表 <span class="pen">✏️</span></div>
      <div class="wp-range">${wpEsc(range)}${cfg.mode === 'ph' ? '' : ` · ${modeTxt}`}</div>
    </div>
    <div class="wp-info"><span>姓名：______________</span><span>日期：______________</span><span>正确率：<b>________</b> / ${cfg.items.length}（________%）</span></div>
    <div class="wp-tables">${tableHtml(left, startL)}${right.length ? tableHtml(right, startR) : ''}</div>
    ${isLast ? '<div class="wp-fix"><span>订正区：</span></div>' : ''}
  </div>`;
  });
  return { pages, total: cfg.items.length };
}
/** 打开纸质化生成弹窗（sub: quick / phrase / context） */
function wtPaperOpen(sub) {
  wtStopSpeech();
  WP.sub = sub;
  WP.kind = sub === 'phrase' ? 'phrase' : sub === 'context' ? 'sent' : 'word';
  WP.bookId = String(WT.bookId || '');
  WP.unit = WT.unit || '';
  WP.grp = WT.readGrp || '';
  WP.order = 'asc';
  WP.mode = WP.kind === 'sent' ? 'fill' : 'e2c';
  WP.trans = false;
  const isSent = WP.kind === 'sent';
  const books = wtModBooks(sub);
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="modal wide wt-paper-modal">
    <div class="modal-h"><h3>🖨️ 纸质化生成<span class="wt-ws-cnt">选好范围和模式，点「生成默写表」即时预览</span></h3>
      <button class="close-x">&times;</button></div>
    <div class="modal-b">
      <div class="wp-ctl-row">
        <span class="wt-panel-lb">词书</span>
        <select id="wpBook" class="wt-sel">${books.map((b) => `<option value="${b.id}" ${String(b.id) === WP.bookId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
        <span class="wt-panel-lb" style="margin-left:14px">单元</span>
        <select id="wpUnit" class="wt-sel"><option value="">加载中…</option></select>
        ${isSent ? `<span class="wt-panel-lb" style="margin-left:14px">分组</span><select id="wpGrp" class="wt-sel"><option value="">全部课文</option></select>` : ''}
        <span class="wt-panel-lb" style="margin-left:14px">顺序</span>
        <button class="rd-chip on" data-wporder="asc">正序</button>
        <button class="rd-chip" data-wporder="rand">乱序</button>
      </div>
      <div class="wp-ctl-row" id="wpModeRow">
        <span class="wt-panel-lb">模式</span>
        ${isSent
          ? `<button class="rd-chip on" data-wpmode="fill">补充单词组合</button>
             <button class="rd-chip" data-wpmode="whole">默写整句</button>
             <label id="wpTransRow" style="margin-left:14px;font-size:13px;color:#475569;cursor:pointer;user-select:none"><input type="checkbox" id="wpTrans" checked style="vertical-align:-2px;margin-right:5px">附整句翻译</label>`
          : `<button class="rd-chip on" data-wpmode="e2c">英译中</button>
             <button class="rd-chip" data-wpmode="c2e">中译英</button>
             ${WP.kind === 'word'
               ? `<button class="rd-chip" data-wpmode="ph">看音标写单词</button>`
               : `<button class="rd-chip" data-wpmode="pm">提示默写</button>`}`}
      </div>
      <div id="wpPrev" class="wp-prev"><div class="empty"><div class="e-ic">📄</div>选择好词书、单元和模式后，点下方「生成默写表」</div></div>
    </div>
    <div class="modal-f">
      <button class="btn primary-sm" id="wtPaperPrint" style="display:none;width:auto;padding:0 22px">🖨️ 打印</button>
      <button class="btn primary-sm" id="wtPaperExport" style="display:none;width:auto;padding:0 22px;background:#f0a93c;border-color:#f0a93c">⬇ 导出 PDF</button>
      <button class="btn primary-sm" id="wpGo" style="width:auto;padding:0 26px">生成默写表</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => { wtStopSpeech(); mask.remove(); };
  mask.querySelector('.close-x').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const unitSel = mask.querySelector('#wpUnit');
  const grpSel = mask.querySelector('#wpGrp');
  const fillUnits = (items) => {
    const units = [...new Set(items.map((x) => String(x.unit || '').trim()).filter(Boolean))];
    unitSel.innerHTML = `<option value="">全部单元（共 ${items.length}）</option>` +
      units.map((u) => `<option value="${esc(u)}">${esc(u)}（${items.filter((x) => String(x.unit || '').trim() === u).length}）</option>`).join('');
    unitSel.value = units.includes(WP.unit) ? WP.unit : '';
    WP.unit = unitSel.value;
    if (grpSel) {
      const grps = [...new Set(items.map((x) => String(x.grp || '').trim()).filter(Boolean))];
      grpSel.innerHTML = `<option value="">全部课文</option>` +
        grps.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
      grpSel.value = grps.includes(WP.grp) ? WP.grp : '';
      WP.grp = grpSel.value;
    }
  };
  const bookSel = mask.querySelector('#wpBook');
  const loadBook = async () => {
    WP.bookId = String(bookSel.value);
    unitSel.innerHTML = '<option value="">加载中…</option>';
    const items = await wtPaperItems(WP.bookId, WP.kind);
    if (String(bookSel.value) !== WP.bookId) return;   // 期间又切了词书
    fillUnits(items);
  };
  bookSel.onchange = loadBook;
  loadBook();
  unitSel.onchange = () => { WP.unit = unitSel.value; };
  if (grpSel) grpSel.onchange = () => { WP.grp = grpSel.value; };
  mask.querySelectorAll('[data-wporder]').forEach((b) => b.onclick = () => {
    WP.order = b.dataset.wporder;
    mask.querySelectorAll('[data-wporder]').forEach((x) => x.classList.toggle('on', x === b));
  });
  mask.querySelectorAll('[data-wpmode]').forEach((b) => b.onclick = () => {
    WP.mode = b.dataset.wpmode;
    mask.querySelectorAll('[data-wpmode]').forEach((x) => x.classList.toggle('on', x === b));
    const tr = mask.querySelector('#wpTransRow');
    if (tr) tr.style.display = WP.mode === 'fill' ? '' : 'none';   // 附整句翻译仅「补充单词组合」模式适用
  });
  // 生成：拉数据 → 筛单元 → 排序 → 按每页 32 词分页 → 渲染预览（行数 = 单词数，不补空行）
  mask.querySelector('#wpGo').onclick = async () => {
    const go = mask.querySelector('#wpGo');
    go.disabled = true; go.textContent = '生成中…';
    try {
      const all = await wtPaperItems(WP.bookId, WP.kind);
      let items = WP.kind === 'sent' ? all.filter((x) => x && x.text) : all.filter((x) => x && (x.word || x.phrase));
      if (WP.unit) items = items.filter((x) => String(x.unit || '').trim() === WP.unit);
      if (WP.kind === 'sent' && WP.grp) items = items.filter((x) => String(x.grp || '').trim() === WP.grp);
      if (!items.length) { toast('这个词书/单元还没有内容', 'err'); return; }
      if (WP.order === 'rand') {
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
      }
      const book = books.find((b) => String(b.id) === WP.bookId);
      let structs = null;
      if (WP.kind === 'sent' && WP.mode === 'fill') structs = await wtEnsureStructs(items);   // AI 补齐句子结构（缓存后不二次调）
      const transChk = mask.querySelector('#wpTrans');
      const made = wtPaperPages({ items, mode: WP.mode, kind: WP.kind, bookTitle: book ? book.title : '', unit: WP.unit, grp: WP.grp, structs, trans: !!(transChk && transChk.checked) });
      WP.pages = made.pages;
      WP.title = (book ? book.title : '') + ' 默写表';
      const prev = mask.querySelector('#wpPrev');
      prev.innerHTML = `<style>${WP_SHEET_CSS}</style><style>.wp-prev .wt-paper-sheet + .wt-paper-sheet{margin-top:16px}</style>` + WP.pages.join('');
      prev.scrollTop = 0;
      mask.querySelector('#wtPaperPrint').style.display = '';
      mask.querySelector('#wtPaperExport').style.display = '';
      mask.querySelector('#wpGo').textContent = `重新生成（共 ${items.length} ${WP.kind === 'sent' ? '句' : '词'}${made.pages.length > 1 ? ` · ${made.pages.length} 页` : ''}）`;
    } finally {
      go.disabled = false;
      if (go.textContent === '生成中…') go.textContent = '生成默写表';
    }
  };
  // 打印：新窗口打开同版式 → 调起打印（每页精确 A4）
  mask.querySelector('#wtPaperPrint').onclick = () => {
    if (!(WP.pages && WP.pages.length)) return toast('请先生成默写表', 'err');
    const w = window.open('', '_blank');
    if (!w) return toast('浏览器拦截了新窗口，请允许弹窗后重试', 'err');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(WP.title || '默写表')}</title><style>${WP_SHEET_CSS}body{padding:0;margin:0;background:#fff}</style></head><body>${WP.pages.join('')}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* 用户手动 Ctrl+P 也可 */ } }, 500);
  };
  // 导出：逐页 html2canvas 截图（离屏 794px 宽容器保证 A4 精确比例）→ 服务端拼 A4 PDF → 直接下载
  mask.querySelector('#wtPaperExport').onclick = async () => {
    if (!(WP.pages && WP.pages.length)) return toast('请先生成默写表', 'err');
    if (typeof html2canvas !== 'function') return toast('导出组件没加载，请 Ctrl+F5 刷新后重试', 'err');
    const nodes = [...mask.querySelectorAll('.wp-prev .wt-paper-sheet')];
    if (!nodes.length) return toast('请先生成默写表', 'err');
    if (nodes.length > 30) return toast('页数太多（' + nodes.length + ' 页），单次最多导出 30 页，请减少条数后重新生成', 'err');
    const btn = mask.querySelector('#wtPaperExport');
    btn.disabled = true;
    const oldTxt = btn.textContent;
    btn.textContent = '正在导出…';
    const holder = document.createElement('div');   // 离屏固定 794px：预览被弹窗压窄也不影响导出比例
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px';
    document.body.appendChild(holder);
    try {
      const fd = new FormData();
      for (const el of nodes) {
        holder.appendChild(el);                     // 挪进离屏容器（宽度恒 794）
        const c = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        mask.querySelector('.wp-prev').appendChild(el);            // 立刻放回原位（顺序自然恢复）
        const blob = await new Promise((rs, rj) => c.toBlob((b) => (b ? rs(b) : rj(new Error('页面转换失败'))), 'image/jpeg', 0.92));
        fd.append('pages', blob, 'p.jpg');
      }
      const name = WP.title || '默写表';
      const r = await fetch('/api/stu/paper-pdf?title=' + encodeURIComponent(name), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ((typeof Auth !== 'undefined' && Auth && Auth.token) || '') },
        body: fd,
      });
      if (!r.ok) {
        let msg = '服务端导出失败（' + r.status + '）';
        try { msg = (await r.json()).msg || msg; } catch (e) { /* 保留默认 */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast(`已导出 ${WP.pages.length > 1 ? WP.pages.length + ' 页 · ' : ''}${name}.pdf`);
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'err');
    } finally {
      [...nodes].forEach((el) => { if (el.parentElement !== mask.querySelector('.wp-prev')) mask.querySelector('.wp-prev').appendChild(el); });
      holder.remove();
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  };
}

/* ---------------- 错句本 ----------------
 * 连词成句 / 听音拼句里答错的句子各自记一本（互不合并），按 学生+词书 存 localStorage，
 * 每条带 src 标记（build=连词成句 / listen=听音拼句）和所在单元；
 * 头部右侧「📕 错句本」打开，可听句子、一键重练（重练跳回各自的模块），
 * 重练中拼对的句子自动移出错句本（没有手动移出 / 清空入口，避免误删）。 */
function wtWrongKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtws:' + (u.id || u.username || 'me') + ':' + WT.bookId;
}
function wtWrongAll() { try { return JSON.parse(localStorage.getItem(wtWrongKey()) || '[]'); } catch (e) { return []; } }
function wtWrongSave(list) { try { localStorage.setItem(wtWrongKey(), JSON.stringify(list.slice(-300))); } catch (e) { /* 隐私模式忽略 */ } }
/** 当前模块（build / listen），错句本的存取、角标、重练都按它分开 */
function wtWrongMod() { return WT.curSub === 'listen' ? 'listen' : 'build'; }
/** 当前模块 + 当前单元筛选下能看到的错句（unit 为空 = 全部单元；老数据无 src 归连词成句） */
function wtWrongList() {
  const all = wtWrongAll().filter((x) => (x.src || 'build') === wtWrongMod());
  return WT.unit ? all.filter((x) => x.unit === WT.unit) : all;
}
function wtWrongAdd(s, src) {
  if (!s || !s.text) return;
  const m = src === 'listen' ? 'listen' : 'build';
  const list = wtWrongAll();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const ex = list.find((x) => x.id === s.id && (x.src || 'build') === m);
  if (ex) {
    // 跨天再错 → 次数重新从 1 起算（「今日错句」显示的是今天错了几次）
    ex.cnt = (ex.t || 0) < dayStart.getTime() ? 1 : (ex.cnt || 1) + 1;
    ex.t = Date.now();
    ex.text = s.text;
    ex.translation = s.translation || ex.translation || '';
    ex.unit = s.unit || ex.unit || WT.unit || '';
    const nl = list.filter((x) => x !== ex); nl.push(ex);
    wtWrongSave(nl);
  } else {
    list.push({ id: s.id, text: s.text, translation: s.translation || '', unit: s.unit || WT.unit || '', src: m, t: Date.now(), cnt: 1 });
    wtWrongSave(list);
  }
  wtWrongHistAdd(s, m);   // 历史错句累计（只增不减）
  wtWrongBadge();
}
function wtWrongRemove(id) {
  const m = wtWrongMod();
  wtWrongSave(wtWrongAll().filter((x) => !(String(x.id) === String(id) && (x.src || 'build') === m)));
}
/* ---- 历史错句：纯记录（累计出错次数，拼对移出在册本也不删历史），按 学生+词书+模块 存 ---- */
function wtWrongHistKey(m) {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_wtwsh:' + (u.id || u.username || 'me') + ':' + WT.bookId + ':' + (m || wtWrongMod());
}
function wtWrongHistAll(m) { try { return JSON.parse(localStorage.getItem(wtWrongHistKey(m)) || '{}'); } catch (e) { return {}; } }
function wtWrongHistSave(map, m) { try { localStorage.setItem(wtWrongHistKey(m), JSON.stringify(map)); } catch (e) { /* 隐私模式忽略 */ } }
function wtWrongHistList(m) { return Object.values(wtWrongHistAll(m)).filter((x) => x && x.text); }
function wtWrongHistAdd(s, m) {
  if (!s || !s.text) return;
  const map = wtWrongHistAll(m);
  const k = String(s.id);
  const e = map[k] || { id: s.id, text: s.text, translation: s.translation || '', unit: s.unit || WT.unit || '', cnt: 0, first: Date.now(), last: 0 };
  e.text = s.text;
  e.translation = s.translation || e.translation || '';
  e.unit = e.unit || s.unit || WT.unit || '';
  e.cnt = (e.cnt || 0) + 1;
  e.last = Date.now();
  map[k] = e;
  wtWrongHistSave(map, m);
}
/** 今日错句（今天 0 点以来出错的，当前模块整本词书口径，角标也用它） */
function wtWrongToday() {
  const m = wtWrongMod();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  return wtWrongAll().filter((x) => (x.src || 'build') === m && (x.t || 0) >= dayStart.getTime());
}
/** 待重练的错句（错句本「开始重练」写入，wtBuildStart 消费后清空） */
let WT_WRONG_DRILL = null;
/** 头部按钮上的数字角标（今日错句数，当前模块整本词书口径，与错词本一致） */
function wtWrongBadge() {
  const n = wtWrongToday().length;
  document.querySelectorAll('.wt-wrong-n').forEach((el) => {
    el.textContent = n > 99 ? '99+' : n;
    el.style.display = n ? '' : 'none';
  });
}
/** 打开错句本弹窗（与错词本同款）：今日错句（今天出错的 + 重练）/ 历史错句（按单元汇总的累计记录），
 *  整本词书口径（不按单元过滤）；连词成句 / 听音拼句各自一本。 */
function wtWrongOpen() {
  wtStopSpeech();
  const m = wtWrongMod();
  const isLsn = m === 'listen';
  const book = (WT.books || []).find((b) => String(b.id) === String(WT.bookId));
  // 兜底迁移：老数据没有历史记录 → 把在册错句补进历史（只补缺失的，不动已有的次数）
  const hist = wtWrongHistAll(m);
  let histDirty = false;
  wtWrongAll().filter((x) => (x.src || 'build') === m).forEach((x) => {
    if (x && x.text && !hist[String(x.id)]) {
      hist[String(x.id)] = { id: x.id, text: x.text, translation: x.translation || '', unit: x.unit || '', cnt: x.cnt || 1, first: x.t || Date.now(), last: x.t || Date.now() };
      histDirty = true;
    }
  });
  if (histDirty) wtWrongHistSave(hist, m);
  const all = wtWrongAll().filter((x) => (x.src || 'build') === m);   // 本模块整本词书的在册错句
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = all.filter((x) => (x.t || 0) >= dayStart.getTime());
  const older = all.filter((x) => (x.t || 0) < dayStart.getTime());   // 更早还没清掉的错句
  const histList = wtWrongHistList(m);
  const PAGE = 10;                                    // 每页最多 10 条
  const pages = Math.max(1, Math.ceil(today.length / PAGE));
  let page = 0;
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="modal wide">
    <div class="modal-h"><h3>📕 错句本 · ${isLsn ? '听音拼句' : '连词成句'}${book ? ` · ${esc(book.title)}` : ''}<span class="wt-ws-cnt">今日 ${today.length} 句 · 历史共 ${histList.length} 句</span></h3><button class="close-x">&times;</button></div>
    <div class="modal-b">
      <div class="wt-tabs">
        <button class="wt-tab on" data-tab="today">今日错句<i>${today.length}</i></button>
        <button class="wt-tab" data-tab="hist">历史错句<i>${histList.length}</i></button>
      </div>
      <div id="wtWsToday">
        ${today.length ? `<div class="wt-ws-tip">今天答错的句子都在这里（整本词书${isLsn ? '，与连词成句分开记录' : '，与听音拼句分开记录'}）。点「开始重练」逐句${isLsn ? '重听重拼' : '重拼'}，<b>拼对一句自动移出一句</b>。</div>
        <div class="wt-ws-list" id="wtWsList"></div>`
        : `<div class="empty"><div class="e-ic">🎉</div>今天还没有错句，继续保持！${older.length ? `<p class="wt-ww-old-tip">另有 ${older.length} 句更早的错句还没清掉，可点右下角按钮重练</p>` : ''}</div>`}
      </div>
      <div id="wtWsHist" style="display:none">
        ${histList.length ? `<div class="wt-ws-tip">本词书的历史错句记录（只统计、不参与重练）：按单元汇总每句的累计出错次数。</div>
        <div class="wt-ws-list" id="wtWsHistList"></div>` : `<div class="empty"><div class="e-ic">🗒️</div>这本词书还没有历史错句记录</div>`}
      </div>
    </div>
    ${today.length || older.length ? `<div class="modal-f">
      ${pages > 1 ? `<div class="wt-pager"><button class="btn ghost wt-pg-btn" id="wtWsPrev">上一页</button><span class="wt-pg-info" id="wtWsPgInfo"></span><button class="btn ghost wt-pg-btn" id="wtWsNext">下一页</button></div>` : ''}
      ${older.length ? `<button class="btn ghost wt-pg-btn" id="wtWsOldGo" title="重练更早未清的错句">${wtIc('play')} 重练更早未清（${older.length} 句）</button>` : ''}
      ${today.length ? `<button class="btn primary-sm" id="wtWsGo" style="width:auto;padding:0 22px">${wtIc('play')} 开始重练（今日 ${today.length} 句）</button>` : ''}
    </div>` : ''}
  </div>`;
  document.body.appendChild(mask);
  const close = () => { wtStopSpeech(); mask.remove(); };
  mask.querySelector('.close-x').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  // 页签切换（历史错句页隐藏底部重练栏）
  mask.querySelectorAll('[data-tab]').forEach((t) => t.onclick = () => {
    const v = t.dataset.tab;
    mask.querySelectorAll('.wt-tab').forEach((x) => x.classList.toggle('on', x === t));
    const tp = mask.querySelector('#wtWsToday'); if (tp) tp.style.display = v === 'today' ? '' : 'none';
    const hp = mask.querySelector('#wtWsHist'); if (hp) hp.style.display = v === 'hist' ? '' : 'none';
    const f = mask.querySelector('.modal-f'); if (f) f.style.display = v === 'today' ? '' : 'none';
  });
  const listBox = mask.querySelector('#wtWsList');
  const renderPage = () => {
    if (!listBox) return;
    const slice = today.slice(page * PAGE, page * PAGE + PAGE);
    listBox.innerHTML = slice.map((x) => `
      <div class="wt-ws-item" data-id="${x.id}">
        <div class="wt-ws-main">
          <p class="wt-ws-en">${esc(x.text)} <button class="wq-spk" data-spk title="听这句">${wtIc('volume')}</button></p>
          ${x.translation ? `<p class="wt-ws-cn">${esc(x.translation)}</p>` : ''}
        </div>
        <div class="wt-ws-acts">
          ${x.unit ? `<span class="wt-ws-unit">${esc(x.unit)}</span>` : ''}
          <span class="wt-err-n" title="今天错了几次">错 ${(x.cnt || 1)} 次</span>
        </div>
      </div>`).join('');
    listBox.scrollTop = 0;
    listBox.querySelectorAll('[data-spk]').forEach((b) => b.onclick = () => {
      const item = b.closest('.wt-ws-item');
      const x = today.find((y) => String(y.id) === item.dataset.id);
      if (x) speak(x.text);
    });
    const info = mask.querySelector('#wtWsPgInfo');
    if (info) info.textContent = `第 ${page + 1} / ${pages} 页`;
    const prev = mask.querySelector('#wtWsPrev');
    const next = mask.querySelector('#wtWsNext');
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page >= pages - 1;
  };
  if (listBox) renderPage();
  const prev = mask.querySelector('#wtWsPrev');
  const next = mask.querySelector('#wtWsNext');
  if (prev) prev.onclick = () => { if (page > 0) { page--; renderPage(); } };
  if (next) next.onclick = () => { if (page < pages - 1) { page++; renderPage(); } };
  // 历史错句：按单元分组（自然排序），单元内按累计次数降序
  const histBox = mask.querySelector('#wtWsHistList');
  if (histBox) {
    const groups = {};
    histList.forEach((x) => { const u = x.unit || ''; (groups[u] = groups[u] || []).push(x); });
    const names = Object.keys(groups).filter((u) => u).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
    if (groups['']) names.push('');   // 没有单元信息的排最后
    const dstr = (ts) => { const d = new Date(ts || 0); return d.getTime() ? `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}` : ''; };
    histBox.innerHTML = names.map((u) => `
      <div class="wt-hist-g">
        <div class="wt-hist-h">${esc(u || '未分单元')}<span>${groups[u].length} 句</span></div>
        ${groups[u].slice().sort((a, b) => (b.cnt || 0) - (a.cnt || 0)).map((x) => `
          <div class="wt-hist-row">
            <span class="wt-hist-w">${esc(x.text)}</span>
            <span class="wt-hist-m">${esc(x.translation || '')}</span>
            <span class="wt-err-n">错 ${x.cnt || 1} 次</span>
            ${x.last ? `<span class="wt-hist-d">最近 ${dstr(x.last)}</span>` : ''}
          </div>`).join('')}
      </div>`).join('');
  }
  // 重练（复用原有链路：写入 WT_WRONG_DRILL，跳回各自模块消费）
  const drill = (list) => {
    close();
    WT_WRONG_DRILL = list.map((x) => ({ id: x.id, text: x.text, translation: x.translation }));
    const target = isLsn ? '/words/listen' : '/words/build';  // 重练跳回各自的模块
    if ((location.hash || '').replace('#', '') !== target) location.hash = '#' + target;  // hashchange → render → wtXxxStart 消费
    else render();
  };
  const go = mask.querySelector('#wtWsGo');
  if (go) go.onclick = () => drill(today);
  const oldGo = mask.querySelector('#wtWsOldGo');
  if (oldGo) oldGo.onclick = () => drill(older);
}

/* ---------------- 英文分音节（离线启发式，供分音节跟读 / 抄写） ----------------
 * 规则：相邻元音字母（y 词首算辅音、其余算元音）并为一个元音组；
 *   两组之间的辅音串 —— 只有 1 个辅音 → 归后一音节（开音节，如 make→ma·ke、activity→ac·ti·vi·ty）；
 *   多个辅音 → 前一音节带走除「合法辅音连缀」以外的全部（lit·tle、no·thing、pa·ra·glid·ing）；
 *   词尾 magic-e（make/phone）与 -ed/-es 里的哑音 e（bored/makes）并入前一音节。
 * 启发式不追求词典级精确，目标是「孩子能照着逐音节读、逐音节写」。 */
const SYL_ONSET2 = new Set(['bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'gh', 'ph', 'pl', 'pr',
  'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr', 'qu', 'sq']);
const SYL_ONSET3 = new Set(['str', 'spr', 'spl', 'scr', 'shr', 'thr', 'squ']);
function sylSplit(word) {
  const w = String(word || '').trim();
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(w) || w.length < 4) return [w];
  const s = w.toLowerCase();
  const isV = (c) => 'aeiou'.includes(c);
  const vow = [...s].map((c, i) => isV(c) || (c === 'y' && i > 0));
  const groups = [];
  for (let i = 0; i < s.length; i++) {
    if (!vow[i]) continue;
    let j = i + 1;
    while (j < s.length && vow[j]) j++;
    groups.push([i, j - 1]);
    i = j - 1;
  }
  if (groups.length <= 1) return [w];
  // 词尾哑音 e：magic-e（make/phone/these）；-ed/-es 且前一辅音不是 t/d/x/s/z（bored/makes 合并，wanted/boxes 拆开）
  const last = groups[groups.length - 1];
  if (s[last[0]] === 'e' && groups.length >= 2) {
    const prev = groups[groups.length - 2];
    const tail = s.slice(last[0]);
    const runLen = last[0] - prev[1] - 1;
    const c = runLen === 1 ? s[prev[1] + 1] : '';
    let merge = false;
    if (tail === 'e' && runLen === 1 && c !== 'l') merge = true;                       // make / these
    else if ((tail === 'ed' || tail === 'es') && runLen === 1 && !'t d x s z'.includes(c)) merge = true; // bored / makes
    if (merge) { groups.pop(); groups[groups.length - 1][1] = s.length - 1; }
  }
  if (groups.length <= 1) return [w];
  const cuts = [0];
  for (let k = 1; k < groups.length; k++) {
    const gs = groups[k - 1][1] + 1, ge = groups[k][0] - 1;
    if (ge < gs) { cuts.push(gs); continue; }  // 两元音组相邻（-ing 等），从后组起切
    const run = s.slice(gs, ge + 1), n = ge - gs + 1;
    let take = 1;                                            // 后一音节默认带走 1 个辅音
    // -le 结尾（little/table/apple）：后一音节把「辅音+le」整个带走 → lit·tle / ta·ble
    if (groups[k][0] === groups[k][1] && s[groups[k][0]] === 'e' && groups[k][0] === s.length - 1 && run.endsWith('l')) take = Math.min(2, n);
    if (n >= 3 && SYL_ONSET3.has(run.slice(-3))) take = 3;
    else if (n >= 2 && SYL_ONSET2.has(run.slice(-2))) take = 2;
    cuts.push(ge + 1 - take);                                // 下一音节起点
  }
  cuts.push(s.length);
  const parts = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const seg = w.slice(cuts[k], cuts[k + 1]);
    if (seg) parts.push(seg);
  }
  return parts.length ? parts : [w];
}
/** 逐段朗读：浏览器语音按顺序接龙 */
function speakSeq(texts, lang, rate) {
  const list = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length) return;
  browserSeq(list, lang, rate, WT_TTS_TAG);
}
function browserSeq(list, lang, rate, tag) {
  if (tag !== undefined && tag !== WT_TTS_TAG) return;
  const step = (i) => {
    if (tag !== WT_TTS_TAG || i >= list.length) return;
    wtPlayAudio(list[i], lang || 'en-US', () => step(i + 1), rate || WT_TTS_RATE || 1);
  };
  step(0);
}

async function viewWordsQuick() {
  return wtShell('quick', {
    html: `<div class="card">
      <div class="wt-steps" id="wtSteps"></div>
      <div id="wtGroups"></div>
      <div id="wtQuickBox"></div>
    </div>`,
    after: () => { WT.groupDefs = null; WT.groupIdx = null; WT.needPick = true; wtQuickStart(true); },  // 进来先选分组；分组按本模块数据重算，不自动进全屏
  });
}

/** 短语速记：流程与单词速记完全一致（分组 → 学习 → 记忆 → 连连看 → 默写），数据换成短语库 */
async function viewWordsPhrase() {
  return wtShell('phrase', {
    html: `<div class="card">
      <div class="wt-steps" id="wtSteps"></div>
      <div id="wtGroups"></div>
      <div id="wtQuickBox"></div>
    </div>`,
    after: () => { WT.groupDefs = null; WT.groupIdx = null; WT.needPick = true; wtQuickStart(true); },  // 进来先选分组；分组必须按本模块数据重算，防止上个模块的分组串台
  });
}

/** 开一轮（keep=true 时保留当前所在步骤）；先算好分组再从当前分组开练 */
function wtQuickStart(keep) {
  const box = document.getElementById('wtQuickBox');
  if (!box) return;
  // 错词本「开始重练」：只用错词开一轮默写练习，写对一个移出一个
  if (WT_WORD_DRILL && WT_WORD_DRILL.length) {
    const words = WT_WORD_DRILL;
    WT_WORD_DRILL = null;
    WT.groupDefs = []; WT.groupIdx = -1;  // 重练轮不参与分组变绿
    WT.needPick = false;
    wtBindGroups();
    WT.quick = {
      drill: true, step: 'spell', maxStep: 3, words,
      read: { i: 0, spoke: 0 },
      mem: { i: 0, phase: 'ask', revealed: false, spoke: 0 },
      match: { groups: [], gi: 0, cur: -1, sel: null, locked: [], ok: 0, wrong: 0, li: 0, lsWrong: 0, lsSpoke: null, lsQueue: null, lsTotal: 0 },
      spell: { queue: shuffle(words), i: 0, right: 0, wrong: 0, repeat: 0 },
      right: 0, wrong: 0,
    };
    wtStageOn();  // 错词重练也进全屏学习舞台
    wtQuickRender();
    return;
  }
  const words = WT.data.words;
  if (!words.length) {
    WT.groupDefs = [];
    wtBindGroups();
    const other = wtModBooks(WT.curSub || 'quick').filter((b) => String(b.id) !== String(WT.bookId) && ((b.word_count || 0) + (b.phrase_count || 0)) > 0);
    box.innerHTML = `<div class="empty"><div class="e-ic">📭</div>这本词书还没有${wtNoun()}，先让老师上传${wtNoun()}表`
      + (other.length ? `<div class="wq-read-tip">其它词书有内容：${other.map((b) => esc(b.title)).join('、')}（用上方下拉切换）</div>` : '')
      + '</div>';
    return;
  }
  if (!WT.groupDefs || !WT.groupDefs.length) wtCalcGroups();
  // 还没勾选分组（刚进模块 / 刚点过「退出学习」）→ 只展示分组选择，不进全屏舞台
  if (WT.needPick) {
    wtBindGroups();
    // 四个步骤照旧展示（都锁着），让孩子知道每组要走完什么
    const steps = document.getElementById('wtSteps');
    if (steps) {
      const noun = wtNoun();
      steps.innerHTML = WT_STEPS.map((s, i) => {
        return `<a class="wt-step lock"><i>${i + 1}</i><span>${wtStepLabel(s, noun)}</span></a>`;
      }).join('');
    }
    box.innerHTML = `<div class="empty wt-pick-hold">选择上方分组开始学习</div>`;
    return;
  }
  wtStartGroup(WT.groupIdx, keep);
}

/** 开某一组的学习会话：单词只取本组的，默认从「单词学习」开始；进入即全屏学习舞台 */
function wtStartGroup(gi, keep) {
  if (!WT.groupDefs || !WT.groupDefs.length) return;
  WT.needPick = false;  // 已经勾选分组 → 进入全屏练习
  WT.groupIdx = Math.max(0, Math.min(gi, WT.groupDefs.length - 1));
  const words = shuffle(WT.groupDefs[WT.groupIdx]);
  WT.quick = {
    step: keep && WT.quick && WT.quick.step ? WT.quick.step : 'read',
    maxStep: keep && WT.quick && WT.quick.maxStep ? WT.quick.maxStep : 0,
    words,
    read: { i: 0, spoke: 0 },
    mem: { i: 0, phase: 'ask', revealed: false, spoke: 0 },
    match: { groups: wtChunk(shuffle(words), 6), gi: 0, cur: -1, sel: null, locked: [], ok: 0, wrong: 0, li: 0, lsWrong: 0, lsSpoke: null, lsQueue: null, lsTotal: 0 },
    spell: { queue: shuffle(words), i: 0, right: 0, wrong: 0, repeat: 0 },
    right: 0, wrong: 0,
  };
  wtStageOn();  // 勾选分组开练 → 固定全屏学习弹窗
  wtQuickRender();
}

function wtQuickRender() {
  const q = WT.quick;
  wtStopSpeech();  // 切步骤 / 切题先停掉上一题没读完的发音和定时器
  wtBindGroups();
  const steps = document.getElementById('wtSteps');
  if (steps) {
    const cur = Math.max(0, WT_STEPS.findIndex((s) => s.k === q.step));
    q.maxStep = Math.max(q.maxStep || 0, cur);
    const noun = wtNoun();
    // 每轮练习都要从「单词学习」开始：还没到过的步骤先锁住，走到的步骤随时可以回头
    steps.innerHTML = WT_STEPS.map((s, i) => {
      const cls = i === cur ? 'on' : i < cur ? 'past' : i <= q.maxStep ? '' : 'lock';
      const no = i < cur ? '✓' : i + 1;
      return `<a class="wt-step ${cls}" ${i <= q.maxStep ? `data-step="${s.k}"` : ''}><i>${no}</i><span>${wtStepLabel(s, noun)}</span></a>`;
    }).join('');
    steps.querySelectorAll('[data-step]').forEach((a) => a.onclick = () => { q.step = a.dataset.step; wtQuickRender(); });
  }
  if (q.step === 'memorize') return wtQuickMem();
  if (q.step === 'match') return (WT.curSub || 'quick') === 'quick' ? wtQuickListen() : wtPhraseListen();
  if (q.step === 'spell') return wtQuickSpell();
  return wtQuickRead();
}

function wtGoto(step) {
  const q = WT.quick;
  q.step = step;
  const i = WT_STEPS.findIndex((s) => s.k === step);
  if (i >= 0) q.maxStep = Math.max(q.maxStep || 0, i);
  wtQuickRender();
}
function wtProg(i, n, label) {
  return `<div class="wt-prog"><i style="width:${n ? Math.round(i / n * 100) : 0}%"></i><span>${label || i + ' / ' + n}</span></div>`;
}
function wtDoneHTML(ic, title, sub, next, nextLabel) {
  // 「再来一轮」已按需求删除；进入下一步的按钮放大（primary-lg），孩子一眼看到该点哪里
  return `<div class="empty"><div class="e-ic">${ic}</div><b>${title}</b>
    <div style="margin-top:8px">${sub}</div>
    <div style="margin-top:20px">
      ${next ? `<button class="btn primary-lg" id="wtNext">${nextLabel}</button>` : ''}
    </div></div>`;
}
function wtBindDone(next) {
  const n = document.getElementById('wtNext');
  if (n) n.onclick = () => wtGoto(next);
}

/* ---------------- ① 单词学习（听 + 跟读 + 抄写） ----------------
 * 系统把整词读一遍；孩子跟着读 3 遍，然后抄写英文 3 遍、抄写中文 1 遍；
 * 完成后点「写好了，下一个」。纸笔任务由孩子自己完成，不做勾选打卡，只保留一个前进按钮。 */
/** 读词/记忆开始、换词、调整视口或字号后显示当前内容，避免分组换行或旧滚动把新词留在屏外。
 * 只移动学习舞台滚动位置，不改变固定卡片尺寸或训练状态。 */
function wtQuickRevealCurrent() {
  if (!WT.quick || (WT.quick.step !== 'read' && WT.quick.step !== 'memorize')) return;
  const box = document.getElementById('wtQuickBox');
  if (box) wtQuickReveal(box);
}
function wtQuickReveal(box) {
  if (!document.body.classList.contains('wt-stage')) return;
  const root = box.closest('.wt-root');
  if (!root) return;
  const rootTop = root.getBoundingClientRect().top;
  const toolbarBottom = WT_STAGE_BAR ? WT_STAGE_BAR.getBoundingClientRect().bottom : rootTop;
  const inset = Math.max(16, toolbarBottom - rootTop + 12);
  root.scrollTop = Math.max(0, root.scrollTop + box.getBoundingClientRect().top - rootTop - inset);
}
function wtQuickRead() {
  const q = WT.quick, r = q.read, box = document.getElementById('wtQuickBox');
  const list = q.words;
  if (r.i >= list.length) {
    box.innerHTML = wtDoneHTML(wtIc('check'), '跟读抄写完成', `共 ${list.length} 个${wtNoun()}`, 'memorize', '进入记忆学习 →');
    wtBindDone('memorize');
    wtQuickReveal(box);
    return;
  }
  const w = list[r.i];
  box.innerHTML = `
    ${wtProg(r.i, list.length)}
    <div class="wt-card center t13-card">
      <div class="wt-tag">${wtIc('edit')} ${WT_STEPS[0].t.replace('单词', wtNoun())}</div>
      <div class="wq-word big"><span class="t13-word-text">${esc(w.word)}</span>
        <button class="wq-spk" id="wqSpk" title="读一遍">${wtIc('volume')}</button>
      </div>
      ${w.phonetic ? `<div class="wq-phon">${esc(w.phonetic)}</div>` : ''}
      ${w.meaning ? `<div class="wq-mean">${esc(w.meaning)}</div>` : ''}
      <div class="wq-read-tip">跟读3遍，抄写3遍英语1遍汉语，写好后点击下面按钮</div>
    </div>
    <div class="wt-acts t13-read-actions"><div class="t13-read-controls"><button class="btn" id="wqNext">写好了，下一个 →</button></div></div>`;
  document.getElementById('wqSpk').onclick = () => speak(w.word);
  document.getElementById('wqNext').onclick = () => { r.i++; wtQuickRead(); };
  wtQuickReveal(box);
  // 进入本词自动示范一遍：整词读一遍
  if (r.spoke !== w.id) {
    r.spoke = w.id;
    wtLater(() => speak(w.word), 300);
  }
}

/* ---------------- ② 记忆学习 ---------------- */
function wtQuickMem() {
  const q = WT.quick, m = q.mem, box = document.getElementById('wtQuickBox');
  const list = q.words;
  if (m.i >= list.length) {
    const isQuick = (WT.curSub || 'quick') === 'quick';
    box.innerHTML = wtDoneHTML(wtIc('check'), '记忆学习完成', `本轮 ${list.length} 个${wtNoun()}`, 'match', isQuick ? '进入听音拼写 →' : '进入听音选词 →');
    wtBindDone('match');
    wtQuickReveal(box);
    return;
  }
  const w = list[m.i];
  const cn = w.meaning || '（没写释义）';
  const pool = [...new Set(WT.data.words.map((x) => x.meaning).filter((x) => x && x !== cn))];
  const opts = shuffle(pick(pool, 3).concat([cn]));
  box.innerHTML = `
    ${wtProg(m.i, list.length)}
    <div class="wt-card center t13-card">
      <div class="wt-tag">🧠 记忆学习</div>
      <div class="wq-word big" id="wqEn"><span class="t13-word-text">${esc(w.word)}</span> <button class="wq-spk" id="wqSpk">${wtIc('volume')}</button></div>
      ${w.phonetic ? `<div class="wq-phon">${esc(w.phonetic)}</div>` : ''}
      <div class="wq-mean ${m.revealed ? 'big' : 'hide'}" id="wqCn">${esc(cn)}</div>
      ${m.phase === 'ask' ? `
        <p class="wq-title">这个单词你认识吗？</p>
        <div class="wt-acts">
          <button class="btn wq-emo-no" id="wqNo">😢 不认识</button>
          <button class="btn wq-emo-yes" id="wqYes">😁 认识</button>
        </div>` : ''}
      ${m.phase === 'quiz' ? `
        <p class="wq-title">它是什么意思？选一个</p>
        <div class="wq-cdline">⏳ <b id="wqTimer">5</b> 秒内选一个，超时算错哦</div>
        <div class="wq-cdbar"><i id="wqCdBar"></i></div>
        <div class="wt-options">${opts.map((o, i) => `<button class="wt-opt" data-o="${i}">${esc(o)}</button>`).join('')}</div>
        <div class="wq-feedback" id="wqFb"></div>` : ''}
      ${m.phase === 'learn' ? `
        <div class="wq-feedback" id="wqFb"><span class="o">跟着读两遍：先读英文，再读中文，边读边记</span></div>
        <div class="wt-acts"><button class="btn primary-sm" id="wqNext">记住了，下一个 →</button></div>` : ''}
    </div>`;
  // 分组列表与上一张卡片的滚动不应把当前记忆内容留在屏外；保留大卡片和训练状态。
  wtQuickReveal(box);
  document.getElementById('wqSpk').onclick = () => speak(w.word);
  const no = document.getElementById('wqNo');
  // 不认识 / 选错 → 这个词排到队列最后，反复出现直到在「测一测」里选对为止
  if (no) no.onclick = () => { q.wrong++; wtRecord('quick', false, w.id); wtWrongWordAdd(w, '记忆学习'); list.push(w); wtMemLearn(w); };
  const yes = document.getElementById('wqYes');
  if (yes) yes.onclick = () => { m.phase = 'quiz'; wtQuickMem(); };
  const nx = document.getElementById('wqNext');
  if (nx) nx.onclick = () => { m.i++; m.phase = 'ask'; m.revealed = false; wtQuickMem(); };
  if (m.phase === 'ask' && m.spoke !== w.id) { m.spoke = w.id; wtLater(() => speak(w.word), 250); }
  if (m.phase === 'quiz') {
    // 5 秒倒计时：超时没选 = 选错（进错词本 + 排到队尾重考）
    let cdLeft = 5;
    const tag = WT_TTS_TAG;  // 页面切换（wtStopSpeech）会作废旧代次，倒计时随之失效
    const tNum = document.getElementById('wqTimer');
    const tBar = document.getElementById('wqCdBar');
    const cdTimeout = () => {
      q.wrong++;
      wtRecord('quick', false, w.id);
      wtWrongWordAdd(w, '记忆学习');
      list.push(w);
      box.querySelectorAll('.wt-opt').forEach((x) => { x.disabled = true; if (x.textContent === cn) x.classList.add('ok'); });
      const fb = document.getElementById('wqFb');
      if (fb) fb.innerHTML = '<span class="r">⏰ 时间到！正确的是上面标绿的意思，跟着记一遍，等下还会再考你</span>';
      wtLater(() => wtMemLearn(w), 900);
    };
    const cdTick = setInterval(() => {
      if (tag !== WT_TTS_TAG) { clearInterval(cdTick); return; }  // 已离开本页，倒计时作废
      cdLeft--;
      if (tNum) tNum.textContent = cdLeft;
      if (tBar) tBar.style.width = (cdLeft / 5 * 100) + '%';
      if (cdLeft <= 0) { clearInterval(cdTick); cdTimeout(); }
    }, 1000);
    box.querySelectorAll('.wt-opt').forEach((b) => b.onclick = () => {
      clearInterval(cdTick);
      const right = opts[Number(b.dataset.o)] === cn;
      wtRecord('quick', right, w.id);
      box.querySelectorAll('.wt-opt').forEach((x) => {
        x.disabled = true;
        if (x.textContent === cn) x.classList.add('ok');
        else if (x === b) x.classList.add('no');
      });
      if (right) {
        q.right++;
        document.getElementById('wqFb').innerHTML = '<span class="g">✅ 答对了！</span>';
        wtLater(() => { m.i++; m.phase = 'ask'; m.revealed = false; wtQuickMem(); }, 650);
      } else {
        q.wrong++;
        wtWrongWordAdd(w, '记忆学习');  // 选错 → 收进错词本
        list.push(w);       // 选错 → 排到队尾，之后还会再考，直到选对为止
        document.getElementById('wqFb').innerHTML = '<span class="r">❌ 正确的是上面标绿的意思，跟着记一遍，等下还会再考你</span>';
        wtLater(() => wtMemLearn(w), 900);
      }
    });
  }
}
/** 不认识 / 选错：亮出中文释义 → 读英文放大英文 → 读中文放大中文 */
function wtMemLearn(w) {
  const m = WT.quick.mem;
  m.revealed = true; m.phase = 'learn';
  wtQuickMem();
  const en = document.getElementById('wqEn'), cn = document.getElementById('wqCn');
  if (en) { en.classList.add('wq-big'); wtLater(() => en.classList.remove('wq-big'), 1500); }
  speak(w.word);
  wtLater(() => {
    if (cn) { cn.classList.add('wq-big'); wtLater(() => cn.classList.remove('wq-big'), 1700); }
    speak(w.meaning || w.word, 'zh-CN');
  }, 1700);
}

/* ---------------- ③ 听音拼写（单词速记专属第③步；短语速记此步仍是中英连连看） ----------------
 * 系统把单词按音节拆开逐个读（自然拼读式发音，用服务端神经语音，有道音库对音节碎片会念成字母）、
 * 再合并读整词，只读一遍；孩子看中文释义，按顺序点音节块拼出单词（点格子可退回）。
 * 音节块顺序打乱，并混入 1 个长得像的干扰音节块，孩子必须真的听音才能拼对。
 * 单词只考本分组的原词（不包含前面步骤答错排进来的重复词）；本环节拼错 / 超时的词排到队尾，在本环节里重复直到拼对。
 * 发音示范读完后开始 10 秒倒计时：超时算错（收进错词本、亮出正确拼法、自动下一个）。 */

/** 生成 1 个「长得像」的干扰音节块：换元音 / 换辅音 / 倒序，保证与真实音节都不同 */
function lsDistractor(syls) {
  const reals = new Set(syls.map((s) => String(s).toLowerCase()));
  const V = 'aeiou';
  const C = 'bcdfghklmnprst';
  for (let t = 0; t < 24; t++) {
    const base = syls[Math.floor(Math.random() * syls.length)];
    let s = base;
    const mode = Math.floor(Math.random() * 3);
    if (mode === 0) {            // 换一个元音字母
      const idxs = [...s].map((c, i) => V.includes(c.toLowerCase()) ? i : -1).filter((i) => i >= 0);
      if (!idxs.length) continue;
      const i = idxs[Math.floor(Math.random() * idxs.length)];
      let nv = V[Math.floor(Math.random() * V.length)];
      if (nv === s[i].toLowerCase()) nv = V[(V.indexOf(nv) + 1) % V.length];
      s = s.slice(0, i) + nv + s.slice(i + 1);
    } else if (mode === 1) {     // 换一个辅音字母
      const idxs = [...s].map((c, i) => !V.includes(c.toLowerCase()) ? i : -1).filter((i) => i >= 0);
      if (!idxs.length) continue;
      const i = idxs[Math.floor(Math.random() * idxs.length)];
      let nc = C[Math.floor(Math.random() * C.length)];
      if (nc === s[i].toLowerCase()) nc = C[(C.indexOf(nc) + 1) % C.length];
      s = s.slice(0, i) + nc + s.slice(i + 1);
    } else {                     // 倒过来拼
      s = [...s].reverse().join('');
    }
    if (s.length >= 2 && !reals.has(s.toLowerCase())) return s;
  }
  return (syls[0] || 'w') + 'p';
}

/** 听音拼写示范发音：逐音节（服务端神经语音 = 自然拼读式念音节）→ 整词（有道真人音库），只读一遍 */
function wtListenIntro(syls, word, onDone) {
  const myTag = ++WT_TTS_TAG;   // 作废上一段没读完的发音
  const step = (i) => {
    if (myTag !== WT_TTS_TAG) return;
    if (i >= syls.length) {     // 音节读完 → 整词读一遍
      wtPlayAudio(word, 'en-US', () => { if (myTag === WT_TTS_TAG) onDone(); });
      return;
    }
    wtPlayAudio(syls[i], 'en-US', () => wtLater(() => step(i + 1), 260), 1, true);   // noDict：音节碎片走服务端合成
  };
  step(0);
}

function wtQuickListen() {
  const q = WT.quick, g = q.match, box = document.getElementById('wtQuickBox');
  // 只考本分组的原词：记忆学习里答错排到队尾的重复词不带入本环节（去重，按词书里的原始分组）
  if (!g.lsQueue || !g.lsQueue.length) {
    const seen = new Set();
    g.lsQueue = (q.words || []).filter((w) => {
      if (!w || !w.word || seen.has(String(w.id))) return false;
      seen.add(String(w.id));
      return true;
    });
    g.lsTotal = g.lsQueue.length;
  }
  if (g.li == null) g.li = 0;
  if (g.li >= g.lsQueue.length) {
    box.innerHTML = wtDoneHTML(wtIc('check'), '听音拼写完成',
      `${g.lsTotal} 个${wtNoun()}都拼出来啦${g.lsWrong ? `，共拼错 <b class="r">${g.lsWrong}</b> 次` : '，全部一次拼对！'}`, 'spell', '进入默写练习 →');
    wtBindDone('spell');
    return;
  }
  const w = g.lsQueue[g.li];
  const syls = sylSplit(w.word);
  const tiles = shuffle([...syls, lsDistractor(syls)]);   // 真实音节 + 1 个干扰音节，顺序打乱
  let used = tiles.map(() => false);          // 音节块是否已被选用
  const slots = Array(syls.length).fill(-1);  // 每个格子放的音节块下标（-1 = 空）
  let cdTick = null;                          // 倒计时句柄
  const locked = { v: false };                // 判定中 / 亮答案时锁住操作

  box.innerHTML = `
    ${wtProg(g.li, g.lsQueue.length, '第 ' + (g.li + 1) + ' / ' + g.lsQueue.length + ' 词')}
    <div class="wt-card center t13-card">
      <div class="wt-tag">${wtIc('sound')} 听音拼选</div>
      ${w.phonetic ? `<div class="wq-phon">${esc(w.phonetic)}</div>` : ''}
      <div class="wq-ls-meanwrap">
        <button class="wq-ls-meancover" id="wqLsMeanCover">点一下显示释义</button>
        <div class="wq-mean big" id="wqLsMean" style="display:none">${esc(w.meaning || '（没写释义）')}</div>
      </div>
      <div class="wq-ls-slots" id="wqLsSlots">${syls.map((_, j) => `<button class="wq-ls-slot" data-s="${j}">?</button>`).join('')}</div>
      <div class="wq-ls-tiles" id="wqLsTiles">${tiles.map((s, i) => `<button class="wq-ls-tile" data-t="${i}">${esc(s)}</button>`).join('')}</div>
      <div class="wq-cdline">⏳ <b id="wqLtNum">10</b> 秒内拼好哦　<button class="btn ghost" id="wqLsReplay" style="padding:2px 10px">🔊 再听一遍</button></div>
      <div class="wq-cdbar"><i id="wqLtBar"></i></div>
      <div class="wq-feedback" id="wqLsFb"></div>
    </div>`;
  const fb = document.getElementById('wqLsFb');
  const numEl = document.getElementById('wqLtNum');
  const barEl = document.getElementById('wqLtBar');
  const slotEls = [...box.querySelectorAll('.wq-ls-slot')];
  const tileEls = [...box.querySelectorAll('.wq-ls-tile')];
  // 中文释义被「贴纸」盖住：点贴纸显示释义，再点释义收回
  const meanCover = document.getElementById('wqLsMeanCover');
  const meanEl = document.getElementById('wqLsMean');
  if (meanCover && meanEl) {
    meanCover.onclick = () => { meanCover.style.display = 'none'; meanEl.style.display = ''; FX.tap(); };
    meanEl.style.cursor = 'pointer';
    meanEl.onclick = () => { meanEl.style.display = 'none'; meanCover.style.display = ''; };
  }

  const paint = () => {
    slotEls.forEach((el, j) => {
      const ti = slots[j];
      el.textContent = ti >= 0 ? tiles[ti] : '?';
      el.classList.toggle('filled', ti >= 0);
    });
    tileEls.forEach((el, i) => el.classList.toggle('used', used[i]));
  };

  const stopCd = () => { if (cdTick) { clearInterval(cdTick); cdTick = null; } };
  const startCd = () => {
    stopCd();
    const myTag = WT_TTS_TAG;                 // 切步骤 / 切页 wtStopSpeech 会作废旧代次，倒计时随之失效
    let left = 10;
    if (numEl) numEl.textContent = left;
    if (barEl) barEl.style.width = '100%';
    cdTick = setInterval(() => {
      if (myTag !== WT_TTS_TAG) { stopCd(); return; }
      left--;
      if (numEl) numEl.textContent = Math.max(0, left);
      if (barEl) barEl.style.width = (Math.max(0, left) / 10 * 100) + '%';
      if (left <= 0) { stopCd(); onTimeout(); }
    }, 1000);
  };

  /** 记一次错：进错词本 + 这个词排到本环节队尾（等下还会再考，直到拼对） */
  const markWrong = () => {
    g.lsWrong = (g.lsWrong || 0) + 1;
    q.wrong++;
    wtRecord('quick', false, w.id);
    wtWrongWordAdd(w, '听音拼写');
    g.lsQueue.push(w);
  };

  /** 超时：算错 → 亮出正确拼法（绿色）→ 读一遍 → 下一个（错词排队尾） */
  const onTimeout = () => {
    if (locked.v) return;
    locked.v = true;
    markWrong();
    // 亮出正确拼法：真实音节在打乱后的块里找到对应块填进格子
    slots.forEach((_, j) => { slots[j] = tiles.indexOf(syls[j]); });
    used = tiles.map((_, i) => slots.includes(i));
    paint();
    slotEls.forEach((el) => el.classList.add('ok'));
    tileEls.forEach((el) => el.classList.add('used'));
    fb.innerHTML = '<span class="r">⏰ 时间到！正确拼法是上面这样的，跟着读一遍，等下还会再考你</span>';
    wtPlayAudio(w.word, 'en-US');
    wtLater(() => { g.li++; wtQuickListen(); }, 1900);
  };

  /** 格子填满后判定 */
  const check = () => {
    stopCd();
    const join = slots.map((ti) => tiles[ti]).join('').toLowerCase().replace(/[^a-z']/g, '');
    if (join === String(w.word || '').toLowerCase().replace(/[^a-z']/g, '')) {
      locked.v = true;
      q.right++;
      wtRecord('quick', true, w.id);
      slotEls.forEach((el) => el.classList.add('ok'));
      tileEls.forEach((el) => el.classList.add('used'));
      fb.innerHTML = '<span class="g">✅ 拼对了！真棒</span>';
      wtPlayAudio(w.word, 'en-US');
      wtLater(() => { g.li++; wtQuickListen(); }, 1050);
    } else {
      markWrong();
      slotEls.forEach((el) => { if (el.classList.contains('filled')) el.classList.add('no'); });
      fb.innerHTML = '<span class="r">❌ 拼得不对，这个词等下还会再考你</span>';
      wtLater(() => { g.li++; wtQuickListen(); }, 900);
    }
  };

  slotEls.forEach((el, j) => el.onclick = () => {
    if (locked.v || slots[j] < 0) return;
    used[slots[j]] = false; slots[j] = -1; paint();     // 点格子退回音节块
  });
  tileEls.forEach((el, i) => el.onclick = () => {
    if (locked.v || used[i]) return;
    const j = slots.indexOf(-1);
    if (j < 0) return;
    slots[j] = i; used[i] = true;
    paint();
    wtPlayAudio(tiles[i], 'en-US', null, 1, true);       // 点音节顺带读一下（服务端拼读式发音）
    if (!slots.includes(-1)) check();
  });
  document.getElementById('wqLsReplay').onclick = () => { stopCd(); wtListenIntro(syls, w.word, startCd); };

  // 进来先自动示范一遍发音，读完开始倒计时；同一次停留内切走再切回不重复播
  if (g.lsSpoke !== w.id) {
    g.lsSpoke = w.id;
    wtLater(() => wtListenIntro(syls, w.word, startCd), 350);
  } else {
    startCd();
  }
}

/* ---------------- ③ 听音选词（短语速记第③步） ----------------
 * 系统读一遍短语 → 中文释义被贴纸盖住（点一下显示）→ 下方打乱放短语里的单词 + 1 个干扰词 → 按序点词拼出这条短语。
 * 拼错自动进错词本，并把这条短语排到队尾再考一次，直到拼对。 */
function wtPhraseListen() {
  const q = WT.quick, g = q.match, box = document.getElementById('wtQuickBox');
  // 只考本分组的原短语（去重，与听音拼选同款队列）
  if (!g.lsQueue || !g.lsQueue.length) {
    const seen = new Set();
    g.lsQueue = (q.words || []).filter((w) => {
      if (!w || !w.word || seen.has(String(w.id))) return false;
      seen.add(String(w.id));
      return true;
    });
    g.lsTotal = g.lsQueue.length;
  }
  if (g.li == null) g.li = 0;
  if (g.li >= g.lsQueue.length) {
    box.innerHTML = wtDoneHTML(wtIc('check'), '听音选词完成',
      `${g.lsTotal} 条短语都拼出来啦${g.lsWrong ? `，共拼错 <b class="r">${g.lsWrong}</b> 次` : '，全部一次拼对！'}`, 'spell', '进入语境填空 →');
    wtBindDone('spell');
    return;
  }
  const w = g.lsQueue[g.li];
  const ws = String(w.word).trim().split(/\s+/).filter(Boolean);   // 短语按空格拆成单词
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z']/g, '');
  // 干扰词：从其它短语里随机取一个本短语没有的单词（多一个干扰项）
  const own = new Set(ws.map(norm));
  let extra = '';
  for (const other of shuffle(q.words || [])) {
    if (!other || !other.word || String(other.id) === String(w.id)) continue;
    const cand = String(other.word).trim().split(/\s+/).find((x) => x && !own.has(norm(x)));
    if (cand) { extra = cand; break; }
  }
  if (!extra) extra = 'the';   // 兜底干扰词
  const tiles = shuffle([...ws, extra]);     // 短语单词 + 1 个干扰词，顺序打乱
  let used = tiles.map(() => false);
  const slots = Array(ws.length).fill(-1);   // 每个格子放的单词块下标（-1 = 空）
  const locked = { v: false };

  box.innerHTML = `
    ${wtProg(g.li, g.lsQueue.length, '第 ' + (g.li + 1) + ' / ' + g.lsQueue.length + ' 条')}
    <div class="wt-card center t13-card">
      <div class="wt-tag">${wtIc('sound')} 听音选词</div>
      <div class="wq-ls-meanwrap">
        <button class="wq-ls-meancover" id="wqLsMeanCover">点一下显示释义</button>
        <div class="wq-mean big" id="wqLsMean" style="display:none">${esc(w.meaning || '（没写释义）')}</div>
      </div>
      <div class="wq-ls-slots" id="wqLsSlots">${ws.map((_, j) => `<button class="wq-ls-slot" data-s="${j}">?</button>`).join('')}</div>
      <div class="wq-ls-tiles" id="wqLsTiles">${tiles.map((s, i) => `<button class="wq-ls-tile" data-t="${i}">${esc(s)}</button>`).join('')}</div>
      <div class="wq-cdline">🔊 听短语，按顺序点出它的单词　<button class="btn ghost" id="wqLsReplay" style="padding:2px 10px">🔊 再听一遍</button></div>
      <div class="wq-feedback" id="wqLsFb"></div>
    </div>`;
  const fb = document.getElementById('wqLsFb');
  const slotEls = [...box.querySelectorAll('.wq-ls-slot')];
  const tileEls = [...box.querySelectorAll('.wq-ls-tile')];
  // 中文释义被「贴纸」盖住：点贴纸显示释义，再点释义收回
  const meanCover = document.getElementById('wqLsMeanCover');
  const meanEl = document.getElementById('wqLsMean');
  if (meanCover && meanEl) {
    meanCover.onclick = () => { meanCover.style.display = 'none'; meanEl.style.display = ''; FX.tap(); };
    meanEl.style.cursor = 'pointer';
    meanEl.onclick = () => { meanEl.style.display = 'none'; meanCover.style.display = ''; };
  }

  const paint = () => {
    slotEls.forEach((el, j) => {
      const ti = slots[j];
      el.textContent = ti >= 0 ? tiles[ti] : '?';
      el.classList.toggle('filled', ti >= 0);
    });
    tileEls.forEach((el, i) => el.classList.toggle('used', used[i]));
  };

  /** 记一次错：进错词本 + 这条短语排到本环节队尾（等下还会再考，直到拼对） */
  const markWrong = () => {
    g.lsWrong = (g.lsWrong || 0) + 1;
    q.wrong++;
    wtRecord('quick', false, w.id);
    wtWrongWordAdd(w, '听音选词');
    g.lsQueue.push(w);
  };

  /** 在打乱后的块里找出短语的正确拼法（同词多份不重复占用） */
  const fillAnswer = () => {
    const pool = tiles.map((_, i) => i);
    ws.forEach((word, j) => {
      const k = pool.findIndex((i) => norm(tiles[i]) === norm(word));
      if (k >= 0) { slots[j] = pool[k]; pool.splice(k, 1); }
    });
    used = tiles.map((_, i) => slots.includes(i));
    paint();
    slotEls.forEach((el) => el.classList.add('ok'));
    tileEls.forEach((el) => el.classList.add('used'));
  };

  /** 格子填满后判定 */
  const check = () => {
    locked.v = true;
    if (slots.every((ti, j) => norm(tiles[ti]) === norm(ws[j]))) {
      q.right++;
      wtRecord('quick', true, w.id);
      slotEls.forEach((el) => el.classList.add('ok'));
      tileEls.forEach((el) => el.classList.add('used'));
      fb.innerHTML = '<span class="g">✅ 拼对了！真棒</span>';
      wtPlayAudio(w.word, 'en-US');
      wtLater(() => { g.li++; wtPhraseListen(); }, 1050);
    } else {
      markWrong();
      fillAnswer();
      fb.innerHTML = '<span class="r">❌ 拼得不对，正确拼法是上面这样的，等下还会再考你</span>';
      wtPlayAudio(w.word, 'en-US');
      wtLater(() => { g.li++; wtPhraseListen(); }, 1900);
    }
  };

  slotEls.forEach((el, j) => el.onclick = () => {
    if (locked.v || slots[j] < 0) return;
    used[slots[j]] = false; slots[j] = -1; paint();     // 点格子退回单词块
  });
  tileEls.forEach((el, i) => el.onclick = () => {
    if (locked.v || used[i]) return;
    const j = slots.indexOf(-1);
    if (j < 0) return;
    slots[j] = i; used[i] = true;
    paint();
    wtPlayAudio(tiles[i], 'en-US', null, 1, true);       // 点单词顺带读一下
    if (!slots.includes(-1)) check();
  });
  document.getElementById('wqLsReplay').onclick = () => wtPlayAudio(w.word, 'en-US');

  // 进来先自动读一遍短语；同一次停留内切走再切回不重复播
  if (g.lsSpoke !== w.id) {
    g.lsSpoke = w.id;
    wtLater(() => wtPlayAudio(w.word, 'en-US'), 350);
  }
}

/* ---------------- ④ 默写练习 / 语境填空 ---------------- */
function wtQuickSpell() {
  const q = WT.quick, s = q.spell, box = document.getElementById('wtQuickBox');
  if (s.i >= s.queue.length) {
    // 错词重练 / SM-2 复习轮结束：全部写对了
    if (q.drill) {
      const isRv = WT_DRILL_REVIEW;
      const leftDue = wtSrsDueList().length;
      const left = wtWrongWordList().length;
      box.innerHTML = `<div class="empty"><div class="e-ic">${isRv ? '🎯' : '🎉'}</div><b>${isRv ? '复习完成！' : '错词重练完成！'}</b>
        <div style="margin-top:8px">${isRv
          ? `这批到期词都默写对了，SM-2 已把它们的下次复习时间往后排${leftDue ? `，还有 <b>${leftDue}</b> 个到期词` : ''}`
          : `这批错词都默写对了，已自动移出错词本${left ? `，错词本还剩 <b>${left}</b> 个单词` : '，错词本已清空 🎊'}`}</div>
        <div style="margin-top:14px">
          ${isRv && leftDue ? `<button class="btn primary-sm" id="wtWwAgain">🔁 继续复习剩余 ${leftDue} 词</button>` : ''}
          ${!isRv && left ? `<button class="btn primary-sm" id="wtWwAgain">🔁 继续重练剩余 ${left} 词</button>` : ''}
          <button class="btn ghost" id="wtWwBack" style="margin-left:8px">↩ 回到分组练习</button>
        </div></div>`;
      const again = document.getElementById('wtWwAgain');
      if (again) again.onclick = () => {
        wtWrongWordBadge(); wtReviewBadge();
        if (isRv) {
          const due = wtSrsDueList();
          if (due.length) { WT_DRILL_REVIEW = true; WT_WORD_DRILL = due.map((x) => ({ id: x.id, word: x.word, phonetic: x.phonetic, meaning: x.meaning, unit: x.unit })); }
          wtQuickStart(false);
        } else {
          wtQuickStart(false);
        }
      };
      document.getElementById('wtWwBack').onclick = () => {
        wtReset(WT.curSub || 'quick'); wtQuickStart(false);
      };
      return;
    }
    // 四个练习全部做完 → 本分组由灰变绿（存进 localStorage，下次进来还是绿的）
    if (typeof FX !== 'undefined') FX.win();   // 完成一个分组的庆祝音
    wtGroupMark(WT.groupIdx);
    wtBindGroups();
    const nxt = WT.groupDefs.findIndex((_, i) => i !== WT.groupIdx && !wtGroupDone(i));
    const isQuickSub = (WT.curSub || 'quick') === 'quick';
    box.innerHTML = `<div class="empty"><div class="e-ic">🎉</div><b>分组${WT.groupIdx + 1} 全部完成！</b>
      <div style="margin-top:8px">${isQuickSub ? '单词学习' : '短语学习'} → 记忆学习 → ${isQuickSub ? '听音拼写' : '听音选词'} → ${isQuickSub ? '默写练习' : '语境填空'} 都做完啦${s.repeat ? `，共订正 <b class="r">${s.repeat}</b> 次` : '，全部一次拼对！'}</div>
      <div style="margin-top:20px">
        ${nxt >= 0 ? `<button class="btn primary-lg" id="wtNextGrp">开始 分组${nxt + 1} →</button>` : '<span class="g">🏆 本书所有分组都完成啦，太棒了！</span>'}
      </div></div>`;
    const ng = document.getElementById('wtNextGrp');
    if (ng) ng.onclick = () => wtStartGroup(nxt, false);
    return;
  }
  const w = s.queue[s.i];
  const isCtx = WT.curSub === 'phrase';   // 短语速记第④步 = 语境填空（AI 例句挖空）
  if (isCtx) { wtCtxItem(w); return; }
  const letters = String(w.word).replace(/[^a-zA-Z]/g, '').length;
  box.innerHTML = `
    ${wtProg(s.i, s.queue.length, `待默写 ${s.queue.length - s.i} 个`)}
    <div class="wt-card center t13-card">
      <div class="wt-tag">${q.drill ? (WT_DRILL_REVIEW ? '🎯 SM-2 复习' : '📕 错词重练') : '⌨️ 默写练习'}</div>
      <div class="wq-mean big">${esc(w.meaning || '（没写释义）')}</div>
      <div class="wq-hint">${w.phonetic ? esc(w.phonetic) + ' · ' : ''}${letters} 个字母</div>
      <input class="input wt-input" id="wsInput" placeholder="敲出英文单词，回车提交" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="wq-feedback" id="wsFb"></div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wsHear">${wtIc('volume')} 听发音</button>
      <button class="btn primary-sm" id="wsOk">提交</button>
    </div>`;
  const input = document.getElementById('wsInput');
  input.focus();
  document.getElementById('wsOk').onclick = () => wtSpellSubmit(false);
  wtBindSpellKeys();
  document.getElementById('wsHear').onclick = () => speak(w.word);
}
/** 语境填空的填空输入框（和短语默写一样的白框，不带任何字形提示），宽度按短语长度自适应。
 *  顶层定义：wtCtxItem（挖空态）与 wtCtxWrongShow（订正态）都要用；之前定义在 wtCtxItem 内部，
 *  wtCtxWrongShow 引用不到 → 答错提交时抛 ReferenceError，表现为「回车/提交没反应」。 */
const ctxInputHTML = (w) => {
  const p = String(w.word || '').trim();
  const wch = Math.max(9, p.replace(/\s+/g, '').length + 6);
  return `<input class="ctx-input" id="wsInput" style="width:${wch}ch" autocomplete="off" autocapitalize="off" spellcheck="false">`;
};
/** 句子 + 成分标注一体渲染：每个成分一段（彩色成分名在上、连线向下、原文在下），
 *  挖空短语所在的段里嵌输入框（answer=true 时标绿展示正确答案）。结构缺失时整句一段。 */
const stxLine = (w, ctx, answer) => {
  const p = String(w.word || '').trim();
  // 挖空片段优先用服务端算好的 ctx.blank（句中真实原文，例如 be good at → "am good at"、
  // "it's time to ..." → "It's time to"）；老数据没有时才退回「短语原文」硬匹配。
  const probe = String((ctx && ctx.blank) || '').trim() || p;
  const re = new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const seg = (role, text, phraseIn) => {
    const lab = role ? `<span class="stx-seg-role r-${esc(role)}">${esc(role)}</span><i class="stx-seg-line"></i>` : '<i class="stx-seg-line none"></i>';
    const body = phraseIn
      ? (answer ? `<b class="ctx-ans">${esc(p)}</b>` : ctxInputHTML(w))
      : esc(text || '');
    return `<span class="stx-seg">${lab}<span class="stx-seg-text">${body}</span></span>`;
  };
  const stx = (ctx && Array.isArray(ctx.structure) && ctx.structure.length >= 2) ? ctx.structure : null;
  if (stx) {
    let used = false;
    const out = stx.map((it) => {
      const text = String(it && it.text || '');
      if (!text) return '';
      const m = used ? null : re.exec(text);
      if (m) {
        used = true;
        const role = it.role || '';
        const lab = role ? `<span class="stx-seg-role r-${esc(role)}">${esc(role)}</span><i class="stx-seg-line"></i>` : '<i class="stx-seg-line none"></i>';
        const inner = esc(text.slice(0, m.index)) + (answer ? `<b class="ctx-ans">${esc(m[0])}</b>` : ctxInputHTML(w)) + esc(text.slice(m.index + m[0].length));
        return `<span class="stx-seg">${lab}<span class="stx-seg-text">${inner}</span></span>`;
      }
      return seg(it.role || '', text, false);
    }).join('');
    if (used) return out;
  }
  // 结构缺失 / 短语没落在任何成分段里 → 整句一段，短语位置挖空
  const sent = String((ctx && ctx.sentence) || '');
  const m = re.exec(sent);
  if (!m) return `<span class="stx-seg"><i class="stx-seg-line none"></i><span class="stx-seg-text">${esc(sent)}</span></span>` + (answer ? '' : `<span class="stx-seg"><i class="stx-seg-line none"></i><span class="stx-seg-text">${ctxInputHTML(w)}</span></span>`);
  return `<span class="stx-seg"><i class="stx-seg-line none"></i><span class="stx-seg-text">${esc(sent.slice(0, m.index))}${answer ? `<b class="ctx-ans">${esc(m[0])}</b>` : ctxInputHTML(w)}${esc(sent.slice(m.index + m[0].length))}</span></span>`;
};
/** 语境填空的答案比对：普通短语严格相等；带「…」的模板短语（it's time to ... / like ... best）
 *  按模板匹配——孩子填入自己的版本（It's time to go）也算对，不必照抄 "..."。 */
function wtAnswerOk(val, phrase) {
  const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const v = norm(val), p = norm(phrase);
  if (!v || !p) return false;
  if (v === p) return true;
  if (!/\.{2,}|…/.test(p)) return false;
  const parts = p.split(/\s*(?:\.{2,}|…)\s*/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  const lead = /^\s*(?:\.{2,}|…)/.test(p);
  const trail = /(?:\.{2,}|…)\s*$/.test(p);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = parts.map(esc).join('[\\s\\S]*?\\s\\S[\\s\\S]*?\\s');
  if (lead) body = '\\S[\\s\\S]*?' + (body ? '\\s' + body : '');
  if (trail) body = (body ? body + '\\s' : '') + '\\S[\\s\\S]*?';
  try { return new RegExp('^' + body + '$').test(v); } catch (e) { return false; }
}
/** 语境填空（短语速记第④步）：AI 生成的同年级课本风格例句挖空短语，输入框（和短语默写一样的框）直接嵌在
 *  句子的挖空位置；句子成分拆解不单独成行，而是直接标在句子每个成分的上方（彩色成分名 + 连线，思维导图式）。
 *  例句与结构都按短语缓存（会话内存 + 服务端 phrase_sentences 表），且服务端在进入短语速记时就开始
 *  后台整本预生成（/phrase-prefill），学生到这一步全部命中缓存、零等待。
 *  答错：亮出正确短语 + 例句里答案标绿 + 结构标注，排到队尾再考，直到填对（wtSpellSubmit 处理）。 */
function wtCtxItem(w) {
  const q = WT.quick, s = q.spell, box = document.getElementById('wtQuickBox');
  const wlen = String(w.word).trim().split(/\s+/).filter(Boolean).length;
  box.innerHTML = `
    ${wtProg(s.i, s.queue.length, `待填空 ${s.queue.length - s.i} 条`)}
    <div class="wt-card center t13-card">
      <div class="wt-tag">${wtIc('doc')} 语境填空</div>
      <div id="ctxBody"><div class="loading-page">正在生成例句…</div></div>
      <div class="wq-feedback" id="wsFb"></div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wsHear">${wtIc('volume')} 听短语</button>
      <button class="btn primary-sm" id="wsOk">提交</button>
    </div>`;
  document.getElementById('wsOk').onclick = () => wtSpellSubmit(false);
  wtBindSpellKeys();
  document.getElementById('wsHear').onclick = () => speak(w.word);

  // 触发服务端整本预生成（每本书只触发一次；后台慢速跑，当前这条照常单条生成/命中缓存）
  if (!WT.prefillBooks) WT.prefillBooks = {};
  const bkKey = String(WT.bookId || '');
  if (!WT.prefillBooks[bkKey]) {
    WT.prefillBooks[bkKey] = true;
    api('/api/stu/word/phrase-prefill?book_id=' + encodeURIComponent(bkKey)).catch(() => {});
  }

  const paintCtx = (ctx) => {
    const body = document.getElementById('ctxBody');
    if (!body) return;   // 已切走 / 已提交跳下一题
    if (ctx && ctx.sentence) {
      s.ctx = ctx;
      body.innerHTML = `
        <div class="ctx-sent big">${stxLine(w, ctx, false)}</div>
        ${ctx.cn ? `<div class="ctx-cn">${esc(ctx.cn)}</div>` : ''}`;
    } else {
      // AI 未配置 / 生成失败 → 降级为按中文释义默写（老默写练习的形态）
      s.ctx = null;
      body.innerHTML = `
        <div class="wq-mean big">${esc(w.meaning || '（没写释义）')}</div>
        <div class="wq-hint">默写出这条短语</div>
        <input class="input wt-input" id="wsInput" placeholder="敲出英文短语，回车提交" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="wq-hint">${wlen} 个单词</div>`;
    }
    const inp = document.getElementById('wsInput');
    if (inp) inp.focus();
  };

  const cache = (WT.ctxCache = WT.ctxCache || {});
  const key = String(w.word || '').trim().toLowerCase();
  if (cache[key]) { paintCtx(cache[key]); return; }
  api('/api/stu/word/phrase-sentence?book_id=' + encodeURIComponent(WT.bookId || '')
    + '&word=' + encodeURIComponent(w.word || '')
    + '&meaning=' + encodeURIComponent(w.meaning || ''))
    .then((d) => {
      if (d && d.sentence) { cache[key] = d; paintCtx(d); }
      else paintCtx(null);
    })
    .catch(() => paintCtx(null));
}
/** 语境填空答错后的订正展示（wtSpellSubmit 调用）：例句原样展示、答案在原位标绿、成分标注保留 */
function wtCtxWrongShow(w) {
  const body = document.getElementById('ctxBody');
  if (!body) return;
  const ctx = WT.quick.spell.ctx;
  if (!ctx || !ctx.sentence) {
    body.innerHTML = `<div class="wq-mean big">${esc(w.word)}</div><div class="wq-hint">记住啦？点「下一个」还会再考一次</div>`;
    return;
  }
  body.innerHTML = `
    <div class="ctx-sent big">${stxLine(w, ctx, true)}</div>
    ${ctx.cn ? `<div class="ctx-cn">${esc(ctx.cn)}</div>` : ''}
    <div class="wq-hint">记住啦？点「下一个」还会再考一次</div>`;
}

/** 默写练习的「回车提交」用文档级委托（只绑一次）：
 *  之前绑在输入框 onkeydown 上，孩子点过屏幕其它地方（按钮点偏 / 触屏误触 / 切输入法）后焦点离开输入框，
 *  再按回车就落不到输入框上，「确认键失灵」；现在只要在默写练习页按回车就提交，
 *  并过滤输入法组词过程中的回车（isComposing / keyCode 229），搜狗等输入法不再误触发。 */
function wtBindSpellKeys() {
  if (window.__wtSpellKeysBound) return;
  window.__wtSpellKeysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const inp = document.getElementById('wsInput');
    if (!inp || inp.disabled || inp.value == null) return;
    if (!document.getElementById('wsOk')) return;   // 只在默写练习视图生效（词形默写等别的输入框不受影响）
    e.preventDefault();
    wtSpellSubmit(false);
  }, true);
}
/** 提交默写：拼错 → 亮出正确单词并排到队尾，后面再考一次，直到拼对
 *  注：界面上已不再提供「跳过」按钮（单词 / 短语速记的默写都要求订正），skip 分支仅留给内部调用。 */
function wtSpellSubmit(skip) {
  const q = WT.quick, s = q.spell, w = s.queue[s.i];
  if (skip) { s.i++; wtQuickSpell(); return; }
  const isCtx = WT.curSub === 'phrase';   // 短语速记 = 语境填空
  const input = document.getElementById('wsInput');
  const val = String(input.value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const right = val === String(w.word).trim().toLowerCase().replace(/\s+/g, ' ');
  const fb = document.getElementById('wsFb');
  if (input) input.disabled = true;
  if (right) {
    s.right++; q.right++;
    wtRecord('quick', true, w.id);
    wtSrsReview(w, true);     // 默写写对 → SM-2 排程往后推（复习中心数据源）
    wtWrongWordRemove(w.id);  // 默写写对 → 自动移出错词本
    fb.innerHTML = isCtx && s.ctx ? '<span class="g">✅ 填对了！</span>' : '<span class="g">✅ 拼对了！</span>';
    wtLater(() => { s.i++; wtQuickSpell(); }, 520);
  } else {
    s.wrong++; s.repeat++; q.wrong++;
    wtRecord('quick', false, w.id);
    wtSrsReview(w, false);    // 默写写错 → SM-2 退回重来
    wtWrongWordAdd(w, isCtx ? '语境填空' : '默写练习');  // 拼错 → 收进错词本
    // 拼错不自动跳：大字亮出正确答案，孩子点「下一个」才继续；这个词/短语排到队尾还会再考
    if (isCtx && s.ctx) {
      wtCtxWrongShow(w);   // 正确短语大字 + 例句答案标绿 + 中文 + 句子结构拆解
      if (fb) fb.innerHTML = '<span class="r">不对哦，正确短语已亮出，先记一遍</span>';
    } else {
      fb.innerHTML = `<span class="r">不对哦，正确拼写是：</span>
      <div class="wq-spell-ans">${esc(w.word)}</div>
      <div class="wq-note">${esc(w.meaning || '')}</div>`;
    }
    speak(w.word);
    s.queue.push(w);
    const acts = document.getElementById('wtQuickBox');
    if (acts) {
      const bar = acts.querySelector('.wt-acts');
      if (bar) {
        bar.innerHTML = '<button class="btn primary-sm" id="wsNext">下一个 →</button>';
        document.getElementById('wsNext').onclick = () => { s.i++; wtQuickSpell(); };
      }
    }
  }
}

/* ------------------------------------------------------------ 2. 词性训练（词形转换）
 * 像老师的《词形转换背诵版 + 默写版》：
 *   📖 背诵学习  一张卡一条转换链：care (v.) → careful (adj.) 小心的 → carefully (adv.) 小心地，整链可点读
 *   ✍️ 词形默写  同一条链挖空：care (v.) → ____ (adj.) 小心的 → ____ (adv.)，孩子敲出变形词，错的排到队尾再考
 *   🏷 词性判断  给词选词性（四选一） */
/** 词形转换书本身往往只有变形释义，原词中文不在表里。单词库没有时用这份教材释义兜底。 */
const WT_BASE_MEAN = {
  good: '好的', bad: '坏的', slim: '苗条的', tidy: '整洁的', funny: '有趣的；滑稽的', kind: '善良的',
  care: '关心；在意', hope: '希望', use: '使用；用途', friend: '朋友', british: '英国的',
  attend: '参加；出席', discuss: '讨论', little: '小的；少的', finish: '完成；结束', baseball: '棒球',
  hero: '英雄', daily: '每日的', weekly: '每周的', quick: '快的；迅速的', cheer: '欢呼；喝彩',
  support: '支持', coach: '教练', cost: '花费；价钱', interest: '兴趣', paint: '绘画；油漆',
  row: '划（船）', clear: '清晰的；清楚的', culture: '文化', exactly: '精确地；恰好', mistake: '错误',
  fill: '填满；充满', advice: '建议；忠告', crazy: '疯狂的', shelf: '架子；搁板', cut: '切；剪',
  possible: '可能的', own: '拥有', complete: '完成', danger: '危险', protect: '保护',
  hunt: '打猎；搜寻', act: '行动；扮演', lose: '失去；丢失', mean: '意思是；意味着', sad: '难过的；悲伤的',
  nature: '自然', ill: '生病的', begin: '开始', cloud: '云', wind: '风', rain: '雨；下雨',
  sun: '太阳', fog: '雾', health: '健康', sleep: '睡觉', shine: '发光；照耀', noise: '噪音；响声',
  fun: '乐趣', balance: '平衡', produce: '生产；制造', pollute: '污染', different: '不同的',
  month: '月；月份', week: '周；星期', safe: '安全的', fear: '害怕；恐惧', thunder: '雷',
  fire: '火；火灾', trap: '困住', calm: '平静的；镇静的', luck: '运气', accident: '事故；意外',
};
function wtBaseMeaning(word, wmap) {
  const key = String(word || '').toLowerCase();
  const w = wmap && wmap.get(key);
  if (w && w.meaning) return w.meaning;
  return WT_BASE_MEAN[key] || '';
}

/** 把词性库按原词聚成「转换链」：care 的 careful/carefully/careless 连成一条。
 *  表格里没填 原词词性 / 目标词释义 时，从本词书的单词库兜底取，保证背诵卡上意思和词性尽量不缺。 */
function wtPosChains() {
  const byBase = new Map();
  const seenPair = new Set();
  const wmap = new Map((WT.data.words || []).map((w) => [String(w.word || '').toLowerCase(), w]));
  for (const it of WT.data.pos) {
    if (!it.base_word || !it.target_word) continue;
    if (!byBase.has(it.base_word)) {
      const bw = wmap.get(String(it.base_word).toLowerCase());
      byBase.set(it.base_word, { base: it.base_word, basePos: it.base_pos || (bw && bw.pos ? normPosCn(bw.pos) : ''), baseMeaning: String(it.base_meaning || '').trim() || wtBaseMeaning(it.base_word, wmap), targets: [] });
    }
    const ch = byBase.get(it.base_word);
    const key = it.base_word.toLowerCase() + '|' + it.target_word.toLowerCase() + '|' + it.target_pos;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    const tw = wmap.get(String(it.target_word).toLowerCase());
    ch.targets.push({ word: it.target_word, pos: it.target_pos, meaning: it.meaning || (tw && tw.meaning) || '', affix: it.affix || '', id: it.id });
  }
  return [...byBase.values()].filter((c) => c.targets.length);
}

async function viewWordsPos() {
  return wtShell('pos', {
    html: `<div class="card">
      <div class="toolbar pos-modebar">
        <button class="btn pos-mode primary-sm" data-posmode="learn">📖 背诵学习（转换链）</button>
        <button class="btn pos-mode ghost" data-posmode="judge">🏷 词性判断（给词选词性）</button>
        <button class="btn pos-mode ghost" data-posmode="dict">✍️ 词形默写（挖空填词）</button>
      </div>
      <div id="wtPosBox"></div>
    </div>`,
    after: () => { wtPosStart(); document.querySelectorAll('[data-posmode]').forEach((b) => b.onclick = () => { WT.pos.mode = b.dataset.posmode; document.querySelectorAll('[data-posmode]').forEach((x) => x.className = 'btn pos-mode ' + (x === b ? 'primary-sm' : 'ghost')); wtPosStart(); }); },
  });
}

async function wtPosStart() {
  wtStopSpeech();  // 换模式 / 重开一轮：停掉上一张卡还在读的发音
  let chains = wtPosChains();
  let posWords = WT.data.words.filter((w) => w.pos);  // 老数据 / AI 补全过的单词自带词性
  const hasData = () => (WT.pos.mode === 'judge' ? (posWords.length || chains.length) : chains.length);
  // 当前词书没有可用数据时，在「词性训练可用词书」里自动切到有数据的那本
  if (!hasData()) {
    const other = wtModBooks('pos').find((b) => String(b.id) !== String(WT.bookId) && ((b.pos_count || 0) > 0 || (b.word_count || 0) > 0));
    if (other) {
      WT.bookId = String(other.id); WT.unit = '';
      WT.subState.pos = { book: WT.bookId, unit: '' }; wtSubStateSave();
      await wtEnsureData();
      const sel = document.getElementById('wtBook');
      if (sel) sel.value = WT.bookId;
      chains = wtPosChains();
      posWords = WT.data.words.filter((w) => w.pos);
    }
  }
  const box = document.getElementById('wtPosBox');
  if (WT.pos.mode !== 'judge' && !chains.length) {
    box.innerHTML = '<div class="empty"><div class="e-ic">🔗</div>词形转换库还是空的：让老师在后台「单词记忆 → 词性训练库」上传带「原词 / 目标词 / 词性」列的表格</div>';
    return;
  }

  if (WT.pos.mode === 'dict') { WT.pos.list = shuffle(chains); WT.pos.i = 0; WT.pos.right = 0; WT.pos.wrong = 0; return wtPosDict(); }
  if (WT.pos.mode === 'judge') {
    // 出题源：优先单词库带词性的单词；没有就从词形转换链取（原词 + 各目标词都能出题）
    let src = posWords.map((w) => ({ id: w.id, word: w.word, pos: w.pos, meaning: w.meaning || '', note: w.phonetic || '' }));
    if (!src.length) {
      for (const c of chains) {
        if (c.basePos) src.push({ id: 'b' + c.base, word: c.base, pos: c.basePos, meaning: c.baseMeaning || '', note: '' });
        for (const t of c.targets) src.push({ id: t.id, word: t.word, pos: t.pos, meaning: t.meaning || c.baseMeaning || '', note: t.affix || '' });
      }
    }
    if (!src.length) {
      box.innerHTML = '<div class="empty"><div class="e-ic">🏷</div>这本书还没有可出题的词性数据：让老师在后台「词性训练（词根词缀）表」上传一份（含 原词 / 目标词 / 词性 列）就能练</div>';
      return;
    }
    Object.assign(WT.pos, { i: 0, right: 0, wrong: 0, done: false, picked: '' });
    WT.pos.list = shuffle(src).slice(0, 10).map((w) => ({
      id: w.id, module: 'pos',
      title: `<b>${esc(w.word)}</b> 是什么词性？${w.meaning ? `<span style="color:var(--text3)">（${esc(w.meaning)}）</span>` : ''}`,
      word: w.word, answer: normPosCn(w.pos),
      options: pick(shuffle(['名词', '动词', '形容词', '副词', '介词']).filter((p) => p !== normPosCn(w.pos)).slice(0, 3).concat([normPosCn(w.pos)]), 4),
      note: w.note || '', targetPos: normPosCn(w.pos),
    }));
    return wtPosQ();
  }
  // 背诵学习：一条转换链一张卡
  WT.pos.list = shuffle(chains); WT.pos.i = 0;
  return wtPosLearn();
}

const normPosCn = (s) => {
  const t = String(s || '').trim().toLowerCase();
  if (/^(n|noun|名词)/.test(t)) return '名词';
  if (/^(v|verb|动词)/.test(t)) return '动词';
  if (/^(adj|a\.|adjective|形容词)/.test(t)) return '形容词';
  if (/^(adv|ad\.|adverb|副词)/.test(t)) return '副词';
  return String(s).trim();
};

/* ---------------- 📖 背诵学习：转换链卡片 ---------------- */
function wtPosMeanHTML(text) {
  return text ? `<span class="pos-mean">${esc(text)}</span>` : '';
}
function wtPosChainHTML(ch, revealIdx) {
  // revealIdx：默写模式里已填到第几个空（null = 背诵全展示）
  const rows = [];
  rows.push(`<div class="pos-row base"><b class="pos-w" data-say="${esc(ch.base)}">${esc(ch.base)}</b>${ch.basePos ? `<span class="pos-tag">(${esc(ch.basePos)})</span>` : ''}${wtPosMeanHTML(ch.baseMeaning)}</div>`);
  ch.targets.forEach((t, i) => {
    const blank = revealIdx !== null && i > revealIdx;
    const cur = revealIdx !== null && i === revealIdx;
    const mean = t.meaning || ch.baseMeaning || '';
    rows.push(`<div class="pos-row"><i class="pos-arrow">→</i>${
      cur ? '<span class="pos-blank" id="wpBlank">______</span>'
        : blank ? '<span class="pos-blank dim">______</span>'
        : `<b class="pos-w ${revealIdx !== null && i < revealIdx ? 'ok' : ''}" data-say="${esc(t.word)}">${esc(t.word)}</b>`
    }<span class="pos-tag">(${esc(t.pos)})</span>${wtPosMeanHTML(mean)}</div>`);
  });
  return rows.join('');
}

function wtPosLearn() {
  const p = WT.pos, box = document.getElementById('wtPosBox');
  if (p.i >= p.list.length) {
    box.innerHTML = `<div class="empty"><div class="e-ic">📖</div>背诵学习完成！共过了 <b>${p.list.length}</b> 条词形转换链
      <div style="margin-top:14px"><button class="btn primary-sm" id="wpAgain">🔄 再背一轮</button>
      <button class="btn ghost" id="wpToJudge" style="margin-left:8px">🏷 去词性判断 →</button></div></div>`;
    document.getElementById('wpAgain').onclick = wtPosStart;
    document.getElementById('wpToJudge').onclick = () => { WT.pos.mode = 'judge'; document.querySelectorAll('[data-posmode]').forEach((x) => x.className = 'btn ' + (x.dataset.posmode === 'judge' ? 'primary-sm' : 'ghost')); wtPosStart(); };
    return;
  }
  const ch = p.list[p.i];
  const words = [ch.base].concat(ch.targets.map((t) => t.word));
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(p.i / p.list.length * 100)}%"></i><span>第 ${p.i + 1} / ${p.list.length} 条</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">📖 背诵学习</div>
      <p class="wq-title">大声跟着读这条词形转换链，每个词都可以点着听</p>
      <div class="pos-chain">${wtPosChainHTML(ch, null)}</div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wpHear">${wtIc('volume')} 整链读一遍</button>
      ${p.i > 0 ? '<button class="btn ghost" id="wpPrev">← 上一条</button>' : ''}
      <button class="btn primary-sm" id="wpNext">${p.i + 1 >= p.list.length ? '背完了 ✅' : '下一条 →'}</button>
    </div>`;
  document.getElementById('wpHear').onclick = () => speakSeq(words, 'en-US', 0.85);
  box.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => speak(b.dataset.say));
  const prev = document.getElementById('wpPrev');
  if (prev) prev.onclick = () => { p.i--; wtPosLearn(); };
  document.getElementById('wpNext').onclick = () => { p.i++; wtPosLearn(); };
  wtLater(() => speakSeq(words, 'en-US', 0.85), 350);  // 进入自动示范整链
}

/* ---------------- ✍️ 词形默写：转换链挖空 ---------------- */
function wtPosDict() {
  const p = WT.pos, box = document.getElementById('wtPosBox');
  if (p.i >= p.list.length) {
    box.innerHTML = `<div class="empty"><div class="e-ic">🎉</div>词形默写完成！填对 <b class="g">${p.right}</b> 个 · 订正 <b class="r">${p.wrong}</b> 个
      <div style="margin-top:14px"><button class="btn primary-sm" id="wpAgain">🔄 再默一轮</button></div></div>`;
    document.getElementById('wpAgain').onclick = wtPosStart;
    return;
  }
  const ch = p.list[p.i];
  if (p.ti === undefined || p.tiChain !== p.i) { p.ti = 0; p.tiChain = p.i; }  // 当前链填到第几个空
  const cur = ch.targets[p.ti];
  if (!cur) {  // 本条链全部填完 → 下一条
    p.i++; p.ti = undefined; return wtPosDict();
  }
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(p.i / p.list.length * 100)}%"></i><span>第 ${p.i + 1} / ${p.list.length} 条 · 第 ${p.ti + 1} / ${ch.targets.length} 空</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">✍️ 词形默写</div>
      <p class="wq-title">在括号里的中文提示下，敲出对应的词形变换</p>
      <div class="pos-chain">${wtPosChainHTML(ch, p.ti)}</div>
      ${cur.affix ? `<div class="wq-note">💡 ${esc(cur.affix)}</div>` : ''}
      <input class="input wt-input" id="wpInput" placeholder="敲出英文，回车提交" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="wq-feedback" id="wpFb"></div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wpSay">${wtIc('volume')} 听原词</button>
      <button class="btn primary-sm" id="wpOk">提交</button>
    </div>`;
  const input = document.getElementById('wpInput');
  input.focus();
  input.onkeydown = (e) => { if (e.key === 'Enter') wtPosDictSubmit(); };
  document.getElementById('wpOk').onclick = () => wtPosDictSubmit();
  document.getElementById('wpSay').onclick = () => speak(ch.base);
  wtLater(() => speak(ch.base), 250);
}

function wtPosDictSubmit() {
  const p = WT.pos, ch = p.list[p.i], cur = ch.targets[p.ti];
  const fb = document.getElementById('wpFb');
  const input = document.getElementById('wpInput');
  if (input) input.disabled = true;
  const val = String(input.value || '').trim().toLowerCase();
  const right = val === String(cur.word).trim().toLowerCase();
  wtRecord('pos', right, cur.id);
  if (right) {
    p.right++;
    fb.innerHTML = '<span class="g">✅ 填对了！</span>';
    const blank = document.getElementById('wpBlank');
    if (blank) { blank.textContent = cur.word; blank.classList.add('g'); }
    speak(cur.word);
    wtLater(() => { p.ti++; wtPosDict(); }, 700);
  } else {
    p.wrong++;
    fb.innerHTML = `<span class="r">❌ 正确答案：<b>${esc(cur.word)}</b>${cur.meaning ? '（' + esc(cur.meaning) + '）' : ''}</span>`;
    const blank = document.getElementById('wpBlank');
    if (blank) { blank.textContent = cur.word; blank.classList.add('r'); }
    speak(cur.word);
    // 错的空排到本条链的队尾再考一次（本条链内循环，直到填对）
    ch.targets.push(cur);
    wtLater(() => { p.ti++; wtPosDict(); }, 1600);
  }
}

/* ---------------- 🏷 词性判断（给词选词性，保留原样） ---------------- */
function wtPosQ() {
  const p = WT.pos, box = document.getElementById('wtPosBox');
  if (p.i >= p.list.length) {
    box.innerHTML = `<div class="empty"><div class="e-ic">🎉</div>本轮 10 题完成！答对 <b class="g">${p.right}</b> · 答错 <b class="r">${p.wrong}</b>
      <div style="margin-top:14px"><button class="btn primary-sm" id="wpAgain">🔄 再来一轮</button>
      <button class="btn ghost" id="wpToDict" style="margin-left:8px">✍️ 去词形默写 →</button></div></div>`;
    document.getElementById('wpAgain').onclick = wtPosStart;
    document.getElementById('wpToDict').onclick = () => { WT.pos.mode = 'dict'; document.querySelectorAll('[data-posmode]').forEach((x) => x.className = 'btn ' + (x.dataset.posmode === 'dict' ? 'primary-sm' : 'ghost')); wtPosStart(); };
    return;
  }
  const q = p.list[p.i];
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(p.i / p.list.length * 100)}%"></i><span>第 ${p.i + 1} / ${p.list.length} 题</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">词性判断</div>
      <p class="wq-title">${q.title}</p>
      <div class="wq-word big">${esc(q.word)} <button class="wq-spk" id="wpSpk">${wtIc('volume')}</button></div>
      ${q.note ? `<div class="wq-note">${esc(q.note)}</div>` : ''}
      <div class="wt-options">${q.options.map((o, i) => `<button class="wt-opt" data-o="${i}">${esc(o)}</button>`).join('')}</div>
      <div class="wq-feedback" id="wpFb"></div>
    </div>`;
  document.getElementById('wpSpk').onclick = () => speak(q.word);
  box.querySelectorAll('.wt-opt').forEach((b) => b.onclick = () => {
    const val = q.options[Number(b.dataset.o)];
    const right = val === q.answer;
    wtRecord('pos', right, q.id);
    if (right) p.right++; else p.wrong++;
    box.querySelectorAll('.wt-opt').forEach((x) => {
      x.disabled = true;
      if (x.textContent === q.answer) x.classList.add('ok');
      else if (x === b) x.classList.add('no');
    });
    document.getElementById('wpFb').innerHTML = right ? '<span class="g">✅ 答对了！</span>' : `<span class="r">❌ 正确答案：<b>${esc(q.answer)}</b></span>`;
    wtLater(() => { p.i++; wtPosQ(); }, right ? 600 : 1500);
  });
}

/* ------------------------------------------------------------ 3. 课文朗读
 * 句子卡片：英文 + 中文，右侧喇叭点读，可调倍速、全文连读。与连词成句共用句子库。
 */
async function viewWordsContext() {
  return wtShell('context', {
    html: `<div class="card rd-narrow" data-rdsize="${wtReadSizeGet()}"><div id="rdBox"></div></div>`,
    after: () => wtReadStart(),
  });
}

/** 课文朗读的字号档：小 / 中（默认）/ 大；「大」≈ 考纲单词的学习框（980px 宽 + 大字），localStorage 记住 */
function wtReadSizeKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_rd_size:' + (u.id || u.username || 'me');
}
function wtReadSizeGet() { try { return localStorage.getItem(wtReadSizeKey()) || 'mid'; } catch (e) { return 'mid'; } }
function wtReadSizeSet(v) { try { localStorage.setItem(wtReadSizeKey(), v); } catch (e) { /* 忽略 */ } }

/** 当前分组筛选下的句子列表 */
function wtReadList() {
  const all = WT.data.sentences || [];
  return WT.readGrp ? all.filter((x) => String(x.grp || '').trim() === WT.readGrp) : all;
}

function wtReadStart() {
  const box = document.getElementById('rdBox');
  const list = wtReadList();
  WT.read = { list, playing: false, idx: -1 };
  if (!list.length) {
    const all = WT.data.sentences || [];
    box.innerHTML = `<div class="empty"><div class="e-ic">${wtIc('book')}</div>${all.length && WT.readGrp ? '当前分组下没有句子' : '句子库还是空的'}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="rd-toolbar">
      <span class="rd-title">${wtIc('book')} 课文朗读</span>
      <div class="rd-tools">
        <span class="rd-sizes" id="rdSizes">
          ${[['small', '小'], ['mid', '中'], ['big', '大']].map(([v, t]) => `<button data-rdsize="${v}" class="${wtReadSizeGet() === v ? 'on' : ''}">${t}</button>`).join('')}
        </span>
        <label class="rd-rate-lb">倍速
          <select id="rdRate" class="rd-rate">
            ${['0.5', '0.75', '1', '1.25', '1.5', '2'].map((r) => `<option value="${r}" ${String(WT_TTS_RATE) === r ? 'selected' : ''}>${r}x</option>`).join('')}
          </select>
        </label>
        <button class="btn primary-sm" id="rdAll">${wtIc('play')} 全文朗读</button>
      </div>
    </div>
    <div class="rd-list">${list.map((sn, i) => `
      <div class="rd-card" data-i="${i}">
        <div class="rd-txt">
          <p class="rd-en">${esc(sn.text)}</p>
          ${sn.translation ? `<p class="rd-cn">${esc(sn.translation)}</p>` : ''}
        </div>
        <button class="rd-spk" data-rdspk="${i}" title="听这句">${wtIc('volume')}</button>
      </div>`).join('')}</div>`;

  document.getElementById('rdRate').onchange = (e) => {
    WT_TTS_RATE = Number(e.target.value) || 1;
  };
  // 小 / 中 / 大：只换外层 data-rdsize（CSS 统一放大卡片 + 字号），不重渲染、不打断朗读
  const sizes = document.getElementById('rdSizes');
  if (sizes) sizes.querySelectorAll('[data-rdsize]').forEach((b) => b.onclick = () => {
    const v = b.dataset.rdsize;
    wtReadSizeSet(v);
    const wrap = document.querySelector('.rd-narrow');
    if (wrap) wrap.dataset.rdsize = v;
    sizes.querySelectorAll('[data-rdsize]').forEach((x) => x.classList.toggle('on', x.dataset.rdsize === v));
  });
  box.querySelectorAll('[data-rdspk]').forEach((btn) => btn.onclick = () => {
    const sn = WT.read.list[Number(btn.dataset.rdspk)];
    if (!sn) return;
    if (WT.read.playing) wtReadToggle();     // 连读中点单句 → 先停连读
    wtReadMark(-1);
    speak(sn.text);
  });
  document.getElementById('rdAll').onclick = wtReadToggle;
}

/** 高亮正在朗读的卡片并滚动到可视区 */
function wtReadMark(i) {
  document.querySelectorAll('.rd-card.playing').forEach((el) => el.classList.remove('playing'));
  if (i < 0) return;
  const card = document.querySelector(`.rd-card[data-i="${i}"]`);
  if (card) { card.classList.add('playing'); try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 老浏览器忽略 */ } }
}

/** 朗读一句（浏览器语音），结束后调 onend */
function wtSpeakThen(text, onend) {
  const tag = WT_TTS_TAG;
  let fin = false;
  const once = () => { if (fin) return; fin = true; if (tag === WT_TTS_TAG) onend(); };
  wtPlayAudio(text, 'en-US', once, 0.95 * (WT_TTS_RATE || 1));
  wtLater(once, Math.max(8000, String(text || '').length * 220) + 2000);
}

/** 全文朗读 / 停止 */
function wtReadToggle() {
  const r = WT.read, btn = document.getElementById('rdAll');
  if (!r || !r.list.length) return;
  if (r.playing) {   // 停止
    r.playing = false; r.idx = -1;
    wtStopSpeech(); wtReadMark(-1);
    if (btn) btn.innerHTML = `${wtIc('play')} 全文朗读`;
    return;
  }
  r.playing = true; r.idx = -1;
  if (btn) btn.innerHTML = `${wtIc('stop')} 停止朗读`;
  const tag = WT_TTS_TAG;
  const next = () => {
    if (!r.playing || tag !== WT_TTS_TAG) return;
    r.idx++;
    if (r.idx >= r.list.length) {   // 播完一轮
      r.playing = false; wtReadMark(-1);
      if (btn) btn.innerHTML = `${wtIc('play')} 全文朗读`;
      return;
    }
    wtReadMark(r.idx);
    wtSpeakThen(r.list[r.idx].text, next);
  };
  next();
}

/* ------------------------------------------------------------ 4. 连词成句 */
async function viewWordsBuild() {
  return wtShell('build', {
    html: `<div class="card"><div id="wtBuildBox"></div></div>`,
    after: () => wtBuildStart(),
  });
}

function wtBuildStart(custom) {
  const box = document.getElementById('wtBuildBox');
  const drill = Array.isArray(custom) ? custom : (WT_WRONG_DRILL || null);
  WT_WRONG_DRILL = null;  // 一次性消费
  const all = WT.data.sentences || [];
  const sents = drill || (WT.readGrp ? all.filter((x) => String(x.grp || '').trim() === WT.readGrp) : all);
  if (!sents.length) { box.innerHTML = `<div class="empty"><div class="e-ic">🧩</div>${all.length && WT.readGrp ? '当前分组下没有句子：点上方「全部」或换一个分组' : '句子库还是空的：让老师上传「句子 / 翻译」表格，连词成句就能开练'}</div>`; return; }
  Object.assign(WT.build, { i: 0, right: 0, wrong: 0, picked: [], done: false, fromWrong: !!drill });
  WT.build.list = shuffle(sents).slice(0, drill ? drill.length : 10);
  wtBuildQ();
}

function wtBuildQ() {
  const b = WT.build, box = document.getElementById('wtBuildBox');
  if (b.i >= b.list.length) {
    wtRdGrpMark(b.list, 'build');   // 本轮练完 → 句子所属课文分组变绿
    const left = b.fromWrong ? wtWrongList().length : null;
    box.innerHTML = `<div class="empty"><div class="e-ic">🎉</div>${b.fromWrong ? `错句重练完成！本轮拼对 <b class="g">${b.right}</b> · 拼错 <b class="r">${b.wrong}</b>${left ? `，错句本还剩 <b>${left}</b> 句` : '，错句本已清空 🎊'}` : `本轮 10 句完成！拼对 <b class="g">${b.right}</b> · 拼错 <b class="r">${b.wrong}</b>`}
      <div style="margin-top:14px"><button class="btn primary-sm" id="wbAgain">🔄 再来一轮</button></div></div>`;
    document.getElementById('wbAgain').onclick = () => wtBuildStart(b.fromWrong ? wtWrongList().map((x) => ({ id: x.id, text: x.text, translation: x.translation })) : undefined);
    return;
  }
  const s = b.list[b.i];
  b.picked = [];
  b.pool = s.text.split(/\s+/).map((t, i) => ({ t, i }));
  b.shuffled = shuffle(b.pool);
  renderBuild();
}

function renderBuild() {
  const b = WT.build, s = b.list[b.i], box = document.getElementById('wtBuildBox');
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(b.i / b.list.length * 100)}%"></i><span>第 ${b.i + 1} / ${b.list.length} 句</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">连词成句</div>
      <p class="wq-title">按顺序点击下面的词，拼成完整句子</p>
      ${s.translation ? `<div class="wq-note cn-big">${esc(s.translation)}</div>` : ''}
      <div class="wt-sent" id="wbSent">${b.picked.length ? b.picked.map((x) => `<span class="wt-tile on" data-un="${x.i}">${esc(x.t)}</span>`).join('') : '<span class="wq-hint2">点击下方词块开始组句…</span>'}</div>
      <div class="wt-pool" id="wbPool">${b.shuffled.filter((x) => !b.picked.some((p) => p.i === x.i)).map((x) => `<span class="wt-tile" data-pick="${x.i}">${esc(x.t)}</span>`).join('')}</div>
      <div class="wq-feedback" id="wbFb"></div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wbReset">🔄 重置</button>
      <button class="btn primary-sm" id="wbOk" ${b.picked.length === b.shuffled.length ? '' : 'disabled'}>✅ 提交</button>
    </div>`;
  const norm = (str) => str.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  document.getElementById('wbReset').onclick = () => { b.picked = []; renderBuild(); };
  box.querySelectorAll('[data-pick]').forEach((t) => t.onclick = () => {
    if (b.picked.length >= b.shuffled.length) return;
    const item = b.shuffled.find((x) => x.i === Number(t.dataset.pick));
    b.picked.push(item);
    renderBuild();
  });
  box.querySelectorAll('[data-un]').forEach((t) => t.onclick = () => {
    b.picked = b.picked.filter((x) => x.i !== Number(t.dataset.un));
    renderBuild();
  });
  const ok = document.getElementById('wbOk');
  if (ok) ok.onclick = () => {
    const mine = norm(b.picked.map((x) => x.t).join(' '));
    const right = mine === norm(s.text);
    wtRecord('build', right, s.id);
    if (right) { b.right++; if (b.fromWrong) wtWrongRemove(s.id); }  // 错句重练拼对 → 自动移出错句本
    else { b.wrong++; wtWrongAdd(s, 'build'); }
    document.getElementById('wbFb').innerHTML = right
      ? `<span class="g">✅ 拼对了！${b.fromWrong ? '已移出错句本' : ''}</span>`
      : `<span class="r">❌ 正确语序：<b>${esc(s.text)}</b>（已收进错句本）</span>`;
    speak(s.text);
    wtLater(() => { b.i++; wtBuildQ(); }, right ? 800 : 2000);
  };
}

/* ------------------------------------------------------------ 4b. 听音拼句（听力闯关式）
 * 与连词成句共用句子库与顶部设置（词书 / 单元 / 课文分组 / 统计）。
 * 流程：点「播放」听句子（点击触发保证出声，不被浏览器拦截；界面不显示文字）→
 *   听完自动开始倒计时拼句：短句 15 秒、长句（≥10 词）20 秒，时间到自动交卷；
 *   拼错收进「听音拼句」自己的错句本（与连词成句分开记录、分开重练）。 */
async function viewWordsListen() {
  return wtShell('listen', {
    html: `<div class="card"><div id="wtListenBox"></div></div>`,
    after: () => wtListenStart(),
  });
}

function wtListenStart(custom) {
  const box = document.getElementById('wtListenBox');
  const drill = Array.isArray(custom) ? custom : (WT_WRONG_DRILL || null);
  WT_WRONG_DRILL = null;  // 一次性消费
  const all = WT.data.sentences || [];
  const sents = drill || (WT.readGrp ? all.filter((x) => String(x.grp || '').trim() === WT.readGrp) : all);
  if (!sents.length) { box.innerHTML = `<div class="empty"><div class="e-ic">🎧</div>${all.length && WT.readGrp ? '当前分组下没有句子：点上方「全部」或换一个分组' : '句子库还是空的：让老师上传「句子 / 翻译」表格，听音拼句就能开练'}</div>`; return; }
  if (WT.listen.timer) clearInterval(WT.listen.timer);
  Object.assign(WT.listen, { i: 0, right: 0, wrong: 0, picked: [], done: false, phase: '', fromWrong: !!drill });
  WT.listen.list = shuffle(sents).slice(0, drill ? drill.length : 10);
  wtListenQ();
}

function wtListenClearTimer() {
  if (WT.listen.timer) { clearInterval(WT.listen.timer); WT.listen.timer = null; }
}

/** 播一句（必须由「播放」按钮点击触发，浏览器才允许出声）：
 *  正常播完 → 自动进拼句倒计时；被拦截 / 加载失败 / 快得可疑（<400ms 就"播完"多半没出声）
 *  → 退回待播状态让学生再点一次；25 秒还没播完（服务端卡住）也退回重试。 */
function wtListenPlay(s) {
  const b = WT.listen, t0 = Date.now();
  renderListenWait(true);
  wtLater(() => {          // 服务端卡住兜底：25 秒还没动静就退回手动重试
    if (b.phase !== 'listen' || b.list[b.i] !== s) return;
    renderListenWait(false);
    toast('播放超时了，再点一次试试', 'warn');
  }, 25000);
  wtPlayAudio(s.text, 'en-US', (how) => {
    if (b.phase !== 'listen' || b.list[b.i] !== s) return;
    if (how === 'ended' && Date.now() - t0 > 400) { b.phase = 'do'; renderListen(); wtListenTick(); return; }
    renderListenWait(false);
    toast(how === 'blocked' ? '浏览器拦截了播放，再点一次就好' : '没听到声音？再点一次试试', 'warn');
  });
}

function wtListenQ() {
  const b = WT.listen, box = document.getElementById('wtListenBox');
  wtListenClearTimer();
  if (b.i >= b.list.length) {
    wtRdGrpMark(b.list, 'listen');   // 本轮练完 → 句子所属课文分组变绿
    const left = b.fromWrong ? wtWrongList().length : null;
    box.innerHTML = `<div class="empty"><div class="e-ic">🎉</div>${b.fromWrong ? `错句重练完成！本轮拼对 <b class="g">${b.right}</b> · 拼错 <b class="r">${b.wrong}</b>${left ? `，错句本还剩 <b>${left}</b> 句` : '，错句本已清空 🎊'}` : `本轮完成！拼对 <b class="g">${b.right}</b> · 拼错 <b class="r">${b.wrong}</b>`}
      <div style="margin-top:14px"><button class="btn primary-sm" id="wlAgain">🔄 再来一轮</button></div></div>`;
    document.getElementById('wlAgain').onclick = () => wtListenStart(b.fromWrong ? wtWrongList().map((x) => ({ id: x.id, text: x.text, translation: x.translation })) : undefined);
    return;
  }
  const s = b.list[b.i];
  const words = s.text.split(/\s+/);
  b.picked = [];
  b.pool = words.map((t, i) => ({ t, i }));
  b.shuffled = shuffle(b.pool);
  b.limit = words.length >= 10 ? 20 : 15;   // 长句（≥10 词）多给 5 秒
  b.left = b.limit;
  b.phase = 'listen';
  renderListenWait();
}

/* 听音阶段：点「播放」出声，播放中出动态提示；只有耳机图标，不出句子文字 */
function renderListenWait(playing) {
  const b = WT.listen, box = document.getElementById('wtListenBox');
  if (!box) return;   // 模块已切走（兜底定时器晚到的场景）
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(b.i / b.list.length * 100)}%"></i><span>第 ${b.i + 1} / ${b.list.length} 句</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">听音拼句</div>
      <div class="wl-listen${playing ? ' playing' : ''}">
        <div class="wl-ic">${playing ? '🔊' : '🎧'}</div>
        <p class="wl-t">${playing ? '正在播放，请仔细听...' : '准备好了吗？'}</p>
        <p class="wl-sub">${playing ? '听完自动开始拼句计时' : '点下面的按钮听句子，听完自动开始拼句计时'}</p>
        ${playing ? '' : `<button class="btn primary-lg wl-play" id="wlPlay" type="button">${wtIc('play')} 播 放</button>`}
      </div>
    </div>`;
  const p = document.getElementById('wlPlay');
  if (p) p.onclick = () => wtListenPlay(b.list[b.i]);
}

/* 拼句阶段：倒计时 + 词块（与连词成句同一套交互：点词块加入、点已拼的可收回） */
function renderListen() {
  const b = WT.listen, s = b.list[b.i], box = document.getElementById('wtListenBox');
  box.innerHTML = `
    <div class="wt-prog"><i style="width:${Math.round(b.i / b.list.length * 100)}%"></i><span>第 ${b.i + 1} / ${b.list.length} 句</span></div>
    <div class="wt-card center t13-card">
      <div class="wt-tag">听音拼句</div>
      <div class="wl-count${b.left <= 5 ? ' urgent' : ''}" id="wlCount">⏱ 还剩 <b>${b.left}</b> 秒</div>
      <p class="wq-title">按听到的顺序，点词块拼出句子</p>
      <div class="wt-sent" id="wlSent">${b.picked.length ? b.picked.map((x) => `<span class="wt-tile on" data-un="${x.i}">${esc(x.t)}</span>`).join('') : '<span class="wq-hint2">点下方词块，按听到的顺序拼到这里…</span>'}</div>
      <div class="wt-pool" id="wlPool">${b.shuffled.filter((x) => !b.picked.some((p) => p.i === x.i)).map((x) => `<span class="wt-tile" data-pick="${x.i}">${esc(x.t)}</span>`).join('')}</div>
      <div class="wq-feedback" id="wlFb"></div>
    </div>
    <div class="wt-acts">
      <button class="btn ghost" id="wlReset">🔄 重置</button>
      <button class="btn primary-sm" id="wlOk" ${b.picked.length === b.shuffled.length ? '' : 'disabled'}>✅ 提交</button>
    </div>`;
  document.getElementById('wlReset').onclick = () => { if (b.phase !== 'do') return; b.picked = []; renderListen(); };
  box.querySelectorAll('[data-pick]').forEach((t) => t.onclick = () => {
    if (b.phase !== 'do' || b.picked.length >= b.shuffled.length) return;
    b.picked.push(b.shuffled.find((x) => x.i === Number(t.dataset.pick)));
    renderListen();
  });
  box.querySelectorAll('[data-un]').forEach((t) => t.onclick = () => {
    if (b.phase !== 'do') return;
    b.picked = b.picked.filter((x) => x.i !== Number(t.dataset.un));
    renderListen();
  });
  const ok = document.getElementById('wlOk');
  if (ok) ok.onclick = () => wtListenJudge(false);
}

/** 倒计时（独立于渲染：点词块重渲染不会重启秒表）；到 0 自动交卷 */
function wtListenTick() {
  const b = WT.listen;
  wtListenClearTimer();
  b.timer = setInterval(() => {
    const c = document.getElementById('wlCount');
    if (!c || b.phase !== 'do') { wtListenClearTimer(); return; }
    b.left--;
    if (b.left <= 0) { wtListenClearTimer(); wtListenJudge(true); return; }
    c.className = 'wl-count' + (b.left <= 5 ? ' urgent' : '');
    c.innerHTML = `⏱ 还剩 <b>${b.left}</b> 秒`;
  }, 1000);
}

/** 交卷判分：timeout = 倒计时归零自动交卷（没拼完也算错） */
function wtListenJudge(timeout) {
  const b = WT.listen, s = b.list[b.i];
  if (b.phase !== 'do') return;
  b.phase = 'fb';
  wtListenClearTimer();
  const norm = (str) => str.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const mine = norm(b.picked.map((x) => x.t).join(' '));
  const right = b.picked.length === b.shuffled.length && mine === norm(s.text);
  wtRecord('listen', right, s.id);
  if (right) { b.right++; if (b.fromWrong) wtWrongRemove(s.id); }  // 错句重练拼对 → 自动移出「听音拼句」错句本
  else { b.wrong++; wtWrongAdd(s, 'listen'); }
  const fb = document.getElementById('wlFb');
  if (fb) fb.innerHTML = right
    ? `<span class="g">✅ 拼对了！${b.fromWrong ? '已移出错句本' : ''}</span>`
    : `<span class="r">❌ ${timeout ? '时间到！' : '语序不对：'}正确句子：<b>${esc(s.text)}</b>（已收进听音拼句错句本）</span>`;
  const c = document.getElementById('wlCount');
  if (c) c.innerHTML = '⏱ 时间到';
  speak(s.text);
  wtLater(() => { b.i++; wtListenQ(); }, right ? 800 : 2000);
}

/* ------------------------------------------------------------ 5. 考纲单词（三步流程，一步步来）
 * 考纲词书（管理端「📋 考纲单词」窗口上传）专用，与单词速记的词书互不混用：
 *   ① 学前检测  整本书自动按「每 60 个单词为一个大组」过筛：释义被「纸条」挡住，
 *               点一下「点击核对」亮出中文意思并发音；认不出的点 ➕ 筛成生词（进待学池）；
 *               最后一个小组点「✅ 完成学前检测」，没过到的词自动按「已会」处理；
 *   ② 单词识记  筛出来的生词按学生自选的 5 / 10 个一组分组，一组一组过；
 *               组内是「词卡墙」——点卡片翻出释义 + 例句、可听发音，
 *               看完点「学完了，去学后检测」（底部只留这一个按钮）；
 *   ③ 学后检测  本组词逐题检测，考纲单词只做「识记」型题（看英选义 / 看义选英 / 听音辨义），
 *               不做默写拼写；每个词连认 2 遍（第二遍换一种问法巩固），答错的词排到队尾再认一次。
 * 流程一步步来：学前检测没完成，进不了单词识记；前一步完成才能到下一步。
 * 标记与检测统计按 学生 + 词书 存 localStorage，换词书互不影响。
 */
const SYL_SIZES = [5, 10];
const SYL_STEPS = [
  { k: 'filter', ic: 'search', t: '学前检测' },
  { k: 'learn', ic: 'book', t: '单词识记' },
  { k: 'test', ic: 'edit', t: '学后检测' },
];
/** 学前检测：每 60 个单词为一个大组，组内表格每页 10 条 */
const SYL_FGROUP = 60;
const SYL_FPAGE = 10;
const SYL_SORTS = [['order', '正序'], ['random', '乱序'], ['reverse', '倒序']];
/** 考纲单词只用「识记」型题（认词义 / 认单词 / 听音辨义），不做默写拼写 */
const SYL_TYPES = ['en2cn', 'cn2en', 'listen'];
const SYL_TYPE_NAME = { en2cn: '看英选义', cn2en: '看义选英', listen: '听音辨义' };
/** 每词识记几遍（大量识记：第一遍认识、第二遍换问法再巩固一次） */
const SYL_ROUNDS = 2;
const SYL_FORM_NAME = { mix: '混合识记', en2cn: '看英选义', cn2en: '看义选英', listen: '听音辨义' };

function sylKey() {
  const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || {};
  return 'xuexi_syl:' + (u.id || u.username || 'me') + ':' + WT.bookId;
}
function sylLoad() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(sylKey()) || '{}') || {}; } catch (e) { d = {}; }
  const mark = {};
  if (d.mark && typeof d.mark === 'object') Object.keys(d.mark).forEach((k) => { if (d.mark[k]) mark[k] = 1; });
  const seen = {};
  if (d.seen && typeof d.seen === 'object') Object.keys(d.seen).forEach((k) => { if (d.seen[k]) seen[k] = 1; });
  WT.syl.mark = mark;
  WT.syl.seen = seen;
  WT.syl.fdone = !!d.fdone;
  WT.syl.fg = Number(d.fg) > 0 ? Number(d.fg) : 0;
  WT.syl.size = (d.size === 5 || d.size === 10) ? d.size : 0;
  WT.syl.idx = Number(d.idx) > 0 ? Number(d.idx) : 0;
  WT.syl.sort = ['order', 'random', 'reverse'].includes(d.sort) ? d.sort : 'order';
  WT.syl.rand = Array.isArray(d.rand) ? d.rand : [];
  WT.syl.stat = (d.stat && typeof d.stat === 'object') ? { correct: Number(d.stat.correct) || 0, wrong: Number(d.stat.wrong) || 0 } : { correct: 0, wrong: 0 };
  WT.syl.phase = WT.syl.phase || 'filter';
  WT.syl.reveal = false;
  WT.syl.q = '';
}
function sylSave() {
  try {
    localStorage.setItem(sylKey(), JSON.stringify({
      mark: WT.syl.mark, seen: WT.syl.seen, fdone: WT.syl.fdone, fg: WT.syl.fg,
      size: WT.syl.size, idx: WT.syl.idx,
      sort: WT.syl.sort, rand: WT.syl.rand, stat: WT.syl.stat,
    }));
  } catch (e) { /* 隐私模式忽略 */ }
}
/** 每组几个：学生自己选的 5 / 10；没选过就按学段默认（小学 5 个、初中 10 个） */
function sylSize() { return (WT.syl.size === 5 || WT.syl.size === 10) ? WT.syl.size : wtGroupSize(); }
/** 整本书按当前「正序 / 乱序 / 倒序」排好序的词 */
function sylOrdered() {
  const ws = (WT.data.words || []).slice();
  if (WT.syl.sort === 'reverse') return ws.reverse();
  if (WT.syl.sort === 'random') {
    const ids = ws.map((w) => w.id);
    if (!WT.syl.rand.length || WT.syl.rand.length !== ids.length) newSylRandom();
    const map = new Map(ws.map((w) => [String(w.id), w]));
    const out = WT.syl.rand.map((id) => map.get(String(id))).filter(Boolean);
    return out.length === ws.length ? out : ws;   // 词书换过 / 加了新词 → 兜底用原顺序
  }
  return ws;
}
/** 重新洗一次「乱序」的顺序（点了乱序按钮就重来一次） */
function newSylRandom() {
  WT.syl.rand = shuffle((WT.data.words || []).map((w) => w.id));
  sylSave();
}
/** 要学的词（生词）= 学前检测里点过 ➕ 筛出来的词（核对过且没标「已会」）；
 *  「完成学前检测」时没核对到的词自动按「已会」处理，保证生词池就是学生亲手筛出来的 */
function sylWords() { return sylOrdered().filter((w) => WT.syl.seen[w.id] && !WT.syl.mark[w.id]); }
function sylKnownN() {
  const ids = WT.syl.mark || {};
  return (WT.data.words || []).filter((w) => ids[w.id]).length;
}
function sylCalcGroups() {
  WT.groupDefs = wtChunk(sylWords(), sylSize());
  const first = WT.groupDefs.findIndex((_, i) => !wtGroupDone(i));
  WT.groupIdx = first >= 0 ? first : 0;
}
/** 列表勾选模式下当前显示的词（跟着搜索框走，排好序） */
function sylFilteredWords() {
  const words = sylOrdered();
  const q = String(WT.syl.q || '').trim().toLowerCase();
  if (!q) return words;
  return words.filter((w) => String(w.word || '').toLowerCase().includes(q) || String(w.meaning || '').toLowerCase().includes(q));
}
/** 认识率统计（对齐多多：正确 / 错误 / 正确率）；可传入自定义计数（学后检测结果页用答题计数） */
function sylStatHTML(extra, stat) {
  const st = stat || WT.syl.stat || { correct: 0, wrong: 0 };
  const tot = st.correct + st.wrong;
  const rate = tot ? Math.round(st.correct / tot * 100) : 0;
  return `<span class="syl-stat" id="sylStat">
    <span class="ss">正确: <b class="g">${st.correct}</b></span>
    <span class="ss">错误: <b class="r">${st.wrong}</b></span>
    <span class="ss-rate">正确率: <b>${rate}%</b></span>
    <i class="ss-bar"><u style="width:${rate}%"></u></i>
    ${extra || ''}
  </span>`;
}
/** 顶部三段流程条（学前检测 → 单词识记 → 学后检测，前一步没完成下一步是锁着的） */
function wtSylSteps() {
  const cur = SYL_STEPS.findIndex((s) => s.k === WT.syl.phase);
  return `<div class="wt-steps syl-steps">${SYL_STEPS.map((s, i) => {
    // 逐级解锁：学前检测没完成（fdone=false），「单词识记 / 学后检测」都是锁
    const locked = !WT.syl.fdone && i > 0 && !WT.syl.quiz;
    const cls = i === cur ? 'on' : i < cur ? 'past' : locked ? 'lock' : '';
    return `<a class="wt-step ${cls}" data-sylstep="${s.k}"><i>${i < cur ? '✓' : i + 1}</i><span>${wtIc(s.ic)} ${s.t}</span>${locked ? `<em class="wt-step-lock">${wtIc('lock')}</em>` : ''}</a>`;
  }).join('')}</div>`;
}

/* ---------------- 入口 ---------------- */
function viewWordsSyllabus() {
  return wtShell('syllabus', {
    html: '<div class="card"><div id="wtSylBox"></div></div>',
    after: () => {
      sylLoad();
      // 错词本「开始重练」/ 复习中心 → 进学后检测式识记轮（错词本按各自出错的题型出题，认对一个移出一个）
      if (WT.syl.pendingDrill && WT.syl.pendingDrill.length) {
        const words = WT.syl.pendingDrill;
        WT.syl.pendingDrill = null;
        WT.groupDefs = []; WT.groupIdx = -1;   // 重练轮不参与分组变绿
        WT.syl.quiz = sylQuizMake(words, 'mix', 'review', true);
        WT.syl.phase = 'review';
        WT.needPick = false;
        wtStageOn();
        wtSylRender();
        return;
      }
      wtSylRender();
    },
  });
}

function wtSylRender() {
  const box = document.getElementById('wtSylBox');
  if (!box) return;
  wtStopSpeech();
  if (!(WT.data.words || []).length) {
    const other = wtModBooks('syllabus').filter((b) => String(b.id) !== String(WT.bookId) && (b.word_count || 0) > 0);
    box.innerHTML = '<div class="empty"><div class="e-ic">📭</div>这本词书还没有单词，先让老师上传单词表'
      + (other.length ? `<div class="wq-read-tip">其它词书有内容：${other.map((b) => esc(b.title)).join('、')}（用上方下拉切换）</div>` : '')
      + '</div>';
    return;
  }
  if (WT.syl.phase === 'learn') return wtSylLearn();
  if (WT.syl.phase === 'test' || WT.syl.phase === 'review') return wtSylQuizPage();
  return wtSylFilter();
}

/* ---------------- ① 学前检测：每 60 词一大组，纸条核对 + ➕ 筛生词 ---------------- */
function sylCountHTML() {
  const n = (WT.data.words || []).length, k = sylKnownN(), todo = sylWords().length;
  return `共 <b>${n}</b> 词 · 已会 <b class="k">${k}</b> · 生词 <b class="u">${todo}</b>`;
}
/** 学前检测的大组：整本书按 60 个词切一大组 */
function sylFGroups() { return wtChunk(sylOrdered(), SYL_FGROUP); }
/** 组内表格分页条，page 从 0 起 */
function sylFilterPager(page, pages, total) {
  if (pages <= 1) return `<div class="syl-pager"><span>共 ${total} 词</span></div>`;
  const cur = page + 1;
  const nums = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) nums.push(i);
  } else {
    nums.push(1);
    const L = Math.max(2, cur - 1);
    const R = Math.min(pages - 1, cur + 1);
    if (L > 2) nums.push('…');
    for (let i = L; i <= R; i++) nums.push(i);
    if (R < pages - 1) nums.push('…');
    nums.push(pages);
  }
  return `<div class="syl-pager">
    <span>共 ${total} 词</span>
    <button type="button" class="syl-pbtn" data-fpage="${page - 1}" ${page <= 0 ? 'disabled' : ''}>‹</button>
    ${nums.map((n) => (n === '…'
      ? '<span class="syl-pgap">…</span>'
      : `<button type="button" class="syl-pbtn ${n === cur ? 'on' : ''}" data-fpage="${n - 1}">${n}</button>`)).join('')}
    <button type="button" class="syl-pbtn" data-fpage="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>›</button>
  </div>`;
}
function wtSylFilter() {
  const box = document.getElementById('wtSylBox');
  const gs = sylFGroups();
  if (!gs.length) { box.innerHTML = wtSylSteps() + '<div class="empty"><div class="e-ic">📭</div>这本考纲词书还没有单词</div>'; return; }
  WT.syl.fg = Math.max(0, Math.min(WT.syl.fg, gs.length - 1));
  const gi = WT.syl.fg;
  const words = gs[gi];
  const pages = Math.max(1, Math.ceil(words.length / SYL_FPAGE));
  WT.syl.fpage = Math.max(0, Math.min(Number(WT.syl.fpage) || 0, pages - 1));
  const page = WT.syl.fpage;
  const slice = words.slice(page * SYL_FPAGE, page * SYL_FPAGE + SYL_FPAGE);
  const badAll = sylWords().length;
  const fopen = WT.syl.fopen = WT.syl.fopen || {};
  const last = gi >= gs.length - 1;
  box.innerHTML = wtSylSteps() + wtSylBar() + `
    <div class="syl-fbody">
    <div class="syl-fnav">
      <button class="btn ghost" id="sylFPrev" ${gi <= 0 ? 'disabled' : ''}>← 上一大组</button>
      <span class="syl-fnav-t"><b>第 ${gi + 1} / ${gs.length} 大组</b><i class="w-tip" style="margin:0">本组 ${words.length} 词</i></span>
      ${last
        ? `<button class="btn primary-sm" id="sylFDone" ${WT.syl.fdone ? '' : ''}>✅ 完成学前检测，去「单词识记」→</button>`
        : '<button class="btn primary-sm" id="sylFNext">下一大组 →</button>'}
    </div>
    <div class="syl-table-wrap"><table class="syl-table">
      <thead><tr><th>单词</th><th>核对</th><th>中文释义</th><th class="syl-th-act">生词本</th></tr></thead>
      <tbody>${slice.map((w) => {
        const inBook = !!(WT.syl.seen[w.id] && !WT.syl.mark[w.id]);
        const open = !!fopen[w.id];
        return `<tr class="${inBook ? 'in' : ''}">
          <td class="syl-fw">${esc(w.word)}</td>
          <td><button class="syl-slip ${open ? 'open' : ''}" data-fslip="${w.id}">${wtIc('volume')}${open ? '已核对' : '点击核对'}</button></td>
          <td class="syl-fcn ${open ? 'open' : ''}">${open ? esc(w.meaning || '（没写释义）') : '—'}</td>
          <td class="syl-td-act"><button class="syl-fadd ${inBook ? 'on' : ''}" data-fadd="${w.id}">${inBook ? '已在生词本' : '+'}</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    ${sylFilterPager(page, pages, words.length)}
    <div class="syl-fsum">您已经筛选出 <b class="u">${badAll}</b> 个生词（整本书共 ${sylCountHTML()}）</div>
    <div class="syl-fbottom"><button class="btn primary-lg" id="sylFGo">${wtIc('play')} 去单词识记${sylWords().length ? `（${Math.ceil(sylWords().length / sylSize())} 组）` : ''}</button></div>
    </div>`;
  wtSylBindBar();
  wtSylBindFilter(gs, gi, words);
}
function wtSylBindFilter(gs, gi, words) {
  const fopen = WT.syl.fopen = WT.syl.fopen || {};
  const saveStat = () => { sylSave(); wtSylRender(); };
  document.getElementById('sylFPrev').onclick = () => { WT.syl.fg = Math.max(0, gi - 1); WT.syl.fpage = 0; sylSave(); FX.tap(); wtSylRender(); };
  const nx = document.getElementById('sylFNext');
  if (nx) nx.onclick = () => { WT.syl.fg = Math.min(gs.length - 1, gi + 1); WT.syl.fpage = 0; sylSave(); FX.tap(); wtSylRender(); };
  document.querySelectorAll('[data-fpage]').forEach((b) => b.onclick = () => {
    const to = Number(b.dataset.fpage);
    if (!Number.isFinite(to) || b.disabled) return;
    WT.syl.fpage = to;
    wtSylRender();
  });
  const done = document.getElementById('sylFDone');
  if (done) done.onclick = () => {
    // 没核对到的词自动按「已会」处理：生词池 = 学生亲手 ➕ 筛出来的
    (WT.data.words || []).forEach((w) => { if (!WT.syl.seen[w.id]) { WT.syl.seen[w.id] = 1; WT.syl.mark[w.id] = 1; } });
    const bad = sylWords().length;
    WT.syl.stat = { correct: (WT.data.words || []).length - bad, wrong: bad };
    WT.syl.fdone = true;
    sylSave();
    FX.win();
    toast(`学前检测完成：筛出 ${bad} 个生词，自动按 5/10 个一组开始识记`, 'ok');
    WT.syl.phase = 'learn';
    WT.needPick = true;
    wtSylRender();
  };
  document.querySelectorAll('[data-fslip]').forEach((b) => b.onclick = () => {
    const id = String(b.dataset.fslip);
    const w = words.find((x) => String(x.id) === id);
    if (fopen[id]) { delete fopen[id]; wtSylRender(); return; }   // 再点一下重新遮住
    fopen[id] = 1;
    FX.tap();
    wtSylRender();                                  // 先重绘（重绘会停掉在途发音，顺序不能反）
    if (w) wtLater(() => speak(w.word), 40);        // 重绘后再发音：核对 = 亮出中文 + 英语发音
  });
  document.querySelectorAll('[data-fadd]').forEach((b) => b.onclick = () => {
    const id = String(b.dataset.fadd);
    const w = words.find((x) => String(x.id) === id);
    if (!w) return;
    const inBook = !!(WT.syl.seen[w.id] && !WT.syl.mark[w.id]);
    WT.syl.seen[w.id] = 1;
    if (inBook) { WT.syl.mark[w.id] = 1; WT.syl.stat.correct++; FX.correct(); }   // 移出生词本 = 已会
    else { delete WT.syl.mark[w.id]; WT.syl.stat.wrong++; FX.pop(); }             // ➕ 加入生词本 = 不会
    saveStat();
  });
  const fgo = document.getElementById('sylFGo');
  if (fgo) fgo.onclick = () => {
    if (!WT.syl.fdone) {
      // 底部直达：没核对到的词自动按「已会」处理，然后直接进单词识记
      (WT.data.words || []).forEach((w) => { if (!WT.syl.seen[w.id]) { WT.syl.seen[w.id] = 1; WT.syl.mark[w.id] = 1; } });
      const bad = sylWords().length;
      WT.syl.stat = { correct: (WT.data.words || []).length - bad, wrong: bad };
      WT.syl.fdone = true;
      sylSave();
      FX.win();
      toast(`学前检测完成：筛出 ${bad} 个生词，开始单词识记`, 'ok');
    }
    if (!sylWords().length) { toast('没有待学的单词，先把要学的筛出来', 'err'); return; }
    WT.syl.phase = 'learn';
    WT.needPick = true;
    FX.tap();
    sylCalcGroups();
    wtSylRender();
  };
}
function sylSizeHTML() {
  const size = sylSize();
  return `<span class="syl-size">每组 ${SYL_SIZES.map((s) => `<button data-sylsize="${s}" class="${size === s ? 'on' : ''}" title="选 ${s} 个词为一组">${s} 个</button>`).join('')}</span>`;
}
function sylSortHTML() {
  return `<span class="syl-sort">顺序：${SYL_SORTS.map(([k, t]) => `<button data-sylsort="${k}" class="${WT.syl.sort === k ? 'on' : ''}">${t}</button>`).join('')}</span>`;
}
function wtSylBar() {
  const todo = sylWords().length;
  const groups = Math.ceil(todo / sylSize());
  return `<div class="syl-bar">
    ${sylStatHTML()}
    <span class="syl-count" id="sylCount">${sylCountHTML()}</span>
    ${sylSortHTML()}
    ${sylSizeHTML()}
    <button class="btn primary-sm" id="sylGo" ${WT.syl.fdone && todo ? '' : 'disabled'} title="${WT.syl.fdone ? '进入单词识记' : '先点「✅ 完成学前检测」'}">${wtIc('play')} 去单词识记${WT.syl.fdone && todo ? `（${groups} 组）` : ''}</button>
    <button class="btn ghost" id="sylReset">↩ 重头过筛</button>
  </div>`;
}
function wtSylStudyBar() {
  const known = sylKnownN(), todo = sylWords().length;
  const groups = Math.ceil(todo / sylSize());
  return `<div class="syl-bar">
    <span class="syl-count" id="sylCount">待学 <b class="u">${todo}</b> 词 · 已会 <b class="k">${known}</b> · 分成 <b>${groups}</b> 组（每组 ${sylSize()} 个）</span>
    ${sylSizeHTML()}
    <button class="btn ghost" id="sylBackFilter">🔍 回学前检测</button>
    <button class="btn ghost" id="sylReset">↩ 重头过筛</button>
  </div>`;
}
function wtSylBindBar() {
  document.querySelectorAll('[data-sylsize]').forEach((b) => b.onclick = () => {
    WT.syl.size = Number(b.dataset.sylsize) || 0;
    sylSave();
    FX.tap();
    if (WT.syl.phase === 'learn') WT.needPick = true;
    wtSylRender();
  });
  document.querySelectorAll('[data-sylsort]').forEach((b) => b.onclick = () => {
    WT.syl.sort = b.dataset.sylsort;
    if (WT.syl.sort === 'random') newSylRandom(); else sylSave();
    WT.syl.idx = 0;
    WT.syl.fpage = 0;
    FX.tap();
    if (WT.syl.phase === 'learn') WT.needPick = true;
    wtSylRender();
  });
  document.querySelectorAll('[data-sylstep]').forEach((a) => a.onclick = () => {
    const k = a.dataset.sylstep;
    // 流程一步步来：学前检测没完成，后面两步点不开
    if (!WT.syl.fdone && !WT.syl.quiz && k !== 'filter') { toast('先完成「学前检测」，才能进入这一步', 'err'); return; }
    if (k === WT.syl.phase && k !== 'test') return;
    WT.syl.quiz = null;                       // 切阶段：上一轮的答题会话作废
    if (k === 'filter') wtStageOff();
    if (k === 'learn') { WT.needPick = true; wtStageOff(); }
    if (k === 'test') { WT.needPick = false; wtStageOn(); }   // 直接进「学后检测」→ 用当前分组新开一轮
    WT.syl.phase = k;
    FX.tap();
    wtSylRender();
  });
  const go = document.getElementById('sylGo');
  if (go) go.onclick = () => {
    if (!sylWords().length) { toast('没有待学的单词，先把要学的筛出来', 'err'); return; }
    WT.syl.phase = 'learn';
    WT.needPick = true;
    FX.tap();
    sylCalcGroups();
    wtSylRender();
  };
  const bf = document.getElementById('sylBackFilter');
  if (bf) bf.onclick = () => { WT.syl.phase = 'filter'; sylSave(); FX.tap(); wtSylRender(); };
  const rz = document.getElementById('sylReset');
  if (rz) rz.onclick = async () => {
    if (!await elConfirm({ title: '重新筛选', message: '重头过筛会清空所有「生词 / 已会」标记，重新从第一大组开始筛选。确定吗？', okText: '确定' })) return;
    WT.syl.idx = 0; WT.syl.reveal = false; WT.syl.phase = 'filter';
    WT.syl.mark = {}; WT.syl.seen = {}; WT.syl.fdone = false; WT.syl.fg = 0; WT.syl.fpage = 0;
    WT.syl.stat = { correct: 0, wrong: 0 };
    sylSave(); FX.tap(); wtSylRender();
  };
}


/* ---------------- ② 单词识记：分组 → 词卡墙 ---------------- */
function sylBindGroups() {
  const bar = document.getElementById('wtGroups');
  if (!bar) return;
  bar.innerHTML = (WT.groupDefs && WT.groupDefs.length)
    ? `<div class="wt-groups">${WT.groupDefs.map((g, i) => `
        <button class="wt-grp ${wtGroupDone(i) ? 'done' : ''} ${i === WT.groupIdx && !WT.needPick ? 'on' : ''}" data-g="${i}" title="第 ${i + 1} 组，共 ${g.length} 个词">
          <span>第 ${i + 1} 组</span><em>${g.length} 个</em>
        </button>`).join('')}</div>
      <div class="wq-grp-tip">点一个分组开始「单词识记」：组内词卡点一下翻释义、听发音，看完点「学完了 → 学后检测」，检测通过这组就变 <b>绿</b></div>`
    : '';
  bar.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
    WT.groupIdx = Number(b.dataset.g);
    WT.needPick = false;
    WT.syl.learn.open = {};
    FX.tap();
    wtStageOn();
    wtSylRender();
  });
}
function wtSylLearn() {
  const box = document.getElementById('wtSylBox');
  if (!sylWords().length) {
    box.innerHTML = wtSylSteps() + `<div class="empty"><div class="e-ic">🎉</div><b>没有待学的单词了</b>
      <div style="margin-top:8px">这本词书的词你都标成「会」啦</div>
      <div style="margin-top:14px"><button class="btn primary-sm" id="sylReset">↩ 重头过筛</button></div></div>`;
    wtSylBindBar();
    return;
  }
  sylCalcGroups();
  if (!WT.groupDefs || !WT.groupDefs.length) { WT.syl.phase = 'filter'; return wtSylFilter(); }
  box.innerHTML = `
    ${wtSylSteps()}
    ${wtSylStudyBar()}
    <div id="wtGroups"></div>
    <div id="wtSylLearnBox"></div>`;
  wtSylBindBar();
  sylBindGroups();
  const lb = document.getElementById('wtSylLearnBox');
  if (WT.needPick) {
    lb.innerHTML = `<div class="empty wt-pick-hold"><div class="e-ic">${wtIc('list')}</div>点上面任意一个<b>分组</b>开始「单词识记」</div>`;
    return;
  }
  lb.innerHTML = sylCardWall();
  sylBindWall();
}
/** 词卡墙：一张卡一个词，点卡片翻出释义 + 例句；顶部可全显 / 全部读一遍 */
function sylCardWall() {
  const g = (WT.groupDefs || [])[WT.groupIdx] || [];
  const open = WT.syl.learn.open || {};
  const allOpen = g.length > 0 && g.every((w) => open[w.id]);
  return `<div id="sylWall">
    <div class="syl-learn-head">
      <b>${wtIc('book')} 单词识记 · 第 ${WT.groupIdx + 1} 组</b>
      <button class="btn ghost" id="sylOpenAll">${allOpen ? '🙈 收起全部释义' : '👀 全显释义'}</button>
      <button class="btn ghost" id="sylReadAll">${wtIc('volume')} 全部读一遍</button>
    </div>
    <div class="syl-cards">${g.map((w) => `
      <div class="syl-lcard ${open[w.id] ? 'open' : ''}" data-sylcard="${w.id}" tabindex="0">
        <div class="lc-en">${esc(w.word)} <button class="wq-spk" data-sylspk2="${w.id}" title="听发音">${wtIc('volume')}</button></div>
        ${w.phonetic ? `<div class="lc-phon">${esc(w.phonetic)}</div>` : ''}
        <div class="lc-mean">${esc(w.meaning || '（没写释义）')}</div>
        ${w.example ? `<div class="lc-ex">${esc(w.example)}</div>` : ''}
        <div class="lc-mask">点一下看释义</div>
      </div>`).join('')}</div>
    <div class="wt-acts syl-learn-acts">
      <button class="btn primary-lg" id="sylToTest">✅ 学完了，去「学后检测」→</button>
    </div>
  </div>`;
}
function sylBindWall() {
  const g = (WT.groupDefs || [])[WT.groupIdx] || [];
  document.querySelectorAll('[data-sylcard]').forEach((card) => {
    const id = String(card.dataset.sylcard);
    const toggle = () => {
      const open = WT.syl.learn.open = WT.syl.learn.open || {};
      if (open[id]) delete open[id]; else open[id] = 1;
      FX.tap();
      card.classList.toggle('open', !!open[id]);
      const all = document.getElementById('sylOpenAll');
      if (all) all.textContent = g.length && g.every((w) => open[w.id]) ? '🙈 收起全部释义' : '👀 全显释义';
    };
    card.onclick = (e) => { if (e.target.closest('[data-sylspk2]')) return; toggle(); };
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
  document.querySelectorAll('[data-sylspk2]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const w = g.find((x) => String(x.id) === String(b.dataset.sylspk2));
    if (w) speak(w.word);
  });
  const all = document.getElementById('sylOpenAll');
  if (all) all.onclick = () => {
    const open = WT.syl.learn.open = WT.syl.learn.open || {};
    const allOpen = g.length && g.every((w) => open[w.id]);
    g.forEach((w) => { if (allOpen) delete open[w.id]; else open[w.id] = 1; });
    FX.tap();
    const lb = document.getElementById('wtSylLearnBox');
    if (lb) lb.innerHTML = sylCardWall();
    sylBindWall();
  };
  const ra = document.getElementById('sylReadAll');
  if (ra) ra.onclick = () => speakSeq(g.map((w) => w.word), 'en-US', 0.9);
  const tt = document.getElementById('sylToTest');
  if (tt) tt.onclick = () => {
    WT.syl.quiz = sylQuizMake(g.slice(), 'mix', 'test');
    WT.syl.phase = 'test';
    FX.pop();
    wtSylRender();
  };
}

/* ---------------- ③ 答题引擎：学后检测 / 错词重练 ----------------
 * 考纲单词不做默写（不打字、不拼写），全部用「识记」型题大量重复：
 * 每个词连出 2 遍（第二遍换一种问法），答错的词再排到队尾多认一遍。 */
/** 造一轮答题会话。stage: test 学后检测 / review 错词重练（内部标记）；form: mix|en2cn|cn2en|listen
 *  错词重练时词对象可带 _ty（当初出错的题型）→ 第 1 遍按出错的环节出题，第 2 遍换一种问法巩固。 */
function sylQuizMake(list, form, stage, drill) {
  const qs = [];
  for (let r = 0; r < SYL_ROUNDS; r++) {
    list.forEach((w, i) => {
      // 第 2 遍错开一种问法（混合模式下第 1 遍看英选义 / 第 2 遍换成别的），固定形式则重复同一形式
      const failTy = w && w._ty && SYL_TYPE_NAME[w._ty] ? w._ty : '';
      let type;
      if (form !== 'mix') type = form;
      else if (r === 0) type = failTy || SYL_TYPES[i % SYL_TYPES.length];
      else type = failTy ? sylQuizPickType(w, failTy) : SYL_TYPES[(i + r) % SYL_TYPES.length];
      qs.push({ w, type, round: r + 1 });
    });
  }
  return {
    stage, form, drill: !!drill, list: qs, i: 0, right: 0, wrong: 0, bad: [],
    done: false, answered: false, picked: '', fb: '', spoken: null,
  };
}
/** 干扰项：从本词书其它词里挑 3 个（看英选义 / 听音辨义用中文，看义选英用英文） */
function sylQuizOptions(w, type) {
  const useEn = type === 'en2cn' || type === 'listen';
  const key = useEn ? 'meaning' : 'word';
  const right = String(w[key] || (useEn ? '（没写释义）' : w.word));
  const pool = [...new Set((WT.data.words || []).map((x) => String(x[key] || '')).filter((x) => x && x !== right))];
  return shuffle(pick(pool, 3).concat([right]));
}
function wtSylQuizPage() {
  const box = document.getElementById('wtSylBox');
  let s = WT.syl.quiz;
  if (WT.syl.phase === 'test' && !s) {
    // 直接点阶段条进「学后检测」→ 用当前分组的词新开一轮
    if (!WT.groupDefs || !WT.groupDefs.length) { WT.syl.phase = 'learn'; return wtSylLearn(); }
    if (!(WT.groupIdx >= 0)) WT.groupIdx = 0;
    s = WT.syl.quiz = sylQuizMake(((WT.groupDefs || [])[WT.groupIdx] || []).slice(), 'mix', 'test');
  }
  if (!s) { WT.syl.phase = 'learn'; WT.needPick = true; return wtSylLearn(); }
  box.innerHTML = wtSylSteps() + '<div id="sylQuizBox"></div>';
  sylQuizRender();
}
function sylQuizRender() {
  const box = document.getElementById('sylQuizBox');
  if (!box) return;
  const s = WT.syl.quiz;
  wtStopSpeech();
  if (!s) return;
  if (s.done) { box.innerHTML = sylQuizResultHTML(); sylQuizBindResult(); return; }
  const cur = s.list[s.i];
  if (!cur) { s.done = true; return sylQuizRender(); }
  const w = cur.w, type = cur.type;
  const head = s.drill
    ? (WT_DRILL_REVIEW ? '🎯 复习中心 · 学后检测流程' : '📕 错词重练 · 按出错环节')
    : (s.stage === 'test' ? `📝 学后检测 · 第 ${WT.groupIdx + 1} 组` : `🔁 错词重练 · ${SYL_FORM_NAME[s.form] || '混合识记'}`);
  const bar = wtProg(s.i, s.list.length, `${s.i + 1} / ${s.list.length}`);
  const done = s.answered;
  // 识记型题目：看英选义 / 看义选英 / 听音辨义（考纲单词不做默写拼写）
  const opts = sylQuizOptions(w, type);
  s.opts = opts;   // 记在本轮会话里，判定时用同一份
  const showEn = type !== 'listen';
  const qHtml = `
      <div class="syl-round-wrap"><span class="syl-round">${cur.round > 1 ? `🔁 第 ${cur.round} 遍识记 · ${SYL_TYPE_NAME[type] || ''}` : `🆕 第 1 遍识记 · ${SYL_TYPE_NAME[type] || ''}`}</span></div>
      ${showEn
        ? `<div class="wq-word big">${esc(w.word)} <button class="wq-spk" id="sylSpk" title="读一遍">${wtIc('volume')}</button></div>
           ${w.phonetic ? `<div class="wq-phon">${esc(w.phonetic)}</div>` : ''}`
        : `<div class="wq-word big syl-listen"><button class="wq-spk big" id="sylSpk" title="再听一遍">${wtIc('volume')}</button><span>听发音，选出它的意思</span></div>`}
      <p class="wq-title">${type === 'en2cn' ? '它是什么意思？' : type === 'cn2en' ? '下面哪个是它的英文？' : '听到的是哪个词？'}</p>
      ${type === 'cn2en' ? `<div class="wq-mean big">${esc(w.meaning || '（没写释义）')}</div>` : ''}
      <div class="wt-options">${opts.map((o, i) => {
        let cls = '';
        if (done) {
          const right = String((type === 'en2cn' || type === 'listen') ? (w.meaning || '（没写释义）') : w.word);
          if (o === right) cls = 'ok';
          else if (o === s.picked) cls = 'no';
        }
        return `<button class="wt-opt ${cls}" data-o="${i}" ${done ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>
      <div class="wq-feedback" id="sylFb">${s.fb || ''}</div>`;
  box.innerHTML = `${bar}
    <div class="wt-card center syl-quiz-card t13-card">
      <div class="wt-tag">${head}</div>
      ${qHtml}
    </div>`;
  const spk = document.getElementById('sylSpk');
  if (spk) spk.onclick = () => speak(w.word);
  // 识记型题：四个选项里选一个（不做默写拼写）
  if (!done) box.querySelectorAll('.wt-opt').forEach((b) => b.onclick = () => sylQuizChoose(s.opts[Number(b.dataset.o)]));
  if (!done && (type === 'listen' || type === 'en2cn') && s.spoken !== w.id) {
    s.spoken = w.id;
    wtLater(() => { if (!s.answered) speak(w.word); }, 300);
  }
}
/** 记录一道题的结果：答错进错词本并排队再认一遍；复习里答对则移出错词本 */
function sylQuizRecord(right, picked) {
  const s = WT.syl.quiz;
  const cur = s.list[s.i];
  const w = cur.w;
  s.answered = true;
  s.picked = picked || '';
  wtRecord('syllabus', right, w.id);
  if (right) {    s.right++;
    wtSrsReview(w, true);    // 认对 → SM-2 排程（考纲复习中心数据源）
    if (s.stage === 'review') wtWrongWordRemove(w.id);   // 复习答对 → 自动移出错词本
    s.fb = '<span class="g">✅ 答对了！</span>';
  } else {
    s.wrong++;
    s.bad.push(w);
    // 错词本按真实出错环节记录：学后检测答错记「学后检测」，重练再错记「错词重练」；ty 存题型供重练按环节出题
    wtWrongWordAdd(w, s.stage === 'test' ? '学后检测' : '错词重练', { ty: cur.type });
    wtSrsReview(w, false);   // 认错 → SM-2 退回重来
    // 大量识记：错的词排到队尾再认一遍（换个问法），每词最多补一遍，避免死循环
    if (!cur.rtr) s.list.push({ w, type: sylQuizPickType(w, cur.type), round: cur.round + 1, rtr: 1 });
    s.fb = s.stage === 'review'
      ? '<span class="r">❌ 不对哦，正确答案已标绿，这个词继续留在错词本，稍后再认一遍</span>'
      : '<span class="r">❌ 不对哦，正确答案已标绿，这个词已进错词本，稍后再认一遍</span>';
  }
  sylQuizRender();
  if (s.done) return;
  wtLater(() => {
    if (!WT.syl.quiz || WT.syl.quiz !== s) return;
    s.i++; s.answered = false; s.picked = ''; s.fb = ''; s.spoken = null;
    sylQuizRender();
  }, right ? 700 : 1100);
}
/** 补练时换个问法：避开刚错的那种题型 */
function sylQuizPickType(w, avoid) {
  const pool = SYL_TYPES.filter((t) => t !== avoid && !(t === 'cn2en' && !String(w.word || '').trim()));
  return pool[Math.floor(Math.random() * pool.length)] || 'en2cn';
}
function sylQuizChoose(val) {
  const s = WT.syl.quiz;
  const w = s.list[s.i].w;
  const type = s.list[s.i].type;
  const right = String(val) === String((type === 'en2cn' || type === 'listen') ? (w.meaning || '（没写释义）') : w.word);
  sylQuizRecord(right, val);
}
function sylQuizResultHTML() {
  const s = WT.syl.quiz;
  const tot = s.right + s.wrong;
  const rate = tot ? Math.round(s.right / tot * 100) : 0;
  const title = s.drill
    ? (WT_DRILL_REVIEW ? '🎯 复习中心完成（学后检测流程）' : '📕 错词重练完成')
    : s.stage === 'test' ? `📝 第 ${WT.groupIdx + 1} 组 · 学后检测结果` : '🔁 错词重练完成';
  const bads = [];
  s.bad.forEach((w) => { if (!bads.some((x) => String(x.id) === String(w.id))) bads.push(w); });
  return `<div class="wt-card center syl-quiz-card t13-card">
      <div class="wt-tag">${title}</div>
      ${sylStatHTML('', { correct: s.right, wrong: s.wrong })}
      <div class="syl-result-fb">${rate >= 90 ? '🏆 太棒了，这组词掌握得很牢！' : rate >= 70 ? '👍 不错，把下面的错词再念几遍就更稳了' : '💪 刚学完还没记牢很正常，重点看看下面的错词'}</div>
      <div class="syl-round-note">📖 本组每个词都识记了 <b>${SYL_ROUNDS}</b> 遍（只认不写、不用默写），答错的词会自动再多认一遍</div>
      ${bads.length ? `<div class="syl-bad">
        <div class="syl-bad-h">这 ${bads.length} 个词要重点记：</div>
        ${bads.map((w) => `<div class="syl-bad-i"><b>${esc(w.word)}</b>${w.phonetic ? `<i>${esc(w.phonetic)}</i>` : ''}<span>${esc(w.meaning || '')}</span><button class="wq-spk" data-sylspk3="${w.id}">${wtIc('volume')}</button></div>`).join('')}
      </div>` : '<div class="syl-bad none">🎉 全对！这一组没有错词</div>'}
      <div class="wt-acts syl-result-acts">
        ${bads.length ? `<button class="btn ghost" id="sylAgainBad">🔁 再练这 ${bads.length} 个错词</button>` : ''}
        ${s.stage === 'test'
          ? `<button class="btn primary-lg" id="sylNextTest">${wtIc('play')} 下一组「学后检测」→</button>
             <button class="btn ghost" id="sylBackLearn">📖 回单词识记</button>`
          : `<button class="btn primary-lg" id="sylBackLearn2">📖 回单词识记，接着学 →</button>`}
      </div>
    </div>`;
}
function sylQuizBindResult() {
  const s = WT.syl.quiz;
  const bads = [];
  s.bad.forEach((w) => { if (!bads.some((x) => String(x.id) === String(w.id))) bads.push(w); });
  document.querySelectorAll('[data-sylspk3]').forEach((b) => b.onclick = () => {
    const w = bads.find((x) => String(x.id) === String(b.dataset.sylspk3));
    if (w) speak(w.word);
  });
  // 学后检测：整组检测完 → 这组由灰变绿（和单词速记的分组完成一样存到服务端）
  if (s.stage === 'test' && s.list.length && !s.groupMarked) {
    s.groupMarked = true;
    if (bads.length === 0) { wtGroupMark(WT.groupIdx); FX.win(); }
  }
  const ab = document.getElementById('sylAgainBad');
  if (ab) ab.onclick = () => {
    WT.syl.quiz = sylQuizMake(bads.map((w) => ({ id: w.id, word: w.word, phonetic: w.phonetic, meaning: w.meaning })), s.form || 'mix', 'review');
    FX.tap();
    sylQuizRender();
  };
  const nl = document.getElementById('sylBackLearn');
  const nl2 = document.getElementById('sylBackLearn2');
  const backLearn = () => {
    if (bads.length) (WT.groupDefs[WT.groupIdx] || []).forEach((w) => { if (bads.some((x) => String(x.id) === String(w.id))) delete WT.syl.mark[w.id]; });
    WT.syl.quiz = null;
    WT.syl.phase = 'learn';
    WT.needPick = true;
    wtStageOff();
    FX.tap();
    render();
  };
  if (nl) nl.onclick = backLearn;
  if (nl2) nl2.onclick = backLearn;
  const nt = document.getElementById('sylNextTest');
  if (nt) nt.onclick = () => {
    const nxt = (WT.groupDefs || []).findIndex((_, i) => i > WT.groupIdx && !wtGroupDone(i));
    if (nxt < 0) {
      WT.syl.quiz = null; WT.syl.phase = 'learn'; WT.needPick = true; wtStageOff();
      toast('这本书的分组都检测完啦，太棒了！', 'ok');
      render();
      return;
    }
    WT.groupIdx = nxt;
    WT.syl.learn.open = {};
    const g = (WT.groupDefs || [])[nxt] || [];
    WT.syl.quiz = sylQuizMake(g.slice(), 'mix', 'test');
    FX.tap();
    wtSylRender();
  };
}

/* ------------------------------------------------------------ 路由入口 */
/** render() 里 key === 'words' 时调用，arg 是二级目录。
 *  每个模块进入时先恢复「自己上次选的词书 / 单元」，各模块互不串。 */
/* ---------------- 语音基础：字母乐园 / 音标训练 ----------------
 * 内容全部由管理端「训练管理 → 字母乐园 / 音标训练」维护，
 * 学生端只读展示：字母笔顺动图 + 发音 + 示范视频 + 讲义资料；音标拟音 / 要领 / 口型视频 / 示范词 / 训练场。 */
const phUrl = (v) => {
  const s = String(v || '');
  if (!s) return '';
  return s.charAt(0) === '/' ? s : `/api/file?key=${encodeURIComponent(s)}&token=${encodeURIComponent((typeof Auth !== 'undefined' && Auth && Auth.token) || '')}`;
};
/** 发音：后台传了真人音频优先播放，没有就用系统语音 */
function phSpeak(audio, text, lang) {
  const u = phUrl(audio);
  if (u) {
    try {
      const a = new Audio(u);
      a.onend = null;
      a.onerror = () => speak(text, lang || 'en-US');
      const p = a.play();
      if (p && p.catch) p.catch(() => speak(text, lang || 'en-US'));
      return;
    } catch (e) { /* 落到系统语音 */ }
  }
  speak(text, lang || 'en-US');
}
/** 通用弹窗（与错词本同款：点遮罩关闭） */
function phMask(inner, wide) {
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${inner}</div>`;
  document.body.appendChild(mask);
  const close = () => { wtStopSpeech(); mask.remove(); };
  const x = mask.querySelector('.close-x');
  if (x) x.onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  return { mask, close };
}

/* ---------- 字母乐园（一比一复刻原型：字母卡 / 字母歌 / 听选练习 / 配套资料） ---------- */
/** 字母歌 / 系统课播放弹窗：大屏播放器，多条时可 ‹ › 切换（icon 可指定 🎬 系统课） */
function phSongPlayer(songs, idx, icon) {
  const ico = icon || '🎵';
  const show = (i) => {
    const s = songs[(i + songs.length) % songs.length];
    const { mask, close } = phMask(`
      <div class="ph2-mhead"><span class="ph2-mtitle">${ico} ${esc(s.title || '视频')}</span><button class="close-x">&times;</button></div>
      <div class="ph2-mbody">
        ${songs.length > 1 ? `<button class="ph2-arrow prev" id="phSongPrev" title="上一个">‹</button>
        <button class="ph2-arrow next" id="phSongNext" title="下一个">›</button>` : ''}
        <div class="ph2-video" style="max-width:760px;margin:0 auto"><video controls playsinline autoplay preload="metadata" src="${esc(phUrl(s.file))}"></video></div>
        ${songs.length > 1 ? `<p class="ph2-cap">第 ${(i + songs.length) % songs.length + 1} / ${songs.length} 个 · 点两侧箭头切换</p>` : ''}
      </div>`, false);
    mask.querySelector('.modal').classList.add('ph2');
    if (songs.length > 1) {
      mask.querySelector('#phSongPrev').onclick = () => { close(); show(i - 1); };
      mask.querySelector('#phSongNext').onclick = () => { close(); show(i + 1); };
    }
  };
  show(idx);
}
const PHL = {
  view: 'letters',        // letters / song / quiz / materials
  extras: null,           // { song, materials }
  letter: 0,              // 当前弹窗字母下标
  mode: 'card',           // 弹窗内：card 卡片视图 / write 书写视频视图
  quizCur: null, quizAns: 0, quizOk: 0, quizT0: null, quizTimer: null,
};
const PH_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function viewLettersBuild(list) {
  const ex = PHL.extras || { song: null, songs: [], materials: [] };
  const songs = (ex.songs && ex.songs.length) ? ex.songs : (ex.song ? [ex.song] : []);
  const fmtSize = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const cards = list.map((x, i) => {
    const up = (x.title || PH_LETTERS[i] + PH_LETTERS[i].toLowerCase());
    const L = PH_LETTERS[i];
    return `<button class="ph2-card" data-pl="${i}"><b>${esc(L)}</b><span class="small">${esc(L.toLowerCase())}</span></button>`;
  }).join('');
  const mats = (ex.materials || []).map((m) => `
    <div class="ph2-mat">
      <div class="ph2-mat-ic">${/pdf/i.test(m.mime || '') || /\.pdf/i.test(m.file || '') ? '📕' : '📑'}</div>
      <div class="ph2-mat-info"><div class="ph2-mat-name">${esc(m.title || '资料')}</div>
        <div class="ph2-mat-meta">${esc(fmtSize(m.size))} · ${esc(String(m.created_at || '').slice(0, 16))}</div></div>
      <div class="ph2-mat-acts">
        <button class="ph2-mini view" data-pview="${m.id}">查看</button>
        <button class="ph2-mini dl" data-pdl="${m.id}">下载打印</button>
      </div>
    </div>`).join('');
  const quizCells = PH_LETTERS.split('').map((L) => `<button class="ph2-cell" data-pc="${L}">${L}</button>`).join('');
  return `
  <div class="ph2-stage">
    <div class="ph2-view ${PHL.view === 'letters' ? 'active' : ''}" data-pv="letters">
      <div class="ph2-title">点击字母卡片，开始学习吧！</div>
      <div class="ph2-grid">${cards}</div>
    </div>
    <div class="ph2-view ${PHL.view === 'song' ? 'active' : ''}" data-pv="song">
      <div class="ph2-panel"><div class="ph2-phead">🎵 字母歌</div><div id="ph2SongArea">
        ${songs.length ? `<div class="ph2-songgrid">${songs.map((s, i) => `
          <button class="ph2-songcard" data-psongopen="${i}">
            <span class="ph2-songcover">${s.cover ? `<img src="${esc(phUrl(s.cover))}" alt="">` : '<i>🎵</i>'}</span>
            <span class="ph2-songplay">▶</span>
            <span class="ph2-songname">${esc(s.title || ('字母歌 ' + (i + 1)))}</span>
          </button>`).join('')}</div>
          <p class="ph2-cap">点击卡片，跟着视频一起唱吧！</p>`
          : '<div class="ph2-empty">🎵 老师还没有上传字母歌视频，请老师先在管理端上传。</div>'}</div></div>
    </div>
    <div class="ph2-view ${PHL.view === 'quiz' ? 'active' : ''}" data-pv="quiz">
      <div class="ph2-panel">
        <div class="ph2-phead">根据读音选字母</div>
        <div class="ph2-qflex">
          <div class="ph2-qleft">
            <button class="ph2-speaker" id="ph2Speaker" title="播放读音">🔊</button>
            <div class="ph2-qhint">听读音，选出正确的字母（点喇叭可重听）</div>
          </div>
          <div class="ph2-qgrid">${quizCells}</div>
        </div>
        <div class="ph2-qstats">
          <span>学习时长：<b id="ph2Time">00:00</b></span>
          <span>已答题目：<b id="ph2Ans">0</b></span>
          <span>答对题目：<b id="ph2Ok">0</b></span>
        </div>
      </div>
    </div>
    <div class="ph2-view ${PHL.view === 'materials' ? 'active' : ''}" data-pv="materials">
      <div class="ph2-panel"><div class="ph2-phead">📄 配套资料（可在线查看、下载打印）</div>
        ${mats || '<div class="ph2-empty">📄 暂无配套资料，请老师先在管理端上传纸质资料的电子版。</div>'}
      </div>
    </div>
    <div class="ph2-dock">
      <button data-pdock="letters" class="${PHL.view === 'letters' ? 'active' : ''}"><span class="ico">🔤</span>字母卡</button>
      <button data-pdock="song" class="${PHL.view === 'song' ? 'active' : ''}"><span class="ico">🎵</span>字母歌</button>
      <button data-pdock="quiz" class="${PHL.view === 'quiz' ? 'active' : ''}"><span class="ico">🎧</span>听选练习</button>
      <button data-pdock="materials" class="${PHL.view === 'materials' ? 'active' : ''}"><span class="ico">📄</span>配套资料</button>
    </div>
  </div>`;
}

/** 弹窗（卡片视图 / 书写视频视图），一比一原型布局：印刷体 + 四线格书写体 + 黄色两侧箭头 */
function phLetterModal(list, start) {
  const show = (i) => {
    PHL.letter = (i + list.length) % list.length;
    const x = list[PHL.letter];
    const L = PH_LETTERS[PHL.letter] || (x.title || 'A').charAt(0).toUpperCase();
    PHL.mode = 'card';
    const { mask, close } = phMask(`
      <div class="ph2-mhead"><span class="ph2-mtitle">字母卡</span><button class="close-x">&times;</button></div>
      <div class="ph2-mbody">
        <button class="ph2-arrow prev" id="ph2Prev" title="上一个字母">‹</button>
        <button class="ph2-arrow next" id="ph2Next" title="下一个字母">›</button>
        <div class="ph2-minner">
          <div id="ph2CardView">
            <div class="ph2-cols">
              <div class="ph2-col"><div class="ph2-colabel">印刷体</div>
                <div class="ph2-print">${esc(L)} <span class="lc">${esc(L.toLowerCase())}</span></div></div>
              <div class="ph2-col"><div class="ph2-colabel">书写体（四线格）</div>
                <div class="ph2-gif"><img id="ph2Gif" src="${esc(phUrl(x.stroke || ('/img/letters/' + L.toLowerCase() + '.gif')))}" alt="书写笔顺动画"></div></div>
            </div>
            <div class="ph2-funcs">
              <button class="ph2-fbtn listen" id="ph2Listen">🔊 听发音</button>
              <button class="ph2-fbtn write" id="ph2Write">✏️ 学拼读</button>
            </div>
          </div>
          <div id="ph2WriteView" style="display:none">
            <div class="ph2-funcs" style="margin:0 0 6px;justify-content:flex-start">
              <button class="ph2-fbtn back" id="ph2Back">← 返回字母卡</button>
            </div>
            <div id="ph2WriteArea"><div class="ph2-empty">加载中...</div></div>
          </div>
        </div>
      </div>`, false);
    mask.querySelector('.modal').classList.add('ph2');
    mask.querySelector('#ph2Listen').onclick = () => phSpeak(x.audio, L, 'en-US');
    mask.querySelector('#ph2Write').onclick = () => {
      PHL.mode = 'write';
      mask.querySelector('#ph2CardView').style.display = 'none';
      mask.querySelector('#ph2WriteView').style.display = '';
      const area = mask.querySelector('#ph2WriteArea');
      if (x.videoTeach || x.videoMouth) {
        area.innerHTML = `<div class="ph2-video"><video controls playsinline preload="metadata" src="${esc(phUrl(x.videoTeach || x.videoMouth))}"></video>
          <p class="ph2-cap">跟着视频，一起学 ${esc(L)} ${esc(L.toLowerCase())} 的拼读吧！</p></div>`;
      } else {
        area.innerHTML = `<div class="ph2-empty">📹 老师还没有上传「${esc(L)}」的拼读视频，<br>请老师在管理端「训练管理 → 字母乐园」上传。</div>`;
      }
    };
    mask.querySelector('#ph2Back').onclick = () => {
      PHL.mode = 'card';
      mask.querySelector('#ph2WriteView').style.display = 'none';
      const cv = mask.querySelector('#ph2CardView'); cv.style.display = '';
      const v = cv.querySelector('video'); if (v) { try { v.pause(); } catch (e) {} }
    };
    mask.querySelector('#ph2Prev').onclick = () => { close(); show(PHL.letter - 1); };
    mask.querySelector('#ph2Next').onclick = () => { close(); show(PHL.letter + 1); };
    wtLater(() => phSpeak(x.audio, L, 'en-US'), 200);
  };
  show(Number(start) > 0 ? Number(start) : (PHL.letter || 0));
}

/** 听选练习音效（纯音效，WebAudio 现场合成，无需素材）：对=上行叮咚；错=下滑提示音 */
function phSfx(kind) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const tone = (freq, t0, dur, vol) => {
      const osc = ctx.createOscillator(), og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      og.gain.setValueAtTime(vol, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(og); og.connect(g);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    };
    if (kind === 'good') {
      /* 答对：叮-咚 上行双音（660Hz → 880Hz） */
      const t = ctx.currentTime;
      g.gain.setValueAtTime(1, t);
      tone(660, t, 0.16, 0.3);
      tone(880, t + 0.14, 0.24, 0.3);
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 800);
    } else {
      /* 答错：520→230Hz 下滑提示音 */
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(230, ctx.currentTime + 0.45);
      g.gain.setValueAtTime(0.32, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(g);
      osc.start(); osc.stop(ctx.currentTime + 0.52);
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 900);
    }
  } catch (e) { /* 忽略音效失败 */
  }
}

/** 听选练习计时器（进入页面即计时，与原型一致） */
function phQuizTimer() {
  if (PHL.quizTimer) { clearInterval(PHL.quizTimer); PHL.quizTimer = null; }  // 重进视图时清掉旧计时器，避免叠加
  PHL.quizT0 = Date.now();
  PHL.quizTimer = setInterval(() => {
    const s = Math.floor((Date.now() - PHL.quizT0) / 1000);
    const t = document.getElementById('ph2Time');
    if (t) t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}

async function viewLetters() {
  let list = [];
  try { list = (await api('/api/stu/phonics/list?kind=letters')) || []; } catch (e) { list = []; }
  if (list.length) {
    try { PHL.extras = await api('/api/stu/phonics/extras?mod=letters'); } catch (e) { PHL.extras = { song: null, materials: [] }; }
  }
  if (PHL.letter >= list.length) PHL.letter = 0;
  return {
    html: `<div class="card wt-ph-card">${list.length ? viewLettersBuild(list)
      : `<div class="empty"><div class="e-ic">🌱</div>老师还没有配置字母内容，请先在管理端「训练管理 → 字母乐园」里初始化</div>`}</div>`,
    after: () => {
      if (!list.length) return;
      const root = document.querySelector('.ph2-stage');
      if (!root) return;
      /* 底部 dock 切换四个视图（原型同款：字母卡/字母歌/听选练习/配套资料） */
      root.querySelectorAll('[data-pdock]').forEach((b) => b.onclick = () => {
        PHL.view = b.dataset.pdock;
        root.querySelectorAll('[data-pdock]').forEach((x) => x.classList.toggle('active', x === b));
        root.querySelectorAll('.ph2-view').forEach((v) => v.classList.toggle('active', v.dataset.pv === PHL.view));
        if (PHL.view === 'quiz') {
          phQuizTimer();
          setTimeout(() => { if (PHL.view === 'quiz' && !PHL.quizCur && PHL.quizPlay) PHL.quizPlay(); }, 300);  // 进入听选练习自动播发音
        }
      });
      /* 字母歌：点封面卡片弹窗播放（多条可 ‹ › 切换） */
      const songs = (PHL.extras && PHL.extras.songs && PHL.extras.songs.length) ? PHL.extras.songs
        : (PHL.extras && PHL.extras.song ? [PHL.extras.song] : []);
      root.querySelectorAll('[data-psongopen]').forEach((b) => b.onclick = () => phSongPlayer(songs, Number(b.dataset.psongopen) || 0));
      /* 字母卡点开弹窗（传入被点字母的下标） */
      root.querySelectorAll('[data-pl]').forEach((b) => b.onclick = () => phLetterModal(list, Number(b.dataset.pl)));
      /* 听选练习：进页自动播题；答对 good 音效后直接播下一题；答错 oo 音效 + 高亮正确字母，再到下一题 */
      const playPrompt = () => {
        const i = Math.floor(Math.random() * list.length);
        PHL.quizCur = PH_LETTERS[i];
        phSpeak(list[i].audio, PHL.quizCur, 'en-US');
      };
      PHL.quizPlay = playPrompt;
      const sp = document.getElementById('ph2Speaker');
      if (sp) sp.onclick = playPrompt;
      if (PHL.view === 'quiz') setTimeout(() => { if (!PHL.quizCur) playPrompt(); }, 350);
      root.querySelectorAll('[data-pc]').forEach((b) => b.onclick = () => {
        if (!PHL.quizCur) { playPrompt(); return; }
        PHL.quizAns++;
        const cells = root.querySelectorAll('.ph2-cell');
        cells.forEach((c) => c.disabled = true);
        const L = b.dataset.pc;
        const next = () => {
          cells.forEach((c) => { c.classList.remove('correct', 'wrong'); c.disabled = false; });
          PHL.quizCur = null;
          playPrompt();
        };
        if (L === PHL.quizCur) {
          PHL.quizOk++; b.classList.add('correct');
          phSfx('good');                       // 答对：good 音效
          setTimeout(next, 950);               // 直接播下一个发音
        } else {
          b.classList.add('wrong');
          phSfx('oo');                          // 答错：oo 提示音
          setTimeout(() => {                    // 高亮正确字母
            cells.forEach((c) => { if (c.dataset.pc === PHL.quizCur) c.classList.add('correct'); });
            setTimeout(next, 1000);
          }, 550);
        }
        const a = document.getElementById('ph2Ans'), o = document.getElementById('ph2Ok');
        if (a) a.textContent = PHL.quizAns;
        if (o) o.textContent = PHL.quizOk;
      });
      if (PHL.view === 'quiz') phQuizTimer();
      /* 配套资料：查看 / 下载打印 */
      const ex = PHL.extras || { materials: [] };
      const find = (id) => (ex.materials || []).find((m) => String(m.id) === String(id));
      root.querySelectorAll('[data-pview]').forEach((b) => b.onclick = () => {
        const m = find(b.dataset.pview);
        if (m) window.open(phUrl(m.file), '_blank');
      });
      root.querySelectorAll('[data-pdl]').forEach((b) => b.onclick = () => {
        const m = find(b.dataset.pdl);
        if (!m) return;
        /* 直链下载（name → 服务端 Content-Disposition attachment + 自动补扩展名）：
           浏览器原生下载有进度条；文件已上 OSS/CDN，大 PDF 也快。
           不用 fetch blob——整文件缓冲进内存，大 PDF 会一直无反应像"下载不了" */
        toast('开始下载...', 1200);
        const a = document.createElement('a');
        a.href = phUrl(m.file) + '&name=' + encodeURIComponent(m.title || '资料');
        a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      });
    },
  };
}
/* ---------- 音标训练（一比一复刻原型：音标表 / 系统课 / 训练场 / 配套资料） ---------- */
const PHT = { view: 'chart', mode: 'table', extras: null };

/* 发音规则表布局：与原型 48 音标表逐格对应（keys = 数据库 phonics_items.code） */
const IP_LAYOUT = [
  { cat: 'vowel', catSpan: 5, catName: '元音', catEn: 'VOWEL', sub: '单元音', subSpan: 3, label: '前元音', keys: ['i:', 'i', 'e', 'ae'] },
  { label: '中元音', keys: ['e:', 'schwa', 'uh'], padLeft: 1 },
  { label: '后元音', keys: ['u:', 'u', 'aw:', 'o', 'a:'] },
  { sub: '双元音', subSpan: 2, label: '开合双元音', keys: ['ei', 'ai', 'oi', 'au', 'ou'] },
  { label: '集中双元音', keys: ['ia', 'ea', 'ua'] },
  { cat: 'consonant', catSpan: 9, catName: '辅音', catEn: 'CONSONANT', sub: '爆破音', subSpan: 2, label: '清辅音', keys: ['p', 't', 'k'] },
  { label: '浊辅音', keys: ['b', 'd', 'g'] },
  { sub: '摩擦音', subSpan: 2, label: '清辅音', keys: ['f', 's', 'sh', 'th', 'h'] },
  { label: '浊辅音', keys: ['v', 'z', 'zh', 'dh'] },
  { sub: '破擦音', subSpan: 2, label: '清辅音', keys: ['ch', 'tr', 'ts'] },
  { label: '浊辅音', keys: ['dg', 'dr', 'dz'] },
  { sub: '鼻音', label: '浊辅音', keys: ['m', 'n', 'ng'] },
  { sub: '舌则音', label: '浊辅音', keys: ['l', 'r'] },
  { sub: '半元音', label: '浊辅音', keys: ['y', 'w'] },
];
/* 易混音标（原型 data.js 同款） */
const IP_SIMILAR = {
  'i:': ['i', 'e'], 'i': ['i:', 'e'], 'e': ['ae', 'i'], 'ae': ['e', 'uh'],
  'e:': ['schwa', 'aw:'], 'schwa': ['uh', 'e:'], 'uh': ['schwa', 'a:'],
  'u:': ['u', 'ou'], 'u': ['u:', 'aw:'], 'aw:': ['o', 'u:'], 'o': ['aw:', 'uh'], 'a:': ['uh', 'ai'],
  'ei': ['e', 'ai'], 'ai': ['a:', 'ei'], 'oi': ['aw:', 'ai'], 'au': ['ou', 'oi'], 'ou': ['u:', 'au'],
  'ia': ['ea', 'i'], 'ea': ['ia', 'e'], 'ua': ['u', 'aw:'],
  'p': ['b'], 't': ['d'], 'k': ['g'], 'b': ['p'], 'd': ['t'], 'g': ['k'],
  'f': ['v'], 's': ['z'], 'sh': ['zh'], 'th': ['dh'], 'h': [], 'v': ['f'], 'z': ['s'], 'zh': ['sh'], 'dh': ['th'],
  'ch': ['dg'], 'tr': ['dr'], 'ts': ['dz'], 'dg': ['ch'], 'dr': ['tr'], 'dz': ['ts'],
  'm': ['n'], 'n': ['m', 'ng'], 'ng': ['n'], 'l': ['r'], 'r': ['l'], 'y': ['w'], 'w': ['y'],
};
function ipByCode(list) { const m = {}; (list || []).forEach((x) => { if (x.code) m[x.code] = x; }); return m; }
/** 按原型布局顺序排列（未匹配到的排在最后），保证与原型顺序一比一 */
function ipOrdered(list) {
  const m = ipByCode(list); const out = [];
  IP_LAYOUT.forEach((r) => r.keys.forEach((k) => { if (m[k]) { out.push(m[k]); delete m[k]; } }));
  Object.keys(m).forEach((k) => out.push(m[k]));
  return out;
}
function ipAutoSound() { try { return localStorage.getItem('ipa_autosound') !== '0'; } catch (e) { return true; } }
function ipHasVideo(x) { return !!(x.videoMouth || x.videoTeach); }

async function viewPhonetic() {
  let list = [];
  try { list = (await api('/api/stu/phonics/list?kind=phonetic')) || []; } catch (e) { list = []; }
  try { PHT.extras = await api('/api/stu/phonics/extras?mod=phonetic'); } catch (e) { PHT.extras = { songs: [], materials: [] }; }
  try { PHT.courses = (await api('/api/stu/phonics/courses?mod=phonetic')) || []; } catch (e) { PHT.courses = []; }
  PHT.courseOpen = 0;
  try { PHT.mode = localStorage.getItem('ipa_chartmode') === 'cards' ? 'cards' : 'table'; } catch (e) { PHT.mode = 'table'; }
  if (!list.length) {
    return { html: `<div class="card"><div class="empty"><div class="e-ic">🌱</div>老师还没有配置音标内容，请先在管理端「训练管理 → 音标训练」里初始化</div></div>`, after: () => {} };
  }
  const ord = ipOrdered(list);
  const byCode = ipByCode(list);
  let vidN = 0, audN = 0;
  list.forEach((x) => { if (x.videoMouth) vidN++; if (x.videoTeach) vidN++; if (x.audio) audN++; });
  const songs = (PHT.extras.songs && PHT.extras.songs.length) ? PHT.extras.songs : (PHT.extras.song ? [PHT.extras.song] : []);
  const mats = PHT.extras.materials || [];
  const fmtSize = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  /* 发音规则表（表格视图，与原型逐格对应） */
  let tb = '';
  IP_LAYOUT.forEach((r) => {
    tb += '<tr>';
    if (r.cat) tb += `<td class="ip-cat ${r.cat}" rowspan="${r.catSpan}">${r.catName}<span>${r.catEn}</span></td>`;
    if (r.sub) tb += `<td class="ip-sub" rowspan="${r.subSpan || 1}">${esc(r.sub)}</td>`;
    tb += `<td class="ip-label">${esc(r.label)}</td>`;
    for (let i = 0; i < (r.padLeft || 0); i++) tb += '<td class="ip-slot"></td>';
    r.keys.forEach((k) => {
      const x = byCode[k];
      if (!x) { tb += '<td class="ip-slot"></td>'; return; }
      tb += `<td class="ip-slot"><button class="ip-chip" data-type="${x.type}" data-code="${esc(x.code)}" title="${esc((x.groupName || '') + ' ' + x.title + ' · ' + (x.mnemonic || ''))}">${esc(x.title)}${ipHasVideo(x) ? '<i class="dot" title="已配置示范视频"></i>' : ''}</button></td>`;
    });
    const used = (r.padLeft || 0) + r.keys.length;
    for (let j = used; j < 5; j++) tb += '<td class="ip-slot"></td>';
    tb += '</tr>';
  });
  /* 卡片视图 */
  const cardsHTML = ord.map((x) => `<button class="ipa-card" data-type="${x.type}" data-code="${esc(x.code)}" title="${esc((x.groupName || '') + ' · ' + (x.mnemonic || ''))}"><span class="sym">${esc(x.title)}</span><span class="nm">${esc(x.mnemonic || '')}</span>${ipHasVideo(x) ? '<i class="dot" title="已配置示范视频"></i>' : ''}</button>`).join('');

  /* 系统课：课程卡网格（一个框一个框）+ 课程详情（分类导航 + 课时卡片），对应管理端「系统课课程」 */
  const ipUid = () => (((typeof Auth !== 'undefined' && Auth && Auth.user) || {}).id || ((typeof Auth !== 'undefined' && Auth && Auth.user) || {}).username || 'me');
  const ipLearnKey = () => 'xuexi_ipacourse:' + ipUid();
  const ipLearned = () => { try { return JSON.parse(localStorage.getItem(ipLearnKey()) || '{}'); } catch (e) { return {}; } };
  const ipMarkLearned = (cid, iid) => {
    try {
      const m = ipLearned(); const a = m[cid] || (m[cid] = []);
      if (!a.includes(iid)) a.push(iid);
      localStorage.setItem(ipLearnKey(), JSON.stringify(m));
    } catch (e) { /* ignore */ }
  };
  const COURSE_COLORS = [['#1F8C82', '#7ED0C4'], ['#2B4C7E', '#6E8FC4'], ['#B4762F', '#EDC079'], ['#8C4A6B', '#D79CB8'], ['#3F6B4E', '#8CBF9A'], ['#4B4E8C', '#9FA3D6']];
  /* 课程列表网格（image#2 同款：一个框一个框，底部知识点进度 + 进入） */
  const courseGridHTML = () => {
    const cs = PHT.courses || [];
    if (!cs.length) return '<div class="ph2-empty">🎬 老师还没有创建系统课课程，请老师先在管理端「音标训练 → 系统课课程」新建并上传课时视频。</div>';
    const L = ipLearned();
    return `<div class="ip-cgrid">${cs.map((c, i) => {
      const col = COURSE_COLORS[i % COURSE_COLORS.length];
      const n = (c.items || []).length;
      const done = (L[c.id] || []).filter((iid) => (c.items || []).some((it) => Number(it.id) === Number(iid))).length;
      /* 有封面（上传 / AI 生成）就铺封面图，没有就用默认渐变 */
      const img = c.cover ? `<span class="ip-cc-img"><img src="${esc(phUrl(c.cover))}" alt="" loading="lazy"></span>` : '';
      return `<button class="ip-ccard${img ? ' has-img' : ''}" data-pcopen="${c.id}" style="--c1:${col[0]};--c2:${col[1]}">
        ${img}
        <span class="ip-cc-top"><b>${esc(c.title || ('课程 ' + (i + 1)))}</b><span class="ip-cc-badge">系统课</span></span>
        <span class="ip-cc-sub">${esc(c.sub || '系列课程视频，跟学音标发音')}</span>
        <span class="ip-cc-foot">
          <span class="ip-cc-progwrap"><span class="ip-cc-proglabel">知识点进度</span><span class="ip-cc-prog"><i style="width:${n ? Math.round(done / n * 100) : 0}%"></i></span><b>${done} / ${n}</b></span>
          <span class="ip-cc-enter">进入 ›</span>
        </span></button>`;
    }).join('')}</div>`;
  };
  /* 课程详情（image#3 同款：返回条 + 左侧分类导航 + 右侧课时卡片两列） */
  const courseDetailHTML = (c) => {
    const items = c.items || [];
    const L = ipLearned();
    const doneN = (L[c.id] || []).filter((iid) => items.some((it) => Number(it.id) === Number(iid))).length;
    /* 分类导航：按 cate 分组（保序） */
    const cats = [];
    items.forEach((it) => { const k = it.cate || '课时'; if (!cats.includes(k)) cats.push(k); });
    const curCat = PHT.courseCat && cats.includes(PHT.courseCat) ? PHT.courseCat : cats[0];
    const showItems = items.filter((it) => (it.cate || '课时') === curCat);
    const cnt = (k) => items.filter((it) => (it.cate || '课时') === k).length;
    return `
      <div class="ip-cback">
        <button class="ip-cbackbtn" id="ipCBack">‹ 返回</button>
        <div class="ip-cback-t"><b>${esc(c.title || '')}</b><em>${esc(c.sub || '音标系统课')}</em></div>
        ${(c.docs || []).length ? '<button class="ip-cdocs-btn" id="ipCDocs">📄 资料下载</button>' : ''}
        <span class="ip-cprog">进度 <b>${doneN} / ${items.length}</b></span>
      </div>
      <div class="section-label" style="margin-top:16px">知识点</div>
      <div class="ip-cwrap">
        <div class="ip-cate">${cats.map((k) => `
          <button class="ip-cate-btn${k === curCat ? ' active' : ''}" data-pccat="${esc(k)}">${esc(k)}<span>${cnt(k)}</span></button>`).join('')}</div>
        <div class="ip-citems">${showItems.map((it, i) => {
          const learned = (L[c.id] || []).some((x) => Number(x) === Number(it.id));
          /* 配套讲义下载（/api/file 带 token，学生端可直接下载；点讲义不触发播放） */
          const docLinks = (it.docs || []).map((f) => `<a class="ip-ci-doc" href="${esc(phUrl(f.key))}&name=${encodeURIComponent(f.title || '讲义')}" target="_blank">📄 ${esc(f.title || '配套讲义')}</a>`).join('');
          return `<div class="ip-citem" data-pcplay="${it.id}">
            <span class="ip-ci-no">${String(i + 1).padStart(2, '0')}</span>
            <span class="ip-ci-b"><b>${esc(it.title)}</b><em class="${learned ? 'ok' : ''}">${learned ? '✓ 已学' : '未学'}</em>${docLinks ? `<span class="ip-ci-docs">${docLinks}</span>` : ''}</span>
            <span class="ip-ci-play">▶ 播放</span></div>`;
        }).join('') || '<p class="w-tip">该分类下暂无课时</p>'}</div>
      </div>`;
  };
  /* 渲染系统课视图（列表 / 详情），并绑定交互 */
  const renderCourse = () => {
    const box = document.getElementById('ipCourseBox');
    if (!box) return;
    const cs = PHT.courses || [];
    const c = cs.find((x) => Number(x.id) === Number(PHT.courseOpen));
    box.innerHTML = (PHT.courseOpen && c) ? courseDetailHTML(c) : courseGridHTML();
    const back = box.querySelector('#ipCBack');
    if (back) back.onclick = () => { PHT.courseOpen = 0; renderCourse(); };
    /* 课程配套讲义：弹窗列表，每份带下载 */
    const docBtn = box.querySelector('#ipCDocs');
    if (docBtn) docBtn.onclick = () => {
      const docs = c.docs || [];
      const fmt = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
      const { mask, close } = phMask(`
        <div class="ph2-mhead"><span class="ph2-mtitle">📄 ${esc(c.title || '课程')} · 资料下载</span><button class="close-x">&times;</button></div>
        <div class="ph2-mbody"><div class="ip-doclist">${docs.map((f) => `
          <div class="ip-docrow">
            <span class="ip-doc-ic">${/pdf/i.test(f.mime || '') || /\.pdf/i.test(f.key || '') ? '📕' : '📑'}</span>
            <span class="ip-doc-info"><b>${esc(f.title || '配套讲义')}</b><em>${esc(fmt(f.size))}</em></span>
            <a class="ip-doc-dl" href="${esc(phUrl(f.key))}&name=${encodeURIComponent(f.title || '讲义')}" target="_blank">下载</a>
          </div>`).join('')}</div></div>`, false);
      mask.querySelector('.modal').classList.add('ph2');
    };
    box.querySelectorAll('[data-pcopen]').forEach((b) => b.onclick = () => {
      PHT.courseOpen = Number(b.dataset.pcopen); PHT.courseCat = ''; renderCourse();
    });
    box.querySelectorAll('[data-pccat]').forEach((b) => b.onclick = () => {
      PHT.courseCat = b.dataset.pccat; renderCourse();
    });
    box.querySelectorAll('[data-pcplay]').forEach((b) => b.onclick = (e) => {
      /* 点讲义下载链接不触发播放 */
      if (e.target && e.target.closest && e.target.closest('.ip-ci-doc')) return;
      const it = (c.items || []).find((x) => String(x.id) === b.dataset.pcplay);
      if (!it) return;
      ipMarkLearned(c.id, it.id);
      const vids = (c.items || []).filter((x) => x.video).map((x) => ({ file: x.video, title: x.title }));
      const at = Math.max(0, vids.findIndex((v) => v.file === it.video));
      phSongPlayer(vids, at, '🎬');
      /* 播放弹窗关闭后回到详情刷新已学状态 */
      const t = setInterval(() => {
        if (!document.querySelector('.mask')) { clearInterval(t); renderCourse(); }
      }, 800);
    });
  };

  /* 训练场三种玩法（与原型同款入口；每个题型对应管理端独立题库，题库不足自动回退内置出题） */
  const modes = [
    { k: 'find', icon: '🔤', t: '音标侦探', d: '看音标 → 找对应单词', badge: '配对', cls: 'm-match' },
    { k: 'listen', icon: '🎧', t: '听力挑战', d: '听单词发音 → 选正确音标', badge: '听力', cls: 'm-listen' },
    { k: 'sort', icon: '🏷️', t: '分类高手', d: '判断音标是元音还是辅音', badge: '分类', cls: 'm-sort' },
  ];
  const matRows = mats.map((m) => `
    <div class="ph2-mat">
      <div class="ph2-mat-ic">${/pdf/i.test(m.mime || '') || /\.pdf/i.test(m.file || '') ? '📕' : '📑'}</div>
      <div class="ph2-mat-info"><div class="ph2-mat-name">${esc(m.title || '资料')}</div>
        <div class="ph2-mat-meta">${esc(fmtSize(m.size))} · ${esc(String(m.created_at || '').slice(0, 16))}</div></div>
      <div class="ph2-mat-acts">
        <button class="ph2-mini view" data-pview="${m.id}">查看</button>
        <button class="ph2-mini dl" data-pdl="${m.id}">下载打印</button>
      </div>
    </div>`).join('');

  return {
    html: `<div class="card wt-ph-card"><div class="ph2-stage ip-stage">
      <div class="ph2-view ${PHT.view === 'chart' ? 'active' : ''}" data-pv="chart">
        <div class="ip-panel">
          <div class="ip-phead">
            <h2>🔊 发音规则表</h2><span class="ip-desc">点任意音标 → 口型视频 · 教学视频 · 示范词</span>
            <div class="ip-right">
              <div class="ip-seg"><button data-ipmode="table" class="${PHT.mode === 'table' ? 'active' : ''}">表格</button><button data-ipmode="cards" class="${PHT.mode === 'cards' ? 'active' : ''}">卡片</button></div>
              <label class="ip-switch"><input type="checkbox" id="ipAuto" ${ipAutoSound() ? 'checked' : ''}> 打开音标卡自动发音</label>
              <span class="ip-note">已配置 <b>${vidN}</b> / 96 段示范视频 · 发音 <b>${audN}</b> / 48 就绪</span>
            </div>
          </div>
          <div class="ip-pbody">
            <div id="ipTable" class="ip-twrap" style="${PHT.mode === 'table' ? '' : 'display:none'}"><table class="ipa-table"><tbody>${tb}</tbody></table></div>
            <div id="ipCards" class="ip-cards" style="${PHT.mode === 'cards' ? '' : 'display:none'}">${cardsHTML}</div>
            <div class="ip-foot"><span style="display:flex;align-items:center;gap:7px"><i class="ip-dot"></i>已配置视频的音标</span><span>·</span><span>元音按前 / 中 / 后元音与双元音分组，辅音按发音方式与清浊分组</span></div>
          </div>
        </div>
      </div>
      <div class="ph2-view ${PHT.view === 'course' ? 'active' : ''}" data-pv="course">
        <div class="ip-panel">
          <div class="ip-phead"><h2>🎬 音标系统课</h2><span class="ip-desc">系列课程视频，按顺序学习 48 个音标</span></div>
          <div class="ip-pbody" id="ipCourseBox"></div>
        </div>
      </div>
      <div class="ph2-view ${PHT.view === 'practice' ? 'active' : ''}" data-pv="practice">
        <div class="ip-panel">
          <div class="ip-phead"><h2>🎧 音标训练场</h2><span class="ip-desc">答对越多分数越高，连对还有额外加分</span></div>
          <div class="ip-pbody ip-adv">
            <div class="ip-welcome"><h3>👋 欢迎来到音标乐园</h3><p>选一个玩法开始闯关，答对越多分数越高，连对还有额外加分。</p></div>
            <div class="ip-modes">${modes.map((m) => `
              <button class="ip-mode ${m.cls}" data-pmode="${m.k}">
                <span class="ip-mode-ic">${m.icon}</span>
                <span class="ip-mode-b"><b>${m.t}</b><em>${m.d}</em></span>
                <span class="ip-mode-badge">${m.badge}</span></button>`).join('')}</div>
            <p class="ip-tip">先把发音规则表里对应音标的口型视频看完，再回来闯关，正确率会高很多。</p>
          </div>
        </div>
      </div>
      <div class="ph2-view ${PHT.view === 'res' ? 'active' : ''}" data-pv="res">
        <div class="ip-panel">
          <div class="ip-phead"><h2>📄 配套资料</h2><span class="ip-desc">可在线查看、下载打印</span></div>
          <div class="ip-pbody">${matRows || '<div class="ph2-empty">📄 暂无配套资料，请老师先在管理端「音标训练 → 配套资料」上传纸质资料的电子版。</div>'}</div>
        </div>
      </div>
      <div class="ph2-dock">
        <button data-pdock="chart" class="${PHT.view === 'chart' ? 'active' : ''}"><span class="ico">🔤</span>音标表</button>
        <button data-pdock="course" class="${PHT.view === 'course' ? 'active' : ''}"><span class="ico">🎬</span>系统课</button>
        <button data-pdock="practice" class="${PHT.view === 'practice' ? 'active' : ''}"><span class="ico">🎧</span>训练场</button>
        <button data-pdock="res" class="${PHT.view === 'res' ? 'active' : ''}"><span class="ico">📄</span>资料</button>
      </div>
    </div></div>`,
    after: () => {
      const root = document.querySelector('.ip-stage');
      if (!root) return;
      /* 底部 dock 切换四个视图 */
      root.querySelectorAll('[data-pdock]').forEach((b) => b.onclick = () => {
        PHT.view = b.dataset.pdock;
        root.querySelectorAll('[data-pdock]').forEach((x) => x.classList.toggle('active', x === b));
        root.querySelectorAll('.ph2-view').forEach((v) => v.classList.toggle('active', v.dataset.pv === PHT.view));
        if (PHT.view === 'course') renderCourse();
      });
      renderCourse();   // 首次进入也渲染系统课
      /* 表格 / 卡片切换（记住上次选择） */
      root.querySelectorAll('[data-ipmode]').forEach((b) => b.onclick = () => {
        PHT.mode = b.dataset.ipmode;
        try { localStorage.setItem('ipa_chartmode', PHT.mode); } catch (e) {}
        root.querySelectorAll('[data-ipmode]').forEach((x) => x.classList.toggle('active', x === b));
        const t = document.getElementById('ipTable'), c = document.getElementById('ipCards');
        if (t) t.style.display = PHT.mode === 'table' ? '' : 'none';
        if (c) c.style.display = PHT.mode === 'cards' ? '' : 'none';
      });
      /* 自动发音开关（原型同款 localStorage: ipa_autosound） */
      const auto = document.getElementById('ipAuto');
      if (auto) auto.onchange = () => { try { localStorage.setItem('ipa_autosound', auto.checked ? '1' : '0'); } catch (e) {} };
      /* 点音标 → 音标卡弹窗（表格 / 卡片通用） */
      root.querySelectorAll('[data-code]').forEach((b) => b.onclick = () => phIpamodal(ord, b.dataset.code));
      /* 系统课交互由 renderCourse() 负责 */
      /* 训练场：选玩法 */
      root.querySelectorAll('[data-pmode]').forEach((b) => b.onclick = async () => {
        if (b.disabled) return;
        b.disabled = true;
        let bank = [];
        try { bank = (await api('/api/stu/phonics/quiz-list?mode=' + b.dataset.pmode)) || []; } catch (e) { bank = []; }
        b.disabled = false;
        phQuizRun(list, b.dataset.pmode, bank);
      });
      /* 配套资料：查看 / 下载打印（与字母乐园同款） */
      const find = (id) => mats.find((m) => String(m.id) === String(id));
      root.querySelectorAll('[data-pview]').forEach((b) => b.onclick = () => {
        const m = find(b.dataset.pview);
        if (m) window.open(phUrl(m.file), '_blank');
      });
      root.querySelectorAll('[data-pdl]').forEach((b) => b.onclick = () => {
        const m = find(b.dataset.pdl);
        if (!m) return;
        /* 直链下载（与字母乐园同款，勿用 fetch blob——大 PDF 整段缓冲会像卡死） */
        toast('开始下载...', 1200);
        const a = document.createElement('a');
        a.href = phUrl(m.file) + '&name=' + encodeURIComponent(m.title || '资料');
        a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      });
      /* 键盘 ← → 切换音标（弹窗打开时，与原型一致） */
      if (!window.__ipKeyBound) {
        window.__ipKeyBound = true;
        document.addEventListener('keydown', (e) => {
          if (!document.querySelector('.modal.ipm')) return;
          if (e.target && /input|textarea/i.test(e.target.tagName)) return;
          if (e.key === 'ArrowLeft') { const p = document.querySelector('#ipPrev'); if (p) p.click(); }
          if (e.key === 'ArrowRight') { const n = document.querySelector('#ipNext'); if (n) n.click(); }
          if (e.key === 'Escape') { const c = document.querySelector('.modal.ipm .ipm-close'); if (c) c.click(); }
        });
      }
    },
  };
}

/** 音标卡弹窗（一比一原型：muse-box + 口型舌位 + 双视频 + 示范词 + 易混音标 + ‹ › 切换 + 自动发音） */
function phIpamodal(ord, code) {
  let i = ord.findIndex((x) => x.code === code);
  if (i < 0) i = 0;
  const show = (i) => {
    const x = ord[(i + ord.length) % ord.length];
    const hl = (w, h) => {
      if (!h) return esc(w);
      const at = w.toLowerCase().indexOf(String(h).toLowerCase());
      if (at < 0) return esc(w);
      return `${esc(w.slice(0, at))}<b class="hl">${esc(w.slice(at, at + String(h).length))}</b>${esc(w.slice(at + String(h).length))}`;
    };
    const vCell = (src) => src ? `<video controls playsinline preload="metadata" src="${esc(phUrl(src))}"></video>`
      : '<div class="ip-vempty">📽️ 视频待上传<br><small>老师还没有上传该视频</small></div>';
    const sims = (IP_SIMILAR[x.code] || []).map((c) => ord.find((y) => y.code === c)).filter(Boolean);
    const { mask, close } = phMask(`
      <div class="ipm-head"><span class="ipm-title">音标卡 · ${esc(x.title)} ${esc(x.mnemonic || '')}</span>
        <span class="ipm-tags"><span>${x.type === 'vowel' ? '元音' : '辅音'}</span><span>${esc(x.groupName || '')}</span><span>${esc(x.len || x.sub || '')}</span></span>
        <button class="ipm-close">&times;</button></div>
      <div class="ipm-body">
        <button class="ip-arrow prev" id="ipPrev" title="上一个音标">‹</button>
        <button class="ip-arrow next" id="ipNext" title="下一个音标">›</button>
        <div class="card-cols">
          <div class="card-col"><div class="muse-box" id="ipMuse" title="点击听发音">
            <span class="m-play">🔊</span><span class="m-cue">${esc(x.cue || '')}</span>
            <span class="m-sym">${esc(x.title)}</span><span class="m-emoji">${esc(x.emoji || '')}</span>
            <span class="m-name">${esc(x.mnemonic || '')}</span></div></div>
          <div class="card-col"><div class="tip-box"><div class="t-label">口型与舌位</div>
            <p>${esc(x.tip || '暂无发音要领说明')}</p>
            <div class="spell">常见拼写：<b>${esc(x.spell || '—')}</b></div></div></div>
        </div>
        <div class="video-grid">
          <div class="video-cell"><div class="vc-head">👄 口型视频示范</div>${vCell(x.videoMouth)}</div>
          <div class="video-cell"><div class="vc-head">🎵 音标歌 / 教学讲解</div>${vCell(x.videoTeach)}</div>
        </div>
        <div class="section-label">示范词 · 点击朗读（红色为发这个音的字母）</div>
        <div class="word-grid">${(x.samples || []).map((s) => `
          <button class="word-card" data-w="${esc(s.w)}"><span class="wc-play">🔊</span>
            <div class="wc-word">${hl(s.w, s.hl)}</div><div class="wc-ipa">${esc(s.ipa || '')}</div><div class="wc-zh">${esc(s.zh || '')}</div></button>`).join('') || '<p class="w-tip">暂无示范词</p>'}</div>
        ${sims.length ? `<div class="section-label">易混音标</div><div class="sim-row">${sims.map((s) => `
          <button class="sim-chip" data-sim="${esc(s.code)}"><b>${esc(s.title)}</b>${esc(s.mnemonic || '')}</button>`).join('')}</div>` : ''}
      </div>`, true);
    mask.querySelector('.modal').classList.add('ipm');
    mask.querySelector('.ipm-close').onclick = close;   // phMask 只自动绑 .close-x，音标卡头的 × 需手动绑
    const play = () => phSpeak(x.audio, x.title.replace(/[\/ː]/g, ''), 'en-US');
    mask.querySelector('#ipMuse').onclick = play;
    mask.querySelector('#ipPrev').onclick = () => { close(); show(i - 1); };
    mask.querySelector('#ipNext').onclick = () => { close(); show(i + 1); };
    mask.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => {
      phSpeak('', b.dataset.w, 'en-US');
      const ic = b.querySelector('.wc-play');
      if (ic) { ic.textContent = '🔉'; setTimeout(() => { ic.textContent = '🔊'; }, 900); }
    });
    mask.querySelectorAll('[data-sim]').forEach((b) => b.onclick = () => {
      const j = ord.findIndex((y) => y.code === b.dataset.sim);
      close(); if (j >= 0) show(j);
    });
    if (ipAutoSound()) wtLater(play, 220);   // 打开音标卡自动发音
  };
  show(i);
}

/** 训练场：音标侦探 / 听力挑战 / 分类高手，单轮 10 题（每个题型对应管理端独立题库，不足自动回退内置出题） */
function phQuizOpen(list) {
  const modes = [
    { k: 'find', t: '音标侦探', d: '给一个音标，选出含这个音的单词' },
    { k: 'listen', t: '听力挑战', d: '听单词发音，选出它的音标' },
    { k: 'sort', t: '分类高手', d: '判断这个音标是元音还是辅音' },
  ];
  const { mask, close } = phMask(`
    <div class="modal-h"><h3>🎮 训练场</h3><button class="close-x">&times;</button></div>
    <div class="modal-b"><div class="ph-modes">${modes.map((m) => `
      <button class="ph-mode" data-pm="${m.k}"><b>${m.t}</b><span>${m.d}</span></button>`).join('')}</div>
    </div>`, false);
  mask.querySelectorAll('[data-pm]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    let bank = [];
    try { bank = (await api('/api/stu/phonics/quiz-list?mode=' + b.dataset.pm)) || []; } catch (e) { bank = []; }
    close();
    phQuizRun(list, b.dataset.pm, bank);
  });
}
function phQuizRun(list, mode, bank) {
  const withWords = list.filter((x) => (x.samples || []).length);
  if (!list.length || (mode !== 'sort' && !withWords.length)) { toast('这个模块还没有可练习的内容，请先在管理端配置', 'warn'); return; }
  let qs = [];
  /* 优先用后台题库（管理端「训练题库」配置），题库充足时全部从题库出 */
  const bq = (bank || []).filter((x) => x && x.ans && (x.options || []).length >= 2).map((x) => ({
    q: x.q, say: x.say || '', sayText: x.sayText || '', opts: shuffle(x.options.slice()), ans: x.ans,
  }));
  if (bq.length >= 4) {
    qs = shuffle(bq).slice(0, 10);
  } else {
    for (let i = 0; i < 10; i++) {
      if (mode === 'sort') {
        const x = list[Math.floor(Math.random() * list.length)];
        const opts = shuffle(['元音', '辅音']);
        qs.push({ q: `${x.title} 是元音还是辅音？`, say: x.audio, sayText: x.title.replace(/[\/ː]/g, ''), opts, ans: x.type === 'vowel' ? '元音' : '辅音' });
      } else if (mode === 'find') {
        const x = withWords[Math.floor(Math.random() * withWords.length)];
        const right = x.samples[Math.floor(Math.random() * x.samples.length)];
        const wrong = pick(withWords.filter((y) => y !== x).map((y) => y.samples).flat().filter((s) => s.w !== right.w), 3);
        if (wrong.length < 3) continue;
        qs.push({ q: `哪个单词里有 ${x.title}？`, say: '', sayText: '', opts: shuffle([right.w, ...wrong.map((s) => s.w)]), ans: right.w });
      } else {
        const x = withWords[Math.floor(Math.random() * withWords.length)];
        const right = x.samples[Math.floor(Math.random() * x.samples.length)];
        const wrong = pick(withWords.filter((y) => y !== x), 3);
        if (wrong.length < 3) continue;
        qs.push({ q: `听发音，选出你听到的音标`, say: '', sayText: right.w, opts: shuffle([x.title, ...wrong.map((y) => y.title)]), ans: x.title });
      }
    }
  }
  if (!qs.length) { toast(mode === 'sort' ? '题目不足' : '题库题目不足，请老师在管理端「训练题库」添加，或给音标配示范词', 'warn'); return; }
  let i = 0, right = 0;
  const wrongs = [];
  const render = () => {
    if (i >= qs.length) {
      box.innerHTML = `<div class="empty"><div class="e-ic">${right >= 8 ? '🏆' : '👍'}</div>
        <b>本轮 ${qs.length} 题，答对 ${right} 题</b>
        <div style="margin-top:10px">${wrongs.length ? `<div class="ph-wrong"><div class="ph-res-t">错题回顾</div>${wrongs.map((w) => `<div class="ph-wrong-item">${esc(w.q)}　正确答案：<b>${esc(w.ans)}</b></div>`).join('')}</div>` : '全对，太棒了！'}</div>
        <div style="margin-top:14px"><button class="btn primary-sm" id="phQAgain">🔁 再来一轮</button></div></div>`;
      const ag = document.getElementById('phQAgain');
      if (ag) ag.onclick = () => { close(); phQuizRun(list, mode, bank); };
      return;
    }
    const q = qs[i];
    box.innerHTML = `
      <div class="ph-q-head">第 ${i + 1} / ${qs.length} 题　答对 ${right} 题</div>
      <div class="ph-q">${esc(q.q)}</div>
      ${(q.sayText || q.say) ? `<div class="ph-q-say"><button class="ph-saybtn" id="phQPlay" title="点击听发音"><span>🔊</span></button></div>` : ''}
      <div class="ph-q-opts">${q.opts.map((o) => `<button class="ph-q-opt" data-po="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <div class="ph-q-fb" id="phQFb"></div>`;
    const pl = document.getElementById('phQPlay');
    if (pl) pl.onclick = () => phSpeak(q.say, q.sayText, 'en-US');
    if (q.sayText || q.say) wtLater(() => phSpeak(q.say, q.sayText, 'en-US'), 300);
    box.querySelectorAll('[data-po]').forEach((b) => b.onclick = () => {
      const val = b.dataset.po;
      const okk = String(val) === String(q.ans);
      if (okk) { right++; b.classList.add('ok'); } else { b.classList.add('bad'); wrongs.push(q); box.querySelectorAll('[data-po]').forEach((x2) => { if (String(x2.dataset.po) === String(q.ans)) x2.classList.add('ok'); }); }
      const fb = document.getElementById('phQFb');
      if (fb) fb.innerHTML = okk ? '<span class="g">✅ 答对了</span>' : `<span class="r">❌ 正确答案：${esc(q.ans)}</span>`;
      box.querySelectorAll('[data-po]').forEach((x2) => { x2.disabled = true; });
      wtLater(() => { i++; render(); }, 900);
    });
  };
  const { mask, close } = phMask(`
    <div class="modal-h"><h3>🎮 ${mode === 'find' ? '音标侦探' : mode === 'listen' ? '听力挑战' : '分类高手'}</h3><button class="close-x">&times;</button></div>
    <div class="modal-b"><div id="phQuizBox"></div></div>`, false);
  const box = mask.querySelector('#phQuizBox');
  render();
}

async function viewWords(arg) {
  const sub = arg || 'quick';
  wtSubStateSync();  // SPA 登录后身份才就绪：进入前核对一遍，恢复「自己上次选的词书 / 单元」
  const st = WT.subState[sub] || {};
  WT.bookId = st.book || '';
  WT.unit = st.unit || '';
  if (sub === 'letters') return viewLetters();
  if (sub === 'phonetic') return viewPhonetic();
  if (sub === 'pos') return viewWordsPos();
  if (sub === 'phrase') return viewWordsPhrase();
  if (sub === 'context') return viewWordsContext();
  if (sub === 'build') return viewWordsBuild();
  if (sub === 'listen') return viewWordsListen();
  // 考纲单词不按单元划分：整本书一把筛（单元概念在这里不适用）
  if (sub === 'syllabus') { WT.unit = ''; return viewWordsSyllabus(); }
  if (sub === 'typing') return wtAppFrame('typing');
  return viewWordsQuick();
}
