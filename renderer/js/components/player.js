/* ========================================
   AudioPlayer v3 — waveform + effects
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
      + '<canvas class="ap-waveform" width="800" height="60"></canvas>'
      + '<div class="ap-controls">'
      + '<button class="btn-icon ap-play-btn" title="播放"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>'
      + '<div class="ap-progress"><div class="ap-progress-fill"></div></div>'
      + '<span class="ap-time">00:00 / 00:00</span></div>'
      + '<div class="ap-actions"><button class="btn btn-sm btn-ghost ap-dl-btn">下载</button></div></div>';

    const el = container.querySelector('.audio-player');
    const canvas = el.querySelector('.ap-waveform');
    const playBtn = el.querySelector('.ap-play-btn');
    const progressBar = el.querySelector('.ap-progress');
    const progressFill = el.querySelector('.ap-progress-fill');
    const timeLabel = el.querySelector('.ap-time');
    const dlBtn = el.querySelector('.ap-dl-btn');
    const playIcon = playBtn.querySelector('svg');

    let audioBlob = null, dlUrl = '', dlName = 'audio.wav';
    let sourceNode = null, gainNode = null, timer = null, audioBuffer = null, playing = false;
    let _vol = 1.0, _spd = 1.0, _pch = 0;
    let _startTime = 0;

    function fmt(sec) { const m=Math.floor(sec/60); const s=Math.floor(sec%60); return m+':'+String(s).padStart(2,'0'); }

    function drawWaveform(buffer) {
      const ctx = canvas.getContext('2d');
      const w = canvas.offsetWidth || 400;
      const h = 60;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(devicePixelRatio, devicePixelRatio);
      const data = buffer.getChannelData(0);
      const step = Math.ceil(data.length / w);
      ctx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#0071e3';
      ctx.fillStyle = accent;
      for (let i = 0; i < w; i++) {
        let mx = 0;
        for (let j = 0; j < step; j++) { const v = Math.abs(data[i*step+j]||0); if(v>mx)mx=v; }
        ctx.fillRect(i, 30-mx*27, 1, Math.max(1,mx*54));
      }
    }

    function updateProgress() {
      const ctx = AudioPlayer._audioCtx;
      if (!ctx || !audioBuffer) return;
      const ct = (ctx.currentTime - _startTime) * _spd;
      const dur = audioBuffer.duration;
      progressFill.style.width = Math.min(100, dur?(ct/dur)*100:0) + '%';
      timeLabel.textContent = fmt(Math.min(ct, dur)) + ' / ' + fmt(dur);
      if (ct >= dur && dur > 0) doStop();
    }

    function doPlay() {
      if (!audioBuffer || playing) return;
      const ctx = AudioPlayer._getAudioContext();
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.playbackRate.value = _spd;
      sourceNode.detune.value = _pch * 100;
      gainNode = ctx.createGain();
      gainNode.gain.value = _vol;
      sourceNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      sourceNode.onended = () => doStop();
      _startTime = ctx.currentTime;
      sourceNode.start(0);
      playing = true;
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      timer = setInterval(updateProgress, 150);
    }

    function doStop() {
      if (sourceNode) { try{sourceNode.stop()}catch(e){} sourceNode.disconnect(); sourceNode=null; }
      if (gainNode) { gainNode.disconnect(); gainNode=null; }
      playing = false;
      clearInterval(timer);
      playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      progressFill.style.width = '0%';
      if (audioBuffer) timeLabel.textContent = '00:00 / ' + fmt(audioBuffer.duration);
    }

    playBtn.addEventListener('click', () => { if (audioBuffer) playing ? doStop() : doPlay(); });
    progressBar.addEventListener('click', (e) => {
      if (!audioBuffer) return;
      const pct = (e.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth;
      doStop();
      _startTime = AudioPlayer._getAudioContext().currentTime - pct * audioBuffer.duration / _spd;
      doPlay();
    });
    canvas.addEventListener('click', (e) => {
      if (!audioBuffer) return;
      const pct = (e.clientX - canvas.getBoundingClientRect().left) / canvas.offsetWidth;
      doStop();
      _startTime = AudioPlayer._getAudioContext().currentTime - pct * audioBuffer.duration / _spd;
      doPlay();
    });
    dlBtn.addEventListener('click', async () => {
      if (!audioBlob && !dlUrl) return;
      if (_vol === 1.0 && _spd === 1.0 && _pch === 0) {
        const url = dlUrl || URL.createObjectURL(audioBlob);
        const a = document.createElement('a'); a.href = url; a.download = dlName; a.click();
        if (!dlUrl) URL.revokeObjectURL(url);
      } else {
        try {
          const processed = await processAudio(audioBuffer, _vol, _spd, _pch);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(processed);
          a.download = dlName; a.click();
        } catch(e) { dlBtn.click(); }
      }
    });

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
      function writeStr(off, str) { for (let i=0;i<str.length;i++) view.setUint8(off+i,str.charCodeAt(i)); }
      writeStr(0,'RIFF'); view.setUint32(4,length-8,true); writeStr(8,'WAVE');
      writeStr(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
      view.setUint16(22,numChannels,true); view.setUint32(24,buffer.sampleRate,true);
      view.setUint32(28,buffer.sampleRate*numChannels*2,true);
      view.setUint16(32,numChannels*2,true); view.setUint16(34,16,true);
      writeStr(36,'data'); view.setUint32(40,length-44,true);
      let off = 44;
      const chData = [];
      for (let c=0;c<numChannels;c++) chData.push(buffer.getChannelData(c));
      for (let i=0;i<buffer.length;i++) {
        for (let c=0;c<numChannels;c++) {
          const s = Math.max(-1,Math.min(1,chData[c][i]));
          view.setInt16(off, s<0?s*0x8000:s*0x7FFF, true);
          off += 2;
        }
      }
      return new Blob([ab],{type:'audio/wav'});
    }

    return {
      get vol() { return _vol; },
      set vol(v) { _vol = Math.max(0,Math.min(2,v)); if(gainNode)gainNode.gain.value=_vol; },
      get spd() { return _spd; },
      set spd(v) { _spd = Math.max(0.25,Math.min(4,v)); if(sourceNode)sourceNode.playbackRate.value=_spd; },
      get pch() { return _pch; },
      set pch(v) { _pch = Math.max(-12,Math.min(12,v)); if(sourceNode)sourceNode.detune.value=_pch*100; },

      async load(blob, url, filename) {
        doStop();
        audioBlob = blob; dlUrl = url||''; dlName = filename||'audio.wav';
        try {
          const ctx = AudioPlayer._getAudioContext();
          const ab = await blob.arrayBuffer();
          audioBuffer = await ctx.decodeAudioData(ab);
          drawWaveform(audioBuffer);
          el.style.display = 'flex';
          progressFill.style.width = '0%';
          timeLabel.textContent = '00:00 / ' + fmt(audioBuffer.duration);
        } catch(e) { el.style.display = 'flex'; timeLabel.textContent = '解码失败'; }
      },

      hide() { doStop(); el.style.display = 'none'; audioBuffer = null; }
    };
  }
};
