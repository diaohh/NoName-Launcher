import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import { app, screen } from 'electron'
import { downloadQueue, getExpectedDownloadSize, HashAlgo, type Asset } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import DistributionManager, { type SelectedServer } from './DistributionManager'
import Logger from '../utils/Logger'
import { validateLocalFile } from '../utils/FileUtils'
import { mavenToRelativePath, mavenToUrl } from '../utils/MavenUtils'
import { resolveInside } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import type { StepProgress } from '../../shared/launchProgress'
import type { Account } from '../types/config'
import type { Argument, Library, Rule, VersionJson } from '../types/minecraft'

const logger = Logger.getLogger('LaunchCommand')

const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

type ProgressCallback = (progress: StepProgress) => void

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

/** A `.sha1` file is 40 bytes; if it takes longer than this the maven is not answering. */
const SHA1_TIMEOUT_MS = 15 * 1000

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
 * What the game is started with: the version manifest (merged with the vanilla one it
 * inherits from), its libraries in either of their two shapes, Mojang's rules, and the
 * command line built from all of it. Also downloads the libraries a mod loader adds.
 */
class LaunchCommand {

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

    /**
     * Downloads what the loader's version JSON adds on top of vanilla, checked by sha1.
     *
     * @param progressCallback Receives `{ current, total, message }`; the launch `type`
     * is added by LaunchManager, which is the layer that knows it.
     */
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

    /**
     * The size the game window is created at (`--width`/`--height`).
     *
     * Windowed, it is the one in Ajustes. In fullscreen it is the primary monitor's current
     * mode: Minecraft creates its window with `glfwCreateWindow(width, height, monitor)`, and
     * GLFW switches the monitor to the video mode closest to that size — so passing Ajustes'
     * 1280x720 flipped a 1080p screen to 720p and back, rearranging every open window. Asking
     * for the mode the monitor is already in is the one size GLFW leaves alone. Dropping the
     * flags is not a way out: the game would fall back to 854x480 and switch modes anyway.
     *
     * Minecraft opens on the primary monitor, the same one `getPrimaryDisplay()` reports.
     * GLFW counts video modes in physical pixels on Windows and Linux, and in points on macOS,
     * which is what Electron's DIP size already is there. A `fullscreenResolution` the player
     * picked in the game's Video Settings still applies, since the game switches to it after
     * the window exists.
     */
    static gameResolution(): { width: number, height: number } {
        if (!ConfigManager.getFullscreen()) {
            return { width: ConfigManager.getGameWidth(), height: ConfigManager.getGameHeight() }
        }

        const { size, scaleFactor } = screen.getPrimaryDisplay()
        const scale = process.platform === 'darwin' ? 1 : scaleFactor
        return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
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
        const resolution = this.gameResolution()

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
            resolution_width: resolution.width.toString(),
            resolution_height: resolution.height.toString(),
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
}

export default LaunchCommand
