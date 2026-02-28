import { useState, useEffect, useRef } from 'react'
import { getModpacks, getModpackModules } from '../services/firestoreService'
import { ipc } from '../services/ipcClient'

export function useServers(accountUsername) {
  const [servers, setServers] = useState([])
  const [selectedServer, setSelectedServer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const modulesCache = useRef({})

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
    const modpack = servers.find(s => s.id === id)
    if (!modpack) return

    try {
      // Fetch modules from cache or Firestore
      let modules = modulesCache.current[id]
      if (!modules) {
        modules = await getModpackModules(id)
        modulesCache.current[id] = modules
      }

      // Build complete server data with modules
      const serverData = { ...modpack, modules }

      // Send to main process for launch compatibility
      await ipc.distro.setServerData(serverData)

      setSelectedServer(serverData)
    } catch (err) {
      console.error('Failed to select modpack:', err)
      setError(err.message)
    }
  }

  return { servers, selectedServer, selectServer, loading, error }
}
