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
 * Fetch launcher config from config/launcher document
 */
export async function getLauncherConfig() {
  const docRef = doc(db, 'config', 'launcher')
  const docSnap = await getDoc(docRef)
  return docSnap.exists() ? docSnap.data() : null
}

/**
 * Fetch all enabled modpacks, filtered by usersAllowed client-side
 * @param {string|null} username - Current player's UUID for filtering
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
 * Fetch modules subcollection for a specific modpack
 * @param {string} modpackId
 * @returns {Array} Module objects with artifact data
 */
export async function getModpackModules(modpackId) {
  const modulesRef = collection(db, 'modpacks', modpackId, 'modules')
  const snapshot = await getDocs(modulesRef)
  const modules = []

  snapshot.forEach((docSnap) => {
    modules.push({ id: docSnap.id, ...docSnap.data() })
  })

  return modules
}
