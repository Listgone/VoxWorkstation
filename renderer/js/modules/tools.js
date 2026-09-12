/* ========================================
   ToolsModule - Audio Convert Only
   ======================================== */

const ToolsModule = {
  async init(container) {
    container.innerHTML = '<div class="card"><div class="section-title">Audio Convert</div>'
      + '<div class="form-row"><div class="form-group grow"><label class="form-label">Audio File</label><input type="file" id="tools-audio-file" accept="audio/*"></div></div>'
      + '<div class="form-row"><div class="form-group grow"><label class="form-label">Format</label><select id="tools-audio-format"><option value="mp3">MP3</option><option value="wav">WAV</option><option value="ogg">OGG</option><option value="flac">FLAC</option><option value="aac">AAC</option><option value="m4a">M4A</option></select></div></div>'
      + '<div class="form-row"><div class="form-group grow"><label class="form-label">Sample Rate (Hz)</label><input type="range" id="tools-audio-sr" min="8000" max="96000" value="44100" step="100"><span class="param-val" id="tools-audio-sr-val">44100</span></div></div>'
      + '<div class="form-row"><div class="form-group grow"><label class="form-label">Bitrate</label><select id="tools-audio-bitrate"><option value="64k">64 kbps</option><option value="128k">128 kbps</option><option value="192k" selected>192 kbps</option><option value="256k">256 kbps</option><option value="320k">320 kbps</option></select></div></div>'
      + '<button class="btn btn-primary mt-8" id="tools-convert-btn">Convert</button>'
      + '<div class="error-msg" id="tools-error"></div><div id="tools-result" class="mt-8"></div></div>';
    this._bindEvents();
  },
  _bindEvents() {
    document.getElementById('tools-audio-sr')?.addEventListener('input', function() { document.getElementById('tools-audio-sr-val').textContent = this.value; });
    document.getElementById('tools-convert-btn')?.addEventListener('click', () => this._convert());
  },
  async _convert() {
    const file = document.getElementById('tools-audio-file').files[0];
    if (!file) return this._showError('Select audio file');
    const fmt = document.getElementById('tools-audio-format').value;
    const sr = parseInt(document.getElementById('tools-audio-sr').value);
    const br = document.getElementById('tools-audio-bitrate').value;
    const btn = document.getElementById('tools-convert-btn');
    btn.disabled = true; btn.textContent = 'Converting...';
    try { const r = await API.convertAudio(file, fmt, sr, br); if (r.blob) { const url = URL.createObjectURL(r.blob); const a = document.createElement('a'); a.href = url; a.download = 'converted.' + fmt; a.click(); } }
    catch(e) { this._showError(e.message); }
    finally { btn.disabled = false; btn.textContent = 'Convert'; }
  },
  _showError(msg) { const el = document.getElementById('tools-error'); if(el){el.textContent=msg;el.classList.add('show');} },
  onActivate() {}
};
