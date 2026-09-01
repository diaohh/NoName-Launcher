import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Centered dialog on the launcher's glass surface.
 *
 * Rendered through a portal so it escapes the stacking contexts of the home screen, whose
 * background, sidebar and launch overlay all carry their own z-index.
 *
 * @param {boolean} open
 * @param {() => void} onClose   Called by Escape, the backdrop and the close button.
 * @param {string} title
 * @param {React.ReactNode} [footer]  Action row pinned under the scrollable body.
 * @param {string} [size]        Tailwind max-width class for the panel.
 */
export default function Modal({ open, onClose, title, footer, size = 'max-w-[560px]', children }) {
  const panelRef = useRef(null)

  // The keyboard is outside the React tree, which is the whole reason this is an effect.
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    // The overlay stays nearly transparent on purpose. backdrop-filter blurs everything
    // painted behind the element it sits on, the overlay's own background included, so a
    // solid scrim here would leave the panel blurring a flat wash and no glass would show.
    // Dimming belongs to the overlay, the blur to the panel.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${size} max-h-[80vh] flex flex-col bg-[rgba(18,18,20,0.55)] backdrop-blur-[28px] backdrop-saturate-150 border border-white/10 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] focus:outline-none`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="bg-transparent border-none text-white/40 hover:text-white cursor-pointer p-1 rounded hover:bg-white/5 transition-all duration-200"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>

        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
