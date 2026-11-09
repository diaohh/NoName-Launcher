import { useState, useEffect, useCallback } from 'react'
import { getModpacks, getModpack, FirestoreTimeoutError } from '../services/firestoreService'
import { ipc } from '../services/ipcClient'
import { errorMessage } from '../services/errors'
import { preloadImages } from '../services/imagePreload'
import { isVisibleTo } from '../services/modpackVisibility'
import { useStatus } from '../contexts/StatusContext'
import { useLaunch } from '../contexts/LaunchContext'
import type { Modpack } from '../../../shared/modpack'

/**
 * How long the refresh button rests after a successful read. Every read costs one Firestore
 * read per modpack (ADR-0016), so repeated clicks must not multiply them.
 */
const REFRESH_COOLDOWN_MS = 30 * 1000

const NETWORK_MESSAGE = 'No se ha podido conectar con el catalogo de modpacks. Comprueba tu conexion a internet.'
const UNKNOWN_MESSAGE = 'No se ha podido cargar la lista de modpacks.'

/** Why the catalogue could not be read, in terms the player can act on. */
export interface CatalogueError {
  kind: 'network' | 'unknown'
  message: string
}

/** What `prepareLaunch` answers: a refusal carries the message to show. */
export type LaunchReadiness = { ok: true } | { ok: false, message: string }

/**
 * Turns a failed read into something the player can act on.
 *
 * Firestore lite reports a request that never got an HTTP answer (no network, DNS, refused
 * connection) as `unknown`, a backend that answered 503 as `unavailable`, and the race in
 * `firestoreService` gives up with a FirestoreTimeoutError; all three mean "no network" to the
 * player. Firebase's own messages are in English, so only the code is read and the
 * text is ours — the original goes to the console.
 *
 * These codes never cross the IPC boundary, which is why they deliberately do not live in
 * `shared/errorCodes`.
 */
function describeError(err: unknown): CatalogueError {
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
  const isNetwork = err instanceof FirestoreTimeoutError
    || code === 'unavailable'
    || code === 'unknown'
    || navigator.onLine === false

  return {
    kind: isNetwork ? 'network' : 'unknown',
    message: isNetwork ? NETWORK_MESSAGE : UNKNOWN_MESSAGE
  }
}

export function useServers(accountUsername: string | null) {
  const { showStatus } = useStatus()
  const { launchState } = useLaunch()
  const [servers, setServers] = useState<Modpack[]>([])
  const [selectedServer, setSelectedServer] = useState<Modpack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CatalogueError | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [coolingDown, setCoolingDown] = useState(false)

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

  /**
   * The sidebar's refresh button. The catalogue is read once, so a modpack published while the
   * launcher stays open only shows up when the player asks for it; what must be fresh to launch
   * already is (`prepareLaunch`). Unlike `reload` it keeps the list on screen while it reads,
   * and a failure is a toast rather than the error panel.
   *
   * No cancellation: the provider is unmounted on logout, so the account cannot change under
   * a read in flight.
   */
  const refresh = async () => {
    if (refreshing || coolingDown || launchState === 'preparing') return
    setRefreshing(true)

    try {
      const modpacks = await getModpacks(accountUsername)
      setServers(modpacks)
      setError(null)
      preloadImages(modpacks.flatMap(m => [m.banner, m.logo]))

      // The fresh copy of the selection, or none once the catalogue stops listing it — but a
      // running game keeps its modpack on screen, and `prepareLaunch` refuses it next time.
      if (selectedServer) {
        const fresh = modpacks.find(m => m.id === selectedServer.id)
        if (fresh) setSelectedServer(fresh)
        else if (launchState !== 'playing') setSelectedServer(null)
      }

      // Only after a read that went through: a failed one cost no reads and may be retried.
      setCoolingDown(true)
      setTimeout(() => setCoolingDown(false), REFRESH_COOLDOWN_MS)
    } catch (err) {
      console.error('Failed to refresh the modpack list:', err)
      showStatus(describeError(err).message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const selectServer = async (id: string) => {
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
      showStatus(errorMessage(err, 'No se ha podido seleccionar el modpack'), 'error')
    }
  }

  /**
   * Re-reads the modpack right before launching and hands the fresh copy to the main
   * process. Reading it only when the list loads would let a player who kept the
   * launcher open walk straight past a maintenance flag raised in the meantime, or launch
   * a modpack the catalogue no longer lists for them.
   */
  const prepareLaunch = async (id: string): Promise<LaunchReadiness> => {
    const fresh = await getModpack(id)

    // Deleted, disabled, unpublished or no longer open to this player: the list is stale,
    // and launching what it would not show anymore is what this check is for.
    if (!fresh || !isVisibleTo(fresh, accountUsername)) {
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

  return {
    servers,
    selectedServer,
    selectServer,
    prepareLaunch,
    loading,
    error,
    reload,
    refresh,
    refreshing,
    canRefresh: !refreshing && !coolingDown && launchState !== 'preparing'
  }
}

export type ServersState = ReturnType<typeof useServers>
