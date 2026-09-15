import { useState, useEffect, useCallback } from 'react'
import { getModpacks, getModpack, FIRESTORE_TIMEOUT } from '../services/firestoreService'
import { ipc } from '../services/ipcClient'
import { preloadImages } from '../services/imagePreload'
import { useStatus } from '../contexts/StatusContext'

const NETWORK_MESSAGE = 'No se ha podido conectar con el catalogo de modpacks. Comprueba tu conexion a internet.'
const UNKNOWN_MESSAGE = 'No se ha podido cargar la lista de modpacks.'

/**
 * Turns a failed read into something the player can act on.
 *
 * Firestore reports an unreachable backend as `unavailable`, and the race in
 * `firestoreService` reports its own giving-up as FIRESTORE_TIMEOUT; both mean "no network"
 * to the player. Firebase's own messages are in English, so only the code is read and the
 * text is ours — the original goes to the console.
 *
 * These codes never cross the IPC boundary, which is why they deliberately do not live in
 * `shared/errorCodes.js`.
 */
function describeError(err) {
  const isNetwork = err?.code === FIRESTORE_TIMEOUT
    || err?.code === 'unavailable'
    || navigator.onLine === false

  return {
    kind: isNetwork ? 'network' : 'unknown',
    message: isNetwork ? NETWORK_MESSAGE : UNKNOWN_MESSAGE
  }
}

export function useServers(accountUsername) {
  const { showStatus } = useStatus()
  const [servers, setServers] = useState([])
  const [selectedServer, setSelectedServer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    // StrictMode invokes this twice, and a changed username or a retry re-runs it. Without
    // the flag a slow first response can land after a newer one and overwrite it.
    // The loading and error flags are reset by `reload`, in the handler that triggers the
    // retry: setting them here would be a synchronous setState inside the effect body.
    let ignore = false

    getModpacks(accountUsername)
      .then(modpacks => {
        if (ignore) return
        setServers(modpacks)
        setError(null)
        setLoading(false)
        // Icons are not listed: the sidebar renders them as soon as the list arrives.
        preloadImages(modpacks.flatMap(m => [m.banner, m.logo]))
      })
      .catch(err => {
        if (ignore) return
        console.error('Failed to load modpacks from Firestore:', err)
        setError(describeError(err))
        setLoading(false)
      })

    return () => { ignore = true }
  }, [accountUsername, reloadToken])

  /** Re-runs the catalogue read. What the "Reintentar" button calls. */
  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadToken(token => token + 1)
  }, [])

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
      // Not the list-level error: the catalogue itself loaded fine, and replacing the
      // sidebar with a failure panel would hide every other modpack over one bad selection.
      showStatus(err.message || 'No se ha podido seleccionar el modpack', 'error')
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

  return { servers, selectedServer, selectServer, prepareLaunch, loading, error, reload }
}
