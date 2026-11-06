import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react'
import { ipc } from '../services/ipcClient'
import { phasePercent } from '../services/launchPhases'

const LaunchContext = createContext()

// `type` is the launch phase, which places the event on the tracker; `phase` is what the
// header names, and for `download` it is MinecraftDownloadManager's own sub-phase instead.
const IDLE_PROGRESS = { type: '', phase: '', message: '', current: 0, total: 0, percent: null }

// The viewer keeps the tail only; the full game log is in the instance's own logs/latest.log.
const MAX_LOG_LINES = 500

export function LaunchProvider({ children }) {
  const [launchState, setLaunchState] = useState('idle')
  const [progress, setProgress] = useState(IDLE_PROGRESS)
  const [logs, setLogs] = useState([])
  const [gameRunning, setGameRunning] = useState(false)
  const [lastError, setLastError] = useState(null)
  // The tracker's last step, fed by milestones in the game's own output once the JVM is up:
  // `{ percent, message, done }`, `percent` null while no milestone has been recognised. Null
  // outside a startup — before the first `started`, and after a reload that found the game
  // already running, when there is nothing left to measure.
  const [startup, setStartup] = useState(null)
  // The bar must never retreat, whatever order the events arrive in.
  const maxPercentRef = useRef(0)

  /** One line or several of the same kind: game output arrives a chunk of lines at a time. */
  const addLog = useCallback((messages, type) => {
    const timestamp = new Date().toLocaleTimeString()
    const entries = [].concat(messages).map(message => ({ message, type, timestamp }))
    setLogs(prev => [...prev, ...entries].slice(-MAX_LOG_LINES))
  }, [])

  // IPC subscription; the function onProgress hands back is the cleanup.
  useEffect(() => {
    const unsubscribe = ipc.launch.onProgress((data) => {
      switch (data.type) {
        case 'auth':
        case 'manifest':
        case 'validation':
        case 'download_mods':
        case 'modloader':
        case 'download':
        case 'download_libraries':
        case 'java':
        case 'java_discover':
        case 'java_download':
        case 'java_extract':
        case 'launch':
          setProgress(prev => {
            const newPhase = data.phase || data.type
            const phaseChanged = newPhase !== prev.phase
            const current = phaseChanged ? (data.current ?? 0) : (data.current ?? prev.current)
            const total = phaseChanged ? (data.total ?? 0) : (data.total ?? prev.total)

            const percent = phasePercent(data.type, current, total)
            if (percent != null) {
              maxPercentRef.current = Math.max(maxPercentRef.current, percent)
            }

            return {
              type: data.type,
              phase: newPhase,
              message: data.message,
              current,
              total,
              percent: percent == null ? prev.percent : maxPercentRef.current
            }
          })
          break
        case 'started':
          setLaunchState('playing')
          setGameRunning(true)
          // Up front, so the bars do not blink out between `started` and the first report.
          setStartup({ percent: null, message: 'Arrancando Java...', done: false })
          addLog(`Minecraft iniciado (PID: ${data.pid})`, 'system')
          break
        case 'game_startup':
          // A step of its own, not a slice of PHASE_RANGE: the preparation is at 100% by now.
          setStartup({ percent: data.current, message: data.message, done: Boolean(data.done) })
          break
        case 'stdout':
          addLog(data.lines, 'info')
          break
        case 'stderr':
          addLog(data.lines, 'warn')
          break
        case 'exit':
          addLog(`Minecraft cerrado (codigo: ${data.code})`, 'system')
          setLaunchState('idle')
          setGameRunning(false)
          setStartup(null)
          break
        case 'error':
          addLog(data.error, 'error')
          setLastError({ code: data.code, message: data.error })
          setLaunchState('error')
          // Errors only come out of the preparation, before any game is running; the kill
          // button must not stay up next to a launch that never started.
          setGameRunning(false)
          break
      }
    })

    return unsubscribe
  }, [addLog])

  // The game lives in the main process, so a renderer reload loses every trace of it. Without
  // this the UI would believe nothing is running and the kill button would never appear.
  useEffect(() => {
    let ignore = false

    ipc.launch.getStatus()
      .then(status => {
        if (ignore || !status?.running) return
        setGameRunning(true)
        setLaunchState('playing')
        addLog(`Minecraft ya estaba en ejecucion (PID: ${status.pid})`, 'system')
      })
      .catch(err => {
        console.error('Failed to read the launch status:', err)
      })

    return () => { ignore = true }
  }, [addLog])

  const launch = async () => {
    setLaunchState('preparing')
    setLogs([])
    setLastError(null)
    setStartup(null)
    maxPercentRef.current = 0
    setProgress({ ...IDLE_PROGRESS, message: 'Iniciando...' })
    try {
      await ipc.launch.game()
      setProgress(prev => ({ ...prev, phase: 'Completado', message: 'Minecraft iniciado!', current: 100, total: 100, percent: 100 }))
    } catch (err) {
      setLaunchState('error')
      throw err
    }
  }

  const resetState = () => {
    setLaunchState('idle')
    setLastError(null)
    setStartup(null)
    maxPercentRef.current = 0
    setProgress(IDLE_PROGRESS)
  }

  return (
    <LaunchContext.Provider value={{ launchState, progress, startup, logs, gameRunning, lastError, launch, resetState }}>
      {children}
    </LaunchContext.Provider>
  )
}

export function useLaunch() {
  return useContext(LaunchContext)
}
