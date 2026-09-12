const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

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
    console.log('[shell] 配置:', JSON.stringify({
      serverDir: CONFIG.serverDir,
      pythonPath: CONFIG.pythonPath,
      serverPort: CONFIG.serverPort
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
