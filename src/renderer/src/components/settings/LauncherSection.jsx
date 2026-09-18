import { ipc } from '../../services/ipcClient'
import { useStatus } from '../../contexts/StatusContext'

export default function LauncherSection({ settings, onUpdate }) {
  const { showStatus } = useStatus()

  // The stored path can differ from the effective one: an unusable directory falls back
  // to the default without being rewritten, so compare against what the main process
  // reports as active rather than against the raw setting.
  const isDefault = settings.dataDirectory === settings.defaultDataDirectory

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

  const handleReset = async () => {
    try {
      // null means "wherever the launcher lives" — the config stops carrying an absolute
      // path instead of storing today's default as a literal.
      const applied = await ipc.config.setDataDirectory(null)
      onUpdate('dataDirectory', applied)
    } catch (err) {
      showStatus(err.message || 'No se ha podido restablecer el directorio de datos', 'error')
    }
  }

  const handleOpenFolder = async () => {
    try {
      await ipc.shell.openDataDirectory()
    } catch (err) {
      showStatus(err.message || 'No se ha podido abrir la carpeta de datos', 'error')
    }
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
          <button
            onClick={handleReset}
            disabled={isDefault}
            title={isDefault ? 'Ya estas en el directorio por defecto' : 'Volver al directorio por defecto'}
            className="bg-white/5 border border-white/10 rounded px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:border-white/10 disabled:hover:text-white/70"
          >
            Restablecer
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
