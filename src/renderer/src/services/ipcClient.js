import { ERROR_CODE } from '../../../shared/errorCodes'

/**
 * Wraps a preload method so it speaks Errors again.
 *
 * Every `ipcMain.handle` answers with the envelope built by `main/ipc/result.js`
 * (`{ ok, code, message }`) because a thrown Error loses `error.code` on its way across
 * the boundary and reaches the renderer as a string prefixed with
 * `Error invoking remote method '<channel>'`. Rebuilding the Error here keeps every
 * existing `try/catch` working while giving callers a `code` to branch on.
 */
const invoke = (method) => async (...args) => {
  const result = await window.electronAPI[method](...args)

  if (result?.ok === false) {
    const error = new Error(result.message)
    error.code = result.code || ERROR_CODE.UNKNOWN
    throw error
  }

  return result?.data
}

export const ipc = {
  auth: {
    msftLogin: invoke('msftLogin'),
    login: invoke('authLogin'),
    logout: invoke('authLogout'),
    validate: invoke('authValidate'),
    getAccount: invoke('authGetAccount')
  },
  config: {
    getSettings: invoke('configGetSettings'),
    setJavaExecutable: invoke('configSetJavaExecutable'),
    setJavaAutoDownload: invoke('configSetJavaAutoDownload'),
    setMaxRam: invoke('configSetMaxRam'),
    setUseModpackRam: invoke('configSetUseModpackRam'),
    setGameWidth: invoke('configSetGameWidth'),
    setGameHeight: invoke('configSetGameHeight'),
    setFullscreen: invoke('configSetFullscreen'),
    setDataDirectory: invoke('configSetDataDirectory')
  },
  dialog: {
    openFile: invoke('dialogOpenFile'),
    openFolder: invoke('dialogOpenFolder')
  },
  shell: {
    openPath: invoke('shellOpenPath')
  },
  distro: {
    setServerData: invoke('distroSetServerData')
  },
  launch: {
    game: invoke('launchGame'),
    kill: invoke('launchKill'),
    getStatus: invoke('launchGetStatus'),
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
