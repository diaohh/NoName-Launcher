import { useEffect, useState } from 'react'
import { ipc } from '../../services/ipcClient'

const DRAG = '[-webkit-app-region:drag]'
const NO_DRAG = '[-webkit-app-region:no-drag]'

function WindowButton({ onClick, label, danger = false, children }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${NO_DRAG} w-[46px] h-full flex items-center justify-center bg-transparent border-none text-white/50 cursor-pointer transition-colors duration-150 ${
        danger ? 'hover:bg-accent-wine hover:text-white' : 'hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The window's title bar. The window is frameless (`frame: false` in main/index) so the
 * native one does not break the glass; this replaces it. The whole strip drags the window,
 * a double click on it maximizes like the native one, and only the buttons opt out.
 *
 * It sits above the modal overlay (z-50) on purpose: the window must stay movable and
 * closable while a dialog is open.
 */
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  // The window state lives in main and changes behind the renderer's back (a double click on
  // the drag region, a snap to the screen edge, Win+Up), which is what makes this an effect.
  useEffect(() => {
    let ignore = false

    const unsubscribe = ipc.window.onMaximizedChanged((value) => setMaximized(Boolean(value)))

    ipc.window.isMaximized()
      .then(value => { if (!ignore) setMaximized(Boolean(value)) })
      .catch(err => {
        // Only the icon of one button depends on it, and the next change event corrects it.
        // Not worth a message to the player.
        console.error('Failed to read the window state:', err)
      })

    return () => {
      ignore = true
      unsubscribe()
    }
  }, [])

  return (
    <div className={`${DRAG} relative z-[60] h-8 shrink-0 flex items-stretch justify-between select-none bg-black/20 border-b border-white/5`}>
      <span className="flex items-center pl-4 text-[11px] font-black tracking-[2px] uppercase text-white/40">
        NONAME<span className="text-accent-green">_</span>
      </span>

      <div className="flex items-stretch">
        <WindowButton onClick={ipc.window.minimize} label="Minimizar">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M0.5 5H9.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>

        <WindowButton onClick={ipc.window.maximize} label={maximized ? 'Restaurar' : 'Maximizar'}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
              <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </WindowButton>

        <WindowButton onClick={ipc.window.close} label="Cerrar" danger>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>
      </div>
    </div>
  )
}
