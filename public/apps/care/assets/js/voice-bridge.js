/* ============================================================
 * voice-bridge.js —— 电脑端语音桥接模块
 *
 * 流程：
 *   1. 「语音录入」按钮 → 弹出二维码面板
 *   2. 手机微信扫码 → 打开 record.html → 录音并上传
 *   3. 电脑端轮询会话状态 → 检测到 uploaded
 *   4. 若配置了 ASR 接口 → 自动转写为文字 → 回调
 *      若未配置 ASR → 返回音频 URL → 回调提示手动输入
 *   5. 「录音文件上传」按钮 → 直接选本地音频文件 → 同样转写
 *
 * 依赖：App.ui (模态框/toast), App.store (ASR 配置)
 * ============================================================ */
(function (global) {
  'use strict';

  var App = global.App;
  var ui = App.ui;
  var $ = ui.$, esc = ui.esc;

  var POLL_INTERVAL = 1500;
  var POLL_TIMEOUT = 5 * 60 * 1000;

  function fetchJSON(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        ui.toast('链接已复制', 'ok');
      });
    } else {
      ui.toast('请手动复制链接', '');
    }
  }

  /**
   * 创建录音会话
   */
  function createSession() {
    return fetchJSON('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  }

  /**
   * 查询会话状态
   */
  function getStatus(sid) {
    return fetchJSON('/api/voice/status?sid=' + encodeURIComponent(sid));
  }

  /**
   * 调用 ASR 转写
   */
  function transcribe(sid) {
    var cfg = App.store.settings();
    return fetchJSON('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sid: sid,
        asr: {
          url: cfg.asrUrl || '',
          key: cfg.asrKey || '',
          model: cfg.asrModel || 'whisper-1'
        }
      })
    });
  }

  /* ============================================================
   * 语音录入弹窗（二维码模式）
   * opts: { module: 'talks'|'contacts', onText: function(text), onAudio: function(sid) }
   * ============================================================ */
  function openEnterDialog(opts) {
    opts = opts || {};
    var onText = opts.onText || function () {};
    var onAudio = opts.onAudio || function () {};
    var timer = null;
    var startTime = Date.now();
    var sid = null;

    var bodyHTML =
      '<div style="text-align:center;padding:4px 0">' +
      '<div style="margin-bottom:14px;color:#5a6577;font-size:13px;line-height:1.8">' +
      '① 用微信扫描右侧二维码<br>② 在手机页面点击绿色按钮录音<br>③ 录音完成后自动上传并转写' +
      '</div>' +
      '<div id="qrSlot" style="margin:0 auto 14px;width:200px;height:200px;border:1px solid #e5e9f0;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fafbfd">' +
      '<span style="color:#b0b8c8;font-size:13px">二维码生成中…</span>' +
      '</div>' +
      '<div id="qrStatus" style="font-size:13px;color:#5a6577;margin-bottom:10px;min-height:20px">等待手机扫码…</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap">' +
      '<input id="qrLink" class="input" style="width:260px;font-size:12px" readonly>' +
      '<button class="btn btn-sm" id="qrCopyBtn">复制链接</button>' +
      '</div>' +
      '<div style="margin-top:18px;border-top:1px dashed #e5e9f0;padding-top:14px">' +
      '<div style="font-size:12px;color:#8b95a7;margin-bottom:8px">或直接上传已有录音文件</div>' +
      '<button class="btn" id="fileUploadBtn" style="width:100%">' +
      '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>' +
      '</svg>录音文件上传' +
      '</button>' +
      '<input type="file" id="fileInput" accept="audio/*" hidden>' +
      '</div>' +
      '</div>';

    var ctx = ui.modal({
      title: '语音录入',
      bodyHTML: bodyHTML,
      buttons: [
        { text: '取消', cls: 'btn' }
      ]
    });

    var el = ctx.el;
    var qrSlot = $('#qrSlot', el);
    var qrStatus = $('#qrStatus', el);
    var qrLink = $('#qrLink', el);

    function setStatus(html, color) {
      qrStatus.innerHTML = html;
      qrStatus.style.color = color || '#5a6577';
    }

    function close() { stopPoll(); ctx.close(); }

    function stopPoll() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function handleUploaded() {
      setStatus('录音已上传，正在转写…', '#5a6cf0');

      var cfg = App.store.settings();
      if (!cfg.asrUrl) {
        // 没有配置 ASR → 返回音频供手动输入
        setStatus(
          '录音已上传！<br><b style="color:#07c160">未配置语音识别接口</b>，请手动输入谈话内容。<br>' +
          '或前往「系统设置」配置 ASR 接口后可实现自动转写。',
          '#07c160'
        );

        // 尝试播放音频
        if (sid) {
          onAudio(sid);
        }
        ui.toast('录音已接收，请手动输入内容', 'ok');
        return;
      }

      // 配置了 ASR → 自动转写
      transcribe(sid).then(function (data) {
        if (data.text && data.text.trim()) {
          setStatus('转写完成！正在整理…', '#07c160');
          onText(data.text.trim());
          setTimeout(close, 600);
        } else {
          setStatus('语音识别返回空结果，请手动输入。', '#c07a08');
        }
      }).catch(function (e) {
        setStatus(
          '语音识别失败：' + esc(e.message) + '<br>请手动输入，或检查「系统设置」中的 ASR 配置。',
          '#d0453b'
        );
        ui.toast('语音识别失败，请手动输入', 'err');
      });
    }

    function poll() {
      if (Date.now() - startTime > POLL_TIMEOUT) {
        stopPoll();
        setStatus('等待超时，请重新打开语音录入。', '#c07a08');
        return;
      }

      getStatus(sid).then(function (st) {
        if (st.state === 'scanned') {
          setStatus('手机已连接，等待录音…', '#07c160');
        } else if (st.state === 'uploaded') {
          stopPoll();
          handleUploaded();
        }
      }).catch(function () {
        // 会话可能过期
      });
    }

    // 初始化会话和二维码
    createSession().then(function (data) {
      sid = data.sid;

      // 获取局域网地址
      return fetchJSON('/api/local-url');
    }).then(function (info) {
      var recordUrl = 'http://' + info.ip + ':' + info.port + '/record?sid=' + sid + '&module=' + (opts.module || 'talks');
      qrLink.value = recordUrl;

      // 用 API 生成二维码 PNG
      var img = new Image();
      img.onload = function () {
        qrSlot.innerHTML = '';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        qrSlot.appendChild(img);
      };
      img.onerror = function () {
        qrSlot.innerHTML = '<span style="color:#d0453b;font-size:13px">二维码生成失败</span>';
      };
      img.src = '/api/qr?text=' + encodeURIComponent(recordUrl);

      // 启动轮询
      timer = setInterval(poll, POLL_INTERVAL);
      poll();
    }).catch(function (e) {
      setStatus('无法连接本地服务：' + esc(e.message) + '<br>请确认已运行 node serve.js', '#d0453b');
    });

    // 复制链接按钮
    $('#qrCopyBtn', el).addEventListener('click', function () {
      copyToClipboard(qrLink.value);
    });

    // 文件上传按钮
    var fileBtn = $('#fileUploadBtn', el);
    var fileInput = $('#fileInput', el);

    fileBtn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) {
        ui.toast('文件过大，请选择 25MB 以内的音频', 'err');
        return;
      }

      stopPoll();
      setStatus('正在上传文件…', '#5a6cf0');

      // 如果没有 sid，先创建一个
      var p = sid ? Promise.resolve({ sid: sid }) : createSession();
      p.then(function (data) {
        sid = data.sid;
        var fd = new FormData();
        fd.append('sid', sid);
        fd.append('audio', file, file.name);

        return fetch('/api/voice/upload', { method: 'POST', body: fd }).then(function (r) { return r.json(); });
      }).then(function () {
        return transcribe(sid);
      }).then(function (data) {
        if (data.text && data.text.trim()) {
          setStatus('转写完成！正在整理…', '#07c160');
          onText(data.text.trim());
          setTimeout(close, 600);
        } else {
          setStatus(
            data.error ? esc(data.error) : '语音识别返回空结果，请手动输入。',
            '#c07a08'
          );
          if (sid) onAudio(sid);
        }
      }).catch(function (e) {
        setStatus(
          '处理失败：' + esc(e.message) + '<br>' +
          (sid ? '录音已保存，可手动输入内容。' : '请确认已配置 ASR 接口。'),
          '#d0453b'
        );
        if (sid) onAudio(sid);
      });
    });
  }

  /**
   * 获取音频 URL（用于播放器）
   */
  function audioUrl(sid) {
    return '/api/voice/audio?sid=' + encodeURIComponent(sid);
  }

  global.App = global.App || {};
  global.App.voice = {
    openEnterDialog: openEnterDialog,
    audioUrl: audioUrl
  };
})(window);
