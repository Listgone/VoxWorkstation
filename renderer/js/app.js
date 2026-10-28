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
    quick:               () => QuickPage,
    projects:            () => ProjectsPage,
    'project-settings':  () => ProjectSettingsPage,
    episodes:            () => EpisodesPage,
    roles:               () => RolesPage,
    text:                () => TextPage,
    dub:                 () => DubPage,
    export:              () => ExportPage,
    tools:               () => ToolsPage,
    voices:              () => VoicesPage,
    settings:            () => SettingsPage
  },

  async init() {
    // 主题（在 Store 就绪前先用本地缓存，避免闪白）
    const themeOk = (t) => this.THEMES.some(([id]) => id === t);
    const savedTheme = localStorage.getItem('vox-theme') || 'light';
    document.documentElement.setAttribute('data-theme', themeOk(savedTheme) ? savedTheme : 'light');
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
    if (st.theme) document.documentElement.setAttribute('data-theme', themeOk(st.theme) ? st.theme : 'light');
    this.applyFont(st.font);
    this.detectFonts();
    document.documentElement.setAttribute('data-reduce-motion', st.reduceMotion ? 'true' : 'false');
    /* 界面缩放：必须交给主进程用 Electron 的 zoomFactor。
       给 body 设 CSS zoom 在这里是无效的 —— 计算值会变，但布局尺寸不动。 */
    if (Number(st.uiScale) && Number(st.uiScale) !== 1) {
      window.electronAPI?.ui?.setZoom?.(Number(st.uiScale));
    }

    Store.on(() => { this._syncChrome(); });
    this._syncChrome();
  },

  /* ── 路由 ─────────────────────────────────── */
  async go(page, opts = {}) {
    const factory = this._pages[page];
    if (!factory) return;
    if (page === 'quick' && !Store.isQuick && !this.quickEnabled()) {
      Toast.show('快速配音已在「设置 → 通用」里关闭');
      return;
    }
    const mod = factory();
    this.current = page;

    document.querySelectorAll('#sidebar .nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('active', p.id === 'page-' + page));

    const el = document.getElementById('page-' + page);
    if (!el) {
      /* 容器缺失时不要静默返回：以前这里直接 return，
         页面注册了、导航也在，但 index.html 忘了写对应的 <section>，
         结果点了导航只有高亮、内容全空、控制台一点报错都没有，很难查。
         新增页面时必须在 index.html 里加 <section id="page-xxx" class="page">。 */
      console.error('[页面] 缺少容器 <section id="page-' + page + '" class="page">，'
        + '请在 renderer/index.html 里补上');
      if (typeof Toast !== 'undefined') Toast.error('页面容器缺失：page-' + page, true);
      return;
    }

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
    this._syncQuickUI();
    const crumb = document.getElementById('crumb');
    if (!crumb) return;
    const p = Store.currentProject;
    if (Store.isQuick) {
      crumb.innerHTML = '<span class="seg cur">快速配音 · 独立工作区</span>'
        + '<span class="sl">·</span><span class="text-sm text-muted" style="padding-left:2px">不建项目</span>';
      return;
    }
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
        /* 切项目会清空「当前集」：停在配音/文本/导出这类必须打开集才有的页面时，
           页面会变成空白、面包屑的集下拉也跟着消失。这里直接把新项目的第一集打开。 */
        if (['text', 'dub', 'export'].includes(this.current)
            && !Store.currentEpisodeNo && Store.episodes.length) {
          await Store.openEpisode(Store.episodes[0].no);
        }
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
    set('nav-role-count', (Store.currentProject && (Store.currentProject.roles || []).length) || '');
    set('nav-voice-count', window.__voiceCount || '');
    // 快速模式：角标改成状态提示，免得"免项目"三个字一直挂着
    const qh = document.getElementById('nav-quick-hint');
    if (qh) qh.textContent = Store.isQuick ? '进行中' : '免项目';

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

  /* ── 主题（明亮现代 / 极简黑白 / 液态玻璃 / 构成主义 / 霓虹紫夜）──
     这里是主题的唯一定义处：初始化、切换按钮、设置页都读 THEMES，
     新增主题只改这一处 + style.css 的 [data-theme="xxx"] 块。 */
  THEMES: [
    ['light', '明亮现代'],
    ['minimal', '极简黑白'],
    ['glass', '液态玻璃'],
    ['construct', '构成主义'],
    ['neonwave', '霓虹紫夜']
  ],

  /** 当前主题 id（带兜底，坏值一律回落到明亮现代） */
  themeId() {
    const t = document.documentElement.getAttribute('data-theme') || 'light';
    return this.THEMES.some(([id]) => id === t) ? t : 'light';
  },

  _setupThemeToggle() {
    const apply = (theme) => {
      if (!this.THEMES.some(([id]) => id === theme)) theme = 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('vox-theme', theme);
      window.dispatchEvent(new CustomEvent('vox:theme-changed', { detail: { theme } }));
      if (Store.settings) Store.saveSettings({ theme });
    };
    this.applyTheme = apply;
    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const order = this.THEMES.map(([id]) => id);
      const i = order.indexOf(this.themeId());
      apply(order[(i + 1) % order.length]);       // 循环切换，含新增主题
    });
  },

  /* ── 导航 ─────────────────────────────────── */
  _setupNav() {
    document.querySelectorAll('#sidebar .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.page));
    });
  },

  /** 快速配音开关（设置 → 通用）关掉时，入口变灰并拦截 */
  quickEnabled() {
    const q = (Store.settings && Store.settings.quickDub) || {};
    return q.enabled !== false;
  },

  /** 快速配音态：侧边栏只留「快速配音 + 资产 + 设置」，
      避免用户点进项目页看到空白，也避免误以为快速内容属于某个项目 */
  _syncQuickUI() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('is-quick', !!Store.isQuick);
    const qb = sb.querySelector('[data-page="quick"]');
    if (qb) qb.classList.toggle('is-off', !this.quickEnabled());
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
      else if (data.status === 'engine-ready') this._onEngineReady(data);
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
   * 顺带把百分比写到进度条容器的 data-pct，加载页用它显示一个可读数字
   * （CSS ::after 读这个属性）—— 比让 JS 写两个元素少一处不同步。
   */

  /** 按进度点亮加载页的阶段清单。
      阶梯不编造额外阶段：<12% 启动引擎；12–88% 加载模型；88–99% 预热；100% 就绪。 */
  _syncLoadSteps(pct) {
    const box = document.getElementById('loading-steps');
    if (!box) return;
    /* 只有 3 步，全部对应后端真实阶段，不编造：
         <40%  启动引擎（后端 starting）
         40-99% 加载语音模型（后端 loading_model）
         100%   就绪（后端 ready） */
    const stage = pct >= 100 ? 3 : pct >= 40 ? 2 : 1;
    const rows = box.querySelectorAll('.ld-step');
    rows.forEach((row, i) => {
      const n = i + 1;
      row.classList.toggle('done', n < stage || pct >= 100);
      row.classList.toggle('doing', n === stage && pct < 100);
      const b = row.querySelector('b');
      if (!b) return;
      if (n < stage || pct >= 100) b.textContent = '完成';
      else if (n === stage) b.textContent = Math.round(pct) + '%';
      else b.textContent = '';
    });
  },

  _smoothTo(id, pct) {
    this._pg = this._pg || {};
    const st = this._pg[id] || (this._pg[id] = { shown: 0, target: 0, timer: null });
    st.target = Math.max(st.target, Math.min(100, pct));   // 只增不减，避免回退造成困惑
    if (st.timer) return;
    const paint = () => {
      const el = document.getElementById(id);
      if (el) el.style.width = st.shown.toFixed(2) + '%';
      const box = el && el.parentElement;
      if (box && box.classList && box.classList.contains('ld-bar')) {
        box.setAttribute('data-pct', Math.round(st.shown) + '%');
      }
      // 进度条动了就同步加载页的阶段清单（只认 loading-bar）
      if (id === 'loading-bar') {
        try { this._syncLoadSteps(st.shown); } catch (e) { /* 清单出错不影响加载 */ }
      }
    };
    st.timer = setInterval(() => {
      const diff = st.target - st.shown;
      if (Math.abs(diff) < 0.35) {
        st.shown = st.target;
        clearInterval(st.timer); st.timer = null;
      } else {
        st.shown += diff * 0.16;                            // 缓动系数：越大越快
      }
      paint();
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
  /** 模型下载完成、开始加载到显卡。
      注意：这一步**不是** 100% —— 以前这里把进度条直接推满并暂停，
      结果四步清单全部显示"完成"，但模型其实还在读盘加载，
      用户看到的就是"卡住不动、假加载"。 */
  _onEngineLoading(d) {
    this._pgPaused = false;                 // 让计时器继续估算，进度条还会动
    this._smoothTo('loading-bar', 78);      // 开始加载 ≈ 78%，真正的 100% 由 _onEngineReady 给
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
    /* 不自动展开日志：那是排查用的细节，用户想看会自己点「查看详情」。 */
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
          /* 显示真实位置：engine 在安装目录里只是个入口，真实数据在安装目录之外
             （卸载/覆盖安装不会动它）。只把位置告诉用户，不必解释实现方式。 */
          if (el && m && (m.realDir || m.dir)) el.textContent = m.realDir || m.dir;
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
          const target = (m && (m.realDir || m.dir)) || '';
          if (target) await revealFn(target);
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
      加载页真正代表"模型加载"：进度到 100%、停留一下，再放主界面。 */
  _onEngineReady(data) {
    if (this._engineReadyDone) return;      // 幂等：IPC 与兜底可能同时到达
    this._engineReadyDone = true;
    /* 记下这台机器的真实加载耗时，之后所有"要等多久"的文案都用它，
       而不是写死"约 1 分钟" —— 高配机可能 20 秒，低配机可能 2 分钟。 */
    const ms = data && Number(data.elapsedMs);
    if (ms && ms > 1000) {
      this._lastLoadMs = ms;
      try { window.electronAPI?.settings?.save?.({ tts: { lastLoadMs: Math.round(ms) } }); } catch (e) {}
      try { if (Store && Store.settings && Store.settings.tts) Store.settings.tts.lastLoadMs = Math.round(ms); } catch (e) {}
    }
    clearInterval(this._loadingTimer);      // 到这一步才真的不用再计时了
    clearInterval(this._readyFallback);     // 兜底轮询也停掉
    this._readyFallback = null;
    // 收尾：主进度条走到 100%，并停掉时间估算
    this._pgPaused = true;
    this._smoothTo('loading-bar', 100);
    document.body.classList.remove('engine-loading');
    this._setSideStatus('引擎就绪', 'ready');
    try { this._appendLog('模型加载完成（100%），0.6 秒后进入主界面'); } catch (e) {}
    window.dispatchEvent(new CustomEvent('vox:engine-ready'));
    /* 让"100% + 就绪"停留半秒再切主界面，
       否则进度条刚满就消失，用户看不到"加载完成"这个结果。 */
    setTimeout(() => { this._revealApp(); }, 1200);
  },


  /** 兜底：自己查 /api/ready，防止主进程事件丢失导致永远停在加载页。
      模型已经加载完成却没收到 engine-ready 时，这里 3 秒内就会把界面放出来。 */
  _startReadyFallback() {
    if (this._readyFallback) return;
    const tick = async () => {
      try {
        const base = await (window.electronAPI?.getServerUrl?.() || Promise.resolve(''));
        const url = (typeof base === 'string' && base ? base : 'http://127.0.0.1:8001') + '/api/ready';
        const r = await fetch(url, { cache: 'no-store' }).then((x) => x.json());
        if (r && r.ready) {
          clearInterval(this._readyFallback);
          this._readyFallback = null;
          this._appendLog('兜底检查：后端已就绪，直接进入主界面');
          this._onEngineReady({ elapsedMs: r.elapsed_ms || 0 });
        }
      } catch (e) { /* 后端还没起来，下一轮再试 */ }
    };
    this._readyFallback = setInterval(tick, 3000);
    setTimeout(tick, 1200);                 // 先试一次，命中就不用等 3 秒
  },

  /** 放出主界面（只做一次）。
      以前是在「服务已响应」时就放出界面，而模型还在后台读盘 ——
      加载动画显示的和真正在加载的并不是一回事。
      现在统一由模型加载完成来触发。 */
  async _revealApp() {
    if (this._revealed) return;
    this._revealed = true;
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.style.display = 'none';
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'flex';
    try { await this.go('dash'); } catch (e) { /* 页面切换失败不影响使用 */ }
    try { this._appendLog('已进入主界面'); } catch (e) {}
    try { GpuMonitor.start(); } catch (e) { /* 监控失败不影响使用 */ }
  },

  async _onServerReady() {
    /* 注意：这里**不能** clearInterval(this._loadingTimer)。
       服务起来了但模型还在加载，秒数和进度必须继续走 ——
       以前在这里就停掉，表现就是"秒数不动了、进度卡在某个数上"。
       计时器统一在 _onEngineReady 里停。 */
    this._setSideStatus('模型加载中', 'loading');
    document.body.classList.add('engine-loading');
    if (this._ready) return;
    this._ready = true;
    /* 关键：服务起来了不等于模型加载好了。
       这里不再隐藏加载页，只把进度推到"服务就绪"这一段（约 62%），
       剩下的由 _onEngineReady 收尾 —— 加载页从此就是模型加载的真实进度。 */
    this._pgPaused = false;
    this._smoothTo('loading-bar', 62);
    this._startReadyFallback();
  },

  /* ── 窗口按钮 ─────────────────────────────── */

  /** 关闭确认（应用内 Modal，不用系统对话框）。
      托盘 / 退出两个选项各自写清代价，因为这件事对用户是"快 1 分钟 vs 占 5GB 显存"的取舍。 */

  /** 这台机器加载一次模型大概多久（秒）。优先用上次实测值，没有就返回 0。 */
  _machineLoadSec() {
    let ms = this._lastLoadMs;
    if (!ms) {
      try { ms = Store && Store.settings && Store.settings.tts && Store.settings.tts.lastLoadMs; } catch (e) {}
    }
    return ms ? Math.round(ms / 1000) : 0;
  },

  /** 关闭弹窗第一句：有实测就说实测，没有就说不确定。 */
  _loadCostText() {
    const s = this._machineLoadSec();
    if (s > 0) return '这台电脑上次加载模型用了约 ' + s + ' 秒，所以先问你一句：';
    return '引擎需要把模型加载进显卡（不同电脑差别较大），所以先问你一句：';
  },

  /** 关闭弹窗里"彻底退出"那句的后缀：只在有实测时才写具体时长。 */
  _loadCostSuffix() {
    const s = this._machineLoadSec();
    return s > 0 ? '（这台电脑上次约 ' + s + ' 秒）' : '';
  },

  _onCloseConfirm() {
    /* 防重入看 DOM：弹窗关掉（含点遮罩/ESC）后元素就没了，下次还能正常弹。
       以前用布尔标志，点遮罩关闭时标志没复位，第二次点 ✕ 就再也不弹了。 */
    if (document.querySelector('.close-opt')) return;
    let remember = false;
    const overlay = Modal.open({
      title: '关闭 VoxWorkstation',
      width: 460,
      body:
        '<p class="text-sm text-muted" style="margin:0 0 14px">' + this._loadCostText() + '</p>'
        + '<div class="close-opt" data-opt="tray">'
        +   '<b>最小化到托盘</b>'
        +   '<span>窗口消失，引擎和模型继续留在显存里。下次打开几乎瞬开（约占用 5 GB 显存）。</span>'
        + '</div>'
        + '<div class="close-opt" data-opt="quit">'
        +   '<b>彻底退出</b>'
        +   '<span>结束引擎并释放显存。下次启动要重新加载模型' + this._loadCostSuffix() + '。</span>'
        + '</div>'
        + '<label class="close-remember"><input type="checkbox" id="close-remember"> 记住这个选择，下次不再询问</label>',
      footer: '<button class="btn" data-act="cancel">取消</button>',
    });
    const done = (action) => {
      Modal.close();
      try { window.electronAPI?.closeDecision?.(action, remember); } catch (e) { /* 忽略 */ }
    };
    overlay.querySelector('#close-remember').addEventListener('change', (e) => {
      remember = !!e.target.checked;
    });
    overlay.querySelectorAll('[data-opt]').forEach((el) => {
      el.addEventListener('click', () => done(el.dataset.opt));
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      Modal.close();
    });
  },

  _setupWindowControls() {
    /* 主进程请求关闭确认时，弹应用内 Modal */
    try { window.electronAPI?.onCloseConfirm?.(() => this._onCloseConfirm()); } catch (e) { /* 忽略 */ }
    document.getElementById('btn-min')?.addEventListener('click', () => window.electronAPI?.minimize());
    document.getElementById('btn-max')?.addEventListener('click', async () => {
      await window.electronAPI?.maximize(); this._updateMaxIcon();
    });
    document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.close());
    document.getElementById('btn-github')?.addEventListener('click', () => App.openRepo());
    window.addEventListener('resize', () => this._updateMaxIcon());
  },

  /* 外部链接统一走主进程（只放行 http/https）。打不开就退回到 window.open，
     两条路都会交给系统默认浏览器，不在应用内开新窗口。 */
  openExternal(url) {
    try {
      const r = window.electronAPI?.openExternal?.(url);
      if (r && typeof r.then === 'function') {
        return r.then((res) => {
          if (res && res.ok === false) { window.open(url, '_blank'); return false; }
          return true;
        }).catch(() => { window.open(url, '_blank'); return false; });
      }
      if (!window.electronAPI?.openExternal) window.open(url, '_blank');
    } catch (e) { window.open(url, '_blank'); }
    return null;
  },

  openRepo() { return this.openExternal(this.REPO_URL); },

  /** 仓库地址：界面里所有「GitHub 入口」都读这里，换仓库只改一处 */
  REPO_URL: 'https://github.com/Listgone/VoxWorkstation',

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
