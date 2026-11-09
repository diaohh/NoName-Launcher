import child_process, { type ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { validateSelectedJvm, latestOpenJDK, extractJdk, javaExecFromRoot, ensureJavaDirIsRoot, discoverBestJvmInstallation } from 'helios-core/java'
import { downloadFile, downloadQueue, getExpectedDownloadSize, HashAlgo, type Asset } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import AuthManager from './AuthManager'
import DistributionManager, { type SelectedServer } from './DistributionManager'
import ManifestManager from './ManifestManager'
import ModLoaderManager from './ModLoaderManager'
import MinecraftDownloadManager from './MinecraftDownloadManager'
import Logger from '../utils/Logger'
import { validateLocalFile } from '../utils/FileUtils'
import { mavenToRelativePath, mavenToUrl } from '../utils/MavenUtils'
import { resolveInside } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { readLines } from '../utils/GameOutput'
import { createStartupTracker, type StartupTracker } from '../utils/StartupTracker'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError, errorCodeOf } from '../../shared/LauncherError'
import type { LaunchProgress } from '../../shared/launchProgress'
import type { LaunchStarted, LaunchStatus } from '../../shared/ipcContract'
import type { Account } from '../types/config'
import type { Argument, Library, Rule, VersionJson } from '../types/minecraft'

const logger = Logger.getLogger('LaunchManager')

const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value)

type ProgressCallback = (progress: LaunchProgress) => void

/** What the command line needs from the account; the rest of it never reaches the game. */
export type LaunchAccount = Pick<Account, 'displayName' | 'uuid' | 'accessToken'>

/** A library's artifact in one shape, whichever of the two the manifest declared it in. */
export interface ResolvedArtifact {
    relativePath: string
    url: string | null
    sha1: string | null
    size: number
}

/** The values `${placeholders}` are filled from. A null one drops the argument. */
type ArgContext = Record<string, string | null | undefined>

/** What `running-game.json` records between the spawn and `close`. */
export interface RunningGame {
    pid: number
    gameDir: string
}

// Minecraft 1.17 introduced the `arguments` manifest format and stopped shipping
// natives as library classifiers. Older releases would need a separate code path.
const MIN_SUPPORTED_MINOR = 17

/** A `.sha1` file is 40 bytes; if it takes longer than this the maven is not answering. */
const SHA1_TIMEOUT_MS = 15 * 1000

/** PowerShell's first start on a cold machine is slow; past this the orphan check gives way. */
const ORPHAN_CHECK_TIMEOUT_MS = 15 * 1000

/**
 * The launcher features version manifests can condition arguments on. Anything not listed
 * is off — demo mode, Quick Play — which is what keeps those argument blocks out.
 */
const LAUNCH_FEATURES: Readonly<Record<string, boolean>> = {
    has_custom_resolution: true
}

/** Mojang's spelling of the platform in `rules[].os`. */
const MOJANG_OS: Partial<Record<string, string>> = { win32: 'windows', darwin: 'osx', linux: 'linux' }
const MOJANG_ARCH: Partial<Record<string, string>> = { ia32: 'x86', x64: 'x86_64', arm64: 'arm64' }

/** An argument that is nothing but one placeholder, like the value half of `--xuid ${auth_xuid}`. */
const BARE_PLACEHOLDER = /^\$\{[^}]+\}$/

/**
 * One progress shape for the whole launch flow: every callback in the chain takes a
 * single object, `{ current, total, message }`.
 *
 * The managers underneath report only their own numbers — they have no idea which launch
 * phase they are being run for. LaunchManager is the one layer that knows, so it is the
 * one that adds `type`, and `type` is what LaunchContext switches on. Mixing
 * `(current, total, msg)` with `{ type, message }` in the same chain is what this
 * replaces.
 */
class LaunchManager {

    static gameProcess: ChildProcess | null = null

    /** Drives the second progress bar while the game starts up; null once it has exited. */
    static startupTracker: StartupTracker | null = null

    /**
     * Held for the length of the preparation, which is everything up to the spawn. Once the
     * game is up `gameProcess` is the lock; between the two there is nothing else, and two
     * concurrent flows would sync the same instance directory against each other and leave
     * the first process orphaned when the second overwrote `gameProcess`.
     */
    static launchInProgress = false

    static assertSupportedVersion(minecraftVersion: string): void {
        const [major, minor] = minecraftVersion.split('.').map(part => parseInt(part))

        if (major === 1 && minor !== undefined && minor < MIN_SUPPORTED_MINOR) {
            throw new LauncherError(
                ERROR_CODE.UNSUPPORTED_MC_VERSION,
                `Minecraft ${minecraftVersion} no es compatible con este launcher. ` +
                `Solo se admiten versiones 1.${MIN_SUPPORTED_MINOR} o superiores.`
            )
        }
    }

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

    /**
     * Normalizes the two library formats found in version manifests: Mojang/Forge
     * declare `downloads.artifact`, Fabric declares a Maven `name` plus a repository
     * `url`. Returns null when the library carries no downloadable artifact.
     */
    static resolveLibraryArtifact(lib: Library): ResolvedArtifact | null {
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
    static libraryKey(lib: Library, artifact: ResolvedArtifact): string {
        if (!lib.name) return artifact.relativePath

        const [group, artifactId, , classifier] = lib.name.split(':')
        return classifier ? `${group}:${artifactId}:${classifier}` : `${group}:${artifactId}`
    }

    static async downloadModLoaderLibraries(versionString: string, progressCallback?: ProgressCallback): Promise<void> {
        try {
            const commonDir = ConfigManager.getCommonDirectory()
            const librariesDir = path.join(commonDir, 'libraries')
            const versionJsonPath = ConfigManager.getVersionJsonPath(versionString)

            if (!fs.existsSync(versionJsonPath)) {
                logger.warn(`Version JSON not found for ${versionString}, skipping`)
                return
            }

            const versionData: VersionJson = await fs.readJson(versionJsonPath)
            const pending: Asset[] = []

            for (const lib of versionData.libraries || []) {
                if (!this.rulesAllow(lib.rules)) continue

                const artifact = this.resolveLibraryArtifact(lib)
                if (!artifact) continue

                const libPath = resolveInside(librariesDir, artifact.relativePath)

                // Without a hash, "the file exists" is all validateLocalFile can check — and
                // helios writes straight to the final path, so a download cut short leaves a
                // truncated jar that would pass forever. Fabric Meta omits the hash for the
                // loader and intermediary jars, so it is taken from the maven instead.
                const sha1 = artifact.sha1 || await this.fetchPublishedSha1(artifact.url, lib.name)

                if (!sha1 && fs.existsSync(libPath)) {
                    logger.warn(`Library ${lib.name} has no published hash, using the local copy unverified`)
                    continue
                }

                if (await validateLocalFile(libPath, HashAlgo.SHA1, sha1)) continue

                // Loader libraries generated locally by the installer have no URL.
                if (!artifact.url) {
                    logger.warn(`Library ${lib.name} has no download URL and is missing locally`)
                    continue
                }

                pending.push({
                    id: lib.name ?? artifact.relativePath,
                    // helios never reads it, and `validateLocalFile` below treats an empty
                    // hash like a missing one: the file existing is all it can check.
                    hash: sha1 ?? '',
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
                    progressCallback({
                        type: 'download_libraries',
                        current: received,
                        total: totalSize,
                        message: `Descargando librerias... ${toMB(received)} MB / ${toMB(totalSize)} MB`
                    })
                }
            })

            const failed: string[] = []
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

    /**
     * The sha1 a Maven repository publishes next to an artifact (`<artifact>.sha1`), or null
     * when there is none or it cannot be fetched. Null is not fatal: the caller decides
     * whether an unverified local copy is acceptable.
     */
    static async fetchPublishedSha1(artifactUrl: string | null, name: string | undefined): Promise<string | null> {
        if (!artifactUrl) return null

        try {
            const response = await fetchWithTimeout(`${artifactUrl}.sha1`, `el hash de ${name}`, { timeoutMs: SHA1_TIMEOUT_MS })
            if (!response.ok) {
                logger.warn(`No published sha1 for ${name} (HTTP ${response.status})`)
                return null
            }

            // Some repositories append the file name after the hash.
            const sha1 = ((await response.text()).trim().split(/\s+/)[0] ?? '').toLowerCase()
            return /^[0-9a-f]{40}$/.test(sha1) ? sha1 : null
        } catch (err) {
            logger.warn(`Could not fetch the published sha1 of ${name}`, err)
            return null
        }
    }

    static async readVersionJson(versionId: string): Promise<VersionJson> {
        const versionJsonPath = ConfigManager.getVersionJsonPath(versionId)
        if (!fs.existsSync(versionJsonPath)) {
            logger.error(`Version manifest not found: ${versionJsonPath}`)
            throw new LauncherError(
                ERROR_CODE.VERSION_JSON_MISSING,
                `Falta el manifiesto de la version ${versionId}. Vuelve a lanzar para descargarlo.`
            )
        }
        return await fs.readJson(versionJsonPath)
    }

    /**
     * Resolves a version manifest, merging it with its `inheritsFrom` parent when
     * the version belongs to a mod loader.
     *
     * @returns The merged manifest and the vanilla version id, which is what the client jar
     * and assets are keyed by.
     */
    static async loadVersionManifest(versionId: string): Promise<{ versionData: VersionJson, vanillaVersion: string }> {
        const versionData = await this.readVersionJson(versionId)

        if (!versionData.inheritsFrom) {
            return { versionData, vanillaVersion: versionId }
        }

        const parentData = await this.readVersionJson(versionData.inheritsFrom)
        const merged: VersionJson = {
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

    /**
     * Fills `${placeholders}` from the context. Returns null when any of them has no value:
     * passing `${clientid}` to the game verbatim is never right, and the caller decides what
     * to drop instead.
     */
    static processArgTemplate(arg: string, argContext: ArgContext): string | null {
        let unresolved = false
        const filled = arg.replace(/\$\{([^}]+)\}/g, (match, key) => {
            if (Object.hasOwn(argContext, key) && argContext[key] != null) return String(argContext[key])
            unresolved = true
            return match
        })
        return unresolved ? null : filled
    }

    /** The OS version Mojang's `os.version` patterns are written against. */
    static systemVersion(): string {
        // Electron's reports the product version (macOS 14.2, Windows 10.0.22631); os.release()
        // is the kernel's, which on macOS is a Darwin number no Mojang rule was written for.
        return typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release()
    }

    static ruleMatches(rule: Rule, features: Readonly<Record<string, boolean>>): boolean {
        const ruleOs = rule.os
        if (ruleOs) {
            if (ruleOs.name && ruleOs.name !== (MOJANG_OS[process.platform] ?? process.platform)) return false
            if (ruleOs.arch && ruleOs.arch !== (MOJANG_ARCH[process.arch] ?? process.arch)) return false
            if (ruleOs.version) {
                try {
                    if (!new RegExp(ruleOs.version).test(this.systemVersion())) return false
                } catch {
                    return false
                }
            }
        }

        if (rule.features) {
            for (const [feature, expected] of Object.entries(rule.features)) {
                if ((features[feature] ?? false) !== expected) return false
            }
        }

        return true
    }

    /**
     * Mojang's rule semantics, for libraries and arguments alike: with no rules the entry
     * applies; with rules it starts out **disallowed** and every matching rule overwrites the
     * verdict, so the last match wins. Returning on the first match, as this used to, ignored
     * `os.arch` (the x86-only `-Xss1M` landed on x64) and turned lwjgl's "allow, then
     * disallow osx" pair in 1.17–1.18 into "allow everywhere".
     */
    static rulesAllow(rules: Rule[] | undefined, features = LAUNCH_FEATURES): boolean {
        if (!Array.isArray(rules) || rules.length === 0) return true

        let allowed = false
        for (const rule of rules) {
            if (this.ruleMatches(rule, features)) allowed = rule.action === 'allow'
        }
        return allowed
    }

    /**
     * Expands one `arguments.jvm`/`arguments.game` list onto `args`.
     *
     * A value whose placeholder has no source is dropped, and when it is a bare placeholder
     * the `--flag` right before it goes too: 1.20 ships `--clientId ${clientid}` and
     * `--xuid ${auth_xuid}`, and the launcher has neither (the XSTS token it requests carries
     * no xid). Both are optional for the game.
     *
     * A value that is not a string is skipped: `spawn` would refuse the whole command over it.
     *
     * @returns The flags and values that were dropped, for the log.
     */
    static appendArguments(args: string[], argList: Argument[], argContext: ArgContext): string[] {
        const dropped: string[] = []

        for (const arg of argList) {
            if (typeof arg !== 'string' && !this.rulesAllow(arg.rules)) continue

            const values: unknown[] = typeof arg === 'string' ? [arg] : [arg.value ?? []].flat()
            for (const value of values) {
                if (typeof value !== 'string') continue

                const filled = this.processArgTemplate(value, argContext)
                if (filled !== null) {
                    args.push(filled)
                    continue
                }

                const previous = args[args.length - 1]
                if (BARE_PLACEHOLDER.test(value) && typeof previous === 'string' && previous.startsWith('--')) {
                    args.pop()
                    dropped.push(previous)
                }
                dropped.push(value)
            }
        }

        return dropped
    }

    static async buildLaunchCommand(account: LaunchAccount, versionId: string, server: SelectedServer | null): Promise<string[]> {
        const { versionData, vanillaVersion } = await this.loadVersionManifest(versionId)

        if (!versionData.arguments) {
            throw new LauncherError(
                ERROR_CODE.UNSUPPORTED_MANIFEST,
                `El manifiesto de ${versionId} usa el formato antiguo (minecraftArguments), que no es compatible con este launcher.`
            )
        }

        const commonDir = ConfigManager.getCommonDirectory()
        const gameDir = server ? DistributionManager.getInstanceDir(server) : ConfigManager.getInstanceDirectory()
        const assetsDir = path.join(commonDir, 'assets')
        const librariesDir = path.join(commonDir, 'libraries')
        const nativesDir = path.join(gameDir, 'natives')

        // Vanilla libraries come first in the merged manifest and the loader's come
        // after, so a later entry for the same artifact overrides the earlier one.
        // Without this the classpath would carry two versions of asm, guava or log4j
        // and the vanilla one would win.
        const librariesByArtifact = new Map<string, string>()
        for (const lib of versionData.libraries ?? []) {
            if (!this.rulesAllow(lib.rules)) continue
            const artifact = this.resolveLibraryArtifact(lib)
            if (!artifact) continue
            librariesByArtifact.set(this.libraryKey(lib, artifact), resolveInside(librariesDir, artifact.relativePath))
        }

        const libraries = [...librariesByArtifact.values()]

        // The client jar always belongs to the vanilla version, even when launching a
        // mod loader profile such as `1.20.1-forge-47.2.0`.
        const clientJar = path.join(ConfigManager.getVersionDirectory(vanillaVersion), `${vanillaVersion}.jar`)
        libraries.push(clientJar)

        const classpath = libraries.join(process.platform === 'win32' ? ';' : ':')

        const argContext: ArgContext = {
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

        // The modpack's own allocation is tuned for its mod list, so it wins — but only
        // while the player leaves that preference on. The slider in settings is otherwise
        // the authority.
        const useModpackRam = ConfigManager.getUseModpackRam()
        const maxRAM = (useModpackRam && server?.rawServer.java.maxRam) || ConfigManager.getMaxRAM()
        const minRAM = (useModpackRam && server?.rawServer.java.minRam) || ConfigManager.getMinRAM()

        // A modpack can declare an inconsistent pair, and nothing validates it on the way in.
        // `-Xms` above `-Xmx` aborts the JVM before it prints anything, so the floor is never
        // allowed to win over the ceiling.
        const maxMb = ConfigManager.parseRamToMB(maxRAM)
        const minMb = ConfigManager.parseRamToMB(minRAM)
        const effectiveMinRAM = (maxMb != null && minMb != null && minMb > maxMb) ? maxRAM : minRAM

        const args = ['-Xmx' + maxRAM, '-Xms' + effectiveMinRAM]

        const dropped = this.appendArguments(args, versionData.arguments.jvm || [], argContext)

        args.push('-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M')
        args.push(versionData.mainClass)

        dropped.push(...this.appendArguments(args, versionData.arguments.game || [], argContext))

        if (dropped.length > 0) {
            logger.info(`Dropped launch arguments with no value: ${dropped.join(' ')}`)
        }

        if (ConfigManager.getFullscreen()) {
            args.push('--fullscreen')
        }

        return args
    }

    static async launchMinecraft(progressCallback?: ProgressCallback): Promise<LaunchStarted> {
        // Checked before the try, and deliberately not reported through `progressCallback`:
        // an `{type:'error'}` event here would drive LaunchContext into its error state and
        // tear down the UI of the launch that is actually running.
        if (this.launchInProgress || this.gameProcess != null) {
            logger.warn('Refused a concurrent launch')
            throw new LauncherError(ERROR_CODE.LAUNCH_ALREADY_RUNNING, 'Ya hay un lanzamiento en curso o Minecraft ya esta abierto.')
        }

        this.launchInProgress = true

        try {
            // The game outlives the launcher, so one may still be running from a previous
            // session that this process knows nothing about. Syncing the instance under it
            // would rewrite jars it has open; starting a second one would fight over saves.
            const orphan = await this.findOrphanGame()
            if (orphan) {
                throw new LauncherError(
                    ERROR_CODE.LAUNCH_ALREADY_RUNNING,
                    'Minecraft sigue abierto desde una sesion anterior del launcher. Cierralo antes de volver a jugar.'
                )
            }

            if (progressCallback) progressCallback({ type: 'auth', message: 'Validando cuenta...' })

            const validation = await AuthManager.validateSelectedMicrosoftAccount()
            if (!validation.ok) {
                // The renderer decides whether to bounce the player to the login screen
                // from `code`, not from this text, so a recoverable failure can keep its
                // own message: a network blip must not read like a dead session.
                throw new LauncherError(
                    validation.code,
                    AuthManager.isTerminalError(validation.code)
                        ? 'Tu sesion ha caducado. Vuelve a iniciar sesion.'
                        : validation.message
                )
            }

            const account = AuthManager.getSelectedAccount()
            if (!account) {
                throw new LauncherError(ERROR_CODE.AUTH_NO_ACCOUNT, 'No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.')
            }

            const server = DistributionManager.getSelectedServer()
            if (!server) {
                throw new LauncherError(ERROR_CODE.LAUNCH_NO_SERVER, 'No hay ningun modpack seleccionado.')
            }

            // The renderer re-reads the modpack document right before launching, so this
            // is the current value, not whatever was cached when the list was loaded.
            if (server.rawServer.maintenance) {
                throw new LauncherError(
                    ERROR_CODE.MODPACK_MAINTENANCE,
                    server.rawServer.maintenanceMessage
                    || 'El modpack esta en mantenimiento. Intentalo de nuevo en unos minutos.'
                )
            }

            logger.info('Launching server:', server.rawServer.name)

            if (progressCallback) progressCallback({ type: 'manifest', message: 'Descargando manifest del modpack...' })
            const { manifest, baseUrl } = await ManifestManager.fetch(server.rawServer.manifest)

            // The manifest is authoritative for launching; the Firestore field of the
            // same name exists only so the sidebar can show a version without fetching it.
            const minecraftVersion = manifest.minecraft.version
            this.assertSupportedVersion(minecraftVersion)

            if (progressCallback) progressCallback({ type: 'validation', message: 'Validando archivos del modpack...' })

            const plan = await DistributionManager.planSync(server, manifest, (progress) => {
                if (progressCallback) progressCallback({ type: 'validation', ...progress })
            })

            if (plan.toDownload.length > 0 || plan.toDelete.length > 0) {
                if (progressCallback) {
                    progressCallback({
                        type: 'download_mods',
                        message: `Actualizando modpack: ${plan.toDownload.length} archivos nuevos, ${plan.toDelete.length} obsoletos...`
                    })
                }
            }

            await DistributionManager.applySync(server, manifest, baseUrl, plan, (progress) => {
                if (progressCallback) progressCallback({ type: 'download_mods', ...progress })
            })

            if (progressCallback) progressCallback({ type: 'download', message: 'Preparando descarga de Minecraft...' })

            const vanillaManifest = await MinecraftDownloadManager.downloadMinecraft(minecraftVersion, (progress) => {
                if (progressCallback) {
                    progressCallback({
                        ...progress,
                        type: 'download',
                        phase: MinecraftDownloadManager.getPhaseDisplayName(progress.phase)
                    })
                }
            })

            // Java must be available before the mod loader step: the Forge installer runs on a JVM.
            if (progressCallback) progressCallback({ type: 'java', message: 'Validando Java...' })

            const requiredJavaVersion = this.getRequiredJavaVersion(minecraftVersion, vanillaManifest)
            const javaPath = await this.ensureJava(requiredJavaVersion, progressCallback)

            const loader = manifest.loader
            const loaderType = ModLoaderManager.detectModLoader(loader)
            const versionString = ModLoaderManager.getVersionString(loader, minecraftVersion)
            const instanceDir = DistributionManager.getInstanceDir(server)

            if (loaderType !== 'vanilla') {
                if (!ModLoaderManager.isModLoaderInstalled(loader, minecraftVersion)) {
                    if (progressCallback) progressCallback({ type: 'modloader', message: `Instalando ${loaderType}...` })
                    await ModLoaderManager.installModLoader(loader, minecraftVersion, javaPath, instanceDir, (progress) => {
                        if (progressCallback) progressCallback({ type: 'modloader', ...progress })
                    })
                }

                // Its own phase, not `download`: the vanilla download already used that
                // one earlier in the flow, and a phase that appears twice makes the
                // progress bar run backwards.
                if (progressCallback) progressCallback({ type: 'download_libraries', message: `Descargando librerias de ${loaderType}...` })
                await this.downloadModLoaderLibraries(versionString, progressCallback)
            }

            if (progressCallback) progressCallback({ type: 'launch', message: 'Construyendo comando de lanzamiento...' })

            const args = await this.buildLaunchCommand(account, versionString, server)

            if (progressCallback) progressCallback({ type: 'launch', message: 'Iniciando Minecraft...' })

            await fs.ensureDir(instanceDir)
            await fs.ensureDir(path.join(instanceDir, 'natives'))

            const normalizedJavaPath = path.normalize(javaPath)
            // Detached, so the game outlives the launcher (ADR-0013). Without it Windows puts
            // the child in libuv's kill-on-close job object, and closing the launcher killed
            // the game with everything that had not been saved. `windowsHide` stays off: it
            // reaches the JVM as the show flag of its first window, which is the game's own.
            const child = child_process.spawn(normalizedJavaPath, args, {
                cwd: instanceDir, detached: true, windowsHide: false
            })

            // `spawn` returns before the OS has tried to start anything; a missing javaw only
            // shows up afterwards as an `error` event. Waiting here keeps `started` honest and
            // lets a failure take the same path as every other launch error, below.
            await this.waitForSpawn(child, normalizedJavaPath)

            // Only undefined when the spawn failed, and `waitForSpawn` has rejected in that case.
            const pid = child.pid as number

            this.gameProcess = child
            this.recordRunningGame(pid, instanceDir)
            logger.info('Minecraft process started, PID:', pid)
            if (progressCallback) progressCallback({ type: 'started', message: 'Minecraft iniciado correctamente', pid })

            // The second bar: `started` only means the OS started the JVM, and the window
            // takes a while longer. Created after `started` so its first report lands after it.
            this.startupTracker = createStartupTracker((progress) => {
                if (progressCallback) progressCallback({ type: 'game_startup', ...progress })
            })

            const forward = (type: 'stdout' | 'stderr') => (lines: string[]) => {
                this.startupTracker?.feed(lines)
                if (progressCallback) progressCallback({ type, lines })
            }
            const flushStdout = readLines(child.stdout, forward('stdout'))
            const flushStderr = readLines(child.stderr, forward('stderr'))

            child.on('close', (code) => {
                flushStdout()
                flushStderr()
                // The latch goes with the process: the next game starts its bar from zero.
                this.startupTracker?.dispose()
                this.startupTracker = null
                this.gameProcess = null
                this.clearRunningGame()
                if (progressCallback) progressCallback({ type: 'exit', code })
            })

            // Once running, `error` only means a signal could not be delivered: the process is
            // still there, and `close` remains the one place that ends the game.
            child.on('error', (err) => {
                logger.error('Minecraft process error:', err)
            })

            return { pid }
        } catch (err) {
            logger.error('Launch failed:', err)
            if (progressCallback) {
                // The same code the IPC envelope gives the rejection (`errorCodeOf`), so the
                // event and the failed `launch:game` call never disagree.
                progressCallback({ type: 'error', error: err instanceof Error ? err.message : String(err), code: errorCodeOf(err) })
            }
            throw err
        } finally {
            this.launchInProgress = false
        }
    }

    /**
     * Resolves once the OS has started the process, or rejects with GAME_SPAWN_FAILED when it
     * could not (ENOENT, EACCES). Node still emits `close` after a failed spawn, which is why
     * the caller attaches its own `close` handler only after this resolves.
     */
    static waitForSpawn(child: ChildProcess, javaPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const onSpawn = () => {
                child.off('error', onError)
                resolve()
            }
            const onError = (err: Error) => {
                child.off('spawn', onSpawn)
                reject(new LauncherError(
                    ERROR_CODE.GAME_SPAWN_FAILED,
                    `No se ha podido iniciar Java (${javaPath}). ` +
                    'Comprueba la ruta de Java en Ajustes, o quitala para que el launcher busque uno.',
                    err
                ))
            }
            child.once('spawn', onSpawn)
            child.once('error', onError)
        })
    }

    /**
     * Asks the game to close. The `close` handler stays the only place that clears
     * `gameProcess`: nulling it here would tell `config:setDataDirectory` that no game is
     * running while the JVM is still shutting down with files open in the instance.
     */
    static killGame(): boolean {
        if (!this.gameProcess) return false

        logger.info('Killing Minecraft, PID:', this.gameProcess.pid)
        this.gameProcess.kill()
        return true
    }

    /**
     * Lets go of the game when the launcher quits. It was spawned detached, so it keeps
     * running; what goes are the pipes and the handle, which would otherwise hold the event
     * loop open. Java swallows the broken pipe (`PrintStream` only sets its error flag), which
     * was measured with a JVM writing to both streams after its parent exited.
     *
     * `running-game.json` stays on disk: it is what stops the next session from starting a
     * second game on top of this one (see `findOrphanGame`).
     */
    static releaseGame(): void {
        const child = this.gameProcess
        if (!child) return

        logger.info(`Launcher quitting, leaving Minecraft running (PID ${child.pid})`)
        this.startupTracker?.dispose()
        this.startupTracker = null
        child.removeAllListeners('close')
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.unref()
    }

    /**
     * True while this launcher has a game running, or one survives from a previous session.
     * What `config:setDataDirectory` checks before moving the root out from under it.
     */
    static async isGameRunning(): Promise<boolean> {
        return this.gameProcess != null || await this.findOrphanGame() != null
    }

    static recordRunningGame(pid: number, gameDir: string): void {
        try {
            fs.writeJsonSync(ConfigManager.getRunningGamePath(), { pid, gameDir, startedAt: Date.now() })
        } catch (err) {
            // Only the guard against a second game after a relaunch is lost.
            logger.warn('Could not record the running game', err)
        }
    }

    static clearRunningGame(): void {
        try {
            fs.removeSync(ConfigManager.getRunningGamePath())
        } catch (err) {
            logger.warn('Could not clear the running game record', err)
        }
    }

    /**
     * The game a previous launcher session left running, or null.
     *
     * A PID alone proves nothing once its process is gone: the OS hands the number out again,
     * and refusing to launch because some unrelated program inherited it would block the player
     * for no reason. So the process must also carry the instance directory on its command line,
     * which only a Minecraft started by this launcher does (`--gameDir`). A record that fails
     * either check is stale and deleted. When the command line cannot be read at all the guard
     * gives way rather than block: the cost is the behaviour from before it existed.
     */
    static async findOrphanGame(): Promise<RunningGame | null> {
        let record: unknown
        try {
            record = fs.readJsonSync(ConfigManager.getRunningGamePath())
        } catch {
            return null
        }

        // The PID is interpolated into a PowerShell command by `readCommandLine`, so it is
        // checked to be a positive integer before anything else touches it.
        const pid = isPlainObject(record) ? record.pid : undefined
        const gameDir = isPlainObject(record) ? record.gameDir : undefined
        if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && typeof gameDir === 'string' && this.isProcessAlive(pid)) {
            const commandLine = await this.readCommandLine(pid)
            if (commandLine?.includes(gameDir)) {
                logger.info(`Minecraft from a previous session is still running (PID ${pid})`)
                return { pid, gameDir }
            }
        }

        this.clearRunningGame()
        return null
    }

    static isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0)
            return true
        } catch (err) {
            // EPERM: it exists, it just belongs to someone else.
            return (err as NodeJS.ErrnoException).code === 'EPERM'
        }
    }

    /** The full command line of a process, or null when it cannot be read. */
    static readCommandLine(pid: number): Promise<string | null> {
        const [file, args]: [string, string[]] = process.platform === 'win32'
            ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]]
            : ['ps', ['-p', String(pid), '-o', 'args=']]

        return new Promise((resolve) => {
            child_process.execFile(file, args, { timeout: ORPHAN_CHECK_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
                if (err) {
                    logger.warn(`Could not read the command line of PID ${pid}`, err)
                    resolve(null)
                    return
                }
                resolve(stdout)
            })
        })
    }

    /**
     * Lets the renderer rebuild its state after a reload: without it a refresh during a
     * game leaves the UI believing nothing is running, and the kill button never appears.
     */
    static getStatus(): LaunchStatus {
        return {
            running: this.gameProcess != null,
            pid: this.gameProcess?.pid ?? null
        }
    }
}

export default LaunchManager
