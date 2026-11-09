import { createContext, useContext, type ReactNode } from 'react'
import { useServers as useServersHook, type ServersState } from '../hooks/useServers'

const ServersContext = createContext<ServersState | null>(null)

interface ServersProviderProps {
  children: ReactNode
  accountUsername: string | null
}

export function ServersProvider({ children, accountUsername }: ServersProviderProps) {
  const serversState = useServersHook(accountUsername)
  return (
    <ServersContext.Provider value={serversState}>
      {children}
    </ServersContext.Provider>
  )
}

export function useServers(): ServersState {
  const context = useContext(ServersContext)
  if (!context) throw new Error('useServers must be used inside a ServersProvider')
  return context
}
