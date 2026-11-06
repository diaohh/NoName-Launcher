import { registerAuthIPC } from './auth.ipc'
import { registerConfigIPC } from './config.ipc'
import { registerDistributionIPC } from './distribution.ipc'
import { registerLaunchIPC } from './launch.ipc'
import { registerLogsIPC } from './logs.ipc'
import { registerWindowIPC } from './window.ipc'

export function registerAllIPC(mainWindow) {
  registerAuthIPC(mainWindow)
  registerConfigIPC(mainWindow)
  registerDistributionIPC()
  registerLaunchIPC(mainWindow)
  registerLogsIPC(mainWindow)
  registerWindowIPC(mainWindow)
}
