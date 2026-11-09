import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels } from '../shared/channels'
import type {
  ElectronAPI,
  EventChannel,
  EventContract,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcResult,
  SendChannel,
  Unsubscribe
} from '../shared/ipcContract'

// The channel names come from the same module the handlers register with. electron-vite
// bundles the preload — still emitted as CJS, which the sandbox requires — so importing it
// costs nothing, and a renamed channel can no longer leave this layer pointing at a name
// nobody answers. `ElectronAPI` requires a method for every channel of the contract.

const invoke = <C extends InvokeChannel>(channel: C) =>
  (...args: InvokeArgs<C>) => ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<InvokeResult<C>>>

const send = (channel: SendChannel) => () => ipcRenderer.send(channel)

/** Subscribes to a main → renderer event and hands back the function that unsubscribes. */
const subscribe = <C extends EventChannel>(channel: C) => (callback: (payload: EventContract[C]) => void): Unsubscribe => {
  const handler = (_event: IpcRendererEvent, payload: EventContract[C]) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ElectronAPI = {
  // Auth
  msftLogin: invoke(Channels.AUTH_MSFT_LOGIN),
  authLogin: invoke(Channels.AUTH_LOGIN),
  authLogout: invoke(Channels.AUTH_LOGOUT),
  authValidate: invoke(Channels.AUTH_VALIDATE),
  authGetAccount: invoke(Channels.AUTH_GET_ACCOUNT),
  // Token expiration event (main -> renderer)
  onTokenExpired: subscribe(Channels.AUTH_TOKEN_EXPIRED),

  // Config
  configGetSettings: invoke(Channels.CONFIG_GET_SETTINGS),
  configSetJavaExecutable: invoke(Channels.CONFIG_SET_JAVA_EXECUTABLE),
  configSetJavaAutoDownload: invoke(Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD),
  configSetMaxRam: invoke(Channels.CONFIG_SET_MAX_RAM),
  configSetUseModpackRam: invoke(Channels.CONFIG_SET_USE_MODPACK_RAM),
  configSetGameWidth: invoke(Channels.CONFIG_SET_GAME_WIDTH),
  configSetGameHeight: invoke(Channels.CONFIG_SET_GAME_HEIGHT),
  configSetFullscreen: invoke(Channels.CONFIG_SET_FULLSCREEN),
  configSetDataDirectory: invoke(Channels.CONFIG_SET_DATA_DIRECTORY),

  // Dialogs
  dialogOpenFile: invoke(Channels.DIALOG_OPEN_FILE),
  dialogOpenFolder: invoke(Channels.DIALOG_OPEN_FOLDER),

  // Shell
  shellOpenDataDirectory: invoke(Channels.SHELL_OPEN_DATA_DIRECTORY),
  shellOpenLogsDirectory: invoke(Channels.SHELL_OPEN_LOGS_DIRECTORY),

  // Distribution
  distroSetServerData: invoke(Channels.DISTRO_SET_SERVER_DATA),

  // Launch
  launchGame: invoke(Channels.LAUNCH_GAME),
  launchKill: invoke(Channels.LAUNCH_KILL),
  launchGetStatus: invoke(Channels.LAUNCH_GET_STATUS),
  onLaunchProgress: subscribe(Channels.LAUNCH_PROGRESS),

  // Logs
  logsExport: invoke(Channels.LOGS_EXPORT),

  // Skins
  skinsGetState: invoke(Channels.SKINS_GET_STATE),
  skinsGetActiveTexture: invoke(Channels.SKINS_GET_ACTIVE_TEXTURE),
  skinsImport: invoke(Channels.SKINS_IMPORT),
  skinsRename: invoke(Channels.SKINS_RENAME),
  skinsDelete: invoke(Channels.SKINS_DELETE),
  skinsSave: invoke(Channels.SKINS_SAVE),

  // Window controls
  windowMinimize: send(Channels.WINDOW_MINIMIZE),
  windowMaximize: send(Channels.WINDOW_MAXIMIZE),
  windowClose: send(Channels.WINDOW_CLOSE),
  windowIsMaximized: invoke(Channels.WINDOW_IS_MAXIMIZED),
  onWindowMaximizedChanged: subscribe(Channels.WINDOW_MAXIMIZED_CHANGED),
  onWindowCloseRequested: subscribe(Channels.WINDOW_CLOSE_REQUESTED),
  windowConfirmClose: send(Channels.WINDOW_CONFIRM_CLOSE)
}

contextBridge.exposeInMainWorld('electronAPI', api)
