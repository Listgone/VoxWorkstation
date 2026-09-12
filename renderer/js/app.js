/* ==========================================
   App - Main application controller v5
   骨架：左侧文字侧边栏 + 主内容
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

  _pageMeta: {
    dub:      ['配音工作台', '选择音色 · 输入文本 · 生成配音'],
    library:  ['音色库',     '管理音色与声纹文件'],
    studio:   ['克隆源',     '音色设计 · 可控克隆 · 极致克隆'],
    music:    ['音乐生成',   'AI 音乐生成（后端未接入）'],
    settings: ['设置',       '外观与后端配置']
  },

  async init() {
    // 主主题「明亮现代」；旧版本存的 dark/其他值一律回落到 light
    const saved = localStorage.getItem('vox-theme');
    document.documentElement.setAttribute('data-theme', saved === 'ink' ? 'ink' : 'light');
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
      setTimeout(() => this._onServerReady(), 500);
      return;
    }

    window.electronAPI.onServerLog?.((line) => this._appendLog(line));
    window.electronAPI.onServerStatus((data) => {
      if (!data) return;
      if (data.status === 'ready') this._onServerReady();
      else if (data.status === 'starting') {
        this._setLoadingText(data.message || '正在启动引擎...');
        this._setSideStatus('启动中…');
      } else if (data.status === 'error') {
        this._onServerError(data.message);
        this._setSideStatus('未连接');
      }
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

  _setSideStatus(text) {
    const el = document.getElementById('side-status');
    if (el) el.textContent = text;
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
    clearInterval(this._loadingTimer);
    this._setSideStatus('已就绪');
    if (this._ready) return;
    this._ready = true;
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'flex';
    // 水墨主题：外壳出现时播一次墨晕化开
    const bloom = document.getElementById('ink-bloom');
    if (bloom) {
      bloom.classList.remove('play');
      void bloom.offsetWidth;          // 强制重排，让动画能重播
      bloom.classList.add('play');
    }
    this._switchModule('dub');
    GpuMonitor.start();
  },

  /* ── 主题（明亮现代 ⇄ 黑白水墨）────────────── */
  _setupThemeToggle() {
    const apply = (theme) => {
      if (theme !== 'ink') theme = 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('vox-theme', theme);
      window.dispatchEvent(new CustomEvent('vox:theme-changed', { detail: { theme } }));
    };
    this.applyTheme = apply;

    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      apply(cur === 'ink' ? 'light' : 'ink');
      const sel = document.getElementById('settings-theme');
      if (sel) sel.value = document.documentElement.getAttribute('data-theme');
    });
  },

  /* ── 侧边栏导航 ───────────────────────────── */
  _setupNav() {
    document.querySelectorAll('#sidebar .nav-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = btn.dataset.module;
        if (!m || m === this._currentModule) return;
        await this._switchModule(m);
      });
    });
  },

  async _switchModule(name) {
    document.querySelectorAll('#sidebar .nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelector('#sidebar .nav-item[data-module="' + name + '"]')?.classList.add('active');
    document.getElementById('module-' + name)?.classList.add('active');

    const module = this._modules[name];
    if (module && !this._inited.has(name)) {
      this._inited.add(name);
      try {
        await module.init(document.getElementById('module-' + name));
      } catch (e) {
        this._inited.delete(name);
        console.error('模块初始化失败:', name, e);
        if (typeof Toast !== 'undefined') Toast.error(this._moduleLabel(name) + ' 加载失败：' + e.message, true);
      }
    }
    module?.onActivate?.();
    this._currentModule = name;

    const scroll = document.querySelector('.page-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _moduleLabel(name) {
    return (this._pageMeta[name] || [name])[0];
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
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12"/><polyline points="8 16 4 16 4 4 16 4 16 8"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
