/* ==========================================
   App - Main application controller v3
   ========================================== */

const App = {
  _currentModule: 'dub',
  _modules: {
    dub: DubModule,
    library: LibraryModule,
    studio: StudioModule,
    music: MusicModule,
    settings: SettingsModule
  },

  async init() {
    const savedTheme = localStorage.getItem('vox-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    await API.init();
    this._setupWindowControls();

    if (window.electronAPI) {
      window.electronAPI.onServerStatus((data) => {
        if (data.status === 'ready') {
          this._onServerReady();
        } else if (data.status === 'error') {
          document.getElementById('loading-text').textContent = '启动失败: ' + data.message;
        }
      });
    } else {
      setTimeout(() => this._onServerReady(), 500);
    }

    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('vox-theme', next);
      const sel = document.getElementById('settings-theme');
      if (sel) sel.value = next;
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = btn.dataset.module;
        if (!m || m === this._currentModule) return;
        await this._switchModule(m);
      });
    });
  },

  async _onServerReady() {
    document.getElementById('loading-overlay').style.display = 'none';
    document.getElementById('app-shell').style.display = 'flex';
    await this._switchModule('dub');
    GpuMonitor.start();
  },

  async _switchModule(name) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelector('.nav-btn[data-module="' + name + '"]')?.classList.add('active');
    document.getElementById('module-' + name)?.classList.add('active');
    document.getElementById('side-panel').classList.toggle('visible', name === 'dub');
    const module = this._modules[name];
    if (module && document.getElementById('module-' + name)?.children.length === 0) {
      await module.init(document.getElementById('module-' + name));
    }
    module?.onActivate?.();
    this._currentModule = name;
  },

  _moduleLabel(name) {
    return { dub:'配音工作台', library:'音色库', studio:'克隆源', music:'音乐生成', settings:'设置' }[name] || name;
  },

  _setupWindowControls() {
    document.getElementById('btn-min')?.addEventListener('click', () => window.electronAPI?.minimize());
    document.getElementById('btn-max')?.addEventListener('click', async () => { await window.electronAPI?.maximize(); this._updateMaxIcon(); });
    document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.close());
    window.addEventListener('resize', () => this._updateMaxIcon());
  },

  _updateMaxIcon() {
    const btn = document.getElementById('btn-max');
    if (!btn) return;
    const m = window.outerWidth >= screen.availWidth - 10 && window.outerHeight >= screen.availHeight - 10;
    btn.innerHTML = m
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12"/><polyline points="8 16 4 16 4 4 16 4 16 8"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
