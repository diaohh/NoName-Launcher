import 'dotenv/config'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { registerAllIPC } from './ipc'
import ConfigManager from './managers/ConfigManager'

let mainWindow

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
      sandbox: false
    }
  })

  registerAllIPC(mainWindow)

  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
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
