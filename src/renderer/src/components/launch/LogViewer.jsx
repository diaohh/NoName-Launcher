import { useState, useRef, useEffect } from 'react'
import { useLaunch } from '../../contexts/LaunchContext'

const logColors = {
  info: 'text-accent-green/80',
  warn: 'text-yellow-400/80',
  error: 'text-red-400/80',
  system: 'text-blue-400/80',
}

export default function LogViewer() {
  const { logs, gameRunning, launchState } = useLaunch()
  const [visible, setVisible] = useState(false)
  const logsEndRef = useRef(null)

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight
    }
  }, [logs])

  if (logs.length === 0 && !gameRunning && launchState !== 'error') return null

  if (!visible) {
    return (
      <div className="mt-2">
        <button
          className="text-white/30 text-xs hover:text-white/60 transition-colors cursor-pointer bg-transparent border-none"
          onClick={() => setVisible(true)}
        >
          Mostrar Logs ({logs.length})
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 bg-black/60 rounded-lg overflow-hidden max-h-[180px] flex flex-col border border-white/5">
      <div className="flex justify-between items-center px-3 py-2 border-b border-white/5">
        <span className="font-bold text-xs text-white/60">Logs</span>
        <button
          className="text-white/30 text-xs hover:text-white/60 transition-colors cursor-pointer bg-transparent border-none"
          onClick={() => setVisible(false)}
        >
          Ocultar
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-[1.4]" ref={logsEndRef}>
        {logs.map((log, i) => (
          <div key={i} className={`my-0.5 ${logColors[log.type]}`}>
            <span className="text-white/20">[{log.timestamp}]</span> {log.message}
          </div>
        ))}
      </div>
    </div>
  )
}
