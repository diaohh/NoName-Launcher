import { useStatus } from '../../contexts/StatusContext'

/**
 * One look per `type` passed to `showStatus`: a light, tinted card with the icon on the left,
 * the message, a close button, and a bar along the bottom that runs out with the timer. An
 * unknown type falls back to `info` rather than to the alarming one.
 */
const STYLES = {
  error: {
    card: 'bg-red-100 border-red-400',
    badge: 'bg-red-500',
    bar: 'bg-red-700',
    // A white cross on the red badge.
    glyph: <path d="M7 7L13 13M13 7L7 13" stroke="white" strokeWidth="2" strokeLinecap="round" />
  },
  success: {
    card: 'bg-green-100 border-green-400',
    badge: 'bg-green-500',
    bar: 'bg-green-700',
    glyph: <path d="M6.5 10.2L8.9 12.6L13.5 7.6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  },
  info: {
    card: 'bg-blue-100 border-blue-400',
    badge: 'bg-blue-500',
    bar: 'bg-blue-700',
    glyph: (
      <>
        <path d="M10 9V13.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="6.5" r="1.1" fill="white" />
      </>
    )
  }
}

export default function StatusMessage() {
  const { status, visible, dismissStatus } = useStatus()

  if (!status) return null

  const style = STYLES[status.type] ?? STYLES.info

  return (
    <div
      role={status.type === 'error' ? 'alert' : 'status'}
      className={`relative overflow-hidden flex items-center gap-3 pl-4 pr-3 py-3 rounded-xl border ${style.card} shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-opacity duration-300 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0'
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={`shrink-0 rounded-full ${style.badge}`}>
        {style.glyph}
      </svg>

      <span className="flex-1 text-sm font-medium text-neutral-800 select-text">{status.message}</span>

      <button
        type="button"
        onClick={dismissStatus}
        aria-label="Cerrar"
        className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-black/5 transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Keyed by id so the countdown restarts with every new message. */}
      <div
        key={status.id}
        className={`absolute bottom-0 left-0 h-1 w-full origin-left ${style.bar}`}
        style={{ animation: `toast-timer ${status.durationMs}ms linear forwards` }}
      />
    </div>
  )
}
