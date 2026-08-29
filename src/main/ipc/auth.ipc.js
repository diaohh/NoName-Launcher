import { Channels } from './channels'
import { handle } from './result'
import AuthManager from '../managers/AuthManager'
import { createMsftAuthWindow } from '../windows/msftAuth'

export function registerAuthIPC(mainWindow) {
  handle(Channels.AUTH_MSFT_LOGIN, async () => {
    return await createMsftAuthWindow()
  })

  handle(Channels.AUTH_LOGIN, async (_event, authCode) => {
    const authData = await AuthManager.addMicrosoftAccount(authCode)
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

  // Token monitoring - check every 5 minutes. The check refreshes the tokens when it
  // can, so it only reports an expiry the refresh could not fix.
  setInterval(async () => {
    try {
      const result = await AuthManager.monitorTokenExpiration()
      if (result && result.expired && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(Channels.AUTH_TOKEN_EXPIRED, result)
      }
    } catch (err) {
      console.error('Token monitor failed:', err)
    }
  }, 300000)
}
