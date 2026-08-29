import { ipcMain } from 'electron'
import { ERROR_CODE } from '../../shared/errorCodes'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('IPC')

const FALLBACK_MESSAGE = 'Ha ocurrido un error inesperado.'

/**
 * Registers an ipcMain handler that answers with a result envelope instead of throwing.
 *
 * Electron serializes an Error thrown inside `ipcMain.handle` into a plain string
 * prefixed with `Error invoking remote method '<channel>'`, and `error.code` does not
 * survive the trip. Every handler therefore returns `{ ok: true, data }` or
 * `{ ok: false, code, message }`; `services/ipcClient.js` unwraps the envelope and
 * rebuilds a real Error carrying the code, so the renderer can branch on `err.code`
 * instead of matching substrings of a message.
 */
export function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await handler(event, ...args) }
    } catch (err) {
      logger.error(`${channel} failed`, err)
      return {
        ok: false,
        code: typeof err?.code === 'string' ? err.code : ERROR_CODE.UNKNOWN,
        message: err?.message || FALLBACK_MESSAGE
      }
    }
  })
}
