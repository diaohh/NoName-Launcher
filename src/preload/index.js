const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  msftLogin: () => ipcRenderer.invoke('auth:msftLogin'),
  authLogin: (code) => ipcRenderer.invoke('auth:login', code),
  authLogout: (uuid) => ipcRenderer.invoke('auth:logout', uuid),
  authValidate: () => ipcRenderer.invoke('auth:validate'),
  authGetAccount: () => ipcRenderer.invoke('auth:getAccount'),

  // Config
  configLoad: () => ipcRenderer.invoke('config:load'),
  configSave: () => ipcRenderer.invoke('config:save'),
  configGetSettings: () => ipcRenderer.invoke('config:getSettings'),
  configSetJavaExecutable: (path) => ipcRenderer.invoke('config:setJavaExecutable', path),
  configSetJavaAutoDownload: (val) => ipcRenderer.invoke('config:setJavaAutoDownload', val),
  configSetGameWidth: (w) => ipcRenderer.invoke('config:setGameWidth', w),
  configSetGameHeight: (h) => ipcRenderer.invoke('config:setGameHeight', h),
  configSetFullscreen: (val) => ipcRenderer.invoke('config:setFullscreen', val),
  configSetDataDirectory: (dir) => ipcRenderer.invoke('config:setDataDirectory', dir),

  // Dialogs
  dialogOpenFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  dialogOpenFolder: (options) => ipcRenderer.invoke('dialog:openFolder', options),

  // Shell
  shellOpenPath: (path) => ipcRenderer.invoke('shell:openPath', path),

  // Distribution
  distroLoad: () => ipcRenderer.invoke('distro:load'),
  distroGetServers: () => ipcRenderer.invoke('distro:getServers'),
  distroSelectServer: (id) => ipcRenderer.invoke('distro:selectServer', id),
  distroGetSelected: () => ipcRenderer.invoke('distro:getSelected'),
  distroSetServerData: (data) => ipcRenderer.invoke('distro:setServerData', data),

  // Launch
  launchGame: () => ipcRenderer.invoke('launch:game'),
  launchKill: () => ipcRenderer.invoke('launch:kill'),
  onLaunchProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('launch:progress', handler)
    return () => ipcRenderer.removeListener('launch:progress', handler)
  },

  // Token expiration event (main -> renderer)
  onTokenExpired: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('auth:tokenExpired', handler)
    return () => ipcRenderer.removeListener('auth:tokenExpired', handler)
  },

  // Window controls
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close')
})
