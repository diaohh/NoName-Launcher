import { BrowserWindow } from 'electron'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('MsftAuth')

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'b7607eac-c8e1-404f-9042-b7f75757daa3'
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

/**
 * The sign-in flow legitimately bounces between these hosts. Anything else is either a
 * mistake or an attempt to steer the window somewhere it has no business going, so the
 * navigation is blocked.
 */
const ALLOWED_HOSTS = new Set([
    'login.microsoftonline.com',
    'login.microsoft.com',
    'login.live.com',
    'account.live.com'
])

const OAUTH_ERROR_MESSAGES = {
    access_denied: 'Has cancelado el inicio de sesion con Microsoft.',
    consent_required: 'Debes aceptar los permisos de la aplicacion para poder entrar.',
    login_required: 'Microsoft ha pedido iniciar sesion de nuevo. Intentalo otra vez.'
}

let msftAuthWindow = null

export function createMsftAuthWindow() {
    return new Promise((resolve, reject) => {
        if (msftAuthWindow) {
            reject(new Error('Ya hay una ventana de inicio de sesion abierta.'))
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
                sandbox: true
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
            const oauthError = query.get('error')
            if (oauthError) {
                const message = OAUTH_ERROR_MESSAGES[oauthError]
                    || query.get('error_description')
                    || 'Microsoft ha rechazado el inicio de sesion.'

                logger.warn(`Authorization failed: ${oauthError}`)

                const err = new Error(message)
                err.code = `OAUTH_${oauthError.toUpperCase()}`
                finish(reject, err)
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
            const err = new Error('Has cerrado la ventana antes de completar el inicio de sesion.')
            err.code = 'OAUTH_WINDOW_CLOSED'
            reject(err)
        })

        const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?` +
            `prompt=select_account&` +
            `client_id=${MICROSOFT_CLIENT_ID}&` +
            `response_type=code&` +
            `scope=XboxLive.signin%20offline_access&` +
            `redirect_uri=${REDIRECT_URI}`

        window.loadURL(authUrl)
    })
}
