import { dialog, shell } from 'electron'
import { Channels } from './channels'
import { handle } from './result'
import ConfigManager from '../managers/ConfigManager'

export function registerConfigIPC(mainWindow) {
  handle(Channels.CONFIG_GET_SETTINGS, async () => {
    return {
      javaExecutable: ConfigManager.getJavaExecutable(),
      javaAutoDownload: ConfigManager.getJavaAutoDownload(),
      gameWidth: ConfigManager.getGameWidth(),
      gameHeight: ConfigManager.getGameHeight(),
      fullscreen: ConfigManager.getFullscreen(),
      dataDirectory: ConfigManager.getDataDirectory()
    }
  })

  handle(Channels.CONFIG_SET_JAVA_EXECUTABLE, async (_event, path) => {
    ConfigManager.setJavaExecutable(path)
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD, async (_event, value) => {
    ConfigManager.setJavaAutoDownload(value)
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_GAME_WIDTH, async (_event, width) => {
    ConfigManager.setGameWidth(width)
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_GAME_HEIGHT, async (_event, height) => {
    ConfigManager.setGameHeight(height)
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_FULLSCREEN, async (_event, value) => {
    ConfigManager.setFullscreen(value)
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_DATA_DIRECTORY, async (_event, dir) => {
    ConfigManager.setDataDirectory(dir)
    ConfigManager.save()
  })

  handle(Channels.DIALOG_OPEN_FILE, async (_event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Seleccionar archivo',
      filters: options?.filters,
      properties: ['openFile']
    })
    return canceled ? null : filePaths[0]
  })

  handle(Channels.DIALOG_OPEN_FOLDER, async (_event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Seleccionar carpeta',
      properties: ['openDirectory']
    })
    return canceled ? null : filePaths[0]
  })

  handle(Channels.SHELL_OPEN_PATH, async (_event, dirPath) => {
    await shell.openPath(dirPath)
  })
}
