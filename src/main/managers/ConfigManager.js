import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('ConfigManager')

/**
 * Stamped into config.json so the file can be migrated between launcher releases.
 * A file without the field predates the stamp and is treated as version 0.
 */
const CONFIG_VERSION = 1

class ConfigManager {
    static config = null
    static configPath = null
    static launcherDir = null

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

    static getInstanceDirectory() {
        return path.join(this.getLauncherDirectory(), 'instances')
    }

    static getCommonDirectory() {
        return path.join(this.getLauncherDirectory(), 'common')
    }

    static getDefaultConfig() {
        return {
            version: CONFIG_VERSION,
            settings: {
                game: {
                    resWidth: 1280,
                    resHeight: 720,
                    fullscreen: false
                },
                java: {
                    minRAM: '2G',
                    maxRAM: '4G',
                    executable: null,
                    autoDownload: true
                },
                launcher: {
                    dataDirectory: this.getLauncherDirectory()
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
            this.save()
            return this.config
        }

        let parsed
        try {
            parsed = JSON.parse(fs.readFileSync(this.configPath, 'UTF-8'))
        } catch (err) {
            this.quarantineConfig(err)
            this.config = this.getDefaultConfig()
            this.save()
            return this.config
        }

        // Read before validateConfig, which merges the defaults in and would stamp the
        // current version onto a file that never had one.
        const diskVersion = typeof parsed.version === 'number' ? parsed.version : 0

        this.config = this.validateConfig(parsed)
        this.config.version = CONFIG_VERSION

        if (diskVersion !== CONFIG_VERSION) {
            logger.info(`Migrating config from version ${diskVersion} to ${CONFIG_VERSION}`)
            this.save()
        }

        logger.info('Configuration loaded successfully')
        return this.config
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

    static save() {
        try {
            fs.writeFileSync(
                this.configPath,
                JSON.stringify(this.config, null, 4),
                'UTF-8'
            )
            logger.info('Configuration saved successfully')
        } catch (err) {
            logger.error('Failed to save config', err)
        }
    }

    static validateConfig(config) {
        const defaults = this.getDefaultConfig()

        const merge = (target, source) => {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    target[key] = target[key] || {}
                    merge(target[key], source[key])
                } else if (target[key] === undefined) {
                    target[key] = source[key]
                }
            }
            return target
        }

        return merge(config, defaults)
    }

    static getConfig() { return this.config }
    static getGameWidth() { return this.config.settings.game.resWidth }
    static getGameHeight() { return this.config.settings.game.resHeight }
    static getFullscreen() { return this.config.settings.game.fullscreen }
    static getMinRAM() { return this.config.settings.java.minRAM }
    static getMaxRAM() { return this.config.settings.java.maxRAM }
    static getJavaExecutable() { return this.config.settings.java.executable }
    static getJavaAutoDownload() { return this.config.settings.java.autoDownload }
    static getDataDirectory() { return this.config.settings.launcher.dataDirectory }
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
    static setMaxRAM(ram) { this.config.settings.java.maxRAM = ram }
    static setJavaExecutable(executable) { this.config.settings.java.executable = executable }
    static setJavaAutoDownload(autoDownload) { this.config.settings.java.autoDownload = autoDownload }
    static setDataDirectory(directory) { this.config.settings.launcher.dataDirectory = directory }
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
