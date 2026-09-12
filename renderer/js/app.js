/* ==========================================
   App —— 外壳、路由、项目上下文
   ========================================== */

const App = {
  current: 'dash',
  _rendered: {},
  _pages: {
    dash:                () => DashPage,
    projects:            () => ProjectsPage,
    'project-settings':  () => ProjectSettingsPage,
    episodes:            () => EpisodesPage,
    text:                () => TextPage,
    dub:                 () => DubPage,
    export:              () => ExportPage,
    voices:              () => VoicesPage,
    settings:            () => SettingsPage
  },

  async init() {
    // 主题（在 Store 就绪前先用本地缓存，避免闪白）
    const savedTheme = localStorage.getItem('vox-theme') || 'light';
    document.documentElement.setAttribute('data-theme',
      ['glass', 'construct'].includes(savedTheme) ? savedTheme : 'light');

    this._setupWindowControls();
    this._setupThemeToggle();
    this._setupNav();
    this._setupServerStatus();
    Shortcuts.init();

    await API.init();
    try { window.__voxConfig = await window.electronAPI.getConfig(); } catch (e) { window.__voxConfig = {}; }

    await Store.init();

    // 用设置里的主题 / 动效 / 缩放覆盖本地缓存
    const st = Store.settings || {};
    if (st.theme) document.documentElement.setAttribute('data-theme',
      ['glass', 'construct'].includes(st.theme) ? st.theme : 'light');
    document.documentElement.setAttribute('data-reduce-motion', st.reduceMotion ? 'true' : 'false');
    if (Number(st.uiScale) && Number(st.uiScale) !== 1) {
      document.body.style.zoom = String(Number(st.uiScale));
    }

    Store.on(() => { this._syncChrome(); });
    this._syncChrome();
  },

  /* ── 路由 ─────────────────────────────────── */
  async go(page, opts = {}) {
    const factory = this._pages[page];
    if (!factory) return;
    const mod = factory();
    this.current = page;

    document.querySelectorAll('#sidebar .nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('active', p.id === 'page-' + page));

    const el = document.getElementById('page-' + page);
    if (!el) return;

    // 每次都重渲染：数据随时可能变，页面也不重，代价可接受
    try {
      el.innerHTML = mod.render ? mod.render() : '';
      if (mod.mount) await mod.mount(el, opts);
    } catch (e) {
      console.error('页面渲染失败:', page, e);
      el.innerHTML = '<div class="wrap"><div class="card"><h2>页面加载失败</h2>'
        + '<p class="text-sm text-muted">' + Util.escapeHtml(e.message) + '</p></div></div>';
      if (typeof Toast !== 'undefined') Toast.error('页面加载失败：' + e.message, true);
    }

    const sc = document.getElementById('page-scroll');
    if (sc) sc.scrollTop = 0;
    // 页面渲染完，把原生 select 换成统一样式的下拉
    Select.enhance(el);
    this._syncStatus();
  },

  /** 页头（标题 + 描述 + 右侧操作）*/
  head(title, desc, right) {
    return '<div class="phead"><h1>' + Util.escapeHtml(title) + '</h1>'
      + (desc ? '<span class="desc">' + Util.escapeHtml(desc) + '</span>' : '')
      + '<span class="sp"></span>' + (right || '') + '</div>';
  },

  /* ── 顶部面包屑（可点开直接切换项目 / 集）───── */
  _syncChrome() {
    const crumb = document.getElementById('crumb');
    if (!crumb) return;
    const p = Store.currentProject;
    if (!p) {
      crumb.innerHTML = '<span class="seg" data-act="pick-project">未选择项目 ▾</span>';
    } else {
      const ep = Store.currentEpisode ? Store.currentEpisode.episode : null;
      crumb.innerHTML =
        '<span class="seg" data-act="pick-project">' + Util.escapeHtml(p.name) + ' ▾</span>'
        + (ep ? '<span class="sl">/</span><span class="seg cur" data-act="pick-episode">'
              + Util.escapeHtml('第' + String(ep.no).padStart(p.padWidth || 2, '0') + '集'
              + (ep.title ? ' · ' + ep.title : '')) + ' ▾</span>' : '');
    }
    crumb.querySelector('[data-act="pick-project"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._menu(e.currentTarget, Store.projects.map(pp => ({
        label: pp.name, value: pp.id, active: pp.id === Store.currentProjectId,
        sub: pp.episodeCount + ' 集'
      })), async (id) => {
        await Store.openProject(id);
        await App.go(this.current === 'dash' ? 'episodes' : this.current);
      });
    });
    crumb.querySelector('[data-act="pick-episode"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!Store.episodes.length) { Toast.show('这个项目还没有集'); return; }
      this._menu(e.currentTarget, Store.episodes.map(ep => ({
        label: '第' + String(ep.no).padStart(p.padWidth || 2, '0') + '集' + (ep.title ? ' · ' + ep.title : ''),
        value: ep.no, active: ep.no === Store.currentEpisodeNo,
        sub: (Util.epStatus(ep.status) || [''])[0]
      })), async (no) => {
        const r = await Store.openEpisode(no);
        if (r && r.ok) await App.go(this.current);
      });
    });

    // 导航角标
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || ''; };
    set('nav-proj-count', Store.projects.length || '');
    set('nav-ep-count', Store.episodes.length || '');
    set('nav-line-count', Store.currentEpisode ? (Store.currentEpisode.lines || []).length : '');
    set('nav-voice-count', window.__voiceCount || '');

    const ai = document.getElementById('status-ai');
    if (ai) ai.textContent = Store.hasApiKey ? '✦ AI 已配置' : '✦ AI 未配置';
  },

  /** 轻量下拉菜单（面包屑 / 自定义 select 共用）*/
  _menu(anchor, items, onPick, opts = {}) {
    document.querySelectorAll('.popmenu').forEach(m => m.remove());
    if (!items.length) return;
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'popmenu';
    if (opts.minWidth) menu.style.minWidth = opts.minWidth + 'px';
    menu.innerHTML = items.map(it =>
      '<div class="popmenu-item' + (it.active ? ' on' : '') + (it.disabled ? ' disabled' : '')
      + '" data-v="' + Util.escapeAttr(String(it.value)) + '">'
      + '<span class="pm-label">' + Util.escapeHtml(it.label) + '</span>'
      + (it.sub ? '<span class="pm-sub">' + Util.escapeHtml(it.sub) + '</span>' : '')
      + '</div>').join('');
    document.body.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.min(r.bottom + 5, window.innerHeight - mh - 8) + 'px';

    const close = () => { menu.remove(); document.removeEventListener('mousedown', onDoc, true); };
    const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    menu.querySelectorAll('.popmenu-item').forEach(it =>
      it.addEventListener('click', () => {
        if (it.classList.contains('disabled')) return;
        close(); onPick(it.dataset.v);
      }));
  },

  _syncStatus(text, mid) {
    if (text) { const e = document.getElementById('status-text'); if (e) e.textContent = text; }
    const m = document.getElementById('status-mid');
    if (m) {
      if (mid !== undefined) m.textContent = mid;
      else if (Store.currentProject) {
        const st = Store.stats();
        m.textContent = Store.currentProject.name + ' · '
          + (Store.currentEpisode ? '第 ' + Store.currentEpisodeNo + ' 集' : Store.episodes.length + ' 集')
          + (st.lines ? ' · ' + st.doneLines + '/' + st.lines + ' 句已生成' : '');
      } else m.textContent = '';
    }
  },

  /* ── 主题（明亮现代 / 液态玻璃 / 构成主义）── */
  _setupThemeToggle() {
    const THEMES = ['light', 'glass', 'construct'];
    const apply = (theme) => {
      if (!THEMES.includes(theme)) theme = 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('vox-theme', theme);
      window.dispatchEvent(new CustomEvent('vox:theme-changed', { detail: { theme } }));
      if (Store.settings) Store.saveSettings({ theme });
    };
    this.applyTheme = apply;
    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      apply(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
    });
  },

  /* ── 导航 ─────────────────────────────────── */
  _setupNav() {
    document.querySelectorAll('#sidebar .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.page));
    });
  },

  /* ── 后端状态 ─────────────────────────────── */
  _setupServerStatus() {
    this._startLoadingTicker();

    if (!window.electronAPI) {
      setTimeout(() => this._onServerReady(), 400);
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
      document.getElementById('loading-overlay')?.classList.remove('is-error');
      this._setLoadingText('正在重新启动 VoxCPM2 引擎...');
      this._appendLog('');
      this._startLoadingTicker();
      try {
        const res = await window.electronAPI.restartServer();
        if (res && res.ok === false) this._onServerError(res.message || '启动失败');
      } catch (e) { this._onServerError(e.message); }
    });
  },

  _setSideStatus(t) { const e = document.getElementById('side-status'); if (e) e.textContent = t; },

  _startLoadingTicker() {
    this._loadingStart = Date.now();
    clearInterval(this._loadingTimer);
    const el = document.getElementById('loading-elapsed');
    const tick = () => { if (el) el.textContent = '已等待 ' + Math.round((Date.now() - this._loadingStart) / 1000) + ' 秒'; };
    tick();
    this._loadingTimer = setInterval(tick, 1000);
  },

  _setLoadingText(t) { const e = document.getElementById('loading-text'); if (e) e.textContent = t; },

  _appendLog(line) {
    this._logLines = (this._logLines || []).concat(line).slice(-4);
    const el = document.getElementById('loading-log');
    if (el) el.textContent = this._logLines.join('\n').trim();
  },

  _onServerError(message) {
    clearInterval(this._loadingTimer);
    document.getElementById('loading-overlay')?.classList.add('is-error');
    this._setLoadingText('启动失败：' + (message || '未知错误'));
    this._appendLog('提示：可在设置 → TTS 引擎里检查路径');
  },

  async _onServerReady() {
    clearInterval(this._loadingTimer);
    this._setSideStatus('已就绪');
    if (this._ready) return;
    this._ready = true;
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.style.display = 'none';
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'flex';

    await this.go('dash');
    GpuMonitor.start();
  },

  /* ── 窗口按钮 ─────────────────────────────── */
  _setupWindowControls() {
    document.getElementById('btn-min')?.addEventListener('click', () => window.electronAPI?.minimize());
    document.getElementById('btn-max')?.addEventListener('click', async () => {
      await window.electronAPI?.maximize(); this._updateMaxIcon();
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
