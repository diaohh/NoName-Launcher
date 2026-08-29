import { ipc } from '../../services/ipcClient'
import { useStatus } from '../../contexts/StatusContext'

export default function LauncherSection({ settings, onUpdate }) {
  const { showStatus } = useStatus()

  const handlePickFolder = async () => {
    const result = await ipc.dialog.openFolder({
      title: 'Seleccionar directorio de datos'
    })
    if (!result) return

    try {
      // The main process answers with the directory it actually adopted, so the input
      // never shows a path the launcher is not really using.
      const applied = await ipc.config.setDataDirectory(result)
      onUpdate('dataDirectory', applied)
    } catch (err) {
      showStatus(err.message || 'No se ha podido cambiar el directorio de datos', 'error')
    }
  }

  const handleOpenFolder = () => {
    ipc.shell.openPath(settings.dataDirectory)
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm text-white/60 mb-2">Directorio de datos</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.dataDirectory || ''}
            readOnly
            className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white/70 focus:outline-none cursor-default truncate"
          />
          <button
            onClick={handlePickFolder}
            className="bg-white/5 border border-white/10 rounded px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer shrink-0"
          >
            Buscar
          </button>
        </div>
        <p className="text-xs text-white/30 mt-1.5">
          Se aplica a las proximas descargas. Los archivos existentes no se moveran
        </p>
      </div>

      <button
        onClick={handleOpenFolder}
        className="bg-white/5 border border-white/10 rounded px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer"
      >
        Abrir carpeta de datos
      </button>
    </div>
  )
}
