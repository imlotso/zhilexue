'use strict';
/**
 * 初始化数据：校长账号、示例课程目录、示例知识点（视频 + 讲义）与习题库、示例学生
 * 运行： npm run seed
 *
 * 说明：示例讲义 / 习题用可在线预览与打印的 HTML 生成，方便开箱即看；
 *       正式使用时在后台「讲义与习题」里替换成自己的 PDF / Word 即可。
 */
const { db } = require('./db');
const { hash } = require('./auth');
const store = require('./storage');

const now = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ---------- 每科统一的课程分类（4 大类；专项提升 / 中考冲刺按「学段」区分小学、初中） ----------
const CATEGORIES = ['同步基础', '同步培优', '专项提升', '中考冲刺'];
const SUBJECTS = ['数学', '英语', '物理', '化学'];

/** 老的分类名统一迁移到新分类 */
const CATEGORY_RENAME = {
  '同步学': '同步基础', '培优学': '同步培优', '技巧课': '专项提升',
  '语法': '专项提升', '专项课': '专项提升', '中考冲刺': '中考冲刺', '': '同步基础',
};

// stage（学段）：primary 小学 / junior 初中 / '' 不限。同步类章节按「年级 + 册别」匹配；
// 专项提升、中考冲刺按「学段」匹配（学生端不再按年级和上下册过滤这两类）。
const CHAPTERS = [
  { subject: '数学', grade: '七年级', book: '人教版 · 七年级上册', name: '第一章 有理数', code: 'S7-1', category: '同步基础', sort: 1 },
  { subject: '数学', grade: '七年级', book: '人教版 · 七年级上册', name: '第二章 整式的加减', code: 'S7-2', category: '同步基础', sort: 2 },
  { subject: '数学', grade: '七年级', book: '通用', name: '培优专题：数轴动点问题', code: 'S7-P1', category: '同步培优', sort: 1 },
  { subject: '数学', grade: '六年级', book: '通用', name: '分数混合运算技巧', code: 'S6-J1', category: '专项提升', stage: 'primary', sort: 1 },
  { subject: '数学', grade: '七年级', book: '通用', name: '有理数速算技巧', code: 'S7-J1', category: '专项提升', stage: 'junior', sort: 1 },
  { subject: '数学', grade: '中考冲刺', book: '中考通用', name: '中考一轮：函数图象与性质', code: 'ZS-1', category: '中考冲刺', stage: 'junior', sort: 1 },
  { subject: '英语', grade: '七年级', book: '人教版 · 七年级上册', name: 'Starter Unit 1 Good morning', code: 'E7-1', category: '同步基础', sort: 1 },
  { subject: '英语', grade: '六年级', book: '通用', name: '一般现在时语法精讲', code: 'E6-G1', category: '专项提升', stage: 'primary', sort: 1 },
  { subject: '英语', grade: '七年级', book: '通用', name: '名词单复数语法精讲', code: 'E7-G1', category: '专项提升', stage: 'junior', sort: 1 },
  { subject: '英语', grade: '中考冲刺', book: '中考通用', name: '中考完形填空专项', code: 'ZE-1', category: '中考冲刺', stage: 'junior', sort: 1 },
  { subject: '物理', grade: '八年级', book: '人教版 · 八年级上册', name: '第一章 机械运动', code: 'P8-1', category: '同步基础', sort: 1 },
  { subject: '化学', grade: '九年级', book: '人教版 · 九年级上册', name: '绪言 化学使世界变得更加绚丽多彩', code: 'C9-0', category: '同步基础', sort: 1 },
];

/** 每个目录下的知识点（一个知识点 = 一段视频 + 一份讲义）与习题库 */
const DEMO = {
  'S7-1': { kps: ['有理数的概念', '数轴与相反数', '绝对值', '有理数的大小比较'], ex: ['基础练', '提高练'] },
  'S7-2': { kps: ['同类项与合并同类项', '去括号法则', '整式的加减运算'], ex: ['基础练'] },
  'S7-P1': { kps: ['数轴上的动点问题', '动点与距离的最值'], ex: ['培优练习'] },
  'S6-J1': { kps: ['分数乘除的巧算', '带分数与假分数互化'], ex: ['专项练习'] },
  'S7-J1': { kps: ['速算技巧之凑整', '乘法分配律的巧用'], ex: ['专项练习'] },
  'ZS-1': { kps: ['一次函数的图象与性质', '二次函数的图象与性质', '函数综合应用'], ex: ['中考真题精选'] },
  'E7-1': { kps: ['Good morning 词汇与句型', '字母 A—H 的读音'], ex: ['基础练'] },
  'E6-G1': { kps: ['一般现在时的构成', '第三人称单数变化规则'], ex: ['语法专练'] },
  'E7-G1': { kps: ['可数名词单复数变化规则', '不规则复数与不可数名词'], ex: ['语法专练'] },
  'ZE-1': { kps: ['完形填空解题步骤', '上下文线索定位'], ex: ['中考真题精选'] },
  'P8-1': { kps: ['机械运动与参照物', '速度的计算'], ex: ['基础练'] },
  'C9-0': { kps: ['化学是什么'], ex: ['基础练'] },
};

/**
 * 示例「分级目录」（章节下可选的第四级）：学生端会折叠成一层，点击标题才展开。
 * 数组每项 = 一个分级目录，kps 写该分组的第几个知识点（从 1 开始）。
 * 没在这里列出的章节 = 不分组，学生端仍按平铺列表展示，方便对比两种效果。
 */
const DEMO_SECTIONS = {
  'S7-1': [
    { name: '1.1 有理数的概念', kps: [1] },
    { name: '1.2 数轴、相反数与绝对值', kps: [2, 3] },
    { name: '1.3 有理数的大小比较', kps: [4] },
  ],
  'S7-2': [
    { name: '2.1 同类项与合并同类项', kps: [1] },
    { name: '2.2 去括号与整式加减', kps: [2, 3] },
  ],
};

/** 示例视频外链（占位用，正式使用时请在后台替换为自己的视频） */
const DEMO_VIDEOS = [
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://www.w3schools.com/html/mov_bbb.mp4',
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function pageHTML(title, subtitle, blocks) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:0 auto;padding:40px 28px;color:#1f2937;line-height:1.95}
  .kicker{color:#2f6bff;font-size:13px;font-weight:700;letter-spacing:1px}
  h1{font-size:23px;margin:8px 0 4px}
  .sub{color:#8a94a6;font-size:13px;border-bottom:2px solid #eef1f7;padding-bottom:14px;margin-bottom:22px}
  h2{font-size:16px;margin:24px 0 8px;color:#111827}
  ul{margin:6px 0 6px 20px}
  li{margin-bottom:5px}
  .box{background:#f6f9ff;border-left:3px solid #2f6bff;border-radius:0 10px 10px 0;padding:12px 16px;margin:14px 0;font-size:14px;color:#3a4a63}
  .q{margin-bottom:16px}
  .blank{display:inline-block;min-width:110px;border-bottom:1px solid #b0b8c6}
  .foot{margin-top:32px;color:#b0b8c6;font-size:12px;text-align:center}
</style></head>
<body>
  <div class="kicker">智学课堂</div>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(subtitle)}</div>
  ${blocks}
  <div class="foot">本文件为系统示例资料，可在后台「讲义资料」中替换为真实文件</div>
</body></html>`;
}

function handoutHTML(chapter, lesson, kp) {
  return pageHTML(`${lesson} · 讲义`, `${chapter.subject} · ${chapter.category} · ${chapter.grade} · ${chapter.name}`, `
  <h2>学习目标</h2>
  <ul>
    <li>理解「${esc(kp)}」的核心概念与常见考法</li>
    <li>能独立完成配套例题，并说出每一步的依据</li>
    <li>学完后完成本章习题库中的对应练习</li>
  </ul>
  <div class="box">📌 本讲义与视频《${esc(lesson)}》一一对应，建议先看视频再做笔记。</div>
  <h2>知识梳理</h2>
  <ul>
    <li>概念：${esc(kp)}的定义与表示方法</li>
    <li>方法：由易到难的三类典型题型</li>
    <li>易错：符号、单位与取值范围</li>
  </ul>
  <h2>典型例题</h2>
  <div class="q">例 1&nbsp;&nbsp;（示例题）请写出「${esc(kp)}」的关键结论，并说明理由。</div>
  <div class="q">例 2&nbsp;&nbsp;（示例题）计算下列各式，注意运算顺序与符号。</div>
  <h2>课堂小结</h2>
  <ul><li>先弄清概念，再练熟套路，最后限时训练。</li></ul>`);
}

function exerciseHTML(chapter, name, kps) {
  const items = kps.concat(kps).slice(0, 6).map((kp, i) =>
    `<div class="q">${i + 1}. 关于「${esc(kp)}」，<span class="blank"></span>（示例题，请在此作答）。</div>`
  ).join('\n  ');
  return pageHTML(`${chapter.name} · ${name}`, `${chapter.subject} · ${chapter.category} · 本章习题库`, `
  <h2>一、填空与选择</h2>
  ${items}
  <h2>二、解答</h2>
  <div class="q">7. 结合本章所学，完成一道综合题，并写出完整解题过程。</div>
  <div class="box">✅ 做完后对照讲义与视频复盘，错题请重新整理一遍。</div>`);
}

// ------------------------------------------------------------ 主流程
(async function seed() {
  // 1) 校长账号
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  if (!admin) {
    db.prepare("INSERT INTO users (role,username,password,name,created_at) VALUES ('admin',?,?,?,?)")
      .run('15152099970', hash('123456'), '校长', now());
    console.log('✔ 已创建校长账号：  15152099970 / 123456');
  } else if (admin.username !== '15152099970') {
    db.prepare('UPDATE users SET username=?, password=?, name=? WHERE id=?')
      .run('15152099970', hash('123456'), '校长', admin.id);
    console.log('✔ 校长账号已重置为：  15152099970 / 123456');
  } else {
    console.log('· 校长账号已存在：15152099970');
  }

  // 2) 老分类名迁移到新的 4 大类
  for (const [oldName, newName] of Object.entries(CATEGORY_RENAME)) {
    if (oldName === newName) continue;
    const r = db.prepare("UPDATE chapters SET category=? WHERE IFNULL(category,'')=?").run(newName, oldName);
    if (r.changes) console.log(`✔ 课程分类迁移：${oldName || '(空)'} → ${newName}（${r.changes} 条）`);
  }

  // 3) 老数据兼容：早期上传的讲义没有「关联视频」，这里按顺序补上关联，
  //    避免它们被归进习题库（关联了视频 = 讲义，没关联 = 习题库）
  let paired = 0;
  for (const h of db.prepare("SELECT id, chapter_id FROM handouts WHERE video_id IS NULL AND IFNULL(kind,'handout')='handout' AND chapter_id IS NOT NULL ORDER BY id").all()) {
    const used = new Set(db.prepare('SELECT video_id FROM handouts WHERE chapter_id=? AND video_id IS NOT NULL').all(h.chapter_id).map((x) => x.video_id));
    const free = db.prepare('SELECT id FROM videos WHERE chapter_id=? ORDER BY sort, id').all(h.chapter_id).map((v) => v.id).filter((id) => !used.has(id));
    if (!free.length) continue;
    db.prepare('UPDATE handouts SET video_id=? WHERE id=?').run(free[0], h.id);
    paired++;
  }
  if (paired) console.log(`✔ 已把 ${paired} 份历史讲义自动关联到对应知识点`);

  // 4) 课程目录
  //    册别（term）自动从「二级名称」里认出来：写了"上册/下册"就归到那一册，其余算通用（上下册都能看）
  const termOfBook = (book) => (/下册/.test(book || '') ? '下册' : (/上册/.test(book || '') ? '上册' : ''));
  const insC = db.prepare('INSERT INTO chapters (subject,grade,term,book,name,code,sort,category,stage,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const c of CHAPTERS) {
    const hit = db.prepare('SELECT id FROM chapters WHERE code=?').get(c.code);
    if (!hit) insC.run(c.subject, c.grade, termOfBook(c.book), c.book, c.name, c.code, c.sort, c.category, c.stage || '', now());
    else db.prepare("UPDATE chapters SET category=?, stage=?, subject=?, grade=?, book=?, name=?, term=CASE WHEN IFNULL(term,'')='' THEN ? ELSE term END WHERE code=?")
      .run(c.category, c.stage || '', c.subject, c.grade, c.book, c.name, termOfBook(c.book), c.code);
  }
  console.log('✔ 课程目录就绪（4 门学科 × 4 大类）');

  // 5) 示例知识点（视频 + 一对一讲义）、本章习题库、示例分级目录
  const insV = db.prepare('INSERT INTO videos (chapter_id,section_id,subject,grade,title,file_path,url,duration,level,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insH = db.prepare('INSERT INTO handouts (chapter_id,video_id,section_id,kind,subject,grade,title,file_path,file_name,ext,size,level,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insSec = db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,?,?)');
  let nV = 0, nH = 0, nE = 0, nS = 0;
  for (const [code, cfg] of Object.entries(DEMO)) {
    const c = db.prepare('SELECT * FROM chapters WHERE code=?').get(code);
    if (!c) continue;
    // 已有内容的目录不重复生成，避免覆盖你自己上传的资料
    if (db.prepare('SELECT COUNT(*) n FROM videos WHERE chapter_id=?').get(c.id).n > 0) continue;

    // 先建分级目录，得到「章节内第 n 个知识点 → 分级目录 id」的映射
    const secIds = [];
    for (const [i, s2] of (DEMO_SECTIONS[code] || []).entries()) {
      secIds.push(insSec.run(c.id, s2.name, i + 1, now()).lastInsertRowid);
      nS++;
    }
    const secOfKp = {}; // 知识点序号（从 1 开始）→ 分级目录 id
    (DEMO_SECTIONS[code] || []).forEach((s2, i) => s2.kps.forEach((n) => { secOfKp[n] = secIds[i]; }));

    for (let i = 0; i < cfg.kps.length; i++) {
      const lesson = `第${i + 1}讲 ${cfg.kps[i]}`;
      const sid = secOfKp[i + 1] || null;
      const v = insV.run(c.id, sid, c.subject, c.grade, lesson, '', DEMO_VIDEOS[i % DEMO_VIDEOS.length], 0, 'basic', i + 1, now());
      const name = `${lesson} 讲义.html`;
      const html = handoutHTML(c, lesson, cfg.kps[i]);
      const saved = await store.saveFile(Buffer.from(html, 'utf8'), name, 'handouts');
      insH.run(c.id, v.lastInsertRowid, sid, 'handout', c.subject, c.grade, `${lesson} · 讲义`, saved.key, name, 'html', saved.size, 'basic', now());
      nV++; nH++;
    }
    for (const ex of cfg.ex) {
      const title = `${c.name} · ${ex}`;
      const name = `${c.name} ${ex}.html`;
      const html = exerciseHTML(c, ex, cfg.kps);
      const saved = await store.saveFile(Buffer.from(html, 'utf8'), name, 'handouts');
      insH.run(c.id, null, null, 'exercise', c.subject, c.grade, title, saved.key, name, 'html', saved.size, 'basic', now());
      nE++;
    }
  }
  if (nV) console.log(`✔ 已生成示例知识点 ${nV} 个（视频 + 讲义）、习题库 ${nE} 套、分级目录 ${nS} 个`);
  else console.log('· 示例内容已存在，跳过生成');

  // 5.1) 老库补建「分级目录」：已有内容但还没分级的示例章节，按顺序自动归类
  let nS2 = 0;
  for (const [code, cfg] of Object.entries(DEMO_SECTIONS)) {
    const c = db.prepare('SELECT * FROM chapters WHERE code=?').get(code);
    if (!c) continue;
    if (db.prepare('SELECT COUNT(*) n FROM sections WHERE chapter_id=?').get(c.id).n > 0) continue;
    const vids = db.prepare('SELECT id FROM videos WHERE chapter_id=? ORDER BY sort, id').all(c.id).map((v) => v.id);
    if (!vids.length) continue;
    const secIds = cfg.map((s2, i) => db.prepare('INSERT INTO sections (chapter_id,name,sort,created_at) VALUES (?,?,?,?)')
      .run(c.id, s2.name, i + 1, now()).lastInsertRowid);
    const upV = db.prepare('UPDATE videos SET section_id=? WHERE id=?');
    const upH = db.prepare('UPDATE handouts SET section_id=? WHERE video_id=?');
    cfg.forEach((s2, i) => s2.kps.forEach((n) => {
      const vid = vids[n - 1];
      if (vid) { upV.run(secIds[i], vid); upH.run(secIds[i], vid); }
    }));
    nS2 += secIds.length;
  }
  if (nS2) console.log(`✔ 已为 ${nS2} 个示例分级目录归类（老库升级）`);

  // 6) 学生（年级 + 到期时间必填：默认给一年有效期；册别默认上册，可在后台改）
  const students = [
    { username: '13800000001', name: '张三', grade: '七年级', term: '上册' },
    { username: '13800000002', name: '李四', grade: '七年级', term: '上册' },
    { username: '13800000003', name: '王五', grade: '八年级', term: '上册' },
    { username: '13800000004', name: '赵六', grade: '九年级', term: '上册' },
    { username: '13800000005', name: '钱七', grade: '中考冲刺', term: '' },
    { username: '13800000006', name: '孙八', grade: '六年级', term: '' },
  ];
  const expD = new Date(); expD.setFullYear(expD.getFullYear() + 1);
  const oneYearLater = `${expD.getFullYear()}-${String(expD.getMonth() + 1).padStart(2, '0')}-${String(expD.getDate()).padStart(2, '0')}`;
  const insS = db.prepare("INSERT INTO users (role,username,password,name,grade,term,allow_speed,allow_seek,expire_at,status,created_at) VALUES ('student',?,?,?,?,?,1,1,?,1,?)");
  for (const s of students) {
    if (!db.prepare('SELECT id FROM users WHERE username=?').get(s.username)) {
      insS.run(s.username, hash('123456'), s.name, s.grade, s.term || '', oneYearLater, now());
      console.log(`✔ 已开通学生： ${s.username} / 123456  （${s.name} ${s.grade}${s.term || ''}，${oneYearLater} 到期）`);
    }
  }

  // 6.1) 示例词性书：新译林八上 U1-U8 词形转换链（老师提供的《词形变换练习附答案》）
  const POS_YILIN = require('./pos-yilin');
  const posYilinTitle = '八年级英语 · 译林版 U1-U8 词形转换（示例）';
  if (!db.prepare('SELECT id FROM word_books WHERE title=?').get(posYilinTitle)) {
    const bk = db.prepare('INSERT INTO word_books (title, grade, kind, created_at) VALUES (?,?,?,?)')
      .run(posYilinTitle, '八年级', 'pos', now()).lastInsertRowid;
    const baseMean = require('./pos-base-mean');
    const insP = db.prepare("INSERT INTO word_pos (book_id, unit, base_word, base_pos, base_meaning, target_word, target_pos, meaning, affix, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    let nP = 0;
    for (const ch of POS_YILIN) {
      const bm = baseMean[String(ch.base || '').toLowerCase()] || '';
      for (const t of ch.targets) {
        insP.run(bk, ch.unit, ch.base, ch.base_pos || '', bm, t.word, t.pos, t.meaning || '', '', now());
        nP++;
      }
    }
    console.log(`✔ 已创建示例词书「${posYilinTitle}」：${POS_YILIN.length} 条词形转换链 / ${nP} 个变形`);
  }

  // 6.2) 演示单词书：七年级上册 U1-U3（学生端「单词速记 / 语境记忆 / 连词成句」开箱有内容可练）
  const demoTitle = '人教版七年级上册单词（演示）';
  if (!db.prepare('SELECT id FROM word_books WHERE title=?').get(demoTitle)) {
    const bk = db.prepare('INSERT INTO word_books (title, grade, kind, created_at) VALUES (?,?,?,?)')
      .run(demoTitle, '七年级', 'word', now()).lastInsertRowid;
    const insW = db.prepare('INSERT INTO words (book_id, unit, word, phonetic, pos, meaning, example, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const insT = db.prepare('INSERT INTO word_sentences (book_id, unit, text, translation, created_at) VALUES (?,?,?,?,?)');
    const insP = db.prepare('INSERT INTO word_pos (book_id, unit, base_word, base_pos, base_meaning, target_word, target_pos, meaning, affix, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    // [单词, 音标, 词性, 释义, 例句]
    const DEMO_UNITS = [
      ['Unit 1', [
        ['name', '/neɪm/', 'n.', '名字', 'What is your name?'],
        ['nice', '/naɪs/', 'adj.', '令人愉快的；好的', 'Nice to meet you.'],
        ['meet', '/miːt/', 'v.', '遇见；相逢', 'I meet my friend at school.'],
        ['too', '/tuː/', 'adv.', '也；太', 'I am a student, too.'],
        ['your', '/jɔː(r)/', 'pron.', '你的；你们的', 'Is this your book?'],
        ['his', '/hɪz/', 'pron.', '他的', 'His bag is on the desk.'],
        ['her', '/hɜː(r)/', 'pron.', '她的', 'Her name is Lily.'],
        ['and', '/ænd/', 'conj.', '和；又', 'Tom and Jim are friends.'],
        ['yes', '/jes/', 'adv.', '是的', 'Yes, I am.'],
        ['friend', '/frend/', 'n.', '朋友', 'She is my good friend.'],
      ]],
      ['Unit 2', [
        ['sister', '/ˈsɪstə(r)/', 'n.', '姐；妹', 'This is my sister.'],
        ['brother', '/ˈbrʌðə(r)/', 'n.', '兄；弟', 'My brother is a doctor.'],
        ['mother', '/ˈmʌðə(r)/', 'n.', '母亲', 'My mother is a teacher.'],
        ['father', '/ˈfɑːðə(r)/', 'n.', '父亲', 'His father works in a bank.'],
        ['parent', '/ˈpeərənt/', 'n.', '父亲；母亲', 'My parents are at home.'],
        ['family', '/ˈfæməli/', 'n.', '家；家庭', 'I love my family.'],
        ['grandmother', '/ˈɡrænmʌðə(r)/', 'n.', '祖母；外祖母', 'My grandmother is sixty.'],
        ['grandfather', '/ˈɡrænfɑːðə(r)/', 'n.', '祖父；外祖父', 'My grandfather likes tea.'],
        ['those', '/ðəʊz/', 'pron.', '那些', 'Those are my books.'],
        ['who', '/huː/', 'pron.', '谁', 'Who is that girl?'],
      ]],
      ['Unit 3', [
        ['pencil', '/ˈpensl/', 'n.', '铅笔', 'This is my pencil.'],
        ['book', '/bʊk/', 'n.', '书', 'The book is on the desk.'],
        ['eraser', '/ɪˈreɪzə(r)/', 'n.', '橡皮', 'Can I use your eraser?'],
        ['box', '/bɒks/', 'n.', '盒子', 'The box is blue.'],
        ['schoolbag', '/ˈskuːlbæɡ/', 'n.', '书包', 'My schoolbag is heavy.'],
        ['dictionary', '/ˈdɪkʃənri/', 'n.', '词典', 'Look it up in the dictionary.'],
        ['excuse', '/ɪkˈskjuːz/', 'v.', '原谅；宽恕', 'Excuse me, is this yours?'],
        ['thank', '/θæŋk/', 'v.', '感谢', 'Thank you for your help.'],
        ['help', '/help/', 'v.', '帮助', 'Can you help me?'],
        ['welcome', '/ˈwelkəm/', 'adj.', '受欢迎的', 'You are welcome.'],
      ]],
    ];
    let nW = 0;
    for (const [unit, list] of DEMO_UNITS) {
      for (const [word, phonetic, pos, meaning, example] of list) {
        insW.run(bk, unit, word, phonetic, pos, meaning, example, now());
        nW++;
      }
    }
    const SENTS = [
      ['Unit 1', 'What is your name?', '你叫什么名字？'],
      ['Unit 1', 'Nice to meet you.', '很高兴见到你。'],
      ['Unit 2', 'This is my sister.', '这是我的妹妹。'],
      ['Unit 2', 'Those are my grandparents.', '那些是我的祖父母。'],
      ['Unit 3', 'Is this your pencil?', '这是你的铅笔吗？'],
      ['Unit 3', 'Thank you for your help.', '谢谢你的帮助。'],
    ];
    for (const [unit, t, tr] of SENTS) insT.run(bk, unit, t, tr, now());
    const POS = [
      ['Unit 1', 'friend', 'n.', '朋友', 'friendly', '形容词', '友好的', 'friend + -ly'],
      ['Unit 3', 'help', 'v.', '帮助', 'helpful', '形容词', '有帮助的', 'help + -ful'],
      ['Unit 3', 'care', 'v.', '关心；在意', 'careful', '形容词', '小心的', 'care + -ful'],
      ['Unit 3', 'thank', 'v.', '感谢', 'thankful', '形容词', '感激的', 'thank + -ful'],
      ['Unit 2', 'happy', 'adj.', '快乐的；幸福的', 'happiness', '名词', '幸福', 'happy → happiness'],
    ];
    for (const [unit, base, bp, bm, tw, tp, mn, af] of POS) insP.run(bk, unit, base, bp, bm, tw, tp, mn, af, now());
    console.log(`✔ 已创建演示单词书「${demoTitle}」：${DEMO_UNITS.length} 个单元 / ${nW} 个单词 / ${SENTS.length} 个句子 / ${POS.length} 条词形转换`);
  }

  console.log('\n===== 初始化完成 =====');
  console.log('校长后台  http://localhost:3000/admin/    15152099970 / 123456');
  console.log('学生端    http://localhost:3000/           13800000001 / 123456');
  console.log('\n学生端结构：数学 / 英语 / 物理 / 化学（一级）→ 同步基础 / 同步培优 / 专项提升 / 中考冲刺（二级）');
  console.log('           专项提升、中考冲刺按「学段」显示：小学账号看小学专项，初中账号看初中专项 + 全部中考冲刺');
  console.log('           → 课程卡片（知识点进度条）→ 分级目录（可折叠，点击展开）→ 知识点（一个视频 + 一份讲义）+ 本章习题库');
  console.log('提示：示例视频为外链占位，正式使用时请在后台替换为自有视频（建议 MP4 / H.264）。');
})().catch((e) => { console.error('初始化失败：', e); process.exit(1); });
