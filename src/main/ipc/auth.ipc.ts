import type { BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { emit, type InvokeHandlers } from './result'
import Logger from '../utils/Logger'
import AuthManager from '../managers/AuthManager'
import { createMsftAuthWindow, clearMsftAuthSession, takeCodeVerifier } from '../windows/msftAuth'

const logger = Logger.getLogger('AuthIPC')

export function authHandlers() {
  return {
    [Channels.AUTH_MSFT_LOGIN]: async () => {
      return await createMsftAuthWindow()
    },

    [Channels.AUTH_LOGIN]: async (_event, authCode) => {
      if (typeof authCode !== 'string' || authCode.length === 0) {
        throw new LauncherError(ERROR_CODE.OAUTH_FAILED, 'Microsoft no ha devuelto un codigo de autorizacion valido.')
      }

      // Only the code of the last sign-in window, and only once (PKCE, see msftAuth.ts).
      const codeVerifier = takeCodeVerifier(authCode)
      if (!codeVerifier) {
        throw new LauncherError(ERROR_CODE.OAUTH_FAILED, 'El inicio de sesion ha caducado. Vuelve a intentarlo.')
      }

      const authData = await AuthManager.addMicrosoftAccount(authCode, codeVerifier)
      // A fresh account carries a fresh expiry, so the scheduler is re-armed against it.
      AuthManager.scheduleTokenRefresh()
      // The Minecraft access token never crosses into the renderer: it is read from
      // ConfigManager in the main process when the launch command is built.
      return {
        username: authData.username,
        uuid: authData.uuid,
        displayName: authData.displayName
      }
    },

    [Channels.AUTH_LOGOUT]: async (_event, uuid) => {
      if (typeof uuid !== 'string') {
        throw new LauncherError(ERROR_CODE.AUTH_NO_ACCOUNT, 'No hay ninguna cuenta con ese identificador.')
      }

      await AuthManager.removeAccount(uuid)
      // Re-arms against whatever account is left, or disarms when none is.
      AuthManager.scheduleTokenRefresh()
      // The account is already gone from config.json; a failure here only means the sign-in
      // window may still remember it until the launcher restarts (its partition is in memory).
      await clearMsftAuthSession().catch((err) => logger.warn('Could not clear the sign-in session', err))
    },

    [Channels.AUTH_VALIDATE]: async () => {
      return await AuthManager.validateSelectedMicrosoftAccount()
    },

    [Channels.AUTH_GET_ACCOUNT]: async () => {
      const account = AuthManager.getSelectedAccount()
      if (!account) return null
      return {
        type: account.type,
        username: account.username,
        uuid: account.uuid,
        displayName: account.displayName,
        expiresAt: account.expiresAt
      }
    }
  } satisfies Partial<InvokeHandlers>
}

/**
 * The refresh is scheduled from the token's own expiry rather than polled for, and the
 * callback fires only when the session is gone for good.
 */
export function watchSession(mainWindow: BrowserWindow): void {
  AuthManager.startTokenRefreshScheduler((payload) => {
    emit(mainWindow, Channels.AUTH_TOKEN_EXPIRED, payload)
  })

  mainWindow.on('closed', () => AuthManager.stopTokenRefreshScheduler())
}
