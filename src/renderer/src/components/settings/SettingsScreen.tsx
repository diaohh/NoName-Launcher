import { ipc } from '../../services/ipcClient'
import { errorMessage } from '../../services/errors'
import { useIpcResource } from '../../hooks/useIpcResource'
import { useStatus } from '../../contexts/StatusContext'
import type { LauncherSettings } from '../../../../shared/ipcContract'
import JavaSection from './JavaSection'
import GameSection from './GameSection'
import LauncherSection from './LauncherSection'

/** For values main has already stored and answered with (RAM, data directory, Java path). */
export type UpdateSetting = <K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]) => void

/** Shows `changes` at once, writes them through `persist`, and reverts them if main refuses. */
export type SaveSettings = (
  changes: Partial<LauncherSettings>,
  persist: () => Promise<unknown>,
  failureMessage: string
) => Promise<void>

function CloseButton({ onClick }: { onClick: () => void }) {
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

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { showStatus } = useStatus()

  const { data: settings, setData: setSettings, failed } = useIpcResource(ipc.config.getSettings, (err) => {
    // Without this the screen sat on "Cargando..." forever, with nothing in the log and
    // nothing on screen — on the very screen StatusContext was introduced for.
    console.error('Failed to load settings:', err)
    showStatus(errorMessage(err, 'No se han podido cargar los ajustes'), 'error')
  })

  /** For values main has already stored and answered with (RAM, data directory, Java path). */
  const updateSetting: UpdateSetting = (key, value) => {
    setSettings(prev => prev && { ...prev, [key]: value })
  }

  /**
   * Shows `changes` at once and writes them through `persist`. If main rejects the value
   * (CONFIG_INVALID_VALUE) or cannot write it (CONFIG_SAVE_FAILED), the screen goes back to
   * what is actually stored and says why: it never shows a value the disk did not receive.
   */
  const saveSettings: SaveSettings = async (changes, persist, failureMessage) => {
    if (!settings) return
    const keys = Object.keys(changes) as (keyof LauncherSettings)[]
    const previous: Partial<LauncherSettings> = Object.fromEntries(keys.map(key => [key, settings[key]]))
    setSettings(prev => prev && { ...prev, ...changes })

    try {
      await persist()
    } catch (err) {
      setSettings(prev => prev && { ...prev, ...previous })
      showStatus(errorMessage(err, failureMessage), 'error')
    }
  }

  if (!settings) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-4 bg-[#1a1a1e] font-inter text-white">
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
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#1a1a1e] font-inter text-white">
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
            <JavaSection settings={settings} onUpdate={updateSetting} onSave={saveSettings} />
          </section>

          <div className="border-t border-white/5" />

          <section>
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4">Juego</h2>
            <GameSection settings={settings} onSave={saveSettings} />
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
