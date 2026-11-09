import { useCallback, useEffect, useEffectEvent, useState, type Dispatch, type SetStateAction } from 'react'

export interface IpcResource<T> {
  /** Null until the first load succeeds. */
  data: T | null
  /** True from mount, and from every `reload`, until the load settles. */
  loading: boolean
  /** The last load failed. `onError` has already been told why. */
  failed: boolean
  /** Runs the load again. `data` stays as it is until the new one arrives. */
  reload: () => void
  /** For what the screen changes itself: an edit shown before main confirms it, or what main answered with. */
  setData: Dispatch<SetStateAction<T | null>>
}

/**
 * A read on mount, with its loading and error states (ADR-0008): the account on disk, the
 * settings, the skin manager's profile and vault. Each screen used to carry its own copy of
 * this machine.
 *
 * `load` is the external system the effect synchronises with, so it is the effect's dependency:
 * pass a module-level function (`ipc.config.getSettings`) or a `useCallback`, or every render
 * starts the read over. It can do more than one IPC call — the skin manager post-processes the
 * textures it receives.
 *
 * `onError` runs once per failed load, from the effect, and is read when the load fails rather
 * than when it starts, so an inline arrow is fine. It is where the failure reaches the player
 * (`useStatus()`); without one the screen would sit on its loading state with nothing said.
 */
export function useIpcResource<T>(load: () => Promise<T>, onError?: (err: unknown) => void): IpcResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const reportError = useEffectEvent((err: unknown) => onError?.(err))

  useEffect(() => {
    // StrictMode runs this twice and `reload` re-runs it: an older answer that lands after a
    // newer one must not overwrite it. The flags are reset by `reload`, in the handler that
    // asks for the retry, not here: that would be a synchronous setState in the effect body.
    let ignore = false

    load()
      .then(value => {
        if (ignore) return
        setData(value)
        setLoading(false)
      })
      .catch(err => {
        if (ignore) return
        setFailed(true)
        setLoading(false)
        reportError(err)
      })

    return () => { ignore = true }
  }, [load, attempt])

  const reload = useCallback(() => {
    setLoading(true)
    setFailed(false)
    setAttempt(n => n + 1)
  }, [])

  return { data, loading, failed, reload, setData }
}
