import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { safeStorage } from 'electron'
import Logger from '../utils/Logger'
import { resolveInside } from '../utils/PathUtils'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('ConfigManager')

/**
 * Stamped into config.json so the file can be migrated between launcher releases.
 * A file without the field predates the stamp and is treated as version 0.
 */
const CONFIG_VERSION = 1

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value)

/** Whether a stored value can stand in for its default. See `validateConfig`. */
function hasExpectedType(actual, expected) {
    if (expected === null) return actual === null || typeof actual === 'string'
    if (typeof expected === 'number') return typeof actual === 'number' && Number.isFinite(actual)
    return typeof actual === typeof expected
}

class ConfigManager {
    static config = null
    static configPath = null
    static launcherDir = null
    static dataDir = null

    /**
     * The launcher's own root, and the one thing the player cannot move.
     *
     * `config.json` lives here, and `load()` needs the path before there is any
     * configuration to read a preference from — so this must never depend on a setting.
     * Everything bulky (see `getDataDirectory`) hangs off the data directory instead.
     */
    static getLauncherDirectory() {
        if (this.launcherDir) {
            return this.launcherDir
        }

        const appDataPath = process.env.APPDATA ||
            (process.platform === 'darwin' ?
                path.join(os.homedir(), 'Library', 'Application Support') :
                path.join(os.homedir(), '.local', 'share'))

        this.launcherDir = path.join(appDataPath, '.nonamelauncher')

        if (!fs.existsSync(this.launcherDir)) {
            fs.mkdirSync(this.launcherDir, { recursive: true })
        }

        return this.launcherDir
    }

    /**
     * Where the game data goes: `common/`, `instances/`, the manifest cache and the JVMs
     * the launcher downloads. This is what the "Directorio de datos" setting governs.
     *
     * A stored path that cannot be used right now — an external drive that is unplugged,
     * a folder that lost its permissions — falls back to the launcher directory with a
     * warning and **does not** rewrite the config: the drive may well be back next time.
     */
    static getDataDirectory() {
        if (this.dataDir) {
            return this.dataDir
        }

        const configured = this.config?.settings?.launcher?.dataDirectory

        if (configured && !this.isUsableDataDirectory(configured)) {
            logger.warn(`The configured data directory is unusable, falling back to the default: ${configured}`)
        } else if (configured) {
            this.dataDir = configured
            return this.dataDir
        }

        this.dataDir = this.getLauncherDirectory()
        return this.dataDir
    }

    /** True when the directory exists (or can be created) and can be written to. */
    static isUsableDataDirectory(directory) {
        try {
            fs.ensureDirSync(directory)
            fs.accessSync(directory, fs.constants.W_OK)
            return true
        } catch (err) {
            logger.warn(`Data directory rejected (${directory})`, err)
            return false
        }
    }

    static getInstanceDirectory() {
        return path.join(this.getDataDirectory(), 'instances')
    }

    static getCommonDirectory() {
        return path.join(this.getDataDirectory(), 'common')
    }

    /**
     * `common/versions/<id>`. The id comes from the manifest or from a downloaded version
     * JSON (`inheritsFrom`), so it is resolved inside the versions directory rather than
     * trusted to be a single path segment.
     */
    static getVersionDirectory(versionId) {
        return resolveInside(path.join(this.getCommonDirectory(), 'versions'), versionId)
    }

    static getVersionJsonPath(versionId) {
        return path.join(this.getVersionDirectory(versionId), `${versionId}.json`)
    }

    static getDefaultConfig() {
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
                    executable: null,
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

    static load() {
        this.configPath = path.join(this.getLauncherDirectory(), 'config.json')

        if (!fs.existsSync(this.configPath)) {
            logger.info('Config file not found, creating default...')
            this.config = this.getDefaultConfig()
            this.saveAfterLoad()
            return this.config
        }

        let parsed
        try {
            parsed = JSON.parse(fs.readFileSync(this.configPath, 'UTF-8'))
            // `null`, an array or a bare string parse fine and are still not a config.
            if (!isPlainObject(parsed)) throw new Error('config.json does not hold an object')
        } catch (err) {
            this.quarantineConfig(err)
            this.config = this.getDefaultConfig()
            this.saveAfterLoad()
            return this.config
        }

        // Read before validateConfig, which merges the defaults in and would stamp the
        // current version onto a file that never had one.
        const diskVersion = typeof parsed.version === 'number' ? parsed.version : 0

        this.config = this.validateConfig(parsed)
        this.config.version = CONFIG_VERSION

        const rewriteNeeded = this.hydrateSecrets()

        if (diskVersion !== CONFIG_VERSION) {
            logger.info(`Migrating config from version ${diskVersion} to ${CONFIG_VERSION}`)
        }

        if (diskVersion !== CONFIG_VERSION || rewriteNeeded) {
            this.saveAfterLoad()
        }

        logger.info('Configuration loaded successfully')
        return this.config
    }

    /**
     * Brings the stored credentials back into memory.
     *
     * A v0 file holds them in the clear; they get encrypted by the save this asks for.
     * Anything that cannot be decrypted — keyring reset, a different OS user,
     * safeStorage gone — costs the session and nothing else: the Java settings, the
     * data directory and the selected modpack all survive.
     *
     * @returns true when the file on disk needs to be rewritten.
     */
    static hydrateSecrets() {
        const database = this.config.authenticationDatabase
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
                database[uuid] = this.decryptAccount(account)
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
    static purgeSession(reason) {
        logger.warn(`Purging the stored session: ${reason}`)
        this.config.authenticationDatabase = {}
        this.config.selectedAccount = null
    }

    static isEncryptionAvailable() {
        try {
            return safeStorage.isEncryptionAvailable()
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
    static encryptAccount(account) {
        const { accessToken, microsoft, ...rest } = account
        const { access_token, refresh_token, ...microsoftRest } = microsoft ?? {}

        return {
            ...rest,
            microsoft: microsoftRest,
            secrets: safeStorage
                .encryptString(JSON.stringify({ accessToken, access_token, refresh_token }))
                .toString('base64')
        }
    }

    static decryptAccount(account) {
        const { secrets, ...rest } = account
        const payload = JSON.parse(safeStorage.decryptString(Buffer.from(secrets, 'base64')))

        return {
            ...rest,
            accessToken: payload.accessToken,
            microsoft: {
                ...rest.microsoft,
                access_token: payload.access_token,
                refresh_token: payload.refresh_token
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
    static quarantineConfig(err) {
        const backupPath = `${this.configPath}.corrupt-${Date.now()}`
        try {
            fs.moveSync(this.configPath, backupPath)
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
     */
    static save() {
        const data = JSON.stringify(this.toDiskConfig(), null, 4)
        const tmpPath = `${this.configPath}.tmp`

        try {
            const fd = fs.openSync(tmpPath, 'w')
            try {
                fs.writeFileSync(fd, data, 'utf-8')
                fs.fsyncSync(fd)
            } finally {
                fs.closeSync(fd)
            }
            fs.renameSync(tmpPath, this.configPath)
        } catch (err) {
            try {
                fs.removeSync(tmpPath)
            } catch {
                // Nothing more to do; the next save overwrites it.
            }
            logger.error('Failed to save config', err)

            const error = new Error('No se ha podido guardar la configuracion. Comprueba que hay espacio en disco y permiso de escritura.')
            error.code = ERROR_CODE.CONFIG_SAVE_FAILED
            error.cause = err
            throw error
        }

        logger.info('Configuration saved successfully')
    }

    /**
     * `load()` rewrites the file after a migration or a reset, but the launcher must still
     * open when that write fails — a read-only disk is reported by the next explicit save.
     */
    static saveAfterLoad() {
        try {
            this.save()
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
    static toDiskConfig() {
        const config = { ...this.config, authenticationDatabase: {} }

        if (!this.isEncryptionAvailable()) {
            if (Object.keys(this.config.authenticationDatabase).length > 0) {
                logger.warn('safeStorage is unavailable, the session will not be persisted')
            }
            config.selectedAccount = null
            return config
        }

        for (const [uuid, account] of Object.entries(this.config.authenticationDatabase)) {
            try {
                config.authenticationDatabase[uuid] = this.encryptAccount(account)
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
    static validateConfig(config) {
        const defaults = this.getDefaultConfig()

        const merge = (target, source, parentKey) => {
            for (const key in source) {
                const expected = source[key]
                const actual = target[key]
                const keyPath = parentKey ? `${parentKey}.${key}` : key

                if (isPlainObject(expected)) {
                    if (!isPlainObject(actual)) {
                        if (actual !== undefined) logger.warn(`Config: "${keyPath}" is not an object, resetting it`)
                        target[key] = {}
                    }
                    merge(target[key], expected, keyPath)
                } else if (actual === undefined) {
                    target[key] = expected
                } else if (!hasExpectedType(actual, expected)) {
                    logger.warn(`Config: "${keyPath}" has an invalid value, resetting it to the default`)
                    target[key] = expected
                }
            }
            return target
        }

        return merge(config, defaults, '')
    }

    static getConfig() { return this.config }
    static getGameWidth() { return this.config.settings.game.resWidth }
    static getGameHeight() { return this.config.settings.game.resHeight }
    static getFullscreen() { return this.config.settings.game.fullscreen }
    static getMinRAM() { return this.config.settings.java.minRAM }
    static getMaxRAM() { return this.config.settings.java.maxRAM }
    static getJavaExecutable() { return this.config.settings.java.executable }
    static getJavaAutoDownload() { return this.config.settings.java.autoDownload }
    static getUseModpackRam() { return this.config.settings.java.useModpackRam }
    static getMinRAMMb() { return this.parseRamToMB(this.getMinRAM()) }
    static getMaxRAMMb() { return this.parseRamToMB(this.getMaxRAM()) }
    static getSelectedServer() { return this.config.selectedServer }
    static getSelectedAccount() { return this.config.selectedAccount }
    static getAuthenticationDatabase() { return this.config.authenticationDatabase }

    static getAccountByUUID(uuid) {
        return this.config.authenticationDatabase[uuid] || null
    }

    static setGameWidth(width) { this.config.settings.game.resWidth = width }
    static setGameHeight(height) { this.config.settings.game.resHeight = height }
    static setFullscreen(fullscreen) { this.config.settings.game.fullscreen = fullscreen }
    static setMinRAM(ram) { this.config.settings.java.minRAM = ram }
    static setUseModpackRam(value) { this.config.settings.java.useModpackRam = !!value }

    /**
     * The JVM aborts before printing anything useful when `-Xms` sits above `-Xmx`, and the
     * defaults are 2G/4G — so dragging the settings slider down past the minimum would build
     * a launch command that simply dies. The floor follows the ceiling down.
     */
    static setMaxRAM(ram) {
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
    static parseRamToMB(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
        if (typeof value !== 'string') return null

        const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([GMK])?B?$/i)
        if (!match) return null

        const unit = (match[2] || 'M').toUpperCase()
        const multiplier = unit === 'G' ? 1024 : unit === 'K' ? 1 / 1024 : 1

        return Math.round(parseFloat(match[1]) * multiplier)
    }

    static formatRamFromMB(megabytes) {
        return `${Math.round(megabytes)}M`
    }
    static setJavaExecutable(executable) { this.config.settings.java.executable = executable }
    static setJavaAutoDownload(autoDownload) { this.config.settings.java.autoDownload = autoDownload }
    /**
     * Points the game data at a new directory from the next path lookup onwards.
     *
     * Nothing already on disk is moved — the settings screen says so. Passing null
     * restores the default location.
     */
    static setDataDirectory(directory) {
        if (directory != null && !this.isUsableDataDirectory(directory)) {
            const error = new Error('No se puede escribir en esa carpeta. Elige otra.')
            error.code = ERROR_CODE.CONFIG_INVALID_DATA_DIR
            throw error
        }

        this.config.settings.launcher.dataDirectory = directory
        this.dataDir = null
    }

    static setSelectedServer(serverId) { this.config.selectedServer = serverId }
    static setSelectedAccount(uuid) { this.config.selectedAccount = uuid }

    static addMicrosoftAccount(uuid, accessToken, username, displayName, mcExpires, msAccessToken, msRefreshToken, msExpires) {
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

    static updateMicrosoftAccount(uuid, accessToken, mcExpires, msAccessToken, msRefreshToken, msExpires) {
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

    static removeAccount(uuid) {
        if (this.config.authenticationDatabase[uuid]) {
            delete this.config.authenticationDatabase[uuid]

            if (this.config.selectedAccount === uuid) {
                const accounts = Object.keys(this.config.authenticationDatabase)
                this.config.selectedAccount = accounts.length > 0 ? accounts[0] : null
            }
        }
    }
}

export default ConfigManager
