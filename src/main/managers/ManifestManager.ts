import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { POLICIES } from '../../shared/PackPolicy'
import { isSafeRelativePath } from '../utils/PathUtils'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { ERROR_CODE, type ErrorCode } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { isSha256Hex } from '../../shared/guards'
import type { ManifestPointer, PackManifest } from '../types/manifest'

const logger = Logger.getLogger('ManifestManager')

const SUPPORTED_FORMAT_VERSION = 1

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value)

const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)

const isPolicy = (value: unknown) => (POLICIES as readonly unknown[]).includes(value)

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
    static deriveBaseUrl(manifestUrl: string): string {
        const marker = '/manifest.json'
        if (!manifestUrl.endsWith(marker)) {
            throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, `La URL del manifest debe terminar en ${marker}: ${manifestUrl}`)
        }
        return manifestUrl.slice(0, -marker.length)
    }

    static manifestError(code: ErrorCode, message: string, cause?: unknown): LauncherError {
        return new LauncherError(code, message, cause)
    }

    /** Mod filenames contain spaces and brackets, so every segment is encoded. */
    static fileUrl(baseUrl: string, relativePath: string): string {
        const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
        return `${baseUrl}/files/${encoded}`
    }

    /**
     * The hash comes from the Firestore document. It is checked here, where it becomes a path,
     * and not only where it arrives: `fetch` deletes a cached file whose hash does not match,
     * and `"../config"` would have named `config.json`.
     */
    static cachePath(hash: string): string {
        if (!isSha256Hex(hash)) {
            throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, `El hash del manifest no es un sha256 valido: ${JSON.stringify(hash)}`)
        }
        return path.join(ConfigManager.getDataDirectory(), 'manifests', `${hash}.json`)
    }

    /**
     * The manifest's shape, checked before anything reads it as a `PackManifest`: the bytes
     * come from the network, and a hash only proves they are the published ones.
     */
    static assertShape(manifest: unknown): asserts manifest is PackManifest {
        const invalid = (message: string) => this.manifestError(ERROR_CODE.MANIFEST_INVALID, message)

        if (!isPlainObject(manifest) || manifest.formatVersion !== SUPPORTED_FORMAT_VERSION) {
            const found = isPlainObject(manifest) ? manifest.formatVersion : undefined
            throw this.manifestError(
                ERROR_CODE.UNSUPPORTED_MANIFEST_FORMAT,
                `El manifest usa el formato ${found} y este launcher entiende ` +
                `el ${SUPPORTED_FORMAT_VERSION}. Actualiza el launcher.`
            )
        }

        const { files, minecraft, loader, policies, ignore } = manifest

        if (!Array.isArray(files)) throw invalid('El manifest no contiene "files"')
        if (!isPlainObject(minecraft) || typeof minecraft.version !== 'string' || !minecraft.version) {
            throw invalid('El manifest no declara "minecraft.version"')
        }

        // Every path collected here is joined onto the instance directory, for writing or
        // deleting. A hash only proves the manifest is the published one, so they are checked too.
        const paths: unknown[] = []

        // A missing hash used to mean "existence is enough", which silently froze files
        // at whatever version the player already had. It is an error now.
        for (const file of files) {
            const valid = isPlainObject(file)
                && typeof file.path === 'string' && file.path
                && isSha256Hex(file.hash)
                && typeof file.size === 'number'
                && isOptional(file.policy, isPolicy)
            if (!valid) throw invalid(`Entrada de manifest invalida: ${JSON.stringify(file)}`)
            paths.push(file.path)
        }

        const rules: unknown = policies ?? []
        if (!Array.isArray(rules)) throw invalid('El manifest contiene "policies" invalidas')
        for (const rule of rules) {
            if (!isPlainObject(rule) || typeof rule.path !== 'string' || !isPolicy(rule.policy)) {
                throw invalid(`Regla de manifest invalida: ${JSON.stringify(rule)}`)
            }
            paths.push(rule.path.replace(/\/+$/, ''))
        }

        if (!isOptional(ignore, value => Array.isArray(value) && value.every(pattern => typeof pattern === 'string'))) {
            throw invalid('El manifest contiene un "ignore" invalido')
        }

        if (loader !== undefined) {
            const valid = isPlainObject(loader)
                && typeof loader.type === 'string'
                && isOptional(loader.version, version => typeof version === 'string')
                && isOptional(loader.installer, installer => isPlainObject(installer) && typeof installer.path === 'string')
            if (!valid) throw invalid('El manifest declara un "loader" invalido')
            if (isPlainObject(loader.installer)) paths.push(loader.installer.path)
        }

        const unsafe = paths.find(relativePath => !isSafeRelativePath(relativePath))
        if (unsafe !== undefined) {
            throw invalid(`El manifest contiene una ruta no permitida: ${JSON.stringify(unsafe)}`)
        }
    }

    /**
     * The published bytes, parsed. The hash is always taken over the bytes themselves (see
     * `fetch`), so a UTF-8 BOM is only stripped here, for `JSON.parse`, never before hashing.
     */
    static parse(bytes: Buffer): unknown {
        try {
            return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
        } catch (err) {
            throw this.manifestError(ERROR_CODE.MANIFEST_INVALID, 'El manifest publicado no es un JSON valido.', err)
        }
    }

    /** @param ref The Firestore pointer. */
    static async fetch(ref: ManifestPointer | null | undefined): Promise<{ manifest: PackManifest, baseUrl: string }> {
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
            const bytes = await fs.readFile(cached)
            if (this.sha256(bytes) === ref.hash) {
                logger.info(`Manifest ${ref.hash.slice(0, 12)} served from cache`)
                const manifest = this.parse(bytes)
                this.assertShape(manifest)
                return { manifest, baseUrl }
            }
            logger.warn('Cached manifest failed its own hash check, refetching')
            await fs.remove(cached).catch(() => {})
        }

        logger.info('Fetching manifest:', ref.url)

        // Node's fetch keeps no HTTP cache, so there is nothing to bypass here; a stale copy
        // served by the CDN fails the hash check below.
        const response = await fetchWithTimeout(ref.url, 'el manifest del modpack')
        if (!response.ok) {
            throw this.manifestError(
                ERROR_CODE.MANIFEST_DOWNLOAD_FAILED,
                `No se pudo descargar el manifest (HTTP ${response.status}) desde ${ref.url}`
            )
        }

        // Hashed as bytes, exactly as published. `response.text()` decodes first, so a BOM or
        // any byte that is not valid UTF-8 changed the hash and failed every launch for good.
        const bytes = Buffer.from(await response.arrayBuffer())
        const actual = this.sha256(bytes)

        if (actual !== ref.hash) {
            logger.error(`Manifest hash mismatch: expected ${ref.hash}, got ${actual}`)
            throw this.manifestError(
                ERROR_CODE.MANIFEST_HASH_MISMATCH,
                'El manifest descargado no coincide con el publicado en Firestore. ' +
                'Puede que la actualizacion siga en curso; intentalo de nuevo en unos minutos.'
            )
        }

        const manifest = this.parse(bytes)
        this.assertShape(manifest)

        await fs.ensureDir(path.dirname(cached))
        await fs.writeFile(cached, bytes)

        logger.info(`Manifest ${manifest.packId} ${manifest.version}: ${manifest.files.length} files, ${manifest.loader?.type || 'vanilla'}`)
        return { manifest, baseUrl }
    }

    static sha256(bytes: Buffer): string {
        return crypto.createHash('sha256').update(bytes).digest('hex')
    }
}

export default ManifestManager
