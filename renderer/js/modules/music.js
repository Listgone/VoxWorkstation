/* ========================================
   MusicModule - AI Music Generation (Placeholder)
   ======================================== */

const MusicModule = {
  async init(container) {
    container.innerHTML = `
      <div class="card">
        <div class="section-title">AI 音乐生成</div>
        <div style="margin-bottom:12px">
          <span onclick="document.getElementById('music-api-area').style.display='block';this.style.display='none'" style="cursor:pointer;color:var(--accent);font-size:12px">+ 设置 Suno API Key</span>
          <div id="music-api-area" style="display:none;margin-top:8px">
            <div class="form-row">
              <input type="password" id="music-api-key" placeholder="输入 Suno API Key" style="flex:1">
              <button class="btn btn-sm btn-ghost" id="music-save-key">保存</button>
            </div>
            <span id="music-key-status" class="text-sm text-muted"></span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">音乐描述 / 歌词</label>
          <textarea id="music-prompt" rows="4" placeholder="例如：一首欢快的钢琴曲，带有轻快的节奏"></textarea>
        </div>
        <div class="form-row mt-8">
          <div class="form-group grow">
            <label class="form-label">模型版本</label>
            <select id="music-model">
              <option value="chirp-v4">Chirp v4</option>
              <option value="chirp-v5" selected>Chirp v5</option>
              <option value="chirp-v6">Chirp v6</option>
            </select>
          </div>
        </div>
        <div class="mt-12">
          <button class="btn btn-primary" id="music-generate-btn" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> 生成音乐
          </button>
          <span class="text-sm text-muted" style="margin-left:8px">待对接 API</span>
        </div>
        <div class="error-msg" id="music-error"></div>
        <div id="music-result" class="mt-8"></div>
      </div>`;
    this._bindEvents();
  },

  _bindEvents() {
    document.getElementById('music-save-key')?.addEventListener('click', () => {
      const key = document.getElementById('music-api-key').value.trim();
      if (key) {
        localStorage.setItem('vox-suno-key', key);
        document.getElementById('music-key-status').textContent = 'API Key 已保存';
      }
    });
    const savedKey = localStorage.getItem('vox-suno-key');
    if (savedKey) { const i = document.getElementById('music-api-key'); if (i) i.value = savedKey; }
  },
  onActivate() {}
};
