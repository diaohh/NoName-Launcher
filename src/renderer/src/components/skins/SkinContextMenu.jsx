import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const MENU_WIDTH = 190
const MENU_HEIGHT = 84
const EDGE = 8

/**
 * Right-click menu of a skin in the vault, on the same glass as the profile dropdown. Drawn
 * by the launcher rather than as a native menu, which would need a round trip through main
 * for two items.
 *
 * @param {{ x: number, y: number }} position Where the click happened, in viewport px.
 */
export default function SkinContextMenu({ position, canDelete, onRename, onDelete, onClose }) {
  const menuRef = useRef(null)

  // The rest of the window is outside the React tree: a click anywhere else, Escape, or the
  // window losing focus closes the menu, the way a native one would.
  useEffect(() => {
    const handlePointer = (e) => {
      if (!menuRef.current?.contains(e.target)) onClose()
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)

    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Opened near the right or bottom edge, the menu flips inward instead of being cut off.
  const left = Math.min(position.x, window.innerWidth - MENU_WIDTH - EDGE)
  const top = Math.min(position.y, window.innerHeight - MENU_HEIGHT - EDGE)

  const item = 'w-full text-left text-sm rounded px-2 py-1.5 transition-colors duration-200 bg-transparent border-none'

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-white/10 rounded-lg p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.5)] font-inter"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        role="menuitem"
        onClick={() => { onClose(); onRename() }}
        className={`${item} text-white/70 hover:text-white hover:bg-white/5 cursor-pointer`}
      >
        Renombrar skin
      </button>
      <button
        role="menuitem"
        disabled={!canDelete}
        title={canDelete ? undefined : 'Es la skin que llevas puesta'}
        onClick={() => { onClose(); onDelete() }}
        className={`${item} text-red-400 hover:text-red-300 hover:bg-white/5 cursor-pointer disabled:text-white/25 disabled:hover:bg-transparent disabled:cursor-not-allowed`}
      >
        Eliminar skin
      </button>
    </div>,
    document.body
  )
}
