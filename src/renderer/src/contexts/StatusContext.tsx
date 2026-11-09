import { createContext, useState, useContext, useCallback, useEffect, useRef, type ReactNode } from 'react'

const VISIBLE_MS = 5000
const FADE_MS = 300

export type StatusType = 'error' | 'success' | 'info'

export interface Status {
  /** Fresh per message, so the timer bar restarts even when the same text repeats. */
  id: number
  message: string
  type: StatusType
  durationMs: number
}

interface StatusContextValue {
  status: Status | null
  visible: boolean
  showStatus: (message: string, type?: StatusType) => void
  dismissStatus: () => void
}

const StatusContext = createContext<StatusContextValue | null>(null)

/**
 * Transient messages shown at the bottom of the screen.
 *
 * This used to be a module-level `let` that the mounted StatusMessage assigned itself
 * to, which only worked as long as exactly one was mounted — and it left SettingsScreen,
 * which mounted none, unable to report anything at all. The provider sits above every
 * screen instead, so a message survives the screen it was raised on.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [visible, setVisible] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  useEffect(() => clearTimers, [])

  const idRef = useRef(0)

  const dismissStatus = useCallback(() => {
    clearTimers()
    setVisible(false)
    timersRef.current.push(setTimeout(() => setStatus(null), FADE_MS))
  }, [])

  const showStatus = useCallback((message: string, type: StatusType = 'error') => {
    clearTimers()
    // A fresh id per message, so the timer bar restarts even when the same text repeats.
    idRef.current += 1
    setStatus({ id: idRef.current, message, type, durationMs: VISIBLE_MS })
    setVisible(true)

    timersRef.current.push(setTimeout(dismissStatus, VISIBLE_MS))
  }, [dismissStatus])

  return (
    <StatusContext.Provider value={{ status, visible, showStatus, dismissStatus }}>
      {children}
    </StatusContext.Provider>
  )
}

export function useStatus(): StatusContextValue {
  const context = useContext(StatusContext)
  if (!context) throw new Error('useStatus must be used inside a StatusProvider')
  return context
}
