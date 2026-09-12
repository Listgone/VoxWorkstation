/* ========================================
   AudioPlayer v4 — waveform + effects
   修复：seek 失效 / 波形按错误宽度绘制 / 下载失败无限递归
   新增：暂停续播 / resize 与主题切换重绘
   ======================================== */

const AudioPlayer = {
  _audioCtx: null,

  _getAudioContext() {
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    return this._audioCtx;
  },

  create(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    container.innerHTML = '<div class="audio-player" style="display:none">'
      + '<canvas class="ap-waveform" height="60"></canvas>'
      + '<div class="ap-controls">'
      + '<button class="btn-icon ap-play-btn" data-state="idle" title="播放"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>'
      + '<div class="ap-progress"><div class="ap-progress-fill"></div></div>'
      + '<span class="ap-time">00:00 / 00:00</span>'
      + '<button class="btn btn-sm btn-ghost ap-dl-btn" title="下载 WAV"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 下载</button>'
      + '</div></div>';

    const el = container.querySelector('.audio-player');
    const canvas = el.querySelector('.ap-waveform');
    const playBtn = el.querySelector('.ap-play-btn');
    const progressBar = el.querySelector('.ap-progress');
    const progressFill = el.querySelector('.ap-progress-fill');
    const timeLabel = el.querySelector('.ap-time');
    const dlBtn = el.querySelector('.ap-dl-btn');
    const playIcon = playBtn.querySelector('svg');

    const ICON_PLAY = '<polygon points="5 3 19 12 5 21 5 3"/>';
    const ICON_PAUSE = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

    let audioBlob = null, dlUrl = '', dlName = 'audio.wav';
    let sourceNode = null, gainNode = null, timer = null, audioBuffer = null;
    let playing = false, offset = 0;          // offset = 暂停/待播位置（秒）
    let _vol = 1.0, _spd = 1.0, _pch = 0;
    let _startTime = 0;

    /* ── 波形绘制 ────────────────────────────────
       必须在元素可见后调用，否则 clientWidth 为 0 会退化成兜底宽度，
       画出来的波形再被 CSS 拉伸 → 模糊变形。 */
    function drawWaveform() {
      if (!audioBuffer) return;
      const w = Math.max(80, Math.round(canvas.clientWidth || container.clientWidth || 400));
      const h = 60;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const data = audioBuffer.getChannelData(0);
      const step = Math.max(1, Math.ceil(data.length / w));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0071e3';
      const mid = h / 2;
      ctx.fillStyle = accent;
      for (let i = 0; i < w; i++) {
        let mx = 0;
        const base = i * step;
        for (let j = 0; j < step; j++) {
          const v = Math.abs(data[base + j] || 0);
          if (v > mx) mx = v;
        }
        const barH = Math.max(1, mx * (mid - 3) * 2);
        ctx.fillRect(i, mid - barH / 2, 1, barH);
      }
    }

    /* ── 位置 / 进度 ─────────────────────────── */
    function currentPos() {
      if (!audioBuffer) return 0;
      const ctx = AudioPlayer._audioCtx;
      if (playing && ctx) {
        return Math.min(audioBuffer.duration, Math.max(0, (ctx.currentTime - _startTime) * _spd));
      }
      return Math.min(offset, audioBuffer.duration);
    }

    function renderPosition() {
      const dur = audioBuffer ? audioBuffer.duration : 0;
      const pos = currentPos();
      progressFill.style.width = (dur ? (pos / dur) * 100 : 0) + '%';
      timeLabel.textContent = Util.fmtTime(pos) + ' / ' + Util.fmtTime(dur);
    }

    function updateProgress() {
      if (!audioBuffer) return;
      renderPosition();
      if (playing && currentPos() >= audioBuffer.duration - 0.02) doStop(true);
    }

    /* ── 播放控制 ────────────────────────────── */
    function setPlayIcon(isPlaying) {
      playIcon.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
      playBtn.dataset.state = isPlaying ? 'playing' : 'idle';
      playBtn.title = isPlaying ? '暂停' : '播放';
    }

    function doPlay(from) {
      if (!audioBuffer || playing) return;
      const start = Math.max(0, Math.min(
        from === undefined ? offset : from,
        Math.max(0, audioBuffer.duration - 0.01)
      ));
      const ctx = AudioPlayer._getAudioContext();
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = _spd;
      sourceNode.detune.value = _pch * 100;
      gainNode = ctx.createGain();
      gainNode.gain.value = _vol;
      sourceNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      sourceNode.onended = () => doStop(true);   // 自然播完 → 回到起点

      _startTime = ctx.currentTime - start / _spd;   // 关键：从 start 处起算
      sourceNode.start(0, start);                    // 关键：带偏移启动
      playing = true;
      offset = start;
      setPlayIcon(true);
      clearInterval(timer);
      timer = setInterval(updateProgress, 100);
      updateProgress();
    }

    function doStop(reset) {
      const node = sourceNode;
      sourceNode = null;
      if (node) {
        node.onended = null;                 // 避免 stop() 触发 onended 递归回调
        try { node.stop(); } catch (e) {}
        try { node.disconnect(); } catch (e) {}
      }
      if (gainNode) { try { gainNode.disconnect(); } catch (e) {} gainNode = null; }
      playing = false;
      clearInterval(timer);
      timer = null;
      if (reset) offset = 0;
      setPlayIcon(false);
      renderPosition();
    }

    function seekToClientX(clientX, element) {
      if (!audioBuffer) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const target = pct * audioBuffer.duration;
      const wasPlaying = playing;
      doStop(false);                 // 暂停但保留位置
      offset = target;
      if (wasPlaying) doPlay(target);
      else renderPosition();
    }

    playBtn.addEventListener('click', () => {
      if (!audioBuffer) return;
      if (playing) {
        doStop(false);                                    // 暂停，保留进度
      } else {
        const atEnd = offset >= audioBuffer.duration - 0.02;
        doPlay(atEnd ? 0 : offset);                       // 播完后重播则从头开始
      }
    });

    progressBar.addEventListener('click', (e) => seekToClientX(e.clientX, progressBar));
    canvas.addEventListener('click', (e) => seekToClientX(e.clientX, canvas));

    /* ── 下载 ─────────────────────────────────── */
    function triggerDownload(url, name) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    dlBtn.addEventListener('click', () => doDownload());

    async function doDownload() {
      if (dlBtn.disabled) return;
      if (!audioBlob && !dlUrl) return;
      // 未做任何处理 → 直接下载原始音频
      if (_vol === 1.0 && _spd === 1.0 && _pch === 0) {
        const url = dlUrl || URL.createObjectURL(audioBlob);
        triggerDownload(url, dlName);
        if (!dlUrl) setTimeout(() => URL.revokeObjectURL(url), 10000);
        return;
      }
      dlBtn.disabled = true;
      try {
        const processed = await processAudio(audioBuffer, _vol, _spd, _pch);
        const url = URL.createObjectURL(processed);
        triggerDownload(url, dlName);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        // 注意：这里绝不能再触发 dlBtn.click()，否则编码持续失败会无限递归
        if (typeof Toast !== 'undefined') {
          Toast.error('导出失败：' + ((err && err.message) || '音频编码错误'));
        }
      } finally {
        dlBtn.disabled = false;
      }
    }

    async function processAudio(buffer, vol, spd, pch) {
      const sr = buffer.sampleRate;
      const dur = buffer.duration / spd;
      const offline = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(sr * dur), sr);
      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = spd;
      src.detune.value = pch * 100;
      const gn = offline.createGain();
      gn.gain.value = vol;
      src.connect(gn);
      gn.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      return encodeWav(rendered);
    }

    function encodeWav(buffer) {
      const numChannels = buffer.numberOfChannels;
      const length = buffer.length * numChannels * 2 + 44;
      const ab = new ArrayBuffer(length);
      const view = new DataView(ab);
      function writeStr(off, str) { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); }
      writeStr(0, 'RIFF'); view.setUint32(4, length - 8, true); writeStr(8, 'WAVE');
      writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true); view.setUint32(24, buffer.sampleRate, true);
      view.setUint32(28, buffer.sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true);
      writeStr(36, 'data'); view.setUint32(40, length - 44, true);
      let off = 44;
      const chData = [];
      for (let c = 0; c < numChannels; c++) chData.push(buffer.getChannelData(c));
      for (let i = 0; i < buffer.length; i++) {
        for (let c = 0; c < numChannels; c++) {
          const s = Math.max(-1, Math.min(1, chData[c][i]));
          view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          off += 2;
        }
      }
      return new Blob([ab], { type: 'audio/wav' });
    }

    /* ── 重绘：容器尺寸变化 / 主题切换 ────────── */
    const redraw = Util.debounce(() => { if (audioBuffer) drawWaveform(); }, 120);
    let resizeObserver = null;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(redraw);
      resizeObserver.observe(canvas);
    }
    const onThemeChange = () => redraw();
    window.addEventListener('vox:theme-changed', onThemeChange);

    /* ── 对外接口 ────────────────────────────── */
    return {
      get vol() { return _vol; },
      set vol(v) { _vol = Math.max(0, Math.min(2, v)); if (gainNode) gainNode.gain.value = _vol; },
      get spd() { return _spd; },
      set spd(v) { _spd = Math.max(0.25, Math.min(4, v)); if (sourceNode) sourceNode.playbackRate.value = _spd; },
      get pch() { return _pch; },
      set pch(v) { _pch = Math.max(-12, Math.min(12, v)); if (sourceNode) sourceNode.detune.value = _pch * 100; },

      async load(blob, url, filename) {
        doStop(true);
        audioBlob = blob || null;
        dlUrl = url || '';
        dlName = filename || 'audio.wav';
        el.style.display = 'flex';          // 先可见，才能量到真实宽度
        try {
          const ctx = AudioPlayer._getAudioContext();
          const ab = await blob.arrayBuffer();
          audioBuffer = await ctx.decodeAudioData(ab);
          offset = 0;
          drawWaveform();
          renderPosition();
        } catch (e) {
          audioBuffer = null;
          offset = 0;
          progressFill.style.width = '0%';
          timeLabel.textContent = '解码失败';
          if (typeof Toast !== 'undefined') Toast.error('音频解码失败，文件可能已损坏');
        }
      },

      /** 从后端 URL 加载（历史记录用） */
      async loadUrl(url, filename) {
        el.style.display = 'flex';
        timeLabel.textContent = '加载中...';
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const blob = await resp.blob();
          await this.load(blob, url, filename);
        } catch (e) {
          audioBuffer = null;
          timeLabel.textContent = '加载失败';
          if (typeof Toast !== 'undefined') Toast.error('音频加载失败：' + e.message);
        }
      },

      hide() { doStop(true); el.style.display = 'none'; audioBuffer = null; },

      /** 触发当前音频的下载（供外部「导出 WAV」按钮调用） */
      download() { return doDownload(); },

      /** 从头/当前位置开始播放 */
      play() {
        if (!audioBuffer || playing) return;
        const atEnd = offset >= audioBuffer.duration - 0.02;
        doPlay(atEnd ? 0 : offset);
      },

      get hasAudio() { return !!audioBuffer; },

      destroy() {
        doStop(true);
        window.removeEventListener('vox:theme-changed', onThemeChange);
        if (resizeObserver) resizeObserver.disconnect();
      }
    };
  }
};
