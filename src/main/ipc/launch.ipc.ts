import type { BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { emit, type InvokeHandlers } from './result'
import LaunchManager from '../managers/LaunchManager'

export function launchHandlers(mainWindow: BrowserWindow) {
  return {
    [Channels.LAUNCH_GAME]: async () => {
      return await LaunchManager.launchMinecraft((progress) => {
        emit(mainWindow, Channels.LAUNCH_PROGRESS, progress)
      })
    },

    [Channels.LAUNCH_KILL]: async () => {
      return LaunchManager.killGame()
    },

    [Channels.LAUNCH_GET_STATUS]: async () => {
      return LaunchManager.getStatus()
    }
  } satisfies Partial<InvokeHandlers>
}
