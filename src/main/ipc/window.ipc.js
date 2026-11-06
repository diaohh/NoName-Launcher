import { ipcMain } from 'electron'
import { Channels } from '../../shared/channels'

/**
 * Fire-and-forget window controls (`ipcRenderer.send`), so they are plain `ipcMain.on`
 * listeners rather than `handle()` — there is no reply to wrap in an envelope.
 *
 * Like `handle()`, each channel is cleared before it is registered: macOS calls
 * `createWindow()` again on `activate`, and `ipcMain.on` stacks listeners instead of
 * replacing them, which left the old ones calling into a destroyed window.
 */
function on(channel, listener) {
  ipcMain.removeAllListeners(channel)
  ipcMain.on(channel, listener)
}

export function registerWindowIPC(mainWindow) {
  on(Channels.WINDOW_MINIMIZE, () => {
    mainWindow.minimize()
  })

  on(Channels.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  on(Channels.WINDOW_CLOSE, () => {
    mainWindow.close()
  })
}
