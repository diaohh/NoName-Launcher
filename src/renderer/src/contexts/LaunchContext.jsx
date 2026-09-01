import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react'
import { ipc } from '../services/ipcClient'
import { phasePercent } from '../services/launchPhases'

const LaunchContext = createContext()

const IDLE_PROGRESS = { phase: '', message: '', current: 0, total: 0, percent: null }

export function LaunchProvider({ children }) {
  const [launchState, setLaunchState] = useState('idle')
  const [progress, setProgress] = useState(IDLE_PROGRESS)
  const [logs, setLogs] = useState([])
  const [gameRunning, setGameRunning] = useState(false)
  const [lastError, setLastError] = useState(null)
  const cleanupRef = useRef(null)
  // The bar must never retreat, whatever order the events arrive in.
  const maxPercentRef = useRef(0)

  const addLog = useCallback((message, type) => {
    setLogs(prev => {
      const newLogs = [...prev, { message, type, timestamp: new Date().toLocaleTimeString() }]
      return newLogs.slice(-500)
    })
  }, [])

  useEffect(() => {
    cleanupRef.current = ipc.launch.onProgress((data) => {
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
          addLog(`Minecraft iniciado (PID: ${data.pid})`, 'system')
          break
        case 'stdout':
          addLog(data.data, 'info')
          break
        case 'stderr':
          addLog(data.data, 'warn')
          break
        case 'exit':
          addLog(`Minecraft cerrado (codigo: ${data.code})`, 'system')
          setLaunchState('idle')
          setGameRunning(false)
          break
        case 'error':
          addLog(data.error, 'error')
          setLastError({ code: data.code, message: data.error })
          setLaunchState('error')
          break
      }
    })

    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
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
    maxPercentRef.current = 0
    setProgress({ ...IDLE_PROGRESS, message: 'Iniciando...' })
    try {
      await ipc.launch.game()
      setProgress({ phase: 'Completado', message: 'Minecraft iniciado!', current: 100, total: 100, percent: 100 })
    } catch (err) {
      setLaunchState('error')
      throw err
    }
  }

  const resetState = () => {
    setLaunchState('idle')
    setLastError(null)
    maxPercentRef.current = 0
    setProgress(IDLE_PROGRESS)
  }

  return (
    <LaunchContext.Provider value={{ launchState, progress, logs, gameRunning, lastError, launch, resetState }}>
      {children}
    </LaunchContext.Provider>
  )
}

export function useLaunch() {
  return useContext(LaunchContext)
}
