const { contextBridge, ipcRenderer } = require('electron');

/** 注册一个可取消订阅的 ipc 监听 */
function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('electronAPI', {
  /* 窗口 */
  minimize: () => invoke('window-minimize'),
  maximize: () => invoke('window-maximize'),
  close: () => invoke('window-close'),

  /* 后端引擎 */
  getServerUrl: () => invoke('get-server-url'),
  getConfig: () => invoke('get-config'),
  restartServer: () => invoke('restart-server'),
  onServerStatus: (cb) => subscribe('server-status', cb),
  onServerLog: (cb) => subscribe('server-log', cb),

  /* 应用设置 */
  settings: {
    get: () => invoke('vox:settings:get'),
    save: (patch) => invoke('vox:settings:save', patch),
    setApiKey: (key) => invoke('vox:settings:setApiKey', key),
    clearApiKey: () => invoke('vox:settings:clearApiKey'),
    getApiKey: () => invoke('vox:settings:getApiKey')
  },

  /* AI 服务 */
  ai: {
    test: () => invoke('vox:ai:test'),
    process: (task, text, options) => invoke('vox:ai:process', { task, text, options }),
    models: (override) => invoke('vox:ai:models', override),
    onProgress: (cb) => subscribe('vox:ai-progress', cb)
  },

  /* 项目 */
  projects: {
    list: () => invoke('vox:projects:list'),
    create: (args) => invoke('vox:project:create', args),
    read: (id) => invoke('vox:project:read', id),
    save: (id, patch) => invoke('vox:project:save', { id, patch }),
    setStatus: (id, status) => invoke('vox:project:status', { id, status }),
    remove: (id, toRecycle = true) => invoke('vox:project:delete', { id, toRecycle }),
    reveal: (id) => invoke('vox:project:reveal', id)
  },

  /* 集 */
  episodes: {
    list: (projectId) => invoke('vox:episodes:list', { projectId }),
    create: (args) => invoke('vox:episode:create', args),
    read: (projectId, no) => invoke('vox:episode:read', { projectId, no }),
    write: (projectId, no, payload) => invoke('vox:episode:write', { projectId, no, payload }),
    remove: (projectId, no, toRecycle = true) => invoke('vox:episode:delete', { projectId, no, toRecycle }),
    listAudio: (projectId, no) => invoke('vox:episode:listAudio', { projectId, no }),
    listOutput: (projectId, no) => invoke('vox:episode:listOutput', { projectId, no }),
    logExport: (projectId, no, entry) => invoke('vox:episode:logExport', { projectId, no, entry }),
    reveal: (projectId, no) => invoke('vox:episode:reveal', { projectId, no })
  },

  /* 音频文件 */
  audio: {
    save: (projectId, no, filename, base64) => invoke('vox:episode:saveAudio', { projectId, no, filename, base64 }),
    read: (projectId, no, filename) => invoke('vox:episode:readAudio', { projectId, no, filename })
  },

  /* 路径工具 */
  path: {
    pick: (args) => invoke('vox:path:pick', args),
    reveal: (p) => invoke('vox:path:reveal', p)
  }
});
