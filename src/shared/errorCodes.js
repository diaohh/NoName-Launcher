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

  // Microsoft sign-in window. The OAuth ones mirror the `error` Microsoft puts in the
  // redirect; anything it sends that is not listed here arrives as OAUTH_FAILED.
  OAUTH_WINDOW_OPEN: 'OAUTH_WINDOW_OPEN',
  OAUTH_WINDOW_CLOSED: 'OAUTH_WINDOW_CLOSED',
  OAUTH_ACCESS_DENIED: 'OAUTH_ACCESS_DENIED',
  OAUTH_CONSENT_REQUIRED: 'OAUTH_CONSENT_REQUIRED',
  OAUTH_LOGIN_REQUIRED: 'OAUTH_LOGIN_REQUIRED',
  OAUTH_FAILED: 'OAUTH_FAILED',

  // Launch flow
  LAUNCH_NO_SERVER: 'LAUNCH_NO_SERVER',
  LAUNCH_ALREADY_RUNNING: 'LAUNCH_ALREADY_RUNNING',
  MODPACK_MAINTENANCE: 'MODPACK_MAINTENANCE',
  MODPACK_INVALID: 'MODPACK_INVALID',
  UNSUPPORTED_MC_VERSION: 'UNSUPPORTED_MC_VERSION',
  // A Mojang version JSON in the pre-1.13 `minecraftArguments` format.
  UNSUPPORTED_MANIFEST: 'UNSUPPORTED_MANIFEST',
  // The pack manifest: no pointer in Firestore, a `formatVersion` this launcher predates,
  // bytes that do not match the published hash, an HTTP failure, or a malformed body.
  MANIFEST_MISSING: 'MANIFEST_MISSING',
  UNSUPPORTED_MANIFEST_FORMAT: 'UNSUPPORTED_MANIFEST_FORMAT',
  MANIFEST_HASH_MISMATCH: 'MANIFEST_HASH_MISMATCH',
  MANIFEST_DOWNLOAD_FAILED: 'MANIFEST_DOWNLOAD_FAILED',
  MANIFEST_INVALID: 'MANIFEST_INVALID',
  // `common/versions/<id>/<id>.json` is not on disk when the launch command is built.
  VERSION_JSON_MISSING: 'VERSION_JSON_MISSING',
  MC_DOWNLOAD_FAILED: 'MC_DOWNLOAD_FAILED',
  JAVA_UNAVAILABLE: 'JAVA_UNAVAILABLE',
  // The Java chosen by hand in the settings is missing, or is not the major the modpack
  // needs. A manual choice is never replaced behind the player's back, so the launch stops.
  JAVA_MANUAL_INCOMPATIBLE: 'JAVA_MANUAL_INCOMPATIBLE',
  UNSUPPORTED_MODLOADER: 'UNSUPPORTED_MODLOADER',
  MODLOADER_FAILED: 'MODLOADER_FAILED',
  // The JVM could not be started at all: a missing or non-executable java.
  GAME_SPAWN_FAILED: 'GAME_SPAWN_FAILED',

  // Configuration
  CONFIG_INVALID_DATA_DIR: 'CONFIG_INVALID_DATA_DIR',
  CONFIG_GAME_RUNNING: 'CONFIG_GAME_RUNNING',
  CONFIG_SAVE_FAILED: 'CONFIG_SAVE_FAILED',
  CONFIG_INVALID_VALUE: 'CONFIG_INVALID_VALUE',

  // Shell
  SHELL_OPEN_FAILED: 'SHELL_OPEN_FAILED',

  // Logs
  LOGS_EXPORT_FAILED: 'LOGS_EXPORT_FAILED',

  // Skin manager. A rejected token is not among them on purpose: the session is checked
  // through AuthManager first, which answers with the AUTH_ codes above.
  SKIN_PROFILE_FAILED: 'SKIN_PROFILE_FAILED',
  SKIN_SAVE_FAILED: 'SKIN_SAVE_FAILED',
  SKIN_RATE_LIMITED: 'SKIN_RATE_LIMITED',
  SKIN_INVALID_FILE: 'SKIN_INVALID_FILE',
  SKIN_INVALID_VALUE: 'SKIN_INVALID_VALUE',
  SKIN_NOT_FOUND: 'SKIN_NOT_FOUND',
  SKIN_IN_USE: 'SKIN_IN_USE',
  SKIN_VAULT_FAILED: 'SKIN_VAULT_FAILED',

  // Filesystem
  PATH_OUTSIDE_BASE: 'PATH_OUTSIDE_BASE',

  // Network
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',

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
