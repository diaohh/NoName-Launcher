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

/** Code carried by the rejection `withTimeout` produces. Never crosses the IPC boundary. */
export const FIRESTORE_TIMEOUT = 'FIRESTORE_TIMEOUT'

const NETWORK_TIMEOUT_MS = 12000

/**
 * Racing a Firestore read against the clock.
 *
 * `firebase/firestore/lite` is a plain `fetch` with no deadline: a refused connection fails at
 * once, but one that stalls (captive portal, a firewall that drops packets) hangs for as long
 * as the socket does, and the launcher would sit on "Cargando..." with it. This cannot cancel
 * the request underneath — it only stops waiting for it — but it does turn silence into an
 * error the UI can show.
 */
function withTimeout(promise, ms = NETWORK_TIMEOUT_MS) {
  let timer

  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('La consulta al catalogo de modpacks ha tardado demasiado.')
      error.code = FIRESTORE_TIMEOUT
      reject(error)
    }, ms)
  })

  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * A modpack document as the UI consumes it. The document is untrusted input, so the optional
 * visual fields are checked here, once, instead of in every component that reads them.
 *
 * `accentColor` only accepts opaque `#rgb` / `#rrggbb`; anything else becomes `null` and the
 * component falls back to the launcher's own accent.
 */
function toModpack(docSnap) {
  const data = { id: docSnap.id, ...docSnap.data() }
  data.accentColor = typeof data.accentColor === 'string' && HEX_COLOR.test(data.accentColor.trim())
    ? data.accentColor.trim()
    : null
  return data
}

/**
 * Fetch all enabled modpacks, filtered by usersAllowed client-side
 * @param {string|null} username - Current player's username for filtering
 * @returns {Array} Modpacks the user can see
 */
export async function getModpacks(username) {
  const q = query(
    collection(db, 'modpacks'),
    where('isPublic', '==', true),
    where('enabled', '==', true),
    orderBy('order')
  )

  const snapshot = await withTimeout(getDocs(q))
  const modpacks = []

  snapshot.forEach((docSnap) => {
    const data = toModpack(docSnap)

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
 *
 * @param {string} modpackId
 * @returns {Promise<object|null>}
 */
export async function getModpack(modpackId) {
  const docSnap = await withTimeout(getDoc(doc(db, 'modpacks', modpackId)))
  return docSnap.exists() ? toModpack(docSnap) : null
}
