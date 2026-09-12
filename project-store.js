/* ══════════════════════════════════════════════════════════
   ProjectStore —— 项目 / 季 / 集的落盘层
   目录约定（季为区间，集平铺为文件夹）：

   <root>\<项目名>\
     project.voxproj            项目配置（季划分 / 角色音色 / 默认参数 / 词典）
     _shared\dict.json          项目级词典（冗余一份，便于整包拷走）
     _shared\voices\            项目专用音色
     第01集\
       script.original.txt      原文备份，永不改动
       script.txt               AI 处理后的台词
       lines.json               分句 + 角色 + 生成状态
       audio\                   逐句音频
       output\                  导出成品
       export-log.json          导出记录
   ══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const EP_PREFIX = '第';
const EP_SUFFIX = '集';

const DEFAULT_PROJECT = {
  schema: 1,
  id: '',
  name: '',
  desc: '',
  type: 'series',              // series | single | audiobook
  status: 'active',            // active | archived
  createdAt: '',
  updatedAt: '',
  padWidth: 2,                 // 集号补零位数
  seasons: [],                 // [{ name, from, to }]
  roles: [],                   // [{ name, voice, cfg, steps, desc }]
  fallbackVoice: '',           // 未登记角色的兜底音色
  defaults: { cfg: 2.0, steps: 10, pauseMs: 300, maxLineLen: 25 },
  dict: [],                    // [{ word, reading }]
  ai: { provider: '', model: '', prompt: '', features: [] },
  output: { naming: '{ep}_{role}_{voice}_{no}', exportSrt: true },
  storage: { keepLineAudio: true }
};

const DEFAULT_EPISODE = {
  schema: 1,
  no: 0,
  title: '',
  status: 'draft',             // draft | text | dubbing | done | delivered
  chars: 0,
  lineCount: 0,
  doneCount: 0,
  durationMs: 0,
  createdAt: '',
  updatedAt: '',
  failureCount: 0
};

const nowISO = () => new Date().toISOString();

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '未命名';
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function pad(n, width) {
  return String(n).padStart(Math.max(1, width || 2), '0');
}

class ProjectStore {
  constructor(rootDir) {
    this.root = rootDir;
    this.ensureRoot();
  }

  ensureRoot() {
    try { fs.mkdirSync(this.root, { recursive: true }); } catch (e) { /* ignore */ }
  }

  setRoot(dir) {
    this.root = dir;
    this.ensureRoot();
  }

  projectDir(id) { return path.join(this.root, id); }
  projectFile(id) { return path.join(this.projectDir(id), 'project.voxproj'); }
  sharedDir(id) { return path.join(this.projectDir(id), '_shared'); }
  episodeDir(id, no, width) {
    return path.join(this.projectDir(id), EP_PREFIX + pad(no, width) + EP_SUFFIX);
  }

  /* ── 项目 ───────────────────────────────── */

  listProjects() {
    this.ensureRoot();
    let names = [];
    try {
      names = fs.readdirSync(this.root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch (e) { return []; }

    const out = [];
    for (const name of names) {
      const f = this.projectFile(name);
      if (!fs.existsSync(f)) continue;
      const p = readJSON(f, null);
      if (!p) continue;
      out.push(this._summarize(p));
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  _summarize(p) {
    const eps = this.listEpisodes(p.id, p.padWidth);
    const done = eps.filter(e => e.status === 'done' || e.status === 'delivered').length;
    return {
      id: p.id, name: p.name, desc: p.desc, type: p.type, status: p.status,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      dir: this.projectDir(p.id),
      episodeCount: eps.length,
      doneCount: done,
      totalChars: eps.reduce((s, e) => s + (e.chars || 0), 0),
      totalLines: eps.reduce((s, e) => s + (e.lineCount || 0), 0),
      totalDurationMs: eps.reduce((s, e) => s + (e.durationMs || 0), 0),
      seasons: p.seasons || []
    };
  }

  createProject({ name, type, desc }) {
    const id = safeName(name);
    const dir = this.projectDir(id);
    if (fs.existsSync(this.projectFile(id))) {
      return { ok: false, message: '同名项目已存在：' + id };
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(this.sharedDir(id), { recursive: true });
    fs.mkdirSync(path.join(this.sharedDir(id), 'voices'), { recursive: true });
    writeJSON(path.join(this.sharedDir(id), 'dict.json'), []);

    const p = {
      ...DEFAULT_PROJECT,
      id, name: id,
      desc: desc || '',
      type: type || 'series',
      createdAt: nowISO(),
      updatedAt: nowISO(),
      seasons: [{ name: '第一季', from: 1, to: 20 }]
    };
    writeJSON(this.projectFile(id), p);
    return { ok: true, project: this._summarize(p) };
  }

  readProject(id) {
    const p = readJSON(this.projectFile(id), null);
    if (!p) return { ok: false, message: '项目不存在：' + id };
    return { ok: true, project: p, summary: this._summarize(p) };
  }

  saveProject(id, patch) {
    const cur = readJSON(this.projectFile(id), null);
    if (!cur) return { ok: false, message: '项目不存在：' + id };
    const next = { ...cur, ...patch, id, updatedAt: nowISO() };
    // 改名 → 同步重命名文件夹
    if (patch.name && safeName(patch.name) !== id) {
      const newId = safeName(patch.name);
      const from = this.projectDir(id), to = this.projectDir(newId);
      if (fs.existsSync(to)) return { ok: false, message: '目标文件夹已存在：' + newId };
      try { fs.renameSync(from, to); } catch (e) { return { ok: false, message: '重命名失败：' + e.message }; }
      next.id = newId;
      next.name = newId;
      writeJSON(this.projectFile(newId), next);
      return { ok: true, project: next, renamedTo: newId };
    }
    writeJSON(this.projectFile(id), next);
    return { ok: true, project: next };
  }

  setProjectStatus(id, status) {
    return this.saveProject(id, { status });
  }

  deleteProject(id, { toRecycle = true } = {}) {
    const dir = this.projectDir(id);
    if (!fs.existsSync(dir)) return { ok: false, message: '项目不存在' };
    if (toRecycle) {
      // 移到项目根下的 .trash，30 天内可恢复
      const trash = path.join(this.root, '.trash');
      fs.mkdirSync(trash, { recursive: true });
      const dest = path.join(trash, id + '_' + Date.now());
      try { fs.renameSync(dir, dest); return { ok: true, trashedTo: dest }; }
      catch (e) { return { ok: false, message: e.message }; }
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true }; }
    catch (e) { return { ok: false, message: e.message }; }
  }

  /* ── 集 ─────────────────────────────────── */

  listEpisodes(projectId, padWidth) {
    const dir = this.projectDir(projectId);
    if (!fs.existsSync(dir)) return [];
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map(d => d.name);
    } catch (e) { return []; }

    const out = [];
    for (const name of names) {
      const m = name.match(/^第(\d+)集$/);
      if (!m) continue;
      const meta = readJSON(path.join(dir, name, 'episode.json'), null);
      const lines = readJSON(path.join(dir, name, 'lines.json'), []);
      const no = parseInt(m[1], 10);
      const ep = { ...DEFAULT_EPISODE, ...(meta || {}), no };
      ep.lineCount = Array.isArray(lines) ? lines.length : (ep.lineCount || 0);
      ep.doneCount = Array.isArray(lines) ? lines.filter(l => l && l.audio).length : (ep.doneCount || 0);
      ep.failureCount = Array.isArray(lines) ? lines.filter(l => l && l.error).length : 0;
      ep.chars = ep.chars || 0;
      out.push(ep);
    }
    out.sort((a, b) => a.no - b.no);
    return out;
  }

  createEpisode(projectId, { no, title }) {
    const proj = readJSON(this.projectFile(projectId), null);
    if (!proj) return { ok: false, message: '项目不存在' };
    const width = proj.padWidth || 2;
    const dir = this.episodeDir(projectId, no, width);
    if (fs.existsSync(dir)) return { ok: false, message: '该集已存在：' + no };
    fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
    const ep = {
      ...DEFAULT_EPISODE, no, title: title || ('第' + pad(no, width) + '集'),
      createdAt: nowISO(), updatedAt: nowISO()
    };
    writeJSON(path.join(dir, 'episode.json'), ep);
    writeJSON(path.join(dir, 'lines.json'), []);
    fs.writeFileSync(path.join(dir, 'script.original.txt'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'script.txt'), '', 'utf8');
    writeJSON(path.join(dir, 'export-log.json'), []);
    this.saveProject(projectId, {});
    return { ok: true, episode: ep };
  }

  episodePath(projectId, no) {
    const proj = readJSON(this.projectFile(projectId), null);
    const width = proj ? (proj.padWidth || 2) : 2;
    return this.episodeDir(projectId, no, width);
  }

  readEpisode(projectId, no) {
    const dir = this.episodePath(projectId, no);
    if (!fs.existsSync(dir)) return { ok: false, message: '集不存在' };
    const meta = readJSON(path.join(dir, 'episode.json'), { no });
    const lines = readJSON(path.join(dir, 'lines.json'), []);
    const readText = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } };
    return {
      ok: true,
      episode: meta,
      lines,
      scriptOriginal: readText('script.original.txt'),
      script: readText('script.txt'),
      exportLog: readJSON(path.join(dir, 'export-log.json'), []),
      dir
    };
  }

  writeEpisode(projectId, no, { episode, lines, script, scriptOriginal }) {
    const dir = this.episodePath(projectId, no);
    if (!fs.existsSync(dir)) return { ok: false, message: '集不存在' };
    if (episode) writeJSON(path.join(dir, 'episode.json'), { ...episode, no, updatedAt: nowISO() });
    if (Array.isArray(lines)) writeJSON(path.join(dir, 'lines.json'), lines);
    if (typeof scriptOriginal === 'string') fs.writeFileSync(path.join(dir, 'script.original.txt'), scriptOriginal, 'utf8');
    if (typeof script === 'string') fs.writeFileSync(path.join(dir, 'script.txt'), script, 'utf8');
    this.saveProject(projectId, {});   // 刷新项目 updatedAt
    return { ok: true };
  }

  deleteEpisode(projectId, no, { toRecycle = true } = {}) {
    const dir = this.episodePath(projectId, no);
    if (!fs.existsSync(dir)) return { ok: false, message: '集不存在' };
    if (toRecycle) {
      const trash = path.join(this.projectDir(projectId), '.trash');
      fs.mkdirSync(trash, { recursive: true });
      try { fs.renameSync(dir, path.join(trash, path.basename(dir) + '_' + Date.now())); return { ok: true }; }
      catch (e) { return { ok: false, message: e.message }; }
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true }; }
    catch (e) { return { ok: false, message: e.message }; }
  }

  /* ── 音频 ───────────────────────────────── */

  saveAudio(projectId, no, filename, base64) {
    const dir = this.episodePath(projectId, no);
    if (!fs.existsSync(dir)) return { ok: false, message: '集不存在' };
    const audioDir = path.join(dir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const safe = safeName(filename).replace(/_/g, '_');
    const file = path.join(audioDir, safe);
    try {
      fs.writeFileSync(file, Buffer.from(base64, 'base64'));
      return { ok: true, path: file, name: safe };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  readAudio(projectId, no, filename) {
    const dir = this.episodePath(projectId, no);
    const file = path.join(dir, 'audio', path.basename(filename));
    if (!fs.existsSync(file)) return { ok: false, message: '音频不存在' };
    return { ok: true, base64: fs.readFileSync(file).toString('base64') };
  }

  listAudio(projectId, no) {
    const dir = this.episodePath(projectId, no);
    const audioDir = path.join(dir, 'audio');
    try {
      return fs.readdirSync(audioDir).filter(f => /\.(wav|mp3|flac|m4a)$/i.test(f));
    } catch (e) { return []; }
  }

  listOutput(projectId, no) {
    const dir = this.episodePath(projectId, no);
    const outDir = path.join(dir, 'output');
    try {
      return fs.readdirSync(outDir, { withFileTypes: true })
        .filter(d => d.isFile())
        .map(d => ({ name: d.name, size: fs.statSync(path.join(outDir, d.name)).size }));
    } catch (e) { return []; }
  }

  appendExportLog(projectId, no, entry) {
    const dir = this.episodePath(projectId, no);
    const f = path.join(dir, 'export-log.json');
    const log = readJSON(f, []);
    log.unshift({ ...entry, time: nowISO() });
    writeJSON(f, log.slice(0, 200));
    return { ok: true };
  }

  /* ── 派生统计 ───────────────────────────── */

  seasonOf(project, no) {
    const list = (project && project.seasons) || [];
    for (const s of list) {
      if (no >= s.from && no <= s.to) return s;
    }
    return null;
  }
}

module.exports = { ProjectStore, DEFAULT_PROJECT, DEFAULT_EPISODE, safeName };
