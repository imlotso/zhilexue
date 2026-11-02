'use strict';
/**
 * 演示数据：AI 单词记忆模块
 *
 * 造一本示例词书（八年级英语 · 人教版 Unit 1–2 节选），三个库各上传一份 CSV，
 * 走的是和管理端上传完全一样的接口，方便管理员登录后马上看到学生端的效果。
 *
 * 运行（需先启动服务）：node seed-words.js
 */
const BASE = 'http://127.0.0.1:3000';
const ADMIN = { username: '15152099970', password: '123456', role: 'admin' };
const BOOK_TITLE = '八年级英语 · 人教版（示例）';

async function api(p, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers, body: payload });
  return r.json();
}

/** 按 CSV 规则做引号转义 */
const cell = (s) => {
  const v = String(s == null ? '' : s);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const toCsv = (header, rows) => [header.join(',')].concat(rows.map((r) => r.map(cell).join(','))).join('\n') + '\n';

/* ---------------- Unit 1：假期去哪儿 ---------------- */
const WORDS = [
  ['单词', '音标', '词性', '释义', '例句', '单元'],
  ['anyone', '[ˈeniwʌn]', 'pron.', '任何人；某个人', 'Did anyone come to help you?', 'Unit 1'],
  ['anywhere', '[ˈeniweə(r)]', 'adv.', '在任何地方', 'I looked for my keys anywhere but found nothing.', 'Unit 1'],
  ['wonderful', '[ˈwʌndəfl]', 'adj.', '精彩的；极好的', 'We had a wonderful time at the beach.', 'Unit 1'],
  ['few', '[fjuː]', 'adj.', '不多；很少', 'Few students were late this morning.', 'Unit 1'],
  ['most', '[məʊst]', 'adj.', '最多的；大多数的', 'Most of my friends like playing basketball.', 'Unit 1'],
  ['something', '[ˈsʌmθɪŋ]', 'pron.', '某事物；某东西', 'I want to tell you something important.', 'Unit 1'],
  ['nothing', '[ˈnʌθɪŋ]', 'pron.', '没有什么；无事', 'There is nothing in the box.', 'Unit 1'],
  ['everyone', '[ˈevriwʌn]', 'pron.', '每人；人人', 'Everyone was happy about the good news.', 'Unit 1'],
  ['myself', '[maɪˈself]', 'pron.', '我自己', 'I made this cake myself.', 'Unit 1'],
  ['yourself', '[jɔːˈself]', 'pron.', '你自己', 'You should take care of yourself.', 'Unit 1'],
  ['hen', '[hen]', 'n.', '母鸡', 'The hen laid three eggs yesterday.', 'Unit 1'],
  ['pig', '[pɪɡ]', 'n.', '猪', 'The farmer keeps ten pigs on the farm.', 'Unit 1'],
  ['seem', '[siːm]', 'v.', '似乎；好像', 'He seems very tired today.', 'Unit 1'],
  ['bored', '[bɔːd]', 'adj.', '厌倦的；烦闷的', 'The children got bored with the same game.', 'Unit 1'],
  ['diary', '[ˈdaɪəri]', 'n.', '日记；记事簿', 'She writes her diary before going to bed.', 'Unit 1'],
  ['activity', '[ækˈtɪvəti]', 'n.', '活动', 'We have many outdoor activities after class.', 'Unit 1'],
  ['decide', '[dɪˈsaɪd]', 'v.', '决定；选定', 'They decided to go camping this weekend.', 'Unit 1'],
  ['try', '[traɪ]', 'v.', '尝试；设法', 'Please try to finish your homework on time.', 'Unit 1'],
  ['paragliding', '[ˈpærəɡlaɪdɪŋ]', 'n.', '滑翔伞运动', 'Do you want to try paragliding with me?', 'Unit 1'],
  ['umbrella', '[ʌmˈbrelə]', 'n.', '雨伞', 'Take an umbrella, it may rain this afternoon.', 'Unit 1'],
];

/* ---------------- Unit 2：多久一次 ---------------- */
const WORDS2 = [
  ['单词', '音标', '词性', '释义', '例句', '单元'],
  ['hardly', '[ˈhɑːdli]', 'adv.', '几乎不；几乎没有', 'He hardly ever watches TV on weekdays.', 'Unit 2'],
  ['ever', '[ˈevə(r)]', 'adv.', '曾经；在任何时候', 'Have you ever been to Beijing?', 'Unit 2'],
  ['once', '[wʌns]', 'adv.', '一次；曾经', 'I go swimming once a week.', 'Unit 2'],
  ['twice', '[twaɪs]', 'adv.', '两次；两倍', 'She takes the piano lesson twice a week.', 'Unit 2'],
  ['although', '[ɔːlˈðəʊ]', 'conj.', '虽然；尽管', 'Although it was raining, they still went out.', 'Unit 2'],
  ['through', '[θruː]', 'prep.', '以；凭借；穿过', 'We learned a lot through this activity.', 'Unit 2'],
  ['health', '[helθ]', 'n.', '健康；健康状况', 'Eating vegetables is good for your health.', 'Unit 2'],
  ['result', '[rɪˈzʌlt]', 'n.', '结果；后果', 'His hard work brought a good result.', 'Unit 2'],
  ['percent', '[pəˈsent]', 'n.', '百分之…', 'Eighty percent of the students passed the exam.', 'Unit 2'],
  ['online', '[ˌɒnˈlaɪn]', 'adj.', '在线的；联网的', 'Many people shop online now.', 'Unit 2'],
  ['television', '[ˈtelɪvɪʒn]', 'n.', '电视节目；电视机', 'They watched an interesting television show.', 'Unit 2'],
  ['mind', '[maɪnd]', 'n.', '头脑；想法', 'Reading is good for the mind.', 'Unit 2'],
  ['body', '[ˈbɒdi]', 'n.', '身体', 'Doing exercise keeps your body strong.', 'Unit 2'],
  ['magazine', '[ˌmæɡəˈziːn]', 'n.', '杂志', 'She reads an English magazine every month.', 'Unit 2'],
  ['however', '[haʊˈevə(r)]', 'adv.', '然而；不过', 'However, he never gave up.', 'Unit 2'],
];

const SENTENCES = [
  ['句子', '翻译', '单元'],
  ['Did anyone come to help you?', '有人来帮你吗？', 'Unit 1'],
  ['We had a wonderful time at the beach.', '我们在沙滩上玩得非常开心。', 'Unit 1'],
  ['Most of my friends like playing basketball.', '我的大多数朋友喜欢打篮球。', 'Unit 1'],
  ['I made this cake myself.', '这个蛋糕是我自己做的。', 'Unit 1'],
  ['He seems very tired today.', '他今天好像很累。', 'Unit 1'],
  ['They decided to go camping this weekend.', '他们决定这周末去露营。', 'Unit 1'],
  ['He hardly ever watches TV on weekdays.', '工作日他几乎不看电视。', 'Unit 2'],
  ['Have you ever been to Beijing?', '你去过北京吗？', 'Unit 2'],
  ['Although it was raining, they still went out.', '尽管在下雨，他们还是出去了。', 'Unit 2'],
  ['Eating vegetables is good for your health.', '吃蔬菜对你的健康有好处。', 'Unit 2'],
  ['Eighty percent of the students passed the exam.', '百分之八十的学生通过了考试。', 'Unit 2'],
  ['Doing exercise keeps your body strong.', '做运动能让你的身体强壮。', 'Unit 2'],
];

const POS = [
  ['原词', '目标词', '目标词性', '词缀说明', '单元'],
  ['wonder', 'wonderful', '形容词', 'wonder + -ful', 'Unit 1'],
  ['act', 'activity', '名词', 'act + -ivity', 'Unit 1'],
  ['decide', 'decision', '名词', 'decide + -sion', 'Unit 1'],
  ['bore', 'bored', '形容词', 'bore + -d', 'Unit 1'],
  ['health', 'healthy', '形容词', 'health + -y', 'Unit 2'],
  ['hard', 'hardly', '副词', 'hard + -ly', 'Unit 2'],
  ['quick', 'quickly', '副词', 'quick + -ly', 'Unit 2'],
  ['usual', 'usually', '副词', 'usual + -ly', 'Unit 2'],
  ['different', 'difference', '名词', 'different + -ce', 'Unit 2'],
  ['educate', 'education', '名词', 'educate + -tion', 'Unit 2'],
];

(async () => {
  const login = await api('/api/login', { method: 'POST', body: ADMIN });
  if (login.code !== 0) { console.error('管理员登录失败：' + login.msg); process.exit(1); }
  const token = login.data.token;

  // 已存在同名词书 → 直接复用（重复执行不会造出第二本）
  const books = await api('/api/admin/word/books', { token });
  let book = books.data.find((b) => b.title === BOOK_TITLE);
  if (!book) {
    const r = await api('/api/admin/word/books', { method: 'POST', token, body: { title: BOOK_TITLE, grade: '八年级', remark: '演示数据，可在管理端直接删除' } });
    if (r.code !== 0) { console.error('新建词书失败：' + r.msg); process.exit(1); }
    book = r.data;
    console.log('已创建词书：' + book.title);
  } else {
    console.log('词书已存在，继续补数据：' + book.title);
  }

  const jobs = [
    ['word', 'Unit1 单词.csv', toCsv(WORDS[0], WORDS.slice(1)), '单词库'],
    ['word', 'Unit2 单词.csv', toCsv(WORDS2[0], WORDS2.slice(1)), '单词库'],
    ['sentence', '句子库.csv', toCsv(SENTENCES[0], SENTENCES.slice(1)), '句子库'],
    ['pos', '词性训练库.csv', toCsv(POS[0], POS.slice(1)), '词性训练库'],
  ];
  for (const [kind, name, csv, label] of jobs) {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(csv, 'utf8')], { type: 'text/csv' }), name);
    fd.append('kind', kind);
    fd.append('book_id', String(book.id));
    const r = await api('/api/admin/word/upload', { method: 'POST', token, form: fd });
    console.log(`  ${r.code === 0 ? '✅' : '❌'} ${label}（${name}）：` + (r.code === 0 ? `新增 ${r.data.inserted} 条，跳过 ${r.data.skipped} 条` : r.msg));
  }

  const after = (await api('/api/admin/word/books', { token })).data.find((b) => b.id === book.id);
  console.log(`\n词书《${after.title}》：单词 ${after.word_count} · 句子 ${after.sentence_count} · 词性题 ${after.pos_count}`);
  console.log('学生端 → http://localhost:3000/  左侧第一栏「单词记忆」');
})();
