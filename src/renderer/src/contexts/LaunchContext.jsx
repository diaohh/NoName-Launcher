import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react'
import { ipc } from '../services/ipcClient'

const LaunchContext = createContext()

export function LaunchProvider({ children }) {
  const [launchState, setLaunchState] = useState('idle')
  const [progress, setProgress] = useState({ phase: '', message: '', current: 0, total: 0 })
  const [logs, setLogs] = useState([])
  const [gameRunning, setGameRunning] = useState(false)
  const cleanupRef = useRef(null)

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
        case 'validation':
        case 'download_mods':
        case 'modloader':
        case 'download':
        case 'java':
        case 'java_download':
        case 'java_extract':
        case 'launch':
          setProgress(prev => {
            const newPhase = data.phase || data.type
            const phaseChanged = newPhase !== prev.phase
            return {
              phase: newPhase,
              message: data.message,
              current: phaseChanged ? (data.current ?? 0) : (data.current ?? prev.current),
              total: phaseChanged ? (data.total ?? 0) : (data.total ?? prev.total)
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
          setLaunchState('error')
          break
      }
    })

    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [addLog])

  const launch = async () => {
    setLaunchState('preparing')
    setLogs([])
    setProgress({ phase: '', message: 'Iniciando...', current: 0, total: 0 })
    try {
      await ipc.launch.game()
      setProgress({ phase: 'Completado', message: 'Minecraft iniciado!', current: 100, total: 100 })
    } catch (err) {
      setLaunchState('error')
      throw err
    }
  }

  const resetState = () => {
    setLaunchState('idle')
    setProgress({ phase: '', message: '', current: 0, total: 0 })
  }

  return (
    <LaunchContext.Provider value={{ launchState, progress, logs, gameRunning, launch, resetState }}>
      {children}
    </LaunchContext.Provider>
  )
}

export function useLaunch() {
  return useContext(LaunchContext)
}
