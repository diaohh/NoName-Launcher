import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { ERROR_CODE } from '../../shared/errorCodes'
import { errorCodeOf } from '../../shared/LauncherError'
import type {
  EventArgs,
  EventChannel,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcResult,
  SendChannel
} from '../../shared/ipcContract'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('IPC')

const FALLBACK_MESSAGE = 'Ha ocurrido un error inesperado.'

/**
 * The arguments of a channel as a handler receives them: as many as the contract declares,
 * each of them `unknown`. The renderer is the side an attacker reaches first, so the contract
 * says what it means to send and the handler checks what actually arrived.
 */
type Untrusted<Args extends unknown[]> = { [K in keyof Args]: unknown }

export type InvokeHandler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: Untrusted<InvokeArgs<C>>
) => InvokeResult<C> | Promise<InvokeResult<C>>

/** One handler per invoke channel. A map that misses one does not compile. */
export type InvokeHandlers = { [C in InvokeChannel]: InvokeHandler<C> }

/**
 * Registers an ipcMain handler that answers with a result envelope instead of throwing.
 *
 * Electron serializes an Error thrown inside `ipcMain.handle` into a plain string
 * prefixed with `Error invoking remote method '<channel>'`, and `error.code` does not
 * survive the trip. Every handler therefore returns `{ ok: true, data }` or
 * `{ ok: false, code, message }`; `services/ipcClient` unwraps the envelope and
 * rebuilds a `LauncherError` carrying the code, so the renderer can branch on `err.code`
 * instead of matching substrings of a message. A code that is not one of the launcher's
 * (node's `ENOENT`, say) travels as UNKNOWN: the renderer could not act on it anyway.
 *
 * The handler is removed before being registered. `registerAllIPC` runs inside
 * `createWindow()`, which macOS calls again on `activate`, and `ipcMain.handle` throws on
 * a duplicate channel — re-registering is the intended behaviour, not an error.
 */
export function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<InvokeResult<C>>> => {
    try {
      return { ok: true, data: await handler(event, ...(args as Untrusted<InvokeArgs<C>>)) }
    } catch (err) {
      logger.error(`${channel} failed`, err)
      return {
        ok: false,
        code: errorCodeOf(err, ERROR_CODE.UNKNOWN),
        message: (err instanceof Error && err.message) || FALLBACK_MESSAGE
      }
    }
  })
}

/** Registers every handler of the map. */
export function handleAll(handlers: InvokeHandlers): void {
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    // TypeScript cannot follow that `handlers[channel]` belongs to that same `channel` across
    // a union; the map's type is what guarantees it.
    handle(channel, handlers[channel] as InvokeHandler<typeof channel>)
  }
}

/**
 * Listens to a fire-and-forget channel (`ipcRenderer.send`): there is no reply, so there is
 * no envelope either.
 *
 * Like `handle()`, each channel is cleared before it is registered: macOS calls
 * `createWindow()` again on `activate`, and `ipcMain.on` stacks listeners instead of
 * replacing them, which left the old ones calling into a destroyed window.
 */
export function listen(channel: SendChannel, listener: (event: IpcMainEvent) => void): void {
  ipcMain.removeAllListeners(channel)
  ipcMain.on(channel, listener)
}

/** Sends a main → renderer event, unless the window is already gone. */
export function emit<C extends EventChannel>(window: BrowserWindow | null, channel: C, ...payload: EventArgs<C>): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, ...payload)
  }
}
