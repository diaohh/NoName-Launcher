import { createContext, useContext } from 'react'
import { useServers as useServersHook } from '../hooks/useServers'

const ServersContext = createContext()

export function ServersProvider({ children, accountUsername }) {
  const serversState = useServersHook(accountUsername)
  return (
    <ServersContext.Provider value={serversState}>
      {children}
    </ServersContext.Provider>
  )
}

export function useServers() {
  return useContext(ServersContext)
}
