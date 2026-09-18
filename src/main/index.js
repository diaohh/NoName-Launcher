import './env'
import { app, BrowserWindow, session, shell } from 'electron'
import path from 'path'
import { registerAllIPC } from './ipc'
import ConfigManager from './managers/ConfigManager'

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
 * The header is attached only to the launcher's own document. The Microsoft login window
 * shares this session and ships its own policy; overwriting it would break the sign-in
 * page.
 */
function applyContentSecurityPolicy() {
  const policy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    // Tailwind injects a <style> element at runtime.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Modpack icons and banners are arbitrary URLs stored in Firestore, and player
    // skins are served by minotar.net.
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

function createWindow() {
  // Initialize config before anything else
  ConfigManager.load()

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    frame: true,
    icon: path.join(__dirname, '../../resources/icon.png'),
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

app.whenReady().then(() => {
  applyContentSecurityPolicy()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
