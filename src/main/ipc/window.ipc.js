import { ipcMain } from 'electron'
import { Channels } from '../../shared/channels'
import { handle } from './result'
import LaunchManager from '../managers/LaunchManager'

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

  guardCloseDuringLaunch(mainWindow)
}

/**
 * What happens when the player closes the launcher (ADR-0013).
 *
 * With a game running there is nothing to ask: it was spawned detached and outlives the
 * launcher (`LaunchManager.releaseGame` lets go of it on quit). While a launch is still being
 * prepared, though, closing interrupts it — the download stops halfway and resumes next
 * time — so main holds the close and the renderer asks first. Every way of closing comes
 * through here: the title bar, Alt+F4, the taskbar, Cmd+Q.
 *
 * A renderer that cannot answer must not trap the player in a window that never closes, so a
 * crashed one lets the close straight through.
 */
function guardCloseDuringLaunch(mainWindow) {
  let confirmed = false

  mainWindow.on('close', (event) => {
    if (confirmed || !LaunchManager.launchInProgress) return
    if (mainWindow.webContents.isCrashed()) return

    event.preventDefault()
    mainWindow.webContents.send(Channels.WINDOW_CLOSE_REQUESTED)
  })

  on(Channels.WINDOW_CONFIRM_CLOSE, () => {
    confirmed = true
    mainWindow.close()
  })
}
