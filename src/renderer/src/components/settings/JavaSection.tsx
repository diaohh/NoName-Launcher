import { useState } from 'react'
import { ipc } from '../../services/ipcClient'
import { errorMessage } from '../../services/errors'
import { useStatus } from '../../contexts/StatusContext'
import type { LauncherSettings } from '../../../../shared/ipcContract'
import type { SaveSettings, UpdateSetting } from './SettingsScreen'
import ToggleSwitch from './ToggleSwitch'

const formatGB = (mb: number) => `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`

interface JavaSectionProps {
  settings: LauncherSettings
  onUpdate: UpdateSetting
  onSave: SaveSettings
}

export default function JavaSection({ settings, onUpdate, onSave }: JavaSectionProps) {
  const { showStatus } = useStatus()
  // Mirrors the input while it is being typed, so a half-written number is not written to
  // disk on every keystroke. Null means "show whatever the settings say".
  const [draftRam, setDraftRam] = useState<number | null>(null)

  const step = settings.ramStepMB
  const minRam = settings.minAllowedRamMB
  const maxRam = settings.maxAllowedRamMB
  // Empty when the stored value cannot be read as an amount of memory, as it showed before.
  const currentRam = draftRam ?? settings.maxRamMB ?? ''

  const handlePickJava = async () => {
    // Main rejects anything that is not a java/javaw executable, so the field only changes
    // once the path has actually been accepted and stored.
    try {
      const result = await ipc.dialog.openFile({
        title: 'Seleccionar ejecutable de Java',
        filters: [
          { name: 'Java Executable', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (!result) return

      await ipc.config.setJavaExecutable(result)
      onUpdate('javaExecutable', result)
    } catch (err) {
      showStatus(errorMessage(err, 'No se ha podido guardar la ruta de Java'), 'error')
    }
  }

  const handleClearJava = () => {
    onSave({ javaExecutable: null }, () => ipc.config.setJavaExecutable(null), 'No se ha podido restablecer la ruta de Java')
  }

  const handleAutoDownloadToggle = (checked: boolean) => {
    onSave({ javaAutoDownload: checked }, () => ipc.config.setJavaAutoDownload(checked), 'No se ha podido guardar la descarga automatica de Java')
  }

  const handleUseModpackRamToggle = (checked: boolean) => {
    onSave({ useModpackRam: checked }, () => ipc.config.setUseModpackRam(checked), 'No se ha podido guardar la preferencia de RAM')
  }

  /** Persists on release, not on every pixel of the drag: each write hits config.json. */
  const commitRam = async (megabytes: number) => {
    setDraftRam(null)
    try {
      // The main process clamps and answers with what it stored — including a minimum it
      // may have pulled down to keep -Xms under -Xmx.
      const applied = await ipc.config.setMaxRam(megabytes)
      onUpdate('maxRamMB', applied.maxRamMB)
      onUpdate('minRamMB', applied.minRamMB)
    } catch (err) {
      showStatus(errorMessage(err, 'No se ha podido guardar la memoria asignada'), 'error')
    }
  }

  const ramDisabled = settings.useModpackRam

  // What the launcher found or downloaded on its own, by major. Shown so "Automatico" is not
  // a mystery; these are never written into the field above.
  const runtimes = Object.entries(settings.javaRuntimes || {}).sort(([a], [b]) => Number(a) - Number(b))

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm text-white/60 mb-2">Ruta del ejecutable de Java</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.javaExecutable || ''}
            readOnly
            placeholder="Automatico"
            className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none cursor-default"
          />
          <button
            onClick={handlePickJava}
            className="bg-white/5 border border-white/10 rounded px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer"
          >
            Buscar
          </button>
          {settings.javaExecutable && (
            <button
              onClick={handleClearJava}
              className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white/40 hover:bg-white/10 hover:text-red-400 transition-all duration-200 cursor-pointer"
              title="Restablecer a automatico"
            >
              X
            </button>
          )}
        </div>
        <p className="text-xs text-white/40 mt-1.5">
          {settings.javaExecutable
            ? 'Se usara siempre este Java. Si un modpack necesita otra version, no se lanzara hasta que lo cambies o lo quites.'
            : 'Automatico: el launcher usa la version de Java que pide cada modpack y la descarga si hace falta.'}
        </p>
        {runtimes.length > 0 && (
          <p className="text-xs text-white/30 mt-1">
            {'Gestionados por el launcher: '}
            {runtimes.map(([major, executable], i) => (
              <span key={major} title={executable} className="select-text">
                {i > 0 && ' · '}Java {major}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white">Descargar Java automaticamente</p>
          <p className="text-xs text-white/40 mt-0.5">Si no se detecta Java, se descargara automaticamente</p>
        </div>
        <ToggleSwitch checked={settings.javaAutoDownload} onChange={handleAutoDownloadToggle} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white">Usar RAM asignada a cada modpack (Recomendado)</p>
          <p className="text-xs text-white/40 mt-0.5">Cada modpack define la memoria que necesita para sus mods</p>
        </div>
        <ToggleSwitch checked={settings.useModpackRam} onChange={handleUseModpackRamToggle} />
      </div>

      <div className={ramDisabled ? 'opacity-40 pointer-events-none' : ''}>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm text-white/60">Memoria asignada</label>
          <span className="text-xs text-white/40">
            Maximo {formatGB(maxRam)} de {formatGB(settings.systemTotalRamMB)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={minRam}
            max={maxRam}
            step={step}
            value={currentRam}
            disabled={ramDisabled}
            onChange={(e) => setDraftRam(parseInt(e.target.value))}
            onPointerUp={(e) => commitRam(parseInt(e.currentTarget.value))}
            onKeyUp={(e) => commitRam(parseInt(e.currentTarget.value))}
            className="flex-1 h-1.5 appearance-none rounded-full bg-white/10 cursor-pointer accent-accent-green"
          />
          <input
            type="number"
            min={minRam}
            max={maxRam}
            step={step}
            value={currentRam}
            disabled={ramDisabled}
            onChange={(e) => setDraftRam(parseInt(e.target.value) || 0)}
            onBlur={(e) => commitRam(parseInt(e.target.value) || minRam)}
            className="w-24 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-accent-green focus:outline-none transition-colors duration-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-white/40 text-sm w-6">MB</span>
        </div>

        <p className="text-xs text-white/30 mt-1.5">
          El tope es el 75% de la RAM del sistema; el resto lo necesitan Windows y el propio juego
        </p>
      </div>
    </div>
  )
}
