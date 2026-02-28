export const ipc = {
  auth: {
    msftLogin: () => window.electronAPI.msftLogin(),
    login: (code) => window.electronAPI.authLogin(code),
    logout: (uuid) => window.electronAPI.authLogout(uuid),
    validate: () => window.electronAPI.authValidate(),
    getAccount: () => window.electronAPI.authGetAccount()
  },
  config: {
    getSettings: () => window.electronAPI.configGetSettings(),
    setJavaExecutable: (path) => window.electronAPI.configSetJavaExecutable(path),
    setJavaAutoDownload: (val) => window.electronAPI.configSetJavaAutoDownload(val),
    setGameWidth: (w) => window.electronAPI.configSetGameWidth(w),
    setGameHeight: (h) => window.electronAPI.configSetGameHeight(h),
    setFullscreen: (val) => window.electronAPI.configSetFullscreen(val),
    setDataDirectory: (dir) => window.electronAPI.configSetDataDirectory(dir)
  },
  dialog: {
    openFile: (options) => window.electronAPI.dialogOpenFile(options),
    openFolder: (options) => window.electronAPI.dialogOpenFolder(options)
  },
  shell: {
    openPath: (path) => window.electronAPI.shellOpenPath(path)
  },
  distro: {
    load: () => window.electronAPI.distroLoad(),
    getServers: () => window.electronAPI.distroGetServers(),
    selectServer: (id) => window.electronAPI.distroSelectServer(id),
    getSelected: () => window.electronAPI.distroGetSelected(),
    setServerData: (data) => window.electronAPI.distroSetServerData(data)
  },
  launch: {
    game: () => window.electronAPI.launchGame(),
    kill: () => window.electronAPI.launchKill(),
    onProgress: (cb) => window.electronAPI.onLaunchProgress(cb)
  },
  events: {
    onTokenExpired: (cb) => window.electronAPI.onTokenExpired(cb)
  },
  window: {
    minimize: () => window.electronAPI.windowMinimize(),
    maximize: () => window.electronAPI.windowMaximize(),
    close: () => window.electronAPI.windowClose()
  }
}
