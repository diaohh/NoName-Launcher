import child_process from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { validateSelectedJvm, latestOpenJDK, extractJdk, javaExecFromRoot, ensureJavaDirIsRoot, discoverBestJvmInstallation } from 'helios-core/java'
import { downloadFile, downloadQueue, getExpectedDownloadSize, HashAlgo } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import AuthManager from './AuthManager'
import DistributionManager from './DistributionManager'
import ManifestManager from './ManifestManager'
import ModLoaderManager from './ModLoaderManager'
import MinecraftDownloadManager from './MinecraftDownloadManager'
import Logger from '../utils/Logger'
import { validateLocalFile } from '../utils/FileUtils'
import { mavenToRelativePath, mavenToUrl } from '../utils/MavenUtils'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('LaunchManager')

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1)

// Minecraft 1.17 introduced the `arguments` manifest format and stopped shipping
// natives as library classifiers. Older releases would need a separate code path.
const MIN_SUPPORTED_MINOR = 17

class LaunchManager {

    static gameProcess = null

    static assertSupportedVersion(minecraftVersion) {
        const [major, minor] = minecraftVersion.split('.').map(part => parseInt(part))

        if (major === 1 && minor < MIN_SUPPORTED_MINOR) {
            const error = new Error(
                `Minecraft ${minecraftVersion} no es compatible con este launcher. ` +
                `Solo se admiten versiones 1.${MIN_SUPPORTED_MINOR} o superiores.`
            )
            error.code = ERROR_CODE.UNSUPPORTED_MC_VERSION
            throw error
        }
    }

    /**
     * The Mojang version manifest declares the exact Java major it was built for.
     * The table is only a fallback for manifests that omit it.
     */
    static getRequiredJavaVersion(minecraftVersion, versionJson) {
        const declared = versionJson?.javaVersion?.majorVersion
        if (declared) return declared

        const [, minor, patch] = minecraftVersion.split('.').map(part => parseInt(part) || 0)
        if (minor > 20 || (minor === 20 && patch >= 5)) return 21
        return 17
    }

    /**
     * Bounded range: a modpack built for Java 17 must not be launched on Java 21.
     */
    static javaSemverRange(majorVersion) {
        return `${majorVersion}.x`
    }

    static async validateJava(requiredVersion) {
        const javaPath = ConfigManager.getJavaExecutable()
        if (!javaPath) return null

        try {
            const javaRoot = ensureJavaDirIsRoot(javaPath)
            const vResult = await validateSelectedJvm(javaRoot, this.javaSemverRange(requiredVersion))
            if (vResult != null) {
                logger.info(`Java validation successful: ${javaPath} (${vResult.semverStr})`)
                return javaPath
            }
            logger.warn(`Java validation failed: ${javaPath} does not satisfy Java ${requiredVersion}`)
            return null
        } catch (err) {
            logger.error('Java validation error:', err)
            return null
        }
    }

    static async downloadJava(version, progressCallback) {
        const semverRange = this.javaSemverRange(version)
        const dataDir = ConfigManager.getLauncherDirectory()
        let archivePath = null

        try {
            if (progressCallback) progressCallback({ type: 'java_discover', message: `Buscando Java ${version} en el sistema...` })
            const existingJvm = await discoverBestJvmInstallation(dataDir, semverRange)
            if (existingJvm != null) {
                logger.info(`Found existing Java: ${existingJvm.path} (${existingJvm.semverStr})`)
                const execPath = javaExecFromRoot(existingJvm.path)
                if (fs.existsSync(execPath)) {
                    ConfigManager.setJavaExecutable(execPath)
                    ConfigManager.save()
                    return execPath
                }
            }

            logger.info(`Downloading Java ${version}...`)
            if (progressCallback) progressCallback({ type: 'java_download', message: `Descargando Java ${version}...` })

            // The asset path points at the launcher runtime dir, which is exactly where
            // discoverBestJvmInstallation looks on the next launch.
            const javaData = await latestOpenJDK(version, dataDir)
            if (!javaData || !javaData.url) throw new Error(`No hay una distribucion de Java ${version} disponible para esta plataforma`)

            archivePath = javaData.path
            await fs.ensureDir(path.dirname(archivePath))

            await downloadFile(javaData.url, archivePath, ({ transferred, total }) => {
                if (progressCallback) {
                    progressCallback({
                        type: 'java_download',
                        message: `Descargando Java ${version}... ${toMB(transferred)} MB / ${toMB(total || javaData.size)} MB`,
                        current: transferred,
                        total: total || javaData.size
                    })
                }
            })

            if (!await validateLocalFile(archivePath, javaData.algo || HashAlgo.SHA256, javaData.hash)) {
                throw new Error('La descarga de Java no coincide con el checksum oficial')
            }

            if (progressCallback) progressCallback({ type: 'java_extract', message: 'Extrayendo Java...' })
            const javaExecutable = await extractJdk(archivePath)

            if (!javaExecutable || !fs.existsSync(javaExecutable)) {
                throw new Error('No se encontro el ejecutable de Java tras la extraccion')
            }

            const installed = await validateSelectedJvm(ensureJavaDirIsRoot(javaExecutable), semverRange)
            if (installed == null) {
                throw new Error(`El Java instalado no satisface la version requerida (${version})`)
            }

            ConfigManager.setJavaExecutable(javaExecutable)
            ConfigManager.save()
            logger.info(`Java ${installed.semverStr} installed at ${javaExecutable}`)
            return javaExecutable
        } catch (err) {
            logger.error('Java download/install failed:', err)
            throw err
        } finally {
            // Never leave a partial or already extracted archive behind.
            if (archivePath) await fs.remove(archivePath).catch(() => {})
        }
    }

    static async ensureJava(requiredVersion, progressCallback) {
        const validJava = await this.validateJava(requiredVersion)
        if (validJava) return validJava

        if (ConfigManager.getJavaAutoDownload()) {
            return await this.downloadJava(requiredVersion, progressCallback)
        }
        throw new Error(`No valid Java ${requiredVersion} installation found and auto-download is disabled.`)
    }

    /**
     * Normalizes the two library formats found in version manifests: Mojang/Forge
     * declare `downloads.artifact`, Fabric declares a Maven `name` plus a repository
     * `url`. Returns null when the library carries no downloadable artifact.
     */
    static resolveLibraryArtifact(lib) {
        const artifact = lib.downloads?.artifact
        if (artifact?.path) {
            return {
                relativePath: artifact.path,
                url: artifact.url || null,
                sha1: artifact.sha1 || null,
                size: artifact.size || 0
            }
        }

        if (lib.name && lib.url) {
            return {
                relativePath: mavenToRelativePath(lib.name),
                url: mavenToUrl(lib.url, lib.name),
                sha1: lib.sha1 || null,
                size: lib.size || 0
            }
        }

        return null
    }

    /**
     * Identity of a library ignoring its version, so different versions of the same
     * artifact collide. Natives keep their classifier: `lwjgl:natives-windows` and
     * `lwjgl` are different entries on the classpath.
     */
    static libraryKey(lib, artifact) {
        if (!lib.name) return artifact.relativePath

        const [group, artifactId, , classifier] = lib.name.split(':')
        return classifier ? `${group}:${artifactId}:${classifier}` : `${group}:${artifactId}`
    }

    static async downloadModLoaderLibraries(versionString, progressCallback) {
        try {
            const commonDir = ConfigManager.getCommonDirectory()
            const librariesDir = path.join(commonDir, 'libraries')
            const versionJsonPath = path.join(commonDir, 'versions', versionString, `${versionString}.json`)

            if (!fs.existsSync(versionJsonPath)) {
                logger.warn(`Version JSON not found for ${versionString}, skipping`)
                return
            }

            const versionData = await fs.readJson(versionJsonPath)
            const pending = []

            for (const lib of versionData.libraries || []) {
                if (lib.rules && !this.processArgumentRules(lib)) continue

                const artifact = this.resolveLibraryArtifact(lib)
                if (!artifact) continue

                const libPath = path.join(librariesDir, artifact.relativePath)

                if (await validateLocalFile(libPath, HashAlgo.SHA1, artifact.sha1)) continue

                // Loader libraries generated locally by the installer have no URL.
                if (!artifact.url) {
                    logger.warn(`Library ${lib.name} has no download URL and is missing locally`)
                    continue
                }

                pending.push({
                    id: lib.name,
                    hash: artifact.sha1,
                    algo: HashAlgo.SHA1,
                    size: artifact.size,
                    url: artifact.url,
                    path: libPath
                })
            }

            if (pending.length === 0) return

            const totalSize = getExpectedDownloadSize(pending)
            logger.info(`Downloading ${pending.length} mod loader libraries`)

            await downloadQueue(pending, (received) => {
                if (progressCallback) {
                    progressCallback(received, totalSize, `Descargando librerias... ${toMB(received)} MB / ${toMB(totalSize)} MB`)
                }
            })

            const failed = []
            for (const asset of pending) {
                if (!await validateLocalFile(asset.path, asset.algo, asset.hash)) failed.push(asset.id)
            }

            if (failed.length > 0) {
                throw new Error(`No se pudieron descargar ${failed.length} librerias: ${failed.slice(0, 3).join(', ')}`)
            }
        } catch (err) {
            logger.error('Failed to download mod loader libraries:', err)
            throw err
        }
    }

    static async readVersionJson(versionId) {
        const versionJsonPath = path.join(ConfigManager.getCommonDirectory(), 'versions', versionId, `${versionId}.json`)
        if (!fs.existsSync(versionJsonPath)) throw new Error(`Version manifest not found: ${versionJsonPath}`)
        return await fs.readJson(versionJsonPath)
    }

    /**
     * Resolves a version manifest, merging it with its `inheritsFrom` parent when
     * the version belongs to a mod loader.
     *
     * @returns {{ versionData: object, vanillaVersion: string }} The merged manifest
     * and the vanilla version id, which is what the client jar and assets are keyed by.
     */
    static async loadVersionManifest(versionId) {
        const versionData = await this.readVersionJson(versionId)

        if (!versionData.inheritsFrom) {
            return { versionData, vanillaVersion: versionId }
        }

        const parentData = await this.readVersionJson(versionData.inheritsFrom)
        const merged = {
            ...parentData,
            ...versionData,
            libraries: [...(parentData.libraries || []), ...(versionData.libraries || [])]
        }

        // Only build `arguments` when at least one manifest declares it. Creating an
        // empty object here would shadow the legacy `minecraftArguments` branch.
        if (parentData.arguments || versionData.arguments) {
            merged.arguments = {
                game: [...(parentData.arguments?.game || []), ...(versionData.arguments?.game || [])],
                jvm: [...(parentData.arguments?.jvm || []), ...(versionData.arguments?.jvm || [])]
            }
        }

        return { versionData: merged, vanillaVersion: versionData.inheritsFrom }
    }

    static processArgTemplate(arg, argContext) {
        if (typeof arg !== 'string') return arg
        return arg.replace(/\$\{([^}]+)\}/g, (match, key) => argContext[key] || match)
    }

    static processArgumentRules(arg) {
        if (typeof arg === 'string') return true
        if (arg.rules) {
            const activeFeatures = {
                has_custom_resolution: true
            }
            for (const rule of arg.rules) {
                if (rule.os) {
                    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
                    if (rule.os.name && rule.os.name !== osName) return rule.action === 'disallow'
                }
                if (rule.features) {
                    const featureMatch = Object.entries(rule.features).every(
                        ([key, value]) => activeFeatures[key] === value
                    )
                    if (rule.action === 'allow') return featureMatch
                    return !featureMatch
                }
            }
        }
        return true
    }

    static appendArguments(args, argList, argContext) {
        for (const arg of argList) {
            if (!this.processArgumentRules(arg)) continue
            const argValue = typeof arg === 'string' ? arg : (arg.value || [])
            for (const value of (Array.isArray(argValue) ? argValue : [argValue])) {
                args.push(this.processArgTemplate(value, argContext))
            }
        }
    }

    static async buildLaunchCommand(account, versionId, server) {
        const { versionData, vanillaVersion } = await this.loadVersionManifest(versionId)

        if (!versionData.arguments) {
            const error = new Error(
                `El manifiesto de ${versionId} usa el formato antiguo (minecraftArguments), que no es compatible con este launcher.`
            )
            error.code = ERROR_CODE.UNSUPPORTED_MANIFEST
            throw error
        }

        const commonDir = ConfigManager.getCommonDirectory()
        const gameDir = server ? path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id) : ConfigManager.getInstanceDirectory()
        const assetsDir = path.join(commonDir, 'assets')
        const librariesDir = path.join(commonDir, 'libraries')
        const nativesDir = path.join(gameDir, 'natives')

        // Vanilla libraries come first in the merged manifest and the loader's come
        // after, so a later entry for the same artifact overrides the earlier one.
        // Without this the classpath would carry two versions of asm, guava or log4j
        // and the vanilla one would win.
        const librariesByArtifact = new Map()
        for (const lib of versionData.libraries) {
            if (lib.rules && !this.processArgumentRules(lib)) continue
            const artifact = this.resolveLibraryArtifact(lib)
            if (!artifact) continue
            librariesByArtifact.set(this.libraryKey(lib, artifact), path.join(librariesDir, artifact.relativePath))
        }

        const libraries = [...librariesByArtifact.values()]

        // The client jar always belongs to the vanilla version, even when launching a
        // mod loader profile such as `1.20.1-forge-47.2.0`.
        const clientJar = path.join(commonDir, 'versions', vanillaVersion, `${vanillaVersion}.jar`)
        libraries.push(clientJar)

        const classpath = libraries.join(process.platform === 'win32' ? ';' : ':')

        const argContext = {
            auth_player_name: account.displayName,
            version_name: versionId,
            game_directory: gameDir,
            assets_root: assetsDir,
            assets_index_name: versionData.assetIndex?.id || versionData.assets || vanillaVersion,
            auth_uuid: account.uuid,
            auth_access_token: account.accessToken,
            user_type: 'msa',
            version_type: versionData.type || 'release',
            resolution_width: ConfigManager.getGameWidth().toString(),
            resolution_height: ConfigManager.getGameHeight().toString(),
            natives_directory: nativesDir,
            // Both come from package.json: `app.getName()` resolves to productName and
            // `app.getVersion()` to version, so the launcher has one identity, not three.
            launcher_name: app.getName(),
            launcher_version: app.getVersion(),
            classpath,
            library_directory: librariesDir,
            classpath_separator: process.platform === 'win32' ? ';' : ':'
        }

        const maxRAM = server?.rawServer?.java?.maxRam || ConfigManager.getMaxRAM()
        const minRAM = server?.rawServer?.java?.minRam || ConfigManager.getMinRAM()
        const args = ['-Xmx' + maxRAM, '-Xms' + minRAM]

        this.appendArguments(args, versionData.arguments.jvm || [], argContext)

        args.push('-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M')
        args.push(versionData.mainClass)

        this.appendArguments(args, versionData.arguments.game || [], argContext)

        if (ConfigManager.getFullscreen()) {
            args.push('--fullscreen')
        }

        return args
    }

    static async launchMinecraft(progressCallback) {
        try {
            if (progressCallback) progressCallback({ type: 'auth', message: 'Validando cuenta...' })

            const validation = await AuthManager.validateSelectedMicrosoftAccount()
            if (!validation.ok) {
                // The renderer decides whether to bounce the player to the login screen
                // from `code`, not from this text, so a recoverable failure can keep its
                // own message: a network blip must not read like a dead session.
                const error = new Error(
                    AuthManager.isTerminalError(validation.code)
                        ? 'Tu sesion ha caducado. Vuelve a iniciar sesion.'
                        : validation.message
                )
                error.code = validation.code
                throw error
            }

            const account = AuthManager.getSelectedAccount()
            if (!account) {
                const error = new Error('No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.')
                error.code = ERROR_CODE.AUTH_NO_ACCOUNT
                throw error
            }

            const server = DistributionManager.getSelectedServer()
            if (!server) {
                const error = new Error('No hay ningun modpack seleccionado.')
                error.code = ERROR_CODE.LAUNCH_NO_SERVER
                throw error
            }

            // The renderer re-reads the modpack document right before launching, so this
            // is the current value, not whatever was cached when the list was loaded.
            if (server.rawServer.maintenance) {
                const error = new Error(
                    server.rawServer.maintenanceMessage
                    || 'El modpack esta en mantenimiento. Intentalo de nuevo en unos minutos.'
                )
                error.code = ERROR_CODE.MODPACK_MAINTENANCE
                throw error
            }

            logger.info('Launching server:', server.rawServer.name)

            if (progressCallback) progressCallback({ type: 'manifest', message: 'Descargando manifest del modpack...' })
            const { manifest, baseUrl } = await ManifestManager.fetch(server.rawServer.manifest)

            // The manifest is authoritative for launching; the Firestore field of the
            // same name exists only so the sidebar can show a version without fetching it.
            const minecraftVersion = manifest.minecraft.version
            this.assertSupportedVersion(minecraftVersion)

            if (progressCallback) progressCallback({ type: 'validation', message: 'Validando archivos del modpack...' })

            const plan = await DistributionManager.planSync(server, manifest, (current, total, msg) => {
                if (progressCallback) progressCallback({ type: 'validation', message: msg, current, total })
            })

            if (plan.toDownload.length > 0 || plan.toDelete.length > 0) {
                if (progressCallback) {
                    progressCallback({
                        type: 'download_mods',
                        message: `Actualizando modpack: ${plan.toDownload.length} archivos nuevos, ${plan.toDelete.length} obsoletos...`
                    })
                }
            }

            await DistributionManager.applySync(server, manifest, baseUrl, plan, (current, total, msg) => {
                if (progressCallback) progressCallback({ type: 'download_mods', message: msg, current, total })
            })

            if (progressCallback) progressCallback({ type: 'download', message: 'Preparando descarga de Minecraft...' })

            const vanillaManifest = await MinecraftDownloadManager.downloadMinecraft(minecraftVersion, (percent, phase, message) => {
                if (progressCallback) {
                    progressCallback({ type: 'download', message, phase: MinecraftDownloadManager.getPhaseDisplayName(phase), current: percent, total: 100 })
                }
            })

            // Java must be available before the mod loader step: the Forge installer runs on a JVM.
            if (progressCallback) progressCallback({ type: 'java', message: 'Validando Java...' })

            const requiredJavaVersion = this.getRequiredJavaVersion(minecraftVersion, vanillaManifest)
            const javaPath = await this.ensureJava(requiredJavaVersion, progressCallback)

            const loader = manifest.loader
            const loaderType = ModLoaderManager.detectModLoader(loader)
            const versionString = ModLoaderManager.getVersionString(loader, minecraftVersion)
            const instanceDir = path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id)

            if (loaderType !== 'vanilla') {
                if (!ModLoaderManager.isModLoaderInstalled(loader, minecraftVersion)) {
                    if (progressCallback) progressCallback({ type: 'modloader', message: `Instalando ${loaderType}...` })
                    await ModLoaderManager.installModLoader(loader, minecraftVersion, javaPath, instanceDir, (current, total, msg) => {
                        if (progressCallback) progressCallback({ type: 'modloader', message: msg, current, total })
                    })
                }

                if (progressCallback) progressCallback({ type: 'download', message: `Descargando librerias de ${loaderType}...` })
                await this.downloadModLoaderLibraries(versionString, (current, total, message) => {
                    if (progressCallback) progressCallback({ type: 'download', message: message || `Descargando librerias de ${loaderType}...`, current, total })
                })
            }

            if (progressCallback) progressCallback({ type: 'launch', message: 'Construyendo comando de lanzamiento...' })

            const args = await this.buildLaunchCommand(account, versionString, server)

            if (progressCallback) progressCallback({ type: 'launch', message: 'Iniciando Minecraft...' })

            await fs.ensureDir(instanceDir)
            await fs.ensureDir(path.join(instanceDir, 'natives'))

            const normalizedJavaPath = path.normalize(javaPath)
            this.gameProcess = child_process.spawn(normalizedJavaPath, args, {
                cwd: instanceDir, detached: false, windowsHide: false
            })

            logger.info('Minecraft process started, PID:', this.gameProcess.pid)
            if (progressCallback) progressCallback({ type: 'started', message: 'Minecraft iniciado correctamente', pid: this.gameProcess.pid })

            this.gameProcess.stdout.on('data', (data) => {
                const output = data.toString().trim()
                if (progressCallback) progressCallback({ type: 'stdout', data: output })
            })

            this.gameProcess.stderr.on('data', (data) => {
                const output = data.toString().trim()
                if (progressCallback) progressCallback({ type: 'stderr', data: output })
            })

            this.gameProcess.on('close', (code) => {
                this.gameProcess = null
                if (progressCallback) progressCallback({ type: 'exit', code })
            })

            this.gameProcess.on('error', (err) => {
                this.gameProcess = null
                if (progressCallback) {
                    progressCallback({ type: 'error', error: err.message, code: err.code || ERROR_CODE.UNKNOWN })
                }
            })

            return { pid: this.gameProcess.pid }
        } catch (err) {
            logger.error('Launch failed:', err)
            if (progressCallback) {
                progressCallback({ type: 'error', error: err.message, code: err.code || ERROR_CODE.UNKNOWN })
            }
            throw err
        }
    }

    static killGame() {
        if (this.gameProcess) {
            this.gameProcess.kill()
            this.gameProcess = null
        }
    }
}

export default LaunchManager
