import { app, BrowserWindow, session, shell } from 'electron'
import path from 'path'
// `resources/` is electron-vite's public directory for main, so `?asset` resolves the icon
// against it at runtime; `asarUnpack` points that path at app.asar.unpacked, where
// electron-builder.yml leaves the folder as a real file on disk.
import icon from '../../resources/icon.png?asset&asarUnpack'
import { registerAllIPC } from './ipc'
import ConfigManager from './managers/ConfigManager'
import LaunchManager from './managers/LaunchManager'
import Logger from './utils/Logger'
import { purgeLegacyAuthCookies } from './windows/msftAuth'

const logger = Logger.getLogger('Main')

let mainWindow

// Development behaviour — a remote renderer URL, DevTools, the relaxed CSP — is decided by
// `app.isPackaged` first. Environment variables only choose between dev variants, so no
// variable set on a player's machine can switch an installed launcher into any of them.
const rendererUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || Boolean(rendererUrl))

/**
 * Content Security Policy for the renderer.
 *
 * Applied as a response header instead of a <meta> tag in index.html because the same
 * document is served by the vite dev server, which needs a websocket and eval for hot
 * reload — a static tag would have to be loose enough for dev, which defeats the point
 * in production.
 *
 * The header is attached only to the launcher's own document. The Microsoft login window runs
 * in its own partition (`windows/msftAuth.js`), so its requests never reach this handler; the
 * filter stays so that nothing else loaded in the default session gets a policy that is not
 * its own.
 */
function applyContentSecurityPolicy() {
  const policy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    // Tailwind injects a <style> element at runtime.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Modpack icons and banners are arbitrary URLs stored in Firestore. Skin and cape
    // textures arrive from main as data: URLs (ADR-0014), so they add no origin here.
    "img-src 'self' data: https:",
    isDev
      ? "connect-src 'self' https: ws: wss:"
      : "connect-src 'self' https://firestore.googleapis.com https://*.googleapis.com",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')

  const isLauncherDocument = (url) =>
    url.startsWith('file://') || Boolean(rendererUrl && url.startsWith(rendererUrl))

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isLauncherDocument(details.url)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

/**
 * The launcher never navigates away from its own document and never opens a second
 * window, so both are denied. External links are handed to the system browser rather
 * than loaded inside a window that can talk to the preload bridge.
 */
function restrictNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || (rendererUrl && url.startsWith(rendererUrl))) return

    event.preventDefault()
    if (url.startsWith('https://')) shell.openExternal(url)
  })
}

let windowOpening = null

/**
 * Opens the main window, once. Loading the config is asynchronous (safeStorage decrypts
 * asynchronously since Electron 45), and a second launch or a macOS `activate` arriving in
 * that gap would otherwise open a second window over the same config and IPC handlers.
 */
function createWindow() {
  windowOpening ??= openMainWindow()
    .catch((err) => logger.error('Could not open the main window', err))
    .finally(() => { windowOpening = null })
  return windowOpening
}

async function openMainWindow() {
  // Initialize config before anything else
  await ConfigManager.load()

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    // The title bar is drawn by the renderer (components/common/TitleBar.jsx), so it can sit
    // on the same glass as the rest of the launcher.
    frame: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  registerAllIPC(mainWindow)
  restrictNavigation(mainWindow)

  if (isDev) {
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl)
    } else {
      mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Brings the existing window forward when the player opens the launcher a second time. */
function focusMainWindow() {
  if (!mainWindow) {
    if (app.isReady()) createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function startLauncher() {
  // Before anything else is logged, so the file has the whole run. Lives next to config.json,
  // not under the data directory: see ConfigManager.getLogsDirectory.
  Logger.enableFileLogging(ConfigManager.getLogsDirectory())
  logger.info(
    `${app.getName()} ${app.getVersion()} starting, Electron ${process.versions.electron}, ` +
    `${process.platform} ${process.arch}${app.isPackaged ? '' : ', development'}`
  )

  app.on('second-instance', focusMainWindow)

  app.whenReady().then(() => {
    applyContentSecurityPolicy()
    createWindow()
    purgeLegacyAuthCookies().catch((err) => logger.warn('Could not purge old Microsoft cookies', err))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // The game was spawned detached and keeps running; this only lets go of its pipes so the
  // launcher can exit (ADR-0013).
  app.on('will-quit', () => {
    LaunchManager.releaseGame()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// One launcher at a time. A second process would write config.json behind the first one's
// back, and could sync the same instance directory concurrently — `launchInProgress` only
// guards a single process. The second launch hands over to the first and exits.
if (app.requestSingleInstanceLock()) {
  startLauncher()
} else {
  app.quit()
}
