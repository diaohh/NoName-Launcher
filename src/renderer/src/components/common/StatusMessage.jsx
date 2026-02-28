import { useState, useEffect, useRef } from 'react'

let setStatusGlobal = null

export function showStatus(message, type = 'info') {
  if (setStatusGlobal) {
    setStatusGlobal({ message, type })
  }
}

const typeClasses = {
  info: 'bg-blue-500/30',
  success: 'bg-green-500/30',
  error: 'bg-red-500/30',
}

export default function StatusMessage() {
  const [status, setStatus] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    setStatusGlobal = (data) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setStatus(data)
      timerRef.current = setTimeout(() => setStatus(null), 5000)
    }

    return () => {
      setStatusGlobal = null
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!status) return null

  return (
    <div className={`mt-5 p-2.5 rounded text-sm ${typeClasses[status.type]}`}>
      {status.message}
    </div>
  )
}
