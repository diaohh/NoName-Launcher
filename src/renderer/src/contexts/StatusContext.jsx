import { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react'

const StatusContext = createContext()

const VISIBLE_MS = 5000
const FADE_MS = 300

/**
 * Transient messages shown at the bottom of the screen.
 *
 * This used to be a module-level `let` that the mounted StatusMessage assigned itself
 * to, which only worked as long as exactly one was mounted — and it left SettingsScreen,
 * which mounted none, unable to report anything at all. The provider sits above every
 * screen instead, so a message survives the screen it was raised on.
 */
export function StatusProvider({ children }) {
  const [status, setStatus] = useState(null)
  const [visible, setVisible] = useState(false)
  const timersRef = useRef([])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  useEffect(() => clearTimers, [])

  const showStatus = useCallback((message, type = 'error') => {
    clearTimers()
    setStatus({ message, type })
    setVisible(true)

    timersRef.current.push(setTimeout(() => {
      setVisible(false)
      timersRef.current.push(setTimeout(() => setStatus(null), FADE_MS))
    }, VISIBLE_MS))
  }, [])

  return (
    <StatusContext.Provider value={{ status, visible, showStatus }}>
      {children}
    </StatusContext.Provider>
  )
}

export function useStatus() {
  return useContext(StatusContext)
}
