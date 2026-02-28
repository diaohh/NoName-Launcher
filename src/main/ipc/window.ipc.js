import { ipcMain } from 'electron'
import { Channels } from './channels'

export function registerWindowIPC(mainWindow) {
  ipcMain.on(Channels.WINDOW_MINIMIZE, () => {
    mainWindow.minimize()
  })

  ipcMain.on(Channels.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.on(Channels.WINDOW_CLOSE, () => {
    mainWindow.close()
  })
}
