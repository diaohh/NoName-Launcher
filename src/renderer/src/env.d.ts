/// <reference types="vite/client" />

/** The launcher version from package.json, inlined by electron.vite.config.mjs. */
declare const __APP_VERSION__: string

/** The Firebase project, inlined from `.env` at build time (the `VITE_` prefix). */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
}

interface Window {
  /** The bridge `src/preload` exposes. Only `services/ipcClient` should read it. */
  electronAPI: import('../../shared/ipcContract').ElectronAPI
}
