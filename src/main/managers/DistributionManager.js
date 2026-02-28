import { DistributionAPI } from 'helios-core/common'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import got from 'got'
import AdmZip from 'adm-zip'

const logger = Logger.getLogger('DistributionManager')

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
                    filePath = path.join(ConfigManager.getCommonDirectory(), 'forge', `${module.id.split(':').pop()}.jar`)
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

                if (module.artifact.MD5) {
                    const fileBuffer = fs.readFileSync(filePath)
                    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex')
                    if (hash !== module.artifact.MD5) {
                        invalidFiles.push({ module, filePath })
                    }
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

            let downloaded = 0

            for (const { module, filePath } of invalidFiles) {
                downloaded++
                if (progressCallback) {
                    progressCallback(downloaded, invalidFiles.length, `Descargando ${module.name}...`)
                }

                const isZip = module.artifact.url.toLowerCase().endsWith('.zip')
                const downloadPath = isZip ? filePath + '.download' : filePath

                fs.ensureDirSync(path.dirname(downloadPath))

                const downloadStream = got.stream(module.artifact.url)
                const fileWriterStream = fs.createWriteStream(downloadPath)

                await new Promise((resolve, reject) => {
                    downloadStream.pipe(fileWriterStream)
                    fileWriterStream.on('finish', resolve)
                    fileWriterStream.on('error', reject)
                    downloadStream.on('error', reject)
                })

                if (isZip) {
                    if (progressCallback) {
                        progressCallback(downloaded, invalidFiles.length, `Extrayendo ${module.name}...`)
                    }
                    fs.ensureDirSync(filePath)
                    const zip = new AdmZip(downloadPath)
                    zip.extractAllTo(filePath, true)
                    fs.removeSync(downloadPath)
                }
            }

            logger.info('All files downloaded successfully')
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
