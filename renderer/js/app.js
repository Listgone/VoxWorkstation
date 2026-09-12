/* ==========================================
   App - Main application controller v4
   ========================================== */

const App = {
  _currentModule: 'dub',
  _inited: new Set(),
  _ready: false,
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
    this._setupThemeToggle();
    this._setupNav();
    this._setupServerStatus();
  },

  /* ── 后端启动状态 ─────────────────────────── */
  _setupServerStatus() {
    this._startLoadingTicker();

    if (!window.electronAPI) {
      // 浏览器里直接打开（无 Electron 壳）：给个兜底，方便单独调试 UI
      setTimeout(() => this._onServerReady(), 500);
      return;
    }

    window.electronAPI.onServerLog?.((line) => this._appendLog(line));
    window.electronAPI.onServerStatus((data) => {
      if (!data) return;
      if (data.status === 'ready') this._onServerReady();
      else if (data.status === 'starting') this._setLoadingText(data.message || '正在启动引擎...');
      else if (data.status === 'error') this._onServerError(data.message);
    });

    document.getElementById('loading-retry')?.addEventListener('click', async () => {
      const overlay = document.getElementById('loading-overlay');
      overlay?.classList.remove('is-error');
      this._setLoadingText('正在重新启动 VoxCPM2 引擎...');
      this._appendLog('');
      this._startLoadingTicker();
      try {
        const res = await window.electronAPI.restartServer();
        if (res && res.ok === false) this._onServerError(res.message || '启动失败');
      } catch (e) {
        this._onServerError(e.message);
      }
    });
  },

  _startLoadingTicker() {
    this._loadingStart = Date.now();
    clearInterval(this._loadingTimer);
    const el = document.getElementById('loading-elapsed');
    const tick = () => {
      if (el) el.textContent = '已等待 ' + Math.round((Date.now() - this._loadingStart) / 1000) + ' 秒';
    };
    tick();
    this._loadingTimer = setInterval(tick, 1000);
  },

  _setLoadingText(text) {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
  },

  _appendLog(line) {
    this._logLines = (this._logLines || []).concat(line).slice(-4);
    const el = document.getElementById('loading-log');
    if (el) el.textContent = this._logLines.join('\n').trim();
  },

  _onServerError(message) {
    clearInterval(this._loadingTimer);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('is-error');
    this._setLoadingText('启动失败：' + (message || '未知错误'));
    this._appendLog('提示：可在 vox.config.json 里配置 serverDir / pythonPath');
  },

  _onServerReady() {
    if (this._ready) return;
    this._ready = true;
    clearInterval(this._loadingTimer);
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'flex';
    this._switchModule('dub');
    GpuMonitor.start();
  },

  /* ── 主题 ─────────────────────────────────── */
  _setupThemeToggle() {
    const apply = (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('vox-theme', theme);
      // 让波形等 canvas 重绘以取到新的 --accent
      window.dispatchEvent(new CustomEvent('vox:theme-changed', { detail: { theme } }));
    };
    this.applyTheme = apply;

    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(next);
      const sel = document.getElementById('settings-theme');
      if (sel) sel.value = next;
    });
  },

  /* ── 导航 ─────────────────────────────────── */
  _setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = btn.dataset.module;
        if (!m || m === this._currentModule) return;
        await this._switchModule(m);
      });
    });
  },

  async _switchModule(name) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelector('.nav-btn[data-module="' + name + '"]')?.classList.add('active');
    document.getElementById('module-' + name)?.classList.add('active');
    document.getElementById('side-panel')?.classList.toggle('visible', name === 'dub');

    const module = this._modules[name];
    if (module && !this._inited.has(name)) {
      this._inited.add(name);
      try {
        await module.init(document.getElementById('module-' + name));
      } catch (e) {
        // 初始化失败不要留下半截 DOM，允许下次再试
        this._inited.delete(name);
        console.error('模块初始化失败:', name, e);
        if (typeof Toast !== 'undefined') Toast.error(this._moduleLabel(name) + ' 加载失败：' + e.message, true);
      }
    }
    module?.onActivate?.();
    this._currentModule = name;
  },

  _moduleLabel(name) {
    return { dub: '配音工作台', library: '音色库', studio: '克隆源', music: '音乐生成', settings: '设置' }[name] || name;
  },

  /* ── 窗口按钮 ─────────────────────────────── */
  _setupWindowControls() {
    document.getElementById('btn-min')?.addEventListener('click', () => window.electronAPI?.minimize());
    document.getElementById('btn-max')?.addEventListener('click', async () => {
      await window.electronAPI?.maximize();
      this._updateMaxIcon();
    });
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
