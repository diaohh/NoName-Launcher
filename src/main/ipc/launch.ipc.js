import { ipcMain } from 'electron'
import { Channels } from './channels'
import LaunchManager from '../managers/LaunchManager'

export function registerLaunchIPC(mainWindow) {
  ipcMain.handle(Channels.LAUNCH_GAME, async () => {
    await LaunchManager.launchMinecraft((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(Channels.LAUNCH_PROGRESS, progress)
      }
    })
    return { success: true }
  })

  ipcMain.handle(Channels.LAUNCH_KILL, async () => {
    LaunchManager.killGame()
  })
}
