import { BrowserWindow } from 'electron'

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'b7607eac-c8e1-404f-9042-b7f75757daa3'
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

let msftAuthWindow = null

export function createMsftAuthWindow() {
    return new Promise((resolve, reject) => {
        if (msftAuthWindow) {
            reject(new Error('Auth window already open'))
            return
        }

        msftAuthWindow = new BrowserWindow({
            title: 'Microsoft Login',
            width: 520,
            height: 650,
            frame: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        })

        const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?` +
            `prompt=select_account&` +
            `client_id=${MICROSOFT_CLIENT_ID}&` +
            `response_type=code&` +
            `scope=XboxLive.signin%20offline_access&` +
            `redirect_uri=${REDIRECT_URI}`

        msftAuthWindow.loadURL(authUrl)

        msftAuthWindow.webContents.on('did-navigate', (event, uri) => {
            if (uri.startsWith(REDIRECT_URI)) {
                const queries = new URLSearchParams(new URL(uri).search)
                const code = queries.get('code')

                if (code) {
                    resolve(code)
                    msftAuthWindow.close()
                    msftAuthWindow = null
                }
            }
        })

        msftAuthWindow.on('closed', () => {
            if (msftAuthWindow) {
                msftAuthWindow = null
                reject(new Error('Auth window closed without completing'))
            }
            msftAuthWindow = null
        })
    })
}

export function createMsftLogoutWindow() {
    return new Promise((resolve) => {
        const logoutWindow = new BrowserWindow({
            title: 'Microsoft Logout',
            width: 520,
            height: 650,
            frame: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        })

        logoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')

        logoutWindow.on('closed', () => {
            resolve()
        })
    })
}
