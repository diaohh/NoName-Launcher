import { ipc } from '../../services/ipcClient'
import ToggleSwitch from './ToggleSwitch'

export default function JavaSection({ settings, onUpdate }) {
  const handlePickJava = async () => {
    const result = await ipc.dialog.openFile({
      title: 'Seleccionar ejecutable de Java',
      filters: [
        { name: 'Java Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result) {
      onUpdate('javaExecutable', result)
      ipc.config.setJavaExecutable(result)
    }
  }

  const handleClearJava = () => {
    onUpdate('javaExecutable', null)
    ipc.config.setJavaExecutable(null)
  }

  const handleAutoDownloadToggle = (checked) => {
    onUpdate('javaAutoDownload', checked)
    ipc.config.setJavaAutoDownload(checked)
  }

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
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white">Descargar Java automaticamente</p>
          <p className="text-xs text-white/40 mt-0.5">Si no se detecta Java, se descargara automaticamente</p>
        </div>
        <ToggleSwitch checked={settings.javaAutoDownload} onChange={handleAutoDownloadToggle} />
      </div>
    </div>
  )
}
