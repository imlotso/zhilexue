/* 键盘学堂本地进度：按登录学生隔离。
 * 以前进度存在全局 key（htLesson / htDone / htWeakKeys），同一台电脑换学生登录，
 * 新学生一进来就会看到上一个学生学到哪、完成了哪些课（「之前的身影」）。
 * 现在所有进度 key 都带上学生 id（从主框架写入的 xuexi_user 读取，iframe 同源可直接读），
 * 每个学生各存各的，互不可见。 */
const HT_UID = (() => {
  try {
    const u = JSON.parse(localStorage.getItem((window.STORAGE_PREFIX || 'xuexi') + '_user') || 'null');
    return String((u && (u.id || u.username)) || 'guest');
  } catch (e) { return 'guest'; }
})();
/** 读当前学生的进度项，无记录返回默认值 d */
const htGet = (k, d) => {
  try {
    const v = localStorage.getItem('ht:' + HT_UID + ':' + k);
    return v === null ? d : v;
  } catch (e) { return d; }
};
/** 写当前学生的进度项 */
const htSet = (k, v) => {
  try { localStorage.setItem('ht:' + HT_UID + ':' + k, String(v)); } catch (e) { /* 隐私模式忽略 */ }
};
