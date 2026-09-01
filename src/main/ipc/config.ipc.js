import os from 'os'
import { dialog, shell } from 'electron'
import { Channels } from './channels'
import { handle } from './result'
import ConfigManager from '../managers/ConfigManager'
import LaunchManager from '../managers/LaunchManager'
import { ERROR_CODE } from '../../shared/errorCodes'

const RAM_STEP_MB = 512
const RAM_MIN_MB = 1024

/**
 * A JVM that owns all of physical memory leaves nothing for the operating system, the
 * launcher itself or the game's own native allocations — the machine swaps or the game is
 * killed. The slider therefore stops at three quarters of the installed RAM, as a hard
 * limit rather than a warning: there is no legitimate reason to go past it.
 */
function maxAllowedRamMB() {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024)
  const capped = Math.floor((totalMB * 0.75) / RAM_STEP_MB) * RAM_STEP_MB
  return Math.max(RAM_MIN_MB, capped)
}

export function registerConfigIPC(mainWindow) {
  handle(Channels.CONFIG_GET_SETTINGS, async () => {
    return {
      javaExecutable: ConfigManager.getJavaExecutable(),
      javaAutoDownload: ConfigManager.getJavaAutoDownload(),
      gameWidth: ConfigManager.getGameWidth(),
      gameHeight: ConfigManager.getGameHeight(),
      fullscreen: ConfigManager.getFullscreen(),
      // RAM travels as megabytes in both directions; the '2G'/'4096M' format on disk never
      // reaches the renderer.
      minRamMB: ConfigManager.getMinRAMMb(),
      maxRamMB: ConfigManager.getMaxRAMMb(),
      useModpackRam: ConfigManager.getUseModpackRam(),
      systemTotalRamMB: Math.floor(os.totalmem() / 1024 / 1024),
      maxAllowedRamMB: maxAllowedRamMB(),
      minAllowedRamMB: RAM_MIN_MB,
      ramStepMB: RAM_STEP_MB,
      // The effective directory, which is not always the stored one: an unusable path
      // falls back to the default. `defaultDataDirectory` lets the UI tell them apart.
      dataDirectory: ConfigManager.getDataDirectory(),
      defaultDataDirectory: ConfigManager.getLauncherDirectory()
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

  handle(Channels.CONFIG_SET_MAX_RAM, async (_event, megabytes) => {
    const clamped = Math.min(Math.max(Math.round(megabytes) || RAM_MIN_MB, RAM_MIN_MB), maxAllowedRamMB())
    ConfigManager.setMaxRAM(ConfigManager.formatRamFromMB(clamped))
    ConfigManager.save()

    // Answers with what was actually stored, minimum included: setMaxRAM pulls the floor
    // down with the ceiling, and the settings screen has to show that.
    return {
      maxRamMB: ConfigManager.getMaxRAMMb(),
      minRamMB: ConfigManager.getMinRAMMb()
    }
  })

  handle(Channels.CONFIG_SET_USE_MODPACK_RAM, async (_event, value) => {
    ConfigManager.setUseModpackRam(value)
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
    // Moving the root out from under a running game would leave it with open handles
    // into a directory the launcher no longer considers its own.
    if (LaunchManager.gameProcess != null) {
      const error = new Error('Cierra Minecraft antes de cambiar el directorio de datos.')
      error.code = ERROR_CODE.CONFIG_GAME_RUNNING
      throw error
    }

    ConfigManager.setDataDirectory(dir)
    ConfigManager.save()
    return ConfigManager.getDataDirectory()
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
