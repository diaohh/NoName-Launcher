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

  const snapshot = await getDocs(q)
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
  const docSnap = await getDoc(doc(db, 'modpacks', modpackId))
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null
}
