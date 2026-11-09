import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { safeStorage } from 'electron'
import Logger from '../utils/Logger'
import { resolveInside } from '../utils/PathUtils'
import { writeFileAtomicSync } from '../utils/FileUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import type { Account, DiskAccount, DiskConfig, LauncherConfig, MicrosoftTokens } from '../types/config'

const logger = Logger.getLogger('ConfigManager')

/**
 * Stamped into config.json so the file can be migrated between launcher releases.
 * A file without the field predates the stamp and is treated as version 0.
 *
 * - 1: account secrets encrypted with safeStorage.
 * - 2: `java.executable` holds only the player's own choice; auto-detected runtimes moved
 *   to `java.runtimes`. See `migrateJavaSelection`.
 */
const CONFIG_VERSION = 2

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value)

/** Whether a stored value can stand in for its default. See `validateConfig`. */
function hasExpectedType(actual: unknown, expected: unknown): boolean {
    if (expected === null) return actual === null || typeof actual === 'string'
    if (typeof expected === 'number') return typeof actual === 'number' && Number.isFinite(actual)
    return typeof actual === typeof expected
}

/** What `decryptAccount` reads back out of the encrypted blob. */
interface AccountSecrets {
    accessToken: string
    access_token: string
    refresh_token: string
}

class ConfigManager {
    /** The defaults until `load()` replaces them with the file's. */
    static config: LauncherConfig = ConfigManager.getDefaultConfig()
    static configPath: string | null = null
    static launcherDir: string | null = null
    static dataDir: string | null = null

    /** The tail of the save queue; it never rejects. See `save`. */
    static pendingSave: Promise<void> = Promise.resolve()

    /**
     * The launcher's own root, and the one thing the player cannot move.
     *
     * `config.json` lives here, and `load()` needs the path before there is any
     * configuration to read a preference from — so this must never depend on a setting.
     * Everything bulky (see `getDataDirectory`) hangs off the data directory instead.
     */
    static getLauncherDirectory(): string {
        if (this.launcherDir) {
            return this.launcherDir
        }

        const appDataPath = process.env.APPDATA ||
            (process.platform === 'darwin' ?
                path.join(os.homedir(), 'Library', 'Application Support') :
                path.join(os.homedir(), '.local', 'share'))

        const launcherDir = path.join(appDataPath, '.nonamelauncher')
        this.launcherDir = launcherDir

        if (!fs.existsSync(launcherDir)) {
            fs.mkdirSync(launcherDir, { recursive: true })
        }

        return launcherDir
    }

    /**
     * `<launcherDir>/logs`. Next to the config rather than under the data directory: the
     * logs describe the launcher, and they have to be found in the same place even when the
     * data directory is the thing that broke.
     */
    static getLogsDirectory(): string {
        return path.join(this.getLauncherDirectory(), 'logs')
    }

    /**
     * `<launcherDir>/skins`, the skin vault. Next to the config rather than under the data
     * directory: the skins are the player's own files, not a cache the launcher can download
     * again, and moving the data directory must not leave them behind. See ADR-0014.
     */
    static getSkinsDirectory(): string {
        return path.join(this.getLauncherDirectory(), 'skins')
    }

    /**
     * Records the game the launcher started, so a launcher opened while that game is still
     * running (it outlives the launcher, see LaunchManager) does not start a second one on top.
     * Next to the config for the same reason as the logs: it describes the launcher, not the
     * data, and a data directory change must not lose track of it.
     */
    static getRunningGamePath(): string {
        return path.join(this.getLauncherDirectory(), 'running-game.json')
    }

    /**
     * Where the game data goes: `common/`, `instances/`, the manifest cache and the JVMs
     * the launcher downloads. This is what the "Directorio de datos" setting governs.
     *
     * A stored path that cannot be used right now — an external drive that is unplugged,
     * a folder that lost its permissions — falls back to the launcher directory with a
     * warning and **does not** rewrite the config: the drive may well be back next time.
     */
    static getDataDirectory(): string {
        if (this.dataDir) {
            return this.dataDir
        }

        const configured = this.config.settings.launcher.dataDirectory

        if (configured && !this.isUsableDataDirectory(configured)) {
            logger.warn(`The configured data directory is unusable, falling back to the default: ${configured}`)
        } else if (configured) {
            this.dataDir = configured
            return configured
        }

        const fallback = this.getLauncherDirectory()
        this.dataDir = fallback
        return fallback
    }

    /** True when the directory exists (or can be created) and can be written to. */
    static isUsableDataDirectory(directory: string): boolean {
        try {
            fs.ensureDirSync(directory)
            fs.accessSync(directory, fs.constants.W_OK)
            return true
        } catch (err) {
            logger.warn(`Data directory rejected (${directory})`, err)
            return false
        }
    }

    static getInstanceDirectory(): string {
        return path.join(this.getDataDirectory(), 'instances')
    }

    static getCommonDirectory(): string {
        return path.join(this.getDataDirectory(), 'common')
    }

    /**
     * `common/versions/<id>`. The id comes from the manifest or from a downloaded version
     * JSON (`inheritsFrom`), so it is resolved inside the versions directory rather than
     * trusted to be a single path segment.
     */
    static getVersionDirectory(versionId: string): string {
        return resolveInside(path.join(this.getCommonDirectory(), 'versions'), versionId)
    }

    static getVersionJsonPath(versionId: string): string {
        return path.join(this.getVersionDirectory(versionId), `${versionId}.json`)
    }

    static getDefaultConfig(): LauncherConfig {
        return {
            version: CONFIG_VERSION,
            settings: {
                game: {
                    resWidth: 1280,
                    resHeight: 720,
                    fullscreen: true
                },
                java: {
                    minRAM: '2G',
                    maxRAM: '4G',
                    // The Java the player picked by hand, and nothing else. null means the
                    // launcher chooses, per modpack, from `runtimes`.
                    executable: null,
                    // Java major ("17", "21") -> executable the launcher found or downloaded
                    // for it. A cache, rebuilt by discovery whenever an entry stops validating.
                    runtimes: {},
                    autoDownload: true,
                    // Modpacks ship a RAM allocation tuned for their own mod list, so it
                    // wins by default; the settings slider only takes over when this is off.
                    useModpackRam: true
                },
                launcher: {
                    // null means "wherever the launcher lives". Storing the absolute path
                    // would bake today's %APPDATA% into the file and make "is this still
                    // the default?" a string comparison instead of a fact.
                    dataDirectory: null
                }
            },
            selectedAccount: null,
            selectedServer: null,
            authenticationDatabase: {}
        }
    }

    /**
     * Reads `config.json`, migrating and repairing it, and decrypts the stored session.
     * Asynchronous because `safeStorage` only decrypts asynchronously since Electron 45.
     */
    static async load(): Promise<LauncherConfig> {
        const configPath = path.join(this.getLauncherDirectory(), 'config.json')
        this.configPath = configPath

        if (!fs.existsSync(configPath)) {
            logger.info('Config file not found, creating default...')
            this.config = this.getDefaultConfig()
            await this.saveAfterLoad()
            return this.config
        }

        let parsed: Record<string, unknown>
        try {
            const raw: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
            // `null`, an array or a bare string parse fine and are still not a config.
            if (!isPlainObject(raw)) throw new Error('config.json does not hold an object')
            parsed = raw
        } catch (err) {
            this.quarantineConfig(configPath, err)
            this.config = this.getDefaultConfig()
            await this.saveAfterLoad()
            return this.config
        }

        // Read before validateConfig, which merges the defaults in and would stamp the
        // current version onto a file that never had one.
        const diskVersion = typeof parsed.version === 'number' ? parsed.version : 0

        this.config = this.validateConfig(parsed)
        this.config.version = CONFIG_VERSION

        if (diskVersion < 2) this.migrateJavaSelection()

        const rewriteNeeded = await this.hydrateSecrets()

        if (diskVersion !== CONFIG_VERSION) {
            logger.info(`Migrating config from version ${diskVersion} to ${CONFIG_VERSION}`)
        }

        if (diskVersion !== CONFIG_VERSION || rewriteNeeded) {
            await this.saveAfterLoad()
        }

        logger.info('Configuration loaded successfully')
        return this.config
    }

    /**
     * Before v2 `java.executable` was written both by the settings screen and by every launch
     * that found or downloaded a JVM, so a stored path cannot tell a choice from a leftover.
     * Keeping it as a manual choice would pin most players to whatever Java their first
     * modpack needed, and every modpack on another major would then refuse to start. It is
     * dropped instead: discovery finds the same runtime again on the next launch, and the few
     * players who did pick one by hand pick it again.
     */
    static migrateJavaSelection(): void {
        const java = this.config.settings.java
        if (java.executable) {
            logger.info(`Config v2: forgetting the stored Java (${java.executable}), the launcher will pick one per modpack`)
            java.executable = null
        }
    }

    /**
     * Brings the stored credentials back into memory.
     *
     * A v0 file holds them in the clear; they get encrypted by the save this asks for.
     * Anything that cannot be decrypted — keyring reset, a different OS user,
     * safeStorage gone — costs the session and nothing else: the Java settings, the
     * data directory and the selected modpack all survive.
     *
     * @returns true when the file on disk needs to be rewritten: a v0 account, a dropped
     * one, or a blob safeStorage asks to re-encrypt because its key was rotated.
     */
    static async hydrateSecrets(): Promise<boolean> {
        // Straight from the file: `validateConfig` only checked that this is an object, so each
        // entry is checked here before it is trusted as an account.
        const database = this.config.authenticationDatabase as Record<string, unknown>
        let rewriteNeeded = false

        for (const [uuid, account] of Object.entries(database)) {
            // Only possible in a hand-edited file. Dropping the entry costs that account's
            // session and nothing else, which is the same deal as an undecryptable one.
            if (!isPlainObject(account)) {
                logger.warn(`Dropping a malformed account entry (${uuid})`)
                delete database[uuid]
                if (this.config.selectedAccount === uuid) this.config.selectedAccount = null
                rewriteNeeded = true
                continue
            }

            if (account.secrets == null) {
                // A v0 account: plaintext on disk, encrypted by the next save.
                rewriteNeeded = true
                continue
            }

            try {
                // Only the object and its `secrets` were checked. The rest is the launcher's own
                // file, and a `secrets` that is not a valid blob fails to decrypt: the catch below.
                const { decrypted, shouldReEncrypt } = await this.decryptAccount(account as unknown as DiskAccount)
                database[uuid] = decrypted
                if (shouldReEncrypt) rewriteNeeded = true
            } catch (err) {
                logger.error(`Could not decrypt the credentials of ${uuid}`, err)
                this.purgeSession(`the credentials of ${uuid} are unreadable`)
                return true
            }
        }

        return rewriteNeeded
    }

    /**
     * Drops every credential while leaving the rest of the config untouched. The player
     * lands back on the login screen; nothing else they configured is lost.
     */
    static purgeSession(reason: string): void {
        logger.warn(`Purging the stored session: ${reason}`)
        this.config.authenticationDatabase = {}
        this.config.selectedAccount = null
    }

    /**
     * Electron 45 deprecated the synchronous safeStorage methods and 46 removes them. Blobs
     * written by `encryptString` decrypt with `decryptStringAsync`, so the move needed no
     * config migration (ADR-0007).
     */
    static async isEncryptionAvailable(): Promise<boolean> {
        try {
            return await safeStorage.isAsyncEncryptionAvailable()
        } catch (err) {
            logger.error('safeStorage is not usable', err)
            return false
        }
    }

    /**
     * Replaces the three secrets with a single encrypted blob. Everything else —
     * username, uuid, expiries — stays readable, so config.json remains inspectable and
     * a decryption failure costs the session rather than the settings.
     */
    static async encryptAccount(account: Account): Promise<DiskAccount> {
        const { accessToken, microsoft, ...rest } = account
        const { access_token, refresh_token, ...microsoftRest }: Partial<MicrosoftTokens> = microsoft ?? {}
        const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ accessToken, access_token, refresh_token }))

        return {
            ...rest,
            microsoft: microsoftRest as DiskAccount['microsoft'],
            secrets: encrypted.toString('base64')
        }
    }

    /**
     * @returns the account with its secrets back in place, and whether safeStorage asks for
     * the blob to be re-encrypted (its key was rotated or a better one became available).
     */
    static async decryptAccount(account: DiskAccount): Promise<{ decrypted: Account, shouldReEncrypt: boolean }> {
        const { secrets, ...rest } = account
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(secrets, 'base64'))
        // Written by `encryptAccount` and authenticated by the keyring: the launcher's own data.
        const payload = JSON.parse(result) as AccountSecrets

        return {
            shouldReEncrypt: Boolean(shouldReEncrypt),
            decrypted: {
                ...rest,
                accessToken: payload.accessToken,
                microsoft: {
                    ...rest.microsoft,
                    access_token: payload.access_token,
                    refresh_token: payload.refresh_token
                }
            }
        }
    }

    /**
     * Moves an unreadable config aside instead of overwriting it.
     *
     * The account database and every setting live in this one file, so a parse error
     * must never be the reason a player loses them irrecoverably. The launcher starts
     * on the defaults, but the original stays on disk right next to it.
     */
    static quarantineConfig(configPath: string, err: unknown): void {
        const backupPath = `${configPath}.corrupt-${Date.now()}`
        try {
            fs.moveSync(configPath, backupPath)
            logger.error(`Config unreadable, moved aside to ${backupPath}`, err)
        } catch (moveErr) {
            logger.error('Config unreadable and could not be moved aside', moveErr)
        }
    }

    /**
     * Writes the config atomically and throws when it cannot.
     *
     * The data goes to a temporary file that is flushed to disk and then renamed over
     * `config.json`, so a crash or a power cut leaves either the old file or the new one —
     * never a truncated one that the next start would have to quarantine, taking the session
     * and every setting with it.
     *
     * A failure is thrown (`CONFIG_SAVE_FAILED`) rather than logged: a settings screen that
     * shows a value the disk never received is lying to the player.
     *
     * Saves run one at a time, in the order they were asked for. Encryption is asynchronous,
     * so two overlapping saves could otherwise finish out of order and leave the older config
     * on disk. Each one waits for the previous save and encodes the config as it is when its
     * turn comes, so the last write always carries the newest state. A failed save rejects
     * for its own caller and does not stop the ones queued behind it.
     */
    static save(): Promise<void> {
        const run = this.pendingSave.then(() => this.writeConfig())
        this.pendingSave = run.catch(() => {})
        return run
    }

    static async writeConfig(): Promise<void> {
        const data = JSON.stringify(await this.toDiskConfig(), null, 4)

        try {
            if (this.configPath == null) throw new Error('config.json written before load()')
            writeFileAtomicSync(this.configPath, data)
        } catch (err) {
            logger.error('Failed to save config', err)
            throw new LauncherError(
                ERROR_CODE.CONFIG_SAVE_FAILED,
                'No se ha podido guardar la configuracion. Comprueba que hay espacio en disco y permiso de escritura.',
                err
            )
        }

        logger.info('Configuration saved successfully')
    }

    /**
     * `load()` rewrites the file after a migration or a reset, but the launcher must still
     * open when that write fails — a read-only disk is reported by the next explicit save.
     */
    static async saveAfterLoad(): Promise<void> {
        try {
            await this.save()
        } catch {
            // Already logged by save().
        }
    }

    /**
     * The config as it should be written out, with every credential encrypted.
     *
     * Encryption is unavailable on, say, a Linux box with no keyring. Falling back to
     * plaintext there would quietly undo the whole point, so the session simply is not
     * persisted: it stays in memory for this run and the player logs in again next
     * start.
     */
    static async toDiskConfig(): Promise<DiskConfig> {
        const config: DiskConfig = { ...this.config, authenticationDatabase: {} }

        if (!(await this.isEncryptionAvailable())) {
            if (Object.keys(this.config.authenticationDatabase).length > 0) {
                logger.warn('safeStorage is unavailable, the session will not be persisted')
            }
            config.selectedAccount = null
            return config
        }

        for (const [uuid, account] of Object.entries(this.config.authenticationDatabase)) {
            try {
                config.authenticationDatabase[uuid] = await this.encryptAccount(account)
            } catch (err) {
                logger.error(`Failed to encrypt the credentials of ${uuid}, leaving them off disk`, err)
                if (config.selectedAccount === uuid) config.selectedAccount = null
            }
        }

        return config
    }

    /**
     * Merges the defaults into a parsed config and repairs every value of the wrong type.
     *
     * The file is hand-editable and survives across releases, so valid JSON is not the same as
     * a usable config: `"settings": "x"` used to make the merge itself throw, and a string
     * where a number belongs reached the launch command. Each key is checked against the type
     * of its default. A `null` default means "a string or nothing" (paths, selected ids). A
     * mismatch falls back to the default for that key alone, never for the whole file.
     */
    static validateConfig(config: Record<string, unknown>): LauncherConfig {
        // Walked key by key next to what arrived; an interface has no index signature to do it with.
        const defaults = this.getDefaultConfig() as unknown as Record<string, unknown>

        const merge = (target: Record<string, unknown>, source: Record<string, unknown>, parentKey: string) => {
            for (const key in source) {
                const expected = source[key]
                const actual = target[key]
                const keyPath = parentKey ? `${parentKey}.${key}` : key

                if (isPlainObject(expected)) {
                    if (!isPlainObject(actual)) {
                        if (actual !== undefined) logger.warn(`Config: "${keyPath}" is not an object, resetting it`)
                        target[key] = {}
                    }
                    merge(target[key] as Record<string, unknown>, expected, keyPath)
                } else if (actual === undefined) {
                    target[key] = expected
                } else if (!hasExpectedType(actual, expected)) {
                    logger.warn(`Config: "${keyPath}" has an invalid value, resetting it to the default`)
                    target[key] = expected
                }
            }
            return target
        }

        // Every key of the defaults is now present with the default's type, which is what the
        // type promises. The accounts are not: `hydrateSecrets` checks those.
        return merge(config, defaults, '') as unknown as LauncherConfig
    }

    static getConfig(): LauncherConfig { return this.config }
    static getGameWidth(): number { return this.config.settings.game.resWidth }
    static getGameHeight(): number { return this.config.settings.game.resHeight }
    static getFullscreen(): boolean { return this.config.settings.game.fullscreen }
    static getMinRAM(): string { return this.config.settings.java.minRAM }
    static getMaxRAM(): string { return this.config.settings.java.maxRAM }
    static getJavaExecutable(): string | null { return this.config.settings.java.executable }
    static getJavaAutoDownload(): boolean { return this.config.settings.java.autoDownload }
    static getUseModpackRam(): boolean { return this.config.settings.java.useModpackRam }
    static getMinRAMMb(): number | null { return this.parseRamToMB(this.getMinRAM()) }
    static getMaxRAMMb(): number | null { return this.parseRamToMB(this.getMaxRAM()) }
    static getSelectedServer(): string | null { return this.config.selectedServer }
    static getSelectedAccount(): string | null { return this.config.selectedAccount }
    static getAuthenticationDatabase(): Record<string, Account> { return this.config.authenticationDatabase }

    static getAccountByUUID(uuid: string): Account | null {
        return this.config.authenticationDatabase[uuid] || null
    }

    static setGameWidth(width: number): void { this.config.settings.game.resWidth = width }
    static setGameHeight(height: number): void { this.config.settings.game.resHeight = height }
    static setFullscreen(fullscreen: boolean): void { this.config.settings.game.fullscreen = fullscreen }
    static setMinRAM(ram: string): void { this.config.settings.java.minRAM = ram }
    static setUseModpackRam(value: boolean): void { this.config.settings.java.useModpackRam = !!value }

    /**
     * The JVM aborts before printing anything useful when `-Xms` sits above `-Xmx`, and the
     * defaults are 2G/4G — so dragging the settings slider down past the minimum would build
     * a launch command that simply dies. The floor follows the ceiling down.
     */
    static setMaxRAM(ram: string): void {
        this.config.settings.java.maxRAM = ram

        const maxMb = this.parseRamToMB(ram)
        const minMb = this.parseRamToMB(this.config.settings.java.minRAM)

        if (maxMb != null && minMb != null && minMb > maxMb) {
            logger.info(`Clamping minRAM to ${maxMb}M so it does not exceed maxRAM`)
            this.config.settings.java.minRAM = this.formatRamFromMB(maxMb)
        }
    }

    /**
     * Megabytes are the single internal unit for RAM: the JVM accepts `-Xmx4096M` exactly as
     * it accepts `-Xmx4G`, so only the stored format has to be read back. Returns null for
     * anything unparseable rather than guessing a number.
     */
    static parseRamToMB(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
        if (typeof value !== 'string') return null

        const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([GMK])?B?$/i)
        if (!match || match[1] === undefined) return null

        const unit = (match[2] || 'M').toUpperCase()
        const multiplier = unit === 'G' ? 1024 : unit === 'K' ? 1 / 1024 : 1

        return Math.round(parseFloat(match[1]) * multiplier)
    }

    static formatRamFromMB(megabytes: number): string {
        return `${Math.round(megabytes)}M`
    }
    static setJavaExecutable(executable: string | null): void { this.config.settings.java.executable = executable }

    /**
     * The runtime cached for a Java major, or null. The map is hand-editable like the rest of
     * the file and `validateConfig` only checks that it is an object, so the entry is checked
     * here; whether it still runs is the caller's job (`validateSelectedJvm`).
     */
    static getJavaRuntime(major: number | string): string | null {
        const entry = this.config.settings.java.runtimes[String(major)]
        return typeof entry === 'string' && entry.length > 0 ? entry : null
    }

    /** Every cached runtime, keyed by major, for the settings screen. */
    static getJavaRuntimes(): Record<string, string> {
        const runtimes: Record<string, string> = {}
        for (const major of Object.keys(this.config.settings.java.runtimes)) {
            const executable = this.getJavaRuntime(major)
            if (executable != null) runtimes[major] = executable
        }
        return runtimes
    }

    static setJavaRuntime(major: number | string, executable: string | null): void {
        if (executable == null) {
            delete this.config.settings.java.runtimes[String(major)]
        } else {
            this.config.settings.java.runtimes[String(major)] = executable
        }
    }

    static setJavaAutoDownload(autoDownload: boolean): void { this.config.settings.java.autoDownload = autoDownload }
    /**
     * Points the game data at a new directory from the next path lookup onwards.
     *
     * Nothing already on disk is moved — the settings screen says so. Passing null
     * restores the default location.
     */
    static setDataDirectory(directory: unknown): void {
        // A relative path would resolve against whatever the working directory happens to be.
        const isValid = directory == null
            || (typeof directory === 'string' && path.isAbsolute(directory) && this.isUsableDataDirectory(directory))

        if (!isValid) {
            throw new LauncherError(ERROR_CODE.CONFIG_INVALID_DATA_DIR, 'No se puede escribir en esa carpeta. Elige otra.')
        }

        this.config.settings.launcher.dataDirectory = directory ?? null
        this.dataDir = null
    }

    static setSelectedServer(serverId: string | null): void { this.config.selectedServer = serverId }
    static setSelectedAccount(uuid: string | null): void { this.config.selectedAccount = uuid }

    static addMicrosoftAccount(
        uuid: string,
        accessToken: string,
        username: string,
        displayName: string,
        mcExpires: number,
        msAccessToken: string,
        msRefreshToken: string,
        msExpires: number
    ): Account {
        this.config.selectedAccount = uuid
        this.config.authenticationDatabase[uuid] = {
            type: 'microsoft',
            accessToken,
            username: username.trim(),
            uuid: uuid.trim(),
            displayName: displayName.trim(),
            expiresAt: mcExpires,
            microsoft: {
                access_token: msAccessToken,
                refresh_token: msRefreshToken,
                expires_at: msExpires
            }
        }
        return this.config.authenticationDatabase[uuid]
    }

    static updateMicrosoftAccount(
        uuid: string,
        accessToken: string,
        mcExpires: number,
        msAccessToken: string,
        msRefreshToken: string,
        msExpires: number
    ): Account | null {
        if (!this.config.authenticationDatabase[uuid]) {
            logger.error('Account not found:', uuid)
            return null
        }

        const account = this.config.authenticationDatabase[uuid]
        account.accessToken = accessToken
        account.expiresAt = mcExpires
        account.microsoft.access_token = msAccessToken
        account.microsoft.refresh_token = msRefreshToken
        account.microsoft.expires_at = msExpires

        return account
    }

    static removeAccount(uuid: string): void {
        if (this.config.authenticationDatabase[uuid]) {
            delete this.config.authenticationDatabase[uuid]

            if (this.config.selectedAccount === uuid) {
                const accounts = Object.keys(this.config.authenticationDatabase)
                this.config.selectedAccount = accounts[0] ?? null
            }
        }
    }
}

export default ConfigManager
