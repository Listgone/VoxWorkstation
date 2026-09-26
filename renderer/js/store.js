/* ══════════════════════════════════════════
   Store —— 应用状态（设置 / 项目 / 集）
   所有页面通过它读写数据并订阅变更
   ══════════════════════════════════════════ */

const Store = {
  settings: null,
  keyStatus: {},          // { providerId: { has, hint } } —— 各家 key 分开存
  keyEncrypted: false,
  userData: '',

  projects: [],
  currentProjectId: null,
  currentProject: null,      // 完整 project 对象
  episodes: [],
  currentEpisodeNo: null,
  currentEpisode: null,      // { episode, lines, script, scriptOriginal, ... }

  /* ── 快速配音（独立工作区）──
     进入时把项目上下文整体挂起，退出时原样还回来，
     所以来回切换不会丢项目里"已经整理好"的东西。 */
  isQuick: false,
  quickProjectId: null,
  quickDir: '',
  _prevProjectId: null,
  _prevEpisodeNo: null,

  _subs: [],

  /* ── 事件 ── */
  on(fn) { this._subs.push(fn); return () => { this._subs = this._subs.filter(f => f !== fn); }; },
  emit() { this._subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },

  /** 当前（或指定）服务商是否配了 key —— 取代旧的全局 hasApiKey */
  hasKey(provider) {
    const p = provider
      || (this.settings && this.settings.ai && this.settings.ai.provider)
      || 'deepseek';
    return !!(((this.keyStatus || {})[p]) || {}).has;
  },

  /* ── 初始化 ── */
  async init() {
    const r = await window.electronAPI.settings.get();
    this.settings = r.settings;
    this.keyStatus = r.keyStatus || {};
    this.keyEncrypted = r.keyEncrypted;
    this.userData = r.userData;
    await this.reloadProjects();
    // 恢复上次打开的项目 / 集；没有记录时自动打开最近编辑的那个，
    // 否则首次启动会停在"未选择项目"，一半页面都是空的
    const lastPid = localStorage.getItem('vox-last-project');
    const target = (lastPid && this.projects.some(p => p.id === lastPid))
      ? lastPid
      : (this.projects.find(p => p.status !== 'archived') || this.projects[0] || {}).id;
    if (target) {
      await this.openProject(target, { silent: true });
      const lastNo = Number(localStorage.getItem('vox-last-episode') || 0);
      const no = (lastNo && this.episodes.some(e => e.no === lastNo))
        ? lastNo
        : (this.episodes[0] ? this.episodes[0].no : 0);
      if (no) await this.openEpisode(no, { silent: true });
    }
    this.emit();
  },

  async saveSettings(patch) {
    const r = await window.electronAPI.settings.save(patch);
    if (r && r.ok) { this.settings = r.settings; this.emit(); }
    return r;
  },

  /* ── 项目 ── */
  async reloadProjects() {
    this.projects = await window.electronAPI.projects.list();
    this.emit();
    return this.projects;
  },

  async createProject(args) {
    const r = await window.electronAPI.projects.create(args);
    if (r && r.ok) await this.reloadProjects();
    return r;
  },

  async openProject(id, opts = {}) {
    // 兜底：快速模式是"挂起项目上下文"的状态，任何主动切项目的入口
    // 都必须先把主进程的改道关掉，否则后面的写入会落错地方
    if (this.isQuick) {
      this.isQuick = false;
      this.quickDir = '';
      this._prevProjectId = null;
      this._prevEpisodeNo = null;
      try { window.electronAPI.quick.exit(); } catch (e) { /* 忽略 */ }
    }
    const r = await window.electronAPI.projects.read(id);
    if (!r || !r.ok) return r;
    this.currentProjectId = id;
    this.currentProject = r.project;
    this.currentEpisodeNo = null;
    this.currentEpisode = null;
    localStorage.setItem('vox-last-project', id);
    await this.reloadEpisodes();
    if (!opts.silent) this.emit();
    return r;
  },

  async saveProject(patch) {
    const r = await window.electronAPI.projects.save(this.currentProjectId, patch);
    if (r && r.ok) {
      if (r.renamedTo) { this.currentProjectId = r.renamedTo; localStorage.setItem('vox-last-project', r.renamedTo); }
      this.currentProject = r.project;
      await this.reloadProjects();
    }
    return r;
  },

  async reloadEpisodes() {
    if (!this.currentProjectId) { this.episodes = []; return []; }
    this.episodes = await window.electronAPI.episodes.list(this.currentProjectId);
    this.emit();
    return this.episodes;
  },

  async createEpisode(no, title) {
    const r = await window.electronAPI.episodes.create({ projectId: this.currentProjectId, no, title });
    if (r && r.ok) await this.reloadEpisodes();
    return r;
  },

  /* ── 集 ── */
  async openEpisode(no, opts = {}) {
    if (!this.currentProjectId) return { ok: false, message: '未选择项目' };
    const r = await window.electronAPI.episodes.read(this.currentProjectId, no);
    if (!r || !r.ok) return r;
    this.currentEpisodeNo = no;
    this.currentEpisode = r;
    localStorage.setItem('vox-last-episode', String(no));
    if (!opts.silent) this.emit();
    return r;
  },

  async saveEpisode(payload) {
    if (!this.currentProjectId || !this.currentEpisodeNo) return { ok: false };
    const r = await window.electronAPI.episodes.write(this.currentProjectId, this.currentEpisodeNo, payload);
    await this.reloadEpisodes();
    return r;
  },

  /* ── 快速配音（独立工作区）───────────────
     进入时把项目上下文整体挂起，退出时原样还回来，
     所以来回切换不会丢项目里"已经整理好"的东西。 */

  /** 进入独立工作区 */
  enterQuick(projectId, no, dir) {
    if (!this.isQuick) {
      this._prevProjectId = this.currentProjectId || null;
      this._prevEpisodeNo = this.currentEpisodeNo || null;
    }
    this.isQuick = true;
    this.quickProjectId = projectId;
    this.quickDir = dir || '';
    this.currentProjectId = projectId;
    this.currentEpisodeNo = no || 1;
    this.currentProject = {
      schema: 1, id: projectId, name: '快速配音', desc: '',
      type: 'single', status: 'active', padWidth: 2, seasons: [],
      roles: [], fallbackVoice: '', dict: [], ai: { features: [] },
      defaults: { cfg: 2.0, steps: 10, pauseMs: 300, maxLineLen: 25 },
      output: { naming: '{no}_{text}', exportSrt: false }
    };
    this.episodes = [{ no: this.currentEpisodeNo, title: '快速配音', status: 'draft' }];
    this.emit();
  },

  /** 退出：还回原来的项目与集；项目已被删掉就停在"未选择" */
  async exitQuick() {
    const pid = this._prevProjectId;
    const no = this._prevEpisodeNo;
    this.isQuick = false;
    this.quickDir = '';
    this.currentProject = null;
    this.currentEpisode = null;
    this.currentEpisodeNo = null;
    this.currentProjectId = null;
    this.episodes = [];
    this._prevProjectId = null;
    this._prevEpisodeNo = null;
    if (pid && (this.projects || []).some(p => p.id === pid)) {
      await this.openProject(pid, { silent: true });
      if (no && (this.episodes || []).some(e => e.no === no)) {
        await this.openEpisode(no, { silent: true });
      }
    }
    this.emit();
  },

  /* ── 季 ── */
  seasonOf(no) {
    const list = (this.currentProject && this.currentProject.seasons) || [];
    return list.find(s => no >= s.from && no <= s.to) || null;
  },

  epById(no) { return this.episodes.find(e => e.no === no) || null; },

  /* ── 派生统计 ── */
  stats(episodes) {
    const eps = episodes || this.episodes;
    const done = eps.filter(e => e.status === 'done' || e.status === 'delivered');
    return {
      count: eps.length,
      done: done.length,
      dubbing: eps.filter(e => e.status === 'dubbing').length,
      draft: eps.filter(e => e.status === 'draft' || e.status === 'text').length,
      failed: eps.filter(e => e.failureCount > 0).length,
      chars: eps.reduce((s, e) => s + (e.chars || 0), 0),
      lines: eps.reduce((s, e) => s + (e.lineCount || 0), 0),
      doneLines: eps.reduce((s, e) => s + (e.doneCount || 0), 0),
      durationMs: eps.reduce((s, e) => s + (e.durationMs || 0), 0)
    };
  }
};
