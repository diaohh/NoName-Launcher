import { ipcMain } from 'electron'
import { Channels } from './channels'
import DistributionManager from '../managers/DistributionManager'

export function registerDistributionIPC() {
  ipcMain.handle(Channels.DISTRO_SET_SERVER_DATA, async (_event, serverData) => {
    return DistributionManager.setServerData(serverData)
  })
}
