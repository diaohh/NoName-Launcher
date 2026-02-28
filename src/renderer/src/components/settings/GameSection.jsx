import { ipc } from '../../services/ipcClient'
import ToggleSwitch from './ToggleSwitch'

const PRESETS = [
  { label: '1280 x 720', w: 1280, h: 720 },
  { label: '1366 x 768', w: 1366, h: 768 },
  { label: '1600 x 900', w: 1600, h: 900 },
  { label: '1920 x 1080', w: 1920, h: 1080 },
  { label: '2560 x 1440', w: 2560, h: 1440 },
]

export default function GameSection({ settings, onUpdate }) {
  const handleWidthChange = (e) => {
    const val = parseInt(e.target.value) || 0
    onUpdate('gameWidth', val)
    if (val >= 640) ipc.config.setGameWidth(val)
  }

  const handleHeightChange = (e) => {
    const val = parseInt(e.target.value) || 0
    onUpdate('gameHeight', val)
    if (val >= 480) ipc.config.setGameHeight(val)
  }

  const handlePreset = (preset) => {
    onUpdate('gameWidth', preset.w)
    onUpdate('gameHeight', preset.h)
    ipc.config.setGameWidth(preset.w)
    ipc.config.setGameHeight(preset.h)
  }

  const handleFullscreenToggle = (checked) => {
    onUpdate('fullscreen', checked)
    ipc.config.setFullscreen(checked)
  }

  const isActivePreset = (p) => settings.gameWidth === p.w && settings.gameHeight === p.h

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm text-white/60 mb-2">Resolucion</label>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="number"
            value={settings.gameWidth}
            onChange={handleWidthChange}
            min={640}
            className="w-24 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-accent-green focus:outline-none transition-colors duration-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-white/40 text-sm">x</span>
          <input
            type="number"
            value={settings.gameHeight}
            onChange={handleHeightChange}
            min={480}
            className="w-24 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-accent-green focus:outline-none transition-colors duration-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => handlePreset(p)}
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
