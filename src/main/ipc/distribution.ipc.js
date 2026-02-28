import { ipcMain } from 'electron'
import { Channels } from './channels'
import DistributionManager from '../managers/DistributionManager'

export function registerDistributionIPC() {
  ipcMain.handle(Channels.DISTRO_LOAD, async () => {
    await DistributionManager.loadDistribution()
    return true
  })

  ipcMain.handle(Channels.DISTRO_GET_SERVERS, async () => {
    const servers = DistributionManager.getServers()
    return servers.map(server => DistributionManager.getServerInfo(server))
  })

  ipcMain.handle(Channels.DISTRO_SELECT_SERVER, async (_event, serverId) => {
    return DistributionManager.setSelectedServer(serverId)
  })

  ipcMain.handle(Channels.DISTRO_GET_SELECTED, async () => {
    return DistributionManager.getServerInfo()
  })

  ipcMain.handle(Channels.DISTRO_SET_SERVER_DATA, async (_event, serverData) => {
    return DistributionManager.setServerData(serverData)
  })
}
