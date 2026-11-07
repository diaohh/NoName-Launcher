import { Channels } from '../../shared/channels'
import { handle } from './result'
import Logger from '../utils/Logger'
import AuthManager from '../managers/AuthManager'
import { createMsftAuthWindow, clearMsftAuthSession } from '../windows/msftAuth'

const logger = Logger.getLogger('AuthIPC')

export function registerAuthIPC(mainWindow) {
  handle(Channels.AUTH_MSFT_LOGIN, async () => {
    return await createMsftAuthWindow()
  })

  handle(Channels.AUTH_LOGIN, async (_event, authCode) => {
    const authData = await AuthManager.addMicrosoftAccount(authCode)
    // A fresh account carries a fresh expiry, so the scheduler is re-armed against it.
    AuthManager.scheduleTokenRefresh()
    // The Minecraft access token never crosses into the renderer: it is read from
    // ConfigManager in the main process when the launch command is built.
    return {
      username: authData.username,
      uuid: authData.uuid,
      displayName: authData.displayName
    }
  })

  handle(Channels.AUTH_LOGOUT, async (_event, uuid) => {
    AuthManager.removeAccount(uuid)
    // Re-arms against whatever account is left, or disarms when none is.
    AuthManager.scheduleTokenRefresh()
    // The account is already gone from config.json; a failure here only means the sign-in
    // window may still remember it until the launcher restarts (its partition is in memory).
    await clearMsftAuthSession().catch((err) => logger.warn('Could not clear the sign-in session', err))
  })

  handle(Channels.AUTH_VALIDATE, async () => {
    return await AuthManager.validateSelectedMicrosoftAccount()
  })

  handle(Channels.AUTH_GET_ACCOUNT, async () => {
    const account = AuthManager.getSelectedAccount()
    if (!account) return null
    return {
      type: account.type,
      username: account.username,
      uuid: account.uuid,
      displayName: account.displayName,
      expiresAt: account.expiresAt
    }
  })

  // The refresh is scheduled from the token's own expiry rather than polled for, and the
  // callback fires only when the session is gone for good.
  AuthManager.startTokenRefreshScheduler((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.AUTH_TOKEN_EXPIRED, payload)
    }
  })

  mainWindow.on('closed', () => AuthManager.stopTokenRefreshScheduler())
}
