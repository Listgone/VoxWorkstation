const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { ProjectStore } = require('./project-store');

/* ══════════════════════════════════════════════════════════
   配置：环境变量 > vox.config.json > 内置默认值
   ══════════════════════════════════════════════════════════ */
const DEFAULTS = {
  serverDir: 'D:\\Voxcpm2',
  serverScript: 'server.py',
  pythonPath: 'python',
  serverPort: 8000,
  autoStartServer: true,
  serverStartTimeoutMs: 180000
};

function loadConfig() {
  const cfg = { ...DEFAULTS };

  const candidates = [
    path.join(__dirname, 'vox.config.json'),                 // 随应用分发
    path.join(app.getPath('userData'), 'vox.config.json')    // 用户级覆盖
  ];
  for (const file of candidates) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[config] 解析失败:', file, e.message);
    }
  }

  if (process.env.VOX_SERVER_DIR) cfg.serverDir = process.env.VOX_SERVER_DIR;
  if (process.env.VOX_PYTHON) cfg.pythonPath = process.env.VOX_PYTHON;
  if (process.env.VOX_SERVER_PORT) cfg.serverPort = Number(process.env.VOX_SERVER_PORT);

  cfg.serverPort = Number(cfg.serverPort) || DEFAULTS.serverPort;
  cfg.serverScriptPath = path.isAbsolute(cfg.serverScript)
    ? cfg.serverScript
    : path.join(cfg.serverDir, cfg.serverScript);
  return cfg;
}

let CONFIG = { ...DEFAULTS };
let mainWindow = null;
let serverProcess = null;
let serverState = 'idle';                 // idle | starting | ready | error
let lastStatus = { status: 'starting', message: '正在启动 VoxCPM2 引擎...' };

const logBuffer = [];

/* ══════════════════════════════════════════════════════════
   应用设置（主题 / AI 服务 / 输出 / 隐私 …）
   API Key 用 safeStorage 加密，不落明文
   ══════════════════════════════════════════════════════════ */
const APP_SETTINGS_DEFAULTS = {
  theme: 'light',
  reduceMotion: false,
  uiScale: 1,
  language: 'zh-CN',
  ai: {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    timeoutSec: 60,
    retries: 2,
    maxCharsPerCall: 4000
  },
  tts: { autoStart: true, cfg: 2.0, steps: 10, vramWarnPct: 90 },
  output: {
    root: 'D:\\VoxOutput',
    format: 'wav',
    sampleRate: 44100,
    pauseMs: 300,
    naming: '{ep}_{role}_{voice}_{no}',
    exportSrt: true
  },
  project: { autoSaveSec: 30, dailyBackup: true },
  network: { useSystemProxy: false, proxy: '' },
  privacy: { redact: false, onlyCurrentParagraph: true, keepDiffHistory: true },
  notify: { onDone: true, onFail: true }
};

let appSettings = null;

function settingsFile() { return path.join(app.getPath('userData'), 'app-settings.json'); }
function keyFile() { return path.join(app.getPath('userData'), 'ai-key.bin'); }

function loadAppSettings() {
  const s = JSON.parse(JSON.stringify(APP_SETTINGS_DEFAULTS));
  const saved = (() => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return null; } })();
  if (saved) {
    for (const k of Object.keys(s)) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) Object.assign(s[k], saved[k]);
      else if (saved[k] !== undefined) s[k] = saved[k];
    }
  }
  return s;
}

function saveAppSettings(patch) {
  appSettings = appSettings || loadAppSettings();
  for (const k of Object.keys(patch || {})) {
    if (appSettings[k] && typeof appSettings[k] === 'object' && !Array.isArray(appSettings[k])) {
      Object.assign(appSettings[k], patch[k]);
    } else {
      appSettings[k] = patch[k];
    }
  }
  try { fs.writeFileSync(settingsFile(), JSON.stringify(appSettings, null, 2), 'utf8'); }
  catch (e) { return { ok: false, message: e.message }; }
  if (appSettings.output && appSettings.output.root && store) store.setRoot(appSettings.output.root);
  return { ok: true, settings: appSettings };
}

function saveApiKey(key) {
  try {
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(key))
      : Buffer.from(String(key), 'utf8');
    fs.writeFileSync(keyFile(), payload);
    return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
  } catch (e) { return { ok: false, message: e.message }; }
}

function readApiKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch (e) { return ''; }
}

/* ══════════════════════════════════════════════════════════
   项目存储
   ══════════════════════════════════════════════════════════ */
let store = null;

/* ══════════════════════════════════════════════════════════
   与渲染进程通信
   ══════════════════════════════════════════════════════════ */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setStatus(status) {
  lastStatus = status;
  send('server-status', status);
}

function pushLog(chunk) {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    logBuffer.push(line);
    if (logBuffer.length > 200) logBuffer.shift();
    send('server-log', line);
  }
}

/* ══════════════════════════════════════════════════════════
   后端进程管理
   ══════════════════════════════════════════════════════════ */
function probe(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/gpu/memory', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** 结束整个后端进程树。
 *  Windows 上 child.kill() 只杀直接子进程，server.py 里再 spawn 的东西会变僵尸。*/
function killServerTree() {
  const child = serverProcess;
  serverProcess = null;
  if (!child || child.exitCode !== null || child.killed) return;

  pushLog(`[shell] 结束后端进程 (pid=${child.pid})`);
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {}); } catch (e) {}
  } else {
    try { child.kill('SIGTERM'); } catch (e) {}
  }
}

function startServer() {
  return new Promise((resolve) => {
    const { serverScriptPath, serverDir, pythonPath, serverPort, serverStartTimeoutMs } = CONFIG;

    if (!fs.existsSync(serverScriptPath)) {
      resolve({ ok: false, message: `找不到后端脚本：${serverScriptPath}（可在 vox.config.json 配置 serverDir）` });
      return;
    }

    serverState = 'starting';
    pushLog(`[shell] 启动后端：${pythonPath} "${serverScriptPath}"`);

    let child;
    try {
      child = spawn(pythonPath, [serverScriptPath], {
        cwd: serverDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, message: '无法启动 Python：' + e.message });
      return;
    }
    serverProcess = child;

    // server.py 的 print/异常全部转发到加载页，不再"静默 180 秒然后超时"
    child.stdout?.on('data', (b) => pushLog(b.toString()));
    child.stderr?.on('data', (b) => pushLog(b.toString()));

    let settled = false;
    let poll = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      serverState = result.ok ? 'ready' : 'error';
      resolve(result);
    };

    child.on('error', (err) => {
      const message = err.code === 'ENOENT'
        ? `找不到 Python 可执行文件「${pythonPath}」，请在 vox.config.json 里配置 pythonPath`
        : err.message;
      pushLog('[shell] ' + message);
      finish({ ok: false, message });
    });

    child.on('exit', (code, signal) => {
      pushLog(`[shell] 后端进程退出 (code=${code}, signal=${signal})`);
      if (serverProcess === child) serverProcess = null;
      if (!settled) {
        finish({ ok: false, message: `后端进程启动后立即退出（code=${code}），请查看上方日志` });
      } else if (serverState === 'ready') {
        serverState = 'error';
        setStatus({ status: 'error', message: '后端进程意外退出' });
      }
    });

    const startedAt = Date.now();
    poll = setInterval(async () => {
      if (await probe(serverPort)) {
        pushLog('[shell] 后端已就绪');
        finish({ ok: true });
        return;
      }
      if (Date.now() - startedAt > serverStartTimeoutMs) {
        finish({ ok: false, message: `等待后端超时（${Math.round(serverStartTimeoutMs / 1000)} 秒）` });
      }
    }, 1000);
  });
}

async function ensureServer() {
  if (serverState === 'ready') return { ok: true };

  // 端口上已经有服务在跑（例如用户自己启动过 app.py）→ 直接复用，
  // 避免再拉一个绑不上端口、却让健康检查通过第二个进程的假象
  if (await probe(CONFIG.serverPort)) {
    pushLog(`[shell] 端口 ${CONFIG.serverPort} 已有后端在运行，直接复用`);
    serverState = 'ready';
    return { ok: true, reused: true };
  }

  if (!CONFIG.autoStartServer) {
    return { ok: false, message: `后端未运行，且 autoStartServer=false（端口 ${CONFIG.serverPort}）` };
  }
  return startServer();
}

/* ══════════════════════════════════════════════════════════
   窗口
   ══════════════════════════════════════════════════════════ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    frame: false,
    backgroundColor: '#0f1117',
    icon: path.join(__dirname, 'assets', 'icons', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 首屏渲染完成时补发一次当前状态。
  // 否则：后端早已在跑时 ensureServer() 会在渲染进程注册监听之前就返回，
  // ready 事件丢失 → 界面永远卡在加载页。
  mainWindow.webContents.once('did-finish-load', () => {
    logBuffer.slice(-4).forEach((line) => send('server-log', line));
    send('server-status', lastStatus);
  });

  // 安全兜底：外链交给系统浏览器，禁止应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ══════════════════════════════════════════════════════════
   IPC
   ══════════════════════════════════════════════════════════ */
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('get-server-url', () => `http://127.0.0.1:${CONFIG.serverPort}`);
ipcMain.handle('get-config', () => ({
  serverPort: CONFIG.serverPort,
  serverDir: CONFIG.serverDir,
  pythonPath: CONFIG.pythonPath
}));
ipcMain.handle('restart-server', async () => {
  killServerTree();
  serverState = 'idle';
  const res = await ensureServer();
  if (res.ok) setStatus({ status: 'ready' });
  return res;
});

/* ══════════════════════════════════════════════════════════
   项目 / 集 / 设置 IPC
   ══════════════════════════════════════════════════════════ */
const needStore = () => {
  if (!store) {
    appSettings = appSettings || loadAppSettings();
    store = new ProjectStore(appSettings.output.root);
  }
  return store;
};

ipcMain.handle('vox:settings:get', () => {
  appSettings = appSettings || loadAppSettings();
  return {
    settings: appSettings,
    hasApiKey: !!readApiKey(),
    keyEncrypted: safeStorage.isEncryptionAvailable(),
    userData: app.getPath('userData')
  };
});
ipcMain.handle('vox:settings:save', (_e, patch) => saveAppSettings(patch || {}));
ipcMain.handle('vox:settings:setApiKey', (_e, key) => saveApiKey(key));
ipcMain.handle('vox:settings:getApiKey', () => readApiKey());

ipcMain.handle('vox:ai:test', async () => {
  appSettings = appSettings || loadAppSettings();
  const ai = appSettings.ai || {};
  const key = readApiKey();
  if (!key) return { ok: false, message: '未配置 API Key' };
  const base = String(ai.baseURL || '').replace(/\/+$/, '');
  if (!base) return { ok: false, message: '未配置接口地址' };

  const body = JSON.stringify({
    model: ai.model || 'deepseek-chat',
    messages: [{ role: 'user', content: '回复两个字：正常' }],
    max_tokens: 16, stream: false
  });
  return new Promise((resolve) => {
    let url;
    try { url = new URL(base + '/chat/completions'); }
    catch (e) { return resolve({ ok: false, message: '接口地址格式不对' }); }
    const req = http.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key,
                 'Content-Length': Buffer.byteLength(body) },
      timeout: Math.min(30000, (ai.timeoutSec || 60) * 1000)
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let reply = '';
          try { reply = JSON.parse(data).choices[0].message.content.trim(); } catch (e) {}
          resolve({ ok: true, message: '连接正常', reply, status: res.statusCode });
        } else {
          resolve({ ok: false, message: `HTTP ${res.statusCode}：` + data.slice(0, 180), status: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: '请求超时' }); });
    req.write(body);
    req.end();
  });
});

ipcMain.handle('vox:projects:list', () => needStore().listProjects());
ipcMain.handle('vox:project:create', (_e, args) => needStore().createProject(args || {}));
ipcMain.handle('vox:project:read', (_e, id) => needStore().readProject(id));
ipcMain.handle('vox:project:save', (_e, { id, patch }) => needStore().saveProject(id, patch || {}));
ipcMain.handle('vox:project:status', (_e, { id, status }) => needStore().setProjectStatus(id, status));
ipcMain.handle('vox:project:delete', (_e, { id, toRecycle }) => needStore().deleteProject(id, { toRecycle }));
ipcMain.handle('vox:project:reveal', (_e, id) => { shell.openPath(needStore().projectDir(id)); return { ok: true }; });

ipcMain.handle('vox:episodes:list', (_e, { projectId }) => {
  const st = needStore();
  const p = st.readProject(projectId);
  if (!p.ok) return [];
  return st.listEpisodes(projectId, p.project.padWidth);
});
ipcMain.handle('vox:episode:create', (_e, args) => needStore().createEpisode(args.projectId, args));
ipcMain.handle('vox:episode:read', (_e, { projectId, no }) => needStore().readEpisode(projectId, no));
ipcMain.handle('vox:episode:write', (_e, { projectId, no, payload }) => needStore().writeEpisode(projectId, no, payload || {}));
ipcMain.handle('vox:episode:delete', (_e, { projectId, no, toRecycle }) => needStore().deleteEpisode(projectId, no, { toRecycle }));
ipcMain.handle('vox:episode:saveAudio', (_e, args) => needStore().saveAudio(args.projectId, args.no, args.filename, args.base64));
ipcMain.handle('vox:episode:readAudio', (_e, args) => needStore().readAudio(args.projectId, args.no, args.filename));
ipcMain.handle('vox:episode:listAudio', (_e, args) => needStore().listAudio(args.projectId, args.no));
ipcMain.handle('vox:episode:listOutput', (_e, args) => needStore().listOutput(args.projectId, args.no));
ipcMain.handle('vox:episode:logExport', (_e, args) => needStore().appendExportLog(args.projectId, args.no, args.entry || {}));
ipcMain.handle('vox:episode:reveal', (_e, args) => { shell.openPath(needStore().episodePath(args.projectId, args.no)); return { ok: true }; });
ipcMain.handle('vox:path:reveal', (_e, p) => { shell.openPath(String(p || '')); return { ok: true }; });
ipcMain.handle('vox:path:pick', async (_e, { title, defaultPath }) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || '选择目录', defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled ? { ok: false } : { ok: true, path: r.filePaths[0] };
});

/* ══════════════════════════════════════════════════════════
   生命周期（单实例：避免双击两次起两个后端抢端口）
   ══════════════════════════════════════════════════════════ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    CONFIG = loadConfig();
    appSettings = loadAppSettings();
    store = new ProjectStore(appSettings.output.root);
    console.log('[shell] 配置:', JSON.stringify({
      serverDir: CONFIG.serverDir,
      pythonPath: CONFIG.pythonPath,
      serverPort: CONFIG.serverPort,
      outputRoot: appSettings.output.root
    }));

    createWindow();
    setStatus({ status: 'starting', message: '正在启动 VoxCPM2 引擎...' });

    const res = await ensureServer();
    if (res.ok) setStatus({ status: 'ready' });
    else setStatus({ status: 'error', message: res.message });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    killServerTree();
    app.quit();
  });

  app.on('before-quit', () => killServerTree());
}
