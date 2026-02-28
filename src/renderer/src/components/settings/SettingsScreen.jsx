import { useState, useEffect } from 'react'
import { ipc } from '../../services/ipcClient'
import JavaSection from './JavaSection'
import GameSection from './GameSection'
import LauncherSection from './LauncherSection'

export default function SettingsScreen({ onBack }) {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    ipc.config.getSettings().then(setSettings)
  }, [])

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (!settings) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#1a1a1e] font-inter text-white">
        <p className="text-white/30 text-sm">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#1a1a1e] font-inter text-white">
      <div className="flex items-center gap-4 px-8 pt-8 pb-6">
        <button
          onClick={onBack}
          className="bg-transparent border-none text-white/50 hover:text-white cursor-pointer p-2 rounded hover:bg-white/5 transition-all duration-200"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h1 className="text-2xl font-black uppercase tracking-[-1px]">
          Configuracion
        </h1>
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
