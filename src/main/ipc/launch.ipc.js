import { Channels } from './channels'
import { handle } from './result'
import LaunchManager from '../managers/LaunchManager'

export function registerLaunchIPC(mainWindow) {
  handle(Channels.LAUNCH_GAME, async () => {
    return await LaunchManager.launchMinecraft((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(Channels.LAUNCH_PROGRESS, progress)
      }
    })
  })

  handle(Channels.LAUNCH_KILL, async () => {
    return LaunchManager.killGame()
  })

  handle(Channels.LAUNCH_GET_STATUS, async () => {
    return LaunchManager.getStatus()
  })
}
