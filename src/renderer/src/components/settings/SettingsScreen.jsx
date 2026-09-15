import { useState, useEffect } from 'react'
import { ipc } from '../../services/ipcClient'
import { useStatus } from '../../contexts/StatusContext'
import JavaSection from './JavaSection'
import GameSection from './GameSection'
import LauncherSection from './LauncherSection'

function CloseButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Cerrar"
      title="Cerrar"
      className="bg-transparent border-none text-white/50 hover:text-white cursor-pointer p-2 rounded hover:bg-white/5 transition-all duration-200"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

export default function SettingsScreen({ onBack }) {
  const { showStatus } = useStatus()
  const [settings, setSettings] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let ignore = false

    ipc.config.getSettings()
      .then(loaded => { if (!ignore) setSettings(loaded) })
      .catch(err => {
        // Without this the screen sat on "Cargando..." forever, with nothing in the log and
        // nothing on screen — on the very screen StatusContext was introduced for.
        if (ignore) return
        console.error('Failed to load settings:', err)
        setFailed(true)
        showStatus(err.message || 'No se han podido cargar los ajustes', 'error')
      })

    return () => { ignore = true }
  }, [showStatus])

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (!settings) {
    return (
      <div className="relative w-screen h-screen flex flex-col items-center justify-center gap-4 bg-[#1a1a1e] font-inter text-white">
        {/* Same spot as in the loaded header, so the way out does not depend on the load. */}
        <div className="absolute top-8 right-8">
          <CloseButton onClick={onBack} />
        </div>

        {failed ? (
          <>
            <p className="text-white/50 text-sm">No se han podido cargar los ajustes.</p>
            <button
              onClick={onBack}
              className="bg-white/5 border border-white/10 rounded px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer"
            >
              Volver
            </button>
          </>
        ) : (
          <p className="text-white/30 text-sm">Cargando...</p>
        )}
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#1a1a1e] font-inter text-white">
      <div className="flex items-center justify-between gap-4 px-8 pt-8 pb-6">
        <h1 className="text-2xl font-black uppercase tracking-[-1px]">
          Configuracion
        </h1>
        <CloseButton onClick={onBack} />
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[600px] space-y-10">
          <section>
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4">Java</h2>
            <JavaSection settings={settings} onUpdate={updateSetting} />
          </section>

          <div className="border-t border-white/5" />

          <section>
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4">Juego</h2>
            <GameSection settings={settings} onUpdate={updateSetting} />
          </section>

          <div className="border-t border-white/5" />

          <section>
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4">Launcher</h2>
            <LauncherSection settings={settings} onUpdate={updateSetting} />
          </section>
        </div>
      </div>
    </div>
  )
}
