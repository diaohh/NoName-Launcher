import { createContext, useState, useEffect, useContext } from 'react'
import { ipc } from '../services/ipcClient'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ipc.auth.getAccount().then(acc => {
      setAccount(acc)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })

    const cleanup = ipc.events.onTokenExpired(() => {
      setAccount(null)
    })
    return cleanup
  }, [])

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
