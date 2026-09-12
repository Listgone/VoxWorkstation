/* ══════════════════════════════════════════
   Store —— 应用状态（设置 / 项目 / 集）
   所有页面通过它读写数据并订阅变更
   ══════════════════════════════════════════ */

const Store = {
  settings: null,
  hasApiKey: false,
  keyEncrypted: false,
  userData: '',

  projects: [],
  currentProjectId: null,
  currentProject: null,      // 完整 project 对象
  episodes: [],
  currentEpisodeNo: null,
  currentEpisode: null,      // { episode, lines, script, scriptOriginal, ... }

  _subs: [],

  /* ── 事件 ── */
  on(fn) { this._subs.push(fn); return () => { this._subs = this._subs.filter(f => f !== fn); }; },
  emit() { this._subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },

  /* ── 初始化 ── */
  async init() {
    const r = await window.electronAPI.settings.get();
    this.settings = r.settings;
    this.hasApiKey = r.hasApiKey;
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
