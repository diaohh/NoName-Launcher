import { createContext, useState, useEffect, useContext, useCallback } from 'react'
import { ipc } from '../services/ipcClient'
import { useStatus } from './StatusContext'
import { isTerminalAuthCode } from '../../../shared/errorCodes'

const AuthContext = createContext()

const EXPIRED_MESSAGE = 'Tu sesion ha caducado. Vuelve a iniciar sesion.'

export function AuthProvider({ children }) {
  const { showStatus } = useStatus()
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  // The texture of the skin the account is wearing, for the avatar. Stored with the uuid it
  // belongs to, so a different account never shows the previous one's face.
  const [skin, setSkin] = useState(null)

  // Fetch on mount: the account the main process already has on disk. A failure lands on the
  // login screen, which is the one thing the launcher can still offer without an account —
  // but it says why instead of pretending there was never a session.
  useEffect(() => {
    let ignore = false

    ipc.auth.getAccount()
      .then(acc => {
        if (!ignore) setAccount(acc)
      })
      .catch(err => {
        if (ignore) return
        console.error('Failed to read the stored account:', err)
        showStatus(err.message || 'No se ha podido leer la sesion guardada', 'error')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => { ignore = true }
  }, [showStatus])

  // IPC subscription, kept apart from the fetch above so neither one's lifecycle drags the
  // other along. Main only fires this for a terminal failure; a network blip never gets here.
  useEffect(() => ipc.events.onTokenExpired((payload) => {
    setAccount(null)
    showStatus(payload?.message || EXPIRED_MESSAGE, 'error')
  }), [showStatus])

  const uuid = account?.uuid

  // Fetch per account: the skin it is wearing, read from Mojang through main. Until it
  // arrives, or if it never does, the avatar shows the name's initial — nothing waits on it,
  // so a network failure is only logged. A dead session is the exception: main has already
  // dropped the account, and staying on the home screen would only fail at JUGAR.
  useEffect(() => {
    if (!uuid) return

    let ignore = false

    ipc.skins.getActiveTexture()
      .then(texture => {
        if (!ignore) setSkin({ uuid, texture })
      })
      .catch(err => {
        if (ignore) return
        if (isTerminalAuthCode(err.code)) {
          setAccount(null)
          showStatus(err.message || EXPIRED_MESSAGE, 'error')
          return
        }
        console.warn('Could not read the current skin for the avatar:', err)
      })

    return () => { ignore = true }
  }, [uuid, showStatus])

  // `skin` is checked on its own: before the account loads both uuids are undefined, and
  // `skin?.uuid === uuid` alone would be true with no texture to read.
  const skinTexture = skin && uuid && skin.uuid === uuid ? skin.texture : null

  /** Called by the skin manager after a save, with the texture now being worn. */
  const updateSkinTexture = useCallback((texture) => {
    setSkin({ uuid, texture })
  }, [uuid])

  const login = async () => {
    const code = await ipc.auth.msftLogin()
    const acc = await ipc.auth.login(code)
    setAccount(acc)
    return acc
  }

  // Stable per account, so screens can list it among the dependencies of their own loads.
  const logout = useCallback(async () => {
    if (uuid) {
      await ipc.auth.logout(uuid)
      setAccount(null)
    }
  }, [uuid])

  return (
    <AuthContext.Provider value={{ account, loading, login, logout, skinTexture, updateSkinTexture }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
