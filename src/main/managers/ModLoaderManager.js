import path from 'path'
import fs from 'fs-extra'
import child_process from 'child_process'
import crypto from 'crypto'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('ModLoaderManager')

class ModLoaderManager {

    static detectModLoader(server) {
        const modules = server.rawServer.modules || []
        for (const module of modules) {
            if (module.type === 'ForgeHosted' || module.type === 'Forge') return 'forge'
            if (module.type === 'Fabric') return 'fabric'
        }
        return 'vanilla'
    }

    static _getForgeBuildNumber(forgeModule) {
        // Direct field from Firestore (preferred)
        if (forgeModule.rawModule.forgeVersion) return forgeModule.rawModule.forgeVersion
        // Maven format: net.minecraftforge:forge:1.20.1-47.2.0
        const mavenId = forgeModule.rawModule.id || ''
        const version = mavenId.split(':').pop()
        const build = version.split('-').slice(1).join('-')
        return build || null
    }

    static _getFabricVersion(fabricModule) {
        if (fabricModule.rawModule.fabricVersion) return fabricModule.rawModule.fabricVersion
        const mavenId = fabricModule.rawModule.id || ''
        return mavenId.split(':').pop() || null
    }

    static isModLoaderInstalled(server) {
        const loaderType = this.detectModLoader(server)
        if (loaderType === 'vanilla') return true

        const minecraftVersion = server.rawServer.minecraftVersion
        const commonDir = ConfigManager.getCommonDirectory()

        if (loaderType === 'forge') {
            const forgeModule = server.modules.find(m => m.rawModule.type === 'ForgeHosted' || m.rawModule.type === 'Forge')
            if (!forgeModule) return false

            const forgeBuildNumber = this._getForgeBuildNumber(forgeModule)
            if (!forgeBuildNumber) return false

            const forgeVersionString = `${minecraftVersion}-forge-${forgeBuildNumber}`
            const forgeJsonPath = path.join(commonDir, 'versions', forgeVersionString, `${forgeVersionString}.json`)
            return fs.existsSync(forgeJsonPath)
        }

        if (loaderType === 'fabric') {
            const fabricModule = server.modules.find(m => m.rawModule.type === 'Fabric')
            if (!fabricModule) return false

            const fabricVersion = this._getFabricVersion(fabricModule)
            if (!fabricVersion) return false

            const fabricJsonPath = path.join(commonDir, 'versions', `fabric-loader-${fabricVersion}-${minecraftVersion}`, `fabric-loader-${fabricVersion}-${minecraftVersion}.json`)
            return fs.existsSync(fabricJsonPath)
        }

        return false
    }

    static async installModLoader(server, progressCallback) {
        const loaderType = this.detectModLoader(server)
        logger.info(`Installing mod loader: ${loaderType}`)

        switch (loaderType) {
            case 'forge': return await this.installForge(server, progressCallback)
            case 'fabric': return await this.installFabric(server, progressCallback)
            case 'vanilla': return null
            default: throw new Error(`Unsupported mod loader: ${loaderType}`)
        }
    }

    static async installForge(server, progressCallback) {
        try {
            if (progressCallback) progressCallback(0, 100, 'Preparando instalacion de Forge...')

            const forgeModule = server.modules.find(m =>
                m.rawModule.type === 'ForgeHosted' || m.rawModule.type === 'Forge'
            )
            if (!forgeModule) throw new Error('Forge module not found in server configuration')

            const forgeBuildNumber = this._getForgeBuildNumber(forgeModule)
            if (!forgeBuildNumber) throw new Error('Forge version not specified. Add forgeVersion field to the Forge module in Firestore.')
            const minecraftVersion = server.rawServer.minecraftVersion
            const commonDir = ConfigManager.getCommonDirectory()

            if (!forgeModule.rawModule.artifact || !forgeModule.rawModule.artifact.url) {
                throw new Error('Forge module missing artifact.url in Firestore')
            }
            const forgeInstallerPath = path.join(commonDir, 'forge', path.basename(forgeModule.rawModule.artifact.url))

            if (!fs.existsSync(forgeInstallerPath)) {
                throw new Error(`Forge installer not found at: ${forgeInstallerPath}`)
            }

            if (progressCallback) progressCallback(20, 100, 'Ejecutando instalador de Forge...')

            fs.ensureDirSync(path.join(commonDir, 'versions'))
            fs.ensureDirSync(path.join(commonDir, 'libraries'))

            const launcherProfilesPath = path.join(commonDir, 'launcher_profiles.json')
            if (!fs.existsSync(launcherProfilesPath)) {
                fs.writeJsonSync(launcherProfilesPath, {
                    profiles: {
                        NoNameLauncher: {
                            name: 'NoNameLauncher', type: 'custom',
                            created: new Date().toISOString(),
                            lastUsed: new Date().toISOString(),
                            icon: 'Furnace',
                            lastVersionId: minecraftVersion,
                            gameDir: commonDir
                        }
                    },
                    selectedProfile: 'NoNameLauncher',
                    clientToken: crypto.randomBytes(16).toString('hex'),
                    authenticationDatabase: {},
                    launcherVersion: { name: 'NoNameLauncher', format: 21 }
                }, { spaces: 2 })
            }

            const javaPath = ConfigManager.getJavaExecutable() || 'java'
            const installCommand = [javaPath, '-jar', `"${forgeInstallerPath}"`, '--installClient', `"${commonDir}"`].join(' ')

            await new Promise((resolve, reject) => {
                const proc = child_process.exec(installCommand, { cwd: commonDir, maxBuffer: 10 * 1024 * 1024 })

                proc.stdout.on('data', (data) => {
                    logger.info('[Forge Installer]', data.toString().trim())
                    if (progressCallback) progressCallback(50, 100, 'Instalando Forge...')
                })
                proc.stderr.on('data', (data) => logger.warn('[Forge Installer Error]', data.toString().trim()))
                proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Forge installer exited with code ${code}`)))
                proc.on('error', (err) => reject(err))
            })

            if (progressCallback) progressCallback(100, 100, 'Forge instalado correctamente')
            return true
        } catch (err) {
            logger.error('Forge installation failed:', err)
            throw err
        }
    }

    static async installFabric(server, progressCallback) {
        try {
            if (progressCallback) progressCallback(0, 100, 'Preparando instalacion de Fabric...')

            const fabricModule = server.modules.find(m => m.rawModule.type === 'Fabric')
            if (!fabricModule) throw new Error('Fabric module not found')

            const fabricVersion = this._getFabricVersion(fabricModule)
            if (!fabricVersion) throw new Error('Fabric version not specified. Add fabricVersion field to the Fabric module in Firestore.')
            const minecraftVersion = server.rawServer.minecraftVersion
            const commonDir = ConfigManager.getCommonDirectory()
            const fabricPath = path.join(commonDir, 'fabric', `fabric-loader-${fabricVersion}-${minecraftVersion}.jar`)

            if (!fs.existsSync(fabricPath)) throw new Error(`Fabric artifact not found at: ${fabricPath}`)

            if (progressCallback) progressCallback(50, 100, 'Instalando Fabric...')
            if (progressCallback) progressCallback(100, 100, 'Fabric instalado correctamente')
            return true
        } catch (err) {
            logger.error('Fabric installation failed:', err)
            throw err
        }
    }

    static getVersionString(server) {
        const loaderType = this.detectModLoader(server)
        const minecraftVersion = server.rawServer.minecraftVersion

        if (loaderType === 'forge') {
            const forgeModule = server.modules.find(m => m.rawModule.type === 'ForgeHosted' || m.rawModule.type === 'Forge')
            if (forgeModule) {
                const forgeBuildNumber = this._getForgeBuildNumber(forgeModule)
                if (forgeBuildNumber) return `${minecraftVersion}-forge-${forgeBuildNumber}`
            }
        }

        if (loaderType === 'fabric') {
            const fabricModule = server.modules.find(m => m.rawModule.type === 'Fabric')
            if (fabricModule) {
                const fabricVersion = this._getFabricVersion(fabricModule)
                if (fabricVersion) return `fabric-loader-${fabricVersion}-${minecraftVersion}`
            }
        }

        return minecraftVersion
    }
}

export default ModLoaderManager
