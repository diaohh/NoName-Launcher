import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { isSafeRelativePath } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('ManifestManager')

const SUPPORTED_FORMAT_VERSION = 1

/**
 * Fetches and verifies the modpack manifest published to the CDN.
 *
 * Firestore holds the only mutable pointer (`manifest: { url, hash, version }`);
 * everything in the bucket is content the hash must match. See docs/manifest.md.
 */
class ManifestManager {

    /**
     * The manifest lives at `<base>/manifest.json` and its files at `<base>/files/<path>`,
     * so the base is derived instead of stored. Moving to a custom domain is then a
     * single Firestore field change, with no manifest to regenerate.
     */
    static deriveBaseUrl(manifestUrl) {
        const marker = '/manifest.json'
        if (!manifestUrl.endsWith(marker)) {
            throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, `La URL del manifest debe terminar en ${marker}: ${manifestUrl}`)
        }
        return manifestUrl.slice(0, -marker.length)
    }

    static manifestError(code, message) {
        const error = new Error(message)
        error.code = code
        return error
    }

    /** Mod filenames contain spaces and brackets, so every segment is encoded. */
    static fileUrl(baseUrl, relativePath) {
        const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
        return `${baseUrl}/files/${encoded}`
    }

    static cachePath(hash) {
        return path.join(ConfigManager.getDataDirectory(), 'manifests', `${hash}.json`)
    }

    static assertShape(manifest) {
        if (manifest?.formatVersion !== SUPPORTED_FORMAT_VERSION) {
            throw this.manifestError(
                ERROR_CODE.UNSUPPORTED_MANIFEST_FORMAT,
                `El manifest usa el formato ${manifest?.formatVersion} y este launcher entiende ` +
                `el ${SUPPORTED_FORMAT_VERSION}. Actualiza el launcher.`
            )
        }

        if (!Array.isArray(manifest.files)) throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, 'El manifest no contiene "files"')
        if (!manifest.minecraft?.version) throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, 'El manifest no declara "minecraft.version"')

        // A missing hash used to mean "existence is enough", which silently froze files
        // at whatever version the player already had. It is an error now.
        for (const file of manifest.files) {
            if (!file.path || !file.hash || typeof file.size !== 'number') {
                throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, `Entrada de manifest invalida: ${JSON.stringify(file)}`)
            }
        }

        // Every path below is joined onto the instance directory, for writing or deleting.
        // A hash only proves the manifest is the published one, so its paths are checked too.
        const paths = [
            ...manifest.files.map(file => file.path),
            ...(manifest.policies || []).map(rule => rule?.path?.replace(/\/+$/, '')),
            ...(manifest.loader?.installer ? [manifest.loader.installer.path] : [])
        ]

        const unsafe = paths.find(relativePath => !isSafeRelativePath(relativePath))
        if (unsafe !== undefined) {
            throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, `El manifest contiene una ruta no permitida: ${JSON.stringify(unsafe)}`)
        }
    }

    /**
     * @param {{url: string, hash: string, version?: string}} ref The Firestore pointer.
     * @returns {Promise<{manifest: object, baseUrl: string}>}
     */
    static async fetch(ref) {
        if (!ref || !ref.url || !ref.hash) {
            throw this.manifestError(
                ERROR_CODE.MANIFEST_MISSING,
                'El modpack no tiene un manifest publicado. Revisa el campo "manifest" en Firestore.'
            )
        }

        const baseUrl = this.deriveBaseUrl(ref.url)
        const cached = this.cachePath(ref.hash)

        // The cache is keyed by hash, so a hit is proof the content is current.
        if (fs.existsSync(cached)) {
            const raw = await fs.readFile(cached, 'utf8')
            if (this.sha256(raw) === ref.hash) {
                logger.info(`Manifest ${ref.hash.slice(0, 12)} served from cache`)
                const manifest = JSON.parse(raw)
                this.assertShape(manifest)
                return { manifest, baseUrl }
            }
            logger.warn('Cached manifest failed its own hash check, refetching')
            await fs.remove(cached).catch(() => {})
        }

        logger.info('Fetching manifest:', ref.url)

        const response = await fetchWithTimeout(ref.url, 'el manifest del modpack', { cache: 'no-store' })
        if (!response.ok) {
            throw this.manifestError(
                ERROR_CODE.MANIFEST_DOWNLOAD_FAILED,
                `No se pudo descargar el manifest (HTTP ${response.status}) desde ${ref.url}`
            )
        }

        const raw = await response.text()
        const actual = this.sha256(raw)

        if (actual !== ref.hash) {
            logger.error(`Manifest hash mismatch: expected ${ref.hash}, got ${actual}`)
            throw this.manifestError(
                ERROR_CODE.MANIFEST_HASH_MISMATCH,
                'El manifest descargado no coincide con el publicado en Firestore. ' +
                'Puede que la actualizacion siga en curso; intentalo de nuevo en unos minutos.'
            )
        }

        const manifest = JSON.parse(raw)
        this.assertShape(manifest)

        await fs.ensureDir(path.dirname(cached))
        await fs.writeFile(cached, raw)

        logger.info(`Manifest ${manifest.packId} ${manifest.version}: ${manifest.files.length} files, ${manifest.loader?.type || 'vanilla'}`)
        return { manifest, baseUrl }
    }

    static sha256(text) {
        return crypto.createHash('sha256').update(text).digest('hex')
    }
}

export default ManifestManager
