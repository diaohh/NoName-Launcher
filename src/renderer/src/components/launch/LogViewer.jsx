import { useState, useRef, useEffect, useCallback } from 'react'
import { useLaunch } from '../../contexts/LaunchContext'
import { useStatus } from '../../contexts/StatusContext'
import { ipc } from '../../services/ipcClient'
import Modal from '../common/Modal'

const logColors = {
  info: 'text-accent-green/80',
  warn: 'text-yellow-400/80',
  error: 'text-red-400/80',
  system: 'text-blue-400/80',
}

// Anything within this many pixels of the bottom counts as "following the tail".
const AT_BOTTOM_SLACK = 24

/**
 * The lines as plain text, with a header saying where they came from: an exported log
 * usually ends up in someone else's hands, and the launcher version is the first question.
 */
function logsAsText(logs) {
  const header = `NoNameLauncher ${__APP_VERSION__} · ${new Date().toLocaleString()}`
  const lines = logs.map(log => `[${log.timestamp}] ${log.message}`)
  return [header, '', ...lines, ''].join('\n')
}

function HeaderButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-transparent border-none text-xs text-white/50 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-white/5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

export default function LogViewer() {
  const { logs, gameRunning, launchState } = useLaunch()
  const { showStatus } = useStatus()
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logsAsText(logs))
      showStatus('Logs copiados al portapapeles', 'success')
    } catch (err) {
      console.error('Failed to copy the logs:', err)
      showStatus('No se han podido copiar los logs', 'error')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Null when the player closed the save dialog, which needs no message.
      const savedTo = await ipc.logs.export(logsAsText(logs))
      if (savedTo) showStatus(`Logs guardados en ${savedTo}`, 'success')
    } catch (err) {
      showStatus(err.message || 'No se han podido guardar los logs', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (logs.length === 0 && !gameRunning && launchState !== 'error') return null

  // Past a hundred the exact count stops meaning anything and only makes the label jump.
  const counter = logs.length > 99 ? '+99' : logs.length

  return (
    <>
      {/* It sits straight on the banner, with no scrim behind it, hence a glass pill of its own. */}
      <button
        className="text-white/50 text-xs px-3 py-1.5 rounded-full bg-black/35 backdrop-blur-md border border-white/10 hover:text-white hover:bg-black/50 transition-colors cursor-pointer"
        onClick={handleOpen}
      >
        Mostrar Logs ({counter})
      </button>

      <Modal
        open={visible}
        onClose={handleClose}
        title="Logs"
        size="max-w-[820px]"
        actions={
          <>
            <HeaderButton onClick={handleCopy} disabled={logs.length === 0}>Copiar</HeaderButton>
            <HeaderButton onClick={handleSave} disabled={logs.length === 0 || saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </HeaderButton>
          </>
        }
      >
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
    </>
  )
}
