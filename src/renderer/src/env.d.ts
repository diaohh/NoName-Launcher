/// <reference types="vite/client" />

/** The launcher version from package.json, inlined by electron.vite.config.mjs. */
declare const __APP_VERSION__: string

interface Window {
  /**
   * The bridge `src/preload` exposes. Loosely typed until the IPC contract map exists
   * (TODO-Migracion.md, Fase 4); only `services/ipcClient` should read it.
   */
  electronAPI: Record<string, (...args: unknown[]) => unknown>
}
