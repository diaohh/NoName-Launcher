import { useState, useEffect } from 'react'
import { getModpacks, getModpack } from '../services/firestoreService'
import { ipc } from '../services/ipcClient'

export function useServers(accountUsername) {
  const [servers, setServers] = useState([])
  const [selectedServer, setSelectedServer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadModpacks() {
      try {
        const modpacks = await getModpacks(accountUsername)
        setServers(modpacks)
      } catch (err) {
        console.error('Failed to load modpacks from Firestore:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadModpacks()
  }, [accountUsername])

  const selectServer = async (id) => {
    if (selectedServer?.id === id) {
      setSelectedServer(null)
      return
    }

    const modpack = servers.find(s => s.id === id)
    if (!modpack) return

    try {
      await ipc.distro.setServerData(modpack)
      setSelectedServer(modpack)
    } catch (err) {
      console.error('Failed to select modpack:', err)
      setError(err.message)
    }
  }

  /**
   * Re-reads the modpack right before launching and hands the fresh copy to the main
   * process. Reading it only when the list loads would let a player who kept the
   * launcher open walk straight past a maintenance flag raised in the meantime.
   *
   * @returns {Promise<{ok: boolean, message?: string}>}
   */
  const prepareLaunch = async (id) => {
    const fresh = await getModpack(id)

    if (!fresh) {
      return { ok: false, message: 'El modpack ya no esta disponible.' }
    }

    if (fresh.maintenance) {
      return {
        ok: false,
        message: fresh.maintenanceMessage || 'El modpack esta en mantenimiento. Intentalo de nuevo en unos minutos.'
      }
    }

    await ipc.distro.setServerData(fresh)
    setSelectedServer(fresh)
    setServers(prev => prev.map(s => (s.id === id ? fresh : s)))

    return { ok: true }
  }

  return { servers, selectedServer, selectServer, prepareLaunch, loading, error }
}
