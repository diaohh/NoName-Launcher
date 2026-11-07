import { LauncherError } from '../../../shared/LauncherError'
import type {
  BridgeMethod,
  ElectronAPI,
  EventMethod,
  InvokeMethod,
  IpcResult,
  MustBeEmpty,
  SendMethod
} from '../../../shared/ipcContract'

/**
 * The renderer's only way into main. Components call `ipc.<area>.<action>`, never
 * `window.electronAPI` directly.
 *
 * Every `ipcMain.handle` answers with the envelope built by `main/ipc/result`
 * (`{ ok, code, message }`) because a thrown Error loses `error.code` on its way across
 * the boundary and reaches the renderer as a string prefixed with
 * `Error invoking remote method '<channel>'`. Rebuilding a `LauncherError` here keeps every
 * existing `try/catch` working while giving callers a `code` to branch on.
 */

/**
 * Tags a wrapper with the preload method it calls. Types only — nothing reads it at runtime —
 * so `UnwrappedMethods` below can tell which methods `ipc` reaches.
 */
declare const bridgeMethod: unique symbol
type Bridged<M extends BridgeMethod, F> = F & { readonly [bridgeMethod]: M }

type DataOf<R> = R extends { ok: true, data: infer T } ? T : never
type InvokeData<M extends InvokeMethod> = DataOf<Awaited<ReturnType<ElectronAPI[M]>>>

const invoke = <M extends InvokeMethod>(method: M) => {
  const call = async (...args: Parameters<ElectronAPI[M]>): Promise<InvokeData<M>> => {
    // One method of a union of signatures: TypeScript cannot narrow it by `M`, the map can.
    const bridge = window.electronAPI[method] as (...args: Parameters<ElectronAPI[M]>) => Promise<IpcResult<InvokeData<M>>>
    const result = await bridge(...args)

    if (!result.ok) throw new LauncherError(result.code, result.message)
    return result.data
  }
  return call as Bridged<M, typeof call>
}

const send = <M extends SendMethod>(method: M) => {
  const call = () => (window.electronAPI[method] as () => void)()
  return call as Bridged<M, typeof call>
}

const subscribe = <M extends EventMethod>(method: M) => {
  type Subscriber = (callback: Parameters<ElectronAPI[M]>[0]) => () => void
  const call: Subscriber = (callback) => (window.electronAPI[method] as Subscriber)(callback)
  return call as Bridged<M, Subscriber>
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
    openDataDirectory: invoke('shellOpenDataDirectory'),
    openLogsDirectory: invoke('shellOpenLogsDirectory')
  },
  distro: {
    setServerData: invoke('distroSetServerData')
  },
  launch: {
    game: invoke('launchGame'),
    kill: invoke('launchKill'),
    getStatus: invoke('launchGetStatus'),
    onProgress: subscribe('onLaunchProgress')
  },
  logs: {
    export: invoke('logsExport')
  },
  skins: {
    getState: invoke('skinsGetState'),
    getActiveTexture: invoke('skinsGetActiveTexture'),
    import: invoke('skinsImport'),
    rename: invoke('skinsRename'),
    delete: invoke('skinsDelete'),
    save: invoke('skinsSave')
  },
  events: {
    onTokenExpired: subscribe('onTokenExpired')
  },
  window: {
    minimize: send('windowMinimize'),
    maximize: send('windowMaximize'),
    close: send('windowClose'),
    isMaximized: invoke('windowIsMaximized'),
    onMaximizedChanged: subscribe('onWindowMaximizedChanged'),
    onCloseRequested: subscribe('onWindowCloseRequested'),
    confirmClose: send('windowConfirmClose')
  }
}

type MethodsIn<T> = T extends { readonly [bridgeMethod]: infer M }
  ? M
  : T extends object ? { [K in keyof T]: MethodsIn<T[K]> }[keyof T] : never

/**
 * A preload method `ipc` does not wrap: dead, since nothing else in the renderer may reach
 * `window.electronAPI`.
 */
export type UnwrappedMethods = MustBeEmpty<Exclude<BridgeMethod, MethodsIn<typeof ipc>>>
