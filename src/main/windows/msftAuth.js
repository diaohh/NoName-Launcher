import { BrowserWindow, session } from 'electron'
import Logger from '../utils/Logger'
import { MICROSOFT_CLIENT_ID } from '../constants'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('MsftAuth')

const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

/**
 * The sign-in window gets a session of its own, never the launcher's default one.
 *
 * In the default session Microsoft's cookies were written to disk next to the launcher's and
 * outlived a logout: the next "Iniciar sesion" could walk straight back into the previous
 * account, and the cookies themselves are a live Microsoft web session. Without the `persist:`
 * prefix this partition is kept in memory only, so nothing survives the process, and
 * `clearMsftAuthSession` empties it on logout for the rest of the run.
 */
const AUTH_PARTITION = 'msft-auth'

/** Hosts whose cookies older versions left in the default session. */
const MICROSOFT_COOKIE_DOMAINS = ['microsoftonline.com', 'microsoft.com', 'live.com']

/**
 * The sign-in flow legitimately bounces between these hosts. Anything else is either a
 * mistake or an attempt to steer the window somewhere it has no business going, so the
 * navigation is blocked.
 *
 * This guards `will-navigate`, which does not fire for redirects — those are the
 * `did-redirect-navigation` path. So what it really covers is the links on Microsoft's
 * own pages: sign up, password reset and the like. They have to be here, or the window
 * becomes a dead end for anyone who cannot get past the password box.
 */
const ALLOWED_HOSTS = new Set([
    'login.microsoftonline.com',
    'login.microsoft.com',
    'login.live.com',
    'account.live.com',
    'signup.live.com',
    'passwordreset.microsoftonline.com'
])

/** The `error` values Microsoft puts in the redirect that the launcher words on its own. */
const OAUTH_ERRORS = {
    access_denied: {
        code: ERROR_CODE.OAUTH_ACCESS_DENIED,
        message: 'Has cancelado el inicio de sesion con Microsoft.'
    },
    consent_required: {
        code: ERROR_CODE.OAUTH_CONSENT_REQUIRED,
        message: 'Debes aceptar los permisos de la aplicacion para poder entrar.'
    },
    login_required: {
        code: ERROR_CODE.OAUTH_LOGIN_REQUIRED,
        message: 'Microsoft ha pedido iniciar sesion de nuevo. Intentalo otra vez.'
    }
}

function oauthError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

let msftAuthWindow = null

export function createMsftAuthWindow() {
    return new Promise((resolve, reject) => {
        if (msftAuthWindow) {
            reject(oauthError(ERROR_CODE.OAUTH_WINDOW_OPEN, 'Ya hay una ventana de inicio de sesion abierta.'))
            return
        }

        const window = new BrowserWindow({
            title: 'Microsoft Login',
            width: 520,
            height: 650,
            frame: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                partition: AUTH_PARTITION
            }
        })
        msftAuthWindow = window

        // One flag for the whole window. `closed` fires both for a flow that completed
        // and for a window the player shut, and only the second is a cancellation.
        let settled = false

        const finish = (settle, value) => {
            if (settled) return
            settled = true
            settle(value)

            // Never close the window from inside a navigation event. `did-redirect-navigation`
            // fires while the redirect is still in flight, and destroying the webContents at
            // that point crashes the process outright (access violation). Deferring the close
            // by a tick lets Electron finish with the event first.
            setImmediate(() => {
                if (!window.isDestroyed()) window.close()
            })
        }

        const isAllowed = (uri) => {
            try {
                return ALLOWED_HOSTS.has(new URL(uri).host)
            } catch {
                return false
            }
        }

        /**
         * A redirect raises `did-redirect-navigation`, a completed load raises
         * `did-navigate`; listening to only one of them left the window hanging on some
         * flows. Whichever arrives first settles the promise, the other is a no-op.
         */
        const handleNavigation = (_event, uri) => {
            if (!uri.startsWith(REDIRECT_URI)) return

            const query = new URL(uri).searchParams

            const code = query.get('code')
            if (code) {
                logger.info('Authorization code received')
                finish(resolve, code)
                return
            }

            // Without this the window just sat there forever after a cancellation.
            const errorParam = query.get('error')
            if (errorParam) {
                const known = OAUTH_ERRORS[errorParam]
                const message = known?.message
                    || query.get('error_description')
                    || 'Microsoft ha rechazado el inicio de sesion.'

                logger.warn(`Authorization failed: ${errorParam}`)
                finish(reject, oauthError(known?.code ?? ERROR_CODE.OAUTH_FAILED, message))
            }
        }

        window.webContents.on('did-navigate', handleNavigation)
        window.webContents.on('did-redirect-navigation', handleNavigation)

        window.webContents.on('will-navigate', (event, uri) => {
            if (!isAllowed(uri)) {
                logger.warn(`Blocked navigation to a non-Microsoft host: ${uri}`)
                event.preventDefault()
            }
        })

        window.webContents.setWindowOpenHandler(({ url }) => {
            logger.warn(`Blocked popup from the auth window: ${url}`)
            return { action: 'deny' }
        })

        window.on('closed', () => {
            msftAuthWindow = null
            if (settled) return

            settled = true
            reject(oauthError(ERROR_CODE.OAUTH_WINDOW_CLOSED, 'Has cerrado la ventana antes de completar el inicio de sesion.'))
        })

        const authUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?' +
            'prompt=select_account&' +
            `client_id=${MICROSOFT_CLIENT_ID}&` +
            'response_type=code&' +
            'scope=XboxLive.signin%20offline_access&' +
            `redirect_uri=${REDIRECT_URI}`

        window.loadURL(authUrl)
    })
}

/** Forgets the Microsoft account the sign-in window last used. Called on logout. */
export async function clearMsftAuthSession() {
    await session.fromPartition(AUTH_PARTITION).clearStorageData()
}

/**
 * Removes the Microsoft cookies that versions before the sign-in partition left on disk in the
 * default session. Nothing writes them there any more, so this only cleans up after an upgrade
 * and finds nothing on every later start.
 */
export async function purgeLegacyAuthCookies() {
    const cookies = session.defaultSession.cookies
    const isMicrosoft = (domain) => {
        const host = domain.replace(/^\./, '')
        return MICROSOFT_COOKIE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
    }

    const stale = (await cookies.get({})).filter((cookie) => isMicrosoft(cookie.domain))
    await Promise.all(stale.map((cookie) => {
        const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`
        return cookies.remove(url, cookie.name)
    }))

    if (stale.length > 0) logger.info(`Removed ${stale.length} Microsoft cookies from the default session`)
}
