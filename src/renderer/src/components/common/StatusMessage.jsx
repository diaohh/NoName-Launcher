import { useStatus } from '../../contexts/StatusContext'

/**
 * One look per `type` passed to `showStatus`. Everything used to render as an error, so a
 * confirmation would have arrived dressed as a failure. An unknown type falls back to `info`
 * rather than to the alarming one.
 */
const STYLES = {
  error: {
    border: 'border-red-500/30',
    icon: (
      <>
        <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M8 4.5V9" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="#ef4444" />
      </>
    )
  },
  success: {
    border: 'border-accent-green/30',
    icon: (
      <>
        <circle cx="8" cy="8" r="7" stroke="#4ade80" strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M5 8.2L7.1 10.3L11 6" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )
  },
  info: {
    border: 'border-accent-blue/30',
    icon: (
      <>
        <circle cx="8" cy="8" r="7" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.7" />
        <path d="M8 7.5V11.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="4.75" r="0.75" fill="#3b82f6" />
      </>
    )
  }
}

export default function StatusMessage() {
  const { status, visible } = useStatus()

  if (!status) return null

  const style = STYLES[status.type] ?? STYLES.info

  return (
    <div
      role={status.type === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border ${style.border} shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
        {style.icon}
      </svg>
      <span className="text-sm text-white/80">{status.message}</span>
    </div>
  )
}
