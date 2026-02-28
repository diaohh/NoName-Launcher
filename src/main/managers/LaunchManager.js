import child_process from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import { validateSelectedJvm, latestOpenJDK, extractJdk } from 'helios-core/java'
import { downloadFile } from 'helios-core/dl'
import got from 'got'
import ConfigManager from './ConfigManager'
import AuthManager from './AuthManager'
import DistributionManager from './DistributionManager'
import ModLoaderManager from './ModLoaderManager'
import MinecraftDownloadManager from './MinecraftDownloadManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('LaunchManager')

class LaunchManager {

    static gameProcess = null

    static getRequiredJavaVersion(minecraftVersion) {
        const versionParts = minecraftVersion.split('.')
        const minor = parseInt(versionParts[1])

        if (parseInt(versionParts[0]) === 1) {
            if (minor >= 21) return 21
            if (minor >= 18) return 17
            if (minor === 17) return 16
            return 8
        }
        return 21
    }

    static async validateJava(requiredVersion = 21) {
        const javaPath = ConfigManager.getJavaExecutable()
        if (!javaPath) return null

        try {
            const vResult = await validateSelectedJvm(javaPath, requiredVersion)
            if (vResult.valid) {
                logger.info('Java validation successful:', javaPath)
                return javaPath
            }
            logger.warn('Java validation failed:', vResult.error)
            return null
        } catch (err) {
            logger.error('Java validation error:', err)
            return null
        }
    }

    static async downloadJava(version = 21, progressCallback) {
        try {
            logger.info(`Downloading Java ${version}...`)
            if (progressCallback) progressCallback({ type: 'java_download', message: `Descargando Java ${version}...` })

            const javaDir = path.join(ConfigManager.getCommonDirectory(), 'java')
            const javaData = await latestOpenJDK(version, javaDir, null)
            if (!javaData || !javaData.url) throw new Error('Failed to get Java download information')

            const fileExtension = process.platform === 'win32' ? '.zip' : '.tar.gz'
            const javaDownloadPath = path.join(javaDir, `java-download${fileExtension}`)
            await fs.ensureDir(javaDir)

            let lastPercent = 0
            await downloadFile(javaData.url, javaDownloadPath, (received, total) => {
                const percent = Math.floor((received / total) * 100)
                if (percent >= lastPercent + 5 || percent === 100) {
                    lastPercent = percent
                    const mbReceived = (received / 1024 / 1024).toFixed(1)
                    const mbTotal = (total / 1024 / 1024).toFixed(1)
                    if (progressCallback) {
                        progressCallback({ type: 'java_download', message: `Descargando Java... ${mbReceived}MB / ${mbTotal}MB`, current: received, total })
                    }
                }
            })

            const stats = await fs.stat(javaDownloadPath)
            if (stats.size < 1000000) throw new Error('Downloaded file is too small, likely an error')

            if (progressCallback) progressCallback({ type: 'java_extract', message: 'Extracting Java...' })
            await extractJdk(javaDownloadPath, javaDir)

            const extractedDirs = await fs.readdir(javaDir)
            const jdkDir = extractedDirs.find(dir => dir.startsWith('jdk-'))
            if (!jdkDir) throw new Error('JDK directory not found after extraction')

            const javaBin = process.platform === 'win32' ? 'javaw.exe' : 'java'
            const javaExecutable = path.join(javaDir, jdkDir, 'bin', javaBin)

            if (fs.existsSync(javaExecutable)) {
                ConfigManager.setJavaExecutable(javaExecutable)
                ConfigManager.save()
                await fs.remove(javaDownloadPath)
                return javaExecutable
            }
            throw new Error(`Java executable not found at ${javaExecutable}`)
        } catch (err) {
            logger.error('Java download/install failed:', err)
            throw err
        }
    }

    static async ensureJava(requiredVersion = 21, progressCallback) {
        const validJava = await this.validateJava(requiredVersion)
        if (validJava) return validJava

        if (ConfigManager.getJavaAutoDownload()) {
            return await this.downloadJava(requiredVersion, progressCallback)
        }
        throw new Error(`No valid Java ${requiredVersion} installation found and auto-download is disabled.`)
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
            const libraries = versionData.libraries || []
            let downloaded = 0

            for (const lib of libraries) {
                if (!lib.downloads || !lib.downloads.artifact) continue

                const artifact = lib.downloads.artifact
                const libPath = path.join(librariesDir, artifact.path)

                if (fs.existsSync(libPath)) {
                    downloaded++
                    if (progressCallback) progressCallback(downloaded, libraries.length, `Verificado: ${lib.name}`)
                    continue
                }

                fs.ensureDirSync(path.dirname(libPath))

                try {
                    const downloadStream = got.stream(artifact.url)
                    const fileWriterStream = fs.createWriteStream(libPath)
                    await new Promise((resolve, reject) => {
                        downloadStream.pipe(fileWriterStream)
                        fileWriterStream.on('finish', resolve)
                        fileWriterStream.on('error', reject)
                        downloadStream.on('error', reject)
                    })
                } catch (err) {
                    logger.warn(`Failed to download ${lib.name}:`, err.message)
                }

                downloaded++
                if (progressCallback) progressCallback(downloaded, libraries.length, `Descargando: ${lib.name}`)
            }
        } catch (err) {
            logger.error('Failed to download mod loader libraries:', err)
            throw err
        }
    }

    static async loadVersionManifest(minecraftVersion) {
        const commonDir = ConfigManager.getCommonDirectory()
        const versionJsonPath = path.join(commonDir, 'versions', minecraftVersion, `${minecraftVersion}.json`)

        if (!fs.existsSync(versionJsonPath)) throw new Error(`Version manifest not found: ${versionJsonPath}`)

        const versionData = await fs.readJson(versionJsonPath)

        if (versionData.inheritsFrom) {
            const parentJsonPath = path.join(commonDir, 'versions', versionData.inheritsFrom, `${versionData.inheritsFrom}.json`)
            if (!fs.existsSync(parentJsonPath)) throw new Error(`Parent version manifest not found: ${parentJsonPath}`)

            const parentData = await fs.readJson(parentJsonPath)
            return {
                ...parentData,
                ...versionData,
                libraries: [...(parentData.libraries || []), ...(versionData.libraries || [])],
                arguments: {
                    game: [...(parentData.arguments?.game || []), ...(versionData.arguments?.game || [])],
                    jvm: [...(parentData.arguments?.jvm || []), ...(versionData.arguments?.jvm || [])]
                }
            }
        }

        return versionData
    }

    static processArgTemplate(arg, argContext) {
        if (typeof arg !== 'string') return arg
        return arg.replace(/\$\{([^}]+)\}/g, (match, key) => argContext[key] || match)
    }

    static processArgumentRules(arg) {
        if (typeof arg === 'string') return true
        if (arg.rules) {
            for (const rule of arg.rules) {
                if (rule.os) {
                    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
                    if (rule.os.name && rule.os.name !== osName) return rule.action === 'disallow'
                }
                if (rule.features) return rule.action === 'disallow'
            }
        }
        return true
    }

    static async buildLaunchCommand(javaPath, account, minecraftVersion, server) {
        const versionData = await this.loadVersionManifest(minecraftVersion)
        const commonDir = ConfigManager.getCommonDirectory()
        const gameDir = server ? path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id) : ConfigManager.getInstanceDirectory()
        const assetsDir = path.join(commonDir, 'assets')
        const librariesDir = path.join(commonDir, 'libraries')
        const nativesDir = path.join(gameDir, 'natives')

        const libraries = []
        for (const lib of versionData.libraries) {
            if (lib.rules && !this.processArgumentRules(lib)) continue
            const libPath = lib.downloads?.artifact?.path
            if (libPath) libraries.push(path.join(librariesDir, libPath))
        }

        const clientJar = path.join(commonDir, 'versions', minecraftVersion, `${minecraftVersion}.jar`)
        libraries.push(clientJar)

        const classpath = libraries.join(process.platform === 'win32' ? ';' : ':')

        const argContext = {
            auth_player_name: account.displayName,
            version_name: minecraftVersion,
            game_directory: gameDir,
            assets_root: assetsDir,
            assets_index_name: versionData.assetIndex?.id || versionData.assets || minecraftVersion,
            auth_uuid: account.uuid,
            auth_access_token: account.accessToken,
            user_type: 'msa',
            version_type: versionData.type || 'release',
            resolution_width: ConfigManager.getGameWidth().toString(),
            resolution_height: ConfigManager.getGameHeight().toString(),
            natives_directory: nativesDir,
            launcher_name: 'NoNameLauncher',
            launcher_version: '1.0.0',
            classpath,
            library_directory: librariesDir,
            classpath_separator: process.platform === 'win32' ? ';' : ':'
        }

        const args = ['-Xmx' + ConfigManager.getMaxRAM(), '-Xms' + ConfigManager.getMinRAM()]

        if (versionData.arguments?.jvm) {
            for (const arg of versionData.arguments.jvm) {
                if (!this.processArgumentRules(arg)) continue
                const argValue = typeof arg === 'string' ? arg : (arg.value || [])
                for (const a of (Array.isArray(argValue) ? argValue : [argValue])) {
                    args.push(this.processArgTemplate(a, argContext))
                }
            }
        } else {
            args.push(`-Djava.library.path=${nativesDir}`, `-Dminecraft.launcher.brand=${argContext.launcher_name}`, `-Dminecraft.launcher.version=${argContext.launcher_version}`, '-cp', classpath)
        }

        args.push('-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M')
        args.push(versionData.mainClass)

        if (versionData.arguments?.game) {
            for (const arg of versionData.arguments.game) {
                if (!this.processArgumentRules(arg)) continue
                const argValue = typeof arg === 'string' ? arg : (arg.value || [])
                for (const a of (Array.isArray(argValue) ? argValue : [argValue])) {
                    args.push(this.processArgTemplate(a, argContext))
                }
            }
        } else if (versionData.minecraftArguments) {
            for (const arg of versionData.minecraftArguments.split(' ')) {
                args.push(this.processArgTemplate(arg, argContext))
            }
        }

        return args
    }

    static async launchMinecraft(progressCallback) {
        try {
            if (progressCallback) progressCallback({ type: 'auth', message: 'Validando cuenta...' })

            const isValid = await AuthManager.validateSelectedMicrosoftAccount()
            if (!isValid) {
                const error = new Error('Session expired. Please login again.')
                error.code = 'AUTH_SESSION_EXPIRED'
                throw error
            }

            const account = AuthManager.getSelectedAccount()
            if (!account) {
                const error = new Error('No account selected. Please login.')
                error.code = 'AUTH_NO_ACCOUNT'
                throw error
            }

            const server = DistributionManager.getSelectedServer()
            if (!server) throw new Error('No server selected')

            logger.info('Launching server:', server.rawServer.name)

            if (progressCallback) progressCallback({ type: 'validation', message: 'Validando archivos del servidor...' })

            const invalidFiles = await DistributionManager.validateDistribution(server, (current, total, msg) => {
                if (progressCallback) progressCallback({ type: 'validation', message: msg, current, total })
            })

            if (invalidFiles.length > 0) {
                if (progressCallback) progressCallback({ type: 'download_mods', message: `Descargando ${invalidFiles.length} archivos del servidor...` })
                await DistributionManager.downloadServerFiles(invalidFiles, (current, total, msg) => {
                    if (progressCallback) progressCallback({ type: 'download_mods', message: msg, current, total })
                })
            }

            const loaderType = ModLoaderManager.detectModLoader(server)
            if (loaderType !== 'vanilla') {
                if (!ModLoaderManager.isModLoaderInstalled(server)) {
                    if (progressCallback) progressCallback({ type: 'modloader', message: `Instalando ${loaderType}...` })
                    await ModLoaderManager.installModLoader(server, (current, total, msg) => {
                        if (progressCallback) progressCallback({ type: 'modloader', message: msg, current, total })
                    })
                }
            }

            if (progressCallback) progressCallback({ type: 'download', message: 'Preparando descarga de Minecraft...' })

            const minecraftVersion = server.rawServer.minecraftVersion
            await MinecraftDownloadManager.downloadMinecraft(minecraftVersion, (percent, phase, message) => {
                if (progressCallback) {
                    progressCallback({ type: 'download', message, phase: MinecraftDownloadManager.getPhaseDisplayName(phase), current: percent, total: 100 })
                }
            })

            if (loaderType !== 'vanilla') {
                const versionString = ModLoaderManager.getVersionString(server)
                if (progressCallback) progressCallback({ type: 'download', message: `Descargando librerias de ${loaderType}...` })
                await this.downloadModLoaderLibraries(versionString, (current, total, message) => {
                    if (progressCallback) progressCallback({ type: 'download', message: message || `Descargando librerias de ${loaderType}...`, current, total })
                })
            }

            if (progressCallback) progressCallback({ type: 'java', message: 'Validando Java...' })

            const requiredJavaVersion = this.getRequiredJavaVersion(minecraftVersion)
            const javaPath = await this.ensureJava(requiredJavaVersion, progressCallback)

            if (progressCallback) progressCallback({ type: 'launch', message: 'Construyendo comando de lanzamiento...' })

            const versionString = ModLoaderManager.getVersionString(server)
            const args = await this.buildLaunchCommand(javaPath, account, versionString, server)

            if (progressCallback) progressCallback({ type: 'launch', message: 'Iniciando Minecraft...' })

            const instanceDir = path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id)
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
                if (progressCallback) progressCallback({ type: 'error', error: err.message })
            })

            return { pid: this.gameProcess.pid }
        } catch (err) {
            logger.error('Launch failed:', err)
            if (progressCallback) progressCallback({ type: 'error', error: err.message })
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
