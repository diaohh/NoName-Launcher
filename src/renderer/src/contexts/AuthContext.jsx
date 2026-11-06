import { createContext, useState, useEffect, useContext } from 'react'
import { ipc } from '../services/ipcClient'
import { useStatus } from './StatusContext'

const AuthContext = createContext()

const EXPIRED_MESSAGE = 'Tu sesion ha caducado. Vuelve a iniciar sesion.'

export function AuthProvider({ children }) {
  const { showStatus } = useStatus()
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)

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

  const login = async () => {
    const code = await ipc.auth.msftLogin()
    const acc = await ipc.auth.login(code)
    setAccount(acc)
    return acc
  }

  const logout = async () => {
    if (account) {
      await ipc.auth.logout(account.uuid)
      setAccount(null)
    }
  }

  return (
    <AuthContext.Provider value={{ account, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
