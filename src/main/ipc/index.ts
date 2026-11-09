import type { BrowserWindow } from 'electron'
import { handleAll, type InvokeHandlers } from './result'
import { authHandlers, watchSession } from './auth.ipc'
import { configHandlers } from './config.ipc'
import { distributionHandlers } from './distribution.ipc'
import { launchHandlers } from './launch.ipc'
import { logsHandlers } from './logs.ipc'
import { skinsHandlers } from './skins.ipc'
import { windowHandlers, watchWindow } from './window.ipc'

/**
 * Every invoke handler, from one map. Typed as `InvokeHandlers`, it has to hold one handler
 * per channel of `InvokeContract`: a channel with no handler does not compile, where it used to
 * be a call the renderer could make and main never answered.
 */
export function registerAllIPC(mainWindow: BrowserWindow): void {
  const handlers: InvokeHandlers = {
    ...authHandlers(),
    ...configHandlers(mainWindow),
    ...distributionHandlers(),
    ...launchHandlers(mainWindow),
    ...logsHandlers(mainWindow),
    ...skinsHandlers(mainWindow),
    ...windowHandlers(mainWindow)
  }
  handleAll(handlers)

  watchSession(mainWindow)
  watchWindow(mainWindow)
}
