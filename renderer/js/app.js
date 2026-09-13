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
      ['minimal', 'glass', 'construct'].includes(savedTheme) ? savedTheme : 'light');
    const savedFont = localStorage.getItem('vox-font') || 'system';
    document.documentElement.setAttribute('data-font', savedFont === 'han' ? 'han' : 'system');

    this._setupWindowControls();
    this._setupThemeToggle();
    this._setupNav();
    this._setupServerStatus();
    Shortcuts.init();

    await API.init();
    try { window.__voxConfig = await window.electronAPI.getConfig(); } catch (e) { window.__voxConfig = {}; }

    await Store.init();

    // 用设置里的主题 / 字体 / 动效 / 缩放覆盖本地缓存
    const st = Store.settings || {};
    if (st.theme) document.documentElement.setAttribute('data-theme',
      ['minimal', 'glass', 'construct'].includes(st.theme) ? st.theme : 'light');
    this.applyFont(st.font);
    this.detectFonts();
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
      const eps = Store.episodes;
      if (!eps.length) { Toast.show('这个项目还没有集'); return; }
      const cur = Store.currentEpisodeNo;
      const idx = eps.findIndex(x => x.no === cur);
      // 只展开附近 3 集 —— 集多时这里列全部会淹死人，看全量去集管理
      const NEAR = 3;
      const start = idx < 0 ? 0 : Math.max(0, Math.min(idx - 1, Math.max(0, eps.length - NEAR)));
      const items = [];
      if (idx > 0) items.push({ label: '← 上一集', value: 'no:' + eps[idx - 1].no });
      eps.slice(start, start + NEAR).forEach(ep => {
        items.push({
          label: '第' + String(ep.no).padStart(p.padWidth || 2, '0') + '集' + (ep.title ? ' · ' + ep.title : ''),
          value: 'no:' + ep.no, active: ep.no === cur,
          sub: (Util.epStatus(ep.status) || [''])[0]
        });
      });
      if (idx >= 0 && idx < eps.length - 1) items.push({ label: '下一集 →', value: 'no:' + eps[idx + 1].no });
      if (eps.length > NEAR) items.push({ label: '查看全部 ' + eps.length + ' 集 →', value: 'all' });

      this._menu(e.currentTarget, items, async (v) => {
        if (v === 'all') { await App.go('episodes'); return; }
        const no = Number(String(v).replace('no:', ''));
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
    if (ai) {
      const prov = (Store.settings && Store.settings.ai && Store.settings.ai.provider) || 'deepseek';
      const ok = !!((Store.keyStatus || {})[prov] || {}).has;
      ai.textContent = ok ? '✦ AI 已配置' : '✦ AI 未配置';
    }
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

  /* ── 字体（只用系统默认与思源黑体两档）───────── */
  applyFont(font) {
    const mode = font === 'han' ? 'han' : 'system';
    document.documentElement.setAttribute('data-font', mode);
    localStorage.setItem('vox-font', mode);
    if (Store.settings) Store.saveSettings({ font: mode });
  },

  /** 每个字体栈里实际生效的是哪一个（靠 canvas 量宽比对，缺失字体会静默回退） */
  _firstAvailable(list) {
    for (const f of list) if (this._fontAvailable(f)) return f;
    return list[list.length - 1];
  },

  _fontAvailable(name) {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      const probe = 'mmmmmmmmmmlliWWW@#%0123456789';
      const bases = ['monospace', 'sans-serif', 'serif'];
      return bases.some(b => {
        ctx.font = '72px ' + b;
        const w0 = ctx.measureText(probe).width;
        ctx.font = '72px "' + name + '", ' + b;
        return Math.abs(ctx.measureText(probe).width - w0) > 0.5;
      });
    } catch (e) { return false; }
  },

  /** 报告字体栈实际会用到哪个字体，给设置页显示 */
  detectFonts() {
    this.fontInfo = {
      han: this._firstAvailable(['Noto Sans SC', 'Source Han Sans CN', 'Microsoft YaHei'])
    };
    return this.fontInfo;
  },

  /* ── 主题（明亮现代 / 极简黑白 / 液态玻璃 / 构成主义）── */
  _setupThemeToggle() {
    const THEMES = ['light', 'minimal', 'glass', 'construct'];
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
    const STAGES = [
      [0,   '正在启动语音引擎…'],
      [8,   '正在加载声学模型…'],
      [30,  '正在初始化声码器…'],
      [60,  '首次加载较慢，正在预热显存…'],
      [110, '马上就好，模型较大请再等等…']
    ];
    const tick = () => {
      const s = Math.round((Date.now() - this._loadingStart) / 1000);
      if (el) el.textContent = '已等待 ' + s + ' 秒';
      // 按时间推进阶段文案，让用户知道不是卡住了
      for (let i = STAGES.length - 1; i >= 0; i--) {
        if (s >= STAGES[i][0]) { this._setLoadingText(STAGES[i][1]); break; }
      }
    };
    tick();
    this._loadingTimer = setInterval(tick, 1000);
    // 日志默认收起，需要排查时再展开。
    // 注意只绑一次：这个方法可能被多次调用，绑两次会让 toggle 互相抵消
    if (this._logToggleBound) return;
    this._logToggleBound = true;
    const tgl = document.getElementById('loading-toggle-log');
    const log = document.getElementById('loading-log');
    tgl?.addEventListener('click', () => {
      const on = log?.classList.toggle('show');
      tgl.textContent = on ? '收起详情' : '查看详情';
    });
  },

  _setLoadingText(t) { const e = document.getElementById('loading-text'); if (e) e.textContent = t; },

  _appendLog(line) {
    this._logLines = (this._logLines || []).concat(line).slice(-200);
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
