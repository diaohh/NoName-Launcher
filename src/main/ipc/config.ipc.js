import { ipcMain, dialog, shell } from 'electron'
import { Channels } from './channels'
import ConfigManager from '../managers/ConfigManager'

export function registerConfigIPC(mainWindow) {
  ipcMain.handle(Channels.CONFIG_LOAD, async () => {
    ConfigManager.load()
    return ConfigManager.getConfig()
  })

  ipcMain.handle(Channels.CONFIG_SAVE, async () => {
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_GET_SETTINGS, async () => {
    return {
      javaExecutable: ConfigManager.getJavaExecutable(),
      javaAutoDownload: ConfigManager.getJavaAutoDownload(),
      gameWidth: ConfigManager.getGameWidth(),
      gameHeight: ConfigManager.getGameHeight(),
      fullscreen: ConfigManager.getFullscreen(),
      dataDirectory: ConfigManager.getDataDirectory()
    }
  })

  ipcMain.handle(Channels.CONFIG_SET_JAVA_EXECUTABLE, async (_event, path) => {
    ConfigManager.setJavaExecutable(path)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD, async (_event, value) => {
    ConfigManager.setJavaAutoDownload(value)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_SET_GAME_WIDTH, async (_event, width) => {
    ConfigManager.setGameWidth(width)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_SET_GAME_HEIGHT, async (_event, height) => {
    ConfigManager.setGameHeight(height)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_SET_FULLSCREEN, async (_event, value) => {
    ConfigManager.setFullscreen(value)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.CONFIG_SET_DATA_DIRECTORY, async (_event, dir) => {
    ConfigManager.setDataDirectory(dir)
    ConfigManager.save()
  })

  ipcMain.handle(Channels.DIALOG_OPEN_FILE, async (_event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Seleccionar archivo',
      filters: options?.filters,
      properties: ['openFile']
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle(Channels.DIALOG_OPEN_FOLDER, async (_event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Seleccionar carpeta',
      properties: ['openDirectory']
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle(Channels.SHELL_OPEN_PATH, async (_event, dirPath) => {
    await shell.openPath(dirPath)
  })
}
