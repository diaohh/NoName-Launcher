import type { BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { emit, type InvokeHandlers } from './result'
import LaunchManager from '../managers/LaunchManager'
import GameProcess from '../managers/GameProcess'

export function launchHandlers(mainWindow: BrowserWindow) {
  return {
    [Channels.LAUNCH_GAME]: async () => {
      return await LaunchManager.launchMinecraft((progress) => {
        emit(mainWindow, Channels.LAUNCH_PROGRESS, progress)
      })
    },

    [Channels.LAUNCH_KILL]: async () => {
      return GameProcess.killGame()
    },

    [Channels.LAUNCH_GET_STATUS]: async () => {
      return GameProcess.getStatus()
    }
  } satisfies Partial<InvokeHandlers>
}
