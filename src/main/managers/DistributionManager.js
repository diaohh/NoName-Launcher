import { downloadQueue, getExpectedDownloadSize, HashAlgo } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import ManifestManager from './ManifestManager'
import Logger from '../utils/Logger'
import { hashFile, validateLocalFile } from '../utils/FileUtils'
import { compileIgnore, resolvePolicy, strictRoots } from '../utils/PackPolicy'
import { isSafeRelativePath, resolveInside } from '../utils/PathUtils'
import { ERROR_CODE } from '../../shared/errorCodes'
import path from 'path'
import fs from 'fs-extra'

const logger = Logger.getLogger('DistributionManager')

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1)

const STATE_FILE = '.nnl-state.json'
const STATE_VERSION = 1

/**
 * Keeps a modpack instance in sync with its published manifest.
 *
 * The manifest is the only source of truth for what the instance should contain.
 * Firestore holds the pointer to it and the modpack's display data.
 */
class DistributionManager {

    static selectedServer = null

    /**
     * Stores the modpack document sent by the renderer. `modules` no longer exists:
     * everything about files and the mod loader now comes from the manifest.
     */
    static setServerData(serverData) {
        // The id becomes a directory name, so it is checked before anything is stored.
        this.instanceDirFor(serverData?.id)
        this.selectedServer = { rawServer: serverData }
        logger.info('Server data set from Firestore:', serverData.name)
        ConfigManager.setSelectedServer(serverData.id)
        ConfigManager.save()
        return true
    }

    static getSelectedServer() { return this.selectedServer }

    static getInstanceDir(server) {
        return this.instanceDirFor(server.rawServer.id)
    }

    /**
     * `instances/<id>`. The id arrives from the renderer (it is the Firestore document id),
     * so it must be exactly one safe path segment.
     */
    static instanceDirFor(id) {
        if (typeof id !== 'string' || id.includes('/') || !isSafeRelativePath(id)) {
            const error = new Error(`El identificador del modpack no es valido: ${JSON.stringify(id)}`)
            error.code = ERROR_CODE.MODPACK_INVALID
            throw error
        }
        return resolveInside(ConfigManager.getInstanceDirectory(), id)
    }

    // ------------------------------------------------------------------- state

    /**
     * Records what the launcher itself wrote, so an unchanged instance can be
     * verified by size and mtime instead of re-hashing hundreds of megabytes.
     */
    static readState(instanceDir) {
        const statePath = path.join(instanceDir, STATE_FILE)
        try {
            const state = fs.readJsonSync(statePath)
            if (state.version !== STATE_VERSION) return {}
            return state.files || {}
        } catch {
            return {}
        }
    }

    static writeState(instanceDir, files) {
        const statePath = path.join(instanceDir, STATE_FILE)
        try {
            fs.ensureDirSync(instanceDir)
            fs.writeJsonSync(statePath, { version: STATE_VERSION, files })
        } catch (err) {
            // The state file is an optimization: losing it costs a re-hash, not correctness.
            logger.warn('Could not write instance state:', err.message)
        }
    }

    static stateEntry(filePath, hash) {
        const stats = fs.statSync(filePath)
        return { hash, size: stats.size, mtimeMs: stats.mtimeMs }
    }

    // -------------------------------------------------------------------- plan

    /**
     * Compares the instance against the manifest.
     *
     * @param progressCallback Receives `{ current, total, message }`; the launch `type`
     * is added by LaunchManager, which is the layer that knows it.
     * @returns {Promise<{toDownload: Array, toDelete: Array, state: object}>}
     */
    static async planSync(server, manifest, progressCallback) {
        const instanceDir = this.getInstanceDir(server)
        const state = this.readState(instanceDir)
        const nextState = {}

        const toDownload = []
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
    static findOrphans(manifest, instanceDir) {
        const declared = new Set(manifest.files.map(f => f.path))
        const isIgnored = compileIgnore(manifest.ignore)
        const orphans = []

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
    static walk(dir, base, out = []) {
        for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, dirent.name)
            if (dirent.isDirectory()) this.walk(full, base, out)
            else if (dirent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
        }
        return out
    }

    // ------------------------------------------------------------------- apply

    static async applySync(server, manifest, baseUrl, plan, progressCallback) {
        const instanceDir = this.getInstanceDir(server)
        const state = { ...plan.state }

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

        if (plan.toDelete.length > 0 && progressCallback) {
            progressCallback({ message: `Eliminando ${plan.toDelete.length} archivos obsoletos...` })
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
