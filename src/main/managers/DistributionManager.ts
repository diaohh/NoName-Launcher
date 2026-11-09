import { downloadQueue, getExpectedDownloadSize, HashAlgo } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import ManifestManager from './ManifestManager'
import Logger from '../utils/Logger'
import { hashFile, validateLocalFile } from '../utils/FileUtils'
import { compileIgnore, resolvePolicy, strictRoots } from '../../shared/PackPolicy'
import { isSafeRelativePath, resolveInside } from '../utils/PathUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { isSha256Hex } from '../../shared/guards'
import type { StepProgress } from '../../shared/launchProgress'
import type { ManifestPointer, ModpackRam } from '../../shared/modpack'
import type { ManifestFile, PackManifest } from '../types/manifest'
import path from 'path'
import fs from 'fs-extra'

const logger = Logger.getLogger('DistributionManager')

const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

const STATE_FILE = '.nnl-state.json'
const STATE_VERSION = 1

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value)

/**
 * The part of the modpack document main reads (`Modpack` in `shared/modpack` is the whole
 * of it), checked by `parseServerData`.
 */
export interface ServerData {
    id: string
    name: string
    maintenance: boolean
    maintenanceMessage: string | null
    /** Null when the document has no usable pointer; the launch stops with MANIFEST_MISSING. */
    manifest: ManifestPointer | null
    /** Only values the JVM can read (`4G`, `4096M`); anything else leaves the launcher's own. */
    java: ModpackRam
}

/** The selected modpack. Wrapped because the launch flow has always read `rawServer`. */
export interface SelectedServer {
    rawServer: ServerData
}

/** What the launcher wrote into an instance: per path, the hash it verified and the file's stat. */
interface StateEntry {
    hash: string
    size: number
    mtimeMs: number
}

/** `seed` files the launcher never wrote are kept with a null entry until they are cleaned up. */
type InstanceState = Record<string, StateEntry | null>

export interface SyncPlan {
    toDownload: ManifestFile[]
    toDelete: string[]
    state: InstanceState
}

type ProgressCallback = (progress: StepProgress) => void

/**
 * Keeps a modpack instance in sync with its published manifest.
 *
 * The manifest is the only source of truth for what the instance should contain.
 * Firestore holds the pointer to it and the modpack's display data.
 */
class DistributionManager {

    static selectedServer: SelectedServer | null = null

    /**
     * Stores the modpack document sent by the renderer. `modules` no longer exists:
     * everything about files and the mod loader now comes from the manifest.
     */
    static async setServerData(serverData: unknown): Promise<boolean> {
        const rawServer = this.parseServerData(serverData)
        this.selectedServer = { rawServer }
        logger.info('Server data set from Firestore:', rawServer.name)
        ConfigManager.setSelectedServer(rawServer.id)
        await ConfigManager.save()
        return true
    }

    /**
     * The fields of the modpack document main uses. It arrives from the renderer, which read
     * it from Firestore, so neither the IPC boundary nor the network can be trusted with it:
     * the id must be a safe directory name (MODPACK_INVALID otherwise), and an optional field
     * of the wrong type is dropped rather than carried into the launch — a RAM value the JVM
     * cannot read used to reach `-Xmx` as it was, and abort the game before it printed anything.
     */
    static parseServerData(serverData: unknown): ServerData {
        const data = isPlainObject(serverData) ? serverData : {}
        const id = data.id
        // The id becomes a directory name, so it is checked before anything is stored.
        this.instanceDirFor(id)

        const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
        const ram = (value: unknown) => (typeof value === 'string' && ConfigManager.parseRamToMB(value) != null ? value : undefined)

        const manifest = data.manifest
        const java = isPlainObject(data.java) ? data.java : {}

        return {
            id: id as string,
            name: text(data.name) ?? (id as string),
            maintenance: Boolean(data.maintenance),
            maintenanceMessage: text(data.maintenanceMessage),
            // The hash names the manifest's cache file: anything but a sha256 is dropped here.
            manifest: isPlainObject(manifest) && typeof manifest.url === 'string' && isSha256Hex(manifest.hash)
                ? { url: manifest.url, hash: manifest.hash, version: text(manifest.version) ?? undefined }
                : null,
            java: { minRam: ram(java.minRam), maxRam: ram(java.maxRam) }
        }
    }

    static getSelectedServer(): SelectedServer | null { return this.selectedServer }

    static getInstanceDir(server: SelectedServer): string {
        return this.instanceDirFor(server.rawServer.id)
    }

    /**
     * `instances/<id>`. The id arrives from the renderer (it is the Firestore document id),
     * so it must be exactly one safe path segment.
     */
    static instanceDirFor(id: unknown): string {
        if (typeof id !== 'string' || id.includes('/') || !isSafeRelativePath(id)) {
            throw new LauncherError(ERROR_CODE.MODPACK_INVALID, `El identificador del modpack no es valido: ${JSON.stringify(id)}`)
        }
        return resolveInside(ConfigManager.getInstanceDirectory(), id)
    }

    // ------------------------------------------------------------------- state

    /**
     * Records what the launcher itself wrote, so an unchanged instance can be
     * verified by size and mtime instead of re-hashing hundreds of megabytes.
     */
    static readState(instanceDir: string): InstanceState {
        const statePath = path.join(instanceDir, STATE_FILE)
        try {
            const state = fs.readJsonSync(statePath)
            if (state.version !== STATE_VERSION) return {}
            // The launcher's own file. An entry that is not what it wrote can only fail the
            // comparison in `planSync`, which costs a re-hash, never a wrong answer.
            return (state.files || {}) as InstanceState
        } catch {
            return {}
        }
    }

    static writeState(instanceDir: string, files: InstanceState): void {
        const statePath = path.join(instanceDir, STATE_FILE)
        try {
            fs.ensureDirSync(instanceDir)
            fs.writeJsonSync(statePath, { version: STATE_VERSION, files })
        } catch (err) {
            // The state file is an optimization: losing it costs a re-hash, not correctness.
            logger.warn('Could not write instance state:', err instanceof Error ? err.message : err)
        }
    }

    static stateEntry(filePath: string, hash: string): StateEntry {
        const stats = fs.statSync(filePath)
        return { hash, size: stats.size, mtimeMs: stats.mtimeMs }
    }

    // -------------------------------------------------------------------- plan

    /**
     * Compares the instance against the manifest.
     *
     * @param progressCallback Receives `{ current, total, message }`; the launch `type`
     * is added by LaunchManager, which is the layer that knows it.
     */
    static async planSync(server: SelectedServer, manifest: PackManifest, progressCallback?: ProgressCallback): Promise<SyncPlan> {
        const instanceDir = this.getInstanceDir(server)
        const state = this.readState(instanceDir)
        const nextState: InstanceState = {}

        const toDownload: ManifestFile[] = []
        let checked = 0

        for (const entry of manifest.files) {
            checked++
            if (progressCallback && checked % 10 === 0) {
                progressCallback({
                    current: checked,
                    total: manifest.files.length,
                    message: `Validando archivos... ${checked}/${manifest.files.length}`
                })
            }

            const filePath = resolveInside(instanceDir, entry.path)

            if (!fs.existsSync(filePath)) {
                toDownload.push(entry)
                continue
            }

            // `seed` files belong to the player once they exist (options.txt, servers.dat).
            if (entry.policy === 'seed') {
                nextState[entry.path] = state[entry.path] || null
                continue
            }

            const stats = fs.statSync(filePath)
            if (stats.isDirectory()) {
                toDownload.push(entry)
                continue
            }

            const known = state[entry.path]
            const unchanged = known
                && known.hash === entry.hash
                && known.size === stats.size
                && known.mtimeMs === stats.mtimeMs

            if (unchanged) {
                nextState[entry.path] = known
                continue
            }

            if (await hashFile(filePath, 'sha256') === entry.hash) {
                nextState[entry.path] = this.stateEntry(filePath, entry.hash)
                continue
            }

            toDownload.push(entry)
        }

        const toDelete = this.findOrphans(manifest, instanceDir)

        logger.info(`Sync plan: ${toDownload.length} to download, ${toDelete.length} to delete`)
        return { toDownload, toDelete, state: nextState }
    }

    /**
     * Files the launcher must remove: anything inside a `strict` path that the manifest
     * does not declare. Everything else on the player's disk is left alone, and the
     * manifest's `ignore` globs are honoured here too — otherwise runtime-generated
     * files such as `*.cache.json` would be deleted and recreated on every launch.
     */
    static findOrphans(manifest: PackManifest, instanceDir: string): string[] {
        const declared = new Set(manifest.files.map(f => f.path))
        const isIgnored = compileIgnore(manifest.ignore)
        const orphans: string[] = []

        for (const root of strictRoots(manifest.policies)) {
            const rootDir = resolveInside(instanceDir, root)
            if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) continue

            for (const relPath of this.walk(rootDir, instanceDir)) {
                if (declared.has(relPath) || isIgnored(relPath)) continue

                // A file inside a strict root can still be covered by a more specific
                // rule (a `seed` file living under `config/`, say). Only delete when
                // the policy that actually applies is strict.
                const match = resolvePolicy(relPath, manifest.policies)
                if (match?.policy !== 'strict') continue

                orphans.push(relPath)
            }
        }

        return orphans
    }

    /** Relative POSIX paths of every file under `dir`, expressed against `base`. */
    static walk(dir: string, base: string, out: string[] = []): string[] {
        for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, dirent.name)
            if (dirent.isDirectory()) this.walk(full, base, out)
            else if (dirent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
        }
        return out
    }

    // ------------------------------------------------------------------- apply

    static async applySync(
        server: SelectedServer,
        manifest: PackManifest,
        baseUrl: string,
        plan: SyncPlan,
        progressCallback?: ProgressCallback
    ): Promise<void> {
        const instanceDir = this.getInstanceDir(server)
        const state: InstanceState = { ...plan.state }

        for (const relPath of plan.toDelete) {
            // Never step outside the instance, whatever the manifest claims.
            let filePath
            try {
                filePath = resolveInside(instanceDir, relPath)
            } catch {
                logger.warn(`Refusing to delete outside the instance: ${relPath}`)
                continue
            }
            await fs.remove(filePath)
            delete state[relPath]
            logger.info(`Removed orphan: ${relPath}`)
        }

        // Nothing countable is downloaded yet, so the phase sits at its floor (ADR-0005).
        // Reporting the deletions as current/total would fill the slice and freeze the bar there
        // until the download caught up.
        if (plan.toDelete.length > 0 && progressCallback) {
            progressCallback({ current: 0, total: 0, message: `Eliminados ${plan.toDelete.length} archivos obsoletos` })
        }

        if (plan.toDownload.length > 0) {
            const downloads = plan.toDownload.map(entry => ({
                id: entry.path,
                hash: entry.hash,
                algo: HashAlgo.SHA256,
                size: entry.size,
                url: ManifestManager.fileUrl(baseUrl, entry.path),
                path: resolveInside(instanceDir, entry.path)
            }))

            const totalSize = getExpectedDownloadSize(downloads)

            await downloadQueue(downloads, (received) => {
                if (progressCallback) {
                    progressCallback({
                        current: received,
                        total: totalSize,
                        message: `Descargando archivos del modpack... ${toMB(received)} MB / ${toMB(totalSize)} MB`
                    })
                }
            })

            for (const download of downloads) {
                if (!await validateLocalFile(download.path, download.algo, download.hash)) {
                    throw new Error(`El archivo ${download.id} no coincide con el checksum esperado`)
                }
                state[download.id] = this.stateEntry(download.path, download.hash)
            }

            logger.info(`Downloaded ${downloads.length} modpack files`)
        }

        for (const key of Object.keys(state)) {
            if (state[key] == null) delete state[key]
        }

        this.writeState(instanceDir, state)
    }
}

export default DistributionManager
