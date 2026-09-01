import { db } from './firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore'

/** Code carried by the rejection `withTimeout` produces. Never crosses the IPC boundary. */
export const FIRESTORE_TIMEOUT = 'FIRESTORE_TIMEOUT'

const NETWORK_TIMEOUT_MS = 12000

/**
 * Racing a Firestore read against the clock.
 *
 * The full Firebase SDK does not reject when the device is offline: it queues the read and
 * retries for as long as it takes, so with no connection the launcher sits on "Cargando..."
 * forever instead of reporting anything. This cannot cancel the request underneath — it only
 * stops waiting for it — but it does turn silence into an error the UI can show.
 *
 * Moving to `firebase/firestore/lite` (a plain REST call, which fails on its own) would make
 * this unnecessary; that is tracked in the P5 bundle-size item.
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
    const data = { id: docSnap.id, ...docSnap.data() }

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
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null
}
