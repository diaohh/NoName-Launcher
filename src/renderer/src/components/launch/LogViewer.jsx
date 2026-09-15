import { useState, useRef, useEffect, useCallback } from 'react'
import { useLaunch } from '../../contexts/LaunchContext'
import Modal from '../common/Modal'

const logColors = {
  info: 'text-accent-green/80',
  warn: 'text-yellow-400/80',
  error: 'text-red-400/80',
  system: 'text-blue-400/80',
}

// Anything within this many pixels of the bottom counts as "following the tail".
const AT_BOTTOM_SLACK = 24

export default function LogViewer() {
  const { logs, gameRunning, launchState } = useLaunch()
  const [visible, setVisible] = useState(false)
  const scrollRef = useRef(null)
  // Only follow the tail while the reader is already at the tail: forcing the bottom would
  // yank them away from the error they scrolled up to read, which is when logs get opened.
  const atBottomRef = useRef(true)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK
  }

  // The scroll position is imperative DOM the tree cannot express, which is what keeps this
  // an effect. It runs on every appended line, and on the mount of the modal's own body.
  useEffect(() => {
    if (visible && atBottomRef.current) scrollToBottom()
  }, [logs, visible])

  const handleOpen = () => {
    // A freshly opened panel always starts at the newest line.
    atBottomRef.current = true
    setVisible(true)
  }

  const handleClose = useCallback(() => setVisible(false), [])

  if (logs.length === 0 && !gameRunning && launchState !== 'error') return null

  // Past a hundred the exact count stops meaning anything and only makes the label jump.
  const counter = logs.length > 99 ? '+99' : logs.length

  return (
    <div className="mt-2">
      <button
        className="text-white/30 text-xs hover:text-white/60 transition-colors cursor-pointer bg-transparent border-none"
        onClick={handleOpen}
      >
        Mostrar Logs ({counter})
      </button>

      <Modal open={visible} onClose={handleClose} title="Logs" size="max-w-[820px]">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-[60vh] overflow-y-auto px-5 py-4 font-mono text-[11px] leading-[1.5] select-text"
        >
          {logs.length === 0 ? (
            <p className="text-white/30">Todavia no hay ninguna linea.</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`my-0.5 break-all ${logColors[log.type]}`}>
                <span className="text-white/20">[{log.timestamp}]</span> {log.message}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  )
}
