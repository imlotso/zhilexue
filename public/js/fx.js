/* 学生端音效引擎 FX
 * ------------------------------------------------------------------
 * 全部音效由 WebAudio 实时合成（正弦/三角波 + 淡入淡出包络），
 * 不依赖任何音频文件 —— 因此不占带宽、不会加载失败、也不怕被 CDN 缓存错误。
 *
 * 用法：
 *   FX.tap()      轻点（切学科 / 切分类 / 点卡片）
 *   FX.pop()      开关（主题 / 音效）
 *   FX.correct()  答对（清脆两连音）
 *   FX.wrong()    答错（柔和低音，不刺耳）
 *   FX.win()      完成（上行三连音）
 *   FX.on() / FX.toggle() / FX.set(bool)   静音开关（localStorage 记忆）
 *
 * 兼容性：没有 AudioContext 的环境（如 jsdom 测试、老浏览器）全部降级为空操作，绝不抛错。
 * 浏览器要求「用户手势」后才能出声，这里在每次点击时惰性创建 AudioContext，天然满足。
 */
const FX = (() => {
  const KEY = 'xuexi_sound';
  let ctx = null;
  let dead = false;               // 环境不支持 → 之后不再重试

  const on = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };
  const set = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ } };

  function ac() {
    if (ctx || dead) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { dead = true; return null; }
      ctx = new AC();
    } catch (e) { dead = true; ctx = null; }
    return ctx;
  }

  /** 单个音符：freq 频率(Hz)、dur 时长(秒)、type 波形、vol 音量、at 相对延迟(秒) */
  function note(freq, dur, type = 'sine', vol = 0.16, at = 0) {
    if (!on()) return;
    const c = ac();
    if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      const t0 = c.currentTime + at;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      // 快起慢落，避免爆音
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 出声失败不影响功能 */ }
  }

  return {
    on, set,
    toggle() { const v = !on(); set(v); return v; },
    /** 轻点：一个很短的高音，音量很小，不打扰 */
    tap() { note(880, 0.07, 'triangle', 0.07); },
    /** 开关：上下滑动感 */
    pop() { note(660, 0.06, 'sine', 0.1); note(990, 0.07, 'sine', 0.07, 0.05); },
    /** 答对：C6 → E6，明亮 */
    correct() { note(1046.5, 0.1, 'sine', 0.15); note(1318.5, 0.16, 'sine', 0.14, 0.09); },
    /** 答错：E4 → A3，柔和低音，不用刺耳的蜂鸣 */
    wrong() { note(329.6, 0.14, 'sine', 0.13); note(220, 0.22, 'sine', 0.11, 0.12); },
    /** 完成：C5 E5 G5 C6 上行琶音 */
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, 0.2, 'sine', 0.15, i * 0.1));
    },
  };
})();
