import { ipcMain } from 'electron'
import { Channels } from '../../shared/channels'
import { handle } from './result'

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

  // The window is frameless, so the title bar draws its own maximize/restore button and has
  // to be told when the state changes behind its back: a double click on the drag region, a
  // snap to the screen edge, Win+Up.
  handle(Channels.WINDOW_IS_MAXIMIZED, async () => mainWindow.isMaximized())

  const sendMaximized = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.WINDOW_MAXIMIZED_CHANGED, mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)
}
