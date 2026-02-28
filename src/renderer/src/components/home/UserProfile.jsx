import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'

export default function UserProfile({ onOpenSettings }) {
  const { account, logout } = useAuth()
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

  const avatarUrl = `https://minotar.net/armor/bust/${account.uuid}/100.png`

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
  }

  return (
    <div className="absolute top-[30px] right-[30px] z-20" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="w-[50px] h-[50px] rounded-full border-2 border-sidebar-border overflow-hidden bg-[#111] transition-all duration-300 hover:border-accent-green hover:shadow-[0_0_15px_rgba(74,222,128,0.2)] cursor-pointer"
      >
        <img
          src={avatarUrl}
          alt={account.displayName}
          className="w-full h-full"
          style={{ imageRendering: 'pixelated' }}
          onError={(e) => {
            e.target.src = 'https://minotar.net/armor/bust/MHF_Steve/100.png'
          }}
        />
      </button>

      {menuOpen && (
        <div className="absolute top-[60px] right-0 bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-white/10 rounded-lg p-4 min-w-[220px] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          <div className="mb-3 pb-3 border-b border-white/10">
            <p className="font-bold text-sm text-white">{account.displayName}</p>
            <p className="text-[10px] text-white/40 mt-1 font-mono">{account.uuid}</p>
          </div>

          <button
            onClick={() => { setMenuOpen(false); onOpenSettings() }}
            className="w-full text-left text-sm text-white/70 hover:text-white hover:bg-white/5 rounded px-2 py-1.5 transition-colors duration-200 cursor-pointer bg-transparent border-none mb-1"
          >
            Configuracion
          </button>

          <button
            onClick={handleLogout}
            className="w-full text-left text-sm text-red-400 hover:text-red-300 hover:bg-white/5 rounded px-2 py-1.5 transition-colors duration-200 cursor-pointer bg-transparent border-none"
          >
            Cerrar sesion
          </button>
        </div>
      )}
    </div>
  )
}
