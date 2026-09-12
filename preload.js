const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  onServerStatus: (cb) => ipcRenderer.on('server-status', (_e, d) => cb(d))
});
