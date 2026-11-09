import type { BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { emit, listen, type InvokeHandlers } from './result'
import LaunchManager from '../managers/LaunchManager'

export function windowHandlers(mainWindow: BrowserWindow) {
  return {
    // The window is frameless, so the title bar draws its own maximize/restore button and has
    // to be told when the state changes behind its back (`watchWindow`).
    [Channels.WINDOW_IS_MAXIMIZED]: async () => mainWindow.isMaximized()
  } satisfies Partial<InvokeHandlers>
}

/**
 * The fire-and-forget window controls (`ipcRenderer.send`), which have no reply to wrap in an
 * envelope, and the window events the renderer follows.
 */
export function watchWindow(mainWindow: BrowserWindow): void {
  listen(Channels.WINDOW_MINIMIZE, () => {
    mainWindow.minimize()
  })

  listen(Channels.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  listen(Channels.WINDOW_CLOSE, () => {
    mainWindow.close()
  })

  // A double click on the drag region, a snap to the screen edge, Win+Up: the title bar's
  // button follows every way the state changes, not only its own clicks.
  const sendMaximized = () => emit(mainWindow, Channels.WINDOW_MAXIMIZED_CHANGED, mainWindow.isMaximized())
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)

  guardCloseDuringLaunch(mainWindow)
}

/**
 * What happens when the player closes the launcher (ADR-0013).
 *
 * With a game running there is nothing to ask: it was spawned detached and outlives the
 * launcher (`GameProcess.releaseGame` lets go of it on quit). While a launch is still being
 * prepared, though, closing interrupts it — the download stops halfway and resumes next
 * time — so main holds the close and the renderer asks first. Every way of closing comes
 * through here: the title bar, Alt+F4, the taskbar, Cmd+Q.
 *
 * A renderer that cannot answer must not trap the player in a window that never closes, so a
 * crashed one lets the close straight through.
 */
function guardCloseDuringLaunch(mainWindow: BrowserWindow): void {
  let confirmed = false

  mainWindow.on('close', (event) => {
    if (confirmed || !LaunchManager.launchInProgress) return
    if (mainWindow.webContents.isCrashed()) return

    event.preventDefault()
    emit(mainWindow, Channels.WINDOW_CLOSE_REQUESTED)
  })

  listen(Channels.WINDOW_CONFIRM_CLOSE, () => {
    confirmed = true
    mainWindow.close()
  })
}
