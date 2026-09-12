const { contextBridge, ipcRenderer } = require('electron');

/** 注册一个可取消订阅的 ipc 监听 */
function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 返回取消订阅函数，避免重复注册
  onServerStatus: (cb) => subscribe('server-status', cb),
  onServerLog: (cb) => subscribe('server-log', cb)
});
