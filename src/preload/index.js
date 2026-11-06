import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/channels'

// The channel names come from the same module the handlers register with. electron-vite
// bundles the preload — still emitted as CJS, which the sandbox requires — so importing it
// costs nothing, and a renamed channel can no longer leave this layer pointing at a name
// nobody answers.

/** Subscribes to a main → renderer event and hands back the function that unsubscribes. */
const subscribe = (channel) => (callback) => {
  const handler = (_event, data) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  msftLogin: () => ipcRenderer.invoke(Channels.AUTH_MSFT_LOGIN),
  authLogin: (code) => ipcRenderer.invoke(Channels.AUTH_LOGIN, code),
  authLogout: (uuid) => ipcRenderer.invoke(Channels.AUTH_LOGOUT, uuid),
  authValidate: () => ipcRenderer.invoke(Channels.AUTH_VALIDATE),
  authGetAccount: () => ipcRenderer.invoke(Channels.AUTH_GET_ACCOUNT),

  // Config
  configGetSettings: () => ipcRenderer.invoke(Channels.CONFIG_GET_SETTINGS),
  configSetJavaExecutable: (path) => ipcRenderer.invoke(Channels.CONFIG_SET_JAVA_EXECUTABLE, path),
  configSetJavaAutoDownload: (val) => ipcRenderer.invoke(Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD, val),
  configSetMaxRam: (mb) => ipcRenderer.invoke(Channels.CONFIG_SET_MAX_RAM, mb),
  configSetUseModpackRam: (val) => ipcRenderer.invoke(Channels.CONFIG_SET_USE_MODPACK_RAM, val),
  configSetGameWidth: (w) => ipcRenderer.invoke(Channels.CONFIG_SET_GAME_WIDTH, w),
  configSetGameHeight: (h) => ipcRenderer.invoke(Channels.CONFIG_SET_GAME_HEIGHT, h),
  configSetFullscreen: (val) => ipcRenderer.invoke(Channels.CONFIG_SET_FULLSCREEN, val),
  configSetDataDirectory: (dir) => ipcRenderer.invoke(Channels.CONFIG_SET_DATA_DIRECTORY, dir),

  // Dialogs
  dialogOpenFile: (options) => ipcRenderer.invoke(Channels.DIALOG_OPEN_FILE, options),
  dialogOpenFolder: (options) => ipcRenderer.invoke(Channels.DIALOG_OPEN_FOLDER, options),

  // Shell
  shellOpenDataDirectory: () => ipcRenderer.invoke(Channels.SHELL_OPEN_DATA_DIRECTORY),
  shellOpenLogsDirectory: () => ipcRenderer.invoke(Channels.SHELL_OPEN_LOGS_DIRECTORY),

  // Distribution
  distroSetServerData: (data) => ipcRenderer.invoke(Channels.DISTRO_SET_SERVER_DATA, data),

  // Launch
  launchGame: () => ipcRenderer.invoke(Channels.LAUNCH_GAME),
  launchKill: () => ipcRenderer.invoke(Channels.LAUNCH_KILL),
  launchGetStatus: () => ipcRenderer.invoke(Channels.LAUNCH_GET_STATUS),
  onLaunchProgress: subscribe(Channels.LAUNCH_PROGRESS),

  // Token expiration event (main -> renderer)
  onTokenExpired: subscribe(Channels.AUTH_TOKEN_EXPIRED),

  // Window controls
  windowMinimize: () => ipcRenderer.send(Channels.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(Channels.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(Channels.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(Channels.WINDOW_IS_MAXIMIZED),
  onWindowMaximizedChanged: subscribe(Channels.WINDOW_MAXIMIZED_CHANGED)
})
