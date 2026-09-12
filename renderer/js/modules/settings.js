/* ========================================
   SettingsModule
   ======================================== */

const SettingsModule = {
  _config: null,

  async init(container) {
    container.innerHTML = '<div class="card"><div class="section-title">外观</div>'
      + '<div class="form-group"><label class="form-label">主题</label><select id="settings-theme"><option value="light">明亮现代</option><option value="ink">黑白水墨</option></select></div></div>'
      + '<div class="card"><div class="section-title">后端</div>'
      + '<div class="form-group"><label class="form-label">服务地址</label><input type="text" id="settings-server-url" readonly></div>'
      + '<div class="form-group mt-8"><label class="form-label">后端目录</label><input type="text" id="settings-server-dir" readonly></div>'
      + '<div class="form-group mt-8"><label class="form-label">Python</label><input type="text" id="settings-python" readonly></div>'
      + '<p class="text-sm text-muted mt-8">如需修改，编辑应用目录下的 vox.config.json 后重启。</p></div>'
      + '<div class="card"><div class="section-title">关于</div><p class="text-sm text-secondary">VoxWorkstation v1.0</p><p class="text-sm text-muted mt-4">VoxCPM2 AI 配音工作台</p><p class="text-sm text-muted mt-4">FastAPI + VoxCPM2 / Electron + Vanilla JS</p></div>';

    const sel = document.getElementById('settings-theme');
    sel.value = document.documentElement.getAttribute('data-theme') || 'dark';
    sel.addEventListener('change', () => {
      // 走 App.applyTheme，让波形等 canvas 一起重绘
      if (App.applyTheme) App.applyTheme(sel.value);
      else document.documentElement.setAttribute('data-theme', sel.value);
    });

    // 后端信息（只读展示，便于排查"连不上"）
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || '—'; };
    set('settings-server-url', API.baseUrl);
    if (window.electronAPI?.getConfig) {
      try {
        const cfg = await window.electronAPI.getConfig();
        set('settings-server-dir', cfg.serverDir);
        set('settings-python', cfg.pythonPath);
      } catch (e) { /* 非 Electron 环境忽略 */ }
    }
  },

  onActivate() {}
};
