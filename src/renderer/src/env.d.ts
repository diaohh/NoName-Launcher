/// <reference types="vite/client" />

/** The launcher version from package.json, inlined by electron.vite.config.mjs. */
declare const __APP_VERSION__: string

interface Window {
  /** The bridge `src/preload` exposes. Only `services/ipcClient` should read it. */
  electronAPI: import('../../shared/ipcContract').ElectronAPI
}
