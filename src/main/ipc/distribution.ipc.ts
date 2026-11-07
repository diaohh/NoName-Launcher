import { Channels } from '../../shared/channels'
import type { InvokeHandlers } from './result'
import DistributionManager from '../managers/DistributionManager'

export function distributionHandlers() {
  return {
    // The document is checked by `DistributionManager.parseServerData`, field by field.
    [Channels.DISTRO_SET_SERVER_DATA]: async (_event, serverData) => {
      return DistributionManager.setServerData(serverData)
    }
  } satisfies Partial<InvokeHandlers>
}
