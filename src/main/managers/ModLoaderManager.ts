import path from 'path'
import fs from 'fs-extra'
import child_process from 'child_process'
import crypto from 'crypto'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { resolveInside } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { isPlainObject } from '../../shared/guards'
import type { StepProgress } from '../../shared/launchProgress'
import type { LoaderType, ManifestLoader } from '../types/manifest'

const logger = Logger.getLogger('ModLoaderManager')

const FABRIC_META_URL = 'https://meta.fabricmc.net'

type ProgressCallback = (progress: StepProgress) => void

/** What a pack runs on: a loader the manifest declares, or none. */
export type ModLoaderType = LoaderType | 'vanilla'

/** The `default` of an exhaustive switch: a new loader does not compile until it has a case. */
function unsupportedLoader(loaderType: never): never {
    throw new LauncherError(ERROR_CODE.UNSUPPORTED_MODLOADER, `El mod loader "${String(loaderType)}" no esta soportado por este launcher`)
}

/**
 * Mod loader knowledge lives here and nowhere else.
 *
 * The loader is declared by the manifest (`loader: { type, version }`), which is the
 * only place that knows it. See docs/manifest.md.
 */
class ModLoaderManager {

    static detectModLoader(loader: ManifestLoader | undefined): ModLoaderType {
        return loader?.type ?? 'vanilla'
    }

    static getVersionString(loader: ManifestLoader | undefined, minecraftVersion: string): string {
        const loaderType = this.detectModLoader(loader)
        switch (loaderType) {
            case 'fabric': return `fabric-loader-${loader?.version}-${minecraftVersion}`
            case 'forge': return `${minecraftVersion}-forge-${loader?.version}`
            case 'vanilla': return minecraftVersion
            default: return unsupportedLoader(loaderType)
        }
    }

    static versionJsonPath(versionString: string): string {
        return ConfigManager.getVersionJsonPath(versionString)
    }

    static isModLoaderInstalled(loader: ManifestLoader | undefined, minecraftVersion: string): boolean {
        if (!loader) return true
        if (!loader.version) return false
        return fs.existsSync(this.versionJsonPath(this.getVersionString(loader, minecraftVersion)))
    }

    /** Null for a vanilla pack, which has nothing to install. */
    static async installModLoader(
        loader: ManifestLoader | undefined,
        minecraftVersion: string,
        javaPath: string,
        instanceDir: string,
        progressCallback?: ProgressCallback
    ): Promise<true | null> {
        logger.info(`Installing mod loader: ${this.detectModLoader(loader)} ${loader?.version || ''}`)

        if (!loader) return null

        const loaderType = loader.type
        switch (loaderType) {
            case 'fabric': return await this.installFabric(loader, minecraftVersion, progressCallback)
            case 'forge': return await this.installForge(loader, minecraftVersion, javaPath, instanceDir, progressCallback)
            default: return unsupportedLoader(loaderType)
        }
    }

    /**
     * Fabric has no installer: the loader profile is published by Fabric Meta and only
     * needs to be written into the versions directory. Its libraries are then resolved
     * by the regular mod loader library download step.
     */
    static async installFabric(loader: ManifestLoader, minecraftVersion: string, progressCallback?: ProgressCallback): Promise<true> {
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

            const profile: unknown = await response.json()

            // The profile is written under the id the launcher will later look it up by, never
            // under whatever `id` the response carries: that is network data, and a profile saved
            // anywhere else would be reinstalled on every launch and never found by the launch.
            const versionId = this.getVersionString(loader, minecraftVersion)
            const profileId = isPlainObject(profile) ? profile.id : undefined
            if (profileId !== versionId) {
                throw new LauncherError(ERROR_CODE.MODLOADER_FAILED, `Fabric Meta devolvio el perfil "${profileId}" y se esperaba "${versionId}"`)
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
    static async installForge(
        loader: ManifestLoader,
        minecraftVersion: string,
        javaPath: string,
        instanceDir: string,
        progressCallback?: ProgressCallback
    ): Promise<true> {
        try {
            if (progressCallback) progressCallback({ current: 0, total: 100, message: 'Preparando instalacion de Forge...' })

            if (!loader.version) throw new Error('El manifest no declara la version de Forge (loader.version)')
            if (!javaPath) throw new Error('Se necesita Java para ejecutar el instalador de Forge')

            const installerRelPath = loader.installer?.path
            if (!installerRelPath) {
                throw new LauncherError(
                    ERROR_CODE.UNSUPPORTED_MODLOADER,
                    'El manifest declara Forge pero no publica el instalador (loader.installer.path). ' +
                    'Forge todavia no esta soportado por el generador de manifests.'
                )
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

            await new Promise<void>((resolve, reject) => {
                const proc = child_process.execFile(
                    this._consoleJavaExec(javaPath),
                    ['-jar', installerPath, '--installClient', commonDir],
                    { cwd: commonDir, maxBuffer: 10 * 1024 * 1024 }
                )

                proc.stdout?.on('data', (data: Buffer | string) => {
                    logger.info('[Forge Installer]', data.toString().trim())
                    if (progressCallback) progressCallback({ current: 50, total: 100, message: 'Instalando Forge...' })
                })
                proc.stderr?.on('data', (data: Buffer | string) => logger.warn('[Forge Installer Error]', data.toString().trim()))
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve()
                        return
                    }
                    reject(new LauncherError(
                        ERROR_CODE.MODLOADER_FAILED,
                        `El instalador de Forge ha fallado (codigo ${code}). Revisa los logs (Configuracion > Abrir carpeta de logs).`
                    ))
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

    static ensureLauncherProfiles(commonDir: string, minecraftVersion: string): void {
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
    static _consoleJavaExec(javaPath: string): string {
        return process.platform === 'win32' ? javaPath.replace(/javaw\.exe$/i, 'java.exe') : javaPath
    }
}

export default ModLoaderManager
