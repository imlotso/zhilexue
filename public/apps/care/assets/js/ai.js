/* ============================================================
 * ai.js —— 语音转文字 + AI 结构化整理
 *   1. Web Speech API 实时转写（zh-CN，连续识别、实时回显）
 *   2. 口语冗余词清洗（"嗯…""那个…""就是…" 等）
 *   3. 四段式结构化整理：状态 / 核心问题 / 反馈承诺 / 跟进计划
 *   4. 可选接入远程大模型；不可用时自动回落本地引擎
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 一、口语冗余词清洗 ---------------- */
  // 规则按「由长到短」排列，避免短词优先匹配导致残留
  var FILLER = '嗯|呃|哦|噢|诶|唉|哎|啊|那个|这个|就是说|就是|然后|那么|话说|反正|对了|好嘞|行吧|对吧|是吧|嗯对|哦对|怎么说呢|这个嘛|那个嘛';

  var RULES = [
    // 连续重复的填充词：嗯嗯嗯 / 那个那个 → 删除
    [new RegExp('(' + FILLER + ')\\1+', 'g'), ''],
    // 句首填充词
    [new RegExp('^(' + FILLER + ')+'), ''],
    // 独立成段的填充词（前后为标点、空白或边界）
    [new RegExp('([，。、！？；：,.!?;:\\s]|^)(' + FILLER + ')(?=[，。、！？；：,.!?;:\\s]|$)', 'g'), '$1'],
    // 夹在内容中的填充词（前为标点，后接内容）：保留后接内容
    [new RegExp('([，。、！？；：]|^)(' + FILLER + ')(?=[^，。、！？；：])', 'g'), '$1'],
    // 句末语气词
    [/(吧|嘛|呐|咧|咯)(?=[。！？]|$)/g, ''],
    // 折叠重复标点
    [/[，、；：]{2,}/g, function (m) { return m[0]; }],
    [/[。]{2,}/g, '。'],
    // 清理残留的起始标点
    [/^[，。、；：\s]+/, ''],
    [/\s{2,}/g, ' ']
  ];

  function clean(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    // 两遍处理，确保嵌套的填充词被清除
    for (var pass = 0; pass < 2; pass++) {
      RULES.forEach(function (r) { s = s.replace(r[0], r[1]); });
    }
    s = s.replace(/^[，。、；：\s]+/, '').trim();
    if (s && !/[。！？]$/.test(s)) s += '。';
    return s;
  }

  /* ---------------- 二、本地结构化整理 ---------------- */
  var KW = {
    status: ['情绪', '心情', '状态', '表现', '态度', '最近', '近期', '焦虑', '低落', '压力大', '压力',
      '开朗', '积极', '消极', '精神', '睡眠', '熬夜', '上课', '作业', '成绩', '排名', '进步', '退步',
      '认真', '专注', '紧张', '疲惫', '自信', '责任感', '主动性', '兴趣'],
    issue: ['问题', '原因', '因为', '困惑', '矛盾', '冲突', '违纪', '迟到', '早退', '手机', '沉迷',
      '影响', '困扰', '担心', '困难', '薄弱', '下滑', '不足', '摩擦', '误会', '隔阂', '听不懂',
      '跟不上', '诉求', '分心', '缺交', '抄袭', '偏科'],
    feedback: ['承诺', '保证', '答应', '表态', '愿意', '说会', '表示会', '认错', '悔意', '道歉',
      '会努力', '要努力', '接受', '同意', '决定', '目标', '主动问', '会改', '会加'],
    follow: ['跟进', '后续', '回访', '复查', '约谈', '家访', '辅导', '督促', '监督', '协调',
      '联系家长', '联系', '安排', '关注', '观察', '沟通', '反馈', '帮助', '检查', '抽查', '复盘']
  };

  var STRONG = [
    { key: 'feedback', re: /承诺|保证|答应|表态|愿意|说会|表示会|认错|悔意|道歉/ },
    { key: 'follow', re: /跟进|后续|回访|复查|约谈|家访|督促|监督|联系家长|抽查|复盘/ },
    { key: 'status', re: /情绪|状态|表现|态度|心情|压力大|睡眠|熬夜|精神|专注|自信|积极性/ }
  ];

  function splitClauses(text) {
    var out = [];
    String(text).split(/[。！？；\n]+/).forEach(function (seg) {
      seg.split(/[，,]/).forEach(function (p) {
        p = p.trim();
        if (p) out.push(p);
      });
    });
    return out;
  }

  function score(clause) {
    var s = { status: 0, issue: 0, feedback: 0, follow: 0 };
    Object.keys(KW).forEach(function (k) {
      KW[k].forEach(function (w) { if (clause.indexOf(w) >= 0) s[k] += 1; });
    });
    return s;
  }

  function classify(clause) {
    // 1) 强特征优先，保证归类稳定
    for (var i = 0; i < STRONG.length; i++) {
      if (STRONG[i].re.test(clause)) return STRONG[i].key;
    }
    // 2) 关键词打分
    var s = score(clause);
    var best = 'issue', max = 0;
    Object.keys(s).forEach(function (k) {
      if (s[k] > max) { max = s[k]; best = k; }
    });
    return best;
  }

  function organizeLocal(text) {
    var buckets = { status: [], issue: [], feedback: [], follow: [] };
    splitClauses(clean(text)).forEach(function (c) { buckets[classify(c)].push(c); });

    var r = {
      status: buckets.status.join('；'),
      issue: buckets.issue.join('；'),
      feedback: buckets.feedback.join('；'),
      follow: buckets.follow.join('；')
    };
    Object.keys(r).forEach(function (k) {
      r[k] = r[k].trim();
      if (r[k] && !/[。！]$/.test(r[k])) r[k] += '。';
    });
    r.text = compose(r);
    return r;
  }

  function compose(r) {
    return '【学生当前状态】' + (r.status || '本次谈话未涉及') + '\n' +
      '【本次谈话核心问题】' + (r.issue || '本次谈话未涉及') + '\n' +
      '【学生反馈与承诺】' + (r.feedback || '本次谈话未涉及') + '\n' +
      '【班主任跟进计划】' + (r.follow || '本次谈话未涉及');
  }

  /* ---------------- 三、远程大模型整理 ---------------- */
  var SYS_PROMPT = '你是资深班主任的文字助理。请把师生谈话的原始转写稿整理为结构化纪要。' +
    '要求：去除口语冗余（如"嗯""那个""就是"），保留全部事实与要点，忠实于原意，不虚构内容。' +
    '只输出 JSON，不要任何解释文字，格式如下：' +
    '{"status":"学生当前状态：情绪、态度、近期表现","issue":"本次谈话核心问题","feedback":"学生反馈与承诺","follow":"班主任跟进计划"}' +
    '。若某项在原文中没有依据，对应值填空字符串。';

  function extractJson(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('返回内容不是合法 JSON');
    return JSON.parse(s.slice(a, b + 1));
  }

  function organizeRemote(text) {
    return new Promise(function (resolve, reject) {
      var cfg = global.App.store.settings();
      if (!cfg.aiUrl) { reject(new Error('未配置接口地址')); return; }

      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 25000);

      fetch(cfg.aiUrl, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (cfg.aiKey || '')
        },
        body: JSON.stringify({
          model: cfg.aiModel || 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYS_PROMPT },
            { role: 'user', content: String(text || '') }
          ]
        })
      }).then(function (resp) {
        clearTimeout(timer);
        if (!resp.ok) throw new Error('接口返回 ' + resp.status);
        return resp.json();
      }).then(function (json) {
        var content = json && json.choices && json.choices[0] &&
          (json.choices[0].message ? json.choices[0].message.content : json.choices[0].text);
        var o = extractJson(content);
        var r = {
          status: String(o.status || '').trim(),
          issue: String(o.issue || '').trim(),
          feedback: String(o.feedback || '').trim(),
          follow: String(o.follow || '').trim()
        };
        if (!r.status && !r.issue && !r.feedback && !r.follow) throw new Error('返回内容为空');
        r.text = compose(r);
        resolve(r);
      }).catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /**
   * 统一整理入口
   * @param {string} text 原始文本
   * @param {function} cb (result, source) —— source: 'remote' | 'local'
   */
  function organize(text, cb) {
    var cfg = global.App.store.settings();
    if (cfg.aiMode === 'remote') {
      organizeRemote(text).then(function (r) {
        cb(r, 'remote');
      }).catch(function (e) {
        console.warn('远程整理失败，回落本地引擎：', e.message);
        cb(organizeLocal(text), 'local');
      });
    } else {
      cb(organizeLocal(text), 'local');
    }
  }

  /** 家校沟通等场景：仅清洗，不结构化 */
  function polish(text) { return clean(text); }

  /* ---------------- 四、录音器 ---------------- */
  function speechSupported() {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  }

  /**
   * recorder({
   *   onResult(finalText, interimText),
   *   onTick(seconds),
   *   onState('recording'|'idle'),
   *   onStop(text),
   *   onError(message)
   * })
   */
  function recorder(h) {
    var Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
    var rec = null, finalText = '', sec = 0, timer = null, active = false;

    function tick() {
      sec++;
      if (h.onTick) h.onTick(sec);
    }

    function fire(text) {
      if (h.onStop) h.onStop(text);
      if (h.onState) h.onState('idle');
    }

    var api = {
      supported: !!Ctor,
      isActive: function () { return active; },

      start: function () {
        if (!Ctor) {
          if (h.onError) h.onError('当前浏览器不支持语音识别。请使用 Chrome / Edge，或通过 https、localhost 访问后重试，也可直接手动输入。');
          return false;
        }
        if (active) return true;

        try {
          rec = new Ctor();
        } catch (e) {
          if (h.onError) h.onError('无法启动语音识别：' + e.message);
          return false;
        }

        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        finalText = '';
        sec = 0;
        active = true;

        rec.onresult = function (e) {
          var interim = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            var t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText += t; else interim += t;
          }
          if (h.onResult) h.onResult(finalText, interim);
        };

        rec.onerror = function (e) {
          var map = {
            'not-allowed': '麦克风权限被拒绝。请点击地址栏的麦克风图标允许访问，或改为手动输入。',
            'permission-denied': '麦克风权限被拒绝。请在浏览器设置中允许本站使用麦克风。',
            'service-not-allowed': '浏览器语音服务不可用。请确认网络正常，或改为手动输入。',
            'no-speech': '未检测到说话声。请靠近麦克风、提高音量后重试。',
            'network': '语音识别网络请求失败，请检查网络后重试。',
            'aborted': '录音已中止。'
          };
          if (e.error === 'no-speech' || e.error === 'aborted') {
            // 静默导致的中断：保留已识别内容，按正常停止处理
            active = false;
            try { rec.stop(); } catch (err) { /* 忽略 */ }
            clearInterval(timer);
            fire(finalText.trim());
            if (e.error === 'no-speech' && h.onError) h.onError(map['no-speech']);
            return;
          }
          active = false;
          clearInterval(timer);
          if (h.onState) h.onState('idle');
          if (h.onError) h.onError(map[e.error] || ('语音识别出错：' + (e.error || '未知错误')));
        };

        rec.onend = function () {
          // 连续识别时浏览器会在静默若干秒后自动结束，需在仍录音时重启
          if (active) {
            setTimeout(function () {
              if (!active) return;
              try { rec.start(); } catch (err) { /* 忽略重复启动 */ }
            }, 200);
            return;
          }
          clearInterval(timer);
          fire(finalText.trim());
        };

        try {
          rec.start();
        } catch (e) {
          active = false;
          if (h.onError) h.onError('无法启动录音：' + e.message);
          return false;
        }

        timer = setInterval(tick, 1000);
        if (h.onState) h.onState('recording');
        if (h.onTick) h.onTick(0);
        return true;
      },

      stop: function () {
        if (!active) return;
        active = false;
        clearInterval(timer);
        try { rec.stop(); } catch (e) { fire(finalText.trim()); }
      }
    };

    return api;
  }

  global.App = global.App || {};
  global.App.ai = {
    clean: clean,
    polish: polish,
    organize: organize,
    organizeLocal: organizeLocal,
    recorder: recorder,
    speechSupported: speechSupported,
    compose: compose
  };
})(window);
