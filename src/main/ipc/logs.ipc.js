import fs from 'fs/promises'
import path from 'path'
import { app, dialog } from 'electron'
import { Channels } from '../../shared/channels'
import { ERROR_CODE } from '../../shared/errorCodes'
import { handle } from './result'
import { redact } from '../utils/Logger'

/** The viewer keeps 500 lines; this is several orders of magnitude of slack over that. */
const MAX_EXPORT_CHARS = 5 * 1024 * 1024

function exportError(message, cause) {
  const error = new Error(message)
  error.code = ERROR_CODE.LOGS_EXPORT_FAILED
  if (cause) error.cause = cause
  return error
}

function fileStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function registerLogsIPC(mainWindow) {
  /**
   * Saves what the log viewer shows to a file the player picks. The text comes from the
   * renderer; the path does not — it is whatever the native dialog answered — so the renderer
   * cannot write anywhere it likes. The text goes through the same token redactor as the
   * launcher's own log on the way out: a file meant to be sent to someone is the worst place
   * for a credential to end up.
   *
   * @returns {Promise<string|null>} The saved path, or null when the player cancelled.
   */
  handle(Channels.LOGS_EXPORT, async (_event, text) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_EXPORT_CHARS) {
      throw exportError('No hay logs que guardar.')
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar logs',
      defaultPath: path.join(app.getPath('downloads'), `nonamelauncher-logs-${fileStamp()}.txt`),
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return null

    try {
      await fs.writeFile(filePath, redact(text), 'utf8')
    } catch (err) {
      throw exportError(`No se han podido guardar los logs en ${filePath}.`, err)
    }
    return filePath
  })
}
