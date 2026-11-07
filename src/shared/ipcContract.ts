import { Channels, type Channel } from './channels'
import type { ErrorCode } from './errorCodes'
import type { LaunchProgress } from './launchProgress'
import type { Modpack } from './modpack'
import type { SkinEntry, SkinImport, SkinSaveChoice, SkinSaveResult, SkinState } from './skins'

/**
 * What every IPC channel carries, in one place (ADR-0002).
 *
 * A call used to have to exist in four layers — the channel name, the handler in main, the
 * preload bridge and `ipcClient` — and one missing from any of them was dead code nobody
 * noticed. Each layer is now typed against this file, so a channel that one of them lacks, or
 * that takes or returns something else there, does not compile:
 *
 * - every name in `Channels` is declared in exactly one of the three contracts below
 *   (`UndeclaredChannels`);
 * - `main/ipc` registers a handler map typed with `InvokeHandlers`, which requires them all;
 * - the preload builds an `ElectronAPI`, which has a method for every channel
 *   (`UnbridgedChannels`);
 * - `ipcClient` wraps every method of `ElectronAPI` (its own `UnwrappedMethods`).
 *
 * Arguments are what the renderer means to send, not what main may assume: a handler receives
 * them as `unknown` and validates them itself (see Trust Boundaries in AGENTS.md).
 */

// ------------------------------------------------------------------------- data

/** What the renderer may know about an account. Never a token (ADR-0007). */
export interface AccountSummary {
  username: string
  uuid: string
  displayName: string
}

export interface AccountInfo extends AccountSummary {
  type: 'microsoft'
  /** Expiry of the Minecraft token, in ms since the epoch. */
  expiresAt: number
}

/** A failure is not necessarily terminal: only `isTerminalAuthCode(code)` means log out. */
export type AccountValidation =
  | { ok: true }
  | { ok: false, code: ErrorCode, message: string }

/** Sent only when the session is gone for a terminal reason, never for a network failure. */
export interface SessionExpired {
  expired: true
  message: string
}

/** The settings screen. RAM always travels as megabytes, never in the `4G` disk format. */
export interface LauncherSettings {
  /** Only the player's own choice; null means the launcher picks one per modpack. */
  javaExecutable: string | null
  /** What the launcher found or downloaded, by Java major. */
  javaRuntimes: Record<string, string>
  javaAutoDownload: boolean
  gameWidth: number
  gameHeight: number
  fullscreen: boolean
  /** Null when the stored value cannot be read as an amount of memory. */
  minRamMB: number | null
  maxRamMB: number | null
  useModpackRam: boolean
  systemTotalRamMB: number
  maxAllowedRamMB: number
  minAllowedRamMB: number
  ramStepMB: number
  /** The effective directory, which falls back to the default when the stored one is unusable. */
  dataDirectory: string
  defaultDataDirectory: string
}

/** What `config:setMaxRam` actually stored: the floor follows the ceiling down. */
export interface RamAllocation {
  maxRamMB: number | null
  minRamMB: number | null
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenFileOptions {
  title?: string
  filters?: FileFilter[]
}

export interface OpenFolderOptions {
  title?: string
}

export interface LaunchStarted {
  pid: number
}

/** Lets the renderer rebuild its state after a reload. */
export interface LaunchStatus {
  running: boolean
  pid: number | null
}

/** What every invoke handler answers with: an Error does not survive the boundary. */
export type IpcResult<T> =
  | { ok: true, data: T }
  | { ok: false, code: ErrorCode, message: string }

// -------------------------------------------------------------------- contracts

/** Renderer → main with an answer (`ipcRenderer.invoke` / `handle()`). */
export interface InvokeContract {
  [Channels.AUTH_MSFT_LOGIN]: () => string
  [Channels.AUTH_LOGIN]: (authCode: string) => AccountSummary
  [Channels.AUTH_LOGOUT]: (uuid: string) => void
  [Channels.AUTH_VALIDATE]: () => AccountValidation
  [Channels.AUTH_GET_ACCOUNT]: () => AccountInfo | null

  [Channels.CONFIG_GET_SETTINGS]: () => LauncherSettings
  [Channels.CONFIG_SET_JAVA_EXECUTABLE]: (executable: string | null) => void
  [Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD]: (value: boolean) => void
  [Channels.CONFIG_SET_MAX_RAM]: (megabytes: number) => RamAllocation
  [Channels.CONFIG_SET_USE_MODPACK_RAM]: (value: boolean) => void
  [Channels.CONFIG_SET_GAME_WIDTH]: (width: number) => void
  [Channels.CONFIG_SET_GAME_HEIGHT]: (height: number) => void
  [Channels.CONFIG_SET_FULLSCREEN]: (value: boolean) => void
  /** Answers with the effective directory. Null restores the default. */
  [Channels.CONFIG_SET_DATA_DIRECTORY]: (directory: string | null) => string

  /** Null when the player closes the dialog. */
  [Channels.DIALOG_OPEN_FILE]: (options?: OpenFileOptions) => string | null
  [Channels.DIALOG_OPEN_FOLDER]: (options?: OpenFolderOptions) => string | null
  [Channels.SHELL_OPEN_DATA_DIRECTORY]: () => void
  [Channels.SHELL_OPEN_LOGS_DIRECTORY]: () => void

  [Channels.DISTRO_SET_SERVER_DATA]: (modpack: Modpack) => boolean

  [Channels.LAUNCH_GAME]: () => LaunchStarted
  /** False when there was no game to kill. */
  [Channels.LAUNCH_KILL]: () => boolean
  [Channels.LAUNCH_GET_STATUS]: () => LaunchStatus

  /** The path the logs were saved to, or null when the player cancelled. */
  [Channels.LOGS_EXPORT]: (text: string) => string | null

  [Channels.SKINS_GET_STATE]: () => SkinState
  /** The worn skin as a `data:` URL, for the avatar; null with no skin. */
  [Channels.SKINS_GET_ACTIVE_TEXTURE]: () => string | null
  /** Null when the player closes the dialog. */
  [Channels.SKINS_IMPORT]: () => SkinImport | null
  [Channels.SKINS_RENAME]: (id: string, name: string) => SkinEntry
  [Channels.SKINS_DELETE]: (id: string) => void
  [Channels.SKINS_SAVE]: (choice: SkinSaveChoice) => SkinSaveResult

  [Channels.WINDOW_IS_MAXIMIZED]: () => boolean
}

/** Renderer → main, fire and forget (`ipcRenderer.send`). */
export interface SendContract {
  [Channels.WINDOW_MINIMIZE]: () => void
  [Channels.WINDOW_MAXIMIZE]: () => void
  [Channels.WINDOW_CLOSE]: () => void
  /** The player still wants out after `window:closeRequested`. */
  [Channels.WINDOW_CONFIRM_CLOSE]: () => void
}

/** Main → renderer (`webContents.send` / `ipcRenderer.on`): channel → payload. */
export interface EventContract {
  [Channels.LAUNCH_PROGRESS]: LaunchProgress
  [Channels.AUTH_TOKEN_EXPIRED]: SessionExpired
  [Channels.WINDOW_MAXIMIZED_CHANGED]: boolean
  /** A launch is being prepared and the player tried to close: the renderer asks first. */
  [Channels.WINDOW_CLOSE_REQUESTED]: void
}

export type InvokeChannel = keyof InvokeContract
export type SendChannel = keyof SendContract
export type EventChannel = keyof EventContract

export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeContract[C]>
export type InvokeResult<C extends InvokeChannel> = ReturnType<InvokeContract[C]>

/** The arguments `webContents.send` takes after the channel: none for a `void` payload. */
export type EventArgs<C extends EventChannel> = EventContract[C] extends void ? [] : [payload: EventContract[C]]

/** Compiles only when `T` is empty; the error names whatever is left in it. */
export type MustBeEmpty<T extends never> = T

/** A name in `Channels` that no contract declares. */
export type UndeclaredChannels = MustBeEmpty<Exclude<Channel, InvokeChannel | SendChannel | EventChannel>>

// ----------------------------------------------------------------------- bridge

/** The method the preload exposes for each channel, on `window.electronAPI`. */
export interface BridgeMethods {
  msftLogin: typeof Channels.AUTH_MSFT_LOGIN
  authLogin: typeof Channels.AUTH_LOGIN
  authLogout: typeof Channels.AUTH_LOGOUT
  authValidate: typeof Channels.AUTH_VALIDATE
  authGetAccount: typeof Channels.AUTH_GET_ACCOUNT
  onTokenExpired: typeof Channels.AUTH_TOKEN_EXPIRED

  configGetSettings: typeof Channels.CONFIG_GET_SETTINGS
  configSetJavaExecutable: typeof Channels.CONFIG_SET_JAVA_EXECUTABLE
  configSetJavaAutoDownload: typeof Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD
  configSetMaxRam: typeof Channels.CONFIG_SET_MAX_RAM
  configSetUseModpackRam: typeof Channels.CONFIG_SET_USE_MODPACK_RAM
  configSetGameWidth: typeof Channels.CONFIG_SET_GAME_WIDTH
  configSetGameHeight: typeof Channels.CONFIG_SET_GAME_HEIGHT
  configSetFullscreen: typeof Channels.CONFIG_SET_FULLSCREEN
  configSetDataDirectory: typeof Channels.CONFIG_SET_DATA_DIRECTORY

  dialogOpenFile: typeof Channels.DIALOG_OPEN_FILE
  dialogOpenFolder: typeof Channels.DIALOG_OPEN_FOLDER
  shellOpenDataDirectory: typeof Channels.SHELL_OPEN_DATA_DIRECTORY
  shellOpenLogsDirectory: typeof Channels.SHELL_OPEN_LOGS_DIRECTORY

  distroSetServerData: typeof Channels.DISTRO_SET_SERVER_DATA

  launchGame: typeof Channels.LAUNCH_GAME
  launchKill: typeof Channels.LAUNCH_KILL
  launchGetStatus: typeof Channels.LAUNCH_GET_STATUS
  onLaunchProgress: typeof Channels.LAUNCH_PROGRESS

  logsExport: typeof Channels.LOGS_EXPORT

  skinsGetState: typeof Channels.SKINS_GET_STATE
  skinsGetActiveTexture: typeof Channels.SKINS_GET_ACTIVE_TEXTURE
  skinsImport: typeof Channels.SKINS_IMPORT
  skinsRename: typeof Channels.SKINS_RENAME
  skinsDelete: typeof Channels.SKINS_DELETE
  skinsSave: typeof Channels.SKINS_SAVE

  windowMinimize: typeof Channels.WINDOW_MINIMIZE
  windowMaximize: typeof Channels.WINDOW_MAXIMIZE
  windowClose: typeof Channels.WINDOW_CLOSE
  windowIsMaximized: typeof Channels.WINDOW_IS_MAXIMIZED
  onWindowMaximizedChanged: typeof Channels.WINDOW_MAXIMIZED_CHANGED
  onWindowCloseRequested: typeof Channels.WINDOW_CLOSE_REQUESTED
  windowConfirmClose: typeof Channels.WINDOW_CONFIRM_CLOSE
}

export type BridgeMethod = keyof BridgeMethods

/** A channel the preload does not expose. */
export type UnbridgedChannels = MustBeEmpty<Exclude<Channel, BridgeMethods[BridgeMethod]>>

/** Hands back the function that unsubscribes. */
export type Unsubscribe = () => void

type Bridge<C extends Channel> =
  C extends InvokeChannel ? (...args: InvokeArgs<C>) => Promise<IpcResult<InvokeResult<C>>>
    : C extends SendChannel ? () => void
      : C extends EventChannel ? (callback: (payload: EventContract[C]) => void) => Unsubscribe
        : never

/** `window.electronAPI`. Only `services/ipcClient` should read it. */
export type ElectronAPI = { [M in BridgeMethod]: Bridge<BridgeMethods[M]> }

type MethodsOf<C extends Channel> = { [M in BridgeMethod]: BridgeMethods[M] extends C ? M : never }[BridgeMethod]

export type InvokeMethod = MethodsOf<InvokeChannel>
export type SendMethod = MethodsOf<SendChannel>
export type EventMethod = MethodsOf<EventChannel>
