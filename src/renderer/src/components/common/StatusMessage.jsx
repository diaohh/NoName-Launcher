import { useState, useEffect, useRef } from 'react'

let setStatusGlobal = null

export function showStatus(message, type = 'error') {
  if (setStatusGlobal) {
    setStatusGlobal({ message, type })
  }
}

export default function StatusMessage() {
  const [status, setStatus] = useState(null)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    setStatusGlobal = (data) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setStatus(data)
      setVisible(true)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        setTimeout(() => setStatus(null), 300)
      }, 5000)
    }

    return () => {
      setStatusGlobal = null
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!status) return null

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-red-500/30 shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M8 4.5V9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="#ef4444" />
      </svg>
      <span className="text-sm text-white/80">{status.message}</span>
    </div>
  )
}
