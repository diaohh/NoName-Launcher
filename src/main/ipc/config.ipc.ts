import os from 'os'
import fs from 'fs'
import path from 'path'
import { dialog, shell, type BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { isPlainObject } from '../../shared/guards'
import type { FileFilter, OpenFileOptions } from '../../shared/ipcContract'
import type { InvokeHandlers } from './result'
import ConfigManager from '../managers/ConfigManager'
import GameProcess from '../managers/GameProcess'

const RAM_STEP_MB = 512
const RAM_MIN_MB = 1024

/**
 * A JVM that owns all of physical memory leaves nothing for the operating system, the
 * launcher itself or the game's own native allocations — the machine swaps or the game is
 * killed. The slider therefore stops at three quarters of the installed RAM, as a hard
 * limit rather than a warning: there is no legitimate reason to go past it.
 */
function maxAllowedRamMB(): number {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024)
  const capped = Math.floor((totalMB * 0.75) / RAM_STEP_MB) * RAM_STEP_MB
  return Math.max(RAM_MIN_MB, capped)
}

interface IntegerRange {
  min: number
  max: number
}

// From the smallest window Minecraft lays out sanely to the largest texture a GPU is expected
// to take. The settings screen enforces the minimum too, but only main can be trusted.
const GAME_WIDTH: IntegerRange = { min: 640, max: 16384 }
const GAME_HEIGHT: IntegerRange = { min: 480, max: 16384 }

/** The dialogs only show these to the player; the limits keep a hostile caller from bloating them. */
const MAX_DIALOG_TITLE = 120
const MAX_DIALOG_FILTERS = 10
const DIALOG_EXTENSION = /^(\*|[a-z0-9]{1,16})$/i

/**
 * Everything below arrives from the renderer and ends up in config.json and, from there, in
 * the JVM command line. The settings screen only sends sane values, but it is the side an
 * attacker reaches first, so each handler checks its own input instead of trusting the UI.
 */
function invalidSetting(message: string): LauncherError {
  return new LauncherError(ERROR_CODE.CONFIG_INVALID_VALUE, message)
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalidSetting(`${label}: se esperaba si o no.`)
  return value
}

function requireInteger(value: unknown, { min, max }: IntegerRange, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalidSetting(`${label} debe ser un numero entero entre ${min} y ${max}.`)
  }
  return value
}

/** An existing file named java or javaw — the only thing the launcher will ever spawn. */
function requireJavaExecutable(executable: unknown): string | null {
  if (executable === null) return null

  const isJava = typeof executable === 'string'
    && path.isAbsolute(executable)
    && /^javaw?(\.exe)?$/i.test(path.basename(executable))
    && fs.existsSync(executable)
    && fs.statSync(executable).isFile()

  if (!isJava) throw invalidSetting('Selecciona el ejecutable de Java (java o javaw) de una instalacion existente.')
  return executable
}

const isFileFilter = (value: unknown): value is FileFilter =>
  isPlainObject(value)
  && typeof value.name === 'string' && value.name.length <= MAX_DIALOG_TITLE
  && Array.isArray(value.extensions)
  && value.extensions.every(extension => typeof extension === 'string' && DIALOG_EXTENSION.test(extension))

/**
 * The options of an open dialog. Only a title and file filters are taken from the renderer:
 * where the dialog starts and what it may pick are main's to decide.
 */
function requireDialogOptions(options: unknown): OpenFileOptions {
  if (options == null) return {}
  if (!isPlainObject(options)) throw invalidSetting('Opciones de dialogo no validas.')

  const { title, filters } = options
  if (title !== undefined && (typeof title !== 'string' || title.length > MAX_DIALOG_TITLE)) {
    throw invalidSetting('El titulo del dialogo no es valido.')
  }
  if (filters !== undefined && !(Array.isArray(filters) && filters.length <= MAX_DIALOG_FILTERS && filters.every(isFileFilter))) {
    throw invalidSetting('Los filtros del dialogo no son validos.')
  }

  return { title: title as string | undefined, filters: filters as FileFilter[] | undefined }
}

export function configHandlers(mainWindow: BrowserWindow) {
  return {
    [Channels.CONFIG_GET_SETTINGS]: async () => {
      return {
        // Only the player's own choice; null means the launcher picks per modpack.
        javaExecutable: ConfigManager.getJavaExecutable(),
        // What the launcher picked on its own, by Java major, so the screen can show it.
        javaRuntimes: ConfigManager.getJavaRuntimes(),
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
    },

    [Channels.CONFIG_SET_JAVA_EXECUTABLE]: async (_event, executable) => {
      ConfigManager.setJavaExecutable(requireJavaExecutable(executable))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_JAVA_AUTO_DOWNLOAD]: async (_event, value) => {
      ConfigManager.setJavaAutoDownload(requireBoolean(value, 'Descarga automatica de Java'))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_MAX_RAM]: async (_event, megabytes) => {
      if (typeof megabytes !== 'number' || !Number.isFinite(megabytes)) {
        throw invalidSetting('La memoria asignada debe ser un numero de megabytes.')
      }
      const clamped = Math.min(Math.max(Math.round(megabytes), RAM_MIN_MB), maxAllowedRamMB())
      ConfigManager.setMaxRAM(ConfigManager.formatRamFromMB(clamped))
      await ConfigManager.save()

      // Answers with what was actually stored, minimum included: setMaxRAM pulls the floor
      // down with the ceiling, and the settings screen has to show that.
      return {
        maxRamMB: ConfigManager.getMaxRAMMb(),
        minRamMB: ConfigManager.getMinRAMMb()
      }
    },

    [Channels.CONFIG_SET_USE_MODPACK_RAM]: async (_event, value) => {
      ConfigManager.setUseModpackRam(requireBoolean(value, 'Usar la RAM del modpack'))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_GAME_WIDTH]: async (_event, width) => {
      ConfigManager.setGameWidth(requireInteger(width, GAME_WIDTH, 'El ancho'))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_GAME_HEIGHT]: async (_event, height) => {
      ConfigManager.setGameHeight(requireInteger(height, GAME_HEIGHT, 'El alto'))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_FULLSCREEN]: async (_event, value) => {
      ConfigManager.setFullscreen(requireBoolean(value, 'Pantalla completa'))
      await ConfigManager.save()
    },

    [Channels.CONFIG_SET_DATA_DIRECTORY]: async (_event, directory) => {
      // Moving the root out from under a running game would leave it with open handles
      // into a directory the launcher no longer considers its own.
      if (await GameProcess.isGameRunning()) {
        throw new LauncherError(ERROR_CODE.CONFIG_GAME_RUNNING, 'Cierra Minecraft antes de cambiar el directorio de datos.')
      }

      // Validated there: it is the one place that knows what a usable data directory is.
      ConfigManager.setDataDirectory(directory)
      await ConfigManager.save()
      return ConfigManager.getDataDirectory()
    },

    [Channels.DIALOG_OPEN_FILE]: async (_event, options) => {
      const { title, filters } = requireDialogOptions(options)
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Seleccionar archivo',
        filters,
        properties: ['openFile']
      })
      return canceled ? null : filePaths[0] ?? null
    },

    [Channels.DIALOG_OPEN_FOLDER]: async (_event, options) => {
      const { title } = requireDialogOptions(options)
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Seleccionar carpeta',
        // Since Electron 43 a dialog with no defaultPath opens in Downloads instead of wherever
        // the OS last left it. The only folder the launcher asks for is the data directory, so
        // the picker starts from the current one.
        defaultPath: ConfigManager.getDataDirectory(),
        properties: ['openDirectory']
      })
      return canceled ? null : filePaths[0] ?? null
    },

    // Takes no path on purpose. `shell.openPath` runs whatever it is given — an .exe, a .bat —
    // so a path chosen by the renderer would let it execute any file on disk. The only thing
    // the UI ever needs to open is the data directory, and main knows where that is.
    [Channels.SHELL_OPEN_DATA_DIRECTORY]: async () => {
      await openFolder(ConfigManager.getDataDirectory(), 'la carpeta de datos')
    },

    // Same rule: no argument, main decides the path. The folder is created on demand so the
    // button works even before the first line has been written.
    [Channels.SHELL_OPEN_LOGS_DIRECTORY]: async () => {
      const logsDir = ConfigManager.getLogsDirectory()
      fs.mkdirSync(logsDir, { recursive: true })
      await openFolder(logsDir, 'la carpeta de logs')
    }
  } satisfies Partial<InvokeHandlers>
}

/** `shell.openPath` reports failure as a string instead of rejecting. */
async function openFolder(directory: string, label: string): Promise<void> {
  const failure = await shell.openPath(directory)
  if (failure) {
    throw new LauncherError(ERROR_CODE.SHELL_OPEN_FAILED, `No se ha podido abrir ${label}: ${failure}`)
  }
}
