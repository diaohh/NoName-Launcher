import os from 'os'
import fs from 'fs'
import path from 'path'
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

// From the smallest window Minecraft lays out sanely to the largest texture a GPU is expected
// to take. The settings screen enforces the minimum too, but only main can be trusted.
const GAME_WIDTH = { min: 640, max: 16384 }
const GAME_HEIGHT = { min: 480, max: 16384 }

/**
 * Everything below arrives from the renderer and ends up in config.json and, from there, in
 * the JVM command line. The settings screen only sends sane values, but it is the side an
 * attacker reaches first, so each handler checks its own input instead of trusting the UI.
 */
function invalidSetting(message) {
  const error = new Error(message)
  error.code = ERROR_CODE.CONFIG_INVALID_VALUE
  return error
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw invalidSetting(`${label}: se esperaba si o no.`)
  return value
}

function requireInteger(value, { min, max }, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalidSetting(`${label} debe ser un numero entero entre ${min} y ${max}.`)
  }
  return value
}

/** An existing file named java or javaw — the only thing the launcher will ever spawn. */
function requireJavaExecutable(executable) {
  if (executable === null) return null

  const isJava = typeof executable === 'string'
    && path.isAbsolute(executable)
    && /^javaw?(\.exe)?$/i.test(path.basename(executable))
    && fs.existsSync(executable)
    && fs.statSync(executable).isFile()

  if (!isJava) throw invalidSetting('Selecciona el ejecutable de Java (java o javaw) de una instalacion existente.')
  return executable
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

  handle(Channels.CONFIG_SET_JAVA_EXECUTABLE, async (_event, executable) => {
    ConfigManager.setJavaExecutable(requireJavaExecutable(executable))
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD, async (_event, value) => {
    ConfigManager.setJavaAutoDownload(requireBoolean(value, 'Descarga automatica de Java'))
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_MAX_RAM, async (_event, megabytes) => {
    if (typeof megabytes !== 'number' || !Number.isFinite(megabytes)) {
      throw invalidSetting('La memoria asignada debe ser un numero de megabytes.')
    }
    const clamped = Math.min(Math.max(Math.round(megabytes), RAM_MIN_MB), maxAllowedRamMB())
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
    ConfigManager.setUseModpackRam(requireBoolean(value, 'Usar la RAM del modpack'))
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_GAME_WIDTH, async (_event, width) => {
    ConfigManager.setGameWidth(requireInteger(width, GAME_WIDTH, 'El ancho'))
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_GAME_HEIGHT, async (_event, height) => {
    ConfigManager.setGameHeight(requireInteger(height, GAME_HEIGHT, 'El alto'))
    ConfigManager.save()
  })

  handle(Channels.CONFIG_SET_FULLSCREEN, async (_event, value) => {
    ConfigManager.setFullscreen(requireBoolean(value, 'Pantalla completa'))
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

  // Takes no path on purpose. `shell.openPath` runs whatever it is given — an .exe, a .bat —
  // so a path chosen by the renderer would let it execute any file on disk. The only thing
  // the UI ever needs to open is the data directory, and main knows where that is.
  handle(Channels.SHELL_OPEN_DATA_DIRECTORY, async () => {
    const failure = await shell.openPath(ConfigManager.getDataDirectory())
    if (failure) {
      const error = new Error(`No se ha podido abrir la carpeta de datos: ${failure}`)
      error.code = ERROR_CODE.SHELL_OPEN_FAILED
      throw error
    }
  })
}
