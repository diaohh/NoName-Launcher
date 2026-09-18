import path from 'path'
import fs from 'fs-extra'
import child_process from 'child_process'
import crypto from 'crypto'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { resolveInside } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('ModLoaderManager')

const FABRIC_META_URL = 'https://meta.fabricmc.net'

/**
 * Mod loader knowledge lives here and nowhere else.
 *
 * The loader is declared by the manifest (`loader: { type, version }`), which is the
 * only place that knows it. See docs/manifest.md.
 */
class ModLoaderManager {

    static detectModLoader(loader) {
        return loader?.type || 'vanilla'
    }

    static getVersionString(loader, minecraftVersion) {
        switch (this.detectModLoader(loader)) {
            case 'fabric': return `fabric-loader-${loader.version}-${minecraftVersion}`
            case 'forge': return `${minecraftVersion}-forge-${loader.version}`
            default: return minecraftVersion
        }
    }

    static versionJsonPath(versionString) {
        return ConfigManager.getVersionJsonPath(versionString)
    }

    static isModLoaderInstalled(loader, minecraftVersion) {
        if (this.detectModLoader(loader) === 'vanilla') return true
        if (!loader.version) return false
        return fs.existsSync(this.versionJsonPath(this.getVersionString(loader, minecraftVersion)))
    }

    static async installModLoader(loader, minecraftVersion, javaPath, instanceDir, progressCallback) {
        const loaderType = this.detectModLoader(loader)
        logger.info(`Installing mod loader: ${loaderType} ${loader?.version || ''}`)

        switch (loaderType) {
            case 'fabric': return await this.installFabric(loader, minecraftVersion, progressCallback)
            case 'forge': return await this.installForge(loader, minecraftVersion, javaPath, instanceDir, progressCallback)
            case 'vanilla': return null
            default: {
                const error = new Error(`El mod loader "${loaderType}" no esta soportado por este launcher`)
                error.code = ERROR_CODE.UNSUPPORTED_MODLOADER
                throw error
            }
        }
    }

    /**
     * Fabric has no installer: the loader profile is published by Fabric Meta and only
     * needs to be written into the versions directory. Its libraries are then resolved
     * by the regular mod loader library download step.
     */
    static async installFabric(loader, minecraftVersion, progressCallback) {
        try {
            if (progressCallback) progressCallback({ current: 0, total: 100, message: 'Preparando instalacion de Fabric...' })

            if (!loader.version) throw new Error('El manifest no declara la version de Fabric (loader.version)')

            const profileUrl = `${FABRIC_META_URL}/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loader.version)}/profile/json`

            if (progressCallback) progressCallback({ current: 30, total: 100, message: 'Descargando perfil de Fabric...' })
            logger.info('Fetching Fabric profile:', profileUrl)

            const response = await fetchWithTimeout(profileUrl, 'el perfil de Fabric')
            if (!response.ok) {
                throw new Error(`Fabric Meta respondio ${response.status} para Fabric ${loader.version} / Minecraft ${minecraftVersion}`)
            }

            const profile = await response.json()

            // The profile is written under the id the launcher will later look it up by, never
            // under whatever `id` the response carries: that is network data, and a profile saved
            // anywhere else would be reinstalled on every launch and never found by the launch.
            const versionId = this.getVersionString(loader, minecraftVersion)
            if (profile.id !== versionId) {
                const error = new Error(`Fabric Meta devolvio el perfil "${profile.id}" y se esperaba "${versionId}"`)
                error.code = ERROR_CODE.MODLOADER_FAILED
                throw error
            }

            if (progressCallback) progressCallback({ current: 70, total: 100, message: 'Guardando perfil de Fabric...' })

            const versionJsonPath = this.versionJsonPath(versionId)
            await fs.ensureDir(path.dirname(versionJsonPath))
            await fs.writeJson(versionJsonPath, profile, { spaces: 2 })

            logger.info(`Fabric ${loader.version} profile installed for Minecraft ${minecraftVersion}`)
            if (progressCallback) progressCallback({ current: 100, total: 100, message: 'Fabric instalado correctamente' })
            return true
        } catch (err) {
            logger.error('Fabric installation failed:', err)
            throw err
        }
    }

    /**
     * Forge ships an installer jar, which the manifest publishes like any other file
     * (`loader.installer.path`, relative to the instance). Running it generates the
     * version JSON and applies its binary-patching processors, so it needs a JVM.
     *
     * NOT YET EXERCISED: `tools/pack-publish` refuses non-Fabric packs, so no manifest
     * can currently declare Forge. See "Pendiente" in docs/manifest.md.
     */
    static async installForge(loader, minecraftVersion, javaPath, instanceDir, progressCallback) {
        try {
            if (progressCallback) progressCallback({ current: 0, total: 100, message: 'Preparando instalacion de Forge...' })

            if (!loader.version) throw new Error('El manifest no declara la version de Forge (loader.version)')
            if (!javaPath) throw new Error('Se necesita Java para ejecutar el instalador de Forge')

            const installerRelPath = loader.installer?.path
            if (!installerRelPath) {
                const error = new Error(
                    'El manifest declara Forge pero no publica el instalador (loader.installer.path). ' +
                    'Forge todavia no esta soportado por el generador de manifests.'
                )
                error.code = ERROR_CODE.UNSUPPORTED_MODLOADER
                throw error
            }

            const installerPath = resolveInside(instanceDir, installerRelPath)
            if (!fs.existsSync(installerPath)) {
                throw new Error(`No se encontro el instalador de Forge en: ${installerPath}`)
            }

            const commonDir = ConfigManager.getCommonDirectory()
            fs.ensureDirSync(path.join(commonDir, 'versions'))
            fs.ensureDirSync(path.join(commonDir, 'libraries'))
            this.ensureLauncherProfiles(commonDir, minecraftVersion)

            if (progressCallback) progressCallback({ current: 20, total: 100, message: 'Ejecutando instalador de Forge...' })

            await new Promise((resolve, reject) => {
                const proc = child_process.execFile(
                    this._consoleJavaExec(javaPath),
                    ['-jar', installerPath, '--installClient', commonDir],
                    { cwd: commonDir, maxBuffer: 10 * 1024 * 1024 }
                )

                proc.stdout.on('data', (data) => {
                    logger.info('[Forge Installer]', data.toString().trim())
                    if (progressCallback) progressCallback({ current: 50, total: 100, message: 'Instalando Forge...' })
                })
                proc.stderr.on('data', (data) => logger.warn('[Forge Installer Error]', data.toString().trim()))
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve()
                        return
                    }
                    const error = new Error(`El instalador de Forge ha fallado (codigo ${code}). Revisa los logs.`)
                    error.code = ERROR_CODE.MODLOADER_FAILED
                    reject(error)
                })
                proc.on('error', (err) => reject(err))
            })

            if (progressCallback) progressCallback({ current: 100, total: 100, message: 'Forge instalado correctamente' })
            return true
        } catch (err) {
            logger.error('Forge installation failed:', err)
            throw err
        }
    }

    static ensureLauncherProfiles(commonDir, minecraftVersion) {
        const launcherProfilesPath = path.join(commonDir, 'launcher_profiles.json')
        if (fs.existsSync(launcherProfilesPath)) return

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

    /**
     * helios-core resolves javaw.exe on Windows, which has no console attached.
     * The Forge installer writes its progress to stdout, so use java.exe instead.
     */
    static _consoleJavaExec(javaPath) {
        return process.platform === 'win32' ? javaPath.replace(/javaw\.exe$/i, 'java.exe') : javaPath
    }
}

export default ModLoaderManager
