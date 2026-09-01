/**
 * Error codes shared by the main process and the renderer.
 *
 * They travel across IPC inside the `{ ok, code, message }` envelope built by
 * `main/ipc/result.js` and are turned back into a real Error by `services/ipcClient.js`.
 * Both ends must read them from here: a renderer comparing against its own copy of a
 * literal silently stops matching the day the main process renames one — which is
 * exactly the failure mode the substring matching in PlayButton used to have.
 */
export const ERROR_CODE = {
  // Authentication
  AUTH_NO_ACCOUNT: 'AUTH_NO_ACCOUNT',
  AUTH_NETWORK: 'AUTH_NETWORK',
  AUTH_INVALID_GRANT: 'AUTH_INVALID_GRANT',
  AUTH_NO_PROFILE: 'AUTH_NO_PROFILE',
  AUTH_NO_XBOX_ACCOUNT: 'AUTH_NO_XBOX_ACCOUNT',
  AUTH_XBL_BANNED: 'AUTH_XBL_BANNED',
  AUTH_UNDER_18: 'AUTH_UNDER_18',
  AUTH_UNKNOWN: 'AUTH_UNKNOWN',

  // Launch flow
  LAUNCH_NO_SERVER: 'LAUNCH_NO_SERVER',
  LAUNCH_ALREADY_RUNNING: 'LAUNCH_ALREADY_RUNNING',
  MODPACK_MAINTENANCE: 'MODPACK_MAINTENANCE',
  UNSUPPORTED_MC_VERSION: 'UNSUPPORTED_MC_VERSION',
  UNSUPPORTED_MANIFEST: 'UNSUPPORTED_MANIFEST',
  MANIFEST_INVALID: 'MANIFEST_INVALID',
  MC_DOWNLOAD_FAILED: 'MC_DOWNLOAD_FAILED',
  JAVA_UNAVAILABLE: 'JAVA_UNAVAILABLE',
  UNSUPPORTED_MODLOADER: 'UNSUPPORTED_MODLOADER',
  MODLOADER_FAILED: 'MODLOADER_FAILED',

  // Configuration
  CONFIG_INVALID_DATA_DIR: 'CONFIG_INVALID_DATA_DIR',
  CONFIG_GAME_RUNNING: 'CONFIG_GAME_RUNNING',

  UNKNOWN: 'UNKNOWN'
}

/**
 * Codes that mean the stored credentials are dead and cannot be revived by retrying.
 * Only these justify deleting the account or bouncing the player to the login screen;
 * everything else — no network, a 5xx, an error nobody recognises — keeps the session.
 */
export const TERMINAL_AUTH_CODES = [
  ERROR_CODE.AUTH_NO_ACCOUNT,
  ERROR_CODE.AUTH_INVALID_GRANT,
  ERROR_CODE.AUTH_NO_PROFILE,
  ERROR_CODE.AUTH_NO_XBOX_ACCOUNT,
  ERROR_CODE.AUTH_XBL_BANNED,
  ERROR_CODE.AUTH_UNDER_18
]

export function isTerminalAuthCode(code) {
  return TERMINAL_AUTH_CODES.includes(code)
}
