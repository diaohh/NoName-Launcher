import { useState, type KeyboardEvent } from 'react'
import { ipc } from '../../services/ipcClient'
import type { LauncherSettings } from '../../../../shared/ipcContract'
import type { SaveSettings } from './SettingsScreen'
import ToggleSwitch from './ToggleSwitch'

interface Preset {
  label: string
  w: number
  h: number
}

type Dimension = 'gameWidth' | 'gameHeight'

const PRESETS: readonly Preset[] = [
  { label: '1280 x 720', w: 1280, h: 720 },
  { label: '1366 x 768', w: 1366, h: 768 },
  { label: '1600 x 900', w: 1600, h: 900 },
  { label: '1920 x 1080', w: 1920, h: 1080 },
  { label: '2560 x 1440', w: 2560, h: 1440 },
]

const DIMENSIONS: Record<Dimension, { persist: (value: number) => Promise<void>, failure: string }> = {
  gameWidth: { persist: (value) => ipc.config.setGameWidth(value), failure: 'No se ha podido guardar el ancho' },
  gameHeight: { persist: (value) => ipc.config.setGameHeight(value), failure: 'No se ha podido guardar el alto' }
}

const inputClass = 'w-24 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-accent-green focus:outline-none transition-colors duration-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export default function GameSection({ settings, onSave }: { settings: LauncherSettings, onSave: SaveSettings }) {
  // What is being typed, per field, until it loses focus. Saving on every keystroke sent
  // "1", "12", "128" on the way to "1280" — values main rightly rejects — and a width under
  // 640 used to stay on screen while the disk kept the old one.
  const [draft, setDraft] = useState<Partial<Record<Dimension, string>>>({})

  const editDimension = (key: Dimension, text: string) => setDraft(prev => ({ ...prev, [key]: text }))

  const commitDimension = (key: Dimension) => {
    const text = draft[key]
    if (text === undefined) return

    const value = Number(text)
    setDraft(({ [key]: _committed, ...rest }) => rest)
    if (value === settings[key]) return

    // Range and integer checks live in main, which answers with the message to show.
    const { persist, failure } = DIMENSIONS[key]
    const change: Partial<LauncherSettings> = {}
    change[key] = value
    onSave(change, () => persist(value), failure)
  }

  const handlePreset = (preset: Preset) => {
    setDraft({})
    onSave(
      { gameWidth: preset.w, gameHeight: preset.h },
      async () => {
        await ipc.config.setGameWidth(preset.w)
        await ipc.config.setGameHeight(preset.h)
      },
      'No se ha podido guardar la resolucion'
    )
  }

  const handleFullscreenToggle = (checked: boolean) => {
    onSave({ fullscreen: checked }, () => ipc.config.setFullscreen(checked), 'No se ha podido guardar la pantalla completa')
  }

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const isActivePreset = (p: Preset) => settings.gameWidth === p.w && settings.gameHeight === p.h

  return (
    <div className="space-y-6">
      <div className={settings.fullscreen ? 'opacity-40 pointer-events-none' : ''}>
        <label className="block text-sm text-white/60 mb-2">Resolucion</label>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="number"
            value={draft.gameWidth ?? settings.gameWidth}
            onChange={(e) => editDimension('gameWidth', e.target.value)}
            onBlur={() => commitDimension('gameWidth')}
            onKeyDown={blurOnEnter}
            min={640}
            disabled={settings.fullscreen}
            className={inputClass}
          />
          <span className="text-white/40 text-sm">x</span>
          <input
            type="number"
            value={draft.gameHeight ?? settings.gameHeight}
            onChange={(e) => editDimension('gameHeight', e.target.value)}
            onBlur={() => commitDimension('gameHeight')}
            onKeyDown={blurOnEnter}
            min={480}
            disabled={settings.fullscreen}
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => handlePreset(p)}
              disabled={settings.fullscreen}
              className={`rounded-md px-3 py-1.5 text-xs transition-all duration-200 cursor-pointer border ${
                isActivePreset(p)
                  ? 'border-accent-green text-accent-green bg-card-hover'
                  : 'border-white/10 text-white/50 bg-white/5 hover:border-accent-green hover:text-accent-green'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white">Pantalla completa</p>
          <p className="text-xs text-white/40 mt-0.5">Iniciar Minecraft en pantalla completa</p>
        </div>
        <ToggleSwitch checked={settings.fullscreen} onChange={handleFullscreenToggle} />
      </div>
    </div>
  )
}
