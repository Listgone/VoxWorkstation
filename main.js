const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const SERVER_DIR = 'D:\\Voxcpm2';
const SERVER_PORT = 8000;
const SERVER_SCRIPT = path.join(SERVER_DIR, 'server.py');

let mainWindow = null;
let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('python', [SERVER_SCRIPT], { cwd: SERVER_DIR, stdio: 'ignore', windowsHide: true });
    serverProcess.on('error', (err) => reject(new Error(err.message)));
    const t0 = Date.now();
    const check = () => {
      http.get('http://127.0.0.1:' + SERVER_PORT + '/api/gpu/memory', () => resolve())
        .on('error', () => Date.now() - t0 > 180000 ? reject(new Error('timeout')) : setTimeout(check, 1000))
        .setTimeout(2000, function() { this.destroy(); });
    };
    setTimeout(check, 2000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    frame: false, backgroundColor: '#0f1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('get-server-url', () => 'http://127.0.0.1:' + SERVER_PORT);

app.whenReady().then(async () => {
  createWindow();
  try { await startServer(); mainWindow?.webContents.send('server-status', { status: 'ready' }); }
  catch (err) { mainWindow?.webContents.send('server-status', { status: 'error', message: err.message }); }
});

app.on('window-all-closed', () => { if (serverProcess) serverProcess.kill(); app.quit(); });
