import { ipcMain } from 'electron'
import { Channels } from './channels'
import AuthManager from '../managers/AuthManager'
import { createMsftAuthWindow } from '../windows/msftAuth'

export function registerAuthIPC(mainWindow) {
  ipcMain.handle(Channels.AUTH_MSFT_LOGIN, async () => {
    const code = await createMsftAuthWindow()
    return code
  })

  ipcMain.handle(Channels.AUTH_LOGIN, async (_event, authCode) => {
    const authData = await AuthManager.addMicrosoftAccount(authCode)
    return {
      accessToken: authData.accessToken,
      username: authData.username,
      uuid: authData.uuid,
      displayName: authData.displayName
    }
  })

  ipcMain.handle(Channels.AUTH_LOGOUT, async (_event, uuid) => {
    AuthManager.removeAccount(uuid)
  })

  ipcMain.handle(Channels.AUTH_VALIDATE, async () => {
    return await AuthManager.validateSelectedMicrosoftAccount()
  })

  ipcMain.handle(Channels.AUTH_GET_ACCOUNT, async () => {
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

  // Token monitoring - check every 5 minutes
  setInterval(() => {
    const result = AuthManager.monitorTokenExpiration()
    if (result && result.expired && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(Channels.AUTH_TOKEN_EXPIRED, result)
    }
  }, 300000)
}
