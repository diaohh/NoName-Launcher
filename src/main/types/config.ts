/**
 * `config.json`, as `ConfigManager` holds it in memory. The file on disk carries a
 * `version` stamp (`CONFIG_VERSION` in ConfigManager) and is migrated and repaired on load by
 * `ConfigManager.validateConfig`, key by key against the defaults.
 */

export interface GameSettings {
    resWidth: number
    resHeight: number
    fullscreen: boolean
}

export interface JavaSettings {
    /** In the JVM's format (`2G`, `4096M`); `ConfigManager.parseRamToMB` reads it. */
    minRAM: string
    maxRAM: string
    /** The Java the player picked by hand, and nothing else. Null: the launcher picks. */
    executable: string | null
    /**
     * Java major (`"17"`) → executable the launcher found or downloaded. Only the map itself is
     * validated on load; each entry is checked when it is read (`getJavaRuntime`).
     */
    runtimes: Record<string, unknown>
    autoDownload: boolean
    useModpackRam: boolean
}

export interface LauncherDirectorySettings {
    /** Null means "wherever the launcher lives" (ADR-0004). */
    dataDirectory: string | null
}

export interface Settings {
    game: GameSettings
    java: JavaSettings
    launcher: LauncherDirectorySettings
}

/** `microsoft.expires_at` is the MS **access** token's expiry (~1 h), not the session's. */
export interface MicrosoftTokens {
    access_token: string
    refresh_token: string
    expires_at: number
}

/** A signed-in account, secrets included. Only ever in memory in this shape (ADR-0007). */
export interface Account {
    type: 'microsoft'
    accessToken: string
    username: string
    uuid: string
    displayName: string
    /** Expiry of the Minecraft token, in ms since the epoch. */
    expiresAt: number
    microsoft: MicrosoftTokens
}

/** An account as `config.json` stores it: the three secrets folded into one encrypted blob. */
export interface DiskAccount extends Omit<Account, 'accessToken' | 'microsoft'> {
    microsoft: Omit<MicrosoftTokens, 'access_token' | 'refresh_token'>
    /** base64 of what `safeStorage` encrypted. */
    secrets: string
}

export interface LauncherConfig {
    version: number
    settings: Settings
    selectedAccount: string | null
    selectedServer: string | null
    authenticationDatabase: Record<string, Account>
}

/** What is written out: every account encrypted, or left off disk. */
export interface DiskConfig extends Omit<LauncherConfig, 'authenticationDatabase'> {
    authenticationDatabase: Record<string, DiskAccount>
}
