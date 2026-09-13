/* ==========================================
   App —— 外壳、路由、项目上下文
   ========================================== */

// 界面层兜底：任何未捕获错误只记录，不让界面白屏或卡死
window.addEventListener('error', (e) => {
  console.error('[guard] 界面异常:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[guard] 未处理的拒绝:', e.reason);
});

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
      ai.classList.toggle('is-on', ok);
      ai.classList.toggle('is-off', !ok);
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
      else if (data.status === 'engine-ready') this._onEngineReady();
      else if (data.status === 'engine-downloading') this._onEngineDownloading(data);
      else if (data.status === 'engine-loading') this._onEngineLoading(data);
      else if (data.status === 'starting') {
        this._setLoadingText(data.message || '正在启动引擎...');
        this._setSideStatus('启动中', 'loading');
      } else if (data.status === 'error') {
        this._onServerError(data.message);
        this._setSideStatus('未连接', 'error');
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

  _setSideStatus(t, cls) {
    const e = document.getElementById('side-status');
    if (e) e.textContent = t;
    const chip = document.getElementById('engine-chip');
    if (chip && cls) {
      chip.classList.remove('is-loading', 'is-ready', 'is-error');
      chip.classList.add('is-' + cls);
    }
  },

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
      // 主进度条：模型加载没有真实百分比，用渐近曲线给一个「一直在走」的估计。
      // 上限 92%，留出最后一段给真实就绪事件，避免卡在 100% 却没进主界面。
      if (!this._pgPaused) {
        const est = 92 * (1 - Math.exp(-s / 26));
        this._smoothTo('loading-bar', est);
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

  /**
   * 平滑进度：目标值跳变时，显示值按帧向它靠拢。
   * 直接写 width 会「突然蹦到某个进度」，这里用缓动补间消除突跳。
   * id 用哪条进度条都行（主加载条 / 一键配置条）。
   */
  _smoothTo(id, pct) {
    this._pg = this._pg || {};
    const st = this._pg[id] || (this._pg[id] = { shown: 0, target: 0, timer: null });
    st.target = Math.max(st.target, Math.min(100, pct));   // 只增不减，避免回退造成困惑
    if (st.timer) return;
    st.timer = setInterval(() => {
      const diff = st.target - st.shown;
      if (Math.abs(diff) < 0.35) {
        st.shown = st.target;
        clearInterval(st.timer); st.timer = null;
      } else {
        st.shown += diff * 0.16;                            // 缓动系数：越大越快
      }
      const el = document.getElementById(id);
      if (el) el.style.width = st.shown.toFixed(2) + '%';
    }, 60);
  },

  _appendLog(line) {
    this._logLines = (this._logLines || []).concat(line).slice(-200);
    const text = this._logLines.join('\n').trim();
    const el = document.getElementById('loading-log');
    if (el) el.textContent = text;
    // 没有任何日志时，连「查看详情」按钮一起藏起来 ——
    // 否则展开后是个空白的白条，看着像坏了
    const wrap = document.getElementById('loading-logwrap');
    if (wrap) wrap.style.display = text ? '' : 'none';
    // 日志要滚到底：真正的报错总在最后几行，
    // 停在顶部等于让用户看一堆无害的 FutureWarning
    if (el && text) el.scrollTop = el.scrollHeight;
  },

  /** 展开日志（出错时自动调用，免得让用户去点一个折叠区找原因） */
  _openLog() {
    const wrap = document.getElementById('loading-logwrap');
    const log = document.getElementById('loading-log');
    const tgl = document.getElementById('loading-toggle-log');
    if (wrap) wrap.style.display = '';
    if (log) log.classList.add('show');
    if (tgl) tgl.textContent = '收起详情';
  },

  _onServerError(message) {
    clearInterval(this._loadingTimer);
    this._openLog();
    // 计时器停了之后还挂着「已等待 6 秒」看着像卡死，改成明确的失败状态
    const el = document.getElementById('loading-elapsed');
    if (el) {
      el.classList.add('is-failed');
      el.textContent = '启动失败（已耗时 ' + Math.round((Date.now() - (this._loadingStart || Date.now())) / 1000) + ' 秒）';
    }
    const msg = String(message || '未知错误');
    // 后端起不来的原因很多（脚本缺失 / Python 异常 / 依赖没装 / 端口占用 / 进程秒退…），
    // 但补救办法都是同一套 —— 所以只要失败就走引导面板，不按错误文案分流。
    // 原先只匹配「找不到后端脚本」等几种，导致「进程启动后立即退出（code=3）」
    // 落进死胡同错误分支，一键配置反而不见了。
    this._showSetupPanel(msg);
    this._setSideStatus('引擎未就绪', 'error');
    return;
    document.getElementById('loading-overlay')?.classList.add('is-error');
    this._setLoadingText('启动失败：' + msg);
    this._appendLog('提示：可在设置 → TTS 引擎里检查路径，或用「设置 → 诊断与关于」自检');
  },

  /** 正在下载模型：显示真实进度（首次启动可能要几十分钟） */
  /** 模型下载完成、转入加载：把两条进度条都推到 100%，并换文案 */
  _onEngineLoading(d) {
    this._pgPaused = true;
    this._smoothTo('loading-bar', 100);
    const setupBox = document.getElementById('setup-prog');
    if (setupBox && setupBox.style.display !== 'none') {
      this._smoothTo('setup-prog-fill', 100);
      const cap = document.getElementById('setup-prog-cap');
      if (cap) cap.textContent = '步骤 5/5 · 正在加载模型';
      const txt = document.getElementById('setup-prog-text');
      if (txt) txt.textContent = '模型已下载完成，正在加载到显卡（首次约 30–60 秒）…';
    }
    this._setLoadingText('正在加载模型到显卡…');
    this._setSideStatus('加载模型', 'loading');
    this._openLog();
  },

  _onEngineDownloading(d) {
    const pct = Math.round((d.progress || 0) * 100);
    let dlText = '正在下载模型 ' + (d.downloadedMb || 0) + ' / '
      + (d.expectedMb || 0) + ' MB（' + pct + '%）';
    // 速度和剩余时间是等待时最需要的信息
    if (d.stalled) {
      dlText += ' · 下载似乎已停滞，请检查网络或代理；也可自行下载模型放到 engine\\pretrained_models\\VoxCPM2\\';
    }
    const sp = Number(d.mbps || 0);
    if (sp > 0.05) {
      dlText += ' · ' + sp.toFixed(1) + ' MB/s';
      const left = (d.expectedMb || 0) - (d.downloadedMb || 0);
      if (left > 0) {
        const sec = left / sp;
        const eta = sec > 90 ? Math.round(sec / 60) + ' 分钟' : Math.round(sec) + ' 秒';
        dlText += ' · 约剩 ' + eta;
      }
    }

    // 若一键配置的进度条还在（刚配置完就进入下载），接着它走完最后一段
    const setupBox = document.getElementById('setup-prog');
    const setupFill = document.getElementById('setup-prog-fill');
    if (setupBox && setupBox.style.display !== 'none' && setupFill) {
      const overall = 58 + (d.progress || 0) * 42;      // 58% → 100%
      this._smoothTo('setup-prog-fill', overall);
      const pctEl = document.getElementById('setup-prog-pct');
      if (pctEl) pctEl.textContent = Math.round(overall) + '%';
      const cap = document.getElementById('setup-prog-cap');
      if (cap) cap.textContent = '步骤 5/5 · 下载语音模型';
      const txt = document.getElementById('setup-prog-text');
      if (txt) txt.textContent = dlText + ' · 首次使用需要，之后不再下载';
    } else {
      const box = document.getElementById('loading-dl');
      const fill = document.getElementById('loading-dl-fill');
      const txt = document.getElementById('loading-dl-text');
      if (box) box.style.display = '';
      if (fill) fill.style.width = pct + '%';
      if (txt) txt.textContent = dlText + ' · 首次使用需要，之后不再下载';
    }
    this._setLoadingText('首次启动：正在下载语音模型');
    this._setSideStatus('下载模型 ' + pct + '%', 'loading');
    // 主进度条（未走一键配置时）接真实下载进度
    if (!(setupBox && setupBox.style.display !== 'none')) {
      this._pgPaused = true;
      this._smoothTo('loading-bar', pct);
    }
  },

  /** 后端启动失败且是「找不到脚本」时，给出引导而不是死路 */
  _showSetupPanel(message) {
    const ov = document.getElementById('loading-overlay');
    ov?.classList.remove('is-error');
    const box = document.getElementById('loading-setup');
    if (!box) return;
    box.style.display = '';
    document.getElementById('loading-retry').style.display = 'none';
    // 标题按情况变：纯粹没配置 vs 配置了但起不来
    const h = box.querySelector('.ld-setup-h');
    const p = box.querySelector('.ld-setup-p');
    const isMissing = /找不到后端脚本|不存在|ENOENT/.test(message || '');
    if (h) h.textContent = isMissing ? '还差最后一步' : '语音引擎启动失败';
    if (p) {
      p.textContent = isMissing
        ? '点下面的按钮，软件会自动装好语音引擎（含 Python 运行环境）并下载语音模型，全程不用你操作。'
        : '下面是一键配置，会重新准备引擎与依赖。失败原因见下方「详情」里的日志。';
    }
    const msg = document.getElementById('loading-setup-msg');
    if (msg) { msg.className = 'ld-setup-msg err'; msg.textContent = message || ''; }
    this._setLoadingText(isMissing ? '需要先指定语音引擎的位置' : '语音引擎启动失败');

    window.electronAPI.setup.status().then((s) => {
      const p = document.getElementById('loading-setup-path');
      if (p) p.textContent = '当前查找位置：' + (s.scriptPath || '(未配置)');
    });

    // 显示模型应放的位置，并允许直接打开 —— 自己下好丢进去就能用。
    // 全部包 try/catch 并先判方法是否存在：旧版 preload 或缺方法时
    // 不该让整个面板渲染中断（这正是把应用点闪退的那类写法）。
    const api = window.electronAPI || {};
    const modelDirFn = (api.setup && api.setup.modelDir) ? api.setup.modelDir.bind(api.setup) : null;
    const revealFn = (api.path && api.path.reveal) ? api.path.reveal.bind(api.path) : null;

    if (modelDirFn) {
      Promise.resolve()
        .then(() => modelDirFn())
        .then((m) => {
          const el = document.getElementById('loading-model-dir');
          if (el && m && m.dir) el.textContent = m.dir;
          else if (el) el.textContent = '(尚未确定，请先执行一键配置)';
        })
        .catch((e) => console.warn('取模型目录失败:', e));
    } else {
      const el = document.getElementById('loading-model-dir');
      if (el) el.textContent = '(当前版本不支持，请更新)';
    }

    const openModel = document.getElementById('loading-open-model');
    if (openModel && !openModel.dataset.bound) {
      openModel.dataset.bound = '1';
      openModel.addEventListener('click', async (ev) => {
        ev.preventDefault();
        try {
          if (!modelDirFn || !revealFn) { Toast.error('当前版本不支持打开目录', true); return; }
          const m = await modelDirFn();
          if (m && m.dir) await revealFn(m.dir);
          else Toast.error((m && m.message) || '模型目录尚未确定，请先一键配置', true);
        } catch (e) {
          console.error('打开模型目录失败:', e);
          Toast.error('打开失败：' + (e && e.message || e), true);
        }
      });
    }

    // 启动失败时进不去设置页，所以这里也放一个导出入口
    const expDiag = document.getElementById('loading-export-diag');
    if (expDiag && !expDiag.dataset.bound) {
      expDiag.dataset.bound = '1';
      expDiag.addEventListener('click', async (ev) => {
        ev.preventDefault();
        expDiag.disabled = true;
        const old = expDiag.textContent;
        expDiag.textContent = '导出中…';
        try {
          const r = await window.electronAPI.diag.exportReport();
          if (r && r.ok) {
            Toast.success('已导出：' + r.path);
            window.electronAPI.path.reveal(String(r.path).replace(/[\\/][^\\/]+$/, ''));
          } else {
            Toast.error((r && r.message) || '导出失败', true);
          }
        } catch (e) {
          Toast.error('导出失败：' + (e && e.message || e), true);
        } finally {
          expDiag.disabled = false;
          expDiag.textContent = old;
        }
      });
    }

    const auto = document.getElementById('loading-setup-auto');
    if (auto && !auto.dataset.bound) {
      auto.dataset.bound = '1';
      auto.addEventListener('click', async () => {
        const m = document.getElementById('loading-setup-msg');
        const box = document.getElementById('setup-prog');
        const fill = document.getElementById('setup-prog-fill');
        const txt = document.getElementById('setup-prog-text');
        if (box) box.style.display = '';
        auto.disabled = true;
        if (m) { m.className = 'ld-setup-msg'; m.textContent = ''; }

        // 一条连续进度条：0–3% 建目录 / 3–12% Python / 12–55% 依赖 /
        // 55–58% 配置 / 58–100% 模型下载（后续由 engine-downloading 事件接管）
        this._setupPct = 0;
        const paint = (pct, msg) => {
          this._setupPct = Math.max(this._setupPct, Math.min(100, pct));
          this._smoothTo('setup-prog-fill', this._setupPct);
          const pctEl = document.getElementById('setup-prog-pct');
          if (pctEl) pctEl.textContent = Math.round(this._setupPct) + '%';
          const cap = document.getElementById('setup-prog-cap');
          if (cap && msg) cap.textContent = msg;
          if (txt && msg) txt.textContent = msg;
        };
        const STAGE_LABEL = {
          files: '步骤 1/5 · 创建后端目录',
          python: '步骤 2/5 · Python 环境',
          pip: '步骤 3/5 · 安装依赖',
          config: '步骤 4/5 · 写入配置',
          start: '步骤 5/5 · 下载语音模型'
        };

        window.electronAPI.setup.onProgress((p) => {
          const pct = p.progress != null ? p.progress * 100 : this._setupPct;
          paint(pct, p.message || '');
          const cap = document.getElementById('setup-prog-cap');
          if (cap) cap.textContent = p.caption || STAGE_LABEL[p.stage] || '';
        });
        paint(0, '准备中…');

        const r = await window.electronAPI.setup.auto({});
        auto.disabled = false;
        if (r && r.ok) {
          paint(58, '后端已启动，开始下载语音模型…');
          if (m) { m.className = 'ld-setup-msg ok'; m.textContent = '依赖就绪，正在下载模型'; }
          this._setLoadingText('正在下载语音模型');
        } else if (r && r.needPython) {
          if (m) { m.className = 'ld-setup-msg err'; m.textContent = r.message; }
        } else {
          if (m) { m.className = 'ld-setup-msg err'; m.textContent = (r && r.message) || '配置失败'; }
        }
      });
    }

    const pick = document.getElementById('loading-setup-pick');
    if (pick && !pick.dataset.bound) {
      pick.dataset.bound = '1';
      pick.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const r = await window.electronAPI.path.pick({ title: '选择 VoxCPM2 后端目录（含 server.py）' });
        if (!r || !r.ok) return;
        const v = await window.electronAPI.setup.validate(r.path);
        const m = document.getElementById('loading-setup-msg');
        if (!v.ok) { if (m) { m.className = 'ld-setup-msg err'; m.textContent = v.message; } return; }
        if (m) {
          m.className = 'ld-setup-msg ' + (v.hasModel ? 'ok' : '');
          m.textContent = v.message;
        }
        const a = await window.electronAPI.setup.apply(r.path);
        if (m) { m.className = 'ld-setup-msg ' + (a.ok ? 'ok' : 'err'); m.textContent = a.message || (a.ok ? '已保存，正在启动…' : '启动失败'); }
      });
    }
    const retry = document.getElementById('loading-setup-retry');
    if (retry && !retry.dataset.bound) {
      retry.dataset.bound = '1';
      retry.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const m = document.getElementById('loading-setup-msg');
        if (m) { m.className = 'ld-setup-msg'; m.textContent = '正在重新检测…'; }
        const res = await window.electronAPI.restartServer();
        if (res && res.ok === false) {
          this._showSetupPanel(res.message || '仍然找不到 server.py');
        } else if (m) {
          m.className = 'ld-setup-msg ok';
          m.textContent = '已启动，正在加载…';
        }
      });
    }
  },

  /** 引擎（模型）加载完成 —— 与「服务已响应」是两回事。
      后端改成后台加载后，界面先放出来，生成按钮等这里再解禁。 */
  _onEngineReady() {
    // 收尾：主进度条走到 100%，并停掉时间估算
    this._pgPaused = true;
    this._smoothTo('loading-bar', 100);
    document.body.classList.remove('engine-loading');
    this._setSideStatus('引擎就绪', 'ready');
    window.dispatchEvent(new CustomEvent('vox:engine-ready'));
  },

  async _onServerReady() {
    clearInterval(this._loadingTimer);
    this._setSideStatus('模型加载中', 'loading');
    document.body.classList.add('engine-loading');
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
