import { db } from './firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore/lite'
import { isSha256Hex } from '../../../shared/guards'
import type { Modpack } from '../../../shared/modpack'

const NETWORK_TIMEOUT_MS = 12000

/**
 * What `withTimeout` rejects with. Never crosses the IPC boundary, which is why it is not a
 * `LauncherError` and its case is not in `shared/errorCodes`.
 */
export class FirestoreTimeoutError extends Error {
  constructor() {
    super('La consulta al catalogo de modpacks ha tardado demasiado.')
    this.name = 'FirestoreTimeoutError'
  }
}

/**
 * Racing a Firestore read against the clock.
 *
 * `firebase/firestore/lite` is a plain `fetch` with no deadline: a refused connection fails at
 * once, but one that stalls (captive portal, a firewall that drops packets) hangs for as long
 * as the socket does, and the launcher would sit on "Cargando..." with it. This cannot cancel
 * the request underneath — it only stops waiting for it — but it does turn silence into an
 * error the UI can show.
 */
function withTimeout<T>(promise: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FirestoreTimeoutError()), ms)
  })

  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const OPTIONAL_TEXT = ['description', 'minecraftVersion', 'icon', 'banner', 'logo', 'maintenanceMessage'] as const
const OPTIONAL_FLAGS = ['isPublic', 'enabled'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * A modpack document as the UI consumes it. The document is untrusted input (ADR-0015), so
 * every field is checked here, once, instead of in every component that reads it: an optional
 * field of the wrong type is dropped, and a document without a name shows its id — the same
 * rules main applies to its own subset in `DistributionManager.parseServerData`.
 *
 * `accentColor` only accepts opaque `#rgb` / `#rrggbb`; anything else becomes `null` and the
 * component falls back to the launcher's own accent.
 */
function toModpack(id: string, data: Record<string, unknown>): Modpack {
  const accent = typeof data.accentColor === 'string' ? data.accentColor.trim() : ''
  const modpack: Modpack = {
    id,
    name: text(data.name) ?? id,
    accentColor: HEX_COLOR.test(accent) ? accent : null
  }

  for (const key of OPTIONAL_TEXT) {
    const value = text(data[key])
    if (value != null) modpack[key] = value
  }
  for (const key of OPTIONAL_FLAGS) {
    const value = data[key]
    if (typeof value === 'boolean') modpack[key] = value
  }
  // Truthy, like main reads it: a flag main would refuse to launch must not look launchable here.
  if (data.maintenance) modpack.maintenance = true
  if (typeof data.order === 'number') modpack.order = data.order
  if (Array.isArray(data.usersAllowed)) {
    modpack.usersAllowed = data.usersAllowed.filter((name): name is string => typeof name === 'string')
  }

  if (isPlainObject(data.java)) {
    const minRam = text(data.java.minRam)
    const maxRam = text(data.java.maxRam)
    modpack.java = {}
    if (minRam != null) modpack.java.minRam = minRam
    if (maxRam != null) modpack.java.maxRam = maxRam
  }

  const manifest = data.manifest
  // Main's rule too (`parseServerData`): a hash that is not a sha256 means no manifest.
  if (isPlainObject(manifest) && typeof manifest.url === 'string' && isSha256Hex(manifest.hash)) {
    const version = text(manifest.version)
    modpack.manifest = { url: manifest.url, hash: manifest.hash }
    if (version != null) modpack.manifest.version = version
  }

  return modpack
}

/**
 * Fetch all enabled modpacks, filtered by usersAllowed client-side
 * @param username - Current player's username for filtering
 * @returns Modpacks the user can see
 */
export async function getModpacks(username: string | null): Promise<Modpack[]> {
  const q = query(
    collection(db, 'modpacks'),
    where('isPublic', '==', true),
    where('enabled', '==', true),
    orderBy('order')
  )

  const snapshot = await withTimeout(getDocs(q))
  const modpacks: Modpack[] = []

  snapshot.forEach((docSnap) => {
    const data = toModpack(docSnap.id, docSnap.data())

    // Client-side filtering: empty usersAllowed = everyone can see
    const allowed = data.usersAllowed || []
    if (allowed.length === 0 || (username && allowed.includes(username))) {
      modpacks.push(data)
    }
  })

  return modpacks
}

/**
 * Re-read a single modpack document.
 *
 * Called right before launching: the list is fetched once when the launcher opens, so
 * a player who left it running would otherwise never see a `maintenance` flag raised
 * afterwards, nor a manifest published in the meantime.
 */
export async function getModpack(modpackId: string): Promise<Modpack | null> {
  const docSnap = await withTimeout(getDoc(doc(db, 'modpacks', modpackId)))
  const data = docSnap.data()
  return data ? toModpack(docSnap.id, data) : null
}
