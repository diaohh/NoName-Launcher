import { DistributionAPI } from 'helios-core/common'
import { downloadQueue, getExpectedDownloadSize, HashAlgo } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { validateLocalFile } from '../utils/FileUtils'
import path from 'path'
import fs from 'fs-extra'
import AdmZip from 'adm-zip'

const logger = Logger.getLogger('DistributionManager')

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1)

class DistributionManager {

    static distribution = null
    static selectedServer = null
    static distroAPI = null

    static async loadDistribution(force = false) {
        try {
            const distroUrl = process.env.DISTRIBUTION_URL || ConfigManager.getDistributionURL()

            if (!distroUrl) {
                throw new Error('No distribution URL configured')
            }

            logger.info('Loading distribution from:', distroUrl)

            const launcherDir = ConfigManager.getLauncherDirectory()
            const commonDir = ConfigManager.getCommonDirectory()
            const instanceDir = ConfigManager.getInstanceDirectory()
            const devMode = process.env.DISTRIBUTION_DEV_MODE === 'true'

            this.distroAPI = new DistributionAPI(
                launcherDir, commonDir, instanceDir, distroUrl, devMode
            )

            this.distribution = await this.distroAPI.getDistribution()

            if (!this.distribution) {
                throw new Error('Failed to load distribution')
            }

            logger.info('Distribution loaded successfully')
            logger.info('Available servers:', this.distribution.servers.length)

            this.selectedServer = this.distribution.getMainServer()

            if (this.selectedServer) {
                logger.info('Default server selected:', this.selectedServer.rawServer.name)
            }

            return this.distribution
        } catch (err) {
            logger.error('Failed to load distribution:', err)
            throw err
        }
    }

    static getDistribution() { return this.distribution }
    static getServers() { return this.distribution ? this.distribution.servers : [] }
    static getSelectedServer() { return this.selectedServer }

    static setSelectedServer(serverId) {
        const server = this.distribution.getServerById(serverId)
        if (!server) {
            logger.error('Server not found:', serverId)
            return false
        }

        this.selectedServer = server
        logger.info('Server selected:', server.rawServer.name)
        ConfigManager.setSelectedServer(serverId)
        ConfigManager.save()
        return true
    }

    static getServerInfo(server) {
        if (!server) server = this.selectedServer
        if (!server) return null

        const raw = server.rawServer
        return {
            id: raw.id,
            name: raw.name,
            description: raw.description,
            icon: raw.icon,
            banner: raw.banner || null,
            version: raw.version,
            minecraftVersion: raw.minecraftVersion,
            address: raw.address,
            mainServer: raw.mainServer
        }
    }

    static async validateDistribution(server, progressCallback) {
        try {
            if (!server) server = this.selectedServer
            if (!server) throw new Error('No server selected')

            logger.info('Validating distribution for server:', server.rawServer.name)

            const modules = this.getServerModules(server)
            const instanceDir = path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id)

            const invalidFiles = []
            let validated = 0

            for (const module of modules) {
                validated++
                if (progressCallback) {
                    progressCallback(validated, modules.length, `Validando ${module.name}...`)
                }

                if (module.type === 'VersionManifest') continue
                if (!module.artifact || !module.artifact.url) continue

                let filePath
                if (module.type === 'ForgeHosted' || module.type === 'Forge') {
                    filePath = path.join(ConfigManager.getCommonDirectory(), 'forge', path.basename(module.artifact.url))
                } else if (module.type === 'ForgeMod' || module.type === 'LiteMod') {
                    filePath = path.join(instanceDir, 'mods', path.basename(module.artifact.url))
                } else if (module.type === 'File') {
                    filePath = path.join(instanceDir, module.artifact.path || path.basename(module.artifact.url))
                } else {
                    filePath = path.join(instanceDir, path.basename(module.artifact.url))
                }

                if (!fs.existsSync(filePath)) {
                    invalidFiles.push({ module, filePath })
                    continue
                }

                const stats = fs.statSync(filePath)
                if (stats.isDirectory()) continue

                if (!await validateLocalFile(filePath, HashAlgo.MD5, module.artifact.MD5)) {
                    invalidFiles.push({ module, filePath })
                }
            }

            logger.info(`Validation complete. ${invalidFiles.length} files need download`)
            return invalidFiles
        } catch (err) {
            logger.error('Distribution validation failed:', err)
            throw err
        }
    }

    static async downloadServerFiles(invalidFiles, progressCallback) {
        try {
            if (invalidFiles.length === 0) return true

            const downloads = invalidFiles.map(({ module, filePath }, index) => {
                const isZip = module.artifact.url.toLowerCase().endsWith('.zip')
                return {
                    // downloadQueue tracks progress per id, so it must be unique.
                    id: `${module.id || module.name}#${index}`,
                    hash: module.artifact.MD5 || '',
                    algo: HashAlgo.MD5,
                    size: module.artifact.size || 0,
                    url: module.artifact.url,
                    path: isZip ? `${filePath}.download` : filePath,
                    module,
                    filePath,
                    isZip
                }
            })

            const totalSize = getExpectedDownloadSize(downloads)

            await downloadQueue(downloads, (received) => {
                if (progressCallback) {
                    const progress = totalSize > 0
                        ? `${toMB(received)} MB / ${toMB(totalSize)} MB`
                        : `${toMB(received)} MB`
                    progressCallback(received, totalSize, `Descargando archivos del servidor... ${progress}`)
                }
            })

            for (const download of downloads) {
                if (!await validateLocalFile(download.path, download.algo, download.hash)) {
                    throw new Error(`El archivo ${download.module.name} no coincide con el checksum esperado`)
                }

                if (download.isZip) {
                    if (progressCallback) {
                        progressCallback(totalSize, totalSize, `Extrayendo ${download.module.name}...`)
                    }
                    fs.ensureDirSync(download.filePath)
                    new AdmZip(download.path).extractAllTo(download.filePath, true)
                    fs.removeSync(download.path)
                }
            }

            logger.info(`Downloaded ${downloads.length} server files successfully`)
            return true
        } catch (err) {
            logger.error('File download failed:', err)
            throw err
        }
    }

    /**
     * Set server data from Firestore (renderer sends complete modpack + modules)
     * Creates an adapter compatible with LaunchManager and ModLoaderManager
     */
    static setServerData(serverData) {
        this.selectedServer = {
            rawServer: serverData,
            modules: (serverData.modules || []).map(m => ({ rawModule: m }))
        }
        logger.info('Server data set from Firestore:', serverData.name)
        ConfigManager.setSelectedServer(serverData.id)
        ConfigManager.save()
        return true
    }

    static getMinecraftVersion(server) {
        if (!server) server = this.selectedServer
        return server ? server.rawServer.minecraftVersion : null
    }

    static getServerModules(server) {
        if (!server) server = this.selectedServer
        return server ? (server.rawServer.modules || []) : []
    }

    static requiresForge(server) {
        if (!server) server = this.selectedServer
        if (!server) return false
        return this.getServerModules(server).some(m => m.type === 'ForgeHosted' || m.type === 'Forge')
    }

    static getForgeVersion(server) {
        if (!server) server = this.selectedServer
        if (!server) return null
        const modules = this.getServerModules(server)
        const forgeModule = modules.find(m => m.type === 'ForgeHosted' || m.type === 'Forge')
        if (!forgeModule) return null
        return forgeModule.id.split(':').pop()
    }

    static async refresh() {
        logger.info('Refreshing distribution...')
        if (this.distroAPI) {
            this.distribution = await this.distroAPI.refreshDistributionOrFallback()
            this.selectedServer = this.distribution.getMainServer()
            return this.distribution
        }
        return await this.loadDistribution(true)
    }
}

export default DistributionManager
