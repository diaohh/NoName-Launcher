import path from 'path'
import fs from 'fs-extra'
import { validateSelectedJvm, latestOpenJDK, extractJdk, javaExecFromRoot, ensureJavaDirIsRoot, discoverBestJvmInstallation } from 'helios-core/java'
import { downloadFile, HashAlgo } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { validateLocalFile } from '../utils/FileUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import type { PhaseEvent } from '../../shared/launchProgress'
import type { VersionJson } from '../types/minecraft'

const logger = Logger.getLogger('JavaManager')

const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/**
 * Java's own sub-phases. Unlike the managers that only report numbers, this one knows which
 * of the three it is in, so it sets the `type` itself (ADR-0005 addendum).
 */
export type JavaProgress = PhaseEvent & { type: 'java_discover' | 'java_download' | 'java_extract' }

type ProgressCallback = (progress: JavaProgress) => void

/**
 * The Java a launch runs on: which major it needs, and finding, validating or downloading one.
 *
 * `settings.java.executable` is only the player's choice, used as is or refused; what the
 * launcher found or downloaded is cached per major in `settings.java.runtimes`.
 */
class JavaManager {

    /**
     * The Mojang version manifest declares the exact Java major it was built for.
     * The table is only a fallback for manifests that omit it.
     */
    static getRequiredJavaVersion(minecraftVersion: string, versionJson: VersionJson | null | undefined): number {
        const declared = versionJson?.javaVersion?.majorVersion
        if (declared) return declared

        const [, minor = 0, patch = 0] = minecraftVersion.split('.').map(part => parseInt(part) || 0)
        if (minor > 20 || (minor === 20 && patch >= 5)) return 21
        return 17
    }

    /**
     * Bounded range: a modpack built for Java 17 must not be launched on Java 21.
     */
    static javaSemverRange(majorVersion: number): string {
        return `${majorVersion}.x`
    }

    /**
     * The JDK root of an executable path. helios' `ensureJavaDirIsRoot` only recognises the
     * platform's own separator, so `C:/…/bin/javaw.exe` (a hand-edited config.json) came back
     * unchanged and never validated; normalizing first makes both spellings work.
     */
    static javaRoot(executable: string): string {
        return ensureJavaDirIsRoot(path.normalize(executable))
    }

    /**
     * The executable when it runs and satisfies the Java major, otherwise null. Never throws:
     * a missing or broken runtime only means "not this one".
     */
    static async checkJava(executable: string | null, requiredVersion: number): Promise<string | null> {
        if (!executable) return null

        try {
            const details = await validateSelectedJvm(this.javaRoot(executable), this.javaSemverRange(requiredVersion))
            if (details != null) {
                logger.info(`Java validation successful: ${executable} (${details.semverStr})`)
                return executable
            }
            logger.info(`${executable} does not satisfy Java ${requiredVersion}`)
            return null
        } catch (err) {
            logger.warn(`Could not validate Java at ${executable}`, err)
            return null
        }
    }

    /**
     * A Java chosen in the settings is the player's decision: it is used when it fits and the
     * launch stops when it does not. It used to be swapped for an auto-detected one without a
     * word, and the setting overwritten with it, so the choice did not survive a single launch
     * of a modpack on another major.
     */
    static async requireManualJava(executable: string, requiredVersion: number): Promise<string> {
        if (await this.checkJava(executable, requiredVersion)) return executable

        // Only for the message: which version the chosen one actually is, if it runs at all.
        let actual = null
        try {
            actual = await validateSelectedJvm(this.javaRoot(executable), '*')
        } catch {
            // Reported below as a Java that cannot be used.
        }

        throw new LauncherError(ERROR_CODE.JAVA_MANUAL_INCOMPATIBLE, actual
            ? `El Java elegido en Ajustes es la version ${actual.semverStr} y este modpack necesita Java ${requiredVersion}. ` +
              `Elige un Java ${requiredVersion} o quita la ruta para que el launcher use el adecuado.`
            : `No se puede usar el Java elegido en Ajustes (${executable}). ` +
              'Elige otro o quita la ruta para que el launcher use el adecuado.')
    }

    /** A Java of that major already installed on the system or in `<dataDir>/runtime`, or null. */
    static async discoverJava(version: number, progressCallback?: ProgressCallback): Promise<string | null> {
        if (progressCallback) progressCallback({ type: 'java_discover', message: `Buscando Java ${version} en el sistema...` })

        const jvm = await discoverBestJvmInstallation(ConfigManager.getDataDirectory(), this.javaSemverRange(version))
        if (jvm == null) return null

        const execPath = javaExecFromRoot(jvm.path)
        if (!fs.existsSync(execPath)) return null

        logger.info(`Found existing Java: ${jvm.path} (${jvm.semverStr})`)
        return execPath
    }

    static async downloadJava(version: number, progressCallback?: ProgressCallback): Promise<string> {
        if (!ConfigManager.getJavaAutoDownload()) {
            throw new LauncherError(
                ERROR_CODE.JAVA_UNAVAILABLE,
                `No hay una instalacion valida de Java ${version} y la descarga automatica ` +
                `esta desactivada. Activala en Ajustes o selecciona un Java ${version} manualmente.`
            )
        }

        const semverRange = this.javaSemverRange(version)
        // helios puts downloaded JDKs under `<dataDir>/runtime/<arch>` and rediscovers
        // them there, so they follow the configured data directory like every other
        // bulky artifact.
        const dataDir = ConfigManager.getDataDirectory()
        let archivePath: string | null = null

        try {
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

    /**
     * The Java this launch runs on: the player's own choice when there is one, otherwise the
     * runtime cached for this major, otherwise one discovered or downloaded — and that one is
     * cached under its major, never written over the player's setting. Alternating modpacks on
     * Java 17 and 21 used to rewrite `java.executable` on every launch.
     */
    static async ensureJava(requiredVersion: number, progressCallback?: ProgressCallback): Promise<string> {
        const manual = ConfigManager.getJavaExecutable()
        if (manual) return await this.requireManualJava(manual, requiredVersion)

        const cached = await this.checkJava(ConfigManager.getJavaRuntime(requiredVersion), requiredVersion)
        if (cached) return cached

        let executable: string
        try {
            executable = await this.discoverJava(requiredVersion, progressCallback)
                ?? await this.downloadJava(requiredVersion, progressCallback)
        } catch (err) {
            // helios-core's JavaGuard reports in English. The original is kept as the
            // cause and is already in the log; the player gets a message they can read.
            if (err instanceof LauncherError && err.code === ERROR_CODE.JAVA_UNAVAILABLE) throw err

            throw new LauncherError(
                ERROR_CODE.JAVA_UNAVAILABLE,
                `No se ha podido preparar Java ${requiredVersion}. Revisa los logs (Configuracion > Abrir carpeta de logs).`,
                err
            )
        }

        ConfigManager.setJavaRuntime(requiredVersion, executable)
        try {
            await ConfigManager.save()
        } catch {
            // Already logged by save(). The cache only saves a discovery next time; failing a
            // launch that has its Java over it would be the wrong trade.
        }
        return executable
    }
}

export default JavaManager
