import { MicrosoftAuth, MicrosoftErrorCode } from 'helios-core/microsoft'
import { RestResponseStatus } from 'helios-core/common'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('AuthManager')

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'b7607eac-c8e1-404f-9042-b7f75757daa3'

const AUTH_MODE = {
    FULL: 0,
    MS_REFRESH: 1,
    MC_REFRESH: 2
}

export const AUTH_ERROR = {
    NO_ACCOUNT: 'AUTH_NO_ACCOUNT',
    NETWORK: 'AUTH_NETWORK',
    INVALID_GRANT: 'AUTH_INVALID_GRANT',
    NO_PROFILE: 'AUTH_NO_PROFILE',
    NO_XBOX_ACCOUNT: 'AUTH_NO_XBOX_ACCOUNT',
    XBL_BANNED: 'AUTH_XBL_BANNED',
    UNDER_18: 'AUTH_UNDER_18',
    UNKNOWN: 'AUTH_UNKNOWN'
}

/**
 * Codes that mean the stored credentials are dead and cannot be revived by retrying.
 * Only these justify deleting the account; everything else — no network, a 5xx, an
 * error we do not recognise — keeps the session and reports the problem.
 */
const TERMINAL_CODES = new Set([
    AUTH_ERROR.NO_ACCOUNT,
    AUTH_ERROR.INVALID_GRANT,
    AUTH_ERROR.NO_PROFILE,
    AUTH_ERROR.NO_XBOX_ACCOUNT,
    AUTH_ERROR.XBL_BANNED,
    AUTH_ERROR.UNDER_18
])

/** got reports a request that never reached the server with one of these and no response. */
const TRANSPORT_ERROR_CODES = new Set([
    'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
    'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'EPIPE', 'EPROTO'
])

const MESSAGES = {
    NO_ACCOUNT: 'No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.',
    NETWORK: 'No se ha podido contactar con Microsoft. Comprueba tu conexion e intentalo de nuevo.',
    SERVER: 'Los servidores de Microsoft no responden ahora mismo. Intentalo de nuevo en unos minutos.',
    INVALID_GRANT: 'Tu sesion de Microsoft ya no es valida. Vuelve a iniciar sesion.',
    UNKNOWN: 'Ha ocurrido un error inesperado durante la autenticacion. Intentalo de nuevo.'
}

class AuthManager {

    static authError(code, message, cause) {
        const error = new Error(message)
        error.code = code
        if (cause) error.cause = cause
        return error
    }

    /** True when the failure means the session is gone for good. */
    static isTerminalError(code) {
        return TERMINAL_CODES.has(code)
    }

    /** Microsoft answers OAuth failures with a JSON body carrying an `error` field. */
    static readOAuthError(cause) {
        const body = cause?.response?.body
        if (!body) return null
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            return parsed?.error ?? null
        } catch {
            return null
        }
    }

    /**
     * helios-core never throws for a failed request: it returns the response with
     * `responseStatus: ERROR` and the underlying got error attached. Everything needed
     * to tell "no internet" from "revoked consent" is in there, so this is the single
     * place that decides whether a failure is worth logging the player out.
     *
     * @param terminalFallback MicrosoftErrorCode to assume for an unexplained 4xx on
     *                         endpoints where one failure mode dominates.
     */
    static classifyRestError(operation, response, terminalFallback = null) {
        const cause = response?.error
        const statusCode = cause?.response?.statusCode

        // UNKNOWN is helios' default, so it carries no information — only a specific
        // code means Microsoft actually named the problem with the account.
        if (response?.microsoftErrorCode != null && response.microsoftErrorCode !== MicrosoftErrorCode.UNKNOWN) {
            logger.warn(`${operation} failed with Microsoft error code ${response.microsoftErrorCode}`)
            return this.microsoftError(response.microsoftErrorCode, cause)
        }

        // No HTTP response at all: the request never reached Microsoft.
        if (statusCode == null) {
            logger.warn(`${operation} failed before reaching Microsoft (${cause?.code ?? 'no code'})`)
            return this.authError(AUTH_ERROR.NETWORK, MESSAGES.NETWORK, cause)
        }

        if (statusCode >= 500 || statusCode === 429) {
            logger.warn(`${operation} failed with HTTP ${statusCode}, treating as transient`)
            return this.authError(AUTH_ERROR.NETWORK, MESSAGES.SERVER, cause)
        }

        const oauthError = this.readOAuthError(cause)
        if (statusCode === 401 || ['invalid_grant', 'invalid_client', 'unauthorized_client', 'interaction_required', 'consent_required'].includes(oauthError)) {
            logger.warn(`${operation} rejected the stored credentials (${oauthError ?? `HTTP ${statusCode}`})`)
            return this.authError(AUTH_ERROR.INVALID_GRANT, MESSAGES.INVALID_GRANT, cause)
        }

        if (terminalFallback != null) {
            logger.warn(`${operation} failed with HTTP ${statusCode}, assuming ${terminalFallback}`)
            return this.microsoftError(terminalFallback, cause)
        }

        logger.error(`${operation} failed with HTTP ${statusCode} (${oauthError ?? 'no oauth error'})`)
        return this.authError(AUTH_ERROR.UNKNOWN, MESSAGES.UNKNOWN, cause)
    }

    /** Classifies an exception that escaped a helios call instead of being returned. */
    static classifyThrown(err) {
        if (typeof err?.code === 'string' && err.code.startsWith('AUTH_')) return err
        if (TRANSPORT_ERROR_CODES.has(err?.code)) {
            logger.warn(`Microsoft auth failed at the transport layer (${err.code})`)
            return this.authError(AUTH_ERROR.NETWORK, MESSAGES.NETWORK, err)
        }
        logger.error('Unexpected Microsoft auth error:', err)
        return this.authError(AUTH_ERROR.UNKNOWN, MESSAGES.UNKNOWN, err)
    }

    static async fullMicrosoftAuthFlow(authCode, authMode = AUTH_MODE.FULL) {
        try {
            logger.info('Starting Microsoft auth flow, mode:', authMode)

            let msAccessToken, msRefreshToken, msExpires

            if (authMode === AUTH_MODE.MC_REFRESH) {
                msAccessToken = authCode
                msRefreshToken = null
                msExpires = null
                logger.info('Reusing existing MS access token for MC refresh')
            } else {
                const accessTokenResponse = await MicrosoftAuth.getAccessToken(
                    authCode,
                    authMode === AUTH_MODE.MS_REFRESH,
                    MICROSOFT_CLIENT_ID
                )

                if (accessTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                    throw this.classifyRestError('getAccessToken', accessTokenResponse)
                }

                msAccessToken = accessTokenResponse.data.access_token
                msRefreshToken = accessTokenResponse.data.refresh_token
                msExpires = this.calculateExpiryDate(
                    new Date().getTime(),
                    accessTokenResponse.data.expires_in
                )

                logger.info('Microsoft access token obtained')
            }

            const xblResponse = await MicrosoftAuth.getXBLToken(msAccessToken)
            if (xblResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXBLToken', xblResponse)
            }

            logger.info('XBL token obtained')

            const xstsResponse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
            if (xstsResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXSTSToken', xstsResponse)
            }

            logger.info('XSTS token obtained')

            const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResponse.data)
            if (mcTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCAccessToken', mcTokenResponse)
            }

            const mcAccessToken = mcTokenResponse.data.access_token
            const mcExpires = this.calculateExpiryDate(
                new Date().getTime(),
                mcTokenResponse.data.expires_in
            )

            logger.info('Minecraft access token obtained')

            // A 4xx here is almost always an account with no Minecraft profile — Game
            // Pass users who never opened the official launcher land exactly here.
            const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcAccessToken)
            if (mcProfileResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCProfile', mcProfileResponse, MicrosoftErrorCode.NO_PROFILE)
            }

            const mcProfile = mcProfileResponse.data
            logger.info('Minecraft profile obtained:', mcProfile.name)

            return {
                accessToken: mcAccessToken,
                username: mcProfile.name,
                uuid: mcProfile.id,
                displayName: mcProfile.name,
                mcExpires,
                msAccessToken,
                msRefreshToken,
                msExpires
            }

        } catch (err) {
            // Never flatten a classified failure back into UNKNOWN: losing the code here
            // is what used to turn "no internet" into a logout.
            throw this.classifyThrown(err)
        }
    }

    static async addMicrosoftAccount(authCode) {
        const authData = await this.fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

        ConfigManager.addMicrosoftAccount(
            authData.uuid,
            authData.accessToken,
            authData.username,
            authData.displayName,
            authData.mcExpires,
            authData.msAccessToken,
            authData.msRefreshToken,
            authData.msExpires
        )

        ConfigManager.save()
        logger.info('Microsoft account added successfully')

        return authData
    }

    /**
     * Validates the selected account, refreshing its tokens when needed.
     *
     * Returns `{ ok: true }` or `{ ok: false, code, message }`. A transient failure must
     * never cost the player their account, so the account is removed only for a terminal
     * code.
     */
    static async validateSelectedMicrosoftAccount() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) {
            logger.warn('No account selected')
            return { ok: false, code: AUTH_ERROR.NO_ACCOUNT, message: MESSAGES.NO_ACCOUNT }
        }

        const account = ConfigManager.getAccountByUUID(uuid)
        if (!account || account.type !== 'microsoft') {
            logger.warn('Invalid account or not Microsoft')
            return { ok: false, code: AUTH_ERROR.NO_ACCOUNT, message: MESSAGES.NO_ACCOUNT }
        }

        const now = new Date().getTime()

        if (account.expiresAt > now) {
            logger.info('MC token still valid')
            return { ok: true }
        }

        try {
            if (account.microsoft.expires_at > now) {
                logger.info('MC token expired, MS token still valid: refreshing the MC token only')
                await this.refreshMCToken(account)
            } else {
                logger.info('MC and MS tokens expired: full refresh')
                await this.refreshMSToken(account)
            }
            return { ok: true }
        } catch (err) {
            const code = err?.code ?? AUTH_ERROR.UNKNOWN

            if (this.isTerminalError(code)) {
                logger.warn(`Refresh failed with a terminal error (${code}), logging out user`)
                this.removeAccount(uuid)
            } else {
                logger.warn(`Refresh failed with a recoverable error (${code}), keeping the account`)
            }

            return { ok: false, code, message: err?.message ?? MESSAGES.UNKNOWN }
        }
    }

    static async refreshMCToken(account) {
        logger.info('Attempting to refresh MC token for account:', account.uuid)
        const authData = await this.fullMicrosoftAuthFlow(
            account.microsoft.access_token,
            AUTH_MODE.MC_REFRESH
        )

        ConfigManager.updateMicrosoftAccount(
            account.uuid,
            authData.accessToken,
            authData.mcExpires,
            account.microsoft.access_token,
            account.microsoft.refresh_token,
            account.microsoft.expires_at
        )

        ConfigManager.save()
        logger.info('MC token refreshed successfully')
    }

    static async refreshMSToken(account) {
        logger.info('Attempting to refresh MS token for account:', account.uuid)
        const authData = await this.fullMicrosoftAuthFlow(
            account.microsoft.refresh_token,
            AUTH_MODE.MS_REFRESH
        )

        ConfigManager.updateMicrosoftAccount(
            account.uuid,
            authData.accessToken,
            authData.mcExpires,
            authData.msAccessToken,
            authData.msRefreshToken,
            authData.msExpires
        )

        ConfigManager.save()
        logger.info('MS and MC tokens refreshed successfully')
    }

    static getSelectedAccount() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) return null
        return ConfigManager.getAccountByUUID(uuid)
    }

    static removeAccount(uuid) {
        ConfigManager.removeAccount(uuid)
        ConfigManager.save()
        logger.info('Account removed:', uuid)
    }

    /**
     * Periodic session check.
     *
     * `microsoft.expires_at` is the expiry of the Microsoft *access* token (about an
     * hour), not of the refresh token (about 90 days). Comparing against it used to log
     * every player out roughly a day after login, with a refresh token that was still
     * perfectly good. It now runs the same refresh path a launch does and reports an
     * expiry only when that path gave up for a terminal reason.
     */
    static async monitorTokenExpiration() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) return null

        const account = ConfigManager.getAccountByUUID(uuid)
        if (!account || account.type !== 'microsoft') return null

        if (account.expiresAt > new Date().getTime()) return { expired: false }

        const result = await this.validateSelectedMicrosoftAccount()
        if (result.ok) return { expired: false }

        // The account is still there, so the failure was recoverable: a network blip
        // must not bounce the player back to the login screen.
        if (ConfigManager.getAccountByUUID(uuid)) {
            logger.warn(`Token refresh deferred (${result.code}), keeping the session`)
            return { expired: false }
        }

        return { expired: true, message: result.message }
    }

    static calculateExpiryDate(nowMs, expiresInS) {
        return nowMs + ((expiresInS - 10) * 1000)
    }

    /**
     * Builds a real Error for a Microsoft error code. It used to return a plain
     * `{ title, desc }` object, which does not survive `ipcMain.handle` — that is why
     * a failed login showed the user the word "undefined".
     */
    static microsoftError(errorCode, cause) {
        switch (errorCode) {
            case MicrosoftErrorCode.NO_PROFILE:
                return this.authError(
                    AUTH_ERROR.NO_PROFILE,
                    'Esta cuenta de Microsoft no tiene un perfil de Minecraft. Compra el juego, o entra una vez en el launcher oficial para elegir tu nombre.',
                    cause
                )
            case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
                return this.authError(
                    AUTH_ERROR.NO_XBOX_ACCOUNT,
                    'Esta cuenta de Microsoft no tiene una cuenta de Xbox. Crea una e intentalo de nuevo.',
                    cause
                )
            case MicrosoftErrorCode.XBL_BANNED:
                return this.authError(
                    AUTH_ERROR.XBL_BANNED,
                    'Esta cuenta esta bloqueada en Xbox Live y no puede iniciar sesion.',
                    cause
                )
            case MicrosoftErrorCode.UNDER_18:
                return this.authError(
                    AUTH_ERROR.UNDER_18,
                    'Esta cuenta pertenece a un menor de edad. Un adulto debe añadirla a una familia de Microsoft.',
                    cause
                )
            default:
                return this.authError(AUTH_ERROR.UNKNOWN, MESSAGES.UNKNOWN, cause)
        }
    }
}

export default AuthManager
