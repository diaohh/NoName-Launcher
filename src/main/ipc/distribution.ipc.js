import { Channels } from './channels'
import { handle } from './result'
import DistributionManager from '../managers/DistributionManager'

export function registerDistributionIPC() {
  handle(Channels.DISTRO_SET_SERVER_DATA, async (_event, serverData) => {
    return DistributionManager.setServerData(serverData)
  })
}
