import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useStatus } from '../../contexts/StatusContext'
import SkinHead from '../common/SkinHead'

const MENU_ITEM = 'w-full text-left text-sm rounded px-2 py-1.5 transition-colors duration-200 cursor-pointer bg-transparent border-none'

export default function UserProfile({ onOpenSettings }) {
  const { account, logout, skinTexture } = useAuth()
  const { showStatus } = useStatus()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!account) return null

  const handleLogout = async () => {
    setMenuOpen(false)
    try {
      await logout()
    } catch (err) {
      showStatus(err.message || 'No se ha podido cerrar la sesion', 'error')
    }
  }

  return (
    <div className="absolute top-[30px] right-[30px] z-20" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={account.displayName}
        className="w-[50px] h-[50px] rounded-xl border-2 border-sidebar-border overflow-hidden bg-[#111] flex items-center justify-center transition-all duration-300 hover:border-accent-green hover:shadow-[0_0_15px_rgba(74,222,128,0.2)] cursor-pointer"
      >
        {/* The head is drawn from the skin texture main reads from Mojang. Until it arrives,
            or when it cannot, the name's initial stands in: a local fallback cannot fail. */}
        {skinTexture ? (
          <SkinHead texture={skinTexture} size={40} className="rounded-md overflow-hidden" />
        ) : (
          <span className="text-lg font-black uppercase text-white/60">
            {account.displayName.charAt(0)}
          </span>
        )}
      </button>

      {menuOpen && (
        <div className="absolute top-[60px] right-0 bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-white/10 rounded-lg p-4 min-w-[220px] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          <div className="mb-3 pb-3 border-b border-white/10">
            <p className="font-bold text-sm text-white">{account.displayName}</p>
            <p className="text-[10px] text-white/40 mt-1 font-mono">{account.uuid}</p>
          </div>

          <button
            onClick={() => { setMenuOpen(false); onOpenSettings() }}
            className={`${MENU_ITEM} text-white/70 hover:text-white hover:bg-white/5 mb-1`}
          >
            Configuracion
          </button>

          <button
            onClick={handleLogout}
            className={`${MENU_ITEM} text-red-400 hover:text-red-300 hover:bg-white/5`}
          >
            Cerrar sesion
          </button>
        </div>
      )}
    </div>
  )
}
