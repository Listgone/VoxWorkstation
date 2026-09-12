/* ========================================
   SettingsModule
   ======================================== */

const SettingsModule = {
  async init(container) {
    container.innerHTML = '<div class="card"><div class="section-title">外观</div>'
      + '<div class="form-group"><label class="form-label">主题</label><select id="settings-theme"><option value="dark">暗色</option><option value="light">亮色</option></select></div></div>'
      + '<div class="card"><div class="section-title">关于</div><p class="text-sm text-secondary">VoxWorkstation v1.0</p><p class="text-sm text-muted mt-4">VoxCPM2 AI 配音工作台</p><p class="text-sm text-muted mt-4">FastAPI + VoxCPM2 / Electron + Vanilla JS</p></div>';
    const sel = document.getElementById('settings-theme');
    sel.value = document.documentElement.getAttribute('data-theme') || 'dark';
    sel.addEventListener('change', () => { document.documentElement.setAttribute('data-theme', sel.value); localStorage.setItem('vox-theme', sel.value); });
  },
  onActivate() {}
};
