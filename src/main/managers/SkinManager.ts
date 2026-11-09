import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { shell } from 'electron'
import AuthManager from './AuthManager'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { fetchWithTimeout } from '../utils/HttpUtils'
import { writeFileAtomicSync } from '../utils/FileUtils'
import { resolveInside } from '../utils/PathUtils'
import { ERROR_CODE, type ErrorCode } from '../../shared/errorCodes'
import { LauncherError, errorCodeOf } from '../../shared/LauncherError'
import { isPlainObject, isSkinId, type SkinId } from '../../shared/guards'
import {
    MAX_SKIN_NAME_LENGTH,
    isSkinVariant,
    type SkinEntry,
    type SkinImport,
    type SkinSaveChoice,
    type SkinSaveResult,
    type SkinState,
    type SkinVariant
} from '../../shared/skins'

const logger = Logger.getLogger('SkinManager')

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SKINS_URL = `${PROFILE_URL}/skins`
const ACTIVE_CAPE_URL = `${PROFILE_URL}/capes/active`

/** Every texture Mojang hands out lives here; anything else in a profile is ignored. */
const TEXTURE_HOST = 'textures.minecraft.net'

/**
 * Steve, shown in the viewer when a profile comes back without any skin. Fetched from Mojang
 * rather than shipped with the launcher, and never added to the vault.
 */
const DEFAULT_SKIN_URL = `https://${TEXTURE_HOST}/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb`

/** A real skin weighs 1-5 KB. This only stops something absurd from being read or sent. */
const MAX_TEXTURE_BYTES = 1024 * 1024

const TEXTURE_TIMEOUT_MS = 15 * 1000

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const INDEX_FILE = 'index.json'
const INDEX_VERSION = 1

const SKIN_FILE = /^([0-9a-f]{64})\.png$/

/** `SkinSaveChoice` once `skins.ipc.ts` has checked it: the skin, if any, is a vault id. */
export interface CheckedSaveChoice extends Omit<SkinSaveChoice, 'skinId'> {
    skinId: SkinId | null
}

/** A vault entry as `index.json` keeps it; the renderer only ever sees its `SkinEntry` part. */
interface VaultEntry extends SkinEntry {
    id: SkinId
    /** The Mojang texture URL this skin was last published under, once known. */
    textureUrl: string | null
    addedAt: number
}

interface VaultIndex {
    version: number
    skins: VaultEntry[]
}

interface ProfileCape {
    id: string
    name: string
    url: string | null
    active: boolean
}

/** The parts of a Mojang profile the launcher uses, as `parseProfile` reads them. */
interface Profile {
    name: string
    activeSkin: { url: string, variant: SkinVariant } | null
    capes: ProfileCape[]
    activeCapeId: string | null
}

const skinError = (code: ErrorCode, message: string, cause?: unknown) => new LauncherError(code, message, cause)

/** A skin's vault id: the sha256 of its bytes, which `digest('hex')` always writes as one. */
function skinIdOf(bytes: Buffer): SkinId {
    const id = crypto.createHash('sha256').update(bytes).digest('hex')
    if (!isSkinId(id)) throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido identificar la skin.')
    return id
}

const toDataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`

/**
 * Name shown under a skin: no control characters, no surrounding blanks, at most
 * MAX_SKIN_NAME_LENGTH characters. Empty when nothing usable is left.
 */
export function cleanSkinName(raw: unknown): string {
    if (typeof raw !== 'string') return ''
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_SKIN_NAME_LENGTH).trim()
}

/**
 * The skin vault and every call to Mojang's profile API.
 *
 * The Minecraft token never leaves the main process (ADR-0007), so this is the only place
 * that can read the profile or change the skin. Textures cross to the renderer as data URLs,
 * whether they came from Mojang or from the vault, so the renderer never talks to a new
 * origin and the CSP stays as it is (ADR-0014).
 *
 * The vault is `<launcherDir>/skins/`: one `<sha256>.png` per skin plus `index.json` with the
 * name, the model and, once known, the Mojang texture URL the skin is published under. The
 * hash names the file, so importing the same image twice finds the existing entry.
 */
class SkinManager {

    /** Serialises every read-modify-write of index.json. */
    static vaultQueue: Promise<unknown> = Promise.resolve()

    /** Vault id of the skin the account is wearing, as of the last profile read. */
    static activeSkinId: SkinId | null = null

    // ---------------------------------------------------------------- public API

    /**
     * Everything the skin manager screen shows. The skin the account is wearing is added to
     * the vault first, so changing it can never lose it.
     */
    static async getState(): Promise<SkinState> {
        const token = await this.sessionToken()
        const profile = await this.fetchProfile(token)
        const activeSkinId = await this.syncActiveSkin(profile)

        const index = this.readIndex()
        const skins = await Promise.all(index.skins.map(async (entry) => ({
            id: entry.id,
            name: entry.name,
            variant: entry.variant,
            texture: toDataUrl(await this.readSkinFile(entry.id))
        })))

        // A cape whose texture fails to download is still listed and still selectable: the
        // preview is a nicety, the id is what Mojang needs.
        const capes = await Promise.all(profile.capes.map(async (cape) => ({
            id: cape.id,
            name: cape.name,
            texture: await this.optionalTexture(cape.url, 'una capa')
        })))

        return {
            username: profile.name,
            activeSkinId,
            activeVariant: profile.activeSkin?.variant ?? 'classic',
            activeCapeId: profile.activeCapeId,
            fallbackSkin: activeSkinId ? null : await this.optionalTexture(DEFAULT_SKIN_URL, 'la skin por defecto'),
            skins,
            capes
        }
    }

    /** The texture of the skin the account is wearing, for the avatar. Null with no skin. */
    static async getActiveTexture(): Promise<string | null> {
        const token = await this.sessionToken()
        const profile = await this.fetchProfile(token)
        const activeSkinId = await this.syncActiveSkin(profile)
        return activeSkinId ? toDataUrl(await this.readSkinFile(activeSkinId)) : null
    }

    /**
     * Copies a PNG the player picked into the vault.
     *
     * @param filePath Answered by the native open dialog, never by the renderer.
     * @returns `duplicate` when the image was already there.
     */
    static async importSkinFile(filePath: string): Promise<SkinImport> {
        let bytes: Buffer
        try {
            const stats = await fsp.stat(filePath)
            if (!stats.isFile()) throw new Error('not a file')
            if (stats.size > MAX_TEXTURE_BYTES) {
                throw skinError(ERROR_CODE.SKIN_INVALID_FILE, 'La imagen pesa demasiado para ser una skin de Minecraft.')
            }
            bytes = await fsp.readFile(filePath)
        } catch (err) {
            if (err instanceof LauncherError && err.code === ERROR_CODE.SKIN_INVALID_FILE) throw err
            throw skinError(ERROR_CODE.SKIN_INVALID_FILE, 'No se ha podido leer la imagen seleccionada.', err)
        }

        this.assertSkinImage(bytes)
        const id = skinIdOf(bytes)

        return this.withVault(async (index) => {
            const existing = index.skins.find(entry => entry.id === id)
            if (existing) {
                return { skin: { ...this.publicEntry(existing), texture: toDataUrl(bytes) }, duplicate: true }
            }

            const entry: VaultEntry = {
                id,
                name: cleanSkinName(path.basename(filePath, path.extname(filePath))) || 'Skin',
                // Unknown until the player saves it: the renderer infers it from the texture.
                variant: null,
                textureUrl: null,
                addedAt: Date.now()
            }

            this.writeSkinFile(id, bytes)
            index.skins.push(entry)
            this.writeIndex(index)
            logger.info(`Skin imported into the vault: ${id}`)

            return { skin: { ...this.publicEntry(entry), texture: toDataUrl(bytes) }, duplicate: false }
        })
    }

    static async renameSkin(id: SkinId, name: string): Promise<SkinEntry> {
        return this.withVault(async (index) => {
            const entry = this.findEntry(index, id)
            entry.name = name
            this.writeIndex(index)
            return this.publicEntry(entry)
        })
    }

    /**
     * Moves a skin to the system trash, as the file explorer would, so a slip can be undone
     * from there. A file put back is adopted again on the next read of the vault.
     */
    static async deleteSkin(id: SkinId): Promise<void> {
        if (id === this.activeSkinId) {
            throw skinError(ERROR_CODE.SKIN_IN_USE, 'No puedes borrar la skin que llevas puesta.')
        }

        return this.withVault(async (index) => {
            const entry = this.findEntry(index, id)
            const filePath = this.skinPath(entry.id)

            try {
                await shell.trashItem(filePath)
            } catch (err) {
                // Some Linux desktops have no trash; the file explorer would delete it too.
                logger.warn(`Could not move ${filePath} to the trash, deleting it`, err)
                try {
                    await fsp.rm(filePath, { force: true })
                } catch (rmErr) {
                    throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido borrar la skin.', rmErr)
                }
            }

            index.skins = index.skins.filter(other => other.id !== entry.id)
            this.writeIndex(index)
            logger.info(`Skin removed from the vault: ${id}`)
        })
    }

    /**
     * Applies the player's choice to the Mojang profile. Only what differs from the profile
     * as it is now is sent, so pressing "Guardar" with nothing changed costs one read.
     *
     * The skin goes first. When it is accepted and the cape is then refused, the error says
     * the skin did change: the screen re-reads the profile and shows what actually stuck.
     *
     * @param choice Already validated by the IPC handler. `skinId` null keeps the current skin.
     * @returns The texture now worn, for the avatar.
     */
    static async save({ skinId, variant, capeId }: CheckedSaveChoice): Promise<SkinSaveResult> {
        const token = await this.sessionToken()
        let profile = await this.fetchProfile(token)
        let skinChanged = false

        if (skinId) {
            const entry = this.findEntry(this.readIndex(), skinId)
            const wearing = profile.activeSkin
            const unchanged = wearing && entry.textureUrl === wearing.url && wearing.variant === variant

            if (!unchanged) {
                profile = await this.uploadSkin(token, entry.id, variant)
                await this.claimActiveTexture(entry.id, profile)
                skinChanged = true
                logger.info(`Skin changed to ${entry.id} (${variant})`)
            }
        }

        if (capeId !== profile.activeCapeId) {
            if (capeId && !profile.capes.some(cape => cape.id === capeId)) {
                throw skinError(ERROR_CODE.SKIN_INVALID_VALUE, 'Esa capa no esta en tu cuenta.')
            }

            try {
                profile = await this.setActiveCape(token, capeId)
                logger.info(capeId ? `Cape changed to ${capeId}` : 'Cape hidden')
            } catch (err) {
                if (skinChanged && err instanceof Error) err.message = `La skin se ha guardado, pero la capa no. ${err.message}`
                throw err
            }
        }

        const activeSkinId = await this.syncActiveSkin(profile)
        return { skinTexture: activeSkinId ? toDataUrl(await this.readSkinFile(activeSkinId)) : null }
    }

    // ---------------------------------------------------------------- Mojang

    /**
     * The Minecraft token of the selected account, renewed first if it has expired. A failure
     * keeps AuthManager's own code, so the renderer can tell a dead session (log out) from a
     * network blip (stay) exactly as it does for a launch.
     */
    static async sessionToken(): Promise<string> {
        const result = await AuthManager.validateSelectedMicrosoftAccount()
        if (!result.ok) throw skinError(result.code, result.message)

        const account = AuthManager.getSelectedAccount()
        if (!account?.accessToken) {
            throw skinError(ERROR_CODE.AUTH_NO_ACCOUNT, 'No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.')
        }
        return account.accessToken
    }

    static async fetchProfile(token: string): Promise<Profile> {
        const failure = 'No se ha podido leer tu perfil de Minecraft'
        const response = await this.mojangRequest(PROFILE_URL, {
            headers: { Authorization: `Bearer ${token}` }
        }, failure)

        if (!response.ok) throw await this.mojangError(response, ERROR_CODE.SKIN_PROFILE_FAILED, failure)

        let body: unknown
        try {
            body = await response.json()
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_PROFILE_FAILED, `${failure}: la respuesta de Mojang no se puede leer.`, err)
        }

        const profile = this.parseProfile(body)
        if (!profile) throw skinError(ERROR_CODE.SKIN_PROFILE_FAILED, `${failure}: la respuesta de Mojang no se puede leer.`)
        return profile
    }

    static async uploadSkin(token: string, id: SkinId, variant: SkinVariant): Promise<Profile> {
        const bytes = await this.readSkinFile(id)
        // The file sits on disk where anything can replace it; checked again before it is sent.
        this.assertSkinImage(bytes)

        const form = new FormData()
        form.append('variant', variant)
        form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'skin.png')

        const failure = 'No se ha podido guardar la skin'
        const response = await this.mojangRequest(SKINS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        }, failure)

        if (!response.ok) throw await this.mojangError(response, ERROR_CODE.SKIN_SAVE_FAILED, failure)
        return this.profileFromResponse(response, token)
    }

    static async setActiveCape(token: string, capeId: string | null): Promise<Profile> {
        const failure = capeId ? 'No se ha podido cambiar la capa' : 'No se ha podido quitar la capa'
        const response = await this.mojangRequest(ACTIVE_CAPE_URL, capeId
            ? {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ capeId })
            }
            : {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            }, failure)

        if (!response.ok) throw await this.mojangError(response, ERROR_CODE.SKIN_SAVE_FAILED, failure)
        return this.profileFromResponse(response, token)
    }

    /**
     * Mojang answers a change with the updated profile. Should that body ever be missing or
     * different, the change has still been made, so the profile is read again rather than
     * reporting a failure that did not happen.
     */
    static async profileFromResponse(response: Response, token: string): Promise<Profile> {
        try {
            const profile = this.parseProfile(await response.json())
            if (profile) return profile
        } catch {
            // Fall through to a fresh read.
        }
        logger.warn('Mojang answered a profile change without a readable profile, reading it again')
        return this.fetchProfile(token)
    }

    /** `fetchWithTimeout`, with its "download" wording replaced by the operation's own. */
    static async mojangRequest(url: string, init: RequestInit, failure: string): Promise<Response> {
        try {
            return await fetchWithTimeout(url, 'la respuesta de Mojang', init)
        } catch (err) {
            const code = errorCodeOf(err, ERROR_CODE.NETWORK_ERROR)
            const message = code === ERROR_CODE.NETWORK_TIMEOUT
                ? `${failure}: Mojang no ha respondido a tiempo. Comprueba tu conexion e intentalo de nuevo.`
                : `${failure}: no se ha podido contactar con Mojang. Comprueba tu conexion e intentalo de nuevo.`
            throw skinError(code, message, (err instanceof Error ? err.cause : undefined) ?? err)
        }
    }

    static async mojangError(response: Response, code: ErrorCode, failure: string): Promise<LauncherError> {
        let detail = ''
        try {
            detail = (await response.text()).slice(0, 300)
        } catch {
            // The status is enough to report it.
        }
        logger.warn(`Mojang answered HTTP ${response.status} (${failure}): ${detail}`)

        if (response.status === 429) {
            return skinError(ERROR_CODE.SKIN_RATE_LIMITED, 'Mojang ha recibido demasiados cambios seguidos. Espera un minuto e intentalo de nuevo.')
        }
        if (response.status === 401 || response.status === 403) {
            return skinError(code, `${failure}: Mojang ha rechazado la sesion. Si se repite, cierra sesion y vuelve a entrar.`)
        }
        if (response.status >= 500) {
            return skinError(code, `${failure}: los servidores de Mojang no responden ahora mismo. Intentalo de nuevo en unos minutos.`)
        }
        if (response.status === 400 && code === ERROR_CODE.SKIN_SAVE_FAILED) {
            return skinError(code, `${failure}: Mojang la ha rechazado. Comprueba que la imagen es una skin valida.`)
        }
        return skinError(code, `${failure} (HTTP ${response.status}).`)
    }

    /**
     * Reads the parts of a profile the launcher uses. The body comes from the network, so
     * anything that does not have the expected shape is dropped, and a texture URL is only
     * followed when it points at Mojang's texture host.
     */
    static parseProfile(body: unknown): Profile | null {
        if (!isPlainObject(body) || typeof body.name !== 'string' || !Array.isArray(body.skins)) return null

        const wearing = body.skins.find((skin): skin is Record<string, unknown> => isPlainObject(skin) && skin.state === 'ACTIVE')
        const wearingUrl = wearing ? this.textureUrl(wearing.url) : null
        const activeSkin: Profile['activeSkin'] = wearing && wearingUrl
            ? { url: wearingUrl, variant: String(wearing.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic' }
            : null

        const capes: ProfileCape[] = []
        for (const cape of Array.isArray(body.capes) ? body.capes : []) {
            if (!isPlainObject(cape) || typeof cape.id !== 'string' || cape.id.length === 0 || cape.id.length > 64) continue
            capes.push({
                id: cape.id,
                name: typeof cape.alias === 'string' && cape.alias.trim() ? cape.alias.trim().slice(0, 40) : 'Capa',
                url: this.textureUrl(cape.url),
                active: cape.state === 'ACTIVE'
            })
        }

        return {
            name: body.name,
            activeSkin,
            capes,
            activeCapeId: capes.find(cape => cape.active)?.id ?? null
        }
    }

    /** Mojang still hands out `http://` texture URLs; they are served over https too. */
    static textureUrl(raw: unknown): string | null {
        if (typeof raw !== 'string') return null
        let url: URL
        try {
            url = new URL(raw)
        } catch {
            return null
        }
        if (url.hostname !== TEXTURE_HOST || !/^\/texture\/[0-9a-f]+$/i.test(url.pathname)) return null
        return `https://${TEXTURE_HOST}${url.pathname}`
    }

    static async downloadTexture(url: string, what: string): Promise<Buffer> {
        const response = await fetchWithTimeout(url, what, { timeoutMs: TEXTURE_TIMEOUT_MS })
        if (!response.ok) {
            throw skinError(ERROR_CODE.SKIN_PROFILE_FAILED, `No se ha podido descargar ${what} (HTTP ${response.status}).`)
        }

        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > MAX_TEXTURE_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
            throw skinError(ERROR_CODE.SKIN_PROFILE_FAILED, `Mojang ha devuelto ${what} en un formato que no se puede leer.`)
        }
        return bytes
    }

    static async optionalTexture(url: string | null, what: string): Promise<string | null> {
        if (!url) return null
        try {
            return toDataUrl(await this.downloadTexture(url, what))
        } catch (err) {
            logger.warn(`Could not download ${what}, shown without preview`, err)
            return null
        }
    }

    // ---------------------------------------------------------------- vault

    /**
     * Makes sure the skin the account is wearing is in the vault and returns its id.
     *
     * Mojang re-encodes an uploaded image, so the texture it serves is not byte-identical to
     * the file that was sent. The entry is therefore matched by the texture URL it was last
     * published under first, and by the hash of the downloaded texture only after that.
     */
    static async syncActiveSkin(profile: Profile): Promise<SkinId | null> {
        const wearing = profile.activeSkin
        if (!wearing) {
            this.activeSkinId = null
            return null
        }

        const id = await this.withVault(async (index) => {
            let entry = index.skins.find(candidate => candidate.textureUrl === wearing.url)
            let changed = false

            if (!entry) {
                const bytes = await this.downloadTexture(wearing.url, 'tu skin actual')
                const textureId = skinIdOf(bytes)
                entry = index.skins.find(candidate => candidate.id === textureId)

                if (!entry) {
                    this.assertSkinImage(bytes)
                    this.writeSkinFile(textureId, bytes)
                    entry = {
                        id: textureId,
                        name: cleanSkinName(profile.name) || 'Skin',
                        variant: wearing.variant,
                        textureUrl: null,
                        addedAt: Date.now()
                    }
                    index.skins.push(entry)
                    logger.info(`Current skin saved into the vault: ${textureId}`)
                }

                this.assignTextureUrl(index, entry, wearing.url)
                changed = true
            }

            if (entry.variant !== wearing.variant) {
                entry.variant = wearing.variant
                changed = true
            }

            if (changed) this.writeIndex(index)
            return entry.id
        })

        this.activeSkinId = id
        return id
    }

    /** After an upload, the vault entry that was sent is the one published under the new URL. */
    static async claimActiveTexture(id: SkinId, profile: Profile): Promise<void> {
        const wearing = profile.activeSkin
        if (!wearing) return

        await this.withVault(async (index) => {
            const entry = this.findEntry(index, id)
            this.assignTextureUrl(index, entry, wearing.url)
            entry.variant = wearing.variant
            this.writeIndex(index)
        })
    }

    /** A texture URL belongs to one entry at most, or the URL match would be ambiguous. */
    static assignTextureUrl(index: VaultIndex, entry: VaultEntry, url: string): void {
        for (const other of index.skins) {
            if (other !== entry && other.textureUrl === url) other.textureUrl = null
        }
        entry.textureUrl = url
    }

    /** Runs `fn(index)` after every earlier vault operation has finished. */
    static withVault<T>(fn: (index: VaultIndex) => Promise<T>): Promise<T> {
        const run = this.vaultQueue.then(() => fn(this.readIndex()))
        this.vaultQueue = run.catch(() => {})
        return run
    }

    /**
     * Reads index.json, keeping only well-formed entries whose PNG is still on disk, and
     * adopts any `<sha256>.png` that has no entry: one restored from the trash, or every
     * skin after the index itself was lost.
     */
    static readIndex(): VaultIndex {
        const directory = this.ensureVaultDirectory()
        const indexPath = path.join(directory, INDEX_FILE)

        let stored: unknown[] = []
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
            stored = isPlainObject(parsed) && Array.isArray(parsed.skins) ? parsed.skins : []
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                const quarantined = `${indexPath}.corrupt-${Date.now()}`
                logger.warn(`Skin index unreadable, moved aside to ${quarantined}`, err)
                try {
                    fs.renameSync(indexPath, quarantined)
                } catch (moveErr) {
                    logger.error('Skin index could not be moved aside', moveErr)
                }
            }
        }

        let files: Set<string>
        try {
            files = new Set(fs.readdirSync(directory))
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido leer la carpeta de skins.', err)
        }

        const skins: VaultEntry[] = []
        const seen = new Set<string>()
        for (const raw of stored) {
            const entry = this.normalizeEntry(raw)
            if (!entry || seen.has(entry.id) || !files.has(`${entry.id}.png`)) continue
            seen.add(entry.id)
            skins.push(entry)
        }

        for (const file of [...files].sort()) {
            const id = SKIN_FILE.exec(file)?.[1]
            if (!isSkinId(id) || seen.has(id)) continue
            seen.add(id)
            skins.push({ id, name: 'Skin', variant: null, textureUrl: null, addedAt: Date.now() })
        }

        return { version: INDEX_VERSION, skins }
    }

    static normalizeEntry(raw: unknown): VaultEntry | null {
        if (!isPlainObject(raw) || !isSkinId(raw.id)) return null
        return {
            id: raw.id,
            name: cleanSkinName(raw.name) || 'Skin',
            variant: isSkinVariant(raw.variant) ? raw.variant : null,
            textureUrl: this.textureUrl(raw.textureUrl),
            addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : 0
        }
    }

    static writeIndex(index: VaultIndex): void {
        const indexPath = path.join(this.ensureVaultDirectory(), INDEX_FILE)
        try {
            writeFileAtomicSync(indexPath, JSON.stringify({ version: INDEX_VERSION, skins: index.skins }, null, 4))
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido guardar la lista de skins. Comprueba que hay espacio en disco y permiso de escritura.', err)
        }
    }

    static writeSkinFile(id: SkinId, bytes: Buffer): void {
        try {
            writeFileAtomicSync(this.skinPath(id), bytes)
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido guardar la skin en el disco.', err)
        }
    }

    static async readSkinFile(id: SkinId): Promise<Buffer> {
        try {
            return await fsp.readFile(this.skinPath(id))
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_NOT_FOUND, 'Esa skin ya no esta en la carpeta de skins.', err)
        }
    }

    static findEntry(index: VaultIndex, id: SkinId): VaultEntry {
        const entry = index.skins.find(candidate => candidate.id === id)
        if (!entry) throw skinError(ERROR_CODE.SKIN_NOT_FOUND, 'Esa skin ya no esta en la carpeta de skins.')
        return entry
    }

    static skinPath(id: SkinId): string {
        return resolveInside(ConfigManager.getSkinsDirectory(), `${id}.png`)
    }

    static ensureVaultDirectory(): string {
        const directory = ConfigManager.getSkinsDirectory()
        try {
            fs.mkdirSync(directory, { recursive: true })
        } catch (err) {
            throw skinError(ERROR_CODE.SKIN_VAULT_FAILED, 'No se ha podido crear la carpeta de skins.', err)
        }
        return directory
    }

    static publicEntry(entry: VaultEntry): SkinEntry {
        return { id: entry.id, name: entry.name, variant: entry.variant }
    }

    /**
     * A skin Mojang accepts: a PNG of 64x64, or 64x32 in the pre-1.8 layout. Read from the
     * IHDR chunk, which the PNG format requires to come first, so no image library is needed.
     */
    static assertSkinImage(bytes: Buffer): void {
        const isPng = bytes.length >= 24
            && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
            && bytes.toString('ascii', 12, 16) === 'IHDR'

        if (!isPng) {
            throw skinError(ERROR_CODE.SKIN_INVALID_FILE, 'El archivo no es una imagen PNG.')
        }

        const width = bytes.readUInt32BE(16)
        const height = bytes.readUInt32BE(20)
        if (width !== 64 || (height !== 64 && height !== 32)) {
            throw skinError(ERROR_CODE.SKIN_INVALID_FILE, `Una skin debe medir 64x64 o 64x32 pixeles, y esta imagen mide ${width}x${height}.`)
        }
    }
}

export default SkinManager
